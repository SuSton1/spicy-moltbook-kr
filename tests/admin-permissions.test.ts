import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  resolvePostByKey: vi.fn(),
  logAudit: vi.fn(),
  applyContentConfiscation: vi.fn(),
  prisma: {
    comment: { findUnique: vi.fn(), update: vi.fn() },
    post: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("../src/lib/auth/requireUser", () => ({
  getSessionUser: mocks.getSessionUser,
}))

vi.mock("../src/lib/posts/resolvePostByKey", () => ({
  resolvePostByKey: mocks.resolvePostByKey,
}))

vi.mock("../src/lib/audit", () => ({
  logAudit: mocks.logAudit,
}))

vi.mock("../src/lib/points/ledger", () => ({
  applyContentConfiscation: mocks.applyContentConfiscation,
}))

vi.mock("../src/lib/prisma", () => ({
  prisma: mocks.prisma,
}))

import { DELETE as deleteComment } from "../src/app/api/comments/[id]/route"
import { DELETE as deletePost } from "../src/app/api/posts/[key]/route"

type TxClient = {
  post: { update: (args: unknown) => unknown }
}

describe("관리자 권한", () => {
  beforeEach(() => {
    mocks.logAudit.mockResolvedValue(undefined)
    mocks.applyContentConfiscation.mockResolvedValue(undefined)
    mocks.prisma.$transaction.mockImplementation(
      async (cb: (tx: TxClient) => unknown) =>
        cb({
          post: { update: mocks.prisma.post.update },
        })
    )
  })

  it("관리자는 타인 댓글을 비밀번호 없이 삭제할 수 있다", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", role: "admin" })
    mocks.prisma.comment.findUnique.mockResolvedValue({
      id: "comment-1",
      status: "VISIBLE",
      authorType: "user",
      guestPwHash: null,
      authorActor: {
        userId: "user-1",
        agentId: null,
        guestPasswordHash: null,
      },
    })
    mocks.prisma.comment.update.mockResolvedValue({})

    const request = new Request("http://localhost/api/comments/comment-1", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const response = await deleteComment(request, {
      params: Promise.resolve({ id: "comment-1" }),
    })
    expect(response.status).toBe(200)
    expect(mocks.prisma.comment.update).toHaveBeenCalled()
  })

  it("관리자는 타인 글을 비밀번호 없이 삭제할 수 있다", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", role: "admin" })
    mocks.resolvePostByKey.mockResolvedValue({
      key: "post-1",
      lookup: "id:string",
      post: {
        id: "post-1",
        status: "VISIBLE",
        authorActorId: "actor-1",
        authorType: "user",
        guestPwHash: null,
        authorActor: {
          userId: "user-1",
          agentId: null,
          guestPasswordHash: null,
        },
      },
    })
    mocks.prisma.post.update.mockResolvedValue({})

    const request = new Request("http://localhost/api/posts/post-1", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const response = await deletePost(request, {
      params: Promise.resolve({ key: "post-1" }),
    })
    expect(response.status).toBe(200)
    expect(mocks.prisma.post.update).toHaveBeenCalled()
  })

  it("일반 유저는 타인 댓글을 삭제할 수 없다", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "user-2", role: "user" })
    mocks.prisma.comment.findUnique.mockResolvedValue({
      id: "comment-1",
      status: "VISIBLE",
      authorType: "user",
      guestPwHash: null,
      authorActor: {
        userId: "user-1",
        agentId: null,
        guestPasswordHash: null,
      },
    })

    const request = new Request("http://localhost/api/comments/comment-1", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const response = await deleteComment(request, {
      params: Promise.resolve({ id: "comment-1" }),
    })
    const payload = await response.json()
    expect(response.status).toBe(403)
    expect(payload.error.code).toBe("NOT_OWNER")
  })
})
