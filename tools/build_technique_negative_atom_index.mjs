#!/usr/bin/env node
import path from "node:path"

import { iterateJsonl, writeJson } from "../src/lib/io.mjs"
import {
  appendTechniqueNegativeTransactionToIndexState,
  createTechniqueNegativeAtomIndexState,
  finalizeTechniqueNegativeAtomIndexState,
} from "../src/lib/technique_negative_atom_index.mjs"
import {
  DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH,
  loadTechniquePatternDiscoveryContract,
} from "../src/lib/technique_pattern_discovery_contract.mjs"

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
  if (!args["transactions-path"] || !args.out || !args["manifest-out"]) {
    throw new Error(
      "Usage: node tools/build_technique_negative_atom_index.mjs --transactions-path=<transactions.jsonl> --out=<index.json> --manifest-out=<manifest.json> [--summary-out=<summary.json>] [--contract-path=PATH]",
    )
  }
  const cwd = process.cwd()
  const contract = await loadTechniquePatternDiscoveryContract({
    cwd,
    contractPath: args["contract-path"] || DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH,
  })
  const state = createTechniqueNegativeAtomIndexState()
  let inputTransactionCount = 0
  let indexedNegativeCount = 0
  await iterateJsonl(path.resolve(cwd, String(args["transactions-path"])), {
    strict: true,
    onRow: async (transaction) => {
      inputTransactionCount += 1
      if (appendTechniqueNegativeTransactionToIndexState(state, transaction)) {
        indexedNegativeCount += 1
      }
    },
  })
  const { indexArtifact, negativeRowManifest } = finalizeTechniqueNegativeAtomIndexState(state, {
    contractId: contract.contractId,
    labelId: contract.labelId,
  })
  await writeJson(path.resolve(cwd, String(args.out)), indexArtifact)
  await writeJson(path.resolve(cwd, String(args["manifest-out"])), {
    kind: "technique_negative_row_manifest_v1",
    contractId: contract.contractId,
    labelId: contract.labelId,
    rowCount: negativeRowManifest.length,
    rows: negativeRowManifest,
  })
  if (args["summary-out"]) {
    const partitionNegativeCounts = Object.fromEntries(
      Object.entries(indexArtifact.partitions ?? {}).map(([partitionKey, partition]) => [partitionKey, partition.negativeTransactionCount]),
    )
    await writeJson(path.resolve(cwd, String(args["summary-out"])), {
      kind: "technique_negative_atom_index_build_summary_v1",
      contractId: contract.contractId,
      labelId: contract.labelId,
      inputTransactionCount,
      indexedNegativeCount,
      partitionCount: indexArtifact.partitionCount,
      partitionKeys: indexArtifact.partitionKeys,
      partitionNegativeCounts,
    })
  }
}

await main()
