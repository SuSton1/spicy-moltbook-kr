import {
  createPerfectPrototypeRowset,
  getPerfectPrototypeRowsetCount,
  intersectPerfectPrototypeRowsetsPrepared,
  materializePerfectPrototypeRowsetValues,
  releasePerfectPrototypeBorrowedRowset,
} from "./perfect_prototype_rowset.mjs"

const EMPTY_ROW_INDEXES = new Uint32Array()

const normalizePositiveInteger = (value) => {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null
}

const normalizeManifestSeedEntries = (manifest) => {
  const bundleTokens = Array.isArray(manifest?.bundleTokens) ? manifest.bundleTokens : []
  const seedIndexes = Array.isArray(manifest?.seedIndexes) ? manifest.seedIndexes : []
  return seedIndexes
    .map((seedIndex, index) => ({
      seedIndex: normalizePositiveInteger(seedIndex),
      token: String(bundleTokens[index] ?? "").trim() || null,
    }))
    .filter((entry) => Number.isInteger(entry.seedIndex) && entry.seedIndex >= 0 && entry.token)
    .sort((left, right) => left.seedIndex - right.seedIndex)
}

const buildEmptyOwnedRowset = ({ rowCount, allowDense = true } = {}) =>
  createPerfectPrototypeRowset({
    values: EMPTY_ROW_INDEXES,
    universeSize: rowCount,
    allowDense,
  })

const cloneRowsetOwned = ({ rowset, rowCount, allowDense = true } = {}) =>
  createPerfectPrototypeRowset({
    values: materializePerfectPrototypeRowsetValues(rowset),
    universeSize: rowCount,
    allowDense,
  })

const buildEntryPreview = ({
  manifest,
  seedEntries,
  reason = null,
  positiveRowIndexes = EMPTY_ROW_INDEXES,
  negativeRowIndexes = EMPTY_ROW_INDEXES,
  positiveHitStats = null,
  effectiveMinHitCount = 1,
  familyScopedMinHitApplied = false,
} = {}) => ({
  subgroupId: manifest?.subgroupId ?? null,
  bundleTokens: seedEntries.map((entry) => entry.token).filter(Boolean),
  seedIndexes: seedEntries.map((entry) => entry.seedIndex).filter((value) => Number.isInteger(value)),
  reason: String(reason ?? "").trim() || null,
  positiveRowCount: ArrayBuffer.isView(positiveRowIndexes)
    ? positiveRowIndexes.length
    : Array.isArray(positiveRowIndexes)
      ? positiveRowIndexes.length
      : 0,
  negativeRowCount: ArrayBuffer.isView(negativeRowIndexes)
    ? negativeRowIndexes.length
    : Array.isArray(negativeRowIndexes)
      ? negativeRowIndexes.length
      : 0,
  matchedDateCount: Number(positiveHitStats?.distinctDateCount ?? 0) || 0,
  matchedMonthCount: Number(positiveHitStats?.matchedMonthCount ?? 0) || 0,
  matchedFoldCount: Number(positiveHitStats?.matchedFoldCount ?? 0) || 0,
  effectiveMinHitCount: Math.max(1, Number(effectiveMinHitCount ?? 1) || 1),
  familyScopedMinHitApplied: familyScopedMinHitApplied === true,
})

