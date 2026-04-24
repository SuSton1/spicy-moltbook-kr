import path from "node:path"
import fsp from "node:fs/promises"

import { resolveGlobalWindow, resolveLocalWindow } from "../lib/config.mjs"
import {
  readDropRegistry,
  resolveEffectiveDropTemplateIds
} from "../lib/drop_registry.mjs"
import { loadFamilyPoolManifest } from "../lib/family_pool.mjs"
import { dequantizeSequence, resolveStepCInputPath } from "../lib/lightweight.mjs"
import { GROUPS, quantile } from "../lib/similarity.mjs"
import { ensureDir, pathExists, readJson, readJsonl, writeJson } from "../lib/io.mjs"
import { loadPrototypeContributionLedger } from "../lib/prototype_ledger.mjs"
import { buildSelectionHitAt1Snapshot } from "../lib/selection_metric.mjs"
import { buildStepCIndexManifest } from "./step_c_index_builder.mjs"
import { buildStepCShapingStateManifest } from "./step_c_shaping_state.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const mean = (values) => {
  const list = (values ?? []).map(num).filter(Number.isFinite)
  if (!list.length) return null
  return list.reduce((acc, v) => acc + v, 0) / list.length
}

const stdev = (values) => {
  const list = (values ?? []).map(num).filter(Number.isFinite)
  if (list.length < 2) return null
  const m = mean(list)
  const v = list.reduce((acc, x) => acc + (x - m) ** 2, 0) / list.length
  return Math.sqrt(v)
}

const normalizeFeatureVec = (featureVec) => {
  const out = {}
  for (const [key, value] of Object.entries(featureVec ?? {})) {
    out[key] = num(value)
  }
  return out
}

const resolveC0Config = (config) => {
  const raw = config?.pattern?.c0 ?? {}
  return {
    enabled: raw?.enabled === true,
    minFamilySupport: Math.max(1, Math.floor(Number(raw?.minFamilySupport ?? 6) || 6)),
    familyBackfillFloor: Math.max(1, Math.floor(Number(raw?.familyBackfillFloor ?? 10) || 10)),
    familyBackfillMax: Math.max(0, Math.floor(Number(raw?.familyBackfillMax ?? 8) || 8))
  }
}

const resolveC1Config = (config) => {
  const raw = config?.pattern?.c1 ?? {}
  return {
    enabled: raw?.enabled === true,
    familyBackfillFloor: Math.max(1, Math.floor(Number(raw?.familyBackfillFloor ?? 4) || 4)),
    probeScope: String(raw?.probeScope ?? "update").trim().toLowerCase() || "update",
    probeProfile: String(raw?.probeProfile ?? "C1_FAMILY_PROBE").trim() || "C1_FAMILY_PROBE"
  }
}

const resolveC2Config = (config) => {
  const raw = config?.pattern?.c2 ?? {}
  return {
    enabled: raw?.enabled === true,
    minRepresentativeFamilies: Math.max(
      1,
      Math.floor(Number(raw?.minRepresentativeFamilies ?? 2) || 2),
    ),
    representativePolicy:
      String(raw?.representativePolicy ?? "quality_first_with_coverage_guard").trim() ||
      "quality_first_with_coverage_guard",
    similarityPolicyVersion:
      String(raw?.similarityPolicyVersion ?? "c2_overlap_graph_v1").trim() || "c2_overlap_graph_v1"
  }
}

const loadStepC0FamilyIndex = async (ctx, stepBSourceRunDir) => {
  const c0Cfg = resolveC0Config(ctx.config)
  if (c0Cfg.enabled !== true) {
    return {
      cfg: c0Cfg,
      enabled: false,
      index: null,
      membershipByTemplateId: new Map(),
      familyById: new Map(),
      sourceDir: null
    }
  }
  const dirs = [
    path.join(ctx.runDir, "step-c0"),
    stepBSourceRunDir && String(stepBSourceRunDir) !== String(ctx.runDir)
      ? path.join(stepBSourceRunDir, "step-c0")
      : null
  ].filter(Boolean)
  for (const dir of dirs) {
    const familyIndexPath = path.join(dir, "c0_family_index.json")
    const membershipPath = path.join(dir, "c0_family_membership.jsonl")
    if (!pathExists(familyIndexPath)) continue
    const index = await readJson(familyIndexPath, null)
    if (!index || typeof index !== "object") continue
    const membershipRows = await readJsonl(membershipPath)
    return {
      cfg: c0Cfg,
      enabled: true,
      index,
      membershipByTemplateId: new Map(
        membershipRows.map((row) => [String(row?.templateId ?? "").trim(), row]),
      ),
      familyById: new Map(
        (index?.families ?? []).map((row) => [String(row?.familyId ?? "").trim(), row]),
      ),
      sourceDir: dir
    }
  }
  return {
    cfg: c0Cfg,
    enabled: true,
    index: null,
    membershipByTemplateId: new Map(),
    familyById: new Map(),
    sourceDir: null
  }
}

const annotateTemplatesWithC0 = ({ templates, membershipByTemplateId, familyById }) =>
  (templates ?? []).map((row) => {
    const membership = membershipByTemplateId?.get(String(row?.templateId ?? "").trim()) ?? null
    const family = familyById?.get(String(membership?.familyId ?? "").trim()) ?? null
    const familyStatus = String(membership?.familyStatus ?? family?.status ?? "").trim() || null
    return {
      ...row,
      c0FamilyId: membership?.familyId ?? null,
      c0FamilySignature: membership?.familySignature ?? family?.signature ?? null,
      c0Score: Number(membership?.c0Score ?? family?.c0Score ?? 0) || 0,
      c0Shortlisted: membership?.shortlisted === true,
      c0FamilySupport: Number(family?.support ?? 0) || 0,
      c0CorePrototypeShare: Number(family?.corePrototypeShare ?? 0) || 0,
      c0PenaltyPrototypeShare: Number(family?.penaltyPrototypeShare ?? 0) || 0,
      c0QuarantinePrototypeShare: Number(family?.quarantinePrototypeShare ?? 0) || 0,
      c0PrototypeQualityMedian: Number(family?.prototypeQualityMedian ?? 0) || 0,
      c0FamilyRank: Number(membership?.familyRank ?? 0) || null,
      c0FamilyStatus: familyStatus,
      c0BackfillEligible:
        familyStatus === "SHORTLIST" ||
        familyStatus === "SHORTLIST_BACKFILL" ||
        familyStatus === "NEAR_THRESHOLD"
    }
  })

