import { createHash } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"

import { readJson, writeJson } from "./io.mjs"
import {
  incrementMap,
  mapToSortedObject,
  toBool,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
} from "./tp12_year2hit_foundation_io.mjs"
import { sha256TextLines } from "./tp12_year2hit_train_gate.mjs"
import {
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "./tp12_operational_hit_contract.mjs"

export const TP12_PATTERN_BANK_FOLD_MONTHLY_INTEGRATION_KIND =
  "tp12_pattern_bank_fold_monthly_integration_summary_v1"
export const TP12_PATTERN_BANK_FOLD_MONTHLY_INTEGRATION_PATCH_KEY =
  "tp12_pattern_bank_fold_monthly_integration_v1"
export const DEFAULT_TP12_PATTERN_BANK_FOLD_MONTHLY_INTEGRATION_CONTRACT_PATH =
  "meta/tp12_pattern_bank_fold_monthly_integration_contract.json"

const safeRatio = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0)

const sha256File = async (filePath) => createHash("sha256").update(await fsp.readFile(filePath)).digest("hex")

const resolveBool = (value, fallback) => toBool(value, fallback)

const loadContract = async (contractPath) => {
  const resolvedPath = toText(contractPath)
  if (!resolvedPath) return null
  const contract = await readJson(resolvedPath, null)
  if (!contract) throw new Error(`integration contract not found: ${resolvedPath}`)
  if (toText(contract.patchKey) && toText(contract.patchKey) !== TP12_PATTERN_BANK_FOLD_MONTHLY_INTEGRATION_PATCH_KEY) {
    throw new Error(`unexpected integration patchKey: ${contract.patchKey}`)
  }
  return contract
}

const deriveOptionsFromContract = (contract = {}) => {
  const required = contract.requiredInputs ?? {}
  const gates = contract.gates ?? {}
  const hit = contract.hitContract ?? {}
  const ranges = contract.dateRanges ?? {}
  return {
    requiredInputs: {
      patternBankSummary: required.patternBankSummary,
      nonhitPurgeSummary: required.nonhitPurgeSummary,
      foldStabilitySummary: required.foldStabilitySummary,
      monthlyCoverageSummary: required.monthlyCoverageSummary,
      patternBundleSummary: required.patternBundleSummary,
      monthlyQuotaSummary: required.monthlyQuotaSummary,
    },
    lockedFutureFrom: ranges.lockedFuture?.from,
    internalValidationFrom: ranges.internalValidation?.from,
    internalValidationTo: ranges.internalValidation?.to,
    hitDefinition: hit.hitDefinition,
    hitField: hit.hitField,
    minPatternBankSurvivors: gates.minPatternBankSurvivors,
    minNonhitPurgeSurvivors: gates.minNonhitPurgeSurvivors,
    minFoldStablePatterns: gates.minFoldStablePatterns,
    minSelectedPatterns: gates.minSelectedPatterns,
    requireSelectedSubsetOfPatternBank: gates.requireSelectedSubsetOfPatternBank,
    requireSelectedSubsetOfNonhitPurge: gates.requireSelectedSubsetOfNonhitPurge,
    requireSelectedSubsetOfFoldStable: gates.requireSelectedSubsetOfFoldStable,
    requireHashConsistency: gates.requireHashConsistency,
    requireExplicitFullMonthKeys: gates.requireExplicitFullMonthKeys,
    targetRecommendationsPerFullMonth: gates.targetRecommendationsPerFullMonth,
    targetOperationalHitsPerFullMonth: gates.targetOperationalHitsPerFullMonth,
    minOperationalPrecision: gates.minOperationalPrecision,
    maxOperationalMissRows: gates.maxOperationalMissRows,
    maxNonExecutableRows: gates.maxNonExecutableRows,
    requireMonthlyCoveragePassed: gates.requireMonthlyCoveragePassed,
    requireMonthlyQuotaPassedWhenProvided: gates.requireMonthlyQuotaPassedWhenProvided,
    failOnGateFailure: gates.failOnGateFailure,
  }
}

