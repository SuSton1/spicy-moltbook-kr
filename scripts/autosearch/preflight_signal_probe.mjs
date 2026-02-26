import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import dotenv from "dotenv"

import { PrismaClient } from "@prisma/client"

const rootDir = process.cwd()

const loadLocalEnv = () => {
  const candidates = [".env", ".env.local", "env.local"]
  for (const file of candidates) {
    const fullPath = path.join(rootDir, file)
    if (fs.existsSync(fullPath)) {
      dotenv.config({ path: fullPath })
    }
  }
}

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const parseIntSafe = (value, fallback) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

const parseBoolean = (value, fallback = false) => {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  return (
    raw === "1" ||
    raw === "true" ||
    raw === "yes" ||
    raw === "on" ||
    raw === "y"
  )
}

const normalizeDateKey = (value) => {
  const digits = String(value ?? "").replace(/[^0-9]/g, "")
  if (digits.length !== 8) return ""
  const y = digits.slice(0, 4)
  const m = digits.slice(4, 6)
  const d = digits.slice(6, 8)
  return `${y}-${m}-${d}`
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const get = (key) => {
    const prefix = `${key}=`
    const found = args.find((arg) => arg.startsWith(prefix))
    return found ? found.slice(prefix.length) : undefined
  }
  const asOfDateKey = normalizeDateKey(get("--asof"))
  const windowTradingDays = Math.max(
    1,
    Math.min(252, parseIntSafe(get("--windowTradingDays"), 28) || 28),
  )
  const minSignalsLoaded = Math.max(
    0,
    parseIntSafe(get("--minSignalsLoaded"), 1) || 1,
  )
  const minTradingDays = Math.max(
    1,
    parseIntSafe(get("--minTradingDays"), 16) || 16,
  )
  const minWeekCount = Math.max(
    1,
    parseIntSafe(get("--minWeekCount"), 16) || 16,
  )
  const minUniverseSize = Math.max(
    1,
    parseIntSafe(get("--minUniverseSize"), 1) || 1,
  )
  const requireQualified = parseBoolean(get("--requireQualified"), false)
  const minQualifiedSignals = Math.max(
    0,
    parseIntSafe(get("--minQualifiedSignals"), 0) || 0,
  )
  return {
    asOfDateKey,
    windowTradingDays,
    minTradingDays,
    minWeekCount,
    minUniverseSize,
    minSignalsLoaded,
    requireQualified,
    minQualifiedSignals,
    track: String(get("--track") ?? "SURGE_EOD").trim() || "SURGE_EOD",
    role: String(get("--role") ?? "MOONSHOT").trim() || "MOONSHOT",
    policyType:
      String(get("--policyType") ?? "RECOMMEND").trim() || "RECOMMEND",
    mode: String(get("--mode") ?? "EOD").trim() || "EOD",
    status: String(get("--status") ?? "ACTIVE").trim() || "ACTIVE",
    emitStatus: String(get("--emitStatus") ?? "EMITTED").trim() || "EMITTED",
    outPath: String(get("--out") ?? "").trim(),
  }
}

const resolveStrategyFilters = () => {
  const strategyVersion = String(
    process.env.GOLIVE_MOONSHOT_STRATEGY_VERSION ??
      process.env.MOONSHOT_STRATEGY_VERSION ??
      "",
  ).trim()
  const strategyVersionPrefix = String(
    process.env.GOLIVE_MOONSHOT_STRATEGY_PREFIX ??
      process.env.MOONSHOT_STRATEGY_PREFIX ??
      "",
  ).trim()
  const allowUnscoped = parseBoolean(
    process.env.GOLIVE_ALLOW_UNSCOPED_MOONSHOT ?? "0",
    false,
  )
  return {
    strategyVersion,
    strategyVersionPrefix,
    allowUnscoped,
  }
}

