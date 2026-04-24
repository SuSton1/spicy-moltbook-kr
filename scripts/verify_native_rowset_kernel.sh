#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
KERNEL_PATH="$ROOT_DIR/native/perfect_prototype_rowset_kernel/build/Release/perfect_prototype_rowset_kernel.node"
MANIFEST_PATH="$ROOT_DIR/native/perfect_prototype_rowset_kernel/build/Release/perfect_prototype_rowset_kernel.build.json"

bash "$ROOT_DIR/scripts/build_native_rowset_kernel.sh"

node --input-type=module <<'EOF'
import crypto from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import {
  encodePerfectPrototypeDeltaPostings,
  mergePerfectPrototypeShiftedDeltaPostingFileRefsJsReference,
  mergePerfectPrototypeShiftedDeltaPostingRefsJsReference,
  openPerfectPrototypePostingsFile,
} from "./src/lib/perfect_prototype_postings_codec.mjs"
import {
  arePerfectPrototypeRowsetsEqualJsReference,
  createPerfectPrototypeBitsetRowset,
  createPerfectPrototypeBitsetRowsetFromWords,
  createPerfectPrototypeSparseRowset,
  intersectPerfectPrototypeRowsetsCountJsReference,
  intersectPerfectPrototypeRowsetsJsReference,
  isPerfectPrototypeRowsetSubsetJsReference,
  materializePerfectPrototypeRowsetValuesJsReference,
} from "./src/lib/perfect_prototype_rowset.mjs"

const require = createRequire(import.meta.url)
const kernelPath = path.resolve(process.cwd(), "native/perfect_prototype_rowset_kernel/build/Release/perfect_prototype_rowset_kernel.node")
const manifestPath = path.resolve(process.cwd(), "native/perfect_prototype_rowset_kernel/build/Release/perfect_prototype_rowset_kernel.build.json")
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const addon = require(kernelPath)
const expected = [
  "bitmapEdgeSummary",
  "bitmapBitmapIntersectionCount",
  "bitmapBitmapIntersectionCountBatch",
  "bitmapBitmapIntersectionValuesFill",
  "bitmapBitmapIntersectionValues",
  "bitmapBitmapIntersectionWordsFill",
  "bitmapBitmapIntersectionWords",
  "bitmapEquals",
  "bitmapMaterializeValues",
  "bitmapSparseIntersectionCountBatch",
  "bitmapSubset",
  "decodeDeltaToArray",
  "decodeDeltaToBitmap",
  "getBuildInfo",
  "getRuntimeStats",
  "mergeShiftedDeltaRefs",
  "mergeShiftedDeltaRefsFromFiles",
  "resetRuntimeStats",
  "spliceShiftedDeltaRefsToFile",
  "sparseBitmapIntersectionCount",
  "sparseBitmapIntersectionCountBatch",
  "sparseBitmapIntersectionValuesFill",
  "sparseBitmapIntersectionValues",
  "sparseBitmapIntersectionWordsFill",
  "sparseBitmapIntersectionWords",
  "sparseBitmapSubset",
  "sparseSparseEquals",
  "sparseSparseIntersectionCount",
  "sparseSparseIntersectionCountBatch",
  "sparseSparseIntersectionFill",
  "sparseSparseIntersectionValues",
  "sparseSparseSubset",
]
for (const key of expected) {
  if (typeof addon?.[key] !== "function") {
    throw new Error(`Missing native rowset kernel export: ${key}`)
  }
}
const buildInfo = addon.getBuildInfo()
if (!buildInfo || typeof buildInfo !== "object") {
  throw new Error("Missing native rowset kernel build info")
}
if (String(buildInfo.platform ?? "") !== String(manifest.platform ?? "")) {
  throw new Error(`Native rowset kernel platform mismatch: manifest=${manifest.platform} addon=${buildInfo.platform}`)
}
if (String(buildInfo.arch ?? "") !== String(manifest.arch ?? "")) {
  throw new Error(`Native rowset kernel arch mismatch: manifest=${manifest.arch} addon=${buildInfo.arch}`)
}
if (String(buildInfo.napiVersion ?? "") !== String(manifest.nodeApiVersion ?? "")) {
  throw new Error(
    `Native rowset kernel N-API mismatch: manifest=${manifest.nodeApiVersion} addon=${buildInfo.napiVersion}`,
  )
}
if (manifest.simdRequired !== true || buildInfo.simdRequired !== true) {
  throw new Error("Native rowset kernel SIMD contract must remain required")
}
if (String(manifest.simdKernelMode ?? "") !== "avx2_exact_bitset") {
  throw new Error(`Native rowset kernel manifest simdKernelMode mismatch: ${String(manifest.simdKernelMode ?? "")}`)
}
if (String(manifest.sparseKernelMode ?? "") !== "adaptive_exact_v4") {
  throw new Error(
    `Native rowset kernel manifest sparseKernelMode mismatch: ${String(manifest.sparseKernelMode ?? "")}`,
  )
}
if (String(buildInfo.kernelMode ?? "") !== "avx2_exact_bitset") {
  throw new Error(`Native rowset kernel buildInfo.kernelMode mismatch: ${String(buildInfo.kernelMode ?? "")}`)
}
if (String(buildInfo.sparseKernelMode ?? "") !== "adaptive_exact_v4") {
  throw new Error(
    `Native rowset kernel buildInfo.sparseKernelMode mismatch: ${String(buildInfo.sparseKernelMode ?? "")}`,
  )
}
if (Number(buildInfo.vectorWidthBits ?? 0) !== 256) {
  throw new Error(`Native rowset kernel vectorWidthBits mismatch: ${String(buildInfo.vectorWidthBits ?? "")}`)
}
for (const feature of ["avx2", "popcnt"]) {
  if (!Array.isArray(manifest.requiredCpuFeatures) || !manifest.requiredCpuFeatures.includes(feature)) {
    throw new Error(`Native rowset kernel manifest missing required CPU feature: ${feature}`)
  }
  if (!Array.isArray(buildInfo.requiredCpuFeatures) || !buildInfo.requiredCpuFeatures.includes(feature)) {
    throw new Error(`Native rowset kernel build info missing required CPU feature: ${feature}`)
  }
}
const outputSha256 = crypto.createHash("sha256").update(fs.readFileSync(kernelPath)).digest("hex")
if (outputSha256 !== String(manifest.outputSha256 ?? "")) {
  throw new Error("Native rowset kernel binary hash mismatch against build manifest")
}

