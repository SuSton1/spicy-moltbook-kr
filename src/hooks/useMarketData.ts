import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  fetchBatchQuotes,
  fetchCandles,
  fetchDisclosures,
  fetchIndices,
  fetchNews,
  fetchQuote,
  fetchRankings,
  fetchSymbols,
  type Candle,
  type BatchQuoteItem,
  type DisclosureItem,
  type IndexItem,
  type NewsItem,
  type Quote,
  type RankingItem,
} from "../services/api"
import type { SymbolSearchItem } from "../lib/symbols"
import { isIntradayInterval } from "../lib/chartIntervals"
import {
  preloadSymbolCache,
  searchLocalSymbols,
  subscribeSymbolCache,
} from "../lib/symbolCache"
import type { RankingSortDir, RankingSortKey } from "../lib/rankings"
import { perfMark, perfStart } from "../lib/perf"
import { usePolling } from "./usePolling"
import { useDebouncedValue } from "./useDebouncedValue"

export type ApiStatus = "idle" | "loading" | "ready" | "error"

const useAsyncState = <T>(initial: T) => {
  const [data, setData] = useState(initial)
  const [status, setStatus] = useState<ApiStatus>("idle")
  const [error, setError] = useState<string | null>(null)

  const onSuccess = useCallback((payload: T) => {
    setData(payload)
    setStatus("ready")
    setError(null)
  }, [])

  const onError = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : "데이터 오류"
    setError(message)
    setStatus("error")
  }, [])

  return { data, status, error, setStatus, onSuccess, onError }
}

const buildSymbolKey = (item: SymbolSearchItem) =>
  `${item.market}:${item.symbol}`

const mergeSymbolItems = (
  base: SymbolSearchItem[],
  extra: SymbolSearchItem[],
) => {
  const seen = new Set(base.map(buildSymbolKey))
  const merged = [...base]
  for (const item of extra) {
    const key = buildSymbolKey(item)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    merged.push(item)
  }
  return merged
}

const mergeRankingItems = (base: RankingItem[], extra: RankingItem[]) => {
  const seen = new Set(base.map((item) => item.code))
  const merged = [...base]
  for (const item of extra) {
    if (seen.has(item.code)) {
      continue
    }
    seen.add(item.code)
    merged.push(item)
  }
  return merged
}

const INDEX_CACHE_PREFIX = "indices-cache"
const RANKING_CACHE_PREFIX = "rankings-cache"
const QUOTE_CACHE_PREFIX = "quote-cache"
const RANKING_CACHE_TTL = 10000
const CHART_CACHE_TTL = 120000
const chartCache = new Map<string, { data: Candle[]; updatedAt: number }>()

const readChartCache = (key: string) => {
  const entry = chartCache.get(key)
  if (!entry) {
    return null
  }
  if (Date.now() - entry.updatedAt > CHART_CACHE_TTL) {
    chartCache.delete(key)
    return null
  }
  return entry
}

const writeChartCache = (key: string, data: Candle[]) => {
  chartCache.set(key, { data, updatedAt: Date.now() })
}

const FIXTURE_INDICES: IndexItem[] = [
  {
    code: "KOSPI",
    name: "코스피",
    price: 2638.42,
    change: 11.32,
    changeRate: 0.44,
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    code: "KOSDAQ",
    name: "코스닥",
    price: 852.17,
    change: -4.12,
    changeRate: -0.47,
    updatedAt: "2024-01-01T00:00:00Z",
  },
]

const FIXTURE_INDICES_US: IndexItem[] = [
  {
    code: "NASDAQ",
    name: "NASDAQ",
    price: 16234.56,
    change: 123.45,
    changeRate: 0.77,
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    code: "DOWJONES",
    name: "DOW JONES",
    price: 38901.23,
    change: -210.12,
    changeRate: -0.54,
    updatedAt: "2024-01-01T00:00:00Z",
  },
]

