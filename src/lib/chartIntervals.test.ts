import { describe, expect, it } from "vitest"
import {
  INTRADAY_INTERVALS,
  resolveIntradayInterval,
  resolveKrProviderMinutes,
  resolveUsProviderMinutes,
} from "./chartIntervals"

describe("intraday interval model", () => {
  it("includes the required 8 options", () => {
    const keys = INTRADAY_INTERVALS.map((item) => item.key)
    expect(keys).toEqual(["1m", "3m", "5m", "10m", "15m", "30m", "1h", "4h"])
  })

  it("resolves interval values consistently", () => {
    const interval = resolveIntradayInterval("10m")
    expect(interval.label).toBe("10분")
    expect(interval.minutes).toBe(10)
  })

  it("maps 4h to a 60m provider interval for US", () => {
    const mapping = resolveUsProviderMinutes("4h")
    expect(mapping.providerMinutes).toBe(60)
    expect(mapping.aggregateMinutes).toBe(240)
  })

  it("clamps KR intraday to 1-day 1m provider requests", () => {
    const mapping = resolveKrProviderMinutes("5m", 3)
    expect(mapping.requestMinutes).toBe(1)
    expect(mapping.aggregateMinutes).toBe(5)
    expect(mapping.days).toBe(1)
  })
})
