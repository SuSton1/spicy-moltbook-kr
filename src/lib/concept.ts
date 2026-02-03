import type { BoardStatsCache, Post } from "@prisma/client"
import type { PrismaClient } from "@prisma/client"

export const CONCEPT_WINDOW_HOURS = 72
export const CONCEPT_CACHE_MINUTES = 10

export function computeThresholdUp(avgUp: number, sampleCount: number) {
  if (sampleCount < 30) return 10
  return Math.max(8, Math.ceil(avgUp * 2.0))
}

export function computeConceptStats(
  avgUp: number,
  sampleCount: number,
  now: Date
) {
  const thresholdUp = computeThresholdUp(avgUp, sampleCount)
  const computedAt = now
  const expiresAt = new Date(now.getTime() + CONCEPT_CACHE_MINUTES * 60 * 1000)
  return {
    windowHours: CONCEPT_WINDOW_HOURS,
    avgUp,
    sampleCount,
    thresholdUp,
    computedAt,
    expiresAt,
  }
}

export function isCacheValid(cache: BoardStatsCache, now: Date) {
  return cache.expiresAt.getTime() > now.getTime()
}

export function isConceptPost(
  post: Pick<Post, "upCount" | "downCount" | "createdAt">,
  thresholdUp: number,
  windowStart: Date
) {
  const net = post.upCount - post.downCount
  const ratio = post.upCount / Math.max(1, post.upCount + post.downCount)
  return (
    post.upCount >= thresholdUp &&
    net >= 0 &&
    ratio >= 0.65 &&
    post.createdAt >= windowStart
  )
}

export async function getConceptStats(
  prisma: PrismaClient,
  boardId: string,
  now: Date
) {
  const cached = await prisma.boardStatsCache.findUnique({
    where: { boardId },
  })

  if (cached && isCacheValid(cached, now)) {
    return cached
  }

  const windowStart = new Date(
    now.getTime() - CONCEPT_WINDOW_HOURS * 60 * 60 * 1000
  )

  const aggregate = await prisma.post.aggregate({
    where: {
      boardId,
      status: "VISIBLE",
      pinned: false,
      createdAt: { gte: windowStart },
    },
    _avg: { upCount: true },
    _count: { _all: true },
  })

  const avgUp = aggregate._avg.upCount ?? 0
  const sampleCount = aggregate._count._all
  const stats = computeConceptStats(avgUp, sampleCount, now)

  return prisma.boardStatsCache.upsert({
    where: { boardId },
    update: {
      windowHours: stats.windowHours,
      avgUp: stats.avgUp,
      sampleCount: stats.sampleCount,
      thresholdUp: stats.thresholdUp,
      computedAt: stats.computedAt,
      expiresAt: stats.expiresAt,
    },
    create: {
      boardId,
      windowHours: stats.windowHours,
      avgUp: stats.avgUp,
      sampleCount: stats.sampleCount,
      thresholdUp: stats.thresholdUp,
      computedAt: stats.computedAt,
      expiresAt: stats.expiresAt,
    },
  })
}
