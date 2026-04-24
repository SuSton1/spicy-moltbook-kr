import { normalizeDateKey } from "./date.mjs"

export const toText = (value) => String(value ?? "").trim()

export const toFiniteNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export const clamp01 = (value) => {
  const numeric = toFiniteNumber(value)
  if (numeric === null) return 0
  if (numeric <= 0) return 0
  if (numeric >= 1) return 1
  return numeric
}

export const uniqueSortedStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

export const uniqueStringsPreserveOrder = (values = []) => {
  const out = []
  const seen = new Set()
  for (const rawValue of Array.isArray(values) ? values : []) {
    const value = toText(rawValue)
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export const uniqueSortedIntegers = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isInteger(value)),
    ),
  ).sort((left, right) => left - right)

export const ensureDateKey = (value, label = "dateKey") => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
}

export const yearKeyFromDateKey = (value, label = "dateKey") => {
  const dateKey = ensureDateKey(value, label)
  return Number.parseInt(dateKey.slice(0, 4), 10)
}

const mergeNumericFeatures = (merged, featureMap, { aliasPrefix = null } = {}) => {
  if (!featureMap || typeof featureMap !== "object" || Array.isArray(featureMap)) return
  for (const [rawKey, rawValue] of Object.entries(featureMap)) {
    const featureKey = toText(rawKey)
    if (!featureKey) continue
    const numeric = toFiniteNumber(rawValue)
    if (numeric === null) continue
    const candidateKeys = aliasPrefix ? [featureKey, `${aliasPrefix}${featureKey}`] : [featureKey]
    for (const candidateKey of candidateKeys) {
      if (Object.prototype.hasOwnProperty.call(merged, candidateKey)) {
        const previous = Number(merged[candidateKey])
        if (Math.abs(previous - numeric) > 1e-12) {
          throw new Error(`Conflicting numeric feature ${candidateKey}: ${previous} vs ${numeric}`)
        }
        continue
      }
      merged[candidateKey] = numeric
    }
  }
}

export const extractNumericFeatureMap = (row) => {
  const merged = {}
  mergeNumericFeatures(merged, row?.numericFeatureMap)
  mergeNumericFeatures(merged, row?.featureVec)
  mergeNumericFeatures(merged, row?.globalFeatureVec)
  mergeNumericFeatures(merged, row?.eventFeatureVec, { aliasPrefix: "event." })
  mergeNumericFeatures(merged, row?.marketContextVec, { aliasPrefix: "market." })
  mergeNumericFeatures(merged, row?.xsecEventVec, { aliasPrefix: "xsec." })
  return merged
}

export const extractTokenSet = (row) =>
  new Set(
    uniqueSortedStrings([
      ...(Array.isArray(row?.tokens) ? row.tokens : []),
      ...(Array.isArray(row?.categoricalTokens) ? row.categoricalTokens : []),
      ...(Array.isArray(row?.contextualTokens) ? row.contextualTokens : []),
      ...(Array.isArray(row?.symbolicTokens) ? row.symbolicTokens : []),
    ]),
  )

export const average = (values = []) => {
  const safe = (Array.isArray(values) ? values : []).map((value) => toFiniteNumber(value)).filter((value) => value !== null)
  if (safe.length < 1) return null
  return safe.reduce((sum, value) => sum + value, 0) / safe.length
}

export const safeRatio = (numerator, denominator) => {
  const num = toFiniteNumber(numerator)
  const den = toFiniteNumber(denominator)
  if (num === null || den === null || den === 0) return null
  return num / den
}

export const buildTechniqueBankId = ({ mechanismId, scopeId, lookbackCandidateId } = {}) => {
  const mechanism = toText(mechanismId)
  const scope = toText(scopeId)
  const lookback = toText(lookbackCandidateId)
  if (!mechanism || !scope || !lookback) {
    throw new Error(`buildTechniqueBankId requires mechanismId/scopeId/lookbackCandidateId`)
  }
  return `${mechanism}__${scope}__${lookback}`
}

export const parseTechniqueBankId = (value) => {
  const bankId = toText(value)
  const [mechanismId, scopeId, lookbackCandidateId, ...rest] = bankId.split("__")
  if (!mechanismId || !scopeId || !lookbackCandidateId || rest.length > 0) {
    throw new Error(`Invalid technique bank id: ${value ?? "<null>"}`)
  }
  return {
    bankId,
    mechanismId,
    scopeId,
    lookbackCandidateId,
  }
}
