#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJson, readJsonl, writeJson } from "../src/lib/io.mjs"
import {
  DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH,
  loadTechniqueGrammarContract,
} from "../src/lib/technique_grammar_contract.mjs"
import { buildTechniqueStructuralAtomConsensusSummary } from "../src/lib/technique_structural_atom_consensus.mjs"
import { toText } from "../src/lib/technique_common.mjs"

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH))
  const projectionPath = toText(getFlag(flags, "projection-path", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!projectionPath || !outPath) {
    throw new Error("build_technique_structural_atom_consensus_summary requires --projection-path and --out")
  }
  return {
    contractPath,
    projectionPath: path.resolve(cwd, projectionPath),
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const [techniqueContract, projections] = await Promise.all([
    loadTechniqueGrammarContract({
      contractPath: args.contractPath,
      cwd,
    }),
    readJsonl(args.projectionPath, { strict: true }),
  ])
  const summary = buildTechniqueStructuralAtomConsensusSummary({
    projections,
    yearConsensusConfig: techniqueContract.yearConsensus,
  })
  await writeJson(args.outPath, {
    ...summary,
    projectionPath: args.projectionPath,
    contractId: toText(techniqueContract.contractId),
  })
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        motifCount: summary.motifCount,
        passMotifCount: summary.passMotifCount,
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
