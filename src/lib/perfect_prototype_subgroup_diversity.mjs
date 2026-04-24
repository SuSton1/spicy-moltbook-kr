const tokenJaccard = (leftTokens, rightTokens) => {
  const left = new Set((Array.isArray(leftTokens) ? leftTokens : []).filter(Boolean))
  const right = new Set((Array.isArray(rightTokens) ? rightTokens : []).filter(Boolean))
  if (left.size < 1 || right.size < 1) return 0
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection += 1
  }
  const union = left.size + right.size - intersection
  return union > 0 ? intersection / union : 0
}

const axisOverlap = (leftAxes, rightAxes) => {
  const left = new Set((Array.isArray(leftAxes) ? leftAxes : []).filter(Boolean))
  const right = new Set((Array.isArray(rightAxes) ? rightAxes : []).filter(Boolean))
  let overlap = 0
  for (const axis of left) {
    if (right.has(axis)) overlap += 1
  }
  return overlap
}

const setJaccard = (leftValues, rightValues) => {
  const left = new Set((Array.isArray(leftValues) ? leftValues : []).filter(Boolean))
  const right = new Set((Array.isArray(rightValues) ? rightValues : []).filter(Boolean))
  if (left.size < 1 || right.size < 1) return 0
  let intersection = 0
  for (const value of left) {
    if (right.has(value)) intersection += 1
  }
  const union = left.size + right.size - intersection
  return union > 0 ? intersection / union : 0
}

const compareManifestQuality = (left, right) => {
  if (Number(right?.subgroupScore ?? Number.NEGATIVE_INFINITY) !== Number(left?.subgroupScore ?? Number.NEGATIVE_INFINITY)) {
    return Number(right?.subgroupScore ?? Number.NEGATIVE_INFINITY) - Number(left?.subgroupScore ?? Number.NEGATIVE_INFINITY)
  }
  if (Number(right?.selectionFrequency ?? Number.NEGATIVE_INFINITY) !== Number(left?.selectionFrequency ?? Number.NEGATIVE_INFINITY)) {
    return Number(right?.selectionFrequency ?? Number.NEGATIVE_INFINITY) - Number(left?.selectionFrequency ?? Number.NEGATIVE_INFINITY)
  }
  if (Number(right?.matchedDateCount ?? 0) !== Number(left?.matchedDateCount ?? 0)) {
    return Number(right?.matchedDateCount ?? 0) - Number(left?.matchedDateCount ?? 0)
  }
  if (Number(right?.matchedMonthCount ?? 0) !== Number(left?.matchedMonthCount ?? 0)) {
    return Number(right?.matchedMonthCount ?? 0) - Number(left?.matchedMonthCount ?? 0)
  }
  if (Number(right?.precision ?? Number.NEGATIVE_INFINITY) !== Number(left?.precision ?? Number.NEGATIVE_INFINITY)) {
    return Number(right?.precision ?? Number.NEGATIVE_INFINITY) - Number(left?.precision ?? Number.NEGATIVE_INFINITY)
  }
  return String(left?.subgroupId ?? "").localeCompare(String(right?.subgroupId ?? ""))
}

export const selectDiversePerfectPrototypeSubgroupManifests = ({
  manifests,
  maxManifests = 6,
  maxTokenJaccard = 0.8,
  maxAxisOverlap = 2,
  maxDateCoverJaccard = 0.9,
} = {}) => {
  const sorted = (Array.isArray(manifests) ? manifests : []).slice().sort(compareManifestQuality)
  const selected = []
  for (const manifest of sorted) {
    if (!manifest) continue
    let blocked = false
    for (const existing of selected) {
      if (tokenJaccard(manifest.bundleTokens, existing.bundleTokens) > maxTokenJaccard) {
        blocked = true
        break
      }
      if (
        axisOverlap(manifest.bundleAxes, existing.bundleAxes) >
        Math.max(0, Number(maxAxisOverlap) || 0)
      ) {
        blocked = true
        break
      }
      if (
        setJaccard(manifest.coverDateKeys, existing.coverDateKeys) >
        Math.max(0, Math.min(1, Number(maxDateCoverJaccard) || 0))
      ) {
        blocked = true
        break
      }
    }
    if (blocked) continue
    selected.push(manifest)
    if (selected.length >= Math.max(1, Number(maxManifests) || 1)) break
  }
  return selected
}
