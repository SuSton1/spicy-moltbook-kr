import fs from "node:fs"
import path from "node:path"

import { isKrSixDigitSymbol } from "./symbolMaster.mjs"
import {
  BASE_BRAND_PREFIXES,
  discoverBrandPrefixes,
  resolveBrandPrefixes,
} from "./krxInstrumentHeuristics.mjs"
import {
  instrumentExclusionReasons,
  marketCapExclusionReasons,
  resolveEligibilityConfig,
} from "./eligibilityPolicy.mjs"

const rootDir = process.cwd()

const DEFAULT_EXAMPLE_LIMIT = 5

const addReasonCount = (counts, examples, reason, symbol) => {
  counts[reason] = (counts[reason] ?? 0) + 1
  if (symbol) {
    if (!examples[reason]) {
      examples[reason] = []
    }
    if (examples[reason].length < DEFAULT_EXAMPLE_LIMIT) {
      examples[reason].push(symbol)
    }
  }
}

const resolveSymbolMasterRows = async (prisma) =>
  prisma.symbolMaster
    .findMany({
      where: { isListed: true },
      select: {
        symbol: true,
        name: true,
        market: true,
        type: true,
        isListed: true,
      },
    })
    .catch(() => [])

const buildBrandConfig = ({ symbolMasterRows, cfg }) => {
  const config = resolveEligibilityConfig(cfg)
  const discovery =
    cfg?.autoBrandPrefixes?.length || !symbolMasterRows?.length
      ? { prefixes: cfg.autoBrandPrefixes ?? [], summary: [] }
      : discoverBrandPrefixes(symbolMasterRows)
  const brandConfig = resolveBrandPrefixes({
    basePrefixes: config.brandPrefixes ?? BASE_BRAND_PREFIXES,
    autoPrefixes: discovery.prefixes,
  })
  return { brandConfig, discovery }
}

const toSymbolMeta = (symbol, metaMap) => {
  const meta = metaMap?.get(symbol)
  return {
    symbol,
    name: meta?.name ?? "",
    market: meta?.market ?? "",
  }
}

export const eligibleSymbolsForDate = async ({
  dateKey,
  prisma,
  cfg = {},
  symbolMasterRows,
  universeRows,
} = {}) => {
  if (!dateKey) {
    throw new Error("eligibleSymbolsForDate requires dateKey")
  }
  if (!prisma && !symbolMasterRows) {
    throw new Error(
      "eligibleSymbolsForDate requires prisma or symbolMasterRows",
    )
  }

  const config = resolveEligibilityConfig(cfg)
  const symbolRows = (
    symbolMasterRows ?? (await resolveSymbolMasterRows(prisma))
  )?.filter((row) => isKrSixDigitSymbol(row?.symbol))
  const metaMap = new Map(
    symbolRows.map((row) => [
      row.symbol,
      { name: row.name, market: row.market },
    ]),
  )
  const { brandConfig, discovery } = buildBrandConfig({
    symbolMasterRows: symbolRows,
    cfg: { ...cfg, brandPrefixes: config.brandPrefixes },
  })

  const reasonCounts = {}
  const reasonExamples = {}
  const instrumentEligible = []
  for (const row of symbolRows) {
    const verdict = instrumentExclusionReasons(row, {
      ...config,
      brandPrefixes: Array.from(brandConfig.all),
      autoBrandPrefixes: Array.from(brandConfig.auto),
    })
    if (verdict.excluded) {
      for (const reason of verdict.reasons) {
        addReasonCount(reasonCounts, reasonExamples, reason, row.symbol)
      }
      continue
    }
    instrumentEligible.push(row)
  }

  const symbolList = instrumentEligible.map((row) => row.symbol)
  const rows =
    universeRows ??
    (symbolList.length
      ? await prisma.universeKrxDay.findMany({
          where: {
            tradingDateKey: dateKey,
            symbol: { in: symbolList },
          },
          select: { symbol: true, tradingDateKey: true, marketCapKrw: true },
        })
      : [])

  const capMap = new Map(
    rows
      .filter((row) => row?.tradingDateKey === dateKey)
      .map((row) => [row.symbol, row.marketCapKrw]),
  )

  const eligibleSymbols = []
  for (const row of instrumentEligible) {
    if (!capMap.has(row.symbol)) {
      addReasonCount(
        reasonCounts,
        reasonExamples,
        "EXCLUDE_UNIVERSE_ROW_MISSING",
        row.symbol,
      )
      continue
    }
    const cap = capMap.get(row.symbol)
    const capVerdict = marketCapExclusionReasons(cap, config)
    if (capVerdict.excluded) {
      for (const reason of capVerdict.reasons) {
        addReasonCount(reasonCounts, reasonExamples, reason, row.symbol)
      }
      continue
    }
    eligibleSymbols.push(toSymbolMeta(row.symbol, metaMap))
  }

  return {
    symbols: eligibleSymbols,
    excluded: {
      reasonCounts,
      examples: reasonExamples,
    },
    brandPrefixSummary: discovery.summary ?? [],
    meta: {
      dateKey,
      minMarketCapKrw: config.minMarketCapKrw,
      maxMarketCapKrw: config.maxMarketCapKrw,
      totalSymbols: symbolRows.length,
      eligibleSymbols: eligibleSymbols.length,
      brandPrefixesAuto: discovery.prefixes ?? [],
    },
  }
}

