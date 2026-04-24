import assert from "node:assert/strict"

import {
  buildPerfectPrototypeCalendarLookup,
  buildPerfectPrototypeChronologicalFoldLookup,
  capPerfectPrototypeRulesPerMatchedDateSignature,
  capPerfectPrototypeRulesPerMatchedMonthSignature,
  capPerfectPrototypeRulesPerMatchedQuarterSignature,
  createPerfectPrototypeRule,
  evaluatePerfectPrototypeTrainDateBreadthGuards,
} from "../src/lib/perfect_prototype_rule.mjs"

const buildRows = (dateKeys) =>
  dateKeys.map((dateKey, index) => ({
    sourceId: `fixture_${String(index + 1).padStart(2, "0")}`,
    symbol: `SYM${String(index + 1).padStart(2, "0")}`,
    dateKey,
  }))

const buildRule = ({ token, dateKeys, foldScheme = null }) => {
  const rows = buildRows(dateKeys)
  const calendarDateKeys = Array.from(new Set(dateKeys)).sort((left, right) => left.localeCompare(right))
  const calendarLookup = buildPerfectPrototypeCalendarLookup(calendarDateKeys)
  const foldLookup = buildPerfectPrototypeChronologicalFoldLookup({
    calendarDateKeys,
    foldScheme,
  })
  const rowFoldKeys = rows.map((row) => {
    const calendarIndex = calendarLookup.calendarIndexByDateKey.get(row.dateKey)
    return Number.isInteger(calendarIndex)
      ? foldLookup.foldKeysByCalendarIndex[calendarIndex] ?? null
      : null
  })
  return createPerfectPrototypeRule({
    tokens: [token],
    matchRowIndexes: rows.map((_, index) => index),
    positiveMatchRowIndexes: rows.map((_, index) => index),
    negativeMatchRowIndexes: [],
    rows,
    calendarDateKeys,
    calendarIndexByDateKey: calendarLookup.calendarIndexByDateKey,
    rowFoldKeys,
  })
}

