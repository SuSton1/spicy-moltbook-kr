import { normalizeDateKey, shiftDateKey } from "../ai-date-range.lib.mjs"
import { toWeekKeyKst } from "../lib/weekKey.mjs"

const normalizeList = (list) =>
  Array.isArray(list)
    ? list
        .map((value) => normalizeDateKey(value))
        .filter(Boolean)
        .sort((a, b) => String(a).localeCompare(String(b)))
    : []

export const computeMoonshot4wStats = (
  outcomes,
  validationStartDateKey,
  validationEndDateKey,
  tradingCalendar,
) => {
  const windowDays = 28
  const minSignalsPerWeek = 0
  const preferredSignalsPerWeek = 5
  const rule = "validation_only_non_overlapping_28d_bucket_success>=2"
  const start = normalizeDateKey(validationStartDateKey)
  const end = normalizeDateKey(validationEndDateKey)
  const calendar = normalizeList(tradingCalendar)
  const list = Array.isArray(outcomes) ? outcomes : []
  const normalizedOutcomes = list
    .map((row) => ({
      tradingDateKey: normalizeDateKey(row?.tradingDateKey),
      success: Boolean(row?.success),
    }))
    .filter((row) => row.tradingDateKey)

  if (!start || !end) {
    return {
      windowDays,
      bucketPolicy: "fixed_non_overlapping_28d_anchored_at_validationStart",
      rule,
      minSignalsPerWeek,
      preferredSignalsPerWeek,
      buckets: [],
      bucketsEvaluated: 0,
      bucketsFailed: 0,
      weeklySignals: {
        weeksEvaluated: 0,
        weeksMetMin: 0,
        weeksMetPreferred: 0,
        weeksFailedMin: 0,
        averageSignalsPerWeek: 0,
        preferenceCoveragePct: 0,
        pass: false,
        weeks: [],
      },
      overallPass: false,
      partialBuckets: [],
    }
  }

  const buckets = []
  const partialBuckets = []
  let bucketsEvaluated = 0
  let bucketsFailed = 0
  let cursor = start
  while (cursor && cursor <= end) {
    const bucketStartDateKey = cursor
    const bucketEndDateKey = shiftDateKey(bucketStartDateKey, windowDays - 1)
    if (!bucketEndDateKey) {
      break
    }
    const fullWindow = bucketEndDateKey <= end
    const tradingDaysCount = calendar.filter(
      (key) => key >= bucketStartDateKey && key <= bucketEndDateKey,
    ).length
    const successCount = normalizedOutcomes.filter(
      (row) =>
        row.tradingDateKey >= bucketStartDateKey &&
        row.tradingDateKey <= bucketEndDateKey &&
        row.success,
    ).length
    const eligible = fullWindow && tradingDaysCount >= 20
    const pass = eligible ? successCount >= 2 : false
    buckets.push({
      bucketStartDateKey,
      bucketEndDateKey,
      tradingDaysCount,
      successCount,
      pass,
      evaluated: eligible,
    })
    if (eligible) {
      bucketsEvaluated += 1
      if (!pass) {
        bucketsFailed += 1
      }
    } else {
      partialBuckets.push({
        bucketStartDateKey,
        bucketEndDateKey,
        reason: !fullWindow ? "PARTIAL_TAIL" : "INSUFFICIENT_TRADING_DAYS",
        tradingDaysCount,
      })
    }
    cursor = shiftDateKey(bucketStartDateKey, windowDays)
  }

  const weekKeys = []
  let lastWeekKey = null
  for (const dateKey of calendar) {
    if (dateKey < start || dateKey > end) {
      continue
    }
    const weekKey = toWeekKeyKst(dateKey)
    if (!weekKey || weekKey === "unknown") {
      continue
    }
    if (weekKey !== lastWeekKey) {
      weekKeys.push(weekKey)
      lastWeekKey = weekKey
    }
  }
  const signalCountByWeek = new Map(weekKeys.map((key) => [key, 0]))
  for (const row of normalizedOutcomes) {
    if (row.tradingDateKey < start || row.tradingDateKey > end) {
      continue
    }
    const weekKey = toWeekKeyKst(row.tradingDateKey)
    if (!weekKey || weekKey === "unknown") {
      continue
    }
    signalCountByWeek.set(weekKey, (signalCountByWeek.get(weekKey) ?? 0) + 1)
  }
  const weekRows = weekKeys.map((weekKey) => {
    const signalCount = signalCountByWeek.get(weekKey) ?? 0
    return {
      weekKey,
      signalCount,
      minPass: signalCount >= minSignalsPerWeek,
      preferredPass: signalCount >= preferredSignalsPerWeek,
    }
  })
  const weeksEvaluated = weekRows.length
  const weeksMetMin = weekRows.filter((row) => row.minPass).length
  const weeksMetPreferred = weekRows.filter((row) => row.preferredPass).length
  const weeksFailedMin = weekRows.filter((row) => !row.minPass).length
  const totalSignals = weekRows.reduce((sum, row) => sum + row.signalCount, 0)
  const averageSignalsPerWeek =
    weeksEvaluated > 0 ? totalSignals / weeksEvaluated : 0
  const preferenceCoveragePct =
    weeksEvaluated > 0 ? weeksMetPreferred / weeksEvaluated : 0
  const weeklySignalsPass = true

  return {
    windowDays,
    bucketPolicy: "fixed_non_overlapping_28d_anchored_at_validationStart",
    rule,
    minSignalsPerWeek,
    preferredSignalsPerWeek,
    buckets,
    bucketsEvaluated,
    bucketsFailed,
    weeklySignals: {
      weeksEvaluated,
      weeksMetMin,
      weeksMetPreferred,
      weeksFailedMin,
      averageSignalsPerWeek,
      preferenceCoveragePct,
      pass: weeklySignalsPass,
      weeks: weekRows,
    },
    overallPass: bucketsEvaluated > 0 && bucketsFailed === 0,
    partialBuckets,
  }
}
