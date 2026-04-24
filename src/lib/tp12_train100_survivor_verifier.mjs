import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson } from "./io.mjs"
import {
  createJsonlWriteStreamMaybeGzip,
  iterateJsonlMaybeGzip,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"
import {
  assertNoOosPath,
  loadTp12Train100UnsatCompletionContract,
  maybeOutputPathFromContract,
  outputPathFromContract,
  resolvePath,
  toNumber,
  toText,
  writeSummary,
} from "./tp12_train100_unsat_completion_common.mjs"

const candidateCatalogPathFromContract = (cwd, contract, override = "") => {
  const selected = toText(override) ||
    toText(contract?.outputPaths?.survivorCandidateCatalog) ||
    toText(contract?.searchScope?.survivorCandidateCatalogPath)
  if (!selected) return ""
  assertNoOosPath(selected, "survivorCandidateCatalog")
  return path.resolve(cwd, selected)
}

const loadCandidateRows = async (candidateCatalogPath) => {
  const sourcePath = toText(candidateCatalogPath)
  if (!sourcePath) return []
  if (!fs.existsSync(sourcePath)) throw new Error(`candidate catalog not found: ${sourcePath}`)
  if (sourcePath.endsWith(".json")) {
    const payload = await readJson(sourcePath, null)
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload?.candidates)) return payload.candidates
    if (Array.isArray(payload?.rows)) return payload.rows
    throw new Error(`candidate catalog JSON must be an array or contain candidates/rows: ${sourcePath}`)
  }
  const rows = []
  await iterateJsonlMaybeGzip(sourcePath, {
    strict: true,
    onRow: async (row) => {
      rows.push(row)
    },
  })
  return rows
}

const yearStatValue = (row, year, key) => {
  const stats = row?.yearStats?.[String(year)] ?? row?.yearStats?.[Number(year)] ?? {}
  return Math.trunc(toNumber(stats?.[key], 0))
}

const rejectReasonsForCandidate = ({ row, contract }) => {
  const target = contract.target ?? {}
  const coreYears = Array.isArray(contract.coreYears) ? contract.coreYears.map((year) => Number(year)) : []
  const requiredPrecision = toNumber(target.requiredTrainPrecision, 1)
  const maxFalsePositiveRows = Math.trunc(toNumber(target.maxFalsePositiveRows, 0))
  const minHitDecisionDatesPerYear = Math.trunc(toNumber(target.minHitDecisionDatesPerYear, 2))
  const minHitSymbolDatesPerYear = Math.trunc(toNumber(target.minHitSymbolDatesPerYear, 2))
  const minPositiveTotal = Math.max(18, Math.trunc(toNumber(target.minPositiveSymbolDatesTotal, 18)))

  const rejectReasons = []
  const hitRows = Math.trunc(toNumber(row?.hitRows, 0))
  const falsePositiveRows = Math.trunc(toNumber(row?.falsePositiveRows, 0))
  const matchRows = Math.trunc(toNumber(row?.matchRows, hitRows + falsePositiveRows))
  const trainPrecision = toNumber(row?.trainPrecision, matchRows > 0 ? hitRows / matchRows : 0)

  if (!Array.isArray(row?.atomIds) || row.atomIds.length < 1) rejectReasons.push("missing_atom_ids")
  if (matchRows < 1) rejectReasons.push("zero_support")
  if (hitRows < minPositiveTotal) rejectReasons.push("positive_symbol_dates_below_min_total")
  if (falsePositiveRows > maxFalsePositiveRows) rejectReasons.push("false_positive_rows_above_max")
  if (trainPrecision !== requiredPrecision) rejectReasons.push("train_precision_below_required")
  for (const year of coreYears) {
    const hitDecisionDates = yearStatValue(row, year, "hitDecisionDates")
    const hitSymbolDates = yearStatValue(row, year, "hitSymbolDates")
    if (hitDecisionDates < minHitDecisionDatesPerYear) rejectReasons.push(`year_${year}_hit_decision_dates_below_min`)
    if (hitSymbolDates < minHitSymbolDatesPerYear) rejectReasons.push(`year_${year}_hit_symbol_dates_below_min`)
  }
  if (row?.oosRead === true) rejectReasons.push("candidate_oos_read_true")
  if (row?.lockedSelectorEmitted === true) rejectReasons.push("candidate_locked_selector_true")
  return rejectReasons
}

