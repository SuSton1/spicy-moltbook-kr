export const DEFAULT_LIMIT = 30
const ENV_MAX_LIMIT = Number.parseInt(process.env.PAGINATION_MAX ?? "50", 10)
export const MAX_LIMIT =
  Number.isFinite(ENV_MAX_LIMIT) && ENV_MAX_LIMIT > 0 ? ENV_MAX_LIMIT : 50
const MAX_QUERY_LENGTH = Number.parseInt(
  process.env.SEARCH_QUERY_MAX ?? "120",
  10
)
export const MAX_PAGE = 200

export function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(parsed, MAX_LIMIT)
  }
  return DEFAULT_LIMIT
}

export function encodeCursor(offset: number) {
  return Buffer.from(String(offset), "utf8").toString("base64")
}

export function decodeCursor(cursor: string) {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8")
    const value = Number.parseInt(decoded, 10)
    if (!Number.isFinite(value) || value < 0) return null
    return value
  } catch {
    return null
  }
}

export function validateSearchQuery(q: string | null) {
  if (!q) return null
  if (q.trim().length < 2) {
    return "검색어는 2자 이상 입력해주세요."
  }
  if (MAX_QUERY_LENGTH > 0 && q.trim().length > MAX_QUERY_LENGTH) {
    return `검색어는 ${MAX_QUERY_LENGTH}자 이내로 입력해주세요.`
  }
  return null
}

export function validatePageDepth(page: number) {
  if (page > MAX_PAGE) {
    return "페이지가 너무 깊습니다. 검색을 사용해 주세요."
  }
  return null
}
