import {
  applyTp12TouchLabelSelection,
} from "./perfect_prototype_tp12_touch_label_matrix.mjs"
import { buildTp12TouchVetoCandidates } from "./perfect_prototype_tp12_touch_veto_builder.mjs"

const uniqueSorted = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const clampRatio = (value, floor) => {
  if (!Number.isFinite(Number(value)) || Number(floor) <= 0) return 0
  return Math.min(1.5, Number(value) / Number(floor))
}

const buildRoleCounts = (terms = []) => {
  const out = {
    donor_exact: 0,
    cluster_any: 0,
    broadened_rule: 0,
    parent_lift: 0,
  }
  for (const term of Array.isArray(terms) ? terms : []) {
    const role = String(term?.role ?? "").trim()
    if (role in out) out[role] += 1
  }
  return out
}

const buildCoverageObjective = ({
  summary = {},
  totalRows = 0,
  baseRate = 0,
  selectedRowFloor = 60,
  matchedDateFloor = 15,
  matchedMonthFloor = 8,
  matchedFoldFloor = 4,
  maxTop1DateHitShare = 0.2,
} = {}) => {
  const precision = toNumber(summary?.precision, 0)
  const precisionLift = precision - baseRate
  const selectedRatio = totalRows > 0 ? toNumber(summary?.selectedRowCount, 0) / totalRows : 0
  const rowFloorRatio = clampRatio(summary?.selectedRowCount, selectedRowFloor)
  const dateFloorRatio = clampRatio(summary?.matchedDateCount, matchedDateFloor)
  const monthFloorRatio = clampRatio(summary?.matchedMonthCount, matchedMonthFloor)
  const foldFloorRatio = clampRatio(summary?.matchedFoldCount, matchedFoldFloor)
  const top1Penalty = Math.max(0, toNumber(summary?.top1DateHitShare, 0) - Number(maxTop1DateHitShare))
  const score =
    3.2 * precisionLift +
    0.7 * selectedRatio +
    1.5 * rowFloorRatio +
    1.7 * dateFloorRatio +
    0.9 * monthFloorRatio +
    0.55 * foldFloorRatio -
    2.25 * top1Penalty
  return {
    score,
    precisionLift,
    selectedRatio,
    rowFloorRatio,
    dateFloorRatio,
    monthFloorRatio,
    foldFloorRatio,
    top1Penalty,
  }
}

const compareObjective = (left = {}, right = {}) => {
  if (toNumber(right?.score, -Infinity) !== toNumber(left?.score, -Infinity)) {
    return toNumber(right?.score, -Infinity) - toNumber(left?.score, -Infinity)
  }
  if (toNumber(right?.precisionLift, -Infinity) !== toNumber(left?.precisionLift, -Infinity)) {
    return toNumber(right?.precisionLift, -Infinity) - toNumber(left?.precisionLift, -Infinity)
  }
  if (toNumber(right?.dateFloorRatio, -Infinity) !== toNumber(left?.dateFloorRatio, -Infinity)) {
    return toNumber(right?.dateFloorRatio, -Infinity) - toNumber(left?.dateFloorRatio, -Infinity)
  }
  if (toNumber(right?.rowFloorRatio, -Infinity) !== toNumber(left?.rowFloorRatio, -Infinity)) {
    return toNumber(right?.rowFloorRatio, -Infinity) - toNumber(left?.rowFloorRatio, -Infinity)
  }
  return 0
}

