import type { RankingItem } from "../services/api"

export type RankingSortKey =
  | "volume"
  | "turnover"
  | "marketCap"
  | "changePercent"
export type RankingSortDir = "asc" | "desc"

export type RankingCursorPayload = {
  offset: number
  sortKey: RankingSortKey
  sortDir: RankingSortDir
  market: string
  query: string
  cacheKey: string
}

export type CacheEntry<T> = {
  value: T
  expiresAt: number
}

const getBuffer = () => {
  if (typeof globalThis === "undefined") {
    return null
  }
  const candidate = (globalThis as { Buffer?: unknown }).Buffer
  if (!candidate || typeof candidate !== "function" || !("from" in candidate)) {
    return null
  }
  return candidate as {
    from: (
      value: string,
      encoding: string,
    ) => { toString: (encoding: string) => string }
  }
}

const toBase64 = (value: string) => {
  const buffer = getBuffer()
  if (buffer) {
    return buffer.from(value, "utf8").toString("base64")
  }
  return btoa(value)
}

const fromBase64 = (value: string) => {
  const buffer = getBuffer()
  if (buffer) {
    return buffer.from(value, "base64").toString("utf8")
  }
  return atob(value)
}

export const encodeRankingCursor = (payload: RankingCursorPayload) =>
  toBase64(JSON.stringify(payload))

export const decodeRankingCursor = (cursor?: string | null) => {
  if (!cursor) {
    return null
  }
  try {
    const decoded = fromBase64(cursor)
    const parsed = JSON.parse(decoded) as RankingCursorPayload
    if (
      typeof parsed.offset !== "number" ||
      parsed.offset < 0 ||
      !parsed.sortKey ||
      !parsed.sortDir
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const normalizeText = (value?: string | null) =>
  (value ?? "").trim().toLowerCase()

export const buildRankingCacheKey = (params: {
  region: string
  sortKey: RankingSortKey
  sortDir: RankingSortDir
  mode?: string
  query?: string
  version?: number
}) => {
  const normalizedQuery = normalizeText(params.query)
  return [
    "rankings",
    params.region,
    params.mode ?? params.sortKey,
    params.sortKey,
    params.sortDir,
    normalizedQuery,
    String(params.version ?? 0),
  ].join(":")
}

export const normalizeRankingSortKey = (
  value?: string | null,
): RankingSortKey => {
  const normalized = normalizeText(value)
  if (normalized === "volume") {
    return "volume"
  }
  if (
    normalized === "turnover" ||
    normalized === "value" ||
    normalized === "trading_value"
  ) {
    return "turnover"
  }
  if (
    normalized === "marketcap" ||
    normalized === "market_cap" ||
    normalized === "mcap"
  ) {
    return "marketCap"
  }
  if (
    normalized === "changepercent" ||
    normalized === "change_percent" ||
    normalized === "changerate" ||
    normalized === "change_rate" ||
    normalized === "change" ||
    normalized === "rate"
  ) {
    return "changePercent"
  }
  return "volume"
}

export const normalizeRankingSortDir = (
  value?: string | null,
): RankingSortDir => {
  const normalized = normalizeText(value)
  if (normalized === "asc" || normalized === "desc") {
    return normalized
  }
  return "desc"
}

const readMetricValue = (item: RankingItem, key: RankingSortKey) => {
  switch (key) {
    case "turnover":
      return item.value ?? null
    case "marketCap":
      return item.mcap ?? null
    case "changePercent":
      return item.changeRate ?? null
    case "volume":
    default:
      return item.volume ?? null
  }
}

const compareNullable = (
  aValue: number | null,
  bValue: number | null,
  dir: RankingSortDir,
) => {
  if (aValue === null && bValue === null) {
    return 0
  }
  if (aValue === null) {
    return 1
  }
  if (bValue === null) {
    return -1
  }
  return dir === "desc" ? bValue - aValue : aValue - bValue
}

export const sortRankingItems = (
  items: RankingItem[],
  sortKey: RankingSortKey,
  sortDir: RankingSortDir,
) => {
  const sorted = [...items].sort((a, b) => {
    const metricCompare = compareNullable(
      readMetricValue(a, sortKey),
      readMetricValue(b, sortKey),
      sortDir,
    )
    if (metricCompare !== 0) {
      return metricCompare
    }
    const codeCompare = a.code.localeCompare(b.code)
    if (codeCompare !== 0) {
      return codeCompare
    }
    return a.name.localeCompare(b.name)
  })
  return sorted.map((item, index) => ({ ...item, rank: index + 1 }))
}

export const readCache = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  now = Date.now(),
) => {
  const entry = cache.get(key)
  if (!entry) {
    return null
  }
  if (entry.expiresAt <= now) {
    cache.delete(key)
    return null
  }
  return entry.value
}

export const writeCache = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  now = Date.now(),
) => {
  cache.set(key, { value, expiresAt: now + ttlMs })
}
