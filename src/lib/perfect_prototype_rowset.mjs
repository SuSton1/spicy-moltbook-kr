import crypto from "node:crypto"
import {
  nativePerfectPrototypeRowsetKernel,
  nativePerfectPrototypeRowsetKernelBuildInfo,
} from "./perfect_prototype_rowset_native.mjs"
import { createPerfectPrototypeRowsetPool } from "./perfect_prototype_rowset_pool.mjs"

const PERFECT_PROTOTYPE_ROWSET_SPARSE = "sparse"
const PERFECT_PROTOTYPE_ROWSET_BITSET = "bitset"
// Backend metadata is descriptive only; the stable external rowset contract remains sparse|bitset.
const PERFECT_PROTOTYPE_ROWSET_BACKEND_ARRAY_EXACT = "array_exact"
const PERFECT_PROTOTYPE_ROWSET_BACKEND_BITMAP_EXACT = "bitmap_exact"
const PERFECT_PROTOTYPE_ROWSET_OWNED = "owned"
const PERFECT_PROTOTYPE_ROWSET_BORROWED = "borrowed"
const PERFECT_PROTOTYPE_ROWSET_HASH = Symbol("perfectPrototypeRowsetHash")
const PERFECT_PROTOTYPE_ROWSET_EDGES = Symbol("perfectPrototypeRowsetEdges")
const PERFECT_PROTOTYPE_ROWSET_FINGERPRINT = Symbol("perfectPrototypeRowsetFingerprint")
const PERFECT_PROTOTYPE_ROWSET_OWNERSHIP = Symbol("perfectPrototypeRowsetOwnership")
const PERFECT_PROTOTYPE_ROWSET_LEASE = Symbol("perfectPrototypeRowsetLease")
const PERFECT_PROTOTYPE_ROWSET_RELEASED = Symbol("perfectPrototypeRowsetReleased")
const PERFECT_PROTOTYPE_ROWSET_POOL_REQUIRED =
  String(process.env.PREJUMP_ROWSET_POOL_REQUIRED ?? "true").trim().toLowerCase() === "true"
const PERFECT_PROTOTYPE_SPARSE_KERNEL_REQUIRED =
  String(process.env.PREJUMP_SPARSE_KERNEL_REQUIRED ?? "true").trim().toLowerCase() === "true"
const perfectPrototypeRowsetPool = createPerfectPrototypeRowsetPool()

let rowsetOwnedAllocCount = 0
let rowsetFinalizeCount = 0
let bitmapDenseDenseCount = 0
let sparseSparseIntersectionMs = 0
let sparseBitmapIntersectionMs = 0
let bitmapIntersectionMs = 0
let bitmapMaterializeMs = 0
let bitmapEdgeSummaryMs = 0

const nowMs = () => Number(process.hrtime.bigint()) / 1e6

const getNativePerfectPrototypeRowsetRuntimeStats = () => {
  if (typeof nativePerfectPrototypeRowsetKernel?.getRuntimeStats !== "function") {
    throw new Error("Perfect prototype native rowset kernel must expose getRuntimeStats()")
  }
  return nativePerfectPrototypeRowsetKernel.getRuntimeStats()
}

const resetNativePerfectPrototypeRowsetRuntimeStats = () => {
  if (typeof nativePerfectPrototypeRowsetKernel?.resetRuntimeStats !== "function") {
    throw new Error("Perfect prototype native rowset kernel must expose resetRuntimeStats()")
  }
  nativePerfectPrototypeRowsetKernel.resetRuntimeStats()
}

if (PERFECT_PROTOTYPE_SPARSE_KERNEL_REQUIRED !== true) {
  throw new Error("Perfect prototype sparse kernel contract requires PREJUMP_SPARSE_KERNEL_REQUIRED=true")
}

const normalizeRowsetOwnership = (ownership) =>
  String(ownership ?? PERFECT_PROTOTYPE_ROWSET_OWNED).trim().toLowerCase() ===
  PERFECT_PROTOTYPE_ROWSET_BORROWED
    ? PERFECT_PROTOTYPE_ROWSET_BORROWED
    : PERFECT_PROTOTYPE_ROWSET_OWNED

const attachPerfectPrototypeRowsetOwnership = (rowset, { ownership, lease = null } = {}) => {
  const resolvedOwnership = normalizeRowsetOwnership(ownership)
  if (resolvedOwnership === PERFECT_PROTOTYPE_ROWSET_BORROWED && PERFECT_PROTOTYPE_ROWSET_POOL_REQUIRED !== true) {
    throw new Error("Perfect prototype rowset pool contract requires PREJUMP_ROWSET_POOL_REQUIRED=true")
  }
  if (resolvedOwnership === PERFECT_PROTOTYPE_ROWSET_OWNED) {
    rowsetOwnedAllocCount += 1
  }
  Object.defineProperty(rowset, PERFECT_PROTOTYPE_ROWSET_OWNERSHIP, {
    value: resolvedOwnership,
    configurable: true,
  })
  Object.defineProperty(rowset, PERFECT_PROTOTYPE_ROWSET_LEASE, {
    value: lease,
    configurable: true,
  })
  Object.defineProperty(rowset, PERFECT_PROTOTYPE_ROWSET_RELEASED, {
    value: false,
    configurable: true,
    writable: true,
  })
  return rowset
}

const assertPerfectPrototypeRowsetActive = (rowset, label = "rowset") => {
  if (!rowset || typeof rowset !== "object") return
  if (rowset[PERFECT_PROTOTYPE_ROWSET_RELEASED] === true) {
    throw new Error(`Perfect prototype borrowed ${label} was used after release`)
  }
}

const buildPerfectPrototypeSparseRowset = (values, { ownership, lease = null } = {}) =>
  attachPerfectPrototypeRowsetOwnership(
    {
      mode: PERFECT_PROTOTYPE_ROWSET_SPARSE,
      backend: PERFECT_PROTOTYPE_ROWSET_BACKEND_ARRAY_EXACT,
      count: values.length,
      values,
    },
    { ownership, lease },
  )

const buildPerfectPrototypeBitsetRowset = ({ words, count, universeSize, ownership, lease = null }) =>
  attachPerfectPrototypeRowsetOwnership(
    {
      mode: PERFECT_PROTOTYPE_ROWSET_BITSET,
      backend: PERFECT_PROTOTYPE_ROWSET_BACKEND_BITMAP_EXACT,
      count,
      universeSize,
      words,
    },
    { ownership, lease },
  )

const toSortedUint32Array = (values) =>
  Uint32Array.from(
    (Array.isArray(values) || ArrayBuffer.isView(values) ? Array.from(values) : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0)
      .sort((left, right) => left - right),
  )

const popcount32 = (value) => {
  let current = Number(value >>> 0)
  let count = 0
  while (current !== 0) {
    current &= current - 1
    count += 1
  }
  return count
}

const bitIsSet = (words, value) => {
  const wordIndex = value >>> 5
  const bitOffset = value & 31
  return ((words[wordIndex] >>> bitOffset) & 1) === 1
}

const findFirstBitsetValue = (words) => {
  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    const word = words[wordIndex] >>> 0
    if (word === 0) continue
    const lowestBit = word & -word
    const bitIndex = 31 - Math.clz32(lowestBit >>> 0)
    return wordIndex * 32 + bitIndex
  }
  return -1
}

const findLastBitsetValue = (words) => {
  for (let wordIndex = words.length - 1; wordIndex >= 0; wordIndex -= 1) {
    const word = words[wordIndex] >>> 0
    if (word === 0) continue
    const bitIndex = 31 - Math.clz32(word)
    return wordIndex * 32 + bitIndex
  }
  return -1
}

const normalizePerfectPrototypeUniverseSize = (universeSize) =>
  Math.max(0, Math.floor(Number(universeSize) || 0))

const getPerfectPrototypeBitsetRequiredWordCount = (universeSize) =>
  Math.ceil(normalizePerfectPrototypeUniverseSize(universeSize) / 32)

const getPerfectPrototypeBitsetLastWordMask = (universeSize) => {
  const safeUniverseSize = normalizePerfectPrototypeUniverseSize(universeSize)
  if (safeUniverseSize < 1) return 0
  const trailingBits = safeUniverseSize & 31
  return trailingBits === 0 ? 0xffffffff : ((1 << trailingBits) - 1) >>> 0
}

