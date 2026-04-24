import {
  arePerfectPrototypeRowsetsEqual,
  clonePerfectPrototypeRowsetOwned,
  estimatePerfectPrototypeRowsetBytes,
  fingerprintPerfectPrototypeRowset,
  isPerfectPrototypeRowsetSubset,
  summarizePerfectPrototypeRowsetEdges,
} from "./perfect_prototype_rowset.mjs"

const FRONTIER_TOMBSTONE_COMPACTION_MIN = 4
const FRONTIER_TOMBSTONE_COMPACTION_RATIO_NUMERATOR = 1
const FRONTIER_TOMBSTONE_COMPACTION_RATIO_DENOMINATOR = 2

const compareFrontierEntries = (left, right) =>
  Number(left?.negativeCount ?? Number.POSITIVE_INFINITY) -
    Number(right?.negativeCount ?? Number.POSITIVE_INFINITY) ||
  Number(left?.ruleSize ?? Number.POSITIVE_INFINITY) -
    Number(right?.ruleSize ?? Number.POSITIVE_INFINITY) ||
  Number(left?.startAt ?? Number.POSITIVE_INFINITY) -
    Number(right?.startAt ?? Number.POSITIVE_INFINITY) ||
  Number(left?.entryId ?? Number.POSITIVE_INFINITY) -
    Number(right?.entryId ?? Number.POSITIVE_INFINITY)

const buildNegativeFingerprintKey = ({ negativeFingerprint, negativeSummary }) =>
  [
    String(negativeFingerprint ?? ""),
    Number(negativeSummary?.count ?? 0),
    Number(negativeSummary?.firstValue ?? -1),
    Number(negativeSummary?.lastValue ?? -1),
  ].join(":")

const createFrontierNegativeCountBucketData = () => ({
  entryIds: [],
  entries: [],
  orderedRuleSizes: [],
  liveCount: 0,
  tombstoneCount: 0,
  metadataDirty: false,
  minStartAt: Number.POSITIVE_INFINITY,
  maxStartAt: Number.NEGATIVE_INFINITY,
  minRuleSize: Number.POSITIVE_INFINITY,
  maxRuleSize: Number.NEGATIVE_INFINITY,
  minFirstValue: Number.POSITIVE_INFINITY,
  maxFirstValue: Number.NEGATIVE_INFINITY,
  minLastValue: Number.POSITIVE_INFINITY,
  maxLastValue: Number.NEGATIVE_INFINITY,
})

const createFrontierFingerprintBucketData = () => ({
  entryIds: new Set(),
  liveCount: 0,
  metadataDirty: false,
  minStartAt: Number.POSITIVE_INFINITY,
  minRuleSize: Number.POSITIVE_INFINITY,
  orderedEntries: [],
  orderedEntryIds: [],
  orderedRuleSizes: [],
  orderedPrefixMinStartAts: [],
})

const createFrontierRangeSummary = () => ({
  liveBucketCount: 0,
  minStartAt: Number.POSITIVE_INFINITY,
  maxStartAt: Number.NEGATIVE_INFINITY,
  minRuleSize: Number.POSITIVE_INFINITY,
  maxRuleSize: Number.NEGATIVE_INFINITY,
  minFirstValue: Number.POSITIVE_INFINITY,
  maxFirstValue: Number.NEGATIVE_INFINITY,
  minLastValue: Number.POSITIVE_INFINITY,
  maxLastValue: Number.NEGATIVE_INFINITY,
})

const cloneFrontierRangeSummary = (summary) => ({
  liveBucketCount: Number(summary?.liveBucketCount ?? 0),
  minStartAt: Number(summary?.minStartAt ?? Number.POSITIVE_INFINITY),
  maxStartAt: Number(summary?.maxStartAt ?? Number.NEGATIVE_INFINITY),
  minRuleSize: Number(summary?.minRuleSize ?? Number.POSITIVE_INFINITY),
  maxRuleSize: Number(summary?.maxRuleSize ?? Number.NEGATIVE_INFINITY),
  minFirstValue: Number(summary?.minFirstValue ?? Number.POSITIVE_INFINITY),
  maxFirstValue: Number(summary?.maxFirstValue ?? Number.NEGATIVE_INFINITY),
  minLastValue: Number(summary?.minLastValue ?? Number.POSITIVE_INFINITY),
  maxLastValue: Number(summary?.maxLastValue ?? Number.NEGATIVE_INFINITY),
})

const resetFrontierNegativeCountBucketMetadata = (bucketData) => {
  bucketData.minStartAt = Number.POSITIVE_INFINITY
  bucketData.maxStartAt = Number.NEGATIVE_INFINITY
  bucketData.minRuleSize = Number.POSITIVE_INFINITY
  bucketData.maxRuleSize = Number.NEGATIVE_INFINITY
  bucketData.minFirstValue = Number.POSITIVE_INFINITY
  bucketData.maxFirstValue = Number.NEGATIVE_INFINITY
  bucketData.minLastValue = Number.POSITIVE_INFINITY
  bucketData.maxLastValue = Number.NEGATIVE_INFINITY
}

const resetFrontierFingerprintBucketMetadata = (bucketData) => {
  bucketData.minStartAt = Number.POSITIVE_INFINITY
  bucketData.minRuleSize = Number.POSITIVE_INFINITY
  bucketData.orderedEntries = []
  bucketData.orderedEntryIds = []
  bucketData.orderedRuleSizes = []
  bucketData.orderedPrefixMinStartAts = []
}

const updateFrontierNegativeCountBucketMetadata = (bucketData, entry) => {
  const startAt = Number(entry?.startAt ?? Number.POSITIVE_INFINITY)
  const ruleSize = Number(entry?.ruleSize ?? Number.POSITIVE_INFINITY)
  bucketData.minStartAt = Math.min(Number(bucketData.minStartAt ?? Number.POSITIVE_INFINITY), startAt)
  bucketData.maxStartAt = Math.max(Number(bucketData.maxStartAt ?? Number.NEGATIVE_INFINITY), startAt)
  bucketData.minRuleSize = Math.min(
    Number(bucketData.minRuleSize ?? Number.POSITIVE_INFINITY),
    ruleSize,
  )
  bucketData.maxRuleSize = Math.max(
    Number(bucketData.maxRuleSize ?? Number.NEGATIVE_INFINITY),
    ruleSize,
  )
  if (Number(entry?.negativeCount ?? 0) < 1) return
  const firstValue = Number(entry?.negativeSummary?.firstValue ?? Number.POSITIVE_INFINITY)
  const lastValue = Number(entry?.negativeSummary?.lastValue ?? Number.NEGATIVE_INFINITY)
  bucketData.minFirstValue = Math.min(
    Number(bucketData.minFirstValue ?? Number.POSITIVE_INFINITY),
    firstValue,
  )
  bucketData.maxFirstValue = Math.max(
    Number(bucketData.maxFirstValue ?? Number.NEGATIVE_INFINITY),
    firstValue,
  )
  bucketData.minLastValue = Math.min(
    Number(bucketData.minLastValue ?? Number.POSITIVE_INFINITY),
    lastValue,
  )
  bucketData.maxLastValue = Math.max(
    Number(bucketData.maxLastValue ?? Number.NEGATIVE_INFINITY),
    lastValue,
  )
}

const updateFrontierFingerprintBucketMetadata = (bucketData, entry) => {
  const startAt = Number(entry?.startAt ?? Number.POSITIVE_INFINITY)
  const ruleSize = Number(entry?.ruleSize ?? Number.POSITIVE_INFINITY)
  bucketData.minStartAt = Math.min(Number(bucketData.minStartAt ?? Number.POSITIVE_INFINITY), startAt)
  bucketData.minRuleSize = Math.min(
    Number(bucketData.minRuleSize ?? Number.POSITIVE_INFINITY),
    ruleSize,
  )
}

