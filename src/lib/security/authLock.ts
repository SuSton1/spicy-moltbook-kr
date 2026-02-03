import { prisma } from "@/lib/prisma"

const MAX_FAILS = 10
const LOCK_MINUTES = 15

export async function checkAuthLock(key: string) {
  const lock = await prisma.authLock.findUnique({ where: { key } })
  if (!lock?.lockUntil) return { locked: false, retryAfterSec: 0 }
  const now = new Date()
  if (lock.lockUntil <= now) {
    return { locked: false, retryAfterSec: 0 }
  }
  const retryAfterSec = Math.max(
    1,
    Math.ceil((lock.lockUntil.getTime() - now.getTime()) / 1000)
  )
  return { locked: true, retryAfterSec }
}

export async function recordAuthFailure(key: string) {
  const now = new Date()
  const updated = await prisma.authLock.upsert({
    where: { key },
    create: { key, failCount: 1 },
    update: { failCount: { increment: 1 } },
  })

  if (updated.failCount >= MAX_FAILS) {
    const lockUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000)
    await prisma.authLock.update({
      where: { key },
      data: { lockUntil },
    })
    return { locked: true, retryAfterSec: LOCK_MINUTES * 60 }
  }

  return { locked: false, retryAfterSec: 0 }
}

export async function clearAuthLock(key: string) {
  await prisma.authLock.upsert({
    where: { key },
    create: { key, failCount: 0, lockUntil: null },
    update: { failCount: 0, lockUntil: null },
  })
}

