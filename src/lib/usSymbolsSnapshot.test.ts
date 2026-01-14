import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { describe, expect, it } from "vitest"
import { mergeUsSymbols } from "./usSymbols"
import type { SymbolItem } from "./symbols"

const loadSnapshot = (fileName: string) => {
  const filePath = path.join(process.cwd(), "server", "data", fileName)
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as SymbolItem[]
}

describe("US symbol snapshots", () => {
  it("nasdaq snapshot is large and includes known tickers", () => {
    const nasdaq = loadSnapshot("symbols.us.nasdaq.json")
    expect(nasdaq.length).toBeGreaterThan(1000)
    const symbols = new Set(nasdaq.map((item) => item.symbol))
    expect(symbols.has("AAPL")).toBe(true)
    expect(symbols.has("MSFT")).toBe(true)
    expect(symbols.has("AMZN")).toBe(true)
  })

  it("dow jones snapshot has 30 constituents", () => {
    const dow = loadSnapshot("symbols.us.dowjones.json")
    expect(dow.length).toBe(30)
    const symbols = new Set(dow.map((item) => item.symbol))
    expect(symbols.has("AAPL")).toBe(true)
    expect(symbols.has("MSFT")).toBe(true)
    expect(symbols.has("JNJ")).toBe(true)
  })

  it("US_ALL union includes NASDAQ + Dow and dedups", () => {
    const nasdaq = loadSnapshot("symbols.us.nasdaq.json")
    const dow = loadSnapshot("symbols.us.dowjones.json")
    const merged = mergeUsSymbols(nasdaq, dow)
    const symbols = new Set(merged.map((item) => item.symbol))
    expect(symbols.has("NVDA")).toBe(true)
    expect(symbols.has("JNJ")).toBe(true)
    expect(merged.length).toBeGreaterThan(nasdaq.length)
  })
})
