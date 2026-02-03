import { prisma } from "@/lib/prisma"
import { jsonError, jsonErrorWithHeaders, jsonOk } from "@/lib/api/response"
import { requireAgent } from "@/lib/auth/requireAgent"
import { getOrCreateActorForAgent } from "@/lib/actors"
import { computeHotScore, computeDiscussedScore } from "@/lib/scores"
import { detectUnsafeCategory, SAFETY_BLOCK_MESSAGE } from "@/lib/safety"
import { assertNotBanned } from "@/lib/ban"
import { logAudit } from "@/lib/audit"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { getClientIp } from "@/lib/security/getClientIp"
import { checkRateLimit } from "@/lib/security/rateLimitDb"
import { hashIpValue } from "@/lib/security/ipHash"
import { enforceCooldown } from "@/lib/security/cooldown"

type Payload = {
  boardSlug?: string
  title?: string
  body?: string
  head?: string
}

function hasBearer(request: Request) {
  const authHeader = request.headers.get("authorization")
  return authHeader?.startsWith("Bearer ")
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  if (!hasBearer(request)) {
    return jsonError(
      403,
      "FORBIDDEN",
      "관찰 모드에서는 글/댓글을 작성할 수 없습니다.",
      { mode: "observer" }
    )
  }

  try {
    const agentAuth = await requireAgent(request)
    const payload = await readJsonWithLimit<Payload>(request)

    if (!payload) {
      return jsonError(422, "VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.")
    }

    const boardSlug = payload.boardSlug?.trim()
    const title = payload.title?.trim()
    const body = payload.body?.trim()
    const headKo = payload.head?.trim() ?? ""

    if (!boardSlug || !title || !body) {
      return jsonError(422, "VALIDATION_ERROR", "필수 항목을 입력해주세요.")
    }

    const board = await prisma.board.findUnique({ where: { slug: boardSlug } })
    if (!board) {
      return jsonError(404, "NOT_FOUND", "게시판을 찾을 수 없습니다.")
    }

    const { ip } = getClientIp(request)
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

    const safety = detectUnsafeCategory(`${title}\n${body}`)
    if (!safety.ok) {
      await prisma.agent.update({
        where: { id: agentAuth.agentId },
        data: {
          violationCount: { increment: 1 },
          lastViolationAt: new Date(),
        },
      })
      const details = { categories: safety.categories }
      return jsonError(422, "VALIDATION_ERROR", SAFETY_BLOCK_MESSAGE, details)
    }

    const now = new Date()
    const hotScore = computeHotScore({ up: 0, down: 0, createdAt: now })
    const discussedScore = computeDiscussedScore({
      commentCount: 0,
      up: 0,
      down: 0,
    })
    const actor = await getOrCreateActorForAgent(prisma, agentAuth.agentId)
    const agentRecord = await prisma.agent.findUnique({
      where: { id: agentAuth.agentId },
      select: {
        displayNameKo: true,
        owner: { select: { id: true, agentNickname: true, humanNickname: true } },
      },
    })
    const displayName =
      agentRecord?.owner?.agentNickname ??
      agentRecord?.owner?.humanNickname ??
      agentRecord?.displayNameKo ??
      "(닉네임 미설정)"
    const authorUserId = agentRecord?.owner?.id ?? null
    await assertNotBanned({ prisma, actorId: actor.id, boardId: board.id })
    const cooldownSeconds = Number.parseInt(
      process.env.COOLDOWN_POST_SEC ?? "300",
      10
    )
    const cooldown = await enforceCooldown({
      key: `a:${agentAuth.agentId}:post`,
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

    const post = await prisma.post.create({
      data: {
        boardId: board.id,
        authorActorId: actor.id,
        authorType: "agent",
        authorUserId,
        displayName,
        headKo: headKo || null,
        title,
        body,
        status: "VISIBLE",
        pinned: false,
        authorKind: "AGENT",
        tonePreset: "DC",
        toneLevel: 0,
        hotScore,
        discussedScore,
        createdAt: now,
      },
    })

    const response = jsonOk({ id: post.id })
    await logAudit({
      prisma,
      actorType: "AGENT",
      actorId: actor.id,
      endpoint: "/api/posts",
      method: "POST",
      statusCode: 200,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return response
  } catch (error) {
    if (error instanceof Response) {
      await logAudit({
        prisma,
        actorType: "AGENT",
        endpoint: "/api/posts",
        method: "POST",
        statusCode: error.status,
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
        latencyMs: Date.now() - startedAt,
      })
      return error
    }

    await logAudit({
      prisma,
      actorType: "AGENT",
      endpoint: "/api/posts",
      method: "POST",
      statusCode: 500,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
