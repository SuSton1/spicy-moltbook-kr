#!/usr/bin/env node

import path from "node:path"
import { readFile } from "node:fs/promises"
import { buildSelectionHitAt1Snapshot } from "../src/lib/selection_metric.mjs"

const usage = () => {
  console.error(
    "usage: node tools/family_probe_dossier.mjs --run-id=<run> --family-id=<family> [--config=<path>] [--format=json|markdown]",
  )
}

const args = process.argv.slice(2)
let runId = ""
let familyId = ""
let configPath = "config/lab.config.server.lite.json"
let format = "json"

for (const arg of args) {
  if (arg.startsWith("--run-id=")) {
    runId = String(arg.slice("--run-id=".length)).trim()
    continue
  }
  if (arg.startsWith("--family-id=")) {
    familyId = String(arg.slice("--family-id=".length)).trim()
    continue
  }
  if (arg.startsWith("--config=")) {
    configPath = String(arg.slice("--config=".length)).trim() || configPath
    continue
  }
  if (arg.startsWith("--format=")) {
    format = String(arg.slice("--format=".length)).trim().toLowerCase() || format
    continue
  }
  if (arg === "-h" || arg === "--help") {
    usage()
    process.exit(0)
  }
  console.error(`unknown arg: ${arg}`)
  usage()
  process.exit(2)
}

if (!runId || !familyId || !["json", "markdown"].includes(format)) {
  usage()
  process.exit(2)
}

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const finiteValues = (values) =>
  (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))

const summarizeNumbers = (values) => {
  const nums = finiteValues(values).sort((a, b) => a - b)
  if (nums.length < 1) {
    return {
      count: 0,
      mean: null,
      median: null,
      min: null,
      max: null
    }
  }
  const mid = Math.floor(nums.length / 2)
  const median =
    nums.length % 2 === 0
      ? (nums[mid - 1] + nums[mid]) / 2
      : nums[mid]
  const sum = nums.reduce((acc, value) => acc + value, 0)
  return {
    count: nums.length,
    mean: sum / nums.length,
    median,
    min: nums[0],
    max: nums[nums.length - 1]
  }
}

const countUniqueFinite = (values, precision = 6) =>
  new Set(
    finiteValues(values).map((value) => value.toFixed(precision)),
  ).size

const pct = (value, digits = 2) => {
  const n = num(value)
  if (!Number.isFinite(n)) return "n/a"
  return `${(n * 100).toFixed(digits)}%`
}

const safeJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"))

const safeJsonl = async (filePath) =>
  (await readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))

const mustReadResultRow = async ({ repoRoot, runId: selectedRunId, familyId: selectedFamilyId }) => {
  const resultsPath = path.join(repoRoot, "artifacts", "runs", selectedRunId, "step-c1", "c1_family_probe_results.jsonl")
  const rows = await safeJsonl(resultsPath)
  const row = rows.find((entry) => String(entry?.familyId ?? "").trim() === selectedFamilyId)
  if (!row) {
    throw new Error(`family ${selectedFamilyId} missing in ${resultsPath}`)
  }
  return row
}

const buildThresholds = (config) => {
  const raw = config?.pattern?.c1 ?? {}
  return {
    targetHitRateEval: num(raw?.familyPassMinTargetHitRateEval ?? 0.1),
    executedTargetHitRateEval: num(raw?.familyPassMinExecutedTargetHitRateEval ?? 0.08),
    selectionHitAt1Eval: num(raw?.familyPassMinSelectionHitAt1Eval ?? 0.08),
    pickedDaysEval: num(raw?.familyPassMinPickedDaysEval ?? 4),
    targetsPer20EvalDays: num(raw?.familyPassMinTargetsPer20EvalDays ?? 0.8),
    executionCoverageEval: num(raw?.familyPassMinExecutionCoverageEval ?? 0.2),
    stopRateEval: num(raw?.familyPassMaxStopRateEval ?? 0.6),
    timeoutNegativeRateEval: num(raw?.familyPassMaxTimeoutNegativeRateEval ?? 0.6),
  }
}

