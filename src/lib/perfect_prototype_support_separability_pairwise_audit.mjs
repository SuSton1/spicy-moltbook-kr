import crypto from "node:crypto"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const quantile = (values = [], q = 0.5) => {
  const filtered = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (filtered.length < 1) return null
  if (filtered.length === 1) return filtered[0]
  const clamped = Math.max(0, Math.min(1, Number(q) || 0))
  const position = (filtered.length - 1) * clamped
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return filtered[lower]
  const fraction = position - lower
  return filtered[lower] + (filtered[upper] - filtered[lower]) * fraction
}

const minValue = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return Math.min(...filtered)
}

const namespaceOf = (featureKey) => String(featureKey ?? "").trim().split(".").slice(0, 3).join(".")

const uniqueNumbers = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter(Number.isFinite)
        .map((value) => Math.round(value * 1000) / 1000),
    ),
  ).sort((left, right) => left - right)

const signatureOf = (row) =>
  [
    String(row?.recurBoundaryDominantGroup ?? "").trim() || "NONE",
    String(row?.roleTopologySignature ?? "").trim() || "NONE",
    String(row?.clusterCell ?? "").trim() || "NONE",
  ].join("::")

const collectFeatureCandidates = ({ positiveRows = [], negativeRows = [], featureKeys = [], maxFeatures = 12 } = {}) => {
  const scored = []
  for (const featureKey of uniqueStrings(featureKeys)) {
    const positiveValues = positiveRows.map((row) => num(row?.numericFeatureMap?.[featureKey])).filter(Number.isFinite)
    const negativeValues = negativeRows.map((row) => num(row?.numericFeatureMap?.[featureKey])).filter(Number.isFinite)
    if (positiveValues.length < 3 || negativeValues.length < 3) continue
    const positiveMean = average(positiveValues)
    const negativeMean = average(negativeValues)
    if (!Number.isFinite(positiveMean) || !Number.isFinite(negativeMean)) continue
    const spread = Math.max(
      0.05,
      Number(quantile([...positiveValues, ...negativeValues], 0.9) ?? 0) -
        Number(quantile([...positiveValues, ...negativeValues], 0.1) ?? 0),
    )
    const separation = Math.abs(positiveMean - negativeMean) / spread
    if (separation < 0.05) continue
    scored.push({
      featureKey,
      direction: positiveMean >= negativeMean ? 1 : -1,
      center: (positiveMean + negativeMean) / 2,
      scale: spread,
      weight: Math.max(0.1, Math.min(3, separation)),
      separation,
      namespace: namespaceOf(featureKey),
    })
  }
  scored.sort((left, right) => right.separation - left.separation || left.featureKey.localeCompare(right.featureKey))
  const bucketCounts = new Map()
  const selected = []
  for (const entry of scored) {
    const count = Number(bucketCounts.get(entry.namespace) ?? 0)
    if (count >= 2) continue
    selected.push(entry)
    bucketCounts.set(entry.namespace, count + 1)
    if (selected.length >= Math.max(2, Math.floor(Number(maxFeatures) || 12))) break
  }
  return selected
}

const scoreRow = ({ row, featureSpecs = [] } = {}) => {
  const contributions = (Array.isArray(featureSpecs) ? featureSpecs : [])
    .map((feature) => {
      const rawValue = num(row?.numericFeatureMap?.[feature?.featureKey])
      if (!Number.isFinite(rawValue)) return null
      return Number(feature?.weight ?? 1) * Number(feature?.direction ?? 1) * ((rawValue - Number(feature?.center ?? 0)) / Math.max(0.05, Number(feature?.scale ?? 1)))
    })
    .filter(Number.isFinite)
  return average(contributions) ?? Number.NEGATIVE_INFINITY
}

