#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Train100PartitionedCompletionPlan } from "../src/lib/tp12_train100_partitioned_completion.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  if (!contractPath) throw new Error("build_tp12_train100_partitioned_completion_plan requires --contract")
  const summary = await buildTp12Train100PartitionedCompletionPlan({
    contractPath: path.resolve(cwd, contractPath),
    frontierPath: toText(getFlag(flags, "frontier", "")),
    boundsSummaryPath: toText(getFlag(flags, "bounds-summary", "")),
    outPlanPath: toText(getFlag(flags, "out-plan", getFlag(flags, "out", ""))),
    outShardDir: toText(getFlag(flags, "out-shard-dir", "")),
    cwd,
  })
  console.log(
    JSON.stringify(
      {
        patchKey: summary.patchKey,
        status: summary.status,
        partitionCount: summary.partitionCount,
        shardCount: summary.shardCount,
        plannedFrontierSize: summary.plannedFrontierSize,
        unresolvedFrontierCount: summary.unresolvedFrontierCount,
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

