import { describe, expect, it } from "vitest"
import {
  aggregateIntradayCandles,
  buildIntradayTimeKey,
  type IntradayCandle,
  limitCandlesByDays,
  normalizeCandleSeries,
  shiftIntradayToSessionStart,
} from "./intraday"
import { SESSION_WINDOWS } from "./session"

const buildCandle = (
  time: string,
  open: number,
  close: number,
  volume: number,
): IntradayCandle => ({
  time,
  open,
  high: Math.max(open, close) + 0.5,
  low: Math.min(open, close) - 0.5,
  close,
  volume,
})

describe("intraday helpers", () => {
  it("builds a compact time key", () => {
    expect(buildIntradayTimeKey("2024-02-01", "09:30:05")).toBe("202402010930")
    expect(buildIntradayTimeKey("20240201", "930")).toBe("202402010009")
  })

  it("normalizes and de-duplicates candles", () => {
    const candles: IntradayCandle[] = [
      buildCandle("202402190900", 10, 11, 100),
      buildCandle("202402190900", 10, 12, 120),
      buildCandle("202402190901", 11, 10, 80),
    ]
    const normalized = normalizeCandleSeries(candles)
    expect(normalized).toHaveLength(2)
    expect(normalized[0].time).toBe("202402190900")
    expect(normalized[1].time).toBe("202402190901")
  })

  it("aggregates 1m candles into 5m buckets", () => {
    const candles: IntradayCandle[] = [
      buildCandle("202402190900", 10, 11, 100),
      buildCandle("202402190901", 11, 12, 110),
      buildCandle("202402190902", 12, 13, 120),
      buildCandle("202402190903", 13, 14, 130),
      buildCandle("202402190904", 14, 15, 140),
      buildCandle("202402190905", 15, 16, 150),
    ]
    const aggregated = aggregateIntradayCandles(candles, 5)
    expect(aggregated).toHaveLength(2)
    expect(aggregated[0].time).toBe("202402190900")
    expect(aggregated[0].volume).toBe(600)
    expect(aggregated[1].time).toBe("202402190905")
  })

  it("limits candles to the most recent days", () => {
    const candles: IntradayCandle[] = [
      buildCandle("202402190900", 10, 11, 100),
      buildCandle("202402200900", 11, 12, 110),
      buildCandle("202402210900", 12, 13, 120),
    ]
    const limited = limitCandlesByDays(candles, 2)
    expect(limited).toHaveLength(2)
    expect(limited[0].time.startsWith("20240220")).toBe(true)
    expect(limited[1].time.startsWith("20240221")).toBe(true)
  })

  it("shifts end-time candles back to session start when needed", () => {
    const candles: IntradayCandle[] = [
      buildCandle("202402190915", 10, 11, 100),
      buildCandle("202402190930", 11, 12, 110),
    ]
    const shifted = shiftIntradayToSessionStart(
      candles,
      15,
      SESSION_WINDOWS.KRX,
    )
    expect(shifted[0].time).toBe("202402190900")
    expect(shifted[1].time).toBe("202402190915")
  })
})
