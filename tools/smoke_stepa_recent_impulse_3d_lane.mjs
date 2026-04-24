import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { resolvePeriods } from "../src/lib/config.mjs"
import { probeDuckdbCli } from "../src/lib/duckdb_cli.mjs"
import { readJson, readJsonl, writeJsonl } from "../src/lib/io.mjs"
import { runStepA } from "../src/pipeline/step_a_event_extract.mjs"

const makeDate = (day) => `2024-01-${String(day).padStart(2, "0")}`

const buildCandleSeries = ({ symbol, impulseDays }) => {
  const impulseSet = new Set(impulseDays)
  const rows = []
  for (let day = 1; day <= 9; day += 1) {
    const open = 100 + day
    const isImpulse = impulseSet.has(day)
    rows.push({
      symbol,
      dateKey: makeDate(day),
      open,
      high: Number((open * (isImpulse ? 1.1 : 1.03)).toFixed(6)),
      low: Number((open * 0.98).toFixed(6)),
      close: Number((open * (isImpulse ? 1.04 : 1.01)).toFixed(6)),
      volume: 1000000 + day * 1000,
    })
  }
  return rows
}

const buildUniverseSeries = ({ symbol, avgTradingValue20d, marketCapKrw }) => {
  const rows = []
  for (let day = 1; day <= 9; day += 1) {
    rows.push({
      symbol,
      dateKey: makeDate(day),
      avgTradingValue20d,
      marketCapKrw,
    })
  }
  return rows
}

const buildConfig = ({ dataDir, engine }) => ({
  template: {
    localWindow: 2,
    globalWindow: 3,
  },
  event: {
    labelName: "HIGH8_BUYABLE_EX_GAP",
    highJumpThreshold: 0.08,
    highJumpMode: "FROM_OPEN_EX_GAP",
    recentImpulseDiscovery: {
      enabled: true,
      lookbackTradingDays: 3,
    },
  },
  filters: {
    minAvgTradingValue20dKrw: 100000000,
    minMarketCapKrw: 1000000000,
    excludeUnknownMarketCap: true,
    gapTradability: {
      enabled: true,
      requirePrevClose: true,
    },
  },
  guardrails: {
    enforceStepAEngineDuckdb: engine === "duckdb",
  },
  lightweight: {
    stepA: {
      engine,
      outputMode: "lite",
      duckdb: {
        enabled: true,
      },
      bitset: {
        enabled: true,
      },
    },
  },
  dataPaths: {
    candleDailyJsonl: path.join(dataDir, "candles.jsonl"),
    universeJsonl: path.join(dataDir, "universe.jsonl"),
    symbolMasterJsonl: path.join(dataDir, "symbol_master.jsonl"),
    hourly60mJsonl: path.join(dataDir, "hourly60m.jsonl"),
    newsJsonl: path.join(dataDir, "hourly60m.jsonl"),
  },
  periods: {
    warmup: { from: makeDate(1), to: makeDate(4) },
    discovery: { from: makeDate(5), to: makeDate(9) },
    online: { from: makeDate(9), to: makeDate(9) },
    lockbox: { from: makeDate(9), to: makeDate(9) },
  },
})

const normalizeRows = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      symbol: String(row?.symbol ?? "").trim(),
      dateKey: String(row?.dateKey ?? "").trim(),
      stepALaneId: String(row?.stepALaneId ?? "").trim(),
      impulseSourceDateKey: String(row?.impulseSourceDateKey ?? "").trim(),
      impulseLookbackDays: Number(row?.impulseLookbackDays ?? NaN),
    }))
    .sort((left, right) => {
      const symbolCmp = left.symbol.localeCompare(right.symbol)
      if (symbolCmp !== 0) return symbolCmp
      return left.dateKey.localeCompare(right.dateKey)
    })

