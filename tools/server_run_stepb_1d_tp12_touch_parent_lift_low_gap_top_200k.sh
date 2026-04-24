#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_RUN_ID="perfect_proto_stepb_1d_tp12_low_gap_top_parent_lift_bundle_200k_$(date +%Y%m%d_%H%M%S)"
DEFAULT_SCOPE_RUN_ID="perfect_proto_stepb_1d_tp12_low_subscopes_control_200k_20260403_gap_top"
DEFAULT_SCOPE_LABEL="LOW_GAP_TOP"
DEFAULT_CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"
REPORT_NODE_HEAP_MB="4096"

RUN_ID="$DEFAULT_RUN_ID"
SCOPE_RUN_ID="$DEFAULT_SCOPE_RUN_ID"
SCOPE_LABEL="$DEFAULT_SCOPE_LABEL"
CANDLE_PATH="$DEFAULT_CANDLE_PATH"
FOLD_SCHEME="chronological_4"
HOLD_DAYS="3"
TARGET_PCT="0.12"
STOP_LOSS_PCT="0.04"
MIN_DONOR_TRAIN_HIT_DATES="3"
MIN_CANDIDATE_TRAIN_DATES="6"
MIN_CANDIDATE_TRAIN_MONTHS="4"
MIN_CANDIDATE_TRAIN_FOLDS="3"
MIN_CANDIDATE_TRAIN_PRECISION="0.4"
MAX_DONOR_TERMS="12"
MAX_CLUSTER_TERMS="6"
MAX_BUNDLE_CANDIDATE_TERMS="6"
MAX_SEED_CLUSTERS="2"
MAX_PARENT_TERMS="12"
MIN_PARENT_TRAIN_SELECTED_ROWS="12"
MIN_PARENT_TRAIN_DATES="10"
MIN_PARENT_TRAIN_MONTHS="6"
MIN_PARENT_TRAIN_FOLDS="4"
MIN_PARENT_TRAIN_PRECISION="0.34"
MIN_TERM_TRAIN_PRECISION="0.3"
MIN_TERM_TRAIN_DATES="3"
MIN_TRAIN_TERM_MONTHS="2"
MIN_TRAIN_TERM_FOLDS="3"
MAX_POSITIVE_TERMS="10"
MAX_VETO_TOKENS="2"
MIN_POSITIVE_IMPROVEMENT="0.005"
MIN_POSITIVE_NEW_DATE_GAIN="1"
MIN_POSITIVE_NEW_ROW_GAIN="1"
MIN_VETO_IMPROVEMENT="0.005"
MIN_SELECTED_ROWS_AFTER_VETO="20"
MIN_SELECTED_DATES_AFTER_VETO="12"
MAX_TOP1_DATE_HIT_SHARE="0.2"
MAX_SELECTED_DONOR_TERMS="3"
MAX_SELECTED_CLUSTER_TERMS="3"
MAX_SELECTED_BROADENED_TERMS="3"
MAX_SELECTED_PARENT_TERMS="4"
MIN_VETO_NEGATIVE_HITS="4"
MIN_VETO_NET_GAIN="1"
MIN_VERDICT_OOS_SELECTED_ROWS="40"
MIN_VERDICT_OOS_DATES="20"
MAX_VERDICT_OOS_TOP1_DATE_HIT_SHARE="0.15"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

run_report_node() {
  NODE_OPTIONS="--max-old-space-size=$REPORT_NODE_HEAP_MB ${NODE_OPTIONS:-}" node "$@"
}

usage() {
  cat <<EOF2
Usage: bash tools/server_run_stepb_1d_tp12_touch_parent_lift_low_gap_top_200k.sh [--run-id=<run_id>] [--scope-run-id=<child_run_id>] [--scope-label=LOW_GAP_TOP] [--candle-path=<data/candle_daily.jsonl>]
Runs the server-only LOW_GAP_TOP TP12 touch parent-lift bundle report against an existing filtered child run.
Defaults:
  scope-run-id=$DEFAULT_SCOPE_RUN_ID
  scope-label=$DEFAULT_SCOPE_LABEL
  contract=NEXT_DAY_OPEN / 3d / +12% touch / no stop gate
EOF2
}

