const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueRowsByKey = (rows = []) => {
  const seen = new Set()
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowKey = String(row?.rowKey ?? "").trim()
    if (!rowKey || seen.has(rowKey)) continue
    seen.add(rowKey)
    out.push(row)
  }
  return out
}

const buildCoverageNovelty = ({ row, seenDates, seenMonths, seenFolds } = {}) => {
  let score = 0
  if (row?.dateKey && !seenDates.has(row.dateKey)) score += 1
  if (row?.monthKey && !seenMonths.has(row.monthKey)) score += 1
  const foldId = Number(row?.foldId ?? 0)
  if (foldId > 0 && !seenFolds.has(foldId)) score += 1
  return score
}

const seedScore = (row) =>
  Math.max(0, Number(num(row?.numericFeatureMap?.["sig.ordinalMotif.supportRecoveryPotential"]) ?? 0)) +
  Math.max(0, Number(num(row?.numericFeatureMap?.["sig.ordinalMotif.recurrenceBreadthCarry"]) ?? 0)) +
  Math.max(0, Number(num(row?.numericFeatureMap?.["sig.recurBoundary.localBreadthPurityGap"]) ?? 0)) +
  Math.max(0, Number(num(row?.numericFeatureMap?.["sig.recurBoundary.localRecoveryMargin"]) ?? 0)) +
  Math.max(0, Number(num(row?.numericFeatureMap?.["sig.bridge.posNegMargin"]) ?? 0)) -
  Math.max(0, Number(num(row?.numericFeatureMap?.["sig.ordinalMotif.recurrenceLeakPressure"]) ?? 0)) -
  Math.max(0, Number(num(row?.numericFeatureMap?.["sig.boundary.falsePositivePressure"]) ?? 0))

export const buildPerfectPrototypeSupportCorridorSeedCover = ({
  family,
  maxSeedsPerBasin = 3,
} = {}) => {
  const basins = Array.isArray(family?.corridorPositiveBasins) ? family.corridorPositiveBasins : []
  const eligibleBasins = basins.filter((basin) => basin?.eligible === true)
  if (eligibleBasins.length < 1) {
    return {
      ...family,
      ok: false,
      reason: "unsat_no_corridor_positive_seed_cover",
      graphPositiveSeedRows: [],
      graphPositiveReferenceRows: [],
      summary: {
        ...(family?.summary ?? {}),
        corridorSeedCoverReady: false,
        corridorSeedCoverReason: "unsat_no_corridor_positive_seed_cover",
        corridorPositiveSeedCount: 0,
      },
    }
  }

  const seenDates = new Set()
  const seenMonths = new Set()
  const seenFolds = new Set()
  const selectedSeeds = []
  for (const basin of eligibleBasins) {
    const ranked = (Array.isArray(basin?.rows) ? basin.rows : [])
      .map((row) => ({
        row,
        score: seedScore(row),
      }))
      .sort(
        (left, right) =>
          (buildCoverageNovelty({ row: right.row, seenDates, seenMonths, seenFolds }) + right.score) -
            (buildCoverageNovelty({ row: left.row, seenDates, seenMonths, seenFolds }) + left.score) ||
          String(left?.row?.rowKey ?? "").localeCompare(String(right?.row?.rowKey ?? "")),
      )
    let picked = 0
    for (const entry of ranked) {
      if (picked >= Math.max(1, Math.floor(Number(maxSeedsPerBasin) || 3))) break
      const novelty = buildCoverageNovelty({ row: entry.row, seenDates, seenMonths, seenFolds })
      if (picked > 0 && novelty < 1 && entry.score <= 0) continue
      selectedSeeds.push(entry.row)
      if (entry.row?.dateKey) seenDates.add(entry.row.dateKey)
      if (entry.row?.monthKey) seenMonths.add(entry.row.monthKey)
      const foldId = Number(entry.row?.foldId ?? 0)
      if (foldId > 0) seenFolds.add(foldId)
      picked += 1
    }
  }

  const graphPositiveSeedRows = uniqueRowsByKey(selectedSeeds)
  const graphPositiveReferenceRows = uniqueRowsByKey(
    eligibleBasins.flatMap((basin) => basin?.rows ?? []),
  )

  return {
    ...family,
    ok: graphPositiveSeedRows.length > 0,
    reason: graphPositiveSeedRows.length > 0 ? null : "unsat_no_corridor_positive_seed_cover",
    graphPositiveSeedRows,
    graphPositiveReferenceRows,
    summary: {
      ...(family?.summary ?? {}),
      corridorSeedCoverReady: graphPositiveSeedRows.length > 0,
      corridorSeedCoverReason: graphPositiveSeedRows.length > 0 ? null : "unsat_no_corridor_positive_seed_cover",
      corridorPositiveSeedCount: graphPositiveSeedRows.length,
      corridorPositiveSeedDateCount: seenDates.size,
      corridorPositiveSeedMonthCount: seenMonths.size,
      corridorPositiveSeedFoldCount: seenFolds.size,
    },
  }
}
