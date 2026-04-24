import path from "node:path"

import {
  computePerfectPrototypeCatalogHashes,
  resolvePerfectPrototypeSourceRunId,
  PERFECT_PROTOTYPE_CATALOG_CONTRACT_VERSION,
} from "./perfect_prototype_catalog_freeze.mjs"

export const resolvePerfectPrototypeCatalogManifestPath = (catalogPath) =>
  path.join(path.dirname(path.resolve(String(catalogPath ?? "").trim())), "manifest.json")

export const buildPerfectPrototypeCatalogManifest = ({
  catalog,
  catalogPath,
  sourceCatalogPath = null,
} = {}) => {
  const resolvedCatalogPath = path.resolve(String(catalogPath ?? "").trim())
  const hashes = computePerfectPrototypeCatalogHashes(catalog)
  return {
    version: 1,
    generatedAt:
      String(catalog?.metadata?.frozenAt ?? catalog?.generatedAt ?? "").trim() || new Date().toISOString(),
    catalogContractVersion:
      Number(catalog?.metadata?.catalogContractVersion ?? PERFECT_PROTOTYPE_CATALOG_CONTRACT_VERSION) ||
      PERFECT_PROTOTYPE_CATALOG_CONTRACT_VERSION,
    catalogPath: resolvedCatalogPath,
    catalogContentSha256: hashes.catalogContentSha256,
    rulesSha256: hashes.rulesSha256,
    ruleIdsSha256: hashes.ruleIdsSha256,
    sourceCatalogPath:
      String(sourceCatalogPath ?? catalog?.metadata?.sourceCatalogPath ?? "").trim() || null,
    sourceCatalogSha256:
      String(catalog?.metadata?.sourceCatalogSha256 ?? "").trim() || null,
    sourceRunId:
      resolvePerfectPrototypeSourceRunId({
        sourceCatalogPath: sourceCatalogPath ?? catalog?.metadata?.sourceCatalogPath ?? null,
        catalogPath: resolvedCatalogPath,
        metadata: catalog?.metadata,
      }) ?? null,
    trainRange: {
      start: String(catalog?.metadata?.trainStartDate ?? "").trim() || null,
      end: String(catalog?.metadata?.trainEndDate ?? "").trim() || null,
    },
    surface:
      String(catalog?.tokenizerSpec?.surface ?? catalog?.metadata?.surfaceName ?? "").trim() || null,
    maxRuleSize: Number(catalog?.metadata?.maxRuleSize ?? 0) || null,
    maxSeedTokens: Number(catalog?.metadata?.maxSeedTokens ?? 0) || null,
    maxRules: Number(catalog?.metadata?.maxRules ?? 0) || null,
    maxSearchStates: Number(catalog?.metadata?.maxSearchStates ?? 0) || null,
    championRuleId: String(catalog?.champion?.ruleId ?? "").trim() || null,
    ruleCount: Array.isArray(catalog?.rules) ? catalog.rules.length : 0,
    curatedRuleIds: Array.isArray(catalog?.metadata?.curatedRuleIds)
      ? catalog.metadata.curatedRuleIds.slice()
      : null,
    selectionIntent:
      String(catalog?.metadata?.selectionIntent ?? "").trim() || null,
    selectionProfileId:
      String(catalog?.metadata?.selectionProfileId ?? "").trim() || null,
    selectionLeaderboardSha256:
      String(catalog?.metadata?.selectionLeaderboardSha256 ?? "").trim() || null,
    selectionBaselineManifestSha256:
      String(catalog?.metadata?.selectionBaselineManifestSha256 ?? "").trim() || null,
    selectionProfileVersion:
      String(catalog?.metadata?.selectionProfileVersion ?? "").trim() || null,
    selectionTrainWindow:
      catalog?.metadata?.selectionTrainWindow && typeof catalog.metadata.selectionTrainWindow === "object"
        ? {
            start: String(catalog.metadata.selectionTrainWindow?.start ?? "").trim() || null,
            end: String(catalog.metadata.selectionTrainWindow?.end ?? "").trim() || null,
          }
        : null,
    selectionOosWindow:
      catalog?.metadata?.selectionOosWindow && typeof catalog.metadata.selectionOosWindow === "object"
        ? {
            start: String(catalog.metadata.selectionOosWindow?.start ?? "").trim() || null,
            end: String(catalog.metadata.selectionOosWindow?.end ?? "").trim() || null,
          }
        : null,
    selectionLineId:
      String(catalog?.metadata?.selectionLineId ?? "").trim() || null,
    selectionSurface:
      String(catalog?.metadata?.selectionSurface ?? "").trim() || null,
    selectionMode:
      String(catalog?.metadata?.selectionMode ?? "").trim() || null,
    thresholdProfile:
      String(catalog?.metadata?.thresholdProfile ?? "").trim() || null,
    datasetContract:
      catalog?.metadata?.datasetContract && typeof catalog.metadata.datasetContract === "object"
        ? { ...catalog.metadata.datasetContract }
        : null,
    baselineLineId:
      String(catalog?.metadata?.datasetContract?.baselineLineId ?? "").trim() || null,
    discoveryUniverseId:
      String(catalog?.metadata?.datasetContract?.discoveryUniverseId ?? "").trim() || null,
    requestedLookbackTradingDays:
      Number(catalog?.metadata?.datasetContract?.requestedLookbackTradingDays ?? 0) || null,
    enabledRecentImpulseLanes:
      Array.isArray(catalog?.metadata?.datasetContract?.enabledRecentImpulseLanes)
        ? catalog.metadata.datasetContract.enabledRecentImpulseLanes.slice()
        : null,
    allowedStepALanes:
      Array.isArray(catalog?.metadata?.datasetContract?.allowedStepALanes)
        ? catalog.metadata.datasetContract.allowedStepALanes.slice()
        : null,
    includeSameDayHigh8:
      catalog?.metadata?.datasetContract?.includeSameDayHigh8 === true
        ? true
        : catalog?.metadata?.datasetContract?.includeSameDayHigh8 === false
          ? false
          : null,
  }
}
