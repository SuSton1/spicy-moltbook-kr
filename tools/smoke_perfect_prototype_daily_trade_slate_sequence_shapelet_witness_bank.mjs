#!/usr/bin/env node
import assert from "node:assert/strict"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "../src/lib/perfect_prototype_support_case.mjs"
import { buildCandleDateIndexMap, buildCandleSeriesMap } from "../src/lib/data.mjs"
import { buildPerfectPrototypeDailyCanonicalWinnerSlateDataset } from "../src/lib/perfect_prototype_daily_canonical_winner_slate_dataset.mjs"
import {
  buildPerfectPrototypeDailyMechanismHypothesisCatalog,
  buildPerfectPrototypeFeatureBankContract,
} from "../src/lib/perfect_prototype_feature_bank_contract.mjs"
import { buildPerfectPrototypeFeatureBankSidecarStore } from "../src/lib/perfect_prototype_feature_bank_sidecar_store.mjs"
import { assemblePerfectPrototypeFeatureBankRows } from "../src/lib/perfect_prototype_feature_bank_assembler.mjs"
import { buildPerfectPrototypeDailyTradeSlateDataset } from "../src/lib/perfect_prototype_daily_trade_slate_dataset.mjs"
import { calibratePerfectPrototypeDailyTradeAbstainGateV2 } from "../src/lib/perfect_prototype_daily_trade_abstain_gate_v2.mjs"
import { buildPerfectPrototypeDailySequenceShapeletBank } from "../src/lib/perfect_prototype_daily_sequence_shapelet_bank.mjs"
import { buildPerfectPrototypeDailySymbolicSlateContrast } from "../src/lib/perfect_prototype_daily_symbolic_slate_contrast.mjs"
import { buildPerfectPrototypeDailyBagLatentWitnessSelector } from "../src/lib/perfect_prototype_daily_bag_latent_witness_selector.mjs"
import { buildPerfectPrototypeDailyShapeletPrototypeRouter } from "../src/lib/perfect_prototype_daily_shapelet_prototype_router.mjs"
import { buildPerfectPrototypeDailyShapeletExactBank } from "../src/lib/perfect_prototype_daily_shapelet_exact_bank.mjs"

const sameDayToken = "tag:stepa.lane:same_day_high8"
const recentToken = "tag:stepa.lane:recent_impulse_1d"

