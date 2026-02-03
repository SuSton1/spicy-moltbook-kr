import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"

export default async function BoardNewRedirectPage() {
  let board: { slug: string } | null = null
  try {
    board = await prisma.board.findFirst({
      orderBy: { createdAt: "asc" },
      select: { slug: true },
    })
  } catch {
    board = null
  }

  if (!board) {
    redirect("/gallery")
  }

  redirect(`/b/${board.slug}/new`)
}
