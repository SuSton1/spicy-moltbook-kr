import assert from "node:assert/strict"
import path from "node:path"

import { ensureDir, iterateJsonl, readJson } from "../src/lib/io.mjs"
import {
  createDuckdbStructuredToParquetSink,
  resolvePerfectPrototypeDuckdbCli,
} from "../src/lib/perfect_prototype_duckdb.mjs"
import { minePerfectPrototypeIndexed } from "../src/lib/perfect_prototype_indexed_miner.mjs"
import { minePerfectPrototypeParallelIndexed } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"
import { buildPerfectPrototypeTypedParquetWrapperRow } from "../src/lib/perfect_prototype_parquet_io.mjs"
import { splitPerfectPrototypePrejumpPackIntoFeatureStore } from "../src/lib/perfect_prototype_prejump_feature_store.mjs"
import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
} from "../src/lib/perfect_prototype_prejump_contract.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import { PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA } from "../src/lib/perfect_prototype_structured_sink_schemas.mjs"
import { buildCanonicalPerfectPrototypeTokenizerCacheInputs } from "../src/lib/perfect_prototype_tokenizer_contract.mjs"
import { buildPerfectPrototypePartitionedTokenIndexFromFeatureStore } from "../src/lib/perfect_prototype_token_index_merge.mjs"

const TYPED_WRAPPER_SCHEMA_COLUMNS = new Set(
  PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA.map(({ name }) => String(name ?? "").trim()).filter(
    Boolean,
  ),
)

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

const toRunId = () => {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, "0")
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "_",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("")
}

