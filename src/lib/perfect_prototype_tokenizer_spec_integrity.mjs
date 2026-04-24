import crypto from "node:crypto"
import path from "node:path"

import { pathExists, readJsonIfExistsStrict, writeJsonAtomic } from "./io.mjs"

export const PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION = 2

const normalizeJsonValueForHash = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValueForHash(entry))
  }
  if (!value || typeof value !== "object") {
    return value ?? null
  }
  const normalized = {}
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    if (key === "generatedAt") continue
    normalized[key] = normalizeJsonValueForHash(value[key])
  }
  return normalized
}

export const buildPerfectPrototypeTokenizerSpecHash = (tokenizerSpec) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(normalizeJsonValueForHash(tokenizerSpec ?? null)))
    .digest("hex")

export const buildPerfectPrototypeTokenizerSpecFingerprintMetadata = (tokenizerSpec) => ({
  tokenizerSpecHash: buildPerfectPrototypeTokenizerSpecHash(tokenizerSpec),
  tokenizerSpecFingerprintVersion: PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
})

export const applyPerfectPrototypeTokenizerSpecFingerprintMetadata = ({
  payload,
  tokenizerSpec,
}) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Tokenizer fingerprint metadata repair requires an object payload.")
  }
  return {
    ...payload,
    ...buildPerfectPrototypeTokenizerSpecFingerprintMetadata(tokenizerSpec),
  }
}

const collectRecordedFingerprint = ({ manifest = null, summary = null, partitionManifest = null }) => {
  const entries = [
    ["manifest.json", manifest],
    ["summary.json", summary],
    ["partition_manifest.json", partitionManifest],
  ]
  return entries
    .filter(([, value]) => value && typeof value === "object")
    .map(([label, value]) => ({
      label,
      hash:
        String(value?.tokenizerSpecHash ?? "")
          .trim()
          .toLowerCase() || null,
      version:
        Number.isInteger(Number(value?.tokenizerSpecFingerprintVersion))
          ? Number(value.tokenizerSpecFingerprintVersion)
          : null,
    }))
}

const repairHint = [
  "Run the explicit repair tool for legacy shard artifacts:",
  "tools/run_server_command.sh node tools/repair_perfect_prototype_index_tokenizer_fingerprint.mjs <index-dir> [<index-dir> ...]",
].join("\n")

export const assertPerfectPrototypeTokenizerSpecIntegrity = ({
  indexDir,
  tokenizerSpec,
  manifest = null,
  summary = null,
  partitionManifest = null,
}) => {
  const resolvedIndexDir = path.resolve(String(indexDir ?? "").trim() || process.cwd())
  const fingerprintRows = collectRecordedFingerprint({
    manifest,
    summary,
    partitionManifest,
  })
  if (fingerprintRows.length < 1) {
    throw new Error(
      [
        "Indexed predictive artifact is missing tokenizer-spec fingerprint metadata.",
        `indexDir=${resolvedIndexDir}`,
        "Rebuild the affected token index so tokenizer_spec.json fingerprint metadata is persisted.",
        repairHint,
      ].join("\n"),
    )
  }
  for (const row of fingerprintRows) {
    if (!row.hash) {
      throw new Error(
        [
          `Indexed predictive artifact ${row.label} is missing tokenizerSpecHash.`,
          `indexDir=${resolvedIndexDir}`,
          "Rebuild the affected token index so tokenizer_spec.json fingerprint metadata is persisted.",
          repairHint,
        ].join("\n"),
      )
    }
    if (row.version !== PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION) {
      throw new Error(
        [
          `Indexed predictive artifact ${row.label} has unsupported tokenizerSpecFingerprintVersion.`,
          `indexDir=${resolvedIndexDir}`,
          `expected=${PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION}`,
          `actual=${row.version ?? "null"}`,
          "Rebuild the affected token index so tokenizer_spec.json fingerprint metadata matches the canonical contract.",
          repairHint,
        ].join("\n"),
      )
    }
  }
  const distinctRecordedHashes = Array.from(new Set(fingerprintRows.map((row) => row.hash)))
  if (distinctRecordedHashes.length !== 1) {
    throw new Error(
      [
        "Indexed predictive artifact recorded inconsistent tokenizerSpecHash values across manifest files.",
        `indexDir=${resolvedIndexDir}`,
        ...fingerprintRows.map((row) => `${row.label}=${row.hash ?? "null"}`),
      ].join("\n"),
    )
  }
  const actualHash = buildPerfectPrototypeTokenizerSpecHash(tokenizerSpec)
  const recordedHash = distinctRecordedHashes[0]
  if (actualHash !== recordedHash) {
    throw new Error(
      [
        "Indexed predictive artifact tokenizer_spec.json hash does not match recorded manifest fingerprint.",
        `indexDir=${resolvedIndexDir}`,
        `recorded=${recordedHash}`,
        `actual=${actualHash}`,
        "Rebuild the affected token index so tokenizer_spec.json and manifest metadata are regenerated together.",
      ].join("\n"),
    )
  }
  return {
    tokenizerSpecHash: actualHash,
    tokenizerSpecFingerprintVersion: PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
  }
}

