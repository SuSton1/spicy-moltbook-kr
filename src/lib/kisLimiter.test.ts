import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createKisClient,
  isRateLimitPayload,
  KisRateLimitError,
} from "./kisLimiter"

describe("kis limiter", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("deduplicates in-flight requests by key", async () => {
    const client = createKisClient({ rps: 10, burst: 2, random: () => 0 })
    let calls = 0
    const task = async () => {
      calls += 1
      return { ok: true }
    }
    const [first, second] = await Promise.all([
      client.request({ key: "same", task }),
      client.request({ key: "same", task }),
    ])
    expect(calls).toBe(1)
    expect(first).toEqual(second)
  })

  it("spaces requests according to rps limit", async () => {
    const client = createKisClient({ rps: 1, burst: 1, random: () => 0 })
    const starts: number[] = []
    const task = async () => {
      starts.push(Date.now())
      return { ok: true }
    }
    const first = client.request({ key: "a", task })
    const second = client.request({ key: "b", task })
    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all([first, second])
    expect(starts).toHaveLength(2)
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000)
  })

  it("returns cached value on rate limit when stale is available", async () => {
    const client = createKisClient({ rps: 5, burst: 2, random: () => 0 })
    let calls = 0
    const cachedValue = { ok: true, id: "cached" }
    await client.request({
      key: "chart",
      task: async () => {
        calls += 1
        return cachedValue
      },
      cacheTtlMs: 10,
    })
    await vi.advanceTimersByTimeAsync(20)
    const result = await client.request({
      key: "chart",
      task: async () => {
        calls += 1
        return { ok: false, payload: { msg_cd: "EGW00201" } }
      },
      cacheTtlMs: 10,
      isRateLimit: () => true,
      maxRetries: 0,
    })
    expect(result).toEqual(cachedValue)
    expect(calls).toBe(2)
  })

  it("throws a rate limit error when no cache is available", async () => {
    vi.useRealTimers()
    const client = createKisClient({ rps: 5, burst: 1, random: () => 0 })
    const task = async () => ({ ok: false, payload: { msg_cd: "EGW00201" } })
    const promise = client.request({
      key: "limit",
      task,
      isRateLimit: () => true,
      maxRetries: 0,
      baseDelayMs: 0,
    })
    await expect(promise).rejects.toBeInstanceOf(KisRateLimitError)
  })

  it("retries transient errors with exponential backoff", async () => {
    const client = createKisClient({ rps: 50, burst: 10, random: () => 0 })
    const starts: number[] = []
    let failures = 0
    const task = async () => {
      starts.push(Date.now())
      if (failures < 2) {
        failures += 1
        const error = new Error("other side closed") as Error & {
          code?: string
        }
        error.code = "UND_ERR_SOCKET"
        throw error
      }
      return { ok: true }
    }
    const promise = client.request({
      key: "transient",
      task,
      maxRetries: 2,
      baseDelayMs: 100,
    })
    const assertion = expect(promise).resolves.toEqual({ ok: true })
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(starts).toHaveLength(3)
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(100)
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(200)
  })

  it("caps transient retries when no cache exists", async () => {
    const client = createKisClient({ rps: 50, burst: 10, random: () => 0 })
    let calls = 0
    const task = async () => {
      calls += 1
      const error = new Error("socket hang up") as Error & { code?: string }
      error.code = "ECONNRESET"
      throw error
    }
    const promise = client.request({
      key: "transient-fail",
      task,
      maxRetries: 1,
      baseDelayMs: 50,
    })
    const assertion = expect(promise).rejects.toBeInstanceOf(Error)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(calls).toBe(2)
  })
})

describe("rate limit payload detection", () => {
  it("detects EGW00201 code", () => {
    expect(isRateLimitPayload({ msg_cd: "EGW00201" })).toBe(true)
  })
})
