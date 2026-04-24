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
  surfaceName,
  lineId,
  lineLevelHitRate,
  zeroNegativeRuleCount,
  oosPerfectDateFloor3RuleCount,
  close28SelectedRows,
  close28HitRows,
}) => {
  const runDir = path.join(cwd, "artifacts", "runs", runId)
  const indexDir = path.join(runDir, "step-perfect-prototype-index-train")
  const trainDir = path.join(runDir, "step-perfect-prototype-train")
  const reportDir = path.join(runDir, "step-perfect-prototype-open-eval-report")
  await Promise.all([ensureDir(indexDir), ensureDir(trainDir), ensureDir(reportDir)])
  await writeJson(path.join(indexDir, "summary.json"), {
    elapsedSec: surfaceName === "v7_contextual_plus_lite_tp12" ? 3.1 : 2.6,
    maxRssKb: surfaceName === "v7_contextual_plus_lite_tp12" ? 2050000 : 1800000,
    phaseTimings: {
      readJsonlSec: 1.1,
      buildIndexSec: surfaceName === "v7_contextual_plus_lite_tp12" ? 1.6 : 1.2,
    },
  })
  await writeJson(path.join(indexDir, "tokenizer_spec.json"), {
    surface: surfaceName,
    options: {
      surfaceName,
      enableIntervalAtoms: false,
      enableMacroAtoms: false,
      enableSupportAnchorAtoms: false,
      enableSupportManifoldSignature: false,
      enableSupportMetricFeatures: false,
      enableAdaptiveThresholdAtoms: false,
    },
  })
  await writeJson(path.join(trainDir, "summary.json"), {
    rules: surfaceName === "v7_contextual_plus_lite_tp12" ? 18 : 12,
    exploredStates: 200000,
    selectedSeedCount: 420,
    dictionaryLoadMs: 45,
    candidateDescriptorBuildMs: surfaceName === "v7_contextual_plus_lite_tp12" ? 240 : 220,
    childRowsetMaterializeMs: surfaceName === "v7_contextual_plus_lite_tp12" ? 280 : 260,
    rowsetIntersectionMs: surfaceName === "v7_contextual_plus_lite_tp12" ? 150 : 140,
    candidateDescriptorCount: surfaceName === "v7_contextual_plus_lite_tp12" ? 1320 : 1180,
    acceptedCandidateCount: surfaceName === "v7_contextual_plus_lite_tp12" ? 190 : 150,
    boundPruneCount: surfaceName === "v7_contextual_plus_lite_tp12" ? 260 : 210,
    stateDominancePruneCount: surfaceName === "v7_contextual_plus_lite_tp12" ? 120 : 95,
  })
  await writeJson(path.join(trainDir, "catalog.json"), {
    rules: Array.from({ length: surfaceName === "v7_contextual_plus_lite_tp12" ? 18 : 12 }, (_, index) => ({
      ruleId: `PP_${runId}_${index + 1}`,
      tokens: ["num:feature.test:B02"],
    })),
  })
  await writeJson(path.join(reportDir, "selection_guardrail_summary.json"), {
    familyCount: 3,
    openOosMatchedRules: surfaceName === "v7_contextual_plus_lite_tp12" ? 8 : 5,
    zeroNegativeRuleCount,
    hit3ZeroNegativeRuleCount: oosPerfectDateFloor3RuleCount,
    close28SelectedRows,
    close28HitRows,
    lineLevelHitRate,
    uniqueMatchedDates: surfaceName === "v7_contextual_plus_lite_tp12" ? 6 : 4,
    top1DateShare: surfaceName === "v7_contextual_plus_lite_tp12" ? 0.24 : 0.35,
    exactCompletionSolvedRuleCount: surfaceName === "v7_contextual_plus_lite_tp12" ? 5 : 2,
  })
  await writeJson(path.join(reportDir, "selection_leaderboard.json"), [
    {
      ruleId: `PP_${runId}_A`,
      familyId: "family_a",
      trainMatchedDateCount: surfaceName === "v7_contextual_plus_lite_tp12" ? 12 : 10,
      trainMatchedMonthCount: 6,
      trainMatchedFoldCount: 4,
      openOosMatchCount: surfaceName === "v7_contextual_plus_lite_tp12" ? 4 : 3,
      openOosHitCount: surfaceName === "v7_contextual_plus_lite_tp12" ? 4 : 3,
      openOosNegativeCount: 0,
      openOosPrecision: 1,
      openOosUniqueMatchedDates: surfaceName === "v7_contextual_plus_lite_tp12" ? 4 : 3,
    },
    {
      ruleId: `PP_${runId}_B`,
      familyId: "family_b",
      trainMatchedDateCount: 4,
      trainMatchedMonthCount: 4,
      trainMatchedFoldCount: 3,
      openOosMatchCount: surfaceName === "v7_contextual_plus_lite_tp12" ? 3 : 2,
      openOosHitCount: surfaceName === "v7_contextual_plus_lite_tp12" ? 3 : 1,
      openOosNegativeCount: surfaceName === "v7_contextual_plus_lite_tp12" ? 0 : 1,
      openOosPrecision: surfaceName === "v7_contextual_plus_lite_tp12" ? 1 : 0.5,
      openOosUniqueMatchedDates: surfaceName === "v7_contextual_plus_lite_tp12" ? 3 : 2,
    },
  ])
  await writeJson(path.join(reportDir, "open_eval_manifest.json"), {
    runId,
    lineId,
  })
}

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-surface-ab-"))
  await writeVariantRun({
    cwd: tempRoot,
    runId: "control_run",
    surfaceName: "v3_contextual_plus_lite",
    lineId: "stepb_dplus1_plus_lite_target12",
    lineLevelHitRate: 4 / 7,
    zeroNegativeRuleCount: 1,
    oosPerfectDateFloor3RuleCount: 1,
    close28SelectedRows: 7,
    close28HitRows: 4,
  })
  await writeVariantRun({
    cwd: tempRoot,
    runId: "variant_run",
    surfaceName: "v7_contextual_plus_lite_tp12",
    lineId: "stepb_dplus1_plus_lite_target12_surface_v1",
    lineLevelHitRate: 6 / 9,
    zeroNegativeRuleCount: 2,
    oosPerfectDateFloor3RuleCount: 2,
    close28SelectedRows: 9,
    close28HitRows: 6,
  })
  const outDir = path.join(tempRoot, "artifacts", "runs", "parent_run", "step-perfect-prototype-1d-tp12-surface-ab-report")
  await runNode(
    [
      path.join(process.cwd(), "tools", "build_stepb_1d_tp12_surface_ab_report.mjs"),
      "--run-id=parent_run",
      "--control-run-id=control_run",
      "--variant-run-id=variant_run",
      "--control-exit-code=0",
      "--variant-exit-code=0",
      `--out-dir=${outDir}`,
    ],
    tempRoot,
  )
  const summary = await readJson(path.join(outDir, "surface_ab_summary.json"), null)
  if (!summary?.verdict?.variantActivatedSurface) {
    throw new Error("expected variantActivatedSurface=true")
  }
  if (!summary?.verdict?.variantImprovedRuleExtraction) {
    throw new Error("expected variantImprovedRuleExtraction=true")
  }
  if (summary?.delta?.quality?.oosPerfectDateFloor3RuleCount !== 1) {
    throw new Error("expected oosPerfectDateFloor3RuleCount delta=1")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
