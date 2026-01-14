import { describe, expect, it } from "vitest"
import { resolveIndexFallback } from "./indexFallback"

describe("resolveIndexFallback", () => {
  it("returns snapshot when price is valid", () => {
    const resolved = resolveIndexFallback(
      { price: 2500, change: 12, changeRate: 0.5 },
      [],
    )

    expect(resolved.isFallback).toBe(false)
    expect(resolved.price).toBe(2500)
  })

  it("uses latest non-zero daily close when snapshot is zero", () => {
    const resolved = resolveIndexFallback(
      { price: 0, change: 0, changeRate: 0 },
      [
        { date: "2024-01-01", close: 0 },
        { date: "2024-01-02", close: 2501, change: 10, changeRate: 0.4 },
      ],
    )

    expect(resolved.isFallback).toBe(true)
    expect(resolved.price).toBe(2501)
    expect(resolved.refDate).toBe("2024-01-02")
  })
})