const refreshFrontierFingerprintOrderedPrefixMinStartAts = (bucketData, startIndex = 0) => {
  const safeStartIndex = Math.max(0, Math.floor(Number(startIndex) || 0))
  const orderedEntries = Array.isArray(bucketData?.orderedEntries) ? bucketData.orderedEntries : []
  const orderedEntryIds = Array.isArray(bucketData?.orderedEntryIds)
    ? bucketData.orderedEntryIds
    : []
  const orderedPrefixMinStartAts = Array.isArray(bucketData?.orderedPrefixMinStartAts)
    ? bucketData.orderedPrefixMinStartAts
    : []
  if (orderedEntries.length < 1 || orderedEntries.length !== orderedEntryIds.length) {
    bucketData.orderedPrefixMinStartAts = []
    return
  }
  let runningMinStartAt =
    safeStartIndex > 0
      ? Number(orderedPrefixMinStartAts[safeStartIndex - 1] ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY
  for (let index = safeStartIndex; index < orderedEntries.length; index += 1) {
    const entry = orderedEntries[index] ?? null
    const startAt = Number(entry?.startAt ?? Number.POSITIVE_INFINITY)
    runningMinStartAt = Math.min(runningMinStartAt, startAt)
    orderedPrefixMinStartAts[index] = runningMinStartAt
  }
  bucketData.orderedPrefixMinStartAts = orderedPrefixMinStartAts
}

const findFrontierFingerprintEntryInsertionIndex = (bucketData, nextEntry) => {
  let low = 0
  let high = Array.isArray(bucketData?.orderedEntries) ? bucketData.orderedEntries.length : 0
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    const existingEntry = bucketData?.orderedEntries?.[mid] ?? null
    if (!existingEntry) {
      high = mid
      continue
    }
    if (compareFrontierEntries(nextEntry, existingEntry) < 0) {
      high = mid
    } else {
      low = mid + 1
    }
  }
  return low
}

const findOrderedRuleSizeUpperBoundIndex = (orderedRuleSizes, nextRuleSize) => {
  let low = 0
  let high = Array.isArray(orderedRuleSizes) ? orderedRuleSizes.length : 0
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (Number(orderedRuleSizes[mid] ?? Number.POSITIVE_INFINITY) < nextRuleSize) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low - 1
}

const findOrderedRuleSizeStrictLowerBoundIndex = (orderedRuleSizes, nextRuleSize) =>
  findSortedNumberInsertionIndex(orderedRuleSizes, nextRuleSize + 1)

const canFrontierFingerprintBucketDominateCandidate = ({
  bucketData,
  startAt,
  ruleSize,
}) => {
  if (!bucketData || Number(bucketData.liveCount ?? 0) < 1) return false
  if (Number(bucketData.minRuleSize ?? Number.POSITIVE_INFINITY) >= ruleSize) return false
  const orderedRuleSizes = Array.isArray(bucketData.orderedRuleSizes)
    ? bucketData.orderedRuleSizes
    : []
  const orderedPrefixMinStartAts = Array.isArray(bucketData.orderedPrefixMinStartAts)
    ? bucketData.orderedPrefixMinStartAts
    : []
  const upperBoundIndex = findOrderedRuleSizeUpperBoundIndex(orderedRuleSizes, ruleSize)
  if (upperBoundIndex < 0) return false
  return Number(orderedPrefixMinStartAts[upperBoundIndex] ?? Number.POSITIVE_INFINITY) <= startAt
}

const updateFrontierRangeSummaryFromBucketData = (summary, bucketData) => {
  if (!bucketData || Number(bucketData.liveCount ?? 0) < 1) return summary
  summary.liveBucketCount += 1
  summary.minStartAt = Math.min(Number(summary.minStartAt ?? Number.POSITIVE_INFINITY), Number(bucketData.minStartAt ?? Number.POSITIVE_INFINITY))
  summary.maxStartAt = Math.max(Number(summary.maxStartAt ?? Number.NEGATIVE_INFINITY), Number(bucketData.maxStartAt ?? Number.NEGATIVE_INFINITY))
  summary.minRuleSize = Math.min(Number(summary.minRuleSize ?? Number.POSITIVE_INFINITY), Number(bucketData.minRuleSize ?? Number.POSITIVE_INFINITY))
  summary.maxRuleSize = Math.max(Number(summary.maxRuleSize ?? Number.NEGATIVE_INFINITY), Number(bucketData.maxRuleSize ?? Number.NEGATIVE_INFINITY))
  summary.minFirstValue = Math.min(Number(summary.minFirstValue ?? Number.POSITIVE_INFINITY), Number(bucketData.minFirstValue ?? Number.POSITIVE_INFINITY))
  summary.maxFirstValue = Math.max(Number(summary.maxFirstValue ?? Number.NEGATIVE_INFINITY), Number(bucketData.maxFirstValue ?? Number.NEGATIVE_INFINITY))
  summary.minLastValue = Math.min(Number(summary.minLastValue ?? Number.POSITIVE_INFINITY), Number(bucketData.minLastValue ?? Number.POSITIVE_INFINITY))
  summary.maxLastValue = Math.max(Number(summary.maxLastValue ?? Number.NEGATIVE_INFINITY), Number(bucketData.maxLastValue ?? Number.NEGATIVE_INFINITY))
  return summary
}

const markFrontierRangeSummariesDirty = (bucket) => {
  if (!bucket) return
  bucket.rangeSummaryDirty = true
}

const maybeSpliceFrontierRangeSummarySlots = (bucket, index, deleteCount, insertCount = 0) => {
  if (!bucket) return false
  if (bucket.rangeSummaryDirty === true) return false
  if (!Array.isArray(bucket.frontierPrefixSummaries)) return false
  if (!Array.isArray(bucket.frontierSuffixSummaries)) return false
  if (!Number.isInteger(index) || index < 0) return false
  if (!Number.isInteger(deleteCount) || deleteCount < 0) return false
  if (!Number.isInteger(insertCount) || insertCount < 0) return false
  if (bucket.frontierPrefixSummaries.length < index + deleteCount) return false
  if (bucket.frontierSuffixSummaries.length < index + deleteCount) return false
  const insertedPrefixSummaries = Array.from(
    { length: insertCount },
    () => createFrontierRangeSummary(),
  )
  const insertedSuffixSummaries = Array.from(
    { length: insertCount },
    () => createFrontierRangeSummary(),
  )
  bucket.frontierPrefixSummaries.splice(index, deleteCount, ...insertedPrefixSummaries)
  bucket.frontierSuffixSummaries.splice(index, deleteCount, ...insertedSuffixSummaries)
  return true
}

const getBucketResidentEstimatedBytes = (bucket) =>
  Math.max(
    0,
    Number(bucket?.estimatedBytes ?? 0) + Number(bucket?.frontierEstimatedBytes ?? 0),
  )

const adjustBucketFrontierEstimatedBytes = (bucket, deltaBytes) => {
  if (!bucket) return 0
  bucket.frontierEstimatedBytes = Math.max(
    0,
    Number(bucket.frontierEstimatedBytes ?? 0) + Number(deltaBytes ?? 0),
  )
  return bucket.frontierEstimatedBytes
}

const removeFrontierNegativeCountBucket = (bucket, negativeCount) => {
  bucket.frontierEntryIdsByNegativeCount.delete(negativeCount)
  const negativeCountIndex = bucket.frontierNegativeCounts.indexOf(negativeCount)
  if (negativeCountIndex >= 0) {
    bucket.frontierNegativeCounts.splice(negativeCountIndex, 1)
    if (!maybeSpliceFrontierRangeSummarySlots(bucket, negativeCountIndex, 1, 0)) {
      markFrontierRangeSummariesDirty(bucket)
    }
    return negativeCountIndex
  }
  markFrontierRangeSummariesDirty(bucket)
  return -1
}

