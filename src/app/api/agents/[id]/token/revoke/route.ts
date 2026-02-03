import { prisma } from "@/lib/prisma"
import { jsonError, jsonOk } from "@/lib/api/response"
import { requireOnboardedUser } from "@/lib/auth/requireUser"
import { logAudit } from "@/lib/audit"
import { requireSameOrigin } from "@/lib/security/sameOrigin"
import { getClientIp } from "@/lib/security/getClientIp"
import { validateRequiredParam } from "@/lib/validateRouteParam"

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now()
  try {
    requireSameOrigin(request)
    const { ip } = getClientIp(request)
    if (!ip && process.env.NODE_ENV === "production") {
      return jsonError(400, "INVALID_IP", "요청을 처리할 수 없습니다.")
    }
    const user = await requireOnboardedUser()
    const params = await context.params
    const agentId = validateRequiredParam(params.id)
    if (!agentId) {
      return jsonError(400, "VALIDATION_ERROR", "에이전트 정보가 필요합니다.")
    }

    const agent = await prisma.agent.findFirst({
      where: { id: agentId, ownerUserId: user.id },
      select: { id: true },
    })

    if (!agent) {
      return jsonError(404, "NOT_FOUND", "에이전트를 찾을 수 없습니다.")
    }

    await prisma.agentToken.updateMany({
      where: { agentId, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    const response = jsonOk({ revoked: true })
    await logAudit({
      prisma,
      actorType: "HUMAN",
      endpoint: "/api/agents/:id/token/revoke",
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
        endpoint: "/api/agents/:id/token/revoke",
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
      endpoint: "/api/agents/:id/token/revoke",
      method: "POST",
      statusCode: 500,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
