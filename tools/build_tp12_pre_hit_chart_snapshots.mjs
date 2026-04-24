#!/usr/bin/env node
import { buildTp12PreHitChartSnapshots, parseCliArgs } from "../src/lib/tp12_train100_positive_motif_common.mjs"

const args = parseCliArgs()
if (args.help) {
  console.log("usage: node tools/build_tp12_pre_hit_chart_snapshots.mjs --contract=<path> [--universe=<path>] [--candle-path=<path>] [--lookback-days=N] [--require-candle-history=true|false] [--out=<path>] [--manifest=<path>]")
  process.exit(0)
}
const summary = await buildTp12PreHitChartSnapshots({
  contractPath: args.contract,
  universePath: args.universe,
  candleDailyPath: args["candle-path"] ?? args.candlePath,
  lookbackDays: args["lookback-days"] ?? args.lookbackDays,
  requireCandleHistory: args["require-candle-history"] ?? args.requireCandleHistory,
  outPath: args.out,
  outManifestPath: args.manifest,
})
console.log(JSON.stringify({
  rowCount: summary.rowCount,
  hitRowCount: summary.hitRowCount,
  featureMissingRows: summary.featureMissingRows,
  candleHistoryCoverageRate: summary.candleHistoryCoverageRate,
  candleHistoryMissingRows: summary.candleHistoryMissingRows,
}, null, 2))
