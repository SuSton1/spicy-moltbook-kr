import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "./perfect_prototype_support_case.mjs"
import {
  applyPerfectPrototypeSupportBoundaryResidualScorer,
  summarizePerfectPrototypeSupportBoundaryResidualSelections,
} from "./perfect_prototype_support_boundary_residual_scorer.mjs"
import { buildPerfectPrototypeSupportBoundaryResidualUnsat } from "./perfect_prototype_support_boundary_residual_unsat.mjs"

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
    .map((value) => num(value))
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

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const uniqueNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.round(value * 1000) / 1000),
    ),
  ).sort((left, right) => left - right)

const recordReason = (reasonCounts, reason) => {
  if (!reason) return
  reasonCounts[reason] = Number(reasonCounts[reason] ?? 0) + 1
}

const buildCombinationIndexes = (count, choose) => {
  const out = []
  const recurse = (start, remaining, picked) => {
    if (remaining === 0) {
      out.push(picked.slice())
      return
    }
    for (let index = start; index <= count - remaining; index += 1) {
      picked.push(index)
      recurse(index + 1, remaining - 1, picked)
      picked.pop()
    }
  }
  recurse(0, choose, [])
  return out
}

const featureBucketOf = (featureKey) => {
  const text = String(featureKey ?? "")
  const groupMatch = text.match(/^sig\.boundary\.group\.([^.]+)\./)
  if (groupMatch) return `group:${groupMatch[1]}`
  return text.replace(/\.(residualMargin|localBoundaryMargin|stabilityShare|recurrenceCarry)$/, "")
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
    const direction = positiveMean >= negativeMean ? 1 : -1
    const center = (positiveMean + negativeMean) / 2
    const separation = Math.abs(positiveMean - negativeMean) / Math.max(0.05, scale)
    if (separation < 0.05) continue
    scored.push({
      featureKey,
      direction,
      center,
      scale,
      separation,
      weight: Math.max(0.1, Math.min(3, separation)),
      bucket: featureBucketOf(featureKey),
      positiveMean,
      negativeMean,
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

const buildArtifact = ({
  family,
  selectedFeatures,
  selectThreshold,
  marginThreshold,
  abstainThreshold,
} = {}) => ({
  familyId: family?.familyId ?? "low_gap_top_continuation",
  surfaceName: family?.surfaceName ?? null,
  gateTokens: family?.gateTokens ?? [],
  supportCaseIds: [],
  selectedFeatures: (Array.isArray(selectedFeatures) ? selectedFeatures : []).map((feature) => ({
    featureKey: feature.featureKey,
    direction: feature.direction,
    center: feature.center,
    scale: feature.scale,
    weight: feature.weight,
    separation: feature.separation,
  })),
  minFeatureMatchCount: Math.max(1, Math.ceil((selectedFeatures?.length ?? 0) / 2)),
  marginFeatureKey: "sig.boundary.marginMin",
  falsePositivePressureFeatureKey: "sig.boundary.falsePositivePressure",
  selectThreshold,
  marginThreshold,
  abstainThreshold,
})

const buildScoreSeries = ({ artifact, rows = [] } = {}) =>
  applyPerfectPrototypeSupportBoundaryResidualScorer({
    artifact,
    rows,
  })

const buildThresholdCandidates = ({
  artifact,
  positiveRows = [],
  negativeRows = [],
} = {}) => {
  const positiveEvaluations = buildScoreSeries({ artifact, rows: positiveRows })
  const negativeEvaluations = buildScoreSeries({ artifact, rows: negativeRows })
  const positiveScores = positiveEvaluations.map((entry) => entry.supportScore).filter(Number.isFinite)
  const negativeScores = negativeEvaluations.map((entry) => entry.supportScore).filter(Number.isFinite)
  const positiveMargins = positiveEvaluations.map((entry) => entry.hardNegativeMargin).filter(Number.isFinite)
  const positiveAbstainScores = positiveEvaluations.map((entry) => entry.abstainScore).filter(Number.isFinite)
  const selectThresholdCandidates = uniqueNumbers([
    quantile(positiveScores, 0.05),
    quantile(positiveScores, 0.15),
    quantile(positiveScores, 0.25),
    quantile(positiveScores, 0.35),
    Math.max(...negativeScores, Number.NEGATIVE_INFINITY) + 0.001,
  ]).slice(0, 6)
  const marginThresholdCandidates = uniqueNumbers([
    quantile(positiveMargins, 0.05),
    quantile(positiveMargins, 0.15),
    quantile(positiveMargins, 0.25),
    0,
  ]).slice(0, 5)
  const abstainThresholdCandidates = uniqueNumbers([
    quantile(positiveAbstainScores, 0.05),
    quantile(positiveAbstainScores, 0.15),
    quantile(positiveAbstainScores, 0.25),
  ]).slice(0, 5)
  return {
    selectThresholdCandidates:
      selectThresholdCandidates.length > 0 ? selectThresholdCandidates : [0],
    marginThresholdCandidates:
      marginThresholdCandidates.length > 0 ? marginThresholdCandidates : [0],
    abstainThresholdCandidates:
      abstainThresholdCandidates.length > 0 ? abstainThresholdCandidates : [0],
  }
}

const buildCandidatePreview = (candidate) => ({
  featureCount: Number(candidate?.featureCount ?? 0),
  selectThreshold: Number(candidate?.selectThreshold ?? 0),
  marginThreshold: Number(candidate?.marginThreshold ?? 0),
  abstainThreshold: Number(candidate?.abstainThreshold ?? 0),
  selectedFeatureKeys: (candidate?.selectedFeatures ?? []).map((feature) => feature?.featureKey).filter(Boolean),
  supportMatched: Array.isArray(candidate?.supportMatched) ? candidate.supportMatched : [],
  failureReason: candidate?.failureReason ?? null,
  trainSummary: candidate?.trainSummary ?? {},
  oosSummary: candidate?.oosSummary ?? {},
})

const compareSolutions = (left, right) => {
  if (
    toNumber(right?.oosSummary?.positiveRowCount, 0) !==
    toNumber(left?.oosSummary?.positiveRowCount, 0)
  ) {
    return toNumber(right?.oosSummary?.positiveRowCount, 0) - toNumber(left?.oosSummary?.positiveRowCount, 0)
  }
  if (
    toNumber(right?.trainSummary?.trainMatchedDateCount, 0) !==
    toNumber(left?.trainSummary?.trainMatchedDateCount, 0)
  ) {
    return (
      toNumber(right?.trainSummary?.trainMatchedDateCount, 0) -
      toNumber(left?.trainSummary?.trainMatchedDateCount, 0)
    )
  }
  if (
    toNumber(right?.trainSummary?.trainMatchedMonthCount, 0) !==
    toNumber(left?.trainSummary?.trainMatchedMonthCount, 0)
  ) {
    return (
      toNumber(right?.trainSummary?.trainMatchedMonthCount, 0) -
      toNumber(left?.trainSummary?.trainMatchedMonthCount, 0)
    )
  }
  return Number(left?.featureCount ?? 0) - Number(right?.featureCount ?? 0)
}

const derivePrimaryReason = (reasonCounts) =>
  Object.entries(reasonCounts ?? {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ??
  "unsat_boundary_residual_not_separable"

export const calibratePerfectPrototypeSupportBoundaryResidualScorer = ({
  family,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  minCrossfitPositiveWindows = 2,
  maxCrossfitNegativeWindows = 0,
  minOosMatchCount = 3,
  maxFeatureCount = 4,
  maxCandidateFeatures = 8,
} = {}) => {
  const calibrationRows = Array.isArray(family?.gatedTrainRows) ? family.gatedTrainRows : []
  const calibrationPositiveRows = calibrationRows.filter((row) => row?.outcomeHitTarget === true)
  const calibrationNegativeRows = calibrationRows.filter((row) => row?.outcomeHitTarget !== true)
  const supportFitExcluded = family?.supportFitExcluded === true
  if (supportFitExcluded !== true) {
    return buildPerfectPrototypeSupportBoundaryResidualUnsat({
      reason: "unsat_support_acceptance_only_dependency",
      reasonCounts: { unsat_support_acceptance_only_dependency: 1 },
      familySummary: family?.summary,
      supportFitExcluded,
    })
  }
  const featureCandidates = collectFeatureCandidates({
    positiveRows: calibrationPositiveRows,
    negativeRows: calibrationNegativeRows,
    featureKeys: family?.boundaryResidualFeatureKeys ?? [],
    maxFeatures: maxCandidateFeatures,
  })
  if (featureCandidates.length < 2) {
    return buildPerfectPrototypeSupportBoundaryResidualUnsat({
      reason: "unsat_boundary_residual_not_separable",
      reasonCounts: { unsat_boundary_residual_not_separable: 1 },
      familySummary: family?.summary,
      supportFitExcluded,
      scorerCandidateCount: featureCandidates.length,
    })
  }

  const reasonCounts = {}
  const candidatesEvaluated = []
  let triedCandidateCount = 0
  let scorerQualifiedCount = 0
  let scorerHistoricalSupportMatchedCount = 0
  let supportLeaveOneOutRecovered = false
  let bestTrainSummary = null
  let bestOosSummary = null
  let bestSolution = null

  const featureCountMax = Math.min(Math.max(2, Math.floor(Number(maxFeatureCount) || 4)), featureCandidates.length)
  for (let featureCount = 2; featureCount <= featureCountMax; featureCount += 1) {
    for (const indexes of buildCombinationIndexes(featureCandidates.length, featureCount)) {
      const selectedFeatures = indexes.map((index) => featureCandidates[index])
      const seedArtifact = buildArtifact({
        family,
        selectedFeatures,
        selectThreshold: 0,
        marginThreshold: 0,
        abstainThreshold: 0,
      })
      const thresholds = buildThresholdCandidates({
        artifact: seedArtifact,
        positiveRows: calibrationPositiveRows,
        negativeRows: calibrationNegativeRows,
      })
      for (const selectThreshold of thresholds.selectThresholdCandidates) {
        for (const marginThreshold of thresholds.marginThresholdCandidates) {
          for (const abstainThreshold of thresholds.abstainThresholdCandidates) {
            const artifact = buildArtifact({
              family,
              selectedFeatures,
              selectThreshold,
              marginThreshold,
              abstainThreshold,
            })
            const trainSummary = summarizePerfectPrototypeSupportBoundaryResidualSelections({
              evaluations: applyPerfectPrototypeSupportBoundaryResidualScorer({
                artifact,
                rows: calibrationRows,
              }),
              supportCaseIds: [],
            })
            const candidate = {
              featureCount,
              selectThreshold,
              marginThreshold,
              abstainThreshold,
              selectedFeatures,
              trainSummary,
              supportMatched: [],
              oosSummary: null,
              failureReason: null,
            }
            triedCandidateCount += 1

            if (toNumber(trainSummary.precision, 0) < 1) {
              candidate.failureReason = "unsat_scorer_train_precision"
            } else if (toNumber(trainSummary.trainMatchedDateCount, 0) < minTrainMatchedDates) {
              candidate.failureReason = "unsat_non_support_train_breadth"
            } else if (toNumber(trainSummary.trainMatchedMonthCount, 0) < minTrainMatchedMonths) {
              candidate.failureReason = "unsat_non_support_train_breadth"
            } else if (toNumber(trainSummary.trainMatchedFoldCount, 0) < minTrainMatchedFolds) {
              candidate.failureReason = "unsat_non_support_train_breadth"
            } else if (
              toNumber(trainSummary.crossfitNegativeWindowCount, 0) > maxCrossfitNegativeWindows
            ) {
              candidate.failureReason = "unsat_non_support_crossfit_recurrence"
            } else if (
              toNumber(trainSummary.crossfitRetainedPositiveWindowCount, 0) < minCrossfitPositiveWindows
            ) {
              candidate.failureReason = "unsat_non_support_crossfit_recurrence"
            }

            if (!candidate.failureReason) {
              scorerQualifiedCount += 1
              const supportEvaluations = applyPerfectPrototypeSupportBoundaryResidualScorer({
                artifact,
                rows: family?.supportCaseViews ?? [],
              })
              const supportMatched = supportEvaluations
                .filter((entry) => entry.selected === true)
                .map((entry) => entry.row.caseId)
                .filter(Boolean)
              candidate.supportMatched = supportMatched
              if (supportMatched.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID)) {
                supportLeaveOneOutRecovered = true
                scorerHistoricalSupportMatchedCount += 1
              } else {
                candidate.failureReason = "unsat_support_recovery_after_leave_one_out"
              }
            }

            if (!candidate.failureReason) {
              const oosSummary = summarizePerfectPrototypeSupportBoundaryResidualSelections({
                evaluations: applyPerfectPrototypeSupportBoundaryResidualScorer({
                  artifact,
                  rows: family?.oosRows ?? [],
                }),
                supportCaseIds: candidate.supportMatched,
              })
              candidate.oosSummary = oosSummary
              if (toNumber(oosSummary.selectedRowCount, 0) < minOosMatchCount) {
                candidate.failureReason = "unsat_scorer_oos_zero_match"
              } else if (toNumber(oosSummary.precision, 0) < 1) {
                candidate.failureReason = "unsat_scorer_oos_precision"
              }
            }

            if (candidatesEvaluated.length < 256) candidatesEvaluated.push(buildCandidatePreview(candidate))
            if (candidate.failureReason) {
              recordReason(reasonCounts, candidate.failureReason)
              if (!bestTrainSummary || toNumber(candidate.trainSummary?.trainMatchedDateCount, 0) > toNumber(bestTrainSummary?.trainMatchedDateCount, 0)) {
                bestTrainSummary = candidate.trainSummary
              }
              if (
                candidate.oosSummary &&
                (!bestOosSummary || toNumber(candidate.oosSummary?.positiveRowCount, 0) > toNumber(bestOosSummary?.positiveRowCount, 0))
              ) {
                bestOosSummary = candidate.oosSummary
              }
              continue
            }
            if (!bestSolution || compareSolutions(candidate, bestSolution) < 0) {
              bestSolution = candidate
            }
          }
        }
      }
    }
  }

  if (!bestSolution) {
    return buildPerfectPrototypeSupportBoundaryResidualUnsat({
      reason: derivePrimaryReason(reasonCounts),
      reasonCounts,
      familySummary: family?.summary,
      supportFitExcluded,
      supportLeaveOneOutRecovered,
      scorerCandidateCount: featureCandidates.length,
      scorerQualifiedCount,
      scorerHistoricalSupportMatchedCount,
      triedCandidateCount,
      candidatesEvaluated,
      bestTrainSummary,
      bestOosSummary,
    })
  }

  const artifact = buildArtifact({
    family,
    selectedFeatures: bestSolution.selectedFeatures,
    selectThreshold: bestSolution.selectThreshold,
    marginThreshold: bestSolution.marginThreshold,
    abstainThreshold: bestSolution.abstainThreshold,
  })
  artifact.supportCaseIds = bestSolution.supportMatched
  artifact.fitDiagnostics = {
    supportFitExcluded,
    scorerCandidateCount: featureCandidates.length,
    scorerQualifiedCount,
    scorerHistoricalSupportMatchedCount,
    triedCandidateCount,
    boundaryResidualFeatureCount: Number(family?.summary?.boundaryResidualFeatureCount ?? 0),
    boundaryResidualPositiveGroupCount: Number(family?.summary?.boundaryResidualPositiveGroupCount ?? 0),
  }

  return {
    ok: true,
    supportFitExcluded,
    supportLeaveOneOutRecovered: true,
    scorerCandidateCount: featureCandidates.length,
    scorerQualifiedCount,
    scorerHistoricalSupportMatchedCount: 1,
    artifact,
    trainSummary: bestSolution.trainSummary,
    oosSummary: bestSolution.oosSummary,
    triedCandidateCount,
    candidatesEvaluated,
  }
}
