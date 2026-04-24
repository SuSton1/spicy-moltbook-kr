import path from "node:path"

import { computeTimelinePeriods, normalizeDateKey } from "./date.mjs"
import { readJson } from "./io.mjs"

const deepMerge = (base, extra) => {
  if (Array.isArray(base) || Array.isArray(extra)) {
    return extra ?? base
  }
  if (
    base &&
    typeof base === "object" &&
    extra &&
    typeof extra === "object"
  ) {
    const out = { ...base }
    for (const key of Object.keys(extra)) {
      out[key] = deepMerge(base[key], extra[key])
    }
    return out
  }
  return extra === undefined ? base : extra
}

const hasOwn = (obj, key) =>
  !!obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key)

const validateStrictConfig = (config) => {
  const stepA = config?.lightweight?.stepA
  const duckdb = stepA?.duckdb
  const similarity = config?.similarity ?? {}
  const guardrails = config?.guardrails ?? {}
  const template = config?.template ?? {}
  const pattern = config?.pattern ?? {}
  const cdLoop = config?.cdLoop ?? {}
  const violations = []

  const legacyGuardKey = ["forbid", "Fall", "backEverywhere"].join("")
  const legacyEngineKey = ["fall", "backEngine"].join("")
  const allowLegacyKey = ["allow", "Fall", "back"].join("")
  const legacyScorerKey = ["fall", "backScorer"].join("")
  const pairwiseLegacyKey = ["fall", "backToLegacy"].join("")
  const blockLegacyEscape =
    guardrails?.forbidLegacyEscapeEverywhere ??
    guardrails?.[legacyGuardKey]

  if (blockLegacyEscape !== false) {
    if (hasOwn(stepA, legacyEngineKey)) {
      violations.push(`lightweight.stepA.${legacyEngineKey} is forbidden`)
    }
    if (hasOwn(duckdb, allowLegacyKey)) {
      violations.push(`lightweight.stepA.duckdb.${allowLegacyKey} is forbidden`)
    }
    if (hasOwn(similarity, legacyScorerKey)) {
      violations.push(`similarity.${legacyScorerKey} is forbidden`)
    }
  }

  const engine = String(stepA?.engine ?? "")
    .trim()
    .toLowerCase()
  if (engine === "auto") {
    violations.push("lightweight.stepA.engine=auto is forbidden")
  }
  if (guardrails.enforceStepAEngineDuckdb !== false && engine !== "duckdb") {
    violations.push(`lightweight.stepA.engine must be duckdb, got: ${engine || "(empty)"}`)
  }
  if (guardrails.enforceExactScorer !== false) {
    const scorerVersion = String(similarity?.scorerVersion ?? "")
      .trim()
      .toLowerCase()
    if (scorerVersion !== "v2_exact") {
      violations.push(
        `similarity.scorerVersion must be v2_exact, got: ${scorerVersion || "(empty)"}`,
      )
    }
  }
  if (guardrails.enforceHybrid15040Contracts !== false) {
    const mode = String(pattern?.mode ?? "")
      .trim()
      .toLowerCase()
    if (mode !== "hybrid_150_40") {
      violations.push(`pattern.mode must be hybrid_150_40, got: ${mode || "(empty)"}`)
    }
    const localWindow = Number(template?.localWindow ?? 40)
    const globalWindow = Number(template?.globalWindow ?? 150)
    if (!Number.isInteger(localWindow) || localWindow !== 40) {
      violations.push(`template.localWindow must be 40, got: ${template?.localWindow}`)
    }
    if (!Number.isInteger(globalWindow) || globalWindow !== 150) {
      violations.push(`template.globalWindow must be 150, got: ${template?.globalWindow}`)
    }
    if (globalWindow <= localWindow) {
      violations.push(
        `template.globalWindow must be greater than localWindow (local=${localWindow}, global=${globalWindow})`,
      )
    }
    const stageWeights = similarity?.stageWeights ?? {}
    const gw = Number(stageWeights?.global ?? NaN)
    const lw = Number(stageWeights?.local ?? NaN)
    const tw = Number(stageWeights?.trigger ?? NaN)
    if (![gw, lw, tw].every((v) => Number.isFinite(v) && v >= 0)) {
      violations.push("similarity.stageWeights(global/local/trigger) must be finite numbers >= 0")
    }
    if (!(gw > 0) || !(lw > 0)) {
      violations.push("similarity.stageWeights.global/local must be > 0 in hybrid strict mode")
    }
    if ((gw + lw + tw) <= 0) {
      violations.push("similarity.stageWeights sum must be > 0")
    }
    const coarseTopN = Number(similarity?.coarseTopN ?? NaN)
    if (!Number.isInteger(coarseTopN) || coarseTopN < 1) {
      violations.push(`similarity.coarseTopN must be integer >= 1, got: ${similarity?.coarseTopN}`)
    }
    const coarseTopClusters = Number(similarity?.coarseTopClusters ?? NaN)
    if (!Number.isInteger(coarseTopClusters) || coarseTopClusters < 1) {
      violations.push(
        `similarity.coarseTopClusters must be integer >= 1, got: ${similarity?.coarseTopClusters}`,
      )
    }
    const maxGlobalPrototypes = Number(pattern?.maxGlobalPrototypes ?? NaN)
    if (!Number.isInteger(maxGlobalPrototypes) || maxGlobalPrototypes < 1) {
      violations.push(
        `pattern.maxGlobalPrototypes must be integer >= 1, got: ${pattern?.maxGlobalPrototypes}`,
      )
    }
    const maxLocalPrototypes = Number(pattern?.maxLocalPrototypes ?? NaN)
    if (!Number.isInteger(maxLocalPrototypes) || maxLocalPrototypes < 1) {
      violations.push(
        `pattern.maxLocalPrototypes must be integer >= 1, got: ${pattern?.maxLocalPrototypes}`,
      )
    }
    const globalClusterBins = Number(pattern?.globalClusterBins ?? NaN)
    if (!Number.isInteger(globalClusterBins) || globalClusterBins < 2) {
      violations.push(`pattern.globalClusterBins must be integer >= 2, got: ${pattern?.globalClusterBins}`)
    }
    const globalClusterBinMode = String(pattern?.globalClusterBinMode ?? "adaptive")
      .trim()
      .toLowerCase()
    if (!["adaptive", "fixed"].includes(globalClusterBinMode)) {
      violations.push(
        `pattern.globalClusterBinMode must be adaptive|fixed, got: ${pattern?.globalClusterBinMode}`,
      )
    }
    const globalClusterMinBins = Number(pattern?.globalClusterMinBins ?? 3)
    const globalClusterMaxBins = Number(pattern?.globalClusterMaxBins ?? 5)
    if (!Number.isInteger(globalClusterMinBins) || globalClusterMinBins < 2) {
      violations.push(
        `pattern.globalClusterMinBins must be integer >= 2, got: ${pattern?.globalClusterMinBins}`,
      )
    }
    if (!Number.isInteger(globalClusterMaxBins) || globalClusterMaxBins < globalClusterMinBins) {
      violations.push(
        `pattern.globalClusterMaxBins must be integer >= globalClusterMinBins, got: ${pattern?.globalClusterMaxBins}`,
      )
    }
  }

  const minEpochsPerRound = Number(cdLoop?.minEpochsPerRound ?? 2)
  const maxEpochsPerRound = Number(cdLoop?.maxEpochsPerRound ?? 4)
  const plateauEpochs = Number(cdLoop?.plateauEpochs ?? 2)
  const minHitRateImprove = Number(cdLoop?.minHitRateImprove ?? 0.0015)
  const stopNoImproveRounds = Number(cdLoop?.stopNoImproveRounds ?? 2)
  const minUsageForDrop = Number(cdLoop?.minUsageForDrop ?? 12)
  const perRoundDropCapRatio = Number(cdLoop?.perRoundDropCapRatio ?? 0.25)
  const clusterMinKeep = Number(cdLoop?.clusterMinKeep ?? 2)
  const stagnationRoundsBeforeRebuildC = Number(
    cdLoop?.stagnationRoundsBeforeRebuildC ?? cdLoop?.stopNoImproveRounds ?? 2,
  )
  const finalStopNoImproveRounds = Number(cdLoop?.finalStopNoImproveRounds ?? 2)
  const inversionEnableOnStreak = Number(cdLoop?.inversion?.enableOnStreak ?? 2)
  const inversionDisableOnStreak = Number(cdLoop?.inversion?.disableOnStreak ?? 2)
  const minOnePickDaysForPromotion = Number(cdLoop?.minOnePickDaysForPromotion ?? 1)
  const minPickedCountForPromotion = Number(cdLoop?.minPickedCountForPromotion ?? 20)
  const zeroOnePickResetStreak = Number(cdLoop?.zeroOnePickResetStreak ?? 2)
  const secondPickExpectedAdvantageMargin = Number(
    cdLoop?.secondPickController?.expectedAdvantageMargin ?? 0.0025,
  )
  const secondPickExpectedOverrideMaxRatePenalty = Number(
    cdLoop?.secondPickController?.expectedOverrideMaxRatePenalty ?? 0.004,
  )
  const acceptedBaselineProbeCycleMinNoCodeProbes = Number(
    cdLoop?.acceptedBaselineProbeCycle?.minNoCodeProbesBeforePlateau ?? 2,
  )
  const acceptedBaselineProbeCycleMaxStructuralExperiments = Number(
    cdLoop?.acceptedBaselineProbeCycle?.maxStructuralExperimentsPerPlateau ?? 1,
  )
  const acceptedBaselineProbeCyclePlateauAfterNonImprovement = Number(
    cdLoop?.acceptedBaselineProbeCycle?.plateauAfterNonImprovement ?? 3,
  )
  const acceptedBaselineProbeCyclePlateauAfterStepEMissing = Number(
    cdLoop?.acceptedBaselineProbeCycle?.plateauAfterStepEMissing ?? 2,
  )
  const researchProbeCycleParentSource = String(
    cdLoop?.researchProbeCycle?.parentSource ?? "candidate_peak",
  )
    .trim()
    .toLowerCase()
  const researchProbeCycleMinNoCodeProbes = Number(
    cdLoop?.researchProbeCycle?.minNoCodeProbesBeforePlateau ?? 5,
  )
  const researchProbeCycleMaxStructuralExperiments = Number(
    cdLoop?.researchProbeCycle?.maxStructuralExperimentsPerPlateau ?? 1,
  )
  const researchProbeCyclePlateauAfterNonImprovement = Number(
    cdLoop?.researchProbeCycle?.plateauAfterNonImprovement ?? 3,
  )
  const researchProbeCyclePlateauAfterStepEMissing = Number(
    cdLoop?.researchProbeCycle?.plateauAfterStepEMissing ?? 2,
  )
  const familyPool = cdLoop?.familyPool ?? {}
  const familyPoolProductionMinD = Number(familyPool?.productionMinDTargetHitRate ?? 0.5)
  const familyPoolProductionMinE = Number(familyPool?.productionMinETargetHitRate ?? 0.5)
  const familyPoolWatchlistMinD = Number(familyPool?.watchlistMinDTargetHitRate ?? 0.4)
  const familyPoolWatchlistMinE = Number(familyPool?.watchlistMinETargetHitRate ?? 0.4)
  const familyPoolMinDPickedDays = Number(familyPool?.minDPickedDays ?? 8)
  const familyPoolMinELockboxPicks = Number(familyPool?.minELockboxPicks ?? 8)
  const familyPoolMinProductionFamilies = Number(familyPool?.minProductionFamilies ?? 1)
  const familyPoolRatioKeys = [
    ["productionMinDTargetHitRate", familyPool?.productionMinDTargetHitRate],
    ["productionMinETargetHitRate", familyPool?.productionMinETargetHitRate],
    ["watchlistMinDTargetHitRate", familyPool?.watchlistMinDTargetHitRate],
    ["watchlistMinETargetHitRate", familyPool?.watchlistMinETargetHitRate],
    ["minEraCoverageRatio", familyPool?.minEraCoverageRatio],
    ["minEntropyRatio", familyPool?.minEntropyRatio]
  ]
  if (!Number.isInteger(minEpochsPerRound) || minEpochsPerRound < 1) {
    violations.push(`cdLoop.minEpochsPerRound must be integer >= 1, got: ${cdLoop?.minEpochsPerRound}`)
  }
  if (!Number.isInteger(maxEpochsPerRound) || maxEpochsPerRound < 1) {
    violations.push(`cdLoop.maxEpochsPerRound must be integer >= 1, got: ${cdLoop?.maxEpochsPerRound}`)
  }
  if (
    Number.isInteger(minEpochsPerRound) &&
    Number.isInteger(maxEpochsPerRound) &&
    maxEpochsPerRound < minEpochsPerRound
  ) {
    violations.push("cdLoop.maxEpochsPerRound must be >= cdLoop.minEpochsPerRound")
  }
  if (!Number.isInteger(plateauEpochs) || plateauEpochs < 1) {
    violations.push(`cdLoop.plateauEpochs must be integer >= 1, got: ${cdLoop?.plateauEpochs}`)
  }
  if (!Number.isFinite(minHitRateImprove) || minHitRateImprove < 0) {
    violations.push(`cdLoop.minHitRateImprove must be finite >= 0, got: ${cdLoop?.minHitRateImprove}`)
  }
  if (!Number.isInteger(stopNoImproveRounds) || stopNoImproveRounds < 1) {
    violations.push(`cdLoop.stopNoImproveRounds must be integer >= 1, got: ${cdLoop?.stopNoImproveRounds}`)
  }
  if (!Number.isInteger(minUsageForDrop) || minUsageForDrop < 1) {
    violations.push(`cdLoop.minUsageForDrop must be integer >= 1, got: ${cdLoop?.minUsageForDrop}`)
  }
  if (!Number.isFinite(perRoundDropCapRatio) || perRoundDropCapRatio < 0 || perRoundDropCapRatio > 1) {
    violations.push(
      `cdLoop.perRoundDropCapRatio must be finite in [0,1], got: ${cdLoop?.perRoundDropCapRatio}`,
    )
  }
  if (!Number.isInteger(clusterMinKeep) || clusterMinKeep < 0) {
    violations.push(`cdLoop.clusterMinKeep must be integer >= 0, got: ${cdLoop?.clusterMinKeep}`)
  }
  if (!Number.isInteger(stagnationRoundsBeforeRebuildC) || stagnationRoundsBeforeRebuildC < 1) {
    violations.push(
      `cdLoop.stagnationRoundsBeforeRebuildC must be integer >= 1, got: ${cdLoop?.stagnationRoundsBeforeRebuildC}`,
    )
  }
  if (!Number.isInteger(finalStopNoImproveRounds) || finalStopNoImproveRounds < 1) {
    violations.push(
      `cdLoop.finalStopNoImproveRounds must be integer >= 1, got: ${cdLoop?.finalStopNoImproveRounds}`,
    )
  }
  for (const [key, raw] of familyPoolRatioKeys) {
    const value = Number(raw ?? 0)
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      violations.push(`cdLoop.familyPool.${key} must be within [0,1], got: ${raw}`)
    }
  }
  if (!Number.isFinite(familyPoolProductionMinD) || !Number.isFinite(familyPoolWatchlistMinD) || familyPoolProductionMinD < familyPoolWatchlistMinD) {
    violations.push(
      "cdLoop.familyPool.productionMinDTargetHitRate must be >= watchlistMinDTargetHitRate",
    )
  }
  if (!Number.isFinite(familyPoolProductionMinE) || !Number.isFinite(familyPoolWatchlistMinE) || familyPoolProductionMinE < familyPoolWatchlistMinE) {
    violations.push(
      "cdLoop.familyPool.productionMinETargetHitRate must be >= watchlistMinETargetHitRate",
    )
  }
  if (!Number.isInteger(familyPoolMinDPickedDays) || familyPoolMinDPickedDays < 1) {
    violations.push(
      `cdLoop.familyPool.minDPickedDays must be integer >= 1, got: ${familyPool?.minDPickedDays}`,
    )
  }
  if (!Number.isInteger(familyPoolMinELockboxPicks) || familyPoolMinELockboxPicks < 1) {
    violations.push(
      `cdLoop.familyPool.minELockboxPicks must be integer >= 1, got: ${familyPool?.minELockboxPicks}`,
    )
  }
  if (!Number.isInteger(familyPoolMinProductionFamilies) || familyPoolMinProductionFamilies < 1) {
    violations.push(
      `cdLoop.familyPool.minProductionFamilies must be integer >= 1, got: ${familyPool?.minProductionFamilies}`,
    )
  }
  if (!Number.isInteger(inversionEnableOnStreak) || inversionEnableOnStreak < 1) {
    violations.push(
      `cdLoop.inversion.enableOnStreak must be integer >= 1, got: ${cdLoop?.inversion?.enableOnStreak}`,
    )
  }
  if (!Number.isInteger(inversionDisableOnStreak) || inversionDisableOnStreak < 1) {
    violations.push(
      `cdLoop.inversion.disableOnStreak must be integer >= 1, got: ${cdLoop?.inversion?.disableOnStreak}`,
    )
  }
  if (!Number.isInteger(minOnePickDaysForPromotion) || minOnePickDaysForPromotion < 0) {
    violations.push(
      `cdLoop.minOnePickDaysForPromotion must be integer >= 0, got: ${cdLoop?.minOnePickDaysForPromotion}`,
    )
  }
  if (!Number.isInteger(minPickedCountForPromotion) || minPickedCountForPromotion < 0) {
    violations.push(
      `cdLoop.minPickedCountForPromotion must be integer >= 0, got: ${cdLoop?.minPickedCountForPromotion}`,
    )
  }
  if (!Number.isInteger(zeroOnePickResetStreak) || zeroOnePickResetStreak < 1) {
    violations.push(
      `cdLoop.zeroOnePickResetStreak must be integer >= 1, got: ${cdLoop?.zeroOnePickResetStreak}`,
    )
  }
  if (
    !Number.isFinite(secondPickExpectedAdvantageMargin) ||
    secondPickExpectedAdvantageMargin < 0
  ) {
    violations.push(
      `cdLoop.secondPickController.expectedAdvantageMargin must be finite >= 0, got: ${cdLoop?.secondPickController?.expectedAdvantageMargin}`,
    )
  }
  if (
    !Number.isFinite(secondPickExpectedOverrideMaxRatePenalty) ||
    secondPickExpectedOverrideMaxRatePenalty < 0
  ) {
    violations.push(
      `cdLoop.secondPickController.expectedOverrideMaxRatePenalty must be finite >= 0, got: ${cdLoop?.secondPickController?.expectedOverrideMaxRatePenalty}`,
    )
  }
  if (
    !Number.isInteger(acceptedBaselineProbeCycleMaxStructuralExperiments) ||
    acceptedBaselineProbeCycleMaxStructuralExperiments < 1
  ) {
    violations.push(
      `cdLoop.acceptedBaselineProbeCycle.maxStructuralExperimentsPerPlateau must be integer >= 1, got: ${cdLoop?.acceptedBaselineProbeCycle?.maxStructuralExperimentsPerPlateau}`,
    )
  }
  if (
    !Number.isInteger(acceptedBaselineProbeCycleMinNoCodeProbes) ||
    acceptedBaselineProbeCycleMinNoCodeProbes < 1
  ) {
    violations.push(
      `cdLoop.acceptedBaselineProbeCycle.minNoCodeProbesBeforePlateau must be integer >= 1, got: ${cdLoop?.acceptedBaselineProbeCycle?.minNoCodeProbesBeforePlateau}`,
    )
  }
  if (
    !Number.isInteger(acceptedBaselineProbeCyclePlateauAfterNonImprovement) ||
    acceptedBaselineProbeCyclePlateauAfterNonImprovement < 1
  ) {
    violations.push(
      `cdLoop.acceptedBaselineProbeCycle.plateauAfterNonImprovement must be integer >= 1, got: ${cdLoop?.acceptedBaselineProbeCycle?.plateauAfterNonImprovement}`,
    )
  }
  if (
    !Number.isInteger(acceptedBaselineProbeCyclePlateauAfterStepEMissing) ||
    acceptedBaselineProbeCyclePlateauAfterStepEMissing < 1
  ) {
    violations.push(
      `cdLoop.acceptedBaselineProbeCycle.plateauAfterStepEMissing must be integer >= 1, got: ${cdLoop?.acceptedBaselineProbeCycle?.plateauAfterStepEMissing}`,
    )
  }
  if (researchProbeCycleParentSource !== "candidate_peak") {
    violations.push(
      `cdLoop.researchProbeCycle.parentSource must be candidate_peak, got: ${cdLoop?.researchProbeCycle?.parentSource}`,
    )
  }
  if (
    !Number.isInteger(researchProbeCycleMaxStructuralExperiments) ||
    researchProbeCycleMaxStructuralExperiments < 1
  ) {
    violations.push(
      `cdLoop.researchProbeCycle.maxStructuralExperimentsPerPlateau must be integer >= 1, got: ${cdLoop?.researchProbeCycle?.maxStructuralExperimentsPerPlateau}`,
    )
  }
  if (
    !Number.isInteger(researchProbeCycleMinNoCodeProbes) ||
    researchProbeCycleMinNoCodeProbes < 1
  ) {
    violations.push(
      `cdLoop.researchProbeCycle.minNoCodeProbesBeforePlateau must be integer >= 1, got: ${cdLoop?.researchProbeCycle?.minNoCodeProbesBeforePlateau}`,
    )
  }
  if (
    !Number.isInteger(researchProbeCyclePlateauAfterNonImprovement) ||
    researchProbeCyclePlateauAfterNonImprovement < 1
  ) {
    violations.push(
      `cdLoop.researchProbeCycle.plateauAfterNonImprovement must be integer >= 1, got: ${cdLoop?.researchProbeCycle?.plateauAfterNonImprovement}`,
    )
  }
  if (
    !Number.isInteger(researchProbeCyclePlateauAfterStepEMissing) ||
    researchProbeCyclePlateauAfterStepEMissing < 1
  ) {
    violations.push(
      `cdLoop.researchProbeCycle.plateauAfterStepEMissing must be integer >= 1, got: ${cdLoop?.researchProbeCycle?.plateauAfterStepEMissing}`,
    )
  }

  const maxPicksPerDay = Number(config?.decisionGate?.maxPicksPerDay ?? 1)
  const hitWindowDays = Number(config?.decisionGate?.hitWindowDays ?? 3)
  const minScoreMargin = Number(config?.decisionGate?.minScoreMargin ?? 0)
  const maxScoreMarginRaw = config?.decisionGate?.maxScoreMargin
  const hasMaxScoreMargin = maxScoreMarginRaw !== undefined && maxScoreMarginRaw !== null
  const maxScoreMargin = hasMaxScoreMargin ? Number(maxScoreMarginRaw) : null
  const similarityTopK = Number(config?.similarity?.topK ?? 10)
  const top1RerankCandidatePool = Number(config?.decisionGate?.top1Rerank?.candidatePool ?? 10)
  const sampledDebugTopK = Number(config?.lightweight?.stepD?.sampledDebugLog?.topK ?? 10)
  const scoreRecovery = config?.decisionGate?.scoreRecovery ?? {}
  const scoreRecoveryMode = String(scoreRecovery?.mode ?? "off").trim().toLowerCase()
  const scoreRecoveryAllowedGateReasonsRaw = scoreRecovery?.allowedGateReasons
  const scoreRecoveryAllowedGateReasons = Array.isArray(scoreRecoveryAllowedGateReasonsRaw)
    ? scoreRecoveryAllowedGateReasonsRaw
    : []
  const scoreRecoveryPathGuards = scoreRecovery?.pathGuards ?? {}
  const scoreRecalibration = config?.decisionGate?.scoreRecalibration ?? {}
  const scoreRecalibrationMode = String(scoreRecalibration?.mode ?? "off").trim().toLowerCase()
  const perfectPrototypeGate = config?.decisionGate?.perfectPrototypeGate ?? {}
  const perfectPrototypeGateMode = String(perfectPrototypeGate?.mode ?? "off").trim().toLowerCase()
  const perfectPrototypeGateSelectionMode = String(
    perfectPrototypeGate?.selectionMode ?? "champion_only",
  )
    .trim()
    .toLowerCase()
  const scoreRecalibrationAllowedPrimaryComponentsRaw = scoreRecalibration?.allowedPrimaryComponents
  const scoreRecalibrationAllowedPrimaryComponents = Array.isArray(
    scoreRecalibrationAllowedPrimaryComponentsRaw,
  )
    ? scoreRecalibrationAllowedPrimaryComponentsRaw
    : []
  const scoreRecalibrationAllowedPrimarySubcomponentsRaw =
    scoreRecalibration?.allowedPrimarySubcomponents
  const scoreRecalibrationAllowedPrimarySubcomponents = Array.isArray(
    scoreRecalibrationAllowedPrimarySubcomponentsRaw,
  )
    ? scoreRecalibrationAllowedPrimarySubcomponentsRaw
    : []
  const scoreRecalibrationPenaltyCapsRaw =
    scoreRecalibration?.maxPenaltyCapByComponent && typeof scoreRecalibration.maxPenaltyCapByComponent === "object"
      ? scoreRecalibration.maxPenaltyCapByComponent
      : null
  const scoreRecalibrationPenaltySubCapsRaw =
    scoreRecalibration?.maxPenaltyCapBySubcomponent &&
    typeof scoreRecalibration.maxPenaltyCapBySubcomponent === "object"
      ? scoreRecalibration.maxPenaltyCapBySubcomponent
      : null
  const scoreRecalibrationSubcomponentPoliciesRaw =
    scoreRecalibration?.subcomponentPolicies &&
    typeof scoreRecalibration.subcomponentPolicies === "object" &&
    !Array.isArray(scoreRecalibration.subcomponentPolicies)
      ? scoreRecalibration.subcomponentPolicies
      : null
  const scoreRecalibrationEraSupportReasonPoliciesRaw =
    scoreRecalibration?.eraSupportReasonPolicies &&
    typeof scoreRecalibration.eraSupportReasonPolicies === "object" &&
    !Array.isArray(scoreRecalibration.eraSupportReasonPolicies)
      ? scoreRecalibration.eraSupportReasonPolicies
      : null
  if (!Number.isInteger(maxPicksPerDay) || (maxPicksPerDay !== 1 && maxPicksPerDay !== 2)) {
    violations.push(
      `decisionGate.maxPicksPerDay must be 1 or 2, got: ${config?.decisionGate?.maxPicksPerDay}`,
    )
  }
  if (!Number.isFinite(similarityTopK) || similarityTopK < 10) {
    violations.push(`similarity.topK must be finite >= 10, got: ${config?.similarity?.topK}`)
  }
  if (!Number.isFinite(top1RerankCandidatePool) || top1RerankCandidatePool < 10) {
    violations.push(
      `decisionGate.top1Rerank.candidatePool must be finite >= 10, got: ${config?.decisionGate?.top1Rerank?.candidatePool}`,
    )
  }
  if (!["off", "shadow", "hard"].includes(scoreRecoveryMode)) {
    violations.push(
      `decisionGate.scoreRecovery.mode must be one of off|shadow|hard, got: ${scoreRecovery?.mode}`,
    )
  }
  if (!["off", "shadow", "hard"].includes(scoreRecalibrationMode)) {
    violations.push(
      `decisionGate.scoreRecalibration.mode must be one of off|shadow|hard, got: ${scoreRecalibration?.mode}`,
    )
  }
  if (!["off", "annotate", "hard"].includes(perfectPrototypeGateMode)) {
    violations.push(
      `decisionGate.perfectPrototypeGate.mode must be one of off|annotate|hard, got: ${perfectPrototypeGate?.mode}`,
    )
  }
  if (!["champion_only", "union_all"].includes(perfectPrototypeGateSelectionMode)) {
    violations.push(
      `decisionGate.perfectPrototypeGate.selectionMode must be one of champion_only|union_all, got: ${perfectPrototypeGate?.selectionMode}`,
    )
  }
  if (
    perfectPrototypeGate?.catalogPath !== undefined &&
    perfectPrototypeGate?.catalogPath !== null &&
    String(perfectPrototypeGate.catalogPath ?? "").trim().length < 1 &&
    (perfectPrototypeGate?.enabled === true ||
      perfectPrototypeGateMode === "annotate" ||
      perfectPrototypeGateMode === "hard")
  ) {
    violations.push("decisionGate.perfectPrototypeGate.catalogPath must be a non-empty string when set")
  }
  if (
    (perfectPrototypeGate?.enabled === true ||
      perfectPrototypeGateMode === "annotate" ||
      perfectPrototypeGateMode === "hard") &&
    String(perfectPrototypeGate?.catalogPath ?? "").trim().length < 1
  ) {
    violations.push(
      "decisionGate.perfectPrototypeGate.catalogPath is required when perfectPrototypeGate is enabled",
    )
  }
  if (
    perfectPrototypeGate?.maxRulesPerSymbol !== undefined &&
    perfectPrototypeGate?.maxRulesPerSymbol !== null
  ) {
    const maxRulesPerSymbol = Number(perfectPrototypeGate.maxRulesPerSymbol)
    if (!Number.isInteger(maxRulesPerSymbol) || maxRulesPerSymbol < 1) {
      violations.push(
        `decisionGate.perfectPrototypeGate.maxRulesPerSymbol must be integer >= 1 when set, got: ${perfectPrototypeGate?.maxRulesPerSymbol}`,
      )
    }
  }
  if (
    perfectPrototypeGate?.expectedCatalogSha256 !== undefined &&
    perfectPrototypeGate?.expectedCatalogSha256 !== null
  ) {
    const expectedCatalogSha256 = String(perfectPrototypeGate.expectedCatalogSha256 ?? "").trim()
    if (expectedCatalogSha256 && !/^[0-9a-f]{64}$/i.test(expectedCatalogSha256)) {
      violations.push(
        `decisionGate.perfectPrototypeGate.expectedCatalogSha256 must be a 64-char sha256 hex string when set, got: ${perfectPrototypeGate?.expectedCatalogSha256}`,
      )
    }
  }
  if (
    perfectPrototypeGate?.expectedRuleIdsSha256 !== undefined &&
    perfectPrototypeGate?.expectedRuleIdsSha256 !== null
  ) {
    const expectedRuleIdsSha256 = String(perfectPrototypeGate.expectedRuleIdsSha256 ?? "").trim()
    if (expectedRuleIdsSha256 && !/^[0-9a-f]{64}$/i.test(expectedRuleIdsSha256)) {
      violations.push(
        `decisionGate.perfectPrototypeGate.expectedRuleIdsSha256 must be a 64-char sha256 hex string when set, got: ${perfectPrototypeGate?.expectedRuleIdsSha256}`,
      )
    }
  }
  if (
    perfectPrototypeGate?.enabled === true ||
    perfectPrototypeGateMode === "annotate" ||
    perfectPrototypeGateMode === "hard"
  ) {
    const expectedCatalogSha256 = String(perfectPrototypeGate?.expectedCatalogSha256 ?? "").trim()
    const expectedRuleIdsSha256 = String(perfectPrototypeGate?.expectedRuleIdsSha256 ?? "").trim()
    if (!expectedCatalogSha256) {
      violations.push(
        "decisionGate.perfectPrototypeGate.expectedCatalogSha256 is required when perfectPrototypeGate is enabled",
      )
    }
    if (!expectedRuleIdsSha256) {
      violations.push(
        "decisionGate.perfectPrototypeGate.expectedRuleIdsSha256 is required when perfectPrototypeGate is enabled",
      )
    }
  }
  if (
    perfectPrototypeGate?.dedupeSymbolsPerDay !== undefined &&
    perfectPrototypeGate?.dedupeSymbolsPerDay !== null &&
    typeof perfectPrototypeGate.dedupeSymbolsPerDay !== "boolean"
  ) {
    violations.push("decisionGate.perfectPrototypeGate.dedupeSymbolsPerDay must be boolean when set")
  }
  if (
    scoreRecoveryAllowedGateReasonsRaw !== undefined &&
    scoreRecoveryAllowedGateReasonsRaw !== null &&
    !Array.isArray(scoreRecoveryAllowedGateReasonsRaw)
  ) {
    violations.push("decisionGate.scoreRecovery.allowedGateReasons must be an array when set")
  } else {
    const invalid = scoreRecoveryAllowedGateReasons
      .map((value) => String(value ?? "").trim().toUpperCase())
      .filter((value) => !["SCORE_BELOW_MIN", "SCORE_MARGIN_LOW", "POLICY_TAU_RANK_LOW"].includes(value))
    if (invalid.length > 0) {
      violations.push(
        `decisionGate.scoreRecovery.allowedGateReasons contains invalid values: ${invalid.join(", ")}`,
      )
    }
  }
  for (const [key, raw] of Object.entries({
    allowedRuleDayTypes: scoreRecoveryPathGuards?.allowedRuleDayTypes,
    allowedDayTypes: scoreRecoveryPathGuards?.allowedDayTypes,
    allowedPolicySources: scoreRecoveryPathGuards?.allowedPolicySources
  })) {
    if (raw === undefined || raw === null) continue
    if (!Array.isArray(raw)) {
      violations.push(`decisionGate.scoreRecovery.pathGuards.${key} must be an array when set`)
      continue
    }
    if (raw.some((value) => String(value ?? "").trim().length < 1)) {
      violations.push(
        `decisionGate.scoreRecovery.pathGuards.${key} must contain only non-empty strings when set`,
      )
    }
  }
  if (
    scoreRecalibrationAllowedPrimaryComponentsRaw !== undefined &&
    scoreRecalibrationAllowedPrimaryComponentsRaw !== null &&
    !Array.isArray(scoreRecalibrationAllowedPrimaryComponentsRaw)
  ) {
    violations.push("decisionGate.scoreRecalibration.allowedPrimaryComponents must be an array when set")
  } else {
    const invalid = scoreRecalibrationAllowedPrimaryComponents
      .map((value) => String(value ?? "").trim().toUpperCase())
      .filter((value) => ![
        "POST_ADJUST_HEAVY",
        "REGIME_EXPERT_HEAVY",
        "EXTENDED_BIAS_HEAVY",
        "TRADE_QUALITY_HEAVY",
        "EXECUTION_PRIOR_HEAVY",
        "MIXED_DEEP_FAIL"
      ].includes(value))
    if (invalid.length > 0) {
      violations.push(
        `decisionGate.scoreRecalibration.allowedPrimaryComponents contains invalid values: ${invalid.join(", ")}`,
      )
    }
  }
  if (
    scoreRecalibrationAllowedPrimarySubcomponentsRaw !== undefined &&
    scoreRecalibrationAllowedPrimarySubcomponentsRaw !== null &&
    !Array.isArray(scoreRecalibrationAllowedPrimarySubcomponentsRaw)
  ) {
    violations.push("decisionGate.scoreRecalibration.allowedPrimarySubcomponents must be an array when set")
  } else {
    const invalid = scoreRecalibrationAllowedPrimarySubcomponents
      .map((value) => String(value ?? "").trim().toUpperCase())
      .filter((value) => ![
        "STOP_RATE_PENALTY",
        "ANTI_PENALTY",
        "SINGLE_ERA_PENALTY",
        "SINGLE_ERA_CONCENTRATION_PENALTY",
        "LOW_ERA_SUPPORT_PENALTY",
        "SUPPORT_COUNT_PENALTY",
        "ERA_COVERAGE_PENALTY",
        "REGIME_MULTIPLIER_PENALTY",
        "EXTENDED_BIAS_PENALTY",
        "TRADE_QUALITY_RANKER_ADJUSTMENT",
        "TRADE_QUALITY_ROUTE_RESIDUAL",
        "TRADE_QUALITY_REGIME_RESIDUAL",
        "TRADE_QUALITY_PROTOTYPE_RESIDUAL",
        "TRADE_QUALITY_TOTAL_FALLBACK",
        "LOW_FILL_PENALTY",
        "SLIPPAGE_PENALTY",
        "LOW_LIQUIDITY_PENALTY",
        "BLOCKED_ORDER_PENALTY",
        "NEGATIVE_AFTER_COST_PENALTY"
      ].includes(value))
    if (invalid.length > 0) {
      violations.push(
        `decisionGate.scoreRecalibration.allowedPrimarySubcomponents contains invalid values: ${invalid.join(", ")}`,
      )
    }
  }
  if (
    scoreRecalibration?.maxPenaltyCapByComponent !== undefined &&
    scoreRecalibration?.maxPenaltyCapByComponent !== null &&
    (
      !scoreRecalibrationPenaltyCapsRaw ||
      typeof scoreRecalibrationPenaltyCapsRaw !== "object" ||
      Array.isArray(scoreRecalibrationPenaltyCapsRaw)
    )
  ) {
    violations.push("decisionGate.scoreRecalibration.maxPenaltyCapByComponent must be an object when set")
  } else if (scoreRecalibrationPenaltyCapsRaw) {
    const invalidKeys = Object.keys(scoreRecalibrationPenaltyCapsRaw)
      .map((key) => String(key ?? "").trim().toUpperCase())
      .filter((key) => ![
        "POST_ADJUST_HEAVY",
        "REGIME_EXPERT_HEAVY",
        "EXTENDED_BIAS_HEAVY",
        "TRADE_QUALITY_HEAVY",
        "EXECUTION_PRIOR_HEAVY",
        "MIXED_DEEP_FAIL"
      ].includes(key))
    if (invalidKeys.length > 0) {
      violations.push(
        `decisionGate.scoreRecalibration.maxPenaltyCapByComponent contains invalid keys: ${invalidKeys.join(", ")}`,
      )
    }
    for (const [key, raw] of Object.entries(scoreRecalibrationPenaltyCapsRaw)) {
      if (!Number.isFinite(Number(raw)) || Number(raw) < 0) {
        violations.push(
          `decisionGate.scoreRecalibration.maxPenaltyCapByComponent.${key} must be finite >= 0, got: ${raw}`,
        )
      }
    }
  }
  if (
    scoreRecalibration?.maxPenaltyCapBySubcomponent !== undefined &&
    scoreRecalibration?.maxPenaltyCapBySubcomponent !== null &&
    (
      !scoreRecalibrationPenaltySubCapsRaw ||
      typeof scoreRecalibrationPenaltySubCapsRaw !== "object" ||
      Array.isArray(scoreRecalibrationPenaltySubCapsRaw)
    )
  ) {
    violations.push("decisionGate.scoreRecalibration.maxPenaltyCapBySubcomponent must be an object when set")
  } else if (scoreRecalibrationPenaltySubCapsRaw) {
    const invalidKeys = Object.keys(scoreRecalibrationPenaltySubCapsRaw)
      .map((key) => String(key ?? "").trim().toUpperCase())
      .filter((key) => ![
        "STOP_RATE_PENALTY",
        "ANTI_PENALTY",
        "SINGLE_ERA_PENALTY",
        "SINGLE_ERA_CONCENTRATION_PENALTY",
        "LOW_ERA_SUPPORT_PENALTY",
        "SUPPORT_COUNT_PENALTY",
        "ERA_COVERAGE_PENALTY",
        "REGIME_MULTIPLIER_PENALTY",
        "EXTENDED_BIAS_PENALTY",
        "TRADE_QUALITY_RANKER_ADJUSTMENT",
        "TRADE_QUALITY_ROUTE_RESIDUAL",
        "TRADE_QUALITY_REGIME_RESIDUAL",
        "TRADE_QUALITY_PROTOTYPE_RESIDUAL",
        "TRADE_QUALITY_TOTAL_FALLBACK",
        "LOW_FILL_PENALTY",
        "SLIPPAGE_PENALTY",
        "LOW_LIQUIDITY_PENALTY",
        "BLOCKED_ORDER_PENALTY",
        "NEGATIVE_AFTER_COST_PENALTY"
      ].includes(key))
    if (invalidKeys.length > 0) {
      violations.push(
        `decisionGate.scoreRecalibration.maxPenaltyCapBySubcomponent contains invalid keys: ${invalidKeys.join(", ")}`,
      )
    }
    for (const [key, raw] of Object.entries(scoreRecalibrationPenaltySubCapsRaw)) {
      if (!Number.isFinite(Number(raw)) || Number(raw) < 0) {
        violations.push(
          `decisionGate.scoreRecalibration.maxPenaltyCapBySubcomponent.${key} must be finite >= 0, got: ${raw}`,
        )
      }
    }
  }
  if (
    scoreRecalibration?.subcomponentPolicies !== undefined &&
    scoreRecalibration?.subcomponentPolicies !== null &&
    (
      !scoreRecalibrationSubcomponentPoliciesRaw ||
      typeof scoreRecalibrationSubcomponentPoliciesRaw !== "object" ||
      Array.isArray(scoreRecalibrationSubcomponentPoliciesRaw)
    )
  ) {
    violations.push("decisionGate.scoreRecalibration.subcomponentPolicies must be an object when set")
  } else if (scoreRecalibrationSubcomponentPoliciesRaw) {
    const invalidKeys = Object.keys(scoreRecalibrationSubcomponentPoliciesRaw)
      .map((key) => String(key ?? "").trim().toUpperCase())
      .filter((key) => ![
        "STOP_RATE_PENALTY",
        "ANTI_PENALTY",
        "SINGLE_ERA_PENALTY",
        "SINGLE_ERA_CONCENTRATION_PENALTY",
        "LOW_ERA_SUPPORT_PENALTY",
        "SUPPORT_COUNT_PENALTY",
        "ERA_COVERAGE_PENALTY",
        "REGIME_MULTIPLIER_PENALTY",
        "EXTENDED_BIAS_PENALTY",
        "TRADE_QUALITY_RANKER_ADJUSTMENT",
        "TRADE_QUALITY_ROUTE_RESIDUAL",
        "TRADE_QUALITY_REGIME_RESIDUAL",
        "TRADE_QUALITY_PROTOTYPE_RESIDUAL",
        "TRADE_QUALITY_TOTAL_FALLBACK",
        "LOW_FILL_PENALTY",
        "SLIPPAGE_PENALTY",
        "LOW_LIQUIDITY_PENALTY",
        "BLOCKED_ORDER_PENALTY",
        "NEGATIVE_AFTER_COST_PENALTY"
      ].includes(key))
    if (invalidKeys.length > 0) {
      violations.push(
        `decisionGate.scoreRecalibration.subcomponentPolicies contains invalid keys: ${invalidKeys.join(", ")}`,
      )
    }
    for (const [key, rawPolicy] of Object.entries(scoreRecalibrationSubcomponentPoliciesRaw)) {
      if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) {
        violations.push(`decisionGate.scoreRecalibration.subcomponentPolicies.${key} must be an object`)
        continue
      }
      for (const [field, raw] of [
        ["maxPenaltyCap", rawPolicy?.maxPenaltyCap],
        ["requireMaxEraSupportShortfall", rawPolicy?.requireMaxEraSupportShortfall]
      ]) {
        if (raw !== undefined && raw !== null && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) {
          violations.push(
            `decisionGate.scoreRecalibration.subcomponentPolicies.${key}.${field} must be finite >= 0, got: ${raw}`,
          )
        }
      }
      for (const [field, raw] of [
        ["requireMinEraCoverageRatio", rawPolicy?.requireMinEraCoverageRatio],
        ["requireMinEffectiveEraCountRatio", rawPolicy?.requireMinEffectiveEraCountRatio],
        ["requireMinEntropyRatio", rawPolicy?.requireMinEntropyRatio],
        ["requireMaxSingleEraShareExcess", rawPolicy?.requireMaxSingleEraShareExcess],
        ["requireMinFillProb", rawPolicy?.requireMinFillProb]
      ]) {
        if (raw !== undefined && raw !== null) {
          const value = Number(raw)
          if (!Number.isFinite(value) || value < 0 || value > 1) {
            violations.push(
              `decisionGate.scoreRecalibration.subcomponentPolicies.${key}.${field} must be within [0,1], got: ${raw}`,
            )
          }
        }
      }
      if (
        rawPolicy?.requireMinEraSupportCount !== undefined &&
        rawPolicy?.requireMinEraSupportCount !== null &&
        (
          !Number.isFinite(Number(rawPolicy.requireMinEraSupportCount)) ||
          Number(rawPolicy.requireMinEraSupportCount) < 0
        )
      ) {
        violations.push(
          `decisionGate.scoreRecalibration.subcomponentPolicies.${key}.requireMinEraSupportCount must be finite >= 0, got: ${rawPolicy.requireMinEraSupportCount}`,
        )
      }
      if (
        rawPolicy?.allowedSecondarySubcomponents !== undefined &&
        rawPolicy?.allowedSecondarySubcomponents !== null &&
        !Array.isArray(rawPolicy.allowedSecondarySubcomponents)
      ) {
        violations.push(
          `decisionGate.scoreRecalibration.subcomponentPolicies.${key}.allowedSecondarySubcomponents must be an array when set`,
        )
      } else {
        const invalidSecondary = (Array.isArray(rawPolicy?.allowedSecondarySubcomponents)
          ? rawPolicy.allowedSecondarySubcomponents
          : []
        )
          .map((value) => String(value ?? "").trim().toUpperCase())
          .filter((value) => ![
            "STOP_RATE_PENALTY",
            "ANTI_PENALTY",
            "SINGLE_ERA_PENALTY",
            "SINGLE_ERA_CONCENTRATION_PENALTY",
            "LOW_ERA_SUPPORT_PENALTY",
            "SUPPORT_COUNT_PENALTY",
            "ERA_COVERAGE_PENALTY",
            "REGIME_MULTIPLIER_PENALTY",
            "EXTENDED_BIAS_PENALTY",
            "TRADE_QUALITY_RANKER_ADJUSTMENT",
            "TRADE_QUALITY_ROUTE_RESIDUAL",
            "TRADE_QUALITY_REGIME_RESIDUAL",
            "TRADE_QUALITY_PROTOTYPE_RESIDUAL",
            "TRADE_QUALITY_TOTAL_FALLBACK",
            "LOW_FILL_PENALTY",
            "SLIPPAGE_PENALTY",
            "LOW_LIQUIDITY_PENALTY",
            "BLOCKED_ORDER_PENALTY",
            "NEGATIVE_AFTER_COST_PENALTY"
          ].includes(value))
        if (invalidSecondary.length > 0) {
          violations.push(
            `decisionGate.scoreRecalibration.subcomponentPolicies.${key}.allowedSecondarySubcomponents contains invalid values: ${invalidSecondary.join(", ")}`,
          )
        }
      }
    }
  }
  if (
    scoreRecalibration?.eraSupportReasonPolicies !== undefined &&
    scoreRecalibration?.eraSupportReasonPolicies !== null &&
    (
      !scoreRecalibrationEraSupportReasonPoliciesRaw ||
      typeof scoreRecalibrationEraSupportReasonPoliciesRaw !== "object" ||
      Array.isArray(scoreRecalibrationEraSupportReasonPoliciesRaw)
    )
  ) {
    violations.push("decisionGate.scoreRecalibration.eraSupportReasonPolicies must be an object when set")
  } else if (scoreRecalibrationEraSupportReasonPoliciesRaw) {
    const invalidKeys = Object.keys(scoreRecalibrationEraSupportReasonPoliciesRaw)
      .map((key) => String(key ?? "").trim().toUpperCase())
      .filter((key) => !["LOW_SUPPORT_COUNT", "LOW_ERA_COVERAGE", "SINGLE_ERA_DOMINANCE"].includes(key))
    if (invalidKeys.length > 0) {
      violations.push(
        `decisionGate.scoreRecalibration.eraSupportReasonPolicies contains invalid keys: ${invalidKeys.join(", ")}`,
      )
    }
    for (const [key, rawPolicy] of Object.entries(scoreRecalibrationEraSupportReasonPoliciesRaw)) {
      if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) {
        violations.push(`decisionGate.scoreRecalibration.eraSupportReasonPolicies.${key} must be an object`)
        continue
      }
      for (const [field, raw] of [["maxPenaltyCap", rawPolicy?.maxPenaltyCap]]) {
        if (raw !== undefined && raw !== null && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) {
          violations.push(
            `decisionGate.scoreRecalibration.eraSupportReasonPolicies.${key}.${field} must be finite >= 0, got: ${raw}`,
          )
        }
      }
      for (const [field, raw] of [
        ["requireMinEraCoverageRatio", rawPolicy?.requireMinEraCoverageRatio],
        ["requireMaxSingleEraShareExcess", rawPolicy?.requireMaxSingleEraShareExcess],
        ["requireMinFillProb", rawPolicy?.requireMinFillProb]
      ]) {
        if (raw !== undefined && raw !== null) {
          const value = Number(raw)
          if (!Number.isFinite(value) || value < 0 || value > 1) {
            violations.push(
              `decisionGate.scoreRecalibration.eraSupportReasonPolicies.${key}.${field} must be within [0,1], got: ${raw}`,
            )
          }
        }
      }
      if (
        rawPolicy?.requireMinEffectiveEraCount !== undefined &&
        rawPolicy?.requireMinEffectiveEraCount !== null
      ) {
        const value = Number(rawPolicy.requireMinEffectiveEraCount)
        if (!Number.isFinite(value) || value < 0) {
          violations.push(
            `decisionGate.scoreRecalibration.eraSupportReasonPolicies.${key}.requireMinEffectiveEraCount must be finite >= 0, got: ${rawPolicy.requireMinEffectiveEraCount}`,
          )
        }
      }
      if (
        rawPolicy?.allowedCompositeTypes !== undefined &&
        rawPolicy?.allowedCompositeTypes !== null &&
        !Array.isArray(rawPolicy.allowedCompositeTypes)
      ) {
        violations.push(
          `decisionGate.scoreRecalibration.eraSupportReasonPolicies.${key}.allowedCompositeTypes must be an array when set`,
        )
      } else {
        const invalidCompositeTypes = (Array.isArray(rawPolicy?.allowedCompositeTypes)
          ? rawPolicy.allowedCompositeTypes
          : []
        )
          .map((value) => String(value ?? "").trim().toUpperCase())
          .filter((value) => ![
            "ERA_SUPPORT_ONLY",
            "ERA_SUPPORT_PLUS_STOP_RATE",
            "ERA_SUPPORT_PLUS_SLIPPAGE",
            "ERA_SUPPORT_PLUS_REGIME",
            "ERA_SUPPORT_PLUS_OTHER"
          ].includes(value))
        if (invalidCompositeTypes.length > 0) {
          violations.push(
            `decisionGate.scoreRecalibration.eraSupportReasonPolicies.${key}.allowedCompositeTypes contains invalid values: ${invalidCompositeTypes.join(", ")}`,
          )
        }
      }
    }
  }
  if (!Number.isFinite(sampledDebugTopK) || sampledDebugTopK < 10) {
    violations.push(
      `lightweight.stepD.sampledDebugLog.topK must be finite >= 10, got: ${config?.lightweight?.stepD?.sampledDebugLog?.topK}`,
    )
  }
  if (!Number.isFinite(minScoreMargin) || minScoreMargin < 0) {
    violations.push(
      `decisionGate.minScoreMargin must be finite >= 0, got: ${config?.decisionGate?.minScoreMargin}`,
    )
  }
  if (hasMaxScoreMargin && (!Number.isFinite(maxScoreMargin) || maxScoreMargin < 0)) {
    violations.push(
      `decisionGate.maxScoreMargin must be finite >= 0 when set, got: ${config?.decisionGate?.maxScoreMargin}`,
    )
  }
  if (hasMaxScoreMargin && Number.isFinite(minScoreMargin) && Number.isFinite(maxScoreMargin) && minScoreMargin > maxScoreMargin) {
    violations.push(
      `decisionGate.maxScoreMargin must be >= decisionGate.minScoreMargin (min=${minScoreMargin}, max=${maxScoreMargin})`,
    )
  }
  if (!Number.isInteger(hitWindowDays) || hitWindowDays < 1) {
    violations.push(
      `decisionGate.hitWindowDays must be integer >= 1, got: ${config?.decisionGate?.hitWindowDays}`,
    )
  }
  for (const [key, raw] of [
    ["maxFinalScoreShortfall", scoreRecovery?.maxFinalScoreShortfall],
    ["maxScoreMarginShortfall", scoreRecovery?.maxScoreMarginShortfall],
    ["pathGuards.maxAvgSlippageRisk", scoreRecoveryPathGuards?.maxAvgSlippageRisk]
  ]) {
    if (raw !== undefined && raw !== null && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) {
      violations.push(`decisionGate.scoreRecovery.${key} must be finite >= 0 when set, got: ${raw}`)
    }
  }
  for (const [key, raw] of [
    ["baseScoreFloor", scoreRecalibration?.baseScoreFloor]
  ]) {
    if (raw !== undefined && raw !== null) {
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        violations.push(`decisionGate.scoreRecalibration.${key} must be within [0,1] when set, got: ${raw}`)
      }
    }
  }
  for (const [key, raw] of [
    ["minRawSimilarity", scoreRecovery?.minRawSimilarity],
    ["minLocalStageScore", scoreRecovery?.minLocalStageScore],
    ["maxFalsePositiveRisk", scoreRecovery?.maxFalsePositiveRisk],
    ["minFillProb", scoreRecovery?.minFillProb]
  ]) {
    if (raw !== undefined && raw !== null) {
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        violations.push(`decisionGate.scoreRecovery.${key} must be within [0,1] when set, got: ${raw}`)
      }
    }
  }
  for (const [key, raw] of [
    ["minRawSimilarity", scoreRecalibration?.minRawSimilarity],
    ["minLocalStageScore", scoreRecalibration?.minLocalStageScore],
    ["minFillProb", scoreRecalibration?.minFillProb]
  ]) {
    if (raw !== undefined && raw !== null) {
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        violations.push(`decisionGate.scoreRecalibration.${key} must be within [0,1] when set, got: ${raw}`)
      }
    }
  }
  const hitEvalStopLossPct = Number(config?.decisionGate?.hitEval?.stopLossPct ?? 0.04)
  const hitEvalSameDayTiePolicy = String(
    config?.decisionGate?.hitEval?.sameDayTiePolicy ?? "STOP_WINS",
  )
    .trim()
    .toUpperCase()
  if (!Number.isFinite(hitEvalStopLossPct) || hitEvalStopLossPct < 0 || hitEvalStopLossPct >= 1) {
    violations.push(
      `decisionGate.hitEval.stopLossPct must be finite in [0,1), got: ${config?.decisionGate?.hitEval?.stopLossPct}`,
    )
  }
  if (hitEvalSameDayTiePolicy !== "STOP_WINS" && hitEvalSameDayTiePolicy !== "HIT_WINS") {
    violations.push(
      `decisionGate.hitEval.sameDayTiePolicy must be STOP_WINS or HIT_WINS, got: ${config?.decisionGate?.hitEval?.sameDayTiePolicy}`,
    )
  }
  const inversionMaxSwapMargin = Number(config?.decisionGate?.inversionAdjust?.maxSwapMargin ?? 0.02)
  const inversionSecondBoost = Number(config?.decisionGate?.inversionAdjust?.secondBoost ?? 0)
  const inversionQualityWeight = Number(config?.decisionGate?.inversionAdjust?.qualityWeight ?? 0.04)
  if (!Number.isFinite(inversionMaxSwapMargin) || inversionMaxSwapMargin < 0) {
    violations.push(
      `decisionGate.inversionAdjust.maxSwapMargin must be finite >= 0, got: ${config?.decisionGate?.inversionAdjust?.maxSwapMargin}`,
    )
  }
  if (!Number.isFinite(inversionSecondBoost) || inversionSecondBoost < 0) {
    violations.push(
      `decisionGate.inversionAdjust.secondBoost must be finite >= 0, got: ${config?.decisionGate?.inversionAdjust?.secondBoost}`,
    )
  }
  if (!Number.isFinite(inversionQualityWeight) || inversionQualityWeight < 0) {
    violations.push(
      `decisionGate.inversionAdjust.qualityWeight must be finite >= 0, got: ${config?.decisionGate?.inversionAdjust?.qualityWeight}`,
    )
  }
  const secondPickModeRaw =
    config?.decisionGate?.secondPick?.mode ??
    config?.decisionGate?.secondPick?.phase ??
    "disabled"
  const secondPickMode = String(secondPickModeRaw)
    .trim()
    .toLowerCase()
  if (!["disabled", "shadow", "enforce"].includes(secondPickMode)) {
    violations.push(
      `decisionGate.secondPick.mode/phase must be one of disabled|shadow|enforce, got: ${secondPickModeRaw}`,
    )
  }
  const secondPickDebugLog = config?.decisionGate?.secondPick?.debugLog
  if (secondPickDebugLog !== undefined && typeof secondPickDebugLog !== "boolean") {
    violations.push(
      `decisionGate.secondPick.debugLog must be boolean when set, got: ${config?.decisionGate?.secondPick?.debugLog}`,
    )
  }
  const similarityGate = config?.decisionGate?.similarityGate ?? {}
  const similarityGateEnabled = similarityGate?.enabled === true
  const similarityGateThresholdEntries = [
    ["minRawSimilarity", similarityGate?.minRawSimilarity],
    ["minLocalStageScore", similarityGate?.minLocalStageScore],
    ["minTriggerStageScore", similarityGate?.minTriggerStageScore]
  ]
  let similarityGateThresholdCount = 0
  for (const [key, rawValue] of similarityGateThresholdEntries) {
    if (rawValue === undefined || rawValue === null || rawValue === "") continue
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      violations.push(
        `decisionGate.similarityGate.${key} must be finite within [0,1] when set, got: ${rawValue}`,
      )
      continue
    }
    similarityGateThresholdCount += 1
  }
  if (similarityGateEnabled && similarityGateThresholdCount < 1) {
    violations.push(
      "decisionGate.similarityGate.enabled=true requires at least one threshold field",
    )
  }
  const similarityDisambiguation = config?.decisionGate?.similarityDisambiguation ?? {}
  const similarityDisambiguationEnabled = similarityDisambiguation?.enabled === true
  const similarityDisambiguationThresholdEntries = [
    ["minTop1Top2Gap", similarityDisambiguation?.minTop1Top2Gap],
    ["minPositiveNegativeGap", similarityDisambiguation?.minPositiveNegativeGap]
  ]
  let similarityDisambiguationThresholdCount = 0
  for (const [key, rawValue] of similarityDisambiguationThresholdEntries) {
    if (rawValue === undefined || rawValue === null || rawValue === "") continue
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      violations.push(
        `decisionGate.similarityDisambiguation.${key} must be finite within [0,1] when set, got: ${rawValue}`,
      )
      continue
    }
    similarityDisambiguationThresholdCount += 1
  }
  if (similarityDisambiguationEnabled && similarityDisambiguationThresholdCount < 1) {
    violations.push(
      "decisionGate.similarityDisambiguation.enabled=true requires at least one threshold field",
    )
  }
  const allowedNegativeBuckets = new Set(["STOP_FIRST", "TIMEOUT_NEGATIVE", "LOW_EXECUTION_QUALITY"])
  const negativeBuckets = Array.isArray(similarityDisambiguation?.negativeBuckets)
    ? similarityDisambiguation.negativeBuckets
    : []
  for (const value of negativeBuckets) {
    const bucket = String(value ?? "").trim().toUpperCase()
    if (!bucket) continue
    if (!allowedNegativeBuckets.has(bucket)) {
      violations.push(
        `decisionGate.similarityDisambiguation.negativeBuckets contains unsupported value: ${value}`,
      )
    }
  }
  if (
    similarityDisambiguationEnabled &&
    similarityDisambiguationThresholdCount > 0 &&
    negativeBuckets.length < 1
  ) {
    violations.push(
      "decisionGate.similarityDisambiguation.enabled=true requires negativeBuckets when thresholds are set",
    )
  }
  const agreementGate = config?.decisionGate?.agreementGate ?? {}
  if (agreementGate?.enabled === true) {
    const candidatePool = Number(agreementGate?.candidatePool ?? 0)
    const consensusTopN = Number(agreementGate?.consensusTopN ?? 0)
    const minConsensusCount = Number(agreementGate?.minConsensusCount ?? 0)
    const minStabilityRate = Number(agreementGate?.minStabilityRate ?? 0)
    const minAgreementScore = Number(agreementGate?.minAgreementScore ?? 0)
    const agreementModel = agreementGate?.model ?? {}
    if (!Number.isFinite(candidatePool) || candidatePool < 10) {
      violations.push(
        `decisionGate.agreementGate.candidatePool must be finite >= 10, got: ${agreementGate?.candidatePool}`,
      )
    }
    if (!Number.isFinite(consensusTopN) || consensusTopN < 1) {
      violations.push(
        `decisionGate.agreementGate.consensusTopN must be finite >= 1, got: ${agreementGate?.consensusTopN}`,
      )
    }
    if (!Number.isFinite(minConsensusCount) || minConsensusCount < 1) {
      violations.push(
        `decisionGate.agreementGate.minConsensusCount must be finite >= 1, got: ${agreementGate?.minConsensusCount}`,
      )
    }
    if (!Number.isFinite(minStabilityRate) || minStabilityRate < 0 || minStabilityRate > 1) {
      violations.push(
        `decisionGate.agreementGate.minStabilityRate must be within [0,1], got: ${agreementGate?.minStabilityRate}`,
      )
    }
    if (!Number.isFinite(minAgreementScore) || minAgreementScore < 0 || minAgreementScore > 1) {
      violations.push(
        `decisionGate.agreementGate.minAgreementScore must be within [0,1], got: ${agreementGate?.minAgreementScore}`,
      )
    }
    const agreementEnforcementMode = String(agreementGate?.enforcementMode ?? "hard_reject")
      .trim()
      .toLowerCase()
    if (!["hard_reject", "shadow"].includes(agreementEnforcementMode)) {
      violations.push(
        `decisionGate.agreementGate.enforcementMode must be hard_reject|shadow, got: ${agreementGate?.enforcementMode}`,
      )
    }
    const shadowRejectPrecisionGuard = agreementGate?.shadowRejectPrecisionGuard ?? {}
    if (shadowRejectPrecisionGuard?.enabled === true) {
      const allowedReasons = Array.isArray(shadowRejectPrecisionGuard?.allowedReasons)
        ? shadowRejectPrecisionGuard.allowedReasons
        : null
      const allowedSelectionModes = Array.isArray(shadowRejectPrecisionGuard?.allowedSelectionModes)
        ? shadowRejectPrecisionGuard.allowedSelectionModes
        : null
      if (!allowedReasons || allowedReasons.length < 1) {
        violations.push(
          "decisionGate.agreementGate.shadowRejectPrecisionGuard.allowedReasons must be a non-empty array when enabled",
        )
      }
      if (!allowedSelectionModes || allowedSelectionModes.length < 1) {
        violations.push(
          "decisionGate.agreementGate.shadowRejectPrecisionGuard.allowedSelectionModes must be a non-empty array when enabled",
        )
      }
    }
    if (agreementModel?.enabled === true) {
      const minSamplesForInference = Number(agreementModel?.minSamplesForInference ?? 0)
      const minTrainRows = Number(agreementModel?.minTrainRows ?? 0)
      const minPositiveRows = Number(agreementModel?.minPositiveRows ?? 0)
      const minNegativeRows = Number(agreementModel?.minNegativeRows ?? 0)
      const onlineLearningRate = Number(agreementModel?.onlineLearningRate ?? 0)
      const trainEpochs = Number(agreementModel?.trainEpochs ?? 0)
      const l2 = Number(agreementModel?.l2 ?? 0)
      if (!Number.isFinite(minSamplesForInference) || minSamplesForInference < 1) {
        violations.push(
          `decisionGate.agreementGate.model.minSamplesForInference must be finite >= 1, got: ${agreementModel?.minSamplesForInference}`,
        )
      }
      if (!Number.isFinite(minTrainRows) || minTrainRows < 1) {
        violations.push(
          `decisionGate.agreementGate.model.minTrainRows must be finite >= 1, got: ${agreementModel?.minTrainRows}`,
        )
      }
      if (!Number.isFinite(minPositiveRows) || minPositiveRows < 1) {
        violations.push(
          `decisionGate.agreementGate.model.minPositiveRows must be finite >= 1, got: ${agreementModel?.minPositiveRows}`,
        )
      }
      if (!Number.isFinite(minNegativeRows) || minNegativeRows < 1) {
        violations.push(
          `decisionGate.agreementGate.model.minNegativeRows must be finite >= 1, got: ${agreementModel?.minNegativeRows}`,
        )
      }
      if (!Number.isFinite(onlineLearningRate) || onlineLearningRate <= 0) {
        violations.push(
          `decisionGate.agreementGate.model.onlineLearningRate must be finite > 0, got: ${agreementModel?.onlineLearningRate}`,
        )
      }
      if (!Number.isFinite(trainEpochs) || trainEpochs < 1) {
        violations.push(
          `decisionGate.agreementGate.model.trainEpochs must be finite >= 1, got: ${agreementModel?.trainEpochs}`,
        )
      }
      if (!Number.isFinite(l2) || l2 < 0) {
        violations.push(
          `decisionGate.agreementGate.model.l2 must be finite >= 0, got: ${agreementModel?.l2}`,
        )
      }
    }
  }
  const secondPickMinFinalScore = Number(
    config?.decisionGate?.secondPick?.minFinalScore ?? config?.decisionGate?.minFinalScore ?? 0,
  )
  if (!Number.isFinite(secondPickMinFinalScore)) {
    violations.push(
      `decisionGate.secondPick.minFinalScore must be finite when set, got: ${config?.decisionGate?.secondPick?.minFinalScore}`,
    )
  }
  const secondPickMinExpectedNetRet3d = Number(
    config?.decisionGate?.secondPick?.minExpectedNetRet3d ?? config?.decisionGate?.minExpectedNetRet3d ?? -1,
  )
  if (!Number.isFinite(secondPickMinExpectedNetRet3d)) {
    violations.push(
      `decisionGate.secondPick.minExpectedNetRet3d must be finite when set, got: ${config?.decisionGate?.secondPick?.minExpectedNetRet3d}`,
    )
  }
  const secondPickMaxGapFromFirst = config?.decisionGate?.secondPick?.maxGapFromFirst
  if (
    secondPickMaxGapFromFirst !== undefined &&
    (!Number.isFinite(Number(secondPickMaxGapFromFirst)) || Number(secondPickMaxGapFromFirst) < 0)
  ) {
    violations.push(
      `decisionGate.secondPick.maxGapFromFirst must be finite >= 0 when set, got: ${config?.decisionGate?.secondPick?.maxGapFromFirst}`,
    )
  }
  const secondPickMinMarginVsThird = config?.decisionGate?.secondPick?.minMarginVsThird
  if (
    secondPickMinMarginVsThird !== undefined &&
    !Number.isFinite(Number(secondPickMinMarginVsThird))
  ) {
    violations.push(
      `decisionGate.secondPick.minMarginVsThird must be finite when set, got: ${config?.decisionGate?.secondPick?.minMarginVsThird}`,
    )
  }
  const executionFeedbackScope = String(config?.decisionGate?.executionGate?.feedbackScope ?? "update_only")
    .trim()
    .toLowerCase()
  if (!["update_only", "all"].includes(executionFeedbackScope)) {
    violations.push(
      `decisionGate.executionGate.feedbackScope must be update_only|all, got: ${config?.decisionGate?.executionGate?.feedbackScope}`,
    )
  }
  const executionSoftReasons = config?.decisionGate?.executionGate?.uncertainty?.softReasons
  if (
    executionSoftReasons !== undefined &&
    (
      !Array.isArray(executionSoftReasons) ||
      executionSoftReasons.some((value) => String(value ?? "").trim().length < 1)
    )
  ) {
    violations.push(
      "decisionGate.executionGate.uncertainty.softReasons must be an array of non-empty strings when set",
    )
  }
  if (config?.decisionGate?.adaptiveMinFinalScore?.enabled === true) {
    violations.push("decisionGate.adaptiveMinFinalScore.enabled must be false in precision-first mode")
  }
  const adaptiveMode = String(
    config?.decisionGate?.adaptiveMinFinalScore?.strategy ??
    config?.decisionGate?.adaptiveMinFinalScore?.mode ??
    "quality_aware",
  ).trim().toLowerCase()
  if (!["quality_aware", "lower_bound_only"].includes(adaptiveMode)) {
    violations.push(
      `decisionGate.adaptiveMinFinalScore.strategy must be quality_aware|lower_bound_only, got: ${config?.decisionGate?.adaptiveMinFinalScore?.strategy ?? config?.decisionGate?.adaptiveMinFinalScore?.mode}`,
    )
  }
  const metaSelector = config?.decisionGate?.metaSelector ?? {}
  for (const legacyKey of [
    "minCalibratedPHit",
    "maxPStopFirst",
    "minFillProb",
    "minConfidence",
  ]) {
    if (hasOwn(metaSelector, legacyKey)) {
      violations.push(`decisionGate.metaSelector.${legacyKey} legacy field is forbidden in strict mode`)
    }
  }
  if (metaSelector?.executionDiagnosticMode === true) {
    violations.push("decisionGate.metaSelector.executionDiagnosticMode must be false in strict mode")
  }
  if (
    metaSelector?.softReasons !== undefined &&
    (
      !Array.isArray(metaSelector.softReasons) ||
      metaSelector.softReasons.some((value) => String(value ?? "").trim().length < 1)
    )
  ) {
    violations.push("decisionGate.metaSelector.softReasons must be an array of non-empty strings when set")
  }
  const falsePositiveGate = config?.decisionGate?.falsePositiveGate ?? {}
  if (falsePositiveGate?.enabled === true) {
    const fpAction = String(falsePositiveGate?.action ?? "shadow").trim().toLowerCase()
    if (!["shadow", "block"].includes(fpAction)) {
      violations.push(`decisionGate.falsePositiveGate.action must be shadow|block, got: ${falsePositiveGate?.action}`)
    }
    const maxRisk = Number(falsePositiveGate?.maxRisk ?? 0)
    if (!Number.isFinite(maxRisk) || maxRisk < 0 || maxRisk > 1) {
      violations.push(`decisionGate.falsePositiveGate.maxRisk must be within [0,1], got: ${falsePositiveGate?.maxRisk}`)
    }
    const minGlobalSamples = Number(falsePositiveGate?.minGlobalSamples ?? 0)
    if (!Number.isFinite(minGlobalSamples) || minGlobalSamples < 0) {
      violations.push(
        `decisionGate.falsePositiveGate.minGlobalSamples must be finite >= 0, got: ${falsePositiveGate?.minGlobalSamples}`,
      )
    }
    const minSegmentSamples = Number(falsePositiveGate?.minSegmentSamples ?? 0)
    if (!Number.isFinite(minSegmentSamples) || minSegmentSamples < 0) {
      violations.push(
        `decisionGate.falsePositiveGate.minSegmentSamples must be finite >= 0, got: ${falsePositiveGate?.minSegmentSamples}`,
      )
    }
    const decisionMode = String(falsePositiveGate?.model?.decisionMode ?? "model_only").trim().toLowerCase()
    if (decisionMode !== "model_only") {
      violations.push(
        `decisionGate.falsePositiveGate.model.decisionMode must be model_only in strict mode, got: ${falsePositiveGate?.model?.decisionMode}`,
      )
    }
  }
  const dayTypeRouter = config?.decisionGate?.dayTypeRouter ?? {}
  if (dayTypeRouter?.enabled === true) {
    const sampleSize = Number(dayTypeRouter?.sampleSize ?? 0)
    if (!Number.isFinite(sampleSize) || sampleSize < 1) {
      violations.push(
        `decisionGate.dayTypeRouter.sampleSize must be finite >= 1, got: ${dayTypeRouter?.sampleSize}`,
      )
    }
    const edgeTradeEscape = dayTypeRouter?.model?.edgeTradeEscape ?? {}
    if (edgeTradeEscape?.enabled === true) {
      const allowedRuleDayTypes = Array.isArray(edgeTradeEscape?.allowedRuleDayTypes)
        ? edgeTradeEscape.allowedRuleDayTypes
        : []
      const allowedPredictedDayTypes = Array.isArray(edgeTradeEscape?.allowedPredictedDayTypes)
        ? edgeTradeEscape.allowedPredictedDayTypes
        : []
      if (allowedRuleDayTypes.length < 1) {
        violations.push(
          "decisionGate.dayTypeRouter.model.edgeTradeEscape.allowedRuleDayTypes must be a non-empty array when enabled",
        )
      }
      if (allowedPredictedDayTypes.length < 1) {
        violations.push(
          "decisionGate.dayTypeRouter.model.edgeTradeEscape.allowedPredictedDayTypes must be a non-empty array when enabled",
        )
      }
      for (const [key, value] of Object.entries({
        minTop1ExpectedNetRet3d: edgeTradeEscape?.minTop1ExpectedNetRet3d,
        maxAvgSlippageRisk: edgeTradeEscape?.maxAvgSlippageRisk,
        minTop1Margin: edgeTradeEscape?.minTop1Margin
      })) {
        if (value === undefined || value === null || value === "") continue
        const n = Number(value)
        if (!Number.isFinite(n) || n < 0) {
          violations.push(
            `decisionGate.dayTypeRouter.model.edgeTradeEscape.${key} must be finite >= 0, got: ${value}`,
          )
        }
      }
      if (
        edgeTradeEscape?.minAvgFillProb !== undefined &&
        edgeTradeEscape?.minAvgFillProb !== null &&
        edgeTradeEscape?.minAvgFillProb !== ""
      ) {
        const n = Number(edgeTradeEscape.minAvgFillProb)
        if (!Number.isFinite(n) || n < 0 || n > 1) {
          violations.push(
            `decisionGate.dayTypeRouter.model.edgeTradeEscape.minAvgFillProb must be finite within [0,1], got: ${edgeTradeEscape?.minAvgFillProb}`,
          )
        }
      }
      const policyOverrides = edgeTradeEscape?.policyOverrides ?? {}
      if (policyOverrides?.noTrade === true) {
        violations.push(
          "decisionGate.dayTypeRouter.model.edgeTradeEscape.policyOverrides.noTrade must be false when enabled",
        )
      }
      for (const [key, value] of Object.entries({
        minFinalScoreDelta: policyOverrides?.minFinalScoreDelta,
        minExpectedNetRet3dDelta: policyOverrides?.minExpectedNetRet3dDelta,
        minScoreMarginMultiplier: policyOverrides?.minScoreMarginMultiplier,
        tauExecMultiplier: policyOverrides?.tauExecMultiplier,
        tauFpMultiplier: policyOverrides?.tauFpMultiplier
      })) {
        if (value === undefined || value === null || value === "") continue
        const n = Number(value)
        if (!Number.isFinite(n)) {
          violations.push(
            `decisionGate.dayTypeRouter.model.edgeTradeEscape.policyOverrides.${key} must be finite, got: ${value}`,
          )
        }
      }
      if (
        policyOverrides?.maxPicksPerDay !== undefined &&
        policyOverrides?.maxPicksPerDay !== null &&
        policyOverrides?.maxPicksPerDay !== "" &&
        ![1, 2].includes(Number(policyOverrides.maxPicksPerDay))
      ) {
        violations.push(
          `decisionGate.dayTypeRouter.model.edgeTradeEscape.policyOverrides.maxPicksPerDay must be 1 or 2 when set, got: ${policyOverrides?.maxPicksPerDay}`,
        )
      }
      for (const [key, value] of Object.entries({
        maxExecutedPicks: policyOverrides?.maxExecutedPicks,
        maxFragileExecuted: policyOverrides?.maxFragileExecuted,
        maxLowLiquidityExecuted: policyOverrides?.maxLowLiquidityExecuted,
        maxExecutionHostileExecuted: policyOverrides?.maxExecutionHostileExecuted,
        maxSameRouteBucket: policyOverrides?.maxSameRouteBucket,
        maxSameRegimeTag: policyOverrides?.maxSameRegimeTag,
        maxSamePrototypeFamily: policyOverrides?.maxSamePrototypeFamily
      })) {
        if (value === undefined || value === null || value === "") continue
        const n = Number(value)
        if (!Number.isFinite(n) || n < 0) {
          violations.push(
            `decisionGate.dayTypeRouter.model.edgeTradeEscape.policyOverrides.${key} must be finite >= 0, got: ${value}`,
          )
        }
      }
    }
  }
  const opportunityBudget = config?.decisionGate?.opportunityBudget ?? {}
  if (opportunityBudget?.enabled === true) {
    const budgetAction = String(opportunityBudget?.action ?? "shadow").trim().toLowerCase()
    if (!["shadow", "block"].includes(budgetAction)) {
      violations.push(
        `decisionGate.opportunityBudget.action must be shadow|block, got: ${opportunityBudget?.action}`,
      )
    }
    for (const [key, value] of Object.entries({
      maxExecutedPicks: opportunityBudget?.maxExecutedPicks,
      maxFragileExecuted: opportunityBudget?.maxFragileExecuted,
      maxLowLiquidityExecuted: opportunityBudget?.maxLowLiquidityExecuted,
      maxExecutionHostileExecuted: opportunityBudget?.maxExecutionHostileExecuted,
      maxSameRouteBucket: opportunityBudget?.maxSameRouteBucket,
      maxSameRegimeTag: opportunityBudget?.maxSameRegimeTag,
      maxSamePrototypeFamily: opportunityBudget?.maxSamePrototypeFamily
    })) {
      if (value === undefined || value === null || value === "") continue
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) {
        violations.push(`decisionGate.opportunityBudget.${key} must be finite >= 0, got: ${value}`)
      }
    }
  }
  const promotionScope = String(
    config?.onlineLearning?.generalization?.promotionScope ??
      (config?.onlineLearning?.generalization?.useEvalForPromotion === true ? "eval" : "update"),
  )
    .trim()
    .toLowerCase()
  if (!["update", "tune", "eval"].includes(promotionScope)) {
    violations.push(
      `onlineLearning.generalization.promotionScope must be one of update|tune|eval, got: ${promotionScope}`,
    )
  }
  const holdoutPolicy = config?.holdoutPolicy ?? {}
  const holdoutEnabled = holdoutPolicy?.enabled !== false
  const frozenEvalOnlyForFinal = holdoutPolicy?.frozenEvalOnlyForFinal !== false
  const forbidEvalDrivenPromotion = holdoutPolicy?.forbidEvalDrivenPromotion !== false
  const minFeedbackDelayDays = Math.max(
    1,
    Math.floor(Number(holdoutPolicy?.minFeedbackDelayDays ?? 1) || 1),
  )
  if (holdoutEnabled && frozenEvalOnlyForFinal !== true) {
    violations.push("holdoutPolicy.frozenEvalOnlyForFinal must be true in strict mode")
  }
  if (holdoutEnabled && forbidEvalDrivenPromotion && promotionScope === "eval") {
    violations.push("holdoutPolicy forbids eval-driven promotion, but promotionScope=eval")
  }
  if (holdoutEnabled && executionFeedbackScope !== "update_only") {
    violations.push("decisionGate.executionGate.feedbackScope must be update_only in strict mode")
  }
  const lockboxGate = config?.cdLoop?.lockboxGate ?? {}
  const lockboxGoalMode = String(lockboxGate?.goalMode ?? config?.backtest?.goalMode ?? "LEGACY_PNL_V1")
    .trim()
    .toUpperCase()
  const lockboxPositionSemantics = String(
    lockboxGate?.positionSemantics ?? config?.backtest?.positionSemantics ?? "SINGLE_POSITION_V1",
  )
    .trim()
    .toUpperCase()
  if (!["LEGACY_PNL_V1", "TARGET_FIRST_V2"].includes(lockboxGoalMode)) {
    violations.push(`cdLoop.lockboxGate.goalMode must be LEGACY_PNL_V1|TARGET_FIRST_V2, got: ${lockboxGate?.goalMode}`)
  }
  if (!["SINGLE_POSITION_V1", "OVERLAP_DAILY_ONE_PICK_V2"].includes(lockboxPositionSemantics)) {
    violations.push(
      `cdLoop.lockboxGate.positionSemantics must be SINGLE_POSITION_V1|OVERLAP_DAILY_ONE_PICK_V2, got: ${lockboxGate?.positionSemantics}`,
    )
  }
  for (const [key, value] of Object.entries({
    maxPolicyDriftScore: lockboxGate?.maxPolicyDriftScore,
    minBucketConsistency: lockboxGate?.minBucketConsistency,
    minRegimeConsistency: lockboxGate?.minRegimeConsistency,
    minAgreementDecisionConsistency: lockboxGate?.minAgreementDecisionConsistency,
    minAgreementReasonConsistency: lockboxGate?.minAgreementReasonConsistency
  })) {
    if (value === undefined || value === null || value === "") continue
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      violations.push(`cdLoop.lockboxGate.${key} must be within [0,1] when set, got: ${value}`)
    }
  }

  const generalizationFeedbackDelayDays = Number(
    config?.onlineLearning?.generalization?.feedbackDelayDays ?? 0,
  )
  if (
    !Number.isFinite(generalizationFeedbackDelayDays) ||
    generalizationFeedbackDelayDays < minFeedbackDelayDays
  ) {
    violations.push(
      `onlineLearning.generalization.feedbackDelayDays must be >= ${minFeedbackDelayDays}, got: ${config?.onlineLearning?.generalization?.feedbackDelayDays}`,
    )
  }
  const executionFeedbackDelayDays = Number(config?.decisionGate?.executionGate?.feedbackDelayDays ?? 0)
  if (
    !Number.isFinite(executionFeedbackDelayDays) ||
    executionFeedbackDelayDays < minFeedbackDelayDays
  ) {
    violations.push(
      `decisionGate.executionGate.feedbackDelayDays must be >= ${minFeedbackDelayDays}, got: ${config?.decisionGate?.executionGate?.feedbackDelayDays}`,
    )
  }

  const prototypeSelection = config?.pattern?.prototypeSelection ?? {}
  const backtestGoalMode = String(config?.backtest?.goalMode ?? "LEGACY_PNL_V1")
    .trim()
    .toUpperCase()
  if (!["LEGACY_PNL_V1", "TARGET_FIRST_V2"].includes(backtestGoalMode)) {
    violations.push(
      `backtest.goalMode must be LEGACY_PNL_V1|TARGET_FIRST_V2, got: ${config?.backtest?.goalMode}`,
    )
  }
  const backtestPositionSemantics = String(config?.backtest?.positionSemantics ?? "SINGLE_POSITION_V1")
    .trim()
    .toUpperCase()
  if (!["SINGLE_POSITION_V1", "OVERLAP_DAILY_ONE_PICK_V2"].includes(backtestPositionSemantics)) {
    violations.push(
      `backtest.positionSemantics must be SINGLE_POSITION_V1|OVERLAP_DAILY_ONE_PICK_V2, got: ${config?.backtest?.positionSemantics}`,
    )
  }
  const maxNewEntriesPerDay = Number(config?.backtest?.maxNewEntriesPerDay ?? 1)
  if (!Number.isInteger(maxNewEntriesPerDay) || maxNewEntriesPerDay < 1) {
    violations.push(
      `backtest.maxNewEntriesPerDay must be integer >= 1, got: ${config?.backtest?.maxNewEntriesPerDay}`,
    )
  }
  const minPrototypeFloor = Number(prototypeSelection?.minPrototypeFloor ?? 0)
  const minNegativePrototypeFloor = Number(prototypeSelection?.minNegativePrototypeFloor ?? 0)
  const minClusterFloor = Number(prototypeSelection?.minClusterFloor ?? 0)
  if (!Number.isFinite(minPrototypeFloor) || minPrototypeFloor < 48) {
    violations.push(
      `pattern.prototypeSelection.minPrototypeFloor must be >= 48, got: ${prototypeSelection?.minPrototypeFloor}`,
    )
  }
  if (!Number.isInteger(minNegativePrototypeFloor) || minNegativePrototypeFloor < 0) {
    violations.push(
      `pattern.prototypeSelection.minNegativePrototypeFloor must be integer >= 0, got: ${prototypeSelection?.minNegativePrototypeFloor}`,
    )
  }
  if (!Number.isFinite(minClusterFloor) || minClusterFloor < 24) {
    violations.push(
      `pattern.prototypeSelection.minClusterFloor must be >= 24, got: ${prototypeSelection?.minClusterFloor}`,
    )
  }
  for (const [key, raw] of [
    ["minTemporalCoverageForEraBoost", prototypeSelection?.minTemporalCoverageForEraBoost],
    ["minTemporalEffectiveEraCountRatio", prototypeSelection?.minTemporalEffectiveEraCountRatio],
    ["minTemporalEntropyRatio", prototypeSelection?.minTemporalEntropyRatio]
  ]) {
    const value = Number(raw ?? 0)
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      violations.push(`pattern.prototypeSelection.${key} must be within [0,1], got: ${raw}`)
    }
  }
  const adaptiveFrontier = prototypeSelection?.adaptiveFrontier ?? {}
  const adaptiveFrontierRatioKeys = [
    ["qualityAcceptThreshold", adaptiveFrontier?.qualityAcceptThreshold],
    ["qualityNearThreshold", adaptiveFrontier?.qualityNearThreshold],
    ["previousRunEThreshold", adaptiveFrontier?.previousRunEThreshold],
    ["ledgerMinConfidence", adaptiveFrontier?.ledgerMinConfidence]
  ]
  for (const [key, raw] of adaptiveFrontierRatioKeys) {
    if (raw === undefined) continue
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      violations.push(`pattern.prototypeSelection.adaptiveFrontier.${key} must be within [0,1], got: ${raw}`)
    }
  }
  for (const [key, raw] of [
    ["ledgerCoreBias", adaptiveFrontier?.ledgerCoreBias],
    ["ledgerPenaltyBias", adaptiveFrontier?.ledgerPenaltyBias],
    ["ledgerWatchlistBias", adaptiveFrontier?.ledgerWatchlistBias]
  ]) {
    if (raw === undefined) continue
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) {
      violations.push(`pattern.prototypeSelection.adaptiveFrontier.${key} must be >= 0, got: ${raw}`)
    }
  }
  if (
    adaptiveFrontier?.prototypeLedgerPath !== undefined &&
    String(adaptiveFrontier?.prototypeLedgerPath ?? "").trim().length < 1
  ) {
    violations.push("pattern.prototypeSelection.adaptiveFrontier.prototypeLedgerPath must be non-empty when set")
  }
  const temporalStability = config?.pattern?.temporalStability ?? {}
  for (const [key, raw] of [
    ["warnMaxSingleEraShare", temporalStability?.warnMaxSingleEraShare],
    ["warnMinEraCoverageRatio", temporalStability?.warnMinEraCoverageRatio],
    ["warnMinEffectiveEraCountRatio", temporalStability?.warnMinEffectiveEraCountRatio],
    ["warnMinNormalizedEraEntropy", temporalStability?.warnMinNormalizedEraEntropy],
    ["minEraCoverageRatio", temporalStability?.minEraCoverageRatio],
    ["maxSingleEraShare", temporalStability?.maxSingleEraShare],
    ["minEffectiveEraCountRatio", temporalStability?.minEffectiveEraCountRatio],
    ["minNormalizedEraEntropy", temporalStability?.minNormalizedEraEntropy],
    ["maxSelectedPrototypeEraShare", temporalStability?.maxSelectedPrototypeEraShare],
    ["minReturnTailQualityScore", temporalStability?.minReturnTailQualityScore],
    ["relaxMinEraCoverageRatioStep", temporalStability?.relaxMinEraCoverageRatioStep],
    ["relaxMaxSingleEraShareStep", temporalStability?.relaxMaxSingleEraShareStep],
    ["relaxMinEffectiveEraCountRatioStep", temporalStability?.relaxMinEffectiveEraCountRatioStep],
    ["relaxMinNormalizedEraEntropyStep", temporalStability?.relaxMinNormalizedEraEntropyStep]
  ]) {
    const value = Number(raw ?? 0)
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      violations.push(`pattern.temporalStability.${key} must be within [0,1], got: ${raw}`)
    }
  }
  const c0 = config?.pattern?.c0 ?? {}
  if (c0 && typeof c0 === "object") {
    const inputMode = String(c0?.inputMode ?? "auto")
      .trim()
      .toLowerCase()
    if (!["auto", "runtime_pack", "lite", "full"].includes(inputMode)) {
      violations.push(`pattern.c0.inputMode must be auto|runtime_pack|lite|full, got: ${c0?.inputMode}`)
    }
    const familyBuildSource = String(c0?.familyBuildSource ?? "positive_only")
      .trim()
      .toLowerCase()
    if (!["positive_only", "all_templates"].includes(familyBuildSource)) {
      violations.push(
        `pattern.c0.familyBuildSource must be positive_only|all_templates, got: ${c0?.familyBuildSource}`,
      )
    }
    const minFamilySupport = Number(c0?.minFamilySupport ?? 0)
    if (!Number.isFinite(minFamilySupport) || minFamilySupport < 4) {
      violations.push(`pattern.c0.minFamilySupport must be >= 4, got: ${c0?.minFamilySupport}`)
    }
    const shortlistFamilyCount = Number(c0?.shortlistFamilyCount ?? 0)
    if (!Number.isFinite(shortlistFamilyCount) || shortlistFamilyCount < 8) {
      violations.push(`pattern.c0.shortlistFamilyCount must be >= 8, got: ${c0?.shortlistFamilyCount}`)
    }
    const familyBackfillFloor = Number(c0?.familyBackfillFloor ?? 0)
    if (!Number.isFinite(familyBackfillFloor) || familyBackfillFloor < 1) {
      violations.push(`pattern.c0.familyBackfillFloor must be >= 1, got: ${c0?.familyBackfillFloor}`)
    }
    if (Number.isFinite(familyBackfillFloor) && Number.isFinite(shortlistFamilyCount) && familyBackfillFloor > shortlistFamilyCount) {
      violations.push(
        `pattern.c0.familyBackfillFloor must be <= shortlistFamilyCount, got: ${c0?.familyBackfillFloor} > ${c0?.shortlistFamilyCount}`,
      )
    }
    const ratioKeys = [
      ["maxFamilyShare", c0?.maxFamilyShare],
      ["minEraCoverageRatio", c0?.minEraCoverageRatio],
      ["minEraCoverageRatioForBackfill", c0?.minEraCoverageRatioForBackfill],
      ["minEffectiveEraCountRatio", c0?.minEffectiveEraCountRatio],
      ["minEffectiveEraCountRatioForBackfill", c0?.minEffectiveEraCountRatioForBackfill],
      ["minNormalizedEraEntropy", c0?.minNormalizedEraEntropy],
      ["minNormalizedEraEntropyForBackfill", c0?.minNormalizedEraEntropyForBackfill],
      ["maxSingleEraShare", c0?.maxSingleEraShare],
      ["maxSingleEraShareForBackfill", c0?.maxSingleEraShareForBackfill],
      ["minShapeCohesion", c0?.minShapeCohesion],
      ["minFeatureCohesion", c0?.minFeatureCohesion],
      ["maxNegativeContaminationRate", c0?.maxNegativeContaminationRate]
    ]
    for (const [key, raw] of ratioKeys) {
      const value = Number(raw ?? 0)
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        violations.push(`pattern.c0.${key} must be within [0,1], got: ${raw}`)
      }
    }
    for (const [key, raw] of Object.entries(c0?.scoreWeights ?? {})) {
      const value = Number(raw ?? 0)
      if (!Number.isFinite(value) || value < 0) {
        violations.push(`pattern.c0.scoreWeights.${key} must be >= 0, got: ${raw}`)
      }
    }
  }
  const c1 = config?.pattern?.c1 ?? {}
  if (c1 && typeof c1 === "object") {
    const probeProfile = String(c1?.probeProfile ?? "C1_FAMILY_PROBE").trim()
    if (probeProfile !== "C1_FAMILY_PROBE") {
      violations.push(
        `pattern.c1.probeProfile must be C1_FAMILY_PROBE, got: ${c1?.probeProfile}`,
      )
    }
    const probeScope = String(c1?.probeScope ?? "update").trim().toLowerCase()
    if (!["update", "tune", "eval"].includes(probeScope)) {
      violations.push(
        `pattern.c1.probeScope must be one of update|tune|eval, got: ${c1?.probeScope}`,
      )
    }
    const maxProbeFamilies = Number(c1?.maxProbeFamilies ?? 0)
    if (!Number.isFinite(maxProbeFamilies) || maxProbeFamilies < 1) {
      violations.push(`pattern.c1.maxProbeFamilies must be >= 1, got: ${c1?.maxProbeFamilies}`)
    }
    if (
      c1?.explicitFamilyIds != null &&
      (!Array.isArray(c1?.explicitFamilyIds) ||
        c1.explicitFamilyIds.some((value) => !String(value ?? "").trim()))
    ) {
      violations.push("pattern.c1.explicitFamilyIds must be an array of non-empty strings")
    }
    const minFamilySupport = Number(c1?.minFamilySupport ?? 0)
    if (!Number.isFinite(minFamilySupport) || minFamilySupport < 1) {
      violations.push(`pattern.c1.minFamilySupport must be >= 1, got: ${c1?.minFamilySupport}`)
    }
    const maxFamilyRepresentatives = Number(c1?.maxFamilyRepresentatives ?? 0)
    if (!Number.isFinite(maxFamilyRepresentatives) || maxFamilyRepresentatives < 1) {
      violations.push(
        `pattern.c1.maxFamilyRepresentatives must be >= 1, got: ${c1?.maxFamilyRepresentatives}`,
      )
    }
    const familyBackfillFloor = Number(c1?.familyBackfillFloor ?? 0)
    if (!Number.isFinite(familyBackfillFloor) || familyBackfillFloor < 1) {
      violations.push(`pattern.c1.familyBackfillFloor must be >= 1, got: ${c1?.familyBackfillFloor}`)
    }
    if (
      Number.isFinite(familyBackfillFloor) &&
      Number.isFinite(maxProbeFamilies) &&
      familyBackfillFloor > maxProbeFamilies
    ) {
      violations.push(
        `pattern.c1.familyBackfillFloor must be <= maxProbeFamilies, got: ${c1?.familyBackfillFloor} > ${c1?.maxProbeFamilies}`,
      )
    }
    const nonNegativeKeys = [
      ["familyBackfillMax", c1?.familyBackfillMax],
      ["retainTopProbeArtifacts", c1?.retainTopProbeArtifacts]
    ]
    for (const [key, raw] of nonNegativeKeys) {
      const value = Number(raw ?? 0)
      if (!Number.isFinite(value) || value < 0) {
        violations.push(`pattern.c1.${key} must be >= 0, got: ${raw}`)
      }
    }
    const ratioKeys = [
      ["familyPassMinTargetHitRateEval", c1?.familyPassMinTargetHitRateEval],
      ["familyPassMinExecutedTargetHitRateEval", c1?.familyPassMinExecutedTargetHitRateEval],
      ["familyPassMinSelectionHitAt1Eval", c1?.familyPassMinSelectionHitAt1Eval],
      ["familyPassMinExecutionCoverageEval", c1?.familyPassMinExecutionCoverageEval],
      ["familyPassMaxStopRateEval", c1?.familyPassMaxStopRateEval],
      ["familyPassMaxTimeoutNegativeRateEval", c1?.familyPassMaxTimeoutNegativeRateEval]
    ]
    for (const [key, raw] of ratioKeys) {
      const value = Number(raw ?? 0)
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        violations.push(`pattern.c1.${key} must be within [0,1], got: ${raw}`)
      }
    }
    const countKeys = [
      ["familyPassMinPickedDaysEval", c1?.familyPassMinPickedDaysEval],
      ["familyPassMinTargetsPer20EvalDays", c1?.familyPassMinTargetsPer20EvalDays],
      [
        "selectionHitAt1AgreementFallbackAwareMinDaysEval",
        c1?.selectionHitAt1AgreementFallbackAwareMinDaysEval
      ]
    ]
    for (const [key, raw] of countKeys) {
      const value = Number(raw ?? 0)
      if (!Number.isFinite(value) || value < 0) {
        violations.push(`pattern.c1.${key} must be >= 0, got: ${raw}`)
      }
    }
    for (const [key, raw] of Object.entries(c1?.scoreWeights ?? {})) {
      const value = Number(raw ?? 0)
      if (!Number.isFinite(value) || value < 0) {
        violations.push(`pattern.c1.scoreWeights.${key} must be >= 0, got: ${raw}`)
      }
    }
    const selectionHitAt1MetricMode = String(c1?.selectionHitAt1MetricMode ?? "raw")
      .trim()
      .toLowerCase()
    if (!["raw", "agreement_fallback_aware"].includes(selectionHitAt1MetricMode)) {
      violations.push(
        `pattern.c1.selectionHitAt1MetricMode must be raw|agreement_fallback_aware, got: ${c1?.selectionHitAt1MetricMode}`,
      )
    }
    if (
      c1?.selectionHitAt1AgreementFallbackAwareAllowedPrimaryGateReasons !== undefined &&
      !Array.isArray(c1?.selectionHitAt1AgreementFallbackAwareAllowedPrimaryGateReasons)
    ) {
      violations.push(
        "pattern.c1.selectionHitAt1AgreementFallbackAwareAllowedPrimaryGateReasons must be an array when set",
      )
    }
    if (c1?.lockboxEval != null && typeof c1.lockboxEval !== "object") {
      violations.push("pattern.c1.lockboxEval must be an object when set")
    }
    if (c1?.lockboxEval && typeof c1.lockboxEval === "object") {
      if (c1.lockboxEval?.enabled != null && typeof c1.lockboxEval.enabled !== "boolean") {
        violations.push("pattern.c1.lockboxEval.enabled must be boolean when set")
      }
      if (
        c1.lockboxEval?.persistArtifacts != null &&
        typeof c1.lockboxEval.persistArtifacts !== "boolean"
      ) {
        violations.push("pattern.c1.lockboxEval.persistArtifacts must be boolean when set")
      }
      const minPickFloor = Number(c1.lockboxEval?.minPickFloor ?? 0)
      if (!Number.isFinite(minPickFloor) || minPickFloor < 0) {
        violations.push(
          `pattern.c1.lockboxEval.minPickFloor must be >= 0, got: ${c1.lockboxEval?.minPickFloor}`,
        )
      }
      const maxConcurrentFamilies = Number(c1.lockboxEval?.maxConcurrentFamilies ?? 0)
      if (!Number.isFinite(maxConcurrentFamilies) || maxConcurrentFamilies < 1) {
        violations.push(
          `pattern.c1.lockboxEval.maxConcurrentFamilies must be >= 1, got: ${c1.lockboxEval?.maxConcurrentFamilies}`,
        )
      }
    }
    if (c1?.bundleEval != null && typeof c1.bundleEval !== "object") {
      violations.push("pattern.c1.bundleEval must be an object when set")
    }
    if (c1?.bundleEval && typeof c1.bundleEval === "object") {
      if (c1.bundleEval?.enabled != null && typeof c1.bundleEval.enabled !== "boolean") {
        violations.push("pattern.c1.bundleEval.enabled must be boolean when set")
      }
      if (
        c1.bundleEval?.defaultAbstainWhenNoConsensus != null &&
        typeof c1.bundleEval.defaultAbstainWhenNoConsensus !== "boolean"
      ) {
        violations.push(
          "pattern.c1.bundleEval.defaultAbstainWhenNoConsensus must be boolean when set",
        )
      }
      const bundleCountKeys = [
        ["minPickFloorDWeak", c1.bundleEval?.minPickFloorDWeak],
        ["minPickFloorEWeak", c1.bundleEval?.minPickFloorEWeak],
        ["minPickFloorDStrong", c1.bundleEval?.minPickFloorDStrong],
        ["minPickFloorEStrong", c1.bundleEval?.minPickFloorEStrong],
        ["maxConcurrentBundles", c1.bundleEval?.maxConcurrentBundles],
      ]
      for (const [key, raw] of bundleCountKeys) {
        const value = Number(raw ?? 0)
        const min = key === "maxConcurrentBundles" ? 1 : 0
        if (!Number.isFinite(value) || value < min) {
          violations.push(`pattern.c1.bundleEval.${key} must be >= ${min}, got: ${raw}`)
        }
      }
    }
  }
  const c2 = config?.pattern?.c2 ?? {}
  if (c2 && typeof c2 === "object") {
    const minFamiliesForDedup = Number(c2?.minFamiliesForDedup ?? 0)
    if (!Number.isFinite(minFamiliesForDedup) || minFamiliesForDedup < 2) {
      violations.push(`pattern.c2.minFamiliesForDedup must be >= 2, got: ${c2?.minFamiliesForDedup}`)
    }
    const maxFamiliesForPairwise = Number(c2?.maxFamiliesForPairwise ?? 0)
    if (!Number.isFinite(maxFamiliesForPairwise) || maxFamiliesForPairwise < minFamiliesForDedup) {
      violations.push(
        `pattern.c2.maxFamiliesForPairwise must be >= minFamiliesForDedup, got: ${c2?.maxFamiliesForPairwise}`,
      )
    }
    const minRepresentativeFamilies = Number(c2?.minRepresentativeFamilies ?? 0)
    if (!Number.isFinite(minRepresentativeFamilies) || minRepresentativeFamilies < 1) {
      violations.push(
        `pattern.c2.minRepresentativeFamilies must be >= 1, got: ${c2?.minRepresentativeFamilies}`,
      )
    }
    const ratioKeys = [
      ["similarityThreshold", c2?.similarityThreshold],
      ["top1AgreementThreshold", c2?.top1AgreementThreshold],
      ["symbolDayJaccardThreshold", c2?.symbolDayJaccardThreshold],
      ["pickedDayJaccardThreshold", c2?.pickedDayJaccardThreshold],
      ["executionOverlapThreshold", c2?.executionOverlapThreshold],
      ["maxBehaviorPenaltyDistance", c2?.maxBehaviorPenaltyDistance],
      ["rankOverlapThreshold", c2?.rankOverlapThreshold],
      ["minRepresentativeExecutionCoverageEval", c2?.minRepresentativeExecutionCoverageEval]
    ]
    for (const [key, raw] of ratioKeys) {
      const value = Number(raw ?? 0)
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        violations.push(`pattern.c2.${key} must be within [0,1], got: ${raw}`)
      }
    }
    const targetCoverageNorm = Number(c2?.targetCoverageNorm ?? 0)
    if (!Number.isFinite(targetCoverageNorm) || targetCoverageNorm <= 0) {
      violations.push(`pattern.c2.targetCoverageNorm must be > 0, got: ${c2?.targetCoverageNorm}`)
    }
    const minRepresentativeTargetsPer20EvalDays = Number(c2?.minRepresentativeTargetsPer20EvalDays ?? 0)
    if (!Number.isFinite(minRepresentativeTargetsPer20EvalDays) || minRepresentativeTargetsPer20EvalDays < 0) {
      violations.push(
        `pattern.c2.minRepresentativeTargetsPer20EvalDays must be >= 0, got: ${c2?.minRepresentativeTargetsPer20EvalDays}`,
      )
    }
    const minRepresentativeScoreFloor = Number(c2?.minRepresentativeScoreFloor ?? 0)
    if (!Number.isFinite(minRepresentativeScoreFloor) || minRepresentativeScoreFloor < 0) {
      violations.push(
        `pattern.c2.minRepresentativeScoreFloor must be >= 0, got: ${c2?.minRepresentativeScoreFloor}`,
      )
    }
    const representativePolicy = String(c2?.representativePolicy ?? "").trim()
    if (
      representativePolicy &&
      !["quality_first_with_coverage_guard", "coverage_first_with_quality_floor"].includes(
        representativePolicy,
      )
    ) {
      violations.push(
        `pattern.c2.representativePolicy must be one of quality_first_with_coverage_guard|coverage_first_with_quality_floor, got: ${c2?.representativePolicy}`,
      )
    }
    const similarityPolicyVersion = String(c2?.similarityPolicyVersion ?? "").trim()
    if (
      similarityPolicyVersion &&
      !["c2_overlap_graph_v1", "c2_overlap_graph_strict_v1"].includes(similarityPolicyVersion)
    ) {
      violations.push(
        `pattern.c2.similarityPolicyVersion must be one of c2_overlap_graph_v1|c2_overlap_graph_strict_v1, got: ${c2?.similarityPolicyVersion}`,
      )
    }
    for (const [key, raw] of Object.entries(c2?.scoreWeights ?? {})) {
      const value = Number(raw ?? 0)
      if (!Number.isFinite(value) || value < 0) {
        violations.push(`pattern.c2.scoreWeights.${key} must be >= 0, got: ${raw}`)
      }
    }
  }
  const pairwiseCfg = config?.onlineLearning?.generalization?.pairwise ?? {}
  if (hasOwn(pairwiseCfg, pairwiseLegacyKey)) {
    violations.push("onlineLearning.generalization.pairwise.legacy escape key is forbidden in strict mode")
  }
  const startWeightsPath = String(config?.onlineLearning?.startWeightsPath ?? "").trim()
  if (!startWeightsPath) {
    violations.push("onlineLearning.startWeightsPath must be non-empty in strict mode")
  }
  const regimeRouter = config?.decisionGate?.regimeRouter ?? {}
  if (regimeRouter?.enabled === true) {
    if (regimeRouter?.strictWeightLoad !== true) {
      violations.push("decisionGate.regimeRouter.strictWeightLoad must be true in strict mode")
    }
    const weightsByBucket = regimeRouter?.weightsByBucket ?? {}
    const requiredBuckets = ["LOWVOL", "MIDVOL", "HIGHVOL", "__DEFAULT__"]
    for (const bucket of requiredBuckets) {
      const bucketPath = String(weightsByBucket?.[bucket] ?? "").trim()
      if (!bucketPath) {
        violations.push(`decisionGate.regimeRouter.weightsByBucket.${bucket} must be set in strict mode`)
      }
    }
  }

  const qualityGate = config?.qualityGate ?? {}
  if (qualityGate?.enabled !== false) {
    const minEvalSamples = Number(qualityGate?.minEvalSamples ?? 0)
    const minPickCountEval = Number(qualityGate?.minPickCountEval ?? 0)
    const maxPickCountEval = Number(qualityGate?.maxPickCountEval ?? 0)
    const minPickHitRateEval = Number(qualityGate?.minPickHitRateEval ?? 0)
    const minPickHitRateEvalLcb95 = Number(qualityGate?.minPickHitRateEvalLcb95 ?? 0)
    const minHitAt1Eval = Number(qualityGate?.minHitAt1Eval ?? 0)
    const maxTopKOracleGapEval = Number(qualityGate?.maxTopKOracleGapEval ?? 1)
    const minOracleHitRateTopKEval = Number(qualityGate?.minOracleHitRateTopKEval ?? 0)
    if (!Number.isFinite(minEvalSamples) || minEvalSamples < 10) {
      violations.push(`qualityGate.minEvalSamples must be >= 10, got: ${qualityGate?.minEvalSamples}`)
    }
    if (!Number.isFinite(minPickCountEval) || minPickCountEval < 1) {
      violations.push(`qualityGate.minPickCountEval must be >= 1, got: ${qualityGate?.minPickCountEval}`)
    }
    if (
      !Number.isFinite(maxPickCountEval) ||
      maxPickCountEval < minPickCountEval
    ) {
      violations.push(
        `qualityGate.maxPickCountEval must be >= minPickCountEval, got: ${qualityGate?.maxPickCountEval}`,
      )
    }
    if (!Number.isFinite(minPickHitRateEval) || minPickHitRateEval < 0 || minPickHitRateEval > 1) {
      violations.push(
        `qualityGate.minPickHitRateEval must be in [0,1], got: ${qualityGate?.minPickHitRateEval}`,
      )
    }
    if (
      !Number.isFinite(minPickHitRateEvalLcb95) ||
      minPickHitRateEvalLcb95 < 0 ||
      minPickHitRateEvalLcb95 > 1
    ) {
      violations.push(
        `qualityGate.minPickHitRateEvalLcb95 must be in [0,1], got: ${qualityGate?.minPickHitRateEvalLcb95}`,
      )
    }
    if (!Number.isFinite(minHitAt1Eval) || minHitAt1Eval < 0 || minHitAt1Eval > 1) {
      violations.push(`qualityGate.minHitAt1Eval must be in [0,1], got: ${qualityGate?.minHitAt1Eval}`)
    }
    if (!Number.isFinite(maxTopKOracleGapEval) || maxTopKOracleGapEval < 0 || maxTopKOracleGapEval > 1) {
      violations.push(
        `qualityGate.maxTopKOracleGapEval must be in [0,1], got: ${qualityGate?.maxTopKOracleGapEval}`,
      )
    }
    if (
      !Number.isFinite(minOracleHitRateTopKEval) ||
      minOracleHitRateTopKEval < 0 ||
      minOracleHitRateTopKEval > 1
    ) {
      violations.push(
        `qualityGate.minOracleHitRateTopKEval must be in [0,1], got: ${qualityGate?.minOracleHitRateTopKEval}`,
      )
    }
  }

  const runManifest = config?.runManifest ?? {}
  if (runManifest?.enabled !== true) {
    violations.push("runManifest.enabled must be true in strict mode")
  }
  const bundlePolicy = config?.bundlePolicy ?? {}
  if (bundlePolicy?.enabled !== true) {
    violations.push("bundlePolicy.enabled must be true in strict mode")
  }
  const maxArchiveMb = Number(bundlePolicy?.maxArchiveMb ?? 0)
  if (!Number.isFinite(maxArchiveMb) || maxArchiveMb < 50 || maxArchiveMb > 200) {
    violations.push(`bundlePolicy.maxArchiveMb must be in [50,200], got: ${bundlePolicy?.maxArchiveMb}`)
  }
  const opsSlo = config?.opsSlo ?? {}
  if (opsSlo?.enabled !== true) {
    violations.push("opsSlo.enabled must be true in strict mode")
  }
  if (opsSlo?.rollbackOnGateFail !== true) {
    violations.push("opsSlo.rollbackOnGateFail must be true in strict mode")
  }

  const stepDLightCfg = config?.lightweight?.stepD ?? {}
  const stepDExecutionProfile = String(stepDLightCfg?.executionProfile ?? "full_audit")
    .trim()
    .toLowerCase()
  const stepDCdLoopEpochExecutionProfile = String(
    stepDLightCfg?.cdLoopEpochExecutionProfile ?? "inherit",
  )
    .trim()
    .toLowerCase()
  const stepDScoringWorkers = Number(stepDLightCfg?.scoringWorkers ?? 1)
  const stepDWorkerChunkSize = Number(stepDLightCfg?.workerChunkSize ?? 256)
  const stepDKeepWorkerPoolAlive = stepDLightCfg?.keepWorkerPoolAlive
  if (!["full_audit", "fast_online", "lockbox_audit_only", "c1_family_probe"].includes(stepDExecutionProfile)) {
    violations.push(
      `lightweight.stepD.executionProfile must be one of full_audit|fast_online|lockbox_audit_only|c1_family_probe, got: ${stepDLightCfg?.executionProfile}`,
    )
  }
  if (!["inherit", "full_audit", "fast_online", "lockbox_audit_only", "c1_family_probe"].includes(stepDCdLoopEpochExecutionProfile)) {
    violations.push(
      `lightweight.stepD.cdLoopEpochExecutionProfile must be one of inherit|full_audit|fast_online|lockbox_audit_only|c1_family_probe, got: ${stepDLightCfg?.cdLoopEpochExecutionProfile}`,
    )
  }
  if (!Number.isInteger(stepDScoringWorkers) || stepDScoringWorkers < 0) {
    violations.push(
      `lightweight.stepD.scoringWorkers must be integer >= 0 (0=auto), got: ${stepDLightCfg?.scoringWorkers}`,
    )
  }
  if (!Number.isInteger(stepDWorkerChunkSize) || stepDWorkerChunkSize < 1) {
    violations.push(
      `lightweight.stepD.workerChunkSize must be integer >= 1, got: ${stepDLightCfg?.workerChunkSize}`,
    )
  }
  if (
    stepDKeepWorkerPoolAlive !== undefined &&
    typeof stepDKeepWorkerPoolAlive !== "boolean"
  ) {
    violations.push(
      `lightweight.stepD.keepWorkerPoolAlive must be boolean when set, got: ${stepDLightCfg?.keepWorkerPoolAlive}`,
    )
  }
  if (
    stepDLightCfg?.persistOnlineAuditArtifactsInFastMode !== undefined &&
    typeof stepDLightCfg?.persistOnlineAuditArtifactsInFastMode !== "boolean"
  ) {
    violations.push(
      "lightweight.stepD.persistOnlineAuditArtifactsInFastMode must be boolean when set",
    )
  }
  const smokeConfirm = config?.smokeConfirm ?? {}
  const smokeConfirmPhaseRaw = String(smokeConfirm?.phase ?? "both")
    .trim()
    .toLowerCase()
  const smokeConfirmSmokeRuns = Number(smokeConfirm?.smokeRuns ?? 3)
  const smokeConfirmConfirmRuns = Number(smokeConfirm?.confirmRuns ?? 12)
  const smokeConfirmStopOnFailure = smokeConfirm?.stopOnSmokeFailure
  const smokeConfirmForceStepC = smokeConfirm?.forceStepC
  if (!["both", "smoke", "confirm"].includes(smokeConfirmPhaseRaw)) {
    violations.push(
      `smokeConfirm.phase must be one of both|smoke|confirm, got: ${smokeConfirm?.phase}`,
    )
  }
  if (!Number.isInteger(smokeConfirmSmokeRuns) || smokeConfirmSmokeRuns < 0) {
    violations.push(
      `smokeConfirm.smokeRuns must be integer >= 0, got: ${smokeConfirm?.smokeRuns}`,
    )
  }
  if (!Number.isInteger(smokeConfirmConfirmRuns) || smokeConfirmConfirmRuns < 0) {
    violations.push(
      `smokeConfirm.confirmRuns must be integer >= 0, got: ${smokeConfirm?.confirmRuns}`,
    )
  }
  if (
    smokeConfirmStopOnFailure !== undefined &&
    typeof smokeConfirmStopOnFailure !== "boolean"
  ) {
    violations.push(
      `smokeConfirm.stopOnSmokeFailure must be boolean when set, got: ${smokeConfirm?.stopOnSmokeFailure}`,
    )
  }
  if (smokeConfirmForceStepC !== undefined && typeof smokeConfirmForceStepC !== "boolean") {
    violations.push(
      `smokeConfirm.forceStepC must be boolean when set, got: ${smokeConfirm?.forceStepC}`,
    )
  }

  if (violations.length) {
    throw new Error(
      [
        "Strict mode violation: legacy escape settings are blocked.",
        ...violations
      ].join("\n"),
    )
  }
}

