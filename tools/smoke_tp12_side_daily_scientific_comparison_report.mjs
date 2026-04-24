import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildTp12SideDailyScientificComparisonReport } from "../src/lib/tp12_side_daily_scientific_comparison.mjs"
import { ensureDir, readJson, writeJson, writeJsonl } from "../src/lib/io.mjs"


const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const main = async () => {
  const tmpRoot = path.join(ROOT, "artifacts", "checks", "smoke_tp12_side_daily_scientific_comparison_report")
  const pipelineSummaryPath = path.join(tmpRoot, "pipeline", "pipeline_summary.json")
  const selectionManifestPath = path.join(tmpRoot, "selection", "selection_manifest.json")
  const reportPath = path.join(tmpRoot, "report", "scientific_comparison_report.json")
  const baselineLabelPath = path.join(tmpRoot, "labels", "baseline_no_stop_label_rows.jsonl")
  const investorLabelPath = path.join(tmpRoot, "labels", "investor_no_stop_label_rows.jsonl")
  const baselineSelectionPath = path.join(tmpRoot, "selection", "baseline_selected_rows.jsonl")
  const investorSelectionPath = path.join(tmpRoot, "selection", "investor_selected_rows.jsonl")

  await ensureDir(tmpRoot)

  await writeJsonl(baselineLabelPath, [
    {
      symbol: "111111",
      decisionDateKey: "2024-01-03",
      splitBucket: "train",
      targetLabelIds: ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"],
      labels: {
        tp12_no_stop_hit_3d: 1,
        tp12_no_stop_hit_3d_terminal_ret: 0.09,
        tp12_no_stop_hit_3d_max_high_ret: 0.13,
        tp12_no_stop_hit_3d_min_low_ret: -0.02,
        tp12_no_stop_hit_4d: 1,
        tp12_no_stop_hit_4d_terminal_ret: 0.1,
        tp12_no_stop_hit_4d_max_high_ret: 0.15,
        tp12_no_stop_hit_4d_min_low_ret: -0.02,
      },
    },
    {
      symbol: "222222",
      decisionDateKey: "2024-01-04",
      splitBucket: "train",
      targetLabelIds: ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"],
      labels: {
        tp12_no_stop_hit_3d: 0,
        tp12_no_stop_hit_3d_terminal_ret: -0.04,
        tp12_no_stop_hit_3d_max_high_ret: 0.02,
        tp12_no_stop_hit_3d_min_low_ret: -0.08,
        tp12_no_stop_hit_4d: 0,
        tp12_no_stop_hit_4d_terminal_ret: -0.05,
        tp12_no_stop_hit_4d_max_high_ret: 0.02,
        tp12_no_stop_hit_4d_min_low_ret: -0.09,
      },
    },
    {
      symbol: "333333",
      decisionDateKey: "2025-01-03",
      splitBucket: "oos",
      targetLabelIds: ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"],
      labels: {
        tp12_no_stop_hit_3d: 0,
        tp12_no_stop_hit_3d_terminal_ret: -0.03,
        tp12_no_stop_hit_3d_max_high_ret: 0.03,
        tp12_no_stop_hit_3d_min_low_ret: -0.07,
        tp12_no_stop_hit_4d: 0,
        tp12_no_stop_hit_4d_terminal_ret: -0.01,
        tp12_no_stop_hit_4d_max_high_ret: 0.05,
        tp12_no_stop_hit_4d_min_low_ret: -0.07,
      },
    },
    {
      symbol: "444444",
      decisionDateKey: "2025-01-06",
      splitBucket: "oos",
      targetLabelIds: ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"],
      labels: {
        tp12_no_stop_hit_3d: 1,
        tp12_no_stop_hit_3d_terminal_ret: 0.11,
        tp12_no_stop_hit_3d_max_high_ret: 0.16,
        tp12_no_stop_hit_3d_min_low_ret: -0.01,
        tp12_no_stop_hit_4d: 1,
        tp12_no_stop_hit_4d_terminal_ret: 0.13,
        tp12_no_stop_hit_4d_max_high_ret: 0.18,
        tp12_no_stop_hit_4d_min_low_ret: -0.01,
      },
    },
  ])

  await writeJsonl(investorLabelPath, [
    {
      symbol: "222222",
      decisionDateKey: "2024-01-04",
      splitBucket: "train",
      targetLabelIds: ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"],
      labels: {
        tp12_no_stop_hit_3d: 0,
        tp12_no_stop_hit_3d_terminal_ret: -0.04,
        tp12_no_stop_hit_3d_max_high_ret: 0.02,
        tp12_no_stop_hit_3d_min_low_ret: -0.08,
        tp12_no_stop_hit_4d: 0,
        tp12_no_stop_hit_4d_terminal_ret: -0.05,
        tp12_no_stop_hit_4d_max_high_ret: 0.02,
        tp12_no_stop_hit_4d_min_low_ret: -0.09,
      },
    },
    {
      symbol: "333333",
      decisionDateKey: "2025-01-03",
      splitBucket: "oos",
      targetLabelIds: ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"],
      labels: {
        tp12_no_stop_hit_3d: 0,
        tp12_no_stop_hit_3d_terminal_ret: -0.03,
        tp12_no_stop_hit_3d_max_high_ret: 0.03,
        tp12_no_stop_hit_3d_min_low_ret: -0.07,
        tp12_no_stop_hit_4d: 0,
        tp12_no_stop_hit_4d_terminal_ret: -0.01,
        tp12_no_stop_hit_4d_max_high_ret: 0.05,
        tp12_no_stop_hit_4d_min_low_ret: -0.07,
      },
    },
    {
      symbol: "444444",
      decisionDateKey: "2025-01-06",
      splitBucket: "oos",
      targetLabelIds: ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"],
      labels: {
        tp12_no_stop_hit_3d: 1,
        tp12_no_stop_hit_3d_terminal_ret: 0.11,
        tp12_no_stop_hit_3d_max_high_ret: 0.16,
        tp12_no_stop_hit_3d_min_low_ret: -0.01,
        tp12_no_stop_hit_4d: 1,
        tp12_no_stop_hit_4d_terminal_ret: 0.13,
        tp12_no_stop_hit_4d_max_high_ret: 0.18,
        tp12_no_stop_hit_4d_min_low_ret: -0.01,
      },
    },
  ])

  await writeJsonl(baselineSelectionPath, [
    { symbol: "111111", dateKey: "2024-01-03" },
    { symbol: "333333", recommendationDateKey: "2025-01-03" },
  ])
  await writeJsonl(investorSelectionPath, [
    { symbol: "444444", dateKey: "2025-01-06" },
  ])

  await writeJson(pipelineSummaryPath, {
    kind: "tp12_side_daily_scientific_control_pipeline_v1",
    contract: {
      contractId: "tp12_side_daily_low_gap_top_no_stop_effective_floor_20160812_v3",
      contractPath: "/tmp/contract.json",
    },
    decisionWindow: {
      from: "2016-08-12",
      to: "2026-03-30",
    },
    split: {
      trainDateFrom: "2016-08-12",
      trainDateTo: "2024-12-31",
      oosDateFrom: "2025-01-02",
      oosDateTo: "2026-03-30",
    },
    variants: [
      {
        variantId: "daily_only_no_stop",
        kind: "control",
        gateId: "d0_close",
        datasetIds: [],
        sideFeaturePath: null,
        sideFeatureSummaryPath: path.join(tmpRoot, "control", "daily_only_no_stop", "decision_candidates_feature_pack_control.jsonl"),
        bridgedFeaturePackPath: baselineLabelPath,
        controlPackPath: path.join(tmpRoot, "control", "daily_only_no_stop", "control_summary.json"),
        controlLabelPath: null,
        controlSummaryPath: null,
      },
      {
        variantId: "daily_plus_investor",
        kind: "side_daily",
        gateId: "d0_close",
        datasetIds: ["investor_daily"],
        controlLabelPath: investorLabelPath,
      },
    ],
  })

  await writeJson(selectionManifestPath, {
    kind: "tp12_side_daily_scientific_selection_manifest_v1",
    variants: [
      {
        variantId: "daily_only_no_stop",
        selectionPath: baselineSelectionPath,
      },
      {
        variantId: "daily_plus_investor",
        selectionPath: investorSelectionPath,
      },
    ],
  })

  const result = await buildTp12SideDailyScientificComparisonReport({
    pipelineSummaryPath,
    selectionManifestPath,
    outPath: reportPath,
  })
  const report = await readJson(result.outPath, null)
  const baseline = report.variants.find((variant) => variant.variantId === "daily_only_no_stop")
  const investor = report.variants.find((variant) => variant.variantId === "daily_plus_investor")

  assert(report.kind === "tp12_side_daily_scientific_comparison_report_v1", `unexpected kind: ${report.kind}`)
  assert(Number(baseline?.deployment?.oos?.metricsByLabel?.tp12_no_stop_hit_3d?.selectedRows ?? -1) === 1, "baseline oos selectedRows mismatch")
  assert(Number(baseline?.deployment?.oos?.metricsByLabel?.tp12_no_stop_hit_3d?.hitRows ?? -1) === 0, "baseline oos hitRows mismatch")
  assert(Number(investor?.deployment?.oos?.metricsByLabel?.tp12_no_stop_hit_3d?.selectedRows ?? -1) === 1, "investor oos selectedRows mismatch")
  assert(Number(investor?.deployment?.oos?.metricsByLabel?.tp12_no_stop_hit_3d?.hitRows ?? -1) === 1, "investor oos hitRows mismatch")
  assert(Number(investor?.commonSupportVsBaseline?.oos?.commonCoveragePairCount ?? -1) === 2, "common support oos coverage mismatch")
  assert(
    Number(investor?.commonSupportVsBaseline?.oos?.baseline?.metricsByLabel?.tp12_no_stop_hit_3d?.hitRate ?? -1) === 0,
    "baseline common-support oos hitRate mismatch",
  )
  assert(
    Number(investor?.commonSupportVsBaseline?.oos?.variant?.metricsByLabel?.tp12_no_stop_hit_3d?.hitRate ?? -1) === 1,
    "variant common-support oos hitRate mismatch",
  )
  assert(
    Number(investor?.commonSupportVsBaseline?.oos?.deltaVsBaseline?.tp12_no_stop_hit_3d?.hitRateDelta ?? -1) === 1,
    "common-support hitRate delta mismatch",
  )

  console.log("ok smoke_tp12_side_daily_scientific_comparison_report")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
