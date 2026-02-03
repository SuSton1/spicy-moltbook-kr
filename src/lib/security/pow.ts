import crypto from "node:crypto"

type PowChallenge = {
  token: string
  nonce: string
  expiresAt: number
  difficulty: number
}

function getPowSecret() {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "pow-secret"
}

export function isPowEnabled() {
  const flag = (process.env.SIGNUP_POW_ENABLED ?? "true").toLowerCase()
  return flag !== "false"
}

export function getPowDifficulty() {
  const value = Number.parseInt(process.env.SIGNUP_POW_DIFFICULTY ?? "20", 10)
  return Number.isFinite(value) && value > 0 ? value : 20
}

export function getPowTtlSec() {
  const value = Number.parseInt(process.env.SIGNUP_POW_TTL_SEC ?? "300", 10)
  return Number.isFinite(value) && value > 0 ? value : 300
}

function hmac(payload: string) {
  const secret = getPowSecret()
  return crypto.createHmac("sha256", secret).update(payload).digest("hex")
}

export function createPowChallenge(): PowChallenge {
  const nonce = crypto.randomBytes(16).toString("hex")
  const difficulty = getPowDifficulty()
  const expiresAt = Date.now() + getPowTtlSec() * 1000
  const payload = `${nonce}:${expiresAt}:${difficulty}`
  const signature = hmac(payload)
  const token = Buffer.from(`${payload}:${signature}`, "utf-8").toString(
    "base64url"
  )
  return { token, nonce, expiresAt, difficulty }
}

function hasLeadingZeroBits(hashHex: string, bits: number) {
  let remaining = bits
  for (let i = 0; i < hashHex.length; i += 2) {
    const byte = Number.parseInt(hashHex.slice(i, i + 2), 16)
    if (remaining >= 8) {
      if (byte !== 0) return false
      remaining -= 8
    } else if (remaining > 0) {
      const mask = 0xff << (8 - remaining)
      if ((byte & mask) !== 0) return false
      return true
    } else {
      return true
    }
  }
  return true
}

export function verifyPow({
  token,
  solution,
}: {
  token: string
  solution: string
}) {
  const decoded = Buffer.from(token, "base64url").toString("utf-8")
  const parts = decoded.split(":")
  if (parts.length < 4) return { ok: false, reason: "INVALID_TOKEN" }
  const signature = parts.pop() ?? ""
  const payload = parts.join(":")
  const expected = hmac(payload)
  if (signature !== expected) return { ok: false, reason: "INVALID_SIGNATURE" }

  const [nonce, expiresRaw, difficultyRaw] = parts
  const expiresAt = Number.parseInt(expiresRaw ?? "", 10)
  const difficulty = Number.parseInt(difficultyRaw ?? "", 10)
  if (!nonce || !Number.isFinite(expiresAt) || !Number.isFinite(difficulty)) {
    return { ok: false, reason: "INVALID_PAYLOAD" }
  }
  if (Date.now() > expiresAt) {
    return { ok: false, reason: "EXPIRED" }
  }

  const hash = crypto
    .createHash("sha256")
    .update(`${nonce}:${solution}`)
    .digest("hex")

  if (!hasLeadingZeroBits(hash, difficulty)) {
    return { ok: false, reason: "INVALID_SOLUTION" }
  }

  return { ok: true, nonce, difficulty }
}

export type PowCheckResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; code: "POW_REQUIRED" | "POW_INVALID"; reason?: string }

export function checkPowPayload({
  enabled = isPowEnabled(),
  token,
  solution,
}: {
  enabled?: boolean
  token?: string
  solution?: string
}): PowCheckResult {
  if (!enabled) return { ok: true, skipped: true }
  if (!token || !solution) {
    return { ok: false, code: "POW_REQUIRED" }
  }
  const result = verifyPow({ token, solution })
  if (!result.ok) {
    return { ok: false, code: "POW_INVALID", reason: result.reason }
  }
  return { ok: true }
}
