#!/usr/bin/env node
import path from "node:path"

import { ensureDir, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"
import { materializeTechniqueEpisodeSlicePack } from "../src/lib/technique_episode_slice_pack_builder.mjs"

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
  if (!args["episodes-path"] || !args["slice-contracts-path"] || !args["out-dir"]) {
    throw new Error("Usage: node tools/build_technique_episode_slice_pack.mjs --episodes-path=<episode_windows.jsonl> --slice-contracts-path=<slice_contracts.jsonl> --out-dir=<dir> [--top-n=N]")
  }
  const cwd = process.cwd()
  const topN = Math.max(Math.floor(Number(args["top-n"] ?? 1)), 1)
  const episodeRows = await readJsonl(path.resolve(cwd, String(args["episodes-path"])), { strict: true })
  const sliceContracts = await readJsonl(path.resolve(cwd, String(args["slice-contracts-path"])), { strict: true })
  const outDir = path.resolve(cwd, String(args["out-dir"]))
  await ensureDir(outDir)
  const summaries = []
  for (const sliceContract of sliceContracts.slice(0, topN)) {
    const pack = materializeTechniqueEpisodeSlicePack({ episodeRows, sliceContract })
    const sliceDir = path.join(outDir, String(sliceContract.sliceSlug ?? "slice"))
    await ensureDir(sliceDir)
    await writeJsonl(path.join(sliceDir, "episode_windows.jsonl"), pack.episodeRows)
    await writeJson(path.join(sliceDir, "slice_pack_summary.json"), {
      kind: pack.kind,
      sliceContractId: pack.sliceContractId,
      sliceSlug: pack.sliceSlug,
      contractAtomIds: pack.contractAtomIds,
      ...pack.summary,
    })
    summaries.push({
      sliceContractId: pack.sliceContractId,
      sliceSlug: pack.sliceSlug,
      contractAtomIds: pack.contractAtomIds,
      ...pack.summary,
    })
  }
  await writeJson(path.join(outDir, "slice_pack_index.json"), {
    kind: "technique_episode_slice_pack_index_v1",
    sliceCount: summaries.length,
    slices: summaries,
  })
}

await main()
