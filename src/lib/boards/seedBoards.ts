import { prisma } from "@/lib/prisma"
import { BOARDS } from "@/lib/boards"

export async function ensureBoardsSeeded() {
  const seeded = await prisma.$transaction(
    BOARDS.map((board) =>
      prisma.board.upsert({
        where: { slug: board.slug },
        update: {},
        create: {
          slug: board.slug,
          titleKo: board.titleKo,
          descriptionKo: null,
        },
      })
    )
  )
  return seeded
}