export const repairPerfectPrototypeIndexedTokenizerFingerprintArtifacts = async ({
  indexDir,
  write = true,
}) => {
  const resolvedIndexDir = path.resolve(String(indexDir ?? "").trim() || process.cwd())
  const tokenizerSpecPath = path.join(resolvedIndexDir, "tokenizer_spec.json")
  const manifestPath = path.join(resolvedIndexDir, "manifest.json")
  const summaryPath = path.join(resolvedIndexDir, "summary.json")
  const partitionManifestPath = path.join(resolvedIndexDir, "partition_manifest.json")

  const tokenizerSpec = await readJsonIfExistsStrict(tokenizerSpecPath)
  if (!tokenizerSpec || typeof tokenizerSpec !== "object") {
    throw new Error(
      [
        "Indexed predictive artifact repair requires tokenizer_spec.json.",
        `indexDir=${resolvedIndexDir}`,
        `tokenizerSpecPath=${tokenizerSpecPath}`,
      ].join("\n"),
    )
  }
  const manifest = await readJsonIfExistsStrict(manifestPath)
  const summary = await readJsonIfExistsStrict(summaryPath)
  if (!manifest || typeof manifest !== "object" || !summary || typeof summary !== "object") {
    throw new Error(
      [
        "Indexed predictive artifact repair requires both manifest.json and summary.json.",
        `indexDir=${resolvedIndexDir}`,
        `manifestPath=${manifestPath}`,
        `summaryPath=${summaryPath}`,
      ].join("\n"),
    )
  }

  const fingerprintMetadata = buildPerfectPrototypeTokenizerSpecFingerprintMetadata(tokenizerSpec)
  const nextManifest = applyPerfectPrototypeTokenizerSpecFingerprintMetadata({
    payload: manifest,
    tokenizerSpec,
  })
  const nextSummary = applyPerfectPrototypeTokenizerSpecFingerprintMetadata({
    payload: summary,
    tokenizerSpec,
  })
  const partitionManifest = pathExists(partitionManifestPath)
    ? await readJsonIfExistsStrict(partitionManifestPath)
    : null
  const nextPartitionManifest =
    partitionManifest && typeof partitionManifest === "object"
      ? applyPerfectPrototypeTokenizerSpecFingerprintMetadata({
          payload: partitionManifest,
          tokenizerSpec,
        })
      : null

  const changedFiles = []
  const maybeWrite = async (filePath, currentValue, nextValue) => {
    if (JSON.stringify(currentValue ?? null) === JSON.stringify(nextValue ?? null)) return
    changedFiles.push(filePath)
    if (write) {
      await writeJsonAtomic(filePath, nextValue)
    }
  }

  await maybeWrite(manifestPath, manifest, nextManifest)
  await maybeWrite(summaryPath, summary, nextSummary)
  if (nextPartitionManifest) {
    await maybeWrite(partitionManifestPath, partitionManifest, nextPartitionManifest)
  }

  return {
    indexDir: resolvedIndexDir,
    tokenizerSpecPath,
    fingerprintMetadata,
    changedFiles,
    repaired: changedFiles.length > 0,
  }
}
