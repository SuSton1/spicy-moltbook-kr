#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { assertTp12Year2hitOosPreflight } from "./assert_tp12_year2hit_oos_preflight.mjs"
import { buildTp12Year2hitGatedCatalog } from "../src/lib/tp12_year2hit_gated_catalog.mjs"
import { freezeTp12Year2hitSurvivorCatalog } from "../src/lib/tp12_survivor_catalog_freeze.mjs"
import { sha256TextLines } from "../src/lib/tp12_year2hit_train_gate.mjs"

const writeJson = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-oos-preflight-extended-"))
try {
  const labelEventsPath = path.join(tmp, "label_events.jsonl")
  const labelManifestPath = path.join(tmp, "label_manifest.json")
  const tokenizedEventsPath = path.join(tmp, "tokenized_events.jsonl")
  const tokenDictionaryManifestPath = path.join(tmp, "token_dictionary_manifest.json")
  const candidateCatalogPath = path.join(tmp, "candidate_catalog.jsonl")
  const candidateEventsPath = path.join(tmp, "candidate_events.jsonl")
  const eventRowManifestPath = path.join(tmp, "event_row_manifest.json")
  const contractPath = path.join(tmp, "contract.json")
  const dataReadinessSummaryPath = path.join(tmp, "data_readiness_summary.json")
  const asofSurvivorshipSummaryPath = path.join(tmp, "asof_survivorship_summary.json")
  const trainGateSummaryPath = path.join(tmp, "train_gate_summary.json")
  const qualityGateSummaryPath = path.join(tmp, "quality_gate_summary.json")
  const survivorCatalogPath = path.join(tmp, "survivor_catalog.jsonl")
  const survivorCatalogManifestPath = path.join(tmp, "survivor_catalog_manifest.json")
  const gatedCatalogPath = path.join(tmp, "gated_catalog.jsonl")
  const gatedCatalogManifestPath = path.join(tmp, "gated_catalog_manifest.json")
  const survivorPatternIds = ["p"]
  const survivorPatternIdsSha256 = sha256TextLines(survivorPatternIds)

  await writeJsonl(labelEventsPath, [
    { kind: "tp12_label_event_v1", eventId: "e1", patternId: "p", symbol: "000001", decisionDateKey: "2020-01-02", hitTarget: true },
  ])
  await writeJson(labelManifestPath, {
    kind: "tp12_label_event_build_summary_v1",
    status: "passed",
    outEventsPath: labelEventsPath,
    validLabelCount: 1,
    failures: [],
  })
  await writeJsonl(tokenizedEventsPath, [
    {
      kind: "tp12_tokenized_event_v1",
      eventId: "e1",
      symbol: "000001",
      decisionDateKey: "2020-01-02",
      hitTarget: true,
      tokens: ["px:ret1_ge_0p03"],
    },
  ])
  await writeJson(tokenDictionaryManifestPath, {
    kind: "tp12_tokenized_event_build_summary_v1",
    status: "passed",
    labelEventsPath,
    outEventsPath: tokenizedEventsPath,
    outputRowCount: 1,
    failures: [],
  })
  await writeJsonl(candidateCatalogPath, [
    { kind: "tp12_year2hit_candidate_pattern_v1", patternId: "p", tokenSet: ["px:ret1_ge_0p03"], year2hitPassed: true, qualityPassed: true },
  ])
  await writeJsonl(candidateEventsPath, [
    { kind: "tp12_candidate_event_v1", patternId: "p", symbol: "000001", decisionDateKey: "2020-01-02", hitTarget: true },
  ])
  await writeJson(eventRowManifestPath, {
    kind: "tp12_candidate_event_materialize_summary_v1",
    status: "passed",
    candidateCatalogPath,
    tokenizedEventsPath,
    outEventsPath: candidateEventsPath,
    outputRowCount: 1,
    failures: [],
  })
  await writeJson(contractPath, {
    kind: "tp12_year2hit_train_first_contract_v1",
    trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
    oosDateRange: { from: "2025-01-02", to: "2026-04-17" },
    oosPreflight: {
      blockedWithoutTrainGate: true,
      blockedWithoutDataReadiness: true,
      blockedWithoutAsofSurvivorship: true,
      blockedWithoutExtendedManifests: true,
    },
  })
  await writeJson(dataReadinessSummaryPath, {
    kind: "tp12_year2hit_data_readiness_summary_v1",
    status: "passed",
    failures: [],
  })
  await writeJson(asofSurvivorshipSummaryPath, {
    kind: "tp12_asof_survivorship_summary_v1",
    status: "passed",
    failures: [],
  })
  await writeJson(trainGateSummaryPath, {
    kind: "tp12_year2hit_quality_filtered_train_gate_summary_v1",
    status: "passed",
    survivorCount: 1,
    survivorPatternIds,
    survivorPatternIdsSha256,
    trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
  })
  await writeJson(qualityGateSummaryPath, {
    kind: "tp12_year2hit_quality_gate_summary_v1",
    status: "passed",
    passedSurvivorCount: 1,
    rejectedSurvivorCount: 0,
    survivorPatternIdsSha256,
    passedPatternIds: survivorPatternIds,
    passedPatternIdsSha256: survivorPatternIdsSha256,
    passed: [
      {
        patternId: "p",
        tokenSet: ["px:ret1_ge_0p03"],
        matchRows: 3,
        hitRows: 2,
        rowPrecision: 2 / 3,
        matchedDateCount: 3,
        hitDateCount: 2,
        datePrecision: 2 / 3,
        uniqueMatchedSymbols: 3,
        uniqueHitSymbols: 2,
      },
    ],
  })
  await freezeTp12Year2hitSurvivorCatalog({
    candidateCatalogPath,
    qualityGateSummaryPath,
    outCatalogPath: survivorCatalogPath,
    outManifestPath: survivorCatalogManifestPath,
  })
  await buildTp12Year2hitGatedCatalog({
    sourceCatalogPath: candidateCatalogPath,
    trainGateSummaryPath,
    outCatalogPath: gatedCatalogPath,
    outManifestPath: gatedCatalogManifestPath,
  })

  const summary = await assertTp12Year2hitOosPreflight({
    contractPath,
    dataReadinessSummaryPath,
    asofSurvivorshipSummaryPath,
    labelManifestPath,
    tokenDictionaryManifestPath,
    eventRowManifestPath,
    qualityGateSummaryPath,
    survivorCatalogManifestPath,
    trainGateSummaryPath,
    gatedCatalogPath,
    gatedCatalogManifestPath,
    oosFrom: "2025-01-02",
    oosTo: "2026-04-17",
    requireExtendedManifests: true,
  })
  assert.equal(summary.status, "passed")
  assert.equal(summary.survivorCatalogManifestPath, survivorCatalogManifestPath)
  assert.equal(summary.dataReadinessSummaryPath, dataReadinessSummaryPath)
  assert.equal(summary.asofSurvivorshipSummaryPath, asofSurvivorshipSummaryPath)

  await assert.rejects(
    () =>
      assertTp12Year2hitOosPreflight({
        contractPath,
        dataReadinessSummaryPath,
        asofSurvivorshipSummaryPath,
        trainGateSummaryPath,
        gatedCatalogPath,
        gatedCatalogManifestPath,
        requireExtendedManifests: true,
      }),
    /label manifest path is required/,
  )
  await assert.rejects(
    () =>
      assertTp12Year2hitOosPreflight({
        contractPath,
        labelManifestPath,
        tokenDictionaryManifestPath,
        eventRowManifestPath,
        qualityGateSummaryPath,
        survivorCatalogManifestPath,
        trainGateSummaryPath,
        gatedCatalogPath,
        gatedCatalogManifestPath,
        requireExtendedManifests: true,
      }),
    /data readiness summary path is required/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_year2hit_oos_preflight_extended")
