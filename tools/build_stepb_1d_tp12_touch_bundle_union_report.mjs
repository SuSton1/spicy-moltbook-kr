import fs from "node:fs/promises"
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildCandleSeriesMap } from "../src/lib/data.mjs"
import { createPerfectPrototypeMatchAccumulator } from "../src/lib/perfect_prototype_dedupe.mjs"
import { ensureDir, readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"
import { loadPerfectPrototypeCatalog, selectPerfectPrototypeRules } from "../src/lib/perfect_prototype_catalog.mjs"
import {
  buildPerfectPrototypeRuleMatchIndex,
  selectPerfectPrototypeCandidateRules,
} from "../src/lib/perfect_prototype_rule_match_index.mjs"
import { matchPerfectPrototypeRule, rankPerfectPrototypeRules } from "../src/lib/perfect_prototype_rule.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import {
  buildTp12TouchFoldKeyLookup,
  buildTp12TouchLineSummary,
  buildTp12TouchRuleSummaries,
} from "../src/lib/perfect_prototype_tp12_contract_split_metrics.mjs"
import { pct, toNumber, toText } from "../src/lib/perfect_prototype_tp12_probe_metrics.mjs"
import {
  buildTp12TouchBroadeningCandidateRows,
  buildTp12TouchBroadeningQualifiedCandidates,
  buildTp12TouchConsensusCandidates,
  buildTp12TouchDonorManifest,
  buildTp12TouchRuleClusters,
} from "../src/lib/perfect_prototype_tp12_touch_broadening.mjs"
import { buildTp12TouchLabelMatrix } from "../src/lib/perfect_prototype_tp12_touch_label_matrix.mjs"
import {
  buildTp12TouchBundleUnionVerdict,
  selectTp12TouchCoveragePreservingBundle,
} from "../src/lib/perfect_prototype_tp12_touch_bundle_selector.mjs"
import { buildTp12TouchBundleTermBank } from "../src/lib/perfect_prototype_tp12_touch_scorecard_bundle.mjs"
import {
  relabelPerfectPrototypeRowForTp12TouchContract,
  TP12_TOUCH_DISCOVERY_CONTRACT,
} from "../src/lib/perfect_prototype_tp12_touch_contract.mjs"
import { normalizePerfectPrototypeRow, tokenizePerfectPrototypeRow } from "../src/lib/perfect_prototype_tokenizer.mjs"

const uniqueSorted = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const buildRowKey = (row) =>
  String(row?.rowKey ?? row?.sourceId ?? `${row?.symbol ?? "?"}:${row?.dateKey ?? "?"}`).trim()

const readScopePaths = ({ cwd, scopeRunId }) => {
  const runDir = path.join(cwd, "artifacts", "runs", scopeRunId)
  return {
    runDir,
    freezeResultPath: path.join(runDir, "freeze_result.json"),
    openEvalManifestPath: path.join(runDir, "step-perfect-prototype-open-eval-report", "open_eval_manifest.json"),
    trainPackPath: path.join(runDir, "step-perfect-prototype-open-train-pack", "daily_pack.jsonl"),
    oosPackPath: path.join(runDir, "step-perfect-prototype-open-oos-pack", "daily_pack.jsonl"),
  }
}

const loadScopeBundle = async ({ cwd, scopeRunId }) => {
  const paths = readScopePaths({ cwd, scopeRunId })
  const [freezeResult, openEvalManifest] = await Promise.all([
    readJson(paths.freezeResultPath, null),
    readJson(paths.openEvalManifestPath, null),
  ])
  const frozenCatalogPath = toText(freezeResult?.outPath)
  if (!frozenCatalogPath) {
    throw new Error(`touch bundle-union report missing frozen catalog path for run=${scopeRunId}`)
  }
  const catalog = await loadPerfectPrototypeCatalog(frozenCatalogPath, { requireFrozen: true })
  const selectionMode = toText(openEvalManifest?.selectionMode) ?? "union_all"
  return {
    paths,
    catalog,
    selectionMode,
  }
}

