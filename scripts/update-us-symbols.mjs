import fs from "node:fs"
import path from "node:path"
import { load } from "cheerio"

const rootDir = process.cwd()
const dataDir = path.join(rootDir, "server", "data")

const NASDAQ_URL =
  "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
const OTHER_LISTED_URL =
  "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"
const DOWJONES_URL = "https://www.slickcharts.com/dowjones"

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/plain" },
  })
  if (!response.ok) {
    throw new Error(`US symbols fetch failed: ${response.status}`)
  }
  return response.text()
}

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const normalizeSymbol = (value) => value.trim().toUpperCase()

const normalizeProviderSymbol = (symbol) => symbol.replace(/\./g, "-")

const buildItem = ({
  symbol,
  name,
  market,
  updatedAt,
  exchange,
  isEtf,
  securityType,
}) => ({
  symbol,
  code: symbol,
  name,
  market,
  exchange,
  isEtf,
  securityType,
  providerSymbol: normalizeProviderSymbol(symbol),
  kind: isEtf ? "ETF" : "STOCK",
  status: "LISTED",
  updatedAt,
})

const parseNasdaqListed = (content, updatedAt) => {
  const lines = content.split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) {
    return []
  }
  const headers = lines[0].split("|").map((header) => header.trim())
  const index = new Map(headers.map((header, idx) => [header, idx]))
  const readField = (row, field) => row[index.get(field) ?? -1] ?? ""
  const items = []

  for (const line of lines.slice(1)) {
    if (!line || line.startsWith("File Creation Time")) {
      continue
    }
    const row = line.split("|")
    const symbol = normalizeSymbol(readField(row, "Symbol"))
    if (!symbol) {
      continue
    }
    const testIssue = readField(row, "Test Issue").trim()
    if (testIssue !== "N") {
      continue
    }
    const name = readField(row, "Security Name").trim()
    if (!name) {
      continue
    }
    const etfFlag = readField(row, "ETF").trim()
    const isEtf = etfFlag === "Y"
    items.push(
      buildItem({
        symbol,
        name,
        market: "NASDAQ",
        exchange: "NASDAQ",
        isEtf,
        securityType: isEtf ? "ETF" : "STOCK",
        updatedAt,
      }),
    )
  }

  items.sort((a, b) => a.symbol.localeCompare(b.symbol))
  return items
}

const mapOtherListedExchange = (code) => {
  switch (code) {
    case "N":
      return "NYSE"
    case "A":
      return "NYSE American"
    case "P":
      return "NYSE Arca"
    case "Z":
      return "BATS"
    case "V":
      return "IEX"
    default:
      return code || "UNKNOWN"
  }
}

const parseOtherListed = (content) => {
  const lines = content.split(/\\r?\\n/).filter(Boolean)
  if (lines.length === 0) {
    return new Map()
  }
  const headers = lines[0].split("|").map((header) => header.trim())
  const index = new Map(headers.map((header, idx) => [header, idx]))
  const readField = (row, field) => row[index.get(field) ?? -1] ?? ""
  const map = new Map()

  for (const line of lines.slice(1)) {
    if (!line || line.startsWith("File Creation Time")) {
      continue
    }
    const row = line.split("|")
    const symbol = normalizeSymbol(readField(row, "ACT Symbol"))
    if (!symbol) {
      continue
    }
    const testIssue = readField(row, "Test Issue").trim()
    if (testIssue !== "N") {
      continue
    }
    const exchange = mapOtherListedExchange(readField(row, "Exchange").trim())
    const etfFlag = readField(row, "ETF").trim()
    map.set(symbol, { exchange, isEtf: etfFlag === "Y" })
  }

  return map
}

const parseDowJones = (html, updatedAt, exchangeMap, nasdaqSet) => {
  const $ = load(html)
  const table = $("table.table-hover").first()
  if (!table.length) {
    return []
  }

  const items = []
  table.find("tbody tr").each((_, row) => {
    const cells = $(row).find("td")
    if (cells.length < 3) {
      return
    }
    const name = $(cells[1]).text().trim()
    const symbol = normalizeSymbol($(cells[2]).text())
    if (!symbol || !name) {
      return
    }
    const otherMeta = exchangeMap.get(symbol)
    const exchange = nasdaqSet.has(symbol)
      ? "NASDAQ"
      : (otherMeta?.exchange ?? "UNKNOWN")
    items.push(
      buildItem({
        symbol,
        name,
        market: "DOWJONES",
        exchange,
        isEtf: otherMeta?.isEtf ?? false,
        securityType: "STOCK",
        updatedAt,
      }),
    )
  })

  items.sort((a, b) => a.symbol.localeCompare(b.symbol))
  return items
}

const run = async () => {
  const updatedAt = new Date().toISOString()
  const [nasdaqText, otherListedText, dowHtml] = await Promise.all([
    fetchText(NASDAQ_URL),
    fetchText(OTHER_LISTED_URL),
    fetchText(DOWJONES_URL),
  ])

  const nasdaqItems = parseNasdaqListed(nasdaqText, updatedAt)
  const otherListedMap = parseOtherListed(otherListedText)
  const nasdaqSet = new Set(nasdaqItems.map((item) => item.symbol))
  const dowItems = parseDowJones(dowHtml, updatedAt, otherListedMap, nasdaqSet)

  writeJson(path.join(dataDir, "symbols.us.nasdaq.json"), nasdaqItems)
  writeJson(path.join(dataDir, "symbols.us.dowjones.json"), dowItems)

  console.log(
    `US symbols updated: NASDAQ ${nasdaqItems.length}, DOWJONES ${dowItems.length}`,
  )
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  console.error(message)
  process.exit(1)
})
