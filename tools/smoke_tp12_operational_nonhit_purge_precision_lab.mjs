#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12OperationalNonhitAnatomyReport } from "../src/lib/tp12_operational_nonhit_anatomy_report.mjs"
import { buildTp12OperationalSeedSupportRows } from "../src/lib/tp12_operational_seed_support_materializer.mjs"
import {
  mineTp12OperationalVetoSeedCandidates,
  verifyTp12OperationalVetoSeeds,
} from "../src/lib/tp12_operational_veto_term_miner.mjs"

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

const writeJsonl = async (filePath, rows) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-nonhit-purge-lab-"))
try {
  const contractPath = path.join(tmp, "contract.json")
  const candidateCatalogPath = path.join(tmp, "candidate_catalog.jsonl")
  const tokenizedEventsPath = path.join(tmp, "tokenized_events.jsonl")
  const candlePath = path.join(tmp, "candles.jsonl")
  const supportRowsPath = path.join(tmp, "support_rows.jsonl")
  const supportSummaryPath = path.join(tmp, "support_summary.json")
  const reportPath = path.join(tmp, "nonhit_report.json")
  const candidatesPath = path.join(tmp, "veto_candidates.jsonl")
  const miningSummaryPath = path.join(tmp, "veto_summary.json")
  const verifiedPath = path.join(tmp, "verified.jsonl")
  const verifiedSummaryPath = path.join(tmp, "verified_summary.json")
  await writeJson(contractPath, {
    contractId: "smoke_tp12_operational_nonhit_purge_precision_lab",
    patchKey: "tp12_operational_nonhit_purge_precision_lab_v1",
    trainDateRange: { from: "2020-01-01", to: "2021-12-31" },
    lockedFuture: { from: "2025-01-02", failOnForbiddenFutureRows: true },
    defaultInputs: { candidateCatalogPath, tokenizedEventsPath, candlePath },
    candidateFrontier: {
      allowedStatuses: ["raw_survivor"],
      maxCandidateCount: 5,
      maxCandidateMatchRows: 100,
      lowFalsePositiveCount: 5,
      highPrecisionCount: 5,
      balancedCount: 5,
      lowFalsePositiveMaxRows: 10,
      highPrecisionMinRowPrecision: 0,
      requireYear2hitPassed: true,
    },
    supportMaterializer: {
      hitField: "operationalHitTarget",
      maxSupportRowsTotal: 100,
      maxSupportRowsPerCandidate: 100,
      failOnMissingCandle: true,
      failOnMissingOperationalHitField: true,
    },
    vetoMining: {
      coreYears: [2020, 2021],
      minHitsPerYear: 1,
      maxFalsePositiveRows: 0,
      requiredRowPrecision: 1,
      maxRequireTerms: 1,
      maxVetoTerms: 1,
      topRequireTermsPerPattern: 12,
      topVetoTermsPerPattern: 12,
      minRuleHitRows: 2,
      minUniqueHitSymbols: 2,
      maxRuleEvaluationsPerPattern: 500,
      failOnSearchBudgetExceeded: true,
      failOnZeroVerifiedSeeds: true,
    },
  })
  await writeJsonl(candidateCatalogPath, [
    {
      patternId: "seed_base",
      patternKind: "single_token",
      tokenSet: ["seed:base"],
      status: "raw_survivor",
      year2hitPassed: true,
      qualityPassed: false,
      matchRows: 6,
      hitRows: 4,
      falsePositiveRows: 2,
      rowPrecision: 4 / 6,
      minYearHitDates: 1,
    },
  ])
  const hitRows = [
    ["H20A", "2020-01-02"],
    ["H20B", "2020-01-03"],
    ["H21A", "2021-01-04"],
    ["H21B", "2021-01-05"],
  ]
  const missRows = [
    ["M20A", "2020-02-03"],
    ["M21A", "2021-02-03"],
  ]
  await writeJsonl(tokenizedEventsPath, [
    ...hitRows.map(([symbol, decisionDateKey]) => ({
      symbol,
      decisionDateKey,
      tokens: ["seed:base"],
      operationalHitTarget: true,
      chartHitTarget: true,
      entryExecutable: true,
      operationalMissReasons: [],
    })),
    ...missRows.map(([symbol, decisionDateKey]) => ({
      symbol,
      decisionDateKey,
      tokens: ["seed:base"],
      operationalHitTarget: false,
      chartHitTarget: false,
      entryExecutable: true,
      operationalMissReasons: ["not_chart_hit"],
    })),
  ])
  await writeJsonl(candlePath, [
    ...hitRows.map(([symbol, dateKey]) => ({ symbol, dateKey, open: 10, high: 12, low: 9, close: 12, volume: 1000 })),
    ...missRows.map(([symbol, dateKey]) => ({ symbol, dateKey, open: 10, high: 14, low: 9.8, close: 10.2, volume: 1000 })),
  ])
  const support = await buildTp12OperationalSeedSupportRows({
    contractPath,
    outSupportRowsPath: supportRowsPath,
    outSummaryPath: supportSummaryPath,
  })
  assert.equal(support.summary.supportRows, 6)
  assert.equal(support.summary.missRows, 2)
  const anatomy = await buildTp12OperationalNonhitAnatomyReport({
    contractPath,
    supportRowsPath,
    outReportPath: reportPath,
  })
  assert.equal(anatomy.report.misses, 2)
  const mined = await mineTp12OperationalVetoSeedCandidates({
    contractPath,
    supportRowsPath,
    outCandidatesPath: candidatesPath,
    outSummaryPath: miningSummaryPath,
  })
  assert.ok(mined.summary.acceptedCount >= 1)
  const verified = await verifyTp12OperationalVetoSeeds({
    contractPath,
    supportRowsPath,
    candidatesPath,
    outVerifiedPath: verifiedPath,
    outSummaryPath: verifiedSummaryPath,
  })
  assert.ok(verified.summary.verifiedOperational100SeedCount >= 1)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_operational_nonhit_purge_precision_lab")

