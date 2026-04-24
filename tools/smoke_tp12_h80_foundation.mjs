#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12EntryFeasibilityAudit } from "../src/lib/tp12_entry_feasibility_audit.mjs"
import { assertTp12H80TrainGate } from "../src/lib/tp12_h80_train_gate.mjs"
import { buildTp12NestedSplitPlan } from "../src/lib/tp12_nested_split_plan.mjs"
import { buildTp12PatternClusters } from "../src/lib/tp12_pattern_cluster_dedupe.mjs"
import { buildTp12PatternReliabilityByFold } from "../src/lib/tp12_pattern_reliability_by_fold.mjs"
import { buildTp12SymbolDateConsensusFeatures } from "../src/lib/tp12_symbol_date_consensus_features.mjs"

const writeJson = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-h80-foundation-"))
try {
  const calendarPath = path.join(tmp, "calendar.jsonl")
  const eventsPath = path.join(tmp, "events.jsonl")
  const validEventsPath = path.join(tmp, "valid_events.jsonl")
  const catalogPath = path.join(tmp, "catalog.jsonl")
  const foldReliabilityPath = path.join(tmp, "fold_reliability.jsonl")
  const foldReliabilityManifestPath = path.join(tmp, "fold_reliability_manifest.json")
  const clustersPath = path.join(tmp, "clusters.jsonl")
  const clusterSummaryPath = path.join(tmp, "cluster_summary.json")
  const consensusPath = path.join(tmp, "consensus.jsonl")
  const consensusSummaryPath = path.join(tmp, "consensus_summary.json")
  const selectorPassPath = path.join(tmp, "selector_pass.json")
  const selectorFailPath = path.join(tmp, "selector_fail.json")

  const calendarDates = [
    "2019-01-02",
    "2019-01-03",
    "2020-01-02",
    "2020-01-03",
    "2021-01-04",
    "2021-01-05",
    "2022-01-03",
    "2022-01-04",
    "2023-09-27",
    "2023-10-06",
  ]
  await writeJsonl(calendarPath, calendarDates.map((dateKey) => ({ dateKey })))

  const validEvents = [
    {
      patternId: "p1",
      tokenSet: ["px:gap_ge_0p04", "volatility:range_low"],
      symbol: "000001",
      decisionDateKey: "2019-01-02",
      entryDateKey: "2019-01-03",
      hitTarget: true,
    },
    {
      patternId: "p2",
      tokenSet: ["px:gap_ge_0p04", "volatility:range_low"],
      symbol: "000001",
      decisionDateKey: "2019-01-02",
      entryDateKey: "2019-01-03",
      hitTarget: true,
    },
    {
      patternId: "p3",
      tokenSet: ["liq:avg_value_high", "shape:close_pos_high"],
      symbol: "000002",
      decisionDateKey: "2020-01-02",
      entryDateKey: "2020-01-03",
      hitTarget: false,
    },
    {
      patternId: "p1",
      tokenSet: ["px:gap_ge_0p04", "volatility:range_low"],
      symbol: "000003",
      decisionDateKey: "2021-01-04",
      entryDateKey: "2021-01-05",
      hitTarget: true,
    },
    {
      patternId: "p1",
      tokenSet: ["px:gap_ge_0p04", "volatility:range_low"],
      symbol: "000004",
      decisionDateKey: "2022-01-03",
      entryDateKey: "2022-01-04",
      hitTarget: true,
    },
    {
      patternId: "p2",
      tokenSet: ["px:gap_ge_0p04", "volatility:range_low"],
      symbol: "000004",
      decisionDateKey: "2022-01-03",
      entryDateKey: "2022-01-04",
      hitTarget: true,
    },
    {
      patternId: "p1",
      tokenSet: ["px:gap_ge_0p04", "volatility:range_low"],
      symbol: "000006",
      decisionDateKey: "2023-09-27",
      entryDateKey: "2023-10-06",
      hitTarget: true,
    },
    {
      patternId: "p3",
      tokenSet: ["liq:avg_value_high", "shape:close_pos_high"],
      symbol: "000005",
      decisionDateKey: "2022-01-03",
      entryDateKey: "2022-01-04",
      hitTarget: false,
    },
  ]
  await writeJsonl(validEventsPath, validEvents)
  await writeJsonl(eventsPath, [
    ...validEvents,
    {
      patternId: "p_bad",
      tokenSet: ["px:stale"],
      symbol: "000005",
      decisionDateKey: "2021-01-04",
      entryDateKey: "2022-01-03",
      hitTarget: false,
    },
  ])

  const entryAudit = await buildTp12EntryFeasibilityAudit({
    eventsPath,
    calendarPath,
    outSummaryPath: path.join(tmp, "entry_audit.json"),
    outInvalidPath: path.join(tmp, "entry_invalid.jsonl"),
    failOnInvalid: false,
  })
  assert.equal(entryAudit.status, "failed")
  assert.equal(entryAudit.invalidRowCount, 1)
  assert.equal(entryAudit.invalidReasonCounts.entry_not_global_next_session, 1)
  assert.equal(entryAudit.longGlobalNextSessionCalendarGapRowCount, 1)
  assert.equal(entryAudit.maxObservedEntryGapTradingSessions, 2)
  assert.equal(entryAudit.invalidReasonCounts.entry_gap_calendar_days_above_max, 1)

  const splitPlan = await buildTp12NestedSplitPlan({
    calendarPath,
    outPath: path.join(tmp, "split_plan.json"),
    validationYears: "2021,2022",
    purgeBars: 3,
    embargoBars: 0,
    labelHorizonBars: 2,
  })
  assert.equal(splitPlan.status, "passed")
  assert.equal(splitPlan.outerFoldCount, 2)
  assert.equal(splitPlan.outerFolds[0].validationYear, 2021)
  assert.equal(splitPlan.outerFolds[0].labelHorizonOverlap.overlappingTrainDecisionDateCount, 0)

  const foldReliability = await buildTp12PatternReliabilityByFold({
    eventsPath: validEventsPath,
    splitPlanPath: path.join(tmp, "split_plan.json"),
    outPath: foldReliabilityPath,
    manifestPath: foldReliabilityManifestPath,
    priorStrengthRow: 0,
    priorStrengthDate: 0,
  })
  assert.equal(foldReliability.status, "passed")
  assert.ok(foldReliability.outputRowCount > 0)

  await writeJsonl(catalogPath, [
    { patternId: "p1", tokenSet: ["px:gap_ge_0p04", "volatility:range_low"] },
    { patternId: "p2", tokenSet: ["px:gap_ge_0p04", "volatility:range_low"] },
    { patternId: "p3", tokenSet: ["liq:avg_value_high", "shape:close_pos_high"] },
  ])
  const clusterSummary = await buildTp12PatternClusters({
    catalogPath,
    eventsPath: validEventsPath,
    outPath: clustersPath,
    summaryPath: clusterSummaryPath,
    tokenJaccardThreshold: 1,
    supportJaccardThreshold: 1,
  })
  assert.equal(clusterSummary.status, "passed")
  assert.equal(clusterSummary.clusterCount, 2)
  assert.equal(clusterSummary.maxClusterPatternCount, 2)

  const consensusSummary = await buildTp12SymbolDateConsensusFeatures({
    eventsPath: validEventsPath,
    patternReliabilityPath: foldReliabilityPath,
    clustersPath,
    outPath: consensusPath,
    summaryPath: consensusSummaryPath,
    foldId: "outer_2022",
    splitPlanPath: path.join(tmp, "split_plan.json"),
  })
  assert.equal(consensusSummary.status, "passed")
  assert.equal(consensusSummary.symbolDateRowCount, 2)
  const consensusRows = (await fs.readFile(consensusPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  const doubleSupport = consensusRows.find((row) => row.decisionDateKey === "2022-01-03" && row.symbol === "000004")
  assert.equal(doubleSupport.supportPatternCount, 2)
  assert.equal(doubleSupport.supportClusterCount, 1)
  assert.equal(doubleSupport.dayRank, 1)

  await writeJson(selectorPassPath, {
    selectedRows: 100,
    hitRows: 90,
    concentration: {
      topSymbolShare: 0.05,
      topPatternClusterShare: 0.2,
      topRegimeShare: 0.4,
      topMonthShare: 0.1,
    },
    coverage: {
      activeYearCount: 4,
      activeMonthCount: 24,
    },
  })
  const h80Pass = await assertTp12H80TrainGate({
    selectorSummaryPath: selectorPassPath,
    outPath: path.join(tmp, "h80_pass.json"),
  })
  assert.equal(h80Pass.status, "passed")

  await writeJson(selectorFailPath, {
    selectedRows: 150,
    hitRows: 89,
    concentration: {
      topSymbolShare: 0.05,
      topPatternClusterShare: 0.2,
      topRegimeShare: 0.4,
      topMonthShare: 0.1,
    },
    coverage: {
      activeYearCount: 4,
      activeMonthCount: 24,
    },
  })
  const h80Fail = await assertTp12H80TrainGate({
    selectorSummaryPath: selectorFailPath,
    outPath: path.join(tmp, "h80_fail.json"),
    failOnGateFailure: false,
  })
  assert.equal(h80Fail.status, "failed")
  assert.ok(h80Fail.rejectReasons.includes("wilson_lower95_below_min"))

  const selectorMultiPath = path.join(tmp, "selector_multi.json")
  await writeJson(selectorMultiPath, {
    policySummaries: [
      { policyKey: "locked_policy", bestTopCut: { topN: 100, hitRows: 90 } },
      { policyKey: "posthoc_policy", bestTopCut: { topN: 100, hitRows: 95 } },
    ],
    concentration: {
      topSymbolShare: 0.05,
      topPatternClusterShare: 0.2,
      topRegimeShare: 0.4,
      topMonthShare: 0.1,
    },
    coverage: {
      activeYearCount: 4,
      activeMonthCount: 24,
    },
  })
  await assert.rejects(
    () =>
      assertTp12H80TrainGate({
        selectorSummaryPath: selectorMultiPath,
        outPath: path.join(tmp, "h80_multi_missing_selector.json"),
      }),
    /pass selectorKey/,
  )
  const h80Locked = await assertTp12H80TrainGate({
    selectorSummaryPath: selectorMultiPath,
    outPath: path.join(tmp, "h80_multi_locked_selector.json"),
    selectorKey: "locked_policy",
  })
  assert.equal(h80Locked.status, "passed")
  assert.equal(h80Locked.selectorKey, "locked_policy")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_h80_foundation")
