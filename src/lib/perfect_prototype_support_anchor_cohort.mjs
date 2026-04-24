import { normalizePerfectPrototypeSupportCases } from "./perfect_prototype_support_case.mjs"

const uniqueSortedStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

export const classifyPerfectPrototypeSupportAtomType = (token) => {
  const normalizedToken = toText(token)
  if (!normalizedToken) return "other"
  if (
    normalizedToken.startsWith("sig:support.") &&
    (normalizedToken.includes(":LE_T") || normalizedToken.includes(":GE_T"))
  ) {
    return "adaptive_threshold"
  }
  if (
    normalizedToken.startsWith("sig:support.") ||
    normalizedToken.startsWith("num:sig.support.")
  ) {
    return "support_signature"
  }
  if (normalizedToken.startsWith("tag:lowGapTop.supportAnchor:")) return "support_anchor"
  if (normalizedToken.startsWith("macro:lowGapTop:")) return "macro"
  if (normalizedToken.startsWith("ival:")) return "interval"
  if (normalizedToken.startsWith("num:")) return "atomic"
  return "other"
}

export const countPerfectPrototypeAtomTypes = (tokens) => {
  const counts = {
    atomic: 0,
    interval: 0,
    macro: 0,
    support_anchor: 0,
    support_signature: 0,
    adaptive_threshold: 0,
    other: 0,
  }
  for (const token of uniqueSortedStrings(tokens)) {
    const atomType = classifyPerfectPrototypeSupportAtomType(token)
    counts[atomType] = Number(counts[atomType] ?? 0) + 1
  }
  return counts
}

export const buildPerfectPrototypeSupportAnchorCohort = ({
  familyId = null,
  supportCases = [],
} = {}) => {
  const normalizedFamilyId = toText(familyId)
  const normalizedSupportCases = normalizePerfectPrototypeSupportCases(supportCases).filter((entry) => {
    if (!normalizedFamilyId || entry.familyIds.length < 1) return true
    return entry.familyIds.includes(normalizedFamilyId)
  })
  const tokenSet = new Set()
  for (const supportCase of normalizedSupportCases) {
    for (const token of supportCase.tokens ?? []) {
      tokenSet.add(token)
    }
  }
  return {
    familyId: normalizedFamilyId,
    supportCaseIds: normalizedSupportCases.map((entry) => entry.caseId),
    tokenSet,
    tokenTypeCounts: countPerfectPrototypeAtomTypes(Array.from(tokenSet)),
  }
}