const run = async () => {
  loadLocalEnv()
  const args = parseArgs()
  if (!args.asOfDateKey) {
    throw new Error("INVALID_ASOF_DATE")
  }

  const prisma = new PrismaClient()
  try {
    const tradingRows = await prisma.tradingCalendar
      .findMany({
        where: {
          isTradingDay: true,
          dateKey: { lte: args.asOfDateKey },
        },
        select: { dateKey: true },
        orderBy: { dateKey: "desc" },
        take: args.windowTradingDays,
      })
      .catch(() => [])
    const tradingDates = tradingRows
      .map((row) => String(row?.dateKey ?? "").trim())
      .filter(Boolean)
    const windowEndDateKey = tradingDates[0] ?? null
    const windowStartDateKey =
      tradingDates.length > 0 ? tradingDates[tradingDates.length - 1] : null

    const filters = resolveStrategyFilters()
    const result = {
      pass: true,
      asOfDateKey: args.asOfDateKey,
      windowTradingDays: args.windowTradingDays,
      tradingDaysObserved: tradingDates.length,
      windowStartDateKey,
      windowEndDateKey,
      filters: {
        track: args.track,
        role: args.role,
        policyType: args.policyType,
        mode: args.mode,
        status: args.status,
        emitStatus: args.emitStatus,
      },
      strategyFilter: {
        strategyVersion: filters.strategyVersion || null,
        strategyVersionPrefix: filters.strategyVersionPrefix || null,
        allowUnscoped: filters.allowUnscoped,
      },
      thresholds: {
        minTradingDays: args.minTradingDays,
        minWeekCount: args.minWeekCount,
        minUniverseSize: args.minUniverseSize,
        minSignalsLoaded: args.minSignalsLoaded,
        requireQualified: args.requireQualified,
        minQualifiedSignals: args.minQualifiedSignals,
      },
      universeSize: 0,
      weekCountObserved: 0,
      signalsLoaded: 0,
      signalsQualified: 0,
      qualifiedByDate: [],
      reasons: [],
    }

    if (!windowStartDateKey || !windowEndDateKey) {
      result.pass = false
      result.reasons.push("PREFLIGHT_CALENDAR_EMPTY")
    }

    if (tradingDates.length < args.minTradingDays) {
      result.pass = false
      result.reasons.push("PREFLIGHT_TRADING_DAYS_LOW")
    }
    result.weekCountObserved = Math.floor(tradingDates.length / 5)
    if (result.weekCountObserved < args.minWeekCount) {
      result.pass = false
      result.reasons.push("PREFLIGHT_WEEK_COUNT_LOW")
    }

    if (
      !filters.allowUnscoped &&
      !filters.strategyVersion &&
      !filters.strategyVersionPrefix
    ) {
      result.pass = false
      result.reasons.push("PREFLIGHT_STRATEGY_FILTER_REQUIRED")
    }

    let signals = []
    if (windowStartDateKey && windowEndDateKey) {
      signals = await prisma.aiSignal
        .findMany({
          where: {
            tradingDateKey: { gte: windowStartDateKey, lte: windowEndDateKey },
            track: args.track,
            role: args.role,
            policyType: args.policyType,
            mode: args.mode,
            status: args.status,
            emitStatus: args.emitStatus,
          },
          select: {
            tradingDateKey: true,
            detail: { select: { whyJson: true } },
          },
        })
        .catch(() => [])
    }
    result.signalsLoaded = signals.length

    let universeSize = 0
    if (windowEndDateKey) {
      const universeCount = await prisma.universe
        .count({
          where: { tradingDateKey: windowEndDateKey },
        })
        .catch(() => 0)
      const universeKrxCount = await prisma.universeKrxDay
        .count({
          where: { tradingDateKey: windowEndDateKey },
        })
        .catch(() => 0)
      universeSize = Math.max(
        Number(universeCount ?? 0) || 0,
        Number(universeKrxCount ?? 0) || 0,
      )
    }
    result.universeSize = universeSize
    if (result.universeSize < args.minUniverseSize) {
      result.pass = false
      result.reasons.push("PREFLIGHT_UNIVERSE_LOW")
    }

    const qualifiedSignals = signals.filter((row) => {
      const why = row?.detail?.whyJson
      const signalStrategy = String(why?.strategyVersion ?? "").trim()
      if (
        filters.strategyVersion &&
        signalStrategy !== filters.strategyVersion
      ) {
        return false
      }
      if (
        filters.strategyVersionPrefix &&
        (!signalStrategy ||
          !signalStrategy.startsWith(filters.strategyVersionPrefix))
      ) {
        return false
      }
      return true
    })
    result.signalsQualified = qualifiedSignals.length

    const countByDate = new Map()
    for (const row of qualifiedSignals) {
      const dateKey = String(row?.tradingDateKey ?? "").trim()
      if (!dateKey) continue
      countByDate.set(dateKey, (Number(countByDate.get(dateKey) ?? 0) || 0) + 1)
    }
    result.qualifiedByDate = Array.from(countByDate.entries())
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([dateKey, count]) => ({ dateKey, count }))

    if (result.signalsLoaded < args.minSignalsLoaded) {
      result.pass = false
      result.reasons.push("PREFLIGHT_SIGNALS_LOADED_LOW")
    }
    if (args.requireQualified) {
      const minQualified = Math.max(1, args.minQualifiedSignals)
      if (result.signalsQualified < minQualified) {
        result.pass = false
        result.reasons.push("PREFLIGHT_SIGNALS_QUALIFIED_LOW")
      }
    }

    if (args.outPath) {
      const resolvedOutPath = path.isAbsolute(args.outPath)
        ? args.outPath
        : path.join(rootDir, args.outPath)
      writeJson(resolvedOutPath, result)
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exit(result.pass ? 0 : 2)
  } finally {
    await prisma.$disconnect().catch(() => undefined)
  }
}

run().catch((error) => {
  const payload = {
    pass: false,
    reasons: ["PREFLIGHT_RUNTIME_ERROR"],
    error: String(error?.stack ?? error?.message ?? error ?? "unknown").slice(
      0,
      4000,
    ),
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`)
  process.exit(1)
})
