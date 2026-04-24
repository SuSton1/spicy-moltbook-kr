import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import path from "node:path"

import { toRunId } from "../src/lib/io.mjs"
import {
  buildPerfectPrototypeStepbExactIndex,
  resolvePerfectPrototypeStepbExactIndexPaths,
} from "../src/lib/perfect_prototype_stepb_exact_index.mjs"
import { resolvePerfectPrototypeDuckdbCli } from "../src/lib/perfect_prototype_duckdb.mjs"
import { loadPerfectPrototypeIndexedRowMeta } from "../src/lib/perfect_prototype_indexed_miner.mjs"
import { loadPerfectPrototypeRowTokenAdjacency } from "../src/lib/perfect_prototype_row_token_index.mjs"
import { streamPerfectPrototypeTokenDictionaryEntries } from "../src/lib/perfect_prototype_token_index.mjs"
import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
} from "../src/lib/perfect_prototype_prejump_contract.mjs"

const makeBaseVectors = () => ({
  featureVec: {
    "candle.bodyPct": 0.04,
    "candle.rangePct": 0.07,
    "volume.ratio20": 1.1,
    "volume.valueRatio20": 1.05,
    "trend.runUp10": 0.18,
    "trend.closeOverMa20": 0.05,
    "trend.closeOverMa120": 0.02,
  },
  globalFeatureVec: {
    ret40: 0.11,
  },
  marketContextVec: {
    candidateCount: 32,
    uniqueSymbolCount: 32,
    bodyPctMedian: 0.03,
    rangePctMedian: 0.065,
    volumeRatio20Median: 1.08,
    valueRatio20Median: 1.04,
    runUp10Median: 0.12,
    ret40Median: 0.1,
    positiveBodyShare: 0.72,
    wideRangeShare: 0.35,
    elevatedVolumeShare: 0.42,
    closeOverMa20Share: 0.83,
    closeOverMa120Share: 0.67,
  },
  xsecEventVec: {
    bodyRankPct: 0.8,
    rangeRankPct: 0.8,
    volumeRankPct: 0.8,
    valueRatioRankPct: 0.8,
    runUp10RankPct: 0.8,
    ret40RankPct: 0.8,
    bodyVsMedian: 0.01,
    rangeVsMedian: 0.005,
    volumeVsMedian: 0.02,
    valueRatioVsMedian: 0.01,
    runUp10VsMedian: 0.06,
    ret40VsMedian: 0.01,
    isolationScore: 1 / 32,
  },
  seq40: [0.01, 0.02, 0.03, 0.04],
  seq150: [0.01, 0.015, 0.02, 0.03, 0.04],
})

const buildFixtureRows = () => [
  {
    sourceType: "perfect_prototype_open_eval_pack",
    sourceId: "exact_index_row_token_positive_01",
    symbol: "100001",
    dateKey: "2024-01-02",
    contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    stepALaneId: "same_day_high8",
    impulseLookbackDays: 0,
    ...makeBaseVectors(),
    contextualTokens: ["tag:test:fixture", "tag:test:cluster_a"],
    eventOutcome: { hitTarget: true },
  },
  {
    sourceType: "perfect_prototype_open_eval_pack",
    sourceId: "exact_index_row_token_positive_02",
    symbol: "100002",
    dateKey: "2024-01-03",
    contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    stepALaneId: "recent_impulse_1d",
    impulseLookbackDays: 1,
    ...makeBaseVectors(),
    contextualTokens: ["tag:test:fixture", "tag:test:cluster_b"],
    eventOutcome: { hitTarget: true },
  },
  {
    sourceType: "perfect_prototype_open_eval_pack",
    sourceId: "exact_index_row_token_negative_01",
    symbol: "200001",
    dateKey: "2024-01-04",
    contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    stepALaneId: "recent_impulse_2d",
    impulseLookbackDays: 2,
    ...makeBaseVectors(),
    contextualTokens: ["tag:test:fixture", "tag:test:cluster_a", "tag:test:negative"],
    eventOutcome: { hitTarget: false },
  },
]