for arg in "$@"; do
  case "$arg" in
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --scope-run-id=*) SCOPE_RUN_ID="${arg#*=}" ;;
    --scope-label=*) SCOPE_LABEL="${arg#*=}" ;;
    --candle-path=*) CANDLE_PATH="${arg#*=}" ;;
    --fold-scheme=*) FOLD_SCHEME="${arg#*=}" ;;
    --hold-days=*) HOLD_DAYS="${arg#*=}" ;;
    --target-pct=*) TARGET_PCT="${arg#*=}" ;;
    --stop-loss-pct=*) STOP_LOSS_PCT="${arg#*=}" ;;
    --min-donor-train-hit-dates=*) MIN_DONOR_TRAIN_HIT_DATES="${arg#*=}" ;;
    --min-candidate-train-dates=*) MIN_CANDIDATE_TRAIN_DATES="${arg#*=}" ;;
    --min-candidate-train-months=*) MIN_CANDIDATE_TRAIN_MONTHS="${arg#*=}" ;;
    --min-candidate-train-folds=*) MIN_CANDIDATE_TRAIN_FOLDS="${arg#*=}" ;;
    --min-candidate-train-precision=*) MIN_CANDIDATE_TRAIN_PRECISION="${arg#*=}" ;;
    --max-donor-terms=*) MAX_DONOR_TERMS="${arg#*=}" ;;
    --max-cluster-terms=*) MAX_CLUSTER_TERMS="${arg#*=}" ;;
    --max-bundle-candidate-terms=*) MAX_BUNDLE_CANDIDATE_TERMS="${arg#*=}" ;;
    --max-seed-clusters=*) MAX_SEED_CLUSTERS="${arg#*=}" ;;
    --max-parent-terms=*) MAX_PARENT_TERMS="${arg#*=}" ;;
    --min-parent-train-selected-rows=*) MIN_PARENT_TRAIN_SELECTED_ROWS="${arg#*=}" ;;
    --min-parent-train-dates=*) MIN_PARENT_TRAIN_DATES="${arg#*=}" ;;
    --min-parent-train-months=*) MIN_PARENT_TRAIN_MONTHS="${arg#*=}" ;;
    --min-parent-train-folds=*) MIN_PARENT_TRAIN_FOLDS="${arg#*=}" ;;
    --min-parent-train-precision=*) MIN_PARENT_TRAIN_PRECISION="${arg#*=}" ;;
    --min-term-train-precision=*) MIN_TERM_TRAIN_PRECISION="${arg#*=}" ;;
    --min-term-train-dates=*) MIN_TERM_TRAIN_DATES="${arg#*=}" ;;
    --min-train-term-months=*) MIN_TRAIN_TERM_MONTHS="${arg#*=}" ;;
    --min-train-term-folds=*) MIN_TRAIN_TERM_FOLDS="${arg#*=}" ;;
    --max-positive-terms=*) MAX_POSITIVE_TERMS="${arg#*=}" ;;
    --max-veto-tokens=*) MAX_VETO_TOKENS="${arg#*=}" ;;
    --min-positive-improvement=*) MIN_POSITIVE_IMPROVEMENT="${arg#*=}" ;;
    --min-positive-new-date-gain=*) MIN_POSITIVE_NEW_DATE_GAIN="${arg#*=}" ;;
    --min-positive-new-row-gain=*) MIN_POSITIVE_NEW_ROW_GAIN="${arg#*=}" ;;
    --min-veto-improvement=*) MIN_VETO_IMPROVEMENT="${arg#*=}" ;;
    --min-selected-rows-after-veto=*) MIN_SELECTED_ROWS_AFTER_VETO="${arg#*=}" ;;
    --min-selected-dates-after-veto=*) MIN_SELECTED_DATES_AFTER_VETO="${arg#*=}" ;;
    --max-top1-date-hit-share=*) MAX_TOP1_DATE_HIT_SHARE="${arg#*=}" ;;
    --max-selected-donor-terms=*) MAX_SELECTED_DONOR_TERMS="${arg#*=}" ;;
    --max-selected-cluster-terms=*) MAX_SELECTED_CLUSTER_TERMS="${arg#*=}" ;;
    --max-selected-broadened-terms=*) MAX_SELECTED_BROADENED_TERMS="${arg#*=}" ;;
    --max-selected-parent-terms=*) MAX_SELECTED_PARENT_TERMS="${arg#*=}" ;;
    --min-veto-negative-hits=*) MIN_VETO_NEGATIVE_HITS="${arg#*=}" ;;
    --min-veto-net-gain=*) MIN_VETO_NET_GAIN="${arg#*=}" ;;
    --min-verdict-oos-selected-rows=*) MIN_VERDICT_OOS_SELECTED_ROWS="${arg#*=}" ;;
    --min-verdict-oos-dates=*) MIN_VERDICT_OOS_DATES="${arg#*=}" ;;
    --max-verdict-oos-top1-date-hit-share=*) MAX_VERDICT_OOS_TOP1_DATE_HIT_SHARE="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) fatal "Unknown argument: $arg" ;;
  esac
