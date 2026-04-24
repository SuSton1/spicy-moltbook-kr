import assert from "node:assert/strict"

import {
  countIntersectSortedIntegers,
  compactPerfectPrototypeMiningSourceRow,
  intersectSortedIntegers,
  minePerfectPrototypes,
} from "../src/lib/perfect_prototype_miner.mjs"
import {
  buildPerfectPrototypeCalendarLookup,
  createPerfectPrototypeRule,
  createPerfectPrototypeRuleCore,
  materializePerfectPrototypeRule,
} from "../src/lib/perfect_prototype_rule.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const buildFixtureRows = () => {
  const dateKeys = [
    "2024-01-02",
    "2024-01-02",
    "2024-01-03",
    "2024-01-03",
    "2024-01-04",
    "2024-01-04",
    "2024-01-05",
    "2024-01-05",
    "2024-01-08",
    "2024-01-08",
  ]
  const baseSeq40 = [0.01, 0.015, 0.02, 0.03]
  const baseSeq150 = [0.005, 0.01, 0.012, 0.018, 0.025]
  const specs = [
    { symbol: "100001", hit: true, body: 0.041, gap: 0.036, volume: 10.8, slope20: 0.42, global: 0.18, rank: 0.95 },
    { symbol: "100002", hit: true, body: 0.042, gap: 0.034, volume: 10.7, slope20: 0.4, global: 0.17, rank: 0.93 },
    { symbol: "100003", hit: true, body: 0.04, gap: 0.033, volume: 10.9, slope20: 0.41, global: 0.19, rank: 0.94 },
    { symbol: "100004", hit: true, body: 0.043, gap: 0.035, volume: 11.0, slope20: 0.43, global: 0.18, rank: 0.96 },
    { symbol: "100005", hit: true, body: 0.0415, gap: 0.032, volume: 10.85, slope20: 0.405, global: 0.175, rank: 0.92 },
    { symbol: "100006", hit: true, body: 0.0405, gap: 0.031, volume: 10.75, slope20: 0.395, global: 0.172, rank: 0.91 },
    { symbol: "200001", hit: false, body: 0.021, gap: 0.011, volume: 9.1, slope20: 0.19, global: 0.08, rank: 0.42 },
    { symbol: "200002", hit: false, body: 0.022, gap: 0.012, volume: 9.2, slope20: 0.2, global: 0.082, rank: 0.44 },
    { symbol: "200003", hit: false, body: 0.023, gap: 0.013, volume: 9.3, slope20: 0.21, global: 0.085, rank: 0.46 },
    { symbol: "200004", hit: false, body: 0.024, gap: 0.014, volume: 9.0, slope20: 0.22, global: 0.087, rank: 0.41 },
  ]
  return specs.map((spec, index) => ({
    sourceType: "step_b_template",
    sourceId: `legacy_compact_fixture_${String(index + 1).padStart(2, "0")}`,
    symbol: spec.symbol,
    dateKey: dateKeys[index],
    asOfDateKey: dateKeys[Math.max(0, index - 1)] ?? dateKeys[index],
    featureVec: {
      "candle.bodyPct": spec.body,
      "gap.openPct": spec.gap,
      "trend.slope20": spec.slope20,
      "volume.marketCapLog": spec.volume,
    },
    globalFeatureVec: {
      "global.ret20": spec.global,
    },
    eventFeatureVec: {
      jumpPct: spec.gap,
    },
    marketContextVec: {
      closeMedian: spec.hit ? 0.88 : 0.37,
      gapUpShare: spec.hit ? 0.71 : 0.29,
      positiveCloseShare: spec.hit ? 0.76 : 0.34,
    },
    xsecEventVec: {
      closeRankPct: spec.rank,
      jumpRankPct: spec.rank,
      isolationScore: spec.hit ? 0.08 : 0.42,
    },
    contextualTokens: uniqueSorted(
      [
        "tag:fixture:legacy_compaction",
        spec.hit ? "tag:fixture:signal:a" : "tag:fixture:background",
        spec.hit ? "tag:fixture:signal:b" : null,
      ].filter(Boolean),
    ),
    seq40: [...baseSeq40, spec.hit ? 0.041 : 0.019],
    seq150: [...baseSeq150, spec.hit ? 0.053 : 0.024],
    eventOutcome: {
      hitTarget: spec.hit,
    },
  }))
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
  matchedDateCount: Number(rule?.matchedDateCount ?? 0),
  top1DateHitCount: Number(rule?.top1DateHitCount ?? 0),
  top3DateHitCount: Number(rule?.top3DateHitCount ?? 0),
  top1DateHitShare: Number(rule?.top1DateHitShare ?? 0),
  top3DateHitShare: Number(rule?.top3DateHitShare ?? 0),
  matchedDateSignatureHash: rule?.matchedDateSignatureHash ?? null,
  matchedSymbols: uniqueSorted(rule?.matchedSymbols ?? []),
  maxGapTradingDays: Number(rule?.maxGapTradingDays ?? 0),
  matchRowIndexes: Array.isArray(rule?.matchRowIndexes) ? rule.matchRowIndexes.slice() : [],
  positiveMatchRowIndexes: Array.isArray(rule?.positiveMatchRowIndexes)
    ? rule.positiveMatchRowIndexes.slice()
    : [],
  negativeMatchRowIndexes: Array.isArray(rule?.negativeMatchRowIndexes)
    ? rule.negativeMatchRowIndexes.slice()
    : [],
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
  totalRows: Number(coverage?.totalRows ?? 0),
  totalPositiveRows: Number(coverage?.totalPositiveRows ?? 0),
  totalNegativeRows: Number(coverage?.totalNegativeRows ?? 0),
  ruleCount: Number(coverage?.ruleCount ?? 0),
  matchedRows: Number(coverage?.matchedRows ?? 0),
  matchedPositiveRows: Number(coverage?.matchedPositiveRows ?? 0),
  matchedNegativeRows: Number(coverage?.matchedNegativeRows ?? 0),
  positiveCoverageRate: Number(coverage?.positiveCoverageRate ?? 0),
  negativeCoverageRate: Number(coverage?.negativeCoverageRate ?? 0),
  dedupedSymbolDayMatches: Number(coverage?.dedupedSymbolDayMatches ?? 0),
  uniqueMatchedDates: Number(coverage?.uniqueMatchedDates ?? 0),
  uniqueMatchedSymbols: Number(coverage?.uniqueMatchedSymbols ?? 0),
})

