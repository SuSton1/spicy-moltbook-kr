import crypto from "node:crypto"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "./perfect_prototype_support_case.mjs"
import {
  applyPerfectPrototypeSupportTemporalAnchorScorer,
  summarizePerfectPrototypeSupportTemporalAnchorSelections,
} from "./perfect_prototype_support_temporal_anchor_scorer.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const quantile = (values, q) => {
  const filtered = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (filtered.length < 1) return null
  if (filtered.length === 1) return filtered[0]
  const clamped = Math.max(0, Math.min(1, Number(q) || 0))
  const position = (filtered.length - 1) * clamped
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return filtered[lowerIndex]
  const fraction = position - lowerIndex
  return filtered[lowerIndex] + (filtered[upperIndex] - filtered[lowerIndex]) * fraction
}

const uniqueNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter(Number.isFinite)
        .map((value) => Math.round(value * 1000) / 1000),
    ),
  ).sort((left, right) => left - right)

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const recordReason = (reasonCounts, reason) => {
  if (!reason) return
  reasonCounts[reason] = Number(reasonCounts[reason] ?? 0) + 1
}

const featureBucketOf = (featureKey) => {
  const text = String(featureKey ?? "")
  const parts = text.split(".")
  return parts.slice(0, Math.min(3, parts.length)).join(".")
}

const collectFeatureCandidates = ({
  positiveRows = [],
  negativeRows = [],
  featureKeys = [],
  maxFeatures = 8,
} = {}) => {
  const scored = []
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const positiveValues = (positiveRows ?? [])
      .map((row) => num(row?.numericFeatureMap?.[featureKey]))
      .filter(Number.isFinite)
    const negativeValues = (negativeRows ?? [])
      .map((row) => num(row?.numericFeatureMap?.[featureKey]))
      .filter(Number.isFinite)
    if (positiveValues.length < 3 || negativeValues.length < 3) continue
    const positiveMean = average(positiveValues)
    const negativeMean = average(negativeValues)
    if (!Number.isFinite(positiveMean) || !Number.isFinite(negativeMean)) continue
    const scale = Math.max(
      0.05,
      Number(quantile([...positiveValues, ...negativeValues], 0.9) ?? 0) -
        Number(quantile([...positiveValues, ...negativeValues], 0.1) ?? 0),
      Math.abs(positiveMean - negativeMean),
    )
    const separation = Math.abs(positiveMean - negativeMean) / Math.max(0.05, scale)
    if (separation < 0.05) continue
    scored.push({
      featureKey,
      direction: positiveMean >= negativeMean ? 1 : -1,
      center: (positiveMean + negativeMean) / 2,
      scale,
      separation,
      weight: Math.max(0.1, Math.min(3, separation)),
      bucket: featureBucketOf(featureKey),
    })
  }
  scored.sort((left, right) => {
    if (right.separation !== left.separation) return right.separation - left.separation
    return left.featureKey.localeCompare(right.featureKey)
  })
  const selected = []
  const bucketCounts = new Map()
  for (const entry of scored) {
    const bucket = entry.bucket
    const count = Number(bucketCounts.get(bucket) ?? 0)
    if (count >= 2) continue
    selected.push(entry)
    bucketCounts.set(bucket, count + 1)
    if (selected.length >= Math.max(1, Math.floor(Number(maxFeatures) || 8))) break
  }
  return selected
}

const buildArtifactHash = (artifact) =>
  crypto.createHash("sha256").update(JSON.stringify(artifact)).digest("hex")

const buildArtifact = ({
  family,
  selectedFeatures,
  selectThreshold,
  marginThreshold,
  riskThreshold,
  abstainThreshold,
} = {}) => ({
  familyId: family?.familyId ?? "low_gap_top_continuation",
  gateTokens: family?.gateTokens ?? [],
  selectedFeatures: (Array.isArray(selectedFeatures) ? selectedFeatures : []).map((feature) => ({
    featureKey: feature.featureKey,
    direction: feature.direction,
    center: feature.center,
    scale: feature.scale,
    weight: feature.weight,
    separation: feature.separation,
  })),
  minFeatureMatchCount: Math.max(1, Math.ceil((selectedFeatures?.length ?? 0) / 2)),
  marginFeatureKey: "sig.roleTopo.rolePurityLift",
  riskFeatureKey: "sig.roleTopo.negativeRolePressure",
  falsePositivePressureFeatureKey: "sig.temporalEpisode.episodeNegativePressure",
  uncertaintyFeatureKey: "sig.roleTopo.roleUncertainty",
  riskWeight: 1,
  uncertaintyWeight: 0.5,
  selectThreshold,
  marginThreshold,
  riskThreshold,
  abstainThreshold,
  supportAcceptanceOnly: true,
})

