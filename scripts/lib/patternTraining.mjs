import {
  firstDayOfMonth,
  shiftDateKey,
  shiftDateKeyByMonths,
} from "../ai-date-range.lib.mjs"
import {
  evaluateMarketCap,
  initMarketCapStats,
  resolveMarketCapKrw,
  trackMarketCap,
} from "./marketCapFilter.mjs"

export const MIN_LIQUIDITY_KRW = 100_000_000

const DEFAULT_MAX_SHAPE_TRAIN_SAMPLES = 50_000
const DEFAULT_MAX_SHAPE_TEST_SAMPLES = 20_000

const FEATURE_PATHS = [
  "ma.spread5_20",
  "ma.spread20_60",
  "ma.slope5",
  "ma.slope20",
  "volume.volumeRatio20",
  "volume.valueRatio20",
  "volatility.stdev20",
  "volatility.atr14",
  "candle.bodyPct",
  "candle.gapPct",
]

const CANDIDATE_QUANTILES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]

const keyFor = (symbol, dateKey) => `${symbol}:${dateKey}`

const toNumber = (value, fallback = null) => {
  if (value === null || value === undefined) {
    return fallback
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value)
    return Number.isFinite(asNumber) ? asNumber : fallback
  }
  const asNumber = Number(value)
  return Number.isFinite(asNumber) ? asNumber : fallback
}

const roundTo = (value, digits) => {
  if (!Number.isFinite(value)) {
    return 0
  }
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const clampList = (values) => {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const rounded = roundTo(value, 6)
    const key = String(rounded)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(rounded)
  }
  return out
}

const hashSeed = (text) => {
  let hash = 2166136261
  const value = String(text ?? "")
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const buildRng = (seed) => {
  let state = hashSeed(seed)
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const shuffleInPlace = (items, rng) => {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const temp = items[i]
    items[i] = items[j]
    items[j] = temp
  }
  return items
}

const getFeatureValue = (features, path) => {
  if (!features || typeof features !== "object") {
    return null
  }
  const parts = path.split(".")
  let cursor = features
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object") {
      return null
    }
    cursor = cursor[part]
  }
  return toNumber(cursor)
}

const computeQuantiles = (values, quantiles) => {
  const filtered = values.filter((value) => Number.isFinite(value))
  if (!filtered.length) {
    return []
  }
  const sorted = [...filtered].sort((a, b) => a - b)
  const out = []
  for (const q of quantiles) {
    const idx = Math.max(
      0,
      Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))),
    )
    out.push(sorted[idx])
  }
  return clampList(out)
}

const compareDateKey = (a, b) => String(a).localeCompare(String(b))

const buildCandleMap = (candles) => {
  const map = new Map()
  for (const row of candles ?? []) {
    const dateKey = String(row?.dateKey ?? row?.tradingDateKey ?? "").trim()
    const symbol = String(row?.symbol ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    const entry = map.get(symbol) ?? new Map()
    entry.set(dateKey, {
      open: toNumber(row?.open),
      close: toNumber(row?.close),
      high: toNumber(row?.high),
      low: toNumber(row?.low),
      volume: toNumber(row?.volume),
    })
    map.set(symbol, entry)
  }
  return map
}

const buildPrice15Map = (rows) => {
  const map = new Map()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    map.set(keyFor(symbol, dateKey), toNumber(row?.price))
  }
  return map
}

const buildUniverseMap = (rows) => {
  const map = new Map()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    map.set(keyFor(symbol, dateKey), toNumber(row?.avgTradingValue20d, 0) ?? 0)
  }
  return map
}

const buildMarketCapMap = (rows) => {
  const map = new Map()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    map.set(keyFor(symbol, dateKey), resolveMarketCapKrw(row))
  }
  return map
}

const buildFeatureMap = (rows) => {
  const map = new Map()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    map.set(keyFor(symbol, dateKey), row?.features ?? null)
  }
  return map
}

const buildIntradayMap = (rows) => {
  const map = new Map()
  for (const row of rows ?? []) {
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.tradingDateKey ?? "").trim()
    if (!symbol || !dateKey) {
      continue
    }
    map.set(keyFor(symbol, dateKey), row?.seq ?? null)
  }
  return map
}

