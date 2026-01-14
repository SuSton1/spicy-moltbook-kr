import { defineConfig, loadEnv, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import dotenv from "dotenv"
import iconv from "iconv-lite"
import * as cheerio from "cheerio"
import {
  buildRankingCacheKey,
  decodeRankingCursor,
  encodeRankingCursor,
  normalizeRankingSortDir,
  normalizeRankingSortKey,
  sortRankingItems,
  type RankingSortDir,
  type RankingSortKey,
} from "./src/lib/rankings"
import { paginateSymbols, type SymbolItem } from "./src/lib/symbols"
import {
  resolveIndexFallback,
  type IndexDailyPoint,
} from "./src/lib/indexFallback"
import { normalizeQuoteMetrics } from "./src/lib/kisMetrics"
import { normalizeOverseasQuoteMetrics } from "./src/lib/kisOverseasMetrics"
import {
  resolveIntradayInterval,
  resolveUsProviderMinutes,
  resolveKrProviderMinutes,
} from "./src/lib/chartIntervals"
import {
  aggregateIntradayCandles,
  buildIntradayTimeKey,
  limitCandlesByDays,
  normalizeCandleSeries,
} from "./src/lib/intraday"
import { formatTimeInZone, toEpochMsInZone } from "./src/lib/timezone"
import {
  getUsSymbols,
  normalizeUsTickerForProvider,
  type UsSymbolGroup,
} from "./server/usSymbolMaster"

type KisTokenCache = {
  token: string
  expiresAt: number
}

type FetchOptions = {
  method: string
  headers?: Record<string, string>
  body?: string
}

type CandlePoint = {
  time: string | number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type MarketIndex = {
  code: string
  name: string
  price: number
  change: number
  changeRate: number
  refDate?: string
  isFallback?: boolean
  updatedAt?: string
}

type RankingItem = {
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

type BatchQuoteItem = {
  code: string
  price: number | null
  change: number | null
  changeRate: number | null
  volume: number | null
  turnover: number | null
  marketCap: number | null
  updatedAt?: string
}

type UsQuoteFixture = {
  price: number
  change: number
  changeRate: number
  volume: number
  marketCap: number
}

type RankingCachePayload = {
  items: RankingItem[]
  totalCount: number
}

type MetricsCacheEntry = {
  item: RankingItem
  updatedAt: number
}

type NewsItem = {
  id: string
  title: string
  source: string
  date: string
  link: string
}

type NaverNewsItem = {
  id: string
  title: string
  officeName: string
  datetime: string
}

type DisclosureItem = {
  id: string
  title: string
  source: string
  date: string
  link: string
}

type SymbolCacheEntry = {
  items: SymbolItem[]
  mtimeMs: number
}

type MarketRegion = "KR" | "US"

const APP_KEY_KEYS = [
  "KIS_APP_KEY",
  "KIS_APPKEY",
  "APP_KEY",
  "APPKEY",
  "VITE_KIS_APP_KEY",
  "VITE_KIS_APPKEY",
  "VITE_APP_KEY",
  "VITE_APPKEY",
]

const APP_SECRET_KEYS = [
  "KIS_APP_SECRET",
  "KIS_APPSECRET",
  "APP_SECRET",
  "APPSECRET",
  "VITE_KIS_APP_SECRET",
  "VITE_KIS_APPSECRET",
  "VITE_APP_SECRET",
  "VITE_APPSECRET",
]

const DATA_MODE_KEYS = ["E2E_DATA_MODE", "DATA_MODE", "VITE_DATA_MODE"]

const ENV_MODE_KEYS = ["KIS_ENV", "VITE_KIS_ENV"]

const BASE_URL_KEYS = ["KIS_BASE_URL", "VITE_KIS_BASE_URL"]

const readEnvValue = (env: Record<string, string>, keys: string[]) => {
  for (const key of keys) {
    const value = env[key]
    if (value) {
      return value
    }
  }
  return ""
}

const resolveDataMode = (env: Record<string, string>) => {
  const explicit = readEnvValue(env, DATA_MODE_KEYS).trim().toLowerCase()
  if (explicit) {
    if (explicit.includes("contract")) {
      return "contract"
    }
    return explicit.includes("kis") ? "kis" : "fixture"
  }
  const appKey = readEnvValue(env, APP_KEY_KEYS)
  const appSecret = readEnvValue(env, APP_SECRET_KEYS)
  return appKey && appSecret ? "kis" : "fixture"
}

const loadLocalEnv = (rootDir: string) => {
  const candidates = [".env.local", "env.local"]
  candidates.forEach((file) => {
    const fullPath = path.join(rootDir, file)
    if (fs.existsSync(fullPath)) {
      dotenv.config({ path: fullPath })
    }
  })
}

const buildRankingItems = (items: SymbolItem[]) =>
  items.map((item, index) => {
    const price = 12000 + index * 240
    const change = (index % 2 === 0 ? 1 : -1) * (6 + index * 2)
    const changeRate = Number(((change / price) * 100).toFixed(2))
    const volume = 800000 + index * 42000
    const value = price * volume
    return {
      rank: index + 1,
      code: item.symbol,
      name: item.name,
      market: item.market,
      price,
      change,
      changeRate,
      volume,
      value,
      mcap: value * 4.2,
    }
  })

const createFixtures = () => {
  const now = new Date()
  const baseSymbols = [
    { code: "005930", name: "삼성전자", market: "KOSPI" },
    { code: "000660", name: "SK하이닉스", market: "KOSPI" },
    { code: "035420", name: "NAVER", market: "KOSPI" },
    { code: "051910", name: "LG화학", market: "KOSPI" },
    { code: "012860", name: "모베이스전자", market: "KOSDAQ" },
  ]
  const symbols: SymbolItem[] = Array.from({ length: 30 }).map((_, index) => {
    const symbol = String(100000 + index).padStart(6, "0")
    return {
      symbol,
      name: `${APP_NAME} 더미 ${index + 1}`,
      market: index % 2 === 0 ? "KOSPI" : "KOSDAQ",
      kind: "STOCK",
      status: "LISTED",
      updatedAt: now.toISOString(),
    }
  })

  const buildCandles = (seed: number): CandlePoint[] => {
    const result: CandlePoint[] = []
    let last = seed
    for (let i = 0; i < 120; i += 1) {
      const date = new Date(now.getTime() - (120 - i) * 24 * 60 * 60 * 1000)
      const time = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
        date.getDate(),
      ).padStart(2, "0")}`
      const swing = Math.sin(i / 4) * 20 + Math.cos(i / 6) * 12
      const open = Math.max(1, Math.round(last + swing))
      const close = Math.max(1, Math.round(open + Math.sin(i / 3) * 24))
      const high = Math.max(open, close) + 20
      const low = Math.min(open, close) - 18
      const volume = Math.round(400000 + Math.abs(Math.sin(i / 3)) * 800000)
      result.push({ time, open, high, low, close, volume })
      last = close
    }
    return result
  }

  const quotes = Object.fromEntries(
    baseSymbols.map((item, index) => {
      const price = 70000 + index * 12000
      return [
        item.code,
        {
          code: item.code,
          name: item.name,
          price,
          change: 1200 - index * 200,
          changeRate: 1.2 - index * 0.3,
          volume: 3000000 + index * 200000,
          updatedAt: now.toISOString(),
        },
      ]
    }),
  )

  const candles = Object.fromEntries(
    baseSymbols.map((item, index) => [
      item.code,
      buildCandles(3200 + index * 500),
    ]),
  )

  const indices: MarketIndex[] = [
    {
      code: "KOSPI",
      name: "코스피",
      price: 2638.42,
      change: 11.32,
      changeRate: 0.44,
      updatedAt: now.toISOString(),
    },
    {
      code: "KOSDAQ",
      name: "코스닥",
      price: 852.17,
      change: -4.12,
      changeRate: -0.47,
      updatedAt: now.toISOString(),
    },
  ]

  const indexDaily: Record<"KOSPI" | "KOSDAQ", IndexDailyPoint[]> = {
    KOSPI: Array.from({ length: 10 }).map((_, index) => {
      const date = new Date(now.getTime() - (10 - index) * 24 * 60 * 60 * 1000)
      const close = 2550 + index * 3.1
      return {
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
          date.getDate(),
        ).padStart(2, "0")}`,
        close,
        change: index === 9 ? 3.1 : 0,
        changeRate: index === 9 ? 0.12 : 0,
      }
    }),
    KOSDAQ: Array.from({ length: 10 }).map((_, index) => {
      const date = new Date(now.getTime() - (10 - index) * 24 * 60 * 60 * 1000)
      const close = 865 + index * 1.4
      return {
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
          date.getDate(),
        ).padStart(2, "0")}`,
        close,
        change: index === 9 ? 1.4 : 0,
        changeRate: index === 9 ? 0.16 : 0,
      }
    }),
  }

  const rankingItems: RankingItem[] = buildRankingItems(symbols)

  const news: NewsItem[] = Array.from({ length: 8 }).map((_, index) => ({
    id: `fixture-news-${index}`,
    title: `${APP_NAME} 데일리 뉴스 ${index + 1}`,
    source: "Fixture News",
    date: `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(
      now.getDate(),
    ).padStart(2, "0")}`,
    link: "https://example.com",
  }))

  const disclosures: DisclosureItem[] = Array.from({ length: 4 }).map(
    (_, index) => ({
      id: `fixture-disclosure-${index}`,
      title: `${APP_NAME} 공시 더미 ${index + 1}`,
      source: "Fixture Disclosure",
      date: `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(
        now.getDate(),
      ).padStart(2, "0")}`,
      link: "https://example.com",
    }),
  )

  return {
    baseSymbols,
    quotes,
    candles,
    indices,
    indexDaily,
    symbols,
    rankingItems,
    news,
    disclosures,
  }
}

const APP_NAME = "최대운주식"

const createApiProxy = (
  env: Record<string, string>,
  rootDir: string,
): Plugin => {
  const dataMode = resolveDataMode(env)
  const isContractMode = dataMode === "contract"
  const fixtureSource = isContractMode ? "contract" : "fixture"
  const isDevServer = (env.NODE_ENV ?? "").toLowerCase() !== "production"
  const logPerf = (label: string, start: number) => {
    if (!isDevServer) {
      return
    }
    const elapsed = Date.now() - start
    console.info(`[perf] ${label} ${elapsed}ms`)
  }

  const fixtures = createFixtures()
  const fixtureRankingLookup = new Map(
    fixtures.rankingItems.map((item) => [item.code, item]),
  )
  const dataDir = path.join(rootDir, "server", "data")
  const contractPath = path.join(dataDir, "kis.contract.json")
  const contractSeed = fs.existsSync(contractPath)
    ? (JSON.parse(fs.readFileSync(contractPath, "utf8")) as {
        symbols?: string[]
        quotes?: Record<string, { output?: Record<string, unknown> }>
      })
    : null
  const contractData = dataMode === "contract" ? contractSeed : null
  const contractSymbols = contractData?.symbols ?? []
  const contractQuotes = contractData?.quotes ?? null
  const marketCapSeeds = contractSeed?.symbols ?? []
  const usQuotePath = path.join(dataDir, "quotes.us.contract.json")
  const usQuoteFixtures = fs.existsSync(usQuotePath)
    ? (JSON.parse(fs.readFileSync(usQuotePath, "utf8")) as Record<
        string,
        UsQuoteFixture
      >)
    : null
  const intradayFixturePath = path.join(dataDir, "intraday.contract.json")
  const intradayFixtures = fs.existsSync(intradayFixturePath)
    ? (JSON.parse(fs.readFileSync(intradayFixturePath, "utf8")) as {
        symbols?: Record<
          string,
          { region: MarketRegion; points: CandlePoint[] }
        >
      })
    : null
  const contractSymbolSet = new Set(contractSymbols)
  const usQuoteFixtureMap = usQuoteFixtures
    ? new Map(Object.entries(usQuoteFixtures))
    : new Map<string, UsQuoteFixture>()

  const appKey = readEnvValue(env, APP_KEY_KEYS)
  const appSecret = readEnvValue(env, APP_SECRET_KEYS)
  const envMode = readEnvValue(env, ENV_MODE_KEYS).toLowerCase()
  const baseUrl =
    readEnvValue(env, BASE_URL_KEYS) ||
    (envMode === "mock"
      ? "https://openapivts.koreainvestment.com:29443"
      : "https://openapi.koreainvestment.com:9443")

  const trIds = {
    quote: readEnvValue(env, [
      "KIS_TR_PRICE",
      "KIS_TR_QUOTE",
      "KIS_TR_STOCK_PRICE",
      "KIS_TR_ID_PRICE",
      "KIS_TR_ID_QUOTE",
      "VITE_KIS_TR_PRICE",
      "VITE_KIS_TR_QUOTE",
      "VITE_KIS_TR_STOCK_PRICE",
      "VITE_KIS_TR_ID_PRICE",
      "VITE_KIS_TR_ID_QUOTE",
    ]),
    daily: readEnvValue(env, [
      "KIS_TR_DAILY",
      "KIS_TR_ID_DAILY",
      "VITE_KIS_TR_DAILY",
      "VITE_KIS_TR_ID_DAILY",
    ]),
    intraday: readEnvValue(env, [
      "KIS_TR_INTRADAY",
      "KIS_TR_ID_INTRADAY",
      "VITE_KIS_TR_INTRADAY",
      "VITE_KIS_TR_ID_INTRADAY",
    ]),
    index: readEnvValue(env, [
      "KIS_TR_INDEX_INTRADAY",
      "KIS_TR_INDEX",
      "KIS_TR_ID_INDEX",
      "KIS_TR_ID_INDEX_INTRADAY",
      "VITE_KIS_TR_INDEX_INTRADAY",
      "VITE_KIS_TR_INDEX",
      "VITE_KIS_TR_ID_INDEX",
      "VITE_KIS_TR_ID_INDEX_INTRADAY",
    ]),
    indexDaily: readEnvValue(env, [
      "KIS_TR_INDEX_DAILY",
      "KIS_TR_INDEX",
      "KIS_TR_ID_INDEX_DAILY",
      "KIS_TR_ID_INDEX",
      "VITE_KIS_TR_INDEX_DAILY",
      "VITE_KIS_TR_INDEX",
      "VITE_KIS_TR_ID_INDEX_DAILY",
      "VITE_KIS_TR_ID_INDEX",
    ]),
    usPrice:
      readEnvValue(env, [
        "KIS_TR_US_PRICE",
        "KIS_TR_OVERSEAS_PRICE",
        "KIS_TR_OVS_PRICE",
        "KIS_TR_ID_US_PRICE",
        "KIS_TR_ID_OVERSEAS_PRICE",
        "KIS_TR_ID_OVS_PRICE",
        "VITE_KIS_TR_US_PRICE",
        "VITE_KIS_TR_OVERSEAS_PRICE",
        "VITE_KIS_TR_OVS_PRICE",
      ]) || "HHDFS00000300",
    usPriceDetail:
      readEnvValue(env, [
        "KIS_TR_US_PRICE_DETAIL",
        "KIS_TR_OVERSEAS_PRICE_DETAIL",
        "KIS_TR_OVS_PRICE_DETAIL",
        "KIS_TR_ID_US_PRICE_DETAIL",
        "KIS_TR_ID_OVERSEAS_PRICE_DETAIL",
        "KIS_TR_ID_OVS_PRICE_DETAIL",
        "VITE_KIS_TR_US_PRICE_DETAIL",
        "VITE_KIS_TR_OVERSEAS_PRICE_DETAIL",
        "VITE_KIS_TR_OVS_PRICE_DETAIL",
      ]) || "HHDFS76200200",
    usIntraday:
      readEnvValue(env, [
        "KIS_TR_US_INTRADAY",
        "KIS_TR_OVERSEAS_INTRADAY",
        "KIS_TR_OVS_INTRADAY",
        "KIS_TR_ID_US_INTRADAY",
        "KIS_TR_ID_OVERSEAS_INTRADAY",
        "KIS_TR_ID_OVS_INTRADAY",
        "VITE_KIS_TR_US_INTRADAY",
        "VITE_KIS_TR_OVERSEAS_INTRADAY",
        "VITE_KIS_TR_OVS_INTRADAY",
      ]) || "HHDFS76950200",
  }

  let tokenCache: KisTokenCache | null = null
  let tokenPromise: Promise<string> | null = null
  let rateNextAt = 0
  const cache = new Map<string, { expiresAt: number; value: unknown }>()
  const inflight = new Map<string, Promise<unknown>>()
  const symbolCache: {
    kospi?: SymbolCacheEntry
    kosdaq?: SymbolCacheEntry
    all?: SymbolCacheEntry
  } = {}
  let usIndicesCache: { items: MarketIndex[]; mtimeMs: number } | null = null
  const rankingCache = new Map<
    string,
    { value: RankingCachePayload; expiresAt: number; staleAt: number }
  >()
  const rankingRefreshInflight = new Map<string, Promise<RankingCachePayload>>()
  const globalMetricsRefresh = new Map<
    MarketRegion,
    { inflight: Promise<void> | null; lastRunAt: number }
  >()
  const metricsCache = new Map<string, MetricsCacheEntry>()
  const quoteCache = new Map<
    string,
    { item: BatchQuoteItem; expiresAt: number; staleAt: number }
  >()
  const usMarketCapCache = new Map<
    string,
    { value: number | null; expiresAt: number }
  >()
  const symbolLookup = new Map<string, SymbolItem>()
  let usSymbolLookup: { map: Map<string, SymbolItem>; mtimeMs: number } | null =
    null
  const rankingCacheTtl = dataMode === "kis" ? 4000 : 15000
  const rankingCacheStaleTtl = dataMode === "kis" ? 15000 : 30000
  const metricsRefreshTtl = dataMode === "kis" ? 20000 : 60000
  const metricsTtl = 15000
  const quoteTtl = dataMode === "kis" ? 4000 : 15000
  const quoteStaleTtl = dataMode === "kis" ? 20000 : 30000
  const usMarketCapTtl = dataMode === "kis" ? 60 * 60 * 1000 : 20 * 60 * 1000

  const readRankingCacheEntry = (cacheKey: string, now: number) => {
    const cached = rankingCache.get(cacheKey)
    if (!cached) {
      return null
    }
    if (cached.staleAt <= now) {
      rankingCache.delete(cacheKey)
      return null
    }
    return {
      payload: cached.value,
      isFresh: cached.expiresAt > now,
    }
  }

  const writeRankingCacheEntry = (
    cacheKey: string,
    payload: RankingCachePayload,
    now: number,
  ) => {
    rankingCache.set(cacheKey, {
      value: payload,
      expiresAt: now + rankingCacheTtl,
      staleAt: now + rankingCacheStaleTtl,
    })
  }

  const readUsSymbolLookup = () => {
    const snapshot = getUsSymbols(dataDir, "ALL")
    if (!snapshot) {
      usSymbolLookup = null
      return null
    }
    if (!usSymbolLookup || usSymbolLookup.mtimeMs !== snapshot.mtimeMs) {
      usSymbolLookup = {
        mtimeMs: snapshot.mtimeMs,
        map: new Map(snapshot.items.map((item) => [item.symbol, item])),
      }
    }
    return usSymbolLookup
  }

  const resolveUsExchangeCode = (symbol: string) => {
    const lookup = readUsSymbolLookup()
    const exchangeRaw = lookup?.map.get(symbol)?.exchange ?? ""
    const exchange = exchangeRaw.toUpperCase()
    if (exchange === "NYSE") {
      return "NYS"
    }
    if (exchange === "AMEX" || exchange === "AMERICAN") {
      return "AMS"
    }
    return "NAS"
  }

  const readUsMarketCapCache = (symbol: string, now: number) => {
    const cached = usMarketCapCache.get(symbol)
    if (!cached || cached.expiresAt <= now) {
      return undefined
    }
    return cached.value
  }

  const writeUsMarketCapCache = (symbol: string, value: number | null) => {
    usMarketCapCache.set(symbol, {
      value,
      expiresAt: Date.now() + usMarketCapTtl,
    })
  }

  const logUsQuoteCoverage = (
    source: string,
    symbols: string[],
    quotesBySymbol: Record<string, BatchQuoteItem>,
  ) => {
    if (!isDevServer) {
      return
    }
    if (symbols.length === 0) {
      return
    }
    let missingPrice = 0
    let missingMarketCap = 0
    const missingPriceSamples: string[] = []
    const missingMarketCapSamples: string[] = []

    symbols.forEach((symbol) => {
      const quote = quotesBySymbol[symbol]
      const priceMissing = !quote || !quote.price || quote.price <= 0
      const mcapMissing =
        !quote || quote.marketCap === null || quote.marketCap === undefined
      if (priceMissing) {
        missingPrice += 1
        if (missingPriceSamples.length < 3) {
          missingPriceSamples.push(symbol)
        }
      }
      if (mcapMissing) {
        missingMarketCap += 1
        if (missingMarketCapSamples.length < 3) {
          missingMarketCapSamples.push(symbol)
        }
      }
    })

    const priceRate = Math.round((missingPrice / symbols.length) * 100)
    const mcapRate = Math.round((missingMarketCap / symbols.length) * 100)
    console.info(
      `[us-quotes] source=${source} missingPrice=${priceRate}% missingMarketCap=${mcapRate}% samples=${[
        ...new Set([...missingPriceSamples, ...missingMarketCapSamples]),
      ].join(",")}`,
    )
  }

  const scheduleRankingRefresh = (
    cacheKey: string,
    buildPayload: () => RankingCachePayload,
  ) => {
    if (rankingRefreshInflight.has(cacheKey)) {
      return
    }
    const inflight = Promise.resolve()
      .then(buildPayload)
      .then((payload) => {
        writeRankingCacheEntry(cacheKey, payload, Date.now())
        return payload
      })
      .finally(() => {
        rankingRefreshInflight.delete(cacheKey)
      })
    rankingRefreshInflight.set(cacheKey, inflight)
  }

  const ensureKeys = (
    res: import("http").ServerResponse,
    requestId: string,
  ) => {
    if (!appKey || !appSecret) {
      sendError(res, 400, "CONFIG_ERROR", "KIS keys not configured", requestId)
      return false
    }
    return true
  }

  const ensureTrId = (
    res: import("http").ServerResponse,
    key: keyof typeof trIds,
    requestId: string,
  ) => {
    if (!trIds[key]) {
      sendError(res, 400, "CONFIG_ERROR", `Missing TR_ID for ${key}`, requestId)
      return false
    }
    return true
  }

  const scheduleRate = async () => {
    const now = Date.now()
    const wait = Math.max(0, rateNextAt - now)
    rateNextAt = Math.max(now, rateNextAt) + 120
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }

  const getToken = async () => {
    const now = Date.now()
    if (tokenCache && tokenCache.expiresAt - now > 60_000) {
      return tokenCache.token
    }
    if (tokenPromise) {
      return tokenPromise
    }
    tokenPromise = (async () => {
      await scheduleRate()
      const { response, payload } = await fetchJson(
        `${baseUrl}/oauth2/tokenP`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify({
            grant_type: "client_credentials",
            appkey: appKey,
            appsecret: appSecret,
          }),
        },
      )

      if (!response.ok) {
        const message =
          payload?.msg1 || payload?.error_description || "KIS token error"
        throw new Error(message)
      }

      const expiresIn = Number(payload?.expires_in)
      tokenCache = {
        token: payload.access_token as string,
        expiresAt:
          now + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 3600_000),
      }
      return tokenCache.token
    })()
    try {
      return await tokenPromise
    } finally {
      tokenPromise = null
    }
  }

  const fetchJson = async (
    url: string,
    options: FetchOptions,
    timeoutMs = 9000,
  ) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({}))
      return { response, payload }
    } finally {
      clearTimeout(timer)
    }
  }

  const fetchText = async (url: string, timeoutMs = 9000) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { signal: controller.signal })
      const buffer = Buffer.from(await response.arrayBuffer())
      const text = iconv.decode(buffer, "euc-kr")
      return { response, text }
    } finally {
      clearTimeout(timer)
    }
  }

  const fetchWithCache = async <T>(
    key: string,
    ttlMs: number,
    fetcher: () => Promise<T>,
  ) => {
    const cached = cache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T
    }
    const existing = inflight.get(key) as Promise<T> | undefined
    if (existing) {
      return existing
    }
    const promise = fetcher()
      .then((value) => {
        cache.set(key, { value, expiresAt: Date.now() + ttlMs })
        inflight.delete(key)
        return value
      })
      .catch((error) => {
        inflight.delete(key)
        throw error
      })
    inflight.set(key, promise as Promise<unknown>)
    return promise
  }

  const parseNumber = (value: string | number | undefined) => {
    if (value === undefined || value === null) {
      return 0
    }
    const normalized = String(value).replace(/,/g, "")
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const readField = (item: Record<string, unknown>, key: string) =>
    item[key] as string | number | undefined

  const readString = (item: Record<string, unknown>, key: string) => {
    const value = item[key]
    if (value === undefined || value === null) {
      return ""
    }
    return String(value)
  }

  const readFirstString = (item: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const value = readString(item, key)
      if (value) {
        return value
      }
    }
    return ""
  }

  class UpstreamError extends Error {
    upstreamStatus: number
    upstreamCode?: string
    upstreamMessage?: string

    constructor(
      message: string,
      upstreamStatus: number,
      upstreamCode?: string,
      upstreamMessage?: string,
    ) {
      super(message)
      this.name = "UpstreamError"
      this.upstreamStatus = upstreamStatus
      this.upstreamCode = upstreamCode
      this.upstreamMessage = upstreamMessage
    }
  }

  const buildUpstreamError = (
    response: Response,
    payload: Record<string, unknown>,
    fallbackMessage: string,
  ) => {
    const upstreamCode = readFirstString(payload, [
      "msg_cd",
      "rt_cd",
      "code",
      "errorCode",
    ])
    const upstreamMessage = readFirstString(payload, [
      "msg1",
      "message",
      "error",
      "detail",
    ])
    return new UpstreamError(
      fallbackMessage,
      response.status,
      upstreamCode || undefined,
      upstreamMessage || undefined,
    )
  }

  const readFirstNumber = (item: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const value = parseNumber(readField(item, key))
      if (value !== 0) {
        return value
      }
    }
    return 0
  }

  const coerceArray = (value: unknown) => {
    if (Array.isArray(value)) {
      return value as Record<string, unknown>[]
    }
    if (value && typeof value === "object") {
      return [value as Record<string, unknown>]
    }
    return [] as Record<string, unknown>[]
  }

  const formatDate = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}${month}${day}`
  }

  const formatIsoDate = (value: string) => {
    if (value.length >= 8) {
      return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    }
    return value
  }

  const readSymbolsFile = (market: "kospi" | "kosdaq") => {
    const filePath = path.join(dataDir, `symbols.${market}.json`)
    if (!fs.existsSync(filePath)) {
      return null
    }
    const stat = fs.statSync(filePath)
    const raw = fs.readFileSync(filePath, "utf8")
    return {
      items: JSON.parse(raw) as SymbolItem[],
      mtimeMs: stat.mtimeMs,
    }
  }

  const readUsIndicesFile = () => {
    const filePath = path.join(dataDir, "indices.us.json")
    if (!fs.existsSync(filePath)) {
      return null
    }
    const stat = fs.statSync(filePath)
    const raw = fs.readFileSync(filePath, "utf8")
    return {
      items: JSON.parse(raw) as MarketIndex[],
      mtimeMs: stat.mtimeMs,
    }
  }

  const loadSymbolsEntry = (market: "kospi" | "kosdaq") => {
    const entry = readSymbolsFile(market)
    if (!entry) {
      if (market === "kospi") {
        symbolCache.kospi = undefined
      } else {
        symbolCache.kosdaq = undefined
      }
      return null
    }
    const cached = market === "kospi" ? symbolCache.kospi : symbolCache.kosdaq
    if (!cached || cached.mtimeMs !== entry.mtimeMs) {
      if (market === "kospi") {
        symbolCache.kospi = entry
      } else {
        symbolCache.kosdaq = entry
      }
    }
    return market === "kospi"
      ? (symbolCache.kospi ?? null)
      : (symbolCache.kosdaq ?? null)
  }

  const loadUsIndices = () => {
    const entry = readUsIndicesFile()
    if (!entry) {
      usIndicesCache = null
      return null
    }
    if (!usIndicesCache || usIndicesCache.mtimeMs !== entry.mtimeMs) {
      usIndicesCache = entry
    }
    return usIndicesCache
  }

  const loadSymbols = (market: "KOSPI" | "KOSDAQ" | "ALL") => {
    if (market === "KOSPI") {
      return loadSymbolsEntry("kospi")
    }
    if (market === "KOSDAQ") {
      return loadSymbolsEntry("kosdaq")
    }
    const kospi = loadSymbolsEntry("kospi")
    const kosdaq = loadSymbolsEntry("kosdaq")
    if (!kospi || !kosdaq) {
      symbolCache.all = undefined
      return null
    }
    const mtimeMs = Math.max(kospi.mtimeMs, kosdaq.mtimeMs)
    if (!symbolCache.all || symbolCache.all.mtimeMs !== mtimeMs) {
      symbolCache.all = {
        items: [...kospi.items, ...kosdaq.items],
        mtimeMs,
      }
    }
    return symbolCache.all ?? null
  }

  const normalizeQuery = (value: string) => value.trim().toLowerCase()

  const filterSymbols = (
    items: SymbolItem[],
    market: "KOSPI" | "KOSDAQ" | "ALL",
    query: string,
    allowEmpty = false,
  ) => {
    const normalized = normalizeQuery(query)
    const filtered =
      market === "ALL" ? items : items.filter((item) => item.market === market)
    if (!normalized) {
      return allowEmpty ? filtered : []
    }
    return filtered.filter((item) => {
      return (
        item.symbol.toLowerCase().includes(normalized) ||
        item.name.toLowerCase().includes(normalized)
      )
    })
  }

  const filterUsSymbols = (
    items: SymbolItem[],
    query: string,
    allowEmpty = false,
  ) => {
    const normalized = normalizeQuery(query)
    if (!normalized) {
      return allowEmpty ? items : []
    }
    return items.filter(
      (item) =>
        item.symbol.toLowerCase().includes(normalized) ||
        item.name.toLowerCase().includes(normalized),
    )
  }

  const normalizeRegion = (value: string | null) =>
    (value ?? "").trim().toUpperCase() === "US" ? "US" : "KR"

  const normalizeUsGroup = (value: string | null): UsSymbolGroup => {
    const normalized = (value ?? "").trim().toUpperCase()
    if (normalized === "NASDAQ") {
      return "NASDAQ"
    }
    if (normalized === "DOWJONES") {
      return "DOWJONES"
    }
    if (normalized === "ALL" || normalized === "US_ALL") {
      return "ALL"
    }
    return "ALL"
  }

  const resolveRankingScope = (
    marketParam: string | null,
    regionParam: string | null,
    groupParam: string | null,
  ): { region: MarketRegion; group: string } => {
    const marketUpper = (marketParam ?? "").trim().toUpperCase()
    const regionUpper = (regionParam ?? "").trim().toUpperCase()
    void groupParam

    const region = normalizeRegion(regionUpper || marketUpper)
    if (region === "US") {
      return {
        region,
        group: "ALL",
      }
    }
    return { region: "KR", group: "ALL" }
  }

  const filterRankingItems = (items: RankingItem[], query: string) => {
    const normalized = normalizeQuery(query)
    if (!normalized) {
      return items
    }
    return items.filter(
      (item) =>
        item.code.toLowerCase().includes(normalized) ||
        item.name.toLowerCase().includes(normalized),
    )
  }

  const resolveRankingMode = (
    modeParam: string | null,
    sortKeyParam: string | null,
    sortDirParam: string | null,
  ) => {
    const normalizedMode = normalizeQuery(modeParam ?? "")
    if (
      normalizedMode === "turnover" ||
      normalizedMode === "trading_value" ||
      normalizedMode === "value"
    ) {
      return { mode: "turnover", sortKey: "turnover", sortDir: "desc" }
    }
    if (normalizedMode === "gainers" || normalizedMode === "up") {
      return { mode: "gainers", sortKey: "changePercent", sortDir: "desc" }
    }
    if (normalizedMode === "losers" || normalizedMode === "down") {
      return { mode: "losers", sortKey: "changePercent", sortDir: "asc" }
    }
    if (
      normalizedMode === "market_cap" ||
      normalizedMode === "marketcap" ||
      normalizedMode === "mcap"
    ) {
      return { mode: "market_cap", sortKey: "marketCap", sortDir: "desc" }
    }
    if (normalizedMode === "volume") {
      return { mode: "volume", sortKey: "volume", sortDir: "desc" }
    }
    const sortKey = normalizeRankingSortKey(sortKeyParam)
    const sortDir = normalizeRankingSortDir(sortDirParam)
    return {
      mode: normalizedMode || sortKey,
      sortKey,
      sortDir,
    }
  }

  const buildHeaders = async (trId: string) => {
    const token = await getToken()
    return {
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: trId,
    }
  }

  const normalizeQuoteOutput = (
    symbol: string,
    output: Record<string, unknown>,
    warnMissing: boolean,
  ) => {
    const metrics = normalizeQuoteMetrics(output)
    if (warnMissing && metrics.missingKeys.length > 0) {
      console.warn(
        `[kis] missing quote metrics for ${symbol}: ${metrics.missingKeys.join(
          ", ",
        )}`,
      )
    }
    return {
      quote: {
        code: symbol,
        name: fixtures.baseSymbols.find((item) => item.code === symbol)?.name,
        price: parseNumber(output.stck_prpr as string | number | undefined),
        change: parseNumber(output.prdy_vrss as string | number | undefined),
        changeRate: parseNumber(
          output.prdy_ctrt as string | number | undefined,
        ),
        volume: metrics.volume,
        updatedAt: new Date().toISOString(),
      },
      metrics,
    }
  }

  const readContractOutput = (symbol: string) =>
    contractQuotes?.[symbol]?.output ?? null

  const fetchQuote = async (symbol: string) => {
    const url = new URL(
      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-price`,
    )
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J")
    url.searchParams.set("FID_INPUT_ISCD", symbol)

    const { response, payload } = await fetchJson(url.toString(), {
      method: "GET",
      headers: await buildHeaders(trIds.quote),
    })

    if (!response.ok || payload?.rt_cd !== "0") {
      const message = payload?.msg1 || payload?.message || "KIS quote error"
      throw new Error(message)
    }

    const output = payload.output ?? {}
    return normalizeQuoteOutput(symbol, output, dataMode === "kis")
  }

  const fetchOverseasPriceOutput = async (
    symbol: string,
    exchangeCode: string,
  ) => {
    const url = new URL(`${baseUrl}/uapi/overseas-price/v1/quotations/price`)
    url.searchParams.set("AUTH", "")
    url.searchParams.set("EXCD", exchangeCode)
    url.searchParams.set("SYMB", symbol)

    const { response, payload } = await fetchJson(url.toString(), {
      method: "GET",
      headers: await buildHeaders(trIds.usPrice),
    })

    if (!response.ok || payload?.rt_cd !== "0") {
      const message = payload?.msg1 || payload?.message || "KIS US quote error"
      throw new Error(message)
    }
    return payload.output ?? {}
  }

  const fetchOverseasPriceDetailOutput = async (
    symbol: string,
    exchangeCode: string,
  ) => {
    const url = new URL(
      `${baseUrl}/uapi/overseas-price/v1/quotations/price-detail`,
    )
    url.searchParams.set("AUTH", "")
    url.searchParams.set("EXCD", exchangeCode)
    url.searchParams.set("SYMB", symbol)

    const { response, payload } = await fetchJson(url.toString(), {
      method: "GET",
      headers: await buildHeaders(trIds.usPriceDetail),
    })

    if (!response.ok || payload?.rt_cd !== "0") {
      const message =
        payload?.msg1 || payload?.message || "KIS US quote detail error"
      throw new Error(message)
    }
    return payload.output ?? {}
  }

  const buildUsQuoteItem = (
    symbol: string,
    priceOutput: Record<string, unknown>,
    detailOutput?: Record<string, unknown> | null,
  ): BatchQuoteItem => {
    const priceMetrics = normalizeOverseasQuoteMetrics(priceOutput)
    const detailMetrics = detailOutput
      ? normalizeOverseasQuoteMetrics(detailOutput)
      : null
    const marketCap = detailMetrics?.marketCap ?? priceMetrics.marketCap
    const price = priceMetrics.price ?? detailMetrics?.price ?? null
    const change = priceMetrics.change ?? null
    const changeRate = priceMetrics.changeRate ?? null
    const volume = priceMetrics.volume ?? detailMetrics?.volume
    const turnover = priceMetrics.turnover ?? detailMetrics?.turnover
    const missingKeys = [
      ...priceMetrics.missingKeys,
      ...(detailMetrics?.missingKeys ?? []),
    ]
    if (dataMode === "kis" && missingKeys.length > 0) {
      console.warn(
        `[kis] missing US quote metrics for ${symbol}: ${missingKeys.join(", ")}`,
      )
    }
    return {
      code: symbol,
      price,
      change,
      changeRate,
      volume,
      turnover,
      marketCap,
      updatedAt: new Date().toISOString(),
    }
  }

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms))

  const shouldRetryStatus = (status: number) => status === 429 || status >= 500

  const fetchJsonWithRetry = async (
    url: string,
    options: FetchOptions,
    timeoutMs = 9000,
  ) => {
    let attempt = 0
    let lastError: unknown = null
    while (attempt < 2) {
      try {
        const result = await fetchJson(url, options, timeoutMs)
        if (attempt === 0 && shouldRetryStatus(result.response.status)) {
          await sleep(120 + Math.random() * 200)
          attempt += 1
          continue
        }
        return result
      } catch (error) {
        lastError = error
        if (attempt === 0) {
          await sleep(120 + Math.random() * 200)
          attempt += 1
          continue
        }
        throw error
      }
    }
    throw lastError ?? new Error("Upstream fetch failed")
  }

  const normalizeNullable = (value?: number | null) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return null
    }
    return value
  }

  const normalizePrice = (value?: number | null) => {
    if (
      value === null ||
      value === undefined ||
      Number.isNaN(value) ||
      value <= 0
    ) {
      return null
    }
    return value
  }

  const fetchUsQuote = async (symbol: string): Promise<BatchQuoteItem> => {
    const exchangeCode = resolveUsExchangeCode(symbol)
    const normalized = normalizeUsTickerForProvider("kis", symbol)
    const priceOutput = await fetchOverseasPriceOutput(normalized, exchangeCode)
    const now = Date.now()
    let detailOutput: Record<string, unknown> | null = null
    let marketCap = readUsMarketCapCache(symbol, now)
    if (marketCap === undefined) {
      detailOutput = await fetchOverseasPriceDetailOutput(
        normalized,
        exchangeCode,
      )
      const detailMetrics = normalizeOverseasQuoteMetrics(detailOutput)
      marketCap = detailMetrics.marketCap
      writeUsMarketCapCache(symbol, marketCap)
    }
    const quoteItem = buildUsQuoteItem(symbol, priceOutput, detailOutput)
    if (marketCap !== null && quoteItem.marketCap === null) {
      quoteItem.marketCap = marketCap
    }
    return quoteItem
  }

  const getQuoteCacheKey = (region: MarketRegion, symbol: string) =>
    `${region}:${symbol}`

  const readQuoteCacheEntry = (
    region: MarketRegion,
    symbol: string,
    now: number,
  ) => {
    const cached = quoteCache.get(getQuoteCacheKey(region, symbol))
    if (!cached || cached.staleAt <= now) {
      return null
    }
    const marketCap =
      region === "US" ? readUsMarketCapCache(symbol, now) : undefined
    return {
      item:
        region === "US" && marketCap !== null && marketCap !== undefined
          ? { ...cached.item, marketCap }
          : cached.item,
      isFresh: cached.expiresAt > now,
    }
  }

  const writeQuoteCacheEntry = (
    region: MarketRegion,
    symbol: string,
    item: BatchQuoteItem,
  ) => {
    const now = Date.now()
    quoteCache.set(getQuoteCacheKey(region, symbol), {
      item,
      expiresAt: now + quoteTtl,
      staleAt: now + quoteStaleTtl,
    })
  }

  const buildBatchQuoteItem = (
    symbol: string,
    entry: ReturnType<typeof normalizeQuoteOutput>,
  ): BatchQuoteItem => ({
    code: symbol,
    price: normalizePrice(entry.quote.price),
    change: normalizeNullable(entry.quote.change),
    changeRate: normalizeNullable(entry.quote.changeRate),
    volume: entry.metrics.volume,
    turnover: entry.metrics.turnover,
    marketCap: entry.metrics.marketCap,
    updatedAt: entry.quote.updatedAt,
  })

  const buildQuoteFromBatchItem = (symbol: string, item: BatchQuoteItem) => {
    const meta = symbolLookup.get(symbol)
    return {
      code: symbol,
      name: meta?.name ?? symbol,
      price: item.price ?? 0,
      change: item.change ?? 0,
      changeRate: item.changeRate ?? 0,
      volume: item.volume ?? null,
      updatedAt: item.updatedAt,
    }
  }

  const buildRankingItemFromQuote = (
    symbol: string,
    quote: BatchQuoteItem,
  ): RankingItem => {
    const meta = symbolLookup.get(symbol)
    return {
      rank: 0,
      code: symbol,
      name: meta?.name ?? symbol,
      market: meta?.market,
      price: normalizePrice(quote.price),
      change: normalizeNullable(quote.change),
      changeRate: normalizeNullable(quote.changeRate),
      volume: quote.volume,
      value: quote.turnover,
      mcap: quote.marketCap,
    }
  }

  const updateSymbolLookup = (items: SymbolItem[]) => {
    items.forEach((item) => {
      symbolLookup.set(item.symbol, item)
    })
  }

  const METRICS_CONCURRENCY = 4
  const METRICS_BATCH_DELAY_MS = 120
  const QUOTE_BATCH_LIMIT = 100

  const runWithConcurrency = async <T>(
    items: T[],
    limit: number,
    task: (item: T) => Promise<void>,
  ) => {
    let index = 0
    const runners = Array.from({
      length: Math.min(limit, items.length),
    }).map(async () => {
      while (index < items.length) {
        const current = items[index]
        index += 1
        await task(current)
      }
    })
    await Promise.all(runners)
  }

  const resolveFixtureBatchQuote = (
    region: MarketRegion,
    symbol: string,
  ): BatchQuoteItem | null => {
    if (region === "US") {
      const fixture = usQuoteFixtureMap.get(symbol)
      if (!fixture) {
        return null
      }
      const price = normalizePrice(fixture.price)
      const volume = normalizeNullable(fixture.volume)
      const turnover = price && volume ? price * volume : null
      return {
        code: symbol,
        price,
        change: normalizeNullable(fixture.change),
        changeRate: normalizeNullable(fixture.changeRate),
        volume,
        turnover,
        marketCap: normalizeNullable(fixture.marketCap),
        updatedAt: new Date().toISOString(),
      }
    }
    if (isContractMode) {
      const output = readContractOutput(symbol)
      if (output) {
        const entry = normalizeQuoteOutput(symbol, output, false)
        return buildBatchQuoteItem(symbol, entry)
      }
    }
    const rankingItem = fixtureRankingLookup.get(symbol)
    if (rankingItem) {
      return {
        code: symbol,
        price: normalizePrice(rankingItem.price),
        change: normalizeNullable(rankingItem.change),
        changeRate: normalizeNullable(rankingItem.changeRate),
        volume: rankingItem.volume,
        turnover: rankingItem.value,
        marketCap: rankingItem.mcap ?? null,
        updatedAt: new Date().toISOString(),
      }
    }
    const quote = fixtures.quotes[symbol]
    if (!quote) {
      return null
    }
    const turnover =
      quote.price && quote.volume ? quote.price * quote.volume : null
    return {
      code: symbol,
      price: normalizePrice(quote.price),
      change: normalizeNullable(quote.change),
      changeRate: normalizeNullable(quote.changeRate),
      volume: normalizeNullable(quote.volume),
      turnover,
      marketCap: null,
      updatedAt: quote.updatedAt,
    }
  }

  const fetchQuoteItems = async (
    region: MarketRegion,
    symbols: string[],
  ): Promise<Record<string, BatchQuoteItem>> => {
    const results: Record<string, BatchQuoteItem> = {}
    const limited = symbols.slice(0, QUOTE_BATCH_LIMIT)
    await runWithConcurrency(limited, METRICS_CONCURRENCY, async (symbol) => {
      try {
        const quoteItem =
          region === "US"
            ? await fetchUsQuote(symbol)
            : buildBatchQuoteItem(symbol, await fetchQuote(symbol))
        results[symbol] = quoteItem
        writeQuoteCacheEntry(region, symbol, quoteItem)
        metricsCache.set(symbol, {
          item: buildRankingItemFromQuote(symbol, quoteItem),
          updatedAt: Date.now(),
        })
      } catch {
        return
      }
    })
    return results
  }

  const refreshGlobalMetrics = async (
    region: MarketRegion,
    symbols: SymbolItem[],
  ) => {
    if (dataMode !== "kis" || region !== "KR") {
      return
    }
    const now = Date.now()
    const staleCodes = symbols
      .map((item) => item.symbol)
      .filter((code) => {
        const cached = metricsCache.get(code)
        if (cached && now - cached.updatedAt <= metricsTtl) {
          return false
        }
        const quoteCached = readQuoteCacheEntry(region, code, now)
        if (quoteCached && quoteCached.isFresh) {
          return false
        }
        return true
      })

    if (staleCodes.length === 0) {
      return
    }
    for (let i = 0; i < staleCodes.length; i += QUOTE_BATCH_LIMIT) {
      const batch = staleCodes.slice(i, i + QUOTE_BATCH_LIMIT)
      await fetchQuoteItems(region, batch)
      if (i + QUOTE_BATCH_LIMIT < staleCodes.length) {
        await sleep(METRICS_BATCH_DELAY_MS)
      }
    }
  }

  const startGlobalMetricsRefresh = (
    region: MarketRegion,
    symbols: SymbolItem[],
  ) => {
    if (dataMode !== "kis" || region !== "KR") {
      return
    }
    const now = Date.now()
    const current = globalMetricsRefresh.get(region) ?? {
      inflight: null,
      lastRunAt: 0,
    }
    if (current.inflight) {
      return
    }
    if (now - current.lastRunAt < metricsRefreshTtl) {
      return
    }
    const inflight = refreshGlobalMetrics(region, symbols)
      .catch(() => undefined)
      .finally(() => {
        globalMetricsRefresh.set(region, {
          inflight: null,
          lastRunAt: Date.now(),
        })
      })
    globalMetricsRefresh.set(region, { inflight, lastRunAt: current.lastRunAt })
  }

  const resolveBatchQuotes = async (
    region: MarketRegion,
    symbols: string[],
  ): Promise<Record<string, BatchQuoteItem>> => {
    const now = Date.now()
    const limited = symbols.slice(0, QUOTE_BATCH_LIMIT)
    const results: Record<string, BatchQuoteItem> = {}
    const missing: string[] = []
    const refresh: string[] = []
    limited.forEach((symbol) => {
      const cached = readQuoteCacheEntry(region, symbol, now)
      if (cached) {
        results[symbol] = cached.item
        if (!cached.isFresh) {
          refresh.push(symbol)
        }
      } else {
        missing.push(symbol)
      }
    })
    if (missing.length > 0) {
      const fetched = await fetchQuoteItems(region, missing)
      Object.assign(results, fetched)
    }
    if (refresh.length > 0) {
      void fetchQuoteItems(region, refresh)
    }
    return results
  }

  const buildFixtureRankingItems = (
    symbols: SymbolItem[],
    applyContractOverrides = true,
  ) => {
    const baseItems = buildRankingItems(symbols)
    if (
      !applyContractOverrides ||
      !isContractMode ||
      contractSymbols.length === 0
    ) {
      return baseItems
    }
    const map = new Map(baseItems.map((item) => [item.code, item]))
    contractSymbols.forEach((code) => {
      const output = readContractOutput(code)
      if (!output) {
        return
      }
      const entry = normalizeQuoteOutput(code, output, false)
      const existing = map.get(code)
      map.set(code, {
        ...(existing ?? {
          rank: 0,
          code,
          name: entry.quote.name ?? code,
          market: existing?.market,
        }),
        price: normalizePrice(entry.quote.price),
        change: normalizeNullable(entry.quote.change),
        changeRate: normalizeNullable(entry.quote.changeRate),
        volume: entry.metrics.volume,
        value: entry.metrics.turnover,
        mcap: entry.metrics.marketCap,
      })
    })
    return Array.from(map.values())
  }

  const applyContractMarketCapNulls = (
    items: RankingItem[],
    region: MarketRegion,
  ) => {
    if (!isContractMode || region !== "KR" || contractSymbolSet.size === 0) {
      return items
    }
    return items.map((item) =>
      contractSymbolSet.has(item.code) ? item : { ...item, mcap: null },
    )
  }

  const applyUsQuoteFixtureOverrides = (items: RankingItem[]) => {
    if (usQuoteFixtureMap.size === 0) {
      return items
    }
    return items.map((item) => {
      const fixture = usQuoteFixtureMap.get(item.code)
      if (!fixture) {
        if (isContractMode) {
          return item.mcap === null ? item : { ...item, mcap: null }
        }
        return item
      }
      const price = normalizePrice(fixture.price)
      const volume = normalizeNullable(fixture.volume)
      const turnover = price && volume ? price * volume : null
      return {
        ...item,
        price,
        change: normalizeNullable(fixture.change),
        changeRate: normalizeNullable(fixture.changeRate),
        volume,
        value: turnover,
        mcap: normalizeNullable(fixture.marketCap),
      }
    })
  }

  const buildKisRankingItems = (
    symbols: SymbolItem[],
    region: MarketRegion,
  ) => {
    const now = Date.now()
    const items = symbols.map((symbol) => {
      const cached = metricsCache.get(symbol.symbol)
      const quoteEntry = readQuoteCacheEntry(region, symbol.symbol, now)?.item
      return {
        rank: 0,
        code: symbol.symbol,
        name: symbol.name,
        market: symbol.market,
        price: cached?.item.price ?? normalizePrice(quoteEntry?.price),
        change: cached?.item.change ?? normalizeNullable(quoteEntry?.change),
        changeRate:
          cached?.item.changeRate ?? normalizeNullable(quoteEntry?.changeRate),
        volume: cached?.item.volume ?? normalizeNullable(quoteEntry?.volume),
        value: cached?.item.value ?? normalizeNullable(quoteEntry?.turnover),
        mcap: cached?.item.mcap ?? normalizeNullable(quoteEntry?.marketCap),
      }
    })
    return items
  }

  const buildRankingSourceItems = (
    symbols: SymbolItem[],
    region: MarketRegion,
  ) => {
    updateSymbolLookup(symbols)
    if (dataMode === "kis") {
      return buildKisRankingItems(symbols, region)
    }
    const applyContractOverrides = region === "KR"
    const baseItems = buildFixtureRankingItems(symbols, applyContractOverrides)
    const withContractCaps = applyContractMarketCapNulls(baseItems, region)
    if (region === "US") {
      return applyUsQuoteFixtureOverrides(withContractCaps)
    }
    return withContractCaps
  }

  const resolveIntradayTimeZone = (region: MarketRegion) =>
    region === "US" ? "America/New_York" : "Asia/Seoul"

  const toEpochMs = (value: string | number, timeZone: string) => {
    if (typeof value === "number") {
      return value > 10_000_000_000 ? value : value * 1000
    }
    return toEpochMsInZone(value, timeZone)
  }

  const toIntradayCandles = (points: CandlePoint[]) =>
    points.map((point) => ({ ...point, time: String(point.time) }))

  const finalizeIntradaySeries = (
    points: CandlePoint[],
    region: MarketRegion,
  ) => {
    const timeZone = resolveIntradayTimeZone(region)
    const map = new Map<number, CandlePoint>()
    points.forEach((point) => {
      const epoch = toEpochMs(point.time, timeZone)
      if (!epoch || !Number.isFinite(epoch)) {
        return
      }
      if (!map.has(epoch)) {
        map.set(epoch, { ...point, time: epoch })
      }
    })
    return Array.from(map.values()).sort(
      (a, b) => (a.time as number) - (b.time as number),
    )
  }

  const warnIfIntradaySuspicious = (
    region: MarketRegion,
    intervalMinutes: number,
    days: number,
    points: CandlePoint[],
  ) => {
    if (!isDevServer || dataMode !== "kis" || points.length === 0) {
      return
    }
    const expectedBarsPerDay = Math.max(1, Math.ceil(390 / intervalMinutes))
    const expectedDays = region === "KR" ? 1 : Math.min(days, 5)
    const minBars = Math.floor(expectedBarsPerDay * expectedDays * 0.5)
    if (points.length < minBars) {
      console.warn(
        `[intraday] low bar count region=${region} interval=${intervalMinutes}m bars=${points.length} expected>=${minBars}`,
      )
    }

    const timeZone = resolveIntradayTimeZone(region)
    const readHourMinute = (epochMs: number) => {
      const label = formatTimeInZone(new Date(epochMs), timeZone)
      const hour = Number(label.slice(0, 2))
      const minute = Number(label.slice(2, 4))
      return { hour, minute }
    }
    const first = points[0]?.time
    const last = points[points.length - 1]?.time
    if (typeof first === "number" && typeof last === "number") {
      const firstTime = readHourMinute(first)
      const lastTime = readHourMinute(last)
      const isKr = region === "KR"
      const open = isKr ? { hour: 9, minute: 0 } : { hour: 9, minute: 30 }
      const close = isKr ? { hour: 15, minute: 30 } : { hour: 16, minute: 0 }
      const toMinutes = (time: { hour: number; minute: number }) =>
        time.hour * 60 + time.minute
      const openMinutes = toMinutes(open)
      const closeMinutes = toMinutes(close)
      const within = (time: { hour: number; minute: number }) => {
        const minutes = toMinutes(time)
        return minutes >= openMinutes && minutes <= closeMinutes
      }
      if (!within(firstTime) || !within(lastTime)) {
        console.warn(
          `[intraday] session mismatch region=${region} first=${firstTime.hour}:${firstTime.minute} last=${lastTime.hour}:${lastTime.minute}`,
        )
      }
    }
  }

  const resolveFixtureIntradaySeries = (
    symbol: string,
    region: MarketRegion,
    intervalMinutes: number,
    days: number,
  ) => {
    const entries = Object.values(intradayFixtures?.symbols ?? {})
    const entry =
      intradayFixtures?.symbols?.[symbol] ??
      entries.find((item) => item.region === region) ??
      (entries.length > 0 ? entries[0] : null)
    if (!entry) {
      return { points: [] as CandlePoint[] }
    }
    const normalized = normalizeCandleSeries(toIntradayCandles(entry.points))
    const limited = limitCandlesByDays(normalized, days)
    const aggregated =
      intervalMinutes > 1
        ? aggregateIntradayCandles(limited, intervalMinutes)
        : limited
    const points = finalizeIntradaySeries(aggregated, region)
    warnIfIntradaySuspicious(region, intervalMinutes, days, points)
    return { points }
  }

  const ensurePriorityMarketCaps = async (
    symbols: SymbolItem[],
    region: MarketRegion,
    sortKey: RankingSortKey,
  ) => {
    if (dataMode !== "kis" || region !== "KR" || sortKey !== "marketCap") {
      return
    }
    if (marketCapSeeds.length === 0) {
      return
    }
    updateSymbolLookup(symbols)
    const symbolSet = new Set(symbols.map((item) => item.symbol))
    const now = Date.now()
    const pending = marketCapSeeds.filter((code) => symbolSet.has(code))
    const stale = pending.filter((code) => {
      const cached = metricsCache.get(code)
      if (cached && now - cached.updatedAt <= metricsTtl) {
        return false
      }
      const quoteCached = readQuoteCacheEntry(region, code, now)
      if (quoteCached) {
        return false
      }
      return true
    })
    if (stale.length === 0) {
      return
    }
    await fetchQuoteItems(region, stale.slice(0, QUOTE_BATCH_LIMIT))
  }

  const fetchDailySeries = async (symbol: string, period: string) => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(end.getDate() - 120)
    const url = new URL(
      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`,
    )
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J")
    url.searchParams.set("FID_INPUT_ISCD", symbol)
    url.searchParams.set("FID_INPUT_DATE_1", formatDate(start))
    url.searchParams.set("FID_INPUT_DATE_2", formatDate(end))
    url.searchParams.set("FID_PERIOD_DIV_CODE", period)
    url.searchParams.set("FID_ORG_ADJ_PRC", "0")

    const { response, payload } = await fetchJson(url.toString(), {
      method: "GET",
      headers: await buildHeaders(trIds.daily),
    })

    if (!response.ok || payload?.rt_cd !== "0") {
      const message = payload?.msg1 || payload?.message || "KIS chart error"
      throw new Error(message)
    }

    const output2 = coerceArray(payload.output2 ?? payload.Output2)
    return {
      points: output2.map((item) => ({
        time: readString(item, "stck_bsop_date"),
        open: parseNumber(readField(item, "stck_oprc")),
        high: parseNumber(readField(item, "stck_hgpr")),
        low: parseNumber(readField(item, "stck_lwpr")),
        close: parseNumber(readField(item, "stck_clpr")),
        volume: parseNumber(readField(item, "acml_vol")),
      })),
    }
  }

  const fetchIntradaySeries = async (symbol: string, inputTime: string) => {
    const url = new URL(
      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice`,
    )
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J")
    url.searchParams.set("FID_INPUT_ISCD", symbol)
    url.searchParams.set("FID_INPUT_HOUR_1", inputTime)
    url.searchParams.set("FID_PW_DATA_INCU_YN", "Y")
    url.searchParams.set("FID_ETC_CLS_CODE", "0")

    const { response, payload } = await fetchJsonWithRetry(url.toString(), {
      method: "GET",
      headers: await buildHeaders(trIds.intraday),
    })

    if (!response.ok || payload?.rt_cd !== "0") {
      throw buildUpstreamError(response, payload, "KIS chart error")
    }

    const output2 = coerceArray(payload.output2 ?? payload.Output2)
    return {
      points: output2.map((item) => ({
        time: `${readString(item, "stck_bsop_date")}${readString(item, "stck_cntg_hour")}`,
        open: parseNumber(readField(item, "stck_oprc")),
        high: parseNumber(readField(item, "stck_hgpr")),
        low: parseNumber(readField(item, "stck_lwpr")),
        close: parseNumber(readField(item, "stck_prpr")),
        volume: parseNumber(readField(item, "cntg_vol")),
      })),
    }
  }

  const fetchKrIntradayCandles = async (symbol: string) => {
    const targetBars = 390
    const maxLoops = 20
    const collected: CandlePoint[] = []
    let requestTime = formatTimeInZone(new Date(), "Asia/Seoul")
    let lastEarliest = ""

    for (let i = 0; i < maxLoops && collected.length < targetBars; i += 1) {
      const series = await fetchIntradaySeries(symbol, requestTime)
      const points = series.points.map((point) => ({
        ...point,
        time: buildIntradayTimeKey(point.time.slice(0, 8), point.time.slice(8)),
      }))
      if (points.length === 0) {
        break
      }
      collected.push(...points)

      const earliest = points[points.length - 1]?.time ?? ""
      if (!earliest || earliest === lastEarliest) {
        break
      }
      lastEarliest = earliest

      const earliestEpoch = toEpochMsInZone(earliest, "Asia/Seoul")
      if (!earliestEpoch) {
        break
      }
      const nextEpoch = earliestEpoch - 60_000
      requestTime = formatTimeInZone(new Date(nextEpoch), "Asia/Seoul")

      const hour = Number(earliest.slice(8, 10))
      const minute = Number(earliest.slice(10, 12))
      const minutesSinceOpen = hour * 60 + minute
      if (minutesSinceOpen <= 9 * 60) {
        break
      }
      await sleep(120)
    }

    return normalizeCandleSeries(toIntradayCandles(collected))
  }

  const fetchUsIntradayCandles = async (
    symbol: string,
    exchangeCode: string,
    requestMinutes: number,
    aggregateMinutes: number,
    days: number,
  ) => {
    const normalized = normalizeUsTickerForProvider("kis", symbol)
    const recordsPerCall = 120
    const targetDays = Math.min(Math.max(days, 1), 5)
    const barsPerDay = Math.max(1, Math.ceil(390 / requestMinutes))
    const maxIterations =
      Math.ceil((barsPerDay * targetDays) / recordsPerCall) + 2
    const collected: CandlePoint[] = []
    const uniqueDays = new Set<string>()
    let keyb = ""

    for (let i = 0; i < maxIterations; i += 1) {
      const url = new URL(
        `${baseUrl}/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice`,
      )
      url.searchParams.set("AUTH", "")
      url.searchParams.set("EXCD", exchangeCode)
      url.searchParams.set("SYMB", normalized)
      url.searchParams.set("NMIN", String(requestMinutes))
      url.searchParams.set("PINC", "1")
      url.searchParams.set("NEXT", keyb ? "1" : "")
      url.searchParams.set("NREC", String(recordsPerCall))
      url.searchParams.set("FILL", "")
      url.searchParams.set("KEYB", keyb)

      const { response, payload } = await fetchJsonWithRetry(url.toString(), {
        method: "GET",
        headers: await buildHeaders(trIds.usIntraday),
      })

      if (!response.ok || payload?.rt_cd !== "0") {
        throw buildUpstreamError(response, payload, "KIS US intraday error")
      }

      const output1 = payload.output1 ?? payload.Output1 ?? {}
      const output2 = coerceArray(payload.output2 ?? payload.Output2)
      if (output2.length === 0) {
        break
      }
      output2.forEach((item) => {
        const date = readFirstString(item, ["xymd", "tymd", "kymd"])
        const time = readFirstString(item, ["xhms", "khms"])
        if (date) {
          uniqueDays.add(date)
        }
        const candleTime = buildIntradayTimeKey(date, time)
        collected.push({
          time: candleTime,
          open: parseNumber(readField(item, "open")),
          high: parseNumber(readField(item, "high")),
          low: parseNumber(readField(item, "low")),
          close: parseNumber(readField(item, "last")),
          volume: parseNumber(readField(item, "evol")),
        })
      })

      if (uniqueDays.size >= targetDays) {
        break
      }

      const last = output2[output2.length - 1]
      const lastDate = readFirstString(last ?? {}, ["xymd", "tymd", "kymd"])
      const lastTime = readFirstString(last ?? {}, ["xhms", "khms"])
      keyb = lastDate && lastTime ? `${lastDate}${lastTime}` : ""
      const nextFlag = readFirstString(output1, ["next", "more"])
      if (!keyb || !["Y", "1"].includes(nextFlag)) {
        break
      }
    }

    const normalizedCandles = normalizeCandleSeries(
      toIntradayCandles(collected),
    )
    const limited = limitCandlesByDays(normalizedCandles, targetDays)
    if (aggregateMinutes > requestMinutes) {
      return aggregateIntradayCandles(limited, aggregateMinutes)
    }
    return limited
  }

  const resolveIntradaySeries = async (
    region: MarketRegion,
    symbol: string,
    requestMinutes: number,
    aggregateMinutes: number,
    days: number,
  ) => {
    if (region === "US") {
      const exchangeCode = resolveUsExchangeCode(symbol)
      const candles = await fetchUsIntradayCandles(
        symbol,
        exchangeCode,
        requestMinutes,
        aggregateMinutes,
        days,
      )
      const points = finalizeIntradaySeries(candles, region)
      warnIfIntradaySuspicious(region, aggregateMinutes, days, points)
      return { points }
    }
    const candles = await fetchKrIntradayCandles(symbol)
    if (days > 1 && isDevServer) {
      console.warn(
        `[kis] KR intraday limited to same-day data; requested days=${days}`,
      )
    }
    const limited = limitCandlesByDays(candles, Math.min(days, 1))
    const aggregated =
      aggregateMinutes > 1
        ? aggregateIntradayCandles(limited, aggregateMinutes)
        : limited
    const points = finalizeIntradaySeries(aggregated, region)
    warnIfIntradaySuspicious(region, aggregateMinutes, days, points)
    return { points }
  }

  const fetchIndexSnapshot = async (code: string) => {
    const url = new URL(
      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-time-indexchartprice`,
    )
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "U")
    url.searchParams.set("FID_ETC_CLS_CODE", "0")
    url.searchParams.set("FID_INPUT_ISCD", code)
    url.searchParams.set("FID_INPUT_HOUR_1", "60")
    url.searchParams.set("FID_PW_DATA_INCU_YN", "Y")

    const { response, payload } = await fetchJson(url.toString(), {
      method: "GET",
      headers: await buildHeaders(trIds.index),
    })

    if (!response.ok || payload?.rt_cd !== "0") {
      const message = payload?.msg1 || payload?.message || "KIS index error"
      throw new Error(message)
    }

    const output2 = coerceArray(payload.output2 ?? payload.Output2)
    const output1 = payload.output1 ?? payload.Output1
    const summary = Array.isArray(output1) ? output1[0] : output1
    const snapshot = summary
      ? {
          price: parseNumber(readField(summary, "bstp_nmix_prpr")),
          change: parseNumber(readField(summary, "bstp_nmix_prdy_vrss")),
          changeRate: parseNumber(readField(summary, "bstp_nmix_prdy_ctrt")),
        }
      : undefined
    const last = output2[output2.length - 1]
    return {
      snapshot,
      lastClose: parseNumber(readField(last ?? {}, "bstp_nmix_prpr")),
    }
  }

  const fetchIndexDailySeries = async (code: string) => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(end.getDate() - 20)
    const url = new URL(
      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice`,
    )
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "U")
    url.searchParams.set("FID_INPUT_ISCD", code)
    url.searchParams.set("FID_INPUT_DATE_1", formatDate(start))
    url.searchParams.set("FID_INPUT_DATE_2", formatDate(end))
    url.searchParams.set("FID_PERIOD_DIV_CODE", "D")

    const { response, payload } = await fetchJson(url.toString(), {
      method: "GET",
      headers: await buildHeaders(trIds.indexDaily),
    })

    if (!response.ok || payload?.rt_cd !== "0") {
      const message = payload?.msg1 || payload?.message || "KIS index error"
      throw new Error(message)
    }

    const output2 = coerceArray(payload.output2 ?? payload.Output2)
    const points = output2.map((item) => {
      const dateRaw = readFirstString(item, [
        "stck_bsop_date",
        "bstp_nmix_bsop_date",
        "bsop_date",
      ])
      return {
        date: formatIsoDate(dateRaw),
        close: readFirstNumber(item, [
          "bstp_nmix_prpr",
          "bstp_nmix_clpr",
          "stck_clpr",
        ]),
        change: readFirstNumber(item, ["bstp_nmix_prdy_vrss", "prdy_vrss"]),
        changeRate: readFirstNumber(item, ["bstp_nmix_prdy_ctrt", "prdy_ctrt"]),
      }
    })
    return { points }
  }

  const fetchYahooIndex = async (
    symbol: string,
    code: "NASDAQ" | "DOWJONES",
    name: string,
  ): Promise<MarketIndex> => {
    const url = new URL(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
    )
    const { response, payload } = await fetchJson(
      url.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0",
        },
      },
      8000,
    )
    if (!response.ok || !payload?.chart?.result?.length) {
      throw new Error("US index fetch failed")
    }
    const meta = payload.chart.result[0]?.meta ?? {}
    const priceRaw = Number(meta.regularMarketPrice ?? 0)
    const previousRaw = Number(
      meta.previousClose ?? meta.chartPreviousClose ?? 0,
    )
    if (!Number.isFinite(priceRaw) || priceRaw <= 0) {
      throw new Error("US index price missing")
    }
    const changeRaw = Number.isFinite(previousRaw) ? priceRaw - previousRaw : 0
    const changeRateRaw =
      Number.isFinite(previousRaw) && previousRaw !== 0
        ? Number(((changeRaw / previousRaw) * 100).toFixed(2))
        : 0
    return {
      code,
      name,
      price: priceRaw,
      change: Number.isFinite(changeRaw) ? changeRaw : 0,
      changeRate: Number.isFinite(changeRateRaw) ? changeRateRaw : 0,
      updatedAt: new Date().toISOString(),
    }
  }

  const fetchNewsItems = async (symbol: string, limit: number) => {
    const url = `https://m.stock.naver.com/api/news/stock/${symbol}?pageSize=${limit}&page=1`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error("News fetch failed")
    }
    const payload = (await response.json()) as { items?: NaverNewsItem[] }[]
    const items = payload.flatMap((section) => section.items ?? [])
    return items.slice(0, limit).map((item) => ({
      id: item.id,
      title: item.title,
      source: item.officeName,
      date: `${item.datetime.slice(0, 4)}.${item.datetime.slice(4, 6)}.${item.datetime.slice(6, 8)} ${item.datetime.slice(8, 10)}:${item.datetime.slice(10, 12)}`,
      link: `https://m.stock.naver.com/news/${item.id}`,
    }))
  }

  const fetchDisclosuresItems = async (symbol: string, limit: number) => {
    const url = `https://finance.naver.com/item/news_notice.naver?code=${symbol}`
    const { response, text } = await fetchText(url)
    if (!response.ok) {
      throw new Error("Disclosure fetch failed")
    }
    const $ = cheerio.load(text)
    const rows = $("table.type6 tbody tr")
    const items: DisclosureItem[] = []
    rows.each((_, row) => {
      const title = $(row).find("td.title a").text().trim()
      const link = $(row).find("td.title a").attr("href")
      const source = $(row).find("td.info").text().trim()
      const date = $(row).find("td.date").text().trim()
      if (title && link) {
        items.push({
          id: link,
          title,
          source: source || "KOSCOM",
          date,
          link: `https://finance.naver.com${link}`,
        })
      }
    })
    return items.slice(0, limit)
  }

  const readJsonBody = async (req: import("http").IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk))
    }
    if (chunks.length === 0) {
      return null
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
        string,
        unknown
      >
    } catch {
      return null
    }
  }

  const sendJson = (
    res: import("http").ServerResponse,
    status: number,
    payload: Record<string, unknown>,
  ) => {
    res.statusCode = status
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(payload))
  }

  const sendError = (
    res: import("http").ServerResponse,
    status: number,
    code: string,
    message: string,
    requestId: string,
    detail?: string,
    meta?: {
      upstreamStatus?: number
      upstreamCode?: string
      upstreamMessage?: string
    },
  ) => {
    sendJson(res, status, {
      ok: false,
      code,
      message,
      detail,
      requestId,
      ...(meta ?? {}),
    })
  }

  const resolveRankingPayload = ({
    items,
    sortKey,
    sortDir,
    market,
    query,
    cursor,
    cacheKey,
    limit,
  }: {
    items: RankingItem[]
    sortKey: RankingSortKey
    sortDir: RankingSortDir
    market: string
    query: string
    cursor: string | null
    cacheKey: string
    limit: number
  }) => {
    const now = Date.now()
    const normalizedQuery = normalizeQuery(query)
    const cachedEntry = readRankingCacheEntry(cacheKey, now)
    let sorted: RankingItem[]
    let totalCount: number
    if (cachedEntry) {
      sorted = cachedEntry.payload.items
      totalCount = cachedEntry.payload.totalCount
      if (!cachedEntry.isFresh) {
        scheduleRankingRefresh(cacheKey, () => {
          const refreshed = sortRankingItems(items, sortKey, sortDir)
          return { items: refreshed, totalCount: refreshed.length }
        })
      }
    } else {
      sorted = sortRankingItems(items, sortKey, sortDir)
      totalCount = sorted.length
      writeRankingCacheEntry(cacheKey, { items: sorted, totalCount }, now)
    }
    let offset = 0
    const parsed = decodeRankingCursor(cursor)
    if (
      parsed &&
      parsed.cacheKey === cacheKey &&
      parsed.sortKey === sortKey &&
      parsed.sortDir === sortDir &&
      parsed.market === market &&
      parsed.query === normalizedQuery
    ) {
      offset = parsed.offset
    }

    const pageItems = sorted.slice(offset, offset + limit)
    const nextOffset = offset + pageItems.length
    const hasMore = nextOffset < totalCount
    const nextCursor = hasMore
      ? encodeRankingCursor({
          offset: nextOffset,
          sortKey,
          sortDir,
          market,
          query: normalizedQuery,
          cacheKey,
        })
      : null
    return { items: pageItems, nextCursor, hasMore, totalCount }
  }

  return {
    name: "maxdaewoon-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) {
          next()
          return
        }

        const url = new URL(req.url, "http://localhost")
        if (!url.pathname.startsWith("/api/")) {
          next()
          return
        }

        const isBatchQuotes = url.pathname === "/api/quotes/batch"
        if (req.method !== "GET" && !(isBatchQuotes && req.method === "POST")) {
          sendJson(res, 405, { ok: false, message: "Method Not Allowed" })
          return
        }

        const requestId = crypto.randomUUID()
        let intradayContext: {
          region: MarketRegion
          symbol: string
          interval: string
          days: number
        } | null = null

        try {
          if (isBatchQuotes && req.method === "POST") {
            const body = await readJsonBody(req)
            if (!body) {
              sendError(res, 400, "BAD_REQUEST", "Invalid JSON", requestId)
              return
            }
            const region = normalizeRegion(
              (body.region as string | null) ?? (body.market as string | null),
            )
            const rawSymbols = Array.isArray(body.symbols) ? body.symbols : []
            const symbols = Array.from(
              new Set(
                rawSymbols
                  .map((value) => String(value ?? "").trim())
                  .filter(Boolean),
              ),
            ).slice(0, QUOTE_BATCH_LIMIT)
            if (symbols.length === 0) {
              sendError(res, 400, "BAD_REQUEST", "Symbols required", requestId)
              return
            }

            if (dataMode !== "kis") {
              const quotesBySymbol = Object.fromEntries(
                symbols.flatMap((symbol) => {
                  const quote = resolveFixtureBatchQuote(region, symbol)
                  return quote ? [[symbol, quote]] : []
                }),
              )
              if (region === "US") {
                logUsQuoteCoverage(fixtureSource, symbols, quotesBySymbol)
              }
              sendJson(res, 200, {
                ok: true,
                source: fixtureSource,
                quotesBySymbol,
                ts: Date.now(),
              })
              return
            }

            if (region === "US") {
              if (!ensureKeys(res, requestId)) {
                return
              }
              if (!ensureTrId(res, "usPrice", requestId)) {
                return
              }
              if (!ensureTrId(res, "usPriceDetail", requestId)) {
                return
              }
              const quotesBySymbol = await resolveBatchQuotes(region, symbols)
              logUsQuoteCoverage("kis", symbols, quotesBySymbol)
              sendJson(res, 200, {
                ok: true,
                source: "kis",
                quotesBySymbol,
                ts: Date.now(),
              })
              return
            }

            if (!ensureKeys(res, requestId)) {
              return
            }
            if (!ensureTrId(res, "quote", requestId)) {
              return
            }
            const quotesBySymbol = await resolveBatchQuotes(region, symbols)
            sendJson(res, 200, {
              ok: true,
              source: "kis",
              quotesBySymbol,
              ts: Date.now(),
            })
            return
          }

          if (dataMode !== "kis") {
            if (url.pathname === "/api/market/indices") {
              const region = normalizeRegion(
                url.searchParams.get("region") ??
                  url.searchParams.get("market"),
              )
              if (region === "US") {
                const entry = loadUsIndices()
                if (!entry) {
                  sendError(
                    res,
                    500,
                    "US_INDICES_MISSING",
                    "US indices fixture missing",
                    requestId,
                  )
                  return
                }
                sendJson(res, 200, {
                  ok: true,
                  source: fixtureSource,
                  indices: entry.items,
                })
                return
              }
              const indices = fixtures.indices.map((item) => {
                const daily =
                  fixtures.indexDaily[item.code as "KOSPI" | "KOSDAQ"] ?? []
                const resolved = resolveIndexFallback(
                  {
                    price: item.price,
                    change: item.change,
                    changeRate: item.changeRate,
                  },
                  daily,
                )
                return { ...item, ...resolved }
              })
              sendJson(res, 200, {
                ok: true,
                source: fixtureSource,
                indices,
              })
              return
            }

            if (url.pathname === "/api/market/rankings") {
              const perfStartAt = Date.now()
              const { region, group } = resolveRankingScope(
                url.searchParams.get("market"),
                url.searchParams.get("region"),
                url.searchParams.get("group"),
              )
              const { mode, sortKey, sortDir } = resolveRankingMode(
                url.searchParams.get("mode") ??
                  url.searchParams.get("category"),
                url.searchParams.get("sortKey"),
                url.searchParams.get("sortDir"),
              )
              const limit = Math.min(
                Math.max(Number(url.searchParams.get("limit") ?? "50"), 1),
                200,
              )
              const query = url.searchParams.get("q") ?? ""
              const cacheEntry =
                region === "US"
                  ? getUsSymbols(dataDir, group as UsSymbolGroup)
                  : loadSymbols(group as "KOSPI" | "KOSDAQ" | "ALL")
              const symbols =
                cacheEntry?.items ?? (region === "US" ? [] : fixtures.symbols)
              const version = cacheEntry?.mtimeMs ?? 0
              const warning = !cacheEntry
                ? {
                    code: "SYMBOL_CACHE_MISSING",
                    message:
                      region === "US"
                        ? "US symbols cache missing. Run node scripts/update-us-symbols.mjs."
                        : "Symbols cache missing. Showing fixture data.",
                  }
                : undefined
              const baseItems = buildRankingSourceItems(symbols, region)
              const filtered = filterRankingItems(baseItems, query)
              const cacheKey = buildRankingCacheKey({
                region,
                mode,
                sortKey,
                sortDir,
                query,
                version,
              })
              const payload = resolveRankingPayload({
                items: filtered,
                sortKey,
                sortDir,
                market: region,
                query,
                cursor: url.searchParams.get("cursor"),
                cacheKey,
                limit,
              })
              logPerf(
                `rankings:${fixtureSource}:${region}:${mode}`,
                perfStartAt,
              )
              sendJson(res, 200, {
                ok: true,
                source: fixtureSource,
                warning,
                ...payload,
              })
              return
            }

            if (url.pathname === "/api/symbols") {
              const region = normalizeRegion(
                url.searchParams.get("region") ??
                  url.searchParams.get("market"),
              )
              const query = url.searchParams.get("q") ?? ""
              const mode = url.searchParams.get("mode") ?? "search"
              const allowEmpty = mode === "list"
              const limit = Math.min(
                Math.max(Number(url.searchParams.get("limit") ?? "10"), 1),
                50,
              )
              if (region === "US") {
                const group = normalizeUsGroup(
                  url.searchParams.get("group") ??
                    url.searchParams.get("market"),
                )
                const cacheEntry = getUsSymbols(dataDir, group)
                if (!cacheEntry) {
                  sendError(
                    res,
                    200,
                    "SYMBOL_CACHE_MISSING",
                    "US symbols cache missing. Run node scripts/update-us-symbols.mjs.",
                    requestId,
                  )
                  return
                }
                const filtered = filterUsSymbols(
                  cacheEntry.items,
                  query,
                  allowEmpty,
                )
                const payload = paginateSymbols(
                  filtered,
                  url.searchParams.get("cursor"),
                  limit,
                )
                sendJson(res, 200, {
                  ok: true,
                  source: fixtureSource,
                  ...payload,
                })
                return
              }

              const market = (url.searchParams.get("market") ?? "ALL") as
                | "KOSPI"
                | "KOSDAQ"
                | "ALL"
              const cacheEntry = loadSymbols(market)
              const cachedItems = cacheEntry?.items ?? null
              const filtered = cachedItems
                ? filterSymbols(cachedItems, market, query, allowEmpty)
                : filterSymbols(fixtures.symbols, market, query, allowEmpty)
              const payload = paginateSymbols(
                filtered,
                url.searchParams.get("cursor"),
                limit,
              )
              const warning = !cachedItems
                ? {
                    code: "SYMBOL_CACHE_MISSING",
                    message: "Symbols cache missing. Showing fixture data.",
                  }
                : undefined
              sendJson(res, 200, {
                ok: true,
                source: cachedItems ? "cache" : fixtureSource,
                warning,
                ...payload,
              })
              return
            }

            const quoteMatch = url.pathname.match(
              /^\/api\/stocks\/([^/]+)\/quote$/,
            )
            if (quoteMatch) {
              const code = decodeURIComponent(quoteMatch[1])
              const isUsSymbol = !/^[0-9]{6}$/.test(code)
              if (isUsSymbol) {
                const quoteItem = resolveFixtureBatchQuote("US", code)
                if (quoteItem) {
                  sendJson(res, 200, {
                    ok: true,
                    source: fixtureSource,
                    quote: buildQuoteFromBatchItem(code, quoteItem),
                  })
                  return
                }
              }
              if (dataMode === "contract") {
                const output = readContractOutput(code)
                if (output) {
                  const entry = normalizeQuoteOutput(code, output, false)
                  sendJson(res, 200, {
                    ok: true,
                    source: fixtureSource,
                    quote: entry.quote,
                  })
                  return
                }
              }
              const quote =
                fixtures.quotes[code] ??
                fixtures.quotes[fixtures.baseSymbols[0].code]
              sendJson(res, 200, {
                ok: true,
                source: fixtureSource,
                quote,
              })
              return
            }

            const candleMatch = url.pathname.match(
              /^\/api\/stocks\/([^/]+)\/candles$/,
            )
            if (candleMatch) {
              const code = decodeURIComponent(candleMatch[1])
              const limit = Math.max(
                Number(url.searchParams.get("limit") ?? "0"),
                0,
              )
              const points =
                fixtures.candles[code] ??
                fixtures.candles[fixtures.baseSymbols[0].code]
              const sliced = limit > 0 ? points.slice(-limit) : points
              sendJson(res, 200, {
                ok: true,
                source: fixtureSource,
                series: { points: sliced },
              })
              return
            }

            if (url.pathname === "/api/chart/intraday") {
              const region = normalizeRegion(url.searchParams.get("region"))
              const symbol = url.searchParams.get("symbol") ?? ""
              const interval = resolveIntradayInterval(
                url.searchParams.get("interval"),
              )
              const days = Math.min(
                Math.max(Number(url.searchParams.get("days") ?? "1"), 1),
                5,
              )
              intradayContext = {
                region,
                symbol,
                interval: interval.key,
                days,
              }
              const series = resolveFixtureIntradaySeries(
                symbol,
                region,
                interval.minutes,
                days,
              )
              sendJson(res, 200, {
                ok: true,
                source: fixtureSource,
                series,
              })
              return
            }

            const newsMatch = url.pathname.match(
              /^\/api\/stocks\/([^/]+)\/news$/,
            )
            if (newsMatch) {
              sendJson(res, 200, {
                ok: true,
                source: fixtureSource,
                items: fixtures.news,
              })
              return
            }

            const disclosureMatch = url.pathname.match(
              /^\/api\/stocks\/([^/]+)\/disclosures$/,
            )
            if (disclosureMatch) {
              sendJson(res, 200, {
                ok: true,
                source: fixtureSource,
                items: fixtures.disclosures,
              })
              return
            }

            sendError(
              res,
              404,
              "NOT_FOUND",
              "Unknown fixture endpoint",
              requestId,
            )
            return
          }

          if (url.pathname === "/api/market/indices") {
            const region = normalizeRegion(
              url.searchParams.get("region") ?? url.searchParams.get("market"),
            )
            if (region === "US") {
              const indices = await fetchWithCache(
                "indices:us",
                8000,
                async (): Promise<MarketIndex[]> =>
                  Promise.all([
                    fetchYahooIndex("^IXIC", "NASDAQ", "NASDAQ"),
                    fetchYahooIndex("^DJI", "DOWJONES", "DOW JONES"),
                  ]),
              )
              sendJson(res, 200, {
                ok: true,
                source: "yahoo",
                indices,
              })
              return
            }
          }

          if (!ensureKeys(res, requestId)) {
            return
          }

          if (url.pathname === "/api/chart/intraday") {
            const region = normalizeRegion(
              url.searchParams.get("region") ?? url.searchParams.get("market"),
            )
            const symbol = url.searchParams.get("symbol") ?? ""
            if (!symbol) {
              sendError(res, 400, "BAD_REQUEST", "Symbol required", requestId)
              return
            }
            const interval = resolveIntradayInterval(
              url.searchParams.get("interval"),
            )
            const days = Math.min(
              Math.max(Number(url.searchParams.get("days") ?? "1"), 1),
              5,
            )
            intradayContext = {
              region,
              symbol,
              interval: interval.key,
              days,
            }
            const usInterval = resolveUsProviderMinutes(interval.key)
            const krPlan = resolveKrProviderMinutes(interval.key, days)
            const requestMinutes =
              region === "US"
                ? usInterval.providerMinutes
                : krPlan.requestMinutes
            const aggregateMinutes = interval.minutes
            const resolvedDays = region === "US" ? days : krPlan.days
            if (region === "US") {
              if (!ensureTrId(res, "usIntraday", requestId)) {
                return
              }
            } else if (!ensureTrId(res, "intraday", requestId)) {
              return
            }
            const ttl = interval.minutes <= 15 ? 10000 : 30000
            const cacheKey = `intraday:${region}:${symbol}:${interval.key}:${resolvedDays}`
            const series = await fetchWithCache(cacheKey, ttl, () =>
              resolveIntradaySeries(
                region,
                symbol,
                requestMinutes,
                aggregateMinutes,
                resolvedDays,
              ),
            )
            sendJson(res, 200, {
              ok: true,
              source: "kis",
              series,
            })
            return
          }

          if (url.pathname === "/api/market/indices") {
            if (!ensureTrId(res, "index", requestId)) {
              return
            }
            const kospiCode =
              env.VITE_KIS_KOSPI_CODE || env.KIS_KOSPI_CODE || "0001"
            const kosdaqCode =
              env.VITE_KIS_KOSDAQ_CODE || env.KIS_KOSDAQ_CODE || "1001"
            const indices = await fetchWithCache(
              "indices:kr",
              8000,
              async (): Promise<MarketIndex[]> => {
                const resolveIndex = async (
                  sourceCode: string,
                  outputCode: "KOSPI" | "KOSDAQ",
                  name: string,
                ): Promise<MarketIndex> => {
                  const snapshot = await fetchIndexSnapshot(sourceCode)
                  const base = {
                    price: snapshot.snapshot?.price ?? snapshot.lastClose,
                    change: snapshot.snapshot?.change ?? 0,
                    changeRate: snapshot.snapshot?.changeRate ?? 0,
                  }
                  if (base.price > 0) {
                    return {
                      code: outputCode,
                      name,
                      ...base,
                      updatedAt: new Date().toISOString(),
                    }
                  }
                  if (!trIds.indexDaily) {
                    throw new Error("Missing TR_ID for indexDaily")
                  }
                  const daily = await fetchWithCache(
                    `indices:daily:${sourceCode}`,
                    180000,
                    () => fetchIndexDailySeries(sourceCode),
                  )
                  const resolved = resolveIndexFallback(
                    base,
                    daily.points ?? [],
                  )
                  return {
                    code: outputCode,
                    name,
                    ...resolved,
                    updatedAt: new Date().toISOString(),
                  }
                }

                return Promise.all([
                  resolveIndex(kospiCode, "KOSPI", "코스피"),
                  resolveIndex(kosdaqCode, "KOSDAQ", "코스닥"),
                ])
              },
            )
            sendJson(res, 200, {
              ok: true,
              source: "kis",
              indices,
            })
            return
          }

          if (url.pathname === "/api/market/rankings") {
            if (!ensureTrId(res, "quote", requestId)) {
              return
            }
            const perfStartAt = Date.now()
            const { region, group } = resolveRankingScope(
              url.searchParams.get("market"),
              url.searchParams.get("region"),
              url.searchParams.get("group"),
            )
            const { mode, sortKey, sortDir } = resolveRankingMode(
              url.searchParams.get("mode") ?? url.searchParams.get("category"),
              url.searchParams.get("sortKey"),
              url.searchParams.get("sortDir"),
            )
            const limit = Math.min(
              Math.max(Number(url.searchParams.get("limit") ?? "50"), 1),
              200,
            )
            const query = url.searchParams.get("q") ?? ""
            const cacheEntry =
              region === "US"
                ? getUsSymbols(dataDir, group as UsSymbolGroup)
                : loadSymbols(group as "KOSPI" | "KOSDAQ" | "ALL")
            if (!cacheEntry) {
              sendJson(res, 200, {
                ok: false,
                code: "SYMBOL_CACHE_MISSING",
                message:
                  region === "US"
                    ? "US symbols cache missing. Run node scripts/update-us-symbols.mjs."
                    : "Symbols cache missing. Run npm run symbols:update",
                items: [],
                nextCursor: null,
                hasMore: false,
                totalCount: 0,
                requestId,
              })
              return
            }
            await ensurePriorityMarketCaps(cacheEntry.items, region, sortKey)
            const baseItems = buildRankingSourceItems(cacheEntry.items, region)
            const filtered = filterRankingItems(baseItems, query)
            const cacheKey = buildRankingCacheKey({
              region,
              mode,
              sortKey,
              sortDir,
              query,
              version: cacheEntry.mtimeMs,
            })
            const payload = resolveRankingPayload({
              items: filtered,
              sortKey,
              sortDir,
              market: region,
              query,
              cursor: url.searchParams.get("cursor"),
              cacheKey,
              limit,
            })
            startGlobalMetricsRefresh(region, cacheEntry.items)
            logPerf(`rankings:kis:${region}:${mode}`, perfStartAt)
            sendJson(res, 200, {
              ok: true,
              source: "kis",
              ...payload,
            })
            return
          }

          if (url.pathname === "/api/symbols") {
            const region = normalizeRegion(
              url.searchParams.get("region") ?? url.searchParams.get("market"),
            )
            const query = url.searchParams.get("q") ?? ""
            const mode = url.searchParams.get("mode") ?? "search"
            const allowEmpty = mode === "list"
            const limit = Math.min(
              Math.max(Number(url.searchParams.get("limit") ?? "10"), 1),
              50,
            )
            if (region === "US") {
              const group = normalizeUsGroup(
                url.searchParams.get("group") ?? url.searchParams.get("market"),
              )
              const cacheEntry = getUsSymbols(dataDir, group)
              if (!cacheEntry) {
                sendJson(res, 200, {
                  ok: false,
                  code: "SYMBOL_CACHE_MISSING",
                  message:
                    "US symbols cache missing. Run node scripts/update-us-symbols.mjs.",
                  items: [],
                  nextCursor: null,
                  requestId,
                })
                return
              }
              const filtered = filterUsSymbols(
                cacheEntry.items,
                query,
                allowEmpty,
              )
              const payload = paginateSymbols(
                filtered,
                url.searchParams.get("cursor"),
                limit,
              )
              sendJson(res, 200, {
                ok: true,
                source: "snapshot",
                ...payload,
              })
              return
            }

            const market = (url.searchParams.get("market") ?? "ALL") as
              | "KOSPI"
              | "KOSDAQ"
              | "ALL"
            const cacheEntry = loadSymbols(market)
            if (!cacheEntry) {
              sendJson(res, 200, {
                ok: false,
                code: "SYMBOL_CACHE_MISSING",
                message: "Symbols cache missing. Run npm run symbols:update",
                items: [],
                nextCursor: null,
                requestId,
              })
              return
            }
            const filtered = filterSymbols(
              cacheEntry.items,
              market,
              query,
              allowEmpty,
            )
            const payload = paginateSymbols(
              filtered,
              url.searchParams.get("cursor"),
              limit,
            )
            sendJson(res, 200, {
              ok: true,
              source: "kis",
              ...payload,
            })
            return
          }

          const quoteMatch = url.pathname.match(
            /^\/api\/stocks\/([^/]+)\/quote$/,
          )
          if (quoteMatch) {
            const symbol = decodeURIComponent(quoteMatch[1])
            const isUsSymbol = !/^[0-9]{6}$/.test(symbol)
            if (isUsSymbol) {
              if (!ensureTrId(res, "usPrice", requestId)) {
                return
              }
              if (!ensureTrId(res, "usPriceDetail", requestId)) {
                return
              }
              const quoteItem = await fetchWithCache(
                `quote:us:${symbol}`,
                4000,
                () => fetchUsQuote(symbol),
              )
              sendJson(res, 200, {
                ok: true,
                source: "kis",
                quote: buildQuoteFromBatchItem(symbol, quoteItem),
              })
              return
            }
            if (!ensureTrId(res, "quote", requestId)) {
              return
            }
            const quote = await fetchWithCache(`quote:${symbol}`, 4000, () =>
              fetchQuote(symbol),
            )
            sendJson(res, 200, {
              ok: true,
              source: "kis",
              quote: quote.quote,
            })
            return
          }

          const candleMatch = url.pathname.match(
            /^\/api\/stocks\/([^/]+)\/candles$/,
          )
          if (candleMatch) {
            const symbol = decodeURIComponent(candleMatch[1])
            const tf = url.searchParams.get("tf") ?? "1d"
            const limit = Math.max(
              Number(url.searchParams.get("limit") ?? "0"),
              0,
            )
            const intradayFrames = ["1m", "5m", "30m", "1h"]
            const isIntraday = intradayFrames.includes(tf)
            if (isIntraday && !ensureTrId(res, "intraday", requestId)) {
              return
            }
            if (!isIntraday && !ensureTrId(res, "daily", requestId)) {
              return
            }
            const period = tf === "1w" ? "W" : tf === "1mo" ? "M" : "D"
            const requestTime = isIntraday
              ? formatTimeInZone(new Date(), "Asia/Seoul")
              : ""
            const series = await fetchWithCache(
              `candles:${symbol}:${tf}`,
              isIntraday ? 10000 : 60000,
              () =>
                isIntraday
                  ? fetchIntradaySeries(symbol, requestTime)
                  : fetchDailySeries(symbol, period),
            )
            const points =
              limit > 0 ? series.points.slice(-limit) : series.points
            sendJson(res, 200, {
              ok: true,
              source: "kis",
              series: { points },
            })
            return
          }

          const newsMatch = url.pathname.match(/^\/api\/stocks\/([^/]+)\/news$/)
          if (newsMatch) {
            const symbol = decodeURIComponent(newsMatch[1])
            const limit = Number(url.searchParams.get("limit") ?? "20")
            const items = await fetchWithCache(
              `news:${symbol}:${limit}`,
              120000,
              () => fetchNewsItems(symbol, limit),
            )
            sendJson(res, 200, { ok: true, source: "naver", items })
            return
          }

          const disclosureMatch = url.pathname.match(
            /^\/api\/stocks\/([^/]+)\/disclosures$/,
          )
          if (disclosureMatch) {
            const symbol = decodeURIComponent(disclosureMatch[1])
            const limit = Number(url.searchParams.get("limit") ?? "20")
            const items = await fetchWithCache(
              `disclosures:${symbol}:${limit}`,
              180000,
              () => fetchDisclosuresItems(symbol, limit),
            )
            sendJson(res, 200, { ok: true, source: "naver", items })
            return
          }

          sendError(res, 404, "NOT_FOUND", "Unknown endpoint", requestId)
        } catch (error) {
          const message = error instanceof Error ? error.message : "Proxy error"
          const upstreamMeta =
            error instanceof UpstreamError
              ? {
                  upstreamStatus: error.upstreamStatus,
                  upstreamCode: error.upstreamCode,
                  upstreamMessage: error.upstreamMessage,
                }
              : undefined
          if (isDevServer && intradayContext) {
            const { region, symbol, interval, days } = intradayContext
            const metaText = upstreamMeta
              ? ` status=${upstreamMeta.upstreamStatus ?? "-"} code=${upstreamMeta.upstreamCode ?? "-"}`
              : ""
            console.warn(
              `[intraday:error] requestId=${requestId} region=${region} symbol=${symbol} interval=${interval} days=${days}${metaText}`,
            )
          }
          sendError(
            res,
            502,
            "UPSTREAM_ERROR",
            "업스트림 오류",
            requestId,
            message,
            upstreamMeta,
          )
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const rootDir = process.cwd()
  loadLocalEnv(rootDir)
  const env = {
    ...process.env,
    ...loadEnv(mode, rootDir, ""),
  } as Record<string, string>
  const dataMode = resolveDataMode(env)

  return {
    plugins: [react(), createApiProxy(env, rootDir)],
    define: {
      "import.meta.env.DATA_MODE": JSON.stringify(dataMode),
    },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  }
})
