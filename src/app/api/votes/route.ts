import { prisma } from "@/lib/prisma"
import { jsonError, jsonErrorWithHeaders, jsonOk } from "@/lib/api/response"
import { requireOnboardedUser } from "@/lib/auth/requireUser"
import { getOrCreateActorForUser } from "@/lib/actors"
import { checkAndIncr, getHumanDailyLimit, getKstDayStart } from "@/lib/ratelimit"
import { logAudit } from "@/lib/audit"
import { applyVote } from "@/lib/votes/applyVote"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { requireSameOrigin } from "@/lib/security/sameOrigin"
import { getClientIp } from "@/lib/security/getClientIp"

type Payload = {
  targetType?: "post" | "comment" | string
  targetId?: string
  value?: number
}

function hasBearer(request: Request) {
  const authHeader = request.headers.get("authorization")
  return authHeader?.startsWith("Bearer ")
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  if (hasBearer(request)) {
    return jsonError(501, "NOT_IMPLEMENTED", "아직 지원하지 않습니다.")
  }

  try {
    requireSameOrigin(request)
    const { ip } = getClientIp(request)
    if (!ip && process.env.NODE_ENV === "production") {
      return jsonError(400, "INVALID_IP", "요청을 처리할 수 없습니다.")
    }
    const user = await requireOnboardedUser()
    const actor = await getOrCreateActorForUser(prisma, user.id)
    const payload = await readJsonWithLimit<Payload>(request)

    if (!payload) {
      return jsonError(422, "VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.")
    }

    const targetTypeRaw = payload.targetType?.toLowerCase()
    const targetType =
      targetTypeRaw === "post" ? "POST" : targetTypeRaw === "comment" ? "COMMENT" : null
    const targetId = payload.targetId?.trim()
    const value = payload.value

    if (!targetType || !targetId || (value !== 1 && value !== -1)) {
      return jsonError(422, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다.")
    }

    const now = new Date()
    const isNewUser = now.getTime() - user.createdAt.getTime() < 24 * 60 * 60 * 1000
    const limit = getHumanDailyLimit("vote_day", isNewUser)
    const rl = await checkAndIncr({
      prisma,
      actorId: actor.id,
      key: "vote_day",
      limit,
      windowStart: getKstDayStart(now),
    })

    if (!rl.allowed) {
      return jsonErrorWithHeaders(
        429,
        "RATE_LIMITED",
        "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        { retryAfterSeconds: rl.retryAfterSeconds ?? 0 },
        { "Retry-After": String(rl.retryAfterSeconds ?? 0) }
      )
    }

    const result = await applyVote({
      prisma,
      actorId: actor.id,
      targetType,
      targetId,
      value: value as 1 | -1,
    })

    const response = jsonOk({
      up: result.up,
      down: result.down,
      myVote: result.myVote,
    })
    await logAudit({
      prisma,
      actorType: "HUMAN",
      actorId: actor.id,
      endpoint: "/api/votes",
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
        endpoint: "/api/votes",
        method: "POST",
        statusCode: error.status,
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
        latencyMs: Date.now() - startedAt,
      })
      return error
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return jsonError(404, "NOT_FOUND", "대상을 찾을 수 없습니다.")
    }
    await logAudit({
      prisma,
      actorType: "HUMAN",
      endpoint: "/api/votes",
      method: "POST",
      statusCode: 500,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
