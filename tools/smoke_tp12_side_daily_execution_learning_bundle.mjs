import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildTp12SideDailyExecutionLearningBundle } from "../src/lib/tp12_side_daily_execution_learning_bundle.mjs"
import { ensureDir, readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const main = async () => {
  const tmpRoot = path.join(ROOT, "artifacts", "checks", "smoke_tp12_side_daily_execution_learning_bundle")
  const pipelineSummaryPath = path.join(tmpRoot, "scientific_control", "pipeline_summary.json")
  const selectionManifestPath = path.join(tmpRoot, "scientific_control", "selection_manifest.json")
  const controlPackPath = path.join(tmpRoot, "scientific_control", "control", "decision_candidates_feature_pack_control.jsonl")
  const controlLabelPath = path.join(tmpRoot, "scientific_control", "control", "no_stop_label_rows.jsonl")
  const controlSummaryPath = path.join(tmpRoot, "scientific_control", "control", "control_summary.json")
  const baselineSelectionPath = path.join(tmpRoot, "scientific_control", "selection_rows", "daily_only_no_stop_selected_rows.jsonl")
  const sideSelectionPath = path.join(tmpRoot, "scientific_control", "selection_rows", "daily_plus_investor_selected_rows.jsonl")
  const candlePath = path.join(tmpRoot, "data", "candle_daily.jsonl")
  const outDir = path.join(tmpRoot, "execution_learning")

  await ensureDir(tmpRoot)
  await writeJsonl(controlPackPath, [
    {
      symbol: "AAA111",
      decisionDateKey: "2024-01-03",
      featureVec: {
        "daily.alpha": 1,
      },
      contextualTokens: ["tag:baseline"],
      sideDailyControl: {
        controlId: "daily_only_no_stop",
      },
      sourceType: "train",
      sourceId: "train::AAA111",
      lineId: "baseline_line",
      primaryRuleId: "rule_a",
    },
    {
      symbol: "BBB222",
      decisionDateKey: "2025-01-03",
      featureVec: {
        "daily.alpha": 2,
      },
      contextualTokens: ["tag:baseline"],
      sideDailyControl: {
        controlId: "daily_only_no_stop",
      },
      sourceType: "oos",
      sourceId: "oos::BBB222",
      lineId: "baseline_line",
      primaryRuleId: "rule_b",
    },
    {
      symbol: "CCC333",
      decisionDateKey: "2025-01-06",
      featureVec: {
        "daily.alpha": 3,
      },
      contextualTokens: ["tag:baseline"],
      sideDailyControl: {
        controlId: "daily_only_no_stop",
      },
      sourceType: "oos",
      sourceId: "oos::CCC333",
      lineId: "baseline_line",
      primaryRuleId: "rule_c",
    },
  ])
  await writeJsonl(controlLabelPath, [
    {
      symbol: "AAA111",
      decisionDateKey: "2024-01-03",
      prevDateKey: "2024-01-02",
      asOfDateKey: "2024-01-02",
      stepALaneId: "same_day_high8",
      requestId: "AAA111::2024-01-03",
      runId: "baseline_scientific",
      eventLabel: "same_day_high8",
      splitBucket: "train",
      targetLabelIds: ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"],
      labels: {
        tp12_no_stop_hit_3d: 1,
        tp12_no_stop_hit_4d: 1,
      },
      windowDateKeys: ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09"],
    },
    {
      symbol: "BBB222",
      decisionDateKey: "2025-01-03",
      prevDateKey: "2025-01-02",
      asOfDateKey: "2025-01-02",
      stepALaneId: "same_day_high8",
      requestId: "BBB222::2025-01-03",
      runId: "baseline_scientific",
      eventLabel: "same_day_high8",
      splitBucket: "oos",
      targetLabelIds: ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"],
      labels: {
        tp12_no_stop_hit_3d: 0,
        tp12_no_stop_hit_4d: 1,
      },
      windowDateKeys: ["2025-01-02", "2025-01-03", "2025-01-06", "2025-01-07", "2025-01-08", "2025-01-09"],
    },
    {
      symbol: "CCC333",
      decisionDateKey: "2025-01-06",
      prevDateKey: "2025-01-03",
      asOfDateKey: "2025-01-03",
      stepALaneId: "same_day_high8",
      requestId: "CCC333::2025-01-06",
      runId: "baseline_scientific",
      eventLabel: "same_day_high8",
      splitBucket: "oos",
      targetLabelIds: ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"],
      labels: {
        tp12_no_stop_hit_3d: 0,
        tp12_no_stop_hit_4d: 0,
      },
      windowDateKeys: ["2025-01-03", "2025-01-06", "2025-01-07", "2025-01-08", "2025-01-09", "2025-01-10"],
    },
  ])
  await writeJson(controlSummaryPath, {
    kind: "tp12_side_daily_control_artifact_v1",
    split: {
      trainDateFrom: "2024-01-01",
      trainDateTo: "2024-12-31",
      oosDateFrom: "2025-01-01",
      oosDateTo: "2025-12-31",
    },
  })
  await writeJsonl(baselineSelectionPath, [
    { symbol: "AAA111", decisionDateKey: "2024-01-03" },
    { symbol: "BBB222", decisionDateKey: "2025-01-03" },
    { symbol: "CCC333", decisionDateKey: "2025-01-06" },
  ])
  await writeJsonl(sideSelectionPath, [{ symbol: "BBB222", decisionDateKey: "2025-01-03" }])
  await writeJsonl(candlePath, [
    { symbol: "AAA111", dateKey: "2024-01-02", open: 100, high: 101, low: 99, close: 100 },
    { symbol: "AAA111", dateKey: "2024-01-03", open: 100, high: 102, low: 99, close: 101 },
    { symbol: "AAA111", dateKey: "2024-01-04", open: 100, high: 105, low: 99, close: 104 },
    { symbol: "AAA111", dateKey: "2024-01-05", open: 104, high: 113, low: 103, close: 111 },
    { symbol: "AAA111", dateKey: "2024-01-08", open: 111, high: 114, low: 110, close: 112 },
    { symbol: "AAA111", dateKey: "2024-01-09", open: 112, high: 116, low: 111, close: 115 },
    { symbol: "BBB222", dateKey: "2025-01-02", open: 100, high: 101, low: 99, close: 100 },
    { symbol: "BBB222", dateKey: "2025-01-03", open: 100, high: 102, low: 98, close: 100 },
    { symbol: "BBB222", dateKey: "2025-01-06", open: 100, high: 103, low: 94, close: 95 },
    { symbol: "BBB222", dateKey: "2025-01-07", open: 95, high: 100, low: 97, close: 99 },
    { symbol: "BBB222", dateKey: "2025-01-08", open: 99, high: 114, low: 98, close: 112 },
    { symbol: "BBB222", dateKey: "2025-01-09", open: 112, high: 113, low: 110, close: 111 },
    { symbol: "CCC333", dateKey: "2025-01-03", open: 100, high: 101, low: 99, close: 100 },
    { symbol: "CCC333", dateKey: "2025-01-06", open: 100, high: 101, low: 98, close: 99 },
    { symbol: "CCC333", dateKey: "2025-01-07", open: 100, high: 101, low: 94, close: 95 },
    { symbol: "CCC333", dateKey: "2025-01-08", open: 95, high: 97, low: 94, close: 96 },
    { symbol: "CCC333", dateKey: "2025-01-09", open: 96, high: 97, low: 95, close: 96 },
    { symbol: "CCC333", dateKey: "2025-01-10", open: 96, high: 97, low: 95, close: 95 },
  ])
  await writeJson(pipelineSummaryPath, {
    kind: "tp12_side_daily_scientific_control_pipeline_v1",
    runId: "scientific_smoke",
    decisionWindow: {
      from: "2024-01-03",
      to: "2025-01-10",
    },
    split: {
      trainDateFrom: "2024-01-01",
      trainDateTo: "2024-12-31",
      oosDateFrom: "2025-01-01",
      oosDateTo: "2025-12-31",
    },
    variants: [
      {
        variantId: "daily_only_no_stop",
        kind: "control",
        gateId: "d0_close",
        datasetIds: [],
        controlPackPath,
        controlLabelPath,
        controlSummaryPath,
      },
      {
        variantId: "daily_plus_investor",
        kind: "side_daily",
        gateId: "d0_close",
        datasetIds: ["investor_daily"],
        controlPackPath,
        controlLabelPath,
        controlSummaryPath,
      },
    ],
  })
  await writeJson(selectionManifestPath, {
    kind: "tp12_side_daily_scientific_selection_manifest_v1",
    pipelineSummaryPath,
    variants: [
      {
        variantId: "daily_only_no_stop",
        selectionPath: baselineSelectionPath,
      },
      {
        variantId: "daily_plus_investor",
        selectionPath: sideSelectionPath,
      },
    ],
  })

  const result = await buildTp12SideDailyExecutionLearningBundle({
    pipelineSummaryPath,
    selectionManifestPath,
    outDir,
    candlePath,
    recentReplayDecisionCount: 1,
  })

  const donorRows = await readJsonl(path.join(outDir, "donor_rows.jsonl"))
  const executionLabelRows = await readJsonl(path.join(outDir, "execution_label_rows.jsonl"))
  const summary = await readJson(path.join(outDir, "execution_learning_summary.json"))

  assert(result.summary.kind === "tp12_side_daily_execution_learning_bundle_v1", `unexpected kind: ${result.summary.kind}`)
  assert(donorRows.length === 3, `unexpected donor row count: ${donorRows.length}`)
  assert(executionLabelRows.length === 3, `unexpected execution label row count: ${executionLabelRows.length}`)
  assert(summary.donorRows.rowCount === 3, `unexpected donor summary row count: ${summary.donorRows.rowCount}`)
  assert(summary.replaySplit.validationDecisionDateCount === 1, "expected one validation decision date")
  assert(summary.replaySplit.recentReplayDecisionDateCount === 1, "expected one recent replay decision date")
  const validationRow = executionLabelRows.find((row) => row.symbol === "BBB222")
  const abstainRow = executionLabelRows.find((row) => row.symbol === "CCC333")
  assert(validationRow?.labels?.bestPolicyChoice === "delay1_4d", `unexpected BBB222 bestPolicyChoice: ${validationRow?.labels?.bestPolicyChoice}`)
  assert(validationRow?.barrierOutcomeLabel === "sl4_first", `unexpected BBB222 barrierOutcomeLabel: ${validationRow?.barrierOutcomeLabel}`)
  assert(abstainRow?.labels?.bestPolicyChoice === "abstain", `unexpected CCC333 bestPolicyChoice: ${abstainRow?.labels?.bestPolicyChoice}`)
  assert(abstainRow?.learningSplitBucket === "recent_replay", `unexpected CCC333 split: ${abstainRow?.learningSplitBucket}`)
  assert(
    summary.executionLabels.bestPolicyChoiceCounts.abstain === 1,
    `unexpected abstain count: ${summary.executionLabels.bestPolicyChoiceCounts.abstain}`,
  )

  console.log("ok smoke_tp12_side_daily_execution_learning_bundle")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
