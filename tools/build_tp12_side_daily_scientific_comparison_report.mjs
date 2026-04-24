import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12SideDailyScientificComparisonReport } from "../src/lib/tp12_side_daily_scientific_comparison.mjs"


const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const pipelineSummaryPathRaw = toText(getFlag(flags, "pipeline-summary-path", ""))
  const selectionManifestPathRaw = toText(getFlag(flags, "selection-manifest-path", ""))
  const outPathRaw = toText(getFlag(flags, "out", ""))
  if (!pipelineSummaryPathRaw || !selectionManifestPathRaw || !outPathRaw) {
    throw new Error(
      "build_tp12_side_daily_scientific_comparison_report requires --pipeline-summary-path --selection-manifest-path --out",
    )
  }
  return {
    pipelineSummaryPath: path.resolve(cwd, pipelineSummaryPathRaw),
    selectionManifestPath: path.resolve(cwd, selectionManifestPathRaw),
    outPath: path.resolve(cwd, outPathRaw),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const result = await buildTp12SideDailyScientificComparisonReport(args)
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        kind: result.report.kind,
        contractId: result.report?.contract?.contractId ?? null,
        baselineVariantId: result.report.baselineVariantId,
        variantIds: Array.isArray(result.report.variants) ? result.report.variants.map((variant) => variant.variantId) : [],
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