export const DEFAULT_CONFIG = {
  project: { name: "stockdesk-lab-lite", timezone: "Asia/Seoul" },
  timeline: {
    anchorDateKey: "2026-02-13",
    warmupMonths: 12,
    discoveryMonths: 50,
    onlineMonths: 4,
    lockboxMonths: 4
  },
  event: {
    highJumpThreshold: 0.08,
    closeJumpThreshold: 0.08,
    requireCloseJump: false,
    highJumpMode: "FROM_OPEN_EX_GAP",
    labelName: "HIGH8_BUYABLE_EX_GAP"
  },
  filters: {
    symbolRegex: "^[0-9]{6}$",
    excludeTypes: ["ETF", "ETN", "REIT", "OTHER"],
    excludePreferred: true,
    excludeSpac: true,
    excludeBondLike: true,
    minMarketCapKrw: 30_000_000_000,
    maxMarketCapKrw: 500_000_000_000,
    excludeUnknownMarketCap: true,
    minAvgTradingValue20dKrw: 400_000_000,
    minEventTradingValueKrw: 5_000_000_000,
    gapTradability: {
      enabled: true,
      requirePrevClose: true
    }
  },
  template: {
    sequenceWindows: [40],
    localWindow: 40,
    globalWindow: 150,
    featureAsOf: "t-1",
    negativeSampling: {
      enabled: true,
      maxNegativesPerPositive: 1,
      offsets: [5, 10, 20]
    }
  },
  similarity: {
    topK: 10,
    coarseTopN: 220,
    coarseTopClusters: 10,
    scorerVersion: "v2_exact",
    stageWeights: {
      global: 0.35,
      local: 0.45,
      trigger: 0.2
    },
    initialWeights: {
      trend: 0.16,
      candle: 0.14,
      volume: 0.2,
      shape: 0.18,
      gap: 0.08
    },
    postScoreAdjust: {
      enabled: true,
      qualityBonusWeight: 0.08,
      antiPenaltyWeight: 0.1,
      expectedRetBonusWeight: 0.04,
      expectedRetScale: 0.08,
      reasonAwareFeatureRelief: {
        enabled: false,
        requireLowSupportCountOnly: true,
        failedBreakoutScale: 4,
        failedBreakoutWeight: 0,
        gapContinueWeight: 0,
        gapRevertWeight: 0,
        executionFeasibilityWeight: 0,
        eraCoverageWeightForSupportRelief: 0,
        effectiveEraCountWeightForSupportRelief: 0,
        entropyWeightForSupportRelief: 0,
        requireMinEraCoverageRatioForSupportRelief: 0,
        requireMinEffectiveEraCountRatioForSupportRelief: 0,
        requireMinEntropyRatioForSupportRelief: 0,
        maxSingleEraShareExcessForSupportRelief: 1,
        maxSupportCountPenaltyReliefRatio: 0,
        maxStopRatePenaltyReliefRatio: 0,
        stopRateReliefStopRateCap: 0.4
      },
      temporalStability: {
        enabled: false,
        targetEraCoverageRatio: 0.5,
        eraCoverageWeight: 0,
        maxSingleEraShare: 0.75,
        singleEraPenaltyWeight: 0,
        minEraSupportCount: 0,
        lowEraSupportPenaltyWeight: 0,
    singleEraEvidenceScaling: {
      enabled: false,
      coverageWeight: 0.35,
      supportWeight: 0.35,
      effectiveEraCountWeight: 0.2,
      entropyWeight: 0.1,
      minEffectiveEraCount: 2,
      minPenaltyRatio: 0.25
    }
  },
      executionPrior: {
        enabled: false,
        minFillProb: 0.78,
        lowFillPenaltyWeight: 0.08,
        highSlippageRisk: 0.14,
        slippagePenaltyWeight: 0.2,
        feasibilityLowFillReliefWeight: 0,
        feasibilitySlippageReliefWeight: 0,
        feasibilityLiquidityReliefWeight: 0,
        lowLiquidityMinAvgTradingValue20dKrw: 1_200_000_000,
        lowLiquidityPenaltyWeight: 0.08,
        blockedOrderPenaltyWeight: 0.05,
        afterCostScale: 0.08,
        positiveAfterCostBonusWeight: 0.02,
        negativeAfterCostPenaltyWeight: 0.04
      }
    },
    minTradeScore: 0,
    coarsePruneHealth: {
      warnAbove: 0.9,
      failAbove: 0.98,
      failHard: true
    },
    adaptiveCoarseBudget: {
      enabled: false,
      onlyWhenDegenerate: true,
      prototypeShare: 0.4,
      minTopN: 24,
      topKHeadroom: 8
    },
    earlyAbandon: {
      enabled: true,
      groupLevel: true,
      featureLevel: true,
      orderStrategy: "weight_variance"
    }
  },
  decisionGate: {
    minFinalScore: 0.58,
    minScoreMargin: 0.0045,
    maxScoreMargin: 0.016,
    useScoreMarginGate: true,
    maxPicksPerDay: 1,
    hitWindowDays: 3,
    hitEval: {
      useStopLoss: true,
      stopLossPct: 0.04,
      sameDayTiePolicy: "STOP_WINS"
    },
    inversionAdjust: {
      enabled: false,
      maxSwapMargin: 0.02,
      secondBoost: 0,
      qualityWeight: 0.04
    },
    similarityGate: {
      enabled: false,
      minRawSimilarity: null,
      minLocalStageScore: null,
      minTriggerStageScore: null
    },
    similarityDisambiguation: {
      enabled: false,
      minTop1Top2Gap: null,
      minPositiveNegativeGap: null,
      negativeBuckets: ["STOP_FIRST", "TIMEOUT_NEGATIVE"]
    },
    minExpectedNetRet3d: 0.002,
    requirePositiveExpectedNetRet3d: true,
    secondPick: {
      mode: "disabled",
      debugLog: false,
      minFinalScore: 0.58,
      minExpectedNetRet3d: 0.022,
      requirePositiveExpectedNetRet3d: true,
      maxGapFromFirst: 0.016,
      minMarginVsThird: 0.001
    },
    agreementGate: {
      enabled: true,
      enforcementMode: "hard_reject",
      candidatePool: 10,
      consensusTopN: 2,
      stabilityTopN: 2,
      minConsensusCount: 3,
      minStabilityRate: 0.6,
      minAgreementScore: 0.65,
      rerank: {
        enabled: false,
        promoteTradeOnly: true,
        candidatePool: 3,
        maxSwapMargin: 0.01,
        minUtilityGain: 0.015,
        finalScoreWeight: 0.1,
        agreementScoreWeight: 0.7,
        consensusRateWeight: 0.28,
        stabilityRateWeight: 0.18,
        tradeDecisionBonus: 0.08,
        consensusLowPenaltyWeight: 0.24,
        stabilityLowPenaltyWeight: 0.08,
        scoreLowPenaltyWeight: 0.06
      },
      model: {
        enabled: true,
        minSamplesForInference: 30,
        minTrainRows: 48,
        minPositiveRows: 8,
        minNegativeRows: 12,
        onlineLearningRate: 0.05,
        trainEpochs: 5,
        l2: 0.0015,
        outcomeMode: "target_stop_priority",
        timeoutNetRetDeadband: 0.002,
        targetHitWeight: 1.8,
        stopHitWeight: 2.1,
        timeoutPositiveWeight: 0.45,
        timeoutNegativeWeight: 0.9
      },
      viewWeights: {
        expectedRet: 12,
        quality: 0.12,
        anti: 0.08,
        pHit: 0.6,
        pFill: 0.3,
        pStop: 0.45,
        slippageRisk: 0.18,
        margin: 0.15
      },
      stabilityWeights: {
        expectedRet: 10,
        quality: 0.14,
        anti: 0.1,
        pHit: 0.65,
        pFill: 0.32,
        pStop: 0.55,
        slippageRisk: 0.22,
        margin: 0.2
      }
    },
    scoreRecovery: {
      enabled: false,
      mode: "off",
      allowedGateReasons: ["SCORE_BELOW_MIN", "SCORE_MARGIN_LOW"],
      maxFinalScoreShortfall: 0.02,
      maxScoreMarginShortfall: 0.002,
      minRawSimilarity: 0.255,
      minLocalStageScore: 0.44,
      minExpectedNetRet3d: 0,
      maxFalsePositiveRisk: 0.52,
      minFillProb: 0.75,
      pathGuards: {
        allowedRuleDayTypes: [],
        allowedDayTypes: [],
        allowedPolicySources: [],
        maxAvgSlippageRisk: null
      }
    },
    scoreRecalibration: {
      enabled: false,
      mode: "off",
      allowedPrimaryComponents: [],
      allowedPrimarySubcomponents: [],
      subcomponentPolicies: {},
      eraSupportReasonPolicies: {},
      maxPenaltyCapByComponent: {
        POST_ADJUST_HEAVY: 0.04,
        REGIME_EXPERT_HEAVY: 0.04,
        EXTENDED_BIAS_HEAVY: 0.02,
        TRADE_QUALITY_HEAVY: 0.03,
        EXECUTION_PRIOR_HEAVY: 0.03
      },
      maxPenaltyCapBySubcomponent: {},
      baseScoreFloor: 0.24,
      minRawSimilarity: 0.255,
      minLocalStageScore: 0.44,
      minExpectedNetRet3d: 0,
      minFillProb: 0.75
    },
    perfectPrototypeGate: {
      enabled: false,
      mode: "off",
      catalogPath: "",
      expectedCatalogSha256: "",
      expectedRuleIdsSha256: "",
      selectionMode: "champion_only",
      dedupeSymbolsPerDay: true,
      maxRulesPerSymbol: 8
    },
    adaptiveMinFinalScore: {
      enabled: false,
      targetMinPicked: 60,
      targetMaxPicked: 80,
      step: 0.003,
      hysteresis: 2,
      warmupDays: 8
    },
    calibration: {
      enabled: true
    },
    metaSelector: {
      enabled: true,
      allowNoTrade: true,
      executionDiagnosticMode: false,
      pStopMode: "threshold",
      softReasons: [],
      tradeThresholds: {
        minCalibratedPHit: 0.62,
        maxPStopFirst: 0.45,
        minFillProb: 0.55,
        minConfidence: 0.2
      },
      shadowThresholds: {
        minCalibratedPHit: 0.52,
        maxPStopFirst: 0.55,
        minFillProb: 0.4,
        minConfidence: 0.1
      },
      tradeUtilityFloor: 0.05,
      shadowUtilityFloor: -0.1
    },
    regimeExperts: {
      enabled: true,
      lowVolAction: "BLOCK",
      lowVolScoreMultiplier: 0.8,
      highVolScoreMultiplier: 1,
      midVolScoreMultiplier: 1,
      defaultScoreMultiplier: 1
    },
    orderSimulator: {
      enabled: true,
      minFillProb: 0.55,
      maxSlippageBps: 25,
      feeBps: 15,
      baseSlippageBps: 8,
      spreadWeight: 120,
      volatilityWeight: 80,
      illiquidityWeight: 90
    },
    executionGate: {
      enabled: true,
      targetLcb: 0.7,
      minGlobalSamples: 80,
      requireGlobalFloor: true,
      blockWhenGlobalUnknown: true,
      shadowWhenGlobalUnknown: false,
      requireRegimeApproval: true,
      minRegimeSamples: 20,
      blockWhenRegimeUnknown: false,
      shadowWhenRegimeUnknown: true,
      enforceHardGlobalFloor: true,
      feedbackDelayDays: 1,
      calibrationWindowDays: 120,
      feedbackScope: "update_only",
      strongEdgeOverride: {
        enabled: false,
        bypassCalibrationFloor: false,
        allowedMetaReasons: [],
        allowedUncertaintyReasons: [],
        minQualityScore: 0.58,
        maxAntiScore: 0.15,
        minFillProb: 0.8,
        minTargetRate3d: 0.55,
        minExpectedNetRet3d: 0.008,
        minConfidence: 0.1,
        minFinalScore: 0.65,
        minScoreMargin: 0.003,
        maxPStopFirst: 0.52,
        temporalStability: {
          enabled: false,
          minEraCoverageRatio: 0.75,
          maxSingleEraShare: 0.4,
          minEraSupportCount: 3,
          minEraSupportMin: 8,
          maxEraWinRateStd: 0.15,
          maxEraExpectedNetRetStd: 0.015,
          maxEraContrastiveLiftStd: null
        }
      },
      agreementGuard: {
        enabled: false,
        defaultAction: "shadow",
        defaultReasonMode: "inherit",
        targetFirstBypass: {
          enabled: false,
          allowedReasons: ["AGREEMENT_CONSENSUS_LOW", "AGREEMENT_STABILITY_LOW"],
          minTargetRate3d: 0.95,
          maxStopRate3d: 0.05,
          minTargetStopEdge3d: 0.75,
          minExpectedNetRet3d: 0.05,
          minFillProb: 0.8,
          maxPStopFirst: 0.22,
          minConfidence: 0.35,
          minQualityScore: 0.48,
          minFinalScore: 0.78,
          minScoreMargin: 0.002
        },
        defaults: {
          minTargetStopEdge3d: 0.08,
          minExpectedNetRet3d: 0.02,
          minFillProb: 0.78,
          maxPStopFirst: 0.5,
          minConfidence: 0.05,
          minTradeQualityPrototypeResidual: null,
          minQualityScore: null,
          minScoreMargin: 0.0015
        },
        contracts: {
          AGREEMENT_CONSENSUS_LOW: {
            enabled: false
          },
          AGREEMENT_STABILITY_LOW: {
            enabled: false
          },
          AGREEMENT_SCORE_LOW: {
            enabled: false
          }
        },
        reasonModes: {
          AGREEMENT_CONSENSUS_LOW: "inherit",
          AGREEMENT_STABILITY_LOW: "inherit",
          AGREEMENT_SCORE_LOW: "inherit"
        }
      },
      uncertainty: {
        minScoreMargin: 0.001,
        minFinalScore: null,
        minExpectedNetRet3d: -0.001,
        minQualityScore: 0.58,
        minTargetRate3d: 0.5,
        minTargetStopEdge3d: 0.06,
        maxStopRate3d: 0.45,
        minRerankUtilityGain: null,
        softReasons: []
      },
      liquidity: {
        enabled: true,
        minLiquidityRatio: 0.6,
        minAvgTradingValue20dKrw: 800_000_000,
        hardCapMinAvgTradingValue20dKrw: 1_200_000_000,
        blockWhenAvgTradingValueUnknown: true,
        maxDataFreshnessDays: 1,
        blockedRegimePrefixes: ["VOL_LOW_"],
        blockRiskCodes: ["LOW_LIQUIDITY_SOFT", "SMALL_MARKET_CAP"]
      }
    },
    falsePositiveGate: {
      enabled: true,
      action: "shadow",
      maxRisk: 0.58,
      minGlobalSamples: 48,
      minSegmentSamples: 12,
      blockWhenUnknown: false,
      shadowWhenUnknown: true,
      calibrationWindowDays: 160,
      history: {
        priorCount: 8,
        priorRisk: 0.5,
        globalWeight: 0.4,
        routeBucketWeight: 0.25,
        regimeWeight: 0.2,
        prototypeWeight: 0.15
      },
      heuristics: {
        enabled: true,
        weight: 0.35,
        pStopWeight: 1.2,
        lowFillWeight: 0.9,
        lowMarginWeight: 0.8,
        lowQualityWeight: 0.65,
        antiScoreWeight: 0.7,
        slippageRiskWeight: 0.6,
        lowLiquidityWeight: 0.55,
        negativeExpectedRetWeight: 0.5,
        minScoreMargin: 0.0015,
        minFillProb: 0.55,
        minQualityScore: 0.58,
        minAvgTradingValue20dKrw: 800_000_000,
        expectedRetScale: 0.015,
        slippageRiskScale: 0.08
      },
      model: {
        enabled: true,
        minSamplesForInference: 24,
        minTrainRows: 40,
        minPositiveRows: 6,
        minNegativeRows: 12,
        onlineLearningRate: 0.08,
        trainEpochs: 6,
        l2: 0.002,
        decisionMode: "model_only"
      }
    },
    dayTypeRouter: {
      enabled: true,
      sampleSize: 5,
      strongCandidate: {
        minQualityScore: 0.64,
        minExpectedNetRet3d: 0.01,
        minMargin: 0.0035,
        minPHit: 0.62
      },
      classifiers: {
        trend: {
          minTop1Margin: 0.006,
          minTop1QualityScore: 0.64,
          minTop1ExpectedNetRet3d: 0.01,
          minAvgPHit: 0.62,
          minStrongCandidateShare: 0.4
        },
        noise: {
          maxTop1Margin: 0.0025,
          maxTop1QualityScore: 0.62,
          maxTop1ExpectedNetRet3d: 0.006,
          maxAvgPHit: 0.58,
          maxStrongCandidateShare: 0.25
        },
        executionHostile: {
          minAvgSlippageRisk: 0.08,
          maxMedianLiquidityKrw: 1_800_000_000,
          maxAvgFillProb: 0.72,
          minLowFillShare: 0.4
        },
        noTrade: {
          maxTop1ExpectedNetRet3d: 0.002,
          maxAvgPHit: 0.53,
          maxStrongCandidateShare: 0.12
        },
        meanReversion: {
          maxTop1Margin: 0.003,
          minAvgPHit: 0.58,
          minTop1ExpectedNetRet3d: 0.006
        },
        gapFadeRisk: {
          minTop1Margin: 0.004,
          minTop1ExpectedNetRet3d: 0.008,
          maxAvgPHit: 0.6,
          minLowFillShare: 0.2
        },
        thinLiquidityTrap: {
          maxMedianLiquidityKrw: 1_200_000_000,
          minLowLiquidityShare: 0.5,
          minAvgSlippageRisk: 0.05
        }
      },
      policies: {
        BALANCED: {},
        TREND: {
          minFinalScoreDelta: -0.004,
          minExpectedNetRet3dDelta: -0.001,
          minScoreMarginMultiplier: 0.9,
          maxPicksPerDay: 1,
          tauExecMultiplier: 0.98,
          tauFpMultiplier: 1.02,
          maxExecutedPicks: 1,
          maxFragileExecuted: 1,
          maxLowLiquidityExecuted: 0,
          maxExecutionHostileExecuted: 1,
          maxSameRouteBucket: 1,
          maxSameRegimeTag: 1,
          maxSamePrototypeFamily: 1
        },
        MEAN_REVERSION: {
          minFinalScoreDelta: 0.003,
          minExpectedNetRet3dDelta: 0.001,
          minScoreMarginMultiplier: 1.1,
          maxPicksPerDay: 1,
          tauExecMultiplier: 1.02,
          tauFpMultiplier: 0.97,
          maxExecutedPicks: 1,
          maxFragileExecuted: 1,
          maxLowLiquidityExecuted: 0,
          maxExecutionHostileExecuted: 0,
          maxSameRouteBucket: 1,
          maxSameRegimeTag: 1,
          maxSamePrototypeFamily: 1
        },
        GAP_FADE_RISK: {
          noTrade: true,
          minFinalScoreDelta: 0.008,
          minExpectedNetRet3dDelta: 0.002,
          minScoreMarginMultiplier: 1.3,
          maxPicksPerDay: 1,
          tauExecMultiplier: 1.08,
          tauFpMultiplier: 0.9,
          maxExecutedPicks: 0,
          maxFragileExecuted: 0,
          maxLowLiquidityExecuted: 0,
          maxExecutionHostileExecuted: 0,
          maxSameRouteBucket: 0,
          maxSameRegimeTag: 0,
          maxSamePrototypeFamily: 0
        },
        NOISE: {
          noTrade: true,
          minFinalScoreDelta: 0.01,
          minExpectedNetRet3dDelta: 0.002,
          minScoreMarginMultiplier: 1.4,
          maxPicksPerDay: 1,
          tauExecMultiplier: 1.08,
          tauFpMultiplier: 0.9,
          maxExecutedPicks: 0,
          maxFragileExecuted: 0,
          maxLowLiquidityExecuted: 0,
          maxExecutionHostileExecuted: 0,
          maxSameRouteBucket: 0,
          maxSameRegimeTag: 0,
          maxSamePrototypeFamily: 0
        },
        EXECUTION_HOSTILE: {
          minFinalScoreDelta: 0.006,
          minExpectedNetRet3dDelta: 0.001,
          minScoreMarginMultiplier: 1.2,
          maxPicksPerDay: 1,
          tauExecMultiplier: 1.08,
          tauFpMultiplier: 0.92,
          maxExecutedPicks: 1,
          maxFragileExecuted: 0,
          maxLowLiquidityExecuted: 0,
          maxExecutionHostileExecuted: 0,
          maxSameRouteBucket: 1,
          maxSameRegimeTag: 1,
          maxSamePrototypeFamily: 1
        },
        THIN_LIQUIDITY_TRAP: {
          noTrade: true,
          minFinalScoreDelta: 0.012,
          minExpectedNetRet3dDelta: 0.002,
          minScoreMarginMultiplier: 1.5,
          maxPicksPerDay: 1,
          tauExecMultiplier: 1.1,
          tauFpMultiplier: 0.88,
          maxExecutedPicks: 0,
          maxFragileExecuted: 0,
          maxLowLiquidityExecuted: 0,
          maxExecutionHostileExecuted: 0,
          maxSameRouteBucket: 0,
          maxSameRegimeTag: 0,
          maxSamePrototypeFamily: 0
        },
        NO_TRADE: {
          noTrade: true,
          minFinalScoreDelta: 0.012,
          minExpectedNetRet3dDelta: 0.002,
          minScoreMarginMultiplier: 1.5,
          maxPicksPerDay: 1,
          tauExecMultiplier: 1.1,
          tauFpMultiplier: 0.88,
          maxExecutedPicks: 0,
          maxFragileExecuted: 0,
          maxLowLiquidityExecuted: 0,
          maxExecutionHostileExecuted: 0,
          maxSameRouteBucket: 0,
          maxSameRegimeTag: 0,
          maxSamePrototypeFamily: 0
        }
      },
      model: {
        enabled: true,
        minTrainingRows: 40,
        minSamplesForInference: 30,
        minClassRows: 4,
        minConfidence: 0.58,
        minConfidenceGap: 0.08,
        preferModelWhenAvailable: true,
        allowAggressiveOverride: false,
        overrideMode: "prefer_model",
        noTradeOverrideMode: "allow",
        emitShadowDecision: true,
        edgeTradeEscape: {
          enabled: false,
          minTop1ExpectedNetRet3d: 0.015,
          maxAvgSlippageRisk: 0.116,
          minAvgFillProb: 0.99,
          minTop1Margin: 0,
          allowedRuleDayTypes: ["THIN_LIQUIDITY_TRAP"],
          allowedPredictedDayTypes: ["GAP_FADE_RISK"],
          policyOverrides: {
            noTrade: false,
            minFinalScoreDelta: -0.03,
            minExpectedNetRet3dDelta: 0.002,
            minScoreMarginMultiplier: 0,
            tauExecMultiplier: 1.08,
            tauFpMultiplier: 0.9,
            maxPicksPerDay: 1,
            maxExecutedPicks: 1,
            maxFragileExecuted: 1,
            maxLowLiquidityExecuted: 1,
            maxExecutionHostileExecuted: 1,
            maxSameRouteBucket: 1,
            maxSameRegimeTag: 1,
            maxSamePrototypeFamily: 1
          }
        }
      }
    },
    opportunityBudget: {
      enabled: true,
      action: "shadow",
      maxExecutedPicks: 1,
      maxFragileExecuted: 1,
      maxLowLiquidityExecuted: 0,
      maxExecutionHostileExecuted: 1,
      maxSameRouteBucket: 1,
      maxSameRegimeTag: 1,
      maxSamePrototypeFamily: 1,
      fragileMaxFalsePositiveRisk: 0.52,
      fragileMinScoreMargin: 0.002,
      lowLiquidityMinAvgTradingValue20dKrw: 1_200_000_000,
      executionHostileMaxSlippageRisk: 0.08,
      executionHostileMinFillProb: 0.75
    },
    regimeRouter: {
      enabled: true,
      routingMode: "vol3",
      defaultBucket: "__DEFAULT__",
      strictWeightLoad: false,
      bucketMap: {},
      weightsByBucket: {}
    }
  },
  onlineLearning: {
    enabled: true,
    learningRate: 0.03,
    reinforceBeta: 0.2,
    weightFloor: 0.01,
    startWeightsPath: "",
    generalization: {
      enabled: false,
      promotionScope: "eval",
      useEvalForPromotion: true,
      mode: "chronological",
      updateRatio: 0.7,
      evalMinDays: 20,
      targetPickedControlDays: 0,
      feedbackDelayDays: 1,
      purgeGapDays: 2,
        pairwise: {
          enabled: true,
          positiveTopN: 3,
          negativeTopN: 5,
          pairwiseWeight: 1,
          hardNegativeWeight: 1.5
        }
      }
    },
  holdoutPolicy: {
    enabled: true,
    frozenEvalOnlyForFinal: true,
    forbidEvalDrivenPromotion: false,
    minEvalDays: 20,
    minLockboxDays: 20,
    minFeedbackDelayDays: 1
  },
  qualityGate: {
    enabled: true,
    minEvalSamples: 20,
    minPickCountEval: 15,
    maxPickCountEval: 24,
    minPickHitRateEval: 0.35,
    minPickHitRateEvalLcb95: 0.18,
    minHitAt1Eval: 0.35,
    maxTopKOracleGapEval: 0.02,
    minOracleHitRateTopKEval: 0.95,
    requireZeroLookaheadViolations: true
  },
  runManifest: {
    enabled: true,
    requireConfigHash: true,
    requireCodeHash: true,
    requireSeedPath: true
  },
  bundlePolicy: {
    enabled: true,
    maxArchiveMb: 200,
    profile: "slim",
    includeStepCArtifacts: true,
    excludeHeavyDailyLogs: true
  },
  opsSlo: {
    enabled: true,
    maxStepDMinutes: 30,
    maxMemoryMb: 8192,
    maxFailureRatePct: 1,
    rollbackOnGateFail: true
  },
  smokeConfirm: {
    phase: "both",
    smokeRuns: 3,
    confirmRuns: 12,
    stopOnSmokeFailure: true,
    forceStepC: false
  },
  cdLoop: {
    maxRounds: 3,
    minEpochsPerRound: 2,
    maxEpochsPerRound: 4,
    plateauEpochs: 2,
    minHitRateImprove: 0.0015,
    stopNoImproveRounds: 2,
    stagnationRoundsBeforeRebuildC: 1,
    finalStopNoImproveRounds: 2,
    minUsageForDrop: 12,
    dropHitRateDelta: 0.02,
    dropMinAvgRegret: 0.01,
    dropMinMissRate: 0.75,
    dropStreakRounds: 2,
    perRoundDropCapRatio: 0.25,
    clusterMinKeep: 2,
    rapidImproveHitRateDelta: 0.05,
    unstableNoCandidateRateDelta: 0.02,
    unstableRegretDelta: 0.01,
    minOnePickDaysForPromotion: 1,
    minPickedCountForPromotion: 20,
    maxPickedCountForPromotion: 80,
    maxTwoPickDaysForPromotion: 0,
    zeroOnePickResetStreak: 2,
    weightCarry: {
      enabled: true,
      maxPrototypeChangeRate: 0.35
    },
    scoreMarginSweep: {
      enabled: true,
      deltas: [-0.005, -0.003, 0, 0.003, 0.005],
      minPickHitRateGain: 0.0015,
      minPickHitCountGain: 1
    },
    inversion: {
      enabled: true,
      enableOnStreak: 2,
      disableOnStreak: 2,
      minDualPickDays: 12,
      minRateDelta: 0.06,
      minBeatDays: 2,
      boostStep: 0.004,
      maxSecondBoost: 0.02,
      maxSwapMargin: 0.02,
      qualityWeight: 0.04
    },
    secondPickController: {
      enabled: true,
      minSamples: 12,
      rateMargin: 0.012,
      expectedAdvantageMargin: 0.0025,
      expectedOverrideMaxRatePenalty: 0.004,
      gapStep: 0.0012,
      minGap: 0.01,
      maxGap: 0.022,
      expectedStep: 0.0015,
      minExpectedFloor: 0.02,
      maxMinExpected: 0.03
    },
    commonState: {
      enabled: true,
      emaAlpha: 0.35,
      emaFloor: 0.08,
      fullConfidencePicks: 30,
      minTradesPerScore: 3,
      fullConfidenceTrades: 10,
      maxPrototypeScores: 180,
      maxRegimeScores: 80,
      minAbsScore: 0.03
    },
    stability: {
      enabled: true,
      windowRounds: 5,
      minImprovedRounds: 3,
      maxPickHitRateStd: 0.2,
      maxPickHitRateLcbStd: 0.12
    },
    swa: {
      enabled: true,
      topRounds: 5,
      minRounds: 3,
      maxPickHitRateStd: 0.2,
      maxPickHitRateLcbStd: 0.12
    },
    lockboxGate: {
      enabled: true,
      goalMode: "LEGACY_PNL_V1",
      positionSemantics: "SINGLE_POSITION_V1",
      minTrades: 10,
      minTargetHitCount: 0,
      minTargetHitRate: null,
      minTargetHitsPer20TradingDays: null,
      maxStopRate: null,
      maxTimeoutNegativeRate: null,
      minWinRate: 0.45,
      minAvgNetRet: 0,
      minCumulativeReturn: 0,
      maxDrawdown: 0.35,
      requireZeroLookaheadViolations: true,
      maxPolicyDriftScore: null,
      minBucketConsistency: null,
      minRegimeConsistency: null,
      minAgreementDecisionConsistency: null,
      minAgreementReasonConsistency: null
    },
    acceptedBaselineProbeCycle: {
      enabled: true,
      enforceAcceptedBaselineParent: true,
      maxStructuralExperimentsPerPlateau: 1,
      minNoCodeProbesBeforePlateau: 2,
      plateauAfterNonImprovement: 3,
      plateauAfterStepEMissing: 2,
      requirePlateauForStructuralExperiment: true
    },
    researchProbeCycle: {
      enabled: true,
      parentSource: "candidate_peak",
      enforceResearchParent: true,
      maxStructuralExperimentsPerPlateau: 1,
      minNoCodeProbesBeforePlateau: 5,
      plateauAfterNonImprovement: 3,
      plateauAfterStepEMissing: 2,
      requirePlateauForStructuralExperiment: true
    },
    familyPool: {
      enabled: true,
      outputPath: "meta/family_pool.json",
      minProductionFamilies: 1,
      productionMinDTargetHitRate: 0.5,
      productionMinETargetHitRate: 0.5,
      watchlistMinDTargetHitRate: 0.4,
      watchlistMinETargetHitRate: 0.4,
      minDPickedDays: 8,
      minELockboxPicks: 8,
      minEraCoverageRatio: 0.5,
      minEntropyRatio: 0.2,
      requireRepresentativeFamily: true
    }
  },
  backtest: {
    goalMode: "LEGACY_PNL_V1",
    positionSemantics: "SINGLE_POSITION_V1",
    entry: "NEXT_DAY_OPEN",
    holdDays: 3,
    targetPct: 0.08,
    stopLossPct: 0.04,
    feeBps: 15,
    slippageBps: 5,
    singlePosition: true,
    maxNewEntriesPerDay: 1
  },
  pattern: {
    mode: "hybrid_150_40",
    maxPrototypes: 200,
    maxGlobalPrototypes: 300,
    maxLocalPrototypes: 480,
    globalClusterBins: 3,
    globalClusterBinMode: "adaptive",
    globalClusterMinBins: 3,
    globalClusterMaxBins: 5,
    minRuleSupportRatio: 0.03,
    ruleQuantiles: [0.3, 0.5, 0.7],
    permanentDropListPath: "",
    excludeFeatureGroups: [],
    quality: {
      enabled: true,
      minTradesPerCluster: 8,
      prototypeClusterBlend: 0.7,
      retScale: 0.08,
      weights: {
        winRate: 0.35,
        targetRate: 0.2,
        avgNetRet: 0.35,
        stopRate: 0.1
      }
    },
    antiPattern: {
      enabled: true,
      extraNegRetWeight: 0.5
    },
    contrastive: {
      enabled: true,
      blend: 0.35,
      minSamplesPerCluster: 30,
      liftCap: 3,
      antiNegRateWeight: 0.35
    },
    c0: {
      enabled: true,
      inputMode: "auto",
      minFamilySupport: 6,
      maxFamilyShare: 0.22,
      minEraCoverageRatio: 0.5,
      minEraCoverageRatioForBackfill: 0.5,
      minEffectiveEraCountRatio: 0.6,
      minEffectiveEraCountRatioForBackfill: 0.5,
      minNormalizedEraEntropy: 0.25,
      minNormalizedEraEntropyForBackfill: 0.2,
      maxSingleEraShare: 0.72,
      maxSingleEraShareForBackfill: 0.55,
      minShapeCohesion: 0.58,
      minFeatureCohesion: 0.56,
      maxNegativeContaminationRate: 0.38,
      shortlistFamilyCount: 18,
      familyBackfillFloor: 10,
      familyBackfillMax: 8,
      familySignature: {
        useGlobalBins: true,
        useShapeBucket: true,
        useFeatureBucket: true,
        useTemplateKindMix: false,
        useJumpBand: true,
        globalKeyCount: 3,
        featureKeyCount: 2
      },
      scoreWeights: {
        recurrence: 0.28,
        shapeCohesion: 0.18,
        featureCohesion: 0.16,
        eraCoverage: 0.14,
        effectiveEraCount: 0.08,
        normalizedEraEntropy: 0.08,
        regimeCoverage: 0.1,
        negativeContaminationPenalty: 0.08,
        singleEraPenalty: 0.04,
        failedBreakoutPenalty: 0.03,
        gapContinueBonus: 0.02,
        gapRevertPenalty: 0.02,
        executionFeasibilityBonus: 0.02,
        prototypeQualityBonus: 0.05,
        corePrototypeShareBonus: 0.04,
        penaltyPrototypePenalty: 0.03,
        quarantinePrototypePenalty: 0.04,
        failedBreakoutScale: 4,
        overCommonNoisePenalty: 0.02
      }
    },
    c1: {
      enabled: true,
      maxProbeFamilies: 18,
      explicitFamilyIds: [],
      minFamilySupport: 6,
      maxFamilyRepresentatives: 96,
      probeProfile: "C1_FAMILY_PROBE",
      probeScope: "update",
      familyPassMinTargetHitRateEval: 0.1,
      familyPassMinExecutedTargetHitRateEval: 0.08,
      familyPassMinSelectionHitAt1Eval: 0.08,
      selectionHitAt1MetricMode: "raw",
      selectionHitAt1AgreementFallbackAwareMinDaysEval: 1,
      selectionHitAt1AgreementFallbackAwareAllowedPrimaryGateReasons: [
        "AGREEMENT_FALLBACK_PASS"
      ],
      familyPassMinPickedDaysEval: 4,
      familyPassMinTargetsPer20EvalDays: 0.8,
      familyPassMinExecutionCoverageEval: 0.2,
      familyPassMaxStopRateEval: 0.6,
      familyPassMaxTimeoutNegativeRateEval: 0.6,
      familyBackfillFloor: 4,
      familyBackfillMax: 4,
      retainTopProbeArtifacts: 0,
      cleanupScratch: true,
      lockboxEval: {
        enabled: false,
        persistArtifacts: false,
        minPickFloor: 1,
        maxConcurrentFamilies: 4
      },
      bundleEval: {
        enabled: false,
        minPickFloorDWeak: 6,
        minPickFloorEWeak: 6,
        minPickFloorDStrong: 10,
        minPickFloorEStrong: 10,
        defaultAbstainWhenNoConsensus: true,
        maxConcurrentBundles: 4
      },
      scoreWeights: {
        precision: 0.34,
        execution: 0.24,
        coverage: 0.22,
        rank: 0.12,
        prototypeQuality: 0.08,
        coreShareBonus: 0.04,
        penaltyPenalty: 0.03,
        quarantinePenalty: 0.04,
        stopPenalty: 0.05,
        timeoutPenalty: 0.03
      }
    },
    c2: {
      enabled: true,
      minFamiliesForDedup: 2,
      maxFamiliesForPairwise: 24,
      similarityThreshold: 0.72,
      top1AgreementThreshold: 0.7,
      symbolDayJaccardThreshold: 0.65,
      pickedDayJaccardThreshold: 0.65,
      executionOverlapThreshold: 0.55,
      maxBehaviorPenaltyDistance: 0.3,
      retainShadowFamilies: true,
      fallbackToC1IfTooSmall: true,
      minRepresentativeFamilies: 2,
      representativePolicy: "quality_first_with_coverage_guard",
      similarityPolicyVersion: "c2_overlap_graph_v1",
      targetCoverageNorm: 1,
      rankOverlapThreshold: 0.55,
      minRepresentativeTargetsPer20EvalDays: 0.2,
      minRepresentativeExecutionCoverageEval: 0.05,
      minRepresentativeScoreFloor: 0.18,
      scoreWeights: {
        symbolDay: 0.24,
        pickedDay: 0.18,
        top1: 0.18,
        rank: 0.12,
        execution: 0.14,
        regime: 0.08,
        behaviorPenalty: 0.06,
        precision: 0.34,
        executionQuality: 0.24,
        coverage: 0.22,
        rankQuality: 0.12,
        prototypeQuality: 0.08,
        coreShareBonus: 0.04,
        penaltyPenalty: 0.03,
        quarantinePenalty: 0.04,
        stopPenalty: 0.05,
        timeoutPenalty: 0.03
      }
    },
    prototypeSelection: {
      enabled: true,
      minPerCluster: 1,
      maxCandidatesPerCluster: 72,
      recentShare: 0.5,
      anchorShare: 0.5,
      recencyHalfLifeDays: 220,
      qualityWeight: 0.55,
      retWeight: 0.22,
      winRateWeight: 0.15,
      recencyWeight: 0.2,
      temporalDiversityWeight: 0.28,
      dominantEraPenaltyWeight: 0.14,
      minTemporalCoverageForEraBoost: 0.5,
      minTemporalEffectiveEraCountRatio: 0.55,
      minTemporalEntropyRatio: 0.25,
      antiPenaltyWeight: 0.24,
      maxPerSymbol: 4,
      maxClusterShare: 0.18,
      minDistinctClusters: 24,
      minClusterSupport: 5,
      minQualityTrades: 6,
      minContrastiveSamples: 18,
      minQualityScore: 0.5,
      minPrototypeFloor: 48,
      minNegativePrototypeFloor: 12,
      adaptiveFrontier: {
        enabled: true,
        candidateMode: "boost_penalty",
        minPrototypeFloor: 48,
        qualityAcceptThreshold: 0.56,
        qualityNearThreshold: 0.5,
        maxPrototypeCeil: 96,
        salvageBoostBias: 0.08,
        salvagePenaltyBias: 0.06,
        previousRunEAssistWeight: 0,
        previousRunEThreshold: 0.4,
        salvagePoolPath: "meta/salvaged_pattern_pool.json",
        quarantinePoolPath: "meta/pattern_quarantine_pool.json",
        prototypeLedgerPath: "meta/prototype_contribution_ledger.json",
        ledgerCoreBias: 0.08,
        ledgerPenaltyBias: 0.08,
        ledgerWatchlistBias: 0.03,
        ledgerMinConfidence: 0.35
      },
      minClusterFloor: 24,
      maxBackfillAdditions: 128,
      maxBackfillRatio: 2,
      relaxRounds: 6,
      relaxMinQualityScoreStep: 0.03,
      relaxMinContrastiveSamplesStep: 6
    },
    temporalStability: {
      enabled: true,
      eraCount: 4,
      warnMaxSingleEraShare: 0.6,
      warnMinEraCoverageRatio: 0.5,
      warnMinEffectiveEraCountRatio: 0.5,
      warnMinNormalizedEraEntropy: 0.2,
      selectionEnabled: true,
      minEraCoverageRatio: 0,
      maxSingleEraShare: 1,
      minEraSupportCount: 0,
      minEffectiveEraCountRatio: 0,
      minNormalizedEraEntropy: 0,
      maxEraWinRateStd: 1,
      prototypeEraCapEnabled: false,
      maxSelectedPrototypeEraShare: 1,
      returnTailRebalanceEnabled: false,
      targetSelectedExpectedNetRet3dAvg: 0,
      maxReturnTailSwaps: 0,
      minReturnTailExpectedNetRet3d: 0,
      minReturnTailQualityScore: 0,
      relaxMinEraCoverageRatioStep: 0.1,
      relaxMaxSingleEraShareStep: 0.05,
      relaxMinEraSupportCountStep: 1,
      relaxMinEffectiveEraCountRatioStep: 0.1,
      relaxMinNormalizedEraEntropyStep: 0.1,
      relaxMaxEraWinRateStdStep: 0
    },
    commonState: {
      enabled: true,
      confidenceScale: 1,
      prototypeWeight: 0.65,
      regimeWeight: 0.35,
      qualityBoost: 0.08,
      clusterQualityBoost: 0.06,
      antiPenaltyWeight: 0.08,
      antiReliefWeight: 0.04,
      maxAdjustment: 0.12
    }
  },
  guardrails: {
    enforceStepAEngineDuckdb: true,
    forbidLegacyEscapeEverywhere: true,
    enforceExactScorer: true,
    forbidApproximateIndexInStrict: true,
    enforceHybrid15040Contracts: true
  },
  lightweight: {
    enabled: true,
    pipeline: {
      preferLiteArtifacts: true
    },
    stepA: {
      engine: "duckdb",
      outputMode: "both",
      bitset: {
        enabled: true
      },
      duckdb: {
        enabled: true,
        cliPath: "tools/bin/duckdb",
        databasePath: ":memory:"
      }
    },
    stepB: {
      inputMode: "auto",
      outputMode: "both",
      roundFeatureDigits: 6,
      quantizeSeqScale: 10000,
      runtimePack: {
        enabled: true
      }
    },
    stepC: {
      inputMode: "auto"
    },
    stepD: {
      executionProfile: "full_audit",
      cdLoopEpochExecutionProfile: "inherit",
      persistOnlineAuditArtifactsInFastMode: true,
      persistOnlineFeaturePackRows: false,
      prepareLockboxDuringStepD: true,
      writeFeaturePackRows: false,
      writeDailyLogs: false,
      writeDecisionCandidatesIndex: false,
      reuseRuntimeCache: true,
      keepWorkerPoolAlive: true,
      scoringWorkers: 2,
      workerChunkSize: 384
    }
  },
  dataPaths: {
    candleDailyJsonl: "data/candle_daily.jsonl",
    universeJsonl: "data/universe_daily.jsonl",
    symbolMasterJsonl: "data/symbol_master.jsonl",
    hourly60mJsonl: "data/candle_hourly60m.jsonl",
    intraday1mRoot: "data/intraday_1m",
    intraday1mPresenceJsonl: "data/intraday_1m_presence_daily.jsonl",
    intradaySideInvestorDailyJsonl: "data/intraday_side/investor_daily.jsonl",
    intradaySideProgramDailyJsonl: "data/intraday_side/program_daily.jsonl",
    intradaySideTradeStrengthDailyJsonl: "data/intraday_side/trade_strength_daily.jsonl",
    intradaySideShortingDailyJsonl: "data/intraday_side/shorting_daily.jsonl",
    intradaySideLendingDailyJsonl: "data/intraday_side/lending_daily.jsonl",
    intradaySideCreditDailyJsonl: "data/intraday_side/credit_daily.jsonl",
    intradaySideSectorDailyJsonl: "data/intraday_side/sector_daily.jsonl",
    newsJsonl: "data/optional_empty.jsonl",
  }
}