const materializePositiveBundleCover = async ({
  seedEntries,
  basePositiveRowset,
  seedPostingCache,
  rowCount,
  allowDense = true,
} = {}) => {
  if (!basePositiveRowset || getPerfectPrototypeRowsetCount(basePositiveRowset) < 1) {
    return { ok: false, reason: "empty_positive_cover" }
  }
  let workingRowset = basePositiveRowset
  let borrowedWorkingRowset = null
  try {
    for (const entry of seedEntries) {
      const positivePostingRowset = await seedPostingCache.getSeedPositiveRowset(entry.seedIndex)
      if (!positivePostingRowset) {
        return { ok: false, reason: "seed_rowset_unmaterialized", token: entry.token }
      }
      if (getPerfectPrototypeRowsetCount(positivePostingRowset) < 1) {
        return { ok: false, reason: "empty_positive_cover", token: entry.token }
      }
      const prepared = intersectPerfectPrototypeRowsetsPrepared({
        leftRowset: workingRowset,
        rightRowset: positivePostingRowset,
        universeSize: rowCount,
        allowDense,
        resultOwnership: "borrowed",
      })
      if (borrowedWorkingRowset && borrowedWorkingRowset !== workingRowset) {
        releasePerfectPrototypeBorrowedRowset(borrowedWorkingRowset)
      }
      workingRowset = prepared.rowset
      borrowedWorkingRowset = prepared.rowset
      if (prepared.count < 1) {
        return { ok: false, reason: "empty_positive_cover", token: entry.token }
      }
    }
    const positiveRowIndexes = materializePerfectPrototypeRowsetValues(workingRowset)
    return {
      ok: true,
      positiveRowIndexes,
      positiveRowset: createPerfectPrototypeRowset({
        values: positiveRowIndexes,
        universeSize: rowCount,
        allowDense,
      }),
    }
  } finally {
    if (borrowedWorkingRowset) {
      releasePerfectPrototypeBorrowedRowset(borrowedWorkingRowset)
    }
  }
}

const materializeNegativeBundleCover = async ({
  seedEntries,
  baseNegativeRowset,
  seedPostingCache,
  rowCount,
  allowDense = true,
} = {}) => {
  if (!baseNegativeRowset || getPerfectPrototypeRowsetCount(baseNegativeRowset) < 1) {
    return {
      negativeRowIndexes: EMPTY_ROW_INDEXES,
      negativeRowset: buildEmptyOwnedRowset({ rowCount, allowDense }),
    }
  }
  let workingRowset = cloneRowsetOwned({
    rowset: baseNegativeRowset,
    rowCount,
    allowDense,
  })
  for (const entry of seedEntries) {
    if (getPerfectPrototypeRowsetCount(workingRowset) < 1) break
    const negativePostingRowset = await seedPostingCache.getSeedNegativeRowset(entry.seedIndex)
    if (!negativePostingRowset || getPerfectPrototypeRowsetCount(negativePostingRowset) < 1) {
      workingRowset = buildEmptyOwnedRowset({ rowCount, allowDense })
      break
    }
    const prepared = intersectPerfectPrototypeRowsetsPrepared({
      leftRowset: workingRowset,
      rightRowset: negativePostingRowset,
      universeSize: rowCount,
      allowDense,
      resultOwnership: "borrowed",
    })
    const nextNegativeRowIndexes =
      prepared.count > 0 ? materializePerfectPrototypeRowsetValues(prepared.rowset) : EMPTY_ROW_INDEXES
    releasePerfectPrototypeBorrowedRowset(prepared.rowset)
    workingRowset = createPerfectPrototypeRowset({
      values: nextNegativeRowIndexes,
      universeSize: rowCount,
      allowDense,
    })
  }
  const negativeRowIndexes = materializePerfectPrototypeRowsetValues(workingRowset)
  return {
    negativeRowIndexes,
    negativeRowset: createPerfectPrototypeRowset({
      values: negativeRowIndexes,
      universeSize: rowCount,
      allowDense,
    }),
  }
}

