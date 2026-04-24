#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { normalizeTp12Train100Frontier } from "../src/lib/tp12_train100_frontier_normalizer.mjs"
import { pruneTp12Train100FrontierDominance } from "../src/lib/tp12_train100_dominance_pruner.mjs"
import { applyTp12Train100UnsatBounds } from "../src/lib/tp12_train100_unsat_bounds.mjs"
import {
  buildTp12Train100PartitionCompletionStatus,
  buildTp12Train100PartitionedCompletionPlan,
} from "../src/lib/tp12_train100_partitioned_completion.mjs"
import { verifyTp12Train100SurvivorCatalog } from "../src/lib/tp12_train100_survivor_verifier.mjs"
import { buildTp12Train100UnsatCompletionCertificate } from "../src/lib/tp12_train100_unsat_completion_certificate.mjs"

const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const writeJsonl = async (filePath, rows) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8")
}

const allYears = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]

const candidateYearStats = () =>
  Object.fromEntries(allYears.map((year) => [String(year), { hitDecisionDates: 2, hitSymbolDates: 2 }]))

const baseContract = (tmp, overrides = {}) => ({
  kind: "tp12_train100_year2hit_unsat_completion_cert_contract_v1",
  patchKey: "tp12_train100_year2hit_unsat_completion_cert_v1",
  trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
  forbiddenDateRange: { from: "2025-01-02", to: "2026-04-17" },
  coreYears: allYears,
  target: {
    minHitDecisionDatesPerYear: 2,
    minHitSymbolDatesPerYear: 2,
    minPositiveSymbolDatesTotal: 18,
    requiredTrainPrecision: 1,
    maxFalsePositiveRows: 0,
  },
  searchScope: {
    sourceCloseoutSummary: "closeout.json",
    sourceExistenceCertificate: "source_existence.json",
    miningContractPath: "mining_contract.json",
    resumeCheckpointPath: "checkpoint.json",
    atomEventsPath: "atom_events.jsonl",
    survivorCandidateCatalogPath: "candidates.jsonl",
    maxPatternAtoms: 7,
    allowMissingFrontierSourceForCertificate: true,
    allowMissingSurvivorCatalogForCertificate: true,
    ...(overrides.searchScope ?? {}),
  },
  completion: {
    partitionCount: 2,
    maxAdditionalVisitedStatesPerShard: 1000,
    maxCounterexampleScan: 1,
    allowIncomplete: true,
  },
  rules: {
    oosReadAllowed: false,
    emitSelectorAllowed: false,
    fallbackAllowed: false,
    relaxPrecisionAllowed: false,
    relaxYear2HitAllowed: false,
    oosReplayAllowed: false,
  },
  outputPaths: {
    normalizedFrontier: "out/normalized_frontier.jsonl",
    frontierNormalizationSummary: "out/frontier_normalization_summary.json",
    dominancePrunedFrontier: "out/dominance_pruned_frontier.jsonl",
    dominancePruneSummary: "out/dominance_prune_summary.json",
    boundsPrunedFrontier: "out/bounds_pruned_frontier.jsonl",
    unsatBoundsSummary: "out/unsat_bounds_summary.json",
    partitionPlan: "out/partition_plan.json",
    partitionShardDir: "out/shards",
    partitionReport: "out/partition_report.json",
    partitionCompletionStatus: "out/partition_completion_status.json",
    verifiedSurvivorCatalog: "out/verified_survivor_catalog.jsonl",
    survivorVerificationSummary: "out/survivor_verification_summary.json",
    certificateSummary: "out/certificate_summary.json",
    certificateReport: "out/certificate_report.md",
  },
})

const writeCommonSources = async (tmp, { checkpoint = true, candidates = true } = {}) => {
  await writeJson(path.join(tmp, "closeout.json"), {
    kind: "tp12_train100_closeout_summary_v1",
    status: "passed",
    closeoutStatus: "closed_negative_incomplete",
    acceptedTrain100PatternCount: 0,
    acceptedCandidateCount: 0,
    globalVisitedStateCount: 16,
    remainingFrontierSize: checkpoint ? 2 : 4,
    searchComplete: false,
    oosRead: false,
  })
  await writeJson(path.join(tmp, "source_existence.json"), {
    kind: "tp12_train100_year2hit_existence_certificate_v1",
    status: "passed",
    conclusion: {
      code: "no_survivor_found_but_global_existence_unresolved",
      existenceResolved: false,
    },
    oosRead: false,
  })
  await writeJson(path.join(tmp, "mining_contract.json"), { kind: "fake_mining_contract_v1", oosRead: false })
  await writeJsonl(path.join(tmp, "atom_events.jsonl"), [{ kind: "fake_atom_event_v1" }])
  if (checkpoint) {
    await writeJsonl(path.join(tmp, "frontier.jsonl"), [
      { atomIds: ["a"], supportHash: "aaa" },
      { atomIds: ["a"], supportHash: "aaa" },
      { atomIds: ["b", "c"], supportHash: "bbb" },
    ])
    await writeJson(path.join(tmp, "checkpoint.json"), {
      kind: "tp12_train100_counterexample_exact_completion_checkpoint_v1",
      frontierPath: path.join(tmp, "frontier.jsonl"),
      frontierSize: 3,
      oosRead: false,
    })
  }
  if (candidates) {
    await writeJsonl(path.join(tmp, "candidates.jsonl"), [
      {
        kind: "tp12_train100_candidate_v1",
        atomIds: ["survivor_atom"],
        matchRows: 18,
        hitRows: 18,
        falsePositiveRows: 0,
        trainPrecision: 1,
        yearStats: candidateYearStats(),
      },
      {
        kind: "tp12_train100_candidate_v1",
        atomIds: ["bad_atom"],
        matchRows: 19,
        hitRows: 18,
        falsePositiveRows: 1,
        trainPrecision: 18 / 19,
        yearStats: candidateYearStats(),
      },
    ])
  }
}

