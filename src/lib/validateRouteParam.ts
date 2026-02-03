export function isValidParamString(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed === "undefined" || trimmed === "null") return false
  return true
}

export function validateRequiredParam(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== "string") return null
  if (!isValidParamString(raw)) return null
  return raw.trim()
}
