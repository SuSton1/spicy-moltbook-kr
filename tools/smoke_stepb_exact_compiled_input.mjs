import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  minePerfectPrototypes,
  minePerfectPrototypesPrepared,
  normalizeMinerOptions,
  PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
} from "../src/lib/perfect_prototype_miner.mjs"
import {
  buildPerfectPrototypeStepbExactIndex,
  loadPerfectPrototypeStepbExactIndex,
  resolvePerfectPrototypeStepbExactIndexPaths,
} from "../src/lib/perfect_prototype_stepb_exact_index.mjs"
import { pathExists, writeJsonl } from "../src/lib/io.mjs"

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
    sourceId: `compiled_exact_fixture_${String(index + 1).padStart(2, "0")}`,
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
        "tag:fixture:compiled_exact",
        spec.hit ? "tag:fixture:signal:a" : "tag:fixture:background",
        spec.hit ? "tag:fixture:signal:b" : null,
      ].filter(Boolean),
    ),
    seq40: [0.01, 0.015, 0.02, 0.03, spec.hit ? 0.041 : 0.019],
    seq150: [0.005, 0.01, 0.012, 0.018, 0.025, spec.hit ? 0.053 : 0.024],
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

const main = async () => {
  const rows = buildFixtureRows()
  const options = {
    surfaceName: "v3_contextual_plus_lite",
    searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
    minHitCount: 2,
    maxGapTradingDays: 100000,
    maxRuleSize: 3,
    maxSeedTokens: 64,
    maxRules: 100000,
    maxSearchStates: 5000,
  }
  const normalizedOptions = normalizeMinerOptions(options)
  assert.equal(
    normalizedOptions.maxRules,
    100000,
    "normalizeMinerOptions must not silently clamp maxRules=100000",
  )
  const direct = minePerfectPrototypes({
    rows,
    options,
  })

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stepb-exact-index-"))
  try {
    const fixtureInputPath = path.join(tempRoot, "fixture_templates_lite.jsonl")
    await writeJsonl(fixtureInputPath, rows)
    const builtIndex = await buildPerfectPrototypeStepbExactIndex({
      rows,
      outDir: tempRoot,
      inputPath: fixtureInputPath,
      inputSha256: "c".repeat(64),
      surfaceName: options.surfaceName,
      options,
    })
    const loadedIndex = await loadPerfectPrototypeStepbExactIndex({
      indexDir: tempRoot,
    })
    const indexPaths = resolvePerfectPrototypeStepbExactIndexPaths(tempRoot)
    const compiled = minePerfectPrototypesPrepared({
      snapshot: loadedIndex.snapshot,
      options,
      phaseTimings: {
        prepareRowsSec: 0,
        buildTokenizerSpecSec: 0,
        tokenizeRowsSec: 0,
        buildTokenStatsSec: 0,
      },
    })

    assert.equal(String(loadedIndex.manifest.inputSha256), "c".repeat(64))
    assert.equal(loadedIndex.manifest.rowCount, rows.length)
    assert.equal(loadedIndex.manifest.searchMode, PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE)
    assert.equal(
      builtIndex.tokenizerSpecHash,
      loadedIndex.manifest.tokenizerSpecHash,
      "compiled index tokenizerSpecHash must round-trip",
    )
    assert.equal(pathExists(indexPaths.rowMetaParquetPath), true)
    assert.equal(pathExists(indexPaths.tokenStatsParquetPath), true)
    assert.equal(pathExists(indexPaths.tokenDictionaryParquetPath), true)
    assert.equal(pathExists(indexPaths.tokenPostingsBinPath), true)

    const directRules = direct.rules.map(normalizeRule)
    const compiledRules = compiled.rules.map(normalizeRule)
    const directMatches = normalizeMatches(direct.matches)
    const compiledMatches = normalizeMatches(compiled.matches)
    const directCoverage = normalizeCoverage(direct.coverage)
    const compiledCoverage = normalizeCoverage(compiled.coverage)

    assert.deepEqual(compiledRules, directRules)
    assert.deepEqual(compiledMatches, directMatches)
    assert.deepEqual(compiledCoverage, directCoverage)
    assert.equal(compiled.exploredStates, direct.exploredStates)
    assert.equal(direct.catalog?.metadata?.maxRules, 100000)
    assert.equal(compiled.catalog?.metadata?.maxRules, 100000)
    assert.equal(direct.catalog?.metadata?.maxSearchStates, 5000)
    assert.equal(compiled.catalog?.metadata?.maxSearchStates, 5000)
    assert.equal(sha256(compiledRules), sha256(directRules))
    assert.equal(sha256(compiledMatches), sha256(directMatches))
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }

  console.log("ok: Step-B exact compiled input cold-load exactness")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
