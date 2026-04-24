#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildPerfectPrototypeSupportExpertComplementFrontier } from "../src/lib/perfect_prototype_support_expert_complement_frontier.mjs"

const makeExpert = ({ expertId, groupId, dates = [], months = [], folds = [] } = {}) => ({
  expertId,
  groupId,
  trainSummary: {
    trainMatchedDateCount: dates.length,
    trainMatchedMonthCount: months.length,
    trainMatchedFoldCount: folds.length,
    matchedDateKeys: dates,
    matchedMonthKeys: months,
    matchedFoldIds: folds,
  },
})

const frontier = buildPerfectPrototypeSupportExpertComplementFrontier({
  experts: [
    makeExpert({
      expertId: "E1",
      groupId: "B1",
      dates: ["2026-01-03", "2026-02-03", "2026-03-03"],
      months: ["2026-01", "2026-02", "2026-03"],
      folds: [1, 2],
    }),
    makeExpert({
      expertId: "E2",
      groupId: "B1",
      dates: ["2026-01-03", "2026-02-03", "2026-03-03"],
      months: ["2026-01", "2026-02", "2026-03"],
      folds: [1, 2],
    }),
    makeExpert({
      expertId: "E3",
      groupId: "B2",
      dates: ["2026-04-03", "2026-05-03"],
      months: ["2026-04", "2026-05"],
      folds: [3],
    }),
  ],
  maxExperts: 3,
})

assert.equal(frontier.expertCount, 3)
assert.equal(frontier.distinctMatchedDateSignatureCount, 2)
assert.equal(frontier.coverageFrontierQualifiedCount, 2)
assert.equal(frontier.frontierExperts[0].expertId, "E1")
assert.equal(frontier.frontierExperts[1].expertId, "E3")
assert.equal(
  Number(frontier.coverageFrontierRejectReasonCounts.unsat_expert_no_marginal_coverage_gain ?? 0),
  1,
)

console.log("ok: support expert complement frontier")