const statusForMissingCatalog = ({ contract, contractPath, candidateCatalogPath, outCatalogPath }) => ({
  kind: "tp12_train100_survivor_verification_summary_v1",
  generatedAt: new Date().toISOString(),
  patchKey: contract.patchKey,
  status: "not_run_no_survivor_catalog",
  contractPath,
  candidateCatalogPath: candidateCatalogPath || null,
  outCatalogPath,
  oosRead: false,
  inputCandidateCount: 0,
  verifiedSurvivorCount: 0,
  rejectedCandidateCount: 0,
  rejectReasonCounts: {},
  blockedReason: "missing_or_undeclared_survivor_candidate_catalog",
})

export const verifyTp12Train100SurvivorCatalog = async ({
  contractPath,
  candidateCatalogPath = "",
  outCatalogPath = "",
  outSummaryPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100UnsatCompletionContract(contractPath, { cwd })
  const sourceCatalogPath = candidateCatalogPathFromContract(cwd, contract, candidateCatalogPath)
  const outputCatalogPath = outputPathFromContract(cwd, contract, "verifiedSurvivorCatalog", outCatalogPath)
  const outputSummaryPath = outputPathFromContract(cwd, contract, "survivorVerificationSummary", outSummaryPath)

  if (!sourceCatalogPath || !fs.existsSync(sourceCatalogPath)) {
    if (contract?.searchScope?.allowMissingSurvivorCatalogForCertificate !== true) {
      resolvePath(cwd, sourceCatalogPath, "survivorCandidateCatalog")
    }
    await ensureDir(path.dirname(outputCatalogPath))
    const writer = createJsonlWriteStreamMaybeGzip(outputCatalogPath)
    await writer.close()
    return writeSummary(
      outputSummaryPath,
      statusForMissingCatalog({
        contract,
        contractPath: resolvedContractPath,
        candidateCatalogPath: sourceCatalogPath,
        outCatalogPath: outputCatalogPath,
      }),
    )
  }

  const rows = await loadCandidateRows(sourceCatalogPath)
  await ensureDir(path.dirname(outputCatalogPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputCatalogPath)
  const rejectReasonCounts = new Map()
  let verifiedSurvivorCount = 0
  let rejectedCandidateCount = 0
  try {
    for (const row of rows) {
      const rejectReasons = rejectReasonsForCandidate({ row, contract })
      if (rejectReasons.length > 0) {
        rejectedCandidateCount += 1
        for (const reason of rejectReasons) rejectReasonCounts.set(reason, (rejectReasonCounts.get(reason) ?? 0) + 1)
        continue
      }
      verifiedSurvivorCount += 1
      await writeJsonlRow(writer.stream, {
        ...row,
        kind: "tp12_train100_verified_survivor_v1",
        verificationPatchKey: contract.patchKey,
        verificationComplete: true,
        qualityPassed: true,
      })
    }
  } finally {
    await writer.close()
  }

  return writeSummary(outputSummaryPath, {
    kind: "tp12_train100_survivor_verification_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    status: "passed",
    contractPath: resolvedContractPath,
    candidateCatalogPath: sourceCatalogPath,
    outCatalogPath: outputCatalogPath,
    oosRead: false,
    inputCandidateCount: rows.length,
    verifiedSurvivorCount,
    rejectedCandidateCount,
    rejectReasonCounts: Object.fromEntries([...rejectReasonCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  })
}
