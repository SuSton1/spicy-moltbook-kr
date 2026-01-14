import type { SymbolItem } from "./symbols"

export const mergeUsSymbols = (
  primary: SymbolItem[],
  secondary: SymbolItem[],
) => {
  const seen = new Set(primary.map((item) => item.symbol))
  const merged = [...primary]
  secondary.forEach((item) => {
    if (seen.has(item.symbol)) {
      return
    }
    seen.add(item.symbol)
    merged.push(item)
  })
  return merged
}

export const normalizeUsTickerForKis = (value: string) => {
  const normalized = value.trim().toUpperCase()
  if (!normalized) {
    return normalized
  }
  return normalized.replace(/[^0-9A-Z]/g, "")
}
