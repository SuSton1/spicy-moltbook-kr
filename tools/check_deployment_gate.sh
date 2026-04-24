#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/check_deployment_gate.sh --summary=<step_d_summary.json> [--lockbox-summary=<step_e_summary.json>] [--config=<config.json>] [--output=<json>] [--strict]

Options:
  --summary=PATH   Required Step-D summary path
  --lockbox-summary=PATH  Optional Step-E summary path (auto-detect from step-d path when omitted)
  --config=PATH    Config path (default: config/lab.config.server.lite.json)
  --output=PATH    Optional gate result JSON output path
  --strict         Exit non-zero when gate fails
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SUMMARY_PATH=""
LOCKBOX_SUMMARY_PATH=""
CFG_PATH="config/lab.config.server.lite.json"
OUT_PATH=""
STRICT_MODE=0

for arg in "$@"; do
  case "$arg" in
    --summary=*) SUMMARY_PATH="${arg#--summary=}" ;;
    --lockbox-summary=*) LOCKBOX_SUMMARY_PATH="${arg#--lockbox-summary=}" ;;
    --config=*) CFG_PATH="${arg#--config=}" ;;
    --output=*) OUT_PATH="${arg#--output=}" ;;
    --strict) STRICT_MODE=1 ;;
    *)
      echo "[fatal] unknown arg: $arg" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$SUMMARY_PATH" ]]; then
  echo "[fatal] --summary is required" >&2
  exit 1
fi
if [[ ! -f "$SUMMARY_PATH" ]]; then
  echo "[fatal] summary not found: $SUMMARY_PATH" >&2
  exit 1
fi
if [[ ! -f "$CFG_PATH" ]]; then
  echo "[fatal] config not found: $CFG_PATH" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "[fatal] jq is required" >&2
  exit 1
fi
if ! jq -e 'has("topKOracleGapEval") and (.topKOracleGapEval | type == "number")' "$SUMMARY_PATH" >/dev/null 2>&1; then
  echo "[fatal] summary missing numeric topKOracleGapEval (strict mode): $SUMMARY_PATH" >&2
  exit 1
fi

if [[ -z "$LOCKBOX_SUMMARY_PATH" ]]; then
  guess_step_e_dir="$(dirname "$(dirname "$SUMMARY_PATH")")/step-e"
  guess_step_e_summary="$guess_step_e_dir/step_e_summary.json"
  if [[ -f "$guess_step_e_summary" ]]; then
    LOCKBOX_SUMMARY_PATH="$guess_step_e_summary"
  fi
fi

HAS_LOCKBOX_SUMMARY=0
LOCKBOX_SLURP_PATH=""
if [[ -n "$LOCKBOX_SUMMARY_PATH" && -f "$LOCKBOX_SUMMARY_PATH" ]]; then
  HAS_LOCKBOX_SUMMARY=1
  LOCKBOX_SLURP_PATH="$LOCKBOX_SUMMARY_PATH"
else
  LOCKBOX_SLURP_PATH="$(mktemp)"
  printf '{}\n' > "$LOCKBOX_SLURP_PATH"
fi

