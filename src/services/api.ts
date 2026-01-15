import type { RankingSortDir, RankingSortKey } from "../lib/rankings"
import {
  isIntradayInterval,
  resolveIntradayInterval,
} from "../lib/chartIntervals"
import type { SessionWindow } from "../lib/session"
import type { SymbolSearchItem } from "../lib/symbols"

export type Quote = {
  code: string
  name?: string
  price: number
  change: number
  changeRate: number
  volume: number | null
  updatedAt?: string
  session?: SessionWindow
}

export type BatchQuoteItem = {
  code: string
  name?: string
  price: number | null
  change: number | null
  changeRate: number | null
  volume: number | null
  turnover: number | null
  marketCap: number | null
  updatedAt?: string
  session?: SessionWindow
}

export type Candle = {
  time: string | number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type SeriesPayload = {
  points: Candle[]
}

export type IndexItem = {
  code: string
  name: string
  price: number
  change: number
  changeRate: number
  refDate?: string
  isFallback?: boolean
  updatedAt?: string
}

export type RankingItem = {
  rank: number
  code: string
  name: string
  market?: string
  price: number | null
  change: number | null
  changeRate: number | null
  volume: number | null
  value: number | null
  mcap?: number | null
}

export type RankingResponse = {
  items: RankingItem[]
  nextCursor: string | null
  hasMore: boolean
  totalCount?: number
  source?: string
}

export type BatchQuoteResponse = {
  quotesBySymbol: Record<string, BatchQuoteItem>
  ts: number
  source?: string
}

export type RankingQuery = {
  region: "KR" | "US"
  mode: "market_cap" | "turnover" | "volume" | "gainers" | "losers"
  sortKey?: RankingSortKey
  sortDir?: RankingSortDir
  limit?: number
  cursor?: string | null
  query?: string
  signal?: AbortSignal
}

export type NewsItem = {
  id: string
  title: string
  source: string
  date: string
  link: string
}

export type DisclosureItem = {
  id: string
  title: string
  source: string
  date: string
  link: string
}

export type SymbolSearchWarning = {
  code: string
  message: string
}

export type SymbolSearchResponse = {
  items: SymbolSearchItem[]
  nextCursor: string | null
  hasMore?: boolean
  totalCount?: number
  ok?: boolean
  code?: string
  message?: string
  source?: string
  warning?: SymbolSearchWarning
}

type CacheEntry<T> = {
  value: T
  expiresAt: number
}

const responseCache = new Map<string, CacheEntry<unknown>>()
const inflightCache = new Map<string, Promise<unknown>>()
const batchQuoteCache = new Map<string, CacheEntry<BatchQuoteItem>>()
const batchQuoteInflight = new Map<string, Promise<BatchQuoteResponse>>()
const BATCH_QUOTE_TTL = 5000
const BATCH_QUOTE_MAX = 100

const emitApiWarning = (message: string) => {
  if (typeof window === "undefined") {
    return
  }
  window.dispatchEvent(
    new CustomEvent("api-warning", {
      detail: {
        code: "PROXY_FALLBACK",
        message,
      },
    }),
  )
}

let lastProxyWarnAt = 0
let proxyOverride: string | null | undefined

const warnProxyFallback = () => {
  const now = Date.now()
  if (now - lastProxyWarnAt < 30000) {
    return
  }
  lastProxyWarnAt = now
  emitApiWarning("Proxy fallback")
}

const isLoopbackHost = (host: string) =>
  host === "localhost" ||
  host === "127.0.0.1" ||
  host === "0.0.0.0" ||
  host === "::1"

const normalizePort = (url: URL) => {
  if (url.port) {
    return url.port
  }
  return url.protocol === "https:" ? "443" : "80"
}

const resolveProxyBase = (raw: string | undefined, origin?: string) => {
  const cleaned = (raw ?? "").trim()
  if (!cleaned) {
    return ""
  }
  const lower = cleaned.toLowerCase()
  if (lower === "undefined" || lower === "null") {
    return ""
  }
  if (cleaned.startsWith("/")) {
    return ""
  }
  const normalized = cleaned.endsWith("/") ? cleaned.slice(0, -1) : cleaned
  let proxyUrl: URL
  try {
    proxyUrl = new URL(normalized)
  } catch {
    return ""
  }
  if (!origin) {
    return normalized
  }
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return normalized
  }
  if (proxyUrl.origin === originUrl.origin) {
    return ""
  }
  if (
    isLoopbackHost(proxyUrl.hostname) &&
    isLoopbackHost(originUrl.hostname) &&
    normalizePort(proxyUrl) === normalizePort(originUrl)
  ) {
    return ""
  }
  return normalized
}

