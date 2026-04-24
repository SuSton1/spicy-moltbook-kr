import fs from "node:fs/promises"
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildCandleSeriesMap } from "../src/lib/data.mjs"
import { createPerfectPrototypeMatchAccumulator } from "../src/lib/perfect_prototype_dedupe.mjs"
import { ensureDir, pathExists, readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"
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
  TP12_EXECUTION_POLICY_MENU_STOP_RECOVERY_V1,
  simulateTp12ExecutionPolicyFromDecision,
} from "../src/lib/perfect_prototype_tp12_execution_policy.mjs"
import {
  relabelPerfectPrototypeRowForTp12TouchContract,
  TP12_TOUCH_DISCOVERY_CONTRACT,
} from "../src/lib/perfect_prototype_tp12_touch_contract.mjs"
import {
  buildTp12ProbeRunPaths,
  pct,
  summarizeTp12ProbeVariant,
  toNumber,
  toText,
  TP12_PROBE_CONTRACT,
} from "../src/lib/perfect_prototype_tp12_probe_metrics.mjs"
import { normalizePerfectPrototypeRow, tokenizePerfectPrototypeRow } from "../src/lib/perfect_prototype_tokenizer.mjs"

const uniqueSorted = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const round = (value, digits = 6) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Number(n.toFixed(digits))
}

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
  const [freezeResult, openEvalManifest] = await Promise.all([
    readJson(paths.freezeResultPath, null),
    readJson(paths.openEvalManifestPath, null),
  ])
  const frozenCatalogPath = toText(freezeResult?.outPath)
  if (!frozenCatalogPath) {
    throw new Error(`execution menu report missing frozen catalog path for run=${scopeRunId}`)
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
  }
}

const loadRows = async ({ inputPath, label }) => {
  const rows = await readJsonl(inputPath)
  if (rows.length < 1) {
    throw new Error(`execution menu ${label} input pack is empty: ${inputPath}`)
  }
  return rows
}

const buildSeriesMapForRows = async ({ rowGroups, candlePath }) => {
  const symbolAllowSet = new Set(
    Object.values(rowGroups ?? {})
      .flatMap((rows) => (Array.isArray(rows) ? rows : []))
      .map((row) => toText(row?.symbol))
      .filter(Boolean),
  )
  const candleRows = await readJsonl(candlePath, {
    filter: (row) => symbolAllowSet.has(String(row?.symbol ?? "").trim()),
  })
  const seriesMap = buildCandleSeriesMap(candleRows, symbolAllowSet)
  const missingSymbols = Array.from(symbolAllowSet).filter((symbol) => !seriesMap.has(symbol))
  if (missingSymbols.length > 0) {
    throw new Error(
      `execution menu missing candle series for ${missingSymbols.length} symbols; first=${missingSymbols.slice(0, 10).join(",")}`,
    )
  }
  return seriesMap
}

const relabelTouchRows = ({ rows, seriesMap, catalog, holdDays, targetPct, stopLossPct, label }) => {
  const relabeledRows = (Array.isArray(rows) ? rows : []).map((row) =>
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
    throw new Error(`execution menu normalized ${unusableRows.length} unusable ${label} touch rows`)
  }
  return normalizedRows
}

