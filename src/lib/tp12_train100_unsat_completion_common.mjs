import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import {
  createJsonlWriteStreamMaybeGzip,
  iterateJsonlMaybeGzip,
  toBool,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

export { toBool, toNumber, toText, uniqueSorted }

export const TP12_TRAIN100_UNSAT_PATCH_KEY = "tp12_train100_year2hit_unsat_completion_cert_v1"
export const TP12_TRAIN100_UNSAT_CONTRACT_KIND =
  "tp12_train100_year2hit_unsat_completion_cert_contract_v1"

export const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex")

export const stableJson = (value) => JSON.stringify(value ?? null)

export const looksLikeOosPath = (filePath) => {
  const normalized = toText(filePath).replace(/\\/g, "/").toLowerCase()
  if (!normalized) return false
  const parts = normalized.split("/").filter(Boolean)
  if (parts.some((part) => part === "oos" || part.startsWith("oos_") || part.startsWith("oos-"))) return true
  const base = parts.at(-1) ?? ""
  if (base === "oos.json" || base.startsWith("oos_") || base.startsWith("oos-")) return true
  return /(^|[^0-9])2025-\d{2}-\d{2}([^0-9]|$)/.test(normalized) ||
    /(^|[^0-9])2026-\d{2}-\d{2}([^0-9]|$)/.test(normalized)
}

export const assertNoOosPath = (filePath, label = "path") => {
  if (looksLikeOosPath(filePath)) throw new Error(`${label} appears to reference forbidden OOS data: ${filePath}`)
}

export const resolvePath = (cwd, filePath, label, { mustExist = true, forbidOos = true } = {}) => {
  const text = toText(filePath)
  if (!text) {
    if (mustExist) throw new Error(`${label} is required`)
    return ""
  }
  if (forbidOos) assertNoOosPath(text, label)
  const resolved = path.resolve(cwd, text)
  if (mustExist && !fs.existsSync(resolved)) throw new Error(`${label} not found: ${resolved}`)
  return resolved
}

export const readJsonRequired = async (cwd, filePath, label) => {
  const resolved = resolvePath(cwd, filePath, label)
  const payload = await readJson(resolved, null)
  if (!payload) throw new Error(`${label} is not readable JSON: ${resolved}`)
  if (payload?.oosRead === true) throw new Error(`${label} has oosRead=true`)
  if (payload?.lockedSelectorEmitted === true) throw new Error(`${label} has lockedSelectorEmitted=true`)
  return { path: resolved, payload }
}

export const assertTrain100Target = (target = {}) => {
  const failures = []
  if (Math.trunc(toNumber(target.minHitDecisionDatesPerYear, 0)) !== 2) failures.push("minHitDecisionDatesPerYear_must_equal_2")
  if (Math.trunc(toNumber(target.minHitSymbolDatesPerYear, 0)) !== 2) failures.push("minHitSymbolDatesPerYear_must_equal_2")
  if (Math.trunc(toNumber(target.minPositiveSymbolDatesTotal, 0)) < 18) failures.push("minPositiveSymbolDatesTotal_must_be_at_least_18")
  if (toNumber(target.requiredTrainPrecision, 0) !== 1) failures.push("requiredTrainPrecision_must_equal_1")
  if (Math.trunc(toNumber(target.maxFalsePositiveRows, 999)) !== 0) failures.push("maxFalsePositiveRows_must_equal_0")
  if (failures.length > 0) throw new Error(`invalid train100 target: ${failures.join("; ")}`)
}

export const loadTp12Train100UnsatCompletionContract = async (contractPath, { cwd = process.cwd() } = {}) => {
  const resolved = resolvePath(cwd, contractPath, "contractPath")
  const contract = await readJson(resolved, null)
  if (!contract) throw new Error(`contractPath is not readable JSON: ${resolved}`)
  if (contract.kind !== TP12_TRAIN100_UNSAT_CONTRACT_KIND) {
    throw new Error(`invalid unsat completion contract kind: ${contract.kind ?? "missing"}`)
  }
  if (contract.patchKey !== TP12_TRAIN100_UNSAT_PATCH_KEY) {
    throw new Error(`invalid patchKey: expected ${TP12_TRAIN100_UNSAT_PATCH_KEY}, got ${contract.patchKey ?? "missing"}`)
  }
  const trainFrom = toText(contract?.trainDateRange?.from)
  const trainTo = toText(contract?.trainDateRange?.to)
  if (!validDateKey(trainFrom) || !validDateKey(trainTo) || trainFrom > trainTo) {
    throw new Error(`invalid trainDateRange: ${trainFrom || "missing"}..${trainTo || "missing"}`)
  }
  const forbiddenFrom = toText(contract?.forbiddenDateRange?.from)
  const forbiddenTo = toText(contract?.forbiddenDateRange?.to)
  if (!validDateKey(forbiddenFrom) || !validDateKey(forbiddenTo) || forbiddenFrom > forbiddenTo) {
    throw new Error(`invalid forbiddenDateRange: ${forbiddenFrom || "missing"}..${forbiddenTo || "missing"}`)
  }
  assertTrain100Target(contract.target ?? {})
  const rules = contract.rules ?? {}
  const forbiddenTrueFlags = [
    "oosReadAllowed",
    "emitSelectorAllowed",
    "fallbackAllowed",
    "relaxPrecisionAllowed",
    "relaxYear2HitAllowed",
    "oosReplayAllowed",
  ]
  const badFlags = forbiddenTrueFlags.filter((key) => toBool(rules[key], false) === true)
  if (badFlags.length > 0) throw new Error(`unsat completion contract has forbidden true flags: ${badFlags.join(",")}`)
  return { contract, contractPath: resolved }
}

export const outputPathFromContract = (cwd, contract, key, override = "") => {
  const selected = toText(override) || toText(contract?.outputPaths?.[key])
  if (!selected) throw new Error(`output path is required for ${key}`)
  assertNoOosPath(selected, `outputPaths.${key}`)
  return path.resolve(cwd, selected)
}

export const maybeOutputPathFromContract = (cwd, contract, key, override = "") => {
  const selected = toText(override) || toText(contract?.outputPaths?.[key])
  if (!selected) return ""
  assertNoOosPath(selected, `outputPaths.${key}`)
  return path.resolve(cwd, selected)
}

export const canonicalAtomIds = (atomIds) => uniqueSorted(Array.isArray(atomIds) ? atomIds : [])

export const canonicalStateId = ({ atomIds = [], supportHash = "" } = {}) => {
  const atoms = canonicalAtomIds(atomIds)
  return sha256(JSON.stringify({ atomIds: atoms, supportHash: toText(supportHash) }))
}

export const supportHashBucket = (supportHashValue, partitionCount) => {
  const count = Math.max(1, Math.trunc(toNumber(partitionCount, 1)))
  const text = toText(supportHashValue)
  const hex = /^[0-9a-f]+$/i.test(text) ? text.slice(0, 15) : sha256(text).slice(0, 15)
  return Number(BigInt(`0x${hex || "0"}`) % BigInt(count))
}

export const readFrontierRows = async (frontierPath, { strict = true } = {}) => {
  const rows = []
  if (!toText(frontierPath)) return rows
  if (!fs.existsSync(frontierPath)) throw new Error(`frontierPath not found: ${frontierPath}`)
  await iterateJsonlMaybeGzip(frontierPath, {
    strict,
    onRow: async (row, context) => {
      const atomIds = canonicalAtomIds(row?.atomIds)
      if (atomIds.length < 1) throw new Error(`frontier row missing atomIds at ${context.filePath}:${context.lineNumber}`)
      const supportHash = toText(row?.supportHash)
      if (!supportHash) throw new Error(`frontier row missing supportHash at ${context.filePath}:${context.lineNumber}`)
      rows.push({
        ...row,
        atomIds,
        atomCount: atomIds.length,
        supportHash,
        canonicalStateId: toText(row?.canonicalStateId) || canonicalStateId({ atomIds, supportHash }),
      })
    },
  })
  return rows
}

export const writeFrontierRows = async (frontierPath, rows = []) => {
  await ensureDir(path.dirname(frontierPath))
  const writer = createJsonlWriteStreamMaybeGzip(frontierPath)
  try {
    for (const row of rows) await writeJsonlRow(writer.stream, row)
  } finally {
    await writer.close()
  }
}

export const writeSummary = async (outPath, payload) => {
  await writeJson(outPath, payload)
  return payload
}

export const stateSummary = (rows = []) => ({
  stateCount: rows.length,
  maxAtomCount: rows.reduce((max, row) => Math.max(max, Math.trunc(toNumber(row.atomCount ?? row.atomIds?.length, 0))), 0),
})
