import assert from "node:assert/strict"
import path from "node:path"
import { spawn } from "node:child_process"
import fsp from "node:fs/promises"

import {
  ensureDir,
  iterateJsonl,
  pathExists,
  readJson,
  readJsonIfExistsStrict,
  writeJson,
} from "../src/lib/io.mjs"
import { minePerfectPrototypeParallelIndexed } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import {
  normalizePerfectPrototypeRowsetModeStats,
  PERFECT_PROTOTYPE_ROWSET_MODE_STAT_NUMERIC_KEYS,
  PERFECT_PROTOTYPE_ROWSET_MODE_STAT_STRING_KEYS,
} from "../src/lib/perfect_prototype_rowset_mode_stats_schema.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"

const normalizeRule = (rule) => ({
  ruleId: rule?.ruleId ?? null,
  tokens: Array.isArray(rule?.tokens) ? [...rule.tokens] : [],
  trainHitCount: Number(rule?.trainHitCount ?? 0),
  trainNegativeCount: Number(rule?.trainNegativeCount ?? 0),
  maxGapTradingDays: Number(rule?.maxGapTradingDays ?? 0),
})

const normalizeCoverage = (coverage) => ({
  rowCount: Number(coverage?.rowCount ?? 0),
  matchCount: Number(coverage?.matchCount ?? 0),
  dedupedMatchCount: Number(coverage?.dedupedMatchCount ?? 0),
  matchedRuleCount: Number(coverage?.matchedRuleCount ?? 0),
  matchedDateCount: Number(coverage?.matchedDateCount ?? 0),
  matchedSymbolCount: Number(coverage?.matchedSymbolCount ?? 0),
})

const normalizeMatchRow = (row) => ({
  sourceId: row?.sourceId ?? null,
  ruleId: row?.ruleId ?? null,
  dateKey: row?.dateKey ?? null,
  symbol: row?.symbol ?? null,
  outcomeHitTarget:
    row?.outcomeHitTarget === true ? true : row?.outcomeHitTarget === false ? false : null,
})

const readJsonlRows = async (filePath) => {
  const rows = []
  await iterateJsonl(filePath, {
    strict: true,
    onRow: async (row) => {
      rows.push(row)
    },
  })
  return rows
}

const TELEMETRY_ADDITIVE_KEYS = [
  "memoHitCount",
  "memoLookupMs",
  "memoPositiveSignatureBucketCount",
  "memoFrontierInsertCount",
  "memoFrontierPruneCount",
  "memoFrontierScanCount",
  "memoFrontierDeleteCount",
  "memoFrontierSkippedBucketCount",
  "memoFrontierCompactionCount",
  "memoFrontierBucketCount",
  "memoFrontierTombstoneCount",
  "memoCacheBytes",
  "memoEvictedBucketCount",
  "memoEvictedFrontierEntryCount",
  "memoOversizeSkipCount",
  "memoRangeSkipPrefixCount",
  "memoRangeSkipSuffixCount",
  "memoRangeSummaryRebuildCount",
  "memoExactFingerprintFastHitCount",
  "memoExactFingerprintScanCount",
  "memoFingerprintMetadataRebuildCount",
  "externalBudgetPollCount",
  "externalBudgetAppliedCount",
  "externalBudgetAllowanceAppliedCount",
  "externalBudgetAllowanceSeenCount",
  "externalBudgetAllowanceConsumedCount",
  "externalBudgetCommitRequestCount",
  "rowsetBorrowHitCount",
  "rowsetBorrowMissCount",
  "rowsetOwnedAllocCount",
  "rowsetFinalizeCount",
  "sparseSparseIntersectionMs",
  "sparseBitmapIntersectionMs",
  "sparseEqualSizeMergeCount",
  "sparseAdaptiveGallopCount",
  "sparseCountFastPathCount",
  "sparseBitmapWordRunCount",
  "sparseBitmapSkippedRunCount",
  "sparseBitmapPartialRunCount",
  "sparseBitmapFullRunHitCount",
  "bitmapDenseDenseCount",
  "bitmapIntersectionMs",
  "bitmapMaterializeMs",
  "bitmapEdgeSummaryMs",
  "childOrderingMs",
  "orderingNegativeLoads",
  "orderingHeadExactLoads",
  "orderingHeadRerankMs",
  "livePartialBootstrapSnapshotCount",
  "livePartialBootstrapModeActive",
]

const sumSummaryCounter = (summaries, key) =>
  summaries.reduce((sum, summary) => sum + Number(summary?.[key] ?? 0), 0)

const assertNumericMatch = (label, actualRaw, expectedRaw) => {
  const actual = Number(actualRaw ?? 0)
  const expected = Number(expectedRaw ?? 0)
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label} mismatch: actual=${actual} expected=${expected}`,
  )
}

const assertFiniteOrNull = (label, value) => {
  if (value == null) return
  assert(
    Number.isFinite(Number(value)),
    `${label} must be finite or null: actual=${String(value)}`,
  )
}

const spawnNode = async ({ cwd, scriptPath, args = [] }) =>
  new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    proc.stdout.setEncoding("utf8")
    proc.stderr.setEncoding("utf8")
    proc.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    proc.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    proc.once("error", reject)
    proc.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(
        new Error(
          [
            "Predictive indexed smoke worker failed",
            `script=${scriptPath}`,
            `exitCode=${Number(code ?? 1)}`,
            stdout ? `stdout=${stdout.trim()}` : null,
            stderr ? `stderr=${stderr.trim()}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      )
    })
  })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const readControlPlaneJsonSnapshot = async (filePath) => {
  const payload = await readJsonIfExistsStrict(filePath)
  if (payload !== null) return payload
  if (pathExists(filePath)) {
    throw new Error(`Parallel indexed smoke expected a JSON object but found null: ${filePath}`)
  }
  return null
}

const runParallelWithLiveProgressProbe = async ({
  cwd,
  indexDir,
  outDir,
  options,
  pollIntervalMs = 250,
}) => {
  let settled = false
  let result = null
  let failure = null
  const observedProgressSnapshots = []
  const completionPromise = minePerfectPrototypeParallelIndexed({
    cwd,
    indexDir,
    outDir,
    options,
  })
    .then((value) => {
      result = value
    })
    .catch((error) => {
      failure = error
    })
    .finally(() => {
      settled = true
    })
  while (!settled) {
    await sleep(pollIntervalMs)
    const progress = await readControlPlaneJsonSnapshot(path.join(outDir, "progress.json"))
    const phase = String(progress?.phase ?? "")
    if (!progress || (phase !== "search_wave" && phase !== "search_ready_queue")) continue
    observedProgressSnapshots.push({
      phase,
      updatedAt: String(progress?.updatedAt ?? ""),
      exploredStates: Number(progress?.exploredStates ?? 0),
      activeWaveIndex: Number(progress?.activeWaveIndex ?? -1),
      parallelConfiguredMaxSearchStates: Number(progress?.parallelConfiguredMaxSearchStates ?? 0),
      parallelActiveProgressLiveSampleCount: Number(
        progress?.parallelActiveProgressLiveSampleCount ?? 0,
      ),
      parallelActiveChunkCount: Number(progress?.parallelActiveChunkCount ?? 0),
      parallelActiveWaveExploredStates: Number(progress?.parallelActiveWaveExploredStates ?? 0),
      parallelActiveWaveRulesCollected: Number(
        progress?.parallelActiveWaveRulesCollected ?? 0,
      ),
      parallelActiveWaveMemoLookupMs: Number(
        progress?.parallelActiveWaveMemoLookupMs ?? 0,
      ),
      parallelRemainingSearchBudget: Number(progress?.parallelRemainingSearchBudget ?? 0),
    })
  }
  await completionPromise
  return {
    result,
    failure,
    observedProgressSnapshots,
    finalProgress: await readControlPlaneJsonSnapshot(path.join(outDir, "progress.json")),
  }
}

