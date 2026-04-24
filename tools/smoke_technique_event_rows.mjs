#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildTechniqueEventMatchesForRow } from "../src/lib/technique_event_row_builder.mjs"

const template = {
  candidateTemplateId: "smoke_template_ma_retest",
  seedId: "smoke_seed",
  mechanismId: "MA_RETEST",
  clauseSet: {
    anchor: ["anchor_ma120_break"],
    retest: ["retest_support_ma60"],
    compression: ["compression_impulse_then_dryup5"],
    confirm: ["confirm_close_near_high", "confirm_value_ratio"],
    invalidate: ["invalidate_failed_break_risk"],
  },
  allClauseIds: [
    "anchor_ma120_break",
    "confirm_close_near_high",
    "confirm_value_ratio",
    "compression_impulse_then_dryup5",
    "invalidate_failed_break_risk",
    "retest_support_ma60",
  ],
  scopeCandidates: ["LOW_GAP_TOP"],
  lookbackCandidateIds: ["lb5"],
}

const matchingRow = {
  symbol: "005930",
  decisionDateKey: "2024-05-13",
  scopeId: "LOW_GAP_TOP",
  lookbackCandidateId: "lb5",
  labels: {
    tp12_no_stop_hit_3d: true,
  },
  numericFeatureMap: {
    "trend.closeOverMa120": 0.02,
    "pattern.supportHoldAtMa60": 0.82,
    "chain.impulseThenDryUp5": 0.67,
    "level.closeNearHigh20": 0.88,
    "volume.valueRatio20": 1.42,
    "score.failedBreakRisk": 0.21,
  },
}

const main = async () => {
  const matches = buildTechniqueEventMatchesForRow({
    row: matchingRow,
    templates: [template],
    labelId: "tp12_no_stop_hit_3d",
  })
  assert.equal(matches.length, 1)
  assert.equal(matches[0].candidateTemplateId, "smoke_template_ma_retest")
  assert.equal(matches[0].hitTarget, true)
  assert.equal(matches[0].bankId, "MA_RETEST__LOW_GAP_TOP__lb5")
  assert.equal(matches[0].yearKey, 2024)

  const mismatched = buildTechniqueEventMatchesForRow({
    row: {
      ...matchingRow,
      scopeId: "MID",
    },
    templates: [template],
    labelId: "tp12_no_stop_hit_3d",
  })
  assert.equal(mismatched.length, 0)
  console.log("ok smoke_technique_event_rows")
}

await main()
