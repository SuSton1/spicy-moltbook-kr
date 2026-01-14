import fs from "node:fs"
import path from "node:path"
import type { SymbolItem } from "../src/lib/symbols"
import { mergeUsSymbols, normalizeUsTickerForKis } from "../src/lib/usSymbols"

export type UsSymbolGroup = "NASDAQ" | "DOWJONES" | "ALL"

type Snapshot = {
  items: SymbolItem[]
  mtimeMs: number
}

const cache: Partial<Record<Lowercase<UsSymbolGroup>, Snapshot>> = {}

const resolveFilePath = (dataDir: string, group: UsSymbolGroup) =>
  path.join(dataDir, `symbols.us.${group.toLowerCase()}.json`)

const readSnapshot = (
  dataDir: string,
  group: Exclude<UsSymbolGroup, "ALL">,
) => {
  const filePath = resolveFilePath(dataDir, group)
  if (!fs.existsSync(filePath)) {
    return null
  }
  const stat = fs.statSync(filePath)
  const raw = fs.readFileSync(filePath, "utf8")
  return {
    items: JSON.parse(raw) as SymbolItem[],
    mtimeMs: stat.mtimeMs,
  }
}

export const getUsSymbols = (dataDir: string, group: UsSymbolGroup) => {
  const key = group.toLowerCase() as Lowercase<UsSymbolGroup>
  if (group === "ALL") {
    const nasdaq = readSnapshot(dataDir, "NASDAQ")
    const dow = readSnapshot(dataDir, "DOWJONES")
    if (!nasdaq && !dow) {
      cache[key] = undefined
      return null
    }
    const version = Math.max(nasdaq?.mtimeMs ?? 0, dow?.mtimeMs ?? 0)
    const cached = cache[key]
    if (!cached || cached.mtimeMs !== version) {
      cache[key] = {
        items: mergeUsSymbols(nasdaq?.items ?? [], dow?.items ?? []),
        mtimeMs: version,
      }
    }
    return cache[key] ?? null
  }

  const snapshot = readSnapshot(dataDir, group)
  if (!snapshot) {
    cache[key] = undefined
    return null
  }
  const cached = cache[key]
  if (!cached || cached.mtimeMs !== snapshot.mtimeMs) {
    cache[key] = snapshot
  }
  return cache[key] ?? null
}

export const normalizeUsTickerForProvider = (
  provider: "yahoo" | "nasdaq" | "kis" | "default",
  code: string,
) => {
  const trimmed = code.trim().toUpperCase()
  if (!trimmed) {
    return trimmed
  }
  if (provider === "kis") {
    return normalizeUsTickerForKis(trimmed)
  }
  if (provider === "yahoo") {
    return trimmed.replace(/\./g, "-")
  }
  if (provider === "nasdaq") {
    return trimmed.replace(/-/g, ".")
  }
  return trimmed
}
