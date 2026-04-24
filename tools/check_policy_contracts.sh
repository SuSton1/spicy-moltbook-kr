#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/check_policy_contracts.sh [--config=<path>]
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CFG_PATH="config/lab.config.server.lite.json"
for arg in "$@"; do
  case "$arg" in
    --config=*)
      CFG_PATH="${arg#--config=}"
      ;;
    *)
      echo "[fatal] unknown arg: $arg" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! -f "$CFG_PATH" ]]; then
  echo "[fatal] config not found: $CFG_PATH" >&2
  exit 1
fi
read_cfg_field() {
  local field_expr="$1"
  python3 - "$CFG_PATH" "$field_expr" <<'PY'
import json
import sys

cfg_path = sys.argv[1]
field_expr = sys.argv[2]
cfg = json.load(open(cfg_path, "r", encoding="utf-8"))

parts = [part for part in field_expr.split(".") if part]
value = cfg
for part in parts:
    if not isinstance(value, dict) or part not in value:
        value = None
        break
    value = value[part]

if value is None:
    print("")
else:
    print(value)
PY
}

goal_mode="$(read_cfg_field "backtest.goalMode")"
position_semantics="$(read_cfg_field "backtest.positionSemantics")"
goal_mode="${goal_mode:-LEGACY_PNL_V1}"
position_semantics="${position_semantics:-SINGLE_POSITION_V1}"

check_default_if_present() {
  local file_path="$1"
  local pattern="$2"
  local message="$3"
  if [[ ! -f "$file_path" ]]; then
    echo "[warn] skip optional contract: missing $file_path" >&2
    return 0
  fi
  grep -q "$pattern" "$file_path" || {
    echo "[fatal] $message" >&2
    exit 1
  }
}

if [[ "$goal_mode" == "TARGET_FIRST_V2" && "$position_semantics" == "OVERLAP_DAILY_ONE_PICK_V2" ]]; then
  python3 - "$CFG_PATH" <<'PY'
import json
import sys

cfg_path = sys.argv[1]
cfg = json.load(open(cfg_path, "r", encoding="utf-8"))
H = cfg["holdoutPolicy"]
OL = cfg["onlineLearning"]["generalization"]
DG = cfg["decisionGate"]
CD = cfg["cdLoop"]
Q = cfg["qualityGate"]
BT = cfg["backtest"]
PT = cfg["pattern"]["prototypeSelection"]
C0 = cfg["pattern"].get("c0", {})
C1 = cfg["pattern"].get("c1", {})
C2 = cfg["pattern"].get("c2", {})
SM = cfg["smokeConfirm"]
BP = cfg["bundlePolicy"]
OPS = cfg["opsSlo"]

