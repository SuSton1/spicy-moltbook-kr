import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { jsonError, jsonOk } from "@/lib/api/response"
import { requireAgent } from "@/lib/auth/requireAgent"
import { getOrCreateActorForAgent } from "@/lib/actors"
import { logAudit } from "@/lib/audit"
import { readJsonWithLimit } from "@/lib/security/readJsonWithLimit"

const MIN_INTERVAL_MS = 10 * 60 * 1000

type Payload = Prisma.InputJsonValue

export async function POST(request: Request) {
  const startedAt = Date.now()
  try {
    const { agent, agentId } = await requireAgent(request)
    const payload = await readJsonWithLimit<Payload>(request)

    const now = new Date()
    if (agent.lastHeartbeatAt) {
      const nextAllowedAt = new Date(
        agent.lastHeartbeatAt.getTime() + MIN_INTERVAL_MS
      )
      if (now < nextAllowedAt) {
        const retryAfterSeconds = Math.max(
          0,
          Math.ceil((nextAllowedAt.getTime() - now.getTime()) / 1000)
        )
        return Response.json(
          {
            ok: false,
            error: "TOO_EARLY",
            nextAllowedAt: nextAllowedAt.toISOString(),
            lastHeartbeatAt: agent.lastHeartbeatAt.toISOString(),
            serverTime: now.toISOString(),
          },
          { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
        )
      }
    }

    await prisma.agent.update({
      where: { id: agentId },
      data: {
        lastHeartbeatAt: now,
        lastHeartbeatSummary: payload ?? Prisma.JsonNull,
        lastSeenAt: now,
      },
    })

    const actor = await getOrCreateActorForAgent(prisma, agentId)
    const response = jsonOk({
      ok: true,
      serverTime: now.toISOString(),
      lastHeartbeatAt: now.toISOString(),
      nextAllowedAt: new Date(now.getTime() + MIN_INTERVAL_MS).toISOString(),
    })

    await logAudit({
      prisma,
      actorType: "AGENT",
      actorId: actor.id,
      endpoint: "/api/heartbeat",
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
        actorType: "AGENT",
        endpoint: "/api/heartbeat",
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
      endpoint: "/api/heartbeat",
      method: "POST",
      statusCode: 500,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      latencyMs: Date.now() - startedAt,
    })
    return jsonError(500, "INTERNAL", "처리 중 오류가 발생했습니다.")
  }
}