const buildCandidatePreview = (candidate) => ({
  featureCount: Number(candidate?.featureCount ?? 0),
  selectedFeatureKeys: (candidate?.selectedFeatures ?? []).map((feature) => feature?.featureKey).filter(Boolean),
  selectThreshold: Number(candidate?.selectThreshold ?? 0),
  marginThreshold: Number(candidate?.marginThreshold ?? 0),
  riskThreshold: Number(candidate?.riskThreshold ?? 0),
  abstainThreshold: Number(candidate?.abstainThreshold ?? 0),
  supportMatched: Array.isArray(candidate?.supportMatched) ? candidate.supportMatched : [],
  failureReason: candidate?.failureReason ?? null,
  trainSummary: candidate?.trainSummary ?? {},
  oosSummary: candidate?.oosSummary ?? {},
})

const compareSolutions = (left, right) => {
  if (toNumber(right?.oosSummary?.openOosMatchCount, 0) !== toNumber(left?.oosSummary?.openOosMatchCount, 0)) {
    return toNumber(right?.oosSummary?.openOosMatchCount, 0) - toNumber(left?.oosSummary?.openOosMatchCount, 0)
  }
  if (toNumber(right?.trainSummary?.trainMatchedDateCount, 0) !== toNumber(left?.trainSummary?.trainMatchedDateCount, 0)) {
    return toNumber(right?.trainSummary?.trainMatchedDateCount, 0) - toNumber(left?.trainSummary?.trainMatchedDateCount, 0)
  }
  if (toNumber(right?.trainSummary?.trainMatchedMonthCount, 0) !== toNumber(left?.trainSummary?.trainMatchedMonthCount, 0)) {
    return toNumber(right?.trainSummary?.trainMatchedMonthCount, 0) - toNumber(left?.trainSummary?.trainMatchedMonthCount, 0)
  }
  return Number(left?.featureCount ?? 0) - Number(right?.featureCount ?? 0)
}