const runAvailableSourceSmoke = async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-unsat-cert-source-"))
  try {
    await writeCommonSources(tmp, { checkpoint: true, candidates: true })
    const contractPath = path.join(tmp, "contract.json")
    await writeJson(contractPath, baseContract(tmp))

    const normalized = await normalizeTp12Train100Frontier({ contractPath, cwd: tmp })
    assert.equal(normalized.status, "passed")
    assert.equal(normalized.outputFrontierSize, 2)

    const dominance = await pruneTp12Train100FrontierDominance({ contractPath, cwd: tmp })
    assert.equal(dominance.status, "passed")
    assert.equal(dominance.outputFrontierSize, 2)

    const bounds = await applyTp12Train100UnsatBounds({ contractPath, cwd: tmp })
    assert.equal(bounds.status, "passed")
    assert.equal(bounds.outputFrontierSize, 2)

    const plan = await buildTp12Train100PartitionedCompletionPlan({ contractPath, cwd: tmp })
    assert.equal(plan.status, "planned")
    assert.equal(plan.plannedFrontierSize, 2)
    assert.equal(plan.shardCount, 2)

    const incompleteStatus = await buildTp12Train100PartitionCompletionStatus({ contractPath, cwd: tmp })
    assert.equal(incompleteStatus.status, "incomplete")

    await writeJson(path.join(tmp, "out/partition_report.json"), {
      kind: "tp12_train100_counterexample_partition_report_v1",
      status: "passed",
      searchComplete: true,
      acceptedCandidateCount: 0,
      remainingFrontierSize: 0,
      oosRead: false,
    })
    const completeStatus = await buildTp12Train100PartitionCompletionStatus({ contractPath, cwd: tmp })
    assert.equal(completeStatus.status, "complete")

    const survivor = await verifyTp12Train100SurvivorCatalog({ contractPath, cwd: tmp })
    assert.equal(survivor.status, "passed")
    assert.equal(survivor.verifiedSurvivorCount, 1)
    assert.equal(survivor.rejectedCandidateCount, 1)

    const certificate = await buildTp12Train100UnsatCompletionCertificate({ contractPath, cwd: tmp })
    assert.equal(certificate.conclusion.code, "survivor_found_in_completion_scope")
    assert.equal(certificate.conclusion.existenceResolved, true)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

const runBlockedSourceSmoke = async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-unsat-cert-blocked-"))
  try {
    await writeCommonSources(tmp, { checkpoint: false, candidates: false })
    const contractPath = path.join(tmp, "contract.json")
    const contract = baseContract(tmp, {
      searchScope: {
        resumeCheckpointPath: "missing_checkpoint.json",
        survivorCandidateCatalogPath: "missing_candidates.jsonl",
      },
    })
    await writeJson(contractPath, contract)
    const normalized = await normalizeTp12Train100Frontier({ contractPath, cwd: tmp })
    assert.equal(normalized.status, "blocked_missing_frontier_source")
    const dominance = await pruneTp12Train100FrontierDominance({ contractPath, cwd: tmp })
    assert.equal(dominance.status, "blocked_missing_frontier_source")
    const bounds = await applyTp12Train100UnsatBounds({ contractPath, cwd: tmp })
    assert.equal(bounds.status, "blocked_missing_frontier_source")
    const plan = await buildTp12Train100PartitionedCompletionPlan({ contractPath, cwd: tmp })
    assert.equal(plan.status, "blocked_missing_frontier_source")
    const status = await buildTp12Train100PartitionCompletionStatus({ contractPath, cwd: tmp })
    assert.equal(status.status, "blocked_missing_frontier_source")
    const survivor = await verifyTp12Train100SurvivorCatalog({ contractPath, cwd: tmp })
    assert.equal(survivor.status, "not_run_no_survivor_catalog")
    const certificate = await buildTp12Train100UnsatCompletionCertificate({ contractPath, cwd: tmp })
    assert.equal(certificate.conclusion.code, "completion_blocked_missing_frontier_source")
    assert.equal(certificate.conclusion.existenceResolved, false)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

await runAvailableSourceSmoke()
await runBlockedSourceSmoke()

console.log("ok smoke_tp12_train100_unsat_completion_certificate")

