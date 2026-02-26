export const isKrSixDigitSymbol = (value) =>
  /^[0-9]{6}$/.test(String(value ?? "").trim())

export const classifySymbolType = ({ name, kind, symbol }) => {
  const rawName = String(name ?? "").trim()
  const upperName = rawName.toUpperCase()
  const upperKind = String(kind ?? "")
    .trim()
    .toUpperCase()

  if (upperKind && upperKind !== "UNKNOWN") {
    return upperKind
  }

  if (upperName.includes("ETN")) {
    return "ETN"
  }
  if (upperName.includes("ETF")) {
    return "ETF"
  }
  if (upperName.includes("REIT") || rawName.includes("리츠")) {
    return "REIT"
  }
  if (!isKrSixDigitSymbol(symbol)) {
    return "OTHER"
  }
  return "COMMON"
}

export const resolveIsListed = ({ status }) => {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase()
  if (!normalized || normalized === "UNKNOWN") {
    return true
  }
  return !normalized.includes("DELIST")
}