const resolveOptions = ({ contract, ...raw } = {}) => {
  const contractOptions = contract ? deriveOptionsFromContract(contract) : {}
  const requiredInputs = contractOptions.requiredInputs ?? {}
  return {
    requiredInputs: {
      patternBankSummary: resolveBool(raw.requirePatternBankSummary ?? requiredInputs.patternBankSummary, true),
      nonhitPurgeSummary: resolveBool(raw.requireNonhitPurgeSummary ?? requiredInputs.nonhitPurgeSummary, true),
      foldStabilitySummary: resolveBool(raw.requireFoldStabilitySummary ?? requiredInputs.foldStabilitySummary, true),
      monthlyCoverageSummary: resolveBool(raw.requireMonthlyCoverageSummary ?? requiredInputs.monthlyCoverageSummary, true),
      patternBundleSummary: resolveBool(raw.requirePatternBundleSummary ?? requiredInputs.patternBundleSummary, false),
      monthlyQuotaSummary: resolveBool(raw.requireMonthlyQuotaSummary ?? requiredInputs.monthlyQuotaSummary, false),
    },
    lockedFutureFrom: toText(raw.lockedFutureFrom ?? contractOptions.lockedFutureFrom ?? "2025-01-02"),
    internalValidationFrom: toText(raw.internalValidationFrom ?? contractOptions.internalValidationFrom ?? "2016-01-01"),
    internalValidationTo: toText(raw.internalValidationTo ?? contractOptions.internalValidationTo ?? "2024-12-31"),
    hitDefinition: toText(raw.hitDefinition ?? contractOptions.hitDefinition ?? TP12_OPERATIONAL_HIT_DEFINITION),
    hitField: toText(raw.hitField ?? contractOptions.hitField ?? TP12_OPERATIONAL_HIT_FIELD),
    minPatternBankSurvivors: Math.max(0, Math.trunc(toNumber(raw.minPatternBankSurvivors ?? contractOptions.minPatternBankSurvivors, 1))),
    minNonhitPurgeSurvivors: Math.max(0, Math.trunc(toNumber(raw.minNonhitPurgeSurvivors ?? contractOptions.minNonhitPurgeSurvivors, 1))),
    minFoldStablePatterns: Math.max(0, Math.trunc(toNumber(raw.minFoldStablePatterns ?? contractOptions.minFoldStablePatterns, 1))),
    minSelectedPatterns: Math.max(0, Math.trunc(toNumber(raw.minSelectedPatterns ?? contractOptions.minSelectedPatterns, 2))),
    requireSelectedSubsetOfPatternBank: resolveBool(
      raw.requireSelectedSubsetOfPatternBank ?? contractOptions.requireSelectedSubsetOfPatternBank,
      true,
    ),
    requireSelectedSubsetOfNonhitPurge: resolveBool(
      raw.requireSelectedSubsetOfNonhitPurge ?? contractOptions.requireSelectedSubsetOfNonhitPurge,
      true,
    ),
    requireSelectedSubsetOfFoldStable: resolveBool(
      raw.requireSelectedSubsetOfFoldStable ?? contractOptions.requireSelectedSubsetOfFoldStable,
      true,
    ),
    requireHashConsistency: resolveBool(raw.requireHashConsistency ?? contractOptions.requireHashConsistency, true),
    requireExplicitFullMonthKeys: resolveBool(
      raw.requireExplicitFullMonthKeys ?? contractOptions.requireExplicitFullMonthKeys,
      true,
    ),
    targetRecommendationsPerFullMonth: Math.max(
      1,
      Math.trunc(toNumber(raw.targetRecommendationsPerFullMonth ?? contractOptions.targetRecommendationsPerFullMonth, 5)),
    ),
    targetOperationalHitsPerFullMonth: Math.max(
      1,
      Math.trunc(toNumber(raw.targetOperationalHitsPerFullMonth ?? contractOptions.targetOperationalHitsPerFullMonth, 5)),
    ),
    minOperationalPrecision: Math.min(
      1,
      Math.max(0, toNumber(raw.minOperationalPrecision ?? contractOptions.minOperationalPrecision, 1)),
    ),
    maxOperationalMissRows: Math.max(
      0,
      Math.trunc(toNumber(raw.maxOperationalMissRows ?? contractOptions.maxOperationalMissRows, 0)),
    ),
    maxNonExecutableRows: Math.max(
      0,
      Math.trunc(toNumber(raw.maxNonExecutableRows ?? contractOptions.maxNonExecutableRows, 0)),
    ),
    requireMonthlyCoveragePassed: resolveBool(
      raw.requireMonthlyCoveragePassed ?? contractOptions.requireMonthlyCoveragePassed,
      true,
    ),
    requireMonthlyQuotaPassedWhenProvided: resolveBool(
      raw.requireMonthlyQuotaPassedWhenProvided ?? contractOptions.requireMonthlyQuotaPassedWhenProvided,
      true,
    ),
    failOnGateFailure: resolveBool(raw.failOnGateFailure ?? contractOptions.failOnGateFailure, true),
  }
}

