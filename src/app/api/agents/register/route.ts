import { prisma } from "@/lib/prisma"
import { jsonError, jsonErrorWithHeaders, jsonOk } from "@/lib/api/response"
import { generateToken, hashToken } from "@/lib/agentTokens"
import { getKstDayStart } from "@/lib/ratelimit"
import {
  checkAndIncrIp,
  getKstHourStart,
  getRetryAfterSeconds,
} from "@/lib/ipRateLimit"
import { logAudit } from "@/lib/audit"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"
import { getClientIp } from "@/lib/security/getClientIp"
import { hashIpValue } from "@/lib/security/ipHash"

const HOUR_LIMIT = 10
const DAY_LIMIT = 100

type Payload = {
  proposedDisplayName?: string
}

function buildDefaultName() {
  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `익명${suffix}`
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  try {
    const payload = await readJsonWithLimit<Payload>(request)
    const proposed = payload?.proposedDisplayName?.trim()
    const displayNameKo = (proposed && proposed.slice(0, 20)) || buildDefaultName()

    const now = new Date()
    const { ip } = getClientIp(request)
    const ipHash = hashIpValue(ip || "unknown")

    const hourStart = getKstHourStart(now)
    const hourLimit = await checkAndIncrIp({
      prisma,
      ipHash,
      key: "agent_register_hour",
      limit: HOUR_LIMIT,
      windowStart: hourStart,
    })

    if (!hourLimit.allowed) {
      const retryAfterSeconds = getRetryAfterSeconds(now, hourStart, 60 * 60)
      return jsonErrorWithHeaders(
        429,
        "RATE_LIMITED",
        "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        { retryAfterSeconds },
        { "Retry-After": String(retryAfterSeconds) }
      )
    }

    const dayStart = getKstDayStart(now)
    const dayLimit = await checkAndIncrIp({
      prisma,
      ipHash,
      key: "agent_register_day",
      limit: DAY_LIMIT,
      windowStart: dayStart,
    })

    if (!dayLimit.allowed) {
      const retryAfterSeconds = getRetryAfterSeconds(now, dayStart, 24 * 60 * 60)
      return jsonErrorWithHeaders(
        429,
        "RATE_LIMITED",
        "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        { retryAfterSeconds },
        { "Retry-After": String(retryAfterSeconds) }
      )
    }

    const claimCode = generateToken("smclm_")
    const claimCodeHash = hashToken(claimCode)
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000)

    const agent = await prisma.agent.create({
      data: {
        ownerUserId: null,
        displayNameKo,
        status: "UNCLAIMED",
      },
    })

    await prisma.agentClaim.create({
      data: {
        agentId: agent.id,
        claimCodeHash,
        expiresAt,
      },
    })

    const response = jsonOk({
      claimCode,
      claimLink: `/claim-agent?code=${encodeURIComponent(claimCode)}`,
      expiresAt,
    })

    await logAudit({
      prisma,
      actorType: "ANON",
      endpoint: "/api/agents/register",
      method: "POST",
      statusCode: 200,
      ip,
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })

    return response
  } catch (error) {
    if (error instanceof Response) {
      return error
    }
    await logAudit({
      prisma,
      actorType: "ANON",
      endpoint: "/api/agents/register",
      method: "POST",
      statusCode: 500,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
