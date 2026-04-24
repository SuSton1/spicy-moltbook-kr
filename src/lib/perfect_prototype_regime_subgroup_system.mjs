import { buildPerfectPrototypeSubgroupManifestRecord } from "./perfect_prototype_subgroup_manifest.mjs"
import { selectDiversePerfectPrototypeSubgroupManifests } from "./perfect_prototype_subgroup_diversity.mjs"
import { buildPerfectPrototypeSubgroupTemporalStability } from "./perfect_prototype_subgroup_stability.mjs"

const normalizeText = (value) => String(value ?? "").trim()

const normalizeToken = (value) => normalizeText(value).toLowerCase()

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => normalizeText(value)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const safeRatio = (left, right) => {
  const l = Number(left)
  const r = Number(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r <= 0) return 0
  return l / r
}

const buildDateConcentration = (rows) => {
  const counts = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = normalizeText(row?.dateKey)
    if (!dateKey) continue
    counts.set(dateKey, Number(counts.get(dateKey) ?? 0) + 1)
  }
  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0)
  if (total <= 0) return 0
  return Math.max(...Array.from(counts.values())) / total
}

const buildTemporalSets = (rows) => ({
  dates: uniqueSorted((Array.isArray(rows) ? rows : []).map((row) => row?.dateKey)),
  months: uniqueSorted((Array.isArray(rows) ? rows : []).map((row) => row?.monthKey)),
  folds: uniqueSorted((Array.isArray(rows) ? rows : []).map((row) => row?.foldId)),
  windows: uniqueSorted((Array.isArray(rows) ? rows : []).map((row) => row?.windowId)),
})

const isCandidateToken = (token) => {
  const normalized = normalizeToken(token)
  if (!normalized.startsWith("tag:")) return false
  if (normalized.startsWith("tag:xsec.closerank:")) return false
  if (normalized.startsWith("tag:date:")) return false
  if (normalized.startsWith("tag:label:")) return false
  return true
}

const classifyBundleAxis = (token) => {
  const normalized = normalizeToken(token)
  if (!normalized.startsWith("tag:")) return "other"
  const body = normalized.slice(4)
  const axis = body.split(/[.:]/u)[0]
  return axis || "other"
}

const compareCandidateEntries = (left, right) => {
  if (Number(right?.subgroupDistinctDateCount ?? 0) !== Number(left?.subgroupDistinctDateCount ?? 0)) {
    return Number(right?.subgroupDistinctDateCount ?? 0) - Number(left?.subgroupDistinctDateCount ?? 0)
  }
  if (Number(right?.subgroupMatchedMonthCount ?? 0) !== Number(left?.subgroupMatchedMonthCount ?? 0)) {
    return Number(right?.subgroupMatchedMonthCount ?? 0) - Number(left?.subgroupMatchedMonthCount ?? 0)
  }
  if (Number(right?.subgroupMatchedFoldCount ?? 0) !== Number(left?.subgroupMatchedFoldCount ?? 0)) {
    return Number(right?.subgroupMatchedFoldCount ?? 0) - Number(left?.subgroupMatchedFoldCount ?? 0)
  }
  if (Number(right?.subgroupTpLift ?? 0) !== Number(left?.subgroupTpLift ?? 0)) {
    return Number(right?.subgroupTpLift ?? 0) - Number(left?.subgroupTpLift ?? 0)
  }
  if (Number(right?.subgroupWracc ?? 0) !== Number(left?.subgroupWracc ?? 0)) {
    return Number(right?.subgroupWracc ?? 0) - Number(left?.subgroupWracc ?? 0)
  }
  if (Number(left?.subgroupFpPenalty ?? 0) !== Number(right?.subgroupFpPenalty ?? 0)) {
    return Number(left?.subgroupFpPenalty ?? 0) - Number(right?.subgroupFpPenalty ?? 0)
  }
  return String(left?.token ?? "").localeCompare(String(right?.token ?? ""))
}