const buildSurgeLabels = (candlesBySymbol) => {
  const returnsByDate = new Map()
  for (const [symbol, dateMap] of candlesBySymbol.entries()) {
    const dates = Array.from(dateMap.keys()).sort(compareDateKey)
    // Predict next trading day close-to-close return: label is attached to "today" (D),
    // computed from next day's close (D+1) / today's close (D).
    for (let i = 0; i + 1 < dates.length; i += 1) {
      const dateKey = dates[i]
      const nextDateKey = dates[i + 1]
      const current = dateMap.get(dateKey)
      const next = dateMap.get(nextDateKey)
      if (!current || !next) {
        continue
      }
      const close = toNumber(current.close)
      const nextClose = toNumber(next.close)
      if (
        !Number.isFinite(close) ||
        !Number.isFinite(nextClose) ||
        close === 0
      ) {
        continue
      }
      const ret = nextClose / close - 1
      const list = returnsByDate.get(dateKey) ?? []
      list.push({ symbol, ret })
      returnsByDate.set(dateKey, list)
    }
  }

  const labels = new Map()
  for (const [dateKey, list] of returnsByDate.entries()) {
    const sorted = [...list].sort((a, b) => b.ret - a.ret)
    const top = new Set(sorted.slice(0, 10).map((row) => row.symbol))
    for (const row of list) {
      labels.set(keyFor(row.symbol, dateKey), top.has(row.symbol))
    }
  }
  return labels
}

const buildGapLabels = (candlesBySymbol, price15Map) => {
  const labels = new Map()
  for (const [symbol, dateMap] of candlesBySymbol.entries()) {
    const dates = Array.from(dateMap.keys()).sort(compareDateKey)
    // Predict next trading day open gap vs today's price15:
    // label attached to "today" (D), computed from open(D+1) / price15(D).
    for (let i = 0; i + 1 < dates.length; i += 1) {
      const dateKey = dates[i]
      const nextDateKey = dates[i + 1]
      const nextCandle = dateMap.get(nextDateKey)
      if (!nextCandle) {
        continue
      }
      const open = toNumber(nextCandle.open)
      const price15 = price15Map.get(keyFor(symbol, dateKey))
      if (
        !Number.isFinite(open) ||
        !Number.isFinite(price15) ||
        price15 === 0
      ) {
        continue
      }
      const gap = open / price15 - 1
      labels.set(keyFor(symbol, dateKey), gap >= 0.015)
    }
  }
  return labels
}

const inRange = (dateKey, range) =>
  dateKey >= range.fromDateKey && dateKey <= range.toDateKey

const buildPrevTradingDayMap = (dateKeys) => {
  const sorted = Array.from(new Set(dateKeys.filter(Boolean))).sort(
    compareDateKey,
  )
  const prev = new Map()
  for (let i = 1; i < sorted.length; i += 1) {
    prev.set(sorted[i], sorted[i - 1])
  }
  return prev
}

const resolveGapAsOfFeatures = ({
  symbol,
  dateKey,
  prevTradingDayMap,
  featureMap,
  price15Map,
  candlesBySymbol,
}) => {
  const prevDateKey = prevTradingDayMap?.get(dateKey) ?? null
  if (!prevDateKey) {
    return null
  }
  const base = featureMap.get(keyFor(symbol, prevDateKey))
  if (!base) {
    return null
  }
  const prevClose = toNumber(
    candlesBySymbol.get(symbol)?.get(prevDateKey)?.close,
  )
  const price15 = price15Map.get(keyFor(symbol, dateKey))
  const gapPct =
    Number.isFinite(price15) && Number.isFinite(prevClose) && prevClose !== 0
      ? price15 / prevClose - 1
      : null
  return {
    ...base,
    candle: {
      ...(base.candle ?? {}),
      gapPct,
    },
  }
}