const assertOptions = (options) => {
  if (options.hitDefinition !== TP12_OPERATIONAL_HIT_DEFINITION) {
    throw new Error(`integration gate requires hitDefinition=${TP12_OPERATIONAL_HIT_DEFINITION}`)
  }
  if (options.hitField !== TP12_OPERATIONAL_HIT_FIELD) {
    throw new Error(`integration gate requires hitField=${TP12_OPERATIONAL_HIT_FIELD}`)
  }
  if (!validDateKey(options.lockedFutureFrom)) throw new Error(`invalid lockedFutureFrom: ${options.lockedFutureFrom}`)
  if (!validDateKey(options.internalValidationFrom) || !validDateKey(options.internalValidationTo)) {
    throw new Error("internal validation range must use YYYY-MM-DD dates")
  }
  if (options.internalValidationFrom > options.internalValidationTo) {
    throw new Error(`invalid internal validation range: ${options.internalValidationFrom}..${options.internalValidationTo}`)
  }
  if (options.internalValidationTo >= options.lockedFutureFrom) {
    throw new Error("internal validation range must end before lockedFutureFrom")
  }
}

const readSummary = async ({ filePath, label, required }) => {
  const resolvedPath = toText(filePath)
  if (!resolvedPath) {
    if (required) throw new Error(`${label} path is required`)
    return null
  }
  if (!fs.existsSync(resolvedPath)) throw new Error(`${label} not found: ${resolvedPath}`)
  const summary = await readJson(resolvedPath, null)
  if (!summary) throw new Error(`${label} is empty or invalid JSON: ${resolvedPath}`)
  return {
    label,
    path: path.resolve(resolvedPath),
    sha256: await sha256File(resolvedPath),
    summary,
  }
}

const asList = (value) => (Array.isArray(value) ? uniqueSorted(value) : [])

const getPatternBankIds = (summary) => asList(summary?.survivorPatternIds)
const getNonhitIds = (summary) => asList(summary?.survivorPatternIds)
const getFoldStableIds = (summary) => asList(summary?.stablePatternIds)

const getBundleSelectedIds = (summary) =>
  asList(summary?.selectedPatternIds ?? summary?.bundle?.selectedPatternIds ?? summary?.bundle?.patternIds)

const getMonthlySelectedIds = (summary) => asList(summary?.selectedPatternIds ?? summary?.bundle?.selectedPatternIds)

const assertSha = ({ ids, expected, label, failures, details, options }) => {
  if (!options.requireHashConsistency) return
  const expectedText = toText(expected)
  if (!expectedText) return
  const actual = sha256TextLines(ids)
  details.push({ label, expected: expectedText, actual, status: actual === expectedText ? "passed" : "failed" })
  if (actual !== expectedText) failures.push(`${label}_sha256_mismatch`)
}

const addStatusFailure = ({ item, failures }) => {
  if (!item) return
  const status = toText(item.summary?.status)
  if (status && status !== "passed") failures.push(`${item.label}_not_passed`)
}

