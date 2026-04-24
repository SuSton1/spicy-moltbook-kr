import {
  applyPerfectPrototypeSupportBoundaryLocalExpert,
  summarizePerfectPrototypeSupportBoundaryLocalExpertSelections,
} from "./perfect_prototype_support_boundary_local_expert.mjs"
import { buildPerfectPrototypeSupportBoundaryExpertUnsat } from "./perfect_prototype_support_boundary_expert_unsat.mjs"
import { summarizePerfectPrototypeSupportExpertCoverageSignatures } from "./perfect_prototype_support_expert_coverage_signature.mjs"

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
  const groupMatch = text.match(/^sig\.recurBoundary\.group\.([^.]+)\./)
  if (groupMatch) return `group:${groupMatch[1]}`
  const componentMatch = text.match(/^sig\.carrierGraph\.component\.([^.]+)\./)
  if (componentMatch) return `component:${componentMatch[1]}`
  const basinMatch = text.match(/^sig\.corridorBasin\.basin\.([^.]+)\./)
  if (basinMatch) return `basin:${basinMatch[1]}`
  const simplexBasinMatch = text.match(/^sig\.simplex\.basin\.([^.]+)\./)
  if (simplexBasinMatch) return `simplex:${simplexBasinMatch[1]}`
  if (text.startsWith("sig.simplex.global.")) return "simplex:global"
  const ordinalGroupMatch = text.match(/^sig\.ordinalMotif\.group\.([^.]+)\./)
  if (ordinalGroupMatch) return `ordinal:${ordinalGroupMatch[1]}`
  return text.replace(
    /\.(posNeighborDateBreadth|posNeighborMonthBreadth|posNeighborFoldBreadth|posNeighborWindowBreadth|localBreadthPurityGap|localWindowStabilityGap|localFoldPersistenceGap|localRecoveryMargin|crossfitRecoveryShare|crossfitLeakShare|neighborMargin|neighborPurityGap|neighborBreadthCarry|posComponentEdgeMargin|negBorderEdgePressure|componentPurity|componentDateBreadth|componentMonthBreadth|componentFoldBreadth|componentWindowBreadth|componentPersistenceShare|componentBoundaryGap|recurrenceCarrierScore|falsePositivePressure|connectivity|boundaryGap|breadthCarry|motifAgreement|negativeMotifConflict|recurrenceBreadthCarry|recurrenceLeakPressure|supportRecoveryPotential|projectionMargin|distance|marginGap|positivePotential|negativePotential|affinity|exclusiveAffinity|borderMargin|topAffinity|secondAffinity|affinityGap|basinEntropy|positiveBorderMargin)$/,
    "",
  )
}

