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
  buildTp12CleanRuleSets,
  buildTp12ContractSplitBridgeMetrics,
  buildTp12TouchFoldKeyLookup,
  buildTp12TouchLineSummary,
  buildTp12TouchRuleSummaries,
} from "../src/lib/perfect_prototype_tp12_contract_split_metrics.mjs"
import {
  buildTp12ProbeRunPaths,
  pct,
  summarizeTp12ProbeVariant,
  toNumber,
  toText,
  TP12_PROBE_CONTRACT,
} from "../src/lib/perfect_prototype_tp12_probe_metrics.mjs"
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
  const base = buildTp12ProbeRunPaths({ cwd, runId: scopeRunId })
  return {
    ...base,
    trainPackPath: path.join(base.runDir, "step-perfect-prototype-open-train-pack", "daily_pack.jsonl"),
    oosPackPath: path.join(base.runDir, "step-perfect-prototype-open-oos-pack", "daily_pack.jsonl"),
  }
}

const loadScopeBundle = async ({ cwd, scopeRunId }) => {
  const paths = readScopePaths({ cwd, scopeRunId })
  const [freezeResult, openEvalManifest, cleanLeaderboard] = await Promise.all([
    readJson(paths.freezeResultPath, null),
    readJson(paths.openEvalManifestPath, null),
    readJson(paths.selectionLeaderboardPath, []),
  ])
  const frozenCatalogPath = toText(freezeResult?.outPath)
  if (!frozenCatalogPath) {
    throw new Error(`contract split report missing frozen catalog path for run=${scopeRunId}`)
  }
  const catalog = await loadPerfectPrototypeCatalog(frozenCatalogPath, { requireFrozen: true })
  const selectionMode = toText(openEvalManifest?.selectionMode) ?? "union_all"
  const cleanSummary = await summarizeTp12ProbeVariant({
    cwd,
    runId: scopeRunId,
    exitCode: 0,
    wallClockSec: null,
    label: "clean_validation",
  })
  return {
    paths,
    catalog,
    selectionMode,
    cleanSummary,
    cleanLeaderboard: Array.isArray(cleanLeaderboard) ? cleanLeaderboard : [],
  }
}

