const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const uniqueSortedStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const emitLeGeTokens = ({ prefix, value, thresholds = [] } = {}) => {
  const resolvedValue = num(value)
  if (!Number.isFinite(resolvedValue)) return []
  const tokens = []
  thresholds.forEach((threshold, index) => {
    const normalizedThreshold = num(threshold)
    if (!Number.isFinite(normalizedThreshold)) return
    const label = `T${String(index + 1).padStart(2, "0")}`
    if (resolvedValue <= normalizedThreshold) {
      tokens.push(`${prefix}:LE_${label}`)
    }
    if (resolvedValue >= normalizedThreshold) {
      tokens.push(`${prefix}:GE_${label}`)
    }
  })
  return tokens
}

export const buildPerfectPrototypeAdaptiveThresholdAtoms = ({
  signatureMetrics = {},
} = {}) => {
  const tokens = []
  const posDistance = num(signatureMetrics?.posDistance)
  const margin = num(signatureMetrics?.margin)
  const agreementShare = num(signatureMetrics?.agreementShare)
  const densityRatio = num(signatureMetrics?.densityRatio)
  const featureCoverage = num(signatureMetrics?.featureCoverage)

  tokens.push(
    ...emitLeGeTokens({
      prefix: "sig:support.posDistance",
      value: posDistance,
      thresholds: [0.35, 0.8, 1.4],
    }),
  )
  tokens.push(
    ...emitLeGeTokens({
      prefix: "sig:support.margin",
      value: margin,
      thresholds: [-0.1, 0.25, 0.75],
    }),
  )
  tokens.push(
    ...emitLeGeTokens({
      prefix: "sig:support.prototypeAgreement",
      value: agreementShare,
      thresholds: [0.25, 0.5, 0.75],
    }),
  )
  tokens.push(
    ...emitLeGeTokens({
      prefix: "sig:support.densityRatio",
      value: densityRatio,
      thresholds: [0.75, 1.5, 2.5],
    }),
  )
  tokens.push(
    ...emitLeGeTokens({
      prefix: "sig:support.featureCoverage",
      value: featureCoverage,
      thresholds: [0.25, 0.5, 0.75],
    }),
  )

  const groupPrefixMap = {
    event: "sig:support.group.eventDistance",
    candle: "sig:support.group.candleDistance",
    gap: "sig:support.group.gapDistance",
    volume: "sig:support.group.volumeDistance",
    trend: "sig:support.group.trendDistance",
    shape: "sig:support.group.shapeDistance",
    market: "sig:support.group.marketDistance",
    xsec: "sig:support.group.xsecDistance",
    sequence: "sig:support.group.sequenceDistance",
  }
  for (const [group, prefix] of Object.entries(groupPrefixMap)) {
    tokens.push(
      ...emitLeGeTokens({
        prefix,
        value: signatureMetrics?.numericFeatureMap?.[`sig.support.group.${group}Distance`],
        thresholds: [0.4, 1.0],
      }),
    )
  }
  return uniqueSortedStrings(tokens)
}
