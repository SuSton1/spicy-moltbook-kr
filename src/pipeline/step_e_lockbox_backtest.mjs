import path from "node:path"

import { resolveGlobalWindow, resolveLocalWindow } from "../lib/config.mjs"
import { isInRange, uniqueSortedDateKeys } from "../lib/date.mjs"
import {
  buildCandleSeriesMap,
  loadStepDEData
} from "../lib/data.mjs"
import {
  buildPrototypeQualityLookup,
  resolveDecisionGate,
  resolvePostScoreAdjust
} from "../lib/decision_policy.mjs"
import {
  resolveEntryRule,
  resolveTradeExit
} from "../lib/trade_rules.mjs"
import {
  ensureDir,
  pathExists,
  readJson,
  readJsonl,
  writeJson,
  writeJsonl
} from "../lib/io.mjs"
import { verifyChampionBundleParity } from "../lib/policy_parity.mjs"
import { buildSelectionHitAt1Snapshot } from "../lib/selection_metric.mjs"
import { resolveCalibrationConfig } from "../lib/calibration.mjs"
import { resolveMetaSelectorConfig } from "../lib/meta_selector.mjs"
import { resolveExecutionGate } from "../lib/execution_gate.mjs"
import {
  buildFalsePositiveState,
  resolveFalsePositiveGate
} from "../lib/false_positive_gate.mjs"
import {
  resolveFalsePositiveModelArtifact,
  resolveFalsePositiveModelConfig
} from "../lib/false_positive_model.mjs"
import {
  resolveAgreementModelConfig
} from "../lib/agreement_gate.mjs"
import {
  resolveDayTypeRouter
} from "../lib/day_type_policy.mjs"
import {
  extractDayTypeModelFeatures,
  resolveDayTypeModelArtifact,
  resolveDayTypeModelConfig
} from "../lib/day_type_model.mjs"
import {
  resolveOpportunityBudget
} from "../lib/opportunity_budget.mjs"
import {
  resolveRegimeExpertsConfig
} from "../lib/regime_experts.mjs"
import {
  resolveOrderSimulatorConfig
} from "../lib/order_simulator.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

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
  return {
    topMatchedC0FamilyId: topEntry?.[0] ?? null,
    topMatchedC0Score:
      topScoreList.length > 0
        ? topScoreList.reduce((acc, value) => acc + (Number(value) || 0), 0) / topScoreList.length
        : 0,
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

const summarizeFamilyLockboxRollup = ({
  d2LockboxAuditRows,
  trades,
  prototypeQualityLookup,
  selectedFamilyIds = [],
  representativeFamilyIds = []
}) => {
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
  const byFamilyId = new Map()
  const ensure = (familyId) => {
    const key = String(familyId ?? "").trim()
    if (!key) return null
    const row = byFamilyId.get(key) ?? {
      familyId: key,
      familyPickCountLockbox: 0,
      familyTargetHitCountLockbox: 0,
      familyExecutedPickCountLockbox: 0,
      familyExecutedTargetHitCountLockbox: 0,
      familyStopCountLockbox: 0,
      familyTimeoutNegativeCountLockbox: 0,
      c1SelectedFamily: selectedFamilyIdSet.has(key),
      c2RepresentativeFamily: representativeFamilyIdSet.has(key)
    }
    byFamilyId.set(key, row)
    return row
  }

  for (const row of Array.isArray(d2LockboxAuditRows) ? d2LockboxAuditRows : []) {
    const selectedCandidates = Array.isArray(row?.selectedCandidates) ? row.selectedCandidates : []
    for (const candidate of selectedCandidates) {
      const matchedPrototypeId = String(candidate?.matchedPrototypeId ?? "").trim()
      if (!matchedPrototypeId) continue
      const quality = lookup.get(matchedPrototypeId) ?? null
      const familyId = String(quality?.c0FamilyId ?? "").trim()
      if (!familyId) continue
      const bucket = ensure(familyId)
      if (!bucket) continue
      bucket.familyPickCountLockbox += 1
      if (candidate?.successInWindow === true) {
        bucket.familyTargetHitCountLockbox += 1
      }
    }
  }

  for (const trade of Array.isArray(trades) ? trades : []) {
    const matchedPrototypeId = String(trade?.matchedPrototypeId ?? "").trim()
    if (!matchedPrototypeId) continue
    const quality = lookup.get(matchedPrototypeId) ?? null
    const familyId = String(quality?.c0FamilyId ?? "").trim()
    if (!familyId) continue
    const bucket = ensure(familyId)
    if (!bucket) continue
    bucket.familyExecutedPickCountLockbox += 1
    const exitReason = String(trade?.exitReason ?? "").trim().toUpperCase()
    if (exitReason === "TARGET") {
      bucket.familyExecutedTargetHitCountLockbox += 1
    } else if (exitReason === "STOP" || exitReason === "BOTH_HIT_STOP_FIRST") {
      bucket.familyStopCountLockbox += 1
    } else {
      const netRet = Number(trade?.netRet ?? 0) || 0
      if (netRet < 0) bucket.familyTimeoutNegativeCountLockbox += 1
    }
  }

  return Array.from(byFamilyId.values())
    .map((row) => ({
      ...row,
      familyHitRateLockbox:
        row.familyPickCountLockbox > 0
          ? row.familyTargetHitCountLockbox / row.familyPickCountLockbox
          : 0,
      familyExecutedHitRateLockbox:
        row.familyExecutedPickCountLockbox > 0
          ? row.familyExecutedTargetHitCountLockbox / row.familyExecutedPickCountLockbox
          : 0,
      familyStopRateLockbox:
        row.familyExecutedPickCountLockbox > 0
          ? row.familyStopCountLockbox / row.familyExecutedPickCountLockbox
          : 0,
      familyTimeoutNegativeRateLockbox:
        row.familyExecutedPickCountLockbox > 0
          ? row.familyTimeoutNegativeCountLockbox / row.familyExecutedPickCountLockbox
          : 0
    }))
    .sort((left, right) => {
      const byHitRate =
        Number(right?.familyHitRateLockbox ?? 0) - Number(left?.familyHitRateLockbox ?? 0)
      if (byHitRate !== 0) return byHitRate
      const byPicks =
        Number(right?.familyPickCountLockbox ?? 0) - Number(left?.familyPickCountLockbox ?? 0)
      if (byPicks !== 0) return byPicks
      return String(left?.familyId ?? "").localeCompare(String(right?.familyId ?? ""))
    })
}

const normalizeSymbolSet = (rows) =>
  new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => String(row?.symbol ?? "").trim().toUpperCase())
      .filter(Boolean),
  )

const symbolSetsEqual = (left, right) => {
  if (!(left instanceof Set) || !(right instanceof Set)) return false
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

const resolveGoalMode = (raw) => {
  const text = String(raw ?? "LEGACY_PNL_V1").trim().toUpperCase()
  if (text === "TARGET_FIRST_V2") return "TARGET_FIRST_V2"
  return "LEGACY_PNL_V1"
}

const resolvePositionSemantics = (raw) => {
  const text = String(raw ?? "SINGLE_POSITION_V1").trim().toUpperCase()
  if (text === "OVERLAP_DAILY_ONE_PICK_V2") return "OVERLAP_DAILY_ONE_PICK_V2"
  return "SINGLE_POSITION_V1"
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

const resolveFinalWeights = (weightsJson) => {
  const weights = weightsJson?.weights
  if (!weights || typeof weights !== "object") {
    throw new Error("step-d weights_final.json must provide a weights object.")
  }
  let sum = 0
  for (const value of Object.values(weights)) {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("Invalid weights_final weights. Expected finite values >= 0.")
    }
    sum += n
  }
  if (sum <= 0) {
    throw new Error("Invalid weights_final weights. Sum must be > 0.")
  }
  return weights
}

const calcMdd = (equityCurve) => {
  let peak = Number.NEGATIVE_INFINITY
  let mdd = 0
  for (const v of equityCurve) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = (peak - v) / peak
      if (dd > mdd) mdd = dd
    }
  }
  return mdd
}

const bump = (obj, key) => {
  obj[key] = Number(obj[key] ?? 0) + 1
}

const mergeCountMap = (target, src) => {
  const source = src && typeof src === "object" ? src : {}
  for (const [key, value] of Object.entries(source)) {
    const safeKey = String(key ?? "").trim()
    if (!safeKey) continue
    target[safeKey] = Number(target[safeKey] ?? 0) + (Number(value ?? 0) || 0)
  }
}

const findFirstSuccessRank = (rows, limit = Number.POSITIVE_INFINITY) => {
  const ranked = Array.isArray(rows) ? rows : []
  const maxRank = Math.max(1, Math.floor(Number(limit) || 1))
  for (let i = 0; i < ranked.length && i < maxRank; i += 1) {
    if (ranked[i]?.successInWindow === true) return i + 1
  }
  return null
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

const resolveBiasValue = ({ map, key, maxAbs }) => {
  if (!map || typeof map !== "object") return 0
  const safeKey = String(key ?? "").trim()
  if (!safeKey) return 0
  return clamp(Number(map[safeKey] ?? 0) || 0, -maxAbs, maxAbs)
}

const requireWeightObject = (value, label) => {
  const raw = value && typeof value === "object" ? value : null
  if (!raw) {
    throw new Error(`${label} missing`)
  }
  const out = {}
  let hasPositive = false
  for (const [k, v] of Object.entries(raw ?? {})) {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) continue
    out[String(k)] = n
    if (n > 0) hasPositive = true
  }
  if (!hasPositive) {
    throw new Error(`${label} invalid`)
  }
  return out
}

const isEvalLikePartition = (value) => String(value ?? "").trim().toUpperCase().includes("V")

const normalizeDistribution = (counts) => {
  const source = counts && typeof counts === "object" ? counts : {}
  const cleaned = {}
  let total = 0
  for (const [key, valueRaw] of Object.entries(source)) {
    const keyText = String(key ?? "").trim()
    if (!keyText) continue
    const value = Math.max(0, Number(valueRaw ?? 0) || 0)
    if (value <= 0) continue
    cleaned[keyText] = value
    total += value
  }
  const distribution = {}
  if (total > 0) {
    for (const [key, value] of Object.entries(cleaned)) {
      distribution[key] = value / total
    }
  }
  return {
    total,
    counts: cleaned,
    distribution
  }
}

const computeDistributionL1 = (left, right) => {
  const lhs = normalizeDistribution(left)
  const rhs = normalizeDistribution(right)
  const keys = new Set([
    ...Object.keys(lhs.distribution ?? {}),
    ...Object.keys(rhs.distribution ?? {})
  ])
  let l1 = 0
  for (const key of keys) {
    l1 += Math.abs(Number(lhs.distribution?.[key] ?? 0) - Number(rhs.distribution?.[key] ?? 0))
  }
  return {
    left: lhs,
    right: rhs,
    l1,
    normalized: clamp(l1 / 2, 0, 1)
  }
}

const summarizeExecutionAuditDistribution = (rows, field) => {
  const counts = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    const candidates = Array.isArray(row?.selectedCandidates) ? row.selectedCandidates : []
    for (const candidate of candidates) {
      if (String(candidate?.executionDecision ?? "").trim().toUpperCase() !== "TRADE") continue
      const key = String(candidate?.[field] ?? "").trim()
      if (!key) continue
      counts[key] = Number(counts[key] ?? 0) + 1
    }
  }
  return counts
}

const summarizeDecisionCountRows = (rows, field) => {
  const counts = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    const src = row?.[field] && typeof row[field] === "object" ? row[field] : {}
    for (const [key, valueRaw] of Object.entries(src)) {
      const safeKey = String(key ?? "").trim()
      if (!safeKey) continue
      counts[safeKey] = Number(counts[safeKey] ?? 0) + (Number(valueRaw ?? 0) || 0)
    }
  }
  return counts
}

const summarizeTopFieldCounts = (rows, field) => {
  const counts = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.[field] ?? "").trim()
    if (!key) continue
    counts[key] = Number(counts[key] ?? 0) + 1
  }
  return counts
}

const resolveReplayFeedbackOutcome = ({
  row,
  entryRule,
  holdDays,
  targetPct,
  stopLossPct,
  costPct
}) => {
  const decisionIdx = Number(row?.decisionIdx)
  const series = Array.isArray(row?.series) ? row.series : null
  if (!Number.isInteger(decisionIdx) || !Array.isArray(series) || series.length < 2) {
    return null
  }
  const entryIdx = decisionIdx + entryRule.entryOffsetDays
  if (entryIdx < 0 || entryIdx >= series.length) return null
  const maxExitIdx = Math.min(entryIdx + holdDays - 1, series.length - 1)
  const entryDateKey = series[entryIdx]?.dateKey ?? null
  const entryPrice = num(series[entryIdx]?.[entryRule.entryPriceField])
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null
  const resolvedExit = resolveTradeExit({
    series,
    entryIdx,
    maxExitIdx,
    entryPrice,
    targetPct,
    stopLossPct
  })
  if (!resolvedExit) return null
  const exitDateKey = series[resolvedExit.exitIdx]?.dateKey ?? null
  const exitPrice = num(resolvedExit.exitPrice)
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) return null
  const grossRet = exitPrice / entryPrice - 1
  const netRet = grossRet - costPct
  return {
    entryDateKey,
    exitDateKey,
    entryPrice,
    exitPrice,
    grossRet,
    netRet,
    hitTarget: resolvedExit.hitTarget === true,
    hitStop: resolvedExit.hitStop === true,
    exitReason: resolvedExit.exitReason ?? null
  }
}