export const loadConfig = async ({ configPath, cwd }) => {
  const resolved = configPath
    ? path.resolve(cwd, configPath)
    : path.resolve(cwd, "config/lab.config.json")
  const loadUserConfigWithExtends = async ({
    resolvedPath,
    stack = [],
  }) => {
    const nextStack = [...stack, resolvedPath]
    const userConfig = (await readJson(resolvedPath, {})) ?? {}
    const extendValue = String(userConfig?.extends ?? "").trim()
    const localConfig = { ...userConfig }
    delete localConfig.extends
    if (!extendValue) {
      return localConfig
    }
    const baseResolvedPath = path.resolve(path.dirname(resolvedPath), extendValue)
    if (nextStack.includes(baseResolvedPath)) {
      throw new Error(
        `Config extends cycle detected: ${[...nextStack, baseResolvedPath].join(" -> ")}`,
      )
    }
    const baseConfig = await loadUserConfigWithExtends({
      resolvedPath: baseResolvedPath,
      stack: nextStack,
    })
    return deepMerge(baseConfig, localConfig)
  }
  const userConfig = await loadUserConfigWithExtends({
    resolvedPath: resolved,
  })
  const merged = deepMerge(DEFAULT_CONFIG, userConfig)
  validateStrictConfig(merged)
  return { config: merged, configPath: resolved }
}