const buildFeatureSpecs = ({ featureKeys = [], positiveRows = [], negativeRows = [] } = {}) => {
  const lookup = new Map(
    collectFeatureCandidates({
      positiveRows,
      negativeRows,
      featureKeys,
      maxFeatures: Math.max(2, featureKeys.length),
    }).map((entry) => [entry.featureKey, entry]),
  )
  return uniqueStrings(featureKeys).map((featureKey) => lookup.get(featureKey)).filter(Boolean)
}

const buildCombinations = (values = [], minSize = 2, maxSize = 4) => {
  const out = []
  const safe = Array.isArray(values) ? values : []
  const visit = (start, bucket, targetSize) => {
    if (bucket.length >= targetSize) {
      out.push([...bucket])
      return
    }
    for (let index = start; index < safe.length; index += 1) {
      bucket.push(safe[index])
      visit(index + 1, bucket, targetSize)
      bucket.pop()
    }
  }
  for (let size = Math.max(1, minSize); size <= Math.max(minSize, maxSize); size += 1) {
    visit(0, [], size)
  }
  return out
}

const buildRowLookup = (rows = []) => new Map((Array.isArray(rows) ? rows : []).map((row) => [row?.rowKey, row]))

const winRateForPairs = ({ pairs = [], rowLookup = new Map(), featureSpecs = [] } = {}) => {
  let wins = 0
  let total = 0
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    const positiveRow = rowLookup.get(pair?.positiveRowKey)
    const negativeRow = rowLookup.get(pair?.negativeRowKey)
    if (!positiveRow || !negativeRow) continue
    const positiveScore = scoreRow({ row: positiveRow, featureSpecs })
    const negativeScore = scoreRow({ row: negativeRow, featureSpecs })
    if (!Number.isFinite(positiveScore) || !Number.isFinite(negativeScore)) continue
    total += 1
    if (positiveScore > negativeScore) wins += 1
  }
  return total > 0 ? wins / total : 0
}

const evaluateFoldWinRates = ({ dataset, selectedFeatureKeys = [] } = {}) => {
  const positiveRows = Array.isArray(dataset?.separabilityPositiveRows) ? dataset.separabilityPositiveRows : []
  const negativeRows = Array.isArray(dataset?.separabilityNegativeRows) ? dataset.separabilityNegativeRows : []
  const allRows = [...positiveRows, ...negativeRows]
  const rowLookup = buildRowLookup(allRows)
  const foldIds = uniqueNumbers(positiveRows.map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0))
  const foldReports = []
  for (const foldId of foldIds) {
    const fitPositiveRows = positiveRows.filter((row) => Number(row?.foldId ?? 0) !== foldId)
    const fitNegativeRows = negativeRows.filter((row) => Number(row?.foldId ?? 0) !== foldId)
    const heldoutPairs = (dataset?.separabilityPairs ?? []).filter((pair) => Number(pair?.foldId ?? 0) === foldId)
    if (fitPositiveRows.length < 3 || fitNegativeRows.length < 3 || heldoutPairs.length < 1) continue
    const featureSpecs = buildFeatureSpecs({
      featureKeys: selectedFeatureKeys,
      positiveRows: fitPositiveRows,
      negativeRows: fitNegativeRows,
    })
    const winRate = winRateForPairs({ pairs: heldoutPairs, rowLookup, featureSpecs })
    foldReports.push({ foldId, pairCount: heldoutPairs.length, pairwiseWinRate: winRate })
  }
  return foldReports
}

const previewCandidate = (candidate) => ({
  candidateId: candidate.candidateId,
  selectedFeatureKeys: candidate.selectedFeatureKeys,
  featureCount: candidate.featureCount,
  threshold: candidate.threshold,
  pairwiseWinRate: candidate.pairwiseWinRate,
  sameDateRunnerUpBeatRate: candidate.sameDateRunnerUpBeatRate,
  minFoldPairwiseWinRate: candidate.minFoldPairwiseWinRate,
  hardNegativeLeakCount: candidate.hardNegativeLeakCount,
  distinctPositiveSignatureCount: candidate.distinctPositiveSignatureCount,
  supportProjectionScore: candidate.supportProjectionScore,
  supportProjectionPositive: candidate.supportProjectionPositive,
  failureReason: candidate.failureReason,
})

