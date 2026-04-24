#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12Train100ExistenceCertificate } from "../src/lib/tp12_train100_existence_certificate.mjs"

const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const baseContract = (tmp) => ({
  kind: "tp12_train100_year2hit_existence_cert_contract_v1",
  patchKey: "tp12_train100_year2hit_existence_cert_v1",
  trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
  forbiddenDateRange: { from: "2025-01-02", to: "2026-04-17" },
  target: {
    minHitDecisionDatesPerYear: 2,
    minHitSymbolDatesPerYear: 2,
    minPositiveSymbolDatesTotal: 18,
    requiredTrainPrecision: 1,
    maxFalsePositiveRows: 0,
  },
  globalRules: {
    oosReadAllowed: false,
    emitLockedSelector: false,
    oosReplayAllowed: false,
    fallbackAllowed: false,
    relaxYear2HitAllowed: false,
    relaxTrainPrecisionAllowed: false,
  },
  scopes: [
    {
      scopeId: "exact_zero",
      proofKind: "complete_exact_manifest",
      atomManifestPath: "atom.json",
      exactManifestPath: "exact.json",
      qualitySummaryPath: "quality.json",
    },
    {
      scopeId: "incomplete_zero",
      proofKind: "incomplete_counterexample_closeout",
      closeoutSummaryPath: "closeout.json",
    },
  ],
  outputPaths: {
    summary: path.join(tmp, "summary.json"),
    report: path.join(tmp, "report.md"),
  },
})

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-train100-existence-"))
try {
  await writeJson(path.join(tmp, "atom.json"), {
    kind: "tp12_train100_atom_manifest_v1",
    status: "passed",
    atomCount: 2,
  })
  await writeJson(path.join(tmp, "exact.json"), {
    kind: "tp12_train100_exact_mining_manifest_v1",
    status: "passed",
    searchComplete: true,
    atomCount: 2,
    seedAtomCount: 2,
    evaluatedCandidateCount: 3,
    acceptedCandidateCount: 0,
  })
  await writeJson(path.join(tmp, "quality.json"), {
    kind: "tp12_train100_quality_gate_summary_v1",
    status: "passed",
    acceptedCount: 0,
  })
  await writeJson(path.join(tmp, "closeout.json"), {
    kind: "tp12_train100_closeout_summary_v1",
    status: "passed",
    closeoutStatus: "closed_negative_incomplete",
    searchComplete: false,
    acceptedTrain100PatternCount: 0,
    globalVisitedStateCount: 10,
    remainingFrontierSize: 2,
    oosRead: false,
  })
  const contractPath = path.join(tmp, "contract.json")
  await writeJson(contractPath, baseContract(tmp))
  const summary = await buildTp12Train100ExistenceCertificate({ contractPath, cwd: tmp })
  assert.equal(summary.conclusion.code, "no_survivor_found_but_global_existence_unresolved")
  assert.equal(summary.conclusion.existenceResolved, false)
  assert.equal(summary.scopes[0].absenceStatus, "absence_proven_in_scope")
  assert.equal(summary.scopes[1].absenceStatus, "no_survivor_observed_incomplete")

  await writeJson(path.join(tmp, "exact.json"), {
    kind: "tp12_train100_exact_mining_manifest_v1",
    status: "passed",
    searchComplete: true,
    acceptedCandidateCount: 1,
  })
  await writeJson(path.join(tmp, "quality.json"), {
    kind: "tp12_train100_quality_gate_summary_v1",
    status: "passed",
    acceptedCount: 1,
  })
  const found = await buildTp12Train100ExistenceCertificate({
    contractPath,
    outSummaryPath: path.join(tmp, "found-summary.json"),
    cwd: tmp,
  })
  assert.equal(found.conclusion.code, "train100_survivor_found_in_declared_scope")
  assert.equal(found.conclusion.existenceResolved, true)

  const oosDir = path.join(tmp, "oos")
  await fs.mkdir(oosDir)
  await writeJson(path.join(oosDir, "exact.json"), { acceptedCandidateCount: 0, searchComplete: true })
  const badContract = baseContract(tmp)
  badContract.scopes[0].exactManifestPath = "oos/exact.json"
  await writeJson(contractPath, badContract)
  await assert.rejects(() => buildTp12Train100ExistenceCertificate({ contractPath, cwd: tmp }), /OOS data/)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_train100_existence_certificate")

