#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  loadTechniqueClusterBankDiscoveryPlan,
  writeTechniqueClusterBankDiscoveryRollingContract,
} from "../src/lib/technique_cluster_bank_discovery_contract.mjs"
import {
  DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH,
  loadTechniqueGrammarContract,
} from "../src/lib/technique_grammar_contract.mjs"

const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH))
  const planPath = toText(getFlag(flags, "plan-path", ""))
  const clusterBankId = toText(getFlag(flags, "cluster-bank-id", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!planPath || !clusterBankId || !outPath) {
    throw new Error(
      "build_technique_cluster_bank_discovery_candidate_contract requires --plan-path, --cluster-bank-id, and --out",
    )
  }
  return {
    cwd,
    contractPath,
    planPath,
    clusterBankId,
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const techniqueContract = await loadTechniqueGrammarContract({
    contractPath: args.contractPath,
    cwd,
  })
  const planArtifact = await loadTechniqueClusterBankDiscoveryPlan({
    planPath: args.planPath,
    cwd,
  })
  const result = await writeTechniqueClusterBankDiscoveryRollingContract({
    techniqueContract,
    planArtifact,
    clusterBankId: args.clusterBankId,
    outPath: args.outPath,
  })
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        clusterBankId: args.clusterBankId,
        bankId: result.contract.techniqueClusterBankDiscovery?.bankId ?? null,
        scopeId: result.contract.scopeId,
        lookbackCandidateId: result.contract.techniqueClusterBankDiscovery?.lookbackCandidateId ?? null,
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
