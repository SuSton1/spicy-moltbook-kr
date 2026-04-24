#!/usr/bin/env node
import path from "node:path"

import { readJsonl, createJsonlWriter, writeJson } from "../src/lib/io.mjs"
import {
  loadTechniqueEpisodeSubstrateContract,
  DEFAULT_TECHNIQUE_EPISODE_SUBSTRATE_CONTRACT_PATH,
} from "../src/lib/technique_episode_substrate_contract.mjs"
import { searchTechniqueEpisodeSubstrates } from "../src/lib/technique_episode_substrate_search.mjs"

const parseArgs = (argv) => {
  const parsed = {}
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) continue
    const eq = arg.indexOf("=")
    if (eq === -1) {
      parsed[arg.slice(2)] = true
      continue
    }
    parsed[arg.slice(2, eq)] = arg.slice(eq + 1)
  }
  return parsed
}

const main = async () => {
  const args = parseArgs(process.argv)
  if (!args["episodes-path"] || !args.out || !args["summary-out"]) {
    throw new Error(
      "Usage: node tools/build_technique_episode_substrate_report.mjs --episodes-path=<episode_windows.jsonl> --out=<verified_patterns.jsonl> --summary-out=<summary.json> [--contract-path=PATH]",
    )
  }

  const cwd = process.cwd()
  const contract = await loadTechniqueEpisodeSubstrateContract({
    cwd,
    contractPath: args["contract-path"] || DEFAULT_TECHNIQUE_EPISODE_SUBSTRATE_CONTRACT_PATH,
  })
  const episodeRows = await readJsonl(path.resolve(cwd, String(args["episodes-path"])), { strict: true })
  const report = searchTechniqueEpisodeSubstrates({ episodeRows, contract })

  const writer = await createJsonlWriter(path.resolve(cwd, String(args.out)))
  try {
    for (const row of report.verifiedPatterns) {
      await writer.writeRow(row)
    }
  } finally {
    await writer.close()
  }

  await writeJson(path.resolve(cwd, String(args["summary-out"])), {
    kind: report.kind,
    contractId: report.contractId,
    labelId: report.labelId,
    coreYears: report.coreYears,
    searchMode: report.searchMode,
    partitionField: report.partitionField,
    negativeSupervisionMode: report.negativeSupervisionMode,
    episodeCount: report.episodeCount,
    partitionCount: report.partitionCount,
    eligiblePartitionCount: report.eligiblePartitionCount,
    searchedPartitionCount: report.searchedPartitionCount,
    coreCandidateCount: report.coreCandidateCount,
    supervisedCoreCandidateCount: report.supervisedCoreCandidateCount,
    verifiedPatternCount: report.verifiedPatternCount,
    verifiedFullZeroNegativePatternCount: report.verifiedFullZeroNegativePatternCount,
    partitionSummaries: report.partitionSummaries,
  })
}

await main()
