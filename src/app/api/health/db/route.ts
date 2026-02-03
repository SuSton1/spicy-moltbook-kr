import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    // 존재하면 1개만 조회(없어도 OK)
    await prisma.user.findFirst({ select: { id: true } })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    )
  }
}