const buildRuleSamples = ({
  track,
  featureMap,
  labelMap,
  liquidityMap,
  capMap,
  capStats,
  ranges,
  prevTradingDayMap,
  price15Map,
  candlesBySymbol,
}) => {
  const trainSamples = []
  const testSamples = []
  for (const [key, label] of labelMap.entries()) {
    const [symbol, dateKey] = key.split(":")
    if (
      dateKey < ranges.trainFromDateKey ||
      dateKey > ranges.testToDateKey ||
      (!(
        dateKey >= ranges.trainFromDateKey && dateKey <= ranges.trainToDateKey
      ) &&
        !(dateKey >= ranges.testFromDateKey && dateKey <= ranges.testToDateKey))
    ) {
      continue
    }
    const liquidity = liquidityMap.get(key) ?? 0
    if (liquidity < MIN_LIQUIDITY_KRW) {
      continue
    }
    const cap = capMap?.get(key)
    const capVerdict = evaluateMarketCap({ marketCapKrw: cap })
    trackMarketCap(capStats, capVerdict)
    if (!capVerdict.pass) {
      continue
    }
    const features =
      track === "GAP_15_BET"
        ? resolveGapAsOfFeatures({
            symbol,
            dateKey,
            prevTradingDayMap,
            featureMap,
            price15Map,
            candlesBySymbol,
          })
        : featureMap.get(key)
    if (!features) {
      continue
    }
    const values = {}
    let hasAny = false
    for (const path of FEATURE_PATHS) {
      const value = getFeatureValue(features, path)
      if (Number.isFinite(value)) {
        values[path] = value
        hasAny = true
      }
    }
    if (!hasAny) {
      continue
    }
    const sample = { key, dateKey, label: Boolean(label), values }
    if (dateKey >= ranges.testFromDateKey && dateKey <= ranges.testToDateKey) {
      testSamples.push(sample)
      continue
    }
    if (
      dateKey >= ranges.trainFromDateKey &&
      dateKey <= ranges.trainToDateKey
    ) {
      trainSamples.push(sample)
    }
  }
  return { trainSamples, testSamples }
}

const padSequence = (values, length) => {
  const out = Array.isArray(values) ? values.slice(-length) : []
  while (out.length < length) {
    out.unshift(0)
  }
  return out
}

const zScore = (values) => {
  const filtered = values.filter((value) => Number.isFinite(value))
  if (!filtered.length) {
    return values.map(() => 0)
  }
  const avg = filtered.reduce((acc, value) => acc + value, 0) / filtered.length
  const variance =
    filtered.reduce((acc, value) => acc + (value - avg) ** 2, 0) /
    filtered.length
  const stdev = Math.sqrt(variance) || 0
  if (!stdev) {
    return values.map(() => 0)
  }
  return values.map((value) =>
    Number.isFinite(value) ? (value - avg) / stdev : 0,
  )
}

const buildVectorFromSeq = (seq, length = 30) => {
  const returns = Array.isArray(seq?.returnsSeq)
    ? seq.returnsSeq.map((value) => toNumber(value))
    : []
  const base = returns.filter((value) => Number.isFinite(value))
  let returnsSeq = base
  if (!base.length) {
    const closes = Array.isArray(seq?.closeSeq)
      ? seq.closeSeq.map((value) => toNumber(value))
      : []
    const filtered = closes.filter((value) => Number.isFinite(value))
    if (filtered.length < 2) {
      returnsSeq = []
    } else {
      const derived = []
      for (let i = 1; i < filtered.length; i += 1) {
        const prev = filtered[i - 1]
        const curr = filtered[i]
        if (!Number.isFinite(prev) || prev === 0 || !Number.isFinite(curr)) {
          derived.push(0)
        } else {
          derived.push(curr / prev - 1)
        }
      }
      returnsSeq = derived
    }
  }

  const valueSeq = Array.isArray(seq?.valueSeq)
    ? seq.valueSeq.map((value) => toNumber(value))
    : []
  const valueZSeq = zScore(valueSeq)

  const returnsFixed = padSequence(returnsSeq, length)
  const valueFixed = padSequence(valueZSeq, length)
  return [...returnsFixed, ...valueFixed]
}

const heapSwap = (heap, a, b) => {
  const temp = heap[a]
  heap[a] = heap[b]
  heap[b] = temp
}

// Max-heap by (score desc, key desc) so we can keep N smallest by evicting the largest.
const heapHigherPriority = (a, b) => {
  if (a.score !== b.score) {
    return a.score > b.score
  }
  return String(a.key) > String(b.key)
}

const heapSiftUp = (heap, idx) => {
  let i = idx
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2)
    if (!heapHigherPriority(heap[i], heap[parent])) {
      break
    }
    heapSwap(heap, i, parent)
    i = parent
  }
}