const projectRowToSchema = (row, schemaColumns) => {
  const next = {}
  for (const columnName of schemaColumns) {
    next[columnName] = row?.[columnName]
  }
  return next
}

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const buildTradingDateKeys = (count) => {
  const out = []
  const cursor = new Date("2024-01-02T00:00:00Z")
  while (out.length < count) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) {
      out.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

const buildPositiveTopupFixtureRows = () => {
  const dateKeys = buildTradingDateKeys(24)
  const totalRowCount = 24
  const baseMarketContext = {
    candidateCount: 18,
    uniqueSymbolCount: 18,
    bodyPctMedian: 0.031,
    rangePctMedian: 0.061,
    volumeRatio20Median: 1.06,
    valueRatio20Median: 1.03,
    runUp10Median: 0.14,
    ret40Median: 0.09,
    positiveBodyShare: 0.58,
    wideRangeShare: 0.34,
    elevatedVolumeShare: 0.39,
    closeOverMa20Share: 0.66,
    closeOverMa120Share: 0.48,
  }
  const familySpecs = [
    {
      family: "alpha_breakout",
      hit: true,
      tagA: true,
      tagB: true,
      tagC: true,
      bodyPct: 0.046,
      rangePct: 0.083,
      volumeRatio20: 1.22,
      valueRatio20: 1.18,
      runUp10: 0.23,
      closeOverMa20: 0.08,
      closeOverMa120: 0.06,
      ret40: 0.17,
    },
    {
      family: "beta_coil",
      hit: true,
      tagA: true,
      tagB: false,
      tagC: true,
      bodyPct: 0.041,
      rangePct: 0.075,
      volumeRatio20: 1.15,
      valueRatio20: 1.12,
      runUp10: 0.2,
      closeOverMa20: 0.06,
      closeOverMa120: 0.05,
      ret40: 0.15,
    },
    {
      family: "gamma_impulse",
      hit: true,
      tagA: false,
      tagB: true,
      tagC: true,
      bodyPct: 0.044,
      rangePct: 0.081,
      volumeRatio20: 1.19,
      valueRatio20: 1.14,
      runUp10: 0.22,
      closeOverMa20: 0.07,
      closeOverMa120: 0.05,
      ret40: 0.16,
    },
    {
      family: "delta_squeeze",
      hit: true,
      tagA: false,
      tagB: false,
      tagC: true,
      bodyPct: 0.039,
      rangePct: 0.071,
      volumeRatio20: 1.13,
      valueRatio20: 1.1,
      runUp10: 0.19,
      closeOverMa20: 0.05,
      closeOverMa120: 0.04,
      ret40: 0.145,
    },
    {
      family: "alpha_falsebreak",
      hit: false,
      tagA: true,
      tagB: true,
      tagC: false,
      bodyPct: 0.034,
      rangePct: 0.067,
      volumeRatio20: 1.07,
      valueRatio20: 1.04,
      runUp10: 0.16,
      closeOverMa20: 0.04,
      closeOverMa120: 0.02,
      ret40: 0.095,
    },
    {
      family: "beta_overhead",
      hit: false,
      tagA: true,
      tagB: false,
      tagC: false,
      bodyPct: 0.031,
      rangePct: 0.064,
      volumeRatio20: 1.05,
      valueRatio20: 1.02,
      runUp10: 0.15,
      closeOverMa20: 0.03,
      closeOverMa120: 0.01,
      ret40: 0.085,
    },
    {
      family: "gamma_illiquid",
      hit: false,
      tagA: false,
      tagB: true,
      tagC: false,
      bodyPct: 0.03,
      rangePct: 0.063,
      volumeRatio20: 1.04,
      valueRatio20: 1.01,
      runUp10: 0.145,
      closeOverMa20: 0.03,
      closeOverMa120: 0.01,
      ret40: 0.082,
    },
    {
      family: "delta_drift",
      hit: false,
      tagA: false,
      tagB: false,
      tagC: false,
      bodyPct: 0.028,
      rangePct: 0.061,
      volumeRatio20: 1.02,
      valueRatio20: 1,
      runUp10: 0.135,
      closeOverMa20: 0.02,
      closeOverMa120: 0.01,
      ret40: 0.078,
    },
  ]
  const rows = []
  for (let cycleIndex = 0; cycleIndex < 3; cycleIndex += 1) {
    for (const [familyIndex, spec] of familySpecs.entries()) {
      const rowIndex = rows.length
      const microShift = cycleIndex * 0.0015 + familyIndex * 0.0002
      const symbolPrefix = spec.hit ? "3" : "4"
      rows.push({
        sourceType: "perfect_prototype_prejump_pack",
        sourceId: `positive_topup_fixture_${String(rowIndex + 1).padStart(2, "0")}`,
        symbol: `${symbolPrefix}${String(rowIndex + 1).padStart(5, "0")}`,
        dateKey: dateKeys[rowIndex],
        decisionDateKey: dateKeys[rowIndex],
        asOfDateKey: dateKeys[rowIndex],
        strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
        contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
        featureVec: {
          "candle.bodyPct": spec.bodyPct + microShift,
          "candle.rangePct": spec.rangePct + microShift,
          "volume.ratio20": spec.volumeRatio20 + cycleIndex * 0.03,
          "volume.valueRatio20": spec.valueRatio20 + cycleIndex * 0.025,
          "trend.runUp10": spec.runUp10 + cycleIndex * 0.015,
          "trend.closeOverMa20": spec.closeOverMa20 + cycleIndex * 0.01,
          "trend.closeOverMa120": spec.closeOverMa120 + cycleIndex * 0.008,
        },
        globalFeatureVec: {
          ret40: spec.ret40 + cycleIndex * 0.01,
        },
        marketContextVec: {
          ...baseMarketContext,
          candidateCount: baseMarketContext.candidateCount + cycleIndex,
          uniqueSymbolCount: baseMarketContext.uniqueSymbolCount + cycleIndex,
          positiveBodyShare: baseMarketContext.positiveBodyShare + (spec.hit ? 0.04 : -0.03),
          elevatedVolumeShare:
            baseMarketContext.elevatedVolumeShare + (spec.tagC ? 0.05 : -0.04),
        },
        xsecEventVec: {
          bodyRankPct: spec.hit ? 0.82 - cycleIndex * 0.03 : 0.36 - cycleIndex * 0.02,
          rangeRankPct: spec.hit ? 0.8 - cycleIndex * 0.03 : 0.34 - cycleIndex * 0.02,
          volumeRankPct: spec.hit ? 0.84 - cycleIndex * 0.025 : 0.33 - cycleIndex * 0.02,
          valueRatioRankPct: spec.hit ? 0.79 - cycleIndex * 0.025 : 0.35 - cycleIndex * 0.02,
          runUp10RankPct: spec.hit ? 0.86 - cycleIndex * 0.02 : 0.32 - cycleIndex * 0.02,
          ret40RankPct: spec.hit ? 0.78 - cycleIndex * 0.02 : 0.37 - cycleIndex * 0.02,
          bodyVsMedian: spec.bodyPct + microShift - baseMarketContext.bodyPctMedian,
          rangeVsMedian: spec.rangePct + microShift - baseMarketContext.rangePctMedian,
          volumeVsMedian:
            spec.volumeRatio20 + cycleIndex * 0.03 - baseMarketContext.volumeRatio20Median,
          valueRatioVsMedian:
            spec.valueRatio20 + cycleIndex * 0.025 - baseMarketContext.valueRatio20Median,
          runUp10VsMedian: spec.runUp10 + cycleIndex * 0.015 - baseMarketContext.runUp10Median,
          ret40VsMedian: spec.ret40 + cycleIndex * 0.01 - baseMarketContext.ret40Median,
          isolationScore: 1 / totalRowCount,
        },
        categoricalTokens: uniqueSorted([
          "tag:test:positive-topup",
          `tag:test:family:${spec.family}`,
          `tag:test:cycle:${cycleIndex + 1}`,
          `tag:test:block:${familyIndex % 4}`,
          spec.tagA ? "tag:test:alpha" : "tag:test:no-alpha",
          spec.tagB ? "tag:test:beta" : "tag:test:no-beta",
          spec.tagC ? "tag:test:coil" : "tag:test:no-coil",
          spec.hit ? "tag:test:hit-cluster" : "tag:test:miss-cluster",
        ]),
        numericFeatureMap: {
          "candle.bodyPct": spec.bodyPct + microShift,
          "candle.rangePct": spec.rangePct + microShift,
          "volume.ratio20": spec.volumeRatio20 + cycleIndex * 0.03,
          "volume.valueRatio20": spec.valueRatio20 + cycleIndex * 0.025,
          "trend.runUp10": spec.runUp10 + cycleIndex * 0.015,
          "trend.closeOverMa20": spec.closeOverMa20 + cycleIndex * 0.01,
          "trend.closeOverMa120": spec.closeOverMa120 + cycleIndex * 0.008,
          ret40: spec.ret40 + cycleIndex * 0.01,
        },
        seq40: [0.01, 0.02 + cycleIndex * 0.005, 0.03, spec.ret40 + cycleIndex * 0.01],
        seq150: [0.01, 0.015, 0.02, 0.03 + cycleIndex * 0.005, spec.ret40 + cycleIndex * 0.01],
        outcomeHitTarget: spec.hit,
        targetDateKey: dateKeys[rowIndex],
      })
    }
  }
  return rows
}

const writePackParquet = async ({ cwd, duckdb, packPath, rows }) => {
  const sink = await createDuckdbStructuredToParquetSink({
    cwd,
    duckdb,
    parquetPath: packPath,
    schema: PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
    sessionOverrides: {
      preserveInsertionOrder: true,
    },
  })
  try {
    let rowOrdinal = 0
    for (const row of rows) {
      await sink.writeRow(
        projectRowToSchema(
          buildPerfectPrototypeTypedParquetWrapperRow({
            rowOrdinal,
            row,
          }),
          TYPED_WRAPPER_SCHEMA_COLUMNS,
        ),
      )
      rowOrdinal += 1
    }
  } finally {
    await sink.close()
  }
}

const buildPositiveTopupFixtureIndex = async ({ cwd, serverPolicy }) => {
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const runId = `perfect_proto_parallel_slot_positive_topup_commit_${toRunId()}`
  const rootDir = path.join(cwd, "artifacts", "checks", runId)
  const packDir = path.join(rootDir, "pack")
  const featureStoreDir = path.join(rootDir, "feature_store")
  const workspaceDir = path.join(rootDir, "workspace")
  const indexDir = path.join(rootDir, "index")
  const packPath = path.join(packDir, "prejump_pack.parquet")
  const rows = buildPositiveTopupFixtureRows()
  const startDate = String(rows[0]?.dateKey ?? "").trim()
  const endDate = String(rows[rows.length - 1]?.dateKey ?? "").trim()
  assert(startDate && endDate, "Positive top-up persistent-slot smoke fixture requires valid date keys")
  await ensureDir(rootDir)
  await ensureDir(packDir)
  await ensureDir(featureStoreDir)
  await ensureDir(workspaceDir)
  await ensureDir(indexDir)
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "rootDir", filePath: rootDir },
      { label: "packDir", filePath: packDir },
      { label: "featureStoreDir", filePath: featureStoreDir },
      { label: "workspaceDir", filePath: workspaceDir },
      { label: "indexDir", filePath: indexDir },
    ],
    policy: serverPolicy,
    toolName: "smoke_prejump_parallel_slot_positive_topup_commit",
  })
  await writePackParquet({
    cwd,
    duckdb,
    packPath,
    rows,
  })
  await splitPerfectPrototypePrejumpPackIntoFeatureStore({
    cwd,
    inputPackPath: packPath,
    inputPackSummary: {
      requestedDecisionRange: {
        from: startDate,
        to: endDate,
      },
      effectiveDecisionCoverage: {
        from: startDate,
        to: endDate,
        count: rows.length,
      },
      outputCoverage: {
        from: startDate,
        to: endDate,
        count: rows.length,
      },
    },
    inputPackSummaryPath: path.join(packDir, "prejump_pack.summary.json"),
    featureStoreDir,
    overwriteExisting: true,
  })
  await buildPerfectPrototypePartitionedTokenIndexFromFeatureStore({
    cwd,
    featureStoreDir,
    startDate,
    endDate,
    workspaceDir,
    outDir: indexDir,
    options: {
      ...buildCanonicalPerfectPrototypeTokenizerCacheInputs(),
    },
  })
  return {
    rootDir,
    indexDir,
    trainStartDate: startDate,
    trainEndDate: endDate,
  }
}

