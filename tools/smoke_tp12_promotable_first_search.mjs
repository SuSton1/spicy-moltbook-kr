import assert from "node:assert/strict"

import { comparePerfectPrototypeRules } from "../src/lib/perfect_prototype_rule.mjs"
import { evaluatePerfectPrototypePromotableUpperBoundGuard } from "../src/lib/perfect_prototype_search_bounds.mjs"

const failDateGuard = evaluatePerfectPrototypePromotableUpperBoundGuard({
  distinctDateUpperBound: 9,
  matchedMonthUpperBound: 6,
  matchedFoldUpperBound: 4,
  minTrainMatchedDates: 10,
  minTrainMatchedMonths: 6,
  minTrainMatchedFolds: 4,
})
assert.equal(failDateGuard.ok, false)
assert.equal(failDateGuard.reason, "PROMOTABLE_UPPER_BOUND_BELOW_MIN_TRAIN_MATCHED_DATES")

const passGuard = evaluatePerfectPrototypePromotableUpperBoundGuard({
  distinctDateUpperBound: 12,
  matchedMonthUpperBound: 7,
  matchedFoldUpperBound: 4,
  minTrainMatchedDates: 10,
  minTrainMatchedMonths: 6,
  minTrainMatchedFolds: 4,
  maxTop1DateHitShare: 0.4,
  maxTop3DateHitShare: 0.55,
  maxTop1FoldHitShare: 0.35,
  maxTop3FoldHitShare: 0.85,
  topDateHitCounts: [2, 2, 2, 1, 1, 1, 1, 1, 1, 1],
  topFoldHitCounts: [3, 3, 3, 3],
})
assert.equal(passGuard.ok, true)
assert.equal(passGuard.reason, null)

const nullShareGuard = evaluatePerfectPrototypePromotableUpperBoundGuard({
  distinctDateUpperBound: 12,
  matchedMonthUpperBound: 7,
  matchedFoldUpperBound: 4,
  minTrainMatchedDates: 6,
  minTrainMatchedMonths: 4,
  minTrainMatchedFolds: 3,
  maxTop1DateHitShare: null,
  maxTop3DateHitShare: null,
  maxTop1FoldHitShare: null,
  maxTop3FoldHitShare: null,
})
assert.equal(nullShareGuard.ok, true)
assert.equal(nullShareGuard.reason, null)

const broaderRule = {
  ruleId: "broad",
  tokens: ["tag:a", "tag:b"],
  matchedFoldCount: 4,
  matchedMonthCount: 7,
  matchedDateCount: 12,
  top1DateHitShare: 0.18,
  top3DateHitShare: 0.32,
  top1FoldHitShare: 0.31,
  top3FoldHitShare: 0.82,
  cappedHitCount: 12,
  effectiveHitCount: 12,
  positiveCount: 12,
  negativeCount: 0,
  precision: 1,
  promotableOrdering: true,
}
const narrowerRule = {
  ruleId: "narrow",
  tokens: ["tag:a", "tag:b", "tag:c"],
  matchedFoldCount: 3,
  matchedMonthCount: 5,
  matchedDateCount: 9,
  top1DateHitShare: 0.33,
  top3DateHitShare: 0.67,
  top1FoldHitShare: 0.5,
  top3FoldHitShare: 1,
  cappedHitCount: 12,
  effectiveHitCount: 12,
  positiveCount: 12,
  negativeCount: 0,
  precision: 1,
  promotableOrdering: true,
}
assert.ok(comparePerfectPrototypeRules(broaderRule, narrowerRule) < 0)
assert.ok(comparePerfectPrototypeRules(narrowerRule, broaderRule) > 0)

console.log("ok: smoke_tp12_promotable_first_search")
