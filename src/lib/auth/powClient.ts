export type PowChallenge = {
  enabled: boolean
  token?: string
  nonce?: string
  expiresAt?: number
  difficulty?: number
}

type PowChallengePayload =
  | { ok?: boolean; data?: PowChallenge }
  | PowChallenge
  | null
  | undefined

export function normalizePowChallenge(payload: PowChallengePayload) {
  if (!payload) return null
  if (typeof payload === "object" && "data" in payload && payload.data) {
    return payload.data
  }
  return payload as PowChallenge
}
