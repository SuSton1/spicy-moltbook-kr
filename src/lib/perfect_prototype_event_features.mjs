const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const safeDiv = (left, right) => {
  const l = num(left)
  const r = num(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r === 0) return null
  return l / r
}

const resolveHighJumpMode = (raw) => {
  const text = String(raw ?? "FROM_OPEN_EX_GAP").trim().toUpperCase()
  return text === "FROM_PREV_CLOSE" ? "FROM_PREV_CLOSE" : "FROM_OPEN_EX_GAP"
}

const uniqueSortedStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

export const PERFECT_PROTOTYPE_EVENT_FEATURE_SURFACE = "v2_event_aware"

export const buildPerfectPrototypeEventMetaFromSeries = ({
  series,
  decisionIdx,
  highJumpMode = "FROM_OPEN_EX_GAP",
}) => {
  if (!Array.isArray(series)) return null
  if (!Number.isInteger(decisionIdx) || decisionIdx < 1 || decisionIdx >= series.length) return null
  const today = series[decisionIdx]
  const prev = series[decisionIdx - 1]
  const prevClose = num(prev?.close)
  const open = num(today?.open)
  const high = num(today?.high)
  const close = num(today?.close)
  if (!Number.isFinite(prevClose) || prevClose <= 0 || !Number.isFinite(high) || high <= 0) return null
  const normalizedMode = resolveHighJumpMode(highJumpMode)
  const jumpPctFromPrevClose = high / prevClose - 1
  const gapOpenPct = Number.isFinite(open) && open > 0 ? open / prevClose - 1 : null
  const jumpPctFromOpen = Number.isFinite(open) && open > 0 ? high / open - 1 : null
  const closeRetPct = Number.isFinite(close) ? close / prevClose - 1 : null
  return {
    jumpPct:
      normalizedMode === "FROM_PREV_CLOSE"
        ? jumpPctFromPrevClose
        : Number.isFinite(jumpPctFromOpen)
          ? jumpPctFromOpen
          : null,
    jumpPctFromPrevClose,
    jumpPctFromOpen,
    closeRetPct,
    gapOpenPct,
  }
}

const deriveCloseFromOpenPct = ({ closeRetPct, gapOpenPct }) => {
  if (!Number.isFinite(num(closeRetPct)) || !Number.isFinite(num(gapOpenPct))) return null
  const ratio = safeDiv(1 + num(closeRetPct), 1 + num(gapOpenPct))
  return Number.isFinite(ratio) ? ratio - 1 : null
}