const apiBase = () => {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const raw =
    proxyOverride === undefined
      ? import.meta.env.VITE_KIS_PROXY_URL
      : proxyOverride
  return resolveProxyBase(raw ?? "", origin)
}

export const __setProxyBaseForTest = (value: string | null) => {
  proxyOverride = value
}

export const __resetApiCacheForTest = () => {
  responseCache.clear()
  inflightCache.clear()
  batchQuoteCache.clear()
  batchQuoteInflight.clear()
  lastProxyWarnAt = 0
  proxyOverride = undefined
}

const buildApiUrl = (path: string, params?: URLSearchParams) => {
  const query = params?.toString()
  const suffix = query ? `?${query}` : ""
  const relative = `${path}${suffix}`
  const base = apiBase()
  if (!base) {
    return { primary: relative }
  }
  return { primary: `${base}${relative}`, fallback: relative }
}

export const buildApiErrorMessage = (
  payload: Record<string, unknown>,
  responseStatus: number,
) => {
  const code = payload.code as string | undefined
  const message =
    (payload.message as string | undefined) ||
    (payload.error as string | undefined) ||
    (payload.detail as string | undefined) ||
    `API error: ${responseStatus}`
  const requestId = payload.requestId as string | undefined
  const upstreamStatus = payload.upstreamStatus as number | undefined
  const upstreamCode = payload.upstreamCode as string | undefined
  const upstreamMessage = payload.upstreamMessage as string | undefined
  const retryAfterMs = payload.retryAfterMs as number | undefined
  const meta: string[] = []
  if (requestId) {
    meta.push(`requestId=${requestId}`)
  }
  if (upstreamStatus) {
    meta.push(`upstreamStatus=${upstreamStatus}`)
  }
  if (upstreamCode) {
    meta.push(`upstreamCode=${upstreamCode}`)
  }
  if (upstreamMessage) {
    meta.push(`upstreamMessage=${upstreamMessage}`)
  }
  if (retryAfterMs) {
    meta.push(`retryAfterMs=${retryAfterMs}`)
  }
  const suffix = meta.length ? ` (${meta.join(" ")})` : ""
  return code ? `${code}: ${message}${suffix}` : `${message}${suffix}`
}

const fetchJson = async <T>(
  url: string,
  fallbackUrl?: string,
  allowApiError = false,
  signal?: AbortSignal,
): Promise<T> => {
  const request = async (target: string) => {
    const response = await fetch(target, {
      headers: { Accept: "application/json" },
      signal,
    })
    const contentType = response.headers.get("content-type") || ""
    const isJson = contentType.includes("application/json")
    const payload = isJson
      ? ((await response.json().catch(() => ({}))) as Record<string, unknown>)
      : {}
    return { response, payload, isJson }
  }

  const isOk = (result: {
    response: Response
    payload: Record<string, unknown>
    isJson: boolean
  }) => result.response.ok && result.isJson && result.payload.ok !== false
  const shouldFallback = (result: {
    response: Response
    payload: Record<string, unknown>
    isJson: boolean
  }) =>
    Boolean(
      fallbackUrl &&
      (!result.response.ok ||
        !result.isJson ||
        result.payload.ok === undefined),
    )

  let result: {
    response: Response
    payload: Record<string, unknown>
    isJson: boolean
  }
  let usedFallback = false
  try {
    result = await request(url)
  } catch (error) {
    if (!fallbackUrl) {
      throw error
    }
    usedFallback = true
    result = await request(fallbackUrl)
  }

  if (shouldFallback(result) && fallbackUrl) {
    const fallback = await request(fallbackUrl)
    if (isOk(fallback)) {
      usedFallback = true
      warnProxyFallback()
      return fallback.payload as T
    }
    usedFallback = true
    result = fallback
  }
  const { response, payload } = result
  if (!isOk(result)) {
    if (allowApiError) {
      return payload as T
    }
    throw new Error(buildApiErrorMessage(payload, response.status))
  }
  if (usedFallback) {
    warnProxyFallback()
  }
  return payload as T
}

