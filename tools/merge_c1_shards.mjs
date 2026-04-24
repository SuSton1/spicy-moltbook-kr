import path from "node:path"
import fsp from "node:fs/promises"

import { parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, pathExists, readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"

const sortFamilyIds = (values) =>
  (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .sort((left, right) => {
      const leftNum = Number.parseInt(left.replace(/^F/i, ""), 10)
      const rightNum = Number.parseInt(right.replace(/^F/i, ""), 10)
      if (Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum !== rightNum) {
        return leftNum - rightNum
      }
      return left.localeCompare(right)
    })

const clonePlain = (value) => JSON.parse(JSON.stringify(value ?? {}))

const resolveRunDir = (cwd, runId) => path.join(cwd, "artifacts", "runs", String(runId ?? "").trim())

const copyDirIfPresent = async ({ fromDir, toDir }) => {
  if (!fromDir || !pathExists(fromDir)) return false
  await ensureDir(path.dirname(toDir))
  await fsp.rm(toDir, { recursive: true, force: true }).catch(() => {})
  await fsp.cp(fromDir, toDir, { recursive: true })
  return true
}

const loadShard = async ({ cwd, runId }) => {
  const runDir = resolveRunDir(cwd, runId)
  const stepC1Dir = path.join(runDir, "step-c1")
  const indexPath = path.join(stepC1Dir, "c1_family_probe_index.json")
  const resultsPath = path.join(stepC1Dir, "c1_family_probe_results.jsonl")
  const footprintsPath = path.join(stepC1Dir, "c1_family_overlap_footprints.jsonl")
  const summaryPath = path.join(stepC1Dir, "c1_summary.json")
  if (!pathExists(indexPath) || !pathExists(resultsPath) || !pathExists(footprintsPath)) {
    throw new Error(`C1 shard artifacts missing: ${runDir}`)
  }
  return {
    runId,
    runDir,
    stepC1Dir,
    index: await readJson(indexPath, null),
    results: await readJsonl(resultsPath),
    footprints: await readJsonl(footprintsPath),
    summary: await readJson(summaryPath, null)
  }
}

const ensureConsistent = ({ shards, sourceRunIdOverride }) => {
  const sourceRunIds = new Set()
  const sourceRunDirs = new Set()
  const probeScopes = new Set()
  const probeProfiles = new Set()
  for (const shard of shards) {
    const index = shard?.index ?? {}
    const sourceRunId = String(
      sourceRunIdOverride ?? index?.sourceRunId ?? index?.sourceRunDir ?? "",
    ).trim()
    const sourceRunDir = String(index?.sourceRunDir ?? "").trim()
    const probeScope = String(index?.probeScope ?? "").trim()
    const probeProfile = String(index?.probeProfile ?? "").trim()
    if (sourceRunId) sourceRunIds.add(sourceRunId)
    if (sourceRunDir) sourceRunDirs.add(sourceRunDir)
    if (probeScope) probeScopes.add(probeScope)
    if (probeProfile) probeProfiles.add(probeProfile)
  }
  if (sourceRunIds.size > 1) {
    throw new Error(`Inconsistent shard sourceRunId: ${Array.from(sourceRunIds).join(",")}`)
  }
  if (sourceRunDirs.size > 1) {
    throw new Error(`Inconsistent shard sourceRunDir: ${Array.from(sourceRunDirs).join(",")}`)
  }
  if (probeScopes.size > 1) {
    throw new Error(`Inconsistent shard probeScope: ${Array.from(probeScopes).join(",")}`)
  }
  if (probeProfiles.size > 1) {
    throw new Error(`Inconsistent shard probeProfile: ${Array.from(probeProfiles).join(",")}`)
  }
  return {
    sourceRunId: Array.from(sourceRunIds)[0] ?? String(sourceRunIdOverride ?? "").trim() || null,
    sourceRunDir: Array.from(sourceRunDirs)[0] ?? null,
    probeScope: Array.from(probeScopes)[0] ?? null,
    probeProfile: Array.from(probeProfiles)[0] ?? null
  }
}

const collectPrimaryGateReasonCounts = (rows) => {
  const counts = {}
  for (const row of rows) {
    const reason = String(row?.primaryGateReasonEval ?? "").trim()
    if (!reason) continue
    counts[reason] = Number(counts[reason] ?? 0) + 1
  }
  return counts
}

const buildMergedArtifacts = ({ shards, meta, allAsBackfill }) => {
  const resultByFamilyId = new Map()
  const footprintByFamilyId = new Map()
  for (const shard of shards) {
    for (const row of Array.isArray(shard?.results) ? shard.results : []) {
      const familyId = String(row?.familyId ?? "").trim()
      if (!familyId) continue
      if (resultByFamilyId.has(familyId)) {
        throw new Error(`Duplicate familyId in shard results: ${familyId}`)
      }
      resultByFamilyId.set(familyId, { ...row, scratchDir: undefined })
    }
    for (const row of Array.isArray(shard?.footprints) ? shard.footprints : []) {
      const familyId = String(row?.familyId ?? "").trim()
      if (!familyId) continue
      if (footprintByFamilyId.has(familyId)) {
        throw new Error(`Duplicate familyId in shard footprints: ${familyId}`)
      }
      footprintByFamilyId.set(familyId, row)
    }
  }
  const results = sortFamilyIds(Array.from(resultByFamilyId.keys())).map((familyId) =>
    resultByFamilyId.get(familyId),
  )
  const footprints = sortFamilyIds(Array.from(footprintByFamilyId.keys())).map((familyId) =>
    footprintByFamilyId.get(familyId),
  )
  const passedFamilyIds = results
    .filter((row) => row?.passed === true)
    .map((row) => String(row?.familyId ?? "").trim())
  const backfillFamilyIds = allAsBackfill
    ? results.map((row) => String(row?.familyId ?? "").trim())
    : shards.flatMap((shard) => shard?.index?.backfillFamilyIds ?? [])
  const rejectedFamilyIds = results
    .filter((row) => row?.passed !== true)
    .map((row) => String(row?.familyId ?? "").trim())
  const primaryGateReasonCounts = collectPrimaryGateReasonCounts(results)
  const summary = {
    step: "C1",
    enabled: true,
    probeScope: meta.probeScope,
    probeProfile: meta.probeProfile,
    explicitFamilyIds: allAsBackfill ? results.map((row) => String(row?.familyId ?? "").trim()) : [],
    sourceRunId: meta.sourceRunId,
    sourceRunDir: meta.sourceRunDir,
    probeScopeApplied: meta.probeScope,
    writebacksDisabled: true,
    frozenProbe: true,
    feedbackUpdatesSkipped: true,
    executionFeedbackSkipped: true,
    probedFamilies: results.length,
    passedFamilies: passedFamilyIds.length,
    rejectedLowCoverageFamilies: 0,
    rejectedLowPrecisionFamilies: 0,
    rejectedLowExecutionFamilies: 0,
    rejectedHighStopFamilies: 0,
    rejectedHighTimeoutNegativeFamilies: 0,
    primaryGateReasonCounts,
    fallbackUsed: true,
    gate: {
      enabled: true,
      failed: false,
      reason: allAsBackfill ? "MERGED_ALL_AS_BACKFILL" : "MERGED_SHARDS",
      fallbackUsed: true
    },
    mergedShardRunIds: shards.map((shard) => shard.runId)
  }
  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    probeScope: meta.probeScope,
    probeProfile: meta.probeProfile,
    explicitFamilyIds: summary.explicitFamilyIds,
    sourceRunId: meta.sourceRunId,
    sourceRunDir: meta.sourceRunDir,
    probeScopeApplied: summary.probeScopeApplied,
    writebacksDisabled: summary.writebacksDisabled,
    frozenProbe: summary.frozenProbe,
    overlapFootprintsPath: null,
    probedFamilyCount: results.length,
    passedFamilyCount: passedFamilyIds.length,
    rejectedFamilyCount: rejectedFamilyIds.length,
    fallbackUsed: true,
    passedFamilyIds: sortFamilyIds(passedFamilyIds),
    backfillFamilyIds: sortFamilyIds(backfillFamilyIds),
    rejectedFamilyIds: sortFamilyIds(rejectedFamilyIds),
    resultsPath: null,
    gate: summary.gate,
    mergedShardRunIds: shards.map((shard) => shard.runId)
  }
  return { results, footprints, summary, index }
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const outRunId = String(parsed.flags["out-run-id"] ?? "").trim()
  const shardRunIds = String(parsed.flags["shard-run-ids"] ?? "")
    .split(",")
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
  const sourceRunIdOverride = String(parsed.flags["source-run-id"] ?? "").trim() || null
  const allAsBackfill = String(parsed.flags["all-as-backfill"] ?? "true").trim().toLowerCase() !== "false"
  const copySourceSteps = String(parsed.flags["copy-source-steps"] ?? "true").trim().toLowerCase() !== "false"
  if (!outRunId || shardRunIds.length < 1) {
    throw new Error(
      "Usage: node tools/merge_c1_shards.mjs --out-run-id=<run> --shard-run-ids=<run1,run2,...> [--source-run-id=<run>] [--all-as-backfill=true]",
    )
  }

  const shards = []
  for (const runId of shardRunIds) {
    shards.push(await loadShard({ cwd, runId }))
  }
  const meta = ensureConsistent({ shards, sourceRunIdOverride })
  if (!meta.sourceRunId) {
    throw new Error("Unable to resolve merged sourceRunId")
  }
  const outRunDir = resolveRunDir(cwd, outRunId)
  const outStepC1Dir = path.join(outRunDir, "step-c1")
  await ensureDir(outStepC1Dir)

  if (copySourceSteps) {
    const sourceRunDir = resolveRunDir(cwd, meta.sourceRunId)
    await ensureDir(outRunDir)
    for (const stepName of ["step-a", "step-b", "step-c0"]) {
      await copyDirIfPresent({
        fromDir: path.join(sourceRunDir, stepName),
        toDir: path.join(outRunDir, stepName)
      })
    }
  }

  const { results, footprints, summary, index } = buildMergedArtifacts({
    shards,
    meta,
    allAsBackfill
  })
  const resultsPath = path.join(outStepC1Dir, "c1_family_probe_results.jsonl")
  const footprintsPath = path.join(outStepC1Dir, "c1_family_overlap_footprints.jsonl")
  const summaryPath = path.join(outStepC1Dir, "c1_summary.json")
  const indexPath = path.join(outStepC1Dir, "c1_family_probe_index.json")
  const finalIndex = clonePlain(index)
  finalIndex.resultsPath = resultsPath
  finalIndex.overlapFootprintsPath = footprintsPath
  await writeJsonl(resultsPath, results)
  await writeJsonl(footprintsPath, footprints)
  await writeJson(summaryPath, summary)
  await writeJson(indexPath, finalIndex)

  console.log(
    JSON.stringify(
      {
        step: "merge-c1-shards",
        outRunId,
        outRunDir,
        sourceRunId: meta.sourceRunId,
        shardRunIds,
        mergedFamilies: results.length,
        passedFamilies: finalIndex.passedFamilyIds.length,
        backfillFamilies: finalIndex.backfillFamilyIds.length,
        allAsBackfill,
        copiedSourceSteps: copySourceSteps
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error?.stack ?? String(error))
  process.exit(1)
})
