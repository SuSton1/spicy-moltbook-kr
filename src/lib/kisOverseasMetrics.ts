export const KIS_US_QUOTE_FIELDS = {
  price: "last",
  change: "diff",
  changeRate: "rate",
  volume: "tvol",
  turnover: "tamt",
  marketCap: "tomv",
  base: "base",
} as const

export type OverseasQuoteMetricResult = {
  price: number | null
  change: number | null
  changeRate: number | null
  volume: number | null
  turnover: number | null
  marketCap: number | null
  missingKeys: string[]
}

const parseNumeric = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return null
  }
  const cleaned = String(value).replace(/[$,%]/g, "").replace(/,/g, "").trim()
  if (!cleaned) {
    return null
  }
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

const readNumericField = (output: Record<string, unknown>, key: string) => {
  if (!Object.prototype.hasOwnProperty.call(output, key)) {
    return { value: null, missing: true }
  }
  const value = parseNumeric(output[key])
  if (value === null) {
    return { value: null, missing: true }
  }
  return { value, missing: false }
}

export const normalizeOverseasQuoteMetrics = (
  output: Record<string, unknown> = {},
): OverseasQuoteMetricResult => {
  const missingKeys: string[] = []
  const priceField = readNumericField(output, KIS_US_QUOTE_FIELDS.price)
  const baseField = readNumericField(output, KIS_US_QUOTE_FIELDS.base)
  const changeField = readNumericField(output, KIS_US_QUOTE_FIELDS.change)
  const changeRateField = readNumericField(
    output,
    KIS_US_QUOTE_FIELDS.changeRate,
  )
  const volumeField = readNumericField(output, KIS_US_QUOTE_FIELDS.volume)
  const turnoverField = readNumericField(output, KIS_US_QUOTE_FIELDS.turnover)
  const marketCapField = readNumericField(output, KIS_US_QUOTE_FIELDS.marketCap)

  let change = changeField.value
  if (
    change === null &&
    priceField.value !== null &&
    baseField.value !== null
  ) {
    change = Number((priceField.value - baseField.value).toFixed(4))
  }

  let changeRate = changeRateField.value
  if (
    changeRate === null &&
    change !== null &&
    baseField.value !== null &&
    baseField.value !== 0
  ) {
    changeRate = Number(((change / baseField.value) * 100).toFixed(2))
  }

  if (priceField.missing) {
    missingKeys.push(KIS_US_QUOTE_FIELDS.price)
  }
  if (change === null) {
    missingKeys.push(KIS_US_QUOTE_FIELDS.change)
  }
  if (changeRate === null) {
    missingKeys.push(KIS_US_QUOTE_FIELDS.changeRate)
  }
  if (volumeField.missing) {
    missingKeys.push(KIS_US_QUOTE_FIELDS.volume)
  }
  if (turnoverField.missing) {
    missingKeys.push(KIS_US_QUOTE_FIELDS.turnover)
  }
  if (marketCapField.missing) {
    missingKeys.push(KIS_US_QUOTE_FIELDS.marketCap)
  }

  return {
    price: priceField.value,
    change,
    changeRate,
    volume: volumeField.value,
    turnover: turnoverField.value,
    marketCap: marketCapField.value,
    missingKeys,
  }
}