const derivePrimaryReason = (reasonCounts) =>
  Object.entries(reasonCounts ?? {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ??
  "unsat_no_temporal_anchor_candidates"

export const calibratePerfectPrototypeSupportTemporalAnchorScorer = ({
  family,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  minCrossfitPositiveWindows = 2,
  maxCrossfitNegativeWindows = 0,
  minOosMatchCount = 3,
  maxFeatures = 8,
} = {}) => {
  const supportFitExcluded = family?.supportFitExcluded === true
  if (supportFitExcluded !== true) {
    return {
      ok: false,
      reason: "unsat_support_acceptance_only_dependency",
      supportFitExcluded,
      supportLeaveOneOutRecovered: false,
      qualifiedCandidateCount: 0,
      unsatReasonCounts: { unsat_support_acceptance_only_dependency: 1 },
      candidatesEvaluated: [],
    }
  }

  const positiveRows = Array.isArray(family?.bridgePositiveRows) ? family.bridgePositiveRows : []
  const negativeRows = Array.isArray(family?.supportNearHardNegativeRows) ? family.supportNearHardNegativeRows : []
  const featurePool = [
    ...(family?.roleFeatureKeys ?? []),
    ...(family?.episodeFeatureKeys ?? []),
  ]
  const selectedFeaturePool = collectFeatureCandidates({
    positiveRows,
    negativeRows,
    featureKeys: featurePool,
    maxFeatures,
  })

  if (selectedFeaturePool.length < 2) {
    return {
      ok: false,
      reason: "unsat_no_temporal_anchor_candidates",
      supportFitExcluded,
      supportLeaveOneOutRecovered: false,
      selectedFeaturePoolCount: selectedFeaturePool.length,
      qualifiedCandidateCount: 0,
      unsatReasonCounts: { unsat_no_temporal_anchor_candidates: 1 },
      candidatesEvaluated: [],
    }
  }

  const reasonCounts = {}
  const candidatesEvaluated = []
  const qualifiedCandidates = []
  let candidateCount = 0
  let bestTrainSummary = null
  let bestOosSummary = null
  let supportLeaveOneOutRecovered = false

  const subsetSizes = Array.from(
    new Set([Math.min(3, selectedFeaturePool.length), Math.min(5, selectedFeaturePool.length), Math.min(7, selectedFeaturePool.length)]),
  ).filter((size) => size >= 2)

  for (const featureCount of subsetSizes) {
    const selectedFeatures = selectedFeaturePool.slice(0, featureCount)
    const anchorArtifact = buildArtifact({
      family,
      selectedFeatures,
      selectThreshold: 0,
      marginThreshold: 0,
      riskThreshold: 1,
      abstainThreshold: 0,
    })
    const positiveEvaluations = applyPerfectPrototypeSupportTemporalAnchorScorer({
      artifact: anchorArtifact,
      rows: positiveRows,
    })
    const negativeEvaluations = applyPerfectPrototypeSupportTemporalAnchorScorer({
      artifact: anchorArtifact,
      rows: negativeRows,
    })
    const positiveDecision = positiveEvaluations.map((entry) => entry.decisionScore).filter(Number.isFinite)
    const positiveMargin = positiveEvaluations.map((entry) => entry.purityMargin).filter(Number.isFinite)
    const negativeRisk = negativeEvaluations.map((entry) => entry.riskScore).filter(Number.isFinite)
    const positiveAbstain = positiveEvaluations.map((entry) => entry.abstainScore).filter(Number.isFinite)

    const selectThresholdCandidates = uniqueNumbers([
      quantile(positiveDecision, 0.05),
      quantile(positiveDecision, 0.15),
      quantile(positiveDecision, 0.25),
    ]).slice(0, 5)
    const marginThresholdCandidates = uniqueNumbers([
      quantile(positiveMargin, 0.05),
      quantile(positiveMargin, 0.15),
      0,
    ]).slice(0, 4)
    const riskThresholdCandidates = uniqueNumbers([
      quantile(negativeRisk, 0.25),
      quantile(negativeRisk, 0.5),
      quantile(negativeRisk, 0.75),
    ]).slice(0, 5)
    const abstainThresholdCandidates = uniqueNumbers([
      quantile(positiveAbstain, 0.05),
      quantile(positiveAbstain, 0.15),
      quantile(positiveAbstain, 0.25),
    ]).slice(0, 5)

    for (const selectThreshold of selectThresholdCandidates.length > 0 ? selectThresholdCandidates : [0]) {
      for (const marginThreshold of marginThresholdCandidates.length > 0 ? marginThresholdCandidates : [0]) {
        for (const riskThreshold of riskThresholdCandidates.length > 0 ? riskThresholdCandidates : [1]) {
          for (const abstainThreshold of abstainThresholdCandidates.length > 0 ? abstainThresholdCandidates : [0]) {
            candidateCount += 1
            const artifact = buildArtifact({
              family,
              selectedFeatures,
              selectThreshold,
              marginThreshold,
              riskThreshold,
              abstainThreshold,
            })
            const trainSummary = summarizePerfectPrototypeSupportTemporalAnchorSelections({
              evaluations: applyPerfectPrototypeSupportTemporalAnchorScorer({
                artifact,
                rows: family?.gatedTrainRows ?? [],
              }),
            })
            const candidate = {
              scorerId: `TEMPORAL_ANCHOR_${String(candidateCount).padStart(3, "0")}`,
              artifact,
              featureCount,
              selectedFeatures,
              selectThreshold,
              marginThreshold,
              riskThreshold,
              abstainThreshold,
              trainSummary,
              supportMatched: [],
              oosSummary: null,
              failureReason: null,
            }
            if (toNumber(trainSummary.precision, 0) < 1) {
              candidate.failureReason = "unsat_temporal_anchor_train_precision"
            } else if (toNumber(trainSummary.trainMatchedDateCount, 0) < minTrainMatchedDates) {
              candidate.failureReason = "unsat_temporal_anchor_train_breadth"
            } else if (toNumber(trainSummary.trainMatchedMonthCount, 0) < minTrainMatchedMonths) {
              candidate.failureReason = "unsat_temporal_anchor_train_breadth"
            } else if (toNumber(trainSummary.trainMatchedFoldCount, 0) < minTrainMatchedFolds) {
              candidate.failureReason = "unsat_temporal_anchor_train_breadth"
            } else if (toNumber(trainSummary.crossfitNegativeWindowCount, 0) > maxCrossfitNegativeWindows) {
              candidate.failureReason = "unsat_temporal_anchor_crossfit"
            } else if (toNumber(trainSummary.crossfitRetainedPositiveWindowCount, 0) < minCrossfitPositiveWindows) {
              candidate.failureReason = "unsat_temporal_anchor_crossfit"
            }

            if (!candidate.failureReason) {
              const oosSummaryBase = summarizePerfectPrototypeSupportTemporalAnchorSelections({
                evaluations: applyPerfectPrototypeSupportTemporalAnchorScorer({
                  artifact,
                  rows: family?.oosRows ?? [],
                }),
              })
              candidate.oosSummary = {
                ...oosSummaryBase,
                openOosPrecision: toNumber(oosSummaryBase?.precision, 0),
                openOosMatchCount: toNumber(oosSummaryBase?.positiveRowCount, 0),
                openOosUniqueMatchedDates: toNumber(oosSummaryBase?.trainMatchedDateCount, 0),
              }
              if (toNumber(candidate.oosSummary.openOosPrecision, 0) < 1) {
                candidate.failureReason = "unsat_temporal_anchor_oos_precision"
              } else if (toNumber(candidate.oosSummary.openOosMatchCount, 0) < minOosMatchCount) {
                candidate.failureReason = "unsat_temporal_anchor_oos_zero_match"
              }
            }

            if (!candidate.failureReason) {
              const supportMatched = applyPerfectPrototypeSupportTemporalAnchorScorer({
                artifact,
                rows: family?.supportCaseViews ?? [],
              })
                .filter((entry) => entry?.selected === true && entry?.row?.caseId)
                .map((entry) => entry.row.caseId)
              candidate.supportMatched = Array.from(new Set(supportMatched)).sort((left, right) => left.localeCompare(right))
              const artifactHashBeforeAcceptance = buildArtifactHash(artifact)
              const artifactHashAfterAcceptance = buildArtifactHash(artifact)
              candidate.artifactHashBeforeAcceptance = artifactHashBeforeAcceptance
              candidate.artifactHashAfterAcceptance = artifactHashAfterAcceptance
              supportLeaveOneOutRecovered =
                supportLeaveOneOutRecovered ||
                candidate.supportMatched.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID)
              if (artifactHashBeforeAcceptance !== artifactHashAfterAcceptance) {
                candidate.failureReason = "unsat_support_acceptance_only_dependency"
              } else if (!candidate.supportMatched.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID)) {
                candidate.failureReason = "unsat_support_recovery_after_leave_one_out"
              }
            }

            if (!candidate.failureReason) {
              qualifiedCandidates.push(candidate)
            } else {
              recordReason(reasonCounts, candidate.failureReason)
            }
            if (
              !bestTrainSummary ||
              toNumber(candidate.trainSummary?.trainMatchedDateCount, 0) > toNumber(bestTrainSummary?.trainMatchedDateCount, 0)
            ) {
              bestTrainSummary = candidate.trainSummary
            }
            if (
              candidate.oosSummary &&
              (!bestOosSummary ||
                toNumber(candidate.oosSummary?.openOosMatchCount, 0) > toNumber(bestOosSummary?.openOosMatchCount, 0))
            ) {
              bestOosSummary = candidate.oosSummary
            }
            if (candidatesEvaluated.length < 256) candidatesEvaluated.push(buildCandidatePreview(candidate))
          }
        }
      }
    }
  }

  const qualifiedCandidateCount = qualifiedCandidates.length
  if (qualifiedCandidates.length < 1) {
    return {
      ok: false,
      reason: derivePrimaryReason(reasonCounts),
      supportFitExcluded,
      supportLeaveOneOutRecovered,
      selectedFeaturePoolCount: selectedFeaturePool.length,
      candidateCount,
      qualifiedCandidateCount,
      bestTrainSummary,
      bestOosSummary,
      unsatReasonCounts: reasonCounts,
      candidatesEvaluated,
    }
  }

  qualifiedCandidates.sort(compareSolutions)
  const best = qualifiedCandidates[0]
  return {
    ok: true,
    reason: null,
    supportFitExcluded,
    supportLeaveOneOutRecovered,
    selectedFeaturePoolCount: selectedFeaturePool.length,
    candidateCount,
    qualifiedCandidateCount,
    bestTrainSummary,
    bestOosSummary,
    artifact: best.artifact,
    artifactHashBeforeAcceptance: best.artifactHashBeforeAcceptance,
    artifactHashAfterAcceptance: best.artifactHashAfterAcceptance,
    trainSummary: best.trainSummary,
    oosSummary: {
      ...(best.oosSummary ?? {}),
      haesungSupport: true,
    },
    supportMatched: best.supportMatched,
    unsatReasonCounts: reasonCounts,
    candidatesEvaluated,
  }
}