const derivePrimaryReason = (reasonCounts = {}) =>
  Object.entries(reasonCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "unsat_no_separable_feature_subset"

export const auditPerfectPrototypeSupportSeparabilityPairwise = ({
  family,
  dataset,
  minHeldoutPairwiseWinRate = 0.9,
  minFoldPairwiseWinRate = 0.8,
  minRunnerUpBeatRate = 0.85,
  maxHardNegativeLeakCount = 0,
  minPositiveSignatureCount = 2,
  maxFeaturePool = 12,
} = {}) => {
  const supportFitExcluded = family?.supportFitExcluded === true
  if (supportFitExcluded !== true) {
    return {
      ok: false,
      reason: "unsat_support_acceptance_only_dependency",
      supportFitExcluded,
      candidateCount: 0,
      qualifiedCandidateCount: 0,
      selectedFeaturePoolCount: 0,
      featurePool: [],
      candidates: [],
      candidatePreviews: [],
      unsatReasonCounts: { unsat_support_acceptance_only_dependency: 1 },
    }
  }

  const positiveRows = Array.isArray(dataset?.separabilityPositiveRows) ? dataset.separabilityPositiveRows : []
  const negativeRows = Array.isArray(dataset?.separabilityNegativeRows) ? dataset.separabilityNegativeRows : []
  const supportRows = Array.isArray(dataset?.separabilitySupportProjectionRows) ? dataset.separabilitySupportProjectionRows : []
  const featurePool = collectFeatureCandidates({
    positiveRows,
    negativeRows,
    featureKeys: family?.supplierFeatureKeys ?? [],
    maxFeatures: maxFeaturePool,
  })
  if (featurePool.length < 2) {
    return {
      ok: false,
      reason: "unsat_no_separable_feature_subset",
      supportFitExcluded,
      candidateCount: 0,
      qualifiedCandidateCount: 0,
      selectedFeaturePoolCount: featurePool.length,
      featurePool: featurePool.map((entry) => entry.featureKey),
      candidates: [],
      candidatePreviews: [],
      unsatReasonCounts: { unsat_no_separable_feature_subset: 1 },
    }
  }

  const candidateCombos = buildCombinations(
    featurePool.map((entry) => entry.featureKey),
    2,
    Math.min(4, featurePool.length),
  )
  const rowLookup = buildRowLookup([...positiveRows, ...negativeRows, ...supportRows])
  const unsatReasonCounts = {}
  const candidates = []

  for (const selectedFeatureKeys of candidateCombos) {
    const featureSpecs = featurePool.filter((entry) => selectedFeatureKeys.includes(entry.featureKey))
    const positiveScores = positiveRows.map((row) => scoreRow({ row, featureSpecs })).filter(Number.isFinite)
    const negativeScores = negativeRows.map((row) => scoreRow({ row, featureSpecs })).filter(Number.isFinite)
    const threshold = Number(quantile(positiveScores, 0.1) ?? minValue(positiveScores) ?? 0)
    const pairwiseWinRate = winRateForPairs({
      pairs: dataset?.separabilityPairs ?? [],
      rowLookup,
      featureSpecs,
    })
    const sameDateRunnerUpBeatRate = winRateForPairs({
      pairs: dataset?.separabilitySameDatePairs ?? [],
      rowLookup,
      featureSpecs,
    })
    const foldReports = evaluateFoldWinRates({ dataset, selectedFeatureKeys })
    const minFoldWinRate =
      foldReports.length > 0
        ? Math.min(...foldReports.map((entry) => Number(entry?.pairwiseWinRate ?? 0)))
        : 0
    const hardNegativeLeakCount = negativeRows.filter((row) => scoreRow({ row, featureSpecs }) >= threshold).length
    const distinctPositiveSignatureCount = new Set(
      positiveRows.filter((row) => scoreRow({ row, featureSpecs }) >= threshold).map((row) => signatureOf(row)),
    ).size
    const supportProjectionScore = Math.max(
      Number.NEGATIVE_INFINITY,
      ...supportRows.map((row) => scoreRow({ row, featureSpecs })).filter(Number.isFinite),
    )
    const supportProjectionPositive = Number.isFinite(supportProjectionScore) && supportProjectionScore >= threshold
    let failureReason = null
    if (pairwiseWinRate < Number(minHeldoutPairwiseWinRate)) {
      failureReason = "unsat_pairwise_win_rate"
    } else if (minFoldWinRate < Number(minFoldPairwiseWinRate)) {
      failureReason = "unsat_fold_pairwise_win_rate"
    } else if (sameDateRunnerUpBeatRate < Number(minRunnerUpBeatRate)) {
      failureReason = "unsat_same_date_runner_up"
    } else if (hardNegativeLeakCount > Number(maxHardNegativeLeakCount)) {
      failureReason = "unsat_hard_negative_leak"
    } else if (distinctPositiveSignatureCount < Number(minPositiveSignatureCount)) {
      failureReason = "unsat_positive_signature_collapse"
    } else if (!supportProjectionPositive) {
      failureReason = "unsat_support_projection_non_positive"
    }
    if (failureReason) {
      unsatReasonCounts[failureReason] = Number(unsatReasonCounts[failureReason] ?? 0) + 1
    }
    candidates.push({
      candidateId: crypto.createHash("sha1").update(selectedFeatureKeys.join("|")).digest("hex").slice(0, 12),
      selectedFeatureKeys,
      featureCount: selectedFeatureKeys.length,
      featureSpecs,
      threshold,
      pairwiseWinRate,
      sameDateRunnerUpBeatRate,
      foldReports,
      minFoldPairwiseWinRate: minFoldWinRate,
      hardNegativeLeakCount,
      distinctPositiveSignatureCount,
      supportProjectionScore,
      supportProjectionPositive,
      failureReason,
      qualified: !failureReason,
    })
  }

  candidates.sort((left, right) => {
    if (Number(right.qualified) !== Number(left.qualified)) return Number(right.qualified) - Number(left.qualified)
    if (right.pairwiseWinRate !== left.pairwiseWinRate) return right.pairwiseWinRate - left.pairwiseWinRate
    if (right.sameDateRunnerUpBeatRate !== left.sameDateRunnerUpBeatRate) {
      return right.sameDateRunnerUpBeatRate - left.sameDateRunnerUpBeatRate
    }
    if (left.hardNegativeLeakCount !== right.hardNegativeLeakCount) {
      return left.hardNegativeLeakCount - right.hardNegativeLeakCount
    }
    if (right.distinctPositiveSignatureCount !== left.distinctPositiveSignatureCount) {
      return right.distinctPositiveSignatureCount - left.distinctPositiveSignatureCount
    }
    return left.selectedFeatureKeys.join("|").localeCompare(right.selectedFeatureKeys.join("|"))
  })

  const bestCandidate = candidates[0] ?? null
  return {
    ok: candidates.some((candidate) => candidate.qualified),
    reason: candidates.some((candidate) => candidate.qualified) ? null : derivePrimaryReason(unsatReasonCounts),
    supportFitExcluded,
    supportLeaveOneOutRecovered: candidates.some((candidate) => candidate.qualified && candidate.supportProjectionPositive),
    selectedFeaturePoolCount: featurePool.length,
    featurePool: featurePool.map((entry) => entry.featureKey),
    candidateCount: candidates.length,
    qualifiedCandidateCount: candidates.filter((candidate) => candidate.qualified).length,
    bestCandidate,
    candidates,
    candidatePreviews: candidates.slice(0, 40).map((candidate) => previewCandidate(candidate)),
    unsatReasonCounts,
  }
}

