import path from "node:path"
import { readdir } from "node:fs/promises"

import { ensureDir, pathExists, readJson, writeJson } from "../lib/io.mjs"
import { buildSelectionHitAt1Snapshot } from "../lib/selection_metric.mjs"

const clamp01 = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

const averageFinite = (values) => {
  const list = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
  if (list.length < 1) return 0
  return list.reduce((acc, value) => acc + value, 0) / list.length
}

const buildDGateMetrics = (source) => {
  const selectionHitAt1 = buildSelectionHitAt1Snapshot(source)
  return {
    targetHitRateEval:
      Number(source?.targetHitRateEval ?? source?.targetHitRate ?? source?.pickHitRateEval ?? 0) || 0,
    selectionHitAt1Eval: selectionHitAt1.resolved,
    selectionHitAt1RawEval: selectionHitAt1.raw,
    selectionHitAt1ResolvedEval: selectionHitAt1.resolved,
    selectionHitAt1MetricSourceEval: selectionHitAt1.source,
    selectionHitAt1AgreementFallbackAwareEval: selectionHitAt1.agreementFallbackAware,
    executedTargetHitRateEval:
      Number(
        source?.executedTargetHitRateEval ??
          source?.executedTargetHitRate ??
          source?.executedHitRateEval ??
          source?.executedHitRate ??
          0,
      ) || 0,
    stopRateEval: Number(source?.stopRateEval ?? source?.stopRate ?? 0) || 0,
    timeoutNegativeRateEval:
      Number(source?.timeoutNegativeRateEval ?? source?.timeoutNegativeRate ?? 0) || 0
  }
}

const buildEGateMetrics = (source) => ({
  targetHitRate: Number(source?.targetHitRate ?? 0) || 0,
  targetHitCount: Math.max(0, Number(source?.targetHitCount ?? 0) || 0),
  stopRate: Number(source?.stopRate ?? 0) || 0,
  timeoutNegativeRate: Number(source?.timeoutNegativeRate ?? 0) || 0,
  winRate: Number(source?.winRate ?? 0) || 0,
  avgNetRet: Number(source?.avgNetRet ?? 0) || 0,
  cumulativeReturn: Number(source?.cumulativeReturn ?? 0) || 0,
  totalTrades: Math.max(0, Number(source?.totalTrades ?? 0) || 0)
})

const buildCGate = (stepC, cfg = {}) => {
  const temporal = stepC?.temporalStability ?? {}
  const selectedOverview = temporal?.selectedClusterOverview ?? {}
  const selectedMix = temporal?.selectedPrototypeEraMix ?? {}
  const prototypes = Array.isArray(stepC?.localPrototypes)
    ? stepC.localPrototypes
    : Array.isArray(stepC?.prototypes)
      ? stepC.prototypes
      : []
  const breakdowns = prototypes
    .map((row) => row?.cQualityScoreBreakdown)
    .filter((row) => row && typeof row === "object")
  const eraCoverageRatio = Number(
    selectedOverview?.minEraCoverageRatio ??
      selectedOverview?.medianEraCoverageRatio ??
      0,
  ) || 0
  const maxSingleEraShare = Number(
    selectedOverview?.maxMaxSingleEraShare ?? selectedMix?.maxEraShare ?? 1,
  ) || 0
  const regimeConsistency = clamp01(averageFinite(breakdowns.map((row) => row?.regimeConsistency)))
  const stopBiasRate = averageFinite(prototypes.map((row) => row?.stopRate3d))
  const timeoutNegativeBiasRate = averageFinite(
    breakdowns.map((row) => row?.timeoutNegativeRateEval),
  )
  const oracleCoverage = averageFinite(breakdowns.map((row) => row?.oracleAssist))
  const configuredMinCoverage = clamp01(
    temporal?.selection?.effectiveMinEraCoverageRatio ??
      temporal?.selection?.minEraCoverageRatio ??
      cfg?.pattern?.temporalStability?.minEraCoverageRatio ??
      0,
  )
  const configuredMaxSingleEraShare = clamp01(
    temporal?.selection?.effectiveMaxSingleEraShare ??
      temporal?.selection?.maxSingleEraShare ??
      cfg?.pattern?.temporalStability?.maxSingleEraShare ??
      1,
  )
  const checks = {
    eraCoverage: eraCoverageRatio >= configuredMinCoverage,
    maxSingleEraShare: maxSingleEraShare <= configuredMaxSingleEraShare,
    regimeConsistency: regimeConsistency >= 0.35,
    stopBias: stopBiasRate <= 0.6,
    timeoutNegativeBias: timeoutNegativeBiasRate <= 0.6
  }
  return {
    enabled: true,
    failed: Object.values(checks).some((value) => value === false),
    checks,
    metrics: {
      eraCoverageRatio,
      maxSingleEraShare,
      regimeConsistency,
      stopBiasRate,
      timeoutNegativeBiasRate,
      oracleCoverage
    },
    smokeEligible: true
  }
}