done

[[ "$ROOT_DIR" == "$EXPECTED_SERVER_ROOT" ]] || fatal "Run this wrapper on the server repo root: expected=$EXPECTED_SERVER_ROOT actual=$ROOT_DIR"
[[ -n "$RUN_ID" ]] || fatal "--run-id must not be empty"
[[ -n "$SCOPE_RUN_ID" ]] || fatal "--scope-run-id must not be empty"
[[ -f "$CANDLE_PATH" ]] || fatal "candle path missing: $CANDLE_PATH"

PARENT_RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
OUT_DIR="$PARENT_RUN_DIR/step-perfect-prototype-1d-tp12-touch-parent-lift-report"
mkdir -p "$OUT_DIR"

started_at="$(date +%s)"
run_report_node tools/build_stepb_1d_tp12_touch_parent_lift_report.mjs \
  --scope-run-id="$SCOPE_RUN_ID" \
  --scope-label="$SCOPE_LABEL" \
  --out-dir="$OUT_DIR" \
  --candle-path="$CANDLE_PATH" \
  --fold-scheme="$FOLD_SCHEME" \
  --hold-days="$HOLD_DAYS" \
  --target-pct="$TARGET_PCT" \
  --stop-loss-pct="$STOP_LOSS_PCT" \
  --min-donor-train-hit-dates="$MIN_DONOR_TRAIN_HIT_DATES" \
  --min-candidate-train-dates="$MIN_CANDIDATE_TRAIN_DATES" \
  --min-candidate-train-months="$MIN_CANDIDATE_TRAIN_MONTHS" \
  --min-candidate-train-folds="$MIN_CANDIDATE_TRAIN_FOLDS" \
  --min-candidate-train-precision="$MIN_CANDIDATE_TRAIN_PRECISION" \
  --max-donor-terms="$MAX_DONOR_TERMS" \
  --max-cluster-terms="$MAX_CLUSTER_TERMS" \
  --max-bundle-candidate-terms="$MAX_BUNDLE_CANDIDATE_TERMS" \
  --max-seed-clusters="$MAX_SEED_CLUSTERS" \
  --max-parent-terms="$MAX_PARENT_TERMS" \
  --min-parent-train-selected-rows="$MIN_PARENT_TRAIN_SELECTED_ROWS" \
  --min-parent-train-dates="$MIN_PARENT_TRAIN_DATES" \
  --min-parent-train-months="$MIN_PARENT_TRAIN_MONTHS" \
  --min-parent-train-folds="$MIN_PARENT_TRAIN_FOLDS" \
  --min-parent-train-precision="$MIN_PARENT_TRAIN_PRECISION" \
  --min-term-train-precision="$MIN_TERM_TRAIN_PRECISION" \
  --min-term-train-dates="$MIN_TERM_TRAIN_DATES" \
  --min-train-term-months="$MIN_TRAIN_TERM_MONTHS" \
  --min-train-term-folds="$MIN_TRAIN_TERM_FOLDS" \
  --max-positive-terms="$MAX_POSITIVE_TERMS" \
  --max-veto-tokens="$MAX_VETO_TOKENS" \
  --min-positive-improvement="$MIN_POSITIVE_IMPROVEMENT" \
  --min-positive-new-date-gain="$MIN_POSITIVE_NEW_DATE_GAIN" \
  --min-positive-new-row-gain="$MIN_POSITIVE_NEW_ROW_GAIN" \
  --min-veto-improvement="$MIN_VETO_IMPROVEMENT" \
  --min-selected-rows-after-veto="$MIN_SELECTED_ROWS_AFTER_VETO" \
  --min-selected-dates-after-veto="$MIN_SELECTED_DATES_AFTER_VETO" \
  --max-top1-date-hit-share="$MAX_TOP1_DATE_HIT_SHARE" \
  --max-selected-donor-terms="$MAX_SELECTED_DONOR_TERMS" \
  --max-selected-cluster-terms="$MAX_SELECTED_CLUSTER_TERMS" \
  --max-selected-broadened-terms="$MAX_SELECTED_BROADENED_TERMS" \
  --max-selected-parent-terms="$MAX_SELECTED_PARENT_TERMS" \
  --min-veto-negative-hits="$MIN_VETO_NEGATIVE_HITS" \
  --min-veto-net-gain="$MIN_VETO_NET_GAIN" \
  --min-verdict-oos-selected-rows="$MIN_VERDICT_OOS_SELECTED_ROWS" \
  --min-verdict-oos-dates="$MIN_VERDICT_OOS_DATES" \
  --max-verdict-oos-top1-date-hit-share="$MAX_VERDICT_OOS_TOP1_DATE_HIT_SHARE"
