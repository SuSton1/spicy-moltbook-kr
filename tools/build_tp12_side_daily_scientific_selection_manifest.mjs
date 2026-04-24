import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12SideDailyScientificSelectionManifest } from "../src/lib/tp12_side_daily_scientific_selection_manifest.mjs"


const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const pipelineSummaryPathRaw = toText(getFlag(flags, "pipeline-summary-path", ""))
  const outPathRaw = toText(getFlag(flags, "out", ""))
  if (!pipelineSummaryPathRaw || !outPathRaw) {
    throw new Error("build_tp12_side_daily_scientific_selection_manifest requires --pipeline-summary-path --out")
  }
  return {
    pipelineSummaryPath: path.resolve(cwd, pipelineSummaryPathRaw),
    outPath: path.resolve(cwd, outPathRaw),
    variantSelectionMap: toText(getFlag(flags, "variant-selection-map", "")),
    variantSelectionSummaryMap: toText(getFlag(flags, "variant-selection-summary-map", "")),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const result = await buildTp12SideDailyScientificSelectionManifest(args)
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        kind: result.manifest.kind,
        variantIds: Array.isArray(result.manifest.variants) ? result.manifest.variants.map((variant) => variant.variantId) : [],
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