export const eligibleSymbolsUnionForRange = async ({
  fromDateKey,
  toDateKey,
  prisma,
  cfg = {},
  symbolMasterRows,
  universeRows,
} = {}) => {
  if (!fromDateKey || !toDateKey) {
    throw new Error("eligibleSymbolsUnionForRange requires from/to")
  }
  if (!prisma && !symbolMasterRows) {
    throw new Error(
      "eligibleSymbolsUnionForRange requires prisma or symbolMasterRows",
    )
  }

  const config = resolveEligibilityConfig(cfg)
  const symbolRows = (
    symbolMasterRows ?? (await resolveSymbolMasterRows(prisma))
  )?.filter((row) => isKrSixDigitSymbol(row?.symbol))
  const metaMap = new Map(
    symbolRows.map((row) => [
      row.symbol,
      { name: row.name, market: row.market },
    ]),
  )
  const { brandConfig, discovery } = buildBrandConfig({
    symbolMasterRows: symbolRows,
    cfg: { ...cfg, brandPrefixes: config.brandPrefixes },
  })

  const reasonCounts = {}
  const reasonExamples = {}
  const instrumentEligible = []
  for (const row of symbolRows) {
    const verdict = instrumentExclusionReasons(row, {
      ...config,
      brandPrefixes: Array.from(brandConfig.all),
      autoBrandPrefixes: Array.from(brandConfig.auto),
    })
    if (verdict.excluded) {
      for (const reason of verdict.reasons) {
        addReasonCount(reasonCounts, reasonExamples, reason, row.symbol)
      }
      continue
    }
    instrumentEligible.push(row)
  }

  const instrumentSymbols = new Set(instrumentEligible.map((row) => row.symbol))

  const eligibleSet = new Set()

  if (universeRows) {
    for (const row of universeRows) {
      const symbol = row?.symbol
      if (!instrumentSymbols.has(symbol)) {
        continue
      }
      const dateKey = String(row?.tradingDateKey ?? "")
      if (dateKey < fromDateKey || dateKey > toDateKey) {
        continue
      }
      const capVerdict = marketCapExclusionReasons(row?.marketCapKrw, config)
      if (!capVerdict.excluded) {
        eligibleSet.add(symbol)
      }
    }
  } else if (instrumentEligible.length) {
    const minCap = BigInt(Math.round(config.minMarketCapKrw))
    const maxCap = BigInt(Math.round(config.maxMarketCapKrw))
    const capKnownWhere = { marketCapKrw: { gt: minCap, lt: maxCap } }
    const capWhere = config.excludeUnknownMarketCap
      ? capKnownWhere
      : { OR: [capKnownWhere, { marketCapKrw: null }] }
    const rows = await prisma.universeKrxDay
      .findMany({
        where: {
          tradingDateKey: { gte: fromDateKey, lte: toDateKey },
          symbol: { in: Array.from(instrumentSymbols) },
          ...capWhere,
        },
        select: { symbol: true },
        distinct: ["symbol"],
      })
      .catch(() => [])
    for (const row of rows) {
      eligibleSet.add(row.symbol)
    }
  }

  const eligibleSymbols = Array.from(eligibleSet).map((symbol) =>
    toSymbolMeta(symbol, metaMap),
  )

  return {
    symbols: eligibleSymbols,
    excluded: {
      reasonCounts,
      examples: reasonExamples,
    },
    brandPrefixSummary: discovery.summary ?? [],
    meta: {
      fromDateKey,
      toDateKey,
      minMarketCapKrw: config.minMarketCapKrw,
      maxMarketCapKrw: config.maxMarketCapKrw,
      totalSymbols: symbolRows.length,
      eligibleSymbols: eligibleSymbols.length,
      brandPrefixesAuto: discovery.prefixes ?? [],
    },
  }
}

export const writeEligibilityReport = async ({
  reportPath,
  rows,
  meta,
  discoverySummary,
}) => {
  const out = {
    meta,
    excluded: rows?.excluded ?? {},
    summary: {
      totalSymbols: meta?.totalSymbols ?? null,
      eligibleSymbols: meta?.eligibleSymbols ?? null,
      minMarketCapKrw: meta?.minMarketCapKrw ?? null,
      maxMarketCapKrw: meta?.maxMarketCapKrw ?? null,
    },
  }
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2), "utf8")
  if (discoverySummary) {
    const discoveryPath = path.join(
      path.dirname(reportPath),
      "brand_prefix_discovery.txt",
    )
    const lines = discoverySummary.map(
      (row) =>
        `${row.prefix}\t${row.total}\t${row.product}\t${row.common}\t${row.ratio}`,
    )
    fs.writeFileSync(discoveryPath, lines.join("\n"), "utf8")
  }
}
