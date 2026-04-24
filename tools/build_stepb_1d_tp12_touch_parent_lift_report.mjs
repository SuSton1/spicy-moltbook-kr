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
import { buildTp12TouchParentLiftBank } from "../src/lib/perfect_prototype_tp12_touch_parent_lift_bank.mjs"
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
    throw new Error(`touch parent-lift report missing frozen catalog path for run=${scopeRunId}`)
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
    throw new Error(`touch parent-lift input pack is empty: ${inputPath}`)
  }
  const symbolAllowSet = new Set(sourceRows.map((row) => toText(row?.symbol)).filter(Boolean))
  const candleRows = await readJsonl(candlePath, {
    filter: (row) => symbolAllowSet.has(String(row?.symbol ?? "").trim()),
  })
  const seriesMap = buildCandleSeriesMap(candleRows, symbolAllowSet)
  const missingSymbols = Array.from(symbolAllowSet).filter((symbol) => !seriesMap.has(symbol))
  if (missingSymbols.length > 0) {
    throw new Error(
      `touch parent-lift missing candle series for ${missingSymbols.length} symbols; first=${missingSymbols.slice(0, 10).join(",")}`,
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
    throw new Error(`touch parent-lift normalized ${unusableRows.length} unusable touch rows from ${inputPath}`)
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

const mergeTermBanks = ({ baseTermBank = {}, parentLiftBank = {} } = {}) => {
  const termById = new Map()
  for (const term of Array.isArray(baseTermBank?.qualifiedTerms) ? baseTermBank.qualifiedTerms : []) {
    termById.set(term.termId, term)
  }
  for (const term of Array.isArray(parentLiftBank?.qualifiedTerms) ? parentLiftBank.qualifiedTerms : []) {
    termById.set(term.termId, term)
  }
  const qualifiedTerms = Array.from(termById.values()).sort((left, right) => String(left?.termId ?? "").localeCompare(String(right?.termId ?? "")))
  const roleCounts = {
    ...(baseTermBank?.summary?.roleCounts ?? {}),
    parent_lift: toNumber(parentLiftBank?.summary?.roleCounts?.parent_lift, 0),
  }
  return {
    summary: {
      candidateTermCount: toNumber(baseTermBank?.summary?.candidateTermCount, 0) + toNumber(parentLiftBank?.candidateCount, 0),
      qualifiedTermCount: qualifiedTerms.length,
      baseQualifiedTermCount: toNumber(baseTermBank?.summary?.qualifiedTermCount, 0),
      parentLiftQualifiedTermCount: toNumber(parentLiftBank?.qualifiedTermCount, 0),
      roleCounts,
    },
    qualifiedTerms,
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
  qualifiedCandidates,
  baseTermBank,
  seedBundle,
  parentLiftBank,
  combinedLabelMatrix,
  finalBundle,
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
  baseTermBank: baseTermBank.summary,
  seedBundle: {
    termIds: seedBundle?.positiveBundle?.termIds ?? [],
    termCount: (seedBundle?.positiveBundle?.termIds ?? []).length,
    trainSummary: seedBundle?.finalBundle?.trainSummary ?? null,
    oosSummary: seedBundle?.finalBundle?.oosSummary ?? null,
    objective: seedBundle?.finalBundle?.objective ?? null,
  },
  parentLiftBank: parentLiftBank.summary,
  combinedLabelMatrix: combinedLabelMatrix.summary,
  parentLiftBundle: {
    ok: finalBundle?.ok === true,
    initialPositiveTermIds: finalBundle?.initialPositiveTermIds ?? [],
    positiveBundle: {
      termIds: finalBundle?.positiveBundle?.termIds ?? [],
      termCount: (finalBundle?.positiveBundle?.termIds ?? []).length,
      trainSummary: finalBundle?.positiveBundle?.trainSummary ?? null,
      oosSummary: finalBundle?.positiveBundle?.oosSummary ?? null,
      objective: finalBundle?.positiveBundle?.objective ?? null,
      traceCount: (finalBundle?.positiveBundle?.trace ?? []).length,
    },
    vetoBuilder: {
      candidateCount: finalBundle?.vetoBuilder?.candidateCount ?? 0,
      negativeSelectedRowCount: finalBundle?.vetoBuilder?.negativeSelectedRowCount ?? 0,
      positiveSelectedRowCount: finalBundle?.vetoBuilder?.positiveSelectedRowCount ?? 0,
    },
    vetoBundle: {
      selectedTokens: finalBundle?.vetoBundle?.selectedTokens ?? [],
      tokenCount: (finalBundle?.vetoBundle?.selectedTokens ?? []).length,
      trainSummary: finalBundle?.vetoBundle?.trainSummary ?? null,
      oosSummary: finalBundle?.vetoBundle?.oosSummary ?? null,
      objective: finalBundle?.vetoBundle?.objective ?? null,
    },
    finalBundle: {
      trainSummary: finalBundle?.finalBundle?.trainSummary ?? null,
      oosSummary: finalBundle?.finalBundle?.oosSummary ?? null,
      objective: finalBundle?.finalBundle?.objective ?? null,
      trainVetoedRowCount: (finalBundle?.finalBundle?.trainVetoedRows ?? []).length,
      oosVetoedRowCount: (finalBundle?.finalBundle?.oosVetoedRows ?? []).length,
    },
  },
  verdict,
})

const buildReport = ({ summary }) => {
  const baselineOos = summary?.baselineTouch?.oos ?? {}
  const seedBundle = summary?.seedBundle ?? {}
  const parentLift = summary?.parentLiftBank ?? {}
  const bundle = summary?.parentLiftBundle ?? {}
  const positive = bundle?.positiveBundle ?? {}
  const final = bundle?.finalBundle ?? {}
  return [
    "# 1D TP12 Touch Parent-Lift Bundle",
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
    `- OOS zero-negative rules: ${toNumber(baselineOos?.aggregate?.zeroNegativeRuleCount, 0)}`,
    `- OOS perfect >=3 dates: ${toNumber(baselineOos?.aggregate?.perfectDateFloor3RuleCount, 0)}`,
    `- raw touch line: ${toNumber(baselineOos?.lineSummary?.hitRows, 0)}/${toNumber(baselineOos?.lineSummary?.selectedRows, 0)} = ${pct(baselineOos?.lineSummary?.hitRate)}`,
    `- raw touch breadth: ${toNumber(baselineOos?.lineSummary?.selectedHitDateCount, 0)} hit dates / ${toNumber(baselineOos?.lineSummary?.selectedDatesCount, 0)} selected dates`,
    "",
    "## Seed Bundle",
    "",
    `- selected terms: ${toNumber(seedBundle?.termCount, 0)}`,
    `- train summary: ${toNumber(seedBundle?.trainSummary?.positiveRowCount, 0)}/${toNumber(seedBundle?.trainSummary?.selectedRowCount, 0)} = ${pct(seedBundle?.trainSummary?.precision)}`,
    `- OOS summary: ${toNumber(seedBundle?.oosSummary?.positiveRowCount, 0)}/${toNumber(seedBundle?.oosSummary?.selectedRowCount, 0)} = ${pct(seedBundle?.oosSummary?.precision)}`,
    "",
    "## Parent-Lift Bank",
    "",
    `- seed clusters: ${(parentLift?.seedClusterIds ?? []).length}`,
    `- raw parent candidates: ${toNumber(parentLift?.candidateCount, 0)}`,
    `- qualified parent terms: ${toNumber(parentLift?.qualifiedTermCount, 0)}`,
    `- label-matrix train rows with any term: ${toNumber(summary?.combinedLabelMatrix?.trainRowsWithAnyTerm, 0)}`,
    `- label-matrix OOS rows with any term: ${toNumber(summary?.combinedLabelMatrix?.oosRowsWithAnyTerm, 0)}`,
    "",
    "## Final Parent-Lift Bundle",
    "",
    `- selected terms: ${toNumber(positive?.termCount, 0)}`,
    `- selected veto tokens: ${toNumber(bundle?.vetoBundle?.tokenCount, 0)}`,
    `- train summary: ${toNumber(final?.trainSummary?.positiveRowCount, 0)}/${toNumber(final?.trainSummary?.selectedRowCount, 0)} = ${pct(final?.trainSummary?.precision)}`,
    `- train breadth: ${toNumber(final?.trainSummary?.matchedDateCount, 0)} dates / ${toNumber(final?.trainSummary?.matchedMonthCount, 0)} months / ${toNumber(final?.trainSummary?.matchedFoldCount, 0)} folds`,
    `- OOS summary: ${toNumber(final?.oosSummary?.positiveRowCount, 0)}/${toNumber(final?.oosSummary?.selectedRowCount, 0)} = ${pct(final?.oosSummary?.precision)}`,
    `- OOS breadth: ${toNumber(final?.oosSummary?.matchedDateCount, 0)} dates / ${toNumber(final?.oosSummary?.matchedMonthCount, 0)} months / ${toNumber(final?.oosSummary?.matchedFoldCount, 0)} folds`,
    `- OOS top1 date hit share: ${pct(final?.oosSummary?.top1DateHitShare)}`,
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
    toolName: "build_stepb_1d_tp12_touch_parent_lift_report",
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
  const maxSeedClusters = toNumber(getFlag(parsed.flags, "max-seed-clusters", 2), 2)
  const maxParentTerms = toNumber(getFlag(parsed.flags, "max-parent-terms", 12), 12)
  const minParentTrainSelectedRows = toNumber(getFlag(parsed.flags, "min-parent-train-selected-rows", 12), 12)
  const minParentTrainDates = toNumber(getFlag(parsed.flags, "min-parent-train-dates", 10), 10)
  const minParentTrainMonths = toNumber(getFlag(parsed.flags, "min-parent-train-months", 6), 6)
  const minParentTrainFolds = toNumber(getFlag(parsed.flags, "min-parent-train-folds", 4), 4)
  const minParentTrainPrecision = Number(getFlag(parsed.flags, "min-parent-train-precision", 0.34))
  const minTermTrainPrecision = Number(getFlag(parsed.flags, "min-term-train-precision", 0.3))
  const minTermTrainDates = toNumber(getFlag(parsed.flags, "min-term-train-dates", 3), 3)
  const maxPositiveTerms = toNumber(getFlag(parsed.flags, "max-positive-terms", 10), 10)
  const maxVetoTokens = toNumber(getFlag(parsed.flags, "max-veto-tokens", 2), 2)
  const minPositiveImprovement = Number(getFlag(parsed.flags, "min-positive-improvement", 0.005))
  const minPositiveNewDateGain = toNumber(getFlag(parsed.flags, "min-positive-new-date-gain", 1), 1)
  const minPositiveNewRowGain = toNumber(getFlag(parsed.flags, "min-positive-new-row-gain", 1), 1)
  const minVetoImprovement = Number(getFlag(parsed.flags, "min-veto-improvement", 0.005))
  const minTrainTermMonths = toNumber(getFlag(parsed.flags, "min-train-term-months", 2), 2)
  const minTrainTermFolds = toNumber(getFlag(parsed.flags, "min-train-term-folds", 3), 3)
  const minSelectedRowsAfterVeto = toNumber(getFlag(parsed.flags, "min-selected-rows-after-veto", 20), 20)
  const minSelectedDatesAfterVeto = toNumber(getFlag(parsed.flags, "min-selected-dates-after-veto", 12), 12)
  const maxTop1DateHitShare = Number(getFlag(parsed.flags, "max-top1-date-hit-share", 0.2))
  const maxSelectedDonorTerms = toNumber(getFlag(parsed.flags, "max-selected-donor-terms", 3), 3)
  const maxSelectedClusterTerms = toNumber(getFlag(parsed.flags, "max-selected-cluster-terms", 3), 3)
  const maxSelectedBroadenedTerms = toNumber(getFlag(parsed.flags, "max-selected-broadened-terms", 3), 3)
  const maxSelectedParentTerms = toNumber(getFlag(parsed.flags, "max-selected-parent-terms", 4), 4)
  const minVetoNegativeHits = toNumber(getFlag(parsed.flags, "min-veto-negative-hits", 4), 4)
  const minVetoNetGain = toNumber(getFlag(parsed.flags, "min-veto-net-gain", 1), 1)
  const minVerdictOosSelectedRows = toNumber(getFlag(parsed.flags, "min-verdict-oos-selected-rows", 40), 40)
  const minVerdictOosDates = toNumber(getFlag(parsed.flags, "min-verdict-oos-dates", 20), 20)
  const maxVerdictOosTop1DateHitShare = Number(getFlag(parsed.flags, "max-verdict-oos-top1-date-hit-share", 0.15))

  if (!scopeRunId || !outDir) {
    throw new Error(
      "Usage: node tools/build_stepb_1d_tp12_touch_parent_lift_report.mjs --scope-run-id=<child_run_id> --out-dir=<dir> [--scope-label=LOW_GAP_TOP] [--candle-path=<data/candle_daily.jsonl>]",
    )
  }

  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "outDir", filePath: outDir },
      { label: "candlePath", filePath: candlePath, allowedRoot: policy.dataRoot },
    ],
    policy,
    toolName: "build_stepb_1d_tp12_touch_parent_lift_report",
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
    toolName: "build_stepb_1d_tp12_touch_parent_lift_report",
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
  const touchTrain = evaluateTouchContract({ rows: touchTrainRows, rules, selectionMode: scope.selectionMode, foldScheme })
  const touchOos = evaluateTouchContract({ rows: touchOosRows, rules, selectionMode: scope.selectionMode, foldScheme })

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

  const baseTermBank = buildTp12TouchBundleTermBank({
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
  const baseLabelMatrix = buildTp12TouchLabelMatrix({
    termBank: baseTermBank,
    trainRows: touchTrainRows,
    oosRows: touchOosRows,
  })
  const seedBundle = selectTp12TouchCoveragePreservingBundle({
    labelMatrix: baseLabelMatrix,
    maxPositiveTerms: 8,
    maxVetoTokens: 2,
    minPositiveImprovement: 0.01,
    minVetoImprovement: 0.005,
    minTermTrainPrecision,
    minTermTrainDates,
    minTrainTermMonths,
    minTrainTermFolds,
    minSelectedRowsAfterVeto: 60,
    minSelectedDatesAfterVeto: 15,
    maxTop1DateHitShare: 0.2,
    maxPositiveTermsPerRole: {
      donor_exact: 3,
      cluster_any: 3,
      broadened_rule: 3,
      parent_lift: 0,
    },
    minVetoNegativeHits,
    minVetoNetGain,
  })

  const parentLiftBank = buildTp12TouchParentLiftBank({
    donorManifest,
    donorClusters,
    qualifiedCandidates,
    termBank: baseTermBank,
    bundle: seedBundle,
    trainRows: touchTrainRows,
    oosRows: touchOosRows,
    maxSeedClusters,
    maxParentTerms,
    minTrainSelectedRows: minParentTrainSelectedRows,
    minTrainDates: minParentTrainDates,
    minTrainMonths: minParentTrainMonths,
    minTrainFolds: minParentTrainFolds,
    minTrainPrecision: minParentTrainPrecision,
  })

  const combinedTermBank = mergeTermBanks({
    baseTermBank,
    parentLiftBank,
  })
  const combinedLabelMatrix = buildTp12TouchLabelMatrix({
    termBank: combinedTermBank,
    trainRows: touchTrainRows,
    oosRows: touchOosRows,
  })
  const finalBundle = selectTp12TouchCoveragePreservingBundle({
    labelMatrix: combinedLabelMatrix,
    maxPositiveTerms,
    maxVetoTokens,
    minPositiveImprovement,
    minVetoImprovement,
    minTermTrainPrecision,
    minTermTrainDates,
    minTrainTermMonths,
    minTrainTermFolds,
    minSelectedRowsAfterVeto,
    minSelectedDatesAfterVeto,
    maxTop1DateHitShare,
    maxPositiveTermsPerRole: {
      donor_exact: maxSelectedDonorTerms,
      cluster_any: maxSelectedClusterTerms,
      broadened_rule: maxSelectedBroadenedTerms,
      parent_lift: maxSelectedParentTerms,
    },
    minVetoNegativeHits,
    minVetoNetGain,
    initialPositiveTermIds: seedBundle?.positiveBundle?.termIds ?? [],
    minPositiveNewDateGain,
    minPositiveNewRowGain,
  })

  const verdict = buildTp12TouchBundleUnionVerdict({
    baselineOosLineSummary: touchOos.lineSummary,
    bundle: finalBundle,
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
    baseTermBank,
    seedBundle,
    parentLiftBank,
    combinedLabelMatrix,
    finalBundle,
    verdict,
  })
  const report = buildReport({ summary })

  await Promise.all([
    writeJson(path.join(outDir, "touch_parent_lift_summary.json"), summary),
    writeJson(path.join(outDir, "touch_parent_lift_verdict.json"), verdict),
    writeJson(path.join(outDir, "touch_parent_lift_term_bank.json"), baseTermBank),
    writeJson(path.join(outDir, "touch_parent_lift_seed_bundle.json"), seedBundle),
    writeJson(path.join(outDir, "touch_parent_lift_parent_bank.json"), parentLiftBank),
    writeJson(path.join(outDir, "touch_parent_lift_label_matrix.json"), combinedLabelMatrix.summary),
    writeJson(path.join(outDir, "touch_parent_lift_result.json"), finalBundle),
    writeJson(path.join(outDir, "touch_donor_manifest.json"), donorManifest),
    writeJson(path.join(outDir, "touch_donor_clusters.json"), donorClusters),
    writeJson(path.join(outDir, "touch_broadened_qualified_candidates.json"), qualifiedCandidates),
    writeJsonl(path.join(outDir, "touch_parent_lift_selected_oos_rows.jsonl"), buildBundleRows(finalBundle?.finalBundle?.oosSelectedRows, { stage: "oos_selected" })),
    writeJsonl(path.join(outDir, "touch_parent_lift_selected_train_rows.jsonl"), buildBundleRows(finalBundle?.finalBundle?.trainSelectedRows, { stage: "train_selected" })),
    writeJsonl(path.join(outDir, "touch_parent_lift_vetoed_train_rows.jsonl"), buildBundleRows(finalBundle?.finalBundle?.trainVetoedRows, { stage: "train_vetoed" })),
    writeJsonl(path.join(outDir, "touch_parent_lift_vetoed_oos_rows.jsonl"), buildBundleRows(finalBundle?.finalBundle?.oosVetoedRows, { stage: "oos_vetoed" })),
    fs.writeFile(path.join(outDir, "report.md"), report, "utf8"),
  ])

  console.log(JSON.stringify({
    outDir,
    summaryPath: path.join(outDir, "touch_parent_lift_summary.json"),
    reportPath: path.join(outDir, "report.md"),
    verdict,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
