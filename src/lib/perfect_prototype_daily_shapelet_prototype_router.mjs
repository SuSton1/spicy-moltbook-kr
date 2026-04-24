import { summarizeRows, uniqueStrings } from "./perfect_prototype_daily_symbolic_common.mjs"

const combinations = (values = [], minSize = 2, maxSize = 3) => {
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

const buildCardsForAxes = ({ witnessRows = [], assignmentMapByRowKey = new Map(), axes = [], minCardDateCount = 4, maxCardCount = 5 }) => {
  const grouped = new Map()
  for (const row of witnessRows) {
    const signature = buildRowSignature({ row, assignmentMapByRowKey, axes })
    if (!signature) continue
    const bucket = grouped.get(signature) ?? []
    bucket.push(row)
    grouped.set(signature, bucket)
  }
  return Array.from(grouped.entries())
    .map(([signature, rows], index) => ({
      prototypeCardId: `PC${index + 1}`,
      axes,
      signature,
      witnessRows: rows,
      seedTokens: uniqueStrings(signature.split("|").filter(Boolean)),
      dateKeys: uniqueStrings(rows.map((row) => row?.dateKey).filter(Boolean)),
    }))
    .filter((card) => card.dateKeys.length >= Math.max(1, Math.floor(Number(minCardDateCount) || 4)))
    .sort((left, right) => right.dateKeys.length - left.dateKeys.length || left.signature.localeCompare(right.signature))
    .slice(0, Math.max(1, Math.floor(Number(maxCardCount) || 5)))
    .map((card, index) => ({
      ...card,
      prototypeCardId: `PC${index + 1}`,
    }))
}

const cardPlanScore = ({ cards = [], totalWitnessDates = 0 }) => {
  if (cards.length < 1 || totalWitnessDates < 1) return Number.NEGATIVE_INFINITY
  const maxShare = Math.max(...cards.map((card) => card.dateKeys.length / totalWitnessDates), 0)
  const distinctDateSignatures = new Set(cards.map((card) => card.dateKeys.join(","))).size
  const cardCount = cards.length
  const avgDateCount = cards.reduce((sum, card) => sum + card.dateKeys.length, 0) / Math.max(1, cards.length)
  return distinctDateSignatures * 100 + cardCount * 20 + avgDateCount - maxShare * 200
}

export const buildPerfectPrototypeDailyShapeletPrototypeRouter = ({
  family,
  minCardDateCount = 4,
  maxCardCount = 5,
  maxCardShare = 0.7,
} = {}) => {
  const assignmentMapByRowKey =
    family?.sequenceShapeletAssignmentsByRowKey instanceof Map ? family.sequenceShapeletAssignmentsByRowKey : new Map()
  const witnessRows = Array.isArray(family?.witnessRows) ? family.witnessRows : []
  const totalWitnessDates = new Set(witnessRows.map((row) => row?.dateKey).filter(Boolean)).size
  const axisCounts = new Map()
  for (const row of witnessRows) {
    const assignments = assignmentMapByRowKey.get(String(row?.rowKey ?? "").trim()) ?? {}
    for (const axis of Object.keys(assignments)) {
      axisCounts.set(axis, Number(axisCounts.get(axis) ?? 0) + 1)
    }
  }
  const candidateAxes = Array.from(axisCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([axis]) => axis)
    .slice(0, 6)
  const axisPlans = combinations(candidateAxes, 2, 3)
    .map((axes) => {
      const cards = buildCardsForAxes({
        witnessRows,
        assignmentMapByRowKey,
        axes,
        minCardDateCount,
        maxCardCount,
      })
      return {
        axes,
        cards,
        score: cardPlanScore({ cards, totalWitnessDates }),
      }
    })
    .sort((left, right) => right.score - left.score)
  const bestPlan = axisPlans[0] ?? { axes: [], cards: [], score: Number.NEGATIVE_INFINITY }
  const cards = bestPlan.cards ?? []
  const maxObservedCardShare = totalWitnessDates > 0 ? Math.max(...cards.map((card) => card.dateKeys.length / totalWitnessDates), 0) : 0
  const distinctDateSignatures = new Set(cards.map((card) => card.dateKeys.join(",")))
  const ok = cards.length >= 2 && distinctDateSignatures.size >= 2 && maxObservedCardShare <= Number(maxCardShare)
  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_shapelet_prototype_router",
    prototypeCards: cards,
    summary: {
      ...(family?.summary ?? {}),
      shapeletPrototypeRouterReady: ok,
      prototypeCount: cards.length,
      prototypeDistinctDateSignatureCount: distinctDateSignatures.size,
      maxPrototypeShare: maxObservedCardShare,
      prototypeAxes: bestPlan.axes ?? [],
      prototypePreview: cards.map((card) => ({
        prototypeCardId: card.prototypeCardId,
        axes: card.axes,
        signature: card.signature,
        dateCount: card.dateKeys.length,
        seedTokens: card.seedTokens,
      })),
      prototypeWitnessSummary: summarizeRows((family?.witnessRows ?? []).filter((row) =>
        cards.some((card) => card.dateKeys.includes(String(row?.dateKey ?? "").trim())),
      )),
    },
  }
}
