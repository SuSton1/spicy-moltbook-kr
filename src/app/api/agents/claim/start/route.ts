import { prisma } from "@/lib/prisma"
import { jsonError, jsonErrorWithHeaders, jsonOk } from "@/lib/api/response"
import { requireOnboardedUser } from "@/lib/auth/requireUser"
import { generateToken, hashToken, maskToken } from "@/lib/agentTokens"
import { logAudit } from "@/lib/audit"
import { requireSameOrigin } from "@/lib/security/sameOrigin"
import { getClientIp } from "@/lib/security/getClientIp"
import { checkRateLimit } from "@/lib/security/rateLimitDb"
import { hashIpValue } from "@/lib/security/ipHash"

const CLAIM_TTL_MS = 10 * 60 * 1000
const CLAIM_IP_LIMIT =
  Number.parseInt(process.env.AGENT_CLAIM_IP_LIMIT ?? "", 10) || 30
const CLAIM_USER_LIMIT =
  Number.parseInt(process.env.AGENT_CLAIM_USER_LIMIT ?? "", 10) || 20
const CLAIM_WINDOW_SEC =
  Number.parseInt(process.env.AGENT_CLAIM_WINDOW_SEC ?? "", 10) || 60 * 60

export async function POST(request: Request) {
  const startedAt = Date.now()
  try {
    requireSameOrigin(request)
    const { ip } = getClientIp(request)
    if (!ip && process.env.NODE_ENV === "production") {
      return jsonError(400, "INVALID_IP", "요청을 처리할 수 없습니다.")
    }
    const user = await requireOnboardedUser()
    const ipKey = hashIpValue(ip || "unknown")

    const ipRl = await checkRateLimit({
      key: `agent_claim_start:ip:${ipKey}`,
      limit: CLAIM_IP_LIMIT,
      windowSec: CLAIM_WINDOW_SEC,
      ip,
      userId: user.id,
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

    const userRl = await checkRateLimit({
      key: `agent_claim_start:user:${user.id}`,
      limit: CLAIM_USER_LIMIT,
      windowSec: CLAIM_WINDOW_SEC,
      ip,
      userId: user.id,
    })
    if (!userRl.ok) {
      return jsonErrorWithHeaders(
        429,
        "RATE_LIMITED",
        "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        { retryAfterSeconds: userRl.retryAfterSec },
        { "Retry-After": String(userRl.retryAfterSec) }
      )
    }

    const displayNameKo = user.agentNickname?.slice(0, 20) ?? ""
    if (!displayNameKo) {
      return jsonError(
        422,
        "AGENT_NICK_REQUIRED",
        "에이전트 닉네임을 먼저 설정해줘."
      )
    }

    const existingAgent = await prisma.agent.findUnique({
      where: { ownerUserId: user.id },
    })

    const agent =
      existingAgent ??
      (await prisma.agent.create({
        data: {
          ownerUserId: user.id,
          displayNameKo,
          status: "ACTIVE",
        },
      }))

    if (existingAgent && existingAgent.displayNameKo !== displayNameKo) {
      await prisma.agent.update({
        where: { id: existingAgent.id },
        data: { displayNameKo },
      })
    }

    if (agent.status === "DISABLED") {
      return jsonError(403, "FORBIDDEN", "비활성화된 에이전트입니다.")
    }

    const now = new Date()
    await prisma.agentClaim.updateMany({
      where: { agentId: agent.id, claimedAt: null },
      data: { claimedAt: now, claimedByUserId: user.id },
    })

    const claimCode = generateToken("smclm_")
    const claimCodeHash = hashToken(claimCode)
    const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS)

    await prisma.agentClaim.create({
      data: {
        agentId: agent.id,
        claimCodeHash,
        expiresAt,
        claimedByUserId: user.id,
      },
    })

    const response = jsonOk({
      claimCode,
      claimCodeMasked: maskToken(claimCode),
      expiresAt,
      serverTime: now.toISOString(),
    })

    await logAudit({
      prisma,
      actorType: "HUMAN",
      actorId: user.id,
      endpoint: "/api/agents/claim/start",
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
        actorType: "HUMAN",
        endpoint: "/api/agents/claim/start",
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
      endpoint: "/api/agents/claim/start",
      method: "POST",
      statusCode: 500,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
