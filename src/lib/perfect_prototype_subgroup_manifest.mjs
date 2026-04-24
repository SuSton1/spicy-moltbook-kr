import { buildPerfectPrototypeSubgroupTemporalStability } from "./perfect_prototype_subgroup_stability.mjs"

const uniqueSortedStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const safeRatio = (left, right) => {
  const l = Number(left)
  const r = Number(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r <= 0) return 0
  return l / r
}

const average = (values) => {
  const normalized = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
  if (normalized.length < 1) return 0
  return normalized.reduce((sum, value) => sum + value, 0) / normalized.length
}

const collectCoverKeys = (entries, field) =>
  uniqueSortedStrings(
    (Array.isArray(entries) ? entries : []).flatMap((entry) =>
      Array.isArray(entry?.[field]) ? entry[field].filter(Boolean) : [],
    ),
  )

const maxNumber = (values) => {
  const normalized = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
  if (normalized.length < 1) return 0
  return Math.max(...normalized)
}

export const buildPerfectPrototypeSubgroupManifestRecord = ({
  subgroupId,
  familyId,
  entries,
  minMatchedDates = 10,
  minMatchedMonths = 6,
  minMatchedFolds = 4,
  minSelectionFrequency = 0.5,
  minFoldPresenceCount = 3,
  minWindowPresenceCount = 2,
} = {}) => {
  const normalizedEntries = uniqueSortedStrings(
    (Array.isArray(entries) ? entries : []).map((entry) => entry?.token).filter(Boolean),
  ).map((token) =>
    (Array.isArray(entries) ? entries : []).find((entry) => entry?.token === token) ?? { token },
  )
  if (normalizedEntries.length < 1) return null
  const coverDateKeys = collectCoverKeys(normalizedEntries, "subgroupHitDates")
  const coverMonthKeys = collectCoverKeys(normalizedEntries, "subgroupHitMonths")
  const coverFoldKeys = collectCoverKeys(normalizedEntries, "subgroupHitFolds")
  const coverWindowKeys = collectCoverKeys(normalizedEntries, "subgroupHitWindows")
  const matchedDateCount = Math.max(
    coverDateKeys.length,
    maxNumber(normalizedEntries.map((entry) => entry?.subgroupDistinctDateCount)),
  )
  const matchedMonthCount = Math.max(
    coverMonthKeys.length,
    maxNumber(normalizedEntries.map((entry) => entry?.subgroupMatchedMonthCount)),
  )
  const matchedFoldCount = Math.max(
    coverFoldKeys.length,
    maxNumber(normalizedEntries.map((entry) => entry?.subgroupMatchedFoldCount)),
  )
  const top1DateHitShare = average(
    normalizedEntries.map((entry) => Math.max(0, Number(entry?.subgroupTop1DateHitShare ?? 0))),
  )
  const coverageShare = average(normalizedEntries.map((entry) => entry?.cohortCoverageShare))
  const precision = average(normalizedEntries.map((entry) => entry?.precision))
  const tpLift = average(normalizedEntries.map((entry) => entry?.subgroupTpLift))
  const wracc = average(normalizedEntries.map((entry) => entry?.subgroupWracc))
  const fpPenalty = average(normalizedEntries.map((entry) => entry?.subgroupFpPenalty))
  const subgroupScore = average(normalizedEntries.map((entry) => entry?.subgroupScore))
  const stability = buildPerfectPrototypeSubgroupTemporalStability({
    matchedDateCount,
    matchedMonthCount,
    matchedFoldCount,
    top1DateHitShare,
    windowPresenceCount: Math.max(
      coverWindowKeys.length,
      maxNumber(normalizedEntries.map((entry) => entry?.subgroupWindowPresenceCount)),
    ),
    minMatchedDates,
    minMatchedMonths,
    minMatchedFolds,
    minSelectionFrequency,
    minFoldPresenceCount,
    minWindowPresenceCount,
  })
  return {
    subgroupId,
    familyId: String(familyId ?? "").trim() || null,
    bundleTokens: normalizedEntries.map((entry) => entry.token).filter(Boolean),
    bundleAxes: uniqueSortedStrings(normalizedEntries.map((entry) => entry?.bundleAxis).filter(Boolean)),
    seedIndexes: normalizedEntries
      .map((entry) => Number(entry?.tokenIndex))
      .filter((value) => Number.isInteger(value) && value >= 0),
    coverDateKeys,
    coverMonthKeys,
    coverFoldKeys,
    coverWindowKeys,
    matchedDateCount,
    matchedMonthCount,
    matchedFoldCount,
    coverageShare,
    precision,
    tpLift,
    wracc,
    fpPenalty,
    top1DateHitShare,
    subgroupScore,
    selectionFrequency: stability.selectionFrequency,
    foldPresenceCount: stability.foldPresenceCount,
    windowPresenceCount: stability.windowPresenceCount,
    stabilityQualified: stability.stabilityQualified,
    exactRefinementQualified:
      matchedDateCount >= Math.max(1, Number(minMatchedDates) || 1) &&
      matchedMonthCount >= Math.max(1, Number(minMatchedMonths) || 1) &&
      matchedFoldCount >= Math.max(1, Number(minMatchedFolds) || 1),
    generalizedQualified:
      stability.stabilityQualified &&
      safeRatio(matchedDateCount, Math.max(1, Number(minMatchedDates) || 1)) >= 1,
  }
}