const buildDecisionGate = (config) => {
  const raw = config?.decisionGate ?? {}
  return {
    minFinalScore: num(raw?.minFinalScore ?? raw?.minTradeScore ?? 0),
    minScoreMargin: num(raw?.minScoreMargin ?? 0),
    minExpectedNetRet3d: num(raw?.minExpectedNetRet3d ?? -1),
    requirePositiveExpectedNetRet3d: raw?.requirePositiveExpectedNetRet3d === true,
    rerankMaxSwapMargin: num(raw?.top1Rerank?.maxSwapMargin ?? 0.008),
    targetFirstTieBreakMaxScoreGap: num(
      raw?.top1MicroCorrection?.targetFirstTieBreak?.maxScoreGap ?? 0.0085,
    ),
  }
}

const buildSnapshot = ({ row, thresholds }) => {
  const selectionHitAt1 = buildSelectionHitAt1Snapshot(row ?? {})
  return {
    pickedDaysEval: num(row?.pickedDaysEval),
    targetHitRateEval: num(row?.targetHitRateEval),
    selectionHitAt1Eval: num(selectionHitAt1.resolved),
    selectionHitAt1RawEval: num(selectionHitAt1.raw),
    selectionHitAt1ResolvedEval: num(selectionHitAt1.resolved),
    selectionHitAt1MetricSourceEval: selectionHitAt1.source,
    executedTargetHitRateEval: num(row?.executedTargetHitRateEval),
    targetsPer20EvalDays: num(row?.targetsPer20EvalDays),
    executionCoverageEval: num(row?.executionCoverageEval),
    stopRateEval: num(row?.stopRateEval),
    timeoutNegativeRateEval: num(row?.timeoutNegativeRateEval),
    primaryGateReasonEval: row?.primaryGateReasonEval ?? null,
    rejectReason: row?.rejectReason ?? null,
    familyQualityScore: num(row?.familyQualityScore),
    thresholdDeltas: {
      targetHitRateEval: num(row?.targetHitRateEval) - num(thresholds?.targetHitRateEval),
      executedTargetHitRateEval:
        num(row?.executedTargetHitRateEval) - num(thresholds?.executedTargetHitRateEval),
      selectionHitAt1Eval: num(selectionHitAt1.resolved) - num(thresholds?.selectionHitAt1Eval),
      pickedDaysEval: num(row?.pickedDaysEval) - num(thresholds?.pickedDaysEval),
      targetsPer20EvalDays: num(row?.targetsPer20EvalDays) - num(thresholds?.targetsPer20EvalDays),
      executionCoverageEval: num(row?.executionCoverageEval) - num(thresholds?.executionCoverageEval),
      stopRateEval: num(thresholds?.stopRateEval) - num(row?.stopRateEval),
      timeoutNegativeRateEval: num(thresholds?.timeoutNegativeRateEval) - num(row?.timeoutNegativeRateEval),
    },
  }
}

