export type IndexSnapshot = {
  price?: number
  change?: number
  changeRate?: number
}

export type IndexDailyPoint = {
  date: string
  close: number
  change?: number
  changeRate?: number
}

export type IndexResolved = {
  price: number
  change: number
  changeRate: number
  refDate?: string
  isFallback: boolean
}

export const resolveIndexFallback = (
  snapshot: IndexSnapshot,
  dailyPoints: IndexDailyPoint[],
): IndexResolved => {
  const basePrice = snapshot.price ?? 0
  const baseChange = snapshot.change ?? 0
  const baseChangeRate = snapshot.changeRate ?? 0

  if (basePrice > 0) {
    return {
      price: basePrice,
      change: baseChange,
      changeRate: baseChangeRate,
      isFallback: false,
    }
  }

  const sorted = [...dailyPoints].sort((a, b) => a.date.localeCompare(b.date))
  const fallback = [...sorted].reverse().find((item) => item.close > 0)

  if (!fallback) {
    return {
      price: basePrice,
      change: baseChange,
      changeRate: baseChangeRate,
      isFallback: false,
    }
  }

  return {
    price: fallback.close,
    change: fallback.change ?? baseChange,
    changeRate: fallback.changeRate ?? baseChangeRate,
    refDate: fallback.date,
    isFallback: true,
  }
}
