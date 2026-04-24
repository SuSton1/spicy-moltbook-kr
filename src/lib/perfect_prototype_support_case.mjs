import { matchPerfectPrototypeRule } from "./perfect_prototype_rule.mjs"

export const PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID = "076610:2026-03-18"
export const PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID =
  "haesung_low_gap_top_oos100_v1"

const uniqueSorted = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const toFiniteNumberMap = (value) => {
  const out = {}
  if (!value || typeof value !== "object") return out
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = toText(key)
    const normalizedValue = Number(raw)
    if (!normalizedKey || !Number.isFinite(normalizedValue)) continue
    out[normalizedKey] = normalizedValue
  }
  return out
}

export const buildPerfectPrototypeSupportCaseId = ({ symbol, dateKey }) => {
  const normalizedSymbol = toText(symbol)
  const normalizedDateKey = toText(dateKey)
  return normalizedSymbol && normalizedDateKey
    ? `${normalizedSymbol}:${normalizedDateKey}`
    : null
}

const parseSupportCaseId = (value) => {
  const text = toText(value)
  if (!text) return { caseId: null, symbol: null, dateKey: null }
  const [symbolRaw, dateKeyRaw] = text.split(":")
  const symbol = toText(symbolRaw)
  const dateKey = toText(dateKeyRaw)
  return {
    caseId: symbol && dateKey ? `${symbol}:${dateKey}` : null,
    symbol,
    dateKey,
  }
}

export const normalizePerfectPrototypeSupportCases = (values) => {
  const normalized = []
  for (const entry of Array.isArray(values) ? values : []) {
    if (!entry || typeof entry !== "object") continue
    const parsedCaseId = parseSupportCaseId(entry.caseId)
    const symbol = toText(entry.symbol) ?? parsedCaseId.symbol
    const dateKey = toText(entry.dateKey) ?? parsedCaseId.dateKey
    const caseId =
      buildPerfectPrototypeSupportCaseId({
        symbol,
        dateKey,
      }) ?? parsedCaseId.caseId
    const familyIds = uniqueSorted(entry.familyIds)
    const tokens = uniqueSorted(entry.tokens)
    const categoricalTokens = uniqueSorted(entry.categoricalTokens)
    const donorRuleIds = uniqueSorted(entry.donorRuleIds)
    const donorTokens = uniqueSorted(entry.donorTokens)
    const numericFeatureMap = toFiniteNumberMap(entry.numericFeatureMap)
    const supportSignatureFeatureKeys = uniqueSorted(entry.supportSignatureFeatureKeys)
    if (!caseId || !symbol || !dateKey) {
      throw new Error(`Invalid perfect prototype support case: ${JSON.stringify(entry)}`)
    }
    if (tokens.length < 1) {
      throw new Error(`Perfect prototype support case must include non-empty tokens: ${caseId}`)
    }
    normalized.push({
      caseId,
      symbol,
      dateKey,
      familyIds,
      tokens,
      categoricalTokens,
      donorRuleIds,
      donorTokens,
      numericFeatureMap,
      supportSignatureFeatureKeys,
      note: toText(entry.note),
    })
  }
  const deduped = new Map()
  for (const entry of normalized) {
    deduped.set(entry.caseId, entry)
  }
  return uniqueSorted(Array.from(deduped.keys())).map((caseId) => deduped.get(caseId))
}

export const buildPerfectPrototypeSupportCaseIds = (supportCases) =>
  normalizePerfectPrototypeSupportCases(supportCases).map((entry) => entry.caseId)

export const buildPerfectPrototypeSupportCaseFamilyLookup = (supportCases) => {
  const normalizedCases = normalizePerfectPrototypeSupportCases(supportCases)
  const lookup = new Map()
  for (const supportCase of normalizedCases) {
    const targetFamilyIds =
      supportCase.familyIds.length > 0 ? supportCase.familyIds : ["*"]
    for (const familyId of targetFamilyIds) {
      const bucket = lookup.get(familyId) ?? {
        caseIds: new Set(),
        tokenSet: new Set(),
        donorRuleIds: new Set(),
        donorTokenSet: new Set(),
      }
      bucket.caseIds.add(supportCase.caseId)
      for (const token of supportCase.tokens) {
        bucket.tokenSet.add(token)
      }
      for (const donorRuleId of supportCase.donorRuleIds) {
        bucket.donorRuleIds.add(donorRuleId)
      }
      for (const token of supportCase.donorTokens) {
        bucket.donorTokenSet.add(token)
      }
      lookup.set(familyId, bucket)
    }
  }
  return lookup
}

export const evaluatePerfectPrototypeRuleSupportCases = ({
  rule,
  supportCases,
}) => {
  const normalizedCases = normalizePerfectPrototypeSupportCases(supportCases)
  const ruleFamilyId = toText(rule?.familyId)
  const matchingCaseIds = normalizedCases
    .filter((supportCase) => {
      if (supportCase.familyIds.length > 0 && ruleFamilyId) {
        return supportCase.familyIds.includes(ruleFamilyId)
      }
      return supportCase.familyIds.length < 1 || !ruleFamilyId
    })
    .filter((supportCase) => matchPerfectPrototypeRule(supportCase.tokens, rule))
    .map((supportCase) => supportCase.caseId)
  const uniqueCaseIds = uniqueSorted(matchingCaseIds)
  return {
    matchesSupportCases: uniqueCaseIds.length > 0,
    supportCaseIds: uniqueCaseIds,
    supportCaseCount: uniqueCaseIds.length,
    haesungSupport: uniqueCaseIds.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID),
  }
}
