import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import crypto from "node:crypto"
import { spawnSync } from "node:child_process"

import { getArgValue, hasFlag, parseNumberArg } from "../lib/cliArgs.mjs"
import { assertServerOnly } from "../lib/heavy-run-guard.mjs"
import { assertNoKisRuntime } from "../lib/noKisGuard.mjs"

const rootDir = process.cwd()

const toNumber = (value, fallback) => {
  const parsed = parseNumberArg(value)
  return parsed ?? fallback
}

const clampInt = (value, fallback, min, max) => {
  const raw = toNumber(value, null)
  if (!Number.isFinite(raw)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const getValue = (key) => getArgValue(args, key)
  const dryRunOnly =
    hasFlag(args, "--dryRunOnly") || toNumber(getValue("--dryRunOnly"), 0) === 1
  const applyFlag = hasFlag(args, "--apply")
  const applyRaw = getValue("--apply")
  const applyRequested =
    applyFlag || (applyRaw !== null ? toNumber(applyRaw, 0) === 1 : false)

  return {
    asOfInput: String(getValue("--asof") ?? "2026-02-13").trim(),
    tracks: String(getValue("--tracks") ?? "SURGE_EOD,GAP_15_BET").trim(),
    passMode: String(getValue("--passMode") ?? "all").trim(),
    targetPct: clampInt(getValue("--targetPct"), 5, 1, 50),
    maxRounds: clampInt(getValue("--maxRounds"), 120, 1, 5000),
    plateauRounds: clampInt(getValue("--plateauRounds"), 200, 10, 5000),
    tries: clampInt(getValue("--tries"), 8, 1, 200),
    seedStart: clampInt(getValue("--seedStart"), 1, 1, 1_000_000_000),
    printEvery: clampInt(getValue("--printEvery"), 50, 1, 1_000_000),
    apply: dryRunOnly ? false : applyRequested,
  }
}

const createBatchId = () => {
  const ts = Date.now().toString(36)
  const rand = crypto.randomBytes(3).toString("hex")
  return `golive_${ts}_${rand}`
}

const readJson = (filePath) => {
  const raw = fs.readFileSync(filePath, "utf8")
  return JSON.parse(raw)
}

const toFinite = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const scoreReport = (report) => {
  const lockboxOk = Boolean(report?.lockboxOk)
  const maxTargetPassed = toFinite(report?.maxTargetPassed, -1)
  const surge = report?.lastPassedByTrack?.SURGE_EOD ?? null
  const metrics = surge?.metrics ?? null
  const totalWeeklySumPct = toFinite(metrics?.totalWeeklySumPct, -1e9)
  const minWeeklyPct = toFinite(metrics?.minWeeklyPct, -1e9)
  const medianWeeklyPct = toFinite(metrics?.medianWeeklyPct, -1e9)
  const noFillRate = toFinite(metrics?.noFillRate, 1)
  const emptyWeeksCount = toFinite(metrics?.emptyWeeksCount, 999)

  return {
    lockboxOk,
    maxTargetPassed,
    totalWeeklySumPct,
    minWeeklyPct,
    medianWeeklyPct,
    noFillRate,
    emptyWeeksCount,
  }
}

const compareScore = (a, b) => {
  if (a.lockboxOk !== b.lockboxOk) return a.lockboxOk ? -1 : 1
  if (b.maxTargetPassed !== a.maxTargetPassed)
    return b.maxTargetPassed - a.maxTargetPassed
  if (b.totalWeeklySumPct !== a.totalWeeklySumPct)
    return b.totalWeeklySumPct - a.totalWeeklySumPct
  if (b.minWeeklyPct !== a.minWeeklyPct) return b.minWeeklyPct - a.minWeeklyPct
  if (b.medianWeeklyPct !== a.medianWeeklyPct)
    return b.medianWeeklyPct - a.medianWeeklyPct
  if (a.emptyWeeksCount !== b.emptyWeeksCount)
    return a.emptyWeeksCount - b.emptyWeeksCount
  if (a.noFillRate !== b.noFillRate) return a.noFillRate - b.noFillRate
  return 0
}

const runChild = (scriptArgs) => {
  const result = spawnSync("node", scriptArgs, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`go-live child failed (${result.status})`)
  }
}

