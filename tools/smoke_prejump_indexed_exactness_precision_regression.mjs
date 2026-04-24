import assert from "node:assert/strict"
import path from "node:path"

import { ensureDir, writeJson } from "../src/lib/io.mjs"
import { minePerfectPrototypes, preparePerfectPrototypeMiningRows } from "../src/lib/perfect_prototype_miner.mjs"
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

const TYPED_WRAPPER_SCHEMA_COLUMNS = new Set(
  PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA.map(({ name }) => String(name ?? "").trim()).filter(Boolean),
)

const SIGNAL_SEED = "tag:test:signal:seed"
const SIGNAL_A = "tag:test:signal:A"
const SIGNAL_B = "tag:test:signal:B"
const CAP_ROOT = "tag:test:cap:root"
const CAP_NARROW = "tag:test:cap:narrow"

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

const fixtureMaxHitRows = () => {
  const rows = []
  const dateKeys = buildDateKeys(32)
  let index = 0
  const pushRow = ({ symbol, outcomeHitTarget, contextualTokens }) => {
    const dateKey = dateKeys[index]
    rows.push({
      sourceType: "perfect_prototype_prejump_pack",
      sourceId: `cap_fixture_${String(index + 1).padStart(3, "0")}`,
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

  for (let ordinal = 1; ordinal <= 20; ordinal += 1) {
    pushRow({
      symbol: `700${String(ordinal).padStart(3, "0")}`,
      outcomeHitTarget: true,
      contextualTokens: ordinal <= 10 ? [CAP_ROOT, CAP_NARROW] : [CAP_ROOT],
    })
  }
  for (let ordinal = 1; ordinal <= 2; ordinal += 1) {
    pushRow({
      symbol: `990${String(ordinal).padStart(3, "0")}`,
      outcomeHitTarget: false,
      contextualTokens: [CAP_NARROW],
    })
  }
  return rows
}

const countMatches = (rows, tokens) => {
  const matchRows = rows.filter((row) => tokens.every((token) => row.tokens.includes(token)))
  const positiveMatchCount = matchRows.filter((row) => row.outcomeHitTarget === true).length
  const negativeMatchCount = matchRows.filter((row) => row.outcomeHitTarget === false).length
  return {
    positiveMatchCount,
    negativeMatchCount,
    precision: positiveMatchCount / Math.max(1, positiveMatchCount + negativeMatchCount),
  }
}

const normalizeRule = (rule) => ({
  tokens: uniqueSorted(rule?.tokens ?? []),
  trainHitCount: Number(rule?.trainHitCount ?? 0),
  trainMatchCount: Number(rule?.trainMatchCount ?? 0),
  trainNegativeCount: Number(rule?.trainNegativeCount ?? 0),
  precision: Number(rule?.precision ?? 0),
})

const findRecoveredExactRule = (rules) =>
  (Array.isArray(rules) ? rules : [])
    .map(normalizeRule)
    .find(
      (rule) =>
        rule.trainHitCount === 6 &&
        rule.trainMatchCount === 6 &&
        rule.trainNegativeCount === 0 &&
        rule.tokens.length === 3 &&
        rule.tokens[0] === SIGNAL_A &&
        rule.tokens[1] === SIGNAL_B &&
        rule.tokens[2] === SIGNAL_SEED,
    )

const findRuleByTokens = (rules, expectedTokens) =>
  (Array.isArray(rules) ? rules : [])
    .map(normalizeRule)
    .find((rule) => {
      if (rule.tokens.length !== expectedTokens.length) return false
      return rule.tokens.every((token, index) => token === expectedTokens[index])
    })

const findRuleContainingTokens = (rules, expectedTokens) =>
  (Array.isArray(rules) ? rules : [])
    .map(normalizeRule)
    .find((rule) => expectedTokens.every((token) => rule.tokens.includes(token)))

const main = async () => {
  const cwd = process.cwd()
  const runId = `perfect_proto_prejump_indexed_exactness_precision_regression_${toRunId()}`
  const rootDir = path.join(cwd, "artifacts", "checks", runId)
  const packDir = path.join(rootDir, "pack")
  const indexDir = path.join(rootDir, "index")
  const outDir = path.join(rootDir, "indexed")
  const capPackDir = path.join(rootDir, "cap_pack")
  const capIndexDir = path.join(rootDir, "cap_index")
  const capOutDir = path.join(rootDir, "cap_indexed")
  await ensureDir(packDir)
  await ensureDir(indexDir)
  await ensureDir(outDir)
  await ensureDir(capPackDir)
  await ensureDir(capIndexDir)
  await ensureDir(capOutDir)

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
    },
  })

  const singletonSeed = countMatches(prepared.rows, [SIGNAL_SEED])
  const singletonA = countMatches(prepared.rows, [SIGNAL_A])
  const singletonB = countMatches(prepared.rows, [SIGNAL_B])
  const pairSeedA = countMatches(prepared.rows, [SIGNAL_SEED, SIGNAL_A])
  const pairSeedB = countMatches(prepared.rows, [SIGNAL_SEED, SIGNAL_B])
  const pairAB = countMatches(prepared.rows, [SIGNAL_A, SIGNAL_B])
  const triple = countMatches(prepared.rows, [SIGNAL_SEED, SIGNAL_A, SIGNAL_B])

  assert.deepStrictEqual(singletonSeed, { positiveMatchCount: 20, negativeMatchCount: 2, precision: 20 / 22 })
  assert.deepStrictEqual(singletonA, { positiveMatchCount: 20, negativeMatchCount: 2, precision: 20 / 22 })
  assert.deepStrictEqual(singletonB, { positiveMatchCount: 20, negativeMatchCount: 2, precision: 20 / 22 })
  assert.deepStrictEqual(pairSeedA, { positiveMatchCount: 6, negativeMatchCount: 1, precision: 6 / 7 })
  assert.deepStrictEqual(pairSeedB, { positiveMatchCount: 6, negativeMatchCount: 1, precision: 6 / 7 })
  assert.deepStrictEqual(pairAB, { positiveMatchCount: 6, negativeMatchCount: 1, precision: 6 / 7 })
  assert.deepStrictEqual(triple, { positiveMatchCount: 6, negativeMatchCount: 0, precision: 1 })
  assert.ok(pairSeedA.precision < singletonSeed.precision)
  assert.ok(pairSeedB.precision < singletonSeed.precision)
  assert.ok(pairAB.precision < singletonA.precision)

  const legacy = minePerfectPrototypes({
    rows: sourceRows,
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      minHitCount: 6,
      maxGapTradingDays: 100000,
      maxRuleSize: 6,
      maxSeedTokens: 4000,
      maxRules: 4000,
      maxSearchStates: 200000,
    },
  })
  const legacyRecoveredRule = findRecoveredExactRule(legacy.rules)
  assert.ok(
    legacyRecoveredRule,
    "Legacy miner did not recover the exact seed+A+B rule after pairwise precision regressions",
  )
  const relaxedLegacy = minePerfectPrototypes({
    rows: sourceRows,
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      minHitCount: 6,
      minTrainPrecision: 0.9,
      maxGapTradingDays: 100000,
      maxRuleSize: 6,
      maxSeedTokens: 4000,
      maxRules: 4000,
      maxSearchStates: 200000,
    },
  })
  const relaxedLegacySeed = findRuleByTokens(relaxedLegacy.rules, [SIGNAL_SEED])
  assert.deepStrictEqual(
    relaxedLegacySeed,
    {
      tokens: [SIGNAL_SEED],
      trainHitCount: 20,
      trainMatchCount: 22,
      trainNegativeCount: 2,
      precision: 20 / 22,
    },
    "Legacy miner must collect the singleton relaxed rule at precision >= 0.9",
  )

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
    },
  })

  const recoveredRule = findRecoveredExactRule(indexed.rules)
  assert.ok(
    recoveredRule,
    "Indexed miner did not recover the exact seed+A+B rule after pairwise precision regressions",
  )
  assert.deepStrictEqual(
    recoveredRule,
    legacyRecoveredRule,
    "Legacy and indexed miners must recover the same exact seed+A+B rule on the precision-regression witness",
  )

  const relaxedIndexed = await minePerfectPrototypeIndexed({
    cwd,
    indexDir,
    outDir: path.join(rootDir, "indexed_relaxed"),
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      minHitCount: 6,
      minTrainPrecision: 0.9,
      maxGapTradingDays: 100000,
      maxRuleSize: 6,
      maxSeedTokens: 4000,
      maxRules: 4000,
      maxSearchStates: 200000,
    },
  })
  const relaxedIndexedSeed = findRuleByTokens(relaxedIndexed.rules, [SIGNAL_SEED])
  assert.deepStrictEqual(
    relaxedIndexedSeed,
    relaxedLegacySeed,
    "Indexed miner must collect the same singleton relaxed rule as the legacy miner",
  )

  const capSourceRows = fixtureMaxHitRows()
  const capPrepared = preparePerfectPrototypeMiningRows({
    rows: capSourceRows,
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      minHitCount: 6,
      minTrainPrecision: 0.9,
      maxTrainHitCount: 15,
      maxGapTradingDays: 100000,
      maxRuleSize: 6,
      maxSeedTokens: 4000,
      maxRules: 4000,
      maxSearchStates: 200000,
    },
  })
  const capRoot = countMatches(capPrepared.rows, [CAP_ROOT])
  const capNarrow = countMatches(capPrepared.rows, [CAP_NARROW])
  const capConjunction = countMatches(capPrepared.rows, [CAP_ROOT, CAP_NARROW])
  assert.deepStrictEqual(capRoot, { positiveMatchCount: 20, negativeMatchCount: 0, precision: 1 })
  assert.deepStrictEqual(capNarrow, { positiveMatchCount: 10, negativeMatchCount: 2, precision: 10 / 12 })
  assert.deepStrictEqual(capConjunction, { positiveMatchCount: 10, negativeMatchCount: 0, precision: 1 })

  const capLegacy = minePerfectPrototypes({
    rows: capSourceRows,
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      minHitCount: 6,
      minTrainPrecision: 0.9,
      maxTrainHitCount: 15,
      maxGapTradingDays: 100000,
      maxRuleSize: 6,
      maxSeedTokens: 4000,
      maxRules: 4000,
      maxSearchStates: 200000,
    },
  })
  const capLegacyRootRule = findRuleByTokens(capLegacy.rules, [CAP_ROOT])
  const capLegacyRecoveredRule = findRuleContainingTokens(capLegacy.rules, [CAP_NARROW, CAP_ROOT])
  assert.equal(capLegacyRootRule, undefined, "Legacy miner must reject the 20-hit broad exact rule")
  assert.deepStrictEqual(
    capLegacyRecoveredRule && {
      trainHitCount: capLegacyRecoveredRule.trainHitCount,
      trainMatchCount: capLegacyRecoveredRule.trainMatchCount,
      trainNegativeCount: capLegacyRecoveredRule.trainNegativeCount,
      precision: capLegacyRecoveredRule.precision,
      containsCapNarrow: capLegacyRecoveredRule.tokens.includes(CAP_NARROW),
      containsCapRoot: capLegacyRecoveredRule.tokens.includes(CAP_ROOT),
    },
    {
      trainHitCount: 10,
      trainMatchCount: 10,
      trainNegativeCount: 0,
      precision: 1,
      containsCapNarrow: true,
      containsCapRoot: true,
    },
    "Legacy miner must descend past the zero-negative broad rule to recover the 10-hit child",
  )

  const capWrappers = capPrepared.rows.map((row, rowOrdinal) =>
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
  const capParquetPath = path.join(capPackDir, "prejump_cap_pack.parquet")
  const capWrapperSink = await createDuckdbStructuredToParquetSink({
    cwd,
    duckdb,
    parquetPath: capParquetPath,
    schema: PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
  })
  try {
    await capWrapperSink.writeRows(capWrappers)
    await capWrapperSink.close()
  } catch (error) {
    await capWrapperSink.abort()
    throw error
  }

  await buildPerfectPrototypeTokenIndex({
    cwd,
    inputPath: capParquetPath,
    outDir: capIndexDir,
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
    },
  })

  const capIndexed = await minePerfectPrototypeIndexed({
    cwd,
    indexDir: capIndexDir,
    outDir: capOutDir,
    options: {
      surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      minHitCount: 6,
      minTrainPrecision: 0.9,
      maxTrainHitCount: 15,
      maxGapTradingDays: 100000,
      maxRuleSize: 6,
      maxSeedTokens: 4000,
      maxRules: 4000,
      maxSearchStates: 200000,
    },
  })
  const capIndexedRootRule = findRuleByTokens(capIndexed.rules, [CAP_ROOT])
  const capIndexedRecoveredRule = findRuleContainingTokens(capIndexed.rules, [CAP_NARROW, CAP_ROOT])
  assert.equal(capIndexedRootRule, undefined, "Indexed miner must reject the 20-hit broad exact rule")
  assert.deepStrictEqual(
    capIndexedRecoveredRule && {
      trainHitCount: capIndexedRecoveredRule.trainHitCount,
      trainMatchCount: capIndexedRecoveredRule.trainMatchCount,
      trainNegativeCount: capIndexedRecoveredRule.trainNegativeCount,
      precision: capIndexedRecoveredRule.precision,
      containsCapNarrow: capIndexedRecoveredRule.tokens.includes(CAP_NARROW),
      containsCapRoot: capIndexedRecoveredRule.tokens.includes(CAP_ROOT),
    },
    capLegacyRecoveredRule && {
      trainHitCount: capLegacyRecoveredRule.trainHitCount,
      trainMatchCount: capLegacyRecoveredRule.trainMatchCount,
      trainNegativeCount: capLegacyRecoveredRule.trainNegativeCount,
      precision: capLegacyRecoveredRule.precision,
      containsCapNarrow: capLegacyRecoveredRule.tokens.includes(CAP_NARROW),
      containsCapRoot: capLegacyRecoveredRule.tokens.includes(CAP_ROOT),
    },
    "Indexed miner must recover the same 10-hit child after descending past the broad exact rule",
  )

  const summary = {
    status: "ok",
    rootDir,
    rowCount: prepared.rows.length,
    legacyRecoveredRule,
    recoveredRule,
    relaxedLegacySeed,
    relaxedIndexedSeed,
    capLegacyRecoveredRule,
    capIndexedRecoveredRule,
    singletonSeed,
    pairSeedA,
    pairSeedB,
    pairAB,
    triple,
    capRoot,
    capNarrow,
    capConjunction,
  }
  await writeJson(path.join(rootDir, "summary.json"), summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
