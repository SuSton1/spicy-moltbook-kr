import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { jsonError, jsonErrorWithHeaders, jsonOk } from "@/lib/api/response"
import {
  AI_FILTERS,
  SCOPES,
  SORTS,
  TABS,
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
// concept filtering handled by isBest flag
import { validateRequiredParam } from "@/lib/validateRouteParam"
import { getSessionUser } from "@/lib/auth/requireUser"
import { isOnboardingComplete } from "@/lib/auth/onboarding"
import { createGuestActor, getOrCreateActorForUser } from "@/lib/actors"
import { computeDiscussedScore, computeHotScore } from "@/lib/scores"
import { detectUnsafeCategory, SAFETY_BLOCK_MESSAGE } from "@/lib/safety"
import { assertNotBanned } from "@/lib/ban"
import { logAudit } from "@/lib/audit"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { requireSameOrigin } from "@/lib/security/sameOrigin"
import { getClientIp } from "@/lib/security/getClientIp"
import { checkRateLimit } from "@/lib/security/rateLimitDb"
import { hashIpValue } from "@/lib/security/ipHash"
import { enforceCooldown } from "@/lib/security/cooldown"
import { validateNickname } from "@/lib/nickname"
import { hashPassword } from "@/lib/auth/password"
import { getPublicName, PUBLIC_AUTHOR_INCLUDE } from "@/lib/publicAuthor"
import type { PublicAuthorActor } from "@/lib/publicAuthor"
import { resolveBoardRecord } from "@/lib/boards/resolveBoard"

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
  authorType?: string | null
  authorActor: PublicAuthorActor
}) {
  const authorName = getPublicName(post.authorKind, post.authorActor)
  const authorIsGuest =
    post.authorType === "guest" ||
    (!post.authorActor?.user && !post.authorActor?.agent)
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
      isGuest: authorIsGuest,
    },
  }
}

