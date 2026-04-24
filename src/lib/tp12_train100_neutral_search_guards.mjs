import fs from "node:fs"
import path from "node:path"

import { readJson } from "./io.mjs"
import { toBool, toNumber, toText, validDateKey } from "./tp12_year2hit_foundation_io.mjs"

export const TP12_TRAIN100_NEUTRAL_PATCH_KEY = "tp12_train100_neutral_anchor_veto_certificate_v1"
export const TP12_TRAIN100_NEUTRAL_CONTRACT_KIND =
  "tp12_train100_neutral_anchor_veto_certificate_contract_v1"

export const CORE_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]

export const looksLikeOosPath = (value) => {
  const normalized = toText(value).replace(/\\/g, "/").toLowerCase()
  if (!normalized) return false
  const parts = normalized.split("/").filter(Boolean)
  if (parts.some((part) => part === "oos" || part.startsWith("oos_") || part.startsWith("oos-"))) return true
  const base = parts.at(-1) ?? ""
  if (base === "oos.json" || base.startsWith("oos_") || base.startsWith("oos-")) return true
  return /(^|[^0-9])2025-\d{2}-\d{2}([^0-9]|$)/.test(normalized) ||
    /(^|[^0-9])2026-\d{2}-\d{2}([^0-9]|$)/.test(normalized)
}

export const assertNoOosPath = (value, label = "path") => {
  if (looksLikeOosPath(value)) throw new Error(`${label} references forbidden OOS data: ${value}`)
}

export const resolvePath = (cwd, filePath, label, { mustExist = true } = {}) => {
  const text = toText(filePath)
  if (!text) {
    if (mustExist) throw new Error(`${label} is required`)
    return ""
  }
  assertNoOosPath(text, label)
  const resolved = path.resolve(cwd, text)
  if (mustExist && !fs.existsSync(resolved)) throw new Error(`${label} not found: ${resolved}`)
  return resolved
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

const collectForbiddenHits = (value, forbiddenFields = [], pathParts = []) => {
  const hits = []
  if (value === null || value === undefined) return hits
  if (Array.isArray(value)) {
    value.forEach((item, index) => hits.push(...collectForbiddenHits(item, forbiddenFields, [...pathParts, String(index)])))
    return hits
  }
  if (typeof value !== "object") return hits
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenFields.includes(key)) hits.push([...pathParts, key].join("."))
    hits.push(...collectForbiddenHits(child, forbiddenFields, [...pathParts, key]))
  }
  return hits
}

export const assertNoForbiddenExpressionFields = (value, contract, label = "expression") => {
  const forbidden = Array.isArray(contract?.forbiddenExpressionFields) ? contract.forbiddenExpressionFields : []
  const hits = collectForbiddenHits(value, forbidden)
  if (hits.length > 0) throw new Error(`${label} uses forbidden expression fields: ${hits.slice(0, 20).join(",")}`)
}

export const assertNeutralAtomNaming = (atom = {}) => {
  const featureName = toText(atom.featureName)
  const atomId = toText(atom.atomId)
  const haystack = featureName.toLowerCase()
  const forbiddenPolarity = ["bad", "good", "weak"]
  const hit = forbiddenPolarity.find((token) => haystack.includes(token))
  if (hit) throw new Error(`neutral atom contains semantic polarity token "${hit}": ${featureName || atomId}`)
  if (toText(atom.rolePolarity) && toText(atom.rolePolarity) !== "neutral") {
    throw new Error(`atom rolePolarity must be neutral: ${featureName || atomId}`)
  }
}

const gridValuesForType = (contract, type) => {
  const grid = contract?.thresholdGrid ?? {}
  if (type === "percentile") return grid.percentile ?? []
  if (type === "rankBucket") return grid.rankBuckets ?? []
  if (type === "zScore") return grid.zScore ?? []
  if (type === "count") return grid.counts ?? []
  if (type === "share") return grid.shares ?? []
  if (type === "day") return grid.days ?? []
  if (type === "wickRatio") return grid.wickRatio ?? []
  if (type === "closeLocation") return grid.closeLocation ?? []
  return []
}

export const assertThresholdInContractGrid = (atom, contract) => {
  const spec = atom?.thresholdSpec ?? {}
  const type = toText(spec.type)
  const allowed = gridValuesForType(contract, type)
  if (allowed.length < 1) throw new Error(`threshold grid type is not allowed: ${type || "missing"}`)
  const value = spec.value
  const ok = allowed.some((candidate) => String(candidate) === String(value))
  if (!ok) throw new Error(`threshold value not in contract grid: ${type}:${String(value)}`)
}

