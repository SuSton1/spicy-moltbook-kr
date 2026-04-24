const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const SUPPLIER_KEYS = [
  "boundaryResidualFeatureKeys",
  "recurrencePurityFeatureKeys",
  "ordinalMotifFeatureKeys",
  "episodeFeatureKeys",
  "epTransitionFeatureKeys",
  "admissionFeatureKeys",
  "roleFeatureKeys",
  "queryFeatureKeys",
  "residualFeatureKeys",
  "outrankFeatureKeys",
  "winnerQueryFeatureKeys",
  "shadowWinnerSlateFeatureKeys",
  "shadowWinnerSlateAuditFeatureKeys",
]

const namespaceOf = (featureKey) => {
  const parts = String(featureKey ?? "").trim().split(".").filter(Boolean)
  return parts.slice(0, Math.min(2, parts.length)).join(".")
}

const collectNamespaceCounts = (featureKeys = []) => {
  const counts = {}
  for (const featureKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const namespace = namespaceOf(featureKey)
    if (!namespace) continue
    counts[namespace] = Number(counts[namespace] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => left[0].localeCompare(right[0])))
}

export const buildPerfectPrototypeSupportFeatureSupplierUnion = ({ family } = {}) => {
  const supplierFeatureKeys = uniqueStrings(
    SUPPLIER_KEYS.flatMap((key) => family?.[key] ?? []).filter((featureKey) => String(featureKey ?? "").startsWith("sig.")),
  )
  const supplierNamespaceCounts = collectNamespaceCounts(supplierFeatureKeys)

  return {
    ...family,
    ok: supplierFeatureKeys.length > 0,
    reason: supplierFeatureKeys.length > 0 ? null : "unsat_no_supplier_union_features",
    supplierFeatureKeys,
    supplierNamespaceCounts,
    summary: {
      ...(family?.summary ?? {}),
      supplierUnionReady: supplierFeatureKeys.length > 0,
      supplierUnionFeatureCount: supplierFeatureKeys.length,
      supplierNamespaceCounts,
    },
  }
}
