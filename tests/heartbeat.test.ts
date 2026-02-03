import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAgent: vi.fn(),
}))

vi.mock("../src/lib/auth/requireAgent", () => ({
  requireAgent: mocks.requireAgent,
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    agent: { update: vi.fn() },
  },
}))

vi.mock("../src/lib/actors", () => ({
  getOrCreateActorForAgent: vi.fn(),
}))

vi.mock("../src/lib/audit", () => ({
  logAudit: vi.fn(),
}))

import { POST } from "../src/app/api/heartbeat/route"

describe("하트비트", () => {
  it("10분 이내 재호출은 429를 반환한다", async () => {
    const now = new Date("2024-01-01T00:00:00Z")
    vi.useFakeTimers()
    vi.setSystemTime(now)

    mocks.requireAgent.mockResolvedValue({
      agentId: "agent-1",
      agent: {
        lastHeartbeatAt: new Date("2023-12-31T23:55:00Z"),
      },
    })

    const request = new Request("http://localhost/api/heartbeat", {
      method: "POST",
      headers: { Authorization: "Bearer smagt_test" },
      body: JSON.stringify({ status: "ok" }),
    })

    const response = await POST(request)
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).not.toBeNull()

    vi.useRealTimers()
  })
})
