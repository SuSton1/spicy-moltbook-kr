#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { buildPerfectPrototypeDailyCanonicalWinnerSlateDataset } from "../src/lib/perfect_prototype_daily_canonical_winner_slate_dataset.mjs"
import {
  buildPerfectPrototypeDailySymbolicMicrocardHypothesisCatalog,
  buildPerfectPrototypeFeatureBankContract,
} from "../src/lib/perfect_prototype_feature_bank_contract.mjs"
import { buildPerfectPrototypeFeatureBankSidecarStore } from "../src/lib/perfect_prototype_feature_bank_sidecar_store.mjs"
import { assemblePerfectPrototypeFeatureBankRows } from "../src/lib/perfect_prototype_feature_bank_assembler.mjs"
import { buildPerfectPrototypeDailyTradeSlateDataset } from "../src/lib/perfect_prototype_daily_trade_slate_dataset.mjs"
import { calibratePerfectPrototypeDailyTradeAbstainGateV2 } from "../src/lib/perfect_prototype_daily_trade_abstain_gate_v2.mjs"
import { buildPerfectPrototypeDailySymbolicGlyphBank } from "../src/lib/perfect_prototype_daily_symbolic_glyph_bank.mjs"
import { buildPerfectPrototypeDailySymbolicStateGrammar } from "../src/lib/perfect_prototype_daily_symbolic_state_grammar.mjs"
import { buildPerfectPrototypeDailySymbolicSlateContrast } from "../src/lib/perfect_prototype_daily_symbolic_slate_contrast.mjs"
import { buildPerfectPrototypeDailyTradeWitnessSelector } from "../src/lib/perfect_prototype_daily_trade_witness_selector.mjs"
import { buildPerfectPrototypeDailySymbolicMicrocardRouter } from "../src/lib/perfect_prototype_daily_symbolic_microcard_router.mjs"
import { buildPerfectPrototypeDailySymbolicExactBank } from "../src/lib/perfect_prototype_daily_symbolic_exact_bank.mjs"

const sameDayToken = "tag:stepa.lane:same_day_high8"
const recentToken = "tag:stepa.lane:recent_impulse_1d"

const makeRow = ({
  rowKey,
  symbol,
  dateKey,
  foldId,
  windowId,
  hit,
  netRet,
  bodyPct,
  rangePct,
  valueRatio20,
  runUp10,
  closeOverMa20,
  closeOverMa120,
  closeNearHigh20,
  breakoutPauseScore,
  failedBreakoutCount20,
  liquidityStress,
}) => ({
  rowKey,
  sourceId: rowKey,
  symbol,
  dateKey,
  monthKey: dateKey.slice(0, 7),
  foldId,
  windowId,
  outcomeHitTarget: hit === true,
  eventOutcome: {
    hitTarget: hit === true,
    netRet,
    entryDateKey: `${dateKey.slice(0, 8)}20`,
  },
  numericFeatureMap: {
    "candle.bodyPct": bodyPct,
    "candle.rangePct": rangePct,
    "volume.valueRatio20": valueRatio20,
    "volume.avgTradingValue20dKrw": valueRatio20 * 1_500_000_000,
    "volume.liquidityStress": liquidityStress,
    "trend.runUp10": runUp10,
    "trend.closeOverMa20": closeOverMa20,
    "trend.closeOverMa120": closeOverMa120,
    "level.closeNearHigh20": closeNearHigh20,
    "shape.breakoutPauseScore": breakoutPauseScore,
    "shape.failedBreakoutCount20": failedBreakoutCount20,
    "global.valueRatio20Over150": valueRatio20 * 0.8,
  },
  categoricalTokens: [sameDayToken, recentToken],
  tokenSet: new Set([sameDayToken, recentToken]),
})

