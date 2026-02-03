import { prisma } from "@/lib/prisma"
import { hashIpValue } from "@/lib/security/ipHash"

type EventMeta = Record<string, unknown>

export async function logSecurityEvent(
  type: string,
  {
    ip,
    ipHash,
    userId,
    path,
    method,
    ua,
    meta,
  }: {
    ip?: string
    ipHash?: string
    userId?: string
    path?: string
    method?: string
    ua?: string
    meta?: EventMeta
  }
) {
  const metaJson = meta ? JSON.stringify(meta).slice(0, 1000) : undefined
  const safeIp = ipHash ?? (ip ? hashIpValue(ip) : undefined)
  try {
    await prisma.securityEvent.create({
      data: {
        type,
        ip: safeIp,
        userId,
        path,
        method,
        ua,
        metaJson,
      },
    })
  } catch {
    // ignore logging failures
  }
}
