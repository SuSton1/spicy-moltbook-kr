import { describe, expect, it } from "vitest"
import {
  mergeCandlePointsByTime,
  resolveHistoryWindowDays,
  subtractDaysYmd,
  type DailyCandlePoint,
} from "./candleHistory"

describe("candleHistory", () => {
  it("merges and dedups daily points by time", () => {
    const page1: DailyCandlePoint[] = [
      { time: "20241001", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: "20241002", open: 2, high: 2, low: 2, close: 2, volume: 2 },
    ]
    const page2: DailyCandlePoint[] = [
      { time: "20240930", open: 3, high: 3, low: 3, close: 3, volume: 3 },
      { time: "20241001", open: 9, high: 9, low: 9, close: 9, volume: 9 },
    ]
    const merged = mergeCandlePointsByTime([page1, page2])
    expect(merged.map((item) => item.time)).toEqual([
      "20240930",
      "20241001",
      "20241002",
    ])
    expect(merged.find((item) => item.time === "20241001")?.close).toBe(9)
  })

  it("subtracts days from ymd in a timezone", () => {
    expect(subtractDaysYmd("20250101", 1, "Asia/Seoul")).toBe("20241231")
  })

  it("computes window days large enough to cover history", () => {
    expect(resolveHistoryWindowDays("D", 260)).toBeGreaterThanOrEqual(520)
    expect(resolveHistoryWindowDays("W", 156)).toBeGreaterThanOrEqual(1000)
    expect(resolveHistoryWindowDays("M", 60)).toBeGreaterThanOrEqual(3000)
  })
})