const addHitContractFailure = ({ item, options, failures }) => {
  if (!item) return
  const definition = toText(item.summary?.hitDefinition)
  const field = toText(item.summary?.hitField)
  if (definition && definition !== options.hitDefinition) failures.push(`${item.label}_hit_definition_mismatch`)
  if (field && field !== options.hitField) failures.push(`${item.label}_hit_field_mismatch`)
}

const summaryDateRange = (summary = {}) => ({
  from: toText(summary.dateRange?.from ?? summary.internalValidationDateRange?.from),
  to: toText(summary.dateRange?.to ?? summary.internalValidationDateRange?.to),
  lockedFutureFrom: toText(summary.dateRange?.lockedFutureFrom ?? summary.lockedFutureFrom),
})

const addDateRangeFailure = ({ item, options, failures }) => {
  if (!item) return
  const range = summaryDateRange(item.summary)
  if (range.lockedFutureFrom && range.lockedFutureFrom !== options.lockedFutureFrom) {
    failures.push(`${item.label}_locked_future_mismatch`)
  }
  if (range.to && validDateKey(range.to) && range.to >= options.lockedFutureFrom) {
    failures.push(`${item.label}_date_range_enters_locked_future`)
  }
  if (range.from && validDateKey(range.from) && range.from < options.internalValidationFrom) {
    failures.push(`${item.label}_date_range_before_internal_validation`)
  }
}

const subsetCheck = ({ sourceIds, allowedIds, label, allowedLabel }) => {
  const allowed = new Set(allowedIds)
  const missing = sourceIds.filter((id) => !allowed.has(id))
  return {
    label,
    allowedLabel,
    sourceCount: sourceIds.length,
    allowedCount: allowedIds.length,
    missing,
    status: missing.length > 0 ? "failed" : "passed",
  }
}

const addSubsetFailure = ({ check, failures }) => {
  if (check.status === "failed") failures.push(`${check.label}_not_subset_of_${check.allowedLabel}`)
}

const buildMonthlyCoverageCheck = ({ item, options, failures }) => {
  if (!item) return null
  const summary = item.summary
  const metrics = summary.bundle?.unionMetrics ?? {}
  const stats = Array.isArray(metrics.monthlyStats) ? metrics.monthlyStats : []
  const fullMonthKeys = asList(summary.fullMonthKeys)
  const statsByMonth = new Map(stats.map((row) => [toText(row.monthKey), row]))
  const rejectReasons = []
  if (options.requireMonthlyCoveragePassed && toText(summary.status) !== "passed") {
    rejectReasons.push("monthly_coverage_summary_not_passed")
  }
  if (options.requireExplicitFullMonthKeys && fullMonthKeys.length < 1) rejectReasons.push("monthly_full_month_keys_missing")
  if (toNumber(metrics.operationalPrecision, 0) < options.minOperationalPrecision) {
    rejectReasons.push("monthly_operational_precision_below_min")
  }
  if (toNumber(metrics.operationalMissRows, 0) > options.maxOperationalMissRows) {
    rejectReasons.push("monthly_operational_miss_rows_above_max")
  }
  if (toNumber(metrics.nonExecutableRows, 0) > options.maxNonExecutableRows) {
    rejectReasons.push("monthly_non_executable_rows_above_max")
  }
  if (toNumber(metrics.minRecommendationsPerFullMonth, 0) < options.targetRecommendationsPerFullMonth) {
    rejectReasons.push("monthly_min_recommendations_below_target")
  }
  if (toNumber(metrics.minOperationalHitsPerFullMonth, 0) < options.targetOperationalHitsPerFullMonth) {
    rejectReasons.push("monthly_min_operational_hits_below_target")
  }
  for (const monthKey of fullMonthKeys) {
    const row = statsByMonth.get(monthKey)
    if (!row) {
      rejectReasons.push(`monthly_stats_missing:${monthKey}`)
      continue
    }
    if (toNumber(row.recommendationRows, 0) < options.targetRecommendationsPerFullMonth) {
      rejectReasons.push(`monthly_recommendations_below_target:${monthKey}`)
    }
    if (toNumber(row.operationalHitRows, 0) < options.targetOperationalHitsPerFullMonth) {
      rejectReasons.push(`monthly_operational_hits_below_target:${monthKey}`)
    }
    if (toNumber(row.operationalMissRows, 0) > options.maxOperationalMissRows) {
      rejectReasons.push(`monthly_operational_misses_above_max:${monthKey}`)
    }
  }
  failures.push(...rejectReasons.map((reason) => `monthly_coverage_${reason}`))
  return {
    status: rejectReasons.length > 0 ? "failed" : "passed",
    selectedPatternIds: getMonthlySelectedIds(summary),
    fullMonthKeys,
    fullMonthCount: fullMonthKeys.length,
    unionRowCount: toNumber(summary.unionRowCount ?? metrics.totalRows, 0),
    operationalPrecision: toNumber(metrics.operationalPrecision, 0),
    operationalMissRows: toNumber(metrics.operationalMissRows, 0),
    nonExecutableRows: toNumber(metrics.nonExecutableRows, 0),
    minRecommendationsPerFullMonth: toNumber(metrics.minRecommendationsPerFullMonth, 0),
    minOperationalHitsPerFullMonth: toNumber(metrics.minOperationalHitsPerFullMonth, 0),
    rejectReasons,
  }
}

