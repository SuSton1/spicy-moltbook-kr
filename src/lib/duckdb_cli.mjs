import { spawn } from "node:child_process"
import path from "node:path"

import { ensureDir } from "./io.mjs"
import {
  buildRecentImpulseLaneId,
  MAX_RECENT_IMPULSE_LOOKBACK_DAYS,
} from "./perfect_prototype_multiline_contract.mjs"

const sqlQuote = (value) => `'${String(value ?? "").replace(/'/g, "''")}'`

const numLiteral = (value, defaultValue) => {
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : String(defaultValue)
}

const runProcess = async ({ command, args, cwd = process.cwd() }) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.setEncoding("utf8")
    proc.stderr.setEncoding("utf8")
    proc.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    proc.stderr.on("data", (chunk) => {
      stderr += chunk
    })

    proc.once("error", reject)
    proc.once("close", (code) => {
      resolve({
        ok: code === 0,
        code: Number(code ?? 1),
        stdout,
        stderr
      })
    })
  })

export const probeDuckdbCli = async ({
  cliPath = "duckdb",
  cwd = process.cwd()
} = {}) => {
  const attempts = [
    ["-c", "SELECT 1;"],
    [":memory:", "-c", "SELECT 1;"]
  ]
  for (const args of attempts) {
    try {
      const result = await runProcess({
        command: cliPath,
        args,
        cwd
      })
      if (result.ok) {
        return {
          ok: true,
          cliPath,
          argsStyle: args[0] === ":memory:" ? "memory-db-arg" : "implicit-db"
        }
      }
    } catch {
      // continue probing the next invocation style
    }
  }
  return {
    ok: false,
    cliPath,
    argsStyle: null
  }
}

const duckdbArgs = (argsStyle, sql, databasePath = ":memory:") => {
  const resolvedDatabasePath = String(databasePath ?? "").trim() || ":memory:"
  if (argsStyle === "memory-db-arg" || resolvedDatabasePath !== ":memory:") {
    return [resolvedDatabasePath, "-c", sql]
  }
  return ["-c", sql]
}