const heapSiftDown = (heap, idx) => {
  let i = idx
  while (true) {
    const left = i * 2 + 1
    const right = left + 1
    let best = i
    if (left < heap.length && heapHigherPriority(heap[left], heap[best])) {
      best = left
    }
    if (right < heap.length && heapHigherPriority(heap[right], heap[best])) {
      best = right
    }
    if (best === i) {
      break
    }
    heapSwap(heap, i, best)
    i = best
  }
}

const heapPush = (heap, item) => {
  heap.push(item)
  heapSiftUp(heap, heap.length - 1)
}

const heapPop = (heap) => {
  if (!heap.length) {
    return null
  }
  const top = heap[0]
  const last = heap.pop()
  if (heap.length && last) {
    heap[0] = last
    heapSiftDown(heap, 0)
  }
  return top
}

const heapReplaceTop = (heap, item) => {
  if (!heap.length) {
    heapPush(heap, item)
    return
  }
  heap[0] = item
  heapSiftDown(heap, 0)
}

const heapConsiderSmallest = (heap, item, maxSize) => {
  if (heap.length < maxSize) {
    heapPush(heap, item)
    return
  }
  const top = heap[0]
  if (
    item.score < top.score ||
    (item.score === top.score && String(item.key) < String(top.key))
  ) {
    heapReplaceTop(heap, item)
  }
}

const compareSampleKey = (a, b) => {
  const [symA, dateA] = String(a ?? "").split(":")
  const [symB, dateB] = String(b ?? "").split(":")
  if (dateA !== dateB) {
    return String(dateA).localeCompare(String(dateB))
  }
  return String(symA).localeCompare(String(symB))
}

const buildShapeSamples = ({
  intradayMap,
  labelMap,
  liquidityMap,
  capMap,
  capStats,
  ranges,
  vectorLength,
  seed,
  maxTrainSamples = DEFAULT_MAX_SHAPE_TRAIN_SAMPLES,
  maxTestSamples = DEFAULT_MAX_SHAPE_TEST_SAMPLES,
}) => {
  const trainPosKeys = []
  const testPosKeys = []
  const trainNegHeap = []
  const testNegHeap = []
  const safeMaxTrain = Math.max(1, Math.floor(maxTrainSamples))
  const safeMaxTest = Math.max(1, Math.floor(maxTestSamples))
  for (const [key, label] of labelMap.entries()) {
    const [, dateKey] = key.split(":")
    if (
      dateKey < ranges.trainFromDateKey ||
      dateKey > ranges.testToDateKey ||
      (!(
        dateKey >= ranges.trainFromDateKey && dateKey <= ranges.trainToDateKey
      ) &&
        !(dateKey >= ranges.testFromDateKey && dateKey <= ranges.testToDateKey))
    ) {
      continue
    }
    const liquidity = liquidityMap.get(key) ?? 0
    if (liquidity < MIN_LIQUIDITY_KRW) {
      continue
    }
    const cap = capMap?.get(key)
    const capVerdict = evaluateMarketCap({ marketCapKrw: cap })
    trackMarketCap(capStats, capVerdict)
    if (!capVerdict.pass) {
      continue
    }
    const seq = intradayMap.get(key)
    if (!seq) {
      continue
    }

    const isTest =
      dateKey >= ranges.testFromDateKey && dateKey <= ranges.testToDateKey
    const isTrain =
      dateKey >= ranges.trainFromDateKey && dateKey <= ranges.trainToDateKey
    if (!isTest && !isTrain) {
      continue
    }

    if (label) {
      if (isTest) {
        testPosKeys.push(key)
      } else {
        trainPosKeys.push(key)
      }
      continue
    }

    const score = hashSeed(`${seed}:shape-neg:${key}`)
    if (isTest) {
      heapConsiderSmallest(testNegHeap, { score, key }, safeMaxTest)
    } else {
      heapConsiderSmallest(trainNegHeap, { score, key }, safeMaxTrain)
    }
  }

  const trimNegHeap = (heap, allowed) => {
    const safeAllowed = Math.max(0, Math.floor(allowed))
    while (heap.length > safeAllowed) {
      heapPop(heap)
    }
    return heap.map((item) => item.key)
  }

  const trainAllowedNeg = safeMaxTrain - trainPosKeys.length
  const testAllowedNeg = safeMaxTest - testPosKeys.length

  const trainKeys = [
    ...trainPosKeys,
    ...trimNegHeap(trainNegHeap, trainAllowedNeg),
  ].sort(compareSampleKey)
  const testKeys = [
    ...testPosKeys,
    ...trimNegHeap(testNegHeap, testAllowedNeg),
  ].sort(compareSampleKey)

  const buildSamplesFromKeys = (keys) =>
    keys
      .map((sampleKey) => {
        const [, sampleDateKey] = String(sampleKey ?? "").split(":")
        const seq = intradayMap.get(sampleKey)
        if (!seq) {
          return null
        }
        const vector = buildVectorFromSeq(seq, vectorLength)
        if (!vector) {
          return null
        }
        return {
          key: sampleKey,
          dateKey: sampleDateKey,
          label: Boolean(labelMap.get(sampleKey)),
          vector,
        }
      })
      .filter(Boolean)

  return {
    trainSamples: buildSamplesFromKeys(trainKeys),
    testSamples: buildSamplesFromKeys(testKeys),
  }
}

