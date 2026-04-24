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
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`node ${args.join(" ")} exited with code ${code}`))
    })
  })

const runNodeExpectFailure = (args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code !== 0) {
        resolve()
        return
      }
      reject(new Error(`node ${args.join(" ")} unexpectedly succeeded`))
    })
  })

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stepb-dplus1-leaderboard-"))
  const trainReportDir = path.join(tempRoot, "train-report")
  const oosReportDir = path.join(tempRoot, "oos-report")
  const oosApplyRawDir = path.join(tempRoot, "oos-apply-raw")
  const oosApplyClose28Dir = path.join(tempRoot, "oos-apply-close28")
  const trainStepBDir = path.join(tempRoot, "train-stepb")
  const oosStepBDir = path.join(tempRoot, "oos-stepb")
  const trainStepASummaryPath = path.join(tempRoot, "train-step-a-summary.json")
  const oosStepASummaryPath = path.join(tempRoot, "oos-step-a-summary.json")
  const outDir = path.join(tempRoot, "out")
  await fs.mkdir(trainReportDir, { recursive: true })
  await fs.mkdir(oosReportDir, { recursive: true })
  await fs.mkdir(oosApplyRawDir, { recursive: true })
  await fs.mkdir(oosApplyClose28Dir, { recursive: true })
  await fs.mkdir(trainStepBDir, { recursive: true })
  await fs.mkdir(oosStepBDir, { recursive: true })

  const catalogPath = path.join(tempRoot, "catalog.json")
  const trainInputPath = path.join(trainStepBDir, "templates_lite.jsonl")
  const oosInputPath = path.join(oosStepBDir, "templates_lite.jsonl")

  const frozenCatalog = applyPerfectPrototypeCatalogFreezeMetadata({
    catalog: {
    version: 1,
    metadata: {
      sourceRunId: "smoke_train",
    },
    rules: [
      {
        ruleId: "PP_ALPHA",
        tokens: ["feat.alpha"],
        trainMatchCount: 2,
        trainHitCount: 2,
        trainNegativeCount: 0,
        precision: 1,
        maxGapTradingDays: 0,
        firstHitDate: "2024-01-02",
        lastHitDate: "2024-01-03",
        matchedDateCount: 2,
      },
      {
        ruleId: "PP_BETA",
        tokens: ["feat.beta"],
        trainMatchCount: 2,
        trainHitCount: 2,
        trainNegativeCount: 0,
        precision: 1,
        maxGapTradingDays: 0,
        firstHitDate: "2024-01-03",
        lastHitDate: "2024-01-04",
        matchedDateCount: 2,
      },
      {
        ruleId: "PP_GAMMA",
        tokens: ["feat.gamma"],
        trainMatchCount: 1,
        trainHitCount: 1,
        trainNegativeCount: 0,
        precision: 1,
        maxGapTradingDays: 0,
        firstHitDate: "2024-01-04",
        lastHitDate: "2024-01-04",
        matchedDateCount: 1,
      },
    ],
    },
    sourceRunId: "smoke_train",
  })
  await writeJson(catalogPath, frozenCatalog)
  const catalogContentSha256 = String(frozenCatalog?.metadata?.catalogContentSha256 ?? "").trim()
  const ruleIdsSha256 = String(frozenCatalog?.metadata?.ruleIdsSha256 ?? "").trim()

  await writeJsonl(trainInputPath, [
    { sourceId: "t1", symbol: "000001", eventDate: "2024-01-02", eventOutcome: { hitTarget: true } },
    { sourceId: "t2", symbol: "000002", eventDate: "2024-01-03", eventOutcome: { hitTarget: true } },
    { sourceId: "t3", symbol: "000003", eventDate: "2024-01-04", eventOutcome: { hitTarget: true } },
    { sourceId: "t4", symbol: "000004", eventDate: "2024-01-05", eventOutcome: { hitTarget: false } },
  ])
  await writeJsonl(oosInputPath, [
    { sourceId: "o1", symbol: "000001", eventDate: "2025-01-02", eventOutcome: { hitTarget: true } },
    { sourceId: "o2", symbol: "000001", eventDate: "2025-01-03", eventOutcome: { hitTarget: false } },
    { sourceId: "o3", symbol: "000002", eventDate: "2025-01-04", eventOutcome: { hitTarget: true } },
  ])
  await writeJson(path.join(trainStepBDir, "step_b_summary.json"), {
    baselineBoundaryFilter: {
      mode: "decision_date_only",
      discoveryFrom: "2024-01-02",
      discoveryTo: "2024-01-31",
      templatesBefore: 4,
      templatesAfter: 4,
      droppedForBoundaryCount: 0,
    },
  })
  await writeJson(path.join(oosStepBDir, "step_b_summary.json"), {
    baselineBoundaryFilter: {
      mode: "strict_label_boundary",
      discoveryFrom: "2025-01-01",
      discoveryTo: "2025-01-31",
      templatesBefore: 3,
      templatesAfter: 2,
      droppedForBoundaryCount: 1,
      missingOutcomeKeysCount: 0,
      droppedEntryBeforeBoundaryCount: 0,
      droppedExitAfterBoundaryCount: 1,
    },
  })
  await writeJson(trainStepASummaryPath, {
    recentImpulseDiscovery: {
      enabled: true,
      lookbackTradingDays: 8,
    },
    candidateSameDayHigh8Count: 89_768,
    passedSameDayHigh8Count: 48_873,
    candidateRecentImpulseDedupedCount: 171_756,
    passedRecentImpulseDedupedCount: 50_329,
    candidateRecentImpulse1dCount: 80_313,
    candidateRecentImpulse2dCount: 61_443,
    candidateRecentImpulse3dCount: 72_055,
    candidateRecentImpulse4dCount: 73_010,
    candidateRecentImpulse5dCount: 74_011,
    candidateRecentImpulse6dCount: 75_012,
    candidateRecentImpulse7dCount: 76_013,
    candidateRecentImpulse8dCount: 77_014,
    passedRecentImpulse1dCount: 11_111,
    passedRecentImpulse2dCount: 12_222,
    passedRecentImpulse3dCount: 13_333,
    passedRecentImpulse4dCount: 14_444,
    passedRecentImpulse5dCount: 15_555,
    passedRecentImpulse6dCount: 16_666,
    passedRecentImpulse7dCount: 17_777,
    passedRecentImpulse8dCount: 18_888,
  })
  await writeJson(oosStepASummaryPath, {
    recentImpulseDiscovery: {
      enabled: true,
      lookbackTradingDays: 8,
    },
    candidateSameDayHigh8Count: 9_001,
    passedSameDayHigh8Count: 4_001,
    candidateRecentImpulseDedupedCount: 19_876,
    passedRecentImpulseDedupedCount: 6_789,
    candidateRecentImpulse1dCount: 1_001,
    candidateRecentImpulse2dCount: 1_002,
    candidateRecentImpulse3dCount: 1_003,
    candidateRecentImpulse4dCount: 1_004,
    candidateRecentImpulse5dCount: 1_005,
    candidateRecentImpulse6dCount: 1_006,
    candidateRecentImpulse7dCount: 1_007,
    candidateRecentImpulse8dCount: 1_008,
    passedRecentImpulse1dCount: 201,
    passedRecentImpulse2dCount: 202,
    passedRecentImpulse3dCount: 203,
    passedRecentImpulse4dCount: 204,
    passedRecentImpulse5dCount: 205,
    passedRecentImpulse6dCount: 206,
    passedRecentImpulse7dCount: 207,
    passedRecentImpulse8dCount: 208,
  })

  await writeJson(path.join(trainReportDir, "oos_summary.json"), {
    rawMatches: 3,
    dedupedMatches: 3,
    sourceRows: 4,
    selectionMode: "champion_only",
    catalogContentSha256,
    ruleIdsSha256,
  })
  await writeJson(path.join(trainReportDir, "oos_rule_report.json"), [
    { ruleId: "PP_ALPHA", oosMatchCount: 2, oosHitCount: 2, oosNegativeCount: 0, oosPrecision: 1, oosMaxGapTradingDays: 0, oosFirstHitDate: "2024-01-02", oosLastHitDate: "2024-01-03", oosMatchedDateCount: 2 },
    { ruleId: "PP_BETA", oosMatchCount: 2, oosHitCount: 2, oosNegativeCount: 0, oosPrecision: 1, oosMaxGapTradingDays: 0, oosFirstHitDate: "2024-01-03", oosLastHitDate: "2024-01-04", oosMatchedDateCount: 2 },
    { ruleId: "PP_GAMMA", oosMatchCount: 1, oosHitCount: 1, oosNegativeCount: 0, oosPrecision: 1, oosMaxGapTradingDays: 0, oosFirstHitDate: "2024-01-04", oosLastHitDate: "2024-01-04", oosMatchedDateCount: 1 },
  ])
  await writeJsonl(path.join(trainReportDir, "oos_matches.jsonl"), [
    { dateKey: "2024-01-02", symbol: "000001", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA"], matchedRuleCount: 1 },
    { dateKey: "2024-01-03", symbol: "000002", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA", "PP_BETA"], matchedRuleCount: 2 },
    { dateKey: "2024-01-04", symbol: "000003", outcomeHitTarget: true, matchedRuleIds: ["PP_BETA", "PP_GAMMA"], matchedRuleCount: 2 },
  ])
  await writeJsonl(path.join(trainReportDir, "oos_deduped_symbols.jsonl"), [
    { dateKey: "2024-01-02", symbol: "000001", outcomeHitTarget: true },
    { dateKey: "2024-01-03", symbol: "000002", outcomeHitTarget: true },
    { dateKey: "2024-01-04", symbol: "000003", outcomeHitTarget: true },
  ])

  await writeJson(path.join(oosReportDir, "oos_summary.json"), {
    rawMatches: 2,
    dedupedMatches: 2,
    sourceRows: 3,
    selectionMode: "champion_only",
    catalogContentSha256,
    ruleIdsSha256,
  })
  await writeJson(path.join(oosReportDir, "oos_rule_report.json"), [
    { ruleId: "PP_ALPHA", oosMatchCount: 1, oosHitCount: 1, oosNegativeCount: 0, oosPrecision: 1, oosMaxGapTradingDays: 0, oosFirstHitDate: "2025-01-02", oosLastHitDate: "2025-01-02", oosMatchedDateCount: 1 },
    { ruleId: "PP_BETA", oosMatchCount: 1, oosHitCount: 0, oosNegativeCount: 1, oosPrecision: 0, oosMaxGapTradingDays: 0, oosFirstHitDate: null, oosLastHitDate: null, oosMatchedDateCount: 0 },
    { ruleId: "PP_GAMMA", oosMatchCount: 0, oosHitCount: 0, oosNegativeCount: 0, oosPrecision: 0, oosMaxGapTradingDays: 0, oosFirstHitDate: null, oosLastHitDate: null, oosMatchedDateCount: 0 },
  ])
  await writeJsonl(path.join(oosReportDir, "oos_matches.jsonl"), [
    { dateKey: "2025-01-02", symbol: "000001", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA", "PP_BETA"], matchedRuleCount: 2 },
    { dateKey: "2025-01-03", symbol: "000001", outcomeHitTarget: false, matchedRuleIds: ["PP_BETA"], matchedRuleCount: 1 },
  ])
  await writeJsonl(path.join(oosReportDir, "oos_deduped_symbols.jsonl"), [
    { dateKey: "2025-01-02", symbol: "000001", outcomeHitTarget: true },
    { dateKey: "2025-01-03", symbol: "000001", outcomeHitTarget: false },
  ])

  await writeJson(path.join(oosApplyRawDir, "summary.json"), {
    rawMatches: 2,
    dedupedMatches: 2,
    overlapCount: 0,
    selectionMode: "champion_only",
    catalogContentSha256,
    ruleIdsSha256,
  })
  await writeJsonl(path.join(oosApplyRawDir, "matches.jsonl"), [
    { dateKey: "2025-01-02", symbol: "000001", outcomeHitTarget: true, matchedRuleIds: ["PP_ALPHA", "PP_BETA"], matchedRuleCount: 2 },
    { dateKey: "2025-01-03", symbol: "000001", outcomeHitTarget: false, matchedRuleIds: ["PP_BETA"], matchedRuleCount: 1 },
  ])
  await writeJsonl(path.join(oosApplyRawDir, "deduped_symbols.jsonl"), [
    { dateKey: "2025-01-02", symbol: "000001", outcomeHitTarget: true },
    { dateKey: "2025-01-03", symbol: "000001", outcomeHitTarget: false },
  ])
  await writeJson(path.join(oosApplyClose28Dir, "summary.json"), {
    rawMatches: 1,
    dedupedMatches: 1,
    overlapCount: 0,
    selectionMode: "champion_only",
    catalogContentSha256,
    ruleIdsSha256,
    recommendationDateCloseRetFilter: {
      removedRawMatches: 1,
      removedHitMatches: 1,
      removedNegativeMatches: 0,
    },
  })
  await writeJsonl(path.join(oosApplyClose28Dir, "matches.jsonl"), [
    { dateKey: "2025-01-03", symbol: "000001", outcomeHitTarget: false, matchedRuleIds: ["PP_BETA"], matchedRuleCount: 1 },
  ])
  await writeJsonl(path.join(oosApplyClose28Dir, "deduped_symbols.jsonl"), [
    { dateKey: "2025-01-03", symbol: "000001", outcomeHitTarget: false },
  ])

  await runNode(
    [
      "tools/report_stepb_dplus1_train_oos_leaderboard.mjs",
      `--catalog=${catalogPath}`,
      `--train-input=${trainInputPath}`,
      `--train-report-dir=${trainReportDir}`,
      `--oos-input=${oosInputPath}`,
      `--oos-report-dir=${oosReportDir}`,
      `--oos-apply-raw-dir=${oosApplyRawDir}`,
      `--oos-apply-close28-dir=${oosApplyClose28Dir}`,
      `--out-dir=${outDir}`,
      "--run-id=smoke",
      "--split-policy=decision_date_only",
      "--selection-mode=champion_only",
      "--max-gap=100000",
      "--config-path=/tmp/base_config.json",
      `--config-sha256=${"c".repeat(64)}`,
      "--train-config-path=/tmp/train_config.json",
      `--train-config-sha256=${"d".repeat(64)}`,
      "--oos-config-path=/tmp/oos_config.json",
      `--oos-config-sha256=${"e".repeat(64)}`,
      `--train-step-a-summary=${trainStepASummaryPath}`,
      `--oos-step-a-summary=${oosStepASummaryPath}`,
    ],
    process.cwd(),
  )

  const guardrail = await readJson(path.join(outDir, "oos_guardrail_summary.json"), null)
  const manifest = await readJson(path.join(outDir, "baseline_manifest.json"), null)
  const leaderboard = await readJson(path.join(outDir, "leaderboard.json"), null)
  const recentImpulseGuardrail = await readJson(path.join(outDir, "recent_impulse_guardrail_summary.json"), null)
  const rawVsClose28 = await readJson(path.join(outDir, "raw_vs_close28_delta.json"), null)
  const trainReapplySummary = await readJson(path.join(outDir, "train_reapply_summary.json"), null)
  if (guardrail?.oosZeroNegativeRules !== 1) {
    throw new Error(`expected one OOS zero-negative rule, got ${guardrail?.oosZeroNegativeRules}`)
  }
  if (guardrail?.top1DateShare <= 0) {
    throw new Error("expected top1DateShare to be populated")
  }
  if (manifest?.splitPolicy !== "decision_date_only") {
    throw new Error(`baseline manifest splitPolicy mismatch: ${manifest?.splitPolicy ?? "null"}`)
  }
  if (manifest?.selectionMode !== "champion_only") {
    throw new Error(`baseline manifest selectionMode mismatch: ${manifest?.selectionMode ?? "null"}`)
  }
  if (manifest?.selectionModeIntegrityOk !== true) {
    throw new Error("expected manifest selectionModeIntegrityOk=true")
  }
  if (manifest?.baselineArtifactIntegrityClaimable !== true) {
    throw new Error("expected manifest baselineArtifactIntegrityClaimable=true")
  }
  if (manifest?.maxGapTradingDays !== 100000) {
    throw new Error(`baseline manifest maxGapTradingDays mismatch: ${manifest?.maxGapTradingDays ?? "null"}`)
  }
  if (manifest?.trainBoundaryFilterSummary?.mode !== "decision_date_only") {
    throw new Error("expected train boundary summary in manifest")
  }
  if (manifest?.oosBoundaryFilterSummary?.mode !== "strict_label_boundary") {
    throw new Error("expected oos boundary summary in manifest")
  }
  if (manifest?.recentImpulseGuardrailSummary?.recentImpulseCandidateCounts?.["8d"] !== 77014) {
    throw new Error("expected manifest recentImpulseGuardrailSummary to preserve 8d candidate count")
  }
  if (!Array.isArray(leaderboard) || leaderboard.length !== 3) {
    throw new Error(`expected 3 leaderboard rows, got ${leaderboard?.length ?? "null"}`)
  }
  if (trainReapplySummary?.trainExactnessDriftRuleCount !== 0) {
    throw new Error(
      `expected zero train exactness drift rules, got ${trainReapplySummary?.trainExactnessDriftRuleCount ?? "null"}`,
    )
  }
  if (guardrail?.positiveCoverageRateKind !== "deduped_positive_rows_over_total_positive_rows") {
    throw new Error(`unexpected positiveCoverageRateKind: ${guardrail?.positiveCoverageRateKind ?? "null"}`)
  }
  if (guardrail?.dedupedPositiveCoverageRate !== guardrail?.positiveCoverageRate) {
    throw new Error("expected guardrail dedupedPositiveCoverageRate alias to match positiveCoverageRate")
  }
  if (leaderboard.some((row) => row?.trainExactnessDrift !== false)) {
    throw new Error("expected smoke leaderboard to mark all rules as having no train exactness drift")
  }
  const gamma = leaderboard.find((row) => row?.ruleId === "PP_GAMMA")
  if (!gamma) {
    throw new Error("expected PP_GAMMA leaderboard row")
  }
  if (gamma.oosUniqueMatchedDates !== 0 || gamma.oosUniqueMatchedSymbols !== 0 || gamma.rawMatchedRows !== 0) {
    throw new Error("expected zero OOS support fields for PP_GAMMA without train fallback")
  }
  if (Object.prototype.hasOwnProperty.call(gamma, "uniqueMatchedDates")) {
    throw new Error("expected ambiguous uniqueMatchedDates alias to be absent from leaderboard rows")
  }
  if (Object.prototype.hasOwnProperty.call(gamma, "uniqueMatchedSymbols")) {
    throw new Error("expected ambiguous uniqueMatchedSymbols alias to be absent from leaderboard rows")
  }
  if (rawVsClose28?.delta?.rawMatchDelta !== 1) {
    throw new Error(`expected raw-vs-close28 delta 1, got ${rawVsClose28?.delta?.rawMatchDelta ?? "null"}`)
  }
  if (rawVsClose28?.delta?.matchedRuleDelta !== 1) {
    throw new Error(`expected matchedRuleDelta 1, got ${rawVsClose28?.delta?.matchedRuleDelta ?? "null"}`)
  }
  if (rawVsClose28?.delta?.zeroNegativeRuleDelta !== 1) {
    throw new Error(`expected zeroNegativeRuleDelta 1, got ${rawVsClose28?.delta?.zeroNegativeRuleDelta ?? "null"}`)
  }
  if (rawVsClose28?.delta?.dedupedPositiveCoverageRateDelta !== 0.5) {
    throw new Error(
      `expected dedupedPositiveCoverageRateDelta 0.5, got ${rawVsClose28?.delta?.dedupedPositiveCoverageRateDelta ?? "null"}`,
    )
  }
  if (recentImpulseGuardrail?.sameDayHigh8CandidateCount !== 89768) {
    throw new Error(`expected sameDayHigh8CandidateCount=89768, got ${recentImpulseGuardrail?.sameDayHigh8CandidateCount ?? "null"}`)
  }
  if (recentImpulseGuardrail?.recentImpulseCandidateCounts?.["4d"] !== 73010) {
    throw new Error("expected 4d recent impulse candidate count in guardrail summary")
  }
  if (recentImpulseGuardrail?.recentImpulsePassedEventCounts?.["8d"] !== 18888) {
    throw new Error("expected 8d recent impulse passed-event count in guardrail summary")
  }
  if (recentImpulseGuardrail?.oosRecentImpulseCandidateCounts?.["6d"] !== 1006) {
    throw new Error("expected oos 6d recent impulse candidate count in guardrail summary")
  }
  if (recentImpulseGuardrail?.oosRecentImpulsePassedEventCounts?.["8d"] !== 208) {
    throw new Error("expected oos 8d recent impulse passed-event count in guardrail summary")
  }
  if (recentImpulseGuardrail?.recentImpulse8dCount !== 77014) {
    throw new Error("expected flat recentImpulse8dCount alias in guardrail summary")
  }
  if (recentImpulseGuardrail?.oosRecentImpulsePassedEvent8dCount !== 208) {
    throw new Error("expected flat oosRecentImpulsePassedEvent8dCount alias in guardrail summary")
  }

  await writeJson(path.join(oosApplyClose28Dir, "summary.json"), {
    rawMatches: 1,
    dedupedMatches: 1,
    overlapCount: 0,
    selectionMode: "union_all",
    recommendationDateCloseRetFilter: {
      removedRawMatches: 1,
      removedHitMatches: 1,
      removedNegativeMatches: 0,
    },
  })

  await runNodeExpectFailure(
    [
      "tools/report_stepb_dplus1_train_oos_leaderboard.mjs",
      `--catalog=${catalogPath}`,
      `--train-input=${trainInputPath}`,
      `--train-report-dir=${trainReportDir}`,
      `--oos-input=${oosInputPath}`,
      `--oos-report-dir=${oosReportDir}`,
      `--oos-apply-raw-dir=${oosApplyRawDir}`,
      `--oos-apply-close28-dir=${oosApplyClose28Dir}`,
      `--out-dir=${path.join(tempRoot, "out-selectionmode-mismatch")}`,
      "--run-id=smoke-selectionmode-mismatch",
      "--split-policy=decision_date_only",
      "--max-gap=100000",
    ],
    process.cwd(),
  )

  await writeJson(path.join(oosApplyClose28Dir, "summary.json"), {
    rawMatches: 1,
    dedupedMatches: 1,
    overlapCount: 0,
    catalogContentSha256,
    ruleIdsSha256,
    recommendationDateCloseRetFilter: {
      removedRawMatches: 1,
      removedHitMatches: 1,
      removedNegativeMatches: 0,
    },
  })

  await runNodeExpectFailure(
    [
      "tools/report_stepb_dplus1_train_oos_leaderboard.mjs",
      `--catalog=${catalogPath}`,
      `--train-input=${trainInputPath}`,
      `--train-report-dir=${trainReportDir}`,
      `--oos-input=${oosInputPath}`,
      `--oos-report-dir=${oosReportDir}`,
      `--oos-apply-raw-dir=${oosApplyRawDir}`,
      `--oos-apply-close28-dir=${oosApplyClose28Dir}`,
      `--out-dir=${path.join(tempRoot, "out-selectionmode-missing")}`,
      "--run-id=smoke-selectionmode-missing",
      "--split-policy=decision_date_only",
      "--selection-mode=champion_only",
      "--max-gap=100000",
    ],
    process.cwd(),
  )

  const recentCatalogPath = path.join(tempRoot, "recent_only_catalog.json")
  const recentCatalog = applyPerfectPrototypeCatalogFreezeMetadata({
    catalog: {
      version: 1,
      tokenizerSpec: {
        surface: "v6_contextual_plus_lite_recent_only_lane_local_pool8",
        options: {},
      },
      metadata: {
        sourceRunId: "smoke_recent_only_train",
        datasetContract: {
          rowCount: 2,
          baselineLineIds: ["stepb_dplus1_plus_lite_recent_mid_low"],
          baselineLineId: "stepb_dplus1_plus_lite_recent_mid_low",
          discoveryUniverseIds: ["recent_impulse_upto_1d"],
          discoveryUniverseId: "recent_impulse_upto_1d",
          requestedLookbackTradingDaysValues: [1],
          requestedLookbackTradingDays: 1,
          enabledRecentImpulseLanes: ["recent_impulse_1d"],
          allowedStepALanes: ["recent_impulse_1d"],
          includeSameDayHigh8Values: [false],
          includeSameDayHigh8: false,
        },
        selectionIntent: "open_oos_selection",
        selectionProfileId: "recent_mid_shadow",
        selectionProfileVersion: "v1",
        selectionLineId: "stepb_dplus1_plus_lite_recent_mid_low",
        selectionSurface: "v6_contextual_plus_lite_recent_only_lane_local_pool8",
        selectionContractId: "recent_only_mid_low_shadow_v1",
        selectionDiscoveryUniverseId: "recent_impulse_upto_1d",
        selectionAllowedFamilyIds: ["mid_close_continuation"],
        selectionManifestPath: "/tmp/recent_only_open_eval_manifest.json",
        selectionManifestSha256: "f".repeat(64),
      },
      rules: [
        {
          ruleId: "PP_RECENT_MID",
          familyId: "mid_close_continuation",
          tokens: ["feat.recent.mid"],
          trainMatchCount: 2,
          trainHitCount: 2,
          trainNegativeCount: 0,
          precision: 1,
          maxGapTradingDays: 0,
          firstHitDate: "2024-01-02",
          lastHitDate: "2024-01-03",
          matchedDateCount: 2,
        },
      ],
    },
    sourceRunId: "smoke_recent_only_train",
  })
  await writeJson(recentCatalogPath, recentCatalog)
  const recentCatalogContentSha256 = String(recentCatalog?.metadata?.catalogContentSha256 ?? "").trim()
  const recentRuleIdsSha256 = String(recentCatalog?.metadata?.ruleIdsSha256 ?? "").trim()

  await writeJson(path.join(trainReportDir, "oos_summary.json"), {
    rawMatches: 3,
    dedupedMatches: 3,
    sourceRows: 4,
    selectionMode: "champion_only",
    catalogContentSha256: recentCatalogContentSha256,
    ruleIdsSha256: recentRuleIdsSha256,
  })
  await writeJson(path.join(oosReportDir, "oos_summary.json"), {
    rawMatches: 2,
    dedupedMatches: 2,
    sourceRows: 3,
    selectionMode: "champion_only",
    catalogContentSha256: recentCatalogContentSha256,
    ruleIdsSha256: recentRuleIdsSha256,
  })
  await writeJson(path.join(oosApplyRawDir, "summary.json"), {
    rawMatches: 2,
    dedupedMatches: 2,
    overlapCount: 0,
    selectionMode: "champion_only",
    catalogContentSha256: recentCatalogContentSha256,
    ruleIdsSha256: recentRuleIdsSha256,
  })
  await writeJson(path.join(oosApplyClose28Dir, "summary.json"), {
    rawMatches: 1,
    dedupedMatches: 1,
    overlapCount: 0,
    selectionMode: "champion_only",
    catalogContentSha256: recentCatalogContentSha256,
    ruleIdsSha256: recentRuleIdsSha256,
    recommendationDateCloseRetFilter: {
      removedRawMatches: 1,
      removedHitMatches: 1,
      removedNegativeMatches: 0,
    },
  })

  await runNode(
    [
      "tools/report_stepb_dplus1_train_oos_leaderboard.mjs",
      `--catalog=${recentCatalogPath}`,
      `--train-input=${trainInputPath}`,
      `--train-report-dir=${trainReportDir}`,
      `--oos-input=${oosInputPath}`,
      `--oos-report-dir=${oosReportDir}`,
      `--oos-apply-raw-dir=${oosApplyRawDir}`,
      `--oos-apply-close28-dir=${oosApplyClose28Dir}`,
      `--out-dir=${path.join(tempRoot, "out-recent-only-valid")}`,
      "--run-id=smoke-recent-only-valid",
      "--split-policy=decision_date_only",
      "--selection-mode=champion_only",
      "--line-id=stepb_dplus1_plus_lite_recent_mid_low",
      "--max-gap=100000",
      "--config-path=/tmp/base_config.json",
      `--config-sha256=${"c".repeat(64)}`,
      "--train-config-path=/tmp/train_config.json",
      `--train-config-sha256=${"d".repeat(64)}`,
      "--oos-config-path=/tmp/oos_config.json",
      `--oos-config-sha256=${"e".repeat(64)}`,
      `--train-step-a-summary=${trainStepASummaryPath}`,
      `--oos-step-a-summary=${oosStepASummaryPath}`,
    ],
    process.cwd(),
  )
  const recentLowBundleCandidate = await readJson(
    path.join(tempRoot, "out-recent-only-valid", "recent_low_bundle_candidate.json"),
    "__missing__",
  )
  if (recentLowBundleCandidate === "__missing__") {
    throw new Error("expected recent_low_bundle_candidate.json for recent-only report output")
  }
  if (recentLowBundleCandidate !== null) {
    throw new Error("expected recent-only mid-only smoke to emit null recent_low_bundle_candidate")
  }

  const brokenRecentCatalogPath = path.join(tempRoot, "recent_only_catalog_missing_contract.json")
  const brokenRecentCatalogRaw = structuredClone(recentCatalog)
  delete brokenRecentCatalogRaw?.metadata?.selectionContractId
  const brokenRecentCatalog = applyPerfectPrototypeCatalogFreezeMetadata({
    catalog: brokenRecentCatalogRaw,
    sourceRunId: "smoke_recent_only_train",
  })
  await writeJson(brokenRecentCatalogPath, brokenRecentCatalog)

  await runNodeExpectFailure(
    [
      "tools/report_stepb_dplus1_train_oos_leaderboard.mjs",
      `--catalog=${brokenRecentCatalogPath}`,
      `--train-input=${trainInputPath}`,
      `--train-report-dir=${trainReportDir}`,
      `--oos-input=${oosInputPath}`,
      `--oos-report-dir=${oosReportDir}`,
      `--oos-apply-raw-dir=${oosApplyRawDir}`,
      `--oos-apply-close28-dir=${oosApplyClose28Dir}`,
      `--out-dir=${path.join(tempRoot, "out-recent-only-missing-contract")}`,
      "--run-id=smoke-recent-only-missing-contract",
      "--split-policy=decision_date_only",
      "--selection-mode=champion_only",
      "--line-id=stepb_dplus1_plus_lite_recent_mid_low",
      "--max-gap=100000",
      "--config-path=/tmp/base_config.json",
      `--config-sha256=${"c".repeat(64)}`,
      "--train-config-path=/tmp/train_config.json",
      `--train-config-sha256=${"d".repeat(64)}`,
      "--oos-config-path=/tmp/oos_config.json",
      `--oos-config-sha256=${"e".repeat(64)}`,
      `--train-step-a-summary=${trainStepASummaryPath}`,
      `--oos-step-a-summary=${oosStepASummaryPath}`,
    ],
    process.cwd(),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