const fetchJsonWithBody = async <T>(
  url: string,
  body: unknown,
  fallbackUrl?: string,
  allowApiError = false,
  signal?: AbortSignal,
): Promise<T> => {
  const request = async (target: string) => {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
      signal,
    })
    const contentType = response.headers.get("content-type") || ""
    const isJson = contentType.includes("application/json")
    const payload = isJson
      ? ((await response.json().catch(() => ({}))) as Record<string, unknown>)
      : {}
    return { response, payload, isJson }
  }

  const isOk = (result: {
    response: Response
    payload: Record<string, unknown>
    isJson: boolean
  }) => result.response.ok && result.isJson && result.payload.ok !== false
  const shouldFallback = (result: {
    response: Response
    payload: Record<string, unknown>
    isJson: boolean
  }) =>
    Boolean(
      fallbackUrl &&
      (!result.response.ok ||
        !result.isJson ||
        result.payload.ok === undefined),
    )

  let result: {
    response: Response
    payload: Record<string, unknown>
    isJson: boolean
  }
  let usedFallback = false
  try {
    result = await request(url)
  } catch (error) {
    if (!fallbackUrl) {
      throw error
    }
    usedFallback = true
    result = await request(fallbackUrl)
  }

  if (shouldFallback(result) && fallbackUrl) {
    const fallback = await request(fallbackUrl)
    if (isOk(fallback)) {
      usedFallback = true
      warnProxyFallback()
      return fallback.payload as T
    }
    usedFallback = true
    result = fallback
  }
  const { response, payload } = result
  if (!isOk(result)) {
    if (allowApiError) {
      return payload as T
    }
    throw new Error(buildApiErrorMessage(payload, response.status))
  }
  if (usedFallback) {
    warnProxyFallback()
  }
  return payload as T
}

const fetchWithCache = async <T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  useInflight = true,
) => {
  const cached = responseCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T
  }
  if (useInflight) {
    const inflight = inflightCache.get(key) as Promise<T> | undefined
    if (inflight) {
      return inflight
    }
  }
  const promise = fetcher()
    .then((value) => {
      responseCache.set(key, { value, expiresAt: Date.now() + ttlMs })
      inflightCache.delete(key)
      return value
    })
    .catch((error) => {
      inflightCache.delete(key)
      throw error
    })
  if (useInflight) {
    inflightCache.set(key, promise as Promise<unknown>)
  }
  return promise
}

export const fetchIndices = async (market: "KR" | "US") => {
  const params = new URLSearchParams({ region: market })
  const { primary, fallback } = buildApiUrl("/api/market/indices", params)
  const cacheKey = `indices:${primary}`
  return fetchWithCache(
    cacheKey,
    5000,
    () => fetchJson<{ indices: IndexItem[] }>(primary, fallback),
    true,
  )
}

export const fetchRankings = async (params: RankingQuery) => {
  const search = new URLSearchParams({
    region: params.region,
    mode: params.mode,
  })
  if (params.sortKey) {
    search.set("sortKey", params.sortKey)
  }
  if (params.sortDir) {
    search.set("sortDir", params.sortDir)
  }
  if (params.cursor) {
    search.set("cursor", params.cursor)
  }
  if (params.limit) {
    search.set("limit", String(params.limit))
  }
  if (params.query) {
    search.set("q", params.query)
  }
  const { primary, fallback } = buildApiUrl("/api/market/rankings", search)
  const cacheKey = `rankings:${primary}`
  return fetchWithCache(
    cacheKey,
    5000,
    () => fetchJson<RankingResponse>(primary, fallback, false, params.signal),
    !params.signal,
  )
}

export const fetchQuote = async (symbol: string, signal?: AbortSignal) => {
  const region: "KR" | "US" = /^[0-9]{6}$/.test(symbol) ? "KR" : "US"
  const payload = await fetchBatchQuotes({ region, symbols: [symbol], signal })
  const item = payload.quotesBySymbol[symbol]
  const quote: Quote = item
    ? {
        code: symbol,
        name: item.name,
        price: item.price ?? 0,
        change: item.change ?? 0,
        changeRate: item.changeRate ?? 0,
        volume: item.volume ?? null,
        updatedAt: item.updatedAt,
        session: item.session,
      }
    : {
        code: symbol,
        price: 0,
        change: 0,
        changeRate: 0,
        volume: null,
      }
  return { quote }
}

