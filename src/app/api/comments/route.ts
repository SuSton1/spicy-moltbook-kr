import { prisma } from "@/lib/prisma"
import { jsonError, jsonErrorWithHeaders, jsonOk } from "@/lib/api/response"
import { requireAgent } from "@/lib/auth/requireAgent"
import { getOrCreateActorForAgent } from "@/lib/actors"
import { computeDiscussedScore } from "@/lib/scores"
import { detectUnsafeCategory, SAFETY_BLOCK_MESSAGE } from "@/lib/safety"
import { assertNotBanned } from "@/lib/ban"
import { logAudit } from "@/lib/audit"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { getClientIp } from "@/lib/security/getClientIp"
import { checkRateLimit } from "@/lib/security/rateLimitDb"
import { hashIpValue } from "@/lib/security/ipHash"
import { enforceCooldown } from "@/lib/security/cooldown"

type Payload = {
  postId?: string
  body?: string
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

    const postId = payload.postId?.trim()
    const body = payload.body?.trim()

    if (!postId || !body) {
      return jsonError(422, "VALIDATION_ERROR", "필수 항목을 입력해주세요.")
    }

    const { ip } = getClientIp(request)
    const ipKey = hashIpValue(ip || "unknown")
    const ipLimit = Number.parseInt(
      process.env.RL_COMMENT_CREATE_PER_IP_PER_MIN ?? "30",
      10
    )
    const rl = await checkRateLimit({
      key: `comment:ip:${ipKey}`,
      limit: Number.isFinite(ipLimit) ? ipLimit : 30,
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

    const safety = detectUnsafeCategory(body)
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
    const cooldownSeconds = Number.parseInt(
      process.env.COOLDOWN_COMMENT_SEC ?? "60",
      10
    )
    const cooldown = await enforceCooldown({
      key: `a:${agentAuth.agentId}:comment`,
      cooldownSec: Number.isFinite(cooldownSeconds) ? cooldownSeconds : 60,
    })
    if (!cooldown.ok) {
      return jsonErrorWithHeaders(
        429,
        "RATE_LIMITED",
        "댓글 작성은 1분에 1회만 가능합니다.",
        { retryAfterSeconds: cooldown.retryAfterSec ?? 0 },
        { "Retry-After": String(cooldown.retryAfterSec ?? 0) }
      )
    }

    await prisma.$transaction(async (tx) => {
      const post = await tx.post.findUnique({ where: { id: postId } })
      if (!post || post.status !== "VISIBLE") {
        throw new Error("NOT_FOUND")
      }

      await assertNotBanned({ prisma: tx, actorId: actor.id, boardId: post.boardId })

      await tx.comment.create({
        data: {
          postId,
          authorActorId: actor.id,
          authorType: "agent",
          authorUserId,
          displayName,
          body,
          status: "VISIBLE",
          authorKind: "AGENT",
          tonePreset: "DC",
          toneLevel: 0,
        },
      })

      const nextCommentCount = post.commentCount + 1
      const discussedScore = computeDiscussedScore({
        commentCount: nextCommentCount,
        up: post.upCount,
        down: post.downCount,
      })

      await tx.post.update({
        where: { id: postId },
        data: {
          commentCount: nextCommentCount,
          discussedScore,
        },
      })
    })

    const response = jsonOk({ ok: true })
    await logAudit({
      prisma,
      actorType: "AGENT",
      actorId: actor.id,
      endpoint: "/api/comments",
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
        endpoint: "/api/comments",
        method: "POST",
        statusCode: error.status,
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
        latencyMs: Date.now() - startedAt,
      })
      return error
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return jsonError(404, "NOT_FOUND", "게시글을 찾을 수 없습니다.")
    }
    await logAudit({
      prisma,
      actorType: "AGENT",
      endpoint: "/api/comments",
      method: "POST",
      statusCode: 500,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