const main = async () => {
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "smoke_prejump_parallel_slot_positive_topup_commit",
  })
  const fixture = await buildPositiveTopupFixtureIndex({
    cwd,
    serverPolicy,
  })
  const rootDir = fixture.rootDir
  const indexDir = fixture.indexDir
  const indexedDir = path.join(rootDir, "indexed_positive_topup_commit")
  const parallelDir = path.join(rootDir, "parallel_slot_positive_topup_commit")

  const sharedOptions = {
    trainStartDate: fixture.trainStartDate,
    trainEndDate: fixture.trainEndDate,
    minHitCount: 2,
    maxGapTradingDays: 100000,
    maxRuleSize: 6,
    maxSeedTokens: 4000,
    maxRules: 4000,
    // This control-plane smoke still needs a tight budget so request/grant/commit
    // traffic occurs, but it must also leave enough exact-search headroom for the
    // current diversified seed contract and exact-safe search path to complete.
    maxSearchStates: 128,
    maxRejectedRuleSamples: 1000,
    searchStateCacheMaxBytes: 32 * 1024,
    orderingHeadWindow: 8,
  }

  const indexed = await minePerfectPrototypeIndexed({
    cwd,
    indexDir,
    outDir: indexedDir,
    options: sharedOptions,
  })
  assert(indexed, "Positive top-up persistent-slot smoke indexed baseline did not return a result")
  const indexedSummary = await readJson(path.join(indexedDir, "summary.json"), null)
  assert(indexedSummary, "Positive top-up persistent-slot smoke missing indexed summary")
  assert.equal(
    indexedSummary?.rejectionSummary?.truncatedByMaxSearchStates,
    false,
    "Positive top-up persistent-slot smoke requires an exact indexed baseline under the shared maxSearchStates budget",
  )

  const parallel = await minePerfectPrototypeParallelIndexed({
    cwd,
    indexDir,
    outDir: parallelDir,
    options: {
      ...sharedOptions,
      workers: 2,
      externalBudgetRequestHeadroomStates: 1,
      externalBudgetRequestSearchStates: 8,
      externalBudgetRequestWaitMs: 10000,
    },
  })
  assert(parallel, "Positive top-up persistent-slot smoke parallel run did not return a result")

  const indexedCatalog = await readJson(path.join(indexedDir, "catalog.json"), null)
  const indexedCoverage = await readJson(path.join(indexedDir, "coverage.json"), null)
  const indexedMatches = await readJsonlRows(path.join(indexedDir, "matches.jsonl"))
  const indexedDeduped = await readJsonlRows(path.join(indexedDir, "deduped_matches.jsonl"))
  const parallelManifest = await readJson(path.join(parallelDir, "parallel_manifest.json"), null)
  assert(parallelManifest, "Positive top-up persistent-slot smoke missing parallel manifest")
  assert.equal(Number(parallelManifest?.version ?? 0), 14)
  assert.equal(Number(parallelManifest?.parallelWorkerSpawnCount ?? 0), 2)
  assert(Number(parallelManifest?.parallelWorkerSlotReuseCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelBudgetRequestCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelBudgetGrantCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelBudgetCommitRequestCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelBudgetCommitCount ?? 0) > 0)
  assert(Number(parallelManifest?.parallelBudgetTopupCount ?? 0) > 0)

  const chunkRuns = Array.isArray(parallelManifest?.chunkRuns) ? parallelManifest.chunkRuns : []
  const topupChunkRuns = chunkRuns.filter(
    (chunkRun) => Number(chunkRun?.topupAllocatedSearchStates ?? 0) > 0,
  )
  assert(
    topupChunkRuns.length > 0,
    "Positive top-up persistent-slot smoke expected at least one committed top-up chunk",
  )
  for (const chunkRun of topupChunkRuns) {
    const workerSummary = await readJson(String(chunkRun?.summaryPath ?? ""), null)
    assert(
      workerSummary,
      `Positive top-up persistent-slot smoke missing worker summary: ${chunkRun?.summaryPath}`,
    )
    const rejectionSummary = workerSummary?.rejectionSummary ?? {}
    assert(Number(rejectionSummary?.externalBudgetAppliedCount ?? 0) > 0)
    assert(Number(rejectionSummary?.externalBudgetAllowanceAppliedCount ?? 0) > 0)
    assert(Number(rejectionSummary?.externalBudgetAllowanceSeenCount ?? 0) > 0)
    assert(Number(rejectionSummary?.externalBudgetAllowanceConsumedCount ?? 0) > 0)
    assert(Number(rejectionSummary?.externalBudgetCommitRequestCount ?? 0) > 0)
    assert(Number(rejectionSummary?.externalBudgetCommitRevision ?? 0) > 0)
    assert(
      Number(rejectionSummary?.effectiveAllocatedMaxSearchStates ?? 0) >
        Number(rejectionSummary?.allocatedMaxSearchStates ?? 0),
    )
  }

  assert.equal(
    parallel.catalog?.champion?.ruleId ?? null,
    indexedCatalog?.champion?.ruleId ?? null,
  )
  assert.deepStrictEqual(normalizeCoverage(parallel.coverage), normalizeCoverage(indexedCoverage))
  assert.deepStrictEqual(
    (parallel.matches ?? []).map(normalizeMatchRow),
    indexedMatches.map(normalizeMatchRow),
  )
  assert.deepStrictEqual(
    (parallel.dedupedMatches ?? []).map(normalizeMatchRow),
    indexedDeduped.map(normalizeMatchRow),
  )

  console.log(
    JSON.stringify(
      {
        status: "ok",
        rootDir,
        indexedExploredStates: Number(indexedSummary?.exploredStates ?? 0),
        parallelWorkerSpawnCount: Number(parallelManifest?.parallelWorkerSpawnCount ?? 0),
        parallelWorkerSlotReuseCount: Number(parallelManifest?.parallelWorkerSlotReuseCount ?? 0),
        parallelBudgetRequestCount: Number(parallelManifest?.parallelBudgetRequestCount ?? 0),
        parallelBudgetGrantCount: Number(parallelManifest?.parallelBudgetGrantCount ?? 0),
        parallelBudgetPendingCount: Number(parallelManifest?.parallelBudgetPendingCount ?? 0),
        parallelBudgetPendingActiveReclaimCount: Number(
          parallelManifest?.parallelBudgetPendingActiveReclaimCount ?? 0,
        ),
        parallelBudgetCommitRequestCount: Number(
          parallelManifest?.parallelBudgetCommitRequestCount ?? 0,
        ),
        parallelBudgetCommitCount: Number(parallelManifest?.parallelBudgetCommitCount ?? 0),
        parallelBudgetTopupCount: Number(parallelManifest?.parallelBudgetTopupCount ?? 0),
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