const prepareTouchRows = async ({ inputPath, catalog, candlePath, holdDays, targetPct, stopLossPct, foldScheme }) => {
  const sourceRows = await readJsonl(inputPath)
  if (sourceRows.length < 1) {
    throw new Error(`touch bundle-union input pack is empty: ${inputPath}`)
  }
  const symbolAllowSet = new Set(sourceRows.map((row) => toText(row?.symbol)).filter(Boolean))
  const candleRows = await readJsonl(candlePath, {
    filter: (row) => symbolAllowSet.has(String(row?.symbol ?? "").trim()),
  })
  const seriesMap = buildCandleSeriesMap(candleRows, symbolAllowSet)
  const missingSymbols = Array.from(symbolAllowSet).filter((symbol) => !seriesMap.has(symbol))
  if (missingSymbols.length > 0) {
    throw new Error(
      `touch bundle-union missing candle series for ${missingSymbols.length} symbols; first=${missingSymbols.slice(0, 10).join(",")}`,
    )
  }
  const relabeledRows = sourceRows.map((row) =>
    relabelPerfectPrototypeRowForTp12TouchContract({
      row,
      seriesMap,
      holdDays,
      targetPct,
      stopLossPct,
    }),
  )
  const normalizedRows = relabeledRows.map((row) => normalizePerfectPrototypeRow(row, catalog?.tokenizerSpec?.options))
  const unusableRows = normalizedRows.filter((row) => !row?.dateKey || typeof row?.outcomeHitTarget !== "boolean")
  if (unusableRows.length > 0) {
    throw new Error(`touch bundle-union normalized ${unusableRows.length} unusable touch rows from ${inputPath}`)
  }
  const { dateToFoldKey } = buildTp12TouchFoldKeyLookup({ rows: normalizedRows, foldScheme })
  return normalizedRows.map((row) => ({
    ...row,
    dateFoldKey: dateToFoldKey.get(row.dateKey) ?? null,
    tokenSet: new Set(tokenizePerfectPrototypeRow(row, catalog?.tokenizerSpec)),
  }))
}

const evaluateTouchContract = ({ rows, rules, selectionMode, foldScheme }) => {
  const rankedRules = rankPerfectPrototypeRules(Array.isArray(rules) ? rules : [])
  const ruleMatchIndex = buildPerfectPrototypeRuleMatchIndex({ rules: rankedRules })
  const ruleStats = new Map(
    rankedRules.map((rule) => [
      rule.ruleId,
      {
        ruleId: rule.ruleId,
        matchCount: 0,
        hitCount: 0,
        negativeCount: 0,
        matchedDates: [],
        hitDates: [],
      },
    ]),
  )
  const matchAccumulator = createPerfectPrototypeMatchAccumulator({
    rules: rankedRules,
    selectionMode,
    selectionMaxSymbolsPerDay: selectionMode === "top2_per_day_union" ? 2 : null,
  })
  for (const row of Array.isArray(rows) ? rows : []) {
    const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set()
    const candidateRules = selectPerfectPrototypeCandidateRules({ tokenSet, matchIndex: ruleMatchIndex })
    const matchedRules = candidateRules
      .filter((rule) => matchPerfectPrototypeRule(tokenSet, rule))
      .sort((left, right) => Number(left?.rank ?? Number.MAX_SAFE_INTEGER) - Number(right?.rank ?? Number.MAX_SAFE_INTEGER))
    if (matchedRules.length < 1) continue
    for (const rule of matchedRules) {
      const stat = ruleStats.get(rule.ruleId)
      stat.matchCount += 1
      stat.matchedDates.push(row.dateKey)
      if (row?.outcomeHitTarget === true) {
        stat.hitCount += 1
        stat.hitDates.push(row.dateKey)
      } else {
        stat.negativeCount += 1
      }
    }
    matchAccumulator.consume({
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      dateKey: row.dateKey,
      symbol: row.symbol,
      outcomeHitTarget: row.outcomeHitTarget,
      matchedRuleIds: matchedRules.map((rule) => rule.ruleId),
      matchedRuleCount: matchedRules.length,
      primaryRuleId: matchedRules[0]?.ruleId ?? null,
      touchStopBeforeTouch: row?.raw?.touchOutcome?.stopBeforeTouch === true,
    })
  }
  const finalized = matchAccumulator.finalize()
  const { dateToFoldKey } = buildTp12TouchFoldKeyLookup({ rows, foldScheme })
  const ruleSummary = buildTp12TouchRuleSummaries({
    rules: rankedRules,
    ruleStats,
    dateToFoldKey,
    includeDateDetails: true,
  })
  return {
    ruleRows: ruleSummary.rows,
    aggregate: ruleSummary.aggregate,
    ruleSets: {
      zeroNegativeRuleIds: ruleSummary.touchZeroNegativeRuleIds,
      promotableRuleIds: ruleSummary.touchPromotableRuleIds,
      perfectDateFloor3RuleIds: ruleSummary.touchPerfectDateFloor3RuleIds,
    },
    lineSummary: buildTp12TouchLineSummary({ dedupedMatches: finalized.dedupedMatches }),
    matches: finalized.symbolDayDedupedMatches,
    dedupedMatches: finalized.dedupedMatches,
  }
}

