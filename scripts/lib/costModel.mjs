const toNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const DEFAULT_COMMISSION_ROUND_TRIP_PCT = 0.0043

export const resolveCostModel = (input = {}) => {
  const entryFeeBps = toNumber(input.entryFeeBps)
  const exitFeeBps = toNumber(input.exitFeeBps)
  const taxBps = toNumber(input.taxBps)
  const slippageBps = toNumber(input.slippageBps)
  const hasLegacyBps =
    entryFeeBps !== null ||
    exitFeeBps !== null ||
    taxBps !== null ||
    slippageBps !== null

  if (hasLegacyBps) {
    const totalBps =
      (entryFeeBps ?? 0) +
      (exitFeeBps ?? 0) +
      (taxBps ?? 0) +
      (slippageBps ?? 0)
    return {
      mode: "legacy_bps",
      entryFeeBps: entryFeeBps ?? 0,
      exitFeeBps: exitFeeBps ?? 0,
      taxBps: taxBps ?? 0,
      slippageBps: slippageBps ?? 0,
      totalBps,
      totalPct: totalBps / 100,
    }
  }

  const commissionRoundTripPct = toNumber(input.commissionRoundTripPct)
  const commissionEntryPct = toNumber(input.commissionEntryPct)
  const commissionExitPct = toNumber(input.commissionExitPct)
  const slippageRoundTripPct = toNumber(input.slippageRoundTripPct) ?? 0
  const taxRoundTripPct =
    toNumber(input.taxRoundTripPct) ?? toNumber(input.sellTaxPct) ?? 0

  let commissionPct = commissionRoundTripPct
  if (commissionPct === null) {
    if (commissionEntryPct !== null || commissionExitPct !== null) {
      commissionPct = (commissionEntryPct ?? 0) + (commissionExitPct ?? 0)
    } else {
      commissionPct = DEFAULT_COMMISSION_ROUND_TRIP_PCT
    }
  }

  const totalPct = (commissionPct ?? 0) + slippageRoundTripPct + taxRoundTripPct

  return {
    mode: "round_trip_pct",
    commissionRoundTripPct: commissionPct ?? 0,
    slippageRoundTripPct,
    taxRoundTripPct,
    totalPct: totalPct * 100,
  }
}

export const applyCostsToGrossPct = (
  grossReturnPct,
  costModel,
  options = {},
) => {
  if (!Number.isFinite(grossReturnPct)) {
    return grossReturnPct
  }
  if (costModel?.netAlreadyIncludesCosts || costModel?.alreadyApplied) {
    return grossReturnPct
  }
  if (options?.alreadyApplied) {
    return grossReturnPct
  }
  const resolved = resolveCostModel(costModel)
  return grossReturnPct - resolved.totalPct
}
