const normalizeText = (value) => String(value ?? "").trim()

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => normalizeText(value)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const summarizeTopTokens = (rows = [], { limit = 12 } = {}) => {
  const counts = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const token of Array.isArray(row?.categoricalTokens) ? row.categoricalTokens : []) {
      counts.set(token, Number(counts.get(token) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([token, count]) => ({ token, count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      return String(left.token).localeCompare(String(right.token))
    })
    .slice(0, Math.max(1, Number(limit) || 1))
}

export const buildPerfectPrototypeRegimeDonorWitness = ({
  datasetRows = [],
  lineId = null,
} = {}) => {
  const safeRows = Array.isArray(datasetRows) ? datasetRows : []
  const donorRows = safeRows.filter((row) => row?.donorSelected === true)
  const buildBucket = (regimeBucket) => {
    const bucketRows = donorRows.filter((row) => row?.regimeBucket === regimeBucket)
    return {
      donorSelectedRows: bucketRows.length,
      donorDates: uniqueSorted(bucketRows.map((row) => row?.dateKey)).length,
      donorSymbols: uniqueSorted(bucketRows.map((row) => row?.symbol)).length,
      topTokens: summarizeTopTokens(bucketRows),
    }
  }
  const lowSubtypeCounts = {
    low_gap_top_continuation: donorRows.filter((row) => row?.lowSubtypeFamilyIds?.includes("low_gap_top_continuation")).length,
    low_gap_high_continuation: donorRows.filter((row) => row?.lowSubtypeFamilyIds?.includes("low_gap_high_continuation")).length,
    low_jump_below_continuation: donorRows.filter((row) => row?.lowSubtypeFamilyIds?.includes("low_jump_below_continuation")).length,
  }
  return {
    lineId: normalizeText(lineId),
    donorSelectedRows: donorRows.length,
    donorDates: uniqueSorted(donorRows.map((row) => row?.dateKey)).length,
    donorSymbols: uniqueSorted(donorRows.map((row) => row?.symbol)).length,
    lowSubtypeCounts,
    regimes: {
      TOP: buildBucket("TOP"),
      MID: buildBucket("MID"),
      LOW: buildBucket("LOW"),
    },
  }
}
