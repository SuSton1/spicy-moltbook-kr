import path from "node:path"

import { readJson } from "./io.mjs"

export const TP12_PROBE_CONTRACT = Object.freeze({
  splitPolicy: "strict_label_boundary",
  discoveryUniverseId: "recent_impulse_upto_1d",
  requestedLookbackTradingDays: 1,
  entry: "NEXT_DAY_OPEN",
  holdDays: 3,
  targetPct: 0.12,
  stopLossPct: 0.04,
  maxSearchStates: 200000,
})

export const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export const toNullableNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

export const round = (value, digits = 6) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null
}

export const pct = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(2)}%` : "n/a"
}

export const delta = (left, right, digits = 6) => {
  const a = Number(left)
  const b = Number(right)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Number((a - b).toFixed(digits))
}

export const ratio = (numerator, denominator, digits = 6) => {
  const a = Number(numerator)
  const b = Number(denominator)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null
  return Number((a / b).toFixed(digits))
}

export const buildTp12ProbeRunPaths = ({ cwd, runId }) => {
  const runDir = path.join(cwd, "artifacts", "runs", runId)
  return {
    runDir,
    indexSummaryPath: path.join(runDir, "step-perfect-prototype-index-train", "summary.json"),
    tokenizerSpecPath: path.join(runDir, "step-perfect-prototype-index-train", "tokenizer_spec.json"),
    trainSummaryPath: path.join(runDir, "step-perfect-prototype-train", "summary.json"),
    trainCatalogPath: path.join(runDir, "step-perfect-prototype-train", "catalog.json"),
    noRulesSummaryPath: path.join(runDir, "no_rules_summary.json"),
    noSubgroupSummaryPath: path.join(runDir, "no_subgroup_summary.json"),
    freezeResultPath: path.join(runDir, "freeze_result.json"),
    selectionGuardrailPath: path.join(
      runDir,
      "step-perfect-prototype-open-eval-report",
      "selection_guardrail_summary.json",
    ),
    selectionLeaderboardPath: path.join(
      runDir,
      "step-perfect-prototype-open-eval-report",
      "selection_leaderboard.json",
    ),
    openEvalManifestPath: path.join(
      runDir,
      "step-perfect-prototype-open-eval-report",
      "open_eval_manifest.json",
    ),
  }
}

const deriveStatus = ({ selectionGuardrailSummary, freezeResult, noRulesSummary, noSubgroupSummary, exitCode }) => {
  if (selectionGuardrailSummary) return "completed"
  if (noSubgroupSummary) return "no_subgroups"
  if (noRulesSummary) return "no_rules"
  if (freezeResult?.status) return String(freezeResult.status)
  if (exitCode === 0) return "completed_without_report"
  if (exitCode === 42) return "no_rules_or_no_subgroups"
  return "failed"
}

const buildRuleTokenStats = (catalogRules) => {
  const out = new Map()
  for (const rule of Array.isArray(catalogRules) ? catalogRules : []) {
    const ruleId = toText(rule?.ruleId)
    if (!ruleId) continue
    const tokens = Array.isArray(rule?.tokens) ? rule.tokens.map((token) => String(token)) : []
    out.set(ruleId, {
      intervalAtomCount: tokens.filter((token) => token.startsWith("ival:")).length,
      macroAtomCount: tokens.filter((token) => token.startsWith("macro:")).length,
    })
  }
  return out
}

const buildFamilyRuleCounts = (rows) => {
  const counts = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const familyId = toText(row?.familyId) ?? "unknown"
    counts.set(familyId, toNumber(counts.get(familyId), 0) + 1)
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((left, right) => left[0].localeCompare(right[0])))
}

export const summarizeTp12ProbeVariant = async ({ cwd, runId, exitCode, wallClockSec, label }) => {
  const paths = buildTp12ProbeRunPaths({ cwd, runId })
  const [
    indexSummary,
    tokenizerSpec,
    trainSummary,
    trainCatalog,
    noRulesSummary,
    noSubgroupSummary,
    freezeResult,
    selectionGuardrailSummary,
    selectionLeaderboard,
    openEvalManifest,
  ] = await Promise.all([
    readJson(paths.indexSummaryPath, null),
    readJson(paths.tokenizerSpecPath, null),
    readJson(paths.trainSummaryPath, null),
    readJson(paths.trainCatalogPath, null),
    readJson(paths.noRulesSummaryPath, null),
    readJson(paths.noSubgroupSummaryPath, null),
    readJson(paths.freezeResultPath, null),
    readJson(paths.selectionGuardrailPath, null),
    readJson(paths.selectionLeaderboardPath, []),
    readJson(paths.openEvalManifestPath, null),
  ])
  const rows = Array.isArray(selectionLeaderboard) ? selectionLeaderboard : []
  const catalogRules = Array.isArray(trainCatalog?.rules) ? trainCatalog.rules : []
  const ruleTokenStats = buildRuleTokenStats(catalogRules)
  const status = deriveStatus({
    selectionGuardrailSummary,
    freezeResult,
    noRulesSummary,
    noSubgroupSummary,
    exitCode,
  })
  const breadthFloorRows = rows.filter(
    (row) =>
      toNumber(row?.trainMatchedDateCount, 0) >= 4 &&
      toNumber(row?.trainMatchedMonthCount, 0) >= 4 &&
      toNumber(row?.trainMatchedFoldCount, 0) >= 3,
  )
  const broadTrainRows = rows.filter(
    (row) =>
      toNumber(row?.trainMatchedDateCount, 0) >= 10 &&
      toNumber(row?.trainMatchedMonthCount, 0) >= 6 &&
      toNumber(row?.trainMatchedFoldCount, 0) >= 4,
  )
  const oosPerfectRows = rows.filter(
    (row) => toNumber(row?.openOosMatchCount, 0) > 0 && toNumber(row?.openOosNegativeCount, 0) === 0,
  )
  const oosPerfectDateFloor3Rows = oosPerfectRows.filter(
    (row) => toNumber(row?.openOosHitCount, 0) >= 3 && toNumber(row?.openOosUniqueMatchedDates, 0) >= 3,
  )
  const oosPerfectDateFloor4Rows = oosPerfectRows.filter(
    (row) => toNumber(row?.openOosHitCount, 0) >= 4 && toNumber(row?.openOosUniqueMatchedDates, 0) >= 4,
  )
  const intervalRows = catalogRules.filter(
    (rule) => toNumber(ruleTokenStats.get(toText(rule?.ruleId))?.intervalAtomCount, 0) > 0,
  )
  const macroRows = catalogRules.filter(
    (rule) => toNumber(ruleTokenStats.get(toText(rule?.ruleId))?.macroAtomCount, 0) > 0,
  )
  const atomspaceRows = catalogRules.filter((rule) => {
    const tokenStats = ruleTokenStats.get(toText(rule?.ruleId))
    return toNumber(tokenStats?.intervalAtomCount, 0) > 0 || toNumber(tokenStats?.macroAtomCount, 0) > 0
  })
  const indexPhaseTimings = indexSummary?.phaseTimings ?? {}
  const candidateCostTotalMs =
    toNumber(trainSummary?.candidateDescriptorBuildMs, 0) +
    toNumber(trainSummary?.childRowsetMaterializeMs, 0) +
    toNumber(trainSummary?.rowsetIntersectionMs, 0)
  const surfaceName =
    toText(tokenizerSpec?.surface) ??
    toText(tokenizerSpec?.surfaceName) ??
    toText(tokenizerSpec?.options?.surfaceName)
  const selectionLineId =
    toText(openEvalManifest?.lineId) ??
    toText(openEvalManifest?.selectionLineId) ??
    toText(openEvalManifest?.baselineLineId)

  let bestRule = null
  if (rows[0]) {
    const ruleId = toText(rows[0].ruleId)
    const bestRuleTokenStats = ruleId ? ruleTokenStats.get(ruleId) ?? null : null
    bestRule = {
      ruleId,
      familyId: toText(rows[0].familyId),
      openOosPrecision: round(rows[0].openOosPrecision),
      openOosHitCount: toNumber(rows[0].openOosHitCount, 0),
      openOosMatchCount: toNumber(rows[0].openOosMatchCount, 0),
      openOosUniqueMatchedDates: toNumber(rows[0].openOosUniqueMatchedDates, 0),
      trainMatchedDateCount: toNumber(rows[0].trainMatchedDateCount, 0),
      trainMatchedMonthCount: toNumber(rows[0].trainMatchedMonthCount, 0),
      trainMatchedFoldCount: toNumber(rows[0].trainMatchedFoldCount, 0),
      intervalAtomCount: toNumber(bestRuleTokenStats?.intervalAtomCount, toNumber(rows[0].intervalAtomCount, 0)),
      macroAtomCount: toNumber(bestRuleTokenStats?.macroAtomCount, toNumber(rows[0].macroAtomCount, 0)),
    }
  }

  return {
    label,
    runId,
    exitCode,
    status,
    paths,
    tokenizerSurface: surfaceName,
    selectionLineId,
    conditionLanguage: {
      enableIntervalAtoms: tokenizerSpec?.options?.enableIntervalAtoms === true,
      enableMacroAtoms: tokenizerSpec?.options?.enableMacroAtoms === true,
      enableSupportAnchorAtoms: tokenizerSpec?.options?.enableSupportAnchorAtoms === true,
      enableSupportManifoldSignature: tokenizerSpec?.options?.enableSupportManifoldSignature === true,
      enableSupportMetricFeatures: tokenizerSpec?.options?.enableSupportMetricFeatures === true,
      enableAdaptiveThresholdAtoms: tokenizerSpec?.options?.enableAdaptiveThresholdAtoms === true,
    },
    speed: {
      wrapperWallClockSec: toNullableNumber(wallClockSec),
      indexElapsedSec: round(indexSummary?.elapsedSec),
      indexMaxRssKb: toNullableNumber(indexSummary?.maxRssKb),
      indexHashInputSec: round(indexPhaseTimings?.hashInputSec),
      indexReadJsonlSec: round(indexPhaseTimings?.readJsonlSec),
      indexBuildTokenizerSpecSec: round(indexPhaseTimings?.buildTokenizerSpecSec),
      indexTokenizeRowsSec: round(indexPhaseTimings?.tokenizeRowsSec),
      indexBuildTokenStatsSec: round(indexPhaseTimings?.buildTokenStatsSec),
      indexBuildIndexSec: round(indexPhaseTimings?.buildIndexSec),
      trainRules: toNumber(trainSummary?.rules, 0),
      trainExploredStates: toNumber(trainSummary?.exploredStates, 0),
      trainSelectedSeedCount: toNumber(trainSummary?.selectedSeedCount, 0),
      trainDictionaryLoadMs: toNumber(trainSummary?.dictionaryLoadMs, 0),
      trainCandidateDescriptorBuildMs: toNumber(trainSummary?.candidateDescriptorBuildMs, 0),
      trainChildRowsetMaterializeMs: toNumber(trainSummary?.childRowsetMaterializeMs, 0),
      trainRowsetIntersectionMs: toNumber(trainSummary?.rowsetIntersectionMs, 0),
      trainCandidateDescriptorCount: toNumber(trainSummary?.candidateDescriptorCount, 0),
      trainAcceptedCandidateCount: toNumber(trainSummary?.acceptedCandidateCount, 0),
      trainCandidateEfficiency: round(
        trainSummary?.candidateEfficiency ??
          ratio(
            toNumber(trainSummary?.acceptedCandidateCount, 0),
            Math.max(1, toNumber(trainSummary?.candidateDescriptorCount, 0)),
          ),
      ),
      trainBoundPruneCount: toNumber(trainSummary?.boundPruneCount, 0),
      trainPromotableUpperBoundPruneCount: toNumber(
        trainSummary?.rejectionSummary?.promotableUpperBoundPruneCount ??
          trainSummary?.promotableUpperBoundPruneCount,
        0,
      ),
      trainSeedPromotableUpperBoundPruneCount: toNumber(
        trainSummary?.rejectionSummary?.seedPromotableUpperBoundPruneCount ??
          trainSummary?.seedPromotableUpperBoundPruneCount,
        0,
      ),
      trainStatePromotableUpperBoundPruneCount: toNumber(
        trainSummary?.rejectionSummary?.statePromotableUpperBoundPruneCount ??
          trainSummary?.statePromotableUpperBoundPruneCount,
        0,
      ),
      trainCandidatePromotableUpperBoundPruneCount: toNumber(
        trainSummary?.rejectionSummary?.candidatePromotableUpperBoundPruneCount ??
          trainSummary?.candidatePromotableUpperBoundPruneCount,
        0,
      ),
      trainStateDominancePruneCount: toNumber(trainSummary?.stateDominancePruneCount, 0),
      trainSearchBelowMinHitCount: toNumber(trainSummary?.searchBelowMinHitCount, 0),
      trainCandidateCostTotalMs: candidateCostTotalMs,
      trainCandidateCostMsPer1kStates: round(
        ratio(candidateCostTotalMs, Math.max(1, toNumber(trainSummary?.exploredStates, 0)) / 1000),
      ),
      trainRulesPer100kStates: round(
        ratio(toNumber(trainSummary?.rules, 0), Math.max(1, toNumber(trainSummary?.exploredStates, 0)) / 100000),
      ),
      runtimePerPromotableRuleMs: round(
        ratio(candidateCostTotalMs, Math.max(1, broadTrainRows.length)),
      ),
    },
    quality: {
      minedRuleCount: catalogRules.length || toNumber(trainSummary?.rules, 0),
      familyCount: toNumber(selectionGuardrailSummary?.familyCount, 0),
      familyRuleCounts: buildFamilyRuleCounts(rows),
      trainBreadthQualifiedRuleCount: breadthFloorRows.length,
      trainPromotableBreadthRuleCount: broadTrainRows.length,
      promotableRuleYield: round(ratio(broadTrainRows.length, Math.max(1, catalogRules.length || toNumber(trainSummary?.rules, 0)))),
      openOosMatchedRules: toNumber(selectionGuardrailSummary?.openOosMatchedRules, 0),
      zeroNegativeRuleCount: toNumber(selectionGuardrailSummary?.zeroNegativeRuleCount, 0),
      hit3ZeroNegativeRuleCount: toNumber(selectionGuardrailSummary?.hit3ZeroNegativeRuleCount, 0),
      oosPerfectRuleCount: oosPerfectRows.length,
      oosPerfectDateFloor3RuleCount: oosPerfectDateFloor3Rows.length,
      oosPerfectDateFloor4RuleCount: oosPerfectDateFloor4Rows.length,
      cleanOosYield: round(ratio(oosPerfectDateFloor3Rows.length, Math.max(1, catalogRules.length || toNumber(trainSummary?.rules, 0)))),
      close28SelectedRows: toNumber(selectionGuardrailSummary?.close28SelectedRows, 0),
      close28HitRows: toNumber(selectionGuardrailSummary?.close28HitRows, 0),
      lineLevelHitRate: round(selectionGuardrailSummary?.lineLevelHitRate),
      uniqueMatchedDates: toNumber(selectionGuardrailSummary?.uniqueMatchedDates, 0),
      top1DateShare: round(selectionGuardrailSummary?.top1DateShare),
      intervalRuleCount: intervalRows.length,
      macroRuleCount: macroRows.length,
      atomspaceRuleCount: atomspaceRows.length,
      exactCompletionSolvedRuleCount: toNumber(selectionGuardrailSummary?.exactCompletionSolvedRuleCount, 0),
      bestRule,
    },
    noRulesSummary,
    noSubgroupSummary,
    freezeResult,
    openEvalManifest,
  }
}

export const buildTp12ProbeDelta = ({ control, variant }) => ({
  speed: {
    wrapperWallClockSec: delta(variant.speed.wrapperWallClockSec, control.speed.wrapperWallClockSec),
    indexElapsedSec: delta(variant.speed.indexElapsedSec, control.speed.indexElapsedSec),
    indexMaxRssKb: delta(variant.speed.indexMaxRssKb, control.speed.indexMaxRssKb),
    trainExploredStates: delta(variant.speed.trainExploredStates, control.speed.trainExploredStates),
    trainCandidateDescriptorCount: delta(
      variant.speed.trainCandidateDescriptorCount,
      control.speed.trainCandidateDescriptorCount,
    ),
    trainAcceptedCandidateCount: delta(
      variant.speed.trainAcceptedCandidateCount,
      control.speed.trainAcceptedCandidateCount,
    ),
    trainCandidateEfficiency: delta(
      variant.speed.trainCandidateEfficiency,
      control.speed.trainCandidateEfficiency,
    ),
    trainBoundPruneCount: delta(variant.speed.trainBoundPruneCount, control.speed.trainBoundPruneCount),
    trainPromotableUpperBoundPruneCount: delta(
      variant.speed.trainPromotableUpperBoundPruneCount,
      control.speed.trainPromotableUpperBoundPruneCount,
    ),
    trainStateDominancePruneCount: delta(
      variant.speed.trainStateDominancePruneCount,
      control.speed.trainStateDominancePruneCount,
    ),
    trainCandidateCostTotalMs: delta(
      variant.speed.trainCandidateCostTotalMs,
      control.speed.trainCandidateCostTotalMs,
    ),
    trainCandidateCostMsPer1kStates: delta(
      variant.speed.trainCandidateCostMsPer1kStates,
      control.speed.trainCandidateCostMsPer1kStates,
    ),
    trainRulesPer100kStates: delta(
      variant.speed.trainRulesPer100kStates,
      control.speed.trainRulesPer100kStates,
    ),
    runtimePerPromotableRuleMs: delta(
      variant.speed.runtimePerPromotableRuleMs,
      control.speed.runtimePerPromotableRuleMs,
    ),
  },
  quality: {
    minedRuleCount: delta(variant.quality.minedRuleCount, control.quality.minedRuleCount),
    trainBreadthQualifiedRuleCount: delta(
      variant.quality.trainBreadthQualifiedRuleCount,
      control.quality.trainBreadthQualifiedRuleCount,
    ),
    trainPromotableBreadthRuleCount: delta(
      variant.quality.trainPromotableBreadthRuleCount,
      control.quality.trainPromotableBreadthRuleCount,
    ),
    promotableRuleYield: delta(
      variant.quality.promotableRuleYield,
      control.quality.promotableRuleYield,
    ),
    oosPerfectRuleCount: delta(variant.quality.oosPerfectRuleCount, control.quality.oosPerfectRuleCount),
    oosPerfectDateFloor3RuleCount: delta(
      variant.quality.oosPerfectDateFloor3RuleCount,
      control.quality.oosPerfectDateFloor3RuleCount,
    ),
    oosPerfectDateFloor4RuleCount: delta(
      variant.quality.oosPerfectDateFloor4RuleCount,
      control.quality.oosPerfectDateFloor4RuleCount,
    ),
    cleanOosYield: delta(variant.quality.cleanOosYield, control.quality.cleanOosYield),
    zeroNegativeRuleCount: delta(variant.quality.zeroNegativeRuleCount, control.quality.zeroNegativeRuleCount),
    close28SelectedRows: delta(variant.quality.close28SelectedRows, control.quality.close28SelectedRows),
    close28HitRows: delta(variant.quality.close28HitRows, control.quality.close28HitRows),
    lineLevelHitRate: delta(variant.quality.lineLevelHitRate, control.quality.lineLevelHitRate),
    uniqueMatchedDates: delta(variant.quality.uniqueMatchedDates, control.quality.uniqueMatchedDates),
    atomspaceRuleCount: delta(variant.quality.atomspaceRuleCount, control.quality.atomspaceRuleCount),
  },
})

export const renderTp12ProbeVariantBlock = (variant) => [
  `- status: \`${variant.status}\``,
  `- tokenizer surface: \`${variant.tokenizerSurface ?? "unknown"}\``,
  `- selection line: \`${variant.selectionLineId ?? "unknown"}\``,
  `- condition language: interval=${variant.conditionLanguage.enableIntervalAtoms} macro=${variant.conditionLanguage.enableMacroAtoms} adaptive=${variant.conditionLanguage.enableAdaptiveThresholdAtoms}`,
  `- speed: wall ${variant.speed.wrapperWallClockSec ?? "n/a"}s, index ${variant.speed.indexElapsedSec ?? "n/a"}s, maxRSS ${variant.speed.indexMaxRssKb ?? "n/a"} KB, exploredStates ${variant.speed.trainExploredStates}`,
  `- search efficiency: candidates ${variant.speed.trainAcceptedCandidateCount}/${variant.speed.trainCandidateDescriptorCount} (${pct(variant.speed.trainCandidateEfficiency)}), promotable-prune ${variant.speed.trainPromotableUpperBoundPruneCount}, runtime/promotable ${variant.speed.runtimePerPromotableRuleMs ?? "n/a"} ms`,
  `- quality: rules ${variant.quality.minedRuleCount}, breadth>=4/4/3 ${variant.quality.trainBreadthQualifiedRuleCount}, promotable 10/6/4 ${variant.quality.trainPromotableBreadthRuleCount} (${pct(variant.quality.promotableRuleYield)}), OOS zero-neg ${variant.quality.zeroNegativeRuleCount}, OOS perfect date>=3 ${variant.quality.oosPerfectDateFloor3RuleCount} (${pct(variant.quality.cleanOosYield)})`,
  `- line: close28 selected ${variant.quality.close28SelectedRows}, hits ${variant.quality.close28HitRows}, hitRate ${pct(variant.quality.lineLevelHitRate)}`,
  `- best rule: ${variant.quality.bestRule ? `${variant.quality.bestRule.ruleId} (${pct(variant.quality.bestRule.openOosPrecision)}, hit=${variant.quality.bestRule.openOosHitCount}/${variant.quality.bestRule.openOosMatchCount}, dates=${variant.quality.bestRule.openOosUniqueMatchedDates})` : "n/a"}`,
].join("\n")