result="$(
  jq -n \
    --arg summaryPath "$SUMMARY_PATH" \
    --arg lockboxSummaryPath "$LOCKBOX_SUMMARY_PATH" \
    --arg configPath "$CFG_PATH" \
    --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson hasLockboxSummary "$HAS_LOCKBOX_SUMMARY" \
    --slurpfile s "$SUMMARY_PATH" \
    --slurpfile l "$LOCKBOX_SLURP_PATH" \
    --slurpfile c "$CFG_PATH" '
      def n(v; d): (v // d) | tonumber;
      def b(v; d): (v // d) | if . == true then true else false end;
      ($s[0] // {}) as $S |
      ($l[0] // {}) as $L |
      ($c[0] // {}) as $C |
      ($C.qualityGate // {}) as $Q |
      ($Q.minEvalSamples // 20) as $minEvalSamples |
      ($Q.minPickCountEval // 15) as $minPickCountEval |
      ($Q.maxPickCountEval // 24) as $maxPickCountEval |
      ($Q.minPickHitRateEval // 0.35) as $minPickHitRateEval |
      ($Q.minPickHitRateEvalLcb95 // 0.18) as $minPickHitRateEvalLcb95 |
      ($Q.minHitAt1Eval // 0.35) as $minHitAt1Eval |
      ($Q.maxTopKOracleGapEval // 0.02) as $maxTopKOracleGapEval |
      ($Q.minOracleHitRateTopKEval // 0.95) as $minOracleHitRateTopKEval |
      ($Q.requireZeroLookaheadViolations // true) as $requireZeroLookahead |
      ($Q.lockbox // {}) as $QH |
      ($QH.enabled // false) as $lockboxEnabled |
      ($QH.minTrades // 10) as $lockboxMinTrades |
      ($QH.minWinRate // 0.45) as $lockboxMinWinRate |
      ($QH.minAvgNetRet // 0) as $lockboxMinAvgNetRet |
      ($QH.minCumulativeReturn // 0) as $lockboxMinCumulativeReturn |
      ($QH.maxDrawdown // 0.35) as $lockboxMaxDrawdown |
      (n($S.generalization.evalDays; 0)) as $evalDays |
      (n($S.pickedCountEval; 0)) as $pickedCountEval |
      (n($S.pickHitRateEval; 0)) as $pickHitRateEval |
      (n($S.pickHitRateEvalLcb95; 0)) as $pickHitRateEvalLcb95 |
      (n($S.hitAt1Eval; 0)) as $hitAt1Eval |
      (n($S.oracleHitRateTopKEval; 0)) as $oracleHitRateTopKEval |
      (($S.topKOracleGapEval | tonumber)) as $topKOracleGapEval |
      (n($S.lookaheadViolations; 0)) as $stepDLookaheadViolations |
      (n($S.executionLookaheadViolations; 0)) as $stepDExecutionLookaheadViolations |
      (n($L.totalTrades; 0)) as $lockboxTotalTrades |
      (n($L.winRate; 0)) as $lockboxWinRate |
      (n($L.avgNetRet; 0)) as $lockboxAvgNetRet |
      (n($L.cumulativeReturn; 0)) as $lockboxCumulativeReturn |
      (n($L.maxDrawdown; 1)) as $lockboxMaxDrawdownObserved |
      (n($L.lookaheadViolations; 0)) as $lockboxLookaheadViolations |
      (n($L.executionLookaheadViolations; 0)) as $lockboxExecutionLookaheadViolations |
      {
        generatedAt: $generatedAt,
        summaryPath: $summaryPath,
        lockboxSummaryPath: (if $lockboxSummaryPath == "" then null else $lockboxSummaryPath end),
        configPath: $configPath,
        gate: {
          minEvalSamples: $minEvalSamples,
          minPickCountEval: $minPickCountEval,
          maxPickCountEval: $maxPickCountEval,
          minPickHitRateEval: $minPickHitRateEval,
          minPickHitRateEvalLcb95: $minPickHitRateEvalLcb95,
          minHitAt1Eval: $minHitAt1Eval,
          maxTopKOracleGapEval: $maxTopKOracleGapEval,
          minOracleHitRateTopKEval: $minOracleHitRateTopKEval,
          requireZeroLookaheadViolations: $requireZeroLookahead,
          lockbox: {
            enabled: $lockboxEnabled,
            minTrades: $lockboxMinTrades,
            minWinRate: $lockboxMinWinRate,
            minAvgNetRet: $lockboxMinAvgNetRet,
            minCumulativeReturn: $lockboxMinCumulativeReturn,
            maxDrawdown: $lockboxMaxDrawdown
          }
        },
        metrics: {
          evalDays: $evalDays,
          pickedCountEval: $pickedCountEval,
          pickHitRateEval: $pickHitRateEval,
          pickHitRateEvalLcb95: $pickHitRateEvalLcb95,
          hitAt1Eval: $hitAt1Eval,
          oracleHitRateTopKEval: $oracleHitRateTopKEval,
          topKOracleGapEval: $topKOracleGapEval,
          lookaheadViolations: $stepDLookaheadViolations,
          executionLookaheadViolations: $stepDExecutionLookaheadViolations,
          lockboxLookaheadViolations: $lockboxLookaheadViolations,
          lockboxExecutionLookaheadViolations: $lockboxExecutionLookaheadViolations,
          lockboxPresent: ($hasLockboxSummary == 1),
          lockboxTotalTrades: $lockboxTotalTrades,
          lockboxWinRate: $lockboxWinRate,
          lockboxAvgNetRet: $lockboxAvgNetRet,
          lockboxCumulativeReturn: $lockboxCumulativeReturn,
          lockboxMaxDrawdown: $lockboxMaxDrawdownObserved
        },
        checks: {
          evalDays: ($evalDays >= $minEvalSamples),
          pickedCountRange: ($pickedCountEval >= $minPickCountEval and $pickedCountEval <= $maxPickCountEval),
          pickHitRateEval: ($pickHitRateEval >= $minPickHitRateEval),
          pickHitRateEvalLcb95: ($pickHitRateEvalLcb95 >= $minPickHitRateEvalLcb95),
          hitAt1Eval: ($hitAt1Eval >= $minHitAt1Eval),
          oracleHitRateTopKEval: ($oracleHitRateTopKEval >= $minOracleHitRateTopKEval),
          topKOracleGapEval: ($topKOracleGapEval <= $maxTopKOracleGapEval),
          lookahead: (
            if $requireZeroLookahead
            then ($stepDLookaheadViolations == 0 and $stepDExecutionLookaheadViolations == 0)
            else true
            end
          ),
          lockboxSummaryPresent: (
            if $lockboxEnabled
            then ($hasLockboxSummary == 1)
            else true
            end
          ),
          lockboxTotalTrades: (
            if $lockboxEnabled
            then ($lockboxTotalTrades >= $lockboxMinTrades)
            else true
            end
          ),
          lockboxWinRate: (
            if $lockboxEnabled
            then ($lockboxWinRate >= $lockboxMinWinRate)
            else true
            end
          ),
          lockboxAvgNetRet: (
            if $lockboxEnabled
            then ($lockboxAvgNetRet >= $lockboxMinAvgNetRet)
            else true
            end
          ),
          lockboxCumulativeReturn: (
            if $lockboxEnabled
            then ($lockboxCumulativeReturn >= $lockboxMinCumulativeReturn)
            else true
            end
          ),
          lockboxMaxDrawdown: (
            if $lockboxEnabled
            then ($lockboxMaxDrawdownObserved <= $lockboxMaxDrawdown)
            else true
            end
          ),
          lockboxLookahead: (
            if $lockboxEnabled
            then (
              if $requireZeroLookahead
              then ($hasLockboxSummary == 1 and $lockboxLookaheadViolations == 0 and $lockboxExecutionLookaheadViolations == 0)
              else true
              end
            )
            else true
            end
          )
        }
      }
      | .overallPass = (
          .checks.evalDays and
          .checks.pickedCountRange and
          .checks.pickHitRateEval and
          .checks.pickHitRateEvalLcb95 and
          .checks.hitAt1Eval and
          .checks.oracleHitRateTopKEval and
          .checks.topKOracleGapEval and
          .checks.lookahead and
          .checks.lockboxSummaryPresent and
          .checks.lockboxTotalTrades and
          .checks.lockboxWinRate and
          .checks.lockboxAvgNetRet and
          .checks.lockboxCumulativeReturn and
          .checks.lockboxMaxDrawdown and
          .checks.lockboxLookahead
        )
    '
)"

if [[ "$HAS_LOCKBOX_SUMMARY" -eq 0 && -f "$LOCKBOX_SLURP_PATH" ]]; then
  rm -f "$LOCKBOX_SLURP_PATH"
fi

if [[ -n "$OUT_PATH" ]]; then
  mkdir -p "$(dirname "$OUT_PATH")"
  printf '%s\n' "$result" > "$OUT_PATH"
fi

printf '%s\n' "$result"

if [[ "$STRICT_MODE" -eq 1 ]]; then
  pass="$(jq -r '.overallPass' <<<"$result")"
  if [[ "$pass" != "true" ]]; then
    exit 1
  fi
fi
