import { prisma } from "@/lib/prisma"
import { jsonOk } from "@/lib/api/response"

export async function GET() {
  const boards = await prisma.board.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      slug: true,
      titleKo: true,
      descriptionKo: true,
    },
  })

  return jsonOk({ items: boards })
}
