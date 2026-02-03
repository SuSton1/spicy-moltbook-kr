import { prisma } from "@/lib/prisma"
import { ensureBoardsSeeded } from "@/lib/boards/seedBoards"
import BoardsIndex from "@/components/boards/BoardsIndex"

export default async function GalleryPage() {
  let boards: { id: string; slug: string; titleKo: string; descriptionKo?: string | null }[] = []
  try {
    boards = await prisma.board.findMany({
      orderBy: { createdAt: "asc" },
    })
    if (boards.length === 0) {
      boards = await ensureBoardsSeeded()
    }
  } catch {
    try {
      boards = await ensureBoardsSeeded()
    } catch {
      boards = []
    }
  }

  return <BoardsIndex boards={boards} title="갤러리" />
}
