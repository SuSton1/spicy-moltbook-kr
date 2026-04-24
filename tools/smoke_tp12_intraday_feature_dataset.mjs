import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildTp12IntradayFeatureDataset } from "../src/lib/tp12_intraday_feature_builder.mjs"
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

const buildMinuteRowsByDate = () => ({
  "2024-01-03": [
    { symbol: "111111", tradingDateKey: "2024-01-03", tsKst: "2024-01-03T09:00:00+09:00", open: 100, high: 102, low: 99, close: 101, volume: 10, valueKrw: 1010, source: "KIWOOM", apiId: "ka10080" },
    { symbol: "111111", tradingDateKey: "2024-01-03", tsKst: "2024-01-03T15:00:00+09:00", open: 101, high: 106, low: 100, close: 105, volume: 30, valueKrw: 3150, source: "KIWOOM", apiId: "ka10080" },
  ],
  "2024-01-04": [
    { symbol: "111111", tradingDateKey: "2024-01-04", tsKst: "2024-01-04T09:00:00+09:00", open: 106, high: 108, low: 105, close: 107, volume: 10, valueKrw: 1070, source: "KIWOOM", apiId: "ka10080" },
    { symbol: "111111", tradingDateKey: "2024-01-04", tsKst: "2024-01-04T09:05:00+09:00", open: 107, high: 110, low: 106, close: 109, volume: 12, valueKrw: 1308, source: "KIWOOM", apiId: "ka10080" },
    { symbol: "111111", tradingDateKey: "2024-01-04", tsKst: "2024-01-04T09:15:00+09:00", open: 109, high: 114, low: 108, close: 113, volume: 15, valueKrw: 1695, source: "KIWOOM", apiId: "ka10080" },
    { symbol: "111111", tradingDateKey: "2024-01-04", tsKst: "2024-01-04T09:30:00+09:00", open: 113, high: 118, low: 112, close: 116, volume: 18, valueKrw: 2088, source: "KIWOOM", apiId: "ka10080" },
    { symbol: "111111", tradingDateKey: "2024-01-04", tsKst: "2024-01-04T15:20:00+09:00", open: 116, high: 117, low: 114, close: 116, volume: 20, valueKrw: 2320, source: "KIWOOM", apiId: "ka10080" },
  ],
  "2024-01-05": [
    { symbol: "111111", tradingDateKey: "2024-01-05", tsKst: "2024-01-05T09:00:00+09:00", open: 117, high: 118, low: 115, close: 116, volume: 10, valueKrw: 1160, source: "KIWOOM", apiId: "ka10080" },
    { symbol: "111111", tradingDateKey: "2024-01-05", tsKst: "2024-01-05T09:05:00+09:00", open: 116, high: 119, low: 114, close: 118, volume: 12, valueKrw: 1416, source: "KIWOOM", apiId: "ka10080" },
    { symbol: "111111", tradingDateKey: "2024-01-05", tsKst: "2024-01-05T09:15:00+09:00", open: 118, high: 132, low: 118, close: 131, volume: 25, valueKrw: 3275, source: "KIWOOM", apiId: "ka10080" },
    { symbol: "111111", tradingDateKey: "2024-01-05", tsKst: "2024-01-05T09:30:00+09:00", open: 131, high: 133, low: 130, close: 132, volume: 20, valueKrw: 2640, source: "KIWOOM", apiId: "ka10080" },
    { symbol: "111111", tradingDateKey: "2024-01-05", tsKst: "2024-01-05T15:20:00+09:00", open: 132, high: 133, low: 129, close: 130, volume: 18, valueKrw: 2340, source: "KIWOOM", apiId: "ka10080" },
  ],
  "2024-01-08": [
    { symbol: "111111", tradingDateKey: "2024-01-08", tsKst: "2024-01-08T09:00:00+09:00", open: 129, high: 130, low: 126, close: 127, volume: 10, valueKrw: 1270, source: "KIWOOM", apiId: "ka10080" },
    { symbol: "111111", tradingDateKey: "2024-01-08", tsKst: "2024-01-08T15:20:00+09:00", open: 127, high: 128, low: 125, close: 126, volume: 12, valueKrw: 1512, source: "KIWOOM", apiId: "ka10080" },
  ],
  "2024-01-09": [
    { symbol: "111111", tradingDateKey: "2024-01-09", tsKst: "2024-01-09T09:00:00+09:00", open: 126, high: 127, low: 124, close: 125, volume: 10, valueKrw: 1250, source: "KIWOOM", apiId: "ka10080" },
    { symbol: "111111", tradingDateKey: "2024-01-09", tsKst: "2024-01-09T15:20:00+09:00", open: 125, high: 126, low: 123, close: 124, volume: 12, valueKrw: 1488, source: "KIWOOM", apiId: "ka10080" },
  ],
  "2024-01-10": [
    { symbol: "111111", tradingDateKey: "2024-01-10", tsKst: "2024-01-10T09:00:00+09:00", open: 124, high: 125, low: 122, close: 123, volume: 10, valueKrw: 1230, source: "KIWOOM", apiId: "ka10080" },
    { symbol: "111111", tradingDateKey: "2024-01-10", tsKst: "2024-01-10T15:20:00+09:00", open: 123, high: 124, low: 121, close: 122, volume: 12, valueKrw: 1464, source: "KIWOOM", apiId: "ka10080" },
  ],
})

