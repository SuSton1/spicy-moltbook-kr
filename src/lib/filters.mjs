const isPreferred = (name) => {
  const t = String(name ?? "").trim().toUpperCase().replace(/\s+/g, "")
  return /(?:\d+)?우(?:[A-Z])?$/.test(t)
}

const isSpac = (name) => /스팩|SPAC/i.test(String(name ?? ""))

const isBondLike = (name) =>
  /전환사채|신주인수권부사채|교환사채|채권|사채|\bCB\b|\bBW\b|\bEB\b/i.test(
    String(name ?? ""),
  )

const toNum = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const evaluateInstrumentFilter = ({ symbol, meta, cfg }) => {
  const reasons = []
  const regex = new RegExp(String(cfg?.symbolRegex ?? "^[0-9]{6}$"))
  if (!regex.test(String(symbol ?? ""))) {
    reasons.push("SYMBOL_REGEX_FAIL")
  }
  if (meta?.isListed === false) {
    reasons.push("DELISTED")
  }
  const type = String(meta?.type ?? "").toUpperCase()
  const excludedTypes = new Set((cfg?.excludeTypes ?? []).map((v) => String(v).toUpperCase()))
  if (excludedTypes.has(type)) {
    reasons.push(`EXCLUDED_TYPE:${type}`)
  }
  const name = meta?.name ?? ""
  if (cfg?.excludePreferred && isPreferred(name)) {
    reasons.push("EXCLUDED_PREFERRED")
  }
  if (cfg?.excludeSpac && isSpac(name)) {
    reasons.push("EXCLUDED_SPAC")
  }
  if (cfg?.excludeBondLike && isBondLike(name)) {
    reasons.push("EXCLUDED_BONDLIKE")
  }
  return { pass: reasons.length === 0, reasons }
}

export const evaluateGapTradabilityFilter = ({ cfg, prevClose }) => {
  const reasons = []
  const gapCfg = cfg?.gapTradability ?? {}
  if (!gapCfg?.enabled) return { pass: true, reasons }

  const prev = toNum(prevClose)

  if (gapCfg.requirePrevClose && !Number.isFinite(prev)) {
    reasons.push("MISSING_PREVCLOSE")
  }

  return { pass: reasons.length === 0, reasons }
}

export const evaluateCoreFilters = ({ cfg, universeRow }) => {
  const reasons = []
  const mcap = toNum(universeRow?.marketCapKrw)
  const minCap = toNum(cfg?.minMarketCapKrw)
  const maxCap = toNum(cfg?.maxMarketCapKrw)
  const liq = toNum(universeRow?.avgTradingValue20d)
  const minLiq = toNum(cfg?.minAvgTradingValue20dKrw)

  if (!Number.isFinite(mcap)) {
    if (cfg?.excludeUnknownMarketCap) reasons.push("MCAP_MISSING")
  } else {
    if (Number.isFinite(minCap) && mcap <= minCap) reasons.push("MCAP_BELOW_MIN")
    if (Number.isFinite(maxCap) && mcap >= maxCap) reasons.push("MCAP_ABOVE_MAX")
  }

  if (!Number.isFinite(liq)) {
    reasons.push("LIQUIDITY_MISSING")
  } else if (Number.isFinite(minLiq) && liq < minLiq) {
    reasons.push("LIQUIDITY_BELOW_MIN")
  }

  return { pass: reasons.length === 0, reasons }
}
