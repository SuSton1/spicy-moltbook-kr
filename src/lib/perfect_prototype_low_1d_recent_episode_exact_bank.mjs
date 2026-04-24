import { buildPerfectPrototypeRuleId } from "./perfect_prototype_rule.mjs"
import { buildPerfectPrototypeExactRuleStability } from "./perfect_prototype_exact_rule_stability.mjs"
import { buildPerfectPrototypeExactRuleSignificance } from "./perfect_prototype_exact_rule_significance.mjs"
import { buildPerfectPrototypeExactUnionSelector } from "./perfect_prototype_exact_union_selector.mjs"

const EPISODE_TOKEN_PREFIX = "sig:episode:"

const uniqueStrings = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const buildRowKey = (row) =>
  String(row?.rowKey ?? row?.sourceId ?? `${row?.symbol ?? "?"}:${row?.dateKey ?? "?"}`).trim()

const buildRuleSummary = (rows = []) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const positives = safeRows.filter((row) => row?.outcomeHitTarget === true)
  const negatives = safeRows.filter((row) => row?.outcomeHitTarget !== true)
  return {
    selectedRowCount: safeRows.length,
    positiveRowCount: positives.length,
    negativeRowCount: negatives.length,
    precision: safeRows.length > 0 ? positives.length / safeRows.length : 0,
    matchedDateCount: new Set(positives.map((row) => row?.dateKey).filter(Boolean)).size,
    matchedMonthCount: new Set(positives.map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean)).size,
    matchedFoldCount: new Set(positives.map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
  }
}

const rowMatchesTokens = (row, tokens = []) => {
  const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(uniqueStrings(row?.categoricalTokens ?? []))
  return uniqueStrings(tokens).every((token) => tokenSet.has(token))
}

const buildRuleCandidate = ({
  familyDataset,
  ruleTokens = [],
  minTrainDates = 4,
  minTrainMonths = 4,
  minTrainFolds = 3,
  minSelectionFrequency = 0.6,
  minFoldPresenceCount = 3,
  minWindowPresenceCount = 2,
} = {}) => {
  const normalizedRuleTokens = uniqueStrings(ruleTokens)
  const matchedTrainRows = (familyDataset?.trainRows ?? []).filter((row) => rowMatchesTokens(row, normalizedRuleTokens))
  const matchedOosRows = (familyDataset?.oosRows ?? []).filter((row) => rowMatchesTokens(row, normalizedRuleTokens))
  const matchedPositiveRows = matchedTrainRows.filter((row) => row?.outcomeHitTarget === true)
  const matchedNegativeRows = matchedTrainRows.filter((row) => row?.outcomeHitTarget !== true)
  const trainSummary = buildRuleSummary(matchedTrainRows)
  const oosSummary = buildRuleSummary(matchedOosRows)
  const stability = buildPerfectPrototypeExactRuleStability({
    matchedPositiveRows,
    matchedNegativeRows,
    minMatchedDates: minTrainDates,
    minMatchedMonths: minTrainMonths,
    minMatchedFolds: minTrainFolds,
    minSelectionFrequency,
    minFoldPresenceCount,
    minWindowPresenceCount,
  })
  return {
    familyId: familyDataset?.familyId ?? null,
    ruleId: buildPerfectPrototypeRuleId(normalizedRuleTokens),
    ruleTokens: normalizedRuleTokens,
    rootTokens: uniqueStrings(familyDataset?.rootTokens ?? []),
    episodeTokens: uniqueStrings(
      normalizedRuleTokens.filter((token) => String(token ?? "").startsWith(EPISODE_TOKEN_PREFIX)),
    ),
    trainSummary,
    oosSummary,
    selectionFrequency: Number(stability?.selectionFrequency ?? 0),
    foldPresenceCount: Number(stability?.foldPresenceCount ?? 0),
    windowPresenceCount: Number(stability?.windowPresenceCount ?? 0),
    crossfitNegativeWindowCount: Number(stability?.crossfitNegativeWindowCount ?? 0),
    stability,
  }
}

const compareTokenStats = (left, right) =>
  Number(right?.lift ?? 0) - Number(left?.lift ?? 0) ||
  Number(right?.positiveDateSupport ?? 0) - Number(left?.positiveDateSupport ?? 0) ||
  String(left?.token ?? "").localeCompare(String(right?.token ?? ""))

const buildCandidateTokenCombos = ({
  rootTokens = [],
  episodeTokenStats = [],
  maxEpisodeSeedTokens = 6,
  maxAdditionalEpisodeTokens = 2,
} = {}) => {
  const candidateEpisodeTokens = (Array.isArray(episodeTokenStats) ? episodeTokenStats : [])
    .filter((entry) => Number(entry?.positiveDateSupport ?? 0) >= 2)
    .sort(compareTokenStats)
    .slice(0, Math.max(1, Number(maxEpisodeSeedTokens) || 6))
    .map((entry) => entry.token)
  const combos = [uniqueStrings(rootTokens)]
  for (let index = 0; index < candidateEpisodeTokens.length; index += 1) {
    combos.push(uniqueStrings([...rootTokens, candidateEpisodeTokens[index]]))
    if (Number(maxAdditionalEpisodeTokens) < 2) continue
    for (let nextIndex = index + 1; nextIndex < candidateEpisodeTokens.length; nextIndex += 1) {
      combos.push(uniqueStrings([...rootTokens, candidateEpisodeTokens[index], candidateEpisodeTokens[nextIndex]]))
    }
  }
  return Array.from(new Set(combos.map((tokens) => tokens.join("||"))))
    .map((key) => key.split("||").filter(Boolean))
    .filter((tokens) => tokens.length > 0)
}

