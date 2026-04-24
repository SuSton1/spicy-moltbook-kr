import assert from "node:assert/strict"
import crypto from "node:crypto"

import { createPerfectPrototypeMatchAccumulator } from "../src/lib/perfect_prototype_dedupe.mjs"

const sha256 = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")

const rules = [
  {
    ruleId: "PP_ALPHA",
    tokens: ["feat.alpha"],
    trainHitCount: 8,
    trainHitCountRaw: 8,
    trainHitCountCapped: 8,
    matchedDateCount: 5,
    precision: 1,
    maxGapTradingDays: 0,
    selectionOpenOosPrecision: 0.8,
    selectionOpenOosHitCount: 8,
    selectionOpenOosUniqueMatchedDates: 5,
    selectionOpenOosUniqueMatchedSymbols: 8,
  },
  {
    ruleId: "PP_BETA",
    tokens: ["feat.beta"],
    trainHitCount: 7,
    trainHitCountRaw: 7,
    trainHitCountCapped: 7,
    matchedDateCount: 4,
    precision: 1,
    maxGapTradingDays: 0,
    selectionOpenOosPrecision: 0.7,
    selectionOpenOosHitCount: 7,
    selectionOpenOosUniqueMatchedDates: 4,
    selectionOpenOosUniqueMatchedSymbols: 7,
  },
  {
    ruleId: "PP_GAMMA",
    tokens: ["feat.gamma"],
    trainHitCount: 6,
    trainHitCountRaw: 6,
    trainHitCountCapped: 6,
    matchedDateCount: 3,
    precision: 1,
    maxGapTradingDays: 0,
    selectionOpenOosPrecision: 0.6,
    selectionOpenOosHitCount: 6,
    selectionOpenOosUniqueMatchedDates: 3,
    selectionOpenOosUniqueMatchedSymbols: 6,
  },
]

const rows = [
  {
    dateKey: "2026-03-18",
    symbol: "111111",
    matchedRuleIds: ["PP_ALPHA"],
    matchedRuleCount: 1,
    primaryRuleId: "PP_ALPHA",
  },
  {
    dateKey: "2026-03-18",
    symbol: "222222",
    matchedRuleIds: ["PP_BETA"],
    matchedRuleCount: 1,
    primaryRuleId: "PP_BETA",
  },
  {
    dateKey: "2026-03-18",
    symbol: "333333",
    matchedRuleIds: ["PP_GAMMA"],
    matchedRuleCount: 1,
    primaryRuleId: "PP_GAMMA",
  },
  {
    dateKey: "2026-03-19",
    symbol: "444444",
    matchedRuleIds: ["PP_GAMMA"],
    matchedRuleCount: 1,
    primaryRuleId: "PP_GAMMA",
  },
]

const runOnce = () => {
  const accumulator = createPerfectPrototypeMatchAccumulator({
    rules,
    selectionMode: "top2_per_day_union",
    selectionMaxSymbolsPerDay: 2,
  })
  for (const row of rows) {
    accumulator.consume(row)
  }
  return accumulator.finalize()
}

const main = async () => {
  const first = runOnce()
  const second = runOnce()
  assert.equal(first.dedupedMatches.length, 3)
  assert.equal(first.symbolDayDedupedMatches.length, 4)
  assert.equal(first.dayCapDroppedRows.length, 1)
  assert.equal(first.topOverflowDates.length, 1)
  assert.equal(first.topOverflowDates[0].dateKey, "2026-03-18")
  assert.equal(first.topOverflowDates[0].candidateCount, 3)
  assert.equal(first.topOverflowDates[0].keptCount, 2)
  assert.equal(first.topOverflowDates[0].droppedCount, 1)
  const keptOnFirstDate = first.dedupedMatches.filter((row) => row.dateKey === "2026-03-18")
  assert.equal(keptOnFirstDate.length, 2)
  assert.deepEqual(
    keptOnFirstDate.map((row) => row.symbol),
    ["111111", "222222"],
  )
  assert.equal(first.dayCapDroppedRows[0].symbol, "333333")
  assert.equal(sha256(first), sha256(second))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
