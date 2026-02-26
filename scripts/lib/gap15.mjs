import { buildIntradayProfileSeq } from "./intradayProfile.mjs"

const toNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const stdev = (values) => {
  const list = values.filter((value) => Number.isFinite(value))
  if (!list.length) {
    return null
  }
  const mean = list.reduce((acc, value) => acc + value, 0) / list.length
  const variance =
    list.reduce((acc, value) => acc + (value - mean) ** 2, 0) / list.length
  return Math.sqrt(variance)
}

export const buildGapIntradaySeq = ({
  rows,
  maxHour = 14,
  strictAfter1500 = false,
}) => {
  const list = Array.isArray(rows) ? rows : []
  let hasAfter1500 = false
  const filtered = list.filter((row) => {
    const ts = row?.tsKst ? new Date(row.tsKst) : null
    if (!ts || Number.isNaN(ts.getTime())) {
      return false
    }
    // `tsKst` is stored as a UTC timestamp whose UTC hour equals the KST hour.
    // Use UTC accessors so behavior is stable regardless of server timezone.
    const hour = ts.getUTCHours()
    if (hour > maxHour) {
      hasAfter1500 = true
      return false
    }
    return true
  })
  if (hasAfter1500 && strictAfter1500) {
    throw new Error("GAP_INTRADAY_AFTER_1500")
  }
  const seq = buildIntradayProfileSeq(filtered)
  return { seq, hasAfter1500 }
}

export const buildGapIntradayFeatures = (seq) => {
  const closeSeq = Array.isArray(seq?.closeSeq) ? seq.closeSeq : []
  const returnsSeq = Array.isArray(seq?.returnsSeq) ? seq.returnsSeq : []
  const len = closeSeq.length
  if (len < 2) {
    return { mom12_15: null, mom13_15: null, mom14_15: null, volProxy: null }
  }
  const last = toNumber(closeSeq[len - 1])
  const m1 = toNumber(closeSeq[len - 2])
  const m2 = len >= 3 ? toNumber(closeSeq[len - 3]) : null
  const m3 = len >= 4 ? toNumber(closeSeq[len - 4]) : null
  const mom14_15 =
    Number.isFinite(last) && Number.isFinite(m1) && m1 !== 0
      ? last / m1 - 1
      : null
  const mom13_15 =
    Number.isFinite(last) && Number.isFinite(m2) && m2 !== 0
      ? last / m2 - 1
      : null
  const mom12_15 =
    Number.isFinite(last) && Number.isFinite(m3) && m3 !== 0
      ? last / m3 - 1
      : null
  const volProxy = stdev(
    returnsSeq.map((value) => toNumber(value)).filter(Number.isFinite),
  )
  return { mom12_15, mom13_15, mom14_15, volProxy }
}

export const buildGapOverlayFeatures = ({
  prevFeatures,
  price15,
  prevClose,
  intradaySeq,
}) => {
  const base =
    prevFeatures && typeof prevFeatures === "object" ? prevFeatures : {}
  const gap1500Pct =
    Number.isFinite(price15) && Number.isFinite(prevClose) && prevClose !== 0
      ? price15 / prevClose - 1
      : null
  const intraday =
    intradaySeq && intradaySeq.closeSeq?.length
      ? buildGapIntradayFeatures(intradaySeq)
      : (base.intraday ?? null)
  return {
    ...base,
    candle: {
      ...(base.candle ?? {}),
      gapPct: gap1500Pct,
    },
    intraday,
  }
}

export const buildGapFeatureDays = ({
  symbols,
  asOfDateKey,
  prevFeaturesBySymbol,
  price15BySymbol,
  prevCloseBySymbol,
  intradaySeqBySymbol,
}) => {
  const list = Array.isArray(symbols) ? symbols : []
  return list
    .map((meta) => {
      const symbol = String(meta?.symbol ?? "").trim()
      if (!symbol) {
        return null
      }
      const prevFeatures = prevFeaturesBySymbol?.get(symbol) ?? null
      const price15 = price15BySymbol?.get(symbol)
      const prevClose = prevCloseBySymbol?.get(symbol)
      const intradaySeq = intradaySeqBySymbol?.get(symbol) ?? null
      const features = buildGapOverlayFeatures({
        prevFeatures,
        price15,
        prevClose,
        intradaySeq,
      })
      return { symbol, tradingDateKey: asOfDateKey, features }
    })
    .filter(Boolean)
}

export const filterCandlesToPrevTradingDay = ({ candles, prevTradingDay }) => {
  const list = Array.isArray(candles) ? candles : []
  if (!prevTradingDay) {
    return list
  }
  return list.filter((row) => row?.dateKey && row.dateKey <= prevTradingDay)
}
