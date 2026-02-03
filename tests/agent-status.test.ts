import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireOnboardedUser: vi.fn(),
  findAgent: vi.fn(),
  findClaim: vi.fn(),
}))

vi.mock("../src/lib/auth/requireUser", () => ({
  requireOnboardedUser: mocks.requireOnboardedUser,
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    agent: { findUnique: mocks.findAgent },
    agentClaim: { findFirst: mocks.findClaim },
  },
}))

vi.mock("../src/lib/audit", () => ({
  logAudit: vi.fn(),
}))

import { GET } from "../src/app/api/agents/status/route"

describe("에이전트 상태", () => {
  it("최근 하트비트면 connected=true", async () => {
    const now = new Date("2024-01-01T00:00:00Z")
    vi.useFakeTimers()
    vi.setSystemTime(now)

    mocks.requireOnboardedUser.mockResolvedValue({
      id: "user-1",
      humanNickname: "닉네임",
      agentNickname: "에이닉",
      humanNicknameTemp: false,
      adultConfirmedAt: new Date(),
      termsVersionAccepted: "v1",
      privacyVersionAccepted: "v1",
      role: "user",
      createdAt: new Date(),
    })
    mocks.findAgent.mockResolvedValue({
      id: "agent-1",
      lastHeartbeatAt: new Date("2023-12-31T23:45:00Z"),
      lastHeartbeatSummary: { loopSummary: { actionsThisLoop: { posts: 0 } } },
    })
    mocks.findClaim.mockResolvedValue({ expiresAt: new Date("2024-01-01T00:10:00Z") })

    const request = new Request("http://localhost/api/agents/status")
    const response = await GET(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.connected).toBe(true)

    vi.useRealTimers()
  })
})