const buildAgreementCounterfactualEval = ({ d1Rows, decisionGate }) => {
  const evalRows = (Array.isArray(d1Rows) ? d1Rows : [])
    .filter((row) => String(row?.partition ?? "").trim().toUpperCase() === "V")
  const consensusLowRows = evalRows
    .filter((row) => String(row?.gateReason ?? "").trim().toUpperCase() === "AGREEMENT_CONSENSUS_LOW")
  const altAgreementTradeByRank = {}
  const altAgreementTradeHitByRank = {}
  const altTradeHitScores = []
  const altTradeHitRanks = []
  const altTradeHitDays = new Set()
  const fallbackPassingDays = []
  const swapEligibleAltTradeHitDays = new Set()
  const top1QualityValues = []
  const top1AntiValues = []
  const top1EraCoverageValues = []
  const top1SingleEraShareValues = []
  const top1EraSupportValues = []
  const altTradeHitQualityValues = []
  const altTradeHitAntiValues = []
  const altTradeHitEraCoverageValues = []
  const altTradeHitSingleEraShareValues = []
  const altTradeHitEraSupportValues = []

  for (const row of consensusLowRows) {
    const rankedCandidates = Array.isArray(row?.rankedCandidates) ? row.rankedCandidates : []
    const counterfactualCandidates = Array.isArray(row?.counterfactualGateSweep?.candidates)
      ? row.counterfactualGateSweep.candidates
      : []
    const counterfactualByRank = new Map(
      counterfactualCandidates
        .map((candidate) => [Number(candidate?.rank), candidate])
        .filter(([rank, candidate]) => Number.isFinite(rank) && candidate),
    )
    const top1 = rankedCandidates[0] ?? null
    if (top1) {
      top1QualityValues.push(top1?.qualityScore)
      top1AntiValues.push(top1?.antiScore)
      top1EraCoverageValues.push(top1?.clusterTemporalEraCoverageRatio)
      top1SingleEraShareValues.push(
        top1?.clusterTemporalEffectiveSingleEraShare ?? top1?.clusterTemporalMaxSingleEraShare,
      )
      top1EraSupportValues.push(top1?.clusterTemporalEraSupportCount)
    }

    for (const candidate of counterfactualCandidates) {
      const rank = Number(candidate?.rank)
      if (!Number.isFinite(rank) || rank <= 1) continue
      const agreementTrade =
        String(candidate?.agreementDecision ?? "").trim().toUpperCase() === "TRADE"
      const hit = candidate?.successInWindow === true
      if (agreementTrade) {
        altAgreementTradeByRank[rank] = Number(altAgreementTradeByRank[rank] ?? 0) + 1
      }
      if (agreementTrade && hit) {
        altAgreementTradeHitByRank[rank] = Number(altAgreementTradeHitByRank[rank] ?? 0) + 1
        altTradeHitDays.add(String(row?.decisionDateKey ?? ""))
        altTradeHitRanks.push(rank)
        altTradeHitScores.push(candidate?.finalScore)
        const rankedCandidate = rankedCandidates[rank - 1] ?? null
        if (rankedCandidate) {
          altTradeHitQualityValues.push(rankedCandidate?.qualityScore)
          altTradeHitAntiValues.push(rankedCandidate?.antiScore)
          altTradeHitEraCoverageValues.push(rankedCandidate?.clusterTemporalEraCoverageRatio)
          altTradeHitSingleEraShareValues.push(
            rankedCandidate?.clusterTemporalEffectiveSingleEraShare ??
              rankedCandidate?.clusterTemporalMaxSingleEraShare,
          )
          altTradeHitEraSupportValues.push(rankedCandidate?.clusterTemporalEraSupportCount)
        }
        const top1Score = num(rankedCandidates[0]?.finalScore ?? rankedCandidates[0]?.score)
        const candidateScore = num(rankedCandidate?.finalScore ?? rankedCandidate?.score ?? candidate?.finalScore)
        if (
          Number.isFinite(top1Score) &&
          Number.isFinite(candidateScore) &&
          Number.isFinite(num(decisionGate?.rerankMaxSwapMargin)) &&
          top1Score - candidateScore <= Number(decisionGate.rerankMaxSwapMargin)
        ) {
          swapEligibleAltTradeHitDays.add(String(row?.decisionDateKey ?? ""))
        }
      }
    }

    const fallbackPool = rankedCandidates.slice(1, 10)
    for (let idx = 0; idx < fallbackPool.length; idx += 1) {
      const rankedCandidate = fallbackPool[idx]
      const originalRank = idx + 2
      const counterfactualCandidate = counterfactualByRank.get(originalRank)
      if (
        !rankedCandidate ||
        String(counterfactualCandidate?.agreementDecision ?? "").trim().toUpperCase() !== "TRADE"
      ) {
        continue
      }
      const candidateScore = num(rankedCandidate?.finalScore ?? rankedCandidate?.score)
      if (
        Number.isFinite(num(decisionGate?.minFinalScore)) &&
        (
          !Number.isFinite(candidateScore) ||
          candidateScore < Number(decisionGate.minFinalScore)
        )
      ) {
        continue
      }
      const expectedNetRet3d = num(
        rankedCandidate?.expectedNetRet3d ?? counterfactualCandidate?.expectedNetRet3d,
      )
      if (
        decisionGate?.requirePositiveExpectedNetRet3d === true &&
        (
          !Number.isFinite(expectedNetRet3d) ||
          expectedNetRet3d <= 0
        )
      ) {
        continue
      }
      if (
        Number.isFinite(num(decisionGate?.minExpectedNetRet3d)) &&
        (
          !Number.isFinite(expectedNetRet3d) ||
          expectedNetRet3d < Number(decisionGate.minExpectedNetRet3d)
        )
      ) {
        continue
      }
      const nextCandidate = fallbackPool[idx + 1] ?? null
      const nextScore = num(nextCandidate?.finalScore ?? nextCandidate?.score)
      const margin = nextCandidate
        ? (
            Number.isFinite(candidateScore) &&
            Number.isFinite(nextScore)
              ? candidateScore - nextScore
              : null
          )
        : Number.POSITIVE_INFINITY
      if (
        Number.isFinite(num(decisionGate?.minScoreMargin)) &&
        (
          !Number.isFinite(margin) ||
          margin < Number(decisionGate.minScoreMargin)
        )
      ) {
        continue
      }
      fallbackPassingDays.push({
        decisionDateKey: String(row?.decisionDateKey ?? ""),
        originalRank,
        symbol: String(rankedCandidate?.symbol ?? "").trim() || null,
        finalScore: candidateScore,
        scoreMargin: Number.isFinite(margin) ? margin : null,
        successInWindow: counterfactualCandidate?.successInWindow === true
      })
      break
    }
  }

  return {
    consensusLowDays: consensusLowRows.length,
    altAgreementTradeByRank,
    altAgreementTradeHitByRank,
    altTradeHitDays: altTradeHitDays.size,
    altTradeHitRank: summarizeNumbers(altTradeHitRanks),
    altTradeHitFinalScore: summarizeNumbers(altTradeHitScores),
    rerankSwapEligibleAltTradeHitDays: swapEligibleAltTradeHitDays.size,
    fallbackPassDaysIfDropBlockedTop1: fallbackPassingDays.length,
    fallbackHitDaysIfDropBlockedTop1: fallbackPassingDays
      .filter((entry) => entry?.successInWindow === true)
      .length,
    fallbackSamples: fallbackPassingDays.slice(0, 10),
    surfaceDegeneracy: {
      top1QualityUniqueCount: countUniqueFinite(top1QualityValues),
      top1AntiUniqueCount: countUniqueFinite(top1AntiValues),
      top1EraCoverageUniqueCount: countUniqueFinite(top1EraCoverageValues),
      top1SingleEraShareUniqueCount: countUniqueFinite(top1SingleEraShareValues),
      top1EraSupportUniqueCount: countUniqueFinite(top1EraSupportValues),
      altTradeHitQualityUniqueCount: countUniqueFinite(altTradeHitQualityValues),
      altTradeHitAntiUniqueCount: countUniqueFinite(altTradeHitAntiValues),
      altTradeHitEraCoverageUniqueCount: countUniqueFinite(altTradeHitEraCoverageValues),
      altTradeHitSingleEraShareUniqueCount: countUniqueFinite(altTradeHitSingleEraShareValues),
      altTradeHitEraSupportUniqueCount: countUniqueFinite(altTradeHitEraSupportValues),
    },
  }
}

