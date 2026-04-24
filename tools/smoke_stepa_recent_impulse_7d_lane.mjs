import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { resolvePeriods } from "../src/lib/config.mjs"
import { probeDuckdbCli } from "../src/lib/duckdb_cli.mjs"
import { readJson, readJsonl, writeJsonl } from "../src/lib/io.mjs"
import { runStepA } from "../src/pipeline/step_a_event_extract.mjs"

const makeDate = (day) => `2024-02-${String(day).padStart(2, "0")}`

const buildCandleSeries = ({ symbol, impulseDays }) => {
  const impulseSet = new Set(impulseDays)
  const rows = []
  for (let day = 1; day <= 13; day += 1) {
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

const buildUniverseSeries = ({ symbol }) => {
  const rows = []
  for (let day = 1; day <= 13; day += 1) {
    rows.push({
      symbol,
      dateKey: makeDate(day),
      avgTradingValue20d: 500000000,
      marketCapKrw: 2000000000,
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
      lookbackTradingDays: 7,
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
    discovery: { from: makeDate(5), to: makeDate(12) },
    online: { from: makeDate(13), to: makeDate(13) },
    lockbox: { from: makeDate(13), to: makeDate(13) },
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
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey))

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stepa-recent-impulse-7d-"))
  const dataDir = path.join(tempRoot, "data")
  await fs.mkdir(dataDir, { recursive: true })

  await writeJsonl(path.join(dataDir, "candles.jsonl"), buildCandleSeries({ symbol: "111111", impulseDays: [5] }))
  await writeJsonl(path.join(dataDir, "universe.jsonl"), buildUniverseSeries({ symbol: "111111" }))
  await writeJsonl(path.join(dataDir, "symbol_master.jsonl"), [
    { symbol: "111111", name: "SevenDayFollowThrough", type: "COMMON" },
  ])
  await writeJsonl(path.join(dataDir, "hourly60m.jsonl"), [])

  const expectedRows = [
    { symbol: "111111", dateKey: makeDate(5), stepALaneId: "same_day_high8", impulseSourceDateKey: makeDate(5), impulseLookbackDays: 0 },
    { symbol: "111111", dateKey: makeDate(6), stepALaneId: "recent_impulse_1d", impulseSourceDateKey: makeDate(5), impulseLookbackDays: 1 },
    { symbol: "111111", dateKey: makeDate(7), stepALaneId: "recent_impulse_2d", impulseSourceDateKey: makeDate(5), impulseLookbackDays: 2 },
    { symbol: "111111", dateKey: makeDate(8), stepALaneId: "recent_impulse_3d", impulseSourceDateKey: makeDate(5), impulseLookbackDays: 3 },
    { symbol: "111111", dateKey: makeDate(9), stepALaneId: "recent_impulse_4d", impulseSourceDateKey: makeDate(5), impulseLookbackDays: 4 },
    { symbol: "111111", dateKey: makeDate(10), stepALaneId: "recent_impulse_5d", impulseSourceDateKey: makeDate(5), impulseLookbackDays: 5 },
    { symbol: "111111", dateKey: makeDate(11), stepALaneId: "recent_impulse_6d", impulseSourceDateKey: makeDate(5), impulseLookbackDays: 6 },
    { symbol: "111111", dateKey: makeDate(12), stepALaneId: "recent_impulse_7d", impulseSourceDateKey: makeDate(5), impulseLookbackDays: 7 },
  ]

  const duckdbProbe = await probeDuckdbCli()
  const engines = duckdbProbe.ok ? ["classic", "bitset", "duckdb"] : ["classic", "bitset"]

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
    if (JSON.stringify(rows) !== JSON.stringify(expectedRows)) {
      throw new Error(`${engine} rows mismatch\nexpected=${JSON.stringify(expectedRows, null, 2)}\nactual=${JSON.stringify(rows, null, 2)}`)
    }
    if (Number(summary?.rawEventCandidates ?? 0) !== 8 || Number(summary?.passedEvents ?? 0) !== 8) {
      throw new Error(`${engine} summary raw/passed mismatch`)
    }
    for (let lookback = 1; lookback <= 7; lookback += 1) {
      if (Number(summary?.[`candidateRecentImpulse${lookback}dCount`] ?? 0) !== 1) {
        throw new Error(`${engine} candidateRecentImpulse${lookback}dCount mismatch`)
      }
      if (Number(summary?.[`passedRecentImpulse${lookback}dCount`] ?? 0) !== 1) {
        throw new Error(`${engine} passedRecentImpulse${lookback}dCount mismatch`)
      }
    }
    if (Number(summary?.candidateSameDayHigh8Count ?? 0) !== 1 || Number(summary?.passedSameDayHigh8Count ?? 0) !== 1) {
      throw new Error(`${engine} same_day_high8 summary mismatch`)
    }
    if (Number(summary?.candidateRecentImpulseDedupedCount ?? 0) !== 7 || Number(summary?.passedRecentImpulseDedupedCount ?? 0) !== 7) {
      throw new Error(`${engine} deduped recent impulse summary mismatch`)
    }
    if (summary?.recentImpulseDiscovery?.enabled !== true || Number(summary?.recentImpulseDiscovery?.lookbackTradingDays) !== 7) {
      throw new Error(`${engine} recentImpulseDiscovery summary mismatch`)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
