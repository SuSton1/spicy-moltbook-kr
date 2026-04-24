#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildPerfectPrototypeLow1dRecentEpisodeDataset } from "../src/lib/perfect_prototype_low_1d_recent_episode_dataset.mjs"
import { buildPerfectPrototypeLow1dRecentEpisodeExactBank } from "../src/lib/perfect_prototype_low_1d_recent_episode_exact_bank.mjs"
import { buildPerfectPrototypeRuleFamilyRootTokens } from "../src/lib/perfect_prototype_rule_family_spec.mjs"

const FAMILY_ID = "low_gap_top_continuation"
const ROOT_TOKENS = buildPerfectPrototypeRuleFamilyRootTokens(FAMILY_ID)

const buildRow = ({
  rowKey,
  dateKey,
  monthKey,
  foldId,
  hit,
  rangePct,
  bodyPct,
  closePos,
  gapPct,
  valueRatio20,
  closeNearHigh20,
  breakoutDistance20,
} = {}) => ({
  rowKey,
  sourceId: rowKey,
  symbol: `SYM_${rowKey}`,
  dateKey,
  monthKey,
  foldId,
  outcomeHitTarget: hit,
  categoricalTokens: [...ROOT_TOKENS],
  tokenSet: new Set(ROOT_TOKENS),
  numericFeatureMap: {
    "feature.candle.rangePct": rangePct,
    "feature.candle.bodyPct": bodyPct,
    "feature.candle.closePos": closePos,
    "feature.gap.pct": gapPct,
    "feature.volume.valueRatio20": valueRatio20,
    "feature.level.closeNearHigh20": closeNearHigh20,
    "feature.shape.breakoutDistance20": breakoutDistance20,
  },
})

const trainRows = [
  buildRow({ rowKey: "seed0", dateKey: "2023-01-03", monthKey: "2023-01", foldId: 1, hit: true, rangePct: 0.9, bodyPct: 0.55, closePos: 0.58, gapPct: 0.03, valueRatio20: 1.2, closeNearHigh20: 0.6, breakoutDistance20: 0.03 }),
  buildRow({ rowKey: "seed1", dateKey: "2023-01-10", monthKey: "2023-01", foldId: 1, hit: true, rangePct: 0.88, bodyPct: 0.5, closePos: 0.6, gapPct: 0.03, valueRatio20: 1.15, closeNearHigh20: 0.62, breakoutDistance20: 0.03 }),
  buildRow({ rowKey: "p1", dateKey: "2023-02-01", monthKey: "2023-02", foldId: 1, hit: true, rangePct: 0.45, bodyPct: 0.28, closePos: 0.86, gapPct: 0.02, valueRatio20: 0.62, closeNearHigh20: 0.82, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "p2", dateKey: "2023-02-15", monthKey: "2023-02", foldId: 1, hit: true, rangePct: 0.42, bodyPct: 0.26, closePos: 0.88, gapPct: 0.02, valueRatio20: 0.58, closeNearHigh20: 0.84, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "p3", dateKey: "2023-03-01", monthKey: "2023-03", foldId: 2, hit: true, rangePct: 0.43, bodyPct: 0.27, closePos: 0.87, gapPct: 0.02, valueRatio20: 0.6, closeNearHigh20: 0.85, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "p4", dateKey: "2023-03-15", monthKey: "2023-03", foldId: 2, hit: true, rangePct: 0.44, bodyPct: 0.27, closePos: 0.89, gapPct: 0.02, valueRatio20: 0.59, closeNearHigh20: 0.86, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "p5", dateKey: "2023-04-03", monthKey: "2023-04", foldId: 2, hit: true, rangePct: 0.41, bodyPct: 0.25, closePos: 0.9, gapPct: 0.02, valueRatio20: 0.57, closeNearHigh20: 0.87, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "p6", dateKey: "2023-04-17", monthKey: "2023-04", foldId: 3, hit: true, rangePct: 0.4, bodyPct: 0.24, closePos: 0.9, gapPct: 0.02, valueRatio20: 0.55, closeNearHigh20: 0.88, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "p7", dateKey: "2023-05-02", monthKey: "2023-05", foldId: 3, hit: true, rangePct: 0.39, bodyPct: 0.24, closePos: 0.91, gapPct: 0.02, valueRatio20: 0.56, closeNearHigh20: 0.89, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "p8", dateKey: "2023-05-16", monthKey: "2023-05", foldId: 3, hit: true, rangePct: 0.38, bodyPct: 0.23, closePos: 0.92, gapPct: 0.02, valueRatio20: 0.54, closeNearHigh20: 0.9, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "p9", dateKey: "2023-06-01", monthKey: "2023-06", foldId: 4, hit: true, rangePct: 0.37, bodyPct: 0.22, closePos: 0.92, gapPct: 0.02, valueRatio20: 0.53, closeNearHigh20: 0.91, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "p10", dateKey: "2023-06-15", monthKey: "2023-06", foldId: 4, hit: true, rangePct: 0.36, bodyPct: 0.22, closePos: 0.93, gapPct: 0.02, valueRatio20: 0.52, closeNearHigh20: 0.92, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "p11", dateKey: "2023-07-03", monthKey: "2023-07", foldId: 4, hit: true, rangePct: 0.35, bodyPct: 0.21, closePos: 0.93, gapPct: 0.02, valueRatio20: 0.51, closeNearHigh20: 0.92, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "n1", dateKey: "2023-02-08", monthKey: "2023-02", foldId: 1, hit: false, rangePct: 0.95, bodyPct: 0.62, closePos: 0.32, gapPct: 0.09, valueRatio20: 1.45, closeNearHigh20: 0.45, breakoutDistance20: 0.08 }),
  buildRow({ rowKey: "n2", dateKey: "2023-03-08", monthKey: "2023-03", foldId: 2, hit: false, rangePct: 0.94, bodyPct: 0.64, closePos: 0.3, gapPct: 0.1, valueRatio20: 1.5, closeNearHigh20: 0.42, breakoutDistance20: 0.09 }),
  buildRow({ rowKey: "n3", dateKey: "2023-04-10", monthKey: "2023-04", foldId: 2, hit: false, rangePct: 0.96, bodyPct: 0.63, closePos: 0.29, gapPct: 0.1, valueRatio20: 1.48, closeNearHigh20: 0.41, breakoutDistance20: 0.09 }),
  buildRow({ rowKey: "n4", dateKey: "2023-05-08", monthKey: "2023-05", foldId: 3, hit: false, rangePct: 0.97, bodyPct: 0.65, closePos: 0.31, gapPct: 0.11, valueRatio20: 1.52, closeNearHigh20: 0.4, breakoutDistance20: 0.1 }),
  buildRow({ rowKey: "n5", dateKey: "2023-06-08", monthKey: "2023-06", foldId: 4, hit: false, rangePct: 0.98, bodyPct: 0.66, closePos: 0.28, gapPct: 0.11, valueRatio20: 1.55, closeNearHigh20: 0.39, breakoutDistance20: 0.1 }),
]

