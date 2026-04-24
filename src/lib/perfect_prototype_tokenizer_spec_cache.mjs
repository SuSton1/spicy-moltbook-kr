import path from "node:path"

import { ensureDir, pathExists, readJson, writeJson } from "./io.mjs"
import {
  PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
  buildPerfectPrototypeTokenizerSpecHash,
} from "./perfect_prototype_tokenizer_spec_integrity.mjs"
import { normalizePerfectPrototypeTokenizerCacheInputs } from "./perfect_prototype_tokenizer_contract.mjs"

export const PERFECT_PROTOTYPE_TOKENIZER_SPEC_CACHE_DIRNAME = ".tokenizer-spec-cache"
export const PERFECT_PROTOTYPE_TOKENIZER_SPEC_CACHE_VERSION = 1

const stableJson = (value) => JSON.stringify(value ?? null)

const normalizePathOrNull = (value) => {
  const normalized = String(value ?? "").trim()
  return normalized ? path.resolve(normalized) : null
}

const normalizeTextOrNull = (value) => {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

export const resolvePerfectPrototypeTokenizerSpecCachePath = ({
  featureStoreDir,
  cacheKey,
}) =>
  path.join(
    path.resolve(String(featureStoreDir ?? "").trim()),
    PERFECT_PROTOTYPE_TOKENIZER_SPEC_CACHE_DIRNAME,
    `${String(cacheKey ?? "").trim()}.json`,
  )

export const buildPerfectPrototypeTokenizerSpecCacheEnvelope = ({
  featureStoreDir,
  startDate,
  endDate,
  partitionStateHash,
  tokenizerSpecCacheKey,
  tokenizerSpecCacheInputs,
  tokenizerSpec,
}) => {
  const normalizedFeatureStoreDir = normalizePathOrNull(featureStoreDir)
  const normalizedCacheInputs = normalizePerfectPrototypeTokenizerCacheInputs(tokenizerSpecCacheInputs)
  const tokenizerSpecHash = buildPerfectPrototypeTokenizerSpecHash(tokenizerSpec)
  return {
    version: PERFECT_PROTOTYPE_TOKENIZER_SPEC_CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    featureStoreDir: normalizedFeatureStoreDir,
    startDate: normalizeTextOrNull(startDate),
    endDate: normalizeTextOrNull(endDate),
    partitionStateHash: normalizeTextOrNull(partitionStateHash),
    tokenizerSpecCacheKey: normalizeTextOrNull(tokenizerSpecCacheKey),
    tokenizerSpecCacheInputs: normalizedCacheInputs,
    tokenizerSpecHash,
    tokenizerSpecFingerprintVersion: PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION,
    tokenizerSpec,
  }
}

export const readPerfectPrototypeTokenizerSpecCacheEnvelope = async ({
  featureStoreDir,
  cacheKey,
}) => {
  const cachePath = resolvePerfectPrototypeTokenizerSpecCachePath({
    featureStoreDir,
    cacheKey,
  })
  if (!pathExists(cachePath)) return null
  return {
    cachePath,
    envelope: await readJson(cachePath, null),
  }
}

export const assertPerfectPrototypeTokenizerSpecCacheEnvelopeValid = ({
  cachePath,
  envelope,
  featureStoreDir,
  startDate,
  endDate,
  partitionStateHash,
  tokenizerSpecCacheKey,
  tokenizerSpecCacheInputs,
}) => {
  if (!envelope || typeof envelope !== "object") {
    throw new Error(
      [
        "Predictive tokenizer-spec cache must be an object envelope.",
        `cachePath=${cachePath}`,
      ].join("\n"),
    )
  }
  if (Number(envelope?.version) !== PERFECT_PROTOTYPE_TOKENIZER_SPEC_CACHE_VERSION) {
    throw new Error(
      [
        "Predictive tokenizer-spec cache has unsupported envelope version.",
        `cachePath=${cachePath}`,
        `expected=${PERFECT_PROTOTYPE_TOKENIZER_SPEC_CACHE_VERSION}`,
        `actual=${envelope?.version ?? "null"}`,
      ].join("\n"),
    )
  }
  const expectedFields = [
    ["featureStoreDir", normalizePathOrNull(featureStoreDir), normalizePathOrNull(envelope?.featureStoreDir)],
    ["startDate", normalizeTextOrNull(startDate), normalizeTextOrNull(envelope?.startDate)],
    ["endDate", normalizeTextOrNull(endDate), normalizeTextOrNull(envelope?.endDate)],
    ["partitionStateHash", normalizeTextOrNull(partitionStateHash), normalizeTextOrNull(envelope?.partitionStateHash)],
    ["tokenizerSpecCacheKey", normalizeTextOrNull(tokenizerSpecCacheKey), normalizeTextOrNull(envelope?.tokenizerSpecCacheKey)],
    [
      "tokenizerSpecCacheInputs",
      normalizePerfectPrototypeTokenizerCacheInputs(tokenizerSpecCacheInputs),
      normalizePerfectPrototypeTokenizerCacheInputs(envelope?.tokenizerSpecCacheInputs),
    ],
  ]
  for (const [field, expectedValue, recordedValue] of expectedFields) {
    if (stableJson(expectedValue) !== stableJson(recordedValue)) {
      throw new Error(
        [
          "Predictive tokenizer-spec cache metadata does not match the current canonical provenance.",
          `cachePath=${cachePath}`,
          `field=${field}`,
          `expected=${stableJson(expectedValue)}`,
          `recorded=${stableJson(recordedValue)}`,
        ].join("\n"),
      )
    }
  }
  if (
    Number(envelope?.tokenizerSpecFingerprintVersion) !==
    PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION
  ) {
    throw new Error(
      [
        "Predictive tokenizer-spec cache has unsupported tokenizer fingerprint version.",
        `cachePath=${cachePath}`,
        `expected=${PERFECT_PROTOTYPE_TOKENIZER_SPEC_FINGERPRINT_VERSION}`,
        `actual=${envelope?.tokenizerSpecFingerprintVersion ?? "null"}`,
      ].join("\n"),
    )
  }
  if (!envelope?.tokenizerSpec || typeof envelope.tokenizerSpec !== "object") {
    throw new Error(
      [
        "Predictive tokenizer-spec cache envelope is missing tokenizerSpec.",
        `cachePath=${cachePath}`,
      ].join("\n"),
    )
  }
  const actualTokenizerSpecHash = buildPerfectPrototypeTokenizerSpecHash(envelope.tokenizerSpec)
  if (String(envelope?.tokenizerSpecHash ?? "").trim().toLowerCase() !== actualTokenizerSpecHash) {
    throw new Error(
      [
        "Predictive tokenizer-spec cache tokenizerSpecHash does not match the cached tokenizerSpec payload.",
        `cachePath=${cachePath}`,
        `recorded=${String(envelope?.tokenizerSpecHash ?? "").trim().toLowerCase() || "null"}`,
        `actual=${actualTokenizerSpecHash}`,
      ].join("\n"),
    )
  }
  return {
    cachePath,
    envelope: {
      ...envelope,
      tokenizerSpecHash: actualTokenizerSpecHash,
      tokenizerSpecCacheInputs: normalizePerfectPrototypeTokenizerCacheInputs(
        envelope?.tokenizerSpecCacheInputs,
      ),
    },
  }
}

export const writePerfectPrototypeTokenizerSpecCacheEnvelope = async ({
  featureStoreDir,
  startDate,
  endDate,
  partitionStateHash,
  tokenizerSpecCacheKey,
  tokenizerSpecCacheInputs,
  tokenizerSpec,
}) => {
  const cachePath = resolvePerfectPrototypeTokenizerSpecCachePath({
    featureStoreDir,
    cacheKey: tokenizerSpecCacheKey,
  })
  const envelope = buildPerfectPrototypeTokenizerSpecCacheEnvelope({
    featureStoreDir,
    startDate,
    endDate,
    partitionStateHash,
    tokenizerSpecCacheKey,
    tokenizerSpecCacheInputs,
    tokenizerSpec,
  })
  await ensureDir(path.dirname(cachePath))
  await writeJson(cachePath, envelope)
  return {
    cachePath,
    envelope,
  }
}
