import { calibratePerfectPrototypeSupportTop1QueryRanker } from "./perfect_prototype_support_top1_query_calibrate.mjs"

const uniqueRowsByKey = (rows = []) => {
  const seen = new Set()
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowKey = String(row?.rowKey ?? row?.sourceId ?? "").trim()
    if (!rowKey || seen.has(rowKey)) continue
    seen.add(rowKey)
    out.push(row)
  }
  return out
}

const compareSolutions = (left, right) => {
  const leftQualified = left?.ok === true ? 1 : 0
  const rightQualified = right?.ok === true ? 1 : 0
  if (rightQualified !== leftQualified) return rightQualified - leftQualified
  const leftOos = Number(left?.bestOosMatchCount ?? 0)
  const rightOos = Number(right?.bestOosMatchCount ?? 0)
  if (rightOos !== leftOos) return rightOos - leftOos
  const leftDates = Number(left?.bestTrainMatchedDateCount ?? 0)
  const rightDates = Number(right?.bestTrainMatchedDateCount ?? 0)
  if (rightDates !== leftDates) return rightDates - leftDates
  return String(left?.hypothesisId ?? left?.archetypeId ?? "").localeCompare(String(right?.hypothesisId ?? right?.archetypeId ?? ""))
}

export const buildPerfectPrototypeDailyMechanismExactRuleBank = ({
  family,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  minCrossfitPositiveWindows = 2,
  maxCrossfitNegativeWindows = 0,
  minOosMatchCount = 3,
} = {}) => {
  const controlOnlyDateSet = new Set((family?.controlOnlyDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const hypothesisResults = []

  for (const hypothesis of Array.isArray(family?.mechanismHypothesisCatalog) ? family.mechanismHypothesisCatalog : []) {
    const candidateResults = []
    for (const archetype of Array.isArray(family?.archetypes) ? family.archetypes : []) {
      const positiveDateSet = new Set((archetype?.dateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
      const gatedTrainRows = uniqueRowsByKey(
        (family?.gatedTrainRows ?? []).filter((row) => {
          const dateKey = String(row?.dateKey ?? "").trim()
          return positiveDateSet.has(dateKey) || controlOnlyDateSet.has(dateKey)
        }),
      )
      const bridgePositiveRows = uniqueRowsByKey(
        (family?.winnerPositiveRows ?? []).filter((row) => positiveDateSet.has(String(row?.dateKey ?? "").trim())),
      )
      const sameDateNegativeRows = uniqueRowsByKey(
        (family?.winnerNegativeRows ?? []).filter((row) => positiveDateSet.has(String(row?.dateKey ?? "").trim())),
      )
      const controlNegativeRows = uniqueRowsByKey(
        (family?.supportNearHardNegativeRows ?? []).filter((row) =>
          controlOnlyDateSet.has(String(row?.dateKey ?? "").trim()),
        ),
      )
      const candidateFamily = {
        ...family,
        familyId: `${family?.familyId ?? "daily_trade_slate_mechanism_bank"}::${hypothesis?.hypothesisId ?? "H"}::${archetype?.archetypeId ?? "A"}`,
        trainRows: gatedTrainRows,
        gatedTrainRows,
        bridgePositiveRows,
        calibrationPositiveRows: bridgePositiveRows,
        supportNearHardNegativeRows: uniqueRowsByKey([...sameDateNegativeRows, ...controlNegativeRows]),
        calibrationNegativeRows: uniqueRowsByKey([...sameDateNegativeRows, ...controlNegativeRows]),
        oosRows: family?.oosRows ?? [],
        portfolioSelectedFeatureKeys: hypothesis?.featureKeys ?? [],
        gateTokens: [],
        supportFitExcluded: family?.supportFitExcluded === true,
      }
      const ranker = calibratePerfectPrototypeSupportTop1QueryRanker({
        family: candidateFamily,
        minTrainMatchedDates,
        minTrainMatchedMonths,
        minTrainMatchedFolds,
        minCrossfitPositiveWindows,
        maxCrossfitNegativeWindows,
        minOosMatchCount,
      })
      candidateResults.push({
        hypothesisId: hypothesis?.hypothesisId ?? null,
        hypothesisName: hypothesis?.name ?? null,
        archetypeId: archetype?.archetypeId ?? null,
        archetypeSignature: archetype?.signature ?? null,
        ok: ranker.ok === true,
        reason: ranker.reason ?? null,
        bestTrainSummary: ranker.bestTrainSummary ?? null,
        bestOosSummary: ranker.bestOosSummary ?? null,
        bestTrainMatchedDateCount: Number(ranker?.bestTrainSummary?.trainMatchedDateCount ?? 0),
        bestOosMatchCount: Number(ranker?.bestOosSummary?.openOosMatchCount ?? 0),
        candidateCount: Number(ranker?.candidateCount ?? 0),
        qualifiedCandidateCount: Number(ranker?.qualifiedCandidateCount ?? 0),
        ranker,
      })
    }
    candidateResults.sort(compareSolutions)
    hypothesisResults.push({
      hypothesisId: hypothesis?.hypothesisId ?? null,
      hypothesisName: hypothesis?.name ?? null,
      featureKeys: hypothesis?.featureKeys ?? [],
      candidates: candidateResults,
      bestCandidate: candidateResults[0] ?? null,
      ok: candidateResults.some((entry) => entry.ok === true),
    })
  }

  hypothesisResults.sort((left, right) => compareSolutions(left?.bestCandidate ?? {}, right?.bestCandidate ?? {}))
  const bestHypothesis = hypothesisResults[0] ?? null
  const bestCandidate = bestHypothesis?.bestCandidate ?? null
  const ok = bestCandidate?.ok === true
  const qualified = hypothesisResults
    .flatMap((entry) => entry.candidates.filter((candidate) => candidate.ok === true))
    .sort(compareSolutions)

  return {
    ...family,
    ok,
    reason: ok ? null : bestCandidate?.reason ?? "unsat_no_mechanism_rule_bank",
    mechanismRuleBank: qualified,
    mechanismHypothesisResults: hypothesisResults,
    summary: {
      ...(family?.summary ?? {}),
      mechanismHypothesisCount: hypothesisResults.length,
      mechanismHypothesisQualifiedCount: hypothesisResults.filter((entry) => entry.ok === true).length,
      archetypeRuleBankCandidateCount: hypothesisResults.reduce(
        (sum, entry) => sum + Number(entry?.candidates?.length ?? 0),
        0,
      ),
      archetypeRuleBankQualifiedCount: qualified.length,
      archetypeRuleBankBestCandidate: bestCandidate
        ? {
            hypothesisId: bestCandidate.hypothesisId,
            hypothesisName: bestCandidate.hypothesisName,
            archetypeId: bestCandidate.archetypeId,
            reason: bestCandidate.reason,
            bestTrainSummary: bestCandidate.bestTrainSummary,
            bestOosSummary: bestCandidate.bestOosSummary,
            candidateCount: bestCandidate.candidateCount,
            qualifiedCandidateCount: bestCandidate.qualifiedCandidateCount,
          }
        : null,
      mechanismHypothesisPreview: hypothesisResults.map((entry) => ({
        hypothesisId: entry.hypothesisId,
        hypothesisName: entry.hypothesisName,
        featureCount: Number(entry?.featureKeys?.length ?? 0),
        bestCandidate: entry.bestCandidate
          ? {
              archetypeId: entry.bestCandidate.archetypeId,
              reason: entry.bestCandidate.reason,
              bestTrainMatchedDateCount: entry.bestCandidate.bestTrainMatchedDateCount,
              bestOosMatchCount: entry.bestCandidate.bestOosMatchCount,
              candidateCount: entry.bestCandidate.candidateCount,
              qualifiedCandidateCount: entry.bestCandidate.qualifiedCandidateCount,
            }
          : null,
      })),
    },
  }
}
