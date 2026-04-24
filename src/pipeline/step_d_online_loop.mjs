import path from "node:path"
import os from "node:os"
import { createHash } from "node:crypto"
import { appendFile, copyFile, link, stat, symlink, unlink } from "node:fs/promises"

import { resolveGlobalWindow, resolveLocalWindow } from "../lib/config.mjs"
import { isInRange, uniqueSortedDateKeys } from "../lib/date.mjs"
import {
  buildCandleSeriesMap,
  buildSymbolMasterMap,
  buildUniverseMap,
  loadStepDEData
} from "../lib/data.mjs"
import { buildDecisionCandidateIndex } from "../lib/candidate_index.mjs"
import {
  buildSeriesFeatureRuntimeCache,
  extractGlobalContextFeaturesFromCache,
  extractSnapshotFeaturesFromCache,
  makeSequenceFromCache
} from "../lib/features.mjs"
import {
  GROUPS,
  buildScoreOptions,
  buildScorerContext,
  quantile,
  scoreCandidateExactV2,
  scoreCandidateExactV3,
  updateWeightsOnline
} from "../lib/similarity.mjs"
import { createScoreWorkerPool } from "../lib/score_worker_pool.mjs"
import {
  applyExecutionPriorAdjust,
  applyPostScoreAdjust,
  buildPrototypeQualityLookup,
  resolveDecisionGate,
  resolvePostScoreAdjust
} from "../lib/decision_policy.mjs"
import {
  resolveExecutionGate,
  resolveExecutionGateRuntime
} from "../lib/execution_gate.mjs"
import {
  resolveFalsePositiveGate
} from "../lib/false_positive_gate.mjs"
import {
  buildFalsePositiveDatasetRow,
  createEmptyFalsePositiveModel,
  resolveFalsePositiveModelConfig,
  resolveFalsePositiveTrainingLabel,
  shouldUseFalsePositiveLearningRow,
  trainFalsePositiveModelFromDataset,
  updateFalsePositiveModelOnline
} from "../lib/false_positive_model.mjs"
import {
  buildAgreementDatasetRow,
  createEmptyAgreementGateModel,
  resolveAgreementModelConfig,
  trainAgreementGateModelFromDataset,
  updateAgreementGateModelOnline
} from "../lib/agreement_gate.mjs"
import {
  applyDayTypePolicyToGateCfg,
  classifyDayType,
  resolveDayTypeRouter,
  resolveDayTypeThresholds
} from "../lib/day_type_policy.mjs"
import {
  toD1RankedCandidatesRow,
  toD2ExecutionAuditRow
} from "../lib/decision_audit.mjs"
import {
  applyLearnedDayTypeOverride,
  DAY_TYPE_MODEL_LABELS,
  buildDayTypeDatasetRow,
  createEmptyDayTypeModel,
  resolveDayTypeModelConfig,
  scoreDayTypeModel,
  trainDayTypeModelFromDataset,
  updateDayTypeModelOnline
} from "../lib/day_type_model.mjs"
import {
  resolveOpportunityBudget
} from "../lib/opportunity_budget.mjs"
import {
  resolveCalibrationConfig
} from "../lib/calibration.mjs"
import {
  resolveMetaSelectorConfig
} from "../lib/meta_selector.mjs"
import {
  evaluateRegimeExpert,
  resolveRegimeExpertsConfig
} from "../lib/regime_experts.mjs"
import {
  estimateOrderExecutionProfile,
  resolveOrderSimulatorConfig
} from "../lib/order_simulator.mjs"
import {
  makeDecisionSeedKey,
  readFeaturePackLookup,
  toFeaturePackRow
} from "../lib/runtime_pack.mjs"
import {
  resolveEntryRule,
  simulateTradeFromDecision,
  resolveTradeExit
} from "../lib/trade_rules.mjs"
import {
  resolveRegimeTag as resolveRegimeTagShared,
  resolveRouteBucket as resolveRouteBucketShared,
  runD1Top1Ranker as runD1Top1RankerShared,
  runD2ExecutionScorer as runD2ExecutionScorerShared
} from "../lib/step_policy_chain.mjs"
import {
  calcJumpWindowMeta,
  resolveHighJumpMode
} from "../lib/jump_window.mjs"
import { hashFileSha1 } from "../lib/champion_bundle.mjs"
import {
  buildStepDPolicyBundle,
  writeStepDPolicyBundle
} from "./step_d_policy_bundle.mjs"
import {
  createJsonlWriter,
  ensureDir,
  pathExists,
  readJson,
  readJsonl,
  writeJson,
  writeJsonl
} from "../lib/io.mjs"
import {
  loadPerfectPrototypeCatalog,
  matchPerfectPrototypeCatalog
} from "../lib/perfect_prototype_catalog.mjs"
import {
  annotatePerfectPrototypeMatch,
  dedupePerfectPrototypeCandidates
} from "../lib/perfect_prototype_dedupe.mjs"
import {
  buildPerfectPrototypeEventFeatureVec,
  buildPerfectPrototypeEventMetaFromSeries
} from "../lib/perfect_prototype_event_features.mjs"
import {
  PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
  enrichPerfectPrototypeRowsWithContext,
} from "../lib/perfect_prototype_contextual_features.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const clamp01 = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

const clampRange = (value, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  if (n <= min) return min
  if (n >= max) return max
  return n
}

const isPerfectPrototypeGateActive = (cfg) => {
  const mode = String(cfg?.mode ?? "off").trim().toLowerCase()
  return cfg?.enabled === true || mode === "annotate" || mode === "hard"
}

const createPerfectPrototypeGateStats = (cfg) => ({
  enabled: isPerfectPrototypeGateActive(cfg),
  mode: String(cfg?.mode ?? "off").trim().toLowerCase() || "off",
  selectionMode:
    String(cfg?.selectionMode ?? "champion_only").trim().toLowerCase() === "union_all"
      ? "union_all"
      : "champion_only",
  catalogPath: cfg?.catalogPath ?? null,
  expectedCatalogSha256: String(cfg?.expectedCatalogSha256 ?? "").trim() || null,
  expectedRuleIdsSha256: String(cfg?.expectedRuleIdsSha256 ?? "").trim() || null,
  loadedCatalogSha256: null,
  loadedRuleIdsSha256: null,
  online: {
    days: 0,
    evaluatedRows: 0,
    matchedRows: 0,
    filteredRows: 0,
    dedupedRows: 0
  },
  lockbox: {
    days: 0,
    evaluatedRows: 0,
    matchedRows: 0,
    filteredRows: 0,
    dedupedRows: 0
  }
})

const applyPerfectPrototypeGateToRows = ({
  rows,
  catalog,
  gateCfg,
  partition = "online"
}) => {
  const active = isPerfectPrototypeGateActive(gateCfg)
  const safeRows = Array.isArray(rows) ? rows : []
  if (!active || !catalog) {
    return {
      rows: safeRows,
      telemetry: {
        partition,
        days: safeRows.length > 0 ? 1 : 0,
        evaluatedRows: safeRows.length,
        matchedRows: 0,
        filteredRows: 0,
        dedupedRows: 0
      }
    }
  }
  const mode = String(gateCfg?.mode ?? "off").trim().toLowerCase()
  const selectionMode =
    String(gateCfg?.selectionMode ?? "champion_only").trim().toLowerCase() === "union_all"
      ? "union_all"
      : "champion_only"
  const maxRulesPerSymbol = Math.max(1, Math.floor(Number(gateCfg?.maxRulesPerSymbol ?? 8) || 8))
  const annotatedRows = []
  let matchedRows = 0
  let filteredRows = 0
  for (const row of safeRows) {
    const matchSource = row?.packRow ?? row?.packed ?? row
    const matched = matchPerfectPrototypeCatalog({
      row: matchSource,
      catalog,
      selectionMode
    })
    const annotated = annotatePerfectPrototypeMatch({
      row: {
        ...(row && typeof row === "object" ? row : {}),
        decisionDateKey:
          String(row?.decisionDateKey ?? row?.packRow?.decisionDateKey ?? row?.packed?.decisionDateKey ?? "")
            .trim() || null,
        symbol:
          String(row?.symbol ?? row?.packRow?.symbol ?? row?.packed?.symbol ?? "")
            .trim() || null
      },
      matchedRuleIds: matched.matchedRuleIds,
      primaryRuleId: matched.primaryRuleId,
      maxRulesPerSymbol
    })
    if (annotated.matchedPerfectPrototypeCount > 0) {
      matchedRows += 1
    } else if (mode === "hard") {
      filteredRows += 1
    }
    if (mode !== "hard" || annotated.matchedPerfectPrototypeCount > 0) {
      annotatedRows.push(annotated)
    }
  }
  const dedupedRows = dedupePerfectPrototypeCandidates(annotatedRows, {
    dedupeSymbolsPerDay: gateCfg?.dedupeSymbolsPerDay !== false
  })
  return {
    rows: dedupedRows,
    telemetry: {
      partition,
      days: safeRows.length > 0 ? 1 : 0,
      evaluatedRows: safeRows.length,
      matchedRows,
      filteredRows,
      dedupedRows: Math.max(0, annotatedRows.length - dedupedRows.length)
    }
  }
}

const summarizeC0FamilySelection = ({
  auditRows,
  prototypeQualityLookup,
  selectedFamilyIds = [],
  representativeFamilyIds = []
}) => {
  const rows = Array.isArray(auditRows) ? auditRows : []
  const lookup = prototypeQualityLookup instanceof Map ? prototypeQualityLookup : new Map()
  const selectedFamilyIdSet = new Set(
    (Array.isArray(selectedFamilyIds) ? selectedFamilyIds : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )
  const representativeFamilyIdSet = new Set(
    (Array.isArray(representativeFamilyIds) ? representativeFamilyIds : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )
  const topCounts = new Map()
  const topScores = new Map()
  const selectedCounts = new Map()
  let selectedWithFamily = 0
  let selectedWithinC1Families = 0
  let selectedWithinC2Families = 0
  let topMatchedC2RepresentativeFamilyId = null
  for (const row of rows) {
    const selected = Array.isArray(row?.selectedCandidates)
      ? row.selectedCandidates
      : Array.isArray(row?.pickedList)
        ? row.pickedList
        : []
    const first = selected[0] ?? null
    const firstQuality =
      first?.matchedPrototypeId ? lookup.get(String(first.matchedPrototypeId).trim()) ?? null : null
    const firstFamilyId = String(firstQuality?.c0FamilyId ?? "").trim()
    if (firstFamilyId) {
      topCounts.set(firstFamilyId, Number(topCounts.get(firstFamilyId) ?? 0) + 1)
      const list = topScores.get(firstFamilyId) ?? []
      list.push(Number(firstQuality?.c0Score ?? 0) || 0)
      topScores.set(firstFamilyId, list)
      if (!topMatchedC2RepresentativeFamilyId && representativeFamilyIdSet.has(firstFamilyId)) {
        topMatchedC2RepresentativeFamilyId = firstFamilyId
      }
    }
    for (const candidate of selected) {
      const quality =
        candidate?.matchedPrototypeId
          ? lookup.get(String(candidate.matchedPrototypeId).trim()) ?? null
          : null
      const familyId = String(quality?.c0FamilyId ?? "").trim()
      if (!familyId) continue
      selectedCounts.set(familyId, Number(selectedCounts.get(familyId) ?? 0) + 1)
      selectedWithFamily += 1
      if (selectedFamilyIdSet.has(familyId)) {
        selectedWithinC1Families += 1
      }
      if (representativeFamilyIdSet.has(familyId)) {
        selectedWithinC2Families += 1
      }
    }
  }
  const topEntry = Array.from(topCounts.entries()).sort((left, right) => Number(right[1]) - Number(left[1]))[0] ?? null
  const selectedEntry = Array.from(selectedCounts.entries()).sort((left, right) => Number(right[1]) - Number(left[1]))[0] ?? null
  const topScoreList = topScores.get(topEntry?.[0]) ?? []
  const topMatchedC0Score =
    topScoreList.length > 0
      ? topScoreList.reduce((acc, value) => acc + (Number(value) || 0), 0) / topScoreList.length
      : 0
  return {
    topMatchedC0FamilyId: topEntry?.[0] ?? null,
    topMatchedC0Score,
    selectedC0FamilyShare:
      selectedWithFamily > 0 ? Number(selectedEntry?.[1] ?? 0) / selectedWithFamily : 0,
    selectedC0MatchedCount: selectedWithFamily,
    selectedC1FamilyShare:
      selectedWithFamily > 0 ? selectedWithinC1Families / selectedWithFamily : 0,
    selectedC2FamilyShare:
      selectedWithFamily > 0 ? selectedWithinC2Families / selectedWithFamily : 0,
    topMatchedC2RepresentativeFamilyId
  }
}

const hashStablePayload = (value) =>
  createHash("sha1").update(JSON.stringify(value ?? null)).digest("hex")

const VALIDATED_TRADE_REPLAY_SEED_SCHEMA_VERSION = "v2"
const VALIDATED_TRADE_REPLAY_SEED_BUILDER_VERSION = "v2"
const FALSE_POSITIVE_MODEL_VERSION = createEmptyFalsePositiveModel().version
const AGREEMENT_MODEL_VERSION = createEmptyAgreementGateModel().version
const DAY_TYPE_MODEL_VERSION = createEmptyDayTypeModel().version

const clampSigned = (value) => clampRange(value, -1, 1)

const hasBinaryLabel = (value) =>
  value === 0 || value === 1 || value === "0" || value === "1"

const WILSON_Z_95 = 1.959963984540054

const wilsonLowerBound = ({ success, total, z = WILSON_Z_95 }) => {
  const n = Math.max(0, Number(total ?? 0) || 0)
  const k = Math.max(0, Number(success ?? 0) || 0)
  if (n <= 0) return 0
  const p = Math.min(1, Math.max(0, k / n))
  const z2 = z ** 2
  const center = p + z2 / (2 * n)
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)
  const denom = 1 + z2 / n
  if (!Number.isFinite(denom) || denom <= 0) return 0
  const lb = (center - spread) / denom
  if (!Number.isFinite(lb)) return 0
  return clamp01(lb)
}

const resolveAsOfShift = (raw) => {
  const text = String(raw ?? "t-1").trim().toLowerCase()
  if (text === "t") return 0
  const match = text.match(/^t-(\d+)$/)
  if (match) {
    const n = Number(match[1])
    if (Number.isInteger(n) && n >= 0) return n
  }
  return 1
}

const resolveRegimeRouterConfig = (raw) => {
  const cfg = raw ?? {}
  const bucketMap = {}
  for (const [fromTag, toBucket] of Object.entries(cfg?.bucketMap ?? {})) {
    const from = String(fromTag ?? "").trim()
    const to = String(toBucket ?? "").trim()
    if (!from || !to) continue
    bucketMap[from] = to
  }
  const weightsByBucket = {}
  for (const [bucket, filePath] of Object.entries(cfg?.weightsByBucket ?? {})) {
    const key = String(bucket ?? "").trim()
    const p = String(filePath ?? "").trim()
    if (!key || !p) continue
    weightsByBucket[key] = p
  }
  return {
    enabled: cfg?.enabled === true,
    defaultBucket: String(cfg?.defaultBucket ?? "__DEFAULT__").trim() || "__DEFAULT__",
    bucketMap,
    weightsByBucket,
    strictWeightLoad: cfg?.strictWeightLoad === true,
    routingMode: String(cfg?.routingMode ?? "vol3").trim().toLowerCase() === "none" ? "none" : "vol3"
  }
}

const resolvePromotionScope = (raw) => {
  const text = String(raw ?? "").trim().toLowerCase()
  if (text === "eval") return "eval"
  if (text === "tune") return "tune"
  return "update"
}

const resolveChampionCommonStatePathFromConfig = (ctx) => {
  const raw = ctx?.config?.pattern?.championCommonStatePath
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(ctx?.cwd ?? process.cwd(), trimmed)
}

const resolveUpdateOnlyCommonStateStatsPath = (ctx) => {
  const explicit =
    ctx?.config?.pattern?.commonState?.updateOnlyStatsPath ??
    ctx?.config?.pattern?.commonState?.updateStatsPath
  if (typeof explicit === "string" && explicit.trim()) {
    const trimmed = explicit.trim()
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(ctx?.cwd ?? process.cwd(), trimmed)
  }
  const championPath = resolveChampionCommonStatePathFromConfig(ctx)
  if (!championPath) return null
  return path.join(path.dirname(championPath), "update_only_stats.json")
}

const buildValidatedTradeOutcomeKey = ({ decisionDateKey, symbol }) => {
  const dateKey = String(decisionDateKey ?? "").trim()
  const symbolKey = String(symbol ?? "").trim().toUpperCase()
  if (!dateKey || !symbolKey) return null
  return `${dateKey}::${symbolKey}`
}

const DAY_TYPE_LABEL_SET = new Set(DAY_TYPE_MODEL_LABELS)

const normalizeReplayDayTypeLabel = (value, fallback = "BALANCED") => {
  const label = String(value ?? "").trim().toUpperCase()
  if (DAY_TYPE_LABEL_SET.has(label)) return label
  const fallbackLabel = String(fallback ?? "").trim().toUpperCase()
  return DAY_TYPE_LABEL_SET.has(fallbackLabel) ? fallbackLabel : "BALANCED"
}

const resolveLatestValidatedTradeOutcomePaths = (ctx) => {
  const checkpointDir = path.join(
    ctx?.cwd ?? process.cwd(),
    "artifacts",
    "autopilot",
    "checkpoint_latest",
  )
  return {
    cumulativeReplayIndexPath: path.join(checkpointDir, "lockbox_replay_confirm_index.json"),
    cumulativeReplayPath: path.join(checkpointDir, "lockbox_replay_confirm_cumulative.jsonl"),
    replayPath: path.join(checkpointDir, "lockbox_replay_confirm_latest.jsonl"),
    tradesPath: path.join(checkpointDir, "lockbox_trades_confirm_latest.jsonl")
  }
}

const normalizeValidatedTradeOutcomeCandidateRole = (row) => {
  const explicit = String(row?.candidateRole ?? "").trim().toUpperCase()
  if (explicit) return explicit
  if (row?.executedByPolicy === true) return "EXECUTED"
  if (row?.selectedByPolicy === true) return "PICK"
  if (row?.top1Candidate === true) return "TOP1"
  return "UNKNOWN"
}

const buildValidatedTradeOutcomeSemanticKey = (row) => {
  const decisionDateKey = String(row?.decisionDateKey ?? "").trim()
  const symbol = String(row?.symbol ?? "").trim().toUpperCase()
  const candidateRole = normalizeValidatedTradeOutcomeCandidateRole(row)
  if (decisionDateKey && symbol) {
    return `${decisionDateKey}::${candidateRole}::${symbol}`
  }
  return `RAW::${createHash("sha1").update(JSON.stringify(row ?? null)).digest("hex")}`
}

const normalizeValidatedTradeOutcomeStoredRow = (row) => ({
  ...(row && typeof row === "object" ? row : {}),
  decisionDateKey: String(row?.decisionDateKey ?? "").trim(),
  symbol: String(row?.symbol ?? "").trim().toUpperCase(),
  candidateRole: normalizeValidatedTradeOutcomeCandidateRole(row)
})

const buildTop1PathTrace = ({ d1, d2, fallbackGateReason = "UNKNOWN" }) => {
  const orderingTrace = d1?.orderingTrace && typeof d1.orderingTrace === "object"
    ? d1.orderingTrace
    : {}
  const gateInputTop1 =
    orderingTrace?.gateInputTop1 && typeof orderingTrace.gateInputTop1 === "object"
      ? orderingTrace.gateInputTop1
      : (d1?.top?.[0] ?? null)
  const finalSelectedTop1 =
    orderingTrace?.finalSelectedTop1 && typeof orderingTrace.finalSelectedTop1 === "object"
      ? orderingTrace.finalSelectedTop1
      : (d1?.picks?.[0] ?? null)
  const selectedCandidates = Array.isArray(d2?.selectedCandidates)
    ? d2.selectedCandidates
    : Array.isArray(d2?.falsePositiveFeedbackRows)
      ? d2.falsePositiveFeedbackRows
      : []
  const executedPick = d2?.executedPick ?? null
  const gateInputTop1Symbol = String(gateInputTop1?.symbol ?? "").trim() || null
  const finalSelectedTop1Symbol = String(finalSelectedTop1?.symbol ?? "").trim() || null
  const finalExecutedTop1Symbol = String(executedPick?.symbol ?? "").trim() || null
  const selectedCandidate =
    finalSelectedTop1Symbol == null
      ? null
      : (selectedCandidates.find(
          (row) => String(row?.symbol ?? "").trim() === finalSelectedTop1Symbol,
        ) ?? null)
  const gateInputTop1Blocked =
    gateInputTop1Symbol != null && gateInputTop1Symbol !== finalExecutedTop1Symbol
  const blockedTop1BeforeExecution =
    gateInputTop1Symbol != null && gateInputTop1Symbol !== finalSelectedTop1Symbol
  const blockedTop1AfterExecution =
    gateInputTop1Symbol != null &&
    gateInputTop1Symbol === finalSelectedTop1Symbol &&
    gateInputTop1Symbol !== finalExecutedTop1Symbol
  let blockedTop1Reason = null
  if (gateInputTop1Blocked) {
    if (blockedTop1BeforeExecution) {
      blockedTop1Reason =
        orderingTrace?.finalSelectionReason ??
        String(d1?.gate?.gateReason ?? fallbackGateReason ?? "NOT_SELECTED")
    } else {
      blockedTop1Reason =
        executedPick?.executionShadowReason ??
        selectedCandidate?.executionShadowReason ??
        selectedCandidate?.falsePositiveReason ??
        selectedCandidate?.falsePositiveDecision ??
        selectedCandidate?.budgetReason ??
        selectedCandidate?.budgetDecision ??
        finalSelectedTop1?.executionShadowReason ??
        finalSelectedTop1?.executionDecision ??
        String(d1?.gate?.gateReason ?? fallbackGateReason ?? "NOT_EXECUTED")
    }
  }
  return {
    gateInputTop1Symbol,
    finalSelectedTop1Symbol,
    finalExecutedTop1Symbol,
    gateInputTop1Blocked,
    blockedTop1BeforeExecution,
    blockedTop1AfterExecution,
    blockedTop1WasHit:
      gateInputTop1Blocked &&
      (gateInputTop1?.successInWindow === true || d1?.top?.[0]?.successInWindow === true),
    blockedTop1Reason,
    selectedTop1Executed:
      finalSelectedTop1Symbol != null && finalSelectedTop1Symbol === finalExecutedTop1Symbol,
    selectedTop1ExecutionDecision:
      selectedCandidate?.executionDecision ??
      finalSelectedTop1?.executionDecision ??
      executedPick?.executionDecision ??
      null,
    selectedTop1ExecutionShadowReason:
      selectedCandidate?.executionShadowReason ??
      selectedCandidate?.falsePositiveReason ??
      selectedCandidate?.falsePositiveDecision ??
      selectedCandidate?.budgetReason ??
      selectedCandidate?.budgetDecision ??
      finalSelectedTop1?.executionShadowReason ??
      executedPick?.executionShadowReason ??
      null,
    agreementFallbackApplied: orderingTrace?.agreementFallbackApplied === true,
    agreementFallbackReason: orderingTrace?.agreementFallbackReason ?? null,
    agreementFallbackChosenRank: Number.isFinite(Number(orderingTrace?.agreementFallbackChosenRank))
      ? Number(orderingTrace.agreementFallbackChosenRank)
      : null,
    agreementFallbackBlockedRank: Number.isFinite(Number(orderingTrace?.agreementFallbackBlockedRank))
      ? Number(orderingTrace.agreementFallbackBlockedRank)
      : null,
    agreementFallbackBlockedSymbol:
      String(orderingTrace?.agreementFallbackBlockedSymbol ?? "").trim() || null,
    agreementFallbackSelectionChanged: orderingTrace?.agreementFallbackSelectionChanged === true,
    agreementShadowRejectBlocked: orderingTrace?.agreementShadowRejectBlocked === true,
    agreementShadowRejectReason: orderingTrace?.agreementShadowRejectReason ?? null,
    agreementShadowRejectAgreementReason:
      orderingTrace?.agreementShadowRejectAgreementReason ?? null,
    agreementShadowRejectSelectionMode:
      orderingTrace?.agreementShadowRejectSelectionMode ?? null
  }
}

const writeValidatedTradeOutcomeArtifacts = async (paths, rawRows) => {
  const normalizedByKey = new Map()
  for (const rawRow of rawRows) {
    const normalizedRow = normalizeValidatedTradeOutcomeStoredRow(rawRow)
    const semanticKey = buildValidatedTradeOutcomeSemanticKey(normalizedRow)
    normalizedByKey.set(semanticKey, normalizedRow)
  }
  const normalizedRows = Array.from(normalizedByKey.values())
  await ensureDir(path.dirname(paths.cumulativeReplayPath))
  await writeJsonl(paths.cumulativeReplayPath, normalizedRows)
  await writeJson(paths.cumulativeReplayIndexPath, {
    generatedAt: new Date().toISOString(),
    rowCount: normalizedRows.length,
    rows: normalizedRows
  })
  return normalizedRows
}

const resolveValidatedTradeReplaySeedPaths = (ctx) => {
  const checkpointDir = path.join(
    ctx?.cwd ?? process.cwd(),
    "artifacts",
    "autopilot",
    "checkpoint_latest",
  )
  return {
    falsePositivePath: path.join(checkpointDir, "lockbox_replay_fp_seed.json"),
    agreementPath: path.join(checkpointDir, "lockbox_replay_agreement_seed.json"),
    dayTypePath: path.join(checkpointDir, "lockbox_replay_day_type_seed.json"),
    bundlePath: path.join(checkpointDir, "lockbox_replay_seed_bundle.json"),
    metaPath: path.join(checkpointDir, "lockbox_replay_seed_meta.json")
  }
}

const buildValidatedTradeReplaySeedConfigFingerprint = (ctx) =>
  hashStablePayload({
    falsePositiveModel:
      ctx?.config?.decisionGate?.falsePositiveGate?.model ??
      ctx?.config?.falsePositiveGate?.model ??
      null,
    agreementModel:
      ctx?.config?.decisionGate?.agreementGate?.model ??
      ctx?.config?.agreementGate?.model ??
      null,
    dayTypeModel:
      ctx?.config?.decisionGate?.dayTypeRouter?.model ??
      ctx?.config?.dayTypeRouter?.model ??
      null,
    lightweightStepD: {
      prepareLockboxDuringStepD: ctx?.config?.lightweight?.stepD?.prepareLockboxDuringStepD,
      persistOnlineFeaturePackRows: ctx?.config?.lightweight?.stepD?.persistOnlineFeaturePackRows,
      keepWorkerPoolAlive: ctx?.config?.lightweight?.stepD?.keepWorkerPoolAlive
    }
  })

const buildValidatedTradeReplaySeedMeta = ({ ctx, sourceFingerprint, rows = null }) => {
  const seedSchemaVersion = VALIDATED_TRADE_REPLAY_SEED_SCHEMA_VERSION
  const builderVersion = VALIDATED_TRADE_REPLAY_SEED_BUILDER_VERSION
  const modelVersions = {
    falsePositive: FALSE_POSITIVE_MODEL_VERSION,
    agreement: AGREEMENT_MODEL_VERSION,
    dayType: DAY_TYPE_MODEL_VERSION
  }
  const configFingerprint = buildValidatedTradeReplaySeedConfigFingerprint(ctx)
  const cacheKey = hashStablePayload({
    source: sourceFingerprint,
    seedSchemaVersion,
    builderVersion,
    modelVersions,
    configFingerprint
  })
  return {
    generatedAt: new Date().toISOString(),
    source: sourceFingerprint,
    seedSchemaVersion,
    builderVersion,
    modelVersions,
    configFingerprint,
    cacheKey,
    rows
  }
}

const isValidatedTradeReplaySeedMetaUsable = ({ cacheMeta, expectedMeta }) => {
  if (!cacheMeta || typeof cacheMeta !== "object") return false
  if (!expectedMeta || typeof expectedMeta !== "object") return false
  return String(cacheMeta?.cacheKey ?? "").trim() === String(expectedMeta?.cacheKey ?? "").trim()
}

const ensureLatestValidatedTradeOutcomeArtifacts = async (ctx) => {
  const paths = resolveLatestValidatedTradeOutcomePaths(ctx)
  const hasIndex = pathExists(paths.cumulativeReplayIndexPath)
  const hasCumulative = pathExists(paths.cumulativeReplayPath)
  const hasLatestReplay = pathExists(paths.replayPath)
  const hasLatestTrades = pathExists(paths.tradesPath)
  if (hasIndex) {
    return {
      available: true,
      sourcePath: paths.cumulativeReplayIndexPath,
      repaired: false,
      repairedFrom: []
    }
  }
  if (!hasCumulative && !hasLatestReplay && !hasLatestTrades) {
    return {
      available: false,
      sourcePath: paths.cumulativeReplayIndexPath,
      repaired: false,
      repairedFrom: []
    }
  }
  throw new Error(
    `Validated replay artifacts are not canonicalized: missing ${paths.cumulativeReplayIndexPath} while replay sources exist`,
  )
}

const resolveValidatedTradeReplayPriority = (row) => {
  const role = normalizeValidatedTradeOutcomeCandidateRole(row)
  if (role === "EXECUTED" || row?.executedByPolicy === true) return 30
  if (role === "PICK" || row?.selectedByPolicy === true) return 20
  if (role === "TOP1" || row?.top1Candidate === true) return 10
  return 0
}

const loadLatestValidatedTradeOutcomeLookup = async (ctx) => {
  const artifactState = await ensureLatestValidatedTradeOutcomeArtifacts(ctx)
  const sourcePath = artifactState.sourcePath
  const sourceFingerprint = artifactState.available === true
    ? await buildFileFingerprint(sourcePath)
    : null
  const runtimeCacheKey = sourceFingerprint ? hashStablePayload(sourceFingerprint) : ""
  const runtimeCache =
    runtimeCacheKey && ctx?.__runtime?.validatedTradeOutcomeLookupCache?.cacheKey === runtimeCacheKey
      ? ctx.__runtime.validatedTradeOutcomeLookupCache.value
      : null
  if (runtimeCache) {
    return runtimeCache
  }
  if (!artifactState.available || !pathExists(sourcePath)) {
    const empty = {
      sourcePath,
      sourceFingerprint,
      available: false,
      rowCount: 0,
      rows: [],
      lookup: new Map(),
      repaired: artifactState.repaired === true,
      repairedFrom: artifactState.repairedFrom ?? []
    }
    if (runtimeCacheKey) {
      ctx.__runtime = ctx.__runtime ?? {}
      ctx.__runtime.validatedTradeOutcomeLookupCache = {
        cacheKey: runtimeCacheKey,
        value: empty
      }
    }
    return empty
  }
  const loaded = await readJson(sourcePath, null)
  const rows = Array.isArray(loaded?.rows) ? loaded.rows : []
  const lookup = new Map()
    const normalizedRows = []
  for (const row of rows) {
    const key = buildValidatedTradeOutcomeKey({
      decisionDateKey: row?.decisionDateKey,
      symbol: row?.symbol
    })
    if (!key) continue
    const netRet = Number(row?.netRet)
    const available = Number.isFinite(netRet)
    const normalizedRow = {
      ...(row && typeof row === "object" ? row : {}),
      decisionDateKey: String(row?.decisionDateKey ?? "").trim(),
      symbol: String(row?.symbol ?? "").trim().toUpperCase(),
      labelSource: "LIVE_LOCKBOX_FAILURE_JOIN"
    }
    normalizedRows.push(normalizedRow)
    const candidate = {
      available,
      liveLockboxFailure:
        available
          ? !(row?.hitTarget === true || String(row?.exitReason ?? "").trim().toUpperCase() === "TARGET")
          : null,
      shouldHaveTraded:
        available
          ? (row?.hitTarget === true || String(row?.exitReason ?? "").trim().toUpperCase() === "TARGET")
          : null,
      realizedNetRet: available ? netRet : null,
      realizedExitReason: row?.exitReason ? String(row.exitReason) : null,
      realizedHitTarget: row?.hitTarget === true,
      realizedHitStop: row?.hitStop === true,
      labelSource: "LIVE_LOCKBOX_FAILURE_JOIN",
      candidateRole: normalizedRow?.candidateRole ?? null,
      selectedByPolicy: normalizedRow?.selectedByPolicy === true,
      executedByPolicy: normalizedRow?.executedByPolicy === true,
      top1Candidate: normalizedRow?.top1Candidate === true,
      _priority: resolveValidatedTradeReplayPriority(normalizedRow)
    }
    const prev = lookup.get(key)
    if (!prev || Number(candidate._priority ?? 0) >= Number(prev?._priority ?? -1)) {
      lookup.set(key, candidate)
    }
  }
  const value = {
    sourcePath,
    sourceFingerprint,
    available: true,
    rowCount: normalizedRows.length,
    rows: normalizedRows,
    lookup,
    repaired: artifactState.repaired === true,
    repairedFrom: artifactState.repairedFrom ?? []
  }
  if (runtimeCacheKey) {
    ctx.__runtime = ctx.__runtime ?? {}
    ctx.__runtime.validatedTradeOutcomeLookupCache = {
      cacheKey: runtimeCacheKey,
      value
    }
  }
  return value
}

const buildValidatedTradeReplayFeedbackDaysCached = ({
  ctx,
  latestValidatedTradeOutcomes
}) => {
  const sourceFingerprint = latestValidatedTradeOutcomes?.sourceFingerprint ?? null
  const cacheKey = sourceFingerprint ? hashStablePayload(sourceFingerprint) : ""
  const cached =
    cacheKey && ctx?.__runtime?.validatedTradeReplayFeedbackDaysCache?.cacheKey === cacheKey
      ? ctx.__runtime.validatedTradeReplayFeedbackDaysCache.value
      : null
  if (cached) return cached
  const built = buildValidatedTradeReplayFeedbackDays({
    validatedTradeRows: latestValidatedTradeOutcomes?.rows
  })
  if (cacheKey) {
    ctx.__runtime = ctx.__runtime ?? {}
    ctx.__runtime.validatedTradeReplayFeedbackDaysCache = {
      cacheKey,
      value: built
    }
  }
  return built
}

const buildEmpiricalReplayDayTypeTarget = (tradeRow) => {
  const scoreByLabel = Object.fromEntries(
    DAY_TYPE_MODEL_LABELS.map((label) => [label, -0.15]),
  )
  const actualLabel = normalizeReplayDayTypeLabel(
    tradeRow?.dayType ?? tradeRow?.ruleDayType,
    "BALANCED",
  )
  const ruleLabel = normalizeReplayDayTypeLabel(
    tradeRow?.ruleDayType ?? actualLabel,
    actualLabel,
  )
  const success =
    tradeRow?.hitTarget === true ||
    String(tradeRow?.exitReason ?? "").trim().toUpperCase() === "TARGET"
  const executed = tradeRow?.executedByPolicy === true
  const selected = tradeRow?.selectedByPolicy === true
  const top1 = tradeRow?.top1Candidate === true
  const blocked = top1 && executed !== true
  const openPositionSkipped = tradeRow?.openPositionSkippedByPolicy === true
  const avgTradingValue20dKrw = Math.max(0, Number(tradeRow?.avgTradingValue20dKrw ?? 0) || 0)
  const slippageRisk = Math.max(0, Number(tradeRow?.slippageRisk ?? 0) || 0)
  const pFill = Math.min(1, Math.max(0, Number(tradeRow?.pFillCalibrated ?? 0) || 0))
  const scoreMargin = Number(
    tradeRow?.gateScoreMargin ??
      tradeRow?.postRerankScoreMargin ??
      tradeRow?.rawScoreMargin ??
      0,
  ) || 0
  const falsePositiveRisk = Math.max(0, Number(tradeRow?.falsePositiveRisk ?? 0) || 0)
  const lowLiquidity = avgTradingValue20dKrw > 0 && avgTradingValue20dKrw < 1_200_000_000
  const executionHostile = slippageRisk >= 0.08 || pFill < 0.75
  const fragile = scoreMargin < 0.002 || falsePositiveRisk >= 0.52

  scoreByLabel[ruleLabel] += 0.15
  scoreByLabel[actualLabel] += 0.25

  if (success) {
    scoreByLabel[actualLabel] += executed ? 2.4 : selected || top1 ? 2.0 : 1.6
    scoreByLabel.BALANCED += 0.25
    scoreByLabel.NO_TRADE -= executed ? 1.6 : 1.1
    if (blocked || openPositionSkipped) {
      scoreByLabel.TREND += 0.55
      scoreByLabel.MEAN_REVERSION += 0.2
      scoreByLabel.NOISE -= 0.2
    }
  } else {
    scoreByLabel.NO_TRADE += executed ? 2.2 : selected || top1 ? 1.7 : 1.3
    scoreByLabel[actualLabel] -= executed ? 0.9 : 0.35
    if (executionHostile) scoreByLabel.EXECUTION_HOSTILE += 1.0
    if (lowLiquidity) scoreByLabel.THIN_LIQUIDITY_TRAP += 1.0
    if (fragile) scoreByLabel.NOISE += 0.75
    if (blocked) scoreByLabel.NO_TRADE += 0.25
  }

  if (openPositionSkipped) {
    scoreByLabel.NO_TRADE += success ? -0.35 : 0.45
  }
  if (tradeRow?.dayTypeNoTrade === true || tradeRow?.ruleDayTypeNoTrade === true) {
    scoreByLabel.NO_TRADE += 0.2
  }

  const ranked = Object.entries(scoreByLabel).sort((a, b) => Number(b[1]) - Number(a[1]))
  const label = normalizeReplayDayTypeLabel(ranked[0]?.[0] ?? "BALANCED", "BALANCED")
  return {
    label,
    source: `EMPIRICAL_LOCKBOX_REPLAY_${label}`,
    scoreByLabel
  }
}

const buildValidatedTradeReplayDatasets = ({
  validatedTradeRows = [],
  agreementModelCfg = null
}) => {
  const falsePositiveRows = []
  const agreementRows = []
  const dayTypeRows = []
  const preferredRowsByTradeKey = new Map()
  const preferredDayTypeRowsByDate = new Map()
  for (const tradeRow of Array.isArray(validatedTradeRows) ? validatedTradeRows : []) {
    const decisionDateKey = String(tradeRow?.decisionDateKey ?? "").trim()
    const symbol = String(tradeRow?.symbol ?? "").trim()
    const netRet = Number(tradeRow?.netRet)
    if (!decisionDateKey || !symbol || !Number.isFinite(netRet)) continue
    const tradeKey = buildValidatedTradeOutcomeKey({ decisionDateKey, symbol })
    const priority = resolveValidatedTradeReplayPriority(tradeRow)
    const prevTradeRow = preferredRowsByTradeKey.get(tradeKey)
    if (!prevTradeRow || priority >= Number(prevTradeRow?.priority ?? -1)) {
      preferredRowsByTradeKey.set(tradeKey, {
        priority,
        row: tradeRow
      })
    }
    const prevDayTypeRow = preferredDayTypeRowsByDate.get(decisionDateKey)
    if (!prevDayTypeRow || priority >= Number(prevDayTypeRow?.priority ?? -1)) {
      preferredDayTypeRowsByDate.set(decisionDateKey, {
        priority,
        row: tradeRow
      })
    }
  }
  for (const entry of preferredRowsByTradeKey.values()) {
    const tradeRow = entry?.row ?? null
    const decisionDateKey = String(tradeRow?.decisionDateKey ?? "").trim()
    const symbol = String(tradeRow?.symbol ?? "").trim()
    const netRet = Number(tradeRow?.netRet)
    if (!decisionDateKey || !symbol || !Number.isFinite(netRet)) continue
    const liveLockboxSuccess = tradeRow?.hitTarget === true || String(tradeRow?.exitReason ?? "").trim().toUpperCase() === "TARGET"
    const liveLockboxFailure = !liveLockboxSuccess
    const trainingLabelFalsePositive = resolveFalsePositiveTrainingLabel({
      liveLockboxFailure,
      realizedExitReason: tradeRow?.exitReason ?? null,
      realizedNetRet: netRet,
      cfg: falsePositiveModelCfg
    })
    const dayTypeDecision = {
      dayType: String(tradeRow?.dayType ?? "BALANCED").trim().toUpperCase() || "BALANCED",
      noTrade: tradeRow?.dayTypeNoTrade === true,
      policySource: tradeRow?.dayTypePolicySource ?? "LOCKBOX_CONFIRMED_REPLAY"
    }
    falsePositiveRows.push(buildFalsePositiveDatasetRow({
      decisionDateKey,
      split: "LOCKBOX_REPLAY",
      row: tradeRow,
      dayTypeDecision,
      cfg: falsePositiveModelCfg,
      labelFalsePositive: trainingLabelFalsePositive,
      labelSource: "LIVE_LOCKBOX_FAILURE_JOIN",
      replayKind: liveLockboxFailure ? "CONFIRM_LOCKBOX_FAILURE" : "CONFIRM_LOCKBOX_SUCCESS",
      sampleWeight: liveLockboxFailure ? 2.2 : 1.4,
      failureMode: liveLockboxFailure
        ? String(tradeRow?.exitReason ?? tradeRow?.falsePositiveReason ?? "LOCKBOX_FAILURE")
        : "LOCKBOX_SUCCESS",
      liveLockboxFailure,
      shouldHaveTraded: liveLockboxSuccess,
      realizedNetRet: netRet,
      realizedExitReason: tradeRow?.exitReason ?? null,
      realizedHitTarget: tradeRow?.hitTarget === true,
      realizedHitStop: tradeRow?.hitStop === true
    }))
    const agreementLearningTarget = resolveAgreementLearningTarget({
      netRet,
      hitTarget: tradeRow?.hitTarget === true,
      hitStop: tradeRow?.hitStop === true,
      sampleWeight: liveLockboxFailure ? 1.9 : 1.2,
      cfg: agreementModelCfg
    })
    agreementRows.push(buildAgreementDatasetRow({
      decisionDateKey,
      split: "LOCKBOX_REPLAY",
      row: tradeRow,
      labelAgreement: agreementLearningTarget?.labelAgreement,
      labelSource: agreementLearningTarget?.labelSource ?? "LIVE_LOCKBOX_FAILURE_JOIN",
      sampleWeight: agreementLearningTarget?.sampleWeight ?? 0
    }))
  }
  for (const [decisionDateKey, entry] of preferredDayTypeRowsByDate.entries()) {
    const tradeRow = entry?.row ?? null
    const netRet = Number(tradeRow?.netRet)
    if (!tradeRow || !Number.isFinite(netRet)) continue
    const empiricalTarget = buildEmpiricalReplayDayTypeTarget(tradeRow)
    dayTypeRows.push(buildDayTypeDatasetRow({
      decisionDateKey,
      split: "LOCKBOX_REPLAY",
      ruleDecision: {
        dayType: tradeRow?.ruleDayType ?? tradeRow?.dayType ?? "BALANCED",
        noTrade: tradeRow?.ruleDayTypeNoTrade === true,
        policySource: tradeRow?.ruleDayTypePolicySource ?? "LOCKBOX_REPLAY_RULE",
        signals: {}
      },
      finalDecision: {
        dayType: tradeRow?.dayType ?? tradeRow?.ruleDayType ?? "BALANCED",
        noTrade: tradeRow?.dayTypeNoTrade === true,
        policySource: tradeRow?.dayTypePolicySource ?? "LOCKBOX_CONFIRMED_REPLAY"
      },
      candidateHit:
        tradeRow?.candidateHit === true ||
        tradeRow?.hitTarget === true ||
        String(tradeRow?.exitReason ?? "").trim().toUpperCase() === "TARGET",
      selectedHit:
        tradeRow?.selectedByPolicy === true &&
        (
          tradeRow?.hitTarget === true ||
          String(tradeRow?.exitReason ?? "").trim().toUpperCase() === "TARGET"
        ),
      executedHit:
        tradeRow?.executedByPolicy === true &&
        (
          tradeRow?.hitTarget === true ||
          String(tradeRow?.exitReason ?? "").trim().toUpperCase() === "TARGET"
        ),
      top1Blocked: tradeRow?.top1Candidate === true && tradeRow?.executedByPolicy !== true,
      executedNetRet: netRet,
      executedOutcomeSource: tradeRow?.labelSource ?? "LIVE_LOCKBOX_FAILURE_JOIN",
      trainingLabelOverride: empiricalTarget?.label ?? null,
      trainingLabelSourceOverride: empiricalTarget?.source ?? null,
      trainingLabelScoresOverride: empiricalTarget?.scoreByLabel ?? null,
      modelFeaturesOverride:
        tradeRow?.dayTypeModelFeatures && typeof tradeRow.dayTypeModelFeatures === "object"
          ? tradeRow.dayTypeModelFeatures
          : null
    }))
  }
  return {
    falsePositiveRows,
    agreementRows,
    dayTypeRows
  }
}

const resolveAgreementLearningTarget = ({
  tradeOutcome = null,
  netRet = null,
  hitTarget = null,
  hitStop = null,
  sampleWeight = 1,
  cfg = null
}) => {
  const safeCfg = resolveAgreementModelConfig(cfg)
  const outcomeMode = String(safeCfg?.outcomeMode ?? "target_stop_priority")
    .trim()
    .toLowerCase()
  const realizedNetRet =
    Number.isFinite(Number(netRet))
      ? Number(netRet)
      : Number.isFinite(Number(tradeOutcome?.realizedNetRet))
        ? Number(tradeOutcome.realizedNetRet)
        : null
  const realizedHitTarget = hitTarget === true || tradeOutcome?.realizedHitTarget === true
  const realizedHitStop = hitStop === true || tradeOutcome?.realizedHitStop === true
  const baseWeight = Math.max(0, Number(sampleWeight ?? 1) || 0)
  if (baseWeight <= 0) {
    return {
      labelAgreement: null,
      sampleWeight: 0,
      labelSource: "OUTCOME_UNAVAILABLE"
    }
  }
  if (outcomeMode !== "target_stop_priority") {
    const positive =
      Number.isFinite(realizedNetRet)
        ? realizedNetRet > 0
        : tradeOutcome?.liveLockboxFailure !== true
    return {
      labelAgreement: positive ? 1 : 0,
      sampleWeight: baseWeight,
      labelSource: "LOCKBOX_STYLE_REALIZED_OUTCOME"
    }
  }
  if (realizedHitTarget === true) {
    return {
      labelAgreement: 1,
      sampleWeight:
        baseWeight * Math.max(0, Number(safeCfg?.targetHitWeight ?? 1.8) || 1.8),
      labelSource: "TARGET_STOP_PRIORITY_TARGET_HIT"
    }
  }
  if (realizedHitStop === true) {
    return {
      labelAgreement: 0,
      sampleWeight:
        baseWeight * Math.max(0, Number(safeCfg?.stopHitWeight ?? 2.1) || 2.1),
      labelSource: "TARGET_STOP_PRIORITY_STOP_HIT"
    }
  }
  if (!Number.isFinite(realizedNetRet)) {
    return {
      labelAgreement: null,
      sampleWeight: 0,
      labelSource: "OUTCOME_UNAVAILABLE"
    }
  }
  const deadband = Math.max(0, Number(safeCfg?.timeoutNetRetDeadband ?? 0.002) || 0)
  if (Math.abs(realizedNetRet) <= deadband) {
    return {
      labelAgreement: null,
      sampleWeight: 0,
      labelSource: "TARGET_STOP_PRIORITY_TIMEOUT_DEADBAND"
    }
  }
  if (realizedNetRet > 0) {
    return {
      labelAgreement: 1,
      sampleWeight:
        baseWeight * Math.max(0, Number(safeCfg?.timeoutPositiveWeight ?? 0.45) || 0.45),
      labelSource: "TARGET_STOP_PRIORITY_TIMEOUT_POSITIVE"
    }
  }
  return {
    labelAgreement: 0,
    sampleWeight:
      baseWeight * Math.max(0, Number(safeCfg?.timeoutNegativeWeight ?? 0.9) || 0.9),
    labelSource: "TARGET_STOP_PRIORITY_TIMEOUT_NEGATIVE"
  }
}

const loadValidatedTradeReplayDatasetsCached = async ({
  ctx,
  latestValidatedTradeOutcomes,
  agreementModelCfg = null
}) => {
  const empty = {
    falsePositiveRows: [],
    agreementRows: [],
    dayTypeRows: [],
    cacheHit: false,
    cacheSource: "none"
  }
  if (latestValidatedTradeOutcomes?.available !== true || latestValidatedTradeOutcomes.rowCount < 1) {
    return empty
  }
  const paths = resolveValidatedTradeReplaySeedPaths(ctx)
  const sourceFingerprint = await buildFileFingerprint(latestValidatedTradeOutcomes.sourcePath)
  const expectedMeta = buildValidatedTradeReplaySeedMeta({
    ctx,
    sourceFingerprint
  })
  const runtimeCache =
    String(ctx?.__runtime?.validatedTradeReplaySeedCache?.cacheKey ?? "").trim() ===
      String(expectedMeta?.cacheKey ?? "").trim()
      ? ctx.__runtime.validatedTradeReplaySeedCache.value
      : null
  if (runtimeCache) {
    return {
      falsePositiveRows: Array.isArray(runtimeCache?.falsePositiveRows) ? runtimeCache.falsePositiveRows : [],
      agreementRows: Array.isArray(runtimeCache?.agreementRows) ? runtimeCache.agreementRows : [],
      dayTypeRows: Array.isArray(runtimeCache?.dayTypeRows) ? runtimeCache.dayTypeRows : [],
      cacheHit: true,
      cacheSource: "memory"
    }
  }
  const cacheMeta = pathExists(paths.metaPath) ? await readJson(paths.metaPath, null) : null
  const cacheUsable =
    isValidatedTradeReplaySeedMetaUsable({ cacheMeta, expectedMeta }) &&
    pathExists(paths.bundlePath)
  if (cacheUsable) {
    const bundle = await readJson(paths.bundlePath, null)
    const loaded = {
      falsePositiveRows: Array.isArray(bundle?.falsePositiveRows) ? bundle.falsePositiveRows : [],
      agreementRows: Array.isArray(bundle?.agreementRows) ? bundle.agreementRows : [],
      dayTypeRows: Array.isArray(bundle?.dayTypeRows) ? bundle.dayTypeRows : []
    }
    ctx.__runtime = ctx.__runtime ?? {}
    ctx.__runtime.validatedTradeReplaySeedCache = {
      cacheKey: expectedMeta.cacheKey,
      value: loaded
    }
    return {
      ...loaded,
      cacheHit: true,
      cacheSource: "disk"
    }
  }
  const built = buildValidatedTradeReplayDatasets({
    validatedTradeRows: latestValidatedTradeOutcomes.rows,
    agreementModelCfg
  })
  await ensureDir(path.dirname(paths.metaPath))
  await writeJson(paths.bundlePath, {
    generatedAt: new Date().toISOString(),
    falsePositiveRows: built.falsePositiveRows,
    agreementRows: built.agreementRows,
    dayTypeRows: built.dayTypeRows
  })
  const finalMeta = buildValidatedTradeReplaySeedMeta({
    ctx,
    sourceFingerprint,
    rows: {
      falsePositive: built.falsePositiveRows.length,
      agreement: built.agreementRows.length,
      dayType: built.dayTypeRows.length
    }
  })
  await writeJson(paths.metaPath, finalMeta)
  ctx.__runtime = ctx.__runtime ?? {}
  ctx.__runtime.validatedTradeReplaySeedCache = {
    cacheKey: finalMeta.cacheKey,
    value: {
      falsePositiveRows: built.falsePositiveRows,
      agreementRows: built.agreementRows,
      dayTypeRows: built.dayTypeRows
    }
  }
  return {
    ...built,
    cacheHit: false,
    cacheSource: "rebuilt"
  }
}

const buildValidatedTradeReplayFeedbackDays = ({ validatedTradeRows = [] }) => {
  const byDate = new Map()
  for (const row of Array.isArray(validatedTradeRows) ? validatedTradeRows : []) {
    const decisionDateKey = String(row?.decisionDateKey ?? "").trim()
    const symbol = String(row?.symbol ?? "").trim()
    if (!decisionDateKey || !symbol) continue
    if (!row?.groupScores || typeof row.groupScores !== "object") continue
    const netRet = Number(row?.netRet)
    if (!Number.isFinite(netRet)) continue
    const role = String(row?.candidateRole ?? "").trim().toUpperCase()
    const bucket = byDate.get(decisionDateKey) ?? {
      topBySymbol: new Map(),
      pickBySymbol: new Map()
    }
    const normalized = {
      symbol,
      finalScore: Number(row?.finalScore ?? row?.rankerScore ?? row?.score ?? 0) || 0,
      score: Number(row?.score ?? row?.finalScore ?? row?.rankerScore ?? 0) || 0,
      successInWindow:
        row?.hitTarget === true ||
        String(row?.exitReason ?? "").trim().toUpperCase() === "TARGET",
      groupScores: row.groupScores
    }
    const priority = resolveValidatedTradeReplayPriority(row)
    const prevTop = bucket.topBySymbol.get(symbol)
    if (
      ["TOP1", "PICK", "EXECUTED"].includes(role) &&
      (!prevTop || priority >= Number(prevTop.priority ?? -1))
    ) {
      bucket.topBySymbol.set(symbol, { priority, row: normalized })
    }
    if (row?.selectedByPolicy === true || row?.executedByPolicy === true) {
      const prevPick = bucket.pickBySymbol.get(symbol)
      if (!prevPick || priority >= Number(prevPick.priority ?? -1)) {
        bucket.pickBySymbol.set(symbol, { priority, row: normalized })
      }
    }
    byDate.set(decisionDateKey, bucket)
  }
  return Array.from(byDate.entries())
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([decisionDateKey, bucket]) => {
      const top = Array.from(bucket.topBySymbol.values())
        .map((entry) => entry.row)
        .sort((a, b) => Number(b?.finalScore ?? 0) - Number(a?.finalScore ?? 0))
      const picks = Array.from(bucket.pickBySymbol.values())
        .map((entry) => entry.row)
        .sort((a, b) => Number(b?.finalScore ?? 0) - Number(a?.finalScore ?? 0))
      const effectivePicks =
        picks.length > 0
          ? picks
          : (top[0]
            ? [
                {
                  ...top[0],
                  selectedByPolicy: true,
                  syntheticReplayPick: true
                }
              ]
            : [])
      return {
        decisionDateKey,
        top,
        picks: effectivePicks
      }
    })
}

const resolveGeneralizationConfig = (raw) => {
  const cfg = raw ?? {}
  const mode = String(cfg?.splitMode ?? cfg?.mode ?? "chronological").trim().toLowerCase()
  const safeMode = mode === "interleaved" ? "interleaved" : "chronological"
  const pairwise = cfg?.pairwise ?? {}
  const weightRegularization = cfg?.weightRegularization ?? {}
  const extendedBias = cfg?.extendedBias ?? {}
  const tradeQualityPrior = cfg?.tradeQualityPrior ?? {}
  const tradeQualityPriorSourceModeRaw = String(
    tradeQualityPrior?.sourceMode ??
      (tradeQualityPrior?.requireExecutedTrade === true ? "executed_only" : "selected_candidates"),
  )
    .trim()
    .toLowerCase()
  const tradeQualityPriorSourceMode =
    tradeQualityPriorSourceModeRaw === "executed_only" ? "executed_only" : "selected_candidates"
  const promotionScope = resolvePromotionScope(
    cfg?.promotionScope ??
      (cfg?.useEvalForPromotion === true ? "eval" : "update"),
  )
  return {
    enabled: cfg?.enabled === true,
    promotionScope,
    useEvalForPromotion: promotionScope === "eval",
    mode: safeMode,
    updateRatio: clampRange(cfg?.updateRatio ?? 0.7, 0.5, 0.95),
    evalMinDays: Math.max(5, Math.floor(Number(cfg?.evalMinDays ?? 20) || 20)),
    evalFoldOffset: Math.max(0, Math.floor(Number(cfg?.evalFoldOffset ?? 0) || 0)),
    targetPickedControlDays: Math.max(0, Math.floor(Number(cfg?.targetPickedControlDays ?? 0) || 0)),
    pairwiseEnabled: pairwise?.enabled !== false,
    pairwisePositiveTopN: Math.max(1, Math.floor(Number(pairwise?.positiveTopN ?? 3) || 3)),
    pairwiseNegativeTopN: Math.max(1, Math.floor(Number(pairwise?.negativeTopN ?? 5) || 5)),
    pairwiseWeight: Math.max(0, Number(pairwise?.pairwiseWeight ?? 1.0) || 1.0),
    hardNegativeWeight: Math.max(0, Number(pairwise?.hardNegativeWeight ?? 1.5) || 1.5),
    rankLossMarginScale: Math.max(1e-6, Number(pairwise?.rankLossMarginScale ?? 0.02) || 0.02),
    rankLossMaxFactor: Math.max(0.5, Number(pairwise?.rankLossMaxFactor ?? 3) || 3),
    pairwiseMaxUpdatesPerDay: Math.max(1, Math.floor(Number(pairwise?.maxUpdatesPerDay ?? 12) || 12)),
    feedbackDelayDays: Math.max(0, Math.floor(Number(cfg?.feedbackDelayDays ?? 0) || 0)),
    purgeGapDays: Math.max(0, Math.floor(Number(cfg?.purgeGapDays ?? 0) || 0)),
    weightRegularization: {
      enabled: weightRegularization?.enabled !== false,
      minActiveGroupWeight: clampRange(weightRegularization?.minActiveGroupWeight ?? 0.03, 0, 0.2),
      maxSingleGroupWeight: clampRange(weightRegularization?.maxSingleGroupWeight ?? 0.45, 0.25, 1),
      weightEntropyFloor: clampRange(weightRegularization?.weightEntropyFloor ?? 0.72, 0, 1),
      maxDailyWeightShiftL1: clampRange(weightRegularization?.maxDailyWeightShiftL1 ?? 0.35, 0, 2),
    },
    extendedBias: {
      enabled: extendedBias?.enabled === true,
      routeBucketBiasWeight: clampRange(Number(extendedBias?.routeBucketBiasWeight ?? 0.12) || 0.12, 0, 2),
      regimeBiasWeight: clampRange(Number(extendedBias?.regimeBiasWeight ?? 0.08) || 0.08, 0, 2),
      prototypeBiasWeight: clampRange(Number(extendedBias?.prototypeBiasWeight ?? 0.1) || 0.1, 0, 2),
      maxAbsBias: clampRange(Number(extendedBias?.maxAbsBias ?? 0.08) || 0.08, 0, 1),
      l2Penalty: clampRange(Number(extendedBias?.l2Penalty ?? 0.002) || 0.002, 0, 1),
      learningRate: clampRange(Number(extendedBias?.learningRate ?? 0.01) || 0.01, 0, 1),
      outcomeMode:
        String(extendedBias?.outcomeMode ?? "binary_hit").trim().toLowerCase() === "realized_net_ret"
          ? "realized_net_ret"
          : "binary_hit",
      positiveNetRetScale: Math.max(
        1e-6,
        Number(extendedBias?.positiveNetRetScale ?? 0.08) || 0.08,
      ),
      negativeNetRetScale: Math.max(
        1e-6,
        Number(extendedBias?.negativeNetRetScale ?? 0.04) || 0.04,
      ),
      netRetDeadband: Math.max(
        0,
        Number(extendedBias?.netRetDeadband ?? 0.002) || 0,
      )
    },
      tradeQualityPrior: {
        enabled: tradeQualityPrior?.enabled === true,
        routeBucketWeight: clampRange(Number(tradeQualityPrior?.routeBucketWeight ?? 0.08) || 0.08, 0, 2),
        regimeWeight: clampRange(Number(tradeQualityPrior?.regimeWeight ?? 0.06) || 0.06, 0, 2),
        prototypeWeight: clampRange(Number(tradeQualityPrior?.prototypeWeight ?? 0.1) || 0.1, 0, 2),
        maxAbsAdjustment: clampRange(Number(tradeQualityPrior?.maxAbsAdjustment ?? 0.1) || 0.1, 0, 1),
        priorSamples: Math.max(1, Math.floor(Number(tradeQualityPrior?.priorSamples ?? 8) || 8)),
        targetWeight: Math.max(0, Number(tradeQualityPrior?.targetWeight ?? 0.7) || 0.7),
        stopPenaltyWeight: Math.max(0, Number(tradeQualityPrior?.stopPenaltyWeight ?? 0.85) || 0.85),
        timeoutPositiveWeight: Math.max(
          0,
          Number(
            tradeQualityPrior?.timeoutPositiveWeight ??
              tradeQualityPrior?.positiveRateWeight ??
              0.1,
          ) || 0.1,
        ),
        timeoutNegativePenaltyWeight: Math.max(
          0,
          Number(tradeQualityPrior?.timeoutNegativePenaltyWeight ?? 0.2) || 0.2,
        ),
        netRetWeight: Math.max(0, Number(tradeQualityPrior?.netRetWeight ?? 0.35) || 0.35),
        netRetScale: Math.max(1e-6, Number(tradeQualityPrior?.netRetScale ?? 0.04) || 0.04),
        applyToRanker: tradeQualityPrior?.applyToRanker === true,
        sourceMode: tradeQualityPriorSourceMode,
        requireExecutedTrade: tradeQualityPriorSourceMode === "executed_only"
      }
  }
}

const resolveAdaptiveMinFinalConfig = ({ baseMinFinalScore, raw }) => {
  const cfg = raw ?? {}
  const floor = Math.max(0, Number(cfg?.minFloor ?? Math.max(0, baseMinFinalScore - 0.12)) || 0)
  const ceil = Math.max(floor, Number(cfg?.maxCeil ?? Math.max(baseMinFinalScore, 0.8)) || Math.max(baseMinFinalScore, 0.8))
  const modeRaw = String(cfg?.strategy ?? cfg?.mode ?? "").trim().toLowerCase()
  const mode =
    modeRaw === "lower_bound_only" || modeRaw === "quality_aware"
      ? modeRaw
      : "quality_aware"
  return {
    enabled: cfg?.enabled === true,
    mode,
    targetMinPicked: Math.max(0, Math.floor(Number(cfg?.targetMinPicked ?? 10) || 10)),
    targetMaxPicked: Math.max(0, Math.floor(Number(cfg?.targetMaxPicked ?? 15) || 15)),
    step: Math.max(0, Number(cfg?.step ?? 0.003) || 0.003),
    hysteresis: Math.max(0, Number(cfg?.hysteresis ?? 2) || 2),
    minLcbFloor: clamp01(cfg?.minLcbFloor ?? 0),
    minBudgetedConversion80Floor: clamp01(cfg?.minBudgetedConversion80Floor ?? 0),
    minFloor: floor,
    maxCeil: ceil,
    warmupDays: Math.max(0, Math.floor(Number(cfg?.warmupDays ?? 8) || 8))
  }
}

const resolveCoarsePruneHealthConfig = (raw) => {
  const cfg = raw ?? {}
  const warnAbove = clampRange(Number(cfg?.warnAbove ?? 0.9) || 0.9, 0, 1.5)
  const failAboveRaw = Number(cfg?.failAbove)
  const failAbove =
    Number.isFinite(failAboveRaw) && failAboveRaw > 0
      ? clampRange(failAboveRaw, 0, 1.5)
      : null
  return {
    warnAbove,
    failAbove,
    failHard: cfg?.failHard === true,
    failSoft: cfg?.failSoft === true
  }
}

const buildUvSplit = ({ tradingDates, cfg }) => {
  const dates = Array.isArray(tradingDates) ? tradingDates.slice() : []
  const uniqueDates = Array.from(new Set(dates.map((d) => String(d ?? "")))).filter(Boolean).sort((a, b) => a.localeCompare(b))
  const applyPurgeGap = (updateDates, evalDates) => {
    const gap = Math.max(0, Math.floor(Number(cfg?.purgeGapDays ?? 0) || 0))
    const update = Array.isArray(updateDates) ? updateDates.slice() : []
    const evals = Array.isArray(evalDates) ? evalDates.slice() : []
    if (gap < 1 || update.length < 1 || evals.length < 1) return update
    const evalSet = new Set(evals)
    const idxByDate = new Map(uniqueDates.map((d, i) => [d, i]))
    const filtered = update.filter((dateKey) => {
      const idx = idxByDate.get(dateKey)
      if (!Number.isInteger(idx)) return false
      for (let offset = 1; offset <= gap; offset += 1) {
        const prev = uniqueDates[idx - offset]
        const next = uniqueDates[idx + offset]
        if ((prev && evalSet.has(prev)) || (next && evalSet.has(next))) {
          return false
        }
      }
      return true
    })
    if (filtered.length > 0) return filtered
    return update
  }
  if (!cfg?.enabled || uniqueDates.length < 2) {
    const allSet = new Set(uniqueDates)
    return {
      enabled: false,
      mode: String(cfg?.mode ?? "chronological"),
      updateDateSet: allSet,
      evalDateSet: new Set(allSet),
      updateDays: uniqueDates.length,
      evalDays: uniqueDates.length
    }
  }
  if (String(cfg?.mode) === "interleaved") {
    const evalStep = Math.max(2, Math.round(1 / Math.max(1e-6, 1 - Number(cfg?.updateRatio ?? 0.7))))
    const update = []
    const evals = []
    const evalOffset = Math.max(0, Math.floor(Number(cfg?.evalFoldOffset ?? 0) || 0)) % evalStep
    for (let i = 0; i < uniqueDates.length; i += 1) {
      if ((i + evalOffset) % evalStep === evalStep - 1) evals.push(uniqueDates[i])
      else update.push(uniqueDates[i])
    }
    if (evals.length < Number(cfg?.evalMinDays ?? 20)) {
      const need = Number(cfg?.evalMinDays ?? 20) - evals.length
      for (let i = 0; i < need && update.length > 1; i += 1) {
        const moved = update.pop()
        if (moved) evals.unshift(moved)
      }
    }
    if (!update.length && evals.length > 1) {
      update.push(evals.shift())
    }
    if (!evals.length && update.length > 1) {
      evals.push(update.pop())
    }
    const updatePurged = applyPurgeGap(update, evals)
    return {
      enabled: true,
      mode: "interleaved",
      updateDateSet: new Set(updatePurged),
      evalDateSet: new Set(evals),
      updateDays: updatePurged.length,
      evalDays: evals.length
    }
  }
  const total = uniqueDates.length
  const evalDaysRaw = Math.max(
    Number(cfg?.evalMinDays ?? 20),
    Math.round(total * (1 - Number(cfg?.updateRatio ?? 0.7))),
  )
  const evalDays = Math.max(1, Math.min(total - 1, evalDaysRaw))
  const updateDays = Math.max(1, total - evalDays)
  const update = uniqueDates.slice(0, updateDays)
  const evals = uniqueDates.slice(updateDays)
  const updatePurged = applyPurgeGap(update, evals)
  return {
    enabled: true,
    mode: "chronological",
    updateDateSet: new Set(updatePurged),
    evalDateSet: new Set(evals),
    updateDays: updatePurged.length,
    evalDays: evals.length
  }
}

const resolveExcludedFeatureGroups = (ctx, library, runtimeMeta) => {
  const merged = [
    ...(Array.isArray(ctx?.config?.pattern?.excludeFeatureGroups) ? ctx.config.pattern.excludeFeatureGroups : []),
    ...(Array.isArray(library?.excludedFeatureGroups) ? library.excludedFeatureGroups : []),
    ...(Array.isArray(runtimeMeta?.excludedFeatureGroups) ? runtimeMeta.excludedFeatureGroups : [])
  ]
  const out = new Set()
  for (const value of merged) {
    const key = String(value ?? "").trim().toLowerCase()
    if (!key) continue
    out.add(key)
  }
  return out
}

const normalize = (obj) => {
  const out = {}
  let sum = 0
  for (const key of GROUPS) {
    const v = Number(obj?.[key] ?? 0)
    const safe = Number.isFinite(v) && v > 0 ? v : 0
    out[key] = safe
    sum += safe
  }
  if (!sum) return out
  for (const key of GROUPS) out[key] /= sum
  return out
}

const mergePeriods = (left, right) => {
  const from = String(left?.from ?? "") <= String(right?.from ?? "")
    ? String(left?.from ?? "")
    : String(right?.from ?? "")
  const to = String(left?.to ?? "") >= String(right?.to ?? "")
    ? String(left?.to ?? "")
    : String(right?.to ?? "")
  return { from, to }
}

const applyLockedZeroWeights = (weights, lockedGroups) => {
  const out = { ...weights }
  const allowedGroups = new Set(GROUPS)
  for (const group of lockedGroups ?? []) {
    if (!allowedGroups.has(String(group ?? "").trim())) continue
    out[group] = 0
  }
  return normalize(out)
}

const enforceWeightRegularization = ({ weights, lockedGroups, cfg, prevWeights = null }) => {
  const regularization = cfg?.weightRegularization ?? {}
  if (regularization?.enabled === false) {
    return applyLockedZeroWeights(weights, lockedGroups)
  }
  const locked = new Set(
    (Array.isArray(lockedGroups) ? lockedGroups : [])
      .map((v) => String(v ?? "").trim().toLowerCase())
      .filter(Boolean),
  )
  const out = { ...(weights ?? {}) }
  const activeKeys = Object.keys(out).filter((key) => !locked.has(String(key).toLowerCase()))
  if (!activeKeys.length) {
    return applyLockedZeroWeights(out, lockedGroups)
  }
  const minW = clampRange(Number(regularization?.minActiveGroupWeight ?? 0.03) || 0.03, 0, 0.2)
  const maxW = clampRange(Number(regularization?.maxSingleGroupWeight ?? 0.45) || 0.45, Math.max(0.25, minW), 1)

  let sum = 0
  for (const key of activeKeys) {
    const raw = Number(out[key])
    const safe = Number.isFinite(raw) && raw > 0 ? raw : 0
    out[key] = safe
    sum += safe
  }
  if (sum <= 0) {
    const equal = 1 / activeKeys.length
    for (const key of activeKeys) out[key] = equal
  } else {
    for (const key of activeKeys) out[key] /= sum
  }

  if (minW > 0 && minW * activeKeys.length < 1) {
    for (const key of activeKeys) {
      if (out[key] < minW) out[key] = minW
    }
    const floorSum = activeKeys.reduce((acc, key) => acc + Number(out[key] ?? 0), 0)
    if (floorSum > 0) {
      for (const key of activeKeys) out[key] /= floorSum
    }
  }

  for (let iter = 0; iter < 6; iter += 1) {
    let excess = 0
    const under = []
    for (const key of activeKeys) {
      if (out[key] > maxW) {
        excess += out[key] - maxW
        out[key] = maxW
      } else if (out[key] < maxW) {
        under.push(key)
      }
    }
    if (excess <= 1e-12 || under.length === 0) break
    const underMass = under.reduce((acc, key) => acc + Number(out[key] ?? 0), 0)
    if (underMass <= 1e-12) {
      const add = excess / under.length
      for (const key of under) out[key] += add
    } else {
      for (const key of under) out[key] += excess * (Number(out[key] ?? 0) / underMass)
    }
  }

  const finalSum = activeKeys.reduce((acc, key) => acc + Number(out[key] ?? 0), 0)
  if (finalSum > 0) {
    for (const key of activeKeys) out[key] /= finalSum
  }

  const entropyFloor = clampRange(Number(regularization?.weightEntropyFloor ?? 0) || 0, 0, 1)
  if (entropyFloor > 0 && activeKeys.length > 1) {
    const n = activeKeys.length
    let entropy = 0
    for (const key of activeKeys) {
      const p = Math.max(1e-12, Number(out[key] ?? 0))
      entropy -= p * Math.log(p)
    }
    const maxEntropy = Math.log(n)
    const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 1
    if (normalizedEntropy < entropyFloor) {
      const blend = clampRange(
        (entropyFloor - normalizedEntropy) / Math.max(1e-9, 1 - normalizedEntropy),
        0,
        1,
      )
      const uniform = 1 / n
      for (const key of activeKeys) {
        out[key] = (1 - blend) * Number(out[key] ?? 0) + blend * uniform
      }
      const sumAfterEntropy = activeKeys.reduce((acc, key) => acc + Number(out[key] ?? 0), 0)
      if (sumAfterEntropy > 0) {
        for (const key of activeKeys) out[key] /= sumAfterEntropy
      }
    }
  }

  const maxDailyWeightShiftL1 = clampRange(
    Number(regularization?.maxDailyWeightShiftL1 ?? 0) || 0,
    0,
    2,
  )
  if (maxDailyWeightShiftL1 > 0 && prevWeights && typeof prevWeights === "object") {
    const prevNormalized = applyLockedZeroWeights(normalize(prevWeights), lockedGroups)
    let l1 = 0
    for (const key of activeKeys) {
      l1 += Math.abs(Number(out[key] ?? 0) - Number(prevNormalized?.[key] ?? 0))
    }
    if (l1 > maxDailyWeightShiftL1 + 1e-12) {
      const alpha = clampRange(maxDailyWeightShiftL1 / l1, 0, 1)
      for (const key of activeKeys) {
        const prev = Number(prevNormalized?.[key] ?? 0)
        const curr = Number(out[key] ?? 0)
        out[key] = prev + (curr - prev) * alpha
      }
      const sumAfterCap = activeKeys.reduce((acc, key) => acc + Number(out[key] ?? 0), 0)
      if (sumAfterCap > 0) {
        for (const key of activeKeys) out[key] /= sumAfterCap
      }
    }
  }
  for (const key of locked) out[key] = 0
  return applyLockedZeroWeights(out, lockedGroups)
}

const buildActiveGroupsFromWeights = ({ weights, excludedGroups }) =>
  Object.entries(weights ?? {})
    .filter(([k, v]) => Number(v) > 0 && !excludedGroups.has(String(k)))
    .map(([k]) => String(k))

const resolveCpuCount = () => {
  if (typeof os.availableParallelism === "function") {
    const n = Number(os.availableParallelism())
    if (Number.isInteger(n) && n > 0) return n
  }
  const list = os.cpus?.()
  return Array.isArray(list) && list.length > 0 ? list.length : 1
}

const resolveInitialWeights = async ({ ctx, defaults, excludedGroups }) => {
  void defaults
  const rawPath = String(ctx?.config?.onlineLearning?.startWeightsPath ?? "").trim()
  if (!rawPath) {
    throw new Error(
      "onlineLearning.startWeightsPath is required in strict mode",
    )
  }
  const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.cwd, rawPath)
  const loaded = await readJson(resolvedPath, null)
  if (!loaded || typeof loaded !== "object") {
    throw new Error(`onlineLearning.startWeightsPath missing or unreadable: ${resolvedPath}`)
  }
  let rawWeights = loaded?.weights
  if (!rawWeights && loaded?.finalWeights && typeof loaded.finalWeights === "object") {
    rawWeights = loaded.finalWeights
  }
  if (!rawWeights && loaded && typeof loaded === "object") {
    const direct = {}
    let found = false
    for (const key of GROUPS) {
      const n = Number(loaded?.[key])
      if (Number.isFinite(n) && n >= 0) {
        direct[key] = n
        found = true
      }
    }
    if (found) rawWeights = direct
  }
  if (!rawWeights || typeof rawWeights !== "object") {
    throw new Error(`onlineLearning.startWeightsPath invalid weight object: ${resolvedPath}`)
  }
  const safe = {}
  for (const [key, value] of Object.entries(rawWeights)) {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`onlineLearning.startWeightsPath invalid weight: ${key}=${value}`)
    }
    safe[String(key)] = n
  }
  return {
    weights: applyLockedZeroWeights(safe, excludedGroups),
    source: resolvedPath
  }
}

const bump = (obj, key) => {
  obj[key] = Number(obj[key] ?? 0) + 1
}

const bumpSplitCounter = ({
  allCounts,
  updateCounts,
  evalCounts,
  key,
  inUpdateSplit = false,
  inEvalSplit = false
}) => {
  bump(allCounts, key)
  if (inUpdateSplit) bump(updateCounts, key)
  if (inEvalSplit) bump(evalCounts, key)
}

const evaluateSimilarityGate = ({ scored, cfg, disambiguationCfg }) => {
  const rawSimilarityScore = num(scored?.total)
  const globalStageScore = num(scored?.stageScores?.global)
  const localStageScore = num(scored?.stageScores?.local)
  const triggerStageScore = num(scored?.stageScores?.trigger)
  const positiveTop2RawSimilarity = num(scored?.positiveTop2?.total)
  const top1Top2PositiveGap = num(scored?.top1Top2PositiveGap)
  const positiveVsNegativeGap = num(scored?.positiveVsNegativeGap)
  const negativeTop1RawSimilarity = num(scored?.negativeTop1?.total)
  const negativeTop1StopRawSimilarity = num(scored?.negativeTop1Stop?.total)
  const negativeTop1TimeoutNegativeRawSimilarity = num(scored?.negativeTop1TimeoutNegative?.total)
  const negativeTop1LowExecutionQualityRawSimilarity = num(
    scored?.negativeTop1LowExecutionQuality?.total,
  )
  const rejectReasons = []
  const gateEnabled = cfg?.enabled === true
  const disambiguationEnabled = disambiguationCfg?.enabled === true
  const minRawSimilarity = num(cfg?.minRawSimilarity)
  const minLocalStageScore = num(cfg?.minLocalStageScore)
  const minTriggerStageScore = num(cfg?.minTriggerStageScore)
  const minTop1Top2Gap = num(disambiguationCfg?.minTop1Top2Gap)
  const minPositiveNegativeGap = num(disambiguationCfg?.minPositiveNegativeGap)

  if (gateEnabled) {
    if (
      Number.isFinite(minRawSimilarity) &&
      (!Number.isFinite(rawSimilarityScore) || rawSimilarityScore < minRawSimilarity)
    ) {
      rejectReasons.push("RAW_SIMILARITY_LOW")
    }
    if (
      Number.isFinite(minLocalStageScore) &&
      (!Number.isFinite(localStageScore) || localStageScore < minLocalStageScore)
    ) {
      rejectReasons.push("LOCAL_STAGE_SCORE_LOW")
    }
    if (
      Number.isFinite(minTriggerStageScore) &&
      (!Number.isFinite(triggerStageScore) || triggerStageScore < minTriggerStageScore)
    ) {
      rejectReasons.push("TRIGGER_STAGE_SCORE_LOW")
    }
  }
  if (disambiguationEnabled) {
    if (
      Number.isFinite(minTop1Top2Gap) &&
      (!Number.isFinite(top1Top2PositiveGap) || top1Top2PositiveGap < minTop1Top2Gap)
    ) {
      rejectReasons.push(
        Number.isFinite(positiveTop2RawSimilarity) ? "AMBIGUITY_GAP_LOW" : "AMBIGUITY_GAP_UNAVAILABLE",
      )
    }
    if (Number.isFinite(minPositiveNegativeGap)) {
      if (!Number.isFinite(positiveVsNegativeGap)) {
        rejectReasons.push("NEGATIVE_GAP_UNAVAILABLE")
      } else if (positiveVsNegativeGap < minPositiveNegativeGap) {
        rejectReasons.push("NEGATIVE_GAP_LOW")
      }
    }
  }

  return {
    enabled: gateEnabled,
    disambiguationEnabled,
    passed: rejectReasons.length < 1,
    rejectReasons,
    rawSimilarityScore,
    globalStageScore,
    localStageScore,
    triggerStageScore,
    positiveTop2RawSimilarity,
    top1Top2PositiveGap,
    positiveVsNegativeGap,
    negativeTop1RawSimilarity,
    negativeTop1StopRawSimilarity,
    negativeTop1TimeoutNegativeRawSimilarity,
    negativeTop1LowExecutionQualityRawSimilarity
  }
}

const buildSimilarityDiagnostics = ({ similarityGateResult, scored }) => ({
  rawSimilarityScore: similarityGateResult?.rawSimilarityScore ?? null,
  globalStageScore: similarityGateResult?.globalStageScore ?? null,
  localStageScore: similarityGateResult?.localStageScore ?? null,
  triggerStageScore: similarityGateResult?.triggerStageScore ?? null,
  positiveTop2RawSimilarity: similarityGateResult?.positiveTop2RawSimilarity ?? null,
  top1Top2PositiveGap: similarityGateResult?.top1Top2PositiveGap ?? null,
  positiveVsNegativeGap: similarityGateResult?.positiveVsNegativeGap ?? null,
  negativeTop1RawSimilarity: similarityGateResult?.negativeTop1RawSimilarity ?? null,
  negativeTop1StopRawSimilarity: similarityGateResult?.negativeTop1StopRawSimilarity ?? null,
  negativeTop1TimeoutNegativeRawSimilarity:
    similarityGateResult?.negativeTop1TimeoutNegativeRawSimilarity ?? null,
  negativeTop1LowExecutionQualityRawSimilarity:
    similarityGateResult?.negativeTop1LowExecutionQualityRawSimilarity ?? null,
  positiveTop2PrototypeId: scored?.positiveTop2?.prototypeId ?? null,
  positiveTop2PrototypeClusterId: scored?.positiveTop2?.prototypeClusterId ?? null,
  negativeTop1PrototypeId: scored?.negativeTop1?.prototypeId ?? null,
  negativeTop1PrototypeClusterId: scored?.negativeTop1?.prototypeClusterId ?? null,
  negativeTop1OutcomeBucket: scored?.negativeTop1?.outcomeBucket ?? null,
  negativeTop1StopPrototypeId: scored?.negativeTop1Stop?.prototypeId ?? null,
  negativeTop1TimeoutNegativePrototypeId: scored?.negativeTop1TimeoutNegative?.prototypeId ?? null,
  negativeTop1LowExecutionQualityPrototypeId:
    scored?.negativeTop1LowExecutionQuality?.prototypeId ?? null
})

const toSimilarityGateTopCandidateSummary = (row) => {
  if (!row || typeof row !== "object") return null
  const symbol = String(row?.symbol ?? "").trim()
  if (!symbol) return null
  return {
    symbol,
    finalScore: num(row?.finalScore),
    rawSimilarityScore: num(row?.rawSimilarityScore),
    localStageScore: num(row?.localStageScore),
    triggerStageScore: num(row?.triggerStageScore),
    positiveTop2RawSimilarity: num(row?.positiveTop2RawSimilarity),
    top1Top2PositiveGap: num(row?.top1Top2PositiveGap),
    positiveVsNegativeGap: num(row?.positiveVsNegativeGap),
    negativeTop1RawSimilarity: num(row?.negativeTop1RawSimilarity),
    matchedPrototypeId: String(row?.matchedPrototypeId ?? "").trim() || null,
    negativeTop1PrototypeId: String(row?.negativeTop1PrototypeId ?? "").trim() || null,
    negativeTop1OutcomeBucket: String(row?.negativeTop1OutcomeBucket ?? "").trim() || null,
    successInWindow: row?.successInWindow === true,
    similarityGateRejectReasons: Array.isArray(row?.similarityGateRejectReasons)
      ? row.similarityGateRejectReasons
      : []
  }
}

const bumpSimilarityGateStats = ({ stats, gateResult, dayRejectReasonCounts = null }) => {
  if (!stats || !gateResult) return
  stats.scoredCount += 1
  if (gateResult.passed === true) {
    stats.passedCount += 1
    return
  }
  stats.rejectedCount += 1
  for (const reason of gateResult.rejectReasons ?? []) {
    bump(stats.rejectReasonCounts, reason)
    if (dayRejectReasonCounts) bump(dayRejectReasonCounts, reason)
  }
}

const buildSimilarityGateSummary = ({ similarityCfg, disambiguationCfg, stats }) => {
  const scoredCount = Math.max(0, Number(stats?.scoredCount ?? 0) || 0)
  const passedCount = Math.max(0, Number(stats?.passedCount ?? 0) || 0)
  const rejectedCount = Math.max(0, Number(stats?.rejectedCount ?? 0) || 0)
  return {
    enabled: similarityCfg?.enabled === true,
    disambiguationEnabled: disambiguationCfg?.enabled === true,
    minRawSimilarity: num(similarityCfg?.minRawSimilarity),
    minLocalStageScore: num(similarityCfg?.minLocalStageScore),
    minTriggerStageScore: num(similarityCfg?.minTriggerStageScore),
    minTop1Top2Gap: num(disambiguationCfg?.minTop1Top2Gap),
    minPositiveNegativeGap: num(disambiguationCfg?.minPositiveNegativeGap),
    scoredCount,
    passedCount,
    rejectedCount,
    passRate: scoredCount > 0 ? passedCount / scoredCount : 0,
    rejectReasonCounts: stats?.rejectReasonCounts ?? {}
  }
}

const pushSplitNumericSample = ({
  allValues,
  updateValues,
  evalValues,
  value,
  inUpdateSplit = false,
  inEvalSplit = false
}) => {
  const safe = num(value)
  if (!Number.isFinite(safe)) return
  allValues.push(safe)
  if (inUpdateSplit) updateValues.push(safe)
  if (inEvalSplit) evalValues.push(safe)
}

const summarizeNumericSamples = (values) => {
  const list = Array.isArray(values) ? values.map(num).filter(Number.isFinite) : []
  if (list.length < 1) {
    return {
      count: 0,
      min: null,
      p10: null,
      p50: null,
      p90: null,
      max: null,
      mean: null
    }
  }
  const total = list.reduce((acc, value) => acc + value, 0)
  return {
    count: list.length,
    min: Math.min(...list),
    p10: quantile(list, 0.1),
    p50: quantile(list, 0.5),
    p90: quantile(list, 0.9),
    max: Math.max(...list),
    mean: total / Math.max(1, list.length)
  }
}

const isAgreementModelUnavailableForDay = ({ checks, agreementModelCfg }) => {
  if (agreementModelCfg?.enabled !== true) return false
  const viewModes = checks?.viewModes && typeof checks.viewModes === "object"
    ? Object.values(checks.viewModes)
    : []
  if (viewModes.length < 1) return false
  return viewModes.every((value) => String(value ?? "").trim().toUpperCase() === "DISABLED")
}

const resolveAgreementChecksForTelemetry = ({ agreementGate, top1 }) => {
  const gateChecks =
    agreementGate?.checks && typeof agreementGate.checks === "object" ? agreementGate.checks : null
  if (gateChecks) {
    return {
      source: "gate",
      checks: gateChecks
    }
  }
  const topChecks =
    top1?.agreementChecks && typeof top1.agreementChecks === "object" ? top1.agreementChecks : null
  if (topChecks) {
    return {
      source: "top1",
      checks: topChecks
    }
  }
  return {
    source: "none",
    checks: {}
  }
}

const summarizeAgreementVoteLeaders = ({ checks, top1Symbol }) => {
  const voteCounts = {}
  const collect = (entries) => {
    for (const entry of Object.values(entries && typeof entries === "object" ? entries : {})) {
      const symbol = String(entry?.topSymbol ?? "").trim()
      if (!symbol) continue
      bump(voteCounts, symbol)
    }
  }
  collect(checks?.viewRanks)
  collect(checks?.scenarioRanks)
  const leaders = Object.entries(voteCounts)
    .map(([symbol, votes]) => ({
      symbol: String(symbol ?? "").trim(),
      votes: Math.max(0, Number(votes ?? 0) || 0)
    }))
    .filter((row) => row.symbol && row.votes > 0)
    .sort((left, right) => {
      if (right.votes !== left.votes) return right.votes - left.votes
      return left.symbol.localeCompare(right.symbol)
    })
  const totalVotes = leaders.reduce((acc, row) => acc + row.votes, 0)
  let entropy = 0
  for (const row of leaders) {
    const p = row.votes / Math.max(1, totalVotes)
    entropy -= p * Math.log(Math.max(1e-12, p))
  }
  const consensusLeaderSymbol = leaders[0]?.symbol ?? null
  const consensusLeaderVotes = leaders[0]?.votes ?? 0
  const consensusLeaderVoteShare =
    totalVotes > 0 ? consensusLeaderVotes / totalVotes : 0
  const safeTop1Symbol = String(top1Symbol ?? "").trim() || null
  const consensusLeaderMatchesTop1 =
    safeTop1Symbol != null &&
    consensusLeaderSymbol != null &&
    safeTop1Symbol === consensusLeaderSymbol
  let disagreementPattern = "UNKNOWN"
  if (totalVotes < 1) {
    disagreementPattern = "UNKNOWN"
  } else if (consensusLeaderMatchesTop1 && consensusLeaderVoteShare >= 0.6) {
    disagreementPattern = "TOP1_CONSENSUS"
  } else if (!consensusLeaderMatchesTop1 && consensusLeaderVoteShare >= 0.6) {
    disagreementPattern = "SINGLE_ALT"
  } else if (consensusLeaderVoteShare <= 0.4) {
    disagreementPattern = "DIFFUSE"
  } else {
    disagreementPattern = "MIXED"
  }
  return {
    topAgreementLeaders: leaders.slice(0, 3),
    agreementVoteCounts: voteCounts,
    agreementVoteSourceCount: totalVotes,
    agreementVoteEntropy: totalVotes > 0 ? entropy : null,
    consensusLeaderSymbol,
    consensusLeaderVotes,
    consensusLeaderVoteShare,
    consensusLeaderMatchesTop1,
    disagreementPattern
  }
}

const createAgreementBlockedBucketStats = () => ({
  days: 0,
  reasonCounts: {},
  patternCounts: {},
  agreementScoreSamples: [],
  rawSimilaritySamples: [],
  localStageSamples: [],
  triggerStageSamples: [],
  gateScoreMarginSamples: [],
  consensusRateSamples: [],
  stabilityRateSamples: []
})

const recordAgreementBlockedBucket = ({ bucket, telemetry }) => {
  if (!bucket || !telemetry || telemetry.blockedDay !== true) return
  bucket.days += 1
  if (telemetry.reason) bump(bucket.reasonCounts, telemetry.reason)
  if (telemetry.disagreementPattern) bump(bucket.patternCounts, telemetry.disagreementPattern)
  pushSplitNumericSample({
    allValues: bucket.agreementScoreSamples,
    updateValues: [],
    evalValues: [],
    value: telemetry.agreementScore
  })
  pushSplitNumericSample({
    allValues: bucket.rawSimilaritySamples,
    updateValues: [],
    evalValues: [],
    value: telemetry.rawSimilarityScore
  })
  pushSplitNumericSample({
    allValues: bucket.localStageSamples,
    updateValues: [],
    evalValues: [],
    value: telemetry.localStageScore
  })
  pushSplitNumericSample({
    allValues: bucket.triggerStageSamples,
    updateValues: [],
    evalValues: [],
    value: telemetry.triggerStageScore
  })
  pushSplitNumericSample({
    allValues: bucket.gateScoreMarginSamples,
    updateValues: [],
    evalValues: [],
    value: telemetry.gateScoreMargin
  })
  pushSplitNumericSample({
    allValues: bucket.consensusRateSamples,
    updateValues: [],
    evalValues: [],
    value: telemetry.consensusRate
  })
  pushSplitNumericSample({
    allValues: bucket.stabilityRateSamples,
    updateValues: [],
    evalValues: [],
    value: telemetry.stabilityRate
  })
}

const summarizeAgreementBlockedBucket = (bucket) => ({
  days: Math.max(0, Number(bucket?.days ?? 0) || 0),
  reasonCounts: bucket?.reasonCounts ?? {},
  patternCounts: bucket?.patternCounts ?? {},
  agreementScore: summarizeNumericSamples(bucket?.agreementScoreSamples),
  rawSimilarityScore: summarizeNumericSamples(bucket?.rawSimilaritySamples),
  localStageScore: summarizeNumericSamples(bucket?.localStageSamples),
  triggerStageScore: summarizeNumericSamples(bucket?.triggerStageSamples),
  gateScoreMargin: summarizeNumericSamples(bucket?.gateScoreMarginSamples),
  agreementConsensusRate: summarizeNumericSamples(bucket?.consensusRateSamples),
  agreementStabilityRate: summarizeNumericSamples(bucket?.stabilityRateSamples)
})

const buildAgreementGateDayTelemetry = ({
  rows,
  top1,
  agreementGate,
  agreementGateCfg,
  agreementModelCfg,
  top1Path,
  agreementBlocked
}) => {
  const gate = agreementGate && typeof agreementGate === "object" ? agreementGate : {}
  const checkSource = resolveAgreementChecksForTelemetry({
    agreementGate,
    top1
  })
  const checks = checkSource.checks
  const viewModes = checks?.viewModes && typeof checks.viewModes === "object" ? checks.viewModes : {}
  const scenarioModes =
    checks?.scenarioModes && typeof checks.scenarioModes === "object" ? checks.scenarioModes : {}
  const safeRows = Array.isArray(rows) ? rows : []
  const safeTop1Symbol = String(top1?.symbol ?? "").trim() || null
  const voteSummary = summarizeAgreementVoteLeaders({
    checks,
    top1Symbol: safeTop1Symbol
  })
  const consensusLeaderRow =
    voteSummary.consensusLeaderSymbol == null
      ? null
      : (safeRows.find(
          (row) => String(row?.symbol ?? "").trim() === voteSummary.consensusLeaderSymbol,
        ) ?? null)
  const modelUnavailableDay = isAgreementModelUnavailableForDay({
    checks,
    agreementModelCfg
  })
  const minAgreementScore = num(agreementGateCfg?.minAgreementScore)
  const minConsensusCount = num(agreementGateCfg?.minConsensusCount)
  const minStabilityRate = num(agreementGateCfg?.minStabilityRate)
  const agreementScore = num(gate?.agreementScore ?? top1?.agreementScore)
  const consensusCount = num(gate?.consensusCount ?? top1?.agreementConsensusCount)
  const consensusRate = num(gate?.consensusRate ?? top1?.agreementConsensusRate)
  const stabilityRate = num(gate?.stabilityRate ?? top1?.agreementStabilityRate)
  return {
    enabled: agreementGateCfg?.enabled === true,
    blockedDay: agreementBlocked === true,
    blockedTop1WouldHaveHitDay:
      agreementBlocked === true && top1Path?.blockedTop1WasHit === true,
    modelUnavailableDay,
    checksSource: checkSource.source,
    decision: gate?.decision ?? top1?.agreementDecision ?? null,
    reason: gate?.reason ?? top1?.agreementReason ?? null,
    enforcementMode: gate?.enforcementMode ?? null,
    symbol: String(top1?.symbol ?? "").trim() || null,
    successInWindow: top1?.successInWindow === true,
    rawSimilarityScore: num(top1?.rawSimilarityScore),
    globalStageScore: num(top1?.globalStageScore),
    localStageScore: num(top1?.localStageScore),
    triggerStageScore: num(top1?.triggerStageScore),
    gateScoreMargin: num(top1?.gateScoreMargin),
    agreementScore,
    agreementScoreDelta:
      Number.isFinite(agreementScore) && Number.isFinite(minAgreementScore)
        ? agreementScore - minAgreementScore
        : null,
    consensusCount,
    consensusCountDelta:
      Number.isFinite(consensusCount) && Number.isFinite(minConsensusCount)
        ? consensusCount - minConsensusCount
        : null,
    consensusRate,
    stabilityRate,
    stabilityRateDelta:
      Number.isFinite(stabilityRate) && Number.isFinite(minStabilityRate)
        ? stabilityRate - minStabilityRate
        : null,
    candidateUtility: num(top1?.agreementCandidateUtility),
    expectedNetRet3d: num(top1?.expectedNetRet3d),
    executionScore: num(top1?.executionScore),
    falsePositiveRisk: num(top1?.falsePositiveRisk),
    minAgreementScore,
    minConsensusCount,
    minStabilityRate,
    candidatePool: num(checks?.candidatePool),
    consensusTopN: num(checks?.consensusTopN),
    stabilityTopN: num(checks?.stabilityTopN),
    viewRanks:
      checks?.viewRanks && typeof checks.viewRanks === "object" ? checks.viewRanks : {},
    viewModes,
    scenarioRanks:
      checks?.scenarioRanks && typeof checks.scenarioRanks === "object" ? checks.scenarioRanks : {},
    scenarioWinners:
      checks?.scenarioWinners && typeof checks.scenarioWinners === "object"
        ? checks.scenarioWinners
        : {},
    scenarioModes,
    topAgreementLeaders: voteSummary.topAgreementLeaders,
    agreementVoteCounts: voteSummary.agreementVoteCounts,
    agreementVoteSourceCount: num(voteSummary.agreementVoteSourceCount),
    agreementVoteEntropy: num(voteSummary.agreementVoteEntropy),
    consensusLeaderSymbol: voteSummary.consensusLeaderSymbol,
    consensusLeaderVotes: num(voteSummary.consensusLeaderVotes),
    consensusLeaderVoteShare: num(voteSummary.consensusLeaderVoteShare),
    consensusLeaderMatchesTop1: voteSummary.consensusLeaderMatchesTop1,
    disagreementPattern: voteSummary.disagreementPattern,
    consensusLeaderRank:
      consensusLeaderRow == null
        ? null
        : Math.max(
            1,
            safeRows.findIndex(
              (row) =>
                String(row?.symbol ?? "").trim() === voteSummary.consensusLeaderSymbol,
            ) + 1,
          ),
    top1VsConsensusLeaderScoreDelta:
      consensusLeaderRow == null
        ? null
        : (
            num(top1?.rankerScore ?? top1?.finalScore ?? top1?.score) != null &&
            num(consensusLeaderRow?.rankerScore ?? consensusLeaderRow?.finalScore ?? consensusLeaderRow?.score) != null
          )
          ? num(top1?.rankerScore ?? top1?.finalScore ?? top1?.score) -
            num(consensusLeaderRow?.rankerScore ?? consensusLeaderRow?.finalScore ?? consensusLeaderRow?.score)
          : null
  }
}

const summarizeAgreementGateDiagnostics = ({
  blockedDays,
  blockedTop1WouldHaveHitDays,
  modelUnavailableDays,
  consensusLowDays,
  stabilityLowDays,
  scoreLowDays,
  agreementScoreSamples,
  rawSimilaritySamples,
  localStageSamples,
  triggerStageSamples,
  gateScoreMarginSamples,
  consensusRateSamples,
  stabilityRateSamples,
  blockedHitBucket = null,
  blockedMissBucket = null
}) => {
  const safeBlockedDays = Math.max(0, Number(blockedDays ?? 0) || 0)
  const safeBlockedTop1WouldHaveHitDays = Math.max(
    0,
    Number(blockedTop1WouldHaveHitDays ?? 0) || 0,
  )
  return {
    blockedDays: safeBlockedDays,
    blockedTop1WouldHaveHitDays: safeBlockedTop1WouldHaveHitDays,
    blockedTop1WouldHaveHitRate:
      safeBlockedDays > 0 ? safeBlockedTop1WouldHaveHitDays / safeBlockedDays : 0,
    modelUnavailableDays: Math.max(0, Number(modelUnavailableDays ?? 0) || 0),
    consensusLowDays: Math.max(0, Number(consensusLowDays ?? 0) || 0),
    stabilityLowDays: Math.max(0, Number(stabilityLowDays ?? 0) || 0),
    scoreLowDays: Math.max(0, Number(scoreLowDays ?? 0) || 0),
    blockedTop1Metrics: {
      agreementScore: summarizeNumericSamples(agreementScoreSamples),
      rawSimilarityScore: summarizeNumericSamples(rawSimilaritySamples),
      localStageScore: summarizeNumericSamples(localStageSamples),
      triggerStageScore: summarizeNumericSamples(triggerStageSamples),
      gateScoreMargin: summarizeNumericSamples(gateScoreMarginSamples),
      agreementConsensusRate: summarizeNumericSamples(consensusRateSamples),
      agreementStabilityRate: summarizeNumericSamples(stabilityRateSamples)
    },
    blockedHit: summarizeAgreementBlockedBucket(blockedHitBucket),
    blockedMiss: summarizeAgreementBlockedBucket(blockedMissBucket)
  }
}

const createScoreOriginBucketStats = () => ({
  days: 0,
  tauRankSamples: [],
  top1FinalScoreSamples: [],
  minFinalScoreShortfallSamples: [],
  top1ScoreMarginSamples: [],
  minScoreMarginShortfallSamples: [],
  baseScoreSamples: [],
  postScoreAdjustDeltaSamples: [],
  regimeExpertDeltaSamples: [],
  extendedBiasDeltaSamples: [],
  tradeQualityPriorDeltaSamples: [],
  executionPriorDeltaSamples: [],
  finalScorePreExecutionPriorSamples: [],
  finalScorePostExecutionPriorSamples: [],
  finalScoreAfterRegimeExpertSamples: [],
  regimeExpertMultiplierSamples: [],
  qualityBonusSamples: [],
  winRateBonusSamples: [],
  targetRateBonusSamples: [],
  stopRatePenaltySamples: [],
  antiPenaltySamples: [],
  expectedRetBonusSamples: [],
  eraCoverageBonusSamples: [],
  coveragePenaltySamples: [],
  supportCountPenaltySamples: [],
  supportCountPenaltyRawSamples: [],
  supportCountPenaltyReliefSamples: [],
  supportCountPenaltyReliefSignalSamples: [],
  singleEraConcentrationPenaltyRawSamples: [],
  singleEraConcentrationPenaltyReliefSamples: [],
  singleEraConcentrationPenaltyEvidenceRatioSamples: [],
  singleEraConcentrationPenaltySamples: [],
  singleEraPenaltySamples: [],
  lowEraSupportPenaltySamples: [],
  stopRatePenaltyRawSamples: [],
  stopRatePenaltyReliefSamples: [],
  stopRatePenaltyReliefSignalSamples: [],
  clusterTemporalEraSupportCountSamples: [],
  clusterTemporalEraCoverageRatioSamples: [],
  targetEraCoverageRatioSamples: [],
  clusterTemporalMaxSingleEraShareSamples: [],
  clusterTemporalEffectiveSingleEraShareSamples: [],
  clusterTemporalSingleEraEvidenceCoverageRatioSamples: [],
  clusterTemporalSingleEraEvidenceSupportRatioSamples: [],
  clusterTemporalEffectiveEraCountSamples: [],
  clusterTemporalNormalizedEraEntropySamples: [],
  clusterTemporalSingleEraEvidenceEffectiveEraCountRatioSamples: [],
  clusterTemporalSingleEraEvidenceEntropyRatioSamples: [],
  maxSingleEraShareCapSamples: [],
  minEraSupportCountSamples: [],
  eraSupportShortfallSamples: [],
  eraCoverageShortfallSamples: [],
  singleEraShareExcessSamples: [],
  tradeQualityPriorAdjustmentSamples: [],
  tradeQualityRankerAdjustmentSamples: [],
  tradeQualityRouteResidualSamples: [],
  tradeQualityRegimeResidualSamples: [],
  tradeQualityPrototypeResidualSamples: [],
  executionPriorLowFillPenaltySamples: [],
  executionPriorLowFillPenaltyRawSamples: [],
  executionPriorLowFillPenaltyReliefSamples: [],
  executionPriorSlippagePenaltySamples: [],
  executionPriorSlippagePenaltyRawSamples: [],
  executionPriorSlippagePenaltyReliefSamples: [],
  executionPriorLowLiquidityPenaltySamples: [],
  executionPriorLowLiquidityPenaltyRawSamples: [],
  executionPriorLowLiquidityPenaltyReliefSamples: [],
  executionPriorBlockedOrderPenaltySamples: [],
  executionPriorPositiveAfterCostBonusSamples: [],
  executionPriorNegativeAfterCostPenaltySamples: [],
  failedBreakoutCount20Samples: [],
  gapFillThenContinueScoreSamples: [],
  gapFillThenRevertScoreSamples: [],
  executionFeasibilityScoreSamples: [],
  prototypeFailedBreakoutCount20Samples: [],
  prototypeGapFillThenContinueScoreSamples: [],
  prototypeGapFillThenRevertScoreSamples: [],
  prototypeExecutionFeasibilityScoreSamples: [],
  tradeQualityFeatureAdjustmentSamples: [],
  postAdjustPenaltyAbsSamples: [],
  regimeExpertPenaltyAbsSamples: [],
  extendedBiasPenaltyAbsSamples: [],
  tradeQualityPenaltyAbsSamples: [],
  executionPriorPenaltyAbsSamples: [],
  primaryPathologyCounts: {},
  secondaryPathologyCounts: {},
  primaryPathologySubcomponentCounts: {},
  secondaryPathologySubcomponentCounts: {},
  compositePathologyCounts: {},
  eraSupportPenaltyReasonCounts: {},
  eraSupportPenaltyReasonRawCounts: {}
})

const pickTopCountKey = (counts) =>
  Object.entries(counts && typeof counts === "object" ? counts : {})
    .map(([key, value]) => ({
      key: String(key ?? "").trim(),
      count: Math.max(0, Number(value ?? 0) || 0)
    }))
    .filter((row) => row.key && row.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      return left.key.localeCompare(right.key)
    })[0]?.key ?? null

const recordScoreOriginBucket = ({ bucket, trace }) => {
  if (!bucket || !trace) return
  bucket.days += 1
  pushSplitNumericSample({
    allValues: bucket.tauRankSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.policyContractTauRank
  })
  pushSplitNumericSample({
    allValues: bucket.top1FinalScoreSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.top1FinalScore
  })
  pushSplitNumericSample({
    allValues: bucket.minFinalScoreShortfallSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.minFinalScoreShortfall
  })
  pushSplitNumericSample({
    allValues: bucket.top1ScoreMarginSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.top1ScoreMargin
  })
  pushSplitNumericSample({
    allValues: bucket.minScoreMarginShortfallSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.minScoreMarginShortfall
  })
  pushSplitNumericSample({
    allValues: bucket.baseScoreSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.baseScore
  })
  pushSplitNumericSample({
    allValues: bucket.postScoreAdjustDeltaSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.postScoreAdjustDelta
  })
  pushSplitNumericSample({
    allValues: bucket.regimeExpertDeltaSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.regimeExpertDelta
  })
  pushSplitNumericSample({
    allValues: bucket.extendedBiasDeltaSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.extendedBiasDelta
  })
  pushSplitNumericSample({
    allValues: bucket.tradeQualityPriorDeltaSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.tradeQualityPriorDelta
  })
  pushSplitNumericSample({
    allValues: bucket.executionPriorDeltaSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.executionPriorDelta
  })
  pushSplitNumericSample({
    allValues: bucket.finalScorePreExecutionPriorSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.finalScorePreExecutionPrior
  })
  pushSplitNumericSample({
    allValues: bucket.finalScorePostExecutionPriorSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.finalScorePostExecutionPrior
  })
  pushSplitNumericSample({
    allValues: bucket.finalScoreAfterRegimeExpertSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.finalScoreAfterRegimeExpert
  })
  pushSplitNumericSample({
    allValues: bucket.regimeExpertMultiplierSamples,
    updateValues: [],
    evalValues: [],
    value: trace?.regimeExpertMultiplier
  })
  for (const [bucketKey, traceKey] of [
    ["qualityBonusSamples", "qualityBonus"],
    ["winRateBonusSamples", "winRateBonus"],
    ["targetRateBonusSamples", "targetRateBonus"],
    ["stopRatePenaltySamples", "stopRatePenalty"],
    ["antiPenaltySamples", "antiPenalty"],
    ["expectedRetBonusSamples", "expectedRetBonus"],
    ["eraCoverageBonusSamples", "eraCoverageBonus"],
    ["coveragePenaltySamples", "coveragePenalty"],
    ["supportCountPenaltySamples", "supportCountPenalty"],
    ["supportCountPenaltyRawSamples", "supportCountPenaltyRaw"],
    ["supportCountPenaltyReliefSamples", "supportCountPenaltyRelief"],
    ["supportCountPenaltyReliefSignalSamples", "supportCountPenaltyReliefSignal"],
    ["singleEraConcentrationPenaltyRawSamples", "singleEraConcentrationPenaltyRaw"],
    ["singleEraConcentrationPenaltyReliefSamples", "singleEraConcentrationPenaltyRelief"],
    ["singleEraConcentrationPenaltyEvidenceRatioSamples", "singleEraConcentrationPenaltyEvidenceRatio"],
    ["singleEraConcentrationPenaltySamples", "singleEraConcentrationPenalty"],
    ["singleEraPenaltySamples", "singleEraPenalty"],
    ["lowEraSupportPenaltySamples", "lowEraSupportPenalty"],
    ["stopRatePenaltyRawSamples", "stopRatePenaltyRaw"],
    ["stopRatePenaltyReliefSamples", "stopRatePenaltyRelief"],
    ["stopRatePenaltyReliefSignalSamples", "stopRatePenaltyReliefSignal"],
    ["clusterTemporalEraSupportCountSamples", "clusterTemporalEraSupportCount"],
    ["clusterTemporalEraCoverageRatioSamples", "clusterTemporalEraCoverageRatio"],
    ["targetEraCoverageRatioSamples", "targetEraCoverageRatio"],
    ["clusterTemporalMaxSingleEraShareSamples", "clusterTemporalMaxSingleEraShare"],
    ["clusterTemporalEffectiveSingleEraShareSamples", "clusterTemporalEffectiveSingleEraShare"],
    [
      "clusterTemporalSingleEraEvidenceCoverageRatioSamples",
      "clusterTemporalSingleEraEvidenceCoverageRatio",
    ],
    [
      "clusterTemporalSingleEraEvidenceSupportRatioSamples",
      "clusterTemporalSingleEraEvidenceSupportRatio",
    ],
    ["clusterTemporalEffectiveEraCountSamples", "clusterTemporalEffectiveEraCount"],
    ["clusterTemporalNormalizedEraEntropySamples", "clusterTemporalNormalizedEraEntropy"],
    [
      "clusterTemporalSingleEraEvidenceEffectiveEraCountRatioSamples",
      "clusterTemporalSingleEraEvidenceEffectiveEraCountRatio",
    ],
    [
      "clusterTemporalSingleEraEvidenceEntropyRatioSamples",
      "clusterTemporalSingleEraEvidenceEntropyRatio",
    ],
    ["maxSingleEraShareCapSamples", "maxSingleEraShareCap"],
    ["minEraSupportCountSamples", "minEraSupportCount"],
    ["eraSupportShortfallSamples", "eraSupportShortfall"],
    ["eraCoverageShortfallSamples", "eraCoverageShortfall"],
    ["singleEraShareExcessSamples", "singleEraShareExcess"],
    ["tradeQualityPriorAdjustmentSamples", "tradeQualityPriorAdjustment"],
    ["tradeQualityRankerAdjustmentSamples", "tradeQualityRankerAdjustment"],
    ["tradeQualityRouteResidualSamples", "tradeQualityRouteResidual"],
    ["tradeQualityRegimeResidualSamples", "tradeQualityRegimeResidual"],
    ["tradeQualityPrototypeResidualSamples", "tradeQualityPrototypeResidual"],
    ["tradeQualityFeatureAdjustmentSamples", "tradeQualityFeatureAdjustment"],
    ["executionPriorLowFillPenaltySamples", "executionPriorLowFillPenalty"],
    ["executionPriorLowFillPenaltyRawSamples", "executionPriorLowFillPenaltyRaw"],
    ["executionPriorLowFillPenaltyReliefSamples", "executionPriorLowFillPenaltyRelief"],
    ["executionPriorSlippagePenaltySamples", "executionPriorSlippagePenalty"],
    ["executionPriorSlippagePenaltyRawSamples", "executionPriorSlippagePenaltyRaw"],
    ["executionPriorSlippagePenaltyReliefSamples", "executionPriorSlippagePenaltyRelief"],
    ["executionPriorLowLiquidityPenaltySamples", "executionPriorLowLiquidityPenalty"],
    ["executionPriorLowLiquidityPenaltyRawSamples", "executionPriorLowLiquidityPenaltyRaw"],
    ["executionPriorLowLiquidityPenaltyReliefSamples", "executionPriorLowLiquidityPenaltyRelief"],
    ["executionPriorBlockedOrderPenaltySamples", "executionPriorBlockedOrderPenalty"],
    ["executionPriorPositiveAfterCostBonusSamples", "executionPriorPositiveAfterCostBonus"],
    ["executionPriorNegativeAfterCostPenaltySamples", "executionPriorNegativeAfterCostPenalty"],
    ["failedBreakoutCount20Samples", "failedBreakoutCount20"],
    ["gapFillThenContinueScoreSamples", "gapFillThenContinueScore"],
    ["gapFillThenRevertScoreSamples", "gapFillThenRevertScore"],
    ["executionFeasibilityScoreSamples", "executionFeasibilityScore"],
    ["prototypeFailedBreakoutCount20Samples", "prototypeFailedBreakoutCount20"],
    ["prototypeGapFillThenContinueScoreSamples", "prototypeGapFillThenContinueScore"],
    ["prototypeGapFillThenRevertScoreSamples", "prototypeGapFillThenRevertScore"],
    ["prototypeExecutionFeasibilityScoreSamples", "prototypeExecutionFeasibilityScore"],
    ["postAdjustPenaltyAbsSamples", "componentPenaltyByComponent.POST_ADJUST_HEAVY"],
    ["regimeExpertPenaltyAbsSamples", "componentPenaltyByComponent.REGIME_EXPERT_HEAVY"],
    ["extendedBiasPenaltyAbsSamples", "componentPenaltyByComponent.EXTENDED_BIAS_HEAVY"],
    ["tradeQualityPenaltyAbsSamples", "componentPenaltyByComponent.TRADE_QUALITY_HEAVY"],
    ["executionPriorPenaltyAbsSamples", "componentPenaltyByComponent.EXECUTION_PRIOR_HEAVY"]
  ]) {
    const value =
      traceKey.startsWith("componentPenaltyByComponent.")
        ? trace?.componentPenaltyByComponent?.[traceKey.replace("componentPenaltyByComponent.", "")]
        : trace?.[traceKey]
    pushSplitNumericSample({
      allValues: bucket[bucketKey],
      updateValues: [],
      evalValues: [],
      value
    })
  }
  if (trace?.scorePathologyPrimaryComponent) bump(bucket.primaryPathologyCounts, trace.scorePathologyPrimaryComponent)
  if (trace?.scorePathologySecondaryComponent) bump(bucket.secondaryPathologyCounts, trace.scorePathologySecondaryComponent)
  if (trace?.scorePathologyPrimarySubcomponent) {
    bump(bucket.primaryPathologySubcomponentCounts, trace.scorePathologyPrimarySubcomponent)
  }
  if (trace?.scorePathologySecondarySubcomponent) {
    bump(bucket.secondaryPathologySubcomponentCounts, trace.scorePathologySecondarySubcomponent)
  }
  if (trace?.scorePathologyCompositeType) {
    bump(bucket.compositePathologyCounts, trace.scorePathologyCompositeType)
  }
  if (trace?.eraSupportPenaltyReasonRaw && trace.eraSupportPenaltyReasonRaw !== "NONE") {
    bump(bucket.eraSupportPenaltyReasonRawCounts, trace.eraSupportPenaltyReasonRaw)
  }
  if (trace?.eraSupportPenaltyReason && trace.eraSupportPenaltyReason !== "NONE") {
    bump(bucket.eraSupportPenaltyReasonCounts, trace.eraSupportPenaltyReason)
  }
}

const summarizeScoreOriginBucket = (bucket) => ({
  days: Math.max(0, Number(bucket?.days ?? 0) || 0),
  tauRank: summarizeNumericSamples(bucket?.tauRankSamples),
  top1FinalScore: summarizeNumericSamples(bucket?.top1FinalScoreSamples),
  minFinalScoreShortfall: summarizeNumericSamples(bucket?.minFinalScoreShortfallSamples),
  top1ScoreMargin: summarizeNumericSamples(bucket?.top1ScoreMarginSamples),
  minScoreMarginShortfall: summarizeNumericSamples(bucket?.minScoreMarginShortfallSamples),
  baseScore: summarizeNumericSamples(bucket?.baseScoreSamples),
  postScoreAdjustDelta: summarizeNumericSamples(bucket?.postScoreAdjustDeltaSamples),
  regimeExpertDelta: summarizeNumericSamples(bucket?.regimeExpertDeltaSamples),
  extendedBiasDelta: summarizeNumericSamples(bucket?.extendedBiasDeltaSamples),
  tradeQualityPriorDelta: summarizeNumericSamples(bucket?.tradeQualityPriorDeltaSamples),
  executionPriorDelta: summarizeNumericSamples(bucket?.executionPriorDeltaSamples),
  finalScorePreExecutionPrior: summarizeNumericSamples(bucket?.finalScorePreExecutionPriorSamples),
  finalScorePostExecutionPrior: summarizeNumericSamples(bucket?.finalScorePostExecutionPriorSamples),
  finalScoreAfterRegimeExpert: summarizeNumericSamples(bucket?.finalScoreAfterRegimeExpertSamples),
  regimeExpertMultiplier: summarizeNumericSamples(bucket?.regimeExpertMultiplierSamples),
  qualityBonus: summarizeNumericSamples(bucket?.qualityBonusSamples),
  winRateBonus: summarizeNumericSamples(bucket?.winRateBonusSamples),
  targetRateBonus: summarizeNumericSamples(bucket?.targetRateBonusSamples),
  stopRatePenalty: summarizeNumericSamples(bucket?.stopRatePenaltySamples),
  antiPenalty: summarizeNumericSamples(bucket?.antiPenaltySamples),
  expectedRetBonus: summarizeNumericSamples(bucket?.expectedRetBonusSamples),
  eraCoverageBonus: summarizeNumericSamples(bucket?.eraCoverageBonusSamples),
  coveragePenalty: summarizeNumericSamples(bucket?.coveragePenaltySamples),
  supportCountPenalty: summarizeNumericSamples(bucket?.supportCountPenaltySamples),
  supportCountPenaltyRaw: summarizeNumericSamples(bucket?.supportCountPenaltyRawSamples),
  supportCountPenaltyRelief: summarizeNumericSamples(bucket?.supportCountPenaltyReliefSamples),
  supportCountPenaltyReliefSignal: summarizeNumericSamples(
    bucket?.supportCountPenaltyReliefSignalSamples,
  ),
  singleEraConcentrationPenaltyRaw: summarizeNumericSamples(
    bucket?.singleEraConcentrationPenaltyRawSamples,
  ),
  singleEraConcentrationPenaltyRelief: summarizeNumericSamples(
    bucket?.singleEraConcentrationPenaltyReliefSamples,
  ),
  singleEraConcentrationPenaltyEvidenceRatio: summarizeNumericSamples(
    bucket?.singleEraConcentrationPenaltyEvidenceRatioSamples,
  ),
  singleEraConcentrationPenalty: summarizeNumericSamples(bucket?.singleEraConcentrationPenaltySamples),
  singleEraPenalty: summarizeNumericSamples(bucket?.singleEraPenaltySamples),
  lowEraSupportPenalty: summarizeNumericSamples(bucket?.lowEraSupportPenaltySamples),
  stopRatePenaltyRaw: summarizeNumericSamples(bucket?.stopRatePenaltyRawSamples),
  stopRatePenaltyRelief: summarizeNumericSamples(bucket?.stopRatePenaltyReliefSamples),
  stopRatePenaltyReliefSignal: summarizeNumericSamples(bucket?.stopRatePenaltyReliefSignalSamples),
  clusterTemporalEraSupportCount: summarizeNumericSamples(bucket?.clusterTemporalEraSupportCountSamples),
  clusterTemporalEraCoverageRatio: summarizeNumericSamples(bucket?.clusterTemporalEraCoverageRatioSamples),
  targetEraCoverageRatio: summarizeNumericSamples(bucket?.targetEraCoverageRatioSamples),
  clusterTemporalMaxSingleEraShare: summarizeNumericSamples(bucket?.clusterTemporalMaxSingleEraShareSamples),
  clusterTemporalEffectiveSingleEraShare: summarizeNumericSamples(
    bucket?.clusterTemporalEffectiveSingleEraShareSamples,
  ),
  clusterTemporalSingleEraEvidenceCoverageRatio: summarizeNumericSamples(
    bucket?.clusterTemporalSingleEraEvidenceCoverageRatioSamples,
  ),
  clusterTemporalSingleEraEvidenceSupportRatio: summarizeNumericSamples(
    bucket?.clusterTemporalSingleEraEvidenceSupportRatioSamples,
  ),
  clusterTemporalEffectiveEraCount: summarizeNumericSamples(
    bucket?.clusterTemporalEffectiveEraCountSamples,
  ),
  clusterTemporalNormalizedEraEntropy: summarizeNumericSamples(
    bucket?.clusterTemporalNormalizedEraEntropySamples,
  ),
  clusterTemporalSingleEraEvidenceEffectiveEraCountRatio: summarizeNumericSamples(
    bucket?.clusterTemporalSingleEraEvidenceEffectiveEraCountRatioSamples,
  ),
  clusterTemporalSingleEraEvidenceEntropyRatio: summarizeNumericSamples(
    bucket?.clusterTemporalSingleEraEvidenceEntropyRatioSamples,
  ),
  maxSingleEraShareCap: summarizeNumericSamples(bucket?.maxSingleEraShareCapSamples),
  minEraSupportCount: summarizeNumericSamples(bucket?.minEraSupportCountSamples),
  eraSupportShortfall: summarizeNumericSamples(bucket?.eraSupportShortfallSamples),
  eraCoverageShortfall: summarizeNumericSamples(bucket?.eraCoverageShortfallSamples),
  singleEraShareExcess: summarizeNumericSamples(bucket?.singleEraShareExcessSamples),
  tradeQualityPriorAdjustment: summarizeNumericSamples(bucket?.tradeQualityPriorAdjustmentSamples),
  tradeQualityRankerAdjustment: summarizeNumericSamples(bucket?.tradeQualityRankerAdjustmentSamples),
  tradeQualityRouteResidual: summarizeNumericSamples(bucket?.tradeQualityRouteResidualSamples),
  tradeQualityRegimeResidual: summarizeNumericSamples(bucket?.tradeQualityRegimeResidualSamples),
  tradeQualityPrototypeResidual: summarizeNumericSamples(bucket?.tradeQualityPrototypeResidualSamples),
  tradeQualityFeatureAdjustment: summarizeNumericSamples(bucket?.tradeQualityFeatureAdjustmentSamples),
  executionPriorLowFillPenalty: summarizeNumericSamples(bucket?.executionPriorLowFillPenaltySamples),
  executionPriorLowFillPenaltyRaw: summarizeNumericSamples(bucket?.executionPriorLowFillPenaltyRawSamples),
  executionPriorLowFillPenaltyRelief: summarizeNumericSamples(bucket?.executionPriorLowFillPenaltyReliefSamples),
  executionPriorSlippagePenalty: summarizeNumericSamples(bucket?.executionPriorSlippagePenaltySamples),
  executionPriorSlippagePenaltyRaw: summarizeNumericSamples(bucket?.executionPriorSlippagePenaltyRawSamples),
  executionPriorSlippagePenaltyRelief: summarizeNumericSamples(bucket?.executionPriorSlippagePenaltyReliefSamples),
  executionPriorLowLiquidityPenalty: summarizeNumericSamples(bucket?.executionPriorLowLiquidityPenaltySamples),
  executionPriorLowLiquidityPenaltyRaw: summarizeNumericSamples(bucket?.executionPriorLowLiquidityPenaltyRawSamples),
  executionPriorLowLiquidityPenaltyRelief: summarizeNumericSamples(
    bucket?.executionPriorLowLiquidityPenaltyReliefSamples,
  ),
  executionPriorBlockedOrderPenalty: summarizeNumericSamples(bucket?.executionPriorBlockedOrderPenaltySamples),
  executionPriorPositiveAfterCostBonus: summarizeNumericSamples(bucket?.executionPriorPositiveAfterCostBonusSamples),
  executionPriorNegativeAfterCostPenalty: summarizeNumericSamples(bucket?.executionPriorNegativeAfterCostPenaltySamples),
  failedBreakoutCount20: summarizeNumericSamples(bucket?.failedBreakoutCount20Samples),
  gapFillThenContinueScore: summarizeNumericSamples(bucket?.gapFillThenContinueScoreSamples),
  gapFillThenRevertScore: summarizeNumericSamples(bucket?.gapFillThenRevertScoreSamples),
  executionFeasibilityScore: summarizeNumericSamples(bucket?.executionFeasibilityScoreSamples),
  prototypeFailedBreakoutCount20: summarizeNumericSamples(bucket?.prototypeFailedBreakoutCount20Samples),
  prototypeGapFillThenContinueScore: summarizeNumericSamples(
    bucket?.prototypeGapFillThenContinueScoreSamples,
  ),
  prototypeGapFillThenRevertScore: summarizeNumericSamples(
    bucket?.prototypeGapFillThenRevertScoreSamples,
  ),
  prototypeExecutionFeasibilityScore: summarizeNumericSamples(
    bucket?.prototypeExecutionFeasibilityScoreSamples,
  ),
  postAdjustPenaltyAbs: summarizeNumericSamples(bucket?.postAdjustPenaltyAbsSamples),
  regimeExpertPenaltyAbs: summarizeNumericSamples(bucket?.regimeExpertPenaltyAbsSamples),
  extendedBiasPenaltyAbs: summarizeNumericSamples(bucket?.extendedBiasPenaltyAbsSamples),
  tradeQualityPenaltyAbs: summarizeNumericSamples(bucket?.tradeQualityPenaltyAbsSamples),
  executionPriorPenaltyAbs: summarizeNumericSamples(bucket?.executionPriorPenaltyAbsSamples),
  primaryPathologyCounts: bucket?.primaryPathologyCounts ?? {},
  secondaryPathologyCounts: bucket?.secondaryPathologyCounts ?? {},
  primaryPathologySubcomponentCounts: bucket?.primaryPathologySubcomponentCounts ?? {},
  secondaryPathologySubcomponentCounts: bucket?.secondaryPathologySubcomponentCounts ?? {},
  compositePathologyCounts: bucket?.compositePathologyCounts ?? {},
  eraSupportPenaltyReasonRawCounts: bucket?.eraSupportPenaltyReasonRawCounts ?? {},
  eraSupportPenaltyReasonCounts: bucket?.eraSupportPenaltyReasonCounts ?? {},
  scorePathologyPrimaryComponent: pickTopCountKey(bucket?.primaryPathologyCounts),
  scorePathologySecondaryComponent: pickTopCountKey(bucket?.secondaryPathologyCounts),
  scorePathologyPrimarySubcomponent: pickTopCountKey(bucket?.primaryPathologySubcomponentCounts),
  scorePathologySecondarySubcomponent: pickTopCountKey(bucket?.secondaryPathologySubcomponentCounts),
  scorePathologyCompositeType: pickTopCountKey(bucket?.compositePathologyCounts),
  eraSupportPenaltyReasonRaw: pickTopCountKey(bucket?.eraSupportPenaltyReasonRawCounts),
  eraSupportPenaltyReason: pickTopCountKey(bucket?.eraSupportPenaltyReasonCounts)
})

const summarizeD1GateDiagnostics = ({
  evaluatedDays,
  failedDays,
  topNPassExistsDays,
  top1FailedButAltPassExistsDays,
  top1FailedAndNoAltPassExistsDays,
  altPassWouldHitDays,
  bestPassingRankSamples,
  bestAltPassingRankSamples,
  scoreBelowMinBucket = null,
  scoreMarginLowBucket = null
}) => {
  const safeEvaluatedDays = Math.max(0, Number(evaluatedDays ?? 0) || 0)
  const safeFailedDays = Math.max(0, Number(failedDays ?? 0) || 0)
  const safeTopNPassExistsDays = Math.max(0, Number(topNPassExistsDays ?? 0) || 0)
  const safeAltPassExistsDays = Math.max(0, Number(top1FailedButAltPassExistsDays ?? 0) || 0)
  return {
    evaluatedDays: safeEvaluatedDays,
    failedDays: safeFailedDays,
    topNPassExistsDays: safeTopNPassExistsDays,
    topNPassExistsRate:
      safeEvaluatedDays > 0 ? safeTopNPassExistsDays / safeEvaluatedDays : 0,
    topNPassExistsRateAmongFailedDays:
      safeFailedDays > 0 ? safeAltPassExistsDays / safeFailedDays : 0,
    top1FailedButAltPassExistsDays: safeAltPassExistsDays,
    top1FailedAndNoAltPassExistsDays: Math.max(
      0,
      Number(top1FailedAndNoAltPassExistsDays ?? 0) || 0,
    ),
    altPassWouldHitDays: Math.max(0, Number(altPassWouldHitDays ?? 0) || 0),
    altPassWouldHitRate:
      safeAltPassExistsDays > 0
        ? (Math.max(0, Number(altPassWouldHitDays ?? 0) || 0) / safeAltPassExistsDays)
        : 0,
    bestPassingRank: summarizeNumericSamples(bestPassingRankSamples),
    bestAltPassingRank: summarizeNumericSamples(bestAltPassingRankSamples),
    scoreBelowMin: summarizeScoreOriginBucket(scoreBelowMinBucket),
    scoreMarginLow: summarizeScoreOriginBucket(scoreMarginLowBucket)
  }
}

const createScoreRecoveryTelemetryStats = () => ({
  evaluatedDays: 0,
  eligibleDays: 0,
  wouldTradeDays: 0,
  wouldHitDays: 0,
  gateReasonCounts: {},
  rejectReasonCounts: {},
  finalScoreShortfallSamples: [],
  scoreMarginShortfallSamples: []
})

const createScoreRecalibrationTelemetryStats = () => ({
  evaluatedDays: 0,
  eligibleDays: 0,
  wouldTradeDays: 0,
  wouldHitDays: 0,
  gateReasonCounts: {},
  primaryComponentCounts: {},
  primarySubcomponentCounts: {},
  primaryCompositeTypeCounts: {},
  eraSupportPenaltyReasonCounts: {},
  rejectReasonCounts: {},
  recalibratedFinalScoreDeltaSamples: [],
  recalibratedFinalScoreShortfallSamples: []
})

const recordScoreRecoveryTelemetry = ({ stats, telemetry }) => {
  if (!stats || !telemetry || typeof telemetry !== "object") return
  stats.evaluatedDays += 1
  if (telemetry?.gateReason) bump(stats.gateReasonCounts, telemetry.gateReason)
  for (const reason of Array.isArray(telemetry?.rejectionReasons) ? telemetry.rejectionReasons : []) {
    if (reason) bump(stats.rejectReasonCounts, reason)
  }
  if (telemetry?.eligible === true) stats.eligibleDays += 1
  if (telemetry?.wouldTradeDay === true) stats.wouldTradeDays += 1
  if (telemetry?.wouldHitDay === true) stats.wouldHitDays += 1
  pushSplitNumericSample({
    allValues: stats.finalScoreShortfallSamples,
    updateValues: [],
    evalValues: [],
    value: telemetry?.finalScoreShortfall
  })
  pushSplitNumericSample({
    allValues: stats.scoreMarginShortfallSamples,
    updateValues: [],
    evalValues: [],
    value: telemetry?.scoreMarginShortfall
  })
}

const summarizeScoreRecoveryDiagnostics = (stats) => {
  const evaluatedDays = Math.max(0, Number(stats?.evaluatedDays ?? 0) || 0)
  const eligibleDays = Math.max(0, Number(stats?.eligibleDays ?? 0) || 0)
  const wouldTradeDays = Math.max(0, Number(stats?.wouldTradeDays ?? 0) || 0)
  const wouldHitDays = Math.max(0, Number(stats?.wouldHitDays ?? 0) || 0)
  return {
    evaluatedDays,
    eligibleDays,
    eligibleRate: evaluatedDays > 0 ? eligibleDays / evaluatedDays : 0,
    wouldTradeDays,
    wouldTradeRate: evaluatedDays > 0 ? wouldTradeDays / evaluatedDays : 0,
    wouldHitDays,
    wouldHitRate: eligibleDays > 0 ? wouldHitDays / eligibleDays : 0,
    gateReasonCounts: stats?.gateReasonCounts ?? {},
    rejectReasonCounts: stats?.rejectReasonCounts ?? {},
    finalScoreShortfall: summarizeNumericSamples(stats?.finalScoreShortfallSamples),
    scoreMarginShortfall: summarizeNumericSamples(stats?.scoreMarginShortfallSamples)
  }
}

const recordScoreRecalibrationTelemetry = ({ stats, telemetry }) => {
  if (!stats || !telemetry || typeof telemetry !== "object") return
  stats.evaluatedDays += 1
  if (telemetry?.gateReason) bump(stats.gateReasonCounts, telemetry.gateReason)
  if (telemetry?.primaryComponent) bump(stats.primaryComponentCounts, telemetry.primaryComponent)
  if (telemetry?.primarySubcomponent) {
    bump(stats.primarySubcomponentCounts, telemetry.primarySubcomponent)
  }
  if (telemetry?.compositeType) {
    bump(stats.primaryCompositeTypeCounts, telemetry.compositeType)
  }
  if (telemetry?.eraSupportPenaltyReason && telemetry.eraSupportPenaltyReason !== "NONE") {
    bump(stats.eraSupportPenaltyReasonCounts, telemetry.eraSupportPenaltyReason)
  }
  for (const reason of Array.isArray(telemetry?.rejectionReasons) ? telemetry.rejectionReasons : []) {
    if (reason) bump(stats.rejectReasonCounts, reason)
  }
  if (telemetry?.eligible === true) stats.eligibleDays += 1
  if (telemetry?.wouldTradeDay === true) stats.wouldTradeDays += 1
  if (telemetry?.wouldHitDay === true) stats.wouldHitDays += 1
  pushSplitNumericSample({
    allValues: stats.recalibratedFinalScoreDeltaSamples,
    updateValues: [],
    evalValues: [],
    value: telemetry?.recalibratedFinalScoreDelta
  })
  pushSplitNumericSample({
    allValues: stats.recalibratedFinalScoreShortfallSamples,
    updateValues: [],
    evalValues: [],
    value: telemetry?.recalibratedFinalScoreShortfall
  })
}

const summarizeScoreRecalibrationDiagnostics = (stats) => {
  const evaluatedDays = Math.max(0, Number(stats?.evaluatedDays ?? 0) || 0)
  const eligibleDays = Math.max(0, Number(stats?.eligibleDays ?? 0) || 0)
  const wouldTradeDays = Math.max(0, Number(stats?.wouldTradeDays ?? 0) || 0)
  const wouldHitDays = Math.max(0, Number(stats?.wouldHitDays ?? 0) || 0)
  return {
    evaluatedDays,
    eligibleDays,
    eligibleRate: evaluatedDays > 0 ? eligibleDays / evaluatedDays : 0,
    wouldTradeDays,
    wouldTradeRate: evaluatedDays > 0 ? wouldTradeDays / evaluatedDays : 0,
    wouldHitDays,
    wouldHitRate: eligibleDays > 0 ? wouldHitDays / eligibleDays : 0,
    gateReasonCounts: stats?.gateReasonCounts ?? {},
    primaryComponentCounts: stats?.primaryComponentCounts ?? {},
    primaryComponent: pickTopCountKey(stats?.primaryComponentCounts),
    primarySubcomponentCounts: stats?.primarySubcomponentCounts ?? {},
    primarySubcomponent: pickTopCountKey(stats?.primarySubcomponentCounts),
    primaryCompositeTypeCounts: stats?.primaryCompositeTypeCounts ?? {},
    primaryCompositeType: pickTopCountKey(stats?.primaryCompositeTypeCounts),
    eraSupportPenaltyReasonCounts: stats?.eraSupportPenaltyReasonCounts ?? {},
    eraSupportPenaltyReason: pickTopCountKey(stats?.eraSupportPenaltyReasonCounts),
    rejectReasonCounts: stats?.rejectReasonCounts ?? {},
    recalibratedFinalScoreDelta: summarizeNumericSamples(stats?.recalibratedFinalScoreDeltaSamples),
    recalibratedFinalScoreShortfall: summarizeNumericSamples(stats?.recalibratedFinalScoreShortfallSamples)
  }
}

const isDayTypeModelRejected = ({ modelMeta, applyMode }) => {
  if (modelMeta?.available !== true) return false
  return applyMode === "MODEL_SHADOW" || applyMode === "RULE_ONLY" || applyMode === "RULE_PREFERRED"
}

const mergePerfCounters = (target, src) => {
  if (!target || !src) return
  target.totalCandidatesScored += Number(src?.totalCandidatesScored ?? 0) || 0
  target.totalPrototypes += Number(src?.totalPrototypes ?? 0) || 0
  target.totalPrototypesAfterCoarse += Number(src?.totalPrototypesAfterCoarse ?? 0) || 0
  const coarsePruneRatioSum = Number(src?.coarsePruneRatioSum)
  const coarsePruneRatioCount = Number(src?.coarsePruneRatioCount)
  if (
    Number.isFinite(coarsePruneRatioSum) &&
    Number.isFinite(coarsePruneRatioCount) &&
    coarsePruneRatioCount > 0
  ) {
    target.coarsePruneRatioSum += coarsePruneRatioSum
    target.coarsePruneRatioCount += coarsePruneRatioCount
  } else {
    const coarsePruneRatio = Number(src?.coarsePruneRatio)
    if (Number.isFinite(coarsePruneRatio)) {
      target.coarsePruneRatioSum += coarsePruneRatio
      target.coarsePruneRatioCount += 1
    }
  }
  target.totalPrototypeComparisons += Number(src?.totalPrototypeComparisons ?? 0) || 0
  target.prototypesPrunedByGroupBound += Number(src?.prototypesPrunedByGroupBound ?? 0) || 0
  target.prototypesPrunedByFeatureBound += Number(src?.prototypesPrunedByFeatureBound ?? 0) || 0
  target.totalClusters += Number(src?.totalClusters ?? 0) || 0
  target.totalClustersConsidered += Number(src?.totalClustersConsidered ?? 0) || 0
}

const calcMeanStd = (values) => {
  const nums = (Array.isArray(values) ? values : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
  if (nums.length < 1) return { mean: 0, std: 0 }
  const mean = nums.reduce((acc, v) => acc + v, 0) / nums.length
  const variance = nums.reduce((acc, v) => acc + (v - mean) ** 2, 0) / nums.length
  return {
    mean,
    std: variance > 0 ? Math.sqrt(variance) : 0
  }
}

const summarizeCountMap = (countsMap) => {
  const entries = Array.from((countsMap instanceof Map ? countsMap : new Map()).entries())
    .map(([key, value]) => ({
      key: String(key ?? ""),
      count: Math.max(0, Number(value ?? 0) || 0)
    }))
    .filter((row) => row.count > 0)
  const total = entries.reduce((acc, row) => acc + row.count, 0)
  if (total <= 0) {
    return {
      total: 0,
      distinct: 0,
      entropy: 0,
      effectiveRank: 0
    }
  }
  let entropy = 0
  for (const row of entries) {
    const p = row.count / total
    entropy -= p * Math.log(Math.max(1e-12, p))
  }
  return {
    total,
    distinct: entries.length,
    entropy,
    effectiveRank: Math.exp(entropy)
  }
}

const summarizePrototypeStats = ({ statsMap, totalPrototypeCount }) => {
  const entries = Array.from((statsMap instanceof Map ? statsMap : new Map()).entries())
    .map(([prototypeId, value]) => ({
      prototypeId: String(prototypeId ?? ""),
      pickedCount: Math.max(0, Number(value?.pickedCount ?? 0) || 0),
      pickHitCount: Math.max(0, Number(value?.pickHitCount ?? 0) || 0)
    }))
    .filter((row) => row.pickedCount > 0)
  const pickedCount = entries.reduce((acc, row) => acc + row.pickedCount, 0)
  if (pickedCount <= 0) {
    return {
      pickedCount: 0,
      distinctPrototypeCount: 0,
      usageCoverage: 0,
      top10Share: 0,
      zeroHitShare: 0,
      entropy: 0,
      effectiveRank: 0
    }
  }
  const sorted = entries.slice().sort((a, b) => b.pickedCount - a.pickedCount)
  const top10Picked = sorted.slice(0, 10).reduce((acc, row) => acc + row.pickedCount, 0)
  const zeroHitPicked = sorted
    .filter((row) => row.pickHitCount <= 0)
    .reduce((acc, row) => acc + row.pickedCount, 0)
  let entropy = 0
  for (const row of sorted) {
    const p = row.pickedCount / pickedCount
    entropy -= p * Math.log(Math.max(1e-12, p))
  }
  return {
    pickedCount,
    distinctPrototypeCount: sorted.length,
    usageCoverage:
      Number(totalPrototypeCount) > 0 ? sorted.length / Number(totalPrototypeCount) : 0,
    top10Share: top10Picked / pickedCount,
    zeroHitShare: zeroHitPicked / pickedCount,
    entropy,
    effectiveRank: Math.exp(entropy)
  }
}

const topCountEntries = (counts, limit = 5) =>
  Object.entries(counts && typeof counts === "object" ? counts : {})
    .map(([key, value]) => ({
      key: String(key ?? "").trim(),
      count: Math.max(0, Number(value ?? 0) || 0)
    }))
    .filter((row) => row.key && row.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      return left.key.localeCompare(right.key)
    })
    .slice(0, Math.max(1, Math.floor(Number(limit) || 1)))

const buildScopeDiagnostic = ({
  label,
  tradingDays,
  pickedDays,
  pickedCount,
  pickHitCount,
  pickHitRate,
  executedCount,
  executedHitCount,
  executedHitRate,
  executionCoverage,
  noCandidateDays,
  gateReasonCounts,
  agreementDecisionCounts,
  agreementReasonCounts,
  dayTypeCounts,
  executionDecisionCounts,
  executionShadowReasonCounts,
  falsePositiveDecisionCounts,
  falsePositiveReasonCounts,
  budgetDecisionCounts,
  budgetReasonCounts
}) => {
  const safeTradingDays = Math.max(0, Number(tradingDays ?? 0) || 0)
  const safePickedDays = Math.max(0, Number(pickedDays ?? 0) || 0)
  const safePickedCount = Math.max(0, Number(pickedCount ?? 0) || 0)
  const safePickHitCount = Math.max(0, Number(pickHitCount ?? 0) || 0)
  const safeExecutedCount = Math.max(0, Number(executedCount ?? 0) || 0)
  const safeExecutedHitCount = Math.max(0, Number(executedHitCount ?? 0) || 0)
  const d1TradeDays = Math.max(
    0,
    Number(gateReasonCounts?.TRADE ?? safePickedDays) || 0,
  )
  return {
    label: String(label ?? "UNKNOWN"),
    tradingDays: safeTradingDays,
    pickedDays: safePickedDays,
    pickedCount: safePickedCount,
    pickHitCount: safePickHitCount,
    pickHitRate: Number(pickHitRate ?? (safePickedCount > 0 ? safePickHitCount / safePickedCount : 0)) || 0,
    executedCount: safeExecutedCount,
    executedHitCount: safeExecutedHitCount,
    executedHitRate:
      Number(executedHitRate ?? (safeExecutedCount > 0 ? safeExecutedHitCount / safeExecutedCount : 0)) || 0,
    executionCoverage:
      Number(executionCoverage ?? (safePickedCount > 0 ? safeExecutedCount / safePickedCount : 0)) || 0,
    noCandidateDays: Math.max(0, Number(noCandidateDays ?? 0) || 0),
    d1TradeDays,
    d1BlockedDays: Math.max(0, safeTradingDays - d1TradeDays),
    d2BlockedAfterD1Days: Math.max(0, d1TradeDays - safeExecutedCount),
    topGateReasons: topCountEntries(gateReasonCounts, 5),
    topAgreementDecisions: topCountEntries(agreementDecisionCounts, 5),
    topAgreementReasons: topCountEntries(agreementReasonCounts, 5),
    topDayTypes: topCountEntries(dayTypeCounts, 5),
    topExecutionDecisions: topCountEntries(executionDecisionCounts, 5),
    topExecutionBlockers: topCountEntries(executionShadowReasonCounts, 5),
    topFalsePositiveDecisions: topCountEntries(falsePositiveDecisionCounts, 5),
    topFalsePositiveReasons: topCountEntries(falsePositiveReasonCounts, 5),
    topBudgetDecisions: topCountEntries(budgetDecisionCounts, 5),
    topBudgetReasons: topCountEntries(budgetReasonCounts, 5)
  }
}

const resolveBiasValue = ({ map, key, maxAbs }) => {
  if (!map || typeof map !== "object") return 0
  const safeKey = String(key ?? "").trim()
  if (!safeKey) return 0
  return clampRange(Number(map[safeKey] ?? 0) || 0, -maxAbs, maxAbs)
}

const updateBiasValue = ({ map, key, outcome, cfg }) => {
  if (!map || typeof map !== "object") return
  const safeKey = String(key ?? "").trim()
  if (!safeKey) return
  const maxAbs = clampRange(Number(cfg?.maxAbsBias ?? 0.08) || 0.08, 0, 1)
  const lr = clampRange(Number(cfg?.learningRate ?? 0.01) || 0.01, 0, 1)
  const l2 = clampRange(Number(cfg?.l2Penalty ?? 0.002) || 0.002, 0, 1)
  const prev = clampRange(Number(map[safeKey] ?? 0) || 0, -maxAbs, maxAbs)
  const next = clampRange(prev + lr * (Number(outcome ?? 0) - l2 * prev), -maxAbs, maxAbs)
  map[safeKey] = next
}

const resolveTradeQualityPriorSignal = ({ state, key, cfg }) => {
  const safeKey = String(key ?? "").trim()
  const empty = {
    score: 0,
    count: 0,
    targetRate: 0,
    stopRate: 0,
    timeoutPositiveRate: 0,
    timeoutNegativeRate: 0,
    avgNetRet: 0
  }
  if (!state || typeof state !== "object" || !safeKey) return empty
  const stats = state[safeKey]
  if (!stats || typeof stats !== "object") return empty
  const count = Math.max(0, Math.floor(Number(stats?.count ?? 0) || 0))
  if (count < 1) return empty
  const targetCount = Math.max(0, Number(stats?.targetCount ?? 0) || 0)
  const stopCount = Math.max(0, Number(stats?.stopCount ?? 0) || 0)
  const timeoutPositiveCount = Math.max(
    0,
    Number(stats?.timeoutPositiveCount ?? stats?.positiveCount ?? 0) || 0,
  )
  const timeoutNegativeCount = Math.max(0, Number(stats?.timeoutNegativeCount ?? 0) || 0)
  const netRetSum = Number(stats?.netRetSum ?? 0) || 0
  const priorSamples = Math.max(1, Number(cfg?.priorSamples ?? 8) || 8)
  const maxAbs = clampRange(Number(cfg?.maxAbsAdjustment ?? 0.1) || 0.1, 0, 1)
  const targetRate = clamp01((targetCount + 1) / (count + 2))
  const stopRate = clamp01((stopCount + 1) / (count + 2))
  const timeoutPositiveRate = clamp01((timeoutPositiveCount + 1) / (count + 2))
  const timeoutNegativeRate = clamp01((timeoutNegativeCount + 1) / (count + 2))
  const avgNetRet = netRetSum / Math.max(1, count)
  const sampleWeight = count / (count + priorSamples)
  const rawScore =
    Number(cfg?.targetWeight ?? 0) * ((targetRate - 0.5) * 2) -
    Number(cfg?.stopPenaltyWeight ?? 0) * stopRate +
    Number(cfg?.timeoutPositiveWeight ?? 0) * timeoutPositiveRate -
    Number(cfg?.timeoutNegativePenaltyWeight ?? 0) * timeoutNegativeRate +
    Number(cfg?.netRetWeight ?? 0) *
      clampRange(
        avgNetRet / Math.max(1e-6, Number(cfg?.netRetScale ?? 0.04) || 0.04),
        -1,
        1
      )
  return {
    score: clampRange(sampleWeight * rawScore, -maxAbs, maxAbs),
    count,
    targetRate,
    stopRate,
    timeoutPositiveRate,
    timeoutNegativeRate,
    avgNetRet
  }
}

const resolveTradeQualityPriorAdjustment = ({
  cfg,
  globalSignal,
  routeSignal,
  regimeSignal,
  prototypeSignal,
  candidateFeatureAdjustment = 0
}) => {
  const maxAbs = clampRange(Number(cfg?.maxAbsAdjustment ?? 0.1) || 0.1, 0, 1)
  const globalScore = Number(globalSignal?.score ?? 0) || 0
  const routeScore = Number(routeSignal?.score ?? 0) || 0
  const regimeScore = Number(regimeSignal?.score ?? 0) || 0
  const prototypeScore = Number(prototypeSignal?.score ?? 0) || 0
  const featureAdjustment = clampRange(
    Number(candidateFeatureAdjustment ?? 0) || 0,
    -maxAbs,
    maxAbs,
  )
  const routeResidual = clampRange(routeScore - globalScore, -maxAbs, maxAbs)
  const regimeResidual = clampRange(regimeScore - routeScore, -maxAbs, maxAbs)
  const prototypeResidual = clampRange(prototypeScore - regimeScore, -maxAbs, maxAbs)
  const adjustment = clampRange(
    Number(cfg?.routeBucketWeight ?? 0) * routeResidual +
      Number(cfg?.regimeWeight ?? 0) * regimeResidual +
      Number(cfg?.prototypeWeight ?? 0) * prototypeResidual +
      featureAdjustment,
    -maxAbs,
    maxAbs
  )
  return {
    adjustment,
    globalScore,
    routeResidual,
    regimeResidual,
    prototypeResidual,
    featureAdjustment
  }
}

const resolveTradeQualityFeatureAdjustment = ({ featureVec, cfg }) => {
  const safeVec = featureVec && typeof featureVec === "object" ? featureVec : {}
  const featureCfg = cfg?.featureAdjustment ?? {}
  if (cfg?.enabled !== true || featureCfg?.enabled !== true) {
    return {
      adjustment: 0,
      failedBreakoutCount20: Math.max(0, Number(safeVec?.["shape.failedBreakoutCount20"] ?? 0) || 0),
      gapFillThenContinueScore: clamp01(safeVec?.["gap.fillThenContinueScore"] ?? 0),
      gapFillThenRevertScore: clamp01(safeVec?.["gap.fillThenRevertScore"] ?? 0),
      executionFeasibilityScore: clamp01(safeVec?.["execution.feasibilityScore"] ?? 0),
    }
  }
  const failedBreakoutCount20 = Math.max(0, Number(safeVec?.["shape.failedBreakoutCount20"] ?? 0) || 0)
  const gapFillThenContinueScore = clamp01(safeVec?.["gap.fillThenContinueScore"] ?? 0)
  const gapFillThenRevertScore = clamp01(safeVec?.["gap.fillThenRevertScore"] ?? 0)
  const executionFeasibilityScore = clamp01(safeVec?.["execution.feasibilityScore"] ?? 0)
  const failedBreakoutScale = Math.max(1, Number(featureCfg?.failedBreakoutScale ?? 4) || 4)
  const failedBreakoutPenalty = clampRange(failedBreakoutCount20 / failedBreakoutScale, 0, 1)
  const maxAbs = clampRange(Number(featureCfg?.maxAbsAdjustment ?? 0.03) || 0.03, 0, 1)
  const adjustment = clampRange(
    Number(featureCfg?.gapContinueWeight ?? 0) * gapFillThenContinueScore -
      Number(featureCfg?.gapRevertPenaltyWeight ?? 0) * gapFillThenRevertScore -
      Number(featureCfg?.failedBreakoutPenaltyWeight ?? 0) * failedBreakoutPenalty +
      Number(featureCfg?.executionFeasibilityWeight ?? 0) * executionFeasibilityScore,
    -maxAbs,
    maxAbs,
  )
  return {
    adjustment,
    failedBreakoutCount20,
    gapFillThenContinueScore,
    gapFillThenRevertScore,
    executionFeasibilityScore,
  }
}

const updateTradeQualityPriorState = ({ state, key, tradeOutcome }) => {
  if (!state || typeof state !== "object") return
  const safeKey = String(key ?? "").trim()
  if (!safeKey) return
  const netRet = Number(tradeOutcome?.realizedNetRet)
  if (!Number.isFinite(netRet)) return
  const exitReason = String(tradeOutcome?.realizedExitReason ?? "")
    .trim()
    .toUpperCase()
  const bucket = state[safeKey] ?? {
    count: 0,
    targetCount: 0,
    stopCount: 0,
    timeoutPositiveCount: 0,
    timeoutNegativeCount: 0,
    netRetSum: 0
  }
  bucket.count += 1
  if (exitReason === "TARGET") bucket.targetCount += 1
  if (exitReason === "STOP" || exitReason === "BOTH_HIT_STOP_FIRST") bucket.stopCount += 1
  if (
    exitReason !== "TARGET" &&
    exitReason !== "STOP" &&
    exitReason !== "BOTH_HIT_STOP_FIRST"
  ) {
    if (netRet > 0) bucket.timeoutPositiveCount += 1
    else if (netRet < 0) bucket.timeoutNegativeCount += 1
  }
  bucket.netRetSum += netRet
  state[safeKey] = bucket
}

const releaseRows = (rows) => {
  if (Array.isArray(rows)) rows.length = 0
}

const pushTopK = (top, row, k) => {
  if (!Array.isArray(top)) return
  const limit = Math.max(1, Number(k) || 1)
  let insertAt = top.length
  for (let i = 0; i < top.length; i += 1) {
    if (Number(row?.finalScore ?? 0) > Number(top[i]?.finalScore ?? 0)) {
      insertAt = i
      break
    }
  }
  if (insertAt >= top.length) {
    if (top.length < limit) top.push(row)
    return
  }
  top.splice(insertAt, 0, row)
  if (top.length > limit) top.length = limit
}

const wouldEnterTopK = (top, finalScore, k) => {
  if (!Array.isArray(top)) return false
  const limit = Math.max(1, Number(k) || 1)
  if (top.length < limit) return true
  const floor = Number(top[top.length - 1]?.finalScore ?? Number.NEGATIVE_INFINITY)
  return Number(finalScore ?? 0) > floor
}

const areValuesEqual = (left, right) => {
  if (left === right) return true
  const leftNum = Number(left)
  const rightNum = Number(right)
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
    return Math.abs(leftNum - rightNum) <= 1e-12
  }
  return String(left ?? "") === String(right ?? "")
}

const pushDiffRow = (target, key, configured, effective) => {
  if (areValuesEqual(configured, effective)) return
  target.push({
    key,
    configured,
    effective
  })
}

const findFirstSuccessRank = (rows, limit = Number.POSITIVE_INFINITY) => {
  const ranked = Array.isArray(rows) ? rows : []
  const maxRank = Math.max(1, Math.floor(Number(limit) || 1))
  for (let i = 0; i < ranked.length && i < maxRank; i += 1) {
    if (ranked[i]?.successInWindow === true) return i + 1
  }
  return null
}

const computeBudgetedConversion = ({ pickHitCount, oracleHitDaysTopK, budget }) => {
  const b = Math.max(1, Math.floor(Number(budget) || 1))
  const hitCount = Math.max(0, Number(pickHitCount ?? 0) || 0)
  const oracleHitDays = Math.max(0, Number(oracleHitDaysTopK ?? 0) || 0)
  const denom = Math.min(b, oracleHitDays)
  if (denom <= 0) return 0
  return clamp01(hitCount / denom)
}

const applyDayTypeDecisionToD1 = ({ d1, dayTypeDecision }) => {
  const base = d1 && typeof d1 === "object" ? d1 : {}
  const decision = dayTypeDecision && typeof dayTypeDecision === "object" ? dayTypeDecision : null
  const gateReason = String(decision?.gateReason ?? "DAY_TYPE_NO_TRADE")
  const gateBase = base?.gate && typeof base.gate === "object" ? base.gate : {}
  return {
    ...base,
    picks: [],
    pick: null,
    selectionCount: 0,
    selectedRankerScore: 0,
    gate: {
      ...gateBase,
      gateReason,
      rejectionCounts: {
        ...(gateBase?.rejectionCounts ?? {}),
        [gateReason]: Number(gateBase?.rejectionCounts?.[gateReason] ?? 0) + 1
      },
      dayTypeDecision: decision,
      selectionPolicy: {
        ...(gateBase?.selectionPolicy ?? {}),
        mode: "DAY_TYPE_NO_TRADE",
        applied: false,
        candidatePool: 0,
        chosenRank: null,
        chosenSymbol: null
      }
    }
  }
}

const isUpdateLikePartition = (value) => {
  const text = String(value ?? "").trim().toUpperCase()
  return text === "U" || text === "U+V" || text === "ONLINE" || text === "LOCKBOX_REPLAY"
}

const buildPrecisionCoverageCurve = ({ logs, thresholds }) => {
  const rows = Array.isArray(logs) ? logs : []
  const points = []
  const totalDays = rows.length
  for (const th of thresholds) {
    const t = clamp01(th)
    let tradeCount = 0
    let hitCount = 0
    for (const day of rows) {
      const picks = Array.isArray(day?.pickedList) ? day.pickedList : []
      for (const pick of picks) {
        if (String(pick?.executionDecision ?? "") !== "TRADE") continue
        const pHit = Number(pick?.pHitCalibrated ?? 0)
        if (pHit < t) continue
        tradeCount += 1
        if (pick?.successInWindow === true) hitCount += 1
      }
    }
    points.push({
      threshold: t,
      tradeCount,
      precision: tradeCount > 0 ? hitCount / tradeCount : 0,
      coverage: totalDays > 0 ? tradeCount / totalDays : 0
    })
  }
  return points
}

const buildCalibrationDiagnostics = ({ logs, bins = 10, partition = null }) => {
  const rows = Array.isArray(logs) ? logs : []
  const bucketCount = Math.max(2, Math.floor(Number(bins) || 10))
  const bucketStats = Array.from({ length: bucketCount }, () => ({
    count: 0,
    predSum: 0,
    obsSum: 0
  }))
  const routeStats = new Map()
  const regimeStats = new Map()
  let total = 0
  let eceNumerator = 0
  let rankPairTotal = 0
  let rankPairConsistent = 0
  for (const day of rows) {
    if (partition && String(day?.partition ?? "") !== String(partition)) continue
    const topRows = Array.isArray(day?.topK) ? day.topK : []
    for (let i = 0; i < topRows.length; i += 1) {
      const row = topRows[i]
      const pred = Number(row?.pHitCalibrated)
      if (!Number.isFinite(pred)) continue
      const p = clamp01(pred)
      const obs = row?.successInWindow === true ? 1 : 0
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(p * bucketCount)))
      const bucket = bucketStats[idx]
      bucket.count += 1
      bucket.predSum += p
      bucket.obsSum += obs
      total += 1
      const routeKey = String(row?.routeBucket ?? "UNKNOWN")
      const routeRow = routeStats.get(routeKey) ?? { count: 0, predSum: 0, obsSum: 0 }
      routeRow.count += 1
      routeRow.predSum += p
      routeRow.obsSum += obs
      routeStats.set(routeKey, routeRow)
      const regimeKey = String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN")
      const regimeRow = regimeStats.get(regimeKey) ?? { count: 0, predSum: 0, obsSum: 0 }
      regimeRow.count += 1
      regimeRow.predSum += p
      regimeRow.obsSum += obs
      regimeStats.set(regimeKey, regimeRow)
    }
    for (let i = 0; i < topRows.length; i += 1) {
      const left = topRows[i]
      const pLeft = Number(left?.pHitCalibrated)
      if (!Number.isFinite(pLeft)) continue
      const yLeft = left?.successInWindow === true ? 1 : 0
      for (let j = i + 1; j < topRows.length; j += 1) {
        const right = topRows[j]
        const pRight = Number(right?.pHitCalibrated)
        if (!Number.isFinite(pRight)) continue
        if (Math.abs(pLeft - pRight) < 1e-12) continue
        const yRight = right?.successInWindow === true ? 1 : 0
        const concordant = (pLeft - pRight) * (yLeft - yRight) >= 0
        rankPairTotal += 1
        if (concordant) rankPairConsistent += 1
      }
    }
  }
  const buckets = bucketStats.map((row, idx) => {
    const predMean = row.count > 0 ? row.predSum / row.count : 0
    const obsMean = row.count > 0 ? row.obsSum / row.count : 0
    eceNumerator += row.count * Math.abs(predMean - obsMean)
    return {
      index: idx,
      count: row.count,
      predMean,
      obsMean
    }
  })
  const filled = buckets.filter((row) => row.count > 0).sort((a, b) => a.predMean - b.predMean)
  let monotonicViolations = 0
  for (let i = 1; i < filled.length; i += 1) {
    if (filled[i].obsMean + 1e-12 < filled[i - 1].obsMean) monotonicViolations += 1
  }
  const route = Array.from(routeStats.entries())
    .map(([key, row]) => ({
      routeBucket: key,
      count: row.count,
      predMean: row.count > 0 ? row.predSum / row.count : 0,
      obsMean: row.count > 0 ? row.obsSum / row.count : 0
    }))
    .sort((a, b) => String(a.routeBucket).localeCompare(String(b.routeBucket)))
  const regime = Array.from(regimeStats.entries())
    .map(([key, row]) => ({
      regimeTag: key,
      count: row.count,
      predMean: row.count > 0 ? row.predSum / row.count : 0,
      obsMean: row.count > 0 ? row.obsSum / row.count : 0
    }))
    .sort((a, b) => String(a.regimeTag).localeCompare(String(b.regimeTag)))
  return {
    sampleCount: total,
    bins: bucketCount,
    ece: total > 0 ? eceNumerator / total : 0,
    monotonicViolations,
    monotonicPass: monotonicViolations === 0,
    rankConsistency: rankPairTotal > 0 ? rankPairConsistent / rankPairTotal : 0,
    rankPairTotal,
    rankPairConsistent,
    buckets,
    route,
    regime
  }
}

const resolveScorerVersion = (raw) => {
  const text = String(raw ?? "v2_exact").trim().toLowerCase()
  if (text === "v2_exact") return "v2_exact"
  throw new Error(`Unsupported similarity.scorerVersion: ${raw}. Supported: v2_exact`)
}

const resolveRuntimeHybridParams = (runtimeMeta) => {
  const stageWeights = runtimeMeta?.stageWeights
  const global = Number(stageWeights?.global)
  const local = Number(stageWeights?.local)
  const trigger = Number(stageWeights?.trigger)
  if (![global, local, trigger].every((v) => Number.isFinite(v) && v >= 0)) {
    throw new Error("Invalid runtime stageWeights. Expected finite >= 0 for global/local/trigger.")
  }
  if (!(global > 0) || !(local > 0)) {
    throw new Error("Invalid runtime stageWeights. global/local must be > 0.")
  }
  if (global + local + trigger <= 0) {
    throw new Error("Invalid runtime stageWeights sum. Expected > 0.")
  }
  const coarseTopN = Number(runtimeMeta?.coarseTopN)
  if (!Number.isInteger(coarseTopN) || coarseTopN < 1) {
    throw new Error(`Invalid runtime coarseTopN: ${runtimeMeta?.coarseTopN}`)
  }
  const coarseTopClusters = Number(runtimeMeta?.coarseTopClusters)
  if (!Number.isInteger(coarseTopClusters) || coarseTopClusters < 1) {
    throw new Error(`Invalid runtime coarseTopClusters: ${runtimeMeta?.coarseTopClusters}`)
  }
  return {
    stageWeights: { global, local, trigger },
    coarseTopN,
    coarseTopClusters
  }
}

const resolveAbsPath = (cwd, rawPath) => {
  const text = String(rawPath ?? "").trim()
  if (!text) return ""
  return path.isAbsolute(text) ? text : path.resolve(cwd, text)
}

const buildFileFingerprint = async (filePath) => {
  const absPath = String(filePath ?? "").trim()
  if (!absPath) return null
  try {
    const st = await stat(absPath)
    return {
      path: absPath,
      size: Number(st?.size ?? 0) || 0,
      mtimeMs: Math.floor(Number(st?.mtimeMs ?? 0) || 0),
    }
  } catch {
    return {
      path: absPath,
      missing: true,
    }
  }
}

const linkOrCopyFileWithDir = async (fromPath, toPath) => {
  const src = String(fromPath ?? "").trim()
  const dst = String(toPath ?? "").trim()
  if (!src || !dst) return
  if (src === dst) return
  await ensureDir(path.dirname(dst))
  await unlink(dst).catch(() => {})
  try {
    await link(src, dst)
    return
  } catch {
    // fall through
  }
  try {
    const relativeTarget = path.relative(path.dirname(dst), src)
    await symlink(relativeTarget, dst)
    return
  } catch {
    // fall through
  }
  await copyFile(src, dst)
}

export const runStepD = async (ctx) => {
  ctx.__runtime = ctx.__runtime ?? {}
  const runtime = ctx.__runtime
  const outDir =
    String(runtime?.stepDOutputDirOverride ?? "").trim() || path.join(ctx.runDir, "step-d")
  await ensureDir(outDir)
  const writebackTraceEnabled =
    ctx?.__runtime?.stepDWritebackTrace === true && ctx?.__runtime?.disableWritebacks !== true
  const writebackTracePath = writebackTraceEnabled
    ? path.join(outDir, "step_d_writeback_trace.jsonl")
    : ""
  const appendWritebackTrace = async (stage, extra = {}) => {
    if (!writebackTraceEnabled || !writebackTracePath) return
    const payload = {
      ts: new Date().toISOString(),
      stage: String(stage ?? ""),
      runId: String(ctx?.runId ?? ""),
      ...extra,
    }
    await appendFile(writebackTracePath, `${JSON.stringify(payload)}\n`)
  }
  const logsPath = path.join(outDir, "daily_online_logs.jsonl")
  const candidateIndexPath = path.join(outDir, "decision_candidates_index.jsonl")
  const candidateIndexMetaPath = path.join(outDir, "decision_candidates_index_meta.json")
  const featurePackPath = path.join(outDir, "decision_candidates_feature_pack.jsonl")
  const sampledDebugPath = path.join(outDir, "sampled_debug_eval_top5.jsonl")
  const featurePackMetaPath = path.join(outDir, "decision_candidates_feature_pack_meta.json")
  const perfPath = path.join(outDir, "perf_counters.json")
  const weightsPath = path.join(outDir, "weights_final.json")
  const summaryPath = path.join(outDir, "step_d_summary.json")
  const policyStatePath = path.join(outDir, "step_d_policy_state.json")
  const policyBundlePath = path.join(outDir, "step_d_policy_bundle.json")
  const artifactManifestPath = path.join(outDir, "step_d_artifact_manifest.json")
  const d1RankedCandidatesPath = path.join(outDir, "d1_ranked_candidates.jsonl")
  const d2ExecutionAuditPath = path.join(outDir, "d2_execution_audit.jsonl")
  const d1LockboxRankedCandidatesPath = path.join(outDir, "d1_lockbox_ranked_candidates.jsonl")
  const d2LockboxExecutionAuditPath = path.join(outDir, "d2_lockbox_execution_audit.jsonl")
  const falsePositiveDatasetPath = path.join(outDir, "false_positive_dataset.jsonl")
  const falsePositiveDatasetMetaPath = path.join(outDir, "false_positive_dataset_meta.json")
  const adversarialReplayDatasetPath = path.join(outDir, "adversarial_replay_dataset.jsonl")
  const adversarialReplayDatasetMetaPath = path.join(outDir, "adversarial_replay_dataset_meta.json")
  const agreementDatasetPath = path.join(outDir, "agreement_dataset.jsonl")
  const agreementDatasetMetaPath = path.join(outDir, "agreement_dataset_meta.json")
  const dayTypeDatasetPath = path.join(outDir, "day_type_dataset.jsonl")
  const dayTypeDatasetMetaPath = path.join(outDir, "day_type_dataset_meta.json")
  const latestValidatedTradeOutcomes = await loadLatestValidatedTradeOutcomeLookup(ctx)
  const stepCLibraryDir =
    String(runtime?.stepCLibraryDirOverride ?? "").trim() || path.join(ctx.runDir, "step-c")
  const libraryPath = path.join(stepCLibraryDir, "pattern_library.json")
  const runtimePath = path.join(stepCLibraryDir, "pattern_library_runtime.json")

  const sharedStepCRuntime = ctx.__runtime?.stepCRuntimeArtifacts ?? null
  const canReuseSharedStepC =
    sharedStepCRuntime &&
    typeof sharedStepCRuntime === "object" &&
    sharedStepCRuntime?.libraryObject &&
    sharedStepCRuntime?.runtimeMetaObject &&
    (
      ctx.__runtime?.reuseStepCRuntimeAcrossRunDirs === true ||
      (
        String(sharedStepCRuntime?.libraryPath ?? "").trim() === libraryPath &&
        String(sharedStepCRuntime?.runtimePath ?? "").trim() === runtimePath
      )
    )
  const library = canReuseSharedStepC
    ? sharedStepCRuntime.libraryObject
    : await readJson(libraryPath, null)
  if (!library) {
    throw new Error("pattern_library.json not found. Run step-c first.")
  }
  const runtimeMeta = canReuseSharedStepC
    ? sharedStepCRuntime.runtimeMetaObject
    : await readJson(runtimePath, null)
  if (!runtimeMeta) {
    throw new Error("pattern_library_runtime.json not found. Run step-c first.")
  }
  if (String(runtimeMeta?.mode ?? "").trim().toLowerCase() !== "hybrid_150_40") {
    throw new Error(`Unsupported runtime mode: ${runtimeMeta?.mode}. Expected: hybrid_150_40`)
  }
  ctx.__runtime.stepCRuntimeArtifacts = {
    libraryPath,
    runtimePath,
    libraryObject: library,
    runtimeMetaObject: runtimeMeta
  }

  if (!library?.weights || typeof library.weights !== "object") {
    throw new Error("pattern_library.weights is required. Re-run step-c.")
  }
  const excludedGroups = resolveExcludedFeatureGroups(ctx, library, runtimeMeta)
  const initialWeights = applyLockedZeroWeights(normalize(library.weights), excludedGroups)
  const asOfShift = resolveAsOfShift(ctx.config.template?.featureAsOf)
  const localWindow = resolveLocalWindow(ctx.config)
  const globalWindow = resolveGlobalWindow(ctx.config)
  const minWindow = Math.max(localWindow, globalWindow)
  if (Number(runtimeMeta?.localWindow) !== localWindow) {
    throw new Error(
      `pattern_library_runtime localWindow mismatch: runtime=${runtimeMeta?.localWindow} config=${localWindow}`,
    )
  }
  if (Number(runtimeMeta?.globalWindow) !== globalWindow) {
    throw new Error(
      `pattern_library_runtime globalWindow mismatch: runtime=${runtimeMeta?.globalWindow} config=${globalWindow}`,
    )
  }
  const runtimeHybrid = resolveRuntimeHybridParams(runtimeMeta)
  const runtimePrototypeCountForScoring = Math.max(
    0,
    Number(
      runtimeMeta?.runtimePrototypeCount ??
      runtimeMeta?.prototypeQuality?.length ??
      library?.prototypes?.length ??
      0,
    ) || 0,
  )
  const runtimeClusterCountForScoring = Math.max(
    0,
    Number(
      runtimeMeta?.runtimeClusterCount ??
      runtimeMeta?.clusterCenters?.length ??
      library?.globalClusters?.length ??
      0,
    ) || 0,
  )
  const adaptiveCoarseBudgetCfg = ctx.config?.similarity?.adaptiveCoarseBudget ?? {}
  const adaptiveCoarseBudgetEnabled = adaptiveCoarseBudgetCfg?.enabled === true
  const adaptiveCoarseBudgetOnlyWhenDegenerate = adaptiveCoarseBudgetCfg?.onlyWhenDegenerate !== false
  const similarityTopK = Math.max(1, Number(ctx.config?.similarity?.topK ?? 10) || 10)
  const adaptiveCoarsePrototypeShare = clampRange(
    Number(adaptiveCoarseBudgetCfg?.prototypeShare ?? 0.4) || 0.4,
    0.05,
    1,
  )
  const adaptiveCoarseMinTopN = Math.max(
    1,
    Number(adaptiveCoarseBudgetCfg?.minTopN ?? similarityTopK) || similarityTopK,
  )
  const adaptiveCoarseTopKHeadroom = Math.max(
    0,
    Number(adaptiveCoarseBudgetCfg?.topKHeadroom ?? 8) || 8,
  )
  const coarseBudgetDegenerate =
    runtimePrototypeCountForScoring > 0 && runtimeHybrid.coarseTopN >= runtimePrototypeCountForScoring
  let effectiveCoarseTopN = runtimeHybrid.coarseTopN
  if (
    adaptiveCoarseBudgetEnabled &&
    runtimePrototypeCountForScoring > 0 &&
    (!adaptiveCoarseBudgetOnlyWhenDegenerate || coarseBudgetDegenerate)
  ) {
    const derivedCoarseTopN = Math.min(
      runtimePrototypeCountForScoring,
      Math.max(
        adaptiveCoarseMinTopN,
        Math.min(runtimePrototypeCountForScoring, similarityTopK + adaptiveCoarseTopKHeadroom),
        Math.ceil(runtimePrototypeCountForScoring * adaptiveCoarsePrototypeShare),
      ),
    )
    effectiveCoarseTopN = Math.max(1, Math.min(runtimeHybrid.coarseTopN, derivedCoarseTopN))
  }
  const effectiveRuntimeHybrid = {
    ...runtimeHybrid,
    coarseTopN: effectiveCoarseTopN,
    coarseTopClusters: runtimeHybrid.coarseTopClusters
  }
  const coarseBudgetAutoTightened = effectiveRuntimeHybrid.coarseTopN < runtimeHybrid.coarseTopN
  if (coarseBudgetDegenerate || coarseBudgetAutoTightened) {
    console.warn(
      `[step-d] coarse runtime budget configured=${runtimeHybrid.coarseTopN} effective=${effectiveRuntimeHybrid.coarseTopN} runtimePrototypes=${runtimePrototypeCountForScoring} adaptive=${adaptiveCoarseBudgetEnabled}`,
    )
  }
  const stepDLightCfg = ctx.config?.lightweight?.stepD ?? {}
  const stepDExecutionProfileEnv = String(
    process.env.STEP_D_EXECUTION_PROFILE_OVERRIDE ?? "",
  )
    .trim()
    .toLowerCase()
  const stepDExecutionProfileRaw = String(
    stepDExecutionProfileEnv ||
      ctx.__runtime?.stepDProfileOverride ||
      ctx.__runtime?.stepDExecutionProfileOverride ||
      stepDLightCfg?.executionProfile ||
      "full_audit",
  )
    .trim()
    .toLowerCase()
  const stepDExecutionProfile =
    stepDExecutionProfileRaw === "fast_online"
      ? "FAST_ONLINE"
      : stepDExecutionProfileRaw === "lockbox_audit_only"
        ? "LOCKBOX_AUDIT_ONLY"
        : stepDExecutionProfileRaw === "c1_family_probe"
          ? "C1_FAMILY_PROBE"
        : "FULL_AUDIT"
  const fastStepDExecution =
    stepDExecutionProfile === "FAST_ONLINE" || stepDExecutionProfile === "C1_FAMILY_PROBE"
  const lockboxOnlyStepDExecution = stepDExecutionProfile === "LOCKBOX_AUDIT_ONLY"
  const c1FamilyProbeExecution = stepDExecutionProfile === "C1_FAMILY_PROBE"
  const c1FrozenProbe = c1FamilyProbeExecution
  const writebacksDisabled = runtime?.disableWritebacks === true || c1FrozenProbe
  const persistOnlineFeaturePackRows = stepDLightCfg.persistOnlineFeaturePackRows === true
  const persistOnlineAuditArtifacts =
    !fastStepDExecution ||
    stepDLightCfg.persistOnlineAuditArtifactsInFastMode !== false
  const prepareLockboxDuringStepDEnvRaw = String(
    process.env.STEP_D_PREPARE_LOCKBOX_OVERRIDE ?? "",
  )
    .trim()
    .toLowerCase()
  const prepareLockboxDuringStepDEnv =
    prepareLockboxDuringStepDEnvRaw === ""
      ? undefined
      : (prepareLockboxDuringStepDEnvRaw === "1" ||
        prepareLockboxDuringStepDEnvRaw === "true" ||
        prepareLockboxDuringStepDEnvRaw === "yes")
  const prepareLockboxDuringStepDConfigured =
    prepareLockboxDuringStepDEnv ??
    ctx.__runtime?.stepDPrepareLockboxDuringStepDOverride ??
    stepDLightCfg.prepareLockboxDuringStepD !== false
  const prepareLockboxDuringStepD =
    lockboxOnlyStepDExecution ||
    (
      prepareLockboxDuringStepDConfigured &&
      (!fastStepDExecution || c1FamilyProbeExecution)
    )
  const persistLearningDatasets = !fastStepDExecution && !lockboxOnlyStepDExecution
  const probeScopeRequestedRaw = String(runtime?.probeScopeOverride ?? "").trim()
  const probeScopeRequested = probeScopeRequestedRaw ? resolvePromotionScope(probeScopeRequestedRaw) : null
  const artifactPolicyCfg = ctx.config?.lightweight?.artifactPolicy ?? {}
  const artifactTierRaw = String(artifactPolicyCfg?.tier ?? "exploratory")
    .trim()
    .toLowerCase()
  const artifactTier =
    artifactTierRaw === "promotion" || artifactTierRaw === "confirm"
      ? artifactTierRaw
      : "exploratory"
  const artifactTierCfg = artifactPolicyCfg?.[artifactTier] ?? {}
  const writeFeaturePackRows =
    (artifactTierCfg?.writeFeaturePackRows ?? stepDLightCfg.writeFeaturePackRows) !== false
  const writeDailyLogs =
    (artifactTierCfg?.writeDailyLogs ?? stepDLightCfg.writeDailyLogs) !== false &&
    persistLearningDatasets
  const writeDecisionCandidatesIndex =
    (artifactTierCfg?.writeDecisionCandidatesIndex ?? stepDLightCfg.writeDecisionCandidatesIndex) !==
      false && persistLearningDatasets
  const sampledDebugRaw = stepDLightCfg.sampledDebugLog ?? {}
  const sampledDebugEnabled =
    (artifactTierCfg?.writeSampledDebug ?? sampledDebugRaw?.enabled) === true
  const sampledDebugEvalOnly = sampledDebugRaw?.evalOnly !== false
  const sampledDebugSelectedOrRejectedOnly = sampledDebugRaw?.selectedOrRejectedOnly !== false
  const sampledDebugTopK = Math.max(
    10,
    Math.floor(Number(sampledDebugRaw?.topK ?? 10) || 10),
  )
  const overrideGuardRaw = stepDLightCfg.overrideGuard ?? {}
  const overrideGuardEnabled = overrideGuardRaw?.enabled !== false
  const failOnConfigDiff = overrideGuardEnabled && overrideGuardRaw?.failOnConfigDiff !== false
  const failOnRuntimeDiff = overrideGuardEnabled && overrideGuardRaw?.failOnRuntimeDiff !== false
  const allowedConfigDiffKeys = new Set(
    (Array.isArray(overrideGuardRaw?.allowedConfigDiffKeys) ? overrideGuardRaw.allowedConfigDiffKeys : [])
      .map((key) => String(key ?? "").trim())
      .filter(Boolean),
  )
  const allowedRuntimeDiffKeys = new Set(
    (Array.isArray(overrideGuardRaw?.allowedRuntimeDiffKeys) ? overrideGuardRaw.allowedRuntimeDiffKeys : [])
      .map((key) => String(key ?? "").trim())
      .filter(Boolean),
  )
  const reuseRuntimeCache = stepDLightCfg.reuseRuntimeCache === true
  const keepWorkerPoolAlive = stepDLightCfg.keepWorkerPoolAlive === true
  const cpuCount = resolveCpuCount()
  const requestedWorkersRaw = Number(stepDLightCfg.scoringWorkers ?? 1)
  const requestedWorkers = Number.isFinite(requestedWorkersRaw) ? requestedWorkersRaw : 1
  const scoringWorkers = requestedWorkers === 0
    ? Math.max(1, cpuCount - 1)
    : Math.max(1, Math.floor(requestedWorkers))
  const workerChunkSizeRaw = Number(stepDLightCfg.workerChunkSize ?? 256)
  const workerChunkSize = Number.isInteger(workerChunkSizeRaw) && workerChunkSizeRaw > 0
    ? workerChunkSizeRaw
    : 256
  const lockboxArtifactCacheRaw = stepDLightCfg.lockboxArtifactCache ?? {}
  const lockboxArtifactCacheEnabled = lockboxArtifactCacheRaw?.enabled === true
  const lockboxArtifactCacheDirRaw = String(
    lockboxArtifactCacheRaw?.cacheDir ?? "artifacts/cache/stepd_lockbox",
  ).trim()
  const lockboxArtifactCacheDir =
    lockboxArtifactCacheDirRaw || "artifacts/cache/stepd_lockbox"

  const lockboxCacheEligible =
    lockboxArtifactCacheEnabled &&
    prepareLockboxDuringStepD === true &&
    writeFeaturePackRows === true &&
    persistOnlineFeaturePackRows !== true

  const lockboxCacheFingerprint = lockboxCacheEligible
    ? {
        version: PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
        period: ctx.periods.lockbox,
        localWindow,
        globalWindow,
        minWindow,
        asOfShift,
        perfectPrototypeFeatureSurface: PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
        filters: ctx.config?.filters ?? {},
        featureAsOf: ctx.config?.template?.featureAsOf ?? null,
        dataFiles: {
          candleDaily: await buildFileFingerprint(
            resolveAbsPath(ctx.cwd, ctx.config?.dataPaths?.candleDailyJsonl),
          ),
          universeDaily: await buildFileFingerprint(
            resolveAbsPath(ctx.cwd, ctx.config?.dataPaths?.universeJsonl),
          ),
          symbolMaster: await buildFileFingerprint(
            resolveAbsPath(ctx.cwd, ctx.config?.dataPaths?.symbolMasterJsonl),
          ),
        },
      }
    : null

  const lockboxArtifactCacheKey = lockboxCacheEligible
    ? createHash("sha1").update(JSON.stringify(lockboxCacheFingerprint)).digest("hex")
    : null
  const lockboxArtifactCacheBaseDir = lockboxCacheEligible
    ? path.resolve(ctx.cwd, lockboxArtifactCacheDir, lockboxArtifactCacheKey)
    : null
  const cachedLockboxFeaturePackPath = lockboxArtifactCacheBaseDir
    ? path.join(lockboxArtifactCacheBaseDir, "decision_candidates_feature_pack.jsonl")
    : null
  const cachedLockboxFeaturePackMetaPath = lockboxArtifactCacheBaseDir
    ? path.join(lockboxArtifactCacheBaseDir, "decision_candidates_feature_pack_meta.json")
    : null

  let lockboxArtifactCacheHit =
    lockboxCacheEligible &&
    pathExists(cachedLockboxFeaturePackPath) &&
    pathExists(cachedLockboxFeaturePackMetaPath)
  if (lockboxArtifactCacheHit) {
    const cachedMeta = await readJson(cachedLockboxFeaturePackMetaPath, null)
    const cachedRows = Math.max(
      0,
      Number(cachedMeta?.rowsPersisted ?? cachedMeta?.rowsComputed ?? cachedMeta?.rows ?? 0) || 0,
    )
    const cachedPackStat = await stat(cachedLockboxFeaturePackPath).catch(() => null)
    if (cachedRows <= 0 || !cachedPackStat || Number(cachedPackStat?.size ?? 0) <= 0) {
      lockboxArtifactCacheHit = false
    }
  }
  const prepareLockboxDuringStepDEffective =
    prepareLockboxDuringStepD && !lockboxArtifactCacheHit
  const lockboxCacheWriteDirect =
    lockboxCacheEligible &&
    !lockboxArtifactCacheHit &&
    persistOnlineFeaturePackRows !== true &&
    !!cachedLockboxFeaturePackPath &&
    !!cachedLockboxFeaturePackMetaPath
  const featurePackWriteTargetPath = lockboxCacheWriteDirect
    ? cachedLockboxFeaturePackPath
    : featurePackPath
  const featurePackMetaWriteTargetPath = lockboxCacheWriteDirect
    ? cachedLockboxFeaturePackMetaPath
    : featurePackMetaPath
  const candidateIndexPeriod = lockboxOnlyStepDExecution
    ? ctx.periods.lockbox
    : prepareLockboxDuringStepD
    ? mergePeriods(ctx.periods.online, ctx.periods.lockbox)
    : ctx.periods.online

  const runtimeCacheKey = JSON.stringify({
    dataPaths: ctx.config.dataPaths,
    sequenceWindow: minWindow,
    asOfShift,
    candidateIndexPeriod,
    filters: ctx.config.filters
  })
  let seriesMap = null
  let universeMap = null
  let symbolMap = null
  let allDateKeys = null
  let tradingDates = null
  let decisionCandidatesByDate = null
  let seriesFeatureCacheBySymbol = null
  let runtimeCacheHit = false

  const cached = ctx.__runtime?.stepDCache
  if (
    reuseRuntimeCache &&
    cached &&
    cached.key === runtimeCacheKey
  ) {
    runtimeCacheHit = true
    seriesMap = cached.seriesMap
    universeMap = cached.universeMap
    symbolMap = cached.symbolMap
    allDateKeys = cached.allDateKeys
    tradingDates = cached.tradingDates
    decisionCandidatesByDate = cached.decisionCandidatesByDate
    seriesFeatureCacheBySymbol = cached.seriesFeatureCacheBySymbol ?? new Map()
  } else {
    const data = await loadStepDEData(ctx.config.dataPaths, {
      includeHourly60m: false
    })
    seriesMap = buildCandleSeriesMap(data.candles)
    universeMap = buildUniverseMap(data.universe)
    symbolMap = buildSymbolMasterMap(data.symbolMaster)
    allDateKeys = uniqueSortedDateKeys(data.candles, "dateKey")
    tradingDates = allDateKeys.filter((d) => isInRange(d, ctx.periods.online))
    seriesFeatureCacheBySymbol = new Map()
    decisionCandidatesByDate = buildDecisionCandidateIndex({
      period: candidateIndexPeriod,
      sequenceWindow: minWindow,
      asOfShift,
      seriesMap,
      symbolMap,
      universeMap,
      filtersCfg: ctx.config.filters
    })
    releaseRows(data.candles)
    releaseRows(data.universe)
    releaseRows(data.symbolMaster)
    releaseRows(data.hourly60m)
    if (reuseRuntimeCache) {
      ctx.__runtime = ctx.__runtime ?? {}
      ctx.__runtime.stepDCache = {
        key: runtimeCacheKey,
        seriesMap,
        universeMap,
        symbolMap,
        allDateKeys,
        tradingDates,
        decisionCandidatesByDate,
        seriesFeatureCacheBySymbol
      }
    }
  }
  const tradingDateSet = new Set((tradingDates ?? []).map((d) => String(d)))

  const initialWeightResolved = await resolveInitialWeights({
    ctx,
    defaults: initialWeights,
    excludedGroups
  })
  let weights = { ...initialWeightResolved.weights }
  const topK = Math.max(1, Number(ctx.config.similarity.topK ?? 10))
  const scorerVersion = resolveScorerVersion(ctx.config.similarity?.scorerVersion)
  const scoreOptions = buildScoreOptions(ctx.config.similarity?.earlyAbandon)
  const postScoreAdjustCfg = resolvePostScoreAdjust(ctx.config.similarity?.postScoreAdjust)
  const decisionGateCfg = resolveDecisionGate({
    ...ctx.config.decisionGate,
    minTradeScore: ctx.config.similarity?.minTradeScore
  })
  const perfectPrototypeGateCfg = decisionGateCfg?.perfectPrototypeGate ?? {}
  const perfectPrototypeGateStats = createPerfectPrototypeGateStats(perfectPrototypeGateCfg)
  let perfectPrototypeCatalog = null
  if (isPerfectPrototypeGateActive(perfectPrototypeGateCfg)) {
    const rawCatalogPath = String(perfectPrototypeGateCfg?.catalogPath ?? "").trim()
    if (!rawCatalogPath) {
      throw new Error("decisionGate.perfectPrototypeGate.catalogPath is required when gate mode is annotate|hard")
    }
    const resolvedCatalogPath = path.isAbsolute(rawCatalogPath)
      ? rawCatalogPath
      : path.resolve(ctx.cwd, rawCatalogPath)
    perfectPrototypeCatalog = await loadPerfectPrototypeCatalog(resolvedCatalogPath, {
      expectedCatalogSha256:
        String(perfectPrototypeGateCfg?.expectedCatalogSha256 ?? "").trim() || null,
      expectedRuleIdsSha256:
        String(perfectPrototypeGateCfg?.expectedRuleIdsSha256 ?? "").trim() || null,
      requireFrozen: true,
    })
    perfectPrototypeGateStats.catalogPath = perfectPrototypeCatalog.path
    perfectPrototypeGateStats.loadedCatalogSha256 =
      perfectPrototypeCatalog?.freeze?.catalogContentSha256 ?? null
    perfectPrototypeGateStats.loadedRuleIdsSha256 =
      perfectPrototypeCatalog?.freeze?.ruleIdsSha256 ?? null
  }
  const executionGateCfg = resolveExecutionGate(ctx.config?.decisionGate?.executionGate)
  const falsePositiveGateCfg = resolveFalsePositiveGate(ctx.config?.decisionGate?.falsePositiveGate)
  const falsePositiveModelCfg = resolveFalsePositiveModelConfig(
    ctx.config?.decisionGate?.falsePositiveGate?.model ??
      ctx.config?.decisionGate?.falsePositiveModel,
  )
  const agreementGateModelCfg = resolveAgreementModelConfig(
    ctx.config?.decisionGate?.agreementGate?.model,
  )
  const dayTypeRouterCfg = resolveDayTypeRouter(ctx.config?.decisionGate?.dayTypeRouter)
  const dayTypeModelCfg = resolveDayTypeModelConfig(
    ctx.config?.decisionGate?.dayTypeRouter?.model ??
      ctx.config?.decisionGate?.dayTypeModel,
  )
  const opportunityBudgetCfg = resolveOpportunityBudget(ctx.config?.decisionGate?.opportunityBudget)
  const calibrationCfg = resolveCalibrationConfig(ctx.config?.decisionGate?.calibration)
  const metaSelectorCfg = resolveMetaSelectorConfig(ctx.config?.decisionGate?.metaSelector)
  const regimeExpertsCfg = resolveRegimeExpertsConfig(ctx.config?.decisionGate?.regimeExperts)
  const orderSimulatorCfg = resolveOrderSimulatorConfig(ctx.config?.decisionGate?.orderSimulator)
  const regimeRouterCfg = resolveRegimeRouterConfig(ctx.config?.decisionGate?.regimeRouter)
  const generalizationCfg = resolveGeneralizationConfig(ctx.config?.onlineLearning?.generalization)
  const adaptiveMinFinalCfg = resolveAdaptiveMinFinalConfig({
    baseMinFinalScore: Number(decisionGateCfg?.minFinalScore ?? 0),
    raw: ctx.config?.decisionGate?.adaptiveMinFinalScore
  })
  const coarsePruneHealthCfg = resolveCoarsePruneHealthConfig(
    ctx.config?.similarity?.coarsePruneHealth,
  )
  const uvSplit = buildUvSplit({
    tradingDates,
    cfg: generalizationCfg
  })
  weights = enforceWeightRegularization({
    weights,
    lockedGroups: excludedGroups,
    cfg: generalizationCfg
  })
  // Regime router with online learning is supported by recalculating route contexts on weight updates.
  const routeWeightsByBucket = new Map()
  const routeWeightSources = {}
  for (const [bucket, rawPath] of Object.entries(regimeRouterCfg.weightsByBucket ?? {})) {
    const absPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.cwd, rawPath)
    const loaded = await readJson(absPath, null)
    if (!loaded?.weights || typeof loaded.weights !== "object") {
      throw new Error(`decisionGate.regimeRouter.weightsByBucket invalid weights: ${bucket} -> ${absPath}`)
    }
    const routeWeights = enforceWeightRegularization({
      weights: applyLockedZeroWeights(normalize(loaded.weights), excludedGroups),
      lockedGroups: excludedGroups,
      cfg: generalizationCfg
    })
    routeWeightsByBucket.set(String(bucket), routeWeights)
    routeWeightSources[String(bucket)] = absPath
  }
  const updateDateSet = uvSplit.updateDateSet
  const evalDateSet = uvSplit.evalDateSet
  const pickedControlDays = Math.max(
    1,
    Math.max(generalizationCfg?.targetPickedControlDays ?? 0, tradingDates.length),
  )
  let adaptiveMinFinalOffset = 0
  let adaptiveMinFinalAdjustments = 0
  let adaptiveMinFinalTightenCount = 0
  let adaptiveMinFinalLoosenCount = 0
  let pairwiseUpdateCount = 0
  let hardNegativeUpdateCount = 0
  let negativeOnlyUpdateCount = 0
  let onlineDayIndex = 0
  let updateDaysSeen = 0
  let evalDaysSeen = 0
  const prototypeQualityLookup = buildPrototypeQualityLookup({
    library,
    runtimeMeta
  })
  const eventThreshold = Number(ctx.config.event.highJumpThreshold ?? 0.08)
  const highJumpMode = resolveHighJumpMode(ctx.config.event?.highJumpMode)
  const hitWindowDays = Math.max(1, Number(decisionGateCfg?.hitWindowDays ?? 3) || 3)
  const useStopLoss = decisionGateCfg?.hitEval?.useStopLoss !== false
  const stopLossPct = Math.max(
    0,
    Number(decisionGateCfg?.hitEval?.stopLossPct ?? ctx.config?.backtest?.stopLossPct ?? 0.04) || 0.04,
  )
  const sameDayTiePolicy = String(decisionGateCfg?.hitEval?.sameDayTiePolicy ?? "STOP_WINS")
    .trim()
    .toUpperCase()
  const feedbackEntryRule = resolveEntryRule(ctx.config?.backtest?.entry)
  const feedbackHoldDays = Math.max(1, Number(ctx.config?.backtest?.holdDays ?? 3) || 3)
  const feedbackTargetPct = Number(ctx.config?.backtest?.targetPct ?? 0.08)
  const feedbackStopLossPct = Number(ctx.config?.backtest?.stopLossPct ?? 0.04)
  const goalMode = String(ctx.config?.backtest?.goalMode ?? "LEGACY_PNL_V1")
    .trim()
    .toUpperCase()
  const positionSemantics = String(ctx.config?.backtest?.positionSemantics ?? "SINGLE_POSITION_V1")
    .trim()
    .toUpperCase()
  const feedbackFeeBps = Math.max(0, Number(ctx.config?.backtest?.feeBps ?? 0) || 0)
  const feedbackSlippageBps = Math.max(0, Number(ctx.config?.backtest?.slippageBps ?? 0) || 0)
  const feedbackRoundtripCostPct = (feedbackFeeBps + feedbackSlippageBps) / 10000
  const jumpMetaCacheKey = JSON.stringify({
    eventThreshold,
    highJumpMode,
    hitWindowDays,
    useStopLoss,
    stopLossPct,
    sameDayTiePolicy
  })
  let jumpMetaBySeedKey =
    reuseRuntimeCache &&
    runtimeCacheHit &&
    cached?.jumpMetaCacheKey === jumpMetaCacheKey &&
    cached?.jumpMetaBySeedKey instanceof Map
      ? cached.jumpMetaBySeedKey
      : new Map()
  const logs = []
  const sampledDebugLogs = []
  const falsePositiveDatasetRows = []
  const adversarialReplayRows = []
  const agreementDatasetRows = []
  const dayTypeDatasetRows = []
  if (reuseRuntimeCache) {
    ctx.__runtime = ctx.__runtime ?? {}
    ctx.__runtime.stepDCache = {
      key: runtimeCacheKey,
      seriesMap,
      universeMap,
      symbolMap,
      allDateKeys,
      tradingDates,
      decisionCandidatesByDate,
      seriesFeatureCacheBySymbol,
      jumpMetaCacheKey,
      jumpMetaBySeedKey
    }
  }
  let sampledDebugRows = 0
  const featurePackLookupByDate = new Map()
  const pickedRegimeStats = new Map()
  const executedRegimeStats = new Map()
  const pickedPrototypeStats = new Map()
  const pickedPrototypeStatsUpdate = new Map()
  const pickedPrototypeStatsEval = new Map()
  const pickedClusterCounts = new Map()
  const pickedClusterCountsUpdate = new Map()
  const pickedClusterCountsEval = new Map()
  const updateRegimeOutcomeStats = new Map()
  const routeBiasState = {}
  const regimeBiasState = {}
  const prototypeBiasState = {}
  const globalTradeQualityState = {}
  const routeTradeQualityState = {}
  const regimeTradeQualityState = {}
  const prototypeTradeQualityState = {}
  let agreementGateModel = createEmptyAgreementGateModel({ cfg: agreementGateModelCfg })
  let falsePositiveModel = createEmptyFalsePositiveModel({ cfg: falsePositiveModelCfg })
  let dayTypeModel = createEmptyDayTypeModel({ cfg: dayTypeModelCfg })
  let pickedDays = 0
  let dayHitDays = 0
  let pickedCount = 0
  let pickHitCount = 0
  let pickStopCount = 0
  let pickTimeoutCount = 0
  let pickTimeoutNegativeCount = 0
  let executedDays = 0
  let executedCount = 0
  let executedHitCount = 0
  let executedStopCount = 0
  let executedTimeoutCount = 0
  let executedTimeoutNegativeCount = 0
  let executionDecisionDays = 0
  let executionShadowDays = 0
  let executionShadowOnlyDays = 0
  let executionBlockedDays = 0
  let executionBlockedOnlyDays = 0
  let pickedDaysUpdate = 0
  let dayHitDaysUpdate = 0
  let pickedCountUpdate = 0
  let pickHitCountUpdate = 0
  let pickStopCountUpdate = 0
  let pickTimeoutCountUpdate = 0
  let pickTimeoutNegativeCountUpdate = 0
  let executedDaysUpdate = 0
  let executedCountUpdate = 0
  let executedHitCountUpdate = 0
  let executedStopCountUpdate = 0
  let executedTimeoutCountUpdate = 0
  let executedTimeoutNegativeCountUpdate = 0
  let executionShadowDaysUpdate = 0
  let executionShadowOnlyDaysUpdate = 0
  let executionBlockedDaysUpdate = 0
  let executionBlockedOnlyDaysUpdate = 0
  let pickedDaysEval = 0
  let dayHitDaysEval = 0
  let pickedCountEval = 0
  let pickHitCountEval = 0
  let pickStopCountEval = 0
  let pickTimeoutCountEval = 0
  let pickTimeoutNegativeCountEval = 0
  let executedDaysEval = 0
  let executedCountEval = 0
  let executedHitCountEval = 0
  let executedStopCountEval = 0
  let executedTimeoutCountEval = 0
  let executedTimeoutNegativeCountEval = 0
  let executionShadowDaysEval = 0
  let executionShadowOnlyDaysEval = 0
  let executionBlockedDaysEval = 0
  let executionBlockedOnlyDaysEval = 0
  let twoPickDaysEval = 0
  const pickedRegimeStatsEval = new Map()
  const executedRegimeStatsEval = new Map()
  // Oracle upper bounds: feasibility diagnostics for hit-rate targets at fixed recommendation volume.
  // Universe = any scored candidate on that day. TopK = candidates that survive retrieval (similarity.topK).
  let oracleCandidateDays = 0
  let oracleHitDaysUniverse = 0
  let oracleHitDaysTopK = 0
  let oracleMissedByTopKDays = 0
  let oracleCandidateDaysUpdate = 0
  let oracleHitDaysUniverseUpdate = 0
  let oracleHitDaysTopKUpdate = 0
  let oracleMissedByTopKDaysUpdate = 0
  let oracleCandidateDaysEval = 0
  let oracleHitDaysUniverseEval = 0
  let oracleHitDaysTopKEval = 0
  let oracleMissedByTopKDaysEval = 0
  let winnerChangedAfterSimilarityGateDays = 0
  let winnerChangedAfterSimilarityGateDaysUpdate = 0
  let winnerChangedAfterSimilarityGateDaysEval = 0
  let top1RejectedBySimilarityGateDays = 0
  let top1RejectedBySimilarityGateDaysUpdate = 0
  let top1RejectedBySimilarityGateDaysEval = 0
  let oracleHitRejectedBySimilarityGateDays = 0
  let oracleHitRejectedBySimilarityGateDaysUpdate = 0
  let oracleHitRejectedBySimilarityGateDaysEval = 0
  let featurePackRowsPersisted = 0
  let featurePackRowsPersistedOnline = 0
  let featurePackRowsPersistedLockbox = 0
  let featurePackRowsComputed = 0
  let featurePackRowsComputedOnline = 0
  let featurePackRowsComputedLockbox = 0
  let skippedByGate = 0
  const gateReasonCounts = {}
  const gateReasonCountsUpdate = {}
  const gateReasonCountsEval = {}
  let d1GateEvaluatedDays = 0
  let d1GateEvaluatedDaysUpdate = 0
  let d1GateEvaluatedDaysEval = 0
  let d1GateFailedDays = 0
  let d1GateFailedDaysUpdate = 0
  let d1GateFailedDaysEval = 0
  let d1TopNPassExistsDays = 0
  let d1TopNPassExistsDaysUpdate = 0
  let d1TopNPassExistsDaysEval = 0
  let d1Top1FailedButAltPassExistsDays = 0
  let d1Top1FailedButAltPassExistsDaysUpdate = 0
  let d1Top1FailedButAltPassExistsDaysEval = 0
  let d1Top1FailedAndNoAltPassExistsDays = 0
  let d1Top1FailedAndNoAltPassExistsDaysUpdate = 0
  let d1Top1FailedAndNoAltPassExistsDaysEval = 0
  let d1AltPassWouldHitDays = 0
  let d1AltPassWouldHitDaysUpdate = 0
  let d1AltPassWouldHitDaysEval = 0
  const d1BestPassingRankSamples = []
  const d1BestPassingRankSamplesUpdate = []
  const d1BestPassingRankSamplesEval = []
  const d1BestAltPassingRankSamples = []
  const d1BestAltPassingRankSamplesUpdate = []
  const d1BestAltPassingRankSamplesEval = []
  const d1ScoreBelowMinStats = createScoreOriginBucketStats()
  const d1ScoreBelowMinStatsUpdate = createScoreOriginBucketStats()
  const d1ScoreBelowMinStatsEval = createScoreOriginBucketStats()
  const d1ScoreMarginLowStats = createScoreOriginBucketStats()
  const d1ScoreMarginLowStatsUpdate = createScoreOriginBucketStats()
  const d1ScoreMarginLowStatsEval = createScoreOriginBucketStats()
  const scoreRecoveryStats = createScoreRecoveryTelemetryStats()
  const scoreRecoveryStatsUpdate = createScoreRecoveryTelemetryStats()
  const scoreRecoveryStatsEval = createScoreRecoveryTelemetryStats()
  const scoreRecalibrationStats = createScoreRecalibrationTelemetryStats()
  const scoreRecalibrationStatsUpdate = createScoreRecalibrationTelemetryStats()
  const scoreRecalibrationStatsEval = createScoreRecalibrationTelemetryStats()
  let d1ObservedTauRank = null
  const dayTypeCounts = {}
  const dayTypeCountsUpdate = {}
  const dayTypeCountsEval = {}
  const dayTypePolicySourceCounts = {}
  const dayTypePolicySourceCountsUpdate = {}
  const dayTypePolicySourceCountsEval = {}
  const agreementDecisionCounts = {}
  const agreementDecisionCountsUpdate = {}
  const agreementDecisionCountsEval = {}
  const agreementReasonCounts = {}
  const agreementReasonCountsUpdate = {}
  const agreementReasonCountsEval = {}
  let agreementBlockedDays = 0
  let agreementBlockedDaysUpdate = 0
  let agreementBlockedDaysEval = 0
  let agreementBlockedTop1WouldHaveHitDays = 0
  let agreementBlockedTop1WouldHaveHitDaysUpdate = 0
  let agreementBlockedTop1WouldHaveHitDaysEval = 0
  let agreementModelUnavailableDays = 0
  let agreementModelUnavailableDaysUpdate = 0
  let agreementModelUnavailableDaysEval = 0
  let agreementConsensusLowDays = 0
  let agreementConsensusLowDaysUpdate = 0
  let agreementConsensusLowDaysEval = 0
  let agreementStabilityLowDays = 0
  let agreementStabilityLowDaysUpdate = 0
  let agreementStabilityLowDaysEval = 0
  let agreementScoreLowDays = 0
  let agreementScoreLowDaysUpdate = 0
  let agreementScoreLowDaysEval = 0
  const agreementBlockedAgreementScoreSamples = []
  const agreementBlockedAgreementScoreSamplesUpdate = []
  const agreementBlockedAgreementScoreSamplesEval = []
  const agreementBlockedRawSimilaritySamples = []
  const agreementBlockedRawSimilaritySamplesUpdate = []
  const agreementBlockedRawSimilaritySamplesEval = []
  const agreementBlockedLocalStageSamples = []
  const agreementBlockedLocalStageSamplesUpdate = []
  const agreementBlockedLocalStageSamplesEval = []
  const agreementBlockedTriggerStageSamples = []
  const agreementBlockedTriggerStageSamplesUpdate = []
  const agreementBlockedTriggerStageSamplesEval = []
  const agreementBlockedGateScoreMarginSamples = []
  const agreementBlockedGateScoreMarginSamplesUpdate = []
  const agreementBlockedGateScoreMarginSamplesEval = []
  const agreementBlockedConsensusRateSamples = []
  const agreementBlockedConsensusRateSamplesUpdate = []
  const agreementBlockedConsensusRateSamplesEval = []
  const agreementBlockedStabilityRateSamples = []
  const agreementBlockedStabilityRateSamplesUpdate = []
  const agreementBlockedStabilityRateSamplesEval = []
  const agreementBlockedHitStats = createAgreementBlockedBucketStats()
  const agreementBlockedHitStatsUpdate = createAgreementBlockedBucketStats()
  const agreementBlockedHitStatsEval = createAgreementBlockedBucketStats()
  const agreementBlockedMissStats = createAgreementBlockedBucketStats()
  const agreementBlockedMissStatsUpdate = createAgreementBlockedBucketStats()
  const agreementBlockedMissStatsEval = createAgreementBlockedBucketStats()
  let dayTypeNoTradeCount = 0
  let dayTypeNoTradeCountUpdate = 0
  let dayTypeNoTradeCountEval = 0
  let dayTypeNoTradeHitCount = 0
  let dayTypeNoTradeHitCountUpdate = 0
  let dayTypeNoTradeHitCountEval = 0
  let dayTypeModelOverrideCount = 0
  let dayTypeModelOverrideCountUpdate = 0
  let dayTypeModelOverrideCountEval = 0
  let dayTypeModelAgreeCount = 0
  let dayTypeModelRejectedCount = 0
  let dayTypeModelShadowCount = 0
  let dayTypeModelShadowCountUpdate = 0
  let dayTypeModelShadowCountEval = 0
  let dayTypeModelShadowNoTradeCount = 0
  let dayTypeModelShadowNoTradeCountUpdate = 0
  let dayTypeModelShadowNoTradeCountEval = 0
  const dayTypeModelApplyModeCounts = {}
  const dayTypeModelApplyModeCountsUpdate = {}
  const dayTypeModelApplyModeCountsEval = {}
  const dayTypeModelShadowReasonCounts = {}
  const dayTypeModelShadowReasonCountsUpdate = {}
  const dayTypeModelShadowReasonCountsEval = {}
  const dayTypeModelConfidenceBucketCounts = {}
  const dayTypeModelConfidenceBucketCountsUpdate = {}
  const dayTypeModelConfidenceBucketCountsEval = {}
  const selectionFunnelCounts = {}
  const selectionFunnelCountsUpdate = {}
  const selectionFunnelCountsEval = {}
  const executionDecisionCounts = {}
  const executionDecisionCountsUpdate = {}
  const executionDecisionCountsEval = {}
  const executionShadowReasonCounts = {}
  const executionShadowReasonCountsUpdate = {}
  const executionShadowReasonCountsEval = {}
  const falsePositiveDecisionCounts = {}
  const falsePositiveDecisionCountsUpdate = {}
  const falsePositiveDecisionCountsEval = {}
  const falsePositiveReasonCounts = {}
  const falsePositiveReasonCountsUpdate = {}
  const falsePositiveReasonCountsEval = {}
  let preFalsePositiveApprovedCount = 0
  let preFalsePositiveApprovedCountUpdate = 0
  let preFalsePositiveApprovedCountEval = 0
  let falsePositiveRejectedCount = 0
  let falsePositiveRejectedCountUpdate = 0
  let falsePositiveRejectedCountEval = 0
  let falsePositiveRejectedHitCount = 0
  let falsePositiveRejectedHitCountUpdate = 0
  let falsePositiveRejectedHitCountEval = 0
  let falsePositiveRejectedMissCount = 0
  let falsePositiveRejectedMissCountUpdate = 0
  let falsePositiveRejectedMissCountEval = 0
  let falsePositiveModelAvailableCount = 0
  let falsePositiveModelAvailableCountUpdate = 0
  let falsePositiveModelAvailableCountEval = 0
  const budgetDecisionCounts = {}
  const budgetDecisionCountsUpdate = {}
  const budgetDecisionCountsEval = {}
  const budgetReasonCounts = {}
  const budgetReasonCountsUpdate = {}
  const budgetReasonCountsEval = {}
  let budgetRejectedCount = 0
  let budgetRejectedCountUpdate = 0
  let budgetRejectedCountEval = 0
  let budgetRejectedHitCount = 0
  let budgetRejectedHitCountUpdate = 0
  let budgetRejectedHitCountEval = 0
  let budgetRejectedMissCount = 0
  let budgetRejectedMissCountUpdate = 0
  let budgetRejectedMissCountEval = 0
  const metaDecisionCounts = {}
  const metaDiagnosticDecisionCounts = {}
  const metaDiagnosticReasonCounts = {}
  let regretSum = 0
  let regretCount = 0
  let regretSumUpdate = 0
  let regretCountUpdate = 0
  let regretSumEval = 0
  let regretCountEval = 0
  let rankLossDays = 0
  let rankLossDaysUpdate = 0
  let rankLossDaysEval = 0
  let rankLossSum = 0
  let rankLossSumUpdate = 0
  let rankLossSumEval = 0
  let rankLossMax = 0
  let firstPickCount = 0
  let firstPickHitCount = 0
  let secondPickCount = 0
  let secondPickHitCount = 0
  let pickExpectedNetRet3dSum = 0
  let pickMaxWindowJumpPctSum = 0
  let pickMaxWindowJumpPctCount = 0
  let pickMaxWindowJumpPctMax = null
  let pickMaxWindowJumpPctSumEval = 0
  let pickMaxWindowJumpPctCountEval = 0
  let pickMaxWindowJumpPctMaxEval = null
  let executedMaxWindowJumpPctSum = 0
  let executedMaxWindowJumpPctCount = 0
  let executedMaxWindowJumpPctMax = null
  let executedMaxWindowJumpPctSumEval = 0
  let executedMaxWindowJumpPctCountEval = 0
  let executedMaxWindowJumpPctMaxEval = null
  let firstPickExpectedNetRet3dSum = 0
  let secondPickExpectedNetRet3dSum = 0
  let onePickDayExpectedNetRet3dSum = 0
  let dualPickDayExpectedNetRet3dSum = 0
  let onePickDays = 0
  let dualPickDays = 0
  let secondBeatFirstDays = 0
  let secondPickEvaluatedDays = 0
  let secondPickAcceptedDays = 0
  let explorationDecisionDays = 0
  let explorationAppliedDays = 0
  let explorationExploreDays = 0
  let explorationPropensitySum = 0
  let explorationEpsilonSum = 0
  let coverageRecoveryDays = 0
  let coverageRecoveryHitDays = 0
  let agreementFallbackDays = 0
  let agreementFallbackDaysUpdate = 0
  let agreementFallbackDaysEval = 0
  let agreementFallbackHitDays = 0
  let agreementFallbackHitDaysUpdate = 0
  let agreementFallbackHitDaysEval = 0
  let agreementFallbackExecutedDays = 0
  let agreementFallbackExecutedDaysUpdate = 0
  let agreementFallbackExecutedDaysEval = 0
  let agreementFallbackExecutedHitDays = 0
  let agreementFallbackExecutedHitDaysUpdate = 0
  let agreementFallbackExecutedHitDaysEval = 0
  let agreementFallbackHitAt1OverlapDays = 0
  let agreementFallbackHitAt1OverlapDaysUpdate = 0
  let agreementFallbackHitAt1OverlapDaysEval = 0
  let inversionSwapDays = 0
  let top1RerankAppliedDays = 0
  let agreementRerankAppliedDays = 0
  let rankableDays = 0
  let rankableDaysUpdate = 0
  let rankableDaysEval = 0
  let hitAt1Days = 0
  let hitAt1DaysUpdate = 0
  let hitAt1DaysEval = 0
  let hitAt3Days = 0
  let hitAt3DaysUpdate = 0
  let hitAt3DaysEval = 0
  let hitAt5Days = 0
  let hitAt5DaysUpdate = 0
  let hitAt5DaysEval = 0
  let firstSuccessRankSum = 0
  let firstSuccessRankCount = 0
  let firstSuccessRankSumUpdate = 0
  let firstSuccessRankCountUpdate = 0
  let firstSuccessRankSumEval = 0
  let firstSuccessRankCountEval = 0
  let gateRejectedHitDays = 0
  let gateRejectedHitDaysUpdate = 0
  let gateRejectedHitDaysEval = 0
  let executionRejectedHitDays = 0
  let executionRejectedHitDaysUpdate = 0
  let executionRejectedHitDaysEval = 0
  let feedbackQueuedCount = 0
  let feedbackAppliedCount = 0
  let feedbackAppliedDelayDaysSum = 0
  let feedbackAppliedDelayDaysMax = 0
  let feedbackPendingCountMax = 0
  let feedbackNoUpdateCount = 0
  const feedbackNoUpdateReasonCounts = {}
  let feedbackUpdatesSkipped = false
  let executionFeedbackSkipped = false
  let lookaheadViolations = 0
  let executionFeedbackQueuedCount = 0
  let executionFeedbackAppliedCount = 0
  let executionFeedbackAppliedDelayDaysSum = 0
  let executionFeedbackAppliedDelayDaysMax = 0
  let executionFeedbackPendingCountMax = 0
  let executionFeedbackSkippedByEvalCount = 0
  let executionLookaheadViolations = 0
  let executionCalibrationGlobalCount = 0
  let executionCalibrationGlobalHitCount = 0
  const executionCalibrationRegimeStats = new Map()
  const executionCalibrationAppliedHistory = []
  let falsePositiveGlobalCount = 0
  let falsePositiveFailureCount = 0
  const falsePositiveRouteStats = new Map()
  const falsePositiveRegimeStats = new Map()
  const falsePositivePrototypeStats = new Map()
  const falsePositiveAppliedHistory = []
  const secondRejectReasonCounts = {}
  const secondShadowRejectReasonCounts = {}
  const tradingDateIndexByKey = new Map((tradingDates ?? []).map((dateKey, idx) => [String(dateKey), idx]))
  const workerPoolEnabled = scoringWorkers > 1
  const similarityDisambiguationCfg = decisionGateCfg?.similarityDisambiguation ?? {}
  const similarityDisambiguationEnabled = similarityDisambiguationCfg?.enabled === true
  const negativePrototypesForScoring = Array.isArray(library?.negativePrototypes)
    ? library.negativePrototypes
    : []
  let sparseActiveGroups = buildActiveGroupsFromWeights({ weights, excludedGroups })
  const routeActiveGroupsByBucket = new Map()
  for (const [bucket, routeWeights] of routeWeightsByBucket.entries()) {
    routeActiveGroupsByBucket.set(
      String(bucket),
      buildActiveGroupsFromWeights({ weights: routeWeights, excludedGroups }),
    )
  }
  const routeUsageCounts = {}
  const routeMissingWeightCounts = {}
  let scorerContext =
    scorerVersion === "v2_exact" && !workerPoolEnabled
      ? buildScorerContext({
          prototypes: library.prototypes,
          featureStats: library.featureStats,
          globalFeatureStats: library.globalFeatureStats,
          weights,
          activeGroups: sparseActiveGroups,
          scoreOptions,
          stageWeights: effectiveRuntimeHybrid.stageWeights,
          coarseTopN: effectiveRuntimeHybrid.coarseTopN,
          coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters,
          clusterCenters: runtimeMeta?.clusterCenters ?? library?.globalClusters
        })
      : null
  let negativeScorerContext =
    scorerVersion === "v2_exact" &&
    !workerPoolEnabled &&
    similarityDisambiguationEnabled === true &&
    negativePrototypesForScoring.length > 0
      ? buildScorerContext({
          prototypes: negativePrototypesForScoring,
          featureStats: library.featureStats,
          globalFeatureStats: library.globalFeatureStats,
          weights,
          activeGroups: sparseActiveGroups,
          scoreOptions,
          stageWeights: effectiveRuntimeHybrid.stageWeights,
          coarseTopN: effectiveRuntimeHybrid.coarseTopN,
          coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters,
          clusterCenters: null
        })
      : null
  let scorerContextDirty = false
  const scorerContextByRoute = new Map()
  const negativeScorerContextByRoute = new Map()
  let workerPool = null
  let workerPoolCreated = false
  let workerPoolCacheHit = false
  let workerPoolScoreMs = 0
  let workerPoolPackMs = 0
  let workerPoolComputeMs = 0
  let workerPoolBatchCount = 0
  if (workerPoolEnabled) {
    const workerRuntimeOverrides = {
      stageWeights: effectiveRuntimeHybrid.stageWeights,
      coarseTopN: effectiveRuntimeHybrid.coarseTopN,
      coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters
    }
    const workerPoolKey = JSON.stringify({
      libraryPath,
      runtimePath,
      runtimeOverrides: workerRuntimeOverrides,
      workerCount: scoringWorkers,
      workerChunkSize
    })
    const cachedPool = keepWorkerPoolAlive ? ctx.__runtime?.stepDWorkerPool : null
    if (reuseRuntimeCache && keepWorkerPoolAlive && cachedPool && cachedPool.key === workerPoolKey) {
      workerPool = cachedPool.pool
      workerPoolCacheHit = true
    } else {
      if (keepWorkerPoolAlive && cachedPool?.pool && typeof cachedPool.pool.close === "function") {
        await cachedPool.pool.close()
      }
      workerPool = await createScoreWorkerPool({
        workerScriptPath: new URL("../workers/score_candidate_worker.mjs", import.meta.url),
        libraryPath,
        runtimePath,
        runtimeOverrides: workerRuntimeOverrides,
        workerCount: scoringWorkers,
        chunkSize: workerChunkSize
      })
      workerPoolCreated = true
      if (reuseRuntimeCache && keepWorkerPoolAlive) {
        ctx.__runtime = ctx.__runtime ?? {}
        ctx.__runtime.stepDWorkerPool = {
          key: workerPoolKey,
          pool: workerPool
        }
      }
    }
  }
  const perfCounters = {
    scorerVersion,
    totalCandidatesScored: 0,
    totalPrototypes: 0,
    totalPrototypesAfterCoarse: 0,
    coarsePruneRatioSum: 0,
    coarsePruneRatioCount: 0,
    totalPrototypeComparisons: 0,
    prototypesPrunedByGroupBound: 0,
    prototypesPrunedByFeatureBound: 0,
    totalClusters: 0,
    totalClustersConsidered: 0
  }
  const routeBatchCounts = {}
  const lockboxRouteUsageCounts = {}
  const lockboxRouteMissingWeightCounts = {}
  const lockboxRouteBatchCounts = {}
  let onlineScoreMs = 0
  let onlineScorePackMs = 0
  let onlineScoreComputeMs = 0
  let onlineScoreBatchCount = 0
  let onlineScoringDays = 0
  let onlineScoringCandidateCount = 0
  const onlineSimilarityGateStats = {
    scoredCount: 0,
    passedCount: 0,
    rejectedCount: 0,
    rejectReasonCounts: {}
  }
  let lockboxScoreMs = 0
  let lockboxScorePackMs = 0
  let lockboxScoreComputeMs = 0
  let lockboxScoreBatchCount = 0
  let lockboxScoringDays = 0
  let lockboxScoringCandidateCount = 0
  const lockboxSimilarityGateStats = {
    scoredCount: 0,
    passedCount: 0,
    rejectedCount: 0,
    rejectReasonCounts: {}
  }
  const shouldPersistAnyFeaturePackRows =
    writeFeaturePackRows &&
    (prepareLockboxDuringStepDEffective || persistOnlineFeaturePackRows)
  const clearArtifactIfPresent = async (filePath) => {
    const safePath = String(filePath ?? "").trim()
    if (!safePath) return
    await unlink(safePath).catch(() => {})
  }
  await Promise.all([
    !writeDailyLogs ? clearArtifactIfPresent(logsPath) : Promise.resolve(),
    !sampledDebugEnabled ? clearArtifactIfPresent(sampledDebugPath) : Promise.resolve(),
    !writeDecisionCandidatesIndex ? clearArtifactIfPresent(candidateIndexPath) : Promise.resolve(),
    !writeDecisionCandidatesIndex ? clearArtifactIfPresent(candidateIndexMetaPath) : Promise.resolve(),
    !shouldPersistAnyFeaturePackRows ? clearArtifactIfPresent(featurePackPath) : Promise.resolve(),
    !shouldPersistAnyFeaturePackRows ? clearArtifactIfPresent(featurePackMetaPath) : Promise.resolve(),
    !persistOnlineAuditArtifacts ? clearArtifactIfPresent(d1RankedCandidatesPath) : Promise.resolve(),
    !persistOnlineAuditArtifacts ? clearArtifactIfPresent(d2ExecutionAuditPath) : Promise.resolve(),
    !persistLearningDatasets ? clearArtifactIfPresent(falsePositiveDatasetPath) : Promise.resolve(),
    !persistLearningDatasets
      ? clearArtifactIfPresent(falsePositiveDatasetMetaPath)
      : Promise.resolve(),
    !persistLearningDatasets
      ? clearArtifactIfPresent(adversarialReplayDatasetPath)
      : Promise.resolve(),
    !persistLearningDatasets
      ? clearArtifactIfPresent(adversarialReplayDatasetMetaPath)
      : Promise.resolve(),
    !persistLearningDatasets ? clearArtifactIfPresent(agreementDatasetPath) : Promise.resolve(),
    !persistLearningDatasets
      ? clearArtifactIfPresent(agreementDatasetMetaPath)
      : Promise.resolve(),
    !persistLearningDatasets ? clearArtifactIfPresent(dayTypeDatasetPath) : Promise.resolve(),
    !persistLearningDatasets ? clearArtifactIfPresent(dayTypeDatasetMetaPath) : Promise.resolve(),
    !prepareLockboxDuringStepD ? clearArtifactIfPresent(d1LockboxRankedCandidatesPath) : Promise.resolve(),
    !prepareLockboxDuringStepD ? clearArtifactIfPresent(d2LockboxExecutionAuditPath) : Promise.resolve()
  ])
  let featurePackWriter = null
  const feedbackQueue = []
  const executionFeedbackQueue = []

  const cloneLearningRow = (row) => ({
    symbol: String(row?.symbol ?? "").trim(),
    finalScore: Number(row?.finalScore ?? row?.score ?? 0),
    score: Number(row?.score ?? row?.finalScore ?? 0),
    successInWindow: row?.successInWindow === true,
    matchedPrototypeId: String(row?.matchedPrototypeId ?? "").trim() || null,
    matchedPrototypeClusterId: String(row?.matchedPrototypeClusterId ?? "").trim() || null,
    routeBucket: String(row?.routeBucket ?? "").trim() || null,
    regimeTag: String(row?.regimeTag ?? "").trim() || null,
    groupScores:
      row?.groupScores && typeof row.groupScores === "object"
        ? { ...row.groupScores }
        : null
  })

  const enqueueFeedback = ({ decisionDateKey, inUpdateSplit, top, picks }) => {
    if (c1FrozenProbe) {
      feedbackUpdatesSkipped = true
      return
    }
    if (ctx.config.onlineLearning.enabled !== true) return
    if (inUpdateSplit !== true) return
    if (!Array.isArray(top) || top.length < 1) return
    const pairwisePositiveTopN = Math.max(1, Number(generalizationCfg.pairwisePositiveTopN ?? 3) || 3)
    const pairwiseNegativeTopN = Math.max(1, Number(generalizationCfg.pairwiseNegativeTopN ?? 5) || 5)
    const feedbackTopK = Math.max(3, Math.min(12, pairwisePositiveTopN + pairwiseNegativeTopN + 2))
    const focusRows =
      Array.isArray(picks) && picks.length > 0
        ? picks
        : top.slice(0, 1)
    if (!Array.isArray(focusRows) || focusRows.length < 1) return
    const decisionDateKeyText = String(decisionDateKey ?? "").trim()
    const decisionDateIdx = tradingDateIndexByKey.get(decisionDateKeyText)
    if (!Number.isInteger(decisionDateIdx)) return
    const labelAvailableIdx =
      decisionDateIdx +
      Math.max(0, hitWindowDays - 1) +
      Math.max(0, Number(generalizationCfg?.feedbackDelayDays ?? 0) || 0)
    feedbackQueue.push({
      decisionDateKey: decisionDateKeyText,
      decisionDateIdx,
      labelAvailableIdx,
      labelAvailableDateKey: tradingDates[labelAvailableIdx] ?? null,
      top: top.slice(0, feedbackTopK).map(cloneLearningRow),
      picks: focusRows.map(cloneLearningRow),
      hadPolicyPick: Array.isArray(picks) && picks.length > 0
    })
    feedbackQueuedCount += 1
    feedbackPendingCountMax = Math.max(feedbackPendingCountMax, feedbackQueue.length)
  }

  const updateExecutionCalibrationRegime = ({ regimeTag, countDelta, hitDelta }) => {
    const tag = String(regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN").trim() || "VOL_UNKNOWN_LIQ_UNKNOWN"
    const prev = executionCalibrationRegimeStats.get(tag) ?? { count: 0, hitCount: 0 }
    const nextCount = Math.max(0, Number(prev.count ?? 0) + Number(countDelta ?? 0))
    const nextHitCount = Math.max(0, Number(prev.hitCount ?? 0) + Number(hitDelta ?? 0))
    if (nextCount <= 0 && nextHitCount <= 0) {
      executionCalibrationRegimeStats.delete(tag)
      return
    }
    executionCalibrationRegimeStats.set(tag, {
      count: nextCount,
      hitCount: Math.min(nextCount, nextHitCount)
    })
  }

  const applyExecutionCalibrationObservation = ({ decisionDateIdx, regimeTag, successInWindow }) => {
    executionCalibrationGlobalCount += 1
    if (successInWindow === true) executionCalibrationGlobalHitCount += 1
    updateExecutionCalibrationRegime({
      regimeTag,
      countDelta: 1,
      hitDelta: successInWindow === true ? 1 : 0
    })
    executionCalibrationAppliedHistory.push({
      decisionDateIdx,
      regimeTag: String(regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN"),
      successInWindow: successInWindow === true
    })
  }

  const pruneExecutionCalibrationWindow = ({ currentDateIdx }) => {
    const windowDays = Math.max(0, Number(executionGateCfg?.calibrationWindowDays ?? 0) || 0)
    if (windowDays < 1) return
    const minDecisionIdx = currentDateIdx - windowDays + 1
    while (executionCalibrationAppliedHistory.length > 0) {
      const oldest = executionCalibrationAppliedHistory[0]
      const oldestIdx = Number(oldest?.decisionDateIdx)
      if (!Number.isInteger(oldestIdx) || oldestIdx >= minDecisionIdx) break
      executionCalibrationAppliedHistory.shift()
      executionCalibrationGlobalCount = Math.max(0, executionCalibrationGlobalCount - 1)
      if (oldest?.successInWindow === true) {
        executionCalibrationGlobalHitCount = Math.max(0, executionCalibrationGlobalHitCount - 1)
      }
      updateExecutionCalibrationRegime({
        regimeTag: oldest?.regimeTag,
        countDelta: -1,
        hitDelta: oldest?.successInWindow === true ? -1 : 0
      })
    }
  }

  const updateFalsePositiveStatsMap = ({ map, key, countDelta, falsePositiveDelta }) => {
    const safeKey = String(key ?? "").trim()
    if (!safeKey) return
    const prev = map.get(safeKey) ?? { count: 0, falsePositiveCount: 0 }
    const nextCount = Math.max(0, Number(prev.count ?? 0) + Number(countDelta ?? 0))
    const nextFalsePositiveCount = Math.max(
      0,
      Math.min(nextCount, Number(prev.falsePositiveCount ?? 0) + Number(falsePositiveDelta ?? 0)),
    )
    if (nextCount <= 0 && nextFalsePositiveCount <= 0) {
      map.delete(safeKey)
      return
    }
    map.set(safeKey, {
      count: nextCount,
      falsePositiveCount: nextFalsePositiveCount
    })
  }

  const applyFalsePositiveObservation = ({
    decisionDateIdx,
    routeBucket,
    regimeTag,
    prototypeFamilyKey,
    liveLockboxFailure
  }) => {
    if (liveLockboxFailure !== true && liveLockboxFailure !== false) return
    const isFalsePositive = liveLockboxFailure === true
    falsePositiveGlobalCount += 1
    if (isFalsePositive) falsePositiveFailureCount += 1
    updateFalsePositiveStatsMap({
      map: falsePositiveRouteStats,
      key: routeBucket ?? "__DEFAULT__",
      countDelta: 1,
      falsePositiveDelta: isFalsePositive ? 1 : 0
    })
    updateFalsePositiveStatsMap({
      map: falsePositiveRegimeStats,
      key: regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN",
      countDelta: 1,
      falsePositiveDelta: isFalsePositive ? 1 : 0
    })
    updateFalsePositiveStatsMap({
      map: falsePositivePrototypeStats,
      key: prototypeFamilyKey ?? "__NONE__",
      countDelta: 1,
      falsePositiveDelta: isFalsePositive ? 1 : 0
    })
    falsePositiveAppliedHistory.push({
      decisionDateIdx,
      routeBucket: String(routeBucket ?? "__DEFAULT__"),
      regimeTag: String(regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN"),
      prototypeFamilyKey: String(prototypeFamilyKey ?? "__NONE__"),
      falsePositiveFailure: isFalsePositive
    })
  }

  const pruneFalsePositiveWindow = ({ currentDateIdx }) => {
    const windowDays = Math.max(0, Number(falsePositiveGateCfg?.calibrationWindowDays ?? 0) || 0)
    if (windowDays < 1) return
    const minDecisionIdx = currentDateIdx - windowDays + 1
    while (falsePositiveAppliedHistory.length > 0) {
      const oldest = falsePositiveAppliedHistory[0]
      const oldestIdx = Number(oldest?.decisionDateIdx)
      if (!Number.isInteger(oldestIdx) || oldestIdx >= minDecisionIdx) break
      falsePositiveAppliedHistory.shift()
      falsePositiveGlobalCount = Math.max(0, falsePositiveGlobalCount - 1)
      if (oldest?.falsePositiveFailure === true) {
        falsePositiveFailureCount = Math.max(0, falsePositiveFailureCount - 1)
      }
      updateFalsePositiveStatsMap({
        map: falsePositiveRouteStats,
        key: oldest?.routeBucket,
        countDelta: -1,
        falsePositiveDelta: oldest?.falsePositiveFailure === true ? -1 : 0
      })
      updateFalsePositiveStatsMap({
        map: falsePositiveRegimeStats,
        key: oldest?.regimeTag,
        countDelta: -1,
        falsePositiveDelta: oldest?.falsePositiveFailure === true ? -1 : 0
      })
      updateFalsePositiveStatsMap({
        map: falsePositivePrototypeStats,
        key: oldest?.prototypeFamilyKey,
        countDelta: -1,
        falsePositiveDelta: oldest?.falsePositiveFailure === true ? -1 : 0
      })
    }
  }

  const simulateFeedbackTradeOutcome = (row, decisionDateKey = null) => {
    const symbol = String(row?.symbol ?? "").trim()
    const series =
      Array.isArray(row?.series)
        ? row.series
        : (
          seriesMap?.get?.(symbol) ??
          seriesMap?.get?.(String(symbol).toUpperCase()) ??
          null
        )
    let decisionIdx = Number(row?.decisionIdx)
    if (
      !Number.isInteger(decisionIdx) &&
      Array.isArray(series) &&
      String(decisionDateKey ?? row?.decisionDateKey ?? "").trim()
    ) {
      const lookupDateKey = String(decisionDateKey ?? row?.decisionDateKey ?? "").trim()
      const resolvedIdx = series.findIndex(
        (seriesRow) => String(seriesRow?.dateKey ?? "").trim() === lookupDateKey,
      )
      if (resolvedIdx >= 0) {
        decisionIdx = resolvedIdx
      }
    }
    if (!Number.isInteger(decisionIdx) || !Array.isArray(series) || series.length < 2) {
      return {
        available: false,
        liveLockboxFailure: null,
        shouldHaveTraded: null,
        realizedNetRet: null,
        realizedExitReason: null,
        realizedHitTarget: null,
        realizedHitStop: null,
        labelSource: "OUTCOME_UNAVAILABLE"
      }
    }
    // Step D online learning uses market data directly as the canonical source of realized outcome.
    const simulated = simulateTradeFromDecision({
      series,
      decisionIdx,
      entryRule: feedbackEntryRule,
      holdDays: feedbackHoldDays,
      targetPct: feedbackTargetPct,
      stopLossPct: feedbackStopLossPct,
      costPct: feedbackRoundtripCostPct
    })
    if (!simulated) {
      return {
        available: false,
        liveLockboxFailure: null,
        shouldHaveTraded: null,
        realizedNetRet: null,
        realizedExitReason: null,
        realizedHitTarget: null,
        realizedHitStop: null,
        labelSource: "OUTCOME_UNAVAILABLE"
      }
    }
    const realizedNetRet = Number(simulated?.netRet ?? 0)
    const liveLockboxFailure = simulated?.hitTarget === true ? false : true
    return {
      available: true,
      liveLockboxFailure,
      shouldHaveTraded: liveLockboxFailure !== true,
      realizedNetRet,
      realizedExitReason: simulated?.exitReason ?? null,
      realizedHitTarget: simulated?.hitTarget === true,
      realizedHitStop: simulated?.hitStop === true,
      labelSource: "LOCKBOX_STYLE_REALIZED_OUTCOME"
    }
  }

  const resolveExtendedBiasOutcome = ({ row, decisionDateKey, tradeOutcome = null }) => {
    const extendedBiasCfg = generalizationCfg?.extendedBias ?? {}
    if (extendedBiasCfg?.enabled !== true) return null
    const outcomeMode = String(extendedBiasCfg?.outcomeMode ?? "binary_hit")
      .trim()
      .toLowerCase()
    if (outcomeMode === "realized_net_ret") {
      const realizedTradeOutcome =
        tradeOutcome && typeof tradeOutcome === "object"
          ? tradeOutcome
          : simulateFeedbackTradeOutcome(row, decisionDateKey)
      if (realizedTradeOutcome?.available !== true) return null
      const netRet = Number(realizedTradeOutcome?.realizedNetRet)
      if (!Number.isFinite(netRet)) return null
      const deadband = Math.max(0, Number(extendedBiasCfg?.netRetDeadband ?? 0) || 0)
      if (Math.abs(netRet) <= deadband) return 0
      const scale =
        netRet >= 0
          ? Math.max(1e-6, Number(extendedBiasCfg?.positiveNetRetScale ?? 0.08) || 0.08)
          : Math.max(1e-6, Number(extendedBiasCfg?.negativeNetRetScale ?? 0.04) || 0.04)
      return clampRange(netRet / scale, -1, 1)
    }
    return row?.successInWindow === true ? 1 : -1
  }

  const enqueueExecutionFeedback = ({
    decisionDateKey,
    inUpdateSplit,
    executionRows,
    falsePositiveRows,
    dayTypeDecision = null
  }) => {
    if (c1FrozenProbe) {
      executionFeedbackSkipped = true
      return
    }
    if (executionGateCfg.enabled !== true && falsePositiveGateCfg.enabled !== true) return
    if (inUpdateSplit !== true) {
      executionFeedbackSkippedByEvalCount += 1
      return
    }
    const executionList = Array.isArray(executionRows) ? executionRows : []
    const falsePositiveList = Array.isArray(falsePositiveRows) ? falsePositiveRows : []
    if (executionList.length < 1 && falsePositiveList.length < 1) return
      const buildReplayRowsForFeedback = (row) => {
      const executed = String(row?.executionDecision ?? "").trim().toUpperCase() === "TRADE"
      const tradeOutcome = simulateFeedbackTradeOutcome(row, decisionDateKey)
      const liveLockboxFailure = tradeOutcome?.liveLockboxFailure
      const outcomeAvailable = tradeOutcome?.available === true
      const hit = liveLockboxFailure === false
      const trainingLabelFalsePositive = resolveFalsePositiveTrainingLabel({
        liveLockboxFailure,
        realizedExitReason: tradeOutcome?.realizedExitReason,
        realizedNetRet: tradeOutcome?.realizedNetRet,
        cfg: falsePositiveModelCfg
      })
      const exitReasonText = String(tradeOutcome?.realizedExitReason ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN"
      const baseRow = buildFalsePositiveDatasetRow({
        decisionDateKey,
        split: "U",
        row,
        dayTypeDecision,
        cfg: falsePositiveModelCfg,
        labelFalsePositive: outcomeAvailable ? trainingLabelFalsePositive : null,
        labelSource: outcomeAvailable ? (tradeOutcome?.labelSource ?? "LOCKBOX_STYLE_REALIZED_OUTCOME") : "OUTCOME_UNAVAILABLE",
        replayKind: "ONLINE_OUTCOME",
        sampleWeight: outcomeAvailable ? 1 : 0,
        failureMode: outcomeAvailable
          ? (
              executed
                ? (hit ? `EXECUTED_${exitReasonText}_SUCCESS` : `EXECUTED_${exitReasonText}_FAILURE`)
                : (hit ? `BLOCKED_SHOULD_HAVE_TRADED_${exitReasonText}` : `BLOCKED_CORRECT_REJECTION_${exitReasonText}`)
            )
          : "OUTCOME_UNAVAILABLE",
        liveLockboxFailure,
        shouldHaveTraded: tradeOutcome?.shouldHaveTraded === true,
        realizedNetRet: tradeOutcome?.realizedNetRet,
        realizedExitReason: tradeOutcome?.realizedExitReason,
        realizedHitTarget: tradeOutcome?.realizedHitTarget,
        realizedHitStop: tradeOutcome?.realizedHitStop
      })
      const replayRow = buildFalsePositiveDatasetRow({
        decisionDateKey,
        split: "U",
        row,
        dayTypeDecision,
        cfg: falsePositiveModelCfg,
        labelFalsePositive: outcomeAvailable ? trainingLabelFalsePositive : null,
        labelSource:
          outcomeAvailable
            ? (
                tradeOutcome?.labelSource === "LIVE_LOCKBOX_FAILURE_JOIN"
                  ? "ADVERSARIAL_REPLAY_LIVE_LOCKBOX_FAILURE"
                  : "ADVERSARIAL_REPLAY_LOCKBOX_STYLE_REALIZED_OUTCOME"
              )
            : "OUTCOME_UNAVAILABLE",
        replayKind: outcomeAvailable
          ? (
              executed
                ? (hit ? "EXECUTED_HIT" : "EXECUTED_MISS")
                : (hit ? "BLOCKED_HIT" : "BLOCKED_MISS")
            )
          : "UNLABELED",
        sampleWeight: outcomeAvailable
          ? (
              executed
                ? (hit ? 1 : 2)
                : (hit ? 1.5 : 1.75)
            )
          : 0,
        failureMode: outcomeAvailable
          ? (
              executed
                ? (hit ? `EXECUTED_${exitReasonText}_SUCCESS` : `EXECUTED_${exitReasonText}_FAILURE`)
                : (hit ? `BLOCKED_SHOULD_HAVE_TRADED_${exitReasonText}` : `BLOCKED_CORRECT_REJECTION_${exitReasonText}`)
            )
          : "OUTCOME_UNAVAILABLE",
        liveLockboxFailure,
        shouldHaveTraded: tradeOutcome?.shouldHaveTraded === true,
        realizedNetRet: tradeOutcome?.realizedNetRet,
        realizedExitReason: tradeOutcome?.realizedExitReason,
        realizedHitTarget: tradeOutcome?.realizedHitTarget,
        realizedHitStop: tradeOutcome?.realizedHitStop
      })
      return { baseRow, replayRow }
    }
    const decisionDateKeyText = String(decisionDateKey ?? "").trim()
    const decisionDateIdx = tradingDateIndexByKey.get(decisionDateKeyText)
    if (!Number.isInteger(decisionDateIdx)) return
    const executionOutcomeSpan = Math.max(
      0,
      Number(feedbackEntryRule?.entryOffsetDays ?? 0) + feedbackHoldDays - 1
    )
    const labelAvailableIdx =
      decisionDateIdx +
      Math.max(0, hitWindowDays - 1, executionOutcomeSpan) +
      Math.max(0, Number(executionGateCfg?.feedbackDelayDays ?? 0) || 0)
    const falsePositiveReplayRows = falsePositiveList.map((row) => ({
      row,
      replay: buildReplayRowsForFeedback(row)
    }))
    executionFeedbackQueue.push({
      decisionDateKey: decisionDateKeyText,
      decisionDateIdx,
      labelAvailableIdx,
      labelAvailableDateKey: tradingDates[labelAvailableIdx] ?? null,
      executionRows: executionList.map((row) => ({
        regimeTag: String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN"),
        routeBucket: String(row?.routeBucket ?? "__DEFAULT__"),
        prototypeFamilyKey: String(
          row?.prototypeFamilyKey ??
            row?.matchedPrototypeClusterId ??
            row?.matchedPrototypeId ??
            "__NONE__",
        ),
        successInWindow: row?.successInWindow === true
      })),
      falsePositiveRows: falsePositiveReplayRows.map(({ row, replay }) => ({
        regimeTag: String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN"),
        routeBucket: String(row?.routeBucket ?? "__DEFAULT__"),
        prototypeFamilyKey: String(
          row?.prototypeFamilyKey ??
            row?.matchedPrototypeClusterId ??
            row?.matchedPrototypeId ??
            "__NONE__",
        ),
        successInWindow: row?.successInWindow === true,
        modelFeatures: replay?.replayRow?.modelFeatures ?? {},
        labelFalsePositive:
          hasBinaryLabel(replay?.replayRow?.labelFalsePositive)
            ? Number(replay.replayRow.labelFalsePositive)
            : null,
        sampleWeight: replay?.replayRow?.sampleWeight ?? 0,
        replayKind: replay?.replayRow?.replayKind ?? null,
        liveLockboxFailure:
          replay?.replayRow?.liveLockboxFailure === true
            ? true
            : replay?.replayRow?.liveLockboxFailure === false
              ? false
              : null
      }))
    })
    for (const { replay } of falsePositiveReplayRows) {
      falsePositiveDatasetRows.push(replay.baseRow)
      adversarialReplayRows.push(replay.replayRow)
    }
    executionFeedbackQueuedCount += 1
    executionFeedbackPendingCountMax = Math.max(
      executionFeedbackPendingCountMax,
      executionFeedbackQueue.length
    )
  }

  const enqueueBlockedTopFeedback = ({
    decisionDateKey,
    inUpdateSplit,
    top,
    dayTypeDecision = null
  }) => {
    if (inUpdateSplit !== true) return
    const topRow = Array.isArray(top) ? top[0] ?? null : null
    if (!topRow) return
    enqueueExecutionFeedback({
      decisionDateKey,
      inUpdateSplit,
      executionRows: [],
      falsePositiveRows: [
        {
          ...topRow,
          executionDecision: "BLOCK_D1_TOP1",
          executionShadowReason:
            dayTypeDecision?.noTrade === true
              ? "DAY_TYPE_NO_TRADE"
              : "D1_BLOCKED_TOP1"
        }
      ],
      dayTypeDecision
    })
  }

  const applyFeedbackUpdate = ({ top, picks, decisionDateKey = null }) => {
    if (c1FrozenProbe) {
      feedbackUpdatesSkipped = true
      return false
    }
    if (!Array.isArray(top) || top.length < 1) {
      feedbackNoUpdateCount += 1
      bump(feedbackNoUpdateReasonCounts, "NO_TOP")
      return false
    }
    const focusRows =
      Array.isArray(picks) && picks.length > 0
        ? picks
        : top.slice(0, 1)
    if (!Array.isArray(focusRows) || focusRows.length < 1) {
      feedbackNoUpdateCount += 1
      bump(feedbackNoUpdateReasonCounts, "NO_FOCUS_ROWS")
      return false
    }
    const learningRateBase = Number(ctx.config.onlineLearning.learningRate ?? 0.03) || 0.03
    const reinforceBeta = Number(ctx.config.onlineLearning.reinforceBeta ?? 0.2) || 0.2
    const zeroGroupScores = Object.fromEntries(GROUPS.map((group) => [group, 0]))
    let after = { ...weights }
    let anyUpdateApplied = false

    if (generalizationCfg.pairwiseEnabled) {
      const marginScale = Math.max(1e-6, Number(generalizationCfg.rankLossMarginScale ?? 0.02) || 0.02)
      const maxFactor = Math.max(0.5, Number(generalizationCfg.rankLossMaxFactor ?? 3) || 3)
      const maxUpdatesPerDay = Math.max(1, Number(generalizationCfg.pairwiseMaxUpdatesPerDay ?? 12) || 12)
      const positives = top
        .filter((it) => it?.successInWindow === true)
        .slice(0, Math.max(1, Number(generalizationCfg.pairwisePositiveTopN ?? 3)))
      const negatives = top
        .filter((it) => it?.successInWindow !== true)
        .slice(0, Math.max(1, Number(generalizationCfg.pairwiseNegativeTopN ?? 5)))
      let pairwiseUpdatesForDay = 0
      for (const pos of positives) {
        if (pairwiseUpdatesForDay >= maxUpdatesPerDay) break
        for (const neg of negatives) {
          if (pairwiseUpdatesForDay >= maxUpdatesPerDay) break
          if (!neg?.groupScores || !pos?.groupScores) continue
          const negScore = Number(neg?.finalScore ?? neg?.score ?? 0)
          const posScore = Number(pos?.finalScore ?? pos?.score ?? 0)
          const rankMargin = negScore - posScore
          if (!Number.isFinite(rankMargin) || rankMargin <= 0) continue
          const marginFactor = clampRange(rankMargin / marginScale, 0.25, maxFactor)
          after = updateWeightsOnline({
            weights: after,
            pickGroupScores: neg.groupScores,
            altGroupScores: pos.groupScores,
            success: false,
            learningRate:
              learningRateBase *
              Math.max(0, Number(generalizationCfg.pairwiseWeight ?? 1)) *
              marginFactor,
            reinforceBeta,
            floor: ctx.config.onlineLearning.weightFloor,
            lockedZeroGroups: Array.from(excludedGroups)
          })
          anyUpdateApplied = true
          pairwiseUpdateCount += 1
          pairwiseUpdatesForDay += 1
        }
      }

      const top1 = top?.[0] ?? null
      const bestSuccess = positives?.[0] ?? null
      if (
        top1 &&
        bestSuccess &&
        top1?.successInWindow !== true &&
        String(top1?.symbol ?? "") !== String(bestSuccess?.symbol ?? "") &&
        top1?.groupScores &&
        bestSuccess?.groupScores
      ) {
        const top1Score = Number(top1?.finalScore ?? top1?.score ?? 0)
        const bestSuccessScore = Number(bestSuccess?.finalScore ?? bestSuccess?.score ?? 0)
        const rankMargin = top1Score - bestSuccessScore
        const marginFactor =
          Number.isFinite(rankMargin) && rankMargin > 0
            ? clampRange(rankMargin / marginScale, 1, maxFactor)
            : 1
        after = updateWeightsOnline({
          weights: after,
          pickGroupScores: top1.groupScores,
          altGroupScores: bestSuccess.groupScores,
          success: false,
          learningRate:
            learningRateBase *
            Math.max(0, Number(generalizationCfg.hardNegativeWeight ?? 1.5)) *
            marginFactor,
          reinforceBeta,
          floor: ctx.config.onlineLearning.weightFloor,
          lockedZeroGroups: Array.from(excludedGroups)
        })
        anyUpdateApplied = true
        hardNegativeUpdateCount += 1
      }

      if (!anyUpdateApplied) {
        const failedRows = focusRows.filter(
          (row) => row?.successInWindow !== true && row?.groupScores && typeof row.groupScores === "object",
        )
        if (failedRows.length > 0) {
          const negativeOnlyWeight = Math.max(
            0,
            Number(generalizationCfg.hardNegativeWeight ?? 1.5) || 1.5,
          )
          for (const row of failedRows) {
            after = updateWeightsOnline({
              weights: after,
              pickGroupScores: row.groupScores,
              altGroupScores: zeroGroupScores,
              success: false,
              learningRate: learningRateBase * negativeOnlyWeight,
              reinforceBeta,
              floor: ctx.config.onlineLearning.weightFloor,
              lockedZeroGroups: Array.from(excludedGroups)
            })
            anyUpdateApplied = true
            negativeOnlyUpdateCount += 1
          }
        }
      }

      if (!anyUpdateApplied) {
        feedbackNoUpdateCount += 1
        bump(feedbackNoUpdateReasonCounts, "NO_PAIRWISE_CANDIDATE")
        return false
      }
    } else {
      for (const row of focusRows) {
        const altForRow = top.find(
          (it) => it?.successInWindow === true && String(it?.symbol ?? "") !== String(row?.symbol ?? ""),
        ) ?? null
        after = updateWeightsOnline({
          weights: after,
          pickGroupScores: row?.groupScores,
          altGroupScores:
            row?.successInWindow !== true
              ? altForRow?.groupScores ?? zeroGroupScores
              : null,
          success: row?.successInWindow === true,
          learningRate: learningRateBase,
          reinforceBeta,
          floor: ctx.config.onlineLearning.weightFloor,
          lockedZeroGroups: Array.from(excludedGroups)
        })
      }
      anyUpdateApplied = true
    }

    weights = enforceWeightRegularization({
      weights: after,
      prevWeights: weights,
      lockedGroups: excludedGroups,
      cfg: generalizationCfg
    })
    sparseActiveGroups = buildActiveGroupsFromWeights({ weights, excludedGroups })
    scorerContextDirty = true
    scorerContextByRoute.clear()
    negativeScorerContextByRoute.clear()
    return true
  }

  const drainMaturedFeedback = ({ currentDateKey }) => {
    if (c1FrozenProbe) {
      feedbackUpdatesSkipped = true
      return
    }
    if (ctx.config.onlineLearning.enabled !== true) return
    if (feedbackQueue.length < 1) return
    const currentDateIdx = tradingDateIndexByKey.get(String(currentDateKey ?? "").trim())
    if (!Number.isInteger(currentDateIdx)) return
    const remaining = []
    for (const item of feedbackQueue) {
      const labelAvailableIdx = Number(item?.labelAvailableIdx)
      if (!Number.isInteger(labelAvailableIdx)) {
        feedbackNoUpdateCount += 1
        bump(feedbackNoUpdateReasonCounts, "INVALID_QUEUE_ITEM")
        continue
      }
      if (currentDateIdx <= labelAvailableIdx) {
        remaining.push(item)
        continue
      }
      const delayDays = Math.max(0, currentDateIdx - labelAvailableIdx)
      if (delayDays < 1) {
        lookaheadViolations += 1
        remaining.push(item)
        continue
      }
      const applied = applyFeedbackUpdate({
        top: item?.top ?? [],
        picks: item?.picks ?? [],
        decisionDateKey: item?.decisionDateKey ?? null
      })
      if (applied) {
        feedbackAppliedCount += 1
        feedbackAppliedDelayDaysSum += delayDays
        feedbackAppliedDelayDaysMax = Math.max(feedbackAppliedDelayDaysMax, delayDays)
      }
    }
    feedbackQueue.length = 0
    for (const item of remaining) feedbackQueue.push(item)
  }

  const drainMaturedExecutionFeedback = ({ currentDateKey }) => {
    if (c1FrozenProbe) {
      executionFeedbackSkipped = true
      return
    }
    if (executionGateCfg.enabled !== true && falsePositiveGateCfg.enabled !== true) return
    const currentDateIdx = tradingDateIndexByKey.get(String(currentDateKey ?? "").trim())
    if (!Number.isInteger(currentDateIdx)) return
    if (executionFeedbackQueue.length < 1) {
      pruneExecutionCalibrationWindow({ currentDateIdx })
      pruneFalsePositiveWindow({ currentDateIdx })
      return
    }
    const remaining = []
    for (const item of executionFeedbackQueue) {
      const labelAvailableIdx = Number(item?.labelAvailableIdx)
      if (!Number.isInteger(labelAvailableIdx)) continue
      if (currentDateIdx <= labelAvailableIdx) {
        remaining.push(item)
        continue
      }
      const delayDays = Math.max(0, currentDateIdx - labelAvailableIdx)
      if (delayDays < 1) {
        executionLookaheadViolations += 1
        remaining.push(item)
        continue
      }
      for (const row of item?.executionRows ?? []) {
        if (executionGateCfg.enabled === true) {
          applyExecutionCalibrationObservation({
            decisionDateIdx: Number(item?.decisionDateIdx),
            regimeTag: row?.regimeTag,
            successInWindow: row?.successInWindow === true
          })
        }
      }
      for (const row of item?.falsePositiveRows ?? []) {
        const useForFalsePositiveLearning = shouldUseFalsePositiveLearningRow({
          row,
          cfg: falsePositiveModelCfg
        })
        if (useForFalsePositiveLearning !== true) continue
        if (falsePositiveGateCfg.enabled === true) {
          applyFalsePositiveObservation({
            decisionDateIdx: Number(item?.decisionDateIdx),
            routeBucket: row?.routeBucket,
            regimeTag: row?.regimeTag,
            prototypeFamilyKey: row?.prototypeFamilyKey,
            liveLockboxFailure:
              row?.liveLockboxFailure === true ? true : row?.liveLockboxFailure === false ? false : null
          })
          if (
            falsePositiveModelCfg.enabled === true &&
            hasBinaryLabel(row?.labelFalsePositive)
          ) {
            falsePositiveModel = updateFalsePositiveModelOnline({
              model: falsePositiveModel,
              featureMap: row?.modelFeatures ?? {},
              label: Number(row?.labelFalsePositive) === 1 ? 1 : 0,
              sampleWeight: row?.sampleWeight ?? 1,
              outcomeBucket: row?.realizedOutcomeBucket ?? null,
              cfg: falsePositiveModelCfg
            })
          }
        }
      }
      executionFeedbackAppliedCount += 1
      executionFeedbackAppliedDelayDaysSum += delayDays
      executionFeedbackAppliedDelayDaysMax = Math.max(
        executionFeedbackAppliedDelayDaysMax,
        delayDays
      )
    }
    executionFeedbackQueue.length = 0
    for (const item of remaining) executionFeedbackQueue.push(item)
    pruneExecutionCalibrationWindow({ currentDateIdx })
    pruneFalsePositiveWindow({ currentDateIdx })
  }

  const validatedTradeReplayDatasets = await loadValidatedTradeReplayDatasetsCached({
    ctx,
    latestValidatedTradeOutcomes,
    agreementModelCfg: agreementGateModelCfg
  })
  const validatedTradeReplayFeedbackDays = buildValidatedTradeReplayFeedbackDaysCached({
    ctx,
    latestValidatedTradeOutcomes
  })
  if (validatedTradeReplayDatasets.falsePositiveRows.length > 0) {
    falsePositiveDatasetRows.push(...validatedTradeReplayDatasets.falsePositiveRows)
    adversarialReplayRows.push(...validatedTradeReplayDatasets.falsePositiveRows)
  }
  if (validatedTradeReplayDatasets.agreementRows.length > 0) {
    agreementDatasetRows.push(...validatedTradeReplayDatasets.agreementRows)
  }
  if (validatedTradeReplayDatasets.dayTypeRows.length > 0) {
    dayTypeDatasetRows.push(...validatedTradeReplayDatasets.dayTypeRows)
  }
  for (const row of validatedTradeReplayDatasets.falsePositiveRows) {
    const useForFalsePositiveLearning = shouldUseFalsePositiveLearningRow({
      row,
      cfg: falsePositiveModelCfg
    })
    if (useForFalsePositiveLearning !== true) continue
    const decisionDateIdx = tradingDateIndexByKey.get(String(row?.decisionDateKey ?? "").trim())
    if (!Number.isInteger(decisionDateIdx)) continue
    applyFalsePositiveObservation({
      decisionDateIdx,
      routeBucket: row?.routeBucket,
      regimeTag: row?.regimeTag,
      prototypeFamilyKey: row?.prototypeFamilyKey,
      liveLockboxFailure:
        row?.liveLockboxFailure === true ? true : row?.liveLockboxFailure === false ? false : null
    })
    if (row?.selectedByPolicy === true || row?.executedByPolicy === true) {
      applyExecutionCalibrationObservation({
        decisionDateIdx,
        regimeTag: row?.regimeTag,
        successInWindow: row?.liveLockboxFailure !== true
      })
    }
  }
  for (const replayDay of validatedTradeReplayFeedbackDays) {
    applyFeedbackUpdate({
      top: replayDay?.top ?? [],
      picks: replayDay?.picks ?? [],
      decisionDateKey: replayDay?.decisionDateKey ?? null
    })
  }
  if (falsePositiveModelCfg.enabled === true) {
    for (const row of validatedTradeReplayDatasets.falsePositiveRows) {
      if (!hasBinaryLabel(row?.labelFalsePositive)) continue
      falsePositiveModel = updateFalsePositiveModelOnline({
        model: falsePositiveModel,
        featureMap: row?.modelFeatures ?? {},
        label: Number(row?.labelFalsePositive) === 1 ? 1 : 0,
        sampleWeight: row?.sampleWeight ?? 1,
        outcomeBucket: row?.realizedOutcomeBucket ?? null,
        cfg: falsePositiveModelCfg
      })
    }
  }
  if (agreementGateModelCfg.enabled === true) {
    for (const row of validatedTradeReplayDatasets.agreementRows) {
      if (!hasBinaryLabel(row?.labelAgreement)) continue
      agreementGateModel = updateAgreementGateModelOnline({
        model: agreementGateModel,
        featureMap: row?.modelFeatures ?? {},
        label: Number(row?.labelAgreement) === 1 ? 1 : 0,
        sampleWeight: row?.sampleWeight ?? 1,
        cfg: agreementGateModelCfg
      })
    }
  }
  if (dayTypeModelCfg.enabled === true) {
    for (const row of validatedTradeReplayDatasets.dayTypeRows) {
      dayTypeModel = updateDayTypeModelOnline({
        model: dayTypeModel,
        featureMap: row?.modelFeatures ?? {},
        label: row?.trainingLabel ?? row?.ruleDayType ?? "BALANCED",
        labelScores: row?.trainingLabelScores ?? null,
        cfg: dayTypeModelCfg
      })
    }
  }

  try {
    featurePackWriter = shouldPersistAnyFeaturePackRows
      ? await createJsonlWriter(featurePackWriteTargetPath)
      : null
    const processedOnlineDates = new Set()
    const packDateKeys = Array.from(decisionCandidatesByDate.keys()).sort((a, b) =>
      String(a).localeCompare(String(b)),
    )
    for (const decisionDateKey of packDateKeys) {
      const isOnlineDate = tradingDateSet.has(String(decisionDateKey))
      const isLockboxDate = isInRange(decisionDateKey, ctx.periods.lockbox)
      const decisionDateKeyText = String(decisionDateKey)
      const inUpdateSplit = isOnlineDate && updateDateSet.has(decisionDateKeyText)
      const inEvalSplit = isOnlineDate && evalDateSet.has(decisionDateKeyText)
      if (!isOnlineDate && (!prepareLockboxDuringStepDEffective || !isLockboxDate)) {
        continue
      }
      if (isOnlineDate) {
        drainMaturedFeedback({ currentDateKey: decisionDateKeyText })
        drainMaturedExecutionFeedback({ currentDateKey: decisionDateKeyText })
      }
      if (
        ctx.config.onlineLearning.enabled &&
        isOnlineDate &&
        !workerPoolEnabled &&
        scorerVersion === "v2_exact" &&
        scorerContextDirty
      ) {
        scorerContext =
          buildScorerContext({
            prototypes: library.prototypes,
            featureStats: library.featureStats,
            globalFeatureStats: library.globalFeatureStats,
            weights,
            activeGroups: sparseActiveGroups,
            scoreOptions,
            stageWeights: effectiveRuntimeHybrid.stageWeights,
            coarseTopN: effectiveRuntimeHybrid.coarseTopN,
            coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters,
            clusterCenters: runtimeMeta?.clusterCenters ?? library?.globalClusters
          })
        negativeScorerContext =
          similarityDisambiguationEnabled === true && negativePrototypesForScoring.length > 0
            ? buildScorerContext({
                prototypes: negativePrototypesForScoring,
                featureStats: library.featureStats,
                globalFeatureStats: library.globalFeatureStats,
                weights,
                activeGroups: sparseActiveGroups,
                scoreOptions,
                stageWeights: effectiveRuntimeHybrid.stageWeights,
                coarseTopN: effectiveRuntimeHybrid.coarseTopN,
                coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters,
                clusterCenters: null
              })
            : null
        scorerContextDirty = false
      }
      const seeds = decisionCandidatesByDate.get(decisionDateKey) ?? []
      const packedBySeed = new Map()
      const topCandidates = []
      const preGateTopCandidates = []
      let candidateCount = 0
      let similarityGatePassedForDay = 0
      let similarityGateRejectedForDay = 0
      const similarityGateRejectReasonCountsDay = {}
      let winnerChangedAfterSimilarityGateDay = false
      let top1RejectedBySimilarityGateDay = false
      let oracleHitRejectedBySimilarityGateDay = false
      let onlineRows = []
      let perfectPrototypeGateDayTelemetry = {
        evaluatedRows: 0,
        matchedRows: 0,
        filteredRows: 0,
        dedupedRows: 0
      }
      const basePackRows = []
      const pendingOnlineRows = []
      for (const seed of seeds) {
        const symbol = String(seed?.symbol ?? "").trim()
        if (!symbol) continue
        const series = seriesMap.get(symbol)
        if (!series) continue
        const decisionIdx = Number(seed?.decisionIdx)
        const asOfIdx = Number(seed?.asOfIdx)
        const targetIdx = Number(seed?.targetIdx)
        const asOfDateKey = String(seed?.asOfDateKey ?? "").trim()
        if (!Number.isInteger(decisionIdx)) continue
        if (!Number.isInteger(asOfIdx) || !Number.isInteger(targetIdx)) continue
        if (!asOfDateKey) continue
        if (asOfIdx < Math.max(1, minWindow) || targetIdx < 1 || targetIdx >= series.length) {
          continue
        }
        const seedKey = makeDecisionSeedKey({
          symbol,
          decisionIdx,
          asOfIdx,
          targetIdx
        })
        const meta = symbolMap.get(symbol) ?? { symbol, name: symbol, type: "UNKNOWN", isListed: true }
        const universeRow = universeMap.get(`${symbol}:${asOfDateKey}`)
        let seriesFeatureCache = seriesFeatureCacheBySymbol?.get(symbol) ?? null
        if (!seriesFeatureCache) {
          seriesFeatureCache = buildSeriesFeatureRuntimeCache(series)
          seriesFeatureCacheBySymbol?.set(symbol, seriesFeatureCache)
        }
        const featureVec = extractSnapshotFeaturesFromCache({
          cache: seriesFeatureCache,
          series,
          asOfIdx,
          symbol,
          universeRow,
          surfaceName: PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
        })
        const globalFeatureVec = extractGlobalContextFeaturesFromCache({
          cache: seriesFeatureCache,
          series,
          asOfIdx,
          globalWindow
        })
        if (!featureVec) continue
        const seq40 = makeSequenceFromCache({
          cache: seriesFeatureCache,
          series,
          endIdx: asOfIdx,
          window: localWindow
        })
        const seq150 = makeSequenceFromCache({
          cache: seriesFeatureCache,
          series,
          endIdx: asOfIdx,
          window: globalWindow
        })
        const eventMeta = buildPerfectPrototypeEventMetaFromSeries({
          series,
          decisionIdx,
          highJumpMode,
        })
        const eventFeatureVec = buildPerfectPrototypeEventFeatureVec(eventMeta, {
          highJumpMode,
        })
        const packRow = toFeaturePackRow({
          decisionDateKey,
          symbol,
          name: meta?.name ?? symbol,
          asOfDateKey,
          decisionIdx,
          asOfIdx,
          targetIdx,
          featureVec,
          globalFeatureVec,
          eventFeatureVec,
          marketContextVec: null,
          xsecEventVec: null,
          contextualTokens: [],
          seq40,
          seq150,
          localWindow,
          globalWindow
        })
        basePackRows.push(packRow)
        if (!isOnlineDate) {
          continue
        }
        pendingOnlineRows.push({
          symbol,
          name: meta?.name ?? symbol,
          decisionDateKey,
          asOfDateKey,
          decisionIdx,
          asOfIdx,
          targetDateKey: series[targetIdx]?.dateKey,
          seedKey,
          series,
          featureVec,
          globalFeatureVec,
        })
        if (!jumpMetaBySeedKey.has(seedKey)) {
          jumpMetaBySeedKey.set(seedKey, calcJumpWindowMeta({
            series,
            targetIdx,
            highJumpMode,
            eventThreshold,
            windowDays: hitWindowDays,
            useStopLoss,
            stopLossPct,
            sameDayTiePolicy
          }))
        }
      }

      const enrichedPackRows = enrichPerfectPrototypeRowsWithContext(basePackRows, {
        referenceRows: basePackRows,
      })
      const packRowBySeed = new Map()
      for (const packRow of enrichedPackRows) {
        if (!packRow?.seedKey) continue
        packRowBySeed.set(packRow.seedKey, packRow)
      }
      featurePackRowsComputed += enrichedPackRows.length
      if (isOnlineDate) featurePackRowsComputedOnline += enrichedPackRows.length
      if (prepareLockboxDuringStepDEffective && isLockboxDate) {
        featurePackRowsComputedLockbox += enrichedPackRows.length
      }
      const shouldPersistRow =
        writeFeaturePackRows &&
        (
          (prepareLockboxDuringStepDEffective && isLockboxDate) ||
          (persistOnlineFeaturePackRows && isOnlineDate)
        )
      if (shouldPersistRow && featurePackWriter) {
        for (const packRow of enrichedPackRows) {
          await featurePackWriter.writeRow(packRow)
        }
        featurePackRowsPersisted += enrichedPackRows.length
        if (isOnlineDate) featurePackRowsPersistedOnline += enrichedPackRows.length
        if (prepareLockboxDuringStepDEffective && isLockboxDate) {
          featurePackRowsPersistedLockbox += enrichedPackRows.length
        }
      }
      if (prepareLockboxDuringStepDEffective && isLockboxDate) {
        for (const packRow of enrichedPackRows) {
          packedBySeed.set(packRow.seedKey, packRow)
        }
      }
      if (isOnlineDate) {
        onlineRows = pendingOnlineRows
          .map((row) => {
            const packRow = packRowBySeed.get(row.seedKey) ?? null
            if (!packRow) return null
            const jumpMeta = jumpMetaBySeedKey.get(row.seedKey) ?? null
            const regime = resolveRegimeTagShared({
              featureVec: packRow?.featureVec,
              globalFeatureVec: packRow?.globalFeatureVec
            })
            const routeBucket = resolveRouteBucketShared({
              regimeTag: regime.tag,
              cfg: regimeRouterCfg
            })
            return {
              ...row,
              packRow,
              jumpMeta,
              regime,
              routeBucket
            }
          })
          .filter(Boolean)
      }

      if (isOnlineDate && onlineRows.length > 0) {
        const gatedOnline = applyPerfectPrototypeGateToRows({
          rows: onlineRows,
          catalog: perfectPrototypeCatalog,
          gateCfg: perfectPrototypeGateCfg,
          partition: "online"
        })
        onlineRows = gatedOnline.rows
        perfectPrototypeGateDayTelemetry = {
          evaluatedRows: Number(gatedOnline.telemetry?.evaluatedRows ?? 0),
          matchedRows: Number(gatedOnline.telemetry?.matchedRows ?? 0),
          filteredRows: Number(gatedOnline.telemetry?.filteredRows ?? 0),
          dedupedRows: Number(gatedOnline.telemetry?.dedupedRows ?? 0)
        }
        perfectPrototypeGateStats.online.days += Number(gatedOnline.telemetry?.days ?? 0)
        perfectPrototypeGateStats.online.evaluatedRows += Number(
          gatedOnline.telemetry?.evaluatedRows ?? 0,
        )
        perfectPrototypeGateStats.online.matchedRows += Number(
          gatedOnline.telemetry?.matchedRows ?? 0,
        )
        perfectPrototypeGateStats.online.filteredRows += Number(
          gatedOnline.telemetry?.filteredRows ?? 0,
        )
        perfectPrototypeGateStats.online.dedupedRows += Number(
          gatedOnline.telemetry?.dedupedRows ?? 0,
        )
      }

      if (isOnlineDate && onlineRows.length > 0) {
        onlineScoringDays += 1
        onlineScoringCandidateCount += onlineRows.length
        let scoredRows = new Array(onlineRows.length).fill(null)
        const resolveRouteScoringInputs = (routeBucket) => {
          const bucketKey = String(routeBucket ?? regimeRouterCfg.defaultBucket)
          const routeWeights = routeWeightsByBucket.get(bucketKey)
          const usingDefaultRouteWeights = !routeWeights
          if (usingDefaultRouteWeights && regimeRouterCfg.strictWeightLoad === true) {
            throw new Error(`Missing regime router weights for bucket: ${bucketKey}`)
          }
          const effectiveWeights = routeWeights ?? weights
          const effectiveActiveGroups = routeActiveGroupsByBucket.get(bucketKey) ?? sparseActiveGroups
          return {
            routeBucket: bucketKey,
            usingDefaultRouteWeights,
            effectiveWeights,
            effectiveActiveGroups
          }
        }
        const indexByBucket = new Map()
        if (regimeRouterCfg.enabled === true) {
          for (let i = 0; i < onlineRows.length; i += 1) {
            const bucket = String(onlineRows[i]?.routeBucket ?? regimeRouterCfg.defaultBucket)
            const bucketRows = indexByBucket.get(bucket) ?? []
            bucketRows.push(i)
            indexByBucket.set(bucket, bucketRows)
          }
        } else {
          indexByBucket.set(
            String(regimeRouterCfg.defaultBucket),
            Array.from({ length: onlineRows.length }, (_unused, idx) => idx),
          )
        }
        if (workerPoolEnabled && workerPool) {
          for (const [bucket, idxList] of indexByBucket.entries()) {
            const scoringInput = resolveRouteScoringInputs(bucket)
            routeUsageCounts[scoringInput.routeBucket] =
              Number(routeUsageCounts[scoringInput.routeBucket] ?? 0) + idxList.length
            routeBatchCounts[scoringInput.routeBucket] =
              Number(routeBatchCounts[scoringInput.routeBucket] ?? 0) + 1
            if (scoringInput.usingDefaultRouteWeights && regimeRouterCfg.enabled === true) {
              routeMissingWeightCounts[scoringInput.routeBucket] =
                Number(routeMissingWeightCounts[scoringInput.routeBucket] ?? 0) + idxList.length
            }
            const batch = await workerPool.scoreBatch({
              candidates: idxList.map((idx) => onlineRows[idx]?.packRow ?? null),
              weights: scoringInput.effectiveWeights,
              activeGroups: scoringInput.effectiveActiveGroups,
              scoreOptions,
              similarityDisambiguation: similarityDisambiguationCfg
            })
            const batchElapsedMs = Math.max(0, Number(batch?.elapsedMs ?? 0) || 0)
            const batchPackMs = Math.max(0, Number(batch?.packMs ?? 0) || 0)
            const batchComputeMs = Math.max(0, Number(batch?.computeMs ?? 0) || 0)
            const batchCount = Math.max(0, Number(batch?.batchCount ?? 0) || 0)
            workerPoolScoreMs += batchElapsedMs
            workerPoolPackMs += batchPackMs
            workerPoolComputeMs += batchComputeMs
            workerPoolBatchCount += batchCount
            onlineScoreMs += batchElapsedMs
            onlineScorePackMs += batchPackMs
            onlineScoreComputeMs += batchComputeMs
            onlineScoreBatchCount += batchCount
            mergePerfCounters(perfCounters, batch?.perf ?? {})
            const rowsForBucket = Array.isArray(batch?.rows) ? batch.rows : []
            for (let j = 0; j < idxList.length; j += 1) {
              scoredRows[idxList[j]] = rowsForBucket[j] ?? null
            }
          }
        } else {
          for (const [bucket, idxList] of indexByBucket.entries()) {
            const scoringInput = resolveRouteScoringInputs(bucket)
            routeUsageCounts[scoringInput.routeBucket] =
              Number(routeUsageCounts[scoringInput.routeBucket] ?? 0) + idxList.length
            routeBatchCounts[scoringInput.routeBucket] =
              Number(routeBatchCounts[scoringInput.routeBucket] ?? 0) + 1
            if (scoringInput.usingDefaultRouteWeights && regimeRouterCfg.enabled === true) {
              routeMissingWeightCounts[scoringInput.routeBucket] =
                Number(routeMissingWeightCounts[scoringInput.routeBucket] ?? 0) + idxList.length
            }
            const routeKey = String(scoringInput.routeBucket)
            let routeScorerContext = scorerContext
            let routeNegativeScorerContext = negativeScorerContext
            if (regimeRouterCfg.enabled === true) {
              routeScorerContext = scorerContextByRoute.get(routeKey) ?? null
              if (!routeScorerContext) {
                routeScorerContext = buildScorerContext({
                  prototypes: library.prototypes,
                  featureStats: library.featureStats,
                  globalFeatureStats: library.globalFeatureStats,
                  weights: scoringInput.effectiveWeights,
                  activeGroups: scoringInput.effectiveActiveGroups,
                  scoreOptions,
                  stageWeights: effectiveRuntimeHybrid.stageWeights,
                  coarseTopN: effectiveRuntimeHybrid.coarseTopN,
                  coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters,
                  clusterCenters: runtimeMeta?.clusterCenters ?? library?.globalClusters
                })
                scorerContextByRoute.set(routeKey, routeScorerContext)
              }
              if (similarityDisambiguationEnabled === true && negativePrototypesForScoring.length > 0) {
                routeNegativeScorerContext = negativeScorerContextByRoute.get(routeKey) ?? null
                if (!routeNegativeScorerContext) {
                  routeNegativeScorerContext = buildScorerContext({
                    prototypes: negativePrototypesForScoring,
                    featureStats: library.featureStats,
                    globalFeatureStats: library.globalFeatureStats,
                    weights: scoringInput.effectiveWeights,
                    activeGroups: scoringInput.effectiveActiveGroups,
                    scoreOptions,
                    stageWeights: effectiveRuntimeHybrid.stageWeights,
                    coarseTopN: effectiveRuntimeHybrid.coarseTopN,
                    coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters,
                    clusterCenters: null
                  })
                  negativeScorerContextByRoute.set(routeKey, routeNegativeScorerContext)
                }
              }
            }
            const batchStarted = Date.now()
            for (const rowIdx of idxList) {
              const row = onlineRows[rowIdx]
              const scored =
                similarityDisambiguationEnabled === true
                  ? scoreCandidateExactV3({
                      candidate: row?.packRow ?? {},
                      prototypes: library.prototypes,
                      negativePrototypes: negativePrototypesForScoring,
                      featureStats: library.featureStats,
                      globalFeatureStats: library.globalFeatureStats,
                      weights: scoringInput.effectiveWeights,
                      activeGroups: scoringInput.effectiveActiveGroups,
                      scoreOptions,
                      scorerContext: routeScorerContext,
                      negativeScorerContext: routeNegativeScorerContext,
                      stageWeights: effectiveRuntimeHybrid.stageWeights,
                      coarseTopN: effectiveRuntimeHybrid.coarseTopN,
                      coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters,
                      clusterCenters: runtimeMeta?.clusterCenters ?? library?.globalClusters,
                      negativeBuckets: similarityDisambiguationCfg?.negativeBuckets
                    })
                  : scoreCandidateExactV2({
                      candidate: row?.packRow ?? {},
                      prototypes: library.prototypes,
                      featureStats: library.featureStats,
                      globalFeatureStats: library.globalFeatureStats,
                      weights: scoringInput.effectiveWeights,
                      activeGroups: scoringInput.effectiveActiveGroups,
                      scoreOptions,
                      scorerContext: routeScorerContext,
                      stageWeights: effectiveRuntimeHybrid.stageWeights,
                      coarseTopN: effectiveRuntimeHybrid.coarseTopN,
                      coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters,
                      clusterCenters: runtimeMeta?.clusterCenters ?? library?.globalClusters
                    })
              mergePerfCounters(perfCounters, {
                totalCandidatesScored: 1,
                totalPrototypes: Number(scored?.perf?.prototypesTotal ?? 0),
                totalPrototypesAfterCoarse: Number(scored?.perf?.prototypesAfterCoarse ?? 0),
                coarsePruneRatio: Number(scored?.perf?.coarsePruneRatio ?? 0),
                totalPrototypeComparisons: Number(scored?.perf?.prototypesScored ?? 0),
                prototypesPrunedByGroupBound: Number(scored?.perf?.prototypesPrunedByGroupBound ?? 0),
                prototypesPrunedByFeatureBound: Number(scored?.perf?.prototypesPrunedByFeatureBound ?? 0),
                totalClusters: Number(scored?.perf?.clustersTotal ?? 0),
                totalClustersConsidered: Number(scored?.perf?.clustersConsidered ?? 0)
              })
              scoredRows[rowIdx] = scored
            }
            const batchElapsedMs = Math.max(0, Date.now() - batchStarted)
            onlineScoreMs += batchElapsedMs
            onlineScoreComputeMs += batchElapsedMs
            onlineScoreBatchCount += 1
          }
        }

        for (let i = 0; i < onlineRows.length; i += 1) {
          const row = onlineRows[i]
          const scored = scoredRows?.[i]
          if (!scored) continue
          const candidateFeatureVec = row?.packRow?.featureVec ?? {}
          candidateCount += 1
          const similarityGateResult = evaluateSimilarityGate({
            scored,
            cfg: decisionGateCfg?.similarityGate,
            disambiguationCfg: similarityDisambiguationCfg
          })
          bumpSimilarityGateStats({
            stats: onlineSimilarityGateStats,
            gateResult: similarityGateResult,
            dayRejectReasonCounts: similarityGateRejectReasonCountsDay
          })
          if (similarityGateResult.passed === true) {
            similarityGatePassedForDay += 1
          } else {
            similarityGateRejectedForDay += 1
          }
          const adjusted = applyPostScoreAdjust({
            baseScore: scored.total,
            matchedPrototypeId: scored.prototypeId,
            qualityLookup: prototypeQualityLookup,
            featureVec: candidateFeatureVec,
            cfg: postScoreAdjustCfg
          })
          const regime = row?.regime ?? resolveRegimeTagShared({
            featureVec: row.packRow?.featureVec,
            globalFeatureVec: row.packRow?.globalFeatureVec
          })
          const regimeExpert = evaluateRegimeExpert({
            regimeTag: regime.tag,
            cfg: regimeExpertsCfg
          })
          const expertAdjustedScore =
            adjusted.finalScore * Number(regimeExpert?.scoreMultiplier ?? 1)
          const extendedBiasCfg = generalizationCfg?.extendedBias ?? {}
          const routeBiasValue =
            extendedBiasCfg?.enabled === true
              ? resolveBiasValue({
                map: routeBiasState,
                key: row?.routeBucket ?? regimeRouterCfg.defaultBucket,
                maxAbs: Number(extendedBiasCfg?.maxAbsBias ?? 0.08)
              })
              : 0
          const regimeBiasValue =
            extendedBiasCfg?.enabled === true
              ? resolveBiasValue({
                map: regimeBiasState,
                key: regime.tag,
                maxAbs: Number(extendedBiasCfg?.maxAbsBias ?? 0.08)
              })
              : 0
          const prototypeBiasValue =
            extendedBiasCfg?.enabled === true
              ? resolveBiasValue({
                map: prototypeBiasState,
                key: scored?.prototypeClusterId ?? scored?.prototypeId ?? "",
                maxAbs: Number(extendedBiasCfg?.maxAbsBias ?? 0.08)
              })
              : 0
          const tradeQualityPriorCfg = generalizationCfg?.tradeQualityPrior ?? {}
          const globalTradeQuality = resolveTradeQualityPriorSignal({
            state: globalTradeQualityState,
            key: "__GLOBAL__",
            cfg: tradeQualityPriorCfg
          })
          const routeTradeQuality = resolveTradeQualityPriorSignal({
            state: routeTradeQualityState,
            key: row?.routeBucket ?? regimeRouterCfg.defaultBucket,
            cfg: tradeQualityPriorCfg
          })
          const regimeTradeQuality = resolveTradeQualityPriorSignal({
            state: regimeTradeQualityState,
            key: regime.tag,
            cfg: tradeQualityPriorCfg
          })
          const prototypeTradeQuality = resolveTradeQualityPriorSignal({
            state: prototypeTradeQualityState,
            key: scored?.prototypeClusterId ?? scored?.prototypeId ?? "",
            cfg: tradeQualityPriorCfg
          })
          const tradeQualityFeatureAdjustment = resolveTradeQualityFeatureAdjustment({
            featureVec: candidateFeatureVec,
            cfg: tradeQualityPriorCfg
          })
          const extendedBiasAdjustment =
            extendedBiasCfg?.enabled === true
              ? clampRange(
                Number(extendedBiasCfg?.routeBucketBiasWeight ?? 0) * routeBiasValue +
                Number(extendedBiasCfg?.regimeBiasWeight ?? 0) * regimeBiasValue +
                Number(extendedBiasCfg?.prototypeBiasWeight ?? 0) * prototypeBiasValue,
                -Number(extendedBiasCfg?.maxAbsBias ?? 0.08),
                Number(extendedBiasCfg?.maxAbsBias ?? 0.08)
              )
              : 0
              const tradeQualityPriorAdjustment =
                tradeQualityPriorCfg?.enabled === true
                  ? resolveTradeQualityPriorAdjustment({
                    cfg: tradeQualityPriorCfg,
                    globalSignal: globalTradeQuality,
                    routeSignal: routeTradeQuality,
                    regimeSignal: regimeTradeQuality,
                    prototypeSignal: prototypeTradeQuality,
                    candidateFeatureAdjustment: tradeQualityFeatureAdjustment.adjustment
                  })
                  : null
              const tradeQualityRankerAdjustment =
                tradeQualityPriorCfg?.applyToRanker === true
                  ? Number(tradeQualityPriorAdjustment?.adjustment ?? 0)
                  : 0
              const finalScoreBeforeExecutionPrior =
                expertAdjustedScore +
                extendedBiasAdjustment +
                tradeQualityRankerAdjustment
          const dataFreshnessDays = Math.max(
            0,
            Number(row?.decisionIdx ?? 0) - Number(row?.asOfIdx ?? 0),
          )
          const spreadProxy = Math.max(
            0,
            Number(candidateFeatureVec?.["candle.rangePct"] ?? 0),
          )
          const avgTradingValue20dKrw = Math.max(
            0,
            Number(candidateFeatureVec?.["volume.avgTradingValue20dKrw"] ?? 0),
          )
          const volatilityProxy = Math.max(
            0,
            Number(regime?.volatilityProxy ?? row?.packRow?.globalFeatureVec?.["global.volatility40"] ?? 0),
          )
          const slippageRisk = Math.max(
            0,
            spreadProxy * 0.65 + volatilityProxy * 0.35,
          )
          const orderProfile = estimateOrderExecutionProfile({
            row: {
              ...row,
              spreadProxyPct: spreadProxy,
              regimeVolatilityProxy: regime.volatilityProxy,
              regimeLiquidityProxy: regime.liquidityProxy,
              expectedNetRet3d: adjusted.expectedNetRet3d
            },
            cfg: orderSimulatorCfg
          })
          const slippageRiskWithOrder = Math.max(
            slippageRisk,
            (Number(orderProfile?.slippageBps ?? 0) || 0) / 100,
          )
          const executionPriorAdjusted = applyExecutionPriorAdjust({
            score: finalScoreBeforeExecutionPrior,
            slippageRisk: slippageRiskWithOrder,
            avgTradingValue20dKrw,
            orderProfile,
            executionFeasibilityScore: adjusted.executionFeasibilityScore,
            cfg: postScoreAdjustCfg
          })
          const finalScoreWithBias = executionPriorAdjusted.finalScore
          const similarityDiagnostics = buildSimilarityDiagnostics({
            similarityGateResult,
            scored
          })
          const preGateCandidateRow = {
            symbol: row.symbol,
            name: row.name,
            decisionDateKey: row.decisionDateKey,
            asOfDateKey: row.asOfDateKey,
            targetDateKey: row.targetDateKey,
            score: finalScoreWithBias,
            baseScore: adjusted.baseScore,
            finalScore: finalScoreWithBias,
            finalScorePreBias: expertAdjustedScore,
            finalScorePreExecutionPrior: finalScoreBeforeExecutionPrior,
            failedBreakoutCount20: adjusted.failedBreakoutCount20,
            gapFillThenContinueScore: adjusted.gapFillThenContinueScore,
            gapFillThenRevertScore: adjusted.gapFillThenRevertScore,
            executionFeasibilityScore: adjusted.executionFeasibilityScore,
            ...similarityDiagnostics,
            similarityGateRejectReasons: Array.isArray(similarityGateResult?.rejectReasons)
              ? similarityGateResult.rejectReasons.slice()
              : [],
            matchedPrototypeId: scored.prototypeId,
            matchedPrototypeClusterId: scored.prototypeClusterId,
            routeBucket: row?.routeBucket ?? regimeRouterCfg.defaultBucket,
            regimeTag: regime.tag,
            successInWindow: row.jumpMeta?.successInWindow === true
          }
          pushTopK(preGateTopCandidates, preGateCandidateRow, topK)
          if (similarityGateResult.passed !== true) {
            continue
          }
          if (!wouldEnterTopK(topCandidates, finalScoreWithBias, topK)) {
            continue
          }
          const simulatedTrade = simulateTradeFromDecision({
            series: row?.series,
            decisionIdx: row?.decisionIdx,
            entryRule: feedbackEntryRule,
            holdDays: feedbackHoldDays,
            targetPct: feedbackTargetPct,
            stopLossPct: feedbackStopLossPct,
            costPct: feedbackRoundtripCostPct
          })
          const simulatedExitReason = String(simulatedTrade?.exitReason ?? "")
            .trim()
            .toUpperCase()
          const simulatedNetRet = Number(simulatedTrade?.netRet ?? NaN)
          const timeoutNegativeInWindow =
            !!simulatedTrade &&
            simulatedExitReason !== "TARGET" &&
            simulatedExitReason !== "STOP" &&
            simulatedExitReason !== "BOTH_HIT_STOP_FIRST" &&
            Number.isFinite(simulatedNetRet) &&
            simulatedNetRet < 0
          const candidateRow = {
            symbol: row.symbol,
            name: row.name,
            decisionDateKey: row.decisionDateKey,
            asOfDateKey: row.asOfDateKey,
            targetDateKey: row.targetDateKey,
            score: finalScoreWithBias,
            baseScore: adjusted.baseScore,
            finalScore: finalScoreWithBias,
            finalScorePreBias: expertAdjustedScore,
            finalScorePreExecutionPrior: finalScoreBeforeExecutionPrior,
            ...similarityDiagnostics,
            similarityGateRejectReasons: [],
            extendedBiasAdjustment,
            routeBiasValue,
            regimeBiasValue,
            prototypeBiasValue,
            tradeQualityPriorAdjustment: Number(tradeQualityPriorAdjustment?.adjustment ?? 0),
            tradeQualityRankerAdjustment,
            tradeQualityRankerApplied: tradeQualityPriorCfg?.applyToRanker === true,
            tradeQualityFeatureAdjustment: Number(tradeQualityPriorAdjustment?.featureAdjustment ?? 0),
            tradeQualityGlobalScore: Number(globalTradeQuality?.score ?? 0),
            tradeQualityRouteResidual: Number(tradeQualityPriorAdjustment?.routeResidual ?? 0),
            tradeQualityRegimeResidual: Number(tradeQualityPriorAdjustment?.regimeResidual ?? 0),
            tradeQualityPrototypeResidual: Number(tradeQualityPriorAdjustment?.prototypeResidual ?? 0),
            tradeQualityRouteScore: routeTradeQuality.score,
            tradeQualityRegimeScore: regimeTradeQuality.score,
            tradeQualityPrototypeScore: prototypeTradeQuality.score,
            tradeQualityRouteCount: routeTradeQuality.count,
            tradeQualityRegimeCount: regimeTradeQuality.count,
            tradeQualityPrototypeCount: prototypeTradeQuality.count,
            executionPriorLowFillPenalty: executionPriorAdjusted.lowFillPenalty,
            executionPriorLowFillPenaltyRaw: executionPriorAdjusted.lowFillPenaltyRaw,
            executionPriorLowFillPenaltyRelief: executionPriorAdjusted.lowFillPenaltyRelief,
            executionPriorSlippagePenalty: executionPriorAdjusted.slippagePenalty,
            executionPriorSlippagePenaltyRaw: executionPriorAdjusted.slippagePenaltyRaw,
            executionPriorSlippagePenaltyRelief: executionPriorAdjusted.slippagePenaltyRelief,
            executionPriorLowLiquidityPenalty: executionPriorAdjusted.lowLiquidityPenalty,
            executionPriorLowLiquidityPenaltyRaw: executionPriorAdjusted.lowLiquidityPenaltyRaw,
            executionPriorLowLiquidityPenaltyRelief: executionPriorAdjusted.lowLiquidityPenaltyRelief,
            executionPriorBlockedOrderPenalty: executionPriorAdjusted.blockedOrderPenalty,
            executionPriorPositiveAfterCostBonus: executionPriorAdjusted.positiveAfterCostBonus,
            executionPriorNegativeAfterCostPenalty: executionPriorAdjusted.negativeAfterCostPenalty,
            prototypeFamilyKey: String(scored?.prototypeClusterId ?? scored?.prototypeId ?? ""),
            qualityBonus: adjusted.qualityBonus,
            winRateBonus: adjusted.winRateBonus,
            targetRateBonus: adjusted.targetRateBonus,
            failedBreakoutCount20: adjusted.failedBreakoutCount20,
            gapFillThenContinueScore: adjusted.gapFillThenContinueScore,
            gapFillThenRevertScore: adjusted.gapFillThenRevertScore,
            executionFeasibilityScore: adjusted.executionFeasibilityScore,
            stopRatePenalty: adjusted.stopRatePenalty,
            stopRatePenaltyRaw: adjusted.stopRatePenaltyRaw,
            stopRatePenaltyRelief: adjusted.stopRatePenaltyRelief,
            stopRatePenaltyReliefSignal: adjusted.stopRatePenaltyReliefSignal,
            antiPenalty: adjusted.antiPenalty,
            expectedRetBonus: adjusted.expectedRetBonus,
            eraCoverageBonus: adjusted.eraCoverageBonus,
            supportCountPenalty: adjusted.supportCountPenalty,
            singleEraPenalty: adjusted.singleEraPenalty,
            lowEraSupportPenalty: adjusted.lowEraSupportPenalty,
            supportCountPenaltyRaw: adjusted.supportCountPenaltyRaw,
            supportCountPenaltyRelief: adjusted.supportCountPenaltyRelief,
            supportCountPenaltyReliefSignal: adjusted.supportCountPenaltyReliefSignal,
            prototypeFailedBreakoutCount20: adjusted.prototypeFailedBreakoutCount20,
            prototypeGapFillThenContinueScore: adjusted.prototypeGapFillThenContinueScore,
            prototypeGapFillThenRevertScore: adjusted.prototypeGapFillThenRevertScore,
            prototypeExecutionFeasibilityScore: adjusted.prototypeExecutionFeasibilityScore,
            expectedNetRet3d: adjusted.expectedNetRet3d,
            qualityScore: adjusted.qualityScore,
            antiScore: adjusted.antiScore,
            baseQualityScore: adjusted.baseQualityScore,
            baseAntiScore: adjusted.baseAntiScore,
            winRate3d: adjusted.winRate3d,
            targetRate3d: adjusted.targetRate3d,
            stopRate3d: adjusted.stopRate3d,
            commonAlignmentScore: adjusted.commonAlignmentScore,
            matchedPrototypeClusterSignature: adjusted.clusterSignature,
            matchedPrototypeSelectedEraId: adjusted.selectedEraId,
            matchedPerfectPrototypeIds: row?.matchedPerfectPrototypeIds ?? [],
            matchedPerfectPrototypeCount: Number(row?.matchedPerfectPrototypeCount ?? 0) || 0,
            perfectPrototypePrimaryRuleId: row?.perfectPrototypePrimaryRuleId ?? null,
            perfectPrototypeGatePassed: row?.perfectPrototypeGatePassed === true,
            qualityTrades: adjusted.qualityTrades,
            clusterTemporalEraSupportCount: adjusted.clusterTemporalEraSupportCount,
            clusterTemporalEraCoverageRatio: adjusted.clusterTemporalEraCoverageRatio,
            targetEraCoverageRatio: adjusted.targetEraCoverageRatio,
            clusterTemporalDominantEraId: adjusted.clusterTemporalDominantEraId,
            clusterTemporalDominantEraShare: adjusted.clusterTemporalDominantEraShare,
            clusterTemporalMaxSingleEraShare: adjusted.clusterTemporalMaxSingleEraShare,
            clusterTemporalEffectiveSingleEraShare:
              adjusted.clusterTemporalEffectiveSingleEraShare,
            clusterTemporalSingleEraEvidenceCoverageRatio:
              adjusted.clusterTemporalSingleEraEvidenceCoverageRatio,
            clusterTemporalSingleEraEvidenceSupportRatio:
              adjusted.clusterTemporalSingleEraEvidenceSupportRatio,
            clusterTemporalEffectiveEraCount: adjusted.clusterTemporalEffectiveEraCount,
            clusterTemporalNormalizedEraEntropy:
              adjusted.clusterTemporalNormalizedEraEntropy,
            clusterTemporalSingleEraEvidenceEffectiveEraCountRatio:
              adjusted.clusterTemporalSingleEraEvidenceEffectiveEraCountRatio,
            clusterTemporalSingleEraEvidenceEntropyRatio:
              adjusted.clusterTemporalSingleEraEvidenceEntropyRatio,
            maxSingleEraShareCap: adjusted.maxSingleEraShareCap,
            minEraSupportCount: adjusted.minEraSupportCount,
            eraSupportShortfall: adjusted.eraSupportShortfall,
            eraCoverageShortfall: adjusted.eraCoverageShortfall,
            singleEraShareExcess: adjusted.singleEraShareExcess,
            eraSupportPenaltyReason: adjusted.eraSupportPenaltyReason,
            clusterTemporalEraSupportMin: adjusted.clusterTemporalEraSupportMin,
            clusterTemporalEraSupportMedian: adjusted.clusterTemporalEraSupportMedian,
            clusterTemporalEraWinRateStd: adjusted.clusterTemporalEraWinRateStd,
            clusterTemporalEraExpectedNetRetStd: adjusted.clusterTemporalEraExpectedNetRetStd,
            clusterTemporalEraContrastiveLiftStd: adjusted.clusterTemporalEraContrastiveLiftStd,
            groupScores: scored.groupScores,
            matchedPrototypeId: scored.prototypeId,
            matchedPrototypeSymbol: scored.prototypeSymbol,
            matchedPrototypeClusterId: scored.prototypeClusterId,
            stageScores: scored.stageScores,
            regimeTag: regime.tag,
            regimeVolatilityProxy: regime.volatilityProxy,
            regimeLiquidityProxy: regime.liquidityProxy,
            routeBucket: row?.routeBucket ?? regimeRouterCfg.defaultBucket,
            dataFreshnessDays,
            avgTradingValue20dKrw,
            spreadProxyPct: spreadProxy,
            slippageRisk: slippageRiskWithOrder,
            regimeExpert,
            orderProfile,
            successOnDecisionDay: row.jumpMeta?.successOnDecisionDay === true,
            successInWindow: row.jumpMeta?.successInWindow === true,
            hitWindowDays,
            firstHitOffset: row.jumpMeta?.firstHitOffset ?? null,
            firstStopOffset: row.jumpMeta?.firstStopOffset ?? null,
            stopTriggeredOnDecisionDay: row.jumpMeta?.stopTriggeredOnDecisionDay === true,
            stopTriggeredInWindow: row.jumpMeta?.stopTriggeredInWindow === true,
            maxWindowJumpPct: row.jumpMeta?.maxWindowJumpPct ?? null,
            minWindowDrawdownPct: row.jumpMeta?.minWindowDrawdownPct ?? null,
            decisionDayJumpPct: row.jumpMeta?.decisionDayJumpPct ?? null,
            simulatedTradeNetRet: Number.isFinite(simulatedNetRet) ? simulatedNetRet : null,
            simulatedTradeExitReason: simulatedTrade?.exitReason ?? null,
            timeoutNegativeInWindow
          }
          pushTopK(topCandidates, candidateRow, topK)
        }
      }
      if (prepareLockboxDuringStepDEffective && isLockboxDate) {
        featurePackLookupByDate.set(String(decisionDateKey), packedBySeed)
      }
      if (!isOnlineDate) continue
      if (candidateCount > 0 && similarityGatePassedForDay > 0) {
        bumpSplitCounter({
          allCounts: selectionFunnelCounts,
          updateCounts: selectionFunnelCountsUpdate,
          evalCounts: selectionFunnelCountsEval,
          key: "AFTER_SIMILARITY_GATE_DAY",
          inUpdateSplit,
          inEvalSplit
        })
      } else if (candidateCount > 0 && similarityGateRejectedForDay > 0) {
        bumpSplitCounter({
          allCounts: selectionFunnelCounts,
          updateCounts: selectionFunnelCountsUpdate,
          evalCounts: selectionFunnelCountsEval,
          key: "SIMILARITY_GATE_ZERO_DAY",
          inUpdateSplit,
          inEvalSplit
        })
      }
      const preGateTop1 = preGateTopCandidates[0] ?? null
      const postGateTop1 = topCandidates[0] ?? null
      const preGateTop1Symbol = String(preGateTop1?.symbol ?? "").trim()
      const postGateTop1Symbol = String(postGateTop1?.symbol ?? "").trim()
      const postGateSymbolSet = new Set(
        topCandidates
          .map((candidate) => String(candidate?.symbol ?? "").trim())
          .filter(Boolean),
      )
      winnerChangedAfterSimilarityGateDay =
        !!preGateTop1Symbol && preGateTop1Symbol !== postGateTop1Symbol
      top1RejectedBySimilarityGateDay =
        !!preGateTop1Symbol && !postGateSymbolSet.has(preGateTop1Symbol)
      oracleHitRejectedBySimilarityGateDay = preGateTopCandidates.some(
        (candidate) =>
          candidate?.successInWindow === true &&
          !postGateSymbolSet.has(String(candidate?.symbol ?? "").trim()),
      )
      if (winnerChangedAfterSimilarityGateDay) {
        winnerChangedAfterSimilarityGateDays += 1
        if (inUpdateSplit) winnerChangedAfterSimilarityGateDaysUpdate += 1
        if (inEvalSplit) winnerChangedAfterSimilarityGateDaysEval += 1
      }
      if (top1RejectedBySimilarityGateDay) {
        top1RejectedBySimilarityGateDays += 1
        if (inUpdateSplit) top1RejectedBySimilarityGateDaysUpdate += 1
        if (inEvalSplit) top1RejectedBySimilarityGateDaysEval += 1
      }
      if (oracleHitRejectedBySimilarityGateDay) {
        oracleHitRejectedBySimilarityGateDays += 1
        if (inUpdateSplit) oracleHitRejectedBySimilarityGateDaysUpdate += 1
        if (inEvalSplit) oracleHitRejectedBySimilarityGateDaysEval += 1
      }

      const oracleCandidateDay = onlineRows.length > 0
      if (oracleCandidateDay) {
        oracleCandidateDays += 1
        const universeHasHit = onlineRows.some((row) => row?.jumpMeta?.successInWindow === true)
        const topKHasHit = topCandidates.some((row) => row?.successInWindow === true)
        if (universeHasHit) oracleHitDaysUniverse += 1
        if (topKHasHit) oracleHitDaysTopK += 1
        if (universeHasHit && !topKHasHit) oracleMissedByTopKDays += 1
        if (inUpdateSplit) {
          oracleCandidateDaysUpdate += 1
          if (universeHasHit) oracleHitDaysUniverseUpdate += 1
          if (topKHasHit) oracleHitDaysTopKUpdate += 1
          if (universeHasHit && !topKHasHit) oracleMissedByTopKDaysUpdate += 1
        }
        if (inEvalSplit) {
          oracleCandidateDaysEval += 1
          if (universeHasHit) oracleHitDaysUniverseEval += 1
          if (topKHasHit) oracleHitDaysTopKEval += 1
          if (universeHasHit && !topKHasHit) oracleMissedByTopKDaysEval += 1
        }
      }

      let gateCfgForDay = decisionGateCfg
      let adaptiveMinFinalDecision = null
      if (adaptiveMinFinalCfg.enabled === true) {
        const useEvalAdaptiveControl =
          (probeScopeRequested ?? generalizationCfg.promotionScope) === "eval" && evalDateSet.size > 0
        const controlDaysSeen = useEvalAdaptiveControl
          ? evalDaysSeen + (inEvalSplit ? 1 : 0)
          : onlineDayIndex + 1
        const controlTargetDays = useEvalAdaptiveControl
          ? Math.max(1, Number(uvSplit?.evalDays ?? evalDateSet.size ?? 1))
          : Math.max(1, pickedControlDays)
        const progress = Math.min(1, controlDaysSeen / controlTargetDays)
        const expectedMinPicked = adaptiveMinFinalCfg.targetMinPicked * progress
        const expectedMaxPicked = adaptiveMinFinalCfg.targetMaxPicked * progress
        const lowerTrigger = expectedMinPicked - adaptiveMinFinalCfg.hysteresis
        const upperTrigger = expectedMaxPicked + adaptiveMinFinalCfg.hysteresis
        const controlPickedCount = useEvalAdaptiveControl ? pickedCountEval : pickedCount
        const controlPickHitCount = useEvalAdaptiveControl ? pickHitCountEval : pickHitCount
        const controlOracleHitDaysTopK = useEvalAdaptiveControl
          ? oracleHitDaysTopKEval
          : oracleHitDaysTopK
        const currentLcb95 = wilsonLowerBound({
          success: controlPickHitCount,
          total: controlPickedCount
        })
        const currentBudgetedConversion80 = computeBudgetedConversion({
          pickHitCount: controlPickHitCount,
          oracleHitDaysTopK: controlOracleHitDaysTopK,
          budget: 80
        })
        const qualityGatePassed =
          currentLcb95 >= Number(adaptiveMinFinalCfg?.minLcbFloor ?? 0) &&
          currentBudgetedConversion80 >= Number(adaptiveMinFinalCfg?.minBudgetedConversion80Floor ?? 0)
        let action = "HOLD"
        if (controlDaysSeen > Number(adaptiveMinFinalCfg.warmupDays ?? 0)) {
          const mode = String(adaptiveMinFinalCfg?.mode ?? "quality_aware")
          if (mode === "lower_bound_only") {
            if (controlPickedCount < lowerTrigger) {
              adaptiveMinFinalOffset -= Number(adaptiveMinFinalCfg.step ?? 0)
              adaptiveMinFinalAdjustments += 1
              adaptiveMinFinalLoosenCount += 1
              action = "LOOSEN"
            }
          } else if (mode === "quality_aware") {
            if (controlPickedCount < lowerTrigger) {
              if (qualityGatePassed) {
                adaptiveMinFinalOffset -= Number(adaptiveMinFinalCfg.step ?? 0)
                adaptiveMinFinalAdjustments += 1
                adaptiveMinFinalLoosenCount += 1
                action = "LOOSEN"
              } else {
                action = "HOLD_QUALITY_FLOOR"
              }
            } else if (controlPickedCount > upperTrigger) {
              adaptiveMinFinalOffset += Number(adaptiveMinFinalCfg.step ?? 0)
              adaptiveMinFinalAdjustments += 1
              adaptiveMinFinalTightenCount += 1
              action = "TIGHTEN"
            }
          }
        }
        const adjustedMinFinal = clampRange(
          Number(decisionGateCfg?.minFinalScore ?? 0) + adaptiveMinFinalOffset,
          Number(adaptiveMinFinalCfg.minFloor ?? 0),
          Number(adaptiveMinFinalCfg.maxCeil ?? 1),
        )
        adaptiveMinFinalOffset = adjustedMinFinal - Number(decisionGateCfg?.minFinalScore ?? 0)
        gateCfgForDay = {
          ...decisionGateCfg,
          minFinalScore: adjustedMinFinal
        }
        adaptiveMinFinalDecision = {
          enabled: true,
          action,
          progress,
          controlScope: useEvalAdaptiveControl ? "EVAL" : "ALL",
          controlDaysSeen,
          controlTargetDays,
          controlPickedCount,
          expectedMinPicked,
          expectedMaxPicked,
          lowerTrigger,
          upperTrigger,
          mode: String(adaptiveMinFinalCfg?.mode ?? "quality_aware"),
          currentLcb95,
          currentBudgetedConversion80,
          minLcbFloor: Number(adaptiveMinFinalCfg?.minLcbFloor ?? 0),
          minBudgetedConversion80Floor: Number(adaptiveMinFinalCfg?.minBudgetedConversion80Floor ?? 0),
          qualityGatePassed,
          adjustedMinFinal,
          offset: adaptiveMinFinalOffset
        }
      }
      const previewPolicyContract = {
        version: "v5",
        mode: "D1_D2_FP_MODEL_DT_MODEL_BUDGET_AGREEMENT",
        rankerScoreField: "rankerScore",
        executionScoreField: "executionScore",
        falsePositiveRiskField: "falsePositiveRisk",
        falsePositiveModelRiskField: "falsePositiveModelRisk",
        budgetDecisionField: "budgetDecision",
        agreementScoreField: "agreementScore",
        tauRank: Number(gateCfgForDay?.minFinalScore ?? 0) || 0,
        tauExec: Number(executionGateCfg?.targetLcb ?? 0) || 0,
        tauFp: Number(falsePositiveGateCfg?.maxRisk ?? 1) || 1,
        minAgreementScore: Number(gateCfgForDay?.agreementGate?.minAgreementScore ?? 0) || 0
      }
      const dayTypePreview = runD1Top1RankerShared({
        topCandidates,
        decisionGateCfg: {
          ...gateCfgForDay,
          exploration: {
            ...(gateCfgForDay?.exploration ?? {}),
            enabled: false
          }
        },
        calibrationCfg,
        executionCalibration: {
          globalCount: executionCalibrationGlobalCount,
          globalHitCount: executionCalibrationGlobalHitCount,
          regimeStats: executionCalibrationRegimeStats
        },
        agreementModel: agreementGateModel,
        agreementModelCfg: agreementGateModelCfg,
        policyContract: previewPolicyContract,
        explorationCtx: {
          pickedCount,
          pickedDays,
          coverageRecoveryDays,
          coverageRecoveryHitDays
        }
      })
      const ruleDayTypeDecision = classifyDayType({
        rows: dayTypePreview?.top ?? topCandidates,
        cfg: dayTypeRouterCfg
      })
      const dayTypeModelDecision = scoreDayTypeModel({
        signals: ruleDayTypeDecision?.signals,
        model: dayTypeModel,
        cfg: dayTypeModelCfg
      })
      const dayTypeDecision = applyLearnedDayTypeOverride({
        ruleDecision: ruleDayTypeDecision,
        modelDecision: dayTypeModelDecision,
        cfg: dayTypeModelCfg,
        policies: dayTypeRouterCfg?.policies
      })
      gateCfgForDay = applyDayTypePolicyToGateCfg({
        gateCfg: gateCfgForDay,
        dayTypeDecision
      })
      const executionGateRuntime = resolveExecutionGateRuntime({
        calibration: {
          globalCount: executionCalibrationGlobalCount,
          globalHitCount: executionCalibrationGlobalHitCount,
          regimeStats: executionCalibrationRegimeStats,
          regimeTag: String(topCandidates?.[0]?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN")
        },
        cfg: executionGateCfg
      })
      const dayTypeThresholds = resolveDayTypeThresholds({
        tauExec: executionGateRuntime?.activeCfg?.targetLcb,
        tauFp: falsePositiveGateCfg?.maxRisk,
        dayTypeDecision,
        gatePhase: executionGateRuntime?.gatePhase
      })
      const policyContractForDay = {
        version: "v5",
        mode: "D1_D2_FP_MODEL_DT_MODEL_BUDGET_AGREEMENT",
        rankerScoreField: "rankerScore",
        executionScoreField: "executionScore",
        falsePositiveRiskField: "falsePositiveRisk",
        falsePositiveModelRiskField: "falsePositiveModelRisk",
        budgetDecisionField: "budgetDecision",
        agreementScoreField: "agreementScore",
        tauRank: Number(gateCfgForDay?.minFinalScore ?? 0) || 0,
        tauExec: Number(dayTypeThresholds?.tauExec ?? executionGateCfg?.targetLcb ?? 0) || 0,
        tauFp: Number(dayTypeThresholds?.tauFp ?? falsePositiveGateCfg?.maxRisk ?? 1) || 1,
        minAgreementScore: Number(gateCfgForDay?.agreementGate?.minAgreementScore ?? 0) || 0,
        dayType: String(dayTypeDecision?.dayType ?? "BALANCED"),
        budgetMode: opportunityBudgetCfg?.enabled === true ? "EXECUTION_BUDGET" : "DISABLED"
      }
      const d1Raw = runD1Top1RankerShared({
        topCandidates,
        decisionGateCfg: gateCfgForDay,
        calibrationCfg,
        executionCalibration: {
          globalCount: executionCalibrationGlobalCount,
          globalHitCount: executionCalibrationGlobalHitCount,
          regimeStats: executionCalibrationRegimeStats
        },
        agreementModel: agreementGateModel,
        agreementModelCfg: agreementGateModelCfg,
        policyContract: policyContractForDay,
        dayTypeDecision,
        explorationCtx: {
          pickedCount,
          pickedDays,
          coverageRecoveryDays,
          coverageRecoveryHitDays
        }
      })
      const d1 = dayTypeDecision?.noTrade === true
        ? applyDayTypeDecisionToD1({
          d1: d1Raw,
          dayTypeDecision
        })
        : {
          ...(d1Raw && typeof d1Raw === "object" ? d1Raw : {}),
          gate: {
            ...((d1Raw?.gate && typeof d1Raw.gate === "object") ? d1Raw.gate : {}),
            dayTypeDecision
          }
        }
      if (topCandidates.length > 0) {
        bumpSplitCounter({
          allCounts: selectionFunnelCounts,
          updateCounts: selectionFunnelCountsUpdate,
          evalCounts: selectionFunnelCountsEval,
          key: "TOP_CANDIDATE_DAY",
          inUpdateSplit,
          inEvalSplit
        })
      }
      if (dayTypeDecision?.noTrade === true) {
        bumpSplitCounter({
          allCounts: selectionFunnelCounts,
          updateCounts: selectionFunnelCountsUpdate,
          evalCounts: selectionFunnelCountsEval,
          key: "DAY_TYPE_BLOCKED_DAY",
          inUpdateSplit,
          inEvalSplit
        })
      } else {
        bumpSplitCounter({
          allCounts: selectionFunnelCounts,
          updateCounts: selectionFunnelCountsUpdate,
          evalCounts: selectionFunnelCountsEval,
          key: "AFTER_DAY_TYPE_DAY",
          inUpdateSplit,
          inEvalSplit
        })
      }
      bump(dayTypeCounts, String(dayTypeDecision?.dayType ?? "BALANCED"))
      if (inUpdateSplit) bump(dayTypeCountsUpdate, String(dayTypeDecision?.dayType ?? "BALANCED"))
      if (inEvalSplit) bump(dayTypeCountsEval, String(dayTypeDecision?.dayType ?? "BALANCED"))
      const dayTypePolicySource = String(dayTypeDecision?.policySource ?? "RULE")
      bump(dayTypePolicySourceCounts, dayTypePolicySource)
      if (inUpdateSplit) bump(dayTypePolicySourceCountsUpdate, dayTypePolicySource)
      if (inEvalSplit) bump(dayTypePolicySourceCountsEval, dayTypePolicySource)
      const dayTypeModelMeta =
        dayTypeDecision?.modelMeta && typeof dayTypeDecision.modelMeta === "object"
          ? dayTypeDecision.modelMeta
          : {}
      const dayTypeModelApplyMode = String(dayTypeModelMeta?.applyMode ?? "RULE_ONLY")
      const dayTypeModelConfidenceBucket = String(
        dayTypeModelMeta?.confidenceBucket ?? "UNAVAILABLE",
      )
      const dayTypeModelShadowReason = String(dayTypeModelMeta?.shadowReason ?? "").trim()
      bumpSplitCounter({
        allCounts: dayTypeModelApplyModeCounts,
        updateCounts: dayTypeModelApplyModeCountsUpdate,
        evalCounts: dayTypeModelApplyModeCountsEval,
        key: dayTypeModelApplyMode,
        inUpdateSplit,
        inEvalSplit
      })
      bumpSplitCounter({
        allCounts: dayTypeModelConfidenceBucketCounts,
        updateCounts: dayTypeModelConfidenceBucketCountsUpdate,
        evalCounts: dayTypeModelConfidenceBucketCountsEval,
        key: dayTypeModelConfidenceBucket,
        inUpdateSplit,
        inEvalSplit
      })
      if (dayTypeModelShadowReason) {
        bumpSplitCounter({
          allCounts: dayTypeModelShadowReasonCounts,
          updateCounts: dayTypeModelShadowReasonCountsUpdate,
          evalCounts: dayTypeModelShadowReasonCountsEval,
          key: dayTypeModelShadowReason,
          inUpdateSplit,
          inEvalSplit
        })
      }
      if (
        dayTypeModelApplyMode === "MODEL_OVERRIDE" ||
        dayTypeModelApplyMode === "MODEL_OVERRIDE_AGREE"
      ) {
        dayTypeModelOverrideCount += 1
        if (inUpdateSplit) dayTypeModelOverrideCountUpdate += 1
        if (inEvalSplit) dayTypeModelOverrideCountEval += 1
      }
      if (dayTypeModelApplyMode === "MODEL_SHADOW") {
        dayTypeModelShadowCount += 1
        if (inUpdateSplit) dayTypeModelShadowCountUpdate += 1
        if (inEvalSplit) dayTypeModelShadowCountEval += 1
        if (dayTypeModelMeta?.shadowNoTrade === true) {
          dayTypeModelShadowNoTradeCount += 1
          if (inUpdateSplit) dayTypeModelShadowNoTradeCountUpdate += 1
          if (inEvalSplit) dayTypeModelShadowNoTradeCountEval += 1
        }
      }
      if (dayTypeModelApplyMode === "MODEL_OVERRIDE_AGREE") {
        dayTypeModelAgreeCount += 1
      } else if (isDayTypeModelRejected({
        modelMeta: dayTypeModelMeta,
        applyMode: dayTypeModelApplyMode
      })) {
        dayTypeModelRejectedCount += 1
      }
      const top = Array.isArray(d1?.top) ? d1.top : []
      const top1AgreementDecision = String(d1?.top?.[0]?.agreementDecision ?? "").trim()
      const top1AgreementReason = String(d1?.top?.[0]?.agreementReason ?? "").trim()
      if (top1AgreementDecision) {
        bump(agreementDecisionCounts, top1AgreementDecision)
        if (inUpdateSplit) bump(agreementDecisionCountsUpdate, top1AgreementDecision)
        if (inEvalSplit) bump(agreementDecisionCountsEval, top1AgreementDecision)
      }
      if (top1AgreementReason) {
        bump(agreementReasonCounts, top1AgreementReason)
        if (inUpdateSplit) bump(agreementReasonCountsUpdate, top1AgreementReason)
        if (inEvalSplit) bump(agreementReasonCountsEval, top1AgreementReason)
      }
      if (dayTypeDecision?.noTrade !== true) {
        const agreementBlocked =
          decisionGateCfg?.agreementGate?.enabled === true &&
          top1AgreementDecision &&
          top1AgreementDecision !== "TRADE"
        bumpSplitCounter({
          allCounts: selectionFunnelCounts,
          updateCounts: selectionFunnelCountsUpdate,
          evalCounts: selectionFunnelCountsEval,
          key: agreementBlocked ? "AGREEMENT_BLOCKED_DAY" : "AFTER_AGREEMENT_DAY",
          inUpdateSplit,
          inEvalSplit
        })
      }
      const inversionAdjusted = d1?.inversionAdjusted ?? { applied: false, rows: topCandidates }
      const rerankDecision = d1?.rerankDecision ?? { applied: false, top: topCandidates }
      if (inversionAdjusted?.applied === true) inversionSwapDays += 1
      if (rerankDecision?.applied === true) top1RerankAppliedDays += 1
      if (rerankDecision?.agreementRerank?.applied === true) agreementRerankAppliedDays += 1
      const agreementCandidatePool = Math.max(
        2,
        Number(decisionGateCfg?.agreementGate?.candidatePool ?? 10) || 10,
      )
      if (decisionGateCfg?.agreementGate?.enabled === true) {
        for (const candidate of top.slice(0, agreementCandidatePool)) {
          const agreementOutcome = simulateFeedbackTradeOutcome(candidate, decisionDateKey)
          if (agreementOutcome?.available !== true) continue
          const agreementLearningTarget = resolveAgreementLearningTarget({
            tradeOutcome: agreementOutcome,
            sampleWeight:
              Number.isFinite(Number(candidate?.rankPct))
                ? clampRange(1.6 - Number(candidate.rankPct), 0.5, 1.6)
                : 1,
            cfg: agreementGateModelCfg
          })
          const agreementDatasetRow = buildAgreementDatasetRow({
            decisionDateKey,
            split:
              inUpdateSplit && inEvalSplit
                ? "U+V"
                : inEvalSplit
                  ? "V"
                  : inUpdateSplit
                    ? "U"
                    : "ONLINE",
            row: candidate,
            labelAgreement: agreementLearningTarget?.labelAgreement,
            labelSource:
              agreementLearningTarget?.labelSource ??
              agreementOutcome?.labelSource ??
              "LOCKBOX_STYLE_REALIZED_OUTCOME",
            sampleWeight: agreementLearningTarget?.sampleWeight ?? 0,
          })
          agreementDatasetRows.push(agreementDatasetRow)
          if (
            inUpdateSplit &&
            agreementGateModelCfg.enabled === true &&
            hasBinaryLabel(agreementDatasetRow?.labelAgreement)
          ) {
            agreementGateModel = updateAgreementGateModelOnline({
              model: agreementGateModel,
              featureMap: agreementDatasetRow?.modelFeatures ?? {},
              label: agreementDatasetRow?.labelAgreement,
              sampleWeight: agreementDatasetRow?.sampleWeight ?? 1,
              cfg: agreementGateModelCfg
            })
          }
        }
      }
      const firstSuccessRank = findFirstSuccessRank(top)
      if (top.length > 0) {
        rankableDays += 1
        if (firstSuccessRank === 1) hitAt1Days += 1
        if (Number.isInteger(firstSuccessRank) && firstSuccessRank <= 3) hitAt3Days += 1
        if (Number.isInteger(firstSuccessRank) && firstSuccessRank <= 5) hitAt5Days += 1
        if (Number.isInteger(firstSuccessRank)) {
          firstSuccessRankSum += firstSuccessRank
          firstSuccessRankCount += 1
        }
        if (inUpdateSplit) {
          rankableDaysUpdate += 1
          if (firstSuccessRank === 1) hitAt1DaysUpdate += 1
          if (Number.isInteger(firstSuccessRank) && firstSuccessRank <= 3) hitAt3DaysUpdate += 1
          if (Number.isInteger(firstSuccessRank) && firstSuccessRank <= 5) hitAt5DaysUpdate += 1
          if (Number.isInteger(firstSuccessRank)) {
            firstSuccessRankSumUpdate += firstSuccessRank
            firstSuccessRankCountUpdate += 1
          }
        }
        if (inEvalSplit) {
          rankableDaysEval += 1
          if (firstSuccessRank === 1) hitAt1DaysEval += 1
          if (Number.isInteger(firstSuccessRank) && firstSuccessRank <= 3) hitAt3DaysEval += 1
          if (Number.isInteger(firstSuccessRank) && firstSuccessRank <= 5) hitAt5DaysEval += 1
          if (Number.isInteger(firstSuccessRank)) {
            firstSuccessRankSumEval += firstSuccessRank
            firstSuccessRankCountEval += 1
          }
        }
      }
      const gate = d1?.gate ?? {
        picks: [],
        pick: null,
        gateReason: "UNKNOWN",
        scoreMargin: null,
        rejectionCounts: {},
        propensity: null,
        selectionPolicy: { mode: "UNKNOWN", applied: false }
      }
      if (inUpdateSplit) updateDaysSeen += 1
      if (inEvalSplit) evalDaysSeen += 1
      bump(gateReasonCounts, gate.gateReason)
      if (inUpdateSplit) bump(gateReasonCountsUpdate, gate.gateReason)
      if (inEvalSplit) bump(gateReasonCountsEval, gate.gateReason)
      const scoreOriginTrace = d1?.scoreOriginTrace ?? null
      const counterfactualGateSweep = d1?.counterfactualGateSweep ?? null
      const scoreRecoveryTelemetry = d1?.scoreRecovery ?? null
      const scoreRecalibrationTelemetry = d1?.scoreRecalibration ?? null
      if (scoreOriginTrace && Number.isFinite(Number(scoreOriginTrace?.policyContractTauRank))) {
        d1ObservedTauRank = Number(scoreOriginTrace.policyContractTauRank)
      }
      if (counterfactualGateSweep) {
        d1GateEvaluatedDays += 1
        if (inUpdateSplit) d1GateEvaluatedDaysUpdate += 1
        if (inEvalSplit) d1GateEvaluatedDaysEval += 1
        if (counterfactualGateSweep?.topNPassExistsDay === true) {
          d1TopNPassExistsDays += 1
          if (inUpdateSplit) d1TopNPassExistsDaysUpdate += 1
          if (inEvalSplit) d1TopNPassExistsDaysEval += 1
        }
        pushSplitNumericSample({
          allValues: d1BestPassingRankSamples,
          updateValues: d1BestPassingRankSamplesUpdate,
          evalValues: d1BestPassingRankSamplesEval,
          value: counterfactualGateSweep?.bestPassingRank,
          inUpdateSplit,
          inEvalSplit
        })
        pushSplitNumericSample({
          allValues: d1BestAltPassingRankSamples,
          updateValues: d1BestAltPassingRankSamplesUpdate,
          evalValues: d1BestAltPassingRankSamplesEval,
          value: counterfactualGateSweep?.bestAltPassingRank,
          inUpdateSplit,
          inEvalSplit
        })
        if (counterfactualGateSweep?.top1Pass !== true) {
          d1GateFailedDays += 1
          if (inUpdateSplit) d1GateFailedDaysUpdate += 1
          if (inEvalSplit) d1GateFailedDaysEval += 1
          if (counterfactualGateSweep?.top1FailedButAltPassExistsDay === true) {
            d1Top1FailedButAltPassExistsDays += 1
            if (inUpdateSplit) d1Top1FailedButAltPassExistsDaysUpdate += 1
            if (inEvalSplit) d1Top1FailedButAltPassExistsDaysEval += 1
            if (counterfactualGateSweep?.bestAltPassingWouldHitDay === true) {
              d1AltPassWouldHitDays += 1
              if (inUpdateSplit) d1AltPassWouldHitDaysUpdate += 1
              if (inEvalSplit) d1AltPassWouldHitDaysEval += 1
            }
          } else if (counterfactualGateSweep?.top1FailedAndNoAltPassExistsDay === true) {
            d1Top1FailedAndNoAltPassExistsDays += 1
            if (inUpdateSplit) d1Top1FailedAndNoAltPassExistsDaysUpdate += 1
            if (inEvalSplit) d1Top1FailedAndNoAltPassExistsDaysEval += 1
          }
          if (gate.gateReason === "SCORE_BELOW_MIN") {
            recordScoreOriginBucket({
              bucket: d1ScoreBelowMinStats,
              trace: scoreOriginTrace
            })
            if (inUpdateSplit) {
              recordScoreOriginBucket({
                bucket: d1ScoreBelowMinStatsUpdate,
                trace: scoreOriginTrace
              })
            }
            if (inEvalSplit) {
              recordScoreOriginBucket({
                bucket: d1ScoreBelowMinStatsEval,
                trace: scoreOriginTrace
              })
            }
          } else if (gate.gateReason === "SCORE_MARGIN_LOW") {
            recordScoreOriginBucket({
              bucket: d1ScoreMarginLowStats,
              trace: scoreOriginTrace
            })
            if (inUpdateSplit) {
              recordScoreOriginBucket({
                bucket: d1ScoreMarginLowStatsUpdate,
                trace: scoreOriginTrace
              })
            }
            if (inEvalSplit) {
              recordScoreOriginBucket({
                bucket: d1ScoreMarginLowStatsEval,
                trace: scoreOriginTrace
              })
            }
          }
        }
      }
      if (scoreRecoveryTelemetry) {
        recordScoreRecoveryTelemetry({
          stats: scoreRecoveryStats,
          telemetry: scoreRecoveryTelemetry
        })
        if (inUpdateSplit) {
          recordScoreRecoveryTelemetry({
            stats: scoreRecoveryStatsUpdate,
            telemetry: scoreRecoveryTelemetry
          })
        }
        if (inEvalSplit) {
          recordScoreRecoveryTelemetry({
            stats: scoreRecoveryStatsEval,
            telemetry: scoreRecoveryTelemetry
          })
        }
      }
      if (scoreRecalibrationTelemetry) {
        recordScoreRecalibrationTelemetry({
          stats: scoreRecalibrationStats,
          telemetry: scoreRecalibrationTelemetry
        })
        if (inUpdateSplit) {
          recordScoreRecalibrationTelemetry({
            stats: scoreRecalibrationStatsUpdate,
            telemetry: scoreRecalibrationTelemetry
          })
        }
        if (inEvalSplit) {
          recordScoreRecalibrationTelemetry({
            stats: scoreRecalibrationStatsEval,
            telemetry: scoreRecalibrationTelemetry
          })
        }
      }
      if (dayTypeDecision?.noTrade === true) {
        dayTypeNoTradeCount += 1
        const topHasHit = top.some((row) => row?.successInWindow === true)
        if (topHasHit) dayTypeNoTradeHitCount += 1
        if (inUpdateSplit) {
          dayTypeNoTradeCountUpdate += 1
          if (topHasHit) dayTypeNoTradeHitCountUpdate += 1
        }
        if (inEvalSplit) {
          dayTypeNoTradeCountEval += 1
          if (topHasHit) dayTypeNoTradeHitCountEval += 1
        }
      }
      const secondPickGate = gate?.secondPickGate ?? null
      if (secondPickGate?.evaluated) secondPickEvaluatedDays += 1
      if (secondPickGate?.accepted) secondPickAcceptedDays += 1
      if (secondPickGate?.rejectReason) {
        bump(secondRejectReasonCounts, String(secondPickGate.rejectReason))
      }
      if (secondPickGate?.shadowRejectReason) {
        bump(secondShadowRejectReasonCounts, String(secondPickGate.shadowRejectReason))
      }
      const picks = Array.isArray(d1?.picks) ? d1.picks : []
      if (picks.length > 0) {
        bumpSplitCounter({
          allCounts: selectionFunnelCounts,
          updateCounts: selectionFunnelCountsUpdate,
          evalCounts: selectionFunnelCountsEval,
          key: "D1_PICK_DAY",
          inUpdateSplit,
          inEvalSplit
        })
      } else if (dayTypeDecision?.noTrade !== true) {
        bumpSplitCounter({
          allCounts: selectionFunnelCounts,
          updateCounts: selectionFunnelCountsUpdate,
          evalCounts: selectionFunnelCountsEval,
          key: "D1_ZERO_PICK_DAY",
          inUpdateSplit,
          inEvalSplit
        })
      }
      const pick = d1?.pick ?? picks[0] ?? null
      const selectionPolicy = gate?.selectionPolicy ?? {}
      const propensity =
        Number.isFinite(Number(gate?.propensity)) && Number(gate?.propensity) > 0
          ? Number(gate?.propensity)
          : null
      const toxicCfg = executionGateCfg?.toxicRegime ?? {}
      const toxicRegime = {
        enabled: inEvalSplit && toxicCfg?.enabled === true && toxicCfg?.updateOnly !== false,
        minSamples: Math.max(1, Number(toxicCfg?.minSamples ?? 60) || 60),
        maxHitRateLcb95: clamp01(toxicCfg?.maxHitRateLcb95 ?? 0),
        action: String(toxicCfg?.action ?? "SHADOW").trim().toUpperCase(),
        updateStats: updateRegimeOutcomeStats
      }
      const d2 = runD2ExecutionScorerShared({
        top,
        picks,
        gate,
        rerankDecision,
        calibrationCfg,
        metaSelectorCfg,
        executionGateCfg,
        falsePositiveGateCfg,
        opportunityBudgetCfg,
        executionCalibration: {
          globalCount: executionCalibrationGlobalCount,
          globalHitCount: executionCalibrationGlobalHitCount,
          regimeStats: executionCalibrationRegimeStats
        },
        falsePositiveState: {
          globalCount: falsePositiveGlobalCount,
          falsePositiveCount: falsePositiveFailureCount,
          routeStats: falsePositiveRouteStats,
          regimeStats: falsePositiveRegimeStats,
          prototypeStats: falsePositivePrototypeStats
        },
        falsePositiveModel,
        falsePositiveModelCfg,
        dayTypeDecision,
        toxicRegime,
        policyContract: policyContractForDay
      })
      for (const [decision, countRaw] of Object.entries(d2?.metaDecisionCounts ?? {})) {
        const count = Math.max(0, Number(countRaw ?? 0) || 0)
        if (count < 1) continue
        metaDecisionCounts[decision] = Number(metaDecisionCounts[decision] ?? 0) + count
      }
      for (const row of picks) {
        if (row.metaDiagnosticOnly === true) {
          if (row.metaDiagnosticDecision) {
            bump(metaDiagnosticDecisionCounts, String(row.metaDiagnosticDecision))
          }
          if (row.metaDiagnosticReason) {
            bump(metaDiagnosticReasonCounts, String(row.metaDiagnosticReason))
          }
        }
      }
      const executionDecisionCountsDay = d2?.executionDecisionCounts ?? {}
      const executionShadowReasonCountsDay = d2?.executionShadowReasonCounts ?? {}
      const falsePositiveDecisionCountsDay = d2?.falsePositiveDecisionCounts ?? {}
      const falsePositiveReasonCountsDay = d2?.falsePositiveReasonCounts ?? {}
      const executionPicks = Array.isArray(d2?.executedPicks) ? d2.executedPicks : []
      if (picks.length > 0) {
        bumpSplitCounter({
          allCounts: selectionFunnelCounts,
          updateCounts: selectionFunnelCountsUpdate,
          evalCounts: selectionFunnelCountsEval,
          key: executionPicks.length > 0 ? "EXECUTION_TRADE_DAY" : "EXECUTION_BLOCKED_DAY",
          inUpdateSplit,
          inEvalSplit
        })
      }
      const executionBlockedCountDay = Math.max(0, Number(d2?.executionBlockedCount ?? 0) || 0)
      const preFalsePositiveApprovedCountDay = Math.max(
        0,
        Number(d2?.preFalsePositiveApprovedCount ?? 0) || 0,
      )
      const falsePositiveRejectedCountDay = Math.max(
        0,
        Number(d2?.falsePositiveRejectedCount ?? 0) || 0,
      )
      const falsePositiveRejectedHitCountDay = Math.max(
        0,
        Number(d2?.falsePositiveRejectedHitCount ?? 0) || 0,
      )
      const falsePositiveRejectedMissCountDay = Math.max(
        0,
        Number(d2?.falsePositiveRejectedMissCount ?? 0) || 0,
      )
      const falsePositiveModelAvailableCountDay = picks.filter(
        (row) => row?.falsePositiveModelAvailable === true,
      ).length
      const budgetDecisionCountsDay = d2?.budgetDecisionCounts ?? {}
      const budgetReasonCountsDay = d2?.budgetReasonCounts ?? {}
      const budgetRejectedCountDay = Math.max(0, Number(d2?.budgetRejectedCount ?? 0) || 0)
      const budgetRejectedHitCountDay = Math.max(0, Number(d2?.budgetRejectedHitCount ?? 0) || 0)
      const budgetRejectedMissCountDay = Math.max(0, Number(d2?.budgetRejectedMissCount ?? 0) || 0)
      preFalsePositiveApprovedCount += preFalsePositiveApprovedCountDay
      falsePositiveRejectedCount += falsePositiveRejectedCountDay
      falsePositiveRejectedHitCount += falsePositiveRejectedHitCountDay
      falsePositiveRejectedMissCount += falsePositiveRejectedMissCountDay
      falsePositiveModelAvailableCount += falsePositiveModelAvailableCountDay
      budgetRejectedCount += budgetRejectedCountDay
      budgetRejectedHitCount += budgetRejectedHitCountDay
      budgetRejectedMissCount += budgetRejectedMissCountDay
      if (inUpdateSplit) {
        preFalsePositiveApprovedCountUpdate += preFalsePositiveApprovedCountDay
        falsePositiveRejectedCountUpdate += falsePositiveRejectedCountDay
        falsePositiveRejectedHitCountUpdate += falsePositiveRejectedHitCountDay
        falsePositiveRejectedMissCountUpdate += falsePositiveRejectedMissCountDay
        falsePositiveModelAvailableCountUpdate += falsePositiveModelAvailableCountDay
        budgetRejectedCountUpdate += budgetRejectedCountDay
        budgetRejectedHitCountUpdate += budgetRejectedHitCountDay
        budgetRejectedMissCountUpdate += budgetRejectedMissCountDay
      }
      if (inEvalSplit) {
        preFalsePositiveApprovedCountEval += preFalsePositiveApprovedCountDay
        falsePositiveRejectedCountEval += falsePositiveRejectedCountDay
        falsePositiveRejectedHitCountEval += falsePositiveRejectedHitCountDay
        falsePositiveRejectedMissCountEval += falsePositiveRejectedMissCountDay
        falsePositiveModelAvailableCountEval += falsePositiveModelAvailableCountDay
        budgetRejectedCountEval += budgetRejectedCountDay
        budgetRejectedHitCountEval += budgetRejectedHitCountDay
        budgetRejectedMissCountEval += budgetRejectedMissCountDay
      }
      for (const [decision, countRaw] of Object.entries(executionDecisionCountsDay)) {
        const count = Math.max(0, Number(countRaw ?? 0) || 0)
        if (count < 1) continue
        executionDecisionCounts[decision] = Number(executionDecisionCounts[decision] ?? 0) + count
        if (inUpdateSplit) {
          executionDecisionCountsUpdate[decision] = Number(executionDecisionCountsUpdate[decision] ?? 0) + count
        }
        if (inEvalSplit) {
          executionDecisionCountsEval[decision] = Number(executionDecisionCountsEval[decision] ?? 0) + count
        }
      }
      for (const [reason, countRaw] of Object.entries(executionShadowReasonCountsDay)) {
        const count = Math.max(0, Number(countRaw ?? 0) || 0)
        if (count < 1) continue
        executionShadowReasonCounts[reason] = Number(executionShadowReasonCounts[reason] ?? 0) + count
        if (inUpdateSplit) {
          executionShadowReasonCountsUpdate[reason] = Number(executionShadowReasonCountsUpdate[reason] ?? 0) + count
        }
        if (inEvalSplit) {
          executionShadowReasonCountsEval[reason] = Number(executionShadowReasonCountsEval[reason] ?? 0) + count
        }
      }
      for (const [decision, countRaw] of Object.entries(falsePositiveDecisionCountsDay)) {
        const count = Math.max(0, Number(countRaw ?? 0) || 0)
        if (count < 1) continue
        falsePositiveDecisionCounts[decision] = Number(falsePositiveDecisionCounts[decision] ?? 0) + count
        if (inUpdateSplit) {
          falsePositiveDecisionCountsUpdate[decision] = Number(falsePositiveDecisionCountsUpdate[decision] ?? 0) + count
        }
        if (inEvalSplit) {
          falsePositiveDecisionCountsEval[decision] = Number(falsePositiveDecisionCountsEval[decision] ?? 0) + count
        }
      }
      for (const [reason, countRaw] of Object.entries(falsePositiveReasonCountsDay)) {
        const count = Math.max(0, Number(countRaw ?? 0) || 0)
        if (count < 1) continue
        falsePositiveReasonCounts[reason] = Number(falsePositiveReasonCounts[reason] ?? 0) + count
        if (inUpdateSplit) {
          falsePositiveReasonCountsUpdate[reason] = Number(falsePositiveReasonCountsUpdate[reason] ?? 0) + count
        }
        if (inEvalSplit) {
          falsePositiveReasonCountsEval[reason] = Number(falsePositiveReasonCountsEval[reason] ?? 0) + count
        }
      }
      for (const [decision, countRaw] of Object.entries(budgetDecisionCountsDay)) {
        const count = Math.max(0, Number(countRaw ?? 0) || 0)
        if (count < 1) continue
        budgetDecisionCounts[decision] = Number(budgetDecisionCounts[decision] ?? 0) + count
        if (inUpdateSplit) {
          budgetDecisionCountsUpdate[decision] = Number(budgetDecisionCountsUpdate[decision] ?? 0) + count
        }
        if (inEvalSplit) {
          budgetDecisionCountsEval[decision] = Number(budgetDecisionCountsEval[decision] ?? 0) + count
        }
      }
      for (const [reason, countRaw] of Object.entries(budgetReasonCountsDay)) {
        const count = Math.max(0, Number(countRaw ?? 0) || 0)
        if (count < 1) continue
        budgetReasonCounts[reason] = Number(budgetReasonCounts[reason] ?? 0) + count
        if (inUpdateSplit) {
          budgetReasonCountsUpdate[reason] = Number(budgetReasonCountsUpdate[reason] ?? 0) + count
        }
        if (inEvalSplit) {
          budgetReasonCountsEval[reason] = Number(budgetReasonCountsEval[reason] ?? 0) + count
        }
      }
      const executedPick = executionPicks[0] ?? null

      const before = { ...weights }
      let after = { ...weights }
      let regret = null
      let rankLoss = null

      if (picks.length < 1 && Number.isInteger(firstSuccessRank)) {
        gateRejectedHitDays += 1
        if (inUpdateSplit) gateRejectedHitDaysUpdate += 1
        if (inEvalSplit) gateRejectedHitDaysEval += 1
      }

      if (picks.length > 0) {
        explorationDecisionDays += 1
        const selectionMode = String(selectionPolicy?.mode ?? "").toUpperCase()
        if (selectionPolicy?.applied === true) explorationAppliedDays += 1
        if (selectionMode === "EXPLORE") explorationExploreDays += 1
        if (selectionMode === "RECOVERY") coverageRecoveryDays += 1
        if (selectionMode === "AGREEMENT_FALLBACK") {
          agreementFallbackDays += 1
          if (inUpdateSplit) agreementFallbackDaysUpdate += 1
          if (inEvalSplit) agreementFallbackDaysEval += 1
        }
        if (Number.isFinite(Number(selectionPolicy?.epsilon))) {
          explorationEpsilonSum += Number(selectionPolicy.epsilon)
        }
        if (propensity !== null) {
          explorationPropensitySum += propensity
        }
        pickedDays += 1
        pickedCount += picks.length
        if (inUpdateSplit) {
          pickedDaysUpdate += 1
          pickedCountUpdate += picks.length
        }
        if (inEvalSplit) {
          pickedDaysEval += 1
          pickedCountEval += picks.length
        }
        executionDecisionDays += 1
        if (executionPicks.length > 0) {
          executedDays += 1
          executedCount += executionPicks.length
          if (inUpdateSplit) {
            executedDaysUpdate += 1
            executedCountUpdate += executionPicks.length
          }
          if (inEvalSplit) {
            executedDaysEval += 1
            executedCountEval += executionPicks.length
          }
        }
        if (executionPicks.length < picks.length) {
          executionShadowDays += 1
          if (inUpdateSplit) executionShadowDaysUpdate += 1
          if (inEvalSplit) executionShadowDaysEval += 1
          if (executionBlockedCountDay > 0) {
            executionBlockedDays += 1
            if (inUpdateSplit) executionBlockedDaysUpdate += 1
            if (inEvalSplit) executionBlockedDaysEval += 1
          }
          if (executionPicks.length === 0) {
            executionShadowOnlyDays += 1
            if (inUpdateSplit) executionShadowOnlyDaysUpdate += 1
            if (inEvalSplit) executionShadowOnlyDaysEval += 1
            if (executionBlockedCountDay >= picks.length) {
              executionBlockedOnlyDays += 1
              if (inUpdateSplit) executionBlockedOnlyDaysUpdate += 1
              if (inEvalSplit) executionBlockedOnlyDaysEval += 1
            }
          }
        }
        if (picks.length === 1) onePickDays += 1
        if (inEvalSplit && picks.length > 1) twoPickDaysEval += 1
        const dayHasHit = picks.some((row) => row.successInWindow === true)
        if (dayHasHit) {
          dayHitDays += 1
          if (inUpdateSplit) dayHitDaysUpdate += 1
          if (inEvalSplit) dayHitDaysEval += 1
          if (selectionMode === "RECOVERY") {
            coverageRecoveryHitDays += 1
          }
        }
        if (executionPicks.length === 0 && dayHasHit) {
          executionRejectedHitDays += 1
          if (inUpdateSplit) executionRejectedHitDaysUpdate += 1
          if (inEvalSplit) executionRejectedHitDaysEval += 1
        }
        const firstPick = picks[0] ?? null
        const secondPick = picks[1] ?? null
        if (firstPick) {
          firstPickCount += 1
          if (firstPick.successInWindow === true) firstPickHitCount += 1
          if (selectionMode === "AGREEMENT_FALLBACK" && firstPick.successInWindow === true) {
            agreementFallbackHitDays += 1
            if (inUpdateSplit) agreementFallbackHitDaysUpdate += 1
            if (inEvalSplit) agreementFallbackHitDaysEval += 1
            if (firstSuccessRank === 1) {
              agreementFallbackHitAt1OverlapDays += 1
              if (inUpdateSplit) agreementFallbackHitAt1OverlapDaysUpdate += 1
              if (inEvalSplit) agreementFallbackHitAt1OverlapDaysEval += 1
            }
          }
          const firstExpected = Number(firstPick.expectedNetRet3d ?? 0)
          if (Number.isFinite(firstExpected)) {
            firstPickExpectedNetRet3dSum += firstExpected
            if (picks.length === 1) {
              onePickDayExpectedNetRet3dSum += firstExpected
            }
          }
        }
        if (secondPick) {
          dualPickDays += 1
          secondPickCount += 1
          if (secondPick.successInWindow === true) secondPickHitCount += 1
          const secondExpected = Number(secondPick.expectedNetRet3d ?? 0)
          if (Number.isFinite(secondExpected)) {
            secondPickExpectedNetRet3dSum += secondExpected
          }
          const firstExpected = Number(firstPick?.expectedNetRet3d ?? 0)
          if (Number.isFinite(secondExpected) || Number.isFinite(firstExpected)) {
            dualPickDayExpectedNetRet3dSum +=
              (Number.isFinite(firstExpected) ? firstExpected : 0) +
              (Number.isFinite(secondExpected) ? secondExpected : 0)
          }
          if (firstPick?.successInWindow !== true && secondPick.successInWindow === true) {
            secondBeatFirstDays += 1
          }
        }
        for (const row of picks) {
          const regimeTag = String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN")
          const isTargetHit = row?.successInWindow === true
          const isStopHit = row?.stopTriggeredInWindow === true && !isTargetHit
          const isTimeout = !isTargetHit && !isStopHit
          const isTimeoutNegative = isTimeout && row?.timeoutNegativeInWindow === true
          const regimeStat = pickedRegimeStats.get(regimeTag) ?? {
            pickedCount: 0,
            pickHitCount: 0
          }
          regimeStat.pickedCount += 1
          if (isTargetHit) {
            regimeStat.pickHitCount += 1
          }
          pickedRegimeStats.set(regimeTag, regimeStat)
          if (isTargetHit) {
            pickHitCount += 1
            if (inUpdateSplit) pickHitCountUpdate += 1
            if (inEvalSplit) pickHitCountEval += 1
          } else if (isStopHit) {
            pickStopCount += 1
            if (inUpdateSplit) pickStopCountUpdate += 1
            if (inEvalSplit) pickStopCountEval += 1
          } else if (isTimeout) {
            pickTimeoutCount += 1
            if (inUpdateSplit) pickTimeoutCountUpdate += 1
            if (inEvalSplit) pickTimeoutCountEval += 1
            if (isTimeoutNegative) {
              pickTimeoutNegativeCount += 1
              if (inUpdateSplit) pickTimeoutNegativeCountUpdate += 1
              if (inEvalSplit) pickTimeoutNegativeCountEval += 1
            }
          }
          if (row?.executionDecision === "TRADE") {
            if (selectionMode === "AGREEMENT_FALLBACK" && row === firstPick) {
              agreementFallbackExecutedDays += 1
              if (inUpdateSplit) agreementFallbackExecutedDaysUpdate += 1
              if (inEvalSplit) agreementFallbackExecutedDaysEval += 1
            }
            const executedRegimeStat = executedRegimeStats.get(regimeTag) ?? {
              pickedCount: 0,
              pickHitCount: 0
            }
            executedRegimeStat.pickedCount += 1
            if (isTargetHit) {
              if (selectionMode === "AGREEMENT_FALLBACK" && row === firstPick) {
                agreementFallbackExecutedHitDays += 1
                if (inUpdateSplit) agreementFallbackExecutedHitDaysUpdate += 1
                if (inEvalSplit) agreementFallbackExecutedHitDaysEval += 1
              }
              executedRegimeStat.pickHitCount += 1
              executedHitCount += 1
              if (inUpdateSplit) executedHitCountUpdate += 1
              if (inEvalSplit) executedHitCountEval += 1
            } else if (isStopHit) {
              executedStopCount += 1
              if (inUpdateSplit) executedStopCountUpdate += 1
              if (inEvalSplit) executedStopCountEval += 1
            } else if (isTimeout) {
              executedTimeoutCount += 1
              if (inUpdateSplit) executedTimeoutCountUpdate += 1
              if (inEvalSplit) executedTimeoutCountEval += 1
              if (isTimeoutNegative) {
                executedTimeoutNegativeCount += 1
                if (inUpdateSplit) executedTimeoutNegativeCountUpdate += 1
                if (inEvalSplit) executedTimeoutNegativeCountEval += 1
              }
            }
            executedRegimeStats.set(regimeTag, executedRegimeStat)
            if (inEvalSplit) {
              const executedEvalStat = executedRegimeStatsEval.get(regimeTag) ?? {
                pickedCount: 0,
                pickHitCount: 0
              }
              executedEvalStat.pickedCount += 1
              if (row?.successInWindow === true) executedEvalStat.pickHitCount += 1
              executedRegimeStatsEval.set(regimeTag, executedEvalStat)
            }
          }
          const maxWindowJumpPct = Number(row?.maxWindowJumpPct)
          if (Number.isFinite(maxWindowJumpPct)) {
            pickMaxWindowJumpPctSum += maxWindowJumpPct
            pickMaxWindowJumpPctCount += 1
            if (!Number.isFinite(Number(pickMaxWindowJumpPctMax)) || maxWindowJumpPct > Number(pickMaxWindowJumpPctMax)) {
              pickMaxWindowJumpPctMax = maxWindowJumpPct
            }
            if (inEvalSplit) {
              pickMaxWindowJumpPctSumEval += maxWindowJumpPct
              pickMaxWindowJumpPctCountEval += 1
              if (!Number.isFinite(Number(pickMaxWindowJumpPctMaxEval)) || maxWindowJumpPct > Number(pickMaxWindowJumpPctMaxEval)) {
                pickMaxWindowJumpPctMaxEval = maxWindowJumpPct
              }
            }
            if (row?.executionDecision === 'TRADE') {
              executedMaxWindowJumpPctSum += maxWindowJumpPct
              executedMaxWindowJumpPctCount += 1
              if (!Number.isFinite(Number(executedMaxWindowJumpPctMax)) || maxWindowJumpPct > Number(executedMaxWindowJumpPctMax)) {
                executedMaxWindowJumpPctMax = maxWindowJumpPct
              }
              if (inEvalSplit) {
                executedMaxWindowJumpPctSumEval += maxWindowJumpPct
                executedMaxWindowJumpPctCountEval += 1
                if (!Number.isFinite(Number(executedMaxWindowJumpPctMaxEval)) || maxWindowJumpPct > Number(executedMaxWindowJumpPctMaxEval)) {
                  executedMaxWindowJumpPctMaxEval = maxWindowJumpPct
                }
              }
            }
          }
          const expected = Number(row?.expectedNetRet3d ?? 0)
          if (Number.isFinite(expected)) {
            pickExpectedNetRet3dSum += expected
          }
          if (inEvalSplit) {
            const evalRegimeTag = String(row?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN")
            const evalStat = pickedRegimeStatsEval.get(evalRegimeTag) ?? {
              pickedCount: 0,
              pickHitCount: 0
            }
            evalStat.pickedCount += 1
            if (row?.successInWindow === true) evalStat.pickHitCount += 1
            pickedRegimeStatsEval.set(evalRegimeTag, evalStat)
          }
          const prototypeId = String(row?.matchedPrototypeId ?? "").trim() || "__NONE__"
          const clusterId = String(row?.matchedPrototypeClusterId ?? "").trim() || "__NONE__"
          const prototypeFamilyKey = clusterId || prototypeId
          const prototypeStats = pickedPrototypeStats.get(prototypeId) ?? {
            pickedCount: 0,
            pickHitCount: 0
          }
          prototypeStats.pickedCount += 1
          if (row?.successInWindow === true) prototypeStats.pickHitCount += 1
          pickedPrototypeStats.set(prototypeId, prototypeStats)
          pickedClusterCounts.set(clusterId, Number(pickedClusterCounts.get(clusterId) ?? 0) + 1)
          if (inUpdateSplit) {
            const prototypeStatsUpdate = pickedPrototypeStatsUpdate.get(prototypeId) ?? {
              pickedCount: 0,
              pickHitCount: 0
            }
            prototypeStatsUpdate.pickedCount += 1
            if (row?.successInWindow === true) prototypeStatsUpdate.pickHitCount += 1
            pickedPrototypeStatsUpdate.set(prototypeId, prototypeStatsUpdate)
            pickedClusterCountsUpdate.set(
              clusterId,
              Number(pickedClusterCountsUpdate.get(clusterId) ?? 0) + 1
            )
            const updateRegimeStats = updateRegimeOutcomeStats.get(regimeTag) ?? {
              count: 0,
              hitCount: 0
            }
            updateRegimeStats.count += 1
            if (row?.successInWindow === true) updateRegimeStats.hitCount += 1
            updateRegimeOutcomeStats.set(regimeTag, updateRegimeStats)
          }
          if (inEvalSplit) {
            const prototypeStatsEval = pickedPrototypeStatsEval.get(prototypeId) ?? {
              pickedCount: 0,
              pickHitCount: 0
            }
            prototypeStatsEval.pickedCount += 1
            if (row?.successInWindow === true) prototypeStatsEval.pickHitCount += 1
            pickedPrototypeStatsEval.set(prototypeId, prototypeStatsEval)
            pickedClusterCountsEval.set(
              clusterId,
              Number(pickedClusterCountsEval.get(clusterId) ?? 0) + 1
            )
          }
          if (
            inUpdateSplit &&
            (
              generalizationCfg?.extendedBias?.enabled === true ||
              generalizationCfg?.tradeQualityPrior?.enabled === true
            )
          ) {
            const tradeOutcome = simulateFeedbackTradeOutcome(row, decisionDateKey)
            if (generalizationCfg?.extendedBias?.enabled === true) {
              const outcome = resolveExtendedBiasOutcome({
                row,
                decisionDateKey,
                tradeOutcome
              })
              if (Number.isFinite(Number(outcome))) {
                updateBiasValue({
                  map: routeBiasState,
                  key: row?.routeBucket ?? regimeRouterCfg.defaultBucket,
                  outcome,
                  cfg: generalizationCfg?.extendedBias
                })
                updateBiasValue({
                  map: regimeBiasState,
                  key: regimeTag,
                  outcome,
                  cfg: generalizationCfg?.extendedBias
                })
                updateBiasValue({
                  map: prototypeBiasState,
                  key: prototypeFamilyKey,
                  outcome,
                  cfg: generalizationCfg?.extendedBias
                })
              }
            }
          }
        }
        const tradeQualityPriorCfg = generalizationCfg?.tradeQualityPrior ?? {}
        if (inUpdateSplit && tradeQualityPriorCfg?.enabled === true) {
          const tradeQualityRows =
            tradeQualityPriorCfg?.sourceMode === "executed_only" ? executionPicks : picks
          for (const tradeQualityRow of tradeQualityRows) {
            const tradeOutcome = simulateFeedbackTradeOutcome(tradeQualityRow, decisionDateKey)
            if (tradeOutcome?.available !== true) continue
            const tradeQualityRegimeTag = String(
              tradeQualityRow?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN",
            )
            const tradeQualityPrototypeId =
              String(tradeQualityRow?.matchedPrototypeId ?? "").trim() || "__NONE__"
            const tradeQualityClusterId =
              String(tradeQualityRow?.matchedPrototypeClusterId ?? "").trim() || "__NONE__"
            const tradeQualityPrototypeFamilyKey =
              tradeQualityClusterId || tradeQualityPrototypeId
            updateTradeQualityPriorState({
              state: globalTradeQualityState,
              key: "__GLOBAL__",
              tradeOutcome
            })
            updateTradeQualityPriorState({
              state: routeTradeQualityState,
              key: tradeQualityRow?.routeBucket ?? regimeRouterCfg.defaultBucket,
              tradeOutcome
            })
            updateTradeQualityPriorState({
              state: regimeTradeQualityState,
              key: tradeQualityRegimeTag,
              tradeOutcome
            })
            updateTradeQualityPriorState({
              state: prototypeTradeQualityState,
              key: tradeQualityPrototypeFamilyKey,
              tradeOutcome
            })
          }
        }
        const pickedSymbolSet = new Set(picks.map((row) => String(row?.symbol ?? "").trim()))
        const altSuccess = top.find(
          (row) => row.successInWindow === true && !pickedSymbolSet.has(String(row?.symbol ?? "").trim()),
        ) ?? null
        const top1 = top?.[0] ?? null
        const bestSuccess = top.find((row) => row?.successInWindow === true) ?? null
        if (
          top1 &&
          bestSuccess &&
          top1?.successInWindow !== true &&
          String(top1?.symbol ?? "") !== String(bestSuccess?.symbol ?? "")
        ) {
          const top1Score = Number(top1?.finalScore ?? top1?.score ?? 0)
          const bestSuccessScore = Number(bestSuccess?.finalScore ?? bestSuccess?.score ?? 0)
          const margin = top1Score - bestSuccessScore
          if (Number.isFinite(margin) && margin > 0) {
            rankLoss = margin
          }
        }
        if (Number.isFinite(rankLoss) && rankLoss > 0) {
          rankLossDays += 1
          rankLossSum += rankLoss
          rankLossMax = Math.max(rankLossMax, rankLoss)
          if (inUpdateSplit) {
            rankLossDaysUpdate += 1
            rankLossSumUpdate += rankLoss
          }
          if (inEvalSplit) {
            rankLossDaysEval += 1
            rankLossSumEval += rankLoss
          }
        }
        if (pick && pick.successInWindow !== true && altSuccess) {
          regret = (altSuccess.finalScore ?? 0) - (pick.finalScore ?? 0)
        }
        if (Number.isFinite(regret)) {
          regretSum += regret
          regretCount += 1
          if (inUpdateSplit) {
            regretSumUpdate += regret
            regretCountUpdate += 1
          }
          if (inEvalSplit) {
            regretSumEval += regret
            regretCountEval += 1
          }
        }

        enqueueExecutionFeedback({
          decisionDateKey: decisionDateKeyText,
          inUpdateSplit,
          executionRows: d2?.executionFeedbackRows ?? [],
          falsePositiveRows: d2?.falsePositiveFeedbackRows ?? [],
          dayTypeDecision
        })
      } else if (gate.gateReason !== "TRADE") {
        skippedByGate += 1
        enqueueBlockedTopFeedback({
          decisionDateKey: decisionDateKeyText,
          inUpdateSplit,
          top,
          dayTypeDecision
        })
      }

      enqueueFeedback({
        decisionDateKey: decisionDateKeyText,
        inUpdateSplit,
        top,
        picks
      })

      const executedTradeOutcome = simulateFeedbackTradeOutcome(d2?.executedPick ?? null, decisionDateKey)
      const dayTypeDatasetRow = buildDayTypeDatasetRow({
        decisionDateKey,
        split:
          inUpdateSplit && inEvalSplit
            ? "U+V"
            : inEvalSplit
              ? "V"
              : inUpdateSplit
                ? "U"
                : "ONLINE",
        ruleDecision: ruleDayTypeDecision,
        finalDecision: dayTypeDecision,
        candidateHit: top.some((row) => row?.successInWindow === true),
        selectedHit: picks.some((row) => row?.successInWindow === true),
        executedHit:
          executedTradeOutcome?.available === true &&
          executedTradeOutcome?.liveLockboxFailure !== true,
        executedNetRet: executedTradeOutcome?.realizedNetRet ?? null,
        executedOutcomeSource: executedTradeOutcome?.labelSource ?? null,
        top1Blocked:
          Array.isArray(d1?.picks) &&
          d1.picks.length > 0 &&
          !(d2?.executedPick)
      })
      if (isUpdateLikePartition(dayTypeDatasetRow?.split)) {
        dayTypeDatasetRows.push(dayTypeDatasetRow)
      }
      if (inUpdateSplit && dayTypeModelCfg.enabled === true) {
        dayTypeModel = updateDayTypeModelOnline({
          model: dayTypeModel,
          featureMap: dayTypeDatasetRow?.modelFeatures ?? {},
          label: dayTypeDatasetRow?.trainingLabel ?? dayTypeDatasetRow?.ruleDayType ?? "BALANCED",
          labelScores: dayTypeDatasetRow?.trainingLabelScores ?? null,
          cfg: dayTypeModelCfg
        })
      }

      const sampledDebugEligible =
        sampledDebugEnabled &&
        (!sampledDebugEvalOnly || inEvalSplit) &&
        (
          sampledDebugSelectedOrRejectedOnly
            ? (picks.length > 0 || gate.gateReason !== "TRADE")
            : true
        )
      if (sampledDebugEligible) {
        const sampledRows = top.slice(0, sampledDebugTopK).map((row) => ({
          symbol: row.symbol,
          baseScore: Number(row.baseScore ?? row.score ?? 0),
          finalScore: Number(row.finalScore ?? row.score ?? 0),
          rawSimilarityScore: Number.isFinite(Number(row?.rawSimilarityScore))
            ? Number(row.rawSimilarityScore)
            : null,
          globalStageScore: Number.isFinite(Number(row?.globalStageScore))
            ? Number(row.globalStageScore)
            : null,
          localStageScore: Number.isFinite(Number(row?.localStageScore))
            ? Number(row.localStageScore)
            : null,
          triggerStageScore: Number.isFinite(Number(row?.triggerStageScore))
            ? Number(row.triggerStageScore)
            : null,
          positiveTop2RawSimilarity: Number.isFinite(Number(row?.positiveTop2RawSimilarity))
            ? Number(row.positiveTop2RawSimilarity)
            : null,
          top1Top2PositiveGap: Number.isFinite(Number(row?.top1Top2PositiveGap))
            ? Number(row.top1Top2PositiveGap)
            : null,
          positiveVsNegativeGap: Number.isFinite(Number(row?.positiveVsNegativeGap))
            ? Number(row.positiveVsNegativeGap)
            : null,
          negativeTop1RawSimilarity: Number.isFinite(Number(row?.negativeTop1RawSimilarity))
            ? Number(row.negativeTop1RawSimilarity)
            : null,
          negativeTop1StopRawSimilarity: Number.isFinite(Number(row?.negativeTop1StopRawSimilarity))
            ? Number(row.negativeTop1StopRawSimilarity)
            : null,
          negativeTop1TimeoutNegativeRawSimilarity: Number.isFinite(
            Number(row?.negativeTop1TimeoutNegativeRawSimilarity),
          )
            ? Number(row.negativeTop1TimeoutNegativeRawSimilarity)
            : null,
          negativeTop1LowExecutionQualityRawSimilarity: Number.isFinite(
            Number(row?.negativeTop1LowExecutionQualityRawSimilarity),
          )
            ? Number(row.negativeTop1LowExecutionQualityRawSimilarity)
            : null,
          positiveTop2PrototypeId: row?.positiveTop2PrototypeId ?? null,
          negativeTop1PrototypeId: row?.negativeTop1PrototypeId ?? null,
          negativeTop1OutcomeBucket: row?.negativeTop1OutcomeBucket ?? null,
          similarityGateRejectReasons: Array.isArray(row?.similarityGateRejectReasons)
            ? row.similarityGateRejectReasons
            : [],
          expectedNetRet3d: Number(row.expectedNetRet3d ?? 0),
          qualityScore: Number(row.qualityScore ?? 0),
          antiScore: Number(row.antiScore ?? 0),
          targetRate3d: Number(row.targetRate3d ?? 0),
          stopRate3d: Number(row.stopRate3d ?? 0),
          matchedPrototypeId: row.matchedPrototypeId ?? null,
          clusterId: row.matchedPrototypeClusterId ?? null,
          routeBucket: row.routeBucket ?? null,
          rankIndex: Number.isFinite(Number(row?.rankIndex)) ? Number(row.rankIndex) : null,
          rankSize: Number.isFinite(Number(row?.rankSize)) ? Number(row.rankSize) : null,
          rankPct: Number.isFinite(Number(row?.rankPct)) ? Number(row.rankPct) : null,
          finalScoreZWithinDay: Number.isFinite(Number(row?.finalScoreZWithinDay))
            ? Number(row.finalScoreZWithinDay)
            : null,
          marginZWithinDay: Number.isFinite(Number(row?.marginZWithinDay))
            ? Number(row.marginZWithinDay)
            : null,
          pHitCalibrated: Number(row?.calibrated?.pHitCalibrated ?? 0),
          pStopFirstCalibrated: Number(row?.calibrated?.pStopFirstCalibrated ?? 0),
          pFillCalibrated: Number(row?.calibrated?.pFillCalibrated ?? 0),
          confidence: Number(row?.calibrated?.confidence ?? 0),
          agreementScore: Number.isFinite(Number(row?.agreementScore))
            ? Number(row.agreementScore)
            : null,
          agreementDecision: row?.agreementDecision ?? null,
          agreementReason: row?.agreementReason ?? null,
          preRerankScoreMargin: Number.isFinite(Number(row?.preRerankScoreMargin))
            ? Number(row.preRerankScoreMargin)
            : null,
          preRerankMargin: Number.isFinite(Number(row?.preRerankScoreMargin))
            ? Number(row.preRerankScoreMargin)
            : null,
          postRerankScoreMargin: Number.isFinite(Number(row?.postRerankScoreMargin))
            ? Number(row.postRerankScoreMargin)
            : null,
          postRerankMargin: Number.isFinite(Number(row?.postRerankScoreMargin))
            ? Number(row.postRerankScoreMargin)
            : null,
          gateScoreMargin: Number.isFinite(Number(row?.gateScoreMargin ?? row?.rawScoreMargin))
            ? Number(row?.gateScoreMargin ?? row?.rawScoreMargin)
            : null,
          negativeMarginAfterRerank: row?.negativeMarginAfterRerank === true,
          metaDecision: row.metaDecision ?? null,
          metaReason: row.metaReason ?? null,
          metaDiagnosticDecision: row.metaDiagnosticDecision ?? null,
          metaDiagnosticReason: row.metaDiagnosticReason ?? null,
          metaDiagnosticOnly: row.metaDiagnosticOnly === true,
          successInWindow: row.successInWindow === true,
          budgetDecision: row.budgetDecision ?? null,
          budgetReason: row.budgetReason ?? null,
          executionDecision: row.executionDecision ?? null,
          executionShadowReason: row.executionShadowReason ?? null
        }))
        sampledDebugLogs.push({
          decisionDateKey,
          partition:
            inUpdateSplit && inEvalSplit
              ? "U+V"
              : inEvalSplit
                ? "V"
                : inUpdateSplit
                  ? "U"
                  : "ONLINE",
          dayType: String(dayTypeDecision?.dayType ?? "BALANCED"),
          dayTypeNoTrade: dayTypeDecision?.noTrade === true,
          dayTypePolicySource,
          gateReason: gate.gateReason,
          pickCount: picks.length,
          pickedSymbols: picks.map((row) => String(row?.symbol ?? "").trim()).filter(Boolean),
          executedCount: executionPicks.length,
          executedSymbols: executionPicks.map((row) => String(row?.symbol ?? "").trim()).filter(Boolean),
          executionShadowReasonCounts: executionShadowReasonCountsDay,
          budgetDecisionCounts: budgetDecisionCountsDay,
          executionBlockedCount: executionBlockedCountDay,
          similarityGate: {
            enabled: decisionGateCfg?.similarityGate?.enabled === true,
            disambiguationEnabled: similarityDisambiguationEnabled,
            scoredCount: candidateCount,
            passedCount: similarityGatePassedForDay,
            rejectedCount: similarityGateRejectedForDay,
            rejectReasonCounts: similarityGateRejectReasonCountsDay,
            winnerChangedAfterSimilarityGateDay,
            top1RejectedBySimilarityGateDay,
            oracleHitRejectedBySimilarityGateDay,
            preGateTop1: toSimilarityGateTopCandidateSummary(preGateTopCandidates[0]),
            postGateTop1: toSimilarityGateTopCandidateSummary(topCandidates[0])
          },
          agreementGate: gate?.agreementGate ?? null,
          firstSuccessRank,
          rows: sampledRows
        })
        sampledDebugRows += sampledRows.length
      }

      const top1Path = buildTop1PathTrace({
        d1,
        d2,
        fallbackGateReason: gate.gateReason
      })
      const agreementBlocked =
        decisionGateCfg?.agreementGate?.enabled === true &&
        top1AgreementDecision &&
        top1AgreementDecision !== "TRADE"
      const agreementGateTelemetry = buildAgreementGateDayTelemetry({
        rows: top,
        top1: top?.[0] ?? null,
        agreementGate: gate?.agreementGate ?? null,
        agreementGateCfg: decisionGateCfg?.agreementGate,
        agreementModelCfg: agreementGateModelCfg,
        top1Path,
        agreementBlocked
      })
      if (agreementGateTelemetry.blockedDay) {
        agreementBlockedDays += 1
        if (inUpdateSplit) agreementBlockedDaysUpdate += 1
        if (inEvalSplit) agreementBlockedDaysEval += 1
        if (agreementGateTelemetry.blockedTop1WouldHaveHitDay) {
          agreementBlockedTop1WouldHaveHitDays += 1
          if (inUpdateSplit) agreementBlockedTop1WouldHaveHitDaysUpdate += 1
          if (inEvalSplit) agreementBlockedTop1WouldHaveHitDaysEval += 1
        }
        if (agreementGateTelemetry.modelUnavailableDay) {
          agreementModelUnavailableDays += 1
          if (inUpdateSplit) agreementModelUnavailableDaysUpdate += 1
          if (inEvalSplit) agreementModelUnavailableDaysEval += 1
        }
        if (agreementGateTelemetry.reason === "AGREEMENT_CONSENSUS_LOW") {
          agreementConsensusLowDays += 1
          if (inUpdateSplit) agreementConsensusLowDaysUpdate += 1
          if (inEvalSplit) agreementConsensusLowDaysEval += 1
        } else if (agreementGateTelemetry.reason === "AGREEMENT_STABILITY_LOW") {
          agreementStabilityLowDays += 1
          if (inUpdateSplit) agreementStabilityLowDaysUpdate += 1
          if (inEvalSplit) agreementStabilityLowDaysEval += 1
        } else if (agreementGateTelemetry.reason === "AGREEMENT_SCORE_LOW") {
          agreementScoreLowDays += 1
          if (inUpdateSplit) agreementScoreLowDaysUpdate += 1
          if (inEvalSplit) agreementScoreLowDaysEval += 1
        }
        pushSplitNumericSample({
          allValues: agreementBlockedAgreementScoreSamples,
          updateValues: agreementBlockedAgreementScoreSamplesUpdate,
          evalValues: agreementBlockedAgreementScoreSamplesEval,
          value: agreementGateTelemetry.agreementScore,
          inUpdateSplit,
          inEvalSplit
        })
        pushSplitNumericSample({
          allValues: agreementBlockedRawSimilaritySamples,
          updateValues: agreementBlockedRawSimilaritySamplesUpdate,
          evalValues: agreementBlockedRawSimilaritySamplesEval,
          value: agreementGateTelemetry.rawSimilarityScore,
          inUpdateSplit,
          inEvalSplit
        })
        pushSplitNumericSample({
          allValues: agreementBlockedLocalStageSamples,
          updateValues: agreementBlockedLocalStageSamplesUpdate,
          evalValues: agreementBlockedLocalStageSamplesEval,
          value: agreementGateTelemetry.localStageScore,
          inUpdateSplit,
          inEvalSplit
        })
        pushSplitNumericSample({
          allValues: agreementBlockedTriggerStageSamples,
          updateValues: agreementBlockedTriggerStageSamplesUpdate,
          evalValues: agreementBlockedTriggerStageSamplesEval,
          value: agreementGateTelemetry.triggerStageScore,
          inUpdateSplit,
          inEvalSplit
        })
        pushSplitNumericSample({
          allValues: agreementBlockedGateScoreMarginSamples,
          updateValues: agreementBlockedGateScoreMarginSamplesUpdate,
          evalValues: agreementBlockedGateScoreMarginSamplesEval,
          value: agreementGateTelemetry.gateScoreMargin,
          inUpdateSplit,
          inEvalSplit
        })
        pushSplitNumericSample({
          allValues: agreementBlockedConsensusRateSamples,
          updateValues: agreementBlockedConsensusRateSamplesUpdate,
          evalValues: agreementBlockedConsensusRateSamplesEval,
          value: agreementGateTelemetry.consensusRate,
          inUpdateSplit,
          inEvalSplit
        })
        pushSplitNumericSample({
          allValues: agreementBlockedStabilityRateSamples,
          updateValues: agreementBlockedStabilityRateSamplesUpdate,
          evalValues: agreementBlockedStabilityRateSamplesEval,
          value: agreementGateTelemetry.stabilityRate,
          inUpdateSplit,
          inEvalSplit
        })
        recordAgreementBlockedBucket({
          bucket:
            agreementGateTelemetry.blockedTop1WouldHaveHitDay === true
              ? agreementBlockedHitStats
              : agreementBlockedMissStats,
          telemetry: agreementGateTelemetry
        })
        if (inUpdateSplit) {
          recordAgreementBlockedBucket({
            bucket:
              agreementGateTelemetry.blockedTop1WouldHaveHitDay === true
                ? agreementBlockedHitStatsUpdate
                : agreementBlockedMissStatsUpdate,
            telemetry: agreementGateTelemetry
          })
        }
        if (inEvalSplit) {
          recordAgreementBlockedBucket({
            bucket:
              agreementGateTelemetry.blockedTop1WouldHaveHitDay === true
                ? agreementBlockedHitStatsEval
                : agreementBlockedMissStatsEval,
            telemetry: agreementGateTelemetry
          })
        }
      }

	      logs.push({
	        decisionDateKey,
	        goalMode,
	        positionSemantics,
	        targetFirstMode: goalMode === "TARGET_FIRST_V2",
	        partition:
          inUpdateSplit && inEvalSplit
            ? "U+V"
            : inEvalSplit
              ? "V"
              : inUpdateSplit
                ? "U"
                : "ONLINE",
        candidateCount,
        perfectPrototypeGate: {
          enabled: isPerfectPrototypeGateActive(perfectPrototypeGateCfg),
          mode: String(perfectPrototypeGateCfg?.mode ?? "off").trim().toLowerCase() || "off",
          selectionMode:
            String(perfectPrototypeGateCfg?.selectionMode ?? "champion_only").trim().toLowerCase(),
          ...perfectPrototypeGateDayTelemetry
        },
        dayType: dayTypeDecision,
        dayTypeRule: ruleDayTypeDecision,
        dayTypeModelDecision,
        gateReason: gate.gateReason,
        scoreMargin: Number.isFinite(gate.scoreMargin) ? gate.scoreMargin : null,
        winnerChangedAfterSimilarityGateDay,
        top1RejectedBySimilarityGateDay,
        oracleHitRejectedBySimilarityGateDay,
        preGateTop1: toSimilarityGateTopCandidateSummary(preGateTopCandidates[0]),
        agreementGateTelemetry,
        similarityGate: {
          enabled: decisionGateCfg?.similarityGate?.enabled === true,
          disambiguationEnabled: similarityDisambiguationEnabled,
          scoredCount: candidateCount,
          passedCount: similarityGatePassedForDay,
          rejectedCount: similarityGateRejectedForDay,
          rejectReasonCounts: similarityGateRejectReasonCountsDay,
          winnerChangedAfterSimilarityGateDay,
          top1RejectedBySimilarityGateDay,
          oracleHitRejectedBySimilarityGateDay,
          preGateTop1: toSimilarityGateTopCandidateSummary(preGateTopCandidates[0]),
          postGateTop1: toSimilarityGateTopCandidateSummary(topCandidates[0])
        },
        rawScoreMargin:
          top?.[0] && Number.isFinite(Number(top[0]?.rawScoreMargin))
            ? Number(top[0].rawScoreMargin)
            : null,
        preRerankMargin:
          top?.[0] && Number.isFinite(Number(top[0]?.preRerankScoreMargin))
            ? Number(top[0].preRerankScoreMargin)
            : null,
        postRerankTopScoreMargin:
          top?.[0] && Number.isFinite(Number(top[0]?.postRerankScoreMargin))
            ? Number(top[0].postRerankScoreMargin)
            : null,
        postRerankMargin:
          top?.[0] && Number.isFinite(Number(top[0]?.postRerankScoreMargin))
            ? Number(top[0].postRerankScoreMargin)
            : null,
        firstSuccessRank,
        pickCount: picks.length,
        propensity,
        selectionPolicy,
        orderingTrace: d1?.orderingTrace ?? null,
        scoreOriginTrace: d1?.scoreOriginTrace ?? null,
        counterfactualGateSweep: d1?.counterfactualGateSweep ?? null,
        scoreRecoveryTelemetry: d1?.scoreRecovery ?? null,
        scoreRecalibrationTelemetry: d1?.scoreRecalibration ?? null,
        top1Path,
        feedbackQueue: {
          pending: feedbackQueue.length,
          queuedCount: feedbackQueuedCount,
          appliedCount: feedbackAppliedCount
        },
        executionFeedbackQueue: {
          pending: executionFeedbackQueue.length,
          queuedCount: executionFeedbackQueuedCount,
          appliedCount: executionFeedbackAppliedCount
        },
        execution: {
          enabled: executionGateCfg.enabled === true,
          decisionCount: picks.length,
          preFalsePositiveApprovedCount: preFalsePositiveApprovedCountDay,
          approvedRawCount: executionPicks.length,
          approvedCount: executionPicks.length,
          approvedSymbols: executionPicks.map((row) => String(row?.symbol ?? "").trim()).filter(Boolean),
          shadowCount: Math.max(0, picks.length - executionPicks.length),
          blockedCount: executionBlockedCountDay,
          decisionCounts: executionDecisionCountsDay,
          shadowReasonCounts: executionShadowReasonCountsDay,
          falsePositiveDecisionCounts: falsePositiveDecisionCountsDay,
          falsePositiveReasonCounts: falsePositiveReasonCountsDay,
          falsePositiveRejectedCount: falsePositiveRejectedCountDay,
          falsePositiveRejectedHitCount: falsePositiveRejectedHitCountDay,
          falsePositiveRejectedMissCount: falsePositiveRejectedMissCountDay,
          budgetDecisionCounts: budgetDecisionCountsDay,
          budgetReasonCounts: budgetReasonCountsDay,
          budgetRejectedCount: budgetRejectedCountDay,
          budgetRejectedHitCount: budgetRejectedHitCountDay,
          budgetRejectedMissCount: budgetRejectedMissCountDay
        },
        rejectionCounts: gate.rejectionCounts ?? {},
        rankingPolicy: {
          inversionAdjust: inversionAdjusted,
          top1Rerank: rerankDecision,
          adaptiveMinFinal: adaptiveMinFinalDecision,
          agreementGate: gate?.agreementGate ?? null,
          orderingTrace: d1?.orderingTrace ?? null
        },
        ...(decisionGateCfg?.secondPick?.debugLog === true
          ? { secondPickGate: gate?.secondPickGate ?? null }
          : {}),
        picked: pick
          ? {
              symbol: pick.symbol,
              name: pick.name,
              score: pick.score,
              baseScore: pick.baseScore,
              finalScore: pick.finalScore,
              rawSimilarityScore: Number.isFinite(Number(pick?.rawSimilarityScore))
                ? Number(pick.rawSimilarityScore)
                : null,
              globalStageScore: Number.isFinite(Number(pick?.globalStageScore))
                ? Number(pick.globalStageScore)
                : null,
              localStageScore: Number.isFinite(Number(pick?.localStageScore))
                ? Number(pick.localStageScore)
                : null,
              triggerStageScore: Number.isFinite(Number(pick?.triggerStageScore))
                ? Number(pick.triggerStageScore)
                : null,
              similarityGateRejectReasons: Array.isArray(pick?.similarityGateRejectReasons)
                ? pick.similarityGateRejectReasons
                : [],
              rankerScore: Number(pick?.rankerScore ?? pick?.finalScore ?? pick?.score ?? 0) || 0,
              executionScore: Number.isFinite(Number(pick?.executionScore)) ? Number(pick.executionScore) : null,
              qualityBonus: pick.qualityBonus,
              winRateBonus: pick.winRateBonus ?? 0,
              targetRateBonus: pick.targetRateBonus ?? 0,
              stopRatePenalty: pick.stopRatePenalty ?? 0,
              antiPenalty: pick.antiPenalty,
              expectedRetBonus: pick.expectedRetBonus,
              expectedNetRet3d: pick.expectedNetRet3d,
              qualityScore: pick.qualityScore,
              antiScore: pick.antiScore,
              winRate3d: pick.winRate3d ?? null,
              targetRate3d: pick.targetRate3d ?? null,
              stopRate3d: pick.stopRate3d ?? null,
              successOnDecisionDay: pick.successOnDecisionDay,
              successInWindow: pick.successInWindow,
              hitWindowDays: pick.hitWindowDays,
              firstHitOffset: pick.firstHitOffset,
              firstStopOffset: pick.firstStopOffset,
              stopTriggeredOnDecisionDay: pick.stopTriggeredOnDecisionDay,
              stopTriggeredInWindow: pick.stopTriggeredInWindow,
              maxWindowJumpPct: pick.maxWindowJumpPct,
              minWindowDrawdownPct: pick.minWindowDrawdownPct,
              decisionDayJumpPct: pick.decisionDayJumpPct,
              targetDateKey: pick.targetDateKey,
              matchedPrototypeId: pick.matchedPrototypeId,
              matchedPrototypeClusterId: pick.matchedPrototypeClusterId,
              matchedPrototypeClusterSignature: pick.matchedPrototypeClusterSignature ?? null,
              matchedPrototypeSelectedEraId: pick.matchedPrototypeSelectedEraId ?? null,
              matchedPerfectPrototypeIds: pick.matchedPerfectPrototypeIds ?? [],
              matchedPerfectPrototypeCount: Number(pick?.matchedPerfectPrototypeCount ?? 0) || 0,
              perfectPrototypePrimaryRuleId: pick.perfectPrototypePrimaryRuleId ?? null,
              perfectPrototypeGatePassed: pick.perfectPrototypeGatePassed === true,
              tradeQualityPriorAdjustment: Number.isFinite(Number(pick?.tradeQualityPriorAdjustment))
                ? Number(pick.tradeQualityPriorAdjustment)
                : null,
              tradeQualityGlobalScore: Number.isFinite(Number(pick?.tradeQualityGlobalScore))
                ? Number(pick.tradeQualityGlobalScore)
                : null,
              tradeQualityRouteResidual: Number.isFinite(Number(pick?.tradeQualityRouteResidual))
                ? Number(pick.tradeQualityRouteResidual)
                : null,
              tradeQualityRegimeResidual: Number.isFinite(Number(pick?.tradeQualityRegimeResidual))
                ? Number(pick.tradeQualityRegimeResidual)
                : null,
              tradeQualityPrototypeResidual: Number.isFinite(Number(pick?.tradeQualityPrototypeResidual))
                ? Number(pick.tradeQualityPrototypeResidual)
                : null,
              tradeQualityRouteScore: Number.isFinite(Number(pick?.tradeQualityRouteScore))
                ? Number(pick.tradeQualityRouteScore)
                : null,
              tradeQualityRegimeScore: Number.isFinite(Number(pick?.tradeQualityRegimeScore))
                ? Number(pick.tradeQualityRegimeScore)
                : null,
              tradeQualityPrototypeScore: Number.isFinite(Number(pick?.tradeQualityPrototypeScore))
                ? Number(pick.tradeQualityPrototypeScore)
                : null,
              tradeQualityRouteCount: Number.isFinite(Number(pick?.tradeQualityRouteCount))
                ? Number(pick.tradeQualityRouteCount)
                : null,
              tradeQualityRegimeCount: Number.isFinite(Number(pick?.tradeQualityRegimeCount))
                ? Number(pick.tradeQualityRegimeCount)
                : null,
              tradeQualityPrototypeCount: Number.isFinite(Number(pick?.tradeQualityPrototypeCount))
                ? Number(pick.tradeQualityPrototypeCount)
                : null,
              regimeTag: pick.regimeTag,
              regimeVolatilityProxy: pick.regimeVolatilityProxy,
              regimeLiquidityProxy: pick.regimeLiquidityProxy,
              routeBucket: pick.routeBucket ?? null,
              avgTradingValue20dKrw: Number(pick?.avgTradingValue20dKrw ?? 0) || 0,
              dataFreshnessDays: Number(pick?.dataFreshnessDays ?? 0) || 0,
              spreadProxyPct: Number(pick?.spreadProxyPct ?? 0) || 0,
              slippageRisk: Number(pick?.slippageRisk ?? 0) || 0,
              rankIndex: Number.isFinite(Number(pick?.rankIndex)) ? Number(pick.rankIndex) : null,
              rankSize: Number.isFinite(Number(pick?.rankSize)) ? Number(pick.rankSize) : null,
              rankPct: Number.isFinite(Number(pick?.rankPct)) ? Number(pick.rankPct) : null,
              finalScoreZWithinDay: Number.isFinite(Number(pick?.finalScoreZWithinDay))
                ? Number(pick.finalScoreZWithinDay)
                : null,
              marginZWithinDay: Number.isFinite(Number(pick?.marginZWithinDay))
                ? Number(pick.marginZWithinDay)
                : null,
              pHitCalibrated: pick?.calibrated?.pHitCalibrated ?? null,
              pStopFirstCalibrated: pick?.calibrated?.pStopFirstCalibrated ?? null,
              pFillCalibrated: pick?.calibrated?.pFillCalibrated ?? null,
              confidence: pick?.calibrated?.confidence ?? null,
              agreementScore: Number.isFinite(Number(pick?.agreementScore))
                ? Number(pick.agreementScore)
                : null,
              agreementDecision: pick?.agreementDecision ?? null,
              agreementReason: pick?.agreementReason ?? null,
              agreementConsensusRate: Number.isFinite(Number(pick?.agreementConsensusRate))
                ? Number(pick.agreementConsensusRate)
                : null,
              agreementStabilityRate: Number.isFinite(Number(pick?.agreementStabilityRate))
                ? Number(pick.agreementStabilityRate)
                : null,
              agreementConsensusCount: Number.isFinite(Number(pick?.agreementConsensusCount))
                ? Number(pick.agreementConsensusCount)
                : null,
              agreementCandidateUtility: Number.isFinite(Number(pick?.agreementCandidateUtility))
                ? Number(pick.agreementCandidateUtility)
                : null,
              agreementChecks:
                pick?.agreementChecks && typeof pick.agreementChecks === "object"
                  ? pick.agreementChecks
                  : {},
              rawScoreMargin: Number.isFinite(Number(pick?.rawScoreMargin)) ? Number(pick.rawScoreMargin) : null,
              preRerankScoreMargin: Number.isFinite(Number(pick?.preRerankScoreMargin))
                ? Number(pick.preRerankScoreMargin)
                : null,
              preRerankMargin: Number.isFinite(Number(pick?.preRerankScoreMargin))
                ? Number(pick.preRerankScoreMargin)
                : null,
              postRerankScoreMargin: Number.isFinite(Number(pick?.postRerankScoreMargin))
                ? Number(pick.postRerankScoreMargin)
                : null,
              postRerankMargin: Number.isFinite(Number(pick?.postRerankScoreMargin))
                ? Number(pick.postRerankScoreMargin)
                : null,
              gateScoreMargin: Number.isFinite(Number(pick?.gateScoreMargin ?? pick?.rawScoreMargin))
                ? Number(pick?.gateScoreMargin ?? pick?.rawScoreMargin)
                : null,
              negativeMarginAfterRerank: pick?.negativeMarginAfterRerank === true,
              metaDecision: pick.metaDecision ?? null,
              metaReason: pick.metaReason ?? null,
              metaDiagnosticDecision: pick.metaDiagnosticDecision ?? null,
              metaDiagnosticReason: pick.metaDiagnosticReason ?? null,
              metaDiagnosticOnly: pick.metaDiagnosticOnly === true,
              regimeExpert: pick.regimeExpert ?? null,
              orderProfile: pick.orderProfile ?? null,
              executionDecisionPreFalsePositive: pick.executionDecisionPreFalsePositive ?? null,
              executionShadowReasonPreFalsePositive: pick.executionShadowReasonPreFalsePositive ?? null,
              falsePositiveModelRisk: Number.isFinite(Number(pick?.falsePositiveModelRisk))
                ? Number(pick.falsePositiveModelRisk)
                : null,
              falsePositiveRisk: Number.isFinite(Number(pick?.falsePositiveRisk))
                ? Number(pick.falsePositiveRisk)
                : null,
              falsePositiveDecision: pick.falsePositiveDecision ?? null,
              falsePositiveReason: pick.falsePositiveReason ?? null,
              falsePositiveChecks: pick.falsePositiveChecks ?? {},
              budgetDecision: pick.budgetDecision ?? null,
              budgetReason: pick.budgetReason ?? null,
              budgetChecks: pick.budgetChecks ?? {},
              executionDecision: pick.executionDecision ?? null,
              executionShadowReason: pick.executionShadowReason ?? null,
              executionChecks: pick.executionChecks ?? {},
              executed: executedPick === pick,
              propensity,
              groupScores: pick.groupScores
            }
          : null,
        pickedList: picks.map((row) => ({
          symbol: row.symbol,
          name: row.name,
          finalScore: row.finalScore,
          rawSimilarityScore: Number.isFinite(Number(row?.rawSimilarityScore))
            ? Number(row.rawSimilarityScore)
            : null,
          globalStageScore: Number.isFinite(Number(row?.globalStageScore))
            ? Number(row.globalStageScore)
            : null,
          localStageScore: Number.isFinite(Number(row?.localStageScore))
            ? Number(row.localStageScore)
            : null,
          triggerStageScore: Number.isFinite(Number(row?.triggerStageScore))
            ? Number(row.triggerStageScore)
            : null,
          positiveTop2RawSimilarity: Number.isFinite(Number(row?.positiveTop2RawSimilarity))
            ? Number(row.positiveTop2RawSimilarity)
            : null,
          top1Top2PositiveGap: Number.isFinite(Number(row?.top1Top2PositiveGap))
            ? Number(row.top1Top2PositiveGap)
            : null,
          positiveVsNegativeGap: Number.isFinite(Number(row?.positiveVsNegativeGap))
            ? Number(row.positiveVsNegativeGap)
            : null,
          negativeTop1RawSimilarity: Number.isFinite(Number(row?.negativeTop1RawSimilarity))
            ? Number(row.negativeTop1RawSimilarity)
            : null,
          negativeTop1StopRawSimilarity: Number.isFinite(Number(row?.negativeTop1StopRawSimilarity))
            ? Number(row.negativeTop1StopRawSimilarity)
            : null,
          negativeTop1TimeoutNegativeRawSimilarity: Number.isFinite(
            Number(row?.negativeTop1TimeoutNegativeRawSimilarity),
          )
            ? Number(row.negativeTop1TimeoutNegativeRawSimilarity)
            : null,
          negativeTop1LowExecutionQualityRawSimilarity: Number.isFinite(
            Number(row?.negativeTop1LowExecutionQualityRawSimilarity),
          )
            ? Number(row.negativeTop1LowExecutionQualityRawSimilarity)
            : null,
          positiveTop2PrototypeId: row?.positiveTop2PrototypeId ?? null,
          negativeTop1PrototypeId: row?.negativeTop1PrototypeId ?? null,
          negativeTop1OutcomeBucket: row?.negativeTop1OutcomeBucket ?? null,
          similarityGateRejectReasons: Array.isArray(row?.similarityGateRejectReasons)
            ? row.similarityGateRejectReasons
            : [],
          rankerScore: Number(row?.rankerScore ?? row?.finalScore ?? row?.score ?? 0) || 0,
          executionScore: Number.isFinite(Number(row?.executionScore)) ? Number(row.executionScore) : null,
          expectedNetRet3d: row.expectedNetRet3d,
          qualityScore: row.qualityScore,
          antiScore: row.antiScore,
          winRate3d: row.winRate3d ?? null,
          targetRate3d: row.targetRate3d ?? null,
          stopRate3d: row.stopRate3d ?? null,
          successOnDecisionDay: row.successOnDecisionDay,
          successInWindow: row.successInWindow,
          firstHitOffset: row.firstHitOffset,
          firstStopOffset: row.firstStopOffset,
          stopTriggeredOnDecisionDay: row.stopTriggeredOnDecisionDay,
          stopTriggeredInWindow: row.stopTriggeredInWindow,
          maxWindowJumpPct: row.maxWindowJumpPct,
          minWindowDrawdownPct: row.minWindowDrawdownPct,
          matchedPrototypeId: row.matchedPrototypeId,
          matchedPrototypeClusterId: row.matchedPrototypeClusterId,
          matchedPrototypeClusterSignature: row.matchedPrototypeClusterSignature ?? null,
          matchedPrototypeSelectedEraId: row.matchedPrototypeSelectedEraId ?? null,
          matchedPerfectPrototypeIds: row.matchedPerfectPrototypeIds ?? [],
          matchedPerfectPrototypeCount: Number(row?.matchedPerfectPrototypeCount ?? 0) || 0,
          perfectPrototypePrimaryRuleId: row.perfectPrototypePrimaryRuleId ?? null,
          perfectPrototypeGatePassed: row.perfectPrototypeGatePassed === true,
          tradeQualityPriorAdjustment: Number.isFinite(Number(row?.tradeQualityPriorAdjustment))
            ? Number(row.tradeQualityPriorAdjustment)
            : null,
          tradeQualityGlobalScore: Number.isFinite(Number(row?.tradeQualityGlobalScore))
            ? Number(row.tradeQualityGlobalScore)
            : null,
          tradeQualityRouteResidual: Number.isFinite(Number(row?.tradeQualityRouteResidual))
            ? Number(row.tradeQualityRouteResidual)
            : null,
          tradeQualityRegimeResidual: Number.isFinite(Number(row?.tradeQualityRegimeResidual))
            ? Number(row.tradeQualityRegimeResidual)
            : null,
          tradeQualityPrototypeResidual: Number.isFinite(Number(row?.tradeQualityPrototypeResidual))
            ? Number(row.tradeQualityPrototypeResidual)
            : null,
          tradeQualityRouteScore: Number.isFinite(Number(row?.tradeQualityRouteScore))
            ? Number(row.tradeQualityRouteScore)
            : null,
          tradeQualityRegimeScore: Number.isFinite(Number(row?.tradeQualityRegimeScore))
            ? Number(row.tradeQualityRegimeScore)
            : null,
          tradeQualityPrototypeScore: Number.isFinite(Number(row?.tradeQualityPrototypeScore))
            ? Number(row.tradeQualityPrototypeScore)
            : null,
          tradeQualityRouteCount: Number.isFinite(Number(row?.tradeQualityRouteCount))
            ? Number(row.tradeQualityRouteCount)
            : null,
          tradeQualityRegimeCount: Number.isFinite(Number(row?.tradeQualityRegimeCount))
            ? Number(row.tradeQualityRegimeCount)
            : null,
          tradeQualityPrototypeCount: Number.isFinite(Number(row?.tradeQualityPrototypeCount))
            ? Number(row.tradeQualityPrototypeCount)
            : null,
          clusterTemporalEraSupportCount: Number.isFinite(Number(row?.clusterTemporalEraSupportCount))
            ? Number(row.clusterTemporalEraSupportCount)
            : null,
          clusterTemporalEraCoverageRatio: Number.isFinite(Number(row?.clusterTemporalEraCoverageRatio))
            ? Number(row.clusterTemporalEraCoverageRatio)
            : null,
          clusterTemporalDominantEraId: row?.clusterTemporalDominantEraId ?? null,
          clusterTemporalDominantEraShare: Number.isFinite(Number(row?.clusterTemporalDominantEraShare))
            ? Number(row.clusterTemporalDominantEraShare)
            : null,
          clusterTemporalMaxSingleEraShare: Number.isFinite(Number(row?.clusterTemporalMaxSingleEraShare))
            ? Number(row.clusterTemporalMaxSingleEraShare)
            : null,
          clusterTemporalEffectiveSingleEraShare: Number.isFinite(
            Number(row?.clusterTemporalEffectiveSingleEraShare),
          )
            ? Number(row.clusterTemporalEffectiveSingleEraShare)
            : null,
          clusterTemporalSingleEraEvidenceCoverageRatio: Number.isFinite(
            Number(row?.clusterTemporalSingleEraEvidenceCoverageRatio),
          )
            ? Number(row.clusterTemporalSingleEraEvidenceCoverageRatio)
            : null,
          clusterTemporalSingleEraEvidenceSupportRatio: Number.isFinite(
            Number(row?.clusterTemporalSingleEraEvidenceSupportRatio),
          )
            ? Number(row.clusterTemporalSingleEraEvidenceSupportRatio)
            : null,
          clusterTemporalEffectiveEraCount: Number.isFinite(
            Number(row?.clusterTemporalEffectiveEraCount),
          )
            ? Number(row.clusterTemporalEffectiveEraCount)
            : null,
          clusterTemporalNormalizedEraEntropy: Number.isFinite(
            Number(row?.clusterTemporalNormalizedEraEntropy),
          )
            ? Number(row.clusterTemporalNormalizedEraEntropy)
            : null,
          clusterTemporalSingleEraEvidenceEffectiveEraCountRatio: Number.isFinite(
            Number(row?.clusterTemporalSingleEraEvidenceEffectiveEraCountRatio),
          )
            ? Number(row.clusterTemporalSingleEraEvidenceEffectiveEraCountRatio)
            : null,
          clusterTemporalSingleEraEvidenceEntropyRatio: Number.isFinite(
            Number(row?.clusterTemporalSingleEraEvidenceEntropyRatio),
          )
            ? Number(row.clusterTemporalSingleEraEvidenceEntropyRatio)
            : null,
          clusterTemporalEraSupportMin: Number.isFinite(Number(row?.clusterTemporalEraSupportMin))
            ? Number(row.clusterTemporalEraSupportMin)
            : null,
          clusterTemporalEraSupportMedian: Number.isFinite(Number(row?.clusterTemporalEraSupportMedian))
            ? Number(row.clusterTemporalEraSupportMedian)
            : null,
          clusterTemporalEraWinRateStd: Number.isFinite(Number(row?.clusterTemporalEraWinRateStd))
            ? Number(row.clusterTemporalEraWinRateStd)
            : null,
          clusterTemporalEraExpectedNetRetStd: Number.isFinite(Number(row?.clusterTemporalEraExpectedNetRetStd))
            ? Number(row.clusterTemporalEraExpectedNetRetStd)
            : null,
          clusterTemporalEraContrastiveLiftStd: Number.isFinite(Number(row?.clusterTemporalEraContrastiveLiftStd))
            ? Number(row.clusterTemporalEraContrastiveLiftStd)
            : null,
          regimeTag: row.regimeTag,
          regimeVolatilityProxy: row.regimeVolatilityProxy,
          regimeLiquidityProxy: row.regimeLiquidityProxy,
          routeBucket: row.routeBucket ?? null,
          avgTradingValue20dKrw: Number(row?.avgTradingValue20dKrw ?? 0) || 0,
          dataFreshnessDays: Number(row?.dataFreshnessDays ?? 0) || 0,
          spreadProxyPct: Number(row?.spreadProxyPct ?? 0) || 0,
          slippageRisk: Number(row?.slippageRisk ?? 0) || 0,
          rankIndex: Number.isFinite(Number(row?.rankIndex)) ? Number(row.rankIndex) : null,
          rankSize: Number.isFinite(Number(row?.rankSize)) ? Number(row.rankSize) : null,
          rankPct: Number.isFinite(Number(row?.rankPct)) ? Number(row.rankPct) : null,
          finalScoreZWithinDay: Number.isFinite(Number(row?.finalScoreZWithinDay))
            ? Number(row.finalScoreZWithinDay)
            : null,
          marginZWithinDay: Number.isFinite(Number(row?.marginZWithinDay))
            ? Number(row.marginZWithinDay)
            : null,
          pHitCalibrated: row?.calibrated?.pHitCalibrated ?? null,
          pStopFirstCalibrated: row?.calibrated?.pStopFirstCalibrated ?? null,
          pFillCalibrated: row?.calibrated?.pFillCalibrated ?? null,
          confidence: row?.calibrated?.confidence ?? null,
          agreementScore: Number.isFinite(Number(row?.agreementScore))
            ? Number(row.agreementScore)
            : null,
          agreementDecision: row?.agreementDecision ?? null,
          agreementReason: row?.agreementReason ?? null,
          agreementConsensusRate: Number.isFinite(Number(row?.agreementConsensusRate))
            ? Number(row.agreementConsensusRate)
            : null,
          agreementStabilityRate: Number.isFinite(Number(row?.agreementStabilityRate))
            ? Number(row.agreementStabilityRate)
            : null,
          agreementConsensusCount: Number.isFinite(Number(row?.agreementConsensusCount))
            ? Number(row.agreementConsensusCount)
            : null,
          agreementCandidateUtility: Number.isFinite(Number(row?.agreementCandidateUtility))
            ? Number(row.agreementCandidateUtility)
            : null,
          agreementChecks:
            row?.agreementChecks && typeof row.agreementChecks === "object"
              ? row.agreementChecks
              : {},
          rawScoreMargin: Number.isFinite(Number(row?.rawScoreMargin)) ? Number(row.rawScoreMargin) : null,
          preRerankScoreMargin: Number.isFinite(Number(row?.preRerankScoreMargin))
            ? Number(row.preRerankScoreMargin)
            : null,
          preRerankMargin: Number.isFinite(Number(row?.preRerankScoreMargin))
            ? Number(row.preRerankScoreMargin)
            : null,
          postRerankScoreMargin: Number.isFinite(Number(row?.postRerankScoreMargin))
            ? Number(row.postRerankScoreMargin)
            : null,
          postRerankMargin: Number.isFinite(Number(row?.postRerankScoreMargin))
            ? Number(row.postRerankScoreMargin)
            : null,
          gateScoreMargin: Number.isFinite(Number(row?.gateScoreMargin ?? row?.rawScoreMargin))
            ? Number(row?.gateScoreMargin ?? row?.rawScoreMargin)
            : null,
          negativeMarginAfterRerank: row?.negativeMarginAfterRerank === true,
          metaDecision: row.metaDecision ?? null,
          metaReason: row.metaReason ?? null,
          metaDiagnosticDecision: row.metaDiagnosticDecision ?? null,
          metaDiagnosticReason: row.metaDiagnosticReason ?? null,
          metaDiagnosticOnly: row.metaDiagnosticOnly === true,
          regimeExpert: row.regimeExpert ?? null,
          orderProfile: row.orderProfile ?? null,
          executionDecisionPreFalsePositive: row.executionDecisionPreFalsePositive ?? null,
          executionShadowReasonPreFalsePositive: row.executionShadowReasonPreFalsePositive ?? null,
          falsePositiveModelRisk: Number.isFinite(Number(row?.falsePositiveModelRisk))
            ? Number(row.falsePositiveModelRisk)
            : null,
          falsePositiveRisk: Number.isFinite(Number(row?.falsePositiveRisk))
            ? Number(row.falsePositiveRisk)
            : null,
          falsePositiveDecision: row.falsePositiveDecision ?? null,
          falsePositiveReason: row.falsePositiveReason ?? null,
          falsePositiveChecks: row.falsePositiveChecks ?? {},
          budgetDecision: row.budgetDecision ?? null,
          budgetReason: row.budgetReason ?? null,
          budgetChecks: row.budgetChecks ?? {},
          executionDecision: row.executionDecision ?? null,
          executionShadowReason: row.executionShadowReason ?? null,
          executionChecks: row.executionChecks ?? {},
          executed: row.executionDecision === "TRADE"
        })),
        topK: top.map((row) => ({
          symbol: row.symbol,
          score: row.score,
          baseScore: row.baseScore,
          finalScore: row.finalScore,
          rawSimilarityScore: Number.isFinite(Number(row?.rawSimilarityScore))
            ? Number(row.rawSimilarityScore)
            : null,
          globalStageScore: Number.isFinite(Number(row?.globalStageScore))
            ? Number(row.globalStageScore)
            : null,
          localStageScore: Number.isFinite(Number(row?.localStageScore))
            ? Number(row.localStageScore)
            : null,
          triggerStageScore: Number.isFinite(Number(row?.triggerStageScore))
            ? Number(row.triggerStageScore)
            : null,
          positiveTop2RawSimilarity: Number.isFinite(Number(row?.positiveTop2RawSimilarity))
            ? Number(row.positiveTop2RawSimilarity)
            : null,
          top1Top2PositiveGap: Number.isFinite(Number(row?.top1Top2PositiveGap))
            ? Number(row.top1Top2PositiveGap)
            : null,
          positiveVsNegativeGap: Number.isFinite(Number(row?.positiveVsNegativeGap))
            ? Number(row.positiveVsNegativeGap)
            : null,
          negativeTop1RawSimilarity: Number.isFinite(Number(row?.negativeTop1RawSimilarity))
            ? Number(row.negativeTop1RawSimilarity)
            : null,
          negativeTop1StopRawSimilarity: Number.isFinite(Number(row?.negativeTop1StopRawSimilarity))
            ? Number(row.negativeTop1StopRawSimilarity)
            : null,
          negativeTop1TimeoutNegativeRawSimilarity: Number.isFinite(
            Number(row?.negativeTop1TimeoutNegativeRawSimilarity),
          )
            ? Number(row.negativeTop1TimeoutNegativeRawSimilarity)
            : null,
          negativeTop1LowExecutionQualityRawSimilarity: Number.isFinite(
            Number(row?.negativeTop1LowExecutionQualityRawSimilarity),
          )
            ? Number(row.negativeTop1LowExecutionQualityRawSimilarity)
            : null,
          positiveTop2PrototypeId: row?.positiveTop2PrototypeId ?? null,
          negativeTop1PrototypeId: row?.negativeTop1PrototypeId ?? null,
          negativeTop1OutcomeBucket: row?.negativeTop1OutcomeBucket ?? null,
          similarityGateRejectReasons: Array.isArray(row?.similarityGateRejectReasons)
            ? row.similarityGateRejectReasons
            : [],
          rankerScore: Number(row?.rankerScore ?? row?.finalScore ?? row?.score ?? 0) || 0,
          executionScore: Number.isFinite(Number(row?.executionScore)) ? Number(row.executionScore) : null,
          qualityBonus: row.qualityBonus,
          winRateBonus: row.winRateBonus ?? 0,
          targetRateBonus: row.targetRateBonus ?? 0,
          stopRatePenalty: row.stopRatePenalty ?? 0,
          expectedNetRet3d: row.expectedNetRet3d,
          qualityScore: row.qualityScore,
          antiScore: row.antiScore,
          winRate3d: row.winRate3d ?? null,
          targetRate3d: row.targetRate3d ?? null,
          stopRate3d: row.stopRate3d ?? null,
          matchedPrototypeId: row.matchedPrototypeId,
          matchedPrototypeClusterId: row.matchedPrototypeClusterId,
          matchedPrototypeClusterSignature: row.matchedPrototypeClusterSignature ?? null,
          matchedPrototypeSelectedEraId: row.matchedPrototypeSelectedEraId ?? null,
          matchedPerfectPrototypeIds: row.matchedPerfectPrototypeIds ?? [],
          matchedPerfectPrototypeCount: Number(row?.matchedPerfectPrototypeCount ?? 0) || 0,
          perfectPrototypePrimaryRuleId: row.perfectPrototypePrimaryRuleId ?? null,
          perfectPrototypeGatePassed: row.perfectPrototypeGatePassed === true,
          tradeQualityPriorAdjustment: Number.isFinite(Number(row?.tradeQualityPriorAdjustment))
            ? Number(row.tradeQualityPriorAdjustment)
            : null,
          tradeQualityGlobalScore: Number.isFinite(Number(row?.tradeQualityGlobalScore))
            ? Number(row.tradeQualityGlobalScore)
            : null,
          tradeQualityRouteResidual: Number.isFinite(Number(row?.tradeQualityRouteResidual))
            ? Number(row.tradeQualityRouteResidual)
            : null,
          tradeQualityRegimeResidual: Number.isFinite(Number(row?.tradeQualityRegimeResidual))
            ? Number(row.tradeQualityRegimeResidual)
            : null,
          tradeQualityPrototypeResidual: Number.isFinite(Number(row?.tradeQualityPrototypeResidual))
            ? Number(row.tradeQualityPrototypeResidual)
            : null,
          tradeQualityRouteScore: Number.isFinite(Number(row?.tradeQualityRouteScore))
            ? Number(row.tradeQualityRouteScore)
            : null,
          tradeQualityRegimeScore: Number.isFinite(Number(row?.tradeQualityRegimeScore))
            ? Number(row.tradeQualityRegimeScore)
            : null,
          tradeQualityPrototypeScore: Number.isFinite(Number(row?.tradeQualityPrototypeScore))
            ? Number(row.tradeQualityPrototypeScore)
            : null,
          tradeQualityRouteCount: Number.isFinite(Number(row?.tradeQualityRouteCount))
            ? Number(row.tradeQualityRouteCount)
            : null,
          tradeQualityRegimeCount: Number.isFinite(Number(row?.tradeQualityRegimeCount))
            ? Number(row.tradeQualityRegimeCount)
            : null,
          tradeQualityPrototypeCount: Number.isFinite(Number(row?.tradeQualityPrototypeCount))
            ? Number(row.tradeQualityPrototypeCount)
            : null,
          clusterTemporalEraSupportCount: Number.isFinite(Number(row?.clusterTemporalEraSupportCount))
            ? Number(row.clusterTemporalEraSupportCount)
            : null,
          clusterTemporalEraCoverageRatio: Number.isFinite(Number(row?.clusterTemporalEraCoverageRatio))
            ? Number(row.clusterTemporalEraCoverageRatio)
            : null,
          clusterTemporalDominantEraId: row?.clusterTemporalDominantEraId ?? null,
          clusterTemporalDominantEraShare: Number.isFinite(Number(row?.clusterTemporalDominantEraShare))
            ? Number(row.clusterTemporalDominantEraShare)
            : null,
          clusterTemporalMaxSingleEraShare: Number.isFinite(Number(row?.clusterTemporalMaxSingleEraShare))
            ? Number(row.clusterTemporalMaxSingleEraShare)
            : null,
          clusterTemporalEffectiveSingleEraShare: Number.isFinite(
            Number(row?.clusterTemporalEffectiveSingleEraShare),
          )
            ? Number(row.clusterTemporalEffectiveSingleEraShare)
            : null,
          clusterTemporalSingleEraEvidenceCoverageRatio: Number.isFinite(
            Number(row?.clusterTemporalSingleEraEvidenceCoverageRatio),
          )
            ? Number(row.clusterTemporalSingleEraEvidenceCoverageRatio)
            : null,
          clusterTemporalSingleEraEvidenceSupportRatio: Number.isFinite(
            Number(row?.clusterTemporalSingleEraEvidenceSupportRatio),
          )
            ? Number(row.clusterTemporalSingleEraEvidenceSupportRatio)
            : null,
          clusterTemporalEffectiveEraCount: Number.isFinite(
            Number(row?.clusterTemporalEffectiveEraCount),
          )
            ? Number(row.clusterTemporalEffectiveEraCount)
            : null,
          clusterTemporalNormalizedEraEntropy: Number.isFinite(
            Number(row?.clusterTemporalNormalizedEraEntropy),
          )
            ? Number(row.clusterTemporalNormalizedEraEntropy)
            : null,
          clusterTemporalSingleEraEvidenceEffectiveEraCountRatio: Number.isFinite(
            Number(row?.clusterTemporalSingleEraEvidenceEffectiveEraCountRatio),
          )
            ? Number(row.clusterTemporalSingleEraEvidenceEffectiveEraCountRatio)
            : null,
          clusterTemporalSingleEraEvidenceEntropyRatio: Number.isFinite(
            Number(row?.clusterTemporalSingleEraEvidenceEntropyRatio),
          )
            ? Number(row.clusterTemporalSingleEraEvidenceEntropyRatio)
            : null,
          clusterTemporalEraSupportMin: Number.isFinite(Number(row?.clusterTemporalEraSupportMin))
            ? Number(row.clusterTemporalEraSupportMin)
            : null,
          clusterTemporalEraSupportMedian: Number.isFinite(Number(row?.clusterTemporalEraSupportMedian))
            ? Number(row.clusterTemporalEraSupportMedian)
            : null,
          clusterTemporalEraWinRateStd: Number.isFinite(Number(row?.clusterTemporalEraWinRateStd))
            ? Number(row.clusterTemporalEraWinRateStd)
            : null,
          clusterTemporalEraExpectedNetRetStd: Number.isFinite(Number(row?.clusterTemporalEraExpectedNetRetStd))
            ? Number(row.clusterTemporalEraExpectedNetRetStd)
            : null,
          clusterTemporalEraContrastiveLiftStd: Number.isFinite(Number(row?.clusterTemporalEraContrastiveLiftStd))
            ? Number(row.clusterTemporalEraContrastiveLiftStd)
            : null,
          successOnDecisionDay: row.successOnDecisionDay,
          successInWindow: row.successInWindow,
          decisionDayJumpPct: row.decisionDayJumpPct,
          maxWindowJumpPct: row.maxWindowJumpPct,
          minWindowDrawdownPct: row.minWindowDrawdownPct,
          stopTriggeredInWindow: row.stopTriggeredInWindow,
          regimeTag: row.regimeTag,
          regimeVolatilityProxy: row.regimeVolatilityProxy,
          regimeLiquidityProxy: row.regimeLiquidityProxy,
          routeBucket: row.routeBucket ?? null,
          rankIndex: Number.isFinite(Number(row?.rankIndex)) ? Number(row.rankIndex) : null,
          rankSize: Number.isFinite(Number(row?.rankSize)) ? Number(row.rankSize) : null,
          rankPct: Number.isFinite(Number(row?.rankPct)) ? Number(row.rankPct) : null,
          finalScoreZWithinDay: Number.isFinite(Number(row?.finalScoreZWithinDay))
            ? Number(row.finalScoreZWithinDay)
            : null,
          marginZWithinDay: Number.isFinite(Number(row?.marginZWithinDay))
            ? Number(row.marginZWithinDay)
            : null,
          pHitCalibrated: row?.calibrated?.pHitCalibrated ?? null,
          pStopFirstCalibrated: row?.calibrated?.pStopFirstCalibrated ?? null,
          pFillCalibrated: row?.calibrated?.pFillCalibrated ?? null,
          confidence: row?.calibrated?.confidence ?? null,
          agreementScore: Number.isFinite(Number(row?.agreementScore))
            ? Number(row.agreementScore)
            : null,
          agreementDecision: row?.agreementDecision ?? null,
          agreementReason: row?.agreementReason ?? null,
          agreementConsensusRate: Number.isFinite(Number(row?.agreementConsensusRate))
            ? Number(row.agreementConsensusRate)
            : null,
          agreementStabilityRate: Number.isFinite(Number(row?.agreementStabilityRate))
            ? Number(row.agreementStabilityRate)
            : null,
          agreementConsensusCount: Number.isFinite(Number(row?.agreementConsensusCount))
            ? Number(row.agreementConsensusCount)
            : null,
          agreementCandidateUtility: Number.isFinite(Number(row?.agreementCandidateUtility))
            ? Number(row.agreementCandidateUtility)
            : null,
          agreementChecks:
            row?.agreementChecks && typeof row.agreementChecks === "object"
              ? row.agreementChecks
              : {},
          rawScoreMargin: Number.isFinite(Number(row?.rawScoreMargin)) ? Number(row.rawScoreMargin) : null,
          preRerankScoreMargin: Number.isFinite(Number(row?.preRerankScoreMargin))
            ? Number(row.preRerankScoreMargin)
            : null,
          preRerankMargin: Number.isFinite(Number(row?.preRerankScoreMargin))
            ? Number(row.preRerankScoreMargin)
            : null,
          postRerankScoreMargin: Number.isFinite(Number(row?.postRerankScoreMargin))
            ? Number(row.postRerankScoreMargin)
            : null,
          postRerankMargin: Number.isFinite(Number(row?.postRerankScoreMargin))
            ? Number(row.postRerankScoreMargin)
            : null,
          gateScoreMargin: Number.isFinite(Number(row?.gateScoreMargin ?? row?.rawScoreMargin))
            ? Number(row?.gateScoreMargin ?? row?.rawScoreMargin)
            : null,
          negativeMarginAfterRerank: row?.negativeMarginAfterRerank === true,
          metaDecision: row.metaDecision ?? null,
          metaReason: row.metaReason ?? null,
          metaDiagnosticDecision: row.metaDiagnosticDecision ?? null,
          metaDiagnosticReason: row.metaDiagnosticReason ?? null,
          metaDiagnosticOnly: row.metaDiagnosticOnly === true,
          regimeExpert: row.regimeExpert ?? null,
          orderProfile: row.orderProfile ?? null,
          executionDecisionPreFalsePositive: row.executionDecisionPreFalsePositive ?? null,
          executionShadowReasonPreFalsePositive: row.executionShadowReasonPreFalsePositive ?? null,
          falsePositiveModelRisk: Number.isFinite(Number(row?.falsePositiveModelRisk))
            ? Number(row.falsePositiveModelRisk)
            : null,
          falsePositiveRisk: Number.isFinite(Number(row?.falsePositiveRisk))
            ? Number(row.falsePositiveRisk)
            : null,
          falsePositiveDecision: row.falsePositiveDecision ?? null,
          falsePositiveReason: row.falsePositiveReason ?? null,
          budgetDecision: row.budgetDecision ?? null,
          budgetReason: row.budgetReason ?? null,
          executionDecision: row.executionDecision ?? null,
          executionShadowReason: row.executionShadowReason ?? null
        })),
        regret,
        rankLoss,
        weightsBefore: before,
        weightsAfter: after
      })
      onlineDayIndex += 1
      processedOnlineDates.add(String(decisionDateKey))
    }

    for (const decisionDateKey of tradingDates) {
      if (processedOnlineDates.has(String(decisionDateKey))) continue
      const dateKey = String(decisionDateKey)
      drainMaturedFeedback({ currentDateKey: dateKey })
      drainMaturedExecutionFeedback({ currentDateKey: dateKey })
      const inUpdateSplit = updateDateSet.has(dateKey)
      const inEvalSplit = evalDateSet.has(dateKey)
      if (inUpdateSplit) updateDaysSeen += 1
      if (inEvalSplit) evalDaysSeen += 1
      bumpSplitCounter({
        allCounts: selectionFunnelCounts,
        updateCounts: selectionFunnelCountsUpdate,
        evalCounts: selectionFunnelCountsEval,
        key: "NO_CANDIDATE_DAY",
        inUpdateSplit,
        inEvalSplit
      })
      bump(gateReasonCounts, "NO_CANDIDATE")
      if (inUpdateSplit) bump(gateReasonCountsUpdate, "NO_CANDIDATE")
      if (inEvalSplit) bump(gateReasonCountsEval, "NO_CANDIDATE")
      skippedByGate += 1
      const perfectPrototypeGateDayTelemetry = {
        evaluatedRows: 0,
        matchedRows: 0,
        filteredRows: 0,
        dedupedRows: 0
      }
      const sampledDebugEligible = sampledDebugEnabled && (!sampledDebugEvalOnly || inEvalSplit)
      if (sampledDebugEligible) {
        sampledDebugLogs.push({
          decisionDateKey,
          partition:
            inUpdateSplit && inEvalSplit
              ? "U+V"
              : inEvalSplit
                ? "V"
                : inUpdateSplit
                  ? "U"
                  : "ONLINE",
          gateReason: "NO_CANDIDATE",
          pickCount: 0,
          pickedSymbols: [],
          similarityGate: {
            enabled: decisionGateCfg?.similarityGate?.enabled === true,
            disambiguationEnabled: similarityDisambiguationEnabled,
            scoredCount: 0,
            passedCount: 0,
            rejectedCount: 0,
            rejectReasonCounts: {},
            winnerChangedAfterSimilarityGateDay: false,
            top1RejectedBySimilarityGateDay: false,
            oracleHitRejectedBySimilarityGateDay: false,
            preGateTop1: null,
            postGateTop1: null
          },
          firstSuccessRank: null,
          rows: []
        })
      }
	      logs.push({
	        decisionDateKey,
	        goalMode,
	        positionSemantics,
	        targetFirstMode: goalMode === "TARGET_FIRST_V2",
	        partition:
          inUpdateSplit && inEvalSplit
            ? "U+V"
            : inEvalSplit
              ? "V"
              : inUpdateSplit
                ? "U"
                : "ONLINE",
        candidateCount: 0,
        perfectPrototypeGate: {
          enabled: isPerfectPrototypeGateActive(perfectPrototypeGateCfg),
          mode: String(perfectPrototypeGateCfg?.mode ?? "off").trim().toLowerCase() || "off",
          selectionMode:
            String(perfectPrototypeGateCfg?.selectionMode ?? "champion_only").trim().toLowerCase(),
          ...perfectPrototypeGateDayTelemetry
        },
        gateReason: "NO_CANDIDATE",
        scoreMargin: null,
        winnerChangedAfterSimilarityGateDay: false,
        top1RejectedBySimilarityGateDay: false,
        oracleHitRejectedBySimilarityGateDay: false,
        preGateTop1: null,
        similarityGate: {
          enabled: decisionGateCfg?.similarityGate?.enabled === true,
          disambiguationEnabled: similarityDisambiguationEnabled,
          scoredCount: 0,
          passedCount: 0,
          rejectedCount: 0,
          rejectReasonCounts: {},
          winnerChangedAfterSimilarityGateDay: false,
          top1RejectedBySimilarityGateDay: false,
          oracleHitRejectedBySimilarityGateDay: false,
          preGateTop1: null,
          postGateTop1: null
        },
        pickCount: 0,
        propensity: null,
        selectionPolicy: { mode: "NO_CANDIDATE", epsilon: 0, applied: false },
        execution: {
          enabled: executionGateCfg.enabled === true,
          decisionCount: 0,
          approvedRawCount: 0,
          approvedCount: 0,
          approvedSymbols: [],
          shadowCount: 0,
          decisionCounts: {},
          shadowReasonCounts: {}
        },
        rejectionCounts: {},
        picked: null,
        pickedList: [],
        topK: [],
        regret: null,
        weightsBefore: { ...weights },
        weightsAfter: { ...weights }
      })
    }
  } finally {
    if (featurePackWriter) {
      await featurePackWriter.close()
    }
    if (workerPool && (!reuseRuntimeCache || keepWorkerPoolAlive !== true) && typeof workerPool.close === "function") {
      await workerPool.close()
    }
  }

  let candidateIndexRowsOnline = 0
  let candidateIndexRowsLockboxPrepared = 0
  let candidateIndexSeedsAll = 0
  let candidateIndexSeedsOnline = 0
  let candidateIndexSeedsLockboxPrepared = 0
  for (const [dateKey, seeds] of decisionCandidatesByDate.entries()) {
    const seedCount = Array.isArray(seeds) ? seeds.length : 0
    candidateIndexSeedsAll += seedCount
    if (isInRange(dateKey, ctx.periods.online)) {
      candidateIndexRowsOnline += 1
      candidateIndexSeedsOnline += seedCount
    }
    if (isInRange(dateKey, ctx.periods.lockbox)) {
      candidateIndexRowsLockboxPrepared += 1
      candidateIndexSeedsLockboxPrepared += seedCount
    }
  }
  const regimeBreakdown = {}
  for (const [tag, row] of pickedRegimeStats.entries()) {
    const pickCount = Math.max(0, Number(row?.pickedCount ?? 0) || 0)
    const hitCount = Math.max(0, Number(row?.pickHitCount ?? 0) || 0)
    regimeBreakdown[tag] = {
      pickedCount: pickCount,
      pickHitCount: hitCount,
      pickHitRate: pickCount > 0 ? hitCount / pickCount : 0
    }
  }
  const regimeBreakdownEval = {}
  for (const [tag, row] of pickedRegimeStatsEval.entries()) {
    const pickCount = Math.max(0, Number(row?.pickedCount ?? 0) || 0)
    const hitCount = Math.max(0, Number(row?.pickHitCount ?? 0) || 0)
    regimeBreakdownEval[tag] = {
      pickedCount: pickCount,
      pickHitCount: hitCount,
      pickHitRate: pickCount > 0 ? hitCount / pickCount : 0
    }
  }
  const executedRegimeBreakdown = {}
  for (const [tag, row] of executedRegimeStats.entries()) {
    const pickCount = Math.max(0, Number(row?.pickedCount ?? 0) || 0)
    const hitCount = Math.max(0, Number(row?.pickHitCount ?? 0) || 0)
    executedRegimeBreakdown[tag] = {
      pickedCount: pickCount,
      pickHitCount: hitCount,
      pickHitRate: pickCount > 0 ? hitCount / pickCount : 0
    }
  }
  const executedRegimeBreakdownEval = {}
  for (const [tag, row] of executedRegimeStatsEval.entries()) {
    const pickCount = Math.max(0, Number(row?.pickedCount ?? 0) || 0)
    const hitCount = Math.max(0, Number(row?.pickHitCount ?? 0) || 0)
    executedRegimeBreakdownEval[tag] = {
      pickedCount: pickCount,
      pickHitCount: hitCount,
      pickHitRate: pickCount > 0 ? hitCount / pickCount : 0
    }
  }
  const oraclePickGoal60 = 60
  const oraclePickGoal80 = 80
  const oraclePickGoal = oraclePickGoal60
  const oracleMaxHitsAtPickedGoalUniverse = Math.min(oracleHitDaysUniverse, oraclePickGoal)
  const oracleMaxHitsAtPickedGoalTopK = Math.min(oracleHitDaysTopK, oraclePickGoal)
  const oracleMaxHitsAtPickedGoalTopK80 = Math.min(oracleHitDaysTopK, oraclePickGoal80)
  const oracleMaxHitsAtPickedGoalTopK60Update = Math.min(oracleHitDaysTopKUpdate, oraclePickGoal60)
  const oracleMaxHitsAtPickedGoalTopK80Update = Math.min(oracleHitDaysTopKUpdate, oraclePickGoal80)
  const oracleMaxHitsAtPickedGoalTopK60Eval = Math.min(oracleHitDaysTopKEval, oraclePickGoal60)
  const oracleMaxHitsAtPickedGoalTopK80Eval = Math.min(oracleHitDaysTopKEval, oraclePickGoal80)
  const pickHitRate = pickedCount > 0 ? pickHitCount / pickedCount : 0
  const pickStopRate = pickedCount > 0 ? pickStopCount / pickedCount : 0
  const pickTimeoutRate = pickedCount > 0 ? pickTimeoutCount / pickedCount : 0
  const pickTimeoutNegativeRate =
    pickedCount > 0 ? pickTimeoutNegativeCount / pickedCount : 0
  const pickHitRateLcb95 = wilsonLowerBound({
    success: pickHitCount,
    total: pickedCount
  })
  const pickHitRateUpdate = pickedCountUpdate > 0 ? pickHitCountUpdate / pickedCountUpdate : 0
  const pickStopRateUpdate = pickedCountUpdate > 0 ? pickStopCountUpdate / pickedCountUpdate : 0
  const pickTimeoutRateUpdate = pickedCountUpdate > 0 ? pickTimeoutCountUpdate / pickedCountUpdate : 0
  const pickTimeoutNegativeRateUpdate =
    pickedCountUpdate > 0 ? pickTimeoutNegativeCountUpdate / pickedCountUpdate : 0
  const pickHitRateUpdateLcb95 = wilsonLowerBound({
    success: pickHitCountUpdate,
    total: pickedCountUpdate
  })
  const pickHitRateEval = pickedCountEval > 0 ? pickHitCountEval / pickedCountEval : 0
  const pickStopRateEval = pickedCountEval > 0 ? pickStopCountEval / pickedCountEval : 0
  const pickTimeoutRateEval = pickedCountEval > 0 ? pickTimeoutCountEval / pickedCountEval : 0
  const pickTimeoutNegativeRateEval =
    pickedCountEval > 0 ? pickTimeoutNegativeCountEval / pickedCountEval : 0
  const pickHitRateEvalLcb95 = wilsonLowerBound({
    success: pickHitCountEval,
    total: pickedCountEval
  })
  const executedHitRate = executedCount > 0 ? executedHitCount / executedCount : 0
  const executedStopRate = executedCount > 0 ? executedStopCount / executedCount : 0
  const executedTimeoutRate = executedCount > 0 ? executedTimeoutCount / executedCount : 0
  const executedTimeoutNegativeRate =
    executedCount > 0 ? executedTimeoutNegativeCount / executedCount : 0
  const executedHitRateLcb95 = wilsonLowerBound({
    success: executedHitCount,
    total: executedCount
  })
  const executedHitRateUpdate = executedCountUpdate > 0 ? executedHitCountUpdate / executedCountUpdate : 0
  const executedStopRateUpdate =
    executedCountUpdate > 0 ? executedStopCountUpdate / executedCountUpdate : 0
  const executedTimeoutRateUpdate =
    executedCountUpdate > 0 ? executedTimeoutCountUpdate / executedCountUpdate : 0
  const executedTimeoutNegativeRateUpdate =
    executedCountUpdate > 0
      ? executedTimeoutNegativeCountUpdate / executedCountUpdate
      : 0
  const executedHitRateUpdateLcb95 = wilsonLowerBound({
    success: executedHitCountUpdate,
    total: executedCountUpdate
  })
  const executedHitRateEval = executedCountEval > 0 ? executedHitCountEval / executedCountEval : 0
  const executedStopRateEval = executedCountEval > 0 ? executedStopCountEval / executedCountEval : 0
  const executedTimeoutRateEval =
    executedCountEval > 0 ? executedTimeoutCountEval / executedCountEval : 0
  const executedTimeoutNegativeRateEval =
    executedCountEval > 0
      ? executedTimeoutNegativeCountEval / executedCountEval
      : 0
  const executedHitRateEvalLcb95 = wilsonLowerBound({
    success: executedHitCountEval,
    total: executedCountEval
  })
  const agreementFallbackHitRate =
    agreementFallbackDays > 0 ? agreementFallbackHitDays / agreementFallbackDays : 0
  const agreementFallbackHitRateUpdate =
    agreementFallbackDaysUpdate > 0 ? agreementFallbackHitDaysUpdate / agreementFallbackDaysUpdate : 0
  const agreementFallbackHitRateEval =
    agreementFallbackDaysEval > 0 ? agreementFallbackHitDaysEval / agreementFallbackDaysEval : 0
  const agreementFallbackExecutedHitRate =
    agreementFallbackExecutedDays > 0
      ? agreementFallbackExecutedHitDays / agreementFallbackExecutedDays
      : 0
  const agreementFallbackExecutedHitRateUpdate =
    agreementFallbackExecutedDaysUpdate > 0
      ? agreementFallbackExecutedHitDaysUpdate / agreementFallbackExecutedDaysUpdate
      : 0
  const agreementFallbackExecutedHitRateEval =
    agreementFallbackExecutedDaysEval > 0
      ? agreementFallbackExecutedHitDaysEval / agreementFallbackExecutedDaysEval
      : 0
  const selectionHitAt1AgreementFallbackAware =
    rankableDays > 0
      ? Math.min(
        1,
        Math.max(
          0,
          (
            hitAt1Days +
            agreementFallbackHitDays -
            agreementFallbackHitAt1OverlapDays
          ) / rankableDays,
        ),
      )
      : 0
  const selectionHitAt1AgreementFallbackAwareUpdate =
    rankableDaysUpdate > 0
      ? Math.min(
        1,
        Math.max(
          0,
          (
            hitAt1DaysUpdate +
            agreementFallbackHitDaysUpdate -
            agreementFallbackHitAt1OverlapDaysUpdate
          ) / rankableDaysUpdate,
        ),
      )
      : 0
  const selectionHitAt1AgreementFallbackAwareEval =
    rankableDaysEval > 0
      ? Math.min(
        1,
        Math.max(
          0,
          (
            hitAt1DaysEval +
            agreementFallbackHitDaysEval -
            agreementFallbackHitAt1OverlapDaysEval
          ) / rankableDaysEval,
        ),
      )
      : 0
  const targetHitsPer20Days = tradingDates.length > 0 ? (pickHitCount / tradingDates.length) * 20 : 0
  const targetHitsPer20UpdateDays = updateDaysSeen > 0 ? (pickHitCountUpdate / updateDaysSeen) * 20 : 0
  const targetHitsPer20EvalDays = evalDaysSeen > 0 ? (pickHitCountEval / evalDaysSeen) * 20 : 0
  const executionCoverage = pickedCount > 0 ? executedCount / pickedCount : 0
  const executionCoverageUpdate = pickedCountUpdate > 0 ? executedCountUpdate / pickedCountUpdate : 0
  const executionCoverageEval = pickedCountEval > 0 ? executedCountEval / pickedCountEval : 0
  const oracleHitRateTopK = oracleCandidateDays > 0 ? oracleHitDaysTopK / oracleCandidateDays : 0
  const oracleHitRateTopKUpdate =
    oracleCandidateDaysUpdate > 0 ? oracleHitDaysTopKUpdate / oracleCandidateDaysUpdate : 0
  const oracleHitRateTopKEval =
    oracleCandidateDaysEval > 0 ? oracleHitDaysTopKEval / oracleCandidateDaysEval : 0
  const topKOracleGap = Math.max(0, 1 - oracleHitRateTopK)
  const topKOracleGapUpdate = Math.max(0, 1 - oracleHitRateTopKUpdate)
  const topKOracleGapEval = Math.max(0, 1 - oracleHitRateTopKEval)
  const oracleMaxHitRateAtPickedGoalTopK =
    oraclePickGoal > 0 ? oracleMaxHitsAtPickedGoalTopK / oraclePickGoal : 0
  const oracleMaxHitRateAtPickedGoalTopK80 =
    oraclePickGoal80 > 0 ? oracleMaxHitsAtPickedGoalTopK80 / oraclePickGoal80 : 0
  const top1ToOracleConversion =
    oracleHitRateTopK > 0 ? Math.min(1, Math.max(0, pickHitRate / oracleHitRateTopK)) : 0
  const top1ToOracleConversionUpdate =
    oracleHitRateTopKUpdate > 0 ? Math.min(1, Math.max(0, pickHitRateUpdate / oracleHitRateTopKUpdate)) : 0
  const top1ToOracleConversionEval =
    oracleHitRateTopKEval > 0 ? Math.min(1, Math.max(0, pickHitRateEval / oracleHitRateTopKEval)) : 0
  const budgetedConversion60 = computeBudgetedConversion({
    pickHitCount,
    oracleHitDaysTopK,
    budget: oraclePickGoal60
  })
  const budgetedConversion80 = computeBudgetedConversion({
    pickHitCount,
    oracleHitDaysTopK,
    budget: oraclePickGoal80
  })
  const budgetedConversion60Update = computeBudgetedConversion({
    pickHitCount: pickHitCountUpdate,
    oracleHitDaysTopK: oracleHitDaysTopKUpdate,
    budget: oraclePickGoal60
  })
  const budgetedConversion80Update = computeBudgetedConversion({
    pickHitCount: pickHitCountUpdate,
    oracleHitDaysTopK: oracleHitDaysTopKUpdate,
    budget: oraclePickGoal80
  })
  const budgetedConversion60Eval = computeBudgetedConversion({
    pickHitCount: pickHitCountEval,
    oracleHitDaysTopK: oracleHitDaysTopKEval,
    budget: oraclePickGoal60
  })
  const budgetedConversion80Eval = computeBudgetedConversion({
    pickHitCount: pickHitCountEval,
    oracleHitDaysTopK: oracleHitDaysTopKEval,
    budget: oraclePickGoal80
  })
  const hitAt1 = rankableDays > 0 ? hitAt1Days / rankableDays : 0
  const hitAt3 = rankableDays > 0 ? hitAt3Days / rankableDays : 0
  const hitAt5 = rankableDays > 0 ? hitAt5Days / rankableDays : 0
  const hitAt1Update = rankableDaysUpdate > 0 ? hitAt1DaysUpdate / rankableDaysUpdate : 0
  const hitAt3Update = rankableDaysUpdate > 0 ? hitAt3DaysUpdate / rankableDaysUpdate : 0
  const hitAt5Update = rankableDaysUpdate > 0 ? hitAt5DaysUpdate / rankableDaysUpdate : 0
  const hitAt1Eval = rankableDaysEval > 0 ? hitAt1DaysEval / rankableDaysEval : 0
  const hitAt3Eval = rankableDaysEval > 0 ? hitAt3DaysEval / rankableDaysEval : 0
  const hitAt5Eval = rankableDaysEval > 0 ? hitAt5DaysEval / rankableDaysEval : 0
  const firstSuccessRankAvg =
    firstSuccessRankCount > 0 ? firstSuccessRankSum / firstSuccessRankCount : 0
  const firstSuccessRankAvgUpdate =
    firstSuccessRankCountUpdate > 0 ? firstSuccessRankSumUpdate / firstSuccessRankCountUpdate : 0
  const firstSuccessRankAvgEval =
    firstSuccessRankCountEval > 0 ? firstSuccessRankSumEval / firstSuccessRankCountEval : 0
  const noCandidateDays = Math.max(0, Number(gateReasonCounts?.NO_CANDIDATE ?? 0) || 0)
  const noCandidateDaysUpdate = Math.max(0, Number(gateReasonCountsUpdate?.NO_CANDIDATE ?? 0) || 0)
  const noCandidateDaysEval = Math.max(0, Number(gateReasonCountsEval?.NO_CANDIDATE ?? 0) || 0)
  const avgRegret = regretCount > 0 ? regretSum / regretCount : 0
  const avgRegretUpdate = regretCountUpdate > 0 ? regretSumUpdate / regretCountUpdate : 0
  const avgRegretEval = regretCountEval > 0 ? regretSumEval / regretCountEval : 0
  const avgRankLoss = rankLossDays > 0 ? rankLossSum / rankLossDays : 0
  const avgRankLossUpdate = rankLossDaysUpdate > 0 ? rankLossSumUpdate / rankLossDaysUpdate : 0
  const avgRankLossEval = rankLossDaysEval > 0 ? rankLossSumEval / rankLossDaysEval : 0
  const feedbackAppliedDelayDaysAvg =
    feedbackAppliedCount > 0 ? feedbackAppliedDelayDaysSum / feedbackAppliedCount : 0
  const executionFeedbackAppliedDelayDaysAvg =
    executionFeedbackAppliedCount > 0
      ? executionFeedbackAppliedDelayDaysSum / executionFeedbackAppliedCount
      : 0
  const effectiveConfigDiff = []
  pushDiffRow(
    effectiveConfigDiff,
    "decisionGate.maxPicksPerDay",
    ctx.config?.decisionGate?.maxPicksPerDay,
    decisionGateCfg?.maxPicksPerDay,
  )
  pushDiffRow(
    effectiveConfigDiff,
    "decisionGate.secondPick.mode",
    ctx.config?.decisionGate?.secondPick?.mode ??
      ctx.config?.decisionGate?.secondPick?.phase ??
      "disabled",
    decisionGateCfg?.secondPick?.mode ?? "disabled",
  )
  pushDiffRow(
    effectiveConfigDiff,
    "decisionGate.top1Rerank.enabled",
    ctx.config?.decisionGate?.top1Rerank?.enabled === true,
    decisionGateCfg?.top1Rerank?.enabled === true,
  )
  pushDiffRow(
    effectiveConfigDiff,
    "decisionGate.coverageRecovery.enabled",
    ctx.config?.decisionGate?.coverageRecovery?.enabled === true,
    decisionGateCfg?.coverageRecovery?.enabled === true,
  )
  pushDiffRow(
    effectiveConfigDiff,
    "decisionGate.executionGate.enabled",
    ctx.config?.decisionGate?.executionGate?.enabled === true,
    executionGateCfg?.enabled === true,
  )
  pushDiffRow(
    effectiveConfigDiff,
    "decisionGate.executionGate.targetLcb",
    ctx.config?.decisionGate?.executionGate?.targetLcb,
    executionGateCfg?.targetLcb,
  )
  pushDiffRow(
    effectiveConfigDiff,
    "decisionGate.regimeRouter.enabled",
    ctx.config?.decisionGate?.regimeRouter?.enabled === true,
    regimeRouterCfg?.enabled === true,
  )
  pushDiffRow(
    effectiveConfigDiff,
    "onlineLearning.generalization.mode",
    String(
      ctx.config?.onlineLearning?.generalization?.mode ??
        ctx.config?.onlineLearning?.generalization?.splitMode ??
        "chronological",
    ),
    String(uvSplit.mode),
  )
  const effectiveRuntimeDiff = []
  pushDiffRow(
    effectiveRuntimeDiff,
    "similarity.coarseTopN_vs_runtime",
    ctx.config?.similarity?.coarseTopN,
    runtimeHybrid.coarseTopN,
  )
  pushDiffRow(
    effectiveRuntimeDiff,
    "similarity.coarseTopClusters_vs_runtime",
    ctx.config?.similarity?.coarseTopClusters,
    runtimeHybrid.coarseTopClusters,
  )
  const unexpectedConfigDiff = effectiveConfigDiff.filter(
    (row) => !allowedConfigDiffKeys.has(String(row?.key ?? "").trim()),
  )
  const unexpectedRuntimeDiff = effectiveRuntimeDiff.filter(
    (row) => !allowedRuntimeDiffKeys.has(String(row?.key ?? "").trim()),
  )
  if (failOnConfigDiff && unexpectedConfigDiff.length > 0) {
    throw new Error(
      `Unexpected effective config diff: ${unexpectedConfigDiff.map((it) => it.key).join(", ")}`,
    )
  }
  if (failOnRuntimeDiff && unexpectedRuntimeDiff.length > 0) {
    throw new Error(
      `Unexpected effective runtime diff: ${unexpectedRuntimeDiff.map((it) => it.key).join(", ")}`,
    )
  }
  const executionRegimeCalibration = {}
  const executionApprovedRegimes = []
  for (const [tag, row] of executionCalibrationRegimeStats.entries()) {
    const count = Math.max(0, Number(row?.count ?? 0) || 0)
    const hitCount = Math.max(0, Number(row?.hitCount ?? 0) || 0)
    const hitRate = count > 0 ? hitCount / count : 0
    const lcb95 = wilsonLowerBound({ success: hitCount, total: count })
    const approved =
      count >= Number(executionGateCfg?.minRegimeSamples ?? 0) &&
      lcb95 >= Number(executionGateCfg?.targetLcb ?? 0)
    if (approved) executionApprovedRegimes.push(tag)
    executionRegimeCalibration[tag] = {
      count,
      hitCount,
      hitRate,
      lcb95,
      approved
    }
  }
  const onlineLearningFeedbackEnabled =
    ctx.config.onlineLearning.enabled === true &&
    !lockboxOnlyStepDExecution &&
    c1FrozenProbe !== true
  const pairwiseLearningEnabled =
    onlineLearningFeedbackEnabled && generalizationCfg.pairwiseEnabled === true
  const executionCalibrationFeedbackEnabled =
    executionGateCfg.enabled === true &&
    !lockboxOnlyStepDExecution &&
    c1FrozenProbe !== true
  if (pairwiseLearningEnabled && pairwiseUpdateCount <= 0) {
    throw new Error("Pairwise learning enabled but pairwiseUpdates=0. Disable module explicitly or fix update path.")
  }
  const precisionCoverageCurve = buildPrecisionCoverageCurve({
    logs,
    thresholds: [0.55, 0.6, 0.65, 0.7, 0.75, 0.8]
  })
  const calibrationQualityAll = buildCalibrationDiagnostics({
    logs,
    bins: 10
  })
  const calibrationQualityEval = buildCalibrationDiagnostics({
    logs,
    bins: 10,
    partition: "V"
  })
  const calibrationQualityUpdate = buildCalibrationDiagnostics({
    logs,
    bins: 10,
    partition: "U"
  })
  let calibratedTradeCount = 0
  let calibratedHitSum = 0
  let calibratedStopSum = 0
  let calibratedFillSum = 0
  let calibratedConfidenceSum = 0
  for (const day of logs) {
    for (const row of day?.pickedList ?? []) {
      if (String(row?.executionDecision ?? "") !== "TRADE") continue
      calibratedTradeCount += 1
      calibratedHitSum += Number(row?.pHitCalibrated ?? 0) || 0
      calibratedStopSum += Number(row?.pStopFirstCalibrated ?? 0) || 0
      calibratedFillSum += Number(row?.pFillCalibrated ?? 0) || 0
      calibratedConfidenceSum += Number(row?.confidence ?? 0) || 0
    }
  }
  const feeBps = Math.max(0, Number(ctx.config?.backtest?.feeBps ?? 0) || 0)
  const slippageBps = Math.max(0, Number(ctx.config?.backtest?.slippageBps ?? 0) || 0)
  const estRoundtripCost = (feeBps + slippageBps) / 10000
  const expectedRetAvg = pickedCount > 0 ? pickExpectedNetRet3dSum / pickedCount : 0
  const afterCostExpectancy = expectedRetAvg - estRoundtripCost
  const coarsePruneRatioAvg =
    perfCounters.coarsePruneRatioCount > 0
      ? perfCounters.coarsePruneRatioSum / perfCounters.coarsePruneRatioCount
      : (
          perfCounters.totalPrototypes > 0
            ? perfCounters.totalPrototypesAfterCoarse / perfCounters.totalPrototypes
            : 0
        )
  const coarsePruneHealth = {
    warnAbove: Number(coarsePruneHealthCfg?.warnAbove ?? 0.9),
    failAbove: Number.isFinite(Number(coarsePruneHealthCfg?.failAbove))
      ? Number(coarsePruneHealthCfg.failAbove)
      : null,
    warned:
      Number.isFinite(coarsePruneRatioAvg) &&
      coarsePruneRatioAvg >= Number(coarsePruneHealthCfg?.warnAbove ?? 0.9),
    failed:
      Number.isFinite(coarsePruneRatioAvg) &&
      Number.isFinite(Number(coarsePruneHealthCfg?.failAbove)) &&
      coarsePruneRatioAvg >= Number(coarsePruneHealthCfg.failAbove),
    ratio: Number.isFinite(coarsePruneRatioAvg) ? coarsePruneRatioAvg : null
  }
  if (coarsePruneHealth.warned) {
    console.warn(
      `[step-d] coarse prune ratio high: ratio=${Number(coarsePruneRatioAvg).toFixed(6)} warnAbove=${Number(coarsePruneHealthCfg?.warnAbove ?? 0.9).toFixed(6)}`,
    )
  }
  if (coarsePruneHealth.failed) {
    const coarsePruneHealthMessage =
      `coarse prune ratio above fail threshold (ratio=${coarsePruneRatioAvg}, failAbove=${coarsePruneHealthCfg?.failAbove})`
    if (coarsePruneHealthCfg?.failHard === true && coarsePruneHealthCfg?.failSoft !== true) {
      throw new Error(coarsePruneHealthMessage)
    }
    if (coarsePruneHealthCfg?.failSoft === true) {
      console.warn(`[step-d] ${coarsePruneHealthMessage} (failSoft=true, continuing)`)
    }
  }
  const precisionAt1Executable = executedCountEval > 0
    ? executedHitCountEval / executedCountEval
    : 0
  const configuredPromotionScope = resolvePromotionScope(generalizationCfg?.promotionScope)
  const promotionScope = probeScopeRequested ?? configuredPromotionScope
  const probeScopeApplied = probeScopeRequested !== null ? promotionScope : null
  const promotionSource =
    promotionScope === "eval"
      ? "EVAL"
      : promotionScope === "tune"
        ? "TUNE"
        : "UPDATE"
  const isEvalPromotion = promotionScope === "eval"
  const promotionPickedCount = isEvalPromotion ? pickedCountEval : pickedCountUpdate
  const promotionPickHitCount = isEvalPromotion ? pickHitCountEval : pickHitCountUpdate
  const promotionPickHitRate = isEvalPromotion ? pickHitRateEval : pickHitRateUpdate
  const promotionPickHitRateLcb95 = isEvalPromotion ? pickHitRateEvalLcb95 : pickHitRateUpdateLcb95
  const promotionTop1ToOracleConversion = isEvalPromotion ? top1ToOracleConversionEval : top1ToOracleConversionUpdate
  const promotionBudgetedConversion60 = isEvalPromotion ? budgetedConversion60Eval : budgetedConversion60Update
  const promotionBudgetedConversion80 = isEvalPromotion ? budgetedConversion80Eval : budgetedConversion80Update
  const promotionHitAt1 = isEvalPromotion ? hitAt1Eval : hitAt1Update
  const promotionHitAt3 = isEvalPromotion ? hitAt3Eval : hitAt3Update
  const promotionHitAt5 = isEvalPromotion ? hitAt5Eval : hitAt5Update
  const promotionExecutedCount = isEvalPromotion ? executedCountEval : executedCountUpdate
  const promotionExecutedHitCount = isEvalPromotion ? executedHitCountEval : executedHitCountUpdate
  const promotionExecutedHitRate = isEvalPromotion ? executedHitRateEval : executedHitRateUpdate
  const promotionExecutedHitRateLcb95 = isEvalPromotion ? executedHitRateEvalLcb95 : executedHitRateUpdateLcb95
  const promotionExecutionCoverage = isEvalPromotion ? executionCoverageEval : executionCoverageUpdate
  const promotionExecutionRejectedHitDays = isEvalPromotion
    ? executionRejectedHitDaysEval
    : executionRejectedHitDaysUpdate
  const promotionFirstSuccessRankAvg = isEvalPromotion
    ? firstSuccessRankAvgEval
    : firstSuccessRankAvgUpdate
  const promotionGateRejectedHitDays = isEvalPromotion ? gateRejectedHitDaysEval : gateRejectedHitDaysUpdate
  const stepcRuntimeHash = createHash("sha1")
    .update(JSON.stringify(runtimeMeta ?? {}))
    .digest("hex")
  const runtimePrototypeTotal = Math.max(
    0,
    Number(
      runtimeMeta?.prototypeQuality?.length ??
      runtimeMeta?.runtimePrototypeCount ??
      library?.prototypes?.length ??
      0,
    ) || 0,
  )
  const prototypeStatsAllSummary = summarizePrototypeStats({
    statsMap: pickedPrototypeStats,
    totalPrototypeCount: runtimePrototypeTotal
  })
  const prototypeStatsUpdateSummary = summarizePrototypeStats({
    statsMap: pickedPrototypeStatsUpdate,
    totalPrototypeCount: runtimePrototypeTotal
  })
  const prototypeStatsEvalSummary = summarizePrototypeStats({
    statsMap: pickedPrototypeStatsEval,
    totalPrototypeCount: runtimePrototypeTotal
  })
  const clusterStatsAllSummary = summarizeCountMap(pickedClusterCounts)
  const clusterStatsUpdateSummary = summarizeCountMap(pickedClusterCountsUpdate)
  const clusterStatsEvalSummary = summarizeCountMap(pickedClusterCountsEval)
  const executionMetaRejectedPickedDaysEval =
    Number(executionShadowReasonCountsEval?.META_META_PHIT_LOW ?? 0) +
    Number(executionShadowReasonCountsEval?.META_META_FILL_LOW ?? 0) +
    Number(executionShadowReasonCountsEval?.META_SHADOW ?? 0)
  const routeMissingWeightTotal = Object.values(routeMissingWeightCounts ?? {}).reduce(
    (acc, value) => acc + (Number(value) || 0),
    0,
  )
  if (regimeRouterCfg?.enabled === true && regimeRouterCfg?.strictWeightLoad === true && routeMissingWeightTotal > 0) {
    throw new Error(
      `decisionGate.regimeRouter strictWeightLoad violated: missing-route-weight count=${routeMissingWeightTotal}`,
    )
  }
  const falsePositiveRouteState = Object.fromEntries(
    Array.from(falsePositiveRouteStats.entries()).map(([key, row]) => [
      String(key),
      {
        count: Math.max(0, Number(row?.count ?? 0) || 0),
        falsePositiveCount: Math.max(0, Number(row?.falsePositiveCount ?? 0) || 0)
      }
    ]),
  )
  const falsePositiveRegimeState = Object.fromEntries(
    Array.from(falsePositiveRegimeStats.entries()).map(([key, row]) => [
      String(key),
      {
        count: Math.max(0, Number(row?.count ?? 0) || 0),
        falsePositiveCount: Math.max(0, Number(row?.falsePositiveCount ?? 0) || 0)
      }
    ]),
  )
  const falsePositivePrototypeState = Object.fromEntries(
    Array.from(falsePositivePrototypeStats.entries()).map(([key, row]) => [
      String(key),
      {
        count: Math.max(0, Number(row?.count ?? 0) || 0),
        falsePositiveCount: Math.max(0, Number(row?.falsePositiveCount ?? 0) || 0)
      }
    ]),
  )
  const falsePositiveModelFinal = trainFalsePositiveModelFromDataset({
    rows: adversarialReplayRows.filter(
      (row) =>
        isUpdateLikePartition(row?.split) &&
        shouldUseFalsePositiveLearningRow({
          row,
          cfg: falsePositiveModelCfg
        }),
    ),
    cfg: falsePositiveModelCfg,
    seedModel: falsePositiveModel
  })
  const agreementGateModelFinal = trainAgreementGateModelFromDataset({
    rows: agreementDatasetRows.filter((row) => isUpdateLikePartition(row?.split)),
    cfg: agreementGateModelCfg,
    seedModel: agreementGateModel
  })
  const dayTypeModelFinal = trainDayTypeModelFromDataset({
    rows: dayTypeDatasetRows.filter((row) => isUpdateLikePartition(row?.split)),
    cfg: dayTypeModelCfg
  })
  const falsePositiveDatasetMeta = {
    generatedAt: new Date().toISOString(),
    rows: falsePositiveDatasetRows.length,
    updateRows: falsePositiveDatasetRows.filter((row) => isUpdateLikePartition(row?.split)).length,
    positiveRows: falsePositiveDatasetRows.filter((row) => hasBinaryLabel(row?.labelFalsePositive) && Number(row?.labelFalsePositive) === 1).length,
    negativeRows: falsePositiveDatasetRows.filter((row) => hasBinaryLabel(row?.labelFalsePositive) && Number(row?.labelFalsePositive) === 0).length,
    outcomeBuckets: falsePositiveDatasetRows.reduce((acc, row) => {
      const key = String(row?.realizedOutcomeBucket ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN"
      acc[key] = Number(acc[key] ?? 0) + 1
      return acc
    }, {}),
    preExecutionPassedRows: falsePositiveDatasetRows.filter((row) => row?.preExecutionPassed === true).length,
    labelSources: falsePositiveDatasetRows.reduce((acc, row) => {
      const key = String(row?.labelSource ?? "UNKNOWN")
      acc[key] = Number(acc[key] ?? 0) + 1
      return acc
    }, {})
  }
  const adversarialReplayDatasetMeta = {
    generatedAt: new Date().toISOString(),
    rows: adversarialReplayRows.length,
    updateRows: adversarialReplayRows.filter((row) => isUpdateLikePartition(row?.split)).length,
    positiveRows: adversarialReplayRows.filter((row) => hasBinaryLabel(row?.labelFalsePositive) && Number(row?.labelFalsePositive) === 1).length,
    negativeRows: adversarialReplayRows.filter((row) => hasBinaryLabel(row?.labelFalsePositive) && Number(row?.labelFalsePositive) === 0).length,
    outcomeBuckets: adversarialReplayRows.reduce((acc, row) => {
      const key = String(row?.realizedOutcomeBucket ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN"
      acc[key] = Number(acc[key] ?? 0) + 1
      return acc
    }, {}),
    weightedPositiveRows: adversarialReplayRows.reduce(
      (acc, row) =>
        acc + (
          hasBinaryLabel(row?.labelFalsePositive) && Number(row?.labelFalsePositive) === 1
            ? Math.max(0, Number(row?.sampleWeight ?? 0) || 0)
            : 0
        ),
      0,
    ),
    weightedNegativeRows: adversarialReplayRows.reduce(
      (acc, row) =>
        acc + (
          hasBinaryLabel(row?.labelFalsePositive) && Number(row?.labelFalsePositive) === 0
            ? Math.max(0, Number(row?.sampleWeight ?? 0) || 0)
            : 0
        ),
      0,
    ),
    replayKinds: adversarialReplayRows.reduce((acc, row) => {
      const key = String(row?.replayKind ?? "UNKNOWN")
      acc[key] = Number(acc[key] ?? 0) + 1
      return acc
    }, {})
  }
  const agreementDatasetMeta = {
    generatedAt: new Date().toISOString(),
    rows: agreementDatasetRows.length,
    updateRows: agreementDatasetRows.filter((row) => isUpdateLikePartition(row?.split)).length,
    positiveRows: agreementDatasetRows.filter((row) => hasBinaryLabel(row?.labelAgreement) && Number(row?.labelAgreement) === 1).length,
    negativeRows: agreementDatasetRows.filter((row) => hasBinaryLabel(row?.labelAgreement) && Number(row?.labelAgreement) === 0).length,
    labelSources: agreementDatasetRows.reduce((acc, row) => {
      const key = String(row?.labelSource ?? "UNKNOWN")
      acc[key] = Number(acc[key] ?? 0) + 1
      return acc
    }, {})
  }
  const dayTypeDatasetMeta = {
    generatedAt: new Date().toISOString(),
    rows: dayTypeDatasetRows.length,
    updateRows: dayTypeDatasetRows.filter((row) => isUpdateLikePartition(row?.split)).length,
    overrideRows: dayTypeDatasetRows.filter(
      (row) => String(row?.ruleDayType ?? "") !== String(row?.finalDayType ?? ""),
    ).length,
    labels: dayTypeDatasetRows.reduce((acc, row) => {
      const key = String(row?.trainingLabel ?? row?.ruleDayType ?? "BALANCED")
      acc[key] = Number(acc[key] ?? 0) + 1
      return acc
    }, {}),
    trainingLabelSources: dayTypeDatasetRows.reduce((acc, row) => {
      const key = String(row?.trainingLabelSource ?? "UNKNOWN")
      acc[key] = Number(acc[key] ?? 0) + 1
      return acc
    }, {}),
    executedOutcomeSources: dayTypeDatasetRows.reduce((acc, row) => {
      const key = String(row?.executedOutcomeSource ?? "UNKNOWN")
      acc[key] = Number(acc[key] ?? 0) + 1
      return acc
    }, {})
  }
  const scopeDiagnostics = {
    all: buildScopeDiagnostic({
      label: "ALL",
      tradingDays: tradingDates.length,
      pickedDays,
      pickedCount,
      pickHitCount,
      pickHitRate,
      executedCount,
      executedHitCount,
      executedHitRate,
      executionCoverage,
      noCandidateDays,
      gateReasonCounts,
      agreementDecisionCounts,
      agreementReasonCounts,
      dayTypeCounts,
      executionDecisionCounts,
      executionShadowReasonCounts,
      falsePositiveDecisionCounts,
      falsePositiveReasonCounts,
      budgetDecisionCounts,
      budgetReasonCounts
    }),
    update: buildScopeDiagnostic({
      label: "UPDATE",
      tradingDays: updateDaysSeen,
      pickedDays: pickedDaysUpdate,
      pickedCount: pickedCountUpdate,
      pickHitCount: pickHitCountUpdate,
      pickHitRate: pickHitRateUpdate,
      executedCount: executedCountUpdate,
      executedHitCount: executedHitCountUpdate,
      executedHitRate: executedHitRateUpdate,
      executionCoverage: executionCoverageUpdate,
      noCandidateDays: noCandidateDaysUpdate,
      gateReasonCounts: gateReasonCountsUpdate,
      agreementDecisionCounts: agreementDecisionCountsUpdate,
      agreementReasonCounts: agreementReasonCountsUpdate,
      dayTypeCounts: dayTypeCountsUpdate,
      executionDecisionCounts: executionDecisionCountsUpdate,
      executionShadowReasonCounts: executionShadowReasonCountsUpdate,
      falsePositiveDecisionCounts: falsePositiveDecisionCountsUpdate,
      falsePositiveReasonCounts: falsePositiveReasonCountsUpdate,
      budgetDecisionCounts: budgetDecisionCountsUpdate,
      budgetReasonCounts: budgetReasonCountsUpdate
    }),
    eval: buildScopeDiagnostic({
      label: "EVAL",
      tradingDays: evalDaysSeen,
      pickedDays: pickedDaysEval,
      pickedCount: pickedCountEval,
      pickHitCount: pickHitCountEval,
      pickHitRate: pickHitRateEval,
      executedCount: executedCountEval,
      executedHitCount: executedHitCountEval,
      executedHitRate: executedHitRateEval,
      executionCoverage: executionCoverageEval,
      noCandidateDays: noCandidateDaysEval,
      gateReasonCounts: gateReasonCountsEval,
      agreementDecisionCounts: agreementDecisionCountsEval,
      agreementReasonCounts: agreementReasonCountsEval,
      dayTypeCounts: dayTypeCountsEval,
      executionDecisionCounts: executionDecisionCountsEval,
      executionShadowReasonCounts: executionShadowReasonCountsEval,
      falsePositiveDecisionCounts: falsePositiveDecisionCountsEval,
      falsePositiveReasonCounts: falsePositiveReasonCountsEval,
      budgetDecisionCounts: budgetDecisionCountsEval,
      budgetReasonCounts: budgetReasonCountsEval
    })
  }
  const evalScopeDiagnostic = scopeDiagnostics.eval
  const sampleStarvation =
    Math.max(0, Number(pickedCountEval ?? 0) || 0) <
    Math.max(0, Number(ctx?.config?.cdLoop?.minPickedCountForPromotion ?? 10) || 10)
  const oracleGoodButTop1Bad =
    Number(oracleHitRateTopKEval ?? oracleHitRateTopK ?? 0) >= 0.95 &&
    Number(top1ToOracleConversionEval ?? top1ToOracleConversion ?? 0) <
      Math.max(
        0,
        Number(ctx?.config?.cdLoop?.minTop1ToOracleConversionForPromotion ?? 0.35) || 0.35,
      )
  const promotionContext = {
    source: promotionSource,
    primaryScope: promotionSource,
    primaryPickedCount: promotionPickedCount,
    primaryPickedDays: isEvalPromotion ? pickedDaysEval : pickedDaysUpdate,
    primaryExecutedCount: promotionExecutedCount,
    primaryExecutionCoverage: promotionExecutionCoverage,
    allPickedCount: pickedCount,
    allPickedDays: pickedDays,
    updatePickedCount: pickedCountUpdate,
    updatePickedDays: pickedDaysUpdate,
    evalPickedCount: pickedCountEval,
    evalPickedDays: pickedDaysEval,
    allExecutedCount: executedCount,
    updateExecutedCount: executedCountUpdate,
    evalExecutedCount: executedCountEval,
    note: "promotionView and cd-loop primary metrics follow promotionScope; use scopeDiagnostics for ALL/UPDATE/EVAL counts."
  }
  const c0SelectionSummary = summarizeC0FamilySelection({
    auditRows: logs,
    prototypeQualityLookup,
    selectedFamilyIds: runtimeMeta?.c1?.effectiveFamilyIds ?? runtimeMeta?.c1?.passedFamilyIds ?? [],
    representativeFamilyIds:
      runtimeMeta?.c2?.effectiveRepresentativeFamilyIds ??
      runtimeMeta?.c2?.representativeFamilyIds ??
      []
  })
  const c1AllowedFamilyIds = Array.isArray(ctx.__runtime?.allowedC0FamilyIds)
    ? ctx.__runtime.allowedC0FamilyIds.map((value) => String(value ?? "").trim()).filter(Boolean)
    : []
  const effectiveC1FamilyIds =
    c1AllowedFamilyIds.length > 0
      ? c1AllowedFamilyIds
      : (Array.isArray(runtimeMeta?.c1?.effectiveFamilyIds)
        ? runtimeMeta.c1.effectiveFamilyIds
        : (runtimeMeta?.c1?.passedFamilyIds ?? []))
  const effectiveC2RepresentativeFamilyIds = Array.isArray(
    runtimeMeta?.c2?.effectiveRepresentativeFamilyIds,
  )
    ? runtimeMeta.c2.effectiveRepresentativeFamilyIds
    : (Array.isArray(runtimeMeta?.c2?.representativeFamilyIds)
      ? runtimeMeta.c2.representativeFamilyIds
      : [])
  const c1SelectionSummary = {
    enabled: effectiveC1FamilyIds.length > 0,
    allowedFamilyIds: effectiveC1FamilyIds,
    selectedC1FamilyShare: Number(c0SelectionSummary?.selectedC1FamilyShare ?? 0) || 0
  }
  const c2SelectionSummary = {
    enabled: effectiveC2RepresentativeFamilyIds.length > 0,
    representativeFamilyIds: effectiveC2RepresentativeFamilyIds,
    topMatchedC2RepresentativeFamilyId:
      String(c0SelectionSummary?.topMatchedC2RepresentativeFamilyId ?? "").trim() || null,
    selectedC2FamilyShare: Number(c0SelectionSummary?.selectedC2FamilyShare ?? 0) || 0
  }
  const summary = {
    step: "D",
    period: ctx.periods.online,
    metricPrimary: goalMode === "TARGET_FIRST_V2" ? "target_hit_rate_eval" : "precision_at_1_executable",
    metricPrimaryDescription:
      goalMode === "TARGET_FIRST_V2"
        ? "picked target-hit ratio (eval split only)"
        : "executed hit ratio (eval split only)",
    stepDMode:
      stepDExecutionProfile === "FAST_ONLINE"
        ? "FAST_ONLINE"
        : stepDExecutionProfile === "LOCKBOX_AUDIT_ONLY"
          ? "LOCKBOX_AUDIT_ONLY"
        : prepareLockboxDuringStepD
          ? "ONLINE_PLUS_LOCKBOX"
          : "ONLINE_ONLY",
    stepDExecutionProfile,
    c1FrozenProbe,
    writebacksDisabled,
    feedbackUpdatesSkipped,
    executionFeedbackSkipped,
    probeScopeRequested: probeScopeRequestedRaw || null,
    probeScopeApplied,
    probeScopeUsed: String(ctx.__runtime?.probeScopeOverride ?? "").trim() || null,
    probeProfileUsed:
      String(ctx.__runtime?.stepDProfileOverride ?? ctx.__runtime?.stepDExecutionProfileOverride ?? "")
        .trim()
        .toUpperCase() || stepDExecutionProfile,
    topMatchedC2RepresentativeFamilyId: c2SelectionSummary.topMatchedC2RepresentativeFamilyId,
    artifactTier,
    validatedTradeOutcomeFeedback: {
      path: latestValidatedTradeOutcomes.sourcePath,
      available: latestValidatedTradeOutcomes.available === true,
      rows: latestValidatedTradeOutcomes.rowCount,
      replayFeedbackDaysUsed: validatedTradeReplayFeedbackDays.length,
      replayRowsUsed: validatedTradeReplayDatasets.falsePositiveRows.length,
      agreementReplayRowsUsed: validatedTradeReplayDatasets.agreementRows.length,
      dayTypeReplayRowsUsed: validatedTradeReplayDatasets.dayTypeRows.length,
      indexPreferred: latestValidatedTradeOutcomes.sourcePath.endsWith(".json"),
      seedCacheHit: validatedTradeReplayDatasets.cacheHit === true,
      seedCacheSource: validatedTradeReplayDatasets.cacheSource ?? "none"
    },
    runtimeCacheReuseEnabled: reuseRuntimeCache,
    runtimeCacheHit,
    workerPoolEnabled,
    workerPoolCreated,
    workerPoolCacheHit,
    keepWorkerPoolAlive,
    scoringWorkers: workerPoolEnabled ? Number(workerPool?.workerCount ?? scoringWorkers) : 1,
    workerChunkSize: workerPoolEnabled ? Number(workerPool?.chunkSize ?? workerChunkSize) : 0,
    workerPoolScoreMs,
    workerPoolPackMs,
    workerPoolComputeMs,
    workerPoolBatchCount,
    candidateIndexPeriod,
    lockboxArtifactCache: {
      enabled: lockboxArtifactCacheEnabled,
      hit: lockboxArtifactCacheHit,
      eligible: lockboxCacheEligible,
      writeDirect: lockboxCacheWriteDirect,
      key: lockboxArtifactCacheKey,
      cacheDir: lockboxArtifactCacheBaseDir,
      prepareLockboxDuringStepDConfigured,
      prepareLockboxDuringStepDEffective,
    },
    candidatePrefilter: "bitset",
    similarityGate: {
      enabled: decisionGateCfg?.similarityGate?.enabled === true,
      config: {
        minRawSimilarity: num(decisionGateCfg?.similarityGate?.minRawSimilarity),
        minLocalStageScore: num(decisionGateCfg?.similarityGate?.minLocalStageScore),
        minTriggerStageScore: num(decisionGateCfg?.similarityGate?.minTriggerStageScore)
      },
      similarityDisambiguation: {
        enabled: similarityDisambiguationEnabled,
        minTop1Top2Gap: num(similarityDisambiguationCfg?.minTop1Top2Gap),
        minPositiveNegativeGap: num(similarityDisambiguationCfg?.minPositiveNegativeGap),
        negativeBuckets: Array.isArray(similarityDisambiguationCfg?.negativeBuckets)
          ? similarityDisambiguationCfg.negativeBuckets
          : []
      },
      winnerTelemetry: {
        winnerChangedAfterSimilarityGateDays,
        winnerChangedAfterSimilarityGateDaysUpdate,
        winnerChangedAfterSimilarityGateDaysEval,
        top1RejectedBySimilarityGateDays,
        top1RejectedBySimilarityGateDaysUpdate,
        top1RejectedBySimilarityGateDaysEval,
        oracleHitRejectedBySimilarityGateDays,
        oracleHitRejectedBySimilarityGateDaysUpdate,
        oracleHitRejectedBySimilarityGateDaysEval
      },
      online: buildSimilarityGateSummary({
        similarityCfg: decisionGateCfg?.similarityGate,
        disambiguationCfg: similarityDisambiguationCfg,
        stats: onlineSimilarityGateStats
      }),
      lockbox: buildSimilarityGateSummary({
        similarityCfg: decisionGateCfg?.similarityGate,
        disambiguationCfg: similarityDisambiguationCfg,
        stats: lockboxSimilarityGateStats
      })
    },
    sampledDebugLog: {
      enabled: sampledDebugEnabled,
      evalOnly: sampledDebugEvalOnly,
      selectedOrRejectedOnly: sampledDebugSelectedOrRejectedOnly,
      topK: sampledDebugTopK,
      days: sampledDebugLogs.length,
      rows: sampledDebugRows,
      path: sampledDebugEnabled ? sampledDebugPath : null
    },
    overrideGuard: {
      enabled: overrideGuardEnabled,
      failOnConfigDiff,
      failOnRuntimeDiff,
      allowedConfigDiffKeys: Array.from(allowedConfigDiffKeys),
      allowedRuntimeDiffKeys: Array.from(allowedRuntimeDiffKeys),
      unexpectedConfigDiffCount: unexpectedConfigDiff.length,
      unexpectedRuntimeDiffCount: unexpectedRuntimeDiff.length
    },
    tradingDays: tradingDates.length,
    generalization: {
      enabled: uvSplit.enabled === true && !lockboxOnlyStepDExecution,
      useEvalForPromotion: promotionScope === "eval",
      configuredPromotionScope,
      effectivePromotionScope: promotionScope,
      promotionScope,
      mode: uvSplit.mode,
      updateRatio: Number(generalizationCfg.updateRatio ?? 0),
      evalMinDays: Number(generalizationCfg.evalMinDays ?? 0),
      evalFoldOffset: Number(generalizationCfg.evalFoldOffset ?? 0),
      updateDays: updateDaysSeen,
      evalDays: evalDaysSeen,
      pairwiseEnabled: pairwiseLearningEnabled,
      pairwisePositiveTopN: Number(generalizationCfg.pairwisePositiveTopN ?? 0),
      pairwiseNegativeTopN: Number(generalizationCfg.pairwiseNegativeTopN ?? 0),
      pairwiseWeight: Number(generalizationCfg.pairwiseWeight ?? 0),
      hardNegativeWeight: Number(generalizationCfg.hardNegativeWeight ?? 0),
      rankLossMarginScale: Number(generalizationCfg.rankLossMarginScale ?? 0),
      rankLossMaxFactor: Number(generalizationCfg.rankLossMaxFactor ?? 0),
      pairwiseMaxUpdatesPerDay: Number(generalizationCfg.pairwiseMaxUpdatesPerDay ?? 0),
      feedbackDelayDays: Number(generalizationCfg.feedbackDelayDays ?? 0),
      purgeGapDays: Number(generalizationCfg.purgeGapDays ?? 0),
      weightRegularization: {
        enabled: generalizationCfg?.weightRegularization?.enabled !== false,
        minActiveGroupWeight: Number(generalizationCfg?.weightRegularization?.minActiveGroupWeight ?? 0),
        maxSingleGroupWeight: Number(generalizationCfg?.weightRegularization?.maxSingleGroupWeight ?? 0),
        weightEntropyFloor: Number(generalizationCfg?.weightRegularization?.weightEntropyFloor ?? 0),
        maxDailyWeightShiftL1: Number(generalizationCfg?.weightRegularization?.maxDailyWeightShiftL1 ?? 0)
      },
      extendedBias: {
        enabled: generalizationCfg?.extendedBias?.enabled === true,
        routeBucketBiasWeight: Number(generalizationCfg?.extendedBias?.routeBucketBiasWeight ?? 0),
        regimeBiasWeight: Number(generalizationCfg?.extendedBias?.regimeBiasWeight ?? 0),
        prototypeBiasWeight: Number(generalizationCfg?.extendedBias?.prototypeBiasWeight ?? 0),
        maxAbsBias: Number(generalizationCfg?.extendedBias?.maxAbsBias ?? 0),
        l2Penalty: Number(generalizationCfg?.extendedBias?.l2Penalty ?? 0),
        learningRate: Number(generalizationCfg?.extendedBias?.learningRate ?? 0),
        routeBucketBiasStateSize: Object.keys(routeBiasState).length,
        regimeBiasStateSize: Object.keys(regimeBiasState).length,
        prototypeBiasStateSize: Object.keys(prototypeBiasState).length
      },
	      tradeQualityPrior: {
	          enabled: generalizationCfg?.tradeQualityPrior?.enabled === true,
	          routeBucketWeight: Number(generalizationCfg?.tradeQualityPrior?.routeBucketWeight ?? 0),
	          regimeWeight: Number(generalizationCfg?.tradeQualityPrior?.regimeWeight ?? 0),
	          prototypeWeight: Number(generalizationCfg?.tradeQualityPrior?.prototypeWeight ?? 0),
	          maxAbsAdjustment: Number(generalizationCfg?.tradeQualityPrior?.maxAbsAdjustment ?? 0),
	          priorSamples: Number(generalizationCfg?.tradeQualityPrior?.priorSamples ?? 0),
	          targetWeight: Number(generalizationCfg?.tradeQualityPrior?.targetWeight ?? 0),
	          stopPenaltyWeight: Number(generalizationCfg?.tradeQualityPrior?.stopPenaltyWeight ?? 0),
	          timeoutPositiveWeight: Number(generalizationCfg?.tradeQualityPrior?.timeoutPositiveWeight ?? 0),
	          timeoutNegativePenaltyWeight: Number(
	            generalizationCfg?.tradeQualityPrior?.timeoutNegativePenaltyWeight ?? 0,
	          ),
	          netRetWeight: Number(generalizationCfg?.tradeQualityPrior?.netRetWeight ?? 0),
	          netRetScale: Number(generalizationCfg?.tradeQualityPrior?.netRetScale ?? 0),
	          applyToRanker: generalizationCfg?.tradeQualityPrior?.applyToRanker === true,
          sourceMode: String(generalizationCfg?.tradeQualityPrior?.sourceMode ?? "selected_candidates"),
          requireExecutedTrade: generalizationCfg?.tradeQualityPrior?.requireExecutedTrade === true,
          mode: "hierarchical_residual",
          globalStateSize: Object.keys(globalTradeQualityState).length,
          routeBucketStateSize: Object.keys(routeTradeQualityState).length,
          regimeStateSize: Object.keys(regimeTradeQualityState).length,
          prototypeStateSize: Object.keys(prototypeTradeQualityState).length
        }
    },
    uvSplit: {
      enabled: uvSplit.enabled === true,
      mode: uvSplit.mode,
      updateDays: updateDaysSeen,
      evalDays: evalDaysSeen
    },
    adaptiveMinFinalScore: {
      enabled: adaptiveMinFinalCfg.enabled === true,
      base: Number(decisionGateCfg?.minFinalScore ?? 0),
      offset: Number(adaptiveMinFinalOffset ?? 0),
      current: Number(decisionGateCfg?.minFinalScore ?? 0) + Number(adaptiveMinFinalOffset ?? 0),
      minFloor: Number(adaptiveMinFinalCfg.minFloor ?? 0),
      maxCeil: Number(adaptiveMinFinalCfg.maxCeil ?? 0),
      mode: String(adaptiveMinFinalCfg.mode ?? "quality_aware"),
      targetMinPicked: Number(adaptiveMinFinalCfg.targetMinPicked ?? 0),
      targetMaxPicked: Number(adaptiveMinFinalCfg.targetMaxPicked ?? 0),
      step: Number(adaptiveMinFinalCfg.step ?? 0),
      hysteresis: Number(adaptiveMinFinalCfg.hysteresis ?? 0),
      minLcbFloor: Number(adaptiveMinFinalCfg.minLcbFloor ?? 0),
      minBudgetedConversion80Floor: Number(adaptiveMinFinalCfg.minBudgetedConversion80Floor ?? 0),
      warmupDays: Number(adaptiveMinFinalCfg.warmupDays ?? 0),
      adjustments: adaptiveMinFinalAdjustments,
      tightenCount: adaptiveMinFinalTightenCount,
      loosenCount: adaptiveMinFinalLoosenCount
    },
    pairwiseLearning: {
      enabled: pairwiseLearningEnabled,
      pairwiseUpdates: pairwiseUpdateCount,
      hardNegativeUpdates: hardNegativeUpdateCount,
      negativeOnlyUpdates: negativeOnlyUpdateCount
    },
    onlineLearningFeedback: {
      enabled: onlineLearningFeedbackEnabled,
      queuedCount: feedbackQueuedCount,
      appliedCount: feedbackAppliedCount,
      pendingCount: feedbackQueue.length,
      pendingCountMax: feedbackPendingCountMax,
      noUpdateCount: feedbackNoUpdateCount,
      noUpdateReasonCounts: feedbackNoUpdateReasonCounts,
      appliedDelayDaysAvg: feedbackAppliedDelayDaysAvg,
      appliedDelayDaysMax: feedbackAppliedDelayDaysMax,
      lookaheadViolations
    },
    executionCalibrationFeedback: {
      enabled: executionCalibrationFeedbackEnabled,
      feedbackScope: String(executionGateCfg?.feedbackScope ?? "update_only"),
      queuedCount: executionFeedbackQueuedCount,
      appliedCount: executionFeedbackAppliedCount,
      pendingCount: executionFeedbackQueue.length,
      pendingCountMax: executionFeedbackPendingCountMax,
      skippedByEvalCount: executionFeedbackSkippedByEvalCount,
      appliedDelayDaysAvg: executionFeedbackAppliedDelayDaysAvg,
      appliedDelayDaysMax: executionFeedbackAppliedDelayDaysMax,
      lookaheadViolations: executionLookaheadViolations
    },
    oraclePickGoal,
    oraclePickGoal60,
    oraclePickGoal80,
    oracleCandidateDays,
    oracleHitDaysUniverse,
    oracleHitDaysTopK,
    oracleMissedByTopKDays,
    oraclePickGoalFeasible: oracleCandidateDays >= oraclePickGoal,
    oraclePickGoalShortfall: Math.max(0, oraclePickGoal - oracleCandidateDays),
    oracleHitRateUniverse: oracleCandidateDays > 0 ? oracleHitDaysUniverse / oracleCandidateDays : 0,
    oracleHitRateTopK,
    oracleMaxHitsAtPickedGoalUniverse,
    oracleMaxHitRateAtPickedGoalUniverse: oraclePickGoal > 0 ? oracleMaxHitsAtPickedGoalUniverse / oraclePickGoal : 0,
    oracleMaxHitsAtPickedGoalTopK,
    oracleMaxHitRateAtPickedGoalTopK,
    oracleMaxHitsAtPickedGoalTopK80,
    oracleMaxHitRateAtPickedGoalTopK80,
    localWindow,
    globalWindow,
    minWindow,
    highJumpMode,
    hitWindowDays,
    hitLabel:
      highJumpMode === "FROM_PREV_CLOSE"
        ? `HIGH8_WITHIN_${hitWindowDays}D_FROM_ASOF_CLOSE`
        : `HIGH8_WITHIN_${hitWindowDays}D_FROM_OPEN_EX_GAP`,
    goalMode,
    positionSemantics,
    useStopLoss,
    stopLossPct,
    sameDayTiePolicy,
    pickedDays,
    dayHitDays,
    dayHitRate: pickedDays > 0 ? dayHitDays / pickedDays : 0,
    pickedDaysUpdate,
    dayHitDaysUpdate,
    dayHitRateUpdate: pickedDaysUpdate > 0 ? dayHitDaysUpdate / pickedDaysUpdate : 0,
    pickedDaysEval,
    dayHitDaysEval,
    dayHitRateEval: pickedDaysEval > 0 ? dayHitDaysEval / pickedDaysEval : 0,
    pickedCount,
    pickHitCount,
    pickHitRate,
    targetHitCount: pickHitCount,
    targetHitRate: pickHitRate,
    stopCount: pickStopCount,
    stopRate: pickStopRate,
    timeoutCount: pickTimeoutCount,
    timeoutRate: pickTimeoutRate,
    timeoutNegativeCount: pickTimeoutNegativeCount,
    timeoutNegativeRate: pickTimeoutNegativeRate,
    targetHitsPer20TradingDays: targetHitsPer20Days,
    pickHitRateLcb95,
    pickedCountUpdate,
    pickHitCountUpdate,
    pickHitRateUpdate,
    targetHitCountUpdate: pickHitCountUpdate,
    targetHitRateUpdate: pickHitRateUpdate,
    stopCountUpdate: pickStopCountUpdate,
    stopRateUpdate: pickStopRateUpdate,
    timeoutCountUpdate: pickTimeoutCountUpdate,
    timeoutRateUpdate: pickTimeoutRateUpdate,
    timeoutNegativeCountUpdate: pickTimeoutNegativeCountUpdate,
    timeoutNegativeRateUpdate: pickTimeoutNegativeRateUpdate,
    targetHitsPer20UpdateDays,
    pickHitRateUpdateLcb95,
    pickedCountEval,
    pickHitCountEval,
    pickHitRateEval,
    targetHitCountEval: pickHitCountEval,
    targetHitRateEval: pickHitRateEval,
    stopCountEval: pickStopCountEval,
    stopRateEval: pickStopRateEval,
    timeoutCountEval: pickTimeoutCountEval,
    timeoutRateEval: pickTimeoutRateEval,
    timeoutNegativeCountEval: pickTimeoutNegativeCountEval,
    timeoutNegativeRateEval: pickTimeoutNegativeRateEval,
    targetsPer20EvalDays: targetHitsPer20EvalDays,
    pickHitRateEvalLcb95,
    stepcRuntimeHash,
    prototypeUsageCoverage:
      Number.isFinite(Number(prototypeStatsAllSummary.usageCoverage))
        ? Number(prototypeStatsAllSummary.usageCoverage)
        : 0,
    prototypeUsageCoverageUpdate:
      Number.isFinite(Number(prototypeStatsUpdateSummary.usageCoverage))
        ? Number(prototypeStatsUpdateSummary.usageCoverage)
        : 0,
    prototypeUsageCoverageEval:
      Number.isFinite(Number(prototypeStatsEvalSummary.usageCoverage))
        ? Number(prototypeStatsEvalSummary.usageCoverage)
        : 0,
    top10PrototypeShare:
      Number.isFinite(Number(prototypeStatsAllSummary.top10Share))
        ? Number(prototypeStatsAllSummary.top10Share)
        : 0,
    top10PrototypeShareUpdate:
      Number.isFinite(Number(prototypeStatsUpdateSummary.top10Share))
        ? Number(prototypeStatsUpdateSummary.top10Share)
        : 0,
    top10PrototypeShareEval:
      Number.isFinite(Number(prototypeStatsEvalSummary.top10Share))
        ? Number(prototypeStatsEvalSummary.top10Share)
        : 0,
    zeroHitPrototypeShare:
      Number.isFinite(Number(prototypeStatsAllSummary.zeroHitShare))
        ? Number(prototypeStatsAllSummary.zeroHitShare)
        : 0,
    zeroHitPrototypeShareUpdate:
      Number.isFinite(Number(prototypeStatsUpdateSummary.zeroHitShare))
        ? Number(prototypeStatsUpdateSummary.zeroHitShare)
        : 0,
    zeroHitPrototypeShareEval:
      Number.isFinite(Number(prototypeStatsEvalSummary.zeroHitShare))
        ? Number(prototypeStatsEvalSummary.zeroHitShare)
        : 0,
    prototypeEntropy:
      Number.isFinite(Number(prototypeStatsAllSummary.entropy))
        ? Number(prototypeStatsAllSummary.entropy)
        : 0,
    prototypeEntropyUpdate:
      Number.isFinite(Number(prototypeStatsUpdateSummary.entropy))
        ? Number(prototypeStatsUpdateSummary.entropy)
        : 0,
    prototypeEntropyEval:
      Number.isFinite(Number(prototypeStatsEvalSummary.entropy))
        ? Number(prototypeStatsEvalSummary.entropy)
        : 0,
    effectiveRankLocal:
      Number.isFinite(Number(prototypeStatsAllSummary.effectiveRank))
        ? Number(prototypeStatsAllSummary.effectiveRank)
        : 0,
    effectiveRankLocalUpdate:
      Number.isFinite(Number(prototypeStatsUpdateSummary.effectiveRank))
        ? Number(prototypeStatsUpdateSummary.effectiveRank)
        : 0,
    effectiveRankLocalEval:
      Number.isFinite(Number(prototypeStatsEvalSummary.effectiveRank))
        ? Number(prototypeStatsEvalSummary.effectiveRank)
        : 0,
    effectiveRankGlobal:
      Number.isFinite(Number(clusterStatsAllSummary.effectiveRank))
        ? Number(clusterStatsAllSummary.effectiveRank)
        : 0,
    effectiveRankGlobalUpdate:
      Number.isFinite(Number(clusterStatsUpdateSummary.effectiveRank))
        ? Number(clusterStatsUpdateSummary.effectiveRank)
        : 0,
    effectiveRankGlobalEval:
      Number.isFinite(Number(clusterStatsEvalSummary.effectiveRank))
        ? Number(clusterStatsEvalSummary.effectiveRank)
        : 0,
    selectionHitAt1Eval: hitAt1Eval,
    selectionHitAt1AgreementFallbackAware: selectionHitAt1AgreementFallbackAware,
    selectionHitAt1AgreementFallbackAwareUpdate: selectionHitAt1AgreementFallbackAwareUpdate,
    selectionHitAt1AgreementFallbackAwareEval: selectionHitAt1AgreementFallbackAwareEval,
    selectionPickHitRateEval: pickHitRateEval,
    selectionGateRejectedHitDaysEval: gateRejectedHitDaysEval,
    agreementFallbackDays,
    agreementFallbackDaysUpdate,
    agreementFallbackDaysEval,
    agreementFallbackHitDays,
    agreementFallbackHitDaysUpdate,
    agreementFallbackHitDaysEval,
    agreementFallbackHitRate,
    agreementFallbackHitRateUpdate,
    agreementFallbackHitRateEval,
    agreementFallbackExecutedDays,
    agreementFallbackExecutedDaysUpdate,
    agreementFallbackExecutedDaysEval,
    agreementFallbackExecutedHitDays,
    agreementFallbackExecutedHitDaysUpdate,
    agreementFallbackExecutedHitDaysEval,
    agreementFallbackExecutedHitRate,
    agreementFallbackExecutedHitRateUpdate,
    agreementFallbackExecutedHitRateEval,
    executedDays,
    executedCount,
    executedHitCount,
    executedHitRate,
    executedTargetHitCount: executedHitCount,
    executedTargetHitRate: executedHitRate,
    executedStopCount,
    executedStopRate,
    executedTimeoutCount,
    executedTimeoutRate,
    executedTimeoutNegativeCount,
    executedTimeoutNegativeRate,
    executedHitRateLcb95,
    executedDaysUpdate,
    executedCountUpdate,
    executedHitCountUpdate,
    executedHitRateUpdate,
    executedTargetHitCountUpdate: executedHitCountUpdate,
    executedTargetHitRateUpdate: executedHitRateUpdate,
    executedStopCountUpdate,
    executedStopRateUpdate,
    executedTimeoutCountUpdate,
    executedTimeoutRateUpdate,
    executedTimeoutNegativeCountUpdate,
    executedTimeoutNegativeRateUpdate,
    executedHitRateUpdateLcb95,
    executedDaysEval,
    executedCountEval,
    executedHitCountEval,
    executedHitRateEval,
    executedTargetHitCountEval: executedHitCountEval,
    executedTargetHitRateEval: executedHitRateEval,
    executedStopCountEval,
    executedStopRateEval,
    executedTimeoutCountEval,
    executedTimeoutRateEval,
    executedTimeoutNegativeCountEval,
    executedTimeoutNegativeRateEval,
    executedHitRateEvalLcb95,
    executableHitRateEval: executedHitRateEval,
    executionCoverage,
    executionCoverageUpdate,
    executionCoverageEval,
    precisionAt1Executable,
    afterCostExpectancy,
    estRoundtripCost,
    calibratedSignals: {
      tradeCount: calibratedTradeCount,
      pHitAvg: calibratedTradeCount > 0 ? calibratedHitSum / calibratedTradeCount : 0,
      pStopFirstAvg: calibratedTradeCount > 0 ? calibratedStopSum / calibratedTradeCount : 0,
      pFillAvg: calibratedTradeCount > 0 ? calibratedFillSum / calibratedTradeCount : 0,
      confidenceAvg: calibratedTradeCount > 0 ? calibratedConfidenceSum / calibratedTradeCount : 0
    },
    precisionCoverageCurve,
    executionDecisionDays,
    executionShadowDays,
    executionShadowDaysUpdate,
    executionShadowDaysEval,
    executionShadowOnlyDays,
    executionShadowOnlyDaysUpdate,
    executionShadowOnlyDaysEval,
    executionBlockedDays,
    executionBlockedDaysUpdate,
    executionBlockedDaysEval,
    executionBlockedOnlyDays,
    executionBlockedOnlyDaysUpdate,
    executionBlockedOnlyDaysEval,
    executionMetaRejectedPickedDaysEval,
    executionBlockedPickedDaysEval: executionBlockedOnlyDaysEval,
    top1ToOracleConversion,
    top1ToOracleConversionUpdate,
    top1ToOracleConversionEval,
    budgetedConversion60,
    budgetedConversion80,
    budgetedConversion60Update,
    budgetedConversion80Update,
    budgetedConversion60Eval,
    budgetedConversion80Eval,
    hitAt1,
    hitAt3,
    hitAt5,
    hitAt1Update,
    hitAt3Update,
    hitAt5Update,
    hitAt1Eval,
    hitAt3Eval,
    hitAt5Eval,
    firstSuccessRankAvg,
    firstSuccessRankAvgUpdate,
    firstSuccessRankAvgEval,
    gateRejectedHitDays,
    gateRejectedHitDaysUpdate,
    gateRejectedHitDaysEval,
    executionRejectedHitDays,
    executionRejectedHitDaysUpdate,
    executionRejectedHitDaysEval,
    rankableDays,
    rankableDaysUpdate,
    rankableDaysEval,
    top1ToOracleGoalConversion:
      oracleMaxHitRateAtPickedGoalTopK > 0
        ? Math.min(1, Math.max(0, pickHitRate / oracleMaxHitRateAtPickedGoalTopK))
        : 0,
    top1ToOracleGoalConversion80:
      oracleMaxHitRateAtPickedGoalTopK80 > 0
        ? Math.min(1, Math.max(0, pickHitRate / oracleMaxHitRateAtPickedGoalTopK80))
        : 0,
    oracleCandidateDaysUpdate,
    oracleHitDaysUniverseUpdate,
    oracleHitDaysTopKUpdate,
    oracleMissedByTopKDaysUpdate,
    oracleMaxHitsAtPickedGoalTopK60Update,
    oracleMaxHitsAtPickedGoalTopK80Update,
    oracleHitRateUniverseUpdate:
      oracleCandidateDaysUpdate > 0 ? oracleHitDaysUniverseUpdate / oracleCandidateDaysUpdate : 0,
    oracleHitRateTopKUpdate,
    topKOracleGapUpdate,
    oracleCandidateDaysEval,
    oracleHitDaysUniverseEval,
    oracleHitDaysTopKEval,
    oracleMissedByTopKDaysEval,
    oracleMaxHitsAtPickedGoalTopK60Eval,
    oracleMaxHitsAtPickedGoalTopK80Eval,
    oracleHitRateUniverseEval:
      oracleCandidateDaysEval > 0 ? oracleHitDaysUniverseEval / oracleCandidateDaysEval : 0,
    oracleHitRateTopKEval,
    topKOracleGap,
    topKOracleGapEval,
    pickExpectedNetRet3dSum,
    pickExpectedNetRet3dAvg: pickedCount > 0 ? pickExpectedNetRet3dSum / pickedCount : 0,
    pickMaxWindowJumpPctAvg:
      pickMaxWindowJumpPctCount > 0 ? pickMaxWindowJumpPctSum / pickMaxWindowJumpPctCount : null,
    pickMaxWindowJumpPctMax:
      Number.isFinite(Number(pickMaxWindowJumpPctMax)) ? Number(pickMaxWindowJumpPctMax) : null,
    pickMaxWindowJumpPctAvgEval:
      pickMaxWindowJumpPctCountEval > 0 ? pickMaxWindowJumpPctSumEval / pickMaxWindowJumpPctCountEval : null,
    pickMaxWindowJumpPctMaxEval:
      Number.isFinite(Number(pickMaxWindowJumpPctMaxEval)) ? Number(pickMaxWindowJumpPctMaxEval) : null,
    executedMaxWindowJumpPctAvg:
      executedMaxWindowJumpPctCount > 0 ? executedMaxWindowJumpPctSum / executedMaxWindowJumpPctCount : null,
    executedMaxWindowJumpPctMax:
      Number.isFinite(Number(executedMaxWindowJumpPctMax)) ? Number(executedMaxWindowJumpPctMax) : null,
    executedMaxWindowJumpPctAvgEval:
      executedMaxWindowJumpPctCountEval > 0
        ? executedMaxWindowJumpPctSumEval / executedMaxWindowJumpPctCountEval
        : null,
    executedMaxWindowJumpPctMaxEval:
      Number.isFinite(Number(executedMaxWindowJumpPctMaxEval)) ? Number(executedMaxWindowJumpPctMaxEval) : null,
    firstPickCount,
    firstPickHitCount,
    firstPickHitRate: firstPickCount > 0 ? firstPickHitCount / firstPickCount : 0,
    firstPickExpectedNetRet3dSum,
    firstPickExpectedNetRet3dAvg:
      firstPickCount > 0 ? firstPickExpectedNetRet3dSum / firstPickCount : 0,
    secondPickCount,
    secondPickHitCount,
    secondPickHitRate: secondPickCount > 0 ? secondPickHitCount / secondPickCount : 0,
    secondPickExpectedNetRet3dSum,
    secondPickExpectedNetRet3dAvg:
      secondPickCount > 0 ? secondPickExpectedNetRet3dSum / secondPickCount : 0,
    secondMinusFirstExpectedNetRet3d:
      (secondPickCount > 0 ? secondPickExpectedNetRet3dSum / secondPickCount : 0) -
      (firstPickCount > 0 ? firstPickExpectedNetRet3dSum / firstPickCount : 0),
    onePickDayExpectedNetRet3dAvg:
      onePickDays > 0 ? onePickDayExpectedNetRet3dSum / onePickDays : 0,
    twoPickDayExpectedNetRet3dAvg:
      dualPickDays > 0 ? dualPickDayExpectedNetRet3dSum / dualPickDays : 0,
    twoPickVsOnePickExpectedDayDelta:
      (dualPickDays > 0 ? dualPickDayExpectedNetRet3dSum / dualPickDays : 0) -
      (onePickDays > 0 ? onePickDayExpectedNetRet3dSum / onePickDays : 0),
    onePickDays,
    dualPickDays,
    twoPickDays: dualPickDays,
    twoPickDaysEval,
    secondBeatFirstDays,
    secondPickGateMode: String(
      decisionGateCfg?.secondPick?.mode ??
        decisionGateCfg?.secondPick?.phase ??
        "disabled",
    ),
    secondPickEvaluatedDays,
    secondPickAcceptedDays,
    secondPassRate:
      secondPickEvaluatedDays > 0 ? secondPickAcceptedDays / secondPickEvaluatedDays : 0,
    secondRejectReasonCounts,
    secondShadowRejectReasonCounts,
    regimeBreakdown,
    regimeBreakdownEval,
    executedRegimeBreakdown,
    executedRegimeBreakdownEval,
    hitDays: dayHitDays,
    hitRate: pickedDays > 0 ? dayHitDays / pickedDays : 0,
    avgRegret,
    regretCount,
    avgRegretUpdate,
    regretCountUpdate,
    avgRegretEval,
    regretCountEval,
    rankLossDays,
    rankLossAvg: avgRankLoss,
    rankLossMax,
    rankLossDaysUpdate,
    rankLossAvgUpdate: avgRankLossUpdate,
    rankLossDaysEval,
    rankLossAvgEval: avgRankLossEval,
    noCandidateDays,
    noCandidateDaysUpdate,
    noCandidateDaysEval,
    lookaheadViolations,
    executionLookaheadViolations,
    feedbackQueuedCount,
    feedbackAppliedCount,
    feedbackAppliedDelayDays: feedbackAppliedDelayDaysSum,
    feedbackPendingCount: feedbackQueue.length,
    feedbackPendingCountMax,
    feedbackNoUpdateCount,
    feedbackNoUpdateReasonCounts,
    feedbackAppliedDelayDaysAvg,
    feedbackAppliedDelayDaysMax,
    executionFeedbackQueuedCount,
    executionFeedbackAppliedCount,
    executionFeedbackAppliedDelayDays: executionFeedbackAppliedDelayDaysSum,
    executionFeedbackPendingCount: executionFeedbackQueue.length,
    executionFeedbackPendingCountMax,
    executionFeedbackAppliedDelayDaysAvg,
    executionFeedbackAppliedDelayDaysMax,
    effectiveConfigDiff,
    effectiveConfigDiffCount: effectiveConfigDiff.length,
    unexpectedConfigDiff,
    unexpectedConfigDiffCount: unexpectedConfigDiff.length,
    effectiveRuntimeDiff,
    effectiveRuntimeDiffCount: effectiveRuntimeDiff.length,
    unexpectedRuntimeDiff,
    unexpectedRuntimeDiffCount: unexpectedRuntimeDiff.length,
    candidateIndexRowsAll: decisionCandidatesByDate.size,
    candidateIndexRowsOnline,
    candidateIndexRowsLockboxPrepared,
    candidateIndexSeedsAll,
    candidateIndexSeedsOnline,
    candidateIndexSeedsLockboxPrepared,
    featurePackRowsComputedAll: featurePackRowsComputed,
    featurePackRowsComputedOnline,
    featurePackRowsComputedLockbox,
    featurePackRowsPersistedAll: featurePackRowsPersisted,
    featurePackRowsPersistedOnline,
    featurePackRowsPersistedLockbox,
    featurePackWriteEnabled: shouldPersistAnyFeaturePackRows,
    skippedByGate,
    gateReasonCounts,
    gateReasonCountsUpdate,
    gateReasonCountsEval,
    dayTypeCounts,
    dayTypeCountsUpdate,
    dayTypeCountsEval,
    agreementDecisionCounts,
    agreementDecisionCountsUpdate,
    agreementDecisionCountsEval,
    agreementReasonCounts,
    agreementReasonCountsUpdate,
    agreementReasonCountsEval,
    dayTypeNoTradeCount,
    dayTypeNoTradeCountUpdate,
    dayTypeNoTradeCountEval,
    dayTypeNoTradeHitCount,
    dayTypeNoTradeHitCountUpdate,
    dayTypeNoTradeHitCountEval,
    executionDecisionCounts,
    executionDecisionCountsUpdate,
    executionDecisionCountsEval,
    executionShadowReasonCounts,
    executionShadowReasonCountsUpdate,
    executionShadowReasonCountsEval,
    falsePositiveDecisionCounts,
    falsePositiveDecisionCountsUpdate,
    falsePositiveDecisionCountsEval,
    falsePositiveReasonCounts,
    falsePositiveReasonCountsUpdate,
    falsePositiveReasonCountsEval,
    preFalsePositiveApprovedCount,
    preFalsePositiveApprovedCountUpdate,
    preFalsePositiveApprovedCountEval,
    falsePositiveRejectedCount,
    falsePositiveRejectedCountUpdate,
    falsePositiveRejectedCountEval,
    falsePositiveRejectedHitCount,
    falsePositiveRejectedHitCountUpdate,
    falsePositiveRejectedHitCountEval,
    falsePositiveRejectedMissCount,
    falsePositiveRejectedMissCountUpdate,
    falsePositiveRejectedMissCountEval,
    budgetDecisionCounts,
    budgetDecisionCountsUpdate,
    budgetDecisionCountsEval,
    budgetReasonCounts,
    budgetReasonCountsUpdate,
    budgetReasonCountsEval,
    budgetRejectedCount,
    budgetRejectedCountUpdate,
    budgetRejectedCountEval,
    budgetRejectedHitCount,
    budgetRejectedHitCountUpdate,
    budgetRejectedHitCountEval,
    budgetRejectedMissCount,
    budgetRejectedMissCountUpdate,
    budgetRejectedMissCountEval,
    postScoreAdjust: postScoreAdjustCfg,
    decisionGate: decisionGateCfg,
    policyContract: {
      version: "v5",
      mode: "D1_D2_FP_MODEL_DT_MODEL_BUDGET_AGREEMENT",
      rankerScoreField: "rankerScore",
      executionScoreField: "executionScore",
      falsePositiveRiskField: "falsePositiveRisk",
      falsePositiveModelRiskField: "falsePositiveModelRisk",
      budgetDecisionField: "budgetDecision",
      agreementScoreField: "agreementScore",
      tauRank:
        Number.isFinite(Number(d1ObservedTauRank))
          ? Number(d1ObservedTauRank)
          : (Number(decisionGateCfg?.minFinalScore ?? 0) || 0),
      tauExec: Number(executionGateCfg?.targetLcb ?? 0) || 0,
      tauFp: Number(falsePositiveGateCfg?.maxRisk ?? 1) || 1,
      minAgreementScore: Number(decisionGateCfg?.agreementGate?.minAgreementScore ?? 0) || 0,
      dayType: "BALANCED",
      budgetMode: opportunityBudgetCfg?.enabled === true ? "EXECUTION_BUDGET" : "DISABLED"
    },
    promotionView: {
      source: promotionSource,
      useEvalForPromotion: promotionScope === "eval",
      configuredPromotionScope,
      promotionScope,
      pickedCount: promotionPickedCount,
      pickHitCount: promotionPickHitCount,
      pickHitRate: promotionPickHitRate,
      targetHitCount: promotionPickHitCount,
      targetHitRate: promotionPickHitRate,
      targetHitsPer20Days: isEvalPromotion ? targetHitsPer20EvalDays : targetHitsPer20UpdateDays,
      pickHitRateLcb95: promotionPickHitRateLcb95,
      top1ToOracleConversion: promotionTop1ToOracleConversion,
      budgetedConversion60: promotionBudgetedConversion60,
      budgetedConversion80: promotionBudgetedConversion80,
      hitAt1: promotionHitAt1,
      hitAt3: promotionHitAt3,
      hitAt5: promotionHitAt5,
      executedCount: promotionExecutedCount,
      executedHitCount: promotionExecutedHitCount,
      executedHitRate: promotionExecutedHitRate,
      executedTargetHitCount: promotionExecutedHitCount,
      executedTargetHitRate: promotionExecutedHitRate,
      executedHitRateLcb95: promotionExecutedHitRateLcb95,
      executionCoverage: promotionExecutionCoverage,
      executionRejectedHitDays: promotionExecutionRejectedHitDays,
      firstSuccessRankAvg: promotionFirstSuccessRankAvg,
      gateRejectedHitDays: promotionGateRejectedHitDays,
      pickedCountAll: pickedCount,
      pickHitCountAll: pickHitCount,
      pickHitRateLcb95All: pickHitRateLcb95,
      pickedCountEval,
      pickHitCountEval,
      pickHitRateLcb95Eval: pickHitRateEvalLcb95,
      executedCountAll: executedCount,
      executedHitCountAll: executedHitCount,
      executedHitRateLcb95All: executedHitRateLcb95,
      executedCountEval,
      executedHitCountEval,
      executedHitRateLcb95Eval: executedHitRateEvalLcb95,
      budgetedConversion80All: budgetedConversion80,
      budgetedConversion80Eval,
      lookaheadViolations
    },
    promotionContext,
    dGate: {
      metricSource: "STEP_D_EVAL",
      metrics: {
        targetHitRateEval: pickHitRateEval,
        selectionHitAt1Eval: hitAt1Eval,
        selectionHitAt1AgreementFallbackAwareEval,
        executedTargetHitRateEval: executedHitRateEval,
        stopRateEval: pickStopRateEval,
        timeoutNegativeRateEval: pickTimeoutNegativeRateEval
      },
      diagnostics: {
        timeoutRateEval: pickTimeoutRateEval,
        executedTimeoutRateEval,
        executedTimeoutNegativeRateEval,
        executionCoverageEval
      },
      c0: c0SelectionSummary,
      c1: c1SelectionSummary,
      c2: c2SelectionSummary
    },
    c0Selection: c0SelectionSummary,
    c1Selection: c1SelectionSummary,
    c2Selection: c2SelectionSummary,
    scopeDiagnostics,
    d1TradeDaysAll: Number(scopeDiagnostics?.all?.d1TradeDays ?? 0) || 0,
    d1TradeDaysUpdate: Number(scopeDiagnostics?.update?.d1TradeDays ?? 0) || 0,
    d1TradeDaysEval: Number(scopeDiagnostics?.eval?.d1TradeDays ?? 0) || 0,
    d2BlockedAfterD1DaysAll: Number(scopeDiagnostics?.all?.d2BlockedAfterD1Days ?? 0) || 0,
    d2BlockedAfterD1DaysUpdate: Number(scopeDiagnostics?.update?.d2BlockedAfterD1Days ?? 0) || 0,
    d2BlockedAfterD1DaysEval: Number(scopeDiagnostics?.eval?.d2BlockedAfterD1Days ?? 0) || 0,
    lastExecutionBlockerEval:
      Array.isArray(evalScopeDiagnostic?.topExecutionBlockers) &&
      evalScopeDiagnostic.topExecutionBlockers.length > 0
        ? evalScopeDiagnostic.topExecutionBlockers[0]?.key ?? null
        : null,
    lastGateReasonEval:
      Array.isArray(evalScopeDiagnostic?.topGateReasons) &&
      evalScopeDiagnostic.topGateReasons.length > 0
        ? evalScopeDiagnostic.topGateReasons[0]?.key ?? null
        : null,
    sampleStarvation,
    oracleGoodButTop1Bad,
    scorerVersion,
    stageWeights: effectiveRuntimeHybrid.stageWeights,
    coarseTopNConfigured: runtimeHybrid.coarseTopN,
    coarseTopClustersConfigured: runtimeHybrid.coarseTopClusters,
    coarseTopN: effectiveRuntimeHybrid.coarseTopN,
    coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters,
    coarsePruneRatioAvg,
    coarsePruneHealth,
    coarseRuntimeBudget: {
      adaptiveEnabled: adaptiveCoarseBudgetEnabled,
      onlyWhenDegenerate: adaptiveCoarseBudgetOnlyWhenDegenerate,
      configuredDegenerate: coarseBudgetDegenerate,
      autoTightened: coarseBudgetAutoTightened,
      runtimePrototypeCount: runtimePrototypeTotal,
      runtimeClusterCount: runtimeClusterCountForScoring,
      configuredTopN: runtimeHybrid.coarseTopN,
      effectiveTopN: effectiveRuntimeHybrid.coarseTopN,
      prototypeShareTarget: adaptiveCoarsePrototypeShare,
      configuredTopNShare:
        runtimePrototypeTotal > 0 ? runtimeHybrid.coarseTopN / runtimePrototypeTotal : null,
      effectiveTopNShare:
        runtimePrototypeTotal > 0 ? effectiveRuntimeHybrid.coarseTopN / runtimePrototypeTotal : null
    },
    scoringTelemetry: {
      runtimePrototypeCount: runtimePrototypeTotal,
      runtimeClusterCount: runtimeClusterCountForScoring,
      online: {
        days: onlineScoringDays,
        candidates: onlineScoringCandidateCount,
        avgCandidatesPerDay:
          onlineScoringDays > 0 ? onlineScoringCandidateCount / onlineScoringDays : 0,
        scoreMs: onlineScoreMs,
        packMs: onlineScorePackMs,
        computeMs: onlineScoreComputeMs,
        batchCount: onlineScoreBatchCount
      },
      lockbox: {
        days: lockboxScoringDays,
        candidates: lockboxScoringCandidateCount,
        avgCandidatesPerDay:
          lockboxScoringDays > 0 ? lockboxScoringCandidateCount / lockboxScoringDays : 0,
        scoreMs: lockboxScoreMs,
        packMs: lockboxScorePackMs,
        computeMs: lockboxScoreComputeMs,
        batchCount: lockboxScoreBatchCount,
        skippedByCache:
          prepareLockboxDuringStepD === true && prepareLockboxDuringStepDEffective !== true
      }
    },
    exploration: {
      enabled: decisionGateCfg?.exploration?.enabled === true,
      epsilonBase: Number(decisionGateCfg?.exploration?.epsilon ?? 0),
      candidatePool: Number(decisionGateCfg?.exploration?.candidatePool ?? 3),
      minPickedCountForEnable: Number(decisionGateCfg?.exploration?.minPickedCountForEnable ?? 60),
      killSwitchEnv: String(decisionGateCfg?.exploration?.killSwitchEnv ?? "CD_LOOP_DISABLE_EXPLORATION"),
      decisionDays: explorationDecisionDays,
      appliedDays: explorationAppliedDays,
      exploreDays: explorationExploreDays,
      avgPropensity:
        explorationDecisionDays > 0 ? explorationPropensitySum / explorationDecisionDays : 0,
      avgEpsilon:
        explorationDecisionDays > 0 ? explorationEpsilonSum / explorationDecisionDays : 0
    },
    inversionAdjust: {
      enabled: decisionGateCfg?.inversionAdjust?.enabled === true,
      maxSwapMargin: Number(decisionGateCfg?.inversionAdjust?.maxSwapMargin ?? 0),
      secondBoost: Number(decisionGateCfg?.inversionAdjust?.secondBoost ?? 0),
      qualityWeight: Number(decisionGateCfg?.inversionAdjust?.qualityWeight ?? 0),
      swapAppliedDays: inversionSwapDays,
      swapAppliedRate: tradingDates.length > 0 ? inversionSwapDays / tradingDates.length : 0
    },
    top1Rerank: {
      enabled: decisionGateCfg?.top1Rerank?.enabled === true,
      objectiveMode: String(decisionGateCfg?.top1Rerank?.objectiveMode ?? "legacy_blended"),
      candidatePool: Number(decisionGateCfg?.top1Rerank?.candidatePool ?? 3),
      maxSwapMargin: Number(decisionGateCfg?.top1Rerank?.maxSwapMargin ?? 0),
      minUtilityGain: Number(decisionGateCfg?.top1Rerank?.minUtilityGain ?? 0),
      finalScoreWeight: Number(decisionGateCfg?.top1Rerank?.finalScoreWeight ?? 0),
      baseScoreWeight: Number(decisionGateCfg?.top1Rerank?.baseScoreWeight ?? 0),
      expectedRetWeight: Number(decisionGateCfg?.top1Rerank?.expectedRetWeight ?? 0),
      qualityWeight: Number(decisionGateCfg?.top1Rerank?.qualityWeight ?? 0),
      targetRateWeight: Number(decisionGateCfg?.top1Rerank?.targetRateWeight ?? 0),
      stopRatePenaltyWeight: Number(decisionGateCfg?.top1Rerank?.stopRatePenaltyWeight ?? 0),
      pHitWeight: Number(decisionGateCfg?.top1Rerank?.pHitWeight ?? 0),
      pStopFirstPenaltyWeight: Number(decisionGateCfg?.top1Rerank?.pStopFirstPenaltyWeight ?? 0),
      fillProbWeight: Number(decisionGateCfg?.top1Rerank?.fillProbWeight ?? 0),
      scoreMarginWeight: Number(decisionGateCfg?.top1Rerank?.scoreMarginWeight ?? 0),
      slippageRiskPenaltyWeight: Number(decisionGateCfg?.top1Rerank?.slippageRiskPenaltyWeight ?? 0),
      stageGlobalWeight: Number(decisionGateCfg?.top1Rerank?.stageGlobalWeight ?? 0),
      stageLocalWeight: Number(decisionGateCfg?.top1Rerank?.stageLocalWeight ?? 0),
      stageTriggerWeight: Number(decisionGateCfg?.top1Rerank?.stageTriggerWeight ?? 0),
      delta: {
        targetStopEdgeWeight: Number(decisionGateCfg?.top1Rerank?.delta?.targetStopEdgeWeight ?? 0),
        expectedRetWeight: Number(decisionGateCfg?.top1Rerank?.delta?.expectedRetWeight ?? 0),
        hitMinusStopWeight: Number(decisionGateCfg?.top1Rerank?.delta?.hitMinusStopWeight ?? 0),
        qualityWeight: Number(decisionGateCfg?.top1Rerank?.delta?.qualityWeight ?? 0),
        antiPenaltyWeight: Number(decisionGateCfg?.top1Rerank?.delta?.antiPenaltyWeight ?? 0)
      },
      appliedDays: top1RerankAppliedDays,
      appliedRate: tradingDates.length > 0 ? top1RerankAppliedDays / tradingDates.length : 0
    },
    agreementRerank: {
      enabled: decisionGateCfg?.agreementGate?.rerank?.enabled === true,
      candidatePool: Number(decisionGateCfg?.agreementGate?.rerank?.candidatePool ?? 0),
      maxSwapMargin: Number(decisionGateCfg?.agreementGate?.rerank?.maxSwapMargin ?? 0),
      minUtilityGain: Number(decisionGateCfg?.agreementGate?.rerank?.minUtilityGain ?? 0),
      appliedDays: agreementRerankAppliedDays,
      appliedRate: tradingDates.length > 0 ? agreementRerankAppliedDays / tradingDates.length : 0
    },
    coverageRecovery: {
      enabled: decisionGateCfg?.coverageRecovery?.enabled === true,
      targetPickedCount: Number(decisionGateCfg?.coverageRecovery?.targetPickedCount ?? 60),
      minScoreMarginRatio: Number(decisionGateCfg?.coverageRecovery?.minScoreMarginRatio ?? 0),
      minQualityScore: Number(decisionGateCfg?.coverageRecovery?.minQualityScore ?? 0),
      minExpectedNetRet3d: Number(decisionGateCfg?.coverageRecovery?.minExpectedNetRet3d ?? -1),
      maxRecoveryShare: Number(decisionGateCfg?.coverageRecovery?.maxRecoveryShare ?? 0),
      minObservedHitRate: Number(decisionGateCfg?.coverageRecovery?.minObservedHitRate ?? 0),
      minObservedSamples: Number(decisionGateCfg?.coverageRecovery?.minObservedSamples ?? 0),
      days: coverageRecoveryDays,
      hitDays: coverageRecoveryHitDays,
      hitRate: coverageRecoveryDays > 0 ? coverageRecoveryHitDays / coverageRecoveryDays : 0,
      share: pickedDays > 0 ? coverageRecoveryDays / pickedDays : 0
    },
    agreementFallbackSelection: {
      enabled: decisionGateCfg?.agreementGate?.fallback?.enabled === true,
      candidatePool: Number(decisionGateCfg?.agreementGate?.fallback?.candidatePool ?? 0),
      allowedReasons: Array.isArray(decisionGateCfg?.agreementGate?.fallback?.allowedReasons)
        ? decisionGateCfg.agreementGate.fallback.allowedReasons
        : [],
      days: agreementFallbackDays,
      daysUpdate: agreementFallbackDaysUpdate,
      daysEval: agreementFallbackDaysEval,
      hitDays: agreementFallbackHitDays,
      hitDaysUpdate: agreementFallbackHitDaysUpdate,
      hitDaysEval: agreementFallbackHitDaysEval,
      hitAt1OverlapDays: agreementFallbackHitAt1OverlapDays,
      hitAt1OverlapDaysUpdate: agreementFallbackHitAt1OverlapDaysUpdate,
      hitAt1OverlapDaysEval: agreementFallbackHitAt1OverlapDaysEval,
      hitRate: agreementFallbackHitRate,
      hitRateUpdate: agreementFallbackHitRateUpdate,
      hitRateEval: agreementFallbackHitRateEval,
      executedDays: agreementFallbackExecutedDays,
      executedDaysUpdate: agreementFallbackExecutedDaysUpdate,
      executedDaysEval: agreementFallbackExecutedDaysEval,
      executedHitDays: agreementFallbackExecutedHitDays,
      executedHitDaysUpdate: agreementFallbackExecutedHitDaysUpdate,
      executedHitDaysEval: agreementFallbackExecutedHitDaysEval,
      executedHitRate: agreementFallbackExecutedHitRate,
      executedHitRateUpdate: agreementFallbackExecutedHitRateUpdate,
      executedHitRateEval: agreementFallbackExecutedHitRateEval,
      selectionHitAt1AgreementFallbackAware,
      selectionHitAt1AgreementFallbackAwareUpdate,
      selectionHitAt1AgreementFallbackAwareEval,
      share: pickedDays > 0 ? agreementFallbackDays / pickedDays : 0,
      shareEval: pickedDaysEval > 0 ? agreementFallbackDaysEval / pickedDaysEval : 0
    },
    selectionFunnel: {
      counts: selectionFunnelCounts,
      countsUpdate: selectionFunnelCountsUpdate,
      countsEval: selectionFunnelCountsEval
    },
    executionGate: {
      enabled: executionGateCfg?.enabled === true,
      targetLcb: Number(executionGateCfg?.targetLcb ?? 0),
      minGlobalSamples: Number(executionGateCfg?.minGlobalSamples ?? 0),
      requireGlobalFloor: executionGateCfg?.requireGlobalFloor !== false,
      blockWhenGlobalUnknown: executionGateCfg?.blockWhenGlobalUnknown !== false,
      shadowWhenGlobalUnknown: executionGateCfg?.shadowWhenGlobalUnknown === true,
      requireRegimeApproval: executionGateCfg?.requireRegimeApproval !== false,
      minRegimeSamples: Number(executionGateCfg?.minRegimeSamples ?? 0),
      blockWhenRegimeUnknown: executionGateCfg?.blockWhenRegimeUnknown === true,
      shadowWhenRegimeUnknown: executionGateCfg?.shadowWhenRegimeUnknown !== false,
      enforceHardGlobalFloor: executionGateCfg?.enforceHardGlobalFloor !== false,
      feedbackDelayDays: Number(executionGateCfg?.feedbackDelayDays ?? 0),
      calibrationWindowDays: Number(executionGateCfg?.calibrationWindowDays ?? 0),
      uncertainty: executionGateCfg?.uncertainty ?? {},
      liquidity: executionGateCfg?.liquidity ?? {},
      globalCalibration: {
        count: executionCalibrationGlobalCount,
        hitCount: executionCalibrationGlobalHitCount,
        hitRate:
          executionCalibrationGlobalCount > 0
            ? executionCalibrationGlobalHitCount / executionCalibrationGlobalCount
            : 0,
        lcb95: wilsonLowerBound({
          success: executionCalibrationGlobalHitCount,
          total: executionCalibrationGlobalCount
        })
      },
      regimeCalibration: executionRegimeCalibration,
      approvedRegimes: executionApprovedRegimes.sort((a, b) => String(a).localeCompare(String(b))),
      decisionDays: executionDecisionDays,
      approvedDays: executedDays,
      approvedCount: executedCount,
      approvedHitCount: executedHitCount,
      approvedHitRate: executedHitRate,
      approvedHitRateLcb95: executedHitRateLcb95,
      approvedCountEval: executedCountEval,
      approvedHitCountEval: executedHitCountEval,
      approvedHitRateEval: executedHitRateEval,
      approvedHitRateEvalLcb95: executedHitRateEvalLcb95,
      targetSatisfied: executedHitRateLcb95 >= Number(executionGateCfg?.targetLcb ?? 0),
      targetSatisfiedEval: executedHitRateEvalLcb95 >= Number(executionGateCfg?.targetLcb ?? 0),
      coverage: executionCoverage,
      coverageEval: executionCoverageEval,
      shadowDays: executionShadowDays,
      shadowOnlyDays: executionShadowOnlyDays,
      blockedDays: executionBlockedDays,
      blockedOnlyDays: executionBlockedOnlyDays,
      shadowReasonCounts: executionShadowReasonCounts,
      rejectedHitDays: executionRejectedHitDays
    },
    falsePositiveGate: {
      enabled: falsePositiveGateCfg?.enabled === true,
      action: String(falsePositiveGateCfg?.action ?? "shadow"),
      maxRisk: Number(falsePositiveGateCfg?.maxRisk ?? 0),
      modelConfig: falsePositiveModelCfg,
      minGlobalSamples: Number(falsePositiveGateCfg?.minGlobalSamples ?? 0),
      minSegmentSamples: Number(falsePositiveGateCfg?.minSegmentSamples ?? 0),
      blockWhenUnknown: falsePositiveGateCfg?.blockWhenUnknown === true,
      shadowWhenUnknown: falsePositiveGateCfg?.shadowWhenUnknown === true,
      calibrationWindowDays: Number(falsePositiveGateCfg?.calibrationWindowDays ?? 0),
      history: falsePositiveGateCfg?.history ?? {},
      heuristics: falsePositiveGateCfg?.heuristics ?? {},
      preApprovedCount: preFalsePositiveApprovedCount,
      preApprovedCountUpdate: preFalsePositiveApprovedCountUpdate,
      preApprovedCountEval: preFalsePositiveApprovedCountEval,
      rejectedCount: falsePositiveRejectedCount,
      rejectedCountUpdate: falsePositiveRejectedCountUpdate,
      rejectedCountEval: falsePositiveRejectedCountEval,
      rejectedHitCount: falsePositiveRejectedHitCount,
      rejectedHitCountUpdate: falsePositiveRejectedHitCountUpdate,
      rejectedHitCountEval: falsePositiveRejectedHitCountEval,
      rejectedMissCount: falsePositiveRejectedMissCount,
      rejectedMissCountUpdate: falsePositiveRejectedMissCountUpdate,
      rejectedMissCountEval: falsePositiveRejectedMissCountEval,
      modelAvailableCount: falsePositiveModelAvailableCount,
      modelAvailableCountUpdate: falsePositiveModelAvailableCountUpdate,
      modelAvailableCountEval: falsePositiveModelAvailableCountEval,
      rejectionPrecision:
        falsePositiveRejectedCount > 0 ? falsePositiveRejectedMissCount / falsePositiveRejectedCount : 0,
      rejectionPrecisionUpdate:
        falsePositiveRejectedCountUpdate > 0
          ? falsePositiveRejectedMissCountUpdate / falsePositiveRejectedCountUpdate
          : 0,
      rejectionPrecisionEval:
        falsePositiveRejectedCountEval > 0
          ? falsePositiveRejectedMissCountEval / falsePositiveRejectedCountEval
          : 0,
      falseNegativeRate:
        falsePositiveRejectedCount > 0 ? falsePositiveRejectedHitCount / falsePositiveRejectedCount : 0,
      decisionCounts: falsePositiveDecisionCounts,
      decisionCountsUpdate: falsePositiveDecisionCountsUpdate,
      decisionCountsEval: falsePositiveDecisionCountsEval,
      reasonCounts: falsePositiveReasonCounts,
      reasonCountsUpdate: falsePositiveReasonCountsUpdate,
      reasonCountsEval: falsePositiveReasonCountsEval,
      state: {
        globalCount: falsePositiveGlobalCount,
        falsePositiveCount: falsePositiveFailureCount,
        falsePositiveRate:
          falsePositiveGlobalCount > 0 ? falsePositiveFailureCount / falsePositiveGlobalCount : 0,
        routeStats: falsePositiveRouteState,
        regimeStats: falsePositiveRegimeState,
        prototypeStats: falsePositivePrototypeState
      },
      model: falsePositiveModelFinal,
      dataset: falsePositiveDatasetMeta,
      adversarialReplayDataset: adversarialReplayDatasetMeta
    },
    dayTypeRouter: {
      enabled: dayTypeRouterCfg?.enabled === true,
      config: dayTypeRouterCfg,
      counts: dayTypeCounts,
      countsUpdate: dayTypeCountsUpdate,
      countsEval: dayTypeCountsEval,
      policySourceCounts: dayTypePolicySourceCounts,
      policySourceCountsUpdate: dayTypePolicySourceCountsUpdate,
      policySourceCountsEval: dayTypePolicySourceCountsEval,
      noTradeCount: dayTypeNoTradeCount,
      noTradeCountUpdate: dayTypeNoTradeCountUpdate,
      noTradeCountEval: dayTypeNoTradeCountEval,
      noTradeHitCount: dayTypeNoTradeHitCount,
      noTradeHitCountUpdate: dayTypeNoTradeHitCountUpdate,
      noTradeHitCountEval: dayTypeNoTradeHitCountEval,
      noTradeHitRate: dayTypeNoTradeCount > 0 ? dayTypeNoTradeHitCount / dayTypeNoTradeCount : 0,
      modelConfig: dayTypeModelCfg,
      modelOverrideCount: dayTypeModelOverrideCount,
      modelOverrideCountUpdate: dayTypeModelOverrideCountUpdate,
      modelOverrideCountEval: dayTypeModelOverrideCountEval,
      modelShadowCount: dayTypeModelShadowCount,
      modelShadowCountUpdate: dayTypeModelShadowCountUpdate,
      modelShadowCountEval: dayTypeModelShadowCountEval,
      modelShadowNoTradeCount: dayTypeModelShadowNoTradeCount,
      modelShadowNoTradeCountUpdate: dayTypeModelShadowNoTradeCountUpdate,
      modelShadowNoTradeCountEval: dayTypeModelShadowNoTradeCountEval,
      modelApplyModeCounts: dayTypeModelApplyModeCounts,
      modelApplyModeCountsUpdate: dayTypeModelApplyModeCountsUpdate,
      modelApplyModeCountsEval: dayTypeModelApplyModeCountsEval,
      modelShadowReasonCounts: dayTypeModelShadowReasonCounts,
      modelShadowReasonCountsUpdate: dayTypeModelShadowReasonCountsUpdate,
      modelShadowReasonCountsEval: dayTypeModelShadowReasonCountsEval,
      modelConfidenceBucketCounts: dayTypeModelConfidenceBucketCounts,
      modelConfidenceBucketCountsUpdate: dayTypeModelConfidenceBucketCountsUpdate,
      modelConfidenceBucketCountsEval: dayTypeModelConfidenceBucketCountsEval,
      modelAgreeCount: dayTypeModelAgreeCount,
      modelRejectedCount: dayTypeModelRejectedCount,
      model: dayTypeModelFinal,
      dataset: dayTypeDatasetMeta
    },
    falsePositiveModelConfig: falsePositiveModelCfg,
    falsePositiveModel: falsePositiveModelFinal,
    dayTypeModelConfig: dayTypeModelCfg,
    dayTypeModel: dayTypeModelFinal,
    d1GateDiagnostics: {
      config: {
        minFinalScore: Number(decisionGateCfg?.minFinalScore ?? 0) || 0,
        minScoreMargin: Number(decisionGateCfg?.minScoreMargin ?? 0) || 0,
        useMinScoreMarginGate: decisionGateCfg?.useMinScoreMarginGate !== false,
        useMaxScoreMarginGate: decisionGateCfg?.useMaxScoreMarginGate !== false,
        maxScoreMargin: num(decisionGateCfg?.maxScoreMargin),
        minExpectedNetRet3d: Number(decisionGateCfg?.minExpectedNetRet3d ?? -1) || 0,
        requirePositiveExpectedNetRet3d: decisionGateCfg?.requirePositiveExpectedNetRet3d === true,
        tauRank:
          Number.isFinite(Number(d1ObservedTauRank))
            ? Number(d1ObservedTauRank)
            : (Number(decisionGateCfg?.minFinalScore ?? 0) || 0)
      },
      diagnostics: summarizeD1GateDiagnostics({
        evaluatedDays: d1GateEvaluatedDays,
        failedDays: d1GateFailedDays,
        topNPassExistsDays: d1TopNPassExistsDays,
        top1FailedButAltPassExistsDays: d1Top1FailedButAltPassExistsDays,
        top1FailedAndNoAltPassExistsDays: d1Top1FailedAndNoAltPassExistsDays,
        altPassWouldHitDays: d1AltPassWouldHitDays,
        bestPassingRankSamples: d1BestPassingRankSamples,
        bestAltPassingRankSamples: d1BestAltPassingRankSamples,
        scoreBelowMinBucket: d1ScoreBelowMinStats,
        scoreMarginLowBucket: d1ScoreMarginLowStats
      }),
      diagnosticsUpdate: summarizeD1GateDiagnostics({
        evaluatedDays: d1GateEvaluatedDaysUpdate,
        failedDays: d1GateFailedDaysUpdate,
        topNPassExistsDays: d1TopNPassExistsDaysUpdate,
        top1FailedButAltPassExistsDays: d1Top1FailedButAltPassExistsDaysUpdate,
        top1FailedAndNoAltPassExistsDays: d1Top1FailedAndNoAltPassExistsDaysUpdate,
        altPassWouldHitDays: d1AltPassWouldHitDaysUpdate,
        bestPassingRankSamples: d1BestPassingRankSamplesUpdate,
        bestAltPassingRankSamples: d1BestAltPassingRankSamplesUpdate,
        scoreBelowMinBucket: d1ScoreBelowMinStatsUpdate,
        scoreMarginLowBucket: d1ScoreMarginLowStatsUpdate
      }),
      diagnosticsEval: summarizeD1GateDiagnostics({
        evaluatedDays: d1GateEvaluatedDaysEval,
        failedDays: d1GateFailedDaysEval,
        topNPassExistsDays: d1TopNPassExistsDaysEval,
        top1FailedButAltPassExistsDays: d1Top1FailedButAltPassExistsDaysEval,
        top1FailedAndNoAltPassExistsDays: d1Top1FailedAndNoAltPassExistsDaysEval,
        altPassWouldHitDays: d1AltPassWouldHitDaysEval,
        bestPassingRankSamples: d1BestPassingRankSamplesEval,
        bestAltPassingRankSamples: d1BestAltPassingRankSamplesEval,
        scoreBelowMinBucket: d1ScoreBelowMinStatsEval,
        scoreMarginLowBucket: d1ScoreMarginLowStatsEval
      })
    },
    scoreRecovery: {
      enabled: decisionGateCfg?.scoreRecovery?.enabled === true,
      config: {
        mode: String(decisionGateCfg?.scoreRecovery?.mode ?? "off").trim().toLowerCase(),
        allowedGateReasons: Array.isArray(decisionGateCfg?.scoreRecovery?.allowedGateReasons)
          ? decisionGateCfg.scoreRecovery.allowedGateReasons
          : [],
        maxFinalScoreShortfall: num(decisionGateCfg?.scoreRecovery?.maxFinalScoreShortfall),
        maxScoreMarginShortfall: num(decisionGateCfg?.scoreRecovery?.maxScoreMarginShortfall),
        minRawSimilarity: num(decisionGateCfg?.scoreRecovery?.minRawSimilarity),
        minLocalStageScore: num(decisionGateCfg?.scoreRecovery?.minLocalStageScore),
        minExpectedNetRet3d: num(decisionGateCfg?.scoreRecovery?.minExpectedNetRet3d),
        maxFalsePositiveRisk: num(decisionGateCfg?.scoreRecovery?.maxFalsePositiveRisk),
        minFillProb: num(decisionGateCfg?.scoreRecovery?.minFillProb)
      },
      diagnostics: summarizeScoreRecoveryDiagnostics(scoreRecoveryStats),
      diagnosticsUpdate: summarizeScoreRecoveryDiagnostics(scoreRecoveryStatsUpdate),
      diagnosticsEval: summarizeScoreRecoveryDiagnostics(scoreRecoveryStatsEval)
    },
    scoreRecalibration: {
      enabled: decisionGateCfg?.scoreRecalibration?.enabled === true,
      config: {
        mode: String(decisionGateCfg?.scoreRecalibration?.mode ?? "off").trim().toLowerCase(),
        allowedPrimaryComponents: Array.isArray(decisionGateCfg?.scoreRecalibration?.allowedPrimaryComponents)
          ? decisionGateCfg.scoreRecalibration.allowedPrimaryComponents
          : [],
        allowedPrimarySubcomponents: Array.isArray(
          decisionGateCfg?.scoreRecalibration?.allowedPrimarySubcomponents,
        )
          ? decisionGateCfg.scoreRecalibration.allowedPrimarySubcomponents
          : [],
        maxPenaltyCapByComponent:
          decisionGateCfg?.scoreRecalibration?.maxPenaltyCapByComponent &&
          typeof decisionGateCfg.scoreRecalibration.maxPenaltyCapByComponent === "object"
            ? decisionGateCfg.scoreRecalibration.maxPenaltyCapByComponent
            : {},
        maxPenaltyCapBySubcomponent:
          decisionGateCfg?.scoreRecalibration?.maxPenaltyCapBySubcomponent &&
          typeof decisionGateCfg.scoreRecalibration.maxPenaltyCapBySubcomponent === "object"
            ? decisionGateCfg.scoreRecalibration.maxPenaltyCapBySubcomponent
            : {},
        subcomponentPolicies:
          decisionGateCfg?.scoreRecalibration?.subcomponentPolicies &&
          typeof decisionGateCfg.scoreRecalibration.subcomponentPolicies === "object" &&
          !Array.isArray(decisionGateCfg.scoreRecalibration.subcomponentPolicies)
            ? decisionGateCfg.scoreRecalibration.subcomponentPolicies
            : {},
        eraSupportReasonPolicies:
          decisionGateCfg?.scoreRecalibration?.eraSupportReasonPolicies &&
          typeof decisionGateCfg.scoreRecalibration.eraSupportReasonPolicies === "object" &&
          !Array.isArray(decisionGateCfg.scoreRecalibration.eraSupportReasonPolicies)
            ? decisionGateCfg.scoreRecalibration.eraSupportReasonPolicies
            : {},
        baseScoreFloor: num(decisionGateCfg?.scoreRecalibration?.baseScoreFloor),
        minRawSimilarity: num(decisionGateCfg?.scoreRecalibration?.minRawSimilarity),
        minLocalStageScore: num(decisionGateCfg?.scoreRecalibration?.minLocalStageScore),
        minExpectedNetRet3d: num(decisionGateCfg?.scoreRecalibration?.minExpectedNetRet3d),
        minFillProb: num(decisionGateCfg?.scoreRecalibration?.minFillProb)
      },
      diagnostics: summarizeScoreRecalibrationDiagnostics(scoreRecalibrationStats),
      diagnosticsUpdate: summarizeScoreRecalibrationDiagnostics(scoreRecalibrationStatsUpdate),
      diagnosticsEval: summarizeScoreRecalibrationDiagnostics(scoreRecalibrationStatsEval)
    },
    agreementGate: {
      enabled: decisionGateCfg?.agreementGate?.enabled === true,
      config: decisionGateCfg?.agreementGate ?? {},
      modelConfig: agreementGateModelCfg,
      decisionCounts: agreementDecisionCounts,
      decisionCountsUpdate: agreementDecisionCountsUpdate,
      decisionCountsEval: agreementDecisionCountsEval,
      reasonCounts: agreementReasonCounts,
      reasonCountsUpdate: agreementReasonCountsUpdate,
      reasonCountsEval: agreementReasonCountsEval,
      diagnostics: summarizeAgreementGateDiagnostics({
        blockedDays: agreementBlockedDays,
        blockedTop1WouldHaveHitDays: agreementBlockedTop1WouldHaveHitDays,
        modelUnavailableDays: agreementModelUnavailableDays,
        consensusLowDays: agreementConsensusLowDays,
        stabilityLowDays: agreementStabilityLowDays,
        scoreLowDays: agreementScoreLowDays,
        agreementScoreSamples: agreementBlockedAgreementScoreSamples,
        rawSimilaritySamples: agreementBlockedRawSimilaritySamples,
        localStageSamples: agreementBlockedLocalStageSamples,
        triggerStageSamples: agreementBlockedTriggerStageSamples,
        gateScoreMarginSamples: agreementBlockedGateScoreMarginSamples,
        consensusRateSamples: agreementBlockedConsensusRateSamples,
        stabilityRateSamples: agreementBlockedStabilityRateSamples,
        blockedHitBucket: agreementBlockedHitStats,
        blockedMissBucket: agreementBlockedMissStats
      }),
      diagnosticsUpdate: summarizeAgreementGateDiagnostics({
        blockedDays: agreementBlockedDaysUpdate,
        blockedTop1WouldHaveHitDays: agreementBlockedTop1WouldHaveHitDaysUpdate,
        modelUnavailableDays: agreementModelUnavailableDaysUpdate,
        consensusLowDays: agreementConsensusLowDaysUpdate,
        stabilityLowDays: agreementStabilityLowDaysUpdate,
        scoreLowDays: agreementScoreLowDaysUpdate,
        agreementScoreSamples: agreementBlockedAgreementScoreSamplesUpdate,
        rawSimilaritySamples: agreementBlockedRawSimilaritySamplesUpdate,
        localStageSamples: agreementBlockedLocalStageSamplesUpdate,
        triggerStageSamples: agreementBlockedTriggerStageSamplesUpdate,
        gateScoreMarginSamples: agreementBlockedGateScoreMarginSamplesUpdate,
        consensusRateSamples: agreementBlockedConsensusRateSamplesUpdate,
        stabilityRateSamples: agreementBlockedStabilityRateSamplesUpdate,
        blockedHitBucket: agreementBlockedHitStatsUpdate,
        blockedMissBucket: agreementBlockedMissStatsUpdate
      }),
      diagnosticsEval: summarizeAgreementGateDiagnostics({
        blockedDays: agreementBlockedDaysEval,
        blockedTop1WouldHaveHitDays: agreementBlockedTop1WouldHaveHitDaysEval,
        modelUnavailableDays: agreementModelUnavailableDaysEval,
        consensusLowDays: agreementConsensusLowDaysEval,
        stabilityLowDays: agreementStabilityLowDaysEval,
        scoreLowDays: agreementScoreLowDaysEval,
        agreementScoreSamples: agreementBlockedAgreementScoreSamplesEval,
        rawSimilaritySamples: agreementBlockedRawSimilaritySamplesEval,
        localStageSamples: agreementBlockedLocalStageSamplesEval,
        triggerStageSamples: agreementBlockedTriggerStageSamplesEval,
        gateScoreMarginSamples: agreementBlockedGateScoreMarginSamplesEval,
        consensusRateSamples: agreementBlockedConsensusRateSamplesEval,
        stabilityRateSamples: agreementBlockedStabilityRateSamplesEval,
        blockedHitBucket: agreementBlockedHitStatsEval,
        blockedMissBucket: agreementBlockedMissStatsEval
      }),
      model: agreementGateModelFinal,
      dataset: agreementDatasetMeta
    },
    opportunityBudget: {
      enabled: opportunityBudgetCfg?.enabled === true,
      action: String(opportunityBudgetCfg?.action ?? "shadow"),
      config: opportunityBudgetCfg,
      decisionCounts: budgetDecisionCounts,
      decisionCountsUpdate: budgetDecisionCountsUpdate,
      decisionCountsEval: budgetDecisionCountsEval,
      reasonCounts: budgetReasonCounts,
      reasonCountsUpdate: budgetReasonCountsUpdate,
      reasonCountsEval: budgetReasonCountsEval,
      rejectedCount: budgetRejectedCount,
      rejectedCountUpdate: budgetRejectedCountUpdate,
      rejectedCountEval: budgetRejectedCountEval,
      rejectedHitCount: budgetRejectedHitCount,
      rejectedHitCountUpdate: budgetRejectedHitCountUpdate,
      rejectedHitCountEval: budgetRejectedHitCountEval,
      rejectedMissCount: budgetRejectedMissCount,
      rejectedMissCountUpdate: budgetRejectedMissCountUpdate,
      rejectedMissCountEval: budgetRejectedMissCountEval,
      rejectionPrecision:
        budgetRejectedCount > 0 ? budgetRejectedMissCount / budgetRejectedCount : 0,
      falseNegativeRate:
        budgetRejectedCount > 0 ? budgetRejectedHitCount / budgetRejectedCount : 0
    },
    metaSelector: {
      enabled: metaSelectorCfg?.enabled === true,
      allowNoTrade: metaSelectorCfg?.allowNoTrade !== false,
      executionDiagnosticMode: metaSelectorCfg?.executionDiagnosticMode === true,
      minCalibratedPHit: Number(metaSelectorCfg?.minCalibratedPHit ?? 0),
      maxPStopFirst: Number(metaSelectorCfg?.maxPStopFirst ?? 0),
      minFillProb: Number(metaSelectorCfg?.minFillProb ?? 0),
      minConfidence: Number(metaSelectorCfg?.minConfidence ?? 0),
      tradeThresholds: metaSelectorCfg?.tradeThresholds ?? {},
      shadowThresholds: metaSelectorCfg?.shadowThresholds ?? {},
      tradeUtilityFloor: Number(metaSelectorCfg?.tradeUtilityFloor ?? 0),
      shadowUtilityFloor: Number(metaSelectorCfg?.shadowUtilityFloor ?? 0),
      decisionCounts: metaDecisionCounts,
      diagnosticDecisionCounts: metaDiagnosticDecisionCounts,
      diagnosticReasonCounts: metaDiagnosticReasonCounts
    },
    calibration: {
      ...calibrationCfg,
      quality: {
        all: calibrationQualityAll,
        eval: calibrationQualityEval,
        update: calibrationQualityUpdate
      }
    },
    regimeExperts: regimeExpertsCfg,
    orderSimulator: orderSimulatorCfg,
    regimeRouter: {
      enabled: regimeRouterCfg?.enabled === true,
      routingMode: String(regimeRouterCfg?.routingMode ?? "vol3"),
      defaultBucket: String(regimeRouterCfg?.defaultBucket ?? "__DEFAULT__"),
      strictWeightLoad: regimeRouterCfg?.strictWeightLoad === true,
      weightBuckets: Object.keys(routeWeightSources).sort((a, b) => a.localeCompare(b)),
      weightSources: routeWeightSources,
      routeUsageCounts,
      routeMissingWeightCounts,
      routeBatchCounts,
      lockboxRouteUsageCounts,
      lockboxRouteMissingWeightCounts,
      lockboxRouteBatchCounts
    },
    initialWeightsSource: initialWeightResolved.source,
    finalWeights: weights
  }

  const updateOnlyCommonStateStatsPath = resolveUpdateOnlyCommonStateStatsPath(ctx)
  let updateOnlyCommonStateStatsWritten = false
  let updateOnlyCommonStateStatsError = null
  let updateOnlyPrototypeScoresCount = 0
  let updateOnlyRegimeWeightsCount = 0
  let updateOnlyRouteBucketBiasCount = 0
  if (updateOnlyCommonStateStatsPath) {
    try {
      const prototypeScores = {}
      for (const [prototypeId, row] of pickedPrototypeStatsUpdate.entries()) {
        const key = String(prototypeId ?? "").trim()
        if (!key || key === "__NONE__") continue
        const picked = Math.max(0, Number(row?.pickedCount ?? 0) || 0)
        if (picked < 1) continue
        const hit = Math.max(0, Number(row?.pickHitCount ?? 0) || 0)
        const hitRate = clamp01(picked > 0 ? hit / picked : 0)
        prototypeScores[key] = clampSigned((hitRate - 0.5) * 2)
      }
      const regimeWeights = {}
      for (const [regimeTag, row] of updateRegimeOutcomeStats.entries()) {
        const key = String(regimeTag ?? "").trim()
        if (!key) continue
        const total = Math.max(0, Number(row?.count ?? 0) || 0)
        if (total < 1) continue
        const hit = Math.max(0, Number(row?.hitCount ?? 0) || 0)
        const hitRate = clamp01(total > 0 ? hit / total : 0)
        regimeWeights[key] = clampSigned((hitRate - 0.5) * 2)
      }
      const routeBucketBias = {}
      for (const [routeBucket, value] of Object.entries(routeBiasState ?? {})) {
        const key = String(routeBucket ?? "").trim()
        if (!key) continue
        routeBucketBias[key] = clampSigned(value)
      }
      updateOnlyPrototypeScoresCount = Object.keys(prototypeScores).length
      updateOnlyRegimeWeightsCount = Object.keys(regimeWeights).length
      updateOnlyRouteBucketBiasCount = Object.keys(routeBucketBias).length
      const payload = {
        version: "v1",
        generatedAt: new Date().toISOString(),
        source: "step_d_update_only",
        runId: String(ctx?.runId ?? ""),
        split: "update",
        stats: {
          pickedCountUpdate,
          pickHitCountUpdate,
          pickHitRateUpdate,
          prototypeCount: updateOnlyPrototypeScoresCount,
          regimeCount: updateOnlyRegimeWeightsCount,
          routeBucketCount: updateOnlyRouteBucketBiasCount
        },
        prototypeScores,
        regimeWeights,
        routeBucketBias
      }
      await ensureDir(path.dirname(updateOnlyCommonStateStatsPath))
      await writeJson(updateOnlyCommonStateStatsPath, payload)
      updateOnlyCommonStateStatsWritten = true
    } catch (error) {
      updateOnlyCommonStateStatsError = String(error?.message ?? error)
    }
  }
  summary.commonStateUpdateOnlyStatsPath = updateOnlyCommonStateStatsPath
  summary.commonStateUpdateOnlyStatsWritten = updateOnlyCommonStateStatsWritten
  summary.commonStateUpdateOnlyPrototypeScores = updateOnlyPrototypeScoresCount
  summary.commonStateUpdateOnlyRegimeWeights = updateOnlyRegimeWeightsCount
  summary.commonStateUpdateOnlyRouteBucketBias = updateOnlyRouteBucketBiasCount
  if (updateOnlyCommonStateStatsError) {
    summary.commonStateUpdateOnlyStatsError = updateOnlyCommonStateStatsError
  }
  summary.persistOnlineAuditArtifacts = persistOnlineAuditArtifacts
  summary.persistLearningDatasets = persistLearningDatasets
  summary.logRowsCount = logs.length

  const needSortedLogs = writeDailyLogs || persistOnlineAuditArtifacts
  const logsSorted = needSortedLogs
    ? logs
      .slice()
      .sort((a, b) => String(a?.decisionDateKey ?? "").localeCompare(String(b?.decisionDateKey ?? "")))
    : []
  const d1RankedRows = persistOnlineAuditArtifacts
    ? logsSorted.map((row) => toD1RankedCandidatesRow(row))
    : []
  const d2ExecutionAuditRows = persistOnlineAuditArtifacts
    ? logsSorted.map((row) => toD2ExecutionAuditRow(row))
    : []
  await appendWritebackTrace("post_audit_row_materialization", {
    logRowsCount: logs.length,
    d1RankedRows: d1RankedRows.length,
    d2ExecutionAuditRows: d2ExecutionAuditRows.length,
  })
  const candidateIndexRows = writeDecisionCandidatesIndex
    ? Array.from(decisionCandidatesByDate.entries())
      .map(([decisionDateKey, seeds]) => ({
        decisionDateKey,
        seeds: Array.isArray(seeds) ? seeds : []
      }))
      .sort((a, b) => String(a.decisionDateKey).localeCompare(String(b.decisionDateKey)))
    : []

  if (writeDailyLogs) {
    await writeJsonl(logsPath, logsSorted)
  }
  if (persistOnlineAuditArtifacts) {
    await writeJsonl(d1RankedCandidatesPath, d1RankedRows)
    await writeJsonl(d2ExecutionAuditPath, d2ExecutionAuditRows)
    await appendWritebackTrace("post_eval_audit_write", {
      d1RankedCandidatesPath,
      d2ExecutionAuditPath,
    })
  }
  if (persistLearningDatasets) {
    await writeJsonl(falsePositiveDatasetPath, falsePositiveDatasetRows)
    await writeJson(falsePositiveDatasetMetaPath, falsePositiveDatasetMeta)
    await writeJsonl(adversarialReplayDatasetPath, adversarialReplayRows)
    await writeJson(adversarialReplayDatasetMetaPath, adversarialReplayDatasetMeta)
    await writeJsonl(agreementDatasetPath, agreementDatasetRows)
    await writeJson(agreementDatasetMetaPath, agreementDatasetMeta)
    await writeJsonl(dayTypeDatasetPath, dayTypeDatasetRows)
    await writeJson(dayTypeDatasetMetaPath, dayTypeDatasetMeta)
    await appendWritebackTrace("post_learning_dataset_write", {
      falsePositiveRows: falsePositiveDatasetRows.length,
      adversarialRows: adversarialReplayRows.length,
      agreementRows: agreementDatasetRows.length,
      dayTypeRows: dayTypeDatasetRows.length,
    })
  }
  if (sampledDebugEnabled) {
    const sampledSorted = sampledDebugLogs
      .slice()
      .sort((a, b) => String(a?.decisionDateKey ?? "").localeCompare(String(b?.decisionDateKey ?? "")))
    await writeJsonl(sampledDebugPath, sampledSorted)
    await appendWritebackTrace("post_sampled_debug_write", {
      sampledDebugRows: sampledSorted.length,
      sampledDebugPath,
    })
  }
  const candidateIndexMetaPayload = {
    generatedAt: new Date().toISOString(),
    sequenceWindow: minWindow,
    localWindow,
    globalWindow,
    minWindow,
    asOfShift,
    period: candidateIndexPeriod,
    rows: candidateIndexRows.length
  }
  if (writeDecisionCandidatesIndex) {
    await writeJsonl(candidateIndexPath, candidateIndexRows)
    await writeJson(candidateIndexMetaPath, candidateIndexMetaPayload)
    await appendWritebackTrace("post_candidate_index_write", {
      candidateIndexRows: candidateIndexRows.length,
      candidateIndexPath,
      candidateIndexMetaPath,
    })
  }
  let featurePackMetaPayload = null
  if (lockboxArtifactCacheHit) {
    featurePackMetaPayload = await readJson(cachedLockboxFeaturePackMetaPath, null)
    if (shouldPersistAnyFeaturePackRows) {
      await linkOrCopyFileWithDir(cachedLockboxFeaturePackPath, featurePackPath)
      await linkOrCopyFileWithDir(cachedLockboxFeaturePackMetaPath, featurePackMetaPath)
    }
    await appendWritebackTrace("post_feature_pack_cache_link", {
      featurePackPath: shouldPersistAnyFeaturePackRows ? featurePackPath : null,
      featurePackMetaPath: shouldPersistAnyFeaturePackRows ? featurePackMetaPath : null,
      persistedToRunDir: shouldPersistAnyFeaturePackRows === true,
    })
  } else if (shouldPersistAnyFeaturePackRows) {
    featurePackMetaPayload = {
      generatedAt: new Date().toISOString(),
      featureSurface: PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE,
      sequenceWindow: localWindow,
      localWindow,
      globalWindow,
      minWindow,
      asOfShift,
      period: candidateIndexPeriod,
      rowsPersisted: featurePackRowsPersisted,
      rowsComputed: featurePackRowsComputed,
      persistOnlineFeaturePackRows
    }
    await writeJson(featurePackMetaWriteTargetPath, featurePackMetaPayload)
    if (lockboxCacheWriteDirect) {
      await linkOrCopyFileWithDir(featurePackWriteTargetPath, featurePackPath)
      await linkOrCopyFileWithDir(featurePackMetaWriteTargetPath, featurePackMetaPath)
    } else if (
      lockboxCacheEligible &&
      !lockboxArtifactCacheHit &&
      featurePackRowsPersistedLockbox > 0 &&
      cachedLockboxFeaturePackPath &&
      cachedLockboxFeaturePackMetaPath
    ) {
      await linkOrCopyFileWithDir(featurePackPath, cachedLockboxFeaturePackPath)
      await linkOrCopyFileWithDir(featurePackMetaPath, cachedLockboxFeaturePackMetaPath)
    }
    await appendWritebackTrace("post_feature_pack_write", {
      featurePackRowsPersisted,
      featurePackRowsComputed,
      featurePackPath,
      featurePackMetaPath,
    })
  }
  const d1LockboxBaselineRows = []
  const d2LockboxBaselineRows = []
  let lockboxPickedCount = 0
  let lockboxPickedDays = 0
  let lockboxCoverageRecoveryDays = 0
  let lockboxCoverageRecoveryHitDays = 0
  const lockboxSelectionFunnelCounts = {}
  const lockboxDayTypeCounts = {}
  const lockboxDayTypePolicySourceCounts = {}
  let lockboxDayTypeNoTradeCount = 0
  let lockboxDayTypeNoTradeHitCount = 0
  let lockboxDayTypeModelOverrideCount = 0
  let lockboxDayTypeModelShadowCount = 0
  let lockboxDayTypeModelShadowNoTradeCount = 0
  let lockboxDayTypeModelAgreeCount = 0
  let lockboxDayTypeModelRejectedCount = 0
  const lockboxDayTypeModelApplyModeCounts = {}
  const lockboxDayTypeModelShadowReasonCounts = {}
  const lockboxDayTypeModelConfidenceBucketCounts = {}
  let runtimeLockboxFeaturePackLookupByDate = null
  if (prepareLockboxDuringStepD === true) {
    await appendWritebackTrace("pre_lockbox_prepare", {
      prepareLockboxDuringStepD,
    })
    const lockboxDatesForTrace = (Array.isArray(allDateKeys) ? allDateKeys : []).filter((dateKey) =>
      isInRange(dateKey, ctx.periods.lockbox),
    )
    const lockboxDateAllowSet = new Set(lockboxDatesForTrace.map((dateKey) => String(dateKey)))
    const featurePackReadableFromDisk =
      shouldPersistAnyFeaturePackRows &&
      pathExists(featurePackPath)
    const loadedLockboxFeaturePack = featurePackLookupByDate.size > 0
      ? {
          lookupByDate: featurePackLookupByDate,
          source: "memory"
        }
      : featurePackReadableFromDisk
        ? {
            ...(await readFeaturePackLookup(featurePackPath, {
              dateAllowSet: lockboxDateAllowSet,
              lookupOnly: true
            })),
            source: "disk"
          }
        : {
            lookupByDate: new Map(),
            source: shouldPersistAnyFeaturePackRows ? "missing_on_disk" : "disabled"
          }
    const lockboxFeaturePackLookupByDate = loadedLockboxFeaturePack?.lookupByDate instanceof Map
      ? loadedLockboxFeaturePack.lookupByDate
      : new Map()
    await appendWritebackTrace("post_lockbox_feature_pack_load", {
      lockboxDates: lockboxDatesForTrace.length,
      lockboxFeaturePackDates: lockboxFeaturePackLookupByDate.size,
      featurePackLookupSource: String(loadedLockboxFeaturePack?.source ?? "unknown"),
    })
    runtimeLockboxFeaturePackLookupByDate = lockboxFeaturePackLookupByDate
    const lockboxDateToIdx = new Map(lockboxDatesForTrace.map((dateKey, idx) => [String(dateKey), idx]))
    const singlePosition =
      positionSemantics === "SINGLE_POSITION_V1" &&
      ctx.config.backtest?.singlePosition !== false
    const holdDays = Math.max(1, Number(ctx.config.backtest?.holdDays ?? 3) || 3)
    const targetPct = Number(ctx.config.backtest?.targetPct ?? 0.08)
    const stopLossPctLockbox = Number(ctx.config.backtest?.stopLossPct ?? 0.04)
    const entryRule = resolveEntryRule(ctx.config.backtest?.entry)
    const lockboxExecutionCalibration = {
      globalCount: executionCalibrationGlobalCount,
      globalHitCount: executionCalibrationGlobalHitCount,
      regimeStats: executionCalibrationRegimeStats
    }
    const lockboxFalsePositiveState = {
      globalCount: falsePositiveGlobalCount,
      falsePositiveCount: falsePositiveFailureCount,
      routeStats: falsePositiveRouteStats,
      regimeStats: falsePositiveRegimeStats,
      prototypeStats: falsePositivePrototypeStats
    }
    const lockboxPolicyContractBase = {
      version: "v5",
      mode: "D1_D2_FP_MODEL_DT_MODEL_BUDGET_AGREEMENT",
      rankerScoreField: "rankerScore",
      executionScoreField: "executionScore",
      falsePositiveRiskField: "falsePositiveRisk",
      falsePositiveModelRiskField: "falsePositiveModelRisk",
      budgetDecisionField: "budgetDecision",
      agreementScoreField: "agreementScore",
      tauRank: Number(decisionGateCfg?.minFinalScore ?? 0) || 0,
      tauExec: Number(executionGateCfg?.targetLcb ?? 0) || 0,
      tauFp: Number(falsePositiveGateCfg?.maxRisk ?? 1) || 1,
      minAgreementScore: Number(decisionGateCfg?.agreementGate?.minAgreementScore ?? 0) || 0,
      dayType: "BALANCED",
      budgetMode: opportunityBudgetCfg?.enabled === true ? "EXECUTION_BUDGET" : "DISABLED"
    }
    const extendedBiasCfg = generalizationCfg?.extendedBias ?? {}
    const maxAbsBias = Number(extendedBiasCfg?.maxAbsBias ?? 0.08) || 0.08
    const lockboxScorerContextByRoute = new Map()
    const lockboxNegativeScorerContextByRoute = new Map()
    const resolveLockboxRouteScoringInputs = (routeBucket) => {
      const bucketKey = String(routeBucket ?? regimeRouterCfg.defaultBucket)
      const routeWeights = routeWeightsByBucket.get(bucketKey)
      const usingDefaultRouteWeights = !routeWeights
      if (usingDefaultRouteWeights && regimeRouterCfg.strictWeightLoad === true) {
        throw new Error(`Missing regime router weights for bucket: ${bucketKey}`)
      }
      return {
        routeBucket: bucketKey,
        usingDefaultRouteWeights,
        effectiveWeights: routeWeights ?? weights,
        effectiveActiveGroups: routeActiveGroupsByBucket.get(bucketKey) ?? sparseActiveGroups
      }
    }
    const getLockboxScorerContexts = (scoringInput) => {
      const routeKey = String(scoringInput?.routeBucket ?? regimeRouterCfg.defaultBucket)
      let routeScorerContext = lockboxScorerContextByRoute.get(routeKey) ?? null
      if (!routeScorerContext) {
        routeScorerContext = buildScorerContext({
          prototypes: library.prototypes,
          featureStats: library.featureStats,
          globalFeatureStats: library.globalFeatureStats,
          weights: scoringInput.effectiveWeights,
          activeGroups: scoringInput.effectiveActiveGroups,
          scoreOptions,
          stageWeights: effectiveRuntimeHybrid.stageWeights,
          coarseTopN: effectiveRuntimeHybrid.coarseTopN,
          coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters,
          clusterCenters: runtimeMeta?.clusterCenters ?? library?.globalClusters
        })
        lockboxScorerContextByRoute.set(routeKey, routeScorerContext)
      }
      let routeNegativeScorerContext = null
      if (similarityDisambiguationEnabled === true && negativePrototypesForScoring.length > 0) {
        routeNegativeScorerContext = lockboxNegativeScorerContextByRoute.get(routeKey) ?? null
        if (!routeNegativeScorerContext) {
          routeNegativeScorerContext = buildScorerContext({
            prototypes: negativePrototypesForScoring,
            featureStats: library.featureStats,
            globalFeatureStats: library.globalFeatureStats,
            weights: scoringInput.effectiveWeights,
            activeGroups: scoringInput.effectiveActiveGroups,
            scoreOptions,
            stageWeights: effectiveRuntimeHybrid.stageWeights,
            coarseTopN: effectiveRuntimeHybrid.coarseTopN,
            coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters,
            clusterCenters: null
          })
          lockboxNegativeScorerContextByRoute.set(routeKey, routeNegativeScorerContext)
        }
      }
      return {
        routeScorerContext,
        routeNegativeScorerContext
      }
    }
    let nextAvailableDecisionIdx = 0
    for (let decisionCursor = 0; decisionCursor < lockboxDatesForTrace.length; decisionCursor += 1) {
      const decisionDateKey = lockboxDatesForTrace[decisionCursor]
      if (
        writebackTraceEnabled &&
        (decisionCursor === 0 || decisionCursor === lockboxDatesForTrace.length - 1 || decisionCursor % 20 === 0)
      ) {
        await appendWritebackTrace("lockbox_loop_progress", {
          decisionCursor,
          decisionDateKey,
          nextAvailableDecisionIdx,
        })
      }
      if (singlePosition && decisionCursor < nextAvailableDecisionIdx) continue
      const seeds = decisionCandidatesByDate.get(decisionDateKey) ?? []
      const packedBySeed = lockboxFeaturePackLookupByDate.get(String(decisionDateKey)) ?? new Map()
      const topCandidates = []
      let candidateCountForTrace = 0
      let similarityGatePassedForTrace = 0
      let similarityGateRejectedForTrace = 0
      const similarityGateRejectReasonCountsForTrace = {}
      let lockboxRows = []
      let perfectPrototypeGateLockboxTelemetry = {
        evaluatedRows: 0,
        matchedRows: 0,
        filteredRows: 0,
        dedupedRows: 0
      }
      for (const seed of seeds) {
        const symbol = String(seed?.symbol ?? "").trim()
        if (!symbol) continue
        const series = seriesMap.get(symbol)
        if (!Array.isArray(series) || series.length < 1) continue
        const decisionIdx = Number(seed?.decisionIdx)
        const asOfIdx = Number(seed?.asOfIdx)
        const targetIdx = Number(seed?.targetIdx)
        if (!Number.isInteger(decisionIdx) || !Number.isInteger(asOfIdx) || !Number.isInteger(targetIdx)) continue
        const seedKey = makeDecisionSeedKey({
          symbol,
          decisionIdx,
          asOfIdx,
          targetIdx
        })
        const packed = packedBySeed.get(seedKey)
        if (!packed) continue
        const regime = resolveRegimeTagShared({
          featureVec: packed?.featureVec,
          globalFeatureVec: packed?.globalFeatureVec
        })
        const routeBucket = resolveRouteBucketShared({
          regimeTag: regime.tag,
          cfg: regimeRouterCfg
        })
        lockboxRows.push({
          symbol,
          series,
          decisionIdx,
          asOfIdx,
          targetIdx,
          packed,
          regime,
          routeBucket
        })
      }
      if (writebackTraceEnabled && decisionCursor === 0) {
        await appendWritebackTrace("lockbox_first_day_rows_built", {
          decisionDateKey,
          seedCount: seeds.length,
          lockboxRows: lockboxRows.length,
        })
      }
      if (lockboxRows.length > 0) {
        const gatedLockbox = applyPerfectPrototypeGateToRows({
          rows: lockboxRows,
          catalog: perfectPrototypeCatalog,
          gateCfg: perfectPrototypeGateCfg,
          partition: "lockbox"
        })
        lockboxRows = gatedLockbox.rows
        perfectPrototypeGateLockboxTelemetry = {
          evaluatedRows: Number(gatedLockbox.telemetry?.evaluatedRows ?? 0),
          matchedRows: Number(gatedLockbox.telemetry?.matchedRows ?? 0),
          filteredRows: Number(gatedLockbox.telemetry?.filteredRows ?? 0),
          dedupedRows: Number(gatedLockbox.telemetry?.dedupedRows ?? 0)
        }
        perfectPrototypeGateStats.lockbox.days += Number(gatedLockbox.telemetry?.days ?? 0)
        perfectPrototypeGateStats.lockbox.evaluatedRows += Number(
          gatedLockbox.telemetry?.evaluatedRows ?? 0,
        )
        perfectPrototypeGateStats.lockbox.matchedRows += Number(
          gatedLockbox.telemetry?.matchedRows ?? 0,
        )
        perfectPrototypeGateStats.lockbox.filteredRows += Number(
          gatedLockbox.telemetry?.filteredRows ?? 0,
        )
        perfectPrototypeGateStats.lockbox.dedupedRows += Number(
          gatedLockbox.telemetry?.dedupedRows ?? 0,
        )
      }
      if (lockboxRows.length > 0) {
        lockboxScoringDays += 1
        lockboxScoringCandidateCount += lockboxRows.length
      }
      const scoredRows = new Array(lockboxRows.length).fill(null)
      if (lockboxRows.length > 0) {
        const indexByBucket = new Map()
        if (regimeRouterCfg.enabled === true) {
          for (let i = 0; i < lockboxRows.length; i += 1) {
            const bucket = String(lockboxRows[i]?.routeBucket ?? regimeRouterCfg.defaultBucket)
            const bucketRows = indexByBucket.get(bucket) ?? []
            bucketRows.push(i)
            indexByBucket.set(bucket, bucketRows)
          }
        } else {
          indexByBucket.set(
            String(regimeRouterCfg.defaultBucket),
            Array.from({ length: lockboxRows.length }, (_unused, idx) => idx),
          )
        }
        if (workerPoolEnabled && workerPool) {
          for (const [bucket, idxList] of indexByBucket.entries()) {
            const scoringInput = resolveLockboxRouteScoringInputs(bucket)
            lockboxRouteUsageCounts[scoringInput.routeBucket] =
              Number(lockboxRouteUsageCounts[scoringInput.routeBucket] ?? 0) + idxList.length
            lockboxRouteBatchCounts[scoringInput.routeBucket] =
              Number(lockboxRouteBatchCounts[scoringInput.routeBucket] ?? 0) + 1
            if (scoringInput.usingDefaultRouteWeights && regimeRouterCfg.enabled === true) {
              lockboxRouteMissingWeightCounts[scoringInput.routeBucket] =
                Number(lockboxRouteMissingWeightCounts[scoringInput.routeBucket] ?? 0) + idxList.length
            }
            const batch = await workerPool.scoreBatch({
              candidates: idxList.map((idx) => {
                const packed = lockboxRows[idx]?.packed ?? {}
                return {
                  featureVec: packed?.featureVec,
                  globalFeatureVec: packed?.globalFeatureVec,
                  seq40: packed?.seq40,
                  seq150: packed?.seq150
                }
              }),
              weights: scoringInput.effectiveWeights,
              activeGroups: scoringInput.effectiveActiveGroups,
              scoreOptions,
              similarityDisambiguation: similarityDisambiguationCfg
            })
            const batchElapsedMs = Math.max(0, Number(batch?.elapsedMs ?? 0) || 0)
            const batchPackMs = Math.max(0, Number(batch?.packMs ?? 0) || 0)
            const batchComputeMs = Math.max(0, Number(batch?.computeMs ?? 0) || 0)
            const batchCount = Math.max(0, Number(batch?.batchCount ?? 0) || 0)
            workerPoolScoreMs += batchElapsedMs
            workerPoolPackMs += batchPackMs
            workerPoolComputeMs += batchComputeMs
            workerPoolBatchCount += batchCount
            lockboxScoreMs += batchElapsedMs
            lockboxScorePackMs += batchPackMs
            lockboxScoreComputeMs += batchComputeMs
            lockboxScoreBatchCount += batchCount
            mergePerfCounters(perfCounters, batch?.perf ?? {})
            const rowsForBucket = Array.isArray(batch?.rows) ? batch.rows : []
            for (let j = 0; j < idxList.length; j += 1) {
              scoredRows[idxList[j]] = rowsForBucket[j] ?? null
            }
          }
        } else {
          for (const [bucket, idxList] of indexByBucket.entries()) {
            const scoringInput = resolveLockboxRouteScoringInputs(bucket)
            lockboxRouteUsageCounts[scoringInput.routeBucket] =
              Number(lockboxRouteUsageCounts[scoringInput.routeBucket] ?? 0) + idxList.length
            lockboxRouteBatchCounts[scoringInput.routeBucket] =
              Number(lockboxRouteBatchCounts[scoringInput.routeBucket] ?? 0) + 1
            if (scoringInput.usingDefaultRouteWeights && regimeRouterCfg.enabled === true) {
              lockboxRouteMissingWeightCounts[scoringInput.routeBucket] =
                Number(lockboxRouteMissingWeightCounts[scoringInput.routeBucket] ?? 0) + idxList.length
            }
            const { routeScorerContext, routeNegativeScorerContext } =
              getLockboxScorerContexts(scoringInput)
            const batchStarted = Date.now()
            for (const rowIdx of idxList) {
              const row = lockboxRows[rowIdx]
              const packed = row?.packed ?? {}
              const candidate = {
                featureVec: packed?.featureVec,
                globalFeatureVec: packed?.globalFeatureVec,
                seq40: packed?.seq40,
                seq150: packed?.seq150
              }
              const scored =
                similarityDisambiguationEnabled === true
                  ? scoreCandidateExactV3({
                      candidate,
                      prototypes: library.prototypes,
                      negativePrototypes: negativePrototypesForScoring,
                      featureStats: library.featureStats,
                      globalFeatureStats: library.globalFeatureStats,
                      weights: scoringInput.effectiveWeights,
                      activeGroups: scoringInput.effectiveActiveGroups,
                      scoreOptions,
                      scorerContext: routeScorerContext,
                      negativeScorerContext: routeNegativeScorerContext,
                      stageWeights: effectiveRuntimeHybrid.stageWeights,
                      coarseTopN: effectiveRuntimeHybrid.coarseTopN,
                      coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters,
                      clusterCenters: runtimeMeta?.clusterCenters ?? library?.globalClusters,
                      negativeBuckets: similarityDisambiguationCfg?.negativeBuckets
                    })
                  : scoreCandidateExactV2({
                      candidate,
                      prototypes: library.prototypes,
                      featureStats: library.featureStats,
                      globalFeatureStats: library.globalFeatureStats,
                      weights: scoringInput.effectiveWeights,
                      activeGroups: scoringInput.effectiveActiveGroups,
                      scoreOptions,
                      scorerContext: routeScorerContext,
                      stageWeights: effectiveRuntimeHybrid.stageWeights,
                      coarseTopN: effectiveRuntimeHybrid.coarseTopN,
                      coarseTopClusters: effectiveRuntimeHybrid.coarseTopClusters,
                      clusterCenters: runtimeMeta?.clusterCenters ?? library?.globalClusters
                    })
              mergePerfCounters(perfCounters, {
                totalCandidatesScored: 1,
                totalPrototypes: Number(scored?.perf?.prototypesTotal ?? 0),
                totalPrototypesAfterCoarse: Number(scored?.perf?.prototypesAfterCoarse ?? 0),
                coarsePruneRatio: Number(scored?.perf?.coarsePruneRatio ?? 0),
                totalPrototypeComparisons: Number(scored?.perf?.prototypesScored ?? 0),
                prototypesPrunedByGroupBound: Number(scored?.perf?.prototypesPrunedByGroupBound ?? 0),
                prototypesPrunedByFeatureBound: Number(scored?.perf?.prototypesPrunedByFeatureBound ?? 0),
                totalClusters: Number(scored?.perf?.clustersTotal ?? 0),
                totalClustersConsidered: Number(scored?.perf?.clustersConsidered ?? 0)
              })
              scoredRows[rowIdx] = scored
            }
            const batchElapsedMs = Math.max(0, Date.now() - batchStarted)
            lockboxScoreMs += batchElapsedMs
            lockboxScoreComputeMs += batchElapsedMs
            lockboxScoreBatchCount += 1
          }
        }
      }
      if (writebackTraceEnabled && decisionCursor === 0) {
        await appendWritebackTrace("lockbox_first_day_scored", {
          decisionDateKey,
          scoredRows: scoredRows.filter(Boolean).length,
          candidateCountForTrace,
        })
      }
      for (let rowIdx = 0; rowIdx < lockboxRows.length; rowIdx += 1) {
        const row = lockboxRows[rowIdx]
        const scored = scoredRows[rowIdx]
        if (!scored) continue
        candidateCountForTrace += 1
        const similarityGateResult = evaluateSimilarityGate({
          scored,
          cfg: decisionGateCfg?.similarityGate,
          disambiguationCfg: similarityDisambiguationCfg
        })
        bumpSimilarityGateStats({
          stats: lockboxSimilarityGateStats,
          gateResult: similarityGateResult,
          dayRejectReasonCounts: similarityGateRejectReasonCountsForTrace
        })
        if (similarityGateResult.passed === true) {
          similarityGatePassedForTrace += 1
        } else {
          similarityGateRejectedForTrace += 1
          continue
        }
        const symbol = String(row?.symbol ?? "").trim()
        const packed = row?.packed ?? {}
        const candidateFeatureVec = packed?.featureVec ?? {}
        const series = Array.isArray(row?.series) ? row.series : []
        const decisionIdx = Number(row?.decisionIdx)
        const asOfIdx = Number(row?.asOfIdx)
        const targetIdx = Number(row?.targetIdx)
        const regime = row?.regime ?? { tag: "VOL_UNKNOWN_LIQ_UNKNOWN", volatilityProxy: null, liquidityProxy: null }
        const routeBucket = row?.routeBucket
        const adjusted = applyPostScoreAdjust({
          baseScore: scored.total,
          matchedPrototypeId: scored.prototypeId,
          qualityLookup: prototypeQualityLookup,
          featureVec: candidateFeatureVec,
          cfg: postScoreAdjustCfg
        })
        const regimeExpert = evaluateRegimeExpert({
          regimeTag: regime.tag,
          cfg: regimeExpertsCfg
        })
        const expertAdjustedScore = adjusted.finalScore * Number(regimeExpert?.scoreMultiplier ?? 1)
        const routeBiasValue =
          extendedBiasCfg?.enabled === true
            ? resolveBiasValue({
                map: routeBiasState,
                key: routeBucket,
                maxAbs: maxAbsBias
              })
            : 0
        const regimeBiasValue =
          extendedBiasCfg?.enabled === true
            ? resolveBiasValue({
                map: regimeBiasState,
                key: regime.tag,
                maxAbs: maxAbsBias
              })
            : 0
          const prototypeBiasValue =
            extendedBiasCfg?.enabled === true
              ? resolveBiasValue({
                map: prototypeBiasState,
                key: scored?.prototypeClusterId ?? scored?.prototypeId ?? "",
                maxAbs: maxAbsBias
              })
            : 0
        const tradeQualityPriorCfg = generalizationCfg?.tradeQualityPrior ?? {}
        const globalTradeQuality = resolveTradeQualityPriorSignal({
          state: globalTradeQualityState,
          key: "__GLOBAL__",
          cfg: tradeQualityPriorCfg
        })
        const routeTradeQuality = resolveTradeQualityPriorSignal({
          state: routeTradeQualityState,
          key: routeBucket,
          cfg: tradeQualityPriorCfg
        })
        const regimeTradeQuality = resolveTradeQualityPriorSignal({
          state: regimeTradeQualityState,
          key: regime.tag,
          cfg: tradeQualityPriorCfg
        })
        const prototypeTradeQuality = resolveTradeQualityPriorSignal({
          state: prototypeTradeQualityState,
          key: scored?.prototypeClusterId ?? scored?.prototypeId ?? "",
          cfg: tradeQualityPriorCfg
        })
        const tradeQualityFeatureAdjustment = resolveTradeQualityFeatureAdjustment({
          featureVec: candidateFeatureVec,
          cfg: tradeQualityPriorCfg
        })
        const extendedBiasAdjustment =
          extendedBiasCfg?.enabled === true
            ? clampRange(
                Number(extendedBiasCfg?.routeBucketBiasWeight ?? 0) * routeBiasValue +
                  Number(extendedBiasCfg?.regimeBiasWeight ?? 0) * regimeBiasValue +
                  Number(extendedBiasCfg?.prototypeBiasWeight ?? 0) * prototypeBiasValue,
                -maxAbsBias,
                maxAbsBias
              )
            : 0
            const tradeQualityPriorAdjustment =
              tradeQualityPriorCfg?.enabled === true
                ? resolveTradeQualityPriorAdjustment({
                    cfg: tradeQualityPriorCfg,
                    globalSignal: globalTradeQuality,
                    routeSignal: routeTradeQuality,
                    regimeSignal: regimeTradeQuality,
                    prototypeSignal: prototypeTradeQuality,
                    candidateFeatureAdjustment: tradeQualityFeatureAdjustment.adjustment
                  })
                : null
          const tradeQualityRankerAdjustment =
            tradeQualityPriorCfg?.applyToRanker === true
              ? Number(tradeQualityPriorAdjustment?.adjustment ?? 0)
              : 0
          const finalScoreBeforeExecutionPrior =
            expertAdjustedScore +
            extendedBiasAdjustment +
            tradeQualityRankerAdjustment
        const dataFreshnessDays = Math.max(0, decisionIdx - asOfIdx)
        const spreadProxy = Math.max(0, Number(candidateFeatureVec?.["candle.rangePct"] ?? 0))
        const avgTradingValue20dKrw = Math.max(
          0,
          Number(candidateFeatureVec?.["volume.avgTradingValue20dKrw"] ?? 0),
        )
        const volatilityProxy = Math.max(
          0,
          Number(regime?.volatilityProxy ?? packed?.globalFeatureVec?.["global.volatility40"] ?? 0),
        )
        const slippageRisk = Math.max(0, spreadProxy * 0.65 + volatilityProxy * 0.35)
        const orderProfile = estimateOrderExecutionProfile({
          row: {
            spreadProxyPct: spreadProxy,
            regimeVolatilityProxy: regime.volatilityProxy,
            regimeLiquidityProxy: regime.liquidityProxy,
            expectedNetRet3d: adjusted.expectedNetRet3d
          },
          cfg: orderSimulatorCfg
        })
        const jumpMeta = calcJumpWindowMeta({
          series,
          targetIdx,
          highJumpMode,
          eventThreshold,
          windowDays: hitWindowDays,
          useStopLoss,
          stopLossPct,
          sameDayTiePolicy
        })
        const slippageRiskWithOrder = Math.max(
          slippageRisk,
          (Number(orderProfile?.slippageBps ?? 0) || 0) / 100,
        )
        const executionPriorAdjusted = applyExecutionPriorAdjust({
          score: finalScoreBeforeExecutionPrior,
          slippageRisk: slippageRiskWithOrder,
          avgTradingValue20dKrw,
          orderProfile,
          executionFeasibilityScore: adjusted.executionFeasibilityScore,
          cfg: postScoreAdjustCfg
        })
        const finalScoreWithBias = executionPriorAdjusted.finalScore
        const similarityDiagnostics = buildSimilarityDiagnostics({
          similarityGateResult,
          scored
        })
        pushTopK(topCandidates, {
          symbol,
          name: String(packed?.name ?? symbol),
          asOfDateKey: String(packed?.asOfDateKey ?? ""),
          decisionIdx,
          series,
          score: finalScoreWithBias,
          baseScore: adjusted.baseScore,
          finalScore: finalScoreWithBias,
          finalScorePreBias: expertAdjustedScore,
          finalScorePreExecutionPrior: finalScoreBeforeExecutionPrior,
          failedBreakoutCount20: adjusted.failedBreakoutCount20,
          gapFillThenContinueScore: adjusted.gapFillThenContinueScore,
          gapFillThenRevertScore: adjusted.gapFillThenRevertScore,
          executionFeasibilityScore: adjusted.executionFeasibilityScore,
          ...similarityDiagnostics,
          similarityGateRejectReasons: [],
          extendedBiasAdjustment,
          routeBiasValue,
          regimeBiasValue,
          prototypeBiasValue,
          tradeQualityPriorAdjustment: Number(tradeQualityPriorAdjustment?.adjustment ?? 0),
          tradeQualityRankerAdjustment,
          tradeQualityRankerApplied: tradeQualityPriorCfg?.applyToRanker === true,
          tradeQualityFeatureAdjustment: Number(tradeQualityPriorAdjustment?.featureAdjustment ?? 0),
          tradeQualityGlobalScore: Number(globalTradeQuality?.score ?? 0),
          tradeQualityRouteResidual: Number(tradeQualityPriorAdjustment?.routeResidual ?? 0),
          tradeQualityRegimeResidual: Number(tradeQualityPriorAdjustment?.regimeResidual ?? 0),
          tradeQualityPrototypeResidual: Number(tradeQualityPriorAdjustment?.prototypeResidual ?? 0),
          tradeQualityRouteScore: routeTradeQuality.score,
          tradeQualityRegimeScore: regimeTradeQuality.score,
          tradeQualityPrototypeScore: prototypeTradeQuality.score,
          tradeQualityRouteCount: routeTradeQuality.count,
          tradeQualityRegimeCount: regimeTradeQuality.count,
          tradeQualityPrototypeCount: prototypeTradeQuality.count,
          executionPriorLowFillPenalty: executionPriorAdjusted.lowFillPenalty,
          executionPriorLowFillPenaltyRaw: executionPriorAdjusted.lowFillPenaltyRaw,
          executionPriorLowFillPenaltyRelief: executionPriorAdjusted.lowFillPenaltyRelief,
          executionPriorSlippagePenalty: executionPriorAdjusted.slippagePenalty,
          executionPriorSlippagePenaltyRaw: executionPriorAdjusted.slippagePenaltyRaw,
          executionPriorSlippagePenaltyRelief: executionPriorAdjusted.slippagePenaltyRelief,
          executionPriorLowLiquidityPenalty: executionPriorAdjusted.lowLiquidityPenalty,
          executionPriorLowLiquidityPenaltyRaw: executionPriorAdjusted.lowLiquidityPenaltyRaw,
          executionPriorLowLiquidityPenaltyRelief: executionPriorAdjusted.lowLiquidityPenaltyRelief,
          executionPriorBlockedOrderPenalty: executionPriorAdjusted.blockedOrderPenalty,
          executionPriorPositiveAfterCostBonus: executionPriorAdjusted.positiveAfterCostBonus,
          executionPriorNegativeAfterCostPenalty: executionPriorAdjusted.negativeAfterCostPenalty,
          prototypeFamilyKey: String(scored?.prototypeClusterId ?? scored?.prototypeId ?? ""),
          qualityBonus: adjusted.qualityBonus,
          winRateBonus: adjusted.winRateBonus,
          targetRateBonus: adjusted.targetRateBonus,
          stopRatePenalty: adjusted.stopRatePenalty,
          stopRatePenaltyRaw: adjusted.stopRatePenaltyRaw,
          stopRatePenaltyRelief: adjusted.stopRatePenaltyRelief,
          stopRatePenaltyReliefSignal: adjusted.stopRatePenaltyReliefSignal,
          antiPenalty: adjusted.antiPenalty,
          expectedRetBonus: adjusted.expectedRetBonus,
          eraCoverageBonus: adjusted.eraCoverageBonus,
          supportCountPenalty: adjusted.supportCountPenalty,
          singleEraPenalty: adjusted.singleEraPenalty,
          lowEraSupportPenalty: adjusted.lowEraSupportPenalty,
          supportCountPenaltyRaw: adjusted.supportCountPenaltyRaw,
          supportCountPenaltyRelief: adjusted.supportCountPenaltyRelief,
          supportCountPenaltyReliefSignal: adjusted.supportCountPenaltyReliefSignal,
          prototypeFailedBreakoutCount20: adjusted.prototypeFailedBreakoutCount20,
          prototypeGapFillThenContinueScore: adjusted.prototypeGapFillThenContinueScore,
          prototypeGapFillThenRevertScore: adjusted.prototypeGapFillThenRevertScore,
          prototypeExecutionFeasibilityScore: adjusted.prototypeExecutionFeasibilityScore,
          expectedNetRet3d: adjusted.expectedNetRet3d,
          qualityScore: adjusted.qualityScore,
          antiScore: adjusted.antiScore,
          winRate3d: adjusted.winRate3d ?? null,
          targetRate3d: adjusted.targetRate3d ?? null,
          stopRate3d: adjusted.stopRate3d ?? null,
          commonAlignmentScore: adjusted.commonAlignmentScore,
          matchedPrototypeClusterSignature: adjusted.clusterSignature,
          matchedPrototypeSelectedEraId: adjusted.selectedEraId,
          matchedPerfectPrototypeIds: row?.matchedPerfectPrototypeIds ?? [],
          matchedPerfectPrototypeCount: Number(row?.matchedPerfectPrototypeCount ?? 0) || 0,
          perfectPrototypePrimaryRuleId: row?.perfectPrototypePrimaryRuleId ?? null,
          perfectPrototypeGatePassed: row?.perfectPrototypeGatePassed === true,
          qualityTrades: adjusted.qualityTrades,
          clusterTemporalEraSupportCount: adjusted.clusterTemporalEraSupportCount,
          clusterTemporalEraCoverageRatio: adjusted.clusterTemporalEraCoverageRatio,
          targetEraCoverageRatio: adjusted.targetEraCoverageRatio,
          clusterTemporalDominantEraId: adjusted.clusterTemporalDominantEraId,
          clusterTemporalDominantEraShare: adjusted.clusterTemporalDominantEraShare,
          clusterTemporalMaxSingleEraShare: adjusted.clusterTemporalMaxSingleEraShare,
          clusterTemporalEffectiveSingleEraShare:
            adjusted.clusterTemporalEffectiveSingleEraShare,
          clusterTemporalSingleEraEvidenceCoverageRatio:
            adjusted.clusterTemporalSingleEraEvidenceCoverageRatio,
          clusterTemporalSingleEraEvidenceSupportRatio:
            adjusted.clusterTemporalSingleEraEvidenceSupportRatio,
          clusterTemporalEffectiveEraCount: adjusted.clusterTemporalEffectiveEraCount,
          clusterTemporalNormalizedEraEntropy:
            adjusted.clusterTemporalNormalizedEraEntropy,
          clusterTemporalSingleEraEvidenceEffectiveEraCountRatio:
            adjusted.clusterTemporalSingleEraEvidenceEffectiveEraCountRatio,
          clusterTemporalSingleEraEvidenceEntropyRatio:
            adjusted.clusterTemporalSingleEraEvidenceEntropyRatio,
          maxSingleEraShareCap: adjusted.maxSingleEraShareCap,
          minEraSupportCount: adjusted.minEraSupportCount,
          eraSupportShortfall: adjusted.eraSupportShortfall,
          eraCoverageShortfall: adjusted.eraCoverageShortfall,
          singleEraShareExcess: adjusted.singleEraShareExcess,
          eraSupportPenaltyReason: adjusted.eraSupportPenaltyReason,
          clusterTemporalEraSupportMin: adjusted.clusterTemporalEraSupportMin,
          clusterTemporalEraSupportMedian: adjusted.clusterTemporalEraSupportMedian,
          clusterTemporalEraWinRateStd: adjusted.clusterTemporalEraWinRateStd,
          clusterTemporalEraExpectedNetRetStd: adjusted.clusterTemporalEraExpectedNetRetStd,
          clusterTemporalEraContrastiveLiftStd: adjusted.clusterTemporalEraContrastiveLiftStd,
          groupScores: scored.groupScores,
          matchedPrototypeId: scored.prototypeId,
          matchedPrototypeSymbol: scored.prototypeSymbol,
          matchedPrototypeClusterId: scored.prototypeClusterId,
          stageScores: scored.stageScores,
          regimeTag: regime.tag,
          regimeVolatilityProxy: regime.volatilityProxy,
          regimeLiquidityProxy: regime.liquidityProxy,
          routeBucket,
          dataFreshnessDays,
          avgTradingValue20dKrw,
          spreadProxyPct: spreadProxy,
          slippageRisk: slippageRiskWithOrder,
          regimeExpert,
          orderProfile,
          successOnDecisionDay: jumpMeta?.successOnDecisionDay === true,
          successInWindow: jumpMeta?.successInWindow === true,
          hitWindowDays,
          firstHitOffset: jumpMeta?.firstHitOffset ?? null,
          firstStopOffset: jumpMeta?.firstStopOffset ?? null,
          stopTriggeredOnDecisionDay: jumpMeta?.stopTriggeredOnDecisionDay === true,
          stopTriggeredInWindow: jumpMeta?.stopTriggeredInWindow === true,
          maxWindowJumpPct: jumpMeta?.maxWindowJumpPct ?? null,
          minWindowDrawdownPct: jumpMeta?.minWindowDrawdownPct ?? null,
          decisionDayJumpPct: jumpMeta?.decisionDayJumpPct ?? null,
          targetDateKey: series[targetIdx]?.dateKey
        }, topK)
      }
      if (writebackTraceEnabled && decisionCursor === 0) {
        await appendWritebackTrace("lockbox_first_day_topk_ready", {
          decisionDateKey,
          topCandidates: topCandidates.length,
        })
      }
      if (candidateCountForTrace > 0 && similarityGatePassedForTrace > 0) {
        bump(lockboxSelectionFunnelCounts, "AFTER_SIMILARITY_GATE_DAY")
      } else if (candidateCountForTrace > 0 && similarityGateRejectedForTrace > 0) {
        bump(lockboxSelectionFunnelCounts, "SIMILARITY_GATE_ZERO_DAY")
      }
      const previewD1 = runD1Top1RankerShared({
        topCandidates,
        decisionGateCfg: {
          ...decisionGateCfg,
          exploration: {
            ...(decisionGateCfg?.exploration ?? {}),
            enabled: false
          }
        },
        calibrationCfg,
        executionCalibration: lockboxExecutionCalibration,
        agreementModel: agreementGateModel,
        agreementModelCfg: agreementGateModelCfg,
        policyContract: lockboxPolicyContractBase,
        explorationCtx: {
          pickedCount: lockboxPickedCount,
          pickedDays: lockboxPickedDays,
          coverageRecoveryDays: lockboxCoverageRecoveryDays,
          coverageRecoveryHitDays: lockboxCoverageRecoveryHitDays
        }
      })
      const ruleDayTypeDecision = classifyDayType({
        rows: previewD1?.top ?? topCandidates,
        cfg: dayTypeRouterCfg
      })
      const dayTypeModelDecision = scoreDayTypeModel({
        signals: ruleDayTypeDecision?.signals,
        model: dayTypeModelFinal,
        cfg: dayTypeModelCfg
      })
      const dayTypeDecision = applyLearnedDayTypeOverride({
        ruleDecision: ruleDayTypeDecision,
        modelDecision: dayTypeModelDecision,
        cfg: dayTypeModelCfg,
        policies: dayTypeRouterCfg?.policies
      })
      const gateCfgForDay = applyDayTypePolicyToGateCfg({
        gateCfg: decisionGateCfg,
        dayTypeDecision
      })
      const executionGateRuntime = resolveExecutionGateRuntime({
        calibration: {
          ...(lockboxExecutionCalibration && typeof lockboxExecutionCalibration === "object"
            ? lockboxExecutionCalibration
            : {}),
          regimeTag: String(topCandidates?.[0]?.regimeTag ?? "VOL_UNKNOWN_LIQ_UNKNOWN")
        },
        cfg: executionGateCfg
      })
      const dayTypeThresholds = resolveDayTypeThresholds({
        tauExec: executionGateRuntime?.activeCfg?.targetLcb,
        tauFp: falsePositiveGateCfg?.maxRisk,
        dayTypeDecision,
        gatePhase: executionGateRuntime?.gatePhase
      })
      const policyContractForDay = {
        ...lockboxPolicyContractBase,
        tauRank: Number(gateCfgForDay?.minFinalScore ?? lockboxPolicyContractBase?.tauRank ?? 0) || 0,
        tauExec: Number(dayTypeThresholds?.tauExec ?? lockboxPolicyContractBase?.tauExec ?? 0) || 0,
        tauFp: Number(dayTypeThresholds?.tauFp ?? lockboxPolicyContractBase?.tauFp ?? 1) || 1,
        dayType: String(dayTypeDecision?.dayType ?? "BALANCED"),
        budgetMode: opportunityBudgetCfg?.enabled === true ? "EXECUTION_BUDGET" : "DISABLED"
      }
      const d1Raw = runD1Top1RankerShared({
        topCandidates,
        decisionGateCfg: gateCfgForDay,
        calibrationCfg,
        executionCalibration: lockboxExecutionCalibration,
        agreementModel: agreementGateModel,
        agreementModelCfg: agreementGateModelCfg,
        policyContract: policyContractForDay,
        dayTypeDecision,
        explorationCtx: {
          pickedCount: lockboxPickedCount,
          pickedDays: lockboxPickedDays,
          coverageRecoveryDays: lockboxCoverageRecoveryDays,
          coverageRecoveryHitDays: lockboxCoverageRecoveryHitDays
        }
      })
      const d1 = dayTypeDecision?.noTrade === true
        ? applyDayTypeDecisionToD1({
            d1: d1Raw,
            dayTypeDecision
          })
        : {
            ...(d1Raw && typeof d1Raw === "object" ? d1Raw : {}),
            gate: {
              ...((d1Raw?.gate && typeof d1Raw.gate === "object") ? d1Raw.gate : {}),
              dayTypeDecision
            }
          }
      if (writebackTraceEnabled && decisionCursor === 0) {
        await appendWritebackTrace("lockbox_first_day_d1_ready", {
          decisionDateKey,
          topCount: Array.isArray(d1?.top) ? d1.top.length : 0,
          pickCount: Array.isArray(d1?.picks) ? d1.picks.length : 0,
          gateReason: String(d1?.gate?.gateReason ?? ""),
        })
      }
      const hasLockboxTopCandidates = topCandidates.length > 0
      if (hasLockboxTopCandidates) {
        bump(lockboxSelectionFunnelCounts, "TOP_CANDIDATE_DAY")
      } else {
        bump(lockboxSelectionFunnelCounts, "NO_CANDIDATE_DAY")
      }
      if (hasLockboxTopCandidates && dayTypeDecision?.noTrade === true) {
        bump(lockboxSelectionFunnelCounts, "DAY_TYPE_BLOCKED_DAY")
      } else if (hasLockboxTopCandidates) {
        bump(lockboxSelectionFunnelCounts, "AFTER_DAY_TYPE_DAY")
      }
      if (hasLockboxTopCandidates) {
        bump(lockboxDayTypeCounts, String(dayTypeDecision?.dayType ?? "BALANCED"))
        const lockboxDayTypePolicySource = String(dayTypeDecision?.policySource ?? "RULE")
        bump(lockboxDayTypePolicySourceCounts, lockboxDayTypePolicySource)
        const lockboxDayTypeModelMeta =
          dayTypeDecision?.modelMeta && typeof dayTypeDecision.modelMeta === "object"
            ? dayTypeDecision.modelMeta
            : {}
        const lockboxDayTypeModelApplyMode = String(lockboxDayTypeModelMeta?.applyMode ?? "RULE_ONLY")
        const lockboxDayTypeModelConfidenceBucket = String(
          lockboxDayTypeModelMeta?.confidenceBucket ?? "UNAVAILABLE",
        )
        const lockboxDayTypeModelShadowReason = String(
          lockboxDayTypeModelMeta?.shadowReason ?? "",
        ).trim()
        bump(lockboxDayTypeModelApplyModeCounts, lockboxDayTypeModelApplyMode)
        bump(lockboxDayTypeModelConfidenceBucketCounts, lockboxDayTypeModelConfidenceBucket)
        if (lockboxDayTypeModelShadowReason) {
          bump(lockboxDayTypeModelShadowReasonCounts, lockboxDayTypeModelShadowReason)
        }
        if (
          lockboxDayTypeModelApplyMode === "MODEL_OVERRIDE" ||
          lockboxDayTypeModelApplyMode === "MODEL_OVERRIDE_AGREE"
        ) {
          lockboxDayTypeModelOverrideCount += 1
        }
        if (lockboxDayTypeModelApplyMode === "MODEL_SHADOW") {
          lockboxDayTypeModelShadowCount += 1
          if (lockboxDayTypeModelMeta?.shadowNoTrade === true) {
            lockboxDayTypeModelShadowNoTradeCount += 1
          }
        }
        if (lockboxDayTypeModelApplyMode === "MODEL_OVERRIDE_AGREE") {
          lockboxDayTypeModelAgreeCount += 1
        } else if (isDayTypeModelRejected({
          modelMeta: lockboxDayTypeModelMeta,
          applyMode: lockboxDayTypeModelApplyMode
        })) {
          lockboxDayTypeModelRejectedCount += 1
        }
        const lockboxTop = Array.isArray(d1?.top) ? d1.top : []
        const lockboxTopHasHit = lockboxTop.some((row) => row?.successInWindow === true)
        if (dayTypeDecision?.noTrade === true) {
          lockboxDayTypeNoTradeCount += 1
          if (lockboxTopHasHit) lockboxDayTypeNoTradeHitCount += 1
        }
      }
      const lockboxTop1AgreementDecision = String(d1?.top?.[0]?.agreementDecision ?? "").trim()
      if (hasLockboxTopCandidates && dayTypeDecision?.noTrade !== true) {
        const agreementBlocked =
          decisionGateCfg?.agreementGate?.enabled === true &&
          lockboxTop1AgreementDecision &&
          lockboxTop1AgreementDecision !== "TRADE"
        bump(
          lockboxSelectionFunnelCounts,
          agreementBlocked ? "AGREEMENT_BLOCKED_DAY" : "AFTER_AGREEMENT_DAY",
        )
      }
      const toxicCfgLockbox = executionGateCfg?.toxicRegime ?? {}
      const d2 = Array.isArray(d1?.picks) && d1.picks.length > 0
        ? runD2ExecutionScorerShared({
            top: d1.top,
            picks: d1.picks,
            gate: d1.gate,
            rerankDecision: d1.rerankDecision,
            calibrationCfg,
            metaSelectorCfg,
            executionGateCfg,
            executionCalibration: lockboxExecutionCalibration,
            falsePositiveGateCfg,
            falsePositiveState: lockboxFalsePositiveState,
            falsePositiveModel: falsePositiveModelFinal,
            falsePositiveModelCfg,
            opportunityBudgetCfg,
            dayTypeDecision,
            toxicRegime: {
              enabled: toxicCfgLockbox?.enabled === true && toxicCfgLockbox?.updateOnly !== false,
              minSamples: Math.max(1, Number(toxicCfgLockbox?.minSamples ?? 60) || 60),
              maxHitRateLcb95: clamp01(toxicCfgLockbox?.maxHitRateLcb95 ?? 0),
              action: String(toxicCfgLockbox?.action ?? "SHADOW").trim().toUpperCase(),
              updateStats: updateRegimeOutcomeStats
            },
            policyContract: policyContractForDay
          })
        : { executedPicks: [], executedPick: null }
      if (writebackTraceEnabled && decisionCursor === 0) {
        await appendWritebackTrace("lockbox_first_day_d2_ready", {
          decisionDateKey,
          executedPicks: Array.isArray(d2?.executedPicks) ? d2.executedPicks.length : 0,
          falsePositiveRejectedCount: Number(d2?.falsePositiveRejectedCount ?? 0) || 0,
          executionBlockedCount: Number(d2?.executionBlockedCount ?? 0) || 0,
        })
      }
      const executionPicks = Array.isArray(d2?.executedPicks) ? d2.executedPicks : []
      const picksForAudit = Array.isArray(d1?.picks) ? d1.picks : []
      const top1Path = buildTop1PathTrace({
        d1,
        d2,
        fallbackGateReason: d1?.gate?.gateReason ?? "UNKNOWN"
      })
      const lockboxAgreementBlocked =
        decisionGateCfg?.agreementGate?.enabled === true &&
        lockboxTop1AgreementDecision &&
        lockboxTop1AgreementDecision !== "TRADE"
      const agreementGateTelemetry = buildAgreementGateDayTelemetry({
        rows: d1?.top ?? [],
        top1: d1?.top?.[0] ?? null,
        agreementGate: d1?.gate?.agreementGate ?? null,
        agreementGateCfg: decisionGateCfg?.agreementGate,
        agreementModelCfg: agreementGateModelCfg,
        top1Path,
        agreementBlocked: lockboxAgreementBlocked
      })
      if (hasLockboxTopCandidates && picksForAudit.length > 0) {
        bump(lockboxSelectionFunnelCounts, "D1_PICK_DAY")
      } else if (hasLockboxTopCandidates && dayTypeDecision?.noTrade !== true) {
        bump(lockboxSelectionFunnelCounts, "D1_ZERO_PICK_DAY")
      }
      if (hasLockboxTopCandidates && picksForAudit.length > 0) {
        bump(
          lockboxSelectionFunnelCounts,
          executionPicks.length > 0 ? "EXECUTION_TRADE_DAY" : "EXECUTION_BLOCKED_DAY",
        )
      }
      const selectionPolicy = d1?.gate?.selectionPolicy ?? { mode: "UNKNOWN", applied: false }
	      const logRow = {
	        decisionDateKey,
	        goalMode,
	        positionSemantics,
	        targetFirstMode: goalMode === "TARGET_FIRST_V2",
        partition: "LOCKBOX",
        candidateCount: candidateCountForTrace,
        perfectPrototypeGate: {
          enabled: isPerfectPrototypeGateActive(perfectPrototypeGateCfg),
          mode: String(perfectPrototypeGateCfg?.mode ?? "off").trim().toLowerCase() || "off",
          selectionMode:
            String(perfectPrototypeGateCfg?.selectionMode ?? "champion_only").trim().toLowerCase(),
          ...perfectPrototypeGateLockboxTelemetry
        },
        dayType: dayTypeDecision,
        dayTypeRule: ruleDayTypeDecision,
        dayTypeModelDecision,
        gateReason: d1?.gate?.gateReason ?? "UNKNOWN",
        scoreMargin: Number.isFinite(Number(d1?.gate?.scoreMargin)) ? Number(d1.gate.scoreMargin) : null,
        agreementGateTelemetry,
        similarityGate: {
          enabled: decisionGateCfg?.similarityGate?.enabled === true,
          disambiguationEnabled: similarityDisambiguationEnabled,
          scoredCount: candidateCountForTrace,
          passedCount: similarityGatePassedForTrace,
          rejectedCount: similarityGateRejectedForTrace,
          rejectReasonCounts: similarityGateRejectReasonCountsForTrace
        },
        rawScoreMargin:
          d1?.top?.[0] && Number.isFinite(Number(d1.top[0]?.rawScoreMargin))
            ? Number(d1.top[0].rawScoreMargin)
            : null,
        preRerankMargin:
          d1?.top?.[0] && Number.isFinite(Number(d1.top[0]?.preRerankScoreMargin))
            ? Number(d1.top[0].preRerankScoreMargin)
            : null,
        postRerankTopScoreMargin:
          d1?.top?.[0] && Number.isFinite(Number(d1.top[0]?.postRerankScoreMargin))
            ? Number(d1.top[0].postRerankScoreMargin)
            : null,
        postRerankMargin:
          d1?.top?.[0] && Number.isFinite(Number(d1.top[0]?.postRerankScoreMargin))
            ? Number(d1.top[0].postRerankScoreMargin)
            : null,
        firstSuccessRank: findFirstSuccessRank(d1?.top ?? [], topK),
        pickCount: picksForAudit.length,
        selectionPolicy,
        propensity: Number.isFinite(Number(d1?.gate?.propensity)) ? Number(d1.gate.propensity) : null,
        orderingTrace: d1?.orderingTrace ?? null,
        scoreOriginTrace: d1?.scoreOriginTrace ?? null,
        counterfactualGateSweep: d1?.counterfactualGateSweep ?? null,
        scoreRecoveryTelemetry: d1?.scoreRecovery ?? null,
        scoreRecalibrationTelemetry: d1?.scoreRecalibration ?? null,
        top1Path,
        execution: {
          preFalsePositiveApprovedCount: Math.max(0, Number(d2?.preFalsePositiveApprovedCount ?? 0) || 0),
          approvedRawCount: executionPicks.length,
          approvedCount: executionPicks.length,
          blockedCount: Math.max(0, Number(d2?.executionBlockedCount ?? 0) || 0),
          decisionCounts: d2?.executionDecisionCounts ?? {},
          shadowReasonCounts: d2?.executionShadowReasonCounts ?? {},
          falsePositiveDecisionCounts: d2?.falsePositiveDecisionCounts ?? {},
          falsePositiveReasonCounts: d2?.falsePositiveReasonCounts ?? {},
          falsePositiveRejectedCount: Math.max(0, Number(d2?.falsePositiveRejectedCount ?? 0) || 0),
          falsePositiveRejectedHitCount: Math.max(0, Number(d2?.falsePositiveRejectedHitCount ?? 0) || 0),
          falsePositiveRejectedMissCount: Math.max(0, Number(d2?.falsePositiveRejectedMissCount ?? 0) || 0),
          budgetDecisionCounts: d2?.budgetDecisionCounts ?? {},
          budgetReasonCounts: d2?.budgetReasonCounts ?? {},
          budgetRejectedCount: Math.max(0, Number(d2?.budgetRejectedCount ?? 0) || 0),
          budgetRejectedHitCount: Math.max(0, Number(d2?.budgetRejectedHitCount ?? 0) || 0),
          budgetRejectedMissCount: Math.max(0, Number(d2?.budgetRejectedMissCount ?? 0) || 0)
        },
        rejectionCounts: d1?.gate?.rejectionCounts ?? {},
        rankingPolicy: {
          inversionAdjust: d1?.inversionAdjusted ?? null,
          top1Rerank: d1?.rerankDecision ?? null,
          agreementGate: d1?.gate?.agreementGate ?? null,
          orderingTrace: d1?.orderingTrace ?? null
        },
        topK: d1?.top ?? [],
        pickedList: picksForAudit
      }
      d1LockboxBaselineRows.push(toD1RankedCandidatesRow(logRow))
      d2LockboxBaselineRows.push(toD2ExecutionAuditRow(logRow))
      if (writebackTraceEnabled && decisionCursor === 0) {
        await appendWritebackTrace("lockbox_first_day_audit_pushed", {
          decisionDateKey,
        })
      }
      if (!Array.isArray(d1?.picks) || d1.picks.length < 1) continue
      lockboxPickedCount += d1.selectionCount
      lockboxPickedDays += 1
      const selectionMode = String(selectionPolicy?.mode ?? "").toUpperCase()
      if (selectionMode === "RECOVERY") {
        lockboxCoverageRecoveryDays += 1
        const recoveryHit = d1.picks.some((row) => row?.successInWindow === true)
        if (recoveryHit) lockboxCoverageRecoveryHitDays += 1
      }
      const executedPick = d2?.executedPick ?? null
      if (!executedPick) continue
      const entryIdx = Number(executedPick?.decisionIdx ?? -1) + Number(entryRule?.entryOffsetDays ?? 0)
      if (!Number.isInteger(entryIdx) || entryIdx < 0 || entryIdx >= executedPick.series.length) continue
      const exitIdx = Math.min(entryIdx + holdDays - 1, executedPick.series.length - 1)
      const entryPrice = num(executedPick.series[entryIdx]?.[entryRule.entryPriceField])
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) continue
      const resolvedExit = resolveTradeExit({
        series: executedPick.series,
        entryIdx,
        maxExitIdx: exitIdx,
        entryPrice,
        targetPct,
        stopLossPct: stopLossPctLockbox
      })
      if (!resolvedExit) continue
      const exitDateKey = executedPick.series[resolvedExit.exitIdx]?.dateKey
      if (!singlePosition) continue
      const releaseIdx = lockboxDateToIdx.get(String(exitDateKey ?? ""))
      nextAvailableDecisionIdx =
        Number.isInteger(releaseIdx) ? Math.max(nextAvailableDecisionIdx, releaseIdx + 1) : lockboxDatesForTrace.length
    }
  }
  if (prepareLockboxDuringStepD) {
    await writeJsonl(d1LockboxRankedCandidatesPath, d1LockboxBaselineRows)
    await writeJsonl(d2LockboxExecutionAuditPath, d2LockboxBaselineRows)
    await appendWritebackTrace("post_lockbox_audit_write", {
      d1LockboxRankedCandidatesPath,
      d2LockboxExecutionAuditPath,
      d1LockboxRows: d1LockboxBaselineRows.length,
      d2LockboxRows: d2LockboxBaselineRows.length,
    })
  }
  await writeJson(perfPath, perfCounters)
  const weightsPayload = { weights }
  await writeJson(weightsPath, weightsPayload)
  const weightsHash = await hashFileSha1(weightsPath)
  await appendWritebackTrace("post_weights_write", {
    perfPath,
    weightsPath,
    weightsHash,
  })
  const routeWeightsForPolicy = {}
  for (const [bucket, bucketWeights] of routeWeightsByBucket.entries()) {
    routeWeightsForPolicy[String(bucket)] = { ...(bucketWeights ?? {}) }
  }
  const executionCalibrationRegimeStatsForPolicy = {}
  for (const [tag, row] of executionCalibrationRegimeStats.entries()) {
    const key = String(tag ?? "").trim()
    if (!key) continue
    executionCalibrationRegimeStatsForPolicy[key] = {
      count: Math.max(0, Number(row?.count ?? 0) || 0),
      hitCount: Math.max(0, Number(row?.hitCount ?? 0) || 0)
    }
  }
  const toxicRegimeUpdateStatsForPolicy = {}
  for (const [tag, row] of updateRegimeOutcomeStats.entries()) {
    const key = String(tag ?? "").trim()
    if (!key) continue
    toxicRegimeUpdateStatsForPolicy[key] = {
      count: Math.max(0, Number(row?.count ?? 0) || 0),
      hitCount: Math.max(0, Number(row?.hitCount ?? 0) || 0)
    }
  }
  summary.toxicRegimeUpdateStatsCount = Object.keys(toxicRegimeUpdateStatsForPolicy).length
  const policyStatePayload = {
    version: "v5",
    generatedAt: new Date().toISOString(),
    runId: String(ctx?.runId ?? ""),
    period: summary?.period ?? null,
    lookaheadViolations: summary?.lookaheadViolations ?? 0,
    executionLookaheadViolations: summary?.executionLookaheadViolations ?? 0,
    postScoreAdjust: postScoreAdjustCfg,
    decisionGate: decisionGateCfg,
    calibration: calibrationCfg,
    metaSelector: metaSelectorCfg,
    executionGate: executionGateCfg,
    falsePositiveGate: falsePositiveGateCfg,
    falsePositiveModelConfig: falsePositiveModelCfg,
    falsePositiveModel: falsePositiveModelFinal,
    agreementGateModelConfig: agreementGateModelCfg,
    agreementGateModel: agreementGateModelFinal,
    dayTypeRouter: dayTypeRouterCfg,
    dayTypeModelConfig: dayTypeModelCfg,
    dayTypeModel: dayTypeModelFinal,
    opportunityBudget: opportunityBudgetCfg,
    regimeRouter: regimeRouterCfg,
    regimeExperts: regimeExpertsCfg,
    orderSimulator: orderSimulatorCfg,
    finalWeights: weights,
    routeWeightsByBucket: routeWeightsForPolicy,
    generalizationExtendedBias: generalizationCfg?.extendedBias ?? {},
    generalizationTradeQualityPrior: {
      ...(generalizationCfg?.tradeQualityPrior ?? {}),
      applyToRanker: generalizationCfg?.tradeQualityPrior?.applyToRanker === true,
      sourceMode: String(generalizationCfg?.tradeQualityPrior?.sourceMode ?? "selected_candidates"),
      requireExecutedTrade: generalizationCfg?.tradeQualityPrior?.requireExecutedTrade === true
    },
    extendedBiasState: {
      routeBucketBias: routeBiasState,
      regimeBias: regimeBiasState,
      prototypeBias: prototypeBiasState
    },
    tradeQualityPriorState: {
      global: globalTradeQualityState,
      routeBucket: routeTradeQualityState,
      regime: regimeTradeQualityState,
      prototype: prototypeTradeQualityState
    },
    policyContract: {
      version: "v5",
      mode: "D1_D2_FP_MODEL_DT_MODEL_BUDGET_AGREEMENT",
      rankerScoreField: "rankerScore",
      executionScoreField: "executionScore",
      falsePositiveRiskField: "falsePositiveRisk",
      falsePositiveModelRiskField: "falsePositiveModelRisk",
      budgetDecisionField: "budgetDecision",
      agreementScoreField: "agreementScore",
      tauRank:
        Number.isFinite(Number(d1ObservedTauRank))
          ? Number(d1ObservedTauRank)
          : (Number(decisionGateCfg?.minFinalScore ?? 0) || 0),
      tauExec: Number(executionGateCfg?.targetLcb ?? 0) || 0,
      tauFp: Number(falsePositiveGateCfg?.maxRisk ?? 1) || 1,
      minAgreementScore: Number(decisionGateCfg?.agreementGate?.minAgreementScore ?? 0) || 0,
      dayType: "BALANCED",
      budgetMode: opportunityBudgetCfg?.enabled === true ? "EXECUTION_BUDGET" : "DISABLED"
    },
    executionCalibration: {
      globalCount: executionCalibrationGlobalCount,
      globalHitCount: executionCalibrationGlobalHitCount,
      regimeStats: executionCalibrationRegimeStatsForPolicy
    },
    falsePositiveState: {
      globalCount: falsePositiveGlobalCount,
      falsePositiveCount: falsePositiveFailureCount,
      routeStats: falsePositiveRouteState,
      regimeStats: falsePositiveRegimeState,
      prototypeStats: falsePositivePrototypeState
    },
    falsePositiveDataset: {
      path: falsePositiveDatasetPath,
      metaPath: falsePositiveDatasetMetaPath,
      ...falsePositiveDatasetMeta
    },
    adversarialReplayDataset: {
      path: adversarialReplayDatasetPath,
      metaPath: adversarialReplayDatasetMetaPath,
      ...adversarialReplayDatasetMeta
    },
    agreementDataset: {
      path: agreementDatasetPath,
      metaPath: agreementDatasetMetaPath,
      ...agreementDatasetMeta
    },
    dayTypeDataset: {
      path: dayTypeDatasetPath,
      metaPath: dayTypeDatasetMetaPath,
      ...dayTypeDatasetMeta
    },
    toxicRegimeUpdateStats: toxicRegimeUpdateStatsForPolicy
  }
  const resolvedLogsPath = pathExists(logsPath) ? logsPath : ""
  const resolvedSampledDebugPath =
    sampledDebugEnabled && pathExists(sampledDebugPath) ? sampledDebugPath : ""
  const resolvedCandidateIndexPath = pathExists(candidateIndexPath) ? candidateIndexPath : ""
  const resolvedCandidateIndexMetaPath = pathExists(candidateIndexMetaPath) ? candidateIndexMetaPath : ""
  const resolvedFeaturePackPath = pathExists(featurePackPath) ? featurePackPath : ""
  const resolvedFeaturePackMetaPath = pathExists(featurePackMetaPath) ? featurePackMetaPath : ""
  const resolvedD1RankedCandidatesPath = pathExists(d1RankedCandidatesPath) ? d1RankedCandidatesPath : ""
  const resolvedD2ExecutionAuditPath = pathExists(d2ExecutionAuditPath) ? d2ExecutionAuditPath : ""
  const resolvedD1LockboxRankedCandidatesPath = pathExists(d1LockboxRankedCandidatesPath)
    ? d1LockboxRankedCandidatesPath
    : ""
  const resolvedD2LockboxExecutionAuditPath = pathExists(d2LockboxExecutionAuditPath)
    ? d2LockboxExecutionAuditPath
    : ""
  const resolvedFalsePositiveDatasetPath = pathExists(falsePositiveDatasetPath) ? falsePositiveDatasetPath : ""
  const resolvedFalsePositiveDatasetMetaPath = pathExists(falsePositiveDatasetMetaPath)
    ? falsePositiveDatasetMetaPath
    : ""
  const resolvedAdversarialReplayDatasetPath = pathExists(adversarialReplayDatasetPath)
    ? adversarialReplayDatasetPath
    : ""
  const resolvedAdversarialReplayDatasetMetaPath = pathExists(adversarialReplayDatasetMetaPath)
    ? adversarialReplayDatasetMetaPath
    : ""
  const resolvedAgreementDatasetPath = pathExists(agreementDatasetPath) ? agreementDatasetPath : ""
  const resolvedAgreementDatasetMetaPath = pathExists(agreementDatasetMetaPath)
    ? agreementDatasetMetaPath
    : ""
  const resolvedDayTypeDatasetPath = pathExists(dayTypeDatasetPath) ? dayTypeDatasetPath : ""
  const resolvedDayTypeDatasetMetaPath = pathExists(dayTypeDatasetMetaPath)
    ? dayTypeDatasetMetaPath
    : ""
  summary.d1RankedCandidatesPath = resolvedD1RankedCandidatesPath
  summary.d1RankedCandidatesRows = d1RankedRows.length
  summary.d2ExecutionAuditRows = d2ExecutionAuditRows.length
  summary.d2ExecutionAuditPath = resolvedD2ExecutionAuditPath
  summary.d1LockboxRankedCandidatesPath = resolvedD1LockboxRankedCandidatesPath
  summary.d2LockboxExecutionAuditPath = resolvedD2LockboxExecutionAuditPath
  summary.d1LockboxRankedCandidatesRows = d1LockboxBaselineRows.length
  summary.d2LockboxExecutionAuditRows = d2LockboxBaselineRows.length
  summary.lockboxCoverageRecovery = {
    days: lockboxCoverageRecoveryDays,
    hitDays: lockboxCoverageRecoveryHitDays,
    hitRate:
      lockboxCoverageRecoveryDays > 0
        ? lockboxCoverageRecoveryHitDays / lockboxCoverageRecoveryDays
        : 0,
    share: lockboxPickedDays > 0 ? lockboxCoverageRecoveryDays / lockboxPickedDays : 0
  }
  summary.lockboxScoringTelemetry = {
    days: lockboxScoringDays,
    candidates: lockboxScoringCandidateCount,
    avgCandidatesPerDay:
      lockboxScoringDays > 0 ? lockboxScoringCandidateCount / lockboxScoringDays : 0,
    scoreMs: lockboxScoreMs,
    packMs: lockboxScorePackMs,
    computeMs: lockboxScoreComputeMs,
    batchCount: lockboxScoreBatchCount,
    skippedByCache:
      prepareLockboxDuringStepD === true && prepareLockboxDuringStepDEffective !== true
  }
  summary.lockboxSelectionFunnel = {
    counts: lockboxSelectionFunnelCounts
  }
  summary.lockboxDayTypeRouter = {
    enabled: dayTypeRouterCfg?.enabled === true,
    config: dayTypeRouterCfg,
    counts: lockboxDayTypeCounts,
    policySourceCounts: lockboxDayTypePolicySourceCounts,
    noTradeCount: lockboxDayTypeNoTradeCount,
    noTradeHitCount: lockboxDayTypeNoTradeHitCount,
    noTradeHitRate:
      lockboxDayTypeNoTradeCount > 0
        ? lockboxDayTypeNoTradeHitCount / lockboxDayTypeNoTradeCount
        : 0,
    modelConfig: dayTypeModelCfg,
    modelOverrideCount: lockboxDayTypeModelOverrideCount,
    modelShadowCount: lockboxDayTypeModelShadowCount,
    modelShadowNoTradeCount: lockboxDayTypeModelShadowNoTradeCount,
    modelApplyModeCounts: lockboxDayTypeModelApplyModeCounts,
    modelShadowReasonCounts: lockboxDayTypeModelShadowReasonCounts,
    modelConfidenceBucketCounts: lockboxDayTypeModelConfidenceBucketCounts,
    modelAgreeCount: lockboxDayTypeModelAgreeCount,
    modelRejectedCount: lockboxDayTypeModelRejectedCount
  }
  summary.weightsHash = weightsHash
  summary.artifactManifestPath = writebacksDisabled ? "" : artifactManifestPath
  summary.policyStatePath = ""
  summary.policyStateWritten = false
  summary.policyBundlePath = ""
  summary.policyBundleHash = ""
  summary.policyBundleWritten = false
  summary.writebacksDisabled = writebacksDisabled
  summary.feedbackUpdatesSkipped = feedbackUpdatesSkipped
  summary.executionFeedbackSkipped = executionFeedbackSkipped
  summary.probeScopeRequested = probeScopeRequestedRaw || null
  summary.probeScopeApplied = probeScopeApplied
  summary.configuredPromotionScope = configuredPromotionScope
  summary.effectivePromotionScope = promotionScope
  summary.falsePositiveDatasetPath = resolvedFalsePositiveDatasetPath
  summary.falsePositiveDatasetMetaPath = resolvedFalsePositiveDatasetMetaPath
  summary.adversarialReplayDatasetPath = resolvedAdversarialReplayDatasetPath
  summary.adversarialReplayDatasetMetaPath = resolvedAdversarialReplayDatasetMetaPath
  summary.dayTypeDatasetPath = resolvedDayTypeDatasetPath
  summary.dayTypeDatasetMetaPath = resolvedDayTypeDatasetMetaPath
  summary.perfectPrototypeGate = {
    ...perfectPrototypeGateStats,
    catalogRuleCount: Number(perfectPrototypeCatalog?.rules?.length ?? 0) || 0,
    championRuleCount: Number(perfectPrototypeCatalog?.championRuleIds?.length ?? 0) || 0
  }
  await writeJson(summaryPath, summary)
  await appendWritebackTrace("post_summary_write_initial", {
    summaryPath,
  })
  const artifactManifestPayload = {
    version: "v1",
    generatedAt: new Date().toISOString(),
    runId: String(ctx?.runId ?? ""),
    summaryPath,
    logsPath: resolvedLogsPath,
    sampledDebugPath: resolvedSampledDebugPath || null,
    candidateIndexPath: resolvedCandidateIndexPath,
    candidateIndexMetaPath: resolvedCandidateIndexMetaPath,
    featurePackPath: resolvedFeaturePackPath,
    featurePackMetaPath: resolvedFeaturePackMetaPath,
    perfPath,
    weightsPath,
    weightsHash,
    policyStatePath: "",
    d1RankedCandidatesPath: resolvedD1RankedCandidatesPath,
    d2ExecutionAuditPath: resolvedD2ExecutionAuditPath,
    d1LockboxRankedCandidatesPath: resolvedD1LockboxRankedCandidatesPath,
    d2LockboxExecutionAuditPath: resolvedD2LockboxExecutionAuditPath,
    falsePositiveDatasetPath: resolvedFalsePositiveDatasetPath,
    falsePositiveDatasetMetaPath: resolvedFalsePositiveDatasetMetaPath,
    adversarialReplayDatasetPath: resolvedAdversarialReplayDatasetPath,
    adversarialReplayDatasetMetaPath: resolvedAdversarialReplayDatasetMetaPath,
    agreementDatasetPath: resolvedAgreementDatasetPath,
    agreementDatasetMetaPath: resolvedAgreementDatasetMetaPath,
    dayTypeDatasetPath: resolvedDayTypeDatasetPath,
    dayTypeDatasetMetaPath: resolvedDayTypeDatasetMetaPath,
    perfectPrototypeCatalogPath: perfectPrototypeGateStats.catalogPath ?? null,
    policyBundlePath: ""
  }
  let resolvedPolicyStatePath = ""
  let resolvedPolicyBundlePath = ""
  let resolvedArtifactManifestPath = ""
  let policyBundlePayload = null
  if (!writebacksDisabled) {
    await writeJson(policyStatePath, policyStatePayload)
    resolvedPolicyStatePath = policyStatePath
    summary.policyStatePath = resolvedPolicyStatePath
    summary.policyStateWritten = true
    await appendWritebackTrace("post_policy_state_write", {
      policyStatePath,
    })
    artifactManifestPayload.policyStatePath = resolvedPolicyStatePath
    await writeJson(artifactManifestPath, artifactManifestPayload)
    resolvedArtifactManifestPath = artifactManifestPath
    await appendWritebackTrace("post_artifact_manifest_write", {
      artifactManifestPath,
    })
    policyBundlePayload = await buildStepDPolicyBundle({
      runId: ctx?.runId,
      summaryPath,
      policyStatePath: resolvedPolicyStatePath,
      weightsPath,
      artifactManifestPath,
      sampledDebugPath: resolvedSampledDebugPath || null,
      d1RankedCandidatesPath: resolvedD1RankedCandidatesPath,
      d2ExecutionAuditPath: resolvedD2ExecutionAuditPath,
      d1LockboxRankedCandidatesPath: resolvedD1LockboxRankedCandidatesPath,
      d2LockboxExecutionAuditPath: resolvedD2LockboxExecutionAuditPath,
      policyContract: summary?.policyContract ?? null,
      policyFingerprint: summary?.policyFingerprint ?? null,
      lineageKey:
        ctx?.__runtime?.lineageKey ??
        ctx?.__runtime?.championBundle?.lineageKey ??
        null
    })
    await writeStepDPolicyBundle({
      bundlePath: policyBundlePath,
      bundle: policyBundlePayload
    })
    resolvedPolicyBundlePath = policyBundlePath
    artifactManifestPayload.policyBundlePath = resolvedPolicyBundlePath
    summary.policyBundlePath = resolvedPolicyBundlePath
    summary.policyBundleHash = await hashFileSha1(policyBundlePath)
    summary.policyBundleWritten = true
    summary.artifactManifestPath = resolvedArtifactManifestPath
    await writeJson(summaryPath, summary)
    await writeJson(artifactManifestPath, artifactManifestPayload)
    await appendWritebackTrace("post_final_writeback", {
      summaryPath,
      policyBundlePath,
      artifactManifestPath,
    })
  }

  ctx.__runtime = ctx.__runtime ?? {}
  ctx.__runtime.stepDEBase = {
    seriesMap,
    universeMap,
    symbolMap,
    allDateKeys
  }
  const runtimeDecisionCandidatesByDate = new Map()
  for (const [dateKey, seeds] of decisionCandidatesByDate.entries()) {
    if (!isInRange(dateKey, ctx.periods.lockbox)) continue
    runtimeDecisionCandidatesByDate.set(dateKey, seeds)
  }
  ctx.__runtime.stepDDecisionCandidatesByDate = runtimeDecisionCandidatesByDate
  ctx.__runtime.stepDFeaturePackLookupByDate =
    runtimeLockboxFeaturePackLookupByDate instanceof Map
      ? runtimeLockboxFeaturePackLookupByDate
      : (featurePackLookupByDate instanceof Map ? featurePackLookupByDate : null)
  ctx.__runtime.stepDLockboxArtifacts = {
    stepDSummaryObject: summary,
    policyStateObject: policyStatePayload,
    policyBundleObject: resolvedPolicyBundlePath ? policyBundlePayload : null,
    candidateIndexMetaObject: candidateIndexMetaPayload,
    featurePackMetaObject: featurePackMetaPayload,
    stepCRuntimeArtifacts: ctx.__runtime.stepCRuntimeArtifacts,
    finalWeightsObject: weightsPayload,
    d1EvalAuditRows: d1RankedRows,
    d2EvalAuditRows: d2ExecutionAuditRows,
    d1LockboxAuditRows: d1LockboxBaselineRows,
    d2LockboxAuditRows: d2LockboxBaselineRows,
    d1LockboxBaselineByDate: new Map(
      d1LockboxBaselineRows.map((row) => [String(row?.decisionDateKey ?? "").trim(), row]),
    ),
    d2LockboxBaselineByDate: new Map(
      d2LockboxBaselineRows.map((row) => [String(row?.decisionDateKey ?? "").trim(), row]),
    )
  }

  return {
    step: "D",
    logsPath: resolvedLogsPath,
    sampledDebugPath: resolvedSampledDebugPath || null,
    candidateIndexPath: resolvedCandidateIndexPath,
    candidateIndexMetaPath: resolvedCandidateIndexMetaPath,
    featurePackPath: resolvedFeaturePackPath,
    featurePackMetaPath: resolvedFeaturePackMetaPath,
    perfPath,
    weightsPath,
    weightsHash,
    policyStatePath: resolvedPolicyStatePath,
    policyBundlePath: resolvedPolicyBundlePath,
    artifactManifestPath: resolvedArtifactManifestPath,
    d1RankedCandidatesPath: resolvedD1RankedCandidatesPath,
    d2ExecutionAuditPath: resolvedD2ExecutionAuditPath,
    d1LockboxRankedCandidatesPath: resolvedD1LockboxRankedCandidatesPath,
    d2LockboxExecutionAuditPath: resolvedD2LockboxExecutionAuditPath,
    falsePositiveDatasetPath: resolvedFalsePositiveDatasetPath,
    falsePositiveDatasetMetaPath: resolvedFalsePositiveDatasetMetaPath,
    adversarialReplayDatasetPath: resolvedAdversarialReplayDatasetPath,
    adversarialReplayDatasetMetaPath: resolvedAdversarialReplayDatasetMetaPath,
    dayTypeDatasetPath: resolvedDayTypeDatasetPath,
    dayTypeDatasetMetaPath: resolvedDayTypeDatasetMetaPath,
    summaryPath,
    summary
  }
}