export const resolvePeriods = (config) => {
  const explicit = config?.periods
  if (explicit?.warmup?.from && explicit?.lockbox?.to) {
    return {
      warmup: {
        from: normalizeDateKey(explicit.warmup.from),
        to: normalizeDateKey(explicit.warmup.to)
      },
      discovery: {
        from: normalizeDateKey(explicit.discovery.from),
        to: normalizeDateKey(explicit.discovery.to)
      },
      online: {
        from: normalizeDateKey(explicit.online.from),
        to: normalizeDateKey(explicit.online.to)
      },
      lockbox: {
        from: normalizeDateKey(explicit.lockbox.from),
        to: normalizeDateKey(explicit.lockbox.to)
      }
    }
  }
  return computeTimelinePeriods(config?.timeline)
}

export const resolveSequenceWindow = (config) => {
  return resolveLocalWindow(config)
}

export const resolveLocalWindow = (config) => {
  const explicit = Number(config?.template?.localWindow)
  if (Number.isInteger(explicit) && explicit > 0) return explicit
  const raw = config?.template?.sequenceWindows
  const first = Array.isArray(raw) ? raw[0] : raw
  const n = Number(first)
  if (Number.isInteger(n) && n > 0) return n
  return 40
}

export const resolveGlobalWindow = (config) => {
  const localWindow = resolveLocalWindow(config)
  const explicit = Number(config?.template?.globalWindow)
  if (Number.isInteger(explicit) && explicit > localWindow) return explicit
  return 150
}
