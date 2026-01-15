import { describe, expect, it } from "vitest"
import type { UTCTimestamp } from "lightweight-charts"
import type { Candle as ApiCandle } from "../../../services/api"
import {
  findNearestCandleAtOrBefore,
  normalizeCandleSeries,
} from "./useChartData"

describe("broker chart candle utilities", () => {
  it("selects the nearest prior candle for a given time", () => {
    const candles = normalizeCandleSeries(
      [
        { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { time: 2, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { time: 4, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      ],
      "Asia/Seoul",
    )
    expect(findNearestCandleAtOrBefore(candles, 3 as UTCTimestamp)?.time).toBe(
      2,
    )
    expect(findNearestCandleAtOrBefore(candles, 4 as UTCTimestamp)?.time).toBe(
      4,
    )
    expect(findNearestCandleAtOrBefore(candles, 0 as UTCTimestamp)).toBeNull()
  })

  it("normalizes candle series by sorting and de-duplicating times", () => {
    const points: ApiCandle[] = [
      { time: 3, open: 1, high: 1, low: 1, close: 1, volume: 10 },
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 10 },
      { time: 3, open: 9, high: 9, low: 9, close: 9, volume: 99 },
    ]
    const normalized = normalizeCandleSeries(points, "Asia/Seoul")
    expect(normalized.map((item) => item.time)).toEqual([1, 3])
    expect(normalized[1]?.open).toBe(9)
    expect(normalized[1]?.volume).toBe(99)
  })
})
