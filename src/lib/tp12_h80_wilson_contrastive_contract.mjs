import path from "node:path"

import { readJson, writeJson } from "./io.mjs"
import { toBool, toNumber, toText, validDateKey } from "./tp12_year2hit_foundation_io.mjs"

export const TP12_H80_WILSON_CONTRASTIVE_PATCH_KEY = "tp12_h80_wilson_contrastive_abstention_v1"

const expectDateRange = (range, label, failures) => {
  const from = toText(range?.from)
  const to = toText(range?.to)
  if (!validDateKey(from)) failures.push(`${label}_from_invalid`)
  if (!validDateKey(to)) failures.push(`${label}_to_invalid`)
  if (validDateKey(from) && validDateKey(to) && from > to) failures.push(`${label}_from_after_to`)
  return { from, to }
}

const boolAt = (node, pathKey, fallback = false) => {
  const value = pathKey.split(".").reduce((current, part) => (current && typeof current === "object" ? current[part] : undefined), node)
  return toBool(value, fallback)
}

const numberAt = (node, pathKey, fallback = NaN) => {
  const value = pathKey.split(".").reduce((current, part) => (current && typeof current === "object" ? current[part] : undefined), node)
  return toNumber(value, fallback)
}

const textAt = (node, pathKey) => {
  const value = pathKey.split(".").reduce((current, part) => (current && typeof current === "object" ? current[part] : undefined), node)
  return toText(value)
}

const requireTrue = (contract, pathKey, failures) => {
  if (boolAt(contract, pathKey, false) !== true) failures.push(`${pathKey}_must_be_true`)
}

const requireFalse = (contract, pathKey, failures) => {
  if (boolAt(contract, pathKey, true) !== false) failures.push(`${pathKey}_must_be_false`)
}

const foldYears = (folds) =>
  (Array.isArray(folds) ? folds : [])
    .map((fold) => Number(fold?.validationYear))
    .filter((year) => Number.isInteger(year))
    .sort((left, right) => left - right)

export const assertTp12H80WilsonContrastiveContract = async ({
  contractPath = "",
  outPath = "",
  failOnViolation = true,
} = {}) => {
  if (!toText(contractPath)) throw new Error("contractPath is required")
  if (!toText(outPath)) throw new Error("outPath is required")
  const contract = await readJson(contractPath, null)
  if (!contract) throw new Error(`contract not found: ${contractPath}`)
  const failures = []

  if (toText(contract.patchKey) !== TP12_H80_WILSON_CONTRASTIVE_PATCH_KEY) failures.push("patch_key_mismatch")
  if (toText(contract.kind) !== "tp12_h80_wilson_contrastive_abstention_contract_v1") failures.push("kind_mismatch")
  if (textAt(contract, "objective.mode") !== "abstention_first") failures.push("objective_mode_must_be_abstention_first")
  if (numberAt(contract, "objective.targetWilsonLower95", 0) < 0.8) failures.push("target_wilson_lower95_below_h80")
  if (numberAt(contract, "objective.minSelectedRows", 0) < 100) failures.push("min_selected_rows_below_absolute_floor")
  if (numberAt(contract, "objective.minActiveValidationYears", 0) < 4) failures.push("min_active_validation_years_below_4")

  const trainRange = expectDateRange(contract.trainDateRange, "train_date_range", failures)
  const forbiddenRange = expectDateRange(contract.forbiddenDateRange, "forbidden_date_range", failures)
  if (validDateKey(trainRange.to) && validDateKey(forbiddenRange.from) && trainRange.to >= forbiddenRange.from) {
    failures.push("train_range_overlaps_forbidden_range")
  }
  if (forbiddenRange.from !== "2025-01-02" || forbiddenRange.to !== "2026-04-17") {
    failures.push("forbidden_oos_range_must_match_known_audit_window")
  }

  if (textAt(contract, "label.entryPolicy") !== "GLOBAL_NEXT_SESSION_OPEN") failures.push("entry_policy_must_be_global_next_session_open")
  if (numberAt(contract, "label.targetPct", 0) !== 0.12) failures.push("target_pct_must_be_0p12")
  if (numberAt(contract, "label.holdDays", 0) !== 3) failures.push("hold_days_must_be_3")
  if (textAt(contract, "label.stopPolicy") !== "no_stop") failures.push("stop_policy_must_be_no_stop")
  requireTrue(contract, "label.requireEntryFeasibilitySummary", failures)

  const validationYears = foldYears(contract?.splits?.outerFolds)
  const expectedValidationYears = "2021,2022,2023,2024"
  if (validationYears.join(",") !== expectedValidationYears) failures.push("outer_validation_years_must_be_2021_2024")
  if (numberAt(contract, "splits.purgeTradingDays", 0) < 5) failures.push("purge_trading_days_below_5")
  if (numberAt(contract, "splits.embargoTradingDays", 0) < 5) failures.push("embargo_trading_days_below_5")
  requireTrue(contract, "splits.sameDecisionDateGroupSplit", failures)

  requireTrue(contract, "preflight.failOnOosPath", failures)
  requireTrue(contract, "preflight.requireDataReadiness", failures)
  requireTrue(contract, "preflight.requireAsofSurvivorship", failures)
  requireTrue(contract, "preflight.requireEntryFeasibility", failures)
  requireTrue(contract, "preflight.requireFeatureManifest", failures)
  requireTrue(contract, "preflight.requireSplitManifest", failures)

  requireTrue(contract, "lockRules.emitLockedSelectorRequiresH80Gate", failures)
  requireFalse(contract, "lockRules.oosTuningAllowed", failures)
  requireFalse(contract, "lockRules.fallbackAllowed", failures)
  requireFalse(contract, "lockRules.researchTierOosApplyAllowed", failures)

  if (contract?.featureGroups?.intradayEarlyConfirmation === true) {
    failures.push("intraday_early_confirmation_not_allowed_for_next_open_daily_label")
  }
  if (contract?.featureGroups?.sideDaily === true) {
    failures.push("side_daily_must_not_be_enabled_without_full_asof_coverage")
  }

  const summary = {
    kind: "tp12_h80_wilson_contrastive_contract_assert_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    contractPath: path.resolve(contractPath),
    patchKey: toText(contract.patchKey),
    validationYears,
    targetWilsonLower95: numberAt(contract, "objective.targetWilsonLower95", null),
    minSelectedRows: numberAt(contract, "objective.minSelectedRows", null),
    failures,
  }
  await writeJson(outPath, summary)
  if (summary.status !== "passed" && toBool(failOnViolation, true)) {
    throw new Error(`tp12 H80 Wilson contrastive contract failed: ${failures.join("; ")}`)
  }
  return summary
}
