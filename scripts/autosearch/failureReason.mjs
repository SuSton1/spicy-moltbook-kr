const toUpper = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()

const uniqueList = (items) => {
  const out = []
  const seen = new Set()
  for (const item of items ?? []) {
    const value = String(item ?? "").trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export const normalizeFailureReasonCode = (reason) => {
  const raw = toUpper(reason)
  if (!raw) return "UNKNOWN"
  if (raw.startsWith("LOCKBOX_")) {
    const nested = normalizeFailureReasonCode(raw.slice("LOCKBOX_".length))
    return nested === "UNKNOWN" ? "LOCKBOX_UNKNOWN" : `LOCKBOX_${nested}`
  }
  if (raw.includes("WORST2W")) return "WORST2W_BELOW_THRESHOLD"
  if (raw.includes("MOONSHOT")) return "MOONSHOT_GATE_FAILED"
  if (
    raw.includes("TRADE_GATE") ||
    raw.includes("NO_TRADES") ||
    raw.includes("WEAK_SIGNAL") ||
    raw.includes("EARLY_ZERO_TRADES")
  ) {
    return "TRADE_GATE_FAIL"
  }
  if (raw.includes("WEEKLY_SUMMARY")) return "WEEKLY_SUMMARY_GATE"
  if (raw.includes("STOPLIKE")) return "STOPLIKE_TOO_HIGH"
  if (raw.includes("LEGACY_")) return "LEGACY_WEEKLY_GATE_FAIL"
  if (raw.includes("CONTINUITY")) return "CONTINUITY_FAIL"
  if (
    raw.includes("DATA") ||
    raw.includes("COVERAGE") ||
    raw.includes("PATTERN_MISSING")
  ) {
    return "DATA_COVERAGE_LOW"
  }
  if (raw.includes("TIMEOUT")) return "PROCESS_TIMEOUT"
  return raw
}

const PRIMARY_REASON_PRIORITY = Object.freeze([
  "WORST2W_BELOW_THRESHOLD",
  "TRADE_GATE_FAIL",
  "WEEKLY_SUMMARY_GATE",
  "STOPLIKE_TOO_HIGH",
  "MOONSHOT_GATE_FAILED",
  "LEGACY_WEEKLY_GATE_FAIL",
  "CONTINUITY_FAIL",
  "DATA_COVERAGE_LOW",
  "PROCESS_TIMEOUT",
])

const reasonPriority = (reasonCode) => {
  const normalized = normalizeFailureReasonCode(reasonCode)
  const index = PRIMARY_REASON_PRIORITY.indexOf(normalized)
  if (index >= 0) return index
  if (normalized.startsWith("LOCKBOX_")) {
    const nested = normalizeFailureReasonCode(normalized.slice("LOCKBOX_".length))
    const nestedIndex = PRIMARY_REASON_PRIORITY.indexOf(nested)
    return nestedIndex >= 0 ? nestedIndex + 20 : 200
  }
  return 100
}

export const pickPrimaryFailureReason = ({
  terminationReason = null,
  failureTopReasons = [],
  lockboxBlockedReasons = [],
}) => {
  const rows = []
  const pushReason = (reason, count, source) => {
    const normalized = normalizeFailureReasonCode(reason)
    if (!normalized || normalized === "UNKNOWN") return
    rows.push({
      reason: normalized,
      count: Math.max(1, Number(count) || 1),
      source,
      priority: reasonPriority(normalized),
    })
  }

  for (const row of failureTopReasons ?? []) {
    pushReason(row?.reason, row?.count, "failureLeaderboard")
  }
  const termination = normalizeFailureReasonCode(terminationReason)
  if (termination && termination !== "UNKNOWN") {
    pushReason(termination, 1, "termination")
  }
  for (const reason of uniqueList(lockboxBlockedReasons)) {
    pushReason(`LOCKBOX_${reason}`, 1, "lockbox")
  }

  if (!rows.length) {
    return { reason: null, source: null, count: 0 }
  }
  rows.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    if (b.count !== a.count) return b.count - a.count
    return a.reason.localeCompare(b.reason)
  })
  const best = rows[0]
  return {
    reason: best.reason,
    source: best.source,
    count: best.count,
  }
}

export const mapPrimaryReasonToFailureCode = (reason) => {
  const normalized = normalizeFailureReasonCode(reason)
  if (!normalized || normalized === "UNKNOWN") {
    return null
  }
  if (normalized === "WORST2W_BELOW_THRESHOLD") {
    return { code: "WORST2W_BELOW_THRESHOLD", detail: normalized }
  }
  if (normalized === "MOONSHOT_GATE_FAILED") {
    return { code: "MOONSHOT_GATE_FAIL", detail: normalized }
  }
  if (normalized === "TRADE_GATE_FAIL") {
    return { code: "TRADE_GATE_FAIL", detail: normalized }
  }
  if (normalized === "DATA_COVERAGE_LOW") {
    return { code: "DATA_COVERAGE_LOW", detail: normalized }
  }
  if (normalized === "PROCESS_TIMEOUT") {
    return { code: "PROCESS_TIMEOUT", detail: normalized }
  }
  return { code: "PERFORMANCE_NOT_PASS", detail: normalized }
}
