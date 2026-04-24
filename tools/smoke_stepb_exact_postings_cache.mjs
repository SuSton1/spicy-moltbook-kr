import assert from "node:assert/strict"
import crypto from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJsonl } from "../src/lib/io.mjs"
import {
  minePerfectPrototypes,
  minePerfectPrototypesPrepared,
  preparePerfectPrototypeMiningSnapshot,
  PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
} from "../src/lib/perfect_prototype_miner.mjs"
import {
  buildPerfectPrototypeMiningCacheIdentity,
  hashPerfectPrototypeMiningInputFile,
  readPerfectPrototypeMiningSnapshotCache,
  writePerfectPrototypeMiningSnapshotCache,
} from "../src/lib/perfect_prototype_mining_cache.mjs"
import { buildPerfectPrototypeTokenizerSpecHash } from "../src/lib/perfect_prototype_tokenizer_spec_integrity.mjs"
import {
  PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
} from "../src/lib/perfect_prototype_contextual_features.mjs"
import { resolvePerfectPrototypeFeaturePrefixes } from "../src/lib/perfect_prototype_tokenizer.mjs"

const sha256 = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const buildFixtureRows = () => {
  const specs = [
    { sourceId: "fixture_01", symbol: "100001", dateKey: "2024-01-02", hit: true, body: 0.041, gap: 0.031, volume: 10.8, slope20: 0.41, global: 0.18, rank: 0.95 },
    { sourceId: "fixture_02", symbol: "100002", dateKey: "2024-01-02", hit: true, body: 0.042, gap: 0.032, volume: 10.7, slope20: 0.42, global: 0.17, rank: 0.93 },
    { sourceId: "fixture_03", symbol: "100003", dateKey: "2024-01-03", hit: true, body: 0.04, gap: 0.03, volume: 10.9, slope20: 0.4, global: 0.19, rank: 0.94 },
    { sourceId: "fixture_04", symbol: "100004", dateKey: "2024-01-03", hit: true, body: 0.043, gap: 0.033, volume: 11.0, slope20: 0.43, global: 0.18, rank: 0.96 },
    { sourceId: "fixture_05", symbol: "100005", dateKey: "2024-01-04", hit: true, body: 0.0415, gap: 0.0315, volume: 10.85, slope20: 0.405, global: 0.175, rank: 0.92 },
    { sourceId: "fixture_06", symbol: "100006", dateKey: "2024-01-04", hit: true, body: 0.0405, gap: 0.0305, volume: 10.75, slope20: 0.395, global: 0.172, rank: 0.91 },
    { sourceId: "fixture_07", symbol: "200001", dateKey: "2024-01-05", hit: false, body: 0.021, gap: 0.011, volume: 9.1, slope20: 0.19, global: 0.08, rank: 0.42 },
    { sourceId: "fixture_08", symbol: "200002", dateKey: "2024-01-05", hit: false, body: 0.022, gap: 0.012, volume: 9.2, slope20: 0.2, global: 0.082, rank: 0.44 },
    { sourceId: "fixture_09", symbol: "200003", dateKey: "2024-01-08", hit: false, body: 0.023, gap: 0.013, volume: 9.3, slope20: 0.21, global: 0.085, rank: 0.46 },
    { sourceId: "fixture_10", symbol: "200004", dateKey: "2024-01-08", hit: false, body: 0.024, gap: 0.014, volume: 9.0, slope20: 0.22, global: 0.087, rank: 0.41 },
  ]
  return specs.map((spec) => ({
    sourceType: "step_b_template",
    sourceId: spec.sourceId,
    symbol: spec.symbol,
    dateKey: spec.dateKey,
    asOfDateKey: spec.dateKey,
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
      ["tag:fixture:postings_cache", spec.hit ? "tag:fixture:signal" : "tag:fixture:background"].filter(Boolean),
    ),
    seq40: [0.01, 0.015, 0.02, spec.hit ? 0.041 : 0.019],
    seq150: [0.005, 0.01, 0.012, 0.018, spec.hit ? 0.053 : 0.024],
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
  matchedSymbols: uniqueSorted(rule?.matchedSymbols ?? []),
  maxGapTradingDays: Number(rule?.maxGapTradingDays ?? 0),
  positiveMatchRowIndexes: Array.isArray(rule?.positiveMatchRowIndexes)
    ? rule.positiveMatchRowIndexes.slice()
    : [],
})

const normalizeMatches = (rows) =>
  (Array.isArray(rows) ? rows : []).map((row) => ({
    sourceId: row?.sourceId ?? null,
    dateKey: row?.dateKey ?? null,
    symbol: row?.symbol ?? null,
    primaryRuleId: row?.primaryRuleId ?? null,
    matchedRuleIds: uniqueSorted(row?.matchedRuleIds ?? []),
  }))

const normalizeNegativeSeparationReport = (report) => ({
  exploredStates: Number(report?.exploredStates ?? 0),
  rejectionSummary: {
    ...(report?.rejectionSummary ?? {}),
    tokenizer: report?.rejectionSummary?.tokenizer
      ? {
          ...report.rejectionSummary.tokenizer,
          generatedAt: null,
        }
      : null,
  },
  topSeedEntries: Array.isArray(report?.topSeedEntries) ? report.topSeedEntries : [],
  nearMissRules: Array.isArray(report?.nearMissRules) ? report.nearMissRules : [],
})

const main = async () => {
  const rows = buildFixtureRows()
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "stepb-postings-cache-"))
  try {
    const inputPath = path.join(tempDir, "templates_lite.jsonl")
    await writeJsonl(inputPath, rows)
    const options = {
      surfaceName: PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
      searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
      minHitCount: 2,
      maxGapTradingDays: 100000,
      maxRuleSize: 3,
      maxSeedTokens: 64,
      maxRules: 32,
      maxSearchStates: 5000,
      tokenizerOptions: {
        binCount: 5,
        includeSymbolToken: false,
        includeMissingTokens: false,
        includeCategoricalTokens: true,
        includeFeaturePrefixes: resolvePerfectPrototypeFeaturePrefixes(
          PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
        ),
      },
    }

    const direct = minePerfectPrototypes({ rows, options })
    const inputSha256 = await hashPerfectPrototypeMiningInputFile(inputPath)
    const identity = buildPerfectPrototypeMiningCacheIdentity({
      inputPath,
      inputSha256,
      surfaceName: options.surfaceName,
      searchMode: options.searchMode,
      trainStartDate: options.trainStartDate,
      trainEndDate: options.trainEndDate,
      tokenizerOptions: options.tokenizerOptions,
    })
    const prepared = preparePerfectPrototypeMiningSnapshot({ rows, options })
    await writePerfectPrototypeMiningSnapshotCache({
      inputPath,
      identity,
      tokenizerSpecHash: buildPerfectPrototypeTokenizerSpecHash(prepared.snapshot.tokenizerSpec),
      snapshot: prepared.snapshot,
    })
    const cached = await readPerfectPrototypeMiningSnapshotCache({
      inputPath,
      identity,
    })
    assert.ok(cached)
    assert.equal(cached.manifest.inputSha256, inputSha256)
    const warm = minePerfectPrototypesPrepared({
      snapshot: cached.snapshot,
      options,
      phaseTimings: {
        prepareRowsSec: 0,
        buildTokenizerSpecSec: 0,
        tokenizeRowsSec: 0,
        buildTokenStatsSec: 0,
      },
    })

    assert.equal(warm.phaseTimings.prepareRowsSec, 0)
    assert.equal(warm.phaseTimings.buildTokenizerSpecSec, 0)
    assert.equal(warm.phaseTimings.tokenizeRowsSec, 0)
    assert.equal(warm.phaseTimings.buildTokenStatsSec, 0)

    assert.equal(sha256(warm.rules.map(normalizeRule)), sha256(direct.rules.map(normalizeRule)))
    assert.equal(sha256(normalizeMatches(warm.matches)), sha256(normalizeMatches(direct.matches)))
    assert.equal(
      sha256({
        exploredStates: warm.exploredStates,
        coverage: warm.coverage,
        negativeSeparationReport: normalizeNegativeSeparationReport(warm.negativeSeparationReport),
      }),
      sha256({
        exploredStates: direct.exploredStates,
        coverage: direct.coverage,
        negativeSeparationReport: normalizeNegativeSeparationReport(direct.negativeSeparationReport),
      }),
    )
    console.log("ok: Step-B exact postings cache cold/warm exactness")
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
