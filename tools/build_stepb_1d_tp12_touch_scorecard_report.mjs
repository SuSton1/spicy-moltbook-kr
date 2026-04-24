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
import {
  applyTp12TouchBundleArtifact,
  buildTp12TouchBundleTermBank,
  buildTp12TouchBundleVerdict,
  solveTp12TouchBundleScorecard,
  summarizeTp12TouchBundleSelections,
} from "../src/lib/perfect_prototype_tp12_touch_scorecard_bundle.mjs"
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
    throw new Error(`touch scorecard report missing frozen catalog path for run=${scopeRunId}`)
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
    throw new Error(`touch scorecard input pack is empty: ${inputPath}`)
  }
  const symbolAllowSet = new Set(sourceRows.map((row) => toText(row?.symbol)).filter(Boolean))
  const candleRows = await readJsonl(candlePath, {
    filter: (row) => symbolAllowSet.has(String(row?.symbol ?? "").trim()),
  })
  const seriesMap = buildCandleSeriesMap(candleRows, symbolAllowSet)
  const missingSymbols = Array.from(symbolAllowSet).filter((symbol) => !seriesMap.has(symbol))
  if (missingSymbols.length > 0) {
    throw new Error(
      `touch scorecard missing candle series for ${missingSymbols.length} symbols; first=${missingSymbols.slice(0, 10).join(",")}`,
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
    throw new Error(`touch scorecard normalized ${unusableRows.length} unusable touch rows from ${inputPath}`)
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

const buildBundleRows = (evaluations = []) =>
  (Array.isArray(evaluations) ? evaluations : [])
    .filter((entry) => entry.selected === true)
    .map((entry) => ({
      rowKey: buildRowKey(entry?.row),
      sourceId: entry?.row?.sourceId ?? null,
      dateKey: entry?.row?.dateKey ?? null,
      symbol: entry?.row?.symbol ?? null,
      outcomeHitTarget: entry?.row?.outcomeHitTarget === true,
      score: toNumber(entry?.score, 0),
      matchedTerms: uniqueSorted(entry?.matchedTerms ?? []),
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
  solution,
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
  scorecardBundle: {
    ok: solution?.ok === true,
    reason: solution?.reason ?? null,
    threshold: solution?.threshold ?? null,
    termCount: solution?.termCount ?? 0,
    roleCounts: solution?.roleCounts ?? {},
    trainSummary: solution?.trainSummary ?? null,
    trainObjective: solution?.trainObjective ?? null,
    oosSummary: solution?.oosSummary ?? null,
    candidatePreviewCount: solution?.candidatePreviewCount ?? 0,
    triedSolutionCount: solution?.triedSolutionCount ?? 0,
  },
  verdict,
})

const buildReport = ({ summary }) => {
  const baselineTrain = summary?.baselineTouch?.train ?? {}
  const baselineOos = summary?.baselineTouch?.oos ?? {}
  const scorecard = summary?.scorecardBundle ?? {}
  return [
    "# 1D TP12 Touch Scorecard Bundle",
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
    `- candidate terms: ${toNumber(summary?.termBank?.candidateTermCount, 0)}`,
    `- qualified terms: ${toNumber(summary?.termBank?.qualifiedTermCount, 0)}`,
    "",
    "## Scorecard Bundle",
    "",
    `- solved: ${scorecard?.ok === true ? 1 : 0}`,
    `- term count: ${toNumber(scorecard?.termCount, 0)}`,
    `- threshold: ${toNumber(scorecard?.threshold, 0)}`,
    `- train summary: ${toNumber(scorecard?.trainSummary?.positiveRowCount, 0)}/${toNumber(scorecard?.trainSummary?.selectedRowCount, 0)} = ${pct(scorecard?.trainSummary?.precision)}`,
    `- train breadth: ${toNumber(scorecard?.trainSummary?.matchedDateCount, 0)} dates / ${toNumber(scorecard?.trainSummary?.matchedMonthCount, 0)} months / ${toNumber(scorecard?.trainSummary?.matchedFoldCount, 0)} folds`,
    `- OOS summary: ${toNumber(scorecard?.oosSummary?.positiveRowCount, 0)}/${toNumber(scorecard?.oosSummary?.selectedRowCount, 0)} = ${pct(scorecard?.oosSummary?.precision)}`,
    `- OOS breadth: ${toNumber(scorecard?.oosSummary?.matchedDateCount, 0)} dates / ${toNumber(scorecard?.oosSummary?.matchedMonthCount, 0)} months / ${toNumber(scorecard?.oosSummary?.matchedFoldCount, 0)} folds`,
    `- candidate previews: ${toNumber(scorecard?.candidatePreviewCount, 0)}`,
    `- tried solutions: ${toNumber(scorecard?.triedSolutionCount, 0)}`,
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
    toolName: "build_stepb_1d_tp12_touch_scorecard_report",
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
  const maxCandidateTerms = toNumber(getFlag(parsed.flags, "max-scorecard-candidate-terms", 6), 6)
  const minTermTrainPrecision = Number(getFlag(parsed.flags, "min-term-train-precision", 0.3))
  const minTermTrainDates = toNumber(getFlag(parsed.flags, "min-term-train-dates", 3), 3)
  const maxSelectedTerms = toNumber(getFlag(parsed.flags, "max-selected-terms", 6), 6)
  const beamSize = toNumber(getFlag(parsed.flags, "beam-size", 8), 8)
  const minTrainPrecision = Number(getFlag(parsed.flags, "min-solution-train-precision", 0.38))
  const minTrainDates = toNumber(getFlag(parsed.flags, "min-solution-train-dates", 15), 15)
  const minTrainMonths = toNumber(getFlag(parsed.flags, "min-solution-train-months", 8), 8)
  const minTrainFolds = toNumber(getFlag(parsed.flags, "min-solution-train-folds", 4), 4)
  const minSelectedRows = toNumber(getFlag(parsed.flags, "min-solution-selected-rows", 60), 60)
  const maxTop1DateHitShare = Number(getFlag(parsed.flags, "max-solution-top1-date-hit-share", 0.2))
  const maxSelectedDonorTerms = toNumber(getFlag(parsed.flags, "max-selected-donor-terms", 2), 2)
  const maxSelectedClusterTerms = toNumber(getFlag(parsed.flags, "max-selected-cluster-terms", 2), 2)
  const maxSelectedBroadenedTerms = toNumber(getFlag(parsed.flags, "max-selected-broadened-terms", 2), 2)
  const minVerdictOosSelectedRows = toNumber(getFlag(parsed.flags, "min-verdict-oos-selected-rows", 60), 60)
  const minVerdictOosDates = toNumber(getFlag(parsed.flags, "min-verdict-oos-dates", 30), 30)
  if (!scopeRunId || !outDir) {
    throw new Error(
      "Usage: node tools/build_stepb_1d_tp12_touch_scorecard_report.mjs --scope-run-id=<child_run_id> --out-dir=<dir> [--scope-label=LOW_GAP_TOP] [--candle-path=<data/candle_daily.jsonl>]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "outDir", filePath: outDir },
      { label: "candlePath", filePath: candlePath, allowedRoot: policy.dataRoot },
    ],
    policy,
    toolName: "build_stepb_1d_tp12_touch_scorecard_report",
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
    toolName: "build_stepb_1d_tp12_touch_scorecard_report",
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
    maxCandidateTerms,
    minTermTrainPrecision,
    minTermTrainDates,
  })
  const solution = solveTp12TouchBundleScorecard({
    termBank,
    trainRows: touchTrainRows,
    maxSelectedTerms,
    beamSize,
    minTrainPrecision,
    minTrainDates,
    minTrainMonths,
    minTrainFolds,
    minSelectedRows,
    maxTop1DateHitShare,
    roleCaps: {
      donor_exact: maxSelectedDonorTerms,
      cluster_any: maxSelectedClusterTerms,
      broadened_rule: maxSelectedBroadenedTerms,
    },
  })

  let trainEvaluations = []
  let oosEvaluations = []
  if (solution?.ok === true) {
    trainEvaluations = applyTp12TouchBundleArtifact({ artifact: solution.artifact, rows: touchTrainRows })
    oosEvaluations = applyTp12TouchBundleArtifact({ artifact: solution.artifact, rows: touchOosRows })
    solution.trainSummary = summarizeTp12TouchBundleSelections({ evaluations: trainEvaluations })
    solution.oosSummary = summarizeTp12TouchBundleSelections({ evaluations: oosEvaluations })
  }

  const verdict = buildTp12TouchBundleVerdict({
    baselineOosLineSummary: touchOos.lineSummary,
    solution,
    minVerdictOosSelectedRows,
    minVerdictOosDates,
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
    solution,
    verdict,
  })
  const report = buildReport({ summary })

  await writeJson(path.join(outDir, "touch_scorecard_summary.json"), summary)
  await writeJson(path.join(outDir, "touch_scorecard_verdict.json"), verdict)
  await writeJson(path.join(outDir, "touch_scorecard_term_bank.json"), termBank)
  await writeJson(path.join(outDir, "touch_scorecard_solution.json"), solution)
  await writeJson(path.join(outDir, "touch_donor_manifest.json"), donorManifest)
  await writeJson(path.join(outDir, "touch_donor_clusters.json"), donorClusters)
  await writeJson(path.join(outDir, "touch_broadened_qualified_candidates.json"), qualifiedCandidates)
  await writeJsonl(path.join(outDir, "touch_scorecard_train_selected.jsonl"), buildBundleRows(trainEvaluations))
  await writeJsonl(path.join(outDir, "touch_scorecard_oos_selected.jsonl"), buildBundleRows(oosEvaluations))
  await fs.writeFile(path.join(outDir, "report.md"), `${report}\n`, "utf8")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
