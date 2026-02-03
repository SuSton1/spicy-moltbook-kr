const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/g

export function normalizeNickname(raw: string): string {
  const cleaned = raw.replace(ZERO_WIDTH_REGEX, "")
  const normalized = cleaned.normalize("NFKC")
  return normalized.trim().replace(/\s+/g, " ").toLowerCase()
}

export function normalizeNicknameOriginal(raw: string): string {
  const cleaned = raw.replace(ZERO_WIDTH_REGEX, "")
  const normalized = cleaned.normalize("NFKC")
  return normalized.trim().replace(/\s+/g, " ")
}
