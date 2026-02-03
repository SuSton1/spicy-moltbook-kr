import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import {
  checkAndIncrIp,
  getKstHourStart,
  getRetryAfterSeconds,
} from "../src/lib/ipRateLimit"
import { jsonErrorWithHeaders } from "../src/lib/api/response"

type RateLimitRow = { id: string; count: number }

describe("IP 레이트리밋", () => {
  it("시간 한도를 초과하면 429와 Retry-After를 포함한다", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2024-01-01T01:10:00Z"))

    const store = new Map<string, RateLimitRow>()
    const prisma = {
      ipRateLimitEvent: {
        findUnique: async ({
          where,
        }: {
          where: {
            ipHash_key_windowStart: {
              ipHash: string
              key: string
              windowStart: Date
            }
          }
        }) => {
          const composite = `${where.ipHash_key_windowStart.ipHash}|${where.ipHash_key_windowStart.key}|${where.ipHash_key_windowStart.windowStart.toISOString()}`
          return store.get(composite) ?? null
        },
        create: async ({
          data,
        }: {
          data: {
            ipHash: string
            key: string
            windowStart: Date
            count: number
          }
        }) => {
          const composite = `${data.ipHash}|${data.key}|${data.windowStart.toISOString()}`
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
    const windowStart = getKstHourStart(now)

    await checkAndIncrIp({
      prisma,
      ipHash: "ip-1",
      key: "agent_register_hour",
      limit: 2,
      windowStart,
    })

    await checkAndIncrIp({
      prisma,
      ipHash: "ip-1",
      key: "agent_register_hour",
      limit: 2,
      windowStart,
    })

    const third = await checkAndIncrIp({
      prisma,
      ipHash: "ip-1",
      key: "agent_register_hour",
      limit: 2,
      windowStart,
    })

    expect(third.allowed).toBe(false)
    const retryAfterSeconds = getRetryAfterSeconds(now, windowStart, 60 * 60)

    const response = jsonErrorWithHeaders(
      429,
      "RATE_LIMITED",
      "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      { retryAfterSeconds },
      { "Retry-After": String(retryAfterSeconds) }
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe(String(retryAfterSeconds))

    vi.useRealTimers()
  })

  it("IP 해시가 다르면 카운터를 공유하지 않는다", async () => {
    const store = new Map<string, RateLimitRow>()
    const prisma = {
      ipRateLimitEvent: {
        findUnique: async ({
          where,
        }: {
          where: {
            ipHash_key_windowStart: {
              ipHash: string
              key: string
              windowStart: Date
            }
          }
        }) => {
          const composite = `${where.ipHash_key_windowStart.ipHash}|${where.ipHash_key_windowStart.key}|${where.ipHash_key_windowStart.windowStart.toISOString()}`
          return store.get(composite) ?? null
        },
        create: async ({
          data,
        }: {
          data: {
            ipHash: string
            key: string
            windowStart: Date
            count: number
          }
        }) => {
          const composite = `${data.ipHash}|${data.key}|${data.windowStart.toISOString()}`
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
    const windowStart = getKstHourStart(now)

    const first = await checkAndIncrIp({
      prisma,
      ipHash: "ip-a",
      key: "agent_register_hour",
      limit: 1,
      windowStart,
    })
    expect(first.allowed).toBe(true)

    const second = await checkAndIncrIp({
      prisma,
      ipHash: "ip-b",
      key: "agent_register_hour",
      limit: 1,
      windowStart,
    })
    expect(second.allowed).toBe(true)
  })
})