const buildReplayFeedbackRow = ({
  decisionDateKey,
  row,
  candidateRole,
  selectedByPolicy = false,
  executedByPolicy = false,
  openPositionSkippedByPolicy = false,
  ruleDayTypeDecision,
  dayTypeDecision,
  d1,
  d2,
  entryRule,
  holdDays,
  targetPct,
  stopLossPct,
  costPct
}) => {
  if (!row || typeof row !== "object") return null
  const symbol = String(row?.symbol ?? "").trim()
  if (!symbol) return null
  const outcome = resolveReplayFeedbackOutcome({
    row,
    entryRule,
    holdDays,
    targetPct,
    stopLossPct,
    costPct
  })
  if (!outcome) return null
  const top1Symbol = String(d1?.top?.[0]?.symbol ?? "").trim()
  const candidateHit = outcome.netRet > 0
  const selectedHit = selectedByPolicy === true && candidateHit
  const executedHit = executedByPolicy === true && candidateHit
  const executionDecision =
    row?.executionDecision ??
    (executedByPolicy === true
      ? "TRADE"
      : selectedByPolicy === true
        ? (d2?.executionDecisionCounts && Object.keys(d2.executionDecisionCounts).length > 0
            ? "SHADOW_REPLAY_COUNTERFACTUAL"
            : "SKIP_NOT_EXECUTED")
        : "SKIP_NOT_SELECTED")
  const executionShadowReason =
    row?.executionShadowReason ??
    row?.executionShadowReasonPreFalsePositive ??
    (dayTypeDecision?.noTrade === true
      ? "DAY_TYPE_NO_TRADE"
      : d1?.gate?.gateReason ?? null)
  const orderingTrace =
    d1?.orderingTrace && typeof d1.orderingTrace === "object"
      ? d1.orderingTrace
      : null
  const top1Path =
    d1?.top1Path && typeof d1.top1Path === "object"
      ? d1.top1Path
      : null
  return {
    decisionDateKey,
    symbol,
    name: row?.name ?? null,
    candidateRole: String(candidateRole ?? "TOP1"),
    top1Candidate: symbol === top1Symbol,
    selectedByPolicy: selectedByPolicy === true,
    executedByPolicy: executedByPolicy === true,
    candidateHit,
    selectedHit,
    executedHit,
    top1Blocked: symbol === top1Symbol && executedByPolicy !== true,
    score: row?.score ?? null,
    baseScore: row?.baseScore ?? null,
    finalScore: row?.finalScore ?? null,
    rankerScore: Number(row?.rankerScore ?? row?.finalScore ?? row?.score ?? 0) || 0,
    rawScoreMargin: Number.isFinite(Number(row?.rawScoreMargin)) ? Number(row.rawScoreMargin) : null,
    postRerankScoreMargin: Number.isFinite(Number(row?.postRerankScoreMargin))
      ? Number(row.postRerankScoreMargin)
      : null,
    gateScoreMargin: Number.isFinite(Number(row?.gateScoreMargin ?? row?.rawScoreMargin))
      ? Number(row?.gateScoreMargin ?? row?.rawScoreMargin)
      : null,
    executionScore: Number.isFinite(Number(row?.executionScore)) ? Number(row.executionScore) : null,
    agreementScore: Number.isFinite(Number(row?.agreementScore)) ? Number(row.agreementScore) : null,
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
    expectedNetRet3d: Number.isFinite(Number(row?.expectedNetRet3d)) ? Number(row.expectedNetRet3d) : null,
    qualityScore: Number.isFinite(Number(row?.qualityScore)) ? Number(row.qualityScore) : null,
    antiScore: Number.isFinite(Number(row?.antiScore)) ? Number(row.antiScore) : null,
    rankPct: Number.isFinite(Number(row?.rankPct)) ? Number(row.rankPct) : null,
    pHitCalibrated: row?.calibrated?.pHitCalibrated ?? row?.pHitCalibrated ?? null,
    pStopFirstCalibrated: row?.calibrated?.pStopFirstCalibrated ?? row?.pStopFirstCalibrated ?? null,
    pFillCalibrated: row?.calibrated?.pFillCalibrated ?? row?.pFillCalibrated ?? null,
    confidence: row?.calibrated?.confidence ?? row?.confidence ?? null,
    orderingTrace,
    top1Path,
    inputTop1Symbol: orderingTrace?.inputTop1?.symbol ?? null,
    preRerankTop1Symbol: orderingTrace?.preRerankTop1?.symbol ?? null,
    postPrimaryRerankTop1Symbol: orderingTrace?.postPrimaryRerankTop1?.symbol ?? null,
    gateInputTop1Symbol:
      top1Path?.gateInputTop1Symbol ?? orderingTrace?.gateInputTop1?.symbol ?? null,
    finalSelectedTop1Symbol:
      top1Path?.finalSelectedTop1Symbol ?? orderingTrace?.finalSelectedTop1?.symbol ?? null,
    finalExecutedTop1Symbol:
      top1Path?.finalExecutedTop1Symbol ??
      (executedByPolicy === true ? symbol : null),
    blockedTop1WasHit: top1Path?.blockedTop1WasHit === true,
    blockedTop1Reason: top1Path?.blockedTop1Reason ?? null,
    swapCandidatePoolSize: Number.isFinite(Number(orderingTrace?.swapCandidatePoolSize))
      ? Number(orderingTrace.swapCandidatePoolSize)
      : null,
    swapRejectedReason:
      orderingTrace?.primaryRerankApplied === true ? null : orderingTrace?.primaryRerankReason ?? null,
    routeBucket: row?.routeBucket ?? null,
    regimeTag: row?.regimeTag ?? null,
    prototypeFamilyKey: row?.prototypeFamilyKey ?? null,
    matchedPrototypeId: row?.matchedPrototypeId ?? null,
    matchedPrototypeClusterId: row?.matchedPrototypeClusterId ?? null,
    matchedPrototypeClusterSignature: row?.matchedPrototypeClusterSignature ?? null,
    matchedPrototypeSelectedEraId: row?.matchedPrototypeSelectedEraId ?? null,
    tradeQualityPriorAdjustment: Number.isFinite(Number(row?.tradeQualityPriorAdjustment))
      ? Number(row.tradeQualityPriorAdjustment)
      : null,
    tradeQualityRankerAdjustment: Number.isFinite(Number(row?.tradeQualityRankerAdjustment))
      ? Number(row.tradeQualityRankerAdjustment)
      : null,
    tradeQualityRankerApplied: row?.tradeQualityRankerApplied === true,
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
    groupScores:
      row?.groupScores && typeof row.groupScores === "object"
        ? row.groupScores
        : null,
    regimeVolatilityProxy: Number.isFinite(Number(row?.regimeVolatilityProxy))
      ? Number(row.regimeVolatilityProxy)
      : null,
    regimeLiquidityProxy: Number.isFinite(Number(row?.regimeLiquidityProxy))
      ? Number(row.regimeLiquidityProxy)
      : null,
    avgTradingValue20dKrw: Number.isFinite(Number(row?.avgTradingValue20dKrw))
      ? Number(row.avgTradingValue20dKrw)
      : null,
    spreadProxyPct: Number.isFinite(Number(row?.spreadProxyPct)) ? Number(row.spreadProxyPct) : null,
    slippageRisk: Number.isFinite(Number(row?.slippageRisk)) ? Number(row.slippageRisk) : null,
    dayType: String(dayTypeDecision?.dayType ?? "BALANCED"),
    dayTypeNoTrade: dayTypeDecision?.noTrade === true,
    dayTypeShadowNoTrade:
      dayTypeDecision?.modelMeta?.shadowNoTrade === true || dayTypeDecision?.shadowNoTrade === true,
    dayTypePolicySource: dayTypeDecision?.policySource ?? null,
    dayTypeModelPredicted: dayTypeDecision?.modelDecision?.predictedDayType ?? null,
    dayTypeModelApplyMode: dayTypeDecision?.modelMeta?.applyMode ?? null,
    dayTypeModelShadowReason: dayTypeDecision?.modelMeta?.shadowReason ?? null,
    dayTypeModelConfidenceBucket: dayTypeDecision?.modelMeta?.confidenceBucket ?? null,
    ruleDayType: String(ruleDayTypeDecision?.dayType ?? dayTypeDecision?.dayType ?? "BALANCED"),
    ruleDayTypeNoTrade: ruleDayTypeDecision?.noTrade === true,
    ruleDayTypePolicySource: ruleDayTypeDecision?.policySource ?? "RULE",
    dayTypeModelFeatures:
      row?.dayTypeModelFeatures && typeof row.dayTypeModelFeatures === "object"
        ? row.dayTypeModelFeatures
        : (ruleDayTypeDecision?.dayTypeModelFeatures &&
            typeof ruleDayTypeDecision.dayTypeModelFeatures === "object"
          ? ruleDayTypeDecision.dayTypeModelFeatures
          : extractDayTypeModelFeatures({
            signals: ruleDayTypeDecision?.signals ?? {}
          })),
    executionDecisionPreFalsePositive: row?.executionDecisionPreFalsePositive ?? executionDecision,
    executionShadowReasonPreFalsePositive:
      row?.executionShadowReasonPreFalsePositive ?? executionShadowReason,
    falsePositiveRisk: Number.isFinite(Number(row?.falsePositiveRisk)) ? Number(row.falsePositiveRisk) : null,
    falsePositiveModelRisk: Number.isFinite(Number(row?.falsePositiveModelRisk))
      ? Number(row.falsePositiveModelRisk)
      : null,
    falsePositiveDecision: row?.falsePositiveDecision ?? (executedByPolicy === true ? "TRADE" : "SKIP_COUNTERFACTUAL"),
    falsePositiveReason: row?.falsePositiveReason ?? null,
    budgetDecision: row?.budgetDecision ?? (executedByPolicy === true ? "TRADE" : "SKIP_COUNTERFACTUAL"),
    budgetReason: row?.budgetReason ?? null,
    executionDecision,
    executionShadowReason,
    metaDecision: row?.metaDecision ?? null,
    metaReason: row?.metaReason ?? null,
    openPositionSkippedByPolicy,
    entryDateKey: outcome.entryDateKey,
    exitDateKey: outcome.exitDateKey,
    entryPrice: outcome.entryPrice,
    exitPrice: outcome.exitPrice,
    grossRet: outcome.grossRet,
    netRet: outcome.netRet,
    hitTarget: outcome.hitTarget,
    hitStop: outcome.hitStop,
    exitReason: outcome.exitReason,
    labelSource: "LIVE_LOCKBOX_FAILURE_JOIN"
  }
}

const buildSeedLookupBySymbol = (seeds) => {
  const lookup = new Map()
  for (const seed of Array.isArray(seeds) ? seeds : []) {
    const symbol = String(seed?.symbol ?? "").trim().toUpperCase()
    if (!symbol) continue
    if (!lookup.has(symbol)) lookup.set(symbol, seed)
  }
  return lookup
}

const median = (values) => {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
  if (nums.length < 1) return 0
  const mid = Math.floor(nums.length / 2)
  return nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
}

const average = (values) => {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
  if (nums.length < 1) return 0
  return nums.reduce((acc, value) => acc + value, 0) / nums.length
}

const buildReplayDayTypeSignalsFromBaselineRows = ({
  d1Row,
  d2Row
}) => {
  if (d1Row?.ruleDayTypeSignalSnapshot && typeof d1Row.ruleDayTypeSignalSnapshot === "object") {
    return d1Row.ruleDayTypeSignalSnapshot
  }
  if (d2Row?.ruleDayTypeSignalSnapshot && typeof d2Row.ruleDayTypeSignalSnapshot === "object") {
    return d2Row.ruleDayTypeSignalSnapshot
  }
  if (d1Row?.ruleDayTypeSignals && typeof d1Row.ruleDayTypeSignals === "object") {
    return d1Row.ruleDayTypeSignals
  }
  if (d2Row?.ruleDayTypeSignals && typeof d2Row.ruleDayTypeSignals === "object") {
    return d2Row.ruleDayTypeSignals
  }
  if (d1Row?.dayTypeSignalSnapshot && typeof d1Row.dayTypeSignalSnapshot === "object") {
    return d1Row.dayTypeSignalSnapshot
  }
  if (d2Row?.dayTypeSignalSnapshot && typeof d2Row.dayTypeSignalSnapshot === "object") {
    return d2Row.dayTypeSignalSnapshot
  }
  if (d1Row?.dayTypeSignals && typeof d1Row.dayTypeSignals === "object") {
    return d1Row.dayTypeSignals
  }
  if (d2Row?.dayTypeSignals && typeof d2Row.dayTypeSignals === "object") {
    return d2Row.dayTypeSignals
  }
  const ranked = Array.isArray(d1Row?.rankedCandidates) ? d1Row.rankedCandidates : []
  const selected = Array.isArray(d2Row?.selectedCandidates) ? d2Row.selectedCandidates : []
  const sample = ranked.length > 0 ? ranked : selected
  const top1 = ranked[0] ?? selected[0] ?? null
  const pHitValues = sample
    .map((row) => row?.pHitCalibrated ?? row?.targetRate3d)
    .filter((value) => Number.isFinite(Number(value)))
  const pFillValues = sample
    .map((row) => row?.pFillCalibrated)
    .filter((value) => Number.isFinite(Number(value)))
  const slippageValues = sample
    .map((row) => row?.slippageRisk)
    .filter((value) => Number.isFinite(Number(value)))
  const liquidityValues = sample
    .map((row) => row?.avgTradingValue20dKrw)
    .filter((value) => Number.isFinite(Number(value)) && Number(value) > 0)
  const strongCandidateCount = ranked.filter((row) => {
    const quality = Number(row?.qualityScore ?? 0) || 0
    const expectedRet = Number(row?.expectedNetRet3d ?? 0) || 0
    const margin = Number(row?.gateScoreMargin ?? row?.postRerankScoreMargin ?? row?.rawScoreMargin ?? 0) || 0
    const pHit = Number(row?.pHitCalibrated ?? row?.targetRate3d ?? 0) || 0
    return quality >= 0.64 && expectedRet >= 0.01 && margin >= 0.0035 && pHit >= 0.62
  }).length
  const lowFillCount = ranked.filter((row) => (Number(row?.pFillCalibrated ?? 1) || 1) < 0.75).length
  const lowLiquidityCount = ranked.filter((row) => {
    const v = Number(row?.avgTradingValue20dKrw ?? 0) || 0
    return v > 0 && v < 1_200_000_000
  }).length
  return {
    sampleSize: ranked.length || selected.length || 0,
    top1Margin: Number(
      d1Row?.top1GateScoreMargin ??
        top1?.gateScoreMargin ??
        top1?.postRerankScoreMargin ??
        top1?.rawScoreMargin ??
        0,
    ) || 0,
    top1QualityScore: Number(top1?.qualityScore ?? 0) || 0,
    top1ExpectedNetRet3d: Number(top1?.expectedNetRet3d ?? 0) || 0,
    avgPHit: average(pHitValues),
    avgFillProb: average(pFillValues),
    avgSlippageRisk: average(slippageValues),
    medianLiquidityKrw: median(liquidityValues),
    strongCandidateShare: ranked.length > 0 ? strongCandidateCount / ranked.length : 0,
    lowFillShare: ranked.length > 0 ? lowFillCount / ranked.length : 0,
    lowLiquidityShare: ranked.length > 0 ? lowLiquidityCount / ranked.length : 0
  }
}

const buildReplayDayTypeModelFeaturesFromBaselineRows = ({
  d1Row,
  d2Row,
  signals
}) => {
  if (d1Row?.ruleDayTypeModelFeatures && typeof d1Row.ruleDayTypeModelFeatures === "object") {
    return d1Row.ruleDayTypeModelFeatures
  }
  if (d2Row?.ruleDayTypeModelFeatures && typeof d2Row.ruleDayTypeModelFeatures === "object") {
    return d2Row.ruleDayTypeModelFeatures
  }
  if (d1Row?.dayTypeModelFeatures && typeof d1Row.dayTypeModelFeatures === "object") {
    return d1Row.dayTypeModelFeatures
  }
  if (d2Row?.dayTypeModelFeatures && typeof d2Row.dayTypeModelFeatures === "object") {
    return d2Row.dayTypeModelFeatures
  }
  return extractDayTypeModelFeatures({
    signals: signals && typeof signals === "object" ? signals : {}
  })
}

const hydrateReplayCandidateFromAudit = ({
  candidate,
  seedBySymbol,
  seriesMap,
  openPositionSkippedByPolicy = false
}) => {
  if (!candidate || typeof candidate !== "object") return null
  const symbol = String(candidate?.symbol ?? "").trim().toUpperCase()
  if (!symbol) return null
  const seed = seedBySymbol?.get?.(symbol) ?? null
  const series = seriesMap?.get?.(symbol) ?? null
  const decisionIdx = Number(candidate?.decisionIdx ?? seed?.decisionIdx)
  if (!Array.isArray(series) || !Number.isInteger(decisionIdx)) return null
  return {
    ...candidate,
    symbol,
    name: String(candidate?.name ?? symbol),
    decisionIdx,
    series,
    score: candidate?.finalScore ?? candidate?.rankerScore ?? null,
    baseScore: candidate?.finalScore ?? candidate?.rankerScore ?? null,
    executionDecision: openPositionSkippedByPolicy ? "SKIP_OPEN_POSITION_HOLD" : candidate?.executionDecision,
    executionShadowReason: openPositionSkippedByPolicy
      ? "OPEN_POSITION_ACTIVE"
      : (candidate?.executionShadowReason ?? candidate?.executionShadowReasonPreFalsePositive ?? null),
    openPositionSkippedByPolicy
  }
}

const summarizeCandidateFieldCounts = (rows, field) => {
  const counts = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.[field] ?? "").trim()
    if (!key) continue
    counts[key] = Number(counts[key] ?? 0) + 1
  }
  return counts
}

const hasAuditValue = (value) => {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === "object") return Object.keys(value).length > 0
  if (typeof value === "string") return value.trim().length > 0
  return value !== null && value !== undefined
}

const pickFirstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim()
    if (text) return text
  }
  return null
}

const pickFirstObject = (...values) => {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value
    }
  }
  return null
}