export const buildPerfectPrototypeEventFeatureVec = (eventMeta, options = {}) => {
  const normalizedMode = resolveHighJumpMode(options?.highJumpMode)
  const rawJumpPct = num(eventMeta?.jumpPct)
  const gapOpenPct = num(eventMeta?.gapOpenPct)
  let jumpPctFromPrevClose = num(eventMeta?.jumpPctFromPrevClose)
  let jumpPctFromOpen = num(eventMeta?.jumpPctFromOpen)
  if (!Number.isFinite(jumpPctFromPrevClose) && Number.isFinite(rawJumpPct) && normalizedMode === "FROM_PREV_CLOSE") {
    jumpPctFromPrevClose = rawJumpPct
  }
  if (!Number.isFinite(jumpPctFromOpen) && Number.isFinite(rawJumpPct) && normalizedMode !== "FROM_PREV_CLOSE") {
    jumpPctFromOpen = rawJumpPct
  }
  if (!Number.isFinite(jumpPctFromPrevClose) && Number.isFinite(jumpPctFromOpen) && Number.isFinite(gapOpenPct)) {
    jumpPctFromPrevClose = (1 + gapOpenPct) * (1 + jumpPctFromOpen) - 1
  }
  if (!Number.isFinite(jumpPctFromOpen) && Number.isFinite(jumpPctFromPrevClose) && Number.isFinite(gapOpenPct)) {
    const ratio = safeDiv(1 + jumpPctFromPrevClose, 1 + gapOpenPct)
    jumpPctFromOpen = Number.isFinite(ratio) ? ratio - 1 : null
  }
  const closeRetPct = num(eventMeta?.closeRetPct)
  const closeFromOpenPct = deriveCloseFromOpenPct({ closeRetPct, gapOpenPct })
  const canonicalJumpPct =
    rawJumpPct ??
    (normalizedMode === "FROM_PREV_CLOSE" ? jumpPctFromPrevClose : jumpPctFromOpen)
  const closeToHighFadePct =
    Number.isFinite(jumpPctFromOpen) && Number.isFinite(closeFromOpenPct)
      ? jumpPctFromOpen - closeFromOpenPct
      : null
  const closeRetentionFromOpen =
    Number.isFinite(closeFromOpenPct) && Number.isFinite(jumpPctFromOpen)
      ? safeDiv(closeFromOpenPct, jumpPctFromOpen)
      : null
  const closeRetentionFromPrevClose =
    Number.isFinite(closeRetPct) && Number.isFinite(jumpPctFromPrevClose)
      ? safeDiv(closeRetPct, jumpPctFromPrevClose)
      : null
  const gapContributionShare =
    Number.isFinite(gapOpenPct) && Number.isFinite(jumpPctFromPrevClose)
      ? safeDiv(gapOpenPct, jumpPctFromPrevClose)
      : null
  const intradayContributionShare =
    Number.isFinite(jumpPctFromOpen) && Number.isFinite(jumpPctFromPrevClose)
      ? safeDiv(jumpPctFromOpen, jumpPctFromPrevClose)
      : null
  const closeMinusGapPct =
    Number.isFinite(closeRetPct) && Number.isFinite(gapOpenPct) ? closeRetPct - gapOpenPct : null
  const gapVsIntradayPct =
    Number.isFinite(gapOpenPct) && Number.isFinite(jumpPctFromOpen) ? gapOpenPct - jumpPctFromOpen : null

  return {
    jumpPct: canonicalJumpPct,
    jumpPctFromPrevClose,
    jumpPctFromOpen,
    closeRetPct,
    gapOpenPct,
    closeFromOpenPct,
    closeToHighFadePct,
    closeRetentionFromOpen,
    closeRetentionFromPrevClose,
    gapContributionShare,
    intradayContributionShare,
    closeMinusGapPct,
    gapVsIntradayPct,
  }
}

const classifyGapProfile = (eventFeatureVec) => {
  const gapShare = num(eventFeatureVec?.gapContributionShare)
  if (!Number.isFinite(gapShare)) return "UNKNOWN"
  if (gapShare >= 0.67) return "GAP_DOMINANT"
  if (gapShare <= 0.33) return "INTRADAY_DOMINANT"
  return "MIXED"
}

const classifyCloseStrength = (eventFeatureVec) => {
  const retention = num(eventFeatureVec?.closeRetentionFromOpen)
  if (!Number.isFinite(retention)) return "UNKNOWN"
  if (retention >= 0.8) return "STRONG"
  if (retention >= 0.45) return "MID"
  if (retention >= 0) return "FADE"
  return "REVERSAL"
}

const classifyGapSign = (eventFeatureVec) => {
  const gapOpenPct = num(eventFeatureVec?.gapOpenPct)
  if (!Number.isFinite(gapOpenPct)) return "UNKNOWN"
  if (gapOpenPct >= 0.01) return "UP"
  if (gapOpenPct <= -0.01) return "DOWN"
  return "FLAT"
}

const classifyCloseFromOpen = (eventFeatureVec) => {
  const closeFromOpenPct = num(eventFeatureVec?.closeFromOpenPct)
  if (!Number.isFinite(closeFromOpenPct)) return "UNKNOWN"
  if (closeFromOpenPct >= 0.02) return "GREEN"
  if (closeFromOpenPct <= -0.02) return "RED"
  return "FLAT"
}

export const buildPerfectPrototypeEventTagTokens = (eventFeatureVec) =>
  [eventFeatureVec?.jumpPctFromPrevClose, eventFeatureVec?.jumpPctFromOpen, eventFeatureVec?.closeRetPct]
    .map((value) => num(value))
    .some(Number.isFinite)
    ? uniqueSortedStrings([
        `tag:event.closeStrength:${classifyCloseStrength(eventFeatureVec)}`,
        `tag:event.gapProfile:${classifyGapProfile(eventFeatureVec)}`,
        `tag:event.gapSign:${classifyGapSign(eventFeatureVec)}`,
        `tag:event.closeFromOpen:${classifyCloseFromOpen(eventFeatureVec)}`,
      ])
    : []