const shouldCompactFrontierNegativeCountBucket = (bucketData) => {
  const tombstoneCount = Number(bucketData?.tombstoneCount ?? 0)
  const entryIdCount = Array.isArray(bucketData?.entryIds) ? bucketData.entryIds.length : 0
  if (tombstoneCount < FRONTIER_TOMBSTONE_COMPACTION_MIN) return false
  if (entryIdCount < 1) return false
  return (
    tombstoneCount * FRONTIER_TOMBSTONE_COMPACTION_RATIO_DENOMINATOR >=
    entryIdCount * FRONTIER_TOMBSTONE_COMPACTION_RATIO_NUMERATOR
  )
}

const canSubsetByEdgeSummary = (subsetSummary, supersetSummary) => {
  const subsetCount = Number(subsetSummary?.count ?? 0)
  const supersetCount = Number(supersetSummary?.count ?? 0)
  if (subsetCount > supersetCount) return false
  if (subsetCount < 1) return true
  if (supersetCount < 1) return false
  return (
    Number(subsetSummary?.firstValue ?? Number.NEGATIVE_INFINITY) >=
      Number(supersetSummary?.firstValue ?? Number.POSITIVE_INFINITY) &&
    Number(subsetSummary?.lastValue ?? Number.POSITIVE_INFINITY) <=
      Number(supersetSummary?.lastValue ?? Number.NEGATIVE_INFINITY)
  )
}