const buildSelectionState = ({
  trainRows = [],
  oosRows = [],
  positiveTermIds = [],
  vetoTokens = [],
  totalTrainRows = 0,
  baseRate = 0,
  selectedRowFloor = 60,
  matchedDateFloor = 15,
  matchedMonthFloor = 8,
  matchedFoldFloor = 4,
  maxTop1DateHitShare = 0.2,
} = {}) => {
  const trainSelection = applyTp12TouchLabelSelection({
    rowEntries: trainRows,
    positiveTermIds,
    vetoTokens,
  })
  const oosSelection = applyTp12TouchLabelSelection({
    rowEntries: oosRows,
    positiveTermIds,
    vetoTokens,
  })
  return {
    positiveTermIds: uniqueSorted(positiveTermIds),
    vetoTokens: uniqueSorted(vetoTokens),
    trainSummary: trainSelection.summary,
    oosSummary: oosSelection.summary,
    trainSelectedRows: trainSelection.selectedRows,
    oosSelectedRows: oosSelection.selectedRows,
    trainVetoedRows: trainSelection.vetoedRows,
    oosVetoedRows: oosSelection.vetoedRows,
    objective: buildCoverageObjective({
      summary: trainSelection.summary,
      totalRows: totalTrainRows,
      baseRate,
      selectedRowFloor,
      matchedDateFloor,
      matchedMonthFloor,
      matchedFoldFloor,
      maxTop1DateHitShare,
    }),
  }
}

const buildTermLookup = (terms = []) => new Map((Array.isArray(terms) ? terms : []).map((term) => [term.termId, term]))

const buildEligibleTerms = ({
  terms = [],
  minTrainTermPrecision = 0.3,
  minTrainTermDates = 3,
  minTrainTermMonths = 2,
  minTrainTermFolds = 3,
} = {}) =>
  (Array.isArray(terms) ? terms : [])
    .filter(
      (term) =>
        toNumber(term?.trainSummary?.precision, 0) >= Number(minTrainTermPrecision) &&
        toNumber(term?.trainSummary?.matchedDateCount, 0) >= Number(minTrainTermDates) &&
        toNumber(term?.trainSummary?.matchedMonthCount, 0) >= Number(minTrainTermMonths) &&
        toNumber(term?.trainSummary?.matchedFoldCount, 0) >= Number(minTrainTermFolds),
    )
    .slice()
    .sort((left, right) => {
      if (toNumber(right?.trainSummary?.matchedFoldCount, 0) !== toNumber(left?.trainSummary?.matchedFoldCount, 0)) {
        return toNumber(right?.trainSummary?.matchedFoldCount, 0) - toNumber(left?.trainSummary?.matchedFoldCount, 0)
      }
      if (toNumber(right?.trainSummary?.matchedMonthCount, 0) !== toNumber(left?.trainSummary?.matchedMonthCount, 0)) {
        return toNumber(right?.trainSummary?.matchedMonthCount, 0) - toNumber(left?.trainSummary?.matchedMonthCount, 0)
      }
      if (toNumber(right?.trainSummary?.matchedDateCount, 0) !== toNumber(left?.trainSummary?.matchedDateCount, 0)) {
        return toNumber(right?.trainSummary?.matchedDateCount, 0) - toNumber(left?.trainSummary?.matchedDateCount, 0)
      }
      if (toNumber(right?.trainSummary?.precision, 0) !== toNumber(left?.trainSummary?.precision, 0)) {
        return toNumber(right?.trainSummary?.precision, 0) - toNumber(left?.trainSummary?.precision, 0)
      }
      return String(left?.termId ?? "").localeCompare(String(right?.termId ?? ""))
    })

