/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest"
import { createKisTokenManager } from "./kisToken"
import type { KisRequestOptions } from "./kisLimiter"

describe("createKisTokenManager", () => {
  it("caches token until refresh margin", async () => {
    let now = 0
    let calls = 0
    const fetchJson = vi.fn(async () => {
      calls += 1
      return {
        response: { ok: true } as Response,
        payload: { access_token: "t1", expires_in: 3600 },
      }
    })
    const kisClient = {
      request: async <T>(options: KisRequestOptions<T>) => options.task(),
    }
    const manager = createKisTokenManager({
      baseUrl: "https://example.test",
      appKey: "appKey",
      appSecret: "appSecret",
      kisClient,
      fetchJson,
      now: () => now,
      requestIdFactory: () => "rid",
    })

    await expect(manager.getToken({ requestId: "r1" })).resolves.toBe("t1")
    expect(calls).toBe(1)

    now = 1000
    await expect(manager.getToken({ requestId: "r2" })).resolves.toBe("t1")
    expect(calls).toBe(1)
  })

  it("refreshes when within margin", async () => {
    let now = 0
    let token = "t1"
    const fetchJson = vi.fn(async () => ({
      response: { ok: true } as Response,
      payload: { access_token: token, expires_in: 120 },
    }))
    const kisClient = {
      request: async <T>(options: KisRequestOptions<T>) => options.task(),
    }
    const manager = createKisTokenManager({
      baseUrl: "https://example.test",
      appKey: "appKey",
      appSecret: "appSecret",
      kisClient,
      fetchJson,
      now: () => now,
      requestIdFactory: () => "rid",
      refreshMarginMs: 60_000,
    })

    await expect(manager.getToken({ requestId: "r1" })).resolves.toBe("t1")
    expect(fetchJson).toHaveBeenCalledTimes(1)

    token = "t2"
    now = 70_000
    await expect(manager.getToken({ requestId: "r2" })).resolves.toBe("t2")
    expect(fetchJson).toHaveBeenCalledTimes(2)
  })

  it("dedupes inflight refresh calls", async () => {
    type FetchJsonResult = {
      response: Response
      payload: Record<string, unknown>
    }
    let resolveFetch!: (value: FetchJsonResult) => void
    const fetchJson = vi.fn(
      () =>
        new Promise<FetchJsonResult>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const requestMeta: unknown[] = []
    let calls = 0
    const kisClient = {
      request: async <T>(options: KisRequestOptions<T>) => {
        calls += 1
        requestMeta.push(options.meta)
        return options.task()
      },
    }
    const manager = createKisTokenManager({
      baseUrl: "https://example.test",
      appKey: "appKey",
      appSecret: "appSecret",
      kisClient,
      fetchJson: fetchJson as unknown as (
        url: string,
        options: unknown,
        timeoutMs: number,
      ) => Promise<{
        response: Response
        payload: Record<string, unknown>
      }>,
      requestIdFactory: () => "rid",
    })

    const first = manager.getToken({ requestId: "r1" })
    const second = manager.getToken({ requestId: "r2" })
    expect(calls).toBe(1)
    expect(fetchJson).toHaveBeenCalledTimes(1)
    expect(requestMeta[0]).toMatchObject({
      requestId: "r1",
      endpoint: "oauth2/tokenP",
    })

    resolveFetch({
      response: { ok: true } as Response,
      payload: { access_token: "t1", expires_in: 3600 },
    })

    await expect(first).resolves.toBe("t1")
    await expect(second).resolves.toBe("t1")
  })

  it("uses existing token when proactive refresh fails and token is still valid", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    let now = 0
    let ok = true
    const fetchJson = vi.fn(async () => {
      if (ok) {
        return {
          response: { ok: true } as Response,
          payload: { access_token: "t1", expires_in: 120 },
        }
      }
      return {
        response: { ok: false } as Response,
        payload: { msg1: "fail" },
      }
    })
    let calls = 0
    const kisClient = {
      request: async <T>(options: KisRequestOptions<T>) => {
        calls += 1
        return options.task()
      },
    }
    const manager = createKisTokenManager({
      baseUrl: "https://example.test",
      appKey: "appKey",
      appSecret: "appSecret",
      kisClient,
      fetchJson,
      now: () => now,
      requestIdFactory: () => "rid",
      refreshMarginMs: 60_000,
      maxFailureBackoffMs: 60_000,
    })

    await expect(manager.getToken({ requestId: "r1" })).resolves.toBe("t1")
    expect(calls).toBe(1)

    ok = false
    now = 70_000
    await expect(manager.getToken({ requestId: "r2" })).resolves.toBe("t1")
    expect(calls).toBe(2)

    await expect(manager.getToken({ requestId: "r3" })).resolves.toBe("t1")
    expect(calls).toBe(2)

    now = 130_000
    await expect(manager.getToken({ requestId: "r4" })).rejects.toThrow("fail")
    expect(calls).toBe(3)
  })
})
