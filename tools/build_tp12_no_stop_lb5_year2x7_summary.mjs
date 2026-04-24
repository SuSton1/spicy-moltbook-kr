#!/usr/bin/env node
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { loadTp12NoStopLb5Year2x7ResearchContract } from "../src/lib/tp12_no_stop_lb5_year2x7_contract.mjs"
import { buildTp12NoStopLb5Year2x7ReplaySummary } from "../src/lib/tp12_no_stop_lb5_year2x7_report.mjs"

const toText = (value) => String(value ?? "").trim()

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const contractPath = toText(
    getFlag(parsed.flags, "contract-path", "meta/tp12_no_stop_lb5_year2x7_research_contract.json"),
  )
  const auditSummaryPath = path.resolve(toText(getFlag(parsed.flags, "audit-summary-path", "")))
  const freezeResultPath = toText(getFlag(parsed.flags, "freeze-result-path", ""))
  const trainApplyDir = toText(getFlag(parsed.flags, "train-apply-dir", ""))
  const oosApplyDir = toText(getFlag(parsed.flags, "oos-apply-dir", ""))
  const outPath = path.resolve(toText(getFlag(parsed.flags, "out", "")))
  const runId = toText(getFlag(parsed.flags, "run-id", ""))
  if (!auditSummaryPath || !outPath || !runId) {
    throw new Error(
      "Usage: node tools/build_tp12_no_stop_lb5_year2x7_summary.mjs --audit-summary-path=<summary.json> --out=<summary.json> --run-id=<run_id> [--contract-path=PATH --freeze-result-path=PATH --train-apply-dir=<dir> --oos-apply-dir=<dir>]",
    )
  }
  const contract = await loadTp12NoStopLb5Year2x7ResearchContract({
    contractPath,
    cwd,
  })
  const result = await buildTp12NoStopLb5Year2x7ReplaySummary({
    contract,
    auditSummaryPath,
    freezeResultPath: freezeResultPath ? path.resolve(freezeResultPath) : null,
    trainApplyDir: trainApplyDir ? path.resolve(trainApplyDir) : null,
    oosApplyDir: oosApplyDir ? path.resolve(oosApplyDir) : null,
    outPath,
    runId,
  })
  console.log(JSON.stringify({ outPath: result.outPath, reportPath: result.reportPath, status: result.summary.status }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
