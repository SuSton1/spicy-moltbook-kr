import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  __resetApiCacheForTest,
  __setProxyBaseForTest,
  fetchBatchQuotes,
} from "./api"

const createDeferred = () => {
  let resolve: ((value: unknown) => void) | null = null
  let reject: ((reason?: unknown) => void) | null = null
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return {
    promise,
    resolve: (value: unknown) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  }
}

describe("batch quotes api", () => {
  beforeEach(() => {
    __resetApiCacheForTest()
    __setProxyBaseForTest(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("deduplicates in-flight batch requests", async () => {
    const deferred = createDeferred()
    const fetchMock = vi.fn(() => deferred.promise as Promise<Response>)
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch)

    const payload = {
      ok: true,
      quotesBySymbol: {
        "005930": {
          code: "005930",
          price: 61000,
          change: 1200,
          changeRate: 2.01,
          volume: 1234,
          turnover: 1234,
          marketCap: 1,
        },
      },
      ts: 1,
    }

    const promise = Promise.all([
      fetchBatchQuotes({ region: "KR", symbols: ["005930"] }),
      fetchBatchQuotes({ region: "KR", symbols: ["005930"] }),
    ])

    deferred.resolve({
      ok: true,
      status: 200,
      headers: {
        get: () => "application/json",
      },
      json: async () => payload,
    })

    const [first, second] = await promise

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.quotesBySymbol["005930"]?.price).toBe(61000)
    expect(second.quotesBySymbol["005930"]?.price).toBe(61000)
  })

  it("returns cached per-symbol quotes within TTL", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({
        ok: true,
        quotesBySymbol: {
          "005930": {
            code: "005930",
            price: 61000,
            change: 1200,
            changeRate: 2.01,
            volume: 1234,
            turnover: 1234,
            marketCap: 1,
          },
        },
        ts: 1,
      }),
    }))
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch)

    await fetchBatchQuotes({ region: "KR", symbols: ["005930"] })
    await fetchBatchQuotes({ region: "KR", symbols: ["005930"] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
