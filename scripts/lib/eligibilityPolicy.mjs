import {
  BASE_BRAND_PREFIXES,
  isBondLike,
  isPreferred,
  isSpac,
  normalizeName,
  productLikeReasons,
  resolveBrandPrefixes,
} from "./krxInstrumentHeuristics.mjs"
import {
  evaluateMarketCap,
  MARKET_CAP_MAX_KRW,
  MARKET_CAP_MIN_KRW,
  resolveMarketCapKrw,
} from "./marketCapFilter.mjs"

const normalizeType = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()

export const resolveEligibilityConfig = (cfg = {}) => ({
  minMarketCapKrw: cfg.minMarketCapKrw ?? MARKET_CAP_MIN_KRW,
  maxMarketCapKrw: cfg.maxMarketCapKrw ?? MARKET_CAP_MAX_KRW,
  // If false (default), unknown market cap is allowed and should be tracked as coverage.
  excludeUnknownMarketCap: cfg.excludeUnknownMarketCap ?? false,
  brandPrefixes: cfg.brandPrefixes ?? BASE_BRAND_PREFIXES,
  autoBrandPrefixes: cfg.autoBrandPrefixes ?? [],
})

export const instrumentExclusionReasons = (symbolMasterRow, cfg = {}) => {
  const config = resolveEligibilityConfig(cfg)
  const reasons = []
  const type = normalizeType(symbolMasterRow?.type)

  if (symbolMasterRow?.isListed === false) {
    reasons.push("EXCLUDE_DELISTED")
  }

  if (type === "ETF") {
    reasons.push("EXCLUDE_ETF")
  } else if (type === "ETN") {
    reasons.push("EXCLUDE_ETN")
  } else if (type === "REIT") {
    reasons.push("EXCLUDE_REIT")
  } else if (type === "OTHER") {
    reasons.push("EXCLUDE_OTHER_TYPE")
  }

  const nameInfo = normalizeName(symbolMasterRow?.name)
  if (isPreferred(nameInfo.noSpace)) {
    reasons.push("EXCLUDE_PREFERRED")
  }
  if (isSpac(nameInfo.raw)) {
    reasons.push("EXCLUDE_SPAC")
  }
  if (isBondLike(nameInfo.raw)) {
    reasons.push("EXCLUDE_BONDLIKE")
  }

  const brandConfig = resolveBrandPrefixes({
    basePrefixes: config.brandPrefixes,
    autoPrefixes: config.autoBrandPrefixes,
  })
  const product = productLikeReasons({
    name: nameInfo.raw,
    type,
    brandPrefixes: Array.from(brandConfig.all),
    autoBrandPrefixes: Array.from(brandConfig.auto),
  })
  if (product?.reasons?.length) {
    reasons.push(...product.reasons)
  }

  return {
    excluded: reasons.length > 0,
    reasons,
    type,
  }
}

export const marketCapExclusionReasons = (marketCapKrw, cfg = {}) => {
  const config = resolveEligibilityConfig(cfg)
  const resolvedCap =
    typeof marketCapKrw === "object" && marketCapKrw !== null
      ? resolveMarketCapKrw(marketCapKrw)
      : marketCapKrw

  const verdict = evaluateMarketCap({
    marketCapKrw: resolvedCap,
    minCap: config.minMarketCapKrw,
    maxCap: config.maxMarketCapKrw,
    excludeUnknown: Boolean(config.excludeUnknownMarketCap),
  })

  if (verdict.status === "UNKNOWN") {
    return verdict.pass
      ? { excluded: false, reasons: [], cap: null }
      : {
          excluded: true,
          reasons: ["EXCLUDE_MCAP_MISSING"],
          cap: null,
        }
  }

  if (!verdict.pass) {
    const cap = verdict.cap
    if (Number.isFinite(cap)) {
      if (cap <= config.minMarketCapKrw) {
        return { excluded: true, reasons: ["EXCLUDE_MCAP_BELOW_MIN"], cap }
      }
      if (cap >= config.maxMarketCapKrw) {
        return { excluded: true, reasons: ["EXCLUDE_MCAP_ABOVE_MAX"], cap }
      }
    }
    return { excluded: true, reasons: ["EXCLUDE_MCAP_OUT_OF_RANGE"], cap }
  }

  return { excluded: false, reasons: [], cap: verdict.cap }
}

export const isEligibleForDate = ({
  symbolMasterRow,
  marketCapKrw,
  cfg = {},
}) => {
  const instrument = instrumentExclusionReasons(symbolMasterRow, cfg)
  const capResult = marketCapExclusionReasons(marketCapKrw, cfg)
  const reasons = [...instrument.reasons, ...capResult.reasons]
  return {
    eligible: !instrument.excluded && !capResult.excluded,
    reasons,
    instrumentReasons: instrument.reasons,
    marketCapReasons: capResult.reasons,
    cap: capResult.cap,
  }
}
