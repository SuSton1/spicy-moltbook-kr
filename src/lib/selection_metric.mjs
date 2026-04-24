const clamp01 = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

const toFiniteOrNull = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const buildSelectionHitAt1Snapshot = (source) => {
  const raw =
    clamp01(
      source?.selectionHitAt1RawEval ??
        source?.selectionHitAt1Eval ??
        source?.selectionHitAt1 ??
        source?.hitAt1Eval ??
        source?.hitAt1 ??
        0,
    )
  const fallbackAwareValue = toFiniteOrNull(
    source?.selectionHitAt1AgreementFallbackAwareEval ??
      source?.agreementFallbackSelection?.selectionHitAt1AgreementFallbackAwareEval,
  )
  const fallbackAware =
    fallbackAwareValue === null ? raw : clamp01(fallbackAwareValue)
  const explicitResolvedValue = toFiniteOrNull(
    source?.selectionHitAt1ResolvedEval ?? source?.selectionHitAt1Resolved,
  )
  const explicitSource =
    String(
      source?.selectionHitAt1MetricSourceEval ?? source?.selectionHitAt1MetricSource ?? "",
    )
      .trim()
      .toUpperCase() || ""
  if (explicitResolvedValue !== null) {
    return {
      raw,
      agreementFallbackAware: fallbackAware,
      resolved: clamp01(explicitResolvedValue),
      source: explicitSource || "RESOLVED"
    }
  }
  if (explicitSource === "AGREEMENT_FALLBACK_AWARE" && fallbackAware > raw) {
    return {
      raw,
      agreementFallbackAware: fallbackAware,
      resolved: fallbackAware,
      source: "AGREEMENT_FALLBACK_AWARE"
    }
  }
  return {
    raw,
    agreementFallbackAware: fallbackAware,
    resolved: raw,
    source: explicitSource || "RAW_TOP1"
  }
}
