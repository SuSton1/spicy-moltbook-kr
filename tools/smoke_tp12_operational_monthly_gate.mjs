#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import {
  TP12_OPERATIONAL_HIT_DEFINITION,
  TP12_OPERATIONAL_HIT_FIELD,
} from "../src/lib/tp12_operational_hit_contract.mjs"
import { buildTp12Year2hitOperatingGateSummary } from "../src/lib/tp12_year2hit_operating_gate.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-operational-monthly-gate-"))
try {
  const goodReplayPath = path.join(tmp, "good_replay.json")
  const badReplayPath = path.join(tmp, "bad_replay.json")
  const goodOutPath = path.join(tmp, "good_operating_gate.json")
  const badOutPath = path.join(tmp, "bad_operating_gate.json")
  const baseMetric = {
    selectedRows: 5,
    hitRows: 5,
    uniqueMatchedDates: 5,
    uniqueHitDates: 5,
    uniqueMatchedSymbols: 5,
    uniqueHitSymbols: 5,
    top1DateShare: 0.2,
    top1HitDateShare: 0.2,
  }
  const baseReplay = {
    kind: "tp12_operational_monthly_smoke_replay_v1",
    status: "measured",
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    hitField: TP12_OPERATIONAL_HIT_FIELD,
    onePickPerDay: baseMetric,
    monthlyCadence: {
      kind: "tp12_operational_monthly_cadence_summary_v1",
      minExecutableRecommendationsPerFullMonth: 5,
      fullMonthStats: [
        {
          monthKey: "2024-01",
          fullMonthEligible: true,
          selectedRows: 5,
          executableRecommendationCount: 5,
          operationalHitRows: 5,
        },
      ],
    },
  }
  await writeJson(goodReplayPath, baseReplay)
  await writeJson(badReplayPath, {
    ...baseReplay,
    monthlyCadence: {
      ...baseReplay.monthlyCadence,
      fullMonthStats: [
        {
          ...baseReplay.monthlyCadence.fullMonthStats[0],
          executableRecommendationCount: 4,
        },
      ],
    },
  })
  const good = await buildTp12Year2hitOperatingGateSummary({
    replaySummaryPath: goodReplayPath,
    outSummaryPath: goodOutPath,
    hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
    hitField: TP12_OPERATIONAL_HIT_FIELD,
    targetObservedHitRate: 1,
    minWilsonLowerBound95: 0,
    minSelectedRows: 5,
    minUniqueMatchedDates: 5,
    minUniqueMatchedSymbols: 5,
    maxTop1DateShare: 1,
    requireMonthlyCadence: true,
    minExecutableRecommendationsPerFullMonth: 5,
    failOnGateFailure: true,
  })
  assert.equal(good.status, "passed")

  await assert.rejects(
    () =>
      buildTp12Year2hitOperatingGateSummary({
        replaySummaryPath: badReplayPath,
        outSummaryPath: badOutPath,
        hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
        hitField: TP12_OPERATIONAL_HIT_FIELD,
        targetObservedHitRate: 1,
        minWilsonLowerBound95: 0,
        minSelectedRows: 5,
        minUniqueMatchedDates: 5,
        minUniqueMatchedSymbols: 5,
        maxTop1DateShare: 1,
        requireMonthlyCadence: true,
        minExecutableRecommendationsPerFullMonth: 5,
        failOnGateFailure: true,
      }),
    /monthly_executable_recommendations_below_min:2024-01/,
  )

  console.log("ok smoke_tp12_operational_monthly_gate")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
