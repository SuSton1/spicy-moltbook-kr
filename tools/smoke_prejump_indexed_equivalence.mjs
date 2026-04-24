import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"
import { minePerfectPrototypes } from "../src/lib/perfect_prototype_miner.mjs"
import { minePerfectPrototypeIndexed } from "../src/lib/perfect_prototype_indexed_miner.mjs"
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
import { normalizePerfectPrototypeRow } from "../src/lib/perfect_prototype_tokenizer.mjs"

const TYPED_WRAPPER_SCHEMA_COLUMNS = new Set(
  PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA.map(({ name }) => String(name ?? "").trim()).filter(Boolean),
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

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const buildDateKeys = () => {
  const out = []
  const cursor = new Date("2024-01-02T00:00:00Z")
  while (out.length < 12) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) {
      out.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

const fixtureRows = () => {
  const dateKeys = buildDateKeys()
  const rows = []
  const baseMarketContext = {
    candidateCount: 12,
    uniqueSymbolCount: 12,
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
  }

  const makeRow = ({
    index,
    symbol,
    hit,
    tagA,
    tagB,
    bodyPct,
    rangePct,
    volumeRatio20,
    valueRatio20,
    runUp10,
    closeOverMa20,
    closeOverMa120,
    ret40,
    seq40Last,
    seq150Last,
  }) => ({
    sourceType: "perfect_prototype_prejump_pack",
    sourceId: `fixture_${String(index + 1).padStart(2, "0")}`,
    symbol,
    dateKey: dateKeys[index],
    decisionDateKey: dateKeys[index],
    asOfDateKey: dateKeys[index],
    strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
    contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    featureVec: {
      "candle.bodyPct": bodyPct,
      "candle.rangePct": rangePct,
      "volume.ratio20": volumeRatio20,
      "volume.valueRatio20": valueRatio20,
      "trend.runUp10": runUp10,
      "trend.closeOverMa20": closeOverMa20,
      "trend.closeOverMa120": closeOverMa120,
    },
    globalFeatureVec: {
      ret40,
    },
    marketContextVec: {
      ...baseMarketContext,
    },
    xsecEventVec: {
      bodyRankPct: hit ? 0.84 : 0.33,
      rangeRankPct: hit ? 0.82 : 0.41,
      volumeRankPct: hit ? 0.88 : 0.29,
      valueRatioRankPct: hit ? 0.8 : 0.35,
      runUp10RankPct: hit ? 0.9 : 0.31,
      ret40RankPct: hit ? 0.77 : 0.38,
      bodyVsMedian: bodyPct - baseMarketContext.bodyPctMedian,
      rangeVsMedian: rangePct - baseMarketContext.rangePctMedian,
      volumeVsMedian: volumeRatio20 - baseMarketContext.volumeRatio20Median,
      valueRatioVsMedian: valueRatio20 - baseMarketContext.valueRatio20Median,
      runUp10VsMedian: runUp10 - baseMarketContext.runUp10Median,
      ret40VsMedian: ret40 - baseMarketContext.ret40Median,
      isolationScore: 1 / 12,
    },
    contextualTokens: uniqueSorted(
      [
        "tag:test:fixture",
        tagA ? "tag:test:signal:A" : null,
        tagB ? "tag:test:signal:B" : null,
      ].filter(Boolean),
    ),
    seq40: [0.01, 0.02, 0.03, seq40Last],
    seq150: [0.01, 0.015, 0.02, 0.03, seq150Last],
    outcomeHitTarget: hit,
  })

  const positiveSpecs = [
    { symbol: "100001", hit: true, tagA: true, tagB: true, bodyPct: 0.041, rangePct: 0.072, volumeRatio20: 1.12, valueRatio20: 1.07, runUp10: 0.18, closeOverMa20: 0.06, closeOverMa120: 0.03, ret40: 0.12, seq40Last: 0.05, seq150Last: 0.06 },
    { symbol: "100002", hit: true, tagA: true, tagB: true, bodyPct: 0.043, rangePct: 0.073, volumeRatio20: 1.09, valueRatio20: 1.08, runUp10: 0.17, closeOverMa20: 0.05, closeOverMa120: 0.02, ret40: 0.11, seq40Last: 0.04, seq150Last: 0.05 },
    { symbol: "100003", hit: true, tagA: true, tagB: true, bodyPct: 0.042, rangePct: 0.071, volumeRatio20: 1.11, valueRatio20: 1.05, runUp10: 0.19, closeOverMa20: 0.05, closeOverMa120: 0.03, ret40: 0.13, seq40Last: 0.05, seq150Last: 0.06 },
    { symbol: "100004", hit: true, tagA: true, tagB: true, bodyPct: 0.039, rangePct: 0.069, volumeRatio20: 1.08, valueRatio20: 1.06, runUp10: 0.16, closeOverMa20: 0.04, closeOverMa120: 0.02, ret40: 0.1, seq40Last: 0.04, seq150Last: 0.05 },
    { symbol: "100005", hit: true, tagA: true, tagB: true, bodyPct: 0.044, rangePct: 0.074, volumeRatio20: 1.13, valueRatio20: 1.09, runUp10: 0.18, closeOverMa20: 0.06, closeOverMa120: 0.03, ret40: 0.12, seq40Last: 0.05, seq150Last: 0.06 },
    { symbol: "100006", hit: true, tagA: true, tagB: true, bodyPct: 0.04, rangePct: 0.07, volumeRatio20: 1.1, valueRatio20: 1.07, runUp10: 0.17, closeOverMa20: 0.05, closeOverMa120: 0.03, ret40: 0.11, seq40Last: 0.04, seq150Last: 0.05 },
  ]

  const negativeSpecs = [
    { symbol: "200001", hit: false, tagA: true, tagB: false, bodyPct: 0.031, rangePct: 0.067, volumeRatio20: 1.07, valueRatio20: 1.03, runUp10: 0.14, closeOverMa20: 0.04, closeOverMa120: 0.02, ret40: 0.09, seq40Last: 0.03, seq150Last: 0.04 },
    { symbol: "200002", hit: false, tagA: true, tagB: false, bodyPct: 0.032, rangePct: 0.066, volumeRatio20: 1.06, valueRatio20: 1.02, runUp10: 0.13, closeOverMa20: 0.04, closeOverMa120: 0.02, ret40: 0.09, seq40Last: 0.03, seq150Last: 0.04 },
    { symbol: "200003", hit: false, tagA: false, tagB: true, bodyPct: 0.029, rangePct: 0.064, volumeRatio20: 1.05, valueRatio20: 1.01, runUp10: 0.12, closeOverMa20: 0.03, closeOverMa120: 0.01, ret40: 0.08, seq40Last: 0.03, seq150Last: 0.04 },
    { symbol: "200004", hit: false, tagA: false, tagB: true, bodyPct: 0.03, rangePct: 0.065, volumeRatio20: 1.04, valueRatio20: 1.02, runUp10: 0.12, closeOverMa20: 0.03, closeOverMa120: 0.01, ret40: 0.08, seq40Last: 0.03, seq150Last: 0.04 },
  ]

  positiveSpecs.concat(negativeSpecs).forEach((spec, index) => {
    rows.push(makeRow({ index, ...spec }))
  })
  return rows
}

const normalizeTokenizerSpec = (spec) => ({
  surface: spec?.surface ?? null,
  options: {
    surfaceName: spec?.options?.surfaceName ?? null,
    binCount: Number(spec?.options?.binCount ?? 0),
    includeSymbolToken: spec?.options?.includeSymbolToken === true,
    includeMissingTokens: spec?.options?.includeMissingTokens === true,
    includeCategoricalTokens: spec?.options?.includeCategoricalTokens !== false,
    includeFeaturePrefixes: uniqueSorted(spec?.options?.includeFeaturePrefixes ?? []),
    excludeFeaturePrefixes: uniqueSorted(spec?.options?.excludeFeaturePrefixes ?? []),
  },
  numericFeatures: (Array.isArray(spec?.numericFeatures) ? spec.numericFeatures : []).map((entry) => ({
    featureKey: entry.featureKey,
    edges: Array.isArray(entry.edges) ? entry.edges : [],
    count: Number(entry.count ?? 0),
    min: Number(entry.min),
    max: Number(entry.max),
  })),
})

const normalizeRule = (rule) => ({
  ruleId: rule?.ruleId ?? null,
  tokens: uniqueSorted(rule?.tokens ?? []),
  trainHitCount: Number(rule?.trainHitCount ?? 0),
  trainMatchCount: Number(rule?.trainMatchCount ?? 0),
  trainNegativeCount: Number(rule?.trainNegativeCount ?? 0),
  maxGapTradingDays: Number(rule?.maxGapTradingDays ?? 0),
  ruleSize: Number(rule?.ruleSize ?? 0),
})

const normalizeMatches = (rows) =>
  (Array.isArray(rows) ? rows : []).map((row) => ({
    sourceType: row?.sourceType ?? null,
    sourceId: row?.sourceId ?? null,
    dateKey: row?.dateKey ?? null,
    symbol: row?.symbol ?? null,
    outcomeHitTarget: row?.outcomeHitTarget === true,
    matchedRuleIds: uniqueSorted(row?.matchedRuleIds ?? []),
    matchedRuleCount: Number(row?.matchedRuleCount ?? 0),
    primaryRuleId: row?.primaryRuleId ?? null,
  }))

const normalizeCoverage = (coverage) => ({
  matchedPositiveRows: Number(coverage?.matchedPositiveRows ?? 0),
  totalPositiveRows: Number(coverage?.totalPositiveRows ?? 0),
  positiveCoverageRate: Number(coverage?.positiveCoverageRate ?? 0),
  matchedDateCount: Number(coverage?.matchedDateCount ?? 0),
  matchedSymbolCount: Number(coverage?.matchedSymbolCount ?? 0),
  firstHitDate: coverage?.firstHitDate ?? null,
  lastHitDate: coverage?.lastHitDate ?? null,
  maxGapTradingDays: Number(coverage?.maxGapTradingDays ?? 0),
})

const main = async () => {
  const cwd = process.cwd()
  const runId = `perfect_proto_prejump_indexed_equivalence_${toRunId()}`
  const rootDir = path.join(cwd, "artifacts", "checks", runId)
  const packDir = path.join(rootDir, "pack")
  const legacyDir = path.join(rootDir, "legacy")
  const indexDir = path.join(rootDir, "index")
  const indexedDir = path.join(rootDir, "indexed")
  await ensureDir(packDir)
  await ensureDir(legacyDir)
  await ensureDir(indexDir)
  await ensureDir(indexedDir)

  const sourceRows = fixtureRows()
  const miningOptions = {
    surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    minHitCount: 6,
    maxGapTradingDays: 100000,
    maxRuleSize: 6,
    maxSeedTokens: 4000,
    maxRules: 4000,
    maxSearchStates: 20000000,
    rowProjectedCandidateThreshold: 0,
  }

  const legacy = minePerfectPrototypes({
    rows: sourceRows,
    options: miningOptions,
  })

  const wrappers = legacy.rows.map((row, rowOrdinal) =>
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
  const packSummary = {
    storageFormat: "parquet",
    rowCount: wrappers.length,
    outputCoverage: {
      minDateKey: legacy.rows[0]?.dateKey ?? null,
      maxDateKey: legacy.rows[legacy.rows.length - 1]?.dateKey ?? null,
    },
    truncatedByLimitRows: false,
    coverageComplete: true,
    contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  }
  const packManifest = {
    strategyMode: PREJUMP_PREDICTIVE_STRATEGY_MODE,
    contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    rowCount: wrappers.length,
    inputPath: parquetPath,
    summary: packSummary,
  }
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
  await writeJson(path.join(packDir, "summary.json"), packSummary)
  await writeJson(path.join(packDir, "manifest.json"), packManifest)

  await buildPerfectPrototypeTokenIndex({
    cwd,
    inputPath: parquetPath,
    outDir: indexDir,
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    },
  })
  const indexManifest = await readJson(path.join(indexDir, "manifest.json"))
  assert.equal(indexManifest?.tokenPostingsTableStreamMode, "delimited")
  assert.equal(Number(indexManifest?.tokenPostingsRowsStreamed ?? -1), Number(indexManifest?.tokenPostingCount ?? -2))
  assert.equal(
    Number(indexManifest?.tokenPostingsOutputSinkStats?.outputSinkRows ?? -1),
    Number(indexManifest?.tokenPostingCount ?? -2),
  )
  assert.ok(Number(indexManifest?.tokenPostingsTableStreamMs ?? -1) >= 0)

  const indexed = await minePerfectPrototypeIndexed({
    cwd,
    indexDir,
    outDir: indexedDir,
    options: miningOptions,
  })

  const comparisons = {
    tokenizerSpec: {
      legacy: normalizeTokenizerSpec(legacy.tokenizerSpec),
      indexed: normalizeTokenizerSpec(indexed.tokenizerSpec),
    },
    rules: {
      legacy: legacy.rules.map(normalizeRule),
      indexed: indexed.rules.map(normalizeRule),
    },
    championRuleId: {
      legacy: legacy.catalog?.champion?.ruleId ?? null,
      indexed: indexed.catalog?.champion?.ruleId ?? null,
    },
    matches: {
      legacy: normalizeMatches(legacy.matches),
      indexed: normalizeMatches(indexed.matches),
    },
    dedupedMatches: {
      legacy: normalizeMatches(legacy.dedupedMatches),
      indexed: normalizeMatches(indexed.dedupedMatches),
    },
    coverage: {
      legacy: normalizeCoverage(legacy.coverage),
      indexed: normalizeCoverage(indexed.coverage),
    },
  }

  assert.deepStrictEqual(comparisons.tokenizerSpec.indexed, comparisons.tokenizerSpec.legacy)
  assert.deepStrictEqual(comparisons.rules.indexed, comparisons.rules.legacy)
  assert.deepStrictEqual(comparisons.championRuleId.indexed, comparisons.championRuleId.legacy)
  assert.deepStrictEqual(comparisons.matches.indexed, comparisons.matches.legacy)
  assert.deepStrictEqual(comparisons.dedupedMatches.indexed, comparisons.dedupedMatches.legacy)
  assert.deepStrictEqual(comparisons.coverage.indexed, comparisons.coverage.legacy)

  const summary = {
    status: "ok",
    rootDir,
    surface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    rowCount: wrappers.length,
    legacyRuleCount: legacy.rules.length,
    indexedRuleCount: indexed.rules.length,
    championRuleId: legacy.catalog?.champion?.ruleId ?? null,
  }
  await writeJson(path.join(rootDir, "equivalence_summary.json"), summary)
  await writeJson(path.join(rootDir, "equivalence_compare.json"), comparisons)
  await fsp.writeFile(path.join(rootDir, "SUCCESS"), "ok\n", "utf8")
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
