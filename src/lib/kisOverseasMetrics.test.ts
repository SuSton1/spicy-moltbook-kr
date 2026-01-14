import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { describe, expect, it } from "vitest"
import {
  KIS_US_QUOTE_FIELDS,
  normalizeOverseasQuoteMetrics,
} from "./kisOverseasMetrics"

const parseNumeric = (value: unknown) =>
  Number(
    String(value ?? "")
      .replace(/[$,%]/g, "")
      .replace(/,/g, ""),
  )

describe("normalizeOverseasQuoteMetrics", () => {
  it("parses KIS US price output", () => {
    const fixturePath = path.join(
      process.cwd(),
      "server",
      "data",
      "kis.us.contract.json",
    )
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
      symbols: Record<
        string,
        { price: Record<string, unknown>; detail: Record<string, unknown> }
      >
    }
    const output = fixture.symbols.AAPL.price
    const result = normalizeOverseasQuoteMetrics(output)

    expect(result.price).toBe(parseNumeric(output[KIS_US_QUOTE_FIELDS.price]))
    expect(result.change).toBe(parseNumeric(output[KIS_US_QUOTE_FIELDS.change]))
    expect(result.changeRate).toBe(
      parseNumeric(output[KIS_US_QUOTE_FIELDS.changeRate]),
    )
    expect(result.volume).toBe(parseNumeric(output[KIS_US_QUOTE_FIELDS.volume]))
    expect(result.turnover).toBe(
      parseNumeric(output[KIS_US_QUOTE_FIELDS.turnover]),
    )
    expect(result.marketCap).toBeNull()
    expect(result.missingKeys).toContain(KIS_US_QUOTE_FIELDS.marketCap)
  })

  it("parses market cap from detail output", () => {
    const fixturePath = path.join(
      process.cwd(),
      "server",
      "data",
      "kis.us.contract.json",
    )
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
      symbols: Record<
        string,
        { price: Record<string, unknown>; detail: Record<string, unknown> }
      >
    }
    const output = fixture.symbols.AAPL.detail
    const result = normalizeOverseasQuoteMetrics(output)

    expect(result.price).toBe(parseNumeric(output[KIS_US_QUOTE_FIELDS.price]))
    expect(result.volume).toBe(parseNumeric(output[KIS_US_QUOTE_FIELDS.volume]))
    expect(result.turnover).toBe(
      parseNumeric(output[KIS_US_QUOTE_FIELDS.turnover]),
    )
    expect(result.marketCap).toBe(
      parseNumeric(output[KIS_US_QUOTE_FIELDS.marketCap]),
    )
    expect(result.missingKeys).toHaveLength(0)
  })
})
