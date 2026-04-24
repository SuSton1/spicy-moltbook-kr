#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import { buildTp12Train100NeutralEventRows } from "../src/lib/tp12_train100_neutral_event_builder.mjs"

const years = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]

const writeJsonl = async (filePath, rows) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8")
}

const contractFor = () => ({
  kind: "tp12_train100_neutral_anchor_veto_certificate_contract_v1",
  patchKey: "tp12_train100_neutral_anchor_veto_certificate_v1",
  trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
  forbiddenDateRange: { from: "2025-01-02", to: "2026-04-17" },
  labelConfig: { entryPolicy: "GLOBAL_NEXT_SESSION_OPEN", targetPct: 0.12, holdDays: 3, stopPolicy: "NO_STOP" },
  objective: {
    minHitDecisionDatesPerYear: 2,
    minHitSymbolDatesPerYear: 2,
    minTotalPositiveSymbolDates: 18,
    requireFalsePositiveRows: 0,
    requireTrainPrecision: 1,
  },
  expression: {
    allowedForms: ["anchor_and_not_conditional_veto"],
    maxAnchorAtoms: 4,
    maxVetoClauses: 4,
    maxVetoAtomsPerClause: 3,
    maxTotalAtoms: 10,
    allowedFeatureSpaceIds: ["tp12_fs1_neutral_ohlcv_intensity_v1"],
  },
  thresholdGrid: {
    percentile: [0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9],
    rankBuckets: ["bottom20", "bottom30", "mid20_80", "top30", "top20", "top10"],
    zScore: [-1.5, -1, -0.5, 0.5, 1, 1.5],
    counts: [0, 1, 2, 3, 5, 8, 13, 21],
    shares: [0.25, 0.5, 0.75],
    days: [5, 10, 20, 40, 60],
    wickRatio: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    closeLocation: [0.25, 0.5, 0.65, 0.8, 0.9],
  },
  forbiddenExpressionFields: ["hitTarget", "hitDate", "maxForwardReturn", "symbolIdRaw", "dateIdRaw"],
  oosReadAllowed: false,
  fallbackAllowed: false,
})

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-neutral-event-builder-"))
try {
  const contractPath = path.join(tmp, "contract.json")
  const candidatePath = path.join(tmp, "candidate_events.jsonl")
  const contextPath = path.join(tmp, "context_features.jsonl")
  const clustersPath = path.join(tmp, "pattern_clusters.jsonl")
  const outPath = path.join(tmp, "neutral_train_events.jsonl")
  const summaryPath = path.join(tmp, "neutral_train_events_summary.json")
  await writeJson(contractPath, contractFor())
  const candidates = []
  const contexts = []
  for (const year of years) {
    for (let index = 0; index < 2; index += 1) {
      const symbol = `A${year}${index}`
      const decisionDateKey = `${year}-01-${String(10 + index).padStart(2, "0")}`
      candidates.push({ symbol, decisionDateKey, hitTarget: true, patternId: "p1", tokenSet: ["px:ret3d_top20", "vol:relvol20_high"] })
      candidates.push({ symbol, decisionDateKey, hitTarget: true, patternId: "p2", tokenSet: ["shape:close_location_high"] })
      contexts.push({ symbol, decisionDateKey, asOfFeatureDateKey: decisionDateKey, return3d: 0.2, rangePct: 0.04, closeLocation: 0.8 })
    }
    const symbol = `N${year}`
    const decisionDateKey = `${year}-02-10`
    candidates.push({ symbol, decisionDateKey, hitTarget: false, patternId: "p1", tokenSet: ["px:ret3d_top20"] })
    contexts.push({ symbol, decisionDateKey, asOfFeatureDateKey: decisionDateKey, return3d: 0.05, rangePct: 0.02, closeLocation: 0.4 })
  }
  await writeJsonl(candidatePath, candidates)
  await writeJsonl(contextPath, contexts)
  await writeJsonl(clustersPath, [{ clusterId: "c1", patternIds: ["p1"] }, { clusterId: "c2", patternIds: ["p2"] }])
  const summary = await buildTp12Train100NeutralEventRows({
    contractPath,
    candidateEventsPath: candidatePath,
    contextFeaturesPath: contextPath,
    patternClustersPath: clustersPath,
    outPath,
    summaryPath,
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.outputRowCount, 27)
  assert.equal(summary.hitRows, 18)
  assert.equal(summary.byYearHitRows["2024"], 2)
  const rows = (await fs.readFile(outPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  const first = rows.find((row) => row.hitTarget === true)
  assert.equal(first.supportPatternCount, 2)
  assert.equal(first.supportClusterCount, 2)
  assert.equal(first.familyDiversity, 3)
  assert.equal(first.dayUniqueSymbols, 1)
  assert.equal(first.dayUniquePatterns, 2)
  await assert.rejects(
    () =>
      buildTp12Train100NeutralEventRows({
        contractPath,
        candidateEventsPath: candidatePath,
        contextFeaturesPath: contextPath,
        outPath: path.join(tmp, "oos", "bad.jsonl"),
        summaryPath: path.join(tmp, "bad-summary.json"),
      }),
    /OOS/,
  )
  console.log("ok smoke_tp12_train100_neutral_event_builder")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
