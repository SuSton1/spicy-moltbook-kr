const uniqueSorted = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const buildDateCount = (rows = [], token) =>
  uniqueSorted(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => Array.isArray(row?.tokens) && row.tokens.includes(token))
      .map((row) => row?.dateKey)
      .filter(Boolean),
  ).length

export const buildTp12TouchVetoCandidates = ({
  selectedTrainRows = [],
  allowedPrefixes = ["tag:"],
  minNegativeHits = 4,
  minNetGain = 1,
} = {}) => {
  const safeRows = Array.isArray(selectedTrainRows) ? selectedTrainRows : []
  const negatives = safeRows.filter((row) => row?.outcomeHitTarget !== true)
  const positives = safeRows.filter((row) => row?.outcomeHitTarget === true)
  const positiveCounts = new Map()
  const negativeCounts = new Map()

  for (const row of positives) {
    for (const token of uniqueSorted(row?.tokens ?? [])) {
      positiveCounts.set(token, toNumber(positiveCounts.get(token), 0) + 1)
    }
  }
  for (const row of negatives) {
    for (const token of uniqueSorted(row?.tokens ?? [])) {
      negativeCounts.set(token, toNumber(negativeCounts.get(token), 0) + 1)
    }
  }

  const prefixList = uniqueSorted(allowedPrefixes)
  const candidates = []
  for (const [token, negativeHits] of negativeCounts.entries()) {
    if (prefixList.length > 0 && !prefixList.some((prefix) => token.startsWith(prefix))) continue
    const positiveHits = toNumber(positiveCounts.get(token), 0)
    const netGain = negativeHits - positiveHits
    if (negativeHits < Number(minNegativeHits)) continue
    if (netGain < Number(minNetGain)) continue
    candidates.push({
      token,
      negativeHits,
      positiveHits,
      netGain,
      negativeDateCount: buildDateCount(negatives, token),
      positiveDateCount: buildDateCount(positives, token),
    })
  }

  candidates.sort((left, right) => {
    if (right.netGain !== left.netGain) return right.netGain - left.netGain
    if (right.negativeHits !== left.negativeHits) return right.negativeHits - left.negativeHits
    if (left.positiveHits !== right.positiveHits) return left.positiveHits - right.positiveHits
    return String(left.token ?? "").localeCompare(String(right.token ?? ""))
  })

  return {
    candidateCount: candidates.length,
    negativeSelectedRowCount: negatives.length,
    positiveSelectedRowCount: positives.length,
    candidates,
  }
}
