import crypto from "node:crypto"

export function getIpHashSecret() {
  return (
    process.env.IP_HASH_SECRET ??
    process.env.IP_HASH_SALT ??
    process.env.VIEW_HASH_SALT ??
    ""
  )
}

export function hashIpValue(ip: string) {
  const secret = getIpHashSecret()
  if (!secret) {
    return crypto.createHash("sha256").update(ip).digest("hex")
  }
  return crypto
    .createHash("sha256")
    .update(`${ip}|${secret}`)
    .digest("hex")
}