export const runDuckdbStepACandidateQuery = async ({
  cliPath = "duckdb",
  argsStyle = "implicit-db",
  databasePath = ":memory:",
  candlesPath,
  universePath,
  outPath,
  dateFrom,
  dateTo,
  highThreshold,
  highJumpMode,
  recentImpulseLookbackTradingDays = 0,
  localWindow,
  globalWindow,
  minWindow,
  coreFilter = {}
}) => {
  await ensureDir(path.dirname(outPath))

  const thresholdLiteral = numLiteral(highThreshold, 0.08)
  const recentImpulseLookbackLiteral = Math.max(
    0,
    Math.min(MAX_RECENT_IMPULSE_LOOKBACK_DAYS, Math.floor(Number(recentImpulseLookbackTradingDays) || 0)),
  )
  const lookbackRnThresholdLocal = Math.max(2, Number(localWindow ?? 40) + 2)
  const lookbackRnThresholdGlobal = Math.max(2, Number(globalWindow ?? 150) + 2)
  const lookbackRnThresholdMin = Math.max(2, Number(minWindow ?? Math.max(localWindow ?? 40, globalWindow ?? 150)) + 2)
  const mode = String(highJumpMode ?? "FROM_OPEN_EX_GAP").trim().toUpperCase()
  const minLiq = Number(coreFilter?.minAvgTradingValue20dKrw)
  const minCap = Number(coreFilter?.minMarketCapKrw)
  const maxCap = Number(coreFilter?.maxMarketCapKrw)
  const excludeUnknownMarketCap = coreFilter?.excludeUnknownMarketCap !== false
  const liqExpr = [
    "avgTradingValue20d IS NOT NULL",
    Number.isFinite(minLiq) ? `avgTradingValue20d >= ${numLiteral(minLiq, 0)}` : null
  ]
    .filter(Boolean)
    .join(" AND ")
  const mcapBounds = [
    Number.isFinite(minCap) ? `marketCapKrw > ${numLiteral(minCap, 0)}` : null,
    Number.isFinite(maxCap) ? `marketCapKrw < ${numLiteral(maxCap, 0)}` : null
  ]
    .filter(Boolean)
    .join(" AND ")
  let mcapExpr = "TRUE"
  if (excludeUnknownMarketCap) {
    mcapExpr = [
      "marketCapKrw IS NOT NULL",
      mcapBounds ? `(${mcapBounds})` : null
    ]
      .filter(Boolean)
      .join(" AND ")
  } else if (mcapBounds) {
    mcapExpr = `(marketCapKrw IS NULL OR (${mcapBounds}))`
  }
  const corePassExpr = `(${liqExpr}) AND (${mcapExpr})`
  const jumpExpr =
    mode === "FROM_PREV_CLOSE"
      ? "CASE WHEN prev_close > 0 THEN high / prev_close - 1 ELSE NULL END"
      : "CASE WHEN open > 0 THEN high / open - 1 ELSE NULL END"
  const jumpBaseGuard = mode === "FROM_PREV_CLOSE" ? "prev_close > 0" : "open > 0"
  const recentImpulseLagColumns = Array.from({ length: recentImpulseLookbackLiteral }, (_, index) => {
    const lookback = index + 1
    return [
      `lag(date_key, ${lookback}) OVER (PARTITION BY symbol ORDER BY date_key) AS impulse_date_key_${lookback}`,
      `lag(jumpPctFromPrevClose, ${lookback}) OVER (PARTITION BY symbol ORDER BY date_key) AS impulse_jump_pct_from_prev_close_${lookback}`,
      `lag(jumpPctFromOpen, ${lookback}) OVER (PARTITION BY symbol ORDER BY date_key) AS impulse_jump_pct_from_open_${lookback}`,
      `lag(jumpPct, ${lookback}) OVER (PARTITION BY symbol ORDER BY date_key) AS impulse_jump_pct_${lookback}`,
    ].join(",\n      ")
  }).join(",\n      ")
  const recentImpulseLaneCase = Array.from({ length: recentImpulseLookbackLiteral }, (_, index) => {
    const lookback = index + 1
    return `WHEN impulse_jump_pct_${lookback} >= ${thresholdLiteral} THEN '${buildRecentImpulseLaneId(lookback)}'`
  }).join("\n        ")
  const recentImpulseSourceDateCase = Array.from({ length: recentImpulseLookbackLiteral }, (_, index) => {
    const lookback = index + 1
    return `WHEN impulse_jump_pct_${lookback} >= ${thresholdLiteral} THEN impulse_date_key_${lookback}`
  }).join("\n        ")
  const recentImpulseLookbackCase = Array.from({ length: recentImpulseLookbackLiteral }, (_, index) => {
    const lookback = index + 1
    return `WHEN impulse_jump_pct_${lookback} >= ${thresholdLiteral} THEN ${lookback}`
  }).join("\n        ")
  const recentImpulsePrevCloseCase = Array.from({ length: recentImpulseLookbackLiteral }, (_, index) => {
    const lookback = index + 1
    return `WHEN impulse_jump_pct_${lookback} >= ${thresholdLiteral} THEN impulse_jump_pct_from_prev_close_${lookback}`
  }).join("\n        ")
  const recentImpulseOpenCase = Array.from({ length: recentImpulseLookbackLiteral }, (_, index) => {
    const lookback = index + 1
    return `WHEN impulse_jump_pct_${lookback} >= ${thresholdLiteral} THEN impulse_jump_pct_from_open_${lookback}`
  }).join("\n        ")
  const recentImpulseJumpCase = Array.from({ length: recentImpulseLookbackLiteral }, (_, index) => {
    const lookback = index + 1
    return `WHEN impulse_jump_pct_${lookback} >= ${thresholdLiteral} THEN impulse_jump_pct_${lookback}`
  }).join("\n        ")

  const sql = `
COPY (
  WITH candles AS (
    SELECT
      CAST(symbol AS VARCHAR) AS symbol,
      CAST(dateKey AS DATE) AS date_key,
      CAST(open AS DOUBLE) AS open,
      CAST(high AS DOUBLE) AS high,
      CAST(low AS DOUBLE) AS low,
      CAST(close AS DOUBLE) AS close,
      CAST(volume AS DOUBLE) AS volume
    FROM read_json_auto(${sqlQuote(candlesPath)})
    WHERE symbol IS NOT NULL
      AND dateKey IS NOT NULL
  ),
  universe AS (
    SELECT
      CAST(symbol AS VARCHAR) AS symbol,
      CAST(tradingDateKey AS DATE) AS trading_date_key,
      CAST(avgTradingValue20d AS DOUBLE) AS avgTradingValue20d,
      CAST(marketCapKrw AS DOUBLE) AS marketCapKrw
    FROM read_json_auto(${sqlQuote(universePath)})
    WHERE symbol IS NOT NULL
      AND tradingDateKey IS NOT NULL
  ),
  ranked AS (
    SELECT
      symbol,
      date_key,
      open,
      high,
      low,
      close,
      volume,
      lag(date_key, 1) OVER (PARTITION BY symbol ORDER BY date_key) AS prev_date_key,
      lag(close, 1) OVER (PARTITION BY symbol ORDER BY date_key) AS prev_close,
      lag(close, 2) OVER (PARTITION BY symbol ORDER BY date_key) AS prev_close_for_gap,
      row_number() OVER (PARTITION BY symbol ORDER BY date_key) AS rn
    FROM candles
  ),
  joined AS (
    SELECT
      r.symbol,
      r.date_key,
      r.open,
      r.high,
      r.low,
      r.close,
      r.volume,
      r.prev_date_key,
      r.prev_close,
      r.prev_close_for_gap,
      r.rn,
      u.avgTradingValue20d,
      u.marketCapKrw
    FROM ranked r
    LEFT JOIN universe u
      ON u.symbol = r.symbol
      AND u.trading_date_key = r.prev_date_key
  ),
  enriched AS (
    SELECT
      symbol,
      date_key,
      open,
      high,
      low,
      close,
      volume,
      prev_date_key,
      prev_close,
      prev_close_for_gap,
      rn,
      avgTradingValue20d,
      marketCapKrw,
      CASE WHEN prev_close > 0 THEN high / prev_close - 1 ELSE NULL END AS jumpPctFromPrevClose,
      CASE WHEN open > 0 THEN high / open - 1 ELSE NULL END AS jumpPctFromOpen,
      ${jumpExpr} AS jumpPct,
      CASE WHEN prev_close > 0 THEN close / prev_close - 1 ELSE NULL END AS closeRetPct,
      CASE WHEN prev_close > 0 THEN open / prev_close - 1 ELSE NULL END AS gapOpenPct,
      CASE WHEN rn >= ${lookbackRnThresholdLocal} THEN 1 ELSE 0 END AS hasLookback40d,
      CASE WHEN rn >= ${lookbackRnThresholdGlobal} THEN 1 ELSE 0 END AS hasLookback150d,
      CASE WHEN rn >= ${lookbackRnThresholdMin} THEN 1 ELSE 0 END AS hasLookbackMinWindow,
      CASE WHEN ${corePassExpr} THEN 1 ELSE 0 END AS corePass
    FROM joined
  ),
  laned AS (
    SELECT
      *${recentImpulseLagColumns ? `,
      ${recentImpulseLagColumns}` : ""}
    FROM enriched
  ),
  classified AS (
    SELECT
      *,
      CASE
        WHEN jumpPct >= ${thresholdLiteral} THEN 'same_day_high8'
        ${recentImpulseLaneCase}
        ELSE NULL
      END AS stepALaneId,
      CASE
        WHEN jumpPct >= ${thresholdLiteral} THEN date_key
        ${recentImpulseSourceDateCase}
        ELSE NULL
      END AS impulseSourceDateKey,
      CASE
        WHEN jumpPct >= ${thresholdLiteral} THEN 0
        ${recentImpulseLookbackCase}
        ELSE NULL
      END AS impulseLookbackDays,
      CASE
        WHEN jumpPct >= ${thresholdLiteral} THEN jumpPctFromPrevClose
        ${recentImpulsePrevCloseCase}
        ELSE NULL
      END AS impulseJumpPctFromPrevClose,
      CASE
        WHEN jumpPct >= ${thresholdLiteral} THEN jumpPctFromOpen
        ${recentImpulseOpenCase}
        ELSE NULL
      END AS impulseJumpPctFromOpen,
      CASE
        WHEN jumpPct >= ${thresholdLiteral} THEN jumpPct
        ${recentImpulseJumpCase}
        ELSE NULL
      END AS impulseJumpPct
    FROM laned
  )
  SELECT
    symbol,
    strftime(date_key, '%Y-%m-%d') AS dateKey,
    strftime(prev_date_key, '%Y-%m-%d') AS prevDateKey,
    strftime(prev_date_key, '%Y-%m-%d') AS asOfDateKey,
    prev_close,
    prev_close_for_gap,
    open,
    high,
    low,
    close,
    volume,
    jumpPctFromPrevClose,
    jumpPctFromOpen,
    jumpPct,
    closeRetPct,
    gapOpenPct,
    hasLookback40d,
    hasLookback150d,
    hasLookbackMinWindow,
    corePass,
    avgTradingValue20d,
    marketCapKrw,
    stepALaneId,
    strftime(impulseSourceDateKey, '%Y-%m-%d') AS impulseSourceDateKey,
    impulseLookbackDays,
    impulseJumpPctFromPrevClose,
    impulseJumpPctFromOpen,
    impulseJumpPct
  FROM classified
  WHERE prev_close IS NOT NULL
    AND date_key BETWEEN DATE ${sqlQuote(dateFrom)} AND DATE ${sqlQuote(dateTo)}
    AND ${jumpBaseGuard}
    AND stepALaneId IS NOT NULL
  ORDER BY symbol, date_key
) TO ${sqlQuote(outPath)} (FORMAT CSV, HEADER FALSE, DELIMITER '\t');
`

  const result = await runProcess({
    command: cliPath,
    args: duckdbArgs(argsStyle, sql, databasePath)
  })
  if (!result.ok) {
    throw new Error(
      [
        "DuckDB Step A candidate query failed",
        `command: ${cliPath}`,
        `exitCode: ${result.code}`,
        result.stderr ? `stderr: ${result.stderr.trim()}` : null
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  return {
    outPath,
    sql,
    mode
  }
}
