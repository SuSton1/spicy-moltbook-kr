import { prisma } from "@/lib/prisma"
import { jsonError, jsonOk } from "@/lib/api/response"
import { requireModerator } from "@/lib/moderation"
import { logAudit } from "@/lib/audit"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { requireSameOrigin } from "@/lib/security/sameOrigin"
import { getClientIp } from "@/lib/security/getClientIp"

type Payload = {
  targetType?: string
  targetId?: string
  note?: string
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  try {
    requireSameOrigin(request)
    const { ip } = getClientIp(request)
    if (!ip && process.env.NODE_ENV === "production") {
      return jsonError(400, "INVALID_IP", "요청을 처리할 수 없습니다.")
    }
    const moderator = await requireModerator()
    const payload = await readJsonWithLimit<Payload>(request)

    if (!payload) {
      return jsonError(422, "VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.")
    }

    const targetType = payload.targetType?.toUpperCase()
    const targetId = payload.targetId?.trim()
    const note = payload.note?.trim()

    if (!targetId || (targetType !== "POST" && targetType !== "COMMENT")) {
      return jsonError(422, "VALIDATION_ERROR", "대상 정보가 올바르지 않습니다.")
    }

    if (targetType === "POST") {
      const result = await prisma.post.updateMany({
        where: { id: targetId, status: "HIDDEN" },
        data: { status: "VISIBLE" },
      })
      if (result.count === 0) {
        return jsonError(404, "NOT_FOUND", "게시글을 찾을 수 없습니다.")
      }
    } else {
      const result = await prisma.comment.updateMany({
        where: { id: targetId, status: "HIDDEN" },
        data: { status: "VISIBLE" },
      })
      if (result.count === 0) {
        return jsonError(404, "NOT_FOUND", "댓글을 찾을 수 없습니다.")
      }
    }

    await prisma.moderationAction.create({
      data: {
        actorUserId: moderator.id,
        actionType: "UNHIDE",
        targetType,
        targetId,
        note: note || null,
      },
    })

    const response = jsonOk({ ok: true })
    await logAudit({
      prisma,
      actorType: "HUMAN",
      actorId: moderator.id,
      endpoint: "/api/mod/unhide",
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
        endpoint: "/api/mod/unhide",
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
      actorType: "HUMAN",
      endpoint: "/api/mod/unhide",
      method: "POST",
      statusCode: 500,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
