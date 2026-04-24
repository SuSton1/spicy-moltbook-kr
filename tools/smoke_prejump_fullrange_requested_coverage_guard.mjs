import assert from "node:assert/strict"

import { assertPerfectPrototypeCoverageMatchesEffectiveTradingContract } from "../src/lib/perfect_prototype_token_index_merge.mjs"

const main = async () => {
  assert.doesNotThrow(() =>
    assertPerfectPrototypeCoverageMatchesEffectiveTradingContract({
      actualCoverage: {
        from: "2020-11-27",
        to: "2024-12-30",
        count: 1004,
      },
      expectedEffectiveCoverage: {
        from: "2020-11-27",
        to: "2024-12-30",
        count: 1004,
      },
      requestedRange: {
        from: "2020-11-27",
        to: "2024-12-31",
      },
      failureLabel: "effective trading coverage guard smoke",
    }),
  )

  assert.throws(
    () =>
      assertPerfectPrototypeCoverageMatchesEffectiveTradingContract({
        actualCoverage: {
          from: "2020-11-27",
          to: "2024-12-27",
          count: 1001,
        },
        expectedEffectiveCoverage: {
          from: "2020-11-27",
          to: "2024-12-30",
          count: 1004,
        },
        requestedRange: {
          from: "2020-11-27",
          to: "2024-12-31",
        },
        failureLabel: "effective trading coverage guard smoke",
      }),
    /effective coverage end mismatch/i,
  )

  assert.throws(
    () =>
      assertPerfectPrototypeCoverageMatchesEffectiveTradingContract({
        actualCoverage: {
          from: "2020-11-26",
          to: "2024-12-30",
          count: 1005,
        },
        expectedEffectiveCoverage: {
          from: "2020-11-26",
          to: "2024-12-30",
          count: 1005,
        },
        requestedRange: {
          from: "2020-11-27",
          to: "2024-12-31",
        },
        failureLabel: "effective trading coverage guard smoke",
      }),
    /starts before requested calendar range/i,
  )

  console.log(
    JSON.stringify(
      {
        smoke: "smoke_prejump_fullrange_requested_coverage_guard",
        effectiveTradingCoverageGuardVerified: true,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
