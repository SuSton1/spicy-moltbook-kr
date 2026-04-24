#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

search_hits() {
  local pattern="$1"
  shift
  if command -v rg >/dev/null 2>&1; then
    rg -n --no-heading "$pattern" "$@"
  else
    grep -RInE "$pattern" "$@"
  fi
}

check_pattern_mode_contracts() {
  local file
  local mode
  local found=0
  for file in "$@"; do
    [[ -f "$file" ]] || continue
    found=1
    mode="$(python3 - "$file" <<'PY'
import json
import sys

cfg = json.load(open(sys.argv[1], "r", encoding="utf-8"))
print(((cfg.get("pattern") or {}).get("mode")) or "")
PY
)"
    if [[ -z "$mode" ]]; then
      echo "missing pattern.mode in strict config file: $file"
      exit 1
    fi
    if [[ "$mode" != "hybrid_150_40" ]]; then
      echo "forbidden pattern.mode found in config: $file => $mode"
      exit 1
    fi
  done
  if [[ "$found" -ne 1 ]]; then
    echo "no strict config files found for pattern.mode check"
    exit 1
  fi
}

read_cfg_field() {
  local file_path="$1"
  local field_expr="$2"
  python3 - "$file_path" "$field_expr" <<'PY'
import json
import sys

cfg = json.load(open(sys.argv[1], "r", encoding="utf-8"))
field_expr = sys.argv[2]
value = cfg
for part in [part for part in field_expr.split(".") if part]:
    if not isinstance(value, dict) or part not in value:
        value = None
        break
    value = value[part]

print("" if value is None else value)
PY
}

echo "==> strict: forbid legacy-escape config/runtime in pipeline"
legacy_engine_key="$(printf \'\x66\x61\x6c\x6c\x62\x61\x63\x6bEngine\')"
allow_legacy_key="$(printf \'allow\x46\x61\x6c\x6c\x62\x61\x63\x6b\')"
legacy_scorer_key="$(printf \'\x66\x61\x6c\x6c\x62\x61\x63\x6bScorer\')"
engine_legacy_reason_key="$(printf \'engine\x46\x61\x6c\x6c\x62\x61\x63\x6bReason\')"
runtime_marker_a="$(printf \'AUTO_\x46\x41\x4c\x4c\x42\x41\x43\x4b\')"
runtime_marker_b="$(printf \'_\x46\x41\x4c\x4c\x42\x41\x43\x4b_\')"
legacy_hits_tmp="/tmp/strict_legacy_hits.txt"
runtime_hits_tmp="/tmp/strict_runtime_hits.txt"
legacy_scorer_hits_tmp="/tmp/strict_legacy_scorer_hits.txt"

if search_hits "(${legacy_engine_key}|${allow_legacy_key})" config src/pipeline >"$legacy_hits_tmp" 2>/dev/null; then
  echo "forbidden legacy-escape markers found:"
  cat "$legacy_hits_tmp"
  exit 1
fi

if search_hits "(${engine_legacy_reason_key}|${runtime_marker_a}|${runtime_marker_b})" src >"$runtime_hits_tmp" 2>/dev/null; then
  echo "forbidden runtime legacy-escape markers found:"
  cat "$runtime_hits_tmp"
  exit 1
fi

echo "==> strict: enforce Step A duckdb-only policy"
if search_hits "\"engine\"[[:space:]]*:[[:space:]]*\"(auto|bitset|classic)\"" config/lab.config.server.json config/lab.config.server.lite.json config/lab.config.example.json >/tmp/strict_engine_hits.txt 2>/dev/null; then
  echo "forbidden Step A engine found in config:"
  cat /tmp/strict_engine_hits.txt
  exit 1
fi

echo "==> strict: enforce exact scorer policy"
score_lines="$(search_hits "\"scorerVersion\"[[:space:]]*:[[:space:]]*\"" config/lab.config.server.json config/lab.config.server.lite.json config/lab.config.example.json || true)"
if [[ -z "${score_lines}" ]]; then
  echo "missing scorerVersion in strict config files"
  exit 1
fi
if echo "${score_lines}" | grep -v "v2_exact" >/tmp/strict_scorer_hits.txt 2>/dev/null; then
  echo "forbidden scorerVersion found in config:"
  cat /tmp/strict_scorer_hits.txt
  exit 1
fi
if search_hits "\"${legacy_scorer_key}\"[[:space:]]*:" config src >"$legacy_scorer_hits_tmp" 2>/dev/null; then
  echo "forbidden legacy scorer markers found:"
  cat "$legacy_scorer_hits_tmp"
  exit 1
fi

echo "==> strict: enforce hybrid 150/40 contracts"
if ! search_hits "\"enforceHybrid15040Contracts\"[[:space:]]*:[[:space:]]*true" config/lab.config.server.json config/lab.config.server.lite.json config/lab.config.example.json >/dev/null 2>&1; then
  echo "missing guardrail enforceHybrid15040Contracts=true"
  exit 1
fi
check_pattern_mode_contracts \
  config/lab.config.server.json \
  config/lab.config.server.lite.json \
  config/lab.config.example.json
if ! search_hits "\"localWindow\"[[:space:]]*:[[:space:]]*40" config/lab.config.server.json config/lab.config.server.lite.json config/lab.config.example.json >/dev/null 2>&1; then
  echo "missing template.localWindow=40 in strict config files"
  exit 1
fi
if ! search_hits "\"globalWindow\"[[:space:]]*:[[:space:]]*150" config/lab.config.server.json config/lab.config.server.lite.json config/lab.config.example.json >/dev/null 2>&1; then
  echo "missing template.globalWindow=150 in strict config files"
  exit 1
fi
if ! search_hits "\"coarseTopN\"[[:space:]]*:[[:space:]]*[0-9]+" config/lab.config.server.json config/lab.config.server.lite.json config/lab.config.example.json >/dev/null 2>&1; then
  echo "missing similarity.coarseTopN in strict config files"
  exit 1
