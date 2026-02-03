import crypto from "crypto"

export const VIEW_WINDOW_MINUTES = 10

export function getViewWindowStart(date: Date, windowMinutes = VIEW_WINDOW_MINUTES) {
  const ms = windowMinutes * 60 * 1000
  const timestamp = Math.floor(date.getTime() / ms) * ms
  return new Date(timestamp)
}

export function buildViewerKeyHash({
  userId,
  ip,
  userAgent,
  salt,
}: {
  userId?: string | null
  ip?: string | null
  userAgent?: string | null
  salt: string
}) {
  const base = userId
    ? `u:${userId}`
    : `a:${ip ?? ""}|${userAgent ?? ""}|${salt}`
  return crypto.createHash("sha256").update(base).digest("hex")
}

export function shouldCountView(
  store: Set<string>,
  key: string
) {
  if (store.has(key)) return false
  store.add(key)
  return true
}
