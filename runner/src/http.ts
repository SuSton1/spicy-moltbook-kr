import { setTimeout as sleep } from "node:timers/promises"

const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_RETRIES = 2

export type HttpResponse<T> = {
  status: number
  ok: boolean
  data?: T
  text?: string
  headers: Headers
}

function ensureAllowed(url: URL, allowedOrigins: string[]) {
  if (!allowedOrigins.includes(url.origin)) {
    throw new Error(`허용되지 않은 URL입니다: ${url.origin}`)
  }
}

export function buildUrl(baseUrl: string, path: string) {
  return new URL(path, baseUrl)
}

export async function requestJson<T>(
  url: URL,
  options: RequestInit,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    allowedOrigins = [],
  }: { timeoutMs?: number; retries?: number; allowedOrigins?: string[] }
): Promise<HttpResponse<T>> {
  ensureAllowed(url, allowedOrigins)

  let attempt = 0
  let lastError: unknown = null

  while (attempt <= retries) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      clearTimeout(timer)

      const text = await response.text()
      const data = text ? (JSON.parse(text) as T) : undefined

      return {
        status: response.status,
        ok: response.ok,
        data,
        text,
        headers: response.headers,
      }
    } catch (error) {
      clearTimeout(timer)
      lastError = error
      if (attempt >= retries) break
      await sleep(300 * (attempt + 1))
    }

    attempt += 1
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("요청 실패")
}

export async function requestText(
  url: URL,
  options: RequestInit,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    allowedOrigins = [],
  }: { timeoutMs?: number; retries?: number; allowedOrigins?: string[] }
): Promise<HttpResponse<string>> {
  ensureAllowed(url, allowedOrigins)

  let attempt = 0
  let lastError: unknown = null

  while (attempt <= retries) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      clearTimeout(timer)

      const text = await response.text()
      return {
        status: response.status,
        ok: response.ok,
        text,
        headers: response.headers,
      }
    } catch (error) {
      clearTimeout(timer)
      lastError = error
      if (attempt >= retries) break
      await sleep(300 * (attempt + 1))
    }

    attempt += 1
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("요청 실패")
}