checks = {
    "holdout.enabled": H.get("enabled") is True,
    "holdout.frozenEvalOnlyForFinal": H.get("frozenEvalOnlyForFinal") is True,
    "holdout.forbidEvalDrivenPromotion": H.get("forbidEvalDrivenPromotion") is False,
    "holdout.minFeedbackDelayDays": (H.get("minFeedbackDelayDays") or 0) >= 1,
    "online.promotionScope": OL.get("promotionScope") == "eval",
    "online.useEvalForPromotion": OL.get("useEvalForPromotion") is True,
    "online.feedbackDelayDays": (OL.get("feedbackDelayDays") or 0) >= (H.get("minFeedbackDelayDays") or 1),
    "execution.feedbackScope": DG["executionGate"].get("feedbackScope") == "update_only",
    "execution.feedbackDelayDays": (DG["executionGate"].get("feedbackDelayDays") or 0) >= (H.get("minFeedbackDelayDays") or 1),
    "fp.enabled": DG["falsePositiveGate"].get("enabled") is True,
    "fp.maxRisk": (DG["falsePositiveGate"].get("maxRisk") if DG["falsePositiveGate"].get("maxRisk") is not None else 2) <= 1,
    "fp.unknownGuard": (DG["falsePositiveGate"].get("blockWhenUnknown") is True) or (DG["falsePositiveGate"].get("shadowWhenUnknown") is True),
    "fp.model.enabled": DG["falsePositiveGate"]["model"].get("enabled") is True,
    "fp.model.minSamples": (DG["falsePositiveGate"]["model"].get("minSamplesForInference") or 0) >= 1,
    "fp.model.minTrainRows": (DG["falsePositiveGate"]["model"].get("minTrainRows") or 0) >= 1,
    "fp.model.decisionMode": (DG["falsePositiveGate"]["model"].get("decisionMode") or "model_only") == "model_only",
    "decision.maxPicksPerDay": (DG.get("maxPicksPerDay") or 0) == 1,
    "decision.similarityGate.enabled": DG.get("similarityGate", {}).get("enabled") is True,
    "decision.similarityGate.minRawSimilarity": 0 <= (DG.get("similarityGate", {}).get("minRawSimilarity") or 0) <= 1,
    "decision.similarityGate.minLocalStageScore": 0 <= (DG.get("similarityGate", {}).get("minLocalStageScore") or 0) <= 1,
    "decision.similarityGate.minTriggerStageScore": 0 <= (DG.get("similarityGate", {}).get("minTriggerStageScore") or 0) <= 1,
    "decision.similarityDisambiguation.enabled": isinstance(DG.get("similarityDisambiguation", {}).get("enabled"), bool),
    "decision.similarityDisambiguation.minTop1Top2Gap": 0 <= (DG.get("similarityDisambiguation", {}).get("minTop1Top2Gap") or 0) <= 1,
    "decision.similarityDisambiguation.minPositiveNegativeGap": 0 <= (DG.get("similarityDisambiguation", {}).get("minPositiveNegativeGap") or 0) <= 1,
    "decision.similarityDisambiguation.negativeBuckets": len(DG.get("similarityDisambiguation", {}).get("negativeBuckets") or []) >= 1,
    "decision.scoreRecovery.enabled": isinstance(DG.get("scoreRecovery", {}).get("enabled"), bool),
    "decision.scoreRecovery.mode": (DG.get("scoreRecovery", {}).get("mode") or "off") in {"off", "shadow", "hard"},
    "decision.scoreRecovery.allowedGateReasons": isinstance(DG.get("scoreRecovery", {}).get("allowedGateReasons", []), list) and all(
        reason in {"SCORE_BELOW_MIN", "SCORE_MARGIN_LOW", "POLICY_TAU_RANK_LOW"}
        for reason in (DG.get("scoreRecovery", {}).get("allowedGateReasons") or [])
    ),
    "decision.scoreRecovery.maxFinalScoreShortfall": ((DG.get("scoreRecovery", {}).get("maxFinalScoreShortfall") if DG.get("scoreRecovery", {}).get("maxFinalScoreShortfall") is not None else 0) >= 0),
    "decision.scoreRecovery.maxScoreMarginShortfall": ((DG.get("scoreRecovery", {}).get("maxScoreMarginShortfall") if DG.get("scoreRecovery", {}).get("maxScoreMarginShortfall") is not None else 0) >= 0),
    "decision.scoreRecovery.minRawSimilarity": 0 <= ((DG.get("scoreRecovery", {}).get("minRawSimilarity") if DG.get("scoreRecovery", {}).get("minRawSimilarity") is not None else 0)) <= 1,
    "decision.scoreRecovery.minLocalStageScore": 0 <= ((DG.get("scoreRecovery", {}).get("minLocalStageScore") if DG.get("scoreRecovery", {}).get("minLocalStageScore") is not None else 0)) <= 1,
    "decision.scoreRecovery.maxFalsePositiveRisk": 0 <= ((DG.get("scoreRecovery", {}).get("maxFalsePositiveRisk") if DG.get("scoreRecovery", {}).get("maxFalsePositiveRisk") is not None else 0)) <= 1,
    "decision.scoreRecovery.minFillProb": 0 <= ((DG.get("scoreRecovery", {}).get("minFillProb") if DG.get("scoreRecovery", {}).get("minFillProb") is not None else 0)) <= 1,
    "decision.scoreRecalibration.enabled": isinstance(DG.get("scoreRecalibration", {}).get("enabled"), bool),
    "decision.scoreRecalibration.mode": (DG.get("scoreRecalibration", {}).get("mode") or "off") in {"off", "shadow", "hard"},
    "decision.scoreRecalibration.allowedPrimaryComponents": isinstance(DG.get("scoreRecalibration", {}).get("allowedPrimaryComponents", []), list) and all(
        component in {"POST_ADJUST_HEAVY", "REGIME_EXPERT_HEAVY", "EXTENDED_BIAS_HEAVY", "TRADE_QUALITY_HEAVY", "EXECUTION_PRIOR_HEAVY", "MIXED_DEEP_FAIL"}
        for component in (DG.get("scoreRecalibration", {}).get("allowedPrimaryComponents") or [])
    ),
    "decision.scoreRecalibration.allowedPrimarySubcomponents": isinstance(DG.get("scoreRecalibration", {}).get("allowedPrimarySubcomponents", []), list) and all(
        component in {
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
            "NEGATIVE_AFTER_COST_PENALTY",
        }
        for component in (DG.get("scoreRecalibration", {}).get("allowedPrimarySubcomponents") or [])
    ),
    "decision.scoreRecalibration.maxPenaltyCapByComponent": isinstance(DG.get("scoreRecalibration", {}).get("maxPenaltyCapByComponent", {}), dict) and all(
        key in {"POST_ADJUST_HEAVY", "REGIME_EXPERT_HEAVY", "EXTENDED_BIAS_HEAVY", "TRADE_QUALITY_HEAVY", "EXECUTION_PRIOR_HEAVY", "MIXED_DEEP_FAIL"} and value >= 0
        for key, value in (DG.get("scoreRecalibration", {}).get("maxPenaltyCapByComponent", {}) or {}).items()
    ),
    "decision.scoreRecalibration.maxPenaltyCapBySubcomponent": isinstance(DG.get("scoreRecalibration", {}).get("maxPenaltyCapBySubcomponent", {}), dict) and all(
        key in {
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
            "NEGATIVE_AFTER_COST_PENALTY",
        } and value >= 0
        for key, value in (DG.get("scoreRecalibration", {}).get("maxPenaltyCapBySubcomponent", {}) or {}).items()
    ),
    "decision.scoreRecalibration.subcomponentPolicies": isinstance(DG.get("scoreRecalibration", {}).get("subcomponentPolicies", {}), dict) and all(
        key in {
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
            "NEGATIVE_AFTER_COST_PENALTY",
        } and isinstance(value, dict) and
        ((value.get("maxPenaltyCap") is None) or value.get("maxPenaltyCap") >= 0) and
        ((value.get("requireMinEraCoverageRatio") is None) or (0 <= value.get("requireMinEraCoverageRatio") <= 1)) and
        ((value.get("requireMinEraSupportCount") is None) or value.get("requireMinEraSupportCount") >= 0) and
        ((value.get("requireMaxEraSupportShortfall") is None) or value.get("requireMaxEraSupportShortfall") >= 0) and
        ((value.get("requireMaxSingleEraShareExcess") is None) or (0 <= value.get("requireMaxSingleEraShareExcess") <= 1)) and
        ((value.get("requireMinFillProb") is None) or (0 <= value.get("requireMinFillProb") <= 1)) and
        (
            isinstance(value.get("allowedSecondarySubcomponents", []), list) and
            all(
                item in {
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
                    "NEGATIVE_AFTER_COST_PENALTY",
                }
                for item in (value.get("allowedSecondarySubcomponents") or [])
            )
        )
        for key, value in (DG.get("scoreRecalibration", {}).get("subcomponentPolicies", {}) or {}).items()
    ),
    "decision.scoreRecalibration.eraSupportReasonPolicies": isinstance(DG.get("scoreRecalibration", {}).get("eraSupportReasonPolicies", {}), dict) and all(
        key in {"LOW_SUPPORT_COUNT", "LOW_ERA_COVERAGE", "SINGLE_ERA_DOMINANCE"} and isinstance(value, dict) and
        ((value.get("maxPenaltyCap") is None) or value.get("maxPenaltyCap") >= 0) and
        ((value.get("requireMinEraCoverageRatio") is None) or (0 <= value.get("requireMinEraCoverageRatio") <= 1)) and
        ((value.get("requireMinEffectiveEraCount") is None) or value.get("requireMinEffectiveEraCount") >= 0) and
        ((value.get("requireMinEffectiveEraCountRatio") is None) or (0 <= value.get("requireMinEffectiveEraCountRatio") <= 1)) and
        ((value.get("requireMinEntropyRatio") is None) or (0 <= value.get("requireMinEntropyRatio") <= 1)) and
        ((value.get("requireMaxSingleEraShareExcess") is None) or (0 <= value.get("requireMaxSingleEraShareExcess") <= 1)) and
        ((value.get("requireMinFillProb") is None) or (0 <= value.get("requireMinFillProb") <= 1)) and
        (
            isinstance(value.get("allowedCompositeTypes", []), list) and
            all(
                item in {
                    "ERA_SUPPORT_ONLY",
                    "ERA_SUPPORT_PLUS_STOP_RATE",
                    "ERA_SUPPORT_PLUS_SLIPPAGE",
                    "ERA_SUPPORT_PLUS_REGIME",
                    "ERA_SUPPORT_PLUS_OTHER",
                }
                for item in (value.get("allowedCompositeTypes") or [])
            )
        )
        for key, value in (DG.get("scoreRecalibration", {}).get("eraSupportReasonPolicies", {}) or {}).items()
    ),
    "decision.scoreRecalibration.baseScoreFloor": 0 <= ((DG.get("scoreRecalibration", {}).get("baseScoreFloor") if DG.get("scoreRecalibration", {}).get("baseScoreFloor") is not None else 0)) <= 1,
    "decision.scoreRecalibration.minRawSimilarity": 0 <= ((DG.get("scoreRecalibration", {}).get("minRawSimilarity") if DG.get("scoreRecalibration", {}).get("minRawSimilarity") is not None else 0)) <= 1,
    "decision.scoreRecalibration.minLocalStageScore": 0 <= ((DG.get("scoreRecalibration", {}).get("minLocalStageScore") if DG.get("scoreRecalibration", {}).get("minLocalStageScore") is not None else 0)) <= 1,
    "decision.scoreRecalibration.minFillProb": 0 <= ((DG.get("scoreRecalibration", {}).get("minFillProb") if DG.get("scoreRecalibration", {}).get("minFillProb") is not None else 0)) <= 1,
    "decision.secondPick.disabled": ((DG.get("secondPick", {}).get("phase") or DG.get("secondPick", {}).get("mode") or "disabled") == "disabled"),
    "agreement.enabled": DG["agreementGate"].get("enabled") is True,
    "agreement.pool": (DG["agreementGate"].get("candidatePool") or 0) >= 10,
    "agreement.minScore": ((DG["agreementGate"].get("minAgreementScore") if DG["agreementGate"].get("minAgreementScore") is not None else -1) >= 0),
    "dayType.enabled": DG["dayTypeRouter"].get("enabled") is True,
    "dayType.sampleSize": (DG["dayTypeRouter"].get("sampleSize") or 0) >= 1,
    "dayType.model.enabled": DG["dayTypeRouter"]["model"].get("enabled") is True,
    "dayType.model.minTrainingRows": (DG["dayTypeRouter"]["model"].get("minTrainingRows") or 0) >= 1,
    "dayType.model.minConfidence": ((DG["dayTypeRouter"]["model"].get("minConfidence") if DG["dayTypeRouter"]["model"].get("minConfidence") is not None else -1) >= 0),
    "dayType.model.preferModelWhenAvailable": DG["dayTypeRouter"]["model"].get("preferModelWhenAvailable", True) is True,
    "meta.executionDiagnosticMode": DG["metaSelector"].get("executionDiagnosticMode", False) is False,
    "meta.noMinCalibratedPHit": "minCalibratedPHit" not in DG["metaSelector"],
    "meta.noMaxPStopFirst": "maxPStopFirst" not in DG["metaSelector"],
    "meta.noMinFillProb": "minFillProb" not in DG["metaSelector"],
    "meta.noMinConfidence": "minConfidence" not in DG["metaSelector"],
    "budget.enabled": DG["opportunityBudget"].get("enabled") is True,
    "budget.maxExecutedPicks": (DG["opportunityBudget"].get("maxExecutedPicks") if DG["opportunityBudget"].get("maxExecutedPicks") is not None else -1) >= 0,
    "budget.maxSamePrototypeFamily": (DG["opportunityBudget"].get("maxSamePrototypeFamily") or -1) == 1,
    "top1.pool": (DG["top1Rerank"].get("candidatePool") or 0) >= 10,
    "top1.enabledExplicit": DG["top1Rerank"].get("enabled") in (True, False),
    "similarity.topK": (cfg["similarity"].get("topK") or 0) >= 10,
    "backtest.goalMode": BT.get("goalMode") == "TARGET_FIRST_V2",
    "backtest.positionSemantics": BT.get("positionSemantics") == "OVERLAP_DAILY_ONE_PICK_V2",
    "backtest.singlePosition": BT.get("singlePosition") is False,
    "backtest.maxNewEntriesPerDay": BT.get("maxNewEntriesPerDay") == 1,
    "cd.commonState.enabled": CD["commonState"].get("enabled") is True,
    "cd.dOnlySprint.disabled": CD["dOnlySprint"].get("enabled") is False,
    "cd.researchGates.enabled": CD["researchGates"].get("enabled") is True,
    "cd.researchGates.minD": (CD["researchGates"]["lineDiscard"].get("minD") or 0) >= 0.40,
    "cd.researchGates.minE": (CD["researchGates"]["lineDiscard"].get("minE") or 0) >= 0.40,
    "cd.researchGates.promoteD": (CD["researchGates"]["parentPromotion"].get("minD") or 0) >= 0.50,
    "cd.researchGates.promoteE": (CD["researchGates"]["parentPromotion"].get("minE") or 0) >= 0.55,
    "adaptiveFrontier.enabled": PT.get("adaptiveFrontier", {}).get("enabled") is True,
    "adaptiveFrontier.minFloor": (PT.get("adaptiveFrontier", {}).get("minPrototypeFloor") or 0) >= 48,
    "adaptiveFrontier.acceptThreshold": (PT.get("adaptiveFrontier", {}).get("qualityAcceptThreshold") or 0) > 0,
    "adaptiveFrontier.ceil": (PT.get("adaptiveFrontier", {}).get("maxPrototypeCeil") or 0) >= (PT.get("minPrototypeFloor") or 48),
    "adaptiveFrontier.candidateMode": (PT.get("adaptiveFrontier", {}).get("candidateMode") or "") in {"boost_only", "penalty_only", "boost_penalty"},
    "adaptiveFrontier.previousRunEAssistWeight": (PT.get("adaptiveFrontier", {}).get("previousRunEAssistWeight") or 0) >= 0,
    "adaptiveFrontier.previousRunEAssistThreshold": (PT.get("adaptiveFrontier", {}).get("previousRunEThreshold") or 0) >= 0,
    "adaptiveFrontier.salvagePoolPath": bool((PT.get("adaptiveFrontier", {}).get("salvagePoolPath") or "").strip()),
    "adaptiveFrontier.quarantinePoolPath": bool((PT.get("adaptiveFrontier", {}).get("quarantinePoolPath") or "").strip()),
    "prototype.minTemporalCoverageForEraBoost": 0 <= (PT.get("minTemporalCoverageForEraBoost") or 0) <= 1,
    "prototype.minTemporalEffectiveEraCountRatio": 0 <= (PT.get("minTemporalEffectiveEraCountRatio") or 0) <= 1,
    "prototype.minTemporalEntropyRatio": 0 <= (PT.get("minTemporalEntropyRatio") or 0) <= 1,
    "c0.enabled": C0.get("enabled") is True,
    "c0.inputMode": (C0.get("inputMode") or "") in {"auto", "runtime_pack", "lite", "full"},
    "c0.minFamilySupport": (C0.get("minFamilySupport") or 0) >= 4,
    "c0.shortlistFamilyCount": (C0.get("shortlistFamilyCount") or 0) >= 8,
    "c0.familyBackfillFloor": (C0.get("familyBackfillFloor") or 0) >= 1,
    "c0.familyBackfillOrder": (C0.get("familyBackfillFloor") or 0) <= (C0.get("shortlistFamilyCount") or 0),
    "c0.minEraCoverageRatioForBackfill": 0 <= (C0.get("minEraCoverageRatioForBackfill") or 0) <= 1,
    "c0.minEffectiveEraCountRatio": 0 <= (C0.get("minEffectiveEraCountRatio") or 0) <= 1,
    "c0.minEffectiveEraCountRatioForBackfill": 0 <= (C0.get("minEffectiveEraCountRatioForBackfill") or 0) <= 1,
    "c0.minNormalizedEraEntropy": 0 <= (C0.get("minNormalizedEraEntropy") or 0) <= 1,
    "c0.minNormalizedEraEntropyForBackfill": 0 <= (C0.get("minNormalizedEraEntropyForBackfill") or 0) <= 1,
    "c0.maxSingleEraShareForBackfill": 0 <= (C0.get("maxSingleEraShareForBackfill") or 0) <= 1,
    "c0.scoreWeights.effectiveEraCount": (C0.get("scoreWeights", {}).get("effectiveEraCount") or 0) >= 0,
    "c0.scoreWeights.normalizedEraEntropy": (C0.get("scoreWeights", {}).get("normalizedEraEntropy") or 0) >= 0,
    "temporal.warnMinEffectiveEraCountRatio": 0 <= (cfg["pattern"].get("temporalStability", {}).get("warnMinEffectiveEraCountRatio") or 0) <= 1,
    "temporal.warnMinNormalizedEraEntropy": 0 <= (cfg["pattern"].get("temporalStability", {}).get("warnMinNormalizedEraEntropy") or 0) <= 1,
    "temporal.minEffectiveEraCountRatio": 0 <= (cfg["pattern"].get("temporalStability", {}).get("minEffectiveEraCountRatio") or 0) <= 1,
    "temporal.minNormalizedEraEntropy": 0 <= (cfg["pattern"].get("temporalStability", {}).get("minNormalizedEraEntropy") or 0) <= 1,
    "temporal.relaxMinEffectiveEraCountRatioStep": 0 <= (cfg["pattern"].get("temporalStability", {}).get("relaxMinEffectiveEraCountRatioStep") or 0) <= 1,
    "temporal.relaxMinNormalizedEraEntropyStep": 0 <= (cfg["pattern"].get("temporalStability", {}).get("relaxMinNormalizedEraEntropyStep") or 0) <= 1,
    "c1.enabled": C1.get("enabled") is True,
    "c1.maxProbeFamilies": (C1.get("maxProbeFamilies") or 0) >= 1,
    "c1.explicitFamilyIds": isinstance(C1.get("explicitFamilyIds", []), list) and all(
        isinstance(value, str) and value.strip()
        for value in (C1.get("explicitFamilyIds") or [])
    ),
    "c1.minFamilySupport": (C1.get("minFamilySupport") or 0) >= 1,
    "c1.maxFamilyRepresentatives": (C1.get("maxFamilyRepresentatives") or 0) >= 1,
    "c1.probeProfile": (C1.get("probeProfile") or "") == "C1_FAMILY_PROBE",
    "c1.familyPassMinTargetHitRateEval": 0 <= (C1.get("familyPassMinTargetHitRateEval") or 0) <= 1,
    "c1.familyPassMinExecutedTargetHitRateEval": 0 <= (C1.get("familyPassMinExecutedTargetHitRateEval") or 0) <= 1,
    "c1.familyPassMinSelectionHitAt1Eval": 0 <= (C1.get("familyPassMinSelectionHitAt1Eval") or 0) <= 1,
    "c1.familyPassMinPickedDaysEval": (C1.get("familyPassMinPickedDaysEval") or 0) >= 0,
    "c1.familyPassMinTargetsPer20EvalDays": (C1.get("familyPassMinTargetsPer20EvalDays") or 0) >= 0,
    "c1.familyPassMinExecutionCoverageEval": 0 <= (C1.get("familyPassMinExecutionCoverageEval") or 0) <= 1,
    "c1.familyPassMaxStopRateEval": 0 <= (C1.get("familyPassMaxStopRateEval") or 0) <= 1,
    "c1.familyPassMaxTimeoutNegativeRateEval": 0 <= (C1.get("familyPassMaxTimeoutNegativeRateEval") or 0) <= 1,
    "c1.familyBackfillFloor": (C1.get("familyBackfillFloor") or 0) >= 1,
    "c1.familyBackfillOrder": (C1.get("familyBackfillFloor") or 0) <= (C1.get("maxProbeFamilies") or 0),
    "c1.familyBackfillMax": (C1.get("familyBackfillMax") or 0) >= 0,
    "c1.retainTopProbeArtifacts": (C1.get("retainTopProbeArtifacts") or 0) >= 0,
    "c2.enabled": C2.get("enabled") is True,
    "c2.minFamiliesForDedup": (C2.get("minFamiliesForDedup") or 0) >= 2,
    "c2.maxFamiliesForPairwise": (C2.get("maxFamiliesForPairwise") or 0) >= (C2.get("minFamiliesForDedup") or 0),
    "c2.similarityThreshold": 0 <= (C2.get("similarityThreshold") or 0) <= 1,
    "c2.top1AgreementThreshold": 0 <= (C2.get("top1AgreementThreshold") or 0) <= 1,
    "c2.symbolDayJaccardThreshold": 0 <= (C2.get("symbolDayJaccardThreshold") or 0) <= 1,
    "c2.pickedDayJaccardThreshold": 0 <= (C2.get("pickedDayJaccardThreshold") or 0) <= 1,
    "c2.executionOverlapThreshold": 0 <= (C2.get("executionOverlapThreshold") or 0) <= 1,
    "c2.maxBehaviorPenaltyDistance": 0 <= (C2.get("maxBehaviorPenaltyDistance") or 0) <= 1,
    "c2.rankOverlapThreshold": 0 <= (C2.get("rankOverlapThreshold") or 0) <= 1,
    "c2.minRepresentativeFamilies": (C2.get("minRepresentativeFamilies") or 0) >= 1,
    "c2.minRepresentativeTargetsPer20EvalDays": (C2.get("minRepresentativeTargetsPer20EvalDays") or 0) >= 0,
    "c2.minRepresentativeExecutionCoverageEval": 0 <= (C2.get("minRepresentativeExecutionCoverageEval") or 0) <= 1,
    "c2.minRepresentativeScoreFloor": (C2.get("minRepresentativeScoreFloor") or 0) >= 0,
    "c2.representativePolicy": (C2.get("representativePolicy") or "") in {"quality_first_with_coverage_guard", "coverage_first_with_quality_floor"},
    "c2.similarityPolicyVersion": (C2.get("similarityPolicyVersion") or "") in {"c2_overlap_graph_v1", "c2_overlap_graph_strict_v1"},
    "c2.targetCoverageNorm": (C2.get("targetCoverageNorm") or 0) > 0,
    "artifactPolicy.tier": (cfg["lightweight"].get("artifactPolicy", {}).get("tier") or "") in {"exploratory", "confirm", "promotion"},
    "artifactPolicy.exploratory": isinstance(cfg["lightweight"].get("artifactPolicy", {}).get("exploratory"), dict),
    "artifactPolicy.confirm": isinstance(cfg["lightweight"].get("artifactPolicy", {}).get("confirm"), dict),
    "artifactPolicy.promotion": isinstance(cfg["lightweight"].get("artifactPolicy", {}).get("promotion"), dict),
    "debug.topK": (cfg["lightweight"]["stepD"]["sampledDebugLog"].get("topK") or 0) >= 10,
    "lightweight.writeFeaturePackRows": cfg["lightweight"]["stepD"].get("writeFeaturePackRows") is False,
    "lightweight.writeDecisionCandidatesIndex": cfg["lightweight"]["stepD"].get("writeDecisionCandidatesIndex") is False,
    "prototype.minFloor": (PT.get("minPrototypeFloor") or 0) >= 48,
    "prototype.clusterFloor": (PT.get("minClusterFloor") or 0) >= 24,
    "useMaxScoreMarginGate": DG.get("useMaxScoreMarginGate") is False,
    "quality.enabled": Q.get("enabled") is True,
    "quality.lockbox.enabled": Q["lockbox"].get("enabled") is True,
    "quality.lockbox.minTrades": (Q["lockbox"].get("minTrades") or 0) >= 1,
    "stepD.prepareLockbox": cfg["lightweight"]["stepD"].get("prepareLockboxDuringStepD") is False,
    "cd.lockbox.enabled": CD["lockboxGate"].get("enabled") is True,
    "cd.lockbox.goalMode": CD["lockboxGate"].get("goalMode") == "TARGET_FIRST_V2",
    "cd.lockbox.positionSemantics": CD["lockboxGate"].get("positionSemantics") == "OVERLAP_DAILY_ONE_PICK_V2",
    "cd.lockbox.minTrades": (CD["lockboxGate"].get("minTrades") or 0) >= (Q["lockbox"].get("minTrades") or 1),
    "cd.lockbox.minTargetHitCount": (CD["lockboxGate"].get("minTargetHitCount") or 0) >= 1,
    "cd.lockbox.minTargetHitRate": ((CD["lockboxGate"].get("minTargetHitRate") if CD["lockboxGate"].get("minTargetHitRate") is not None else -1) >= 0),
    "cd.lockbox.minTargetHitsPer20": ((CD["lockboxGate"].get("minTargetHitsPer20TradingDays") if CD["lockboxGate"].get("minTargetHitsPer20TradingDays") is not None else -1) >= 0),
    "cd.lockbox.maxStopRate": ((CD["lockboxGate"].get("maxStopRate") if CD["lockboxGate"].get("maxStopRate") is not None else 2) <= 1),
    "cd.lockbox.maxTimeoutNegativeRate": ((CD["lockboxGate"].get("maxTimeoutNegativeRate") if CD["lockboxGate"].get("maxTimeoutNegativeRate") is not None else 2) <= 1),
    "cd.lockbox.maxPolicyDriftScore": ((CD["lockboxGate"].get("maxPolicyDriftScore") if CD["lockboxGate"].get("maxPolicyDriftScore") is not None else 2) <= 1),
    "cd.lockbox.minBucketConsistency": ((CD["lockboxGate"].get("minBucketConsistency") if CD["lockboxGate"].get("minBucketConsistency") is not None else -1) >= 0),
    "cd.lockbox.minRegimeConsistency": ((CD["lockboxGate"].get("minRegimeConsistency") if CD["lockboxGate"].get("minRegimeConsistency") is not None else -1) >= 0),
    "cd.lockbox.minAgreementDecisionConsistency": ((CD["lockboxGate"].get("minAgreementDecisionConsistency") if CD["lockboxGate"].get("minAgreementDecisionConsistency") is not None else -1) >= 0),
    "cd.lockbox.minAgreementReasonConsistency": ((CD["lockboxGate"].get("minAgreementReasonConsistency") if CD["lockboxGate"].get("minAgreementReasonConsistency") is not None else -1) >= 0),
    "cd.lockbox.maxTraceMismatchRate": ((CD["lockboxGate"].get("maxTraceMismatchRate") if CD["lockboxGate"].get("maxTraceMismatchRate") is not None else 2) <= 1),
    "cd.lockbox.maxTraceCriticalMismatchDays": ((CD["lockboxGate"].get("maxTraceCriticalMismatchDays") if CD["lockboxGate"].get("maxTraceCriticalMismatchDays") is not None else -1) >= 0),
    "cd.lockbox.minFalsePositiveRejectedCount": ((CD["lockboxGate"].get("minFalsePositiveRejectedCount") if CD["lockboxGate"].get("minFalsePositiveRejectedCount") is not None else -1) >= 0),
    "cd.lockbox.minFalsePositiveRejectionPrecision": ((CD["lockboxGate"].get("minFalsePositiveRejectionPrecision") if CD["lockboxGate"].get("minFalsePositiveRejectionPrecision") is not None else -1) >= 0),
    "cd.lockbox.requireZeroLookahead": CD["lockboxGate"].get("requireZeroLookaheadViolations") is True,
    "promotionDebt.enabled": CD["promotionDebt"].get("enabled") is True,
    "promotionDebt.minFalsePositiveRejectedCountEval": ((CD["promotionDebt"].get("minFalsePositiveRejectedCountEval") if CD["promotionDebt"].get("minFalsePositiveRejectedCountEval") is not None else -1) >= 0),
    "promotionDebt.minFalsePositiveRejectionPrecisionEval": ((CD["promotionDebt"].get("minFalsePositiveRejectionPrecisionEval") if CD["promotionDebt"].get("minFalsePositiveRejectionPrecisionEval") is not None else -1) >= 0),
    "promotionDebt.requirePolicyFingerprintChange": CD["promotionDebt"].get("requirePolicyFingerprintChange", True) is True,
    "promotionDebt.requireLockboxEligible": CD["promotionDebt"].get("requireLockboxEligible", True) is True,
    "runManifest.enabled": cfg["runManifest"].get("enabled") is True,
    "bundlePolicy.enabled": BP.get("enabled") is True,
    "bundlePolicy.maxArchiveMb": (BP.get("maxArchiveMb") or 0) <= 200,
    "opsSlo.enabled": OPS.get("enabled") is True,
    "opsSlo.rollbackOnGateFail": OPS.get("rollbackOnGateFail") is True,
    "smoke.phase": SM.get("phase") in ("both", "smoke", "confirm"),
    "smoke.smokeRuns": (SM.get("smokeRuns") or -1) == 2,
    "smoke.confirmRuns": (SM.get("confirmRuns") or -1) == 4,
    "smoke.stopOnSmokeFailure": SM.get("stopOnSmokeFailure") is True,
    "cd.maxRounds": (CD.get("maxRounds") or -1) == 3,
    "cd.minEpochs": (CD.get("minEpochsPerRound") or -1) == 2,
    "cd.maxEpochs": (CD.get("maxEpochsPerRound") or -1) == 3,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    print("[fatal] target-first policy contract check failed:", ", ".join(failed), file=sys.stderr)
    raise SystemExit(1)
PY

  check_default_if_present \
    "tools/stepc_autorelax_select.sh" \
    'SWITCH_BASELINE=.*false' \
    "SWITCH_BASELINE default must be false"
  check_default_if_present \
    "tools/stepc_autorelax_select.sh" \
    'REQUIRE_FROZEN_EVAL_PASS=.*true' \
    "REQUIRE_FROZEN_EVAL_PASS default must be true"
  check_default_if_present \
    "meta/scripts/run_combined32_online.sh" \
    'CHAIN_SEED=.*false' \
    "CHAIN_SEED default must be false"
  check_default_if_present \
    "meta/scripts/run_combined32_online.sh" \
    'FAIL_ON_TOPK_GAP_MISMATCH=.*true' \
    "FAIL_ON_TOPK_GAP_MISMATCH default must be true"

  echo "[ok] policy contracts verified: $CFG_PATH"
  exit 0
fi

jq -e '
  (.backtest.goalMode // "LEGACY_PNL_V1") as $goalMode |
  (.backtest.positionSemantics // "SINGLE_POSITION_V1") as $positionSemantics |
  (
    if $goalMode == "TARGET_FIRST_V2" and $positionSemantics == "OVERLAP_DAILY_ONE_PICK_V2" then
      (.backtest.singlePosition // true) == false and
      (.backtest.maxNewEntriesPerDay // 0) == 1 and
      (.cdLoop.commonState.enabled // false) == true and
      (.cdLoop.dOnlySprint.enabled // true) == false and
      (.cdLoop.researchGates.enabled // false) == true and
      ((.cdLoop.researchGates.lineDiscard.minD // 0) >= 0.40) and
      ((.cdLoop.researchGates.lineDiscard.minE // 0) >= 0.40) and
      ((.cdLoop.researchGates.parentPromotion.minD // 0) >= 0.50) and
      ((.cdLoop.researchGates.parentPromotion.minE // 0) >= 0.55) and
      (.cdLoop.lockboxGate.goalMode // "") == "TARGET_FIRST_V2" and
      (.cdLoop.lockboxGate.positionSemantics // "") == "OVERLAP_DAILY_ONE_PICK_V2" and
      (.cdLoop.lockboxGate.minTargetHitCount // 0) >= 1 and
      (.cdLoop.lockboxGate.minTargetHitRate // -1) >= 0 and
      (.cdLoop.lockboxGate.minTargetHitsPer20TradingDays // -1) >= 0 and
      (.cdLoop.lockboxGate.maxStopRate // 2) <= 1 and
      (.cdLoop.lockboxGate.maxTimeoutNegativeRate // 2) <= 1 and
      (.decisionGate.similarityGate.enabled // false) == true and
      ((.decisionGate.similarityGate.minRawSimilarity // -1) >= 0) and
      ((.decisionGate.similarityGate.minRawSimilarity // 2) <= 1) and
      ((.decisionGate.similarityGate.minLocalStageScore // -1) >= 0) and
      ((.decisionGate.similarityGate.minLocalStageScore // 2) <= 1) and
      ((.decisionGate.similarityGate.minTriggerStageScore // -1) >= 0) and
      ((.decisionGate.similarityGate.minTriggerStageScore // 2) <= 1) and
      ((.decisionGate.similarityDisambiguation | type) == "object") and
      ((.decisionGate.similarityDisambiguation.enabled | type) == "boolean") and
      ((.decisionGate.similarityDisambiguation.minTop1Top2Gap // -1) >= 0) and
      ((.decisionGate.similarityDisambiguation.minTop1Top2Gap // 2) <= 1) and
      ((.decisionGate.similarityDisambiguation.minPositiveNegativeGap // -1) >= 0) and
      ((.decisionGate.similarityDisambiguation.minPositiveNegativeGap // 2) <= 1) and
      ((.decisionGate.similarityDisambiguation.negativeBuckets // []) | length) >= 1 and
      ((.decisionGate.scoreRecovery | type) == "object") and
      (((.decisionGate.scoreRecovery.mode // "off") == "off") or
       ((.decisionGate.scoreRecovery.mode // "off") == "shadow") or
       ((.decisionGate.scoreRecovery.mode // "off") == "hard")) and
      (((.decisionGate.scoreRecovery.allowedGateReasons // []) | type) == "array") and
      (((.decisionGate.scoreRecovery.allowedGateReasons // []) | map(. == "SCORE_BELOW_MIN" or . == "SCORE_MARGIN_LOW" or . == "POLICY_TAU_RANK_LOW") | all)) and
      ((.decisionGate.scoreRecovery.maxFinalScoreShortfall // 0) >= 0) and
      ((.decisionGate.scoreRecovery.maxScoreMarginShortfall // 0) >= 0) and
      ((.decisionGate.scoreRecovery.minRawSimilarity // -1) >= 0) and
      ((.decisionGate.scoreRecovery.minRawSimilarity // 2) <= 1) and
      ((.decisionGate.scoreRecovery.minLocalStageScore // -1) >= 0) and
      ((.decisionGate.scoreRecovery.minLocalStageScore // 2) <= 1) and
      ((.decisionGate.scoreRecovery.maxFalsePositiveRisk // -1) >= 0) and
      ((.decisionGate.scoreRecovery.maxFalsePositiveRisk // 2) <= 1) and
      ((.decisionGate.scoreRecovery.minFillProb // -1) >= 0) and
      ((.decisionGate.scoreRecovery.minFillProb // 2) <= 1) and
      ((.decisionGate.scoreRecalibration | type) == "object") and
      (((.decisionGate.scoreRecalibration.mode // "off") == "off") or
       ((.decisionGate.scoreRecalibration.mode // "off") == "shadow") or
       ((.decisionGate.scoreRecalibration.mode // "off") == "hard")) and
      (((.decisionGate.scoreRecalibration.allowedPrimaryComponents // []) | type) == "array") and
      (((.decisionGate.scoreRecalibration.allowedPrimaryComponents // []) | map(. == "POST_ADJUST_HEAVY" or . == "REGIME_EXPERT_HEAVY" or . == "EXTENDED_BIAS_HEAVY" or . == "TRADE_QUALITY_HEAVY" or . == "EXECUTION_PRIOR_HEAVY" or . == "MIXED_DEEP_FAIL") | all)) and
      (((.decisionGate.scoreRecalibration.allowedPrimarySubcomponents // []) | type) == "array") and
      (((.decisionGate.scoreRecalibration.allowedPrimarySubcomponents // []) | map(
        . == "STOP_RATE_PENALTY" or
        . == "ANTI_PENALTY" or
        . == "SINGLE_ERA_PENALTY" or
        . == "SINGLE_ERA_CONCENTRATION_PENALTY" or
        . == "LOW_ERA_SUPPORT_PENALTY" or
        . == "SUPPORT_COUNT_PENALTY" or
        . == "ERA_COVERAGE_PENALTY" or
        . == "REGIME_MULTIPLIER_PENALTY" or
        . == "EXTENDED_BIAS_PENALTY" or
        . == "TRADE_QUALITY_RANKER_ADJUSTMENT" or
        . == "TRADE_QUALITY_ROUTE_RESIDUAL" or
        . == "TRADE_QUALITY_REGIME_RESIDUAL" or
        . == "TRADE_QUALITY_PROTOTYPE_RESIDUAL" or
        . == "TRADE_QUALITY_TOTAL_FALLBACK" or
        . == "LOW_FILL_PENALTY" or
        . == "SLIPPAGE_PENALTY" or
        . == "LOW_LIQUIDITY_PENALTY" or
        . == "BLOCKED_ORDER_PENALTY" or
        . == "NEGATIVE_AFTER_COST_PENALTY"
      ) | all)) and
      (((.decisionGate.scoreRecalibration.maxPenaltyCapByComponent // {}) | type) == "object") and
      (((.decisionGate.scoreRecalibration.maxPenaltyCapByComponent // {}) | to_entries | map((.key == "POST_ADJUST_HEAVY" or .key == "REGIME_EXPERT_HEAVY" or .key == "EXTENDED_BIAS_HEAVY" or .key == "TRADE_QUALITY_HEAVY" or .key == "EXECUTION_PRIOR_HEAVY" or .key == "MIXED_DEEP_FAIL") and ((.value | tonumber) >= 0)) | all)) and
      (((.decisionGate.scoreRecalibration.maxPenaltyCapBySubcomponent // {}) | type) == "object") and
      (((.decisionGate.scoreRecalibration.maxPenaltyCapBySubcomponent // {}) | to_entries | map((
        .key == "STOP_RATE_PENALTY" or
        .key == "ANTI_PENALTY" or
        .key == "SINGLE_ERA_PENALTY" or
        .key == "SINGLE_ERA_CONCENTRATION_PENALTY" or
        .key == "LOW_ERA_SUPPORT_PENALTY" or
        .key == "SUPPORT_COUNT_PENALTY" or
        .key == "ERA_COVERAGE_PENALTY" or
        .key == "REGIME_MULTIPLIER_PENALTY" or
        .key == "EXTENDED_BIAS_PENALTY" or
        .key == "TRADE_QUALITY_RANKER_ADJUSTMENT" or
        .key == "TRADE_QUALITY_ROUTE_RESIDUAL" or
        .key == "TRADE_QUALITY_REGIME_RESIDUAL" or
        .key == "TRADE_QUALITY_PROTOTYPE_RESIDUAL" or
        .key == "TRADE_QUALITY_TOTAL_FALLBACK" or
        .key == "LOW_FILL_PENALTY" or
        .key == "SLIPPAGE_PENALTY" or
        .key == "LOW_LIQUIDITY_PENALTY" or
        .key == "BLOCKED_ORDER_PENALTY" or
        .key == "NEGATIVE_AFTER_COST_PENALTY"
      ) and ((.value | tonumber) >= 0)) | all)) and
      (((.decisionGate.scoreRecalibration.subcomponentPolicies // {}) | type) == "object") and
      (((.decisionGate.scoreRecalibration.subcomponentPolicies // {}) | to_entries | map(
        (
          .key == "STOP_RATE_PENALTY" or
          .key == "ANTI_PENALTY" or
          .key == "SINGLE_ERA_PENALTY" or
          .key == "SINGLE_ERA_CONCENTRATION_PENALTY" or
          .key == "LOW_ERA_SUPPORT_PENALTY" or
          .key == "SUPPORT_COUNT_PENALTY" or
          .key == "ERA_COVERAGE_PENALTY" or
          .key == "REGIME_MULTIPLIER_PENALTY" or
          .key == "EXTENDED_BIAS_PENALTY" or
          .key == "TRADE_QUALITY_RANKER_ADJUSTMENT" or
          .key == "TRADE_QUALITY_ROUTE_RESIDUAL" or
          .key == "TRADE_QUALITY_REGIME_RESIDUAL" or
          .key == "TRADE_QUALITY_PROTOTYPE_RESIDUAL" or
          .key == "TRADE_QUALITY_TOTAL_FALLBACK" or
          .key == "LOW_FILL_PENALTY" or
          .key == "SLIPPAGE_PENALTY" or
          .key == "LOW_LIQUIDITY_PENALTY" or
          .key == "BLOCKED_ORDER_PENALTY" or
          .key == "NEGATIVE_AFTER_COST_PENALTY"
        ) and
        ((.value | type) == "object") and
        (((.value.maxPenaltyCap // 0) | tonumber) >= 0) and
        (((.value.requireMinEraCoverageRatio // 0) | tonumber) >= 0) and
        (((.value.requireMinEraCoverageRatio // 1) | tonumber) <= 1) and
        (((.value.requireMinEraSupportCount // 0) | tonumber) >= 0) and
        (((.value.requireMaxEraSupportShortfall // 0) | tonumber) >= 0) and
        (((.value.requireMaxSingleEraShareExcess // 0) | tonumber) >= 0) and
        (((.value.requireMaxSingleEraShareExcess // 1) | tonumber) <= 1) and
        (((.value.requireMinFillProb // 0) | tonumber) >= 0) and
        (((.value.requireMinFillProb // 1) | tonumber) <= 1) and
        (((.value.allowedSecondarySubcomponents // []) | type) == "array") and
        (((.value.allowedSecondarySubcomponents // []) | map(
          . == "STOP_RATE_PENALTY" or
          . == "ANTI_PENALTY" or
          . == "SINGLE_ERA_PENALTY" or
          . == "SINGLE_ERA_CONCENTRATION_PENALTY" or
          . == "LOW_ERA_SUPPORT_PENALTY" or
          . == "SUPPORT_COUNT_PENALTY" or
          . == "ERA_COVERAGE_PENALTY" or
          . == "REGIME_MULTIPLIER_PENALTY" or
          . == "EXTENDED_BIAS_PENALTY" or
          . == "TRADE_QUALITY_RANKER_ADJUSTMENT" or
          . == "TRADE_QUALITY_ROUTE_RESIDUAL" or
          . == "TRADE_QUALITY_REGIME_RESIDUAL" or
          . == "TRADE_QUALITY_PROTOTYPE_RESIDUAL" or
          . == "TRADE_QUALITY_TOTAL_FALLBACK" or
          . == "LOW_FILL_PENALTY" or
          . == "SLIPPAGE_PENALTY" or
          . == "LOW_LIQUIDITY_PENALTY" or
          . == "BLOCKED_ORDER_PENALTY" or
          . == "NEGATIVE_AFTER_COST_PENALTY"
        ) | all))
      ) | all)) and
      (((.decisionGate.scoreRecalibration.eraSupportReasonPolicies // {}) | type) == "object") and
      (((.decisionGate.scoreRecalibration.eraSupportReasonPolicies // {}) | to_entries | map(
        (
          (.key == "LOW_SUPPORT_COUNT" or .key == "LOW_ERA_COVERAGE" or .key == "SINGLE_ERA_DOMINANCE") and
          ((.value | type) == "object") and
          (((.value.maxPenaltyCap // 0) | tonumber) >= 0) and
          (((.value.requireMinEraCoverageRatio // 0) | tonumber) >= 0) and
          (((.value.requireMinEraCoverageRatio // 1) | tonumber) <= 1) and
          (((.value.requireMinEffectiveEraCount // 0) | tonumber) >= 0) and
          (((.value.requireMinEffectiveEraCountRatio // 0) | tonumber) >= 0) and
          (((.value.requireMinEffectiveEraCountRatio // 1) | tonumber) <= 1) and
          (((.value.requireMinEntropyRatio // 0) | tonumber) >= 0) and
          (((.value.requireMinEntropyRatio // 1) | tonumber) <= 1) and
          (((.value.requireMaxSingleEraShareExcess // 0) | tonumber) >= 0) and
          (((.value.requireMaxSingleEraShareExcess // 1) | tonumber) <= 1) and
          (((.value.requireMinFillProb // 0) | tonumber) >= 0) and
          (((.value.requireMinFillProb // 1) | tonumber) <= 1) and
          (((.value.allowedCompositeTypes // []) | type) == "array") and
          (((.value.allowedCompositeTypes // []) | map(
            . == "ERA_SUPPORT_ONLY" or
            . == "ERA_SUPPORT_PLUS_STOP_RATE" or
            . == "ERA_SUPPORT_PLUS_SLIPPAGE" or
            . == "ERA_SUPPORT_PLUS_REGIME" or
            . == "ERA_SUPPORT_PLUS_OTHER"
          ) | all))
        )
      ) | all)) and
      ((.decisionGate.scoreRecalibration.baseScoreFloor // -1) >= 0) and
      ((.decisionGate.scoreRecalibration.baseScoreFloor // 2) <= 1) and
      ((.decisionGate.scoreRecalibration.minRawSimilarity // -1) >= 0) and
      ((.decisionGate.scoreRecalibration.minRawSimilarity // 2) <= 1) and
      ((.decisionGate.scoreRecalibration.minLocalStageScore // -1) >= 0) and
      ((.decisionGate.scoreRecalibration.minLocalStageScore // 2) <= 1) and
      ((.decisionGate.scoreRecalibration.minFillProb // -1) >= 0) and
      ((.decisionGate.scoreRecalibration.minFillProb // 2) <= 1) and
      (.pattern.prototypeSelection.adaptiveFrontier.enabled // false) == true and
      ((.pattern.prototypeSelection.adaptiveFrontier.minPrototypeFloor // 0) >= 48) and
      ((.pattern.prototypeSelection.adaptiveFrontier.qualityAcceptThreshold // 0) > 0) and
      ((.pattern.prototypeSelection.adaptiveFrontier.maxPrototypeCeil // 0) >= (.pattern.prototypeSelection.minPrototypeFloor // 48)) and
      ((.pattern.prototypeSelection.adaptiveFrontier.candidateMode // "") == "boost_only" or
       (.pattern.prototypeSelection.adaptiveFrontier.candidateMode // "") == "penalty_only" or
       (.pattern.prototypeSelection.adaptiveFrontier.candidateMode // "") == "boost_penalty") and
      ((.pattern.prototypeSelection.adaptiveFrontier.previousRunEAssistWeight // 0) >= 0) and
      ((.pattern.prototypeSelection.adaptiveFrontier.previousRunEThreshold // 0) >= 0) and
      ((.pattern.prototypeSelection.adaptiveFrontier.salvagePoolPath // "") != "") and
      ((.pattern.prototypeSelection.adaptiveFrontier.quarantinePoolPath // "") != "") and
      ((.pattern.prototypeSelection.minTemporalCoverageForEraBoost // -1) >= 0) and
      ((.pattern.prototypeSelection.minTemporalCoverageForEraBoost // 2) <= 1) and
      ((.pattern.prototypeSelection.minTemporalEffectiveEraCountRatio // -1) >= 0) and
      ((.pattern.prototypeSelection.minTemporalEffectiveEraCountRatio // 2) <= 1) and
      ((.pattern.prototypeSelection.minTemporalEntropyRatio // -1) >= 0) and
      ((.pattern.prototypeSelection.minTemporalEntropyRatio // 2) <= 1) and
      (.pattern.c0.enabled // false) == true and
      (((.pattern.c0.inputMode // "") == "auto") or
       ((.pattern.c0.inputMode // "") == "runtime_pack") or
       ((.pattern.c0.inputMode // "") == "lite") or
       ((.pattern.c0.inputMode // "") == "full")) and
      (((.pattern.c0.familyBuildSource // "") == "positive_only") or
       ((.pattern.c0.familyBuildSource // "") == "all_templates")) and
      ((.pattern.c0.minFamilySupport // 0) >= 4) and
      ((.pattern.c0.shortlistFamilyCount // 0) >= 8) and
      ((.pattern.c0.familyBackfillFloor // 0) >= 1) and
      ((.pattern.c0.familyBackfillFloor // 0) <= (.pattern.c0.shortlistFamilyCount // 0)) and
      ((.pattern.c0.minEraCoverageRatioForBackfill // -1) >= 0) and
      ((.pattern.c0.minEraCoverageRatioForBackfill // 2) <= 1) and
      ((.pattern.c0.minEffectiveEraCountRatio // -1) >= 0) and
      ((.pattern.c0.minEffectiveEraCountRatio // 2) <= 1) and
      ((.pattern.c0.minEffectiveEraCountRatioForBackfill // -1) >= 0) and
      ((.pattern.c0.minEffectiveEraCountRatioForBackfill // 2) <= 1) and
      ((.pattern.c0.minNormalizedEraEntropy // -1) >= 0) and
      ((.pattern.c0.minNormalizedEraEntropy // 2) <= 1) and
      ((.pattern.c0.minNormalizedEraEntropyForBackfill // -1) >= 0) and
      ((.pattern.c0.minNormalizedEraEntropyForBackfill // 2) <= 1) and
      ((.pattern.c0.maxSingleEraShareForBackfill // -1) >= 0) and
      ((.pattern.c0.maxSingleEraShareForBackfill // 2) <= 1) and
      ((.pattern.c0.scoreWeights.effectiveEraCount // -1) >= 0) and
      ((.pattern.c0.scoreWeights.normalizedEraEntropy // -1) >= 0) and
      ((.pattern.temporalStability.warnMinEffectiveEraCountRatio // -1) >= 0) and
      ((.pattern.temporalStability.warnMinEffectiveEraCountRatio // 2) <= 1) and
      ((.pattern.temporalStability.warnMinNormalizedEraEntropy // -1) >= 0) and
      ((.pattern.temporalStability.warnMinNormalizedEraEntropy // 2) <= 1) and
      ((.pattern.temporalStability.minEffectiveEraCountRatio // -1) >= 0) and
      ((.pattern.temporalStability.minEffectiveEraCountRatio // 2) <= 1) and
      ((.pattern.temporalStability.minNormalizedEraEntropy // -1) >= 0) and
      ((.pattern.temporalStability.minNormalizedEraEntropy // 2) <= 1) and
      ((.pattern.temporalStability.relaxMinEffectiveEraCountRatioStep // -1) >= 0) and
      ((.pattern.temporalStability.relaxMinEffectiveEraCountRatioStep // 2) <= 1) and
      ((.pattern.temporalStability.relaxMinNormalizedEraEntropyStep // -1) >= 0) and
      ((.pattern.temporalStability.relaxMinNormalizedEraEntropyStep // 2) <= 1) and
      (.pattern.c1.enabled // false) == true and
      ((.pattern.c1.maxProbeFamilies // 0) >= 1) and
      ((.pattern.c1.explicitFamilyIds // []) | type == "array") and
      (all((.pattern.c1.explicitFamilyIds // [])[]?; (type == "string") and (length > 0))) and
      ((.pattern.c1.minFamilySupport // 0) >= 1) and
      ((.pattern.c1.maxFamilyRepresentatives // 0) >= 1) and
      ((.pattern.c1.probeProfile // "") == "C1_FAMILY_PROBE") and
      (((.pattern.c1.probeScope // "") == "update") or
       ((.pattern.c1.probeScope // "") == "tune") or
       ((.pattern.c1.probeScope // "") == "eval")) and
      ((.pattern.c1.familyPassMinTargetHitRateEval // -1) >= 0) and
      ((.pattern.c1.familyPassMinTargetHitRateEval // 2) <= 1) and
      ((.pattern.c1.familyPassMinExecutedTargetHitRateEval // -1) >= 0) and
      ((.pattern.c1.familyPassMinExecutedTargetHitRateEval // 2) <= 1) and
      ((.pattern.c1.familyPassMinSelectionHitAt1Eval // -1) >= 0) and
      ((.pattern.c1.familyPassMinSelectionHitAt1Eval // 2) <= 1) and
      ((.pattern.c1.familyPassMinPickedDaysEval // -1) >= 0) and
      ((.pattern.c1.familyPassMinTargetsPer20EvalDays // -1) >= 0) and
      ((.pattern.c1.familyPassMinExecutionCoverageEval // -1) >= 0) and
      ((.pattern.c1.familyPassMinExecutionCoverageEval // 2) <= 1) and
      ((.pattern.c1.familyPassMaxStopRateEval // -1) >= 0) and
      ((.pattern.c1.familyPassMaxStopRateEval // 2) <= 1) and
      ((.pattern.c1.familyPassMaxTimeoutNegativeRateEval // -1) >= 0) and
      ((.pattern.c1.familyPassMaxTimeoutNegativeRateEval // 2) <= 1) and
      ((.pattern.c1.familyBackfillFloor // 0) >= 1) and
      ((.pattern.c1.familyBackfillFloor // 0) <= (.pattern.c1.maxProbeFamilies // 0)) and
      ((.pattern.c1.familyBackfillMax // -1) >= 0) and
      ((.pattern.c1.retainTopProbeArtifacts // -1) >= 0) and
      (.pattern.c2.enabled // false) == true and
      ((.pattern.c2.minFamiliesForDedup // 0) >= 2) and
      ((.pattern.c2.maxFamiliesForPairwise // 0) >= (.pattern.c2.minFamiliesForDedup // 0)) and
      ((.pattern.c2.similarityThreshold // -1) >= 0) and
      ((.pattern.c2.similarityThreshold // 2) <= 1) and
      ((.pattern.c2.top1AgreementThreshold // -1) >= 0) and
      ((.pattern.c2.top1AgreementThreshold // 2) <= 1) and
      ((.pattern.c2.symbolDayJaccardThreshold // -1) >= 0) and
      ((.pattern.c2.symbolDayJaccardThreshold // 2) <= 1) and
      ((.pattern.c2.pickedDayJaccardThreshold // -1) >= 0) and
      ((.pattern.c2.pickedDayJaccardThreshold // 2) <= 1) and
      ((.pattern.c2.executionOverlapThreshold // -1) >= 0) and
      ((.pattern.c2.executionOverlapThreshold // 2) <= 1) and
      ((.pattern.c2.maxBehaviorPenaltyDistance // -1) >= 0) and
      ((.pattern.c2.maxBehaviorPenaltyDistance // 2) <= 1) and
      ((.pattern.c2.rankOverlapThreshold // -1) >= 0) and
      ((.pattern.c2.rankOverlapThreshold // 2) <= 1) and
      ((.pattern.c2.minRepresentativeFamilies // 0) >= 1) and
      ((.pattern.c2.minRepresentativeTargetsPer20EvalDays // -1) >= 0) and
      ((.pattern.c2.minRepresentativeExecutionCoverageEval // -1) >= 0) and
      ((.pattern.c2.minRepresentativeExecutionCoverageEval // 2) <= 1) and
      ((.pattern.c2.minRepresentativeScoreFloor // -1) >= 0) and
      ((.pattern.c2.representativePolicy // "") == "quality_first_with_coverage_guard" or
       (.pattern.c2.representativePolicy // "") == "coverage_first_with_quality_floor") and
      ((.pattern.c2.similarityPolicyVersion // "") == "c2_overlap_graph_v1" or
       (.pattern.c2.similarityPolicyVersion // "") == "c2_overlap_graph_strict_v1") and
      ((.pattern.c2.targetCoverageNorm // 0) > 0) and
      ((.lightweight.artifactPolicy.tier // "") == "exploratory" or
       (.lightweight.artifactPolicy.tier // "") == "confirm" or
       (.lightweight.artifactPolicy.tier // "") == "promotion") and
      (.lightweight.stepD.writeFeaturePackRows // true) == false and
      (.lightweight.stepD.writeDecisionCandidatesIndex // true) == false
    else
      (.backtest.singlePosition // false) == true and
      (.cdLoop.lockboxGate.minWinRate // 0) >= (.qualityGate.lockbox.minWinRate // 0) and
      (.cdLoop.lockboxGate.maxDrawdown // 1) <= (.qualityGate.lockbox.maxDrawdown // 1)
    end
  ) and
  .holdoutPolicy.enabled == true and
  .holdoutPolicy.frozenEvalOnlyForFinal == true and
  .holdoutPolicy.forbidEvalDrivenPromotion == false and
  (.holdoutPolicy.minFeedbackDelayDays // 0) >= 1 and
  .onlineLearning.generalization.promotionScope == "eval" and
  .onlineLearning.generalization.useEvalForPromotion == true and
  (.onlineLearning.generalization.feedbackDelayDays // 0) >= (.holdoutPolicy.minFeedbackDelayDays // 1) and
  .decisionGate.executionGate.feedbackScope == "update_only" and
  (.decisionGate.executionGate.feedbackDelayDays // 0) >= (.holdoutPolicy.minFeedbackDelayDays // 1) and
  .decisionGate.falsePositiveGate.enabled == true and
  (.decisionGate.falsePositiveGate.maxRisk // 2) <= 1 and
  (
    (.decisionGate.falsePositiveGate.blockWhenUnknown // false) == true or
    (.decisionGate.falsePositiveGate.shadowWhenUnknown // false) == true
  ) and
  .decisionGate.falsePositiveGate.model.enabled == true and
  (.decisionGate.falsePositiveGate.model.minSamplesForInference // 0) >= 1 and
  (.decisionGate.falsePositiveGate.model.minTrainRows // 0) >= 1 and
  ((.decisionGate.falsePositiveGate.model.decisionMode // "model_only") == "model_only") and
  (.decisionGate.maxPicksPerDay // 0) == 1 and
  ((.decisionGate.secondPick.phase // .decisionGate.secondPick.mode // "disabled") == "disabled") and
  .decisionGate.agreementGate.enabled == true and
  (.decisionGate.agreementGate.candidatePool // 0) >= 10 and
  ((.decisionGate.agreementGate.minAgreementScore // -1) >= 0) and
  ((.decisionGate.scoreRecovery | type) == "object") and
  (((.decisionGate.scoreRecovery.mode // "off") == "off") or
   ((.decisionGate.scoreRecovery.mode // "off") == "shadow") or
   ((.decisionGate.scoreRecovery.mode // "off") == "hard")) and
  (((.decisionGate.scoreRecovery.allowedGateReasons // []) | type) == "array") and
  (((.decisionGate.scoreRecovery.allowedGateReasons // []) | map(. == "SCORE_BELOW_MIN" or . == "SCORE_MARGIN_LOW" or . == "POLICY_TAU_RANK_LOW") | all)) and
  ((.decisionGate.scoreRecovery.maxFinalScoreShortfall // 0) >= 0) and
  ((.decisionGate.scoreRecovery.maxScoreMarginShortfall // 0) >= 0) and
  ((.decisionGate.scoreRecovery.minRawSimilarity // -1) >= 0) and
  ((.decisionGate.scoreRecovery.minRawSimilarity // 2) <= 1) and
  ((.decisionGate.scoreRecovery.minLocalStageScore // -1) >= 0) and
  ((.decisionGate.scoreRecovery.minLocalStageScore // 2) <= 1) and
  ((.decisionGate.scoreRecovery.maxFalsePositiveRisk // -1) >= 0) and
  ((.decisionGate.scoreRecovery.maxFalsePositiveRisk // 2) <= 1) and
  ((.decisionGate.scoreRecovery.minFillProb // -1) >= 0) and
  ((.decisionGate.scoreRecovery.minFillProb // 2) <= 1) and
  .decisionGate.dayTypeRouter.enabled == true and
  (.decisionGate.dayTypeRouter.sampleSize // 0) >= 1 and
  .decisionGate.dayTypeRouter.model.enabled == true and
  (.decisionGate.dayTypeRouter.model.minTrainingRows // 0) >= 1 and
  ((.decisionGate.dayTypeRouter.model.minConfidence // -1) >= 0) and
  (.decisionGate.dayTypeRouter.model.preferModelWhenAvailable // true) == true and
  (.decisionGate.metaSelector.executionDiagnosticMode // false) == false and
  ((.decisionGate.metaSelector | has("minCalibratedPHit")) | not) and
  ((.decisionGate.metaSelector | has("maxPStopFirst")) | not) and
  ((.decisionGate.metaSelector | has("minFillProb")) | not) and
  ((.decisionGate.metaSelector | has("minConfidence")) | not) and
  .decisionGate.opportunityBudget.enabled == true and
  ((.decisionGate.opportunityBudget.maxExecutedPicks // -1) >= 0) and
  (.decisionGate.top1Rerank.candidatePool // 0) >= 10 and
  (.similarity.topK // 0) >= 10 and
  (.lightweight.stepD.sampledDebugLog.topK // 0) >= 10 and
  (.pattern.prototypeSelection.minPrototypeFloor // 0) >= 48 and
  (.pattern.prototypeSelection.minClusterFloor // 0) >= 24 and
  (
    (.decisionGate.top1Rerank.enabled // null) == true or
    (.decisionGate.top1Rerank.enabled // null) == false
  ) and
  .decisionGate.useMaxScoreMarginGate == false and
  .qualityGate.enabled == true and
  .qualityGate.lockbox.enabled == true and
  (.qualityGate.lockbox.minTrades // 0) >= 1 and
  .lightweight.stepD.prepareLockboxDuringStepD == false and
  .cdLoop.lockboxGate.enabled == true and
  (.cdLoop.lockboxGate.minTrades // 0) >= (.qualityGate.lockbox.minTrades // 1) and
  ((.cdLoop.lockboxGate.maxPolicyDriftScore // 2) <= 1) and
  ((.cdLoop.lockboxGate.minBucketConsistency // -1) >= 0) and
  ((.cdLoop.lockboxGate.minRegimeConsistency // -1) >= 0) and
  ((.cdLoop.lockboxGate.minAgreementDecisionConsistency // -1) >= 0) and
  ((.cdLoop.lockboxGate.minAgreementReasonConsistency // -1) >= 0) and
  ((.cdLoop.lockboxGate.maxTraceMismatchRate // 2) <= 1) and
  ((.cdLoop.lockboxGate.maxTraceCriticalMismatchDays // -1) >= 0) and
  ((.cdLoop.lockboxGate.minFalsePositiveRejectedCount // -1) >= 0) and
  ((.cdLoop.lockboxGate.minFalsePositiveRejectionPrecision // -1) >= 0) and
  .cdLoop.promotionDebt.enabled == true and
  ((.cdLoop.promotionDebt.minFalsePositiveRejectedCountEval // -1) >= 0) and
  ((.cdLoop.promotionDebt.minFalsePositiveRejectionPrecisionEval // -1) >= 0) and
  (.cdLoop.promotionDebt.requirePolicyFingerprintChange // true) == true and
  (.cdLoop.promotionDebt.requireLockboxEligible // true) == true and
  .cdLoop.lockboxGate.requireZeroLookaheadViolations == true and
  .runManifest.enabled == true and
  .bundlePolicy.enabled == true and
  (.bundlePolicy.maxArchiveMb // 0) <= 200 and
  .opsSlo.enabled == true and
  .opsSlo.rollbackOnGateFail == true and
  ((.smokeConfirm.phase // "both") == "both" or (.smokeConfirm.phase // "both") == "smoke" or (.smokeConfirm.phase // "both") == "confirm") and
  ((.smokeConfirm.smokeRuns // -1) == 2) and
  ((.smokeConfirm.confirmRuns // -1) == 4) and
  ((.smokeConfirm.stopOnSmokeFailure // false) == true) and
  ((.cdLoop.maxRounds // -1) == 3) and
  ((.cdLoop.minEpochsPerRound // -1) == 2) and
  ((.cdLoop.maxEpochsPerRound // -1) == 3) and
  ((.decisionGate.opportunityBudget.maxSamePrototypeFamily // -1) == 1)
' "$CFG_PATH" >/dev/null || {
  echo "[fatal] policy contract check failed: $CFG_PATH" >&2
  exit 1
}

check_default_if_present \
  "tools/stepc_autorelax_select.sh" \
  'SWITCH_BASELINE=.*false' \
  "SWITCH_BASELINE default must be false"
check_default_if_present \
  "tools/stepc_autorelax_select.sh" \
  'REQUIRE_FROZEN_EVAL_PASS=.*true' \
  "REQUIRE_FROZEN_EVAL_PASS default must be true"
check_default_if_present \
  "meta/scripts/run_combined32_online.sh" \
  'CHAIN_SEED=.*false' \
  "CHAIN_SEED default must be false"
check_default_if_present \
  "meta/scripts/run_combined32_online.sh" \
  'FAIL_ON_TOPK_GAP_MISMATCH=.*true' \
  "FAIL_ON_TOPK_GAP_MISMATCH default must be true"

echo "[ok] policy contracts verified: $CFG_PATH"
