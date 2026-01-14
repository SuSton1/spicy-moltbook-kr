import { describe, expect, it } from "vitest"
import {
  decodeRankingCursor,
  encodeRankingCursor,
  buildRankingCacheKey,
  readCache,
  sortRankingItems,
  writeCache,
} from "./rankings"

describe("sortRankingItems", () => {
  it("sorts by volume desc and pushes nulls last", () => {
    const sorted = sortRankingItems(
      [
        {
          rank: 0,
          code: "000002",
          name: "B",
          market: "KOSPI",
          price: 12000,
          change: 10,
          changeRate: 0.2,
          volume: null,
          value: 1,
          mcap: 1,
        },
        {
          rank: 0,
          code: "000003",
          name: "C",
          market: "KOSPI",
          price: 12000,
          change: 10,
          changeRate: 0.2,
          volume: 100,
          value: 1,
          mcap: 1,
        },
        {
          rank: 0,
          code: "000001",
          name: "A",
          market: "KOSPI",
          price: 12000,
          change: 10,
          changeRate: 0.2,
          volume: 100,
          value: 1,
          mcap: 1,
        },
        {
          rank: 0,
          code: "000004",
          name: "D",
          market: "KOSPI",
          price: 12000,
          change: 10,
          changeRate: 0.2,
          volume: 10,
          value: 1,
          mcap: 1,
        },
      ],
      "volume",
      "desc",
    )

    expect(sorted.map((item) => item.code)).toEqual([
      "000001",
      "000003",
      "000004",
      "000002",
    ])
  })

  it("sorts by changePercent asc for losers", () => {
    const sorted = sortRankingItems(
      [
        {
          rank: 0,
          code: "000001",
          name: "A",
          market: "KOSPI",
          price: 12000,
          change: 10,
          changeRate: 1.2,
          volume: 1,
          value: 1,
          mcap: 1,
        },
        {
          rank: 0,
          code: "000002",
          name: "B",
          market: "KOSPI",
          price: 12000,
          change: -10,
          changeRate: -2.4,
          volume: 1,
          value: 1,
          mcap: 1,
        },
        {
          rank: 0,
          code: "000003",
          name: "C",
          market: "KOSPI",
          price: 12000,
          change: 5,
          changeRate: 0.4,
          volume: 1,
          value: 1,
          mcap: 1,
        },
      ],
      "changePercent",
      "asc",
    )

    expect(sorted.map((item) => item.code)).toEqual([
      "000002",
      "000003",
      "000001",
    ])
  })

  it("sorts by marketCap desc with stable tie-break", () => {
    const sorted = sortRankingItems(
      [
        {
          rank: 0,
          code: "000002",
          name: "B",
          market: "KOSPI",
          price: 12000,
          change: 10,
          changeRate: 0.2,
          volume: 1,
          value: 1,
          mcap: 500,
        },
        {
          rank: 0,
          code: "000001",
          name: "A",
          market: "KOSPI",
          price: 12000,
          change: 10,
          changeRate: 0.2,
          volume: 1,
          value: 1,
          mcap: 500,
        },
        {
          rank: 0,
          code: "000003",
          name: "C",
          market: "KOSPI",
          price: 12000,
          change: 10,
          changeRate: 0.2,
          volume: 1,
          value: 1,
          mcap: 200,
        },
        {
          rank: 0,
          code: "000004",
          name: "D",
          market: "KOSPI",
          price: 12000,
          change: 10,
          changeRate: 0.2,
          volume: 1,
          value: 1,
          mcap: null,
        },
      ],
      "marketCap",
      "desc",
    )

    expect(sorted.map((item) => item.code)).toEqual([
      "000001",
      "000002",
      "000003",
      "000004",
    ])
  })
})

describe("ranking cursor", () => {
  it("encodes and decodes cursor payloads", () => {
    const payload = {
      offset: 50,
      sortKey: "volume",
      sortDir: "desc",
      market: "ALL",
      query: "",
      cacheKey: "rankings:volume:desc:ALL",
    } as const
    const cursor = encodeRankingCursor(payload)
    expect(decodeRankingCursor(cursor)).toEqual(payload)
  })
})

describe("ranking cache key", () => {
  it("includes region, mode, sort, and query", () => {
    const key = buildRankingCacheKey({
      region: "US",
      mode: "volume",
      sortKey: "volume",
      sortDir: "desc",
      query: "AAPL",
      version: 42,
    })
    expect(key).toContain("US")
    expect(key).toContain("volume")
    expect(key).toContain("desc")
    expect(key).toContain("aapl")
    expect(key).toContain("42")
  })
})

describe("ranking cache", () => {
  it("returns cached entries while valid", () => {
    const cache = new Map()
    writeCache(cache, "key", ["item"], 1000, 100)
    expect(readCache(cache, "key", 500)).toEqual(["item"])
    expect(readCache(cache, "key", 1200)).toBeNull()
  })
})
