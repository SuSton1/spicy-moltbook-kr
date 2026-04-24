import {
  summarizePerfectPrototypeSupportBoundaryLocalExpertSelections,
} from "./perfect_prototype_support_boundary_local_expert.mjs"
import { computePerfectPrototypeSupportWitnessScore } from "./perfect_prototype_support_bag_witness_selector.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
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

const buildArtifact = ({
  family,
  prototype,
  detectorId,
  minWitnessScore,
  minMotifAgreement,
  minSupportRecoveryPotential,
  maxLeakPressure,
  maxNegativeConflict,
} = {}) => ({
  detectorId,
  familyId: family?.familyId ?? "low_gap_top_continuation",
  gateTokens: family?.gateTokens ?? [],
  motifBundleId: prototype?.bundleId ?? null,
  minWitnessScore,
  minMotifAgreement,
  minSupportRecoveryPotential,
  maxLeakPressure,
  maxNegativeConflict,
})

export const applyPerfectPrototypeSupportBagLocalDetector = ({
  artifact,
  rows = [],
} = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const gateTokens = Array.isArray(artifact?.gateTokens) ? artifact.gateTokens : []
    const gatePassed =
      gateTokens.length < 1 ? true : gateTokens.every((token) => row?.tokenSet?.has(token) === true)
    const motifBundlePassed = String(row?.motifBundleId ?? "").trim() === String(artifact?.motifBundleId ?? "").trim()
    const witnessScore = computePerfectPrototypeSupportWitnessScore(row)
    const motifAgreement = Number(num(row?.numericFeatureMap?.["sig.ordinalMotif.motifAgreement"]) ?? 0)
    const supportRecoveryPotential = Number(
      num(row?.numericFeatureMap?.["sig.ordinalMotif.supportRecoveryPotential"]) ?? 0,
    )
    const leakPressure = Number(num(row?.numericFeatureMap?.["sig.ordinalMotif.recurrenceLeakPressure"]) ?? 0)
    const negativeConflict = Number(num(row?.numericFeatureMap?.["sig.ordinalMotif.negativeMotifConflict"]) ?? 0)
    const selected =
      gatePassed &&
      motifBundlePassed &&
      witnessScore >= Number(artifact?.minWitnessScore ?? 0) &&
      motifAgreement >= Number(artifact?.minMotifAgreement ?? 0) &&
      supportRecoveryPotential >= Number(artifact?.minSupportRecoveryPotential ?? 0) &&
      leakPressure <= Number(artifact?.maxLeakPressure ?? Number.POSITIVE_INFINITY) &&
      negativeConflict <= Number(artifact?.maxNegativeConflict ?? Number.POSITIVE_INFINITY)
    return {
      row,
      detectorId: artifact?.detectorId ?? null,
      gatePassed,
      motifBundlePassed,
      witnessScore,
      motifAgreement,
      supportRecoveryPotential,
      leakPressure,
      negativeConflict,
      selected,
    }
  })

const buildCandidatePreview = (candidate) => ({
  detectorId: candidate?.detectorId ?? null,
  prototypeId: candidate?.prototypeId ?? null,
  failureReason: candidate?.failureReason ?? null,
  trainSummary: candidate?.trainSummary ?? {},
  oosSummary: candidate?.oosSummary ?? {},
})

