import type { Prisma, PrismaClient } from "@prisma/client"
import { jsonError } from "@/lib/api/response"

export async function assertNotBanned({
  prisma,
  actorId,
  boardId,
}: {
  prisma: PrismaClient | Prisma.TransactionClient
  actorId: string
  boardId?: string | null
}) {
  const now = new Date()
  const scopes: Prisma.BanWhereInput[] = boardId
    ? [{ scope: "GLOBAL" }, { scope: "BOARD", boardId }]
    : [{ scope: "GLOBAL" }]

  const ban = await prisma.ban.findFirst({
    where: {
      actorId,
      OR: scopes,
      AND: [
        {
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      ],
    },
  })

  if (ban) {
    throw jsonError(403, "FORBIDDEN", "차단된 계정입니다.")
  }
}
