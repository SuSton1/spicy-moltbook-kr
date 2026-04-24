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
import {
  pct,
  toNumber,
  toText,
} from "../src/lib/perfect_prototype_tp12_probe_metrics.mjs"
import {
  buildTp12TouchBroadeningCandidateRows,
  buildTp12TouchBroadeningQualifiedCandidates,
  buildTp12TouchBroadeningUnionSelector,
  buildTp12TouchBroadeningVerdict,
  buildTp12TouchConsensusCandidates,
  buildTp12TouchDonorManifest,
  buildTp12TouchRuleClusters,
} from "../src/lib/perfect_prototype_tp12_touch_broadening.mjs"
import {
  relabelPerfectPrototypeRowForTp12TouchContract,
  TP12_TOUCH_DISCOVERY_CONTRACT,
} from "../src/lib/perfect_prototype_tp12_touch_contract.mjs"
import { normalizePerfectPrototypeRow, tokenizePerfectPrototypeRow } from "../src/lib/perfect_prototype_tokenizer.mjs"

const uniqueSorted = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

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
    throw new Error(`touch broadening report missing frozen catalog path for run=${scopeRunId}`)
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
    throw new Error(`touch broadening input pack is empty: ${inputPath}`)
  }
  const symbolAllowSet = new Set(sourceRows.map((row) => toText(row?.symbol)).filter(Boolean))
  const candleRows = await readJsonl(candlePath, {
    filter: (row) => symbolAllowSet.has(String(row?.symbol ?? "").trim()),
  })
  const seriesMap = buildCandleSeriesMap(candleRows, symbolAllowSet)
  const missingSymbols = Array.from(symbolAllowSet).filter((symbol) => !seriesMap.has(symbol))
  if (missingSymbols.length > 0) {
    throw new Error(
      `touch broadening missing candle series for ${missingSymbols.length} symbols; first=${missingSymbols.slice(0, 10).join(",")}`,
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
    throw new Error(`touch broadening normalized ${unusableRows.length} unusable touch rows from ${inputPath}`)
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
  consensusCandidates,
  candidateEvaluation,
  qualifiedCandidates,
  unionSelector,
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
    maxDonorCount: Math.max(0, ...donorClusters.clusters.map((row) => Number(row?.donorCount ?? 0))),
  },
  consensusCandidates: {
    candidateCount: consensusCandidates.candidateCount,
  },
  broadenedCandidates: {
    candidateCount: candidateEvaluation.candidateCount,
    qualifiedCandidateCount: qualifiedCandidates.candidateCount,
    promotableCandidateCount: qualifiedCandidates.promotableCandidateCount,
    oosZeroNegativeCandidateCount: qualifiedCandidates.oosZeroNegativeCandidateCount,
    oosPerfectDateFloor3CandidateCount: qualifiedCandidates.oosPerfectDateFloor3CandidateCount,
  },
  union: {
    selectedRuleCount: unionSelector.selectedRuleCount,
    trainPromotableBreadth: unionSelector.unionTrainPromotableBreadth === true,
    trainSummary: unionSelector.unionTrainSummary,
    oosSummary: unionSelector.unionOosSummary,
    oosZeroNegative: unionSelector.unionOosZeroNegative === true,
    oosPerfectDateFloor3: unionSelector.unionOosPerfectDateFloor3 === true,
  },
  verdict,
})

