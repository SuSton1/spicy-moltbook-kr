import type { SymbolMarket, SymbolSearchItem } from "./symbols"

type SymbolIndexEntry = SymbolSearchItem & {
  nameLower: string
  symbolLower: string
}

const STORAGE_KEY = "symbol-cache-v1"
const CACHE_URL = "/data/symbols.all.json"

let cache: SymbolIndexEntry[] | null = null
let loadPromise: Promise<SymbolIndexEntry[]> | null = null
const cacheEvents =
  typeof EventTarget === "undefined" ? null : new EventTarget()

const normalizeQuery = (value: string) => value.trim().toLowerCase()

const notify = () => {
  cacheEvents?.dispatchEvent(new Event("update"))
}

const buildIndex = (items: SymbolSearchItem[]) =>
  items.map((item) => ({
    ...item,
    nameLower: item.name.toLowerCase(),
    symbolLower: item.symbol.toLowerCase(),
  }))

const sanitizeItems = (items: SymbolSearchItem[]) =>
  items.filter(
    (item) =>
      item &&
      typeof item.symbol === "string" &&
      typeof item.name === "string" &&
      (item.market === "KOSPI" || item.market === "KOSDAQ"),
  )

const readStorage = () => {
  if (typeof window === "undefined") {
    return null
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as SymbolSearchItem[]
    const sanitized = sanitizeItems(parsed)
    return sanitized.length > 0 ? sanitized : null
  } catch {
    return null
  }
}

const writeStorage = (items: SymbolSearchItem[]) => {
  if (typeof window === "undefined") {
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // Ignore storage failures to avoid blocking search.
  }
}

const hydrateCache = (items: SymbolSearchItem[]) => {
  cache = buildIndex(items)
  notify()
  return cache
}

const fetchCache = async () => {
  const response = await fetch(CACHE_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  })
  if (!response.ok) {
    throw new Error("Symbol cache fetch failed")
  }
  const payload = (await response.json()) as SymbolSearchItem[]
  const sanitized = sanitizeItems(payload)
  if (sanitized.length === 0) {
    throw new Error("Symbol cache empty")
  }
  return sanitized
}

export const preloadSymbolCache = () => {
  if (cache) {
    return Promise.resolve(cache)
  }
  const stored = readStorage()
  if (stored && !cache) {
    hydrateCache(stored)
  }
  if (!loadPromise) {
    loadPromise = fetchCache()
      .then((items) => {
        writeStorage(items)
        return hydrateCache(items)
      })
      .catch(() => cache ?? [])
  }
  return loadPromise
}

export const subscribeSymbolCache = (callback: () => void) => {
  if (!cacheEvents) {
    return () => {}
  }
  cacheEvents.addEventListener("update", callback)
  return () => cacheEvents.removeEventListener("update", callback)
}

export const searchLocalSymbols = (
  market: SymbolMarket | "ALL",
  query: string,
  limit = 5,
) => {
  const normalized = normalizeQuery(query)
  if (!normalized) {
    return [] as SymbolSearchItem[]
  }
  if (!cache) {
    const stored = readStorage()
    if (stored) {
      hydrateCache(stored)
    }
  }
  if (!cache) {
    return [] as SymbolSearchItem[]
  }

  const results: SymbolSearchItem[] = []
  for (const item of cache) {
    if (market !== "ALL" && item.market !== market) {
      continue
    }
    if (
      item.symbolLower.includes(normalized) ||
      item.nameLower.includes(normalized)
    ) {
      results.push({
        symbol: item.symbol,
        name: item.name,
        market: item.market,
      })
      if (results.length >= limit) {
        break
      }
    }
  }
  return results
}

export const __setSymbolCacheForTest = (items: SymbolSearchItem[]) => {
  hydrateCache(items)
}
