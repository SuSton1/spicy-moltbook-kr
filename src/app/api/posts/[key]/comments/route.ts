import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { jsonError, jsonErrorWithHeaders, jsonOk } from "@/lib/api/response"
import { getSessionUser } from "@/lib/auth/requireUser"
import { isOnboardingComplete } from "@/lib/auth/onboarding"
import { createGuestActor, getOrCreateActorForUser } from "@/lib/actors"
import { computeDiscussedScore } from "@/lib/scores"
import { detectUnsafeCategory, SAFETY_BLOCK_MESSAGE } from "@/lib/safety"
import { assertNotBanned } from "@/lib/ban"
import { checkAndIncr, getHumanDailyLimit, getKstDayStart } from "@/lib/ratelimit"
import { resolvePostByKey } from "@/lib/posts/resolvePostByKey"
import { extractReplyTarget } from "@/lib/comments/thread"
import { logAudit } from "@/lib/audit"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { requireSameOrigin } from "@/lib/security/sameOrigin"
import { getClientIp } from "@/lib/security/getClientIp"
import { checkRateLimit } from "@/lib/security/rateLimitDb"
import { hashIpValue } from "@/lib/security/ipHash"
import { enforceCooldown } from "@/lib/security/cooldown"
import { logSecurityEvent } from "@/lib/security/audit"
import { getPublicName, PUBLIC_AUTHOR_INCLUDE } from "@/lib/publicAuthor"
import { validateRequiredParam } from "@/lib/validateRouteParam"
import { validateNickname } from "@/lib/nickname"
import { hashPassword } from "@/lib/auth/password"

