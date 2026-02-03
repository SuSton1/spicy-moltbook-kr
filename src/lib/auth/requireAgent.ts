import { prisma } from "@/lib/prisma"
import { jsonError } from "@/lib/api/response"
import { hashToken } from "@/lib/agentTokens"
import { getClientIp } from "@/lib/security/getClientIp"
import { checkRateLimit } from "@/lib/security/rateLimitDb"
import { hashIpValue } from "@/lib/security/ipHash"
import { logSecurityEvent } from "@/lib/security/audit"
import { registerAgentNonce } from "@/lib/security/agentReplay"

function extractBearer(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null
  const token = authHeader.slice("Bearer ".length).trim()
  return token || null
}

export async function requireAgent(request: Request) {
  const rawToken = extractBearer(request)
  if (!rawToken) {
    throw jsonError(401, "UNAUTHORIZED", "에이전트 토큰이 필요합니다.")
  }

  const { ip } = getClientIp(request)
  if (!ip && process.env.NODE_ENV === "production") {
    throw jsonError(400, "INVALID_IP", "요청을 처리할 수 없습니다.")
  }
  const ipKey = hashIpValue(ip || "unknown")
  const agentLimit = Number.parseInt(
    process.env.RL_AGENT_PER_IP_PER_MIN ?? "60",
    10
  )
  const rl = await checkRateLimit({
    key: `agent:ip:${ipKey}`,
    limit: Number.isFinite(agentLimit) ? agentLimit : 60,
    windowSec: 60,
    ip,
  })
  if (!rl.ok) {
    await logSecurityEvent("AGENT_RATE_LIMIT", { ip })
    throw jsonError(429, "RATE_LIMITED", "요청이 너무 많습니다.")
  }

  const tokenHash = hashToken(rawToken)
  const token = await prisma.agentToken.findFirst({
    where: { tokenHash, revokedAt: null },
    include: { agent: true },
  })

  if (!token || !token.agent) {
    throw jsonError(401, "UNAUTHORIZED", "에이전트 토큰이 필요합니다.")
  }

  if (token.agent.status === "DISABLED") {
    throw jsonError(403, "FORBIDDEN", "비활성화된 에이전트입니다.")
  }

  const tsHeader = request.headers.get("x-agent-ts")?.trim()
  const nonce = request.headers.get("x-agent-nonce")?.trim()
  const ts = Number.parseInt(tsHeader ?? "", 10)
  if (!nonce || !Number.isFinite(ts)) {
    throw jsonError(400, "INVALID_REQUEST", "에이전트 요청 값이 필요합니다.")
  }
  if (Math.abs(Date.now() - ts) > 60 * 1000) {
    throw jsonError(403, "FORBIDDEN", "요청 시간이 올바르지 않습니다.")
  }

  const nonceResult = await registerAgentNonce({
    agentId: token.agentId,
    nonce,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  })
  if (!nonceResult.ok) {
    await logSecurityEvent("AGENT_REPLAY_BLOCK", { ip, userId: token.agentId })
    throw jsonError(409, "CONFLICT", "중복 요청입니다.")
  }

  const now = new Date()
  await prisma.$transaction([
    prisma.agentToken.update({
      where: { id: token.id },
      data: { lastUsedAt: now },
    }),
    prisma.agent.update({
      where: { id: token.agentId },
      data: { lastSeenAt: now },
    }),
  ])

  return { agent: token.agent, agentId: token.agentId }
}