const buildReport = ({ summary }) => {
  const baselineTrain = summary?.baselineTouch?.train ?? {}
  const baselineOos = summary?.baselineTouch?.oos ?? {}
  const union = summary?.union ?? {}
  return [
    "# 1D TP12 Touch Broadening",
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
    "## Donor Broadening",
    "",
    `- donor rules: ${toNumber(summary?.donorManifest?.donorCount, 0)}`,
    `- repeated OOS-perfect donors: ${toNumber(summary?.donorManifest?.repeatedOosPerfectDonorCount, 0)}`,
    `- OOS zero-negative donors: ${toNumber(summary?.donorManifest?.oosZeroNegativeDonorCount, 0)}`,
    `- donor clusters: ${toNumber(summary?.donorClusters?.clusterCount, 0)}`,
    `- multi-donor clusters: ${toNumber(summary?.donorClusters?.multiDonorClusterCount, 0)}`,
    `- consensus candidates: ${toNumber(summary?.consensusCandidates?.candidateCount, 0)}`,
    `- qualified candidates: ${toNumber(summary?.broadenedCandidates?.qualifiedCandidateCount, 0)}`,
    `- train-promotable candidates: ${toNumber(summary?.broadenedCandidates?.promotableCandidateCount, 0)}`,
    `- OOS perfect >=3-date candidates: ${toNumber(summary?.broadenedCandidates?.oosPerfectDateFloor3CandidateCount, 0)}`,
    "",
    "## Broadened Union",
    "",
    `- selected rules: ${toNumber(union?.selectedRuleCount, 0)}`,
    `- union train promotable breadth 10/6/4: ${union?.trainPromotableBreadth === true ? 1 : 0}`,
    `- union OOS touch line: ${toNumber(union?.oosSummary?.positiveRowCount, 0)}/${toNumber(union?.oosSummary?.selectedRowCount, 0)} = ${pct(union?.oosSummary?.precision)}`,
    `- union OOS matched dates: ${toNumber(union?.oosSummary?.matchedDateCount, 0)}`,
    `- union OOS zero-negative: ${union?.oosZeroNegative === true ? 1 : 0}`,
    `- union OOS perfect >=3 dates: ${union?.oosPerfectDateFloor3 === true ? 1 : 0}`,
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
    toolName: "build_stepb_1d_tp12_touch_broadening_report",
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
  const maxUnionRules = toNumber(getFlag(parsed.flags, "max-union-rules", 6), 6)
  const minUnionTrainPrecision = Number(getFlag(parsed.flags, "min-union-train-precision", 0.3))
  if (!scopeRunId || !outDir) {
    throw new Error(
      "Usage: node tools/build_stepb_1d_tp12_touch_broadening_report.mjs --scope-run-id=<child_run_id> --out-dir=<dir> [--scope-label=LOW_GAP_TOP] [--candle-path=<data/candle_daily.jsonl>]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "outDir", filePath: outDir },
      { label: "candlePath", filePath: candlePath, allowedRoot: policy.dataRoot },
    ],
    policy,
    toolName: "build_stepb_1d_tp12_touch_broadening_report",
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
    toolName: "build_stepb_1d_tp12_touch_broadening_report",
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
  const unionSelector = buildTp12TouchBroadeningUnionSelector({
    qualifiedCandidates: qualifiedCandidates.candidates,
    trainRows: touchTrainRows,
    oosRows: touchOosRows,
    maxRules: maxUnionRules,
    minUnionTrainPrecision,
  })
  const verdict = buildTp12TouchBroadeningVerdict({
    baselineOosLineSummary: touchOos.lineSummary,
    qualifiedCandidateCount: qualifiedCandidates.candidateCount,
    qualifiedPromotableCandidateCount: qualifiedCandidates.promotableCandidateCount,
    unionSelector,
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
    consensusCandidates,
    candidateEvaluation,
    qualifiedCandidates,
    unionSelector,
    verdict,
  })
  const report = buildReport({ summary })

  await writeJson(path.join(outDir, "touch_broadening_summary.json"), summary)
  await writeJson(path.join(outDir, "touch_broadening_verdict.json"), verdict)
  await writeJson(path.join(outDir, "touch_train_rule_report.json"), touchTrain.ruleRows)
  await writeJson(path.join(outDir, "touch_oos_rule_report.json"), touchOos.ruleRows)
  await writeJson(path.join(outDir, "touch_donor_manifest.json"), donorManifest)
  await writeJson(path.join(outDir, "touch_donor_clusters.json"), donorClusters)
  await writeJson(path.join(outDir, "touch_consensus_candidates.json"), consensusCandidates)
  await writeJson(path.join(outDir, "touch_broadened_candidate_rows.json"), candidateEvaluation)
  await writeJson(path.join(outDir, "touch_broadened_qualified_candidates.json"), qualifiedCandidates)
  await writeJson(path.join(outDir, "touch_broadened_union_summary.json"), unionSelector)
  await writeJsonl(path.join(outDir, "touch_oos_matches.jsonl"), touchOos.matches)
  await writeJsonl(path.join(outDir, "touch_oos_deduped_symbols.jsonl"), touchOos.dedupedMatches)
  await fs.writeFile(path.join(outDir, "report.md"), `${report}\n`, "utf8")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
