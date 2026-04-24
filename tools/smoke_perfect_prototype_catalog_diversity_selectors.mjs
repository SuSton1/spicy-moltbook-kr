import assert from "node:assert/strict"

import {
  applyPerfectPrototypeTemporalSignatureCaps,
  selectDiversePerfectPrototypeRules,
} from "../src/lib/perfect_prototype_catalog_diversify.mjs"
import { selectPerfectPrototypeMdlRules } from "../src/lib/perfect_prototype_catalog_mdl.mjs"

const rows = [
  { sourceId: "r1", symbol: "AAA", dateKey: "2024-01-10", stepALaneId: "same_day_high8" },
  { sourceId: "r2", symbol: "AAB", dateKey: "2024-02-14", stepALaneId: "same_day_high8" },
  { sourceId: "r3", symbol: "AAC", dateKey: "2024-05-09", stepALaneId: "recent_impulse_1d" },
  { sourceId: "r4", symbol: "AAD", dateKey: "2024-08-13", stepALaneId: "recent_impulse_2d" },
  { sourceId: "r5", symbol: "AAE", dateKey: "2024-11-18", stepALaneId: "recent_impulse_3d" },
]

const makeRule = ({
  ruleId,
  tokens,
  positiveMatchRowIndexes,
  trainHitCount,
  matchedDateCount,
  matchedMonthCount,
  matchedQuarterCount,
  top3DateHitShare,
  matchedDateSignatureHash,
  matchedMonthSignatureHash,
  matchedQuarterSignatureHash,
}) => ({
  ruleId,
  tokens,
  trainHitCount,
  trainMatchCount: trainHitCount,
  trainNegativeCount: 0,
  ruleSize: Array.isArray(tokens) ? tokens.length : 0,
  precision: 1,
  matchedDateCount,
  matchedMonthCount,
  matchedQuarterCount,
  top3DateHitShare,
  positiveMatchRowIndexes,
  matchedDateSignatureHash,
  matchedMonthSignatureHash,
  matchedQuarterSignatureHash,
})

const main = async () => {
  const duplicatedA = makeRule({
    ruleId: "PP_DUP_A",
    tokens: ["tag:market.jumpRegime:QUIET", "num:feature.gap.A01"],
    positiveMatchRowIndexes: [0, 1],
    trainHitCount: 20,
    matchedDateCount: 2,
    matchedMonthCount: 2,
    matchedQuarterCount: 1,
    top3DateHitShare: 0.25,
    matchedDateSignatureHash: "sig-date-dup",
    matchedMonthSignatureHash: "sig-month-dup",
    matchedQuarterSignatureHash: "sig-quarter-dup",
  })
  const duplicatedB = makeRule({
    ruleId: "PP_DUP_B",
    tokens: ["tag:market.jumpRegime:QUIET", "num:feature.gap.A02"],
    positiveMatchRowIndexes: [0, 1],
    trainHitCount: 19,
    matchedDateCount: 2,
    matchedMonthCount: 2,
    matchedQuarterCount: 1,
    top3DateHitShare: 0.2,
    matchedDateSignatureHash: "sig-date-dup",
    matchedMonthSignatureHash: "sig-month-dup",
    matchedQuarterSignatureHash: "sig-quarter-dup",
  })
  const broadB = makeRule({
    ruleId: "PP_BROAD_B",
    tokens: ["tag:market.jumpRegime:TREND", "num:feature.gap.B01"],
    positiveMatchRowIndexes: [2, 3],
    trainHitCount: 18,
    matchedDateCount: 2,
    matchedMonthCount: 2,
    matchedQuarterCount: 2,
    top3DateHitShare: 0.2,
    matchedDateSignatureHash: "sig-date-b",
    matchedMonthSignatureHash: "sig-month-b",
    matchedQuarterSignatureHash: "sig-quarter-b",
  })
  const broadC = makeRule({
    ruleId: "PP_BROAD_C",
    tokens: ["tag:market.jumpRegime:REVERSAL", "num:seq150.C01"],
    positiveMatchRowIndexes: [4],
    trainHitCount: 16,
    matchedDateCount: 1,
    matchedMonthCount: 1,
    matchedQuarterCount: 1,
    top3DateHitShare: 1,
    matchedDateSignatureHash: "sig-date-c",
    matchedMonthSignatureHash: "sig-month-c",
    matchedQuarterSignatureHash: "sig-quarter-c",
  })

  const capped = applyPerfectPrototypeTemporalSignatureCaps({
    rules: [duplicatedA, duplicatedB, broadB, broadC],
    maxRulesPerMatchedDateSignature: 1,
    maxRulesPerMatchedMonthSignature: 1,
    maxRulesPerMatchedQuarterSignature: 1,
  })
  assert.equal(capped.droppedByDateSignature, 1)
  assert.equal(capped.droppedRuleCount, 1)
  assert.deepEqual(
    capped.rules.map((rule) => rule.ruleId).sort((left, right) => left.localeCompare(right)),
    ["PP_BROAD_B", "PP_BROAD_C", "PP_DUP_A"],
    "temporal signature cap must keep only the strongest duplicate signature representative",
  )

  const diverseSelection = selectDiversePerfectPrototypeRules({
    rules: [duplicatedA, duplicatedB, broadB, broadC],
    rows,
    maxRules: 2,
    noveltyWeight: 1,
    overlapPenaltyWeight: 1,
    anchorFamilyPenaltyWeight: 0.5,
    lanePenaltyWeight: 0.5,
  })
  assert.deepEqual(
    diverseSelection.selectedRules.map((rule) => rule.ruleId).sort((left, right) => left.localeCompare(right)),
    ["PP_BROAD_B", "PP_DUP_A"],
    "diverse selector should prefer a new month/quarter/regime cover over a duplicate signature rule",
  )
  assert.equal(diverseSelection.selectionReport.selectedRuleCount, 2)
  assert.equal(diverseSelection.selectionReport.coveredMonthCount, 4)
  assert.equal(diverseSelection.selectionReport.coveredQuarterCount, 3)
  assert.equal(diverseSelection.selectionReport.coveredLaneCount, 3)
  assert.equal(
    diverseSelection.selectionReport.selectionRows.some((row) => Number(row?.addedLaneCount ?? 0) >= 1),
    true,
  )

  const mdlSelection = selectPerfectPrototypeMdlRules({
    rules: [duplicatedA, duplicatedB, broadB, broadC],
    rows,
    maxRules: 2,
    descriptionLengthWeight: 1,
    overlapPenaltyWeight: 1,
  })
  assert.deepEqual(
    mdlSelection.selectedRules.map((rule) => rule.ruleId).sort((left, right) => left.localeCompare(right)),
    ["PP_BROAD_B", "PP_DUP_A"],
    "MDL selector should keep the broad incremental coverage rule instead of a redundant duplicate",
  )
  assert.equal(mdlSelection.selectionReport.selectedRuleCount, 2)
  assert(mdlSelection.selectionReport.mdlCoverageGain > 0)
  assert(mdlSelection.selectionReport.mdlDescriptionLength > 0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
