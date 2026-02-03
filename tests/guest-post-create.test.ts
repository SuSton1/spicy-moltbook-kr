import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  prisma: {
    board: { findUnique: vi.fn() },
    post: { create: vi.fn() },
  },
  getSessionUser: vi.fn(),
  createGuestActor: vi.fn(),
  checkRateLimit: vi.fn(),
  enforceCooldown: vi.fn(),
  assertNotBanned: vi.fn(),
  detectUnsafeCategory: vi.fn(),
  hashPassword: vi.fn(),
  logAudit: vi.fn(),
  computeHotScore: vi.fn(),
  computeDiscussedScore: vi.fn(),
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: mocks.prisma,
}))

vi.mock("../src/lib/auth/requireUser", () => ({
  getSessionUser: mocks.getSessionUser,
}))

vi.mock("../src/lib/actors", () => ({
  createGuestActor: mocks.createGuestActor,
}))

vi.mock("../src/lib/security/rateLimitDb", () => ({
  checkRateLimit: mocks.checkRateLimit,
}))

vi.mock("../src/lib/security/cooldown", () => ({
  enforceCooldown: mocks.enforceCooldown,
}))

vi.mock("../src/lib/ban", () => ({
  assertNotBanned: mocks.assertNotBanned,
}))

vi.mock("../src/lib/safety", () => ({
  detectUnsafeCategory: mocks.detectUnsafeCategory,
  SAFETY_BLOCK_MESSAGE: "BLOCK",
}))

vi.mock("../src/lib/auth/password", () => ({
  hashPassword: mocks.hashPassword,
}))

vi.mock("../src/lib/audit", () => ({
  logAudit: mocks.logAudit,
}))

vi.mock("../src/lib/scores", () => ({
  computeHotScore: mocks.computeHotScore,
  computeDiscussedScore: mocks.computeDiscussedScore,
}))

import { POST } from "../src/app/api/boards/[slug]/posts/route"

describe("게스트 글 작성", () => {
  beforeEach(() => {
    mocks.getSessionUser.mockResolvedValue(null)
    mocks.prisma.board.findUnique.mockResolvedValue({
      id: "board-1",
      slug: "test",
      titleKo: "테스트",
    })
    mocks.createGuestActor.mockResolvedValue({ id: "actor-guest" })
    mocks.checkRateLimit.mockResolvedValue({ ok: true, retryAfterSec: 0 })
    mocks.enforceCooldown.mockResolvedValue({ ok: true, retryAfterSec: 0 })
    mocks.assertNotBanned.mockResolvedValue(null)
    mocks.detectUnsafeCategory.mockReturnValue({ ok: true, categories: [] })
    mocks.computeHotScore.mockReturnValue(0)
    mocks.computeDiscussedScore.mockReturnValue(0)
    mocks.hashPassword.mockResolvedValue("hashed-password")
    mocks.prisma.post.create.mockResolvedValue({ id: "post-1" })
  })

  it("비밀번호가 없으면 PASSWORD_REQUIRED를 반환한다", async () => {
    const request = new Request("http://localhost/api/boards/test/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "제목",
        body: "내용",
        guestNickname: "게스트",
      }),
    })
    const response = await POST(request, {
      params: Promise.resolve({ slug: "test" }),
    })
    const body = await response.json()
    expect(response.status).toBe(422)
    expect(body.error.code).toBe("PASSWORD_REQUIRED")
  })

  it("게스트 작성은 해시만 저장한다", async () => {
    const request = new Request("http://localhost/api/boards/test/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "제목",
        body: "내용",
        guestNickname: "게스트",
        guestPassword: "secret",
      }),
    })
    const response = await POST(request, {
      params: Promise.resolve({ slug: "test" }),
    })
    expect(response.status).toBe(200)
    const call = mocks.prisma.post.create.mock.calls[0][0]
    expect(call.data.guestPwHash).toBe("hashed-password")
    expect(call.data.guestPwHash).not.toBe("secret")
    expect(call.data.authorType).toBe("guest")
    expect(call.data.displayName).toBe("게스트")
  })
})
