import { normalizeDateKey } from "../ai-date-range.lib.mjs"

const toDateKey = (value) => normalizeDateKey(value)

const maxDateKey = (current, candidate) => {
  if (!candidate) {
    return current
  }
  if (!current) {
    return candidate
  }
  return candidate > current ? candidate : current
}

export const filterRowsByAsOf = ({ rows, dateField, asOfDateKey }) => {
  const list = Array.isArray(rows) ? rows : []
  const filtered = []
  let removed = 0
  let maxUsedDateKey = null

  for (const row of list) {
    const dateKey = toDateKey(row?.[dateField])
    if (!dateKey) {
      removed += 1
      continue
    }
    if (asOfDateKey && dateKey > asOfDateKey) {
      removed += 1
      continue
    }
    maxUsedDateKey = maxDateKey(maxUsedDateKey, dateKey)
    filtered.push(row)
  }

  return { rows: filtered, removed, maxUsedDateKey }
}

export const applyAsOfGuard = ({ asOfDateKey, sets }) => {
  const output = {}
  const removedBySet = {}
  let removedTotal = 0
  let maxUsedDateKey = null

  for (const [key, config] of Object.entries(sets ?? {})) {
    const result = filterRowsByAsOf({
      rows: config.rows,
      dateField: config.dateField,
      asOfDateKey,
    })
    output[key] = result.rows
    removedBySet[key] = result.removed
    removedTotal += result.removed
    maxUsedDateKey = maxDateKey(maxUsedDateKey, result.maxUsedDateKey)
  }

  const leakDetected =
    Boolean(asOfDateKey) &&
    (removedTotal > 0 ||
      (maxUsedDateKey ? maxUsedDateKey > asOfDateKey : false))

  return {
    filtered: output,
    removedBySet,
    removedTotal,
    maxUsedDateKey,
    leakDetected,
  }
}