const buildScopeDefinitions = (rows) => {
  const scopes = [
    { scopeId: "TOP", regimeBucket: "TOP", lowSubtypeFamilyId: null },
    { scopeId: "MID", regimeBucket: "MID", lowSubtypeFamilyId: null },
    { scopeId: "LOW", regimeBucket: "LOW", lowSubtypeFamilyId: null },
  ]
  for (const familyId of ["low_gap_top_continuation", "low_gap_high_continuation", "low_jump_below_continuation"]) {
    if ((Array.isArray(rows) ? rows : []).some((row) => row?.lowSubtypeFamilyIds?.includes(familyId))) {
      scopes.push({
        scopeId: `LOW__${familyId}`,
        regimeBucket: "LOW",
        lowSubtypeFamilyId: familyId,
      })
    }
  }
  return scopes
}

const buildCandidateEntry = ({
  token,
  tokenRows,
  positiveRows,
  scopeRows,
  thresholds,
}) => {
  const positiveTokenRows = tokenRows.filter((row) => row?.donorSelected === true)
  const negativeTokenRows = tokenRows.filter((row) => row?.donorSelected !== true)
  const temporal = buildTemporalSets(positiveTokenRows)
  const top1DateHitShare = buildDateConcentration(positiveTokenRows)
  const stability = buildPerfectPrototypeSubgroupTemporalStability({
    matchedDateCount: temporal.dates.length,
    matchedMonthCount: temporal.months.length,
    matchedFoldCount: temporal.folds.length,
    top1DateHitShare,
    windowPresenceCount: temporal.windows.length,
    minMatchedDates: thresholds.minMatchedDates,
    minMatchedMonths: thresholds.minMatchedMonths,
    minMatchedFolds: thresholds.minMatchedFolds,
    minSelectionFrequency: thresholds.minSelectionFrequency,
    minFoldPresenceCount: thresholds.minFoldPresenceCount,
    minWindowPresenceCount: thresholds.minWindowPresenceCount,
  })
  const positiveCount = positiveTokenRows.length
  const negativeCount = negativeTokenRows.length
  const tokenCoverageCount = tokenRows.length
  const scopePositiveCount = positiveRows.length
  const scopeUniverseCount = scopeRows.length
  const precision = safeRatio(positiveCount, tokenCoverageCount)
  const baseRate = safeRatio(scopePositiveCount, scopeUniverseCount)
  const coverageShare = safeRatio(positiveCount, scopePositiveCount)
  const tpLift = precision - baseRate
  const wracc = safeRatio(tokenCoverageCount, Math.max(1, scopeUniverseCount)) * (precision - baseRate)
  const fpPenalty = safeRatio(negativeCount, Math.max(1, tokenCoverageCount))
  const subgroupScore =
    wracc * 1000 +
    temporal.dates.length * 2 +
    temporal.months.length * 1.5 +
    temporal.folds.length * 4 -
    top1DateHitShare * 12 -
    negativeCount
  const subgroupManifestEligible =
    tpLift > 0 &&
    stability.stabilityQualified === true &&
    top1DateHitShare <= Number(thresholds.maxTop1DateHitShare ?? 0.3)
  return {
    token,
    bundleAxis: classifyBundleAxis(token),
    positiveCount,
    negativeCount,
    precision,
    cohortCoverageShare: coverageShare,
    subgroupDistinctDateCount: temporal.dates.length,
    subgroupMatchedMonthCount: temporal.months.length,
    subgroupMatchedFoldCount: temporal.folds.length,
    subgroupTop1DateHitShare: top1DateHitShare,
    subgroupTpLift: tpLift,
    subgroupWracc: wracc,
    subgroupFpPenalty: fpPenalty,
    subgroupScore,
    subgroupSelectionFrequency: stability.selectionFrequency,
    subgroupFoldPresenceCount: stability.foldPresenceCount,
    subgroupWindowPresenceCount: stability.windowPresenceCount,
    subgroupHitDates: temporal.dates,
    subgroupHitMonths: temporal.months,
    subgroupHitFolds: temporal.folds,
    subgroupHitWindows: temporal.windows,
    subgroupManifestEligible,
  }
}

