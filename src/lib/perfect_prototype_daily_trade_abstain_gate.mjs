const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const quantile = (values = [], q = 0.5) => {
  const filtered = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (filtered.length < 1) return null
  if (filtered.length === 1) return filtered[0]
  const clamped = Math.max(0, Math.min(1, Number(q) || 0))
  const position = (filtered.length - 1) * clamped
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return filtered[lowerIndex]
  const fraction = position - lowerIndex
  return filtered[lowerIndex] + (filtered[upperIndex] - filtered[lowerIndex]) * fraction
}

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const uniqueStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const summarizeDates = (rows = []) => ({
  selectedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  selectedMonthCount: new Set((rows ?? []).map((row) => buildMonthKey(row?.dateKey)).filter(Boolean)).size,
  selectedFoldCount: new Set((rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
})

const featureBucketOf = (featureKey) => String(featureKey ?? "").split(".").slice(0, 3).join(".")

const collectFeatureCandidates = ({ positiveRows = [], negativeRows = [], featureKeys = [], maxFeaturePool = 5 } = {}) => {
  const scored = []
  for (const featureKey of uniqueStrings(featureKeys)) {
    const positiveValues = positiveRows.map((row) => num(row?.numericFeatureMap?.[featureKey])).filter(Number.isFinite)
    const negativeValues = negativeRows.map((row) => num(row?.numericFeatureMap?.[featureKey])).filter(Number.isFinite)
    if (positiveValues.length < 3 || negativeValues.length < 3) continue
    const positiveMean = average(positiveValues)
    const negativeMean = average(negativeValues)
    if (!Number.isFinite(positiveMean) || !Number.isFinite(negativeMean)) continue
    const scale = Math.max(
      0.05,
      Number(quantile([...positiveValues, ...negativeValues], 0.9) ?? 0) -
        Number(quantile([...positiveValues, ...negativeValues], 0.1) ?? 0),
      Math.abs(positiveMean - negativeMean),
    )
    const separation = Math.abs(positiveMean - negativeMean) / Math.max(0.05, scale)
    if (separation < 0.05) continue
    scored.push({
      featureKey,
      direction: positiveMean >= negativeMean ? 1 : -1,
      separation,
      bucket: featureBucketOf(featureKey),
      thresholds:
        positiveMean >= negativeMean
          ? uniqueStrings([
              String(quantile(negativeValues, 0.9) ?? ""),
              String(quantile(negativeValues, 0.8) ?? ""),
              String((Number(quantile(positiveValues, 0.25) ?? 0) + Number(quantile(negativeValues, 0.75) ?? 0)) / 2),
              String((Number(quantile(positiveValues, 0.5) ?? 0) + Number(quantile(negativeValues, 0.5) ?? 0)) / 2),
            ]).map(Number).filter(Number.isFinite)
          : uniqueStrings([
              String(quantile(negativeValues, 0.1) ?? ""),
              String(quantile(negativeValues, 0.2) ?? ""),
              String((Number(quantile(positiveValues, 0.75) ?? 0) + Number(quantile(negativeValues, 0.25) ?? 0)) / 2),
              String((Number(quantile(positiveValues, 0.5) ?? 0) + Number(quantile(negativeValues, 0.5) ?? 0)) / 2),
            ]).map(Number).filter(Number.isFinite),
    })
  }
  scored.sort((left, right) => right.separation - left.separation || left.featureKey.localeCompare(right.featureKey))
  const selected = []
  const bucketCounts = new Map()
  for (const entry of scored) {
    const bucket = entry.bucket
    const count = Number(bucketCounts.get(bucket) ?? 0)
    if (count >= 2) continue
    selected.push(entry)
    bucketCounts.set(bucket, count + 1)
    if (selected.length >= Math.max(1, Math.floor(Number(maxFeaturePool) || 5))) break
  }
  return selected
}

const combinations = (items = [], size = 1) => {
  const out = []
  const visit = (start, picked) => {
    if (picked.length === size) {
      out.push(picked.slice())
      return
    }
    for (let index = start; index < items.length; index += 1) {
      picked.push(items[index])
      visit(index + 1, picked)
      picked.pop()
    }
  }
  if (size <= 0 || size > items.length) return out
  visit(0, [])
  return out
}

const thresholdProducts = (features = []) => {
  const out = []
  const visit = (index, picked) => {
    if (index >= features.length) {
      out.push(picked.slice())
      return
    }
    const thresholds = Array.isArray(features[index]?.thresholds) && features[index].thresholds.length > 0
      ? Array.from(new Set(features[index].thresholds.map((value) => Number(value)).filter(Number.isFinite)))
      : [0]
    for (const threshold of thresholds) {
      picked.push(threshold)
      visit(index + 1, picked)
      picked.pop()
    }
  }
  visit(0, [])
  return out
}

const rowPassesFeature = ({ row, featureKey, direction, threshold }) => {
  const rawValue = num(row?.numericFeatureMap?.[featureKey])
  if (!Number.isFinite(rawValue)) return false
  return Number(direction ?? 1) >= 0 ? rawValue >= Number(threshold ?? 0) : rawValue <= Number(threshold ?? 0)
}

const evaluateCandidate = ({ positiveRows = [], negativeRows = [], supportRows = [], selectedFeatures = [] } = {}) => {
  const positiveSelected = positiveRows.filter((row) =>
    selectedFeatures.every((feature) =>
      rowPassesFeature({
        row,
        featureKey: feature.featureKey,
        direction: feature.direction,
        threshold: feature.threshold,
      }),
    ),
  )
  const negativeSelected = negativeRows.filter((row) =>
    selectedFeatures.every((feature) =>
      rowPassesFeature({
        row,
        featureKey: feature.featureKey,
        direction: feature.direction,
        threshold: feature.threshold,
      }),
    ),
  )
  const supportSelected = supportRows.filter((row) =>
    selectedFeatures.every((feature) =>
      rowPassesFeature({
        row,
        featureKey: feature.featureKey,
        direction: feature.direction,
        threshold: feature.threshold,
      }),
    ),
  )
  const selectedTotal = positiveSelected.length + negativeSelected.length
  const precision = selectedTotal > 0 ? positiveSelected.length / selectedTotal : 0
  return {
    selectedFeatures,
    admittedTradeDateKeys: positiveSelected.map((row) => row.dateKey).filter(Boolean).sort((left, right) => left.localeCompare(right)),
    controlLeakDateKeys: negativeSelected.map((row) => row.dateKey).filter(Boolean).sort((left, right) => left.localeCompare(right)),
    supportProjectionPositive: supportSelected.length > 0,
    tradeGatePrecision: precision,
    controlLeakCount: negativeSelected.length,
    ...summarizeDates(positiveSelected),
  }
}

const compareCandidates = (left, right) => {
  if (right.tradeGatePrecision !== left.tradeGatePrecision) return right.tradeGatePrecision - left.tradeGatePrecision
  if (right.controlLeakCount !== left.controlLeakCount) return left.controlLeakCount - right.controlLeakCount
  if (right.selectedDateCount !== left.selectedDateCount) return right.selectedDateCount - left.selectedDateCount
  if (right.selectedMonthCount !== left.selectedMonthCount) return right.selectedMonthCount - left.selectedMonthCount
  return left.selectedFeatures.length - right.selectedFeatures.length
}

export const calibratePerfectPrototypeDailyTradeAbstainGate = ({
  family,
  minTradeDates = 10,
  minTradeMonths = 6,
  minTradeFolds = 4,
  maxFeaturePool = 5,
  maxFeatureCount = 3,
} = {}) => {
  const positiveRows = Array.isArray(family?.tradeDateRows) ? family.tradeDateRows : []
  const negativeRows = Array.isArray(family?.abstainDateRows) ? family.abstainDateRows : []
  const supportRows = Array.isArray(family?.supportTradeDateRows) ? family.supportTradeDateRows : []
  const candidateFeatures = collectFeatureCandidates({
    positiveRows,
    negativeRows,
    featureKeys: family?.tradeGateFeatureKeys ?? [],
    maxFeaturePool,
  })
  const candidates = []
  for (let featureCount = 1; featureCount <= Math.min(candidateFeatures.length, Math.max(1, Math.floor(Number(maxFeatureCount) || 3))); featureCount += 1) {
    for (const subset of combinations(candidateFeatures, featureCount)) {
      for (const thresholdVector of thresholdProducts(subset)) {
        const selectedFeatures = subset.map((feature, index) => ({
          featureKey: feature.featureKey,
          direction: feature.direction,
          threshold: thresholdVector[index],
          separation: feature.separation,
        }))
        candidates.push(
          evaluateCandidate({
            positiveRows,
            negativeRows,
            supportRows,
            selectedFeatures,
          }),
        )
      }
    }
  }
  candidates.sort(compareCandidates)
  const qualified = candidates.filter(
    (candidate) =>
      candidate.tradeGatePrecision === 1 &&
      candidate.controlLeakCount === 0 &&
      candidate.selectedDateCount >= Math.max(1, Math.floor(Number(minTradeDates) || 10)) &&
      candidate.selectedMonthCount >= Math.max(1, Math.floor(Number(minTradeMonths) || 6)) &&
      candidate.selectedFoldCount >= Math.max(1, Math.floor(Number(minTradeFolds) || 4)) &&
      candidate.supportProjectionPositive === true,
  )
  const bestCandidate = candidates[0] ?? null
  const bestQualified = qualified[0] ?? null
  const ok = Boolean(bestQualified)
  const reason = ok
    ? null
    : bestCandidate?.tradeGatePrecision !== 1
      ? "unsat_trade_gate_precision"
      : bestCandidate?.controlLeakCount > 0
        ? "unsat_trade_gate_control_leak"
        : bestCandidate?.selectedDateCount < Math.max(1, Math.floor(Number(minTradeDates) || 10))
          ? "unsat_trade_gate_breadth"
          : bestCandidate?.supportProjectionPositive !== true
            ? "unsat_trade_gate_support_projection"
            : "unsat_trade_gate_no_candidate"

  return {
    ...family,
    ok,
    reason,
    tradeGateSelectedFeatureKeys: (bestQualified?.selectedFeatures ?? bestCandidate?.selectedFeatures ?? []).map(
      (feature) => feature.featureKey,
    ),
    tradeGateArtifact: bestQualified ?? null,
    admittedTradeDateKeys: bestQualified?.admittedTradeDateKeys ?? [],
    summary: {
      ...(family?.summary ?? {}),
      tradeGateCandidateCount: candidates.length,
      tradeGateQualifiedCandidateCount: qualified.length,
      tradeGatePrecision: Number(bestQualified?.tradeGatePrecision ?? bestCandidate?.tradeGatePrecision ?? 0),
      tradeGateControlLeakCount: Number(bestQualified?.controlLeakCount ?? bestCandidate?.controlLeakCount ?? 0),
      tradeGateSelectedDateCount: Number(bestQualified?.selectedDateCount ?? bestCandidate?.selectedDateCount ?? 0),
      tradeGateSelectedMonthCount: Number(bestQualified?.selectedMonthCount ?? bestCandidate?.selectedMonthCount ?? 0),
      tradeGateSelectedFoldCount: Number(bestQualified?.selectedFoldCount ?? bestCandidate?.selectedFoldCount ?? 0),
      tradeGateSupportProjectionPositive:
        bestQualified?.supportProjectionPositive === true || bestCandidate?.supportProjectionPositive === true,
      tradeGateBestCandidate: bestCandidate ?? null,
    },
  }
}
