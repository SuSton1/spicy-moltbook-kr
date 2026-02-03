import fs from "node:fs"
import path from "node:path"
import { requestText } from "../http"

export type ToneCue = {
  updatedAt: string
  hints: string[]
  blockedUntil?: string | null
  fetchLog?: string[]
}

const CACHE_TTL_MS = 2 * 60 * 60 * 1000
const RATE_LIMIT_PER_HOUR = 2
const USER_AGENT =
  "Mozilla/5.0 (compatible; KoreaMoltbookRunner/0.1; +https://example.local)"

function nowMs() {
  return Date.now()
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

function loadCache(filePath: string): ToneCue | null {
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = fs.readFileSync(filePath, "utf-8")
    return JSON.parse(raw) as ToneCue
  } catch {
    return null
  }
}

function saveCache(filePath: string, data: ToneCue) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")
}

function isFresh(cache: ToneCue | null) {
  if (!cache?.updatedAt) return false
  return nowMs() - new Date(cache.updatedAt).getTime() < CACHE_TTL_MS
}

function loadRateLog(pathName: string | undefined, fallback: string[] = []) {
  if (!pathName) return fallback
  if (!fs.existsSync(pathName)) return fallback
  try {
    const raw = fs.readFileSync(pathName, "utf-8")
    return JSON.parse(raw) as string[]
  } catch {
    return fallback
  }
}

function saveRateLog(pathName: string | undefined, log: string[]) {
  if (!pathName) return
  ensureDir(path.dirname(pathName))
  fs.writeFileSync(pathName, JSON.stringify(log, null, 2), "utf-8")
}

function canFetch(cache: ToneCue | null, rateLog: string[]) {
  if (cache?.blockedUntil) {
    const until = new Date(cache.blockedUntil)
    if (until.getTime() > nowMs()) return false
  }
  const cutoff = nowMs() - 60 * 60 * 1000
  const recent = rateLog.filter((ts) => new Date(ts).getTime() >= cutoff)
  return recent.length < RATE_LIMIT_PER_HOUR
}

function recordFetch(rateLog: string[]) {
  const log = [...rateLog, new Date().toISOString()]
  const cutoff = nowMs() - 60 * 60 * 1000
  return log.filter((ts) => new Date(ts).getTime() >= cutoff)
}

function tokenize(text: string) {
  const tokens = text.match(/[가-힣A-Za-z]{2,}/g) ?? []
  const stop = new Set(["https", "http", "www", "com"])
  return tokens
    .map((token) => token.trim())
    .filter((token) => token && !stop.has(token.toLowerCase()))
}

function extractHints(html: string) {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  const tokens = tokenize(cleaned)
  const counts = new Map<string, number>()
  tokens.forEach((token) => {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  })

  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([token]) => token)

  return top.length > 0 ? [`키워드: ${top.join(", ")}`] : []
}

export async function fetchToneCues({
  url,
  cachePath,
  rateLimitPath,
  log,
}: {
  url: string
  cachePath: string
  rateLimitPath?: string
  log: (message: string) => void
}) {
  const cache = loadCache(cachePath)
  const rateLog = loadRateLog(rateLimitPath, cache?.fetchLog ?? [])
  if (isFresh(cache)) {
    return { source: "cache", hints: cache?.hints ?? [] }
  }

  if (!canFetch(cache, rateLog)) {
    return { source: "rate-limited", hints: cache?.hints ?? [] }
  }

  try {
    const response = await requestText(
      new URL(url),
      {
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
      },
      { allowedOrigins: [new URL(url).origin], timeoutMs: 8000, retries: 0 }
    )

    if (!response.ok || !response.text) {
      const blockedUntil = new Date(nowMs() + CACHE_TTL_MS).toISOString()
      const nextRateLog = recordFetch(rateLog)
      saveRateLog(rateLimitPath, nextRateLog)
      saveCache(cachePath, {
        updatedAt: new Date().toISOString(),
        hints: cache?.hints ?? [],
        blockedUntil,
        fetchLog: nextRateLog,
      })
      log("DCInside 응답 실패, 캐시 유지")
      return { source: "blocked", hints: cache?.hints ?? [] }
    }

    const hints = extractHints(response.text)
    const nextRateLog = recordFetch(rateLog)
    saveRateLog(rateLimitPath, nextRateLog)
    saveCache(cachePath, {
      updatedAt: new Date().toISOString(),
      hints,
      blockedUntil: null,
      fetchLog: nextRateLog,
    })

    return { source: "fetched", hints }
  } catch {
    const nextRateLog = recordFetch(rateLog)
    saveRateLog(rateLimitPath, nextRateLog)
    saveCache(cachePath, {
      updatedAt: cache?.updatedAt ?? new Date().toISOString(),
      hints: cache?.hints ?? [],
      blockedUntil: new Date(nowMs() + CACHE_TTL_MS).toISOString(),
      fetchLog: nextRateLog,
    })
    log("DCInside 요청 실패, 캐시 유지")
    return { source: "error", hints: cache?.hints ?? [] }
  }
}