export const fetchCandles = async (
  symbol: string,
  tf: string,
  limit?: number,
  region: "KR" | "US" = "KR",
  days = 1,
  signal?: AbortSignal,
) => {
  if (isIntradayInterval(tf)) {
    const interval = resolveIntradayInterval(tf)
    const params = new URLSearchParams({
      symbol,
      interval: interval.key,
      region,
      days: String(days),
    })
    const { primary, fallback } = buildApiUrl("/api/chart/intraday", params)
    const ttl = interval.minutes <= 15 ? 10000 : 30000
    const cacheKey = `candles:${primary}`
    return fetchWithCache(
      cacheKey,
      ttl,
      () =>
        fetchJson<{ series: SeriesPayload }>(primary, fallback, false, signal),
      !signal,
    )
  }

  const params = new URLSearchParams({ tf })
  if (limit && limit > 0) {
    params.set("limit", String(limit))
  }
  const { primary, fallback } = buildApiUrl(
    `/api/stocks/${symbol}/candles`,
    params,
  )
  const ttl = 60000
  const cacheKey = `candles:${primary}`
  return fetchWithCache(
    cacheKey,
    ttl,
    () =>
      fetchJson<{ series: SeriesPayload }>(primary, fallback, false, signal),
    !signal,
  )
}

export const fetchBatchQuotes = async (params: {
  region: "KR" | "US"
  symbols: string[]
  fields?: string[]
  signal?: AbortSignal
}) => {
  const cleaned = params.symbols.map((symbol) => symbol.trim()).filter(Boolean)
  const uniqueSymbols = Array.from(new Set(cleaned))
  if (uniqueSymbols.length === 0) {
    return { quotesBySymbol: {}, ts: Date.now() }
  }

  const now = Date.now()
  const cachedQuotes: Record<string, BatchQuoteItem> = {}
  const pendingSymbols: string[] = []

  uniqueSymbols.forEach((symbol) => {
    const cacheKey = `${params.region}:${symbol}`
    const cached = batchQuoteCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      cachedQuotes[symbol] = cached.value
    } else {
      pendingSymbols.push(symbol)
    }
  })

  const chunks: string[][] = []
  for (let i = 0; i < pendingSymbols.length; i += BATCH_QUOTE_MAX) {
    chunks.push(pendingSymbols.slice(i, i + BATCH_QUOTE_MAX))
  }

  const responses = await Promise.all(
    chunks.map(async (symbols) => {
      const sorted = [...symbols].sort()
      const key = `quotes:${params.region}:${sorted.join(",")}`
      const existing = batchQuoteInflight.get(key)
      if (existing) {
        return existing
      }
      const search = new URLSearchParams()
      const { primary, fallback } = buildApiUrl("/api/quotes/batch", search)
      const promise = fetchJsonWithBody<BatchQuoteResponse>(
        primary,
        {
          region: params.region,
          symbols,
          fields: params.fields,
        },
        fallback,
        false,
        params.signal,
      )
        .then((response) => {
          Object.entries(response.quotesBySymbol ?? {}).forEach(
            ([code, quote]) => {
              const cacheKey = `${params.region}:${code}`
              batchQuoteCache.set(cacheKey, {
                value: quote,
                expiresAt: Date.now() + BATCH_QUOTE_TTL,
              })
            },
          )
          return response
        })
        .finally(() => {
          batchQuoteInflight.delete(key)
        })
      batchQuoteInflight.set(key, promise)
      return promise
    }),
  )

  const combined = { ...cachedQuotes }
  responses.forEach((response) => {
    Object.assign(combined, response.quotesBySymbol ?? {})
  })

  return { quotesBySymbol: combined, ts: Date.now() }
}

export const fetchNews = async (symbol: string, market: "KR" | "US") => {
  const params = new URLSearchParams({ market, limit: "20" })
  const { primary, fallback } = buildApiUrl(
    `/api/stocks/${symbol}/news`,
    params,
  )
  return fetchJson<{ items: NewsItem[] }>(primary, fallback)
}

export const fetchDisclosures = async (symbol: string, market: "KR" | "US") => {
  const params = new URLSearchParams({ market, limit: "20" })
  const { primary, fallback } = buildApiUrl(
    `/api/stocks/${symbol}/disclosures`,
    params,
  )
  return fetchJson<{ items: DisclosureItem[] }>(primary, fallback)
}

export const fetchSymbols = async (params: {
  market: "KOSPI" | "KOSDAQ" | "ALL"
  query: string
  limit: number
  cursor?: string | null
  mode?: "search" | "list"
  signal?: AbortSignal
}) => {
  const search = new URLSearchParams({
    market: params.market,
    q: params.query,
    limit: String(params.limit),
  })
  if (params.mode) {
    search.set("mode", params.mode)
  }
  if (params.cursor) {
    search.set("cursor", params.cursor)
  }
  const { primary, fallback } = buildApiUrl("/api/symbols", search)
  const cacheKey = `symbols:${primary}`
  return fetchWithCache(
    cacheKey,
    15000,
    () =>
      fetchJson<SymbolSearchResponse>(primary, fallback, true, params.signal),
    !params.signal,
  )
}
