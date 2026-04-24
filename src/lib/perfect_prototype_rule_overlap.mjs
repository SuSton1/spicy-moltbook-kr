import { matchPerfectPrototypeRule } from "./perfect_prototype_rule.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const buildPositiveKey = (row) => `${String(row?.dateKey ?? "").trim()}::${String(row?.symbol ?? "").trim()}`

const intersectSets = (left, right) => {
  const smaller = left?.size <= right?.size ? left : right
  const larger = left?.size <= right?.size ? right : left
  let count = 0
  for (const value of smaller ?? []) {
    if (larger?.has(value)) count += 1
  }
  return count
}

export const evaluatePerfectPrototypeRulesOnRows = ({ rows, rules }) => {
  const tokenizedRows = Array.isArray(rows) ? rows : []
  const sourceRules = Array.isArray(rules) ? rules : []
  const accumulators = sourceRules.map((rule) => createPerfectPrototypeRuleEvaluationAccumulator(rule))
  for (const row of tokenizedRows) {
    for (const accumulator of accumulators) {
      updatePerfectPrototypeRuleEvaluationAccumulator(accumulator, row)
    }
  }
  return accumulators.map((accumulator) => finalizePerfectPrototypeRuleEvaluationAccumulator(accumulator))
}

export const createPerfectPrototypeRuleEvaluationAccumulator = (rule) => ({
  ruleId: String(rule?.ruleId ?? "").trim(),
  tokens: Array.isArray(rule?.tokens) ? rule.tokens.slice() : [],
  rule,
  matchCount: 0,
  positiveMatchCount: 0,
  negativeMatchCount: 0,
  positiveKeys: new Set(),
  positiveDates: new Set(),
  positiveSymbols: new Set(),
  matchIds: [],
})

export const updatePerfectPrototypeRuleEvaluationAccumulator = (accumulator, row) => {
  const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(row?.tokens ?? [])
  if (!matchPerfectPrototypeRule(tokenSet, accumulator?.rule)) return false
  accumulator.matchCount += 1
  if (accumulator.matchIds.length < 20 && row?.sourceId) {
    accumulator.matchIds.push(String(row.sourceId))
  }
  if (row?.outcomeHitTarget === true) {
    accumulator.positiveMatchCount += 1
    accumulator.positiveKeys.add(buildPositiveKey(row))
    if (row?.dateKey) accumulator.positiveDates.add(String(row.dateKey))
    if (row?.symbol) accumulator.positiveSymbols.add(String(row.symbol))
  } else if (row?.outcomeHitTarget === false) {
    accumulator.negativeMatchCount += 1
  }
  return true
}

export const finalizePerfectPrototypeRuleEvaluationAccumulator = (accumulator) => ({
  ruleId: accumulator.ruleId,
  tokens: accumulator.tokens.slice(),
  rule: accumulator.rule,
  matchCount: accumulator.matchCount,
  positiveMatchCount: accumulator.positiveMatchCount,
  negativeMatchCount: accumulator.negativeMatchCount,
  precision: accumulator.matchCount > 0 ? accumulator.positiveMatchCount / accumulator.matchCount : 0,
  positiveKeys: accumulator.positiveKeys,
  positiveDates: uniqueSorted(Array.from(accumulator.positiveDates)),
  positiveSymbols: uniqueSorted(Array.from(accumulator.positiveSymbols)),
  sampleMatchIds: uniqueSorted(accumulator.matchIds).slice(0, 20),
})

export const buildPerfectPrototypeRuleOverlapClusters = ({
  evaluations,
  minJaccard = 0.6,
  minSharedPositiveKeys = 2,
}) => {
  const source = (Array.isArray(evaluations) ? evaluations : []).filter(
    (entry) => String(entry?.ruleId ?? "").trim() && (entry?.positiveKeys?.size ?? 0) > 0,
  )
  const adjacency = new Map(source.map((entry) => [entry.ruleId, new Set()]))
  const overlapRows = []

  for (let leftIdx = 0; leftIdx < source.length; leftIdx += 1) {
    const left = source[leftIdx]
    for (let rightIdx = leftIdx + 1; rightIdx < source.length; rightIdx += 1) {
      const right = source[rightIdx]
      const sharedPositiveKeys = intersectSets(left.positiveKeys, right.positiveKeys)
      if (sharedPositiveKeys < Math.max(1, Number(minSharedPositiveKeys) || 1)) continue
      const unionSize = left.positiveKeys.size + right.positiveKeys.size - sharedPositiveKeys
      const jaccard = unionSize > 0 ? sharedPositiveKeys / unionSize : 0
      const overlapCoefficient =
        Math.min(left.positiveKeys.size, right.positiveKeys.size) > 0
          ? sharedPositiveKeys / Math.min(left.positiveKeys.size, right.positiveKeys.size)
          : 0
      overlapRows.push({
        leftRuleId: left.ruleId,
        rightRuleId: right.ruleId,
        sharedPositiveKeys,
        leftPositiveKeys: left.positiveKeys.size,
        rightPositiveKeys: right.positiveKeys.size,
        jaccard,
        overlapCoefficient,
      })
      if (jaccard >= minJaccard || overlapCoefficient >= minJaccard) {
        adjacency.get(left.ruleId)?.add(right.ruleId)
        adjacency.get(right.ruleId)?.add(left.ruleId)
      }
    }
  }

  const lookup = new Map(source.map((entry) => [entry.ruleId, entry]))
  const visited = new Set()
  const clusters = []
  let clusterSeq = 1
  for (const entry of source) {
    if (visited.has(entry.ruleId)) continue
    const queue = [entry.ruleId]
    const memberIds = []
    while (queue.length > 0) {
      const ruleId = queue.shift()
      if (!ruleId || visited.has(ruleId)) continue
      visited.add(ruleId)
      memberIds.push(ruleId)
      for (const nextId of adjacency.get(ruleId) ?? []) {
        if (!visited.has(nextId)) queue.push(nextId)
      }
    }
    const members = memberIds.map((ruleId) => lookup.get(ruleId)).filter(Boolean)
    const positiveKeyUnion = new Set()
    const tokenUnion = new Set()
    for (const member of members) {
      for (const value of member?.positiveKeys ?? []) positiveKeyUnion.add(value)
      for (const token of member?.tokens ?? []) tokenUnion.add(token)
    }
    clusters.push({
      clusterId: `PPO_${String(clusterSeq).padStart(4, "0")}`,
      childRuleIds: uniqueSorted(memberIds),
      childRuleCount: members.length,
      unionPositiveKeys: uniqueSorted(Array.from(positiveKeyUnion)),
      unionPositiveKeyCount: positiveKeyUnion.size,
      tokenUnion: uniqueSorted(Array.from(tokenUnion)),
    })
    clusterSeq += 1
  }

  return {
    overlapRows: overlapRows.sort((left, right) => {
      if (right.sharedPositiveKeys !== left.sharedPositiveKeys) {
        return right.sharedPositiveKeys - left.sharedPositiveKeys
      }
      if (right.jaccard !== left.jaccard) return right.jaccard - left.jaccard
      return String(left.leftRuleId).localeCompare(String(right.leftRuleId))
    }),
    clusters: clusters.sort((left, right) => {
      if (right.unionPositiveKeyCount !== left.unionPositiveKeyCount) {
        return right.unionPositiveKeyCount - left.unionPositiveKeyCount
      }
      if (right.childRuleCount !== left.childRuleCount) return right.childRuleCount - left.childRuleCount
      return String(left.clusterId).localeCompare(String(right.clusterId))
    }),
  }
}