const buildDossier = ({
  runId: selectedRunId,
  familyId: selectedFamilyId,
  row,
  stepDSummary,
  stepDSummaryAvailable,
  d1Available,
  thresholds,
  decisionGate,
  d1Rows
}) => {
  const agreementEval = stepDSummary?.agreementGate?.diagnosticsEval ?? {}
  const scoreRecoveryEval = stepDSummary?.scoreRecovery?.diagnosticsEval ?? {}
  const scoreRecalibrationEval = stepDSummary?.scoreRecalibration?.diagnosticsEval ?? {}
  const gateReasonCountsEval = stepDSummary?.gateReasonCountsEval ?? {}
  const snapshot = buildSnapshot({ row, thresholds })
  const agreementCounterfactualEval = buildAgreementCounterfactualEval({
    d1Rows,
    decisionGate
  })
  const recoverableSignals = []

  if (Number(row?.agreementBlockedTop1WouldHaveHitDaysEval ?? 0) > 0) {
    recoverableSignals.push(
      `agreement blocked-hit days=${Number(row?.agreementBlockedTop1WouldHaveHitDaysEval ?? 0)}`,
    )
  }
  if (Number(scoreRecoveryEval?.wouldHitDays ?? 0) > 0) {
    recoverableSignals.push(
      `scoreRecovery would-hit days=${Number(scoreRecoveryEval?.wouldHitDays ?? 0)}`,
    )
  }
  if (Number(scoreRecalibrationEval?.wouldHitDays ?? 0) > 0) {
    recoverableSignals.push(
      `scoreRecalibration would-hit days=${Number(scoreRecalibrationEval?.wouldHitDays ?? 0)}`,
    )
  }
  if (Number(agreementCounterfactualEval?.altTradeHitDays ?? 0) > 0) {
    recoverableSignals.push(
      `agreement-clean alternative hit days=${Number(agreementCounterfactualEval.altTradeHitDays)}`,
    )
  }

  const blockers = []
  if (Number(row?.agreementBlockedTop1WouldHaveHitDaysEval ?? 0) < 3) {
    blockers.push("agreement-only upside is small")
  }
  if (String(row?.primaryGateReasonEval ?? "").trim().toUpperCase() === "AGREEMENT_CONSENSUS_LOW") {
    blockers.push("top1 is still dying at agreement consensus")
  }
  const selectionHitAt1 = buildSelectionHitAt1Snapshot(row ?? {})
  if (Number(selectionHitAt1?.resolved ?? 0) < Number(thresholds?.selectionHitAt1Eval ?? 0)) {
    blockers.push("precision is below C1 pass threshold")
  }
  if (String(row?.scorePathologyPrimaryComponentEval ?? "").trim().toUpperCase() === "EXTENDED_BIAS_HEAVY") {
    blockers.push("primary score pathology is EXTENDED_BIAS_HEAVY")
  }
  if (
    Number(agreementCounterfactualEval?.altTradeHitDays ?? 0) > 0 &&
    Number(agreementCounterfactualEval?.fallbackPassDaysIfDropBlockedTop1 ?? 0) < 1
  ) {
    blockers.push("agreement-clean alternatives still die below score floor")
  }
  if (
    Number(agreementCounterfactualEval?.surfaceDegeneracy?.top1QualityUniqueCount ?? 0) <= 1 &&
    Number(agreementCounterfactualEval?.surfaceDegeneracy?.top1AntiUniqueCount ?? 0) <= 1 &&
    Number(agreementCounterfactualEval?.surfaceDegeneracy?.top1EraCoverageUniqueCount ?? 0) <= 1 &&
    Number(agreementCounterfactualEval?.surfaceDegeneracy?.top1EraSupportUniqueCount ?? 0) <= 1
  ) {
    blockers.push("candidate surface is degenerate across quality/anti/temporal features")
  }

  return {
    runId: selectedRunId,
    familyId: selectedFamilyId,
    artifacts: {
      stepDSummaryAvailable: stepDSummaryAvailable === true,
      d1Available: d1Available === true
    },
    snapshot,
    thresholds,
    decisionGate,
    gateReasonCountsEval,
    agreementEval: {
      reason: row?.agreementPrimaryReasonEval ?? null,
      pattern: row?.agreementPrimaryPatternEval ?? null,
      blockedDays: num(row?.agreementBlockedDaysEval),
      blockedTop1WouldHaveHitDays: num(row?.agreementBlockedTop1WouldHaveHitDaysEval),
      blockedTop1WouldHaveHitRate: num(row?.agreementBlockedTop1WouldHaveHitRateEval),
      consensusLowDays: num(row?.agreementConsensusLowDaysEval),
      scoreLowDays: num(row?.agreementScoreLowDaysEval),
      diagnostics: {
        blockedDays: num(agreementEval?.blockedDays),
        blockedTop1WouldHaveHitDays: num(agreementEval?.blockedTop1WouldHaveHitDays),
        blockedTop1WouldHaveHitRate: num(agreementEval?.blockedTop1WouldHaveHitRate),
        consensusLowDays: num(agreementEval?.consensusLowDays),
        stabilityLowDays: num(agreementEval?.stabilityLowDays),
        scoreLowDays: num(agreementEval?.scoreLowDays),
        blockedHitPatternCounts: agreementEval?.blockedHit?.patternCounts ?? {},
        blockedMissPatternCounts: agreementEval?.blockedMiss?.patternCounts ?? {},
      },
    },
    scoreRecoveryEval: {
      eligibleDays: num(scoreRecoveryEval?.eligibleDays),
      eligibleRate: num(scoreRecoveryEval?.eligibleRate),
      wouldTradeDays: num(scoreRecoveryEval?.wouldTradeDays),
      wouldHitDays: num(scoreRecoveryEval?.wouldHitDays),
      wouldHitRate: num(scoreRecoveryEval?.wouldHitRate),
      gateReasonCounts: scoreRecoveryEval?.gateReasonCounts ?? {},
      rejectReasonCounts: scoreRecoveryEval?.rejectReasonCounts ?? {},
    },
    scoreRecalibrationEval: {
      eligibleDays: num(scoreRecalibrationEval?.eligibleDays),
      eligibleRate: num(scoreRecalibrationEval?.eligibleRate),
      wouldTradeDays: num(scoreRecalibrationEval?.wouldTradeDays),
      wouldHitDays: num(scoreRecalibrationEval?.wouldHitDays),
      wouldHitRate: num(scoreRecalibrationEval?.wouldHitRate),
      primaryComponent: scoreRecalibrationEval?.primaryComponent ?? null,
      primarySubcomponent: scoreRecalibrationEval?.primarySubcomponent ?? null,
      primaryCompositeType: scoreRecalibrationEval?.primaryCompositeType ?? null,
      rejectReasonCounts: scoreRecalibrationEval?.rejectReasonCounts ?? {},
    },
    agreementCounterfactualEval,
    recoverableSignals,
    blockers,
  }
}

