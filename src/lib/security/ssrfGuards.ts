const DEFAULT_ALLOWLIST = (process.env.SSRF_ALLOWLIST ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)

export function isAllowlistedUrl(input: string) {
  try {
    const url = new URL(input)
    if (DEFAULT_ALLOWLIST.length === 0) return false
    return DEFAULT_ALLOWLIST.some((host) => url.hostname === host)
  } catch {
    return false
  }
}

export function assertAllowedUrl(input: string) {
  if (!isAllowlistedUrl(input)) {
    throw new Error("SSRF_BLOCKED")
  }
}

