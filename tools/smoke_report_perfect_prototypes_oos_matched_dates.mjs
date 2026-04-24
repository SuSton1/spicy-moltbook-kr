import assert from "node:assert/strict"

import { summarizePerfectPrototypeOosRuleStat } from "./report_perfect_prototypes_oos.mjs"

const main = async () => {
  const summary = summarizePerfectPrototypeOosRuleStat({
    stat: {
      ruleId: "PP_MISS_ONLY",
      oosMatchCount: 1,
      oosHitCount: 0,
      oosNegativeCount: 1,
      oosMatchedDates: ["2025-01-02"],
      oosHitDates: [],
    },
    calendarDateKeys: ["2025-01-02"],
  })
  assert.equal(summary.oosMatchCount, 1)
  assert.equal(summary.oosHitCount, 0)
  assert.equal(summary.oosMatchedDateCount, 1)
  assert.equal(summary.oosFirstHitDate, null)
  assert.equal(summary.oosLastHitDate, null)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
