#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import {
  assertTp12PositiveMotifContract,
  buildTp12PreHitChartSnapshots,
  buildTp12SymbolicMotifFeatures,
  buildTp12TrainLabelUniverse,
} from "../src/lib/tp12_train100_positive_motif_common.mjs"
import { iterateJsonlMaybeGzip } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const years = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]

const writeJsonl = async (filePath, rows) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const contractFor = () => ({
  kind: "tp12_train100_positive_motif_contrastive_contract_v1",
  patchKey: "tp12_train100_sequence_shapelet_contrastive_v1",
  trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
  forbiddenDateRange: { from: "2025-01-02", to: "2026-04-17" },
  label: { entryPolicy: "GLOBAL_NEXT_SESSION_OPEN", targetPct: 0.12, holdDays: 3, stopPolicy: "NO_STOP" },
  objective: {
    minHitDecisionDatesPerYear: 2,
    minHitSymbolDatesPerYear: 2,
    minTotalPositiveSymbolDates: 18,
    requireFalsePositiveRows: 0,
    requireTrainPrecision: 1,
  },
  expression: {
    form: "positive_motif_anchor_and_not_conditional_veto",
    maxAnchorAtoms: 4,
    maxVetoClauses: 2,
    maxVetoAtomsPerClause: 2,
    maxTotalAtoms: 8,
  },
  featurePolicy: {
    useDailyOhlcv: true,
    useDailyCandleSequence: true,
    useCrossSectionRank: true,
    useMarketContext: true,
    useSupportContext: "explicit_optional",
    useSideDaily: false,
    useIntraday: false,
    useThemeSector: false,
  },
  sequencePolicy: {
    lookbackDays: 5,
    minHistoryBars: 5,
    minHistoryCoverageRate: 1,
    requireCandleHistory: true,
  },
  forbiddenExpressionFields: [
    "symbolIdRaw",
    "dateIdRaw",
    "hitTarget",
    "hitDate",
    "maxForwardReturn",
    "minForwardDrawdown",
    "futureHigh",
    "futureLow",
    "targetBeforeStop",
    "stopBeforeTarget",
    "entryDateFutureOpen",
  ],
  outputPaths: {
    contractAssertSummary: "out/contract_assert_summary.json",
    trainLabelUniverse: "out/train_label_universe.jsonl.gz",
    trainLabelUniverseSummary: "out/train_label_universe_summary.json",
    preHitSnapshots: "out/pre_hit_chart_snapshots.jsonl.gz",
    preHitSnapshotManifest: "out/pre_hit_chart_snapshot_manifest.json",
    symbolicMotifFeatures: "out/symbolic_motif_features_train.jsonl.gz",
    symbolicMotifManifest: "out/symbolic_motif_feature_manifest.json",
    symbolicMotifCatalog: "out/symbolic_motif_catalog.jsonl.gz",
    symbolicMotifCatalogManifest: "out/symbolic_motif_catalog_manifest.json",
    positiveMotifAnchors: "out/positive_motif_anchor_catalog.jsonl.gz",
    positiveMotifMiningSummary: "out/positive_motif_mining_summary.json",
    motifNegativeControls: "out/motif_negative_controls.jsonl.gz",
    motifNegativeControlSummary: "out/motif_negative_control_summary.json",
    anchorFullNegativeVerification: "out/anchor_full_negative_verification.jsonl.gz",
    anchorFullNegativeSummary: "out/anchor_full_negative_summary.json",
    falsePositiveContrastSummary: "out/false_positive_contrast_summary.json",
    vetoClauseCandidates: "out/veto_clause_candidates.jsonl.gz",
    foundPatterns: "out/train100_positive_motif_found_patterns.jsonl.gz",
    rejectedPatterns: "out/train100_positive_motif_rejected_patterns.jsonl.gz",
    vetoSetcoverSummary: "out/positive_motif_veto_setcover_summary.json",
    verifiedSurvivors: "out/train100_positive_motif_verified_survivors.jsonl.gz",
    verifierSummary: "out/train100_positive_motif_verifier_summary.json",
    certificate: "out/train100_positive_motif_certificate.json",
  },
  oosReadAllowed: false,
  fallbackAllowed: false,
})

const labelRows = () => {
  const rows = []
  for (const year of years) {
    for (let index = 0; index < 2; index += 1) {
      const month = String(index + 1).padStart(2, "0")
      rows.push({
        symbol: `S${year}${index}`,
        decisionDateKey: `${year}-${month}-10`,
        sourceDateKey: `${year}-${month}-10`,
        entryDateKey: `${year}-${month}-11`,
        hitTarget: true,
        maxForwardReturn: 0.16,
      })
    }
  }
  return rows
}

const candleRowsFor = (rows) => {
  const candles = []
  for (const row of rows) {
    const prefix = row.decisionDateKey.slice(0, 8)
    const symbol = row.symbol
    const base = 100
    const bars = [
      { day: "06", open: base, high: 106, low: 100, close: 101, volume: 1000 },
      { day: "07", open: 101, high: 107, low: 101, close: 102, volume: 1000 },
      { day: "08", open: 102, high: 103, low: 102, close: 102.5, volume: 200 },
      { day: "09", open: 102.5, high: 103.5, low: 102.5, close: 103, volume: 200 },
      { day: "10", open: 104, high: 112, low: 103.5, close: 111, volume: 5000 },
    ]
    for (const bar of bars) candles.push({ symbol, dateKey: `${prefix}${bar.day}`, ...bar })
  }
  return candles
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-sequence-shapelet-"))
try {
  const contract = contractFor()
  const contractPath = path.join(tmp, "contract.json")
  const labelsPath = path.join(tmp, "label_events.jsonl")
  const candlesPath = path.join(tmp, "candle_daily.jsonl")
  const labels = labelRows()
  await writeJson(contractPath, contract)
  await writeJsonl(labelsPath, labels)
  await writeJsonl(candlesPath, candleRowsFor(labels))

  await assertTp12PositiveMotifContract({ contractPath, cwd: tmp })
  await buildTp12TrainLabelUniverse({ contractPath, labelEventsPath: labelsPath, cwd: tmp })
  const snapshots = await buildTp12PreHitChartSnapshots({ contractPath, candleDailyPath: candlesPath, cwd: tmp })
  assert.equal(snapshots.candleHistoryCoverageRate, 1)
  const motif = await buildTp12SymbolicMotifFeatures({ contractPath, cwd: tmp })
  assert.ok(motif.uniqueMotifAtomCount > 0)
  const rows = []
  await iterateJsonlMaybeGzip(path.join(tmp, contract.outputPaths.symbolicMotifFeatures), {
    strict: true,
    onRow: async (row) => rows.push(row),
  })
  const atomSet = new Set(rows.flatMap((row) => row.motifAtoms ?? []))
  assert.ok([...atomSet].some((atom) => atom.startsWith("seq3ReturnPattern_")))
  assert.ok(atomSet.has("shapeletCompression2ExpansionD0"))
  assert.ok(atomSet.has("shapeletDryup2SurgeD0"))
  console.log("ok smoke_tp12_sequence_shapelet_features")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