const resolveDataMode = () =>
  (
    import.meta.env.DATA_MODE ||
    import.meta.env.VITE_DATA_MODE ||
    "fixture"
  ).toLowerCase()

const isFixtureMode = () => {
  const mode = resolveDataMode()
  return mode === "fixture" || mode === "contract"
}

const cloneIndices = (items: IndexItem[]) => items.map((item) => ({ ...item }))

const readIndicesCache = (market: "KR" | "US") => {
  if (typeof window === "undefined") {
    return []
  }
  const raw = window.localStorage.getItem(`${INDEX_CACHE_PREFIX}:${market}`)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as { items?: IndexItem[] }
    if (!parsed.items || !Array.isArray(parsed.items)) {
      return []
    }
    return cloneIndices(parsed.items)
  } catch {
    return []
  }
}

const writeIndicesCache = (market: "KR" | "US", items: IndexItem[]) => {
  if (typeof window === "undefined") {
    return
  }
  if (!items.some((item) => (item.price ?? 0) > 0)) {
    return
  }
  try {
    window.localStorage.setItem(
      `${INDEX_CACHE_PREFIX}:${market}`,
      JSON.stringify({ items, savedAt: Date.now() }),
    )
  } catch {
    return
  }
}

const readRankingCache = (marketKey: string, mode: RankingMode) => {
  if (isFixtureMode()) {
    return { items: [], cursor: null, hasMore: false }
  }
  if (typeof window === "undefined") {
    return { items: [], cursor: null, hasMore: false }
  }
  const raw = window.localStorage.getItem(
    `${RANKING_CACHE_PREFIX}:${marketKey}:${mode}`,
  )
  if (!raw) {
    return { items: [], cursor: null, hasMore: false }
  }
  try {
    const parsed = JSON.parse(raw) as {
      items?: RankingItem[]
      cursor?: string | null
      hasMore?: boolean
      savedAt?: number
    }
    const savedAt = parsed.savedAt ?? 0
    if (!savedAt || Date.now() - savedAt > RANKING_CACHE_TTL) {
      return { items: [], cursor: null, hasMore: false }
    }
    return {
      items: Array.isArray(parsed.items)
        ? parsed.items.map((item) => ({ ...item }))
        : [],
      cursor: parsed.cursor ?? null,
      hasMore: Boolean(parsed.hasMore),
    }
  } catch {
    return { items: [], cursor: null, hasMore: false }
  }
}

const writeRankingCache = (
  marketKey: string,
  mode: RankingMode,
  items: RankingItem[],
  cursor: string | null,
  hasMore: boolean,
) => {
  if (isFixtureMode()) {
    return
  }
  if (typeof window === "undefined") {
    return
  }
  try {
    window.localStorage.setItem(
      `${RANKING_CACHE_PREFIX}:${marketKey}:${mode}`,
      JSON.stringify({
        items,
        cursor,
        hasMore,
        savedAt: Date.now(),
      }),
    )
  } catch {
    return
  }
}

const readQuoteCache = (symbol: string) => {
  if (isFixtureMode()) {
    return null
  }
  if (typeof window === "undefined") {
    return null
  }
  if (!symbol) {
    return null
  }
  const raw = window.localStorage.getItem(`${QUOTE_CACHE_PREFIX}:${symbol}`)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { quote?: Quote }
    if (!parsed.quote) {
      return null
    }
    return { ...parsed.quote }
  } catch {
    return null
  }
}

const writeQuoteCache = (symbol: string, quote: Quote) => {
  if (isFixtureMode()) {
    return
  }
  if (typeof window === "undefined") {
    return
  }
  if (!symbol || !quote || (quote.price ?? 0) <= 0) {
    return
  }
  try {
    window.localStorage.setItem(
      `${QUOTE_CACHE_PREFIX}:${symbol}`,
      JSON.stringify({ quote, savedAt: Date.now() }),
    )
  } catch {
    return
  }
}