const assertPerfectPrototypeBitsetWordsContract = ({
  words,
  count,
  universeSize,
  label = "Perfect prototype bitset rowset",
}) => {
  const safeUniverseSize = normalizePerfectPrototypeUniverseSize(universeSize)
  const requiredWordCount = getPerfectPrototypeBitsetRequiredWordCount(safeUniverseSize)
  const safeCount = Math.max(0, Math.floor(Number(count) || 0))
  if (words.length !== requiredWordCount) {
    throw new Error(
      `${label} words length mismatch: actual=${words.length} expected=${requiredWordCount} universeSize=${safeUniverseSize}`,
    )
  }
  if (safeCount > safeUniverseSize) {
    throw new Error(
      `${label} count exceeds universe: count=${safeCount} universeSize=${safeUniverseSize}`,
    )
  }
  if (requiredWordCount < 1) return
  const lastWordIndex = requiredWordCount - 1
  const allowedMask = getPerfectPrototypeBitsetLastWordMask(safeUniverseSize)
  const trailingOverflowBits = (words[lastWordIndex] >>> 0) & ((~allowedMask) >>> 0)
  if (trailingOverflowBits !== 0) {
    throw new Error(
      `${label} last word exceeds universe: universeSize=${safeUniverseSize} overflowMask=${trailingOverflowBits}`,
    )
  }
}

const resolvePerfectPrototypeSparseBitsetDenseUniverseSize = ({ universeSize, bitsetRowset }) => {
  const bitsetUniverseSize = normalizePerfectPrototypeUniverseSize(bitsetRowset?.universeSize)
  if (bitsetUniverseSize < 1) {
    throw new Error("Perfect prototype dense sparse/bitset intersection requires bitset universeSize > 0")
  }
  if (universeSize == null) return bitsetUniverseSize
  const explicitUniverseSize = normalizePerfectPrototypeUniverseSize(universeSize)
  if (explicitUniverseSize !== bitsetUniverseSize) {
    throw new Error(
      `Perfect prototype dense sparse/bitset intersection requires explicit universeSize to equal the bitset universe: explicit=${explicitUniverseSize} expected=${bitsetUniverseSize}`,
    )
  }
  return explicitUniverseSize
}

const resolvePerfectPrototypeBitsetBitsetDenseUniverseSize = ({
  universeSize,
  leftRowset,
  rightRowset,
}) => {
  const safeUniverseSize = Math.min(
    normalizePerfectPrototypeUniverseSize(leftRowset?.universeSize),
    normalizePerfectPrototypeUniverseSize(rightRowset?.universeSize),
  )
  if (safeUniverseSize < 1) {
    throw new Error("Perfect prototype dense bitset/bitset intersection requires bitset universeSize > 0")
  }
  if (universeSize == null) return safeUniverseSize
  const explicitUniverseSize = normalizePerfectPrototypeUniverseSize(universeSize)
  if (explicitUniverseSize !== safeUniverseSize) {
    throw new Error(
      `Perfect prototype dense bitset/bitset intersection requires explicit universeSize to equal the canonical dense universe: explicit=${explicitUniverseSize} expected=${safeUniverseSize}`,
    )
  }
  return explicitUniverseSize
}

const buildBitsetWords = (sortedValues, universeSize) => {
  const safeUniverseSize = normalizePerfectPrototypeUniverseSize(universeSize)
  const words = new Uint32Array(getPerfectPrototypeBitsetRequiredWordCount(safeUniverseSize))
  for (const value of sortedValues) {
    if (value >= safeUniverseSize) {
      throw new Error(
        `Perfect prototype rowset value exceeds bitset universe: value=${value} universeSize=${safeUniverseSize}`,
      )
    }
    const wordIndex = value >>> 5
    const bitOffset = value & 31
    words[wordIndex] |= 1 << bitOffset
  }
  return words
}

export const shouldPreferDensePerfectPrototypeRowset = ({
  count,
  universeSize,
  allowDense = true,
}) => {
  if (allowDense !== true) return false
  const safeCount = Math.max(0, Math.floor(Number(count) || 0))
  const safeUniverseSize = Math.max(0, Math.floor(Number(universeSize) || 0))
  if (safeCount < 1 || safeUniverseSize < 256) return false
  return safeCount * 4 >= safeUniverseSize / 8
}

export const getPerfectPrototypeRowsetOwnership = (rowset) =>
  normalizeRowsetOwnership(rowset?.[PERFECT_PROTOTYPE_ROWSET_OWNERSHIP])

export const isPerfectPrototypeBorrowedRowset = (rowset) =>
  getPerfectPrototypeRowsetOwnership(rowset) === PERFECT_PROTOTYPE_ROWSET_BORROWED

export const createPerfectPrototypeSparseRowset = (values, { ownership = PERFECT_PROTOTYPE_ROWSET_OWNED, lease = null } = {}) => {
  const sortedValues =
    values instanceof Uint32Array ? values : toSortedUint32Array(values)
  return buildPerfectPrototypeSparseRowset(sortedValues, { ownership, lease })
}

export const createPerfectPrototypeBitsetRowset = ({
  values,
  universeSize,
  ownership = PERFECT_PROTOTYPE_ROWSET_OWNED,
  lease = null,
}) => {
  const sortedValues = values instanceof Uint32Array ? values : toSortedUint32Array(values)
  const safeUniverseSize = normalizePerfectPrototypeUniverseSize(universeSize)
  return buildPerfectPrototypeBitsetRowset({
    words: buildBitsetWords(sortedValues, safeUniverseSize),
    count: sortedValues.length,
    universeSize: safeUniverseSize,
    ownership,
    lease,
  })
}

export const createPerfectPrototypeBitsetRowsetFromWords = ({
  words,
  count,
  universeSize,
  ownership = PERFECT_PROTOTYPE_ROWSET_OWNED,
  lease = null,
}) => {
  const safeUniverseSize = normalizePerfectPrototypeUniverseSize(universeSize)
  const nextWords = words instanceof Uint32Array ? words : new Uint32Array(words ?? [])
  const safeCount = Math.max(0, Math.floor(Number(count) || 0))
  assertPerfectPrototypeBitsetWordsContract({
    words: nextWords,
    count: safeCount,
    universeSize: safeUniverseSize,
  })
  return buildPerfectPrototypeBitsetRowset({
    words: nextWords,
    count: safeCount,
    universeSize: safeUniverseSize,
    ownership,
    lease,
  })
}

export const createPerfectPrototypeRowset = ({
  values,
  universeSize = null,
  allowDense = false,
  ownership = PERFECT_PROTOTYPE_ROWSET_OWNED,
  lease = null,
}) => {
  const sortedValues = values instanceof Uint32Array ? values : toSortedUint32Array(values)
  if (
    Number.isInteger(universeSize) &&
    shouldPreferDensePerfectPrototypeRowset({
        count: sortedValues.length,
        universeSize,
        allowDense,
      })
  ) {
    return createPerfectPrototypeBitsetRowset({ values: sortedValues, universeSize, ownership, lease })
  }
  return createPerfectPrototypeSparseRowset(sortedValues, { ownership, lease })
}

export const getPerfectPrototypeRowsetCount = (rowset) => {
  assertPerfectPrototypeRowsetActive(rowset, "rowset")
  return Math.max(0, Math.floor(Number(rowset?.count ?? 0) || 0))
}

export const clonePerfectPrototypeRowsetOwned = (rowset) => {
  assertPerfectPrototypeRowsetActive(rowset, "rowset")
  if (!rowset || typeof rowset !== "object") {
    return createPerfectPrototypeSparseRowset(new Uint32Array())
  }
  if (isPerfectPrototypeBorrowedRowset(rowset) !== true) {
    return rowset
  }
  rowsetFinalizeCount += 1
  if (rowset.mode === PERFECT_PROTOTYPE_ROWSET_BITSET) {
    return createPerfectPrototypeBitsetRowsetFromWords({
      words: rowset.words.slice(),
      count: rowset.count,
      universeSize: rowset.universeSize,
    })
  }
  return createPerfectPrototypeSparseRowset(rowset.values.slice())
}

