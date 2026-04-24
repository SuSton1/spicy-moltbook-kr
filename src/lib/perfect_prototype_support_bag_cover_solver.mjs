import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "./perfect_prototype_support_case.mjs"
import {
  summarizePerfectPrototypeSupportBoundaryLocalExpertSelections,
} from "./perfect_prototype_support_boundary_local_expert.mjs"
import { applyPerfectPrototypeSupportBagLocalDetector } from "./perfect_prototype_support_bag_local_detector.mjs"

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
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

const recordReason = (reasonCounts, reason) => {
  if (!reason) return
  reasonCounts[reason] = Number(reasonCounts[reason] ?? 0) + 1
}

const derivePrimaryReason = (reasonCounts) =>
  Object.entries(reasonCounts ?? {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ??
  "unsat_bag_cover_train_breadth"

const unionRowKey = (row) =>
  [
    String(row?.rowKey ?? "").trim(),
    String(row?.caseId ?? "").trim(),
    String(row?.dateKey ?? "").trim(),
    String(row?.symbol ?? "").trim(),
  ]
    .filter(Boolean)
    .join("::")

const summarizeDetectorUnion = ({ detectors = [], rows = [], supportCaseIds = [] } = {}) => {
  const selectedMap = new Map()
  for (const detector of Array.isArray(detectors) ? detectors : []) {
    for (const evaluation of applyPerfectPrototypeSupportBagLocalDetector({
      artifact: detector?.artifact,
      rows,
    })) {
      if (evaluation?.selected !== true) continue
      const key = unionRowKey(evaluation.row)
      if (!key) continue
      selectedMap.set(key, { row: evaluation.row, selected: true })
    }
  }
  return summarizePerfectPrototypeSupportBoundaryLocalExpertSelections({
    evaluations: Array.from(selectedMap.values()),
    supportCaseIds,
  })
}

const collectSupportMatched = ({ detectors = [], supportCaseViews = [] } = {}) => {
  const matched = new Set()
  for (const detector of Array.isArray(detectors) ? detectors : []) {
    for (const evaluation of applyPerfectPrototypeSupportBagLocalDetector({
      artifact: detector?.artifact,
      rows: supportCaseViews,
    })) {
      if (evaluation?.selected === true && evaluation?.row?.caseId) matched.add(evaluation.row.caseId)
    }
  }
  return Array.from(matched).sort((left, right) => left.localeCompare(right))
}

const buildCandidatePreview = (candidate) => ({
  unionDetectorIds: candidate?.unionDetectorIds ?? [],
  detectorCount: Number(candidate?.detectorCount ?? 0),
  failureReason: candidate?.failureReason ?? null,
  supportMatched: candidate?.supportMatched ?? [],
  trainSummary: candidate?.trainSummary ?? {},
  oosSummary: candidate?.oosSummary ?? {},
})

const compareSolutions = (left, right) => {
  if (
    toNumber(right?.oosSummary?.openOosMatchCount, 0) !==
    toNumber(left?.oosSummary?.openOosMatchCount, 0)
  ) {
    return toNumber(right?.oosSummary?.openOosMatchCount, 0) - toNumber(left?.oosSummary?.openOosMatchCount, 0)
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
  return Number(left?.detectorCount ?? 0) - Number(right?.detectorCount ?? 0)
}

const compareDetectors = (left, right) => {
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
    toNumber(right?.oosSummary?.positiveRowCount, 0) !==
    toNumber(left?.oosSummary?.positiveRowCount, 0)
  ) {
    return toNumber(right?.oosSummary?.positiveRowCount, 0) - toNumber(left?.oosSummary?.positiveRowCount, 0)
  }
  return String(left?.detectorId ?? "").localeCompare(String(right?.detectorId ?? ""))
}

export const solvePerfectPrototypeSupportBagCover = ({
  family,
  bagLocalDetectorCalibration,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  minCrossfitPositiveWindows = 2,
  maxCrossfitNegativeWindows = 0,
  minOosMatchCount = 3,
  maxDetectorCount = 3,
  maxDetectorsToSearch = 8,
} = {}) => {
  const supportFitExcluded = family?.supportFitExcluded === true
  const qualifiedDetectors = Array.isArray(bagLocalDetectorCalibration?.qualifiedDetectors)
    ? bagLocalDetectorCalibration.qualifiedDetectors
    : []
  const signatureFrontier = []
  const seenSignatures = new Set()
  for (const detector of [...qualifiedDetectors].sort(compareDetectors)) {
    const signature = String(detector?.matchedDateSignature ?? "").trim()
    if (!signature || seenSignatures.has(signature)) continue
    seenSignatures.add(signature)
    signatureFrontier.push(detector)
    if (signatureFrontier.length >= Math.max(1, Math.floor(Number(maxDetectorsToSearch) || 8))) break
  }
  const searchDetectors = signatureFrontier.length > 0 ? signatureFrontier : qualifiedDetectors.slice(0, Math.max(1, Math.floor(Number(maxDetectorsToSearch) || 8)))
  if (supportFitExcluded !== true) {
    return {
      ok: false,
      reason: "unsat_support_acceptance_only_dependency",
      supportFitExcluded,
      supportLeaveOneOutRecovered: false,
      bagLocalDetectorCandidateCount: bagLocalDetectorCalibration?.bagLocalDetectorCandidateCount ?? 0,
      bagLocalDetectorQualifiedCount: bagLocalDetectorCalibration?.bagLocalDetectorQualifiedCount ?? 0,
      distinctBagCoverSignatureCount: bagLocalDetectorCalibration?.distinctBagCoverSignatureCount ?? 0,
      bagCoverUnionCandidateCount: 0,
      bagCoverUnionQualifiedCount: 0,
      unsatReasonCounts: { unsat_support_acceptance_only_dependency: 1 },
      candidatesEvaluated: [],
    }
  }
  if (searchDetectors.length < 1) {
    return {
      ok: false,
      reason: "unsat_no_bag_local_detectors",
      supportFitExcluded,
      supportLeaveOneOutRecovered: false,
      bagLocalDetectorCandidateCount: bagLocalDetectorCalibration?.bagLocalDetectorCandidateCount ?? 0,
      bagLocalDetectorQualifiedCount: 0,
      distinctBagCoverSignatureCount: bagLocalDetectorCalibration?.distinctBagCoverSignatureCount ?? 0,
      bagCoverUnionCandidateCount: 0,
      bagCoverUnionQualifiedCount: 0,
      unsatReasonCounts: { unsat_no_bag_local_detectors: 1 },
      bestTrainSummary: bagLocalDetectorCalibration?.bestTrainSummary ?? null,
      bestOosSummary: bagLocalDetectorCalibration?.bestOosSummary ?? null,
      candidatesEvaluated: bagLocalDetectorCalibration?.candidatesEvaluated ?? [],
    }
  }

  const reasonCounts = {}
  const candidatesEvaluated = []
  let bagCoverUnionCandidateCount = 0
  let bagCoverUnionQualifiedCount = 0
  let supportLeaveOneOutRecovered = false
  let bestTrainSummary = bagLocalDetectorCalibration?.bestTrainSummary ?? null
  let bestOosSummary = bagLocalDetectorCalibration?.bestOosSummary ?? null
  let bestSolution = null
  const bestSingleDetectorTrainDateCount = Math.max(
    0,
    ...searchDetectors.map((detector) => toNumber(detector?.trainSummary?.trainMatchedDateCount, 0)),
  )
  const bestSingleDetectorTrainMonthCount = Math.max(
    0,
    ...searchDetectors.map((detector) => toNumber(detector?.trainSummary?.trainMatchedMonthCount, 0)),
  )
  const bestSingleDetectorTrainFoldCount = Math.max(
    0,
    ...searchDetectors.map((detector) => toNumber(detector?.trainSummary?.trainMatchedFoldCount, 0)),
  )
  let bagCoverUnionDateGainOverBestSingleDetector = 0
  let bagCoverUnionMonthGainOverBestSingleDetector = 0
  let bagCoverUnionFoldGainOverBestSingleDetector = 0

  const detectorCountMax = Math.min(Math.max(1, Math.floor(Number(maxDetectorCount) || 3)), searchDetectors.length)
  for (let detectorCount = 1; detectorCount <= detectorCountMax; detectorCount += 1) {
    for (const indexes of buildCombinationIndexes(searchDetectors.length, detectorCount)) {
      bagCoverUnionCandidateCount += 1
      const selectedDetectors = indexes.map((index) => searchDetectors[index])
      const unionDetectorIds = selectedDetectors.map((detector) => detector?.detectorId).filter(Boolean)
      const trainSummary = summarizeDetectorUnion({
        detectors: selectedDetectors,
        rows: family?.gatedTrainRows ?? [],
      })
      const candidate = {
        unionDetectorIds,
        detectorCount,
        trainSummary,
        supportMatched: [],
        oosSummary: null,
        failureReason: null,
      }
      const dateGain = Math.max(
        0,
        toNumber(trainSummary.trainMatchedDateCount, 0) - bestSingleDetectorTrainDateCount,
      )
      const monthGain = Math.max(
        0,
        toNumber(trainSummary.trainMatchedMonthCount, 0) - bestSingleDetectorTrainMonthCount,
      )
      const foldGain = Math.max(
        0,
        toNumber(trainSummary.trainMatchedFoldCount, 0) - bestSingleDetectorTrainFoldCount,
      )
      bagCoverUnionDateGainOverBestSingleDetector = Math.max(
        bagCoverUnionDateGainOverBestSingleDetector,
        dateGain,
      )
      bagCoverUnionMonthGainOverBestSingleDetector = Math.max(
        bagCoverUnionMonthGainOverBestSingleDetector,
        monthGain,
      )
      bagCoverUnionFoldGainOverBestSingleDetector = Math.max(
        bagCoverUnionFoldGainOverBestSingleDetector,
        foldGain,
      )

      if (toNumber(trainSummary.precision, 0) < 1) {
        candidate.failureReason = "unsat_bag_cover_train_precision"
      } else if (
        detectorCount > 1 &&
        dateGain < 1 &&
        monthGain < 1 &&
        foldGain < 1 &&
        toNumber(trainSummary.trainMatchedDateCount, 0) < minTrainMatchedDates
      ) {
        candidate.failureReason = "unsat_bag_cover_no_complement_gain"
      } else if (toNumber(trainSummary.trainMatchedDateCount, 0) < minTrainMatchedDates) {
        candidate.failureReason = "unsat_bag_cover_train_breadth"
      } else if (toNumber(trainSummary.trainMatchedMonthCount, 0) < minTrainMatchedMonths) {
        candidate.failureReason = "unsat_bag_cover_train_breadth"
      } else if (toNumber(trainSummary.trainMatchedFoldCount, 0) < minTrainMatchedFolds) {
        candidate.failureReason = "unsat_bag_cover_train_breadth"
      } else if (toNumber(trainSummary.crossfitNegativeWindowCount, 0) > maxCrossfitNegativeWindows) {
        candidate.failureReason = "unsat_bag_cover_crossfit_recurrence"
      } else if (
        toNumber(trainSummary.crossfitRetainedPositiveWindowCount, 0) < minCrossfitPositiveWindows
      ) {
        candidate.failureReason = "unsat_bag_cover_crossfit_recurrence"
      }

      if (!candidate.failureReason) {
        candidate.supportMatched = collectSupportMatched({
          detectors: selectedDetectors,
          supportCaseViews: family?.supportCaseViews ?? [],
        })
        supportLeaveOneOutRecovered =
          supportLeaveOneOutRecovered ||
          candidate.supportMatched.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID)
        if (!candidate.supportMatched.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID)) {
          candidate.failureReason = "unsat_support_recovery_after_leave_one_out"
        }
      }

      if (!candidate.failureReason) {
        const oosSummaryBase = summarizeDetectorUnion({
          detectors: selectedDetectors,
          rows: family?.oosRows ?? [],
        })
        candidate.oosSummary = {
          ...oosSummaryBase,
          openOosPrecision: toNumber(oosSummaryBase?.precision, 0),
          openOosMatchCount: toNumber(oosSummaryBase?.positiveRowCount, 0),
          openOosUniqueMatchedDates: toNumber(oosSummaryBase?.trainMatchedDateCount, 0),
          haesungSupport: candidate.supportMatched.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID),
        }
        if (toNumber(candidate.oosSummary.openOosPrecision, 0) < 1) {
          candidate.failureReason = "unsat_bag_cover_oos_precision"
        } else if (toNumber(candidate.oosSummary.openOosMatchCount, 0) < minOosMatchCount) {
          candidate.failureReason = "unsat_bag_cover_oos_zero_match"
        }
      }

      if (!candidate.failureReason) {
        bagCoverUnionQualifiedCount += 1
        if (!bestSolution || compareSolutions(candidate, bestSolution) < 0) {
          bestSolution = candidate
        }
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
          toNumber(candidate.oosSummary?.openOosMatchCount, 0) >
            toNumber(bestOosSummary?.openOosMatchCount, 0))
      ) {
        bestOosSummary = candidate.oosSummary
      }
      if (candidatesEvaluated.length < 256) candidatesEvaluated.push(buildCandidatePreview(candidate))
    }
  }

  if (!bestSolution) {
    return {
      ok: false,
      reason: derivePrimaryReason(reasonCounts),
      supportFitExcluded,
      supportLeaveOneOutRecovered,
      bagLocalDetectorCandidateCount: bagLocalDetectorCalibration?.bagLocalDetectorCandidateCount ?? 0,
      bagLocalDetectorQualifiedCount: bagLocalDetectorCalibration?.bagLocalDetectorQualifiedCount ?? 0,
      distinctBagCoverSignatureCount: bagLocalDetectorCalibration?.distinctBagCoverSignatureCount ?? 0,
      bestSingleDetectorTrainMatchedDateCount: bestSingleDetectorTrainDateCount,
      bestSingleDetectorTrainMatchedMonthCount: bestSingleDetectorTrainMonthCount,
      bestSingleDetectorTrainMatchedFoldCount: bestSingleDetectorTrainFoldCount,
      bagCoverUnionCandidateCount,
      bagCoverUnionQualifiedCount,
      bagCoverUnionDateGainOverBestSingleDetector,
      bagCoverUnionMonthGainOverBestSingleDetector,
      bagCoverUnionFoldGainOverBestSingleDetector,
      unsatReasonCounts: reasonCounts,
      bestTrainSummary,
      bestOosSummary,
      candidatesEvaluated,
    }
  }

  return {
    ok: true,
    reason: null,
    supportFitExcluded,
    supportLeaveOneOutRecovered,
    bagLocalDetectorCandidateCount: bagLocalDetectorCalibration?.bagLocalDetectorCandidateCount ?? 0,
    bagLocalDetectorQualifiedCount: bagLocalDetectorCalibration?.bagLocalDetectorQualifiedCount ?? 0,
    distinctBagCoverSignatureCount: bagLocalDetectorCalibration?.distinctBagCoverSignatureCount ?? 0,
    bestSingleDetectorTrainMatchedDateCount: bestSingleDetectorTrainDateCount,
    bestSingleDetectorTrainMatchedMonthCount: bestSingleDetectorTrainMonthCount,
    bestSingleDetectorTrainMatchedFoldCount: bestSingleDetectorTrainFoldCount,
    bagCoverUnionCandidateCount,
    bagCoverUnionQualifiedCount,
    bagCoverUnionDateGainOverBestSingleDetector,
    bagCoverUnionMonthGainOverBestSingleDetector,
    bagCoverUnionFoldGainOverBestSingleDetector,
    artifact: {
      familyId: family?.familyId ?? "low_gap_top_continuation",
      gateTokens: family?.gateTokens ?? [],
      detectors: bestSolution.unionDetectorIds.map((detectorId) =>
        bagLocalDetectorCalibration.qualifiedDetectors.find((detector) => detector.detectorId === detectorId)?.artifact,
      ).filter(Boolean),
      supportAcceptanceOnly: true,
    },
    trainSummary: bestSolution.trainSummary,
    oosSummary: bestSolution.oosSummary,
    unionDetectorIds: bestSolution.unionDetectorIds,
    candidatesEvaluated,
  }
}