const buildManifestCandidates = ({
  scopeId,
  familyId,
  candidatePool,
  thresholds,
}) => {
  const groupedByAxis = new Map()
  for (const entry of candidatePool) {
    const axis = normalizeText(entry?.bundleAxis)
    if (!axis) continue
    const bucket = groupedByAxis.get(axis) ?? []
    bucket.push(entry)
    groupedByAxis.set(axis, bucket)
  }
  const anchors = Array.from(groupedByAxis.values())
    .flatMap((bucket) => bucket.slice(0, 2))
    .sort(compareCandidateEntries)
  const manifestCandidates = []
  const seen = new Set()
  const pushManifest = (entries) => {
    const normalizedEntries = uniqueSorted((Array.isArray(entries) ? entries : []).map((entry) => entry?.token))
      .map((token) => candidatePool.find((entry) => entry.token === token))
      .filter(Boolean)
    if (normalizedEntries.length < 1) return
    const key = normalizedEntries.map((entry) => entry.token).join("|")
    if (seen.has(key)) return
    seen.add(key)
    const manifest = buildPerfectPrototypeSubgroupManifestRecord({
      subgroupId: `${scopeId.toLowerCase()}_${String(manifestCandidates.length + 1).padStart(3, "0")}`,
      familyId,
      entries: normalizedEntries,
      minMatchedDates: thresholds.minMatchedDates,
      minMatchedMonths: thresholds.minMatchedMonths,
      minMatchedFolds: thresholds.minMatchedFolds,
      minSelectionFrequency: thresholds.minSelectionFrequency,
      minFoldPresenceCount: thresholds.minFoldPresenceCount,
      minWindowPresenceCount: thresholds.minWindowPresenceCount,
    })
    if (manifest && Number(manifest.top1DateHitShare ?? 1) <= Number(thresholds.maxTop1DateHitShare ?? 0.3)) {
      manifestCandidates.push(manifest)
    }
  }
  for (const anchor of anchors) pushManifest([anchor])
  for (let leftIndex = 0; leftIndex < anchors.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < anchors.length; rightIndex += 1) {
      pushManifest([anchors[leftIndex], anchors[rightIndex]])
    }
  }
  const stableManifests = manifestCandidates.filter((entry) => entry?.stabilityQualified === true)
  const diverseManifests = selectDiversePerfectPrototypeSubgroupManifests({
    manifests: stableManifests,
    maxManifests: thresholds.maxManifests,
    maxTokenJaccard: 0.8,
    maxAxisOverlap: 1,
    maxDateCoverJaccard: 0.9,
  })
  return {
    manifestCandidateCount: manifestCandidates.length,
    stableManifestCount: stableManifests.length,
    selectedManifestCount: diverseManifests.length,
    manifests: diverseManifests,
  }
}