export const releasePerfectPrototypeBorrowedRowset = (rowset) => {
  if (!rowset || typeof rowset !== "object") return false
  if (isPerfectPrototypeBorrowedRowset(rowset) !== true) return false
  assertPerfectPrototypeRowsetActive(rowset, "rowset")
  const lease = rowset[PERFECT_PROTOTYPE_ROWSET_LEASE] ?? null
  perfectPrototypeRowsetPool.releaseLease(lease)
  rowset[PERFECT_PROTOTYPE_ROWSET_RELEASED] = true
  rowset.count = 0
  if (rowset.mode === PERFECT_PROTOTYPE_ROWSET_BITSET) {
    rowset.words = new Uint32Array()
  } else {
    rowset.values = new Uint32Array()
  }
  return true
}

export const getPerfectPrototypeRowsetRuntimeStats = () => {
  const nativeRuntimeStats = getNativePerfectPrototypeRowsetRuntimeStats()
  return {
    ...perfectPrototypeRowsetPool.getStats(),
    rowsetOwnedAllocCount,
    rowsetFinalizeCount,
    sparseKernelMode: String(nativePerfectPrototypeRowsetKernelBuildInfo?.sparseKernelMode ?? "unknown"),
    sparseSparseIntersectionMs: Number(sparseSparseIntersectionMs.toFixed(3)),
    sparseBitmapIntersectionMs: Number(sparseBitmapIntersectionMs.toFixed(3)),
    sparseEqualSizeMergeCount: Number(nativeRuntimeStats?.sparseEqualSizeMergeCount ?? 0),
    sparseAdaptiveGallopCount: Number(nativeRuntimeStats?.sparseAdaptiveGallopCount ?? 0),
    sparseCountFastPathCount: Number(nativeRuntimeStats?.sparseCountFastPathCount ?? 0),
    sparseBitmapWordRunCount: Number(nativeRuntimeStats?.sparseBitmapWordRunCount ?? 0),
    sparseBitmapSkippedRunCount: Number(nativeRuntimeStats?.sparseBitmapSkippedRunCount ?? 0),
    sparseBitmapPartialRunCount: Number(nativeRuntimeStats?.sparseBitmapPartialRunCount ?? 0),
    sparseBitmapFullRunHitCount: Number(nativeRuntimeStats?.sparseBitmapFullRunHitCount ?? 0),
    bitmapKernelMode: String(nativePerfectPrototypeRowsetKernelBuildInfo?.kernelMode ?? "unknown"),
    bitmapDenseDenseCount,
    bitmapIntersectionMs: Number(bitmapIntersectionMs.toFixed(3)),
    bitmapMaterializeMs: Number(bitmapMaterializeMs.toFixed(3)),
    bitmapEdgeSummaryMs: Number(bitmapEdgeSummaryMs.toFixed(3)),
  }
}

export const resetPerfectPrototypeRowsetRuntimeStats = () => {
  perfectPrototypeRowsetPool.resetStats()
  resetNativePerfectPrototypeRowsetRuntimeStats()
  rowsetOwnedAllocCount = 0
  rowsetFinalizeCount = 0
  bitmapDenseDenseCount = 0
  sparseSparseIntersectionMs = 0
  sparseBitmapIntersectionMs = 0
  bitmapIntersectionMs = 0
  bitmapMaterializeMs = 0
  bitmapEdgeSummaryMs = 0
}

export const materializePerfectPrototypeRowsetValuesJsReference = (rowset) => {
  assertPerfectPrototypeRowsetActive(rowset, "rowset")
  if (!rowset || typeof rowset !== "object") return new Uint32Array()
  if (rowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE) {
    return rowset.values instanceof Uint32Array ? rowset.values : toSortedUint32Array(rowset.values)
  }
  if (rowset.mode !== PERFECT_PROTOTYPE_ROWSET_BITSET) {
    return new Uint32Array()
  }
  const count = getPerfectPrototypeRowsetCount(rowset)
  if (count < 1) return new Uint32Array()
  const values = new Uint32Array(count)
  let outIndex = 0
  for (let wordIndex = 0; wordIndex < rowset.words.length; wordIndex += 1) {
    let word = rowset.words[wordIndex] >>> 0
    while (word !== 0) {
      const lowestBit = word & -word
      const bitIndex = 31 - Math.clz32(lowestBit >>> 0)
      values[outIndex] = wordIndex * 32 + bitIndex
      outIndex += 1
      word ^= lowestBit
    }
  }
  if (outIndex !== count) {
    throw new Error(
      `Perfect prototype rowset bitset materialization count mismatch: expected=${count} actual=${outIndex}`,
    )
  }
  return values
}

export const materializePerfectPrototypeRowsetValues = (rowset) => {
  assertPerfectPrototypeRowsetActive(rowset, "rowset")
  if (!rowset || typeof rowset !== "object") return new Uint32Array()
  if (rowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE) {
    return materializePerfectPrototypeRowsetValuesJsReference(rowset)
  }
  const count = getPerfectPrototypeRowsetCount(rowset)
  if (count < 1) return new Uint32Array()
  const startedAtMs = nowMs()
  const values = nativePerfectPrototypeRowsetKernel.bitmapMaterializeValues(rowset.words, count)
  bitmapMaterializeMs += nowMs() - startedAtMs
  return values
}

export const summarizePerfectPrototypeRowsetEdges = (rowset) => {
  assertPerfectPrototypeRowsetActive(rowset, "rowset")
  if (rowset && typeof rowset === "object" && rowset[PERFECT_PROTOTYPE_ROWSET_EDGES]) {
    return rowset[PERFECT_PROTOTYPE_ROWSET_EDGES]
  }
  const count = getPerfectPrototypeRowsetCount(rowset)
  const summary =
    rowset?.mode === PERFECT_PROTOTYPE_ROWSET_BITSET
      ? (() => {
          const startedAtMs = nowMs()
          const edgeSummary = nativePerfectPrototypeRowsetKernel.bitmapEdgeSummary(
            rowset.words ?? new Uint32Array(),
          )
          bitmapEdgeSummaryMs += nowMs() - startedAtMs
          return {
            count,
            firstValue: count > 0 ? Number(edgeSummary?.firstValue ?? -1) : -1,
            lastValue: count > 0 ? Number(edgeSummary?.lastValue ?? -1) : -1,
            mode: PERFECT_PROTOTYPE_ROWSET_BITSET,
            universeSize: Math.max(0, Math.floor(Number(rowset?.universeSize ?? 0) || 0)),
          }
        })()
      : {
          count,
          firstValue: count > 0 ? Number(rowset?.values?.[0] ?? -1) : -1,
          lastValue: count > 0 ? Number(rowset?.values?.[count - 1] ?? -1) : -1,
          mode: PERFECT_PROTOTYPE_ROWSET_SPARSE,
          universeSize: null,
        }
  if (rowset && typeof rowset === "object") {
    Object.defineProperty(rowset, PERFECT_PROTOTYPE_ROWSET_EDGES, {
      value: summary,
      configurable: true,
    })
  }
  return summary
}

export const fingerprintPerfectPrototypeRowset = (rowset) => {
  assertPerfectPrototypeRowsetActive(rowset, "rowset")
  if (rowset && typeof rowset === "object" && typeof rowset[PERFECT_PROTOTYPE_ROWSET_FINGERPRINT] === "string") {
    return rowset[PERFECT_PROTOTYPE_ROWSET_FINGERPRINT]
  }
  const summary = summarizePerfectPrototypeRowsetEdges(rowset)
  const fingerprint = [
    summary.mode,
    summary.count,
    summary.firstValue,
    summary.lastValue,
    summary.universeSize ?? "",
  ].join(":")
  if (rowset && typeof rowset === "object") {
    Object.defineProperty(rowset, PERFECT_PROTOTYPE_ROWSET_FINGERPRINT, {
      value: fingerprint,
      configurable: true,
    })
  }
  return fingerprint
}

export const iteratePerfectPrototypeRowsetValues = (rowset, visitor) => {
  if (typeof visitor !== "function") return
  assertPerfectPrototypeRowsetActive(rowset, "rowset")
  if (!rowset || typeof rowset !== "object") return
  if (rowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE) {
    const values = materializePerfectPrototypeRowsetValues(rowset)
    for (let index = 0; index < values.length; index += 1) {
      visitor(values[index])
    }
    return
  }
  const values = materializePerfectPrototypeRowsetValues(rowset)
  for (let index = 0; index < values.length; index += 1) {
    visitor(values[index])
  }
}

