import crypto from "node:crypto"

const DEFAULT_PREFIX = "smagt_"

export function hashToken(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

export function generateToken(prefix = DEFAULT_PREFIX) {
  const random = crypto.randomBytes(32).toString("base64url")
  return `${prefix}${random}`
}

export function maskToken(raw: string) {
  if (!raw) return ""
  const prefixMatch = raw.startsWith(DEFAULT_PREFIX) ? DEFAULT_PREFIX : raw.slice(0, 6)
  const suffix = raw.slice(-4)
  return `${prefixMatch}****${suffix}`
}
