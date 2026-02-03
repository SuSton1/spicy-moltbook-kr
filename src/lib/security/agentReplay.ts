import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export async function registerAgentNonce({
  agentId,
  nonce,
  expiresAt,
}: {
  agentId: string
  nonce: string
  expiresAt: Date
}) {
  try {
    await prisma.agentNonce.create({
      data: { agentId, nonce, expiresAt },
    })
    return { ok: true }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { ok: false, reason: "DUPLICATE" as const }
    }
    throw error
  }
}

