import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const require = createRequire(import.meta.url)
const THIS_FILE_PATH = fileURLToPath(import.meta.url)
const BITMAP_BACKEND = process.env.PERFECT_PROTO_BITMAP_BACKEND ?? "exact"
const NATIVE_REQUIRED = process.env.PERFECT_PROTO_NATIVE_ROWSET_REQUIRED ?? "true"
const SIMD_REQUIRED = process.env.PERFECT_PROTO_SIMD_ROWSET_REQUIRED ?? "true"
const SPARSE_KERNEL_REQUIRED = process.env.PREJUMP_SPARSE_KERNEL_REQUIRED ?? "true"
const REQUIRED_SIMD_FEATURES = ["avx2", "popcnt"]
const REQUIRED_SIMD_KERNEL_MODE = "avx2_exact_bitset"
const REQUIRED_SPARSE_KERNEL_MODE = "adaptive_exact_v4"
const NATIVE_ROWSET_KERNEL_MANIFEST_PATH_OVERRIDE = String(
  process.env.PERFECT_PROTO_NATIVE_ROWSET_KERNEL_MANIFEST_PATH ?? "",
).trim()

if (BITMAP_BACKEND !== "exact") {
  throw new Error(
    `Perfect prototype bitmap backend must remain exact: PERFECT_PROTO_BITMAP_BACKEND=${BITMAP_BACKEND}`,
  )
}

if (NATIVE_REQUIRED !== "true") {
  throw new Error(
    `Perfect prototype native rowset runtime must remain required: PERFECT_PROTO_NATIVE_ROWSET_REQUIRED=${NATIVE_REQUIRED}`,
  )
}

if (SIMD_REQUIRED !== "true") {
  throw new Error(
    `Perfect prototype SIMD rowset runtime must remain required: PERFECT_PROTO_SIMD_ROWSET_REQUIRED=${SIMD_REQUIRED}`,
  )
}

if (SPARSE_KERNEL_REQUIRED !== "true") {
  throw new Error(
    `Perfect prototype sparse rowset runtime must remain required: PREJUMP_SPARSE_KERNEL_REQUIRED=${SPARSE_KERNEL_REQUIRED}`,
  )
}

const NATIVE_ROWSET_KERNEL_PATH = path.resolve(
  path.dirname(THIS_FILE_PATH),
  "../../native/perfect_prototype_rowset_kernel/build/Release/perfect_prototype_rowset_kernel.node",
)
const NATIVE_ROWSET_KERNEL_MANIFEST_PATH = path.resolve(
  NATIVE_ROWSET_KERNEL_MANIFEST_PATH_OVERRIDE ||
    path.resolve(
      path.dirname(THIS_FILE_PATH),
      "../../native/perfect_prototype_rowset_kernel/build/Release/perfect_prototype_rowset_kernel.build.json",
    ),
)
const NATIVE_ROWSET_KERNEL_SOURCE_PATH = path.resolve(
  path.dirname(THIS_FILE_PATH),
  "../../native/perfect_prototype_rowset_kernel/src/kernel.cc",
)

const buildNativeKernelRuntimeError = (reason) =>
  new Error(
    `Perfect prototype native rowset kernel runtime contract is stale or invalid.\n` +
      `remediation: bash scripts/build_native_rowset_kernel.sh && bash scripts/verify_native_rowset_kernel.sh\n` +
      `cause: ${reason}`,
  )

const hashNativeKernelFile = (filePath, label) => {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw buildNativeKernelRuntimeError(`unable to read ${label}: path=${filePath} cause=${reason}`)
  }
}

const loadNativeKernelBuildManifest = () => {
  let manifestText = ""
  try {
    manifestText = fs.readFileSync(NATIVE_ROWSET_KERNEL_MANIFEST_PATH, "utf8")
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw buildNativeKernelRuntimeError(
      `missing native kernel build manifest: path=${NATIVE_ROWSET_KERNEL_MANIFEST_PATH} cause=${reason}`,
    )
  }
  try {
    const manifest = JSON.parse(manifestText)
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new Error("manifest must be a JSON object")
    }
    return manifest
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw buildNativeKernelRuntimeError(
      `invalid native kernel build manifest: path=${NATIVE_ROWSET_KERNEL_MANIFEST_PATH} cause=${reason}`,
    )
  }
}

