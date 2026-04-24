import crypto from "node:crypto"
import path from "node:path"

import { pickChampionPerfectPrototypeRule, rankPerfectPrototypeRules } from "./perfect_prototype_rule.mjs"

export const PERFECT_PROTOTYPE_CATALOG_CONTRACT_VERSION = 1

const GENERIC_FROZEN_ROOT_SEGMENT = "/artifacts/curated/frozen/"
const PREDICTIVE_FROZEN_ROOT_SEGMENT = "/artifacts/curated/prejump_frozen/"

const FREEZE_METADATA_KEYS = new Set([
  "catalogContractVersion",
  "catalogContentSha256",
  "rulesSha256",
  "ruleIdsSha256",
  "sourceCatalogSha256",
  "sourceRunId",
  "frozenAt",
  "selectionModeIntent",
])

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item))
  }
  if (value && typeof value === "object") {
    const out = {}
    for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      out[key] = canonicalize(value[key])
    }
    return out
  }
  return value
}

export const stableStringifyPerfectPrototypeCatalog = (value) => JSON.stringify(canonicalize(value))

const sha256 = (value) =>
  crypto.createHash("sha256").update(stableStringifyPerfectPrototypeCatalog(value ?? null)).digest("hex")

const stripFreezeMetadata = (metadata) => {
  const next = { ...(metadata && typeof metadata === "object" ? metadata : {}) }
  for (const key of FREEZE_METADATA_KEYS) {
    delete next[key]
  }
  return next
}

export const stripPerfectPrototypeRuleInternals = (rule) => {
  const next = { ...(rule && typeof rule === "object" ? rule : {}) }
  delete next.matchRowIndexes
  delete next.positiveMatchRowIndexes
  delete next.negativeMatchRowIndexes
  return next
}

export const normalizePerfectPrototypeCatalogRules = (rules) =>
  rankPerfectPrototypeRules((Array.isArray(rules) ? rules : []).map((rule) => stripPerfectPrototypeRuleInternals(rule)))

export const buildPerfectPrototypeCatalogContentSnapshot = (catalog) => {
  const rankedRules = normalizePerfectPrototypeCatalogRules(catalog?.rules)
  const champion = rankedRules.length > 0 ? stripPerfectPrototypeRuleInternals(pickChampionPerfectPrototypeRule(rankedRules)) : null
  return {
    version: Number(catalog?.version ?? 1) || 1,
    tokenizerSpec: catalog?.tokenizerSpec ?? null,
    metadata: stripFreezeMetadata(catalog?.metadata),
    summary: catalog?.summary ?? null,
    champion,
    rules: rankedRules,
  }
}

export const computePerfectPrototypeCatalogHashes = (catalog) => {
  const contentSnapshot = buildPerfectPrototypeCatalogContentSnapshot(catalog)
  const ruleIds = contentSnapshot.rules.map((rule) => String(rule?.ruleId ?? "").trim()).filter(Boolean)
  return {
    contentSnapshot,
    catalogContentSha256: sha256(contentSnapshot),
    rulesSha256: sha256(contentSnapshot.rules),
    ruleIdsSha256: sha256(ruleIds),
  }
}

export const resolvePerfectPrototypeSourceRunId = ({
  sourceRunId = null,
  sourceCatalogPath = null,
  catalogPath = null,
  metadata = null,
} = {}) => {
  const direct = String(
    sourceRunId ??
      metadata?.sourceRunId ??
      metadata?.runId ??
      metadata?.outRunId ??
      metadata?.sourceRunID ??
      "",
  ).trim()
  if (direct) return direct
  for (const candidate of [sourceCatalogPath, catalogPath]) {
    const normalized = String(candidate ?? "").trim()
    if (!normalized) continue
    const match = normalized.match(/[/\\]artifacts[/\\]runs[/\\]([^/\\]+)[/\\]/)
    if (match?.[1]) {
      return match[1]
    }
  }
  return null
}

export const isPerfectPrototypeFrozenCatalogPath = (filePath) => {
  const normalized = path.resolve(String(filePath ?? "").trim()).replaceAll("\\", "/")
  return (
    normalized.includes(PREDICTIVE_FROZEN_ROOT_SEGMENT) ||
    normalized.includes(GENERIC_FROZEN_ROOT_SEGMENT)
  )
}

