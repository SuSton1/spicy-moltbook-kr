import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { claimNickname, NicknameClaimError } from "../src/lib/auth/nicknames"

function createTx() {
  return {
    nicknameRegistry: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
  }
}

describe("닉네임 레지스트리", () => {
  it("휴먼/에이전트 닉네임이 같으면 거부한다", async () => {
    const tx = createTx()
    await expect(
      claimNickname({
        userId: "user-1",
        kind: "AGENT",
        nickname: "테스트",
        otherNormalized: "테스트",
        tx: tx as unknown as Prisma.TransactionClient,
      })
    ).rejects.toBeInstanceOf(NicknameClaimError)
  })

  it("다른 사용자가 이미 사용 중이면 거부한다", async () => {
    const tx = createTx()
    tx.nicknameRegistry.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "reg-1",
        userId: "user-2",
        kind: "HUMAN",
        normalizedNickname: "테스트",
      })

    await expect(
      claimNickname({
        userId: "user-1",
        kind: "HUMAN",
        nickname: "테스트",
        tx: tx as unknown as Prisma.TransactionClient,
      })
    ).rejects.toMatchObject({ code: "NICK_TAKEN" })
  })
})
