import path from "node:path"

import { pathExists, readJson } from "./io.mjs"

const clamp01 = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

const medianFinite = (values) => {
  const rows = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (rows.length < 1) return 0
  const mid = Math.floor(rows.length / 2)
  if (rows.length % 2 === 1) return rows[mid]
  return (rows[mid - 1] + rows[mid]) / 2
}

export const resolveFamilyPoolPath = (ctx, rawPath) => {
  const raw = String(rawPath ?? "").trim()
  if (!raw) return path.resolve(ctx?.cwd ?? process.cwd(), "meta", "family_pool.json")
  return path.isAbsolute(raw) ? raw : path.resolve(ctx?.cwd ?? process.cwd(), raw)
}

export const resolveFamilyPoolConfig = (config, ctx = null) => {
  const raw = config?.cdLoop?.familyPool ?? {}
  return {
    enabled: raw?.enabled !== false,
    outputPath: resolveFamilyPoolPath(ctx, raw?.outputPath),
    minProductionFamilies: Math.max(1, Math.floor(Number(raw?.minProductionFamilies ?? 1) || 1)),
    productionMinDTargetHitRate: clamp01(raw?.productionMinDTargetHitRate ?? 0.5),
    productionMinETargetHitRate: clamp01(raw?.productionMinETargetHitRate ?? 0.5),
    watchlistMinDTargetHitRate: clamp01(raw?.watchlistMinDTargetHitRate ?? 0.4),
    watchlistMinETargetHitRate: clamp01(raw?.watchlistMinETargetHitRate ?? 0.4),
    minDPickedDays: Math.max(1, Math.floor(Number(raw?.minDPickedDays ?? 8) || 8)),
    minELockboxPicks: Math.max(1, Math.floor(Number(raw?.minELockboxPicks ?? 8) || 8)),
    minEraCoverageRatio: clamp01(raw?.minEraCoverageRatio ?? 0.5),
    minEntropyRatio: clamp01(raw?.minEntropyRatio ?? 0.2),
    requireRepresentativeFamily: raw?.requireRepresentativeFamily === true
  }
}

const normalizeFamilyRollupRow = (row) => {
  if (!row || typeof row !== "object") return null
  const familyId = String(row?.familyId ?? "").trim()
  if (!familyId) return null
  return {
    familyId,
    familyHitRateLockbox: clamp01(row?.familyHitRateLockbox ?? 0),
    familyExecutedHitRateLockbox: clamp01(row?.familyExecutedHitRateLockbox ?? 0),
    familyPickCountLockbox: Math.max(0, Number(row?.familyPickCountLockbox ?? 0) || 0),
    familyExecutedPickCountLockbox: Math.max(0, Number(row?.familyExecutedPickCountLockbox ?? 0) || 0),
    familyTargetHitCountLockbox: Math.max(0, Number(row?.familyTargetHitCountLockbox ?? 0) || 0),
    familyExecutedTargetHitCountLockbox: Math.max(
      0,
      Number(row?.familyExecutedTargetHitCountLockbox ?? 0) || 0,
    ),
    familyStopRateLockbox: clamp01(row?.familyStopRateLockbox ?? 0),
    familyTimeoutNegativeRateLockbox: clamp01(row?.familyTimeoutNegativeRateLockbox ?? 0)
  }
}

export const loadFamilyPoolManifest = async ({ ctx, pathOverride = null } = {}) => {
  const filePath = resolveFamilyPoolPath(ctx, pathOverride ?? ctx?.config?.cdLoop?.familyPool?.outputPath)
  if (!filePath || !pathExists(filePath)) {
    return {
      enabled: false,
      path: filePath,
      manifest: null,
      productionFamilyIds: [],
      watchlistFamilyIds: [],
      rejectedFamilyIds: []
    }
  }
  const manifest = await readJson(filePath, null).catch(() => null)
  if (!manifest || typeof manifest !== "object") {
    return {
      enabled: false,
      path: filePath,
      manifest: null,
      productionFamilyIds: [],
      watchlistFamilyIds: [],
      rejectedFamilyIds: []
    }
  }
  return {
    enabled: manifest?.enabled === true,
    path: filePath,
    manifest,
    productionReady: manifest?.summary?.productionReady === true,
    productionFamilyIds: Array.isArray(manifest?.productionFamilyIds) ? manifest.productionFamilyIds : [],
    watchlistFamilyIds: Array.isArray(manifest?.watchlistFamilyIds) ? manifest.watchlistFamilyIds : [],
    rejectedFamilyIds: Array.isArray(manifest?.rejectedFamilyIds) ? manifest.rejectedFamilyIds : []
  }
}