const toMarkdown = (dossier) => {
  const lines = []
  lines.push(`# Family Dossier: ${dossier.familyId}`)
  lines.push("")
  lines.push(`- runId: \`${dossier.runId}\``)
  lines.push(`- primary gate: \`${dossier.snapshot.primaryGateReasonEval ?? "n/a"}\``)
  lines.push(`- reject reason: \`${dossier.snapshot.rejectReason ?? "n/a"}\``)
  lines.push(
    `- diagnostics: stepDSummary=${dossier.artifacts?.stepDSummaryAvailable === true ? "yes" : "no"}, d1=${dossier.artifacts?.d1Available === true ? "yes" : "no"}`,
  )
  lines.push("")
  lines.push("## Snapshot")
  lines.push(`- pickedDaysEval: ${dossier.snapshot.pickedDaysEval}`)
  lines.push(`- targetHitRateEval: ${pct(dossier.snapshot.targetHitRateEval)}`)
  lines.push(`- selectionHitAt1Eval: ${pct(dossier.snapshot.selectionHitAt1Eval)}`)
  lines.push(`- selectionHitAt1RawEval: ${pct(dossier.snapshot.selectionHitAt1RawEval)}`)
  lines.push(`- selectionHitAt1MetricSourceEval: \`${dossier.snapshot.selectionHitAt1MetricSourceEval ?? "RAW_TOP1"}\``)
  lines.push(`- executedTargetHitRateEval: ${pct(dossier.snapshot.executedTargetHitRateEval)}`)
  lines.push(`- targetsPer20EvalDays: ${dossier.snapshot.targetsPer20EvalDays ?? "n/a"}`)
  lines.push(`- executionCoverageEval: ${pct(dossier.snapshot.executionCoverageEval)}`)
  lines.push(`- stopRateEval: ${pct(dossier.snapshot.stopRateEval)}`)
  lines.push(`- timeoutNegativeRateEval: ${pct(dossier.snapshot.timeoutNegativeRateEval)}`)
  lines.push("")
  lines.push("## Gate Breakdown")
  for (const [key, value] of Object.entries(dossier.gateReasonCountsEval ?? {})) {
    lines.push(`- ${key}: ${value}`)
  }
  lines.push("")
  lines.push("## Agreement")
  lines.push(`- primary reason: \`${dossier.agreementEval.reason ?? "n/a"}\``)
  lines.push(`- primary pattern: \`${dossier.agreementEval.pattern ?? "n/a"}\``)
  lines.push(
    `- blockedTop1WouldHaveHitDaysEval: ${dossier.agreementEval.blockedTop1WouldHaveHitDays ?? "n/a"} (${pct(dossier.agreementEval.blockedTop1WouldHaveHitRate)})`,
  )
  lines.push(`- consensusLowDaysEval: ${dossier.agreementEval.consensusLowDays ?? "n/a"}`)
  lines.push(`- scoreLowDaysEval: ${dossier.agreementEval.scoreLowDays ?? "n/a"}`)
  lines.push("")
  lines.push("## Agreement Counterfactual")
  lines.push(`- consensusLowDaysEval: ${dossier.agreementCounterfactualEval.consensusLowDays ?? "n/a"}`)
  lines.push(`- altTradeHitDaysEval: ${dossier.agreementCounterfactualEval.altTradeHitDays ?? "n/a"}`)
  lines.push(
    `- altTradeHitFinalScoreEval: mean=${num(dossier.agreementCounterfactualEval.altTradeHitFinalScore?.mean) ?? "n/a"}, median=${num(dossier.agreementCounterfactualEval.altTradeHitFinalScore?.median) ?? "n/a"}, max=${num(dossier.agreementCounterfactualEval.altTradeHitFinalScore?.max) ?? "n/a"}`,
  )
  lines.push(
    `- fallbackPassDaysIfDropBlockedTop1Eval: ${dossier.agreementCounterfactualEval.fallbackPassDaysIfDropBlockedTop1 ?? "n/a"}`,
  )
  lines.push(
    `- rerankSwapEligibleAltTradeHitDaysEval: ${dossier.agreementCounterfactualEval.rerankSwapEligibleAltTradeHitDays ?? "n/a"}`,
  )
  lines.push("")
  lines.push("## Score Recovery")
  lines.push(`- eligibleDaysEval: ${dossier.scoreRecoveryEval.eligibleDays ?? "n/a"} (${pct(dossier.scoreRecoveryEval.eligibleRate)})`)
  lines.push(`- wouldHitDaysEval: ${dossier.scoreRecoveryEval.wouldHitDays ?? "n/a"} (${pct(dossier.scoreRecoveryEval.wouldHitRate)})`)
  lines.push("")
  lines.push("## Score Recalibration")
  lines.push(`- eligibleDaysEval: ${dossier.scoreRecalibrationEval.eligibleDays ?? "n/a"} (${pct(dossier.scoreRecalibrationEval.eligibleRate)})`)
  lines.push(`- primaryComponentEval: \`${dossier.scoreRecalibrationEval.primaryComponent ?? "n/a"}\``)
  lines.push(`- primarySubcomponentEval: \`${dossier.scoreRecalibrationEval.primarySubcomponent ?? "n/a"}\``)
  lines.push("")
  lines.push("## Surface Degeneracy")
  lines.push(`- top1QualityUniqueCount: ${dossier.agreementCounterfactualEval.surfaceDegeneracy?.top1QualityUniqueCount ?? "n/a"}`)
  lines.push(`- top1AntiUniqueCount: ${dossier.agreementCounterfactualEval.surfaceDegeneracy?.top1AntiUniqueCount ?? "n/a"}`)
  lines.push(`- top1EraCoverageUniqueCount: ${dossier.agreementCounterfactualEval.surfaceDegeneracy?.top1EraCoverageUniqueCount ?? "n/a"}`)
  lines.push(`- top1EraSupportUniqueCount: ${dossier.agreementCounterfactualEval.surfaceDegeneracy?.top1EraSupportUniqueCount ?? "n/a"}`)
  lines.push("")
  lines.push("## Recoverable Signals")
  for (const item of dossier.recoverableSignals) {
    lines.push(`- ${item}`)
  }
  if (dossier.recoverableSignals.length < 1) {
    lines.push("- none")
  }
  lines.push("")
  lines.push("## Current Blockers")
  for (const item of dossier.blockers) {
    lines.push(`- ${item}`)
  }
  if (dossier.blockers.length < 1) {
    lines.push("- none")
  }
  lines.push("")
  return `${lines.join("\n")}\n`
}

