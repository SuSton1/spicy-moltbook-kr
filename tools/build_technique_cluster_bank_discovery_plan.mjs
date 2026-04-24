#!/usr/bin/env node

import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJson, writeJson } from "../src/lib/io.mjs"
import {
  DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH,
  loadTechniqueGrammarContract,
} from "../src/lib/technique_grammar_contract.mjs"
import { buildTechniqueClusterBankDiscoveryPlan } from "../src/lib/technique_cluster_bank_discovery_plan.mjs"
import { toText, uniqueSortedStrings } from "../src/lib/technique_common.mjs"

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(getFlag(flags, "contract-path", DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH))
  const shortlistPath = toText(getFlag(flags, "shortlist-path", ""))
  const clusterIds = uniqueSortedStrings(String(getFlag(flags, "cluster-ids", "")).split(","))
  const reserveBankIds = uniqueSortedStrings(String(getFlag(flags, "reserve-bank-ids", "")).split(","))
  const maxClusterBanksRaw = Number(getFlag(flags, "max-cluster-banks", ""))
  const maxReserveBanksRaw = Number(getFlag(flags, "max-reserve-banks", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!shortlistPath || !outPath) {
    throw new Error("build_technique_cluster_bank_discovery_plan requires --shortlist-path and --out")
  }
  return {
    cwd,
    contractPath,
    shortlistPath: path.resolve(cwd, shortlistPath),
    clusterIds,
    reserveBankIds,
    maxClusterBanks: Number.isInteger(maxClusterBanksRaw) && maxClusterBanksRaw > 0 ? maxClusterBanksRaw : null,
    maxReserveBanks: Number.isInteger(maxReserveBanksRaw) && maxReserveBanksRaw > 0 ? maxReserveBanksRaw : null,
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const techniqueContract = await loadTechniqueGrammarContract({
    contractPath: args.contractPath,
    cwd,
  })
  const shortlistArtifact = await readJson(args.shortlistPath, null)
  if (!shortlistArtifact || typeof shortlistArtifact !== "object") {
    throw new Error(`Missing cluster shortlist artifact: ${args.shortlistPath}`)
  }
  const payload = buildTechniqueClusterBankDiscoveryPlan({
    techniqueContract,
    shortlistArtifact,
    selectedClusterIds: args.clusterIds,
    selectedReserveBankIds: args.reserveBankIds,
    maxClusterBanks: args.maxClusterBanks,
    maxReserveBanks: args.maxReserveBanks,
  })
  await writeJson(args.outPath, payload)
  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        selectedClusterLaneCount: payload.selectedClusterLaneCount,
        selectedReserveBankCount: payload.selectedReserveBankCount,
        selectedBankCount: payload.selectedBankCount,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
