#!/usr/bin/env node
import path from "node:path"
import { fileURLToPath } from "node:url"

import { ensureDir, readJson, writeJsonl } from "../src/lib/io.mjs"
import { auditTp12SideDailyCoverage } from "../src/lib/tp12_side_daily_coverage_audit.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const candidateRows = [
  { symbol: "111111", decisionDateKey: "2024-01-04", hitTarget: true },
  { symbol: "222222", decisionDateKey: "2024-01-04", hitTarget: false },
  { symbol: "111111", decisionDateKey: "2024-01-05", hitTarget: false },
  { symbol: "222222", decisionDateKey: "2024-01-05", hitTarget: true },
]

const sideRowsFor = (datasetId, rawField) => [
  { dataset: datasetId, symbol: "111111", dateKey: "2024-01-03", rawRow: { [rawField]: "10" } },
  { dataset: datasetId, symbol: "222222", dateKey: "2024-01-03", rawRow: { [rawField]: "20" } },
  { dataset: datasetId, symbol: "111111", dateKey: "2024-01-04", rawRow: { [rawField]: "30" } },
  { dataset: datasetId, symbol: "222222", dateKey: "2024-01-04", rawRow: { [rawField]: "40" } },
  { dataset: datasetId, symbol: "111111", dateKey: "2024-01-05", rawRow: { [rawField]: "50" } },
]

const main = async () => {
  const tmpRoot = path.join(ROOT, "artifacts", "checks", "smoke_tp12_side_daily_coverage_audit")
  const candidatePath = path.join(tmpRoot, "candidates.jsonl")
  const sideRoot = path.join(tmpRoot, "side")
  const outSummaryPath = path.join(tmpRoot, "summary.json")
  const outMissingPath = path.join(tmpRoot, "missing.jsonl")
  await ensureDir(sideRoot)
  await writeJsonl(candidatePath, candidateRows)
  await writeJsonl(path.join(sideRoot, "investor_daily.jsonl"), sideRowsFor("investor_daily", "ind_invsr"))
  await writeJsonl(path.join(sideRoot, "program_daily.jsonl"), sideRowsFor("program_daily", "prm_netprps_amt"))

  const summary = await auditTp12SideDailyCoverage({
    candidatesPath: candidatePath,
    datasets: [
      `investor_daily:${path.join(sideRoot, "investor_daily.jsonl")}`,
      `program_daily:${path.join(sideRoot, "program_daily.jsonl")}`,
    ],
    outSummaryPath,
    outMissingPath,
    dateFrom: "2024-01-01",
    dateTo: "2024-12-31",
    forbiddenDateFrom: "2025-01-02",
    forbiddenDateTo: "2026-04-17",
    minSameDateCoverage: 0.75,
    minStrictPriorCoverage: 1,
    minPriorOrSameCoverage: 1,
    maxMissingExamplesPerDataset: 10,
  })

  assert(summary.status === "passed_coverage_gate", `unexpected status: ${summary.status}`)
  assert(summary.candidateRows === 4, `unexpected candidateRows: ${summary.candidateRows}`)
  for (const dataset of summary.datasetSummaries) {
    assert(dataset.sameDateCoveredRows === 3, `unexpected sameDateCoveredRows for ${dataset.datasetId}`)
    assert(dataset.strictPriorCoveredRows === 4, `unexpected strictPriorCoveredRows for ${dataset.datasetId}`)
    assert(dataset.priorOrSameCoveredRows === 4, `unexpected priorOrSameCoveredRows for ${dataset.datasetId}`)
  }

  const writtenSummary = await readJson(outSummaryPath)
  assert(writtenSummary.patchKey === "tp12_h80_side_daily_coverage_audit_v1", "summary patchKey mismatch")

  let rejectedForbiddenDate = false
  try {
    await writeJsonl(candidatePath, [...candidateRows, { symbol: "333333", decisionDateKey: "2025-01-02", hitTarget: true }])
    await auditTp12SideDailyCoverage({
      candidatesPath: candidatePath,
      datasets: [`investor_daily:${path.join(sideRoot, "investor_daily.jsonl")}`],
      outSummaryPath,
      outMissingPath,
      forbiddenDateFrom: "2025-01-02",
      forbiddenDateTo: "2026-04-17",
    })
  } catch (error) {
    rejectedForbiddenDate = /forbidden range/.test(String(error?.message ?? error))
  }
  assert(rejectedForbiddenDate, "expected forbidden date failure")

  console.log("ok smoke_tp12_side_daily_coverage_audit")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