const countSparseSparseIntersectionJsReference = (leftValues, rightValues) => {
  let leftIndex = 0
  let rightIndex = 0
  let count = 0
  while (leftIndex < leftValues.length && rightIndex < rightValues.length) {
    const leftValue = leftValues[leftIndex]
    const rightValue = rightValues[rightIndex]
    if (leftValue === rightValue) {
      count += 1
      leftIndex += 1
      rightIndex += 1
      continue
    }
    if (leftValue < rightValue) {
      leftIndex += 1
    } else {
      rightIndex += 1
    }
  }
  return count
}

const countSparseBitsetIntersectionJsReference = (sparseValues, bitsetRowset) => {
  let count = 0
  for (let index = 0; index < sparseValues.length; index += 1) {
    if (bitIsSet(bitsetRowset.words, sparseValues[index])) {
      count += 1
    }
  }
  return count
}

const countBitsetBitsetIntersectionJsReference = (leftWords, rightWords) => {
  const limit = Math.min(leftWords.length, rightWords.length)
  let count = 0
  for (let index = 0; index < limit; index += 1) {
    count += popcount32((leftWords[index] & rightWords[index]) >>> 0)
  }
  return count
}

export const intersectPerfectPrototypeRowsetsCountJsReference = (leftRowset, rightRowset) => {
  if (!leftRowset || !rightRowset) return 0
  const leftCount = getPerfectPrototypeRowsetCount(leftRowset)
  const rightCount = getPerfectPrototypeRowsetCount(rightRowset)
  if (leftCount < 1 || rightCount < 1) return 0
  if (leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE && rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE) {
    return countSparseSparseIntersectionJsReference(leftRowset.values, rightRowset.values)
  }
  if (leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE && rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_BITSET) {
    return countSparseBitsetIntersectionJsReference(leftRowset.values, rightRowset)
  }
  if (leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_BITSET && rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE) {
    return countSparseBitsetIntersectionJsReference(rightRowset.values, leftRowset)
  }
  return countBitsetBitsetIntersectionJsReference(leftRowset.words, rightRowset.words)
}

export const intersectPerfectPrototypeRowsetsCount = (leftRowset, rightRowset) => {
  assertPerfectPrototypeRowsetActive(leftRowset, "leftRowset")
  assertPerfectPrototypeRowsetActive(rightRowset, "rightRowset")
  if (!leftRowset || !rightRowset) return 0
  const leftCount = getPerfectPrototypeRowsetCount(leftRowset)
  const rightCount = getPerfectPrototypeRowsetCount(rightRowset)
  if (leftCount < 1 || rightCount < 1) return 0
  if (leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE && rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE) {
    const startedAtMs = nowMs()
    const count = Number(
      nativePerfectPrototypeRowsetKernel.sparseSparseIntersectionCount(
        leftRowset.values,
        rightRowset.values,
      ),
    )
    sparseSparseIntersectionMs += nowMs() - startedAtMs
    return count
  }
  if (leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE && rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_BITSET) {
    const startedAtMs = nowMs()
    const count = Number(
      nativePerfectPrototypeRowsetKernel.sparseBitmapIntersectionCount(
        leftRowset.values,
        rightRowset.words,
      ),
    )
    sparseBitmapIntersectionMs += nowMs() - startedAtMs
    return count
  }
  if (leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_BITSET && rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE) {
    const startedAtMs = nowMs()
    const count = Number(
      nativePerfectPrototypeRowsetKernel.sparseBitmapIntersectionCount(
        rightRowset.values,
        leftRowset.words,
      ),
    )
    sparseBitmapIntersectionMs += nowMs() - startedAtMs
    return count
  }
  bitmapDenseDenseCount += 1
  const startedAtMs = nowMs()
  const count = Number(
    nativePerfectPrototypeRowsetKernel.bitmapBitmapIntersectionCount(
      leftRowset.words,
      rightRowset.words,
    ),
  )
  bitmapIntersectionMs += nowMs() - startedAtMs
  return count
}

export const intersectPerfectPrototypeRowsetsCountBatch = ({
  leftRowset,
  rightRowsets,
}) => {
  assertPerfectPrototypeRowsetActive(leftRowset, "leftRowset")
  const normalizedRightRowsets = Array.isArray(rightRowsets) ? rightRowsets : []
  const counts = new Uint32Array(normalizedRightRowsets.length)
  if (!leftRowset || normalizedRightRowsets.length < 1) return counts
  const leftCount = getPerfectPrototypeRowsetCount(leftRowset)
  if (leftCount < 1) return counts
  const sparseIndexes = []
  const sparsePayloads = []
  const bitsetIndexes = []
  const bitsetPayloads = []
  for (let index = 0; index < normalizedRightRowsets.length; index += 1) {
    const rightRowset = normalizedRightRowsets[index]
    assertPerfectPrototypeRowsetActive(rightRowset, `rightRowsets[${index}]`)
    if (!rightRowset || getPerfectPrototypeRowsetCount(rightRowset) < 1) continue
    if (rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE) {
      sparseIndexes.push(index)
      sparsePayloads.push(rightRowset.values)
      continue
    }
    bitsetIndexes.push(index)
    bitsetPayloads.push(rightRowset.words)
  }
  const assignBatchCounts = (indexes, batchCounts, label) => {
    if (batchCounts.length !== indexes.length) {
      throw new Error(
        `Perfect prototype native rowset batch count length mismatch: label=${label} expected=${indexes.length} actual=${batchCounts.length}`,
      )
    }
    for (let index = 0; index < indexes.length; index += 1) {
      counts[indexes[index]] = Number(batchCounts[index] ?? 0)
    }
  }
  if (leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE) {
    if (sparsePayloads.length > 0) {
      const startedAtMs = nowMs()
      const batchCounts = nativePerfectPrototypeRowsetKernel.sparseSparseIntersectionCountBatch(
        leftRowset.values,
        sparsePayloads,
      )
      sparseSparseIntersectionMs += nowMs() - startedAtMs
      assignBatchCounts(sparseIndexes, batchCounts, "sparse/sparse")
    }
    if (bitsetPayloads.length > 0) {
      const startedAtMs = nowMs()
      const batchCounts = nativePerfectPrototypeRowsetKernel.sparseBitmapIntersectionCountBatch(
        leftRowset.values,
        bitsetPayloads,
      )
      sparseBitmapIntersectionMs += nowMs() - startedAtMs
      assignBatchCounts(bitsetIndexes, batchCounts, "sparse/bitset")
    }
    return counts
  }
  if (sparsePayloads.length > 0) {
    const startedAtMs = nowMs()
    const batchCounts = nativePerfectPrototypeRowsetKernel.bitmapSparseIntersectionCountBatch(
      leftRowset.words,
      sparsePayloads,
    )
    sparseBitmapIntersectionMs += nowMs() - startedAtMs
    assignBatchCounts(sparseIndexes, batchCounts, "bitset/sparse")
  }
  if (bitsetPayloads.length > 0) {
    bitmapDenseDenseCount += bitsetPayloads.length
    const startedAtMs = nowMs()
    const batchCounts = nativePerfectPrototypeRowsetKernel.bitmapBitmapIntersectionCountBatch(
      leftRowset.words,
      bitsetPayloads,
    )
    bitmapIntersectionMs += nowMs() - startedAtMs
    assignBatchCounts(bitsetIndexes, batchCounts, "bitset/bitset")
  }
  return counts
}

