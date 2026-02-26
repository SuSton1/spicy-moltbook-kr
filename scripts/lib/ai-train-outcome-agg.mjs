export const createOutcomeAgg = () => ({
  n: 0,
  target: 0,
  stop: 0,
  neutral: 0,
  tttSum: 0,
  tttCount: 0,
})

export const applyOutcomeAgg = (agg, label) => {
  agg.n += 1
  if (label.outcome === "target") agg.target += 1
  else if (label.outcome === "stop") agg.stop += 1
  else agg.neutral += 1
  if (typeof label.tttDays === "number") {
    agg.tttSum += label.tttDays
    agg.tttCount += 1
  }
}

export const finalizeOutcomeAgg = (agg) => {
  const n = agg.n
  return {
    n,
    pTarget: n ? agg.target / n : 0,
    pStop: n ? agg.stop / n : 0,
    pNeutral: n ? agg.neutral / n : 0,
    meanTTT: agg.tttCount ? agg.tttSum / agg.tttCount : null,
  }
}
