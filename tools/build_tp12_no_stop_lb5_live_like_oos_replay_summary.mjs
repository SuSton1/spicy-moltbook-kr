#!/usr/bin/env node
import { parseCliArgs, getFlag } from "../src/lib/args.mjs"
import { loadTp12NoStopLb5LiveLikeOosReplayContract } from "../src/lib/tp12_no_stop_lb5_live_like_oos_replay_contract.mjs"
import { buildTp12NoStopLb5LiveLikeOosReplaySummary } from "../src/lib/tp12_no_stop_lb5_live_like_oos_replay_report.mjs"

const parseBoolFlag = (rawValue, fallback = true) => {
  const normalized = String(rawValue ?? "").trim().toLowerCase()
  if (!normalized) return fallback
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  throw new Error(`Invalid boolean flag value: ${rawValue}`)
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const contractPath = String(getFlag(parsed.flags, "contract-path", "")).trim() || undefined
  const dateListFile = String(getFlag(parsed.flags, "date-list-file", "")).trim()
  const dayRunRoot = String(getFlag(parsed.flags, "day-run-root", "")).trim()
  const batchApplyDir = String(getFlag(parsed.flags, "batch-apply-dir", "")).trim()
  const outPath = String(getFlag(parsed.flags, "out", "")).trim()
  const runId = String(getFlag(parsed.flags, "run-id", "")).trim()
  const failOnMismatch = parseBoolFlag(getFlag(parsed.flags, "fail-on-mismatch", "true"), true)
  if (!dateListFile || !dayRunRoot || !batchApplyDir || !outPath || !runId) {
    throw new Error(
      "Usage: node tools/build_tp12_no_stop_lb5_live_like_oos_replay_summary.mjs --date-list-file=<dates.txt> --day-run-root=<dir> --batch-apply-dir=<dir> --out=<summary.json> --run-id=<id> [--contract-path=PATH] [--fail-on-mismatch=true|false]",
    )
  }
  const contract = await loadTp12NoStopLb5LiveLikeOosReplayContract({
    contractPath,
    cwd: process.cwd(),
  })
  await buildTp12NoStopLb5LiveLikeOosReplaySummary({
    contract,
    dateListFile,
    dayRunRoot,
    batchApplyDir,
    outPath,
    runId,
    failOnMismatch,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
