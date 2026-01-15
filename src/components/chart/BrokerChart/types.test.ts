import { describe, expect, it } from "vitest"
import { calcChangeMetrics, resolvePrevClose } from "./types"

describe("broker chart model", () => {
  it("derives prevClose from quote when available", () => {
    expect(resolvePrevClose({ price: 105, change: 5 }, null)).toBe(100)
    expect(resolvePrevClose({ price: 105, change: -5 }, null)).toBe(110)
  })

  it("falls back to provided value when quote is missing", () => {
    expect(resolvePrevClose({ price: 0, change: 5 }, 100)).toBe(100)
    expect(resolvePrevClose(null, 120)).toBe(120)
  })

  it("computes change and changeRate consistently", () => {
    expect(calcChangeMetrics(105, 100)).toEqual({ change: 5, changeRate: 5 })
    expect(calcChangeMetrics(95, 100)).toEqual({ change: -5, changeRate: -5 })
  })
})