const main = async () => {
  const repoRoot = process.cwd()
  const config = await safeJson(path.join(repoRoot, configPath))
  const row = await mustReadResultRow({ repoRoot, runId, familyId })
  const stepDSummaryPath = String(
    row?.stepDSummaryPath ??
      path.join(repoRoot, "artifacts", "runs", runId, "step-c1", "probes", familyId, "step-d", "step_d_summary.json"),
  ).trim()
  let stepDSummary = {}
  let stepDSummaryAvailable = false
  try {
    stepDSummary = await safeJson(stepDSummaryPath)
    stepDSummaryAvailable = true
  } catch {
    stepDSummary = {}
    stepDSummaryAvailable = false
  }
  const thresholds = buildThresholds(config)
  const decisionGate = buildDecisionGate(config)
  const stepDDir = path.dirname(stepDSummaryPath)
  const d1Path = path.join(stepDDir, "d1_ranked_candidates.jsonl")
  let d1Rows = []
  let d1Available = false
  try {
    d1Rows = await safeJsonl(d1Path)
    d1Available = true
  } catch {
    d1Rows = []
    d1Available = false
  }
  const dossier = buildDossier({
    runId,
    familyId,
    row,
    stepDSummary,
    stepDSummaryAvailable,
    d1Available,
    thresholds,
    decisionGate,
    d1Rows
  })

  if (format === "markdown") {
    process.stdout.write(toMarkdown(dossier))
    return
  }
  process.stdout.write(`${JSON.stringify(dossier, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