export const buildPerfectPrototypeRegimeSubgroupSystem = ({
  datasetRows = [],
  lineId = null,
  minMatchedDates = 10,
  minMatchedMonths = 6,
  minMatchedFolds = 4,
  minSelectionFrequency = 0.6,
  minFoldPresenceCount = 3,
  minWindowPresenceCount = 3,
  maxTop1DateHitShare = 0.3,
  maxManifests = 6,
} = {}) => {
  const thresholds = {
    minMatchedDates,
    minMatchedMonths,
    minMatchedFolds,
    minSelectionFrequency,
    minFoldPresenceCount,
    minWindowPresenceCount,
    maxTop1DateHitShare,
    maxManifests,
  }
  const safeRows = Array.isArray(datasetRows) ? datasetRows : []
  const scopes = buildScopeDefinitions(safeRows)
  const scopeSummaries = []
  const subgroupRejectedCounts = {}
  for (const scope of scopes) {
    const scopeRows = safeRows.filter((row) => row?.regimeBucket === scope.regimeBucket)
    const positiveRows = scopeRows.filter((row) => {
      if (row?.donorSelected !== true) return false
      if (!scope.lowSubtypeFamilyId) return true
      return Array.isArray(row?.lowSubtypeFamilyIds) && row.lowSubtypeFamilyIds.includes(scope.lowSubtypeFamilyId)
    })
    if (positiveRows.length < 1) {
      subgroupRejectedCounts[scope.scopeId] = {
        noPositiveRows: 1,
      }
      scopeSummaries.push({
        lineId: normalizeText(lineId),
        scopeId: scope.scopeId,
        regimeBucket: scope.regimeBucket,
        lowSubtypeFamilyId: scope.lowSubtypeFamilyId,
        donorSelectedRows: 0,
        universeRows: scopeRows.length,
        candidateCount: 0,
        manifestCandidateCount: 0,
        stableManifestCount: 0,
        selectedManifestCount: 0,
        manifests: [],
      })
      continue
    }
    const tokenRows = new Map()
    for (const row of positiveRows) {
      for (const token of Array.isArray(row?.categoricalTokens) ? row.categoricalTokens : []) {
        if (!isCandidateToken(token)) continue
        const key = normalizeToken(token)
        const bucket = tokenRows.get(key) ?? []
        bucket.push(...scopeRows.filter((scopeRow) => scopeRow?.tokenSet?.has(key)))
        tokenRows.set(key, bucket)
      }
    }
    const candidatePool = Array.from(tokenRows.entries())
      .map(([token, rows]) =>
        buildCandidateEntry({
          token,
          tokenRows: uniqueSorted((Array.isArray(rows) ? rows : []).map((row) => row.rowKey)).map((rowKey) =>
            scopeRows.find((row) => row.rowKey === rowKey),
          ),
          positiveRows,
          scopeRows,
          thresholds,
        }),
      )
      .filter((entry) => Number(entry?.positiveCount ?? 0) >= 2)
      .sort(compareCandidateEntries)
      .slice(0, 80)

    const rejectedCounts = {
      top1DateShareExceeded: candidatePool.filter(
        (entry) => Number(entry?.subgroupTop1DateHitShare ?? 0) > Number(maxTop1DateHitShare),
      ).length,
      noLift: candidatePool.filter((entry) => Number(entry?.subgroupTpLift ?? 0) <= 0).length,
      unstable: candidatePool.filter((entry) => entry?.subgroupManifestEligible !== true).length,
    }
    subgroupRejectedCounts[scope.scopeId] = rejectedCounts
    const manifestBundle = buildManifestCandidates({
      scopeId: scope.scopeId,
      familyId: scope.lowSubtypeFamilyId ?? scope.regimeBucket.toLowerCase(),
      candidatePool: candidatePool.filter((entry) => entry?.subgroupManifestEligible === true),
      thresholds,
    })
    scopeSummaries.push({
      lineId: normalizeText(lineId),
      scopeId: scope.scopeId,
      regimeBucket: scope.regimeBucket,
      lowSubtypeFamilyId: scope.lowSubtypeFamilyId,
      donorSelectedRows: positiveRows.length,
      universeRows: scopeRows.length,
      candidateCount: candidatePool.length,
      manifestCandidateCount: manifestBundle.manifestCandidateCount,
      stableManifestCount: manifestBundle.stableManifestCount,
      selectedManifestCount: manifestBundle.selectedManifestCount,
      topCandidates: candidatePool.slice(0, 10),
      manifests: manifestBundle.manifests,
    })
  }
  return {
    lineId: normalizeText(lineId),
    thresholds,
    scopes: scopeSummaries,
    subgroupRejectedCounts,
  }
}
