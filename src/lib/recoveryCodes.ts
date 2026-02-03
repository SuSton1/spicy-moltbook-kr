import crypto from "node:crypto"

const DEFAULT_COUNT = 10

export function newRecoverySalt() {
  return crypto.randomBytes(16).toString("hex")
}

export function normalizeRecoveryCode(raw: string) {
  return raw.replace(/[^a-fA-F0-9]/g, "").toLowerCase()
}

export function formatRecoveryCode(rawHex: string) {
  const cleaned = normalizeRecoveryCode(rawHex)
  return cleaned.match(/.{1,4}/g)?.join("-") ?? cleaned
}

export function generateRecoveryCode() {
  const raw = crypto.randomBytes(16).toString("hex")
  return formatRecoveryCode(raw)
}

export function generateRecoveryCodes(count = DEFAULT_COUNT) {
  const codes: string[] = []
  for (let i = 0; i < count; i += 1) {
    codes.push(generateRecoveryCode())
  }
  return codes
}

export function hashRecoveryCode(raw: string, salt: string) {
  const normalized = normalizeRecoveryCode(raw)
  return crypto
    .createHash("sha256")
    .update(`${normalized}:${salt}`)
    .digest("hex")
}

export function hashRecoveryCodeGlobal(raw: string) {
  const normalized = normalizeRecoveryCode(raw)
  return crypto.createHash("sha256").update(normalized).digest("hex")
}