finished_at="$(date +%s)"
elapsed_sec="$(( finished_at - started_at ))"

cat > "$OUT_DIR/runtime.json" <<EOF2
{
  "runId": "$RUN_ID",
  "scopeRunId": "$SCOPE_RUN_ID",
  "scopeLabel": "$SCOPE_LABEL",
  "wallClockSec": $elapsed_sec,
  "foldScheme": "$FOLD_SCHEME",
  "holdDays": $HOLD_DAYS,
  "targetPct": $TARGET_PCT,
  "stopLossPct": $STOP_LOSS_PCT,
  "minDonorTrainHitDates": $MIN_DONOR_TRAIN_HIT_DATES,
  "minCandidateTrainDates": $MIN_CANDIDATE_TRAIN_DATES,
  "minCandidateTrainMonths": $MIN_CANDIDATE_TRAIN_MONTHS,
  "minCandidateTrainFolds": $MIN_CANDIDATE_TRAIN_FOLDS,
  "minCandidateTrainPrecision": $MIN_CANDIDATE_TRAIN_PRECISION,
  "maxDonorTerms": $MAX_DONOR_TERMS,
  "maxClusterTerms": $MAX_CLUSTER_TERMS,
  "maxBundleCandidateTerms": $MAX_BUNDLE_CANDIDATE_TERMS,
  "maxSeedClusters": $MAX_SEED_CLUSTERS,
  "maxParentTerms": $MAX_PARENT_TERMS,
  "minParentTrainSelectedRows": $MIN_PARENT_TRAIN_SELECTED_ROWS,
  "minParentTrainDates": $MIN_PARENT_TRAIN_DATES,
  "minParentTrainMonths": $MIN_PARENT_TRAIN_MONTHS,
  "minParentTrainFolds": $MIN_PARENT_TRAIN_FOLDS,
  "minParentTrainPrecision": $MIN_PARENT_TRAIN_PRECISION,
  "minTermTrainPrecision": $MIN_TERM_TRAIN_PRECISION,
  "minTermTrainDates": $MIN_TERM_TRAIN_DATES,
  "minTrainTermMonths": $MIN_TRAIN_TERM_MONTHS,
  "minTrainTermFolds": $MIN_TRAIN_TERM_FOLDS,
  "maxPositiveTerms": $MAX_POSITIVE_TERMS,
  "maxVetoTokens": $MAX_VETO_TOKENS,
  "minPositiveImprovement": $MIN_POSITIVE_IMPROVEMENT,
  "minPositiveNewDateGain": $MIN_POSITIVE_NEW_DATE_GAIN,
  "minPositiveNewRowGain": $MIN_POSITIVE_NEW_ROW_GAIN,
  "minVetoImprovement": $MIN_VETO_IMPROVEMENT,
  "minSelectedRowsAfterVeto": $MIN_SELECTED_ROWS_AFTER_VETO,
  "minSelectedDatesAfterVeto": $MIN_SELECTED_DATES_AFTER_VETO,
  "maxTop1DateHitShare": $MAX_TOP1_DATE_HIT_SHARE,
  "maxSelectedDonorTerms": $MAX_SELECTED_DONOR_TERMS,
  "maxSelectedClusterTerms": $MAX_SELECTED_CLUSTER_TERMS,
  "maxSelectedBroadenedTerms": $MAX_SELECTED_BROADENED_TERMS,
  "maxSelectedParentTerms": $MAX_SELECTED_PARENT_TERMS,
  "minVetoNegativeHits": $MIN_VETO_NEGATIVE_HITS,
  "minVetoNetGain": $MIN_VETO_NET_GAIN,
  "minVerdictOosSelectedRows": $MIN_VERDICT_OOS_SELECTED_ROWS,
  "minVerdictOosDates": $MIN_VERDICT_OOS_DATES,
  "maxVerdictOosTop1DateHitShare": $MAX_VERDICT_OOS_TOP1_DATE_HIT_SHARE
}
EOF2

cat <<EOF2
[done] 1D TP12 LOW_GAP_TOP touch parent-lift completed
  runId=$RUN_ID
  scopeRunId=$SCOPE_RUN_ID
  outDir=$OUT_DIR
  report=$OUT_DIR/report.md
EOF2
