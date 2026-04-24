#!/usr/bin/env node
import path from "node:path"

import { readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"
import {
  DEFAULT_TECHNIQUE_EPISODE_SLICE_CONTRACT_PATH,
  loadTechniqueEpisodeSliceContract,
} from "../src/lib/technique_episode_slice_contract.mjs"
import { buildTechniqueEpisodeDeltaAtoms } from "../src/lib/technique_episode_delta_atom_builder.mjs"

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
  if (!args["episodes-path"] || !args["control-pairs-path"] || !args.out || !args["summary-out"]) {
    throw new Error("Usage: node tools/build_technique_episode_delta_atoms.mjs --episodes-path=<episode_windows.jsonl> --control-pairs-path=<pairs.jsonl> --out=<delta_atoms.jsonl> --summary-out=<summary.json> [--contract-path=PATH]")
  }
  const cwd = process.cwd()
  const contract = await loadTechniqueEpisodeSliceContract({
    cwd,
    contractPath: args["contract-path"] || DEFAULT_TECHNIQUE_EPISODE_SLICE_CONTRACT_PATH,
  })
  const episodeRows = await readJsonl(path.resolve(cwd, String(args["episodes-path"])), { strict: true })
  const controlPairRows = await readJsonl(path.resolve(cwd, String(args["control-pairs-path"])), { strict: true })
  const dataset = buildTechniqueEpisodeDeltaAtoms({ episodeRows, controlPairRows, contract })
  await writeJsonl(path.resolve(cwd, String(args.out)), dataset.deltaRows)
  await writeJson(path.resolve(cwd, String(args["summary-out"])), {
    kind: dataset.kind,
    contractId: dataset.contractId,
    ...dataset.summary,
  })
}

await main()
