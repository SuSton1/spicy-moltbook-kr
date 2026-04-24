import path from "node:path"

import { pathExists, readJson } from "./io.mjs"

const clamp01 = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

const clampSigned = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < -1) return -1
  if (n > 1) return 1
  return n
}

const normalizeStatus = (value) => {
  const text = String(value ?? "WATCH").trim().toUpperCase()
  if (["CORE", "WATCH", "PENALTY", "QUARANTINE", "RETIRED"].includes(text)) {
    return text
  }
  return "WATCH"
}

export const resolvePrototypeLedgerPath = (ctx, rawPath) => {
  const raw = String(rawPath ?? "").trim()
  if (!raw) {
    return path.resolve(ctx?.cwd ?? process.cwd(), "meta", "prototype_contribution_ledger.json")
  }
  return path.isAbsolute(raw) ? raw : path.resolve(ctx?.cwd ?? process.cwd(), raw)
}

export const loadPrototypeContributionLedger = async ({ ctx, pathOverride = null } = {}) => {
  const filePath = resolvePrototypeLedgerPath(
    ctx,
    pathOverride ??
      ctx?.config?.pattern?.prototypeSelection?.adaptiveFrontier?.prototypeLedgerPath,
  )
  if (!filePath || !pathExists(filePath)) {
    return {
      enabled: false,
      path: filePath,
      manifest: null,
      byId: new Map()
    }
  }
  const manifest = await readJson(filePath, null).catch(() => null)
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : []
  return {
    enabled: true,
    path: filePath,
    manifest,
    byId: new Map(
      entries
        .filter((row) => String(row?.templateId ?? "").trim())
        .map((row) => [String(row.templateId).trim(), row]),
    )
  }
}

const computeCompositeQuality = ({
  hitRate,
  executedHitRate,
  missRate,
  avgRegret,
  familyPassCount,
  familyRepresentativeCount,
  familyProductionCount,
  eraCoverageSupport
}) =>
  clamp01(
    0.28 * clamp01(hitRate) +
      0.16 * clamp01(executedHitRate) +
      0.16 * clamp01(familyPassCount) +
      0.14 * clamp01(familyRepresentativeCount) +
      0.14 * clamp01(familyProductionCount) +
      0.12 * clamp01(eraCoverageSupport) -
      0.1 * clamp01(missRate) -
      0.08 * clamp01((Number(avgRegret ?? 0) || 0) / 0.05),
  )

const computeConfidence = ({
  usageCount,
  familyRepresentativeCount,
  familyProductionCount
}) =>
  clamp01(
    0.6 * Math.min(1, Math.max(0, Number(usageCount ?? 0) || 0) / 12) +
      0.2 * clamp01(familyRepresentativeCount) +
      0.2 * clamp01(familyProductionCount),
  )

const computeNextStatus = ({
  prev,
  hitRate,
  missRate,
  avgRegret,
  confidence,
  familyStatus
}) => {
  const prevStatus = normalizeStatus(prev?.status)
  const prevPenaltyCount = Math.max(0, Number(prev?.penaltyCount ?? 0) || 0)
  const prevQuarantineCount = Math.max(0, Number(prev?.quarantineCount ?? 0) || 0)
  const underperf =
    Number(missRate ?? 0) >= 0.75 &&
    Number(avgRegret ?? 0) >= 0.01
  const nextPenaltyCount = underperf ? prevPenaltyCount + 1 : 0
  const repeatedUnderperf = underperf && (prevStatus === "PENALTY" || prevStatus === "QUARANTINE")
  const nextQuarantineCount =
    repeatedUnderperf ? prevQuarantineCount + 1 : Math.max(0, prevQuarantineCount - 1)
  let status = "WATCH"
  if (familyStatus === "PRODUCTION" && Number(hitRate ?? 0) >= 0.5 && confidence >= 0.55) {
    status = "CORE"
  } else if (prevStatus === "RETIRED") {
    status = "RETIRED"
  } else if (repeatedUnderperf && nextQuarantineCount >= 2) {
    status = "RETIRED"
  } else if (repeatedUnderperf) {
    status = "QUARANTINE"
  } else if (underperf) {
    status = "PENALTY"
  } else {
    status = "WATCH"
  }
  return {
    status,
    penaltyCount: nextPenaltyCount,
    quarantineCount: status === "QUARANTINE" || status === "RETIRED" ? nextQuarantineCount : 0
  }
}

