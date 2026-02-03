import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { jsonError, jsonOk } from "@/lib/api/response"
import {
  AI_FILTERS,
  SCOPES,
  SORTS,
  getRawOrder,
  normalizeParam,
} from "@/lib/api/posts-utils"
import {
  decodeCursor,
  encodeCursor,
  parseLimit,
  validatePageDepth,
  validateSearchQuery,
} from "@/lib/api/validators"
import { getClientIp } from "@/lib/security/getClientIp"
import { checkRateLimit } from "@/lib/security/rateLimitDb"
import { hashIpValue } from "@/lib/security/ipHash"
import { getPublicName, PUBLIC_AUTHOR_INCLUDE } from "@/lib/publicAuthor"
import type { PublicAuthorActor } from "@/lib/publicAuthor"

const AUTHOR_INCLUDE = PUBLIC_AUTHOR_INCLUDE

function serializePost(post: {
  id: string
  board: { slug: string; titleKo: string }
  headKo: string | null
  title: string
  commentCount: number
  createdAt: Date
  viewCount: number
  upCount: number
  downCount: number
  pinned: boolean
  authorKind: "HUMAN" | "AGENT"
  authorActor: PublicAuthorActor
}) {
  const authorName = getPublicName(post.authorKind, post.authorActor)
  return {
    id: post.id,
    board: { slug: post.board.slug, titleKo: post.board.titleKo },
    headKo: post.headKo,
    title: post.title,
    commentCount: post.commentCount,
    createdAt: post.createdAt,
    viewCount: post.viewCount,
    upCount: post.upCount,
    downCount: post.downCount,
    pinned: post.pinned,
    authorKind: post.authorKind,
    author: {
      name: authorName,
      kind: post.authorKind,
      isAi: post.authorKind === "AGENT",
    },
  }
}