const assertThrowsMatch = (fn, pattern, label) => {
  let thrown = null
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  if (!(thrown instanceof Error)) {
    throw new Error(`${label} did not throw`)
  }
  if (!pattern.test(String(thrown.message ?? thrown))) {
    throw new Error(`${label} threw unexpected error: ${String(thrown.message ?? thrown)}`)
  }
}
const shiftedRefs = [
  {
    buffer: encodePerfectPrototypeDeltaPostings([2, 130, 20000]),
    rowOffset: 0,
    count: 3,
  },
  {
    buffer: encodePerfectPrototypeDeltaPostings([3, 140, 1000]),
    rowOffset: 70000,
    count: 3,
  },
  {
    buffer: Buffer.alloc(0),
    rowOffset: 90000,
    count: 0,
  },
]
const shifted = addon.mergeShiftedDeltaRefs(
  shiftedRefs.map((entry) => entry.buffer),
  new Uint32Array(shiftedRefs.map((entry) => entry.rowOffset)),
  new Uint32Array(shiftedRefs.map((entry) => entry.count)),
)
const shiftedReference = mergePerfectPrototypeShiftedDeltaPostingRefsJsReference({
  refs: shiftedRefs,
})
if (
  !Buffer.isBuffer(shifted?.buffer) ||
  !Buffer.isBuffer(shiftedReference?.buffer) ||
  Number(shifted?.count ?? 0) !== Number(shiftedReference?.count ?? 0) ||
  Number(shifted?.firstRowIdx ?? -1) !== Number(shiftedReference?.firstRowIdx ?? -1) ||
  Number(shifted?.lastRowIdx ?? -1) !== Number(shiftedReference?.lastRowIdx ?? -1) ||
  Buffer.compare(shifted.buffer, shiftedReference.buffer) !== 0
) {
  throw new Error("Native shifted-delta merge probe returned invalid metadata")
}
let malformedThrown = false
try {
  addon.mergeShiftedDeltaRefs(
    [Buffer.from([0x80])],
    new Uint32Array([0]),
    new Uint32Array([1]),
  )
} catch (error) {
  malformedThrown = true
}
if (!malformedThrown) {
  throw new Error("Native shifted-delta merge probe failed to reject malformed varint input")
}
const sparseLeft = new Uint32Array([1, 5, 7, 10, 40])
const sparseRight = new Uint32Array([0, 5, 7, 33, 40])
addon.resetRuntimeStats()
const sparseFillOut = new Uint32Array([0, 0, 0])
const sparseFillCount = addon.sparseSparseIntersectionFill(sparseLeft, sparseRight, sparseFillOut)
if (Number(sparseFillCount ?? -1) !== 3 || Array.from(sparseFillOut).join(",") !== "5,7,40") {
  throw new Error("Native sparse/sparse fill probe returned invalid output")
}
const nearSizeSparseLeft = new Uint32Array([3, 7, 12, 18, 24, 31, 39, 48, 58, 69])
const nearSizeSparseRight = new Uint32Array([1, 7, 11, 18, 21, 31, 37, 48, 50, 69, 72])
const nearSizeSparseReferenceValues = Array.from(
  materializePerfectPrototypeRowsetValuesJsReference(
    intersectPerfectPrototypeRowsetsJsReference({
      leftRowset: createPerfectPrototypeSparseRowset(nearSizeSparseLeft),
      rightRowset: createPerfectPrototypeSparseRowset(nearSizeSparseRight),
      allowDense: false,
    }),
  ),
)
const nearSizeSparseNativeCount = Number(
  addon.sparseSparseIntersectionCount(nearSizeSparseLeft, nearSizeSparseRight),
)
if (nearSizeSparseNativeCount !== nearSizeSparseReferenceValues.length) {
  throw new Error("Native sparse/sparse near-size count probe mismatched JS reference")
}
const nearSizeSparseBatchCounts = Array.from(
  addon.sparseSparseIntersectionCountBatch(nearSizeSparseLeft, [
    nearSizeSparseRight,
    new Uint32Array([3, 12, 24, 69]),
  ]),
)
if (nearSizeSparseBatchCounts.join(",") !== `${nearSizeSparseReferenceValues.length},4`) {
  throw new Error("Native sparse/sparse batch count probe returned invalid output")
}
const bitmapWords = new Uint32Array([0, 0, 0, 0])
bitmapWords[0] |= 1 << 5
bitmapWords[0] |= 1 << 7
bitmapWords[1] |= 1 << 8
const sparseBitmapFillOut = new Uint32Array([0, 0])
const sparseBitmapFillCount = addon.sparseBitmapIntersectionValuesFill(
  new Uint32Array([5, 6, 7]),
  bitmapWords,
  sparseBitmapFillOut,
)
if (Number(sparseBitmapFillCount ?? -1) !== 2 || Array.from(sparseBitmapFillOut).join(",") !== "5,7") {
  throw new Error("Native sparse/bitmap fill probe returned invalid output")
}
const sparseBitmapFullWords = new Uint32Array([0, 0, 0])
sparseBitmapFullWords[2] |= 1 << 0
sparseBitmapFullWords[2] |= 1 << 1
sparseBitmapFullWords[2] |= 1 << 2
sparseBitmapFullWords[2] |= 1 << 3
const sparseBitmapFullProbe = new Uint32Array([64, 65, 66, 67])
const sparseBitmapFullCount = Number(
  addon.sparseBitmapIntersectionCount(sparseBitmapFullProbe, sparseBitmapFullWords),
)
if (sparseBitmapFullCount !== 4) {
  throw new Error("Native sparse/bitmap full-run count probe returned invalid output")
}
const sparseBitmapBatchCounts = Array.from(
  addon.sparseBitmapIntersectionCountBatch(sparseBitmapFullProbe, [
    sparseBitmapFullWords,
    bitmapWords,
  ]),
)
if (sparseBitmapBatchCounts.join(",") !== "4,0") {
  throw new Error("Native sparse/bitmap batch count probe returned invalid output")
}
assertThrowsMatch(
  () =>
    addon.sparseBitmapIntersectionWords(
      new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 260, 261, 262, 263]),
      createPerfectPrototypeBitsetRowset({
        values: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 260, 261, 262, 263]),
        universeSize: 320,
      }).words,
      260,
    ),
  /exceeded explicit universeSize/u,
  "Native sparse/bitmap dense words smaller-universe guard",
)
assertThrowsMatch(
  () =>
    addon.sparseBitmapIntersectionWordsFill(
      new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 260, 261, 262, 263]),
      createPerfectPrototypeBitsetRowset({
        values: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 260, 261, 262, 263]),
        universeSize: 320,
      }).words,
      new Uint32Array(Math.ceil(260 / 32)),
      260,
    ),
  /exceeded explicit universeSize/u,
  "Native sparse/bitmap dense words fill smaller-universe guard",
)
assertThrowsMatch(
  () =>
    addon.bitmapBitmapIntersectionWords(
      createPerfectPrototypeBitsetRowset({
        values: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 260, 261, 262, 263]),
        universeSize: 320,
      }).words,
      createPerfectPrototypeBitsetRowset({
        values: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 260, 261, 262, 263]),
        universeSize: 320,
      }).words,
      260,
    ),
  /exceeded explicit universeSize/u,
  "Native bitset/bitset dense words smaller-universe guard",
)
assertThrowsMatch(
  () =>
    addon.bitmapBitmapIntersectionWordsFill(
      createPerfectPrototypeBitsetRowset({
        values: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 260, 261, 262, 263]),
        universeSize: 320,
      }).words,
      createPerfectPrototypeBitsetRowset({
        values: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 260, 261, 262, 263]),
        universeSize: 320,
      }).words,
      new Uint32Array(Math.ceil(260 / 32)),
      260,
    ),
  /exceeded explicit universeSize/u,
  "Native bitset/bitset dense words fill smaller-universe guard",
)
const runtimeStats = addon.getRuntimeStats()
for (const key of [
  "sparseEqualSizeMergeCount",
  "sparseAdaptiveGallopCount",
  "sparseCountFastPathCount",
  "sparseBitmapWordRunCount",
  "sparseBitmapSkippedRunCount",
  "sparseBitmapPartialRunCount",
  "sparseBitmapFullRunHitCount",
]) {
  if (!Number.isFinite(Number(runtimeStats?.[key] ?? NaN))) {
    throw new Error(`Native sparse runtime stats must expose finite ${key}`)
  }
}
if (Number(runtimeStats?.sparseEqualSizeMergeCount ?? 0) < 1) {
  throw new Error("Native sparse runtime stats did not record equal-size merge usage")
}
if (Number(runtimeStats?.sparseCountFastPathCount ?? 0) < 1) {
  throw new Error("Native sparse runtime stats did not record count fast-path usage")
}
if (Number(runtimeStats?.sparseBitmapWordRunCount ?? 0) < 1) {
  throw new Error("Native sparse runtime stats did not record sparse/bitmap word runs")
}
if (Number(runtimeStats?.sparseBitmapPartialRunCount ?? 0) < 1) {
  throw new Error("Native sparse runtime stats did not record sparse/bitmap partial-run usage")
}
if (Number(runtimeStats?.sparseBitmapFullRunHitCount ?? 0) < 1) {
  throw new Error("Native sparse runtime stats did not record sparse/bitmap full-run usage")
}
addon.resetRuntimeStats()
const resetRuntimeStats = addon.getRuntimeStats()
for (const key of [
  "sparseEqualSizeMergeCount",
  "sparseAdaptiveGallopCount",
  "sparseCountFastPathCount",
  "sparseBitmapWordRunCount",
  "sparseBitmapSkippedRunCount",
  "sparseBitmapPartialRunCount",
  "sparseBitmapFullRunHitCount",
]) {
  if (Number(resetRuntimeStats?.[key] ?? NaN) !== 0) {
    throw new Error(`Native sparse runtime stats reset failed for ${key}`)
  }
}
const denseUniverseSize = 4096
const denseLeftValues = Uint32Array.from(
  Array.from({ length: 1500 }, (_, index) => index * 2 + (index % 11 === 0 ? 1 : 0))
    .filter((value, index, list) => value < denseUniverseSize && list.indexOf(value) === index)
    .sort((left, right) => left - right),
)
const denseRightValues = Uint32Array.from(
  Array.from({ length: 1400 }, (_, index) => index * 2 + (index % 7 === 0 ? 3 : 0))
    .filter((value, index, list) => value < denseUniverseSize && list.indexOf(value) === index)
    .sort((left, right) => left - right),
)
const denseLeft = createPerfectPrototypeBitsetRowset({
  values: denseLeftValues,
  universeSize: denseUniverseSize,
})
const denseRight = createPerfectPrototypeBitsetRowset({
  values: denseRightValues,
  universeSize: denseUniverseSize,
})
const denseReferenceCount = intersectPerfectPrototypeRowsetsCountJsReference(denseLeft, denseRight)
const denseNativeCount = Number(addon.bitmapBitmapIntersectionCount(denseLeft.words, denseRight.words))
if (denseNativeCount !== denseReferenceCount) {
  throw new Error(
    `Native bitmap/bitmap dense count mismatch: expected=${denseReferenceCount} actual=${denseNativeCount}`,
  )
}
const denseBatchCounts = Array.from(
  addon.bitmapBitmapIntersectionCountBatch(denseLeft.words, [
    denseRight.words,
    denseLeft.words,
  ]),
)
if (denseBatchCounts.join(",") !== `${denseReferenceCount},${denseLeftValues.length}`) {
  throw new Error("Native bitmap/bitmap batch count probe returned invalid output")
}
const bitmapSparseBatchCounts = Array.from(
  addon.bitmapSparseIntersectionCountBatch(denseLeft.words, [
    nearSizeSparseLeft,
    nearSizeSparseRight,
  ]),
)
const bitmapSparseExpected = [
  intersectPerfectPrototypeRowsetsCountJsReference(
    denseLeft,
    createPerfectPrototypeSparseRowset(nearSizeSparseLeft),
  ),
  intersectPerfectPrototypeRowsetsCountJsReference(
    denseLeft,
    createPerfectPrototypeSparseRowset(nearSizeSparseRight),
  ),
]
if (bitmapSparseBatchCounts.join(",") !== bitmapSparseExpected.join(",")) {
  throw new Error("Native bitmap/sparse batch count probe returned invalid output")
}
const denseValuesFill = new Uint32Array(denseReferenceCount)
const denseValuesFillCount = Number(
  addon.bitmapBitmapIntersectionValuesFill(denseLeft.words, denseRight.words, denseValuesFill),
)
if (denseValuesFillCount !== denseReferenceCount) {
  throw new Error(
    `Native bitmap/bitmap dense values fill count mismatch: expected=${denseReferenceCount} actual=${denseValuesFillCount}`,
  )
}
const denseReferenceIntersect = intersectPerfectPrototypeRowsetsJsReference({
  leftRowset: denseLeft,
  rightRowset: denseRight,
  universeSize: denseUniverseSize,
  allowDense: true,
})
const denseReferenceValues = Array.from(materializePerfectPrototypeRowsetValuesJsReference(denseReferenceIntersect))
if (denseReferenceValues.join(",") !== Array.from(denseValuesFill).join(",")) {
  throw new Error("Native bitmap/bitmap dense values fill mismatched JS reference")
}
const denseWordsDecoded = addon.bitmapBitmapIntersectionWords(
  denseLeft.words,
  denseRight.words,
  denseUniverseSize,
)
if (Number(denseWordsDecoded?.count ?? -1) !== denseReferenceCount) {
  throw new Error("Native bitmap/bitmap dense words count mismatched JS reference")
}
const denseMaterialized = addon.bitmapMaterializeValues(denseWordsDecoded.words, denseReferenceCount)
if (Array.from(denseMaterialized).join(",") !== denseReferenceValues.join(",")) {
  throw new Error("Native bitmap materialization mismatched dense JS reference")
}
const denseWordsFill = new Uint32Array(denseWordsDecoded.words.length)
const denseWordsFillCount = Number(
  addon.bitmapBitmapIntersectionWordsFill(
    denseLeft.words,
    denseRight.words,
    denseWordsFill,
    denseUniverseSize,
  ),
)
if (denseWordsFillCount !== denseReferenceCount) {
  throw new Error("Native bitmap/bitmap dense words fill count mismatched JS reference")
}
const denseWordsFillMaterialized = addon.bitmapMaterializeValues(denseWordsFill, denseReferenceCount)
if (Array.from(denseWordsFillMaterialized).join(",") !== denseReferenceValues.join(",")) {
  throw new Error("Native bitmap/bitmap dense words fill materialization mismatched JS reference")
}
const denseSelfEquals = Boolean(addon.bitmapEquals(denseLeft.words, denseLeft.words))
const denseCrossEquals = Boolean(addon.bitmapEquals(denseLeft.words, denseRight.words))
if (denseSelfEquals !== arePerfectPrototypeRowsetsEqualJsReference(denseLeft, denseLeft)) {
  throw new Error("Native bitmap equals self probe mismatched JS reference")
}
if (denseCrossEquals !== arePerfectPrototypeRowsetsEqualJsReference(denseLeft, denseRight)) {
  throw new Error("Native bitmap equals cross probe mismatched JS reference")
}
const denseSubsetExpected = isPerfectPrototypeRowsetSubsetJsReference(denseReferenceIntersect, denseLeft)
const denseSubsetActual = Boolean(addon.bitmapSubset(denseWordsDecoded.words, denseLeft.words))
if (denseSubsetActual !== denseSubsetExpected) {
  throw new Error("Native bitmap subset probe mismatched JS reference")
}
const denseEdgeSummary = addon.bitmapEdgeSummary(denseLeft.words)
if (
  Number(denseEdgeSummary?.firstValue ?? -1) !== Number(denseLeftValues[0] ?? -1) ||
  Number(denseEdgeSummary?.lastValue ?? -1) !== Number(denseLeftValues[denseLeftValues.length - 1] ?? -1)
) {
  throw new Error("Native bitmap edge summary probe mismatched JS reference")
}
const skewedSparseLeft = Uint32Array.from(Array.from({ length: 24 }, (_, index) => index * 41 + 7))
const skewedSparseRight = Uint32Array.from(
  Array.from({ length: 5000 }, (_, index) => index * 3 + (index % 41 === 0 ? 7 : 1))
    .filter((value, index, list) => value <= 40000 && list.indexOf(value) === index)
    .sort((left, right) => left - right),
)
const skewedSparseReferenceRowset = intersectPerfectPrototypeRowsetsJsReference({
  leftRowset: createPerfectPrototypeSparseRowset(skewedSparseLeft),
  rightRowset: createPerfectPrototypeSparseRowset(skewedSparseRight),
  allowDense: false,
})
const skewedSparseReferenceValues = Array.from(materializePerfectPrototypeRowsetValuesJsReference(skewedSparseReferenceRowset))
const skewedSparseNativeCount = Number(addon.sparseSparseIntersectionCount(skewedSparseLeft, skewedSparseRight))
if (skewedSparseNativeCount !== skewedSparseReferenceValues.length) {
  throw new Error("Native sparse/sparse adaptive count probe mismatched JS reference")
}
const skewedSparseNativeValues = Array.from(addon.sparseSparseIntersectionValues(skewedSparseLeft, skewedSparseRight))
if (skewedSparseNativeValues.join(",") !== skewedSparseReferenceValues.join(",")) {
  throw new Error("Native sparse/sparse adaptive values probe mismatched JS reference")
}
const skewedSparseFill = new Uint32Array(skewedSparseReferenceValues.length)
const skewedSparseFillCount = Number(
  addon.sparseSparseIntersectionFill(skewedSparseLeft, skewedSparseRight, skewedSparseFill),
)
if (skewedSparseFillCount !== skewedSparseReferenceValues.length) {
  throw new Error("Native sparse/sparse adaptive fill count probe mismatched JS reference")
}
if (Array.from(skewedSparseFill).join(",") !== skewedSparseReferenceValues.join(",")) {
  throw new Error("Native sparse/sparse adaptive fill values probe mismatched JS reference")
}
const sparseBitmapUniverseSize = 32768
const sparseBitmapValues = Uint32Array.from(
  Array.from({ length: 1800 }, (_, index) => index * 5 + (index % 9 === 0 ? 2 : 0))
    .filter((value, index, list) => value < sparseBitmapUniverseSize && list.indexOf(value) === index)
    .sort((left, right) => left - right),
)
const sparseBitmapProbe = Uint32Array.from(
  Array.from({ length: 1200 }, (_, index) => index * 7 + (index % 4 === 0 ? 2 : 1))
    .filter((value, index, list) => value < sparseBitmapUniverseSize && list.indexOf(value) === index)
    .sort((left, right) => left - right),
)
const sparseBitmapRowset = createPerfectPrototypeBitsetRowset({
  values: sparseBitmapValues,
  universeSize: sparseBitmapUniverseSize,
})
const sparseBitmapReferenceRowset = intersectPerfectPrototypeRowsetsJsReference({
  leftRowset: createPerfectPrototypeSparseRowset(sparseBitmapProbe),
  rightRowset: sparseBitmapRowset,
  universeSize: sparseBitmapUniverseSize,
  allowDense: false,
})
const sparseBitmapReferenceValues = Array.from(
  materializePerfectPrototypeRowsetValuesJsReference(sparseBitmapReferenceRowset),
)
const sparseBitmapNativeValues = Array.from(
  addon.sparseBitmapIntersectionValues(sparseBitmapProbe, sparseBitmapRowset.words),
)
if (sparseBitmapNativeValues.join(",") !== sparseBitmapReferenceValues.join(",")) {
  throw new Error("Native sparse/bitmap adaptive values probe mismatched JS reference")
}
const sparseBitmapAdaptiveFill = new Uint32Array(sparseBitmapReferenceValues.length)
const sparseBitmapAdaptiveFillCount = Number(
  addon.sparseBitmapIntersectionValuesFill(
    sparseBitmapProbe,
    sparseBitmapRowset.words,
    sparseBitmapAdaptiveFill,
  ),
)
if (sparseBitmapAdaptiveFillCount !== sparseBitmapReferenceValues.length) {
  throw new Error("Native sparse/bitmap adaptive fill count probe mismatched JS reference")
}
if (Array.from(sparseBitmapAdaptiveFill).join(",") !== sparseBitmapReferenceValues.join(",")) {
  throw new Error("Native sparse/bitmap adaptive fill values probe mismatched JS reference")
}
assertThrowsMatch(
  () =>
    createPerfectPrototypeBitsetRowsetFromWords({
      words: Uint32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 240]),
      count: 12,
      universeSize: 260,
    }),
  /last word exceeds universe/u,
  "Bitset rowset builder trailing-bit guard",
)
assertThrowsMatch(
  () =>
    createPerfectPrototypeBitsetRowsetFromWords({
      words: new Uint32Array(10),
      count: 0,
      universeSize: 260,
    }),
  /words length mismatch/u,
  "Bitset rowset builder word-length guard",
)
const sparseBitmapSubsetProbe = createPerfectPrototypeSparseRowset(
  Uint32Array.from([0, 5, 31, 32, 63, 95, 96, 127, 255, 511]),
)
const sparseBitmapSuperset = createPerfectPrototypeBitsetRowset({
  values: Uint32Array.from([0, 5, 31, 32, 63, 95, 96, 127, 255, 511, 640, 900]),
  universeSize: 1024,
})
const sparseBitmapMissing = createPerfectPrototypeSparseRowset(
  Uint32Array.from([0, 5, 31, 32, 63, 95, 96, 127, 255, 512]),
)
if (
  Boolean(addon.sparseBitmapSubset(sparseBitmapSubsetProbe.values, sparseBitmapSuperset.words)) !==
  isPerfectPrototypeRowsetSubsetJsReference(sparseBitmapSubsetProbe, sparseBitmapSuperset)
) {
  throw new Error("Native sparse/bitmap subset exact probe mismatched JS reference")
}
if (
  Boolean(addon.sparseBitmapSubset(sparseBitmapMissing.values, sparseBitmapSuperset.words)) !==
  isPerfectPrototypeRowsetSubsetJsReference(sparseBitmapMissing, sparseBitmapSuperset)
) {
  throw new Error("Native sparse/bitmap subset missing-bit probe mismatched JS reference")
}
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "perfect_proto_native_verify_"))
const fileBackedPath = path.join(tempRoot, "shifted_refs.bin")
const fileHandle = await openPerfectPrototypePostingsFile(fileBackedPath, "w+")
try {
  let cursor = 0
  const fileRefs = []
  for (const ref of shiftedRefs) {
    const buffer = Buffer.isBuffer(ref.buffer) ? ref.buffer : Buffer.from(ref.buffer ?? [])
    if (buffer.length > 0) {
      await fileHandle.write(buffer, 0, buffer.length, cursor)
    }
    fileRefs.push({
      fileHandle,
      fileDescriptor: fileHandle.fd,
      offset: cursor,
      byteLength: buffer.length,
      rowOffset: ref.rowOffset,
      count: ref.count,
    })
    cursor += buffer.length
  }
  const fileMerged = addon.mergeShiftedDeltaRefsFromFiles(
    Int32Array.from(fileRefs.map((entry) => entry.fileDescriptor)),
    BigUint64Array.from(fileRefs.map((entry) => BigInt(entry.offset))),
    Uint32Array.from(fileRefs.map((entry) => entry.byteLength)),
    Uint32Array.from(fileRefs.map((entry) => entry.rowOffset)),
    Uint32Array.from(fileRefs.map((entry) => entry.count)),
  )
  const fileReference = await mergePerfectPrototypeShiftedDeltaPostingFileRefsJsReference({
    refs: fileRefs,
  })
  if (
    !Buffer.isBuffer(fileMerged?.buffer) ||
    Number(fileMerged?.count ?? 0) !== Number(fileReference?.count ?? 0) ||
    Number(fileMerged?.firstRowIdx ?? -1) !== Number(fileReference?.firstRowIdx ?? -1) ||
    Number(fileMerged?.lastRowIdx ?? -1) !== Number(fileReference?.lastRowIdx ?? -1) ||
    Buffer.compare(fileMerged.buffer, fileReference.buffer) !== 0
  ) {
    throw new Error("Native file-backed shifted-delta merge probe returned invalid metadata")
  }
  const spliceOutPath = path.join(tempRoot, "shifted_splice.bin")
  const spliceHandle = await openPerfectPrototypePostingsFile(spliceOutPath, "w+")
  try {
    const spliceResult = addon.spliceShiftedDeltaRefsToFile(
      spliceHandle.fd,
      0n,
      Int32Array.from(fileRefs.map((entry) => entry.fileDescriptor)),
      BigUint64Array.from(fileRefs.map((entry) => BigInt(entry.offset))),
      Uint32Array.from(fileRefs.map((entry) => entry.byteLength)),
      Uint32Array.from(fileRefs.map((entry) => entry.rowOffset)),
      Uint32Array.from(fileRefs.map((entry) => entry.count)),
      Int32Array.from([2, 3, -1]),
      Int32Array.from([20000, 1000, -1]),
    )
    await spliceHandle.sync()
    const spliceBytes = fs.readFileSync(spliceOutPath)
    if (
      Number(spliceResult?.count ?? -1) !== Number(fileReference?.count ?? -1) ||
      Number(spliceResult?.firstRowIdx ?? -1) !== Number(fileReference?.firstRowIdx ?? -1) ||
      Number(spliceResult?.lastRowIdx ?? -1) !== Number(fileReference?.lastRowIdx ?? -1) ||
      Number(spliceResult?.byteLength ?? -1) !== Number(fileReference?.buffer?.length ?? -1) ||
      Buffer.compare(spliceBytes, fileReference.buffer) !== 0
    ) {
      throw new Error("Native postings splice probe returned invalid output")
    }
  } finally {
    await spliceHandle.close().catch(() => {})
  }
} finally {
  await fileHandle.close().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
console.log(`[ok] verified native rowset kernel: ${kernelPath}`)
EOF

VERIFY_PROBE_BUILD_DIR="$(mktemp -d "$ROOT_DIR/native/perfect_prototype_rowset_kernel/build/Release/perfect_prototype_rowset_kernel.verify.XXXXXX")"
VERIFY_PROBE_KERNEL_PATH="$VERIFY_PROBE_BUILD_DIR/perfect_prototype_rowset_kernel.node"
VERIFY_PROBE_MANIFEST_PATH="$VERIFY_PROBE_BUILD_DIR/perfect_prototype_rowset_kernel.build.json"
reset_verify_probe_artifacts() {
  cp "$KERNEL_PATH" "$VERIFY_PROBE_KERNEL_PATH"
  cp "$MANIFEST_PATH" "$VERIFY_PROBE_MANIFEST_PATH"
}
cleanup_verify_probe_artifacts() {
  rm -rf "$VERIFY_PROBE_BUILD_DIR"
}
trap cleanup_verify_probe_artifacts EXIT
reset_verify_probe_artifacts

check_runtime_guard_failure() {
  local expected_detail="$1"
  set +e
  local output
  output="$(
    PERFECT_PROTO_NATIVE_ROWSET_KERNEL_MANIFEST_PATH="$VERIFY_PROBE_MANIFEST_PATH" \
      node --input-type=module -e 'await import("./src/lib/perfect_prototype_rowset_native.mjs")' 2>&1
  )"
  local status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "[fatal] native runtime guard accepted an invalid build manifest state" >&2
    exit 4
  fi
  if [[ "$output" != *"runtime contract is stale or invalid"* ]]; then
    echo "[fatal] native runtime guard error message missing stale-build contract text" >&2
    echo "$output" >&2
    exit 4
  fi
  if [[ "$output" != *"$expected_detail"* ]]; then
    echo "[fatal] native runtime guard error message missing expected detail: $expected_detail" >&2
    echo "$output" >&2
    exit 4
  fi
  if [[ "$output" != *"bash scripts/build_native_rowset_kernel.sh && bash scripts/verify_native_rowset_kernel.sh"* ]]; then
    echo "[fatal] native runtime guard error message missing remediation" >&2
    echo "$output" >&2
    exit 4
  fi
}

