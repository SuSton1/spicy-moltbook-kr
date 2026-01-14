import { describe, expect, it } from "vitest"
import { normalizeNasdaqQuote } from "./usMetrics"

describe("normalizeNasdaqQuote", () => {
  it("parses numeric fields from nasdaq payloads", () => {
    const info = {
      data: {
        primaryData: {
          lastSalePrice: "$260.90",
          netChange: "-0.15",
          percentageChange: "-0.06%",
          volume: "45,715,005",
        },
      },
    }
    const summary = {
      data: {
        summaryData: {
          MarketCap: { value: "3,836,893,582,300" },
        },
      },
    }
    const result = normalizeNasdaqQuote(info, summary)

    expect(result.price).toBeCloseTo(260.9)
    expect(result.change).toBeCloseTo(-0.15)
    expect(result.changeRate).toBeCloseTo(-0.06)
    expect(result.volume).toBe(45715005)
    expect(result.marketCap).toBe(3836893582300)
    expect(result.missingKeys).toEqual([])
  })
})
