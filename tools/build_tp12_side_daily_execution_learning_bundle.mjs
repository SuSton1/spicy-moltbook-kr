import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12SideDailyExecutionLearningBundle } from "../src/lib/tp12_side_daily_execution_learning_bundle.mjs"

const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const pipelineSummaryPathRaw = toText(getFlag(flags, "pipeline-summary-path", ""))
  const selectionManifestPathRaw = toText(getFlag(flags, "selection-manifest-path", ""))
  const outDirRaw = toText(getFlag(flags, "out-dir", ""))
  if (!pipelineSummaryPathRaw || !selectionManifestPathRaw || !outDirRaw) {
    throw new Error(
      "build_tp12_side_daily_execution_learning_bundle requires --pipeline-summary-path --selection-manifest-path --out-dir",
    )
  }
  return {
    pipelineSummaryPath: path.resolve(cwd, pipelineSummaryPathRaw),
    selectionManifestPath: path.resolve(cwd, selectionManifestPathRaw),
    outDir: path.resolve(cwd, outDirRaw),
    candlePath: path.resolve(cwd, toText(getFlag(flags, "candle-path", "data/candle_daily.jsonl"))),
    recentReplayDecisionCount: Number(getFlag(flags, "recent-replay-decision-count", 30)),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const result = await buildTp12SideDailyExecutionLearningBundle(args)
  console.log(
    JSON.stringify(
      {
        outDir: result.outDir,
        kind: result.summary.kind,
        baselineVariantId: result.summary.baselineVariantId,
        donorRowCount: result.summary?.donorRows?.rowCount ?? 0,
        executionLabelRowCount: result.summary?.executionLabels?.rowCount ?? 0,
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
