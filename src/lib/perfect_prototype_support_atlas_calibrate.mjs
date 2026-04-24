import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "./perfect_prototype_support_case.mjs"
import {
  scorePerfectPrototypeSupportAtlasCell,
} from "./perfect_prototype_support_atlas_metric.mjs"
import {
  applyPerfectPrototypeSupportAtlas,
  summarizePerfectPrototypeSupportAtlasSelections,
} from "./perfect_prototype_support_atlas_apply.mjs"
import { buildPerfectPrototypeSupportAtlasUnsat } from "./perfect_prototype_support_atlas_unsat.mjs"
import { buildPerfectPrototypeSupportAtlasCellUnionSummary } from "./perfect_prototype_support_atlas_cell_union.mjs"
import {
  buildPerfectPrototypeSupportAtlasBoundaryVetoOptions,
  buildPerfectPrototypeSupportAtlasPrethresholdCellOption,
} from "./perfect_prototype_support_boundary_veto.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const uniqueNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => num(value))
        .filter(Number.isFinite)
        .map((value) => Number(value.toFixed(8))),
    ),
  )

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

const buildCartesianProduct = (lists = []) => {
  const safeLists = Array.isArray(lists) ? lists : []
  if (safeLists.length < 1) return [[]]
  let out = [[]]
  for (const list of safeLists) {
    const next = []
    for (const prefix of out) {
      for (const item of Array.isArray(list) ? list : []) {
        next.push([...prefix, item])
      }
    }
    out = next
  }
  return out
}

const recordReason = (reasonCounts, reason) => {
  if (!reason) return
  reasonCounts[reason] = Number(reasonCounts[reason] ?? 0) + 1
}

const compareAtlasSolutions = (left, right) => {
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
  if (toNumber(left?.cellCount, 0) !== toNumber(right?.cellCount, 0)) {
    return toNumber(left?.cellCount, 0) - toNumber(right?.cellCount, 0)
  }
  return toNumber(right?.abstainThreshold, 0) - toNumber(left?.abstainThreshold, 0)
}

