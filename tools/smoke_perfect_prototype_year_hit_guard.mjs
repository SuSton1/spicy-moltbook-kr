#!/usr/bin/env node
import assert from "node:assert/strict"

import {
  PERFECT_PROTOTYPE_YEAR_HIT_UPPER_BOUND_REASON,
  buildPerfectPrototypeYearHitCountsFromHitDates,
  evaluatePerfectPrototypeYearHitUpperBoundGuard,
  evaluatePerfectPrototypeYearHitUpperBoundGuardFromCounts,
} from "../src/lib/perfect_prototype_year_hit_guard.mjs"

const main = async () => {
  const counts = buildPerfectPrototypeYearHitCountsFromHitDates({
    hitDates: [
      "2016-12-30",
      "2017-01-03",
      "2017-02-03",
      "2018-03-05",
      "2018-05-07",
      "2019-06-03",
      "2024-12-27",
      "2024-12-30",
    ],
    coreYears: [2017, 2018, 2019, 2024],
    excludedBoundaryYears: [2016],
  })
  assert.deepEqual(counts.coreYearHitCounts, {
    "2017": 2,
    "2018": 2,
    "2019": 1,
    "2024": 2,
  })
  assert.equal(counts.allYearHitCounts["2016"], undefined)

  const failing = evaluatePerfectPrototypeYearHitUpperBoundGuardFromCounts({
    coreYearHitCounts: counts.coreYearHitCounts,
    coreYears: [2017, 2018, 2019, 2024],
    minTrainHitsPerCoreYear: 2,
  })
  assert.equal(failing.ok, false)
  assert.equal(failing.reason, PERFECT_PROTOTYPE_YEAR_HIT_UPPER_BOUND_REASON)
  assert.deepEqual(failing.violatingYears, [2019])
  assert.equal(failing.coreYearSatisfiedCount, 3)
  assert.equal(failing.minCoreYearHitCount, 1)

  const passing = evaluatePerfectPrototypeYearHitUpperBoundGuard({
    hitDates: [
      "2017-01-03",
      "2017-02-03",
      "2018-03-05",
      "2018-05-07",
      "2019-06-03",
      "2019-06-10",
      "2024-12-27",
      "2024-12-30",
    ],
    coreYears: [2017, 2018, 2019, 2024],
    excludedBoundaryYears: [2016],
    minTrainHitsPerCoreYear: 2,
  })
  assert.equal(passing.ok, true)
  assert.equal(passing.reason, null)
  assert.equal(passing.coreYearSatisfiedCount, 4)
  assert.equal(passing.minCoreYearHitCount, 2)
  console.log("ok smoke_perfect_prototype_year_hit_guard")
}

await main()
