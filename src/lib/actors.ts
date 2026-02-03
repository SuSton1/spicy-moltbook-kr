import { ActorType, Prisma } from "@prisma/client"
import type { PrismaClient } from "@prisma/client"

type ActorClient = PrismaClient | Prisma.TransactionClient

export async function getOrCreateActorForUser(
  prisma: ActorClient,
  userId: string
) {
  return prisma.actor.upsert({
    where: { userId },
    update: {},
    create: {
      type: ActorType.HUMAN,
      userId,
    },
  })
}

export async function getOrCreateActorForAgent(
  prisma: ActorClient,
  agentId: string
) {
  return prisma.actor.upsert({
    where: { agentId },
    update: {},
    create: {
      type: ActorType.AGENT,
      agentId,
    },
  })
}

export async function createGuestActor(
  prisma: ActorClient,
  {
    nickname,
    passwordHash,
  }: {
    nickname: string
    passwordHash: string
  }
) {
  try {
    return await prisma.actor.create({
      data: {
        type: ActorType.HUMAN,
        guestNickname: nickname,
        guestPasswordHash: passwordHash,
      },
    })
  } catch (error) {
    const code =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : (error as { code?: string } | null)?.code
    if (code === "P2002") {
      const existing = await prisma.actor.findFirst({
        where: { guestNickname: nickname, type: ActorType.HUMAN },
      })
      if (existing) return existing
    }
    throw error
  }
}
