const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const resolveHighJumpMode = (raw) => {
  const text = String(raw ?? "FROM_OPEN").trim().toUpperCase()
  return text === "FROM_PREV_CLOSE" ? "FROM_PREV_CLOSE" : "FROM_OPEN"
}

export const calcJumpWindowMeta = ({
  series,
  targetIdx,
  highJumpMode,
  eventThreshold,
  windowDays,
  useStopLoss,
  stopLossPct,
  sameDayTiePolicy
}) => {
  const asOfClose = num(series?.[targetIdx - 1]?.close)
  const decisionDayOpen = num(series?.[targetIdx]?.open)
  const decisionDayHigh = num(series?.[targetIdx]?.high)
  const decisionDayLow = num(series?.[targetIdx]?.low)
  const jumpBase = highJumpMode === "FROM_PREV_CLOSE" ? asOfClose : decisionDayOpen
  const useStop = useStopLoss !== false
  const stopThreshold = -Math.abs(Number(stopLossPct ?? 0.04) || 0.04)
  const tiePolicy = String(sameDayTiePolicy ?? "STOP_WINS").trim().toUpperCase()
  if (!Number.isFinite(jumpBase) || jumpBase <= 0) {
    return {
      jumpBase: null,
      successOnDecisionDay: false,
      successInWindow: false,
      maxWindowJumpPct: null,
      minWindowDrawdownPct: null,
      firstHitOffset: null,
      firstStopOffset: null,
      stopTriggeredOnDecisionDay: false,
      stopTriggeredInWindow: false,
      decisionDayJumpPct: null
    }
  }
  const decisionDayJumpPct = Number.isFinite(decisionDayHigh) ? decisionDayHigh / jumpBase - 1 : null
  const decisionDayDrawdownPct = Number.isFinite(decisionDayLow) ? decisionDayLow / jumpBase - 1 : null
  const stopTriggeredOnDecisionDay =
    useStop &&
    Number.isFinite(decisionDayDrawdownPct) &&
    decisionDayDrawdownPct <= stopThreshold
  let firstHitOffset =
    Number.isFinite(decisionDayJumpPct) &&
    decisionDayJumpPct >= Number(eventThreshold ?? 0.08)
      ? 0
      : null
  let firstStopOffset = stopTriggeredOnDecisionDay ? 0 : null

  const maxOffset = Math.max(0, Math.floor(Number(windowDays ?? 3) || 3) - 1)
  let maxWindowJumpPct = Number.isFinite(decisionDayJumpPct) ? decisionDayJumpPct : null
  let minWindowDrawdownPct = Number.isFinite(decisionDayDrawdownPct) ? decisionDayDrawdownPct : null
  for (let offset = 1; offset <= maxOffset; offset += 1) {
    const bar = series?.[targetIdx + offset]
    if (!bar) break
    const high = num(bar?.high)
    const low = num(bar?.low)
    const jumpPct = Number.isFinite(high) ? high / jumpBase - 1 : null
    const drawdownPct = Number.isFinite(low) ? low / jumpBase - 1 : null
    if (Number.isFinite(jumpPct)) {
      maxWindowJumpPct =
        Number.isFinite(maxWindowJumpPct) ? Math.max(maxWindowJumpPct, jumpPct) : jumpPct
    }
    if (Number.isFinite(drawdownPct)) {
      minWindowDrawdownPct =
        Number.isFinite(minWindowDrawdownPct) ? Math.min(minWindowDrawdownPct, drawdownPct) : drawdownPct
    }
    if (firstHitOffset === null && jumpPct >= Number(eventThreshold ?? 0.08)) {
      firstHitOffset = offset
    }
    if (useStop && firstStopOffset === null && drawdownPct <= stopThreshold) {
      firstStopOffset = offset
    }
  }

  const successOnDecisionDay = firstHitOffset === 0 && !(tiePolicy === "STOP_WINS" && firstStopOffset === 0)
  let successInWindow = firstHitOffset !== null
  if (useStop && firstHitOffset !== null && firstStopOffset !== null) {
    if (firstStopOffset < firstHitOffset) successInWindow = false
    if (firstStopOffset === firstHitOffset) successInWindow = tiePolicy !== "STOP_WINS"
  }

  return {
    jumpBase,
    successOnDecisionDay,
    successInWindow,
    maxWindowJumpPct,
    minWindowDrawdownPct,
    firstHitOffset,
    firstStopOffset,
    stopTriggeredOnDecisionDay,
    stopTriggeredInWindow: firstStopOffset !== null,
    decisionDayJumpPct
  }
}