const main = async () => {
  assert.deepEqual(
    intersectSortedIntegers(
      [
        18, 54, 56, 62, 65, 76, 82, 96, 99, 123, 156, 171, 173, 227, 302, 308, 338, 339, 360,
        376, 390, 432, 464, 467, 497, 502, 518, 525, 531, 551, 560, 575, 601, 607, 616, 638, 642,
        654, 745, 780, 799, 812, 830, 932, 959, 971, 987, 995,
      ],
      [820, 932, 1730, 2859, 3722, 4504, 4591, 4712],
    ),
    [932],
    "intersection fastpath must not skip a matching larger-array element at the gallop start cursor",
  )
  assert.deepEqual(
    intersectSortedIntegers([5, 10, 20, 25], [1, 5, 30]),
    [5],
    "intersection fastpath must preserve matches when the gallop target lands on the start index",
  )
  assert.equal(
    countIntersectSortedIntegers([5, 10, 20, 25], [1, 5, 30], 2),
    1,
    "count-only fastpath must return the exact count when it stays below the stop threshold",
  )
  assert.equal(
    countIntersectSortedIntegers([2, 4, 6, 8, 10], [0, 2, 4, 6, 8, 12], 3),
    3,
    "count-only fastpath may stop early once the minimum required hit count is reached",
  )

  const rows = buildFixtureRows()
  const compactRows = rows.map(compactPerfectPrototypeMiningSourceRow)
  const calendarLookup = buildPerfectPrototypeCalendarLookup(rows.map((row) => row.dateKey))
  const rowCalendarIndexes = rows.map((row) => calendarLookup.calendarIndexByDateKey.get(row.dateKey) ?? -1)
  const fullRule = createPerfectPrototypeRule({
    tokens: ["tag:fixture:signal:a", "tag:fixture:signal:b"],
    matchRowIndexes: [0, 1, 2, 3],
    positiveMatchRowIndexes: [0, 1, 2, 3],
    negativeMatchRowIndexes: [],
    rows,
    calendarDateKeys: calendarLookup.orderedCalendarDateKeys,
    calendarIndexByDateKey: calendarLookup.calendarIndexByDateKey,
    rowCalendarIndexes,
  })
  const coreRule = createPerfectPrototypeRuleCore({
    tokens: ["tag:fixture:signal:a", "tag:fixture:signal:b"],
    matchRowIndexes: [0, 1, 2, 3],
    positiveMatchRowIndexes: [0, 1, 2, 3],
    negativeMatchRowIndexes: [],
    rows,
    calendarDateKeys: calendarLookup.orderedCalendarDateKeys,
    calendarIndexByDateKey: calendarLookup.calendarIndexByDateKey,
    rowCalendarIndexes,
  })
  assert.deepEqual(
    materializePerfectPrototypeRule({
      ruleCore: coreRule,
      rows,
      calendarDateKeys: calendarLookup.orderedCalendarDateKeys,
    }),
    fullRule,
    "rule core + final materialization must be exact-equivalent to one-shot rule construction",
  )
  const options = {
    minHitCount: 2,
    maxGapTradingDays: 100000,
    maxRuleSize: 3,
    maxSeedTokens: 64,
    maxRules: 32,
    maxSearchStates: 5000,
  }

  const full = minePerfectPrototypes({ rows, options })
  const compact = minePerfectPrototypes({ rows: compactRows, options })

  assert.deepEqual(
    normalizeTokenizerSpec(compact.tokenizerSpec),
    normalizeTokenizerSpec(full.tokenizerSpec),
    "compacted source rows must preserve tokenizer spec generation",
  )
  assert.deepEqual(
    compact.rules.map(normalizeRule),
    full.rules.map(normalizeRule),
    "compacted source rows must preserve exact legacy miner rules",
  )
  assert.deepEqual(
    normalizeMatches(compact.matches),
    normalizeMatches(full.matches),
    "compacted source rows must preserve match rows",
  )
  assert.deepEqual(
    normalizeCoverage(compact.coverage),
    normalizeCoverage(full.coverage),
    "compacted source rows must preserve coverage",
  )
  assert.equal(compact.exploredStates, full.exploredStates, "compacted source rows must preserve explored states")
  assert.deepEqual(
    Object.keys(compact.rows[0] ?? {}).sort(),
    [
      "dateKey",
      "impulseLookbackDays",
      "outcomeHitTarget",
      "sourceId",
      "sourceType",
      "stepALaneId",
      "symbol",
      "tokens",
    ],
    "prepared mining rows should retain only compact row-meta plus tokens",
  )

  console.log("legacy miner compaction equivalence smoke ok")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