const resolveInitialIndices = (market: "KR" | "US") => {
  if (isFixtureMode()) {
    return cloneIndices(market === "US" ? FIXTURE_INDICES_US : FIXTURE_INDICES)
  }
  return readIndicesCache(market)
}

const resolveInitialQuote = (symbol: string) => {
  if (!symbol) {
    return null
  }
  return readQuoteCache(symbol)
}

export const useIndices = (market: "KR" | "US", pollMs = 10000) => {
  const { data, status, error, onError, onSuccess, setStatus } = useAsyncState<
    IndexItem[]
  >(resolveInitialIndices(market))

  useEffect(() => {
    const initial = resolveInitialIndices(market)
    if (initial.length > 0) {
      onSuccess(initial)
    } else {
      onSuccess([])
      setStatus("idle")
    }
  }, [market, onSuccess, setStatus])

  const load = useCallback(async () => {
    try {
      setStatus("loading")
      const payload = await fetchIndices(market)
      onSuccess(payload.indices)
      writeIndicesCache(market, payload.indices)
    } catch (err) {
      onError(err)
    }
  }, [market, onError, onSuccess, setStatus])

  usePolling(load, pollMs)

  return { data, status, error }
}

export type RankingMode =
  | "market_cap"
  | "volume"
  | "trading_value"
  | "gainers"
  | "losers"
export type RankingApiMode =
  | "market_cap"
  | "turnover"
  | "volume"
  | "gainers"
  | "losers"

type RankingModeState = {
  items: RankingItem[]
  status: ApiStatus
  error: string | null
  cursor: string | null
  hasMore: boolean
  isLoadingMore: boolean
  autoLoad: boolean
  manualLoads: number
}

const rankingModeSortMap: Record<
  RankingMode,
  { sortKey: RankingSortKey; sortDir: RankingSortDir; apiMode: RankingApiMode }
> = {
  market_cap: { sortKey: "marketCap", sortDir: "desc", apiMode: "market_cap" },
  volume: { sortKey: "volume", sortDir: "desc", apiMode: "volume" },
  trading_value: {
    sortKey: "turnover",
    sortDir: "desc",
    apiMode: "turnover",
  },
  gainers: {
    sortKey: "changePercent",
    sortDir: "desc",
    apiMode: "gainers",
  },
  losers: {
    sortKey: "changePercent",
    sortDir: "asc",
    apiMode: "losers",
  },
}

const createRankingState = (
  marketKey: string,
  mode: RankingMode,
): RankingModeState => {
  const cached = readRankingCache(marketKey, mode)
  return {
    items: cached.items,
    status: cached.items.length > 0 ? "ready" : "idle",
    error: null,
    cursor: cached.cursor,
    hasMore: cached.items.length > 0 ? cached.hasMore : false,
    isLoadingMore: false,
    autoLoad: false,
    manualLoads: 0,
  }
}

const buildRankingStateMap = (marketKey: string) => ({
  market_cap: createRankingState(marketKey, "market_cap"),
  volume: createRankingState(marketKey, "volume"),
  trading_value: createRankingState(marketKey, "trading_value"),
  gainers: createRankingState(marketKey, "gainers"),
  losers: createRankingState(marketKey, "losers"),
})