export const intersectPerfectPrototypeRowsetsJsReference = ({
  leftRowset,
  rightRowset,
  countHint = null,
  universeSize = null,
  allowDense = false,
}) => {
  if (!leftRowset || !rightRowset) {
    return createPerfectPrototypeSparseRowset(new Uint32Array())
  }
  const count =
    Number.isInteger(countHint) && countHint >= 0
      ? countHint
      : intersectPerfectPrototypeRowsetsCountJsReference(leftRowset, rightRowset)
  if (count < 1) {
    return createPerfectPrototypeSparseRowset(new Uint32Array())
  }
  if (leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE && rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE) {
    const values = new Uint32Array(count)
    let outIndex = 0
    let leftIndex = 0
    let rightIndex = 0
    while (leftIndex < leftRowset.values.length && rightIndex < rightRowset.values.length) {
      const leftValue = leftRowset.values[leftIndex]
      const rightValue = rightRowset.values[rightIndex]
      if (leftValue === rightValue) {
        values[outIndex] = leftValue
        outIndex += 1
        leftIndex += 1
        rightIndex += 1
        continue
      }
      if (leftValue < rightValue) {
        leftIndex += 1
      } else {
        rightIndex += 1
      }
    }
    if (outIndex !== count) {
      throw new Error(
        `Perfect prototype sparse/sparse intersection count mismatch: expected=${count} actual=${outIndex}`,
      )
    }
    return createPerfectPrototypeRowset({ values, universeSize, allowDense })
  }
  const sparseRowset =
    leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE ? leftRowset : rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE ? rightRowset : null
  const bitsetRowset =
    leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_BITSET ? leftRowset : rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_BITSET ? rightRowset : null
  if (sparseRowset && bitsetRowset) {
    const resolvedUniverseSize = resolvePerfectPrototypeSparseBitsetDenseUniverseSize({
      universeSize,
      bitsetRowset,
    })
    if (
      shouldPreferDensePerfectPrototypeRowset({
        count,
        universeSize: resolvedUniverseSize,
        allowDense,
      })
    ) {
      const nextWords = new Uint32Array(getPerfectPrototypeBitsetRequiredWordCount(resolvedUniverseSize))
      let outIndex = 0
      for (let index = 0; index < sparseRowset.values.length; index += 1) {
        const value = sparseRowset.values[index]
        if (!bitIsSet(bitsetRowset.words, value)) continue
        const wordIndex = value >>> 5
        const bitOffset = value & 31
        nextWords[wordIndex] |= 1 << bitOffset
        outIndex += 1
      }
      if (outIndex !== count) {
        throw new Error(
          `Perfect prototype sparse/bitset dense intersection count mismatch: expected=${count} actual=${outIndex}`,
        )
      }
      return createPerfectPrototypeBitsetRowsetFromWords({
        words: nextWords,
        count,
        universeSize: resolvedUniverseSize,
      })
    }
    const values = new Uint32Array(count)
    let outIndex = 0
    for (let index = 0; index < sparseRowset.values.length; index += 1) {
      const value = sparseRowset.values[index]
      if (!bitIsSet(bitsetRowset.words, value)) continue
      values[outIndex] = value
      outIndex += 1
    }
    if (outIndex !== count) {
      throw new Error(
        `Perfect prototype sparse/bitset intersection count mismatch: expected=${count} actual=${outIndex}`,
      )
    }
    return createPerfectPrototypeRowset({
      values,
      universeSize: universeSize ?? bitsetRowset.universeSize ?? null,
      allowDense,
    })
  }
  const bitsetIntersectionUniverseSize = resolvePerfectPrototypeBitsetBitsetDenseUniverseSize({
    universeSize,
    leftRowset,
    rightRowset,
  })
  const shouldMaterializeDenseResult =
    Number.isInteger(bitsetIntersectionUniverseSize) &&
    shouldPreferDensePerfectPrototypeRowset({
      count,
      universeSize: bitsetIntersectionUniverseSize,
      allowDense,
    })
  let nextWords = null
  let outIndex = 0
  if (shouldMaterializeDenseResult) {
    nextWords = new Uint32Array(getPerfectPrototypeBitsetRequiredWordCount(bitsetIntersectionUniverseSize))
  }
  for (
    let wordIndex = 0;
    wordIndex < Math.min(leftRowset.words.length, rightRowset.words.length);
    wordIndex += 1
  ) {
    const word = (leftRowset.words[wordIndex] & rightRowset.words[wordIndex]) >>> 0
    if (nextWords) {
      nextWords[wordIndex] = word
    }
    outIndex += popcount32(word)
  }
  if (outIndex !== count) {
    throw new Error(
      `Perfect prototype bitset/bitset intersection count mismatch: expected=${count} actual=${outIndex}`,
    )
  }
  if (shouldMaterializeDenseResult) {
    return createPerfectPrototypeBitsetRowsetFromWords({
      words: nextWords,
      count,
      universeSize: bitsetIntersectionUniverseSize ?? null,
    })
  }
  const values = new Uint32Array(count)
  outIndex = 0
  for (
    let wordIndex = 0;
    wordIndex < Math.min(leftRowset.words.length, rightRowset.words.length);
    wordIndex += 1
  ) {
    let word = (leftRowset.words[wordIndex] & rightRowset.words[wordIndex]) >>> 0
    while (word !== 0) {
      const lowestBit = word & -word
      const bitIndex = 31 - Math.clz32(lowestBit >>> 0)
      values[outIndex] = wordIndex * 32 + bitIndex
      outIndex += 1
      word ^= lowestBit
    }
  }
  if (outIndex !== count) {
    throw new Error(
      `Perfect prototype bitset/bitset sparse materialization count mismatch: expected=${count} actual=${outIndex}`,
    )
  }
  return createPerfectPrototypeSparseRowset(values)
}

