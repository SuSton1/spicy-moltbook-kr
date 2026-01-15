import type { KisRequestMeta, KisRequestOptions } from "./kisLimiter"

type FetchOptions = {
  method: string
  headers?: Record<string, string>
  body?: string
}

type FetchJsonResult = {
  response: Response
  payload: Record<string, unknown>
}

type KisClient = {
  request: <T>(options: KisRequestOptions<T>) => Promise<T>
}

type TokenCache = {
  token: string
  expiresAt: number
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

const defaultRequestId = () => {
  const cryptoApi = globalThis.crypto as
    | { randomUUID?: () => string }
    | undefined
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID()
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export const createKisTokenManager = (options: {
  baseUrl: string
  appKey: string
  appSecret: string
  kisClient: KisClient
  fetchJson: (
    url: string,
    options: FetchOptions,
    timeoutMs: number,
  ) => Promise<FetchJsonResult>
  now?: () => number
  requestIdFactory?: () => string
  refreshMarginMs?: number
  maxFailureBackoffMs?: number
}) => {
  const now = options.now ?? Date.now
  const requestIdFactory = options.requestIdFactory ?? defaultRequestId
  const refreshMarginMs = Math.max(0, options.refreshMarginMs ?? 60_000)
  const maxFailureBackoffMs = Math.max(
    1000,
    options.maxFailureBackoffMs ?? 60_000,
  )

  let cache: TokenCache | null = null
  let inflight: Promise<string> | null = null
  let failureState: {
    failures: number
    nextAllowedAt: number
    message: string
  } | null = null

  const getToken = async (meta?: KisRequestMeta) => {
    const nowTs = now()
    const hasUsableToken = Boolean(cache && cache.expiresAt > nowTs)
    if (cache && hasUsableToken && cache.expiresAt - nowTs > refreshMarginMs) {
      return cache.token
    }
    if (inflight) {
      return inflight
    }
    if (failureState && failureState.nextAllowedAt > nowTs) {
      if (cache && hasUsableToken) {
        return cache.token
      }
      throw new Error(failureState.message)
    }
    const requestId = meta?.requestId ?? requestIdFactory()
    const key = `TOKEN:${options.baseUrl}`
    const previousToken = cache?.token ?? null
    const previousExpiresAt = cache?.expiresAt ?? 0
    inflight = options.kisClient
      .request({
        key,
        task: async () => {
          const { response, payload } = await options.fetchJson(
            `${options.baseUrl}/oauth2/tokenP`,
            {
              method: "POST",
              headers: { "content-type": "application/json; charset=UTF-8" },
              body: JSON.stringify({
                grant_type: "client_credentials",
                appkey: options.appKey,
                appsecret: options.appSecret,
              }),
            },
            9000,
          )
          if (!response.ok) {
            const message =
              readFirstString(payload, [
                "msg1",
                "error_description",
                "message",
              ]) || "KIS token error"
            throw new Error(message)
          }
          const tokenValue = payload.access_token
          if (!tokenValue || typeof tokenValue !== "string") {
            throw new Error("KIS token missing access_token")
          }
          const expiresIn = Number(payload.expires_in)
          const ttlMs =
            Number.isFinite(expiresIn) && expiresIn > 0
              ? expiresIn * 1000
              : 3600_000
          cache = { token: tokenValue, expiresAt: now() + ttlMs }
          failureState = null
          return tokenValue
        },
        maxRetries: 2,
        baseDelayMs: 250,
        meta: {
          ...meta,
          requestId,
          trId: "TOKEN",
          endpoint: "oauth2/tokenP",
        },
      })
      .finally(() => {
        inflight = null
      })

    try {
      return await inflight
    } catch (error) {
      const message = error instanceof Error ? error.message : "KIS token error"
      const prev = failureState
      const failures = (prev?.failures ?? 0) + 1
      const jitter = Math.random() * 120
      const delay = Math.min(
        maxFailureBackoffMs,
        Math.round(300 * 2 ** Math.min(failures, 6) + jitter),
      )
      failureState = { failures, nextAllowedAt: now() + delay, message }
      if (previousToken && previousExpiresAt > now()) {
        return previousToken
      }
      throw error
    }
  }

  return {
    getToken,
    clear: () => {
      cache = null
      inflight = null
      failureState = null
    },
  }
}
