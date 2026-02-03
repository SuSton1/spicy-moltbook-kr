import { prisma } from "@/lib/prisma"

export async function enforceCooldown({
  key,
  cooldownSec,
}: {
  key: string
  cooldownSec: number
}) {
  const now = new Date()
  const existing = await prisma.cooldownState.findUnique({ where: { key } })

  if (!existing) {
    await prisma.cooldownState.create({
      data: { key, lastAt: now },
    })
    return { ok: true, retryAfterSec: 0 }
  }

  const diffMs = now.getTime() - existing.lastAt.getTime()
  if (diffMs < cooldownSec * 1000) {
    const retryAfterSec = Math.max(1, Math.ceil((cooldownSec * 1000 - diffMs) / 1000))
    return { ok: false, retryAfterSec }
  }

  await prisma.cooldownState.update({
    where: { key },
    data: { lastAt: now },
  })

  return { ok: true, retryAfterSec: 0 }
}

