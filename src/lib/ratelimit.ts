import { Prisma } from "@prisma/client"
import type { PrismaClient } from "@prisma/client"

export const KST_OFFSET_MINUTES = 9 * 60

export function getKstDayStart(now: Date) {
  const offsetMs = KST_OFFSET_MINUTES * 60 * 1000
  const kstMs = now.getTime() + offsetMs
  const kstDate = new Date(kstMs)
  const startUtcMs =
    Date.UTC(
      kstDate.getUTCFullYear(),
      kstDate.getUTCMonth(),
      kstDate.getUTCDate()
    ) -
    offsetMs
  return new Date(startUtcMs)
}

export function getRetryAfterSeconds(now: Date) {
  const nextDay = new Date(getKstDayStart(now).getTime() + 24 * 60 * 60 * 1000)
  return Math.max(0, Math.ceil((nextDay.getTime() - now.getTime()) / 1000))
}

export async function checkAndIncr({
  prisma,
  actorId,
  key,
  limit,
  windowStart,
}: {
  prisma: PrismaClient
  actorId: string
  key: string
  limit: number
  windowStart: Date
}) {
  const isMissingTable = (error: unknown) =>
    process.env.E2E_TEST === "1" &&
    (error instanceof Prisma.PrismaClientKnownRequestError ||
      (typeof error === "object" &&
        error !== null &&
        "code" in error)) &&
    (error as { code?: string }).code === "P2021"
  let existing = null as {
    id: string
    count: number
  } | null
  try {
    existing = await prisma.rateLimitEvent.findUnique({
      where: {
        actorId_key_windowStart: {
          actorId,
          key,
          windowStart,
        },
      },
    })
  } catch (error) {
    if (isMissingTable(error)) {
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        retryAfterSeconds: null,
      }
    }
    throw error
  }

  if (!existing) {
    try {
      await prisma.rateLimitEvent.create({
        data: {
          actorId,
          key,
          windowStart,
          count: 1,
        },
      })
    } catch (error) {
      if (isMissingTable(error)) {
        return {
          allowed: true,
          remaining: Math.max(0, limit - 1),
          retryAfterSeconds: null,
        }
      }
      throw error
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: null,
    }
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: getRetryAfterSeconds(new Date()),
    }
  }

  let updated = existing
  try {
    updated = await prisma.rateLimitEvent.update({
      where: { id: existing.id },
      data: { count: { increment: 1 } },
    })
  } catch (error) {
    if (isMissingTable(error)) {
      return {
        allowed: true,
        remaining: Math.max(0, limit - (existing.count + 1)),
        retryAfterSeconds: null,
      }
    }
    throw error
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - updated.count),
    retryAfterSeconds: null,
  }
}

export function getWindowStart(now: Date, windowSeconds: number) {
  const windowMs = windowSeconds * 1000
  const start = Math.floor(now.getTime() / windowMs) * windowMs
  return new Date(start)
}

export async function checkCooldown({
  prisma,
  actorId,
  key,
  windowSeconds,
}: {
  prisma: PrismaClient
  actorId: string
  key: string
  windowSeconds: number
}) {
  const now = new Date()
  const windowStart = getWindowStart(now, windowSeconds)
  const isMissingTable = (error: unknown) =>
    process.env.E2E_TEST === "1" &&
    (error instanceof Prisma.PrismaClientKnownRequestError ||
      (typeof error === "object" &&
        error !== null &&
        "code" in error)) &&
    (error as { code?: string }).code === "P2021"
  let existing = null as { id: string } | null
  try {
    existing = await prisma.rateLimitEvent.findUnique({
      where: {
        actorId_key_windowStart: {
          actorId,
          key,
          windowStart,
        },
      },
    })
  } catch (error) {
    if (isMissingTable(error)) {
      return { allowed: true, retryAfterSeconds: null }
    }
    throw error
  }

  if (existing) {
    const retryAfterSeconds = Math.max(
      0,
      Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now.getTime()) / 1000)
    )
    return { allowed: false, retryAfterSeconds }
  }

  try {
    await prisma.rateLimitEvent.create({
      data: {
        actorId,
        key,
        windowStart,
        count: 1,
      },
    })
  } catch (error) {
    if (isMissingTable(error)) {
      return { allowed: true, retryAfterSeconds: null }
    }
    throw error
  }

  return { allowed: true, retryAfterSeconds: null }
}

export function getHumanDailyLimit(key: string, isNewUser: boolean) {
  const newPostLimit = Number.parseInt(
    process.env.QUOTA_NEW_USER_POSTS_PER_DAY ?? "3",
    10
  )
  const newCommentLimit = Number.parseInt(
    process.env.QUOTA_NEW_USER_COMMENTS_PER_DAY ?? "15",
    10
  )
  const limits = {
    post_day: isNewUser
      ? Number.isFinite(newPostLimit)
        ? newPostLimit
        : 3
      : 10,
    comment_day: isNewUser
      ? Number.isFinite(newCommentLimit)
        ? newCommentLimit
        : 15
      : 200,
    vote_day: isNewUser ? 200 : 500,
  }

  return limits[key as keyof typeof limits] ?? (isNewUser ? 50 : 200)
}