const findSortedNumberInsertionIndex = (values, nextValue) => {
  let low = 0
  let high = Array.isArray(values) ? values.length : 0
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (Number(values[mid] ?? Number.POSITIVE_INFINITY) < nextValue) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

const findFrontierNegativeCountUpperBoundIndex = (values, nextValue) => {
  const insertionIndex = findSortedNumberInsertionIndex(values, nextValue + 1)
  return insertionIndex - 1
}

const findFrontierNegativeCountLowerBoundIndex = (values, nextValue) =>
  findSortedNumberInsertionIndex(values, nextValue)

const appendFrontierFingerprintEntry = (bucket, entry) => {
  const index = bucket?.frontierFingerprintIndex
  if (!index) return
  const key = buildNegativeFingerprintKey(entry)
  const bucketData = index.get(key) ?? createFrontierFingerprintBucketData()
  const safeEntryId = Number(entry?.entryId ?? 0)
  if (safeEntryId < 1) return
  if (bucketData.entryIds.has(safeEntryId)) {
    index.set(key, bucketData)
    return
  }
  bucketData.entryIds.add(safeEntryId)
  bucketData.liveCount = bucketData.entryIds.size
  updateFrontierFingerprintBucketMetadata(bucketData, entry)
  if (bucketData.metadataDirty !== true) {
    const insertionIndex = findFrontierFingerprintEntryInsertionIndex(bucketData, entry)
    bucketData.orderedEntries.splice(insertionIndex, 0, entry)
    bucketData.orderedEntryIds.splice(insertionIndex, 0, safeEntryId)
    bucketData.orderedRuleSizes.splice(insertionIndex, 0, Number(entry?.ruleSize ?? Number.POSITIVE_INFINITY))
    bucketData.orderedPrefixMinStartAts.splice(insertionIndex, 0, Number.POSITIVE_INFINITY)
    refreshFrontierFingerprintOrderedPrefixMinStartAts(bucketData, insertionIndex)
  }
  index.set(key, bucketData)
}

const removeFrontierFingerprintEntry = (index, entry) => {
  const key = buildNegativeFingerprintKey(entry)
  const bucketData = index.get(key) ?? null
  if (!bucketData) return
  bucketData.entryIds.delete(Number(entry?.entryId))
  bucketData.liveCount = bucketData.entryIds.size
  bucketData.metadataDirty = true
  if (bucketData.liveCount > 0) {
    index.set(key, bucketData)
  } else {
    index.delete(key)
  }
}

const ensureFrontierFingerprintBucketReady = (
  bucket,
  fingerprintKey,
  { onMetadataRebuild = null } = {},
) => {
  const bucketData = bucket?.frontierFingerprintIndex?.get?.(fingerprintKey) ?? null
  if (!bucketData) return null
  if (Number(bucketData.liveCount ?? 0) < 1 || bucketData.entryIds.size < 1) {
    bucket.frontierFingerprintIndex.delete(fingerprintKey)
    return null
  }
  const orderedMetadataReady =
    bucketData.metadataDirty !== true &&
    Array.isArray(bucketData.orderedEntryIds) &&
    Array.isArray(bucketData.orderedRuleSizes) &&
    Array.isArray(bucketData.orderedPrefixMinStartAts) &&
    bucketData.orderedEntryIds.length === Number(bucketData.liveCount ?? 0) &&
    bucketData.orderedRuleSizes.length === Number(bucketData.liveCount ?? 0) &&
    bucketData.orderedPrefixMinStartAts.length === Number(bucketData.liveCount ?? 0)
  if (orderedMetadataReady) return bucketData
  const nextEntryIds = new Set()
  const orderedEntries = []
  resetFrontierFingerprintBucketMetadata(bucketData)
  for (const entryId of bucketData.entryIds ?? []) {
    const safeEntryId = Number(entryId ?? 0)
    if (safeEntryId < 1) continue
    const entry = bucket.frontierEntriesById.get(safeEntryId) ?? null
    if (!entry) continue
    nextEntryIds.add(safeEntryId)
    orderedEntries.push(entry)
    updateFrontierFingerprintBucketMetadata(bucketData, entry)
  }
  bucketData.entryIds = nextEntryIds
  bucketData.liveCount = nextEntryIds.size
  bucketData.orderedEntries = orderedEntries
  orderedEntries.sort(compareFrontierEntries)
  bucketData.orderedEntryIds = orderedEntries.map((entry) => Number(entry?.entryId ?? 0))
  bucketData.orderedRuleSizes = orderedEntries.map((entry) =>
    Number(entry?.ruleSize ?? Number.POSITIVE_INFINITY),
  )
  refreshFrontierFingerprintOrderedPrefixMinStartAts(bucketData, 0)
  bucketData.metadataDirty = false
  if (typeof onMetadataRebuild === "function") {
    onMetadataRebuild()
  }
  if (bucketData.liveCount > 0) {
    bucket.frontierFingerprintIndex.set(fingerprintKey, bucketData)
    return bucketData
  }
  bucket.frontierFingerprintIndex.delete(fingerprintKey)
  return null
}

const compactFrontierNegativeCountBucket = (
  bucket,
  negativeCount,
  { onCompaction = null } = {},
) => {
  const bucketData = bucket?.frontierEntryIdsByNegativeCount?.get?.(negativeCount) ?? null
  if (!bucketData) return null
  if (Number(bucketData.tombstoneCount ?? 0) < 1 && bucketData.metadataDirty !== true) {
    return bucketData
  }
  const didCompact = Number(bucketData.tombstoneCount ?? 0) > 0
  const nextEntryIds = []
  const nextEntries = []
  const nextRuleSizes = []
  resetFrontierNegativeCountBucketMetadata(bucketData)
  for (const entryId of bucketData.entryIds ?? []) {
    const safeEntryId = Number(entryId ?? 0)
    if (safeEntryId < 1) continue
    const entry = bucket.frontierEntriesById.get(safeEntryId) ?? null
    if (!entry) continue
    nextEntryIds.push(safeEntryId)
    nextEntries.push(entry)
    nextRuleSizes.push(Number(entry?.ruleSize ?? Number.POSITIVE_INFINITY))
    updateFrontierNegativeCountBucketMetadata(bucketData, entry)
  }
  bucketData.entryIds = nextEntryIds
  bucketData.entries = nextEntries
  bucketData.orderedRuleSizes = nextRuleSizes
  bucketData.liveCount = nextEntryIds.length
  bucketData.tombstoneCount = 0
  bucketData.metadataDirty = false
  if (didCompact && typeof onCompaction === "function") {
    onCompaction()
  }
  if (bucketData.liveCount > 0) {
    bucket.frontierEntryIdsByNegativeCount.set(negativeCount, bucketData)
    return bucketData
  }
  removeFrontierNegativeCountBucket(bucket, negativeCount)
  return null
}

const recomputeFrontierNegativeCountBucketMetadata = (bucket, negativeCount) => {
  const bucketData = bucket?.frontierEntryIdsByNegativeCount?.get?.(negativeCount) ?? null
  if (!bucketData) return null
  resetFrontierNegativeCountBucketMetadata(bucketData)
  let liveCount = 0
  const nextEntries = []
  const nextRuleSizes = []
  for (const entryId of bucketData.entryIds ?? []) {
    const safeEntryId = Number(entryId ?? 0)
    if (safeEntryId < 1) continue
    const entry = bucket.frontierEntriesById.get(safeEntryId) ?? null
    if (!entry) continue
    liveCount += 1
    nextEntries.push(entry)
    nextRuleSizes.push(Number(entry?.ruleSize ?? Number.POSITIVE_INFINITY))
    updateFrontierNegativeCountBucketMetadata(bucketData, entry)
  }
  bucketData.entries = nextEntries
  bucketData.orderedRuleSizes = nextRuleSizes
  bucketData.liveCount = liveCount
  bucketData.metadataDirty = false
  if (liveCount > 0) {
    bucket.frontierEntryIdsByNegativeCount.set(negativeCount, bucketData)
    return bucketData
  }
  removeFrontierNegativeCountBucket(bucket, negativeCount)
  return null
}

const ensureFrontierNegativeCountBucketReady = (
  bucket,
  negativeCount,
  { onCompaction = null } = {},
) => {
  const bucketData = bucket?.frontierEntryIdsByNegativeCount?.get?.(negativeCount) ?? null
  if (!bucketData) return null
  if (Number(bucketData.liveCount ?? 0) < 1) {
    removeFrontierNegativeCountBucket(bucket, negativeCount)
    return null
  }
  if (shouldCompactFrontierNegativeCountBucket(bucketData)) {
    const compacted = compactFrontierNegativeCountBucket(bucket, negativeCount, {
      onCompaction,
    })
    return compacted
  }
  if (bucketData.metadataDirty === true) {
    return recomputeFrontierNegativeCountBucketMetadata(bucket, negativeCount)
  }
  return bucketData
}

const canFrontierBucketDominateCandidate = ({
  negativeCount,
  bucketData,
  startAt,
  ruleSize,
  negativeSummary,
}) => {
  if (!bucketData || Number(bucketData.liveCount ?? 0) < 1) return false
  if (Number(bucketData.minStartAt ?? Number.POSITIVE_INFINITY) > startAt) return false
  if (Number(bucketData.minRuleSize ?? Number.POSITIVE_INFINITY) >= ruleSize) return false
  if (negativeCount < 1) return true
  if (Number(negativeSummary?.count ?? 0) < 1) return false
  const nextFirstValue = Number(negativeSummary?.firstValue ?? Number.POSITIVE_INFINITY)
  const nextLastValue = Number(negativeSummary?.lastValue ?? Number.NEGATIVE_INFINITY)
  if (Number(bucketData.maxFirstValue ?? Number.NEGATIVE_INFINITY) < nextFirstValue) return false
  if (Number(bucketData.minLastValue ?? Number.POSITIVE_INFINITY) > nextLastValue) return false
  return true
}

const canCandidateDominateFrontierBucket = ({
  bucketData,
  startAt,
  ruleSize,
  negativeSummary,
}) => {
  if (!bucketData || Number(bucketData.liveCount ?? 0) < 1) return false
  if (Number(bucketData.maxStartAt ?? Number.NEGATIVE_INFINITY) < startAt) return false
  if (Number(bucketData.maxRuleSize ?? Number.NEGATIVE_INFINITY) <= ruleSize) return false
  if (Number(negativeSummary?.count ?? 0) < 1) return true
  const nextFirstValue = Number(negativeSummary?.firstValue ?? Number.NEGATIVE_INFINITY)
  const nextLastValue = Number(negativeSummary?.lastValue ?? Number.POSITIVE_INFINITY)
  if (Number(bucketData.minFirstValue ?? Number.POSITIVE_INFINITY) > nextFirstValue) return false
  if (Number(bucketData.maxLastValue ?? Number.NEGATIVE_INFINITY) < nextLastValue) return false
  return true
}

const canFrontierRangeDominateCandidate = ({
  rangeSummary,
  startAt,
  ruleSize,
  negativeSummary,
}) => {
  if (!rangeSummary || Number(rangeSummary.liveBucketCount ?? 0) < 1) return false
  if (Number(rangeSummary.minStartAt ?? Number.POSITIVE_INFINITY) > startAt) return false
  if (Number(rangeSummary.minRuleSize ?? Number.POSITIVE_INFINITY) >= ruleSize) return false
  if (Number(negativeSummary?.count ?? 0) < 1) return true
  const nextFirstValue = Number(negativeSummary?.firstValue ?? Number.POSITIVE_INFINITY)
  const nextLastValue = Number(negativeSummary?.lastValue ?? Number.NEGATIVE_INFINITY)
  if (Number(rangeSummary.maxFirstValue ?? Number.NEGATIVE_INFINITY) < nextFirstValue) return false
  if (Number(rangeSummary.minLastValue ?? Number.POSITIVE_INFINITY) > nextLastValue) return false
  return true
}

const canCandidateDominateFrontierRange = ({
  rangeSummary,
  startAt,
  ruleSize,
  negativeSummary,
}) => {
  if (!rangeSummary || Number(rangeSummary.liveBucketCount ?? 0) < 1) return false
  if (Number(rangeSummary.maxStartAt ?? Number.NEGATIVE_INFINITY) < startAt) return false
  if (Number(rangeSummary.maxRuleSize ?? Number.NEGATIVE_INFINITY) <= ruleSize) return false
  if (Number(negativeSummary?.count ?? 0) < 1) return true
  const nextFirstValue = Number(negativeSummary?.firstValue ?? Number.NEGATIVE_INFINITY)
  const nextLastValue = Number(negativeSummary?.lastValue ?? Number.POSITIVE_INFINITY)
  if (Number(rangeSummary.minFirstValue ?? Number.POSITIVE_INFINITY) > nextFirstValue) return false
  if (Number(rangeSummary.maxLastValue ?? Number.NEGATIVE_INFINITY) < nextLastValue) return false
  return true
}

const rebuildFrontierRangeSummaries = (
  bucket,
  { onCompaction = null, onRangeSummaryRebuild = null } = {},
) => {
  const normalizedCounts = []
  const readyBuckets = []
  for (const rawNegativeCount of [...(bucket?.frontierNegativeCounts ?? [])]) {
    const negativeCount = Number(rawNegativeCount ?? 0)
    const bucketData = ensureFrontierNegativeCountBucketReady(bucket, negativeCount, {
      onCompaction,
    })
    if (!bucketData) continue
    normalizedCounts.push(negativeCount)
    readyBuckets.push(bucketData)
  }
  bucket.frontierNegativeCounts = normalizedCounts
  const prefixSummaries = []
  const suffixSummaries = new Array(readyBuckets.length)
  let runningPrefixSummary = createFrontierRangeSummary()
  for (const bucketData of readyBuckets) {
    runningPrefixSummary = updateFrontierRangeSummaryFromBucketData(
      runningPrefixSummary,
      bucketData,
    )
    prefixSummaries.push(cloneFrontierRangeSummary(runningPrefixSummary))
  }
  let runningSuffixSummary = createFrontierRangeSummary()
  for (let index = readyBuckets.length - 1; index >= 0; index -= 1) {
    runningSuffixSummary = updateFrontierRangeSummaryFromBucketData(
      runningSuffixSummary,
      readyBuckets[index],
    )
    suffixSummaries[index] = cloneFrontierRangeSummary(runningSuffixSummary)
  }
  bucket.frontierPrefixSummaries = prefixSummaries
  bucket.frontierSuffixSummaries = suffixSummaries
  bucket.rangeSummaryDirty = false
  if (typeof onRangeSummaryRebuild === "function") {
    onRangeSummaryRebuild()
  }
}

const ensureFrontierRangeSummariesReady = (
  bucket,
  { onCompaction = null, onRangeSummaryRebuild = null } = {},
) => {
  if (!bucket) return
  const currentCountLength = Array.isArray(bucket.frontierNegativeCounts)
    ? bucket.frontierNegativeCounts.length
    : 0
  const prefixLength = Array.isArray(bucket.frontierPrefixSummaries)
    ? bucket.frontierPrefixSummaries.length
    : 0
  const suffixLength = Array.isArray(bucket.frontierSuffixSummaries)
    ? bucket.frontierSuffixSummaries.length
    : 0
  if (
    bucket.rangeSummaryDirty !== true &&
    prefixLength === currentCountLength &&
    suffixLength === currentCountLength
  ) {
    return
  }
  rebuildFrontierRangeSummaries(bucket, {
    onCompaction,
    onRangeSummaryRebuild,
  })
}

const maybeIncrementallyRefreshFrontierRangeSummaries = (bucket, changedIndex) => {
  if (!bucket) return false
  if (bucket.rangeSummaryDirty === true) return false
  if (!Array.isArray(bucket.frontierNegativeCounts)) return false
  if (!Array.isArray(bucket.frontierPrefixSummaries)) return false
  if (!Array.isArray(bucket.frontierSuffixSummaries)) return false
  const safeChangedIndex = Math.max(0, Math.floor(Number(changedIndex) || 0))
  const countLength = bucket.frontierNegativeCounts.length
  if (countLength < 1) {
    bucket.frontierPrefixSummaries = []
    bucket.frontierSuffixSummaries = []
    return true
  }
  if (
    bucket.frontierPrefixSummaries.length !== countLength ||
    bucket.frontierSuffixSummaries.length !== countLength
  ) {
    return false
  }
  if (safeChangedIndex >= countLength) return true

  let runningPrefixSummary =
    safeChangedIndex > 0
      ? cloneFrontierRangeSummary(bucket.frontierPrefixSummaries[safeChangedIndex - 1])
      : createFrontierRangeSummary()
  for (let index = safeChangedIndex; index < countLength; index += 1) {
    const negativeCount = Number(bucket.frontierNegativeCounts[index] ?? 0)
    const bucketData = bucket.frontierEntryIdsByNegativeCount.get(negativeCount) ?? null
    if (!bucketData || Number(bucketData?.liveCount ?? 0) < 1 || bucketData?.metadataDirty === true) {
      return false
    }
    runningPrefixSummary = updateFrontierRangeSummaryFromBucketData(runningPrefixSummary, bucketData)
    bucket.frontierPrefixSummaries[index] = cloneFrontierRangeSummary(runningPrefixSummary)
  }

  let runningSuffixSummary =
    safeChangedIndex + 1 < countLength
      ? cloneFrontierRangeSummary(bucket.frontierSuffixSummaries[safeChangedIndex + 1])
      : createFrontierRangeSummary()
  for (let index = safeChangedIndex; index >= 0; index -= 1) {
    const negativeCount = Number(bucket.frontierNegativeCounts[index] ?? 0)
    const bucketData = bucket.frontierEntryIdsByNegativeCount.get(negativeCount) ?? null
    if (!bucketData || Number(bucketData?.liveCount ?? 0) < 1 || bucketData?.metadataDirty === true) {
      return false
    }
    runningSuffixSummary = updateFrontierRangeSummaryFromBucketData(runningSuffixSummary, bucketData)
    bucket.frontierSuffixSummaries[index] = cloneFrontierRangeSummary(runningSuffixSummary)
  }
  return true
}

const refreshFrontierRangeSummariesAfterMutation = (bucket, changedIndex) => {
  if (!bucket) return false
  if (bucket.rangeSummaryDirty === true) return false
  const safeChangedIndex = Math.max(0, Math.floor(Number(changedIndex) || 0))
  if (maybeIncrementallyRefreshFrontierRangeSummaries(bucket, safeChangedIndex)) {
    bucket.rangeSummaryDirty = false
    return true
  }
  markFrontierRangeSummariesDirty(bucket)
  return false
}

const findFrontierEntryInsertionIndex = (bucketData, nextEntry) => {
  let low = 0
  let high = Array.isArray(bucketData?.entries) ? bucketData.entries.length : 0
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    const existingEntry = bucketData?.entries?.[mid] ?? null
    if (!existingEntry) {
      high = mid
      continue
    }
    if (compareFrontierEntries(nextEntry, existingEntry) < 0) {
      high = mid
    } else {
      low = mid + 1
    }
  }
  return low
}

