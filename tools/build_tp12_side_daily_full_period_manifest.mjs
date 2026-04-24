import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { normalizeDateKey } from "../src/lib/date.mjs"
import { createJsonlWriter, ensureDir, iterateJsonl, pathExists, readJson, writeJson, writeJsonl } from "../src/lib/io.mjs"
import { buildTp12StepAIntradayManifest } from "./build_tp12_stepa_intraday_manifest.mjs"


const toText = (value) => String(value ?? "").trim()

const assertDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
}

const allowlistKey = (row) => {
  const symbol = toText(row?.symbol)
  const decisionDateKey = assertDateKey(row?.decisionDateKey ?? row?.dateKey, "decisionDateKey")
  const stepALaneId = toText(row?.stepALaneId)
  if (!symbol || !stepALaneId) {
    throw new Error(`Malformed allowlist row for full-period manifest: symbol=${symbol || "unknown"} stepALaneId=${stepALaneId || "null"}`)
  }
  return `${decisionDateKey}::${symbol}::${stepALaneId}`
}

const requestKey = (row) => {
  const symbol = toText(row?.symbol)
  const decisionDateKey = assertDateKey(row?.decisionDateKey, "decisionDateKey")
  const stepALaneId = toText(row?.stepALaneId)
  if (!symbol || !stepALaneId) {
    throw new Error(`Malformed request row for full-period manifest: symbol=${symbol || "unknown"} stepALaneId=${stepALaneId || "null"}`)
  }
  return `${decisionDateKey}::${symbol}::${stepALaneId}`
}

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const trainRunDir = toText(getFlag(flags, "train-run-dir", ""))
  const oosRunDir = toText(getFlag(flags, "oos-run-dir", ""))
  const allowlistPath = toText(getFlag(flags, "allowlist-path", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!trainRunDir || !oosRunDir || !allowlistPath || !outPath) {
    throw new Error(
      "build_tp12_side_daily_full_period_manifest requires --train-run-dir --oos-run-dir --allowlist-path --out",
    )
  }
  const trainDateFrom = assertDateKey(getFlag(flags, "train-date-from", null), "trainDateFrom")
  const trainDateTo = assertDateKey(getFlag(flags, "train-date-to", null), "trainDateTo")
  const oosDateFrom = assertDateKey(getFlag(flags, "oos-date-from", null), "oosDateFrom")
  const oosDateTo = assertDateKey(getFlag(flags, "oos-date-to", null), "oosDateTo")
  if (trainDateFrom > trainDateTo) {
    throw new Error(`Invalid train range ${trainDateFrom}:${trainDateTo}`)
  }
  if (oosDateFrom > oosDateTo) {
    throw new Error(`Invalid oos range ${oosDateFrom}:${oosDateTo}`)
  }
  if (!(trainDateTo < oosDateFrom)) {
    throw new Error(`Train/OOS ranges must not overlap: trainEnd=${trainDateTo} oosStart=${oosDateFrom}`)
  }
  return {
    cwd,
    trainRunDir: path.resolve(cwd, trainRunDir),
    oosRunDir: path.resolve(cwd, oosRunDir),
    allowlistPath: path.resolve(cwd, allowlistPath),
    outPath: path.resolve(cwd, outPath),
    summaryOutPath: path.resolve(
      cwd,
      toText(getFlag(flags, "summary-out", path.join(path.dirname(outPath), "manifest_summary.json"))),
    ),
    candlePath: path.resolve(cwd, toText(getFlag(flags, "candle-path", "data/candle_daily.jsonl"))),
    allowedLanes: Array.from(new Set(toText(getFlag(flags, "allowed-lanes", "")).split(",").map((v) => v.trim()).filter(Boolean))),
    tailPolicy: toText(getFlag(flags, "tail-policy", "require_full_window")) || "require_full_window",
    trainDateFrom,
    trainDateTo,
    oosDateFrom,
    oosDateTo,
  }
}

const partitionAllowlist = async (allowlistPath, { trainDateFrom, trainDateTo, oosDateFrom, oosDateTo }) => {
  if (!pathExists(allowlistPath)) {
    throw new Error(`Allowlist path not found: ${allowlistPath}`)
  }
  const trainRows = []
  const oosRows = []
  const allKeys = new Set()
  await iterateJsonl(allowlistPath, {
    strict: true,
    onRow: async (row) => {
      const key = allowlistKey(row)
      if (allKeys.has(key)) {
        throw new Error(`Duplicate allowlist row in full-period manifest input: ${key}`)
      }
      allKeys.add(key)
      const dateKey = assertDateKey(row?.decisionDateKey ?? row?.dateKey, "decisionDateKey")
      if (dateKey >= trainDateFrom && dateKey <= trainDateTo) {
        trainRows.push(row)
        return
      }
      if (dateKey >= oosDateFrom && dateKey <= oosDateTo) {
        oosRows.push(row)
        return
      }
      throw new Error(`Allowlist row falls outside train/oos ranges: ${key}`)
    },
  })
  if (trainRows.length < 1) {
    throw new Error("Train allowlist partition is empty")
  }
  if (oosRows.length < 1) {
    throw new Error("OOS allowlist partition is empty")
  }
  return {
    trainRows,
    oosRows,
    totalRowCount: allKeys.size,
  }
}