const validateNativeKernelBuildManifest = (manifest) => {
  const expectedNodeApiVersion = String(process.versions.napi ?? "")
  if (String(manifest.platform ?? "") !== process.platform) {
    throw buildNativeKernelRuntimeError(
      `platform mismatch: manifest=${String(manifest.platform ?? "")} runtime=${process.platform}`,
    )
  }
  if (String(manifest.arch ?? "") !== process.arch) {
    throw buildNativeKernelRuntimeError(
      `arch mismatch: manifest=${String(manifest.arch ?? "")} runtime=${process.arch}`,
    )
  }
  if (String(manifest.nodeApiVersion ?? "") !== expectedNodeApiVersion) {
    throw buildNativeKernelRuntimeError(
      `nodeApiVersion mismatch: manifest=${String(manifest.nodeApiVersion ?? "")} runtime=${expectedNodeApiVersion}`,
    )
  }
  if (manifest.simdRequired !== true) {
    throw buildNativeKernelRuntimeError(`simdRequired mismatch: manifest=${String(manifest.simdRequired)}`)
  }
  if (String(manifest.simdKernelMode ?? "") !== REQUIRED_SIMD_KERNEL_MODE) {
    throw buildNativeKernelRuntimeError(
      `simdKernelMode mismatch: manifest=${String(manifest.simdKernelMode ?? "")} required=${REQUIRED_SIMD_KERNEL_MODE}`,
    )
  }
  if (String(manifest.sparseKernelMode ?? "") !== REQUIRED_SPARSE_KERNEL_MODE) {
    throw buildNativeKernelRuntimeError(
      `sparseKernelMode mismatch: manifest=${String(manifest.sparseKernelMode ?? "")} required=${REQUIRED_SPARSE_KERNEL_MODE}`,
    )
  }
  const manifestRequiredCpuFeatures = Array.isArray(manifest.requiredCpuFeatures)
    ? manifest.requiredCpuFeatures.map((value) => String(value))
    : []
  for (const feature of REQUIRED_SIMD_FEATURES) {
    if (!manifestRequiredCpuFeatures.includes(feature)) {
      throw buildNativeKernelRuntimeError(
        `requiredCpuFeatures mismatch: manifest missing feature='${feature}'`,
      )
    }
  }
  const sourceSha256 = hashNativeKernelFile(NATIVE_ROWSET_KERNEL_SOURCE_PATH, "native kernel source")
  if (sourceSha256 !== String(manifest.sourceSha256 ?? "")) {
    throw buildNativeKernelRuntimeError(
      `sourceSha256 mismatch: manifest=${String(manifest.sourceSha256 ?? "")} actual=${sourceSha256}`,
    )
  }
  const outputSha256 = hashNativeKernelFile(NATIVE_ROWSET_KERNEL_PATH, "native kernel binary")
  if (outputSha256 !== String(manifest.outputSha256 ?? "")) {
    throw buildNativeKernelRuntimeError(
      `outputSha256 mismatch: manifest=${String(manifest.outputSha256 ?? "")} actual=${outputSha256}`,
    )
  }
}

const detectRuntimeCpuFeatures = () => {
  if (process.arch !== "x64") {
    throw new Error(`Perfect prototype SIMD rowset kernel requires x64 runtime: arch=${process.arch}`)
  }
  if (process.platform === "linux") {
    const cpuInfo = fs.readFileSync("/proc/cpuinfo", "utf8").toLowerCase()
    return new Set(cpuInfo.split(/[^a-z0-9_]+/u).filter(Boolean))
  }
  if (process.platform === "darwin") {
    const features = []
    for (const name of ["machdep.cpu.features", "machdep.cpu.leaf7_features"]) {
      try {
        features.push(execFileSync("sysctl", ["-n", name], { encoding: "utf8" }))
      } catch {
        // Keep fail-fast semantics below if required flags are absent.
      }
    }
    return new Set(features.join(" ").toLowerCase().split(/[^a-z0-9_]+/u).filter(Boolean))
  }
  throw new Error(
    `Perfect prototype SIMD rowset kernel is only supported on x64 linux/darwin runtime: platform=${process.platform} arch=${process.arch}`,
  )
}