export const useMarketRankings = (
  market: "KR" | "US",
  mode: RankingMode,
  pageSize = 50,
) => {
  const [states, setStates] = useState<
    Record<string, Record<RankingMode, RankingModeState>>
  >(() => ({
    KR: buildRankingStateMap("KR"),
    US: buildRankingStateMap("US"),
  }))
  const abortRef = useRef<AbortController | null>(null)
  const marketKey = market === "US" ? "US" : "KR"
  const modeState =
    states[marketKey]?.[mode] ?? createRankingState(marketKey, mode)
  const itemsRef = useRef<RankingItem[]>(modeState.items)
  const { sortKey, sortDir, apiMode } = rankingModeSortMap[mode]
  const perfRef = useRef<{
    key: string
    responseLogged: boolean
    renderLogged: boolean
  } | null>(null)
  const batchAbortRef = useRef<AbortController | null>(null)
  const lastBatchKeyRef = useRef("")
  const lastBatchCountRef = useRef(0)
  const rankingItemCodes = useMemo(
    () => modeState.items.map((item) => item.code).filter(Boolean),
    [modeState.items],
  )
  const rankingItemKey = rankingItemCodes.join("|")
  const rankingItemCodesRef = useRef(rankingItemCodes)

  useEffect(() => {
    itemsRef.current = modeState.items
  }, [modeState.items])

  useEffect(() => {
    rankingItemCodesRef.current = rankingItemCodes
  }, [rankingItemCodes])

  const loadPage = useCallback(
    async ({
      cursor,
      append = false,
      keepItems = false,
    }: {
      cursor: string | null
      append?: boolean
      keepItems?: boolean
    }) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      if (!append) {
        const key = `market:${marketKey}:${mode}:${Date.now()}`
        perfRef.current = {
          key,
          responseLogged: false,
          renderLogged: false,
        }
        perfStart(key)
      }

      setStates((prev) => {
        const marketState = prev[marketKey] ?? buildRankingStateMap(marketKey)
        const current = marketState[mode]
        const shouldKeep = keepItems && current.items.length > 0
        return {
          ...prev,
          [marketKey]: {
            ...marketState,
            [mode]: {
              ...current,
              status: append
                ? current.status
                : shouldKeep
                  ? "ready"
                  : "loading",
              error: null,
              cursor: append ? current.cursor : null,
              hasMore: append ? current.hasMore : false,
              isLoadingMore: append,
              items: append ? current.items : shouldKeep ? current.items : [],
            },
          },
        }
      })

      try {
        const payload = await fetchRankings({
          region: market,
          mode: apiMode,
          sortKey,
          sortDir,
          limit: pageSize,
          cursor,
          signal: controller.signal,
        })
        const perfState = perfRef.current
        if (perfState && !perfState.responseLogged) {
          perfMark(perfState.key, "response")
          perfState.responseLogged = true
        }
        const nextItems = append
          ? mergeRankingItems(itemsRef.current, payload.items)
          : payload.items
        startTransition(() => {
          setStates((prev) => {
            const marketState =
              prev[marketKey] ?? buildRankingStateMap(marketKey)
            const current = marketState[mode]
            return {
              ...prev,
              [marketKey]: {
                ...marketState,
                [mode]: {
                  ...current,
                  items: nextItems,
                  status: "ready",
                  error: null,
                  cursor: payload.nextCursor ?? null,
                  hasMore: payload.hasMore,
                  isLoadingMore: false,
                },
              },
            }
          })
        })
        writeRankingCache(
          marketKey,
          mode,
          nextItems,
          payload.nextCursor ?? null,
          payload.hasMore,
        )
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return
        }
        const message = err instanceof Error ? err.message : "데이터 오류"
        const perfState = perfRef.current
        if (perfState && !perfState.renderLogged) {
          perfMark(perfState.key, "error", true)
          perfState.renderLogged = true
        }
        setStates((prev) => ({
          ...prev,
          [marketKey]: {
            ...(prev[marketKey] ?? buildRankingStateMap(marketKey)),
            [mode]: {
              ...(prev[marketKey]?.[mode] ??
                createRankingState(marketKey, mode)),
              status: "error",
              error: message,
              isLoadingMore: false,
            },
          },
        }))
      }
    },
    [apiMode, market, marketKey, mode, pageSize, sortDir, sortKey],
  )

  useEffect(() => {
    const perfState = perfRef.current
    if (
      !perfState ||
      perfState.renderLogged ||
      modeState.status !== "ready" ||
      modeState.items.length === 0
    ) {
      return
    }
    perfMark(perfState.key, "render", true)
    perfState.renderLogged = true
  }, [modeState.items.length, modeState.status])

  const applyBatchQuotes = useCallback(
    (quotes: Record<string, BatchQuoteItem>) => {
      if (!quotes || Object.keys(quotes).length === 0) {
        return
      }
      startTransition(() => {
        setStates((prev) => {
          const marketState = prev[marketKey] ?? buildRankingStateMap(marketKey)
          const current = marketState[mode]
          let changed = false
          const nextItems = current.items.map((item) => {
            const quote = quotes[item.code]
            if (!quote) {
              return item
            }
            const hasPrice = typeof quote.price === "number" && quote.price > 0
            const nextPrice = hasPrice ? quote.price : item.price
            const nextChange = quote.change ?? item.change
            const nextChangeRate = quote.changeRate ?? item.changeRate
            const nextVolume = quote.volume ?? item.volume
            const nextValue = quote.turnover ?? item.value
            const nextMcap = quote.marketCap ?? item.mcap
            if (
              nextPrice === item.price &&
              nextChange === item.change &&
              nextChangeRate === item.changeRate &&
              nextVolume === item.volume &&
              nextValue === item.value &&
              nextMcap === item.mcap
            ) {
              return item
            }
            changed = true
            return {
              ...item,
              price: nextPrice,
              change: nextChange,
              changeRate: nextChangeRate,
              volume: nextVolume,
              value: nextValue,
              mcap: nextMcap,
            }
          })
          if (!changed) {
            return prev
          }
          return {
            ...prev,
            [marketKey]: {
              ...marketState,
              [mode]: {
                ...current,
                items: nextItems,
              },
            },
          }
        })
      })
    },
    [marketKey, mode],
  )

  useEffect(() => {
    if (rankingItemKey.length === 0) {
      return
    }
    const baseKey = `${marketKey}:${mode}`
    if (lastBatchKeyRef.current !== baseKey) {
      lastBatchKeyRef.current = baseKey
      lastBatchCountRef.current = 0
    }
    const codes = rankingItemCodesRef.current
    const startIndex = Math.min(lastBatchCountRef.current, codes.length)
    const pending = codes.slice(startIndex)
    if (pending.length === 0) {
      return
    }
    lastBatchCountRef.current = codes.length
    batchAbortRef.current?.abort()
    const controller = new AbortController()
    batchAbortRef.current = controller
    const chunkSize = Math.min(Math.max(pageSize, 20), 80)
    const run = async () => {
      for (let i = 0; i < pending.length; i += chunkSize) {
        const symbols = pending.slice(i, i + chunkSize)
        const payload = await fetchBatchQuotes({
          region: market,
          symbols,
          signal: controller.signal,
        })
        if (controller.signal.aborted) {
          return
        }
        applyBatchQuotes(payload.quotesBySymbol)
      }
    }
    run().catch((err) => {
      if (err instanceof DOMException && err.name === "AbortError") {
        return
      }
    })
    return () => {
      controller.abort()
    }
  }, [applyBatchQuotes, market, marketKey, mode, pageSize, rankingItemKey])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch drives state updates
    loadPage({ cursor: null, append: false, keepItems: true })
    return () => {
      abortRef.current?.abort()
    }
  }, [loadPage])

  const loadMore = useCallback(
    (source: "manual" | "auto" = "manual") => {
      if (modeState.isLoadingMore || !modeState.hasMore || !modeState.cursor) {
        return
      }
      loadPage({ cursor: modeState.cursor, append: true, keepItems: true })
      if (source === "manual") {
        setStates((prev) => {
          const marketState = prev[marketKey] ?? buildRankingStateMap(marketKey)
          const current = marketState[mode]
          const nextManual = current.manualLoads + 1
          const nextAuto = current.autoLoad || nextManual >= 2
          return {
            ...prev,
            [marketKey]: {
              ...marketState,
              [mode]: {
                ...current,
                autoLoad: nextAuto,
                manualLoads: nextManual,
              },
            },
          }
        })
      }
    },
    [loadPage, marketKey, mode, modeState],
  )

  const refreshSilent = useCallback(() => {
    if (modeState.items.length > pageSize || modeState.isLoadingMore) {
      return
    }
    loadPage({ cursor: null, append: false, keepItems: true })
  }, [loadPage, modeState.isLoadingMore, modeState.items.length, pageSize])

  usePolling(refreshSilent, 15000, false)

  return {
    items: modeState.items,
    status: modeState.status,
    error: modeState.error,
    hasMore: modeState.hasMore,
    isLoadingMore: modeState.isLoadingMore,
    autoLoad: modeState.autoLoad,
    loadMore,
  }
}

