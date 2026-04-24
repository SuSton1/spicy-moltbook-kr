import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import v8 from "node:v8"

import { ensureDir, pathExists, readJson, writeJsonAtomic } from "./io.mjs"

export const PERFECT_PROTOTYPE_MINING_CACHE_DIRNAME = ".exact-mining-cache"
export const PERFECT_PROTOTYPE_MINING_CACHE_VERSION = 1
export const PERFECT_PROTOTYPE_MINING_CACHE_CONTRACT_VERSION = 1

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`
  }
  if (!value || typeof value !== "object") {
    return JSON.stringify(value ?? null)
  }
  return `{${Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`
}

const sha256Hex = (value) =>
  crypto.createHash("sha256").update(String(value ?? "")).digest("hex")

const normalizeText = (value) => {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

const normalizePath = (value) => path.resolve(String(value ?? "").trim())

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const normalizeTokenizerOptions = (tokenizerOptions = {}) => ({
  binCount: Number.isInteger(Number(tokenizerOptions?.binCount))
    ? Number(tokenizerOptions.binCount)
    : null,
  includeSymbolToken: tokenizerOptions?.includeSymbolToken === true,
  includeMissingTokens: tokenizerOptions?.includeMissingTokens === true,
  includeCategoricalTokens: tokenizerOptions?.includeCategoricalTokens !== false,
  includeFeaturePrefixes: uniqueSorted(tokenizerOptions?.includeFeaturePrefixes),
  surfaceName: normalizeText(tokenizerOptions?.surfaceName),
})

const assertCacheManifestMatchesIdentity = ({ manifest, identity, manifestPath }) => {
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Perfect prototype mining cache manifest must be an object: ${manifestPath}`)
  }
  if (Number(manifest?.version) !== PERFECT_PROTOTYPE_MINING_CACHE_VERSION) {
    throw new Error(
      [
        "Perfect prototype mining cache manifest version mismatch.",
        `manifestPath=${manifestPath}`,
        `expected=${PERFECT_PROTOTYPE_MINING_CACHE_VERSION}`,
        `actual=${manifest?.version ?? "null"}`,
      ].join("\n"),
    )
  }
  const expectedPairs = [
    ["cacheKey", identity.cacheKey, manifest?.cacheKey],
    ["inputPath", identity.inputPath, manifest?.inputPath],
    ["inputSha256", identity.inputSha256, manifest?.inputSha256],
    ["surfaceName", identity.surfaceName, manifest?.surfaceName],
    ["searchMode", identity.searchMode, manifest?.searchMode],
    ["trainStartDate", identity.trainStartDate, manifest?.trainStartDate],
    ["trainEndDate", identity.trainEndDate, manifest?.trainEndDate],
    ["minerContractVersion", identity.minerContractVersion, manifest?.minerContractVersion],
    ["tokenizerOptions", identity.tokenizerOptions, manifest?.tokenizerOptions],
  ]
  for (const [label, expected, actual] of expectedPairs) {
    if (stableStringify(expected) !== stableStringify(actual)) {
      throw new Error(
        [
          "Perfect prototype mining cache manifest provenance mismatch.",
          `manifestPath=${manifestPath}`,
          `field=${label}`,
          `expected=${stableStringify(expected)}`,
          `actual=${stableStringify(actual)}`,
        ].join("\n"),
      )
    }
  }
  const tokenizerSpecHash = normalizeText(manifest?.tokenizerSpecHash)
  if (!tokenizerSpecHash || !/^[0-9a-f]{64}$/u.test(tokenizerSpecHash)) {
    throw new Error(
      [
        "Perfect prototype mining cache manifest is missing tokenizerSpecHash.",
        `manifestPath=${manifestPath}`,
      ].join("\n"),
    )
  }
  return {
    ...manifest,
    tokenizerSpecHash,
  }
}

const assertSnapshotShape = ({ snapshot, snapshotPath }) => {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error(`Perfect prototype mining cache snapshot must be an object: ${snapshotPath}`)
  }
  if (!Array.isArray(snapshot?.rows)) {
    throw new Error(`Perfect prototype mining cache snapshot is missing rows: ${snapshotPath}`)
  }
  if (!snapshot?.tokenizerSpec || typeof snapshot.tokenizerSpec !== "object") {
    throw new Error(`Perfect prototype mining cache snapshot is missing tokenizerSpec: ${snapshotPath}`)
  }
  if (!Array.isArray(snapshot?.calendarDateKeys)) {
    throw new Error(`Perfect prototype mining cache snapshot is missing calendarDateKeys: ${snapshotPath}`)
  }
  if (!Array.isArray(snapshot?.tokenStatsEntries)) {
    throw new Error(`Perfect prototype mining cache snapshot is missing tokenStatsEntries: ${snapshotPath}`)
  }
  if (!(snapshot?.allPositiveRowIndexes instanceof Uint32Array)) {
    throw new Error(`Perfect prototype mining cache snapshot is missing allPositiveRowIndexes: ${snapshotPath}`)
  }
  if (!(snapshot?.allNegativeRowIndexes instanceof Uint32Array)) {
    throw new Error(`Perfect prototype mining cache snapshot is missing allNegativeRowIndexes: ${snapshotPath}`)
  }
  return snapshot
}

