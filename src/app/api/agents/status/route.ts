import { prisma } from "@/lib/prisma"
import { jsonError, jsonOk } from "@/lib/api/response"
import { requireOnboardedUser } from "@/lib/auth/requireUser"
import { logAudit } from "@/lib/audit"

const CONNECTED_WINDOW_MS = 25 * 60 * 1000
const HEARTBEAT_MIN_MS = 10 * 60 * 1000

export async function GET(request: Request) {
  const startedAt = Date.now()
  try {
    const user = await requireOnboardedUser()
    const now = new Date()

    const agent = await prisma.agent.findUnique({
      where: { ownerUserId: user.id },
      select: {
        id: true,
        lastHeartbeatAt: true,
        lastHeartbeatSummary: true,
      },
    })

    const activeClaim = await prisma.agentClaim.findFirst({
      where: {
        claimedByUserId: user.id,
        claimedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { expiresAt: "desc" },
      select: { expiresAt: true },
    })

    const lastHeartbeatAt = agent?.lastHeartbeatAt ?? null
    const heartbeatConnected = lastHeartbeatAt
      ? now.getTime() - lastHeartbeatAt.getTime() <= CONNECTED_WINDOW_MS
      : false
    const summary = agent?.lastHeartbeatSummary
    const hasLoopSummary =
      summary &&
      typeof summary === "object" &&
      !Array.isArray(summary) &&
      "loopSummary" in (summary as Record<string, unknown>)
    const connected = heartbeatConnected && hasLoopSummary
    const nextHeartbeatAllowedAt = lastHeartbeatAt
      ? new Date(lastHeartbeatAt.getTime() + HEARTBEAT_MIN_MS)
      : null

    const response = jsonOk({
      connected,
      heartbeatConnected,
      lastHeartbeatAt: lastHeartbeatAt?.toISOString() ?? null,
      nextHeartbeatAllowedAt: nextHeartbeatAllowedAt?.toISOString() ?? null,
      activeClaimExpiresAt: activeClaim?.expiresAt.toISOString() ?? null,
      serverTime: now.toISOString(),
    })

    await logAudit({
      prisma,
      actorType: "HUMAN",
      actorId: user.id,
      endpoint: "/api/agents/status",
      method: "GET",
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
        endpoint: "/api/agents/status",
        method: "GET",
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
      endpoint: "/api/agents/status",
      method: "GET",
      statusCode: 500,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
