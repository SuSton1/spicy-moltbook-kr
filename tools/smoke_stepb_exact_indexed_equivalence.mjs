import assert from "node:assert/strict"
import crypto from "node:crypto"

import {
  minePerfectPrototypes,
  PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
  PERFECT_PROTOTYPE_LEGACY_SEARCH_MODE,
} from "../src/lib/perfect_prototype_miner.mjs"
import {
  createPerfectPrototypeRowset,
  intersectPerfectPrototypeRowsetsCount,
  intersectPerfectPrototypeRowsetsPrepared,
  materializePerfectPrototypeRowsetValues,
  releasePerfectPrototypeBorrowedRowset,
} from "../src/lib/perfect_prototype_rowset.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const sha256 = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")

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
    sourceId: `exact_indexed_fixture_${String(index + 1).padStart(2, "0")}`,
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
        "tag:fixture:exact_indexed",
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

const buildSparseValues = (start, step, count) =>
  Uint32Array.from(Array.from({ length: count }, (_, index) => start + index * step))

const main = async () => {
  const sparseLeft = createPerfectPrototypeRowset({
    values: Uint32Array.from([3, 5, 7, 11, 13, 17]),
    universeSize: 128,
    allowDense: true,
  })
  const sparseRight = createPerfectPrototypeRowset({
    values: Uint32Array.from([1, 2, 5, 7, 19]),
    universeSize: 128,
    allowDense: true,
  })
  assert.equal(intersectPerfectPrototypeRowsetsCount(sparseLeft, sparseRight), 2)
  {
    const prepared = intersectPerfectPrototypeRowsetsPrepared({
      leftRowset: sparseLeft,
      rightRowset: sparseRight,
      universeSize: 128,
      allowDense: true,
      resultOwnership: "borrowed",
    })
    assert.equal(prepared.count, 2)
    assert.deepEqual(Array.from(materializePerfectPrototypeRowsetValues(prepared.rowset)), [5, 7])
    releasePerfectPrototypeBorrowedRowset(prepared.rowset)
  }

  const denseLeft = createPerfectPrototypeRowset({
    values: buildSparseValues(0, 3, 97),
    universeSize: 512,
    allowDense: true,
  })
  const denseRight = createPerfectPrototypeRowset({
    values: buildSparseValues(0, 6, 49),
    universeSize: 512,
    allowDense: true,
  })
  const sparseProbe = createPerfectPrototypeRowset({
    values: Uint32Array.from([0, 12, 18, 72, 144, 210, 288, 400]),
    universeSize: 512,
    allowDense: true,
  })
  assert.equal(intersectPerfectPrototypeRowsetsCount(denseLeft, denseRight), 49)
  {
    const prepared = intersectPerfectPrototypeRowsetsPrepared({
      leftRowset: denseLeft,
      rightRowset: denseRight,
      universeSize: 512,
      allowDense: true,
      resultOwnership: "borrowed",
    })
    assert.equal(prepared.count, 49)
    assert.deepEqual(
      Array.from(materializePerfectPrototypeRowsetValues(prepared.rowset)).slice(0, 8),
      [0, 6, 12, 18, 24, 30, 36, 42],
    )
    releasePerfectPrototypeBorrowedRowset(prepared.rowset)
  }
  assert.equal(intersectPerfectPrototypeRowsetsCount(sparseProbe, denseLeft), 7)
  {
    const prepared = intersectPerfectPrototypeRowsetsPrepared({
      leftRowset: sparseProbe,
      rightRowset: denseLeft,
      universeSize: 512,
      allowDense: true,
      resultOwnership: "borrowed",
    })
    assert.equal(prepared.count, 7)
    assert.deepEqual(
      Array.from(materializePerfectPrototypeRowsetValues(prepared.rowset)),
      [0, 12, 18, 72, 144, 210, 288],
    )
    releasePerfectPrototypeBorrowedRowset(prepared.rowset)
  }

  const rows = buildFixtureRows()
  const options = {
    minHitCount: 2,
    maxGapTradingDays: 100000,
    maxRuleSize: 3,
    maxSeedTokens: 64,
    maxRules: 32,
    maxSearchStates: 5000,
  }
  const legacy = minePerfectPrototypes({
    rows,
    options: {
      ...options,
      searchMode: PERFECT_PROTOTYPE_LEGACY_SEARCH_MODE,
    },
  })
  const exactIndexed = minePerfectPrototypes({
    rows,
    options: {
      ...options,
      searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
    },
  })

  const legacyRules = legacy.rules.map(normalizeRule)
  const indexedRules = exactIndexed.rules.map(normalizeRule)
  const legacyMatches = normalizeMatches(legacy.matches)
  const indexedMatches = normalizeMatches(exactIndexed.matches)
  const legacyCoverage = normalizeCoverage(legacy.coverage)
  const indexedCoverage = normalizeCoverage(exactIndexed.coverage)

  assert.deepEqual(indexedRules, legacyRules, "exact indexed miner mode must preserve exact rules")
  assert.deepEqual(indexedMatches, legacyMatches, "exact indexed miner mode must preserve match rows")
  assert.deepEqual(indexedCoverage, legacyCoverage, "exact indexed miner mode must preserve coverage")
  assert.equal(
    exactIndexed.exploredStates,
    legacy.exploredStates,
    "exact indexed miner mode must preserve explored states",
  )
  assert.equal(
    sha256(indexedRules),
    sha256(legacyRules),
    "exact indexed miner mode must preserve normalized rule payload hash",
  )
  assert.equal(
    sha256(indexedMatches),
    sha256(legacyMatches),
    "exact indexed miner mode must preserve normalized match payload hash",
  )

  console.log("stepb exact indexed equivalence smoke ok")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
