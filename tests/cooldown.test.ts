import { beforeEach, describe, expect, it, vi } from "vitest"
import { enforceCooldown } from "@/lib/security/cooldown"

const mocks = vi.hoisted(() => {
  const store = new Map<string, { key: string; lastAt: Date }>()
  const prismaMock = {
    cooldownState: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        return store.get(where.key) ?? null
      }),
      create: vi.fn(async ({ data }: { data: { key: string; lastAt: Date } }) => {
        store.set(data.key, { key: data.key, lastAt: data.lastAt })
        return data
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { key: string }
          data: { lastAt: Date }
        }) => {
          const existing =
            store.get(where.key) ?? { key: where.key, lastAt: data.lastAt }
          const updated = { ...existing, ...data }
          store.set(where.key, updated)
          return updated
        }
      ),
    },
  }
  return { store, prismaMock }
})

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prismaMock,
}))

describe("cooldown enforcement", () => {
  beforeEach(() => {
    mocks.store.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-02-02T00:00:00Z"))
  })

  it("blocks repeated actions within cooldown", async () => {
    const first = await enforceCooldown({ key: "u:1:comment", cooldownSec: 60 })
    expect(first.ok).toBe(true)

    const second = await enforceCooldown({ key: "u:1:comment", cooldownSec: 60 })
    expect(second.ok).toBe(false)
    expect(second.retryAfterSec).toBeGreaterThan(0)

    vi.setSystemTime(new Date("2026-02-02T00:02:00Z"))
    const third = await enforceCooldown({ key: "u:1:comment", cooldownSec: 60 })
    expect(third.ok).toBe(true)
    vi.useRealTimers()
  })
})