const addFrontierEntryToNegativeCountIndex = (bucket, entry, { onCompaction = null } = {}) => {
  const negativeCount = Number(entry?.negativeCount ?? 0)
  let insertedNewNegativeCount = false
  let bucketData = bucket.frontierEntryIdsByNegativeCount.get(negativeCount) ?? null
  if (!bucketData) {
    bucketData = createFrontierNegativeCountBucketData()
    const negativeCountIndex = findSortedNumberInsertionIndex(bucket.frontierNegativeCounts, negativeCount)
    bucket.frontierNegativeCounts.splice(negativeCountIndex, 0, negativeCount)
    insertedNewNegativeCount = true
  } else {
    bucketData =
      compactFrontierNegativeCountBucket(bucket, negativeCount, {
        onCompaction,
      }) ?? createFrontierNegativeCountBucketData()
  }
  const insertionIndex = findFrontierEntryInsertionIndex(bucketData, entry)
  bucketData.entryIds.splice(insertionIndex, 0, Number(entry.entryId))
  bucketData.entries.splice(insertionIndex, 0, entry)
  bucketData.orderedRuleSizes.splice(
    insertionIndex,
    0,
    Number(entry?.ruleSize ?? Number.POSITIVE_INFINITY),
  )
  bucketData.liveCount += 1
  updateFrontierNegativeCountBucketMetadata(bucketData, entry)
  bucket.frontierEntryIdsByNegativeCount.set(negativeCount, bucketData)
  const negativeCountIndex = bucket.frontierNegativeCounts.indexOf(negativeCount)
  if (
    insertedNewNegativeCount === true &&
    bucket.rangeSummaryDirty !== true &&
    Array.isArray(bucket.frontierPrefixSummaries) &&
    Array.isArray(bucket.frontierSuffixSummaries) &&
    bucket.frontierPrefixSummaries.length === bucket.frontierNegativeCounts.length - 1 &&
    bucket.frontierSuffixSummaries.length === bucket.frontierNegativeCounts.length - 1
  ) {
    bucket.frontierPrefixSummaries.splice(negativeCountIndex, 0, createFrontierRangeSummary())
    bucket.frontierSuffixSummaries.splice(negativeCountIndex, 0, createFrontierRangeSummary())
  }
  if (!maybeIncrementallyRefreshFrontierRangeSummaries(bucket, negativeCountIndex)) {
    markFrontierRangeSummariesDirty(bucket)
  }
}

