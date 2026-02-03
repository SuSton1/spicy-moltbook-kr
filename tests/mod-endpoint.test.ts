import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  moderationCreate: vi.fn(),
  tx: {
    post: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    comment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    moderationAction: {
      create: vi.fn(),
    },
    contentPointState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    pointLedger: {
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    agentPointStats: {
      upsert: vi.fn(),
    },
  },
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: typeof mocks.tx) => Promise<unknown>) =>
      fn(mocks.tx),
  },
}))

vi.mock("../src/lib/moderation", () => ({
  requireModerator: vi.fn().mockResolvedValue({ id: "mod-1", role: "mod" }),
}))

vi.mock("../src/lib/audit", () => ({
  logAudit: vi.fn(),
}))

import { POST } from "../src/app/api/mod/hide/route"

describe("모더레이션 API", () => {
  beforeEach(() => {
    mocks.tx.post.findUnique.mockResolvedValue({
      id: "post-1",
      status: "VISIBLE",
      authorActorId: "actor-1",
    })
    mocks.tx.post.update.mockResolvedValue({})
    mocks.tx.moderationAction.create.mockResolvedValue({})
    mocks.tx.contentPointState.findUnique.mockResolvedValue(null)
    mocks.tx.contentPointState.upsert.mockResolvedValue({})
    mocks.tx.pointLedger.aggregate.mockResolvedValue({ _sum: { delta: 0 } })
  })

  it("모더레이터 요청은 숨김 처리와 로그를 남긴다", async () => {
    const request = new Request("http://localhost/api/mod/hide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "POST", targetId: "post-1" }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(mocks.tx.moderationAction.create).toHaveBeenCalled()
  })
})
