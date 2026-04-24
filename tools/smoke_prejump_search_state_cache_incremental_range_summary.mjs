import assert from "node:assert/strict"

import { createPerfectPrototypeRowset } from "../src/lib/perfect_prototype_rowset.mjs"
import { createPerfectPrototypeSearchStateCache } from "../src/lib/perfect_prototype_search_state_cache.mjs"

const createSparseRowset = (values) =>
  createPerfectPrototypeRowset({
    values: Uint32Array.from(values),
    universeSize: 256,
    allowDense: false,
  })

const main = async () => {
  const cache = createPerfectPrototypeSearchStateCache({
    maxBytes: 8 * 1024 * 1024,
  })
  const positiveRowset = createSparseRowset([10, 20, 30, 40, 50, 60])
  const incomparableNegativeRowsets = [
    [0],
    [1, 11],
    [2, 12, 22],
    [3, 13, 23, 33],
    [4, 14, 24, 34, 44],
    [5, 15, 25, 35, 45, 55],
  ]

  for (const values of incomparableNegativeRowsets) {
    const dominated = cache.isDominated({
      positiveRowset,
      negativeRowset: createSparseRowset(values),
      startAt: 10,
      ruleSize: 1,
    })
    assert.equal(
      dominated,
      false,
      `Expected incomparable frontier candidate to remain non-dominated: ${values.join(",")}`,
    )
  }

  const dominatedByExisting = cache.isDominated({
    positiveRowset,
    negativeRowset: createSparseRowset([0, 100, 101]),
    startAt: 10,
    ruleSize: 2,
  })
  assert.equal(
    dominatedByExisting,
    true,
    "Expected a larger-rule superset candidate to be dominated by the existing frontier entry",
  )

  const stats = cache.getStats()
  assert.equal(
    Number(stats?.frontierInsertCount ?? 0),
    incomparableNegativeRowsets.length,
    "Expected one frontier insert per incomparable negative rowset",
  )
  assert(
    Number(stats?.memoHitCount ?? 0) > 0,
    "Expected at least one memo dominance hit after the dominated query",
  )
  assert(
    Number(stats?.memoRangeSummaryRebuildCount ?? 0) <= 2,
    `Expected incremental frontier range-summary maintenance to keep rebuilds low; actual=${Number(stats?.memoRangeSummaryRebuildCount ?? 0)}`,
  )

  const summary = {
    status: "ok",
    frontierInsertCount: Number(stats?.frontierInsertCount ?? 0),
    memoHitCount: Number(stats?.memoHitCount ?? 0),
    memoRangeSummaryRebuildCount: Number(stats?.memoRangeSummaryRebuildCount ?? 0),
    memoFrontierBucketCount: Number(stats?.memoFrontierBucketCount ?? 0),
  }
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
