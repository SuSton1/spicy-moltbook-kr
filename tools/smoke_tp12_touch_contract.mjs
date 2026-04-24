#!/usr/bin/env node
import assert from "node:assert/strict"

import {
  TP12_TOUCH_DISCOVERY_CONTRACT,
  relabelPerfectPrototypeRowForTp12TouchContract,
  simulatePerfectPrototypeTp12TouchFromDecision,
} from "../src/lib/perfect_prototype_tp12_touch_contract.mjs"

const stopBeforeTouchSeries = [
  { dateKey: "2025-01-01", open: 90, high: 95, low: 88, close: 92 },
  { dateKey: "2025-01-02", open: 100, high: 114, low: 95, close: 112 },
  { dateKey: "2025-01-03", open: 112, high: 113, low: 100, close: 108 },
  { dateKey: "2025-01-06", open: 108, high: 110, low: 102, close: 105 },
]
const touchOnlySeries = [
  { dateKey: "2025-02-03", open: 90, high: 95, low: 88, close: 92 },
  { dateKey: "2025-02-04", open: 100, high: 113, low: 98, close: 111 },
  { dateKey: "2025-02-05", open: 111, high: 114, low: 106, close: 113 },
  { dateKey: "2025-02-06", open: 113, high: 115, low: 109, close: 114 },
]

const stopBeforeTouch = simulatePerfectPrototypeTp12TouchFromDecision({
  series: stopBeforeTouchSeries,
  decisionIdx: 0,
})
assert.equal(stopBeforeTouch?.touchedTarget, true)
assert.equal(stopBeforeTouch?.touchIdx, 1)
assert.equal(stopBeforeTouch?.stopBeforeTouch, true)
assert.equal(stopBeforeTouch?.sameBarStopFirstAtTouch, true)
assert.ok(Math.abs((stopBeforeTouch?.targetPrice ?? 0) - 112) < 1e-9)
assert.ok(Math.abs((stopBeforeTouch?.stopPrice ?? 0) - 96) < 1e-9)

const touchOnly = simulatePerfectPrototypeTp12TouchFromDecision({
  series: touchOnlySeries,
  decisionIdx: 0,
})
assert.equal(touchOnly?.touchedTarget, true)
assert.equal(touchOnly?.stopBeforeTouch, false)
assert.equal(touchOnly?.touchIdx, 1)

const relabeled = relabelPerfectPrototypeRowForTp12TouchContract({
  row: {
    sourceId: "row_1",
    symbol: "000001",
    dateKey: "2025-02-03",
    decisionIdx: 0,
    outcomeHitTarget: false,
    categoricalTokens: ["tag:scope:gap_top"],
    contextualTokens: ["tag:xsec.closeRank:LOW"],
  },
  seriesMap: new Map([["000001", touchOnlySeries]]),
  holdDays: TP12_TOUCH_DISCOVERY_CONTRACT.holdDays,
  targetPct: TP12_TOUCH_DISCOVERY_CONTRACT.targetPct,
  stopLossPct: TP12_TOUCH_DISCOVERY_CONTRACT.stopLossPct,
})
assert.equal(relabeled.cleanOutcomeHitTarget, false)
assert.equal(relabeled.outcomeHitTarget, true)
assert.equal(relabeled.touchOutcome?.touchDateKey, "2025-02-04")
console.log("ok: smoke_tp12_touch_contract")