export const useQuote = (symbol: string, pollMs = 5000) => {
  const { data, status, error, onError, onSuccess, setStatus } =
    useAsyncState<Quote | null>(resolveInitialQuote(symbol))
  const dataRef = useRef<Quote | null>(data)
  const abortRef = useRef<AbortController | null>(null)
  const inflightRef = useRef(false)
  const inflightKeyRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)
  const backoffRef = useRef<{
    key: string
    failures: number
    nextAllowedAt: number
  }>({ key: "", failures: 0, nextAllowedAt: 0 })

  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    abortRef.current?.abort()
    inflightRef.current = false
    inflightKeyRef.current = null
    requestIdRef.current += 1
    backoffRef.current = { key: "", failures: 0, nextAllowedAt: 0 }
    const initial = resolveInitialQuote(symbol)
    if (initial) {
      onSuccess(initial)
    } else {
      onSuccess(null)
      setStatus("idle")
    }
  }, [onSuccess, setStatus, symbol])

  const load = useCallback(async () => {
    if (!symbol) {
      return
    }
    const cacheKey = `quote:${symbol}`
    if (inflightRef.current && inflightKeyRef.current === cacheKey) {
      return
    }
    const backoff = backoffRef.current
    const nowMs = Date.now()
    if (backoff.key === cacheKey && backoff.nextAllowedAt > nowMs) {
      return
    }
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    inflightRef.current = true
    inflightKeyRef.current = cacheKey
    try {
      const hasCached = Boolean((dataRef.current?.price ?? 0) > 0)
      if (!hasCached) {
        setStatus("loading")
      }
      const payload = await fetchQuote(symbol, controller.signal)
      if (controller.signal.aborted || requestId !== requestIdRef.current) {
        return
      }
      onSuccess(payload.quote)
      writeQuoteCache(symbol, payload.quote)
      if (backoffRef.current.key === cacheKey) {
        backoffRef.current = { key: cacheKey, failures: 0, nextAllowedAt: 0 }
      }
    } catch (err) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) {
        return
      }
      onError(err)
      const current = backoffRef.current
      const failures = current.key === cacheKey ? current.failures + 1 : 1
      const jitter = Math.random() * 200
      const delay = Math.min(
        60000,
        Math.round(500 * 2 ** Math.min(failures, 6) + jitter),
      )
      backoffRef.current = {
        key: cacheKey,
        failures,
        nextAllowedAt: Date.now() + delay,
      }
    } finally {
      if (requestId === requestIdRef.current) {
        inflightRef.current = false
        inflightKeyRef.current = null
      }
    }
  }, [onError, onSuccess, setStatus, symbol])

  usePolling(load, pollMs)

  return { data, status, error }
}

