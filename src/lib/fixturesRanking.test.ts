import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { normalizeQuoteMetrics } from "./kisMetrics"
import {
  sortRankingItems,
  type RankingSortDir,
  type RankingSortKey,
} from "./rankings"
import type { RankingItem } from "../services/api"

type SymbolSnapshotItem = {
  symbol: string
  name: string
  market: string
}

type ContractFixture = {
  symbols: string[]
  quotes: Record<string, { output: Record<string, unknown> }>
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(currentDir, "..", "..", "server", "data")
const loadJson = <T>(file: string) =>
  JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8")) as T

const normalizeNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return null
  }
  const parsed = Number(String(value).replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

const normalizePrice = (value: number | null) => {
  if (value === null || value <= 0) {
    return null
  }
  return value
}

const buildRankingItems = (items: SymbolSnapshotItem[]): RankingItem[] =>
  items.map((item, index) => {
    const price = 12000 + index * 240
    const change = (index % 2 === 0 ? 1 : -1) * (6 + index * 2)
    const changeRate = Number(((change / price) * 100).toFixed(2))
    const volume = 800000 + index * 42000
    const value = price * volume
    return {
      rank: index + 1,
      code: item.symbol,
      name: item.name,
      market: item.market,
      price,
      change,
      changeRate,
      volume,
      value,
      mcap: value * 4.2,
    }
  })

const mergeSymbols = (
  primary: SymbolSnapshotItem[],
  secondary: SymbolSnapshotItem[],
) => {
  const seen = new Set(primary.map((item) => item.symbol))
  const merged = [...primary]
  secondary.forEach((item) => {
    if (seen.has(item.symbol)) {
      return
    }
    seen.add(item.symbol)
    merged.push(item)
  })
  return merged
}

const applyContractOverrides = (
  items: RankingItem[],
  fixture: ContractFixture,
) => {
  const map = new Map(items.map((item) => [item.code, item]))
  fixture.symbols.forEach((code) => {
    const output = fixture.quotes[code]?.output
    if (!output) {
      return
    }
    const metrics = normalizeQuoteMetrics(output)
    const price = normalizePrice(normalizeNumber(output.stck_prpr))
    const change = normalizeNumber(output.prdy_vrss)
    const changeRate = normalizeNumber(output.prdy_ctrt)
    const existing = map.get(code)
    if (!existing) {
      return
    }
    map.set(code, {
      ...existing,
      price,
      change,
      changeRate,
      volume: metrics.volume,
      value: metrics.turnover,
      mcap: metrics.marketCap,
    })
  })
  return Array.from(map.values())
}

const assertTopNotInFirstTen = (
  items: RankingItem[],
  sortKey: RankingSortKey,
  sortDir: RankingSortDir,
  indexMap: Map<string, number>,
) => {
  const sorted = sortRankingItems(items, sortKey, sortDir)
  const topIndex = indexMap.get(sorted[0]?.code ?? "") ?? -1
  expect(topIndex).toBeGreaterThan(9)
}

describe("contract ranking fixtures", () => {
  it("keeps KR top items outside first 10 symbols for all modes", () => {
    const symbols = loadJson<SymbolSnapshotItem[]>("symbols.all.json")
    const fixture = loadJson<ContractFixture>("kis.contract.json")
    const baseItems = buildRankingItems(symbols)
    const contractItems = applyContractOverrides(baseItems, fixture)
    const indexMap = new Map(symbols.map((item, index) => [item.symbol, index]))

    assertTopNotInFirstTen(contractItems, "turnover", "desc", indexMap)
    assertTopNotInFirstTen(contractItems, "volume", "desc", indexMap)
    assertTopNotInFirstTen(contractItems, "changePercent", "desc", indexMap)
    assertTopNotInFirstTen(contractItems, "changePercent", "asc", indexMap)
  })

  it("keeps US top items outside first 10 symbols for all modes", () => {
    const nasdaq = loadJson<SymbolSnapshotItem[]>("symbols.us.nasdaq.json")
    const dow = loadJson<SymbolSnapshotItem[]>("symbols.us.dowjones.json")
    const merged = mergeSymbols(nasdaq, dow)
    const baseItems = buildRankingItems(merged)
    const indexMap = new Map(merged.map((item, index) => [item.symbol, index]))

    assertTopNotInFirstTen(baseItems, "turnover", "desc", indexMap)
    assertTopNotInFirstTen(baseItems, "volume", "desc", indexMap)
    assertTopNotInFirstTen(baseItems, "changePercent", "desc", indexMap)
    assertTopNotInFirstTen(baseItems, "changePercent", "asc", indexMap)
  })
})