export const calibratePerfectPrototypeSupportBagLocalDetectors = ({
  family,
  minTrainMatchedDates = 3,
  minTrainMatchedMonths = 3,
  minTrainMatchedFolds = 2,
  minCrossfitPositiveWindows = 1,
  maxCrossfitNegativeWindows = 0,
} = {}) => {
  const reasonCounts = {}
  const candidatesEvaluated = []
  const qualifiedDetectors = []
  let bagLocalDetectorCandidateCount = 0
  let bestTrainSummary = null
  let bestOosSummary = null

  for (const prototype of Array.isArray(family?.motifPrototypes) ? family.motifPrototypes : []) {
    const witnessScores = (prototype?.witnessScores ?? []).filter(Number.isFinite)
    const positiveRows = Array.isArray(prototype?.witnessRows) ? prototype.witnessRows : []
    const bundleNegativeRows = (family?.supportNearHardNegativeRows ?? []).filter(
      (row) => String(row?.motifBundleId ?? "").trim() === String(prototype?.bundleId ?? "").trim(),
    )
    const positiveAgreements = positiveRows
      .map((row) => num(row?.numericFeatureMap?.["sig.ordinalMotif.motifAgreement"]))
      .filter(Number.isFinite)
    const positiveRecovery = positiveRows
      .map((row) => num(row?.numericFeatureMap?.["sig.ordinalMotif.supportRecoveryPotential"]))
      .filter(Number.isFinite)
    const positiveLeak = positiveRows
      .map((row) => num(row?.numericFeatureMap?.["sig.ordinalMotif.recurrenceLeakPressure"]))
      .filter(Number.isFinite)
    const positiveConflict = positiveRows
      .map((row) => num(row?.numericFeatureMap?.["sig.ordinalMotif.negativeMotifConflict"]))
      .filter(Number.isFinite)
    const negativeWitnessScores = bundleNegativeRows.map((row) => computePerfectPrototypeSupportWitnessScore(row))
    const negativeLeak = bundleNegativeRows
      .map((row) => num(row?.numericFeatureMap?.["sig.ordinalMotif.recurrenceLeakPressure"]))
      .filter(Number.isFinite)
    const negativeConflict = bundleNegativeRows
      .map((row) => num(row?.numericFeatureMap?.["sig.ordinalMotif.negativeMotifConflict"]))
      .filter(Number.isFinite)

    const minWitnessScoreCandidates = uniqueNumbers([
      quantile(witnessScores, 0.05),
      quantile(witnessScores, 0.2),
      Math.max(...negativeWitnessScores.filter(Number.isFinite), Number.NEGATIVE_INFINITY) + 0.001,
    ]).slice(0, 4)
    const minAgreementCandidates = uniqueNumbers([
      quantile(positiveAgreements, 0.05),
      quantile(positiveAgreements, 0.2),
      0.5,
    ]).slice(0, 4)
    const minRecoveryCandidates = uniqueNumbers([
      quantile(positiveRecovery, 0.05),
      quantile(positiveRecovery, 0.2),
      0,
    ]).slice(0, 4)
    const maxLeakCandidates = uniqueNumbers([
      quantile(positiveLeak, 0.8),
      quantile(positiveLeak, 0.95),
      Math.min(...negativeLeak.filter(Number.isFinite), Number.POSITIVE_INFINITY) - 0.001,
    ])
      .filter((value) => Number.isFinite(value))
      .slice(0, 4)
    const maxNegativeConflictCandidates = uniqueNumbers([
      quantile(positiveConflict, 0.8),
      quantile(positiveConflict, 0.95),
      Math.min(...negativeConflict.filter(Number.isFinite), Number.POSITIVE_INFINITY) - 0.001,
    ])
      .filter((value) => Number.isFinite(value))
      .slice(0, 4)

    for (const minWitnessScore of minWitnessScoreCandidates.length > 0 ? minWitnessScoreCandidates : [0]) {
      for (const minMotifAgreement of minAgreementCandidates.length > 0 ? minAgreementCandidates : [0]) {
        for (const minSupportRecoveryPotential of minRecoveryCandidates.length > 0 ? minRecoveryCandidates : [0]) {
          for (const maxLeakPressure of maxLeakCandidates.length > 0 ? maxLeakCandidates : [0.5]) {
            for (const maxNegativeConflict of maxNegativeConflictCandidates.length > 0 ? maxNegativeConflictCandidates : [0.5]) {
              bagLocalDetectorCandidateCount += 1
              const artifact = buildArtifact({
                family,
                prototype,
                detectorId: `BAG_DETECTOR_${String(bagLocalDetectorCandidateCount).padStart(3, "0")}`,
                minWitnessScore,
                minMotifAgreement,
                minSupportRecoveryPotential,
                maxLeakPressure,
                maxNegativeConflict,
              })
              const trainSummary = summarizePerfectPrototypeSupportBoundaryLocalExpertSelections({
                evaluations: applyPerfectPrototypeSupportBagLocalDetector({
                  artifact,
                  rows: family?.gatedTrainRows ?? [],
                }),
                supportCaseIds: [],
              })
              const candidate = {
                detectorId: artifact.detectorId,
                prototypeId: prototype?.prototypeId ?? null,
                artifact,
                trainSummary,
                oosSummary: null,
                failureReason: null,
              }
              if (toNumber(trainSummary.precision, 0) < 1) {
                candidate.failureReason = "unsat_bag_local_detector_train_precision"
              } else if (toNumber(trainSummary.trainMatchedDateCount, 0) < minTrainMatchedDates) {
                candidate.failureReason = "unsat_bag_local_detector_train_breadth"
              } else if (toNumber(trainSummary.trainMatchedMonthCount, 0) < minTrainMatchedMonths) {
                candidate.failureReason = "unsat_bag_local_detector_train_breadth"
              } else if (toNumber(trainSummary.trainMatchedFoldCount, 0) < minTrainMatchedFolds) {
                candidate.failureReason = "unsat_bag_local_detector_train_breadth"
              } else if (toNumber(trainSummary.crossfitNegativeWindowCount, 0) > maxCrossfitNegativeWindows) {
                candidate.failureReason = "unsat_bag_local_detector_crossfit"
              } else if (
                toNumber(trainSummary.crossfitRetainedPositiveWindowCount, 0) < minCrossfitPositiveWindows
              ) {
                candidate.failureReason = "unsat_bag_local_detector_crossfit"
              }
              if (!candidate.failureReason) {
                candidate.oosSummary = summarizePerfectPrototypeSupportBoundaryLocalExpertSelections({
                  evaluations: applyPerfectPrototypeSupportBagLocalDetector({
                    artifact,
                    rows: family?.oosRows ?? [],
                  }),
                  supportCaseIds: [],
                })
                qualifiedDetectors.push({
                  ...candidate,
                  matchedDateSignature: (candidate.trainSummary?.matchedDateKeys ?? []).join("|"),
                })
              } else {
                recordReason(reasonCounts, candidate.failureReason)
              }
              if (
                !bestTrainSummary ||
                toNumber(candidate.trainSummary?.trainMatchedDateCount, 0) >
                  toNumber(bestTrainSummary?.trainMatchedDateCount, 0)
              ) {
                bestTrainSummary = candidate.trainSummary
              }
              if (
                candidate.oosSummary &&
                (!bestOosSummary ||
                  toNumber(candidate.oosSummary?.positiveRowCount, 0) >
                    toNumber(bestOosSummary?.positiveRowCount, 0))
              ) {
                bestOosSummary = candidate.oosSummary
              }
              if (candidatesEvaluated.length < 256) candidatesEvaluated.push(buildCandidatePreview(candidate))
            }
          }
        }
      }
    }
  }

  const distinctBagCoverSignatureCount = new Set(
    qualifiedDetectors.map((detector) => detector?.matchedDateSignature).filter(Boolean),
  ).size
  return {
    ok: qualifiedDetectors.length > 0,
    reason: qualifiedDetectors.length > 0 ? null : "unsat_no_bag_local_detectors",
    supportFitExcluded: family?.supportFitExcluded === true,
    bagLocalDetectorCandidateCount,
    bagLocalDetectorQualifiedCount: qualifiedDetectors.length,
    distinctBagCoverSignatureCount,
    qualifiedDetectors,
    bestTrainSummary,
    bestOosSummary,
    bagLocalDetectorRejectReasonCounts: reasonCounts,
    candidatesEvaluated,
  }
}
