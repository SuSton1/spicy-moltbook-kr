import {
  buildPerfectPrototypeDecisionSetUnsatSummary,
  recordPerfectPrototypeDecisionSetUnsatReason,
} from "./perfect_prototype_decision_set_unsat.mjs"
import {
  evaluatePerfectPrototypeDecisionSetClauseCrossfit,
  evaluatePerfectPrototypeDecisionSetUnion,
} from "./perfect_prototype_decision_set_constraints.mjs"

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const compareSolutions = (left, right) => {
  if (toNumber(left?.clauseCount, 0) !== toNumber(right?.clauseCount, 0)) {
    return toNumber(left?.clauseCount, 0) - toNumber(right?.clauseCount, 0)
  }
  if (toNumber(right?.oos?.precision, 0) !== toNumber(left?.oos?.precision, 0)) {
    return toNumber(right?.oos?.precision, 0) - toNumber(left?.oos?.precision, 0)
  }
  if (toNumber(right?.oos?.hitCount, 0) !== toNumber(left?.oos?.hitCount, 0)) {
    return toNumber(right?.oos?.hitCount, 0) - toNumber(left?.oos?.hitCount, 0)
  }
  if (toNumber(right?.oos?.uniqueDateCount, 0) !== toNumber(left?.oos?.uniqueDateCount, 0)) {
    return toNumber(right?.oos?.uniqueDateCount, 0) - toNumber(left?.oos?.uniqueDateCount, 0)
  }
  if (toNumber(right?.train?.uniqueDateCount, 0) !== toNumber(left?.train?.uniqueDateCount, 0)) {
    return toNumber(right?.train?.uniqueDateCount, 0) - toNumber(left?.train?.uniqueDateCount, 0)
  }
  return toNumber(left?.totalRuleSize, 0) - toNumber(right?.totalRuleSize, 0)
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

const evaluateDecisionSetConstraintFailure = ({
  selectedClauses,
  trainUnion,
  oosUnion,
  crossfit,
  bounds,
} = {}) => {
  if (!selectedClauses.some((clause) => clause?.haesungSupport === true)) {
    return "unsat_historical_support"
  }
  if (toNumber(trainUnion?.matchCount, 0) < 1 || toNumber(trainUnion?.precision, 0) < 1) {
    return "unsat_train_precision"
  }
  if (
    toNumber(trainUnion?.uniqueDateCount, 0) < toNumber(bounds?.minTrainMatchedDates, 10) ||
    toNumber(trainUnion?.uniqueMonthCount, 0) < toNumber(bounds?.minTrainMatchedMonths, 6) ||
    toNumber(trainUnion?.matchedFoldCount, 0) < toNumber(bounds?.minTrainMatchedFolds, 4)
  ) {
    return "unsat_train_breadth"
  }
  if (toNumber(crossfit?.maxNegativeWindowCount, 0) > toNumber(bounds?.maxCrossfitNegativeWindows, 0)) {
    return "unsat_crossfit_negatives"
  }
  if (
    toNumber(crossfit?.maxPositiveWindowCount, 0) <
    toNumber(bounds?.minCrossfitPositiveWindows, 2)
  ) {
    return "unsat_crossfit_positive_windows"
  }
  if (toNumber(oosUnion?.matchCount, 0) < toNumber(bounds?.minOpenOosMatchCount, 3)) {
    return "unsat_oos_match_count"
  }
  if (toNumber(oosUnion?.precision, 0) < toNumber(bounds?.minOpenOosPrecision, 1)) {
    return "unsat_oos_precision"
  }
  if (
    toNumber(oosUnion?.uniqueDateCount, 0) <
    toNumber(bounds?.minOpenOosUniqueMatchedDates, 3)
  ) {
    return "unsat_oos_unique_dates"
  }
  return null
}

export const solvePerfectPrototypeDecisionSet = ({
  candidateClauses = [],
  maxClauses = 3,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  maxCrossfitNegativeWindows = 0,
  minCrossfitPositiveWindows = 2,
  minOpenOosPrecision = 1,
  minOpenOosMatchCount = 3,
  minOpenOosUniqueMatchedDates = 3,
} = {}) => {
  const clauses = Array.isArray(candidateClauses) ? candidateClauses : []
  const bounds = {
    minTrainMatchedDates,
    minTrainMatchedMonths,
    minTrainMatchedFolds,
    maxCrossfitNegativeWindows,
    minCrossfitPositiveWindows,
    minOpenOosPrecision,
    minOpenOosMatchCount,
    minOpenOosUniqueMatchedDates,
  }
  const triedClauseBudgets = []
  const reasonCounts = {}
  const candidatesEvaluated = []
  let bestSolution = null
  for (let clauseBudget = 1; clauseBudget <= Math.max(1, Math.floor(Number(maxClauses) || 1)); clauseBudget += 1) {
    if (clauses.length < clauseBudget) break
    triedClauseBudgets.push(clauseBudget)
    for (const combination of buildCombinationIndexes(clauses.length, clauseBudget)) {
      const selectedClauses = combination.map((index) => clauses[index])
      const ruleIds = selectedClauses.map((clause) => clause.ruleId)
      const trainUnion = evaluatePerfectPrototypeDecisionSetUnion({
        selectedClauses,
        fieldName: "trainMatchedRows",
      })
      const oosUnion = evaluatePerfectPrototypeDecisionSetUnion({
        selectedClauses,
        fieldName: "oosMatchedRows",
      })
      const crossfit = evaluatePerfectPrototypeDecisionSetClauseCrossfit({
        selectedClauses,
        minPositiveWindowSupport: minCrossfitPositiveWindows,
      })
      const failureReason = evaluateDecisionSetConstraintFailure({
        selectedClauses,
        trainUnion,
        oosUnion,
        crossfit,
        bounds,
      })
      const candidateSummary = {
        ruleIds,
        clauseCount: clauseBudget,
        totalRuleSize: selectedClauses.reduce(
          (sum, clause) => sum + toNumber(clause?.ruleSize, 0),
          0,
        ),
        haesungSupport: selectedClauses.some((clause) => clause?.haesungSupport === true),
        train: trainUnion,
        oos: oosUnion,
        crossfit,
        failureReason,
      }
      candidatesEvaluated.push(candidateSummary)
      if (failureReason) {
        recordPerfectPrototypeDecisionSetUnsatReason(reasonCounts, failureReason)
        continue
      }
      if (!bestSolution || compareSolutions(candidateSummary, bestSolution) < 0) {
        bestSolution = candidateSummary
      }
    }
    if (bestSolution) break
  }
  if (!bestSolution) {
    return {
      ...buildPerfectPrototypeDecisionSetUnsatSummary({
        reasonCounts,
        triedClauseBudgets,
        candidateCount: clauses.length,
      }),
      candidatesEvaluated,
    }
  }
  return {
    ok: true,
    clauseCount: bestSolution.clauseCount,
    ruleIds: bestSolution.ruleIds,
    totalRuleSize: bestSolution.totalRuleSize,
    haesungSupport: bestSolution.haesungSupport,
    train: bestSolution.train,
    oos: bestSolution.oos,
    crossfit: bestSolution.crossfit,
    triedClauseBudgets,
    candidateCount: clauses.length,
    candidatesEvaluated,
  }
}
