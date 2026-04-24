#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJson, writeJson } from "../src/lib/io.mjs"
import { buildTechniqueClauseCoreRerunPlan } from "../src/lib/technique_clause_core_consensus.mjs"
import { toText, uniqueSortedStrings } from "../src/lib/technique_common.mjs"

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const summaryPath = toText(getFlag(flags, "summary-path", ""))
  const cohortIds = uniqueSortedStrings(String(getFlag(flags, "cohort-ids", "")).split(","))
  const maxHypothesesRaw = Number(getFlag(flags, "max-hypotheses", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!summaryPath || !outPath) {
    throw new Error("build_technique_clause_core_rerun_plan requires --summary-path and --out")
  }
  return {
    summaryPath: path.resolve(cwd, summaryPath),
    cohortIds,
    maxHypotheses: Number.isInteger(maxHypothesesRaw) && maxHypothesesRaw > 0 ? maxHypothesesRaw : null,
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const consensusSummary = await readJson(args.summaryPath, null)
  if (!consensusSummary || typeof consensusSummary !== "object") {
    throw new Error(`Missing clause-core consensus summary: ${args.summaryPath}`)
  }
  const plan = buildTechniqueClauseCoreRerunPlan({
    consensusSummary,
    selectedCohortIds: args.cohortIds,
    maxHypotheses: args.maxHypotheses,
  })
  await writeJson(args.outPath, {
    ...plan,
    summaryPath: args.summaryPath,
  })
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        hypothesisCount: plan.hypothesisCount,
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
