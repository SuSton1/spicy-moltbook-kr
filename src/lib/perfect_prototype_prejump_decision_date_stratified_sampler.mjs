const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const buildMonthKey = (dateKey) => {
  const text = toText(dateKey)
  return text && text.length >= 7 ? text.slice(0, 7) : null
}

const toPositiveInteger = (value, fallback = null) => {
  const numeric = Math.floor(Number(value))
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback
}

const buildCenterOutIndices = (count) => {
  const size = toPositiveInteger(count, 0) ?? 0
  if (size < 1) return []
  const center = (size - 1) / 2
  return Array.from({ length: size }, (_, index) => index).sort((left, right) => {
    const leftDistance = Math.abs(left - center)
    const rightDistance = Math.abs(right - center)
    if (leftDistance !== rightDistance) return leftDistance - rightDistance
    return left - right
  })
}

const pickEvenlySpacedItems = (items = [], count) => {
  const safeItems = Array.isArray(items) ? items : []
  const targetCount = toPositiveInteger(count, null)
  if (!targetCount || safeItems.length <= targetCount) return safeItems.slice()
  if (targetCount === 1) return [safeItems[Math.floor((safeItems.length - 1) / 2)]]
  const selectedIndexes = new Set()
  for (let index = 0; index < targetCount; index += 1) {
    const rawPosition = Math.round((index * (safeItems.length - 1)) / (targetCount - 1))
    selectedIndexes.add(Math.max(0, Math.min(safeItems.length - 1, rawPosition)))
  }
  if (selectedIndexes.size < targetCount) {
    for (let index = 0; index < safeItems.length && selectedIndexes.size < targetCount; index += 1) {
      selectedIndexes.add(index)
    }
  }
  return Array.from(selectedIndexes.values())
    .sort((left, right) => left - right)
    .slice(0, targetCount)
    .map((index) => safeItems[index])
}

const buildCoverage = (dateKeys = []) => {
  const sorted = uniqueStrings(dateKeys)
  return {
    from: sorted[0] ?? null,
    to: sorted[sorted.length - 1] ?? null,
    count: sorted.length,
  }
}

export const selectPerfectPrototypePrejumpDecisionDateStratifiedPartitions = ({
  partitions = [],
  maxDecisionDates = null,
  samplingMode = "decision_date_stratified",
} = {}) => {
  const safePartitions = (Array.isArray(partitions) ? partitions : [])
    .filter((partition) => toText(partition?.dateKey))
    .map((partition) => ({
      ...partition,
      dateKey: toText(partition?.dateKey),
    }))
    .sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey)))
  const resolvedMaxDecisionDates = toPositiveInteger(maxDecisionDates, null)
  if (!resolvedMaxDecisionDates || safePartitions.length <= resolvedMaxDecisionDates) {
    const dateKeys = safePartitions.map((partition) => partition.dateKey)
    return {
      selectedPartitions: safePartitions,
      samplingApplied: false,
      samplingMode: "full_range",
      sourceDecisionDateCount: safePartitions.length,
      selectedDecisionDateCount: safePartitions.length,
      selectedDecisionMonthCount: uniqueStrings(dateKeys.map((dateKey) => buildMonthKey(dateKey))).length,
      selectedDecisionCoverage: buildCoverage(dateKeys),
    }
  }

  const normalizedSamplingMode = String(samplingMode ?? "decision_date_stratified").trim().toLowerCase()
  if (normalizedSamplingMode !== "decision_date_stratified") {
    throw new Error(`Unsupported prejump decision-date sampling mode: ${normalizedSamplingMode}`)
  }

  const monthGroups = new Map()
  for (const partition of safePartitions) {
    const monthKey = buildMonthKey(partition.dateKey)
    const bucket = monthGroups.get(monthKey) ?? []
    bucket.push(partition)
    monthGroups.set(monthKey, bucket)
  }
  const monthKeys = uniqueStrings(Array.from(monthGroups.keys()).filter(Boolean))
  const selectedDateKeys = new Set()

  const chooseNextFromMonth = (monthKey, usedCountByMonth) => {
    const group = monthGroups.get(monthKey) ?? []
    const order = buildCenterOutIndices(group.length)
    const usedCount = Number(usedCountByMonth.get(monthKey) ?? 0)
    const nextIndex = order[usedCount]
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= group.length) return null
    usedCountByMonth.set(monthKey, usedCount + 1)
    return group[nextIndex]
  }

  if (monthKeys.length >= resolvedMaxDecisionDates) {
    const chosenMonths = pickEvenlySpacedItems(monthKeys, resolvedMaxDecisionDates)
    for (const monthKey of chosenMonths) {
      const group = monthGroups.get(monthKey) ?? []
      const centerIndex = buildCenterOutIndices(group.length)[0]
      const selected = group[centerIndex]
      if (selected?.dateKey) selectedDateKeys.add(selected.dateKey)
    }
  } else {
    const usedCountByMonth = new Map()
    for (const monthKey of monthKeys) {
      const selected = chooseNextFromMonth(monthKey, usedCountByMonth)
      if (selected?.dateKey) selectedDateKeys.add(selected.dateKey)
    }
    let remainingBudget = Math.max(0, resolvedMaxDecisionDates - selectedDateKeys.size)
    while (remainingBudget > 0) {
      let advanced = false
      for (const monthKey of monthKeys) {
        if (remainingBudget < 1) break
        const selected = chooseNextFromMonth(monthKey, usedCountByMonth)
        if (!selected?.dateKey || selectedDateKeys.has(selected.dateKey)) continue
        selectedDateKeys.add(selected.dateKey)
        remainingBudget -= 1
        advanced = true
      }
      if (!advanced) break
    }
  }

  const selectedPartitions = safePartitions.filter((partition) => selectedDateKeys.has(partition.dateKey))
  const selectedDateKeysOrdered = selectedPartitions.map((partition) => partition.dateKey)
  return {
    selectedPartitions,
    samplingApplied: true,
    samplingMode: normalizedSamplingMode,
    sourceDecisionDateCount: safePartitions.length,
    selectedDecisionDateCount: selectedPartitions.length,
    selectedDecisionMonthCount: uniqueStrings(selectedDateKeysOrdered.map((dateKey) => buildMonthKey(dateKey))).length,
    selectedDecisionCoverage: buildCoverage(selectedDateKeysOrdered),
  }
}
