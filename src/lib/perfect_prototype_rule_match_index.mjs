import { rankPerfectPrototypeRules, matchPerfectPrototypeRule } from "./perfect_prototype_rule.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

export const buildPerfectPrototypeRuleMatchIndex = ({ rules }) => {
  const rankedRules = rankPerfectPrototypeRules(Array.isArray(rules) ? rules : [])
  const tokenRuleFrequency = new Map()
  for (const rule of rankedRules) {
    for (const token of uniqueSorted(rule?.tokens)) {
      tokenRuleFrequency.set(token, Number(tokenRuleFrequency.get(token) ?? 0) + 1)
    }
  }
  const sortedTokens = Array.from(tokenRuleFrequency.keys()).sort((left, right) => left.localeCompare(right))
  const tokenIdByToken = new Map(sortedTokens.map((token, index) => [token, index]))
  const anchorRuleIdsByTokenId = new Map()
  const ruleById = new Map()
  for (const rule of rankedRules) {
    const normalizedTokens = uniqueSorted(rule?.tokens)
    if (normalizedTokens.length < 1) continue
    const anchorToken = normalizedTokens
      .slice()
      .sort((left, right) => {
        const leftFreq = Number(tokenRuleFrequency.get(left) ?? Number.MAX_SAFE_INTEGER)
        const rightFreq = Number(tokenRuleFrequency.get(right) ?? Number.MAX_SAFE_INTEGER)
        if (leftFreq !== rightFreq) return leftFreq - rightFreq
        return left.localeCompare(right)
      })[0]
    const anchorTokenId = tokenIdByToken.get(anchorToken)
    if (!Number.isInteger(anchorTokenId)) {
      throw new Error(`Missing token-id mapping for rule anchor token=${anchorToken}`)
    }
    const bucket = anchorRuleIdsByTokenId.get(anchorTokenId) ?? []
    bucket.push(rule.ruleId)
    anchorRuleIdsByTokenId.set(anchorTokenId, bucket)
    ruleById.set(rule.ruleId, rule)
  }
  return {
    rankedRules,
    tokenIdByToken,
    anchorRuleIdsByTokenId,
    ruleById,
  }
}

export const selectPerfectPrototypeCandidateRules = ({ tokenSet, matchIndex }) => {
  const safeTokenSet =
    tokenSet instanceof Set ? tokenSet : new Set(Array.isArray(tokenSet) ? tokenSet : [])
  const tokenIds = new Set()
  for (const token of safeTokenSet) {
    const tokenId = matchIndex?.tokenIdByToken?.get(String(token ?? "").trim())
    if (Number.isInteger(tokenId)) {
      tokenIds.add(tokenId)
    }
  }
  const seenRuleIds = new Set()
  const candidates = []
  for (const tokenId of tokenIds) {
    const bucket = matchIndex?.anchorRuleIdsByTokenId?.get(tokenId) ?? []
    for (const ruleId of bucket) {
      if (seenRuleIds.has(ruleId)) continue
      const rule = matchIndex?.ruleById?.get(ruleId)
      if (!rule) continue
      seenRuleIds.add(ruleId)
      candidates.push(rule)
    }
  }
  return candidates
}

export const matchPerfectPrototypeRulesWithIndex = ({ tokenSet, matchIndex }) =>
  selectPerfectPrototypeCandidateRules({ tokenSet, matchIndex }).filter((rule) =>
    matchPerfectPrototypeRule(tokenSet, rule),
  )