const buildBundleRows = (rows = [], extra = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => ({
    rowKey: buildRowKey(row),
    sourceId: row?.sourceId ?? null,
    dateKey: row?.dateKey ?? null,
    symbol: row?.symbol ?? null,
    outcomeHitTarget: row?.outcomeHitTarget === true,
    matchedTermIds: uniqueSorted(row?.matchedTermIds ?? []),
    tokens: uniqueSorted(row?.tokens ?? []),
    ...extra,
  }))

const buildSummary = ({
  scopeRunId,
  scopeLabel,
  selectionMode,
  foldScheme,
  holdDays,
  targetPct,
  stopLossPct,
  touchTrain,
  touchOos,
  donorManifest,
  donorClusters,
  qualifiedCandidates,
  termBank,
  labelMatrix,
  bundle,
  verdict,
}) => ({
  scopeRunId,
  scopeLabel,
  contract: {
    touchDiscovery: {
      ...TP12_TOUCH_DISCOVERY_CONTRACT,
      holdDays,
      targetPct,
      stopLossPct,
    },
    foldScheme,
    selectionMode,
  },
  baselineTouch: {
    train: {
      aggregate: touchTrain.aggregate,
      lineSummary: touchTrain.lineSummary,
    },
    oos: {
      aggregate: touchOos.aggregate,
      lineSummary: touchOos.lineSummary,
    },
  },
  donorManifest: {
    donorCount: donorManifest.donorCount,
    repeatedOosPerfectDonorCount: donorManifest.repeatedOosPerfectDonorCount,
    oosZeroNegativeDonorCount: donorManifest.oosZeroNegativeDonorCount,
  },
  donorClusters: {
    clusterCount: donorClusters.clusterCount,
    multiDonorClusterCount: donorClusters.multiDonorClusterCount,
  },
  broadenedCandidates: {
    qualifiedCandidateCount: qualifiedCandidates.candidateCount,
    promotableCandidateCount: qualifiedCandidates.promotableCandidateCount,
    oosPerfectDateFloor3CandidateCount: qualifiedCandidates.oosPerfectDateFloor3CandidateCount,
  },
  termBank: termBank.summary,
  labelMatrix: labelMatrix.summary,
  bundleUnion: {
    ok: bundle?.ok === true,
    eligibleTermCount: bundle?.eligibleTermCount ?? 0,
    baseRate: bundle?.baseRate ?? 0,
    positiveBundle: {
      termIds: bundle?.positiveBundle?.termIds ?? [],
      termCount: (bundle?.positiveBundle?.termIds ?? []).length,
      trainSummary: bundle?.positiveBundle?.trainSummary ?? null,
      oosSummary: bundle?.positiveBundle?.oosSummary ?? null,
      objective: bundle?.positiveBundle?.objective ?? null,
      traceCount: (bundle?.positiveBundle?.trace ?? []).length,
    },
    vetoBuilder: {
      candidateCount: bundle?.vetoBuilder?.candidateCount ?? 0,
      negativeSelectedRowCount: bundle?.vetoBuilder?.negativeSelectedRowCount ?? 0,
      positiveSelectedRowCount: bundle?.vetoBuilder?.positiveSelectedRowCount ?? 0,
    },
    vetoBundle: {
      selectedTokens: bundle?.vetoBundle?.selectedTokens ?? [],
      tokenCount: (bundle?.vetoBundle?.selectedTokens ?? []).length,
      trainSummary: bundle?.vetoBundle?.trainSummary ?? null,
      oosSummary: bundle?.vetoBundle?.oosSummary ?? null,
      objective: bundle?.vetoBundle?.objective ?? null,
      traceCount: (bundle?.vetoBundle?.trace ?? []).length,
    },
    finalBundle: {
      trainSummary: bundle?.finalBundle?.trainSummary ?? null,
      oosSummary: bundle?.finalBundle?.oosSummary ?? null,
      objective: bundle?.finalBundle?.objective ?? null,
      trainVetoedRowCount: (bundle?.finalBundle?.trainVetoedRows ?? []).length,
      oosVetoedRowCount: (bundle?.finalBundle?.oosVetoedRows ?? []).length,
    },
  },
  verdict,
})

