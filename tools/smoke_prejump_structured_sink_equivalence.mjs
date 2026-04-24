#!/usr/bin/env node
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import fsp from "node:fs/promises"

import {
  buildDelimitedSelectSqlFromSchema,
  createDuckdbStructuredToParquetSink,
  resolvePerfectPrototypeDuckdbCli,
  runPerfectPrototypeDuckdbSql,
  streamParquetQueryDelimitedRows,
} from "../src/lib/perfect_prototype_duckdb.mjs"
import {
  buildPerfectPrototypeTypedParquetWrapperRow,
  unwrapPerfectPrototypeTypedParquetWrapperRow,
} from "../src/lib/perfect_prototype_parquet_io.mjs"
import {
  PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
} from "../src/lib/perfect_prototype_structured_sink_schemas.mjs"
import { collectPerfectPrototypeTokenizerFeatureStatsRows } from "../src/lib/perfect_prototype_token_index.mjs"
import {
  writePerfectPrototypeFeatureValuesSidecar,
  streamPerfectPrototypeFeatureValueIndexRows,
} from "../src/lib/perfect_prototype_feature_values_sidecar.mjs"
import {
  PERFECT_PROTOTYPE_PARTIAL_RULES_FILENAME,
  streamPerfectPrototypePartialRulesParquet,
  writePerfectPrototypePartialRulesParquet,
} from "../src/lib/perfect_prototype_partial_rule_codec.mjs"

const sqlQuote = (value) => `'${String(value ?? "").replace(/'/g, "''")}'`

