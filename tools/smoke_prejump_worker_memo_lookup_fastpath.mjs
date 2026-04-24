import assert from "node:assert/strict"

import { createPerfectPrototypeRowset } from "../src/lib/perfect_prototype_rowset.mjs"
import { createPerfectPrototypeSearchStateCache } from "../src/lib/perfect_prototype_search_state_cache.mjs"

const createSparseRowset = (values, universeSize = 8192) =>
  createPerfectPrototypeRowset({
    values: Uint32Array.from(values),
    universeSize,
    allowDense: false,
  })

const createPositiveValues = (offset) => [
  offset + 1,
  offset + 3,
  offset + 5,
  offset + 7,
  offset + 9,
]

const main = async () => {
  const cache = createPerfectPrototypeSearchStateCache({
    maxBytes: 16 * 1024 * 1024,
  })

  const cycleCount = 24
  for (let cycle = 0; cycle < cycleCount; cycle += 1) {
    const baseOffset = cycle * 64

    const exactPositive = createSparseRowset(createPositiveValues(baseOffset))
    const exactNegative = createSparseRowset([baseOffset + 20, baseOffset + 30, baseOffset + 40])
    assert.equal(
      cache.isDominated({
        positiveRowset: exactPositive,
        negativeRowset: exactNegative,
        startAt: 10,
        ruleSize: 2,
      }),
      false,
      `exact-cycle-${cycle}: seed frontier insert should remain non-dominated`,
    )
    assert.equal(
      cache.isDominated({
        positiveRowset: exactPositive,
        negativeRowset: exactNegative,
        startAt: 10,
        ruleSize: 3,
      }),
      true,
      `exact-cycle-${cycle}: exact fingerprint fast-hit should dominate larger rule`,
    )

    const prefixPositive = createSparseRowset(createPositiveValues(baseOffset + 2000))
    const prefixNegative = createSparseRowset([baseOffset + 21, baseOffset + 31, baseOffset + 41])
    assert.equal(
      cache.isDominated({
        positiveRowset: prefixPositive,
        negativeRowset: prefixNegative,
        startAt: 12,
        ruleSize: 2,
      }),
      false,
      `prefix-cycle-${cycle}: seed frontier insert should remain non-dominated`,
    )
    assert.equal(
      cache.isDominated({
        positiveRowset: prefixPositive,
        negativeRowset: createSparseRowset([
          baseOffset + 21,
          baseOffset + 31,
          baseOffset + 41,
          baseOffset + 51,
        ]),
        startAt: 12,
        ruleSize: 3,
      }),
      true,
      `prefix-cycle-${cycle}: superset should be dominated by existing frontier entry`,
    )

    const suffixPositive = createSparseRowset(createPositiveValues(baseOffset + 4000))
    const suffixNegative = createSparseRowset([baseOffset + 22, baseOffset + 32, baseOffset + 42])
    assert.equal(
      cache.isDominated({
        positiveRowset: suffixPositive,
        negativeRowset: suffixNegative,
        startAt: 14,
        ruleSize: 3,
      }),
      false,
      `suffix-cycle-${cycle}: seed frontier insert should remain non-dominated`,
    )
    assert.equal(
      cache.isDominated({
        positiveRowset: suffixPositive,
        negativeRowset: createSparseRowset([baseOffset + 22]),
        startAt: 14,
        ruleSize: 1,
      }),
      false,
      `suffix-cycle-${cycle}: smaller subset should insert and prune larger frontier entry`,
    )
    assert.equal(
      cache.isDominated({
        positiveRowset: suffixPositive,
        negativeRowset: suffixNegative,
        startAt: 14,
        ruleSize: 4,
      }),
      true,
      `suffix-cycle-${cycle}: pruned larger frontier entry should now be dominated by the subset`,
    )
  }

  const stats = cache.getStats()
  assert(
    Number(stats?.memoExactFingerprintFastHitCount ?? 0) >= cycleCount,
    `Expected repeated exact fingerprint fast hits; actual=${Number(stats?.memoExactFingerprintFastHitCount ?? 0)}`,
  )
  assert(
    Number(stats?.memoFrontierDeleteCount ?? 0) >= cycleCount,
    `Expected suffix-prune frontier deletes; actual=${Number(stats?.memoFrontierDeleteCount ?? 0)}`,
  )
  assert(
    Number(stats?.memoLookupFingerprintMs ?? 0) > 0,
    `Expected memoLookupFingerprintMs to be tracked; actual=${Number(stats?.memoLookupFingerprintMs ?? 0)}`,
  )
  assert(
    Number(stats?.memoLookupExactFingerprintScanMs ?? 0) > 0,
    `Expected memoLookupExactFingerprintScanMs to be tracked; actual=${Number(stats?.memoLookupExactFingerprintScanMs ?? 0)}`,
  )
  assert(
    Number(stats?.memoLookupRangeSummaryPrepMs ?? 0) > 0,
    `Expected memoLookupRangeSummaryPrepMs to be tracked; actual=${Number(stats?.memoLookupRangeSummaryPrepMs ?? 0)}`,
  )
  assert(
    Number(stats?.memoLookupPrefixScanMs ?? 0) > 0,
    `Expected memoLookupPrefixScanMs to be tracked; actual=${Number(stats?.memoLookupPrefixScanMs ?? 0)}`,
  )
  assert(
    Number(stats?.memoLookupSuffixScanMs ?? 0) > 0,
    `Expected memoLookupSuffixScanMs to be tracked; actual=${Number(stats?.memoLookupSuffixScanMs ?? 0)}`,
  )
  assert(
    Number(stats?.memoLookupEntryScanCount ?? 0) >= cycleCount * 3,
    `Expected memoLookupEntryScanCount to accumulate; actual=${Number(stats?.memoLookupEntryScanCount ?? 0)}`,
  )
  assert(
    Number(stats?.memoLookupFingerprintMissCount ?? 0) >= cycleCount * 2,
    `Expected fingerprint misses on non-exact paths; actual=${Number(stats?.memoLookupFingerprintMissCount ?? 0)}`,
  )
  assert(
    Number(stats?.memoLookupRangeCandidateBucketCount ?? 0) >= cycleCount * 2,
    `Expected range candidate bucket accounting; actual=${Number(stats?.memoLookupRangeCandidateBucketCount ?? 0)}`,
  )

  console.log(
    JSON.stringify(
      {
        status: "ok",
        cycleCount,
        memoLookupMs: Number(stats?.memoLookupMs ?? 0),
        memoLookupFingerprintMs: Number(stats?.memoLookupFingerprintMs ?? 0),
        memoLookupExactFingerprintScanMs: Number(
          stats?.memoLookupExactFingerprintScanMs ?? 0,
        ),
        memoLookupRangeSummaryPrepMs: Number(stats?.memoLookupRangeSummaryPrepMs ?? 0),
        memoLookupPrefixScanMs: Number(stats?.memoLookupPrefixScanMs ?? 0),
        memoLookupSuffixScanMs: Number(stats?.memoLookupSuffixScanMs ?? 0),
        memoLookupEntryScanCount: Number(stats?.memoLookupEntryScanCount ?? 0),
        memoLookupFingerprintMissCount: Number(stats?.memoLookupFingerprintMissCount ?? 0),
        memoLookupRangeCandidateBucketCount: Number(
          stats?.memoLookupRangeCandidateBucketCount ?? 0,
        ),
        memoExactFingerprintFastHitCount: Number(
          stats?.memoExactFingerprintFastHitCount ?? 0,
        ),
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
