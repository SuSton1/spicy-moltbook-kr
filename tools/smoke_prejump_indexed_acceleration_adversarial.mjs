import assert from "node:assert/strict"
import path from "node:path"
import { spawn } from "node:child_process"

import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"
import { minePerfectPrototypeIndexed } from "../src/lib/perfect_prototype_indexed_miner.mjs"
import {
  arePerfectPrototypeRowsetsEqual,
  arePerfectPrototypeRowsetsEqualJsReference,
  clonePerfectPrototypeRowsetOwned,
  createPerfectPrototypeBitsetRowset,
  createPerfectPrototypeBitsetRowsetFromWords,
  createPerfectPrototypeRowset,
  createPerfectPrototypeSparseRowset,
  intersectPerfectPrototypeRowsetsCount,
  intersectPerfectPrototypeRowsets,
  intersectPerfectPrototypeRowsetsJsReference,
  isPerfectPrototypeBorrowedRowset,
  isPerfectPrototypeRowsetSubset,
  isPerfectPrototypeRowsetSubsetJsReference,
  materializePerfectPrototypeRowsetValues,
  materializePerfectPrototypeRowsetValuesJsReference,
  releasePerfectPrototypeBorrowedRowset,
  summarizePerfectPrototypeRowsetEdges,
  summarizePerfectPrototypeRowsetMode,
} from "../src/lib/perfect_prototype_rowset.mjs"
import { createPerfectPrototypeSearchStateCache } from "../src/lib/perfect_prototype_search_state_cache.mjs"
import {
  decodePerfectPrototypeDeltaPostings,
  decodePerfectPrototypeDeltaPostingsJsReference,
  decodePerfectPrototypeDeltaPostingsToBitset,
  decodePerfectPrototypeDeltaPostingsToBitsetJsReference,
  encodePerfectPrototypeDeltaPostings,
} from "../src/lib/perfect_prototype_postings_codec.mjs"

const normalizeRule = (rule) => ({
  ruleId: rule?.ruleId ?? null,
  tokens: Array.isArray(rule?.tokens) ? [...rule.tokens].sort((left, right) => String(left).localeCompare(String(right))) : [],
  trainHitCount: Number(rule?.trainHitCount ?? 0),
  trainMatchCount: Number(rule?.trainMatchCount ?? 0),
  trainNegativeCount: Number(rule?.trainNegativeCount ?? 0),
  maxGapTradingDays: Number(rule?.maxGapTradingDays ?? 0),
  ruleSize: Number(rule?.ruleSize ?? 0),
})

