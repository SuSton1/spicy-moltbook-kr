#!/usr/bin/env node
import path from "node:path"

import { iterateJsonl, createJsonlWriter, writeJson } from "../src/lib/io.mjs"
import {
  loadTechniqueEpisodeSubstrateContract,
  DEFAULT_TECHNIQUE_EPISODE_SUBSTRATE_CONTRACT_PATH,
} from "../src/lib/technique_episode_substrate_contract.mjs"
import { loadTechniquePatternDiscoveryContract } from "../src/lib/technique_pattern_discovery_contract.mjs"
import { buildTechniqueEpisodeWindows } from "../src/lib/technique_episode_window_builder.mjs"

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
  if (!args["rows-path"] || !args.out) {
    throw new Error(
      "Usage: node tools/build_technique_episode_windows.mjs --rows-path=<rows.jsonl> --out=<episode_windows.jsonl> [--summary-out=<summary.json>] [--contract-path=PATH] [--default-scope-id=SCOPE] [--default-lookback-candidate-id=ID]",
    )
  }

  const cwd = process.cwd()
  const episodeContract = await loadTechniqueEpisodeSubstrateContract({
    cwd,
    contractPath: args["contract-path"] || DEFAULT_TECHNIQUE_EPISODE_SUBSTRATE_CONTRACT_PATH,
  })
  const structuralContract = await loadTechniquePatternDiscoveryContract({
    cwd,
    contractPath: episodeContract.structuralContractPath,
  })

  const rows = []
  await iterateJsonl(path.resolve(cwd, String(args["rows-path"])), {
    strict: true,
    onRow: async (row) => {
      rows.push(row)
    },
  })

  const dataset = buildTechniqueEpisodeWindows({
    rows,
    episodeContract,
    structuralContract,
    defaultScopeId: args["default-scope-id"] || null,
    defaultLookbackCandidateId: args["default-lookback-candidate-id"] || null,
  })

  const outPath = path.resolve(cwd, String(args.out))
  const writer = await createJsonlWriter(outPath)
  try {
    for (const row of dataset.episodeRows) {
      await writer.writeRow(row)
    }
  } finally {
    await writer.close()
  }

  if (args["summary-out"]) {
    await writeJson(path.resolve(cwd, String(args["summary-out"])), {
      kind: "technique_episode_window_build_summary_v1",
      contractId: episodeContract.contractId,
      labelId: episodeContract.labelId,
      ...dataset.summary,
    })
  }
}

await main()
