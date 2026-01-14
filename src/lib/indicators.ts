export type Candle = {
  time: string | number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type LinePoint = { time: string | number; value: number }

export const simpleMovingAverage = (
  data: Candle[],
  period: number,
): LinePoint[] => {
  if (data.length < period) {
    return []
  }
  const result: LinePoint[] = []
  let sum = 0
  for (let i = 0; i < data.length; i += 1) {
    sum += data[i].close
    if (i >= period) {
      sum -= data[i - period].close
    }
    if (i >= period - 1) {
      result.push({ time: data[i].time, value: sum / period })
    }
  }
  return result
}

const ema = (values: number[], period: number) => {
  if (values.length === 0) {
    return [] as number[]
  }
  const k = 2 / (period + 1)
  const result: number[] = []
  let prev = values[0]
  result.push(prev)
  for (let i = 1; i < values.length; i += 1) {
    const next = values[i] * k + prev * (1 - k)
    result.push(next)
    prev = next
  }
  return result
}

export const calcMacd = (data: Candle[]) => {
  const closes = data.map((item) => item.close)
  const fast = ema(closes, 12)
  const slow = ema(closes, 26)
  const macd = fast.map((value, index) => value - (slow[index] ?? value))
  const signal = ema(macd, 9)
  const histogram = macd.map((value, index) => value - (signal[index] ?? value))
  return {
    macd: data.map((item, index) => ({
      time: item.time,
      value: macd[index] ?? 0,
    })),
    signal: data.map((item, index) => ({
      time: item.time,
      value: signal[index] ?? 0,
    })),
    histogram: data.map((item, index) => ({
      time: item.time,
      value: histogram[index] ?? 0,
    })),
  }
}

export const calcCci = (data: Candle[], period = 20) => {
  if (data.length < period) {
    return [] as LinePoint[]
  }
  const typical = data.map((item) => (item.high + item.low + item.close) / 3)
  const result: LinePoint[] = []
  for (let i = period - 1; i < data.length; i += 1) {
    const slice = typical.slice(i - period + 1, i + 1)
    const mean = slice.reduce((acc, value) => acc + value, 0) / period
    const meanDeviation =
      slice.reduce((acc, value) => acc + Math.abs(value - mean), 0) / period
    const cci =
      meanDeviation === 0 ? 0 : (typical[i] - mean) / (0.015 * meanDeviation)
    result.push({ time: data[i].time, value: cci })
  }
  return result
}

export const calcObv = (data: Candle[]) => {
  let current = 0
  return data.map((item, index) => {
    if (index === 0) {
      current = item.volume
    } else {
      const prev = data[index - 1].close
      if (item.close > prev) {
        current += item.volume
      } else if (item.close < prev) {
        current -= item.volume
      }
    }
    return { time: item.time, value: current }
  })
}

export const calcIchimoku = (data: Candle[]) => {
  const calcLine = (period: number) =>
    data.map((item, index) => {
      if (index < period - 1) {
        return { time: item.time, value: item.close }
      }
      const slice = data.slice(index - period + 1, index + 1)
      const high = Math.max(...slice.map((point) => point.high))
      const low = Math.min(...slice.map((point) => point.low))
      return { time: item.time, value: (high + low) / 2 }
    })
  return {
    conversion: calcLine(9),
    base: calcLine(26),
    spanA: calcLine(9).map((item, index) => ({
      time: item.time,
      value: (item.value + (calcLine(26)[index]?.value ?? item.value)) / 2,
    })),
    spanB: calcLine(52),
  }
}

export const calcVolumeProfile = (data: Candle[], bins = 12) => {
  if (data.length === 0) {
    return [] as { price: number; volume: number }[]
  }
  const highs = data.map((item) => item.high)
  const lows = data.map((item) => item.low)
  const max = Math.max(...highs)
  const min = Math.min(...lows)
  const step = (max - min) / bins || 1
  const buckets = Array.from({ length: bins }).map((_, index) => ({
    price: min + step * (index + 0.5),
    volume: 0,
  }))

  data.forEach((item) => {
    const avgPrice = (item.high + item.low + item.close + item.open) / 4
    const index = Math.min(
      bins - 1,
      Math.max(0, Math.floor((avgPrice - min) / step)),
    )
    buckets[index].volume += item.volume
  })

  return buckets
}

export const calcTrendLine = (data: Candle[]) => {
  const length = data.length
  if (length < 2) {
    return null
  }
  const xs = data.map((_, index) => index)
  const ys = data.map((item) => item.close)
  const meanX = xs.reduce((acc, x) => acc + x, 0) / length
  const meanY = ys.reduce((acc, y) => acc + y, 0) / length
  const numerator = xs.reduce(
    (acc, x, index) => acc + (x - meanX) * (ys[index] - meanY),
    0,
  )
  const denominator = xs.reduce((acc, x) => acc + (x - meanX) ** 2, 0) || 1
  const slope = numerator / denominator
  const intercept = meanY - slope * meanX
  return {
    start: { time: data[0].time, value: intercept },
    end: {
      time: data[length - 1].time,
      value: intercept + slope * (length - 1),
    },
    slope,
  }
}

export const calcSupportResistance = (data: Candle[], count = 3) => {
  if (data.length === 0) {
    return { highs: [], lows: [] as number[] }
  }
  const highs = [...data].map((item) => item.high).sort((a, b) => b - a)
  const lows = [...data].map((item) => item.low).sort((a, b) => a - b)
  return {
    highs: Array.from(new Set(highs)).slice(0, count),
    lows: Array.from(new Set(lows)).slice(0, count),
  }
}

export const detectConvergence = (data: Candle[], windowSize = 20) => {
  if (data.length < windowSize) {
    return false
  }
  const slice = data.slice(-windowSize)
  const highs = slice.map((item) => item.high)
  const lows = slice.map((item) => item.low)
  return highs[0] > highs[highs.length - 1] && lows[0] < lows[lows.length - 1]
}
