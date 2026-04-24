import crypto from "node:crypto"

import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "./perfect_prototype_support_case.mjs"
import {
  applyPerfectPrototypeSupportTop1QueryRanker,
  summarizePerfectPrototypeSupportTop1Selections,
} from "./perfect_prototype_support_top1_query_ranker.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const minValue = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return Math.min(...filtered)
}

const maxValue = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return Math.max(...filtered)
}

const midpoint = (left, right) => {
  const leftNumber = num(left)
  const rightNumber = num(right)
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return null
  return (leftNumber + rightNumber) / 2
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
  const uniqueFeatureKeys = Array.from(
    new Set((Array.isArray(featureKeys) ? featureKeys : []).map((featureKey) => String(featureKey ?? "").trim()).filter(Boolean)),
  )
  const scored = []
  for (const featureKey of uniqueFeatureKeys) {
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
  gapThreshold,
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
  riskFeatureKey: "sig.ctrlResidual.regimeResidualRisk",
  peerPressureFeatureKey: "sig.outRank.negativePeerPressure",
  riskWeight: 1,
  selectThreshold,
  gapThreshold,
  riskThreshold,
  abstainThreshold,
  supportAcceptanceOnly: true,
})

const buildCandidatePreview = (candidate) => ({
  featureCount: Number(candidate?.featureCount ?? 0),
  selectedFeatureKeys: (candidate?.selectedFeatures ?? []).map((feature) => feature?.featureKey).filter(Boolean),
  selectThreshold: Number(candidate?.selectThreshold ?? 0),
  gapThreshold: Number(candidate?.gapThreshold ?? 0),
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
  "unsat_no_top1_query_candidates"

const selectTop1RowsByLabel = ({ artifact, rows = [], label } = {}) =>
  applyPerfectPrototypeSupportTop1QueryRanker({ artifact, rows })
    .filter((entry) => entry?.isTop1 === true && String(entry?.row?.queryLabel ?? "").trim() === String(label ?? "").trim())

export const calibratePerfectPrototypeSupportTop1QueryRanker = ({
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

  const positiveRows = Array.isArray(family?.calibrationPositiveRows)
    ? family.calibrationPositiveRows
    : Array.isArray(family?.bridgePositiveRows)
      ? family.bridgePositiveRows
      : []
  const fallbackNegativeRows = Array.isArray(family?.gatedTrainRows)
    ? family.gatedTrainRows.filter((row) => row?.outcomeHitTarget !== true)
    : []
  const calibrationNegativeRows =
    Array.isArray(family?.calibrationNegativeRows) && family.calibrationNegativeRows.length >= 3
      ? family.calibrationNegativeRows
      : Array.isArray(family?.supportNearHardNegativeRows) && family.supportNearHardNegativeRows.length >= 3
        ? family.supportNearHardNegativeRows
        : fallbackNegativeRows
  const negativeRows = calibrationNegativeRows
  const preferredAuditFeaturePool =
    Array.isArray(family?.portfolioSelectedFeatureKeys) && family.portfolioSelectedFeatureKeys.length > 0
      ? family.portfolioSelectedFeatureKeys
      : Array.isArray(family?.shadowWinnerSlateAuditFeatureKeys) && family.shadowWinnerSlateAuditFeatureKeys.length > 0
      ? family.shadowWinnerSlateAuditFeatureKeys
      : null
  const featurePool = Array.from(
    new Set(
      (preferredAuditFeaturePool ?? [
        ...(family?.admissionFeatureKeys ?? []),
        ...(family?.epTransitionFeatureKeys ?? []),
        ...(family?.roleFeatureKeys ?? []),
        ...(family?.episodeFeatureKeys ?? []),
        ...(family?.queryFeatureKeys ?? []),
        ...(family?.residualFeatureKeys ?? []),
        ...(family?.outrankFeatureKeys ?? []),
        ...(family?.winnerQueryFeatureKeys ?? []),
        ...(family?.shadowWinnerSlateFeatureKeys ?? []),
      ])
        .map((featureKey) => String(featureKey ?? "").trim())
        .filter(Boolean),
    ),
  )
  const selectedFeaturePool = collectFeatureCandidates({
    positiveRows,
    negativeRows,
    featureKeys: featurePool,
    maxFeatures,
  })

  if (selectedFeaturePool.length < 2) {
    return {
      ok: false,
      reason: "unsat_no_top1_query_candidates",
      supportFitExcluded,
      supportLeaveOneOutRecovered: false,
      selectedFeaturePoolCount: selectedFeaturePool.length,
      candidateCount: 0,
      qualifiedCandidateCount: 0,
      unsatReasonCounts: { unsat_no_top1_query_candidates: 1 },
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
    { length: Math.max(0, Math.min(selectedFeaturePool.length, Math.max(2, Math.floor(Number(maxFeatures) || 8))) - 1) },
    (_, index) => index + 2,
  )

  for (const featureCount of subsetSizes) {
    const selectedFeatures = selectedFeaturePool.slice(0, featureCount)
    const baseArtifact = buildArtifact({
      family,
      selectedFeatures,
      selectThreshold: 0,
      gapThreshold: 0,
      riskThreshold: 1,
      abstainThreshold: 0,
    })
    const positiveTop1 = selectTop1RowsByLabel({
      artifact: baseArtifact,
      rows: family?.gatedTrainRows ?? [],
      label: "positive",
    })
    const negativeTop1 = selectTop1RowsByLabel({
      artifact: baseArtifact,
      rows: family?.gatedTrainRows ?? [],
      label: "negative",
    })
    const positiveScores = positiveTop1.map((entry) => entry.queryScore).filter(Number.isFinite)
    const positiveGaps = positiveTop1.map((entry) => entry.queryGap).filter(Number.isFinite)
    const positiveRisk = positiveTop1.map((entry) => entry.riskScore).filter(Number.isFinite)
    const negativeRisk = negativeTop1.map((entry) => entry.riskScore).filter(Number.isFinite)
    const negativeScores = negativeTop1.map((entry) => entry.queryScore).filter(Number.isFinite)
    const negativeGaps = negativeTop1.map((entry) => entry.queryGap).filter(Number.isFinite)
    const negativeAbstain = negativeTop1.map((entry) => entry.abstainScore).filter(Number.isFinite)
    const positiveAbstain = positiveTop1.map((entry) => entry.abstainScore).filter(Number.isFinite)

    const selectThresholdCandidates = uniqueNumbers([
      0,
      minValue(positiveScores),
      quantile(positiveScores, 0.05),
      quantile(positiveScores, 0.15),
      quantile(positiveScores, 0.25),
      quantile(negativeScores, 0.75),
      quantile(negativeScores, 0.9),
      midpoint(minValue(positiveScores), maxValue(negativeScores)),
    ]).slice(0, 8)
    const gapThresholdCandidates = uniqueNumbers([
      0,
      minValue(positiveGaps),
      quantile(positiveGaps, 0.05),
      quantile(positiveGaps, 0.15),
      quantile(negativeGaps, 0.75),
      midpoint(minValue(positiveGaps), maxValue(negativeGaps)),
    ]).slice(0, 6)
    const riskThresholdCandidates = uniqueNumbers([
      maxValue(positiveRisk),
      quantile(positiveRisk, 0.75),
      quantile(positiveRisk, 0.9),
      quantile(negativeRisk, 0.1),
      quantile(negativeRisk, 0.25),
      midpoint(maxValue(positiveRisk), quantile(negativeRisk, 0.1)),
    ]).slice(0, 6)
    const abstainThresholdCandidates = uniqueNumbers([
      0,
      minValue(positiveAbstain),
      quantile(positiveAbstain, 0.05),
      quantile(positiveAbstain, 0.15),
      quantile(positiveAbstain, 0.25),
      quantile(negativeAbstain, 0.75),
      quantile(negativeAbstain, 0.9),
      midpoint(minValue(positiveAbstain), maxValue(negativeAbstain)),
    ]).slice(0, 8)

    for (const selectThreshold of selectThresholdCandidates.length > 0 ? selectThresholdCandidates : [0]) {
      for (const gapThreshold of gapThresholdCandidates.length > 0 ? gapThresholdCandidates : [0]) {
        for (const riskThreshold of riskThresholdCandidates.length > 0 ? riskThresholdCandidates : [1]) {
          for (const abstainThreshold of abstainThresholdCandidates.length > 0 ? abstainThresholdCandidates : [0]) {
            candidateCount += 1
            const artifact = buildArtifact({
              family,
              selectedFeatures,
              selectThreshold,
              gapThreshold,
              riskThreshold,
              abstainThreshold,
            })
            const trainSummary = summarizePerfectPrototypeSupportTop1Selections({
              evaluations: applyPerfectPrototypeSupportTop1QueryRanker({
                artifact,
                rows: family?.gatedTrainRows ?? [],
              }),
            })
            const candidate = {
              rankerId: `TOP1_QUERY_${String(candidateCount).padStart(3, "0")}`,
              artifact,
              featureCount,
              selectedFeatures,
              selectThreshold,
              gapThreshold,
              riskThreshold,
              abstainThreshold,
              trainSummary,
              supportMatched: [],
              oosSummary: null,
              failureReason: null,
            }
            if (toNumber(trainSummary.precision, 0) < 1) {
              candidate.failureReason = "unsat_top1_query_train_precision"
            } else if (toNumber(trainSummary.trainMatchedDateCount, 0) < minTrainMatchedDates) {
              candidate.failureReason = "unsat_top1_query_train_breadth"
            } else if (toNumber(trainSummary.trainMatchedMonthCount, 0) < minTrainMatchedMonths) {
              candidate.failureReason = "unsat_top1_query_train_breadth"
            } else if (toNumber(trainSummary.trainMatchedFoldCount, 0) < minTrainMatchedFolds) {
              candidate.failureReason = "unsat_top1_query_train_breadth"
            } else if (toNumber(trainSummary.crossfitNegativeWindowCount, 0) > maxCrossfitNegativeWindows) {
              candidate.failureReason = "unsat_top1_query_crossfit"
            } else if (toNumber(trainSummary.crossfitRetainedPositiveWindowCount, 0) < minCrossfitPositiveWindows) {
              candidate.failureReason = "unsat_top1_query_crossfit"
            }

            if (!candidate.failureReason) {
              const oosSummaryBase = summarizePerfectPrototypeSupportTop1Selections({
                evaluations: applyPerfectPrototypeSupportTop1QueryRanker({
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
                candidate.failureReason = "unsat_top1_query_oos_precision"
              } else if (toNumber(candidate.oosSummary.openOosMatchCount, 0) < minOosMatchCount) {
                candidate.failureReason = "unsat_top1_query_oos_zero_match"
              }
            }

            if (!candidate.failureReason) {
              const supportMatched = applyPerfectPrototypeSupportTop1QueryRanker({
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
    supportFitExcluded,
    supportLeaveOneOutRecovered,
    selectedFeaturePoolCount: selectedFeaturePool.length,
    candidateCount,
    qualifiedCandidateCount,
    artifact: best.artifact,
    artifactHashBeforeAcceptance: best.artifactHashBeforeAcceptance,
    artifactHashAfterAcceptance: best.artifactHashAfterAcceptance,
    supportMatched: best.supportMatched,
    trainSummary: best.trainSummary,
    oosSummary: best.oosSummary,
    candidatesEvaluated,
  }
}
