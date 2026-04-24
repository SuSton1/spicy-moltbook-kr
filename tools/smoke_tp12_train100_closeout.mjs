#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildTp12Train100Closeout } from "../src/lib/tp12_train100_closeout.mjs"

const writeJson = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-train100-closeout-"))
try {
  const partitionPath = path.join(tmp, "partition_summary.json")
  const discoveryPath = path.join(tmp, "discovery_summary.json")
  const resumePath = path.join(tmp, "resume_manifest.json")
  await writeJson(partitionPath, {
    kind: "tp12_train100_counterexample_partition_report_v1",
    status: "incomplete",
    searchComplete: false,
    oosRead: false,
    acceptedCandidateCount: 0,
    globalVisitedStateCount: 16000000,
    remainingFrontierSize: 1166,
  })
  await writeJson(discoveryPath, {
    kind: "tp12_train100_discovery_report_v1",
    status: "passed",
    oosRead: false,
    acceptedTrain100PatternCount: 0,
  })
  await writeJson(resumePath, {
    kind: "tp12_train100_counterexample_exact_completion_manifest_v1",
    status: "incomplete",
    searchComplete: false,
    oosRead: false,
    acceptedCandidateCount: 0,
    visitedStateCount: 8000000,
    remainingFrontierSize: 317,
  })

  const closeout = await buildTp12Train100Closeout({
    partitionSummaryPath: partitionPath,
    discoverySummaryPath: discoveryPath,
    resumeManifestPath: resumePath,
    outPath: path.join(tmp, "closeout.json"),
  })
  assert.equal(closeout.status, "passed")
  assert.equal(closeout.closeoutStatus, "closed_negative_incomplete")
  assert.equal(closeout.acceptedTrain100PatternCount, 0)
  assert.equal(closeout.globalVisitedStateCount, 16000000)
  assert.equal(closeout.remainingFrontierSize, 1166)
  assert.deepEqual(closeout.forbiddenFutureUse, ["oos_apply", "selector_source", "hidden_fallback"])

  await writeJson(partitionPath, {
    kind: "bad",
    status: "passed",
    searchComplete: true,
    oosRead: true,
    acceptedCandidateCount: 0,
  })
  await assert.rejects(
    () =>
      buildTp12Train100Closeout({
        partitionSummaryPath: partitionPath,
        discoverySummaryPath: discoveryPath,
        outPath: path.join(tmp, "bad_closeout.json"),
      }),
    /source_oos_read_true/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_train100_closeout")