export const buildPrototypeContributionLedger = ({
  library,
  protoMetrics,
  c1Results,
  c2Index,
  familyPool,
  previousLedger,
  runId = null
} = {}) => {
  const metricById = new Map(
    (Array.isArray(protoMetrics) ? protoMetrics : [])
      .filter((row) => String(row?.templateId ?? "").trim())
      .map((row) => [String(row.templateId).trim(), row]),
  )
  const prevById = previousLedger?.byId instanceof Map ? previousLedger.byId : new Map()
  const c1PassedSet = new Set(
    (Array.isArray(c1Results) ? c1Results : [])
      .filter((row) => row?.passed === true)
      .map((row) => String(row?.familyId ?? "").trim())
      .filter(Boolean),
  )
  const representativeSet = new Set(
    (Array.isArray(c2Index?.representativeFamilyIds) ? c2Index.representativeFamilyIds : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )
  const familyRows = Array.isArray(familyPool?.families) ? familyPool.families : []
  const familyStatusById = new Map(
    familyRows
      .map((row) => [String(row?.familyId ?? "").trim(), String(row?.status ?? "").trim().toUpperCase()])
      .filter(([familyId]) => familyId),
  )
  const entries = (Array.isArray(library?.prototypes) ? library.prototypes : [])
    .map((row) => {
      const templateId = String(row?.templateId ?? "").trim()
      if (!templateId) return null
      const familyId = String(row?.c0FamilyId ?? "").trim() || null
      const familyStatus = String(familyStatusById.get(familyId) ?? "REJECTED").trim().toUpperCase()
      const metric = metricById.get(templateId) ?? {}
      const hitRate = clamp01(metric?.hitRate ?? 0)
      const executedHitRate = clamp01(metric?.executedHitRate ?? hitRate)
      const missRate = clamp01(metric?.missRate ?? 0)
      const avgRegret = Number(metric?.avgRegret ?? 0) || 0
      const familyPassCount = familyId && c1PassedSet.has(familyId) ? 1 : 0
      const familyRepresentativeCount = familyId && representativeSet.has(familyId) ? 1 : 0
      const familyProductionCount = familyStatus === "PRODUCTION" ? 1 : 0
      const confidence = computeConfidence({
        usageCount: metric?.usageCount,
        familyRepresentativeCount,
        familyProductionCount
      })
      const prev = prevById.get(templateId) ?? null
      const lifecycle = computeNextStatus({
        prev,
        hitRate,
        missRate,
        avgRegret,
        confidence,
        familyStatus
      })
      const entry = {
        templateId,
        clusterId: String(row?.clusterId ?? "").trim() || null,
        clusterSignature: String(row?.clusterSignature ?? "").trim() || null,
        symbol: String(row?.symbol ?? "").trim() || null,
        selectedEraId: String(row?.selectedEraId ?? "").trim() || null,
        c0FamilyId: familyId,
        usageCount: Math.max(0, Number(metric?.usageCount ?? 0) || 0),
        hitCount: Math.max(0, Number(metric?.hitCount ?? 0) || 0),
        executedHitCount: Math.max(0, Number(metric?.executedHitCount ?? 0) || 0),
        missCount: Math.max(0, Number(metric?.missCount ?? 0) || 0),
        avgRegret,
        gateRejectContribution: Math.max(0, Number(metric?.gateRejectContribution ?? 0) || 0),
        familyPassCount,
        familyRepresentativeCount,
        familyProductionCount,
        agreementSupportScore: clamp01(0.5 + 0.5 * clampSigned(row?.commonAlignmentScore ?? 0)),
        negativeEvidenceScore: clamp01(row?.antiScore ?? 0),
        eraCoverageSupport: clamp01(row?.clusterTemporalEraCoverageRatio ?? 0),
        confidence,
        hitRate,
        executedHitRate,
        missRate,
        compositeQuality: computeCompositeQuality({
          hitRate,
          executedHitRate,
          missRate,
          avgRegret,
          familyPassCount,
          familyRepresentativeCount,
          familyProductionCount,
          eraCoverageSupport: row?.clusterTemporalEraCoverageRatio ?? 0
        }),
        familyStatus,
        status: lifecycle.status,
        penaltyCount: lifecycle.penaltyCount,
        quarantineCount: lifecycle.quarantineCount,
        lastUpdatedRunId: String(runId ?? "").trim() || null,
        updatedAt: new Date().toISOString()
      }
      return entry
    })
    .filter(Boolean)
    .sort((left, right) => String(left?.templateId ?? "").localeCompare(String(right?.templateId ?? "")))
  const statusCounts = entries.reduce((acc, row) => {
    const key = String(row?.status ?? "WATCH").trim().toUpperCase()
    acc[key] = Number(acc[key] ?? 0) + 1
    return acc
  }, {})
  return {
    version: 1,
    enabled: true,
    generatedAt: new Date().toISOString(),
    runId: String(runId ?? "").trim() || null,
    entries,
    summary: {
      prototypeCount: entries.length,
      coreCount: Number(statusCounts.CORE ?? 0),
      watchCount: Number(statusCounts.WATCH ?? 0),
      penaltyCount: Number(statusCounts.PENALTY ?? 0),
      quarantineCount: Number(statusCounts.QUARANTINE ?? 0),
      retiredCount: Number(statusCounts.RETIRED ?? 0)
    }
  }
}