const buildCandidateRules = (trainSamples, quantiles) => {
  const valuesByPath = new Map()
  for (const sample of trainSamples) {
    for (const path of FEATURE_PATHS) {
      const value = sample.values[path]
      if (!Number.isFinite(value)) {
        continue
      }
      const list = valuesByPath.get(path) ?? []
      list.push(value)
      valuesByPath.set(path, list)
    }
  }

  const thresholdsByPath = new Map()
  for (const [path, values] of valuesByPath.entries()) {
    const thresholds = computeQuantiles(values, quantiles)
    thresholdsByPath.set(path, thresholds)
  }

  const rules = []
  for (const [path, thresholds] of thresholdsByPath.entries()) {
    for (const threshold of thresholds) {
      rules.push({ conditions: [{ path, op: ">=", threshold }] })
      rules.push({ conditions: [{ path, op: "<=", threshold }] })
    }
  }

  const featurePaths = Array.from(thresholdsByPath.keys())
  for (let i = 0; i < featurePaths.length; i += 1) {
    for (let j = i + 1; j < featurePaths.length; j += 1) {
      const pathA = featurePaths[i]
      const pathB = featurePaths[j]
      const thresholdsA = thresholdsByPath.get(pathA) ?? []
      const thresholdsB = thresholdsByPath.get(pathB) ?? []
      for (const thresholdA of thresholdsA) {
        for (const thresholdB of thresholdsB) {
          rules.push({
            conditions: [
              { path: pathA, op: ">=", threshold: thresholdA },
              { path: pathB, op: ">=", threshold: thresholdB },
            ],
          })
        }
      }
    }
  }
  return rules
}

const matchesRule = (sample, rule) => {
  for (const condition of rule.conditions) {
    const value = sample.values[condition.path]
    if (!Number.isFinite(value)) {
      return false
    }
    if (condition.op === ">=" && value < condition.threshold) {
      return false
    }
    if (condition.op === "<=" && value > condition.threshold) {
      return false
    }
  }
  return true
}

const evalRule = (rule, samples) => {
  let support = 0
  let positives = 0
  for (const sample of samples) {
    if (!matchesRule(sample, rule)) {
      continue
    }
    support += 1
    if (sample.label) {
      positives += 1
    }
  }
  return {
    support,
    precision: support ? positives / support : 0,
  }
}

const formatCondition = (condition) =>
  `${condition.path}${condition.op}${roundTo(condition.threshold, 3)}`

const buildRuleSummary = (rule) => {
  const conditions = rule.conditions.map(formatCondition).join(" & ")
  return `${conditions} | train ${roundTo(rule.precisionTrain, 3)} n=${rule.supportTrain} test ${roundTo(rule.precisionTest, 3)} n=${rule.supportTest}`
}

const dedupeRules = (rules) => {
  const seen = new Set()
  const out = []
  for (const rule of rules) {
    const signature = rule.conditions
      .map(
        (condition) =>
          `${condition.path}:${condition.op}:${roundTo(condition.threshold, 2)}`,
      )
      .sort()
      .join("|")
    if (seen.has(signature)) {
      continue
    }
    seen.add(signature)
    out.push(rule)
  }
  return out
}