const collectUniqueFamilyIdsFromTemplates = (templates) =>
  Array.from(
    new Set(
      (Array.isArray(templates) ? templates : [])
        .map((row) => String(row?.c0FamilyId ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const filterTemplatesByC0Shortlist = ({ templates, familyIndexPack, runtimeAllowedFamilyIds }) => {
  const safeTemplates = Array.isArray(templates) ? templates : []
  const c0Cfg = familyIndexPack?.cfg ?? resolveC0Config({})
  if (familyIndexPack?.enabled !== true) {
    return {
      templates: safeTemplates,
      summary: {
        enabled: false,
        c0FamilyCount: 0,
        c0ShortlistedFamilyCount: 0,
        c0NominalShortlistedFamilyIds: [],
        c0EffectiveFamilyIds: [],
        c0EffectiveSource: "DISABLED",
        c0AcceptedTemplateCount: safeTemplates.length,
        c0RejectedTemplateCount: 0,
        c0FallbackUsed: false,
        c0GateFailed: false,
        c0SourceDir: null
      }
    }
  }
  const index = familyIndexPack?.index
  if (!index || typeof index !== "object") {
    return {
      templates: safeTemplates,
      summary: {
        enabled: true,
        c0FamilyCount: 0,
        c0ShortlistedFamilyCount: 0,
        c0NominalShortlistedFamilyIds: [],
        c0EffectiveFamilyIds: [],
        c0EffectiveSource: "INDEX_MISSING",
        c0AcceptedTemplateCount: safeTemplates.length,
        c0RejectedTemplateCount: 0,
        c0FallbackUsed: true,
        c0GateFailed: true,
        c0SourceDir: familyIndexPack?.sourceDir ?? null
      }
    }
  }
  const shortlistedFamilies = (index?.families ?? []).filter((row) => row?.shortlisted === true)
  const shortlistedFamilyIds = shortlistedFamilies
    .map((row) => String(row?.familyId ?? "").trim())
    .filter(Boolean)
  const forcedFamilyIds = Array.isArray(runtimeAllowedFamilyIds)
    ? runtimeAllowedFamilyIds.map((value) => String(value ?? "").trim()).filter(Boolean)
    : []
  if (forcedFamilyIds.length > 0) {
    const forcedFamilySet = new Set(forcedFamilyIds)
    const nextTemplates = safeTemplates.filter((row) =>
      forcedFamilySet.has(String(row?.c0FamilyId ?? "").trim()),
    )
    const acceptedIds = new Set(nextTemplates.map((row) => String(row?.templateId ?? "").trim()))
    const effectiveFamilyIds = collectUniqueFamilyIdsFromTemplates(nextTemplates)
    return {
      templates: nextTemplates,
      summary: {
        enabled: true,
        c0FamilyCount: Number(index?.familyCount ?? (index?.families ?? []).length) || 0,
        c0ShortlistedFamilyCount: Number(index?.shortlistedFamilyCount ?? shortlistedFamilies.length) || 0,
        c0NominalShortlistedFamilyIds: shortlistedFamilyIds,
        c0EffectiveFamilyIds: effectiveFamilyIds,
        c0EffectiveSource: "RUNTIME_FORCED_FAMILY_IDS",
        c0AcceptedTemplateCount: nextTemplates.length,
        c0RejectedTemplateCount: Math.max(0, safeTemplates.length - acceptedIds.size),
        c0FallbackUsed: false,
        c0GateFailed: false,
        c0SourceDir: familyIndexPack?.sourceDir ?? null
      }
    }
  }
  const shortlistedTemplates = safeTemplates.filter((row) => row?.c0Shortlisted === true)
  const shortlistTooSmall =
    shortlistedFamilies.length < Math.max(1, c0Cfg.familyBackfillFloor) ||
    shortlistedTemplates.length < Math.max(c0Cfg.minFamilySupport, shortlistedFamilies.length)
  const gateFailed = index?.c0Gate?.failed === true
  let nextTemplates = shortlistedTemplates
  let fallbackUsed = false
  let effectiveSource = "C0_SHORTLIST"
  if (gateFailed || shortlistTooSmall) {
    fallbackUsed = true
    const backfillCap = Math.max(
      shortlistedTemplates.length,
      c0Cfg.familyBackfillMax * Math.max(1, c0Cfg.minFamilySupport),
    )
    const extras = safeTemplates
      .filter((row) => row?.c0Shortlisted !== true && row?.c0BackfillEligible === true)
      .slice()
      .sort((left, right) => Number(right?.c0Score ?? 0) - Number(left?.c0Score ?? 0))
      .slice(0, backfillCap)
    nextTemplates = shortlistedTemplates.concat(extras)
    effectiveSource = "C0_BACKFILL"
    if (!nextTemplates.length) {
      const c0SafeFallback = safeTemplates.filter((row) => row?.c0BackfillEligible === true)
      if (c0SafeFallback.length > 0) {
        nextTemplates = c0SafeFallback
        effectiveSource = "C0_RELAXED_FALLBACK"
      } else {
        nextTemplates = safeTemplates
        effectiveSource = "FULL_TEMPLATE_FALLBACK"
      }
    }
  }
  const acceptedIds = new Set(nextTemplates.map((row) => String(row?.templateId ?? "").trim()))
  const effectiveFamilyIds = collectUniqueFamilyIdsFromTemplates(nextTemplates)
  return {
    templates: nextTemplates,
    summary: {
      enabled: true,
      c0FamilyCount: Number(index?.familyCount ?? (index?.families ?? []).length) || 0,
      c0ShortlistedFamilyCount: Number(index?.shortlistedFamilyCount ?? shortlistedFamilies.length) || 0,
      c0NominalShortlistedFamilyIds: shortlistedFamilyIds,
      c0EffectiveFamilyIds: effectiveFamilyIds,
      c0EffectiveSource: effectiveSource,
      c0AcceptedTemplateCount: nextTemplates.length,
      c0RejectedTemplateCount: Math.max(0, safeTemplates.length - acceptedIds.size),
      c0FallbackUsed: fallbackUsed,
      c0GateFailed: gateFailed,
      c0SourceDir: familyIndexPack?.sourceDir ?? null
    }
  }
}

const loadStepC1FamilyProbeIndex = async (ctx, stepBSourceRunDir) => {
  const c1Cfg = resolveC1Config(ctx.config)
  if (c1Cfg.enabled !== true) {
    return {
      cfg: c1Cfg,
      enabled: false,
      index: null,
      sourceDir: null
    }
  }
  const dirs = [
    path.join(ctx.runDir, "step-c1"),
    stepBSourceRunDir && String(stepBSourceRunDir) !== String(ctx.runDir)
      ? path.join(stepBSourceRunDir, "step-c1")
      : null
  ].filter(Boolean)
  for (const dir of dirs) {
    const indexPath = path.join(dir, "c1_family_probe_index.json")
    if (!pathExists(indexPath)) continue
    const index = await readJson(indexPath, null)
    if (!index || typeof index !== "object") continue
    return {
      cfg: c1Cfg,
      enabled: true,
      index,
      sourceDir: dir
    }
  }
  return {
    cfg: c1Cfg,
    enabled: true,
    index: null,
    sourceDir: null
  }
}

const loadStepC2DedupIndex = async (ctx, stepBSourceRunDir) => {
  const c2Cfg = resolveC2Config(ctx.config)
  if (c2Cfg.enabled !== true || ctx?.__runtime?.familyProbeMode === true) {
    return {
      cfg: c2Cfg,
      enabled: false,
      index: null,
      sourceDir: null
    }
  }
  const dirs = [
    path.join(ctx.runDir, "step-c2"),
    stepBSourceRunDir && String(stepBSourceRunDir) !== String(ctx.runDir)
      ? path.join(stepBSourceRunDir, "step-c2")
      : null
  ].filter(Boolean)
  for (const dir of dirs) {
    const indexPath = path.join(dir, "c2_dedup_index.json")
    if (!pathExists(indexPath)) continue
    const index = await readJson(indexPath, null)
    if (!index || typeof index !== "object") continue
    return {
      cfg: c2Cfg,
      enabled: true,
      index,
      sourceDir: dir
    }
  }
  return {
    cfg: c2Cfg,
    enabled: true,
    index: null,
    sourceDir: null
  }
}

const filterTemplatesByC2Representatives = ({ templates, c2IndexPack }) => {
  const safeTemplates = Array.isArray(templates) ? templates : []
  if (c2IndexPack?.enabled !== true) {
    return {
      templates: safeTemplates,
      summary: {
        enabled: false,
        c2SourceDir: null,
        c2DedupedFamilyCount: 0,
        c2RepresentativeFamilyCount: 0,
        c2ShadowFamilyCount: 0,
        c2AcceptedTemplateCount: safeTemplates.length,
        c2RejectedTemplateCount: 0,
        c2FallbackUsed: false,
        c2GateFailed: false
      }
    }
  }
  const index = c2IndexPack?.index
  if (!index || typeof index !== "object") {
    return {
      templates: safeTemplates,
      summary: {
        enabled: true,
        c2SourceDir: c2IndexPack?.sourceDir ?? null,
        c2DedupedFamilyCount: 0,
        c2RepresentativeFamilyCount: 0,
        c2ShadowFamilyCount: 0,
        c2NominalRepresentativeFamilyIds: [],
        c2NominalShadowFamilyIds: [],
        c2EffectiveRepresentativeFamilyIds: [],
        c2EffectiveSource: "INDEX_MISSING",
        c2AcceptedTemplateCount: safeTemplates.length,
        c2RejectedTemplateCount: 0,
        c2FallbackUsed: true,
        c2GateFailed: true
      }
    }
  }
  const representativeFamilyIds = new Set(
    (Array.isArray(index?.representativeFamilyIds) ? index.representativeFamilyIds : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )
  const filtered = safeTemplates.filter((row) => representativeFamilyIds.has(String(row?.c0FamilyId ?? "").trim()))
  const gateFailed = index?.gate?.failed === true
  const shortlistTooSmall =
    representativeFamilyIds.size < Math.max(1, c2IndexPack?.cfg?.minRepresentativeFamilies ?? 1)
  const fallbackUsed = gateFailed || shortlistTooSmall || filtered.length < 1 || index?.fallbackUsed === true
  const nextTemplates = fallbackUsed ? safeTemplates : filtered
  const effectiveRepresentativeFamilyIds = collectUniqueFamilyIdsFromTemplates(nextTemplates)
  return {
    templates: nextTemplates,
    summary: {
      enabled: true,
      c2SourceDir: c2IndexPack?.sourceDir ?? null,
      c2DedupedFamilyCount: Math.max(0, Number(index?.dedupedFamilyCount ?? 0) || 0),
      c2RepresentativeFamilyCount: Math.max(
        0,
        Number(index?.representativeFamilyCount ?? representativeFamilyIds.size) || 0,
      ),
      c2ShadowFamilyCount: Math.max(0, Number(index?.shadowFamilyCount ?? 0) || 0),
      c2NominalRepresentativeFamilyIds: Array.from(representativeFamilyIds).sort((left, right) =>
        left.localeCompare(right),
      ),
      c2NominalShadowFamilyIds: (Array.isArray(index?.shadowFamilyIds) ? index.shadowFamilyIds : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
      c2EffectiveRepresentativeFamilyIds: effectiveRepresentativeFamilyIds,
      c2EffectiveSource: fallbackUsed ? "C1_FALLBACK" : "C2_REPRESENTATIVES",
      c2AcceptedTemplateCount: nextTemplates.length,
      c2RejectedTemplateCount: Math.max(0, safeTemplates.length - nextTemplates.length),
      c2FallbackUsed: fallbackUsed,
      c2GateFailed: gateFailed
    }
  }
}

const filterTemplatesByFamilyPool = ({ templates, familyPoolPack }) => {
  const safeTemplates = Array.isArray(templates) ? templates : []
  if (familyPoolPack?.enabled !== true || !familyPoolPack?.manifest) {
    return {
      templates: safeTemplates,
      summary: {
        enabled: false,
        familyPoolPath: familyPoolPack?.path ?? null,
        productionFamilyCount: 0,
        watchlistFamilyCount: 0,
        rejectedFamilyCount: 0,
        acceptedTemplateCount: safeTemplates.length,
        rejectedTemplateCount: 0,
        fallbackUsed: false,
        effectiveSource: "DISABLED",
        gateFailed: false,
        productionFamilyIds: [],
        watchlistFamilyIds: [],
        rejectedFamilyIds: []
      }
    }
  }
  const manifest = familyPoolPack.manifest
  const minProductionFamilies = Math.max(
    1,
    Math.floor(
      Number(
        manifest?.thresholds?.minProductionFamilies ??
          manifest?.summary?.minProductionFamilies ??
          1,
      ) || 1,
    ),
  )
  const productionFamilyIds = (Array.isArray(familyPoolPack?.productionFamilyIds)
    ? familyPoolPack.productionFamilyIds
    : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
  const watchlistFamilyIds = (Array.isArray(familyPoolPack?.watchlistFamilyIds)
    ? familyPoolPack.watchlistFamilyIds
    : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
  const rejectedFamilyIds = (Array.isArray(familyPoolPack?.rejectedFamilyIds)
    ? familyPoolPack.rejectedFamilyIds
    : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
  const productionSet = new Set(productionFamilyIds)
  const filtered = safeTemplates.filter((row) =>
    productionSet.has(String(row?.c0FamilyId ?? "").trim()),
  )
  const productionReady =
    familyPoolPack?.productionReady === true &&
    productionSet.size >= minProductionFamilies &&
    filtered.length > 0
  const nextTemplates = filtered
  return {
    templates: nextTemplates,
    summary: {
      enabled: true,
      familyPoolPath: familyPoolPack?.path ?? null,
      productionReady,
      minProductionFamilies,
      productionFamilyCount: productionFamilyIds.length,
      watchlistFamilyCount: watchlistFamilyIds.length,
      rejectedFamilyCount: rejectedFamilyIds.length,
      acceptedTemplateCount: nextTemplates.length,
      rejectedTemplateCount: Math.max(0, safeTemplates.length - nextTemplates.length),
      fallbackUsed: false,
      effectiveSource: productionReady ? "FAMILY_POOL_PRODUCTION" : "FAMILY_POOL_STRICT_EMPTY",
      gateFailed: productionReady !== true,
      productionFamilyIds: productionFamilyIds.sort((left, right) => left.localeCompare(right)),
      watchlistFamilyIds: watchlistFamilyIds.sort((left, right) => left.localeCompare(right)),
      rejectedFamilyIds: rejectedFamilyIds.sort((left, right) => left.localeCompare(right))
    }
  }
}

const inferStepCEmptyStage = ({
  rawTemplatesCount,
  templatesNormalizedCount,
  afterC0Count,
  afterC1Count,
  afterC2Count,
  afterFamilyPoolCount,
  familyPoolEnabled
}) => {
  if (Number(rawTemplatesCount ?? 0) < 1) return "INPUT"
  if (Number(templatesNormalizedCount ?? 0) < 1) return "NORMALIZATION"
  if (Number(afterC0Count ?? 0) < 1) return "C0_FILTER"
  if (Number(afterC1Count ?? 0) < 1) return "C1_FILTER"
  if (Number(afterC2Count ?? 0) < 1) return "C2_FILTER"
  if (Number(afterFamilyPoolCount ?? 0) < 1 && familyPoolEnabled === true) return "FAMILY_POOL_FILTER"
  if (Number(afterFamilyPoolCount ?? 0) < 1) return "POST_FILTER_CHAIN"
  return "UNKNOWN"
}

const buildStepCFilterStageSummary = ({
  inputMode,
  inPath,
  stepBSourceRunId,
  stepBSourceRunDir,
  rawTemplatesCount,
  templatesNormalizedCount,
  templatesAfterC0Filter,
  templatesAfterC1Filter,
  templatesAfterC2Filter,
  templatesAfterFamilyPoolFilter,
  familyProbeMode,
  runtimeAllowedC0FamilyIds,
  permanentDrop,
  droppedByPermanent,
  c0Filter,
  c1Filter,
  c2Filter,
  familyPoolFilter,
  failure = null
}) => ({
  step: "C",
  status: failure ? "FAILED" : "READY",
  failure,
  inputMode,
  inputPath: inPath,
  stepBSourceRunId,
  stepBSourceRunDir,
  familyProbeMode: familyProbeMode === true,
  runtimeAllowedC0FamilyIds: Array.isArray(runtimeAllowedC0FamilyIds)
    ? runtimeAllowedC0FamilyIds.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [],
  rawTemplates: rawTemplatesCount,
  templates: templatesAfterFamilyPoolFilter,
  templatesBeforeC0: templatesNormalizedCount,
  templatesAfterC0Filter,
  templatesAfterC1Filter,
  templatesAfterC2Filter,
  templatesAfterFamilyPoolFilter,
  permanentDropListPath: permanentDrop?.listPath ?? null,
  permanentDropCount: permanentDrop?.templateIds?.size ?? 0,
  templatesDroppedByPermanent: droppedByPermanent,
  c0Enabled: c0Filter?.summary?.enabled === true,
  c0SourceDir: c0Filter?.summary?.c0SourceDir ?? null,
  c0FamilyCount: Number(c0Filter?.summary?.c0FamilyCount ?? 0) || 0,
  c0ShortlistedFamilyCount: Number(c0Filter?.summary?.c0ShortlistedFamilyCount ?? 0) || 0,
  c0NominalShortlistedFamilyIds: c0Filter?.summary?.c0NominalShortlistedFamilyIds ?? [],
  c0EffectiveFamilyIds: c0Filter?.summary?.c0EffectiveFamilyIds ?? [],
  c0EffectiveSource: c0Filter?.summary?.c0EffectiveSource ?? null,
  c0AcceptedTemplateCount: Number(c0Filter?.summary?.c0AcceptedTemplateCount ?? 0) || 0,
  c0RejectedTemplateCount: Number(c0Filter?.summary?.c0RejectedTemplateCount ?? 0) || 0,
  c0FallbackUsed: c0Filter?.summary?.c0FallbackUsed === true,
  c0GateFailed: c0Filter?.summary?.c0GateFailed === true,
  c1Enabled: c1Filter?.summary?.enabled === true || familyProbeMode === true,
  c1SourceDir: c1Filter?.summary?.c1SourceDir ?? c1Filter?.summary?.sourceDir ?? null,
  c1ProbedFamilyCount:
    Number(c1Filter?.summary?.c1ProbedFamilyCount ?? c1Filter?.summary?.probedFamilyCount ?? 0) || 0,
  c1PassedFamilyCount:
    Number(c1Filter?.summary?.c1PassedFamilyCount ?? c1Filter?.summary?.passedFamilyCount ?? 0) || 0,
  c1RejectedFamilyCount:
    Number(c1Filter?.summary?.c1RejectedFamilyCount ?? c1Filter?.summary?.rejectedFamilyCount ?? 0) || 0,
  c1NominalPassedFamilyIds:
    c1Filter?.summary?.c1NominalPassedFamilyIds ??
    c1Filter?.summary?.nominalPassedFamilyIds ??
    [],
  c1EffectiveFamilyIds:
    c1Filter?.summary?.c1EffectiveFamilyIds ??
    c1Filter?.summary?.effectiveFamilyIds ??
    [],
  c1EffectiveSource:
    c1Filter?.summary?.c1EffectiveSource ??
    c1Filter?.summary?.effectiveSource ??
    null,
  c1AcceptedTemplateCount:
    Number(c1Filter?.summary?.c1AcceptedTemplateCount ?? c1Filter?.summary?.acceptedTemplateCount ?? 0) || 0,
  c1RejectedTemplateCount:
    Number(c1Filter?.summary?.c1RejectedTemplateCount ?? c1Filter?.summary?.rejectedTemplateCount ?? 0) || 0,
  c1FallbackUsed:
    c1Filter?.summary?.c1FallbackUsed === true || c1Filter?.summary?.fallbackUsed === true,
  c1GateFailed:
    c1Filter?.summary?.c1GateFailed === true || c1Filter?.summary?.gateFailed === true,
  c2Enabled: c2Filter?.summary?.enabled === true,
  c2SourceDir: c2Filter?.summary?.c2SourceDir ?? null,
  c2RepresentativeFamilyCount: Number(c2Filter?.summary?.c2RepresentativeFamilyCount ?? 0) || 0,
  c2EffectiveRepresentativeFamilyIds: c2Filter?.summary?.c2EffectiveRepresentativeFamilyIds ?? [],
  c2EffectiveSource: c2Filter?.summary?.c2EffectiveSource ?? null,
  c2AcceptedTemplateCount: Number(c2Filter?.summary?.c2AcceptedTemplateCount ?? 0) || 0,
  c2RejectedTemplateCount: Number(c2Filter?.summary?.c2RejectedTemplateCount ?? 0) || 0,
  c2FallbackUsed: c2Filter?.summary?.c2FallbackUsed === true,
  c2GateFailed: c2Filter?.summary?.c2GateFailed === true,
  familyPoolEnabled: familyPoolFilter?.summary?.enabled === true,
  familyPoolPath: familyPoolFilter?.summary?.familyPoolPath ?? null,
  familyPoolProductionReady: familyPoolFilter?.summary?.productionReady === true,
  familyPoolMinProductionFamilies:
    Number(familyPoolFilter?.summary?.minProductionFamilies ?? 0) || 0,
  familyPoolProductionFamilyCount:
    Number(familyPoolFilter?.summary?.productionFamilyCount ?? 0) || 0,
  familyPoolWatchlistFamilyCount:
    Number(familyPoolFilter?.summary?.watchlistFamilyCount ?? 0) || 0,
  familyPoolRejectedFamilyCount:
    Number(familyPoolFilter?.summary?.rejectedFamilyCount ?? 0) || 0,
  familyPoolAcceptedTemplateCount:
    Number(familyPoolFilter?.summary?.acceptedTemplateCount ?? 0) || 0,
  familyPoolRejectedTemplateCount:
    Number(familyPoolFilter?.summary?.rejectedTemplateCount ?? 0) || 0,
  familyPoolFallbackUsed: familyPoolFilter?.summary?.fallbackUsed === true,
  familyPoolEffectiveSource: familyPoolFilter?.summary?.effectiveSource ?? null
})

const filterTemplatesByC1PassList = ({
  templates,
  c1ProbePack,
  forcedFamilyIds
}) => {
  const safeTemplates = Array.isArray(templates) ? templates : []
  const forcedIds = new Set(
    (Array.isArray(forcedFamilyIds) ? forcedFamilyIds : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )
  if (forcedIds.size > 0) {
    const filtered = safeTemplates.filter((row) => forcedIds.has(String(row?.c0FamilyId ?? "").trim()))
    return {
      templates: filtered.length > 0 ? filtered : safeTemplates,
      summary: {
        enabled: true,
        sourceDir: c1ProbePack?.sourceDir ?? null,
        probedFamilyCount: forcedIds.size,
        passedFamilyCount: forcedIds.size,
        rejectedFamilyCount: 0,
        nominalPassedFamilyIds: Array.from(forcedIds).sort((left, right) => left.localeCompare(right)),
        nominalBackfillFamilyIds: [],
        nominalRejectedFamilyIds: [],
        effectiveFamilyIds: collectUniqueFamilyIdsFromTemplates(filtered.length > 0 ? filtered : safeTemplates),
        effectiveSource: filtered.length < 1 ? "FULL_TEMPLATE_FALLBACK" : "RUNTIME_FORCED_FAMILY_IDS",
        acceptedTemplateCount: filtered.length,
        rejectedTemplateCount: Math.max(0, safeTemplates.length - filtered.length),
        fallbackUsed: filtered.length < 1,
        gateFailed: filtered.length < 1,
        gateReason: filtered.length < 1 ? "FAMILY_PROBE_EMPTY" : "PASS",
        probeScope: c1ProbePack?.cfg?.probeScope ?? null,
        probeProfile: c1ProbePack?.cfg?.probeProfile ?? null
      }
    }
  }
  if (c1ProbePack?.enabled !== true) {
    return {
      templates: safeTemplates,
      summary: {
        enabled: false,
        sourceDir: null,
        probedFamilyCount: 0,
        passedFamilyCount: 0,
        rejectedFamilyCount: 0,
        nominalPassedFamilyIds: [],
        nominalBackfillFamilyIds: [],
        nominalRejectedFamilyIds: [],
        effectiveFamilyIds: collectUniqueFamilyIdsFromTemplates(safeTemplates),
        effectiveSource: "DISABLED",
        acceptedTemplateCount: safeTemplates.length,
        rejectedTemplateCount: 0,
        fallbackUsed: false,
        gateFailed: false,
        gateReason: "DISABLED",
        probeScope: null,
        probeProfile: null
      }
    }
  }
  const index = c1ProbePack?.index
  if (!index || typeof index !== "object") {
    return {
      templates: safeTemplates,
      summary: {
        enabled: true,
        sourceDir: c1ProbePack?.sourceDir ?? null,
        probedFamilyCount: 0,
        passedFamilyCount: 0,
        rejectedFamilyCount: 0,
        nominalPassedFamilyIds: [],
        nominalBackfillFamilyIds: [],
        nominalRejectedFamilyIds: [],
        effectiveFamilyIds: collectUniqueFamilyIdsFromTemplates(safeTemplates),
        effectiveSource: "INDEX_MISSING",
        acceptedTemplateCount: safeTemplates.length,
        rejectedTemplateCount: 0,
        fallbackUsed: true,
        gateFailed: true,
        gateReason: "INDEX_MISSING",
        probeScope: c1ProbePack?.cfg?.probeScope ?? null,
        probeProfile: c1ProbePack?.cfg?.probeProfile ?? null
      }
    }
  }
  const passedFamilyIds = new Set(
    (Array.isArray(index?.passedFamilyIds) ? index.passedFamilyIds : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )
  const filtered = safeTemplates.filter((row) => passedFamilyIds.has(String(row?.c0FamilyId ?? "").trim()))
  const gateFailed = index?.gate?.failed === true
  const shortlistTooSmall = passedFamilyIds.size < Math.max(1, c1ProbePack?.cfg?.familyBackfillFloor ?? 1)
  const fallbackUsed = gateFailed || filtered.length < 1 || shortlistTooSmall
  const nextTemplates = fallbackUsed ? safeTemplates : filtered
  const nominalPassedFamilyIds = Array.from(passedFamilyIds).sort((left, right) =>
    left.localeCompare(right),
  )
  const backfillFamilyIds = Array.isArray(index?.backfillFamilyIds)
    ? index.backfillFamilyIds.map((value) => String(value ?? "").trim()).filter(Boolean)
    : []
  const nominalRejectedFamilyIds = Array.isArray(index?.rejectedFamilyIds)
    ? index.rejectedFamilyIds.map((value) => String(value ?? "").trim()).filter(Boolean)
    : []
  return {
    templates: nextTemplates,
    summary: {
      enabled: true,
      sourceDir: c1ProbePack?.sourceDir ?? null,
      probedFamilyCount: Math.max(0, Number(index?.probedFamilyCount ?? 0) || 0),
      passedFamilyCount: Math.max(0, Number(index?.passedFamilyCount ?? passedFamilyIds.size) || 0),
      rejectedFamilyCount: Math.max(0, Number(index?.rejectedFamilyCount ?? 0) || 0),
      nominalPassedFamilyIds,
      nominalBackfillFamilyIds: backfillFamilyIds,
      nominalRejectedFamilyIds,
      effectiveFamilyIds: collectUniqueFamilyIdsFromTemplates(nextTemplates),
      effectiveSource: fallbackUsed
        ? (filtered.length < 1 ? "FULL_TEMPLATE_FALLBACK" : "C1_BACKFILL_OR_FALLBACK")
        : "C1_PASSED_ONLY",
      acceptedTemplateCount: nextTemplates.length,
      rejectedTemplateCount: Math.max(0, safeTemplates.length - nextTemplates.length),
      fallbackUsed,
      gateFailed,
      gateReason: String(index?.gate?.reason ?? "").trim() || (fallbackUsed ? "FALLBACK_TO_C0" : "PASS"),
      probeScope: String(index?.probeScope ?? c1ProbePack?.cfg?.probeScope ?? "").trim() || null,
      probeProfile: String(index?.probeProfile ?? c1ProbePack?.cfg?.probeProfile ?? "").trim() || null
    }
  }
}

const filterTemplatesByC1Families = ({
  templates,
  c1IndexPack,
  runtimeAllowedFamilyIds,
  familyProbeMode,
  familyProbeMetadata
}) => {
  const safeTemplates = Array.isArray(templates) ? templates : []
  const runtimeFamilyIds = Array.isArray(runtimeAllowedFamilyIds)
    ? runtimeAllowedFamilyIds.map((value) => String(value ?? "").trim()).filter(Boolean)
    : []
  if (runtimeFamilyIds.length > 0) {
    const allowed = new Set(runtimeFamilyIds)
    const filteredTemplates = safeTemplates.filter((row) => {
      const familyId = String(row?.c0FamilyId ?? "").trim()
      return allowed.has(familyId)
    })
    const rawMaxFamilyRepresentatives = Number(
      familyProbeMetadata?.maxFamilyRepresentatives ?? Number.NaN,
    )
    const representativeCapApplied =
      familyProbeMode === true &&
      Number.isFinite(rawMaxFamilyRepresentatives) &&
      rawMaxFamilyRepresentatives >= 1
    const maxFamilyRepresentatives = representativeCapApplied
      ? Math.max(1, Math.floor(rawMaxFamilyRepresentatives))
      : null
    let nextTemplates = filteredTemplates
    if (representativeCapApplied) {
      const limitedByFamily = new Map()
      nextTemplates = filteredTemplates.filter((row) => {
        const familyId = String(row?.c0FamilyId ?? "").trim()
        const used = Number(limitedByFamily.get(familyId) ?? 0)
        if (used >= maxFamilyRepresentatives) return false
        limitedByFamily.set(familyId, used + 1)
        return true
      })
    }
    return {
      templates: nextTemplates,
      summary: {
        enabled: true,
        c1FamilyProbeMode: familyProbeMode === true,
        c1ProbedFamilyCount: runtimeFamilyIds.length,
        c1PassedFamilyCount: runtimeFamilyIds.length,
        c1RejectedFamilyCount: 0,
        c1NominalPassedFamilyIds: runtimeFamilyIds,
        c1NominalBackfillFamilyIds: [],
        c1NominalRejectedFamilyIds: [],
        c1EffectiveFamilyIds: collectUniqueFamilyIdsFromTemplates(nextTemplates),
        c1EffectiveSource: "RUNTIME_FORCED_FAMILY_IDS",
        c1AcceptedTemplateCount: nextTemplates.length,
        c1RejectedTemplateCount: Math.max(0, safeTemplates.length - nextTemplates.length),
        c1RepresentativeCapApplied: representativeCapApplied,
        c1MaxFamilyRepresentatives: maxFamilyRepresentatives,
        c1TemplatesBeforeRepresentativeCap: filteredTemplates.length,
        c1TemplatesAfterRepresentativeCap: nextTemplates.length,
        c1FallbackUsed: false,
        c1GateFailed: nextTemplates.length < 1,
        c1SourceDir: null
      }
    }
  }
  if (c1IndexPack?.enabled !== true) {
    return {
      templates: safeTemplates,
      summary: {
        enabled: false,
        c1FamilyProbeMode: familyProbeMode === true,
        c1ProbedFamilyCount: 0,
        c1PassedFamilyCount: 0,
        c1RejectedFamilyCount: 0,
        c1NominalPassedFamilyIds: [],
        c1NominalBackfillFamilyIds: [],
        c1NominalRejectedFamilyIds: [],
        c1EffectiveFamilyIds: collectUniqueFamilyIdsFromTemplates(safeTemplates),
        c1EffectiveSource: "DISABLED",
        c1AcceptedTemplateCount: safeTemplates.length,
        c1RejectedTemplateCount: 0,
        c1RepresentativeCapApplied: false,
        c1MaxFamilyRepresentatives: null,
        c1TemplatesBeforeRepresentativeCap: safeTemplates.length,
        c1TemplatesAfterRepresentativeCap: safeTemplates.length,
        c1FallbackUsed: false,
        c1GateFailed: false,
        c1SourceDir: null
      }
    }
  }
  const index = c1IndexPack?.index
  if (!index || typeof index !== "object") {
    return {
      templates: safeTemplates,
      summary: {
        enabled: true,
        c1FamilyProbeMode: familyProbeMode === true,
        c1ProbedFamilyCount: 0,
        c1PassedFamilyCount: 0,
        c1RejectedFamilyCount: 0,
        c1NominalPassedFamilyIds: [],
        c1NominalBackfillFamilyIds: [],
        c1NominalRejectedFamilyIds: [],
        c1EffectiveFamilyIds: collectUniqueFamilyIdsFromTemplates(safeTemplates),
        c1EffectiveSource: "INDEX_MISSING",
        c1AcceptedTemplateCount: safeTemplates.length,
        c1RejectedTemplateCount: 0,
        c1RepresentativeCapApplied: false,
        c1MaxFamilyRepresentatives: null,
        c1TemplatesBeforeRepresentativeCap: safeTemplates.length,
        c1TemplatesAfterRepresentativeCap: safeTemplates.length,
        c1FallbackUsed: true,
        c1GateFailed: true,
        c1SourceDir: c1IndexPack?.sourceDir ?? null
      }
    }
  }
  const passedFamilyIds = Array.isArray(index?.passedFamilyIds)
    ? index.passedFamilyIds.map((value) => String(value ?? "").trim()).filter(Boolean)
    : []
  const backfillFamilyIds = Array.isArray(index?.backfillFamilyIds)
    ? index.backfillFamilyIds.map((value) => String(value ?? "").trim()).filter(Boolean)
    : []
  const minFamilies = Math.max(1, Number(c1IndexPack?.cfg?.familyBackfillFloor ?? 1) || 1)
  const useBackfill = passedFamilyIds.length < minFamilies
  const familyIds = useBackfill ? passedFamilyIds.concat(backfillFamilyIds) : passedFamilyIds
  const allowed = new Set(familyIds)
  let nextTemplates = safeTemplates.filter((row) => allowed.has(String(row?.c0FamilyId ?? "").trim()))
  let fallbackUsed = index?.fallbackUsed === true || useBackfill
  if (!nextTemplates.length) {
    nextTemplates = safeTemplates
    fallbackUsed = true
  }
  const nominalRejectedFamilyIds = Array.isArray(index?.rejectedFamilyIds)
    ? index.rejectedFamilyIds.map((value) => String(value ?? "").trim()).filter(Boolean)
    : []
  return {
    templates: nextTemplates,
    summary: {
      enabled: true,
      c1FamilyProbeMode: familyProbeMode === true,
      c1ProbedFamilyCount: Math.max(0, Number(index?.probedFamilyCount ?? 0) || 0),
      c1PassedFamilyCount: passedFamilyIds.length,
      c1RejectedFamilyCount: Math.max(
        0,
        Number(index?.probedFamilyCount ?? 0) - passedFamilyIds.length,
      ),
      c1NominalPassedFamilyIds: passedFamilyIds,
      c1NominalBackfillFamilyIds: backfillFamilyIds,
      c1NominalRejectedFamilyIds: nominalRejectedFamilyIds,
      c1EffectiveFamilyIds: collectUniqueFamilyIdsFromTemplates(nextTemplates),
      c1EffectiveSource: fallbackUsed
        ? (nextTemplates === safeTemplates ? "C0_FALLBACK" : "C1_BACKFILL")
        : "C1_PASSED_ONLY",
      c1AcceptedTemplateCount: nextTemplates.length,
      c1RejectedTemplateCount: Math.max(0, safeTemplates.length - nextTemplates.length),
      c1RepresentativeCapApplied: false,
      c1MaxFamilyRepresentatives: null,
      c1TemplatesBeforeRepresentativeCap: nextTemplates.length,
      c1TemplatesAfterRepresentativeCap: nextTemplates.length,
      c1FallbackUsed: fallbackUsed,
      c1GateFailed: index?.gate?.failed === true,
      c1SourceDir: c1IndexPack?.sourceDir ?? null
    }
  }
}

const resolveExcludedFeatureGroups = (config) => {
  const raw = config?.pattern?.excludeFeatureGroups
  const source = Array.isArray(raw) ? raw : []
  const allowed = new Set(GROUPS.map((g) => String(g)))
  const out = new Set()
  for (const value of source) {
    const key = String(value ?? "").trim().toLowerCase()
    if (!key || !allowed.has(key)) continue
    out.add(key)
  }
  return out
}

const stripExcludedGroups = (featureVec, excludedGroups) => {
  if (!(excludedGroups instanceof Set) || excludedGroups.size < 1) return featureVec
  const out = {}
  for (const [key, value] of Object.entries(featureVec ?? {})) {
    const group = String(key ?? "").split(".")[0]
    if (excludedGroups.has(group)) continue
    out[key] = value
  }
  return out
}

const resolvePermanentDropPath = (ctx) => {
  const raw = ctx?.config?.pattern?.permanentDropListPath
  if (!raw || typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(ctx?.cwd ?? process.cwd(), trimmed)
}

const loadPermanentDropSet = async (ctx) => {
  const listPath = resolvePermanentDropPath(ctx)
  if (!listPath || !pathExists(listPath)) {
    return {
      listPath,
      templateIds: new Set()
    }
  }
  let out = null
  try {
    const registry = await readDropRegistry({
      filePath: listPath
    })
    out = new Set(resolveEffectiveDropTemplateIds(registry))
  } catch {
    let parsed = null
    try {
      parsed = JSON.parse(String(await fsp.readFile(listPath, "utf8")))
    } catch {
      throw new Error(`Step C permanent drop list parse failed: ${listPath}`)
    }
    const source = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.templateIds)
        ? parsed.templateIds
        : []
    out = new Set()
    for (const value of source) {
      const id = String(value ?? "").trim()
      if (!id) continue
      out.add(id)
    }
  }
  return {
    listPath,
    templateIds: out
  }
}

const resolveChampionCommonStatePath = (ctx) => {
  const raw = ctx?.config?.pattern?.championCommonStatePath
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(ctx?.cwd ?? process.cwd(), trimmed)
}

const resolveCommonStateConfig = (config) => {
  const raw = config?.pattern?.commonState ?? {}
  return {
    enabled: raw?.enabled === true,
    confidenceScale: clamp01(raw?.confidenceScale ?? 1),
    prototypeWeight: Math.max(0, Number(raw?.prototypeWeight ?? 0.65) || 0),
    regimeWeight: Math.max(0, Number(raw?.regimeWeight ?? 0.35) || 0),
    qualityBoost: Math.max(0, Number(raw?.qualityBoost ?? 0.08) || 0),
    clusterQualityBoost: Math.max(0, Number(raw?.clusterQualityBoost ?? 0.06) || 0),
    antiPenaltyWeight: Math.max(0, Number(raw?.antiPenaltyWeight ?? 0.08) || 0),
    antiReliefWeight: Math.max(0, Number(raw?.antiReliefWeight ?? 0.04) || 0),
    maxAdjustment: Math.max(0, Number(raw?.maxAdjustment ?? 0.12) || 0.12)
  }
}

const resolveTemporalStabilityConfig = (config) => {
  const raw = config?.pattern?.temporalStability ?? {}
  return {
    enabled: raw?.enabled !== false,
    eraCount: Math.max(2, Math.floor(Number(raw?.eraCount ?? 4) || 4)),
    warnMaxSingleEraShare: clamp01(raw?.warnMaxSingleEraShare ?? 0.6),
    warnMinEraCoverageRatio: clamp01(raw?.warnMinEraCoverageRatio ?? 0.5),
    warnMinEffectiveEraCountRatio: clamp01(raw?.warnMinEffectiveEraCountRatio ?? 0.5),
    warnMinNormalizedEraEntropy: clamp01(raw?.warnMinNormalizedEraEntropy ?? 0.2),
    selectionEnabled: raw?.selectionEnabled !== false,
    minEraCoverageRatio: clamp01(raw?.minEraCoverageRatio ?? 0),
    minEffectiveEraCountRatio: clamp01(raw?.minEffectiveEraCountRatio ?? 0),
    minNormalizedEraEntropy: clamp01(raw?.minNormalizedEraEntropy ?? 0),
    maxSingleEraShare: clamp01(raw?.maxSingleEraShare ?? 1),
    minEraSupportCount: Math.max(0, Math.floor(Number(raw?.minEraSupportCount ?? 0) || 0)),
    maxEraWinRateStd: Math.max(0, Number(raw?.maxEraWinRateStd ?? 1) || 0),
    prototypeEraCapEnabled: raw?.prototypeEraCapEnabled === true,
    maxSelectedPrototypeEraShare: clamp01(raw?.maxSelectedPrototypeEraShare ?? 1),
    returnTailRebalanceEnabled: raw?.returnTailRebalanceEnabled === true,
    targetSelectedExpectedNetRet3dAvg: Math.max(
      0,
      Number(raw?.targetSelectedExpectedNetRet3dAvg ?? 0) || 0,
    ),
    maxReturnTailSwaps: Math.max(0, Math.floor(Number(raw?.maxReturnTailSwaps ?? 0) || 0)),
    minReturnTailExpectedNetRet3d: Math.max(
      0,
      Number(raw?.minReturnTailExpectedNetRet3d ?? 0) || 0,
    ),
    minReturnTailQualityScore: clamp01(raw?.minReturnTailQualityScore ?? 0),
    relaxMinEraCoverageRatioStep: clamp01(raw?.relaxMinEraCoverageRatioStep ?? 0.1),
    relaxMinEffectiveEraCountRatioStep: clamp01(raw?.relaxMinEffectiveEraCountRatioStep ?? 0.1),
    relaxMinNormalizedEraEntropyStep: clamp01(raw?.relaxMinNormalizedEraEntropyStep ?? 0.1),
    relaxMaxSingleEraShareStep: clamp01(raw?.relaxMaxSingleEraShareStep ?? 0.05),
    relaxMinEraSupportCountStep: Math.max(
      0,
      Math.floor(Number(raw?.relaxMinEraSupportCountStep ?? 1) || 0),
    ),
    relaxMaxEraWinRateStdStep: Math.max(0, Number(raw?.relaxMaxEraWinRateStdStep ?? 0) || 0)
  }
}

const normalizeDateKeyText = (value) => {
  const text = String(value ?? "").trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

const resolveRowDateKey = (row) =>
  normalizeDateKeyText(row?.eventDate ?? row?.asOfDate ?? null)

const buildTemporalEraPlan = ({
  templates,
  cfg
}) => {
  const configuredEraCount = Math.max(2, Math.floor(Number(cfg?.eraCount ?? 4) || 4))
  if (cfg?.enabled !== true) {
    return {
      enabled: false,
      configuredEraCount,
      appliedEraCount: 0,
      eras: [],
      resolveEraId: () => null
    }
  }
  const uniqueDateKeys = Array.from(
    new Set((templates ?? []).map((row) => resolveRowDateKey(row)).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b))
  if (!uniqueDateKeys.length) {
    return {
      enabled: true,
      configuredEraCount,
      appliedEraCount: 0,
      eras: [],
      resolveEraId: () => null
    }
  }
  const appliedEraCount = Math.max(1, Math.min(configuredEraCount, uniqueDateKeys.length))
  const eras = []
  const dateToEra = new Map()
  for (let idx = 0; idx < appliedEraCount; idx += 1) {
    const start = Math.floor((idx * uniqueDateKeys.length) / appliedEraCount)
    const rawEnd = Math.floor(((idx + 1) * uniqueDateKeys.length) / appliedEraCount)
    const end = idx === appliedEraCount - 1 ? uniqueDateKeys.length : Math.max(start + 1, rawEnd)
    const eraId = `E${String(idx + 1).padStart(2, "0")}`
    const from = uniqueDateKeys[start] ?? uniqueDateKeys[0]
    const to = uniqueDateKeys[end - 1] ?? from
    eras.push({
      eraId,
      index: idx,
      from,
      to,
      dateCount: Math.max(0, end - start),
      templateCount: 0,
      positiveCount: 0,
      negativeCount: 0
    })
    for (let dateIdx = start; dateIdx < end; dateIdx += 1) {
      dateToEra.set(uniqueDateKeys[dateIdx], eraId)
    }
  }
  const eraIndexById = new Map(eras.map((row, idx) => [row.eraId, idx]))
  for (const row of templates ?? []) {
    const eraId = dateToEra.get(resolveRowDateKey(row))
    const eraIdx = eraIndexById.get(eraId)
    if (!Number.isInteger(eraIdx)) continue
    eras[eraIdx].templateCount += 1
    if (Number(row?.label) === 1) eras[eraIdx].positiveCount += 1
    if (Number(row?.label) === 0) eras[eraIdx].negativeCount += 1
  }
  return {
    enabled: true,
    configuredEraCount,
    appliedEraCount,
    eras,
    resolveEraId: (value) => {
      const key =
        value && typeof value === "object" ? resolveRowDateKey(value) : normalizeDateKeyText(value)
      return key ? dateToEra.get(key) ?? null : null
    }
  }
}

const clampSigned = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < -1) return -1
  if (n > 1) return 1
  return n
}

const clampAbs = (value, maxAbs) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const m = Math.max(0, Number(maxAbs) || 0)
  if (n < -m) return -m
  if (n > m) return m
  return n
}

const normalizeScoreMap = (raw) => {
  if (!raw || typeof raw !== "object") return {}
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    const k = String(key ?? "").trim()
    if (!k) continue
    out[k] = clampSigned(value)
  }
  return out
}

const loadChampionCommonState = async (ctx) => {
  const cfg = resolveCommonStateConfig(ctx?.config)
  const statePath = resolveChampionCommonStatePath(ctx)
  if (cfg.enabled !== true || !statePath || !pathExists(statePath)) {
    return {
      statePath,
      cfg,
      state: null
    }
  }
  const raw = await readJson(statePath, null)
  if (!raw || typeof raw !== "object") {
    return {
      statePath,
      cfg,
      state: null
    }
  }
  const state = {
    version: String(raw?.version ?? ""),
    updatedAt: String(raw?.updatedAt ?? ""),
    confidence: clamp01(raw?.confidence ?? 0),
    source: raw?.source ?? null,
    featureWeights: raw?.featureWeights ?? {},
    antiFeatureWeights: raw?.antiFeatureWeights ?? {},
    prototypeScores: normalizeScoreMap(raw?.prototypeScores),
    regimeWeights: normalizeScoreMap(raw?.regimeWeights)
  }
  return {
    statePath,
    cfg,
    state
  }
}

const resolvePatternPoolPath = (ctx, rawPath) => {
  const raw = String(rawPath ?? "").trim()
  if (!raw) return null
  return path.isAbsolute(raw) ? raw : path.resolve(ctx?.cwd ?? process.cwd(), raw)
}

const normalizePatternStepDMetrics = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {}
  const selectionHitAt1 = buildSelectionHitAt1Snapshot(source)
  const out = {
    targetHitRateEval: Number.isFinite(Number(source?.targetHitRateEval))
      ? Number(source.targetHitRateEval)
      : null,
    selectionHitAt1Eval: selectionHitAt1.resolved,
    selectionHitAt1RawEval: selectionHitAt1.raw,
    selectionHitAt1ResolvedEval: selectionHitAt1.resolved,
    selectionHitAt1MetricSourceEval: selectionHitAt1.source,
    selectionHitAt1AgreementFallbackAwareEval: selectionHitAt1.agreementFallbackAware,
    executedTargetHitRateEval: Number.isFinite(Number(source?.executedTargetHitRateEval))
      ? Number(source.executedTargetHitRateEval)
      : null,
    stopRateEval: Number.isFinite(Number(source?.stopRateEval))
      ? Number(source.stopRateEval)
      : null,
    timeoutNegativeRateEval: Number.isFinite(Number(source?.timeoutNegativeRateEval))
      ? Number(source.timeoutNegativeRateEval)
      : null,
    oracleHitRateTopKEval: Number.isFinite(Number(source?.oracleHitRateTopKEval))
      ? Number(source.oracleHitRateTopKEval)
      : null
  }
  return Object.values(out).some((value) => value !== null) ? out : null
}

const normalizePatternStepEMetrics = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {}
  const out = {
    targetHitRate: Number.isFinite(Number(source?.targetHitRate))
      ? Number(source.targetHitRate)
      : null,
    targetHitCount: Number.isFinite(Number(source?.targetHitCount))
      ? Number(source.targetHitCount)
      : null,
    stopRate: Number.isFinite(Number(source?.stopRate))
      ? Number(source.stopRate)
      : null,
    timeoutNegativeRate: Number.isFinite(Number(source?.timeoutNegativeRate))
      ? Number(source.timeoutNegativeRate)
      : null
  }
  return Object.values(out).some((value) => value !== null) ? out : null
}

const normalizePatternPoolEntry = (entry) => {
  if (!entry || typeof entry !== "object") return null
  const sourceStepD = normalizePatternStepDMetrics(
    entry?.sourceStepD && typeof entry?.sourceStepD === "object"
      ? entry.sourceStepD
      : {
          targetHitRateEval: entry?.sourceStepDTargetHitRate,
          selectionHitAt1Eval: entry?.sourceStepDSelectionHitAt1Eval,
          executedTargetHitRateEval: entry?.sourceStepDExecutedTargetHitRateEval,
          stopRateEval: entry?.sourceStepDStopRateEval,
          timeoutNegativeRateEval: entry?.sourceStepDTimeoutNegativeRateEval,
          oracleHitRateTopKEval: entry?.sourceStepDOracleHitRateTopKEval
        },
  )
  const sourceStepE = normalizePatternStepEMetrics(
    entry?.sourceStepE && typeof entry?.sourceStepE === "object"
      ? entry.sourceStepE
      : {
          targetHitRate: entry?.sourceStepETargetHitRate,
          targetHitCount: entry?.sourceStepETargetHitCount,
          stopRate: entry?.sourceStepEStopRate,
          timeoutNegativeRate: entry?.sourceStepETimeoutNegativeRate
        },
  )
  const normalized = {
    templateId: String(entry?.templateId ?? "").trim() || null,
    clusterId: String(entry?.clusterId ?? "").trim() || null,
    clusterSignature: String(entry?.clusterSignature ?? "").trim() || null,
    symbol: String(entry?.symbol ?? "").trim() || null,
    selectedEraId: String(entry?.selectedEraId ?? "").trim() || null,
    bias: Number.isFinite(Number(entry?.bias)) ? Number(entry.bias) : null,
    reason: String(entry?.reason ?? "").trim() || null,
    sourceRunId: String(entry?.sourceRunId ?? "").trim() || null,
    sourceSessionId:
      String(entry?.sourceSessionId ?? entry?.sourceCycleId ?? "").trim() || null,
    sourceRound: Number.isFinite(Number(entry?.sourceRound)) ? Number(entry.sourceRound) : null,
    sourceRoundTag: String(entry?.sourceRoundTag ?? "").trim() || null,
    sourceCTag: String(entry?.sourceCTag ?? "").trim() || null,
    sourceLineAccepted:
      typeof entry?.sourceLineAccepted === "boolean" ? entry.sourceLineAccepted : null,
    sourceSessionEnded:
      typeof entry?.sourceSessionEnded === "boolean" ? entry.sourceSessionEnded : null,
    sourceDiscardReason: String(entry?.sourceDiscardReason ?? "").trim() || null,
    sourceStepD,
    sourceStepE,
    sourceStepDTargetHitRate: sourceStepD?.targetHitRateEval ?? null,
    sourceStepETargetHitRate: sourceStepE?.targetHitRate ?? null,
    eNotRunReason: String(entry?.eNotRunReason ?? "").trim() || null,
    sourceCandidateMode: String(entry?.sourceCandidateMode ?? "").trim() || null,
    usageCount: Number.isFinite(Number(entry?.usageCount)) ? Number(entry.usageCount) : null,
    hitRate: Number.isFinite(Number(entry?.hitRate)) ? Number(entry.hitRate) : null,
    missRate: Number.isFinite(Number(entry?.missRate)) ? Number(entry.missRate) : null,
    avgRegret: Number.isFinite(Number(entry?.avgRegret)) ? Number(entry.avgRegret) : null,
    gateRejectContribution: Number.isFinite(Number(entry?.gateRejectContribution))
      ? Number(entry.gateRejectContribution)
      : null,
    streak: Number.isFinite(Number(entry?.streak)) ? Number(entry.streak) : null,
    salvageCount: Number.isFinite(Number(entry?.salvageCount))
      ? Number(entry.salvageCount)
      : null,
    quarantineCount: Number.isFinite(Number(entry?.quarantineCount))
      ? Number(entry.quarantineCount)
      : null,
    promotedToCoreAt: String(entry?.promotedToCoreAt ?? "").trim() || null,
    retiredAt: String(entry?.retiredAt ?? "").trim() || null,
    retirementReason: String(entry?.retirementReason ?? "").trim() || null,
    updatedAt: String(entry?.updatedAt ?? "").trim() || null
  }
  return Object.values(normalized).some((value) => value !== null) ? normalized : null
}

const loadPatternPoolEntries = async (filePath, key) => {
  if (!filePath || !pathExists(filePath)) return []
  const raw = await readJson(filePath, null)
  const source = Array.isArray(raw?.[key]) ? raw[key] : []
  return source.map((entry) => normalizePatternPoolEntry(entry)).filter(Boolean)
}

const resolveAdaptiveFrontierConfig = (ctx, maxLocalPrototypes) => {
  if (ctx?.__runtime?.familyProbeMode === true) {
    return {
      enabled: false,
      candidateMode: "boost_penalty",
      minPrototypeFloor: 1,
      qualityAcceptThreshold: 0,
      qualityNearThreshold: 0,
      maxPrototypeCeil: Math.max(1, Number(maxLocalPrototypes ?? 120) || 120),
      salvageBoostBias: 0,
      salvagePenaltyBias: 0,
      previousRunEAssistWeight: 0,
      previousRunEThreshold: 0.4,
      salvagePoolPath: null,
      quarantinePoolPath: null,
      prototypeLedgerPath: null,
      ledgerCoreBias: 0,
      ledgerPenaltyBias: 0,
      ledgerWatchlistBias: 0,
      ledgerMinConfidence: 1
    }
  }
  const raw = ctx?.config?.pattern?.prototypeSelection?.adaptiveFrontier ?? {}
  const floorFallback =
    Number(ctx?.config?.pattern?.prototypeSelection?.minPrototypeFloor ?? 64) || 64
  const ceilFallback = Math.max(1, Number(maxLocalPrototypes ?? 120) || 120)
  const candidateModeRaw = String(raw?.candidateMode ?? "boost_penalty")
    .trim()
    .toLowerCase()
  const candidateMode =
    candidateModeRaw === "boost_only" ||
    candidateModeRaw === "penalty_only" ||
    candidateModeRaw === "boost_penalty"
      ? candidateModeRaw
      : "boost_penalty"
  return {
    enabled: raw?.enabled === true,
    candidateMode,
    minPrototypeFloor: Math.max(1, Math.floor(Number(raw?.minPrototypeFloor ?? floorFallback) || floorFallback)),
    qualityAcceptThreshold: clamp01(raw?.qualityAcceptThreshold ?? 0.56),
    qualityNearThreshold: clamp01(raw?.qualityNearThreshold ?? 0.5),
    maxPrototypeCeil: Math.max(
      Math.max(1, Math.floor(Number(raw?.minPrototypeFloor ?? floorFallback) || floorFallback)),
      Math.floor(Number(raw?.maxPrototypeCeil ?? ceilFallback) || ceilFallback),
    ),
    salvageBoostBias: Math.max(0, Number(raw?.salvageBoostBias ?? 0.08) || 0),
    salvagePenaltyBias: Math.max(0, Number(raw?.salvagePenaltyBias ?? 0.06) || 0),
    previousRunEAssistWeight: Math.max(0, Number(raw?.previousRunEAssistWeight ?? 0) || 0),
    previousRunEThreshold: clamp01(raw?.previousRunEThreshold ?? 0.4),
    salvagePoolPath: resolvePatternPoolPath(ctx, raw?.salvagePoolPath),
    quarantinePoolPath: resolvePatternPoolPath(ctx, raw?.quarantinePoolPath),
    prototypeLedgerPath: String(raw?.prototypeLedgerPath ?? "").trim() || null,
    ledgerCoreBias: Math.max(0, Number(raw?.ledgerCoreBias ?? 0.08) || 0),
    ledgerPenaltyBias: Math.max(0, Number(raw?.ledgerPenaltyBias ?? 0.08) || 0),
    ledgerWatchlistBias: Math.max(0, Number(raw?.ledgerWatchlistBias ?? 0.03) || 0),
    ledgerMinConfidence: clamp01(raw?.ledgerMinConfidence ?? 0.35)
  }
}

const isSameAdaptiveFrontierCycle = ({ entry, ctx }) => {
  const currentRunId = String(ctx?.runId ?? "").trim()
  const currentSessionId = String(
    ctx?.__runtime?.cdLoopSessionId ?? ctx?.__runtime?.sessionId ?? "",
  ).trim()
  if (currentRunId && String(entry?.sourceRunId ?? "").trim() === currentRunId) {
    return true
  }
  if (
    currentSessionId &&
    String(entry?.sourceSessionId ?? entry?.sourceCycleId ?? "").trim() === currentSessionId
  ) {
    return true
  }
  return false
}

const loadAdaptiveFrontierState = async ({ ctx, maxLocalPrototypes }) => {
  const cfg = resolveAdaptiveFrontierConfig(ctx, maxLocalPrototypes)
  if (cfg.enabled !== true) {
    return {
      cfg,
      salvagePoolPath: cfg.salvagePoolPath,
      quarantinePoolPath: cfg.quarantinePoolPath,
      prototypeLedgerPath: cfg.prototypeLedgerPath,
      prototypeLedger: {
        enabled: false,
        path: cfg.prototypeLedgerPath,
        manifest: null,
        byId: new Map()
      },
      salvageBoostPatterns: [],
      salvagePenaltyPatterns: [],
      quarantinedPatterns: []
    }
  }
  const [salvaged, quarantined, prototypeLedger] = await Promise.all([
    cfg.salvagePoolPath
      ? readJson(cfg.salvagePoolPath, null).catch(() => null)
      : Promise.resolve(null),
    cfg.quarantinePoolPath
      ? readJson(cfg.quarantinePoolPath, null).catch(() => null)
      : Promise.resolve(null),
    loadPrototypeContributionLedger({
      ctx,
      pathOverride: cfg.prototypeLedgerPath
    }).catch(() => ({
      enabled: false,
      path: cfg.prototypeLedgerPath,
      manifest: null,
      byId: new Map()
    }))
  ])
  const filterEntries = (rows) =>
    (Array.isArray(rows) ? rows : [])
      .map((entry) => normalizePatternPoolEntry(entry))
      .filter(Boolean)
      .filter((entry) => !isSameAdaptiveFrontierCycle({ entry, ctx }))
  return {
    cfg,
    salvagePoolPath: cfg.salvagePoolPath,
    quarantinePoolPath: cfg.quarantinePoolPath,
    prototypeLedgerPath: prototypeLedger?.path ?? cfg.prototypeLedgerPath ?? null,
    prototypeLedger,
    salvageBoostPatterns: filterEntries(salvaged?.salvagedBoostPatterns),
    salvagePenaltyPatterns: filterEntries(salvaged?.salvagedPenaltyPatterns),
    quarantinedPatterns: filterEntries([
      ...(Array.isArray(quarantined?.quarantinedPatterns) ? quarantined.quarantinedPatterns : []),
      ...(Array.isArray(quarantined?.retiredPatterns) ? quarantined.retiredPatterns : [])
    ])
  }
}

const patternPoolEntryMatches = (row, entry) => {
  if (!row || !entry) return false
  const rowTemplateId = String(row?.templateId ?? "").trim()
  const rowClusterId = String(row?.clusterId ?? "").trim()
  const rowClusterSignature = String(row?.clusterSignature ?? "").trim()
  const rowSymbol = String(row?.symbol ?? "").trim()
  const rowSelectedEraId = String(row?.selectedEraId ?? "").trim()
  const familyLevelPropagation =
    String(entry?.retiredAt ?? "").trim() ||
    Math.max(0, Number(entry?.quarantineCount ?? 0) || 0) >= 2
  if (entry.clusterId && rowClusterId !== entry.clusterId) return false
  if (entry.clusterSignature && rowClusterSignature !== entry.clusterSignature) return false
  if (familyLevelPropagation) {
    if (entry.symbol && rowSymbol !== entry.symbol) return false
    if (entry.selectedEraId && rowSelectedEraId !== entry.selectedEraId) return false
    return true
  }
  if (entry.templateId && rowTemplateId !== entry.templateId) return false
  if (entry.symbol && rowSymbol !== entry.symbol) return false
  if (entry.selectedEraId && rowSelectedEraId !== entry.selectedEraId) return false
  return true
}

const resolvePatternBias = ({ row, entries, defaultBias = 0, cfg, polarity = "boost" }) => {
  let total = 0
  let matches = 0
  let previousRunEAssistMatches = 0
  for (const entry of entries ?? []) {
    if (!patternPoolEntryMatches(row, entry)) continue
    if (String(entry?.retiredAt ?? "").trim()) continue
    let bias = Number(entry?.bias ?? defaultBias) || defaultBias
    const previousRunEAssistWeight = Math.max(
      0,
      Number(cfg?.previousRunEAssistWeight ?? 0) || 0,
    )
    const previousRunEThreshold = clamp01(cfg?.previousRunEThreshold ?? 0.4)
    const previousRunE = Number(entry?.sourceStepE?.targetHitRate ?? entry?.sourceStepETargetHitRate ?? NaN)
    const allowPreviousRunEAssist =
      entry?.sourceLineAccepted === true || entry?.sourceSessionEnded === true
    if (previousRunEAssistWeight > 0 && allowPreviousRunEAssist && Number.isFinite(previousRunE)) {
      if (polarity === "boost" && previousRunE >= previousRunEThreshold) {
        bias += previousRunEAssistWeight
        previousRunEAssistMatches += 1
      } else if (polarity === "penalty" && previousRunE < previousRunEThreshold) {
        bias += previousRunEAssistWeight
        previousRunEAssistMatches += 1
      }
    }
    total += bias
    matches += 1
  }
  return {
    matches,
    previousRunEAssistMatches,
    bias: matches > 0 ? total : 0
  }
}

const collectPatternPoolSignals = ({ row, entries }) => {
  const summary = {
    matchCount: 0,
    stepDCount: 0,
    stepECount: 0,
    retiredCount: 0,
    coreMatchCount: 0,
    salvageCount: 0,
    quarantineCount: 0,
    targetHitRateEval: 0,
    selectionHitAt1Eval: 0,
    executedTargetHitRateEval: 0,
    stopRateEval: 0,
    timeoutNegativeRateEval: 0,
    oracleHitRateTopKEval: 0,
    previousETargetHitRate: 0,
    previousETargetHitCount: 0
  }
  for (const entry of entries ?? []) {
    if (!patternPoolEntryMatches(row, entry)) continue
    summary.matchCount += 1
    summary.salvageCount += Math.max(0, Number(entry?.salvageCount ?? 0) || 0)
    summary.quarantineCount += Math.max(0, Number(entry?.quarantineCount ?? 0) || 0)
    if (String(entry?.promotedToCoreAt ?? "").trim()) summary.coreMatchCount += 1
    if (String(entry?.retiredAt ?? "").trim()) summary.retiredCount += 1
    const stepD = entry?.sourceStepD ?? null
    if (stepD) {
      summary.stepDCount += 1
      summary.targetHitRateEval += Number(stepD?.targetHitRateEval ?? 0) || 0
      summary.selectionHitAt1Eval += Number(stepD?.selectionHitAt1Eval ?? 0) || 0
      summary.executedTargetHitRateEval += Number(stepD?.executedTargetHitRateEval ?? 0) || 0
      summary.stopRateEval += Number(stepD?.stopRateEval ?? 0) || 0
      summary.timeoutNegativeRateEval += Number(stepD?.timeoutNegativeRateEval ?? 0) || 0
      summary.oracleHitRateTopKEval += Number(stepD?.oracleHitRateTopKEval ?? 0) || 0
    }
    const stepE = entry?.sourceStepE ?? null
    const allowPreviousRunEAssist =
      entry?.sourceLineAccepted === true || entry?.sourceSessionEnded === true
    if (stepE && allowPreviousRunEAssist) {
      summary.stepECount += 1
      summary.previousETargetHitRate += Number(stepE?.targetHitRate ?? 0) || 0
      summary.previousETargetHitCount += Number(stepE?.targetHitCount ?? 0) || 0
    }
  }
  if (summary.stepDCount > 0) {
    summary.targetHitRateEval /= summary.stepDCount
    summary.selectionHitAt1Eval /= summary.stepDCount
    summary.executedTargetHitRateEval /= summary.stepDCount
    summary.stopRateEval /= summary.stepDCount
    summary.timeoutNegativeRateEval /= summary.stepDCount
    summary.oracleHitRateTopKEval /= summary.stepDCount
  }
  if (summary.stepECount > 0) {
    summary.previousETargetHitRate /= summary.stepECount
    summary.previousETargetHitCount /= summary.stepECount
  }
  return summary
}

const scoreAdaptiveFrontierProxy = (row) => {
  const quality = clamp01(row?.qualityScore ?? 0.5)
  const targetRate = clamp01(row?.targetRate3d ?? 0)
  const winRate = clamp01(row?.winRate3d ?? 0)
  const stopRate = clamp01(row?.stopRate3d ?? 0)
  const antiScore = clamp01(row?.antiScore ?? 0)
  const expectedNetRet3d = Number(row?.expectedNetRet3d ?? 0) || 0
  const expectedRetNorm = clamp01(0.5 + expectedNetRet3d / 0.16)
  const commonAlignment = clampSigned(row?.commonAlignmentScore ?? 0)
  return (
    0.34 * quality +
    0.2 * targetRate +
    0.14 * winRate +
    0.12 * expectedRetNorm +
    0.08 * Math.max(0, commonAlignment) +
    0.12 * (1 - stopRate) -
    0.12 * antiScore
  )
}

const scoreAdaptiveFrontierPrototype = ({ row, signals }) => {
  const proxyScore = scoreAdaptiveFrontierProxy(row)
  const dSourceAvailable = Number(signals?.stepDCount ?? 0) > 0
  const dSignal = dSourceAvailable
    ? (
        0.34 * clamp01(signals?.targetHitRateEval ?? 0) +
        0.18 * clamp01(signals?.selectionHitAt1Eval ?? 0) +
        0.24 * clamp01(signals?.executedTargetHitRateEval ?? 0) +
        0.12 * (1 - clamp01(signals?.stopRateEval ?? 0)) +
        0.12 * (1 - clamp01(signals?.timeoutNegativeRateEval ?? 0))
      )
    : clamp01(0.72 * proxyScore + 0.28 * clamp01(row?.targetRate3d ?? 0))
  const previousESignal =
    Number(signals?.stepECount ?? 0) > 0
      ? (
          0.78 * clamp01(signals?.previousETargetHitRate ?? 0) +
          0.22 * clamp01((Number(signals?.previousETargetHitCount ?? 0) || 0) / 12)
        )
      : 0
  const oracleAssist = clamp01(signals?.oracleHitRateTopKEval ?? 0)
  const eraConsistency = clamp01(
    0.55 * clamp01(row?.clusterTemporalEraCoverageRatio ?? 0) +
      0.45 * (1 - clamp01(row?.clusterTemporalMaxSingleEraShare ?? 1)),
  )
  const regimeConsistency = clamp01(0.5 + 0.5 * clampSigned(row?.commonAlignmentScore ?? 0))
  const structuralPenalty = clamp01(
    0.3 * clamp01(row?.stopRate3d ?? 0) +
      0.24 * clamp01(row?.antiScore ?? 0) +
      0.22 * clamp01(row?.clusterTemporalEraWinRateStd ?? 0) +
      0.24 * clamp01(row?.clusterTemporalEraContrastiveLiftStd ?? 0),
  )
  const salvageSupport = clamp01(
    Math.min(
      1,
      (Number(signals?.matchCount ?? 0) || 0) / 3 +
        (Number(signals?.coreMatchCount ?? 0) || 0) / 4,
    ),
  )
  const score = clamp01(
    0.5 * dSignal +
      0.12 * previousESignal +
      0.06 * oracleAssist +
      0.12 * eraConsistency +
      0.08 * regimeConsistency +
      0.06 * salvageSupport +
      0.18 * proxyScore -
      0.12 * structuralPenalty,
  )
  return {
    score,
    breakdown: {
      score,
      proxyScore,
      stepDSignal: dSignal,
      stepDSourceCount: Number(signals?.stepDCount ?? 0) || 0,
      targetHitRateEval: Number(signals?.targetHitRateEval ?? 0) || 0,
      selectionHitAt1Eval: Number(signals?.selectionHitAt1Eval ?? 0) || 0,
      executedTargetHitRateEval: Number(signals?.executedTargetHitRateEval ?? 0) || 0,
      stopRateEval: Number(signals?.stopRateEval ?? 0) || 0,
      timeoutNegativeRateEval: Number(signals?.timeoutNegativeRateEval ?? 0) || 0,
      previousESignal,
      previousESourceCount: Number(signals?.stepECount ?? 0) || 0,
      previousETargetHitRate: Number(signals?.previousETargetHitRate ?? 0) || 0,
      previousETargetHitCount: Number(signals?.previousETargetHitCount ?? 0) || 0,
      oracleAssist,
      eraConsistency,
      regimeConsistency,
      salvageSupport,
      structuralPenalty
    }
  }
}

const applyAdaptiveFrontierSelection = ({
  prototypes,
  cfg,
  salvageBoostPatterns,
  salvagePenaltyPatterns,
  quarantinedPatterns,
  prototypeLedger
}) => {
  const rows = Array.isArray(prototypes) ? prototypes : []
  if (cfg?.enabled !== true) {
    return {
      prototypes: rows,
      summary: {
        enabled: false,
        acceptedByQuality: rows.length,
        rejectedByQuality: 0,
        acceptedBySalvageBoost: 0,
        acceptedBySalvagePenalty: 0,
        rejectedByQuarantine: 0,
        backfilledToFloor: 0,
        retiredByHardRule: 0
      }
    }
  }
  const enriched = rows.map((row) => {
    const candidateMode = String(cfg?.candidateMode ?? "boost_penalty")
    const signalEntries = [
      ...(candidateMode === "penalty_only" ? [] : salvageBoostPatterns),
      ...(candidateMode === "boost_only" ? [] : salvagePenaltyPatterns),
      ...quarantinedPatterns
    ]
    const matchSignals = collectPatternPoolSignals({
      row,
      entries: signalEntries
    })
    const qualityModel = scoreAdaptiveFrontierPrototype({
      row,
      signals: matchSignals
    })
    const baseScore = qualityModel.score
    const ledgerRow =
      prototypeLedger?.byId instanceof Map
        ? prototypeLedger.byId.get(String(row?.templateId ?? "").trim()) ?? null
        : null
    const ledgerConfidence = clamp01(ledgerRow?.confidence ?? 0)
    const ledgerQuality = clamp01(ledgerRow?.compositeQuality ?? 0)
    const ledgerStatus = String(ledgerRow?.status ?? "WATCH").trim().toUpperCase() || "WATCH"
    const ledgerFamilyStatus =
      String(ledgerRow?.familyStatus ?? "").trim().toUpperCase() || null
    let ledgerBias = 0
    if (ledgerConfidence >= clamp01(cfg?.ledgerMinConfidence ?? 0.35)) {
      if (ledgerStatus === "CORE") {
        ledgerBias += (Number(cfg?.ledgerCoreBias ?? 0) || 0) * Math.max(0.5, ledgerQuality)
      } else if (["PENALTY", "QUARANTINE", "RETIRED"].includes(ledgerStatus)) {
        ledgerBias -= (Number(cfg?.ledgerPenaltyBias ?? 0) || 0) * Math.max(0.5, ledgerQuality)
      } else if (ledgerFamilyStatus === "WATCHLIST") {
        ledgerBias +=
          (Number(cfg?.ledgerWatchlistBias ?? 0) || 0) * Math.max(0.35, ledgerConfidence)
      }
    }
    const salvageBoost = resolvePatternBias({
      row,
      entries: candidateMode === "penalty_only" ? [] : salvageBoostPatterns,
      defaultBias: cfg?.salvageBoostBias ?? 0,
      cfg,
      polarity: "boost"
    })
    const salvagePenalty = resolvePatternBias({
      row,
      entries: candidateMode === "boost_only" ? [] : salvagePenaltyPatterns,
      defaultBias: cfg?.salvagePenaltyBias ?? 0,
      cfg,
      polarity: "penalty"
    })
    const quarantined = resolvePatternBias({
      row,
      entries: quarantinedPatterns,
      defaultBias: 1
    }).matches > 0
    const hardRetired = Number(matchSignals?.retiredCount ?? 0) > 0
    const frontierScore = baseScore + salvageBoost.bias - salvagePenalty.bias + ledgerBias
    const enrichedRow = {
      ...row,
      adaptiveProxyScore: Number(qualityModel?.breakdown?.proxyScore ?? 0) || 0,
      cQualityScore: Number(qualityModel?.score ?? 0) || 0,
      cQualityScoreBreakdown: qualityModel?.breakdown ?? null,
      prototypeLedgerStatus: ledgerStatus,
      prototypeLedgerFamilyStatus: ledgerFamilyStatus,
      prototypeLedgerCompositeQuality: ledgerQuality,
      prototypeLedgerConfidence: ledgerConfidence
    }
    return {
      row: enrichedRow,
      baseScore,
      frontierScore,
      matchSignals,
      ledgerStatus,
      ledgerFamilyStatus,
      ledgerConfidence,
      ledgerQuality,
      ledgerBias,
      salvageBoostMatches: salvageBoost.matches,
      salvagePenaltyMatches: salvagePenalty.matches,
      previousRunEAssistBoostMatches: salvageBoost.previousRunEAssistMatches,
      previousRunEAssistPenaltyMatches: salvagePenalty.previousRunEAssistMatches,
      quarantined:
        hardRetired ||
        quarantined ||
        ledgerStatus === "QUARANTINE" ||
        ledgerStatus === "RETIRED",
      hardRetired: hardRetired || ledgerStatus === "RETIRED"
    }
  })
  const sorted = enriched.slice().sort((a, b) => b.frontierScore - a.frontierScore)
  const accepted = []
  const rejected = []
  let acceptedByQuality = 0
  let rejectedByQuality = 0
  let acceptedBySalvageBoost = 0
  let acceptedBySalvagePenalty = 0
  let previousRunEAssistBoostMatches = 0
  let previousRunEAssistPenaltyMatches = 0
  let rejectedByQuarantine = 0
  let retiredByHardRule = 0
  let ledgerCoreCount = 0
  let ledgerWatchCount = 0
  let ledgerPenaltyCount = 0
  let ledgerQuarantineCount = 0
  let ledgerRetiredCount = 0
  let ledgerBoostedCount = 0
  let ledgerSuppressedCount = 0
  for (const item of sorted) {
    if (item.ledgerStatus === "CORE") ledgerCoreCount += 1
    else if (item.ledgerStatus === "PENALTY") ledgerPenaltyCount += 1
    else if (item.ledgerStatus === "QUARANTINE") ledgerQuarantineCount += 1
    else if (item.ledgerStatus === "RETIRED") ledgerRetiredCount += 1
    else ledgerWatchCount += 1
    if (Number(item.ledgerBias ?? 0) > 0) ledgerBoostedCount += 1
    if (Number(item.ledgerBias ?? 0) < 0) ledgerSuppressedCount += 1
    if (item.quarantined) {
      rejected.push(item)
      if (item.hardRetired) {
        retiredByHardRule += 1
      } else {
        rejectedByQuarantine += 1
      }
      continue
    }
    const acceptByQuality = item.frontierScore >= Number(cfg?.qualityAcceptThreshold ?? 0.56)
    const acceptByNear =
      item.frontierScore >= Number(cfg?.qualityNearThreshold ?? 0.5) &&
      item.salvageBoostMatches > 0
    if (acceptByQuality || acceptByNear) {
      accepted.push(item)
      if (acceptByQuality) acceptedByQuality += 1
      if (item.salvageBoostMatches > 0) acceptedBySalvageBoost += 1
      if (item.salvagePenaltyMatches > 0) acceptedBySalvagePenalty += 1
      previousRunEAssistBoostMatches += Number(item.previousRunEAssistBoostMatches ?? 0) || 0
      previousRunEAssistPenaltyMatches += Number(item.previousRunEAssistPenaltyMatches ?? 0) || 0
    } else {
      rejected.push(item)
      rejectedByQuality += 1
    }
  }
  const minFloor = Math.max(1, Number(cfg?.minPrototypeFloor ?? 1) || 1)
  let backfilledToFloor = 0
  if (accepted.length < minFloor) {
    for (const item of rejected) {
      if (accepted.length >= minFloor) break
      if (item.quarantined) continue
      accepted.push(item)
      backfilledToFloor += 1
      if (item.salvageBoostMatches > 0) acceptedBySalvageBoost += 1
      if (item.salvagePenaltyMatches > 0) acceptedBySalvagePenalty += 1
      previousRunEAssistBoostMatches += Number(item.previousRunEAssistBoostMatches ?? 0) || 0
      previousRunEAssistPenaltyMatches += Number(item.previousRunEAssistPenaltyMatches ?? 0) || 0
    }
  }
  const maxCeil = Math.max(minFloor, Number(cfg?.maxPrototypeCeil ?? accepted.length) || accepted.length)
  const selectedItems = accepted
    .sort((a, b) => b.frontierScore - a.frontierScore)
    .slice(0, maxCeil)
  const selected = selectedItems.map((item) => item.row)
  const avgCQualityScore =
    selectedItems.length > 0
      ? selectedItems.reduce((acc, item) => acc + (Number(item?.row?.cQualityScore ?? 0) || 0), 0) /
        selectedItems.length
      : 0
  const avgProxyScore =
    selectedItems.length > 0
      ? selectedItems.reduce(
          (acc, item) => acc + (Number(item?.row?.adaptiveProxyScore ?? 0) || 0),
          0,
        ) / selectedItems.length
      : 0
  return {
    prototypes: selected,
    summary: {
      enabled: true,
      candidateMode: String(cfg?.candidateMode ?? "boost_penalty"),
      acceptedByQuality,
      rejectedByQuality,
      acceptedBySalvageBoost,
      acceptedBySalvagePenalty,
      previousRunEAssistWeight: Number(cfg?.previousRunEAssistWeight ?? 0) || 0,
      previousRunEAssistThreshold: Number(cfg?.previousRunEThreshold ?? 0) || 0,
      previousRunEAssistBoostMatches,
      previousRunEAssistPenaltyMatches,
      rejectedByQuarantine,
      backfilledToFloor,
      retiredByHardRule,
      averageCQualityScore: avgCQualityScore,
      averageProxyScore: avgProxyScore,
      cQualityScoreBreakdown: {
        primary: "STEP_D_EVAL",
        secondary: "PREVIOUS_RUN_STEP_E",
        oracle: "AUXILIARY_COVERAGE",
        selectedAverageCQualityScore: avgCQualityScore,
        selectedAverageProxyScore: avgProxyScore
      },
      salvageBoostPatternCount: Array.isArray(salvageBoostPatterns) ? salvageBoostPatterns.length : 0,
      salvagePenaltyPatternCount: Array.isArray(salvagePenaltyPatterns) ? salvagePenaltyPatterns.length : 0,
      quarantinePatternCount: Array.isArray(quarantinedPatterns) ? quarantinedPatterns.length : 0,
      ledgerCoreCount,
      ledgerWatchCount,
      ledgerPenaltyCount,
      ledgerQuarantineCount,
      ledgerRetiredCount,
      ledgerBoostedCount,
      ledgerSuppressedCount
    }
  }
}

const buildFeatureStats = (templates, vectorKey) => {
  const valuesByKey = new Map()
  for (const row of templates) {
    const vec = row?.[vectorKey] ?? {}
    for (const [key, value] of Object.entries(vec)) {
      const n = num(value)
      if (!Number.isFinite(n)) continue
      const list = valuesByKey.get(key) ?? []
      list.push(n)
      valuesByKey.set(key, list)
    }
  }

  const stats = {}
  for (const [key, values] of valuesByKey.entries()) {
    stats[key] = {
      mean: mean(values),
      stdev: stdev(values),
      q30: quantile(values, 0.3),
      q50: quantile(values, 0.5),
      q70: quantile(values, 0.7)
    }
  }
  return stats
}

const buildRules = ({
  templates,
  vectorKey,
  featureStats,
  quantiles,
  minSupportRatio = 0,
  maxRules = 240,
  idPrefix = "R"
}) => {
  const rules = []
  const qList = Array.isArray(quantiles) && quantiles.length ? quantiles : [0.3, 0.5, 0.7]
  const supportFloor = Math.max(0, Math.min(1, Number(minSupportRatio) || 0))

  for (const key of Object.keys(featureStats ?? {})) {
    const values = templates
      .map((t) => num(t?.[vectorKey]?.[key]))
      .filter(Number.isFinite)
    if (!values.length) continue

    for (const q of qList) {
      const th = quantile(values, q)
      if (!Number.isFinite(th)) continue
      let ge = 0
      let le = 0
      for (const v of values) {
        if (v >= th) ge += 1
        if (v <= th) le += 1
      }
      const geRatio = ge / values.length
      if (geRatio >= supportFloor) {
        rules.push({
          id: `${idPrefix}:${key}:ge:${q}`,
          expr: `${key} >= ${th}`,
          support: ge,
          supportRatio: geRatio,
          feature: key,
          op: ">=",
          threshold: th,
          quantile: q
        })
      }
      const leRatio = le / values.length
      if (leRatio >= supportFloor) {
        rules.push({
          id: `${idPrefix}:${key}:le:${q}`,
          expr: `${key} <= ${th}`,
          support: le,
          supportRatio: leRatio,
          feature: key,
          op: "<=",
          threshold: th,
          quantile: q
        })
      }
    }
  }

  rules.sort((a, b) => b.supportRatio - a.supportRatio)
  return rules.slice(0, Math.max(1, Number(maxRules) || 240))
}

const pickEvenly = (rows, cap) => {
  const list = Array.isArray(rows) ? rows : []
  const n = Math.max(1, Number(cap) || 1)
  if (list.length <= n) return list.slice()
  const out = []
  const step = list.length / n
  for (let i = 0; i < n; i += 1) {
    out.push(list[Math.floor(i * step)])
  }
  return out
}

const parseDateKeyUtcMs = (value) => {
  const text = String(value ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const t = Date.parse(`${text}T00:00:00Z`)
  return Number.isFinite(t) ? t : null
}

const preferredGlobalClusterKeys = [
  "global.ret20",
  "global.ret40",
  "global.ret60",
  "global.ret120",
  "global.volatility40",
  "global.volatility150",
  "global.rangePos150",
  "global.volumeRatio20Over150"
]

const resolveGlobalClusterKeys = (globalFeatureStats) => {
  const available = new Set(Object.keys(globalFeatureStats ?? {}))
  const picked = preferredGlobalClusterKeys.filter((key) => available.has(key))
  if (picked.length) return picked.slice(0, 6)
  return Array.from(available).sort((a, b) => a.localeCompare(b)).slice(0, 6)
}

const buildGlobalBinThresholds = ({ templates, keys, bins }) => {
  const safeBins = Math.max(2, Number(bins) || 3)
  const out = {}
  for (const key of keys) {
    const values = templates
      .map((row) => num(row?.globalFeatureVec?.[key]))
      .filter(Number.isFinite)
    const thresholds = []
    for (let i = 1; i < safeBins; i += 1) {
      const q = i / safeBins
      const th = quantile(values, q)
      if (Number.isFinite(th)) thresholds.push(th)
    }
    out[key] = thresholds
  }
  return out
}

const assignBin = (value, thresholds) => {
  const n = num(value)
  if (!Number.isFinite(n)) return "na"
  let idx = 0
  for (const th of thresholds ?? []) {
    if (n > th) idx += 1
  }
  return String(idx)
}

const resolveClusterBinPlan = ({
  templateCount,
  configuredBins,
  mode,
  minBins,
  maxBins
}) => {
  const configured = Math.max(2, Math.floor(Number(configuredBins ?? 3) || 3))
  const lo = Math.max(2, Math.floor(Number(minBins ?? 3) || 3))
  const hi = Math.max(lo, Math.floor(Number(maxBins ?? 5) || 5))
  const boundedConfigured = Math.max(lo, Math.min(hi, configured))
  const modeText = String(mode ?? "adaptive").trim().toLowerCase()
  if (modeText !== "adaptive") {
    return {
      mode: "fixed",
      configured: boundedConfigured,
      applied: boundedConfigured,
      minBins: lo,
      maxBins: hi
    }
  }
  const n = Math.max(0, Math.floor(Number(templateCount ?? 0) || 0))
  let adaptive = lo
  if (n >= 900) adaptive = Math.min(hi, 5)
  else if (n >= 350) adaptive = Math.min(hi, Math.max(lo, 4))
  return {
    mode: "adaptive",
    configured: boundedConfigured,
    applied: Math.max(lo, Math.min(hi, adaptive)),
    minBins: lo,
    maxBins: hi
  }
}

const buildGlobalClusters = ({
  templates,
  globalFeatureStats,
  bins
}) => {
  const keys = resolveGlobalClusterKeys(globalFeatureStats)
  if (!keys.length) {
    return {
      clusterKeys: [],
      clusterThresholds: {},
      clusters: [
        {
          clusterId: "C000",
          signature: "default",
          templates: templates.slice()
        }
      ]
    }
  }
  const clusterThresholds = buildGlobalBinThresholds({ templates, keys, bins })
  const bySignature = new Map()

  for (const row of templates) {
    const signatureParts = keys.map((key) => assignBin(row?.globalFeatureVec?.[key], clusterThresholds[key]))
    const signature = signatureParts.join("|")
    const list = bySignature.get(signature) ?? []
    list.push(row)
    bySignature.set(signature, list)
  }

  const rawClusters = Array.from(bySignature.entries()).map(([signature, rows]) => ({
    signature,
    templates: rows
  }))
  rawClusters.sort((a, b) => b.templates.length - a.templates.length)
  const clusters = rawClusters.map((row, idx) => ({
    clusterId: `C${String(idx + 1).padStart(3, "0")}`,
    signature: row.signature,
    templates: row.templates
  }))
  return {
    clusterKeys: keys,
    clusterThresholds,
    clusters
  }
}

const buildClusterCenters = ({ clusters, globalFeatureKeys, totalTemplates }) =>
  clusters.map((cluster) => {
    const center = {}
    for (const key of globalFeatureKeys) {
      const values = cluster.templates
        .map((row) => num(row?.globalFeatureVec?.[key]))
        .filter(Number.isFinite)
      center[key] = mean(values)
    }
    return {
      clusterId: cluster.clusterId,
      signature: cluster.signature,
      support: cluster.templates.length,
      supportRatio: totalTemplates > 0 ? cluster.templates.length / totalTemplates : 0,
      centerGlobalFeatureVec: center
    }
  })

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0))

const normalizeOutcome = (raw) => {
  if (!raw || typeof raw !== "object") return null
  const netRet = num(raw?.netRet)
  const grossRet = num(raw?.grossRet)
  return {
    netRet: Number.isFinite(netRet) ? netRet : null,
    grossRet: Number.isFinite(grossRet) ? grossRet : null,
    exitReason: String(raw?.exitReason ?? "").trim() || null,
    hitTarget: raw?.hitTarget === true,
    hitStop: raw?.hitStop === true
  }
}

const resolveTemplateLabel = (row) => {
  const rawLabel = Number(row?.label)
  if (rawLabel === 0) return { label: 0, templateKind: "NEGATIVE" }
  if (rawLabel === 1) return { label: 1, templateKind: "POSITIVE" }
  const kind = String(row?.templateKind ?? "").trim().toUpperCase()
  if (kind === "NEGATIVE") return { label: 0, templateKind: "NEGATIVE" }
  return { label: 1, templateKind: "POSITIVE" }
}

const resolvePatternQualityConfig = (config) => {
  const raw = config?.pattern?.quality ?? {}
  const weights = raw?.weights ?? {}
  return {
    enabled: raw?.enabled !== false,
    minTradesPerCluster: Math.max(1, Number(raw?.minTradesPerCluster ?? 8) || 8),
    prototypeClusterBlend: clamp01(raw?.prototypeClusterBlend ?? 0.7),
    retScale: Math.max(1e-6, Number(raw?.retScale ?? 0.08) || 0.08),
    weights: {
      winRate: Math.max(0, Number(weights?.winRate ?? 0.35) || 0),
      targetRate: Math.max(0, Number(weights?.targetRate ?? 0.2) || 0),
      avgNetRet: Math.max(0, Number(weights?.avgNetRet ?? 0.35) || 0),
      stopRate: Math.max(0, Number(weights?.stopRate ?? 0.1) || 0)
    }
  }
}

const resolveAntiPatternConfig = (config) => {
  const raw = config?.pattern?.antiPattern ?? {}
  return {
    enabled: raw?.enabled !== false,
    extraNegRetWeight: Math.max(0, Number(raw?.extraNegRetWeight ?? 0.5) || 0)
  }
}

const resolveContrastiveConfig = (config) => {
  const raw = config?.pattern?.contrastive ?? {}
  return {
    enabled: raw?.enabled !== false,
    blend: clamp01(raw?.blend ?? 0.35),
    minSamplesPerCluster: Math.max(1, Number(raw?.minSamplesPerCluster ?? 30) || 30),
    liftCap: Math.max(1.01, Number(raw?.liftCap ?? 3) || 3),
    antiNegRateWeight: Math.max(0, Number(raw?.antiNegRateWeight ?? 0.35) || 0.35)
  }
}

const resolvePrototypeSelectionConfig = (config) => {
  const raw = config?.pattern?.prototypeSelection ?? {}
  const recentShareRaw = clamp01(raw?.recentShare ?? 0.5)
  const anchorShareRaw = clamp01(raw?.anchorShare ?? 0.5)
  const shareSum = recentShareRaw + anchorShareRaw
  const recentShare = shareSum > 0 ? recentShareRaw / shareSum : 0.5
  const anchorShare = shareSum > 0 ? anchorShareRaw / shareSum : 0.5
  return {
    enabled: raw?.enabled !== false,
    minPerCluster: Math.max(0, Math.floor(Number(raw?.minPerCluster ?? 1) || 1)),
    maxCandidatesPerCluster: Math.max(
      8,
      Math.floor(Number(raw?.maxCandidatesPerCluster ?? 80) || 80),
    ),
    recentShare,
    anchorShare,
    recencyHalfLifeDays: Math.max(1, Number(raw?.recencyHalfLifeDays ?? 240) || 240),
    qualityWeight: Math.max(0, Number(raw?.qualityWeight ?? 0.48) || 0),
    retWeight: Math.max(0, Number(raw?.retWeight ?? 0.2) || 0),
    winRateWeight: Math.max(0, Number(raw?.winRateWeight ?? 0.14) || 0),
    recencyWeight: Math.max(0, Number(raw?.recencyWeight ?? 0.18) || 0),
    temporalDiversityWeight: Math.max(0, Number(raw?.temporalDiversityWeight ?? 0) || 0),
    dominantEraPenaltyWeight: Math.max(0, Number(raw?.dominantEraPenaltyWeight ?? 0) || 0),
    minTemporalCoverageForEraBoost: clamp01(raw?.minTemporalCoverageForEraBoost ?? 0.5),
    minTemporalEffectiveEraCountRatio: clamp01(raw?.minTemporalEffectiveEraCountRatio ?? 0.55),
    minTemporalEntropyRatio: clamp01(raw?.minTemporalEntropyRatio ?? 0.25),
    antiPenaltyWeight: Math.max(0, Number(raw?.antiPenaltyWeight ?? 0.18) || 0),
    maxPerSymbol: Math.max(1, Math.floor(Number(raw?.maxPerSymbol ?? 4) || 4)),
    maxClusterShare: clamp01(raw?.maxClusterShare ?? 0.35),
    minDistinctClusters: Math.max(1, Math.floor(Number(raw?.minDistinctClusters ?? 3) || 3)),
    minClusterSupport: Math.max(1, Math.floor(Number(raw?.minClusterSupport ?? 5) || 5)),
    minQualityTrades: Math.max(0, Math.floor(Number(raw?.minQualityTrades ?? 8) || 8)),
    minContrastiveSamples: Math.max(0, Math.floor(Number(raw?.minContrastiveSamples ?? 30) || 30)),
    minQualityScore: clamp01(raw?.minQualityScore ?? 0.55),
    minPrototypeFloor: Math.max(1, Math.floor(Number(raw?.minPrototypeFloor ?? 24) || 24)),
    minNegativePrototypeFloor: (() => {
      const minNegativePrototypeFloor = Number(raw?.minNegativePrototypeFloor ?? 12)
      return Math.max(
        0,
        Math.floor(Number.isFinite(minNegativePrototypeFloor) ? minNegativePrototypeFloor : 12),
      )
    })(),
    minClusterFloor: Math.max(1, Math.floor(Number(raw?.minClusterFloor ?? 8) || 8)),
    maxBackfillAdditions: Math.max(
      0,
      Math.floor(Number(raw?.maxBackfillAdditions ?? 128) || 128),
    ),
    maxBackfillRatio: Math.max(0, Number(raw?.maxBackfillRatio ?? 2) || 0),
    relaxRounds: Math.max(0, Math.floor(Number(raw?.relaxRounds ?? 3) || 3)),
    relaxMinQualityScoreStep: clamp01(raw?.relaxMinQualityScoreStep ?? 0.03),
    relaxMinContrastiveSamplesStep: Math.max(
      0,
      Math.floor(Number(raw?.relaxMinContrastiveSamplesStep ?? 6) || 6),
    )
  }
}

const resolveRecallOnlyConfig = (config) => {
  const raw = config?.pattern?.recallOnly
  if (raw && typeof raw === "object") {
    return {
      enabled: raw?.enabled === true
    }
  }
  return {
    enabled: raw === true
  }
}

const buildOutcomeStats = (templates) => {
  const rows = (templates ?? [])
    .map((row) => row?.eventOutcome)
    .filter((row) => row && Number.isFinite(row?.netRet))
  const trades = rows.length
  if (!trades) {
    return {
      trades: 0,
      winRate3d: 0,
      targetRate3d: 0,
      stopRate3d: 0,
      expectedNetRet3d: 0
    }
  }
  let win = 0
  let target = 0
  let stop = 0
  let sumNet = 0
  for (const row of rows) {
    const net = Number(row?.netRet ?? 0)
    if (net > 0) win += 1
    // Prefer exit-based rates over raw hitTarget/hitStop booleans.
    // `hitTarget` can be true even when STOP wins on the same day (BOTH_HIT_STOP_FIRST).
    const exitReason = String(row?.exitReason ?? "").trim().toUpperCase()
    const hasExitReason = exitReason.length > 0
    if (hasExitReason) {
      if (exitReason === "TARGET") target += 1
      if (exitReason === "STOP" || exitReason === "BOTH_HIT_STOP_FIRST") stop += 1
    } else {
      if (row?.hitTarget === true) target += 1
      if (row?.hitStop === true) stop += 1
    }
    sumNet += net
  }
  return {
    trades,
    winRate3d: win / trades,
    targetRate3d: target / trades,
    stopRate3d: stop / trades,
    expectedNetRet3d: sumNet / trades
  }
}

const scorePatternQuality = ({ stats, qualityCfg, antiCfg, contrastiveCfg, contrastiveStats }) => {
  const {
    winRate3d,
    targetRate3d,
    stopRate3d,
    expectedNetRet3d
  } = stats
  const w = qualityCfg?.weights ?? {}
  const retNorm = clamp01(0.5 + expectedNetRet3d / (2 * qualityCfg.retScale))
  const positive =
    Number(w.winRate ?? 0) * winRate3d +
    Number(w.targetRate ?? 0) * targetRate3d +
    Number(w.avgNetRet ?? 0) * retNorm
  const negative = Number(w.stopRate ?? 0) * stopRate3d
  const denom =
    Number(w.winRate ?? 0) +
    Number(w.targetRate ?? 0) +
    Number(w.avgNetRet ?? 0) +
    Number(w.stopRate ?? 0)
  const qualityScore = denom > 0 ? clamp01((positive - negative + Number(w.stopRate ?? 0)) / denom) : 0.5

  const negRetTerm =
    expectedNetRet3d < 0 ? clamp01((-expectedNetRet3d / qualityCfg.retScale) * Number(antiCfg.extraNegRetWeight ?? 0)) : 0
  let antiScore = antiCfg.enabled ? clamp01((stopRate3d - targetRate3d) + negRetTerm) : 0
  let mergedQualityScore = qualityCfg.enabled ? qualityScore : 0.5
  const contrastiveSamples = Math.max(0, Number(contrastiveStats?.samples ?? 0) || 0)
  const contrastivePosRate = clamp01(contrastiveStats?.posRate ?? 1)
  const contrastiveNegRate = clamp01(contrastiveStats?.negRate ?? 0)
  const contrastiveLiftRaw = Number(contrastiveStats?.lift ?? 1)
  const contrastiveLift = Number.isFinite(contrastiveLiftRaw) && contrastiveLiftRaw > 0 ? contrastiveLiftRaw : 1
  if (contrastiveCfg?.enabled && contrastiveSamples >= Number(contrastiveCfg?.minSamplesPerCluster ?? 1)) {
    const liftNorm = clamp01((contrastiveLift - 1) / (Number(contrastiveCfg?.liftCap ?? 3) - 1))
    const contrastiveQuality = (liftNorm + contrastivePosRate) / 2
    mergedQualityScore = clamp01(
      (1 - Number(contrastiveCfg?.blend ?? 0.35)) * mergedQualityScore +
        Number(contrastiveCfg?.blend ?? 0.35) * contrastiveQuality,
    )
    antiScore = clamp01(antiScore + contrastiveNegRate * Number(contrastiveCfg?.antiNegRateWeight ?? 0))
  }
  return {
    qualityScore: mergedQualityScore,
    antiScore,
    contrastiveSamples,
    contrastivePosRate,
    contrastiveNegRate,
    contrastiveLift
  }
}

const buildClusterContrastiveStats = ({
  clusterBuild,
  negativeTemplates,
  eraPlan = null
}) => {
  const keys = Array.isArray(clusterBuild?.clusterKeys) ? clusterBuild.clusterKeys : []
  const thresholds = clusterBuild?.clusterThresholds ?? {}
  const clusters = Array.isArray(clusterBuild?.clusters) ? clusterBuild.clusters : []
  const signatureToClusterId = new Map(clusters.map((row) => [String(row?.signature ?? ""), String(row?.clusterId ?? "")]))
  const negativeByCluster = new Map()
  const positiveByClusterEra = new Map()
  const negativeByClusterEra = new Map()
  const totalPositiveByEra = new Map()
  const totalNegativeByEra = new Map()
  const bumpNested = (outer, outerKey, innerKey) => {
    const key = String(outerKey ?? "").trim()
    const subKey = String(innerKey ?? "").trim()
    if (!key || !subKey) return
    const inner = outer.get(key) ?? new Map()
    inner.set(subKey, Number(inner.get(subKey) ?? 0) + 1)
    outer.set(key, inner)
  }
  let negativesMapped = 0
  let negativesUnmapped = 0
  for (const cluster of clusters) {
    const clusterId = String(cluster?.clusterId ?? "")
    for (const row of cluster?.templates ?? []) {
      const eraId = eraPlan?.resolveEraId?.(row)
      if (!clusterId || !eraId) continue
      bumpNested(positiveByClusterEra, clusterId, eraId)
      totalPositiveByEra.set(eraId, Number(totalPositiveByEra.get(eraId) ?? 0) + 1)
    }
  }
  for (const row of negativeTemplates ?? []) {
    const signature = keys.length
      ? keys.map((key) => assignBin(row?.globalFeatureVec?.[key], thresholds?.[key])).join("|")
      : "default"
    const clusterId = signatureToClusterId.get(signature)
    if (!clusterId) {
      negativesUnmapped += 1
      continue
    }
    negativeByCluster.set(clusterId, Number(negativeByCluster.get(clusterId) ?? 0) + 1)
    const eraId = eraPlan?.resolveEraId?.(row)
    if (eraId) {
      bumpNested(negativeByClusterEra, clusterId, eraId)
      totalNegativeByEra.set(eraId, Number(totalNegativeByEra.get(eraId) ?? 0) + 1)
    }
    negativesMapped += 1
  }
  const totalPositive = clusters.reduce((acc, row) => acc + Number(row?.templates?.length ?? 0), 0)
  const totalNegative = Math.max(0, Number(negativeTemplates?.length ?? 0))
  const basePosRate =
    totalPositive + totalNegative > 0 ? totalPositive / (totalPositive + totalNegative) : 1
  const byCluster = new Map()
  for (const cluster of clusters) {
    const clusterId = String(cluster?.clusterId ?? "")
    const positive = Number(cluster?.templates?.length ?? 0)
    const negative = Number(negativeByCluster.get(clusterId) ?? 0)
    const samples = positive + negative
    const posRate = samples > 0 ? positive / samples : 1
    const negRate = samples > 0 ? negative / samples : 0
    const lift = basePosRate > 0 ? posRate / basePosRate : 1
    byCluster.set(clusterId, {
      positive,
      negative,
      samples,
      posRate,
      negRate,
      lift
    })
  }
  const byClusterEra = new Map()
  for (const cluster of clusters) {
    const clusterId = String(cluster?.clusterId ?? "")
    const inner = new Map()
    for (const era of eraPlan?.eras ?? []) {
      const eraId = String(era?.eraId ?? "")
      if (!eraId) continue
      const positive = Number(positiveByClusterEra.get(clusterId)?.get(eraId) ?? 0)
      const negative = Number(negativeByClusterEra.get(clusterId)?.get(eraId) ?? 0)
      const samples = positive + negative
      const posRate = samples > 0 ? positive / samples : 1
      const negRate = samples > 0 ? negative / samples : 0
      const eraBasePositive = Number(totalPositiveByEra.get(eraId) ?? 0)
      const eraBaseNegative = Number(totalNegativeByEra.get(eraId) ?? 0)
      const eraBasePosRate =
        eraBasePositive + eraBaseNegative > 0
          ? eraBasePositive / (eraBasePositive + eraBaseNegative)
          : 1
      const lift = eraBasePosRate > 0 ? posRate / eraBasePosRate : 1
      inner.set(eraId, {
        positive,
        negative,
        samples,
        posRate,
        negRate,
        lift,
        basePosRate: eraBasePosRate
      })
    }
    byClusterEra.set(clusterId, inner)
  }
  return {
    byCluster,
    byClusterEra,
    basePosRate,
    totalPositive,
    totalNegative,
    negativesMapped,
    negativesUnmapped,
    totalPositiveByEra,
    totalNegativeByEra
  }
}

const summarizeTemporalOverview = ({
  rows,
  cfg
}) => {
  const metrics = Array.isArray(rows) ? rows : []
  const coverageValues = metrics
    .map((row) => Number(row?.eraCoverageRatio))
    .filter(Number.isFinite)
  const maxShareValues = metrics
    .map((row) => Number(row?.maxSingleEraShare))
    .filter(Number.isFinite)
  const winRateStdValues = metrics
    .map((row) => Number(row?.eraWinRateStd))
    .filter(Number.isFinite)
  const retStdValues = metrics
    .map((row) => Number(row?.eraExpectedNetRetStd))
    .filter(Number.isFinite)
  const contrastiveLiftStdValues = metrics
    .map((row) => Number(row?.eraContrastiveLiftStd))
    .filter(Number.isFinite)
  const normalizedEraEntropyValues = metrics
    .map((row) => Number(row?.normalizedEraEntropy))
    .filter(Number.isFinite)
  const effectiveEraCountValues = metrics
    .map((row) => Number(row?.effectiveEraCount))
    .filter(Number.isFinite)
  return {
    count: metrics.length,
    medianEraCoverageRatio: coverageValues.length ? quantile(coverageValues, 0.5) : 0,
    minEraCoverageRatio: coverageValues.length ? Math.min(...coverageValues) : 0,
    medianMaxSingleEraShare: maxShareValues.length ? quantile(maxShareValues, 0.5) : 0,
    maxMaxSingleEraShare: maxShareValues.length ? Math.max(...maxShareValues) : 0,
    medianEraWinRateStd: winRateStdValues.length ? quantile(winRateStdValues, 0.5) : 0,
    medianEraExpectedNetRetStd: retStdValues.length ? quantile(retStdValues, 0.5) : 0,
    medianEraContrastiveLiftStd: contrastiveLiftStdValues.length
      ? quantile(contrastiveLiftStdValues, 0.5)
      : 0,
    medianNormalizedEraEntropy: normalizedEraEntropyValues.length
      ? quantile(normalizedEraEntropyValues, 0.5)
      : 0,
    medianEffectiveEraCount: effectiveEraCountValues.length
      ? quantile(effectiveEraCountValues, 0.5)
      : 0,
    highConcentrationCount: metrics.filter(
      (row) => Number(row?.maxSingleEraShare ?? 0) >= Number(cfg?.warnMaxSingleEraShare ?? 1),
    ).length,
    lowCoverageCount: metrics.filter(
      (row) => Number(row?.eraCoverageRatio ?? 0) <= Number(cfg?.warnMinEraCoverageRatio ?? 0),
    ).length
  }
}

const buildClusterTemporalStabilityStats = ({
  clusterBuild,
  clusterContrastive,
  eraPlan,
  temporalCfg
}) => {
  const byCluster = new Map()
  if (eraPlan?.enabled !== true || Number(eraPlan?.appliedEraCount ?? 0) < 1) {
    return {
      byCluster,
      overview: summarizeTemporalOverview({
        rows: [],
        cfg: temporalCfg
      })
    }
  }
  const rows = []
  for (const cluster of clusterBuild?.clusters ?? []) {
    const clusterId = String(cluster?.clusterId ?? "")
    const totalSupport = Math.max(0, Number(cluster?.templates?.length ?? 0) || 0)
    let dominantEraId = null
    let maxEraSupport = 0
    const eraStats = []
    for (const era of eraPlan?.eras ?? []) {
      const eraId = String(era?.eraId ?? "")
      if (!eraId) continue
      const eraRows = (cluster?.templates ?? []).filter((row) => eraPlan.resolveEraId(row) === eraId)
      const support = eraRows.length
      if (support > maxEraSupport) {
        maxEraSupport = support
        dominantEraId = eraId
      }
      const stats = buildOutcomeStats(eraRows)
      const contrastiveStats = clusterContrastive?.byClusterEra?.get(clusterId)?.get(eraId) ?? {
        positive: support,
        negative: 0,
        samples: support,
        posRate: support > 0 ? 1 : 0,
        negRate: 0,
        lift: 1
      }
      eraStats.push({
        eraId,
        from: era?.from ?? null,
        to: era?.to ?? null,
        support,
        supportShare: totalSupport > 0 ? support / totalSupport : 0,
        winRate3d: Number(stats?.winRate3d ?? 0),
        targetRate3d: Number(stats?.targetRate3d ?? 0),
        stopRate3d: Number(stats?.stopRate3d ?? 0),
        expectedNetRet3d: Number(stats?.expectedNetRet3d ?? 0),
        contrastiveSamples: Number(contrastiveStats?.samples ?? 0),
        contrastivePosRate: Number(contrastiveStats?.posRate ?? 1),
        contrastiveNegRate: Number(contrastiveStats?.negRate ?? 0),
        contrastiveLift: Number(contrastiveStats?.lift ?? 1)
      })
    }
    const populatedEraStats = eraStats.filter((row) => Number(row?.support ?? 0) > 0)
    const supportValues = populatedEraStats.map((row) => Number(row?.support ?? 0)).filter(Number.isFinite)
    const winRateValues = populatedEraStats.map((row) => Number(row?.winRate3d ?? 0)).filter(Number.isFinite)
    const retValues = populatedEraStats
      .map((row) => Number(row?.expectedNetRet3d ?? 0))
      .filter(Number.isFinite)
    const liftValues = populatedEraStats
      .map((row) => Number(row?.contrastiveLift ?? 1))
      .filter(Number.isFinite)
    const supportShares = populatedEraStats
      .map((row) => clamp01(row?.supportShare ?? 0))
      .filter((value) => Number.isFinite(value) && value > 0)
    const eraEntropy = supportShares.reduce((acc, share) => acc - share * Math.log(share), 0)
    const normalizedEraEntropy =
      Number(eraPlan?.appliedEraCount ?? 0) > 1
        ? clamp01(eraEntropy / Math.log(Number(eraPlan.appliedEraCount)))
        : 0
    const effectiveEraCount = supportShares.length ? Math.exp(eraEntropy) : 0
    const metricRow = {
      clusterId,
      eraStats,
      eraSupportCount: populatedEraStats.length,
      eraCoverageRatio:
        Number(eraPlan?.appliedEraCount ?? 0) > 0
          ? populatedEraStats.length / Number(eraPlan.appliedEraCount)
          : 0,
      dominantEraId,
      dominantEraShare: totalSupport > 0 ? maxEraSupport / totalSupport : 0,
      maxSingleEraShare: totalSupport > 0 ? maxEraSupport / totalSupport : 0,
      eraSupportMin: supportValues.length ? Math.min(...supportValues) : 0,
      eraSupportMedian: supportValues.length ? quantile(supportValues, 0.5) : 0,
      eraEntropy,
      normalizedEraEntropy,
      effectiveEraCount,
      eraWinRateStd: stdev(winRateValues) ?? 0,
      eraExpectedNetRetStd: stdev(retValues) ?? 0,
      eraContrastiveLiftStd: stdev(liftValues) ?? 0
    }
    byCluster.set(clusterId, metricRow)
    rows.push(metricRow)
  }
  return {
    byCluster,
    overview: summarizeTemporalOverview({
      rows,
      cfg: temporalCfg
    })
  }
}

const summarizeSelectedPrototypeEraMix = ({
  prototypes,
  eraPlan
}) => {
  const counts = {}
  for (const row of prototypes ?? []) {
    const eraId = eraPlan?.resolveEraId?.(row)
    if (!eraId) continue
    counts[eraId] = Number(counts[eraId] ?? 0) + 1
  }
  const total = Object.values(counts).reduce((acc, value) => acc + (Number(value) || 0), 0)
  const distribution = {}
  let dominantEraId = null
  let dominantCount = 0
  for (const [eraId, value] of Object.entries(counts)) {
    const count = Number(value ?? 0) || 0
    distribution[eraId] = total > 0 ? count / total : 0
    if (count > dominantCount) {
      dominantCount = count
      dominantEraId = eraId
    }
  }
  return {
    total,
    counts,
    distribution,
    dominantEraId,
    maxEraShare: total > 0 ? dominantCount / total : 0
  }
}

const blendStats = ({ clusterStats, protoStats, blend }) => {
  if (!protoStats?.trades) return { ...clusterStats }
  if (!clusterStats?.trades) return { ...protoStats }
  const a = clamp01(blend)
  const b = 1 - a
  return {
    trades: protoStats.trades + clusterStats.trades,
    winRate3d: a * clusterStats.winRate3d + b * protoStats.winRate3d,
    targetRate3d: a * clusterStats.targetRate3d + b * protoStats.targetRate3d,
    stopRate3d: a * clusterStats.stopRate3d + b * protoStats.stopRate3d,
    expectedNetRet3d: a * clusterStats.expectedNetRet3d + b * protoStats.expectedNetRet3d
  }
}

const resolveCommonAlignment = ({
  templateId,
  clusterSignature,
  commonState,
  commonCfg
}) => {
  if (!commonState) return 0
  const protoScore = clampSigned(commonState?.prototypeScores?.[String(templateId ?? "").trim()] ?? 0)
  const regimeScore = clampSigned(commonState?.regimeWeights?.[String(clusterSignature ?? "").trim()] ?? 0)
  const protoW = Math.max(0, Number(commonCfg?.prototypeWeight ?? 0))
  const regimeW = Math.max(0, Number(commonCfg?.regimeWeight ?? 0))
  const denom = protoW + regimeW
  if (denom <= 0) return 0
  return clampSigned((protoW * protoScore + regimeW * regimeScore) / denom)
}

const toLocalPrototypeRow = ({ row, clusterId }) => ({
  templateId: row.templateId,
  symbol: row.symbol,
  eventDate: row.eventDate,
  asOfDate: row.asOfDate,
  clusterId,
  c0FamilyId: row?.c0FamilyId ?? null,
  c0FamilySignature: row?.c0FamilySignature ?? null,
  c0Score: Number(row?.c0Score ?? 0) || 0,
  c0Shortlisted: row?.c0Shortlisted === true,
  c0FamilySupport: Number(row?.c0FamilySupport ?? 0) || 0,
  templateWinRate3d: Number(buildTemplateOutcomeStats(row)?.winRate3d ?? 0) || 0,
  templateTargetRate3d: Number(buildTemplateOutcomeStats(row)?.targetRate3d ?? 0) || 0,
  templateStopRate3d: Number(buildTemplateOutcomeStats(row)?.stopRate3d ?? 0) || 0,
  templateExpectedNetRet3d: Number(buildTemplateOutcomeStats(row)?.expectedNetRet3d ?? 0) || 0,
  featureVec: row.featureVec,
  globalFeatureVec: row.globalFeatureVec,
  localWindow: row.localWindow,
  globalWindow: row.globalWindow,
  sequenceWindow: row.localWindow,
  seq40: row.seq40,
  seq150: row.seq150
})

const buildTemplateOutcomeStats = (templateRow) => {
  const outcome = templateRow?.eventOutcome ?? {}
  const netRet = Number(outcome?.netRet)
  const hasNetRet = Number.isFinite(netRet)
  const exitReason = String(outcome?.exitReason ?? "").trim().toUpperCase()
  let targetRate3d = 0
  let stopRate3d = 0
  if (exitReason) {
    if (exitReason === "TARGET") targetRate3d = 1
    if (exitReason === "STOP" || exitReason === "BOTH_HIT_STOP_FIRST") stopRate3d = 1
  } else {
    if (outcome?.hitTarget === true) targetRate3d = 1
    if (outcome?.hitStop === true) stopRate3d = 1
  }
  return {
    winRate3d: hasNetRet && netRet > 0 ? 1 : 0,
    targetRate3d,
    stopRate3d,
    expectedNetRet3d: hasNetRet ? netRet : 0
  }
}

const resolvePrototypeOutcomeBucket = (templateRow) => {
  const outcome = templateRow?.eventOutcome ?? {}
  const exitReason = String(outcome?.exitReason ?? "").trim().toUpperCase()
  const netRet = Number(outcome?.netRet)
  if (outcome?.hitTarget === true || exitReason === "TARGET") return "HIT"
  if (
    outcome?.hitStop === true ||
    exitReason === "STOP" ||
    exitReason === "BOTH_HIT_STOP_FIRST"
  ) {
    return "STOP_FIRST"
  }
  if (Number.isFinite(netRet) && netRet < 0) return "TIMEOUT_NEGATIVE"
  return "LOW_EXECUTION_QUALITY"
}

const resolveExecutionFeasibilityBucket = (row) => {
  const avgTradingValue20dKrw = Number(row?.featureVec?.["volume.avgTradingValue20dKrw"] ?? 0) || 0
  const liquidityStress = Number(row?.featureVec?.["volume.liquidityStress"] ?? 0) || 0
  const exhaustionProxy = Number(row?.featureVec?.["volume.exhaustionProxy"] ?? 0) || 0
  const rangePct = Number(row?.featureVec?.["candle.rangePct"] ?? 0) || 0
  const executionFeasibilityScore =
    Number(row?.featureVec?.["execution.feasibilityScore"] ?? 0) || 0
  if (avgTradingValue20dKrw > 0 && avgTradingValue20dKrw < 1_200_000_000) {
    return "HOSTILE"
  }
  if (executionFeasibilityScore > 0 && executionFeasibilityScore < 0.45) {
    return "HOSTILE"
  }
  if (liquidityStress >= 0.35 || exhaustionProxy >= 0.08 || rangePct >= 0.11) {
    return "WATCH"
  }
  if (executionFeasibilityScore > 0 && executionFeasibilityScore < 0.68) {
    return "WATCH"
  }
  return "FEASIBLE"
}

const scoreNegativePrototypeSeverity = (row) => {
  const stats = buildTemplateOutcomeStats(row)
  const adverseRet = Math.max(0, -(Number(stats?.expectedNetRet3d ?? 0) || 0))
  const liquidityStress = Math.max(
    0,
    Number(row?.featureVec?.["volume.liquidityStress"] ?? 0) || 0,
  )
  const exhaustionProxy = Math.max(
    0,
    Number(row?.featureVec?.["volume.exhaustionProxy"] ?? 0) || 0,
  )
  const executionFeasibilityGap = Math.max(
    0,
    1 - (Number(row?.featureVec?.["execution.feasibilityScore"] ?? 0) || 0),
  )
  return adverseRet * 10 + liquidityStress + exhaustionProxy + executionFeasibilityGap
}

const toNegativePrototypeRow = ({ row }) => {
  const outcomeBucket = resolvePrototypeOutcomeBucket(row)
  const executionFeasibilityBucket = resolveExecutionFeasibilityBucket(row)
  return {
    templateId: row.templateId,
    symbol: row.symbol,
    eventDate: row.eventDate,
    asOfDate: row.asOfDate,
    clusterId: `NEG_${outcomeBucket}`,
    templateKind: "NEGATIVE",
    outcomeBucket,
    executionFeasibilityBucket,
    featureVec: row.featureVec,
    globalFeatureVec: row.globalFeatureVec,
    localWindow: row.localWindow,
    globalWindow: row.globalWindow,
    sequenceWindow: row.localWindow,
    seq40: row.seq40,
    seq150: row.seq150,
    qualityTrades: 1,
    winRate3d: Number(buildTemplateOutcomeStats(row)?.winRate3d ?? 0) || 0,
    targetRate3d: Number(buildTemplateOutcomeStats(row)?.targetRate3d ?? 0) || 0,
    stopRate3d: Number(buildTemplateOutcomeStats(row)?.stopRate3d ?? 0) || 0,
    expectedNetRet3d: Number(buildTemplateOutcomeStats(row)?.expectedNetRet3d ?? 0) || 0,
    negativeSeverity: scoreNegativePrototypeSeverity(row),
    c0FamilyId: row?.c0FamilyId ?? null,
    c0FamilySignature: row?.c0FamilySignature ?? null,
    c0Score: Number(row?.c0Score ?? 0) || 0,
    c0Shortlisted: row?.c0Shortlisted === true,
    c0FamilySupport: Number(row?.c0FamilySupport ?? 0) || 0
  }
}

const selectNegativePrototypes = ({ negativeTemplates, maxLocalPrototypes }) => {
  const rows = Array.isArray(negativeTemplates) ? negativeTemplates : []
  const perBucketCap = Math.min(
    48,
    Math.max(12, Math.floor((Number(maxLocalPrototypes ?? 120) || 120) * 0.25)),
  )
  const byBucket = new Map()
  for (const row of rows) {
    const bucket = resolvePrototypeOutcomeBucket(row)
    if (!byBucket.has(bucket)) byBucket.set(bucket, [])
    byBucket.get(bucket).push(row)
  }
  const selected = []
  for (const bucket of ["STOP_FIRST", "TIMEOUT_NEGATIVE", "LOW_EXECUTION_QUALITY"]) {
    const list = byBucket.get(bucket) ?? []
    list
      .slice()
      .sort((left, right) => {
        const bySeverity =
          scoreNegativePrototypeSeverity(right) - scoreNegativePrototypeSeverity(left)
        if (bySeverity !== 0) return bySeverity
        return String(right?.eventDate ?? "").localeCompare(String(left?.eventDate ?? ""))
      })
      .slice(0, perBucketCap)
      .forEach((row) => {
        selected.push(toNegativePrototypeRow({ row }))
      })
  }
  return selected
}

const buildTemplateQualityProxy = ({ row, clusterStats, qualityCfg }) => {
  const templateStats = buildTemplateOutcomeStats(row)
  const retScale = Math.max(1e-6, Number(qualityCfg?.retScale ?? 0.08) || 0.08)
  const clusterExpectedNetRet3d = Number(clusterStats?.expectedNetRet3d ?? 0) || 0
  const clusterQualityScore = clamp01(clusterStats?.qualityScore ?? 0.5)
  const clusterWinRate3d = clamp01(clusterStats?.winRate3d ?? 0)
  const clusterRetNorm = clamp01(0.5 + clusterExpectedNetRet3d / (2 * retScale))
  const templateRetNorm = clamp01(0.5 + Number(templateStats.expectedNetRet3d ?? 0) / (2 * retScale))
  const templateQualityProxy = clamp01(
    0.45 * Number(templateStats.winRate3d ?? 0) +
      0.35 * Number(templateStats.targetRate3d ?? 0) +
      0.2 * templateRetNorm -
      0.2 * Number(templateStats.stopRate3d ?? 0) +
      0.2,
  )
  return {
    templateStats,
    qualityProxy: clamp01(0.7 * clusterQualityScore + 0.2 * clusterWinRate3d + 0.1 * clusterRetNorm + 0.2 * templateQualityProxy - 0.2),
    templateRetNorm
  }
}

const scorePrototypeCandidate = ({
  row,
  clusterStats,
  clusterTemporalStats,
  qualityCfg,
  selectionCfg,
  latestEventMs,
  eraPlan
}) => {
  const clusterQualityScore = clamp01(clusterStats?.qualityScore ?? 0.5)
  const clusterAntiScore = clamp01(clusterStats?.antiScore ?? 0)
  const clusterWinRate3d = clamp01(clusterStats?.winRate3d ?? 0)
  const clusterExpectedNetRet3d = Number(clusterStats?.expectedNetRet3d ?? 0) || 0

  const templateStats = buildTemplateOutcomeStats(row)
  const retScale = Math.max(1e-6, Number(qualityCfg?.retScale ?? 0.08) || 0.08)
  const clusterRetNorm = clamp01(0.5 + clusterExpectedNetRet3d / (2 * retScale))
  const templateRetNorm = clamp01(0.5 + Number(templateStats.expectedNetRet3d ?? 0) / (2 * retScale))
  const templateQualityProxy = clamp01(
    0.45 * Number(templateStats.winRate3d ?? 0) +
      0.35 * Number(templateStats.targetRate3d ?? 0) +
      0.2 * templateRetNorm -
      0.2 * Number(templateStats.stopRate3d ?? 0) +
      0.2,
  )
  const qualitySignal = clamp01(0.7 * clusterQualityScore + 0.3 * templateQualityProxy)
  const retSignal = clamp01(0.7 * clusterRetNorm + 0.3 * templateRetNorm)
  const winRateSignal = clamp01(
    0.7 * clusterWinRate3d + 0.3 * Number(templateStats.winRate3d ?? 0),
  )
  const antiSignal = clamp01(
    0.75 * clusterAntiScore + 0.25 * Number(templateStats.stopRate3d ?? 0),
  )
  const eventMs = parseDateKeyUtcMs(row?.eventDate) ?? parseDateKeyUtcMs(row?.asOfDate) ?? null
  const ageDays =
    Number.isFinite(eventMs) && Number.isFinite(latestEventMs)
      ? Math.max(0, (latestEventMs - eventMs) / 86400000)
      : Number.POSITIVE_INFINITY
  const halfLifeDays = Math.max(1, Number(selectionCfg?.recencyHalfLifeDays ?? 240) || 240)
  const recencySignal = Number.isFinite(ageDays)
    ? Math.exp((-Math.log(2) * ageDays) / halfLifeDays)
    : 0

  const rowEraId = eraPlan?.resolveEraId?.(row) ?? null
  const dominantEraId = String(clusterTemporalStats?.dominantEraId ?? "").trim() || null
  const eraCoverageRatio = clamp01(clusterTemporalStats?.eraCoverageRatio ?? 0)
  const maxSingleEraShare = clamp01(clusterTemporalStats?.maxSingleEraShare ?? 1)
  const normalizedEraEntropy = clamp01(clusterTemporalStats?.normalizedEraEntropy ?? 0)
  const appliedEraCount = Math.max(1, Number(eraPlan?.appliedEraCount ?? 0) || 1)
  const effectiveEraCount = Math.max(0, Number(clusterTemporalStats?.effectiveEraCount ?? 0) || 0)
  const effectiveEraCountRatio = clamp01(effectiveEraCount / appliedEraCount)
  const eraStats = Array.isArray(clusterTemporalStats?.eraStats)
    ? clusterTemporalStats.eraStats.find((item) => String(item?.eraId ?? "") === String(rowEraId ?? ""))
    : null
  const eraSupportShare = clamp01(eraStats?.supportShare ?? 0)
  const minTemporalCoverageForEraBoost = clamp01(
    selectionCfg?.minTemporalCoverageForEraBoost ?? 0.5,
  )
  const minTemporalEffectiveEraCountRatio = clamp01(
    selectionCfg?.minTemporalEffectiveEraCountRatio ?? 0.55,
  )
  const minTemporalEntropyRatio = clamp01(selectionCfg?.minTemporalEntropyRatio ?? 0.25)
  const temporalClusterStable =
    eraCoverageRatio >= minTemporalCoverageForEraBoost &&
    effectiveEraCountRatio >= minTemporalEffectiveEraCountRatio &&
    normalizedEraEntropy >= minTemporalEntropyRatio &&
    maxSingleEraShare < 1
  const temporalDiversityWeight = Math.max(0, Number(selectionCfg?.temporalDiversityWeight ?? 0) || 0)
  const dominantEraPenaltyWeight = Math.max(0, Number(selectionCfg?.dominantEraPenaltyWeight ?? 0) || 0)
  const recencyWeight = Math.max(0, Number(selectionCfg?.recencyWeight ?? 0))
  const nonDominantShare = clamp01(1 - maxSingleEraShare)
  const temporalEvidenceScore = clamp01(
    (nonDominantShare + effectiveEraCountRatio + normalizedEraEntropy) / 3,
  )
  const eraRaritySignal =
    temporalClusterStable && rowEraId
      ? clamp01((maxSingleEraShare - eraSupportShare) / Math.max(maxSingleEraShare, 1e-6))
      : 0
  const temporalDiversityBoost =
    temporalDiversityWeight > 0 ? temporalDiversityWeight * temporalEvidenceScore * eraRaritySignal : 0
  const dominantEraPenalty =
    dominantEraPenaltyWeight > 0 &&
    temporalClusterStable &&
    rowEraId &&
    dominantEraId &&
    String(rowEraId) === String(dominantEraId)
      ? dominantEraPenaltyWeight *
        clamp01((maxSingleEraShare + (1 - normalizedEraEntropy) + (1 - effectiveEraCountRatio)) / 3)
      : 0
  const effectiveRecencyWeight =
    temporalClusterStable && temporalDiversityWeight > 0
      ? Math.max(0, recencyWeight * (1 - temporalDiversityWeight * temporalEvidenceScore))
      : recencyWeight

  const qualityWeight = Math.max(0, Number(selectionCfg?.qualityWeight ?? 0))
  const retWeight = Math.max(0, Number(selectionCfg?.retWeight ?? 0))
  const winRateWeight = Math.max(0, Number(selectionCfg?.winRateWeight ?? 0))
  const antiPenaltyWeight = Math.max(0, Number(selectionCfg?.antiPenaltyWeight ?? 0))
  const positiveWeightSum = qualityWeight + retWeight + winRateWeight + effectiveRecencyWeight
  const positiveSignal =
    positiveWeightSum > 0
      ? (qualityWeight * qualitySignal +
          retWeight * retSignal +
          winRateWeight * winRateSignal +
          effectiveRecencyWeight * recencySignal) /
        positiveWeightSum
      : qualitySignal
  return positiveSignal + temporalDiversityBoost - antiPenaltyWeight * antiSignal - dominantEraPenalty
}

const buildLocalPrototypes = ({
  clusters,
  maxLocalPrototypes,
  clusterQualityById,
  clusterTemporalById,
  qualityCfg,
  selectionCfg,
  eraPlan,
  temporalCfg
}) => {
  const safeCap = Math.max(1, Number(maxLocalPrototypes) || 240)
  if (!clusters.length) {
    return {
      selected: [],
      rankedBuckets: []
    }
  }
  const selectCfg = selectionCfg ?? {}
  if (selectCfg.enabled !== true) {
    const perClusterCap = Math.max(1, Math.ceil(safeCap / clusters.length))
    const pickedEvenly = []
    const rankedBuckets = []
    for (const cluster of clusters) {
      const sorted = cluster.templates
        .slice()
        .sort((a, b) => String(a?.eventDate ?? "").localeCompare(String(b?.eventDate ?? "")))
      rankedBuckets.push({
        clusterId: String(cluster?.clusterId ?? ""),
        support: Math.max(0, Number(cluster?.templates?.length ?? 0) || 0),
        ranked: sorted.map((row) => ({ row, score: 0 }))
      })
      const selected = pickEvenly(sorted, perClusterCap)
      for (const row of selected) {
        pickedEvenly.push(toLocalPrototypeRow({ row, clusterId: cluster.clusterId }))
      }
    }
    const selected =
      pickedEvenly.length <= safeCap
        ? pickedEvenly
        : pickEvenly(
          pickedEvenly.sort((a, b) => String(a?.eventDate ?? "").localeCompare(String(b?.eventDate ?? ""))),
          safeCap,
        )
    return {
      selected,
      rankedBuckets
    }
  }

  const latestEventMs = clusters.reduce((acc, cluster) => {
    const localMax = (cluster?.templates ?? []).reduce((innerAcc, row) => {
      const eventMs = parseDateKeyUtcMs(row?.eventDate) ?? parseDateKeyUtcMs(row?.asOfDate) ?? null
      if (!Number.isFinite(eventMs)) return innerAcc
      return Math.max(innerAcc, eventMs)
    }, Number.NEGATIVE_INFINITY)
    return Math.max(acc, localMax)
  }, Number.NEGATIVE_INFINITY)
  const maxCandidatesPerCluster = Math.max(
    8,
    Math.floor(Number(selectCfg?.maxCandidatesPerCluster ?? 80) || 80),
  )
  const maxPerSymbol = Math.max(1, Math.floor(Number(selectCfg?.maxPerSymbol ?? 4) || 4))
  const minPerCluster = Math.max(0, Math.floor(Number(selectCfg?.minPerCluster ?? 1) || 1))
  const recentShare = clamp01(selectCfg?.recentShare ?? 0.5)
  const anchorShare = clamp01(selectCfg?.anchorShare ?? 0.5)
  const prototypeEraCapEnabled =
    eraPlan?.enabled === true && temporalCfg?.prototypeEraCapEnabled === true
  const maxSelectedPrototypeEraShare = clamp01(
    temporalCfg?.maxSelectedPrototypeEraShare ?? 1,
  )
  const shortlistKey = (row) =>
    String(row?.templateId ?? "").trim() ||
    `${String(row?.symbol ?? "").trim()}@${String(row?.eventDate ?? row?.asOfDate ?? "")}`
  const averageTemplateExpectedNetRet3d = (rows) => {
    const values = (rows ?? [])
      .map((row) => Number(row?.templateExpectedNetRet3d ?? 0) || 0)
      .filter(Number.isFinite)
    if (!values.length) return 0
    return values.reduce((acc, value) => acc + value, 0) / values.length
  }

  const buildEraQuotaRows = ({
    anchorScored,
    clusterTemporalStats,
    cap
  }) => {
    if (prototypeEraCapEnabled !== true || eraPlan?.enabled !== true || cap <= 0) return []
    const eraStats = Array.isArray(clusterTemporalStats?.eraStats) ? clusterTemporalStats.eraStats : []
    if (!eraStats.length) return []
    const eraBuckets = new Map()
    for (const item of anchorScored) {
      const eraId = eraPlan.resolveEraId(item?.row) ?? null
      if (!eraId) continue
      const rows = eraBuckets.get(eraId) ?? []
      rows.push(item.row)
      eraBuckets.set(eraId, rows)
    }
    const orderedEraIds = eraStats
      .filter((row) => eraBuckets.has(String(row?.eraId ?? "")))
      .slice()
      .sort((left, right) => {
        const leftShare = Number(left?.supportShare ?? 0) || 0
        const rightShare = Number(right?.supportShare ?? 0) || 0
        if (leftShare !== rightShare) return leftShare - rightShare
        return String(left?.eraId ?? "").localeCompare(String(right?.eraId ?? ""))
      })
      .map((row) => String(row?.eraId ?? ""))
    if (!orderedEraIds.length) return []
    const cursors = new Map(orderedEraIds.map((eraId) => [eraId, 0]))
    const rows = []
    let progressed = true
    while (rows.length < cap && progressed) {
      progressed = false
      for (const eraId of orderedEraIds) {
        const bucket = eraBuckets.get(eraId) ?? []
        const cursor = Number(cursors.get(eraId) ?? 0)
        if (cursor >= bucket.length) continue
        rows.push(bucket[cursor])
        cursors.set(eraId, cursor + 1)
        progressed = true
        if (rows.length >= cap) break
      }
    }
    return rows
  }

  const buckets = clusters.map((cluster) => {
    const clusterId = String(cluster?.clusterId ?? "")
    const stats = clusterQualityById?.get(clusterId) ?? {
      qualityScore: 0.5,
      antiScore: 0,
      winRate3d: 0,
      expectedNetRet3d: 0
    }
    const templateRows = (cluster?.templates ?? []).slice()
    const clusterTemporalStats = clusterTemporalById?.get(clusterId) ?? null
    const recentCap = Math.max(
      1,
      Math.min(
        maxCandidatesPerCluster,
        Math.round(maxCandidatesPerCluster * (recentShare + 1e-9)),
      ),
    )
    const anchorCap = Math.max(1, maxCandidatesPerCluster - recentCap)
    const recentRows = templateRows
      .slice()
      .sort((a, b) => String(b?.eventDate ?? "").localeCompare(String(a?.eventDate ?? "")))
      .slice(0, recentCap)
    const anchorScored = templateRows
      .map((row) => ({
        row,
        score: scorePrototypeCandidate({
          row,
          clusterStats: stats,
          clusterTemporalStats: clusterTemporalById?.get(clusterId) ?? null,
          qualityCfg,
          selectionCfg: {
            ...selectCfg,
            recencyWeight: 0
          },
          latestEventMs,
          eraPlan
        })
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return String(b?.row?.eventDate ?? "").localeCompare(String(a?.row?.eventDate ?? ""))
      })
    const eraSeedRows = []
    if (prototypeEraCapEnabled === true) {
      const seenEra = new Set()
      for (const item of anchorScored) {
        const eraId = eraPlan.resolveEraId(item?.row) ?? null
        if (!eraId || seenEra.has(eraId)) continue
        seenEra.add(eraId)
        eraSeedRows.push(item.row)
      }
    }
    const eraQuotaRows = buildEraQuotaRows({
      anchorScored,
      clusterTemporalStats,
      cap: anchorCap
    })
    const anchorRows =
      eraQuotaRows.length > 0
        ? eraQuotaRows
        : anchorScored
            .slice(0, anchorCap)
            .map((it) => it.row)
    const shortlisted = []
    const seen = new Set()
    for (const row of recentRows.concat(eraSeedRows, anchorRows)) {
      const key = shortlistKey(row)
      if (!key || seen.has(key)) continue
      seen.add(key)
      shortlisted.push(row)
      if (shortlisted.length >= maxCandidatesPerCluster) break
    }
    if (shortlisted.length < maxCandidatesPerCluster) {
      const recentFallback = templateRows
        .slice()
        .sort((a, b) => String(b?.eventDate ?? "").localeCompare(String(a?.eventDate ?? "")))
      for (const row of recentFallback) {
        const key = shortlistKey(row)
        if (!key || seen.has(key)) continue
        seen.add(key)
        shortlisted.push(row)
        if (shortlisted.length >= maxCandidatesPerCluster) break
      }
    }
    const ranked = shortlisted
      .map((row) => ({
        row,
        score: scorePrototypeCandidate({
          row,
          clusterStats: stats,
          clusterTemporalStats: clusterTemporalById?.get(clusterId) ?? null,
          qualityCfg,
          selectionCfg: selectCfg,
          latestEventMs,
          eraPlan
        })
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return String(b?.row?.eventDate ?? "").localeCompare(String(a?.row?.eventDate ?? ""))
      })
    return {
      clusterId,
      support: Math.max(0, Number(cluster?.templates?.length ?? 0) || 0),
      ranked,
      cursor: 0
    }
  })
  buckets.sort((a, b) => {
    if (b.support !== a.support) return b.support - a.support
    return String(a.clusterId).localeCompare(String(b.clusterId))
  })

  const symbolCounts = new Map()
  const eraCounts = new Map()
  const selected = []
  const resolveMaxAllowedEraCount = (projectedTotal) =>
    Math.max(1, Math.floor(Math.max(1, projectedTotal) * maxSelectedPrototypeEraShare + 1e-9))
  const canTakeEra = (eraId) => {
    if (prototypeEraCapEnabled !== true || !eraId || maxSelectedPrototypeEraShare >= 1) return true
    const projectedTotal = selected.length + 1
    const projectedEraCount = Number(eraCounts.get(eraId) ?? 0) + 1
    return projectedEraCount <= resolveMaxAllowedEraCount(projectedTotal)
  }
  const tryTake = (bucket, enforceSymbolCap, enforceEraCap = true) => {
    while (bucket.cursor < bucket.ranked.length) {
      const candidate = bucket.ranked[bucket.cursor]
      bucket.cursor += 1
      const symbol = String(candidate?.row?.symbol ?? "").trim()
      const currentSymbolCount = Number(symbolCounts.get(symbol) ?? 0)
      if (enforceSymbolCap && symbol && currentSymbolCount >= maxPerSymbol) {
        continue
      }
      const eraId =
        prototypeEraCapEnabled === true ? eraPlan.resolveEraId(candidate?.row) ?? null : null
      if (enforceEraCap && !canTakeEra(eraId)) {
        continue
      }
      if (symbol) symbolCounts.set(symbol, currentSymbolCount + 1)
      if (eraId) eraCounts.set(eraId, Number(eraCounts.get(eraId) ?? 0) + 1)
      selected.push(toLocalPrototypeRow({ row: candidate.row, clusterId: bucket.clusterId }))
      return true
    }
    return false
  }

  if (minPerCluster > 0) {
    for (const bucket of buckets) {
      for (let i = 0; i < minPerCluster; i += 1) {
        if (selected.length >= safeCap) break
        if (!tryTake(bucket, true, true)) break
      }
      if (selected.length >= safeCap) break
    }
  }

  let progressed = true
  while (selected.length < safeCap && progressed) {
    progressed = false
    for (const bucket of buckets) {
      if (selected.length >= safeCap) break
      if (tryTake(bucket, true, true)) progressed = true
    }
  }
  if (selected.length < safeCap) {
    for (const bucket of buckets) {
      while (selected.length < safeCap && tryTake(bucket, false, false)) {}
      if (selected.length >= safeCap) break
    }
  }
  const selectedLimited = selected.slice(0, safeCap)
  const maxClusterShare = clamp01(selectCfg?.maxClusterShare ?? 1)
  const minDistinctClusters = Math.max(1, Math.floor(Number(selectCfg?.minDistinctClusters ?? 1) || 1))
  if (maxClusterShare >= 1 && minDistinctClusters <= 1) {
    return {
      selected: selectedLimited,
      summary: {
        returnTailShortlistSwapCount: 0,
        returnTailShortlistTargetExpectedNetRet3dAvg: 0,
        returnTailShortlistAchievedExpectedNetRet3dAvg: averageTemplateExpectedNetRet3d(selectedLimited)
      },
      rankedBuckets: buckets.map((bucket) => ({
        clusterId: bucket.clusterId,
        support: bucket.support,
        ranked: bucket.ranked
      }))
    }
  }

  const maxPerCluster = Math.max(
    1,
    Math.min(
      safeCap,
      Math.max(minPerCluster, Math.floor(safeCap * Math.max(maxClusterShare, 1 / safeCap))),
    ),
  )
  const byClusterCount = new Map()
  const bySymbolCount = new Map()
  const selectedKeys = new Set()
  const capped = []
  for (const row of selectedLimited) {
    const clusterId = String(row?.clusterId ?? "")
    const symbol = String(row?.symbol ?? "").trim()
    const clusterCount = Number(byClusterCount.get(clusterId) ?? 0)
    if (clusterCount >= maxPerCluster) continue
    const symbolCount = Number(bySymbolCount.get(symbol) ?? 0)
    if (symbol && symbolCount >= maxPerSymbol) continue
    const key = shortlistKey(row)
    if (selectedKeys.has(key)) continue
    selectedKeys.add(key)
    capped.push(row)
    byClusterCount.set(clusterId, clusterCount + 1)
    if (symbol) bySymbolCount.set(symbol, symbolCount + 1)
  }

  let capFillProgressed = true
  while (capped.length < safeCap && capFillProgressed) {
    capFillProgressed = false
    for (const bucket of buckets) {
      const clusterId = String(bucket?.clusterId ?? "")
      if (Number(byClusterCount.get(clusterId) ?? 0) >= maxPerCluster) continue
      for (const candidate of bucket?.ranked ?? []) {
        const row = candidate?.row
        if (!row) continue
        const key = shortlistKey(row)
        if (selectedKeys.has(key)) continue
        const symbol = String(row?.symbol ?? "").trim()
        const symbolCount = Number(bySymbolCount.get(symbol) ?? 0)
        if (symbol && symbolCount >= maxPerSymbol) continue
        selectedKeys.add(key)
        capped.push(toLocalPrototypeRow({ row, clusterId }))
        byClusterCount.set(clusterId, Number(byClusterCount.get(clusterId) ?? 0) + 1)
        if (symbol) bySymbolCount.set(symbol, symbolCount + 1)
        capFillProgressed = true
        break
      }
      if (capped.length >= safeCap) break
    }
  }

  const distinctClusters = new Set(capped.map((row) => String(row?.clusterId ?? ""))).size
  if (distinctClusters < minDistinctClusters) {
    const existing = new Set(capped.map((row) => String(row?.clusterId ?? "")))
    const missingBuckets = buckets.filter((bucket) => !existing.has(String(bucket?.clusterId ?? "")))
    for (const bucket of missingBuckets) {
      if (new Set(capped.map((row) => String(row?.clusterId ?? ""))).size >= minDistinctClusters) break
      const clusterId = String(bucket?.clusterId ?? "")
      const candidate = (bucket?.ranked ?? []).find((it) => {
        const row = it?.row
        if (!row) return false
        const key = shortlistKey(row)
        if (selectedKeys.has(key)) return false
        const symbol = String(row?.symbol ?? "").trim()
        const symbolCount = Number(bySymbolCount.get(symbol) ?? 0)
        return !symbol || symbolCount < maxPerSymbol
      })
      if (!candidate?.row) continue
      const key = shortlistKey(candidate.row)
      selectedKeys.add(key)
      capped.push(toLocalPrototypeRow({ row: candidate.row, clusterId }))
      byClusterCount.set(clusterId, Number(byClusterCount.get(clusterId) ?? 0) + 1)
      const symbol = String(candidate.row?.symbol ?? "").trim()
      if (symbol) bySymbolCount.set(symbol, Number(bySymbolCount.get(symbol) ?? 0) + 1)
      if (capped.length > safeCap) {
        let dropIdx = -1
        let dropClusterCount = -1
        for (let i = capped.length - 1; i >= 0; i -= 1) {
          const row = capped[i]
          const cId = String(row?.clusterId ?? "")
          if (cId === clusterId) continue
          const cCount = Number(byClusterCount.get(cId) ?? 0)
          if (cCount > dropClusterCount) {
            dropClusterCount = cCount
            dropIdx = i
          }
        }
        if (dropIdx >= 0) {
          const removed = capped.splice(dropIdx, 1)[0]
          const removedCluster = String(removed?.clusterId ?? "")
          const removedSymbol = String(removed?.symbol ?? "").trim()
          const rKey = shortlistKey(removed)
          selectedKeys.delete(rKey)
          byClusterCount.set(
            removedCluster,
            Math.max(0, Number(byClusterCount.get(removedCluster) ?? 0) - 1),
          )
          if (removedSymbol) {
            bySymbolCount.set(
              removedSymbol,
              Math.max(0, Number(bySymbolCount.get(removedSymbol) ?? 0) - 1),
            )
          }
        }
      }
    }
  }

  const shortlistReturnTailEnabled =
    temporalCfg?.returnTailRebalanceEnabled === true &&
    Number(temporalCfg?.targetSelectedExpectedNetRet3dAvg ?? 0) > 0 &&
    Number(temporalCfg?.maxReturnTailSwaps ?? 0) > 0
  const shortlistReturnTailTargetExpectedNetRet3dAvg = Math.max(
    0,
    Number(temporalCfg?.targetSelectedExpectedNetRet3dAvg ?? 0) || 0,
  )
  const shortlistMinReturnTailExpectedNetRet3d = Math.max(
    0,
    Number(temporalCfg?.minReturnTailExpectedNetRet3d ?? 0) || 0,
  )
  const shortlistMinReturnTailQualityScore = clamp01(
    temporalCfg?.minReturnTailQualityScore ?? 0,
  )
  const shortlistMaxReturnTailSwaps = Math.max(
    0,
    Math.floor(Number(temporalCfg?.maxReturnTailSwaps ?? 0) || 0),
  )
  let returnTailShortlistSwapCount = 0
  if (shortlistReturnTailEnabled && capped.length > 0) {
    const selectedByCluster = new Map()
    const selectedKeysLocal = new Set(capped.map((row) => shortlistKey(row)))
    const symbolCounts = new Map()
    for (let i = 0; i < capped.length; i += 1) {
      const row = capped[i]
      const clusterId = String(row?.clusterId ?? "")
      const entries = selectedByCluster.get(clusterId) ?? []
      entries.push({ index: i, row })
      selectedByCluster.set(clusterId, entries)
      const symbol = String(row?.symbol ?? "").trim()
      if (symbol) symbolCounts.set(symbol, Number(symbolCounts.get(symbol) ?? 0) + 1)
    }
    let currentAvg = averageTemplateExpectedNetRet3d(capped)
    for (const bucket of buckets) {
      if (returnTailShortlistSwapCount >= shortlistMaxReturnTailSwaps) break
      if (currentAvg >= shortlistReturnTailTargetExpectedNetRet3dAvg) break
      const clusterId = String(bucket?.clusterId ?? "")
      const selectedEntries = (selectedByCluster.get(clusterId) ?? [])
        .map((entry) => {
          const clusterStats = clusterQualityById?.get(clusterId) ?? {}
          const qualityMeta = buildTemplateQualityProxy({
            row: entry.row,
            clusterStats,
            qualityCfg
          })
          return {
            ...entry,
            expectedNetRet3d: Number(entry?.row?.templateExpectedNetRet3d ?? qualityMeta?.templateStats?.expectedNetRet3d ?? 0) || 0,
            qualityProxy: Number(qualityMeta?.qualityProxy ?? 0) || 0
          }
        })
        .sort((left, right) => {
          const byExpectedRet = Number(left?.expectedNetRet3d ?? 0) - Number(right?.expectedNetRet3d ?? 0)
          if (Math.abs(byExpectedRet) > 1e-12) return byExpectedRet
          const byQuality = Number(left?.qualityProxy ?? 0) - Number(right?.qualityProxy ?? 0)
          if (Math.abs(byQuality) > 1e-12) return byQuality
          return String(left?.row?.eventDate ?? "").localeCompare(String(right?.row?.eventDate ?? ""))
        })
      if (!selectedEntries.length) continue
      const clusterStats = clusterQualityById?.get(clusterId) ?? {}
      const candidateEntries = (bucket?.ranked ?? [])
        .map((entry) => {
          const row = entry?.row
          if (!row) return null
          const key = shortlistKey(row)
          if (!key || selectedKeysLocal.has(key)) return null
          const qualityMeta = buildTemplateQualityProxy({
            row,
            clusterStats,
            qualityCfg
          })
          const expectedNetRet3d =
            Number(qualityMeta?.templateStats?.expectedNetRet3d ?? 0) || 0
          const qualityProxy = Number(qualityMeta?.qualityProxy ?? 0) || 0
          if (expectedNetRet3d < shortlistMinReturnTailExpectedNetRet3d) return null
          if (qualityProxy < shortlistMinReturnTailQualityScore) return null
          return {
            row,
            key,
            expectedNetRet3d,
            qualityProxy
          }
        })
        .filter(Boolean)
        .sort((left, right) => {
          const byExpectedRet =
            Number(right?.expectedNetRet3d ?? 0) - Number(left?.expectedNetRet3d ?? 0)
          if (Math.abs(byExpectedRet) > 1e-12) return byExpectedRet
          const byQuality =
            Number(right?.qualityProxy ?? 0) - Number(left?.qualityProxy ?? 0)
          if (Math.abs(byQuality) > 1e-12) return byQuality
          return String(left?.row?.eventDate ?? "").localeCompare(String(right?.row?.eventDate ?? ""))
        })
      if (!candidateEntries.length) continue
      for (const candidate of candidateEntries) {
        if (returnTailShortlistSwapCount >= shortlistMaxReturnTailSwaps) break
        if (currentAvg >= shortlistReturnTailTargetExpectedNetRet3dAvg) break
        const victim = selectedEntries.find((entry) => {
          if (!entry) return false
          if (Number(candidate?.expectedNetRet3d ?? 0) <= Number(entry?.expectedNetRet3d ?? 0)) return false
          if (Number(candidate?.qualityProxy ?? 0) + 0.05 < Number(entry?.qualityProxy ?? 0)) return false
          const candidateSymbol = String(candidate?.row?.symbol ?? "").trim()
          const victimSymbol = String(entry?.row?.symbol ?? "").trim()
          if (!candidateSymbol || candidateSymbol === victimSymbol) return true
          return Number(symbolCounts.get(candidateSymbol) ?? 0) < maxPerSymbol
        })
        if (!victim) continue
        const victimKey = shortlistKey(victim.row)
        const victimSymbol = String(victim?.row?.symbol ?? "").trim()
        const candidateSymbol = String(candidate?.row?.symbol ?? "").trim()
        capped[victim.index] = toLocalPrototypeRow({ row: candidate.row, clusterId })
        selectedKeysLocal.delete(victimKey)
        selectedKeysLocal.add(candidate.key)
        if (victimSymbol) {
          symbolCounts.set(victimSymbol, Math.max(0, Number(symbolCounts.get(victimSymbol) ?? 0) - 1))
        }
        if (candidateSymbol) {
          symbolCounts.set(candidateSymbol, Number(symbolCounts.get(candidateSymbol) ?? 0) + 1)
        }
        victim.row = capped[victim.index]
        victim.expectedNetRet3d = Number(capped[victim.index]?.templateExpectedNetRet3d ?? 0) || 0
        const qualityMeta = buildTemplateQualityProxy({
          row: candidate.row,
          clusterStats,
          qualityCfg
        })
        victim.qualityProxy = Number(qualityMeta?.qualityProxy ?? 0) || 0
        returnTailShortlistSwapCount += 1
        currentAvg = averageTemplateExpectedNetRet3d(capped)
      }
    }
  }

  return {
    selected: capped.slice(0, safeCap),
    summary: {
      returnTailShortlistSwapCount,
      returnTailShortlistTargetExpectedNetRet3dAvg: shortlistReturnTailTargetExpectedNetRet3dAvg,
      returnTailShortlistAchievedExpectedNetRet3dAvg: averageTemplateExpectedNetRet3d(capped.slice(0, safeCap))
    },
    rankedBuckets: buckets.map((bucket) => ({
      clusterId: bucket.clusterId,
      support: bucket.support,
      ranked: bucket.ranked
    }))
  }
}

const rebalanceSelectedPrototypeEras = ({
  selectedPrototypes,
  rankedBuckets,
  annotatePrototype,
  eraPlan,
  temporalCfg
}) => {
  const rows = Array.isArray(selectedPrototypes) ? selectedPrototypes : []
  const requestedMaxEraShare = clamp01(temporalCfg?.maxSelectedPrototypeEraShare ?? 1)
  const enabled =
    rows.length > 0 &&
    eraPlan?.enabled === true &&
    temporalCfg?.prototypeEraCapEnabled === true &&
    requestedMaxEraShare < 1
  const baseSummary = {
    enabled,
    requestedMaxEraShare,
    selectedPrototypeCount: rows.length,
    selectedClusterCount: new Set(rows.map((row) => String(row?.clusterId ?? ""))).size,
    changedCount: 0,
    fallbackFillCount: 0,
    achievedMaxEraShare: summarizeSelectedPrototypeEraMix({
      prototypes: rows,
      eraPlan
    })?.maxEraShare ?? 0
  }
  if (enabled !== true) {
    return {
      prototypes: rows,
      summary: baseSummary
    }
  }
  const targetCountByCluster = new Map()
  for (const row of rows) {
    const clusterId = String(row?.clusterId ?? "")
    if (!clusterId) continue
    targetCountByCluster.set(clusterId, Number(targetCountByCluster.get(clusterId) ?? 0) + 1)
  }
  const buckets = (rankedBuckets ?? [])
    .filter((bucket) => targetCountByCluster.has(String(bucket?.clusterId ?? "")))
    .map((bucket) => ({
      clusterId: String(bucket?.clusterId ?? ""),
      targetCount: Number(targetCountByCluster.get(String(bucket?.clusterId ?? "")) ?? 0),
      picked: 0,
      cursor: 0,
      ranked: Array.isArray(bucket?.ranked) ? bucket.ranked : []
    }))
  const selected = []
  const selectedKeys = new Set()
  const eraCounts = new Map()
  const byOriginalTemplateId = new Set(rows.map((row) => String(row?.templateId ?? "").trim()).filter(Boolean))
  const resolveMaxAllowedEraCount = (projectedTotal) =>
    Math.max(1, Math.floor(Math.max(1, projectedTotal) * requestedMaxEraShare + 1e-9))
  const canTakeEra = (eraId) => {
    if (!eraId) return true
    const projectedTotal = selected.length + 1
    const projectedEraCount = Number(eraCounts.get(eraId) ?? 0) + 1
    return projectedEraCount <= resolveMaxAllowedEraCount(projectedTotal)
  }
  const takeCandidate = (bucket, enforceEraCap) => {
    while (bucket.cursor < bucket.ranked.length) {
      const candidate = bucket.ranked[bucket.cursor]
      bucket.cursor += 1
      const annotated = annotatePrototype(
        candidate?.row
          ? {
              ...candidate.row,
              clusterId: candidate?.row?.clusterId ?? bucket.clusterId
            }
          : null,
      )
      if (!annotated) continue
      const key = String(annotated?.templateId ?? "").trim()
      if (!key || selectedKeys.has(key)) continue
      if (!byOriginalTemplateId.has(key)) continue
      const eraId = eraPlan.resolveEraId(annotated) ?? annotated?.selectedEraId ?? null
      if (enforceEraCap && !canTakeEra(eraId)) continue
      selectedKeys.add(key)
      if (eraId) eraCounts.set(eraId, Number(eraCounts.get(eraId) ?? 0) + 1)
      selected.push(annotated)
      bucket.picked += 1
      return true
    }
    return false
  }
  let progressed = true
  while (selected.length < rows.length && progressed) {
    progressed = false
    for (const bucket of buckets) {
      if (bucket.picked >= bucket.targetCount) continue
      if (takeCandidate(bucket, true)) progressed = true
    }
  }
  let fallbackFillCount = 0
  if (selected.length < rows.length) {
    for (const bucket of buckets) {
      while (bucket.picked < bucket.targetCount && takeCandidate(bucket, false)) {
        fallbackFillCount += 1
      }
      if (selected.length >= rows.length) break
    }
  }
  if (selected.length < rows.length) {
    for (const row of rows) {
      const key = String(row?.templateId ?? "").trim()
      if (!key || selectedKeys.has(key)) continue
      selectedKeys.add(key)
      const eraId = eraPlan.resolveEraId(row) ?? row?.selectedEraId ?? null
      if (eraId) eraCounts.set(eraId, Number(eraCounts.get(eraId) ?? 0) + 1)
      selected.push(row)
      fallbackFillCount += 1
      if (selected.length >= rows.length) break
    }
  }
  const changedCount = selected.filter(
    (row) => !byOriginalTemplateId.has(String(row?.templateId ?? "").trim()),
  ).length
  const achievedMix = summarizeSelectedPrototypeEraMix({
    prototypes: selected,
    eraPlan
  })
  return {
    prototypes: selected,
    summary: {
      ...baseSummary,
      changedCount,
      fallbackFillCount,
      achievedMaxEraShare: Number(achievedMix?.maxEraShare ?? 0)
    }
  }
}

const applyPrototypeConsistencyFilter = ({
  prototypes,
  clusterSupportById,
  selectionCfg,
  temporalCfg
}) => {
  const rows = Array.isArray(prototypes) ? prototypes : []
  const cfg = selectionCfg ?? {}
  const temporalSelectionCfg = temporalCfg ?? {}
  const minClusterSupport = Math.max(1, Math.floor(Number(cfg?.minClusterSupport ?? 5) || 5))
  const minQualityTrades = Math.max(0, Math.floor(Number(cfg?.minQualityTrades ?? 8) || 8))
  const baseMinContrastiveSamples = Math.max(0, Math.floor(Number(cfg?.minContrastiveSamples ?? 30) || 30))
  const baseMinQualityScore = clamp01(cfg?.minQualityScore ?? 0.55)
  const minPrototypeFloor = Math.max(1, Math.floor(Number(cfg?.minPrototypeFloor ?? 24) || 24))
  const minClusterFloor = Math.max(1, Math.floor(Number(cfg?.minClusterFloor ?? 8) || 8))
  const maxBackfillAdditions = Math.max(
    0,
    Math.floor(Number(cfg?.maxBackfillAdditions ?? 128) || 128),
  )
  const maxBackfillRatio = Math.max(0, Number(cfg?.maxBackfillRatio ?? 2) || 0)
  const relaxRounds = Math.max(0, Math.floor(Number(cfg?.relaxRounds ?? 3) || 3))
  const relaxMinQualityScoreStep = clamp01(cfg?.relaxMinQualityScoreStep ?? 0.03)
  const relaxMinContrastiveSamplesStep = Math.max(
    0,
    Math.floor(Number(cfg?.relaxMinContrastiveSamplesStep ?? 6) || 6),
  )
  const temporalSelectionEnabled =
    temporalSelectionCfg?.enabled === true && temporalSelectionCfg?.selectionEnabled === true
  const baseMinEraCoverageRatio = clamp01(temporalSelectionCfg?.minEraCoverageRatio ?? 0)
  const baseMaxSingleEraShare = clamp01(temporalSelectionCfg?.maxSingleEraShare ?? 1)
  const baseMinEraSupportCount = Math.max(
    0,
    Math.floor(Number(temporalSelectionCfg?.minEraSupportCount ?? 0) || 0),
  )
  const appliedEraCount = Math.max(
    1,
    Math.floor(Number(temporalSelectionCfg?.appliedEraCount ?? temporalSelectionCfg?.eraCount ?? 1) || 1),
  )
  const baseMinEffectiveEraCountRatio = clamp01(
    temporalSelectionCfg?.minEffectiveEraCountRatio ?? 0,
  )
  const baseMinNormalizedEraEntropy = clamp01(
    temporalSelectionCfg?.minNormalizedEraEntropy ?? 0,
  )
  const baseMaxEraWinRateStd = Math.max(0, Number(temporalSelectionCfg?.maxEraWinRateStd ?? 1) || 0)
  const relaxMinEraCoverageRatioStep = clamp01(
    temporalSelectionCfg?.relaxMinEraCoverageRatioStep ?? 0.1,
  )
  const relaxMaxSingleEraShareStep = clamp01(
    temporalSelectionCfg?.relaxMaxSingleEraShareStep ?? 0.05,
  )
  const relaxMinEraSupportCountStep = Math.max(
    0,
    Math.floor(Number(temporalSelectionCfg?.relaxMinEraSupportCountStep ?? 1) || 0),
  )
  const relaxMinEffectiveEraCountRatioStep = clamp01(
    temporalSelectionCfg?.relaxMinEffectiveEraCountRatioStep ?? 0.1,
  )
  const relaxMinNormalizedEraEntropyStep = clamp01(
    temporalSelectionCfg?.relaxMinNormalizedEraEntropyStep ?? 0.1,
  )
  const relaxMaxEraWinRateStdStep = Math.max(
    0,
    Number(temporalSelectionCfg?.relaxMaxEraWinRateStdStep ?? 0) || 0,
  )
  const runFilter = ({
    minContrastiveSamples,
    minQualityScore,
    minEraCoverageRatio,
    maxSingleEraShare,
    minEraSupportCount,
    minEffectiveEraCountRatio,
    minNormalizedEraEntropy,
    maxEraWinRateStd
  }) => {
    const reasonCounts = {
      clusterSupport: 0,
      qualityTrades: 0,
      contrastiveSamples: 0,
      qualityScore: 0,
      temporalEraSupport: 0,
      temporalCoverage: 0,
      temporalConcentration: 0,
      temporalEffectiveEraCount: 0,
      temporalEntropy: 0,
      temporalWinRateStd: 0
    }
    const kept = []
    const temporalBackfillCandidates = []
    for (const row of rows) {
      const clusterId = String(row?.clusterId ?? "")
      const clusterSupport = Math.max(0, Number(clusterSupportById?.get(clusterId) ?? 0) || 0)
      const qualityTrades = Math.max(0, Number(row?.qualityTrades ?? 0) || 0)
      const contrastiveSamples = Math.max(0, Number(row?.contrastiveSamples ?? 0) || 0)
      const qualityScore = clamp01(row?.qualityScore ?? 0)
      const supportOk = clusterSupport >= minClusterSupport
      const tradesOk = qualityTrades >= minQualityTrades
      const contrastiveOk = contrastiveSamples >= minContrastiveSamples
      const qualityOk = qualityScore >= minQualityScore
      const temporalEraSupport = Math.max(0, Number(row?.clusterTemporalEraSupportCount ?? 0) || 0)
      const temporalCoverageRatio = clamp01(row?.clusterTemporalEraCoverageRatio ?? 0)
      const temporalMaxSingleEraShare = clamp01(row?.clusterTemporalMaxSingleEraShare ?? 0)
      const temporalEffectiveEraCount = Math.max(
        0,
        Number(row?.clusterTemporalEffectiveEraCount ?? 0) || 0,
      )
      const temporalEffectiveEraCountRatio = clamp01(temporalEffectiveEraCount / appliedEraCount)
      const temporalNormalizedEraEntropy = clamp01(
        row?.clusterTemporalNormalizedEraEntropy ?? 0,
      )
      const temporalEraWinRateStd = Math.max(0, Number(row?.clusterTemporalEraWinRateStd ?? 0) || 0)
      const temporalSupportOk =
        temporalSelectionEnabled !== true || temporalEraSupport >= minEraSupportCount
      const temporalCoverageOk =
        temporalSelectionEnabled !== true || temporalCoverageRatio >= minEraCoverageRatio
      const temporalConcentrationOk =
        temporalSelectionEnabled !== true || temporalMaxSingleEraShare <= maxSingleEraShare
      const temporalEffectiveEraCountOk =
        temporalSelectionEnabled !== true ||
        temporalEffectiveEraCountRatio >= minEffectiveEraCountRatio
      const temporalEntropyOk =
        temporalSelectionEnabled !== true ||
        temporalNormalizedEraEntropy >= minNormalizedEraEntropy
      const temporalWinRateStdOk =
        temporalSelectionEnabled !== true || temporalEraWinRateStd <= maxEraWinRateStd
      const coreOk = supportOk && tradesOk && contrastiveOk && qualityOk
      const temporalOk =
        temporalSupportOk &&
        temporalCoverageOk &&
        temporalConcentrationOk &&
        temporalEffectiveEraCountOk &&
        temporalEntropyOk &&
        temporalWinRateStdOk
      if (
        coreOk &&
        temporalOk
      ) {
        kept.push(row)
        continue
      }
      if (coreOk && temporalSelectionEnabled === true && temporalOk !== true) {
        temporalBackfillCandidates.push({
          row,
          temporalCoverageRatio,
          temporalMaxSingleEraShare,
          temporalEraSupport,
          temporalEffectiveEraCount,
          temporalEffectiveEraCountRatio,
          temporalNormalizedEraEntropy,
          temporalEraWinRateStd,
          qualityScore,
          contrastiveSamples,
          expectedNetRet3d: Number(row?.expectedNetRet3d ?? 0) || 0
        })
      }
      if (!supportOk) reasonCounts.clusterSupport += 1
      if (!tradesOk) reasonCounts.qualityTrades += 1
      if (!contrastiveOk) reasonCounts.contrastiveSamples += 1
      if (!qualityOk) reasonCounts.qualityScore += 1
      if (!temporalSupportOk) reasonCounts.temporalEraSupport += 1
      if (!temporalCoverageOk) reasonCounts.temporalCoverage += 1
      if (!temporalConcentrationOk) reasonCounts.temporalConcentration += 1
      if (!temporalEffectiveEraCountOk) reasonCounts.temporalEffectiveEraCount += 1
      if (!temporalEntropyOk) reasonCounts.temporalEntropy += 1
      if (!temporalWinRateStdOk) reasonCounts.temporalWinRateStd += 1
    }
    const keptClusterCount = new Set(kept.map((row) => String(row?.clusterId ?? ""))).size
    return {
      kept,
      reasonCounts,
      keptClusterCount,
      temporalBackfillCandidates
    }
  }
  const compareTemporalBackfillCandidates = (left, right) => {
    const byCoverage =
      Number(right?.temporalCoverageRatio ?? 0) - Number(left?.temporalCoverageRatio ?? 0)
    if (Math.abs(byCoverage) > 1e-12) return byCoverage
    const byEffectiveEraCountRatio =
      Number(right?.temporalEffectiveEraCountRatio ?? 0) -
      Number(left?.temporalEffectiveEraCountRatio ?? 0)
    if (Math.abs(byEffectiveEraCountRatio) > 1e-12) return byEffectiveEraCountRatio
    const byEntropy =
      Number(right?.temporalNormalizedEraEntropy ?? 0) -
      Number(left?.temporalNormalizedEraEntropy ?? 0)
    if (Math.abs(byEntropy) > 1e-12) return byEntropy
    const byShare =
      Number(left?.temporalMaxSingleEraShare ?? 0) - Number(right?.temporalMaxSingleEraShare ?? 0)
    if (Math.abs(byShare) > 1e-12) return byShare
    const bySupport = Number(right?.temporalEraSupport ?? 0) - Number(left?.temporalEraSupport ?? 0)
    if (Math.abs(bySupport) > 1e-12) return bySupport
    const byStd =
      Number(left?.temporalEraWinRateStd ?? 0) - Number(right?.temporalEraWinRateStd ?? 0)
    if (Math.abs(byStd) > 1e-12) return byStd
    const byQuality = Number(right?.qualityScore ?? 0) - Number(left?.qualityScore ?? 0)
    if (Math.abs(byQuality) > 1e-12) return byQuality
    const byContrastive =
      Number(right?.contrastiveSamples ?? 0) - Number(left?.contrastiveSamples ?? 0)
    if (Math.abs(byContrastive) > 1e-12) return byContrastive
    const byExpectedRet =
      Number(right?.expectedNetRet3d ?? 0) - Number(left?.expectedNetRet3d ?? 0)
    if (Math.abs(byExpectedRet) > 1e-12) return byExpectedRet
    return String(left?.row?.templateId ?? "").localeCompare(String(right?.row?.templateId ?? ""))
  }
  const averageExpectedNetRet3d = (items) => {
    const values = (items ?? [])
      .map((item) => Number(item?.expectedNetRet3d ?? 0) || 0)
      .filter(Number.isFinite)
    if (!values.length) return 0
    return values.reduce((acc, value) => acc + value, 0) / values.length
  }
  const compareReturnTailCandidates = (left, right) => {
    const byExpectedRet =
      Number(right?.expectedNetRet3d ?? 0) - Number(left?.expectedNetRet3d ?? 0)
    if (Math.abs(byExpectedRet) > 1e-12) return byExpectedRet
    const byQuality = Number(right?.qualityScore ?? 0) - Number(left?.qualityScore ?? 0)
    if (Math.abs(byQuality) > 1e-12) return byQuality
    const byCoverage =
      Number(right?.temporalCoverageRatio ?? 0) - Number(left?.temporalCoverageRatio ?? 0)
    if (Math.abs(byCoverage) > 1e-12) return byCoverage
    const byEffectiveEraCountRatio =
      Number(right?.temporalEffectiveEraCountRatio ?? 0) -
      Number(left?.temporalEffectiveEraCountRatio ?? 0)
    if (Math.abs(byEffectiveEraCountRatio) > 1e-12) return byEffectiveEraCountRatio
    const byEntropy =
      Number(right?.temporalNormalizedEraEntropy ?? 0) -
      Number(left?.temporalNormalizedEraEntropy ?? 0)
    if (Math.abs(byEntropy) > 1e-12) return byEntropy
    const byShare =
      Number(left?.temporalMaxSingleEraShare ?? 0) - Number(right?.temporalMaxSingleEraShare ?? 0)
    if (Math.abs(byShare) > 1e-12) return byShare
    return String(left?.row?.templateId ?? "").localeCompare(String(right?.row?.templateId ?? ""))
  }
  const applyTemporalBackfill = (result) => {
    if (temporalSelectionEnabled !== true) {
      return {
        ...result,
        temporalStableCoreCount: result.kept.length,
        temporalBackfillAdded: 0,
        temporalBackfillCapacity: 0,
        selectedExpectedNetRet3dAvg: averageExpectedNetRet3d(result.kept),
        returnTailSwapCount: 0,
        returnTailTargetExpectedNetRet3dAvg: 0,
        returnTailAchievedExpectedNetRet3dAvg: averageExpectedNetRet3d(result.kept)
      }
    }
    const stableCore = Array.isArray(result?.kept) ? result.kept.slice() : []
    const stableClusterCount = new Set(stableCore.map((row) => String(row?.clusterId ?? ""))).size
    const needPrototypeCount = Math.max(0, minPrototypeFloor - stableCore.length)
    const needClusterCount = Math.max(0, minClusterFloor - stableClusterCount)
    const desiredAdditions = Math.max(needPrototypeCount, needClusterCount)
    const backfillCapByRatio =
      maxBackfillRatio > 0 ? Math.ceil(Math.max(1, stableCore.length) * maxBackfillRatio) : 0
    const temporalBackfillCapacity =
      maxBackfillAdditions > 0 && backfillCapByRatio > 0
        ? Math.min(maxBackfillAdditions, backfillCapByRatio)
        : Math.max(maxBackfillAdditions, backfillCapByRatio)
    if (desiredAdditions < 1 || temporalBackfillCapacity < 1) {
      return {
        ...result,
        temporalStableCoreCount: stableCore.length,
        temporalBackfillAdded: 0,
        temporalBackfillCapacity,
        selectedExpectedNetRet3dAvg: averageExpectedNetRet3d(stableCore),
        returnTailSwapCount: 0,
        returnTailTargetExpectedNetRet3dAvg: 0,
        returnTailAchievedExpectedNetRet3dAvg: averageExpectedNetRet3d(stableCore)
      }
    }
    const chosen = stableCore.slice()
    const chosenKeys = new Set(
      chosen.map((row) => String(row?.templateId ?? "").trim()).filter(Boolean),
    )
    const backfill = []
    for (const candidate of (result?.temporalBackfillCandidates ?? []).slice().sort(compareTemporalBackfillCandidates)) {
      const row = candidate?.row
      const key = String(row?.templateId ?? "").trim()
      if (!row || !key || chosenKeys.has(key)) continue
      if (backfill.length >= temporalBackfillCapacity) break
      chosenKeys.add(key)
      chosen.push(row)
      backfill.push(row)
      const chosenClusterCount = new Set(chosen.map((it) => String(it?.clusterId ?? ""))).size
      if (chosen.length >= minPrototypeFloor && chosenClusterCount >= minClusterFloor) break
    }
    return {
      ...result,
      kept: chosen,
      keptClusterCount: new Set(chosen.map((row) => String(row?.clusterId ?? ""))).size,
      temporalStableCoreCount: stableCore.length,
      temporalBackfillAdded: backfill.length,
      temporalBackfillCapacity,
      selectedExpectedNetRet3dAvg: averageExpectedNetRet3d(chosen),
      returnTailSwapCount: 0,
      returnTailTargetExpectedNetRet3dAvg: 0,
      returnTailAchievedExpectedNetRet3dAvg: averageExpectedNetRet3d(chosen)
    }
  }
  const applyReturnTailRebalance = (result) => {
    const enabled =
      temporalSelectionEnabled === true &&
      temporalSelectionCfg?.returnTailRebalanceEnabled === true &&
      Number(temporalSelectionCfg?.targetSelectedExpectedNetRet3dAvg ?? 0) > 0 &&
      Number(temporalSelectionCfg?.maxReturnTailSwaps ?? 0) > 0
    const keptRows = Array.isArray(result?.kept) ? result.kept.slice() : []
    const currentAvgExpectedNetRet3d = averageExpectedNetRet3d(keptRows)
    const targetSelectedExpectedNetRet3dAvg = Math.max(
      0,
      Number(temporalSelectionCfg?.targetSelectedExpectedNetRet3dAvg ?? 0) || 0,
    )
    const basePayload = {
      ...result,
      selectedExpectedNetRet3dAvg: currentAvgExpectedNetRet3d,
      returnTailSwapCount: 0,
      returnTailTargetExpectedNetRet3dAvg: targetSelectedExpectedNetRet3dAvg,
      returnTailAchievedExpectedNetRet3dAvg: currentAvgExpectedNetRet3d
    }
    if (enabled !== true || currentAvgExpectedNetRet3d >= targetSelectedExpectedNetRet3dAvg) {
      return basePayload
    }
    const minReturnTailExpectedNetRet3d = Math.max(
      0,
      Number(temporalSelectionCfg?.minReturnTailExpectedNetRet3d ?? 0) || 0,
    )
    const minReturnTailQualityScore = clamp01(
      temporalSelectionCfg?.minReturnTailQualityScore ?? 0,
    )
    const maxReturnTailSwaps = Math.max(
      0,
      Math.floor(Number(temporalSelectionCfg?.maxReturnTailSwaps ?? 0) || 0),
    )
    const chosen = keptRows.slice()
    const chosenKeys = new Set(
      chosen.map((row) => String(row?.templateId ?? "").trim()).filter(Boolean),
    )
    const candidates = (result?.temporalBackfillCandidates ?? [])
      .filter((candidate) => {
        const row = candidate?.row
        const key = String(row?.templateId ?? "").trim()
        if (!row || !key || chosenKeys.has(key)) return false
        if (Number(candidate?.expectedNetRet3d ?? 0) < minReturnTailExpectedNetRet3d) return false
        if (Number(candidate?.qualityScore ?? 0) < minReturnTailQualityScore) return false
        return true
      })
      .slice()
      .sort(compareReturnTailCandidates)
    if (!candidates.length) {
      return basePayload
    }
    const victims = chosen
      .map((row, index) => ({
        index,
        row,
        expectedNetRet3d: Number(row?.expectedNetRet3d ?? 0) || 0,
        qualityScore: Number(row?.qualityScore ?? 0) || 0,
        temporalCoverageRatio: Number(row?.clusterTemporalEraCoverageRatio ?? 0) || 0,
        temporalEffectiveEraCountRatio: Number(row?.clusterTemporalEffectiveEraCountRatio ?? 0) || 0,
        temporalNormalizedEraEntropy: Number(row?.clusterTemporalNormalizedEraEntropy ?? 0) || 0,
        temporalMaxSingleEraShare: Number(row?.clusterTemporalMaxSingleEraShare ?? 0) || 0
      }))
      .sort((left, right) => {
        const byExpectedRet = Number(left?.expectedNetRet3d ?? 0) - Number(right?.expectedNetRet3d ?? 0)
        if (Math.abs(byExpectedRet) > 1e-12) return byExpectedRet
        const byQuality = Number(left?.qualityScore ?? 0) - Number(right?.qualityScore ?? 0)
        if (Math.abs(byQuality) > 1e-12) return byQuality
        const byCoverage =
          Number(left?.temporalCoverageRatio ?? 0) - Number(right?.temporalCoverageRatio ?? 0)
        if (Math.abs(byCoverage) > 1e-12) return byCoverage
        const byEffectiveEraCountRatio =
          Number(left?.temporalEffectiveEraCountRatio ?? 0) -
          Number(right?.temporalEffectiveEraCountRatio ?? 0)
        if (Math.abs(byEffectiveEraCountRatio) > 1e-12) return byEffectiveEraCountRatio
        const byEntropy =
          Number(left?.temporalNormalizedEraEntropy ?? 0) -
          Number(right?.temporalNormalizedEraEntropy ?? 0)
        if (Math.abs(byEntropy) > 1e-12) return byEntropy
        const byShare =
          Number(right?.temporalMaxSingleEraShare ?? 0) - Number(left?.temporalMaxSingleEraShare ?? 0)
        if (Math.abs(byShare) > 1e-12) return byShare
        return String(left?.row?.templateId ?? "").localeCompare(String(right?.row?.templateId ?? ""))
      })
    const replacedVictimIndices = new Set()
    let swapCount = 0
    for (const candidate of candidates) {
      if (swapCount >= maxReturnTailSwaps) break
      if (averageExpectedNetRet3d(chosen) >= targetSelectedExpectedNetRet3dAvg) break
      const candidateRow = candidate?.row
      const candidateKey = String(candidateRow?.templateId ?? "").trim()
      if (!candidateRow || !candidateKey || chosenKeys.has(candidateKey)) continue
      const victim = victims.find((entry) => {
        if (!entry || replacedVictimIndices.has(entry.index)) return false
        if (candidate.expectedNetRet3d <= Number(entry?.expectedNetRet3d ?? 0)) return false
        return Number(candidate?.qualityScore ?? 0) + 0.05 >= Number(entry?.qualityScore ?? 0)
      })
      if (!victim) continue
      const victimKey = String(victim?.row?.templateId ?? "").trim()
      if (!victimKey) continue
      chosen[victim.index] = candidateRow
      chosenKeys.delete(victimKey)
      chosenKeys.add(candidateKey)
      replacedVictimIndices.add(victim.index)
      swapCount += 1
    }
    const achievedExpectedNetRet3dAvg = averageExpectedNetRet3d(chosen)
    return {
      ...result,
      kept: chosen,
      selectedExpectedNetRet3dAvg: achievedExpectedNetRet3dAvg,
      returnTailSwapCount: swapCount,
      returnTailTargetExpectedNetRet3dAvg: targetSelectedExpectedNetRet3dAvg,
      returnTailAchievedExpectedNetRet3dAvg: achievedExpectedNetRet3dAvg
    }
  }
  if (cfg.enabled !== true) {
    return {
      prototypes: rows,
      summary: {
        enabled: false,
        inputCount: rows.length,
        keptByConsistency: rows.length,
        prunedByConsistency: 0,
        minClusterSupport,
        minQualityTrades,
        minContrastiveSamples: baseMinContrastiveSamples,
        minQualityScore: baseMinQualityScore,
        minPrototypeFloor,
        minClusterFloor,
        keptClusterCount: new Set(rows.map((row) => String(row?.clusterId ?? ""))).size,
        relaxApplied: 0,
        effectiveMinContrastiveSamples: baseMinContrastiveSamples,
        effectiveMinQualityScore: baseMinQualityScore,
        temporalSelectionEnabled,
        minEraCoverageRatio: baseMinEraCoverageRatio,
        maxSingleEraShare: baseMaxSingleEraShare,
        minEraSupportCount: baseMinEraSupportCount,
        minEffectiveEraCountRatio: baseMinEffectiveEraCountRatio,
        minNormalizedEraEntropy: baseMinNormalizedEraEntropy,
        maxEraWinRateStd: baseMaxEraWinRateStd,
        effectiveMinEraCoverageRatio: baseMinEraCoverageRatio,
        effectiveMaxSingleEraShare: baseMaxSingleEraShare,
        effectiveMinEraSupportCount: baseMinEraSupportCount,
        effectiveMinEffectiveEraCountRatio: baseMinEffectiveEraCountRatio,
        effectiveMinNormalizedEraEntropy: baseMinNormalizedEraEntropy,
        effectiveMaxEraWinRateStd: baseMaxEraWinRateStd,
        temporalStableCoreCount: rows.length,
        temporalBackfillAdded: 0,
        temporalBackfillCapacity: 0,
        prunedReasons: {
          clusterSupport: 0,
          qualityTrades: 0,
          contrastiveSamples: 0,
          qualityScore: 0,
          temporalEraSupport: 0,
          temporalCoverage: 0,
          temporalConcentration: 0,
          temporalEffectiveEraCount: 0,
          temporalEntropy: 0,
          temporalWinRateStd: 0
        }
      }
    }
  }
  let chosen = applyReturnTailRebalance(applyTemporalBackfill(runFilter({
    minContrastiveSamples: baseMinContrastiveSamples,
    minQualityScore: baseMinQualityScore,
    minEraCoverageRatio: baseMinEraCoverageRatio,
    maxSingleEraShare: baseMaxSingleEraShare,
    minEraSupportCount: baseMinEraSupportCount,
    minEffectiveEraCountRatio: baseMinEffectiveEraCountRatio,
    minNormalizedEraEntropy: baseMinNormalizedEraEntropy,
    maxEraWinRateStd: baseMaxEraWinRateStd
  })))
  let chosenRelaxApplied = 0
  let chosenMinContrastiveSamples = baseMinContrastiveSamples
  let chosenMinQualityScore = baseMinQualityScore
  let chosenMinEraCoverageRatio = baseMinEraCoverageRatio
  let chosenMaxSingleEraShare = baseMaxSingleEraShare
  let chosenMinEraSupportCount = baseMinEraSupportCount
  let chosenMinEffectiveEraCountRatio = baseMinEffectiveEraCountRatio
  let chosenMinNormalizedEraEntropy = baseMinNormalizedEraEntropy
  let chosenMaxEraWinRateStd = baseMaxEraWinRateStd
  let best = { ...chosen }
  let bestScore = chosen.kept.length * 1000 + chosen.keptClusterCount
  const passFloor = (result) =>
    result.kept.length >= minPrototypeFloor && result.keptClusterCount >= minClusterFloor
  if (!passFloor(chosen)) {
    for (let round = 1; round <= relaxRounds; round += 1) {
      const minContrastiveSamples = Math.max(
        0,
        baseMinContrastiveSamples - round * relaxMinContrastiveSamplesStep,
      )
      const minQualityScore = clamp01(baseMinQualityScore - round * relaxMinQualityScoreStep)
      const minEraCoverageRatio = clamp01(
        baseMinEraCoverageRatio - round * relaxMinEraCoverageRatioStep,
      )
      const maxSingleEraShare = clamp01(
        baseMaxSingleEraShare + round * relaxMaxSingleEraShareStep,
      )
      const minEraSupportCount = Math.max(
        0,
        baseMinEraSupportCount - round * relaxMinEraSupportCountStep,
      )
      const minEffectiveEraCountRatio = clamp01(
        baseMinEffectiveEraCountRatio - round * relaxMinEffectiveEraCountRatioStep,
      )
      const minNormalizedEraEntropy = clamp01(
        baseMinNormalizedEraEntropy - round * relaxMinNormalizedEraEntropyStep,
      )
      const maxEraWinRateStd =
        baseMaxEraWinRateStd + round * relaxMaxEraWinRateStdStep
      const attempt = applyReturnTailRebalance(applyTemporalBackfill(runFilter({
        minContrastiveSamples,
        minQualityScore,
        minEraCoverageRatio,
        maxSingleEraShare,
        minEraSupportCount,
        minEffectiveEraCountRatio,
        minNormalizedEraEntropy,
        maxEraWinRateStd
      })))
      const score = attempt.kept.length * 1000 + attempt.keptClusterCount
      if (score > bestScore) {
        best = { ...attempt }
        bestScore = score
      }
      if (passFloor(attempt)) {
        chosen = attempt
        chosenRelaxApplied = round
        chosenMinContrastiveSamples = minContrastiveSamples
        chosenMinQualityScore = minQualityScore
        chosenMinEraCoverageRatio = minEraCoverageRatio
        chosenMaxSingleEraShare = maxSingleEraShare
        chosenMinEraSupportCount = minEraSupportCount
        chosenMinEffectiveEraCountRatio = minEffectiveEraCountRatio
        chosenMinNormalizedEraEntropy = minNormalizedEraEntropy
        chosenMaxEraWinRateStd = maxEraWinRateStd
        break
      }
    }
    if (chosenRelaxApplied === 0 && !passFloor(chosen)) {
      chosen = best
      chosenRelaxApplied = relaxRounds
      chosenMinContrastiveSamples = Math.max(
        0,
        baseMinContrastiveSamples - chosenRelaxApplied * relaxMinContrastiveSamplesStep,
      )
      chosenMinQualityScore = clamp01(baseMinQualityScore - chosenRelaxApplied * relaxMinQualityScoreStep)
      chosenMinEraCoverageRatio = clamp01(
        baseMinEraCoverageRatio - chosenRelaxApplied * relaxMinEraCoverageRatioStep,
      )
      chosenMaxSingleEraShare = clamp01(
        baseMaxSingleEraShare + chosenRelaxApplied * relaxMaxSingleEraShareStep,
      )
      chosenMinEraSupportCount = Math.max(
        0,
        baseMinEraSupportCount - chosenRelaxApplied * relaxMinEraSupportCountStep,
      )
      chosenMinEffectiveEraCountRatio = clamp01(
        baseMinEffectiveEraCountRatio - chosenRelaxApplied * relaxMinEffectiveEraCountRatioStep,
      )
      chosenMinNormalizedEraEntropy = clamp01(
        baseMinNormalizedEraEntropy - chosenRelaxApplied * relaxMinNormalizedEraEntropyStep,
      )
      chosenMaxEraWinRateStd =
        baseMaxEraWinRateStd + chosenRelaxApplied * relaxMaxEraWinRateStdStep
    }
  }
  return {
    prototypes: chosen.kept,
    summary: {
      enabled: true,
      inputCount: rows.length,
      keptByConsistency: chosen.kept.length,
      prunedByConsistency: Math.max(0, rows.length - chosen.kept.length),
      minClusterSupport,
      minQualityTrades,
      minContrastiveSamples: baseMinContrastiveSamples,
      minQualityScore: baseMinQualityScore,
      minPrototypeFloor,
      minClusterFloor,
      keptClusterCount: chosen.keptClusterCount,
      relaxApplied: chosenRelaxApplied,
      effectiveMinContrastiveSamples: chosenMinContrastiveSamples,
      effectiveMinQualityScore: chosenMinQualityScore,
      temporalSelectionEnabled,
      minEraCoverageRatio: baseMinEraCoverageRatio,
      maxSingleEraShare: baseMaxSingleEraShare,
      minEraSupportCount: baseMinEraSupportCount,
      minEffectiveEraCountRatio: baseMinEffectiveEraCountRatio,
      minNormalizedEraEntropy: baseMinNormalizedEraEntropy,
      maxEraWinRateStd: baseMaxEraWinRateStd,
      effectiveMinEraCoverageRatio: chosenMinEraCoverageRatio,
      effectiveMaxSingleEraShare: chosenMaxSingleEraShare,
      effectiveMinEraSupportCount: chosenMinEraSupportCount,
      effectiveMinEffectiveEraCountRatio: chosenMinEffectiveEraCountRatio,
      effectiveMinNormalizedEraEntropy: chosenMinNormalizedEraEntropy,
      effectiveMaxEraWinRateStd: chosenMaxEraWinRateStd,
      temporalStableCoreCount: Number(chosen.temporalStableCoreCount ?? chosen.kept.length),
      temporalBackfillAdded: Number(chosen.temporalBackfillAdded ?? 0),
      temporalBackfillCapacity: Number(chosen.temporalBackfillCapacity ?? 0),
      selectedExpectedNetRet3dAvg: Number(chosen.selectedExpectedNetRet3dAvg ?? 0),
      returnTailSwapCount: Number(chosen.returnTailSwapCount ?? 0),
      returnTailTargetExpectedNetRet3dAvg: Number(
        chosen.returnTailTargetExpectedNetRet3dAvg ?? 0,
      ),
      returnTailAchievedExpectedNetRet3dAvg: Number(
        chosen.returnTailAchievedExpectedNetRet3dAvg ?? 0,
      ),
      prunedReasons: chosen.reasonCounts
    }
  }
}

const buildGlobalPrototypes = ({ clusters, maxGlobalPrototypes }) => {
  const safeCap = Math.max(1, Number(maxGlobalPrototypes) || 180)
  const seed = []
  for (const cluster of clusters) {
    const rows = cluster.templates
      .slice()
      .sort((a, b) => String(a?.eventDate ?? "").localeCompare(String(b?.eventDate ?? "")))
    if (!rows.length) continue
    seed.push({
      templateId: rows[0].templateId,
      symbol: rows[0].symbol,
      eventDate: rows[0].eventDate,
      asOfDate: rows[0].asOfDate,
      clusterId: cluster.clusterId,
      globalFeatureVec: rows[0].globalFeatureVec,
      seq150: rows[0].seq150
    })
  }
  if (seed.length >= safeCap) return pickEvenly(seed, safeCap)
  return seed
}

const normalizeStageWeights = (raw) => {
  const out = {
    global: Number(raw?.global ?? 0.35),
    local: Number(raw?.local ?? 0.45),
    trigger: Number(raw?.trigger ?? 0.2)
  }
  for (const key of Object.keys(out)) {
    if (!Number.isFinite(out[key]) || out[key] < 0) out[key] = 0
  }
  const sum = out.global + out.local + out.trigger
  if (sum <= 0) return { global: 0.35, local: 0.45, trigger: 0.2 }
  return {
    global: out.global / sum,
    local: out.local / sum,
    trigger: out.trigger / sum
  }
}

const buildRuntimeScoringMeta = ({
  localFeatureStats,
  globalFeatureStats,
  clusterCenters,
  localWindow,
  globalWindow,
  stageWeights,
  coarseTopN,
  coarseTopClusters
}) => {
  const groupFeatureKeys = Object.fromEntries(GROUPS.map((g) => [g, []]))
  const groupDispersion = Object.fromEntries(GROUPS.map((g) => [g, 1]))
  const sums = Object.fromEntries(GROUPS.map((g) => [g, 0]))
  const counts = Object.fromEntries(GROUPS.map((g) => [g, 0]))

  for (const [key, stat] of Object.entries(localFeatureStats ?? {})) {
    const group = String(key ?? "").split(".")[0]
    if (!Object.prototype.hasOwnProperty.call(groupFeatureKeys, group)) continue
    groupFeatureKeys[group].push(key)
    const s = Math.abs(Number(stat?.stdev ?? 0))
    if (Number.isFinite(s) && s > 0) {
      sums[group] += s
      counts[group] += 1
    }
  }
  for (const group of GROUPS) {
    groupFeatureKeys[group].sort((a, b) => a.localeCompare(b))
    if (counts[group] > 0) {
      groupDispersion[group] = sums[group] / counts[group]
    }
  }

  return {
    version: "v2_hybrid_150_40_runtime",
    mode: "hybrid_150_40",
    groups: GROUPS,
    groupFeatureKeys,
    groupDispersion,
    localWindow,
    globalWindow,
    sequenceWindow: localWindow,
    stageWeights: normalizeStageWeights(stageWeights),
    coarseTopN: Math.max(1, Number(coarseTopN) || 120),
    coarseTopClusters: Math.max(1, Number(coarseTopClusters) || 6),
    globalFeatureKeys: Object.keys(globalFeatureStats ?? {}).sort((a, b) => a.localeCompare(b)),
    clusterCenters
  }
}

const normalizeTemplateRow = (row, options = {}) => {
  const excludedGroups = options?.excludedGroups instanceof Set ? options.excludedGroups : new Set()
  const templateId = String(row?.templateId ?? "").trim() || "(unknown-template)"
  const localWindowRaw = Number(row?.localWindow)
  const globalWindowRaw = Number(row?.globalWindow)
  if (!Number.isInteger(localWindowRaw) || localWindowRaw < 1) {
    throw new Error(`Step C template missing localWindow: ${templateId}`)
  }
  if (!Number.isInteger(globalWindowRaw) || globalWindowRaw <= localWindowRaw) {
    throw new Error(`Step C template invalid globalWindow: ${templateId}`)
  }
  const localWindow = localWindowRaw
  const globalWindow = globalWindowRaw

  let seq40 = null
  if (Array.isArray(row?.seq40)) {
    seq40 = row.seq40
  } else if (Array.isArray(row?.seq40q)) {
    const scale = Number(row?.seq40Scale)
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error(`Step C template missing seq40Scale: ${templateId}`)
    }
    seq40 = dequantizeSequence(row.seq40q, scale)
  } else {
    throw new Error(`Step C template missing seq40/seq40q: ${templateId}`)
  }

  let seq150 = null
  if (Array.isArray(row?.seq150)) {
    seq150 = row.seq150
  } else if (Array.isArray(row?.seq150q)) {
    const scale = Number(row?.seq150Scale)
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error(`Step C template missing seq150Scale: ${templateId}`)
    }
    seq150 = dequantizeSequence(row.seq150q, scale)
  } else {
    throw new Error(`Step C template missing seq150/seq150q: ${templateId}`)
  }

  const featureVecRaw = row?.featureVec
  const globalFeatureVecRaw = row?.globalFeatureVec
  if (!featureVecRaw || typeof featureVecRaw !== "object") {
    throw new Error(`Step C template missing featureVec: ${templateId}`)
  }
  if (!globalFeatureVecRaw || typeof globalFeatureVecRaw !== "object") {
    throw new Error(`Step C template missing globalFeatureVec: ${templateId}`)
  }
  if (!Object.keys(globalFeatureVecRaw).length) {
    throw new Error(`Step C template empty globalFeatureVec: ${templateId}`)
  }
  const seq40Nums = (Array.isArray(seq40) ? seq40 : []).map((v) => num(v) ?? 0)
  const seq150Nums = (Array.isArray(seq150) ? seq150 : []).map((v) => num(v) ?? 0)
  if (seq40Nums.length !== localWindow) {
    throw new Error(
      `Step C template seq40 length mismatch: ${templateId} expected=${localWindow} actual=${seq40Nums.length}`,
    )
  }
  if (seq150Nums.length !== globalWindow) {
    throw new Error(
      `Step C template seq150 length mismatch: ${templateId} expected=${globalWindow} actual=${seq150Nums.length}`,
    )
  }
  const labelInfo = resolveTemplateLabel(row)

  return {
    templateId: row?.templateId ?? null,
    symbol: row?.symbol ?? null,
    eventDate: row?.eventDate ?? null,
    asOfDate: row?.asOfDate ?? null,
    localWindow,
    globalWindow,
    sequenceWindow: localWindow,
    featureVec: stripExcludedGroups(normalizeFeatureVec(featureVecRaw), excludedGroups),
    globalFeatureVec: normalizeFeatureVec(globalFeatureVecRaw),
    seq40: seq40Nums,
    seq150: seq150Nums,
    eventOutcome: normalizeOutcome(row?.eventOutcome),
    label: labelInfo.label,
    templateKind: labelInfo.templateKind
  }
}

export const runStepC = async (ctx) => {
  const lightweightCfg = ctx.config?.lightweight ?? {}
  const runtime = ctx.__runtime ?? {}
  const familyProbeMode = runtime.familyProbeMode === true
  const stepBSourceRunDir = String(runtime?.stepBSourceRunDirOverride ?? "").trim()
    ? String(runtime.stepBSourceRunDirOverride)
    : String(ctx?.abRunDir ?? "").trim()
      ? String(ctx.abRunDir)
      : String(ctx.runDir)
  const stepCFamilySourceRunDir = String(runtime?.stepCFamilySourceRunDirOverride ?? "").trim()
    ? String(runtime.stepCFamilySourceRunDirOverride)
    : stepBSourceRunDir
  const stepBSourceRunId =
    String(ctx?.abRunId ?? "").trim() || path.basename(stepBSourceRunDir)
  const { inPath, mode: inputMode } = resolveStepCInputPath({
    runDir: stepBSourceRunDir,
    lightweightCfg,
    preferLiteArtifacts: lightweightCfg?.pipeline?.preferLiteArtifacts
  })
  if (!pathExists(inPath)) {
    throw new Error(`Step C input file not found: ${inPath}`)
  }
  const rawTemplates = await readJsonl(inPath)
  const c0FamilyIndexPack = await loadStepC0FamilyIndex(ctx, stepCFamilySourceRunDir)
  const c1FamilyProbeIndexPack = await loadStepC1FamilyProbeIndex(ctx, stepCFamilySourceRunDir)
  const c2DedupIndexPack = await loadStepC2DedupIndex(ctx, stepCFamilySourceRunDir)
  const familyPoolPack = await loadFamilyPoolManifest({ ctx })
  const permanentDrop = await loadPermanentDropSet(ctx)
  const excludedFeatureGroups = resolveExcludedFeatureGroups(ctx.config)
  const commonStatePack = await loadChampionCommonState(ctx)
  const commonState = commonStatePack.state
  const commonCfg = commonStatePack.cfg
  const commonStateConfidence =
    clamp01(commonState?.confidence ?? 0) * clamp01(commonCfg?.confidenceScale ?? 1)
  let droppedByPermanent = 0
  const templatesNormalized = rawTemplates
    .filter((row) => {
      const templateId = String(row?.templateId ?? "").trim()
      if (!templateId) return true
      if (!permanentDrop.templateIds.has(templateId)) return true
      droppedByPermanent += 1
      return false
    })
    .map((row) =>
      normalizeTemplateRow(row, {
        excludedGroups: excludedFeatureGroups
      }),
    )
    .filter((row) => row.templateId && row.symbol && row.eventDate)
    .sort((a, b) => {
      const dk = String(a?.eventDate ?? "").localeCompare(String(b?.eventDate ?? ""))
      return dk !== 0 ? dk : String(a?.symbol ?? "").localeCompare(String(b?.symbol ?? ""))
    })
  const c0AnnotatedTemplates = annotateTemplatesWithC0({
    templates: templatesNormalized,
    membershipByTemplateId: c0FamilyIndexPack.membershipByTemplateId,
    familyById: c0FamilyIndexPack.familyById
  })
  const c0Filter = filterTemplatesByC0Shortlist({
    templates: c0AnnotatedTemplates,
    familyIndexPack: c0FamilyIndexPack,
    runtimeAllowedFamilyIds: runtime.allowedC0FamilyIds
  })
  const c1Filter = filterTemplatesByC1Families({
    templates: c0Filter.templates,
    c1IndexPack: c1FamilyProbeIndexPack,
    runtimeAllowedFamilyIds: runtime.allowedC0FamilyIds,
    familyProbeMode: runtime.familyProbeMode === true,
    familyProbeMetadata: runtime.familyProbeMetadata
  })
  const c2Filter = filterTemplatesByC2Representatives({
    templates: c1Filter.templates,
    c2IndexPack: c2DedupIndexPack
  })
  const familyPoolFilter = filterTemplatesByFamilyPool({
    templates: c2Filter.templates,
    familyPoolPack
  })
  const templates = familyPoolFilter.templates
  const outDir = String(runtime.stepCOutputDirOverride ?? "").trim() || path.join(ctx.runDir, "step-c")
  await ensureDir(outDir)
  const summaryPath = path.join(outDir, "step_c_summary.json")

  if (!templates.length) {
    const failureStage = inferStepCEmptyStage({
      rawTemplatesCount: rawTemplates.length,
      templatesNormalizedCount: templatesNormalized.length,
      afterC0Count: c0Filter.templates.length,
      afterC1Count: c1Filter.templates.length,
      afterC2Count: c2Filter.templates.length,
      afterFamilyPoolCount: familyPoolFilter.templates.length,
      familyPoolEnabled: familyPoolFilter?.summary?.enabled === true
    })
    const failureReason =
      familyPoolFilter?.summary?.enabled === true
        ? "PRODUCTION_FAMILY_POOL_EMPTY"
        : "NO_TEMPLATES_AFTER_FILTER_CHAIN"
    await writeJson(
      summaryPath,
      buildStepCFilterStageSummary({
        inputMode,
        inPath,
        stepBSourceRunId,
        stepBSourceRunDir,
        rawTemplatesCount: rawTemplates.length,
        templatesNormalizedCount: templatesNormalized.length,
        templatesAfterC0Filter: c0Filter.templates.length,
        templatesAfterC1Filter: c1Filter.templates.length,
        templatesAfterC2Filter: c2Filter.templates.length,
        templatesAfterFamilyPoolFilter: familyPoolFilter.templates.length,
        familyProbeMode,
        runtimeAllowedC0FamilyIds: runtime.allowedC0FamilyIds,
        permanentDrop,
        droppedByPermanent,
        c0Filter,
        c1Filter,
        c2Filter,
        familyPoolFilter,
        failure: {
          reason: failureReason,
          stage: failureStage,
          message:
            familyPoolFilter?.summary?.enabled === true
              ? `Step C production family pool is empty: productionFamilies=${Number(familyPoolFilter?.summary?.productionFamilyCount ?? 0) || 0}, minProductionFamilies=${Number(familyPoolFilter?.summary?.minProductionFamilies ?? 0) || 0}`
              : "Step C template input is empty after normalization."
        }
      }),
    )
    if (familyPoolFilter?.summary?.enabled === true) {
      throw new Error(
        `Step C production family pool is empty: productionFamilies=${Number(familyPoolFilter?.summary?.productionFamilyCount ?? 0) || 0}, minProductionFamilies=${Number(familyPoolFilter?.summary?.minProductionFamilies ?? 0) || 0}`,
      )
    }
    throw new Error("Step C template input is empty after normalization.")
  }
  const temporalCfg = resolveTemporalStabilityConfig(ctx.config)
  const eraPlan = buildTemporalEraPlan({
    templates,
    cfg: temporalCfg
  })
  const positiveTemplates = templates.filter((row) => row.label === 1)
  const negativeTemplates = templates.filter((row) => row.label === 0)
  if (!positiveTemplates.length) {
    throw new Error("Step C requires at least one positive template.")
  }

  const localWindow = positiveTemplates[0].localWindow
  const globalWindow = positiveTemplates[0].globalWindow
  const configLocalWindow = resolveLocalWindow(ctx.config)
  const configGlobalWindow = resolveGlobalWindow(ctx.config)
  const wrongWindow = templates.find(
    (row) => row.localWindow !== localWindow || row.globalWindow !== globalWindow,
  )
  if (wrongWindow) {
    throw new Error(
      [
        "Step C detected mixed window templates.",
        `expected local/global=${localWindow}/${globalWindow}`,
        `found template=${wrongWindow.templateId} local/global=${wrongWindow.localWindow}/${wrongWindow.globalWindow}`
      ].join(" "),
    )
  }
  if (localWindow !== configLocalWindow || globalWindow !== configGlobalWindow) {
    throw new Error(
      [
        "Step C template window mismatch with config.",
        `templates=${localWindow}/${globalWindow}`,
        `config=${configLocalWindow}/${configGlobalWindow}`
      ].join(" "),
    )
  }

  const localFeatureStats = buildFeatureStats(positiveTemplates, "featureVec")
  const globalFeatureStats = buildFeatureStats(positiveTemplates, "globalFeatureVec")
  const minRuleSupportRatio = Math.max(0, Number(ctx.config.pattern?.minRuleSupportRatio ?? 0.03) || 0)
  const quantiles = ctx.config.pattern?.ruleQuantiles
  const localRules = buildRules({
    templates: positiveTemplates,
    vectorKey: "featureVec",
    featureStats: localFeatureStats,
    quantiles,
    minSupportRatio: minRuleSupportRatio,
    maxRules: 240,
    idPrefix: "RL"
  })
  const globalRules = buildRules({
    templates: positiveTemplates,
    vectorKey: "globalFeatureVec",
    featureStats: globalFeatureStats,
    quantiles,
    minSupportRatio: minRuleSupportRatio,
    maxRules: 180,
    idPrefix: "RG"
  })

  const clusterBinPlan = resolveClusterBinPlan({
    templateCount: positiveTemplates.length,
    configuredBins: ctx.config.pattern?.globalClusterBins,
    mode: ctx.config.pattern?.globalClusterBinMode,
    minBins: ctx.config.pattern?.globalClusterMinBins,
    maxBins: ctx.config.pattern?.globalClusterMaxBins
  })
  const clusterBuild = buildGlobalClusters({
    templates: positiveTemplates,
    globalFeatureStats,
    bins: clusterBinPlan.applied
  })
  const clusterSignatureById = new Map(
    (clusterBuild?.clusters ?? []).map((row) => [
      String(row?.clusterId ?? ""),
      String(row?.signature ?? "")
    ]),
  )
  const clusterCenters = buildClusterCenters({
    clusters: clusterBuild.clusters,
    globalFeatureKeys: Object.keys(globalFeatureStats ?? {}),
    totalTemplates: positiveTemplates.length
  })

  const globalPrototypes = buildGlobalPrototypes({
    clusters: clusterBuild.clusters,
    maxGlobalPrototypes: ctx.config.pattern?.maxGlobalPrototypes
  })
  const recallOnlyCfg = resolveRecallOnlyConfig(ctx.config)
  const recallOnlyEnabled = recallOnlyCfg.enabled === true
  const qualityCfgBase = resolvePatternQualityConfig(ctx.config)
  const antiCfgBase = resolveAntiPatternConfig(ctx.config)
  const contrastiveCfgBase = resolveContrastiveConfig(ctx.config)
  const prototypeSelectionCfgBase = resolvePrototypeSelectionConfig(ctx.config)
  const qualityCfg = recallOnlyEnabled || familyProbeMode
    ? {
      ...qualityCfgBase,
      enabled: false
    }
    : qualityCfgBase
  const antiCfg = recallOnlyEnabled || familyProbeMode
    ? {
      ...antiCfgBase,
      enabled: false
    }
    : antiCfgBase
  const contrastiveCfg = recallOnlyEnabled || familyProbeMode
    ? {
      ...contrastiveCfgBase,
      enabled: false
    }
    : contrastiveCfgBase
  const prototypeSelectionCfg = recallOnlyEnabled || familyProbeMode
    ? {
      ...prototypeSelectionCfgBase,
      enabled: false,
      minClusterSupport: 1,
      minQualityTrades: 0,
      minContrastiveSamples: 0,
      minQualityScore: 0,
      minDistinctClusters: 1,
      minPrototypeFloor: 1,
      minNegativePrototypeFloor: 0,
      minClusterFloor: 1,
      maxClusterShare: 1
    }
    : prototypeSelectionCfgBase
  const templateById = new Map(positiveTemplates.map((row) => [String(row.templateId), row]))
  const negativePrototypes = selectNegativePrototypes({
    negativeTemplates,
    maxLocalPrototypes: ctx.config.pattern?.maxLocalPrototypes
  })
  const negativePrototypeFloor = Math.max(
    0,
    Number(prototypeSelectionCfg?.minNegativePrototypeFloor ?? 0) || 0,
  )
  const negativePrototypeFloorFailed =
    familyProbeMode !== true &&
    negativePrototypeFloor > 0 &&
    negativePrototypes.length < negativePrototypeFloor
  if (negativePrototypeFloorFailed) {
    throw new Error(
      `Step C negative prototype floor failed: selected=${negativePrototypes.length}, required=${negativePrototypeFloor}`,
    )
  }
  const clusterContrastive = buildClusterContrastiveStats({
    clusterBuild,
    negativeTemplates,
    eraPlan
  })
  const clusterQualityById = new Map()
  for (const cluster of clusterBuild.clusters) {
    const contrastiveStats = clusterContrastive.byCluster.get(String(cluster?.clusterId ?? "")) ?? {
      positive: Number(cluster?.templates?.length ?? 0),
      negative: 0,
      samples: Number(cluster?.templates?.length ?? 0),
      posRate: 1,
      negRate: 0,
      lift: 1
    }
    const stats = buildOutcomeStats(cluster.templates)
    const scored = scorePatternQuality({
      stats,
      qualityCfg,
      antiCfg,
      contrastiveCfg,
      contrastiveStats
    })
    const regimeAlignment = clampSigned(
      commonState?.regimeWeights?.[String(cluster?.signature ?? "").trim()] ?? 0,
    )
    const clusterQualityAdj = clampAbs(
      regimeAlignment *
        commonStateConfidence *
        Number(commonCfg?.clusterQualityBoost ?? 0),
      Number(commonCfg?.maxAdjustment ?? 0.12),
    )
    const adjustedQualityScore = clamp01(Number(scored.qualityScore ?? 0.5) + clusterQualityAdj)
    const adjustedAntiScore = clamp01(
      Number(scored.antiScore ?? 0) +
        Math.max(0, -regimeAlignment) *
          commonStateConfidence *
          Number(commonCfg?.antiPenaltyWeight ?? 0.08) *
          0.5,
    )
    clusterQualityById.set(String(cluster.clusterId), {
      ...stats,
      baseQualityScore: Number(scored.qualityScore ?? 0.5),
      baseAntiScore: Number(scored.antiScore ?? 0),
      commonAlignmentScore: regimeAlignment,
      qualityScore: adjustedQualityScore,
      antiScore: adjustedAntiScore,
      contrastivePositive: Number(contrastiveStats.positive ?? 0),
      contrastiveNegative: Number(contrastiveStats.negative ?? 0),
      contrastiveSamples: Number(scored.contrastiveSamples ?? 0),
      contrastivePosRate: Number(scored.contrastivePosRate ?? 1),
      contrastiveNegRate: Number(scored.contrastiveNegRate ?? 0),
      contrastiveLift: Number(scored.contrastiveLift ?? 1)
    })
  }
  const clusterTemporalStability = buildClusterTemporalStabilityStats({
    clusterBuild,
    clusterContrastive,
    eraPlan,
    temporalCfg
  })
  const localPrototypePack = buildLocalPrototypes({
    clusters: clusterBuild.clusters,
    maxLocalPrototypes: ctx.config.pattern?.maxLocalPrototypes,
    clusterQualityById,
    clusterTemporalById: clusterTemporalStability.byCluster,
    qualityCfg,
    selectionCfg: prototypeSelectionCfg,
    eraPlan,
    temporalCfg
  })
  const localPrototypes = Array.isArray(localPrototypePack?.selected) ? localPrototypePack.selected : []
  const rankedLocalPrototypeBuckets = Array.isArray(localPrototypePack?.rankedBuckets)
    ? localPrototypePack.rankedBuckets
    : []
  const annotatedPrototypeCache = new Map()
  const annotateLocalPrototype = (row) => {
    if (!row) return null
    const templateId = String(row?.templateId ?? "").trim()
    const cacheKey = templateId || `${String(row?.clusterId ?? "")}@${String(row?.eventDate ?? row?.asOfDate ?? "")}`
    if (annotatedPrototypeCache.has(cacheKey)) {
      return annotatedPrototypeCache.get(cacheKey)
    }
    const clusterStats = clusterQualityById.get(String(row?.clusterId ?? "")) ?? {
      trades: 0,
      winRate3d: 0,
      targetRate3d: 0,
      stopRate3d: 0,
      expectedNetRet3d: 0,
      qualityScore: 0.5,
      antiScore: 0,
      contrastivePositive: 0,
      contrastiveNegative: 0,
      contrastiveSamples: 0,
      contrastivePosRate: 1,
      contrastiveNegRate: 0,
      contrastiveLift: 1
    }
    const clusterTemporalStats = clusterTemporalStability.byCluster.get(String(row?.clusterId ?? "")) ?? {
      eraStats: [],
      eraSupportCount: 0,
      eraCoverageRatio: 0,
      dominantEraId: null,
      dominantEraShare: 0,
      maxSingleEraShare: 0,
      eraSupportMin: 0,
      eraSupportMedian: 0,
      eraEntropy: 0,
      normalizedEraEntropy: 0,
      effectiveEraCount: 0,
      eraWinRateStd: 0,
      eraExpectedNetRetStd: 0,
      eraContrastiveLiftStd: 0
    }
    const srcTemplate = templateById.get(String(row?.templateId ?? ""))
    const protoStats = buildOutcomeStats(srcTemplate ? [srcTemplate] : [])
    const blendedStats = blendStats({
      clusterStats,
      protoStats,
      blend: qualityCfg.prototypeClusterBlend
    })
    const contrastiveStats = {
      positive: clusterStats.contrastivePositive,
      negative: clusterStats.contrastiveNegative,
      samples: clusterStats.contrastiveSamples,
      posRate: clusterStats.contrastivePosRate,
      negRate: clusterStats.contrastiveNegRate,
      lift: clusterStats.contrastiveLift
    }
    const scored = scorePatternQuality({
      stats: blendedStats,
      qualityCfg,
      antiCfg,
      contrastiveCfg,
      contrastiveStats
    })
    const useNeutralQuality = qualityCfg.enabled && blendedStats.trades < qualityCfg.minTradesPerCluster
    const clusterSignature = String(clusterSignatureById.get(String(row?.clusterId ?? "")) ?? "")
    const baseQualityScore = useNeutralQuality ? 0.5 : Number(scored.qualityScore ?? 0.5)
    const baseAntiScore = Number(scored.antiScore ?? 0)
    const commonAlignmentScore = resolveCommonAlignment({
      templateId: row?.templateId,
      clusterSignature,
      commonState,
      commonCfg
    })
    const qualityAdj = clampAbs(
      commonAlignmentScore *
        commonStateConfidence *
        Number(commonCfg?.qualityBoost ?? 0.08),
      Number(commonCfg?.maxAdjustment ?? 0.12),
    )
    const qualityScore = clamp01(baseQualityScore + qualityAdj)
    const antiScore = clamp01(
      baseAntiScore +
        Math.max(0, -commonAlignmentScore) *
          commonStateConfidence *
          Number(commonCfg?.antiPenaltyWeight ?? 0.08) -
        Math.max(0, commonAlignmentScore) *
          commonStateConfidence *
          Number(commonCfg?.antiReliefWeight ?? 0.04),
    )
    const selectedEraId = eraPlan.resolveEraId(row)
    const outcomeBucket = resolvePrototypeOutcomeBucket(srcTemplate ?? row)
    const executionFeasibilityBucket = resolveExecutionFeasibilityBucket(srcTemplate ?? row)
    const appliedEraCount = Math.max(1, Number(eraPlan?.appliedEraCount ?? 0) || 1)
    const clusterTemporalEffectiveEraCount = Number(clusterTemporalStats.effectiveEraCount ?? 0)
    const clusterTemporalNormalizedEraEntropy = Number(
      clusterTemporalStats.normalizedEraEntropy ?? 0,
    )
    const clusterTemporalEffectiveEraCountRatio = clamp01(
      clusterTemporalEffectiveEraCount / appliedEraCount,
    )
    const clusterTemporalLowDiversityPenalty = clamp01(
      (
        Number(clusterTemporalStats.maxSingleEraShare ?? 0) +
        (1 - clusterTemporalNormalizedEraEntropy) +
        (1 - clusterTemporalEffectiveEraCountRatio)
      ) / 3,
    )
    const annotated = {
      ...row,
      selectedEraId,
      outcomeBucket,
      executionFeasibilityBucket,
      clusterSignature,
      qualityTrades: blendedStats.trades,
      winRate3d: blendedStats.winRate3d,
      targetRate3d: blendedStats.targetRate3d,
      stopRate3d: blendedStats.stopRate3d,
      expectedNetRet3d: blendedStats.expectedNetRet3d,
      baseQualityScore,
      baseAntiScore,
      commonAlignmentScore,
      qualityScore,
      antiScore,
      contrastivePositive: Number(contrastiveStats.positive ?? 0),
      contrastiveNegative: Number(contrastiveStats.negative ?? 0),
      contrastiveSamples: Number(scored.contrastiveSamples ?? 0),
      contrastivePosRate: Number(scored.contrastivePosRate ?? 1),
      contrastiveNegRate: Number(scored.contrastiveNegRate ?? 0),
      contrastiveLift: Number(scored.contrastiveLift ?? 1),
      clusterTemporalEraSupportCount: Number(clusterTemporalStats.eraSupportCount ?? 0),
      clusterTemporalEraCoverageRatio: Number(clusterTemporalStats.eraCoverageRatio ?? 0),
      clusterTemporalDominantEraId: clusterTemporalStats.dominantEraId ?? null,
      clusterTemporalDominantEraShare: Number(clusterTemporalStats.dominantEraShare ?? 0),
      clusterTemporalMaxSingleEraShare: Number(clusterTemporalStats.maxSingleEraShare ?? 0),
      clusterTemporalEraSupportMin: Number(clusterTemporalStats.eraSupportMin ?? 0),
      clusterTemporalEraSupportMedian: Number(clusterTemporalStats.eraSupportMedian ?? 0),
      clusterTemporalEraEntropy: Number(clusterTemporalStats.eraEntropy ?? 0),
      clusterTemporalNormalizedEraEntropy,
      clusterTemporalEffectiveEraCount,
      clusterTemporalEffectiveEraCountRatio,
      clusterTemporalLowDiversityPenalty,
      clusterTemporalEraWinRateStd: Number(clusterTemporalStats.eraWinRateStd ?? 0),
      clusterTemporalEraExpectedNetRetStd: Number(clusterTemporalStats.eraExpectedNetRetStd ?? 0),
      clusterTemporalEraContrastiveLiftStd: Number(clusterTemporalStats.eraContrastiveLiftStd ?? 0)
    }
    annotatedPrototypeCache.set(cacheKey, annotated)
    return annotated
  }
  const annotatedLocalPrototypes = localPrototypes
    .map((row) => annotateLocalPrototype(row))
    .filter(Boolean)
  const adaptiveFrontierPack = await loadAdaptiveFrontierState({
    ctx,
    maxLocalPrototypes: ctx.config.pattern?.maxLocalPrototypes
  })
  const adaptiveFrontierSelected = applyAdaptiveFrontierSelection({
    prototypes: annotatedLocalPrototypes,
    cfg: adaptiveFrontierPack.cfg,
    salvageBoostPatterns: adaptiveFrontierPack.salvageBoostPatterns,
    salvagePenaltyPatterns: adaptiveFrontierPack.salvagePenaltyPatterns,
    quarantinedPatterns: adaptiveFrontierPack.quarantinedPatterns,
    prototypeLedger: adaptiveFrontierPack.prototypeLedger
  })

  const clusterSupportById = new Map(clusterCenters.map((row) => [row.clusterId, row.support]))
  const consistencyFiltered = applyPrototypeConsistencyFilter({
    prototypes: adaptiveFrontierSelected.prototypes,
    clusterSupportById,
    selectionCfg: prototypeSelectionCfg,
    temporalCfg: {
      ...temporalCfg,
      appliedEraCount: Number(eraPlan?.appliedEraCount ?? 0) || 0,
      enabled: eraPlan.enabled === true && Number(eraPlan?.appliedEraCount ?? 0) > 0
    }
  })
  const eraRebalanced = rebalanceSelectedPrototypeEras({
    selectedPrototypes: consistencyFiltered.prototypes,
    rankedBuckets: rankedLocalPrototypeBuckets,
    annotatePrototype: annotateLocalPrototype,
    eraPlan,
    temporalCfg
  })
  const selectedLocalPrototypes = eraRebalanced.prototypes
  const selectedClusterIds = Array.from(
    new Set(selectedLocalPrototypes.map((row) => String(row?.clusterId ?? "")).filter(Boolean)),
  )
  const selectedPrototypesMissingClusterIdCount = selectedLocalPrototypes.filter(
    (row) => !String(row?.clusterId ?? "").trim(),
  ).length
  const selectedClusterTemporalRows = selectedClusterIds
    .map((clusterId) => clusterTemporalStability.byCluster.get(clusterId))
    .filter(Boolean)
  const selectedPrototypeEraMix = summarizeSelectedPrototypeEraMix({
    prototypes: selectedLocalPrototypes,
    eraPlan
  })
  const patternLibrary = {
    version: "v2_hybrid_150_40",
    mode: "hybrid_150_40",
    objective: recallOnlyEnabled ? "RECALL_TOPK" : "BALANCED",
    recallOnly: {
      enabled: recallOnlyEnabled
    },
    createdAt: new Date().toISOString(),
    periods: ctx.periods,
    event: ctx.config.event,
    filters: ctx.config.filters,
    localWindow,
    globalWindow,
    featureStats: localFeatureStats,
    localFeatureStats,
    globalFeatureStats,
    rules: localRules,
    localRules,
    globalRules,
    globalCluster: {
      keys: clusterBuild.clusterKeys,
      thresholds: clusterBuild.clusterThresholds,
      binMode: clusterBinPlan.mode,
      binsConfigured: clusterBinPlan.configured,
      binsApplied: clusterBinPlan.applied,
      minBins: clusterBinPlan.minBins,
      maxBins: clusterBinPlan.maxBins
    },
    globalClusters: clusterCenters.map((row) => ({
      ...row,
      localPrototypeCount: 0
    })),
    globalPrototypes,
    localPrototypes: selectedLocalPrototypes,
    negativePrototypes,
    prototypes: selectedLocalPrototypes,
    weights: ctx.config.similarity.initialWeights,
    excludedFeatureGroups: Array.from(excludedFeatureGroups).sort((a, b) => a.localeCompare(b)),
    permanentDrop: {
      listPath: permanentDrop.listPath,
      count: permanentDrop.templateIds.size
    },
    prototypeSelection: prototypeSelectionCfg,
    temporalStability: {
      enabled: eraPlan.enabled === true,
      configuredEraCount: Number(eraPlan.configuredEraCount ?? 0),
      appliedEraCount: Number(eraPlan.appliedEraCount ?? 0),
      selectionEnabled: consistencyFiltered?.summary?.temporalSelectionEnabled === true,
      selection: {
        minEraCoverageRatio: Number(consistencyFiltered?.summary?.minEraCoverageRatio ?? 0),
        maxSingleEraShare: Number(consistencyFiltered?.summary?.maxSingleEraShare ?? 1),
        minEraSupportCount: Number(consistencyFiltered?.summary?.minEraSupportCount ?? 0),
        maxEraWinRateStd: Number(consistencyFiltered?.summary?.maxEraWinRateStd ?? 1),
        effectiveMinEraCoverageRatio: Number(
          consistencyFiltered?.summary?.effectiveMinEraCoverageRatio ?? 0,
        ),
        effectiveMaxSingleEraShare: Number(
          consistencyFiltered?.summary?.effectiveMaxSingleEraShare ?? 1,
        ),
        effectiveMinEraSupportCount: Number(
          consistencyFiltered?.summary?.effectiveMinEraSupportCount ?? 0,
        ),
        effectiveMaxEraWinRateStd: Number(
          consistencyFiltered?.summary?.effectiveMaxEraWinRateStd ?? 1,
        ),
        temporalStableCoreCount: Number(
          consistencyFiltered?.summary?.temporalStableCoreCount ?? selectedLocalPrototypes.length,
        ),
        temporalBackfillAdded: Number(consistencyFiltered?.summary?.temporalBackfillAdded ?? 0),
        temporalBackfillCapacity: Number(
          consistencyFiltered?.summary?.temporalBackfillCapacity ?? 0,
        ),
        prototypeEraRebalanceEnabled: eraRebalanced?.summary?.enabled === true,
        prototypeEraRebalanceChangedCount: Number(eraRebalanced?.summary?.changedCount ?? 0),
        prototypeEraRebalanceFallbackFillCount: Number(
          eraRebalanced?.summary?.fallbackFillCount ?? 0,
        ),
        prototypeEraRebalanceRequestedMaxEraShare: Number(
          eraRebalanced?.summary?.requestedMaxEraShare ?? 1,
        ),
        prototypeEraRebalanceAchievedMaxEraShare: Number(
          eraRebalanced?.summary?.achievedMaxEraShare ?? 0,
        )
      },
      eras: eraPlan.eras,
      clusterOverview: clusterTemporalStability.overview,
      selectedClusterOverview: summarizeTemporalOverview({
        rows: selectedClusterTemporalRows,
        cfg: temporalCfg
      }),
      selectedPrototypeEraMix
    },
    commonState: {
      enabled: commonCfg.enabled === true,
      path: commonStatePack.statePath,
      applied: !!commonState,
      confidence: commonStateConfidence,
      source: commonState?.source ?? null
    },
    c0: {
      enabled: c0FamilyIndexPack?.enabled === true,
      sourceDir: c0Filter?.summary?.c0SourceDir ?? null,
      familyCount: Number(c0Filter?.summary?.c0FamilyCount ?? 0) || 0,
      shortlistedFamilyCount: Number(c0Filter?.summary?.c0ShortlistedFamilyCount ?? 0) || 0,
      nominalShortlistedFamilyIds: Array.isArray(c0Filter?.summary?.c0NominalShortlistedFamilyIds)
        ? c0Filter.summary.c0NominalShortlistedFamilyIds
        : [],
      effectiveFamilyIds: Array.isArray(c0Filter?.summary?.c0EffectiveFamilyIds)
        ? c0Filter.summary.c0EffectiveFamilyIds
        : [],
      effectiveSource: c0Filter?.summary?.c0EffectiveSource ?? null,
      acceptedTemplateCount: Number(c0Filter?.summary?.c0AcceptedTemplateCount ?? templates.length) || 0,
      rejectedTemplateCount: Number(c0Filter?.summary?.c0RejectedTemplateCount ?? 0) || 0,
      fallbackUsed: c0Filter?.summary?.c0FallbackUsed === true,
      gateFailed: c0Filter?.summary?.c0GateFailed === true,
      gate: c0FamilyIndexPack?.index?.c0Gate ?? null,
      shortlistPolicy: c0FamilyIndexPack?.index?.shortlistPolicy ?? null
    },
    c1: {
      enabled: c1FamilyProbeIndexPack?.enabled === true || runtime.familyProbeMode === true,
      sourceDir: c1Filter?.summary?.c1SourceDir ?? null,
      familyProbeMode: runtime.familyProbeMode === true,
      probedFamilyCount: Number(c1Filter?.summary?.c1ProbedFamilyCount ?? 0) || 0,
      passedFamilyCount: Number(c1Filter?.summary?.c1PassedFamilyCount ?? 0) || 0,
      rejectedFamilyCount: Number(c1Filter?.summary?.c1RejectedFamilyCount ?? 0) || 0,
      nominalPassedFamilyIds: Array.isArray(c1Filter?.summary?.c1NominalPassedFamilyIds)
        ? c1Filter.summary.c1NominalPassedFamilyIds
        : (
          Array.isArray(c1Filter?.summary?.nominalPassedFamilyIds)
            ? c1Filter.summary.nominalPassedFamilyIds
            : []
        ),
      nominalBackfillFamilyIds: Array.isArray(c1Filter?.summary?.c1NominalBackfillFamilyIds)
        ? c1Filter.summary.c1NominalBackfillFamilyIds
        : (
          Array.isArray(c1Filter?.summary?.nominalBackfillFamilyIds)
            ? c1Filter.summary.nominalBackfillFamilyIds
            : []
        ),
      nominalRejectedFamilyIds: Array.isArray(c1Filter?.summary?.c1NominalRejectedFamilyIds)
        ? c1Filter.summary.c1NominalRejectedFamilyIds
        : (
          Array.isArray(c1Filter?.summary?.nominalRejectedFamilyIds)
            ? c1Filter.summary.nominalRejectedFamilyIds
            : []
        ),
      effectiveFamilyIds: Array.isArray(c1Filter?.summary?.c1EffectiveFamilyIds)
        ? c1Filter.summary.c1EffectiveFamilyIds
        : (
          Array.isArray(c1Filter?.summary?.effectiveFamilyIds)
            ? c1Filter.summary.effectiveFamilyIds
            : []
        ),
      effectiveSource:
        c1Filter?.summary?.c1EffectiveSource ??
        c1Filter?.summary?.effectiveSource ??
        null,
      acceptedTemplateCount: Number(c1Filter?.summary?.c1AcceptedTemplateCount ?? templates.length) || 0,
      rejectedTemplateCount: Number(c1Filter?.summary?.c1RejectedTemplateCount ?? 0) || 0,
      fallbackUsed: c1Filter?.summary?.c1FallbackUsed === true,
      gateFailed: c1Filter?.summary?.c1GateFailed === true,
      gate: c1FamilyProbeIndexPack?.index?.gate ?? null,
      probeScope: c1FamilyProbeIndexPack?.index?.probeScope ?? runtime.probeScopeOverride ?? null,
      probeProfile:
        c1FamilyProbeIndexPack?.index?.probeProfile ??
        runtime.stepDProfileOverride ??
        runtime.stepDExecutionProfileOverride ??
        null,
      passedFamilyIds: Array.isArray(c1Filter?.summary?.c1NominalPassedFamilyIds)
        ? c1Filter.summary.c1NominalPassedFamilyIds
        : (
          Array.isArray(c1Filter?.summary?.nominalPassedFamilyIds)
            ? c1Filter.summary.nominalPassedFamilyIds
            : (
              Array.isArray(c1FamilyProbeIndexPack?.index?.passedFamilyIds)
                ? c1FamilyProbeIndexPack.index.passedFamilyIds
                : (Array.isArray(runtime.allowedC0FamilyIds) ? runtime.allowedC0FamilyIds : [])
            )
        ),
      backfillFamilyIds: Array.isArray(c1Filter?.summary?.c1NominalBackfillFamilyIds)
        ? c1Filter.summary.c1NominalBackfillFamilyIds
        : (
          Array.isArray(c1Filter?.summary?.nominalBackfillFamilyIds)
            ? c1Filter.summary.nominalBackfillFamilyIds
            : (Array.isArray(c1FamilyProbeIndexPack?.index?.backfillFamilyIds)
              ? c1FamilyProbeIndexPack.index.backfillFamilyIds
              : [])
        ),
      rejectedFamilyIds: Array.isArray(c1Filter?.summary?.c1NominalRejectedFamilyIds)
        ? c1Filter.summary.c1NominalRejectedFamilyIds
        : (
          Array.isArray(c1Filter?.summary?.nominalRejectedFamilyIds)
            ? c1Filter.summary.nominalRejectedFamilyIds
            : (Array.isArray(c1FamilyProbeIndexPack?.index?.rejectedFamilyIds)
              ? c1FamilyProbeIndexPack.index.rejectedFamilyIds
              : [])
        ),
      effectiveFamilyIds: Array.isArray(c1Filter?.summary?.c1EffectiveFamilyIds)
        ? c1Filter.summary.c1EffectiveFamilyIds
        : (
          Array.isArray(c1Filter?.summary?.effectiveFamilyIds)
            ? c1Filter.summary.effectiveFamilyIds
            : []
        ),
      effectiveSource:
        c1Filter?.summary?.c1EffectiveSource ??
        c1Filter?.summary?.effectiveSource ??
        null
    },
    c2: {
      enabled: c2DedupIndexPack?.enabled === true,
      sourceDir: c2Filter?.summary?.c2SourceDir ?? null,
      dedupedFamilyCount: Number(c2Filter?.summary?.c2DedupedFamilyCount ?? 0) || 0,
      representativeFamilyCount: Number(c2Filter?.summary?.c2RepresentativeFamilyCount ?? 0) || 0,
      shadowFamilyCount: Number(c2Filter?.summary?.c2ShadowFamilyCount ?? 0) || 0,
      nominalRepresentativeFamilyIds: Array.isArray(
        c2Filter?.summary?.c2NominalRepresentativeFamilyIds,
      )
        ? c2Filter.summary.c2NominalRepresentativeFamilyIds
        : [],
      nominalShadowFamilyIds: Array.isArray(c2Filter?.summary?.c2NominalShadowFamilyIds)
        ? c2Filter.summary.c2NominalShadowFamilyIds
        : [],
      effectiveRepresentativeFamilyIds: Array.isArray(
        c2Filter?.summary?.c2EffectiveRepresentativeFamilyIds,
      )
        ? c2Filter.summary.c2EffectiveRepresentativeFamilyIds
        : [],
      effectiveSource: c2Filter?.summary?.c2EffectiveSource ?? null,
      acceptedTemplateCount: Number(c2Filter?.summary?.c2AcceptedTemplateCount ?? templates.length) || 0,
      rejectedTemplateCount: Number(c2Filter?.summary?.c2RejectedTemplateCount ?? 0) || 0,
      fallbackUsed: c2Filter?.summary?.c2FallbackUsed === true,
      gateFailed: c2Filter?.summary?.c2GateFailed === true,
      gate: c2DedupIndexPack?.index?.gate ?? null,
      representativePolicy: c2DedupIndexPack?.cfg?.representativePolicy ?? null,
      similarityPolicyVersion: c2DedupIndexPack?.cfg?.similarityPolicyVersion ?? null,
      representativeFamilyIds: Array.isArray(c2Filter?.summary?.c2NominalRepresentativeFamilyIds)
        ? c2Filter.summary.c2NominalRepresentativeFamilyIds
        : (Array.isArray(c2DedupIndexPack?.index?.representativeFamilyIds)
          ? c2DedupIndexPack.index.representativeFamilyIds
          : []),
      shadowFamilyIds: Array.isArray(c2Filter?.summary?.c2NominalShadowFamilyIds)
        ? c2Filter.summary.c2NominalShadowFamilyIds
        : (Array.isArray(c2DedupIndexPack?.index?.shadowFamilyIds)
          ? c2DedupIndexPack.index.shadowFamilyIds
          : []),
      effectiveRepresentativeFamilyIds: Array.isArray(
        c2Filter?.summary?.c2EffectiveRepresentativeFamilyIds,
      )
        ? c2Filter.summary.c2EffectiveRepresentativeFamilyIds
        : [],
      effectiveSource: c2Filter?.summary?.c2EffectiveSource ?? null
    },
    adaptiveFrontier: {
      enabled: adaptiveFrontierPack?.cfg?.enabled === true,
      minPrototypeFloor: Number(adaptiveFrontierPack?.cfg?.minPrototypeFloor ?? 0) || 0,
      qualityAcceptThreshold: Number(adaptiveFrontierPack?.cfg?.qualityAcceptThreshold ?? 0) || 0,
      qualityNearThreshold: Number(adaptiveFrontierPack?.cfg?.qualityNearThreshold ?? 0) || 0,
      maxPrototypeCeil: Number(adaptiveFrontierPack?.cfg?.maxPrototypeCeil ?? 0) || 0,
      salvageBoostBias: Number(adaptiveFrontierPack?.cfg?.salvageBoostBias ?? 0) || 0,
      salvagePenaltyBias: Number(adaptiveFrontierPack?.cfg?.salvagePenaltyBias ?? 0) || 0,
      salvagePoolPath: adaptiveFrontierPack?.salvagePoolPath ?? null,
      quarantinePoolPath: adaptiveFrontierPack?.quarantinePoolPath ?? null,
      acceptedByQuality: Number(adaptiveFrontierSelected?.summary?.acceptedByQuality ?? 0) || 0,
      rejectedByQuality: Number(adaptiveFrontierSelected?.summary?.rejectedByQuality ?? 0) || 0,
      acceptedBySalvageBoost: Number(
        adaptiveFrontierSelected?.summary?.acceptedBySalvageBoost ?? 0,
      ) || 0,
      acceptedBySalvagePenalty: Number(
        adaptiveFrontierSelected?.summary?.acceptedBySalvagePenalty ?? 0,
      ) || 0,
      rejectedByQuarantine: Number(
        adaptiveFrontierSelected?.summary?.rejectedByQuarantine ?? 0,
      ) || 0,
      backfilledToFloor: Number(adaptiveFrontierSelected?.summary?.backfilledToFloor ?? 0) || 0,
      retiredByHardRule: Number(adaptiveFrontierSelected?.summary?.retiredByHardRule ?? 0) || 0,
      averageCQualityScore: Number(
        adaptiveFrontierSelected?.summary?.averageCQualityScore ?? 0,
      ) || 0,
      averageProxyScore: Number(adaptiveFrontierSelected?.summary?.averageProxyScore ?? 0) || 0,
      cQualityScoreBreakdown:
        adaptiveFrontierSelected?.summary?.cQualityScoreBreakdown ?? null,
      salvageBoostPatternCount: Number(
        adaptiveFrontierSelected?.summary?.salvageBoostPatternCount ?? 0,
      ) || 0,
      salvagePenaltyPatternCount: Number(
        adaptiveFrontierSelected?.summary?.salvagePenaltyPatternCount ?? 0,
      ) || 0,
      quarantinePatternCount: Number(
        adaptiveFrontierSelected?.summary?.quarantinePatternCount ?? 0,
      ) || 0
    }
  }

  const leakedDrop = selectedLocalPrototypes.find((row) =>
    permanentDrop.templateIds.has(String(row?.templateId ?? "").trim()),
  )
  if (leakedDrop) {
    throw new Error(
      `Step C produced permanently dropped prototype: ${String(leakedDrop?.templateId ?? "(unknown)")}`,
    )
  }
  const localCountByCluster = new Map()
  for (const row of selectedLocalPrototypes) {
    const key = String(row?.clusterId ?? "")
    localCountByCluster.set(key, Number(localCountByCluster.get(key) ?? 0) + 1)
  }
  const localClusterShares = Array.from(localCountByCluster.values())
    .map((count) =>
      selectedLocalPrototypes.length > 0
        ? Number(count) / selectedLocalPrototypes.length
        : 0,
    )
    .sort((a, b) => a - b)
  const maxClusterPrototypeShare = localClusterShares.length
    ? Number(localClusterShares[localClusterShares.length - 1])
    : 0
  const medianClusterPrototypeShare = localClusterShares.length
    ? quantile(localClusterShares, 0.5)
    : 0
  const prototypeQualityStd = stdev(
    selectedLocalPrototypes
      .map((row) => Number(row?.qualityScore ?? 0))
      .filter(Number.isFinite),
  )
  const clusterQualityStd = stdev(
    Array.from(clusterQualityById.values())
      .map((row) => Number(row?.qualityScore ?? 0))
      .filter(Number.isFinite),
  )
  patternLibrary.globalClusters = patternLibrary.globalClusters.map((row) => ({
    ...row,
    support: Number(clusterSupportById.get(row.clusterId) ?? row.support ?? 0),
    localPrototypeCount: Number(localCountByCluster.get(row.clusterId) ?? 0),
    qualityTrades: Number(clusterQualityById.get(row.clusterId)?.trades ?? 0),
    winRate3d: Number(clusterQualityById.get(row.clusterId)?.winRate3d ?? 0),
    targetRate3d: Number(clusterQualityById.get(row.clusterId)?.targetRate3d ?? 0),
    stopRate3d: Number(clusterQualityById.get(row.clusterId)?.stopRate3d ?? 0),
    expectedNetRet3d: Number(clusterQualityById.get(row.clusterId)?.expectedNetRet3d ?? 0),
    baseQualityScore: Number(clusterQualityById.get(row.clusterId)?.baseQualityScore ?? 0.5),
    baseAntiScore: Number(clusterQualityById.get(row.clusterId)?.baseAntiScore ?? 0),
    commonAlignmentScore: Number(clusterQualityById.get(row.clusterId)?.commonAlignmentScore ?? 0),
    qualityScore: Number(clusterQualityById.get(row.clusterId)?.qualityScore ?? 0.5),
    antiScore: Number(clusterQualityById.get(row.clusterId)?.antiScore ?? 0),
    contrastivePositive: Number(clusterQualityById.get(row.clusterId)?.contrastivePositive ?? 0),
    contrastiveNegative: Number(clusterQualityById.get(row.clusterId)?.contrastiveNegative ?? 0),
    contrastiveSamples: Number(clusterQualityById.get(row.clusterId)?.contrastiveSamples ?? 0),
    contrastivePosRate: Number(clusterQualityById.get(row.clusterId)?.contrastivePosRate ?? 1),
    contrastiveNegRate: Number(clusterQualityById.get(row.clusterId)?.contrastiveNegRate ?? 0),
    contrastiveLift: Number(clusterQualityById.get(row.clusterId)?.contrastiveLift ?? 1),
    temporalEraStats: clusterTemporalStability.byCluster.get(row.clusterId)?.eraStats ?? [],
    temporalEraSupportCount: Number(clusterTemporalStability.byCluster.get(row.clusterId)?.eraSupportCount ?? 0),
    temporalEraCoverageRatio: Number(
      clusterTemporalStability.byCluster.get(row.clusterId)?.eraCoverageRatio ?? 0,
    ),
    temporalDominantEraId: clusterTemporalStability.byCluster.get(row.clusterId)?.dominantEraId ?? null,
    temporalDominantEraShare: Number(
      clusterTemporalStability.byCluster.get(row.clusterId)?.dominantEraShare ?? 0,
    ),
    temporalMaxSingleEraShare: Number(
      clusterTemporalStability.byCluster.get(row.clusterId)?.maxSingleEraShare ?? 0,
    ),
    temporalEraSupportMin: Number(
      clusterTemporalStability.byCluster.get(row.clusterId)?.eraSupportMin ?? 0,
    ),
    temporalEraSupportMedian: Number(
      clusterTemporalStability.byCluster.get(row.clusterId)?.eraSupportMedian ?? 0,
    ),
    temporalEraWinRateStd: Number(
      clusterTemporalStability.byCluster.get(row.clusterId)?.eraWinRateStd ?? 0,
    ),
    temporalEraExpectedNetRetStd: Number(
      clusterTemporalStability.byCluster.get(row.clusterId)?.eraExpectedNetRetStd ?? 0,
    ),
    temporalEraContrastiveLiftStd: Number(
      clusterTemporalStability.byCluster.get(row.clusterId)?.eraContrastiveLiftStd ?? 0,
    )
  }))
  patternLibrary.patternQuality = {
    objective: recallOnlyEnabled ? "RECALL_TOPK" : "BALANCED",
    recallOnly: {
      enabled: recallOnlyEnabled
    },
    enabled: qualityCfg.enabled,
    minTradesPerCluster: qualityCfg.minTradesPerCluster,
    prototypeClusterBlend: qualityCfg.prototypeClusterBlend,
    retScale: qualityCfg.retScale,
    weights: qualityCfg.weights,
    contrastive: contrastiveCfg,
    templateLabelStats: {
      positive: positiveTemplates.length,
      negative: negativeTemplates.length,
      negativePrototypeCount: negativePrototypes.length,
      basePosRate: clusterContrastive.basePosRate,
      negativesMapped: clusterContrastive.negativesMapped,
      negativesUnmapped: clusterContrastive.negativesUnmapped
    },
    antiPattern: antiCfg,
    clusterStats: patternLibrary.globalClusters.map((row) => ({
      clusterId: row.clusterId,
      qualityTrades: row.qualityTrades,
      winRate3d: row.winRate3d,
      targetRate3d: row.targetRate3d,
      stopRate3d: row.stopRate3d,
      expectedNetRet3d: row.expectedNetRet3d,
      baseQualityScore: row.baseQualityScore,
      baseAntiScore: row.baseAntiScore,
      commonAlignmentScore: row.commonAlignmentScore,
      qualityScore: row.qualityScore,
      antiScore: row.antiScore,
      contrastiveSamples: row.contrastiveSamples,
      contrastivePosRate: row.contrastivePosRate,
      contrastiveNegRate: row.contrastiveNegRate,
      contrastiveLift: row.contrastiveLift,
      temporalEraSupportCount: row.temporalEraSupportCount,
      temporalEraCoverageRatio: row.temporalEraCoverageRatio,
      temporalDominantEraId: row.temporalDominantEraId,
      temporalDominantEraShare: row.temporalDominantEraShare,
      temporalMaxSingleEraShare: row.temporalMaxSingleEraShare,
      temporalEraSupportMin: row.temporalEraSupportMin,
      temporalEraSupportMedian: row.temporalEraSupportMedian,
      temporalEraWinRateStd: row.temporalEraWinRateStd,
      temporalEraExpectedNetRetStd: row.temporalEraExpectedNetRetStd,
      temporalEraContrastiveLiftStd: row.temporalEraContrastiveLiftStd
    }))
  }

  const runtimeMeta = buildRuntimeScoringMeta({
    localFeatureStats,
    globalFeatureStats,
    clusterCenters: patternLibrary.globalClusters.map((row) => ({
      clusterId: row.clusterId,
      signature: row.signature,
      support: row.support,
      supportRatio: row.supportRatio,
      centerGlobalFeatureVec: row.centerGlobalFeatureVec,
      temporalEraSupportCount: row.temporalEraSupportCount,
      temporalEraCoverageRatio: row.temporalEraCoverageRatio,
      temporalDominantEraId: row.temporalDominantEraId,
      temporalDominantEraShare: row.temporalDominantEraShare,
      temporalMaxSingleEraShare: row.temporalMaxSingleEraShare,
      temporalEraSupportMin: row.temporalEraSupportMin,
      temporalEraSupportMedian: row.temporalEraSupportMedian,
      temporalEraWinRateStd: row.temporalEraWinRateStd,
      temporalEraExpectedNetRetStd: row.temporalEraExpectedNetRetStd,
      temporalEraContrastiveLiftStd: row.temporalEraContrastiveLiftStd
    })),
    localWindow,
    globalWindow,
    stageWeights: ctx.config.similarity?.stageWeights,
    coarseTopN: ctx.config.similarity?.coarseTopN,
    coarseTopClusters: ctx.config.similarity?.coarseTopClusters,
    runtimePrototypeCount: selectedLocalPrototypes.length,
    runtimeClusterCount: patternLibrary.globalClusters.length
  })
  runtimeMeta.runtimeNegativePrototypeCount = negativePrototypes.length
  runtimeMeta.excludedFeatureGroups = Array.from(excludedFeatureGroups).sort((a, b) => a.localeCompare(b))
  runtimeMeta.globalClusterBinMode = clusterBinPlan.mode
  runtimeMeta.globalClusterBinsConfigured = clusterBinPlan.configured
  runtimeMeta.globalClusterBinsApplied = clusterBinPlan.applied
  runtimeMeta.globalClusterMinBins = clusterBinPlan.minBins
  runtimeMeta.globalClusterMaxBins = clusterBinPlan.maxBins
  runtimeMeta.permanentDrop = {
    listPath: permanentDrop.listPath,
    count: permanentDrop.templateIds.size
  }
  runtimeMeta.prototypeSelection = prototypeSelectionCfg
  runtimeMeta.temporalStability = {
    enabled: eraPlan.enabled === true,
    configuredEraCount: Number(eraPlan.configuredEraCount ?? 0),
    appliedEraCount: Number(eraPlan.appliedEraCount ?? 0),
    selectionEnabled: consistencyFiltered?.summary?.temporalSelectionEnabled === true,
    selection: {
      minEraCoverageRatio: Number(consistencyFiltered?.summary?.minEraCoverageRatio ?? 0),
      maxSingleEraShare: Number(consistencyFiltered?.summary?.maxSingleEraShare ?? 1),
      minEraSupportCount: Number(consistencyFiltered?.summary?.minEraSupportCount ?? 0),
      maxEraWinRateStd: Number(consistencyFiltered?.summary?.maxEraWinRateStd ?? 1),
      effectiveMinEraCoverageRatio: Number(
        consistencyFiltered?.summary?.effectiveMinEraCoverageRatio ?? 0,
      ),
      effectiveMaxSingleEraShare: Number(
        consistencyFiltered?.summary?.effectiveMaxSingleEraShare ?? 1,
      ),
      effectiveMinEraSupportCount: Number(
        consistencyFiltered?.summary?.effectiveMinEraSupportCount ?? 0,
      ),
      effectiveMaxEraWinRateStd: Number(
        consistencyFiltered?.summary?.effectiveMaxEraWinRateStd ?? 1,
      ),
      temporalStableCoreCount: Number(
        consistencyFiltered?.summary?.temporalStableCoreCount ?? selectedLocalPrototypes.length,
      ),
      temporalBackfillAdded: Number(consistencyFiltered?.summary?.temporalBackfillAdded ?? 0),
      temporalBackfillCapacity: Number(
        consistencyFiltered?.summary?.temporalBackfillCapacity ?? 0,
      ),
      prototypeEraRebalanceEnabled: eraRebalanced?.summary?.enabled === true,
      prototypeEraRebalanceChangedCount: Number(eraRebalanced?.summary?.changedCount ?? 0),
      prototypeEraRebalanceFallbackFillCount: Number(
        eraRebalanced?.summary?.fallbackFillCount ?? 0,
      ),
      prototypeEraRebalanceRequestedMaxEraShare: Number(
        eraRebalanced?.summary?.requestedMaxEraShare ?? 1,
      ),
      prototypeEraRebalanceAchievedMaxEraShare: Number(
        eraRebalanced?.summary?.achievedMaxEraShare ?? 0,
      ),
      selectedPrototypesMissingClusterIdCount,
      selectedExpectedNetRet3dAvg: Number(
        consistencyFiltered?.summary?.selectedExpectedNetRet3dAvg ?? 0,
      ),
      returnTailShortlistSwapCount: Number(
        localPrototypePack?.summary?.returnTailShortlistSwapCount ?? 0,
      ),
      returnTailShortlistTargetExpectedNetRet3dAvg: Number(
        localPrototypePack?.summary?.returnTailShortlistTargetExpectedNetRet3dAvg ?? 0,
      ),
      returnTailShortlistAchievedExpectedNetRet3dAvg: Number(
        localPrototypePack?.summary?.returnTailShortlistAchievedExpectedNetRet3dAvg ?? 0,
      ),
      returnTailSwapCount: Number(consistencyFiltered?.summary?.returnTailSwapCount ?? 0),
      returnTailTargetExpectedNetRet3dAvg: Number(
        consistencyFiltered?.summary?.returnTailTargetExpectedNetRet3dAvg ?? 0,
      ),
      returnTailAchievedExpectedNetRet3dAvg: Number(
        consistencyFiltered?.summary?.returnTailAchievedExpectedNetRet3dAvg ?? 0,
      )
    },
    eras: eraPlan.eras,
    clusterOverview: clusterTemporalStability.overview,
    selectedClusterOverview: summarizeTemporalOverview({
      rows: selectedClusterTemporalRows,
      cfg: temporalCfg
    }),
    selectedPrototypeEraMix
  }
  runtimeMeta.commonState = {
    enabled: commonCfg.enabled === true,
    path: commonStatePack.statePath,
    applied: !!commonState,
    confidence: commonStateConfidence,
    source: commonState?.source ?? null
  }
  runtimeMeta.objective = recallOnlyEnabled ? "RECALL_TOPK" : "BALANCED"
  runtimeMeta.recallOnly = {
    enabled: recallOnlyEnabled
  }
  runtimeMeta.c0 = patternLibrary.c0
  runtimeMeta.c1 = {
    enabled: c1FamilyProbeIndexPack?.enabled === true || runtime.familyProbeMode === true,
    sourceDir: c1Filter?.summary?.c1SourceDir ?? null,
    familyProbeMode: runtime.familyProbeMode === true,
    probedFamilyCount: Number(c1Filter?.summary?.c1ProbedFamilyCount ?? 0) || 0,
    passedFamilyCount: Number(c1Filter?.summary?.c1PassedFamilyCount ?? 0) || 0,
    rejectedFamilyCount: Number(c1Filter?.summary?.c1RejectedFamilyCount ?? 0) || 0,
    acceptedTemplateCount: Number(c1Filter?.summary?.c1AcceptedTemplateCount ?? templates.length) || 0,
    rejectedTemplateCount: Number(c1Filter?.summary?.c1RejectedTemplateCount ?? 0) || 0,
    representativeCapApplied: c1Filter?.summary?.c1RepresentativeCapApplied === true,
    maxFamilyRepresentatives:
      c1Filter?.summary?.c1MaxFamilyRepresentatives == null
        ? null
        : Number(c1Filter?.summary?.c1MaxFamilyRepresentatives ?? 0) || 0,
    templatesBeforeRepresentativeCap:
      Number(c1Filter?.summary?.c1TemplatesBeforeRepresentativeCap ?? templates.length) || 0,
    templatesAfterRepresentativeCap:
      Number(c1Filter?.summary?.c1TemplatesAfterRepresentativeCap ?? templates.length) || 0,
    fallbackUsed: c1Filter?.summary?.c1FallbackUsed === true,
    gateFailed: c1Filter?.summary?.c1GateFailed === true,
    gate: c1FamilyProbeIndexPack?.index?.gate ?? null,
    probeScope: c1FamilyProbeIndexPack?.index?.probeScope ?? runtime.probeScopeOverride ?? null,
    probeProfile:
      c1FamilyProbeIndexPack?.index?.probeProfile ??
      runtime.stepDProfileOverride ??
      runtime.stepDExecutionProfileOverride ??
      null,
    passedFamilyIds: Array.isArray(c1FamilyProbeIndexPack?.index?.passedFamilyIds)
      ? c1FamilyProbeIndexPack.index.passedFamilyIds
      : (Array.isArray(runtime.allowedC0FamilyIds) ? runtime.allowedC0FamilyIds : []),
    backfillFamilyIds: Array.isArray(c1FamilyProbeIndexPack?.index?.backfillFamilyIds)
      ? c1FamilyProbeIndexPack.index.backfillFamilyIds
      : [],
    rejectedFamilyIds: Array.isArray(c1FamilyProbeIndexPack?.index?.rejectedFamilyIds)
      ? c1FamilyProbeIndexPack.index.rejectedFamilyIds
      : []
  }
  runtimeMeta.c2 = {
    enabled: c2DedupIndexPack?.enabled === true,
    sourceDir: c2Filter?.summary?.c2SourceDir ?? null,
    dedupedFamilyCount: Number(c2Filter?.summary?.c2DedupedFamilyCount ?? 0) || 0,
    representativeFamilyCount: Number(c2Filter?.summary?.c2RepresentativeFamilyCount ?? 0) || 0,
    shadowFamilyCount: Number(c2Filter?.summary?.c2ShadowFamilyCount ?? 0) || 0,
    acceptedTemplateCount: Number(c2Filter?.summary?.c2AcceptedTemplateCount ?? templates.length) || 0,
    rejectedTemplateCount: Number(c2Filter?.summary?.c2RejectedTemplateCount ?? 0) || 0,
    fallbackUsed: c2Filter?.summary?.c2FallbackUsed === true,
    gateFailed: c2Filter?.summary?.c2GateFailed === true,
    gate: c2DedupIndexPack?.index?.gate ?? null,
    representativePolicy: c2DedupIndexPack?.cfg?.representativePolicy ?? null,
    similarityPolicyVersion: c2DedupIndexPack?.cfg?.similarityPolicyVersion ?? null,
    representativeFamilyIds: Array.isArray(c2DedupIndexPack?.index?.representativeFamilyIds)
      ? c2DedupIndexPack.index.representativeFamilyIds
      : [],
    shadowFamilyIds: Array.isArray(c2DedupIndexPack?.index?.shadowFamilyIds)
      ? c2DedupIndexPack.index.shadowFamilyIds
      : []
  }
  runtimeMeta.familyPool = {
    enabled: familyPoolFilter?.summary?.enabled === true,
    path: familyPoolFilter?.summary?.familyPoolPath ?? null,
    productionReady: familyPoolFilter?.summary?.productionReady === true,
    minProductionFamilies: Number(familyPoolFilter?.summary?.minProductionFamilies ?? 0) || 0,
    productionFamilyCount: Number(familyPoolFilter?.summary?.productionFamilyCount ?? 0) || 0,
    watchlistFamilyCount: Number(familyPoolFilter?.summary?.watchlistFamilyCount ?? 0) || 0,
    rejectedFamilyCount: Number(familyPoolFilter?.summary?.rejectedFamilyCount ?? 0) || 0,
    acceptedTemplateCount:
      Number(familyPoolFilter?.summary?.acceptedTemplateCount ?? templates.length) || 0,
    rejectedTemplateCount: Number(familyPoolFilter?.summary?.rejectedTemplateCount ?? 0) || 0,
    fallbackUsed: familyPoolFilter?.summary?.fallbackUsed === true,
    effectiveSource: familyPoolFilter?.summary?.effectiveSource ?? null,
    productionFamilyIds: familyPoolFilter?.summary?.productionFamilyIds ?? [],
    watchlistFamilyIds: familyPoolFilter?.summary?.watchlistFamilyIds ?? [],
    rejectedFamilyIds: familyPoolFilter?.summary?.rejectedFamilyIds ?? []
  }
  runtimeMeta.prototypeQuality = selectedLocalPrototypes.map((row) => ({
    templateId: row.templateId,
    clusterId: row.clusterId ?? null,
    clusterSignature: row.clusterSignature ?? null,
    outcomeBucket: row.outcomeBucket ?? null,
    executionFeasibilityBucket: row.executionFeasibilityBucket ?? null,
    c0FamilyId: row.c0FamilyId ?? null,
    c0FamilySignature: row.c0FamilySignature ?? null,
    c0Score: Number(row.c0Score ?? 0) || 0,
    c0Shortlisted: row.c0Shortlisted === true,
    c0FamilySupport: Number(row.c0FamilySupport ?? 0) || 0,
    c0CorePrototypeShare: Number(row.c0CorePrototypeShare ?? 0) || 0,
    c0PenaltyPrototypeShare: Number(row.c0PenaltyPrototypeShare ?? 0) || 0,
    c0QuarantinePrototypeShare: Number(row.c0QuarantinePrototypeShare ?? 0) || 0,
    c0PrototypeQualityMedian: Number(row.c0PrototypeQualityMedian ?? 0) || 0,
    qualityTrades: Number(row.qualityTrades ?? 0),
    winRate3d: Number(row.winRate3d ?? 0),
    targetRate3d: Number(row.targetRate3d ?? 0),
    stopRate3d: Number(row.stopRate3d ?? 0),
    expectedNetRet3d: Number(row.expectedNetRet3d ?? 0),
    baseQualityScore: Number(row.baseQualityScore ?? 0.5),
    baseAntiScore: Number(row.baseAntiScore ?? 0),
    commonAlignmentScore: Number(row.commonAlignmentScore ?? 0),
    qualityScore: Number(row.qualityScore ?? 0.5),
    antiScore: Number(row.antiScore ?? 0),
    contrastiveSamples: Number(row.contrastiveSamples ?? 0),
    contrastivePosRate: Number(row.contrastivePosRate ?? 1),
    contrastiveNegRate: Number(row.contrastiveNegRate ?? 0),
    contrastiveLift: Number(row.contrastiveLift ?? 1),
    selectedEraId: row.selectedEraId ?? null,
    clusterTemporalEraSupportCount: Number(row.clusterTemporalEraSupportCount ?? 0),
    clusterTemporalEraCoverageRatio: Number(row.clusterTemporalEraCoverageRatio ?? 0),
    clusterTemporalDominantEraId: row.clusterTemporalDominantEraId ?? null,
    clusterTemporalDominantEraShare: Number(row.clusterTemporalDominantEraShare ?? 0),
    clusterTemporalMaxSingleEraShare: Number(row.clusterTemporalMaxSingleEraShare ?? 0),
    clusterTemporalEraSupportMin: Number(row.clusterTemporalEraSupportMin ?? 0),
    clusterTemporalEraSupportMedian: Number(row.clusterTemporalEraSupportMedian ?? 0),
    clusterTemporalEraEntropy: Number(row.clusterTemporalEraEntropy ?? 0),
    clusterTemporalNormalizedEraEntropy: Number(row.clusterTemporalNormalizedEraEntropy ?? 0),
    clusterTemporalEffectiveEraCount: Number(row.clusterTemporalEffectiveEraCount ?? 0),
    clusterTemporalEraWinRateStd: Number(row.clusterTemporalEraWinRateStd ?? 0),
    clusterTemporalEraExpectedNetRetStd: Number(row.clusterTemporalEraExpectedNetRetStd ?? 0),
    clusterTemporalEraContrastiveLiftStd: Number(row.clusterTemporalEraContrastiveLiftStd ?? 0),
    prototypeLedgerStatus: row.prototypeLedgerStatus ?? null,
    prototypeLedgerFamilyStatus: row.prototypeLedgerFamilyStatus ?? null,
    prototypeLedgerCompositeQuality: Number(row.prototypeLedgerCompositeQuality ?? 0) || 0,
    prototypeLedgerConfidence: Number(row.prototypeLedgerConfidence ?? 0) || 0,
    familyPoolStatus:
      runtimeMeta.familyPool.productionFamilyIds.includes(String(row.c0FamilyId ?? "").trim())
        ? "PRODUCTION"
        : runtimeMeta.familyPool.watchlistFamilyIds.includes(String(row.c0FamilyId ?? "").trim())
          ? "WATCHLIST"
          : runtimeMeta.familyPool.rejectedFamilyIds.includes(String(row.c0FamilyId ?? "").trim())
            ? "REJECTED"
            : null,
    failedBreakoutCount20: Number(row?.featureVec?.["shape.failedBreakoutCount20"] ?? row?.failedBreakoutCount20 ?? 0) || 0,
    gapFillThenContinueScore:
      Number(row?.featureVec?.["gap.fillThenContinueScore"] ?? row?.gapFillThenContinueScore ?? 0) || 0,
    gapFillThenRevertScore:
      Number(row?.featureVec?.["gap.fillThenRevertScore"] ?? row?.gapFillThenRevertScore ?? 0) || 0,
    executionFeasibilityScore:
      Number(row?.featureVec?.["execution.feasibilityScore"] ?? row?.executionFeasibilityScore ?? 0) || 0
  }))
  patternLibrary.familyPool = runtimeMeta.familyPool
  patternLibrary.prototypeLedger = {
    enabled: adaptiveFrontierPack?.prototypeLedger?.enabled === true,
    path: adaptiveFrontierPack?.prototypeLedgerPath ?? null,
    entryCount: Array.isArray(adaptiveFrontierPack?.prototypeLedger?.manifest?.entries)
      ? adaptiveFrontierPack.prototypeLedger.manifest.entries.length
      : 0
  }

  const summary = {
    step: "C",
    status: "PASS",
    inputMode,
    inputPath: inPath,
    stepBSourceRunId,
    stepBSourceRunDir,
    familyProbeMode: familyProbeMode === true,
    runtimeAllowedC0FamilyIds: Array.isArray(runtime.allowedC0FamilyIds)
      ? runtime.allowedC0FamilyIds.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [],
    rawTemplates: rawTemplates.length,
    templates: templates.length,
    templatesBeforeC0: templatesNormalized.length,
    templatesAfterC0Filter: c0Filter.templates.length,
    templatesAfterC1Filter: c1Filter.templates.length,
    templatesAfterC2Filter: c2Filter.templates.length,
    templatesAfterFamilyPoolFilter: familyPoolFilter.templates.length,
    positiveTemplates: positiveTemplates.length,
    negativeTemplates: negativeTemplates.length,
    localWindow,
    globalWindow,
    localFeatureCount: Object.keys(localFeatureStats).length,
    globalFeatureCount: Object.keys(globalFeatureStats).length,
    localRules: localRules.length,
    globalRules: globalRules.length,
    objective: recallOnlyEnabled ? "RECALL_TOPK" : "BALANCED",
    recallOnly: recallOnlyEnabled,
    precisionFiltersDisabled: recallOnlyEnabled,
    excludedFeatureGroups: Array.from(excludedFeatureGroups).sort((a, b) => a.localeCompare(b)),
    permanentDropListPath: permanentDrop.listPath,
    permanentDropCount: permanentDrop.templateIds.size,
    templatesDroppedByPermanent: droppedByPermanent,
    globalClusterBinMode: clusterBinPlan.mode,
    globalClusterBinsConfigured: clusterBinPlan.configured,
    globalClusterBinsApplied: clusterBinPlan.applied,
    globalClusterMinBins: clusterBinPlan.minBins,
    globalClusterMaxBins: clusterBinPlan.maxBins,
    globalClusters: patternLibrary.globalClusters.length,
    globalPrototypes: globalPrototypes.length,
    negativePrototypes: negativePrototypes.length,
    prototypes: selectedLocalPrototypes.length,
    localPrototypes: selectedLocalPrototypes.length,
    qualityEnabled: qualityCfg.enabled,
    contrastiveEnabled: contrastiveCfg.enabled,
    prototypeSelectionEnabled: prototypeSelectionCfg.enabled === true,
    prototypeSelectionMinPerCluster: Number(prototypeSelectionCfg.minPerCluster ?? 0),
    prototypeSelectionMaxPerSymbol: Number(prototypeSelectionCfg.maxPerSymbol ?? 0),
    prototypeSelectionMaxCandidatesPerCluster:
      Number(prototypeSelectionCfg.maxCandidatesPerCluster ?? 0),
    prototypeSelectionMaxClusterShare: Number(prototypeSelectionCfg.maxClusterShare ?? 1),
    prototypeSelectionMinDistinctClusters: Number(prototypeSelectionCfg.minDistinctClusters ?? 1),
    prototypeSelectionMinClusterSupport: Number(prototypeSelectionCfg.minClusterSupport ?? 0),
    prototypeSelectionMinQualityTrades: Number(prototypeSelectionCfg.minQualityTrades ?? 0),
    prototypeSelectionMinContrastiveSamples: Number(prototypeSelectionCfg.minContrastiveSamples ?? 0),
    prototypeSelectionMinQualityScore: Number(prototypeSelectionCfg.minQualityScore ?? 0),
    prototypeSelectionMinPrototypeFloor: Number(prototypeSelectionCfg.minPrototypeFloor ?? 0),
    prototypeSelectionMinNegativePrototypeFloor:
      Number(prototypeSelectionCfg.minNegativePrototypeFloor ?? 0),
    prototypeSelectionMinClusterFloor: Number(prototypeSelectionCfg.minClusterFloor ?? 0),
    prototypeSelectionMaxBackfillAdditions: Number(prototypeSelectionCfg.maxBackfillAdditions ?? 0),
    prototypeSelectionMaxBackfillRatio: Number(prototypeSelectionCfg.maxBackfillRatio ?? 0),
    prototypeSelectionRelaxRounds: Number(prototypeSelectionCfg.relaxRounds ?? 0),
    prototypeSelectionTemporalSelectionEnabled:
      consistencyFiltered?.summary?.temporalSelectionEnabled === true,
    prototypeSelectionMinEraCoverageRatio: Number(
      consistencyFiltered?.summary?.minEraCoverageRatio ?? 0,
    ),
    prototypeSelectionMaxSingleEraShare: Number(
      consistencyFiltered?.summary?.maxSingleEraShare ?? 1,
    ),
    prototypeSelectionMinEraSupportCount: Number(
      consistencyFiltered?.summary?.minEraSupportCount ?? 0,
    ),
    prototypeSelectionMinEffectiveEraCountRatio: Number(
      consistencyFiltered?.summary?.minEffectiveEraCountRatio ?? 0,
    ),
    prototypeSelectionMinNormalizedEraEntropy: Number(
      consistencyFiltered?.summary?.minNormalizedEraEntropy ?? 0,
    ),
    prototypeSelectionMaxEraWinRateStd: Number(
      consistencyFiltered?.summary?.maxEraWinRateStd ?? 1,
    ),
    keptByConsistency: Number(consistencyFiltered?.summary?.keptByConsistency ?? selectedLocalPrototypes.length),
    prunedByConsistency: Number(consistencyFiltered?.summary?.prunedByConsistency ?? 0),
    keptClusterCount: Number(consistencyFiltered?.summary?.keptClusterCount ?? localCountByCluster.size),
    consistencyRelaxApplied: Number(consistencyFiltered?.summary?.relaxApplied ?? 0),
    effectiveMinContrastiveSamples: Number(
      consistencyFiltered?.summary?.effectiveMinContrastiveSamples ??
      prototypeSelectionCfg.minContrastiveSamples ??
      0,
    ),
    effectiveMinQualityScore: Number(
      consistencyFiltered?.summary?.effectiveMinQualityScore ??
      prototypeSelectionCfg.minQualityScore ??
      0,
    ),
    effectiveMinEraCoverageRatio: Number(
      consistencyFiltered?.summary?.effectiveMinEraCoverageRatio ??
      temporalCfg.minEraCoverageRatio ??
      0,
    ),
    effectiveMaxSingleEraShare: Number(
      consistencyFiltered?.summary?.effectiveMaxSingleEraShare ??
      temporalCfg.maxSingleEraShare ??
      1,
    ),
    effectiveMinEraSupportCount: Number(
      consistencyFiltered?.summary?.effectiveMinEraSupportCount ??
      temporalCfg.minEraSupportCount ??
      0,
    ),
    effectiveMinEffectiveEraCountRatio: Number(
      consistencyFiltered?.summary?.effectiveMinEffectiveEraCountRatio ??
      temporalCfg.minEffectiveEraCountRatio ??
      0,
    ),
    effectiveMinNormalizedEraEntropy: Number(
      consistencyFiltered?.summary?.effectiveMinNormalizedEraEntropy ??
      temporalCfg.minNormalizedEraEntropy ??
      0,
    ),
    effectiveMaxEraWinRateStd: Number(
      consistencyFiltered?.summary?.effectiveMaxEraWinRateStd ??
      temporalCfg.maxEraWinRateStd ??
      1,
    ),
    temporalStableCoreCount: Number(
      consistencyFiltered?.summary?.temporalStableCoreCount ?? selectedLocalPrototypes.length,
    ),
    temporalBackfillAdded: Number(consistencyFiltered?.summary?.temporalBackfillAdded ?? 0),
    temporalBackfillCapacity: Number(consistencyFiltered?.summary?.temporalBackfillCapacity ?? 0),
    prototypeEraRebalanceEnabled: eraRebalanced?.summary?.enabled === true,
    prototypeEraRebalanceChangedCount: Number(eraRebalanced?.summary?.changedCount ?? 0),
    prototypeEraRebalanceFallbackFillCount: Number(
      eraRebalanced?.summary?.fallbackFillCount ?? 0,
    ),
    prototypeEraRebalanceRequestedMaxEraShare: Number(
      eraRebalanced?.summary?.requestedMaxEraShare ?? 1,
    ),
    prototypeEraRebalanceAchievedMaxEraShare: Number(
      eraRebalanced?.summary?.achievedMaxEraShare ?? 0,
    ),
    selectedPrototypesMissingClusterIdCount,
    selectedExpectedNetRet3dAvg: Number(
      consistencyFiltered?.summary?.selectedExpectedNetRet3dAvg ?? 0,
    ),
    returnTailShortlistSwapCount: Number(
      localPrototypePack?.summary?.returnTailShortlistSwapCount ?? 0,
    ),
    returnTailShortlistTargetExpectedNetRet3dAvg: Number(
      localPrototypePack?.summary?.returnTailShortlistTargetExpectedNetRet3dAvg ?? 0,
    ),
    returnTailShortlistAchievedExpectedNetRet3dAvg: Number(
      localPrototypePack?.summary?.returnTailShortlistAchievedExpectedNetRet3dAvg ?? 0,
    ),
    returnTailSwapCount: Number(consistencyFiltered?.summary?.returnTailSwapCount ?? 0),
    returnTailTargetExpectedNetRet3dAvg: Number(
      consistencyFiltered?.summary?.returnTailTargetExpectedNetRet3dAvg ?? 0,
    ),
    returnTailAchievedExpectedNetRet3dAvg: Number(
      consistencyFiltered?.summary?.returnTailAchievedExpectedNetRet3dAvg ?? 0,
    ),
    prunedByConsistencyReasons: consistencyFiltered?.summary?.prunedReasons ?? {
      clusterSupport: 0,
      qualityTrades: 0,
      contrastiveSamples: 0,
      qualityScore: 0,
      temporalEraSupport: 0,
      temporalCoverage: 0,
      temporalConcentration: 0,
      temporalWinRateStd: 0
    },
    runtimePrototypeCount: selectedLocalPrototypes.length,
    runtimeClusterCount: patternLibrary.globalClusters.length,
    maxClusterPrototypeShare,
    medianClusterPrototypeShare,
    prototypeQualityStd,
    clusterQualityStd,
    contrastiveBasePosRate: clusterContrastive.basePosRate,
    qualityPrototypes: runtimeMeta.prototypeQuality.length,
    temporalStabilityEnabled: eraPlan.enabled === true,
    temporalEraCountConfigured: Number(eraPlan.configuredEraCount ?? 0),
    temporalEraCountApplied: Number(eraPlan.appliedEraCount ?? 0),
    temporalStability: {
      enabled: eraPlan.enabled === true,
      configuredEraCount: Number(eraPlan.configuredEraCount ?? 0),
      appliedEraCount: Number(eraPlan.appliedEraCount ?? 0),
      eras: eraPlan.eras,
      clusterOverview: clusterTemporalStability.overview,
      selectedClusterOverview: summarizeTemporalOverview({
        rows: selectedClusterTemporalRows,
        cfg: temporalCfg
      }),
      selectedPrototypeEraMix
    },
    commonStateEnabled: commonCfg.enabled === true,
    commonStateApplied: !!commonState,
    commonStatePath: commonStatePack.statePath,
    commonStateConfidence: commonStateConfidence,
    commonStatePrototypeScores: Object.keys(commonState?.prototypeScores ?? {}).length,
    commonStateRegimeWeights: Object.keys(commonState?.regimeWeights ?? {}).length,
    commonStateAdjustedPrototypes: selectedLocalPrototypes.filter(
      (row) => Math.abs(Number(row?.commonAlignmentScore ?? 0)) > 0,
    ).length,
    c0Enabled: c0FamilyIndexPack?.enabled === true,
    c0SourceDir: c0Filter?.summary?.c0SourceDir ?? null,
    c0FamilyCount: Number(c0Filter?.summary?.c0FamilyCount ?? 0) || 0,
    c0ShortlistedFamilyCount: Number(c0Filter?.summary?.c0ShortlistedFamilyCount ?? 0) || 0,
    c0NominalShortlistedFamilyIds: c0Filter?.summary?.c0NominalShortlistedFamilyIds ?? [],
    c0EffectiveFamilyIds: c0Filter?.summary?.c0EffectiveFamilyIds ?? [],
    c0EffectiveSource: c0Filter?.summary?.c0EffectiveSource ?? null,
    c0AcceptedTemplateCount: Number(c0Filter?.summary?.c0AcceptedTemplateCount ?? templates.length) || 0,
    c0RejectedTemplateCount: Number(c0Filter?.summary?.c0RejectedTemplateCount ?? 0) || 0,
    c0FallbackUsed: c0Filter?.summary?.c0FallbackUsed === true,
    c0GateFailed: c0Filter?.summary?.c0GateFailed === true,
    c0Gate: c0FamilyIndexPack?.index?.c0Gate ?? null,
    c0ShortlistPolicy: c0FamilyIndexPack?.index?.shortlistPolicy ?? null,
    c1Enabled: c1FamilyProbeIndexPack?.enabled === true || runtime.familyProbeMode === true,
    c1SourceDir: c1Filter?.summary?.c1SourceDir ?? null,
    c1FamilyProbeMode: runtime.familyProbeMode === true,
    c1ProbedFamilyCount: Number(c1Filter?.summary?.c1ProbedFamilyCount ?? 0) || 0,
    c1PassedFamilyCount: Number(c1Filter?.summary?.c1PassedFamilyCount ?? 0) || 0,
    c1RejectedFamilyCount: Number(c1Filter?.summary?.c1RejectedFamilyCount ?? 0) || 0,
    c1NominalPassedFamilyIds:
      c1Filter?.summary?.c1NominalPassedFamilyIds ??
      c1Filter?.summary?.nominalPassedFamilyIds ??
      [],
    c1NominalBackfillFamilyIds:
      c1Filter?.summary?.c1NominalBackfillFamilyIds ??
      c1Filter?.summary?.nominalBackfillFamilyIds ??
      [],
    c1NominalRejectedFamilyIds:
      c1Filter?.summary?.c1NominalRejectedFamilyIds ??
      c1Filter?.summary?.nominalRejectedFamilyIds ??
      [],
    c1EffectiveFamilyIds:
      c1Filter?.summary?.c1EffectiveFamilyIds ??
      c1Filter?.summary?.effectiveFamilyIds ??
      [],
    c1EffectiveSource:
      c1Filter?.summary?.c1EffectiveSource ??
      c1Filter?.summary?.effectiveSource ??
      null,
    c1AcceptedTemplateCount: Number(c1Filter?.summary?.c1AcceptedTemplateCount ?? templates.length) || 0,
    c1RejectedTemplateCount: Number(c1Filter?.summary?.c1RejectedTemplateCount ?? 0) || 0,
    c1RepresentativeCapApplied: c1Filter?.summary?.c1RepresentativeCapApplied === true,
    c1MaxFamilyRepresentatives:
      c1Filter?.summary?.c1MaxFamilyRepresentatives == null
        ? null
        : Number(c1Filter?.summary?.c1MaxFamilyRepresentatives ?? 0) || 0,
    c1TemplatesBeforeRepresentativeCap:
      Number(c1Filter?.summary?.c1TemplatesBeforeRepresentativeCap ?? templates.length) || 0,
    c1TemplatesAfterRepresentativeCap:
      Number(c1Filter?.summary?.c1TemplatesAfterRepresentativeCap ?? templates.length) || 0,
    c1FallbackUsed: c1Filter?.summary?.c1FallbackUsed === true,
    c1GateFailed: c1Filter?.summary?.c1GateFailed === true,
    c1Gate: c1FamilyProbeIndexPack?.index?.gate ?? null,
    c2Enabled: c2DedupIndexPack?.enabled === true,
    c2SourceDir: c2Filter?.summary?.c2SourceDir ?? null,
    c2DedupedFamilyCount: Number(c2Filter?.summary?.c2DedupedFamilyCount ?? 0) || 0,
    c2RepresentativeFamilyCount: Number(c2Filter?.summary?.c2RepresentativeFamilyCount ?? 0) || 0,
    c2ShadowFamilyCount: Number(c2Filter?.summary?.c2ShadowFamilyCount ?? 0) || 0,
    c2NominalRepresentativeFamilyIds:
      c2Filter?.summary?.c2NominalRepresentativeFamilyIds ?? [],
    c2NominalShadowFamilyIds:
      c2Filter?.summary?.c2NominalShadowFamilyIds ?? [],
    c2EffectiveRepresentativeFamilyIds:
      c2Filter?.summary?.c2EffectiveRepresentativeFamilyIds ?? [],
    c2EffectiveSource: c2Filter?.summary?.c2EffectiveSource ?? null,
    c2AcceptedTemplateCount: Number(c2Filter?.summary?.c2AcceptedTemplateCount ?? templates.length) || 0,
    c2RejectedTemplateCount: Number(c2Filter?.summary?.c2RejectedTemplateCount ?? 0) || 0,
    c2FallbackUsed: c2Filter?.summary?.c2FallbackUsed === true,
    c2GateFailed: c2Filter?.summary?.c2GateFailed === true,
    c2Gate: c2DedupIndexPack?.index?.gate ?? null,
    familyPoolEnabled: familyPoolFilter?.summary?.enabled === true,
    familyPoolPath: familyPoolFilter?.summary?.familyPoolPath ?? null,
    familyPoolProductionReady: familyPoolFilter?.summary?.productionReady === true,
    familyPoolMinProductionFamilies:
      Number(familyPoolFilter?.summary?.minProductionFamilies ?? 0) || 0,
    familyPoolProductionFamilyCount: Number(familyPoolFilter?.summary?.productionFamilyCount ?? 0) || 0,
    familyPoolWatchlistFamilyCount: Number(familyPoolFilter?.summary?.watchlistFamilyCount ?? 0) || 0,
    familyPoolRejectedFamilyCount: Number(familyPoolFilter?.summary?.rejectedFamilyCount ?? 0) || 0,
    familyPoolAcceptedTemplateCount:
      Number(familyPoolFilter?.summary?.acceptedTemplateCount ?? templates.length) || 0,
    familyPoolRejectedTemplateCount: Number(familyPoolFilter?.summary?.rejectedTemplateCount ?? 0) || 0,
    familyPoolFallbackUsed: familyPoolFilter?.summary?.fallbackUsed === true,
    familyPoolEffectiveSource: familyPoolFilter?.summary?.effectiveSource ?? null,
    adaptiveFrontierEnabled: adaptiveFrontierPack?.cfg?.enabled === true,
    adaptiveCandidateMode: adaptiveFrontierPack?.cfg?.candidateMode ?? "boost_penalty",
    adaptiveAcceptedByQuality: Number(adaptiveFrontierSelected?.summary?.acceptedByQuality ?? 0) || 0,
    adaptiveRejectedByQuality: Number(adaptiveFrontierSelected?.summary?.rejectedByQuality ?? 0) || 0,
    adaptiveAcceptedBySalvageBoost: Number(
      adaptiveFrontierSelected?.summary?.acceptedBySalvageBoost ?? 0,
    ) || 0,
    adaptiveAcceptedBySalvagePenalty: Number(
      adaptiveFrontierSelected?.summary?.acceptedBySalvagePenalty ?? 0,
    ) || 0,
    adaptiveRejectedByQuarantine: Number(
      adaptiveFrontierSelected?.summary?.rejectedByQuarantine ?? 0,
    ) || 0,
    adaptiveBackfilledToFloor: Number(adaptiveFrontierSelected?.summary?.backfilledToFloor ?? 0) || 0,
    adaptiveRetiredByHardRule: Number(adaptiveFrontierSelected?.summary?.retiredByHardRule ?? 0) || 0,
    adaptivePreviousRunEAssistWeight:
      Number(adaptiveFrontierSelected?.summary?.previousRunEAssistWeight ?? 0) || 0,
    adaptivePreviousRunEAssistThreshold:
      Number(adaptiveFrontierSelected?.summary?.previousRunEAssistThreshold ?? 0) || 0,
    adaptivePreviousRunEAssistBoostMatches:
      Number(adaptiveFrontierSelected?.summary?.previousRunEAssistBoostMatches ?? 0) || 0,
    adaptivePreviousRunEAssistPenaltyMatches:
      Number(adaptiveFrontierSelected?.summary?.previousRunEAssistPenaltyMatches ?? 0) || 0,
    adaptiveAverageCQualityScore:
      Number(adaptiveFrontierSelected?.summary?.averageCQualityScore ?? 0) || 0,
    adaptiveAverageProxyScore:
      Number(adaptiveFrontierSelected?.summary?.averageProxyScore ?? 0) || 0,
    cQualityScoreBreakdown: adaptiveFrontierSelected?.summary?.cQualityScoreBreakdown ?? null,
    salvagePoolPath: adaptiveFrontierPack?.salvagePoolPath ?? null,
    salvageBoostPatternCount: Number(
      adaptiveFrontierSelected?.summary?.salvageBoostPatternCount ?? 0,
    ) || 0,
    salvagePenaltyPatternCount: Number(
      adaptiveFrontierSelected?.summary?.salvagePenaltyPatternCount ?? 0,
    ) || 0,
    quarantinePoolPath: adaptiveFrontierPack?.quarantinePoolPath ?? null,
    quarantinePatternCount: Number(
      adaptiveFrontierSelected?.summary?.quarantinePatternCount ?? 0,
    ) || 0,
    prototypeLedgerPath: adaptiveFrontierPack?.prototypeLedgerPath ?? null,
    prototypeLedgerEntryCount: Array.isArray(adaptiveFrontierPack?.prototypeLedger?.manifest?.entries)
      ? adaptiveFrontierPack.prototypeLedger.manifest.entries.length
      : 0,
    adaptiveLedgerCoreCount: Number(adaptiveFrontierSelected?.summary?.ledgerCoreCount ?? 0) || 0,
    adaptiveLedgerWatchCount: Number(adaptiveFrontierSelected?.summary?.ledgerWatchCount ?? 0) || 0,
    adaptiveLedgerPenaltyCount: Number(adaptiveFrontierSelected?.summary?.ledgerPenaltyCount ?? 0) || 0,
    adaptiveLedgerQuarantineCount:
      Number(adaptiveFrontierSelected?.summary?.ledgerQuarantineCount ?? 0) || 0,
    adaptiveLedgerRetiredCount: Number(adaptiveFrontierSelected?.summary?.ledgerRetiredCount ?? 0) || 0,
    adaptiveLedgerBoostedCount: Number(
      adaptiveFrontierSelected?.summary?.ledgerBoostedCount ?? 0,
    ) || 0,
    adaptiveLedgerSuppressedCount: Number(
      adaptiveFrontierSelected?.summary?.ledgerSuppressedCount ?? 0,
    ) || 0,
    negativePrototypeFloor: negativePrototypeFloor,
    negativePrototypeFloorFailed,
    c0: patternLibrary.c0,
    runtimePath: path.join(outDir, "pattern_library_runtime.json")
  }

  const libraryPath = path.join(outDir, "pattern_library.json")
  const runtimePath = path.join(outDir, "pattern_library_runtime.json")
  const indexManifestPath = path.join(outDir, "step_c_index_manifest.json")
  const shapingStatePath = path.join(outDir, "step_c_shaping_state.json")
  await writeJson(libraryPath, patternLibrary)
  await writeJson(runtimePath, runtimeMeta)
  await writeJson(summaryPath, summary)
  const indexManifest = await buildStepCIndexManifest({
    libraryPath,
    runtimePath,
    summaryPath,
    c0FamilyIndexPath: c0FamilyIndexPack?.sourceDir
      ? path.join(c0FamilyIndexPack.sourceDir, "c0_family_index.json")
      : null,
    c0SummaryPath: c0FamilyIndexPack?.sourceDir
      ? path.join(c0FamilyIndexPack.sourceDir, "c0_summary.json")
      : null,
    c1IndexPath: c1FamilyProbeIndexPack?.sourceDir
      ? path.join(c1FamilyProbeIndexPack.sourceDir, "c1_family_probe_index.json")
      : null,
    c1SummaryPath: c1FamilyProbeIndexPack?.sourceDir
      ? path.join(c1FamilyProbeIndexPack.sourceDir, "c1_summary.json")
      : null,
    c2IndexPath: c2DedupIndexPack?.sourceDir
      ? path.join(c2DedupIndexPack.sourceDir, "c2_dedup_index.json")
      : null,
    c2SummaryPath: c2DedupIndexPack?.sourceDir
      ? path.join(c2DedupIndexPack.sourceDir, "c2_summary.json")
      : null,
    c2GroupsPath: c2DedupIndexPack?.sourceDir
      ? path.join(c2DedupIndexPack.sourceDir, "c2_dedup_groups.jsonl")
      : null,
    objective: summary?.objective,
    recallOnly: summary?.recallOnly === true
  })
  const shapingStateManifest = await buildStepCShapingStateManifest({
    permanentDropListPath: permanentDrop.listPath,
    permanentDropCount: permanentDrop.templateIds.size,
    commonStatePath: commonStatePack.statePath,
    commonStateApplied: !!commonState,
    commonStateSource: commonState?.source ?? null,
    candidateMode: adaptiveFrontierPack?.cfg?.candidateMode ?? "boost_penalty",
    c0Enabled: c0FamilyIndexPack?.enabled === true,
    c0InputMode: c0FamilyIndexPack?.index?.inputMode ?? null,
    c0ShortlistedFamilyCount: Number(c0Filter?.summary?.c0ShortlistedFamilyCount ?? 0) || 0,
    c0EffectiveFamilyIds: c0Filter?.summary?.c0EffectiveFamilyIds ?? [],
    c0EffectiveSource: c0Filter?.summary?.c0EffectiveSource ?? null,
    c0FallbackUsed: c0Filter?.summary?.c0FallbackUsed === true,
    c1Enabled: c1FamilyProbeIndexPack?.enabled === true || runtime.familyProbeMode === true,
    c1PassedFamilyCount: Number(c1Filter?.summary?.c1PassedFamilyCount ?? 0) || 0,
    c1EffectiveFamilyIds:
      c1Filter?.summary?.c1EffectiveFamilyIds ??
      c1Filter?.summary?.effectiveFamilyIds ??
      [],
    c1EffectiveSource:
      c1Filter?.summary?.c1EffectiveSource ??
      c1Filter?.summary?.effectiveSource ??
      null,
    c1RepresentativeCapApplied: c1Filter?.summary?.c1RepresentativeCapApplied === true,
    c1MaxFamilyRepresentatives:
      c1Filter?.summary?.c1MaxFamilyRepresentatives == null
        ? null
        : Number(c1Filter?.summary?.c1MaxFamilyRepresentatives ?? 0) || 0,
    c1TemplatesBeforeRepresentativeCap:
      Number(c1Filter?.summary?.c1TemplatesBeforeRepresentativeCap ?? templates.length) || 0,
    c1TemplatesAfterRepresentativeCap:
      Number(c1Filter?.summary?.c1TemplatesAfterRepresentativeCap ?? templates.length) || 0,
    c1FallbackUsed: c1Filter?.summary?.c1FallbackUsed === true,
    c1ProbeScope: c1FamilyProbeIndexPack?.index?.probeScope ?? runtime.probeScopeOverride ?? null,
    c1ProbeProfile:
      c1FamilyProbeIndexPack?.index?.probeProfile ??
      runtime.stepDProfileOverride ??
      runtime.stepDExecutionProfileOverride ??
      null,
    c2Enabled: c2DedupIndexPack?.enabled === true,
    c2RepresentativeFamilyCount: Number(c2Filter?.summary?.c2RepresentativeFamilyCount ?? 0) || 0,
    c2EffectiveRepresentativeFamilyIds:
      c2Filter?.summary?.c2EffectiveRepresentativeFamilyIds ?? [],
    c2EffectiveSource: c2Filter?.summary?.c2EffectiveSource ?? null,
    c2FallbackUsed: c2Filter?.summary?.c2FallbackUsed === true,
    c2SimilarityPolicy: c2DedupIndexPack?.cfg?.similarityPolicyVersion ?? null,
    c2RepresentativePolicy: c2DedupIndexPack?.cfg?.representativePolicy ?? null,
    previousRunEAssistWeight: Number(adaptiveFrontierPack?.cfg?.previousRunEAssistWeight ?? 0) || 0,
    previousRunEAssistThreshold: Number(adaptiveFrontierPack?.cfg?.previousRunEThreshold ?? 0) || 0,
    salvagePoolPath: adaptiveFrontierPack?.salvagePoolPath ?? null,
    salvageBoostCount: Number(adaptiveFrontierSelected?.summary?.salvageBoostPatternCount ?? 0) || 0,
    salvagePenaltyCount: Number(adaptiveFrontierSelected?.summary?.salvagePenaltyPatternCount ?? 0) || 0,
    quarantinePoolPath: adaptiveFrontierPack?.quarantinePoolPath ?? null,
    quarantineCount: Number(adaptiveFrontierSelected?.summary?.quarantinePatternCount ?? 0) || 0
  })
  await writeJson(indexManifestPath, indexManifest)
  await writeJson(shapingStatePath, shapingStateManifest)

  return {
    step: "C",
    libraryPath,
    runtimePath,
    indexManifestPath,
    shapingStatePath,
    summaryPath,
    summary
  }
}