export const selectTp12TouchCoveragePreservingBundle = ({
  labelMatrix = {},
  maxPositiveTerms = 8,
  maxVetoTokens = 2,
  minPositiveImprovement = 0.01,
  minVetoImprovement = 0.005,
  minTrainTermPrecision = 0.3,
  minTrainTermDates = 3,
  minTrainTermMonths = 2,
  minTrainTermFolds = 3,
  minSelectedRowsAfterVeto = 60,
  minSelectedDatesAfterVeto = 15,
  maxTop1DateHitShare = 0.2,
  maxPositiveTermsPerRole = {},
  minVetoNegativeHits = 4,
  minVetoNetGain = 1,
  initialPositiveTermIds = [],
  minPositiveNewDateGain = 0,
  minPositiveNewRowGain = 0,
} = {}) => {
  const trainRows = Array.isArray(labelMatrix?.trainRows) ? labelMatrix.trainRows : []
  const oosRows = Array.isArray(labelMatrix?.oosRows) ? labelMatrix.oosRows : []
  const totalTrainRows = trainRows.length
  const baseRate = totalTrainRows > 0 ? trainRows.filter((row) => row?.outcomeHitTarget === true).length / totalTrainRows : 0
  const eligibleTerms = buildEligibleTerms({
    terms: labelMatrix?.terms,
    minTrainTermPrecision,
    minTrainTermDates,
    minTrainTermMonths,
    minTrainTermFolds,
  })
  const termLookup = buildTermLookup(eligibleTerms)
  const roleCaps = {
    donor_exact: Math.max(0, Math.floor(Number(maxPositiveTermsPerRole?.donor_exact ?? 3))),
    cluster_any: Math.max(0, Math.floor(Number(maxPositiveTermsPerRole?.cluster_any ?? 3))),
    broadened_rule: Math.max(0, Math.floor(Number(maxPositiveTermsPerRole?.broadened_rule ?? 3))),
    parent_lift: Math.max(0, Math.floor(Number(maxPositiveTermsPerRole?.parent_lift ?? 4))),
  }
  const emptyState = buildSelectionState({
    trainRows,
    oosRows,
    positiveTermIds: [],
    vetoTokens: [],
    totalTrainRows,
    baseRate,
    selectedRowFloor: minSelectedRowsAfterVeto,
    matchedDateFloor: minSelectedDatesAfterVeto,
    matchedMonthFloor: 8,
    matchedFoldFloor: 4,
    maxTop1DateHitShare,
  })
  const initialTermIds = uniqueSorted(initialPositiveTermIds).filter((termId) => termLookup.has(termId))
  let currentState =
    initialTermIds.length > 0
      ? buildSelectionState({
          trainRows,
          oosRows,
          positiveTermIds: initialTermIds,
          vetoTokens: [],
          totalTrainRows,
          baseRate,
          selectedRowFloor: minSelectedRowsAfterVeto,
          matchedDateFloor: minSelectedDatesAfterVeto,
          matchedMonthFloor: 8,
          matchedFoldFloor: 4,
          maxTop1DateHitShare,
        })
      : emptyState
  const positiveTrace = []
  for (let step = currentState.positiveTermIds.length; step < Math.max(0, Number(maxPositiveTerms) || 0); step += 1) {
    const currentRoleCounts = buildRoleCounts(currentState.positiveTermIds.map((termId) => termLookup.get(termId)).filter(Boolean))
    let best = null
    for (const term of eligibleTerms) {
      if (currentState.positiveTermIds.includes(term.termId)) continue
      if (toNumber(currentRoleCounts?.[term.role], 0) >= toNumber(roleCaps?.[term.role], 0)) continue
      const nextTermIds = [...currentState.positiveTermIds, term.termId]
      const nextState = buildSelectionState({
        trainRows,
        oosRows,
        positiveTermIds: nextTermIds,
        vetoTokens: [],
        totalTrainRows,
        baseRate,
        selectedRowFloor: minSelectedRowsAfterVeto,
        matchedDateFloor: minSelectedDatesAfterVeto,
        matchedMonthFloor: 8,
        matchedFoldFloor: 4,
        maxTop1DateHitShare,
      })
      const newRowGain = toNumber(nextState.trainSummary?.selectedRowCount, 0) - toNumber(currentState.trainSummary?.selectedRowCount, 0)
      const newDateGain = toNumber(nextState.trainSummary?.matchedDateCount, 0) - toNumber(currentState.trainSummary?.matchedDateCount, 0)
      if (newDateGain < Number(minPositiveNewDateGain)) continue
      if (newRowGain < Number(minPositiveNewRowGain)) continue
      const termSelectedRows = toNumber(term?.trainSummary?.selectedRowCount, 0)
      const termMatchedDates = toNumber(term?.trainSummary?.matchedDateCount, 0)
      const overlapPenalty = termSelectedRows > 0 ? 1 - Math.max(0, newRowGain) / termSelectedRows : 1
      const candidateScore = {
        ...nextState.objective,
        score:
          toNumber(nextState.objective?.score, -Infinity) +
          1.2 * (termMatchedDates > 0 ? Math.max(0, newDateGain) / termMatchedDates : 0) +
          0.45 * (termSelectedRows > 0 ? Math.max(0, newRowGain) / termSelectedRows : 0) -
          0.6 * overlapPenalty,
      }
      const gain = toNumber(candidateScore?.score, -Infinity) - toNumber(currentState.objective?.score, -Infinity)
      const preview = {
        termId: term.termId,
        role: term.role,
        gain,
        newRowGain,
        newDateGain,
        overlapPenalty,
        trainSummary: nextState.trainSummary,
        objective: candidateScore,
      }
      if (!best || compareObjective({ ...best.objective, score: best.score }, { ...candidateScore }) > 0) {
        best = {
          term,
          state: nextState,
          score: candidateScore.score,
          gain,
          preview,
        }
      }
    }
    if (!best) break
    if (step >= initialTermIds.length && Number(best.gain) < Number(minPositiveImprovement)) break
    currentState = {
      ...best.state,
      objective: { ...best.state.objective, score: best.score },
    }
    positiveTrace.push(best.preview)
  }

  const vetoBuilder = buildTp12TouchVetoCandidates({
    selectedTrainRows: currentState.trainSelectedRows,
    minNegativeHits: minVetoNegativeHits,
    minNetGain: minVetoNetGain,
  })
  let finalState = currentState
  const vetoTrace = []
  let selectedVetoTokens = []
  for (let step = 0; step < Math.max(0, Number(maxVetoTokens) || 0); step += 1) {
    let best = null
    for (const candidate of Array.isArray(vetoBuilder?.candidates) ? vetoBuilder.candidates : []) {
      if (selectedVetoTokens.includes(candidate.token)) continue
      const nextVetoTokens = [...selectedVetoTokens, candidate.token]
      const nextState = buildSelectionState({
        trainRows,
        oosRows,
        positiveTermIds: currentState.positiveTermIds,
        vetoTokens: nextVetoTokens,
        totalTrainRows,
        baseRate,
        selectedRowFloor: minSelectedRowsAfterVeto,
        matchedDateFloor: minSelectedDatesAfterVeto,
        matchedMonthFloor: 8,
        matchedFoldFloor: 4,
        maxTop1DateHitShare,
      })
      if (toNumber(nextState.trainSummary?.selectedRowCount, 0) < Number(minSelectedRowsAfterVeto)) continue
      if (toNumber(nextState.trainSummary?.matchedDateCount, 0) < Number(minSelectedDatesAfterVeto)) continue
      const positiveLoss = toNumber(finalState.trainSummary?.positiveRowCount, 0) - toNumber(nextState.trainSummary?.positiveRowCount, 0)
      const negativeReduction = toNumber(finalState.trainSummary?.negativeRowCount, 0) - toNumber(nextState.trainSummary?.negativeRowCount, 0)
      if (negativeReduction <= 0) continue
      const score =
        toNumber(nextState.objective?.score, -Infinity) +
        0.8 * (negativeReduction / Math.max(1, toNumber(finalState.trainSummary?.negativeRowCount, 0))) -
        0.4 * (Math.max(0, positiveLoss) / Math.max(1, toNumber(finalState.trainSummary?.positiveRowCount, 0)))
      const gain = score - toNumber(finalState.objective?.score, -Infinity)
      const preview = {
        token: candidate.token,
        gain,
        negativeReduction,
        positiveLoss,
        trainSummary: nextState.trainSummary,
        objective: {
          ...nextState.objective,
          score,
        },
      }
      if (!best || compareObjective({ ...best.objective, score: best.score }, { ...nextState.objective, score }) > 0) {
        best = {
          token: candidate.token,
          state: nextState,
          score,
          gain,
          preview,
        }
      }
    }
    if (!best) break
    if (Number(best.gain) < Number(minVetoImprovement)) break
    selectedVetoTokens = [...selectedVetoTokens, best.token]
    finalState = {
      ...best.state,
      objective: { ...best.state.objective, score: best.score },
    }
    vetoTrace.push(best.preview)
  }

  return {
    ok: currentState.positiveTermIds.length > 0,
    eligibleTermCount: eligibleTerms.length,
    baseRate,
    initialPositiveTermIds: initialTermIds,
    positiveBundle: {
      termIds: currentState.positiveTermIds,
      terms: currentState.positiveTermIds.map((termId) => termLookup.get(termId)).filter(Boolean),
      trainSummary: currentState.trainSummary,
      oosSummary: currentState.oosSummary,
      objective: currentState.objective,
      trace: positiveTrace,
    },
    vetoBuilder,
    vetoBundle: {
      selectedTokens: selectedVetoTokens,
      trainSummary: finalState.trainSummary,
      oosSummary: finalState.oosSummary,
      objective: finalState.objective,
      trace: vetoTrace,
    },
    finalBundle: {
      positiveTermIds: currentState.positiveTermIds,
      vetoTokens: selectedVetoTokens,
      trainSummary: finalState.trainSummary,
      oosSummary: finalState.oosSummary,
      objective: finalState.objective,
      trainSelectedRows: finalState.trainSelectedRows,
      oosSelectedRows: finalState.oosSelectedRows,
      trainVetoedRows: finalState.trainVetoedRows,
      oosVetoedRows: finalState.oosVetoedRows,
    },
  }
}