const trainRulePatterns = ({
  trainSamples,
  testSamples,
  supportMin,
  precisionMin,
  maxRules,
  seed,
}) => {
  const candidates = buildCandidateRules(trainSamples, CANDIDATE_QUANTILES)
  const scored = []
  for (const candidate of candidates) {
    const trainStats = evalRule(candidate, trainSamples)
    if (trainStats.support < supportMin) {
      continue
    }
    const testStats = evalRule(candidate, testSamples)
    const precisionTest = testStats.precision
    if (precisionTest < precisionMin) {
      continue
    }
    scored.push({
      conditions: candidate.conditions,
      supportTrain: trainStats.support,
      precisionTrain: roundTo(trainStats.precision, 4),
      supportTest: testStats.support,
      precisionTest: roundTo(precisionTest, 4),
      tieBreak: hashSeed(
        `${seed}:${candidate.conditions
          .map(
            (condition) =>
              `${condition.path}:${condition.op}:${condition.threshold}`,
          )
          .join("|")}`,
      ),
    })
  }

  scored.sort((a, b) => {
    if (b.precisionTest !== a.precisionTest) {
      return b.precisionTest - a.precisionTest
    }
    if (b.precisionTrain !== a.precisionTrain) {
      return b.precisionTrain - a.precisionTrain
    }
    if (b.supportTrain !== a.supportTrain) {
      return b.supportTrain - a.supportTrain
    }
    return a.tieBreak - b.tieBreak
  })

  const deduped = dedupeRules(scored)
  const top = deduped.slice(0, maxRules).map(({ tieBreak, ...rest }) => rest)
  return {
    candidates: candidates.length,
    patterns: top.map((rule) => ({
      ...rule,
      summary: buildRuleSummary(rule),
    })),
  }
}

const distance = (a, b) => {
  let acc = 0
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i]
    acc += diff * diff
  }
  // Squared distance is enough for comparisons and avoids an extra sqrt per check.
  return acc
}

const assignClusters = (vectors, centroids) => {
  const assignments = new Array(vectors.length).fill(0)
  for (let i = 0; i < vectors.length; i += 1) {
    let best = 0
    let bestDist = Infinity
    for (let j = 0; j < centroids.length; j += 1) {
      const dist = distance(vectors[i], centroids[j])
      if (dist < bestDist) {
        bestDist = dist
        best = j
      }
    }
    assignments[i] = best
  }
  return assignments
}

const recomputeCentroids = (vectors, assignments, k) => {
  const sums = Array.from({ length: k }, () => [])
  const counts = Array.from({ length: k }, () => 0)
  for (let i = 0; i < vectors.length; i += 1) {
    const cluster = assignments[i]
    const vector = vectors[i]
    if (!sums[cluster].length) {
      sums[cluster] = Array.from({ length: vector.length }, () => 0)
    }
    for (let j = 0; j < vector.length; j += 1) {
      sums[cluster][j] += vector[j]
    }
    counts[cluster] += 1
  }

  const centroids = []
  for (let i = 0; i < k; i += 1) {
    if (!counts[i]) {
      centroids.push(null)
      continue
    }
    centroids.push(sums[i].map((value) => value / counts[i]))
  }
  return centroids
}

const kmeans = (vectors, k, seed, iterations = 5) => {
  const rng = buildRng(seed)
  const indices = shuffleInPlace(
    Array.from({ length: vectors.length }, (_, idx) => idx),
    rng,
  )
  const centroids = []
  for (let i = 0; i < k; i += 1) {
    centroids.push([...vectors[indices[i % indices.length]]])
  }

  let assignments = assignClusters(vectors, centroids)
  for (let iter = 0; iter < iterations; iter += 1) {
    const updated = recomputeCentroids(vectors, assignments, k)
    for (let i = 0; i < k; i += 1) {
      if (updated[i]) {
        centroids[i] = updated[i]
      }
    }
    assignments = assignClusters(vectors, centroids)
  }
  return { centroids, assignments }
}

