import { comparePerfectPrototypeRules } from "./perfect_prototype_rule.mjs"
import { buildPerfectPrototypeRuleCoverageProfile } from "./perfect_prototype_catalog_diversify.mjs"

const safeRate = (numValue, denValue) => {
  const numerator = Number(numValue)
  const denominator = Number(denValue)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return numerator / denominator
}

const normalizeRuleCountLimit = (value, fallback = null) => {
  const numeric = Math.floor(Number(value))
  if (!Number.isInteger(numeric) || numeric < 1) return fallback
  return numeric
}

const toSortedIndexArray = (values) =>
  Array.from(Array.isArray(values) || ArrayBuffer.isView(values) ? values : [], (value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0)
    .sort((left, right) => left - right)

const countSortedIntersection = (left, right) => {
  const leftValues = toSortedIndexArray(left)
  const rightValues = toSortedIndexArray(right)
  let leftIndex = 0
  let rightIndex = 0
  let overlap = 0
  while (leftIndex < leftValues.length && rightIndex < rightValues.length) {
    if (leftValues[leftIndex] === rightValues[rightIndex]) {
      overlap += 1
      leftIndex += 1
      rightIndex += 1
      continue
    }
    if (leftValues[leftIndex] < rightValues[rightIndex]) {
      leftIndex += 1
    } else {
      rightIndex += 1
    }
  }
  return overlap
}

const buildCoverageState = () => ({
  positiveRows: new Set(),
  dates: new Set(),
  months: new Set(),
  quarters: new Set(),
})

const applyCoverageState = ({ coverageState, profile }) => {
  for (const value of profile.positiveRowIndexes) coverageState.positiveRows.add(value)
  for (const value of profile.dates) coverageState.dates.add(value)
  for (const value of profile.months) coverageState.months.add(value)
  for (const value of profile.quarters) coverageState.quarters.add(value)
}

const computeCoverageGain = ({ coverageState, profile }) => {
  const newPositiveRows = profile.positiveRowIndexes.filter((value) => !coverageState.positiveRows.has(value))
  const newDates = profile.dates.filter((value) => !coverageState.dates.has(value))
  const newMonths = profile.months.filter((value) => !coverageState.months.has(value))
  const newQuarters = profile.quarters.filter((value) => !coverageState.quarters.has(value))
  return {
    newPositiveRows,
    newDates,
    newMonths,
    newQuarters,
  }
}

const computeMdlOverlapPenalty = ({ selectedProfiles, candidateProfile }) => {
  if (!Array.isArray(selectedProfiles) || selectedProfiles.length < 1) return 0
  let maxOverlap = 0
  for (const selectedProfile of selectedProfiles) {
    const overlap = countSortedIntersection(
      selectedProfile.profile.positiveRowIndexes,
      candidateProfile.profile.positiveRowIndexes,
    )
    const denominator = Math.max(1, candidateProfile.profile.positiveRowIndexes.length)
    maxOverlap = Math.max(maxOverlap, safeRate(overlap, denominator))
  }
  return maxOverlap
}

export const selectPerfectPrototypeMdlRules = ({
  rules,
  rows = [],
  maxRules = Number.POSITIVE_INFINITY,
  descriptionLengthWeight = 1,
  overlapPenaltyWeight = 1,
}) => {
  const safeRules = Array.isArray(rules) ? rules : []
  const resolvedMaxRules = normalizeRuleCountLimit(maxRules, Number.POSITIVE_INFINITY)
  const remaining = safeRules.map((rule) => ({
    rule,
    profile: buildPerfectPrototypeRuleCoverageProfile({ rule, rows }),
  }))
  const selected = []
  const coverageState = buildCoverageState()
  const selectionRows = []
  let mdlDescriptionLength = 0
  let mdlCoverageGain = 0

  while (remaining.length > 0 && selected.length < resolvedMaxRules) {
    let bestIndex = -1
    let bestGain = Number.NEGATIVE_INFINITY
    let bestDiagnostics = null
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]
      const coverageGain = computeCoverageGain({
        coverageState,
        profile: candidate.profile,
      })
      const overlapPenalty = computeMdlOverlapPenalty({
        selectedProfiles: selected,
        candidateProfile: candidate,
      })
      const descriptionLength =
        Number(candidate.rule?.ruleSize ?? 0) +
        Number(candidate.profile.anchorFamilies?.length ?? 0) * 0.25 +
        Number(candidate.profile.marketRegimes?.length ?? 0) * 0.25
      const gain =
        coverageGain.newPositiveRows.length * 1 +
        coverageGain.newDates.length * 0.5 +
        coverageGain.newMonths.length * 2 +
        coverageGain.newQuarters.length * 3 -
        Number(descriptionLengthWeight) * descriptionLength -
        Number(overlapPenaltyWeight) * overlapPenalty * 5
      if (
        gain > bestGain ||
        (gain === bestGain &&
          comparePerfectPrototypeRules(candidate.rule, remaining[bestIndex]?.rule) < 0)
      ) {
        bestIndex = index
        bestGain = gain
        bestDiagnostics = {
          coverageGain,
          overlapPenalty,
          descriptionLength,
        }
      }
    }
    if (bestIndex < 0 || bestGain <= 0) break
    const winner = remaining.splice(bestIndex, 1)[0]
    selected.push(winner)
    applyCoverageState({
      coverageState,
      profile: winner.profile,
    })
    mdlDescriptionLength += Number(bestDiagnostics?.descriptionLength ?? 0)
    mdlCoverageGain +=
      Number(bestDiagnostics?.coverageGain?.newPositiveRows?.length ?? 0) +
      Number(bestDiagnostics?.coverageGain?.newDates?.length ?? 0) * 0.5 +
      Number(bestDiagnostics?.coverageGain?.newMonths?.length ?? 0) * 2 +
      Number(bestDiagnostics?.coverageGain?.newQuarters?.length ?? 0) * 3
    selectionRows.push({
      ruleId: winner.rule?.ruleId ?? null,
      gain: bestGain,
      descriptionLength: Number(bestDiagnostics?.descriptionLength ?? 0),
      overlapPenalty: Number(bestDiagnostics?.overlapPenalty ?? 0),
      addedPositiveRows: Number(bestDiagnostics?.coverageGain?.newPositiveRows?.length ?? 0),
      addedDates: Number(bestDiagnostics?.coverageGain?.newDates?.length ?? 0),
      addedMonths: Number(bestDiagnostics?.coverageGain?.newMonths?.length ?? 0),
      addedQuarters: Number(bestDiagnostics?.coverageGain?.newQuarters?.length ?? 0),
    })
  }

  return {
    selectedRules: selected.map(({ rule }) => rule),
    selectionReport: {
      selectionMode: "mdl_selector_v1",
      candidateRuleCount: safeRules.length,
      selectedRuleCount: selected.length,
      mdlDescriptionLength,
      mdlCoverageGain,
      coveredPositiveRows: coverageState.positiveRows.size,
      coveredDates: coverageState.dates.size,
      coveredMonths: coverageState.months.size,
      coveredQuarters: coverageState.quarters.size,
      selectionRows,
    },
  }
}
