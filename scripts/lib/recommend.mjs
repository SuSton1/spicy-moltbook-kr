import {
  evaluateMarketCap,
  initMarketCapStats,
  resolveMarketCapKrw,
  trackMarketCap,
} from "./marketCapFilter.mjs"

export const DEFAULT_DISPLAY_LIQUIDITY_MIN = 400_000_000

const toNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
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

const sumFinite = (values) => {
  if (!Array.isArray(values)) {
    return 0
  }
  return values.reduce((acc, value) => {
    const n = toNumber(value)
    return Number.isFinite(n) ? acc + n : acc
  }, 0)
}

const matchesRule = (features, rule) => {
  const conditions = Array.isArray(rule?.conditions) ? rule.conditions : []
  for (const condition of conditions) {
    const value = getFeatureValue(features, condition.path)
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
  return conditions.length > 0
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

const buildVectorFromSeq = (seq, length) => {
  const returns = Array.isArray(seq?.returnsSeq)
    ? seq.returnsSeq.map((value) => toNumber(value)).filter((v) => v !== null)
    : []
  let returnsSeq = returns
  if (!returns.length) {
    const closes = Array.isArray(seq?.closeSeq)
      ? seq.closeSeq.map((value) => toNumber(value)).filter((v) => v !== null)
      : []
    if (closes.length < 2) {
      returnsSeq = []
    } else {
      const derived = []
      for (let i = 1; i < closes.length; i += 1) {
        const prev = closes[i - 1]
        const curr = closes[i]
        if (!prev || !curr) {
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

const distance = (a, b) => {
  let acc = 0
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i]
    acc += diff * diff
  }
  return Math.sqrt(acc)
}

const scoreRules = (features, rules) => {
  const matches = []
  let score = 0
  for (const rule of rules) {
    if (!matchesRule(features, rule)) {
      continue
    }
    const precision = Number(rule.precisionTest ?? 0) || 0
    score += precision * 100
    matches.push({ summary: rule.summary ?? "", precision })
  }
  return { score, matches }
}

const scoreShapes = (seq, shapes, bins) => {
  if (!seq || !shapes.length) {
    return { score: 0, best: null }
  }
  const length =
    Number.isFinite(bins) && bins > 0
      ? bins
      : Number(shapes[0]?.centroid?.bins) || 30
  const vector = buildVectorFromSeq(seq, length)
  if (!vector) {
    return { score: 0, best: null }
  }

  let best = null
  let bestScore = 0
  for (const shape of shapes) {
    const centroid = Array.isArray(shape?.centroid?.vector)
      ? shape.centroid.vector
      : null
    if (!centroid || centroid.length !== vector.length) {
      continue
    }
    const dist = distance(vector, centroid)
    const precision = Number(shape.precisionTest ?? 0) || 0
    const score = (precision * 100) / (1 + dist)
    if (!best || score > bestScore) {
      bestScore = score
      best = { summary: shape.summary ?? "", precision, score }
    }
  }
  return { score: bestScore, best }
}

const buildReasonList = (rulesMatches, shapeBest) => {
  const reasons = []
  for (const match of rulesMatches.slice(0, 2)) {
    reasons.push(`룰 일치: ${match.summary}`)
  }
  if (shapeBest?.summary) {
    reasons.push(`형태 일치: ${shapeBest.summary}`)
  }
  return reasons
}

const collectRulePaths = (rules) => {
  const paths = new Set()
  for (const rule of rules ?? []) {
    for (const condition of rule?.conditions ?? []) {
      if (condition?.path) {
        paths.add(String(condition.path))
      }
    }
  }
  return Array.from(paths)
}

const buildFeatureSnapshot = ({ features, seq, rules, bins }) => {
  const rulePaths = collectRulePaths(rules)
  const moonPaths = [
    "volume.valueRatio20",
    "volume.volumeRatio20",
    "ma.spread5_20",
    "ma.spread20_60",
    "ma.slope5",
    "ma.slope20",
    "candle.bodyPct",
    "candle.gapPct",
  ]
  const uniquePaths = Array.from(new Set([...rulePaths, ...moonPaths]))
  const featureValues = {}
  for (const path of uniquePaths) {
    featureValues[path] = getFeatureValue(features, path)
  }
  const seqSnapshot = {
    returnsSeq: Array.isArray(seq?.returnsSeq)
      ? seq.returnsSeq.slice(-bins)
      : [],
    valueSeq: Array.isArray(seq?.valueSeq) ? seq.valueSeq.slice(-bins) : [],
    closeSeq: Array.isArray(seq?.closeSeq)
      ? seq.closeSeq.slice(-(bins + 1))
      : [],
  }
  return {
    featureValues,
    rulePaths,
    seqSnapshot,
  }
}

export const buildRecommendCandidates = ({
  data,
  asOfDateKey,
  track,
  patterns,
  minLiquidity,
  scoreEps,
  vectorBins,
  excludeUnknownMarketCap = false,
  requireRuleInputs = true,
  requireShapeInputs = true,
  requirePatternMatch = true,
}) => {
  const minLiquidityValue = Number.isFinite(minLiquidity)
    ? minLiquidity
    : DEFAULT_DISPLAY_LIQUIDITY_MIN
  const rules = Array.isArray(patterns?.rules) ? patterns.rules : []
  const shapes = Array.isArray(patterns?.shapes) ? patterns.shapes : []
  const needRules = requireRuleInputs && rules.length > 0
  const needShapes = requireShapeInputs && shapes.length > 0
  const bins = Number.isFinite(vectorBins)
    ? vectorBins
    : Number(shapes?.[0]?.centroid?.bins) || 30

  const featuresBySymbol = new Map(
    (data.featureDays ?? [])
      .filter((row) => row?.tradingDateKey === asOfDateKey)
      .map((row) => [String(row.symbol), row.features ?? null]),
  )

  const intradayBySymbol = new Map(
    (data.intradayProfiles ?? [])
      .filter((row) => row?.tradingDateKey === asOfDateKey)
      .map((row) => [String(row.symbol), row.seq ?? null]),
  )

  const liquidityBySymbol = new Map(
    (data.universe ?? [])
      .filter((row) => row?.tradingDateKey === asOfDateKey)
      .map((row) => [String(row.symbol), Number(row.avgTradingValue20d ?? 0)]),
  )
  const marketCapBySymbol = new Map(
    (data.universe ?? [])
      .filter((row) => row?.tradingDateKey === asOfDateKey)
      .map((row) => [String(row.symbol), resolveMarketCapKrw(row)]),
  )
  const marketCapStats = initMarketCapStats()

  const candidates = []
  const symbols = Array.isArray(data.symbols)
    ? data.symbols
    : Array.from(featuresBySymbol.keys()).map((symbol) => ({ symbol }))

  for (const meta of symbols) {
    const symbol = String(meta?.symbol ?? "").trim()
    if (!symbol) {
      continue
    }
    const liquidity = Number(liquidityBySymbol.get(symbol) ?? 0)
    if (liquidity < minLiquidityValue) {
      continue
    }
    const capVerdict = evaluateMarketCap({
      marketCapKrw: marketCapBySymbol.get(symbol),
      excludeUnknown: excludeUnknownMarketCap,
    })
    trackMarketCap(marketCapStats, capVerdict)
    if (!capVerdict.pass) {
      continue
    }
    const features = featuresBySymbol.get(symbol)
    const seq = intradayBySymbol.get(symbol)
    if (needRules && !features) {
      continue
    }
    if (needShapes && !seq) {
      continue
    }

    const ruleScore = scoreRules(features, rules)
    const shapeScore = scoreShapes(seq, shapes, bins)
    const score = ruleScore.score + shapeScore.score
    const featureSnapshot = buildFeatureSnapshot({
      features,
      seq,
      rules,
      bins,
    })

    const reasons = buildReasonList(ruleScore.matches, shapeScore.best)
    if (requirePatternMatch && !reasons.length) {
      continue
    }
    const warnings = []
    if (!features) {
      warnings.push("피처가 없습니다")
    }
    if (!seq) {
      warnings.push("인트라데이 프로필이 없습니다")
    }
    if (!reasons.length) {
      warnings.push("패턴 점수가 비어있습니다")
    }

    candidates.push({
      symbol,
      name: String(meta?.name ?? symbol),
      market: String(meta?.market ?? "").trim() || null,
      track,
      score,
      liquidity,
      reasons,
      warnings,
      featureSnapshot,
    })
  }

  const epsilon = Number.isFinite(scoreEps) ? scoreEps : 1

  candidates.sort((a, b) => {
    if (b.score !== a.score) {
      if (Math.abs(b.score - a.score) <= epsilon) {
        return b.liquidity - a.liquidity
      }
      return b.score - a.score
    }
    return b.liquidity - a.liquidity
  })

  candidates.meta = {
    marketCapStats,
  }
  return candidates
}

export const recommendFromData = ({
  data,
  asOfDateKey,
  track,
  patterns,
  maxPicks,
  minLiquidity,
  scoreEps,
  vectorBins,
  excludeUnknownMarketCap = false,
  requireRuleInputs = true,
  requireShapeInputs = true,
  requirePatternMatch = true,
}) => {
  const candidates = buildRecommendCandidates({
    data,
    asOfDateKey,
    track,
    patterns,
    minLiquidity,
    scoreEps,
    vectorBins,
    excludeUnknownMarketCap,
    requireRuleInputs,
    requireShapeInputs,
    requirePatternMatch,
  })
  return candidates.slice(0, Math.max(1, maxPicks ?? 1))
}

export const scoreMoonshotCandidate = ({ candidate, features, seq }) => {
  const baseScore = Number(candidate?.score ?? 0) || 0
  const volumeRatio =
    getFeatureValue(features, "volume.valueRatio20") ??
    getFeatureValue(features, "volume.volumeRatio20") ??
    0
  const spread5_20 = getFeatureValue(features, "ma.spread5_20") ?? 0
  const spread20_60 = getFeatureValue(features, "ma.spread20_60") ?? 0
  const slope5 = getFeatureValue(features, "ma.slope5") ?? 0
  const slope20 = getFeatureValue(features, "ma.slope20") ?? 0
  const bodyPct = getFeatureValue(features, "candle.bodyPct") ?? 0
  const gapPct = getFeatureValue(features, "candle.gapPct") ?? 0

  const intradaySum = sumFinite(seq?.returnsSeq ?? [])
  const volumeScore = Math.max(0, volumeRatio - 1) * 40
  const trendScore =
    Math.max(0, spread5_20) * 500 +
    Math.max(0, spread20_60) * 300 +
    Math.max(0, slope5) * 400 +
    Math.max(0, slope20) * 300
  const intradayScore = intradaySum * 500
  const bodyScore = Math.max(0, bodyPct) * 20
  const gapPenalty = gapPct >= 0.03 ? -20 : 0
  const moonScore =
    baseScore +
    volumeScore +
    trendScore +
    intradayScore +
    bodyScore +
    gapPenalty

  return {
    moonScore,
    components: {
      baseScore,
      volumeRatio,
      spread5_20,
      spread20_60,
      slope5,
      slope20,
      intradaySum,
      bodyPct,
      gapPct,
    },
  }
}