const assertEqualJson = (label, actual, expected) => {
  const actualText = JSON.stringify(actual, null, 2)
  const expectedText = JSON.stringify(expected, null, 2)
  if (actualText !== expectedText) {
    throw new Error(`${label} mismatch\nexpected=${expectedText}\nactual=${actualText}`)
  }
}

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stepa-recent-impulse-"))
  const dataDir = path.join(tempRoot, "data")
  await fs.mkdir(dataDir, { recursive: true })

  const candles = [
    ...buildCandleSeries({ symbol: "111111", impulseDays: [5] }),
    ...buildCandleSeries({ symbol: "222222", impulseDays: [5, 6] }),
    ...buildCandleSeries({ symbol: "333333", impulseDays: [5] }),
  ]
  const universe = [
    ...buildUniverseSeries({
      symbol: "111111",
      avgTradingValue20d: 500000000,
      marketCapKrw: 2000000000,
    }),
    ...buildUniverseSeries({
      symbol: "222222",
      avgTradingValue20d: 500000000,
      marketCapKrw: 2000000000,
    }),
    ...buildUniverseSeries({
      symbol: "333333",
      avgTradingValue20d: 1,
      marketCapKrw: 2000000000,
    }),
  ]
  const symbolMaster = [
    { symbol: "111111", name: "SameDayAndFollowThrough", type: "COMMON" },
    { symbol: "222222", name: "PrioritySameDay", type: "COMMON" },
    { symbol: "333333", name: "FilteredFollowThrough", type: "COMMON" },
  ]

  await writeJsonl(path.join(dataDir, "candles.jsonl"), candles)
  await writeJsonl(path.join(dataDir, "universe.jsonl"), universe)
  await writeJsonl(path.join(dataDir, "symbol_master.jsonl"), symbolMaster)
  await writeJsonl(path.join(dataDir, "hourly60m.jsonl"), [])

  const expectedRows = [
    {
      symbol: "111111",
      dateKey: makeDate(5),
      stepALaneId: "same_day_high8",
      impulseSourceDateKey: makeDate(5),
      impulseLookbackDays: 0,
    },
    {
      symbol: "111111",
      dateKey: makeDate(6),
      stepALaneId: "recent_impulse_1d",
      impulseSourceDateKey: makeDate(5),
      impulseLookbackDays: 1,
    },
    {
      symbol: "111111",
      dateKey: makeDate(7),
      stepALaneId: "recent_impulse_2d",
      impulseSourceDateKey: makeDate(5),
      impulseLookbackDays: 2,
    },
    {
      symbol: "111111",
      dateKey: makeDate(8),
      stepALaneId: "recent_impulse_3d",
      impulseSourceDateKey: makeDate(5),
      impulseLookbackDays: 3,
    },
    {
      symbol: "222222",
      dateKey: makeDate(5),
      stepALaneId: "same_day_high8",
      impulseSourceDateKey: makeDate(5),
      impulseLookbackDays: 0,
    },
    {
      symbol: "222222",
      dateKey: makeDate(6),
      stepALaneId: "same_day_high8",
      impulseSourceDateKey: makeDate(6),
      impulseLookbackDays: 0,
    },
    {
      symbol: "222222",
      dateKey: makeDate(7),
      stepALaneId: "recent_impulse_1d",
      impulseSourceDateKey: makeDate(6),
      impulseLookbackDays: 1,
    },
    {
      symbol: "222222",
      dateKey: makeDate(8),
      stepALaneId: "recent_impulse_2d",
      impulseSourceDateKey: makeDate(6),
      impulseLookbackDays: 2,
    },
    {
      symbol: "222222",
      dateKey: makeDate(9),
      stepALaneId: "recent_impulse_3d",
      impulseSourceDateKey: makeDate(6),
      impulseLookbackDays: 3,
    },
  ]

  const expectedSummaryFields = {
    rawEventCandidates: 13,
    passedEvents: 9,
    candidateSameDayHigh8Count: 4,
    candidateRecentImpulse1dCount: 3,
    candidateRecentImpulse2dCount: 3,
    candidateRecentImpulse3dCount: 3,
    candidateRecentImpulseDedupedCount: 9,
    passedSameDayHigh8Count: 3,
    passedRecentImpulse1dCount: 2,
    passedRecentImpulse2dCount: 2,
    passedRecentImpulse3dCount: 2,
    passedRecentImpulseDedupedCount: 6,
  }

  const duckdbProbe = await probeDuckdbCli()
  const engines = duckdbProbe.ok ? ["classic", "bitset", "duckdb"] : ["classic", "bitset"]
  let canonicalRows = null
  let canonicalSummary = null

  for (const engine of engines) {
    const runDir = path.join(tempRoot, `run-${engine}`)
    const config = buildConfig({ dataDir, engine })
    await runStepA({
      config,
      runDir,
      periods: resolvePeriods(config),
      cwd: process.cwd(),
    })
    const rows = normalizeRows(await readJsonl(path.join(runDir, "step-a", "events_high8_lite.jsonl")))
    const summary = await readJson(path.join(runDir, "step-a", "step_a_summary.json"), null)
    assertEqualJson(`${engine} rows`, rows, expectedRows)
    for (const [key, expectedValue] of Object.entries(expectedSummaryFields)) {
      const actualValue = Number(summary?.[key] ?? NaN)
      if (actualValue !== expectedValue) {
        throw new Error(`${engine} summary.${key} mismatch: expected ${expectedValue}, got ${summary?.[key] ?? "null"}`)
      }
    }
    if (summary?.recentImpulseDiscovery?.enabled !== true || Number(summary?.recentImpulseDiscovery?.lookbackTradingDays) !== 3) {
      throw new Error(`${engine} recentImpulseDiscovery summary mismatch`)
    }
    if (engine === "classic") {
      canonicalRows = rows
      canonicalSummary = summary
    } else {
      assertEqualJson(`${engine} rows vs classic`, rows, canonicalRows)
      for (const [key, expectedValue] of Object.entries(expectedSummaryFields)) {
        const actualValue = Number(summary?.[key] ?? NaN)
        const canonicalValue = Number(canonicalSummary?.[key] ?? NaN)
        if (actualValue !== canonicalValue || canonicalValue !== expectedValue) {
          throw new Error(`${engine} summary.${key} drifted from classic: ${actualValue} vs ${canonicalValue}`)
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
