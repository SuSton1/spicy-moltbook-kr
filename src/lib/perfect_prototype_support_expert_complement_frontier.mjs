import {
  buildPerfectPrototypeSupportExpertCoverageSignature,
  summarizePerfectPrototypeSupportExpertCoverageSignatures,
} from "./perfect_prototype_support_expert_coverage_signature.mjs"

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const compareExperts = (left, right) => {
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
    toNumber(right?.trainSummary?.trainMatchedFoldCount, 0) !==
    toNumber(left?.trainSummary?.trainMatchedFoldCount, 0)
  ) {
    return (
      toNumber(right?.trainSummary?.trainMatchedFoldCount, 0) -
      toNumber(left?.trainSummary?.trainMatchedFoldCount, 0)
    )
  }
  return String(left?.expertId ?? "").localeCompare(String(right?.expertId ?? ""))
}

const marginalGain = ({ selectedDates, selectedMonths, selectedFolds, expert }) => {
  const signature = buildPerfectPrototypeSupportExpertCoverageSignature({
    expertId: expert?.expertId,
    groupId: expert?.groupId,
    trainSummary: expert?.trainSummary,
  })
  const dateGain = signature.matchedDateKeys.filter((value) => !selectedDates.has(value)).length
  const monthGain = signature.matchedMonthKeys.filter((value) => !selectedMonths.has(value)).length
  const foldGain = signature.matchedFoldIds.filter((value) => !selectedFolds.has(value)).length
  return {
    signature,
    dateGain,
    monthGain,
    foldGain,
  }
}

export const buildPerfectPrototypeSupportExpertComplementFrontier = ({
  experts = [],
  maxExperts = 8,
} = {}) => {
  const orderedExperts = (Array.isArray(experts) ? experts : []).slice().sort(compareExperts)
  const signatureSummary = summarizePerfectPrototypeSupportExpertCoverageSignatures({
    experts: orderedExperts,
  })
  const selectedDates = new Set()
  const selectedMonths = new Set()
  const selectedFolds = new Set()
  const qualifiedExperts = []
  const candidatesEvaluated = []
  const rejectReasonCounts = {}

  for (const expert of orderedExperts) {
    const gain = marginalGain({
      selectedDates,
      selectedMonths,
      selectedFolds,
      expert,
    })
    const reason =
      qualifiedExperts.length < 1
        ? null
        : gain.dateGain < 1 && gain.monthGain < 1 && gain.foldGain < 1
          ? "unsat_expert_no_marginal_coverage_gain"
          : null
    if (candidatesEvaluated.length < 256) {
      candidatesEvaluated.push({
        expertId: expert?.expertId ?? null,
        groupId: expert?.groupId ?? null,
        matchedDateSignature: gain.signature.matchedDateSignature,
        matchedMonthSignature: gain.signature.matchedMonthSignature,
        matchedFoldSignature: gain.signature.matchedFoldSignature,
        dateGain: gain.dateGain,
        monthGain: gain.monthGain,
        foldGain: gain.foldGain,
        rejectReason: reason,
      })
    }
    if (reason) {
      rejectReasonCounts[reason] = Number(rejectReasonCounts[reason] ?? 0) + 1
      continue
    }
    qualifiedExperts.push({
      ...expert,
      coverageSignature: gain.signature,
    })
    for (const value of gain.signature.matchedDateKeys) selectedDates.add(value)
    for (const value of gain.signature.matchedMonthKeys) selectedMonths.add(value)
    for (const value of gain.signature.matchedFoldIds) selectedFolds.add(value)
    if (qualifiedExperts.length >= Math.max(1, Math.floor(Number(maxExperts) || 8))) break
  }

  return {
    expertCount: orderedExperts.length,
    distinctMatchedDateSignatureCount: signatureSummary.distinctMatchedDateSignatureCount,
    distinctMatchedMonthSignatureCount: signatureSummary.distinctMatchedMonthSignatureCount,
    distinctMatchedFoldSignatureCount: signatureSummary.distinctMatchedFoldSignatureCount,
    coverageFrontierCandidateCount: orderedExperts.length,
    coverageFrontierQualifiedCount: qualifiedExperts.length,
    coverageFrontierRejectReasonCounts: rejectReasonCounts,
    frontierExperts: qualifiedExperts,
    candidatesEvaluated,
  }
}