const buildClassificationReason = ({
  representativeOk,
  dRateOk,
  eRateOk,
  dSampleOk,
  eSampleOk,
  diversityOk,
  eAvailable
}) => {
  if (!representativeOk) return "NOT_C2_REPRESENTATIVE"
  if (!dSampleOk) return "D_SAMPLE_TOO_LOW"
  if (!eAvailable) return "E_FAMILY_METRICS_MISSING"
  if (!eSampleOk) return "E_SAMPLE_TOO_LOW"
  if (!diversityOk) return "DIVERSITY_FLOOR_FAILED"
  if (!dRateOk) return "D_TARGET_HIT_RATE_BELOW_MIN"
  if (!eRateOk) return "E_TARGET_HIT_RATE_BELOW_MIN"
  return "PASS"
}

export const buildFamilyPoolManifest = ({
  c1Results,
  c2Index,
  lockboxFamilyRollups,
  cfg,
  runId = null,
  source = {}
} = {}) => {
  const safeCfg = cfg && typeof cfg === "object" ? cfg : resolveFamilyPoolConfig({})
  const rows = Array.isArray(c1Results) ? c1Results : []
  const representativeSet = new Set(
    (Array.isArray(c2Index?.representativeFamilyIds) ? c2Index.representativeFamilyIds : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )
  const lockboxByFamilyId = new Map(
    (Array.isArray(lockboxFamilyRollups) ? lockboxFamilyRollups : [])
      .map((row) => normalizeFamilyRollupRow(row))
      .filter(Boolean)
      .map((row) => [row.familyId, row]),
  )
  const families = rows
    .map((row) => {
      const familyId = String(row?.familyId ?? "").trim()
      if (!familyId) return null
      const lockbox = lockboxByFamilyId.get(familyId) ?? null
      const representative = representativeSet.size < 1 ? true : representativeSet.has(familyId)
      const dTargetHitRate = clamp01(row?.targetHitRateEval ?? 0)
      const eTargetHitRate = clamp01(lockbox?.familyHitRateLockbox ?? 0)
      const dPickedDays = Math.max(0, Number(row?.pickedDaysEval ?? 0) || 0)
      const ePickedDays = Math.max(0, Number(lockbox?.familyPickCountLockbox ?? 0) || 0)
      const eraCoverageRatio = clamp01(row?.eraCoverageRatioP50Eval ?? 0)
      const entropyRatio = clamp01(row?.clusterTemporalNormalizedEraEntropyP50Eval ?? 0)
      const dSampleOk = dPickedDays >= safeCfg.minDPickedDays
      const eAvailable = !!lockbox
      const eSampleOk = ePickedDays >= safeCfg.minELockboxPicks
      const diversityOk =
        eraCoverageRatio >= safeCfg.minEraCoverageRatio &&
        entropyRatio >= safeCfg.minEntropyRatio
      const representativeOk =
        safeCfg.requireRepresentativeFamily === true ? representative === true : true
      const production =
        representativeOk &&
        dSampleOk &&
        eAvailable &&
        eSampleOk &&
        diversityOk &&
        dTargetHitRate >= safeCfg.productionMinDTargetHitRate &&
        eTargetHitRate >= safeCfg.productionMinETargetHitRate
      const watchlist =
        production !== true &&
        (
          dTargetHitRate >= safeCfg.watchlistMinDTargetHitRate ||
          eTargetHitRate >= safeCfg.watchlistMinETargetHitRate ||
          dSampleOk !== true ||
          eSampleOk !== true
        )
      const status = production ? "PRODUCTION" : watchlist ? "WATCHLIST" : "REJECTED"
      return {
        familyId,
        status,
        reason: buildClassificationReason({
          representativeOk,
          dRateOk: dTargetHitRate >= safeCfg.productionMinDTargetHitRate,
          eRateOk: eTargetHitRate >= safeCfg.productionMinETargetHitRate,
          dSampleOk,
          eSampleOk,
          diversityOk,
          eAvailable
        }),
        c2Representative: representative === true,
        dTargetHitRate,
        dExecutedTargetHitRate: clamp01(row?.executedTargetHitRateEval ?? 0),
        dSelectionHitAt1ResolvedEval: clamp01(
          row?.selectionHitAt1ResolvedEval ?? row?.selectionHitAt1Eval ?? 0,
        ),
        dPickedDays,
        eTargetHitRate,
        eExecutedTargetHitRate: clamp01(lockbox?.familyExecutedHitRateLockbox ?? 0),
        ePickedDays,
        eExecutedPickCount: Math.max(0, Number(lockbox?.familyExecutedPickCountLockbox ?? 0) || 0),
        eStopRate: clamp01(lockbox?.familyStopRateLockbox ?? 0),
        eTimeoutNegativeRate: clamp01(lockbox?.familyTimeoutNegativeRateLockbox ?? 0),
        eraCoverageRatio,
        entropyRatio
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      const statusOrder = { PRODUCTION: 0, WATCHLIST: 1, REJECTED: 2 }
      const byStatus = Number(statusOrder[left.status] ?? 9) - Number(statusOrder[right.status] ?? 9)
      if (byStatus !== 0) return byStatus
      const byD = Number(right?.dTargetHitRate ?? 0) - Number(left?.dTargetHitRate ?? 0)
      if (byD !== 0) return byD
      return String(left?.familyId ?? "").localeCompare(String(right?.familyId ?? ""))
    })

  const productionFamilyIds = families.filter((row) => row.status === "PRODUCTION").map((row) => row.familyId)
  const watchlistFamilyIds = families.filter((row) => row.status === "WATCHLIST").map((row) => row.familyId)
  const rejectedFamilyIds = families.filter((row) => row.status === "REJECTED").map((row) => row.familyId)
  const productionReady = productionFamilyIds.length >= safeCfg.minProductionFamilies
  return {
    version: 1,
    enabled: safeCfg.enabled === true,
    generatedAt: new Date().toISOString(),
    runId: String(runId ?? "").trim() || null,
    source,
    thresholds: {
      minProductionFamilies: safeCfg.minProductionFamilies,
      productionMinDTargetHitRate: safeCfg.productionMinDTargetHitRate,
      productionMinETargetHitRate: safeCfg.productionMinETargetHitRate,
      watchlistMinDTargetHitRate: safeCfg.watchlistMinDTargetHitRate,
      watchlistMinETargetHitRate: safeCfg.watchlistMinETargetHitRate,
      minDPickedDays: safeCfg.minDPickedDays,
      minELockboxPicks: safeCfg.minELockboxPicks,
      minEraCoverageRatio: safeCfg.minEraCoverageRatio,
      minEntropyRatio: safeCfg.minEntropyRatio,
      requireRepresentativeFamily: safeCfg.requireRepresentativeFamily === true
    },
    families,
    productionFamilyIds,
    watchlistFamilyIds,
    rejectedFamilyIds,
    summary: {
      familyCount: families.length,
      minProductionFamilies: safeCfg.minProductionFamilies,
      productionReady,
      productionFamilyCount: productionFamilyIds.length,
      watchlistFamilyCount: watchlistFamilyIds.length,
      rejectedFamilyCount: rejectedFamilyIds.length,
      productionMedianDTargetHitRate: medianFinite(
        families.filter((row) => row.status === "PRODUCTION").map((row) => row.dTargetHitRate),
      ),
      productionMedianETargetHitRate: medianFinite(
        families.filter((row) => row.status === "PRODUCTION").map((row) => row.eTargetHitRate),
      ),
      watchlistMedianDTargetHitRate: medianFinite(
        families.filter((row) => row.status === "WATCHLIST").map((row) => row.dTargetHitRate),
      ),
      watchlistMedianETargetHitRate: medianFinite(
        families.filter((row) => row.status === "WATCHLIST").map((row) => row.eTargetHitRate),
      )
    }
  }
}
