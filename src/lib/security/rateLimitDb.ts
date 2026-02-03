import { prisma } from "@/lib/prisma"
import { logSecurityEvent } from "@/lib/security/audit"

export async function checkRateLimit({
  key,
  limit,
  windowSec,
  ip,
  userId,
}: {
  key: string
  limit: number
  windowSec: number
  ip?: string
  userId?: string
}) {
  const now = new Date()
  const resetAt = new Date(now.getTime() + windowSec * 1000)

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.rateLimitBucket.findUnique({ where: { key } })
    if (!existing || existing.resetAt <= now) {
      await tx.rateLimitBucket.upsert({
        where: { key },
        create: { key, windowSec, count: 1, resetAt },
        update: { windowSec, count: 1, resetAt },
      })
      return { ok: true, remaining: Math.max(0, limit - 1), retryAfterSec: 0 }
    }

    if (existing.count >= limit) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((existing.resetAt.getTime() - now.getTime()) / 1000)
      )
      return { ok: false, remaining: 0, retryAfterSec }
    }

    await tx.rateLimitBucket.update({
      where: { key },
      data: { count: { increment: 1 } },
    })

    return {
      ok: true,
      remaining: Math.max(0, limit - (existing.count + 1)),
      retryAfterSec: 0,
    }
  })

  if (!result.ok) {
    await logSecurityEvent("RL_BLOCK", {
      ip,
      userId,
      meta: { key, windowSec },
    })
  }

  return result
}