fi
if ! search_hits "\"stageWeights\"[[:space:]]*:" config/lab.config.server.json config/lab.config.server.lite.json config/lab.config.example.json >/dev/null 2>&1; then
  echo "missing similarity.stageWeights in strict config files"
  exit 1
fi

echo "==> strict: forbid disabled feature families (flow/fundamental/disclosure)"
if search_hits "(^|[^a-zA-Z])(flow|fundamental|disclosure)([^a-zA-Z]|$)" src config >/tmp/strict_disabled_feature_hits.txt 2>/dev/null; then
  echo "forbidden disabled feature family markers found:"
  cat /tmp/strict_disabled_feature_hits.txt
  exit 1
fi
if search_hits "FUNDAMENTAL_MISSING|DISCLOSURE|risk_commentary|riskCommentary" src config >/tmp/strict_disabled_risk_hits.txt 2>/dev/null; then
  echo "forbidden disabled risk/commentary markers found:"
  cat /tmp/strict_disabled_risk_hits.txt
  exit 1
fi

echo "==> strict: ensure config validator exists"
search_hits "validateStrictConfig|Strict mode violation" src/lib/config.mjs >/dev/null

echo "==> strict: enforce holdout/gate contracts (server lite)"
cfg="config/lab.config.server.lite.json"
goal_mode="$(read_cfg_field "$cfg" "backtest.goalMode")"
position_semantics="$(read_cfg_field "$cfg" "backtest.positionSemantics")"
goal_mode="${goal_mode:-LEGACY_PNL_V1}"
position_semantics="${position_semantics:-SINGLE_POSITION_V1}"
if [[ "$goal_mode" == "TARGET_FIRST_V2" && "$position_semantics" == "OVERLAP_DAILY_ONE_PICK_V2" ]]; then
  python3 - "$cfg" <<'PY'
import json
import sys

