#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import { buildTp12ExecutableConsensusRows } from "./build_tp12_executable_consensus_rows.mjs"
import { main as buildMicroSplit } from "./build_tp12_year2hit_zero_fp_micro_split.mjs"
import { main as replayExecutableCovers } from "./replay_tp12_micro_split_covers_executable.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const readJsonl = async (filePath) =>
  (await fs.readFile(filePath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-executable-nested-micro-"))
try {
  const eventsPath = path.join(tmp, "events.jsonl")
  const contextPath = path.join(tmp, "context.jsonl")
  const labelsPath = path.join(tmp, "labels.jsonl")
  const labelEventsPath = path.join(tmp, "label_events.jsonl")
  const catalogPath = path.join(tmp, "catalog.jsonl")
  const clustersPath = path.join(tmp, "clusters.jsonl")
  const candlesPath = path.join(tmp, "candles.jsonl")
  const enrichedPath = path.join(tmp, "operational_rows.jsonl")
  const nonExecutablePath = path.join(tmp, "non_executable_rows.jsonl")
  const summaryPath = path.join(tmp, "operational_summary.json")
  const contractPath = path.join(tmp, "contract.json")
  const rulesPath = path.join(tmp, "rules.jsonl")
  const microOutDir = path.join(tmp, "micro")
  const replayOutDir = path.join(tmp, "replay")

  const coreYears = Array.from({ length: 9 }, (_, index) => 2016 + index)
  const events = []
  const context = []
  const labels = []
  const candles = []
  const addCase = ({ symbol, patternId, decisionDateKey, entryDateKey, chartHit, decisionClose, entryOpen, entryHigh, entryLow, entryClose, entryVolume }) => {
    events.push({ patternId, symbol, decisionDateKey, hitTarget: chartHit })
    context.push({
      symbol,
      decisionDateKey,
      gapPct: 0.01,
      returnVol20: patternId === "P_GOOD" ? 0.9 : 0.1,
    })
    labels.push({
      symbol,
      decisionDateKey,
      entryDateKey,
      entryPrice: entryOpen,
      targetPrice: entryOpen * 1.12,
      hitTarget: chartHit,
      labelClass: chartHit ? "positive" : "hard_negative",
      maxForwardReturn: entryHigh / entryOpen - 1,
      minForwardReturn: entryLow / entryOpen - 1,
      labelStatus: "valid",
    })
    candles.push({ symbol, dateKey: decisionDateKey, open: decisionClose, high: decisionClose, low: decisionClose, close: decisionClose, volume: 1000 })
    candles.push({ symbol, dateKey: entryDateKey, open: entryOpen, high: entryHigh, low: entryLow, close: entryClose, volume: entryVolume })
  }

  for (const year of coreYears) {
    addCase({
      symbol: `H${year}A`,
      patternId: "P_GOOD",
      decisionDateKey: `${year}-01-02`,
      entryDateKey: `${year}-01-03`,
      chartHit: true,
      decisionClose: 100,
      entryOpen: 100,
      entryHigh: 113,
      entryLow: 99,
      entryClose: 110,
      entryVolume: 1000,
    })
    addCase({
      symbol: `H${year}B`,
      patternId: "P_GOOD",
      decisionDateKey: `${year}-02-02`,
      entryDateKey: `${year}-02-03`,
      chartHit: true,
      decisionClose: 100,
      entryOpen: 101,
      entryHigh: 114,
      entryLow: 100,
      entryClose: 112,
      entryVolume: 1000,
    })
  }
  addCase({
    symbol: "BADGAP",
    patternId: "P_BAD",
    decisionDateKey: "2020-03-02",
    entryDateKey: "2020-03-03",
    chartHit: true,
    decisionClose: 100,
    entryOpen: 130,
    entryHigh: 146,
    entryLow: 130,
    entryClose: 146,
    entryVolume: 1000,
  })
  addCase({
    symbol: "BADMISS",
    patternId: "P_BAD",
    decisionDateKey: "2021-03-02",
    entryDateKey: "2021-03-03",
    chartHit: false,
    decisionClose: 100,
    entryOpen: 100,
    entryHigh: 104,
    entryLow: 98,
    entryClose: 99,
    entryVolume: 1000,
  })

  await writeJsonl(eventsPath, events)
  await writeJsonl(contextPath, context)
  await writeJsonl(labelsPath, labels)
  await writeJsonl(labelEventsPath, labels)
  await writeJsonl(candlesPath, candles)
  await writeJsonl(catalogPath, [
    { patternId: "P_GOOD", tokenSet: ["shape:good"] },
    { patternId: "P_BAD", tokenSet: ["shape:bad"] },
  ])
  await writeJsonl(clustersPath, [
    { clusterId: "C_GOOD", patternIds: ["P_GOOD"] },
    { clusterId: "C_BAD", patternIds: ["P_BAD"] },
  ])

  const { summary } = await buildTp12ExecutableConsensusRows({
    eventsPath,
    reliabilityEventsPath: eventsPath,
    contextPath,
    labelsPath,
    labelEventsPath,
    clustersPath,
    catalogPath,
    candlePath: candlesPath,
    dateFrom: "2016-01-02",
    dateTo: "2024-12-30",
    outEnrichedPath: enrichedPath,
    outNonExecutablePath: nonExecutablePath,
    outSummaryPath: summaryPath,
    patchKey: "smoke_tp12_executable_nested_micro_split",
  })
  assert.equal(summary.scopedRows, 20)
  assert.equal(summary.chartHitRows, 19)
  assert.equal(summary.executableHitRows, 18)
  assert.equal(summary.nonExecutableRows, 1)
  assert.equal(summary.nonExecutableHitRows, 1)
  assert.equal(summary.operationalMissRows, 2)

  const operationalRows = await readJsonl(enrichedPath)
  const badGap = operationalRows.find((row) => row.symbol === "BADGAP")
  assert.equal(badGap.chartHitTarget, true)
  assert.equal(badGap.entryExecutable, false)
  assert.equal(badGap.hitTarget, true)
  assert.equal(badGap.operationalHitTarget, false)
  assert.equal(badGap.executableHitTarget, false)
  assert.equal(badGap.labelClass, "non_executable_chart_hit")
  assert.equal(Object.prototype.hasOwnProperty.call(badGap, "entryOpen"), false)
  assert.equal(badGap.execution.entryGapPct >= 0.295, true)

  const hitDatesByYear = Object.fromEntries(coreYears.map((year) => [String(year), 2]))
  await writeJson(contractPath, {
    kind: "tp12_year2hit_zero_fp_micro_split_contract_v1",
    hitDefinition: "executable_hit_v1",
    trainDateRange: { from: "2016-01-02", to: "2024-12-30" },
    coreYears,
    target: {
      hitDefinition: "executable_hit_v1",
      minHitDecisionDatesPerYear: 2,
      minHitSymbolDatesPerYear: 2,
      minPositiveSymbolDatesTotal: 18,
      requiredTrainPrecision: 1,
      maxFalsePositiveRows: 0,
    },
    parents: { enabledBaseTypes: ["pattern"], maxParentRows: 100, maxParents: 4 },
    atomBuilder: {
      includeSupportPatternAtoms: true,
      includeSupportClusterAtoms: true,
      includeSupportTokenAtoms: true,
      includeTokenFamilyAtoms: true,
      includeNumericRankAtoms: false,
      maxTokenAtomsPerParent: 20,
      maxPatternAtomsPerParent: 20,
      maxClusterAtomsPerParent: 20,
    },
    mining: {
      includeSourceRuleCores: true,
      maxSourceRuleCoreDepth: 4,
      maxAtomPoolPerParent: 40,
      coreTopAtomCount: 20,
      maxCoreAtoms: 2,
      maxEvaluatedCoresPerParent: 200,
      maxCoreFalsePositiveRowsForVeto: 10,
      maxVetoAtoms: 2,
      maxVetoCandidatesPerCore: 20,
      minTileHitRows: 1,
      maxZeroFpTilesForCoverPerParent: 40,
    },
    cover: { maxTilesPerCover: 2, beamWidth: 20, maxCoverCandidatesPerParent: 4 },
  })
  await writeJsonl(rulesPath, [
    {
      baseType: "pattern",
      baseId: "P_GOOD",
      atoms: [],
      replayMetrics: {
        matchRows: 18,
        hitRows: 18,
        falsePositiveRows: 0,
        hitDatesByYear,
        hitSymbolDatesByYear: hitDatesByYear,
        minHitDatesPerYear: 2,
        minHitSymbolDatesPerYear: 2,
        year2hitPassed: true,
      },
    },
  ])
  await buildMicroSplit(
    ["--contract", contractPath, "--enriched", enrichedPath, "--broken-rules", rulesPath, "--out-dir", microOutDir],
    { cwd: process.cwd() },
  )
  const microSummary = JSON.parse(await fs.readFile(path.join(microOutDir, "micro_split_summary.json"), "utf8"))
  assert.equal(microSummary.finalSurvivorCount >= 1, true)
  assert.equal(microSummary.inputs.hitDefinition, "executable_hit_v1")

  await replayExecutableCovers(
    [
      "--contract",
      contractPath,
      "--survivors",
      path.join(microOutDir, "micro_split_final_survivors.jsonl"),
      "--enriched",
      enrichedPath,
      "--date-from",
      "2016-01-02",
      "--date-to",
      "2024-12-30",
      "--out-dir",
      replayOutDir,
    ],
    { cwd: process.cwd() },
  )
  const replaySummary = JSON.parse(await fs.readFile(path.join(replayOutDir, "executable_cover_replay_summary.json"), "utf8"))
  assert.equal(replaySummary.zeroOperationalFalsePositiveYear2CoverCount >= 1, true)
  assert.equal(replaySummary.unionMetrics.operationalFalsePositiveRows, 0)

  const emptyReplayDir = path.join(tmp, "empty_replay")
  const emptySurvivorsPath = path.join(tmp, "empty_survivors.jsonl")
  await writeJsonl(emptySurvivorsPath, [])
  await replayExecutableCovers(
    [
      "--contract",
      contractPath,
      "--survivors",
      emptySurvivorsPath,
      "--enriched",
      enrichedPath,
      "--date-from",
      "2016-01-02",
      "--date-to",
      "2024-12-30",
      "--allow-empty-survivors=true",
      "--out-dir",
      emptyReplayDir,
    ],
    { cwd: process.cwd() },
  )
  const emptyReplaySummary = JSON.parse(await fs.readFile(path.join(emptyReplayDir, "executable_cover_replay_summary.json"), "utf8"))
  assert.equal(emptyReplaySummary.verdict, "no_survivor_covers")
  assert.equal(emptyReplaySummary.survivorCoverCount, 0)
  assert.equal(emptyReplaySummary.unionMetrics.totalRows, 0)

  const leakPath = path.join(tmp, "leaky_rows.jsonl")
  await writeJsonl(leakPath, operationalRows.map((row, index) => (index === 0 ? { ...row, entryOpen: row.execution.entryOpen } : row)))
  await assert.rejects(
    () =>
      buildMicroSplit(
        ["--contract", contractPath, "--enriched", leakPath, "--broken-rules", rulesPath, "--out-dir", path.join(tmp, "leak_micro")],
        { cwd: process.cwd() },
      ),
    /execution field nested/,
  )

  console.log("ok smoke_tp12_executable_nested_micro_split")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