export const buildTp12TouchBundleUnionVerdict = ({
  baselineOosLineSummary = {},
  bundle = {},
  minVerdictOosSelectedRows = 100,
  minVerdictOosDates = 60,
  maxVerdictOosTop1DateHitShare = 0.15,
} = {}) => {
  const baselineHitRate = toNumber(baselineOosLineSummary?.hitRate, 0)
  const oosSummary = bundle?.finalBundle?.oosSummary ?? {}
  if (bundle?.ok !== true) {
    return {
      code: "no_feasible_touch_bundle_union",
      message: "No touch bundle-union could be formed from the current donor/cluster/broadening term bank.",
    }
  }
  const coverageOk =
    toNumber(oosSummary?.selectedRowCount, 0) >= Number(minVerdictOosSelectedRows) &&
    toNumber(oosSummary?.matchedDateCount, 0) >= Number(minVerdictOosDates) &&
    toNumber(oosSummary?.top1DateHitShare, 0) <= Number(maxVerdictOosTop1DateHitShare)
  if (coverageOk && toNumber(oosSummary?.precision, 0) > baselineHitRate) {
    return {
      code: "coverage_preserving_touch_lift",
      message: "Touch bundle-union lifts OOS hit-rate while keeping the required selected-row and matched-date footprint.",
    }
  }
  if (toNumber(oosSummary?.precision, 0) > baselineHitRate) {
    return {
      code: "precision_lift_coverage_shortfall",
      message: "Touch bundle-union improves OOS hit-rate, but coverage remains below the required floor.",
    }
  }
  if (coverageOk) {
    return {
      code: "coverage_preserving_no_lift",
      message: "Touch bundle-union keeps a meaningful OOS footprint, but does not improve hit-rate versus the baseline touch line.",
    }
  }
  return {
    code: "coverage_loss_no_lift",
    message: "Touch bundle-union neither preserves the required OOS footprint nor improves hit-rate versus the baseline touch line.",
  }
}
