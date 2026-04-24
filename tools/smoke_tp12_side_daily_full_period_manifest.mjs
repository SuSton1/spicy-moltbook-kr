import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildTp12SideDailyFullPeriodManifest } from "./build_tp12_side_daily_full_period_manifest.mjs"
import { ensureDir, readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"


const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const main = async () => {
  const tempRoot = path.join(ROOT, "artifacts", "checks", "smoke_tp12_side_daily_full_period_manifest")
  const trainRunDir = path.join(tempRoot, "train_stepa")
  const oosRunDir = path.join(tempRoot, "oos_stepa")
  const candlePath = path.join(tempRoot, "data", "candles.jsonl")
  const outPath = path.join(tempRoot, "manifest", "requests.jsonl")
  const summaryOutPath = path.join(tempRoot, "manifest", "manifest_summary.json")
  const allowlistPath = path.join(tempRoot, "allowlist", "rows.jsonl")

  await ensureDir(path.join(trainRunDir, "step-a"))
  await ensureDir(path.join(oosRunDir, "step-a"))
  await writeJson(path.join(trainRunDir, "step-a", "step_a_summary.json"), {
    eventLabel: "HIGH8_BUYABLE_EX_GAP",
    highJumpMode: "FROM_OPEN_EX_GAP",
    highJumpThreshold: 0.08,
    recentImpulseDiscovery: { lookbackTradingDays: 1 },
  })
  await writeJson(path.join(oosRunDir, "step-a", "step_a_summary.json"), {
    eventLabel: "HIGH8_BUYABLE_EX_GAP",
    highJumpMode: "FROM_OPEN_EX_GAP",
    highJumpThreshold: 0.08,
    recentImpulseDiscovery: { lookbackTradingDays: 1 },
  })
  await writeJsonl(path.join(trainRunDir, "step-a", "events_high8_lite.jsonl"), [
    {
      symbol: "111111",
      dateKey: "2024-12-30",
      prevDateKey: "2024-12-27",
      asOfDateKey: "2024-12-27",
      stepALaneId: "recent_impulse_1d",
      impulseSourceDateKey: "2024-12-30",
      impulseLookbackDays: 1,
    },
  ])
  await writeJsonl(path.join(oosRunDir, "step-a", "events_high8_lite.jsonl"), [
    {
      symbol: "222222",
      dateKey: "2025-01-02",
      prevDateKey: "2024-12-31",
      asOfDateKey: "2024-12-31",
      stepALaneId: "recent_impulse_1d",
      impulseSourceDateKey: "2025-01-02",
      impulseLookbackDays: 1,
    },
  ])
  await writeJsonl(candlePath, [
    { symbol: "111111", dateKey: "2024-12-27" },
    { symbol: "111111", dateKey: "2024-12-30" },
    { symbol: "111111", dateKey: "2024-12-31" },
    { symbol: "111111", dateKey: "2025-01-02" },
    { symbol: "111111", dateKey: "2025-01-03" },
    { symbol: "111111", dateKey: "2025-01-06" },
    { symbol: "222222", dateKey: "2024-12-31" },
    { symbol: "222222", dateKey: "2025-01-02" },
    { symbol: "222222", dateKey: "2025-01-03" },
    { symbol: "222222", dateKey: "2025-01-06" },
    { symbol: "222222", dateKey: "2025-01-07" },
    { symbol: "222222", dateKey: "2025-01-08" },
  ])
  await writeJsonl(allowlistPath, [
    {
      symbol: "111111",
      decisionDateKey: "2024-12-30",
      stepALaneId: "recent_impulse_1d",
      sourceType: "perfect_prototype_stepb_open_eval_pack",
    },
    {
      symbol: "222222",
      decisionDateKey: "2025-01-02",
      stepALaneId: "recent_impulse_1d",
      sourceType: "perfect_prototype_stepb_open_eval_pack",
    },
  ])

  const result = await buildTp12SideDailyFullPeriodManifest({
    cwd: process.cwd(),
    trainRunDir,
    oosRunDir,
    allowlistPath,
    outPath,
    summaryOutPath,
    candlePath,
    allowedLanes: ["recent_impulse_1d"],
    trainDateFrom: "2024-12-30",
    trainDateTo: "2024-12-31",
    oosDateFrom: "2025-01-02",
    oosDateTo: "2025-01-08",
  })

  const rows = await readJsonl(outPath)
  const summary = await readJson(summaryOutPath)
  assert(rows.length === 2, `unexpected row count: ${rows.length}`)
  assert(result.summary.rowCount === 2, `unexpected builder row count: ${result.summary.rowCount}`)
  assert(summary.kind === "tp12_side_daily_full_period_manifest_v1", `unexpected kind: ${summary.kind}`)
  assert(summary.allowlistRowCount === 2, `unexpected allowlistRowCount: ${summary.allowlistRowCount}`)
  assert(summary.allowlistMatchedRowCount === 2, `unexpected allowlistMatchedRowCount: ${summary.allowlistMatchedRowCount}`)
  assert(summary.decisionDateFrom === "2024-12-30", `unexpected decisionDateFrom: ${summary.decisionDateFrom}`)
  assert(summary.decisionDateTo === "2025-01-02", `unexpected decisionDateTo: ${summary.decisionDateTo}`)

  console.log("ok smoke_tp12_side_daily_full_period_manifest")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
