import {
  augmentFamilyWithTokenMap,
  groupRowsByDate,
  mergeRowTokenMaps,
  num,
  uniqueStrings,
} from "./perfect_prototype_daily_symbolic_common.mjs"

const rankRowsDescending = (rows = [], featureKey) =>
  rows
    .map((row) => ({ row, value: num(row?.numericFeatureMap?.[featureKey]) ?? -Infinity }))
    .sort(
      (left, right) =>
        right.value - left.value ||
        String(left?.row?.rowKey ?? "").localeCompare(String(right?.row?.rowKey ?? "")),
    )

const buildDateContrastTokens = (rows = []) => {
  const rarityRank = rankRowsDescending(rows, "sig.slateJoint.jointRarity")
  const dominanceRank = rankRowsDescending(rows, "sig.slateJoint.dominanceShare")
  const sponsorRank = rankRowsDescending(rows, "sig.sponsor.upStrength")
  const releaseRank = rankRowsDescending(rows, "sig.stateTrans.releaseQuality")
  const rowTokenMap = new Map()
  for (let index = 0; index < rows.length; index += 1) {
    const rowKey = String(rows[index]?.rowKey ?? "").trim()
    if (!rowKey) continue
    const tokens = []
    const rarityPos = rarityRank.findIndex((entry) => entry?.row?.rowKey === rowKey)
    const dominancePos = dominanceRank.findIndex((entry) => entry?.row?.rowKey === rowKey)
    const sponsorPos = sponsorRank.findIndex((entry) => entry?.row?.rowKey === rowKey)
    const releasePos = releaseRank.findIndex((entry) => entry?.row?.rowKey === rowKey)
    if (rarityPos === 0) tokens.push("sig.slateSymbolicContrast.peer_uniqueness_top")
    else if (rarityPos <= 1) tokens.push("sig.slateSymbolicContrast.peer_uniqueness_high")
    else tokens.push("sig.slateSymbolicContrast.peer_uniqueness_low")
    if (dominancePos === 0 && sponsorPos <= 1) tokens.push("sig.slateSymbolicContrast.dominates_3_axes")
    if (releasePos === 0 && rarityPos === 0) tokens.push("sig.slateSymbolicContrast.joint_shape_rare")
    if (sponsorPos === 0) tokens.push("sig.slateSymbolicContrast.sponsor_rank_top")
    if (releasePos === 0) tokens.push("sig.slateSymbolicContrast.release_rank_top")
    rowTokenMap.set(rowKey, uniqueStrings(tokens))
  }
  return rowTokenMap
}

export const buildPerfectPrototypeDailySymbolicSlateContrast = ({ family } = {}) => {
  const byDate = groupRowsByDate(family?.gatedTrainRows ?? [])
  const additionalTokenMap = new Map()
  for (const rows of byDate.values()) {
    const dateTokenMap = buildDateContrastTokens(rows)
    for (const [rowKey, tokens] of dateTokenMap.entries()) {
      additionalTokenMap.set(rowKey, tokens)
    }
  }
  for (const row of [...(family?.oosRows ?? []), ...(family?.supportCaseViews ?? [])]) {
    const rowKey = String(row?.rowKey ?? row?.sourceId ?? "").trim()
    if (!rowKey || additionalTokenMap.has(rowKey)) continue
    additionalTokenMap.set(rowKey, [])
  }
  const mergedTokenMap = mergeRowTokenMaps(
    family?.symbolicGlyphTokenMapByKey ?? new Map(),
    additionalTokenMap,
  )
  return augmentFamilyWithTokenMap({
    family: {
      ...family,
      symbolicGlyphTokenMapByKey: mergedTokenMap,
      symbolicSlateContrastTokenMapByKey: additionalTokenMap,
    },
    rowTokenMapByKey: mergedTokenMap,
    summaryPatch: {
      symbolicSlateContrastReady: additionalTokenMap.size > 0,
      symbolicSlateContrastTokenCount: uniqueStrings(
        Array.from(additionalTokenMap.values()).flatMap((tokens) => tokens),
      ).length,
    },
  })
}
