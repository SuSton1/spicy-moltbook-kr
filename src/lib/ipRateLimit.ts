import crypto from "node:crypto"
import { Prisma } from "@prisma/client"
import type { PrismaClient } from "@prisma/client"
import { KST_OFFSET_MINUTES } from "@/lib/ratelimit"

export function getIpFromRequest(request: Request) {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim()
  if (cfIp) return cfIp
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp
  return "unknown"
}

export function hashIp(ip: string, salt: string) {
  return crypto
    .createHash("sha256")
    .update(`${ip}|${salt}`)
    .digest("hex")
}

export function getKstHourStart(now: Date) {
  const offsetMs = KST_OFFSET_MINUTES * 60 * 1000
  const kstMs = now.getTime() + offsetMs
  const kstDate = new Date(kstMs)
  const startUtcMs =
    Date.UTC(
      kstDate.getUTCFullYear(),
      kstDate.getUTCMonth(),
      kstDate.getUTCDate(),
      kstDate.getUTCHours()
    ) -
    offsetMs
  return new Date(startUtcMs)
}

export function getRetryAfterSeconds(
  now: Date,
  windowStart: Date,
  windowSeconds: number
) {
  const windowEnd = windowStart.getTime() + windowSeconds * 1000
  return Math.max(0, Math.ceil((windowEnd - now.getTime()) / 1000))
}

export async function checkAndIncrIp({
  prisma,
  ipHash,
  key,
  limit,
  windowStart,
}: {
  prisma: PrismaClient
  ipHash: string
  key: string
  limit: number
  windowStart: Date
}) {
  if (process.env.E2E_TEST === "1") {
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
    }
  }
  const isMissingTable = (error: unknown) =>
    process.env.E2E_TEST === "1" &&
    (error instanceof Prisma.PrismaClientKnownRequestError ||
      (typeof error === "object" &&
        error !== null &&
        "code" in error)) &&
    (error as { code?: string }).code === "P2021"
  let existing = null as { id: string; count: number } | null
  try {
    existing = await prisma.ipRateLimitEvent.findUnique({
      where: {
        ipHash_key_windowStart: {
          ipHash,
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
      }
    }
    throw error
  }

  if (!existing) {
    try {
      await prisma.ipRateLimitEvent.create({
        data: {
          ipHash,
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
        }
      }
      throw error
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
    }
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
    }
  }

  let updated = existing
  try {
    updated = await prisma.ipRateLimitEvent.update({
      where: { id: existing.id },
      data: { count: { increment: 1 } },
    })
  } catch (error) {
    if (isMissingTable(error)) {
      return {
        allowed: true,
        remaining: Math.max(0, limit - (existing.count + 1)),
      }
    }
    throw error
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - updated.count),
  }
}
