const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const uniqueStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const buildMonthKey = (dateKey) => {
  const text = toText(dateKey)
  return text && text.length >= 7 ? text.slice(0, 7) : null
}

const groupRowsByDate = (rows = []) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    const bucket = grouped.get(dateKey) ?? []
    bucket.push(row)
    grouped.set(dateKey, bucket)
  }
  return grouped
}

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean))
    .size,
  matchedFoldCount: new Set((rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
})

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
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return filtered[lowerIndex]
  const fraction = position - lowerIndex
  return filtered[lowerIndex] + (filtered[upperIndex] - filtered[lowerIndex]) * fraction
}

const buildQuantileBins = (values = []) => ({
  q25: quantile(values, 0.25),
  q50: quantile(values, 0.5),
  q75: quantile(values, 0.75),
})

const bucketByBins = (value, bins, labels = ["lo", "mid", "hi", "top"]) => {
  const numeric = num(value)
  if (!Number.isFinite(numeric)) return labels[0]
  const q25 = num(bins?.q25)
  const q50 = num(bins?.q50)
  const q75 = num(bins?.q75)
  if (!Number.isFinite(q25) || !Number.isFinite(q50) || !Number.isFinite(q75)) return labels[0]
  if (numeric <= q25) return labels[0]
  if (numeric <= q50) return labels[1]
  if (numeric <= q75) return labels[2]
  return labels[3]
}

const mergeTokenMapEntries = (left = [], right = []) => uniqueStrings([...(left ?? []), ...(right ?? [])])

const mergeRowTokenMaps = (baseMap = new Map(), additionMap = new Map()) => {
  const out = new Map()
  const keys = new Set([...baseMap.keys(), ...additionMap.keys()])
  for (const rowKey of keys) {
    out.set(
      rowKey,
      mergeTokenMapEntries(baseMap.get(rowKey) ?? [], additionMap.get(rowKey) ?? []),
    )
  }
  return out
}

const augmentRowsWithTokenMap = ({ rows = [], rowTokenMapByKey = new Map() } = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => {
    const rowKey = String(row?.rowKey ?? row?.sourceId ?? "").trim()
    const extraTokens = rowTokenMapByKey.get(rowKey) ?? []
    const categoricalTokens = mergeTokenMapEntries(
      row?.categoricalTokens ?? Array.from(row?.tokenSet ?? []),
      extraTokens,
    )
    return {
      ...row,
      categoricalTokens,
      tokenSet: new Set(categoricalTokens),
    }
  })

const augmentFamilyWithTokenMap = ({ family, rowTokenMapByKey = new Map(), summaryPatch = {} } = {}) => ({
  ...family,
  trainRows: augmentRowsWithTokenMap({ rows: family?.trainRows, rowTokenMapByKey }),
  gatedTrainRows: augmentRowsWithTokenMap({ rows: family?.gatedTrainRows, rowTokenMapByKey }),
  oosRows: augmentRowsWithTokenMap({ rows: family?.oosRows, rowTokenMapByKey }),
  supportCaseViews: augmentRowsWithTokenMap({ rows: family?.supportCaseViews, rowTokenMapByKey }),
  bridgePositiveRows: augmentRowsWithTokenMap({ rows: family?.bridgePositiveRows, rowTokenMapByKey }),
  supportNearHardNegativeRows: augmentRowsWithTokenMap({ rows: family?.supportNearHardNegativeRows, rowTokenMapByKey }),
  summary: {
    ...(family?.summary ?? {}),
    ...summaryPatch,
  },
})

export {
  average,
  buildMonthKey,
  buildQuantileBins,
  bucketByBins,
  groupRowsByDate,
  mergeRowTokenMaps,
  num,
  quantile,
  summarizeRows,
  toText,
  uniqueStrings,
  augmentFamilyWithTokenMap,
}