type CreatePayload = {
  title?: string
  body?: string
  head?: string
  guestNickname?: string
  guestPassword?: string
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug: rawSlug } = await params
  const slug = validateRequiredParam(rawSlug)
  if (!slug) {
    return jsonError(400, "VALIDATION_ERROR", "게시판 정보가 필요합니다.")
  }
  const { board } = await resolveBoardRecord(String(slug))
  if (!board) {
    return jsonError(404, "NOT_FOUND", "게시판을 찾을 수 없습니다.")
  }

  const url = new URL(request.url)
  const searchParams = url.searchParams

  const tab = normalizeParam(searchParams.get("tab"), TABS, "all")
  const sort = normalizeParam(searchParams.get("sort"), SORTS, "new")
  const ai = normalizeParam(searchParams.get("ai"), AI_FILTERS, "all")
  const q = searchParams.get("q")?.trim() ?? ""
  const scope = normalizeParam(
    searchParams.get("scope"),
    SCOPES,
    q ? "title_body" : "title_body"
  )

  const limit = parseLimit(searchParams.get("limit"))
  const cursorParam = searchParams.get("cursor")
  const pageParam = searchParams.get("page")
  const usingCursor = Boolean(cursorParam)

  if (q) {
    const qError = validateSearchQuery(q)
    if (qError) {
      return jsonError(422, "VALIDATION_ERROR", qError)
    }
  }

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

  const whereConditions: Prisma.Sql[] = [
    Prisma.sql`p."boardId" = ${board.id}`,
    Prisma.sql`p."status" = 'VISIBLE'`,
  ]

  if (tab === "concept") {
    whereConditions.push(Prisma.sql`p."isBest" = true`)
  }

  if (tab === "notice") {
    whereConditions.push(Prisma.sql`p."pinned" = true`)
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

  const ids = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
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

  if (!usingCursor) {
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const startedAt = Date.now()
  try {
    requireSameOrigin(request)
    const { slug: rawSlug } = await params
    const slug = validateRequiredParam(rawSlug)
    if (!slug) {
      return jsonError(400, "VALIDATION_ERROR", "게시판 정보가 필요합니다.")
    }

    const { board } = await resolveBoardRecord(String(slug))
    if (!board) {
      return jsonError(404, "NOT_FOUND", "게시판을 찾을 수 없습니다.")
    }

    const payload = await readJsonWithLimit<CreatePayload>(request)
    if (!payload) {
      return jsonError(422, "VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.")
    }

    const title = payload.title?.trim() ?? ""
    const body = payload.body?.trim() ?? ""
    const headKo = payload.head?.trim() ?? ""
    const guestNickname = payload.guestNickname?.trim() ?? ""
    const guestPassword = payload.guestPassword ?? ""

    if (!title || !body) {
      return jsonError(422, "VALIDATION_ERROR", "필수 항목을 입력해주세요.")
    }

    const { ip } = getClientIp(request)
    if (!ip && process.env.NODE_ENV === "production") {
      return jsonError(400, "INVALID_IP", "요청을 처리할 수 없습니다.")
    }

    const user = await getSessionUser()
    if (user && !isOnboardingComplete(user)) {
      return jsonError(403, "FORBIDDEN", "온보딩을 완료해주세요.")
    }

    const isGuest = !user
    let guestDisplayName: string | null = null
    let guestPwHash: string | null = null
    const actor = isGuest
      ? await (async () => {
          const validation = validateNickname(guestNickname)
          if (!validation.ok) {
            throw jsonError(422, validation.code, validation.message)
          }
          if (!guestPassword) {
            throw jsonError(422, "PASSWORD_REQUIRED", "비밀번호가 필요합니다.")
          }
          if (guestPassword.length < 4) {
            throw jsonError(422, "VALIDATION_ERROR", "비밀번호가 너무 짧습니다.")
          }
          if (guestPassword.length > 32) {
            throw jsonError(422, "VALIDATION_ERROR", "비밀번호가 너무 깁니다.")
          }
          const passwordHash = await hashPassword(guestPassword)
          guestDisplayName = validation.original
          guestPwHash = passwordHash
          return createGuestActor(prisma, {
            nickname: validation.original,
            passwordHash,
          })
        })()
      : await getOrCreateActorForUser(prisma, user.id)

    const ipKey = hashIpValue(ip || "unknown")
    const ipLimit = Number.parseInt(
      process.env.RL_POST_CREATE_PER_IP_PER_MIN ?? "6",
      10
    )
    const rl = await checkRateLimit({
      key: `post:ip:${ipKey}`,
      limit: Number.isFinite(ipLimit) ? ipLimit : 6,
      windowSec: 60,
      ip,
      userId: user?.id,
    })
    if (!rl.ok) {
      return jsonErrorWithHeaders(
        429,
        "RATE_LIMITED",
        "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        { retryAfterSeconds: rl.retryAfterSec },
        { "Retry-After": String(rl.retryAfterSec) }
      )
    }

    const cooldownSeconds = Number.parseInt(
      process.env.COOLDOWN_POST_SEC ?? "300",
      10
    )
    const cooldown = await enforceCooldown({
      key: isGuest ? `g:${ipKey}:post` : `u:${user?.id}:post`,
      cooldownSec: Number.isFinite(cooldownSeconds) ? cooldownSeconds : 300,
    })
    if (!cooldown.ok) {
      return jsonErrorWithHeaders(
        429,
        "RATE_LIMITED",
        "글 작성은 5분에 1회만 가능합니다.",
        { retryAfterSeconds: cooldown.retryAfterSec ?? 0 },
        { "Retry-After": String(cooldown.retryAfterSec ?? 0) }
      )
    }

    const safety = detectUnsafeCategory(`${title}\n${body}`)
    if (!safety.ok) {
      const details = { categories: safety.categories }
      return jsonError(422, "VALIDATION_ERROR", SAFETY_BLOCK_MESSAGE, details)
    }

    await assertNotBanned({ prisma, actorId: actor.id, boardId: board.id })

    const now = new Date()
    const hotScore = computeHotScore({ up: 0, down: 0, createdAt: now })
    const discussedScore = computeDiscussedScore({
      commentCount: 0,
      up: 0,
      down: 0,
    })

    const displayName =
      guestDisplayName ??
      user?.humanNickname ??
      "(닉네임 미설정)"
    const post = await prisma.post.create({
      data: {
        boardId: board.id,
        authorActorId: actor.id,
        authorType: isGuest ? "guest" : "user",
        authorUserId: user?.id ?? null,
        displayName,
        guestPwHash,
        headKo: headKo || null,
        title,
        body,
        status: "VISIBLE",
        pinned: false,
        authorKind: "HUMAN",
        tonePreset: "NORMAL",
        toneLevel: 0,
        hotScore,
        discussedScore,
        createdAt: now,
      },
    })

    await logAudit({
      prisma,
      actorType: isGuest ? "ANON" : "HUMAN",
      actorId: isGuest ? null : actor.id,
      endpoint: `/api/boards/${board.slug}/posts`,
      method: "POST",
      statusCode: 200,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })

    return jsonOk({ id: post.id })
  } catch (error) {
    if (error instanceof Response) {
      await logAudit({
        prisma,
        actorType: "ANON",
        endpoint: "api:board-posts",
        method: "POST",
        statusCode: error.status,
        latencyMs: Date.now() - startedAt,
      })
      return error
    }

    await logAudit({
      prisma,
      actorType: "ANON",
      endpoint: "api:board-posts",
      method: "POST",
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