const scoreClusters = ({ assignments, labels, k }) => {
  const stats = Array.from({ length: k }, () => ({ support: 0, positives: 0 }))
  for (let i = 0; i < assignments.length; i += 1) {
    const cluster = assignments[i]
    stats[cluster].support += 1
    if (labels[i]) {
      stats[cluster].positives += 1
    }
  }
  return stats.map((row) => ({
    support: row.support,
    precision: row.support ? row.positives / row.support : 0,
  }))
}

const pickCandidateKs = ({ sampleCount, maxK, candidateKs, supportMin }) => {
  const base = candidateKs ?? [50, 100, 200, 400, 800]
  const safeSupportMin = Math.max(
    1,
    Number.isFinite(supportMin) ? supportMin : 1,
  )
  const capBySupport = Math.floor(sampleCount / (safeSupportMin * 10))
  const effectiveMaxK = Math.min(maxK, sampleCount, capBySupport || maxK)
  const filtered = base
    .map((value) => Math.min(value, effectiveMaxK))
    .filter((value) => value <= effectiveMaxK && value >= 2)
  if (filtered.length) {
    return filtered
  }
  const fallback = Math.min(effectiveMaxK, sampleCount)
  if (fallback < 2) {
    return []
  }
  return [Math.min(fallback, 12)]
}

const trainShapePatterns = ({
  trainSamples,
  testSamples,
  supportMin,
  precisionMin,
  maxK,
  candidateKs,
  seed,
  vectorBins,
}) => {
  const vectors = trainSamples.map((sample) => sample.vector)
  const labels = trainSamples.map((sample) => sample.label)
  const testVectors = testSamples.map((sample) => sample.vector)
  const testLabels = testSamples.map((sample) => sample.label)

  const candidates = pickCandidateKs({
    sampleCount: vectors.length,
    maxK,
    candidateKs,
    supportMin,
  })
  if (!candidates.length) {
    return { chosenK: 0, patterns: [] }
  }

  let best = null
  for (const k of candidates) {
    const { centroids, assignments } = kmeans(vectors, k, `${seed}:${k}`)
    const trainStats = scoreClusters({ assignments, labels, k })
    const testAssignments = assignClusters(testVectors, centroids)
    const testStats = scoreClusters({
      assignments: testAssignments,
      labels: testLabels,
      k,
    })

    let totalSupport = 0
    let weightedPrecision = 0
    for (let i = 0; i < k; i += 1) {
      if (trainStats[i].support < supportMin) {
        continue
      }
      totalSupport += trainStats[i].support
      weightedPrecision += trainStats[i].support * testStats[i].precision
    }
    const score = totalSupport ? weightedPrecision / totalSupport : 0

    if (!best || score > best.score || (score === best.score && k < best.k)) {
      best = { k, score, centroids, trainStats, testStats }
    }
  }

  if (!best) {
    return { chosenK: 0, patterns: [] }
  }

  const patterns = []
  for (let i = 0; i < best.k; i += 1) {
    const train = best.trainStats[i]
    const test = best.testStats[i]
    if (train.support < supportMin) {
      continue
    }
    if (test.precision < precisionMin) {
      continue
    }
    const summary = `k=${best.k} c=${i} train ${roundTo(train.precision, 3)} n=${train.support} test ${roundTo(test.precision, 3)} n=${test.support} len=${vectorBins}`
    patterns.push({
      k: best.k,
      centroid: {
        vector: best.centroids[i],
        bins: vectorBins,
        method: "returns_value_zseq",
        cluster: i,
      },
      supportTrain: train.support,
      precisionTrain: roundTo(train.precision, 4),
      precisionTest: roundTo(test.precision, 4),
      summary,
    })
  }

  return { chosenK: best.k, patterns }
}

const splitSamples = (samples, range) =>
  samples.filter((sample) => inRange(sample.dateKey, range))

