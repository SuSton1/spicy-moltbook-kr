export type KisRequestMeta = {
  requestId?: string
  trId?: string
  endpoint?: string
  symbol?: string
  interval?: string
  days?: number
}

export type KisClientEvent = {
  type: "start" | "end" | "rate_limit" | "retry" | "error"
  key: string
  meta?: KisRequestMeta
  attempt?: number
  durationMs?: number
  retryAfterMs?: number
}

export type KisClientOptions = {
  rps: number
  burst: number
  now?: () => number
  random?: () => number
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>
  onEvent?: (event: KisClientEvent) => void
}

export type KisRequestOptions<T> = {
  key: string
  task: () => Promise<T>
  cacheTtlMs?: number
  staleMs?: number
  isRateLimit?: (value: T) => boolean
  getRateLimitMeta?: (value: T) => {
    upstreamStatus?: number
    upstreamCode?: string
    upstreamMessage?: string
  }
  maxRetries?: number
  baseDelayMs?: number
  meta?: KisRequestMeta
}

type CacheEntry<T> = {
  value: T
  expiresAt: number
}

type QueueItem<T> = {
  key: string
  task: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

export class KisRateLimitError extends Error {
  upstreamStatus?: number
  upstreamCode?: string
  upstreamMessage?: string
  retryAfterMs: number

  constructor(params: {
    message: string
    retryAfterMs: number
    upstreamStatus?: number
    upstreamCode?: string
    upstreamMessage?: string
  }) {
    super(params.message)
    this.name = "KisRateLimitError"
    this.retryAfterMs = params.retryAfterMs
    this.upstreamStatus = params.upstreamStatus
    this.upstreamCode = params.upstreamCode
    this.upstreamMessage = params.upstreamMessage
  }
}

const readFirstString = (payload: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = payload[key]
    if (value === undefined || value === null) {
      continue
    }
    const text = String(value).trim()
    if (text) {
      return text
    }
  }
  return ""
}

export const isRateLimitPayload = (payload: Record<string, unknown>) => {
  const code = readFirstString(payload, [
    "msg_cd",
    "errorCode",
    "code",
    "rt_cd",
  ])
  if (code === "EGW00201") {
    return true
  }
  const message = readFirstString(payload, [
    "msg1",
    "message",
    "error",
    "detail",
  ])
  return message.includes("초당 거래건수를 초과")
}

const calcRetryDelayMs = (
  attempt: number,
  baseDelayMs: number,
  jitter: number,
) => Math.max(0, Math.round(baseDelayMs * 2 ** attempt + jitter))

export const isTransientNetworkError = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return false
  }
  const anyError = error as {
    code?: unknown
    message?: unknown
    cause?: { code?: unknown; message?: unknown } | null
  }
  const parts = [
    anyError.code,
    anyError.message,
    anyError.cause?.code,
    anyError.cause?.message,
  ]
    .filter(
      (value): value is string | number =>
        typeof value === "string" || typeof value === "number",
    )
    .map((value) => String(value).toLowerCase())
  const haystack = parts.join(" ")
  const tokens = [
    "und_err_socket",
    "und_err_connect_timeout",
    "und_err_headers_timeout",
    "und_err_body_timeout",
    "ecconnreset",
    "econnreset",
    "etimedout",
    "eai_again",
    "enotfound",
    "econnrefused",
    "socket hang up",
    "other side closed",
  ]
  return tokens.some((token) => haystack.includes(token))
}