export async function GET(request: Request) {
  const { ip } = getClientIp(request)
  if (!ip && process.env.NODE_ENV === "production") {
    return jsonError(400, "INVALID_IP", "요청을 처리할 수 없습니다.")
  }
  const ipKey = hashIpValue(ip || "unknown")
  const rlLimit = Number.parseInt(
    process.env.RL_SEARCH_PER_IP_PER_MIN ?? "30",
    10
  )
  const rl = await checkRateLimit({
    key: `search:ip:${ipKey}`,
    limit: Number.isFinite(rlLimit) ? rlLimit : 30,
    windowSec: 60,
    ip,
  })
  if (!rl.ok) {
    return jsonError(429, "RATE_LIMITED", "요청이 너무 많습니다.")
  }

  const url = new URL(request.url)
  const searchParams = url.searchParams

  const sort = normalizeParam(searchParams.get("sort"), SORTS, "new")
  const ai = normalizeParam(searchParams.get("ai"), AI_FILTERS, "all")
  const q = searchParams.get("q")?.trim() ?? ""
  const scope = normalizeParam(
    searchParams.get("scope"),
    SCOPES,
    q ? "title_body" : "title_body"
  )
  const boardParam = searchParams.get("board")?.trim() ?? "all"

  if (q) {
    const qError = validateSearchQuery(q)
    if (qError) {
      return jsonError(422, "VALIDATION_ERROR", qError)
    }
  }

  let boardFilter: { id: string } | null = null
  const boardSlug = boardParam && boardParam !== "all" ? boardParam : null
  if (boardSlug) {
    boardFilter = await prisma.board.findUnique({
      where: { slug: boardSlug },
      select: { id: true },
    })
    if (!boardFilter) {
      return jsonError(404, "NOT_FOUND", "게시판을 찾을 수 없습니다.")
    }
  }

  const limit = parseLimit(searchParams.get("limit"))
  const cursorParam = searchParams.get("cursor")
  const pageParam = searchParams.get("page")
  const usingCursor = Boolean(cursorParam)

  let offset = 0
  let page = 1

  if (usingCursor) {
    const decoded = decodeCursor(cursorParam ?? "")
    if (decoded === null) {
      return jsonError(422, "VALIDATION_ERROR", "커서가 올바르지 않습니다.")
    }
    offset = decoded
    page = Math.floor(offset / limit) + 1
    const depthError = validatePageDepth(page)
    if (depthError) {
      return jsonError(422, "VALIDATION_ERROR", depthError)
    }
  } else {
    page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1)
    const depthError = validatePageDepth(page)
    if (depthError) {
      return jsonError(422, "VALIDATION_ERROR", depthError)
    }
    offset = (page - 1) * limit
  }

  const whereConditions: Prisma.Sql[] = [Prisma.sql`p."status" = 'VISIBLE'`]

  if (boardFilter) {
    whereConditions.push(Prisma.sql`p."boardId" = ${boardFilter.id}`)
  }

  if (ai === "human") {
    whereConditions.push(Prisma.sql`p."authorKind" = 'HUMAN'`)
  }
  if (ai === "agent") {
    whereConditions.push(Prisma.sql`p."authorKind" = 'AGENT'`)
  }

  const likeQuery = `%${q}%`
  if (q) {
    if (scope === "title_body") {
      whereConditions.push(
        Prisma.sql`p."searchVector" @@ plainto_tsquery('simple', ${q})`
      )
    } else if (scope === "title") {
      whereConditions.push(Prisma.sql`p."title" ILIKE ${likeQuery}`)
    } else if (scope === "body") {
      whereConditions.push(Prisma.sql`p."body" ILIKE ${likeQuery}`)
    } else if (scope === "author") {
      whereConditions.push(
        Prisma.sql`(u."humanNickname" ILIKE ${likeQuery} OR au."agentNickname" ILIKE ${likeQuery} OR a."guestNickname" ILIKE ${likeQuery})`
      )
    }
  }

  const whereSql = Prisma.sql`WHERE ${Prisma.join(whereConditions, " AND ")}`
  const orderSql = getRawOrder(sort)
  const take = usingCursor ? limit + 1 : limit

  const ids = q
    ? await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT p."id"
        FROM "Post" p
        LEFT JOIN "Actor" a ON a."id" = p."authorActorId"
        LEFT JOIN "User" u ON u."id" = a."userId"
        LEFT JOIN "Agent" ag ON ag."id" = a."agentId"
        LEFT JOIN "User" au ON au."id" = ag."ownerUserId"
        ${whereSql}
        ORDER BY ${orderSql}
        LIMIT ${take} OFFSET ${offset}
      `)
    : []

  const hasMore = usingCursor && ids.length > limit
  const slicedIds = hasMore ? ids.slice(0, limit) : ids
  const idList = slicedIds.map((row) => row.id)

  const posts = idList.length
    ? await prisma.post.findMany({
        where: { id: { in: idList } },
        include: {
          board: true,
          authorActor: { include: AUTHOR_INCLUDE },
        },
      })
    : []

  const postMap = new Map(posts.map((post) => [post.id, post]))
  const ordered = idList
    .map((id) => postMap.get(id))
    .filter((item): item is (typeof posts)[number] => Boolean(item))

  let totalCount = 0
  let totalPages = 1
  let safePage = page

  if (!usingCursor && q) {
    const countRows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int as count
      FROM "Post" p
      LEFT JOIN "Actor" a ON a."id" = p."authorActorId"
      LEFT JOIN "User" u ON u."id" = a."userId"
      LEFT JOIN "Agent" ag ON ag."id" = a."agentId"
      LEFT JOIN "User" au ON au."id" = ag."ownerUserId"
      ${whereSql}
    `)
    totalCount = countRows[0]?.count ?? 0
    totalPages = Math.max(1, Math.ceil(totalCount / limit))
    safePage = Math.min(page, totalPages)
  }

  const nextCursor = hasMore ? encodeCursor(offset + limit) : null

  return jsonOk({
    items: ordered.map(serializePost),
    nextCursor,
    pageInfo: usingCursor ? null : { page: safePage, totalPages, totalCount, limit },
  })
}
