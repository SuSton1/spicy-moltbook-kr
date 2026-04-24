#!/usr/bin/env node
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { spawn } from "node:child_process"

import { readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"
import { techniquePatternDiscoveryFixtureContract } from "./_technique_pattern_contract_fixture.mjs"

const runNode = (cwd, args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stderr = ""
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk ?? "")
  })
  child.on("error", reject)
  child.on("exit", (code) => {
    if (code === 0) {
      resolve()
      return
    }
    reject(new Error(`child exited with code ${code}: ${stderr}`))
  })
})

const tempDir = await mkdtemp(path.join(os.tmpdir(), "technique-contrastive-stream-"))
try {
  const contract = {
    kind: "technique_pattern_discovery_contract_v4",
    contractId: "tp12_contrastive_core_veto_state_machine_v4_smoke",
    updatedAt: "2026-04-15T00:00:00.000Z",
    coreYears: [2017, 2018],
    excludedBoundaryYears: [],
    trainRange: {
      startDateKey: "2016-08-12",
      endDateKey: "2024-12-27",
    },
    minPositiveSupportPerYear: 2,
    maxPatternSize: 5,
    closureMode: "closed",
    ...techniquePatternDiscoveryFixtureContract,
    vetoSearchTopPatternsPerPartition: 2,
    maxVetoAtomCount: 2,
  }
  const contractPath = path.join(tempDir, "contract.json")
  const patternsPath = path.join(tempDir, "patterns.jsonl")
  const transactionsPath = path.join(tempDir, "transactions.jsonl")
  const outPath = path.join(tempDir, "contrastive_patterns.jsonl")
  const summaryPath = path.join(tempDir, "contrastive_summary.json")

  await writeJson(contractPath, contract)
  await writeJsonl(transactionsPath, [
    { rowId: "p1", decisionDateKey: "2017-01-03", yearKey: 2017, symbol: "A", partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid", hitTarget: true, atomIds: ["a", "good"] },
    { rowId: "p2", decisionDateKey: "2017-02-03", yearKey: 2017, symbol: "B", partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid", hitTarget: true, atomIds: ["a", "good"] },
    { rowId: "p3", decisionDateKey: "2018-01-03", yearKey: 2018, symbol: "C", partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid", hitTarget: true, atomIds: ["a", "good"] },
    { rowId: "p4", decisionDateKey: "2018-02-03", yearKey: 2018, symbol: "D", partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid", hitTarget: true, atomIds: ["a", "good"] },
    { rowId: "n1", decisionDateKey: "2019-01-03", yearKey: 2019, symbol: "E", partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid", hitTarget: false, atomIds: ["a", "x"] },
    { rowId: "n2", decisionDateKey: "2019-02-03", yearKey: 2019, symbol: "F", partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid", hitTarget: false, atomIds: ["a", "y"] },
  ])
  await writeJsonl(patternsPath, [
    {
      patternId: "core_c",
      partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid",
      generatorAtomIds: ["a"],
      preverifiedNegativeCount: 9,
      minYearSupport: 2,
      totalPositiveSupport: 4,
    },
    {
      patternId: "core_b",
      partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid",
      generatorAtomIds: ["a"],
      preverifiedNegativeCount: 3,
      minYearSupport: 2,
      totalPositiveSupport: 4,
    },
    {
      patternId: "core_a",
      partitionKey: "LOW_GAP_TOP__lb5__continuation__balanced__mid",
      generatorAtomIds: ["a"],
      preverifiedNegativeCount: 2,
      minYearSupport: 2,
      totalPositiveSupport: 4,
    },
  ])

  await runNode(process.cwd(), [
    "tools/build_technique_contrastive_veto_report.mjs",
    `--patterns-path=${patternsPath}`,
    `--transactions-path=${transactionsPath}`,
    `--out=${outPath}`,
    `--summary-out=${summaryPath}`,
    `--contract-path=${contractPath}`,
  ])

  const summary = await readJson(summaryPath)
  const rows = await readJsonl(outPath)
  assert.equal(summary.evaluatedCorePatternCount, 2)
  assert.equal(summary.partitionCount, 1)
  assert.equal(summary.contrastiveCandidateCount, 2)
  assert.equal(rows.length, 2)
  assert.ok(rows.every((row) => row.corePatternId === "core_a" || row.corePatternId === "core_b"))
  console.log("ok smoke_technique_contrastive_veto_report_streaming")
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
