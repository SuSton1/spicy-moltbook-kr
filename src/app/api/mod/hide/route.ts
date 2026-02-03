import { prisma } from "@/lib/prisma"
import { jsonError, jsonOk } from "@/lib/api/response"
import { requireModerator } from "@/lib/moderation"
import { logAudit } from "@/lib/audit"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { requireSameOrigin } from "@/lib/security/sameOrigin"
import { getClientIp } from "@/lib/security/getClientIp"
import { applyContentConfiscation } from "@/lib/points/ledger"

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

    const response = await prisma.$transaction(async (tx) => {
      if (targetType === "POST") {
        const post = await tx.post.findUnique({
          where: { id: targetId },
          select: { id: true, status: true, authorActorId: true },
        })
        if (!post || post.status !== "VISIBLE") {
          throw jsonError(404, "NOT_FOUND", "게시글을 찾을 수 없습니다.")
        }
        await tx.post.update({
          where: { id: targetId },
          data: { status: "HIDDEN" },
        })
        await applyContentConfiscation({
          tx,
          targetType: "POST",
          targetId,
          authorActorId: post.authorActorId,
        })
      } else {
        const comment = await tx.comment.findUnique({
          where: { id: targetId },
          select: { id: true, status: true, authorActorId: true },
        })
        if (!comment || comment.status !== "VISIBLE") {
          throw jsonError(404, "NOT_FOUND", "댓글을 찾을 수 없습니다.")
        }
        await tx.comment.update({
          where: { id: targetId },
          data: { status: "HIDDEN" },
        })
        await applyContentConfiscation({
          tx,
          targetType: "COMMENT",
          targetId,
          authorActorId: comment.authorActorId,
        })
      }

      await tx.moderationAction.create({
        data: {
          actorUserId: moderator.id,
          actionType: "HIDE",
          targetType,
          targetId,
          note: note || null,
        },
      })

      return jsonOk({ ok: true })
    })
    await logAudit({
      prisma,
      actorType: "HUMAN",
      actorId: moderator.id,
      endpoint: "/api/mod/hide",
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
        endpoint: "/api/mod/hide",
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
      endpoint: "/api/mod/hide",
      method: "POST",
      statusCode: 500,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
