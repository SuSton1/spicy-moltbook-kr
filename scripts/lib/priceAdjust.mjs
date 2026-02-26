const toNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const getAdjFactor = (row) => {
  const rawClose = toNumber(row?.close ?? row?.rawClose ?? row?.unadjustedClose)
  const adjClose = toNumber(
    row?.adjClose ?? row?.adjustedClose ?? row?.adj_close ?? row?.closeAdjusted,
  )
  const adjFactor = toNumber(row?.adjFactor)
  if (row?.__adjusted === true) {
    const factor = Number.isFinite(adjFactor) && adjFactor > 0 ? adjFactor : 1
    return {
      factor: 1,
      price15Factor: factor,
      source: "pre_adjusted",
      missingReason: null,
    }
  }
  if (Number.isFinite(adjFactor) && adjFactor > 0) {
    return {
      factor: adjFactor,
      price15Factor: adjFactor,
      source: "adjFactor",
      missingReason: null,
    }
  }
  if (Number.isFinite(adjClose) && Number.isFinite(rawClose) && rawClose > 0) {
    const factor = adjClose / rawClose
    return {
      factor,
      price15Factor: factor,
      source: "adjClose",
      missingReason: null,
    }
  }
  return {
    factor: 1,
    price15Factor: 1,
    source: "missing",
    missingReason: "ADJUSTED_NOT_AVAILABLE",
  }
}

export const getEvalPrice = (price, factor) => {
  const value = toNumber(price)
  const adj = toNumber(factor)
  if (!Number.isFinite(value)) {
    return value
  }
  if (!Number.isFinite(adj)) {
    return value
  }
  return value * adj
}

export const getEvalOhlc = (row) => {
  const open = toNumber(row?.open)
  const high = toNumber(row?.high)
  const low = toNumber(row?.low)
  const close = toNumber(row?.close)
  const factorMeta = getAdjFactor(row)
  const factor = Number.isFinite(factorMeta.factor) ? factorMeta.factor : 1
  return {
    open: getEvalPrice(open, factor),
    high: getEvalPrice(high, factor),
    low: getEvalPrice(low, factor),
    close: getEvalPrice(close, factor),
    adjustedFactor: Number.isFinite(factorMeta.price15Factor)
      ? factorMeta.price15Factor
      : 1,
    adjustedSource: factorMeta.source,
    adjustedMetaMissingReason: factorMeta.missingReason,
  }
}
