import { normalizeDateKey } from "../ai-date-range.lib.mjs"
import { normalizeRegimeTag } from "./patternVersions.mjs"

export const resolveMarketRegimeForDate = async ({ prisma, dateKey }) => {
  const asOfDateKey = normalizeDateKey(dateKey)
  if (!asOfDateKey || !prisma) {
    return { dateKey: null, regime: null }
  }

  const row = await prisma.marketRegimeDay
    .findFirst({
      where: { dateKey: { lte: asOfDateKey } },
      orderBy: { dateKey: "desc" },
      select: { dateKey: true, regime: true },
    })
    .catch(() => null)

  if (!row?.dateKey) {
    return { dateKey: null, regime: null }
  }

  return {
    dateKey: String(row.dateKey),
    regime: normalizeRegimeTag(row.regime),
  }
}
