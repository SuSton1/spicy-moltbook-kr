#!/usr/bin/env node
import path from "node:path"

import { createJsonlWriter, ensureDir, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"
import {
  DEFAULT_TECHNIQUE_EPISODE_SUBSTRATE_CONTRACT_PATH,
  loadTechniqueEpisodeSubstrateContract,
} from "../src/lib/technique_episode_substrate_contract.mjs"
import { materializeTechniqueEpisodeSlicePack } from "../src/lib/technique_episode_slice_pack_builder.mjs"
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
  if (!args["episodes-path"] || !args["slice-contracts-path"] || !args["out-dir"] || !args["summary-out"]) {
    throw new Error("Usage: node tools/build_technique_episode_slice_recheck_report.mjs --episodes-path=<episode_windows.jsonl> --slice-contracts-path=<slice_contracts.jsonl> --out-dir=<dir> --summary-out=<summary.json> [--substrate-contract-path=PATH] [--top-n=N]")
  }
  const cwd = process.cwd()
  const topN = Math.max(Math.floor(Number(args["top-n"] ?? 1)), 1)
  const episodeRows = await readJsonl(path.resolve(cwd, String(args["episodes-path"])), { strict: true })
  const sliceContracts = await readJsonl(path.resolve(cwd, String(args["slice-contracts-path"])), { strict: true })
  const substrateContract = await loadTechniqueEpisodeSubstrateContract({
    cwd,
    contractPath: args["substrate-contract-path"] || DEFAULT_TECHNIQUE_EPISODE_SUBSTRATE_CONTRACT_PATH,
  })
  const outDir = path.resolve(cwd, String(args["out-dir"]))
  await ensureDir(outDir)
  const summaries = []
  for (const sliceContract of sliceContracts.slice(0, topN)) {
    const pack = materializeTechniqueEpisodeSlicePack({ episodeRows, sliceContract })
    const report = searchTechniqueEpisodeSubstrates({ episodeRows: pack.episodeRows, contract: substrateContract })
    const sliceDir = path.join(outDir, String(sliceContract.sliceSlug ?? "slice"))
    await ensureDir(sliceDir)
    await writeJsonl(path.join(sliceDir, "episode_windows.jsonl"), pack.episodeRows)
    const writer = await createJsonlWriter(path.join(sliceDir, "verified_patterns.jsonl"))
    try {
      for (const row of report.verifiedPatterns) {
        await writer.writeRow(row)
      }
    } finally {
      await writer.close()
    }
    await writeJson(path.join(sliceDir, "slice_pack_summary.json"), {
      kind: pack.kind,
      sliceContractId: pack.sliceContractId,
      sliceSlug: pack.sliceSlug,
      contractAtomIds: pack.contractAtomIds,
      ...pack.summary,
    })
    await writeJson(path.join(sliceDir, "episode_substrate_summary.json"), {
      kind: report.kind,
      contractId: report.contractId,
      labelId: report.labelId,
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
    summaries.push({
      sliceContractId: sliceContract.sliceContractId,
      sliceSlug: sliceContract.sliceSlug,
      contractAtomIds: sliceContract.contractAtomIds,
      sliceEpisodeCount: pack.summary.episodeCount,
      slicePositiveEpisodeCount: pack.summary.positiveEpisodeCount,
      sliceNegativeEpisodeCount: pack.summary.negativeEpisodeCount,
      verifiedPatternCount: report.verifiedPatternCount,
      verifiedFullZeroNegativePatternCount: report.verifiedFullZeroNegativePatternCount,
      coreCandidateCount: report.coreCandidateCount,
      supervisedCoreCandidateCount: report.supervisedCoreCandidateCount,
    })
  }
  summaries.sort((left, right) =>
    right.verifiedFullZeroNegativePatternCount - left.verifiedFullZeroNegativePatternCount ||
    right.verifiedPatternCount - left.verifiedPatternCount ||
    left.sliceNegativeEpisodeCount - right.sliceNegativeEpisodeCount ||
    right.slicePositiveEpisodeCount - left.slicePositiveEpisodeCount ||
    left.sliceContractId.localeCompare(right.sliceContractId))
  await writeJson(path.resolve(cwd, String(args["summary-out"])), {
    kind: "technique_episode_slice_recheck_summary_v1",
    recheckedSliceCount: summaries.length,
    bestSlice: summaries[0] ?? null,
    slices: summaries,
  })
}

await main()
