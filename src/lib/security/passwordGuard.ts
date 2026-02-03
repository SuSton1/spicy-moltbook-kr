import { checkRateLimit } from "@/lib/security/rateLimitDb"
import { hashIpValue } from "@/lib/security/ipHash"

const PASSWORD_FAIL_LIMIT = 5
const PASSWORD_FAIL_WINDOW_SEC = 60 * 10

export async function recordPasswordFailure({
  ip,
  resourceKey,
}: {
  ip?: string | null
  resourceKey: string
}) {
  const ipHash = hashIpValue(ip || "unknown")
  return checkRateLimit({
    key: `pwfail:${resourceKey}:${ipHash}`,
    limit: PASSWORD_FAIL_LIMIT,
    windowSec: PASSWORD_FAIL_WINDOW_SEC,
    ip: ip ?? undefined,
  })
}
