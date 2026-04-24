export const recordPerfectPrototypeDecisionSetUnsatReason = (reasonCounts, reason) => {
  const normalizedReason = String(reason ?? "").trim() || "unsat_unknown"
  reasonCounts[normalizedReason] = Number(reasonCounts[normalizedReason] ?? 0) + 1
}

export const buildPerfectPrototypeDecisionSetUnsatSummary = ({
  reasonCounts = {},
  triedClauseBudgets = [],
  candidateCount = 0,
} = {}) => {
  const orderedReasons = Object.entries(reasonCounts)
    .sort((left, right) => {
      if (Number(right[1] ?? 0) !== Number(left[1] ?? 0)) {
        return Number(right[1] ?? 0) - Number(left[1] ?? 0)
      }
      return String(left[0]).localeCompare(String(right[0]))
    })
    .map(([reason]) => reason)
  return {
    ok: false,
    reason: orderedReasons[0] ?? "unsat_no_feasible_decision_set",
    reasonCounts: { ...reasonCounts },
    triedClauseBudgets: Array.from(new Set((Array.isArray(triedClauseBudgets) ? triedClauseBudgets : []).map((value) => Number(value)).filter(Number.isFinite))).sort((left, right) => left - right),
    candidateCount: Number(candidateCount ?? 0) || 0,
  }
}
