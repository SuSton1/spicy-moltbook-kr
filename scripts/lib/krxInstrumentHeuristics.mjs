const BASE_BRAND_PREFIXES = [
  "TIGER",
  "KODEX",
  "KBSTAR",
  "ARIRANG",
  "HANARO",
  "KOSEF",
  "KINDEX",
  "TIMEFOLIO",
  "PLUS",
  "RISE",
  "ACE",
  "SOL",
]

const INDEX_TOKENS = [
  "지수",
  "인덱스",
  "INDEX",
  "KOSPI",
  "KOSDAQ",
  "S&P",
  "NASDAQ",
  "MSCI",
  "FTSE",
  "RUSSELL",
  "DOW",
  "미국",
  "중국",
  "일본",
  "유럽",
  "글로벌",
  "테크",
  "반도체",
  "조선",
  "2차전지",
  "AI",
  "로봇",
  "바이오",
]

const LEVERAGED_TOKENS = [
  "레버리지",
  "인버스",
  "2X",
  "2배",
  "선물",
  "FUTURES",
  "SWAP",
  "TRS",
  "SYNTHETIC",
]

const CASH_BOND_TOKENS = [
  "초단기",
  "단기",
  "단기채",
  "국채",
  "국고",
  "통안",
  "MMF",
  "머니마켓",
  "KOFR",
  "CD",
  "CP",
  "RP",
  "CMA",
  "채권",
]

const normalizePrefix = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()

export const normalizeName = (name) => {
  const raw = String(name ?? "").trim()
  const noSpace = raw.replace(/\s+/g, "")
  const upperRaw = raw.toUpperCase()
  const upperNoSpace = noSpace.toUpperCase()
  return { raw, noSpace, upperRaw, upperNoSpace }
}

const extractPrefix = (raw) => {
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) {
    return ""
  }
  const [prefix] = trimmed.split(/\s+/)
  return normalizePrefix(prefix)
}

const tokenMatches = (info, token) => {
  const upperToken = String(token ?? "").toUpperCase()
  return (
    info.upperRaw.includes(upperToken) || info.upperNoSpace.includes(upperToken)
  )
}

export const isPreferred = (noSpace) => {
  if (!noSpace) {
    return false
  }
  const upper = String(noSpace).toUpperCase()
  return /(?:\d+)?우(?:[A-Z])?$/.test(upper)
}

export const isSpac = (raw) => /스팩|SPAC/i.test(String(raw ?? ""))

export const isBondLike = (raw) =>
  /전환사채|신주인수권부사채|교환사채|채권|사채|\bCB\b|\bBW\b|\bEB\b/i.test(
    String(raw ?? ""),
  )

export const discoverBrandPrefixes = (
  symbolMasterRows,
  { minTotal = 10, minRatio = 0.95 } = {},
) => {
  const stats = new Map()
  for (const row of symbolMasterRows ?? []) {
    const info = normalizeName(row?.name)
    const prefix = extractPrefix(info.raw)
    if (!prefix) {
      continue
    }
    const entry = stats.get(prefix) ?? {
      prefix,
      total: 0,
      product: 0,
      common: 0,
    }
    entry.total += 1
    const type = String(row?.type ?? "").toUpperCase()
    const isProduct =
      type === "ETF" || type === "ETN" || type === "REIT" || type === "OTHER"
    if (isProduct) {
      entry.product += 1
    } else {
      entry.common += 1
    }
    stats.set(prefix, entry)
  }

  const prefixes = []
  for (const entry of stats.values()) {
    const ratio = entry.total ? entry.product / entry.total : 0
    if (entry.total >= minTotal && ratio >= minRatio) {
      prefixes.push(entry.prefix)
    }
  }

  prefixes.sort()
  const summary = Array.from(stats.values())
    .sort((a, b) => b.total - a.total)
    .map((entry) => ({
      prefix: entry.prefix,
      total: entry.total,
      product: entry.product,
      common: entry.common,
      ratio:
        entry.total > 0 ? Number((entry.product / entry.total).toFixed(3)) : 0,
    }))
  return { prefixes, summary }
}

export const productLikeReasons = ({
  name,
  type,
  brandPrefixes,
  autoBrandPrefixes,
}) => {
  const info = normalizeName(name)
  const prefix = extractPrefix(info.raw)
  const upperType = String(type ?? "")
    .trim()
    .toUpperCase()
  const isProductType =
    upperType === "ETF" ||
    upperType === "ETN" ||
    upperType === "REIT" ||
    upperType === "OTHER"
  const baseSet = new Set(
    (brandPrefixes ?? BASE_BRAND_PREFIXES).map(normalizePrefix),
  )
  const autoSet = new Set(
    (autoBrandPrefixes ?? []).map((value) => normalizePrefix(value)),
  )
  const isBrand = prefix && baseSet.has(prefix)
  const reasons = []
  const tokenMatchesSummary = {
    index: INDEX_TOKENS.some((token) => tokenMatches(info, token)),
    leveraged: LEVERAGED_TOKENS.some((token) => tokenMatches(info, token)),
    cashBond: CASH_BOND_TOKENS.some((token) => tokenMatches(info, token)),
  }

  if (!isBrand && !isProductType) {
    return {
      hit: false,
      reasons: [],
      prefix,
      tokenMatches: tokenMatchesSummary,
    }
  }

  if (isBrand) {
    reasons.push("EXCLUDE_FUND_BRAND")
    if (autoSet.has(prefix) && !BASE_BRAND_PREFIXES.includes(prefix)) {
      reasons.push("EXCLUDE_FUND_BRAND_AUTO")
    }
  }
  if (tokenMatchesSummary.index) {
    reasons.push("EXCLUDE_INDEX_PRODUCT")
  }
  if (tokenMatchesSummary.leveraged) {
    reasons.push("EXCLUDE_LEVERAGED_INVERSE")
  }
  if (tokenMatchesSummary.cashBond) {
    reasons.push("EXCLUDE_CASH_BOND_PRODUCT")
  }

  return {
    hit: reasons.length > 0,
    reasons,
    prefix,
    tokenMatches: tokenMatchesSummary,
  }
}

export const resolveBrandPrefixes = ({
  basePrefixes = BASE_BRAND_PREFIXES,
  autoPrefixes = [],
} = {}) => {
  const baseSet = new Set((basePrefixes ?? []).map(normalizePrefix))
  const autoSet = new Set((autoPrefixes ?? []).map(normalizePrefix))
  const merged = new Set([...baseSet, ...autoSet])
  return {
    base: baseSet,
    auto: autoSet,
    all: merged,
  }
}

export { BASE_BRAND_PREFIXES }
