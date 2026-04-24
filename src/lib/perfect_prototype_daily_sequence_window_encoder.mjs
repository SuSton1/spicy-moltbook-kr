const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const safeDiv = (left, right) => {
  const numerator = num(left)
  const denominator = num(right)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) return null
  return numerator / denominator
}

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const stdev = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 2) return null
  const meanValue = average(filtered) ?? 0
  const variance = filtered.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / filtered.length
  return variance > 0 ? Math.sqrt(variance) : 0
}

const clip = (value, min, max) => Math.min(max, Math.max(min, value))

const normalizeSeries = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value) ?? 0)
  const meanValue = average(filtered) ?? 0
  const stdevValue = stdev(filtered) ?? 0
  if (!Number.isFinite(stdevValue) || stdevValue <= 1e-9) return filtered.map((value) => value - meanValue)
  return filtered.map((value) => (value - meanValue) / stdevValue)
}

const bucketSigned = (value, threshold = 0.35) => {
  const numeric = num(value) ?? 0
  if (numeric >= threshold) return "up"
  if (numeric <= -threshold) return "dn"
  return "flat"
}

const bucketNonNegative = (value, cut1, cut2) => {
  const numeric = num(value) ?? 0
  if (numeric <= cut1) return "lo"
  if (numeric <= cut2) return "mid"
  return "hi"
}

const chunkMean = (values = [], start, endExclusive) => {
  const slice = (values ?? []).slice(start, endExclusive)
  return average(slice) ?? 0
}

const countSignFlips = (values = []) => {
  let flips = 0
  let previous = null
  for (const rawValue of values ?? []) {
    const value = num(rawValue) ?? 0
    const sign = value > 0.05 ? 1 : value < -0.05 ? -1 : 0
    if (sign === 0) continue
    if (previous !== null && previous !== sign) flips += 1
    previous = sign
  }
  return flips
}

const buildSegmentStates = (values = []) => {
  const list = Array.isArray(values) ? values : []
  const firstCut = Math.max(1, Math.floor(list.length / 3))
  const secondCut = Math.max(firstCut + 1, Math.floor((list.length * 2) / 3))
  return [
    bucketSigned(chunkMean(list, 0, firstCut)),
    bucketSigned(chunkMean(list, firstCut, secondCut)),
    bucketSigned(chunkMean(list, secondCut, list.length)),
  ]
}

const buildPrototypeId = ({ normalizedValues = [], rawValues = [], channelKey, window }) => {
  const normalized = Array.isArray(normalizedValues) ? normalizedValues : []
  const raw = Array.isArray(rawValues) ? rawValues : []
  const states = buildSegmentStates(normalized)
  const slope = bucketSigned((normalized[normalized.length - 1] ?? 0) - (normalized[0] ?? 0), 0.45)
  const terminal = bucketSigned(normalized[normalized.length - 1] ?? 0, 0.4)
  const absMean = average(raw.map((value) => Math.abs(num(value) ?? 0))) ?? 0
  const vol = stdev(raw) ?? 0
  const flips = Math.min(3, countSignFlips(normalized))
  const magnitudeBucket =
    channelKey === "body"
      ? bucketNonNegative(absMean, 0.25, 0.55)
      : channelKey === "range"
        ? bucketNonNegative(absMean, 0.03, 0.07)
        : channelKey === "volume"
          ? bucketNonNegative(absMean, 0.15, 0.35)
          : bucketNonNegative(absMean, 0.01, 0.025)
  const volBucket =
    channelKey === "body" || channelKey === "volume"
      ? bucketNonNegative(vol, 0.35, 0.8)
      : bucketNonNegative(vol, 0.01, 0.03)
  return `${channelKey}${window}.${states.join("_")}.s${slope}.e${terminal}.m${magnitudeBucket}.v${volBucket}.f${flips}`
}