const buildPresenceRows = () =>
  Object.entries(buildMinuteRowsByDate()).map(([tradingDateKey, rows]) => ({
    symbol: "111111",
    tradingDateKey,
    barCount: rows.length,
    firstTsKst: rows[0].tsKst,
    lastTsKst: rows[rows.length - 1].tsKst,
    status: "completed",
    source: "KIWOOM",
  }))

const buildSideRows = () => ({
  investor_daily: [
    { dataset: "investor_daily", apiId: "ka10060", source: "KIWOOM", symbol: "111111", dateKey: "2024-01-03", rawRow: { dt: "20240103", ind_invsr: "100" } },
    { dataset: "investor_daily", apiId: "ka10060", source: "KIWOOM", symbol: "111111", dateKey: "2024-01-04", rawRow: { dt: "20240104", ind_invsr: "160" } },
  ],
  program_daily: [
    { dataset: "program_daily", apiId: "ka90013", source: "KIWOOM", symbol: "111111", dateKey: "2024-01-03", rawRow: { dt: "20240103", prm_netprps_amt: "2000" } },
    { dataset: "program_daily", apiId: "ka90013", source: "KIWOOM", symbol: "111111", dateKey: "2024-01-04", rawRow: { dt: "20240104", prm_netprps_amt: "3200" } },
  ],
  trade_strength_daily: [
    { dataset: "trade_strength_daily", apiId: "ka10047", source: "KIWOOM", symbol: "111111", dateKey: "2024-01-03", rawRow: { dt: "20240103", cntr_str: "101.5" } },
    { dataset: "trade_strength_daily", apiId: "ka10047", source: "KIWOOM", symbol: "111111", dateKey: "2024-01-04", rawRow: { dt: "20240104", cntr_str: "108.2" } },
  ],
})

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const main = async () => {
  const tmpRoot = path.join(ROOT, "artifacts", "checks", "smoke_tp12_intraday_feature_dataset")
  const manifestPath = path.join(tmpRoot, "manifest.jsonl")
  const minuteRoot = path.join(tmpRoot, "data", "intraday_1m")
  const presencePath = path.join(tmpRoot, "data", "intraday_1m_presence_daily.jsonl")
  const sideRoot = path.join(tmpRoot, "data", "intraday_side")
  const outPath = path.join(tmpRoot, "features", "feature_rows.jsonl")
  const summaryOutPath = path.join(tmpRoot, "features", "feature_summary.json")

  await ensureDir(tmpRoot)
  await writeJsonl(manifestPath, buildManifestRows())
  for (const [dateKey, rows] of Object.entries(buildMinuteRowsByDate())) {
    await writeJsonl(path.join(minuteRoot, `date=${dateKey}`, "part-000.jsonl"), rows)
  }
  await writeJsonl(presencePath, buildPresenceRows())
  const sideRows = buildSideRows()
  await writeJsonl(path.join(sideRoot, "investor_daily.jsonl"), sideRows.investor_daily)
  await writeJsonl(path.join(sideRoot, "program_daily.jsonl"), sideRows.program_daily)
  await writeJsonl(path.join(sideRoot, "trade_strength_daily.jsonl"), sideRows.trade_strength_daily)

  await buildTp12IntradayFeatureDataset({
    manifestPath,
    minuteRoot,
    minutePresencePath: presencePath,
    investorDailyPath: path.join(sideRoot, "investor_daily.jsonl"),
    programDailyPath: path.join(sideRoot, "program_daily.jsonl"),
    tradeStrengthDailyPath: path.join(sideRoot, "trade_strength_daily.jsonl"),
    outPath,
    summaryOutPath,
  })

  const featureRows = await readJsonl(outPath)
  const summary = await readJson(summaryOutPath)
  assert(featureRows.length === 4, `expected 4 feature rows, got ${featureRows.length}`)
  assert(summary.rowCount === 4, `expected summary rowCount=4, got ${summary.rowCount}`)
  const d0Row = featureRows.find((row) => row.gateId === "d0_close")
  assert(Boolean(d0Row), "missing d0_close row")
  assert(d0Row.labels.firstBarrierOutcome === "tp12_first", `unexpected d0 outcome: ${d0Row.labels.firstBarrierOutcome}`)
  assert(d0Row.labels.stop_first_net_ret === 0.12, `unexpected d0 stop_first_net_ret: ${d0Row.labels.stop_first_net_ret}`)
  assert(d0Row.features.dminus1_close_runup_pct > 0, "expected positive dminus1_close_runup_pct")
  const d1Row = featureRows.find((row) => row.gateId === "d1_0905")
  assert(Boolean(d1Row), "missing d1_0905 row")
  assert(d1Row.entryPriceMode === "cutoff_close", `unexpected entryPriceMode: ${d1Row.entryPriceMode}`)
  assert(d1Row.features.d1_high_pct_to_cutoff > 0, "expected positive d1_high_pct_to_cutoff")
  assert(summary.gateCounts.d1_0930 === 1, `unexpected gateCounts: ${JSON.stringify(summary.gateCounts)}`)

  console.log("ok smoke_tp12_intraday_feature_dataset")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