const removeFrontierEntryFromNegativeCountIndex = (bucket, entry) => {
  const negativeCount = Number(entry?.negativeCount ?? 0)
  const bucketData = bucket.frontierEntryIdsByNegativeCount.get(negativeCount) ?? null
  if (!bucketData) return -1
  const negativeCountIndex = bucket.frontierNegativeCounts.indexOf(negativeCount)
  const entryId = Number(entry?.entryId ?? 0)
  const entryIndex = bucketData.entryIds.indexOf(entryId)
  if (entryIndex < 0) return negativeCountIndex
  if (Number(bucketData.entryIds[entryIndex] ?? 0) > 0) {
    bucketData.entryIds[entryIndex] = 0
    if (Array.isArray(bucketData.entries) && entryIndex < bucketData.entries.length) {
      bucketData.entries[entryIndex] = null
    }
    if (Array.isArray(bucketData.orderedRuleSizes) && entryIndex < bucketData.orderedRuleSizes.length) {
      bucketData.orderedRuleSizes[entryIndex] = Number.POSITIVE_INFINITY
    }
    bucketData.liveCount = Math.max(0, Number(bucketData.liveCount ?? 0) - 1)
    bucketData.tombstoneCount = Number(bucketData.tombstoneCount ?? 0) + 1
    bucketData.metadataDirty = true
  }
  if (bucketData.liveCount < 1) {
    removeFrontierNegativeCountBucket(bucket, negativeCount)
    return negativeCountIndex
  }
  bucket.frontierEntryIdsByNegativeCount.set(negativeCount, bucketData)
  return negativeCountIndex
}

const finalizeFrontierNegativeCountMutations = (
  bucket,
  { changedNegativeCounts = null, earliestChangedIndex = Number.POSITIVE_INFINITY, onCompaction = null } = {},
) => {
  if (!bucket) return
  let nextChangedIndex = Number.isInteger(earliestChangedIndex)
    ? Math.max(0, earliestChangedIndex)
    : Number.POSITIVE_INFINITY
  const normalizedNegativeCounts = Array.isArray(changedNegativeCounts)
    ? changedNegativeCounts
    : changedNegativeCounts instanceof Set
      ? Array.from(changedNegativeCounts)
      : []
  for (const rawNegativeCount of normalizedNegativeCounts) {
    const negativeCount = Number(rawNegativeCount ?? 0)
    const readyBucket = ensureFrontierNegativeCountBucketReady(bucket, negativeCount, {
      onCompaction,
    })
    const readyIndex = bucket.frontierNegativeCounts.indexOf(negativeCount)
    if (readyBucket && readyIndex >= 0) {
      nextChangedIndex = Math.min(nextChangedIndex, readyIndex)
    }
  }
  if (bucket.frontierNegativeCounts.length < 1) {
    bucket.frontierPrefixSummaries = []
    bucket.frontierSuffixSummaries = []
    bucket.rangeSummaryDirty = false
    return
  }
  if (!Number.isFinite(nextChangedIndex)) {
    nextChangedIndex = 0
  }
  refreshFrontierRangeSummariesAfterMutation(bucket, nextChangedIndex)
}