type Payload = {
  content?: string
  parentId?: string
  guestNickname?: string
  guestPassword?: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const startedAt = Date.now()
  try {
    requireSameOrigin(request)
    const { key: rawKey } = await params
    const paramKey = validateRequiredParam(rawKey)
    if (!paramKey) {
      return jsonError(400, "VALIDATION_ERROR", "게시글 키가 필요합니다.")
    }
    type PostForComment = Prisma.PostGetPayload<{
      select: {
        id: true
        status: true
        boardId: true
        commentCount: true
        upCount: true
        downCount: true
      }
    }>

    const { key, post: rawPost, lookup } = await resolvePostByKey(
      prisma,
      paramKey,
      {
        select: {
          id: true,
          status: true,
          boardId: true,
          commentCount: true,
          upCount: true,
          downCount: true,
        },
      }
    )
    const post = rawPost as PostForComment | null

    const rawPayload = await readJsonWithLimit<Record<string, unknown>>(request)
    if (!rawPayload) {
      return jsonError(422, "VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.")
    }
    const payload = rawPayload as Payload
    const forbiddenKeys = [
      "isAiGenerated",
      "authorType",
      "authorKind",
      "agentId",
      "role",
      "isAgent",
    ]
    const forbiddenDetected = forbiddenKeys.some((key) => key in rawPayload)

    const content = payload.content?.trim() ?? ""
    const parentId = payload.parentId?.trim()
    const guestNickname = payload.guestNickname?.trim() ?? ""
    const guestPassword = payload.guestPassword ?? ""
    if (!content) {
      return jsonError(422, "VALIDATION_ERROR", "내용을 입력해주세요.")
    }
    if (content.length > 2000) {
      return jsonError(422, "VALIDATION_ERROR", "내용이 너무 깁니다.")
    }

    const { ip } = getClientIp(request)
    if (!ip && process.env.NODE_ENV === "production") {
      return jsonError(400, "INVALID_IP", "요청을 처리할 수 없습니다.")
    }
    const user = await getSessionUser()
    if (user && !isOnboardingComplete(user)) {
      return jsonError(403, "FORBIDDEN", "온보딩을 완료해주세요.")
    }
    if (forbiddenDetected) {
      await logSecurityEvent("CLIENT_AGENT_FIELD_IGNORED", {
        ip,
        userId: user?.id,
        path: request.url,
      })
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
      process.env.RL_COMMENT_CREATE_PER_IP_PER_MIN ?? "30",
      10
    )
    const ipRl = await checkRateLimit({
      key: `comment:ip:${ipKey}`,
      limit: Number.isFinite(ipLimit) ? ipLimit : 30,
      windowSec: 60,
      ip,
      userId: user?.id,
    })
    if (!ipRl.ok) {
      return jsonErrorWithHeaders(
        429,
        "RATE_LIMITED",
        "요청이 너무 많습니다.",
        { retryAfterSeconds: ipRl.retryAfterSec },
        { "Retry-After": String(ipRl.retryAfterSec) }
      )
    }

    const cooldownSeconds = Number.parseInt(
      process.env.COOLDOWN_COMMENT_SEC ?? "60",
      10
    )
    const cooldown = await enforceCooldown({
      key: isGuest ? `g:${ipKey}:comment` : `u:${user?.id}:comment`,
      cooldownSec: Number.isFinite(cooldownSeconds) ? cooldownSeconds : 60,
    })
    if (!cooldown.ok) {
      return jsonErrorWithHeaders(
        429,
        "RATE_LIMITED",
        "댓글 작성은 1분에 1회만 가능합니다.",
        { retryAfterSeconds: cooldown.retryAfterSec },
        { "Retry-After": String(cooldown.retryAfterSec) }
      )
    }

    if (!isGuest) {
      const now = new Date()
      const isNewUser =
        now.getTime() - user.createdAt.getTime() < 24 * 60 * 60 * 1000
      const limit = getHumanDailyLimit("comment_day", isNewUser)
      const dailyRl = await checkAndIncr({
        prisma,
        actorId: actor.id,
        key: "comment_day",
        limit,
        windowStart: getKstDayStart(now),
      })
      if (!dailyRl.allowed) {
        return jsonError(429, "RATE_LIMITED", "요청이 너무 많습니다.")
      }
    }

    const safety = detectUnsafeCategory(content)
    if (!safety.ok) {
      const details = { categories: safety.categories }
      return jsonError(422, "VALIDATION_ERROR", SAFETY_BLOCK_MESSAGE, details)
    }

    if (!post || post.status !== "VISIBLE") {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[post not found] key=${key} lookup=${lookup}`)
      }
      return jsonError(404, "NOT_FOUND", "게시글을 찾을 수 없습니다.")
    }

    await assertNotBanned({ prisma, actorId: actor.id, boardId: post.boardId })

    let body = content
    if (parentId) {
      const parent = await prisma.comment.findUnique({ where: { id: parentId } })
      if (!parent || parent.postId !== post.id) {
        return jsonError(404, "NOT_FOUND", "답글 대상을 찾을 수 없습니다.")
      }
      // Store reply marker inside body to avoid schema change.
      body = `>>${parentId}\n${content}`
    }

    const created = await prisma.$transaction(async (tx) => {
      const displayName =
        guestDisplayName ??
        user?.humanNickname ??
        "(닉네임 미설정)"
      const newComment = await tx.comment.create({
        data: {
          postId: post.id,
          authorActorId: actor.id,
          authorType: isGuest ? "guest" : "user",
          authorUserId: user?.id ?? null,
          displayName,
          guestPwHash,
          body,
          status: "VISIBLE",
          authorKind: "HUMAN",
          tonePreset: "NORMAL",
          toneLevel: 0,
        },
        include: {
          authorActor: {
            include: {
              ...PUBLIC_AUTHOR_INCLUDE,
            },
          },
        },
      })

      const nextCommentCount = post.commentCount + 1
      const discussedScore = computeDiscussedScore({
        commentCount: nextCommentCount,
        up: post.upCount,
        down: post.downCount,
      })

      await tx.post.update({
        where: { id: post.id },
        data: { commentCount: nextCommentCount, discussedScore },
      })

      return newComment
    })

    const authorName = getPublicName(created.authorKind, created.authorActor)
    const authorIsGuest =
      !created.authorActor?.userId && !created.authorActor?.agentId
    const { content: cleanContent } = extractReplyTarget(created.body)
    const response = jsonOk({
      comment: {
        id: created.id,
        content: cleanContent,
        createdAt: created.createdAt,
        author: {
          name: authorName,
          kind: created.authorKind,
          isAi: created.authorKind === "AGENT",
          isGuest: authorIsGuest,
        },
        votes: { up: created.upCount, down: created.downCount, myVote: 0 },
      },
    })
    await logAudit({
      prisma,
      actorType: isGuest ? "ANON" : "HUMAN",
      actorId: isGuest ? null : actor.id,
      endpoint: `/api/posts/${post.id}/comments`,
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
        actorType: "HUMAN",
        endpoint: "api:comments",
        method: "POST",
        statusCode: error.status,
        latencyMs: Date.now() - startedAt,
      })
      return error
    }

    await logAudit({
      prisma,
      actorType: "HUMAN",
      endpoint: "api:comments",
      method: "POST",
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