node --input-type=module - "$VERIFY_PROBE_MANIFEST_PATH" <<'EOF'
import fs from "node:fs"

const manifestPath = process.argv[2]
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
manifest.sourceSha256 = `stale-${String(manifest.sourceSha256 ?? "")}`
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
EOF

check_runtime_guard_failure "sourceSha256 mismatch"

reset_verify_probe_artifacts
node --input-type=module - "$VERIFY_PROBE_MANIFEST_PATH" <<'EOF'
import fs from "node:fs"

const manifestPath = process.argv[2]
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
manifest.outputSha256 = `stale-${String(manifest.outputSha256 ?? "")}`
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
EOF
check_runtime_guard_failure "outputSha256 mismatch"

reset_verify_probe_artifacts
rm -f "$VERIFY_PROBE_MANIFEST_PATH"
check_runtime_guard_failure "missing native kernel build manifest"

reset_verify_probe_artifacts
printf '{invalid-json\n' > "$VERIFY_PROBE_MANIFEST_PATH"
check_runtime_guard_failure "invalid native kernel build manifest"

reset_verify_probe_artifacts
node --input-type=module - "$VERIFY_PROBE_MANIFEST_PATH" <<'EOF'
import fs from "node:fs"

const manifestPath = process.argv[2]
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
manifest.platform = "stale-platform"
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
EOF
check_runtime_guard_failure "platform mismatch"

