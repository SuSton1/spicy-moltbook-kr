const toNumber = (value, fallback = null) => {
  if (value === null || value === undefined) {
    return fallback
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value)
    return Number.isFinite(asNumber) ? asNumber : fallback
  }
  if (value instanceof Date) {
    const ts = value.getTime()
    return Number.isFinite(ts) ? ts : fallback
  }
  const asNumber = Number(value)
  return Number.isFinite(asNumber) ? asNumber : fallback
}

const toTs = (value) => {
  if (value instanceof Date) {
    return value.getTime()
  }
  const ts = Number(value)
  if (Number.isFinite(ts)) {
    return ts
  }
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

export const buildIntradayProfileSeq = (rows) => {
  const sorted = Array.isArray(rows) ? [...rows] : []
  sorted.sort((a, b) => {
    const tsA = toTs(a?.tsKst) ?? 0
    const tsB = toTs(b?.tsKst) ?? 0
    return tsA - tsB
  })

  const closeSeq = []
  const valueSeq = []
  const rangeSeq = []
  const returnsSeq = []

  let prevClose = null
  for (const row of sorted) {
    const close = toNumber(row?.close)
    if (!Number.isFinite(close)) {
      continue
    }
    const volume = toNumber(row?.volume, 0) ?? 0
    const high = toNumber(row?.high)
    const low = toNumber(row?.low)

    closeSeq.push(close)
    valueSeq.push(Number.isFinite(volume) ? close * volume : null)
    if (Number.isFinite(high) && Number.isFinite(low) && close !== 0) {
      rangeSeq.push((high - low) / close)
    } else {
      rangeSeq.push(null)
    }

    if (Number.isFinite(prevClose) && prevClose !== 0) {
      returnsSeq.push(close / prevClose - 1)
    } else {
      returnsSeq.push(0)
    }
    prevClose = close
  }

  return {
    closeSeq,
    valueSeq,
    rangeSeq,
    returnsSeq,
  }
}
