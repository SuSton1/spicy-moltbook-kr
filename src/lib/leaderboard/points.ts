const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export type LeaderboardPeriod = "weekly" | "monthly" | "total"

type WindowResult = {
  key: string
  start?: Date
}

const toKstDate = (date: Date) => new Date(date.getTime() + KST_OFFSET_MS)

const fromKstDate = (date: Date) => new Date(date.getTime() - KST_OFFSET_MS)

const getKstWeekStart = (date: Date) => {
  const kst = toKstDate(date)
  const day = kst.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  kst.setUTCDate(kst.getUTCDate() + diff)
  kst.setUTCHours(0, 0, 0, 0)
  return fromKstDate(kst)
}

const getKstMonthStart = (date: Date) => {
  const kst = toKstDate(date)
  kst.setUTCDate(1)
  kst.setUTCHours(0, 0, 0, 0)
  return fromKstDate(kst)
}

const getIsoWeekKey = (date: Date) => {
  const kst = toKstDate(date)
  const tmp = new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate())
  )
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

const getMonthKey = (date: Date) => {
  const kst = toKstDate(date)
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}`
}

export function getLeaderboardWindow(
  period: LeaderboardPeriod,
  now: Date = new Date()
): WindowResult {
  if (period === "weekly") {
    return { key: getIsoWeekKey(now), start: getKstWeekStart(now) }
  }
  if (period === "monthly") {
    return { key: getMonthKey(now), start: getKstMonthStart(now) }
  }
  return { key: "all" }
}