const collectFeatureCandidates = ({
  positiveRows = [],
  negativeRows = [],
  featureKeys = [],
  requiredGroup = null,
  maxFeatures = 6,
} = {}) => {
  const scored = []
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    if (featureKey === "sig.recurBoundary.negNeighborLeakShare") continue
    if (featureKey === "sig.boundary.falsePositivePressure") continue
    if (featureKey === "sig.carrierGraph.negBorderEdgePressure") continue
    if (featureKey === "sig.carrierGraph.falsePositivePressure") continue
    if (featureKey === "sig.ordinalMotif.negativeMotifConflict") continue
    if (featureKey === "sig.ordinalMotif.recurrenceLeakPressure") continue
    if (featureKey === "sig.corridorBasin.negativePotential") continue
    if (featureKey === "sig.corridorBasin.falsePositivePressure") continue
    if (requiredGroup && featureKey.startsWith("sig.recurBoundary.group.")) {
      const groupMatch = featureKey.match(/^sig\.recurBoundary\.group\.([^.]+)\./)
      if (groupMatch?.[1] && groupMatch[1] !== requiredGroup) continue
    }
    if (requiredGroup && featureKey.startsWith("sig.carrierGraph.component.")) {
      const componentMatch = featureKey.match(/^sig\.carrierGraph\.component\.([^.]+)\./)
      if (componentMatch?.[1] && componentMatch[1] !== requiredGroup) continue
    }
    if (requiredGroup && featureKey.startsWith("sig.corridorBasin.basin.")) {
      const basinMatch = featureKey.match(/^sig\.corridorBasin\.basin\.([^.]+)\./)
      if (basinMatch?.[1] && basinMatch[1] !== requiredGroup) continue
    }
    if (requiredGroup && featureKey.startsWith("sig.simplex.basin.")) {
      const simplexMatch = featureKey.match(/^sig\.simplex\.basin\.([^.]+)\./)
      if (simplexMatch?.[1] && simplexMatch[1] !== requiredGroup) continue
    }
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
    if (separation < 0.08) continue
    scored.push({
      featureKey,
      direction,
      center,
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
    if (selected.length >= Math.max(1, Math.floor(Number(maxFeatures) || 6))) break
  }
  return selected
}

const buildArtifact = ({
  family,
  groupId,
  expertId,
  selectedFeatures,
  riskWeight,
  selectThreshold,
  marginThreshold,
  riskThreshold,
  abstainThreshold,
} = {}) => ({
  expertId,
  familyId: family?.familyId ?? "low_gap_top_continuation",
  surfaceName: family?.surfaceName ?? null,
  gateTokens: family?.gateTokens ?? [],
  requiredCarrierComponent:
    String(family?.localExpertDefaults?.requiredGroupType ?? "").trim() === "carrierComponent"
      ? groupId
      : null,
  requiredDominantGroup:
    String(family?.localExpertDefaults?.requiredGroupType ?? "").trim() === "carrierComponent"
      ? null
      : groupId,
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
  marginFeatureKey: family?.localExpertDefaults?.marginFeatureKey ?? "sig.recurBoundary.localRecoveryMargin",
  riskFeatureKey: family?.localExpertDefaults?.riskFeatureKey ?? "sig.recurBoundary.negNeighborLeakShare",
  falsePositivePressureFeatureKey:
    family?.localExpertDefaults?.falsePositivePressureFeatureKey ?? "sig.boundary.falsePositivePressure",
  riskWeight,
  selectThreshold,
  marginThreshold,
  riskThreshold,
  abstainThreshold,
})

const buildThresholdCandidates = ({
  artifact,
  positiveRows = [],
  negativeRows = [],
} = {}) => {
  const positiveEvaluations = applyPerfectPrototypeSupportBoundaryLocalExpert({
    artifact,
    rows: positiveRows,
  })
  const negativeEvaluations = applyPerfectPrototypeSupportBoundaryLocalExpert({
    artifact,
    rows: negativeRows,
  })
  const positiveDecision = positiveEvaluations.map((entry) => entry.decisionScore).filter(Number.isFinite)
  const negativeDecision = negativeEvaluations.map((entry) => entry.decisionScore).filter(Number.isFinite)
  const positiveMargin = positiveEvaluations.map((entry) => entry.purityMargin).filter(Number.isFinite)
  const positiveRisk = positiveEvaluations.map((entry) => entry.riskPressure).filter(Number.isFinite)
  const negativeAbstain = negativeEvaluations.map((entry) => entry.abstainScore).filter(Number.isFinite)
  const positiveAbstain = positiveEvaluations.map((entry) => entry.abstainScore).filter(Number.isFinite)

  return {
    selectThresholdCandidates: uniqueNumbers([
      quantile(positiveDecision, 0.05),
      quantile(positiveDecision, 0.15),
      Math.max(...negativeDecision, Number.NEGATIVE_INFINITY) + 0.001,
    ]).slice(0, 5),
    marginThresholdCandidates: uniqueNumbers([
      quantile(positiveMargin, 0.05),
      quantile(positiveMargin, 0.15),
      0,
    ]).slice(0, 4),
    riskThresholdCandidates: uniqueNumbers([
      quantile(positiveRisk, 0.75),
      quantile(positiveRisk, 0.9),
      average(positiveRisk),
    ]).slice(0, 4),
    abstainThresholdCandidates: uniqueNumbers([
      quantile(positiveAbstain, 0.05),
      quantile(positiveAbstain, 0.15),
      Math.max(...negativeAbstain, Number.NEGATIVE_INFINITY) + 0.001,
    ]).slice(0, 5),
  }
}

const buildCandidatePreview = (candidate) => ({
  expertId: candidate?.expertId ?? null,
  groupId: candidate?.groupId ?? null,
  featureCount: Number(candidate?.featureCount ?? 0),
  selectedFeatureKeys: (candidate?.selectedFeatures ?? []).map((feature) => feature?.featureKey).filter(Boolean),
  selectThreshold: Number(candidate?.selectThreshold ?? 0),
  marginThreshold: Number(candidate?.marginThreshold ?? 0),
  riskThreshold: Number(candidate?.riskThreshold ?? 0),
  abstainThreshold: Number(candidate?.abstainThreshold ?? 0),
  failureReason: candidate?.failureReason ?? null,
  trainSummary: candidate?.trainSummary ?? {},
  oosSummary: candidate?.oosSummary ?? {},
})

const compareLocalExperts = (left, right) => {
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
  if (
    toNumber(right?.oosSummary?.positiveRowCount, 0) !==
    toNumber(left?.oosSummary?.positiveRowCount, 0)
  ) {
    return toNumber(right?.oosSummary?.positiveRowCount, 0) - toNumber(left?.oosSummary?.positiveRowCount, 0)
  }
  return Number(left?.featureCount ?? 0) - Number(right?.featureCount ?? 0)
}

const derivePrimaryReason = (reasonCounts) =>
  Object.entries(reasonCounts ?? {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ??
  "unsat_no_local_experts"

export const calibratePerfectPrototypeSupportBoundaryLocalExperts = ({
  family,
  groupDataset,
  minTrainMatchedDates = 3,
  minTrainMatchedMonths = 3,
  minTrainMatchedFolds = 2,
  minCrossfitPositiveWindows = 1,
  maxCrossfitNegativeWindows = 0,
  maxFeatureCount = 3,
  maxCandidateFeatures = 6,
  maxQualifiedPerGroup = 2,
} = {}) => {
  const supportFitExcluded = family?.supportFitExcluded === true
  if (supportFitExcluded !== true) {
    return buildPerfectPrototypeSupportBoundaryExpertUnsat({
      reason: "unsat_support_acceptance_only_dependency",
      reasonCounts: { unsat_support_acceptance_only_dependency: 1 },
      familySummary: family?.summary,
      groupDatasetSummary: groupDataset?.summary,
      supportFitExcluded,
    })
  }
  const datasets = (Array.isArray(groupDataset?.datasets) ? groupDataset.datasets : []).filter(
    (entry) => entry?.eligible === true,
  )
  if (datasets.length < 1) {
    return buildPerfectPrototypeSupportBoundaryExpertUnsat({
      reason: "unsat_no_local_experts",
      reasonCounts: { unsat_no_local_experts: 1 },
      familySummary: family?.summary,
      groupDatasetSummary: groupDataset?.summary,
      supportFitExcluded,
    })
  }

  const reasonCounts = {}
  const candidatesEvaluated = []
  let localExpertCandidateCount = 0
  let localExpertQualifiedCount = 0
  let bestTrainSummary = null
  let bestOosSummary = null
  const qualifiedExperts = []

  for (const dataset of datasets) {
    const groupId = dataset.groupId
    const featureCandidates = collectFeatureCandidates({
      positiveRows: dataset.localPositiveCore,
      negativeRows: dataset.localNegativeShell,
      featureKeys:
        family?.localExpertFeatureKeys ??
        family?.corridorBasinFeatureKeys ??
        family?.ordinalMotifFeatureKeys ??
        family?.recurrencePurityFeatureKeys ??
        [],
      requiredGroup: groupId,
      maxFeatures: maxCandidateFeatures,
    })
    if (featureCandidates.length < 1) {
      recordReason(reasonCounts, "unsat_no_local_experts")
      continue
    }
    const groupQualified = []
    const featureCountMax = Math.min(
      Math.max(1, Math.floor(Number(maxFeatureCount) || 3)),
      featureCandidates.length,
    )
    for (let featureCount = 1; featureCount <= featureCountMax; featureCount += 1) {
      for (const indexes of buildCombinationIndexes(featureCandidates.length, featureCount)) {
        const selectedFeatures = indexes.map((index) => featureCandidates[index])
        for (const riskWeight of [0.75, 1, 1.25]) {
          const seedArtifact = buildArtifact({
            family,
            groupId,
            expertId: `EXPERT_${groupId}_${localExpertCandidateCount + 1}`,
            selectedFeatures,
            riskWeight,
            selectThreshold: 0,
            marginThreshold: 0,
            riskThreshold: Number.POSITIVE_INFINITY,
            abstainThreshold: 0,
          })
          const thresholds = buildThresholdCandidates({
            artifact: seedArtifact,
            positiveRows: dataset.localPositiveCore,
            negativeRows: dataset.localNegativeShell,
          })
          for (const selectThreshold of thresholds.selectThresholdCandidates) {
            for (const marginThreshold of thresholds.marginThresholdCandidates) {
              for (const riskThreshold of thresholds.riskThresholdCandidates) {
                for (const abstainThreshold of thresholds.abstainThresholdCandidates) {
                  localExpertCandidateCount += 1
                  const expertId = `EXPERT_${groupId}_${localExpertCandidateCount}`
                  const artifact = buildArtifact({
                    family,
                    groupId,
                    expertId,
                    selectedFeatures,
                    riskWeight,
                    selectThreshold,
                    marginThreshold,
                    riskThreshold,
                    abstainThreshold,
                  })
                  const trainSummary = summarizePerfectPrototypeSupportBoundaryLocalExpertSelections({
                    evaluations: applyPerfectPrototypeSupportBoundaryLocalExpert({
                      artifact,
                      rows: family?.gatedTrainRows ?? [],
                    }),
                  })
                  const candidate = {
                    expertId,
                    groupId,
                    artifact,
                    featureCount,
                    selectedFeatures,
                    selectThreshold,
                    marginThreshold,
                    riskThreshold,
                    abstainThreshold,
                    trainSummary,
                    oosSummary: null,
                    failureReason: null,
                  }
                  if (toNumber(trainSummary.precision, 0) < 1) {
                    candidate.failureReason = "unsat_local_expert_train_precision"
                  } else if (toNumber(trainSummary.trainMatchedDateCount, 0) < minTrainMatchedDates) {
                    candidate.failureReason = "unsat_local_expert_train_breadth"
                  } else if (toNumber(trainSummary.trainMatchedMonthCount, 0) < minTrainMatchedMonths) {
                    candidate.failureReason = "unsat_local_expert_train_breadth"
                  } else if (toNumber(trainSummary.trainMatchedFoldCount, 0) < minTrainMatchedFolds) {
                    candidate.failureReason = "unsat_local_expert_train_breadth"
                  } else if (
                    toNumber(trainSummary.crossfitNegativeWindowCount, 0) > maxCrossfitNegativeWindows
                  ) {
                    candidate.failureReason = "unsat_local_expert_crossfit_negative_windows"
                  } else if (
                    toNumber(trainSummary.crossfitRetainedPositiveWindowCount, 0) < minCrossfitPositiveWindows
                  ) {
                    candidate.failureReason = "unsat_local_expert_train_breadth"
                  }

                  if (!candidate.failureReason) {
                    candidate.oosSummary = summarizePerfectPrototypeSupportBoundaryLocalExpertSelections({
                      evaluations: applyPerfectPrototypeSupportBoundaryLocalExpert({
                        artifact,
                        rows: family?.oosRows ?? [],
                      }),
                    })
                  }

                  if (candidatesEvaluated.length < 256) {
                    candidatesEvaluated.push(buildCandidatePreview(candidate))
                  }
                  if (candidate.failureReason) {
                    recordReason(reasonCounts, candidate.failureReason)
                    if (
                      !bestTrainSummary ||
                      toNumber(candidate.trainSummary?.trainMatchedDateCount, 0) >
                        toNumber(bestTrainSummary?.trainMatchedDateCount, 0)
                    ) {
                      bestTrainSummary = candidate.trainSummary
                    }
                    if (
                      !bestOosSummary ||
                      toNumber(candidate.oosSummary?.positiveRowCount, 0) >
                        toNumber(bestOosSummary?.positiveRowCount, 0)
                    ) {
                      bestOosSummary = candidate.oosSummary
                    }
                    continue
                  }
                  localExpertQualifiedCount += 1
                  groupQualified.push({
                    expertId,
                    groupId,
                    artifact,
                    featureCount,
                    selectedFeatures,
                    trainSummary,
                    oosSummary: candidate.oosSummary,
                  })
                }
              }
            }
          }
        }
      }
    }
    groupQualified.sort(compareLocalExperts)
    qualifiedExperts.push(...groupQualified.slice(0, Math.max(1, Math.floor(Number(maxQualifiedPerGroup) || 2))))
  }

  if (qualifiedExperts.length < 1) {
    return buildPerfectPrototypeSupportBoundaryExpertUnsat({
      reason: derivePrimaryReason(reasonCounts),
      reasonCounts,
      familySummary: family?.summary,
      groupDatasetSummary: groupDataset?.summary,
      localExpertCandidateCount,
      localExpertQualifiedCount,
      supportFitExcluded,
      bestTrainSummary,
      bestOosSummary,
      candidatesEvaluated,
    })
  }

  qualifiedExperts.sort(compareLocalExperts)
  const signatureSummary = summarizePerfectPrototypeSupportExpertCoverageSignatures({
    experts: qualifiedExperts,
  })

  return {
    ok: true,
    supportFitExcluded,
    localExpertCandidateCount,
    localExpertQualifiedCount: qualifiedExperts.length,
    qualifiedExpertDistinctMatchedDateSignatureCount: signatureSummary.distinctMatchedDateSignatureCount,
    qualifiedExpertDistinctMatchedMonthSignatureCount: signatureSummary.distinctMatchedMonthSignatureCount,
    qualifiedExpertDistinctMatchedFoldSignatureCount: signatureSummary.distinctMatchedFoldSignatureCount,
    qualifiedExperts,
    bestTrainSummary,
    bestOosSummary,
    candidatesEvaluated,
  }
}
