#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import { assertTp12NoFutureTuningLeakage } from "./assert_tp12_no_future_tuning_leakage.mjs"
import { buildTp12InternalValidationGateSummary } from "./build_tp12_internal_validation_gate_summary.mjs"
import { buildTp12LockedFutureEvalSummary } from "./build_tp12_locked_future_eval_summary.mjs"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-locked-future-eval-"))
try {
  const contractPath = path.join(tmp, "contract.json")
  const goodArtifactPath = path.join(tmp, "good_artifact.json")
  const badArtifactPath = path.join(tmp, "bad_artifact.json")
  const leakageOutPath = path.join(tmp, "leakage_summary.json")
  const trainGateSummaryPath = path.join(tmp, "train_gate_summary.json")
  const internalSummaryPath = path.join(tmp, "internal_validation_summary.json")
  const manifestPath = path.join(tmp, "locked_manifest.json")
  const replaySummaryPath = path.join(tmp, "locked_replay_summary.json")
  const lockedEvalOutPath = path.join(tmp, "locked_eval_summary.json")

  await writeJson(contractPath, {
    kind: "tp12_locked_future_eval_protocol_contract_v1",
    lockedFutureDateRange: { from: "2025-01-02", to: null },
    protocol: {
      futureTuningForbiddenFrom: "2025-01-02",
      requireInternalValidationPassedBeforeLockedFutureEval: true,
    },
    forbiddenFutureUses: ["train", "tune", "select", "threshold_select", "ranker_fit", "pattern_mine", "catalog_sort"],
  })
  await writeJson(goodArtifactPath, {
    kind: "selector_manifest_v1",
    trainDateRange: { from: "2016-01-01", to: "2024-12-31" },
    lockedEvalDateRange: { from: "2025-01-02", to: "2025-12-31" },
    lockedEval: { purpose: "locked_eval", dateRange: { from: "2025-01-02", to: "2025-12-31" } },
  })
  await writeJson(badArtifactPath, {
    kind: "selector_manifest_v1",
    fitInputs: [
      {
        role: "train",
        usedForTuning: true,
        dateRange: { from: "2025-01-02", to: "2025-03-31" },
      },
    ],
  })
  const leakage = await assertTp12NoFutureTuningLeakage({
    contractPath,
    artifactPaths: [goodArtifactPath],
    outPath: leakageOutPath,
  })
  assert.equal(leakage.status, "passed")
  await assert.rejects(
    () =>
      assertTp12NoFutureTuningLeakage({
        contractPath,
        artifactPaths: [badArtifactPath],
      }),
    /future tuning leakage detected/,
  )

  await writeJson(trainGateSummaryPath, {
    kind: "tp12_year2hit_train_gate_summary_v2",
    status: "passed",
    survivorPatternIdsSha256: "abc123",
    selectorHash: "selector123",
    catalogHash: "catalog123",
  })
  const internal = await buildTp12InternalValidationGateSummary({
    contractPath,
    trainGateSummaryPath,
    outPath: internalSummaryPath,
  })
  assert.equal(internal.status, "passed")
  await writeJson(manifestPath, {
    selectorHash: internal.selectorHash,
    catalogHash: internal.catalogHash,
    trainGateHash: internal.trainGateHash,
    thresholdLocked: true,
  })
  await writeJson(replaySummaryPath, {
    kind: "tp12_locked_future_replay_summary_v1",
    status: "measured",
    dateRange: { from: "2025-01-02", to: "2025-12-31" },
  })
  const locked = await buildTp12LockedFutureEvalSummary({
    contractPath,
    lockedManifestPath: manifestPath,
    internalValidationSummaryPath: internalSummaryPath,
    replaySummaryPath,
    outPath: lockedEvalOutPath,
  })
  assert.equal(locked.status, "passed")

  await writeJson(manifestPath, {
    selectorHash: "different",
    catalogHash: internal.catalogHash,
    trainGateHash: internal.trainGateHash,
    thresholdLocked: true,
  })
  await assert.rejects(
    () =>
      buildTp12LockedFutureEvalSummary({
        contractPath,
        lockedManifestPath: manifestPath,
        internalValidationSummaryPath: internalSummaryPath,
        replaySummaryPath,
        outPath: lockedEvalOutPath,
      }),
    /selector_hash_mismatch/,
  )

  console.log("ok smoke_tp12_locked_future_eval_protocol")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