const listWaveOutputDirs = async (parallelDir) => {
  const workerRootDir = path.join(parallelDir, "_parallel_workers")
  if (!pathExists(workerRootDir)) return []
  const workerDirs = await fsp.readdir(workerRootDir, { withFileTypes: true })
  const waveDirNames = []
  for (const workerDir of workerDirs) {
    if (!workerDir.isDirectory()) continue
    const slotDir = path.join(workerRootDir, workerDir.name)
    const slotEntries = await fsp.readdir(slotDir, { withFileTypes: true })
    for (const entry of slotEntries) {
      if (!entry.isDirectory()) continue
      if (entry.name === "_slot") continue
      waveDirNames.push(entry.name)
    }
  }
  return waveDirNames.sort()
}

const main = async () => {
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "smoke_prejump_parallel_indexed_equivalence",
  })
  const smokeScriptPath = path.join(cwd, "tools", "smoke_prejump_indexed_acceleration_adversarial.mjs")
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "smokeScriptPath", filePath: smokeScriptPath }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_indexed_equivalence",
  })

  const smoke = await spawnNode({
    cwd,
    scriptPath: smokeScriptPath,
  })
  const smokeSummary = JSON.parse(String(smoke.stdout ?? "").trim())
  const rootDir = path.resolve(String(smokeSummary?.rootDir ?? "").trim())
  if (!rootDir) {
    throw new Error("Parallel indexed smoke missing rootDir from predictive indexed smoke output")
  }
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "rootDir", filePath: rootDir }],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_indexed_equivalence",
  })

  const indexDir = path.join(rootDir, "index")
  const indexedDir = path.join(rootDir, "indexed")
  const parallelDir = path.join(rootDir, "parallel")
  await ensureDir(rootDir)

  const parallelProbe = await runParallelWithLiveProgressProbe({
    cwd,
    indexDir,
    outDir: parallelDir,
    options: {
      trainStartDate: "2024-01-02",
      trainEndDate: "2024-01-15",
      minHitCount: 6,
      maxGapTradingDays: 100000,
      maxRuleSize: 6,
      maxSeedTokens: 4000,
      maxRules: 4000,
      maxSearchStates: 20000000,
      maxRejectedRuleSamples: 1000,
      searchStateCacheMaxBytes: 32 * 1024,
      orderingHeadWindow: 8,
      workers: 2,
    },
  })
  assert.equal(parallelProbe.failure, null, parallelProbe.failure?.stack ?? parallelProbe.failure?.message ?? null)
  const parallel = parallelProbe.result
  assert(parallel, "Parallel smoke did not return a result")

  const indexedCatalog = await readJson(path.join(indexedDir, "catalog.json"), null)
  const indexedSummary = await readJson(path.join(indexedDir, "summary.json"), null)
  const indexedCoverage = await readJson(path.join(indexedDir, "coverage.json"), null)
  const indexedMatches = await readJsonlRows(path.join(indexedDir, "matches.jsonl"))
  const indexedDeduped = await readJsonlRows(path.join(indexedDir, "deduped_matches.jsonl"))
  const parallelProgress = await readJson(path.join(parallelDir, "progress.json"), null)
  const parallelManifest = await readJson(path.join(parallelDir, "parallel_manifest.json"), null)
  assert(parallelProgress, "Parallel smoke progress is missing")
  assert(parallelManifest, "Parallel smoke manifest is missing")
  assert.equal(Number(parallelManifest?.version ?? 0), 14, "Parallel smoke expects manifest version 14")
  assert(Number(parallelManifest?.parallelBudgetPendingCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetPendingWaitMs ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelCompletedChunkReclaimCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelCompletedChunkReclaimSearchStates ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetFastpathTickCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelBudgetFastpathServiceMs ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelWorkerSpawnCount ?? 0) >= 2)
  assert(Number(parallelManifest?.parallelWorkerSlotReuseCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelWorkerWarmLaunchCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelWorkerColdStartMs ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelWorkerWarmLaunchMs ?? 0) >= 0)
  if (parallelProbe.observedProgressSnapshots.length > 1) {
    for (let index = 1; index < parallelProbe.observedProgressSnapshots.length; index += 1) {
      const previous = parallelProbe.observedProgressSnapshots[index - 1]
      const current = parallelProbe.observedProgressSnapshots[index]
      assert(
        current.exploredStates >= previous.exploredStates,
        `parallel exploredStates regressed: previous=${previous.exploredStates} current=${current.exploredStates}`,
      )
      assert(
        current.parallelRemainingSearchBudget <= previous.parallelRemainingSearchBudget,
        `parallel remaining search budget increased during active wave: previous=${previous.parallelRemainingSearchBudget} current=${current.parallelRemainingSearchBudget}`,
      )
    }
  }
  const chunkRuns = Array.isArray(parallelManifest?.chunkRuns) ? parallelManifest.chunkRuns : []
  assert(chunkRuns.length > 0, "Parallel smoke chunkRuns are missing")
  assert.equal(chunkRuns.length, Number(parallelManifest?.parallelChunkCount ?? chunkRuns.length))
  for (const chunkRun of chunkRuns) {
    assert(Number.isInteger(Number(chunkRun?.baseAllocatedMaxSearchStates ?? NaN)))
    assert(Number(chunkRun?.baseAllocatedMaxSearchStates ?? 0) > 0)
    assert(Number.isInteger(Number(chunkRun?.guardBandAllocatedSearchStates ?? NaN)))
    assert(Number(chunkRun?.guardBandAllocatedSearchStates ?? 0) >= 0)
    assert(Number.isInteger(Number(chunkRun?.allocatedMaxSearchStates ?? NaN)))
    assert(Number(chunkRun?.allocatedMaxSearchStates ?? 0) > 0)
    assert(Number.isInteger(Number(chunkRun?.effectiveAllocatedMaxSearchStates ?? NaN)))
    assert(
      Number(chunkRun?.effectiveAllocatedMaxSearchStates ?? 0) >=
        Number(chunkRun?.allocatedMaxSearchStates ?? 0),
    )
    assert.equal(
      Number(chunkRun?.allocatedMaxSearchStates ?? 0),
      Number(chunkRun?.baseAllocatedMaxSearchStates ?? 0) +
        Number(chunkRun?.guardBandAllocatedSearchStates ?? 0),
    )
    assert(Number.isInteger(Number(chunkRun?.remainingGlobalSearchBudgetAtLaunch ?? NaN)))
    assert(Number(chunkRun?.remainingGlobalSearchBudgetAtLaunch ?? 0) >= 0)
    assert(Number(chunkRun?.allocatedMaxSearchStates ?? 0) <= Number(chunkRun?.remainingGlobalSearchBudgetAtLaunch ?? 0))
    assert(Number.isInteger(Number(chunkRun?.dispatchOrder ?? NaN)))
    assert(Number(chunkRun?.dispatchOrder ?? -1) >= 0)
    assert(Number.isInteger(Number(chunkRun?.waveIndex ?? NaN)))
    assert(Number(chunkRun?.waveIndex ?? -1) >= 0)
    assert(pathExists(String(chunkRun?.liveBudgetPath ?? "")), "Parallel smoke liveBudgetPath is missing")
    assert(String(chunkRun?.budgetRequestPath ?? "").trim().length > 0)
    assert(String(chunkRun?.budgetDecisionPath ?? "").trim().length > 0)
  }
  const uniqueDispatchOrders = new Set(chunkRuns.map((chunkRun) => Number(chunkRun?.dispatchOrder ?? -1)))
  assert.equal(uniqueDispatchOrders.size, chunkRuns.length, "Parallel smoke dispatchOrder values must be unique")
  const workerSummaryPaths = chunkRuns
    .slice()
    .sort((left, right) => Number(left?.chunkIndex ?? 0) - Number(right?.chunkIndex ?? 0))
    .map((chunkRun) => String(chunkRun?.summaryPath ?? "").trim())
    .filter(Boolean)
    .sort()
  assert(workerSummaryPaths.length > 0, "Parallel smoke chunk summaries are missing")
  assert.equal(workerSummaryPaths.length, Number(parallelManifest?.parallelChunkCount ?? workerSummaryPaths.length))
  const workerSummaries = await Promise.all(workerSummaryPaths.map((summaryPath) => readJson(summaryPath, null)))
  const chunkRunsBySummaryPath = new Map(
    chunkRuns.map((chunkRun) => [String(chunkRun?.summaryPath ?? "").trim(), chunkRun]),
  )
  const workerRejectionSummaries = workerSummaries.map((summary) => summary?.rejectionSummary ?? {})
  const expectedSparseKernelMode = String(workerRejectionSummaries[0]?.sparseKernelMode ?? "")
  const expectedBitmapKernelMode = String(workerRejectionSummaries[0]?.bitmapKernelMode ?? "")
  assert(expectedSparseKernelMode.length > 0, "Parallel smoke worker sparseKernelMode is missing")
  assert(expectedBitmapKernelMode.length > 0, "Parallel smoke worker bitmapKernelMode is missing")
  workerRejectionSummaries.forEach((rejectionSummary, index) => {
    const workerSummaryPath = workerSummaryPaths[index]
    const chunkRun = chunkRunsBySummaryPath.get(workerSummaryPath) ?? null
    assert(chunkRun, `Parallel smoke missing chunkRun for summaryPath=${workerSummaryPath}`)
    assert.equal(String(rejectionSummary?.sparseKernelMode ?? ""), expectedSparseKernelMode)
    assert.equal(String(rejectionSummary?.bitmapKernelMode ?? ""), expectedBitmapKernelMode)
    assert.equal(
      Number(rejectionSummary?.configuredMaxSearchStates ?? 0),
      20000000,
      `worker configuredMaxSearchStates mismatch at index ${index}`,
    )
    assert.equal(
      Number(rejectionSummary?.baseAllocatedMaxSearchStates ?? 0),
      Number(chunkRun?.baseAllocatedMaxSearchStates ?? 0),
      `worker baseAllocatedMaxSearchStates mismatch at index ${index}`,
    )
    assert.equal(
      Number(rejectionSummary?.guardBandAllocatedSearchStates ?? 0),
      Number(chunkRun?.guardBandAllocatedSearchStates ?? 0),
      `worker guardBandAllocatedSearchStates mismatch at index ${index}`,
    )
    assert.equal(
      Number(rejectionSummary?.allocatedMaxSearchStates ?? 0),
      Number(chunkRun?.allocatedMaxSearchStates ?? 0),
      `worker allocatedMaxSearchStates mismatch at index ${index}`,
    )
    assert.equal(
      Number(rejectionSummary?.remainingGlobalSearchBudgetAtLaunch ?? 0),
      Number(chunkRun?.remainingGlobalSearchBudgetAtLaunch ?? 0),
      `worker remainingGlobalSearchBudgetAtLaunch mismatch at index ${index}`,
    )
    assert(Number.isFinite(Number(rejectionSummary?.externalKthHitFloorPollCount ?? NaN)))
    assert(Number.isFinite(Number(rejectionSummary?.externalKthHitFloorAppliedCount ?? NaN)))
    assert(Number.isFinite(Number(rejectionSummary?.externalKthHitFloorRevision ?? NaN)))
    assert(Number.isFinite(Number(rejectionSummary?.externalBudgetPollCount ?? NaN)))
    assert(Number.isFinite(Number(rejectionSummary?.externalBudgetDecisionPollCount ?? NaN)))
    assert(Number.isFinite(Number(rejectionSummary?.externalBudgetAppliedCount ?? NaN)))
    assert(Number.isFinite(Number(rejectionSummary?.externalBudgetAllowanceAppliedCount ?? NaN)))
    assert(Number.isFinite(Number(rejectionSummary?.externalBudgetAllowanceSeenCount ?? NaN)))
    assert(Number.isFinite(Number(rejectionSummary?.externalBudgetAllowanceConsumedCount ?? NaN)))
    assert(Number.isFinite(Number(rejectionSummary?.externalBudgetRequestCount ?? NaN)))
    assert(Number.isFinite(Number(rejectionSummary?.externalBudgetRequestSatisfiedCount ?? NaN)))
    assert(Number.isFinite(Number(rejectionSummary?.externalBudgetRequestDeniedCount ?? NaN)))
    assert(Number.isFinite(Number(rejectionSummary?.externalBudgetCommitRequestCount ?? NaN)))
    assertFiniteOrNull(
      `workerSummaries[${index}].rejectionSummary.externalAllocatedMaxSearchStates`,
      rejectionSummary?.externalAllocatedMaxSearchStates,
    )
    assert(Number.isFinite(Number(rejectionSummary?.externalBudgetRevision ?? NaN)))
    assert(Number.isFinite(Number(rejectionSummary?.externalBudgetCommitRevision ?? NaN)))
    assert(
      Number(rejectionSummary?.effectiveAllocatedMaxSearchStates ?? 0) >=
        Number(rejectionSummary?.allocatedMaxSearchStates ?? 0),
      `worker effectiveAllocatedMaxSearchStates regressed below allocated at index ${index}`,
    )
    assert(Number.isFinite(Number(rejectionSummary?.budgetStopCount ?? NaN)))
    assertFiniteOrNull(
      `workerSummaries[${index}].rejectionSummary.budgetStopExploredStates`,
      rejectionSummary?.budgetStopExploredStates,
    )
    assertFiniteOrNull(
      `workerSummaries[${index}].rejectionSummary.externalKthHitFloor`,
      rejectionSummary?.externalKthHitFloor,
    )
    assertFiniteOrNull(
      `workerSummaries[${index}].rejectionSummary.effectiveKthHitFloor`,
      rejectionSummary?.effectiveKthHitFloor,
    )
    assert(
      Number(workerSummaries[index]?.exploredStates ?? 0) <=
        Number(rejectionSummary?.effectiveAllocatedMaxSearchStates ?? 0),
      `worker exploredStates exceeded effectiveAllocatedMaxSearchStates at index ${index}`,
    )
    if (Number(rejectionSummary?.budgetStopCount ?? 0) > 0) {
      assert.equal(
        String(rejectionSummary?.budgetStopReason ?? ""),
        "allocated_budget_exhausted",
        `worker budgetStopReason mismatch at index ${index}`,
      )
    }
  })
  const workerRowsetModeStats = workerRejectionSummaries.map((summary) =>
    normalizePerfectPrototypeRowsetModeStats(summary?.rowsetModeStats),
  )
  const expectedRowsetModeStats = normalizePerfectPrototypeRowsetModeStats({})
  for (const stats of workerRowsetModeStats) {
    for (const key of PERFECT_PROTOTYPE_ROWSET_MODE_STAT_STRING_KEYS) {
      const expectedValue = String(expectedRowsetModeStats[key] ?? "").trim()
      const currentValue = String(stats[key] ?? "").trim()
      if (currentValue.length < 1) continue
      if (expectedValue.length < 1) {
        expectedRowsetModeStats[key] = currentValue
        continue
      }
      assert.equal(currentValue, expectedValue, `worker rowsetModeStats.${key} mismatch`)
    }
    for (const key of PERFECT_PROTOTYPE_ROWSET_MODE_STAT_NUMERIC_KEYS) {
      expectedRowsetModeStats[key] += Number(stats[key] ?? 0)
    }
  }

  assert(indexedCatalog, "Indexed smoke catalog is missing")
  assert(indexedSummary, "Indexed smoke summary is missing")
  assert(indexedCoverage, "Indexed smoke coverage is missing")

  assert.deepStrictEqual(
    (parallel.rules ?? []).map(normalizeRule),
    (indexedCatalog.rules ?? []).map(normalizeRule),
  )
  assert.equal(parallel.catalog?.champion?.ruleId ?? null, indexedCatalog.champion?.ruleId ?? null)
  assert.deepStrictEqual(
    normalizeCoverage(parallel.coverage),
    normalizeCoverage(indexedCoverage),
  )
  assert.deepStrictEqual(
    (parallel.matches ?? []).map(normalizeMatchRow),
    indexedMatches.map(normalizeMatchRow),
  )
  assert.deepStrictEqual(
    (parallel.dedupedMatches ?? []).map(normalizeMatchRow),
    indexedDeduped.map(normalizeMatchRow),
  )
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoEvictedBucketCount ?? NaN)))
  assert(Number(parallel?.rejectionSummary?.orderingNegativeLoads ?? 0) >= 0)
  assert(Number(parallel?.rejectionSummary?.orderingHeadWindow ?? 0) >= 0)
  assert(Number(parallel?.rejectionSummary?.orderingHeadExactLoads ?? 0) >= 0)
  assert(Number(parallel?.rejectionSummary?.orderingHeadRerankMs ?? 0) >= 0)
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.partialMergePeakBucketCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.partialMergePeakLiveRuleCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.partialMergeEvictedByHitFloorCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.partialMergeTieBandRuleCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.partialMergeTieBandBucketCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.partialMergePeakTieBandRuleCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.partialMergeCompactedBucketCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.partialMergeCompactedRuleCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelChunkCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelWaveCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelCompletedChunkCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelCompletedWaveCount ?? NaN)))
  assertFiniteOrNull(
    "parallel.rejectionSummary.parallelGlobalKthHitFloor",
    parallel?.rejectionSummary?.parallelGlobalKthHitFloor,
  )
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelFloorSeededChunkCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelWaveMergeMs ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelChunkPlannerImbalanceRatio ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelActiveProgressLiveSampleCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelReadyQueueDepth ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelDispatchCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelImmediateRefillCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelLiveFloorUpdateCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelLiveFloorRevision ?? NaN)))
  assertFiniteOrNull(
    "parallel.rejectionSummary.parallelFirstGlobalFloorElapsedMs",
    parallel?.rejectionSummary?.parallelFirstGlobalFloorElapsedMs,
  )
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelLivePartialRuleRevisionCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelLivePartialRuleMergeMs ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelLivePartialFloorUpdateCount ?? NaN)))
  assertFiniteOrNull(
    "parallel.rejectionSummary.parallelFirstLivePartialFloorElapsedMs",
    parallel?.rejectionSummary?.parallelFirstLivePartialFloorElapsedMs,
  )
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelBootstrapChunkCount ?? NaN)))
  assertFiniteOrNull(
    "parallel.rejectionSummary.parallelFirstChunkCompletionElapsedMs",
    parallel?.rejectionSummary?.parallelFirstChunkCompletionElapsedMs,
  )
  assertFiniteOrNull(
    "parallel.rejectionSummary.parallelFirstBootstrapFloorElapsedMs",
    parallel?.rejectionSummary?.parallelFirstBootstrapFloorElapsedMs,
  )
  assert(
    Number.isFinite(
      Number(parallel?.rejectionSummary?.parallelBootstrapFloorSeededLaunchCount ?? NaN),
    ),
  )
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelActiveLiveRuleCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelActiveAllocatedSearchBudget ?? NaN)))
  assert(
    Number.isFinite(
      Number(parallel?.rejectionSummary?.parallelActiveEffectiveAllocatedSearchBudget ?? NaN),
    ),
  )
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelBudgetTopupCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelBudgetTopupSearchStates ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelSlotIdleMs ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelConfiguredMaxSearchStates ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.parallelRemainingSearchBudget ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoFrontierScanCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoFrontierDeleteCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoFrontierSkippedBucketCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoFrontierCompactionCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoFrontierBucketCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoFrontierTombstoneCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoFingerprintBucketPeak ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoEvictedFrontierEntryCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoRangeSkipPrefixCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoRangeSkipSuffixCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoRangeSummaryRebuildCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoExactFingerprintFastHitCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoExactFingerprintScanCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.memoFingerprintMetadataRebuildCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.livePartialRuleRevision ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.livePartialRuleCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.livePartialRuleCheckpointCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.livePartialRuleWriteMs ?? NaN)))
  assert(
    Number.isFinite(Number(parallel?.rejectionSummary?.livePartialBootstrapSnapshotCount ?? NaN)),
  )
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.livePartialBootstrapRuleCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.livePartialBootstrapModeActive ?? NaN)))
  assertFiniteOrNull(
    "parallel.rejectionSummary.livePartialLocalKthHitFloor",
    parallel?.rejectionSummary?.livePartialLocalKthHitFloor,
  )
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.externalKthHitFloorPollCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.externalKthHitFloorAppliedCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.externalKthHitFloorRevision ?? NaN)))
  assertFiniteOrNull(
    "parallel.rejectionSummary.externalKthHitFloor",
    parallel?.rejectionSummary?.externalKthHitFloor,
  )
  assertFiniteOrNull(
    "parallel.rejectionSummary.effectiveKthHitFloor",
    parallel?.rejectionSummary?.effectiveKthHitFloor,
  )
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.rowsetBorrowHitCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.rowsetBorrowMissCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.rowsetOwnedAllocCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.rowsetFinalizeCount ?? NaN)))
  assert.equal(String(parallel?.rejectionSummary?.sparseKernelMode ?? ""), "adaptive_exact_v4")
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.sparseSparseIntersectionMs ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.sparseBitmapIntersectionMs ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.sparseEqualSizeMergeCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.sparseAdaptiveGallopCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.sparseCountFastPathCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.sparseBitmapWordRunCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.sparseBitmapSkippedRunCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.sparseBitmapPartialRunCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.sparseBitmapFullRunHitCount ?? NaN)))
  assert.equal(String(parallel?.rejectionSummary?.bitmapKernelMode ?? ""), "avx2_exact_bitset")
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.bitmapDenseDenseCount ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.bitmapIntersectionMs ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.bitmapMaterializeMs ?? NaN)))
  assert(Number.isFinite(Number(parallel?.rejectionSummary?.bitmapEdgeSummaryMs ?? NaN)))
  assert.equal(
    Number(parallel?.rejectionSummary?.liveCanonicalRuleCount ?? 0),
    Array.isArray(parallel?.rules) ? parallel.rules.length : 0,
  )
  assert.equal(
    Number(parallel?.rejectionSummary?.finalSelectedRuleCount ?? 0),
    Array.isArray(parallel?.rules) ? parallel.rules.length : 0,
  )
  assert(
    Number(parallel?.rejectionSummary?.observedRuleCount ?? 0) >=
      Number(parallel?.rejectionSummary?.liveCanonicalRuleCount ?? 0),
  )
  for (const key of TELEMETRY_ADDITIVE_KEYS) {
    const expected = sumSummaryCounter(workerRejectionSummaries, key)
    assertNumericMatch(`parallel.rejectionSummary.${key}`, parallel?.rejectionSummary?.[key], expected)
    assertNumericMatch(`parallel_manifest.${key}`, parallelManifest?.[key], expected)
  }
  const expectedMemoFingerprintBucketPeak = workerRejectionSummaries.reduce(
    (maxValue, summary) =>
      Math.max(maxValue, Number(summary?.memoFingerprintBucketPeak ?? 0)),
    0,
  )
  const expectedExternalKthHitFloorRevision = workerRejectionSummaries.reduce(
    (maxValue, summary) =>
      Math.max(maxValue, Number(summary?.externalKthHitFloorRevision ?? 0)),
    0,
  )
  const expectedExternalKthHitFloor = workerRejectionSummaries.reduce(
    (maxValue, summary) =>
      Math.max(maxValue, Number(summary?.externalKthHitFloor ?? 0)),
    0,
  )
  const expectedEffectiveKthHitFloor = workerRejectionSummaries.reduce(
    (maxValue, summary) =>
      Math.max(maxValue, Number(summary?.effectiveKthHitFloor ?? 0)),
    0,
  )
  const expectedExternalAllocatedMaxSearchStates = workerRejectionSummaries.reduce(
    (maxValue, summary) =>
      Math.max(maxValue, Number(summary?.externalAllocatedMaxSearchStates ?? 0)),
    0,
  )
  const expectedExternalBudgetRevision = workerRejectionSummaries.reduce(
    (maxValue, summary) =>
      Math.max(maxValue, Number(summary?.externalBudgetRevision ?? 0)),
    0,
  )
  const expectedEffectiveAllocatedMaxSearchStates = workerRejectionSummaries.reduce(
    (maxValue, summary) =>
      Math.max(maxValue, Number(summary?.effectiveAllocatedMaxSearchStates ?? 0)),
    0,
  )
  const expectedLivePartialRuleRevision = workerRejectionSummaries.reduce(
    (sum, summary) => sum + Number(summary?.livePartialRuleRevision ?? 0),
    0,
  )
  const expectedLivePartialRuleCount = workerRejectionSummaries.reduce(
    (sum, summary) => sum + Number(summary?.livePartialRuleCount ?? 0),
    0,
  )
  const expectedLivePartialRuleCheckpointCount = workerRejectionSummaries.reduce(
    (sum, summary) => sum + Number(summary?.livePartialRuleCheckpointCount ?? 0),
    0,
  )
  const expectedLivePartialRuleWriteMs = workerRejectionSummaries.reduce(
    (sum, summary) => sum + Number(summary?.livePartialRuleWriteMs ?? 0),
    0,
  )
  const expectedLivePartialLocalKthHitFloor = workerRejectionSummaries.reduce(
    (maxValue, summary) =>
      Math.max(maxValue, Number(summary?.livePartialLocalKthHitFloor ?? 0)),
    0,
  )
  const expectedLivePartialBootstrapRuleCount = workerRejectionSummaries.reduce(
    (maxValue, summary) =>
      Math.max(maxValue, Number(summary?.livePartialBootstrapRuleCount ?? 0)),
    0,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.memoFingerprintBucketPeak",
    parallel?.rejectionSummary?.memoFingerprintBucketPeak,
    expectedMemoFingerprintBucketPeak,
  )
  assertNumericMatch(
    "parallel_manifest.memoFingerprintBucketPeak",
    parallelManifest?.memoFingerprintBucketPeak,
    expectedMemoFingerprintBucketPeak,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.externalKthHitFloorRevision",
    parallel?.rejectionSummary?.externalKthHitFloorRevision,
    expectedExternalKthHitFloorRevision,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.externalKthHitFloor",
    parallel?.rejectionSummary?.externalKthHitFloor,
    expectedExternalKthHitFloor,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.effectiveKthHitFloor",
    parallel?.rejectionSummary?.effectiveKthHitFloor,
    expectedEffectiveKthHitFloor,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.externalAllocatedMaxSearchStates",
    parallel?.rejectionSummary?.externalAllocatedMaxSearchStates,
    expectedExternalAllocatedMaxSearchStates,
  )
  assertNumericMatch(
    "parallel_manifest.externalAllocatedMaxSearchStates",
    parallelManifest?.externalAllocatedMaxSearchStates,
    expectedExternalAllocatedMaxSearchStates,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.externalBudgetRevision",
    parallel?.rejectionSummary?.externalBudgetRevision,
    expectedExternalBudgetRevision,
  )
  assertNumericMatch(
    "parallel_manifest.externalBudgetRevision",
    parallelManifest?.externalBudgetRevision,
    expectedExternalBudgetRevision,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.effectiveAllocatedMaxSearchStates",
    parallel?.rejectionSummary?.effectiveAllocatedMaxSearchStates,
    expectedEffectiveAllocatedMaxSearchStates,
  )
  assertNumericMatch(
    "parallel_manifest.effectiveAllocatedMaxSearchStates",
    parallelManifest?.effectiveAllocatedMaxSearchStates,
    expectedEffectiveAllocatedMaxSearchStates,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.livePartialRuleRevision",
    parallel?.rejectionSummary?.livePartialRuleRevision,
    expectedLivePartialRuleRevision,
  )
  assertNumericMatch(
    "parallel_manifest.livePartialRuleRevision",
    parallelManifest?.livePartialRuleRevision,
    expectedLivePartialRuleRevision,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.livePartialRuleCount",
    parallel?.rejectionSummary?.livePartialRuleCount,
    expectedLivePartialRuleCount,
  )
  assertNumericMatch(
    "parallel_manifest.livePartialRuleCount",
    parallelManifest?.livePartialRuleCount,
    expectedLivePartialRuleCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.livePartialRuleCheckpointCount",
    parallel?.rejectionSummary?.livePartialRuleCheckpointCount,
    expectedLivePartialRuleCheckpointCount,
  )
  assertNumericMatch(
    "parallel_manifest.livePartialRuleCheckpointCount",
    parallelManifest?.livePartialRuleCheckpointCount,
    expectedLivePartialRuleCheckpointCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.livePartialRuleWriteMs",
    parallel?.rejectionSummary?.livePartialRuleWriteMs,
    expectedLivePartialRuleWriteMs,
  )
  assertNumericMatch(
    "parallel_manifest.livePartialRuleWriteMs",
    parallelManifest?.livePartialRuleWriteMs,
    expectedLivePartialRuleWriteMs,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.livePartialBootstrapRuleCount",
    parallel?.rejectionSummary?.livePartialBootstrapRuleCount,
    expectedLivePartialBootstrapRuleCount,
  )
  assertNumericMatch(
    "parallel_manifest.livePartialBootstrapRuleCount",
    parallelManifest?.livePartialBootstrapRuleCount,
    expectedLivePartialBootstrapRuleCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.livePartialLocalKthHitFloor",
    parallel?.rejectionSummary?.livePartialLocalKthHitFloor,
    expectedLivePartialLocalKthHitFloor,
  )
  assertNumericMatch(
    "parallel_manifest.livePartialLocalKthHitFloor",
    parallelManifest?.livePartialLocalKthHitFloor,
    expectedLivePartialLocalKthHitFloor,
  )
  assert.equal(String(parallel?.rejectionSummary?.sparseKernelMode ?? ""), expectedSparseKernelMode)
  assert.equal(String(parallelManifest?.sparseKernelMode ?? ""), expectedSparseKernelMode)
  assert.equal(String(parallel?.rejectionSummary?.bitmapKernelMode ?? ""), expectedBitmapKernelMode)
  assert.equal(String(parallelManifest?.bitmapKernelMode ?? ""), expectedBitmapKernelMode)
  assert.equal(Number(parallelManifest?.workerCount ?? 0), 2)
  assert.equal(
    Number(parallelManifest?.parallelConfiguredMaxSearchStates ?? 0),
    20000000,
  )
  if (Number(parallelManifest?.parallelChunkCount ?? 0) > 1) {
    assert(
      parallelProbe.observedProgressSnapshots.length > 0,
      "Parallel smoke did not observe active progress snapshots for a multi-chunk run",
    )
    assert(
      Number(parallelManifest?.parallelActiveProgressLiveSampleCount ?? 0) > 0,
      "parallel manifest did not record live active progress samples for a multi-chunk run",
    )
  }
  assert.equal(
    Number(parallelManifest?.parallelDispatchCount ?? 0),
    chunkRuns.length,
  )
  assert.equal(
    Number(parallelManifest?.parallelReadyQueueDepth ?? -1),
    0,
  )
  assert(Number(parallelManifest?.parallelImmediateRefillCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelLiveFloorUpdateCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelLiveFloorRevision ?? 0) >= 0)
  assertFiniteOrNull(
    "parallel_manifest.parallelFirstGlobalFloorElapsedMs",
    parallelManifest?.parallelFirstGlobalFloorElapsedMs,
  )
  assert(Number(parallelManifest?.parallelLivePartialRuleRevisionCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelLivePartialRuleMergeMs ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelLivePartialFloorUpdateCount ?? 0) >= 0)
  assertFiniteOrNull(
    "parallel_manifest.parallelFirstLivePartialFloorElapsedMs",
    parallelManifest?.parallelFirstLivePartialFloorElapsedMs,
  )
  assert(Number(parallelManifest?.parallelBootstrapChunkCount ?? 0) >= 0)
  assertFiniteOrNull(
    "parallel_manifest.parallelFirstChunkCompletionElapsedMs",
    parallelManifest?.parallelFirstChunkCompletionElapsedMs,
  )
  assertFiniteOrNull(
    "parallel_manifest.parallelFirstBootstrapFloorElapsedMs",
    parallelManifest?.parallelFirstBootstrapFloorElapsedMs,
  )
  assert(Number(parallelManifest?.parallelBootstrapFloorSeededLaunchCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelActiveLiveRuleCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelActiveAllocatedSearchBudget ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelActiveEffectiveAllocatedSearchBudget ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetRequestCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetGrantCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetDenyCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetTopupCount ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelBudgetTopupSearchStates ?? 0) >= 0)
  assert(Number(parallelManifest?.parallelSlotIdleMs ?? 0) >= 0)
  assert(pathExists(String(parallelManifest?.liveFloorPath ?? "")), "parallel live floor path is missing")
  assert.equal(
    Number(parallelManifest?.parallelCompletedChunkCount ?? 0),
    Number(parallelManifest?.parallelChunkCount ?? 0),
  )
  assert.equal(
    Number(parallelManifest?.parallelCompletedWaveCount ?? 0),
    Number(parallelManifest?.parallelWaveCount ?? 0),
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelChunkCount",
    parallel?.rejectionSummary?.parallelChunkCount,
    parallelManifest?.parallelChunkCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelWaveCount",
    parallel?.rejectionSummary?.parallelWaveCount,
    parallelManifest?.parallelWaveCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelBootstrapChunkCount",
    parallel?.rejectionSummary?.parallelBootstrapChunkCount,
    parallelManifest?.parallelBootstrapChunkCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelCompletedChunkCount",
    parallel?.rejectionSummary?.parallelCompletedChunkCount,
    parallelManifest?.parallelCompletedChunkCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelCompletedWaveCount",
    parallel?.rejectionSummary?.parallelCompletedWaveCount,
    parallelManifest?.parallelCompletedWaveCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelGlobalKthHitFloor",
    parallel?.rejectionSummary?.parallelGlobalKthHitFloor,
    parallelManifest?.parallelGlobalKthHitFloor,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelFloorSeededChunkCount",
    parallel?.rejectionSummary?.parallelFloorSeededChunkCount,
    parallelManifest?.parallelFloorSeededChunkCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelWaveMergeMs",
    parallel?.rejectionSummary?.parallelWaveMergeMs,
    parallelManifest?.parallelWaveMergeMs,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelChunkPlannerImbalanceRatio",
    parallel?.rejectionSummary?.parallelChunkPlannerImbalanceRatio,
    parallelManifest?.parallelChunkPlannerImbalanceRatio,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelActiveProgressLiveSampleCount",
    parallel?.rejectionSummary?.parallelActiveProgressLiveSampleCount,
    parallelManifest?.parallelActiveProgressLiveSampleCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelReadyQueueDepth",
    parallel?.rejectionSummary?.parallelReadyQueueDepth,
    parallelManifest?.parallelReadyQueueDepth,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelDispatchCount",
    parallel?.rejectionSummary?.parallelDispatchCount,
    parallelManifest?.parallelDispatchCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelImmediateRefillCount",
    parallel?.rejectionSummary?.parallelImmediateRefillCount,
    parallelManifest?.parallelImmediateRefillCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelLiveFloorUpdateCount",
    parallel?.rejectionSummary?.parallelLiveFloorUpdateCount,
    parallelManifest?.parallelLiveFloorUpdateCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelLiveFloorRevision",
    parallel?.rejectionSummary?.parallelLiveFloorRevision,
    parallelManifest?.parallelLiveFloorRevision,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelLivePartialRuleRevisionCount",
    parallel?.rejectionSummary?.parallelLivePartialRuleRevisionCount,
    parallelManifest?.parallelLivePartialRuleRevisionCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelLivePartialRuleMergeMs",
    parallel?.rejectionSummary?.parallelLivePartialRuleMergeMs,
    parallelManifest?.parallelLivePartialRuleMergeMs,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelLivePartialFloorUpdateCount",
    parallel?.rejectionSummary?.parallelLivePartialFloorUpdateCount,
    parallelManifest?.parallelLivePartialFloorUpdateCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelActiveLiveRuleCount",
    parallel?.rejectionSummary?.parallelActiveLiveRuleCount,
    parallelManifest?.parallelActiveLiveRuleCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelActiveAllocatedSearchBudget",
    parallel?.rejectionSummary?.parallelActiveAllocatedSearchBudget,
    parallelManifest?.parallelActiveAllocatedSearchBudget,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelActiveEffectiveAllocatedSearchBudget",
    parallel?.rejectionSummary?.parallelActiveEffectiveAllocatedSearchBudget,
    parallelManifest?.parallelActiveEffectiveAllocatedSearchBudget,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelBudgetRequestCount",
    parallel?.rejectionSummary?.parallelBudgetRequestCount,
    parallelManifest?.parallelBudgetRequestCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelBudgetGrantCount",
    parallel?.rejectionSummary?.parallelBudgetGrantCount,
    parallelManifest?.parallelBudgetGrantCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelBudgetDenyCount",
    parallel?.rejectionSummary?.parallelBudgetDenyCount,
    parallelManifest?.parallelBudgetDenyCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelBudgetTopupCount",
    parallel?.rejectionSummary?.parallelBudgetTopupCount,
    parallelManifest?.parallelBudgetTopupCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelBudgetTopupSearchStates",
    parallel?.rejectionSummary?.parallelBudgetTopupSearchStates,
    parallelManifest?.parallelBudgetTopupSearchStates,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelSlotIdleMs",
    parallel?.rejectionSummary?.parallelSlotIdleMs,
    parallelManifest?.parallelSlotIdleMs,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelConfiguredMaxSearchStates",
    parallel?.rejectionSummary?.parallelConfiguredMaxSearchStates,
    parallelManifest?.parallelConfiguredMaxSearchStates,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelRemainingSearchBudget",
    parallel?.rejectionSummary?.parallelRemainingSearchBudget,
    parallelManifest?.parallelRemainingSearchBudget,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelRemainingGrantableSearchBudget",
    parallel?.rejectionSummary?.parallelRemainingGrantableSearchBudget,
    parallelManifest?.parallelRemainingGrantableSearchBudget,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelBudgetFastpathTickCount",
    parallel?.rejectionSummary?.parallelBudgetFastpathTickCount,
    parallelManifest?.parallelBudgetFastpathTickCount,
  )
  assertNumericMatch(
    "parallel.rejectionSummary.parallelBudgetFastpathServiceMs",
    parallel?.rejectionSummary?.parallelBudgetFastpathServiceMs,
    parallelManifest?.parallelBudgetFastpathServiceMs,
  )
  assert.equal(
    Number(parallelProgress?.parallelConfiguredMaxSearchStates ?? 0),
    20000000,
  )
  if (Number(parallelManifest?.parallelChunkCount ?? 0) > 1) {
    assert(Number(parallelProgress?.parallelActiveProgressLiveSampleCount ?? 0) > 0)
  }
  assert(Number(parallelProgress?.parallelReadyQueueDepth ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelDispatchCount ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelImmediateRefillCount ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelLiveFloorUpdateCount ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelLiveFloorRevision ?? 0) >= 0)
  assertFiniteOrNull(
    "parallel.progress.parallelFirstGlobalFloorElapsedMs",
    parallelProgress?.parallelFirstGlobalFloorElapsedMs,
  )
  assert(Number(parallelProgress?.parallelActiveAllocatedSearchBudget ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelActiveEffectiveAllocatedSearchBudget ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelBudgetRequestCount ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelBudgetGrantCount ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelBudgetDenyCount ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelBudgetTopupCount ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelBudgetTopupSearchStates ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelSlotIdleMs ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelRemainingSearchBudget ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelRemainingGrantableSearchBudget ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelActiveChunkCount ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelActiveWaveExploredStates ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelActiveWaveRulesCollected ?? 0) >= 0)
  assert(Number(parallelProgress?.parallelActiveWaveMemoLookupMs ?? 0) >= 0)
  assertFiniteOrNull(
    "parallel.progress.parallelActiveWaveEtaSeconds",
    parallelProgress?.parallelActiveWaveEtaSeconds,
  )
  assert.equal(
    Number(parallelProbe.finalProgress?.parallelConfiguredMaxSearchStates ?? 0),
    20000000,
  )
  const mergedRowsetModeStats = normalizePerfectPrototypeRowsetModeStats(parallel?.rejectionSummary?.rowsetModeStats)
  const manifestRowsetModeStats = normalizePerfectPrototypeRowsetModeStats(parallelManifest?.rowsetModeStats)
  for (const key of PERFECT_PROTOTYPE_ROWSET_MODE_STAT_STRING_KEYS) {
    assert.equal(
      String(mergedRowsetModeStats[key] ?? ""),
      String(expectedRowsetModeStats[key] ?? ""),
      `parallel.rejectionSummary.rowsetModeStats.${key} mismatch`,
    )
    assert.equal(
      String(manifestRowsetModeStats[key] ?? ""),
      String(expectedRowsetModeStats[key] ?? ""),
      `parallel_manifest.rowsetModeStats.${key} mismatch`,
    )
  }
  for (const key of PERFECT_PROTOTYPE_ROWSET_MODE_STAT_NUMERIC_KEYS) {
    assertNumericMatch(
      `parallel.rejectionSummary.rowsetModeStats.${key}`,
      mergedRowsetModeStats[key],
      expectedRowsetModeStats[key],
    )
    assertNumericMatch(
      `parallel_manifest.rowsetModeStats.${key}`,
      manifestRowsetModeStats[key],
      expectedRowsetModeStats[key],
    )
  }

  const lowBudgetDir = path.join(rootDir, "parallel_low_budget")
  const lowBudgetProbe = await runParallelWithLiveProgressProbe({
    cwd,
    indexDir,
    outDir: lowBudgetDir,
    options: {
      trainStartDate: "2024-01-02",
      trainEndDate: "2024-01-15",
      minHitCount: 1,
      maxGapTradingDays: 100000,
      maxRuleSize: 6,
      maxSeedTokens: 4000,
      maxRules: 4000,
      maxSearchStates: 31,
      maxRejectedRuleSamples: 1000,
      searchStateCacheMaxBytes: 32 * 1024,
      orderingHeadWindow: 8,
      workers: 2,
    },
    pollIntervalMs: 100,
  })
  const lowBudgetProgress = lowBudgetProbe.finalProgress
  assert(lowBudgetProgress, "Low-budget parallel smoke missing progress.json")
  const launchedWaveDirs = await listWaveOutputDirs(lowBudgetDir)
  const lowBudgetConfiguredMaxSearchStates = Number(
    lowBudgetProgress?.parallelConfiguredMaxSearchStates ?? 0,
  )
  assert(
    Number.isInteger(lowBudgetConfiguredMaxSearchStates) && lowBudgetConfiguredMaxSearchStates >= 100,
    `Low-budget parallel smoke configuredMaxSearchStates should honor predictive clamp: ${lowBudgetConfiguredMaxSearchStates}`,
  )
  if (lowBudgetProbe.failure instanceof Error) {
    assert.match(
      String(lowBudgetProbe.failure?.message ?? ""),
      /leased chunk search-state budget|at least one search state per remaining chunk|worker exceeded its allocated search-state budget|local_budget_exact_stop|actual_budget_overrun|global_budget_exhausted/i,
    )
    assert(
      Number(lowBudgetProgress?.parallelRemainingSearchBudget ?? 0) >= 0,
      `Low-budget fail-fast smoke reported a negative remaining global budget: ${Number(lowBudgetProgress?.parallelRemainingSearchBudget ?? 0)}`,
    )
  } else {
    assert.equal(
      String(lowBudgetProgress?.phase ?? ""),
      "completed",
      "Low-budget parallel smoke should either fail-fast or complete within the leased global budget",
    )
    assert(
      Number(lowBudgetProgress?.exploredStates ?? 0) <= lowBudgetConfiguredMaxSearchStates,
      `Low-budget completed run exceeded configured global budget: exploredStates=${Number(lowBudgetProgress?.exploredStates ?? 0)} configuredMaxSearchStates=${lowBudgetConfiguredMaxSearchStates}`,
    )
    assert(
      Number(lowBudgetProgress?.parallelRemainingSearchBudget ?? 0) >= 0,
      "Low-budget completed run reported a negative remaining global budget",
    )
  }

  const summary = {
    status: "ok",
    rootDir,
    indexedChampionRuleId: indexedCatalog.champion?.ruleId ?? null,
    parallelChampionRuleId: parallel.catalog?.champion?.ruleId ?? null,
    indexedRuleCount: Array.isArray(indexedCatalog.rules) ? indexedCatalog.rules.length : 0,
    parallelRuleCount: Array.isArray(parallel.rules) ? parallel.rules.length : 0,
    parallelMemoEvictedBucketCount: Number(parallel?.rejectionSummary?.memoEvictedBucketCount ?? 0),
    parallelOrderingNegativeLoads: Number(parallel?.rejectionSummary?.orderingNegativeLoads ?? 0),
    parallelOrderingHeadWindow: Number(parallel?.rejectionSummary?.orderingHeadWindow ?? 0),
    parallelOrderingHeadExactLoads: Number(parallel?.rejectionSummary?.orderingHeadExactLoads ?? 0),
    parallelOrderingHeadRerankMs: Number(parallel?.rejectionSummary?.orderingHeadRerankMs ?? 0),
    observedRuleCount: Number(parallel?.rejectionSummary?.observedRuleCount ?? 0),
    liveCanonicalRuleCount: Number(parallel?.rejectionSummary?.liveCanonicalRuleCount ?? 0),
    finalSelectedRuleCount: Number(parallel?.rejectionSummary?.finalSelectedRuleCount ?? 0),
    partialMergePeakBucketCount: Number(parallel?.rejectionSummary?.partialMergePeakBucketCount ?? 0),
    partialMergePeakLiveRuleCount: Number(parallel?.rejectionSummary?.partialMergePeakLiveRuleCount ?? 0),
    partialMergeEvictedByHitFloorCount: Number(parallel?.rejectionSummary?.partialMergeEvictedByHitFloorCount ?? 0),
    partialMergeTieBandRuleCount: Number(parallel?.rejectionSummary?.partialMergeTieBandRuleCount ?? 0),
    partialMergeTieBandBucketCount: Number(
      parallel?.rejectionSummary?.partialMergeTieBandBucketCount ?? 0,
    ),
    partialMergePeakTieBandRuleCount: Number(
      parallel?.rejectionSummary?.partialMergePeakTieBandRuleCount ?? 0,
    ),
    partialMergeCompactedBucketCount: Number(
      parallel?.rejectionSummary?.partialMergeCompactedBucketCount ?? 0,
    ),
    partialMergeCompactedRuleCount: Number(
      parallel?.rejectionSummary?.partialMergeCompactedRuleCount ?? 0,
    ),
    memoFrontierScanCount: Number(parallel?.rejectionSummary?.memoFrontierScanCount ?? 0),
    memoFrontierDeleteCount: Number(parallel?.rejectionSummary?.memoFrontierDeleteCount ?? 0),
    memoFrontierSkippedBucketCount: Number(
      parallel?.rejectionSummary?.memoFrontierSkippedBucketCount ?? 0,
    ),
    memoFrontierCompactionCount: Number(
      parallel?.rejectionSummary?.memoFrontierCompactionCount ?? 0,
    ),
    memoFrontierBucketCount: Number(parallel?.rejectionSummary?.memoFrontierBucketCount ?? 0),
    memoFrontierTombstoneCount: Number(
      parallel?.rejectionSummary?.memoFrontierTombstoneCount ?? 0,
    ),
    memoPositiveSignatureBucketCount: Number(
      parallel?.rejectionSummary?.memoPositiveSignatureBucketCount ?? 0,
    ),
    memoFingerprintBucketPeak: Number(parallel?.rejectionSummary?.memoFingerprintBucketPeak ?? 0),
    memoEvictedFrontierEntryCount: Number(
      parallel?.rejectionSummary?.memoEvictedFrontierEntryCount ?? 0,
    ),
    memoRangeSkipPrefixCount: Number(
      parallel?.rejectionSummary?.memoRangeSkipPrefixCount ?? 0,
    ),
    memoRangeSkipSuffixCount: Number(
      parallel?.rejectionSummary?.memoRangeSkipSuffixCount ?? 0,
    ),
    memoRangeSummaryRebuildCount: Number(
      parallel?.rejectionSummary?.memoRangeSummaryRebuildCount ?? 0,
    ),
    memoExactFingerprintFastHitCount: Number(
      parallel?.rejectionSummary?.memoExactFingerprintFastHitCount ?? 0,
    ),
    memoExactFingerprintScanCount: Number(
      parallel?.rejectionSummary?.memoExactFingerprintScanCount ?? 0,
    ),
    memoFingerprintMetadataRebuildCount: Number(
      parallel?.rejectionSummary?.memoFingerprintMetadataRebuildCount ?? 0,
    ),
    rowsetBorrowHitCount: Number(parallel?.rejectionSummary?.rowsetBorrowHitCount ?? 0),
    rowsetBorrowMissCount: Number(parallel?.rejectionSummary?.rowsetBorrowMissCount ?? 0),
    rowsetOwnedAllocCount: Number(parallel?.rejectionSummary?.rowsetOwnedAllocCount ?? 0),
    rowsetFinalizeCount: Number(parallel?.rejectionSummary?.rowsetFinalizeCount ?? 0),
    sparseKernelMode: String(parallel?.rejectionSummary?.sparseKernelMode ?? ""),
    parallelChunkCount: Number(parallel?.rejectionSummary?.parallelChunkCount ?? 0),
    parallelWaveCount: Number(parallel?.rejectionSummary?.parallelWaveCount ?? 0),
    parallelCompletedChunkCount: Number(
      parallel?.rejectionSummary?.parallelCompletedChunkCount ?? 0,
    ),
    parallelCompletedWaveCount: Number(
      parallel?.rejectionSummary?.parallelCompletedWaveCount ?? 0,
    ),
    parallelGlobalKthHitFloor: Number(
      parallel?.rejectionSummary?.parallelGlobalKthHitFloor ?? 0,
    ),
    parallelFloorSeededChunkCount: Number(
      parallel?.rejectionSummary?.parallelFloorSeededChunkCount ?? 0,
    ),
    parallelWaveMergeMs: Number(parallel?.rejectionSummary?.parallelWaveMergeMs ?? 0),
    parallelChunkPlannerImbalanceRatio: Number(
      parallel?.rejectionSummary?.parallelChunkPlannerImbalanceRatio ?? 0,
    ),
    parallelActiveProgressLiveSampleCount: Number(
      parallel?.rejectionSummary?.parallelActiveProgressLiveSampleCount ?? 0,
    ),
    parallelReadyQueueDepth: Number(parallel?.rejectionSummary?.parallelReadyQueueDepth ?? 0),
    parallelDispatchCount: Number(parallel?.rejectionSummary?.parallelDispatchCount ?? 0),
    parallelImmediateRefillCount: Number(
      parallel?.rejectionSummary?.parallelImmediateRefillCount ?? 0,
    ),
    parallelLiveFloorUpdateCount: Number(
      parallel?.rejectionSummary?.parallelLiveFloorUpdateCount ?? 0,
    ),
    parallelLiveFloorRevision: Number(
      parallel?.rejectionSummary?.parallelLiveFloorRevision ?? 0,
    ),
    parallelFirstGlobalFloorElapsedMs: Number(
      parallel?.rejectionSummary?.parallelFirstGlobalFloorElapsedMs ?? 0,
    ),
    parallelActiveAllocatedSearchBudget: Number(
      parallel?.rejectionSummary?.parallelActiveAllocatedSearchBudget ?? 0,
    ),
    parallelActiveEffectiveAllocatedSearchBudget: Number(
      parallel?.rejectionSummary?.parallelActiveEffectiveAllocatedSearchBudget ?? 0,
    ),
    parallelBudgetTopupCount: Number(
      parallel?.rejectionSummary?.parallelBudgetTopupCount ?? 0,
    ),
    parallelBudgetTopupSearchStates: Number(
      parallel?.rejectionSummary?.parallelBudgetTopupSearchStates ?? 0,
    ),
    parallelSlotIdleMs: Number(parallel?.rejectionSummary?.parallelSlotIdleMs ?? 0),
    sparseSparseIntersectionMs: Number(
      parallel?.rejectionSummary?.sparseSparseIntersectionMs ?? 0,
    ),
    sparseBitmapIntersectionMs: Number(
      parallel?.rejectionSummary?.sparseBitmapIntersectionMs ?? 0,
    ),
    sparseEqualSizeMergeCount: Number(
      parallel?.rejectionSummary?.sparseEqualSizeMergeCount ?? 0,
    ),
    sparseAdaptiveGallopCount: Number(
      parallel?.rejectionSummary?.sparseAdaptiveGallopCount ?? 0,
    ),
    sparseCountFastPathCount: Number(
      parallel?.rejectionSummary?.sparseCountFastPathCount ?? 0,
    ),
    sparseBitmapWordRunCount: Number(
      parallel?.rejectionSummary?.sparseBitmapWordRunCount ?? 0,
    ),
    sparseBitmapSkippedRunCount: Number(
      parallel?.rejectionSummary?.sparseBitmapSkippedRunCount ?? 0,
    ),
    sparseBitmapPartialRunCount: Number(
      parallel?.rejectionSummary?.sparseBitmapPartialRunCount ?? 0,
    ),
    sparseBitmapFullRunHitCount: Number(
      parallel?.rejectionSummary?.sparseBitmapFullRunHitCount ?? 0,
    ),
    bitmapKernelMode: String(parallel?.rejectionSummary?.bitmapKernelMode ?? ""),
    bitmapDenseDenseCount: Number(parallel?.rejectionSummary?.bitmapDenseDenseCount ?? 0),
    bitmapIntersectionMs: Number(parallel?.rejectionSummary?.bitmapIntersectionMs ?? 0),
    bitmapMaterializeMs: Number(parallel?.rejectionSummary?.bitmapMaterializeMs ?? 0),
    bitmapEdgeSummaryMs: Number(parallel?.rejectionSummary?.bitmapEdgeSummaryMs ?? 0),
    lowBudgetFailFastMessage: String(lowBudgetProbe.failure?.message ?? ""),
  }
  await writeJson(path.join(rootDir, "parallel_equivalence_summary.json"), summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
