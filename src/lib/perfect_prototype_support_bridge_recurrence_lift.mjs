import {
  buildPerfectPrototypeSupportBridgeFrontierState,
  buildPerfectPrototypeSupportBridgeSelectedStats,
  scorePerfectPrototypeSupportBridgeFrontierCandidate,
  summarizePerfectPrototypeSupportBridgeRows,
} from "./perfect_prototype_support_bridge_frontier_metric.mjs"

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const recordReason = (reasonCounts, reason) => {
  if (!reason) return
  reasonCounts[reason] = Number(reasonCounts[reason] ?? 0) + 1
}

const compareCandidates = (left, right) => {
  if (right?.diagnostics?.acceptanceScore !== left?.diagnostics?.acceptanceScore) {
    return Number(right?.diagnostics?.acceptanceScore ?? Number.NEGATIVE_INFINITY) -
      Number(left?.diagnostics?.acceptanceScore ?? Number.NEGATIVE_INFINITY)
  }
  return String(left?.row?.rowKey ?? "").localeCompare(String(right?.row?.rowKey ?? ""))
}

const buildFrontierPoint = ({ stage, selectedRows, state } = {}) => ({
  stage,
  positiveSummary: summarizePerfectPrototypeSupportBridgeRows(selectedRows),
  negativeSummary: summarizePerfectPrototypeSupportBridgeRows(state?.negativeShellRows ?? []),
  supportRecoveredCount: Number(state?.supportRecoveredCount ?? 0),
  supportMarginMean:
    Array.isArray(state?.supportEvaluations) && state.supportEvaluations.length > 0
      ? state.supportEvaluations.reduce((sum, entry) => sum + Number(entry?.margin ?? 0), 0) /
        state.supportEvaluations.length
      : null,
})

