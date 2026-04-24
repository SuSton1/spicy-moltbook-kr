#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12Year2hitTrainfoldSelectorAudit } from "../src/lib/tp12_year2hit_trainfold_selector_audit.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-trainfold-selector-audit-"))
try {
  const survivorCatalogPath = path.join(tmp, "survivor_catalog.jsonl")
  const candidateEventsPath = path.join(tmp, "candidate_events.jsonl")
  const outSummaryPath = path.join(tmp, "selector_audit_summary.json")
  const outReportPath = path.join(tmp, "selector_audit_report.md")
  await writeJsonl(survivorCatalogPath, [
    {
      kind: "tp12_year2hit_frozen_survivor_pattern_v1",
      patternId: "p1",
      tokenSet: ["px:gap_ge_0p04"],
      year2hitPassed: true,
      qualityPassed: true,
    },
    {
      kind: "tp12_year2hit_frozen_survivor_pattern_v1",
      patternId: "p2",
      tokenSet: ["level:max_close5_break"],
      year2hitPassed: true,
      qualityPassed: true,
    },
  ])
  await writeJsonl(candidateEventsPath, [
    { kind: "tp12_candidate_event_v1", patternId: "p1", symbol: "000001", decisionDateKey: "2020-01-02", hitTarget: true },
    { kind: "tp12_candidate_event_v1", patternId: "p2", symbol: "000002", decisionDateKey: "2020-01-02", hitTarget: false },
    { kind: "tp12_candidate_event_v1", patternId: "p1", symbol: "000003", decisionDateKey: "2020-01-03", hitTarget: true },
    { kind: "tp12_candidate_event_v1", patternId: "p2", symbol: "000004", decisionDateKey: "2020-01-03", hitTarget: false },
    { kind: "tp12_candidate_event_v1", patternId: "p1", symbol: "000005", decisionDateKey: "2021-01-04", hitTarget: true },
    { kind: "tp12_candidate_event_v1", patternId: "p2", symbol: "000006", decisionDateKey: "2021-01-04", hitTarget: false },
    { kind: "tp12_candidate_event_v1", patternId: "p1", symbol: "000007", decisionDateKey: "2021-01-05", hitTarget: false },
    { kind: "tp12_candidate_event_v1", patternId: "p2", symbol: "000008", decisionDateKey: "2021-01-05", hitTarget: true },
  ])

  const summary = await buildTp12Year2hitTrainfoldSelectorAudit({
    survivorCatalogPath,
    candidateEventsPath,
    outSummaryPath,
    outReportPath,
    coreYears: [2020, 2021],
    targetHitRate: 0.5,
    minSelectedRowsForTarget: 2,
  })
  assert.equal(summary.kind, "tp12_year2hit_trainfold_selector_audit_v1")
  assert.equal(summary.status, "measured")
  assert.equal(summary.survivorCount, 2)
  assert.equal(summary.trainDateCount, 4)
  assert.ok(summary.policySummaries.length >= 5)
  assert.ok(summary.policySummaries.some((row) => row.policyId === "current_like"))
  assert.ok(summary.bestTopCut)
  assert.match(await fs.readFile(outReportPath, "utf8"), /TP12 Year2Hit Train-Fold Selector Audit/)

  const badEventsPath = path.join(tmp, "bad_candidate_events.jsonl")
  await writeJsonl(badEventsPath, [
    { kind: "tp12_candidate_event_v1", patternId: "missing", symbol: "000001", decisionDateKey: "2020-01-02", hitTarget: true },
  ])
  await assert.rejects(
    () =>
      buildTp12Year2hitTrainfoldSelectorAudit({
        survivorCatalogPath,
        candidateEventsPath: badEventsPath,
        outSummaryPath: path.join(tmp, "bad.json"),
        coreYears: [2020, 2021],
      }),
    /outside survivor catalog/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_year2hit_trainfold_selector_audit")