const resolveChannelValue = ({ current, previous, meanVolume, meanTradingValue, channelKey }) => {
  const open = num(current?.open)
  const high = num(current?.high)
  const low = num(current?.low)
  const close = num(current?.close)
  const prevClose = num(previous?.close)
  const volume = num(current?.volume)
  const tradingValue = Number.isFinite(close) && Number.isFinite(volume) ? close * volume : null
  if (channelKey === "price") {
    return safeDiv(close - prevClose, prevClose) ?? 0
  }
  if (channelKey === "range") {
    return safeDiv((high ?? 0) - (low ?? 0), prevClose ?? close ?? 1) ?? 0
  }
  if (channelKey === "body") {
    const denom = Math.max(1e-6, Math.abs((high ?? 0) - (low ?? 0)))
    return clip(safeDiv((close ?? 0) - (open ?? 0), denom) ?? 0, -1, 1)
  }
  if (channelKey === "volume") {
    return safeDiv((tradingValue ?? 0) - (meanTradingValue ?? 0), Math.max(1, meanTradingValue ?? 1)) ??
      safeDiv((volume ?? 0) - (meanVolume ?? 0), Math.max(1, meanVolume ?? 1)) ??
      0
  }
  return 0
}

const windowSlice = ({ series = [], endIdx, window }) => {
  const safeEndIdx = Number(endIdx)
  const safeWindow = Math.max(1, Number(window) || 1)
  if (!Number.isInteger(safeEndIdx) || safeEndIdx < 1) return []
  const startIdx = Math.max(1, safeEndIdx - safeWindow + 1)
  return Array.from({ length: safeEndIdx - startIdx + 1 }, (_, offset) => startIdx + offset)
}

const buildMeanRefs = ({ series = [], indices = [] } = {}) => {
  const volumes = []
  const tradingValues = []
  for (const index of indices) {
    const row = series[index]
    const close = num(row?.close)
    const volume = num(row?.volume)
    if (Number.isFinite(volume)) volumes.push(volume)
    if (Number.isFinite(close) && Number.isFinite(volume)) tradingValues.push(close * volume)
  }
  return {
    meanVolume: average(volumes) ?? 0,
    meanTradingValue: average(tradingValues) ?? 0,
  }
}

export const buildSequenceWindowChannelValues = ({ series = [], endIdx, window, channelKey }) => {
  const indices = windowSlice({ series, endIdx, window })
  const refs = buildMeanRefs({ series, indices })
  return indices.map((index) =>
    resolveChannelValue({
      current: series[index],
      previous: series[index - 1],
      meanVolume: refs.meanVolume,
      meanTradingValue: refs.meanTradingValue,
      channelKey,
    }),
  )
}

export const encodeSequenceWindowPrototype = ({ series = [], endIdx, window, channelKey }) => {
  const rawValues = buildSequenceWindowChannelValues({ series, endIdx, window, channelKey })
  if (rawValues.length < Math.max(3, Math.floor(Number(window) * 0.6))) return null
  const normalizedValues = normalizeSeries(rawValues)
  return {
    channelKey,
    window: Number(window),
    rawValues,
    normalizedValues,
    prototypeId: buildPrototypeId({ normalizedValues, rawValues, channelKey, window }),
  }
}

export const buildSequenceShapeletAssignments = ({ series = [], endIdx }) => {
  const specs = [
    ["price5", "price", 5],
    ["price10", "price", 10],
    ["price20", "price", 20],
    ["range10", "range", 10],
    ["range20", "range", 20],
    ["body10", "body", 10],
    ["volume10", "volume", 10],
    ["volume20", "volume", 20],
  ]
  const assignments = {}
  for (const [assignmentKey, channelKey, window] of specs) {
    const encoded = encodeSequenceWindowPrototype({ series, endIdx, window, channelKey })
    if (!encoded?.prototypeId) continue
    assignments[assignmentKey] = `sig.seqShapelet.${assignmentKey}.${encoded.prototypeId}`
  }
  const comboParts = [assignments.price20, assignments.range20, assignments.volume20]
    .filter(Boolean)
    .map((token) => token.split(".").slice(-1)[0])
  if (comboParts.length >= 2) {
    assignments.combo = `sig.seqShapelet.combo.${comboParts.join("__")}`
  }
  return assignments
}
