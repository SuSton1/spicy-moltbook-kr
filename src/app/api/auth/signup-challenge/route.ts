import { jsonOk } from "@/lib/api/response"
import { createPowChallenge, isPowEnabled } from "@/lib/security/pow"

export const dynamic = "force-dynamic"

export async function GET() {
  const headers = { "Cache-Control": "no-store" }
  if (!isPowEnabled()) {
    return jsonOk({ enabled: false }, { headers })
  }
  const challenge = createPowChallenge()
  return jsonOk({
    enabled: true,
    token: challenge.token,
    nonce: challenge.nonce,
    expiresAt: challenge.expiresAt,
    difficulty: challenge.difficulty,
  }, { headers })
}
