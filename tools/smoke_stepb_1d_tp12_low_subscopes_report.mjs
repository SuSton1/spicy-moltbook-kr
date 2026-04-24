import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"

const runNode = (args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) return resolve()
      reject(new Error(`node ${args.join(" ")} exited with code ${code}`))
    })
  })

const writeVariantRun = async ({
  cwd,
  runId,
  lineId,
  close28SelectedRows,
  close28HitRows,
  lineLevelHitRate,
  zeroNegativeRuleCount,
  perfectDateFloor3,
  promotableBreadth,
  trainFilterRows,
  oosFilterRows,
}) => {
  const runDir = path.join(cwd, "artifacts", "runs", runId)
  const indexDir = path.join(runDir, "step-perfect-prototype-index-train")
  const trainDir = path.join(runDir, "step-perfect-prototype-train")
  const reportDir = path.join(runDir, "step-perfect-prototype-open-eval-report")
  const trainPackDir = path.join(runDir, "step-perfect-prototype-open-train-pack")
  const oosPackDir = path.join(runDir, "step-perfect-prototype-open-oos-pack")
  await Promise.all([
    ensureDir(indexDir),
    ensureDir(trainDir),
    ensureDir(reportDir),
    ensureDir(trainPackDir),
    ensureDir(oosPackDir),
  ])
  await writeJson(path.join(indexDir, "summary.json"), {
    elapsedSec: 2.5,
    maxRssKb: 700000,
    phaseTimings: {
      readJsonlSec: 0.7,
      buildIndexSec: 1.2,
    },
  })
  await writeJson(path.join(indexDir, "tokenizer_spec.json"), {
    surface: "v3_contextual_plus_lite",
    options: {
      enableIntervalAtoms: false,
      enableMacroAtoms: false,
      enableSupportAnchorAtoms: false,
      enableSupportManifoldSignature: false,
      enableSupportMetricFeatures: false,
      enableAdaptiveThresholdAtoms: false,
    },
  })
  await writeJson(path.join(trainDir, "summary.json"), {
    rules: 12,
    exploredStates: 200000,
    selectedSeedCount: 100,
    candidateDescriptorBuildMs: 150,
    childRowsetMaterializeMs: 200,
    rowsetIntersectionMs: 80,
    candidateDescriptorCount: 300,
    acceptedCandidateCount: 40,
    boundPruneCount: 50,
    stateDominancePruneCount: 25,
  })
  await writeJson(path.join(trainDir, "catalog.json"), {
    rules: Array.from({ length: 12 }, (_, index) => ({
      ruleId: `${runId}_R${index + 1}`,
      tokens: ["num:feature.test:B02"],
    })),
  })
  await writeJson(path.join(reportDir, "selection_guardrail_summary.json"), {
    familyCount: 2,
    openOosMatchedRules: zeroNegativeRuleCount,
    zeroNegativeRuleCount,
    hit3ZeroNegativeRuleCount: perfectDateFloor3,
    close28SelectedRows,
    close28HitRows,
    lineLevelHitRate,
    uniqueMatchedDates: oosFilterRows,
    top1DateShare: 0.2,
  })
  await writeJson(path.join(reportDir, "selection_leaderboard.json"), [
    {
      ruleId: `${runId}_A`,
      familyId: "low_gap_top_continuation",
      trainMatchedDateCount: promotableBreadth ? 10 : 4,
      trainMatchedMonthCount: promotableBreadth ? 6 : 4,
      trainMatchedFoldCount: promotableBreadth ? 4 : 3,
      openOosMatchCount: perfectDateFloor3 ? 3 : 2,
      openOosHitCount: perfectDateFloor3 ? 3 : 2,
      openOosNegativeCount: 0,
      openOosPrecision: 1,
      openOosUniqueMatchedDates: perfectDateFloor3 ? 3 : 2,
    },
  ])
  await writeJson(path.join(reportDir, "open_eval_manifest.json"), {
    runId,
    lineId,
  })
  await writeJson(path.join(trainPackDir, "filter_summary.json"), {
    matchedRows: trainFilterRows,
    matchedDateCount: trainFilterRows,
    matchedMonthCount: Math.min(trainFilterRows, 6),
  })
  await writeJson(path.join(oosPackDir, "filter_summary.json"), {
    matchedRows: oosFilterRows,
    matchedDateCount: oosFilterRows,
    matchedMonthCount: Math.min(oosFilterRows, 4),
  })
}

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-low-subscopes-"))
  await writeVariantRun({
    cwd: tempRoot,
    runId: "gap_run",
    lineId: "stepb_dplus1_plus_lite_target12_low_gap_top_probe",
    close28SelectedRows: 9,
    close28HitRows: 4,
    lineLevelHitRate: 4 / 9,
    zeroNegativeRuleCount: 2,
    perfectDateFloor3: 1,
    promotableBreadth: 1,
    trainFilterRows: 30,
    oosFilterRows: 9,
  })
  await writeVariantRun({
    cwd: tempRoot,
    runId: "close_run",
    lineId: "stepb_dplus1_plus_lite_target12_low_gap_high_probe",
    close28SelectedRows: 12,
    close28HitRows: 3,
    lineLevelHitRate: 3 / 12,
    zeroNegativeRuleCount: 1,
    perfectDateFloor3: 0,
    promotableBreadth: 0,
    trainFilterRows: 40,
    oosFilterRows: 12,
  })
  await writeVariantRun({
    cwd: tempRoot,
    runId: "jump_run",
    lineId: "stepb_dplus1_plus_lite_target12_low_jump_below_probe",
    close28SelectedRows: 6,
    close28HitRows: 1,
    lineLevelHitRate: 1 / 6,
    zeroNegativeRuleCount: 0,
    perfectDateFloor3: 0,
    promotableBreadth: 0,
    trainFilterRows: 20,
    oosFilterRows: 6,
  })
  const outDir = path.join(tempRoot, "artifacts", "runs", "parent", "step-perfect-prototype-1d-tp12-low-subscopes-report")
  await runNode(
    [
      path.join(process.cwd(), "tools", "build_stepb_1d_tp12_low_subscopes_report.mjs"),
      "--run-id=parent",
      "--source-run-id=broad_control",
      "--gap-top=gap_run:0:111",
      "--gap-high=close_run:0:112",
      "--jump-below=jump_run:0:113",
      `--out-dir=${outDir}`,
    ],
    tempRoot,
  )
  const verdict = await readJson(path.join(outDir, "low_subscopes_verdict.json"), null)
  if (verdict?.recommendedNextSubscopeId !== "LOW_GAP_TOP") {
    throw new Error("expected recommendedNextSubscopeId=LOW_GAP_TOP")
  }
  if (!Array.isArray(verdict?.scopesWithOosPerfectDateFloor3) || verdict.scopesWithOosPerfectDateFloor3[0] !== "LOW_GAP_TOP") {
    throw new Error("expected LOW_GAP_TOP to be the only perfect>=3 low scope")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