const hasObjectKeys = (value) => !!value && typeof value === "object" && Object.keys(value).length > 0

const findLatestCdLoopSummaryPath = async (runDir) => {
  const directSummaryPath = path.join(runDir, "cd_loop_summary.json")
  if (pathExists(directSummaryPath)) return directSummaryPath
  const loopRootDir = path.join(runDir, "cd-loop")
  if (!pathExists(loopRootDir)) return null
  const entries = await readdir(loopRootDir, { withFileTypes: true }).catch(() => [])
  const summaryPaths = entries
    .filter((entry) => entry?.isDirectory?.())
    .map((entry) => path.join(loopRootDir, entry.name, "cd_loop_summary.json"))
    .filter((summaryPath) => pathExists(summaryPath))
    .sort((left, right) => right.localeCompare(left))
  return summaryPaths[0] ?? null
}

export const runFinalReport = async (ctx) => {
  const outDir = path.join(ctx.runDir, "report")
  await ensureDir(outDir)

  const cdLoopSummaryPath = await findLatestCdLoopSummaryPath(ctx.runDir)
  const cdLoopSummary = cdLoopSummaryPath ? await readJson(cdLoopSummaryPath, null) : null
  const stepA = await readJson(path.join(ctx.runDir, "step-a", "step_a_summary.json"), {})
  const stepB = await readJson(path.join(ctx.runDir, "step-b", "step_b_summary.json"), {})
  const stepC0File = await readJson(path.join(ctx.runDir, "step-c0", "c0_summary.json"), {})
  const stepC1File = await readJson(path.join(ctx.runDir, "step-c1", "c1_summary.json"), {})
  const stepC2File = await readJson(path.join(ctx.runDir, "step-c2", "c2_summary.json"), {})
  const stepC = await readJson(path.join(ctx.runDir, "step-c", "step_c_summary.json"), {})
  const stepD = await readJson(path.join(ctx.runDir, "step-d", "step_d_summary.json"), {})
  const stepE = await readJson(path.join(ctx.runDir, "step-e", "step_e_summary.json"), {})
  const stepC0 = hasObjectKeys(cdLoopSummary?.stepC0) ? cdLoopSummary.stepC0 : stepC0File
  const stepC1 = hasObjectKeys(cdLoopSummary?.stepC1) ? cdLoopSummary.stepC1 : stepC1File
  const stepC2 = hasObjectKeys(cdLoopSummary?.stepC2) ? cdLoopSummary.stepC2 : stepC2File
  const researchGates = ctx.config?.researchGates ?? {}
  const minD = clamp01(researchGates?.lineDiscard?.minD ?? 0.4)
  const minE = clamp01(researchGates?.lineDiscard?.minE ?? 0.4)
  const promotionMinD = clamp01(researchGates?.parentPromotion?.minD ?? 0.5)
  const promotionMinE = clamp01(researchGates?.parentPromotion?.minE ?? 0.55)
  const c0Gate = cdLoopSummary?.c0Gate ?? stepC?.c0Gate ?? stepC0?.gate ?? {
    enabled: false,
    failed: false,
    reason: "UNAVAILABLE",
    fallbackUsed: false
  }
  const c1Gate = cdLoopSummary?.c1Gate ?? stepC?.c1Gate ?? stepC1?.gate ?? {
    enabled: false,
    failed: false,
    reason: "UNAVAILABLE",
    fallbackUsed: false
  }
  const c2Gate = cdLoopSummary?.c2Gate ?? stepC?.c2Gate ?? stepC2?.gate ?? {
    enabled: false,
    failed: false,
    reason: "UNAVAILABLE",
    fallbackUsed: false
  }
  const cGate = cdLoopSummary?.cGate ?? stepC?.cGate ?? buildCGate(stepC, ctx.config)
  const dGateMetrics = stepD?.dGate?.metrics ?? buildDGateMetrics(stepD)
  const eGateMetrics = stepE?.eGate?.metrics ?? buildEGateMetrics(stepE)
  const dGate = cdLoopSummary?.dGate ?? stepD?.dGate ?? {
    enabled: true,
    failed: dGateMetrics.targetHitRateEval < minD,
    metrics: dGateMetrics
  }
  const eGate = cdLoopSummary?.eGate ?? stepE?.eGate ?? {
    enabled: !!stepE && Object.keys(stepE).length > 0,
    failed:
      !stepE ||
      Object.keys(stepE).length < 1 ||
      eGateMetrics.targetHitRate < minE,
    metrics: eGateMetrics
  }
  const promotionGate = cdLoopSummary?.promotionGate ?? {
    enabled: true,
    eligible:
      cGate?.failed !== true &&
      dGateMetrics.targetHitRateEval >= promotionMinD &&
      eGateMetrics.targetHitRate >= promotionMinE,
    blocker:
      cGate?.failed === true
        ? "C_GATE_FAILED"
        : dGateMetrics.targetHitRateEval < promotionMinD
          ? "STEP_D_BELOW_RESEARCH_PROMOTION_GATE"
          : eGateMetrics.targetHitRate < promotionMinE
            ? (
                eGate?.notRunReason
                  ? String(eGate.notRunReason)
                  : "STEP_E_BELOW_RESEARCH_PROMOTION_GATE"
              )
            : "PASS",
    thresholds: {
      minD: promotionMinD,
      minE: promotionMinE
    },
    metrics: {
      dMetric: dGateMetrics.targetHitRateEval,
      eMetric: eGateMetrics.targetHitRate
    }
  }

  const scoreboard = {
    runId: ctx.runId,
    generatedAt: new Date().toISOString(),
    goalMode: stepE?.goalMode ?? stepD?.goalMode ?? null,
    positionSemantics: stepE?.positionSemantics ?? stepD?.positionSemantics ?? null,
    primaryMetrics: {
      targetHitRateEval: stepD?.targetHitRateEval ?? stepD?.pickHitRateEval ?? 0,
      targetHitsPer20EvalDays: stepD?.targetsPer20EvalDays ?? 0,
      lockboxTargetHitCount: stepE?.targetHitCount ?? 0,
      lockboxTargetHitRate: stepE?.targetHitRate ?? 0,
      lockboxTargetHitsPer20TradingDays: stepE?.targetHitsPer20TradingDays ?? 0,
      lockboxStopRate: stepE?.stopRate ?? 0,
      lockboxTimeoutNegativeRate: stepE?.timeoutNegativeRate ?? 0
    },
    c0Gate,
    c1Gate,
    cGate,
    dGate,
    eGate,
    promotionGate,
    secondaryPnL: {
      lockboxWinRate: stepE?.winRate ?? 0,
      lockboxAvgNetRet: stepE?.avgNetRet ?? 0,
      lockboxEqualWeightNetRetSum: stepE?.equalWeightNetRetSum ?? 0,
      lockboxCumulativeReturn: stepE?.cumulativeReturn ?? 0,
      lockboxMaxDrawdown: stepE?.maxDrawdown ?? 0
    }
  }

  const report = {
    runId: ctx.runId,
    generatedAt: new Date().toISOString(),
    periods: ctx.periods,
    event: ctx.config.event,
    filters: {
      minMarketCapKrw: ctx.config.filters.minMarketCapKrw,
      maxMarketCapKrw: ctx.config.filters.maxMarketCapKrw,
      minAvgTradingValue20dKrw: ctx.config.filters.minAvgTradingValue20dKrw,
      gapTradability: ctx.config.filters.gapTradability
    },
    summary: {
      stepA,
      stepB,
      stepC0,
      stepC1,
      stepC2,
      stepC,
      stepD,
      stepE,
      cdLoop: cdLoopSummary
    },
    c0Summary: stepC0,
    c1Summary: stepC1,
    c2Summary: stepC2,
    c0Gate,
    c1Gate,
    c2Gate,
    cGate,
    dGate,
    eGate,
    promotionGate,
    integrity: {
      cdLoopSummaryPresent: hasObjectKeys(cdLoopSummary),
      stepC1SummaryPresent: !!stepC1 && Object.keys(stepC1).length > 0,
      stepC2SummaryPresent: !!stepC2 && Object.keys(stepC2).length > 0,
      stepDSummaryPresent: !!stepD && Object.keys(stepD).length > 0,
      stepESummaryPresent: !!stepE && Object.keys(stepE).length > 0,
      lockboxSummaryPresent: !!stepE && Object.keys(stepE).length > 0
    },
    keyMetrics: {
      goalMode: stepE?.goalMode ?? stepD?.goalMode ?? null,
      positionSemantics: stepE?.positionSemantics ?? stepD?.positionSemantics ?? null,
      eventCount: stepA?.passedEvents ?? 0,
      templateCount: stepB?.templates ?? 0,
      c0FamilyCount: stepC0?.families ?? 0,
      c0ShortlistedFamilyCount: stepC0?.shortlistedFamilies ?? 0,
      c0AcceptedTemplateCount:
        stepC?.c0AcceptedTemplateCount ?? stepC?.c0?.acceptedTemplateCount ?? 0,
      c0RejectedTemplateCount:
        stepC?.c0RejectedTemplateCount ?? stepC?.c0?.rejectedTemplateCount ?? 0,
      c0FallbackUsed: stepC0?.gate?.fallbackUsed === true || stepC?.c0FallbackUsed === true,
      c1ProbedFamilyCount:
        stepC?.c1ProbedFamilyCount ?? stepC1?.probedFamilies ?? 0,
      c1PassedFamilyCount:
        stepC?.c1PassedFamilyCount ?? stepC1?.passedFamilies ?? 0,
      c1RejectedFamilyCount:
        stepC?.c1RejectedFamilyCount ??
        Math.max(
          0,
          (Number(stepC1?.probedFamilies ?? 0) || 0) - (Number(stepC1?.passedFamilies ?? 0) || 0),
        ),
      c1FallbackUsed:
        stepC1?.fallbackUsed === true || stepC?.c1FallbackUsed === true,
      c1ProbeScopeApplied: stepC1?.probeScopeApplied ?? null,
      c1WritebacksDisabled: stepC1?.writebacksDisabled === true,
      c1FrozenProbe: stepC1?.frozenProbe === true,
      c1FeedbackUpdatesSkipped: stepC1?.feedbackUpdatesSkipped === true,
      c1ExecutionFeedbackSkipped: stepC1?.executionFeedbackSkipped === true,
      c2RepresentativeFamilyCount:
        stepC?.c2RepresentativeFamilyCount ?? stepC2?.representativeFamilies ?? 0,
      c2ShadowFamilyCount:
        stepC?.c2ShadowFamilyCount ?? stepC2?.shadowFamilies ?? 0,
      c2FallbackUsed:
        stepC2?.fallbackUsed === true || stepC?.c2FallbackUsed === true,
      c2GateFailed: c2Gate?.failed === true,
      lockboxTopMatchedC2RepresentativeFamilyId:
        String(stepE?.topMatchedC2RepresentativeFamilyId ?? "").trim() || null,
      lockboxSelectedC2FamilyShare:
        Number(stepE?.c2Selection?.selectedC2FamilyShare ?? 0) || 0,
      prototypeCount: stepC?.prototypes ?? 0,
      targetHitRateEval: stepD?.targetHitRateEval ?? stepD?.pickHitRateEval ?? 0,
      targetHitsPer20EvalDays: stepD?.targetsPer20EvalDays ?? 0,
      precisionAt1Executable: stepD?.precisionAt1Executable ?? stepD?.promotionView?.executedHitRate ?? 0,
      afterCostExpectancy: stepD?.afterCostExpectancy ?? 0,
      executionCoverageEval: stepD?.executionCoverageEval ?? stepD?.executionCoverage ?? 0,
      promotionSource: stepD?.promotionView?.source ?? null,
      lockboxSummaryPresent: !!stepE && Object.keys(stepE).length > 0,
      lockboxTotalTrades: stepE?.totalTrades ?? 0,
      lockboxTargetHitCount: stepE?.targetHitCount ?? 0,
      lockboxTargetHitRate: stepE?.targetHitRate ?? 0,
      lockboxTargetHitsPer20TradingDays: stepE?.targetHitsPer20TradingDays ?? 0,
      lockboxStopRate: stepE?.stopRate ?? 0,
      lockboxTimeoutNegativeRate: stepE?.timeoutNegativeRate ?? 0,
      lockboxCumulativeReturnMode: stepE?.cumulativeReturnMode ?? null,
      lockboxExecutionApprovedRawCount: stepE?.executionApprovedRawCount ?? 0,
      lockboxPeakConcurrentPositions: stepE?.peakConcurrentPositions ?? 0,
      lockboxOverlapActiveRate: stepE?.overlapActiveRate ?? 0,
      c0GateReason: String(c0Gate?.reason ?? stepC0?.gate?.reason ?? "UNAVAILABLE").trim() || "UNAVAILABLE",
      c1GateReason: String(c1Gate?.reason ?? stepC1?.gate?.reason ?? "UNAVAILABLE").trim() || "UNAVAILABLE",
      c2GateReason: String(c2Gate?.reason ?? stepC2?.gate?.reason ?? "UNAVAILABLE").trim() || "UNAVAILABLE",
      cGateReason: String(cGate?.reason ?? (cGate?.failed === true ? "FAILED" : "PASS")).trim() || "UNAVAILABLE",
      dGateReason: String(dGate?.reason ?? (dGate?.failed === true ? "FAILED" : "PASS")).trim() || "UNAVAILABLE",
      eGateReason: String(eGate?.reason ?? eGate?.notRunReason ?? (eGate?.failed === true ? "FAILED" : "PASS")).trim() || "UNAVAILABLE",
      promotionBlocker: String(promotionGate?.blocker ?? "UNAVAILABLE").trim() || "UNAVAILABLE",
      c1GateFailed: c1Gate?.failed === true,
      c2GateFailed: c2Gate?.failed === true,
      cGateFailed: cGate?.failed === true,
      dGateFailed: dGate?.failed === true,
      eGateFailed: eGate?.failed === true,
      promotionEligible: promotionGate?.eligible === true
    },
    secondaryPnL: {
      lockboxWinRate: stepE?.winRate ?? 0,
      lockboxAvgNetRet: stepE?.avgNetRet ?? 0,
      lockboxEqualWeightNetRetSum: stepE?.equalWeightNetRetSum ?? 0,
      lockboxCumulativeReturn: stepE?.cumulativeReturn ?? 0,
      lockboxMaxDrawdown: stepE?.maxDrawdown ?? 0
    },
    lockboxParity: {
      stepDEvalReference: stepE?.stepDEvalReference ?? null,
      evalToLockboxGap: stepE?.evalToLockboxGap ?? null,
      policyParityMode: stepE?.policyParityMode ?? null,
      policyContract: stepE?.policyContract ?? null,
      selectionCount: stepE?.selectionCount ?? 0,
      executedCount: stepE?.executedCount ?? 0,
      metaDecisionCounts: stepE?.metaDecisionCounts ?? {},
      executionDecisionCounts: stepE?.executionDecisionCounts ?? {},
      executionShadowReasonCounts: stepE?.executionShadowReasonCounts ?? {},
      lookaheadViolations: stepE?.lookaheadViolations ?? 0,
      executionLookaheadViolations: stepE?.executionLookaheadViolations ?? 0
    },
    precisionCoverageCurve: stepD?.precisionCoverageCurve ?? [],
    regimeDashboard: {
      picked: stepD?.regimeBreakdownEval ?? stepD?.regimeBreakdown ?? {},
      executed: stepD?.executedRegimeBreakdownEval ?? stepD?.executedRegimeBreakdown ?? {}
    },
    calibrationQuality: {
      pHitAvg: stepD?.calibratedSignals?.pHitAvg ?? null,
      pStopFirstAvg: stepD?.calibratedSignals?.pStopFirstAvg ?? null,
      pFillAvg: stepD?.calibratedSignals?.pFillAvg ?? null,
      confidenceAvg: stepD?.calibratedSignals?.confidenceAvg ?? null,
      executionGlobalLcb95: stepD?.executionGate?.globalCalibration?.lcb95 ?? null,
      diagnostics: stepD?.calibration?.quality ?? null,
      rankConsistency: stepD?.calibration?.quality?.rankConsistency ?? null,
      routeBucketBreakdown: stepD?.calibration?.quality?.route ?? [],
      regimeBreakdown: stepD?.calibration?.quality?.regime ?? []
    },
    prototypeDominance: {
      maxClusterPrototypeShare: stepC?.maxClusterPrototypeShare ?? null,
      medianClusterPrototypeShare: stepC?.medianClusterPrototypeShare ?? null,
      runtimePrototypeCount: stepC?.runtimePrototypeCount ?? null,
      runtimeClusterCount: stepC?.runtimeClusterCount ?? null
    },
    coarsePruneHealth: stepD?.coarsePruneHealth ?? null,
    shadowLiveSplit: {
      decisionDays: stepD?.executionDecisionDays ?? 0,
      approvedDays: stepD?.executedDays ?? 0,
      shadowDays: stepD?.executionShadowDays ?? 0,
      blockedDays: stepD?.executionBlockedDays ?? 0
    }
  }

  const reportPath = path.join(outDir, "final_report.json")
  const scoreboardPath = path.join(outDir, "target_first_probe_scoreboard.json")
  await writeJson(reportPath, report)
  await writeJson(scoreboardPath, scoreboard)
  return { reportPath, scoreboardPath, report, scoreboard }
}