const main = async () => {
  const passingRule = buildRule({
    token: "tag:breadth:passing",
    dateKeys: [
      "2024-08-01",
      "2024-08-01",
      "2024-08-01",
      "2024-08-02",
      "2024-08-02",
      "2024-08-05",
      "2024-08-06",
      "2024-08-07",
      "2024-08-08",
      "2024-08-09",
    ],
  })
  assert.equal(passingRule.matchedDateCount, 7)
  assert.equal(passingRule.matchedMonthCount, 1)
  assert.equal(passingRule.matchedQuarterCount, 1)
  assert.equal(passingRule.top1DateHitCount, 3)
  assert.equal(passingRule.top3DateHitCount, 6)
  assert.equal(passingRule.top1DateHitShare, 0.3)
  assert.equal(passingRule.top3DateHitShare, 0.6)
  assert.equal(
    evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: passingRule,
      maxTop1DateHitShare: 0.3,
      maxTop3DateHitShare: 0.6,
    }).ok,
    true,
  )

  const nineDateRule = buildRule({
    token: "tag:breadth:nine_dates",
    dateKeys: [
      "2024-08-01",
      "2024-08-02",
      "2024-08-05",
      "2024-08-06",
      "2024-08-07",
      "2024-08-08",
      "2024-08-09",
      "2024-08-12",
      "2024-08-13",
    ],
  })
  assert.equal(
    evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: nineDateRule,
      minTrainMatchedDates: 10,
    }).reason,
    "BELOW_MIN_TRAIN_MATCHED_DATES",
  )

  const multiMonthRule = buildRule({
    token: "tag:breadth:multi_month",
    dateKeys: [
      "2024-01-03",
      "2024-01-05",
      "2024-02-06",
      "2024-02-08",
      "2024-03-04",
      "2024-03-07",
      "2024-04-02",
      "2024-04-05",
    ],
  })
  assert.equal(multiMonthRule.matchedMonthCount, 4)
  assert.equal(multiMonthRule.matchedQuarterCount, 2)
  assert.equal(
    evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: multiMonthRule,
      minTrainMatchedMonths: 4,
      minTrainMatchedQuarters: 2,
    }).ok,
    true,
  )
  assert.equal(
    evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: multiMonthRule,
      minTrainMatchedMonths: 5,
    }).reason,
    "BELOW_MIN_TRAIN_MATCHED_MONTHS",
  )
  assert.equal(
    evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: multiMonthRule,
      minTrainMatchedQuarters: 3,
    }).reason,
    "BELOW_MIN_TRAIN_MATCHED_QUARTERS",
  )

  const foldPassingRule = buildRule({
    token: "tag:breadth:fold_passing",
    foldScheme: "chronological_5",
    dateKeys: [
      "2024-01-03",
      "2024-01-05",
      "2024-02-06",
      "2024-02-08",
      "2024-03-04",
      "2024-03-07",
      "2024-04-02",
      "2024-04-05",
      "2024-05-06",
      "2024-05-09",
    ],
  })
  assert.equal(foldPassingRule.matchedFoldCount, 5)
  assert.equal(foldPassingRule.top1FoldHitCount, 2)
  assert.equal(foldPassingRule.top3FoldHitCount, 6)
  assert.equal(foldPassingRule.top1FoldHitShare, 0.2)
  assert.equal(foldPassingRule.top3FoldHitShare, 0.6)
  assert.equal(
    evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: foldPassingRule,
      minTrainMatchedFolds: 5,
      maxTop1FoldHitShare: 0.2,
      maxTop3FoldHitShare: 0.6,
    }).ok,
    true,
  )

  const foldCountRule = buildRule({
    token: "tag:breadth:fold_count_short",
    foldScheme: "chronological_5",
    dateKeys: [
      "2024-01-03",
      "2024-01-05",
      "2024-02-06",
      "2024-02-08",
      "2024-01-03",
      "2024-01-05",
      "2024-02-06",
      "2024-02-08",
    ],
  })
  assert.equal(
    evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: foldCountRule,
      minTrainMatchedFolds: 5,
    }).reason,
    "BELOW_MIN_TRAIN_MATCHED_FOLDS",
  )

  const top1HeavyFoldRule = buildRule({
    token: "tag:breadth:top1_fold_heavy",
    foldScheme: "chronological_5",
    dateKeys: [
      "2024-01-03",
      "2024-01-03",
      "2024-01-03",
      "2024-01-05",
      "2024-02-06",
      "2024-02-08",
      "2024-03-04",
      "2024-03-07",
      "2024-04-02",
      "2024-05-09",
    ],
  })
  assert.equal(top1HeavyFoldRule.top1FoldHitShare, 0.4)
  assert.equal(
    evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: top1HeavyFoldRule,
      maxTop1FoldHitShare: 0.3,
    }).reason,
    "TOP1_FOLD_HIT_SHARE_ABOVE_MAX",
  )

  const top3HeavyFoldRule = buildRule({
    token: "tag:breadth:top3_fold_heavy",
    foldScheme: "chronological_5",
    dateKeys: [
      "2024-01-03",
      "2024-01-03",
      "2024-01-05",
      "2024-02-06",
      "2024-02-08",
      "2024-03-04",
      "2024-03-07",
      "2024-04-02",
      "2024-05-06",
      "2024-05-09",
    ],
  })
  assert.equal(top3HeavyFoldRule.top1FoldHitShare, 0.3)
  assert.equal(top3HeavyFoldRule.top3FoldHitShare, 0.7)
  assert.equal(
    evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: top3HeavyFoldRule,
      maxTop1FoldHitShare: 0.3,
      maxTop3FoldHitShare: 0.6,
    }).reason,
    "TOP3_FOLD_HIT_SHARE_ABOVE_MAX",
  )

  const top1HeavyRule = buildRule({
    token: "tag:breadth:top1_heavy",
    dateKeys: [
      "2024-08-01",
      "2024-08-01",
      "2024-08-01",
      "2024-08-01",
      "2024-08-02",
      "2024-08-02",
      "2024-08-05",
      "2024-08-06",
      "2024-08-07",
      "2024-08-08",
    ],
  })
  assert.equal(top1HeavyRule.top1DateHitShare, 0.4)
  assert.equal(
    evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: top1HeavyRule,
      maxTop1DateHitShare: 0.3,
    }).reason,
    "TOP1_DATE_HIT_SHARE_ABOVE_MAX",
  )

  const top3HeavyRule = buildRule({
    token: "tag:breadth:top3_heavy",
    dateKeys: [
      "2024-08-01",
      "2024-08-01",
      "2024-08-01",
      "2024-08-02",
      "2024-08-02",
      "2024-08-05",
      "2024-08-05",
      "2024-08-06",
      "2024-08-07",
      "2024-08-08",
    ],
  })
  assert.equal(top3HeavyRule.top1DateHitShare, 0.3)
  assert.equal(top3HeavyRule.top3DateHitShare, 0.7)
  assert.equal(
    evaluatePerfectPrototypeTrainDateBreadthGuards({
      rule: top3HeavyRule,
      maxTop1DateHitShare: 0.3,
      maxTop3DateHitShare: 0.6,
    }).reason,
    "TOP3_DATE_HIT_SHARE_ABOVE_MAX",
  )

  const sameSignatureRuleA = buildRule({
    token: "tag:breadth:same_sig_a",
    dateKeys: ["2024-08-01", "2024-08-02", "2024-08-05"],
  })
  const sameSignatureRuleB = buildRule({
    token: "tag:breadth:same_sig_b",
    dateKeys: ["2024-08-01", "2024-08-01", "2024-08-02", "2024-08-05"],
  })
  assert.equal(
    sameSignatureRuleA.matchedDateSignatureHash,
    sameSignatureRuleB.matchedDateSignatureHash,
    "matched-date signature should depend on date set rather than per-date multiplicity",
  )

  const sameMonthSignatureRuleA = buildRule({
    token: "tag:breadth:same_month_sig_a",
    dateKeys: ["2024-01-03", "2024-02-05", "2024-04-08"],
  })
  const sameMonthSignatureRuleB = buildRule({
    token: "tag:breadth:same_month_sig_b",
    dateKeys: ["2024-01-15", "2024-02-28", "2024-04-12"],
  })
  assert.equal(
    sameMonthSignatureRuleA.matchedMonthSignatureHash,
    sameMonthSignatureRuleB.matchedMonthSignatureHash,
    "matched-month signature should depend on month set rather than exact dates",
  )
  assert.equal(
    sameMonthSignatureRuleA.matchedQuarterSignatureHash,
    sameMonthSignatureRuleB.matchedQuarterSignatureHash,
    "matched-quarter signature should depend on quarter set rather than exact dates",
  )

  const signature = sameSignatureRuleA.matchedDateSignatureHash
  const { rules: cappedRules, droppedRuleCount } = capPerfectPrototypeRulesPerMatchedDateSignature({
    rules: [
      {
        ...sameSignatureRuleA,
        ruleId: "PP_A",
        trainHitCount: 20,
        matchedDateCount: 12,
        top3DateHitShare: 0.25,
        precision: 1,
        ruleSize: 6,
        matchedDateSignatureHash: signature,
      },
      {
        ...sameSignatureRuleA,
        ruleId: "PP_B",
        trainHitCount: 20,
        matchedDateCount: 12,
        top3DateHitShare: 0.2,
        precision: 1,
        ruleSize: 6,
        matchedDateSignatureHash: signature,
      },
      {
        ...sameSignatureRuleA,
        ruleId: "PP_C",
        trainHitCount: 20,
        matchedDateCount: 11,
        top3DateHitShare: 0.1,
        precision: 1,
        ruleSize: 6,
        matchedDateSignatureHash: signature,
      },
      {
        ...sameSignatureRuleA,
        ruleId: "PP_D",
        trainHitCount: 19,
        matchedDateCount: 20,
        top3DateHitShare: 0.05,
        precision: 1,
        ruleSize: 5,
        matchedDateSignatureHash: signature,
      },
      {
        ...sameSignatureRuleA,
        ruleId: "PP_E",
        trainHitCount: 18,
        matchedDateCount: 20,
        top3DateHitShare: 0.05,
        precision: 1,
        ruleSize: 5,
        matchedDateSignatureHash: signature,
      },
    ],
    maxRulesPerMatchedDateSignature: 3,
  })
  assert.equal(droppedRuleCount, 2)
  assert.deepEqual(
    cappedRules.map((rule) => rule.ruleId),
    ["PP_B", "PP_A", "PP_C"],
    "signature bucket cap must retain the deterministic top-K rules",
  )

  const monthSignature = sameMonthSignatureRuleA.matchedMonthSignatureHash
  const quarterSignature = sameMonthSignatureRuleA.matchedQuarterSignatureHash
  const cappedByMonth = capPerfectPrototypeRulesPerMatchedMonthSignature({
    rules: [
      { ...sameMonthSignatureRuleA, ruleId: "PP_M1", trainHitCount: 20, matchedDateCount: 12, top3DateHitShare: 0.2, precision: 1, ruleSize: 5, matchedMonthSignatureHash: monthSignature },
      { ...sameMonthSignatureRuleA, ruleId: "PP_M2", trainHitCount: 19, matchedDateCount: 11, top3DateHitShare: 0.15, precision: 1, ruleSize: 5, matchedMonthSignatureHash: monthSignature },
      { ...sameMonthSignatureRuleA, ruleId: "PP_M3", trainHitCount: 18, matchedDateCount: 10, top3DateHitShare: 0.1, precision: 1, ruleSize: 5, matchedMonthSignatureHash: monthSignature },
    ],
    maxRulesPerMatchedMonthSignature: 2,
  })
  assert.equal(cappedByMonth.droppedRuleCount, 1)
  assert.deepEqual(
    cappedByMonth.rules.map((rule) => rule.ruleId),
    ["PP_M1", "PP_M2"],
  )

  const cappedByQuarter = capPerfectPrototypeRulesPerMatchedQuarterSignature({
    rules: [
      { ...sameMonthSignatureRuleA, ruleId: "PP_Q1", trainHitCount: 20, matchedDateCount: 12, top3DateHitShare: 0.2, precision: 1, ruleSize: 5, matchedQuarterSignatureHash: quarterSignature },
      { ...sameMonthSignatureRuleA, ruleId: "PP_Q2", trainHitCount: 19, matchedDateCount: 11, top3DateHitShare: 0.15, precision: 1, ruleSize: 5, matchedQuarterSignatureHash: quarterSignature },
      { ...sameMonthSignatureRuleA, ruleId: "PP_Q3", trainHitCount: 18, matchedDateCount: 10, top3DateHitShare: 0.1, precision: 1, ruleSize: 5, matchedQuarterSignatureHash: quarterSignature },
    ],
    maxRulesPerMatchedQuarterSignature: 2,
  })
  assert.equal(cappedByQuarter.droppedRuleCount, 1)
  assert.deepEqual(
    cappedByQuarter.rules.map((rule) => rule.ruleId),
    ["PP_Q1", "PP_Q2"],
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
