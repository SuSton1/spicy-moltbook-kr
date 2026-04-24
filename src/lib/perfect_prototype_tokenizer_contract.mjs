import { PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE } from "./perfect_prototype_prejump_contract.mjs"

export const PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS = Object.freeze({
  surfaceName: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  binCount: 5,
  includeSymbolToken: false,
  includeMissingTokens: false,
  includeCategoricalTokens: true,
})

const stableJson = (value) => JSON.stringify(value ?? null)

export const normalizePerfectPrototypeTokenizerCacheInputs = (options = {}) => ({
  surfaceName:
    String(options?.surfaceName ?? "").trim().toLowerCase() ||
    PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.surfaceName,
  binCount: Number.isInteger(Number(options?.binCount))
    ? Number(options.binCount)
    : PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.binCount,
  includeSymbolToken:
    options?.includeSymbolToken === undefined || options?.includeSymbolToken === null
      ? PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.includeSymbolToken
      : options.includeSymbolToken === true,
  includeMissingTokens:
    options?.includeMissingTokens === undefined || options?.includeMissingTokens === null
      ? PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.includeMissingTokens
      : options.includeMissingTokens === true,
  includeCategoricalTokens:
    options?.includeCategoricalTokens === undefined || options?.includeCategoricalTokens === null
      ? PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS.includeCategoricalTokens
      : options.includeCategoricalTokens === true,
})

export const buildCanonicalPerfectPrototypeTokenizerCacheInputs = () => ({
  ...PERFECT_PROTOTYPE_CANONICAL_TOKENIZER_CACHE_INPUTS,
})

export const assertCanonicalPerfectPrototypeTokenizerCacheInputs = ({
  tokenizerSpecCacheInputs,
  failureLabel = "canonical predictive tokenizer options",
}) => {
  const normalized = normalizePerfectPrototypeTokenizerCacheInputs(tokenizerSpecCacheInputs)
  const expected = buildCanonicalPerfectPrototypeTokenizerCacheInputs()
  if (stableJson(normalized) !== stableJson(expected)) {
    throw new Error(
      [
        "Canonical predictive tokenizer options must remain fixed.",
        `failureLabel=${String(failureLabel ?? "").trim() || "canonical predictive tokenizer options"}`,
        `expected=${stableJson(expected)}`,
        `actual=${stableJson(normalized)}`,
      ].join("\n"),
    )
  }
  return normalized
}