const loadTouchRows = async ({ inputPath, catalog, candlePath, holdDays, targetPct, stopLossPct }) => {
  const sourceRows = await readJsonl(inputPath)
  if (sourceRows.length < 1) {
    throw new Error(`contract split input pack is empty: ${inputPath}`)
  }
  const symbolAllowSet = new Set(sourceRows.map((row) => toText(row?.symbol)).filter(Boolean))
  const candleRows = await readJsonl(candlePath, {
    filter: (row) => symbolAllowSet.has(String(row?.symbol ?? "").trim()),
  })
  const seriesMap = buildCandleSeriesMap(candleRows, symbolAllowSet)
  const missingSymbols = Array.from(symbolAllowSet).filter((symbol) => !seriesMap.has(symbol))
  if (missingSymbols.length > 0) {
    throw new Error(
      `contract split missing candle series for ${missingSymbols.length} symbols; first=${missingSymbols.slice(0, 10).join(",")}`,
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
  const unusableRows = normalizedRows.filter(
    (row) => !row?.dateKey || typeof row?.outcomeHitTarget !== "boolean",
  )
  if (unusableRows.length > 0) {
    throw new Error(`contract split normalized ${unusableRows.length} unusable touch rows from ${inputPath}`)
  }
  return normalizedRows
}

const evaluateTouchContract = ({ rows, rules, catalog, selectionMode, foldScheme }) => {
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
  let matchedTouchHitRows = 0
  let matchedTouchStopBeforeTouchRows = 0
  for (const row of Array.isArray(rows) ? rows : []) {
    const tokenSet = new Set(tokenizePerfectPrototypeRow(row, catalog?.tokenizerSpec))
    const candidateRules = selectPerfectPrototypeCandidateRules({
      tokenSet,
      matchIndex: ruleMatchIndex,
    })
    const matchedRules = candidateRules
      .filter((rule) => matchPerfectPrototypeRule(tokenSet, rule))
      .sort((left, right) => Number(left?.rank ?? Number.MAX_SAFE_INTEGER) - Number(right?.rank ?? Number.MAX_SAFE_INTEGER))
    if (matchedRules.length < 1) continue
    if (row?.outcomeHitTarget === true) {
      matchedTouchHitRows += 1
      if (row?.raw?.touchOutcome?.stopBeforeTouch === true) {
        matchedTouchStopBeforeTouchRows += 1
      }
    }
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
  })
  return {
    ruleRows: ruleSummary.rows,
    aggregate: {
      ...ruleSummary.aggregate,
      matchedTouchHitRows,
      matchedTouchStopBeforeTouchRows,
      matchedTouchStopBeforeTouchShare:
        matchedTouchHitRows > 0 ? matchedTouchStopBeforeTouchRows / matchedTouchHitRows : 0,
    },
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

const buildVerdict = ({ touchTrain, touchOos, cleanSummary, bridge }) => {
  const cleanQuality = cleanSummary?.quality ?? {}
  if (
    toNumber(touchOos?.aggregate?.perfectDateFloor3RuleCount, 0) > 0 &&
    toNumber(cleanQuality?.oosPerfectDateFloor3RuleCount, 0) === 0
  ) {
    return {
      code: "signal_exists_clean_contract_blocks",
      message: "Touch discovery finds repeated perfect TP12 rules, but the current TP12/SL4 clean contract does not retain them.",
    }
  }
  if (
    toNumber(touchTrain?.aggregate?.promotableBreadthRuleCount, 0) > 0 &&
    toNumber(touchOos?.aggregate?.perfectDateFloor3RuleCount, 0) === 0
  ) {
    return {
      code: "train_touch_signal_only",
      message: "Touch discovery creates promotable train breadth, but repeated OOS-perfect touch rules still do not survive.",
    }
  }
  if (
    toNumber(touchTrain?.aggregate?.promotableBreadthRuleCount, 0) === 0 &&
    toNumber(touchOos?.aggregate?.perfectDateFloor3RuleCount, 0) === 0
  ) {
    return {
      code: "no_broad_touch_signal",
      message: "Even the broader touch discovery contract does not create promotable or repeated OOS-perfect TP12 rules in this scope.",
    }
  }
  if (toNumber(bridge?.retainedOosPerfectDateFloor3RuleCount, 0) > 0) {
    return {
      code: "touch_and_clean_both_live",
      message: "Repeated OOS-perfect rules survive in both touch discovery and clean validation contracts.",
    }
  }
  return {
    code: "mixed_or_inconclusive",
    message: "Touch discovery changes the rule mix, but the signal-vs-execution split is still inconclusive.",
  }
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const policy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "build_stepb_1d_tp12_contract_split_report",
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
  if (!scopeRunId || !outDir) {
    throw new Error(
      "Usage: node tools/build_stepb_1d_tp12_contract_split_report.mjs --scope-run-id=<child_run_id> --out-dir=<dir> [--scope-label=LOW_GAP_TOP] [--candle-path=<data/candle_daily.jsonl>] [--fold-scheme=chronological_4]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "outDir", filePath: outDir },
      { label: "candlePath", filePath: candlePath, allowedRoot: policy.dataRoot },
    ],
    policy,
    toolName: "build_stepb_1d_tp12_contract_split_report",
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
    toolName: "build_stepb_1d_tp12_contract_split_report",
  })

  const touchTrainRows = await loadTouchRows({
    inputPath: scopePaths.trainPackPath,
    catalog: scope.catalog,
    candlePath,
    holdDays,
    targetPct,
    stopLossPct,
  })
  const touchOosRows = await loadTouchRows({
    inputPath: scopePaths.oosPackPath,
    catalog: scope.catalog,
    candlePath,
    holdDays,
    targetPct,
    stopLossPct,
  })

  const rules = selectPerfectPrototypeRules(scope.catalog, scope.selectionMode)
  const touchTrain = evaluateTouchContract({
    rows: touchTrainRows,
    rules,
    catalog: scope.catalog,
    selectionMode: scope.selectionMode,
    foldScheme,
  })
  const touchOos = evaluateTouchContract({
    rows: touchOosRows,
    rules,
    catalog: scope.catalog,
    selectionMode: scope.selectionMode,
    foldScheme,
  })
  const cleanRuleSets = buildTp12CleanRuleSets(scope.cleanLeaderboard)
  const bridge = buildTp12ContractSplitBridgeMetrics({
    touchTrainPromotableRuleIds: touchTrain.ruleSets.promotableRuleIds,
    touchOosZeroNegativeRuleIds: touchOos.ruleSets.zeroNegativeRuleIds,
    touchOosPerfectDateFloor3RuleIds: touchOos.ruleSets.perfectDateFloor3RuleIds,
    cleanTrainPromotableRuleIds: cleanRuleSets.cleanTrainPromotableRuleIds,
    cleanOosZeroNegativeRuleIds: cleanRuleSets.cleanOosZeroNegativeRuleIds,
    cleanOosPerfectDateFloor3RuleIds: cleanRuleSets.cleanOosPerfectDateFloor3RuleIds,
  })
  const verdict = buildVerdict({
    touchTrain,
    touchOos,
    cleanSummary: scope.cleanSummary,
    bridge,
  })

  const summary = {
    scopeRunId,
    scopeLabel,
    contract: {
      cleanValidation: TP12_PROBE_CONTRACT,
      touchDiscovery: {
        ...TP12_TOUCH_DISCOVERY_CONTRACT,
        holdDays,
        targetPct,
        stopLossPct,
      },
      foldScheme,
      selectionMode: scope.selectionMode,
    },
    clean: {
      label: scope.cleanSummary?.label ?? "clean_validation",
      status: scope.cleanSummary?.status ?? null,
      quality: scope.cleanSummary?.quality ?? {},
      speed: scope.cleanSummary?.speed ?? {},
    },
    touchDiscovery: {
      train: {
        aggregate: touchTrain.aggregate,
        lineSummary: touchTrain.lineSummary,
      },
      oos: {
        aggregate: touchOos.aggregate,
        lineSummary: touchOos.lineSummary,
      },
    },
    bridge,
    verdict,
  }

  const report = [
    "# 1D TP12 Contract Split",
    "",
    "## Scope",
    "",
    `- source scope run: \`${scopeRunId}\``,
    `- scope label: \`${scopeLabel ?? "n/a"}\``,
    `- selection mode: \`${scope.selectionMode}\``,
    `- touch discovery contract: \`NEXT_DAY_OPEN / ${holdDays}d / +${(targetPct * 100).toFixed(0)}% touch / no stop gate\``,
    `- clean validation contract: \`${TP12_PROBE_CONTRACT.entry} / ${TP12_PROBE_CONTRACT.holdDays}d / 12% / 4%\``,
    "",
    "## Clean Validation",
    "",
    `- train promotable breadth 10/6/4: ${toNumber(scope.cleanSummary?.quality?.trainPromotableBreadthRuleCount, 0)}`,
    `- OOS zero-negative rules: ${toNumber(scope.cleanSummary?.quality?.zeroNegativeRuleCount, 0)}`,
    `- OOS perfect >=3 dates: ${toNumber(scope.cleanSummary?.quality?.oosPerfectDateFloor3RuleCount, 0)}`,
    `- close28 line: ${toNumber(scope.cleanSummary?.quality?.close28HitRows, 0)}/${toNumber(scope.cleanSummary?.quality?.close28SelectedRows, 0)} = ${pct(scope.cleanSummary?.quality?.lineLevelHitRate)}`,
    "",
    "## Touch Discovery",
    "",
    `- train promotable breadth 10/6/4: ${toNumber(touchTrain.aggregate?.promotableBreadthRuleCount, 0)}`,
    `- OOS zero-negative rules: ${toNumber(touchOos.aggregate?.zeroNegativeRuleCount, 0)}`,
    `- OOS perfect >=3 dates: ${toNumber(touchOos.aggregate?.perfectDateFloor3RuleCount, 0)}`,
    `- raw touch line: ${toNumber(touchOos.lineSummary?.hitRows, 0)}/${toNumber(touchOos.lineSummary?.selectedRows, 0)} = ${pct(touchOos.lineSummary?.hitRate)}`,
    `- matched touch hits with clean stop-before-touch: ${toNumber(touchOos.aggregate?.matchedTouchStopBeforeTouchRows, 0)}/${toNumber(touchOos.aggregate?.matchedTouchHitRows, 0)} = ${pct(touchOos.aggregate?.matchedTouchStopBeforeTouchShare)}`,
    "",
    "## Bridge",
    "",
    `- retained train promotable rules: ${toNumber(bridge?.retainedTrainPromotableRuleCount, 0)}/${toNumber(bridge?.touchTrainPromotableRuleCount, 0)}`,
    `- retained OOS zero-negative rules: ${toNumber(bridge?.retainedOosZeroNegativeRuleCount, 0)}/${toNumber(bridge?.touchOosZeroNegativeRuleCount, 0)}`,
    `- retained OOS perfect >=3-date rules: ${toNumber(bridge?.retainedOosPerfectDateFloor3RuleCount, 0)}/${toNumber(bridge?.touchOosPerfectDateFloor3RuleCount, 0)}`,
    `- verdict: \`${verdict.code}\``,
    `- note: ${verdict.message}`,
    "",
  ].join("\n")

  await writeJson(path.join(outDir, "contract_split_summary.json"), summary)
  await writeJson(path.join(outDir, "contract_split_verdict.json"), verdict)
  await writeJson(path.join(outDir, "touch_train_rule_report.json"), touchTrain.ruleRows)
  await writeJson(path.join(outDir, "touch_oos_rule_report.json"), touchOos.ruleRows)
  await writeJsonl(path.join(outDir, "touch_oos_matches.jsonl"), touchOos.matches)
  await writeJsonl(path.join(outDir, "touch_oos_deduped_symbols.jsonl"), touchOos.dedupedMatches)
  await fs.writeFile(path.join(outDir, "report.md"), `${report}\n`, "utf8")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
