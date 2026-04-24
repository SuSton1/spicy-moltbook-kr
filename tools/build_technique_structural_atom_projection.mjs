#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJson, writeJsonl } from "../src/lib/io.mjs"
import { projectTechniqueConsensusRuleToStructuralAtoms } from "../src/lib/technique_structural_atom_consensus.mjs"
import { toText } from "../src/lib/technique_common.mjs"

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const yearConsensusSummaryPath = toText(getFlag(flags, "year-consensus-summary-path", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  const passedOnly = getFlag(flags, "passed-only", false) === true
  if (!yearConsensusSummaryPath || !outPath) {
    throw new Error("build_technique_structural_atom_projection requires --year-consensus-summary-path and --out")
  }
  return {
    yearConsensusSummaryPath: path.resolve(cwd, yearConsensusSummaryPath),
    outPath: path.resolve(cwd, outPath),
    passedOnly,
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const yearConsensusSummary = await readJson(args.yearConsensusSummaryPath, null)
  if (!yearConsensusSummary || typeof yearConsensusSummary !== "object") {
    throw new Error(`Missing year-consensus summary: ${args.yearConsensusSummaryPath}`)
  }
  const projectionRows = []
  for (const templateEntry of Array.isArray(yearConsensusSummary.templates) ? yearConsensusSummary.templates : []) {
    const templateSummaryPath = path.resolve(toText(templateEntry?.templateSummaryPath))
    const templateSummary = await readJson(templateSummaryPath, null)
    if (!templateSummary || typeof templateSummary !== "object") {
      throw new Error(`Missing year-consensus template summary: ${templateSummaryPath}`)
    }
    for (const rule of Array.isArray(templateSummary.consensusRules) ? templateSummary.consensusRules : []) {
      if (args.passedOnly && rule?.passConsensus !== true) continue
      projectionRows.push(
        projectTechniqueConsensusRuleToStructuralAtoms({
          template: templateSummary,
          rule,
        }),
      )
    }
  }
  if (projectionRows.length < 1) {
    throw new Error("Structural-atom projection resolved zero rule rows")
  }
  await writeJsonl(args.outPath, projectionRows)
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        projectionRowCount: projectionRows.length,
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
