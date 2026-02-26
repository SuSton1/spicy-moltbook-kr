import { normalizeDateKey } from "../ai-date-range.lib.mjs"

export const toWeekKeyKst = (dateKey) => {
  const normalized = normalizeDateKey(dateKey)
  if (!normalized) {
    return "unknown"
  }
  const [y, m, d] = normalized.split("-").map((v) => Number(v))
  if (!y || !m || !d) {
    return "unknown"
  }
  const date = new Date(Date.UTC(y, m - 1, d))
  const dow = date.getUTCDay()
  const diff = dow === 0 ? -6 : 1 - dow
  date.setUTCDate(date.getUTCDate() + diff)
  const yy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
  return `${yy}-W${mm}${dd}`
}
