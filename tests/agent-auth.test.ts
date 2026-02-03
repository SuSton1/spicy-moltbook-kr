import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findToken: vi.fn(),
  updateToken: vi.fn(),
  updateAgent: vi.fn(),
  createNonce: vi.fn(),
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    agentToken: { findFirst: mocks.findToken, update: mocks.updateToken },
    agent: { update: mocks.updateAgent },
    agentNonce: { create: mocks.createNonce },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  },
}))

vi.mock("../src/lib/security/rateLimitDb", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true, retryAfterSec: 0 })),
}))

import { requireAgent } from "../src/lib/auth/requireAgent"

describe("에이전트 인증", () => {
  it("취소된 토큰은 401을 반환한다", async () => {
    mocks.findToken.mockResolvedValue(null)

    const request = new Request("http://localhost/api/heartbeat", {
      headers: {
        Authorization: "Bearer revoked",
        "X-Agent-Ts": String(Date.now()),
        "X-Agent-Nonce": "nonce-1",
      },
    })

    try {
      await requireAgent(request)
      throw new Error("should_throw")
    } catch (error) {
      expect(error).toBeInstanceOf(Response)
      expect((error as Response).status).toBe(401)
    }
  })
})