const pickFirstArray = (...values) => {
  for (const value of values) {
    if (Array.isArray(value)) return value
  }
  return null
}

const resolveAuditSignalSnapshot = ({
  d1Row,
  d2Row,
  snapshotField,
  signalsField
}) =>
  pickFirstObject(
    d1Row?.[snapshotField],
    d2Row?.[snapshotField],
    d1Row?.[signalsField],
    d2Row?.[signalsField],
  ) ?? {}

const resolveAuditModelFeatures = ({
  d1Row,
  d2Row,
  field,
  signals
}) =>
  pickFirstObject(d1Row?.[field], d2Row?.[field]) ??
  extractDayTypeModelFeatures({
    signals: signals && typeof signals === "object" ? signals : {}
  })

const hasRuleDayTypeAudit = ({
  d1Row,
  d2Row
}) =>
  [
    d1Row?.ruleDayType,
    d2Row?.ruleDayType,
    d1Row?.ruleDayTypeNoTrade,
    d2Row?.ruleDayTypeNoTrade,
    d1Row?.ruleDayTypeGateReason,
    d2Row?.ruleDayTypeGateReason,
    d1Row?.ruleDayTypePolicySource,
    d2Row?.ruleDayTypePolicySource,
    d1Row?.ruleDayTypeReasonCodes,
    d2Row?.ruleDayTypeReasonCodes,
    d1Row?.ruleDayTypeSignalSnapshot,
    d2Row?.ruleDayTypeSignalSnapshot,
    d1Row?.ruleDayTypeSignals,
    d2Row?.ruleDayTypeSignals,
    d1Row?.ruleDayTypeModelFeatures,
    d2Row?.ruleDayTypeModelFeatures
  ].some(hasAuditValue)

const buildDayTypeDecisionFromAuditRows = ({ d1Row, d2Row }) => {
  const signals = resolveAuditSignalSnapshot({
    d1Row,
    d2Row,
    snapshotField: "dayTypeSignalSnapshot",
    signalsField: "dayTypeSignals"
  })
  const dayTypeModelFeatures = resolveAuditModelFeatures({
    d1Row,
    d2Row,
    field: "dayTypeModelFeatures",
    signals
  })
  const dayTypeModelPredicted = pickFirstText(
    d1Row?.dayTypeModelPredicted,
    d2Row?.dayTypeModelPredicted,
  )
  const dayTypeModelApplyMode = pickFirstText(
    d1Row?.dayTypeModelApplyMode,
    d2Row?.dayTypeModelApplyMode,
  )
  const dayTypeModelShadowReason = pickFirstText(
    d1Row?.dayTypeModelShadowReason,
    d2Row?.dayTypeModelShadowReason,
  )
  const dayTypeModelConfidenceBucket = pickFirstText(
    d1Row?.dayTypeModelConfidenceBucket,
    d2Row?.dayTypeModelConfidenceBucket,
  )
  const dayTypeShadowNoTrade =
    d1Row?.dayTypeShadowNoTrade === true || d2Row?.dayTypeShadowNoTrade === true
  const decision = {
    dayType: pickFirstText(d1Row?.dayType, d2Row?.dayType) ?? "BALANCED",
    noTrade: d1Row?.dayTypeNoTrade === true || d2Row?.dayTypeNoTrade === true,
    gateReason: d1Row?.dayTypeGateReason ?? d2Row?.dayTypeGateReason ?? null,
    reasonCodes: pickFirstArray(d1Row?.dayTypeReasonCodes, d2Row?.dayTypeReasonCodes) ?? [],
    policySource:
      d1Row?.dayTypePolicySource ??
      d2Row?.dayTypePolicySource ??
      "STEP_D_LOCKBOX_AUDIT",
    signals,
    dayTypeModelFeatures,
    shadowNoTrade: dayTypeShadowNoTrade,
    modelDecision: {
      predictedDayType: dayTypeModelPredicted
    },
    modelMeta: {
      applyMode: dayTypeModelApplyMode,
      shadowReason: dayTypeModelShadowReason,
      confidenceBucket: dayTypeModelConfidenceBucket,
      shadowNoTrade: dayTypeShadowNoTrade
    }
  }
  const ruleAuditAvailable = hasRuleDayTypeAudit({ d1Row, d2Row })
  const ruleSignals = resolveAuditSignalSnapshot({
    d1Row,
    d2Row,
    snapshotField: "ruleDayTypeSignalSnapshot",
    signalsField: "ruleDayTypeSignals"
  })
  const effectiveRuleSignals =
    ruleAuditAvailable && Object.keys(ruleSignals).length > 0 ? ruleSignals : signals
  const ruleDayTypeModelFeatures = resolveAuditModelFeatures({
    d1Row,
    d2Row,
    field: "ruleDayTypeModelFeatures",
    signals: effectiveRuleSignals
  })
  return {
    dayTypeDecision: decision,
    ruleDayTypeDecision: ruleAuditAvailable
      ? {
        dayType: pickFirstText(d1Row?.ruleDayType, d2Row?.ruleDayType, decision.dayType) ?? "BALANCED",
        noTrade: d1Row?.ruleDayTypeNoTrade === true || d2Row?.ruleDayTypeNoTrade === true,
        gateReason: d1Row?.ruleDayTypeGateReason ?? d2Row?.ruleDayTypeGateReason ?? decision.gateReason ?? null,
        reasonCodes:
          pickFirstArray(d1Row?.ruleDayTypeReasonCodes, d2Row?.ruleDayTypeReasonCodes) ??
          decision.reasonCodes ??
          [],
        policySource:
          pickFirstText(d1Row?.ruleDayTypePolicySource, d2Row?.ruleDayTypePolicySource) ??
          "STEP_D_LOCKBOX_AUDIT_RULE",
        signals: effectiveRuleSignals,
        dayTypeModelFeatures: ruleDayTypeModelFeatures
      }
      : {
        ...decision,
        policySource: "STEP_D_LOCKBOX_AUDIT"
      }
  }
}

const buildLockboxDecisionFromAuditRows = ({
  decisionDateKey,
  d1Row,
  d2Row,
  seriesMap,
  maxNewEntriesPerDay = 1
}) => {
  const rankedCandidates = Array.isArray(d1Row?.rankedCandidates) ? d1Row.rankedCandidates : []
  const selectedCandidates = Array.isArray(d2Row?.selectedCandidates) ? d2Row.selectedCandidates : []
  const selectedBySymbol = new Map(
    selectedCandidates.map((candidate) => [
      String(candidate?.symbol ?? "").trim().toUpperCase(),
      candidate
    ]),
  )
  const rankedBySymbol = new Map(
    rankedCandidates.map((candidate) => [
      String(candidate?.symbol ?? "").trim().toUpperCase(),
      candidate
    ]),
  )
  const hydrateCandidate = (candidate) =>
    hydrateReplayCandidateFromAudit({
      candidate,
      seedBySymbol: null,
      seriesMap
    })

  const top = rankedCandidates
    .map((candidate) =>
      hydrateCandidate({
        ...(candidate && typeof candidate === "object" ? candidate : {}),
        ...(selectedBySymbol.get(String(candidate?.symbol ?? "").trim().toUpperCase()) ?? {})
      }),
    )
    .filter(Boolean)
  const pickedSymbols = Array.isArray(d1Row?.pickedSymbols) ? d1Row.pickedSymbols : []
  const picks = pickedSymbols
    .map((symbolRaw) => {
      const symbol = String(symbolRaw ?? "").trim().toUpperCase()
      if (!symbol) return null
      const candidate = selectedBySymbol.get(symbol) ?? rankedBySymbol.get(symbol) ?? null
      if (!candidate) {
        throw new Error(`Missing picked candidate audit row for ${decisionDateKey}/${symbol}`)
      }
      return hydrateCandidate(candidate)
    })
    .filter(Boolean)
  const executedSymbols = Array.isArray(d2Row?.executedSymbols) ? d2Row.executedSymbols : []
  const executedPicksRaw = executedSymbols
    .map((symbolRaw) => {
      const symbol = String(symbolRaw ?? "").trim().toUpperCase()
      if (!symbol) return null
      const candidate = selectedBySymbol.get(symbol) ?? null
      if (!candidate) {
        throw new Error(`Missing executed candidate audit row for ${decisionDateKey}/${symbol}`)
      }
      return hydrateCandidate(candidate)
    })
    .filter(Boolean)
  const executedPicks = executedPicksRaw.slice(0, Math.max(1, Number(maxNewEntriesPerDay ?? 1) || 1))
  const { dayTypeDecision, ruleDayTypeDecision } = buildDayTypeDecisionFromAuditRows({
    d1Row,
    d2Row
  })
  const d1 = {
    top,
    picks,
    pick: picks[0] ?? null,
    selectionCount: Math.max(0, Number(d1Row?.pickCount ?? picks.length) || 0),
    selectedRankerScore: Number(top?.[0]?.rankerScore ?? top?.[0]?.finalScore ?? top?.[0]?.score ?? 0) || 0,
    gate: {
      gateReason: String(d1Row?.gateReason ?? "UNKNOWN"),
      selectionPolicy:
        d1Row?.selectionPolicy && typeof d1Row.selectionPolicy === "object"
          ? d1Row.selectionPolicy
          : { mode: "UNKNOWN", applied: false }
    },
    rerankDecision:
      d1Row?.rerankDecision && typeof d1Row.rerankDecision === "object"
        ? {
            ...d1Row.rerankDecision,
            top
          }
        : {
            applied: false,
            top
          },
    orderingTrace:
      d1Row?.orderingTrace && typeof d1Row.orderingTrace === "object"
        ? d1Row.orderingTrace
        : null,
    top1Path:
      d1Row?.top1Path && typeof d1Row.top1Path === "object"
        ? d1Row.top1Path
        : null,
    inversionAdjusted:
      d1Row?.inversionAdjusted && typeof d1Row.inversionAdjusted === "object"
        ? {
            ...d1Row.inversionAdjusted,
            rows: top
          }
        : {
            applied: false,
            rows: top
          }
  }
  const d2 = {
    executedPicks,
    executedPicksRawCount: executedPicksRaw.length,
    executedPicksAcceptedCount: executedPicks.length,
    executedPick: executedPicks[0] ?? null,
    preFalsePositiveApprovedCount: Math.max(
      0,
      Number(d2Row?.preFalsePositiveApprovedCount ?? 0) || 0,
    ),
    executionBlockedCount: Math.max(0, Number(d2Row?.blockedCount ?? 0) || 0),
    executionDecisionCounts:
      d2Row?.decisionCounts && typeof d2Row.decisionCounts === "object"
        ? d2Row.decisionCounts
        : {},
    executionShadowReasonCounts:
      d2Row?.shadowReasonCounts && typeof d2Row.shadowReasonCounts === "object"
        ? d2Row.shadowReasonCounts
        : {},
    falsePositiveDecisionCounts:
      d2Row?.falsePositiveDecisionCounts && typeof d2Row.falsePositiveDecisionCounts === "object"
        ? d2Row.falsePositiveDecisionCounts
        : {},
    falsePositiveReasonCounts:
      d2Row?.falsePositiveReasonCounts && typeof d2Row.falsePositiveReasonCounts === "object"
        ? d2Row.falsePositiveReasonCounts
        : {},
    falsePositiveRejectedCount: Math.max(
      0,
      Number(d2Row?.falsePositiveRejectedCount ?? 0) || 0,
    ),
    falsePositiveRejectedHitCount: Math.max(
      0,
      Number(d2Row?.falsePositiveRejectedHitCount ?? 0) || 0,
    ),
    falsePositiveRejectedMissCount: Math.max(
      0,
      Number(d2Row?.falsePositiveRejectedMissCount ?? 0) || 0,
    ),
    budgetDecisionCounts:
      d2Row?.budgetDecisionCounts && typeof d2Row.budgetDecisionCounts === "object"
        ? d2Row.budgetDecisionCounts
        : {},
    budgetReasonCounts:
      d2Row?.budgetReasonCounts && typeof d2Row.budgetReasonCounts === "object"
        ? d2Row.budgetReasonCounts
        : {},
    budgetRejectedCount: Math.max(0, Number(d2Row?.budgetRejectedCount ?? 0) || 0),
    budgetRejectedHitCount: Math.max(0, Number(d2Row?.budgetRejectedHitCount ?? 0) || 0),
    budgetRejectedMissCount: Math.max(0, Number(d2Row?.budgetRejectedMissCount ?? 0) || 0),
    metaDecisionCounts: summarizeCandidateFieldCounts(selectedCandidates, "metaDecision")
  }
  return {
    dayTypeDecision,
    ruleDayTypeDecision,
    d1,
    d2
  }
}

const buildSyntheticMissingLockboxAuditRows = ({
  decisionDateKey,
  d1Row,
  d2Row
}) => ({
  d1Row: d1Row && typeof d1Row === "object"
    ? d1Row
    : {
        decisionDateKey,
        top1Symbol: null,
        rankedCandidates: [],
        pickedSymbols: [],
        pickCount: 0,
        gateReason: "MISSING_LOCKBOX_AUDIT_NO_CANDIDATE",
        selectionPolicy: {
          mode: "MISSING_LOCKBOX_AUDIT",
          applied: false
        },
        dayType: "BALANCED",
        dayTypeNoTrade: false,
        dayTypePolicySource: "STEP_D_LOCKBOX_AUDIT_MISSING"
      },
  d2Row: d2Row && typeof d2Row === "object"
    ? d2Row
    : {
        decisionDateKey,
        selectedCandidates: [],
        executedSymbols: [],
        blockedCount: 0,
        preFalsePositiveApprovedCount: 0,
        decisionCounts: {},
        shadowReasonCounts: {},
        falsePositiveDecisionCounts: {},
        falsePositiveReasonCounts: {},
        falsePositiveRejectedCount: 0,
        falsePositiveRejectedHitCount: 0,
        falsePositiveRejectedMissCount: 0,
        budgetDecisionCounts: {},
        budgetReasonCounts: {},
        budgetRejectedCount: 0,
        budgetRejectedHitCount: 0,
        budgetRejectedMissCount: 0
      }
})