export const buildPerfectPrototypeLow1dRecentEpisodeExactBank = ({
  episodeDataset,
  minTrainDates = 4,
  minTrainMonths = 4,
  minTrainFolds = 3,
  minUnionDates = 10,
  minUnionMonths = 6,
  minUnionFolds = 4,
  minSelectionFrequency = 0.6,
  minFoldPresenceCount = 3,
  minWindowPresenceCount = 2,
  qValueThreshold = 0.05,
  maxEpisodeSeedTokens = 6,
  maxAdditionalEpisodeTokens = 2,
  maxUnionRules = 6,
  maxUnionRulesPerFamily = 2,
} = {}) => {
  const familyResults = []
  const allQualifiedRules = []

  for (const familyDataset of Array.isArray(episodeDataset?.familyDatasets) ? episodeDataset.familyDatasets : []) {
    const candidateTokenCombos = buildCandidateTokenCombos({
      rootTokens: familyDataset?.rootTokens ?? [],
      episodeTokenStats: familyDataset?.episodeTokenStats ?? [],
      maxEpisodeSeedTokens,
      maxAdditionalEpisodeTokens,
    })
    const ruleCandidates = candidateTokenCombos.map((ruleTokens) =>
      buildRuleCandidate({
        familyDataset,
        ruleTokens,
        minTrainDates,
        minTrainMonths,
        minTrainFolds,
        minSelectionFrequency,
        minFoldPresenceCount,
        minWindowPresenceCount,
      }),
    )
    const significance = buildPerfectPrototypeExactRuleSignificance({
      candidates: ruleCandidates,
      totalPositiveCount: Number(familyDataset?.trainPositiveRows?.length ?? 0),
      totalNegativeCount: Number(familyDataset?.trainNegativeRows?.length ?? 0),
      qValueThreshold,
    })
    const candidatesWithSignificance = significance.candidates.map((candidate) => {
      const trainSummary = candidate?.trainSummary ?? {}
      const individualQualified =
        Number(trainSummary.precision ?? 0) >= 1 &&
        Number(trainSummary.matchedDateCount ?? 0) >= Number(minTrainDates) &&
        Number(trainSummary.matchedMonthCount ?? 0) >= Number(minTrainMonths) &&
        Number(trainSummary.matchedFoldCount ?? 0) >= Number(minTrainFolds) &&
        Number(candidate?.crossfitNegativeWindowCount ?? 0) <= 0 &&
        Number(candidate?.selectionFrequency ?? 0) >= Number(minSelectionFrequency) &&
        Number(candidate?.qValue ?? 1) <= Number(qValueThreshold)
      return {
        ...candidate,
        individualQualified,
      }
    })
    const qualifiedRules = candidatesWithSignificance.filter((candidate) => candidate?.individualQualified === true)
    allQualifiedRules.push(...qualifiedRules)
    familyResults.push({
      familyId: familyDataset?.familyId ?? null,
      candidateRuleCount: candidatesWithSignificance.length,
      significantRuleCount: candidatesWithSignificance.filter((candidate) => candidate?.significanceQualified === true).length,
      stableRuleCount: candidatesWithSignificance.filter(
        (candidate) => Number(candidate?.selectionFrequency ?? 0) >= Number(minSelectionFrequency),
      ).length,
      qualifiedRuleCount: qualifiedRules.length,
      candidates: candidatesWithSignificance,
      qualifiedRules,
    })
  }

  const combinedTrainRows = (episodeDataset?.familyDatasets ?? []).flatMap((familyDataset) => familyDataset?.trainRows ?? [])
  const combinedOosRows = (episodeDataset?.familyDatasets ?? []).flatMap((familyDataset) => familyDataset?.oosRows ?? [])
  const unionSelection = buildPerfectPrototypeExactUnionSelector({
    qualifiedRules: allQualifiedRules,
    trainRows: combinedTrainRows,
    oosRows: combinedOosRows,
    minTrainDates: minUnionDates,
    minTrainMonths: minUnionMonths,
    minTrainFolds: minUnionFolds,
    maxRules: maxUnionRules,
    maxPerFamily: maxUnionRulesPerFamily,
  })

  let reason = null
  if (familyResults.flatMap((entry) => entry?.candidates ?? []).filter((candidate) => candidate?.significanceQualified === true).length < 1) {
    reason = "no_significant_episode_rules"
  } else if (allQualifiedRules.length < 1) {
    reason = "no_stable_episode_rules"
  } else if (unionSelection?.ok !== true) {
    reason = "no_valid_union_breadth"
  }

  return {
    ok: reason === null,
    reason,
    familyResults,
    qualifiedRules: allQualifiedRules,
    unionSelection,
    summary: {
      familyCount: familyResults.length,
      candidateRuleCount: familyResults.reduce((sum, entry) => sum + Number(entry?.candidateRuleCount ?? 0), 0),
      qualifiedRuleCount: allQualifiedRules.length,
      selectedUnionRuleCount: Number(unionSelection?.selectedRuleCount ?? 0),
      unionTrainSummary: unionSelection?.unionTrainSummary ?? null,
      unionOosSummary: unionSelection?.unionOosSummary ?? null,
    },
  }
}
