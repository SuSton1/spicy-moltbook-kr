import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildTp12SideDailyFeatureDataset } from "../src/lib/tp12_side_daily_feature_builder.mjs"
import { ensureDir, readJson, readJsonl, writeJsonl } from "../src/lib/io.mjs"


const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const buildManifestRows = () => [
  {
    requestId: "2024-01-04::111111::same_day_high8",
    symbol: "111111",
    decisionDateKey: "2024-01-04",
    prevDateKey: "2024-01-03",
    asOfDateKey: "2024-01-03",
    stepALaneId: "same_day_high8",
    runId: "smoke_stepa",
    eventLabel: "high8",
    highJumpThreshold: 0.08,
    highJumpMode: "same_day_high8",
    impulseSourceDateKey: "2024-01-04",
    impulseLookbackDays: 1,
    recentImpulseLookbackTradingDays: 20,
    windowDateKeys: ["2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09", "2024-01-10"],
  },
]

const buildCandleRows = () => [
  { symbol: "111111", dateKey: "2024-01-03", open: 100, high: 105, low: 99, close: 104, volume: 1000 },
  { symbol: "111111", dateKey: "2024-01-04", open: 104, high: 115, low: 103, close: 113, volume: 1500 },
  { symbol: "111111", dateKey: "2024-01-05", open: 114, high: 121, low: 112, close: 118, volume: 1600 },
  { symbol: "111111", dateKey: "2024-01-08", open: 118, high: 130, low: 117, close: 128, volume: 1700 },
  { symbol: "111111", dateKey: "2024-01-09", open: 128, high: 129, low: 122, close: 123, volume: 1400 },
  { symbol: "111111", dateKey: "2024-01-10", open: 123, high: 124, low: 120, close: 121, volume: 1300 },
]

const buildSideRows = () => ({
  investor_daily: [
    { dataset: "investor_daily", apiId: "ka10060", source: "KIWOOM", symbol: "111111", dateKey: "2024-01-03", rawRow: { dt: "20240103", ind_invsr: "100" } },
    { dataset: "investor_daily", apiId: "ka10060", source: "KIWOOM", symbol: "111111", dateKey: "2024-01-04", rawRow: { dt: "20240104", ind_invsr: "180" } },
  ],
  program_daily: [
    { dataset: "program_daily", apiId: "ka90013", source: "KIWOOM", symbol: "111111", dateKey: "2024-01-03", rawRow: { dt: "20240103", prm_netprps_amt: "2000" } },
    { dataset: "program_daily", apiId: "ka90013", source: "KIWOOM", symbol: "111111", dateKey: "2024-01-04", rawRow: { dt: "20240104", prm_netprps_amt: "5000" } },
  ],
  trade_strength_daily: [
    { dataset: "trade_strength_daily", apiId: "ka10047", source: "KIWOOM", symbol: "111111", dateKey: "2024-01-03", rawRow: { dt: "20240103", cntr_str: "98.5" } },
    { dataset: "trade_strength_daily", apiId: "ka10047", source: "KIWOOM", symbol: "111111", dateKey: "2024-01-04", rawRow: { dt: "20240104", cntr_str: "112.4" } },
  ],
})

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const main = async () => {
  const tmpRoot = path.join(ROOT, "artifacts", "checks", "smoke_tp12_side_daily_feature_dataset")
  const manifestPath = path.join(tmpRoot, "manifest.jsonl")
  const candlePath = path.join(tmpRoot, "data", "candle_daily.jsonl")
  const sideRoot = path.join(tmpRoot, "data", "intraday_side")
  const outPath = path.join(tmpRoot, "features", "feature_rows.jsonl")
  const summaryOutPath = path.join(tmpRoot, "features", "feature_summary.json")

  await ensureDir(tmpRoot)
  await writeJsonl(manifestPath, buildManifestRows())
  await writeJsonl(candlePath, buildCandleRows())
  const sideRows = buildSideRows()
  await writeJsonl(path.join(sideRoot, "investor_daily.jsonl"), sideRows.investor_daily)
  await writeJsonl(path.join(sideRoot, "program_daily.jsonl"), sideRows.program_daily)
  await writeJsonl(path.join(sideRoot, "trade_strength_daily.jsonl"), sideRows.trade_strength_daily)

  await buildTp12SideDailyFeatureDataset({
    manifestPath,
    candlePath,
    investorDailyPath: path.join(sideRoot, "investor_daily.jsonl"),
    programDailyPath: path.join(sideRoot, "program_daily.jsonl"),
    tradeStrengthDailyPath: path.join(sideRoot, "trade_strength_daily.jsonl"),
    datasetIds: ["investor_daily", "program_daily", "trade_strength_daily"],
    outPath,
    summaryOutPath,
  })

  const featureRows = await readJsonl(outPath)
  const summary = await readJson(summaryOutPath)
  assert(featureRows.length === 1, `expected 1 feature row, got ${featureRows.length}`)
  assert(summary.rowCount === 1, `expected summary rowCount=1, got ${summary.rowCount}`)
  const row = featureRows[0]
  assert(row.gateId === "d0_close", `unexpected gateId: ${row.gateId}`)
  assert(row.labels.tp12_no_stop_hit_3d === 1, `expected tp12_no_stop_hit_3d=1, got ${row.labels.tp12_no_stop_hit_3d}`)
  assert(row.labels.tp12_no_stop_hit_4d === 1, `expected tp12_no_stop_hit_4d=1, got ${row.labels.tp12_no_stop_hit_4d}`)
  assert(row.features.investor_day_delta === 80, `unexpected investor_day_delta: ${row.features.investor_day_delta}`)
  assert(row.features.program_day_delta === 3000, `unexpected program_day_delta: ${row.features.program_day_delta}`)
  assert(row.features.trade_strength_d0_above_100 === 1, `unexpected trade_strength_d0_above_100: ${row.features.trade_strength_d0_above_100}`)
  assert(summary.labelIds.includes("tp12_no_stop_hit_3d"), `missing labelIds: ${JSON.stringify(summary.labelIds)}`)

  console.log("ok smoke_tp12_side_daily_feature_dataset")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
