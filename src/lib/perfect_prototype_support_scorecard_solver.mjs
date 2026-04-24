import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "./perfect_prototype_support_case.mjs"
import {
  applyPerfectPrototypeSupportScorecard,
  summarizePerfectPrototypeSupportScorecardSelections,
} from "./perfect_prototype_support_scorecard_apply.mjs"

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const compareSolutions = (left, right) => {
  if (toNumber(left?.termCount, 0) !== toNumber(right?.termCount, 0)) {
    return toNumber(left?.termCount, 0) - toNumber(right?.termCount, 0)
  }
  if (toNumber(right?.trainSummary?.trainMatchedDateCount, 0) !== toNumber(left?.trainSummary?.trainMatchedDateCount, 0)) {
    return toNumber(right?.trainSummary?.trainMatchedDateCount, 0) - toNumber(left?.trainSummary?.trainMatchedDateCount, 0)
  }
  if (toNumber(right?.trainSummary?.trainMatchedMonthCount, 0) !== toNumber(left?.trainSummary?.trainMatchedMonthCount, 0)) {
    return toNumber(right?.trainSummary?.trainMatchedMonthCount, 0) - toNumber(left?.trainSummary?.trainMatchedMonthCount, 0)
  }
  return toNumber(right?.threshold, 0) - toNumber(left?.threshold, 0)
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

const buildThresholdCandidates = (terms) => {
  const positiveWeight = (Array.isArray(terms) ? terms : [])
    .map((term) => toNumber(term.weight, 0))
    .filter((value) => value > 0)
    .reduce((sum, value) => sum + value, 0)
  const thresholds = []
  for (let value = 1; value <= Math.max(1, positiveWeight); value += 1) {
    thresholds.push(value)
  }
  return thresholds
}

const recordReason = (reasonCounts, reason) => {
  if (!reason) return
  reasonCounts[reason] = Number(reasonCounts[reason] ?? 0) + 1
}

const buildCandidatePreview = (candidate) => ({
  termCount: Number(candidate?.termCount ?? 0),
  threshold: Number(candidate?.threshold ?? 0),
  selectedTermIds: (candidate?.selectedTerms ?? []).map((term) => term?.termId).filter(Boolean),
  supportMatched: Array.isArray(candidate?.supportMatched) ? candidate.supportMatched : [],
  failureReason: candidate?.failureReason ?? null,
  trainSummary: candidate?.trainSummary ?? {},
})

const buildUnsatSummary = ({
  reasonCounts = {},
  triedCandidateCount = 0,
  termSummary = {},
  candidatesEvaluated = [],
} = {}) => ({
  ok: false,
  reason: "unsat_no_feasible_support_scorecard",
  scorecardUnsatReasonCounts: reasonCounts,
  scorecardSolvedCount: 0,
  scorecardTermCandidateCount: Number(termSummary?.scorecardTermCandidateCount ?? 0),
  scorecardTermQualifiedCount: Number(termSummary?.scorecardTermQualifiedCount ?? 0),
  scorecardHistoricalSupportMatchedCount: 0,
  triedCandidateCount,
  candidatesEvaluated,
})

export const solvePerfectPrototypeSupportScorecard = ({
  cohort,
  termBank,
  maxTerms = 5,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  minCrossfitPositiveWindows = 2,
  maxCrossfitNegativeWindows = 0,
} = {}) => {
  const reasonCounts = {}
  const supportAnchorTerms = Array.isArray(termBank?.roleTerms?.support_anchor)
    ? termBank.roleTerms.support_anchor
    : []
  const breadthTerms = Array.isArray(termBank?.roleTerms?.breadth_extender)
    ? termBank.roleTerms.breadth_extender
    : []
  const riskTerms = Array.isArray(termBank?.roleTerms?.risk_killer)
    ? termBank.roleTerms.risk_killer
    : []
  const gatedTrainRows = Array.isArray(cohort?.gatedTrainRows)
    ? cohort.gatedTrainRows
    : Array.isArray(cohort?.trainRows)
      ? cohort.trainRows
      : []
  if ((cohort?.gateTokens ?? []).length < 1) {
    return buildUnsatSummary({
      reasonCounts: { unsat_no_gate_tokens: 1 },
      termSummary: termBank?.summary,
    })
  }
  if (supportAnchorTerms.length < 1) {
    return buildUnsatSummary({
      reasonCounts: { unsat_no_support_anchor_terms: 1 },
      termSummary: termBank?.summary,
    })
  }
  if (breadthTerms.length < 1) {
    return buildUnsatSummary({
      reasonCounts: { unsat_no_breadth_extender_terms: 1 },
      termSummary: termBank?.summary,
    })
  }

  const candidatesEvaluated = []
  let triedCandidateCount = 0
  let bestSolution = null
  const anchorMax = Math.min(2, supportAnchorTerms.length)
  const breadthMax = Math.min(Math.max(1, maxTerms - 1), breadthTerms.length)
  const riskMax = Math.min(2, riskTerms.length)

  for (let anchorCount = 1; anchorCount <= anchorMax; anchorCount += 1) {
    for (const anchorIndexes of buildCombinationIndexes(supportAnchorTerms.length, anchorCount)) {
      for (let breadthCount = 1; breadthCount <= breadthMax; breadthCount += 1) {
        for (const breadthIndexes of buildCombinationIndexes(breadthTerms.length, breadthCount)) {
          for (let riskCount = 0; riskCount <= riskMax; riskCount += 1) {
            const termCount = anchorCount + breadthCount + riskCount
            if (termCount > maxTerms) continue
            const riskIndexSets =
              riskCount === 0 ? [[]] : buildCombinationIndexes(riskTerms.length, riskCount)
            for (const riskIndexes of riskIndexSets) {
              const selectedTerms = [
                ...anchorIndexes.map((index) => supportAnchorTerms[index]),
                ...breadthIndexes.map((index) => breadthTerms[index]),
                ...riskIndexes.map((index) => riskTerms[index]),
              ]
              const thresholdCandidates = buildThresholdCandidates(selectedTerms)
              for (const threshold of thresholdCandidates) {
                const artifact = {
                  familyId: cohort?.familyId,
                  gateTokens: cohort?.gateTokens ?? [],
                  threshold,
                  terms: selectedTerms.map((term) => ({
                    termId: term.termId,
                    role: term.role,
                    kind: term.kind,
                    token: term.token ?? null,
                    featureKey: term.featureKey ?? null,
                    operator: term.operator ?? null,
                    threshold: term.threshold ?? null,
                    weight: term.weight,
                  })),
                }
                const supportCaseEvaluations = applyPerfectPrototypeSupportScorecard({
                  artifact,
                  rows: cohort?.supportCaseViews ?? [],
                })
                const supportMatched = supportCaseEvaluations
                  .filter((entry) => entry.selected === true)
                  .map((entry) => entry.row.caseId)
                const trainSummary = summarizePerfectPrototypeSupportScorecardSelections({
                  evaluations: applyPerfectPrototypeSupportScorecard({
                    artifact,
                    rows: gatedTrainRows,
                  }),
                  supportCaseIds: supportMatched,
                })
                const candidate = {
                  termCount,
                  threshold,
                  selectedTerms,
                  supportMatched,
                  trainSummary,
                  failureReason: null,
                }
                triedCandidateCount += 1
                if (!supportMatched.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID)) {
                  candidate.failureReason = "unsat_historical_support"
                } else if (toNumber(trainSummary.precision, 0) < 1) {
                  candidate.failureReason = "unsat_train_precision"
                } else if (toNumber(trainSummary.trainMatchedDateCount, 0) < minTrainMatchedDates) {
                  candidate.failureReason = "unsat_train_breadth"
                } else if (toNumber(trainSummary.trainMatchedMonthCount, 0) < minTrainMatchedMonths) {
                  candidate.failureReason = "unsat_train_breadth"
                } else if (toNumber(trainSummary.trainMatchedFoldCount, 0) < minTrainMatchedFolds) {
                  candidate.failureReason = "unsat_train_breadth"
                } else if (
                  toNumber(trainSummary.crossfitNegativeWindowCount, 0) > maxCrossfitNegativeWindows
                ) {
                  candidate.failureReason = "unsat_crossfit_negatives"
                } else if (
                    toNumber(trainSummary.crossfitPositiveWindowCount, 0) < minCrossfitPositiveWindows
                ) {
                  candidate.failureReason = "unsat_crossfit_positive_windows"
                }
                if (candidatesEvaluated.length < 256) {
                  candidatesEvaluated.push(buildCandidatePreview(candidate))
                }
                if (candidate.failureReason) {
                  recordReason(reasonCounts, candidate.failureReason)
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
    }
  }

  if (!bestSolution) {
    return {
      ...buildUnsatSummary({
        reasonCounts,
        triedCandidateCount,
        termSummary: termBank?.summary,
        candidatesEvaluated,
      }),
    }
  }

  return {
    ok: true,
    scorecardSolvedCount: 1,
    scorecardHistoricalSupportMatchedCount: bestSolution.supportMatched.includes(
      PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
    )
      ? 1
      : 0,
    artifact: {
      familyId: cohort?.familyId,
      surfaceName: cohort?.surfaceName,
      gateTokens: cohort?.gateTokens ?? [],
      threshold: bestSolution.threshold,
      terms: bestSolution.selectedTerms.map((term) => ({
        termId: term.termId,
        role: term.role,
        kind: term.kind,
        token: term.token ?? null,
        featureKey: term.featureKey ?? null,
        operator: term.operator ?? null,
        threshold: term.threshold ?? null,
        weight: term.weight,
      })),
      supportCaseIds: bestSolution.supportMatched,
      supportSignatureConfig: cohort?.supportSignatureConfig ?? null,
      fitDiagnostics: {
        scorecardTermCandidateCount: Number(termBank?.summary?.scorecardTermCandidateCount ?? 0),
        scorecardTermQualifiedCount: Number(termBank?.summary?.scorecardTermQualifiedCount ?? 0),
        supportAnchorTermCount: Number(termBank?.summary?.supportAnchorTermCount ?? 0),
        breadthExtenderTermCount: Number(termBank?.summary?.breadthExtenderTermCount ?? 0),
        riskKillerTermCount: Number(termBank?.summary?.riskKillerTermCount ?? 0),
      },
    },
    trainSummary: bestSolution.trainSummary,
    triedCandidateCount,
    candidatesEvaluated,
  }
}
