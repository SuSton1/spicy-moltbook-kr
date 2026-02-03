import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  verifyPassword: vi.fn(),
  recordPasswordFailure: vi.fn(),
  getClientIp: vi.fn(),
  logAudit: vi.fn(),
  prisma: {
    comment: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

vi.mock("../src/lib/auth/requireUser", () => ({
  getSessionUser: mocks.getSessionUser,
}))

vi.mock("../src/lib/auth/password", () => ({
  verifyPassword: mocks.verifyPassword,
}))

vi.mock("../src/lib/security/passwordGuard", () => ({
  recordPasswordFailure: mocks.recordPasswordFailure,
}))

vi.mock("../src/lib/security/getClientIp", () => ({
  getClientIp: mocks.getClientIp,
}))

vi.mock("../src/lib/audit", () => ({
  logAudit: mocks.logAudit,
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: mocks.prisma,
}))

import { DELETE } from "../src/app/api/comments/[id]/route"

describe("게스트 댓글 삭제", () => {
  beforeEach(() => {
    mocks.getSessionUser.mockResolvedValue(null)
    mocks.getClientIp.mockReturnValue({ ip: "127.0.0.1" })
    mocks.prisma.comment.findUnique.mockResolvedValue({
      id: "comment-1",
      status: "VISIBLE",
      guestPwHash: "hash",
      authorType: "guest",
      authorActor: {
        userId: null,
        agentId: null,
        guestPasswordHash: "hash",
      },
    })
    mocks.prisma.comment.update.mockResolvedValue({})
  })

  it("정상 삭제 시 deletedAt을 설정한다", async () => {
    mocks.verifyPassword.mockResolvedValue(true)
    const request = new Request("http://localhost/api/comments/comment-1", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestPassword: "pass" }),
    })
    const response = await DELETE(request, {
      params: Promise.resolve({ id: "comment-1" }),
    })
    expect(response.status).toBe(200)
    const call = mocks.prisma.comment.update.mock.calls[0][0]
    expect(call.data.status).toBe("DELETED")
    expect(call.data.deletedAt).toBeInstanceOf(Date)
  })

  it("비밀번호 반복 실패는 RATE_LIMITED가 된다", async () => {
    mocks.verifyPassword.mockResolvedValue(false)
    mocks.recordPasswordFailure.mockResolvedValue({
      ok: false,
      retryAfterSec: 120,
    })
    const request = new Request("http://localhost/api/comments/comment-1", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestPassword: "bad" }),
    })
    const response = await DELETE(request, {
      params: Promise.resolve({ id: "comment-1" }),
    })
    const body = await response.json()
    expect(response.status).toBe(429)
    expect(body.error.code).toBe("RATE_LIMITED")
  })
})