export const buildDefaultPerfectPrototypeFrozenCatalogPath = ({
  cwd = process.cwd(),
  sourceCatalogPath = null,
  sourceRunId = null,
  sourceCatalog = null,
  sourceSurface = null,
  ruleIds = null,
  selectionLeaderboardSha256 = null,
  selectionProfileId = null,
} = {}) => {
  const resolvedSourceRunId =
    resolvePerfectPrototypeSourceRunId({
      sourceRunId,
      sourceCatalogPath,
      metadata: sourceCatalog?.metadata ?? null,
    }) ?? "manual"
  const surface = String(sourceSurface ?? sourceCatalog?.tokenizerSpec?.surface ?? "").trim().toLowerCase()
  const rootDir =
    surface === "v5_prejump_contextual"
      ? path.join(cwd, "artifacts", "curated", "prejump_frozen")
      : path.join(cwd, "artifacts", "curated", "frozen")
  const normalizedRuleIds = Array.from(
    new Set((Array.isArray(ruleIds) ? ruleIds : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))
  const sourceCatalogSha =
    String(sourceCatalog?.metadata?.catalogContentSha256 ?? sourceCatalog?.freeze?.catalogContentSha256 ?? "").trim() ||
    null
  const normalizedSelectionLeaderboardSha256 = String(selectionLeaderboardSha256 ?? "").trim() || null
  const normalizedSelectionProfileId = String(selectionProfileId ?? "").trim() || null
  const frozenSelectionId =
    normalizedRuleIds.length > 0
      ? sha256({
          ruleIds: normalizedRuleIds,
          sourceCatalogSha: sourceCatalogSha ?? null,
          selectionLeaderboardSha256: normalizedSelectionLeaderboardSha256,
          selectionProfileId: normalizedSelectionProfileId,
        }).slice(0, 16)
      : null
  return frozenSelectionId
    ? path.join(rootDir, resolvedSourceRunId, frozenSelectionId, "catalog.json")
    : path.join(rootDir, resolvedSourceRunId, "catalog.json")
}

export const assertPerfectPrototypeFrozenCatalogOutputPath = ({
  outPath,
  allowMutableOutput = false,
  sourceSurface = null,
}) => {
  if (allowMutableOutput === true) return
  const surface = String(sourceSurface ?? "").trim().toLowerCase()
  const normalized = path.resolve(String(outPath ?? "").trim()).replaceAll("\\", "/")
  const predictive = surface === "v5_prejump_contextual"
  const inAllowedFrozenRoot = predictive
    ? normalized.includes(PREDICTIVE_FROZEN_ROOT_SEGMENT)
    : normalized.includes(GENERIC_FROZEN_ROOT_SEGMENT) || normalized.includes(PREDICTIVE_FROZEN_ROOT_SEGMENT)
  if (!inAllowedFrozenRoot) {
    throw new Error(
      [
        predictive
          ? "Predictive curated catalog output must use an immutable frozen path under artifacts/curated/prejump_frozen/."
          : "Curated catalog output must use an immutable frozen path under artifacts/curated/frozen/.",
        `outPath=${path.resolve(String(outPath ?? "").trim())}`,
        "If you intentionally need a mutable path, rerun with --allow-mutable-output=true.",
      ].join(" "),
    )
  }
}

export const applyPerfectPrototypeCatalogFreezeMetadata = ({
  catalog,
  sourceCatalog = null,
  sourceCatalogPath = null,
  sourceRunId = null,
  frozenAt = null,
  selectionModeIntent = null,
  selectionIntent = null,
  selectionProfileId = null,
  selectionLeaderboardSha256 = null,
  selectionBaselineManifestSha256 = null,
  selectionProfileVersion = null,
  selectionTrainWindow = null,
  selectionOosWindow = null,
  selectionLineId = null,
  selectionSurface = null,
  selectionMode = null,
  thresholdProfile = null,
} = {}) => {
  const frozenCatalog = {
    ...(catalog && typeof catalog === "object" ? catalog : {}),
    metadata: { ...(catalog?.metadata && typeof catalog.metadata === "object" ? catalog.metadata : {}) },
  }
  const sourceCatalogHashes = sourceCatalog ? computePerfectPrototypeCatalogHashes(sourceCatalog) : null
  const nextMetadata = {
    ...frozenCatalog.metadata,
    sourceCatalogSha256:
      String(
        sourceCatalogHashes?.catalogContentSha256 ??
          frozenCatalog.metadata?.sourceCatalogSha256 ??
          "",
      ).trim() || null,
    sourceRunId:
      resolvePerfectPrototypeSourceRunId({
        sourceRunId,
        sourceCatalogPath,
        metadata: frozenCatalog.metadata,
      }) ?? null,
    frozenAt:
      String(frozenAt ?? frozenCatalog.metadata?.frozenAt ?? frozenCatalog.generatedAt ?? "").trim() ||
      new Date().toISOString(),
    selectionModeIntent:
      String(selectionModeIntent ?? frozenCatalog.metadata?.selectionModeIntent ?? "").trim() || null,
    selectionIntent:
      String(selectionIntent ?? frozenCatalog.metadata?.selectionIntent ?? "").trim() || null,
    selectionProfileId:
      String(selectionProfileId ?? frozenCatalog.metadata?.selectionProfileId ?? "").trim() || null,
    selectionLeaderboardSha256:
      String(selectionLeaderboardSha256 ?? frozenCatalog.metadata?.selectionLeaderboardSha256 ?? "").trim() || null,
    selectionBaselineManifestSha256:
      String(
        selectionBaselineManifestSha256 ?? frozenCatalog.metadata?.selectionBaselineManifestSha256 ?? "",
      ).trim() || null,
    selectionProfileVersion:
      String(selectionProfileVersion ?? frozenCatalog.metadata?.selectionProfileVersion ?? "").trim() || null,
    selectionTrainWindow:
      selectionTrainWindow && typeof selectionTrainWindow === "object"
        ? {
            start: String(selectionTrainWindow?.start ?? "").trim() || null,
            end: String(selectionTrainWindow?.end ?? "").trim() || null,
          }
        : frozenCatalog.metadata?.selectionTrainWindow ?? null,
    selectionOosWindow:
      selectionOosWindow && typeof selectionOosWindow === "object"
        ? {
            start: String(selectionOosWindow?.start ?? "").trim() || null,
            end: String(selectionOosWindow?.end ?? "").trim() || null,
          }
        : frozenCatalog.metadata?.selectionOosWindow ?? null,
    selectionLineId:
      String(selectionLineId ?? frozenCatalog.metadata?.selectionLineId ?? "").trim() || null,
    selectionSurface:
      String(selectionSurface ?? frozenCatalog.metadata?.selectionSurface ?? "").trim() || null,
    selectionMode:
      String(selectionMode ?? frozenCatalog.metadata?.selectionMode ?? "").trim() || null,
    thresholdProfile:
      String(thresholdProfile ?? frozenCatalog.metadata?.thresholdProfile ?? "").trim() || null,
  }
  frozenCatalog.metadata = nextMetadata
  const hashes = computePerfectPrototypeCatalogHashes(frozenCatalog)
  frozenCatalog.metadata = {
    ...nextMetadata,
    catalogContractVersion: PERFECT_PROTOTYPE_CATALOG_CONTRACT_VERSION,
    catalogContentSha256: hashes.catalogContentSha256,
    rulesSha256: hashes.rulesSha256,
    ruleIdsSha256: hashes.ruleIdsSha256,
  }
  return frozenCatalog
}

export const normalizeLoadedPerfectPrototypeCatalog = ({
  catalog,
  catalogPath = null,
  expectedCatalogSha256 = null,
  expectedRuleIdsSha256 = null,
  requireFrozen = false,
} = {}) => {
  if (!catalog || typeof catalog !== "object") {
    throw new Error(`Perfect prototype catalog invalid JSON: ${catalogPath ?? "unknown"}`)
  }
  const rankedRules = normalizePerfectPrototypeCatalogRules(catalog.rules)
  const champion = rankedRules.length > 0 ? stripPerfectPrototypeRuleInternals(pickChampionPerfectPrototypeRule(rankedRules)) : null
  const normalizedCatalog = {
    ...catalog,
    path: catalogPath ? path.resolve(catalogPath) : catalog?.path ?? null,
    champion,
    rules: rankedRules,
    metadata: { ...(catalog?.metadata && typeof catalog.metadata === "object" ? catalog.metadata : {}) },
  }
  const hashes = computePerfectPrototypeCatalogHashes(normalizedCatalog)
  const storedVersion = normalizedCatalog.metadata?.catalogContractVersion
  if (requireFrozen && storedVersion == null) {
    throw new Error(
      [
        "Predictive catalog is missing frozen contract metadata.",
        `catalog=${normalizedCatalog.path ?? catalogPath ?? "unknown"}`,
        "Rebuild or freeze the catalog before OOS/apply/live.",
      ].join(" "),
    )
  }
  if (storedVersion != null && Number(storedVersion) !== PERFECT_PROTOTYPE_CATALOG_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported perfect prototype catalog contract version: ${storedVersion} catalog=${normalizedCatalog.path ?? catalogPath ?? "unknown"}`,
    )
  }
  if (storedVersion != null) {
    const storedCatalogSha = String(normalizedCatalog.metadata?.catalogContentSha256 ?? "").trim()
    const storedRulesSha = String(normalizedCatalog.metadata?.rulesSha256 ?? "").trim()
    const storedRuleIdsSha = String(normalizedCatalog.metadata?.ruleIdsSha256 ?? "").trim()
    if (!storedCatalogSha || !storedRulesSha || !storedRuleIdsSha) {
      throw new Error(
        `Perfect prototype catalog freeze metadata is incomplete: ${normalizedCatalog.path ?? catalogPath ?? "unknown"}`,
      )
    }
    if (storedCatalogSha !== hashes.catalogContentSha256) {
      throw new Error(
        `Perfect prototype catalog content hash mismatch: expected=${storedCatalogSha} actual=${hashes.catalogContentSha256} catalog=${normalizedCatalog.path ?? catalogPath ?? "unknown"}`,
      )
    }
    if (storedRulesSha !== hashes.rulesSha256) {
      throw new Error(
        `Perfect prototype catalog rule hash mismatch: expected=${storedRulesSha} actual=${hashes.rulesSha256} catalog=${normalizedCatalog.path ?? catalogPath ?? "unknown"}`,
      )
    }
    if (storedRuleIdsSha !== hashes.ruleIdsSha256) {
      throw new Error(
        `Perfect prototype catalog rule-id hash mismatch: expected=${storedRuleIdsSha} actual=${hashes.ruleIdsSha256} catalog=${normalizedCatalog.path ?? catalogPath ?? "unknown"}`,
      )
    }
  }
  const expectedCatalogHash = String(expectedCatalogSha256 ?? "").trim()
  if (expectedCatalogHash && expectedCatalogHash !== hashes.catalogContentSha256) {
    throw new Error(
      `Perfect prototype catalog does not match expected catalog hash: expected=${expectedCatalogHash} actual=${hashes.catalogContentSha256} catalog=${normalizedCatalog.path ?? catalogPath ?? "unknown"}`,
    )
  }
  const expectedRuleIdsHash = String(expectedRuleIdsSha256 ?? "").trim()
  if (expectedRuleIdsHash && expectedRuleIdsHash !== hashes.ruleIdsSha256) {
    throw new Error(
      `Perfect prototype catalog does not match expected rule-id hash: expected=${expectedRuleIdsHash} actual=${hashes.ruleIdsSha256} catalog=${normalizedCatalog.path ?? catalogPath ?? "unknown"}`,
    )
  }
  return {
    ...normalizedCatalog,
    freeze: {
      catalogContractVersion:
        storedVersion != null ? Number(storedVersion) : PERFECT_PROTOTYPE_CATALOG_CONTRACT_VERSION,
      catalogContentSha256: hashes.catalogContentSha256,
      rulesSha256: hashes.rulesSha256,
      ruleIdsSha256: hashes.ruleIdsSha256,
      sourceCatalogSha256:
        String(normalizedCatalog.metadata?.sourceCatalogSha256 ?? "").trim() || null,
      sourceRunId:
        resolvePerfectPrototypeSourceRunId({
          catalogPath: normalizedCatalog.path,
          metadata: normalizedCatalog.metadata,
        }) ?? null,
      frozenAt: String(normalizedCatalog.metadata?.frozenAt ?? "").trim() || null,
      verified: storedVersion != null,
    },
  }
}