export const materializePerfectPrototypeSubgroupExactEntryState = async ({
  manifest,
  familyId = null,
  basePositiveRowset,
  baseNegativeRowset,
  seedPostingCache,
  rowCount,
  computePositiveHitStats,
  hitCountMode,
  hitCountDaySymbolCap,
  effectiveMinHitCount = 1,
  familyScopedMinHitApplied = false,
  allowDense = true,
} = {}) => {
  const seedEntries = normalizeManifestSeedEntries(manifest)
  if (seedEntries.length < 1) {
    return {
      ok: false,
      reason: "bundle_seed_invalid",
      preview: buildEntryPreview({
        manifest,
        seedEntries,
        reason: "bundle_seed_invalid",
        effectiveMinHitCount,
        familyScopedMinHitApplied,
      }),
    }
  }
  if (!seedPostingCache || typeof seedPostingCache.getSeedPositiveRowset !== "function") {
    return {
      ok: false,
      reason: "seed_rowset_unmaterialized",
      preview: buildEntryPreview({
        manifest,
        seedEntries,
        reason: "seed_rowset_unmaterialized",
        effectiveMinHitCount,
        familyScopedMinHitApplied,
      }),
    }
  }
  const positiveCover = await materializePositiveBundleCover({
    seedEntries,
    basePositiveRowset,
    seedPostingCache,
    rowCount,
    allowDense,
  })
  if (!positiveCover.ok) {
    return {
      ok: false,
      reason: positiveCover.reason,
      preview: buildEntryPreview({
        manifest,
        seedEntries,
        reason: positiveCover.reason,
        effectiveMinHitCount,
        familyScopedMinHitApplied,
      }),
    }
  }
  const positiveHitStats = computePositiveHitStats({
    rowIndexes: positiveCover.positiveRowIndexes,
    hitCountMode,
    hitCountDaySymbolCap,
  })
  const positiveEffectiveCount = Number(
    positiveHitStats?.cappedCount ?? positiveCover.positiveRowIndexes.length,
  )
  const resolvedEffectiveMinHitCount = Math.max(1, Number(effectiveMinHitCount ?? 1) || 1)
  if (positiveEffectiveCount < resolvedEffectiveMinHitCount) {
    return {
      ok: false,
      reason: "below_effective_min_hit",
      preview: buildEntryPreview({
        manifest,
        seedEntries,
        reason: "below_effective_min_hit",
        positiveRowIndexes: positiveCover.positiveRowIndexes,
        positiveHitStats,
        effectiveMinHitCount: resolvedEffectiveMinHitCount,
        familyScopedMinHitApplied,
      }),
    }
  }
  const negativeCover = await materializeNegativeBundleCover({
    seedEntries,
    baseNegativeRowset,
    seedPostingCache,
    rowCount,
    allowDense,
  })
  const nextStartAt = seedEntries.reduce(
    (maxValue, entry) => Math.max(maxValue, Number(entry.seedIndex ?? -1)),
    -1,
  ) + 1
  return {
    ok: true,
    familyId: String(familyId ?? "").trim() || null,
    entrySeedTokens: seedEntries.map((entry) => entry.token).filter(Boolean),
    entrySeedIndexes: seedEntries.map((entry) => entry.seedIndex),
    positiveRowIndexes: positiveCover.positiveRowIndexes,
    negativeRowIndexes: negativeCover.negativeRowIndexes,
    positiveRowset: positiveCover.positiveRowset,
    negativeRowset: negativeCover.negativeRowset,
    positiveHitStats,
    positiveEffectiveCount,
    negativeCount: getPerfectPrototypeRowsetCount(negativeCover.negativeRowset),
    matchedDateCount: Number(positiveHitStats?.distinctDateCount ?? 0) || 0,
    matchedMonthCount: Number(positiveHitStats?.matchedMonthCount ?? 0) || 0,
    matchedFoldCount: Number(positiveHitStats?.matchedFoldCount ?? 0) || 0,
    entryEffectiveMinHitCount: resolvedEffectiveMinHitCount,
    entryFamilyScopedMinHitApplied: familyScopedMinHitApplied === true,
    nextStartAt: Math.max(0, nextStartAt),
    preview: buildEntryPreview({
      manifest,
      seedEntries,
      reason: null,
      positiveRowIndexes: positiveCover.positiveRowIndexes,
      negativeRowIndexes: negativeCover.negativeRowIndexes,
      positiveHitStats,
      effectiveMinHitCount: resolvedEffectiveMinHitCount,
      familyScopedMinHitApplied,
    }),
  }
}