const buildCellThresholdOptions = ({ dataset, cellCandidate, maxOptionsPerCell = 6 } = {}) => {
  const positiveEvaluations = cellCandidate.positiveRows.map((row) =>
    scorePerfectPrototypeSupportAtlasCell({
      row,
      cell: cellCandidate,
      dataset,
    }),
  )
  const supportCaseEvaluations = (dataset?.supportCaseViews ?? []).map((row) =>
    scorePerfectPrototypeSupportAtlasCell({
      row,
      cell: cellCandidate,
      dataset,
    }),
  )
  const positivePosDistances = positiveEvaluations.map((entry) => entry.posDistance)
  const positiveRadiusBases = positiveEvaluations.map(
    (entry) => entry?.positiveKDistance ?? entry?.posDistance,
  )
  const positiveMargins = positiveEvaluations.map((entry) => entry.margin)
  const positiveScores = positiveEvaluations.map((entry) => entry.score)
  const supportPosDistances = supportCaseEvaluations
    .map((entry) => entry?.positiveKDistance ?? entry?.posDistance)
    .filter(Number.isFinite)
  const supportMargins = supportCaseEvaluations.map((entry) => entry.margin).filter(Number.isFinite)
  const supportScores = supportCaseEvaluations.map((entry) => entry.score).filter(Number.isFinite)
  const radiusCandidates = uniqueNumbers([
    ...[0.5, 0.7, 0.85, 0.95].map((q) => quantile(positiveRadiusBases, q)),
    supportPosDistances.length > 0 ? Math.max(...supportPosDistances) : null,
  ])
  const minPositiveVotesCandidates = Array.from(
    {
      length: Math.max(
        1,
        Math.min(3, Math.floor(Number(cellCandidate?.positiveAnchors?.length ?? 1) || 1)),
      ),
    },
    (_, index) => index + 1,
  )
  const marginCandidates = uniqueNumbers([
    ...[0.05, 0.15, 0.25, 0.5].map((q) => quantile(positiveMargins, q)),
    supportMargins.length > 0 ? Math.min(...supportMargins) : null,
    0,
  ])
  const scoreCandidates = uniqueNumbers([
    ...[0.05, 0.15, 0.25].map((q) => quantile(positiveScores, q)),
    supportScores.length > 0 ? Math.min(...supportScores) : null,
    -0.5,
  ])

  return buildCartesianProduct([
    radiusCandidates,
    minPositiveVotesCandidates,
    marginCandidates,
    scoreCandidates,
  ])
    .map(([positiveRadius, minPositiveVotes, vetoMargin, scoreThreshold]) => {
      const supportCaseCoveredCount = supportCaseEvaluations.filter((entry) => {
        const posDistance = toNumber(entry?.posDistance, Number.POSITIVE_INFINITY)
        const margin = toNumber(entry?.margin, Number.NEGATIVE_INFINITY)
        const score = toNumber(entry?.score, Number.NEGATIVE_INFINITY)
        const positiveVoteCount = Array.isArray(entry?.positiveDistances)
          ? entry.positiveDistances.filter((distance) => Number(distance) <= positiveRadius).length
          : minPositiveVotes
        return (
          positiveVoteCount >= minPositiveVotes &&
          posDistance <= positiveRadius &&
          margin >= vetoMargin &&
          score >= scoreThreshold
        )
      }).length
      const optionScore =
        supportCaseCoveredCount * 300 +
        toNumber(cellCandidate?.positiveSummary?.matchedDateCount, 0) * 12 +
        toNumber(cellCandidate?.positiveSummary?.matchedMonthCount, 0) * 8 -
        positiveRadius * 10 * -1 +
        vetoMargin * 10
      return {
        cellId: cellCandidate.cellId,
        positiveRadius,
        minPositiveVotes,
        vetoMargin,
        scoreThreshold,
        supportCaseCoveredCount,
        optionScore,
      }
    })
    .sort((left, right) => right.optionScore - left.optionScore)
    .slice(0, Math.max(1, Math.floor(Number(maxOptionsPerCell) || 6)))
}

const buildArtifact = ({ dataset, selectedCells = [], abstainThreshold = 0 } = {}) => ({
  familyId: dataset?.familyId ?? "low_gap_top_continuation",
  surfaceName: dataset?.surfaceName ?? null,
  gateTokens: dataset?.gateTokens ?? [],
  supportCaseIds: dataset?.supportCaseIds ?? [],
  featureKeys: dataset?.featureKeys ?? [],
  featureScales: dataset?.featureScales ?? {},
  positivePrototypes: selectedCells.map((cell) => ({
    cellId: cell.cellId,
    prototype: cell.positivePrototype,
  })),
  negativePrototypes: selectedCells.map((cell) => ({
    cellId: cell.cellId,
    prototype: cell.negativePrototype,
  })),
  cells: selectedCells.map((cell) => ({
    cellId: cell.cellId,
    positivePrototype: cell.positivePrototype,
    negativePrototype: cell.negativePrototype,
    positiveAnchors: cell.positiveAnchors ?? [],
    negativeBorderAnchors: cell.negativeBorderAnchors ?? [],
    featureWeights: cell.featureWeights,
    positiveRadius: cell.positiveRadius ?? cell.acceptanceRadius,
    acceptanceRadius: cell.positiveRadius ?? cell.acceptanceRadius,
    minPositiveVotes: cell.minPositiveVotes ?? 1,
    kPositive: cell.kPositive ?? 1,
    negativeMargin: cell.negativeMargin ?? cell.vetoMargin,
    vetoMargin: cell.negativeMargin ?? cell.vetoMargin,
    scoreThreshold: cell.scoreThreshold,
    positiveSummary: cell.positiveSummary,
    negativeSummary: cell.negativeSummary,
    anchorCoverageSummary: cell.anchorCoverageSummary ?? {},
    negativeBorderSummary: cell.negativeBorderSummary ?? {},
  })),
  abstainThreshold,
})