reset_verify_probe_artifacts
node --input-type=module - "$VERIFY_PROBE_MANIFEST_PATH" <<'EOF'
import fs from "node:fs"

const manifestPath = process.argv[2]
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
manifest.nodeApiVersion = "stale-node-api"
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
EOF
check_runtime_guard_failure "nodeApiVersion mismatch"

reset_verify_probe_artifacts
node --input-type=module - "$VERIFY_PROBE_MANIFEST_PATH" <<'EOF'
import fs from "node:fs"

const manifestPath = process.argv[2]
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
manifest.outputSha256 = `stale-${String(manifest.outputSha256 ?? "")}`
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
EOF
PERFECT_PROTO_NATIVE_ROWSET_KERNEL_BUILD_DIR="$VERIFY_PROBE_BUILD_DIR" \
  bash "$ROOT_DIR/scripts/build_native_rowset_kernel.sh"
node --input-type=module - "$VERIFY_PROBE_KERNEL_PATH" "$VERIFY_PROBE_MANIFEST_PATH" <<'EOF'
import crypto from "node:crypto"
import fs from "node:fs"

const kernelPath = process.argv[2]
const manifestPath = process.argv[3]
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const outputSha256 = crypto.createHash("sha256").update(fs.readFileSync(kernelPath)).digest("hex")
if (String(manifest.outputSha256 ?? "") !== outputSha256) {
  throw new Error("build_native_rowset_kernel.sh failed to self-heal stale outputSha256 manifest state")
}
EOF

trap - EXIT
cleanup_verify_probe_artifacts
