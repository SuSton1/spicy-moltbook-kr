import { GROUPS } from "./similarity.mjs"

const appendUniqueKeys = (target, seen, list) => {
  for (const rawKey of list ?? []) {
    const key = String(rawKey ?? "").trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    target.push(key)
  }
}

const buildIndexByKey = (keys) =>
  Object.fromEntries((keys ?? []).map((key, idx) => [String(key), idx]))

export const buildCandidateSchema = ({
  runtimeMeta = null,
  featureStats = null,
  globalFeatureStats = null
} = {}) => {
  const featureKeys = []
  const seenFeatureKeys = new Set()
  const groupedFeatureKeys = runtimeMeta?.groupFeatureKeys
  if (groupedFeatureKeys && typeof groupedFeatureKeys === "object") {
    for (const group of GROUPS) {
      appendUniqueKeys(featureKeys, seenFeatureKeys, groupedFeatureKeys?.[group])
    }
  }
  if (!featureKeys.length) {
    appendUniqueKeys(
      featureKeys,
      seenFeatureKeys,
      Object.keys(featureStats ?? {}).sort((a, b) => a.localeCompare(b)),
    )
  }

  const globalFeatureKeys = []
  const seenGlobalFeatureKeys = new Set()
  appendUniqueKeys(globalFeatureKeys, seenGlobalFeatureKeys, runtimeMeta?.globalFeatureKeys)
  if (!globalFeatureKeys.length) {
    appendUniqueKeys(
      globalFeatureKeys,
      seenGlobalFeatureKeys,
      Object.keys(globalFeatureStats ?? {}).sort((a, b) => a.localeCompare(b)),
    )
  }

  return {
    featureKeys,
    featureIndexByKey: buildIndexByKey(featureKeys),
    globalFeatureKeys,
    globalFeatureIndexByKey: buildIndexByKey(globalFeatureKeys)
  }
}