const buildReplayRowsForOpenPositionSkip = ({
  decisionDateKey,
  seeds,
  seriesMap,
  d1BaselineByDate,
  d2BaselineByDate,
  entryRule,
  holdDays,
  targetPct,
  stopLossPct,
  costPct
}) => {
  const baselineD1Row = d1BaselineByDate.get(String(decisionDateKey))
  const baselineD2Row = d2BaselineByDate.get(String(decisionDateKey))
  if (!baselineD1Row || !baselineD2Row) return []
  const seedBySymbol = buildSeedLookupBySymbol(seeds)
  const replayDayTypeModelPredicted =
    String(
      baselineD1Row?.dayTypeModelPredicted ?? baselineD2Row?.dayTypeModelPredicted ?? "",
    ).trim() || null
  const replayDayTypeModelApplyMode =
    String(
      baselineD1Row?.dayTypeModelApplyMode ?? baselineD2Row?.dayTypeModelApplyMode ?? "",
    ).trim() || null
  const replayDayTypeModelShadowReason =
    String(
      baselineD1Row?.dayTypeModelShadowReason ?? baselineD2Row?.dayTypeModelShadowReason ?? "",
    ).trim() || null
  const replayDayTypeModelConfidenceBucket =
    String(
      baselineD1Row?.dayTypeModelConfidenceBucket ??
        baselineD2Row?.dayTypeModelConfidenceBucket ??
        "",
    ).trim() || null
  const replayDayTypeShadowNoTrade =
    baselineD1Row?.dayTypeShadowNoTrade === true || baselineD2Row?.dayTypeShadowNoTrade === true
  const dayTypeDecision = {
    dayType: String(baselineD1Row?.dayType ?? baselineD2Row?.dayType ?? "BALANCED"),
    noTrade: baselineD1Row?.dayTypeNoTrade === true || baselineD2Row?.dayTypeNoTrade === true,
    policySource:
      baselineD1Row?.dayTypePolicySource ??
      baselineD2Row?.dayTypePolicySource ??
      "STEP_D_BASELINE_AUDIT",
    shadowNoTrade: replayDayTypeShadowNoTrade,
    modelDecision: {
      predictedDayType: replayDayTypeModelPredicted
    },
    modelMeta: {
      applyMode: replayDayTypeModelApplyMode,
      shadowReason: replayDayTypeModelShadowReason,
      confidenceBucket: replayDayTypeModelConfidenceBucket,
      shadowNoTrade: replayDayTypeShadowNoTrade
    }
  }
  const replayDayTypeSignals = buildReplayDayTypeSignalsFromBaselineRows({
    d1Row: baselineD1Row,
    d2Row: baselineD2Row
  })
  const replayDayTypeModelFeatures = buildReplayDayTypeModelFeaturesFromBaselineRows({
    d1Row: baselineD1Row,
    d2Row: baselineD2Row,
    signals: replayDayTypeSignals
  })
  const ruleDayTypeDecision = {
    dayType:
      pickFirstText(baselineD1Row?.ruleDayType, baselineD2Row?.ruleDayType, dayTypeDecision.dayType) ??
      "BALANCED",
    noTrade: baselineD1Row?.ruleDayTypeNoTrade === true || baselineD2Row?.ruleDayTypeNoTrade === true,
    gateReason:
      baselineD1Row?.ruleDayTypeGateReason ?? baselineD2Row?.ruleDayTypeGateReason ?? null,
    reasonCodes:
      pickFirstArray(baselineD1Row?.ruleDayTypeReasonCodes, baselineD2Row?.ruleDayTypeReasonCodes) ??
      [],
    policySource: `REPLAY_${String(
      pickFirstText(
        baselineD1Row?.ruleDayTypePolicySource,
        baselineD2Row?.ruleDayTypePolicySource,
        "STEP_D_BASELINE_AUDIT_RULE",
      ),
    )}`,
    signals: replayDayTypeSignals,
    dayTypeModelFeatures: replayDayTypeModelFeatures
  }
  const top1Symbol = String(baselineD1Row?.top1Symbol ?? "").trim().toUpperCase()
  const rankedCandidates = Array.isArray(baselineD1Row?.rankedCandidates)
    ? baselineD1Row.rankedCandidates
    : []
  const selectedCandidates = Array.isArray(baselineD2Row?.selectedCandidates)
    ? baselineD2Row.selectedCandidates
    : []
  const selectedBySymbol = new Map(
    selectedCandidates.map((candidate) => [String(candidate?.symbol ?? "").trim().toUpperCase(), candidate]),
  )
  const top1Candidate = rankedCandidates.find(
    (candidate) => String(candidate?.symbol ?? "").trim().toUpperCase() === top1Symbol,
  )
  const d1 = {
    top: top1Symbol ? [{ symbol: top1Symbol }] : [],
    gate: { gateReason: "OPEN_POSITION_ACTIVE" },
    orderingTrace:
      baselineD1Row?.orderingTrace && typeof baselineD1Row.orderingTrace === "object"
        ? baselineD1Row.orderingTrace
        : null,
    top1Path:
      baselineD1Row?.top1Path && typeof baselineD1Row.top1Path === "object"
        ? baselineD1Row.top1Path
        : null
  }
  const d2 = {
    executionDecisionCounts: baselineD2Row?.decisionCounts ?? {}
  }
  const rows = []
  const top1Hydrated = hydrateReplayCandidateFromAudit({
    candidate: top1Candidate,
    seedBySymbol,
    seriesMap,
    openPositionSkippedByPolicy: true
  })
  if (top1Hydrated) {
    const top1ReplayRow = buildReplayFeedbackRow({
      decisionDateKey,
      row: top1Hydrated,
      candidateRole: "TOP1",
      selectedByPolicy: selectedBySymbol.has(top1Symbol),
      executedByPolicy: false,
      openPositionSkippedByPolicy: true,
      ruleDayTypeDecision,
      dayTypeDecision,
      d1,
      d2,
      entryRule,
      holdDays,
      targetPct,
      stopLossPct,
      costPct
    })
    if (top1ReplayRow) rows.push(top1ReplayRow)
  }
  for (const selectedCandidate of selectedCandidates) {
    const hydrated = hydrateReplayCandidateFromAudit({
      candidate: selectedCandidate,
      seedBySymbol,
      seriesMap,
      openPositionSkippedByPolicy: true
    })
    if (!hydrated) continue
    const pickReplayRow = buildReplayFeedbackRow({
      decisionDateKey,
      row: hydrated,
      candidateRole: "PICK",
      selectedByPolicy: true,
      executedByPolicy: false,
      openPositionSkippedByPolicy: true,
      ruleDayTypeDecision,
      dayTypeDecision,
      d1,
      d2,
      entryRule,
      holdDays,
      targetPct,
      stopLossPct,
      costPct
    })
    if (pickReplayRow) rows.push(pickReplayRow)
  }
  return rows
}

