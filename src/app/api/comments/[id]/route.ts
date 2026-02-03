import { prisma } from "@/lib/prisma"
import { jsonError, jsonErrorWithHeaders, jsonOk } from "@/lib/api/response"
import { getSessionUser } from "@/lib/auth/requireUser"
import { isAdmin } from "@/lib/auth/isAdmin"
import { extractReplyTarget } from "@/lib/comments/thread"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { requireSameOrigin } from "@/lib/security/sameOrigin"
import { getClientIp } from "@/lib/security/getClientIp"
import { verifyPassword } from "@/lib/auth/password"
import { recordPasswordFailure } from "@/lib/security/passwordGuard"
import { logAudit } from "@/lib/audit"
import { validateRequiredParam } from "@/lib/validateRouteParam"

type UpdatePayload = {
  content?: string
  guestPassword?: string
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now()
  try {
    requireSameOrigin(request)
    const { id: rawId } = await params
    const commentId = validateRequiredParam(rawId)
    if (!commentId) {
      return jsonError(400, "VALIDATION_ERROR", "댓글 정보가 필요합니다.")
    }

    const payload = await readJsonWithLimit<UpdatePayload>(request)
    if (!payload) {
      return jsonError(422, "VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.")
    }

    const content = payload.content?.trim() ?? ""
    const guestPassword = payload.guestPassword ?? ""
    if (!content) {
      return jsonError(422, "VALIDATION_ERROR", "내용을 입력해주세요.")
    }
    if (content.length > 2000) {
      return jsonError(422, "VALIDATION_ERROR", "내용이 너무 깁니다.")
    }

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { authorActor: true },
    })
    if (!comment || comment.status !== "VISIBLE") {
      return jsonError(404, "NOT_FOUND", "댓글을 찾을 수 없습니다.")
    }

    const user = await getSessionUser()
    const isOwner = Boolean(user && comment.authorActor.userId === user.id)
    const isGuest =
      comment.authorType === "guest" ||
      (!comment.authorActor.userId && !comment.authorActor.agentId)

    if (!isOwner) {
      if (!isGuest) {
        return jsonError(403, "NOT_OWNER", "수정 권한이 없습니다.")
      }
      if (!guestPassword) {
        return jsonError(422, "PASSWORD_REQUIRED", "비밀번호를 입력해주세요.")
      }
      const storedHash =
        comment.guestPwHash ?? comment.authorActor.guestPasswordHash
      if (!storedHash) {
        return jsonError(403, "NOT_OWNER", "수정 권한이 없습니다.")
      }
      const ok = await verifyPassword(guestPassword, storedHash)
      if (!ok) {
        const { ip } = getClientIp(request)
        const rl = await recordPasswordFailure({
          ip,
          resourceKey: `comment:${comment.id}`,
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
        return jsonError(403, "PASSWORD_INVALID", "비밀번호가 올바르지 않습니다.")
      }
    }

    const { parentId } = extractReplyTarget(comment.body)
    const nextBody = parentId ? `>>${parentId}\n${content}` : content

    await prisma.comment.update({
      where: { id: comment.id },
      data: { body: nextBody, editedAt: new Date() },
    })

    await logAudit({
      prisma,
      actorType: isOwner ? "HUMAN" : "ANON",
      actorId: isOwner ? user?.id ?? null : null,
      endpoint: `/api/comments/${comment.id}`,
      method: "PATCH",
      statusCode: 200,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })

    return jsonOk({ ok: true })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now()
  try {
    requireSameOrigin(request)
    const { id: rawId } = await params
    const commentId = validateRequiredParam(rawId)
    if (!commentId) {
      return jsonError(400, "VALIDATION_ERROR", "댓글 정보가 필요합니다.")
    }

    const payload = await readJsonWithLimit<UpdatePayload>(request)
    const guestPassword = payload?.guestPassword ?? ""

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { authorActor: true },
    })
    if (!comment || comment.status !== "VISIBLE") {
      return jsonError(404, "NOT_FOUND", "댓글을 찾을 수 없습니다.")
    }

    const user = await getSessionUser()
    const isOwner = Boolean(user && comment.authorActor.userId === user.id)
    const admin = isAdmin(user)
    const isGuest =
      comment.authorType === "guest" ||
      (!comment.authorActor.userId && !comment.authorActor.agentId)

    if (!isOwner && !admin) {
      if (!isGuest) {
        return jsonError(403, "NOT_OWNER", "삭제 권한이 없습니다.")
      }
      if (!guestPassword) {
        return jsonError(422, "PASSWORD_REQUIRED", "비밀번호를 입력해주세요.")
      }
      const storedHash =
        comment.guestPwHash ?? comment.authorActor.guestPasswordHash
      if (!storedHash) {
        return jsonError(403, "NOT_OWNER", "삭제 권한이 없습니다.")
      }
      const ok = await verifyPassword(guestPassword, storedHash)
      if (!ok) {
        const { ip } = getClientIp(request)
        const rl = await recordPasswordFailure({
          ip,
          resourceKey: `comment:${comment.id}`,
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
        return jsonError(403, "PASSWORD_INVALID", "비밀번호가 올바르지 않습니다.")
      }
    }

    await prisma.comment.update({
      where: { id: comment.id },
      data: { status: "DELETED", deletedAt: new Date() },
    })

    await logAudit({
      prisma,
      actorType: user ? "HUMAN" : "ANON",
      actorId: user?.id ?? null,
      endpoint: `/api/comments/${comment.id}`,
      method: "DELETE",
      statusCode: 200,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })

    return jsonOk({ ok: true })
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