export const resolveTrainTestRanges = ({
  asOfDateKey,
  trainDays = 365 * 5 + 183,
  testDays = 183,
  trainMonths = null,
  testMonths = null,
}) => {
  const testTo = asOfDateKey
  if (Number.isFinite(trainMonths) && Number.isFinite(testMonths)) {
    const testFromMonth = firstDayOfMonth(
      shiftDateKeyByMonths(testTo, -(testMonths - 1)),
    )
    const testFrom = testFromMonth ?? testTo
    const trainTo = shiftDateKey(testFrom, -1) ?? testFrom
    const trainFromMonth = firstDayOfMonth(
      shiftDateKeyByMonths(testFrom, -trainMonths),
    )
    const trainFrom = trainFromMonth ?? trainTo
    return {
      trainFromDateKey: trainFrom,
      trainToDateKey: trainTo,
      testFromDateKey: testFrom,
      testToDateKey: testTo,
    }
  }
  const testFrom = shiftDateKey(testTo, -(testDays - 1)) ?? testTo
  const trainTo = shiftDateKey(testFrom, -1) ?? testFrom
  const trainFrom = shiftDateKey(trainTo, -(trainDays - 1)) ?? trainTo
  return {
    trainFromDateKey: trainFrom,
    trainToDateKey: trainTo,
    testFromDateKey: testFrom,
    testToDateKey: testTo,
  }
}

export const trainPatternsFromData = ({
  data,
  track,
  ranges,
  seed = "default",
  supportMin = 20,
  precisionMin = 0.5,
  maxRules = 200,
  maxK = 3000,
  candidateKs,
  vectorBins = 30,
  labelMapOverride = null,
  calendarDateKeys = null,
}) => {
  const candlesBySymbol = buildCandleMap(data.candles)
  const price15Map = buildPrice15Map(data.price15)
  const universeMap = buildUniverseMap(data.universe)
  const marketCapMap = buildMarketCapMap(data.universe)
  const featureMap = buildFeatureMap(data.featureDays)
  const intradayMap = buildIntradayMap(data.intradayProfiles)
  const prevTradingDayMap =
    track === "GAP_15_BET"
      ? buildPrevTradingDayMap(
          (Array.isArray(calendarDateKeys) && calendarDateKeys.length
            ? calendarDateKeys
            : (data.universe ?? []).map((row) =>
                String(row?.tradingDateKey ?? "").trim(),
              )
          ).map((value) => String(value ?? "").trim()),
        )
      : null

  const labelMap =
    labelMapOverride instanceof Map
      ? labelMapOverride
      : track === "SURGE_EOD"
        ? buildSurgeLabels(candlesBySymbol)
        : buildGapLabels(candlesBySymbol, price15Map)

  const marketCapStats = initMarketCapStats()

  const { trainSamples: trainRuleSamples, testSamples: testRuleSamples } =
    buildRuleSamples({
      track,
      featureMap,
      labelMap,
      liquidityMap: universeMap,
      capMap: marketCapMap,
      capStats: marketCapStats,
      ranges,
      prevTradingDayMap,
      price15Map,
      candlesBySymbol,
    })

  const { trainSamples: trainShapeSamples, testSamples: testShapeSamples } =
    buildShapeSamples({
      intradayMap,
      labelMap,
      liquidityMap: universeMap,
      capMap: marketCapMap,
      capStats: marketCapStats,
      ranges,
      vectorLength: vectorBins,
      seed: `${seed}:shape-samples:${track}`,
    })

  const ruleResult = trainRulePatterns({
    trainSamples: trainRuleSamples,
    testSamples: testRuleSamples,
    supportMin,
    precisionMin,
    maxRules,
    seed: `${seed}:rules:${track}`,
  })

  const shapeResult = trainShapePatterns({
    trainSamples: trainShapeSamples,
    testSamples: testShapeSamples,
    supportMin,
    precisionMin,
    maxK,
    candidateKs,
    seed: `${seed}:shapes:${track}`,
    vectorBins,
  })

  const summary = {
    track,
    rules: {
      candidates: ruleResult.candidates,
      selected: ruleResult.patterns.length,
      topSummaries: ruleResult.patterns.slice(0, 3).map((row) => row.summary),
    },
    shapes: {
      k: shapeResult.chosenK,
      selected: shapeResult.patterns.length,
      topSummaries: shapeResult.patterns.slice(0, 3).map((row) => row.summary),
    },
    marketCapStats,
  }

  return {
    rules: ruleResult.patterns,
    shapes: shapeResult.patterns,
    summary,
  }
}

export const buildPatternSummary = (summary) => summary

export const __test__ = {
  buildCandleMap,
  buildPrice15Map,
  buildSurgeLabels,
  buildGapLabels,
  buildPrevTradingDayMap,
  resolveGapAsOfFeatures,
}