export const createKisClient = (options: KisClientOptions) => {
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const rps = Math.max(1, options.rps)
  const burst = Math.max(1, options.burst)
  const cache = new Map<string, CacheEntry<unknown>>()
  const inflight = new Map<string, Promise<unknown>>()
  const queue: QueueItem<unknown>[] = []

  let tokens = burst
  let lastRefill = now()
  let pumpTimer: ReturnType<typeof setTimeout> | null = null

  const emit = (event: KisClientEvent) => {
    options.onEvent?.(event)
  }

  const refillTokens = () => {
    const current = now()
    const elapsed = Math.max(0, current - lastRefill)
    if (elapsed <= 0) {
      return
    }
    tokens = Math.min(burst, tokens + (elapsed / 1000) * rps)
    lastRefill = current
  }

  const schedulePump = (delayMs: number) => {
    if (pumpTimer) {
      return
    }
    pumpTimer = setTimeoutFn(() => {
      pumpTimer = null
      pumpQueue()
    }, delayMs)
  }

  const pumpQueue = () => {
    refillTokens()
    while (tokens >= 1 && queue.length > 0) {
      tokens -= 1
      const item = queue.shift()
      if (!item) {
        break
      }
      Promise.resolve().then(item.task).then(item.resolve).catch(item.reject)
    }
    if (queue.length > 0) {
      const delay = Math.max(0, Math.ceil(1000 / rps))
      schedulePump(delay)
    }
  }

  const schedule = <T>(item: QueueItem<T>) => {
    queue.push(item as QueueItem<unknown>)
    pumpQueue()
  }

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeoutFn(resolve, ms)
    })

  const request = async <T>({
    key,
    task,
    cacheTtlMs,
    staleMs,
    isRateLimit,
    getRateLimitMeta,
    maxRetries = 2,
    baseDelayMs = 250,
    meta,
  }: KisRequestOptions<T>) => {
    const cached = cache.get(key) as CacheEntry<T> | undefined
    const nowTs = now()
    if (cacheTtlMs && cached && cached.expiresAt > nowTs) {
      return cached.value
    }
    if (
      cacheTtlMs &&
      cached &&
      staleMs !== undefined &&
      nowTs - cached.expiresAt <= staleMs
    ) {
      if (!inflight.has(key)) {
        const refresh = new Promise<T>((resolve, reject) => {
          schedule({
            key,
            task: () =>
              runWithRetry({
                key,
                task,
                cacheTtlMs,
                cached,
                isRateLimit,
                getRateLimitMeta,
                maxRetries,
                baseDelayMs,
                meta,
              }),
            resolve,
            reject,
          })
        })
        inflight.set(key, refresh)
        void refresh.then(
          () => {
            inflight.delete(key)
          },
          () => {
            inflight.delete(key)
          },
        )
      }
      return cached.value
    }
    const existing = inflight.get(key) as Promise<T> | undefined
    if (existing) {
      return existing
    }
    const promise = new Promise<T>((resolve, reject) => {
      schedule({
        key,
        task: () =>
          runWithRetry({
            key,
            task,
            cacheTtlMs,
            cached,
            isRateLimit,
            getRateLimitMeta,
            maxRetries,
            baseDelayMs,
            meta,
          }),
        resolve,
        reject,
      })
    })
    inflight.set(key, promise)
    void promise.then(
      () => {
        inflight.delete(key)
      },
      () => {
        inflight.delete(key)
      },
    )
    return promise
  }

  const runWithRetry = async <T>({
    key,
    task,
    cacheTtlMs,
    cached,
    isRateLimit,
    getRateLimitMeta,
    maxRetries,
    baseDelayMs,
    meta,
  }: {
    key: string
    task: () => Promise<T>
    cacheTtlMs?: number
    cached?: CacheEntry<T>
    isRateLimit?: (value: T) => boolean
    getRateLimitMeta?: (value: T) => {
      upstreamStatus?: number
      upstreamCode?: string
      upstreamMessage?: string
    }
    maxRetries: number
    baseDelayMs: number
    meta?: KisRequestMeta
  }) => {
    function scheduleAttempt(attempt: number): Promise<T> {
      return new Promise((resolve, reject) => {
        schedule({
          key,
          task: () => runAttempt(attempt),
          resolve,
          reject,
        })
      })
    }

    async function runAttempt(attempt: number): Promise<T> {
      const startedAt = now()
      emit({ type: "start", key, meta, attempt })
      try {
        const value = await task()
        const durationMs = now() - startedAt
        if (isRateLimit?.(value)) {
          const jitter = random() * 80
          const retryAfterMs = calcRetryDelayMs(attempt, baseDelayMs, jitter)
          emit({ type: "rate_limit", key, meta, attempt, retryAfterMs })
          if (cached) {
            return cached.value
          }
          if (attempt >= maxRetries) {
            const metaInfo = getRateLimitMeta?.(value) ?? {}
            throw new KisRateLimitError({
              message: "EGW00201 rate limit",
              retryAfterMs,
              upstreamStatus: metaInfo.upstreamStatus,
              upstreamCode: metaInfo.upstreamCode,
              upstreamMessage: metaInfo.upstreamMessage,
            })
          }
          await sleep(retryAfterMs)
          return scheduleAttempt(attempt + 1)
        }
        if (cacheTtlMs) {
          cache.set(key, { value, expiresAt: now() + cacheTtlMs })
        }
        emit({ type: "end", key, meta, attempt, durationMs })
        return value
      } catch (error) {
        const isTransient = isTransientNetworkError(error)
        if (isTransient) {
          const jitter = random() * 80
          const retryAfterMs = calcRetryDelayMs(attempt, baseDelayMs, jitter)
          emit({ type: "retry", key, meta, attempt, retryAfterMs })
          if (attempt >= maxRetries) {
            if (cached) {
              return cached.value
            }
            emit({ type: "error", key, meta, attempt })
            throw error
          }
          await sleep(retryAfterMs)
          return scheduleAttempt(attempt + 1)
        }
        emit({ type: "error", key, meta, attempt })
        throw error
      }
    }

    return runAttempt(0)
  }

  return {
    request,
    clearCache: () => cache.clear(),
  }
}
