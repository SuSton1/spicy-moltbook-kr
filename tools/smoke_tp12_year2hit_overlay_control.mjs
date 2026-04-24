#!/usr/bin/env node

import assert from "node:assert/strict"

import { buildTp12Year2hitGateSummary } from "../src/lib/tp12_year2hit_overlay_control.mjs"

const summary = buildTp12Year2hitGateSummary({
  controlSummary: {
    runId: "control",
    yearHitMetric: "hit_rows",
    screen: {
      primary: {
        selectedRows: 100,
        hitRows: 30,
        hitRate: 0.3,
        usableWindowCount: 5,
        maxTop1DateShare: 0.1,
        uniqueMatchedDates: 20,
      },
    },
    finalConfirm: {
      primary: {
        selectedRows: 40,
        hitRows: 12,
        hitRate: 0.3,
        usableWindowCount: 1,
        maxTop1DateShare: 0.08,
        uniqueMatchedDates: 10,
      },
    },
  },
  gatedSummary: {
    runId: "gated",
    yearHitMetric: "unique_decision_dates",
    screen: {
      primary: {
        selectedRows: 80,
        hitRows: 28,
        hitRate: 0.35,
        usableWindowCount: 5,
        maxTop1DateShare: 0.06,
        uniqueMatchedDates: 18,
      },
    },
    finalConfirm: {
      primary: {
        selectedRows: 35,
        hitRows: 14,
        hitRate: 0.4,
        usableWindowCount: 1,
        maxTop1DateShare: 0.05,
        uniqueMatchedDates: 9,
      },
    },
  },
})

assert.equal(summary.screen.retentionRatio, 0.8)
assert.equal(summary.screen.deltaHitRate, 0.05)
assert.equal(summary.finalConfirm.deltaHitRate, 0.1)

console.log("ok smoke_tp12_year2hit_overlay_control")
