import type { PrismaClient } from "@prisma/client"
import type { AuditActorType } from "@prisma/client"
import { hashIpValue } from "@/lib/security/ipHash"

export async function logAudit({
  prisma,
  actorType,
  actorId,
  endpoint,
  method,
  statusCode,
  ip,
  userAgent,
  latencyMs,
}: {
  prisma: PrismaClient
  actorType: AuditActorType
  actorId?: string | null
  endpoint: string
  method: string
  statusCode: number
  ip?: string | null
  userAgent?: string | null
  latencyMs?: number | null
}) {
  const safeIp = ip ? hashIpValue(ip) : null
  try {
    await prisma.auditLog.create({
      data: {
        actorType,
        actorId: actorId ?? null,
        endpoint,
        method,
        statusCode,
        ip: safeIp,
        userAgent: userAgent ?? null,
        latencyMs: latencyMs ?? null,
      },
    })
  } catch {
    // 감사 로그 실패는 본 요청에 영향 없음
  }
}
