import { summarizeRows, uniqueStrings } from "./perfect_prototype_daily_symbolic_common.mjs"

const combinations = (values = [], minSize = 1, maxSize = 2) => {
  const out = []
  const list = Array.isArray(values) ? values : []
  const visit = (start, current) => {
    if (current.length >= minSize && current.length <= maxSize) out.push(current.slice())
    if (current.length >= maxSize) return
    for (let index = start; index < list.length; index += 1) {
      current.push(list[index])
      visit(index + 1, current)
      current.pop()
    }
  }
  visit(0, [])
  return out
}

const buildRowSignature = ({ row, assignmentMapByRowKey, axes }) => {
  const assignments = assignmentMapByRowKey.get(String(row?.rowKey ?? "").trim()) ?? {}
  const tokens = axes.map((axis) => assignments[axis]).filter(Boolean)
  if (tokens.length !== axes.length) return null
  return tokens.join("|")
}

const buildCardsForAxes = ({
  positiveRows = [],
  assignmentMapByRowKey = new Map(),
  axes = [],
  minDateCount = 6,
  maxCardCount = 4,
} = {}) => {
  const grouped = new Map()
  for (const row of positiveRows) {
    const signature = buildRowSignature({ row, assignmentMapByRowKey, axes })
    if (!signature) continue
    const bucket = grouped.get(signature) ?? []
    bucket.push(row)
    grouped.set(signature, bucket)
  }
  return Array.from(grouped.entries())
    .map(([signature, rows], index) => ({
      archetypeId: `SA${index + 1}`,
      axes,
      signature,
      positiveRows: rows,
      seedTokens: uniqueStrings(signature.split("|").filter(Boolean)),
      dateKeys: uniqueStrings(rows.map((row) => row?.dateKey).filter(Boolean)),
    }))
    .filter((card) => card.dateKeys.length >= Math.max(1, Math.floor(Number(minDateCount) || 6)))
    .sort((left, right) => right.dateKeys.length - left.dateKeys.length || left.signature.localeCompare(right.signature))
    .slice(0, Math.max(1, Math.floor(Number(maxCardCount) || 4)))
    .map((card, index) => ({
      ...card,
      archetypeId: `SA${index + 1}`,
    }))
}

const planScore = ({ cards = [], totalPositiveDates = 0 }) => {
  if (cards.length < 1 || totalPositiveDates < 1) return Number.NEGATIVE_INFINITY
  const coveredDates = new Set(cards.flatMap((card) => card.dateKeys)).size
  const maxShare = Math.max(...cards.map((card) => card.dateKeys.length / totalPositiveDates), 0)
  const avgDateCount = cards.reduce((sum, card) => sum + card.dateKeys.length, 0) / Math.max(1, cards.length)
  const distinctDateSignatures = new Set(cards.map((card) => card.dateKeys.join(","))).size
  return coveredDates * 10 + avgDateCount * 2 + cards.length * 5 + distinctDateSignatures * 25 - maxShare * 30
}

export const buildPerfectPrototypeSupportLikeArchetypeRouter = ({
  family,
  minDateCount = 6,
  maxArchetypeCount = 4,
  maxArchetypeShare = 0.85,
} = {}) => {
  const assignmentMapByRowKey =
    family?.sequenceShapeletAssignmentsByRowKey instanceof Map ? family.sequenceShapeletAssignmentsByRowKey : new Map()
  const positiveRows = Array.isArray(family?.detectorPositiveRows) ? family.detectorPositiveRows : []
  const totalPositiveDates = new Set(positiveRows.map((row) => row?.dateKey).filter(Boolean)).size
  const axisCounts = new Map()
  for (const row of positiveRows) {
    const assignments = assignmentMapByRowKey.get(String(row?.rowKey ?? "").trim()) ?? {}
    for (const axis of Object.keys(assignments)) {
      axisCounts.set(axis, Number(axisCounts.get(axis) ?? 0) + 1)
    }
  }
  const candidateAxes = Array.from(axisCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([axis]) => axis)
    .slice(0, 6)
  const plans = combinations(candidateAxes, 1, 2)
    .map((axes) => {
      const cards = buildCardsForAxes({
        positiveRows,
        assignmentMapByRowKey,
        axes,
        minDateCount,
        maxCardCount: maxArchetypeCount,
      })
      return {
        axes,
        cards,
        score: planScore({ cards, totalPositiveDates }),
      }
    })
    .sort((left, right) => right.score - left.score)
  const bestPlan = plans[0] ?? { axes: [], cards: [], score: Number.NEGATIVE_INFINITY }
  const archetypes = bestPlan.cards ?? []
  const maxShare = totalPositiveDates > 0 ? Math.max(...archetypes.map((card) => card.dateKeys.length / totalPositiveDates), 0) : 0
  const distinctDateSignatures = new Set(archetypes.map((card) => card.dateKeys.join(",")))
  const ok = archetypes.length >= 2 && distinctDateSignatures.size >= 2 && maxShare <= Number(maxArchetypeShare ?? 0.85)

  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_support_like_archetype_router",
    supportLikeArchetypes: archetypes,
    summary: {
      ...(family?.summary ?? {}),
      supportLikeArchetypeRouterReady: ok,
      supportLikeArchetypeCount: archetypes.length,
      supportLikeDistinctDateSignatureCount: distinctDateSignatures.size,
      supportLikeMaxArchetypeShare: maxShare,
      supportLikeArchetypeAxes: bestPlan.axes ?? [],
      supportLikeArchetypePreview: archetypes.map((card) => ({
        archetypeId: card.archetypeId,
        axes: card.axes,
        signature: card.signature,
        dateCount: card.dateKeys.length,
        seedTokens: card.seedTokens,
      })),
      supportLikeArchetypePositiveSummary: summarizeRows(
        positiveRows.filter((row) => archetypes.some((card) => card.dateKeys.includes(String(row?.dateKey ?? "").trim()))),
      ),
    },
  }
}
