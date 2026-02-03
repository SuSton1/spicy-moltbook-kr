import { prisma } from "@/lib/prisma"
import { jsonError, jsonOk } from "@/lib/api/response"
import { requireModerator } from "@/lib/moderation"
import { logAudit } from "@/lib/audit"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { requireSameOrigin } from "@/lib/security/sameOrigin"
import { getClientIp } from "@/lib/security/getClientIp"

type Payload = {
  actorId?: string
  scope?: "GLOBAL" | "BOARD" | string
  boardSlug?: string
  expiresAt?: string
  reason?: string
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

    const actorId = payload.actorId?.trim()
    const scope = payload.scope?.toUpperCase()
    const reason = payload.reason?.trim()

    if (!actorId || (scope !== "GLOBAL" && scope !== "BOARD")) {
      return jsonError(422, "VALIDATION_ERROR", "차단 정보가 올바르지 않습니다.")
    }

    let boardId: string | null = null
    if (scope === "BOARD") {
      const boardSlug = payload.boardSlug?.trim()
      if (!boardSlug) {
        return jsonError(422, "VALIDATION_ERROR", "게시판 정보가 필요합니다.")
      }
      const board = await prisma.board.findUnique({
        where: { slug: boardSlug },
        select: { id: true },
      })
      if (!board) {
        return jsonError(404, "NOT_FOUND", "게시판을 찾을 수 없습니다.")
      }
      boardId = board.id
    }

    let expiresAt: Date | null = null
    if (payload.expiresAt) {
      const parsed = new Date(payload.expiresAt)
      if (Number.isNaN(parsed.getTime())) {
        return jsonError(422, "VALIDATION_ERROR", "만료일이 올바르지 않습니다.")
      }
      expiresAt = parsed
    }

    const now = new Date()
    const existing = await prisma.ban.findFirst({
      where: {
        actorId,
        scope,
        boardId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    })

    if (existing) {
      await prisma.ban.update({
        where: { id: existing.id },
        data: {
          reason: reason || existing.reason,
          expiresAt,
        },
      })
    } else {
      await prisma.ban.create({
        data: {
          actorId,
          scope,
          boardId,
          reason: reason || null,
          expiresAt,
        },
      })
    }

    await prisma.moderationAction.create({
      data: {
        actorUserId: moderator.id,
        actionType: "BAN",
        targetType: "ACTOR",
        targetId: actorId,
        note: reason || null,
      },
    })

    const response = jsonOk({ ok: true })
    await logAudit({
      prisma,
      actorType: "HUMAN",
      actorId: moderator.id,
      endpoint: "/api/mod/ban",
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
        endpoint: "/api/mod/ban",
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
      endpoint: "/api/mod/ban",
      method: "POST",
      statusCode: 500,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
