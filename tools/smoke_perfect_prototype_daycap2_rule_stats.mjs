import assert from "node:assert/strict"

import {
  buildPerfectPrototypeCalendarLookup,
  comparePerfectPrototypeRules,
  createPerfectPrototypeRule,
  PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE,
} from "../src/lib/perfect_prototype_rule.mjs"

const buildRows = (dateKeys) =>
  dateKeys.map((dateKey, index) => ({
    sourceId: `fixture_${String(index + 1).padStart(2, "0")}`,
    symbol: `SYM${String(index + 1).padStart(2, "0")}`,
    dateKey,
  }))

const main = async () => {
  const oneDayRows = buildRows(Array.from({ length: 13 }, () => "2024-08-06"))
  const oneDayCalendarDateKeys = ["2024-08-06"]
  const oneDayCalendarLookup = buildPerfectPrototypeCalendarLookup(oneDayCalendarDateKeys)
  const oneDayRule = createPerfectPrototypeRule({
    tokens: ["tag:one_day_spike"],
    matchRowIndexes: oneDayRows.map((_, index) => index),
    positiveMatchRowIndexes: oneDayRows.map((_, index) => index),
    negativeMatchRowIndexes: [],
    rows: oneDayRows,
    calendarDateKeys: oneDayCalendarDateKeys,
    calendarIndexByDateKey: oneDayCalendarLookup.calendarIndexByDateKey,
    hitCountMode: PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE,
    hitCountDaySymbolCap: 2,
  })
  assert.equal(oneDayRule.trainHitCountRaw, 13)
  assert.equal(oneDayRule.trainHitCountCapped, 2)
  assert.equal(oneDayRule.trainHitCount, 2)
  assert.equal(oneDayRule.matchedDateCount, 1)
  assert.equal(oneDayRule.maxSymbolsMatchedPerDate, 13)
  assert.equal(oneDayRule.top1DateHitCount, 2)
  assert.equal(oneDayRule.top3DateHitCount, 2)
  assert.equal(oneDayRule.top1DateHitShare, 1)
  assert.equal(oneDayRule.top3DateHitShare, 1)
  assert.ok(typeof oneDayRule.matchedDateSignatureHash === "string" && oneDayRule.matchedDateSignatureHash.length > 0)

  const fiveDayRows = buildRows([
    "2024-08-01",
    "2024-08-01",
    "2024-08-02",
    "2024-08-02",
    "2024-08-05",
    "2024-08-05",
    "2024-08-06",
    "2024-08-06",
    "2024-08-07",
    "2024-08-07",
  ])
  const fiveDayCalendarDateKeys = [
    "2024-08-01",
    "2024-08-02",
    "2024-08-05",
    "2024-08-06",
    "2024-08-07",
  ]
  const fiveDayCalendarLookup = buildPerfectPrototypeCalendarLookup(fiveDayCalendarDateKeys)
  const fiveDayRule = createPerfectPrototypeRule({
    tokens: ["tag:five_day_repeat"],
    matchRowIndexes: fiveDayRows.map((_, index) => index),
    positiveMatchRowIndexes: fiveDayRows.map((_, index) => index),
    negativeMatchRowIndexes: [],
    rows: fiveDayRows,
    calendarDateKeys: fiveDayCalendarDateKeys,
    calendarIndexByDateKey: fiveDayCalendarLookup.calendarIndexByDateKey,
    hitCountMode: PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE,
    hitCountDaySymbolCap: 2,
  })
  assert.equal(fiveDayRule.trainHitCountRaw, 10)
  assert.equal(fiveDayRule.trainHitCountCapped, 10)
  assert.equal(fiveDayRule.trainHitCount, 10)
  assert.equal(fiveDayRule.matchedDateCount, 5)
  assert.equal(fiveDayRule.maxSymbolsMatchedPerDate, 2)
  assert.equal(fiveDayRule.top1DateHitCount, 2)
  assert.equal(fiveDayRule.top3DateHitCount, 6)
  assert.equal(fiveDayRule.top1DateHitShare, 0.2)
  assert.equal(fiveDayRule.top3DateHitShare, 0.6)

  const twoDayRows = buildRows(["2024-08-06", "2024-08-07"])
  const twoDayCalendarDateKeys = ["2024-08-06", "2024-08-07"]
  const twoDayCalendarLookup = buildPerfectPrototypeCalendarLookup(twoDayCalendarDateKeys)
  const twoDayRule = createPerfectPrototypeRule({
    tokens: ["tag:two_day_exact"],
    matchRowIndexes: twoDayRows.map((_, index) => index),
    positiveMatchRowIndexes: twoDayRows.map((_, index) => index),
    negativeMatchRowIndexes: [],
    rows: twoDayRows,
    calendarDateKeys: twoDayCalendarDateKeys,
    calendarIndexByDateKey: twoDayCalendarLookup.calendarIndexByDateKey,
    hitCountMode: PERFECT_PROTOTYPE_DAY_CAPPED_SYMBOL_HIT_COUNT_MODE,
    hitCountDaySymbolCap: 2,
  })
  assert.equal(twoDayRule.trainHitCountCapped, 2)
  assert.equal(twoDayRule.matchedDateCount, 2)
  assert.equal(twoDayRule.top1DateHitCount, 1)
  assert.equal(twoDayRule.top3DateHitCount, 2)
  assert.ok(
    comparePerfectPrototypeRules(twoDayRule, oneDayRule) < 0,
    "expected multi-day capped rule to rank ahead of one-day spike when capped hits tie",
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