export const runStepE = async (ctx) => {
  const outDir = path.join(ctx.runDir, "step-e")
  await ensureDir(outDir)
  const stepERunMode = String(ctx.__runtime?.stepERunMode ?? "default").trim().toLowerCase()
  const diagnosticMode =
    stepERunMode === "smoke" || stepERunMode === "exploratory"
      ? "exploratory"
      : "final_diagnostics"
  const preferLightDiagnostics =
    diagnosticMode === "exploratory" && ctx.__runtime?.stepEWriteFullDiagnostics !== true
  const runtimeStepDArtifacts = ctx.__runtime?.stepDLockboxArtifacts ?? null
  const runtimeStepCArtifacts =
    runtimeStepDArtifacts?.stepCRuntimeArtifacts &&
    typeof runtimeStepDArtifacts.stepCRuntimeArtifacts === "object"
      ? runtimeStepDArtifacts.stepCRuntimeArtifacts
      : (
          ctx.__runtime?.stepCRuntimeArtifacts &&
          typeof ctx.__runtime.stepCRuntimeArtifacts === "object"
            ? ctx.__runtime.stepCRuntimeArtifacts
            : null
        )
  const stepCLibraryDir =
    String(ctx.__runtime?.stepCLibraryDirOverride ?? "").trim() || path.join(ctx.runDir, "step-c")
  const libraryPath = path.join(stepCLibraryDir, "pattern_library.json")
  const runtimePath = path.join(stepCLibraryDir, "pattern_library_runtime.json")
  const canReuseSharedStepC =
    runtimeStepCArtifacts &&
    typeof runtimeStepCArtifacts === "object" &&
    runtimeStepCArtifacts?.libraryObject &&
    runtimeStepCArtifacts?.runtimeMetaObject &&
    (
      ctx.__runtime?.reuseStepCRuntimeAcrossRunDirs === true ||
      (
        String(runtimeStepCArtifacts?.libraryPath ?? "").trim() === libraryPath &&
        String(runtimeStepCArtifacts?.runtimePath ?? "").trim() === runtimePath
      )
    )
  const library = canReuseSharedStepC
    ? runtimeStepCArtifacts.libraryObject
    : await readJson(libraryPath, null)
  if (!library) {
    throw new Error("pattern_library.json not found. Run step-c first.")
  }

  const runtimeMeta =
    canReuseSharedStepC
      ? runtimeStepCArtifacts.runtimeMetaObject
      : await readJson(runtimePath, null)
  if (!runtimeMeta) {
    throw new Error("pattern_library_runtime.json not found. Run step-c first.")
  }
  if (String(runtimeMeta?.mode ?? "").trim().toLowerCase() !== "hybrid_150_40") {
    throw new Error(`Unsupported runtime mode: ${runtimeMeta?.mode}. Expected: hybrid_150_40`)
  }

  const stepDSummaryPath = path.join(ctx.runDir, "step-d", "step_d_summary.json")
  const policyStatePath = path.join(ctx.runDir, "step-d", "step_d_policy_state.json")
  const weightsFinalPath = path.join(ctx.runDir, "step-d", "weights_final.json")
  const stepDSummary =
    runtimeStepDArtifacts?.stepDSummaryObject && typeof runtimeStepDArtifacts.stepDSummaryObject === "object"
      ? runtimeStepDArtifacts.stepDSummaryObject
      : await readJson(stepDSummaryPath, {})
  const policyState =
    runtimeStepDArtifacts?.policyStateObject && typeof runtimeStepDArtifacts.policyStateObject === "object"
      ? runtimeStepDArtifacts.policyStateObject
      : await readJson(policyStatePath, null)
  if (!policyState) {
    throw new Error("step_d_policy_state.json not found. Run step-d with policy-state output before step-e.")
  }

  const candidateIndexPath = path.join(ctx.runDir, "step-d", "decision_candidates_index.jsonl")
  const featurePackPath = path.join(ctx.runDir, "step-d", "decision_candidates_feature_pack.jsonl")
  const d1BaselineAuditPath = path.join(ctx.runDir, "step-d", "d1_ranked_candidates.jsonl")
  const d2BaselineAuditPath = path.join(ctx.runDir, "step-d", "d2_execution_audit.jsonl")
  const d1LockboxBaselineAuditPath = path.join(ctx.runDir, "step-d", "d1_lockbox_ranked_candidates.jsonl")
  const d2LockboxBaselineAuditPath = path.join(ctx.runDir, "step-d", "d2_lockbox_execution_audit.jsonl")
  const hasRuntimeLockboxAudits =
    Array.isArray(runtimeStepDArtifacts?.d1LockboxAuditRows) &&
    Array.isArray(runtimeStepDArtifacts?.d2LockboxAuditRows)
  if (!hasRuntimeLockboxAudits && (!pathExists(d1LockboxBaselineAuditPath) || !pathExists(d2LockboxBaselineAuditPath))) {
    throw new Error(
      [
        "step-d lockbox audit artifacts are missing.",
        "Required: d1_lockbox_ranked_candidates.jsonl and d2_lockbox_execution_audit.jsonl.",
        "Run step-d first. Step E now consumes the canonical Step-D lockbox audit output."
      ].join(" "),
    )
  }
  const weightsJson =
    runtimeStepDArtifacts?.finalWeightsObject && typeof runtimeStepDArtifacts.finalWeightsObject === "object"
      ? runtimeStepDArtifacts.finalWeightsObject
      : await readJson(weightsFinalPath, null)
  const weights = policyState?.finalWeights
    ? requireWeightObject(policyState.finalWeights, "policyState.finalWeights")
    : resolveFinalWeights(weightsJson)

  let seriesMap = ctx.__runtime?.stepDEBase?.seriesMap ?? null
  let allDateKeys = ctx.__runtime?.stepDEBase?.allDateKeys ?? null
  if (!seriesMap || !allDateKeys) {
    const data = await loadStepDEData(ctx.config.dataPaths, {
      includeUniverse: false,
      includeSymbolMaster: false,
      includeHourly60m: false,
    })
    seriesMap = buildCandleSeriesMap(data.candles)
    allDateKeys = uniqueSortedDateKeys(data.candles, "dateKey")
    releaseRows(data.candles)
  }

  const lockboxDates = (Array.isArray(allDateKeys) ? allDateKeys : []).filter((d) =>
    isInRange(d, ctx.periods.lockbox),
  )
  const topK = Math.max(1, Number(ctx.config.similarity.topK ?? 10))
  const holdDays = Math.max(1, Number(ctx.config.backtest.holdDays ?? 3))
  const targetPct = Number(ctx.config.backtest.targetPct ?? 0.08)
  const stopLossPct = Number(ctx.config.backtest.stopLossPct ?? 0.04)
  const feeBps = Number(ctx.config.backtest.feeBps ?? 0)
  const slippageBps = Number(ctx.config.backtest.slippageBps ?? 0)
  const costPct = (feeBps + slippageBps) / 10000
  const entryRule = resolveEntryRule(ctx.config.backtest?.entry)
  const localWindow = resolveLocalWindow(ctx.config)
  const globalWindow = resolveGlobalWindow(ctx.config)
  const minWindow = Math.max(localWindow, globalWindow)
  const scorerVersion = resolveScorerVersion(ctx.config.similarity?.scorerVersion)
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
  const d1BaselineAuditRowsRaw =
    preferLightDiagnostics && !Array.isArray(runtimeStepDArtifacts?.d1EvalAuditRows)
      ? []
      : Array.isArray(runtimeStepDArtifacts?.d1EvalAuditRows)
        ? runtimeStepDArtifacts.d1EvalAuditRows
        : (pathExists(d1BaselineAuditPath)
          ? await readJsonl(d1BaselineAuditPath)
          : [])
  const d2BaselineAuditRowsRaw =
    preferLightDiagnostics && !Array.isArray(runtimeStepDArtifacts?.d2EvalAuditRows)
      ? []
      : Array.isArray(runtimeStepDArtifacts?.d2EvalAuditRows)
        ? runtimeStepDArtifacts.d2EvalAuditRows
        : (pathExists(d2BaselineAuditPath)
          ? await readJsonl(d2BaselineAuditPath)
          : [])
  const d1LockboxBaselineAuditRows = Array.isArray(runtimeStepDArtifacts?.d1LockboxAuditRows)
    ? runtimeStepDArtifacts.d1LockboxAuditRows
    : await readJsonl(d1LockboxBaselineAuditPath)
  const d2LockboxBaselineAuditRows = Array.isArray(runtimeStepDArtifacts?.d2LockboxAuditRows)
    ? runtimeStepDArtifacts.d2LockboxAuditRows
    : await readJsonl(d2LockboxBaselineAuditPath)
  if (ctx?.__runtime?.championBundle && !preferLightDiagnostics) {
    const parity = await verifyChampionBundleParity({
      bundle: ctx.__runtime.championBundle,
      loadedStepCLibraryPath: libraryPath,
      loadedStepCRuntimePath: runtimePath,
      loadedPolicyStatePath: policyStatePath,
      loadedWeightsPath: weightsFinalPath,
      loadedAuditPaths: {
        d1RankedCandidatesPath: d1BaselineAuditPath,
        d2ExecutionAuditPath: d2BaselineAuditPath,
        d1LockboxRankedCandidatesPath: d1LockboxBaselineAuditPath,
        d2LockboxExecutionAuditPath: d2LockboxBaselineAuditPath
      }
    })
    if (parity.ok !== true) {
      throw new Error(
        `Champion bundle parity mismatch: ${JSON.stringify(parity.mismatches)}`
      )
    }
  }
  const d1BaselineAuditRows = d1BaselineAuditRowsRaw.filter((row) =>
    isEvalLikePartition(row?.partition),
  )
  const d2BaselineAuditRows = d2BaselineAuditRowsRaw.filter((row) =>
    isEvalLikePartition(row?.partition),
  )
  const d1LockboxBaselineByDate =
    runtimeStepDArtifacts?.d1LockboxBaselineByDate instanceof Map
      ? runtimeStepDArtifacts.d1LockboxBaselineByDate
      : new Map(
          d1LockboxBaselineAuditRows.map((row) => [String(row?.decisionDateKey ?? "").trim(), row]),
        )
  const d2LockboxBaselineByDate =
    runtimeStepDArtifacts?.d2LockboxBaselineByDate instanceof Map
      ? runtimeStepDArtifacts.d2LockboxBaselineByDate
      : new Map(
          d2LockboxBaselineAuditRows.map((row) => [String(row?.decisionDateKey ?? "").trim(), row]),
        )

  const routeWeightsByBucket = new Map()
  const rawRouteWeights = policyState?.routeWeightsByBucket && typeof policyState.routeWeightsByBucket === "object"
    ? policyState.routeWeightsByBucket
    : {}
  for (const [bucket, bucketWeights] of Object.entries(rawRouteWeights)) {
    const key = String(bucket ?? "").trim()
    if (!key) continue
    routeWeightsByBucket.set(key, requireWeightObject(bucketWeights, `policyState.routeWeightsByBucket.${key}`))
  }
  if (!routeWeightsByBucket.has("__DEFAULT__")) {
    throw new Error("policyState.routeWeightsByBucket.__DEFAULT__ missing")
  }

  const postScoreAdjustCfg = resolvePostScoreAdjust(
    policyState?.postScoreAdjust ?? ctx.config.similarity?.postScoreAdjust,
  )
  const decisionGateCfg = resolveDecisionGate(
    policyState?.decisionGate ?? {
      ...ctx.config.decisionGate,
      minTradeScore: ctx.config.similarity?.minTradeScore
    },
  )
  const hitWindowDays = Math.max(1, Number(decisionGateCfg?.hitWindowDays ?? 3) || 3)
  const calibrationCfg = resolveCalibrationConfig(
    policyState?.calibration ?? ctx.config?.decisionGate?.calibration,
  )
  const metaSelectorCfg = resolveMetaSelectorConfig(
    policyState?.metaSelector ?? ctx.config?.decisionGate?.metaSelector,
  )
  const executionGateCfg = resolveExecutionGate(
    policyState?.executionGate ?? ctx.config?.decisionGate?.executionGate,
  )
  const useStopLoss = executionGateCfg?.hitEval?.useStopLoss !== false
  const sameDayTiePolicy = String(executionGateCfg?.hitEval?.sameDayTiePolicy ?? "STOP_WINS")
    .trim()
    .toUpperCase()
  const falsePositiveGateCfg = resolveFalsePositiveGate(
    policyState?.falsePositiveGate ?? ctx.config?.decisionGate?.falsePositiveGate,
  )
  const falsePositiveModelCfg = resolveFalsePositiveModelConfig(
    policyState?.falsePositiveModelConfig ??
      policyState?.falsePositiveModel?.config ??
      ctx.config?.decisionGate?.falsePositiveGate?.model ??
      ctx.config?.decisionGate?.falsePositiveModel,
  )
  const agreementGateModelCfg = resolveAgreementModelConfig(
    policyState?.agreementGateModelConfig ??
      policyState?.decisionGate?.agreementGate?.model ??
      ctx.config?.decisionGate?.agreementGate?.model,
  )
  const dayTypeRouterCfg = resolveDayTypeRouter(
    policyState?.dayTypeRouter ?? ctx.config?.decisionGate?.dayTypeRouter,
  )
  const dayTypeModelCfg = resolveDayTypeModelConfig(
    policyState?.dayTypeModelConfig ??
      policyState?.dayTypeModel?.config ??
      ctx.config?.decisionGate?.dayTypeRouter?.model ??
      ctx.config?.decisionGate?.dayTypeModel,
  )
  const opportunityBudgetCfg = resolveOpportunityBudget(
    policyState?.opportunityBudget ?? ctx.config?.decisionGate?.opportunityBudget,
  )
  const agreementGateModel = policyState?.agreementGateModel ?? null
  const regimeRouterCfg = policyState?.regimeRouter ?? ctx.config?.decisionGate?.regimeRouter ?? {}
  const regimeExpertsCfg = resolveRegimeExpertsConfig(
    policyState?.regimeExperts ?? ctx.config?.decisionGate?.regimeExperts,
  )
  const orderSimulatorCfg = resolveOrderSimulatorConfig(
    policyState?.orderSimulator ?? ctx.config?.decisionGate?.orderSimulator,
  )
  const extendedBiasCfg = policyState?.generalizationExtendedBias ?? {}
  const extendedBiasState = policyState?.extendedBiasState ?? {}
  const routeBiasState = extendedBiasState?.routeBucketBias ?? {}
  const regimeBiasState = extendedBiasState?.regimeBias ?? {}
  const prototypeBiasState = extendedBiasState?.prototypeBias ?? {}
  const policyContractRaw = policyState?.policyContract ?? null
  const policyContract = {
    version: String(policyContractRaw?.version ?? "v5"),
    mode: String(policyContractRaw?.mode ?? "D1_D2_FP_MODEL_DT_MODEL_BUDGET_AGREEMENT"),
    rankerScoreField: String(policyContractRaw?.rankerScoreField ?? "rankerScore"),
    executionScoreField: String(policyContractRaw?.executionScoreField ?? "executionScore"),
    falsePositiveRiskField: String(
      policyContractRaw?.falsePositiveRiskField ?? "falsePositiveRisk",
    ),
    falsePositiveModelRiskField: String(
      policyContractRaw?.falsePositiveModelRiskField ?? "falsePositiveModelRisk",
    ),
    budgetDecisionField: String(
      policyContractRaw?.budgetDecisionField ?? "budgetDecision",
    ),
    agreementScoreField: String(
      policyContractRaw?.agreementScoreField ?? "agreementScore",
    ),
    tauRank: Number(policyContractRaw?.tauRank ?? decisionGateCfg?.minFinalScore ?? 0) || 0,
    tauExec: Number(policyContractRaw?.tauExec ?? executionGateCfg?.targetLcb ?? 0) || 0,
    tauFp: Number(policyContractRaw?.tauFp ?? falsePositiveGateCfg?.maxRisk ?? 1) || 1,
    minAgreementScore: Number(
      policyContractRaw?.minAgreementScore ?? decisionGateCfg?.agreementGate?.minAgreementScore ?? 0,
    ) || 0,
    dayType: String(policyContractRaw?.dayType ?? "BALANCED"),
    budgetMode: String(
      policyContractRaw?.budgetMode ??
        (opportunityBudgetCfg?.enabled === true ? "EXECUTION_BUDGET" : "DISABLED"),
    )
  }
  const falsePositiveState = buildFalsePositiveState({
    stepDSummary: null,
    policyState
  })
  const falsePositiveModel = resolveFalsePositiveModelArtifact({
    policyState,
    stepDSummary: null,
    cfg: falsePositiveModelCfg
  })
  const dayTypeModel = resolveDayTypeModelArtifact({
    policyState,
    stepDSummary: null,
    cfg: dayTypeModelCfg
  })

  const goalMode = resolveGoalMode(ctx.config?.backtest?.goalMode)
  const positionSemantics = resolvePositionSemantics(ctx.config?.backtest?.positionSemantics)
  const singlePosition =
    positionSemantics === "SINGLE_POSITION_V1" &&
    ctx.config.backtest?.singlePosition !== false
  const maxNewEntriesPerDay = Math.max(
    1,
    Math.floor(Number(ctx.config?.backtest?.maxNewEntriesPerDay ?? 1) || 1),
  )
  const lockboxDateToIdx = new Map(lockboxDates.map((dateKey, idx) => [String(dateKey), idx]))
  let nextAvailableDecisionIdx = 0
  let skippedDueToOpenPosition = 0

  const trades = []
  const replayFeedbackRows = []
  const replayFeedbackSeen = new Set()
  let equity = 1
  const curve = [equity]
  let winCount = 0
  let selectionCount = 0
  let executedCount = 0
  let executionApprovedRawCount = 0
  let pickedCount = 0
  let pickedDays = 0
  let targetHitCount = 0
  let stopCount = 0
  let timeoutCount = 0
  let timeoutPositiveCount = 0
  let timeoutNegativeCount = 0
  let timeoutFlatCount = 0
  let coverageRecoveryDays = 0
  let coverageRecoveryHitDays = 0
  let skippedByGate = 0
  let skippedByExecution = 0
  let skippedByDailyEntryCap = 0
  const gateReasonCounts = {}
  const dayTypeCounts = {}
  const dayTypePolicySourceCounts = {}
  let dayTypeNoTradeCount = 0
  let dayTypeNoTradeHitCount = 0
  let dayTypeShadowNoTradeCount = 0
  const dayTypeModelApplyModeCounts = {}
  const dayTypeModelShadowReasonCounts = {}
  const dayTypeModelConfidenceBucketCounts = {}
  let dayTypeModelOverrideCount = 0
  let dayTypeModelShadowCount = 0
  let dayTypeModelAgreeCount = 0
  let dayTypeModelRejectedCount = 0
  const selectionFunnelCounts = {}
  const metaDecisionCounts = {}
  const executionDecisionCounts = {}
  const executionShadowReasonCounts = {}
  const falsePositiveDecisionCounts = {}
  const falsePositiveReasonCounts = {}
  let preFalsePositiveApprovedCount = 0
  let falsePositiveRejectedCount = 0
  let falsePositiveRejectedHitCount = 0
  let falsePositiveRejectedMissCount = 0
  const budgetDecisionCounts = {}
  const budgetReasonCounts = {}
  let budgetRejectedCount = 0
  let budgetRejectedHitCount = 0
  let budgetRejectedMissCount = 0
  const d1LockboxAuditRows = []
  const d2LockboxAuditRows = []
  const traceDiffRows = []
  let traceComparedDays = 0
  let missingLockboxAuditDays = 0
  const traceFieldMismatchCounts = {}
  let traceMismatchDays = 0
  let traceCriticalMismatchDays = 0

  const perfCounters = {
    scorerVersion,
    decisionSource: "STEP_D_LOCKBOX_AUDIT",
    totalCandidatesScored: 0,
    totalPrototypes: 0,
    totalPrototypesAfterCoarse: 0,
    totalPrototypeComparisons: 0,
    prototypesPrunedByGroupBound: 0,
    prototypesPrunedByFeatureBound: 0,
    totalClusters: 0,
    totalClustersConsidered: 0
  }

  const pushReplayFeedbackRow = (row) => {
    const decisionDateKey = String(row?.decisionDateKey ?? "").trim()
    const candidateRole = String(row?.candidateRole ?? "").trim().toUpperCase()
    const symbol = String(row?.symbol ?? "").trim().toUpperCase()
    if (!decisionDateKey || !candidateRole || !symbol) return
    const replayKey = `${decisionDateKey}::${candidateRole}::${symbol}`
    if (replayFeedbackSeen.has(replayKey)) return
    replayFeedbackSeen.add(replayKey)
    replayFeedbackRows.push(row)
  }

  for (let decisionCursor = 0; decisionCursor < lockboxDates.length; decisionCursor += 1) {
    const decisionDateKey = lockboxDates[decisionCursor]
    if (singlePosition && decisionCursor < nextAvailableDecisionIdx) {
      skippedDueToOpenPosition += 1
      const replayRowsForSkip = buildReplayRowsForOpenPositionSkip({
        decisionDateKey,
        seeds: [],
        seriesMap,
        d1BaselineByDate: d1LockboxBaselineByDate,
        d2BaselineByDate: d2LockboxBaselineByDate,
        entryRule,
        holdDays,
        targetPct,
        stopLossPct,
        costPct
      })
      for (const replayRow of replayRowsForSkip) {
        pushReplayFeedbackRow(replayRow)
      }
      continue
    }
    const baselineD1Raw = d1LockboxBaselineByDate.get(String(decisionDateKey)) ?? null
    const baselineD2Raw = d2LockboxBaselineByDate.get(String(decisionDateKey)) ?? null
    const hadCanonicalAuditRows = !!baselineD1Raw && !!baselineD2Raw
    const {
      d1Row: d1BaselineRow,
      d2Row: d2BaselineRow
    } = buildSyntheticMissingLockboxAuditRows({
      decisionDateKey,
      d1Row: baselineD1Raw,
      d2Row: baselineD2Raw
    })
    if (!hadCanonicalAuditRows) {
      missingLockboxAuditDays += 1
    }
    d1LockboxAuditRows.push(d1BaselineRow)
    d2LockboxAuditRows.push(d2BaselineRow)
    if (hadCanonicalAuditRows) {
      traceComparedDays += 1
    }
    const {
      dayTypeDecision,
      ruleDayTypeDecision,
      d1,
      d2
    } = buildLockboxDecisionFromAuditRows({
      decisionDateKey,
      d1Row: d1BaselineRow,
      d2Row: d2BaselineRow,
      seriesMap,
      maxNewEntriesPerDay
    })
    const top = Array.isArray(d1?.top) ? d1.top : []
    const picks = Array.isArray(d1?.picks) ? d1.picks : []
    const top1AgreementDecision = String(top?.[0]?.agreementDecision ?? "").trim()
    const hasTopCandidates = top.length > 0
    const baselineSelectedSymbols = normalizeSymbolSet(d2BaselineRow?.selectedCandidates)
    const replaySelectedSymbols = normalizeSymbolSet(picks)
    const baselineTop1Symbol = String(d1BaselineRow?.top1Symbol ?? "")
      .trim()
      .toUpperCase()
    const replayTop1Symbol = String(top?.[0]?.symbol ?? "")
      .trim()
      .toUpperCase()
    const baselineExecutedSymbol = String(d2BaselineRow?.executedPick?.symbol ?? "")
      .trim()
      .toUpperCase()
    const replayExecutedSymbol = String(d2?.executedPick?.symbol ?? "")
      .trim()
      .toUpperCase()
    const traceMismatches = []
    if (!hadCanonicalAuditRows) {
      traceMismatches.push("auditMissing")
    }
    if (baselineTop1Symbol !== replayTop1Symbol) {
      traceMismatches.push("top1Symbol")
    }
    if (!symbolSetsEqual(baselineSelectedSymbols, replaySelectedSymbols)) {
      traceMismatches.push("selectedSymbols")
    }
    if (baselineExecutedSymbol !== replayExecutedSymbol) {
      traceMismatches.push("executedSymbol")
    }
    if (
      String(d1BaselineRow?.dayType ?? d2BaselineRow?.dayType ?? "").trim() !==
      String(dayTypeDecision?.dayType ?? "").trim()
    ) {
      traceMismatches.push("dayType")
    }
    if (
      Boolean(d1BaselineRow?.dayTypeNoTrade ?? d2BaselineRow?.dayTypeNoTrade) !==
      Boolean(dayTypeDecision?.noTrade)
    ) {
      traceMismatches.push("dayTypeNoTrade")
    }
    if (
      String(d1BaselineRow?.gateReason ?? "").trim() !==
      String(d1?.gate?.gateReason ?? "").trim()
    ) {
      traceMismatches.push("gateReason")
    }
    if (traceMismatches.length > 0) {
      traceMismatchDays += 1
      for (const field of traceMismatches) {
        traceFieldMismatchCounts[field] = Number(traceFieldMismatchCounts[field] ?? 0) + 1
      }
      if (
        traceMismatches.some((field) =>
          field === "auditMissing" ||
          field === "top1Symbol" ||
          field === "selectedSymbols" ||
          field === "executedSymbol",
        )
      ) {
        traceCriticalMismatchDays += 1
      }
      traceDiffRows.push({
        decisionDateKey,
        mismatches: traceMismatches,
        baseline: {
          top1Symbol: baselineTop1Symbol || null,
          selectedSymbols: Array.from(baselineSelectedSymbols.values()),
          executedSymbol: baselineExecutedSymbol || null,
          dayType: d1BaselineRow?.dayType ?? d2BaselineRow?.dayType ?? null,
          dayTypeNoTrade:
            d1BaselineRow?.dayTypeNoTrade === true || d2BaselineRow?.dayTypeNoTrade === true,
          gateReason: d1BaselineRow?.gateReason ?? null
        },
        replay: {
          top1Symbol: replayTop1Symbol || null,
          selectedSymbols: Array.from(replaySelectedSymbols.values()),
          executedSymbol: replayExecutedSymbol || null,
          dayType: dayTypeDecision?.dayType ?? null,
          dayTypeNoTrade: dayTypeDecision?.noTrade === true,
          gateReason: d1?.gate?.gateReason ?? null
        }
      })
    }
    if (hasTopCandidates) {
      bump(selectionFunnelCounts, "TOP_CANDIDATE_DAY")
    } else {
      bump(selectionFunnelCounts, "NO_CANDIDATE_DAY")
    }
    if (hasTopCandidates && dayTypeDecision?.noTrade === true) {
      bump(selectionFunnelCounts, "DAY_TYPE_BLOCKED_DAY")
    } else if (hasTopCandidates) {
      bump(selectionFunnelCounts, "AFTER_DAY_TYPE_DAY")
    }
    if (hasTopCandidates) {
      bump(dayTypeCounts, String(dayTypeDecision?.dayType ?? "BALANCED"))
      bump(dayTypePolicySourceCounts, String(dayTypeDecision?.policySource ?? "RULE"))
      const dayTypeModelApplyMode = String(dayTypeDecision?.modelMeta?.applyMode ?? "RULE_ONLY")
      const dayTypeModelShadowReason = String(dayTypeDecision?.modelMeta?.shadowReason ?? "").trim()
      const dayTypeModelConfidenceBucket = String(
        dayTypeDecision?.modelMeta?.confidenceBucket ?? "UNAVAILABLE",
      )
      bump(dayTypeModelApplyModeCounts, dayTypeModelApplyMode)
      bump(dayTypeModelConfidenceBucketCounts, dayTypeModelConfidenceBucket)
      if (dayTypeModelShadowReason) {
        bump(dayTypeModelShadowReasonCounts, dayTypeModelShadowReason)
      }
      if (
        dayTypeModelApplyMode === "MODEL_OVERRIDE" ||
        dayTypeModelApplyMode === "MODEL_OVERRIDE_AGREE"
      ) {
        dayTypeModelOverrideCount += 1
      }
      if (dayTypeModelApplyMode === "MODEL_SHADOW") {
        dayTypeModelShadowCount += 1
      }
      if (dayTypeModelApplyMode === "MODEL_OVERRIDE_AGREE") {
        dayTypeModelAgreeCount += 1
      } else if (
        dayTypeModelApplyMode === "MODEL_SHADOW" ||
        dayTypeModelApplyMode === "RULE_ONLY" ||
        dayTypeModelApplyMode === "RULE_PREFERRED"
      ) {
        dayTypeModelRejectedCount += 1
      }
      if (dayTypeDecision?.noTrade === true) {
        dayTypeNoTradeCount += 1
        const previewTopHasHit = top.some((row) => row?.successInWindow === true)
        if (previewTopHasHit) dayTypeNoTradeHitCount += 1
      }
      if (
        dayTypeDecision?.modelMeta?.shadowNoTrade === true ||
        dayTypeDecision?.shadowNoTrade === true
      ) {
        dayTypeShadowNoTradeCount += 1
      }
    }
    if (hasTopCandidates && dayTypeDecision?.noTrade !== true) {
      const agreementBlocked =
        top1AgreementDecision && top1AgreementDecision !== "TRADE"
      bump(selectionFunnelCounts, agreementBlocked ? "AGREEMENT_BLOCKED_DAY" : "AFTER_AGREEMENT_DAY")
    }
    bump(gateReasonCounts, d1?.gate?.gateReason ?? d1BaselineRow?.gateReason ?? "UNKNOWN")
    mergeCountMap(metaDecisionCounts, d2.metaDecisionCounts)
    mergeCountMap(executionDecisionCounts, d2.executionDecisionCounts)
    mergeCountMap(executionShadowReasonCounts, d2.executionShadowReasonCounts)
    mergeCountMap(falsePositiveDecisionCounts, d2.falsePositiveDecisionCounts)
    mergeCountMap(falsePositiveReasonCounts, d2.falsePositiveReasonCounts)
    mergeCountMap(budgetDecisionCounts, d2.budgetDecisionCounts)
    mergeCountMap(budgetReasonCounts, d2.budgetReasonCounts)
    preFalsePositiveApprovedCount += Math.max(0, Number(d2?.preFalsePositiveApprovedCount ?? 0) || 0)
    falsePositiveRejectedCount += Math.max(0, Number(d2?.falsePositiveRejectedCount ?? 0) || 0)
    falsePositiveRejectedHitCount += Math.max(0, Number(d2?.falsePositiveRejectedHitCount ?? 0) || 0)
    falsePositiveRejectedMissCount += Math.max(0, Number(d2?.falsePositiveRejectedMissCount ?? 0) || 0)
    budgetRejectedCount += Math.max(0, Number(d2?.budgetRejectedCount ?? 0) || 0)
    budgetRejectedHitCount += Math.max(0, Number(d2?.budgetRejectedHitCount ?? 0) || 0)
    budgetRejectedMissCount += Math.max(0, Number(d2?.budgetRejectedMissCount ?? 0) || 0)
    executionApprovedRawCount += Math.max(0, Number(d2?.executedPicksRawCount ?? 0) || 0)
    skippedByDailyEntryCap += Math.max(
      0,
      (Number(d2?.executedPicksRawCount ?? 0) || 0) -
        (Number(d2?.executedPicksAcceptedCount ?? 0) || 0),
    )
    if (picks.length < 1) {
      if (hasTopCandidates && dayTypeDecision?.noTrade !== true) {
        bump(selectionFunnelCounts, "D1_ZERO_PICK_DAY")
      }
      const top1ReplayRow = buildReplayFeedbackRow({
        decisionDateKey,
        row: top[0] ?? null,
        candidateRole: "TOP1",
        selectedByPolicy: false,
        executedByPolicy: false,
        ruleDayTypeDecision,
        dayTypeDecision,
        d1,
        d2,
        entryRule,
        holdDays,
        targetPct,
        stopLossPct,
        costPct
      })
      if (top1ReplayRow) {
        pushReplayFeedbackRow(top1ReplayRow)
      }
      skippedByGate += 1
      continue
    }
    bump(selectionFunnelCounts, "D1_PICK_DAY")
    selectionCount += d1.selectionCount
    pickedCount += d1.selectionCount
    pickedDays += 1
    const selectionPolicy = d1?.gate?.selectionPolicy ?? {}
    const selectionMode = String(selectionPolicy?.mode ?? "").toUpperCase()
    if (selectionMode === "RECOVERY") {
      coverageRecoveryDays += 1
      const recoveryHit = d1.picks.some((row) => row?.successInWindow === true)
      if (recoveryHit) coverageRecoveryHitDays += 1
    }

    const top1Symbol = String(top?.[0]?.symbol ?? "").trim()
    const executedSymbol = String(d2?.executedPick?.symbol ?? "").trim()
    const selectedSymbols = new Set(picks.map((row) => String(row?.symbol ?? "").trim()))
    const top1ReplayRow = buildReplayFeedbackRow({
      decisionDateKey,
      row: top[0] ?? null,
      candidateRole: "TOP1",
      selectedByPolicy: top1Symbol !== "" && selectedSymbols.has(top1Symbol),
      executedByPolicy: top1Symbol !== "" && executedSymbol === top1Symbol,
      ruleDayTypeDecision,
      dayTypeDecision,
      d1,
      d2,
      entryRule,
      holdDays,
      targetPct,
      stopLossPct,
      costPct
    })
    if (top1ReplayRow) {
      pushReplayFeedbackRow(top1ReplayRow)
    }
    for (const selectedRow of picks) {
      const selectedSymbol = String(selectedRow?.symbol ?? "").trim()
      const pickReplayRow = buildReplayFeedbackRow({
        decisionDateKey,
        row: selectedRow,
        candidateRole: "PICK",
        selectedByPolicy: true,
        executedByPolicy: selectedSymbol !== "" && executedSymbol === selectedSymbol,
        ruleDayTypeDecision,
        dayTypeDecision,
        d1,
        d2,
        entryRule,
        holdDays,
        targetPct,
        stopLossPct,
        costPct
      })
      if (pickReplayRow) {
        pushReplayFeedbackRow(pickReplayRow)
      }
    }
    const executedReplayRow = buildReplayFeedbackRow({
      decisionDateKey,
      row: d2?.executedPick ?? null,
      candidateRole: "EXECUTED",
      selectedByPolicy: d2?.executedPick != null,
      executedByPolicy: d2?.executedPick != null,
      ruleDayTypeDecision,
      dayTypeDecision,
      d1,
      d2,
      entryRule,
      holdDays,
      targetPct,
      stopLossPct,
      costPct
    })
    if (executedReplayRow) {
      pushReplayFeedbackRow(executedReplayRow)
    }

    const pick = d2.executedPick
    if (!pick) {
      bump(selectionFunnelCounts, "EXECUTION_BLOCKED_DAY")
      skippedByExecution += 1
      continue
    }
    bump(selectionFunnelCounts, "EXECUTION_TRADE_DAY")
    executedCount += 1

    const entryIdx = pick.decisionIdx + entryRule.entryOffsetDays
    if (entryIdx < 0 || entryIdx >= pick.series.length) {
      continue
    }
    const exitIdx = Math.min(entryIdx + holdDays - 1, pick.series.length - 1)

    const entryDateKey = pick.series[entryIdx]?.dateKey
    const entryPrice = num(pick.series[entryIdx]?.[entryRule.entryPriceField])
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      continue
    }

    const resolvedExit = resolveTradeExit({
      series: pick.series,
      entryIdx,
      maxExitIdx: exitIdx,
      entryPrice,
      targetPct,
      stopLossPct
    })
    if (!resolvedExit) continue

    const exitDateKey = pick.series[resolvedExit.exitIdx]?.dateKey
    const exitPrice = num(resolvedExit.exitPrice)
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) continue

    const grossRet = exitPrice / entryPrice - 1
    const netRet = grossRet - costPct

    if (netRet > 0) winCount += 1
    const exitReason = String(resolvedExit?.exitReason ?? "").trim().toUpperCase()
    if (exitReason === "TARGET") {
      targetHitCount += 1
    } else if (exitReason === "STOP" || exitReason === "BOTH_HIT_STOP_FIRST") {
      stopCount += 1
    } else {
      timeoutCount += 1
      if (netRet > 0) timeoutPositiveCount += 1
      else if (netRet < 0) timeoutNegativeCount += 1
      else timeoutFlatCount += 1
    }
    equity *= 1 + netRet
    curve.push(equity)

    if (singlePosition) {
      const releaseIdx = lockboxDateToIdx.get(String(exitDateKey ?? ""))
      nextAvailableDecisionIdx =
        Number.isInteger(releaseIdx) ? Math.max(nextAvailableDecisionIdx, releaseIdx + 1) : lockboxDates.length
    }

    trades.push({
      decisionDateKey,
      symbol: pick.symbol,
      name: pick.name,
      score: pick.score,
      baseScore: pick.baseScore,
      finalScore: pick.finalScore,
      rankerScore: Number(pick?.rankerScore ?? pick?.finalScore ?? pick?.score ?? 0) || 0,
      rawScoreMargin: Number.isFinite(Number(pick?.rawScoreMargin)) ? Number(pick.rawScoreMargin) : null,
      postRerankScoreMargin: Number.isFinite(Number(pick?.postRerankScoreMargin))
        ? Number(pick.postRerankScoreMargin)
        : null,
      gateScoreMargin: Number.isFinite(Number(pick?.gateScoreMargin ?? pick?.rawScoreMargin))
        ? Number(pick?.gateScoreMargin ?? pick?.rawScoreMargin)
        : null,
      executionScore: Number.isFinite(Number(pick?.executionScore)) ? Number(pick.executionScore) : null,
      agreementScore: Number.isFinite(Number(pick?.agreementScore)) ? Number(pick.agreementScore) : null,
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
      qualityBonus: pick.qualityBonus,
      antiPenalty: pick.antiPenalty,
      expectedRetBonus: pick.expectedRetBonus,
      expectedNetRet3d: pick.expectedNetRet3d,
      qualityScore: pick.qualityScore,
      antiScore: pick.antiScore,
      rankPct: Number.isFinite(Number(pick?.rankPct)) ? Number(pick.rankPct) : null,
      pHitCalibrated: pick?.calibrated?.pHitCalibrated ?? pick?.pHitCalibrated ?? null,
      pStopFirstCalibrated: pick?.calibrated?.pStopFirstCalibrated ?? pick?.pStopFirstCalibrated ?? null,
      pFillCalibrated: pick?.calibrated?.pFillCalibrated ?? pick?.pFillCalibrated ?? null,
      confidence: pick?.calibrated?.confidence ?? pick?.confidence ?? null,
      routeBucket: pick.routeBucket ?? null,
      regimeTag: pick.regimeTag ?? null,
      matchedPrototypeId: pick.matchedPrototypeId ?? null,
      matchedPrototypeClusterId: pick.matchedPrototypeClusterId ?? null,
      matchedPrototypeClusterSignature: pick.matchedPrototypeClusterSignature ?? null,
      matchedPrototypeSelectedEraId: pick.matchedPrototypeSelectedEraId ?? null,
      tradeQualityPriorAdjustment: Number.isFinite(Number(pick?.tradeQualityPriorAdjustment))
        ? Number(pick.tradeQualityPriorAdjustment)
        : null,
      tradeQualityRankerAdjustment: Number.isFinite(Number(pick?.tradeQualityRankerAdjustment))
        ? Number(pick.tradeQualityRankerAdjustment)
        : null,
      tradeQualityRankerApplied: pick?.tradeQualityRankerApplied === true,
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
      clusterTemporalEraSupportCount: Number.isFinite(Number(pick?.clusterTemporalEraSupportCount))
        ? Number(pick.clusterTemporalEraSupportCount)
        : null,
      clusterTemporalEraCoverageRatio: Number.isFinite(Number(pick?.clusterTemporalEraCoverageRatio))
        ? Number(pick.clusterTemporalEraCoverageRatio)
        : null,
      clusterTemporalDominantEraId: pick?.clusterTemporalDominantEraId ?? null,
      clusterTemporalDominantEraShare: Number.isFinite(Number(pick?.clusterTemporalDominantEraShare))
        ? Number(pick.clusterTemporalDominantEraShare)
        : null,
      clusterTemporalMaxSingleEraShare: Number.isFinite(Number(pick?.clusterTemporalMaxSingleEraShare))
        ? Number(pick.clusterTemporalMaxSingleEraShare)
        : null,
      clusterTemporalEraSupportMin: Number.isFinite(Number(pick?.clusterTemporalEraSupportMin))
        ? Number(pick.clusterTemporalEraSupportMin)
        : null,
      clusterTemporalEraSupportMedian: Number.isFinite(Number(pick?.clusterTemporalEraSupportMedian))
        ? Number(pick.clusterTemporalEraSupportMedian)
        : null,
      clusterTemporalEraWinRateStd: Number.isFinite(Number(pick?.clusterTemporalEraWinRateStd))
        ? Number(pick.clusterTemporalEraWinRateStd)
        : null,
      clusterTemporalEraExpectedNetRetStd: Number.isFinite(Number(pick?.clusterTemporalEraExpectedNetRetStd))
        ? Number(pick.clusterTemporalEraExpectedNetRetStd)
        : null,
      clusterTemporalEraContrastiveLiftStd: Number.isFinite(Number(pick?.clusterTemporalEraContrastiveLiftStd))
        ? Number(pick.clusterTemporalEraContrastiveLiftStd)
        : null,
      regimeVolatilityProxy: Number.isFinite(Number(pick?.regimeVolatilityProxy))
        ? Number(pick.regimeVolatilityProxy)
        : null,
      regimeLiquidityProxy: Number.isFinite(Number(pick?.regimeLiquidityProxy))
        ? Number(pick.regimeLiquidityProxy)
        : null,
      avgTradingValue20dKrw: Number.isFinite(Number(pick?.avgTradingValue20dKrw))
        ? Number(pick.avgTradingValue20dKrw)
        : null,
      spreadProxyPct: Number.isFinite(Number(pick?.spreadProxyPct)) ? Number(pick.spreadProxyPct) : null,
      slippageRisk: Number.isFinite(Number(pick?.slippageRisk)) ? Number(pick.slippageRisk) : null,
      dayType: String(dayTypeDecision?.dayType ?? "BALANCED"),
      dayTypeNoTrade: dayTypeDecision?.noTrade === true,
      dayTypeShadowNoTrade:
        dayTypeDecision?.modelMeta?.shadowNoTrade === true || dayTypeDecision?.shadowNoTrade === true,
      dayTypePolicySource: dayTypeDecision?.policySource ?? null,
      dayTypeModelPredicted: dayTypeDecision?.modelDecision?.predictedDayType ?? null,
      dayTypeModelApplyMode: dayTypeDecision?.modelMeta?.applyMode ?? null,
      dayTypeModelShadowReason: dayTypeDecision?.modelMeta?.shadowReason ?? null,
      dayTypeModelConfidenceBucket: dayTypeDecision?.modelMeta?.confidenceBucket ?? null,
      executionDecisionPreFalsePositive: pick.executionDecisionPreFalsePositive ?? null,
      executionShadowReasonPreFalsePositive: pick.executionShadowReasonPreFalsePositive ?? null,
      falsePositiveRisk: Number.isFinite(Number(pick?.falsePositiveRisk)) ? Number(pick.falsePositiveRisk) : null,
      falsePositiveModelRisk: Number.isFinite(Number(pick?.falsePositiveModelRisk))
        ? Number(pick.falsePositiveModelRisk)
        : null,
      falsePositiveDecision: pick.falsePositiveDecision ?? null,
      falsePositiveReason: pick.falsePositiveReason ?? null,
      budgetDecision: pick.budgetDecision ?? null,
      budgetReason: pick.budgetReason ?? null,
      executionDecision: pick.executionDecision ?? null,
      executionShadowReason: pick.executionShadowReason ?? null,
      metaDecision: pick.metaDecision ?? null,
      metaReason: pick.metaReason ?? null,
      entryDateKey,
      exitDateKey,
      entryPrice,
      exitPrice,
      grossRet,
      netRet,
      hitTarget: resolvedExit.hitTarget,
      hitStop: resolvedExit.hitStop,
      exitReason: resolvedExit.exitReason,
      targetDateKey: pick.targetDateKey,
      topK: (d1.top ?? []).map((row) => ({
        symbol: row.symbol,
        score: row.score,
        baseScore: row.baseScore,
        finalScore: row.finalScore,
        rankerScore: Number(row?.rankerScore ?? row?.finalScore ?? row?.score ?? 0) || 0,
        executionScore: Number.isFinite(Number(row?.executionScore)) ? Number(row.executionScore) : null,
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
        expectedNetRet3d: row.expectedNetRet3d,
        qualityScore: row.qualityScore,
        antiScore: row.antiScore,
        routeBucket: row.routeBucket ?? null,
        regimeTag: row.regimeTag ?? null,
        matchedPrototypeId: row.matchedPrototypeId ?? null,
        matchedPrototypeClusterId: row.matchedPrototypeClusterId ?? null,
        matchedPrototypeClusterSignature: row.matchedPrototypeClusterSignature ?? null,
        matchedPrototypeSelectedEraId: row.matchedPrototypeSelectedEraId ?? null,
        tradeQualityPriorAdjustment: Number.isFinite(Number(row?.tradeQualityPriorAdjustment))
          ? Number(row.tradeQualityPriorAdjustment)
          : null,
        tradeQualityRankerAdjustment: Number.isFinite(Number(row?.tradeQualityRankerAdjustment))
          ? Number(row.tradeQualityRankerAdjustment)
          : null,
        tradeQualityRankerApplied: row?.tradeQualityRankerApplied === true,
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
        pHitCalibrated: row?.calibrated?.pHitCalibrated ?? null,
        pStopFirstCalibrated: row?.calibrated?.pStopFirstCalibrated ?? null,
        pFillCalibrated: row?.calibrated?.pFillCalibrated ?? null,
        confidence: row?.calibrated?.confidence ?? null,
        falsePositiveRisk: Number.isFinite(Number(row?.falsePositiveRisk))
          ? Number(row.falsePositiveRisk)
          : null,
        falsePositiveModelRisk: Number.isFinite(Number(row?.falsePositiveModelRisk))
          ? Number(row.falsePositiveModelRisk)
          : null,
        falsePositiveDecision: row?.falsePositiveDecision ?? null,
        falsePositiveReason: row?.falsePositiveReason ?? null,
        budgetDecision: row?.budgetDecision ?? null,
        budgetReason: row?.budgetReason ?? null,
        metaDecision: row?.metaDecision ?? null,
        executionDecision: row?.executionDecision ?? null,
        executionShadowReason: row?.executionShadowReason ?? null
      }))
    })
  }

  const totalTrades = trades.length
  const winRate = totalTrades > 0 ? winCount / totalTrades : 0
  const avgNetRet =
    totalTrades > 0
      ? trades.reduce((acc, t) => acc + Number(t.netRet ?? 0), 0) / totalTrades
      : 0
  const equalWeightNetRetSum = trades.reduce((acc, t) => acc + (Number(t?.netRet ?? 0) || 0), 0)
  const cumulativeReturn = equity - 1
  const cumulativeReturnMode =
    singlePosition === true
      ? "SEQUENTIAL_COMPOUND_SINGLE_POSITION"
      : "SEQUENTIAL_COMPOUND_OVERLAP_SECONDARY"
  const maxDrawdown = calcMdd(curve)
  const targetHitRate = totalTrades > 0 ? targetHitCount / totalTrades : 0
  const stopRate = totalTrades > 0 ? stopCount / totalTrades : 0
  const timeoutRate = totalTrades > 0 ? timeoutCount / totalTrades : 0
  const timeoutPositiveRate = totalTrades > 0 ? timeoutPositiveCount / totalTrades : 0
  const timeoutNegativeRate = totalTrades > 0 ? timeoutNegativeCount / totalTrades : 0
  const decisionDays = lockboxDates.length
  const targetHitsPer20TradingDays =
    decisionDays > 0 ? (targetHitCount / decisionDays) * 20 : 0
  const concurrentOpenCounts = lockboxDates.map(() => 0)
  for (const trade of trades) {
    const entryCursor = lockboxDateToIdx.get(String(trade?.entryDateKey ?? ""))
    const exitCursor = lockboxDateToIdx.get(String(trade?.exitDateKey ?? ""))
    if (!Number.isInteger(entryCursor) || !Number.isInteger(exitCursor)) continue
    for (let cursor = entryCursor; cursor <= exitCursor && cursor < concurrentOpenCounts.length; cursor += 1) {
      if (cursor < 0) continue
      concurrentOpenCounts[cursor] += 1
    }
  }
  const peakConcurrentPositions = concurrentOpenCounts.length > 0
    ? concurrentOpenCounts.reduce((maxCount, value) => Math.max(maxCount, Number(value) || 0), 0)
    : 0
  const avgConcurrentPositions = concurrentOpenCounts.length > 0
    ? concurrentOpenCounts.reduce((acc, value) => acc + (Number(value) || 0), 0) / concurrentOpenCounts.length
    : 0
  const overlapActiveDays = concurrentOpenCounts.filter((value) => (Number(value) || 0) > 1).length
  const overlapActiveRate = decisionDays > 0 ? overlapActiveDays / decisionDays : 0

  const pickHitRateEval = Number(stepDSummary?.pickHitRateEval ?? 0) || 0
  const executedHitRateEval = Number(stepDSummary?.executedHitRateEval ?? 0) || 0
  const targetHitRateEval =
    Number(stepDSummary?.targetHitRateEval ?? stepDSummary?.pickHitRateEval ?? 0) || 0
  const evalToLockboxGap = {
    pickHitRateEval,
    executedHitRateEval,
    targetHitRateEval,
    lockboxWinRate: winRate,
    lockboxTargetHitRate: targetHitRate,
    winRateMinusPickHitRateEval: winRate - pickHitRateEval,
    winRateMinusExecutedHitRateEval: winRate - executedHitRateEval,
    targetHitRateMinusPickHitRateEval: targetHitRate - pickHitRateEval,
    targetHitRateMinusTargetHitRateEval: targetHitRate - targetHitRateEval,
    absGapVsPickHitRateEval: Math.abs(winRate - pickHitRateEval),
    absGapVsTargetHitRateEval: Math.abs(targetHitRate - targetHitRateEval)
  }
  const stepDLookaheadViolations =
    Math.max(0, Number(stepDSummary?.lookaheadViolations ?? 0) || 0)
  const stepDExecutionLookaheadViolations =
    Math.max(0, Number(stepDSummary?.executionLookaheadViolations ?? 0) || 0)
  const failOnPartialLockboxAuditLoss =
    ctx?.__runtime?.stepEFailOnPartialAuditLoss === true ||
    ctx?.config?.lockboxGate?.failOnPartialAuditLoss === true
  if (failOnPartialLockboxAuditLoss && missingLockboxAuditDays > 0) {
    throw new Error(
      `Step E missing canonical lockbox audit rows: missingDays=${missingLockboxAuditDays}`,
    )
  }
  const baselineGateReasonCounts = {}
  for (const row of d1BaselineAuditRows) {
    const key = String(row?.gateReason ?? "").trim()
    if (!key) continue
    baselineGateReasonCounts[key] = Number(baselineGateReasonCounts[key] ?? 0) + 1
  }
  const lockboxGateReasonCounts = {}
  for (const row of d1LockboxAuditRows) {
    const key = String(row?.gateReason ?? "").trim()
    if (!key) continue
    lockboxGateReasonCounts[key] = Number(lockboxGateReasonCounts[key] ?? 0) + 1
  }
  const baselineExecutionDecisionCounts = summarizeDecisionCountRows(d2BaselineAuditRows, "decisionCounts")
  const lockboxExecutionDecisionCounts = summarizeDecisionCountRows(d2LockboxAuditRows, "decisionCounts")
  const baselineFalsePositiveDecisionCounts = summarizeDecisionCountRows(
    d2BaselineAuditRows,
    "falsePositiveDecisionCounts",
  )
  const lockboxFalsePositiveDecisionCounts = summarizeDecisionCountRows(
    d2LockboxAuditRows,
    "falsePositiveDecisionCounts",
  )
  const baselineBudgetDecisionCounts = summarizeDecisionCountRows(
    d2BaselineAuditRows,
    "budgetDecisionCounts",
  )
  const lockboxBudgetDecisionCounts = summarizeDecisionCountRows(
    d2LockboxAuditRows,
    "budgetDecisionCounts",
  )
  const baselineAgreementDecisionCounts = summarizeTopFieldCounts(
    d1BaselineAuditRows,
    "top1AgreementDecision",
  )
  const lockboxAgreementDecisionCounts = summarizeTopFieldCounts(
    d1LockboxAuditRows,
    "top1AgreementDecision",
  )
  const baselineAgreementReasonCounts = summarizeTopFieldCounts(
    d1BaselineAuditRows,
    "top1AgreementReason",
  )
  const lockboxAgreementReasonCounts = summarizeTopFieldCounts(
    d1LockboxAuditRows,
    "top1AgreementReason",
  )
  const baselineRouteBucketCounts = summarizeExecutionAuditDistribution(
    d2BaselineAuditRows,
    "routeBucket",
  )
  const lockboxRouteBucketCounts = summarizeExecutionAuditDistribution(
    d2LockboxAuditRows,
    "routeBucket",
  )
  const baselineRegimeTagCounts = summarizeExecutionAuditDistribution(
    d2BaselineAuditRows,
    "regimeTag",
  )
  const lockboxRegimeTagCounts = summarizeExecutionAuditDistribution(
    d2LockboxAuditRows,
    "regimeTag",
  )
  const gateReasonDrift = computeDistributionL1(baselineGateReasonCounts, lockboxGateReasonCounts)
  const executionDecisionDrift = computeDistributionL1(
    baselineExecutionDecisionCounts,
    lockboxExecutionDecisionCounts,
  )
  const falsePositiveDecisionDrift = computeDistributionL1(
    baselineFalsePositiveDecisionCounts,
    lockboxFalsePositiveDecisionCounts,
  )
  const budgetDecisionDrift = computeDistributionL1(
    baselineBudgetDecisionCounts,
    lockboxBudgetDecisionCounts,
  )
  const agreementDecisionDrift = computeDistributionL1(
    baselineAgreementDecisionCounts,
    lockboxAgreementDecisionCounts,
  )
  const agreementReasonDrift = computeDistributionL1(
    baselineAgreementReasonCounts,
    lockboxAgreementReasonCounts,
  )
  const routeBucketDrift = computeDistributionL1(baselineRouteBucketCounts, lockboxRouteBucketCounts)
  const regimeTagDrift = computeDistributionL1(baselineRegimeTagCounts, lockboxRegimeTagCounts)
  const driftComponents = [
    gateReasonDrift.normalized,
    executionDecisionDrift.normalized,
    falsePositiveDecisionDrift.normalized,
    budgetDecisionDrift.normalized,
    agreementDecisionDrift.normalized,
    agreementReasonDrift.normalized,
    routeBucketDrift.normalized,
    regimeTagDrift.normalized
  ].filter((value) => Number.isFinite(Number(value)))
  const policyDriftScore =
    driftComponents.length > 0
      ? driftComponents.reduce((acc, value) => acc + Number(value), 0) / driftComponents.length
      : null
  const policyDrift = {
    available: d1BaselineAuditRows.length > 0 || d2BaselineAuditRows.length > 0,
    baselineEvalDays: d1BaselineAuditRows.length,
    lockboxDays: d1LockboxAuditRows.length,
    gateReason: gateReasonDrift,
    executionDecision: executionDecisionDrift,
    falsePositiveDecision: falsePositiveDecisionDrift,
    budgetDecision: budgetDecisionDrift,
    agreementDecision: agreementDecisionDrift,
    agreementReason: agreementReasonDrift,
    routeBucket: routeBucketDrift,
    regimeTag: regimeTagDrift,
    bucketConsistency: Number.isFinite(Number(routeBucketDrift.normalized))
      ? clamp(1 - Number(routeBucketDrift.normalized), 0, 1)
      : null,
    regimeConsistency: Number.isFinite(Number(regimeTagDrift.normalized))
      ? clamp(1 - Number(regimeTagDrift.normalized), 0, 1)
      : null,
    agreementDecisionConsistency: Number.isFinite(Number(agreementDecisionDrift.normalized))
      ? clamp(1 - Number(agreementDecisionDrift.normalized), 0, 1)
      : null,
    agreementReasonConsistency: Number.isFinite(Number(agreementReasonDrift.normalized))
      ? clamp(1 - Number(agreementReasonDrift.normalized), 0, 1)
      : null,
    policyDriftScore
  }
  const traceDiff = {
    available: traceComparedDays > 0 || missingLockboxAuditDays > 0,
    daysCompared: traceComparedDays,
    missingAuditDays: missingLockboxAuditDays,
    mismatchDays: traceMismatchDays,
    criticalMismatchDays: traceCriticalMismatchDays,
    mismatchRate: traceComparedDays > 0 ? traceMismatchDays / traceComparedDays : 0,
    criticalMismatchRate:
      traceComparedDays > 0 ? traceCriticalMismatchDays / traceComparedDays : 0,
    fieldMismatchCounts: traceFieldMismatchCounts
  }
  const artifactTierRaw = String(ctx?.config?.lightweight?.artifactPolicy?.tier ?? "exploratory")
    .trim()
    .toLowerCase()
  const artifactTier =
    artifactTierRaw === "promotion" || artifactTierRaw === "confirm"
      ? artifactTierRaw
      : "exploratory"
  const prototypeQualityLookup = buildPrototypeQualityLookup({
    library,
    runtimeMeta
  })
  const c0SelectionSummary = summarizeC0FamilySelection({
    auditRows: d2LockboxAuditRows,
    prototypeQualityLookup,
    selectedFamilyIds: runtimeMeta?.c1?.effectiveFamilyIds ?? runtimeMeta?.c1?.passedFamilyIds ?? [],
    representativeFamilyIds:
      runtimeMeta?.c2?.effectiveRepresentativeFamilyIds ??
      runtimeMeta?.c2?.representativeFamilyIds ??
      []
  })
  const effectiveC1FamilyIds = Array.isArray(runtimeMeta?.c1?.effectiveFamilyIds)
    ? runtimeMeta.c1.effectiveFamilyIds
    : (runtimeMeta?.c1?.passedFamilyIds ?? [])
  const effectiveC2RepresentativeFamilyIds = Array.isArray(
    runtimeMeta?.c2?.effectiveRepresentativeFamilyIds,
  )
    ? runtimeMeta.c2.effectiveRepresentativeFamilyIds
    : (runtimeMeta?.c2?.representativeFamilyIds ?? [])
  const c1SelectionSummary = {
    enabled: effectiveC1FamilyIds.length > 0,
    selectedFamilyIds: effectiveC1FamilyIds,
    selectedC1FamilyShare: Number(c0SelectionSummary?.selectedC1FamilyShare ?? 0) || 0
  }
  const c2SelectionSummary = {
    enabled: effectiveC2RepresentativeFamilyIds.length > 0,
    representativeFamilyIds: effectiveC2RepresentativeFamilyIds,
    topMatchedC2RepresentativeFamilyId:
      String(c0SelectionSummary?.topMatchedC2RepresentativeFamilyId ?? "").trim() || null,
    selectedC2FamilyShare: Number(c0SelectionSummary?.selectedC2FamilyShare ?? 0) || 0
  }
  const familyLockboxRollup = summarizeFamilyLockboxRollup({
    d2LockboxAuditRows,
    trades,
    prototypeQualityLookup,
    selectedFamilyIds: effectiveC1FamilyIds,
    representativeFamilyIds: effectiveC2RepresentativeFamilyIds
  })

  const stepDEvalSelectionHitAt1 = buildSelectionHitAt1Snapshot(stepDSummary ?? {})
  const report = {
    step: "E",
    stepERunMode,
    diagnosticMode,
    artifactTier,
    period: ctx.periods.lockbox,
    candidatePrefilter: "step_d_lockbox_audit",
    scorerVersion,
    policyParityMode: "STEP_D_LOCKBOX_AUDIT_CANONICAL",
    policyContract,
    candidateIndexSource: {
      path: pathExists(candidateIndexPath) ? candidateIndexPath : null,
      rows: null,
      used: false
    },
    candidateFeaturePackSource: {
      path: pathExists(featurePackPath) ? featurePackPath : null,
      rows: null,
      used: false
    },
    decisionAuditSource: {
      d1Path: d1LockboxBaselineAuditPath,
      d2Path: d2LockboxBaselineAuditPath,
      d1Rows: d1LockboxBaselineAuditRows.length,
      d2Rows: d2LockboxBaselineAuditRows.length,
      source: "STEP_D_LOCKBOX_AUDIT"
    },
    policyTraceBaselineSource: {
      d1Path: d1LockboxBaselineAuditPath,
      d2Path: d2LockboxBaselineAuditPath,
      d1Rows: d1LockboxBaselineAuditRows.length,
      d2Rows: d2LockboxBaselineAuditRows.length,
      runtimeCacheHit: runtimeStepDArtifacts !== null
    },
    totalTrades,
    targetHitCount,
    targetHitRate,
    stopCount,
    stopRate,
    timeoutCount,
    timeoutRate,
    timeoutPositiveCount,
    timeoutPositiveRate,
    timeoutNegativeCount,
    timeoutNegativeRate,
    timeoutFlatCount,
    targetHitsPer20TradingDays,
    winCount,
    winRate,
    avgNetRet,
    equalWeightNetRetSum,
    cumulativeReturn,
    cumulativeReturnMode,
    maxDrawdown,
    decisionDays,
    selectionCount,
    executedCount,
    executionApprovedRawCount,
    pickedCount,
    pickedDays,
    peakConcurrentPositions,
    avgConcurrentPositions,
    overlapActiveDays,
    overlapActiveRate,
    missingLockboxAuditDays,
    coverageRecovery: {
      days: coverageRecoveryDays,
      hitDays: coverageRecoveryHitDays,
      hitRate: coverageRecoveryDays > 0 ? coverageRecoveryHitDays / coverageRecoveryDays : 0
    },
    skippedDueToOpenPosition,
    skippedByGate,
    skippedByExecution,
    skippedByDailyEntryCap,
    gateReasonCounts,
    selectionFunnel: {
      counts: selectionFunnelCounts
    },
    dayTypeCounts,
    dayTypePolicySourceCounts,
    dayTypeNoTradeCount,
    dayTypeNoTradeHitCount,
    dayTypeShadowNoTradeCount,
    metaDecisionCounts,
    executionDecisionCounts,
    executionShadowReasonCounts,
    falsePositiveDecisionCounts,
    falsePositiveReasonCounts,
    preFalsePositiveApprovedCount,
    falsePositiveRejectedCount,
    falsePositiveRejectedHitCount,
    falsePositiveRejectedMissCount,
    agreementDecisionCounts: lockboxAgreementDecisionCounts,
    agreementReasonCounts: lockboxAgreementReasonCounts,
    budgetDecisionCounts,
    budgetReasonCounts,
    budgetRejectedCount,
    budgetRejectedHitCount,
    budgetRejectedMissCount,
    falsePositiveGate: {
      enabled: falsePositiveGateCfg?.enabled === true,
      action: String(falsePositiveGateCfg?.action ?? "shadow"),
      maxRisk: Number(falsePositiveGateCfg?.maxRisk ?? 0),
      modelConfig: falsePositiveModelCfg,
      preApprovedCount: preFalsePositiveApprovedCount,
      rejectedCount: falsePositiveRejectedCount,
      rejectedHitCount: falsePositiveRejectedHitCount,
      rejectedMissCount: falsePositiveRejectedMissCount,
      rejectionPrecision:
        falsePositiveRejectedCount > 0 ? falsePositiveRejectedMissCount / falsePositiveRejectedCount : 0,
      falseNegativeRate:
        falsePositiveRejectedCount > 0 ? falsePositiveRejectedHitCount / falsePositiveRejectedCount : 0,
      state: {
        globalCount: Number(falsePositiveState?.globalCount ?? 0) || 0,
        falsePositiveCount: Number(falsePositiveState?.falsePositiveCount ?? 0) || 0,
        routeCount: falsePositiveState?.routeStats instanceof Map ? falsePositiveState.routeStats.size : 0,
        regimeCount: falsePositiveState?.regimeStats instanceof Map ? falsePositiveState.regimeStats.size : 0,
        prototypeCount:
          falsePositiveState?.prototypeStats instanceof Map ? falsePositiveState.prototypeStats.size : 0
      },
      model: falsePositiveModel
    },
    dayTypeRouter: {
      enabled: dayTypeRouterCfg?.enabled === true,
      config: dayTypeRouterCfg,
      counts: dayTypeCounts,
      policySourceCounts: dayTypePolicySourceCounts,
      noTradeCount: dayTypeNoTradeCount,
      noTradeHitCount: dayTypeNoTradeHitCount,
      noTradeHitRate: dayTypeNoTradeCount > 0 ? dayTypeNoTradeHitCount / dayTypeNoTradeCount : 0,
      shadowNoTradeCount: dayTypeShadowNoTradeCount,
      modelConfig: dayTypeModelCfg,
      modelApplyModeCounts: dayTypeModelApplyModeCounts,
      modelShadowReasonCounts: dayTypeModelShadowReasonCounts,
      modelConfidenceBucketCounts: dayTypeModelConfidenceBucketCounts,
      modelOverrideCount: dayTypeModelOverrideCount,
      modelShadowCount: dayTypeModelShadowCount,
      modelAgreeCount: dayTypeModelAgreeCount,
      modelRejectedCount: dayTypeModelRejectedCount,
      model: dayTypeModel
    },
    agreementGate: {
      enabled: decisionGateCfg?.agreementGate?.enabled === true,
      config: decisionGateCfg?.agreementGate ?? {},
      decisionCounts: lockboxAgreementDecisionCounts,
      reasonCounts: lockboxAgreementReasonCounts
    },
    opportunityBudget: {
      enabled: opportunityBudgetCfg?.enabled === true,
      action: String(opportunityBudgetCfg?.action ?? "shadow"),
      config: opportunityBudgetCfg,
      decisionCounts: budgetDecisionCounts,
      reasonCounts: budgetReasonCounts,
      rejectedCount: budgetRejectedCount,
      rejectedHitCount: budgetRejectedHitCount,
      rejectedMissCount: budgetRejectedMissCount,
      rejectionPrecision:
        budgetRejectedCount > 0 ? budgetRejectedMissCount / budgetRejectedCount : 0,
      falseNegativeRate:
        budgetRejectedCount > 0 ? budgetRejectedHitCount / budgetRejectedCount : 0
    },
    evalToLockboxGap,
    policyDrift,
    traceDiff,
    stepDEvalReference: {
      targetHitRateEval,
      pickHitRateEval,
      selectionHitAt1Eval: stepDEvalSelectionHitAt1.resolved,
      selectionHitAt1RawEval: stepDEvalSelectionHitAt1.raw,
      selectionHitAt1ResolvedEval: stepDEvalSelectionHitAt1.resolved,
      selectionHitAt1MetricSourceEval: stepDEvalSelectionHitAt1.source,
      selectionHitAt1AgreementFallbackAwareEval: stepDEvalSelectionHitAt1.agreementFallbackAware,
      executedHitRateEval,
      executedTargetHitRateEval:
        Number(stepDSummary?.executedTargetHitRateEval ?? stepDSummary?.executedHitRateEval ?? 0) ||
        0,
      stopRateEval: Number(stepDSummary?.stopRateEval ?? 0) || 0,
      timeoutNegativeRateEval:
        Number(stepDSummary?.timeoutNegativeRateEval ?? stepDSummary?.timeoutNegativeRate ?? 0) ||
        0,
      executionCoverageEval: Number(stepDSummary?.executionCoverageEval ?? 0) || 0
    },
    c0Selection: c0SelectionSummary,
    c1Selection: c1SelectionSummary,
    c2Selection: c2SelectionSummary,
    familyLockboxRollup,
    topMatchedC2RepresentativeFamilyId: c2SelectionSummary.topMatchedC2RepresentativeFamilyId,
    eGate: {
      metricSource: "STEP_E_LOCKBOX",
      metrics: {
        targetHitRate,
        targetHitCount,
        stopRate,
        timeoutNegativeRate,
        winRate,
        avgNetRet,
        cumulativeReturn,
        totalTrades
      },
      diagnostics: {
        lookaheadViolations: stepDLookaheadViolations,
        executionLookaheadViolations: stepDExecutionLookaheadViolations,
        missingLockboxAuditDays,
        traceDiff
      },
      familySelection: {
        c0: c0SelectionSummary,
        c1: c1SelectionSummary,
        c2: c2SelectionSummary,
        familyLockboxRollup
      }
    },
    lookaheadViolations: stepDLookaheadViolations,
    executionLookaheadViolations: stepDExecutionLookaheadViolations,
    feeBps,
    slippageBps,
    goalMode,
    positionSemantics,
    singlePosition,
    maxNewEntriesPerDay,
    entry: entryRule.mode,
    entryOffsetDays: entryRule.entryOffsetDays,
    localWindow,
    globalWindow,
    minWindow,
    holdDays,
    targetPct,
    stopLossPct,
    stageWeights: runtimeHybrid.stageWeights,
    coarseTopN: runtimeHybrid.coarseTopN,
    coarseTopClusters: runtimeHybrid.coarseTopClusters,
    weights,
    routeWeightsByBucket: Object.fromEntries(
      Array.from(routeWeightsByBucket.entries()).map(([bucket, row]) => [String(bucket), row]),
    ),
    postScoreAdjust: postScoreAdjustCfg,
    decisionGate: decisionGateCfg,
    calibration: calibrationCfg,
    metaSelector: metaSelectorCfg,
    executionGate: executionGateCfg,
    falsePositiveGateConfig: falsePositiveGateCfg,
    regimeRouter: regimeRouterCfg,
    regimeExperts: regimeExpertsCfg,
    orderSimulator: orderSimulatorCfg,
    extendedBias: {
      config: extendedBiasCfg,
      stateSizes: {
        routeBucket: Object.keys(routeBiasState ?? {}).length,
        regime: Object.keys(regimeBiasState ?? {}).length,
        prototype: Object.keys(prototypeBiasState ?? {}).length
      }
    },
    replayFeedback: {
      rows: replayFeedbackRows.length,
      roleCounts: replayFeedbackRows.reduce((acc, row) => {
        const key = String(row?.candidateRole ?? "UNKNOWN").trim() || "UNKNOWN"
        acc[key] = Number(acc[key] ?? 0) + 1
        return acc
      }, {})
    }
  }

  const tradesPath = path.join(outDir, "lockbox_trades.jsonl")
  const replayFeedbackPath = path.join(outDir, "lockbox_replay_feedback.jsonl")
  const summaryPath = path.join(outDir, "step_e_summary.json")
  const reportPath = summaryPath
  const perfPath = path.join(outDir, "perf_counters.json")
  const d1LockboxAuditPath = path.join(outDir, "d1_lockbox_ranked_candidates.jsonl")
  const d2LockboxAuditPath = path.join(outDir, "d2_lockbox_execution_audit.jsonl")
  const policyDriftPath = path.join(outDir, "policy_drift_report.json")
  const traceDiffPath = path.join(outDir, "trace_diff_report.json")
  const persistFullDiagnostics =
    !preferLightDiagnostics ||
    ctx.__runtime?.stepEWriteFullDiagnostics === true ||
    traceCriticalMismatchDays > 0
  const persistTraceRows =
    persistFullDiagnostics ||
    ctx.__runtime?.stepEForceTraceRows === true ||
    traceCriticalMismatchDays > 0
  const persistDiagnosticReports =
    persistFullDiagnostics ||
    ctx.__runtime?.stepEForceDiagnosticReports === true ||
    traceCriticalMismatchDays > 0
  const persistTradeRows =
    artifactTier === "promotion" ||
    ctx.__runtime?.stepEForceTradeRows === true ||
    traceCriticalMismatchDays > 0
  const persistReplayFeedbackRows =
    artifactTier !== "exploratory" ||
    ctx.__runtime?.stepEForceReplayFeedbackRows === true ||
    traceCriticalMismatchDays > 0

  if (persistTradeRows) {
    await writeJsonl(tradesPath, trades)
  }
  if (persistReplayFeedbackRows) {
    await writeJsonl(replayFeedbackPath, replayFeedbackRows)
  }
  if (persistFullDiagnostics) {
    await writeJsonl(d1LockboxAuditPath, d1LockboxAuditRows)
    await writeJsonl(d2LockboxAuditPath, d2LockboxAuditRows)
  }
  report.diagnosticsPersisted = persistFullDiagnostics
  report.tradeRowsPersisted = persistTradeRows
  report.replayFeedbackPersisted = persistReplayFeedbackRows
  report.traceRowsStored = persistTraceRows ? traceDiffRows.length : 0
  await writeJson(summaryPath, report)
  await writeJson(perfPath, perfCounters)
  if (persistDiagnosticReports) {
    await writeJson(policyDriftPath, policyDrift)
    await writeJson(traceDiffPath, {
      summary: traceDiff,
      rows: persistTraceRows ? traceDiffRows : [],
      rowsOmitted: persistTraceRows !== true,
      rowsStored: persistTraceRows ? traceDiffRows.length : 0
    })
  }

  return {
    step: "E",
    tradesPath: persistTradeRows ? tradesPath : null,
    replayFeedbackPath: persistReplayFeedbackRows ? replayFeedbackPath : null,
    d1LockboxAuditPath: persistFullDiagnostics ? d1LockboxAuditPath : null,
    d2LockboxAuditPath: persistFullDiagnostics ? d2LockboxAuditPath : null,
    policyDriftPath: persistDiagnosticReports ? policyDriftPath : null,
    traceDiffPath: persistDiagnosticReports ? traceDiffPath : null,
    reportPath,
    summaryPath,
    perfPath,
    summary: report
  }
}
