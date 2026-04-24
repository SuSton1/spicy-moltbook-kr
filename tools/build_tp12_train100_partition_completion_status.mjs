#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Train100PartitionCompletionStatus } from "../src/lib/tp12_train100_partitioned_completion.mjs"
import { toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = toText(getFlag(flags, "contract", getFlag(flags, "contract-path", "")))
  if (!contractPath) throw new Error("build_tp12_train100_partition_completion_status requires --contract")
  const summary = await buildTp12Train100PartitionCompletionStatus({
    contractPath: path.resolve(cwd, contractPath),
    partitionReportPath: toText(getFlag(flags, "partition-report", "")),
    partitionPlanPath: toText(getFlag(flags, "partition-plan", "")),
    outSummaryPath: toText(getFlag(flags, "out-summary", getFlag(flags, "out", ""))),
    cwd,
  })
  console.log(
    JSON.stringify(
      {
        patchKey: summary.patchKey,
        status: summary.status,
        searchComplete: summary.searchComplete,
        acceptedCandidateCount: summary.acceptedCandidateCount,
        remainingFrontierSize: summary.remainingFrontierSize,
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