const run = async () => {
  assertServerOnly({ script: "autosearch/go_live_multi" })
  assertNoKisRuntime({ script: "autosearch/go_live_multi" })
  const args = parseArgs()
  const batchId = createBatchId()
  const summaryDir = path.join(
    rootDir,
    "artifacts",
    "autosearch_multi",
    batchId,
  )
  fs.mkdirSync(summaryDir, { recursive: true })

  const runs = []
  for (let i = 0; i < args.tries; i += 1) {
    const seed = args.seedStart + i
    const runId = `${batchId}_seed${seed}`
    runChild([
      "scripts/autosearch/go_live_autosearch.mjs",
      `--runId=${runId}`,
      `--asof=${args.asOfInput}`,
      `--tracks=${args.tracks}`,
      `--passMode=${args.passMode}`,
      `--targetPct=${args.targetPct}`,
      `--maxRounds=${args.maxRounds}`,
      `--plateauRounds=${args.plateauRounds}`,
      `--seed=${seed}`,
      `--printEvery=${args.printEvery}`,
      "--dryRun=1",
    ])

    const reportPath = path.join(
      rootDir,
      "artifacts",
      "autosearch",
      runId,
      "final_report.json",
    )
    const report = fs.existsSync(reportPath) ? readJson(reportPath) : null
    const scored = report
      ? {
          runId,
          seed,
          reportPath,
          report,
          score: scoreReport(report),
        }
      : {
          runId,
          seed,
          reportPath,
          report: null,
          score: scoreReport(null),
        }
    runs.push(scored)
  }

  runs.sort((a, b) => compareScore(a.score, b.score))
  const best = runs[0] ?? null

  const summary = {
    batchId,
    args,
    best: best
      ? {
          runId: best.runId,
          seed: best.seed,
          reportPath: best.reportPath,
          score: best.score,
        }
      : null,
    runs: runs.map((entry) => ({
      runId: entry.runId,
      seed: entry.seed,
      reportPath: entry.reportPath,
      score: entry.score,
    })),
    createdAt: new Date().toISOString(),
  }
  fs.writeFileSync(
    path.join(summaryDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  )

  if (
    !best?.report ||
    !best.score.lockboxOk ||
    best.score.maxTargetPassed < 5
  ) {
    console.log("[go-live-multi] no lockbox-ok PASS candidate found.")
    console.log(`[go-live-multi] summary: ${summaryDir}`)
    process.exitCode = 2
    return
  }

  if (!args.apply) {
    console.log("[go-live-multi] dry-run complete (apply disabled).")
    console.log(`[go-live-multi] best: runId=${best.runId} seed=${best.seed}`)
    console.log(`[go-live-multi] summary: ${summaryDir}`)
    return
  }

  const applyRunId = `${batchId}_APPLY_seed${best.seed}`
  console.log(`[go-live-multi] apply best seed => runId=${applyRunId}`)
  runChild([
    "scripts/autosearch/go_live_autosearch.mjs",
    `--runId=${applyRunId}`,
    `--asof=${args.asOfInput}`,
    `--tracks=${args.tracks}`,
    `--passMode=${args.passMode}`,
    `--targetPct=${args.targetPct}`,
    `--maxRounds=${args.maxRounds}`,
    `--plateauRounds=${args.plateauRounds}`,
    `--seed=${best.seed}`,
    `--printEvery=${args.printEvery}`,
  ])

  console.log(`[go-live-multi] done. summary: ${summaryDir}`)
}

run().catch((error) => {
  console.error("[go-live-multi] failed", error)
  process.exitCode = 1
})
