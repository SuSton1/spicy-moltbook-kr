#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { readJson } from "../src/lib/io.mjs"
import { main as buildReportMain } from "./build_tp12_execution_learning_fixed_support_report.mjs"

const main = async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-fixed-support-report-"))
  const contractPath = path.join(tmpDir, "contract.json")
  const bundleSummaryPath = path.join(tmpDir, "bundle_summary.json")
  const labelPath = path.join(tmpDir, "labels.jsonl")
  const outPath = path.join(tmpDir, "report.json")

  await fs.writeFile(
    contractPath,
    JSON.stringify(
      {
        kind: "tp12_execution_learning_fixed_support_contract_v1",
        contractId: "smoke_fixed_support",
        baselineVariantId: "daily_only_no_stop",
        supportImmutable: true,
        defaultRecentReplayDecisionCount: 30,
        expectedPairSignatureSha256: "abc123",
      },
      null,
      2,
    ),
    "utf8",
  )
  await fs.writeFile(
    bundleSummaryPath,
    JSON.stringify(
      {
        baselineVariantId: "daily_only_no_stop",
        donorRows: {
          rowCount: 2,
          pairSignatureSha256: "abc123",
        },
        executionLabels: {
          rowCount: 2,
        },
        replaySplit: {
          validationDecisionDateCount: 1,
          recentReplayDecisionDateCount: 1,
        },
        provenance: {
          controlPackPath: "/tmp/control.jsonl",
        },
      },
      null,
      2,
    ),
    "utf8",
  )
  await fs.writeFile(
    labelPath,
    [
      JSON.stringify({
        learningSplitBucket: "validation",
        barrierOutcomeLabel: "tp12_first",
        labels: {
          bestPolicyChoice: "delay1_4d",
          bestExecutionPolicyId: "delay1_4d",
          stop_first_net_ret: 0.01,
          delay1_4d_net_ret: 0.03,
          bestPolicyNetRet: 0.03,
          bestExecutionPolicyNetRet: 0.03,
        },
      }),
      JSON.stringify({
        learningSplitBucket: "recent_replay",
        barrierOutcomeLabel: "sl4_first",
        labels: {
          bestPolicyChoice: "stop_first",
          bestExecutionPolicyId: "stop_first",
          stop_first_net_ret: -0.02,
          delay1_4d_net_ret: -0.01,
          bestPolicyNetRet: -0.01,
          bestExecutionPolicyNetRet: -0.01,
        },
      }),
      "",
    ].join("\n"),
    "utf8",
  )

  await buildReportMain(
    [
      `--contract-path=${contractPath}`,
      `--bundle-summary-path=${bundleSummaryPath}`,
      `--label-path=${labelPath}`,
      `--out=${outPath}`,
    ],
    { cwd: process.cwd() },
  )

  const report = await readJson(outPath, null)
  assert.equal(report.kind, "tp12_execution_learning_fixed_support_report_v1")
  assert.equal(report.donorPairSignatureSha256, "abc123")
  assert.equal(report.splitMetrics.validation.rowCount, 1)
  assert.equal(report.splitMetrics.recent_replay.rowCount, 1)

  console.log("ok smoke_tp12_execution_learning_fixed_support_report")
}

await main()