const oosRows = [
  buildRow({ rowKey: "o1", dateKey: "2025-01-03", monthKey: "2025-01", foldId: 1, hit: true, rangePct: 0.42, bodyPct: 0.25, closePos: 0.88, gapPct: 0.02, valueRatio20: 0.59, closeNearHigh20: 0.86, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "o2", dateKey: "2025-02-03", monthKey: "2025-02", foldId: 2, hit: true, rangePct: 0.4, bodyPct: 0.24, closePos: 0.9, gapPct: 0.02, valueRatio20: 0.56, closeNearHigh20: 0.88, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "o3", dateKey: "2025-03-03", monthKey: "2025-03", foldId: 3, hit: true, rangePct: 0.39, bodyPct: 0.23, closePos: 0.91, gapPct: 0.02, valueRatio20: 0.55, closeNearHigh20: 0.89, breakoutDistance20: 0.02 }),
  buildRow({ rowKey: "o4", dateKey: "2025-04-03", monthKey: "2025-04", foldId: 4, hit: false, rangePct: 0.96, bodyPct: 0.64, closePos: 0.3, gapPct: 0.1, valueRatio20: 1.52, closeNearHigh20: 0.4, breakoutDistance20: 0.1 }),
]

const episodeDataset = buildPerfectPrototypeLow1dRecentEpisodeDataset({
  trainRows,
  oosRows,
  familyIds: [FAMILY_ID],
  lookbackTradingDays: 4,
})
const exactBank = buildPerfectPrototypeLow1dRecentEpisodeExactBank({
  episodeDataset,
  minTrainDates: 4,
  minTrainMonths: 4,
  minTrainFolds: 3,
  minUnionDates: 10,
  minUnionMonths: 6,
  minUnionFolds: 4,
  minSelectionFrequency: 0.6,
  qValueThreshold: 0.05,
})

assert.equal(episodeDataset.ok, true)
assert.equal(exactBank.ok, true)
assert.ok(
  episodeDataset.familyDatasets[0].episodeTokenStats.some((entry) => entry.token === "sig:episode:squeeze"),
)
assert.ok(exactBank.qualifiedRules.length >= 1)
assert.ok(exactBank.unionSelection.selectedRuleCount >= 1)
assert.ok(Number(exactBank.unionSelection.unionTrainSummary.precision ?? 0) >= 1)
assert.ok(Number(exactBank.unionSelection.unionTrainSummary.matchedDateCount ?? 0) >= 10)