export const liftPerfectPrototypeSupportBridgeRecurrence = ({
  cohort,
  minTrainDates = 10,
  minTrainMonths = 6,
  minTrainFolds = 4,
  maxCompanionRows = 64,
  maxNegativeLeakCost = 0.7,
  knnK = 12,
} = {}) => {
  const bridgePositiveRows = Array.isArray(cohort?.bridgePositiveRows) ? cohort.bridgePositiveRows : []
  if (bridgePositiveRows.length < 1) {
    return {
      ...cohort,
      ok: false,
      reason: "unsat_no_seed_bridge_family",
      summary: {
        ...(cohort?.summary ?? {}),
        bridgeLiftReady: false,
        bridgeLiftReason: "unsat_no_seed_bridge_family",
      },
    }
  }

  const gatedPositiveRows = (Array.isArray(cohort?.gatedTrainRows) ? cohort.gatedTrainRows : []).filter(
    (row) => row?.outcomeHitTarget === true,
  )
  const supportCaseViews = Array.isArray(cohort?.supportCaseViews) ? cohort.supportCaseViews : []
  const featureKeys = Array.isArray(cohort?.bridgeBaseFeatureKeys) ? cohort.bridgeBaseFeatureKeys : []
  const featureScales = cohort?.bridgeFeatureScales ?? {}
  const negativePool = Array.isArray(cohort?.supportNearHardNegativeRows) ? cohort.supportNearHardNegativeRows : []

  const seedRowKeys = new Set(bridgePositiveRows.map((row) => row?.rowKey).filter(Boolean))
  const candidateRows = gatedPositiveRows.filter((row) => !seedRowKeys.has(row?.rowKey))

  if (candidateRows.length < 1) {
    return {
      ...cohort,
      ok: false,
      reason: "unsat_dynamic_bridge_frontier_empty",
      summary: {
        ...(cohort?.summary ?? {}),
        bridgeLiftReady: false,
        bridgeLiftReason: "unsat_dynamic_bridge_frontier_empty",
        bridgeSeedPositiveSummary: summarizePerfectPrototypeSupportBridgeRows(bridgePositiveRows),
      },
    }
  }

  const selectedRows = [...bridgePositiveRows]
  const frontierPoints = []
  const acceptedRows = []
  const rejectedRows = []
  const rejectReasonCounts = {}
  let dynamicRescoreCount = 0
  let negativeShellRebuildCount = 0

  const selectedStats = buildPerfectPrototypeSupportBridgeSelectedStats(selectedRows)
  let state = buildPerfectPrototypeSupportBridgeFrontierState({
    selectedRows,
    negativeRows: negativePool,
    supportCaseViews,
    featureKeys,
    featureScales,
    knnK,
  })
  negativeShellRebuildCount += 1
  frontierPoints.push(
    buildFrontierPoint({
      stage: "seed",
      selectedRows,
      state,
    }),
  )

  const remainingRows = [...candidateRows]
  while (
    remainingRows.length > 0 &&
    acceptedRows.length < Math.max(1, Math.floor(Number(maxCompanionRows) || 64))
  ) {
    const evaluatedCandidates = remainingRows.map((row) => {
      const diagnostics = scorePerfectPrototypeSupportBridgeFrontierCandidate({
        row,
        selectedStats,
        state,
        selectedRows,
        featureKeys,
        featureScales,
        knnK,
      })
      const hypotheticalRows = [...selectedRows, row]
      const hypotheticalState = buildPerfectPrototypeSupportBridgeFrontierState({
        selectedRows: hypotheticalRows,
        negativeRows: negativePool,
        supportCaseViews,
        featureKeys,
        featureScales,
        knnK,
      })
      const supportRecovered =
        supportCaseViews.length < 1 ||
        Number(hypotheticalState?.supportRecoveredCount ?? 0) >= supportCaseViews.length
      return {
        row,
        diagnostics,
        hypotheticalState,
        supportRecovered,
      }
    })
    dynamicRescoreCount += evaluatedCandidates.length

    const noBreadthRows = evaluatedCandidates.filter(
      (entry) => Number(entry?.diagnostics?.marginalBreadthGain ?? 0) <= 0,
    )
    if (noBreadthRows.length > 0) {
      const noBreadthRowKeys = new Set(noBreadthRows.map((entry) => entry.row?.rowKey))
      for (const entry of noBreadthRows) {
        const rejectReason = "unsat_dynamic_bridge_frontier_no_breadth"
        recordReason(rejectReasonCounts, rejectReason)
        rejectedRows.push({
          rowKey: entry?.row?.rowKey ?? null,
          rejectReason,
          diagnostics: entry?.diagnostics ?? {},
        })
      }
      for (let index = remainingRows.length - 1; index >= 0; index -= 1) {
        if (noBreadthRowKeys.has(remainingRows[index]?.rowKey)) remainingRows.splice(index, 1)
      }
    }

    const acceptable = evaluatedCandidates
      .filter(
        (entry) =>
          Number(entry?.diagnostics?.marginalBreadthGain ?? 0) > 0 &&
          Number(entry?.diagnostics?.negativeLeakCost ?? Number.POSITIVE_INFINITY) <=
            Number(maxNegativeLeakCost ?? 0.7) &&
          entry?.supportRecovered === true,
      )
      .sort(compareCandidates)

    if (acceptable.length < 1) {
      for (const entry of evaluatedCandidates.filter(
        (candidate) =>
          !rejectedRows.some((rejected) => rejected.rowKey === candidate?.row?.rowKey),
      )) {
        const rejectReason =
          entry?.supportRecovered !== true
            ? "unsat_boundary_veto_support_loss"
            : Number(entry?.diagnostics?.negativeLeakCost ?? Number.POSITIVE_INFINITY) >
                Number(maxNegativeLeakCost ?? 0.7)
              ? "unsat_dynamic_bridge_frontier_negative_leak"
              : "unsat_dynamic_bridge_frontier_empty"
        recordReason(rejectReasonCounts, rejectReason)
        rejectedRows.push({
          rowKey: entry?.row?.rowKey ?? null,
          rejectReason,
          diagnostics: entry?.diagnostics ?? {},
        })
      }
      break
    }

    const best = acceptable[0]
    acceptedRows.push(best.row)
    selectedRows.push(best.row)
    if (best.row?.dateKey) selectedStats.dateKeys.add(best.row.dateKey)
    if (best.row?.monthKey) selectedStats.monthKeys.add(best.row.monthKey)
    if (Number(best.row?.foldId ?? 0) > 0) selectedStats.foldIds.add(Number(best.row.foldId))
    if (Number(best.row?.windowId ?? 0) > 0) selectedStats.windowIds.add(Number(best.row.windowId))
    const acceptedIndex = remainingRows.findIndex((row) => row?.rowKey === best?.row?.rowKey)
    if (acceptedIndex >= 0) remainingRows.splice(acceptedIndex, 1)
    state = best.hypotheticalState
    negativeShellRebuildCount += 1
    frontierPoints.push(
      buildFrontierPoint({
        stage: `lift_${acceptedRows.length}`,
        selectedRows,
        state,
      }),
    )
  }

  const liftedPositiveSummary = summarizePerfectPrototypeSupportBridgeRows(selectedRows)
  const liftedNegativeRows = Array.isArray(state?.negativeShellRows) ? state.negativeShellRows : []
  const liftedNegativeSummary = summarizePerfectPrototypeSupportBridgeRows(liftedNegativeRows)
  const supportLeaveOneOutRecovered =
    supportCaseViews.length < 1 || Number(state?.supportRecoveredCount ?? 0) >= supportCaseViews.length

  if (
    liftedPositiveSummary.matchedDateCount < minTrainDates ||
    liftedPositiveSummary.matchedMonthCount < minTrainMonths ||
    liftedPositiveSummary.matchedFoldCount < minTrainFolds
  ) {
    const reason =
      acceptedRows.length < 1 ? "unsat_dynamic_bridge_frontier_empty" : "unsat_dynamic_bridge_frontier_no_breadth"
    recordReason(rejectReasonCounts, reason)
    return {
      ...cohort,
      ok: false,
      reason,
      summary: {
        ...(cohort?.summary ?? {}),
        bridgeLiftReady: false,
        bridgeLiftReason: reason,
        supportFitExcluded: cohort?.supportFitExcluded === true,
        supportLeaveOneOutRecovered,
        bridgeSeedPositiveSummary: summarizePerfectPrototypeSupportBridgeRows(bridgePositiveRows),
        bridgeCompanionCandidateCount: candidateRows.length,
        bridgeCompanionAcceptedCount: acceptedRows.length,
        bridgeCompanionRejectReasonCounts: rejectReasonCounts,
        bridgeLiftedPositiveSummary: liftedPositiveSummary,
        bridgeLiftedNegativeSummary: liftedNegativeSummary,
        bridgeDynamicRescoreCount: dynamicRescoreCount,
        negativeShellRebuildCount,
        preThresholdFrontierPointCount: frontierPoints.length,
      },
      bridgeFrontierPoints: frontierPoints,
    }
  }

  return {
    ...cohort,
    ok: true,
    reason: null,
    bridgeSeedPositiveRows: bridgePositiveRows,
    bridgeCompanionCandidateRows: candidateRows,
    bridgeCompanionAcceptedRows: acceptedRows,
    bridgeCompanionRejectedRows: rejectedRows,
    liftedBridgePositiveRows: selectedRows,
    liftedSupportNearHardNegativeRows: liftedNegativeRows,
    bridgeLiftedPositivePrototype: state?.positivePrototype ?? {},
    bridgeFrontierPoints: frontierPoints,
    summary: {
      ...(cohort?.summary ?? {}),
      bridgeLiftReady: true,
      bridgeLiftReason: null,
      supportFitExcluded: cohort?.supportFitExcluded === true,
      supportLeaveOneOutRecovered,
      bridgeSeedPositiveSummary: summarizePerfectPrototypeSupportBridgeRows(bridgePositiveRows),
      bridgeCompanionCandidateCount: candidateRows.length,
      bridgeCompanionAcceptedCount: acceptedRows.length,
      bridgeCompanionRejectReasonCounts: rejectReasonCounts,
      bridgeLiftedPositiveSummary: liftedPositiveSummary,
      bridgeLiftedNegativeSummary: liftedNegativeSummary,
      bridgeLiftMarginalDateGain:
        liftedPositiveSummary.matchedDateCount -
        summarizePerfectPrototypeSupportBridgeRows(bridgePositiveRows).matchedDateCount,
      bridgeLiftMarginalMonthGain:
        liftedPositiveSummary.matchedMonthCount -
        summarizePerfectPrototypeSupportBridgeRows(bridgePositiveRows).matchedMonthCount,
      bridgeLiftMarginalFoldGain:
        liftedPositiveSummary.matchedFoldCount -
        summarizePerfectPrototypeSupportBridgeRows(bridgePositiveRows).matchedFoldCount,
      bridgeDynamicRescoreCount: dynamicRescoreCount,
      negativeShellRebuildCount,
      preThresholdFrontierPointCount: frontierPoints.length,
    },
  }
}
