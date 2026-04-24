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
  const leftOos = Number(left?.bestOosMatchCount ?? 0)
  const rightOos = Number(right?.bestOosMatchCount ?? 0)
  if (rightOos !== leftOos) return rightOos - leftOos
  const leftDates = Number(left?.bestTrainMatchedDateCount ?? 0)
  const rightDates = Number(right?.bestTrainMatchedDateCount ?? 0)
  if (rightDates !== leftDates) return rightDates - leftDates
  return String(left?.archetypeId ?? "").localeCompare(String(right?.archetypeId ?? ""))
}

export const buildPerfectPrototypeDailyArchetypeRuleBank = ({
  family,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  minCrossfitPositiveWindows = 2,
  maxCrossfitNegativeWindows = 0,
  minOosMatchCount = 3,
} = {}) => {
  const controlOnlyDateSet = new Set((family?.controlOnlyDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const candidates = []
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
    const supportNearHardNegativeRows = uniqueRowsByKey([...sameDateNegativeRows, ...controlNegativeRows])
    const candidateFamily = {
      ...family,
      familyId: `${family?.familyId ?? "daily_archetype_bank"}::${archetype.archetypeId}`,
      trainRows: gatedTrainRows,
      gatedTrainRows,
      bridgePositiveRows,
      calibrationPositiveRows: bridgePositiveRows,
      supportNearHardNegativeRows,
      calibrationNegativeRows: supportNearHardNegativeRows,
      oosRows: family?.oosRows ?? [],
      portfolioSelectedFeatureKeys: family?.supplierFeatureKeys ?? [],
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
    candidates.push({
      archetypeId: archetype.archetypeId,
      signature: archetype.signature,
      dateKeys: archetype.dateKeys,
      ok: ranker.ok === true,
      reason: ranker.reason ?? null,
      artifact: ranker.artifact ?? null,
      bestTrainSummary: ranker.bestTrainSummary ?? null,
      bestOosSummary: ranker.bestOosSummary ?? null,
      bestOosMatchCount: Number(ranker?.bestOosSummary?.openOosMatchCount ?? 0),
      bestTrainMatchedDateCount: Number(ranker?.bestTrainSummary?.trainMatchedDateCount ?? 0),
      ranker,
    })
  }
  const qualified = candidates.filter((entry) => entry.ok === true).sort(compareSolutions)
  const bestCandidate = candidates.slice().sort(compareSolutions)[0] ?? null
  const ok = qualified.length > 0
  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_archetype_rule_bank",
    archetypeRuleBank: qualified,
    summary: {
      ...(family?.summary ?? {}),
      archetypeRuleBankCandidateCount: candidates.length,
      archetypeRuleBankQualifiedCount: qualified.length,
      archetypeRuleBankBestCandidate: bestCandidate
        ? {
            archetypeId: bestCandidate.archetypeId,
            reason: bestCandidate.reason,
            bestTrainSummary: bestCandidate.bestTrainSummary,
            bestOosSummary: bestCandidate.bestOosSummary,
          }
        : null,
    },
  }
}
