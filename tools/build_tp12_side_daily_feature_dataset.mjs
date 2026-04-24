import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { normalizeDateKey } from "../src/lib/date.mjs"
import { buildTp12SideDailyFeatureDataset, TP12_SIDE_DAILY_GATE_SPECS } from "../src/lib/tp12_side_daily_feature_builder.mjs"


const DEFAULT_GATE_IDS = TP12_SIDE_DAILY_GATE_SPECS.map((spec) => spec.gateId)

const toText = (value) => String(value ?? "").trim()

const parseCsv = (value) =>
  Array.from(new Set(String(value ?? "").split(",").map((token) => token.trim()).filter(Boolean)))

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const manifestPathRaw = toText(getFlag(flags, "manifest-path", ""))
  const outPathRaw = toText(getFlag(flags, "out", ""))
  if (!manifestPathRaw || !outPathRaw) {
    throw new Error("build_tp12_side_daily_feature_dataset requires --manifest-path and --out")
  }
  const manifestPath = path.resolve(cwd, manifestPathRaw)
  const outPath = path.resolve(cwd, outPathRaw)
  const summaryOutPath = path.resolve(
    cwd,
    toText(getFlag(flags, "summary-out", path.join(path.dirname(outPath), "feature_summary.json"))),
  )
  return {
    manifestPath,
    outPath,
    summaryOutPath,
    candlePath: path.resolve(cwd, toText(getFlag(flags, "candle-path", "data/candle_daily.jsonl"))),
    investorDailyPath: path.resolve(cwd, toText(getFlag(flags, "investor-daily-path", "data/intraday_side/investor_daily.jsonl"))),
    programDailyPath: path.resolve(cwd, toText(getFlag(flags, "program-daily-path", "data/intraday_side/program_daily.jsonl"))),
    tradeStrengthDailyPath: path.resolve(cwd, toText(getFlag(flags, "trade-strength-daily-path", "data/intraday_side/trade_strength_daily.jsonl"))),
    datasetIds: parseCsv(getFlag(flags, "dataset-ids", "investor_daily,program_daily")),
    decisionFrom: normalizeDateKey(getFlag(flags, "decision-from", null)),
    decisionTo: normalizeDateKey(getFlag(flags, "decision-to", null)),
    gateIds: parseCsv(getFlag(flags, "gate-ids", DEFAULT_GATE_IDS.join(","))),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const result = await buildTp12SideDailyFeatureDataset(args)
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        summaryOutPath: result.summaryOutPath,
        rowCount: result.summary.rowCount,
        requestCount: result.summary.requestCount,
        gateCounts: result.summary.gateCounts,
        featureFamilies: result.summary.featureFamilies,
        labelIds: result.summary.labelIds,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
