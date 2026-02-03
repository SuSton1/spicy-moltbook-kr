import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { checkAndIncr, getKstDayStart } from "../src/lib/ratelimit"
import { jsonErrorWithHeaders } from "../src/lib/api/response"

type RateLimitRow = { id: string; count: number }

describe("레이트리밋", () => {
  it("일일 한도를 초과하면 429와 Retry-After를 포함한다", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2024-01-01T03:00:00Z"))

    const store = new Map<string, RateLimitRow>()
    const prisma = {
      rateLimitEvent: {
        findUnique: async ({
          where,
        }: {
          where: {
            actorId_key_windowStart: {
              actorId: string | null
              key: string
              windowStart: Date
            }
          }
        }) => {
          const composite = `${where.actorId_key_windowStart.actorId ?? "null"}|${where.actorId_key_windowStart.key}|${where.actorId_key_windowStart.windowStart.toISOString()}`
          return store.get(composite) ?? null
        },
        create: async ({
          data,
        }: {
          data: {
            actorId: string | null
            key: string
            windowStart: Date
            count: number
          }
        }) => {
          const composite = `${data.actorId ?? "null"}|${data.key}|${data.windowStart.toISOString()}`
          const row = { id: composite, count: data.count }
          store.set(composite, row)
          return row
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string }
          data: { count: { increment: number } }
        }) => {
          const row = store.get(where.id)
          if (!row) throw new Error("NOT_FOUND")
          row.count += data.count.increment
          return row
        },
      },
    } as unknown as PrismaClient

    const now = new Date()
    const windowStart = getKstDayStart(now)

    await checkAndIncr({
      prisma,
      actorId: "actor-1",
      key: "post_day",
      limit: 2,
      windowStart,
    })

    await checkAndIncr({
      prisma,
      actorId: "actor-1",
      key: "post_day",
      limit: 2,
      windowStart,
    })

    const third = await checkAndIncr({
      prisma,
      actorId: "actor-1",
      key: "post_day",
      limit: 2,
      windowStart,
    })

    expect(third.allowed).toBe(false)
    expect(third.retryAfterSeconds).not.toBeNull()

    const response = jsonErrorWithHeaders(
      429,
      "RATE_LIMITED",
      "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      { retryAfterSeconds: third.retryAfterSeconds ?? 0 },
      { "Retry-After": String(third.retryAfterSeconds ?? 0) }
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe(
      String(third.retryAfterSeconds ?? 0)
    )

    vi.useRealTimers()
  })
})
