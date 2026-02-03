export function safeRedirectTarget(raw: string | null | undefined) {
  if (!raw) return null
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return raw
  }
  return null
}

