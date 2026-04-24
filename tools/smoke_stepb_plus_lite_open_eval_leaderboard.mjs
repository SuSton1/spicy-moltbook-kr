import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import { writeJson, writeJsonl, readJson } from "../src/lib/io.mjs"
import { applyPerfectPrototypeCatalogFreezeMetadata } from "../src/lib/perfect_prototype_catalog_freeze.mjs"

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

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plus-lite-open-eval-leaderboard-"))
  const trainPackDir = path.join(tempRoot, "train-pack")
  const oosPackDir = path.join(tempRoot, "oos-pack")
  const trainEvalDir = path.join(tempRoot, "train-eval")
  const oosEvalDir = path.join(tempRoot, "oos-eval")
  const trainApplyRawDir = path.join(tempRoot, "train-apply-raw")
  const trainApplyClose28Dir = path.join(tempRoot, "train-apply-close28")
  const oosApplyRawDir = path.join(tempRoot, "oos-apply-raw")
  const oosApplyClose28Dir = path.join(tempRoot, "oos-apply-close28")
  const supportCasesPath = path.join(tempRoot, "support_cases.json")
  const outDir = path.join(tempRoot, "out")
  for (const dir of [
    trainPackDir,
    oosPackDir,
    trainEvalDir,
    oosEvalDir,
    trainApplyRawDir,
    trainApplyClose28Dir,
    oosApplyRawDir,
    oosApplyClose28Dir,
  ]) {
    await fs.mkdir(dir, { recursive: true })
  }

  const catalogPath = path.join(tempRoot, "catalog.json")
  const catalog = applyPerfectPrototypeCatalogFreezeMetadata({
    catalog: {
      version: 1,
      tokenizerSpec: {
        surface: "v3_contextual_plus_lite",
        options: {},
      },
      metadata: {
        sourceRunId: "smoke_open_eval",
        datasetContract: {
          rowCount: 3,
          baselineLineIds: ["stepb_dplus1_plus_lite"],
          baselineLineId: "stepb_dplus1_plus_lite",
          discoveryUniverseIds: ["same_day_plus_recent_upto_2d"],
          discoveryUniverseId: "same_day_plus_recent_upto_2d",
          requestedLookbackTradingDaysValues: [2],
          requestedLookbackTradingDays: 2,
          enabledRecentImpulseLanes: ["recent_impulse_1d", "recent_impulse_2d"],
          allowedStepALanes: ["same_day_high8", "recent_impulse_1d", "recent_impulse_2d"],
          includeSameDayHigh8Values: [true],
          includeSameDayHigh8: true,
        },
      },
      rules: [
        {
          ruleId: "PP_ALPHA",
          tokens: ["feat.alpha"],
          trainMatchCount: 5,
          trainHitCount: 5,
          trainNegativeCount: 0,
          precision: 1,
          maxGapTradingDays: 0,
        },
        {
          ruleId: "PP_BETA",
          tokens: ["feat.beta"],
          trainMatchCount: 5,
          trainHitCount: 5,
          trainNegativeCount: 0,
          precision: 1,
          maxGapTradingDays: 0,
        },
      ],
    },
    sourceRunId: "smoke_open_eval",
  })
  await writeJson(catalogPath, catalog)
  await writeJson(supportCasesPath, {
    supportCases: [
      {
        caseId: "076610:2026-03-18",
        symbol: "076610",
        dateKey: "2026-03-18",
        familyIds: [],
        tokens: ["feat.alpha"],
        donorRuleIds: ["PP_ALPHA"],
        donorTokens: ["feat.alpha"],
      },
    ],
  })
  const catalogContentSha256 = String(catalog?.metadata?.catalogContentSha256 ?? "")
  const ruleIdsSha256 = String(catalog?.metadata?.ruleIdsSha256 ?? "")

  await writeJsonl(path.join(trainPackDir, "daily_pack.jsonl"), [
    { sourceType: "perfect_prototype_stepb_open_eval_pack", symbol: "000001", dateKey: "2024-01-02", decisionDateKey: "2024-01-02", eventOutcome: { hitTarget: true } },
  ])
  await writeJson(path.join(trainPackDir, "summary.json"), {
    period: { from: "2024-01-02", to: "2024-01-31" },
    requestedPeriod: { from: "2024-01-02", to: "2024-01-31" },
    outputCoverage: { from: "2024-01-02", to: "2024-01-31", count: 10 },
    coverageComplete: true,
    surface: "v3_contextual_plus_lite",
    sourceType: "perfect_prototype_stepb_open_eval_pack",
    baselineLineId: "stepb_dplus1_plus_lite",
  })
  await writeJson(path.join(trainPackDir, "manifest.json"), {
    summary: await readJson(path.join(trainPackDir, "summary.json"), null),
  })
  await writeJsonl(path.join(oosPackDir, "daily_pack.jsonl"), [
    { sourceType: "perfect_prototype_stepb_open_eval_pack", symbol: "000001", dateKey: "2025-01-02", decisionDateKey: "2025-01-02", eventOutcome: { hitTarget: true } },
  ])
  await writeJson(path.join(oosPackDir, "summary.json"), {
    period: { from: "2025-01-01", to: "2025-01-31" },
    requestedPeriod: { from: "2025-01-01", to: "2025-01-31" },
    outputCoverage: { from: "2025-01-01", to: "2025-01-31", count: 10 },
    coverageComplete: true,
    surface: "v3_contextual_plus_lite",
    sourceType: "perfect_prototype_stepb_open_eval_pack",
    baselineLineId: "stepb_dplus1_plus_lite",
  })
  await writeJson(path.join(oosPackDir, "manifest.json"), {
    summary: await readJson(path.join(oosPackDir, "summary.json"), null),
  })

  const writeEvalBundle = async (dir, ruleReport, matches, dedupedMatches) => {
    await writeJson(path.join(dir, "oos_summary.json"), {
      rawMatches: matches.length,
      dedupedMatches: dedupedMatches.length,
      selectionMode: "union_all",
      catalogContentSha256,
      ruleIdsSha256,
    })
    await writeJson(path.join(dir, "oos_rule_report.json"), ruleReport)
    await writeJsonl(path.join(dir, "oos_matches.jsonl"), matches)
    await writeJsonl(path.join(dir, "oos_deduped_symbols.jsonl"), dedupedMatches)
  }

  const writeApplyBundle = async (dir, matches, dedupedMatches) => {
    await writeJson(path.join(dir, "summary.json"), {
      rawMatches: matches.length,
      dedupedMatches: dedupedMatches.length,
      selectionMode: "union_all",
      catalogContentSha256,
      ruleIdsSha256,
    })
    await writeJsonl(path.join(dir, "matches.jsonl"), matches)
    await writeJsonl(path.join(dir, "deduped_symbols.jsonl"), dedupedMatches)
  }

  await writeEvalBundle(
    trainEvalDir,
    [
      { ruleId: "PP_ALPHA", oosMatchCount: 3, oosHitCount: 3, oosNegativeCount: 0, oosPrecision: 1, oosMaxGapTradingDays: 0, oosMatchedDateCount: 3 },
      { ruleId: "PP_BETA", oosMatchCount: 2, oosHitCount: 1, oosNegativeCount: 1, oosPrecision: 0.5, oosMaxGapTradingDays: 0, oosMatchedDateCount: 2 },
    ],
    [
      { dateKey: "2024-01-02", symbol: "000001", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA"], matchedRuleCount: 1, primaryRuleId: "PP_ALPHA" },
      { dateKey: "2024-01-03", symbol: "000002", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA", "PP_BETA"], matchedRuleCount: 2, primaryRuleId: "PP_ALPHA" },
      { dateKey: "2024-01-04", symbol: "000003", outcomeHitTarget: false, matchedRuleIds: ["PP_BETA"], matchedRuleCount: 1, primaryRuleId: "PP_BETA" },
    ],
    [
      { dateKey: "2024-01-02", symbol: "000001", outcomeHitTarget: true },
      { dateKey: "2024-01-03", symbol: "000002", outcomeHitTarget: true },
      { dateKey: "2024-01-04", symbol: "000003", outcomeHitTarget: false },
    ],
  )

  await writeEvalBundle(
    oosEvalDir,
    [
      { ruleId: "PP_ALPHA", oosMatchCount: 2, oosHitCount: 2, oosNegativeCount: 0, oosPrecision: 1, oosMaxGapTradingDays: 0, oosMatchedDateCount: 2 },
      { ruleId: "PP_BETA", oosMatchCount: 3, oosHitCount: 1, oosNegativeCount: 2, oosPrecision: 0.3333333333, oosMaxGapTradingDays: 0, oosMatchedDateCount: 1 },
    ],
    [
      { dateKey: "2025-01-02", symbol: "000001", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA"], matchedRuleCount: 1, primaryRuleId: "PP_ALPHA" },
      { dateKey: "2025-01-03", symbol: "000002", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA", "PP_BETA"], matchedRuleCount: 2, primaryRuleId: "PP_ALPHA" },
      { dateKey: "2025-01-04", symbol: "000002", outcomeHitTarget: false, matchedRuleIds: ["PP_BETA"], matchedRuleCount: 1, primaryRuleId: "PP_BETA" },
    ],
    [
      { dateKey: "2025-01-02", symbol: "000001", outcomeHitTarget: true },
      { dateKey: "2025-01-03", symbol: "000002", outcomeHitTarget: true },
      { dateKey: "2025-01-04", symbol: "000002", outcomeHitTarget: false },
    ],
  )

  await writeApplyBundle(
    trainApplyRawDir,
    [
      { dateKey: "2024-01-02", symbol: "000001", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA"], matchedRuleCount: 1, primaryRuleId: "PP_ALPHA" },
      { dateKey: "2024-01-03", symbol: "000002", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA", "PP_BETA"], matchedRuleCount: 2, primaryRuleId: "PP_ALPHA" },
    ],
    [
      { dateKey: "2024-01-02", symbol: "000001", outcomeHitTarget: true },
      { dateKey: "2024-01-03", symbol: "000002", outcomeHitTarget: true },
    ],
  )
  await writeApplyBundle(
    trainApplyClose28Dir,
    [
      { dateKey: "2024-01-03", symbol: "000002", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA"], matchedRuleCount: 1, primaryRuleId: "PP_ALPHA" },
    ],
    [
      { dateKey: "2024-01-03", symbol: "000002", outcomeHitTarget: true },
    ],
  )
  await writeApplyBundle(
    oosApplyRawDir,
    [
      { dateKey: "2025-01-02", symbol: "000001", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA"], matchedRuleCount: 1, primaryRuleId: "PP_ALPHA" },
      { dateKey: "2025-01-03", symbol: "000002", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA", "PP_BETA"], matchedRuleCount: 2, primaryRuleId: "PP_ALPHA" },
      { dateKey: "2025-01-04", symbol: "000002", outcomeHitTarget: false, matchedRuleIds: ["PP_BETA"], matchedRuleCount: 1, primaryRuleId: "PP_BETA" },
    ],
    [
      { dateKey: "2025-01-02", symbol: "000001", outcomeHitTarget: true },
      { dateKey: "2025-01-03", symbol: "000002", outcomeHitTarget: true },
      { dateKey: "2025-01-04", symbol: "000002", outcomeHitTarget: false },
    ],
  )
  await writeApplyBundle(
    oosApplyClose28Dir,
    [
      { dateKey: "2025-01-02", symbol: "000001", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA"], matchedRuleCount: 1, primaryRuleId: "PP_ALPHA" },
      { dateKey: "2025-01-04", symbol: "000002", outcomeHitTarget: false, matchedRuleIds: ["PP_BETA"], matchedRuleCount: 1, primaryRuleId: "PP_BETA" },
    ],
    [
      { dateKey: "2025-01-02", symbol: "000001", outcomeHitTarget: true },
      { dateKey: "2025-01-04", symbol: "000002", outcomeHitTarget: false },
    ],
  )

  await runNode(
    [
      "tools/report_stepb_plus_lite_open_eval_leaderboard.mjs",
      `--catalog=${catalogPath}`,
      `--train-input=${path.join(trainPackDir, "daily_pack.jsonl")}`,
      `--train-report-dir=${trainEvalDir}`,
      `--train-apply-raw-dir=${trainApplyRawDir}`,
      `--train-apply-close28-dir=${trainApplyClose28Dir}`,
      `--oos-input=${path.join(oosPackDir, "daily_pack.jsonl")}`,
      `--oos-report-dir=${oosEvalDir}`,
      `--oos-apply-raw-dir=${oosApplyRawDir}`,
      `--oos-apply-close28-dir=${oosApplyClose28Dir}`,
      `--out-dir=${outDir}`,
      "--run-id=smoke_open_eval",
      "--line-id=stepb_dplus1_plus_lite",
      "--split-policy=decision_date_only",
      "--train-start=2020-11-27",
      "--train-end=2024-12-31",
      "--oos-start=2025-01-01",
      "--oos-end=2026-01-31",
      `--support-cases-file=${supportCasesPath}`,
    ],
    process.cwd(),
  )

  const leaderboard = await readJson(path.join(outDir, "open_train_oos_leaderboard.json"), null)
  const guardrail = await readJson(path.join(outDir, "selection_guardrail_summary.json"), null)
  const manifest = await readJson(path.join(outDir, "open_eval_manifest.json"), null)
  if (!Array.isArray(leaderboard) || leaderboard.length !== 2) {
    throw new Error("expected two leaderboard rows")
  }
  if (String(leaderboard[0]?.ruleId ?? "") !== "PP_ALPHA") {
    throw new Error("expected PP_ALPHA to rank first by open-OOS precision")
  }
  if (leaderboard[0]?.haesungSupport !== true) {
    throw new Error("expected PP_ALPHA to expose haesungSupport=true")
  }
  if (JSON.stringify(leaderboard[0]?.supportCaseIds ?? []) !== JSON.stringify(["076610:2026-03-18"])) {
    throw new Error("expected PP_ALPHA supportCaseIds to include Haesung support case")
  }
  if (guardrail?.zeroNegativeRuleCount !== 1) {
    throw new Error(`expected one zero-negative rule, got ${guardrail?.zeroNegativeRuleCount}`)
  }
  if (guardrail?.supportCaseCount !== 1) {
    throw new Error(`expected supportCaseCount=1, got ${guardrail?.supportCaseCount}`)
  }
  if (guardrail?.discoveryUniverseId !== "same_day_plus_recent_upto_2d") {
    throw new Error(`expected widened discoveryUniverseId in selection guardrail, got ${guardrail?.discoveryUniverseId ?? "null"}`)
  }
  if (JSON.stringify(guardrail?.allowedStepALanes ?? []) !== JSON.stringify(["same_day_high8", "recent_impulse_1d", "recent_impulse_2d"])) {
    throw new Error("expected widened allowedStepALanes in selection guardrail")
  }
  if (guardrail?.includeSameDayHigh8 !== true) {
    throw new Error("expected includeSameDayHigh8=true in selection guardrail")
  }
  if (manifest?.selectionLeaderboardSha256 == null) {
    throw new Error("missing selectionLeaderboardSha256 in manifest")
  }
  if (manifest?.supportCaseCount !== 1) {
    throw new Error("expected open-eval manifest to persist supportCaseCount=1")
  }
  if (manifest?.discoveryUniverseId !== "same_day_plus_recent_upto_2d") {
    throw new Error("expected widened discoveryUniverseId in open-eval manifest")
  }
  if (JSON.stringify(manifest?.allowedStepALanes ?? []) !== JSON.stringify(["same_day_high8", "recent_impulse_1d", "recent_impulse_2d"])) {
    throw new Error("expected widened allowedStepALanes in open-eval manifest")
  }
  if (manifest?.includeSameDayHigh8 !== true) {
    throw new Error("expected includeSameDayHigh8=true in open-eval manifest")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