const spawnNode = async ({ cwd, scriptPath, args = [] }) =>
  new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    proc.stdout.setEncoding("utf8")
    proc.stderr.setEncoding("utf8")
    proc.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    proc.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    proc.once("error", reject)
    proc.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(
        new Error(
          [
            "Predictive indexed adversarial smoke failed",
            `script=${scriptPath}`,
            `exitCode=${Number(code ?? 1)}`,
            stdout ? `stdout=${stdout.trim()}` : null,
            stderr ? `stderr=${stderr.trim()}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      )
    })
  })

const assertSameValues = (leftRowset, rightValues) => {
  assert.deepStrictEqual(
    Array.from(materializePerfectPrototypeRowsetValues(leftRowset)),
    Array.from(rightValues),
  )
}

const assertThrowsMatch = (fn, pattern, label) => {
  let thrown = null
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown instanceof Error, `${label} did not throw`)
  assert.match(String(thrown?.message ?? thrown), pattern, `${label} threw unexpected error`)
}

const runRowsetFixtures = () => {
  const universeSize = 512
  const denseValues = Uint32Array.from(
    Array.from({ length: 300 }, (_, index) => index * 1 + (index % 5 === 0 ? 1 : 0)).filter(
      (value, index, list) => value < universeSize && list.indexOf(value) === index,
    ),
  )
  const densePartnerValues = Uint32Array.from(
    Array.from({ length: 260 }, (_, index) => index * 1 + (index % 7 === 0 ? 2 : 0)).filter(
      (value, index, list) => value < universeSize && list.indexOf(value) === index,
    ),
  )
  const sparseDenseValues = Uint32Array.from(
    Array.from({ length: 180 }, (_, index) => index * 2).filter((value) => value < universeSize),
  )
  const sparseProbeValues = Uint32Array.from(
    Array.from({ length: 220 }, (_, index) => index * 2 + (index % 3 === 0 ? 0 : 1)).filter(
      (value) => value < universeSize,
    ),
  )
  const denseLeft = createPerfectPrototypeBitsetRowset({
    values: denseValues,
    universeSize,
  })
  const denseRight = createPerfectPrototypeBitsetRowset({
    values: densePartnerValues,
    universeSize,
  })
  const sparseLeft = createPerfectPrototypeSparseRowset(sparseProbeValues)
  const denseRightForSparse = createPerfectPrototypeBitsetRowset({
    values: sparseDenseValues,
    universeSize,
  })

  const denseDenseIntersect = intersectPerfectPrototypeRowsets({
    leftRowset: denseLeft,
    rightRowset: denseRight,
    universeSize,
    allowDense: true,
  })
  const denseDenseSparseIntersect = intersectPerfectPrototypeRowsets({
    leftRowset: denseLeft,
    rightRowset: denseRight,
    universeSize,
    allowDense: false,
  })
  const sparseDenseIntersect = intersectPerfectPrototypeRowsets({
    leftRowset: sparseLeft,
    rightRowset: denseRightForSparse,
    universeSize,
    allowDense: true,
  })
  const borrowedSparseDenseIntersect = intersectPerfectPrototypeRowsets({
    leftRowset: sparseLeft,
    rightRowset: denseRightForSparse,
    universeSize,
    allowDense: false,
    resultOwnership: "borrowed",
  })
  const denseDenseIntersectJs = intersectPerfectPrototypeRowsetsJsReference({
    leftRowset: denseLeft,
    rightRowset: denseRight,
    universeSize,
    allowDense: true,
  })
  const denseDenseSparseIntersectJs = intersectPerfectPrototypeRowsetsJsReference({
    leftRowset: denseLeft,
    rightRowset: denseRight,
    universeSize,
    allowDense: false,
  })
  const sparseDenseIntersectJs = intersectPerfectPrototypeRowsetsJsReference({
    leftRowset: sparseLeft,
    rightRowset: denseRightForSparse,
    universeSize,
    allowDense: true,
  })

  const expectedDenseDense = denseValues.filter((value) => densePartnerValues.includes(value))
  const expectedSparseDense = sparseProbeValues.filter((value) => sparseDenseValues.includes(value))

  assert.equal(summarizePerfectPrototypeRowsetMode(denseDenseIntersect), "bitset")
  assert.equal(summarizePerfectPrototypeRowsetMode(denseDenseSparseIntersect), "sparse")
  assert.equal(summarizePerfectPrototypeRowsetMode(sparseDenseIntersect), "bitset")
  assert.equal(isPerfectPrototypeBorrowedRowset(borrowedSparseDenseIntersect), true)
  assertSameValues(denseDenseIntersect, expectedDenseDense)
  assertSameValues(denseDenseSparseIntersect, expectedDenseDense)
  assertSameValues(sparseDenseIntersect, expectedSparseDense)
  assertSameValues(borrowedSparseDenseIntersect, expectedSparseDense)
  assert.deepStrictEqual(
    Array.from(materializePerfectPrototypeRowsetValues(denseDenseIntersect)),
    Array.from(materializePerfectPrototypeRowsetValuesJsReference(denseDenseIntersectJs)),
  )
  assert.deepStrictEqual(
    Array.from(materializePerfectPrototypeRowsetValues(denseDenseSparseIntersect)),
    Array.from(materializePerfectPrototypeRowsetValuesJsReference(denseDenseSparseIntersectJs)),
  )
  assert.deepStrictEqual(
    Array.from(materializePerfectPrototypeRowsetValues(sparseDenseIntersect)),
    Array.from(materializePerfectPrototypeRowsetValuesJsReference(sparseDenseIntersectJs)),
  )
  const smallerDenseUniverse = 260
  const smallerDenseSparseProbe = createPerfectPrototypeSparseRowset(
    Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 260, 261, 262, 263]),
  )
  const smallerDenseSparsePartner = createPerfectPrototypeBitsetRowset({
    values: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 260, 261, 262, 263]),
    universeSize: 320,
  })
  assertThrowsMatch(
    () =>
      intersectPerfectPrototypeRowsets({
        leftRowset: smallerDenseSparseProbe,
        rightRowset: smallerDenseSparsePartner,
        universeSize: smallerDenseUniverse,
        allowDense: true,
      }),
    /requires explicit universeSize to equal the bitset universe/u,
    "Dense sparse/bitset smaller-universe guard",
  )
  assertThrowsMatch(
    () =>
      intersectPerfectPrototypeRowsetsJsReference({
        leftRowset: smallerDenseSparseProbe,
        rightRowset: smallerDenseSparsePartner,
        universeSize: smallerDenseUniverse,
        allowDense: true,
      }),
    /requires explicit universeSize to equal the bitset universe/u,
    "Dense sparse/bitset JS reference smaller-universe guard",
  )
  const smallerDenseBitsetLeft = createPerfectPrototypeBitsetRowset({
    values: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 260, 261, 262, 263]),
    universeSize: 320,
  })
  const smallerDenseBitsetRight = createPerfectPrototypeBitsetRowset({
    values: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 260, 261, 262, 263]),
    universeSize: 320,
  })
  assertThrowsMatch(
    () =>
      intersectPerfectPrototypeRowsets({
        leftRowset: smallerDenseBitsetLeft,
        rightRowset: smallerDenseBitsetRight,
        universeSize: smallerDenseUniverse,
        allowDense: true,
      }),
    /requires explicit universeSize to equal the canonical dense universe/u,
    "Dense bitset/bitset smaller-universe guard",
  )
  assertThrowsMatch(
    () =>
      intersectPerfectPrototypeRowsetsJsReference({
        leftRowset: smallerDenseBitsetLeft,
        rightRowset: smallerDenseBitsetRight,
        universeSize: smallerDenseUniverse,
        allowDense: true,
      }),
    /requires explicit universeSize to equal the canonical dense universe/u,
    "Dense bitset/bitset JS reference smaller-universe guard",
  )
  assertThrowsMatch(
    () =>
      createPerfectPrototypeBitsetRowsetFromWords({
        words: Uint32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 240]),
        count: 12,
        universeSize: smallerDenseUniverse,
      }),
    /last word exceeds universe/u,
    "Bitset builder trailing-bit guard",
  )
  assertThrowsMatch(
    () =>
      createPerfectPrototypeBitsetRowsetFromWords({
        words: new Uint32Array(10),
        count: 0,
        universeSize: smallerDenseUniverse,
      }),
    /words length mismatch/u,
    "Bitset builder word-length guard",
  )
  assert.equal(
    arePerfectPrototypeRowsetsEqual(denseDenseIntersect, denseDenseIntersectJs),
    arePerfectPrototypeRowsetsEqualJsReference(denseDenseIntersect, denseDenseIntersectJs),
  )
  assert.equal(
    isPerfectPrototypeRowsetSubset(denseDenseSparseIntersect, denseDenseIntersect),
    isPerfectPrototypeRowsetSubsetJsReference(denseDenseSparseIntersect, denseDenseIntersect),
  )
  const denseEdgeSummary = summarizePerfectPrototypeRowsetEdges(denseDenseIntersect)
  assert.equal(denseEdgeSummary.firstValue, expectedDenseDense[0] ?? -1)
  assert.equal(denseEdgeSummary.lastValue, expectedDenseDense[expectedDenseDense.length - 1] ?? -1)
  const skewedSparseLeft = createPerfectPrototypeSparseRowset(
    Uint32Array.from(Array.from({ length: 24 }, (_, index) => index * 41 + 7)),
  )
  const skewedSparseRight = createPerfectPrototypeSparseRowset(
    Uint32Array.from(
      Array.from({ length: 5000 }, (_, index) => index * 3 + (index % 41 === 0 ? 7 : 1))
        .filter((value, index, list) => value <= 40000 && list.indexOf(value) === index)
        .sort((left, right) => left - right),
    ),
  )
  const skewedSparseIntersect = intersectPerfectPrototypeRowsets({
    leftRowset: skewedSparseLeft,
    rightRowset: skewedSparseRight,
    allowDense: false,
  })
  const skewedSparseIntersectJs = intersectPerfectPrototypeRowsetsJsReference({
    leftRowset: skewedSparseLeft,
    rightRowset: skewedSparseRight,
    allowDense: false,
  })
  assert.deepStrictEqual(
    Array.from(materializePerfectPrototypeRowsetValues(skewedSparseIntersect)),
    Array.from(materializePerfectPrototypeRowsetValuesJsReference(skewedSparseIntersectJs)),
  )
  const nearSizeSparseLeft = createPerfectPrototypeSparseRowset(
    Uint32Array.from([3, 7, 12, 18, 24, 31, 39, 48, 58, 69]),
  )
  const nearSizeSparseRight = createPerfectPrototypeSparseRowset(
    Uint32Array.from([1, 7, 11, 18, 21, 31, 37, 48, 50, 69, 72]),
  )
  const nearSizeSparseCount = intersectPerfectPrototypeRowsetsCount(
    nearSizeSparseLeft,
    nearSizeSparseRight,
  )
  const nearSizeSparseIntersect = intersectPerfectPrototypeRowsets({
    leftRowset: nearSizeSparseLeft,
    rightRowset: nearSizeSparseRight,
    allowDense: false,
  })
  const nearSizeSparseIntersectJs = intersectPerfectPrototypeRowsetsJsReference({
    leftRowset: nearSizeSparseLeft,
    rightRowset: nearSizeSparseRight,
    allowDense: false,
  })
  assert.equal(
    nearSizeSparseCount,
    materializePerfectPrototypeRowsetValues(nearSizeSparseIntersect).length,
  )
  assert.deepStrictEqual(
    Array.from(materializePerfectPrototypeRowsetValues(nearSizeSparseIntersect)),
    Array.from(materializePerfectPrototypeRowsetValuesJsReference(nearSizeSparseIntersectJs)),
  )
  const sparseBitmapPartialProbe = createPerfectPrototypeSparseRowset(
    Uint32Array.from([1, 2, 3, 4, 40, 41, 42, 43]),
  )
  const sparseBitmapPartialPartner = createPerfectPrototypeBitsetRowset({
    values: Uint32Array.from([1, 3, 40, 43, 80]),
    universeSize: 128,
  })
  const sparseBitmapPartialCount = intersectPerfectPrototypeRowsetsCount(
    sparseBitmapPartialProbe,
    sparseBitmapPartialPartner,
  )
  const sparseBitmapPartialIntersect = intersectPerfectPrototypeRowsets({
    leftRowset: sparseBitmapPartialProbe,
    rightRowset: sparseBitmapPartialPartner,
    universeSize: 128,
    allowDense: false,
  })
  const sparseBitmapPartialJs = intersectPerfectPrototypeRowsetsJsReference({
    leftRowset: sparseBitmapPartialProbe,
    rightRowset: sparseBitmapPartialPartner,
    universeSize: 128,
    allowDense: false,
  })
  assert.equal(
    sparseBitmapPartialCount,
    materializePerfectPrototypeRowsetValues(sparseBitmapPartialIntersect).length,
  )
  assert.deepStrictEqual(
    Array.from(materializePerfectPrototypeRowsetValues(sparseBitmapPartialIntersect)),
    Array.from(materializePerfectPrototypeRowsetValuesJsReference(sparseBitmapPartialJs)),
  )
  const sparseBitmapFullProbe = createPerfectPrototypeSparseRowset(
    Uint32Array.from([64, 65, 66, 67]),
  )
  const sparseBitmapFullPartner = createPerfectPrototypeBitsetRowset({
    values: Uint32Array.from([64, 65, 66, 67, 90]),
    universeSize: 128,
  })
  const sparseBitmapFullCount = intersectPerfectPrototypeRowsetsCount(
    sparseBitmapFullProbe,
    sparseBitmapFullPartner,
  )
  const sparseBitmapFullIntersect = intersectPerfectPrototypeRowsets({
    leftRowset: sparseBitmapFullProbe,
    rightRowset: sparseBitmapFullPartner,
    universeSize: 128,
    allowDense: false,
  })
  const sparseBitmapFullJs = intersectPerfectPrototypeRowsetsJsReference({
    leftRowset: sparseBitmapFullProbe,
    rightRowset: sparseBitmapFullPartner,
    universeSize: 128,
    allowDense: false,
  })
  assert.equal(
    sparseBitmapFullCount,
    materializePerfectPrototypeRowsetValues(sparseBitmapFullIntersect).length,
  )
  assert.deepStrictEqual(
    Array.from(materializePerfectPrototypeRowsetValues(sparseBitmapFullIntersect)),
    Array.from(materializePerfectPrototypeRowsetValuesJsReference(sparseBitmapFullJs)),
  )
  const ownedClone = clonePerfectPrototypeRowsetOwned(borrowedSparseDenseIntersect)
  releasePerfectPrototypeBorrowedRowset(borrowedSparseDenseIntersect)
  let releasedBorrowThrown = false
  try {
    materializePerfectPrototypeRowsetValues(borrowedSparseDenseIntersect)
  } catch (error) {
    releasedBorrowThrown = true
  }
  assert.equal(releasedBorrowThrown, true)
  assertSameValues(ownedClone, expectedSparseDense)

  return {
    denseDenseCount: expectedDenseDense.length,
    denseDenseSparseCount: expectedDenseDense.length,
    sparseDenseCount: expectedSparseDense.length,
    borrowedSparseDenseCount: expectedSparseDense.length,
    nearSizeSparseCount,
    sparseBitmapPartialCount,
    sparseBitmapFullCount,
  }
}

const runStateCacheFixtures = () => {
  const positiveRowset = createPerfectPrototypeSparseRowset(Uint32Array.from([1, 3, 5, 7, 9, 11]))
  const dominatedNegative = createPerfectPrototypeSparseRowset(Uint32Array.from([2, 4]))
  const widerNegative = createPerfectPrototypeSparseRowset(Uint32Array.from([2, 4, 6]))
  const equalSizeNegative = createPerfectPrototypeSparseRowset(Uint32Array.from([2, 4, 6, 8]))
  const dominanceCache = createPerfectPrototypeSearchStateCache({
    maxBytes: 4 * 1024,
  })

  assert.equal(
    dominanceCache.isDominated({
      positiveRowset,
      negativeRowset: dominatedNegative,
      startAt: 4,
      ruleSize: 1,
    }),
    false,
  )
  assert.equal(
    dominanceCache.isDominated({
      positiveRowset,
      negativeRowset: widerNegative,
      startAt: 4,
      ruleSize: 2,
    }),
    true,
  )
  assert.equal(
    dominanceCache.isDominated({
      positiveRowset,
      negativeRowset: equalSizeNegative,
      startAt: 4,
      ruleSize: 1,
    }),
    false,
  )

  const evictionCache = createPerfectPrototypeSearchStateCache({
    maxBytes: 512,
  })
  for (let index = 0; index < 24; index += 1) {
    const start = index * 8
    const nextPositive = createPerfectPrototypeRowset({
      values: Uint32Array.from([start, start + 1, start + 2, start + 3]),
      universeSize: 512,
      allowDense: false,
    })
    const nextNegative = createPerfectPrototypeRowset({
      values: Uint32Array.from(Array.from({ length: 40 }, (_, offset) => start + offset + 20)),
      universeSize: 512,
      allowDense: true,
    })
    evictionCache.isDominated({
      positiveRowset: nextPositive,
      negativeRowset: nextNegative,
      startAt: index + 1,
      ruleSize: 1,
    })
  }
  const evictionStats = evictionCache.getStats()
  assert(Number(evictionStats.evictedBucketCount ?? 0) >= 1 || Number(evictionStats.oversizeSkipCount ?? 0) >= 1)
  assert(Number(evictionStats.cacheBytes ?? 0) <= 512)
  if (Number(evictionStats.positiveSignatureBucketCount ?? 0) === 0) {
    assert.equal(Number(evictionStats.cacheBytes ?? 0), 0)
  }

  const skylineCache = createPerfectPrototypeSearchStateCache({
    maxBytes: 16 * 1024,
  })
  const exactFingerprintCache = createPerfectPrototypeSearchStateCache({
    maxBytes: 16 * 1024,
  })
  assert.equal(
    exactFingerprintCache.isDominated({
      positiveRowset,
      negativeRowset: createPerfectPrototypeSparseRowset(Uint32Array.from([2, 4, 6])),
      startAt: 4,
      ruleSize: 3,
    }),
    false,
  )
  assert.equal(
    exactFingerprintCache.isDominated({
      positiveRowset,
      negativeRowset: createPerfectPrototypeSparseRowset(Uint32Array.from([2, 4, 6])),
      startAt: 4,
      ruleSize: 4,
    }),
    true,
  )
  const exactFingerprintStats = exactFingerprintCache.getStats()
  assert(Number(exactFingerprintStats.memoExactFingerprintFastHitCount ?? 0) >= 1)
  assert(Number(exactFingerprintStats.memoExactFingerprintScanCount ?? 0) >= 1)

  for (const values of [
    [2, 4, 6],
    [2, 4, 8],
    [2, 4, 10],
    [2, 4, 12],
    [20, 22, 24],
  ]) {
    assert.equal(
      skylineCache.isDominated({
        positiveRowset,
        negativeRowset: createPerfectPrototypeSparseRowset(Uint32Array.from(values)),
        startAt: 4,
        ruleSize: 3,
      }),
      false,
    )
  }
  assert.equal(
    skylineCache.isDominated({
      positiveRowset,
      negativeRowset: createPerfectPrototypeSparseRowset(Uint32Array.from([2, 4])),
      startAt: 3,
      ruleSize: 1,
    }),
    false,
  )
  assert.equal(
    skylineCache.isDominated({
      positiveRowset,
      negativeRowset: createPerfectPrototypeSparseRowset(Uint32Array.from([1, 3, 5])),
      startAt: 5,
      ruleSize: 4,
    }),
    false,
  )
  assert.equal(
    skylineCache.isDominated({
      positiveRowset,
      negativeRowset: createPerfectPrototypeSparseRowset(Uint32Array.from([30, 32, 34])),
      startAt: 20,
      ruleSize: 10,
    }),
    false,
  )
  const skylineStats = skylineCache.getStats()
  assert(Number(skylineStats.memoFrontierSkippedBucketCount ?? 0) >= 1)
  assert(Number(skylineStats.memoFrontierCompactionCount ?? 0) >= 1)
  assert(Number(skylineStats.memoRangeSkipPrefixCount ?? 0) >= 1)
  assert(Number(skylineStats.memoRangeSkipSuffixCount ?? 0) >= 1)
  assert(
    Number(skylineStats.memoRangeSummaryRebuildCount ?? 0) <= 1,
    `Expected local frontier maintenance to avoid repeated range-summary rebuilds; actual=${Number(skylineStats.memoRangeSummaryRebuildCount ?? 0)}`,
  )
  assert(Number(skylineStats.memoFingerprintMetadataRebuildCount ?? 0) >= 0)

  const insertionCompactionCache = createPerfectPrototypeSearchStateCache({
    maxBytes: 16 * 1024,
  })
  assert.equal(
    insertionCompactionCache.isDominated({
      positiveRowset,
      negativeRowset: createPerfectPrototypeSparseRowset(Uint32Array.from([2, 4, 6])),
      startAt: 10,
      ruleSize: 3,
    }),
    false,
  )
  assert.equal(
    insertionCompactionCache.isDominated({
      positiveRowset,
      negativeRowset: createPerfectPrototypeSparseRowset(Uint32Array.from([2, 8, 10])),
      startAt: 10,
      ruleSize: 3,
    }),
    false,
  )
  assert.equal(
    insertionCompactionCache.isDominated({
      positiveRowset,
      negativeRowset: createPerfectPrototypeSparseRowset(Uint32Array.from([12, 14, 16])),
      startAt: 10,
      ruleSize: 3,
    }),
    false,
  )
  assert.equal(
    insertionCompactionCache.isDominated({
      positiveRowset,
      negativeRowset: createPerfectPrototypeSparseRowset(Uint32Array.from([2, 4])),
      startAt: 9,
      ruleSize: 1,
    }),
    false,
  )
  const insertionCompactionAfterPrune = insertionCompactionCache.getStats()
  assert(Number(insertionCompactionAfterPrune.memoFrontierTombstoneCount ?? 0) >= 1)
  assert.equal(Number(insertionCompactionAfterPrune.memoFrontierCompactionCount ?? 0), 0)
  assert.equal(
    insertionCompactionCache.isDominated({
      positiveRowset,
      negativeRowset: createPerfectPrototypeSparseRowset(Uint32Array.from([20, 22, 24])),
      startAt: 10,
      ruleSize: 3,
    }),
    false,
  )
  const insertionCompactionStats = insertionCompactionCache.getStats()
  assert.equal(Number(insertionCompactionStats.memoFrontierTombstoneCount ?? 0), 0)
  assert(Number(insertionCompactionStats.memoFrontierCompactionCount ?? 0) >= 1)

  return {
    memoLookupMs: Number(evictionStats.memoLookupMs ?? 0),
    memoCacheBytes: Number(evictionStats.cacheBytes ?? 0),
    memoEvictedBucketCount: Number(evictionStats.evictedBucketCount ?? 0),
    memoOversizeSkipCount: Number(evictionStats.oversizeSkipCount ?? 0),
    memoFrontierSkippedBucketCount: Number(skylineStats.memoFrontierSkippedBucketCount ?? 0),
    memoFrontierCompactionCount: Number(skylineStats.memoFrontierCompactionCount ?? 0),
    memoInsertionCompactionCount: Number(
      insertionCompactionStats.memoFrontierCompactionCount ?? 0,
    ),
    memoRangeSkipPrefixCount: Number(skylineStats.memoRangeSkipPrefixCount ?? 0),
    memoRangeSkipSuffixCount: Number(skylineStats.memoRangeSkipSuffixCount ?? 0),
    memoRangeSummaryRebuildCount: Number(skylineStats.memoRangeSummaryRebuildCount ?? 0),
    memoExactFingerprintFastHitCount: Number(
      exactFingerprintStats.memoExactFingerprintFastHitCount ?? 0,
    ),
    memoExactFingerprintScanCount: Number(
      exactFingerprintStats.memoExactFingerprintScanCount ?? 0,
    ),
    memoFingerprintMetadataRebuildCount: Number(
      exactFingerprintStats.memoFingerprintMetadataRebuildCount ??
        skylineStats.memoFingerprintMetadataRebuildCount ??
        0,
    ),
  }
}

const runPostingDecodeFixtures = () => {
  const values = Uint32Array.from([1, 5, 9, 15, 31, 63, 127, 255, 300, 333])
  const buffer = encodePerfectPrototypeDeltaPostings(values, { preSorted: true })
  const nativeArray = decodePerfectPrototypeDeltaPostings(buffer, values.length)
  const jsArray = decodePerfectPrototypeDeltaPostingsJsReference(buffer, values.length)
  assert.deepStrictEqual(Array.from(nativeArray), Array.from(jsArray))

  const nativeBitmap = decodePerfectPrototypeDeltaPostingsToBitset({
    buffer,
    count: values.length,
    universeSize: 512,
  })
  const jsBitmap = decodePerfectPrototypeDeltaPostingsToBitsetJsReference({
    buffer,
    count: values.length,
    universeSize: 512,
  })
  assert.equal(Number(nativeBitmap?.count ?? 0), Number(jsBitmap?.count ?? 0))
  assert.deepStrictEqual(Array.from(nativeBitmap.words ?? []), Array.from(jsBitmap.words ?? []))

  return {
    decodedArrayCount: nativeArray.length,
    decodedBitmapCount: Number(nativeBitmap?.count ?? 0),
  }
}

const main = async () => {
  const cwd = process.cwd()
  const smokeScriptPath = path.join(cwd, "tools", "smoke_prejump_indexed_equivalence.mjs")
  const smoke = await spawnNode({
    cwd,
    scriptPath: smokeScriptPath,
  })
  const smokeSummary = JSON.parse(String(smoke.stdout ?? "").trim())
  const rootDir = path.resolve(String(smokeSummary?.rootDir ?? "").trim())
  if (!rootDir) {
    throw new Error("Indexed adversarial smoke missing rootDir from indexed equivalence smoke")
  }
  const indexDir = path.join(rootDir, "index")
  const partialNoBoundDir = path.join(rootDir, "partial_no_bound")
  const partialWithBoundDir = path.join(rootDir, "partial_with_bound")
  const partialWithBoundNoRerankDir = path.join(rootDir, "partial_with_bound_no_rerank")
  const partialWithBoundHeadRerankDir = path.join(rootDir, "partial_with_bound_head_rerank")
  const fullSmallTopKBaselineDir = path.join(rootDir, "full_small_topk_baseline")
  const fullSmallTopKSeededDir = path.join(rootDir, "full_small_topk_seeded")
  await ensureDir(rootDir)

  const indexedBaseline = await readJson(path.join(rootDir, "indexed", "catalog.json"), null)
  assert(indexedBaseline, "Indexed equivalence smoke catalog is missing")

  const miningOptions = {
    trainStartDate: "2024-01-02",
    trainEndDate: "2024-01-15",
    minHitCount: 6,
    maxGapTradingDays: 100000,
    maxRuleSize: 6,
    maxSeedTokens: 4000,
    maxRules: 4000,
    maxSearchStates: 20000000,
    searchStateCacheMaxBytes: 32 * 1024,
  }

  const partialNoBound = await minePerfectPrototypeIndexed({
    cwd,
    indexDir,
    outDir: partialNoBoundDir,
    options: {
      ...miningOptions,
      outputMode: "partial",
      enablePartialTopKHitBound: false,
    },
  })

  const partialWithBound = await minePerfectPrototypeIndexed({
    cwd,
    indexDir,
    outDir: partialWithBoundDir,
    options: {
      ...miningOptions,
      outputMode: "partial",
      enablePartialTopKHitBound: true,
      orderingHeadWindow: 8,
    },
  })

  const partialWithBoundNoRerank = await minePerfectPrototypeIndexed({
    cwd,
    indexDir,
    outDir: partialWithBoundNoRerankDir,
    options: {
      ...miningOptions,
      outputMode: "partial",
      enablePartialTopKHitBound: true,
      orderingHeadWindow: 0,
    },
  })

  const partialWithBoundHeadRerank = await minePerfectPrototypeIndexed({
    cwd,
    indexDir,
    outDir: partialWithBoundHeadRerankDir,
    options: {
      ...miningOptions,
      outputMode: "partial",
      enablePartialTopKHitBound: true,
      orderingHeadWindow: 8,
    },
  })
  const smallTopKOptions = {
    ...miningOptions,
    maxRules: 1,
  }
  const fullSmallTopKBaseline = await minePerfectPrototypeIndexed({
    cwd,
    indexDir,
    outDir: fullSmallTopKBaselineDir,
    options: smallTopKOptions,
  })
  const seededInitialKthHitFloor = Number(
    fullSmallTopKBaseline.rejectionSummary?.kthHitFloor ??
      fullSmallTopKBaseline.rejectionSummary?.effectiveKthHitFloor ??
      fullSmallTopKBaseline.rules?.[0]?.trainHitCount ??
      0,
  )
  let fullSmallTopKSeeded = fullSmallTopKBaseline
  if (Number.isInteger(seededInitialKthHitFloor) && seededInitialKthHitFloor > 0) {
    fullSmallTopKSeeded = await minePerfectPrototypeIndexed({
      cwd,
      indexDir,
      outDir: fullSmallTopKSeededDir,
      options: {
        ...smallTopKOptions,
        initialKthHitFloor: seededInitialKthHitFloor,
      },
    })
  } else {
    assert.equal(
      Array.isArray(fullSmallTopKBaseline.rules) ? fullSmallTopKBaseline.rules.length : 0,
      0,
      "seeded kth-hit-floor branch may be skipped only when the baseline full top-K run produces no rules",
    )
  }

  assert.deepStrictEqual(
    (partialNoBound.rules ?? []).map(normalizeRule),
    (partialWithBound.rules ?? []).map(normalizeRule),
  )
  assert.deepStrictEqual(
    (partialWithBoundNoRerank.rules ?? []).map(normalizeRule),
    (partialWithBoundHeadRerank.rules ?? []).map(normalizeRule),
  )
  assert(
    Number(partialWithBound.rejectionSummary?.observedRuleCount ?? 0) >=
      Number(partialWithBound.rejectionSummary?.liveCanonicalRuleCount ?? 0),
  )
  assert.equal(
    Number(partialWithBound.rejectionSummary?.liveCanonicalRuleCount ?? 0),
    Array.isArray(partialWithBound.rules) ? partialWithBound.rules.length : 0,
  )
  assert.equal(
    Number(partialWithBound.rejectionSummary?.finalSelectedRuleCount ?? 0),
    Array.isArray(partialWithBound.rules) ? partialWithBound.rules.length : 0,
  )
  assert(Number(partialWithBoundHeadRerank.rejectionSummary?.orderingHeadExactLoads ?? 0) >= 0)
  assert(Number(partialWithBoundHeadRerank.rejectionSummary?.orderingHeadRerankMs ?? 0) >= 0)
  assert.equal(
    String(partialWithBound.rejectionSummary?.sparseKernelMode ?? ""),
    "adaptive_exact_v4",
  )
  assert(Number(partialWithBound.rejectionSummary?.sparseSparseIntersectionMs ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.sparseBitmapIntersectionMs ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.sparseEqualSizeMergeCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.sparseAdaptiveGallopCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.sparseCountFastPathCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.sparseBitmapWordRunCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.sparseBitmapSkippedRunCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.sparseBitmapPartialRunCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.sparseBitmapFullRunHitCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.memoFrontierBucketCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.memoFrontierTombstoneCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.memoFrontierSkippedBucketCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.memoFrontierCompactionCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.memoRangeSkipPrefixCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.memoRangeSkipSuffixCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.memoRangeSummaryRebuildCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.memoExactFingerprintFastHitCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.memoExactFingerprintScanCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.memoFingerprintMetadataRebuildCount ?? 0) >= 0)
  assert.equal(
    String(partialWithBound.rejectionSummary?.bitmapKernelMode ?? ""),
    "avx2_exact_bitset",
  )
  assert(Number(partialWithBound.rejectionSummary?.bitmapDenseDenseCount ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.bitmapIntersectionMs ?? 0) >= 0)
  assert(Number(partialWithBound.rejectionSummary?.bitmapMaterializeMs ?? 0) >= 0)
  assert.deepStrictEqual(
    (fullSmallTopKBaseline.rules ?? []).map(normalizeRule),
    (fullSmallTopKSeeded.rules ?? []).map(normalizeRule),
  )
  assert.equal(
    fullSmallTopKBaseline.catalog?.champion?.ruleId ?? null,
    fullSmallTopKSeeded.catalog?.champion?.ruleId ?? null,
  )
  if (Number.isInteger(seededInitialKthHitFloor) && seededInitialKthHitFloor > 0) {
    assert.equal(
      Number(fullSmallTopKSeeded.rejectionSummary?.initialKthHitFloor ?? 0),
      seededInitialKthHitFloor,
    )
  }

  const rowsetSummary = runRowsetFixtures()
  const stateCacheSummary = runStateCacheFixtures()
  const decodeSummary = runPostingDecodeFixtures()

  const summary = {
    status: "ok",
    rootDir,
    indexedChampionRuleId: indexedBaseline.champion?.ruleId ?? null,
    partialRuleCount: Array.isArray(partialWithBound.rules) ? partialWithBound.rules.length : 0,
    partialMemoEvictedBucketCount: Number(partialWithBound.rejectionSummary?.memoEvictedBucketCount ?? 0),
    partialMemoLookupMs: Number(partialWithBound.rejectionSummary?.memoLookupMs ?? 0),
    partialOrderingNegativeLoads: Number(partialWithBound.rejectionSummary?.orderingNegativeLoads ?? 0),
    partialOrderingHeadWindow: Number(partialWithBoundHeadRerank.rejectionSummary?.orderingHeadWindow ?? 0),
    partialOrderingHeadExactLoads: Number(
      partialWithBoundHeadRerank.rejectionSummary?.orderingHeadExactLoads ?? 0,
    ),
    partialOrderingHeadRerankMs: Number(
      partialWithBoundHeadRerank.rejectionSummary?.orderingHeadRerankMs ?? 0,
    ),
    partialObservedRuleCount: Number(partialWithBound.rejectionSummary?.observedRuleCount ?? 0),
    partialLiveCanonicalRuleCount: Number(
      partialWithBound.rejectionSummary?.liveCanonicalRuleCount ?? 0,
    ),
    partialFinalSelectedRuleCount: Number(
      partialWithBound.rejectionSummary?.finalSelectedRuleCount ?? 0,
    ),
    seededInitialKthHitFloor,
    seededFullRuleCount: Array.isArray(fullSmallTopKSeeded.rules)
      ? fullSmallTopKSeeded.rules.length
      : 0,
    sparseKernelMode: String(partialWithBound.rejectionSummary?.sparseKernelMode ?? ""),
    sparseSparseIntersectionMs: Number(
      partialWithBound.rejectionSummary?.sparseSparseIntersectionMs ?? 0,
    ),
    sparseBitmapIntersectionMs: Number(
      partialWithBound.rejectionSummary?.sparseBitmapIntersectionMs ?? 0,
    ),
    sparseEqualSizeMergeCount: Number(
      partialWithBound.rejectionSummary?.sparseEqualSizeMergeCount ?? 0,
    ),
    sparseAdaptiveGallopCount: Number(
      partialWithBound.rejectionSummary?.sparseAdaptiveGallopCount ?? 0,
    ),
    sparseCountFastPathCount: Number(
      partialWithBound.rejectionSummary?.sparseCountFastPathCount ?? 0,
    ),
    sparseBitmapWordRunCount: Number(
      partialWithBound.rejectionSummary?.sparseBitmapWordRunCount ?? 0,
    ),
    sparseBitmapSkippedRunCount: Number(
      partialWithBound.rejectionSummary?.sparseBitmapSkippedRunCount ?? 0,
    ),
    sparseBitmapPartialRunCount: Number(
      partialWithBound.rejectionSummary?.sparseBitmapPartialRunCount ?? 0,
    ),
    sparseBitmapFullRunHitCount: Number(
      partialWithBound.rejectionSummary?.sparseBitmapFullRunHitCount ?? 0,
    ),
    memoFrontierBucketCount: Number(
      partialWithBound.rejectionSummary?.memoFrontierBucketCount ?? 0,
    ),
    memoFrontierTombstoneCount: Number(
      partialWithBound.rejectionSummary?.memoFrontierTombstoneCount ?? 0,
    ),
    memoFrontierSkippedBucketCount: Number(
      partialWithBound.rejectionSummary?.memoFrontierSkippedBucketCount ?? 0,
    ),
    memoFrontierCompactionCount: Number(
      partialWithBound.rejectionSummary?.memoFrontierCompactionCount ?? 0,
    ),
    memoRangeSkipPrefixCount: Number(
      partialWithBound.rejectionSummary?.memoRangeSkipPrefixCount ?? 0,
    ),
    memoRangeSkipSuffixCount: Number(
      partialWithBound.rejectionSummary?.memoRangeSkipSuffixCount ?? 0,
    ),
    memoRangeSummaryRebuildCount: Number(
      partialWithBound.rejectionSummary?.memoRangeSummaryRebuildCount ?? 0,
    ),
    memoExactFingerprintFastHitCount: Number(
      partialWithBound.rejectionSummary?.memoExactFingerprintFastHitCount ?? 0,
    ),
    memoExactFingerprintScanCount: Number(
      partialWithBound.rejectionSummary?.memoExactFingerprintScanCount ?? 0,
    ),
    memoFingerprintMetadataRebuildCount: Number(
      partialWithBound.rejectionSummary?.memoFingerprintMetadataRebuildCount ?? 0,
    ),
    bitmapKernelMode: String(partialWithBound.rejectionSummary?.bitmapKernelMode ?? ""),
    bitmapDenseDenseCount: Number(partialWithBound.rejectionSummary?.bitmapDenseDenseCount ?? 0),
    bitmapIntersectionMs: Number(partialWithBound.rejectionSummary?.bitmapIntersectionMs ?? 0),
    bitmapMaterializeMs: Number(partialWithBound.rejectionSummary?.bitmapMaterializeMs ?? 0),
    rowsetSummary,
    stateCacheSummary,
    decodeSummary,
  }
  await writeJson(path.join(rootDir, "adversarial_equivalence_summary.json"), summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
