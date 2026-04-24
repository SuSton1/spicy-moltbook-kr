import assert from "node:assert/strict"

import {
  createPerfectPrototypeBitsetRowset,
  createPerfectPrototypeRowset,
  getPerfectPrototypeRowsetCount,
  intersectPerfectPrototypeRowsets,
  intersectPerfectPrototypeRowsetsCountBatch,
  intersectPerfectPrototypeRowsetsCount,
  intersectPerfectPrototypeRowsetsPrepared,
  materializePerfectPrototypeRowsetValues,
  releasePerfectPrototypeBorrowedRowset,
} from "../src/lib/perfect_prototype_rowset.mjs"

const comparePreparedIntersection = ({
  label,
  leftRowset,
  rightRowset,
  universeSize = null,
  allowDense = false,
}) => {
  const expectedCount = intersectPerfectPrototypeRowsetsCount(leftRowset, rightRowset)
  const expectedRowset = intersectPerfectPrototypeRowsets({
    leftRowset,
    rightRowset,
    countHint: expectedCount,
    universeSize,
    allowDense,
    resultOwnership: "owned",
  })
  const prepared = intersectPerfectPrototypeRowsetsPrepared({
    leftRowset,
    rightRowset,
    universeSize,
    allowDense,
    resultOwnership: "borrowed",
  })
  try {
    assert.equal(
      prepared.count,
      expectedCount,
      `${label} prepared count mismatch: actual=${prepared.count} expected=${expectedCount}`,
    )
    assert.equal(
      getPerfectPrototypeRowsetCount(prepared.rowset),
      expectedCount,
      `${label} prepared rowset count mismatch`,
    )
    assert.deepEqual(
      Array.from(materializePerfectPrototypeRowsetValues(prepared.rowset)),
      Array.from(materializePerfectPrototypeRowsetValues(expectedRowset)),
      `${label} prepared values mismatch`,
    )
  } finally {
    releasePerfectPrototypeBorrowedRowset(prepared.rowset)
    releasePerfectPrototypeBorrowedRowset(expectedRowset)
  }
}

const compareBatchCounts = ({
  label,
  leftRowset,
  rightRowsets,
}) => {
  const expected = rightRowsets.map((rightRowset) =>
    intersectPerfectPrototypeRowsetsCount(leftRowset, rightRowset),
  )
  const actual = Array.from(
    intersectPerfectPrototypeRowsetsCountBatch({
      leftRowset,
      rightRowsets,
    }),
  )
  assert.deepEqual(
    actual,
    expected,
    `${label} batch counts mismatch`,
  )
}

const main = async () => {
  const sparseLeft = createPerfectPrototypeRowset({
    values: Uint32Array.from([1, 3, 5, 7, 9]),
    universeSize: 512,
    allowDense: false,
  })
  const sparseRight = createPerfectPrototypeRowset({
    values: Uint32Array.from([0, 3, 5, 8, 9]),
    universeSize: 512,
    allowDense: false,
  })
  comparePreparedIntersection({
    label: "sparse/sparse",
    leftRowset: sparseLeft,
    rightRowset: sparseRight,
    universeSize: 512,
    allowDense: false,
  })
  compareBatchCounts({
    label: "sparse-left-mixed-rights",
    leftRowset: sparseLeft,
    rightRowsets: [
      sparseRight,
      createPerfectPrototypeBitsetRowset({
        values: Uint32Array.from([1, 5, 7, 8, 9]),
        universeSize: 512,
      }),
    ],
  })

  const sparseDenseLeft = createPerfectPrototypeRowset({
    values: Uint32Array.from([2, 4, 6, 8, 10]),
    universeSize: 2048,
    allowDense: false,
  })
  const sparseDenseRight = createPerfectPrototypeBitsetRowset({
    values: Uint32Array.from([1, 2, 4, 6, 7, 9, 10, 11]),
    universeSize: 2048,
  })
  comparePreparedIntersection({
    label: "sparse/bitset-sparse-result",
    leftRowset: sparseDenseLeft,
    rightRowset: sparseDenseRight,
    universeSize: 2048,
    allowDense: true,
  })

  const sparseBitsetDenseLeft = createPerfectPrototypeRowset({
    values: Uint32Array.from(Array.from({ length: 80 }, (_, index) => index)),
    universeSize: 256,
    allowDense: false,
  })
  const sparseBitsetDenseRight = createPerfectPrototypeBitsetRowset({
    values: Uint32Array.from(Array.from({ length: 96 }, (_, index) => index)),
    universeSize: 256,
  })
  comparePreparedIntersection({
    label: "sparse/bitset-dense-result",
    leftRowset: sparseBitsetDenseLeft,
    rightRowset: sparseBitsetDenseRight,
    universeSize: 256,
    allowDense: true,
  })

  const bitsetSparseLeft = createPerfectPrototypeBitsetRowset({
    values: Uint32Array.from([10, 30, 50, 70]),
    universeSize: 2048,
  })
  const bitsetSparseRight = createPerfectPrototypeBitsetRowset({
    values: Uint32Array.from([5, 10, 50, 99]),
    universeSize: 2048,
  })
  comparePreparedIntersection({
    label: "bitset/bitset-sparse-result",
    leftRowset: bitsetSparseLeft,
    rightRowset: bitsetSparseRight,
    universeSize: 2048,
    allowDense: true,
  })

  const bitsetDenseLeft = createPerfectPrototypeBitsetRowset({
    values: Uint32Array.from(Array.from({ length: 96 }, (_, index) => index)),
    universeSize: 256,
  })
  const bitsetDenseRight = createPerfectPrototypeBitsetRowset({
    values: Uint32Array.from(Array.from({ length: 80 }, (_, index) => index + 8)),
    universeSize: 256,
  })
  comparePreparedIntersection({
    label: "bitset/bitset-dense-result",
    leftRowset: bitsetDenseLeft,
    rightRowset: bitsetDenseRight,
    universeSize: 256,
    allowDense: true,
  })
  compareBatchCounts({
    label: "bitset-left-mixed-rights",
    leftRowset: bitsetDenseLeft,
    rightRowsets: [
      createPerfectPrototypeRowset({
        values: Uint32Array.from([1, 8, 24, 40, 96]),
        universeSize: 256,
        allowDense: false,
      }),
      bitsetDenseRight,
    ],
  })

  console.log(
    JSON.stringify(
      {
        status: "ok",
        cases: 7,
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