const buildMonthlyQuotaCheck = ({ item, options, failures }) => {
  if (!item) return null
  const summary = item.summary
  const rejectReasons = []
  if (options.requireMonthlyQuotaPassedWhenProvided && toText(summary.status) !== "passed") {
    rejectReasons.push("monthly_quota_summary_not_passed")
  }
  for (const row of Array.isArray(summary.monthlyDiagnostics) ? summary.monthlyDiagnostics : []) {
    const monthKey = toText(row.monthKey)
    if (toNumber(row.selectedRows, 0) < options.targetRecommendationsPerFullMonth) {
      rejectReasons.push(`monthly_quota_selected_rows_below_target:${monthKey}`)
    }
    if (toNumber(row.executableRecommendationCount, 0) < options.targetRecommendationsPerFullMonth) {
      rejectReasons.push(`monthly_quota_executable_rows_below_target:${monthKey}`)
    }
  }
  failures.push(...rejectReasons)
  return {
    status: rejectReasons.length > 0 ? "failed" : "passed",
    selectedRowCount: toNumber(summary.selectedRowCount, 0),
    rejectReasons,
  }
}

const buildIntegrationGateHash = ({ items, selectedPatternIds, foldAuditHash, options }) =>
  sha256TextLines([
    TP12_PATTERN_BANK_FOLD_MONTHLY_INTEGRATION_PATCH_KEY,
    options.hitDefinition,
    options.hitField,
    options.lockedFutureFrom,
    sha256TextLines(selectedPatternIds),
    foldAuditHash,
    ...items.filter(Boolean).map((item) => `${item.label}\t${item.sha256}`),
  ])