export const intersectPerfectPrototypeRowsets = ({
  leftRowset,
  rightRowset,
  countHint = null,
  universeSize = null,
  allowDense = false,
  resultOwnership = PERFECT_PROTOTYPE_ROWSET_OWNED,
}) => {
  assertPerfectPrototypeRowsetActive(leftRowset, "leftRowset")
  assertPerfectPrototypeRowsetActive(rightRowset, "rightRowset")
  if (!leftRowset || !rightRowset) {
    return createPerfectPrototypeSparseRowset(new Uint32Array())
  }
  const normalizedResultOwnership = normalizeRowsetOwnership(resultOwnership)
  const count =
    Number.isInteger(countHint) && countHint >= 0
      ? countHint
      : intersectPerfectPrototypeRowsetsCount(leftRowset, rightRowset)
  if (count < 1) {
    return createPerfectPrototypeSparseRowset(new Uint32Array())
  }
  if (leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE && rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE) {
    const startedAtMs = nowMs()
    if (normalizedResultOwnership === PERFECT_PROTOTYPE_ROWSET_BORROWED) {
      const lease = perfectPrototypeRowsetPool.borrowSparseValues(count)
      const actualCount = Number(
        nativePerfectPrototypeRowsetKernel.sparseSparseIntersectionFill(
          leftRowset.values,
          rightRowset.values,
          lease.buffer,
        ),
      )
      if (actualCount !== count) {
        throw new Error(
          `Perfect prototype native sparse/sparse borrowed intersection count mismatch: expected=${count} actual=${actualCount}`,
        )
      }
      sparseSparseIntersectionMs += nowMs() - startedAtMs
      return createPerfectPrototypeSparseRowset(lease.buffer, {
        ownership: PERFECT_PROTOTYPE_ROWSET_BORROWED,
        lease,
      })
    }
    const values = nativePerfectPrototypeRowsetKernel.sparseSparseIntersectionValues(
      leftRowset.values,
        rightRowset.values,
      )
    if (values.length !== count) {
      throw new Error(
        `Perfect prototype native sparse/sparse intersection count mismatch: expected=${count} actual=${values.length}`,
      )
    }
    sparseSparseIntersectionMs += nowMs() - startedAtMs
    return createPerfectPrototypeRowset({ values, universeSize, allowDense })
  }
  const sparseRowset =
    leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE
      ? leftRowset
      : rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE
        ? rightRowset
        : null
  const bitsetRowset =
    leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_BITSET
      ? leftRowset
      : rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_BITSET
        ? rightRowset
        : null
  if (sparseRowset && bitsetRowset) {
    const startedAtMs = nowMs()
    const resolvedUniverseSize = resolvePerfectPrototypeSparseBitsetDenseUniverseSize({
      universeSize,
      bitsetRowset,
    })
    if (
      shouldPreferDensePerfectPrototypeRowset({
        count,
        universeSize: resolvedUniverseSize,
        allowDense,
      })
    ) {
      if (normalizedResultOwnership === PERFECT_PROTOTYPE_ROWSET_BORROWED) {
        const lease = perfectPrototypeRowsetPool.borrowBitsetWords(Math.ceil(resolvedUniverseSize / 32))
        const actualCount = Number(
          nativePerfectPrototypeRowsetKernel.sparseBitmapIntersectionWordsFill(
            sparseRowset.values,
            bitsetRowset.words,
            lease.buffer,
            resolvedUniverseSize,
          ),
        )
        if (actualCount !== count) {
          throw new Error(
            `Perfect prototype native sparse/bitset borrowed dense intersection count mismatch: expected=${count} actual=${actualCount}`,
          )
        }
        sparseBitmapIntersectionMs += nowMs() - startedAtMs
        return createPerfectPrototypeBitsetRowsetFromWords({
          words: lease.buffer,
          count,
          universeSize: resolvedUniverseSize,
          ownership: PERFECT_PROTOTYPE_ROWSET_BORROWED,
          lease,
        })
      }
      const decoded = nativePerfectPrototypeRowsetKernel.sparseBitmapIntersectionWords(
        sparseRowset.values,
        bitsetRowset.words,
        resolvedUniverseSize,
      )
      if (Number(decoded?.count ?? -1) !== count) {
        throw new Error(
          `Perfect prototype native sparse/bitset dense intersection count mismatch: expected=${count} actual=${Number(decoded?.count ?? -1)}`,
        )
      }
      sparseBitmapIntersectionMs += nowMs() - startedAtMs
      return createPerfectPrototypeBitsetRowsetFromWords(decoded)
    }
    if (normalizedResultOwnership === PERFECT_PROTOTYPE_ROWSET_BORROWED) {
      const lease = perfectPrototypeRowsetPool.borrowSparseValues(count)
      const actualCount = Number(
        nativePerfectPrototypeRowsetKernel.sparseBitmapIntersectionValuesFill(
          sparseRowset.values,
          bitsetRowset.words,
          lease.buffer,
        ),
      )
      if (actualCount !== count) {
        const exactNativeCount = intersectPerfectPrototypeRowsetsCount(sparseRowset, bitsetRowset)
        const exactJsCount = intersectPerfectPrototypeRowsetsCountJsReference(
          sparseRowset,
          bitsetRowset,
        )
        throw new Error(
          `Perfect prototype native sparse/bitset borrowed intersection count mismatch: expected=${count} actual=${actualCount} nativeCount=${exactNativeCount} jsCount=${exactJsCount} sparseCount=${getPerfectPrototypeRowsetCount(sparseRowset)} bitsetCount=${getPerfectPrototypeRowsetCount(bitsetRowset)}`,
        )
      }
      sparseBitmapIntersectionMs += nowMs() - startedAtMs
      return createPerfectPrototypeSparseRowset(lease.buffer, {
        ownership: PERFECT_PROTOTYPE_ROWSET_BORROWED,
        lease,
      })
    }
    const values = nativePerfectPrototypeRowsetKernel.sparseBitmapIntersectionValues(
      sparseRowset.values,
      bitsetRowset.words,
    )
    if (values.length !== count) {
      throw new Error(
        `Perfect prototype native sparse/bitset intersection count mismatch: expected=${count} actual=${values.length}`,
      )
    }
    sparseBitmapIntersectionMs += nowMs() - startedAtMs
    return createPerfectPrototypeRowset({
      values,
      universeSize: universeSize ?? bitsetRowset.universeSize ?? null,
      allowDense,
    })
  }
  const bitsetIntersectionUniverseSize = resolvePerfectPrototypeBitsetBitsetDenseUniverseSize({
    universeSize,
    leftRowset,
    rightRowset,
  })
  const shouldMaterializeDenseResult =
    Number.isInteger(bitsetIntersectionUniverseSize) &&
    shouldPreferDensePerfectPrototypeRowset({
      count,
      universeSize: bitsetIntersectionUniverseSize,
      allowDense,
    })
  if (shouldMaterializeDenseResult) {
    if (normalizedResultOwnership === PERFECT_PROTOTYPE_ROWSET_BORROWED) {
      const lease = perfectPrototypeRowsetPool.borrowBitsetWords(
        getPerfectPrototypeBitsetRequiredWordCount(bitsetIntersectionUniverseSize),
      )
      bitmapDenseDenseCount += 1
      const startedAtMs = nowMs()
      const actualCount = Number(
        nativePerfectPrototypeRowsetKernel.bitmapBitmapIntersectionWordsFill(
          leftRowset.words,
          rightRowset.words,
          lease.buffer,
          bitsetIntersectionUniverseSize ?? 0,
        ),
      )
      bitmapIntersectionMs += nowMs() - startedAtMs
      if (actualCount !== count) {
        throw new Error(
          `Perfect prototype native bitset/bitset borrowed dense intersection count mismatch: expected=${count} actual=${actualCount}`,
        )
      }
      return createPerfectPrototypeBitsetRowsetFromWords({
        words: lease.buffer,
        count,
        universeSize: bitsetIntersectionUniverseSize ?? null,
        ownership: PERFECT_PROTOTYPE_ROWSET_BORROWED,
        lease,
      })
    }
    bitmapDenseDenseCount += 1
    const startedAtMs = nowMs()
    const decoded = nativePerfectPrototypeRowsetKernel.bitmapBitmapIntersectionWords(
      leftRowset.words,
      rightRowset.words,
      bitsetIntersectionUniverseSize ?? 0,
    )
    bitmapIntersectionMs += nowMs() - startedAtMs
    if (Number(decoded?.count ?? -1) !== count) {
      throw new Error(
        `Perfect prototype native bitset/bitset dense intersection count mismatch: expected=${count} actual=${Number(decoded?.count ?? -1)}`,
      )
    }
    return createPerfectPrototypeBitsetRowsetFromWords(decoded)
  }
  if (normalizedResultOwnership === PERFECT_PROTOTYPE_ROWSET_BORROWED) {
    const lease = perfectPrototypeRowsetPool.borrowSparseValues(count)
    bitmapDenseDenseCount += 1
    const startedAtMs = nowMs()
    const actualCount = Number(
      nativePerfectPrototypeRowsetKernel.bitmapBitmapIntersectionValuesFill(
        leftRowset.words,
        rightRowset.words,
        lease.buffer,
      ),
    )
    bitmapIntersectionMs += nowMs() - startedAtMs
    if (actualCount !== count) {
      throw new Error(
        `Perfect prototype native bitset/bitset borrowed sparse intersection count mismatch: expected=${count} actual=${actualCount}`,
      )
    }
    return createPerfectPrototypeSparseRowset(lease.buffer, {
      ownership: PERFECT_PROTOTYPE_ROWSET_BORROWED,
      lease,
    })
  }
  bitmapDenseDenseCount += 1
  const startedAtMs = nowMs()
  const values = nativePerfectPrototypeRowsetKernel.bitmapBitmapIntersectionValues(
    leftRowset.words,
    rightRowset.words,
  )
  bitmapIntersectionMs += nowMs() - startedAtMs
  if (values.length !== count) {
    throw new Error(
      `Perfect prototype native bitset/bitset sparse intersection count mismatch: expected=${count} actual=${values.length}`,
    )
  }
  return createPerfectPrototypeSparseRowset(values)
}

const createPreparedSparseIntersectionRowset = ({
  valuesBuffer,
  actualCount,
  ownership,
  lease = null,
}) => {
  if (actualCount < 1) {
    if (lease) {
      perfectPrototypeRowsetPool.releaseLease(lease)
    }
    return createPerfectPrototypeSparseRowset(new Uint32Array())
  }
  const values =
    ownership === PERFECT_PROTOTYPE_ROWSET_BORROWED
      ? valuesBuffer.subarray(0, actualCount)
      : actualCount === valuesBuffer.length
        ? valuesBuffer
        : valuesBuffer.slice(0, actualCount)
  return createPerfectPrototypeSparseRowset(values, {
    ownership,
    lease,
  })
}

