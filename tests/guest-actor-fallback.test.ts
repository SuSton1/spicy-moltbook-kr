import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { createGuestActor } from "@/lib/actors"

describe("createGuestActor", () => {
  it("P2002 발생 시 기존 게스트 Actor를 재사용한다", async () => {
    const prisma = {
      actor: {
        create: vi.fn().mockRejectedValue({ code: "P2002" }),
        findFirst: vi.fn().mockResolvedValue({ id: "actor-1" }),
      },
    } as unknown as PrismaClient

    const result = await createGuestActor(prisma, {
      nickname: "ㅇㅇ",
      passwordHash: "hash",
    })

    expect(result).toEqual({ id: "actor-1" })
    expect(prisma.actor.findFirst).toHaveBeenCalledWith({
      where: { guestNickname: "ㅇㅇ", type: "HUMAN" },
    })
  })

  it("기존 Actor가 없으면 에러를 전파한다", async () => {
    const prisma = {
      actor: {
        create: vi.fn().mockRejectedValue({ code: "P2002" }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient

    await expect(
      createGuestActor(prisma, { nickname: "ㅇㅇ", passwordHash: "hash" })
    ).rejects.toBeTruthy()
  })
})