const evaluateTouchContractRich = ({ rows, rules, catalog, selectionMode, foldScheme }) => {
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

    const isTouchHit = row?.outcomeHitTarget === true
    const touchOutcome = row?.touchOutcome ?? row?.raw?.touchOutcome ?? null
    const cleanOutcomeHitTarget = row?.cleanOutcomeHitTarget === true || row?.raw?.cleanOutcomeHitTarget === true
    const decisionIdx =
      Number.isInteger(row?.decisionIdx)
        ? row.decisionIdx
        : Number.isInteger(row?.raw?.decisionIdx)
          ? row.raw.decisionIdx
          : null

    if (isTouchHit) {
      matchedTouchHitRows += 1
      if (touchOutcome?.stopBeforeTouch === true) {
        matchedTouchStopBeforeTouchRows += 1
      }
    }
    for (const rule of matchedRules) {
      const stat = ruleStats.get(rule.ruleId)
      stat.matchCount += 1
      stat.matchedDates.push(row.dateKey)
      if (isTouchHit) {
        stat.hitCount += 1
        stat.hitDates.push(row.dateKey)
      } else {
        stat.negativeCount += 1
      }
    }
    matchAccumulator.consume({
      ...row,
      sourceType: row?.sourceType ?? row?.raw?.sourceType ?? null,
      sourceId: row?.sourceId ?? row?.raw?.sourceId ?? null,
      dateKey: row?.dateKey ?? row?.raw?.dateKey ?? null,
      symbol: row?.symbol ?? row?.raw?.symbol ?? null,
      decisionIdx,
      outcomeHitTarget: isTouchHit,
      cleanOutcomeHitTarget,
      touchOutcome,
      touchStopBeforeTouch: touchOutcome?.stopBeforeTouch === true,
      matchedRuleIds: matchedRules.map((rule) => rule.ruleId),
      matchedRuleCount: matchedRules.length,
      primaryRuleId: matchedRules[0]?.ruleId ?? null,
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
    lineSummary: buildTp12TouchLineSummary({ dedupedMatches: finalized.dedupedMatches }),
    matches: finalized.symbolDayDedupedMatches,
    dedupedMatches: finalized.dedupedMatches,
  }
}

const summarizeExecutionRows = ({ rows }) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const hitRows = safeRows.filter((row) => row?.hitTarget === true)
  const stopRows = safeRows.filter((row) => row?.hitStop === true)
  const timeoutRows = safeRows.filter((row) => row?.exitReason === "TIMEOUT")
  const timeoutPositiveRows = timeoutRows.filter((row) => row?.timeoutPositive === true)
  const timeoutNegativeRows = timeoutRows.filter((row) => row?.timeoutNegative === true)
  const uniqueMatchedDates = uniqueSorted(safeRows.map((row) => row?.decisionDateKey).filter(Boolean)).length
  const netRetSum = safeRows.reduce((sum, row) => sum + Number(row?.netRet ?? 0), 0)
  const grossRetSum = safeRows.reduce((sum, row) => sum + Number(row?.grossRet ?? 0), 0)
  return {
    selectedRows: safeRows.length,
    hitRows: hitRows.length,
    targetHitRate: safeRows.length > 0 ? hitRows.length / safeRows.length : 0,
    uniqueMatchedDates,
    targetHitsPer20TradingDays: uniqueMatchedDates > 0 ? (hitRows.length / uniqueMatchedDates) * 20 : 0,
    stopRows: stopRows.length,
    stopRate: safeRows.length > 0 ? stopRows.length / safeRows.length : 0,
    timeoutRows: timeoutRows.length,
    timeoutPositiveRows: timeoutPositiveRows.length,
    timeoutNegativeRows: timeoutNegativeRows.length,
    timeoutNegativeRate: safeRows.length > 0 ? timeoutNegativeRows.length / safeRows.length : 0,
    avgNetRet: safeRows.length > 0 ? netRetSum / safeRows.length : 0,
    netRetSum,
    avgGrossRet: safeRows.length > 0 ? grossRetSum / safeRows.length : 0,
    grossRetSum,
  }
}

