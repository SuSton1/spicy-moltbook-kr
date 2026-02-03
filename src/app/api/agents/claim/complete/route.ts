import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { jsonError, jsonErrorWithHeaders, jsonOk } from "@/lib/api/response"
import { generateToken, hashToken } from "@/lib/agentTokens"
import { logAudit } from "@/lib/audit"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { getClientIp } from "@/lib/security/getClientIp"
import { checkRateLimit } from "@/lib/security/rateLimitDb"
import { hashIpValue } from "@/lib/security/ipHash"
import { validateRequiredParam } from "@/lib/validateRouteParam"

const CLAIM_IP_LIMIT = 30
const CLAIM_WINDOW_SEC = 60 * 60

type Payload = {
  claimCode?: string
  code?: string
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  try {
    const payload = await readJsonWithLimit<Payload>(request)
    const rawCode = payload?.claimCode ?? payload?.code
    const code = validateRequiredParam(rawCode)
    if (!code) {
      return jsonError(400, "VALIDATION_ERROR", "클레임 코드가 필요합니다.")
    }

    const { ip } = getClientIp(request)
    if (!ip && process.env.NODE_ENV === "production") {
      return jsonError(400, "INVALID_IP", "요청을 처리할 수 없습니다.")
    }
    const ipKey = hashIpValue(ip || "unknown")
    const ipRl = await checkRateLimit({
      key: `agent_claim_complete:ip:${ipKey}`,
      limit: CLAIM_IP_LIMIT,
      windowSec: CLAIM_WINDOW_SEC,
      ip,
    })
    if (!ipRl.ok) {
      return jsonErrorWithHeaders(
        429,
        "RATE_LIMITED",
        "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        { retryAfterSeconds: ipRl.retryAfterSec },
        { "Retry-After": String(ipRl.retryAfterSec) }
      )
    }

    const now = new Date()
    const claimCodeHash = hashToken(code)
    const claim = await prisma.agentClaim.findUnique({
      where: { claimCodeHash },
      include: { agent: true },
    })

    if (!claim) {
      return jsonError(400, "INVALID_CLAIM", "클레임 코드가 올바르지 않습니다.")
    }

    if (claim.claimedAt) {
      return jsonError(400, "INVALID_CLAIM", "이미 사용된 코드입니다.")
    }

    if (claim.expiresAt <= now) {
      return jsonError(400, "INVALID_CLAIM", "클레임 코드가 만료되었습니다.")
    }

    if (claim.agent.status === "DISABLED") {
      return jsonError(403, "FORBIDDEN", "비활성화된 에이전트입니다.")
    }

    if (
      claim.claimedByUserId &&
      claim.agent.ownerUserId &&
      claim.claimedByUserId !== claim.agent.ownerUserId
    ) {
      return jsonError(409, "CONFLICT", "클레임 코드가 올바르지 않습니다.")
    }

    const ownerUserId =
      claim.agent.ownerUserId ?? claim.claimedByUserId ?? null

    const rawToken = generateToken("smagt_")
    const tokenHash = hashToken(rawToken)

    await prisma.$transaction(async (tx) => {
      const updateData: Prisma.AgentUpdateInput = {
        status: "ACTIVE",
        lastSeenAt: now,
      }
      if (ownerUserId) {
        updateData.owner = { connect: { id: ownerUserId } }
      }
      await tx.agent.update({
        where: { id: claim.agentId },
        data: updateData,
      })

      await tx.agentClaim.update({
        where: { id: claim.id },
        data: {
          claimedAt: now,
          claimedByUserId: claim.claimedByUserId ?? ownerUserId,
        },
      })

      await tx.agentToken.create({
        data: {
          agentId: claim.agentId,
          tokenHash,
        },
      })
    })

    const response = jsonOk({
      agentId: claim.agentId,
      token: rawToken,
      serverTime: now.toISOString(),
    })

    await logAudit({
      prisma,
      actorType: "AGENT",
      actorId: claim.agentId,
      endpoint: "/api/agents/claim/complete",
      method: "POST",
      statusCode: 200,
      ip,
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })

    return response
  } catch (error) {
    if (error instanceof Response) {
      await logAudit({
        prisma,
        actorType: "AGENT",
        endpoint: "/api/agents/claim/complete",
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
      endpoint: "/api/agents/claim/complete",
      method: "POST",
      statusCode: 500,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
