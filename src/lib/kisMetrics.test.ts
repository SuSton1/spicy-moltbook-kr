import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { describe, expect, it } from "vitest"
import {
  KIS_QUOTE_FIELDS,
  MARKET_CAP_SCALE,
  normalizeQuoteMetrics,
} from "./kisMetrics"

const parseNumeric = (value: unknown) =>
  Number(String(value ?? "").replace(/,/g, ""))

describe("normalizeQuoteMetrics", () => {
  it("parses KIS quote metrics with correct scaling", () => {
    const fixturePath = path.join(
      process.cwd(),
      "server",
      "data",
      "kis.contract.json",
    )
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
      symbols: string[]
      quotes: Record<string, { output: Record<string, unknown> }>
    }
    const code = fixture.symbols[0]
    const output = fixture.quotes[code].output
    const result = normalizeQuoteMetrics(output)

    expect(result.volume).toBe(parseNumeric(output[KIS_QUOTE_FIELDS.volume]))
    expect(result.turnover).toBe(
      parseNumeric(output[KIS_QUOTE_FIELDS.turnover]),
    )
    expect(result.marketCap).toBe(
      parseNumeric(output[KIS_QUOTE_FIELDS.marketCap]) * MARKET_CAP_SCALE,
    )
    expect(result.missingKeys).toHaveLength(0)
  })
})
