import { PointLedgerReason, Prisma } from "@prisma/client"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { jsonError, jsonOk } from "@/lib/api/response"
import { getOrCreateActorForUser } from "@/lib/actors"
import {
  getLeaderboardWindow,
  type LeaderboardPeriod,
} from "@/lib/leaderboard/points"
import { getActorDisplayName, PUBLIC_AUTHOR_INCLUDE } from "@/lib/publicAuthor"

type LeaderboardEntry = {
  rank: number
  agentId: string
  nickname: string
  points: number
}

type LeaderboardMe = {
  agentId: string
  nickname: string
  rank: number
  points: number
}

const PERIODS: LeaderboardPeriod[] = ["weekly", "monthly", "total"]

const REASONS: PointLedgerReason[] = [
  "VOTE_CHANGE",
  "DELETE_CONFISCATE",
  "ADMIN_ADJUST",
]

const loadNicknameMap = async (actorIds: string[]) => {
  if (!actorIds.length) return new Map<string, string>()
  const actors = await prisma.actor.findMany({
    where: { id: { in: actorIds } },
    include: PUBLIC_AUTHOR_INCLUDE,
  })
  return new Map(
    actors.map((actor) => [actor.id, getActorDisplayName(actor)] as const)
  )
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const periodParam = (searchParams.get("period") ?? "weekly").toLowerCase()
  if (!PERIODS.includes(periodParam as LeaderboardPeriod)) {
    return jsonError(400, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다.")
  }
  const period = periodParam as LeaderboardPeriod
  const { key, start } = getLeaderboardWindow(period)

  const session = await auth()
  const userId = session?.user?.id
  const actor = userId ? await getOrCreateActorForUser(prisma, userId) : null

  let top: LeaderboardEntry[] = []
  let me: LeaderboardMe | null = null

  const isE2E = process.env.E2E_TEST === "1"
  const isMissingTable = (error: unknown) =>
    isE2E &&
    (error instanceof Prisma.PrismaClientKnownRequestError ||
      (typeof error === "object" &&
        error !== null &&
        "code" in error)) &&
    (error as { code?: string }).code === "P2021"

  if (period === "total") {
    try {
      const stats = await prisma.agentPointStats.findMany({
        orderBy: [{ points: "desc" }, { actorId: "asc" }],
        take: 10,
      })
      const actorIds = stats.map((row) => row.actorId)
      if (actor?.id) actorIds.push(actor.id)
      const nameMap = await loadNicknameMap([...new Set(actorIds)])

      top = stats.map((row, index) => ({
        rank: index + 1,
        agentId: row.actorId,
        nickname: nameMap.get(row.actorId) ?? "(닉네임 미설정)",
        points: row.points,
      }))

      if (actor?.id) {
        const myStats = await prisma.agentPointStats.findUnique({
          where: { actorId: actor.id },
          select: { points: true },
        })
        const myPoints = myStats?.points ?? 0
        const higherCount = await prisma.agentPointStats.count({
          where: {
            OR: [
              { points: { gt: myPoints } },
              { AND: [{ points: myPoints }, { actorId: { lt: actor.id } }] },
            ],
          },
        })
        me = {
          agentId: actor.id,
          nickname: nameMap.get(actor.id) ?? "(닉네임 미설정)",
          rank: higherCount + 1,
          points: myPoints,
        }
      }
    } catch (error) {
      if (!isMissingTable(error)) {
        throw error
      }
      top = []
      me = null
    }
  } else {
    try {
      const rows = await prisma.pointLedger.groupBy({
        by: ["actorId"],
        where: {
          createdAt: { gte: start },
          reason: { in: REASONS },
        },
        _sum: { delta: true },
        orderBy: [{ _sum: { delta: "desc" } }, { actorId: "asc" }],
        take: 10,
      })
      const actorIds = rows.map((row) => row.actorId)
      if (actor?.id) actorIds.push(actor.id)
      const nameMap = await loadNicknameMap([...new Set(actorIds)])

      top = rows.map((row, index) => ({
        rank: index + 1,
        agentId: row.actorId,
        nickname: nameMap.get(row.actorId) ?? "(닉네임 미설정)",
        points: row._sum?.delta ?? 0,
      }))

      if (actor?.id) {
        const myAgg = await prisma.pointLedger.aggregate({
          where: {
            actorId: actor.id,
            createdAt: { gte: start },
            reason: { in: REASONS },
          },
          _sum: { delta: true },
        })
        const myPoints = myAgg._sum?.delta ?? 0
        const higher = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::int AS count
          FROM (
            SELECT "actorId", SUM("delta") AS points
            FROM "PointLedger"
            WHERE "createdAt" >= ${start}
              AND "reason" IN (${Prisma.join(REASONS)})
            GROUP BY "actorId"
          ) AS agg
          WHERE agg.points > ${myPoints}
            OR (agg.points = ${myPoints} AND agg."actorId" < ${actor.id})
        `
        const higherCount = Number(higher[0]?.count ?? 0)
        me = {
          agentId: actor.id,
          nickname: nameMap.get(actor.id) ?? "(닉네임 미설정)",
          rank: higherCount + 1,
          points: myPoints,
        }
      }
    } catch (error) {
      if (!isMissingTable(error)) {
        throw error
      }
      top = []
      me = null
    }
  }

  return jsonOk({
    period,
    key,
    top,
    me,
  })
}
