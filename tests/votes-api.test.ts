import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireOnboardedUser: vi.fn(),
  getOrCreateActorForUser: vi.fn(),
  checkAndIncr: vi.fn(),
  assertNotBanned: vi.fn(),
  logAudit: vi.fn(),
  tx: {
    vote: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    post: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    comment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pointLedger: {
      create: vi.fn(),
    },
    agentPointStats: {
      upsert: vi.fn(),
    },
  },
}))

vi.mock("../src/lib/auth/requireUser", () => ({
  requireOnboardedUser: mocks.requireOnboardedUser,
}))

vi.mock("../src/lib/actors", () => ({
  getOrCreateActorForUser: mocks.getOrCreateActorForUser,
}))

vi.mock("../src/lib/ratelimit", () => ({
  checkAndIncr: mocks.checkAndIncr,
  getHumanDailyLimit: () => 999,
  getKstDayStart: () => new Date("2024-01-01T00:00:00Z"),
}))

vi.mock("../src/lib/ban", () => ({
  assertNotBanned: mocks.assertNotBanned,
}))

vi.mock("../src/lib/audit", () => ({
  logAudit: mocks.logAudit,
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: typeof mocks.tx) => Promise<unknown>) =>
      fn(mocks.tx),
  },
}))

import { POST } from "../src/app/api/votes/route"

describe("투표 API", () => {
  beforeEach(() => {
    mocks.requireOnboardedUser.mockResolvedValue({
      id: "user-1",
      createdAt: new Date(),
    })
    mocks.getOrCreateActorForUser.mockResolvedValue({ id: "actor-1" })
    mocks.checkAndIncr.mockResolvedValue({
      allowed: true,
      remaining: 1,
      retryAfterSeconds: null,
    })
    mocks.tx.vote.findUnique.mockResolvedValue(null)
    mocks.tx.vote.create.mockResolvedValue({})
    mocks.tx.vote.update.mockResolvedValue({})
    mocks.tx.post.findUnique.mockResolvedValue({
      id: "post-1",
      boardId: "board-1",
      authorActorId: "actor-2",
      status: "VISIBLE",
      upCount: 0,
      downCount: 0,
      commentCount: 0,
      createdAt: new Date(),
      isBest: false,
      bestAt: null,
    })
    mocks.tx.post.update.mockResolvedValue({})
  })

  it("사람 투표 요청은 정상 처리된다", async () => {
    const request = new Request("http://localhost/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "post",
        targetId: "post-1",
        value: 1,
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
  })
})
