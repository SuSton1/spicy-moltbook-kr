export const MARKET_CAP_SCALE = 100_000_000

export const KIS_QUOTE_FIELDS = {
  volume: "acml_vol",
  turnover: "acml_tr_pbmn",
  marketCap: "hts_avls",
}

export type QuoteMetricResult = {
  volume: number | null
  turnover: number | null
  marketCap: number | null
  missingKeys: string[]
}

const parseNumeric = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return null
  }
  const parsed = Number(String(value).replace(/,/g, ""))
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

export const normalizeQuoteMetrics = (
  output: Record<string, unknown> = {},
): QuoteMetricResult => {
  const missingKeys: string[] = []
  const volumeField = readNumericField(output, KIS_QUOTE_FIELDS.volume)
  const turnoverField = readNumericField(output, KIS_QUOTE_FIELDS.turnover)
  const marketCapField = readNumericField(output, KIS_QUOTE_FIELDS.marketCap)

  if (volumeField.missing) {
    missingKeys.push(KIS_QUOTE_FIELDS.volume)
  }
  if (turnoverField.missing) {
    missingKeys.push(KIS_QUOTE_FIELDS.turnover)
  }
  if (marketCapField.missing) {
    missingKeys.push(KIS_QUOTE_FIELDS.marketCap)
  }

  return {
    volume: volumeField.value,
    turnover: turnoverField.value,
    marketCap:
      marketCapField.value === null
        ? null
        : marketCapField.value * MARKET_CAP_SCALE,
    missingKeys,
  }
}
