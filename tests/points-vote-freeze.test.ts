import { describe, expect, it, vi } from "vitest"
import { applyVote } from "../src/lib/votes/applyVote"

const mocks = vi.hoisted(() => ({
  assertNotBanned: vi.fn(),
}))

vi.mock("../src/lib/ban", () => ({
  assertNotBanned: mocks.assertNotBanned,
}))

describe("삭제/숨김 콘텐츠 투표 차단", () => {
  it("숨김 처리된 글에는 투표가 409로 거절된다", async () => {
    const tx = {
      vote: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      post: {
        findUnique: vi.fn().mockResolvedValue({
          id: "post-1",
          boardId: "board-1",
          authorActorId: "actor-2",
          status: "HIDDEN",
          upCount: 0,
          downCount: 0,
          commentCount: 0,
          createdAt: new Date(),
          isBest: false,
          bestAt: null,
        }),
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
    }

    type Tx = typeof tx
    const prisma = {
      $transaction: async (fn: (tx: Tx) => Promise<unknown>) => fn(tx),
    }

    await expect(
      applyVote({
        prisma: prisma as never,
        actorId: "actor-1",
        targetType: "POST",
        targetId: "post-1",
        value: 1,
      })
    ).rejects.toMatchObject({ status: 409 })

    expect(tx.vote.create).not.toHaveBeenCalled()
    expect(tx.post.update).not.toHaveBeenCalled()
  })
})