export const buildTp12PatternBankFoldMonthlyIntegration = async ({
  contractPath = DEFAULT_TP12_PATTERN_BANK_FOLD_MONTHLY_INTEGRATION_CONTRACT_PATH,
  patternBankSummaryPath = "",
  nonhitPurgeSummaryPath = "",
  foldStabilitySummaryPath = "",
  monthlyCoverageSummaryPath = "",
  patternBundleSummaryPath = "",
  monthlyQuotaSummaryPath = "",
  outSummaryPath,
  ...rawOptions
} = {}) => {
  if (!toText(outSummaryPath)) throw new Error("outSummaryPath is required")
  const contract = await loadContract(contractPath)
  const options = resolveOptions({ contract, ...rawOptions })
  assertOptions(options)

  const patternBank = await readSummary({
    filePath: patternBankSummaryPath,
    label: "patternBankSummary",
    required: options.requiredInputs.patternBankSummary,
  })
  const nonhitPurge = await readSummary({
    filePath: nonhitPurgeSummaryPath,
    label: "nonhitPurgeSummary",
    required: options.requiredInputs.nonhitPurgeSummary,
  })
  const foldStability = await readSummary({
    filePath: foldStabilitySummaryPath,
    label: "foldStabilitySummary",
    required: options.requiredInputs.foldStabilitySummary,
  })
  const monthlyCoverage = await readSummary({
    filePath: monthlyCoverageSummaryPath,
    label: "monthlyCoverageSummary",
    required: options.requiredInputs.monthlyCoverageSummary,
  })
  const patternBundle = await readSummary({
    filePath: patternBundleSummaryPath,
    label: "patternBundleSummary",
    required: options.requiredInputs.patternBundleSummary,
  })
  const monthlyQuota = await readSummary({
    filePath: monthlyQuotaSummaryPath,
    label: "monthlyQuotaSummary",
    required: options.requiredInputs.monthlyQuotaSummary,
  })
  const items = [patternBank, nonhitPurge, foldStability, monthlyCoverage, patternBundle, monthlyQuota].filter(Boolean)
  const failures = []
  for (const item of items) {
    addStatusFailure({ item, failures })
    addHitContractFailure({ item, options, failures })
    addDateRangeFailure({ item, options, failures })
  }

  const patternBankIds = patternBank ? getPatternBankIds(patternBank.summary) : []
  const nonhitIds = nonhitPurge ? getNonhitIds(nonhitPurge.summary) : []
  const foldStableIds = foldStability ? getFoldStableIds(foldStability.summary) : []
  const monthlySelectedIds = monthlyCoverage ? getMonthlySelectedIds(monthlyCoverage.summary) : []
  const bundleSelectedIds = patternBundle ? getBundleSelectedIds(patternBundle.summary) : []
  const selectedPatternIds = monthlySelectedIds.length > 0 ? monthlySelectedIds : bundleSelectedIds
  const selectedSource = monthlySelectedIds.length > 0 ? "monthlyCoverageSummary" : "patternBundleSummary"

  const hashChecks = []
  if (patternBank) {
    assertSha({
      ids: patternBankIds,
      expected: patternBank.summary.survivorPatternIdsSha256,
      label: "pattern_bank_survivor_ids",
      failures,
      details: hashChecks,
      options,
    })
  }
  if (nonhitPurge) {
    assertSha({
      ids: nonhitIds,
      expected: nonhitPurge.summary.survivorPatternIdsSha256,
      label: "nonhit_purge_survivor_ids",
      failures,
      details: hashChecks,
      options,
    })
  }
  if (foldStability) {
    assertSha({
      ids: foldStableIds,
      expected: foldStability.summary.selectedPatternIdsSha256,
      label: "fold_stable_pattern_ids",
      failures,
      details: hashChecks,
      options,
    })
  }
  if (monthlyCoverage) {
    assertSha({
      ids: monthlySelectedIds,
      expected: monthlyCoverage.summary.selectedPatternIdsSha256,
      label: "monthly_selected_pattern_ids",
      failures,
      details: hashChecks,
      options,
    })
  }
  if (patternBundle) {
    assertSha({
      ids: bundleSelectedIds,
      expected: patternBundle.summary.selectedPatternIdsSha256,
      label: "bundle_selected_pattern_ids",
      failures,
      details: hashChecks,
      options,
    })
  }

  if (patternBankIds.length < options.minPatternBankSurvivors) failures.push("pattern_bank_survivors_below_min")
  if (nonhitIds.length < options.minNonhitPurgeSurvivors) failures.push("nonhit_purge_survivors_below_min")
  if (foldStableIds.length < options.minFoldStablePatterns) failures.push("fold_stable_patterns_below_min")
  if (selectedPatternIds.length < options.minSelectedPatterns) failures.push("selected_patterns_below_min")

  const subsetChecks = []
  if (nonhitIds.length > 0 && patternBankIds.length > 0) {
    const check = subsetCheck({
      sourceIds: nonhitIds,
      allowedIds: patternBankIds,
      label: "nonhit_purge_survivors",
      allowedLabel: "pattern_bank_survivors",
    })
    subsetChecks.push(check)
    addSubsetFailure({ check, failures })
  }
  if (options.requireSelectedSubsetOfPatternBank && patternBankIds.length > 0) {
    const check = subsetCheck({
      sourceIds: selectedPatternIds,
      allowedIds: patternBankIds,
      label: "selected_patterns",
      allowedLabel: "pattern_bank_survivors",
    })
    subsetChecks.push(check)
    addSubsetFailure({ check, failures })
  }
  if (options.requireSelectedSubsetOfNonhitPurge && nonhitIds.length > 0) {
    const check = subsetCheck({
      sourceIds: selectedPatternIds,
      allowedIds: nonhitIds,
      label: "selected_patterns",
      allowedLabel: "nonhit_purge_survivors",
    })
    subsetChecks.push(check)
    addSubsetFailure({ check, failures })
  }
  if (options.requireSelectedSubsetOfFoldStable && foldStableIds.length > 0) {
    const check = subsetCheck({
      sourceIds: selectedPatternIds,
      allowedIds: foldStableIds,
      label: "selected_patterns",
      allowedLabel: "fold_stable_patterns",
    })
    subsetChecks.push(check)
    addSubsetFailure({ check, failures })
  }
  if (patternBundle && bundleSelectedIds.length > 0 && foldStableIds.length > 0) {
    const check = subsetCheck({
      sourceIds: bundleSelectedIds,
      allowedIds: foldStableIds,
      label: "bundle_selected_patterns",
      allowedLabel: "fold_stable_patterns",
    })
    subsetChecks.push(check)
    addSubsetFailure({ check, failures })
  }

  const monthlyCoverageCheck = buildMonthlyCoverageCheck({ item: monthlyCoverage, options, failures })
  const monthlyQuotaCheck = buildMonthlyQuotaCheck({ item: monthlyQuota, options, failures })
  const failureCounts = new Map()
  for (const failure of failures) incrementMap(failureCounts, failure)
  const selectedPatternIdsSha256 = sha256TextLines(selectedPatternIds)
  const foldAuditHash = toText(foldStability?.summary?.foldAuditHash)
  const integrationGateHash = buildIntegrationGateHash({
    items,
    selectedPatternIds,
    foldAuditHash,
    options,
  })
  const payload = {
    kind: TP12_PATTERN_BANK_FOLD_MONTHLY_INTEGRATION_KIND,
    patchKey: TP12_PATTERN_BANK_FOLD_MONTHLY_INTEGRATION_PATCH_KEY,
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    verdict: failures.length > 0 ? "not_ready_for_locked_future_eval" : "train_pattern_bank_monthly_integration_passed",
    contractPath: contractPath ? path.resolve(contractPath) : null,
    hitDefinition: options.hitDefinition,
    hitField: options.hitField,
    lockedFutureFrom: options.lockedFutureFrom,
    inputSummaries: Object.fromEntries(items.map((item) => [item.label, { path: item.path, sha256: item.sha256 }])),
    counts: {
      patternBankSurvivorCount: patternBankIds.length,
      nonhitPurgeSurvivorCount: nonhitIds.length,
      foldStablePatternCount: foldStableIds.length,
      selectedPatternCount: selectedPatternIds.length,
    },
    finalSelection: {
      source: selectedSource,
      selectedPatternIds,
      selectedPatternIdsSha256,
    },
    patternBankSurvivorPatternIdsSha256: sha256TextLines(patternBankIds),
    nonhitPurgeSurvivorPatternIdsSha256: sha256TextLines(nonhitIds),
    foldStablePatternIdsSha256: sha256TextLines(foldStableIds),
    foldAuditHash,
    integrationGateHash,
    subsetChecks,
    hashChecks,
    monthlyCoverageCheck,
    monthlyQuotaCheck,
    failureCounts: mapToSortedObject(failureCounts),
    failures: uniqueSorted(failures),
    options,
  }
  await writeJson(outSummaryPath, payload)
  if (payload.status !== "passed" && options.failOnGateFailure) {
    throw new Error(`tp12 pattern bank/fold/monthly integration failed: ${payload.failures.join("; ")}`)
  }
  return payload
}
