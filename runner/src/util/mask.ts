export function maskSecret(value: string, visibleStart = 6, visibleEnd = 4) {
  if (!value) return ""
  if (value.length <= visibleStart + visibleEnd) return "****"
  return `${value.slice(0, visibleStart)}****${value.slice(-visibleEnd)}`
}
