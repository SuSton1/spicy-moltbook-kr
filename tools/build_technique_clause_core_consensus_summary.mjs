#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJson, writeJson } from "../src/lib/io.mjs"
import { buildTechniqueClauseCoreConsensusSummary } from "../src/lib/technique_clause_core_consensus.mjs"
import { toText, uniqueSortedStrings } from "../src/lib/technique_common.mjs"

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const templateScreenSummaryPath = toText(getFlag(flags, "template-screen-summary-path", ""))
  const templateIds = uniqueSortedStrings(String(getFlag(flags, "template-ids", "")).split(","))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!templateScreenSummaryPath || !outPath) {
    throw new Error("build_technique_clause_core_consensus_summary requires --template-screen-summary-path and --out")
  }
  return {
    templateScreenSummaryPath: path.resolve(cwd, templateScreenSummaryPath),
    templateIds,
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const templateScreenSummary = await readJson(args.templateScreenSummaryPath, null)
  if (!templateScreenSummary || typeof templateScreenSummary !== "object") {
    throw new Error(`Missing template screen summary: ${args.templateScreenSummaryPath}`)
  }
  const summary = buildTechniqueClauseCoreConsensusSummary({
    templateScreenSummary,
    selectedTemplateIds: args.templateIds,
  })
  await writeJson(args.outPath, {
    ...summary,
    templateScreenSummaryPath: args.templateScreenSummaryPath,
  })
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        cohortCount: summary.cohortCount,
        rerunHypothesisCount: summary.rerunHypothesisCount,
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
