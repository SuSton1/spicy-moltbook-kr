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
  enableIntervalAtoms,
  enableMacroAtoms,
  lineLevelHitRate,
  zeroNegativeRuleCount,
  oosPerfectDateFloor3RuleCount,
  atomspaceRuleCount,
}) => {
  const runDir = path.join(cwd, "artifacts", "runs", runId)
  const indexDir = path.join(runDir, "step-perfect-prototype-index-train")
  const trainDir = path.join(runDir, "step-perfect-prototype-train")
  const reportDir = path.join(runDir, "step-perfect-prototype-open-eval-report")
  await Promise.all([ensureDir(indexDir), ensureDir(trainDir), ensureDir(reportDir)])
  await writeJson(path.join(indexDir, "summary.json"), {
    elapsedSec: enableIntervalAtoms ? 3.5 : 2.5,
    maxRssKb: enableIntervalAtoms ? 2200000 : 1800000,
    phaseTimings: {
      readJsonlSec: 1.25,
      buildIndexSec: enableIntervalAtoms ? 1.75 : 1.1,
    },
  })
  await writeJson(path.join(indexDir, "tokenizer_spec.json"), {
    surface: "v3_contextual_plus_lite",
    options: {
      enableIntervalAtoms,
      enableMacroAtoms,
      enableSupportAnchorAtoms: false,
      enableSupportManifoldSignature: false,
      enableSupportMetricFeatures: false,
      enableAdaptiveThresholdAtoms: false,
    },
  })
  await writeJson(path.join(trainDir, "summary.json"), {
    rules: enableIntervalAtoms ? 14 : 10,
    exploredStates: 200000,
    selectedSeedCount: 400,
    dictionaryLoadMs: 50,
    candidateDescriptorBuildMs: enableIntervalAtoms ? 280 : 210,
    childRowsetMaterializeMs: enableIntervalAtoms ? 320 : 260,
    rowsetIntersectionMs: enableIntervalAtoms ? 160 : 140,
    candidateDescriptorCount: enableIntervalAtoms ? 1200 : 1100,
    acceptedCandidateCount: enableIntervalAtoms ? 180 : 150,
  })
  await writeJson(path.join(trainDir, "catalog.json"), {
    rules: Array.from({ length: enableIntervalAtoms ? 14 : 10 }, (_, index) => ({
      ruleId: `PP_${runId}_${index + 1}`,
      tokens:
        enableIntervalAtoms && index < atomspaceRuleCount
          ? ["ival:feature.test:GE_B03", "macro:test:DRYUP_LIGHT", "num:feature.test:B02"]
          : ["num:feature.test:B02"],
    })),
  })
  await writeJson(path.join(reportDir, "selection_guardrail_summary.json"), {
    familyCount: 3,
    openOosMatchedRules: enableIntervalAtoms ? 7 : 5,
    zeroNegativeRuleCount,
    hit3ZeroNegativeRuleCount: oosPerfectDateFloor3RuleCount,
    close28SelectedRows: enableIntervalAtoms ? 8 : 6,
    close28HitRows: enableIntervalAtoms ? 6 : 4,
    lineLevelHitRate,
    uniqueMatchedDates: enableIntervalAtoms ? 5 : 4,
    top1DateShare: enableIntervalAtoms ? 0.25 : 0.33,
    exactCompletionSolvedRuleCount: enableIntervalAtoms ? 4 : 2,
  })
  const leaderboard = [
    {
      ruleId: `PP_${runId}_A`,
      familyId: "family_a",
      trainMatchedDateCount: enableIntervalAtoms ? 12 : 10,
      trainMatchedMonthCount: 6,
      trainMatchedFoldCount: 4,
      openOosMatchCount: 4,
      openOosHitCount: 4,
      openOosNegativeCount: 0,
      openOosPrecision: 1,
      openOosUniqueMatchedDates: 4,
      intervalAtomCount: atomspaceRuleCount > 0 ? 1 : 0,
      macroAtomCount: atomspaceRuleCount > 0 ? 1 : 0,
    },
    {
      ruleId: `PP_${runId}_B`,
      familyId: "family_b",
      trainMatchedDateCount: 4,
      trainMatchedMonthCount: 4,
      trainMatchedFoldCount: 3,
      openOosMatchCount: enableIntervalAtoms ? 3 : 2,
      openOosHitCount: enableIntervalAtoms ? 3 : 1,
      openOosNegativeCount: enableIntervalAtoms ? 0 : 1,
      openOosPrecision: enableIntervalAtoms ? 1 : 0.5,
      openOosUniqueMatchedDates: enableIntervalAtoms ? 3 : 2,
      intervalAtomCount: atomspaceRuleCount > 1 ? 1 : 0,
      macroAtomCount: atomspaceRuleCount > 1 ? 1 : 0,
    },
  ]
  await writeJson(path.join(reportDir, "selection_leaderboard.json"), leaderboard)
  await writeJson(path.join(reportDir, "open_eval_manifest.json"), {
    runId,
  })
}

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-condition-ab-"))
  await writeVariantRun({
    cwd: tempRoot,
    runId: "baseline_run",
    enableIntervalAtoms: false,
    enableMacroAtoms: false,
    lineLevelHitRate: 4 / 6,
    zeroNegativeRuleCount: 1,
    oosPerfectDateFloor3RuleCount: 1,
    atomspaceRuleCount: 0,
  })
  await writeVariantRun({
    cwd: tempRoot,
    runId: "enhanced_run",
    enableIntervalAtoms: true,
    enableMacroAtoms: true,
    lineLevelHitRate: 6 / 8,
    zeroNegativeRuleCount: 2,
    oosPerfectDateFloor3RuleCount: 2,
    atomspaceRuleCount: 2,
  })
  const outDir = path.join(tempRoot, "artifacts", "runs", "parent_run", "step-perfect-prototype-1d-tp12-condition-language-ab-report")
  await runNode(
    [
      path.join(process.cwd(), "tools", "build_stepb_1d_tp12_condition_language_ab_report.mjs"),
      "--run-id=parent_run",
      "--baseline-run-id=baseline_run",
      "--enhanced-run-id=enhanced_run",
      "--baseline-exit-code=0",
      "--enhanced-exit-code=0",
      `--out-dir=${outDir}`,
    ],
    tempRoot,
  )
  const summary = await readJson(path.join(outDir, "language_ab_summary.json"), null)
  if (!summary?.verdict?.enhancedActivatedConditionLanguage) {
    throw new Error("expected enhancedActivatedConditionLanguage=true")
  }
  if (!summary?.verdict?.enhancedImprovedRuleExtraction) {
    throw new Error("expected enhancedImprovedRuleExtraction=true")
  }
  if (summary?.delta?.quality?.oosPerfectDateFloor3RuleCount !== 1) {
    throw new Error("expected oosPerfectDateFloor3RuleCount delta=1")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
