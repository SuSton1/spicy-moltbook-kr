import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12SideDailyControlInputPack } from "../src/lib/tp12_side_daily_control_input_pack.mjs"


const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const trainPackPath = toText(getFlag(flags, "train-pack-path", ""))
  const oosPackPath = toText(getFlag(flags, "oos-pack-path", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!trainPackPath || !oosPackPath || !outPath) {
    throw new Error("build_tp12_side_daily_control_input_pack requires --train-pack-path --oos-pack-path --out")
  }
  return {
    trainPackPath: path.resolve(cwd, trainPackPath),
    oosPackPath: path.resolve(cwd, oosPackPath),
    outPath: path.resolve(cwd, outPath),
    summaryOutPath: path.resolve(
      cwd,
      toText(getFlag(flags, "summary-out", path.join(path.dirname(outPath), "control_input_summary.json"))),
    ),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const result = await buildTp12SideDailyControlInputPack(args)
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        summaryOutPath: result.summaryOutPath,
        rowCount: result.summary.rowCount,
        decisionDateFrom: result.summary.decisionDateFrom,
        decisionDateTo: result.summary.decisionDateTo,
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
