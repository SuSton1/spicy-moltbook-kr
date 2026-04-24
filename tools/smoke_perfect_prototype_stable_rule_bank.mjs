import assert from "node:assert/strict"

import { buildPerfectPrototypeStableRuleBank } from "../src/lib/perfect_prototype_stable_rule_bank.mjs"

const makeRow = ({ symbol, dateKey, hit, featureVec = {}, eventFeatureVec = {}, contextualTokens = [] }) => ({
  symbol,
  dateKey,
  outcomeHitTarget: hit,
  featureVec: {
    "trend.runUp10": 0.2,
    "candle.bodyPct": 0.5,
    "gap.fillRatio": 0.1,
    "volume.ratio20": 1.5,
    ...featureVec,
  },
  globalFeatureVec: {
    "global.ret20": 0.1,
  },
  eventFeatureVec: {
    jumpPct: 0.04,
    jumpPctFromPrevClose: 0.05,
    jumpPctFromOpen: 0.04,
    closeRetPct: 0.03,
    gapOpenPct: 0.01,
    closeFromOpenPct: 0.03,
    closeRetentionFromOpen: 0.7,
    closeRetentionFromPrevClose: 0.7,
    gapContributionShare: 0.25,
    intradayContributionShare: 0.75,
    closeMinusGapPct: 0.02,
    gapVsIntradayPct: -0.02,
    ...eventFeatureVec,
  },
  marketContextVec: {
    eventCount: 20,
    uniqueSymbolCount: 20,
    jumpMedian: 0.03,
    jumpP75: 0.05,
    jumpP90: 0.07,
    closeMedian: 0.01,
    closeP75: 0.03,
    gapMedian: 0.01,
    absGapMedian: 0.02,
    positiveCloseShare: 0.6,
    strongCloseShare: 0.4,
    gapUpShare: 0.6,
    wideGapShare: 0.3,
  },
  xsecEventVec: {
    jumpRankPct: 0.3,
    closeRankPct: 0.3,
    gapRankPct: 0.3,
    absGapRankPct: 0.3,
    jumpVsMedian: 0.01,
    closeVsMedian: 0.01,
    gapVsMedian: 0.01,
    jumpVsP90: -0.01,
    closeVsP75: -0.01,
    isolationScore: 0.2,
    laneEventCount: 20,
    laneJumpRankPct: 0.3,
    laneCloseRankPct: 0.3,
  },
  contextualTokens: contextualTokens.length > 0 ? contextualTokens : [
    "tag:market.closeBreadth:BROAD",
    "tag:xsec.jumpRank:LOW",
    "tag:lowGapTop.gapContinuationRegime:GAP_STABLE",
  ],
})

const supportCase = {
  caseId: "076610:2026-03-18",
  symbol: "076610",
  dateKey: "2026-03-18",
  familyIds: ["low_gap_top_continuation"],
  tokens: [
    "tag:lowGapTop.gapContinuationRegime:GAP_STABLE",
    "tag:xsec.jumpRank:LOW",
  ],
  categoricalTokens: [
    "tag:lowGapTop.gapContinuationRegime:GAP_STABLE",
    "tag:xsec.jumpRank:LOW",
  ],
  numericFeatureMap: {
    "event.closeRetentionFromOpen": 0.68,
    "event.closeRetentionFromPrevClose": 0.69,
    "event.gapContributionShare": 0.27,
    "feature.trend.runUp10": 0.21,
    "feature.candle.bodyPct": 0.52,
    "xsec.jumpRankPct": 0.28,
  },
}

const trainRows = [
  makeRow({ symbol: "AAA", dateKey: "2025-01-02", hit: true }),
  makeRow({ symbol: "BBB", dateKey: "2025-02-03", hit: true }),
  makeRow({ symbol: "CCC", dateKey: "2025-03-04", hit: true }),
  makeRow({ symbol: "DDD", dateKey: "2025-04-07", hit: true }),
  makeRow({ symbol: "EEE", dateKey: "2025-05-05", hit: true }),
  makeRow({ symbol: "FFF", dateKey: "2025-06-05", hit: false, contextualTokens: ["tag:xsec.jumpRank:HIGH"] }),
]

const oosRows = [
  makeRow({ symbol: "OO1", dateKey: "2026-01-05", hit: true }),
  makeRow({ symbol: "OO2", dateKey: "2026-01-12", hit: true }),
]

const bank = buildPerfectPrototypeStableRuleBank({
  trainRows,
  oosRows,
  supportCases: [supportCase],
  familyId: "low_gap_top_continuation",
  surfaceName: "v6_contextual_plus_lite_recent_only_lane_local_pool8",
  candidateLimit: 16,
  minTrainMatchedDates: 3,
  minTrainMatchedMonths: 3,
  minTrainMatchedFolds: 1,
  maxCrossfitNegativeWindows: 0,
  minCrossfitPositiveWindows: 1,
  crossfitWindowCount: 3,
  crossfitFoldCount: 4,
  crossfitMinWindowSupport: 1,
  maxClauseSize: 2,
})

assert.ok(bank.length > 0)
assert.ok(bank.some((entry) => entry.haesungSupport === true))
assert.ok(bank.every((entry) => entry.trainNegativeCount === 0))

console.log("ok")