cfg = json.load(open(sys.argv[1], "r", encoding="utf-8"))
checks = {
    "holdout.enabled": cfg["holdoutPolicy"].get("enabled") is True,
    "holdout.frozenEvalOnlyForFinal": cfg["holdoutPolicy"].get("frozenEvalOnlyForFinal") is True,
    "holdout.forbidEvalDrivenPromotion": cfg["holdoutPolicy"].get("forbidEvalDrivenPromotion") is False,
    "holdout.minFeedbackDelayDays": (cfg["holdoutPolicy"].get("minFeedbackDelayDays") or 0) >= 1,
    "online.promotionScope": cfg["onlineLearning"]["generalization"].get("promotionScope") == "eval",
    "online.useEvalForPromotion": cfg["onlineLearning"]["generalization"].get("useEvalForPromotion") is True,
    "online.feedbackDelayDays": (cfg["onlineLearning"]["generalization"].get("feedbackDelayDays") or 0) >= (cfg["holdoutPolicy"].get("minFeedbackDelayDays") or 1),
    "execution.feedbackScope": cfg["decisionGate"]["executionGate"].get("feedbackScope") == "update_only",
    "execution.feedbackDelayDays": (cfg["decisionGate"]["executionGate"].get("feedbackDelayDays") or 0) >= (cfg["holdoutPolicy"].get("minFeedbackDelayDays") or 1),
    "decision.similarityGate.enabled": cfg["decisionGate"].get("similarityGate", {}).get("enabled") is True,
    "decision.similarityGate.minRawSimilarity": 0 <= (cfg["decisionGate"].get("similarityGate", {}).get("minRawSimilarity") or 0) <= 1,
    "decision.similarityGate.minLocalStageScore": 0 <= (cfg["decisionGate"].get("similarityGate", {}).get("minLocalStageScore") or 0) <= 1,
    "decision.similarityGate.minTriggerStageScore": 0 <= (cfg["decisionGate"].get("similarityGate", {}).get("minTriggerStageScore") or 0) <= 1,
    "decision.similarityDisambiguation.enabled": isinstance(cfg["decisionGate"].get("similarityDisambiguation", {}).get("enabled"), bool),
    "decision.similarityDisambiguation.minTop1Top2Gap": 0 <= (cfg["decisionGate"].get("similarityDisambiguation", {}).get("minTop1Top2Gap") or 0) <= 1,
    "decision.similarityDisambiguation.minPositiveNegativeGap": 0 <= (cfg["decisionGate"].get("similarityDisambiguation", {}).get("minPositiveNegativeGap") or 0) <= 1,
    "decision.similarityDisambiguation.negativeBuckets": len(cfg["decisionGate"].get("similarityDisambiguation", {}).get("negativeBuckets") or []) >= 1,
    "decision.scoreRecovery.enabled": isinstance(cfg["decisionGate"].get("scoreRecovery", {}).get("enabled"), bool),
    "decision.scoreRecovery.mode": (cfg["decisionGate"].get("scoreRecovery", {}).get("mode") or "off") in {"off", "shadow", "hard"},
    "decision.scoreRecovery.allowedGateReasons": isinstance(cfg["decisionGate"].get("scoreRecovery", {}).get("allowedGateReasons", []), list) and all(
        reason in {"SCORE_BELOW_MIN", "SCORE_MARGIN_LOW", "POLICY_TAU_RANK_LOW"}
        for reason in (cfg["decisionGate"].get("scoreRecovery", {}).get("allowedGateReasons") or [])
    ),
    "decision.scoreRecovery.maxFinalScoreShortfall": ((cfg["decisionGate"].get("scoreRecovery", {}).get("maxFinalScoreShortfall") if cfg["decisionGate"].get("scoreRecovery", {}).get("maxFinalScoreShortfall") is not None else 0) >= 0),
    "decision.scoreRecovery.maxScoreMarginShortfall": ((cfg["decisionGate"].get("scoreRecovery", {}).get("maxScoreMarginShortfall") if cfg["decisionGate"].get("scoreRecovery", {}).get("maxScoreMarginShortfall") is not None else 0) >= 0),
    "decision.scoreRecovery.minRawSimilarity": 0 <= ((cfg["decisionGate"].get("scoreRecovery", {}).get("minRawSimilarity") if cfg["decisionGate"].get("scoreRecovery", {}).get("minRawSimilarity") is not None else 0)) <= 1,
    "decision.scoreRecovery.minLocalStageScore": 0 <= ((cfg["decisionGate"].get("scoreRecovery", {}).get("minLocalStageScore") if cfg["decisionGate"].get("scoreRecovery", {}).get("minLocalStageScore") is not None else 0)) <= 1,
    "decision.scoreRecovery.maxFalsePositiveRisk": 0 <= ((cfg["decisionGate"].get("scoreRecovery", {}).get("maxFalsePositiveRisk") if cfg["decisionGate"].get("scoreRecovery", {}).get("maxFalsePositiveRisk") is not None else 0)) <= 1,
    "decision.scoreRecovery.minFillProb": 0 <= ((cfg["decisionGate"].get("scoreRecovery", {}).get("minFillProb") if cfg["decisionGate"].get("scoreRecovery", {}).get("minFillProb") is not None else 0)) <= 1,
    "decision.scoreRecalibration.enabled": isinstance(cfg["decisionGate"].get("scoreRecalibration", {}).get("enabled"), bool),
    "decision.scoreRecalibration.mode": (cfg["decisionGate"].get("scoreRecalibration", {}).get("mode") or "off") in {"off", "shadow", "hard"},
    "decision.scoreRecalibration.allowedPrimaryComponents": isinstance(cfg["decisionGate"].get("scoreRecalibration", {}).get("allowedPrimaryComponents", []), list) and all(
        component in {"POST_ADJUST_HEAVY", "REGIME_EXPERT_HEAVY", "EXTENDED_BIAS_HEAVY", "TRADE_QUALITY_HEAVY", "EXECUTION_PRIOR_HEAVY", "MIXED_DEEP_FAIL"}
        for component in (cfg["decisionGate"].get("scoreRecalibration", {}).get("allowedPrimaryComponents") or [])
    ),
    "decision.scoreRecalibration.allowedPrimarySubcomponents": isinstance(cfg["decisionGate"].get("scoreRecalibration", {}).get("allowedPrimarySubcomponents", []), list) and all(
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
        for component in (cfg["decisionGate"].get("scoreRecalibration", {}).get("allowedPrimarySubcomponents") or [])
    ),
    "decision.scoreRecalibration.maxPenaltyCapByComponent": isinstance(cfg["decisionGate"].get("scoreRecalibration", {}).get("maxPenaltyCapByComponent", {}), dict) and all(
        key in {"POST_ADJUST_HEAVY", "REGIME_EXPERT_HEAVY", "EXTENDED_BIAS_HEAVY", "TRADE_QUALITY_HEAVY", "EXECUTION_PRIOR_HEAVY", "MIXED_DEEP_FAIL"} and value >= 0
        for key, value in (cfg["decisionGate"].get("scoreRecalibration", {}).get("maxPenaltyCapByComponent", {}) or {}).items()
    ),
    "decision.scoreRecalibration.maxPenaltyCapBySubcomponent": isinstance(cfg["decisionGate"].get("scoreRecalibration", {}).get("maxPenaltyCapBySubcomponent", {}), dict) and all(
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
        for key, value in (cfg["decisionGate"].get("scoreRecalibration", {}).get("maxPenaltyCapBySubcomponent", {}) or {}).items()
    ),
    "decision.scoreRecalibration.subcomponentPolicies": isinstance(cfg["decisionGate"].get("scoreRecalibration", {}).get("subcomponentPolicies", {}), dict) and all(
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
        for key, value in (cfg["decisionGate"].get("scoreRecalibration", {}).get("subcomponentPolicies", {}) or {}).items()
    ),
    "decision.scoreRecalibration.eraSupportReasonPolicies": isinstance(cfg["decisionGate"].get("scoreRecalibration", {}).get("eraSupportReasonPolicies", {}), dict) and all(
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
        for key, value in (cfg["decisionGate"].get("scoreRecalibration", {}).get("eraSupportReasonPolicies", {}) or {}).items()
    ),
    "decision.scoreRecalibration.baseScoreFloor": 0 <= ((cfg["decisionGate"].get("scoreRecalibration", {}).get("baseScoreFloor") if cfg["decisionGate"].get("scoreRecalibration", {}).get("baseScoreFloor") is not None else 0)) <= 1,
    "decision.scoreRecalibration.minRawSimilarity": 0 <= ((cfg["decisionGate"].get("scoreRecalibration", {}).get("minRawSimilarity") if cfg["decisionGate"].get("scoreRecalibration", {}).get("minRawSimilarity") is not None else 0)) <= 1,
    "decision.scoreRecalibration.minLocalStageScore": 0 <= ((cfg["decisionGate"].get("scoreRecalibration", {}).get("minLocalStageScore") if cfg["decisionGate"].get("scoreRecalibration", {}).get("minLocalStageScore") is not None else 0)) <= 1,
    "decision.scoreRecalibration.minFillProb": 0 <= ((cfg["decisionGate"].get("scoreRecalibration", {}).get("minFillProb") if cfg["decisionGate"].get("scoreRecalibration", {}).get("minFillProb") is not None else 0)) <= 1,
    "prototype.minFloor": (cfg["pattern"]["prototypeSelection"].get("minPrototypeFloor") or 0) >= 48,
    "prototype.clusterFloor": (cfg["pattern"]["prototypeSelection"].get("minClusterFloor") or 0) >= 24,
    "prototype.minTemporalCoverageForEraBoost": 0 <= (cfg["pattern"]["prototypeSelection"].get("minTemporalCoverageForEraBoost") or 0) <= 1,
    "prototype.minTemporalEffectiveEraCountRatio": 0 <= (cfg["pattern"]["prototypeSelection"].get("minTemporalEffectiveEraCountRatio") or 0) <= 1,
    "prototype.minTemporalEntropyRatio": 0 <= (cfg["pattern"]["prototypeSelection"].get("minTemporalEntropyRatio") or 0) <= 1,
    "c0.enabled": cfg["pattern"].get("c0", {}).get("enabled") is True,
    "c0.minFamilySupport": (cfg["pattern"].get("c0", {}).get("minFamilySupport") or 0) >= 4,
    "c0.shortlistFamilyCount": (cfg["pattern"].get("c0", {}).get("shortlistFamilyCount") or 0) >= 8,
    "c0.familyBackfillFloor": (cfg["pattern"].get("c0", {}).get("familyBackfillFloor") or 0) >= 1,
    "c0.minEraCoverageRatioForBackfill": 0 <= (cfg["pattern"].get("c0", {}).get("minEraCoverageRatioForBackfill") or 0) <= 1,
    "c0.minEffectiveEraCountRatio": 0 <= (cfg["pattern"].get("c0", {}).get("minEffectiveEraCountRatio") or 0) <= 1,
    "c0.minEffectiveEraCountRatioForBackfill": 0 <= (cfg["pattern"].get("c0", {}).get("minEffectiveEraCountRatioForBackfill") or 0) <= 1,
    "c0.minNormalizedEraEntropy": 0 <= (cfg["pattern"].get("c0", {}).get("minNormalizedEraEntropy") or 0) <= 1,
    "c0.minNormalizedEraEntropyForBackfill": 0 <= (cfg["pattern"].get("c0", {}).get("minNormalizedEraEntropyForBackfill") or 0) <= 1,
    "c0.maxSingleEraShareForBackfill": 0 <= (cfg["pattern"].get("c0", {}).get("maxSingleEraShareForBackfill") or 0) <= 1,
    "c0.scoreWeights.effectiveEraCount": (cfg["pattern"].get("c0", {}).get("scoreWeights", {}).get("effectiveEraCount") or 0) >= 0,
    "c0.scoreWeights.normalizedEraEntropy": (cfg["pattern"].get("c0", {}).get("scoreWeights", {}).get("normalizedEraEntropy") or 0) >= 0,
    "temporal.warnMinEffectiveEraCountRatio": 0 <= (cfg["pattern"].get("temporalStability", {}).get("warnMinEffectiveEraCountRatio") or 0) <= 1,
    "temporal.warnMinNormalizedEraEntropy": 0 <= (cfg["pattern"].get("temporalStability", {}).get("warnMinNormalizedEraEntropy") or 0) <= 1,
    "temporal.minEffectiveEraCountRatio": 0 <= (cfg["pattern"].get("temporalStability", {}).get("minEffectiveEraCountRatio") or 0) <= 1,
    "temporal.minNormalizedEraEntropy": 0 <= (cfg["pattern"].get("temporalStability", {}).get("minNormalizedEraEntropy") or 0) <= 1,
    "temporal.relaxMinEffectiveEraCountRatioStep": 0 <= (cfg["pattern"].get("temporalStability", {}).get("relaxMinEffectiveEraCountRatioStep") or 0) <= 1,
    "temporal.relaxMinNormalizedEraEntropyStep": 0 <= (cfg["pattern"].get("temporalStability", {}).get("relaxMinNormalizedEraEntropyStep") or 0) <= 1,
    "c1.enabled": cfg["pattern"].get("c1", {}).get("enabled") is True,
    "c1.maxProbeFamilies": (cfg["pattern"].get("c1", {}).get("maxProbeFamilies") or 0) >= 1,
    "c1.explicitFamilyIds": isinstance(cfg["pattern"].get("c1", {}).get("explicitFamilyIds", []), list) and all(
        isinstance(value, str) and value.strip()
        for value in (cfg["pattern"].get("c1", {}).get("explicitFamilyIds") or [])
    ),
    "c1.minFamilySupport": (cfg["pattern"].get("c1", {}).get("minFamilySupport") or 0) >= 1,
    "c1.maxFamilyRepresentatives": (cfg["pattern"].get("c1", {}).get("maxFamilyRepresentatives") or 0) >= 1,
    "c1.probeProfile": (cfg["pattern"].get("c1", {}).get("probeProfile") or "") == "C1_FAMILY_PROBE",
    "c1.familyPassMinTargetHitRateEval": 0 <= (cfg["pattern"].get("c1", {}).get("familyPassMinTargetHitRateEval") or 0) <= 1,
    "c1.familyPassMinExecutedTargetHitRateEval": 0 <= (cfg["pattern"].get("c1", {}).get("familyPassMinExecutedTargetHitRateEval") or 0) <= 1,
    "c1.familyPassMinSelectionHitAt1Eval": 0 <= (cfg["pattern"].get("c1", {}).get("familyPassMinSelectionHitAt1Eval") or 0) <= 1,
    "c1.familyPassMinPickedDaysEval": (cfg["pattern"].get("c1", {}).get("familyPassMinPickedDaysEval") or 0) >= 0,
    "c1.familyPassMinTargetsPer20EvalDays": (cfg["pattern"].get("c1", {}).get("familyPassMinTargetsPer20EvalDays") or 0) >= 0,
    "c1.familyPassMinExecutionCoverageEval": 0 <= (cfg["pattern"].get("c1", {}).get("familyPassMinExecutionCoverageEval") or 0) <= 1,
    "c1.familyPassMaxStopRateEval": 0 <= (cfg["pattern"].get("c1", {}).get("familyPassMaxStopRateEval") or 0) <= 1,
    "c1.familyPassMaxTimeoutNegativeRateEval": 0 <= (cfg["pattern"].get("c1", {}).get("familyPassMaxTimeoutNegativeRateEval") or 0) <= 1,
    "c1.familyBackfillFloor": (cfg["pattern"].get("c1", {}).get("familyBackfillFloor") or 0) >= 1,
    "c1.familyBackfillOrder": (cfg["pattern"].get("c1", {}).get("familyBackfillFloor") or 0) <= (cfg["pattern"].get("c1", {}).get("maxProbeFamilies") or 0),
    "c1.familyBackfillMax": (cfg["pattern"].get("c1", {}).get("familyBackfillMax") or 0) >= 0,
    "c1.retainTopProbeArtifacts": (cfg["pattern"].get("c1", {}).get("retainTopProbeArtifacts") or 0) >= 0,
    "c2.enabled": cfg["pattern"].get("c2", {}).get("enabled") is True,
    "c2.minFamiliesForDedup": (cfg["pattern"].get("c2", {}).get("minFamiliesForDedup") or 0) >= 2,
    "c2.maxFamiliesForPairwise": (cfg["pattern"].get("c2", {}).get("maxFamiliesForPairwise") or 0) >= (cfg["pattern"].get("c2", {}).get("minFamiliesForDedup") or 0),
    "c2.similarityThreshold": 0 <= (cfg["pattern"].get("c2", {}).get("similarityThreshold") or 0) <= 1,
    "c2.top1AgreementThreshold": 0 <= (cfg["pattern"].get("c2", {}).get("top1AgreementThreshold") or 0) <= 1,
    "c2.symbolDayJaccardThreshold": 0 <= (cfg["pattern"].get("c2", {}).get("symbolDayJaccardThreshold") or 0) <= 1,
    "c2.pickedDayJaccardThreshold": 0 <= (cfg["pattern"].get("c2", {}).get("pickedDayJaccardThreshold") or 0) <= 1,
    "c2.executionOverlapThreshold": 0 <= (cfg["pattern"].get("c2", {}).get("executionOverlapThreshold") or 0) <= 1,
    "c2.maxBehaviorPenaltyDistance": 0 <= (cfg["pattern"].get("c2", {}).get("maxBehaviorPenaltyDistance") or 0) <= 1,
    "c2.rankOverlapThreshold": 0 <= (cfg["pattern"].get("c2", {}).get("rankOverlapThreshold") or 0) <= 1,
    "c2.minRepresentativeFamilies": (cfg["pattern"].get("c2", {}).get("minRepresentativeFamilies") or 0) >= 1,
    "c2.minRepresentativeTargetsPer20EvalDays": (cfg["pattern"].get("c2", {}).get("minRepresentativeTargetsPer20EvalDays") or 0) >= 0,
    "c2.minRepresentativeExecutionCoverageEval": 0 <= (cfg["pattern"].get("c2", {}).get("minRepresentativeExecutionCoverageEval") or 0) <= 1,
    "c2.minRepresentativeScoreFloor": (cfg["pattern"].get("c2", {}).get("minRepresentativeScoreFloor") or 0) >= 0,
    "c2.representativePolicy": (cfg["pattern"].get("c2", {}).get("representativePolicy") or "") in {"quality_first_with_coverage_guard", "coverage_first_with_quality_floor"},
    "c2.similarityPolicyVersion": (cfg["pattern"].get("c2", {}).get("similarityPolicyVersion") or "") in {"c2_overlap_graph_v1", "c2_overlap_graph_strict_v1"},
    "c2.targetCoverageNorm": (cfg["pattern"].get("c2", {}).get("targetCoverageNorm") or 0) > 0,
    "quality.enabled": cfg["qualityGate"].get("enabled") is True,
    "quality.lockbox.enabled": cfg["qualityGate"]["lockbox"].get("enabled") is True,
    "quality.lockbox.minTrades": (cfg["qualityGate"]["lockbox"].get("minTrades") or 0) >= 1,
    "cd.lockbox.enabled": cfg["cdLoop"]["lockboxGate"].get("enabled") is True,
    "cd.lockbox.goalMode": cfg["cdLoop"]["lockboxGate"].get("goalMode") == "TARGET_FIRST_V2",
    "cd.lockbox.positionSemantics": cfg["cdLoop"]["lockboxGate"].get("positionSemantics") == "OVERLAP_DAILY_ONE_PICK_V2",
    "cd.lockbox.minTrades": (cfg["cdLoop"]["lockboxGate"].get("minTrades") or 0) >= (cfg["qualityGate"]["lockbox"].get("minTrades") or 1),
    "cd.lockbox.minTargetHitCount": (cfg["cdLoop"]["lockboxGate"].get("minTargetHitCount") or 0) >= 1,
    "cd.lockbox.minTargetHitRate": ((cfg["cdLoop"]["lockboxGate"].get("minTargetHitRate") if cfg["cdLoop"]["lockboxGate"].get("minTargetHitRate") is not None else -1) >= 0),
    "cd.lockbox.minTargetHitsPer20": ((cfg["cdLoop"]["lockboxGate"].get("minTargetHitsPer20TradingDays") if cfg["cdLoop"]["lockboxGate"].get("minTargetHitsPer20TradingDays") is not None else -1) >= 0),
    "cd.lockbox.maxStopRate": ((cfg["cdLoop"]["lockboxGate"].get("maxStopRate") if cfg["cdLoop"]["lockboxGate"].get("maxStopRate") is not None else 2) <= 1),
    "cd.lockbox.maxTimeoutNegativeRate": ((cfg["cdLoop"]["lockboxGate"].get("maxTimeoutNegativeRate") if cfg["cdLoop"]["lockboxGate"].get("maxTimeoutNegativeRate") is not None else 2) <= 1),
    "cd.lockbox.requireZeroLookahead": cfg["cdLoop"]["lockboxGate"].get("requireZeroLookaheadViolations") is True,
    "runManifest.enabled": cfg["runManifest"].get("enabled") is True,
    "bundlePolicy.enabled": cfg["bundlePolicy"].get("enabled") is True,
    "bundlePolicy.maxArchiveMb": (cfg["bundlePolicy"].get("maxArchiveMb") or 0) <= 200,
    "opsSlo.enabled": cfg["opsSlo"].get("enabled") is True,
    "opsSlo.rollbackOnGateFail": cfg["opsSlo"].get("rollbackOnGateFail") is True,
    "backtest.singlePosition": cfg["backtest"].get("singlePosition") is False,
    "backtest.maxNewEntriesPerDay": cfg["backtest"].get("maxNewEntriesPerDay") == 1,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    print("server-lite target-first contract check failed: " + ", ".join(failed), file=sys.stderr)
    raise SystemExit(1)
PY

  echo "==> strict: enforce anti-selection-bias script defaults"
  if [[ -f tools/stepc_autorelax_select.sh ]]; then
    if ! grep -q 'SWITCH_BASELINE=.*false' tools/stepc_autorelax_select.sh; then
      echo "tools/stepc_autorelax_select.sh must default SWITCH_BASELINE=false"
      exit 1
    fi
    if ! grep -q 'REQUIRE_FROZEN_EVAL_PASS=.*true' tools/stepc_autorelax_select.sh; then
      echo "tools/stepc_autorelax_select.sh must default REQUIRE_FROZEN_EVAL_PASS=true"
      exit 1
    fi
  else
    echo "[warn] skip optional strict check: tools/stepc_autorelax_select.sh"
  fi
  if [[ -f meta/scripts/run_combined32_online.sh ]]; then
    if ! grep -q 'CHAIN_SEED=.*false' meta/scripts/run_combined32_online.sh; then
      echo "meta/scripts/run_combined32_online.sh must default CHAIN_SEED=false"
      exit 1
    fi
  else
    echo "[warn] skip optional strict check: meta/scripts/run_combined32_online.sh"
  fi

  echo "==> strict mode checks passed"
  exit 0
fi
jq -e '
  (.backtest.goalMode // "LEGACY_PNL_V1") as $goalMode |
  (.backtest.positionSemantics // "SINGLE_POSITION_V1") as $positionSemantics |
  (
    if $goalMode == "TARGET_FIRST_V2" and $positionSemantics == "OVERLAP_DAILY_ONE_PICK_V2" then
      (.backtest.singlePosition // true) == false and
      (.backtest.maxNewEntriesPerDay // 0) == 1 and
      (.cdLoop.lockboxGate.goalMode // "") == "TARGET_FIRST_V2" and
      (.cdLoop.lockboxGate.positionSemantics // "") == "OVERLAP_DAILY_ONE_PICK_V2" and
      (.cdLoop.lockboxGate.minTargetHitCount // 0) >= 1 and
      (.cdLoop.lockboxGate.minTargetHitRate // -1) >= 0 and
      (.cdLoop.lockboxGate.minTargetHitsPer20TradingDays // -1) >= 0 and
      (.cdLoop.lockboxGate.maxStopRate // 2) <= 1 and
      (.cdLoop.lockboxGate.maxTimeoutNegativeRate // 2) <= 1
    else
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
  (.decisionGate.executionGate.feedbackDelayDays // 0) >= (.holdoutPolicy.minFeedbackDelayDays // 1) and
  .decisionGate.executionGate.feedbackScope == "update_only" and
  (.decisionGate.similarityGate.enabled // false) == true and
  (.decisionGate.similarityGate.minRawSimilarity // -1) >= 0 and
  (.decisionGate.similarityGate.minRawSimilarity // 2) <= 1 and
  (.decisionGate.similarityGate.minLocalStageScore // -1) >= 0 and
  (.decisionGate.similarityGate.minLocalStageScore // 2) <= 1 and
  (.decisionGate.similarityGate.minTriggerStageScore // -1) >= 0 and
  (.decisionGate.similarityGate.minTriggerStageScore // 2) <= 1 and
  ((.decisionGate.similarityDisambiguation | type) == "object") and
  ((.decisionGate.similarityDisambiguation.enabled | type) == "boolean") and
  (.decisionGate.similarityDisambiguation.minTop1Top2Gap // -1) >= 0 and
  (.decisionGate.similarityDisambiguation.minTop1Top2Gap // 2) <= 1 and
  (.decisionGate.similarityDisambiguation.minPositiveNegativeGap // -1) >= 0 and
  (.decisionGate.similarityDisambiguation.minPositiveNegativeGap // 2) <= 1 and
  ((.decisionGate.similarityDisambiguation.negativeBuckets // []) | length) >= 1 and
  ((.decisionGate.scoreRecovery | type) == "object") and
  (((.decisionGate.scoreRecovery.mode // "off") == "off") or
   ((.decisionGate.scoreRecovery.mode // "off") == "shadow") or
   ((.decisionGate.scoreRecovery.mode // "off") == "hard")) and
  (((.decisionGate.scoreRecovery.allowedGateReasons // []) | type) == "array") and
  (((.decisionGate.scoreRecovery.allowedGateReasons // []) | map(. == "SCORE_BELOW_MIN" or . == "SCORE_MARGIN_LOW" or . == "POLICY_TAU_RANK_LOW") | all)) and
  (.decisionGate.scoreRecovery.maxFinalScoreShortfall // 0) >= 0 and
  (.decisionGate.scoreRecovery.maxScoreMarginShortfall // 0) >= 0 and
  (.decisionGate.scoreRecovery.minRawSimilarity // -1) >= 0 and
  (.decisionGate.scoreRecovery.minRawSimilarity // 2) <= 1 and
  (.decisionGate.scoreRecovery.minLocalStageScore // -1) >= 0 and
  (.decisionGate.scoreRecovery.minLocalStageScore // 2) <= 1 and
  (.decisionGate.scoreRecovery.maxFalsePositiveRisk // -1) >= 0 and
  (.decisionGate.scoreRecovery.maxFalsePositiveRisk // 2) <= 1 and
  (.decisionGate.scoreRecovery.minFillProb // -1) >= 0 and
  (.decisionGate.scoreRecovery.minFillProb // 2) <= 1 and
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
  (.decisionGate.scoreRecalibration.baseScoreFloor // -1) >= 0 and
  (.decisionGate.scoreRecalibration.baseScoreFloor // 2) <= 1 and
  (.decisionGate.scoreRecalibration.minRawSimilarity // -1) >= 0 and
  (.decisionGate.scoreRecalibration.minRawSimilarity // 2) <= 1 and
  (.decisionGate.scoreRecalibration.minLocalStageScore // -1) >= 0 and
  (.decisionGate.scoreRecalibration.minLocalStageScore // 2) <= 1 and
  (.decisionGate.scoreRecalibration.minFillProb // -1) >= 0 and
  (.decisionGate.scoreRecalibration.minFillProb // 2) <= 1 and
  (.pattern.prototypeSelection.minPrototypeFloor // 0) >= 48 and
  (.pattern.prototypeSelection.minClusterFloor // 0) >= 24 and
  (.pattern.prototypeSelection.minTemporalCoverageForEraBoost // -1) >= 0 and
  (.pattern.prototypeSelection.minTemporalCoverageForEraBoost // 2) <= 1 and
  (.pattern.prototypeSelection.minTemporalEffectiveEraCountRatio // -1) >= 0 and
  (.pattern.prototypeSelection.minTemporalEffectiveEraCountRatio // 2) <= 1 and
  (.pattern.prototypeSelection.minTemporalEntropyRatio // -1) >= 0 and
  (.pattern.prototypeSelection.minTemporalEntropyRatio // 2) <= 1 and
  (.pattern.c0.enabled // false) == true and
  ((.pattern.c0.familyBuildSource // "") == "positive_only" or
   (.pattern.c0.familyBuildSource // "") == "all_templates") and
  (.pattern.c0.minFamilySupport // 0) >= 4 and
  (.pattern.c0.shortlistFamilyCount // 0) >= 8 and
  (.pattern.c0.familyBackfillFloor // 0) >= 1 and
  (.pattern.c0.minEraCoverageRatioForBackfill // -1) >= 0 and
  (.pattern.c0.minEraCoverageRatioForBackfill // 2) <= 1 and
  (.pattern.c0.minEffectiveEraCountRatio // -1) >= 0 and
  (.pattern.c0.minEffectiveEraCountRatio // 2) <= 1 and
  (.pattern.c0.minEffectiveEraCountRatioForBackfill // -1) >= 0 and
  (.pattern.c0.minEffectiveEraCountRatioForBackfill // 2) <= 1 and
  (.pattern.c0.minNormalizedEraEntropy // -1) >= 0 and
  (.pattern.c0.minNormalizedEraEntropy // 2) <= 1 and
  (.pattern.c0.minNormalizedEraEntropyForBackfill // -1) >= 0 and
  (.pattern.c0.minNormalizedEraEntropyForBackfill // 2) <= 1 and
  (.pattern.c0.maxSingleEraShareForBackfill // -1) >= 0 and
  (.pattern.c0.maxSingleEraShareForBackfill // 2) <= 1 and
  (.pattern.c0.scoreWeights.effectiveEraCount // -1) >= 0 and
  (.pattern.c0.scoreWeights.normalizedEraEntropy // -1) >= 0 and
  (.pattern.temporalStability.warnMinEffectiveEraCountRatio // -1) >= 0 and
  (.pattern.temporalStability.warnMinEffectiveEraCountRatio // 2) <= 1 and
  (.pattern.temporalStability.warnMinNormalizedEraEntropy // -1) >= 0 and
  (.pattern.temporalStability.warnMinNormalizedEraEntropy // 2) <= 1 and
  (.pattern.temporalStability.minEffectiveEraCountRatio // -1) >= 0 and
  (.pattern.temporalStability.minEffectiveEraCountRatio // 2) <= 1 and
  (.pattern.temporalStability.minNormalizedEraEntropy // -1) >= 0 and
  (.pattern.temporalStability.minNormalizedEraEntropy // 2) <= 1 and
  (.pattern.temporalStability.relaxMinEffectiveEraCountRatioStep // -1) >= 0 and
  (.pattern.temporalStability.relaxMinEffectiveEraCountRatioStep // 2) <= 1 and
  (.pattern.temporalStability.relaxMinNormalizedEraEntropyStep // -1) >= 0 and
  (.pattern.temporalStability.relaxMinNormalizedEraEntropyStep // 2) <= 1 and
  (.pattern.c1.enabled // false) == true and
  (.pattern.c1.maxProbeFamilies // 0) >= 1 and
  ((.pattern.c1.explicitFamilyIds // []) | type == "array") and
  (all((.pattern.c1.explicitFamilyIds // [])[]?; (type == "string") and (length > 0))) and
  (.pattern.c1.minFamilySupport // 0) >= 1 and
  (.pattern.c1.maxFamilyRepresentatives // 0) >= 1 and
  (.pattern.c1.probeProfile // "") == "C1_FAMILY_PROBE" and
  ((.pattern.c1.probeScope // "") == "update" or
   (.pattern.c1.probeScope // "") == "tune" or
   (.pattern.c1.probeScope // "") == "eval") and
  (.pattern.c1.familyPassMinTargetHitRateEval // -1) >= 0 and
  (.pattern.c1.familyPassMinTargetHitRateEval // 2) <= 1 and
  (.pattern.c1.familyPassMinExecutedTargetHitRateEval // -1) >= 0 and
  (.pattern.c1.familyPassMinExecutedTargetHitRateEval // 2) <= 1 and
  (.pattern.c1.familyPassMinSelectionHitAt1Eval // -1) >= 0 and
  (.pattern.c1.familyPassMinSelectionHitAt1Eval // 2) <= 1 and
  (.pattern.c1.familyPassMinPickedDaysEval // -1) >= 0 and
  (.pattern.c1.familyPassMinTargetsPer20EvalDays // -1) >= 0 and
  (.pattern.c1.familyPassMinExecutionCoverageEval // -1) >= 0 and
  (.pattern.c1.familyPassMinExecutionCoverageEval // 2) <= 1 and
  (.pattern.c1.familyPassMaxStopRateEval // -1) >= 0 and
  (.pattern.c1.familyPassMaxStopRateEval // 2) <= 1 and
  (.pattern.c1.familyPassMaxTimeoutNegativeRateEval // -1) >= 0 and
  (.pattern.c1.familyPassMaxTimeoutNegativeRateEval // 2) <= 1 and
  (.pattern.c1.familyBackfillFloor // 0) >= 1 and
  (.pattern.c1.familyBackfillFloor // 0) <= (.pattern.c1.maxProbeFamilies // 0) and
  (.pattern.c1.familyBackfillMax // -1) >= 0 and
  (.pattern.c1.retainTopProbeArtifacts // -1) >= 0 and
  (.pattern.c2.enabled // false) == true and
  (.pattern.c2.minFamiliesForDedup // 0) >= 2 and
  (.pattern.c2.maxFamiliesForPairwise // 0) >= (.pattern.c2.minFamiliesForDedup // 0) and
  (.pattern.c2.similarityThreshold // -1) >= 0 and
  (.pattern.c2.similarityThreshold // 2) <= 1 and
  (.pattern.c2.top1AgreementThreshold // -1) >= 0 and
  (.pattern.c2.top1AgreementThreshold // 2) <= 1 and
  (.pattern.c2.symbolDayJaccardThreshold // -1) >= 0 and
  (.pattern.c2.symbolDayJaccardThreshold // 2) <= 1 and
  (.pattern.c2.pickedDayJaccardThreshold // -1) >= 0 and
  (.pattern.c2.pickedDayJaccardThreshold // 2) <= 1 and
  (.pattern.c2.executionOverlapThreshold // -1) >= 0 and
  (.pattern.c2.executionOverlapThreshold // 2) <= 1 and
  (.pattern.c2.maxBehaviorPenaltyDistance // -1) >= 0 and
  (.pattern.c2.maxBehaviorPenaltyDistance // 2) <= 1 and
  (.pattern.c2.rankOverlapThreshold // -1) >= 0 and
  (.pattern.c2.rankOverlapThreshold // 2) <= 1 and
  (.pattern.c2.minRepresentativeFamilies // 0) >= 1 and
  (.pattern.c2.minRepresentativeTargetsPer20EvalDays // -1) >= 0 and
  (.pattern.c2.minRepresentativeExecutionCoverageEval // -1) >= 0 and
  (.pattern.c2.minRepresentativeExecutionCoverageEval // 2) <= 1 and
  (.pattern.c2.minRepresentativeScoreFloor // -1) >= 0 and
  ((.pattern.c2.representativePolicy // "") == "quality_first_with_coverage_guard" or
   (.pattern.c2.representativePolicy // "") == "coverage_first_with_quality_floor") and
  ((.pattern.c2.similarityPolicyVersion // "") == "c2_overlap_graph_v1" or
   (.pattern.c2.similarityPolicyVersion // "") == "c2_overlap_graph_strict_v1") and
  (.pattern.c2.targetCoverageNorm // 0) > 0 and
  .qualityGate.enabled == true and
  .qualityGate.lockbox.enabled == true and
  (.qualityGate.lockbox.minTrades // 0) >= 1 and
  .cdLoop.lockboxGate.enabled == true and
  (.cdLoop.lockboxGate.minTrades // 0) >= (.qualityGate.lockbox.minTrades // 1) and
  .cdLoop.lockboxGate.requireZeroLookaheadViolations == true and
  .runManifest.enabled == true and
  .bundlePolicy.enabled == true and
  (.bundlePolicy.maxArchiveMb // 0) <= 200 and
  .opsSlo.enabled == true and
  .opsSlo.rollbackOnGateFail == true
' "$cfg" >/dev/null || {
  echo "server-lite contract check failed: $cfg"
  exit 1
}

echo "==> strict: enforce anti-selection-bias script defaults"
if [[ -f tools/stepc_autorelax_select.sh ]]; then
  if ! grep -q 'SWITCH_BASELINE=.*false' tools/stepc_autorelax_select.sh; then
    echo "tools/stepc_autorelax_select.sh must default SWITCH_BASELINE=false"
    exit 1
  fi
  if ! grep -q 'REQUIRE_FROZEN_EVAL_PASS=.*true' tools/stepc_autorelax_select.sh; then
    echo "tools/stepc_autorelax_select.sh must default REQUIRE_FROZEN_EVAL_PASS=true"
    exit 1
  fi
else
  echo "[warn] skip optional strict check: tools/stepc_autorelax_select.sh"
fi
if [[ -f meta/scripts/run_combined32_online.sh ]]; then
  if ! grep -q 'CHAIN_SEED=.*false' meta/scripts/run_combined32_online.sh; then
    echo "meta/scripts/run_combined32_online.sh must default CHAIN_SEED=false"
    exit 1
  fi
else
  echo "[warn] skip optional strict check: meta/scripts/run_combined32_online.sh"
fi

echo "==> strict mode checks passed"