export const assertAsOfSafeFeature = (feature = {}) => {
  const sourceDateKey = toText(feature.sourceDateKey)
  const decisionDateKey = toText(feature.decisionDateKey)
  if (sourceDateKey && decisionDateKey && sourceDateKey > decisionDateKey) {
    throw new Error(`feature sourceDateKey is after decisionDateKey: ${sourceDateKey} > ${decisionDateKey}`)
  }
}

export const assertNoFallbackMode = (config = {}) => {
  if (toBool(config?.fallbackAllowed, false) === true) throw new Error("fallbackAllowed=true is forbidden")
  if (toBool(config?.oosReadAllowed, false) === true) throw new Error("oosReadAllowed=true is forbidden")
  if (toBool(config?.lockedSelectorAllowed, false) === true) throw new Error("lockedSelectorAllowed=true is forbidden")
}

export const loadTp12Train100NeutralContract = async (contractPath, { cwd = process.cwd() } = {}) => {
  const resolvedContractPath = resolvePath(cwd, contractPath, "contractPath")
  const contract = await readJson(resolvedContractPath, null)
  if (!contract) throw new Error(`contractPath is not readable JSON: ${resolvedContractPath}`)
  if (contract.kind !== TP12_TRAIN100_NEUTRAL_CONTRACT_KIND) {
    throw new Error(`invalid neutral contract kind: ${contract.kind ?? "missing"}`)
  }
  if (contract.patchKey !== TP12_TRAIN100_NEUTRAL_PATCH_KEY) {
    throw new Error(`invalid patchKey: expected ${TP12_TRAIN100_NEUTRAL_PATCH_KEY}, got ${contract.patchKey ?? "missing"}`)
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
  assertNoFallbackMode(contract)
  const objective = contract.objective ?? {}
  if (Math.trunc(toNumber(objective.minHitDecisionDatesPerYear, 0)) !== 2) {
    throw new Error("minHitDecisionDatesPerYear must equal 2")
  }
  if (Math.trunc(toNumber(objective.minHitSymbolDatesPerYear, 0)) !== 2) {
    throw new Error("minHitSymbolDatesPerYear must equal 2")
  }
  if (Math.trunc(toNumber(objective.minTotalPositiveSymbolDates, 0)) < 18) {
    throw new Error("minTotalPositiveSymbolDates must be at least 18")
  }
  if (toNumber(objective.requireTrainPrecision, 0) !== 1) throw new Error("requireTrainPrecision must equal 1")
  if (Math.trunc(toNumber(objective.requireFalsePositiveRows, 999)) !== 0) {
    throw new Error("requireFalsePositiveRows must equal 0")
  }
  const expression = contract.expression ?? {}
  if (!Array.isArray(expression.allowedFeatureSpaceIds) || expression.allowedFeatureSpaceIds.length < 1) {
    throw new Error("contract.expression.allowedFeatureSpaceIds is required")
  }
  assertNoForbiddenExpressionFields(contract, contract, "contract")
  return { contract, contractPath: resolvedContractPath }
}

export const targetFromContract = (contract) => ({
  minHitDecisionDatesPerYear: Math.trunc(toNumber(contract?.objective?.minHitDecisionDatesPerYear, 2)),
  minHitSymbolDatesPerYear: Math.trunc(toNumber(contract?.objective?.minHitSymbolDatesPerYear, 2)),
  minTotalPositiveSymbolDates: Math.trunc(toNumber(contract?.objective?.minTotalPositiveSymbolDates, 18)),
  requireFalsePositiveRows: Math.trunc(toNumber(contract?.objective?.requireFalsePositiveRows, 0)),
  requireTrainPrecision: toNumber(contract?.objective?.requireTrainPrecision, 1),
})

export const expressionLimitsFromContract = (contract) => ({
  maxAnchorAtoms: Math.trunc(toNumber(contract?.expression?.maxAnchorAtoms, 4)),
  maxVetoClauses: Math.trunc(toNumber(contract?.expression?.maxVetoClauses, 4)),
  maxVetoAtomsPerClause: Math.trunc(toNumber(contract?.expression?.maxVetoAtomsPerClause, 3)),
  maxTotalAtoms: Math.trunc(toNumber(contract?.expression?.maxTotalAtoms, 10)),
})
