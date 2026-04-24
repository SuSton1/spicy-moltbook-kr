import { auditPerfectPrototypePrejumpHypothesisPortfolio } from "./perfect_prototype_prejump_hypothesis_portfolio_audit.mjs"

const filterHypotheses = (family, hypothesisIds = []) => {
  const allowedIds = new Set((Array.isArray(hypothesisIds) ? hypothesisIds : []).map((value) => String(value ?? "").trim()).filter(Boolean))
  return {
    ...family,
    portfolioHypotheses: (Array.isArray(family?.portfolioHypotheses) ? family.portfolioHypotheses : []).filter((hypothesis) =>
      allowedIds.has(String(hypothesis?.id ?? "").trim()),
    ),
  }
}

const findReport = (audit, hypothesisId) =>
  (Array.isArray(audit?.hypothesisReports) ? audit.hypothesisReports : []).find(
    (report) => String(report?.hypothesisId ?? "").trim() === String(hypothesisId ?? "").trim(),
  ) ?? null

export const auditPerfectPrototypePrejumpEpisodeTransition = ({
  family,
  minPairwiseWinRate = 0.95,
  minSameDateBeatRate = 0.95,
  minMatchedControlBeatRate = 0.9,
  minFailureBeatRate = 0.9,
  minFoldPairwiseWinRate = 0.9,
  maxHardNegativeLeakCount = 0,
  maxFeatures = 8,
} = {}) => {
  const canonicalAudit = auditPerfectPrototypePrejumpHypothesisPortfolio({
    family: filterHypotheses(family, ["H2"]),
    minPairwiseWinRate,
    minSameDateBeatRate,
    minMatchedControlBeatRate,
    minFailureBeatRate,
    minFoldPairwiseWinRate,
    maxHardNegativeLeakCount,
    maxFeatures,
  })
  const diagnosticAudit = auditPerfectPrototypePrejumpHypothesisPortfolio({
    family: filterHypotheses(family, ["H3"]),
    minPairwiseWinRate,
    minSameDateBeatRate,
    minMatchedControlBeatRate,
    minFailureBeatRate,
    minFoldPairwiseWinRate,
    maxHardNegativeLeakCount,
    maxFeatures,
  })
  const canonicalReport = findReport(canonicalAudit, "H2")
  const diagnosticReport = findReport(diagnosticAudit, "H3")
  return {
    ...canonicalAudit,
    canonicalHypothesisId: "H2",
    canonicalReport,
    diagnosticComparatorHypothesisId: "H3",
    diagnosticComparator: {
      ok: diagnosticAudit.ok === true,
      reason: diagnosticAudit.reason ?? null,
      bestHypothesis: diagnosticAudit.bestHypothesis ?? null,
      report: diagnosticReport,
    },
    hypothesisReports: [
      ...(canonicalReport ? [canonicalReport] : []),
      ...(diagnosticReport ? [diagnosticReport] : []),
    ],
  }
}