const decorateRowWithAtlasMetrics = ({ row, cellCandidates = [], dataset } = {}) => ({
  ...row,
  atlasMetricsByCell: Object.fromEntries(
    cellCandidates.map((cell) => [
      cell.cellId,
      scorePerfectPrototypeSupportAtlasCell({
        row,
        cell,
        dataset,
      }),
    ]),
  ),
})

const evaluateArtifactCandidate = ({
  artifact,
  decoratedCalibrationRows = [],
  decoratedSupportCaseViews = [],
} = {}) => {
  const supportMatched = applyPerfectPrototypeSupportAtlas({
    artifact,
    rows: decoratedSupportCaseViews,
  })
    .filter((entry) => entry.selected === true)
    .map((entry) => entry.row.caseId)
    .filter(Boolean)
  const trainEvaluations = applyPerfectPrototypeSupportAtlas({
    artifact,
    rows: decoratedCalibrationRows,
  })
  const trainSummary = summarizePerfectPrototypeSupportAtlasSelections({
    evaluations: trainEvaluations,
    supportCaseIds: supportMatched,
  })
  return {
    supportMatched,
    trainEvaluations,
    trainSummary,
  }
}

const buildPrethresholdSelectedCells = ({
  dataset,
  selectedCellCandidates = [],
} = {}) =>
  selectedCellCandidates.map((cellCandidate) => {
    const option = buildPerfectPrototypeSupportAtlasPrethresholdCellOption({
      dataset,
      cellCandidate,
    })
    return {
      ...cellCandidate,
      positiveRadius: option.positiveRadius,
      acceptanceRadius: option.positiveRadius,
      minPositiveVotes: option.minPositiveVotes,
      negativeMargin: option.vetoMargin,
      vetoMargin: option.vetoMargin,
      scoreThreshold: option.scoreThreshold,
    }
  })

const pickPrimaryReason = (reasonCounts = {}) => {
  const entries = Object.entries(reasonCounts).sort((left, right) => right[1] - left[1])
  return entries[0]?.[0] ?? "unsat_no_local_prototype_atlas"
}

