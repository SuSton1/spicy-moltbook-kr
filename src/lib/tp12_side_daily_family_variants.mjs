const toText = (value) => String(value ?? "").trim()

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

export const TP12_SIDE_DAILY_COMPARISON_VARIANT_MATRIX = Object.freeze({
  daily_only_no_stop: Object.freeze({
    variantId: "daily_only_no_stop",
    datasetIds: Object.freeze([]),
    gateId: "d0_close",
    kind: "control",
  }),
  daily_plus_investor: Object.freeze({
    variantId: "daily_plus_investor",
    datasetIds: Object.freeze(["investor_daily"]),
    gateId: "d0_close",
    kind: "side_daily",
  }),
  daily_plus_program: Object.freeze({
    variantId: "daily_plus_program",
    datasetIds: Object.freeze(["program_daily"]),
    gateId: "d0_close",
    kind: "side_daily",
  }),
  daily_plus_investor_program: Object.freeze({
    variantId: "daily_plus_investor_program",
    datasetIds: Object.freeze(["investor_daily", "program_daily"]),
    gateId: "d0_close",
    kind: "side_daily",
  }),
})

export const resolveTp12SideDailyComparisonVariants = ({
  comparisonOrder = [],
  gateId = "d0_close",
} = {}) => {
  const resolvedGateId = toText(gateId)
  if (!resolvedGateId) {
    throw new Error("gateId is required")
  }
  const orderedIds = Array.isArray(comparisonOrder) ? comparisonOrder.map((value) => toText(value)).filter(Boolean) : []
  if (orderedIds.length < 1) {
    throw new Error("comparisonOrder is required")
  }
  const variants = orderedIds.map((variantId) => {
    const spec = TP12_SIDE_DAILY_COMPARISON_VARIANT_MATRIX[variantId]
    if (!spec) {
      throw new Error(`Unsupported TP12 side-daily comparison variant=${variantId}`)
    }
    return {
      variantId,
      kind: spec.kind,
      gateId: resolvedGateId,
      datasetIds: uniqueSorted(spec.datasetIds),
      datasetIdCsv: uniqueSorted(spec.datasetIds).join(","),
    }
  })
  const seen = new Set()
  for (const variant of variants) {
    if (seen.has(variant.variantId)) {
      throw new Error(`Duplicate comparison variant=${variant.variantId}`)
    }
    seen.add(variant.variantId)
  }
  return variants
}
