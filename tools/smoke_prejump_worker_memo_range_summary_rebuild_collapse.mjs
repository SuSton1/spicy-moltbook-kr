import assert from "node:assert/strict"

import { createPerfectPrototypeRowset } from "../src/lib/perfect_prototype_rowset.mjs"
import { createPerfectPrototypeSearchStateCache } from "../src/lib/perfect_prototype_search_state_cache.mjs"

const createSparseRowset = (values) =>
  createPerfectPrototypeRowset({
    values: Uint32Array.from(values),
    universeSize: 512,
    allowDense: false,
  })

const main = async () => {
  const cache = createPerfectPrototypeSearchStateCache({
    maxBytes: 8 * 1024 * 1024,
  })
  const positiveRowset = createSparseRowset([10, 20, 30, 40, 50, 60, 70, 80])
  const removableNegativeRowsets = []
  for (let extra = 1; extra <= 24; extra += 1) {
    removableNegativeRowsets.push([5, 100 + extra, 200 + extra])
  }

  for (const values of removableNegativeRowsets) {
    const dominated = cache.isDominated({
      positiveRowset,
      negativeRowset: createSparseRowset(values),
      startAt: 24,
      ruleSize: 2,
    })
    assert.equal(
      dominated,
      false,
      `Expected seed frontier candidate to remain non-dominated before collapse: ${values.join(",")}`,
    )
  }

  const collapseDominated = cache.isDominated({
    positiveRowset,
    negativeRowset: createSparseRowset([5]),
    startAt: 24,
    ruleSize: 1,
  })
  assert.equal(
    collapseDominated,
    false,
    "Expected the smaller-rule subset candidate to enter the skyline and prune broader supersets",
  )

  for (let extra = 1; extra <= 24; extra += 1) {
    const dominated = cache.isDominated({
      positiveRowset,
      negativeRowset: createSparseRowset([5, 100 + extra, 200 + extra, 300 + extra]),
      startAt: 24,
      ruleSize: 3,
    })
    assert.equal(
      dominated,
      true,
      `Expected the post-collapse superset candidate to be dominated: ${extra}`,
    )
  }

  const stats = cache.getStats()
  assert(
    Number(stats?.memoFrontierDeleteCount ?? 0) >= removableNegativeRowsets.length,
    `Expected memo frontier deletions during collapse; actual=${Number(stats?.memoFrontierDeleteCount ?? 0)}`,
  )
  assert(
    Number(stats?.memoHitCount ?? 0) >= removableNegativeRowsets.length,
    `Expected memo hits after collapse; actual=${Number(stats?.memoHitCount ?? 0)}`,
  )
  assert(
    Number(stats?.memoRangeSummaryRebuildCount ?? 0) <= 4,
    `Expected delete-side local maintenance to keep rebuilds low; actual=${Number(stats?.memoRangeSummaryRebuildCount ?? 0)}`,
  )

  console.log(
    JSON.stringify(
      {
        status: "ok",
        memoHitCount: Number(stats?.memoHitCount ?? 0),
        memoFrontierDeleteCount: Number(stats?.memoFrontierDeleteCount ?? 0),
        memoRangeSummaryRebuildCount: Number(stats?.memoRangeSummaryRebuildCount ?? 0),
        memoFrontierBucketCount: Number(stats?.memoFrontierBucketCount ?? 0),
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