const addDays = (dateKey, delta) => {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

const buildDates = (decisionDateKey, count) =>
  Array.from({ length: count }, (_, index) => addDays(decisionDateKey, index - (count - 1)))

const seriesModePoint = ({ mode, index, total }) => {
  const late = index >= total - 5
  const mid = index >= total - 12
  if (mode === "A") {
    return {
      ret: late ? 0.022 : mid ? 0.006 : 0.001,
      vol: late ? 4.2 : mid ? 2.0 : 1.0,
      range: late ? 0.034 : 0.018,
    }
  }
  if (mode === "B") {
    return {
      ret: late ? 0.018 : mid ? 0.012 : index < 8 ? -0.006 : 0.001,
      vol: late ? 3.5 : mid ? 2.2 : 1.1,
      range: late ? 0.03 : 0.017,
    }
  }
  if (mode === "C") {
    return {
      ret: late ? 0.016 : mid ? 0.009 : 0.0005,
      vol: late ? 4.8 : mid ? 1.6 : 0.7,
      range: late ? 0.028 : 0.012,
    }
  }
  if (mode === "NEG") {
    return {
      ret: late ? -0.01 : mid ? 0.004 : 0.002,
      vol: late ? 2.3 : 1.4,
      range: late ? 0.04 : 0.022,
    }
  }
  return {
    ret: late ? -0.004 : 0.0005,
    vol: late ? 1.2 : 0.8,
    range: late ? 0.018 : 0.012,
  }
}

const buildSeries = ({ symbol, decisionDateKey, mode }) => {
  const dates = buildDates(decisionDateKey, 36)
  let close = 100
  return dates.map((dateKey, index) => {
    const point = seriesModePoint({ mode, index, total: dates.length })
    const open = close
    close = close * (1 + point.ret)
    const high = Math.max(open, close) * (1 + point.range * 0.45)
    const low = Math.min(open, close) * (1 - point.range * 0.55)
    return {
      symbol,
      dateKey,
      open,
      high,
      low,
      close,
      volume: 1000000 * point.vol * (1 + index / dates.length),
    }
  })
}

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
  decisionDateKey: dateKey,
  asOfDateKey: addDays(dateKey, -1),
  monthKey: dateKey.slice(0, 7),
  foldId,
  windowId,
  outcomeHitTarget: hit === true,
  eventOutcome: {
    hitTarget: hit === true,
    netRet,
    entryDateKey: addDays(dateKey, 1),
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

const positiveDates = [
  ["2023-01-11", "A", 1, 1],
  ["2023-03-15", "A", 2, 2],
  ["2023-05-17", "A", 3, 3],
  ["2023-07-12", "A", 4, 4],
  ["2024-01-15", "B", 1, 5],
  ["2024-03-18", "B", 2, 6],
  ["2024-05-13", "B", 3, 1],
  ["2024-07-15", "B", 4, 2],
  ["2024-09-16", "C", 1, 3],
  ["2024-10-14", "C", 2, 4],
  ["2024-11-11", "C", 3, 5],
  ["2024-12-16", "C", 4, 6],
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
  ["2025-02-03", "A", 1, 1],
  ["2025-04-14", "B", 2, 2],
  ["2025-07-21", "C", 3, 3],
]

const trainRows = []
const candles = []
for (const [dateKey, mode, foldId, windowId] of positiveDates) {
  const winnerSymbol = `W${mode}${dateKey.slice(-2)}`
  const loserSymbol = `L${mode}${dateKey.slice(-2)}`
  candles.push(...buildSeries({ symbol: winnerSymbol, decisionDateKey: dateKey, mode }))
  candles.push(...buildSeries({ symbol: loserSymbol, decisionDateKey: dateKey, mode: "NEG" }))
  trainRows.push(
    makeRow({
      rowKey: `${dateKey}::${winnerSymbol}`,
      symbol: winnerSymbol,
      dateKey,
      foldId,
      windowId,
      hit: true,
      netRet: 0.17,
      bodyPct: mode === "A" ? 0.68 : mode === "B" ? 0.56 : 0.62,
      rangePct: mode === "C" ? 0.052 : 0.07,
      valueRatio20: mode === "C" ? 2.6 : 1.9,
      runUp10: mode === "B" ? 0.13 : 0.16,
      closeOverMa20: 0.05,
      closeOverMa120: 0.02,
      closeNearHigh20: 0.88,
      breakoutPauseScore: mode === "A" ? 0.79 : 0.66,
      failedBreakoutCount20: 0,
      liquidityStress: 0.09,
    }),
    makeRow({
      rowKey: `${dateKey}::${loserSymbol}`,
      symbol: loserSymbol,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.03,
      bodyPct: 0.22,
      rangePct: 0.09,
      valueRatio20: 0.92,
      runUp10: 0.08,
      closeOverMa20: 0.06,
      closeOverMa120: 0.04,
      closeNearHigh20: 0.48,
      breakoutPauseScore: 0.25,
      failedBreakoutCount20: 2,
      liquidityStress: 0.24,
    }),
  )
}

const controlTrainRows = []
for (const [dateKey, foldId, windowId] of controlDates) {
  const symbol = `C${dateKey.slice(-2)}`
  candles.push(...buildSeries({ symbol, decisionDateKey: dateKey, mode: "CTRL" }))
  controlTrainRows.push(
    makeRow({
      rowKey: `${dateKey}::${symbol}`,
      symbol,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.04,
      bodyPct: 0.12,
      rangePct: 0.08,
      valueRatio20: 0.6,
      runUp10: 0.01,
      closeOverMa20: 0.01,
      closeOverMa120: 0.01,
      closeNearHigh20: 0.4,
      breakoutPauseScore: 0.18,
      failedBreakoutCount20: 3,
      liquidityStress: 0.29,
    }),
  )
}

const oosRows = []
for (const [dateKey, mode, foldId, windowId] of oosDates) {
  const winnerSymbol = `O${mode}${dateKey.slice(-2)}`
  const loserSymbol = `Q${mode}${dateKey.slice(-2)}`
  candles.push(...buildSeries({ symbol: winnerSymbol, decisionDateKey: dateKey, mode }))
  candles.push(...buildSeries({ symbol: loserSymbol, decisionDateKey: dateKey, mode: "NEG" }))
  oosRows.push(
    makeRow({
      rowKey: `${dateKey}::${winnerSymbol}`,
      symbol: winnerSymbol,
      dateKey,
      foldId,
      windowId,
      hit: true,
      netRet: 0.16,
      bodyPct: 0.61,
      rangePct: 0.068,
      valueRatio20: 2.1,
      runUp10: 0.15,
      closeOverMa20: 0.05,
      closeOverMa120: 0.02,
      closeNearHigh20: 0.89,
      breakoutPauseScore: 0.72,
      failedBreakoutCount20: 0,
      liquidityStress: 0.09,
    }),
    makeRow({
      rowKey: `${dateKey}::${loserSymbol}`,
      symbol: loserSymbol,
      dateKey,
      foldId,
      windowId,
      hit: false,
      netRet: -0.04,
      bodyPct: 0.21,
      rangePct: 0.091,
      valueRatio20: 0.85,
      runUp10: 0.09,
      closeOverMa20: 0.06,
      closeOverMa120: 0.05,
      closeNearHigh20: 0.47,
      breakoutPauseScore: 0.24,
      failedBreakoutCount20: 2,
      liquidityStress: 0.23,
    }),
  )
}

const supportCases = [
  {
    caseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
    symbol: "076610",
    dateKey: "2026-03-18",
    numericFeatureMap: {
      "candle.bodyPct": 0.64,
      "candle.rangePct": 0.071,
      "volume.valueRatio20": 2.1,
      "volume.liquidityStress": 0.08,
      "trend.runUp10": 0.14,
      "trend.closeOverMa20": 0.05,
      "trend.closeOverMa120": 0.02,
      "level.closeNearHigh20": 0.9,
      "shape.breakoutPauseScore": 0.73,
      "shape.failedBreakoutCount20": 0,
      "global.valueRatio20Over150": 1.7,
    },
    categoricalTokens: [sameDayToken, recentToken],
    tokens: [sameDayToken, recentToken, "tag:support:haesung"],
    donorTokens: [],
  },
]

candles.push(...buildSeries({ symbol: "076610", decisionDateKey: "2026-03-18", mode: "A" }))
const seriesMap = buildCandleSeriesMap(candles)
const dateIndexMap = buildCandleDateIndexMap(seriesMap)

let family = buildPerfectPrototypeDailyCanonicalWinnerSlateDataset({
  familyId: "daily_trade_slate_sequence_shapelet_witness_bank",
  discoveryUniverseId: "same_day_plus_recent_upto_1d",
  trainRows,
  oosRows,
  controlTrainRows,
  controlOosRows: [],
  supportCases,
})
assert.equal(family.ok, true)

const bankContract = buildPerfectPrototypeFeatureBankContract({
  bankId: "daily_trade_slate_sequence_shapelet_pregate_v1",
  targetUniverseId: "daily_trade_slate_v1",
  hypotheses: buildPerfectPrototypeDailyMechanismHypothesisCatalog(),
})
const sidecarStore = buildPerfectPrototypeFeatureBankSidecarStore({ family, bankContract })
assert.equal(sidecarStore.ok, true)
family = assemblePerfectPrototypeFeatureBankRows({ family, sidecarStore })
family = buildPerfectPrototypeDailyTradeSlateDataset({ family, targetUniverseId: "daily_trade_slate_v1" })
assert.equal(family.ok, true)
family = calibratePerfectPrototypeDailyTradeAbstainGateV2({
  family,
  minTradeDates: 10,
  minTradeMonths: 6,
  minTradeFolds: 4,
  maxFeaturePool: 8,
  maxFeatureCount: 4,
})
assert.equal(family.ok, true)

family = await buildPerfectPrototypeDailySequenceShapeletBank({
  family,
  seriesMap,
  dateIndexMap,
})
assert.equal(family.ok, true)
assert.ok(Number(family?.summary?.sequenceShapeletRowCount ?? 0) > 0)

family = buildPerfectPrototypeDailySymbolicSlateContrast({ family })
family = buildPerfectPrototypeDailyBagLatentWitnessSelector({ family })
assert.equal(family.ok, true)
assert.ok(Number(family?.summary?.witnessQualifiedCount ?? 0) >= 12)
assert.ok(Number(family?.summary?.witnessDistinctSignatureCount ?? 0) >= 3)

family = buildPerfectPrototypeDailyShapeletPrototypeRouter({ family, minCardDateCount: 2, maxCardCount: 5, maxCardShare: 0.75 })
assert.equal(family.ok, true)
assert.ok(Number(family?.summary?.prototypeCount ?? 0) >= 2)
assert.ok(Number(family?.summary?.maxPrototypeShare ?? 1) <= 0.75)

family = buildPerfectPrototypeDailyShapeletExactBank({
  family,
  minTrainMatchedDates: 10,
  minTrainMatchedMonths: 6,
  minTrainMatchedFolds: 4,
  maxCrossfitNegativeWindows: 0,
  minOosMatchCount: 1,
})
assert.ok(Number(family?.summary?.shapeletHypothesisCount ?? 0) === 3)
assert.ok(Number(family?.summary?.shapeletRuleBankCandidateCount ?? 0) > 0)

console.log("ok: daily trade-slate sequence shapelet witness bank smoke")
