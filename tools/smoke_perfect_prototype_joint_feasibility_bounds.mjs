import assert from "node:assert/strict"

import {
  buildPerfectPrototypeJointFeasibilityBounds,
  evaluatePerfectPrototypeJointFeasibilityBounds,
} from "../src/lib/perfect_prototype_joint_feasibility_bounds.mjs"

const familyId = "low_gap_top_continuation"

const bounds = buildPerfectPrototypeJointFeasibilityBounds({
  familyId,
  cfg: {
    lowFamilyMinTrainMatchedDates: 10,
    lowFamilyMinTrainMatchedMonths: 6,
    lowFamilyMinTrainMatchedFolds: 4,
    jointFeasibilityMinCrossfitPositiveWindows: 2,
    jointFeasibilityMaxCrossfitNegativeWindows: 0,
    jointFeasibilityRequireHistoricalSupport: true,
    jointFeasibilityHistoricalSupportCaseIds: ["076610:2026-03-18"],
  },
})

const supportCases = [
  {
    caseId: "076610:2026-03-18",
    symbol: "076610",
    dateKey: "2026-03-18",
    familyIds: [familyId],
    tokens: ["tag:test:a", "tag:test:b", "tag:test:c"],
  },
]

const passing = evaluatePerfectPrototypeJointFeasibilityBounds({
  familyId,
  tokens: ["tag:test:a", "tag:test:b"],
  positiveHitStats: {
    distinctDateCount: 10,
    matchedMonthCount: 6,
    matchedFoldCount: 4,
  },
  crossfitMatchedWindowCount: 2,
  crossfitNegativeWindowCount: 0,
  supportCases,
  bounds,
})

assert.equal(passing.ok, true)
assert.equal(passing.historicalSupportMatched, true)
assert.equal(passing.crossfitRetainedPositiveWindowCount, 2)
assert.equal(passing.crossfitNegativeWindowCount, 0)

const failing = evaluatePerfectPrototypeJointFeasibilityBounds({
  familyId,
  tokens: ["tag:test:a", "tag:test:z"],
  positiveHitStats: {
    distinctDateCount: 9,
    matchedMonthCount: 5,
    matchedFoldCount: 3,
  },
  crossfitMatchedWindowCount: 1,
  crossfitNegativeWindowCount: 1,
  supportCases,
  bounds,
})

assert.equal(failing.ok, false)
assert.ok(failing.reasons.includes("unsat_train_breadth"))
assert.ok(failing.reasons.includes("unsat_crossfit_negative_windows"))
assert.ok(failing.reasons.includes("unsat_crossfit_positive_recurrence"))
assert.ok(failing.reasons.includes("unsat_historical_support"))

console.log("ok")
