import assert from "node:assert/strict"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"
import {
  minePerfectPrototypeIndexed,
} from "../src/lib/perfect_prototype_indexed_miner.mjs"
import {
  preparePerfectPrototypeMiningRows,
} from "../src/lib/perfect_prototype_miner.mjs"
import {
  buildPerfectPrototypeTypedParquetWrapperRow,
} from "../src/lib/perfect_prototype_parquet_io.mjs"
import {
  createDuckdbStructuredToParquetSink,
  resolvePerfectPrototypeDuckdbCli,
} from "../src/lib/perfect_prototype_duckdb.mjs"
import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
} from "../src/lib/perfect_prototype_prejump_contract.mjs"
import { buildPerfectPrototypeTokenIndex } from "../src/lib/perfect_prototype_token_index.mjs"
import { PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA } from "../src/lib/perfect_prototype_structured_sink_schemas.mjs"

const TYPED_WRAPPER_SCHEMA_COLUMNS = new Set(
  PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA.map(({ name }) => String(name ?? "").trim()).filter(
    Boolean,
  ),
)

const SIGNAL_SEED = "tag:test:signal:seed"
const SIGNAL_A = "tag:test:signal:A"
const SIGNAL_B = "tag:test:signal:B"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const projectRowToSchema = (row, schemaColumns) => {
  const next = {}
  for (const columnName of schemaColumns) {
    next[columnName] = row?.[columnName]
  }
  return next
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
    String(now.getUTCMilliseconds()).padStart(3, "0"),
    String(process.pid).padStart(5, "0"),
  ].join("")
}