const positiveDatesA = [
  ["2023-01-11", 1, 1],
  ["2023-03-15", 2, 2],
  ["2023-05-17", 3, 3],
  ["2023-07-12", 4, 4],
  ["2023-09-13", 1, 5],
  ["2023-11-15", 3, 6],
]
const positiveDatesB = [
  ["2024-01-15", 1, 1],
  ["2024-03-18", 2, 2],
  ["2024-05-13", 3, 3],
  ["2024-07-15", 4, 4],
  ["2024-09-16", 2, 5],
  ["2024-11-11", 4, 6],
]
const controlDates = [
  ["2023-02-06", 1, 1],
  ["2023-04-10", 2, 2],
  ["2023-06-12", 3, 3],
  ["2023-08-14", 4, 4],
  ["2024-02-05", 1, 5],
  ["2024-04-08", 2, 6],
]
const oosDates = [
  ["2025-02-03", 1, 1],
  ["2025-04-14", 2, 2],
  ["2025-07-21", 3, 3],
]

const trainRows = []
for (const [dateKey, foldId, windowId] of positiveDatesA) {
  trainRows.push(
    makeRow({
      rowKey: `${dateKey}::WA`,
      symbol: `WA${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: true,
      netRet: 0.18,
      bodyPct: 0.68,
      rangePct: 0.072,
      valueRatio20: 2.3,
      runUp10: 0.16,
      closeOverMa20: 0.06,
      closeOverMa120: 0.03,
      closeNearHigh20: 0.91,
      breakoutPauseScore: 0.77,
      failedBreakoutCount20: 0,
      liquidityStress: 0.08,
    }),
    makeRow({
      rowKey: `${dateKey}::RA`,
      symbol: `RA${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.03,
      bodyPct: 0.28,
      rangePct: 0.088,
      valueRatio20: 0.95,
      runUp10: 0.12,
      closeOverMa20: 0.08,
      closeOverMa120: 0.06,
      closeNearHigh20: 0.54,
      breakoutPauseScore: 0.31,
      failedBreakoutCount20: 2,
      liquidityStress: 0.21,
    }),
  )
}
for (const [dateKey, foldId, windowId] of positiveDatesB) {
  trainRows.push(
    makeRow({
      rowKey: `${dateKey}::WB`,
      symbol: `WB${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: true,
      netRet: 0.16,
      bodyPct: 0.59,
      rangePct: 0.064,
      valueRatio20: 1.85,
      runUp10: 0.14,
      closeOverMa20: 0.04,
      closeOverMa120: 0.01,
      closeNearHigh20: 0.86,
      breakoutPauseScore: 0.72,
      failedBreakoutCount20: 0,
      liquidityStress: 0.1,
    }),
    makeRow({
      rowKey: `${dateKey}::RB`,
      symbol: `RB${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.04,
      bodyPct: 0.22,
      rangePct: 0.091,
      valueRatio20: 0.82,
      runUp10: 0.09,
      closeOverMa20: 0.07,
      closeOverMa120: 0.05,
      closeNearHigh20: 0.48,
      breakoutPauseScore: 0.27,
      failedBreakoutCount20: 3,
      liquidityStress: 0.24,
    }),
  )
}

const controlTrainRows = []
for (const [dateKey, foldId, windowId] of controlDates) {
  controlTrainRows.push(
    makeRow({
      rowKey: `${dateKey}::C1`,
      symbol: `C${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.05,
      bodyPct: 0.12,
      rangePct: 0.079,
      valueRatio20: 0.55,
      runUp10: 0.01,
      closeOverMa20: 0.01,
      closeOverMa120: 0.02,
      closeNearHigh20: 0.42,
      breakoutPauseScore: 0.18,
      failedBreakoutCount20: 2,
      liquidityStress: 0.28,
    }),
  )
}

const oosRows = []
for (const [dateKey, foldId, windowId] of oosDates) {
  oosRows.push(
    makeRow({
      rowKey: `${dateKey}::OW`,
      symbol: `OW${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: true,
      netRet: 0.17,
      bodyPct: 0.63,
      rangePct: 0.07,
      valueRatio20: 2.1,
      runUp10: 0.15,
      closeOverMa20: 0.05,
      closeOverMa120: 0.02,
      closeNearHigh20: 0.9,
      breakoutPauseScore: 0.74,
      failedBreakoutCount20: 0,
      liquidityStress: 0.08,
    }),
    makeRow({
      rowKey: `${dateKey}::OR`,
      symbol: `OR${dateKey.slice(-2)}`,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.04,
      bodyPct: 0.2,
      rangePct: 0.09,
      valueRatio20: 0.85,
      runUp10: 0.1,
      closeOverMa20: 0.08,
      closeOverMa120: 0.04,
      closeNearHigh20: 0.5,
      breakoutPauseScore: 0.25,
      failedBreakoutCount20: 2,
      liquidityStress: 0.22,
    }),
  )
}

const supportCases = [
  {
    caseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
    symbol: "076610",
    dateKey: "2026-03-18",
    tokens: [sameDayToken, recentToken],
    donorTokens: [sameDayToken, recentToken],
    numericFeatureMap: {
      "candle.bodyPct": 0.61,
      "candle.rangePct": 0.069,
      "volume.valueRatio20": 2.0,
      "volume.avgTradingValue20dKrw": 3_000_000_000,
      "volume.liquidityStress": 0.09,
      "trend.runUp10": 0.14,
      "trend.closeOverMa20": 0.05,
      "trend.closeOverMa120": 0.02,
      "level.closeNearHigh20": 0.88,
      "shape.breakoutPauseScore": 0.73,
      "shape.failedBreakoutCount20": 0,
      "global.valueRatio20Over150": 1.65,
    },
  },
]

let family = buildPerfectPrototypeDailyCanonicalWinnerSlateDataset({
  familyId: "daily_trade_slate_symbolic_microcard_bank",
  trainRows,
  controlTrainRows,
  oosRows,
  controlOosRows: [],
  supportCases,
})
const bankContract = buildPerfectPrototypeFeatureBankContract({
  bankId: "daily_symbolic_microcard_bank_v1",
  hypotheses: buildPerfectPrototypeDailySymbolicMicrocardHypothesisCatalog(),
})
const sidecarStore = buildPerfectPrototypeFeatureBankSidecarStore({ family, bankContract })
family = assemblePerfectPrototypeFeatureBankRows({ family, sidecarStore })
family = buildPerfectPrototypeDailyTradeSlateDataset({ family })
family = calibratePerfectPrototypeDailyTradeAbstainGateV2({
  family,
  minTradeDates: 10,
  minTradeMonths: 6,
  minTradeFolds: 4,
})
family = buildPerfectPrototypeDailySymbolicGlyphBank({ family })
family = buildPerfectPrototypeDailySymbolicStateGrammar({ family })
family = buildPerfectPrototypeDailySymbolicSlateContrast({ family })
family = buildPerfectPrototypeDailyTradeWitnessSelector({ family })
family = buildPerfectPrototypeDailySymbolicMicrocardRouter({ family, minCardDateCount: 4, maxCardCount: 5, maxCardShare: 0.8 })
family = buildPerfectPrototypeDailySymbolicExactBank({
  family,
  minTrainMatchedDates: 6,
  minTrainMatchedMonths: 4,
  minTrainMatchedFolds: 4,
  maxCrossfitNegativeWindows: 0,
  minOosMatchCount: 1,
})

assert.equal(sidecarStore.ok, true)
assert.equal(family.summary?.tradeGatePrecision, 1)
assert.ok((family.summary?.witnessQualifiedCount ?? 0) > 0)
assert.ok((family.summary?.microCardCount ?? 0) >= 2)
assert.ok((family.summary?.symbolicRuleBankCandidateCount ?? 0) > 0)
