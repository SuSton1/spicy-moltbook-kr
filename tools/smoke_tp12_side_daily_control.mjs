import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildTp12SideDailyControlArtifact } from "../src/lib/tp12_side_daily_control_builder.mjs"
import { ensureDir, readJson, readJsonl, writeJsonl } from "../src/lib/io.mjs"


const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const main = async () => {
  const tmpRoot = path.join(ROOT, "artifacts", "checks", "smoke_tp12_side_daily_control")
  const manifestPath = path.join(tmpRoot, "manifest", "requests.jsonl")
  const featurePackPath = path.join(tmpRoot, "step-d", "decision_candidates_feature_pack.jsonl")
  const candlePath = path.join(tmpRoot, "data", "candle_daily.jsonl")
  const outPath = path.join(tmpRoot, "control", "decision_candidates_feature_pack_control.jsonl")
  const labelOutPath = path.join(tmpRoot, "control", "no_stop_label_rows.jsonl")
  const summaryOutPath = path.join(tmpRoot, "control", "control_summary.json")

  await ensureDir(tmpRoot)
  await writeJsonl(manifestPath, [
    {
      requestId: "2024-01-03::111111::same_day_high8",
      symbol: "111111",
      decisionDateKey: "2024-01-03",
      prevDateKey: "2024-01-02",
      asOfDateKey: "2024-01-02",
      stepALaneId: "same_day_high8",
      runId: "stepa_test",
      eventLabel: "same_day_high8",
      highJumpThreshold: 0.08,
      highJumpMode: "high_over_prev_close",
      impulseSourceDateKey: "2024-01-03",
      impulseLookbackDays: 1,
      recentImpulseLookbackTradingDays: 1,
      windowDateKeys: ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09"],
    },
  ])
  await writeJsonl(featurePackPath, [
    {
      symbol: "111111",
      decisionDateKey: "2024-01-03",
      featureVec: {
        "daily.alpha": 1.5,
      },
      contextualTokens: ["tag:baseline"],
    },
  ])
  await writeJsonl(candlePath, [
    { symbol: "111111", dateKey: "2024-01-02", open: 98, high: 100, low: 97, close: 99 },
    { symbol: "111111", dateKey: "2024-01-03", open: 100, high: 104, low: 99, close: 101 },
    { symbol: "111111", dateKey: "2024-01-04", open: 100, high: 106, low: 99, close: 104 },
    { symbol: "111111", dateKey: "2024-01-05", open: 104, high: 113, low: 103, close: 111 },
    { symbol: "111111", dateKey: "2024-01-08", open: 111, high: 115, low: 110, close: 114 },
    { symbol: "111111", dateKey: "2024-01-09", open: 114, high: 116, low: 112, close: 115 },
  ])

  const result = await buildTp12SideDailyControlArtifact({
    manifestPath,
    featurePackPath,
    candlePath,
    outPath,
    labelOutPath,
    summaryOutPath,
    trainDateFrom: "2024-01-01",
    trainDateTo: "2024-12-31",
    oosDateFrom: "2025-01-01",
    oosDateTo: "2025-12-31",
    stepALaneSet: ["same_day_high8"],
    targetLabelIds: ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"],
    allowlistPolicy: "manifest_exact_pair_support",
    commonSupportPolicy: "exact_pair_intersection",
  })

  const controlRows = await readJsonl(outPath)
  const labelRows = await readJsonl(labelOutPath)
  const summary = await readJson(summaryOutPath)

  assert(result.summary.rowCount === 1, `unexpected rowCount: ${result.summary.rowCount}`)
  assert(controlRows.length === 1, `unexpected control row count: ${controlRows.length}`)
  assert(labelRows.length === 1, `unexpected label row count: ${labelRows.length}`)
  assert(controlRows[0]?.featureVec?.["daily.alpha"] === 1.5, "missing baseline feature")
  assert(!("labels" in controlRows[0]), "control feature pack must not copy labels")
  assert(
    controlRows[0]?.sideDailyControl?.controlId === "daily_only_no_stop",
    `unexpected controlId: ${controlRows[0]?.sideDailyControl?.controlId}`,
  )
  assert(
    labelRows[0]?.labels?.tp12_no_stop_hit_3d === 1,
    `expected tp12_no_stop_hit_3d=1, got ${labelRows[0]?.labels?.tp12_no_stop_hit_3d}`,
  )
  assert(
    labelRows[0]?.labels?.tp12_no_stop_hit_4d === 1,
    `expected tp12_no_stop_hit_4d=1, got ${labelRows[0]?.labels?.tp12_no_stop_hit_4d}`,
  )
  assert(summary.kind === "tp12_side_daily_control_artifact_v1", `unexpected summary kind: ${summary.kind}`)
  assert(summary.trainRowCount === 1, `unexpected trainRowCount: ${summary.trainRowCount}`)
  assert(summary.oosRowCount === 0, `unexpected oosRowCount: ${summary.oosRowCount}`)
  assert(summary.coverage?.matchedPairCount === 1, `unexpected matchedPairCount: ${summary.coverage?.matchedPairCount}`)

  console.log("ok smoke_tp12_side_daily_control")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
