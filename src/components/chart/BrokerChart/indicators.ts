import type { LineData } from "lightweight-charts"
import type { BrokerCandle } from "./types"

export const simpleMovingAverage = (
  candles: BrokerCandle[],
  period: number,
): LineData[] => {
  if (period <= 0) {
    return []
  }
  const result: LineData[] = []
  let sum = 0
  for (let i = 0; i < candles.length; i += 1) {
    sum += candles[i].close
    if (i >= period) {
      sum -= candles[i - period].close
    }
    if (i >= period - 1) {
      result.push({
        time: candles[i].time,
        value: sum / period,
      })
    }
  }
  return result
}
