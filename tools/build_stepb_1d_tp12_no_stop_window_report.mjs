import fs from "node:fs/promises"
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildCandleDateIndexMap, buildCandleSeriesMap } from "../src/lib/data.mjs"
import {
  buildTp12CleanRuleSets,
} from "../src/lib/perfect_prototype_tp12_contract_split_metrics.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import { ensureDir, pathExists, readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"
import {
  loadTp12NoStopRollingResearchContract,
  resolveTp12NoStopRollingWindow,
} from "../src/lib/tp12_no_stop_rolling_contract.mjs"
import { computeTp12NoStopTargetLabelsForDecision } from "../src/lib/tp12_no_stop_target_contract.mjs"

const WINDOW_REPORT_KIND = "tp12_no_stop_window_report_v1"

const toText = (value) => String(value ?? "").trim()
const uniqueSorted = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )
const num = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}
const assertExists = (filePath, label) => {
  if (!pathExists(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`)
  }
  return filePath
}
const round = (value, digits = 6) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null
}

const readScopePaths = ({ cwd, scopeRunId }) => {
  const runDir = path.join(cwd, "artifacts", "runs", scopeRunId)
  return {
    runDir,
    openEvalManifestPath: path.join(runDir, "step-perfect-prototype-open-eval-report", "open_eval_manifest.json"),
    selectionLeaderboardPath: path.join(runDir, "step-perfect-prototype-open-eval-report", "selection_leaderboard.json"),
    selectionGuardrailSummaryPath: path.join(runDir, "step-perfect-prototype-open-eval-report", "selection_guardrail_summary.json"),
    trainApplyRawPath: path.join(runDir, "step-perfect-prototype-open-train-apply-raw", "deduped_symbols.jsonl"),
    oosApplyRawPath: path.join(runDir, "step-perfect-prototype-open-oos-apply-raw", "deduped_symbols.jsonl"),
    trainSummaryPath: path.join(runDir, "step-perfect-prototype-train", "summary.json"),
    indexSummaryPath: path.join(runDir, "step-perfect-prototype-index-train", "summary.json"),
    freezeResultPath: path.join(runDir, "freeze_result.json"),
    noRulesSummaryPath: path.join(runDir, "no_rules_summary.json"),
    runtimeSummaryPath: path.join(runDir, "tp12_no_stop_window_runtime.json"),
  }
}

const readSourcePaths = ({ cwd, sourceRunId }) => {
  const runDir = path.join(cwd, "artifacts", "runs", sourceRunId)
  return {
    runDir,
    controlInputPipelineSummaryPath: path.join(runDir, "control_input_pipeline_summary.json"),
    controlInputSummaryPath: path.join(runDir, "step-perfect-prototype-open-control-input-pack", "control_input_summary.json"),
  }
}

const buildMetricPayload = (rows = [], labelId) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const selectedRows = safeRows.length
  const hitRows = safeRows.filter((row) => num(row?.labels?.[labelId], 0) === 1).length
  const selectedDates = uniqueSorted(safeRows.map((row) => toText(row?.decisionDateKey)).filter(Boolean))
  const selectedDateKeysByYear = new Map()
  const hitDateKeysByYear = new Map()
  const countsByDate = new Map()
  for (const row of safeRows) {
    const dateKey = toText(row?.decisionDateKey)
    if (!dateKey) continue
    countsByDate.set(dateKey, num(countsByDate.get(dateKey), 0) + 1)
    const yearKey = dateKey.slice(0, 4)
    if (!selectedDateKeysByYear.has(yearKey)) {
      selectedDateKeysByYear.set(yearKey, new Set())
    }
    selectedDateKeysByYear.get(yearKey).add(dateKey)
    if (num(row?.labels?.[labelId], 0) === 1) {
      if (!hitDateKeysByYear.has(yearKey)) {
        hitDateKeysByYear.set(yearKey, new Set())
      }
      hitDateKeysByYear.get(yearKey).add(dateKey)
    }
  }
  const maxDateCount = countsByDate.size > 0 ? Math.max(...countsByDate.values()) : 0
  const selectedDateCountByYear = Object.fromEntries(
    Array.from(selectedDateKeysByYear.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([yearKey, keys]) => [yearKey, keys.size]),
  )
  const hitDateCountByYear = Object.fromEntries(
    Array.from(hitDateKeysByYear.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([yearKey, keys]) => [yearKey, keys.size]),
  )
  return {
    selectedRows,
    hitRows,
    hitRate: selectedRows > 0 ? hitRows / selectedRows : 0,
    uniqueMatchedDates: uniqueSorted(selectedDates).length,
    top1DateShare: selectedRows > 0 ? maxDateCount / selectedRows : 0,
    dateFrom: selectedDates.length > 0 ? selectedDates[0] : null,
    dateTo: selectedDates.length > 0 ? selectedDates[selectedDates.length - 1] : null,
    selectedDateCountByYear,
    selectedDateKeysByYear: Object.fromEntries(
      Array.from(selectedDateKeysByYear.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([yearKey, keys]) => [yearKey, Array.from(keys).sort((left, right) => left.localeCompare(right))]),
    ),
    hitDateCountByYear,
    hitDateKeysByYear: Object.fromEntries(
      Array.from(hitDateKeysByYear.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([yearKey, keys]) => [yearKey, Array.from(keys).sort((left, right) => left.localeCompare(right))]),
    ),
  }
}

const normalizeSelectionRows = ({
  selectedPath,
  rows,
  symbolSeriesMap,
  dateIndexMap,
  targetLabelIds,
} = {}) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const pairSet = new Set()
  return safeRows.map((row, index) => {
    const symbol = toText(row?.symbol)
    const decisionDateKey = toText(row?.decisionDateKey ?? row?.dateKey ?? row?.recommendationDateKey)
    if (!symbol || !decisionDateKey) {
      throw new Error(`Malformed selected row at ${selectedPath}:${index + 1}`)
    }
    const joinKey = `${symbol}::${decisionDateKey}`
    if (pairSet.has(joinKey)) {
      throw new Error(`Duplicate selected pair in ${selectedPath}: ${joinKey}`)
    }
    pairSet.add(joinKey)
    const series = symbolSeriesMap.get(symbol)
    const dateIndex = dateIndexMap.get(symbol)
    const decisionIdx = dateIndex?.get(decisionDateKey)
    if (!series || !dateIndex || !Number.isInteger(decisionIdx)) {
      throw new Error(`Missing candle coverage for selected row ${joinKey}`)
    }
    const slicedSeries = series.slice(decisionIdx, decisionIdx + 5)
    if (slicedSeries.length < 5) {
      throw new Error(`Selected row ${joinKey} does not have decision + D+4 candle coverage`)
    }
    const labelContract = computeTp12NoStopTargetLabelsForDecision({
      series: slicedSeries,
      decisionIdx: 0,
    })
    const labels = {}
    for (const labelId of targetLabelIds) {
      labels[labelId] = num(labelContract?.labels?.[labelId], 0)
      labels[`${labelId}_max_high_ret`] = labelContract?.labels?.[`${labelId}_max_high_ret`] ?? null
      labels[`${labelId}_terminal_ret`] = labelContract?.labels?.[`${labelId}_terminal_ret`] ?? null
      labels[`${labelId}_min_low_ret`] = labelContract?.labels?.[`${labelId}_min_low_ret`] ?? null
    }
    return {
      symbol,
      decisionDateKey,
      monthKey: decisionDateKey.slice(0, 7),
      labels,
      raw: row,
    }
  })
}

const buildZeroMetricMap = (targetLabelIds = []) =>
  Object.fromEntries(
    uniqueSorted(targetLabelIds).map((labelId) => [
      labelId,
      {
        selectedRows: 0,
        hitRows: 0,
        hitRate: 0,
        uniqueMatchedDates: 0,
        top1DateShare: 0,
        dateFrom: null,
        dateTo: null,
        selectedDateCountByYear: {},
        selectedDateKeysByYear: {},
        hitDateCountByYear: {},
        hitDateKeysByYear: {},
      },
    ]),
  )

const buildVerdict = ({ status, reason, oosMetrics }) => {
  if (status === "no_rules") {
    return {
      status,
      reason: reason || "no_rules",
    }
  }
  const primarySelectedRows = num(oosMetrics?.selectedRows, 0)
  if (primarySelectedRows < 1) {
    return {
      status: "no_oos_selection",
      reason: "oos_primary_selected_rows_zero",
    }
  }
  return {
    status: "usable",
    reason: null,
  }
}

const buildSearchQuality = ({ selectionLeaderboardRows, contract } = {}) => {
  const rows = Array.isArray(selectionLeaderboardRows) ? selectionLeaderboardRows : []
  const minDates = num(contract?.searchContract?.minTrainMatchedDates, 0)
  const minMonths = num(contract?.searchContract?.minTrainMatchedMonths, 0)
  const minFolds = num(contract?.searchContract?.minTrainMatchedFolds, 0)
  const cleanRuleSets = buildTp12CleanRuleSets(rows)
  return {
    minedRuleCount: rows.length,
    trainBreadthQualifiedRuleCount: rows.filter(
      (row) =>
        num(row?.trainMatchedDateCount, 0) >= minDates &&
        num(row?.trainMatchedMonthCount, 0) >= minMonths &&
        num(row?.trainMatchedFoldCount, 0) >= minFolds,
    ).length,
    trainPromotableBreadthRuleCount: cleanRuleSets.cleanTrainPromotableRuleIds.length,
    zeroNegativeRuleCount: cleanRuleSets.cleanOosZeroNegativeRuleIds.length,
    oosZeroNegativeRuleCount: cleanRuleSets.cleanOosZeroNegativeRuleIds.length,
    oosPerfectDateFloor3RuleCount: cleanRuleSets.cleanOosPerfectDateFloor3RuleIds.length,
  }
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const policy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "build_stepb_1d_tp12_no_stop_window_report",
  })
  const contractPath = toText(getFlag(parsed.flags, "contract-path", "meta/tp12_no_stop_rolling_research_contract.json"))
  const windowId = toText(getFlag(parsed.flags, "window-id", ""))
  const sourceRunId = toText(getFlag(parsed.flags, "source-run-id", ""))
  const scopeRunId = toText(getFlag(parsed.flags, "scope-run-id", ""))
  const outDir = path.resolve(toText(getFlag(parsed.flags, "out-dir", "")))
  const candlePath = path.resolve(
    toText(getFlag(parsed.flags, "candle-path", path.join(cwd, "data", "candle_daily.jsonl"))),
  )
  if (!windowId || !sourceRunId || !scopeRunId || !outDir) {
    throw new Error(
      "Usage: node tools/build_stepb_1d_tp12_no_stop_window_report.mjs --window-id=<id> --source-run-id=<source_run_id> --scope-run-id=<scope_run_id> --out-dir=<dir> [--contract-path=PATH --candle-path=PATH]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "outDir", filePath: outDir },
      { label: "candlePath", filePath: candlePath, allowedRoot: policy.dataRoot },
    ],
    policy,
    toolName: "build_stepb_1d_tp12_no_stop_window_report",
  })
  await ensureDir(outDir)

  const contract = await loadTp12NoStopRollingResearchContract({
    contractPath,
    cwd,
  })
  const window = resolveTp12NoStopRollingWindow({
    contract,
    windowId,
  })
  const scopePaths = readScopePaths({ cwd, scopeRunId })
  const sourcePaths = readSourcePaths({ cwd, sourceRunId })
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "scopeRunDir", filePath: scopePaths.runDir },
      { label: "sourceRunDir", filePath: sourcePaths.runDir },
    ],
    policy,
    toolName: "build_stepb_1d_tp12_no_stop_window_report",
  })
  assertExists(sourcePaths.controlInputPipelineSummaryPath, "source control-input pipeline summary")
  assertExists(sourcePaths.controlInputSummaryPath, "source control-input summary")

  const [
    sourcePipelineSummary,
    sourceControlInputSummary,
    openEvalManifest,
    selectionLeaderboard,
    selectionGuardrailSummary,
    trainSummary,
    indexSummary,
    freezeResult,
    runtimeSummary,
    noRulesSummary,
  ] = await Promise.all([
    readJson(sourcePaths.controlInputPipelineSummaryPath, null),
    readJson(sourcePaths.controlInputSummaryPath, null),
    readJson(scopePaths.openEvalManifestPath, null),
    readJson(scopePaths.selectionLeaderboardPath, []),
    readJson(scopePaths.selectionGuardrailSummaryPath, null),
    readJson(scopePaths.trainSummaryPath, null),
    readJson(scopePaths.indexSummaryPath, null),
    readJson(scopePaths.freezeResultPath, null),
    readJson(scopePaths.runtimeSummaryPath, null),
    readJson(scopePaths.noRulesSummaryPath, null),
  ])

  const targetLabelIds = contract.labelContract.targetLabelIds
  const noRules = noRulesSummary?.status === "no_rules"
  let trainRows = []
  let oosRows = []
  if (!noRules) {
    assertExists(scopePaths.openEvalManifestPath, "scope open-eval manifest")
    assertExists(scopePaths.selectionLeaderboardPath, "scope selection leaderboard")
    assertExists(scopePaths.trainApplyRawPath, "scope train apply raw selection")
    assertExists(scopePaths.oosApplyRawPath, "scope oos apply raw selection")
    assertExists(scopePaths.trainSummaryPath, "scope train summary")
    assertExists(scopePaths.indexSummaryPath, "scope train index summary")
    assertExists(scopePaths.freezeResultPath, "scope freeze result")
    assertExists(scopePaths.runtimeSummaryPath, "scope runtime summary")
    const [trainSelectedRows, oosSelectedRows] = await Promise.all([
      readJsonl(scopePaths.trainApplyRawPath),
      readJsonl(scopePaths.oosApplyRawPath),
    ])
    const symbolAllowSet = new Set(
      [...trainSelectedRows, ...oosSelectedRows]
        .map((row) => toText(row?.symbol))
        .filter(Boolean),
    )
    const candleRows = await readJsonl(candlePath, {
      filter: (row) => symbolAllowSet.has(toText(row?.symbol)),
    })
    const symbolSeriesMap = buildCandleSeriesMap(candleRows, symbolAllowSet)
    const dateIndexMap = buildCandleDateIndexMap(symbolSeriesMap)
    trainRows = normalizeSelectionRows({
      selectedPath: scopePaths.trainApplyRawPath,
      rows: trainSelectedRows,
      symbolSeriesMap,
      dateIndexMap,
      targetLabelIds,
    })
    oosRows = normalizeSelectionRows({
      selectedPath: scopePaths.oosApplyRawPath,
      rows: oosSelectedRows,
      symbolSeriesMap,
      dateIndexMap,
      targetLabelIds,
    })
  } else {
    assertExists(scopePaths.noRulesSummaryPath, "scope no-rules summary")
    assertExists(scopePaths.freezeResultPath, "scope freeze result")
  }
  const searchQuality = buildSearchQuality({
    selectionLeaderboardRows: selectionLeaderboard,
    contract,
  })
  const trainMetricsByLabel = noRules
    ? buildZeroMetricMap(targetLabelIds)
    : Object.fromEntries(targetLabelIds.map((labelId) => [labelId, buildMetricPayload(trainRows, labelId)]))
  const oosMetricsByLabel = noRules
    ? buildZeroMetricMap(targetLabelIds)
    : Object.fromEntries(targetLabelIds.map((labelId) => [labelId, buildMetricPayload(oosRows, labelId)]))
  const primaryOosMetrics = oosMetricsByLabel[contract.labelContract.primaryLabelId] ?? null
  const verdict = buildVerdict({
    status: noRules ? "no_rules" : "ok",
    reason: noRules ? toText(noRulesSummary?.reason) : null,
    oosMetrics: primaryOosMetrics,
  })

  const summary = {
    kind: WINDOW_REPORT_KIND,
    contractId: contract.contractId,
    contractPath: contract.contractPath,
    scopeId: contract.scopeId,
    windowId: window.windowId,
    kindWindow: window.kind,
    yearHitMetric: toText(contract?.yearHitMetric || contract?.searchContract?.yearHitMetric || "hit_rows"),
    sourceRunId,
    scopeRunId,
    targetLabelIds,
    trainDateFrom: window.trainDateFrom,
    trainDateTo: window.trainDateTo,
    oosDateFrom: window.oosDateFrom,
    oosDateTo: window.oosDateTo,
    source: {
      controlInputPipelineSummaryPath: sourcePaths.controlInputPipelineSummaryPath,
      controlInputSummaryPath: sourcePaths.controlInputSummaryPath,
      controlInputSummary: sourceControlInputSummary,
      controlInputPipelineSummary: sourcePipelineSummary,
    },
    search: {
      lineId: toText(openEvalManifest?.lineId),
      selectionMode: toText(openEvalManifest?.selectionMode),
      freezeResultPath: scopePaths.freezeResultPath,
      frozenCatalogPath: toText(freezeResult?.outPath),
      yearHitMetric: toText(contract?.yearHitMetric || contract?.searchContract?.yearHitMetric || "hit_rows"),
      runtimeSummaryPath: scopePaths.runtimeSummaryPath,
      runtimeSummary,
      trainSummary,
      indexSummary,
      legacySelectionGuardrail: selectionGuardrailSummary,
      leaderboardRowCount: Array.isArray(selectionLeaderboard) ? selectionLeaderboard.length : 0,
      trainBreadthQualifiedRuleCount: searchQuality.trainBreadthQualifiedRuleCount,
      trainPromotableBreadthRuleCount: searchQuality.trainPromotableBreadthRuleCount,
      zeroNegativeRuleCount: searchQuality.zeroNegativeRuleCount,
      oosZeroNegativeRuleCount: searchQuality.oosZeroNegativeRuleCount,
      oosPerfectDateFloor3RuleCount: searchQuality.oosPerfectDateFloor3RuleCount,
    },
    train: {
      selectionPath: scopePaths.trainApplyRawPath,
      selectedRowsPath: path.join(outDir, "train_selected_rows.jsonl"),
      metricsByLabel: trainMetricsByLabel,
    },
    oos: {
      selectionPath: scopePaths.oosApplyRawPath,
      selectedRowsPath: path.join(outDir, "oos_selected_rows.jsonl"),
      metricsByLabel: oosMetricsByLabel,
    },
    status: verdict.status,
    noRulesReason: noRules ? toText(noRulesSummary?.reason) : null,
    verdict,
  }

  const reportLines = [
    "# TP12 No-Stop Window Report",
    "",
    "## Scope",
    "",
    `- windowId: \`${window.windowId}\` [${window.kind}]`,
    `- sourceRunId: \`${sourceRunId}\``,
    `- scopeRunId: \`${scopeRunId}\``,
    `- window: train ${window.trainDateFrom}~${window.trainDateTo}, oos ${window.oosDateFrom}~${window.oosDateTo}`,
    `- lineId: \`${summary.search.lineId || "n/a"}\``,
    `- selectionMode: \`${summary.search.selectionMode || "n/a"}\``,
    "",
    "## Metrics",
    "",
    ...targetLabelIds.flatMap((labelId) => {
      const trainMetrics = trainMetricsByLabel[labelId]
      const oosMetrics = oosMetricsByLabel[labelId]
      return [
        `- ${labelId} train: ${trainMetrics.hitRows}/${trainMetrics.selectedRows} = ${round(trainMetrics.hitRate, 4) ?? 0}, uniqueDates=${trainMetrics.uniqueMatchedDates}, top1DateShare=${round(trainMetrics.top1DateShare, 4) ?? 0}`,
        `- ${labelId} oos: ${oosMetrics.hitRows}/${oosMetrics.selectedRows} = ${round(oosMetrics.hitRate, 4) ?? 0}, uniqueDates=${oosMetrics.uniqueMatchedDates}, top1DateShare=${round(oosMetrics.top1DateShare, 4) ?? 0}`,
      ]
    }),
    "",
    "## Rule Bank",
    "",
    `- train breadth rules >=${contract.searchContract.minTrainMatchedDates}/${contract.searchContract.minTrainMatchedMonths}/${contract.searchContract.minTrainMatchedFolds}: ${summary.search.trainBreadthQualifiedRuleCount}`,
    `- train promotable breadth 10/6/4: ${summary.search.trainPromotableBreadthRuleCount}`,
    `- oos zero-negative rules: ${summary.search.zeroNegativeRuleCount}`,
    `- oos perfect >=3-date rules: ${summary.search.oosPerfectDateFloor3RuleCount}`,
    `- verdict: \`${summary.verdict.status}\`${summary.verdict.reason ? ` (${summary.verdict.reason})` : ""}`,
    "",
  ]

  await writeJson(path.join(outDir, "window_summary.json"), summary)
  await writeJson(path.join(outDir, "window_verdict.json"), summary.verdict)
  await writeJsonl(path.join(outDir, "train_selected_rows.jsonl"), trainRows)
  await writeJsonl(path.join(outDir, "oos_selected_rows.jsonl"), oosRows)
  await fs.writeFile(path.join(outDir, "report.md"), `${reportLines.join("\n")}\n`, "utf8")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