const simulateExecutionPolicyOnCohort = ({ cohortId, donorRows, seriesMap, policy }) => {
  const rowResults = []
  for (const row of Array.isArray(donorRows) ? donorRows : []) {
    const symbol = toText(row?.symbol)
    const decisionIdx =
      Number.isInteger(row?.decisionIdx)
        ? row.decisionIdx
        : Number.isInteger(row?.raw?.decisionIdx)
          ? row.raw.decisionIdx
          : null
    if (!symbol) {
      throw new Error(`execution donor row missing symbol in cohort=${cohortId}`)
    }
    if (!Number.isInteger(decisionIdx)) {
      throw new Error(`execution donor row missing decisionIdx for symbol=${symbol} cohort=${cohortId}`)
    }
    const series = seriesMap.get(symbol)
    const outcome = simulateTp12ExecutionPolicyFromDecision({
      series,
      decisionIdx,
      policy,
    })
    if (!outcome) {
      throw new Error(`execution policy ${policy.policyId} could not simulate symbol=${symbol} decisionIdx=${decisionIdx}`)
    }
    rowResults.push({
      cohortId,
      policyId: outcome.policyId,
      decisionDateKey: row?.dateKey ?? row?.raw?.dateKey ?? null,
      symbol,
      sourceId: row?.sourceId ?? row?.raw?.sourceId ?? null,
      decisionIdx,
      primaryRuleId: row?.primaryRuleId ?? null,
      matchedRuleIds: Array.isArray(row?.matchedRuleIds) ? row.matchedRuleIds : [],
      matchedRuleCount: Number(row?.matchedRuleCount ?? 0),
      touchOutcomeHitTarget: row?.outcomeHitTarget === true,
      cleanOutcomeHitTarget: row?.cleanOutcomeHitTarget === true,
      touchStopBeforeTouch: row?.touchStopBeforeTouch === true,
      bestOpenOosPrecision: Number.isFinite(Number(row?.bestOpenOosPrecision)) ? Number(row.bestOpenOosPrecision) : null,
      bestOpenOosHitCount: Number.isFinite(Number(row?.bestOpenOosHitCount)) ? Number(row.bestOpenOosHitCount) : null,
      ...outcome,
    })
  }
  return {
    rows: rowResults,
    summary: summarizeExecutionRows({ rows: rowResults }),
  }
}

const sortPolicyResults = (results = []) =>
  (Array.isArray(results) ? results : []).slice().sort((left, right) => {
    const metrics = [
      Number(right?.recent?.targetHitRate ?? -1) - Number(left?.recent?.targetHitRate ?? -1),
      Number(right?.recent?.avgNetRet ?? -999) - Number(left?.recent?.avgNetRet ?? -999),
      Number(right?.oos?.targetHitRate ?? -1) - Number(left?.oos?.targetHitRate ?? -1),
      Number(right?.oos?.avgNetRet ?? -999) - Number(left?.oos?.avgNetRet ?? -999),
      Number(left?.recent?.stopRate ?? 999) - Number(right?.recent?.stopRate ?? 999),
      Number(left?.oos?.stopRate ?? 999) - Number(right?.oos?.stopRate ?? 999),
    ]
    for (const metric of metrics) {
      if (metric !== 0) return metric
    }
    return String(left?.policyId ?? "").localeCompare(String(right?.policyId ?? ""))
  })

