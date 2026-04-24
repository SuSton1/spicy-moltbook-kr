#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"
import { toNumber, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const splitPaths = (value) =>
  toText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

const sum = (rows, getter) => rows.reduce((total, row) => total + toNumber(getter(row), 0), 0)

const requireSame = (rows, getter, label) => {
  const values = [...new Set(rows.map(getter).map((value) => JSON.stringify(value ?? null)))]
  if (values.length !== 1) throw new Error(`partition manifests disagree on ${label}: ${values.join(" | ")}`)
  return JSON.parse(values[0])
}

const wilsonLower95 = (hits, total) => {
  if (total <= 0) return 0
  const z = 1.959963984540054
  const p = hits / total
  const denom = 1 + (z * z) / total
  const centre = p + (z * z) / (2 * total)
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))
  return Math.max(0, (centre - margin) / denom)
}

export const buildTp12Train100CounterexamplePartitionReport = async ({
  manifestPaths = [],
  outJsonPath = "",
  outMdPath = "",
} = {}) => {
  if (!manifestPaths.length) throw new Error("at least one --manifests path is required")
  const rows = []
  for (const manifestPath of manifestPaths) {
    const manifest = await readJson(manifestPath, null)
    if (!manifest) throw new Error(`partition manifest not found: ${manifestPath}`)
    if (manifest.kind !== "tp12_train100_counterexample_exact_completion_manifest_v1") {
      throw new Error(`invalid partition manifest kind at ${manifestPath}: ${manifest.kind ?? "missing"}`)
    }
    const partition = manifest?.options?.frontierPartition ?? {}
    if (!partition.enabled) throw new Error(`manifest is not a frontier partition shard: ${manifestPath}`)
    rows.push({ manifestPath: path.resolve(manifestPath), manifest, partition })
  }

  const partitionCount = requireSame(rows, (row) => row.partition.count, "frontierPartition.count")
  const partitionMethod = requireSame(rows, (row) => row.partition.method, "frontierPartition.method")
  const sourceCheckpointPath = requireSame(rows, (row) => row.partition.sourceCheckpointPath, "sourceCheckpointPath")
  const sourceFrontierSize = requireSame(rows, (row) => row.partition.sourceFrontierSize, "sourceFrontierSize")
  const sourceVisitedStateCount = requireSame(
    rows,
    (row) => row.manifest.resumeSourceCounters?.visitedStateCount ?? 0,
    "resumeSourceCounters.visitedStateCount",
  )

  const indices = rows.map((row) => Number(row.partition.index)).sort((left, right) => left - right)
  const expectedIndices = Array.from({ length: partitionCount }, (_, index) => index)
  const duplicateIndices = indices.filter((index, position) => position > 0 && indices[position - 1] === index)
  const missingIndices = expectedIndices.filter((index) => !indices.includes(index))
  const unexpectedIndices = indices.filter((index) => index < 0 || index >= partitionCount)
  const selectedFrontierSize = sum(rows, (row) => row.partition.selectedFrontierSize)
  const remainingFrontierSize = sum(rows, (row) => row.manifest.remainingFrontierSize)
  const acceptedCandidateCount = sum(rows, (row) => row.manifest.newAcceptedCandidateCount ?? row.manifest.acceptedCandidateCount)
  const emittedCandidateCount = sum(rows, (row) => row.manifest.newEmittedCandidateCount ?? row.manifest.emittedCandidateCount)
  const newVisitedStateCount = sum(rows, (row) => row.manifest.newVisitedStateCount)
  const newEvaluatedCandidateCount = sum(rows, (row) => row.manifest.newEvaluatedCandidateCount)
  const newBranchRowCount = sum(rows, (row) => row.manifest.newBranchRowCount)
  const newCounterexampleRowsScanned = sum(rows, (row) => row.manifest.newCounterexampleRowsScanned)
  const completedShardCount = rows.filter((row) => row.manifest.searchComplete && row.manifest.remainingFrontierSize === 0).length
  const coverageComplete =
    duplicateIndices.length === 0 &&
    missingIndices.length === 0 &&
    unexpectedIndices.length === 0 &&
    selectedFrontierSize === sourceFrontierSize
  const allShardsComplete = completedShardCount === rows.length
  const searchComplete = coverageComplete && allShardsComplete && remainingFrontierSize === 0
  const status = searchComplete ? "passed" : "incomplete"
  const summary = {
    kind: "tp12_train100_counterexample_partition_report_v1",
    generatedAt: new Date().toISOString(),
    status,
    searchComplete,
    oosRead: false,
    partitionMethod,
    partitionCount,
    shardCount: rows.length,
    completedShardCount,
    coverageComplete,
    sourceCheckpointPath,
    sourceVisitedStateCount,
    sourceFrontierSize,
    selectedFrontierSize,
    remainingFrontierSize,
    acceptedCandidateCount,
    emittedCandidateCount,
    newVisitedStateCount,
    globalVisitedStateCount: sourceVisitedStateCount + newVisitedStateCount,
    newEvaluatedCandidateCount,
    newBranchRowCount,
    newCounterexampleRowsScanned,
    hitRate: acceptedCandidateCount > 0 ? 1 : 0,
    wilsonLower95: wilsonLower95(acceptedCandidateCount, Math.max(acceptedCandidateCount, emittedCandidateCount)),
    duplicateIndices,
    missingIndices,
    unexpectedIndices,
    shards: rows
      .sort((left, right) => Number(left.partition.index) - Number(right.partition.index))
      .map((row) => ({
        index: row.partition.index,
        manifestPath: row.manifestPath,
        status: row.manifest.status,
        searchComplete: row.manifest.searchComplete,
        completionReason: row.manifest.completionReason,
        selectedFrontierSize: row.partition.selectedFrontierSize,
        remainingFrontierSize: row.manifest.remainingFrontierSize,
        newVisitedStateCount: row.manifest.newVisitedStateCount,
        newAcceptedCandidateCount: row.manifest.newAcceptedCandidateCount,
      })),
  }

  if (toText(outJsonPath)) {
    await ensureDir(path.dirname(outJsonPath))
    await writeJson(outJsonPath, summary)
  }
  if (toText(outMdPath)) {
    await ensureDir(path.dirname(outMdPath))
    const lines = [
      "# TP12 Train100 Counterexample Frontier Partition Report",
      "",
      `- status: \`${summary.status}\``,
      `- searchComplete: \`${summary.searchComplete}\``,
      `- partitionMethod: \`${summary.partitionMethod}\``,
      `- partitionCount: \`${summary.partitionCount}\``,
      `- shardCount: \`${summary.shardCount}\``,
      `- completedShardCount: \`${summary.completedShardCount}\``,
      `- sourceFrontierSize: \`${summary.sourceFrontierSize}\``,
      `- selectedFrontierSize: \`${summary.selectedFrontierSize}\``,
      `- remainingFrontierSize: \`${summary.remainingFrontierSize}\``,
      `- acceptedCandidateCount: \`${summary.acceptedCandidateCount}\``,
      `- newVisitedStateCount: \`${summary.newVisitedStateCount}\``,
      `- globalVisitedStateCount: \`${summary.globalVisitedStateCount}\``,
      `- coverageComplete: \`${summary.coverageComplete}\``,
      "",
      "## Shards",
      "",
      "| index | complete | selectedFrontier | remainingFrontier | newVisited | accepted | reason |",
      "|---:|:---:|---:|---:|---:|---:|---|",
      ...summary.shards.map(
        (shard) =>
          `| ${shard.index} | ${shard.searchComplete ? "yes" : "no"} | ${shard.selectedFrontierSize} | ${shard.remainingFrontierSize} | ${shard.newVisitedStateCount} | ${shard.newAcceptedCandidateCount} | ${shard.completionReason} |`,
      ),
      "",
    ]
    await fs.promises.writeFile(outMdPath, `${lines.join("\n")}\n`, "utf8")
  }
  return summary
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const manifestPaths = splitPaths(getFlag(flags, "manifests", "")).map((filePath) => path.resolve(cwd, filePath))
  const outJsonPath = toText(getFlag(flags, "out-json", getFlag(flags, "out", "")))
  const outMdPath = toText(getFlag(flags, "out-md", ""))
  const summary = await buildTp12Train100CounterexamplePartitionReport({
    manifestPaths,
    outJsonPath: outJsonPath ? path.resolve(cwd, outJsonPath) : "",
    outMdPath: outMdPath ? path.resolve(cwd, outMdPath) : "",
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        searchComplete: summary.searchComplete,
        partitionCount: summary.partitionCount,
        completedShardCount: summary.completedShardCount,
        acceptedCandidateCount: summary.acceptedCandidateCount,
        remainingFrontierSize: summary.remainingFrontierSize,
        newVisitedStateCount: summary.newVisitedStateCount,
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
