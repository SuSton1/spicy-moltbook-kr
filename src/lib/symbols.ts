export type SymbolMarket = "KOSPI" | "KOSDAQ" | "NASDAQ" | "DOWJONES"
export type SymbolKind = "STOCK" | "ETF" | "ETN" | "REIT" | "OTHER" | "UNKNOWN"
export type SymbolStatus = "LISTED" | "DELISTED" | "SUSPENDED" | "UNKNOWN"

export type SymbolItem = {
  symbol: string
  name: string
  market: SymbolMarket
  kind: SymbolKind
  status: SymbolStatus
  updatedAt: string
  exchange?: string
  isEtf?: boolean
  securityType?: string
  providerSymbol?: string
}

export type SymbolSearchItem = Pick<SymbolItem, "symbol" | "name" | "market">

const normalizeSymbol = (value: string) => value.trim().toUpperCase()
const isSymbol = (value: string) => /^[0-9A-Z]{6}$/.test(value)

const pickName = (parts: string[]) => {
  const candidate = parts.find((part) => /[A-Za-z가-힣]/.test(part))
  return candidate?.trim() ?? ""
}

const readFixedWidthName = (raw: string) => {
  const nameField = raw.slice(21)
  if (!nameField) {
    return ""
  }
  return nameField.split(/\s{2,}/)[0].trim()
}

export const parseSymbolLines = (
  content: string,
  market: SymbolMarket,
  updatedAt = new Date().toISOString(),
) => {
  const items: SymbolItem[] = []
  const seen = new Set<string>()
  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    const raw = line.trim()
    if (!raw) {
      continue
    }

    let symbol = ""
    let name = ""

    if (raw.includes("|")) {
      const parts = raw.split("|").map((part) => part.trim())
      const symbolPart = parts.find((part) => isSymbol(normalizeSymbol(part)))
      symbol = symbolPart ? normalizeSymbol(symbolPart) : ""
      if (!symbol) {
        const candidate = normalizeSymbol(parts[0] ?? "")
        if (isSymbol(candidate)) {
          symbol = candidate
        }
      }
      name = pickName(parts)
    } else {
      const candidate = normalizeSymbol(raw.slice(0, 6))
      if (isSymbol(candidate)) {
        symbol = candidate
        name = readFixedWidthName(raw)
      }
    }

    if (!symbol || !name || seen.has(symbol)) {
      continue
    }

    seen.add(symbol)
    items.push({
      symbol,
      name,
      market,
      kind: "UNKNOWN",
      status: "UNKNOWN",
      updatedAt,
    })
  }

  return items
}

const encodeBase64 = (value: string) => {
  const bufferCtor =
    typeof globalThis !== "undefined" && "Buffer" in globalThis
      ? (
          globalThis as {
            Buffer: {
              from: (
                input: string,
                encoding: string,
              ) => { toString: (enc: string) => string }
            }
          }
        ).Buffer
      : undefined
  if (bufferCtor) {
    return bufferCtor.from(value, "utf8").toString("base64")
  }
  return btoa(value)
}

const decodeBase64 = (value: string) => {
  const bufferCtor =
    typeof globalThis !== "undefined" && "Buffer" in globalThis
      ? (
          globalThis as {
            Buffer: {
              from: (
                input: string,
                encoding: string,
              ) => { toString: (enc: string) => string }
            }
          }
        ).Buffer
      : undefined
  if (bufferCtor) {
    return bufferCtor.from(value, "base64").toString("utf8")
  }
  return atob(value)
}

export const encodeCursor = (offset: number) => encodeBase64(String(offset))

export const decodeCursor = (cursor?: string | null) => {
  if (!cursor) {
    return 0
  }
  try {
    const decoded = decodeBase64(cursor)
    const offset = Number(decoded)
    return Number.isFinite(offset) && offset >= 0 ? offset : 0
  } catch {
    return 0
  }
}

export const paginateSymbols = (
  items: SymbolItem[],
  cursor: string | null | undefined,
  limit: number,
) => {
  const offset = decodeCursor(cursor)
  const slice = items.slice(offset, offset + limit)
  const nextOffset = offset + slice.length
  const totalCount = items.length
  const hasMore = nextOffset < totalCount
  const nextCursor = hasMore ? encodeCursor(nextOffset) : null
  return { items: slice, nextCursor, hasMore, totalCount }
}
