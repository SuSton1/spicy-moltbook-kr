import { isPerfectPrototypeSupportCompatibleFeatureKey } from "./perfect_prototype_interval_token_bank.mjs"
import { normalizePerfectPrototypeSupportCases } from "./perfect_prototype_support_case.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const uniqueSortedStrings = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const SUPPORT_SIGNATURE_CATEGORICAL_PREFIXES = [
  "tag:event.",
  "tag:xsec.",
  "tag:xsecLane.",
  "tag:lowGapTop.",
  "macro:lowGapTop:",
  "tag:market.",
]

export const filterPerfectPrototypeSupportSignatureCategoricalTokens = (tokens) =>
  uniqueSortedStrings(tokens).filter((token) =>
    SUPPORT_SIGNATURE_CATEGORICAL_PREFIXES.some((prefix) => token.startsWith(prefix)),
  )

const buildSupportRecordsFromCases = ({ familyId = null, supportCases = [] } = {}) => {
  const normalizedFamilyId = toText(familyId)
  return normalizePerfectPrototypeSupportCases(supportCases)
    .filter((entry) => {
      if (!normalizedFamilyId || entry.familyIds.length < 1) return true
      return entry.familyIds.includes(normalizedFamilyId)
    })
    .map((entry) => ({
      caseId: entry.caseId,
      numericFeatureMap: entry.numericFeatureMap ?? {},
      categoricalTokens: filterPerfectPrototypeSupportSignatureCategoricalTokens([
        ...(entry.categoricalTokens ?? []),
        ...(entry.donorTokens ?? []),
      ]),
    }))
    .filter((entry) => Object.keys(entry.numericFeatureMap).length > 0)
}

const buildSupportRecordsFromRows = ({ supportRows = [] } = {}) =>
  (Array.isArray(supportRows) ? supportRows : [])
    .map((entry, index) => ({
      caseId: toText(entry?.caseId) ?? `support_row_${String(index + 1).padStart(2, "0")}`,
      numericFeatureMap:
        entry?.numericFeatureMap && typeof entry.numericFeatureMap === "object"
          ? entry.numericFeatureMap
          : {},
      categoricalTokens: filterPerfectPrototypeSupportSignatureCategoricalTokens(
        entry?.categoricalTokens ?? [],
      ),
    }))
    .filter((entry) => Object.keys(entry.numericFeatureMap).length > 0)

const buildSupportDatasetFromRecords = ({
  familyId = null,
  records = [],
} = {}) => {
  const sumsByFeature = new Map()
  const countsByFeature = new Map()
  const categoricalTokenSet = new Set()
  const supportCaseIds = []
  for (const record of Array.isArray(records) ? records : []) {
    const caseId = toText(record?.caseId)
    if (caseId) supportCaseIds.push(caseId)
    for (const [featureKey, rawValue] of Object.entries(record?.numericFeatureMap ?? {})) {
      const normalizedKey = toText(featureKey)
      const normalizedValue = num(rawValue)
      if (!normalizedKey || !Number.isFinite(normalizedValue)) continue
      if (!isPerfectPrototypeSupportCompatibleFeatureKey(normalizedKey)) continue
      sumsByFeature.set(normalizedKey, Number(sumsByFeature.get(normalizedKey) ?? 0) + normalizedValue)
      countsByFeature.set(normalizedKey, Number(countsByFeature.get(normalizedKey) ?? 0) + 1)
    }
    for (const token of record?.categoricalTokens ?? []) {
      categoricalTokenSet.add(token)
    }
  }
  const prototypeNumericFeatureMap = {}
  for (const [featureKey, total] of sumsByFeature.entries()) {
    const count = Number(countsByFeature.get(featureKey) ?? 0)
    if (count < 1) continue
    prototypeNumericFeatureMap[featureKey] = total / count
  }
  const featureKeys = uniqueSortedStrings(Object.keys(prototypeNumericFeatureMap))
  return {
    familyId: toText(familyId),
    supportCaseIds: uniqueSortedStrings(supportCaseIds),
    featureKeys,
    prototypeNumericFeatureMap,
    categoricalTokens: uniqueSortedStrings(Array.from(categoricalTokenSet)),
    categoricalTokenSet,
  }
}

export const buildPerfectPrototypeSupportManifoldDataset = ({
  familyId = null,
  supportCases = [],
} = {}) =>
  buildSupportDatasetFromRecords({
    familyId,
    records: buildSupportRecordsFromCases({ familyId, supportCases }),
  })

export const buildPerfectPrototypeSupportManifoldDatasetFromRows = ({
  familyId = null,
  supportRows = [],
} = {}) =>
  buildSupportDatasetFromRecords({
    familyId,
    records: buildSupportRecordsFromRows({ supportRows }),
  })
