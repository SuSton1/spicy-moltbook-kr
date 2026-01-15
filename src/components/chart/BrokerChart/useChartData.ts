import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { UTCTimestamp } from "lightweight-charts"
import { fetchCandles, type Candle as ApiCandle } from "../../../services/api"
import { isIntradayInterval } from "../../../lib/chartIntervals"
import { toEpochMsInZone } from "../../../lib/timezone"
import { useDebouncedValue } from "../../../hooks/useDebouncedValue"
import type { BrokerCandle, BrokerChartTimeframe } from "./types"

export type ChartDataStatus = "idle" | "loading" | "ready" | "error"

type IdleCallbackDeadline = {
  didTimeout: boolean
  timeRemaining: () => number
}

type RequestIdleCallback = (
  callback: (deadline: IdleCallbackDeadline) => void,
  options?: { timeout?: number },
) => number

type CancelIdleCallback = (handle: number) => void

type CacheEntry = {
  data: BrokerCandle[]
  updatedAt: number
  ttlMs: number
}

const chartCache = new Map<string, CacheEntry>()
const chartPrefetchDone = new Set<string>()

const resolveCandleLimit = (tf: BrokerChartTimeframe) => {
  switch (tf) {
    case "1m":
    case "3m":
    case "5m":
    case "10m":
    case "15m":
      return 390
    case "30m":
      return 240
    case "1h":
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

const resolveClientTtl = (tf: BrokerChartTimeframe) => {
  if (isIntradayInterval(tf)) {
    const minutes =
      tf === "1h" ? 60 : tf === "4h" ? 240 : Number(tf.replace("m", ""))
    return minutes <= 15 ? 10000 : 30000
  }
  return 60000
}

export const normalizeCandleTime = (
  value: string | number,
  timeZone?: string,
): UTCTimestamp => {
  if (!value) {
    return 0 as UTCTimestamp
  }
  if (typeof value === "number") {
    const seconds =
      value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)
    return seconds as UTCTimestamp
  }
  const digits = value.replace(/\D/g, "")
  if (!digits) {
    return 0 as UTCTimestamp
  }
  const year = Number(digits.slice(0, 4))
  const month = Number(digits.slice(4, 6)) - 1
  const day = Number(digits.slice(6, 8))
  const hour = digits.length >= 10 ? Number(digits.slice(8, 10)) : 0
  const minute = digits.length >= 12 ? Number(digits.slice(10, 12)) : 0
  if (!timeZone) {
    return Math.floor(
      Date.UTC(year, month, day, hour, minute) / 1000,
    ) as UTCTimestamp
  }
  const epochMs = toEpochMsInZone(digits, timeZone)
  if (!epochMs) {
    return Math.floor(
      Date.UTC(year, month, day, hour, minute) / 1000,
    ) as UTCTimestamp
  }
  return Math.floor(epochMs / 1000) as UTCTimestamp
}

export const normalizeCandleSeries = (
  points: ApiCandle[],
  timeZone?: string,
): BrokerCandle[] => {
  const mapped = points
    .map((item): BrokerCandle => {
      const time = normalizeCandleTime(item.time, timeZone)
      return {
        time,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
      }
    })
    .filter((item) => item.time > 0)
  mapped.sort((a, b) => a.time - b.time)
  const deduped: BrokerCandle[] = []
  for (const item of mapped) {
    const last = deduped[deduped.length - 1]
    if (last && last.time === item.time) {
      deduped[deduped.length - 1] = item
      continue
    }
    deduped.push(item)
  }
  return deduped
}

export const findNearestCandleAtOrBefore = (
  candles: BrokerCandle[],
  time: UTCTimestamp,
): BrokerCandle | null => {
  if (!candles.length) {
    return null
  }
  let lo = 0
  let hi = candles.length - 1
  if (candles[0].time > time) {
    return null
  }
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const midTime = candles[mid].time
    if (midTime <= time) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return candles[lo] ?? null
}

export const useChartData = ({
  symbol,
  region,
  tf,
  timeZone,
  days,
}: {
  symbol: string
  region: "KR" | "US"
  tf: BrokerChartTimeframe
  timeZone: string
  days: number
}) => {
  const debugStorm = import.meta.env.VITE_DEBUG_STORM === "1"
  const initialKey = `brokerChart:${region}:${symbol}:${tf}:${days}:${timeZone}`
  const initialCache = chartCache.get(initialKey)
  const [data, setData] = useState<BrokerCandle[]>(
    () => initialCache?.data ?? [],
  )
  const [status, setStatus] = useState<ChartDataStatus>(() =>
    initialCache?.data?.length ? "ready" : "idle",
  )
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inflightRef = useRef(false)
  const inflightKeyRef = useRef<string | null>(null)
  const activeKeyRef = useRef(initialKey)
  const requestIdRef = useRef(0)
  const backoffRef = useRef<{
    key: string
    failures: number
    nextAllowedAt: number
  }>({ key: "", failures: 0, nextAllowedAt: 0 })

  const debouncedTf = useDebouncedValue(tf, 200)
  const debouncedDays = useDebouncedValue(days, 200)

  const activeKey = useMemo(
    () => `brokerChart:${region}:${symbol}:${tf}:${days}:${timeZone}`,
    [days, region, symbol, tf, timeZone],
  )
  const fetchKey = useMemo(
    () =>
      `brokerChart:${region}:${symbol}:${debouncedTf}:${debouncedDays}:${timeZone}`,
    [debouncedDays, debouncedTf, region, symbol, timeZone],
  )
  const limit = useMemo(() => resolveCandleLimit(debouncedTf), [debouncedTf])
  const ttlMs = useMemo(() => resolveClientTtl(debouncedTf), [debouncedTf])

  useEffect(() => {
    activeKeyRef.current = activeKey
    abortRef.current?.abort()
    inflightRef.current = false
    inflightKeyRef.current = null
    const cached = chartCache.get(activeKey)
    if (cached?.data.length) {
      setData(cached.data)
      setStatus("ready")
      setError(null)
    } else if (symbol) {
      setData([])
      setStatus("loading")
      setError(null)
    } else {
      setData([])
      setStatus("idle")
      setError(null)
    }
  }, [activeKey, symbol])

  const load = useCallback(async () => {
    if (!symbol) {
      return
    }
    if (inflightRef.current && inflightKeyRef.current === fetchKey) {
      if (debugStorm) {
        console.info(`[storm] chart skip inflight key=${fetchKey}`)
      }
      return
    }
    const backoff = backoffRef.current
    const nowMs = Date.now()
    if (backoff.key === fetchKey && backoff.nextAllowedAt > nowMs) {
      if (debugStorm) {
        console.info(
          `[storm] chart skip backoff key=${fetchKey} waitMs=${Math.max(
            0,
            backoff.nextAllowedAt - nowMs,
          )}`,
        )
      }
      return
    }
    const now = Date.now()
    const cached = chartCache.get(fetchKey)
    if (
      cached &&
      now - cached.updatedAt <= cached.ttlMs &&
      cached.data.length
    ) {
      if (debugStorm) {
        console.info(`[storm] chart cache hit key=${fetchKey}`)
      }
      if (activeKeyRef.current === fetchKey) {
        setData(cached.data)
        setStatus("ready")
        setError(null)
      }
      return
    }

    const shouldUpdateState = activeKeyRef.current === fetchKey
    if (shouldUpdateState && !(cached && cached.data.length)) {
      setData([])
      setStatus("loading")
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    inflightRef.current = true
    inflightKeyRef.current = fetchKey
    try {
      if (debugStorm) {
        console.info(
          `[storm] chart fetch symbol=${symbol} region=${region} tf=${debouncedTf} days=${debouncedDays}`,
        )
      }
      const payload = await fetchCandles(
        symbol,
        debouncedTf,
        limit,
        region,
        debouncedDays,
        controller.signal,
      )
      if (controller.signal.aborted || requestId !== requestIdRef.current) {
        return
      }
      const normalized = normalizeCandleSeries(payload.series.points, timeZone)
      chartCache.set(fetchKey, {
        data: normalized,
        updatedAt: Date.now(),
        ttlMs,
      })
      if (activeKeyRef.current === fetchKey) {
        setData(normalized)
        setStatus("ready")
        setError(null)
      }
      if (backoffRef.current.key === fetchKey) {
        backoffRef.current = { key: fetchKey, failures: 0, nextAllowedAt: 0 }
      }
    } catch (err) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) {
        return
      }
      const message = err instanceof Error ? err.message : "차트 데이터 오류"
      if (activeKeyRef.current === fetchKey) {
        setStatus("error")
        setError(message)
      }
      if (debugStorm) {
        console.warn(
          `[storm] chart fetch failed symbol=${symbol} region=${region} tf=${debouncedTf} days=${debouncedDays} err=${message}`,
        )
      }
      const current = backoffRef.current
      const failures = current.key === fetchKey ? current.failures + 1 : 1
      const jitter = Math.random() * 200
      const delay = Math.min(
        60000,
        Math.round(500 * 2 ** Math.min(failures, 6) + jitter),
      )
      backoffRef.current = {
        key: fetchKey,
        failures,
        nextAllowedAt: Date.now() + delay,
      }
    } finally {
      if (requestId === requestIdRef.current) {
        inflightRef.current = false
        inflightKeyRef.current = null
      }
    }
  }, [
    fetchKey,
    debugStorm,
    debouncedDays,
    debouncedTf,
    limit,
    region,
    symbol,
    timeZone,
    ttlMs,
  ])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!symbol) {
      return
    }
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return
    }
    const prefetchTf = isIntradayInterval(tf)
      ? ("1d" as const)
      : ("15m" as const)
    const prefetchDays = 1
    const prefetchKey = `brokerChart:${region}:${symbol}:${prefetchTf}:${prefetchDays}:${timeZone}`
    if (chartPrefetchDone.has(prefetchKey)) {
      return
    }
    const cached = chartCache.get(prefetchKey)
    const now = Date.now()
    if (
      cached &&
      now - cached.updatedAt <= cached.ttlMs &&
      cached.data.length
    ) {
      return
    }
    let timer = 0
    const run = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return
      }
      chartPrefetchDone.add(prefetchKey)
      const ttl = resolveClientTtl(prefetchTf)
      const existing = chartCache.get(prefetchKey)
      const nowTs = Date.now()
      if (
        existing &&
        nowTs - existing.updatedAt <= existing.ttlMs &&
        existing.data.length
      ) {
        return
      }
      void fetchCandles(
        symbol,
        prefetchTf,
        resolveCandleLimit(prefetchTf),
        region,
        prefetchDays,
      )
        .then((payload) => {
          const normalized = normalizeCandleSeries(
            payload.series.points,
            timeZone,
          )
          chartCache.set(prefetchKey, {
            data: normalized,
            updatedAt: Date.now(),
            ttlMs: ttl,
          })
        })
        .catch(() => {
          chartPrefetchDone.delete(prefetchKey)
          return undefined
        })
    }
    const idleApi = window as unknown as {
      requestIdleCallback?: RequestIdleCallback
      cancelIdleCallback?: CancelIdleCallback
    }
    if (typeof idleApi.requestIdleCallback === "function") {
      const handle = idleApi.requestIdleCallback(() => run(), { timeout: 1500 })
      return () => idleApi.cancelIdleCallback?.(handle)
    }
    timer = window.setTimeout(run, 800)
    return () => window.clearTimeout(timer)
  }, [region, symbol, tf, timeZone])

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