const main = async () => {
  const cwd = process.cwd()
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "perfect_proto_structured_sink_"))
  const previousPrimarySinkMode = process.env.PREJUMP_PRIMARY_SINK_MODE
  const previousFeatureStoreSinkMode = process.env.PREJUMP_FEATURE_STORE_SINK_MODE
  const previousPartialRuleSinkMode = process.env.PREJUMP_PARTIAL_RULE_SINK_MODE
  process.env.PREJUMP_PRIMARY_SINK_MODE = "structured"
  process.env.PREJUMP_FEATURE_STORE_SINK_MODE = "structured"
  process.env.PREJUMP_PARTIAL_RULE_SINK_MODE = "structured"
  try {
    const wrapperParquetPath = path.join(tempDir, "wrapper.parquet")
    const wrapperSink = await createDuckdbStructuredToParquetSink({
      cwd,
      duckdb,
      parquetPath: wrapperParquetPath,
      schema: PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
      sessionOverrides: {
        preserveInsertionOrder: true,
      },
    })
    const expectedRows = [
      {
        sourceType: "perfect_prototype_prejump_pack",
        sourceId: "AAA:2026-01-02",
        symbol: "AAA",
        dateKey: "2026-01-02",
        asOfDateKey: "2026-01-02",
        strategyMode: "PREJUMP_PREDICTIVE_V1",
        featureVec: { f1: 1.5, f2: -0.25 },
        globalFeatureVec: { g1: 2.25 },
        eventFeatureVec: { e1: 0.75 },
        marketContextVec: { m1: 3.5 },
        xsecEventVec: { x1: -1.25 },
        seq40: [{ c: 1 }, { c: 2 }],
        seq150: [{ c: 3 }],
        outcomeHitTarget: true,
        eventOutcome: { hitTarget: true, exitReason: "TARGET" },
        raw: null,
        categoricalTokens: ["tag:a", "tag:b"],
        numericFeatureMap: { alpha: 1.5, beta: -2.5, gamma: 1.25 },
        name: "Alpha",
        targetDateKey: "2026-01-05",
        contextSurface: "v5_prejump_contextual",
      },
      {
        sourceType: "perfect_prototype_prejump_pack",
        sourceId: "BBB:2026-01-03",
        symbol: "BBB",
        dateKey: "2026-01-03",
        asOfDateKey: "2026-01-03",
        strategyMode: "PREJUMP_PREDICTIVE_V1",
        featureVec: {},
        globalFeatureVec: {},
        eventFeatureVec: {},
        marketContextVec: {},
        xsecEventVec: {},
        seq40: [],
        seq150: [],
        outcomeHitTarget: false,
        eventOutcome: { hitTarget: false, exitReason: "STOP" },
        raw: null,
        categoricalTokens: [],
        numericFeatureMap: { alpha: 4.5, beta: 7.0, gamma: 7.0 },
        name: "Beta",
        targetDateKey: "2026-01-06",
        contextSurface: "v5_prejump_contextual",
      },
    ]
    await wrapperSink.writeRows(
      expectedRows.map((row, rowOrdinal) =>
        buildPerfectPrototypeTypedParquetWrapperRow({
          rowOrdinal,
          row,
        }),
      ),
    )
    await wrapperSink.close()

    const actualRows = []
    await streamParquetQueryDelimitedRows({
      cwd,
      duckdb,
      parquetPath: wrapperParquetPath,
      schema: PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
      selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA),
      orderBySql: "rowOrdinal",
      onRow: async (row) => {
        actualRows.push(unwrapPerfectPrototypeTypedParquetWrapperRow(row))
      },
    })
    assert.deepStrictEqual(actualRows, expectedRows)

    const legacyTypedWrapperParquetPath = path.join(tempDir, "legacy_typed_wrapper.parquet")
    await runPerfectPrototypeDuckdbSql({
      cwd,
      duckdb,
      sql: `
COPY (
  SELECT
    CAST(0 AS BIGINT) AS rowOrdinal,
    'perfect_prototype_prejump_pack' AS sourceType,
    'AAA:2026-01-02' AS sourceId,
    'AAA' AS symbol,
    '2026-01-02' AS dateKey,
    '2026-01-02' AS asOfDateKey,
    'PREJUMP_PREDICTIVE_V1' AS strategyMode,
    {'f1': 1.5, 'f2': -0.25} AS featureVec,
    {'g1': 2.25} AS globalFeatureVec,
    {'e1': 0.75} AS eventFeatureVec,
    {'m1': 3.5} AS marketContextVec,
    {'x1': -1.25} AS xsecEventVec,
    [{'c': 1}, {'c': 2}] AS seq40,
    [{'c': 3}] AS seq150,
    true AS outcomeHitTarget,
    {'hitTarget': true, 'exitReason': 'TARGET'} AS eventOutcome,
    NULL AS raw,
    ['tag:a', 'tag:b'] AS categoricalTokens,
    MAP(['alpha', 'beta', 'gamma'], [1.5, -2.5, 1.25]) AS numericFeatureMap,
    'Alpha' AS name,
    '2026-01-05' AS targetDateKey,
    'v5_prejump_contextual' AS contextSurface
) TO ${sqlQuote(legacyTypedWrapperParquetPath)} (
  FORMAT PARQUET,
  COMPRESSION ZSTD
);
`,
    })
    const legacyTypedRows = []
    await streamParquetQueryDelimitedRows({
      cwd,
      duckdb,
      parquetPath: legacyTypedWrapperParquetPath,
      schema: PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
      selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA),
      orderBySql: "rowOrdinal",
      onRow: async (row) => {
        legacyTypedRows.push(unwrapPerfectPrototypeTypedParquetWrapperRow(row))
      },
    })
    assert.deepStrictEqual(legacyTypedRows, [expectedRows[0]])

    const tokenizerFeatureStatsRows = await collectPerfectPrototypeTokenizerFeatureStatsRows({
      cwd,
      duckdb,
      inputPaths: [wrapperParquetPath],
      binCount: 4,
    })
    const tokenizerFeatureSummary = Object.fromEntries(
      tokenizerFeatureStatsRows.map((row) => [String(row?.featureKey ?? ""), Number(row?.count ?? 0)]),
    )
    assert.equal(tokenizerFeatureSummary.alpha, 2)
    assert.equal(tokenizerFeatureSummary.beta, 2)
    assert.equal(tokenizerFeatureSummary.gamma, 2)

    const partialRulesDir = path.join(tempDir, "partial_rules")
    await fsp.mkdir(partialRulesDir, { recursive: true })
    const expectedPartialRules = [
      {
        ruleId: "rule:a",
        tokens: ["num:alpha:B01", "tag:a"],
        rank: null,
        ruleSize: 2,
        trainMatchCount: 3,
        trainHitCount: 3,
        trainNegativeCount: 1,
        precision: 1,
        maxGapTradingDays: 7,
        startGapTradingDays: 1,
        endGapTradingDays: 2,
        firstHitDate: "2026-01-02",
        lastHitDate: "2026-01-05",
        matchedSymbolCount: 2,
        matchedSymbols: ["AAA", "BBB"],
        matchedDateCount: 2,
        sampleMatchIds: ["AAA:2026-01-02"],
        matchRowIndexes: [1, 5, 9],
        positiveMatchRowIndexes: [1, 5, 9],
        negativeMatchRowIndexes: [10],
      },
    ]
    const partialRulesPath = await writePerfectPrototypePartialRulesParquet({
      cwd,
      outDir: partialRulesDir,
      rules: expectedPartialRules,
    })
    assert.equal(partialRulesPath, path.join(partialRulesDir, PERFECT_PROTOTYPE_PARTIAL_RULES_FILENAME))
    const actualPartialRules = []
    await streamPerfectPrototypePartialRulesParquet({
      cwd,
      parquetPath: partialRulesPath,
      onRule: async (rule) => {
        actualPartialRules.push(rule)
      },
    })
    assert.deepStrictEqual(actualPartialRules, expectedPartialRules)

    const featureStoreDir = path.join(tempDir, "feature_store")
    const featureValuesAccumulator = new Map([
      ["alpha", [1.5, 4.5]],
      ["beta", [-2.5]],
    ])
    await writePerfectPrototypeFeatureValuesSidecar({
      cwd,
      featureStoreDir,
      dateKey: "2026-01-02",
      accumulator: featureValuesAccumulator,
    })
    const featureValuesIndexRows = []
    await streamPerfectPrototypeFeatureValueIndexRows({
      cwd,
      indexPath: path.join(featureStoreDir, "date=2026-01-02", "feature_values_index.parquet"),
      onRow: async (row) => {
        featureValuesIndexRows.push({
          featureKey: String(row?.featureKey ?? ""),
          offset: Number(row?.offset ?? 0),
          count: Number(row?.count ?? 0),
          min: Number(row?.min ?? 0),
          max: Number(row?.max ?? 0),
        })
      },
    })
    assert.deepStrictEqual(featureValuesIndexRows, [
      {
        featureKey: "alpha",
        offset: 0,
        count: 2,
        min: 1.5,
        max: 4.5,
      },
      {
        featureKey: "beta",
        offset: 16,
        count: 1,
        min: -2.5,
        max: -2.5,
      },
    ])

    console.log(
      JSON.stringify(
        {
          wrapperRows: actualRows.length,
          tokenizerFeatureKeys: Object.keys(tokenizerFeatureSummary).sort(),
          partialRules: actualPartialRules.length,
          featureValueIndexRows: featureValuesIndexRows.length,
        },
        null,
        2,
      ),
    )
  } finally {
    if (previousPrimarySinkMode == null) {
      delete process.env.PREJUMP_PRIMARY_SINK_MODE
    } else {
      process.env.PREJUMP_PRIMARY_SINK_MODE = previousPrimarySinkMode
    }
    if (previousFeatureStoreSinkMode == null) {
      delete process.env.PREJUMP_FEATURE_STORE_SINK_MODE
    } else {
      process.env.PREJUMP_FEATURE_STORE_SINK_MODE = previousFeatureStoreSinkMode
    }
    if (previousPartialRuleSinkMode == null) {
      delete process.env.PREJUMP_PARTIAL_RULE_SINK_MODE
    } else {
      process.env.PREJUMP_PARTIAL_RULE_SINK_MODE = previousPartialRuleSinkMode
    }
    await fsp.rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