export const intersectPerfectPrototypeRowsetsPrepared = ({
  leftRowset,
  rightRowset,
  universeSize = null,
  allowDense = false,
  resultOwnership = PERFECT_PROTOTYPE_ROWSET_OWNED,
}) => {
  assertPerfectPrototypeRowsetActive(leftRowset, "leftRowset")
  assertPerfectPrototypeRowsetActive(rightRowset, "rightRowset")
  if (!leftRowset || !rightRowset) {
    return {
      count: 0,
      rowset: createPerfectPrototypeSparseRowset(new Uint32Array()),
    }
  }
  const leftCount = getPerfectPrototypeRowsetCount(leftRowset)
  const rightCount = getPerfectPrototypeRowsetCount(rightRowset)
  if (leftCount < 1 || rightCount < 1) {
    return {
      count: 0,
      rowset: createPerfectPrototypeSparseRowset(new Uint32Array()),
    }
  }
  const normalizedResultOwnership = normalizeRowsetOwnership(resultOwnership)
  const sparseCapacity = Math.min(leftCount, rightCount)
  if (
    leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE &&
    rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE
  ) {
    const startedAtMs = nowMs()
    if (normalizedResultOwnership === PERFECT_PROTOTYPE_ROWSET_BORROWED) {
      const lease = perfectPrototypeRowsetPool.borrowSparseValues(sparseCapacity)
      const actualCount = Number(
        nativePerfectPrototypeRowsetKernel.sparseSparseIntersectionFill(
          leftRowset.values,
          rightRowset.values,
          lease.buffer,
        ),
      )
      sparseSparseIntersectionMs += nowMs() - startedAtMs
      return {
        count: actualCount,
        rowset: createPreparedSparseIntersectionRowset({
          valuesBuffer: lease.buffer,
          actualCount,
          ownership: PERFECT_PROTOTYPE_ROWSET_BORROWED,
          lease,
        }),
      }
    }
    const valuesBuffer = new Uint32Array(sparseCapacity)
    const actualCount = Number(
      nativePerfectPrototypeRowsetKernel.sparseSparseIntersectionFill(
        leftRowset.values,
        rightRowset.values,
        valuesBuffer,
      ),
    )
    sparseSparseIntersectionMs += nowMs() - startedAtMs
    return {
      count: actualCount,
      rowset: createPreparedSparseIntersectionRowset({
        valuesBuffer,
        actualCount,
        ownership: PERFECT_PROTOTYPE_ROWSET_OWNED,
      }),
    }
  }
  const sparseRowset =
    leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE
      ? leftRowset
      : rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE
        ? rightRowset
        : null
  const bitsetRowset =
    leftRowset.mode === PERFECT_PROTOTYPE_ROWSET_BITSET
      ? leftRowset
      : rightRowset.mode === PERFECT_PROTOTYPE_ROWSET_BITSET
        ? rightRowset
        : null
  if (sparseRowset && bitsetRowset) {
    const startedAtMs = nowMs()
    const resolvedUniverseSize = resolvePerfectPrototypeSparseBitsetDenseUniverseSize({
      universeSize,
      bitsetRowset,
    })
    const denseWordCount = getPerfectPrototypeBitsetRequiredWordCount(resolvedUniverseSize)
    const preferDense = shouldPreferDensePerfectPrototypeRowset({
      count: sparseCapacity,
      universeSize: resolvedUniverseSize,
      allowDense,
    })
    if (preferDense) {
      if (normalizedResultOwnership === PERFECT_PROTOTYPE_ROWSET_BORROWED) {
        const lease = perfectPrototypeRowsetPool.borrowBitsetWords(denseWordCount)
        const actualCount = Number(
          nativePerfectPrototypeRowsetKernel.sparseBitmapIntersectionWordsFill(
            sparseRowset.values,
            bitsetRowset.words,
            lease.buffer,
            resolvedUniverseSize,
          ),
        )
        sparseBitmapIntersectionMs += nowMs() - startedAtMs
        if (actualCount < 1) {
          perfectPrototypeRowsetPool.releaseLease(lease)
          return {
            count: 0,
            rowset: createPerfectPrototypeSparseRowset(new Uint32Array()),
          }
        }
        return {
          count: actualCount,
          rowset: createPerfectPrototypeBitsetRowsetFromWords({
            words: lease.buffer,
            count: actualCount,
            universeSize: resolvedUniverseSize,
            ownership: PERFECT_PROTOTYPE_ROWSET_BORROWED,
            lease,
          }),
        }
      }
      const words = new Uint32Array(denseWordCount)
      const actualCount = Number(
        nativePerfectPrototypeRowsetKernel.sparseBitmapIntersectionWordsFill(
          sparseRowset.values,
          bitsetRowset.words,
          words,
          resolvedUniverseSize,
        ),
      )
      sparseBitmapIntersectionMs += nowMs() - startedAtMs
      if (actualCount < 1) {
        return {
          count: 0,
          rowset: createPerfectPrototypeSparseRowset(new Uint32Array()),
        }
      }
      return {
        count: actualCount,
        rowset: createPerfectPrototypeBitsetRowsetFromWords({
          words,
          count: actualCount,
          universeSize: resolvedUniverseSize,
          ownership: PERFECT_PROTOTYPE_ROWSET_OWNED,
        }),
      }
    }
    if (normalizedResultOwnership === PERFECT_PROTOTYPE_ROWSET_BORROWED) {
      const lease = perfectPrototypeRowsetPool.borrowSparseValues(sparseCapacity)
      const actualCount = Number(
        nativePerfectPrototypeRowsetKernel.sparseBitmapIntersectionValuesFill(
          sparseRowset.values,
          bitsetRowset.words,
          lease.buffer,
        ),
      )
      sparseBitmapIntersectionMs += nowMs() - startedAtMs
      return {
        count: actualCount,
        rowset: createPreparedSparseIntersectionRowset({
          valuesBuffer: lease.buffer,
          actualCount,
          ownership: PERFECT_PROTOTYPE_ROWSET_BORROWED,
          lease,
        }),
      }
    }
    const valuesBuffer = new Uint32Array(sparseCapacity)
    const actualCount = Number(
      nativePerfectPrototypeRowsetKernel.sparseBitmapIntersectionValuesFill(
        sparseRowset.values,
        bitsetRowset.words,
        valuesBuffer,
      ),
    )
    sparseBitmapIntersectionMs += nowMs() - startedAtMs
    return {
      count: actualCount,
      rowset: createPreparedSparseIntersectionRowset({
        valuesBuffer,
        actualCount,
        ownership: PERFECT_PROTOTYPE_ROWSET_OWNED,
      }),
    }
  }
  const bitsetIntersectionUniverseSize = resolvePerfectPrototypeBitsetBitsetDenseUniverseSize({
    universeSize,
    leftRowset,
    rightRowset,
  })
  const denseWordCount = getPerfectPrototypeBitsetRequiredWordCount(
    bitsetIntersectionUniverseSize,
  )
  const preferDense = shouldPreferDensePerfectPrototypeRowset({
    count: sparseCapacity,
    universeSize: bitsetIntersectionUniverseSize,
    allowDense,
  })
  if (preferDense) {
    bitmapDenseDenseCount += 1
    const startedAtMs = nowMs()
    if (normalizedResultOwnership === PERFECT_PROTOTYPE_ROWSET_BORROWED) {
      const lease = perfectPrototypeRowsetPool.borrowBitsetWords(denseWordCount)
      const actualCount = Number(
        nativePerfectPrototypeRowsetKernel.bitmapBitmapIntersectionWordsFill(
          leftRowset.words,
          rightRowset.words,
          lease.buffer,
          bitsetIntersectionUniverseSize,
        ),
      )
      bitmapIntersectionMs += nowMs() - startedAtMs
      if (actualCount < 1) {
        perfectPrototypeRowsetPool.releaseLease(lease)
        return {
          count: 0,
          rowset: createPerfectPrototypeSparseRowset(new Uint32Array()),
        }
      }
      return {
        count: actualCount,
        rowset: createPerfectPrototypeBitsetRowsetFromWords({
          words: lease.buffer,
          count: actualCount,
          universeSize: bitsetIntersectionUniverseSize,
          ownership: PERFECT_PROTOTYPE_ROWSET_BORROWED,
          lease,
        }),
      }
    }
    const words = new Uint32Array(denseWordCount)
    const actualCount = Number(
      nativePerfectPrototypeRowsetKernel.bitmapBitmapIntersectionWordsFill(
        leftRowset.words,
        rightRowset.words,
        words,
        bitsetIntersectionUniverseSize,
      ),
    )
    bitmapIntersectionMs += nowMs() - startedAtMs
    if (actualCount < 1) {
      return {
        count: 0,
        rowset: createPerfectPrototypeSparseRowset(new Uint32Array()),
      }
    }
    return {
      count: actualCount,
      rowset: createPerfectPrototypeBitsetRowsetFromWords({
        words,
        count: actualCount,
        universeSize: bitsetIntersectionUniverseSize,
        ownership: PERFECT_PROTOTYPE_ROWSET_OWNED,
      }),
    }
  }
  bitmapDenseDenseCount += 1
  const startedAtMs = nowMs()
  if (normalizedResultOwnership === PERFECT_PROTOTYPE_ROWSET_BORROWED) {
    const lease = perfectPrototypeRowsetPool.borrowSparseValues(sparseCapacity)
    const actualCount = Number(
      nativePerfectPrototypeRowsetKernel.bitmapBitmapIntersectionValuesFill(
        leftRowset.words,
        rightRowset.words,
        lease.buffer,
      ),
    )
    bitmapIntersectionMs += nowMs() - startedAtMs
    return {
      count: actualCount,
      rowset: createPreparedSparseIntersectionRowset({
        valuesBuffer: lease.buffer,
        actualCount,
        ownership: PERFECT_PROTOTYPE_ROWSET_BORROWED,
        lease,
      }),
    }
  }
  const valuesBuffer = new Uint32Array(sparseCapacity)
  const actualCount = Number(
    nativePerfectPrototypeRowsetKernel.bitmapBitmapIntersectionValuesFill(
      leftRowset.words,
      rightRowset.words,
      valuesBuffer,
    ),
  )
  bitmapIntersectionMs += nowMs() - startedAtMs
  return {
    count: actualCount,
    rowset: createPreparedSparseIntersectionRowset({
      valuesBuffer,
      actualCount,
      ownership: PERFECT_PROTOTYPE_ROWSET_OWNED,
    }),
  }
}