const loadNativeKernel = () => {
  try {
    return require(NATIVE_ROWSET_KERNEL_PATH)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Perfect prototype native rowset kernel is required but unavailable: ${NATIVE_ROWSET_KERNEL_PATH}\n` +
        `remediation: bash scripts/build_native_rowset_kernel.sh && bash scripts/verify_native_rowset_kernel.sh\n` +
        `cause: ${reason}`,
    )
  }
}

const nativePerfectPrototypeRowsetKernelBuildManifest = loadNativeKernelBuildManifest()
validateNativeKernelBuildManifest(nativePerfectPrototypeRowsetKernelBuildManifest)

const runtimeCpuFeatures = detectRuntimeCpuFeatures()
for (const feature of REQUIRED_SIMD_FEATURES) {
  if (!runtimeCpuFeatures.has(feature)) {
    throw new Error(
      `Perfect prototype SIMD rowset kernel requires CPU feature '${feature}' at runtime`,
    )
  }
}

export const nativePerfectPrototypeRowsetKernel = loadNativeKernel()
export const nativePerfectPrototypeRowsetKernelBuildInfo =
  typeof nativePerfectPrototypeRowsetKernel?.getBuildInfo === "function"
    ? nativePerfectPrototypeRowsetKernel.getBuildInfo()
    : null

if (typeof nativePerfectPrototypeRowsetKernel?.getRuntimeStats !== "function") {
  throw new Error("Perfect prototype native rowset kernel must expose getRuntimeStats()")
}
if (typeof nativePerfectPrototypeRowsetKernel?.resetRuntimeStats !== "function") {
  throw new Error("Perfect prototype native rowset kernel must expose resetRuntimeStats()")
}
for (const requiredExport of [
  "bitmapBitmapIntersectionCountBatch",
  "bitmapSparseIntersectionCountBatch",
  "sparseBitmapIntersectionCountBatch",
  "sparseSparseIntersectionCountBatch",
]) {
  if (typeof nativePerfectPrototypeRowsetKernel?.[requiredExport] !== "function") {
    throw new Error(`Perfect prototype native rowset kernel must expose ${requiredExport}()`)
  }
}

if (!nativePerfectPrototypeRowsetKernelBuildInfo || typeof nativePerfectPrototypeRowsetKernelBuildInfo !== "object") {
  throw new Error("Perfect prototype native rowset kernel did not expose build info")
}
if (nativePerfectPrototypeRowsetKernelBuildInfo.simdRequired !== true) {
  throw new Error("Perfect prototype native rowset kernel must report simdRequired=true")
}
if (String(nativePerfectPrototypeRowsetKernelBuildInfo.kernelMode ?? "") !== REQUIRED_SIMD_KERNEL_MODE) {
  throw new Error(
    `Perfect prototype native rowset kernel must report kernelMode=${REQUIRED_SIMD_KERNEL_MODE}: ${String(nativePerfectPrototypeRowsetKernelBuildInfo.kernelMode ?? "")}`,
  )
}
if (String(nativePerfectPrototypeRowsetKernelBuildInfo.sparseKernelMode ?? "") !== REQUIRED_SPARSE_KERNEL_MODE) {
  throw new Error(
    `Perfect prototype native rowset kernel must report sparseKernelMode=${REQUIRED_SPARSE_KERNEL_MODE}: ${String(nativePerfectPrototypeRowsetKernelBuildInfo.sparseKernelMode ?? "")}`,
  )
}
for (const feature of REQUIRED_SIMD_FEATURES) {
  if (!(nativePerfectPrototypeRowsetKernelBuildInfo.requiredCpuFeatures ?? []).includes(feature)) {
    throw new Error(
      `Perfect prototype native rowset kernel build info is missing required CPU feature '${feature}'`,
    )
  }
}
export const NATIVE_PERFECT_PROTOTYPE_ROWSET_KERNEL_PATH = NATIVE_ROWSET_KERNEL_PATH
export const NATIVE_PERFECT_PROTOTYPE_ROWSET_KERNEL_MANIFEST_PATH = NATIVE_ROWSET_KERNEL_MANIFEST_PATH
