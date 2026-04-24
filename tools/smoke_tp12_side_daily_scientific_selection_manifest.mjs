import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildTp12SideDailyScientificSelectionManifest } from "../src/lib/tp12_side_daily_scientific_selection_manifest.mjs"
import { ensureDir, readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"


const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const main = async () => {
  const tmpRoot = path.join(ROOT, "artifacts", "checks", "smoke_tp12_side_daily_scientific_selection_manifest")
  const pipelineSummaryPath = path.join(tmpRoot, "pipeline", "pipeline_summary.json")
  const outPath = path.join(tmpRoot, "selection", "selection_manifest.json")
  const baselineRunDir = path.join(tmpRoot, "runs", "baseline")
  const baselineEvalDir = path.join(baselineRunDir, "step-perfect-prototype-open-eval-report")
  const baselineTrainClose28Dir = path.join(baselineRunDir, "train_apply_close28")
  const baselineOosClose28Dir = path.join(baselineRunDir, "oos_apply_close28")
  const investorSelectionPath = path.join(tmpRoot, "source", "investor_selected.jsonl")
  const investorSelectionSummaryPath = path.join(tmpRoot, "source", "investor_selected_summary.json")
  await ensureDir(tmpRoot)

  await writeJson(pipelineSummaryPath, {
    kind: "tp12_side_daily_scientific_control_pipeline_v1",
    effectiveCoverage: {
      featurePack: {
        decisionDateFrom: "2024-01-03",
        decisionDateTo: "2025-01-07",
        train: {
          decisionDateFrom: "2024-01-03",
          decisionDateTo: "2024-01-03",
        },
        oos: {
          decisionDateFrom: "2025-01-06",
          decisionDateTo: "2025-01-06",
        },
      },
    },
    variants: [
      {
        variantId: "daily_only_no_stop",
        kind: "control",
        gateId: "d0_close",
        datasetIds: [],
        sideFeaturePath: null,
        sideFeatureSummaryPath: path.join(tmpRoot, "control", "daily_only_no_stop", "decision_candidates_feature_pack_control.jsonl"),
        bridgedFeaturePackPath: path.join(tmpRoot, "control", "daily_only_no_stop", "no_stop_label_rows.jsonl"),
        controlPackPath: path.join(tmpRoot, "control", "daily_only_no_stop", "control_summary.json"),
        controlLabelPath: null,
        controlSummaryPath: null,
      },
      {
        variantId: "daily_plus_investor",
        kind: "side_daily",
        gateId: "d0_close",
        datasetIds: ["investor_daily"],
        controlLabelPath: "/tmp/investor_labels.jsonl",
      },
    ],
  })

  await writeJson(path.join(baselineEvalDir, "open_eval_manifest.json"), {
    selectionMode: "union_all",
    trainApplyClose28Dir: baselineTrainClose28Dir,
    oosApplyClose28Dir: baselineOosClose28Dir,
  })
  await writeJson(path.join(baselineEvalDir, "selection_guardrail_summary.json"), {
    runId: "baseline_smoke",
    close28SelectedRows: 2,
  })
  await writeJsonl(path.join(baselineTrainClose28Dir, "deduped_symbols.jsonl"), [
    { symbol: "111111", dateKey: "2024-01-03" },
  ])
  await writeJsonl(path.join(baselineOosClose28Dir, "deduped_symbols.jsonl"), [
    { symbol: "222222", recommendationDateKey: "2025-01-06" },
    { symbol: "999999", recommendationDateKey: "2025-01-07" },
  ])
  await writeJsonl(investorSelectionPath, [
    { symbol: "333333", decisionDateKey: "2025-01-07" },
  ])
  await writeJson(investorSelectionSummaryPath, {
    rowCount: 1,
  })

  const result = await buildTp12SideDailyScientificSelectionManifest({
    pipelineSummaryPath,
    outPath,
    variantSelectionMap: `daily_only_no_stop=${baselineRunDir};daily_plus_investor=${investorSelectionPath}`,
    variantSelectionSummaryMap: `daily_plus_investor=${investorSelectionSummaryPath}`,
  })
  const manifest = await readJson(result.outPath, null)
  const baselineVariant = manifest.variants.find((variant) => variant.variantId === "daily_only_no_stop")
  const investorVariant = manifest.variants.find((variant) => variant.variantId === "daily_plus_investor")
  const baselineSelectionRows = await readJsonl(baselineVariant.selectionPath)
  const baselineSelectionSummary = await readJson(baselineVariant.selectionSummaryPath, null)
  const investorSelectionRows = await readJsonl(investorVariant.selectionPath)

  assert(manifest.kind === "tp12_side_daily_scientific_selection_manifest_v1", `unexpected kind: ${manifest.kind}`)
  assert(Array.isArray(manifest.variants) && manifest.variants.length === 2, "expected 2 manifest variants")
  assert(String(baselineVariant.selectionPath).includes("/selection_rows/daily_only_no_stop_selected_rows.jsonl"), "baseline selectionPath was not materialized")
  assert(String(investorVariant.selectionSummaryPath).includes("/selection_rows/daily_plus_investor_selected_rows_summary.json"), "investor selection summary was not materialized")
  assert(baselineSelectionRows.length === 2, "baseline selection row count mismatch")
  assert(baselineSelectionRows[0].decisionDateKey === "2024-01-03", "baseline train decisionDateKey mismatch")
  assert(baselineSelectionRows[1].decisionDateKey === "2025-01-06", "baseline oos decisionDateKey mismatch")
  assert(baselineSelectionSummary.sourceKind === "open_eval_manifest", "baseline source kind mismatch")
  assert(String(baselineSelectionSummary.sourceSelectionSummaryPath).endsWith("/selection_guardrail_summary.json"), "baseline source summary path mismatch")
  assert(baselineSelectionSummary.requestedRowCount === 3, `unexpected requestedRowCount: ${baselineSelectionSummary.requestedRowCount}`)
  assert(
    baselineSelectionSummary.trimmedByEffectiveCoverage === 1,
    `unexpected trimmedByEffectiveCoverage: ${baselineSelectionSummary.trimmedByEffectiveCoverage}`,
  )
  assert(investorSelectionRows[0].decisionDateKey === "2025-01-07", "investor decisionDateKey mismatch")

  console.log("ok smoke_tp12_side_daily_scientific_selection_manifest")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