const writeBinaryAtomic = async (filePath, buffer) => {
  const dirPath = path.dirname(filePath)
  await ensureDir(dirPath)
  const tempPath = path.join(
    dirPath,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  let handle = null
  try {
    handle = await fsp.open(tempPath, "w")
    await handle.writeFile(buffer)
    await handle.sync()
    await handle.close()
    handle = null
    await fsp.rename(tempPath, filePath)
  } catch (error) {
    if (handle) {
      try {
        await handle.close()
      } catch {}
    }
    try {
      await fsp.unlink(tempPath)
    } catch {}
    throw error
  }
}

export const hashPerfectPrototypeMiningInputFile = async (filePath) =>
  await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256")
    const stream = fs.createReadStream(path.resolve(String(filePath ?? "").trim()))
    stream.on("data", (chunk) => hash.update(chunk))
    stream.once("error", reject)
    stream.once("end", () => resolve(hash.digest("hex")))
  })

export const buildPerfectPrototypeMiningCacheIdentity = ({
  inputPath,
  inputSha256,
  surfaceName,
  searchMode,
  trainStartDate = null,
  trainEndDate = null,
  tokenizerOptions = {},
  minerContractVersion = PERFECT_PROTOTYPE_MINING_CACHE_CONTRACT_VERSION,
}) => {
  const identityPayload = {
    inputPath: normalizePath(inputPath),
    inputSha256: String(inputSha256 ?? "").trim().toLowerCase(),
    surfaceName: normalizeText(surfaceName),
    searchMode: normalizeText(searchMode),
    trainStartDate: normalizeText(trainStartDate),
    trainEndDate: normalizeText(trainEndDate),
    tokenizerOptions: normalizeTokenizerOptions(tokenizerOptions),
    minerContractVersion: Number(minerContractVersion),
  }
  return {
    ...identityPayload,
    cacheKey: sha256Hex(stableStringify(identityPayload)),
  }
}

export const resolvePerfectPrototypeMiningCachePaths = ({ inputPath, cacheKey }) => {
  const cacheDir = path.join(
    path.dirname(normalizePath(inputPath)),
    PERFECT_PROTOTYPE_MINING_CACHE_DIRNAME,
    String(cacheKey ?? "").trim(),
  )
  return {
    cacheDir,
    manifestPath: path.join(cacheDir, "manifest.json"),
    snapshotPath: path.join(cacheDir, "snapshot.bin"),
  }
}

export const readPerfectPrototypeMiningSnapshotCache = async ({
  inputPath,
  identity,
}) => {
  const paths = resolvePerfectPrototypeMiningCachePaths({
    inputPath,
    cacheKey: identity?.cacheKey,
  })
  const manifestExists = pathExists(paths.manifestPath)
  const snapshotExists = pathExists(paths.snapshotPath)
  if (!manifestExists && !snapshotExists) return null
  if (!manifestExists || !snapshotExists) {
    throw new Error(
      [
        "Perfect prototype mining cache is incomplete.",
        `cacheDir=${paths.cacheDir}`,
        `manifestExists=${manifestExists}`,
        `snapshotExists=${snapshotExists}`,
      ].join("\n"),
    )
  }
  const manifest = assertCacheManifestMatchesIdentity({
    manifest: await readJson(paths.manifestPath, null),
    identity,
    manifestPath: paths.manifestPath,
  })
  const snapshot = assertSnapshotShape({
    snapshot: v8.deserialize(await fsp.readFile(paths.snapshotPath)),
    snapshotPath: paths.snapshotPath,
  })
  return {
    ...paths,
    manifest,
    snapshot,
  }
}

export const writePerfectPrototypeMiningSnapshotCache = async ({
  inputPath,
  identity,
  tokenizerSpecHash,
  snapshot,
}) => {
  const paths = resolvePerfectPrototypeMiningCachePaths({
    inputPath,
    cacheKey: identity?.cacheKey,
  })
  const safeSnapshot = assertSnapshotShape({
    snapshot,
    snapshotPath: paths.snapshotPath,
  })
  const manifest = {
    version: PERFECT_PROTOTYPE_MINING_CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    cacheKey: identity.cacheKey,
    inputPath: identity.inputPath,
    inputSha256: identity.inputSha256,
    surfaceName: identity.surfaceName,
    searchMode: identity.searchMode,
    trainStartDate: identity.trainStartDate,
    trainEndDate: identity.trainEndDate,
    tokenizerOptions: identity.tokenizerOptions,
    minerContractVersion: identity.minerContractVersion,
    tokenizerSpecHash: String(tokenizerSpecHash ?? "").trim().toLowerCase(),
    rowCount: safeSnapshot.rows.length,
    tokenCount: safeSnapshot.tokenStatsEntries.length,
    positiveRowCount: safeSnapshot.allPositiveRowIndexes.length,
    negativeRowCount: safeSnapshot.allNegativeRowIndexes.length,
  }
  if (!/^[0-9a-f]{64}$/u.test(manifest.tokenizerSpecHash)) {
    throw new Error("Perfect prototype mining cache write requires a 64-char tokenizerSpecHash")
  }
  await ensureDir(paths.cacheDir)
  await writeBinaryAtomic(paths.snapshotPath, v8.serialize(safeSnapshot))
  await writeJsonAtomic(paths.manifestPath, manifest)
  return {
    ...paths,
    manifest,
  }
}