const resolveCandleLimit = (tf: string) => {
  switch (tf) {
    case "1m":
      return 390
    case "3m":
      return 390
    case "5m":
      return 390
    case "10m":
      return 390
    case "15m":
      return 390
    case "30m":
      return 240
    case "1h":
      return 200
    case "4h":
      return 200
    case "1w":
      return 156
    case "1mo":
      return 60
    case "1d":
    default:
      return 260
  }
}

export const useCandles = (
  symbol: string,
  tf: string,
  pollMs: number,
  region: "KR" | "US" = "KR",
) => {
  const { data, status, error, onError, onSuccess, setStatus } = useAsyncState<
    Candle[]
  >([])
  const abortRef = useRef<AbortController | null>(null)
  const inflightRef = useRef(false)
  const inflightKeyRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)
  const debouncedTf = useDebouncedValue(tf, 200)
  const debouncedPollMs = useDebouncedValue(pollMs, 200)
  const limit = resolveCandleLimit(debouncedTf)
  const perfKey = `chart:${symbol}:${debouncedTf}`
  const cacheKey = useMemo(
    () => `chart:${region}:${symbol}:${debouncedTf}`,
    [debouncedTf, region, symbol],
  )

  const load = useCallback(async () => {
    if (!symbol) {
      return
    }
    if (inflightRef.current && inflightKeyRef.current === cacheKey) {
      return
    }
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    inflightRef.current = true
    inflightKeyRef.current = cacheKey
    try {
      const cached = readChartCache(cacheKey)
      if (cached && cached.data.length > 0) {
        onSuccess(cached.data)
      } else {
        setStatus("loading")
      }
      perfStart(perfKey)
      const days = isIntradayInterval(debouncedTf)
        ? region === "US"
          ? 5
          : 1
        : 1
      const payload = await fetchCandles(
        symbol,
        debouncedTf,
        limit,
        region,
        days,
        controller.signal,
      )
      if (controller.signal.aborted || requestId !== requestIdRef.current) {
        return
      }
      perfMark(perfKey, "response")
      const toSortableTime = (value: string | number) => {
        if (typeof value === "number") {
          return value
        }
        const digits = value.replace(/\D/g, "")
        return digits ? Number(digits) : null
      }
      const sorted = [...payload.series.points].sort((a, b) => {
        const aTime = toSortableTime(a.time)
        const bTime = toSortableTime(b.time)
        if (aTime !== null && bTime !== null) {
          return aTime - bTime
        }
        return String(a.time).localeCompare(String(b.time))
      })
      onSuccess(sorted)
      writeChartCache(cacheKey, sorted)
    } catch (err) {
      if (controller.signal.aborted) {
        return
      }
      if (requestId !== requestIdRef.current) {
        return
      }
      perfMark(perfKey, "error", true)
      onError(err)
    } finally {
      if (requestId === requestIdRef.current) {
        inflightRef.current = false
        inflightKeyRef.current = null
      }
    }
  }, [
    cacheKey,
    debouncedTf,
    limit,
    onError,
    onSuccess,
    perfKey,
    region,
    setStatus,
    symbol,
  ])

  useEffect(() => {
    void load()
  }, [load])

  usePolling(load, debouncedPollMs, false)

  useEffect(
    () => () => {
      abortRef.current?.abort()
      inflightRef.current = false
      inflightKeyRef.current = null
    },
    [],
  )

  return { data, status, error }
}