export const createPerfectPrototypeSearchStateCache = ({
  maxBytes = 128 * 1024 * 1024,
} = {}) => {
  const memoSkylineV3Enabled =
    String(process.env.PREJUMP_MEMO_SKYLINE_V3 ?? "true").trim().toLowerCase() === "true"
  if (memoSkylineV3Enabled !== true) {
    throw new Error("Perfect prototype search state cache requires PREJUMP_MEMO_SKYLINE_V3=true")
  }
  const positiveBucketsByFingerprint = new Map()
  const bucketLru = new Set()
  const safeMaxBytes = Math.max(0, Math.floor(Number(maxBytes) || 0))
  let totalEstimatedBytes = 0
  let memoHitCount = 0
  let lookupCount = 0
  let lookupMs = 0
  let frontierInsertCount = 0
  let frontierPruneCount = 0
  let memoFrontierScanCount = 0
  let memoFrontierDeleteCount = 0
  let memoFrontierSkippedBucketCount = 0
  let memoFrontierCompactionCount = 0
  let memoRangeSkipPrefixCount = 0
  let memoRangeSkipSuffixCount = 0
  let memoRangeSummaryRebuildCount = 0
  let memoExactFingerprintFastHitCount = 0
  let memoExactFingerprintFastRejectCount = 0
  let memoExactFingerprintScanCount = 0
  let memoFingerprintMetadataRebuildCount = 0
  let memoFingerprintBucketPeak = 0
  let memoLookupFingerprintMs = 0
  let memoLookupExactFingerprintScanMs = 0
  let memoLookupRangeSummaryPrepMs = 0
  let memoLookupPrefixScanMs = 0
  let memoLookupSuffixScanMs = 0
  let memoLookupEntryScanCount = 0
  let memoLookupFingerprintMissCount = 0
  let memoLookupRangeCandidateBucketCount = 0
  let evictedBucketCount = 0
  let evictedFrontierEntryCount = 0
  let oversizeSkipCount = 0
  let nextFrontierEntryId = 1

  const touchBucket = (bucket) => {
    if (!bucket || safeMaxBytes < 1) return
    bucketLru.delete(bucket)
    bucketLru.add(bucket)
  }

  const removeBucket = (bucket) => {
    if (!bucket) return
    const positiveFingerprint = String(bucket.positiveFingerprint ?? "")
    const collisionBucket = positiveBucketsByFingerprint.get(positiveFingerprint) ?? []
    const bucketIndex = collisionBucket.indexOf(bucket)
    if (bucketIndex >= 0) {
      collisionBucket.splice(bucketIndex, 1)
    }
    if (collisionBucket.length > 0) {
      positiveBucketsByFingerprint.set(positiveFingerprint, collisionBucket)
    } else {
      positiveBucketsByFingerprint.delete(positiveFingerprint)
    }
    bucketLru.delete(bucket)
    totalEstimatedBytes = Math.max(
      0,
      totalEstimatedBytes - getBucketResidentEstimatedBytes(bucket),
    )
    evictedBucketCount += 1
    evictedFrontierEntryCount += Number(bucket.frontierEntriesById?.size ?? 0)
    bucket.frontierEntriesById?.clear?.()
    bucket.frontierFingerprintIndex?.clear?.()
    bucket.frontierEntryIdsByNegativeCount?.clear?.()
    bucket.frontierNegativeCounts = []
    bucket.frontierPrefixSummaries = []
    bucket.frontierSuffixSummaries = []
    bucket.frontierEstimatedBytes = 0
  }

  const enforceBudget = ({ currentBucket = null } = {}) => {
    if (safeMaxBytes < 1) return
    while (totalEstimatedBytes > safeMaxBytes) {
      const oldestBucket = bucketLru.values().next().value ?? null
      if (!oldestBucket) break
      if (oldestBucket === currentBucket && bucketLru.size > 1) {
        bucketLru.delete(oldestBucket)
        bucketLru.add(oldestBucket)
        continue
      }
      removeBucket(oldestBucket)
      if (oldestBucket === currentBucket) {
        oversizeSkipCount += 1
        break
      }
    }
  }

  const getOrCreatePositiveBucket = (positiveRowset) => {
    const positiveFingerprint = fingerprintPerfectPrototypeRowset(positiveRowset)
    const positiveSummary = summarizePerfectPrototypeRowsetEdges(positiveRowset)
    const hashBucket = positiveBucketsByFingerprint.get(positiveFingerprint) ?? []
    const existing = hashBucket.find((entry) =>
      entry?.positiveSummary?.count === positiveSummary.count &&
      entry?.positiveSummary?.firstValue === positiveSummary.firstValue &&
      entry?.positiveSummary?.lastValue === positiveSummary.lastValue &&
      arePerfectPrototypeRowsetsEqual(entry?.positiveRowset, positiveRowset),
    )
    if (existing) {
      touchBucket(existing)
      return { positiveFingerprint, bucket: existing }
    }
    const storedPositiveRowset = clonePerfectPrototypeRowsetOwned(positiveRowset)
    const bucket = {
      positiveFingerprint,
      positiveSummary,
      positiveRowset: storedPositiveRowset,
      frontierNegativeCounts: [],
      frontierPrefixSummaries: [],
      frontierSuffixSummaries: [],
      frontierEntryIdsByNegativeCount: new Map(),
      frontierFingerprintIndex: new Map(),
      frontierEntriesById: new Map(),
      rangeSummaryDirty: false,
      estimatedBytes: estimatePerfectPrototypeRowsetBytes(storedPositiveRowset) + 64,
      frontierEstimatedBytes: 0,
    }
    hashBucket.push(bucket)
    positiveBucketsByFingerprint.set(positiveFingerprint, hashBucket)
    totalEstimatedBytes += bucket.estimatedBytes
    touchBucket(bucket)
    enforceBudget({ currentBucket: bucket })
    return { positiveFingerprint, bucket }
  }

  const isDominated = ({ positiveRowset, negativeRowset, startAt, ruleSize }) => {
    const startedAt = process.hrtime.bigint()
    try {
      const { bucket } = getOrCreatePositiveBucket(positiveRowset)
      if (!bucketLru.has(bucket) && safeMaxBytes > 0) {
        return false
      }
      const safeStartAt = Math.max(0, Math.floor(Number(startAt) || 0))
      const safeRuleSize = Math.max(0, Math.floor(Number(ruleSize) || 0))
      const frontierEntriesById = bucket.frontierEntriesById ?? new Map()
      const fingerprintStartedAt = process.hrtime.bigint()
      const nextNegativeCount = Number(negativeRowset?.count ?? 0)
      const nextNegativeSummary = summarizePerfectPrototypeRowsetEdges(negativeRowset)
      const nextNegativeFingerprint = fingerprintPerfectPrototypeRowset(negativeRowset)
      const exactFingerprintKey = buildNegativeFingerprintKey({
        negativeFingerprint: nextNegativeFingerprint,
        negativeSummary: nextNegativeSummary,
      })
      memoLookupFingerprintMs += Number(process.hrtime.bigint() - fingerprintStartedAt) / 1_000_000

      let dominatedByFrontier = false
      const frontierEntryCount = Number(frontierEntriesById?.size ?? 0)
      let exactFingerprintHit = false
      const exactFingerprintStartedAt = process.hrtime.bigint()
      const exactFingerprintBucket =
        frontierEntryCount > 0
          ? ensureFrontierFingerprintBucketReady(bucket, exactFingerprintKey, {
              onMetadataRebuild: () => {
                memoFingerprintMetadataRebuildCount += 1
              },
            })
          : null
      memoFingerprintBucketPeak = Math.max(
        memoFingerprintBucketPeak,
        Number(exactFingerprintBucket?.liveCount ?? 0),
      )
      if (
        exactFingerprintBucket &&
        canFrontierFingerprintBucketDominateCandidate({
          bucketData: exactFingerprintBucket,
          startAt: safeStartAt,
          ruleSize: safeRuleSize,
        })
      ) {
        const orderedEntries =
          Array.isArray(exactFingerprintBucket.orderedEntries) &&
          exactFingerprintBucket.orderedEntries.length === Number(exactFingerprintBucket.liveCount ?? 0)
            ? exactFingerprintBucket.orderedEntries
            : Array.from(exactFingerprintBucket.entryIds ?? [])
                .map((entryId) => frontierEntriesById.get(Number(entryId ?? 0)) ?? null)
                .filter(Boolean)
        const orderedRuleSizes =
          Array.isArray(exactFingerprintBucket.orderedRuleSizes) &&
          exactFingerprintBucket.orderedRuleSizes.length === orderedEntries.length
            ? exactFingerprintBucket.orderedRuleSizes
            : orderedEntries.map((entry) => Number(entry?.ruleSize ?? Number.POSITIVE_INFINITY))
        const entryUpperBoundIndex = findOrderedRuleSizeUpperBoundIndex(
          orderedRuleSizes,
          safeRuleSize,
        )
        for (let index = 0; index <= entryUpperBoundIndex; index += 1) {
          const entry = orderedEntries[index] ?? null
          if (!entry) continue
          memoLookupEntryScanCount += 1
          memoExactFingerprintScanCount += 1
          if (Number(entry?.startAt ?? Number.POSITIVE_INFINITY) > safeStartAt) continue
          if (!arePerfectPrototypeRowsetsEqual(entry?.negativeRowset, negativeRowset)) continue
          memoHitCount += 1
          memoExactFingerprintFastHitCount += 1
          exactFingerprintHit = true
          break
        }
      } else if (exactFingerprintBucket) {
        memoExactFingerprintFastRejectCount += 1
      }
      memoLookupExactFingerprintScanMs +=
        Number(process.hrtime.bigint() - exactFingerprintStartedAt) / 1_000_000
      if (!exactFingerprintHit) {
        memoLookupFingerprintMissCount += 1
      }
      if (exactFingerprintHit) {
        return true
      }

      const rangeSummaryPrepStartedAt = process.hrtime.bigint()
      if (frontierEntryCount > 0 && bucket.frontierNegativeCounts.length > 0) {
        ensureFrontierRangeSummariesReady(bucket, {
          onCompaction: () => {
            memoFrontierCompactionCount += 1
          },
          onRangeSummaryRebuild: () => {
            memoRangeSummaryRebuildCount += 1
          },
        })
      }
      memoLookupRangeSummaryPrepMs +=
        Number(process.hrtime.bigint() - rangeSummaryPrepStartedAt) / 1_000_000

      const prefixScanStartedAt = process.hrtime.bigint()
      const upperBoundIndex = findFrontierNegativeCountUpperBoundIndex(
        bucket.frontierNegativeCounts,
        nextNegativeCount,
      )
      for (let index = upperBoundIndex; index >= 0; index -= 1) {
        const prefixSummary = bucket.frontierPrefixSummaries[index] ?? null
        if (
          !canFrontierRangeDominateCandidate({
            rangeSummary: prefixSummary,
            startAt: safeStartAt,
            ruleSize: safeRuleSize,
            negativeSummary: nextNegativeSummary,
          })
        ) {
          memoRangeSkipPrefixCount += index + 1
          break
        }
        const safeNegativeCount = Number(bucket.frontierNegativeCounts[index] ?? 0)
        const bucketData = bucket.frontierEntryIdsByNegativeCount.get(safeNegativeCount) ?? null
        if (!bucketData) continue
        if (
          !canFrontierBucketDominateCandidate({
            negativeCount: safeNegativeCount,
            bucketData,
            startAt: safeStartAt,
            ruleSize: safeRuleSize,
            negativeSummary: nextNegativeSummary,
          })
        ) {
          memoFrontierSkippedBucketCount += 1
          continue
        }
        const bucketEntries = Array.isArray(bucketData.entries) ? bucketData.entries : []
        const bucketRuleSizes = Array.isArray(bucketData.orderedRuleSizes)
          ? bucketData.orderedRuleSizes
          : []
        const entryUpperBoundIndex = findOrderedRuleSizeUpperBoundIndex(
          bucketRuleSizes,
          safeRuleSize,
        )
        if (entryUpperBoundIndex < 0) {
          continue
        }
        memoLookupRangeCandidateBucketCount += 1
        for (let entryIndex = 0; entryIndex <= entryUpperBoundIndex; entryIndex += 1) {
          const entry = bucketEntries[entryIndex] ?? null
          if (!entry) continue
          memoLookupEntryScanCount += 1
          memoFrontierScanCount += 1
          if (Number(entry?.startAt ?? Number.POSITIVE_INFINITY) > safeStartAt) continue
          if (!canSubsetByEdgeSummary(entry?.negativeSummary, nextNegativeSummary)) continue
          if (!isPerfectPrototypeRowsetSubset(entry?.negativeRowset, negativeRowset)) continue
          memoHitCount += 1
          dominatedByFrontier = true
          break
        }
        if (dominatedByFrontier) break
      }
      memoLookupPrefixScanMs += Number(process.hrtime.bigint() - prefixScanStartedAt) / 1_000_000
      if (dominatedByFrontier) {
        return true
      }

      let removals = null
      let changedNegativeCounts = null
      let earliestChangedIndex = Number.POSITIVE_INFINITY
      const lowerBoundIndex = findFrontierNegativeCountLowerBoundIndex(
        bucket.frontierNegativeCounts,
        nextNegativeCount,
      )
      const suffixScanStartedAt = process.hrtime.bigint()
      for (let index = lowerBoundIndex; index < bucket.frontierNegativeCounts.length; index += 1) {
        const suffixSummary = bucket.frontierSuffixSummaries[index] ?? null
        if (
          !canCandidateDominateFrontierRange({
            rangeSummary: suffixSummary,
            startAt: safeStartAt,
            ruleSize: safeRuleSize,
            negativeSummary: nextNegativeSummary,
          })
        ) {
          memoRangeSkipSuffixCount += bucket.frontierNegativeCounts.length - index
          break
        }
        const safeNegativeCount = Number(bucket.frontierNegativeCounts[index] ?? 0)
        const bucketData = bucket.frontierEntryIdsByNegativeCount.get(safeNegativeCount) ?? null
        if (!bucketData) continue
        if (
          !canCandidateDominateFrontierBucket({
            bucketData,
            startAt: safeStartAt,
            ruleSize: safeRuleSize,
            negativeSummary: nextNegativeSummary,
          })
        ) {
          memoFrontierSkippedBucketCount += 1
          continue
        }
        const bucketEntries = Array.isArray(bucketData.entries) ? bucketData.entries : []
        const bucketRuleSizes = Array.isArray(bucketData.orderedRuleSizes)
          ? bucketData.orderedRuleSizes
          : []
        const entryStartIndex = findOrderedRuleSizeStrictLowerBoundIndex(
          bucketRuleSizes,
          safeRuleSize,
        )
        if (entryStartIndex >= bucketEntries.length) {
          continue
        }
        memoLookupRangeCandidateBucketCount += 1
        for (let entryIndex = entryStartIndex; entryIndex < bucketEntries.length; entryIndex += 1) {
          const entry = bucketEntries[entryIndex] ?? null
          if (!entry) continue
          memoLookupEntryScanCount += 1
          memoFrontierScanCount += 1
          const existingStartAt = Number(entry?.startAt ?? Number.POSITIVE_INFINITY)
          const existingRuleSize = Number(entry?.ruleSize ?? Number.POSITIVE_INFINITY)
          const dominatedByNext =
            safeStartAt <= existingStartAt &&
            safeRuleSize < existingRuleSize &&
            nextNegativeCount <= Number(entry?.negativeCount ?? Number.POSITIVE_INFINITY) &&
            canSubsetByEdgeSummary(nextNegativeSummary, entry?.negativeSummary) &&
            isPerfectPrototypeRowsetSubset(negativeRowset, entry?.negativeRowset)
          if (!dominatedByNext) continue
          adjustBucketFrontierEstimatedBytes(bucket, -Number(entry?.estimatedBytes ?? 0))
          totalEstimatedBytes = Math.max(
            0,
            totalEstimatedBytes - Number(entry?.estimatedBytes ?? 0),
          )
          frontierPruneCount += 1
          if (!Array.isArray(removals)) {
            removals = []
          }
          removals.push(entry)
        }
      }
      memoLookupSuffixScanMs += Number(process.hrtime.bigint() - suffixScanStartedAt) / 1_000_000
      for (const entry of removals ?? []) {
        removeFrontierFingerprintEntry(bucket.frontierFingerprintIndex, entry)
        if (!(changedNegativeCounts instanceof Set)) {
          changedNegativeCounts = new Set()
        }
        changedNegativeCounts.add(Number(entry?.negativeCount ?? 0))
        const changedIndex = removeFrontierEntryFromNegativeCountIndex(bucket, entry)
        if (Number.isInteger(changedIndex) && changedIndex >= 0) {
          earliestChangedIndex = Math.min(earliestChangedIndex, changedIndex)
        }
        bucket.frontierEntriesById.delete(Number(entry?.entryId))
        memoFrontierDeleteCount += 1
      }
      if (Array.isArray(removals) && removals.length > 0) {
        finalizeFrontierNegativeCountMutations(bucket, {
          changedNegativeCounts,
          earliestChangedIndex,
          onCompaction: () => {
            memoFrontierCompactionCount += 1
          },
        })
      }

      const storedNegativeRowset = clonePerfectPrototypeRowsetOwned(negativeRowset)
      const nextEntry = {
        entryId: nextFrontierEntryId,
        negativeRowset: storedNegativeRowset,
        negativeCount: nextNegativeCount,
        negativeFingerprint: nextNegativeFingerprint,
        negativeSummary: nextNegativeSummary,
        startAt: safeStartAt,
        ruleSize: safeRuleSize,
        estimatedBytes: estimatePerfectPrototypeRowsetBytes(storedNegativeRowset) + 48,
      }
      nextFrontierEntryId += 1
      bucket.frontierEntriesById.set(nextEntry.entryId, nextEntry)
      appendFrontierFingerprintEntry(bucket, nextEntry)
      addFrontierEntryToNegativeCountIndex(bucket, nextEntry, {
        onCompaction: () => {
          memoFrontierCompactionCount += 1
        },
      })
      adjustBucketFrontierEstimatedBytes(bucket, nextEntry.estimatedBytes)
      totalEstimatedBytes += nextEntry.estimatedBytes
      frontierInsertCount += 1
      touchBucket(bucket)
      enforceBudget({ currentBucket: bucket })
      return false
    } finally {
      lookupCount += 1
      lookupMs += Number(process.hrtime.bigint() - startedAt) / 1_000_000
    }
  }

  return {
    isDominated,
    getStats: () => {
      let memoFrontierBucketCount = 0
      let memoFrontierTombstoneCount = 0
      for (const collisionBucket of positiveBucketsByFingerprint.values()) {
        for (const bucket of collisionBucket ?? []) {
          memoFrontierBucketCount += Number(bucket?.frontierNegativeCounts?.length ?? 0)
          for (const bucketData of bucket?.frontierEntryIdsByNegativeCount?.values?.() ?? []) {
            memoFrontierTombstoneCount += Number(bucketData?.tombstoneCount ?? 0)
          }
        }
      }
      return {
        positiveSignatureBucketCount: positiveBucketsByFingerprint.size,
        cacheBytes: totalEstimatedBytes,
        memoHitCount,
        lookupCount,
        memoLookupMs: Number(lookupMs.toFixed(3)),
        frontierInsertCount,
        frontierPruneCount,
        memoFrontierScanCount,
        memoFrontierDeleteCount,
        memoFrontierSkippedBucketCount,
        memoFrontierCompactionCount,
        memoFrontierBucketCount,
        memoFrontierTombstoneCount,
        memoRangeSkipPrefixCount,
        memoRangeSkipSuffixCount,
        memoRangeSummaryRebuildCount,
        memoExactFingerprintFastHitCount,
        memoExactFingerprintFastRejectCount,
        memoExactFingerprintScanCount,
        memoFingerprintMetadataRebuildCount,
        memoFingerprintBucketPeak,
        memoLookupFingerprintMs: Number(memoLookupFingerprintMs.toFixed(3)),
        memoLookupExactFingerprintScanMs: Number(memoLookupExactFingerprintScanMs.toFixed(3)),
        memoLookupRangeSummaryPrepMs: Number(memoLookupRangeSummaryPrepMs.toFixed(3)),
        memoLookupPrefixScanMs: Number(memoLookupPrefixScanMs.toFixed(3)),
        memoLookupSuffixScanMs: Number(memoLookupSuffixScanMs.toFixed(3)),
        memoLookupEntryScanCount,
        memoLookupFingerprintMissCount,
        memoLookupRangeCandidateBucketCount,
        evictedBucketCount,
        evictedFrontierEntryCount,
        oversizeSkipCount,
      }
    },
  }
}