const buildVerdict = ({ rankedResults, baselinePolicyId, donorOos, donorRecent }) => {
  const ranked = Array.isArray(rankedResults) ? rankedResults : []
  const baseline = ranked.find((entry) => entry?.policyId === baselinePolicyId) ?? null
  const bestOverall = ranked[0] ?? null
  const bestStopAware = ranked.find((entry) => entry?.stopEnabled === true) ?? null
  if (!baseline || !bestOverall || !bestStopAware) {
    return {
      code: "execution_menu_inconclusive",
      message: "Execution menu did not produce enough comparable policy rows.",
    }
  }

  const bestStopAwareImprovesRecent =
    Number(bestStopAware?.recent?.targetHitRate ?? 0) > Number(baseline?.recent?.targetHitRate ?? 0)
  const bestStopAwareImprovesOos =
    Number(bestStopAware?.oos?.targetHitRate ?? 0) > Number(baseline?.oos?.targetHitRate ?? 0)

  if (bestStopAwareImprovesRecent && bestStopAwareImprovesOos) {
    return {
      code: "stop_recovery_policy_found",
      message: `${bestStopAware.policyId} improves fixed-donor target-hit rate over the baseline stop-first policy on both OOS and recent windows.`,
      bestPolicyId: bestStopAware.policyId,
      baselinePolicyId,
    }
  }

  if (bestOverall?.policyId === "touch_anchor_tp12_no_stop_3d" && !bestStopAwareImprovesRecent) {
    return {
      code: "touch_anchor_only",
      message: `Only the no-stop touch anchor clearly outperforms the baseline; stop-aware variants have not yet recovered the donor cohort cleanly.`,
      bestPolicyId: bestOverall.policyId,
      baselinePolicyId,
    }
  }

  const donorRecentShare = Number(donorRecent?.aggregate?.matchedTouchStopBeforeTouchShare ?? 0)
  const donorOosShare = Number(donorOos?.aggregate?.matchedTouchStopBeforeTouchShare ?? 0)
  if (donorRecentShare > 0.25 || donorOosShare > 0.25) {
    return {
      code: "stop_pressure_confirmed_policy_mixed",
      message: `Stop pressure is material on the donor cohort, but the first stop-recovery menu remains mixed versus the baseline.`,
      bestPolicyId: bestOverall.policyId,
      baselinePolicyId,
    }
  }

  return {
    code: "execution_menu_mixed",
    message: "Execution menu completed, but the ranking remains mixed across OOS and recent windows.",
    bestPolicyId: bestOverall.policyId,
    baselinePolicyId,
  }
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const policy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "build_stepb_1d_tp12_execution_menu_report",
  })
  const scopeRunId = toText(getFlag(parsed.flags, "scope-run-id", ""))
  const scopeLabel = toText(getFlag(parsed.flags, "scope-label", "LOW_GAP_TOP"))
  const recentInputPath = path.resolve(String(getFlag(parsed.flags, "recent-input", "")).trim())
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  const candlePath = path.resolve(
    String(getFlag(parsed.flags, "candle-path", path.join(cwd, "data", "candle_daily.jsonl"))).trim(),
  )
  const foldScheme = toText(getFlag(parsed.flags, "fold-scheme", "chronological_4")) ?? "chronological_4"
  const holdDays = toNumber(getFlag(parsed.flags, "hold-days", TP12_TOUCH_DISCOVERY_CONTRACT.holdDays), TP12_TOUCH_DISCOVERY_CONTRACT.holdDays)
  const targetPct = Number(getFlag(parsed.flags, "target-pct", TP12_TOUCH_DISCOVERY_CONTRACT.targetPct))
  const stopLossPct = Number(getFlag(parsed.flags, "stop-loss-pct", TP12_TOUCH_DISCOVERY_CONTRACT.stopLossPct))
  if (!scopeRunId || !recentInputPath || !outDir) {
    throw new Error(
      "Usage: node tools/build_stepb_1d_tp12_execution_menu_report.mjs --scope-run-id=<child_run_id> --recent-input=<recent_low_gap_top_daily_pack.jsonl> --out-dir=<dir> [--scope-label=LOW_GAP_TOP] [--candle-path=<data/candle_daily.jsonl>] [--fold-scheme=chronological_4]",
    )
  }

  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "outDir", filePath: outDir },
      { label: "candlePath", filePath: candlePath, allowedRoot: policy.dataRoot },
      { label: "recentInput", filePath: recentInputPath },
    ],
    policy,
    toolName: "build_stepb_1d_tp12_execution_menu_report",
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
    toolName: "build_stepb_1d_tp12_execution_menu_report",
  })

  const [trainSourceRows, oosSourceRows, recentSourceRows] = await Promise.all([
    loadRows({ inputPath: scopePaths.trainPackPath, label: "train" }),
    loadRows({ inputPath: scopePaths.oosPackPath, label: "oos" }),
    loadRows({ inputPath: recentInputPath, label: "recent" }),
  ])
  const seriesMap = await buildSeriesMapForRows({
    rowGroups: {
      train: trainSourceRows,
      oos: oosSourceRows,
      recent: recentSourceRows,
    },
    candlePath,
  })

  const touchTrainRows = relabelTouchRows({
    rows: trainSourceRows,
    seriesMap,
    catalog: scope.catalog,
    holdDays,
    targetPct,
    stopLossPct,
    label: "train",
  })
  const touchOosRows = relabelTouchRows({
    rows: oosSourceRows,
    seriesMap,
    catalog: scope.catalog,
    holdDays,
    targetPct,
    stopLossPct,
    label: "oos",
  })
  const touchRecentRows = relabelTouchRows({
    rows: recentSourceRows,
    seriesMap,
    catalog: scope.catalog,
    holdDays,
    targetPct,
    stopLossPct,
    label: "recent",
  })

  const rules = selectPerfectPrototypeRules(scope.catalog, scope.selectionMode)
  const donorTrain = evaluateTouchContractRich({
    rows: touchTrainRows,
    rules,
    catalog: scope.catalog,
    selectionMode: scope.selectionMode,
    foldScheme,
  })
  const donorOos = evaluateTouchContractRich({
    rows: touchOosRows,
    rules,
    catalog: scope.catalog,
    selectionMode: scope.selectionMode,
    foldScheme,
  })
  const donorRecent = evaluateTouchContractRich({
    rows: touchRecentRows,
    rules,
    catalog: scope.catalog,
    selectionMode: scope.selectionMode,
    foldScheme,
  })

  const policyResults = []
  const policyRowResults = []
  for (const executionPolicy of TP12_EXECUTION_POLICY_MENU_STOP_RECOVERY_V1) {
    const trainSimulation = simulateExecutionPolicyOnCohort({
      cohortId: "train",
      donorRows: donorTrain.dedupedMatches,
      seriesMap,
      policy: executionPolicy,
    })
    const oosSimulation = simulateExecutionPolicyOnCohort({
      cohortId: "oos",
      donorRows: donorOos.dedupedMatches,
      seriesMap,
      policy: executionPolicy,
    })
    const recentSimulation = simulateExecutionPolicyOnCohort({
      cohortId: "recent",
      donorRows: donorRecent.dedupedMatches,
      seriesMap,
      policy: executionPolicy,
    })
    policyRowResults.push(...trainSimulation.rows, ...oosSimulation.rows, ...recentSimulation.rows)
    policyResults.push({
      policyId: executionPolicy.policyId,
      label: executionPolicy.label,
      stopEnabled: executionPolicy.stopEnabled,
      contract: {
        entry: executionPolicy.entry,
        holdDays: executionPolicy.holdDays,
        targetPct: executionPolicy.targetPct,
        stopLossPct: executionPolicy.stopLossPct,
        stopActivationDelayBars: executionPolicy.stopActivationDelayBars,
        sameBarTiePolicy: executionPolicy.sameBarTiePolicy,
      },
      train: trainSimulation.summary,
      oos: oosSimulation.summary,
      recent: recentSimulation.summary,
    })
  }

  const baselinePolicyId = "baseline_tp12_sl4_stop_first_3d"
  const rankedPolicies = sortPolicyResults(policyResults)
  const bestOverall = rankedPolicies[0] ?? null
  const bestStopAware = rankedPolicies.find((entry) => entry?.stopEnabled === true) ?? null
  const verdict = buildVerdict({
    rankedResults: rankedPolicies,
    baselinePolicyId,
    donorOos,
    donorRecent,
  })

  const recentSummaryPath = path.join(path.dirname(recentInputPath), "summary.json")
  const recentPackSummary = pathExists(recentSummaryPath) ? await readJson(recentSummaryPath, null) : null
  const summary = {
    scopeRunId,
    scopeLabel,
    contract: {
      cleanValidation: TP12_PROBE_CONTRACT,
      donorTouch: {
        ...TP12_TOUCH_DISCOVERY_CONTRACT,
        holdDays,
        targetPct,
        stopLossPct,
      },
      policyMenuId: "tp12_stop_recovery_v1",
      evaluationPolicies: TP12_EXECUTION_POLICY_MENU_STOP_RECOVERY_V1.map((entry) => ({
        policyId: entry.policyId,
        label: entry.label,
        entry: entry.entry,
        holdDays: entry.holdDays,
        targetPct: entry.targetPct,
        stopLossPct: entry.stopLossPct,
        stopActivationDelayBars: entry.stopActivationDelayBars,
        sameBarTiePolicy: entry.sameBarTiePolicy,
      })),
      foldScheme,
      selectionMode: scope.selectionMode,
      recentInputPath,
    },
    clean: {
      label: scope.cleanSummary?.label ?? "clean_validation",
      status: scope.cleanSummary?.status ?? null,
      quality: scope.cleanSummary?.quality ?? {},
      speed: scope.cleanSummary?.speed ?? {},
    },
    donorCohorts: {
      train: {
        aggregate: donorTrain.aggregate,
        lineSummary: donorTrain.lineSummary,
      },
      oos: {
        aggregate: donorOos.aggregate,
        lineSummary: donorOos.lineSummary,
      },
      recent: {
        aggregate: donorRecent.aggregate,
        lineSummary: donorRecent.lineSummary,
        packSummary: recentPackSummary,
      },
    },
    ranking: {
      baselinePolicyId,
      bestOverallPolicyId: bestOverall?.policyId ?? null,
      bestStopAwarePolicyId: bestStopAware?.policyId ?? null,
      sortMetric: "recent_target_hit_rate_then_recent_avg_net_ret_then_oos_target_hit_rate",
    },
    verdict,
    policyResults: rankedPolicies,
  }

  const report = [
    "# 1D TP12 Execution Menu",
    "",
    "## Scope",
    "",
    `- source scope run: \`${scopeRunId}\``,
    `- scope label: \`${scopeLabel ?? "n/a"}\``,
    `- selection mode: \`${scope.selectionMode}\``,
    `- donor contract: \`NEXT_DAY_OPEN / ${holdDays}d / +${(targetPct * 100).toFixed(0)}% touch / no stop gate\``,
    `- recent gate input: \`${recentInputPath}\``,
    "",
    "## Existing Contrast",
    "",
    `- clean exact-bank OOS line: ${toNumber(scope.cleanSummary?.quality?.close28HitRows, 0)}/${toNumber(scope.cleanSummary?.quality?.close28SelectedRows, 0)} = ${pct(scope.cleanSummary?.quality?.lineLevelHitRate)}`,
    `- touch donor OOS line: ${toNumber(donorOos.lineSummary?.hitRows, 0)}/${toNumber(donorOos.lineSummary?.selectedRows, 0)} = ${pct(donorOos.lineSummary?.hitRate)}`,
    `- touch donor recent line: ${toNumber(donorRecent.lineSummary?.hitRows, 0)}/${toNumber(donorRecent.lineSummary?.selectedRows, 0)} = ${pct(donorRecent.lineSummary?.hitRate)}`,
    `- donor OOS stop-before-touch share: ${toNumber(donorOos.aggregate?.matchedTouchStopBeforeTouchRows, 0)}/${toNumber(donorOos.aggregate?.matchedTouchHitRows, 0)} = ${pct(donorOos.aggregate?.matchedTouchStopBeforeTouchShare)}`,
    `- donor recent stop-before-touch share: ${toNumber(donorRecent.aggregate?.matchedTouchStopBeforeTouchRows, 0)}/${toNumber(donorRecent.aggregate?.matchedTouchHitRows, 0)} = ${pct(donorRecent.aggregate?.matchedTouchStopBeforeTouchShare)}`,
    "",
    "## Ranked Policies",
    "",
    ...rankedPolicies.map((entry, index) =>
      `${index + 1}. \`${entry.policyId}\`: recent ${entry.recent.hitRows}/${entry.recent.selectedRows} = ${pct(entry.recent.targetHitRate)}, recent avgNetRet=${pct(entry.recent.avgNetRet)}, OOS ${entry.oos.hitRows}/${entry.oos.selectedRows} = ${pct(entry.oos.targetHitRate)}, OOS avgNetRet=${pct(entry.oos.avgNetRet)}`
    ),
    "",
    "## Verdict",
    "",
    `- best overall: \`${bestOverall?.policyId ?? "n/a"}\``,
    `- best stop-aware: \`${bestStopAware?.policyId ?? "n/a"}\``,
    `- verdict: \`${verdict.code}\``,
    `- note: ${verdict.message}`,
    "",
  ].join("\n")

  await writeJson(path.join(outDir, "execution_menu_summary.json"), summary)
  await writeJson(path.join(outDir, "policy_results.json"), rankedPolicies)
  await writeJsonl(path.join(outDir, "touch_train_donor_deduped_symbols.jsonl"), donorTrain.dedupedMatches)
  await writeJsonl(path.join(outDir, "touch_oos_donor_deduped_symbols.jsonl"), donorOos.dedupedMatches)
  await writeJsonl(path.join(outDir, "touch_recent_donor_deduped_symbols.jsonl"), donorRecent.dedupedMatches)
  await writeJsonl(path.join(outDir, "policy_row_results.jsonl"), policyRowResults)
  await fs.writeFile(path.join(outDir, "report.md"), `${report}\n`, "utf8")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
