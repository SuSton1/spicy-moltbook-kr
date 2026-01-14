import { describe, expect, it } from "vitest"
import { paginateSymbols, parseSymbolLines } from "./symbols"

describe("parseSymbolLines", () => {
  it("parses pipe-delimited records", () => {
    const content = "005930|삼성전자|KOSPI\n000660|SK하이닉스|KOSPI"
    const items = parseSymbolLines(content, "KOSPI", "2024-01-01T00:00:00Z")

    expect(items).toHaveLength(2)
    expect(items[0].symbol).toBe("005930")
    expect(items[0].name).toBe("삼성전자")
    expect(items[0].market).toBe("KOSPI")
  })

  it("parses fixed-width records", () => {
    const name = "모베이스전자"
    const content = `012860   KR7012860009${name.padEnd(36, " ")}\n`
    const items = parseSymbolLines(content, "KOSDAQ", "2024-01-01T00:00:00Z")

    expect(items).toHaveLength(1)
    expect(items[0].symbol).toBe("012860")
    expect(items[0].name).toBe(name)
    expect(items[0].market).toBe("KOSDAQ")
  })

  it("parses alphanumeric fixed-width codes", () => {
    const name = "한투미국경제주도1(A)"
    const content = `F70100022KR5701000220${name.padEnd(36, " ")}\n`
    const items = parseSymbolLines(content, "KOSPI", "2024-01-01T00:00:00Z")

    expect(items).toHaveLength(1)
    expect(items[0].symbol).toBe("F70100")
    expect(items[0].name).toBe(name)
  })
})

describe("paginateSymbols", () => {
  it("paginates with cursor", () => {
    const items = Array.from({ length: 25 }).map((_, index) => ({
      symbol: String(index).padStart(6, "0"),
      name: `TEST ${index}`,
      market: "KOSPI" as const,
      kind: "UNKNOWN" as const,
      status: "UNKNOWN" as const,
      updatedAt: "2024-01-01T00:00:00Z",
    }))

    const first = paginateSymbols(items, null, 10)
    expect(first.items).toHaveLength(10)
    expect(first.nextCursor).not.toBeNull()
    expect(first.hasMore).toBe(true)
    expect(first.totalCount).toBe(25)

    const second = paginateSymbols(items, first.nextCursor, 10)
    expect(second.items).toHaveLength(10)
    expect(second.items[0].symbol).toBe("000010")
    expect(second.hasMore).toBe(true)

    const third = paginateSymbols(items, second.nextCursor, 10)
    expect(third.items).toHaveLength(5)
    expect(third.hasMore).toBe(false)
  })
})