export const useNews = (symbol: string, market: "KR" | "US") => {
  const { data, status, error, onError, onSuccess, setStatus } = useAsyncState<
    NewsItem[]
  >([])

  const load = useCallback(async () => {
    if (!symbol) {
      return
    }
    setStatus("loading")
    const payload = await fetchNews(symbol, market)
    onSuccess(payload.items)
  }, [market, onSuccess, setStatus, symbol])

  useEffect(() => {
    load().catch(onError)
  }, [load, onError])

  return { data, status, error }
}

export const useDisclosures = (symbol: string, market: "KR" | "US") => {
  const { data, status, error, onError, onSuccess, setStatus } = useAsyncState<
    DisclosureItem[]
  >([])

  const load = useCallback(async () => {
    if (!symbol) {
      return
    }
    setStatus("loading")
    const payload = await fetchDisclosures(symbol, market)
    onSuccess(payload.items)
  }, [market, onSuccess, setStatus, symbol])

  useEffect(() => {
    load().catch(onError)
  }, [load, onError])

  return { data, status, error }
}

export const useMemoStorage = (symbol: string) => {
  const storageKey = useMemo(() => `memo:${symbol}`, [symbol])
  const [items, setItems] = useState<
    { id: string; title: string; body: string; createdAt: string }[]
  >(() => {
    if (typeof window === "undefined") {
      return []
    }
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) {
      return []
    }
    try {
      return JSON.parse(raw) as {
        id: string
        title: string
        body: string
        createdAt: string
      }[]
    } catch {
      return []
    }
  })

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    window.localStorage.setItem(storageKey, JSON.stringify(items))
  }, [items, storageKey])

  return { items, setItems }
}