const main = async () => {
  const outDir = path.join(
    process.cwd(),
    "artifacts",
    "checks",
    `stepb_exact_index_row_token_artifacts_${toRunId(new Date())}`,
  )
  const rows = buildFixtureRows()
  await fsp.rm(outDir, { recursive: true, force: true })
  await fsp.mkdir(outDir, { recursive: true })
  const inputPath = path.join(outDir, "fixture_input.jsonl")
  await fsp.writeFile(inputPath, rows.map((row) => JSON.stringify(row)).join("\n"))
  const built = await buildPerfectPrototypeStepbExactIndex({
    cwd: process.cwd(),
    rows,
    outDir,
    inputPath,
    inputSha256: "0".repeat(64),
    surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      searchMode: "exact_indexed_kernel_v1",
      minHitCount: 1,
      maxRuleSize: 3,
      maxSeedTokens: 32,
      maxRules: 32,
      maxSearchStates: 128,
    },
  })

  const paths = resolvePerfectPrototypeStepbExactIndexPaths(outDir)
  const manifest = built.manifest
  assert.equal(typeof manifest.rowTokenOffsetsBinPath, "string")
  assert.equal(typeof manifest.rowTokenIdsBinPath, "string")
  assert.equal(typeof manifest.rowLaneMetaParquetPath, "string")
  assert.ok(manifest.rowTokenIdWidthBits === 16 || manifest.rowTokenIdWidthBits === 32)
  assert.ok(Number(manifest.tokenPostingCount) > 0)
  await fsp.access(paths.rowTokenOffsetsBinPath)
  await fsp.access(paths.rowTokenIdsBinPath)
  await fsp.access(paths.rowLaneMetaParquetPath)

  const adjacency = await loadPerfectPrototypeRowTokenAdjacency({
    rowTokenOffsetsPath: paths.rowTokenOffsetsBinPath,
    rowTokenIdsPath: paths.rowTokenIdsBinPath,
    rowCount: manifest.rowCount,
    tokenPostingCount: manifest.tokenPostingCount,
    tokenIdWidthBits: manifest.rowTokenIdWidthBits,
  })
  assert.equal(adjacency.rowTokenOffsets.length, manifest.rowCount + 1)
  assert.equal(adjacency.rowTokenIds.length, manifest.tokenPostingCount)

  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd: process.cwd() })
  const rowMeta = await loadPerfectPrototypeIndexedRowMeta({
    cwd: process.cwd(),
    duckdb,
    rowMetaPath: paths.rowMetaParquetPath,
    rowLaneMetaPath: paths.rowLaneMetaParquetPath,
    manifest,
    summary: built.summary,
    requireLaneMeta: true,
  })
  assert.deepEqual(rowMeta.rowStepALaneIds, ["same_day_high8", "recent_impulse_1d", "recent_impulse_2d"])
  assert.deepEqual(rowMeta.rowImpulseLookbackDays, [0, 1, 2])
  const positiveCounts = new Uint32Array(manifest.tokenCount)
  const negativeCounts = new Uint32Array(manifest.tokenCount)
  for (let rowIndex = 0; rowIndex < rowMeta.rowCount; rowIndex += 1) {
    const tokenStart = Number(adjacency.rowTokenOffsets[rowIndex] ?? 0)
    const tokenEnd = Number(adjacency.rowTokenOffsets[rowIndex + 1] ?? tokenStart)
    const outcome = rowMeta.rowOutcomeHitTargets[rowIndex]
    for (let offset = tokenStart; offset < tokenEnd; offset += 1) {
      const tokenId = Number(adjacency.rowTokenIds[offset] ?? -1)
      if (outcome === true) {
        positiveCounts[tokenId] += 1
      } else if (outcome === false) {
        negativeCounts[tokenId] += 1
      }
    }
  }
  let tokenId = 0
  await streamPerfectPrototypeTokenDictionaryEntries({
    cwd: process.cwd(),
    duckdb,
    tokenDictionaryParquetPath: paths.tokenDictionaryParquetPath,
    onRow: async (row) => {
      assert.equal(
        Number(positiveCounts[tokenId] ?? -1),
        Number(row?.positiveCount ?? -2),
        `row adjacency positive count mismatch for tokenId=${tokenId} token=${String(row?.token ?? "")}`,
      )
      assert.equal(
        Number(negativeCounts[tokenId] ?? -1),
        Number(row?.negativeCount ?? -2),
        `row adjacency negative count mismatch for tokenId=${tokenId} token=${String(row?.token ?? "")}`,
      )
      tokenId += 1
    },
  })
  assert.equal(tokenId, manifest.tokenCount)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