export const arePerfectPrototypeRowsetsEqualJsReference = (leftRowset, rightRowset) => {
  assertPerfectPrototypeRowsetActive(leftRowset, "leftRowset")
  assertPerfectPrototypeRowsetActive(rightRowset, "rightRowset")
  const leftCount = getPerfectPrototypeRowsetCount(leftRowset)
  const rightCount = getPerfectPrototypeRowsetCount(rightRowset)
  if (leftCount !== rightCount) return false
  if (leftCount < 1) return true
  if (
    leftRowset?.mode === PERFECT_PROTOTYPE_ROWSET_BITSET &&
    rightRowset?.mode === PERFECT_PROTOTYPE_ROWSET_BITSET
  ) {
    const leftWords = leftRowset.words ?? new Uint32Array()
    const rightWords = rightRowset.words ?? new Uint32Array()
    const limit = Math.max(leftWords.length, rightWords.length)
    for (let index = 0; index < limit; index += 1) {
      if ((leftWords[index] ?? 0) !== (rightWords[index] ?? 0)) return false
    }
    return true
  }
  return intersectPerfectPrototypeRowsetsCountJsReference(leftRowset, rightRowset) === leftCount
}

export const arePerfectPrototypeRowsetsEqual = (leftRowset, rightRowset) => {
  assertPerfectPrototypeRowsetActive(leftRowset, "leftRowset")
  assertPerfectPrototypeRowsetActive(rightRowset, "rightRowset")
  const leftCount = getPerfectPrototypeRowsetCount(leftRowset)
  const rightCount = getPerfectPrototypeRowsetCount(rightRowset)
  if (leftCount !== rightCount) return false
  if (leftCount < 1) return true
  if (
    leftRowset?.mode === PERFECT_PROTOTYPE_ROWSET_BITSET &&
    rightRowset?.mode === PERFECT_PROTOTYPE_ROWSET_BITSET
  ) {
    return Boolean(nativePerfectPrototypeRowsetKernel.bitmapEquals(leftRowset.words, rightRowset.words))
  }
  if (
    leftRowset?.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE &&
    rightRowset?.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE
  ) {
    return Boolean(nativePerfectPrototypeRowsetKernel.sparseSparseEquals(leftRowset.values, rightRowset.values))
  }
  return intersectPerfectPrototypeRowsetsCount(leftRowset, rightRowset) === leftCount
}

export const isPerfectPrototypeRowsetSubsetJsReference = (subsetRowset, supersetRowset) => {
  assertPerfectPrototypeRowsetActive(subsetRowset, "subsetRowset")
  assertPerfectPrototypeRowsetActive(supersetRowset, "supersetRowset")
  const subsetCount = getPerfectPrototypeRowsetCount(subsetRowset)
  const supersetCount = getPerfectPrototypeRowsetCount(supersetRowset)
  if (subsetCount > supersetCount) return false
  if (subsetCount < 1) return true
  if (
    subsetRowset?.mode === PERFECT_PROTOTYPE_ROWSET_BITSET &&
    supersetRowset?.mode === PERFECT_PROTOTYPE_ROWSET_BITSET
  ) {
    const subsetWords = subsetRowset.words ?? new Uint32Array()
    const supersetWords = supersetRowset.words ?? new Uint32Array()
    const limit = Math.max(subsetWords.length, supersetWords.length)
    for (let index = 0; index < limit; index += 1) {
      const subsetWord = subsetWords[index] ?? 0
      const supersetWord = supersetWords[index] ?? 0
      if ((subsetWord & ~supersetWord) !== 0) return false
    }
    return true
  }
  return intersectPerfectPrototypeRowsetsCountJsReference(subsetRowset, supersetRowset) === subsetCount
}

export const isPerfectPrototypeRowsetSubset = (subsetRowset, supersetRowset) => {
  assertPerfectPrototypeRowsetActive(subsetRowset, "subsetRowset")
  assertPerfectPrototypeRowsetActive(supersetRowset, "supersetRowset")
  const subsetCount = getPerfectPrototypeRowsetCount(subsetRowset)
  const supersetCount = getPerfectPrototypeRowsetCount(supersetRowset)
  if (subsetCount > supersetCount) return false
  if (subsetCount < 1) return true
  if (
    subsetRowset?.mode === PERFECT_PROTOTYPE_ROWSET_BITSET &&
    supersetRowset?.mode === PERFECT_PROTOTYPE_ROWSET_BITSET
  ) {
    return Boolean(nativePerfectPrototypeRowsetKernel.bitmapSubset(subsetRowset.words, supersetRowset.words))
  }
  if (
    subsetRowset?.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE &&
    supersetRowset?.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE
  ) {
    return Boolean(
      nativePerfectPrototypeRowsetKernel.sparseSparseSubset(
        subsetRowset.values,
        supersetRowset.values,
      ),
    )
  }
  if (
    subsetRowset?.mode === PERFECT_PROTOTYPE_ROWSET_SPARSE &&
    supersetRowset?.mode === PERFECT_PROTOTYPE_ROWSET_BITSET
  ) {
    return Boolean(
      nativePerfectPrototypeRowsetKernel.sparseBitmapSubset(
        subsetRowset.values,
        supersetRowset.words,
      ),
    )
  }
  return intersectPerfectPrototypeRowsetsCount(subsetRowset, supersetRowset) === subsetCount
}

export const hashPerfectPrototypeRowset = (rowset) => {
  assertPerfectPrototypeRowsetActive(rowset, "rowset")
  if (rowset && typeof rowset === "object" && typeof rowset[PERFECT_PROTOTYPE_ROWSET_HASH] === "string") {
    return rowset[PERFECT_PROTOTYPE_ROWSET_HASH]
  }
  const hash = crypto.createHash("sha1")
  if (rowset?.mode === PERFECT_PROTOTYPE_ROWSET_BITSET) {
    const words = rowset.words instanceof Uint32Array ? rowset.words : new Uint32Array()
    hash.update(Buffer.from(words.buffer, words.byteOffset, words.byteLength))
    const digest = hash.digest("hex")
    if (rowset && typeof rowset === "object") {
      Object.defineProperty(rowset, PERFECT_PROTOTYPE_ROWSET_HASH, {
        value: digest,
        configurable: true,
      })
    }
    return digest
  }
  const values =
    rowset?.values instanceof Uint32Array
      ? rowset.values
      : materializePerfectPrototypeRowsetValues(rowset)
  const buffer = Buffer.from(values.buffer, values.byteOffset, values.byteLength)
  hash.update(buffer)
  const digest = hash.digest("hex")
  if (rowset && typeof rowset === "object") {
    Object.defineProperty(rowset, PERFECT_PROTOTYPE_ROWSET_HASH, {
      value: digest,
      configurable: true,
    })
  }
  return digest
}

export const summarizePerfectPrototypeRowsetMode = (rowset) => {
  assertPerfectPrototypeRowsetActive(rowset, "rowset")
  return rowset?.mode === PERFECT_PROTOTYPE_ROWSET_BITSET
    ? PERFECT_PROTOTYPE_ROWSET_BITSET
    : PERFECT_PROTOTYPE_ROWSET_SPARSE
}

export const estimatePerfectPrototypeRowsetBytes = (rowset) => {
  assertPerfectPrototypeRowsetActive(rowset, "rowset")
  if (!rowset || typeof rowset !== "object") return 0
  if (rowset.mode === PERFECT_PROTOTYPE_ROWSET_BITSET) {
    return Number(rowset.words?.byteLength ?? 0) + 64
  }
  return Number(rowset.values?.byteLength ?? 0) + 64
}