export const useSymbolsSearch = (
  market: "KOSPI" | "KOSDAQ" | "ALL",
  query: string,
  limit = 10,
  minLength = 1,
) => {
  const [remoteState, setRemoteState] = useState<{
    key: string
    items: SymbolSearchItem[]
    cursor: string | null
    status: ApiStatus
    error: string | null
    notice: { code: string; message: string } | null
  }>({
    key: "",
    items: [],
    cursor: null,
    status: "idle",
    error: null,
    notice: null,
  })
  const [, setCacheVersion] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const normalized = query.trim()
  const canSearch = normalized.length >= minLength
  const searchKey = `${market}:${normalized}:${minLength}:${limit}`

  useEffect(() => {
    return subscribeSymbolCache(() => {
      setCacheVersion((value) => value + 1)
    })
  }, [])

  useEffect(() => {
    abortRef.current?.abort()
    if (canSearch) {
      preloadSymbolCache()
    }
  }, [canSearch, searchKey])

  const localItems = canSearch
    ? searchLocalSymbols(market, normalized, limit)
    : []
  const activeRemote = remoteState.key === searchKey ? remoteState : null
  const mergedItems = activeRemote
    ? mergeSymbolItems(localItems, activeRemote.items)
    : localItems
  const status = canSearch ? (activeRemote?.status ?? "ready") : "idle"
  const error = canSearch ? (activeRemote?.error ?? null) : null
  const notice = canSearch ? (activeRemote?.notice ?? null) : null

  const loadMore = useCallback(async () => {
    if (!canSearch || status === "loading") {
      return
    }
    const currentRemote = remoteState.key === searchKey ? remoteState : null
    if (currentRemote && !currentRemote.cursor) {
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const baseItems = currentRemote?.items ?? []
    const baseCursor = currentRemote?.cursor ?? null
    try {
      setRemoteState({
        key: searchKey,
        items: baseItems,
        cursor: baseCursor,
        status: "loading",
        error: null,
        notice: currentRemote?.notice ?? null,
      })
      const payload = await fetchSymbols({
        market,
        query: normalized,
        limit,
        cursor: baseCursor ?? undefined,
        signal: controller.signal,
      })
      if (payload.ok === false) {
        setRemoteState({
          key: searchKey,
          items: baseItems,
          cursor: null,
          status: "ready",
          error: null,
          notice: {
            code: payload.code ?? "SYMBOL_CACHE_MISSING",
            message:
              payload.message ??
              "Symbols cache missing. Run npm run symbols:update.",
          },
        })
        return
      }
      setRemoteState({
        key: searchKey,
        items: mergeSymbolItems(baseItems, payload.items),
        cursor: payload.nextCursor,
        status: "ready",
        error: null,
        notice: payload.warning ?? null,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return
      }
      const message = err instanceof Error ? err.message : "데이터 오류"
      setRemoteState({
        key: searchKey,
        items: baseItems,
        cursor: baseCursor,
        status: "error",
        error: message,
        notice: currentRemote?.notice ?? null,
      })
    }
  }, [canSearch, limit, market, normalized, remoteState, searchKey, status])

  const localHasMore = localItems.length >= limit
  const hasMore = canSearch
    ? activeRemote
      ? Boolean(activeRemote.cursor)
      : localHasMore
    : false

  return {
    items: canSearch ? mergedItems : [],
    status,
    error,
    notice,
    hasMore,
    canSearch,
    loadMore,
  }
}
