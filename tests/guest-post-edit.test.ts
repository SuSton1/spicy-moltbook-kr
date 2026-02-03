import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolvePostByKey: vi.fn(),
  getSessionUser: vi.fn(),
  verifyPassword: vi.fn(),
  recordPasswordFailure: vi.fn(),
  getClientIp: vi.fn(),
  logAudit: vi.fn(),
  prisma: {
    post: { update: vi.fn() },
  },
}))

vi.mock("../src/lib/posts/resolvePostByKey", () => ({
  resolvePostByKey: mocks.resolvePostByKey,
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

import { PATCH } from "../src/app/api/posts/[key]/route"

describe("게스트 글 수정", () => {
  beforeEach(() => {
    mocks.getSessionUser.mockResolvedValue(null)
    mocks.resolvePostByKey.mockResolvedValue({
      key: "post-1",
      lookup: "id:string",
      post: {
        id: "post-1",
        status: "VISIBLE",
        authorActorId: "actor-guest",
        authorType: "guest",
        guestPwHash: "hash",
        authorActor: {
          userId: null,
          agentId: null,
          guestPasswordHash: "hash",
        },
      },
    })
    mocks.getClientIp.mockReturnValue({ ip: "127.0.0.1" })
    mocks.recordPasswordFailure.mockResolvedValue({
      ok: true,
      retryAfterSec: 0,
    })
    mocks.prisma.post.update.mockResolvedValue({})
  })

  it("비밀번호가 틀리면 PASSWORD_INVALID를 반환한다", async () => {
    mocks.verifyPassword.mockResolvedValue(false)
    const request = new Request("http://localhost/api/posts/post-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "수정",
        body: "내용",
        guestPassword: "wrong",
      }),
    })
    const response = await PATCH(request, {
      params: Promise.resolve({ key: "post-1" }),
    })
    const body = await response.json()
    expect(response.status).toBe(403)
    expect(body.error.code).toBe("PASSWORD_INVALID")
  })

  it("비밀번호가 맞으면 editedAt을 설정한다", async () => {
    mocks.verifyPassword.mockResolvedValue(true)
    const request = new Request("http://localhost/api/posts/post-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "수정",
        body: "내용",
        guestPassword: "correct",
      }),
    })
    const response = await PATCH(request, {
      params: Promise.resolve({ key: "post-1" }),
    })
    expect(response.status).toBe(200)
    const call = mocks.prisma.post.update.mock.calls[0][0]
    expect(call.data.editedAt).toBeInstanceOf(Date)
  })
})
