import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { resolvePeriods } from "../src/lib/config.mjs"
import { probeDuckdbCli } from "../src/lib/duckdb_cli.mjs"
import { readJson, readJsonl, writeJsonl } from "../src/lib/io.mjs"
import { runStepA } from "../src/pipeline/step_a_event_extract.mjs"
import { buildTp12IntradayAllowlistFromPack } from "./build_tp12_intraday_allowlist_from_pack.mjs"
import { buildTp12StepAIntradayManifest } from "./build_tp12_stepa_intraday_manifest.mjs"

const makeDate = (day) => `2024-03-${String(day).padStart(2, "0")}`

const buildCandleSeries = ({ symbol, impulseDays, skipDays = [] }) => {
  const impulseSet = new Set(impulseDays)
  const skipSet = new Set(skipDays)
  const rows = []
  for (let day = 1; day <= 14; day += 1) {
    if (skipSet.has(day)) continue
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

const buildUniverseSeries = ({ symbol, avgTradingValue20d, marketCapKrw, skipDays = [] }) => {
  const skipSet = new Set(skipDays)
  const rows = []
  for (let day = 1; day <= 14; day += 1) {
    if (skipSet.has(day)) continue
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
    online: { from: makeDate(10), to: makeDate(14) },
    lockbox: { from: makeDate(10), to: makeDate(14) },
  },
})

const normalizeRows = (rows) =>
  (Array.isArray(rows) ? rows : []).sort((left, right) => {
    const dateCmp = String(left?.decisionDateKey ?? "").localeCompare(String(right?.decisionDateKey ?? ""))
    if (dateCmp !== 0) return dateCmp
    const symbolCmp = String(left?.symbol ?? "").localeCompare(String(right?.symbol ?? ""))
    if (symbolCmp !== 0) return symbolCmp
    return String(left?.stepALaneId ?? "").localeCompare(String(right?.stepALaneId ?? ""))
  })

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-stepa-manifest-"))
  const dataDir = path.join(tempRoot, "data")
  await fs.mkdir(dataDir, { recursive: true })

  const candles = [
    ...buildCandleSeries({ symbol: "111111", impulseDays: [5] }),
    ...buildCandleSeries({ symbol: "222222", impulseDays: [5, 6] }),
    ...buildCandleSeries({ symbol: "333333", impulseDays: [5] }),
    ...buildCandleSeries({ symbol: "444444", impulseDays: [9], skipDays: [8] }),
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
    ...buildUniverseSeries({
      symbol: "444444",
      avgTradingValue20d: 500000000,
      marketCapKrw: 2000000000,
      skipDays: [8],
    }),
  ]
  const symbolMaster = [
    { symbol: "111111", name: "SameDayAndFollowThrough", type: "COMMON" },
    { symbol: "222222", name: "PrioritySameDay", type: "COMMON" },
    { symbol: "333333", name: "FilteredFollowThrough", type: "COMMON" },
    { symbol: "444444", name: "SymbolLocalGap", type: "COMMON" },
  ]

  await writeJsonl(path.join(dataDir, "candles.jsonl"), candles)
  await writeJsonl(path.join(dataDir, "universe.jsonl"), universe)
  await writeJsonl(path.join(dataDir, "symbol_master.jsonl"), symbolMaster)
  await writeJsonl(path.join(dataDir, "hourly60m.jsonl"), [])

  const duckdbProbe = await probeDuckdbCli()
  const engine = duckdbProbe.ok ? "duckdb" : "bitset"
  const runDir = path.join(tempRoot, "run-stepa")
  const config = buildConfig({ dataDir, engine })
  await runStepA({
    config,
    runDir,
    periods: resolvePeriods(config),
    cwd: process.cwd(),
  })

  const outPath = path.join(tempRoot, "manifest", "requests.jsonl")
  const summaryOutPath = path.join(tempRoot, "manifest", "manifest_summary.json")
  const result = await buildTp12StepAIntradayManifest({
    cwd: process.cwd(),
    runDir,
    candlePath: path.join(dataDir, "candles.jsonl"),
    outPath,
    summaryOutPath,
  })

  const manifestRows = normalizeRows(await readJsonl(outPath))
  const summary = await readJson(summaryOutPath, null)
  if (manifestRows.length !== 10) {
    throw new Error(`Expected 10 manifest rows, got ${manifestRows.length}`)
  }
  if (Number(summary?.rowCount ?? 0) !== 10) {
    throw new Error(`Manifest summary rowCount mismatch: ${summary?.rowCount ?? "null"}`)
  }
  if (summary?.windowSpec !== "D-1..D+4") {
    throw new Error(`Manifest summary windowSpec mismatch: ${summary?.windowSpec ?? "null"}`)
  }
  const firstRow = manifestRows[0]
  const expectedFirstWindow = [makeDate(4), makeDate(5), makeDate(6), makeDate(7), makeDate(8), makeDate(9)]
  if (firstRow.symbol !== "111111" || firstRow.decisionDateKey !== makeDate(5) || firstRow.stepALaneId !== "same_day_high8") {
    throw new Error(`Unexpected first manifest row: ${JSON.stringify(firstRow)}`)
  }
  if (JSON.stringify(firstRow.windowDateKeys) !== JSON.stringify(expectedFirstWindow)) {
    throw new Error(`Unexpected first windowDateKeys: ${JSON.stringify(firstRow.windowDateKeys)}`)
  }
  const recentImpulse3dRow = manifestRows.find(
    (row) => row.symbol === "222222" && row.decisionDateKey === makeDate(9) && row.stepALaneId === "recent_impulse_3d",
  )
  const expectedLastWindow = [makeDate(8), makeDate(9), makeDate(10), makeDate(11), makeDate(12), makeDate(13)]
  if (!recentImpulse3dRow) {
    throw new Error("Expected to find 222222 recent_impulse_3d row in manifest")
  }
  if (JSON.stringify(recentImpulse3dRow.windowDateKeys) !== JSON.stringify(expectedLastWindow)) {
    throw new Error(`Unexpected recent_impulse_3d windowDateKeys: ${JSON.stringify(recentImpulse3dRow.windowDateKeys)}`)
  }
  const symbolLocalGapRow = manifestRows.find(
    (row) => row.symbol === "444444" && row.decisionDateKey === makeDate(9) && row.stepALaneId === "same_day_high8",
  )
  const expectedGapWindow = [makeDate(7), makeDate(9), makeDate(10), makeDate(11), makeDate(12), makeDate(13)]
  if (!symbolLocalGapRow) {
    throw new Error("Expected to find 444444 same_day_high8 row in manifest")
  }
  if (JSON.stringify(symbolLocalGapRow.windowDateKeys) !== JSON.stringify(expectedGapWindow)) {
    throw new Error(`Unexpected symbol-local gap windowDateKeys: ${JSON.stringify(symbolLocalGapRow.windowDateKeys)}`)
  }
  const laneCounts = summary?.laneCounts ?? {}
  if (
    Number(laneCounts.same_day_high8 ?? 0) !== 4 ||
    Number(laneCounts.recent_impulse_1d ?? 0) !== 2 ||
    Number(laneCounts.recent_impulse_2d ?? 0) !== 2 ||
    Number(laneCounts.recent_impulse_3d ?? 0) !== 2
  ) {
    throw new Error(`Unexpected laneCounts: ${JSON.stringify(laneCounts)}`)
  }
  if (result.summary.runId !== path.basename(runDir)) {
    throw new Error(`Manifest runId mismatch: ${result.summary.runId ?? "null"}`)
  }
  if (!manifestRows.every((row) => String(row.sourceEventsPath ?? "").endsWith("events_high8_lite.jsonl"))) {
    throw new Error("Manifest rows are missing sourceEventsPath provenance")
  }
  if (!manifestRows.every((row) => String(row.sourceSummaryPath ?? "").endsWith("step_a_summary.json"))) {
    throw new Error("Manifest rows are missing sourceSummaryPath provenance")
  }

  const packPath = path.join(tempRoot, "pack", "daily_pack.jsonl")
  const allowlistSourceRows = [
    manifestRows.find((row) => row.symbol === "111111" && row.decisionDateKey === makeDate(5) && row.stepALaneId === "same_day_high8"),
    manifestRows.find((row) => row.symbol === "222222" && row.decisionDateKey === makeDate(7) && row.stepALaneId === "recent_impulse_1d"),
    symbolLocalGapRow,
  ]
  if (allowlistSourceRows.some((row) => !row)) {
    throw new Error(`Failed to assemble allowlist source rows: ${JSON.stringify(allowlistSourceRows)}`)
  }
  await writeJsonl(packPath, [
    ...allowlistSourceRows.map((row) => ({
      symbol: row.symbol,
      decisionDateKey: row.decisionDateKey,
      stepALaneId: row.stepALaneId,
      sourceType: "perfect_prototype_stepb_open_eval_pack",
    })),
  ])
  const allowlistPath = path.join(tempRoot, "allowlist", "rows.jsonl")
  const allowlistSummaryPath = path.join(tempRoot, "allowlist", "summary.json")
  const allowlistResult = await buildTp12IntradayAllowlistFromPack({
    cwd: process.cwd(),
    inputPath: packPath,
    outPath: allowlistPath,
    summaryOutPath: allowlistSummaryPath,
  })
  if (allowlistResult.summary.rowCount !== 3) {
    throw new Error(`Allowlist rowCount mismatch: ${allowlistResult.summary.rowCount ?? "null"}`)
  }

  const narrowedOutPath = path.join(tempRoot, "manifest-allowlist", "requests.jsonl")
  const narrowedSummaryPath = path.join(tempRoot, "manifest-allowlist", "manifest_summary.json")
  const narrowed = await buildTp12StepAIntradayManifest({
    cwd: process.cwd(),
    runDir,
    candlePath: path.join(dataDir, "candles.jsonl"),
    outPath: narrowedOutPath,
    summaryOutPath: narrowedSummaryPath,
    allowlistPath,
  })
  if (narrowed.summary.rowCount !== 3) {
    throw new Error(`Narrowed manifest rowCount mismatch: ${narrowed.summary.rowCount ?? "null"}`)
  }
  if (narrowed.summary.allowlistRowCount !== 3 || narrowed.summary.allowlistMatchedRowCount !== 3) {
    throw new Error(`Narrowed manifest allowlist summary mismatch: ${JSON.stringify(narrowed.summary)}`)
  }
  const narrowedRows = normalizeRows(await readJsonl(narrowedOutPath))
  const narrowedKeys = narrowedRows.map((row) => `${row.decisionDateKey}::${row.symbol}::${row.stepALaneId}`)
  const expectedNarrowedKeys = allowlistSourceRows.map(
    (row) => `${row.decisionDateKey}::${row.symbol}::${row.stepALaneId}`,
  )
  if (JSON.stringify(narrowedKeys) !== JSON.stringify(expectedNarrowedKeys)) {
    throw new Error(`Unexpected narrowed manifest keys: ${JSON.stringify(narrowedKeys)}`)
  }

  const badAllowlistPath = path.join(tempRoot, "allowlist", "bad_rows.jsonl")
  await writeJsonl(badAllowlistPath, [
    ...(await readJsonl(allowlistPath)),
    {
      symbol: "999999",
      decisionDateKey: makeDate(5),
      stepALaneId: "recent_impulse_1d",
      sourceType: "perfect_prototype_stepb_open_eval_pack",
    },
  ])
  let sawAllowlistFailure = false
  try {
    await buildTp12StepAIntradayManifest({
      cwd: process.cwd(),
      runDir,
      candlePath: path.join(dataDir, "candles.jsonl"),
      outPath: path.join(tempRoot, "manifest-allowlist-bad", "requests.jsonl"),
      summaryOutPath: path.join(tempRoot, "manifest-allowlist-bad", "manifest_summary.json"),
      allowlistPath: badAllowlistPath,
    })
  } catch (error) {
    sawAllowlistFailure = String(error?.message ?? error).includes("Intraday allowlist rows missing from Step A source")
  }
  if (!sawAllowlistFailure) {
    throw new Error("Expected unmatched allowlist row to fail fast")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