const buildReport = ({ summary }) => {
  const baselineTrain = summary?.baselineTouch?.train ?? {}
  const baselineOos = summary?.baselineTouch?.oos ?? {}
  const bundle = summary?.bundleUnion ?? {}
  const positive = bundle?.positiveBundle ?? {}
  const veto = bundle?.vetoBundle ?? {}
  const final = bundle?.finalBundle ?? {}
  return [
    "# 1D TP12 Touch Bundle Union",
    "",
    "## Scope",
    "",
    `- source scope run: \`${summary?.scopeRunId}\``,
    `- scope label: \`${summary?.scopeLabel ?? "n/a"}\``,
    `- selection mode: \`${summary?.contract?.selectionMode ?? "union_all"}\``,
    `- touch discovery contract: \`NEXT_DAY_OPEN / ${summary?.contract?.touchDiscovery?.holdDays ?? 3}d / +${((Number(summary?.contract?.touchDiscovery?.targetPct ?? 0.12)) * 100).toFixed(0)}% touch / no stop gate\``,
    "",
    "## Baseline Touch",
    "",
    `- train promotable breadth 10/6/4: ${toNumber(baselineTrain?.aggregate?.promotableBreadthRuleCount, 0)}`,
    `- OOS zero-negative rules: ${toNumber(baselineOos?.aggregate?.zeroNegativeRuleCount, 0)}`,
    `- OOS perfect >=3 dates: ${toNumber(baselineOos?.aggregate?.perfectDateFloor3RuleCount, 0)}`,
    `- raw touch line: ${toNumber(baselineOos?.lineSummary?.hitRows, 0)}/${toNumber(baselineOos?.lineSummary?.selectedRows, 0)} = ${pct(baselineOos?.lineSummary?.hitRate)}`,
    "",
    "## Bundle Inputs",
    "",
    `- donor rules: ${toNumber(summary?.donorManifest?.donorCount, 0)}`,
    `- donor clusters: ${toNumber(summary?.donorClusters?.clusterCount, 0)}`,
    `- qualified broadened candidates: ${toNumber(summary?.broadenedCandidates?.qualifiedCandidateCount, 0)}`,
    `- qualified terms: ${toNumber(summary?.termBank?.qualifiedTermCount, 0)}`,
    `- label-matrix train rows with any term: ${toNumber(summary?.labelMatrix?.trainRowsWithAnyTerm, 0)}`,
    `- label-matrix OOS rows with any term: ${toNumber(summary?.labelMatrix?.oosRowsWithAnyTerm, 0)}`,
    "",
    "## Positive Bundle",
    "",
    `- solved: ${bundle?.ok === true ? 1 : 0}`,
    `- selected terms: ${toNumber(positive?.termCount, 0)}`,
    `- train summary: ${toNumber(positive?.trainSummary?.positiveRowCount, 0)}/${toNumber(positive?.trainSummary?.selectedRowCount, 0)} = ${pct(positive?.trainSummary?.precision)}`,
    `- train breadth: ${toNumber(positive?.trainSummary?.matchedDateCount, 0)} dates / ${toNumber(positive?.trainSummary?.matchedMonthCount, 0)} months / ${toNumber(positive?.trainSummary?.matchedFoldCount, 0)} folds`,
    `- OOS summary: ${toNumber(positive?.oosSummary?.positiveRowCount, 0)}/${toNumber(positive?.oosSummary?.selectedRowCount, 0)} = ${pct(positive?.oosSummary?.precision)}`,
    `- OOS breadth: ${toNumber(positive?.oosSummary?.matchedDateCount, 0)} dates / ${toNumber(positive?.oosSummary?.matchedMonthCount, 0)} months / ${toNumber(positive?.oosSummary?.matchedFoldCount, 0)} folds`,
    "",
    "## Veto Layer",
    "",
    `- veto candidates: ${toNumber(bundle?.vetoBuilder?.candidateCount, 0)}`,
    `- selected veto tokens: ${toNumber(veto?.tokenCount, 0)}`,
    `- train after veto: ${toNumber(veto?.trainSummary?.positiveRowCount, 0)}/${toNumber(veto?.trainSummary?.selectedRowCount, 0)} = ${pct(veto?.trainSummary?.precision)}`,
    `- OOS after veto: ${toNumber(veto?.oosSummary?.positiveRowCount, 0)}/${toNumber(veto?.oosSummary?.selectedRowCount, 0)} = ${pct(veto?.oosSummary?.precision)}`,
    `- train vetoed rows: ${toNumber(final?.trainVetoedRowCount, 0)}`,
    `- OOS vetoed rows: ${toNumber(final?.oosVetoedRowCount, 0)}`,
    "",
    "## Final Bundle",
    "",
    `- final OOS line: ${toNumber(final?.oosSummary?.positiveRowCount, 0)}/${toNumber(final?.oosSummary?.selectedRowCount, 0)} = ${pct(final?.oosSummary?.precision)}`,
    `- final OOS breadth: ${toNumber(final?.oosSummary?.matchedDateCount, 0)} dates / ${toNumber(final?.oosSummary?.matchedMonthCount, 0)} months / ${toNumber(final?.oosSummary?.matchedFoldCount, 0)} folds`,
    `- final OOS top1 date hit share: ${pct(final?.oosSummary?.top1DateHitShare)}`,
    "",
    "## Verdict",
    "",
    `- verdict: \`${summary?.verdict?.code ?? "n/a"}\``,
    `- note: ${summary?.verdict?.message ?? "n/a"}`,
    "",
  ].join("\n")
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const policy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "build_stepb_1d_tp12_touch_bundle_union_report",
  })
  const scopeRunId = toText(getFlag(parsed.flags, "scope-run-id", ""))
  const scopeLabel = toText(getFlag(parsed.flags, "scope-label", "LOW_GAP_TOP"))
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  const candlePath = path.resolve(
    String(getFlag(parsed.flags, "candle-path", path.join(cwd, "data", "candle_daily.jsonl"))).trim(),
  )
  const foldScheme = toText(getFlag(parsed.flags, "fold-scheme", "chronological_4")) ?? "chronological_4"
  const holdDays = toNumber(getFlag(parsed.flags, "hold-days", TP12_TOUCH_DISCOVERY_CONTRACT.holdDays), TP12_TOUCH_DISCOVERY_CONTRACT.holdDays)
  const targetPct = Number(getFlag(parsed.flags, "target-pct", TP12_TOUCH_DISCOVERY_CONTRACT.targetPct))
  const stopLossPct = Number(getFlag(parsed.flags, "stop-loss-pct", TP12_TOUCH_DISCOVERY_CONTRACT.stopLossPct))
  const minDonorTrainHitDates = toNumber(getFlag(parsed.flags, "min-donor-train-hit-dates", 3), 3)
  const minCandidateTrainDates = toNumber(getFlag(parsed.flags, "min-candidate-train-dates", 6), 6)
  const minCandidateTrainMonths = toNumber(getFlag(parsed.flags, "min-candidate-train-months", 4), 4)
  const minCandidateTrainFolds = toNumber(getFlag(parsed.flags, "min-candidate-train-folds", 3), 3)
  const minCandidateTrainPrecision = Number(getFlag(parsed.flags, "min-candidate-train-precision", 0.4))
  const maxDonorTerms = toNumber(getFlag(parsed.flags, "max-donor-terms", 12), 12)
  const maxClusterTerms = toNumber(getFlag(parsed.flags, "max-cluster-terms", 6), 6)
  const maxBundleCandidateTerms = toNumber(getFlag(parsed.flags, "max-bundle-candidate-terms", 6), 6)
  const minTermTrainPrecision = Number(getFlag(parsed.flags, "min-term-train-precision", 0.3))
  const minTermTrainDates = toNumber(getFlag(parsed.flags, "min-term-train-dates", 3), 3)
  const maxPositiveTerms = toNumber(getFlag(parsed.flags, "max-positive-terms", 8), 8)
  const maxVetoTokens = toNumber(getFlag(parsed.flags, "max-veto-tokens", 2), 2)
  const minPositiveImprovement = Number(getFlag(parsed.flags, "min-positive-improvement", 0.01))
  const minVetoImprovement = Number(getFlag(parsed.flags, "min-veto-improvement", 0.005))
  const minTrainTermPrecision = minTermTrainPrecision
  const minTrainTermDates = minTermTrainDates
  const minTrainTermMonths = toNumber(getFlag(parsed.flags, "min-train-term-months", 2), 2)
  const minTrainTermFolds = toNumber(getFlag(parsed.flags, "min-train-term-folds", 3), 3)
  const minSelectedRowsAfterVeto = toNumber(getFlag(parsed.flags, "min-selected-rows-after-veto", 60), 60)
  const minSelectedDatesAfterVeto = toNumber(getFlag(parsed.flags, "min-selected-dates-after-veto", 15), 15)
  const maxTop1DateHitShare = Number(getFlag(parsed.flags, "max-top1-date-hit-share", 0.2))
  const maxSelectedDonorTerms = toNumber(getFlag(parsed.flags, "max-selected-donor-terms", 3), 3)
  const maxSelectedClusterTerms = toNumber(getFlag(parsed.flags, "max-selected-cluster-terms", 3), 3)
  const maxSelectedBroadenedTerms = toNumber(getFlag(parsed.flags, "max-selected-broadened-terms", 3), 3)
  const minVetoNegativeHits = toNumber(getFlag(parsed.flags, "min-veto-negative-hits", 4), 4)
  const minVetoNetGain = toNumber(getFlag(parsed.flags, "min-veto-net-gain", 1), 1)
  const minVerdictOosSelectedRows = toNumber(getFlag(parsed.flags, "min-verdict-oos-selected-rows", 100), 100)
  const minVerdictOosDates = toNumber(getFlag(parsed.flags, "min-verdict-oos-dates", 60), 60)
  const maxVerdictOosTop1DateHitShare = Number(getFlag(parsed.flags, "max-verdict-oos-top1-date-hit-share", 0.15))
  if (!scopeRunId || !outDir) {
    throw new Error(
      "Usage: node tools/build_stepb_1d_tp12_touch_bundle_union_report.mjs --scope-run-id=<child_run_id> --out-dir=<dir> [--scope-label=LOW_GAP_TOP] [--candle-path=<data/candle_daily.jsonl>]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "outDir", filePath: outDir },
      { label: "candlePath", filePath: candlePath, allowedRoot: policy.dataRoot },
    ],
    policy,
    toolName: "build_stepb_1d_tp12_touch_bundle_union_report",
  })
  await ensureDir(outDir)

  const scope = await loadScopeBundle({ cwd, scopeRunId })
  const scopePaths = readScopePaths({ cwd, scopeRunId })
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "scopeTrainPack", filePath: scopePaths.trainPackPath },
      { label: "scopeOosPack", filePath: scopePaths.oosPackPath },
      { label: "scopeCatalog", filePath: scope.catalog.path },
    ],
    policy,
    toolName: "build_stepb_1d_tp12_touch_bundle_union_report",
  })

  const touchTrainRows = await prepareTouchRows({
    inputPath: scopePaths.trainPackPath,
    catalog: scope.catalog,
    candlePath,
    holdDays,
    targetPct,
    stopLossPct,
    foldScheme,
  })
  const touchOosRows = await prepareTouchRows({
    inputPath: scopePaths.oosPackPath,
    catalog: scope.catalog,
    candlePath,
    holdDays,
    targetPct,
    stopLossPct,
    foldScheme,
  })

  const rules = selectPerfectPrototypeRules(scope.catalog, scope.selectionMode)
  const touchTrain = evaluateTouchContract({
    rows: touchTrainRows,
    rules,
    selectionMode: scope.selectionMode,
    foldScheme,
  })
  const touchOos = evaluateTouchContract({
    rows: touchOosRows,
    rules,
    selectionMode: scope.selectionMode,
    foldScheme,
  })

  const donorManifest = buildTp12TouchDonorManifest({
    trainRuleRows: touchTrain.ruleRows,
    oosRuleRows: touchOos.ruleRows,
    minTrainHitDates: minDonorTrainHitDates,
  })
  const donorClusters = buildTp12TouchRuleClusters({ donors: donorManifest.donors })
  const consensusCandidates = buildTp12TouchConsensusCandidates({
    donors: donorManifest.donors,
    clusters: donorClusters.clusters,
  })
  const candidateEvaluation = buildTp12TouchBroadeningCandidateRows({
    candidateRows: consensusCandidates.candidates,
    trainRows: touchTrainRows,
    oosRows: touchOosRows,
  })
  const qualifiedCandidates = buildTp12TouchBroadeningQualifiedCandidates({
    candidateRows: candidateEvaluation.candidates,
    minTrainDates: minCandidateTrainDates,
    minTrainMonths: minCandidateTrainMonths,
    minTrainFolds: minCandidateTrainFolds,
    minTrainPrecision: minCandidateTrainPrecision,
  })
  const termBank = buildTp12TouchBundleTermBank({
    donorManifest,
    donorClusters,
    qualifiedCandidates,
    trainRows: touchTrainRows,
    oosRows: touchOosRows,
    maxDonorTerms,
    maxClusterTerms,
    maxCandidateTerms: maxBundleCandidateTerms,
    minTermTrainPrecision,
    minTermTrainDates,
  })
  const labelMatrix = buildTp12TouchLabelMatrix({
    termBank,
    trainRows: touchTrainRows,
    oosRows: touchOosRows,
  })
  const bundle = selectTp12TouchCoveragePreservingBundle({
    labelMatrix,
    maxPositiveTerms,
    maxVetoTokens,
    minPositiveImprovement,
    minVetoImprovement,
    minTrainTermPrecision,
    minTrainTermDates,
    minTrainTermMonths,
    minTrainTermFolds,
    minSelectedRowsAfterVeto,
    minSelectedDatesAfterVeto,
    maxTop1DateHitShare,
    maxPositiveTermsPerRole: {
      donor_exact: maxSelectedDonorTerms,
      cluster_any: maxSelectedClusterTerms,
      broadened_rule: maxSelectedBroadenedTerms,
    },
    minVetoNegativeHits,
    minVetoNetGain,
  })
  const verdict = buildTp12TouchBundleUnionVerdict({
    baselineOosLineSummary: touchOos.lineSummary,
    bundle,
    minVerdictOosSelectedRows,
    minVerdictOosDates,
    maxVerdictOosTop1DateHitShare,
  })
  const summary = buildSummary({
    scopeRunId,
    scopeLabel,
    selectionMode: scope.selectionMode,
    foldScheme,
    holdDays,
    targetPct,
    stopLossPct,
    touchTrain,
    touchOos,
    donorManifest,
    donorClusters,
    qualifiedCandidates,
    termBank,
    labelMatrix,
    bundle,
    verdict,
  })
  const report = buildReport({ summary })

  await writeJson(path.join(outDir, "touch_bundle_union_summary.json"), summary)
  await writeJson(path.join(outDir, "touch_bundle_union_verdict.json"), verdict)
  await writeJson(path.join(outDir, "touch_bundle_term_bank.json"), termBank)
  await writeJson(path.join(outDir, "touch_bundle_label_matrix.json"), {
    summary: labelMatrix.summary,
    terms: labelMatrix.terms,
    trainRows: labelMatrix.trainRows,
    oosRows: labelMatrix.oosRows,
  })
  await writeJson(path.join(outDir, "touch_bundle_result.json"), bundle)
  await writeJson(path.join(outDir, "touch_donor_manifest.json"), donorManifest)
  await writeJson(path.join(outDir, "touch_donor_clusters.json"), donorClusters)
  await writeJson(path.join(outDir, "touch_broadened_qualified_candidates.json"), qualifiedCandidates)
  await writeJsonl(path.join(outDir, "touch_bundle_union_train_selected.jsonl"), buildBundleRows(bundle?.finalBundle?.trainSelectedRows, { stage: "final" }))
  await writeJsonl(path.join(outDir, "touch_bundle_union_oos_selected.jsonl"), buildBundleRows(bundle?.finalBundle?.oosSelectedRows, { stage: "final" }))
  await writeJsonl(path.join(outDir, "touch_bundle_union_train_vetoed.jsonl"), buildBundleRows(bundle?.finalBundle?.trainVetoedRows, { stage: "vetoed" }))
  await writeJsonl(path.join(outDir, "touch_bundle_union_oos_vetoed.jsonl"), buildBundleRows(bundle?.finalBundle?.oosVetoedRows, { stage: "vetoed" }))
  await fs.writeFile(path.join(outDir, "report.md"), `${report}\n`, "utf8")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