export const calibratePerfectPrototypeSupportAtlas = ({
  dataset,
  candidateSpace,
  maxActiveCells = 3,
  maxOptionsPerCell = 6,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  minCrossfitPositiveWindows = 2,
  maxCrossfitNegativeWindows = 0,
} = {}) => {
  const gateTokens = Array.isArray(dataset?.gateTokens) ? dataset.gateTokens : []
  if (gateTokens.length < 1) {
    return buildPerfectPrototypeSupportAtlasUnsat({
      reason: "unsat_no_gate",
      reasonCounts: { unsat_no_gate: 1 },
      candidateSummary: candidateSpace?.summary,
    })
  }

  const cellCandidates = Array.isArray(candidateSpace?.cellCandidates) ? candidateSpace.cellCandidates : []
  if (cellCandidates.length < 1) {
    return buildPerfectPrototypeSupportAtlasUnsat({
      reason: "unsat_no_local_cells",
      reasonCounts: { unsat_no_local_cells: 1 },
      candidateSummary: candidateSpace?.summary,
    })
  }

  if (toNumber(candidateSpace?.summary?.atlasPositiveSupportMarginCellCount, 0) < 1) {
    return buildPerfectPrototypeSupportAtlasUnsat({
      reason: "unsat_support_case_outside_all_bridge_cells",
      reasonCounts: { unsat_support_case_outside_all_bridge_cells: 1 },
      candidateSummary: candidateSpace?.summary,
    })
  }

  const decoratedCalibrationRows = (dataset?.calibrationRows ?? []).map((row) =>
    decorateRowWithAtlasMetrics({
      row,
      cellCandidates,
      dataset,
    }),
  )
  const decoratedSupportCaseViews = (dataset?.supportCaseViews ?? []).map((row) =>
    decorateRowWithAtlasMetrics({
      row,
      cellCandidates,
      dataset,
    }),
  )

  const candidateCellPool = cellCandidates.slice(0, Math.max(1, Math.min(cellCandidates.length, maxActiveCells + 1)))
  const cappedMaxActiveCells = Math.min(2, Math.max(1, Math.floor(Number(maxActiveCells) || 3)))
  const reasonCounts = {}
  const candidatesEvaluated = []
  let triedCandidateCount = 0
  let bestSolution = null
  let boundaryVetoAppliedCount = 0
  let boundaryVetoBestPrecisionLift = 0
  let boundaryVetoSupportLossCount = 0
  const preThresholdFrontier = []

  const considerSolution = ({ artifact, trainSummary, supportMatched, selectedCells, abstainThreshold }) => {
    const candidate = {
      cellCount: selectedCells.length,
      cellUnionCount: Math.max(0, selectedCells.length - 1),
      abstainThreshold,
      selectedCellIds: selectedCells.map((cell) => cell.cellId),
      supportMatched,
      trainSummary,
      artifact,
      unionSummary: buildPerfectPrototypeSupportAtlasCellUnionSummary(selectedCells),
    }
    if (!bestSolution || compareAtlasSolutions(candidate, bestSolution) < 0) {
      bestSolution = candidate
    }
  }

  for (let cellCount = 1; cellCount <= Math.min(cappedMaxActiveCells, candidateCellPool.length); cellCount += 1) {
    for (const indexes of buildCombinationIndexes(candidateCellPool.length, cellCount)) {
      const selectedCellCandidates = indexes.map((index) => candidateCellPool[index])
      const prethresholdCells = buildPrethresholdSelectedCells({
        dataset,
        selectedCellCandidates,
      })
      for (const abstainThreshold of [-0.5, -0.25, 0]) {
        const prethresholdArtifact = buildArtifact({
          dataset,
          selectedCells: prethresholdCells,
          abstainThreshold,
        })
        const prethresholdEvaluation = evaluateArtifactCandidate({
          artifact: prethresholdArtifact,
          decoratedCalibrationRows,
          decoratedSupportCaseViews,
        })
        triedCandidateCount += 1
        preThresholdFrontier.push({
          cellCount: prethresholdCells.length,
          selectedCellIds: prethresholdCells.map((cell) => cell.cellId),
          abstainThreshold,
          supportMatched: prethresholdEvaluation.supportMatched,
          trainSummary: prethresholdEvaluation.trainSummary,
        })
        if (candidatesEvaluated.length < 256) {
          candidatesEvaluated.push({
            cellCount: prethresholdCells.length,
            cellUnionCount: Math.max(0, prethresholdCells.length - 1),
            abstainThreshold,
            selectedCellIds: prethresholdCells.map((cell) => cell.cellId),
            supportMatched: prethresholdEvaluation.supportMatched,
            failureReason: null,
            trainSummary: prethresholdEvaluation.trainSummary,
          })
        }

        if (!prethresholdEvaluation.supportMatched.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID)) {
          recordReason(reasonCounts, "unsat_historical_support")
          continue
        }
        if (
          toNumber(prethresholdEvaluation.trainSummary?.trainMatchedDateCount, 0) < minTrainMatchedDates ||
          toNumber(prethresholdEvaluation.trainSummary?.trainMatchedMonthCount, 0) < minTrainMatchedMonths ||
          toNumber(prethresholdEvaluation.trainSummary?.trainMatchedFoldCount, 0) < minTrainMatchedFolds
        ) {
          recordReason(reasonCounts, "unsat_prethreshold_frontier_below_breadth")
          continue
        }
        if (
          toNumber(prethresholdEvaluation.trainSummary?.precision, 0) >= 1 &&
          toNumber(prethresholdEvaluation.trainSummary?.crossfitNegativeWindowCount, 0) <=
            maxCrossfitNegativeWindows &&
          toNumber(prethresholdEvaluation.trainSummary?.crossfitPositiveWindowCount, 0) >=
            minCrossfitPositiveWindows
        ) {
          considerSolution({
            artifact: prethresholdArtifact,
            trainSummary: prethresholdEvaluation.trainSummary,
            supportMatched: prethresholdEvaluation.supportMatched,
            selectedCells: prethresholdCells,
            abstainThreshold,
          })
          continue
        }

        boundaryVetoAppliedCount += 1
        boundaryVetoBestPrecisionLift = Math.max(
          boundaryVetoBestPrecisionLift,
          1 - toNumber(prethresholdEvaluation.trainSummary?.precision, 0),
        )

        const selectedNegativeRows = prethresholdEvaluation.trainEvaluations
          .filter((entry) => entry?.selected === true && entry?.row?.outcomeHitTarget !== true)
          .map((entry) => entry.row)
        const optionLists = selectedCellCandidates.map((cellCandidate, index) =>
          buildPerfectPrototypeSupportAtlasBoundaryVetoOptions({
            selectedNegatives: selectedNegativeRows
              .map((row) => row?.atlasMetricsByCell?.[cellCandidate?.cellId])
              .filter(Boolean),
            supportEvaluations: decoratedSupportCaseViews
              .map((row) => row?.atlasMetricsByCell?.[cellCandidate?.cellId])
              .filter(Boolean),
            baseOption: {
              cellId: cellCandidate?.cellId ?? null,
              positiveRadius: prethresholdCells[index]?.positiveRadius,
              minPositiveVotes: prethresholdCells[index]?.minPositiveVotes,
              vetoMargin: prethresholdCells[index]?.vetoMargin,
              scoreThreshold: prethresholdCells[index]?.scoreThreshold,
            },
          }),
        )

        let recovered = false
        for (const selectedOptions of buildCartesianProduct(optionLists)) {
          for (const vetoAbstainThreshold of [abstainThreshold, 0, 0.25]) {
            const vetoCells = selectedCellCandidates.map((cellCandidate, index) => ({
              ...cellCandidate,
              positiveRadius: selectedOptions[index]?.positiveRadius,
              acceptanceRadius: selectedOptions[index]?.positiveRadius,
              minPositiveVotes: selectedOptions[index]?.minPositiveVotes,
              negativeMargin: selectedOptions[index]?.vetoMargin,
              vetoMargin: selectedOptions[index]?.vetoMargin,
              scoreThreshold: selectedOptions[index]?.scoreThreshold,
            }))
            const vetoArtifact = buildArtifact({
              dataset,
              selectedCells: vetoCells,
              abstainThreshold: vetoAbstainThreshold,
            })
            const vetoEvaluation = evaluateArtifactCandidate({
              artifact: vetoArtifact,
              decoratedCalibrationRows,
              decoratedSupportCaseViews,
            })
            triedCandidateCount += 1
            if (!vetoEvaluation.supportMatched.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID)) {
              boundaryVetoSupportLossCount += 1
              recordReason(reasonCounts, "unsat_boundary_veto_support_loss")
              continue
            }
            if (toNumber(vetoEvaluation.trainSummary?.precision, 0) < 1) {
              recordReason(reasonCounts, "unsat_boundary_veto_no_precision_recovery")
              continue
            }
            if (
              toNumber(vetoEvaluation.trainSummary?.crossfitNegativeWindowCount, 0) >
              maxCrossfitNegativeWindows
            ) {
              recordReason(reasonCounts, "unsat_boundary_veto_no_precision_recovery")
              continue
            }
            if (
              toNumber(vetoEvaluation.trainSummary?.crossfitPositiveWindowCount, 0) <
              minCrossfitPositiveWindows
            ) {
              recordReason(reasonCounts, "unsat_train_breadth")
              continue
            }
            recovered = true
            considerSolution({
              artifact: vetoArtifact,
              trainSummary: vetoEvaluation.trainSummary,
              supportMatched: vetoEvaluation.supportMatched,
              selectedCells: vetoCells,
              abstainThreshold: vetoAbstainThreshold,
            })
          }
        }
        if (!recovered) {
          recordReason(reasonCounts, "unsat_boundary_veto_no_precision_recovery")
        }
      }
    }
  }

  if (!bestSolution) {
    const reason =
      preThresholdFrontier.length < 1
        ? "unsat_prethreshold_frontier_empty"
        : pickPrimaryReason(reasonCounts)
    return buildPerfectPrototypeSupportAtlasUnsat({
      reason,
      reasonCounts,
      candidateSummary: candidateSpace?.summary,
      triedCandidateCount,
      candidatesEvaluated,
      extraSummary: {
        supportFitExcluded: dataset?.supportFitExcluded === true,
        supportLeaveOneOutRecovered: dataset?.summary?.supportLeaveOneOutRecovered === true,
        preThresholdFrontierPointCount: preThresholdFrontier.length,
        preThresholdBestBreadthCandidate: preThresholdFrontier
          .slice()
          .sort((left, right) =>
            compareAtlasSolutions(
              {
                trainSummary: right?.trainSummary ?? {},
                cellCount: right?.selectedCellIds?.length ?? 0,
                abstainThreshold: right?.abstainThreshold ?? 0,
              },
              {
                trainSummary: left?.trainSummary ?? {},
                cellCount: left?.selectedCellIds?.length ?? 0,
                abstainThreshold: left?.abstainThreshold ?? 0,
              },
            ),
          )[0]?.trainSummary ?? null,
        boundaryVetoAppliedCount,
        boundaryVetoBestPrecisionLift,
        boundaryVetoSupportLossCount,
      },
      preThresholdFrontier,
    })
  }

  return {
    ok: true,
    atlasSolvedCount: 1,
    atlasHistoricalSupportMatchedCount: bestSolution.supportMatched.includes(
      PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
    )
      ? 1
      : 0,
    artifact: {
      ...bestSolution.artifact,
      fitDiagnostics: {
        atlasCellCandidateCount: Number(candidateSpace?.summary?.atlasCellCandidateCount ?? 0),
        atlasQualifiedCellCount: Number(candidateSpace?.summary?.atlasQualifiedCellCount ?? 0),
        atlasAnchorSetCount: Number(candidateSpace?.summary?.atlasAnchorSetCount ?? 0),
        supportFitExcluded: dataset?.supportFitExcluded === true,
        supportLeaveOneOutRecovered: dataset?.summary?.supportLeaveOneOutRecovered === true,
        atlasBestTrainBreadthBeforeThreshold:
          candidateSpace?.summary?.atlasBestTrainBreadthBeforeThreshold ?? {},
        atlasBestTrainBreadthAfterThreshold: {
          matchedDateCount: Number(bestSolution?.trainSummary?.trainMatchedDateCount ?? 0),
          matchedMonthCount: Number(bestSolution?.trainSummary?.trainMatchedMonthCount ?? 0),
          matchedFoldCount: Number(bestSolution?.trainSummary?.trainMatchedFoldCount ?? 0),
        },
        atlasCellUnionCount: Number(bestSolution?.unionSummary?.atlasCellUnionCount ?? 0),
        calibrationRowCount: (dataset?.calibrationRows ?? []).length,
        preThresholdFrontierPointCount: preThresholdFrontier.length,
        preThresholdBestBreadthCandidate: preThresholdFrontier
          .slice()
          .sort((left, right) =>
            compareAtlasSolutions(
              {
                trainSummary: right?.trainSummary ?? {},
                cellCount: right?.selectedCellIds?.length ?? 0,
                abstainThreshold: right?.abstainThreshold ?? 0,
              },
              {
                trainSummary: left?.trainSummary ?? {},
                cellCount: left?.selectedCellIds?.length ?? 0,
                abstainThreshold: left?.abstainThreshold ?? 0,
              },
            ),
          )[0]?.trainSummary ?? null,
        boundaryVetoAppliedCount,
        boundaryVetoBestPrecisionLift,
        boundaryVetoSupportLossCount,
      },
    },
    trainSummary: bestSolution.trainSummary,
    triedCandidateCount,
    candidatesEvaluated,
    preThresholdFrontier,
  }
}