export const buildTp12SideDailyFullPeriodManifest = async ({
  cwd = process.cwd(),
  trainRunDir,
  oosRunDir,
  allowlistPath,
  outPath,
  summaryOutPath,
  candlePath,
  allowedLanes = [],
  tailPolicy = "require_full_window",
  trainDateFrom,
  trainDateTo,
  oosDateFrom,
  oosDateTo,
} = {}) => {
  const tmpRoot = path.join(path.dirname(outPath), ".partials")
  await ensureDir(tmpRoot)

  const partitioned = await partitionAllowlist(allowlistPath, {
    trainDateFrom,
    trainDateTo,
    oosDateFrom,
    oosDateTo,
  })
  const trainAllowlistPath = path.join(tmpRoot, "train_allowlist_rows.jsonl")
  const oosAllowlistPath = path.join(tmpRoot, "oos_allowlist_rows.jsonl")
  const trainPartialOutPath = path.join(tmpRoot, "train_requests.jsonl")
  const trainPartialSummaryPath = path.join(tmpRoot, "train_manifest_summary.json")
  const oosPartialOutPath = path.join(tmpRoot, "oos_requests.jsonl")
  const oosPartialSummaryPath = path.join(tmpRoot, "oos_manifest_summary.json")
  await writeJsonl(trainAllowlistPath, partitioned.trainRows)
  await writeJsonl(oosAllowlistPath, partitioned.oosRows)

  const trainResult = await buildTp12StepAIntradayManifest({
    cwd,
    runDir: trainRunDir,
    candlePath,
    allowlistPath: trainAllowlistPath,
    outPath: trainPartialOutPath,
    summaryOutPath: trainPartialSummaryPath,
    decisionFrom: trainDateFrom,
    decisionTo: trainDateTo,
    allowedLanes,
    tailPolicy,
  })
  const oosResult = await buildTp12StepAIntradayManifest({
    cwd,
    runDir: oosRunDir,
    candlePath,
    allowlistPath: oosAllowlistPath,
    outPath: oosPartialOutPath,
    summaryOutPath: oosPartialSummaryPath,
    decisionFrom: oosDateFrom,
    decisionTo: oosDateTo,
    allowedLanes,
    tailPolicy,
  })

  const writer = await createJsonlWriter(outPath)
  const requestKeySet = new Set()
  try {
    for (const row of [...trainResult.rows, ...oosResult.rows]) {
      const key = requestKey(row)
      if (requestKeySet.has(key)) {
        throw new Error(`Duplicate request row across train/oos manifests: ${key}`)
      }
      requestKeySet.add(key)
      await writer.writeRow(row)
    }
  } finally {
    await writer.close()
  }

  const trainSummary = await readJson(trainPartialSummaryPath, null)
  const oosSummary = await readJson(oosPartialSummaryPath, null)
  const summary = {
    status: "ok",
    kind: "tp12_side_daily_full_period_manifest_v1",
    trainRunDir,
    oosRunDir,
    allowlistPath,
    outPath,
    candlePath,
    tailPolicy,
    trainDateFrom,
    trainDateTo,
    oosDateFrom,
    oosDateTo,
    rowCount: requestKeySet.size,
    decisionDateFrom: trainResult.summary.decisionDateFrom,
    decisionDateTo: oosResult.summary.decisionDateTo,
    allowlistRowCount: partitioned.totalRowCount,
    allowlistMatchedRowCount: trainResult.summary.allowlistMatchedRowCount + oosResult.summary.allowlistMatchedRowCount,
    laneCounts: {
      ...(trainSummary?.laneCounts ?? {}),
      ...(oosSummary?.laneCounts ?? {}),
    },
    coverage: {
      train: trainSummary,
      oos: oosSummary,
    },
    partialPaths: {
      trainAllowlistPath,
      oosAllowlistPath,
      trainPartialOutPath,
      oosPartialOutPath,
    },
  }
  await writeJson(summaryOutPath, summary)
  return {
    outPath,
    summaryOutPath,
    summary,
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const result = await buildTp12SideDailyFullPeriodManifest(args)
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        summaryOutPath: result.summaryOutPath,
        rowCount: result.summary.rowCount,
        decisionDateFrom: result.summary.decisionDateFrom,
        decisionDateTo: result.summary.decisionDateTo,
        allowlistRowCount: result.summary.allowlistRowCount,
        allowlistMatchedRowCount: result.summary.allowlistMatchedRowCount,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
