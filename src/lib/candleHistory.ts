import { formatDateInZone, toEpochMsInZone } from "./timezone"

export type DailyCandlePoint = {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export const mergeCandlePointsByTime = (
  pages: DailyCandlePoint[][],
): DailyCandlePoint[] => {
  const map = new Map<string, DailyCandlePoint>()
  pages.forEach((page) => {
    page.forEach((point) => {
      if (!point.time) {
        return
      }
      map.set(point.time, point)
    })
  })
  return Array.from(map.values()).sort((a, b) => a.time.localeCompare(b.time))
}

export const subtractDaysYmd = (
  ymd: string,
  days: number,
  timeZone: string,
) => {
  const epochMs = toEpochMsInZone(ymd, timeZone)
  if (!epochMs) {
    return null
  }
  const next = new Date(epochMs - days * 86400000)
  return formatDateInZone(next, timeZone)
}

export const resolveHistoryWindowDays = (
  period: "D" | "W" | "M",
  minPoints?: number | null,
) => {
  const target = Math.max(0, Number(minPoints ?? 0))
  if (target <= 0) {
    return 3650
  }
  if (period === "D") {
    return Math.min(3650, Math.max(200, Math.round(target * 2.2)))
  }
  if (period === "W") {
    return Math.min(3650, Math.max(400, Math.round(target * 14)))
  }
  return Math.min(3650, Math.max(720, Math.round(target * 60)))
}