const buildDateKeys = (count) => {
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

const fixtureRows = () => {
  const rows = []
  const dateKeys = buildDateKeys(64)
  let index = 0
  const pushRow = ({ symbol, outcomeHitTarget, contextualTokens }) => {
    const dateKey = dateKeys[index]
    rows.push({
      sourceType: "perfect_prototype_prejump_pack",
      sourceId: `fixture_${String(index + 1).padStart(3, "0")}`,
      symbol,
      dateKey,
      decisionDateKey: dateKey,
      asOfDateKey: dateKey,
      strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
      contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      ...makeBaseVectors(),
      contextualTokens: uniqueSorted(["tag:test:fixture", ...contextualTokens]),
      outcomeHitTarget,
    })
    index += 1
  }

  for (let ordinal = 1; ordinal <= 6; ordinal += 1) {
    pushRow({
      symbol: `100${String(ordinal).padStart(3, "0")}`,
      outcomeHitTarget: true,
      contextualTokens: [SIGNAL_SEED, SIGNAL_A, SIGNAL_B],
    })
  }
  for (let ordinal = 1; ordinal <= 14; ordinal += 1) {
    pushRow({
      symbol: `200${String(ordinal).padStart(3, "0")}`,
      outcomeHitTarget: true,
      contextualTokens: [SIGNAL_SEED],
    })
    pushRow({
      symbol: `300${String(ordinal).padStart(3, "0")}`,
      outcomeHitTarget: true,
      contextualTokens: [SIGNAL_A],
    })
    pushRow({
      symbol: `400${String(ordinal).padStart(3, "0")}`,
      outcomeHitTarget: true,
      contextualTokens: [SIGNAL_B],
    })
  }
  pushRow({
    symbol: "900001",
    outcomeHitTarget: false,
    contextualTokens: [SIGNAL_SEED, SIGNAL_A],
  })
  pushRow({
    symbol: "900002",
    outcomeHitTarget: false,
    contextualTokens: [SIGNAL_SEED, SIGNAL_B],
  })
  pushRow({
    symbol: "900003",
    outcomeHitTarget: false,
    contextualTokens: [SIGNAL_A, SIGNAL_B],
  })
  return rows
}

const assertFeatureContributionEntry = (entry, label) => {
  assert(String(entry?.contributionKey ?? "").trim().length > 0, `${label} missing contributionKey`)
  assert(Number(entry?.selectionCount ?? -1) >= 0, `${label} missing selectionCount`)
  assert(Number(entry?.acceptedCount ?? -1) >= 0, `${label} missing acceptedCount`)
  assert(Number(entry?.exactRuleCount ?? -1) >= 0, `${label} missing exactRuleCount`)
  assert(Number(entry?.totalCostMs ?? -1) >= 0, `${label} missing totalCostMs`)
}

const main = async () => {
  const cwd = process.cwd()
  const runId = `perfect_proto_feature_row_contribution_diagnostics_${toRunId()}`
  const rootDir = path.join(cwd, "artifacts", "checks", runId)
  const packDir = path.join(rootDir, "pack")
  const indexDir = path.join(rootDir, "index")
  const outDir = path.join(rootDir, "indexed")
  await ensureDir(packDir)
  await ensureDir(indexDir)
  await ensureDir(outDir)

  const sourceRows = fixtureRows()
  const prepared = preparePerfectPrototypeMiningRows({
    rows: sourceRows,
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      minHitCount: 6,
      maxGapTradingDays: 100000,
      maxRuleSize: 6,
      maxSeedTokens: 4000,
      maxRules: 4000,
      maxSearchStates: 200000,
      maxRejectedRuleSamples: 1000,
    },
  })
  const wrappers = prepared.rows.map((row, rowOrdinal) =>
    projectRowToSchema(
      buildPerfectPrototypeTypedParquetWrapperRow({
        rowOrdinal,
        row: {
          ...row,
          asOfDateKey: row.asOfDateKey || row.dateKey,
          targetDateKey: row.eventOutcome?.entryDateKey ?? null,
          strategyMode: row.strategyMode ?? PREJUMP_PREDICTIVE_STRATEGY_MODE,
          contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
        },
      }),
      TYPED_WRAPPER_SCHEMA_COLUMNS,
    ),
  )

  const parquetPath = path.join(packDir, "prejump_pack.parquet")
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const wrapperSink = await createDuckdbStructuredToParquetSink({
    cwd,
    duckdb,
    parquetPath,
    schema: PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
  })
  try {
    await wrapperSink.writeRows(wrappers)
    await wrapperSink.close()
  } catch (error) {
    await wrapperSink.abort()
    throw error
  }

  await buildPerfectPrototypeTokenIndex({
    cwd,
    inputPath: parquetPath,
    outDir: indexDir,
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    },
  })

  const indexed = await minePerfectPrototypeIndexed({
    cwd,
    indexDir,
    outDir,
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      minHitCount: 6,
      maxGapTradingDays: 100000,
      maxRuleSize: 6,
      maxSeedTokens: 4000,
      maxRules: 4000,
      maxSearchStates: 200000,
      maxRejectedRuleSamples: 1000,
    },
  })

  const progress = await readJson(path.join(outDir, "progress.json"))
  const summary = await readJson(path.join(outDir, "summary.json"))
  const rejectionSummary = summary?.rejectionSummary ?? indexed?.rejectionSummary ?? null
  assert(rejectionSummary, "Feature/row contribution diagnostics smoke missing rejectionSummary")

  const telemetrySources = [rejectionSummary, progress]
  for (const [index, payload] of telemetrySources.entries()) {
    const label = `feature/row contribution diagnostics payload[${index}]`
    assert(
      Number(payload?.featureContributionTrackedFeatureCount ?? 0) > 0,
      `${label} expected tracked feature contributions`,
    )
    assert(
      Array.isArray(payload?.featureContributionTopSelection) &&
        payload.featureContributionTopSelection.length > 0,
      `${label} expected featureContributionTopSelection`,
    )
    assert(
      Array.isArray(payload?.featureContributionTopCost) &&
        payload.featureContributionTopCost.length > 0,
      `${label} expected featureContributionTopCost`,
    )
    payload.featureContributionTopSelection.forEach((entry, entryIndex) => {
      assertFeatureContributionEntry(entry, `${label} featureContributionTopSelection[${entryIndex}]`)
    })
    payload.featureContributionTopCost.forEach((entry, entryIndex) => {
      assertFeatureContributionEntry(entry, `${label} featureContributionTopCost[${entryIndex}]`)
    })
    assert(payload?.rowContributionProfile, `${label} missing rowContributionProfile`)
    assert.equal(
      Number(payload?.rowContributionProfile?.rowCount ?? -1),
      prepared.rows.length,
      `${label} rowContributionProfile.rowCount mismatch`,
    )
    assert(
      Number(payload?.rowContributionProfile?.positiveRowCount ?? 0) > 0,
      `${label} expected positiveRowCount`,
    )
    assert(
      Number(payload?.rowContributionProfile?.negativeRowCount ?? 0) > 0,
      `${label} expected negativeRowCount`,
    )
    assert(
      Array.isArray(payload?.rowContributionTopExactSymbols),
      `${label} missing rowContributionTopExactSymbols`,
    )
    assert(
      Array.isArray(payload?.rowContributionTopSampledNegativeSymbols),
      `${label} missing rowContributionTopSampledNegativeSymbols`,
    )
  }

  assert(
    rejectionSummary.rowContributionTopExactSymbols.length > 0 ||
      rejectionSummary.rowContributionTopSampledNegativeSymbols.length > 0,
    "Feature/row contribution diagnostics smoke expected at least one populated row contribution leaderboard",
  )

  const smokeSummary = {
    status: "ok",
    rootDir,
    trackedFeatureCount: Number(rejectionSummary.featureContributionTrackedFeatureCount ?? 0),
    topSelectionKey: rejectionSummary.featureContributionTopSelection[0]?.contributionKey ?? null,
    topCostKey: rejectionSummary.featureContributionTopCost[0]?.contributionKey ?? null,
    rowCount: Number(rejectionSummary.rowContributionProfile?.rowCount ?? 0),
    exactSymbolCount: Number(rejectionSummary.rowContributionTopExactSymbols?.length ?? 0),
    sampledNegativeSymbolCount: Number(
      rejectionSummary.rowContributionTopSampledNegativeSymbols?.length ?? 0,
    ),
  }
  await writeJson(path.join(rootDir, "feature_row_contribution_diagnostics_summary.json"), smokeSummary)
  console.log(JSON.stringify(smokeSummary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
