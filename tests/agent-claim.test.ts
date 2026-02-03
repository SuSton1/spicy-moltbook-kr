import { beforeEach, describe, expect, it, vi } from "vitest"
import { jsonError } from "../src/lib/api/response"

const mocks = vi.hoisted(() => ({
  requireOnboardedUser: vi.fn(),
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  agentFind: vi.fn(),
  agentCreate: vi.fn(),
  claimUpdateMany: vi.fn(),
  claimCreate: vi.fn(),
  claimFind: vi.fn(),
  claimUpdate: vi.fn(),
  agentUpdate: vi.fn(),
  tokenCreate: vi.fn(),
}))

vi.mock("../src/lib/auth/requireUser", () => ({
  requireOnboardedUser: mocks.requireOnboardedUser,
}))

vi.mock("../src/lib/security/rateLimitDb", () => ({
  checkRateLimit: mocks.checkRateLimit,
}))

vi.mock("../src/lib/security/getClientIp", () => ({
  getClientIp: mocks.getClientIp,
}))

vi.mock("../src/lib/security/sameOrigin", () => ({
  requireSameOrigin: vi.fn(),
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    agent: {
      findUnique: mocks.agentFind,
      create: mocks.agentCreate,
      update: mocks.agentUpdate,
    },
    agentClaim: {
      updateMany: mocks.claimUpdateMany,
      create: mocks.claimCreate,
      findUnique: mocks.claimFind,
      update: mocks.claimUpdate,
    },
    agentToken: {
      create: mocks.tokenCreate,
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        agent: { update: mocks.agentUpdate },
        agentClaim: { update: mocks.claimUpdate },
        agentToken: { create: mocks.tokenCreate },
      }),
  },
}))

vi.mock("../src/lib/audit", () => ({
  logAudit: vi.fn(),
}))

import { POST as startClaim } from "../src/app/api/agents/claim/start/route"
import { POST as completeClaim } from "../src/app/api/agents/claim/complete/route"

describe("에이전트 클레임", () => {
  beforeEach(() => {
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
    mocks.checkRateLimit.mockResolvedValue({ ok: true, retryAfterSec: 0 })
    mocks.getClientIp.mockReturnValue({ ip: "127.0.0.1" })
    mocks.agentFind.mockResolvedValue(null)
    mocks.agentCreate.mockResolvedValue({ id: "agent-1", status: "ACTIVE" })
    mocks.claimUpdateMany.mockResolvedValue({})
    mocks.claimCreate.mockResolvedValue({})
    mocks.claimFind.mockResolvedValue(null)
    mocks.claimUpdate.mockResolvedValue({})
    mocks.agentUpdate.mockResolvedValue({})
    mocks.tokenCreate.mockResolvedValue({})
  })

  it("클레임 시작은 로그인 필요", async () => {
    mocks.requireOnboardedUser.mockRejectedValue(
      jsonError(401, "UNAUTHORIZED", "로그인이 필요합니다.")
    )
    const request = new Request("http://localhost/api/agents/claim/start", {
      method: "POST",
    })
    const response = await startClaim(request)
    expect(response.status).toBe(401)
  })

  it("클레임 시작은 코드와 만료 시간을 반환한다", async () => {
    const request = new Request("http://localhost/api/agents/claim/start", {
      method: "POST",
      headers: { Origin: "http://localhost" },
    })
    const response = await startClaim(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.claimCode).toMatch(/^smclm_/)
    expect(body.data.claimCodeMasked).toContain("****")
  })

  it("만료된 클레임은 400을 반환한다", async () => {
    const now = new Date("2024-01-01T00:00:00Z")
    vi.useFakeTimers()
    vi.setSystemTime(now)

    mocks.claimFind.mockResolvedValue({
      id: "claim-1",
      claimCodeHash: "hash",
      agentId: "agent-1",
      expiresAt: new Date("2023-12-31T23:00:00Z"),
      claimedAt: null,
      claimedByUserId: "user-1",
      agent: { ownerUserId: "user-1", status: "ACTIVE" },
    })

    const request = new Request("http://localhost/api/agents/claim/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimCode: "expired" }),
    })

    const response = await completeClaim(request)
    expect(response.status).toBe(400)

    vi.useRealTimers()
  })

  it("정상 클레임은 토큰을 반환하고 소비한다", async () => {
    mocks.claimFind.mockResolvedValue({
      id: "claim-2",
      claimCodeHash: "hash",
      agentId: "agent-2",
      expiresAt: new Date("2099-01-01T00:00:00Z"),
      claimedAt: null,
      claimedByUserId: "user-1",
      agent: { ownerUserId: "user-1", status: "ACTIVE" },
    })

    const request = new Request("http://localhost/api/agents/claim/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimCode: "ok" }),
    })

    const response = await completeClaim(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.token).toMatch(/^smagt_/)
    expect(mocks.tokenCreate).toHaveBeenCalled()
  })
})
