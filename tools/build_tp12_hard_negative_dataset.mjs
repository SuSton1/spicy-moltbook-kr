#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12HardNegativeDataset } from "../src/lib/tp12_hard_negative_dataset.mjs"
import { toBool, toNumber, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const inputPath = toText(getFlag(flags, "input", getFlag(flags, "features", getFlag(flags, "events", ""))))
  const outPath = toText(getFlag(flags, "out", ""))
  const manifestPath = toText(getFlag(flags, "manifest", getFlag(flags, "manifest-path", "")))
  if (!inputPath || !outPath || !manifestPath) {
    throw new Error("build_tp12_hard_negative_dataset requires --input, --out, and --manifest")
  }
  const manifest = await buildTp12HardNegativeDataset({
    inputPath: path.resolve(cwd, inputPath),
    outPath: path.resolve(cwd, outPath),
    manifestPath: path.resolve(cwd, manifestPath),
    dateFrom: toText(getFlag(flags, "from", getFlag(flags, "date-from", ""))),
    dateTo: toText(getFlag(flags, "to", getFlag(flags, "date-to", ""))),
    forbiddenDateFrom: toText(getFlag(flags, "forbidden-date-from", "")),
    forbiddenDateTo: toText(getFlag(flags, "forbidden-date-to", "")),
    targetPct: toNumber(getFlag(flags, "target-pct", 0.12), 0.12),
    nearMissMinPct: toNumber(getFlag(flags, "near-miss-min-pct", 0.08), 0.08),
    hardNegativeMaxForwardReturnPct: toNumber(getFlag(flags, "hard-negative-max-forward-return-pct", 0.04), 0.04),
    requirePathMetrics: toBool(getFlag(flags, "require-path-metrics", true), true),
    targetBoundaryTolerance: toNumber(getFlag(flags, "target-boundary-tolerance", 1e-9), 1e-9),
  })
  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        outputRowCount: manifest.outputRowCount,
        labelClassCounts: manifest.labelClassCounts,
        outPath: path.resolve(cwd, outPath),
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
