#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONFIG="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite.json"
DEFAULT_RUN_ID="${STEPB_PLUS_LITE_WRAPPER_RUN_ID_PREFIX:-perfect_proto_stepb_dplus1_plus_lite_afree}_$(date +%Y%m%d_%H%M%S)"
EXPECTED_BASELINE_LINE_ID="${STEPB_PLUS_LITE_WRAPPER_LINE_ID:-stepb_dplus1_plus_lite}"
EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS="100000"
EXPECTED_CONTEXT_SURFACE="${STEPB_PLUS_LITE_WRAPPER_CONTEXT_SURFACE:-v3_contextual_plus_lite}"
OPEN_PACK_NODE_HEAP_MB="6144"
EXACT_INDEX_NODE_HEAP_MB="6144"
MINE_NODE_HEAP_MB="8192"
LIB_PATH="$ROOT_DIR/tools/lib_stepb_dplus1_baseline_wrapper.sh"
DEFAULT_DISCOVERY_UNIVERSE_ID="afree_open"
DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS="3"

CONFIG_PATH="${STEPB_PLUS_LITE_WRAPPER_CONFIG:-$DEFAULT_CONFIG}"
RUN_ID="$DEFAULT_RUN_ID"
SPLIT_POLICY=""
TRAIN_START="2020-11-27"
TRAIN_END="2024-12-31"
OOS_START="2025-01-01"
OOS_END="2026-01-31"
SELECTION_MODE="union_all"
CLOSE28_FILTER_PCT="28"
MIN_HIT_COUNT="6"
ENABLE_TRAIN_MATCHED_DATE_PRUNE=""
MIN_TRAIN_MATCHED_DATES=""
MIN_TRAIN_MATCHED_MONTHS=""
MIN_TRAIN_MATCHED_QUARTERS=""
MIN_TRAIN_MATCHED_FOLDS=""
FOLD_SCHEME=""
MAX_TOP1_DATE_HIT_SHARE=""
MAX_TOP3_DATE_HIT_SHARE=""
MAX_TOP1_FOLD_HIT_SHARE=""
MAX_TOP3_FOLD_HIT_SHARE=""
MAX_RULES_PER_MATCHED_DATE_SIGNATURE=""
MAX_RULES_PER_MATCHED_MONTH_SIGNATURE=""
MAX_RULES_PER_MATCHED_QUARTER_SIGNATURE=""
ENABLE_DIVERSE_SEARCH_ORDERING=""
ENABLE_LANE_STRATIFIED_MINING=""
ENABLE_FAMILY_SCOPED_MINING=""
DIVERSE_BEAM_MAX_PER_MONTH_SIGNATURE=""
DIVERSE_BEAM_MAX_PER_QUARTER_SIGNATURE=""
DIVERSE_BEAM_MAX_PER_ANCHOR_FAMILY=""
FAMILY_SEED_MAX_TOP_BUCKET=""
FAMILY_SEED_MAX_MID_BUCKET=""
FAMILY_SEED_MAX_LOW_BUCKET=""
MID_FAMILY_MIN_SHARE=""
LOW_FAMILY_MIN_SHARE=""
LOW_FAMILY_SEARCH_MIN_HIT_COUNT=""
LOW_FAMILY_MIN_TRAIN_MATCHED_DATES=""
LOW_FAMILY_MIN_TRAIN_MATCHED_MONTHS=""
LOW_FAMILY_MIN_TRAIN_MATCHED_FOLDS=""
RECENT_ONLY_FAMILY_IDS=""
SUPPORT_CASES_FILE=""
SUPPORT_FEATURE_CASES_FILE=""
SUPPORT_CASE_MAX_ROOT_SEEDS=""
SUPPORT_CASE_MAX_EFFECTIVE_ROOT_SEEDS=""
SUPPORT_CASE_MIN_ROOT_OVERLAP=""
SUPPORT_CASE_MIN_PREFIX_OVERLAP=""
SUPPORT_CASE_PREFIX_DEPTH_LIMIT=""
SUPPORT_CASE_MIN_DONOR_ROOT_OVERLAP=""
SUPPORT_CASE_MIN_DONOR_PREFIX_OVERLAP=""
SUPPORT_CASE_DONOR_PREFIX_DEPTH_LIMIT=""
SUPPORT_CASE_FAIL_IF_ROOT_SCOPE_UNCOMPRESSED=""
ENABLE_SUBGROUP_PREPASS=""
SUBGROUP_MIN_MATCHED_DATES=""
SUBGROUP_MIN_MATCHED_MONTHS=""
SUBGROUP_MIN_MATCHED_FOLDS=""
SUBGROUP_MAX_ROOT_SEEDS=""
ENABLE_SUBGROUP_STABILITY=""
ENABLE_SUBGROUP_DIVERSITY=""
SUBGROUP_MAX_MANIFESTS=""
SUBGROUP_MIN_SELECTION_FREQUENCY=""
SUBGROUP_MIN_FOLD_PRESENCE_COUNT=""
SUBGROUP_MIN_WINDOW_PRESENCE_COUNT=""
SUBGROUP_MAX_TOKEN_JACCARD=""
SUBGROUP_MAX_AXIS_OVERLAP=""
SUBGROUP_MAX_DATE_COVER_JACCARD=""
SUBGROUP_EARLY_DATE_RETENTION_RATIO=""
SUBGROUP_EARLY_MONTH_RETENTION_RATIO=""
SUBGROUP_EARLY_FOLD_RETENTION_RATIO=""
ENABLE_EXACT_COMPLETION_SOLVER=""
EXACT_COMPLETION_MODE=""
EXACT_COMPLETION_MAX_CANDIDATES=""
EXACT_COMPLETION_MAX_ADDITIONAL_TOKENS=""
ENABLE_CROSSFIT_HARD_NEGATIVE_REFINEMENT=""
CROSSFIT_HOLDOUT_WINDOWS=""
CROSSFIT_MIN_WINDOW_SUPPORT=""
CROSSFIT_HARD_NEGATIVE_WEIGHT=""
ENABLE_JOINT_FEASIBILITY_SOLVER=""
JOINT_FEASIBILITY_MIN_CROSSFIT_POSITIVE_WINDOWS=""
JOINT_FEASIBILITY_MAX_CROSSFIT_NEGATIVE_WINDOWS=""
JOINT_FEASIBILITY_REQUIRE_HISTORICAL_SUPPORT=""
JOINT_FEASIBILITY_HISTORICAL_SUPPORT_CASE_IDS=""
ENABLE_INTERVAL_ATOMS=""
ENABLE_MACRO_ATOMS=""
ENABLE_SUPPORT_ANCHOR_ATOMS=""
ENABLE_SUPPORT_MANIFOLD_SIGNATURE=""
ENABLE_SUPPORT_METRIC_FEATURES=""
ENABLE_ADAPTIVE_THRESHOLD_ATOMS=""
ENABLE_DIVERSE_CATALOG_SELECTION=""
ENABLE_MDL_CATALOG_SELECTION=""
DIVERSE_CATALOG_TARGET_RULES=""
DIVERSE_NOVELTY_WEIGHT=""
DIVERSE_OVERLAP_PENALTY_WEIGHT=""
DIVERSE_ANCHOR_FAMILY_PENALTY_WEIGHT=""
TOP_FAMILY_MAX_QUOTA=""
MID_FAMILY_MIN_QUOTA=""
LOW_FAMILY_MIN_QUOTA=""
MDL_DESCRIPTION_LENGTH_WEIGHT=""
MDL_OVERLAP_PENALTY_WEIGHT=""
MAX_GAP_TRADING_DAYS="$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS"
MAX_RULE_SIZE="6"
MAX_SEED_TOKENS="4000"
MAX_RULES="4000"
MAX_SEARCH_STATES="20000000"
SEARCH_MODE="exact_indexed_kernel_v1"
HIT_COUNT_MODE=""
HIT_COUNT_DAY_SYMBOL_CAP=""
DISCOVERY_UNIVERSE_ID="$DEFAULT_DISCOVERY_UNIVERSE_ID"
RECENT_IMPULSE_LOOKBACK_DAYS="$DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS"
ENABLED_RECENT_IMPULSE_LANES=""
ALLOWED_STEPA_LANES=""
USES_STEPA_SEED_INPUT="0"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

run_open_pack_node() {
  NODE_OPTIONS="--max-old-space-size=$OPEN_PACK_NODE_HEAP_MB ${NODE_OPTIONS:-}" node "$@"
}

run_exact_index_node() {
  NODE_OPTIONS="--max-old-space-size=$EXACT_INDEX_NODE_HEAP_MB ${NODE_OPTIONS:-}" node "$@"
}

run_mine_node() {
  NODE_OPTIONS="--max-old-space-size=$MINE_NODE_HEAP_MB ${NODE_OPTIONS:-}" node "$@"
}

usage() {
  cat <<EOF
Usage: bash tools/server_run_stepb_dplus1_plus_lite.sh --split-policy=decision_date_only|strict_label_boundary [--config=/abs/path/config.json] [--run-id=<run_id>] [--train-start=YYYY-MM-DD] [--train-end=YYYY-MM-DD] [--oos-start=YYYY-MM-DD] [--oos-end=YYYY-MM-DD] [--selection-mode=union_all|champion_only|top2_per_day_union] [--close28-filter-pct=28] [--min-hit-count=6] [--enable-train-matched-date-prune=true|false] [--min-train-matched-dates=<n>] [--min-train-matched-months=<n>] [--min-train-matched-quarters=<n>] [--min-train-matched-folds=<n>] [--fold-scheme=chronological_<N>] [--max-top1-date-hit-share=<0..1>] [--max-top3-date-hit-share=<0..1>] [--max-top1-fold-hit-share=<0..1>] [--max-top3-fold-hit-share=<0..1>] [--max-rules-per-matched-date-signature=<n>] [--max-rules-per-matched-month-signature=<n>] [--max-rules-per-matched-quarter-signature=<n>] [--enable-diverse-search-ordering=true|false] [--enable-lane-stratified-mining=true|false] [--enable-family-scoped-mining=true|false] [--diverse-beam-max-per-month-signature=<n>] [--diverse-beam-max-per-quarter-signature=<n>] [--diverse-beam-max-per-anchor-family=<n>] [--family-seed-max-top-bucket=<n>] [--family-seed-max-mid-bucket=<n>] [--family-seed-max-low-bucket=<n>] [--mid-family-min-share=<0..1>] [--low-family-min-share=<0..1>] [--low-family-search-min-hit-count=<n>] [--low-family-min-train-matched-dates=<n>] [--low-family-min-train-matched-months=<n>] [--low-family-min-train-matched-folds=<n>] [--recent-only-family-ids=<csv>] [--support-cases-file=<support_cases.json>] [--support-feature-cases-file=<support_cases.json>] [--support-case-max-root-seeds=<n>] [--support-case-max-effective-root-seeds=<n>] [--support-case-min-root-overlap=<n>] [--support-case-min-prefix-overlap=<n>] [--support-case-prefix-depth-limit=<n>] [--support-case-min-donor-root-overlap=<n>] [--support-case-min-donor-prefix-overlap=<n>] [--support-case-donor-prefix-depth-limit=<n>] [--support-case-fail-if-root-scope-uncompressed=true|false] [--enable-subgroup-prepass=true|false] [--subgroup-min-matched-dates=<n>] [--subgroup-min-matched-months=<n>] [--subgroup-min-matched-folds=<n>] [--subgroup-max-root-seeds=<n>] [--enable-subgroup-stability=true|false] [--enable-subgroup-diversity=true|false] [--subgroup-max-manifests=<n>] [--subgroup-min-selection-frequency=<0..1>] [--subgroup-min-fold-presence-count=<n>] [--subgroup-min-window-presence-count=<n>] [--subgroup-max-token-jaccard=<0..1>] [--subgroup-max-axis-overlap=<n>] [--subgroup-max-date-cover-jaccard=<0..1>] [--subgroup-early-date-retention-ratio=<0..1>] [--subgroup-early-month-retention-ratio=<0..1>] [--subgroup-early-fold-retention-ratio=<0..1>] [--enable-exact-completion-solver=true|false] [--exact-completion-mode=counterexample_guided|counterexample_core_frontier|joint_feasibility] [--exact-completion-max-candidates=<n>] [--exact-completion-max-additional-tokens=<n>] [--enable-crossfit-hard-negative-refinement=true|false] [--crossfit-holdout-windows=<n>] [--crossfit-min-window-support=<n>] [--crossfit-hard-negative-weight=<n>] [--enable-joint-feasibility-solver=true|false] [--joint-feasibility-min-crossfit-positive-windows=<n>] [--joint-feasibility-max-crossfit-negative-windows=<n>] [--joint-feasibility-require-historical-support=true|false] [--joint-feasibility-historical-support-case-ids=<csv>] [--enable-interval-atoms=true|false] [--enable-macro-atoms=true|false] [--enable-support-anchor-atoms=true|false] [--enable-support-manifold-signature=true|false] [--enable-support-metric-features=true|false] [--enable-adaptive-threshold-atoms=true|false] [--enable-diverse-catalog-selection=true|false] [--enable-mdl-catalog-selection=true|false] [--diverse-catalog-target-rules=<n>] [--diverse-novelty-weight=<n>] [--diverse-overlap-penalty-weight=<n>] [--diverse-anchor-family-penalty-weight=<n>] [--top-family-max-quota=<n>] [--mid-family-min-quota=<n>] [--low-family-min-quota=<n>] [--mdl-description-length-weight=<n>] [--mdl-overlap-penalty-weight=<n>] [--hit-count-mode=raw_row_count|day_capped_symbol_count] [--hit-count-day-symbol-cap=2] [--max-gap=100000] [--max-rule-size=6] [--max-seed-tokens=4000] [--max-rules=4000] [--max-search-states=20000000] [--search-mode=exact_indexed_kernel_v1|legacy_exact_catalog_v6]
  [--discovery-universe-id=afree_open|recent_impulse_upto_1d|...|recent_impulse_upto_8d|same_day_plus_recent_upto_1d|...|same_day_plus_recent_upto_8d] [--recent-impulse-lookback-days=1..8]
Primary discovery path is stepb_dplus1_plus_lite with an explicit discoveryUniverseId: train pack -> exact index -> mining -> open train/OOS replay.
Note: stepb_dplus1_plus_lite is locked to the historical no-gap semantics and must use --max-gap=100000.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --config=*) CONFIG_PATH="${arg#*=}" ;;
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --split-policy=*) SPLIT_POLICY="${arg#*=}" ;;
    --train-start=*) TRAIN_START="${arg#*=}" ;;
    --train-end=*) TRAIN_END="${arg#*=}" ;;
    --oos-start=*) OOS_START="${arg#*=}" ;;
    --oos-end=*) OOS_END="${arg#*=}" ;;
    --selection-mode=*) SELECTION_MODE="${arg#*=}" ;;
    --close28-filter-pct=*) CLOSE28_FILTER_PCT="${arg#*=}" ;;
    --min-hit-count=*) MIN_HIT_COUNT="${arg#*=}" ;;
    --enable-train-matched-date-prune=*) ENABLE_TRAIN_MATCHED_DATE_PRUNE="${arg#*=}" ;;
    --min-train-matched-dates=*) MIN_TRAIN_MATCHED_DATES="${arg#*=}" ;;
    --min-train-matched-months=*) MIN_TRAIN_MATCHED_MONTHS="${arg#*=}" ;;
    --min-train-matched-quarters=*) MIN_TRAIN_MATCHED_QUARTERS="${arg#*=}" ;;
    --min-train-matched-folds=*) MIN_TRAIN_MATCHED_FOLDS="${arg#*=}" ;;
    --fold-scheme=*) FOLD_SCHEME="${arg#*=}" ;;
    --max-top1-date-hit-share=*) MAX_TOP1_DATE_HIT_SHARE="${arg#*=}" ;;
    --max-top3-date-hit-share=*) MAX_TOP3_DATE_HIT_SHARE="${arg#*=}" ;;
    --max-top1-fold-hit-share=*) MAX_TOP1_FOLD_HIT_SHARE="${arg#*=}" ;;
    --max-top3-fold-hit-share=*) MAX_TOP3_FOLD_HIT_SHARE="${arg#*=}" ;;
    --max-rules-per-matched-date-signature=*) MAX_RULES_PER_MATCHED_DATE_SIGNATURE="${arg#*=}" ;;
    --max-rules-per-matched-month-signature=*) MAX_RULES_PER_MATCHED_MONTH_SIGNATURE="${arg#*=}" ;;
    --max-rules-per-matched-quarter-signature=*) MAX_RULES_PER_MATCHED_QUARTER_SIGNATURE="${arg#*=}" ;;
    --enable-diverse-search-ordering=*) ENABLE_DIVERSE_SEARCH_ORDERING="${arg#*=}" ;;
    --enable-lane-stratified-mining=*) ENABLE_LANE_STRATIFIED_MINING="${arg#*=}" ;;
    --enable-family-scoped-mining=*) ENABLE_FAMILY_SCOPED_MINING="${arg#*=}" ;;
    --diverse-beam-max-per-month-signature=*) DIVERSE_BEAM_MAX_PER_MONTH_SIGNATURE="${arg#*=}" ;;
    --diverse-beam-max-per-quarter-signature=*) DIVERSE_BEAM_MAX_PER_QUARTER_SIGNATURE="${arg#*=}" ;;
    --diverse-beam-max-per-anchor-family=*) DIVERSE_BEAM_MAX_PER_ANCHOR_FAMILY="${arg#*=}" ;;
    --family-seed-max-top-bucket=*) FAMILY_SEED_MAX_TOP_BUCKET="${arg#*=}" ;;
    --family-seed-max-mid-bucket=*) FAMILY_SEED_MAX_MID_BUCKET="${arg#*=}" ;;
    --family-seed-max-low-bucket=*) FAMILY_SEED_MAX_LOW_BUCKET="${arg#*=}" ;;
    --mid-family-min-share=*) MID_FAMILY_MIN_SHARE="${arg#*=}" ;;
    --low-family-min-share=*) LOW_FAMILY_MIN_SHARE="${arg#*=}" ;;
    --low-family-search-min-hit-count=*) LOW_FAMILY_SEARCH_MIN_HIT_COUNT="${arg#*=}" ;;
    --low-family-min-train-matched-dates=*) LOW_FAMILY_MIN_TRAIN_MATCHED_DATES="${arg#*=}" ;;
    --low-family-min-train-matched-months=*) LOW_FAMILY_MIN_TRAIN_MATCHED_MONTHS="${arg#*=}" ;;
    --low-family-min-train-matched-folds=*) LOW_FAMILY_MIN_TRAIN_MATCHED_FOLDS="${arg#*=}" ;;
    --recent-only-family-ids=*) RECENT_ONLY_FAMILY_IDS="${arg#*=}" ;;
    --support-cases-file=*) SUPPORT_CASES_FILE="${arg#*=}" ;;
    --support-feature-cases-file=*) SUPPORT_FEATURE_CASES_FILE="${arg#*=}" ;;
    --support-case-max-root-seeds=*) SUPPORT_CASE_MAX_ROOT_SEEDS="${arg#*=}" ;;
    --support-case-max-effective-root-seeds=*) SUPPORT_CASE_MAX_EFFECTIVE_ROOT_SEEDS="${arg#*=}" ;;
    --support-case-min-root-overlap=*) SUPPORT_CASE_MIN_ROOT_OVERLAP="${arg#*=}" ;;
    --support-case-min-prefix-overlap=*) SUPPORT_CASE_MIN_PREFIX_OVERLAP="${arg#*=}" ;;
    --support-case-prefix-depth-limit=*) SUPPORT_CASE_PREFIX_DEPTH_LIMIT="${arg#*=}" ;;
    --support-case-min-donor-root-overlap=*) SUPPORT_CASE_MIN_DONOR_ROOT_OVERLAP="${arg#*=}" ;;
    --support-case-min-donor-prefix-overlap=*) SUPPORT_CASE_MIN_DONOR_PREFIX_OVERLAP="${arg#*=}" ;;
    --support-case-donor-prefix-depth-limit=*) SUPPORT_CASE_DONOR_PREFIX_DEPTH_LIMIT="${arg#*=}" ;;
    --support-case-fail-if-root-scope-uncompressed=*) SUPPORT_CASE_FAIL_IF_ROOT_SCOPE_UNCOMPRESSED="${arg#*=}" ;;
    --enable-subgroup-prepass=*) ENABLE_SUBGROUP_PREPASS="${arg#*=}" ;;
    --subgroup-min-matched-dates=*) SUBGROUP_MIN_MATCHED_DATES="${arg#*=}" ;;
    --subgroup-min-matched-months=*) SUBGROUP_MIN_MATCHED_MONTHS="${arg#*=}" ;;
    --subgroup-min-matched-folds=*) SUBGROUP_MIN_MATCHED_FOLDS="${arg#*=}" ;;
    --subgroup-max-root-seeds=*) SUBGROUP_MAX_ROOT_SEEDS="${arg#*=}" ;;
    --enable-subgroup-stability=*) ENABLE_SUBGROUP_STABILITY="${arg#*=}" ;;
    --enable-subgroup-diversity=*) ENABLE_SUBGROUP_DIVERSITY="${arg#*=}" ;;
    --subgroup-max-manifests=*) SUBGROUP_MAX_MANIFESTS="${arg#*=}" ;;
    --subgroup-min-selection-frequency=*) SUBGROUP_MIN_SELECTION_FREQUENCY="${arg#*=}" ;;
    --subgroup-min-fold-presence-count=*) SUBGROUP_MIN_FOLD_PRESENCE_COUNT="${arg#*=}" ;;
    --subgroup-min-window-presence-count=*) SUBGROUP_MIN_WINDOW_PRESENCE_COUNT="${arg#*=}" ;;
    --subgroup-max-token-jaccard=*) SUBGROUP_MAX_TOKEN_JACCARD="${arg#*=}" ;;
    --subgroup-max-axis-overlap=*) SUBGROUP_MAX_AXIS_OVERLAP="${arg#*=}" ;;
    --subgroup-max-date-cover-jaccard=*) SUBGROUP_MAX_DATE_COVER_JACCARD="${arg#*=}" ;;
    --subgroup-early-date-retention-ratio=*) SUBGROUP_EARLY_DATE_RETENTION_RATIO="${arg#*=}" ;;
    --subgroup-early-month-retention-ratio=*) SUBGROUP_EARLY_MONTH_RETENTION_RATIO="${arg#*=}" ;;
    --subgroup-early-fold-retention-ratio=*) SUBGROUP_EARLY_FOLD_RETENTION_RATIO="${arg#*=}" ;;
    --enable-exact-completion-solver=*) ENABLE_EXACT_COMPLETION_SOLVER="${arg#*=}" ;;
    --exact-completion-mode=*) EXACT_COMPLETION_MODE="${arg#*=}" ;;
    --exact-completion-max-candidates=*) EXACT_COMPLETION_MAX_CANDIDATES="${arg#*=}" ;;
    --exact-completion-max-additional-tokens=*) EXACT_COMPLETION_MAX_ADDITIONAL_TOKENS="${arg#*=}" ;;
    --enable-crossfit-hard-negative-refinement=*) ENABLE_CROSSFIT_HARD_NEGATIVE_REFINEMENT="${arg#*=}" ;;
    --crossfit-holdout-windows=*) CROSSFIT_HOLDOUT_WINDOWS="${arg#*=}" ;;
    --crossfit-min-window-support=*) CROSSFIT_MIN_WINDOW_SUPPORT="${arg#*=}" ;;
    --crossfit-hard-negative-weight=*) CROSSFIT_HARD_NEGATIVE_WEIGHT="${arg#*=}" ;;
    --enable-joint-feasibility-solver=*) ENABLE_JOINT_FEASIBILITY_SOLVER="${arg#*=}" ;;
    --joint-feasibility-min-crossfit-positive-windows=*) JOINT_FEASIBILITY_MIN_CROSSFIT_POSITIVE_WINDOWS="${arg#*=}" ;;
    --joint-feasibility-max-crossfit-negative-windows=*) JOINT_FEASIBILITY_MAX_CROSSFIT_NEGATIVE_WINDOWS="${arg#*=}" ;;
    --joint-feasibility-require-historical-support=*) JOINT_FEASIBILITY_REQUIRE_HISTORICAL_SUPPORT="${arg#*=}" ;;
    --joint-feasibility-historical-support-case-ids=*) JOINT_FEASIBILITY_HISTORICAL_SUPPORT_CASE_IDS="${arg#*=}" ;;
    --enable-interval-atoms=*) ENABLE_INTERVAL_ATOMS="${arg#*=}" ;;
    --enable-macro-atoms=*) ENABLE_MACRO_ATOMS="${arg#*=}" ;;
    --enable-support-anchor-atoms=*) ENABLE_SUPPORT_ANCHOR_ATOMS="${arg#*=}" ;;
    --enable-support-manifold-signature=*) ENABLE_SUPPORT_MANIFOLD_SIGNATURE="${arg#*=}" ;;
    --enable-support-metric-features=*) ENABLE_SUPPORT_METRIC_FEATURES="${arg#*=}" ;;
    --enable-adaptive-threshold-atoms=*) ENABLE_ADAPTIVE_THRESHOLD_ATOMS="${arg#*=}" ;;
    --enable-diverse-catalog-selection=*) ENABLE_DIVERSE_CATALOG_SELECTION="${arg#*=}" ;;
    --enable-mdl-catalog-selection=*) ENABLE_MDL_CATALOG_SELECTION="${arg#*=}" ;;
    --diverse-catalog-target-rules=*) DIVERSE_CATALOG_TARGET_RULES="${arg#*=}" ;;
    --diverse-novelty-weight=*) DIVERSE_NOVELTY_WEIGHT="${arg#*=}" ;;
    --diverse-overlap-penalty-weight=*) DIVERSE_OVERLAP_PENALTY_WEIGHT="${arg#*=}" ;;
    --diverse-anchor-family-penalty-weight=*) DIVERSE_ANCHOR_FAMILY_PENALTY_WEIGHT="${arg#*=}" ;;
    --top-family-max-quota=*) TOP_FAMILY_MAX_QUOTA="${arg#*=}" ;;
    --mid-family-min-quota=*) MID_FAMILY_MIN_QUOTA="${arg#*=}" ;;
    --low-family-min-quota=*) LOW_FAMILY_MIN_QUOTA="${arg#*=}" ;;
    --mdl-description-length-weight=*) MDL_DESCRIPTION_LENGTH_WEIGHT="${arg#*=}" ;;
    --mdl-overlap-penalty-weight=*) MDL_OVERLAP_PENALTY_WEIGHT="${arg#*=}" ;;
    --hit-count-mode=*) HIT_COUNT_MODE="${arg#*=}" ;;
    --hit-count-day-symbol-cap=*) HIT_COUNT_DAY_SYMBOL_CAP="${arg#*=}" ;;
    --max-gap=*) MAX_GAP_TRADING_DAYS="${arg#*=}" ;;
    --max-rule-size=*) MAX_RULE_SIZE="${arg#*=}" ;;
    --max-seed-tokens=*) MAX_SEED_TOKENS="${arg#*=}" ;;
    --max-rules=*) MAX_RULES="${arg#*=}" ;;
    --max-search-states=*) MAX_SEARCH_STATES="${arg#*=}" ;;
    --search-mode=*) SEARCH_MODE="${arg#*=}" ;;
    --discovery-universe-id=*) DISCOVERY_UNIVERSE_ID="${arg#*=}" ;;
    --recent-impulse-lookback-days=*) RECENT_IMPULSE_LOOKBACK_DAYS="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) fatal "unknown arg: $arg" ;;
  esac
done

ROOT_REAL="$(cd "$ROOT_DIR" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  fatal "server-only Step-B plus-lite wrapper must run from $EXPECTED_REAL, got $ROOT_REAL"
fi

if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
fi

[[ -f "$CONFIG_PATH" ]] || fatal "config not found: $CONFIG_PATH"

CONFIG_DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS="$(
  node --input-type=module - "$CONFIG_PATH" <<'NODE'
import { loadConfig } from "./src/lib/config.mjs"

const [configPath] = process.argv.slice(2)
const { config } = await loadConfig({
  configPath,
  cwd: process.cwd(),
})
const lookback = Number(config?.event?.recentImpulseDiscovery?.lookbackTradingDays)
if (!Number.isInteger(lookback) || lookback < 0) {
  throw new Error(
    `invalid Step-B recentImpulseDiscovery.lookbackTradingDays in config: ${configPath}`,
  )
}
console.log(String(lookback))
NODE
)"

case "$SPLIT_POLICY" in
  decision_date_only|strict_label_boundary) ;;
  "") fatal "missing --split-policy=decision_date_only|strict_label_boundary" ;;
  *) fatal "invalid --split-policy: $SPLIT_POLICY" ;;
esac

case "$SELECTION_MODE" in
  union_all|champion_only|top2_per_day_union) ;;
  *) fatal "invalid --selection-mode: $SELECTION_MODE" ;;
esac

if [[ -n "$HIT_COUNT_MODE" ]]; then
  case "$HIT_COUNT_MODE" in
    raw_row_count|day_capped_symbol_count) ;;
    *) fatal "invalid --hit-count-mode: $HIT_COUNT_MODE" ;;
  esac
fi

for value in "$TRAIN_START" "$TRAIN_END" "$OOS_START" "$OOS_END"; do
  [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fatal "invalid date: $value"
done

if [[ "$TRAIN_START" > "$TRAIN_END" ]]; then
  fatal "invalid train range: train-start ($TRAIN_START) must be <= train-end ($TRAIN_END)"
fi

if [[ "$OOS_START" > "$OOS_END" ]]; then
  fatal "invalid OOS range: oos-start ($OOS_START) must be <= oos-end ($OOS_END)"
fi

if [[ ! "$TRAIN_END" < "$OOS_START" ]]; then
  fatal "train/OOS ranges must not overlap: require train-end ($TRAIN_END) < oos-start ($OOS_START)"
fi

if [[ "$MAX_GAP_TRADING_DAYS" != "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" ]]; then
  fatal "$EXPECTED_BASELINE_LINE_ID is locked to historical no-gap semantics: require --max-gap=$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS, got $MAX_GAP_TRADING_DAYS"
fi

[[ -f "$LIB_PATH" ]] || fatal "shared Step-B baseline helper library not found: $LIB_PATH"
source "$LIB_PATH"

validate_recent_impulse_runtime_config "$CONFIG_PATH" "$CONFIG_DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS"
eval "$(
  node --input-type=module - "$DISCOVERY_UNIVERSE_ID" "$RECENT_IMPULSE_LOOKBACK_DAYS" "$DEFAULT_DISCOVERY_UNIVERSE_ID" "$CONFIG_DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS" <<'NODE'
import { resolvePerfectPrototypeDiscoveryUniverse } from "./src/lib/perfect_prototype_multiline_contract.mjs"

const [discoveryUniverseId, requestedLookbackTradingDaysRaw, defaultDiscoveryUniverseId, defaultLookbackRaw] =
  process.argv.slice(2)
const requestedLookbackTradingDays = Number(requestedLookbackTradingDaysRaw)
const defaultLookback = Number(defaultLookbackRaw)
const contract = resolvePerfectPrototypeDiscoveryUniverse({
  discoveryUniverseId,
  requestedLookbackTradingDays,
})
if (contract.discoveryUniverseId === defaultDiscoveryUniverseId && requestedLookbackTradingDays !== defaultLookback) {
  throw new Error(
    `afree_open discovery universe is pinned to recentImpulseLookbackTradingDays=${defaultLookback}; got ${requestedLookbackTradingDays}`,
  )
}
console.log(`ENABLED_RECENT_IMPULSE_LANES=${contract.enabledRecentImpulseLanes.join(",")}`)
console.log(`ALLOWED_STEPA_LANES=${contract.allowedStepALanes.join(",")}`)
console.log(`USES_STEPA_SEED_INPUT=${contract.usesStepASeedInput ? 1 : 0}`)
NODE
)"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
TRAIN_STEPA_RUN_ID="${RUN_ID}_train_stepa"
OOS_STEPA_RUN_ID="${RUN_ID}_oos_stepa"
TRAIN_INDEX_RUN_ID="${RUN_ID}_train_index"
TRAIN_MINE_RUN_ID="${RUN_ID}_train_mine"
TRAIN_CONFIG_PATH="$RUN_DIR/train_runtime_config.json"
OOS_CONFIG_PATH="$RUN_DIR/oos_runtime_config.json"
TRAIN_STEPA_DIR="$ROOT_DIR/artifacts/runs/$TRAIN_STEPA_RUN_ID/step-a"
OOS_STEPA_DIR="$ROOT_DIR/artifacts/runs/$OOS_STEPA_RUN_ID/step-a"
TRAIN_RULE_IDS_PATH="$RUN_DIR/train_rule_ids_all.txt"
FREEZE_RESULT_PATH="$RUN_DIR/freeze_result.json"
NO_RULES_SUMMARY_PATH="$RUN_DIR/no_rules_summary.json"
NO_SUBGROUP_SUMMARY_PATH="$RUN_DIR/no_subgroup_summary.json"
TRAIN_PACK_DIR="$RUN_DIR/step-perfect-prototype-open-train-pack"
OOS_PACK_DIR="$RUN_DIR/step-perfect-prototype-open-oos-pack"
TRAIN_MINE_DIR="$ROOT_DIR/artifacts/runs/$TRAIN_MINE_RUN_ID/step-perfect-prototype"
TRAIN_REPORT_DIR="$RUN_DIR/step-perfect-prototype-open-train-report"
TRAIN_APPLY_RAW_DIR="$RUN_DIR/step-perfect-prototype-open-train-apply-raw"
TRAIN_APPLY_CLOSE28_DIR="$RUN_DIR/step-perfect-prototype-open-train-apply-close28"
OOS_REPORT_DIR="$RUN_DIR/step-perfect-prototype-open-oos-report"
OOS_APPLY_RAW_DIR="$RUN_DIR/step-perfect-prototype-open-oos-apply-raw"
OOS_APPLY_CLOSE28_DIR="$RUN_DIR/step-perfect-prototype-open-oos-apply-close28"
LEADERBOARD_DIR="$RUN_DIR/step-perfect-prototype-open-eval-report"

mkdir -p "$RUN_DIR"

validate_baseline_contract_config "$CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"

write_period_config "$CONFIG_PATH" "$TRAIN_CONFIG_PATH" "$TRAIN_START" "$TRAIN_END" "$SPLIT_POLICY"
write_period_config "$CONFIG_PATH" "$OOS_CONFIG_PATH" "$OOS_START" "$OOS_END" "$SPLIT_POLICY"
rewrite_recent_impulse_runtime_config "$TRAIN_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"
rewrite_recent_impulse_runtime_config "$OOS_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"
validate_baseline_contract_config "$TRAIN_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
validate_baseline_contract_config "$OOS_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
validate_recent_impulse_runtime_config "$TRAIN_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"
validate_recent_impulse_runtime_config "$OOS_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"

CONFIG_SHA256="$(compute_sha256 "$CONFIG_PATH")"
TRAIN_CONFIG_SHA256="$(compute_sha256 "$TRAIN_CONFIG_PATH")"
OOS_CONFIG_SHA256="$(compute_sha256 "$OOS_CONFIG_PATH")"

TRAIN_PACK_ARGS=(
  --config="$TRAIN_CONFIG_PATH"
  --out-dir="$TRAIN_PACK_DIR"
  --start="$TRAIN_START"
  --end="$TRAIN_END"
  --surface-name="$EXPECTED_CONTEXT_SURFACE"
  --source-type=perfect_prototype_stepb_open_eval_pack
  --line-id="$EXPECTED_BASELINE_LINE_ID"
  --discovery-universe-id="$DISCOVERY_UNIVERSE_ID"
  --requested-lookback-trading-days="$RECENT_IMPULSE_LOOKBACK_DAYS"
)
OOS_PACK_ARGS=(
  --config="$OOS_CONFIG_PATH"
  --out-dir="$OOS_PACK_DIR"
  --start="$OOS_START"
  --end="$OOS_END"
  --surface-name="$EXPECTED_CONTEXT_SURFACE"
  --source-type=perfect_prototype_stepb_open_eval_pack
  --line-id="$EXPECTED_BASELINE_LINE_ID"
  --discovery-universe-id="$DISCOVERY_UNIVERSE_ID"
  --requested-lookback-trading-days="$RECENT_IMPULSE_LOOKBACK_DAYS"
)
if [[ "$USES_STEPA_SEED_INPUT" == "1" ]]; then
  node src/cli.mjs step-a --config="$TRAIN_CONFIG_PATH" --run-id="$TRAIN_STEPA_RUN_ID"
  node src/cli.mjs step-a --config="$OOS_CONFIG_PATH" --run-id="$OOS_STEPA_RUN_ID"
  link_stage "step-a-train" "$TRAIN_STEPA_DIR"
  link_stage "step-a-oos" "$OOS_STEPA_DIR"
  TRAIN_PACK_ARGS+=(
    --seed-input="$TRAIN_STEPA_DIR/events_high8_lite.jsonl"
    --enabled-recent-impulse-lanes="$ENABLED_RECENT_IMPULSE_LANES"
    --allowed-stepa-lanes="$ALLOWED_STEPA_LANES"
  )
  OOS_PACK_ARGS+=(
    --seed-input="$OOS_STEPA_DIR/events_high8_lite.jsonl"
    --enabled-recent-impulse-lanes="$ENABLED_RECENT_IMPULSE_LANES"
    --allowed-stepa-lanes="$ALLOWED_STEPA_LANES"
  )
fi

run_open_pack_node tools/build_perfect_prototype_daily_pack.mjs "${TRAIN_PACK_ARGS[@]}"
apply_strict_label_boundary_to_daily_pack "$TRAIN_PACK_DIR" "$TRAIN_START" "$TRAIN_END" "$SPLIT_POLICY"
link_stage "step-perfect-prototype-open-train-pack" "$TRAIN_PACK_DIR"

MINE_ARGS=(
  --out-run-id="$TRAIN_MINE_RUN_ID"
  --surface="$EXPECTED_CONTEXT_SURFACE"
  --search-mode="$SEARCH_MODE"
  --min-hit-count="$MIN_HIT_COUNT"
  --max-gap="$MAX_GAP_TRADING_DAYS"
  --max-rule-size="$MAX_RULE_SIZE"
  --max-seed-tokens="$MAX_SEED_TOKENS"
  --max-rules="$MAX_RULES"
  --max-search-states="$MAX_SEARCH_STATES"
)
if [[ -n "$MIN_TRAIN_MATCHED_DATES" ]]; then
  MINE_ARGS+=(--min-train-matched-dates="$MIN_TRAIN_MATCHED_DATES")
fi
if [[ -n "$MIN_TRAIN_MATCHED_MONTHS" ]]; then
  MINE_ARGS+=(--min-train-matched-months="$MIN_TRAIN_MATCHED_MONTHS")
fi
if [[ -n "$MIN_TRAIN_MATCHED_QUARTERS" ]]; then
  MINE_ARGS+=(--min-train-matched-quarters="$MIN_TRAIN_MATCHED_QUARTERS")
fi
if [[ -n "$MIN_TRAIN_MATCHED_FOLDS" ]]; then
  MINE_ARGS+=(--min-train-matched-folds="$MIN_TRAIN_MATCHED_FOLDS")
fi
if [[ -n "$FOLD_SCHEME" ]]; then
  MINE_ARGS+=(--fold-scheme="$FOLD_SCHEME")
fi
if [[ -n "$ENABLE_TRAIN_MATCHED_DATE_PRUNE" ]]; then
  MINE_ARGS+=(--enable-train-matched-date-prune="$ENABLE_TRAIN_MATCHED_DATE_PRUNE")
fi
if [[ -n "$MAX_TOP1_DATE_HIT_SHARE" ]]; then
  MINE_ARGS+=(--max-top1-date-hit-share="$MAX_TOP1_DATE_HIT_SHARE")
fi
if [[ -n "$MAX_TOP3_DATE_HIT_SHARE" ]]; then
  MINE_ARGS+=(--max-top3-date-hit-share="$MAX_TOP3_DATE_HIT_SHARE")
fi
if [[ -n "$MAX_TOP1_FOLD_HIT_SHARE" ]]; then
  MINE_ARGS+=(--max-top1-fold-hit-share="$MAX_TOP1_FOLD_HIT_SHARE")
fi
if [[ -n "$MAX_TOP3_FOLD_HIT_SHARE" ]]; then
  MINE_ARGS+=(--max-top3-fold-hit-share="$MAX_TOP3_FOLD_HIT_SHARE")
fi
if [[ -n "$MAX_RULES_PER_MATCHED_DATE_SIGNATURE" ]]; then
  MINE_ARGS+=(--max-rules-per-matched-date-signature="$MAX_RULES_PER_MATCHED_DATE_SIGNATURE")
fi
if [[ -n "$MAX_RULES_PER_MATCHED_MONTH_SIGNATURE" ]]; then
  MINE_ARGS+=(--max-rules-per-matched-month-signature="$MAX_RULES_PER_MATCHED_MONTH_SIGNATURE")
fi
if [[ -n "$MAX_RULES_PER_MATCHED_QUARTER_SIGNATURE" ]]; then
  MINE_ARGS+=(--max-rules-per-matched-quarter-signature="$MAX_RULES_PER_MATCHED_QUARTER_SIGNATURE")
fi
if [[ -n "$ENABLE_DIVERSE_SEARCH_ORDERING" ]]; then
  MINE_ARGS+=(--enable-diverse-search-ordering="$ENABLE_DIVERSE_SEARCH_ORDERING")
fi
if [[ -n "$ENABLE_LANE_STRATIFIED_MINING" ]]; then
  MINE_ARGS+=(--enable-lane-stratified-mining="$ENABLE_LANE_STRATIFIED_MINING")
fi
if [[ -n "$ENABLE_FAMILY_SCOPED_MINING" ]]; then
  MINE_ARGS+=(--enable-family-scoped-mining="$ENABLE_FAMILY_SCOPED_MINING")
fi
if [[ -n "$DIVERSE_BEAM_MAX_PER_MONTH_SIGNATURE" ]]; then
  MINE_ARGS+=(--diverse-beam-max-per-month-signature="$DIVERSE_BEAM_MAX_PER_MONTH_SIGNATURE")
fi
if [[ -n "$DIVERSE_BEAM_MAX_PER_QUARTER_SIGNATURE" ]]; then
  MINE_ARGS+=(--diverse-beam-max-per-quarter-signature="$DIVERSE_BEAM_MAX_PER_QUARTER_SIGNATURE")
fi
if [[ -n "$DIVERSE_BEAM_MAX_PER_ANCHOR_FAMILY" ]]; then
  MINE_ARGS+=(--diverse-beam-max-per-anchor-family="$DIVERSE_BEAM_MAX_PER_ANCHOR_FAMILY")
fi
if [[ -n "$FAMILY_SEED_MAX_TOP_BUCKET" ]]; then
  MINE_ARGS+=(--family-seed-max-top-bucket="$FAMILY_SEED_MAX_TOP_BUCKET")
fi
if [[ -n "$FAMILY_SEED_MAX_MID_BUCKET" ]]; then
  MINE_ARGS+=(--family-seed-max-mid-bucket="$FAMILY_SEED_MAX_MID_BUCKET")
fi
if [[ -n "$FAMILY_SEED_MAX_LOW_BUCKET" ]]; then
  MINE_ARGS+=(--family-seed-max-low-bucket="$FAMILY_SEED_MAX_LOW_BUCKET")
fi
if [[ -n "$MID_FAMILY_MIN_SHARE" ]]; then
  MINE_ARGS+=(--mid-family-min-share="$MID_FAMILY_MIN_SHARE")
fi
if [[ -n "$LOW_FAMILY_MIN_SHARE" ]]; then
  MINE_ARGS+=(--low-family-min-share="$LOW_FAMILY_MIN_SHARE")
fi
if [[ -n "$LOW_FAMILY_SEARCH_MIN_HIT_COUNT" ]]; then
  MINE_ARGS+=(--low-family-search-min-hit-count="$LOW_FAMILY_SEARCH_MIN_HIT_COUNT")
fi
if [[ -n "$LOW_FAMILY_MIN_TRAIN_MATCHED_DATES" ]]; then
  MINE_ARGS+=(--low-family-min-train-matched-dates="$LOW_FAMILY_MIN_TRAIN_MATCHED_DATES")
fi
if [[ -n "$LOW_FAMILY_MIN_TRAIN_MATCHED_MONTHS" ]]; then
  MINE_ARGS+=(--low-family-min-train-matched-months="$LOW_FAMILY_MIN_TRAIN_MATCHED_MONTHS")
fi
if [[ -n "$LOW_FAMILY_MIN_TRAIN_MATCHED_FOLDS" ]]; then
  MINE_ARGS+=(--low-family-min-train-matched-folds="$LOW_FAMILY_MIN_TRAIN_MATCHED_FOLDS")
fi
if [[ -n "$RECENT_ONLY_FAMILY_IDS" ]]; then
  MINE_ARGS+=(--recent-only-family-ids="$RECENT_ONLY_FAMILY_IDS")
fi
if [[ -n "$SUPPORT_CASES_FILE" ]]; then
  MINE_ARGS+=(--support-cases-file="$SUPPORT_CASES_FILE")
fi
if [[ -n "$SUPPORT_FEATURE_CASES_FILE" ]]; then
  MINE_ARGS+=(--support-feature-cases-file="$SUPPORT_FEATURE_CASES_FILE")
fi
if [[ -n "$SUPPORT_CASE_MAX_ROOT_SEEDS" ]]; then
  MINE_ARGS+=(--support-case-max-root-seeds="$SUPPORT_CASE_MAX_ROOT_SEEDS")
fi
if [[ -n "$SUPPORT_CASE_MAX_EFFECTIVE_ROOT_SEEDS" ]]; then
  MINE_ARGS+=(--support-case-max-effective-root-seeds="$SUPPORT_CASE_MAX_EFFECTIVE_ROOT_SEEDS")
fi
if [[ -n "$SUPPORT_CASE_MIN_ROOT_OVERLAP" ]]; then
  MINE_ARGS+=(--support-case-min-root-overlap="$SUPPORT_CASE_MIN_ROOT_OVERLAP")
fi
if [[ -n "$SUPPORT_CASE_MIN_PREFIX_OVERLAP" ]]; then
  MINE_ARGS+=(--support-case-min-prefix-overlap="$SUPPORT_CASE_MIN_PREFIX_OVERLAP")
fi
if [[ -n "$SUPPORT_CASE_PREFIX_DEPTH_LIMIT" ]]; then
  MINE_ARGS+=(--support-case-prefix-depth-limit="$SUPPORT_CASE_PREFIX_DEPTH_LIMIT")
fi
if [[ -n "$SUPPORT_CASE_MIN_DONOR_ROOT_OVERLAP" ]]; then
  MINE_ARGS+=(--support-case-min-donor-root-overlap="$SUPPORT_CASE_MIN_DONOR_ROOT_OVERLAP")
fi
if [[ -n "$SUPPORT_CASE_MIN_DONOR_PREFIX_OVERLAP" ]]; then
  MINE_ARGS+=(--support-case-min-donor-prefix-overlap="$SUPPORT_CASE_MIN_DONOR_PREFIX_OVERLAP")
fi
if [[ -n "$SUPPORT_CASE_DONOR_PREFIX_DEPTH_LIMIT" ]]; then
  MINE_ARGS+=(--support-case-donor-prefix-depth-limit="$SUPPORT_CASE_DONOR_PREFIX_DEPTH_LIMIT")
fi
if [[ -n "$SUPPORT_CASE_FAIL_IF_ROOT_SCOPE_UNCOMPRESSED" ]]; then
  MINE_ARGS+=(--support-case-fail-if-root-scope-uncompressed="$SUPPORT_CASE_FAIL_IF_ROOT_SCOPE_UNCOMPRESSED")
fi
if [[ -n "$ENABLE_SUBGROUP_PREPASS" ]]; then
  MINE_ARGS+=(--enable-subgroup-prepass="$ENABLE_SUBGROUP_PREPASS")
fi
if [[ -n "$SUBGROUP_MIN_MATCHED_DATES" ]]; then
  MINE_ARGS+=(--subgroup-min-matched-dates="$SUBGROUP_MIN_MATCHED_DATES")
fi
if [[ -n "$SUBGROUP_MIN_MATCHED_MONTHS" ]]; then
  MINE_ARGS+=(--subgroup-min-matched-months="$SUBGROUP_MIN_MATCHED_MONTHS")
fi
if [[ -n "$SUBGROUP_MIN_MATCHED_FOLDS" ]]; then
  MINE_ARGS+=(--subgroup-min-matched-folds="$SUBGROUP_MIN_MATCHED_FOLDS")
fi
if [[ -n "$SUBGROUP_MAX_ROOT_SEEDS" ]]; then
  MINE_ARGS+=(--subgroup-max-root-seeds="$SUBGROUP_MAX_ROOT_SEEDS")
fi
if [[ -n "$ENABLE_SUBGROUP_STABILITY" ]]; then
  MINE_ARGS+=(--enable-subgroup-stability="$ENABLE_SUBGROUP_STABILITY")
fi
if [[ -n "$ENABLE_SUBGROUP_DIVERSITY" ]]; then
  MINE_ARGS+=(--enable-subgroup-diversity="$ENABLE_SUBGROUP_DIVERSITY")
fi
if [[ -n "$SUBGROUP_MAX_MANIFESTS" ]]; then
  MINE_ARGS+=(--subgroup-max-manifests="$SUBGROUP_MAX_MANIFESTS")
fi
if [[ -n "$SUBGROUP_MIN_SELECTION_FREQUENCY" ]]; then
  MINE_ARGS+=(--subgroup-min-selection-frequency="$SUBGROUP_MIN_SELECTION_FREQUENCY")
fi
if [[ -n "$SUBGROUP_MIN_FOLD_PRESENCE_COUNT" ]]; then
  MINE_ARGS+=(--subgroup-min-fold-presence-count="$SUBGROUP_MIN_FOLD_PRESENCE_COUNT")
fi
if [[ -n "$SUBGROUP_MIN_WINDOW_PRESENCE_COUNT" ]]; then
  MINE_ARGS+=(--subgroup-min-window-presence-count="$SUBGROUP_MIN_WINDOW_PRESENCE_COUNT")
fi
if [[ -n "$SUBGROUP_MAX_TOKEN_JACCARD" ]]; then
  MINE_ARGS+=(--subgroup-max-token-jaccard="$SUBGROUP_MAX_TOKEN_JACCARD")
fi
if [[ -n "$SUBGROUP_MAX_AXIS_OVERLAP" ]]; then
  MINE_ARGS+=(--subgroup-max-axis-overlap="$SUBGROUP_MAX_AXIS_OVERLAP")
fi
if [[ -n "$SUBGROUP_MAX_DATE_COVER_JACCARD" ]]; then
  MINE_ARGS+=(--subgroup-max-date-cover-jaccard="$SUBGROUP_MAX_DATE_COVER_JACCARD")
fi
if [[ -n "$SUBGROUP_EARLY_DATE_RETENTION_RATIO" ]]; then
  MINE_ARGS+=(--subgroup-early-date-retention-ratio="$SUBGROUP_EARLY_DATE_RETENTION_RATIO")
fi
if [[ -n "$SUBGROUP_EARLY_MONTH_RETENTION_RATIO" ]]; then
  MINE_ARGS+=(--subgroup-early-month-retention-ratio="$SUBGROUP_EARLY_MONTH_RETENTION_RATIO")
fi
if [[ -n "$SUBGROUP_EARLY_FOLD_RETENTION_RATIO" ]]; then
  MINE_ARGS+=(--subgroup-early-fold-retention-ratio="$SUBGROUP_EARLY_FOLD_RETENTION_RATIO")
fi
if [[ -n "$ENABLE_EXACT_COMPLETION_SOLVER" ]]; then
  MINE_ARGS+=(--enable-exact-completion-solver="$ENABLE_EXACT_COMPLETION_SOLVER")
fi
if [[ -n "$EXACT_COMPLETION_MODE" ]]; then
  MINE_ARGS+=(--exact-completion-mode="$EXACT_COMPLETION_MODE")
fi
if [[ -n "$EXACT_COMPLETION_MAX_CANDIDATES" ]]; then
  MINE_ARGS+=(--exact-completion-max-candidates="$EXACT_COMPLETION_MAX_CANDIDATES")
fi
if [[ -n "$EXACT_COMPLETION_MAX_ADDITIONAL_TOKENS" ]]; then
  MINE_ARGS+=(--exact-completion-max-additional-tokens="$EXACT_COMPLETION_MAX_ADDITIONAL_TOKENS")
fi
if [[ -n "$ENABLE_CROSSFIT_HARD_NEGATIVE_REFINEMENT" ]]; then
  MINE_ARGS+=(--enable-crossfit-hard-negative-refinement="$ENABLE_CROSSFIT_HARD_NEGATIVE_REFINEMENT")
fi
if [[ -n "$CROSSFIT_HOLDOUT_WINDOWS" ]]; then
  MINE_ARGS+=(--crossfit-holdout-windows="$CROSSFIT_HOLDOUT_WINDOWS")
fi
if [[ -n "$CROSSFIT_MIN_WINDOW_SUPPORT" ]]; then
  MINE_ARGS+=(--crossfit-min-window-support="$CROSSFIT_MIN_WINDOW_SUPPORT")
fi
if [[ -n "$CROSSFIT_HARD_NEGATIVE_WEIGHT" ]]; then
  MINE_ARGS+=(--crossfit-hard-negative-weight="$CROSSFIT_HARD_NEGATIVE_WEIGHT")
fi
if [[ -n "$ENABLE_JOINT_FEASIBILITY_SOLVER" ]]; then
  MINE_ARGS+=(--enable-joint-feasibility-solver="$ENABLE_JOINT_FEASIBILITY_SOLVER")
fi
if [[ -n "$JOINT_FEASIBILITY_MIN_CROSSFIT_POSITIVE_WINDOWS" ]]; then
  MINE_ARGS+=(--joint-feasibility-min-crossfit-positive-windows="$JOINT_FEASIBILITY_MIN_CROSSFIT_POSITIVE_WINDOWS")
fi
if [[ -n "$JOINT_FEASIBILITY_MAX_CROSSFIT_NEGATIVE_WINDOWS" ]]; then
  MINE_ARGS+=(--joint-feasibility-max-crossfit-negative-windows="$JOINT_FEASIBILITY_MAX_CROSSFIT_NEGATIVE_WINDOWS")
fi
if [[ -n "$JOINT_FEASIBILITY_REQUIRE_HISTORICAL_SUPPORT" ]]; then
  MINE_ARGS+=(--joint-feasibility-require-historical-support="$JOINT_FEASIBILITY_REQUIRE_HISTORICAL_SUPPORT")
fi
if [[ -n "$JOINT_FEASIBILITY_HISTORICAL_SUPPORT_CASE_IDS" ]]; then
  MINE_ARGS+=(--joint-feasibility-historical-support-case-ids="$JOINT_FEASIBILITY_HISTORICAL_SUPPORT_CASE_IDS")
fi
if [[ -n "$ENABLE_INTERVAL_ATOMS" ]]; then
  MINE_ARGS+=(--enable-interval-atoms="$ENABLE_INTERVAL_ATOMS")
fi
if [[ -n "$ENABLE_MACRO_ATOMS" ]]; then
  MINE_ARGS+=(--enable-macro-atoms="$ENABLE_MACRO_ATOMS")
fi
if [[ -n "$ENABLE_SUPPORT_ANCHOR_ATOMS" ]]; then
  MINE_ARGS+=(--enable-support-anchor-atoms="$ENABLE_SUPPORT_ANCHOR_ATOMS")
fi
if [[ -n "$ENABLE_SUPPORT_MANIFOLD_SIGNATURE" ]]; then
  MINE_ARGS+=(--enable-support-manifold-signature="$ENABLE_SUPPORT_MANIFOLD_SIGNATURE")
fi
if [[ -n "$ENABLE_SUPPORT_METRIC_FEATURES" ]]; then
  MINE_ARGS+=(--enable-support-metric-features="$ENABLE_SUPPORT_METRIC_FEATURES")
fi
if [[ -n "$ENABLE_ADAPTIVE_THRESHOLD_ATOMS" ]]; then
  MINE_ARGS+=(--enable-adaptive-threshold-atoms="$ENABLE_ADAPTIVE_THRESHOLD_ATOMS")
fi
if [[ -n "$ENABLE_DIVERSE_CATALOG_SELECTION" ]]; then
  MINE_ARGS+=(--enable-diverse-catalog-selection="$ENABLE_DIVERSE_CATALOG_SELECTION")
fi
if [[ -n "$ENABLE_MDL_CATALOG_SELECTION" ]]; then
  MINE_ARGS+=(--enable-mdl-catalog-selection="$ENABLE_MDL_CATALOG_SELECTION")
fi
if [[ -n "$DIVERSE_CATALOG_TARGET_RULES" ]]; then
  MINE_ARGS+=(--diverse-catalog-target-rules="$DIVERSE_CATALOG_TARGET_RULES")
fi
if [[ -n "$DIVERSE_NOVELTY_WEIGHT" ]]; then
  MINE_ARGS+=(--diverse-novelty-weight="$DIVERSE_NOVELTY_WEIGHT")
fi
if [[ -n "$DIVERSE_OVERLAP_PENALTY_WEIGHT" ]]; then
  MINE_ARGS+=(--diverse-overlap-penalty-weight="$DIVERSE_OVERLAP_PENALTY_WEIGHT")
fi
if [[ -n "$DIVERSE_ANCHOR_FAMILY_PENALTY_WEIGHT" ]]; then
  MINE_ARGS+=(--diverse-anchor-family-penalty-weight="$DIVERSE_ANCHOR_FAMILY_PENALTY_WEIGHT")
fi
if [[ -n "$TOP_FAMILY_MAX_QUOTA" ]]; then
  MINE_ARGS+=(--top-family-max-quota="$TOP_FAMILY_MAX_QUOTA")
fi
if [[ -n "$MID_FAMILY_MIN_QUOTA" ]]; then
  MINE_ARGS+=(--mid-family-min-quota="$MID_FAMILY_MIN_QUOTA")
fi
if [[ -n "$LOW_FAMILY_MIN_QUOTA" ]]; then
  MINE_ARGS+=(--low-family-min-quota="$LOW_FAMILY_MIN_QUOTA")
fi
if [[ -n "$MDL_DESCRIPTION_LENGTH_WEIGHT" ]]; then
  MINE_ARGS+=(--mdl-description-length-weight="$MDL_DESCRIPTION_LENGTH_WEIGHT")
fi
if [[ -n "$MDL_OVERLAP_PENALTY_WEIGHT" ]]; then
  MINE_ARGS+=(--mdl-overlap-penalty-weight="$MDL_OVERLAP_PENALTY_WEIGHT")
fi
if [[ -n "$HIT_COUNT_MODE" ]]; then
  MINE_ARGS+=(--hit-count-mode="$HIT_COUNT_MODE")
fi
if [[ -n "$HIT_COUNT_DAY_SYMBOL_CAP" ]]; then
  MINE_ARGS+=(--hit-count-day-symbol-cap="$HIT_COUNT_DAY_SYMBOL_CAP")
fi

if [[ "$SEARCH_MODE" == "exact_indexed_kernel_v1" ]]; then
  TRAIN_INDEX_DIR="$ROOT_DIR/artifacts/runs/$TRAIN_INDEX_RUN_ID/step-perfect-prototype-index"
  INDEX_ARGS=(
    --input="$TRAIN_PACK_DIR/daily_pack.jsonl"
    --out-run-id="$TRAIN_INDEX_RUN_ID"
    --surface="$EXPECTED_CONTEXT_SURFACE"
    --train-start="$TRAIN_START"
    --train-end="$TRAIN_END"
    --min-hit-count="$MIN_HIT_COUNT"
    --max-gap="$MAX_GAP_TRADING_DAYS"
    --max-rule-size="$MAX_RULE_SIZE"
    --max-seed-tokens="$MAX_SEED_TOKENS"
    --max-rules="$MAX_RULES"
    --max-search-states="$MAX_SEARCH_STATES"
  )
  if [[ -n "$ENABLE_INTERVAL_ATOMS" ]]; then
    INDEX_ARGS+=(--enable-interval-atoms="$ENABLE_INTERVAL_ATOMS")
  fi
  if [[ -n "$ENABLE_MACRO_ATOMS" ]]; then
    INDEX_ARGS+=(--enable-macro-atoms="$ENABLE_MACRO_ATOMS")
  fi
  if [[ -n "$ENABLE_SUPPORT_ANCHOR_ATOMS" ]]; then
    INDEX_ARGS+=(--enable-support-anchor-atoms="$ENABLE_SUPPORT_ANCHOR_ATOMS")
  fi
  if [[ -n "$ENABLE_SUPPORT_MANIFOLD_SIGNATURE" ]]; then
    INDEX_ARGS+=(--enable-support-manifold-signature="$ENABLE_SUPPORT_MANIFOLD_SIGNATURE")
  fi
  if [[ -n "$ENABLE_SUPPORT_METRIC_FEATURES" ]]; then
    INDEX_ARGS+=(--enable-support-metric-features="$ENABLE_SUPPORT_METRIC_FEATURES")
  fi
  if [[ -n "$ENABLE_ADAPTIVE_THRESHOLD_ATOMS" ]]; then
    INDEX_ARGS+=(--enable-adaptive-threshold-atoms="$ENABLE_ADAPTIVE_THRESHOLD_ATOMS")
  fi
  run_exact_index_node tools/build_stepb_exact_index.mjs \
    "${INDEX_ARGS[@]}"
  link_stage "step-perfect-prototype-index-train" "$TRAIN_INDEX_DIR"
  INDEXED_MINE_ARGS=()
  for arg in "${MINE_ARGS[@]}"; do
    if [[ "$arg" == --out-run-id=* ]]; then
      continue
    fi
    INDEXED_MINE_ARGS+=("$arg")
  done
  INDEXED_MINE_ARGS+=(--out-dir="$TRAIN_MINE_DIR")
  run_mine_node tools/mine_perfect_prototypes_indexed.mjs \
    --index-dir="$TRAIN_INDEX_DIR" \
    "${INDEXED_MINE_ARGS[@]}"
else
  run_mine_node tools/mine_perfect_prototypes.mjs \
    --input="$TRAIN_PACK_DIR/daily_pack.jsonl" \
    "${MINE_ARGS[@]}"
fi
link_stage "step-perfect-prototype-train" "$TRAIN_MINE_DIR"

node --input-type=module - "$ROOT_DIR/artifacts/runs/$TRAIN_MINE_RUN_ID/step-perfect-prototype/catalog.json" "$TRAIN_RULE_IDS_PATH" <<'NODE'
import fs from "node:fs/promises"

const [catalogPath, outPath] = process.argv.slice(2)
const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"))
const ruleIds = Array.from(
  new Set(
    (Array.isArray(catalog?.rules) ? catalog.rules : [])
      .map((rule) => String(rule?.ruleId ?? "").trim())
      .filter(Boolean),
  ),
).sort((left, right) => left.localeCompare(right))
await fs.writeFile(outPath, `${ruleIds.join("\n")}\n`, "utf8")
NODE

TRAIN_RULE_COUNT="$(awk 'NF { count += 1 } END { print count + 0 }' "$TRAIN_RULE_IDS_PATH")"
if [[ "$TRAIN_RULE_COUNT" -lt 1 ]]; then
  node --input-type=module - \
    "$ROOT_DIR/artifacts/runs/$TRAIN_MINE_RUN_ID/step-perfect-prototype/catalog.json" \
    "$NO_RULES_SUMMARY_PATH" \
    "$NO_SUBGROUP_SUMMARY_PATH" \
    "$FREEZE_RESULT_PATH" <<'NODE'
import fs from "node:fs/promises"

const [catalogPath, summaryPath, noSubgroupSummaryPath, freezeResultPath] = process.argv.slice(2)
const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"))
const subgroupPrepassEnabled = catalog?.metadata?.enableSubgroupPrepass === true
const subgroupBundleManifestCount = Number(catalog?.metadata?.subgroupBundleManifestCount ?? 0) || 0
const subgroupExactEntryAcceptedCount =
  Number(catalog?.metadata?.subgroupExactEntryAcceptedCount ?? 0) || 0
const subgroupExactEntryRejectedCount =
  Number(catalog?.metadata?.subgroupExactEntryRejectedCount ?? 0) || 0
const exactCompletionManifestCount =
  Number(catalog?.metadata?.exactCompletionManifestCount ?? 0) || 0
const exactCompletionSolvedCount =
  Number(catalog?.metadata?.exactCompletionSolvedCount ?? 0) || 0
const exactCompletionUnsatCount =
  Number(catalog?.metadata?.exactCompletionUnsatCount ?? 0) || 0
const exactCompletionCollectedRuleCount =
  Number(catalog?.metadata?.exactCompletionCollectedRuleCount ?? 0) || 0
const exactCoreCandidateCount =
  Number(catalog?.metadata?.exactCoreCandidateCount ?? 0) || 0
const exactCoreQualifiedCount =
  Number(catalog?.metadata?.exactCoreQualifiedCount ?? 0) || 0
const exactCoreSolvedCount =
  Number(catalog?.metadata?.exactCoreSolvedCount ?? 0) || 0
const exactCoreUnsatCount =
  Number(catalog?.metadata?.exactCoreUnsatCount ?? 0) || 0
const useNoSubgroupSummary = subgroupPrepassEnabled && subgroupBundleManifestCount < 1
const subgroupStageReasonByFamily =
  catalog?.metadata?.subgroupStageReasonByFamily &&
  typeof catalog.metadata.subgroupStageReasonByFamily === "object"
    ? catalog.metadata.subgroupStageReasonByFamily
    : {}
const subgroupStageReason =
  Object.values(subgroupStageReasonByFamily).find((value) => String(value ?? "").trim()) ??
  null
const summary = {
  status: useNoSubgroupSummary ? "no_subgroups" : "no_rules",
  reason: useNoSubgroupSummary
    ? String(subgroupStageReason ?? "train_mine_produced_zero_subgroup_manifests")
    : subgroupPrepassEnabled && subgroupExactEntryAcceptedCount < 1
      ? "no_exact_entry"
      : exactCompletionManifestCount > 0 && exactCoreQualifiedCount < 1
        ? "no_exactable_cores"
        : exactCoreQualifiedCount > 0 && exactCoreSolvedCount < 1
          ? "no_core_frontier_solutions"
        : exactCompletionManifestCount > 0 && exactCompletionSolvedCount < 1
          ? "no_exact_completion_solutions"
        : exactCompletionSolvedCount > 0 && exactCompletionCollectedRuleCount < 1
            ? "no_exact_completion_train_rules"
        : subgroupPrepassEnabled
          ? "no_exact_refinements"
          : "train_mine_produced_zero_rules",
  catalogPath,
  ruleCount: Array.isArray(catalog?.rules) ? catalog.rules.length : 0,
  exploredStates: Number(catalog?.metadata?.exploredStates ?? 0) || 0,
  subgroupCandidateCount: Number(catalog?.metadata?.subgroupCandidateCount ?? 0) || 0,
  subgroupQualifiedCandidateCount: Number(catalog?.metadata?.subgroupQualifiedCandidateCount ?? 0) || 0,
  subgroupEffectiveRootSeedCount: Number(catalog?.metadata?.subgroupEffectiveRootSeedCount ?? 0) || 0,
  subgroupManifestCandidateCount: Number(catalog?.metadata?.subgroupManifestCandidateCount ?? 0) || 0,
  subgroupStableManifestCount: Number(catalog?.metadata?.subgroupStableManifestCount ?? 0) || 0,
  subgroupDiverseManifestCount: Number(catalog?.metadata?.subgroupDiverseManifestCount ?? 0) || 0,
  subgroupBundleManifestCount,
  subgroupExactEntryAcceptedCount,
  subgroupExactEntryRejectedCount,
  subgroupExactEntryRejectReasonCounts:
    catalog?.metadata?.subgroupExactEntryRejectReasonCounts &&
    typeof catalog.metadata.subgroupExactEntryRejectReasonCounts === "object"
      ? catalog.metadata.subgroupExactEntryRejectReasonCounts
      : {},
  exactCompletionManifestCount,
  exactCompletionSolvedCount,
  exactCompletionUnsatCount,
  exactCompletionCollectedRuleCount,
  exactCoreCandidateCount,
  exactCoreQualifiedCount,
  exactCoreSolvedCount,
  exactCoreUnsatCount,
  exactCompletionUnsatReasonCounts:
    catalog?.metadata?.exactCompletionUnsatReasonCounts &&
    typeof catalog.metadata.exactCompletionUnsatReasonCounts === "object"
      ? catalog.metadata.exactCompletionUnsatReasonCounts
      : {},
  exactCoreUnsatReasonCounts:
    catalog?.metadata?.exactCoreUnsatReasonCounts &&
    typeof catalog.metadata.exactCoreUnsatReasonCounts === "object"
      ? catalog.metadata.exactCoreUnsatReasonCounts
      : {},
  exactCoreFrontierBestRetainedDateCount:
    Number(catalog?.metadata?.exactCoreFrontierBestRetainedDateCount ?? 0) || 0,
  exactCoreFrontierBestRetainedMonthCount:
    Number(catalog?.metadata?.exactCoreFrontierBestRetainedMonthCount ?? 0) || 0,
  exactCoreFrontierBestRetainedFoldCount:
    Number(catalog?.metadata?.exactCoreFrontierBestRetainedFoldCount ?? 0) || 0,
  subgroupStageReasonByFamily,
  subgroupPrefixPruneCount: Number(catalog?.metadata?.subgroupPrefixPruneCount ?? 0) || 0,
  subgroupBreadthFloorPruneCount: Number(catalog?.metadata?.subgroupBreadthFloorPruneCount ?? 0) || 0,
  searchBelowMinHitCount:
    Number(catalog?.metadata?.rejectionSummary?.searchBelowMinHitCount ?? 0) || 0,
}
await fs.writeFile(
  useNoSubgroupSummary ? noSubgroupSummaryPath : summaryPath,
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
)
await fs.writeFile(
  freezeResultPath,
  `${JSON.stringify(
    {
      status: summary.status,
      reason: summary.reason,
      summaryPath: useNoSubgroupSummary ? noSubgroupSummaryPath : summaryPath,
    },
    null,
    2,
  )}\n`,
  "utf8",
)
NODE
  if [[ -f "$NO_SUBGROUP_SUMMARY_PATH" ]]; then
    echo "[fatal] train mining produced zero subgroup manifests; curated freeze skipped. see $NO_SUBGROUP_SUMMARY_PATH" >&2
  else
    echo "[fatal] train mining produced zero rules; curated freeze skipped. see $NO_RULES_SUMMARY_PATH" >&2
  fi
  exit 42
fi

node tools/build_curated_perfect_prototype_catalog.mjs \
  --source-catalog="$ROOT_DIR/artifacts/runs/$TRAIN_MINE_RUN_ID/step-perfect-prototype/catalog.json" \
  --rule-ids-file="$TRAIN_RULE_IDS_PATH" \
  --label="${EXPECTED_BASELINE_LINE_ID}_${DISCOVERY_UNIVERSE_ID}_all_rules" \
  --note="line=$EXPECTED_BASELINE_LINE_ID discoveryUniverse=$DISCOVERY_UNIVERSE_ID requestedLookbackTradingDays=$RECENT_IMPULSE_LOOKBACK_DAYS surface=$EXPECTED_CONTEXT_SURFACE splitPolicy=$SPLIT_POLICY hitCountMode=${HIT_COUNT_MODE:-raw_row_count} hitCountDaySymbolCap=${HIT_COUNT_DAY_SYMBOL_CAP:-default} enableTrainMatchedDatePrune=${ENABLE_TRAIN_MATCHED_DATE_PRUNE:-false} minTrainMatchedDates=${MIN_TRAIN_MATCHED_DATES:-none} minTrainMatchedMonths=${MIN_TRAIN_MATCHED_MONTHS:-none} minTrainMatchedQuarters=${MIN_TRAIN_MATCHED_QUARTERS:-none} minTrainMatchedFolds=${MIN_TRAIN_MATCHED_FOLDS:-none} foldScheme=${FOLD_SCHEME:-none} maxTop1DateHitShare=${MAX_TOP1_DATE_HIT_SHARE:-none} maxTop3DateHitShare=${MAX_TOP3_DATE_HIT_SHARE:-none} maxTop1FoldHitShare=${MAX_TOP1_FOLD_HIT_SHARE:-none} maxTop3FoldHitShare=${MAX_TOP3_FOLD_HIT_SHARE:-none} enableLaneStratifiedMining=${ENABLE_LANE_STRATIFIED_MINING:-false} maxRulesPerMatchedDateSignature=${MAX_RULES_PER_MATCHED_DATE_SIGNATURE:-none} maxGap=$MAX_GAP_TRADING_DAYS train=$TRAIN_START:$TRAIN_END oos=$OOS_START:$OOS_END" \
  > "$FREEZE_RESULT_PATH"

FROZEN_CATALOG_PATH="$(read_json_field "$FREEZE_RESULT_PATH" "outPath")"
EXPECTED_CATALOG_SHA256="$(read_json_field "$FREEZE_RESULT_PATH" "catalogContentSha256")"
EXPECTED_RULE_IDS_SHA256="$(read_json_field "$FREEZE_RESULT_PATH" "ruleIdsSha256")"

run_open_pack_node tools/report_perfect_prototypes_oos.mjs \
  --input="$TRAIN_PACK_DIR/daily_pack.jsonl" \
  --catalog="$FROZEN_CATALOG_PATH" \
  --out-dir="$TRAIN_REPORT_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --start="$TRAIN_START" \
  --end="$TRAIN_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

run_open_pack_node tools/apply_perfect_prototypes.mjs \
  --input="$TRAIN_PACK_DIR/daily_pack.jsonl" \
  --catalog="$FROZEN_CATALOG_PATH" \
  --out-dir="$TRAIN_APPLY_RAW_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --start="$TRAIN_START" \
  --end="$TRAIN_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

run_open_pack_node tools/apply_perfect_prototypes.mjs \
  --input="$TRAIN_PACK_DIR/daily_pack.jsonl" \
  --catalog="$FROZEN_CATALOG_PATH" \
  --out-dir="$TRAIN_APPLY_CLOSE28_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --exclude-recommendation-close-ret-pct-gte="$CLOSE28_FILTER_PCT" \
  --candle-path="$ROOT_DIR/data/candle_daily.jsonl" \
  --start="$TRAIN_START" \
  --end="$TRAIN_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

run_open_pack_node tools/build_perfect_prototype_daily_pack.mjs "${OOS_PACK_ARGS[@]}"
apply_strict_label_boundary_to_daily_pack "$OOS_PACK_DIR" "$OOS_START" "$OOS_END" "$SPLIT_POLICY"
link_stage "step-perfect-prototype-open-oos-pack" "$OOS_PACK_DIR"

run_open_pack_node tools/report_perfect_prototypes_oos.mjs \
  --input="$OOS_PACK_DIR/daily_pack.jsonl" \
  --catalog="$FROZEN_CATALOG_PATH" \
  --out-dir="$OOS_REPORT_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --start="$OOS_START" \
  --end="$OOS_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

run_open_pack_node tools/apply_perfect_prototypes.mjs \
  --input="$OOS_PACK_DIR/daily_pack.jsonl" \
  --catalog="$FROZEN_CATALOG_PATH" \
  --out-dir="$OOS_APPLY_RAW_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --start="$OOS_START" \
  --end="$OOS_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

run_open_pack_node tools/apply_perfect_prototypes.mjs \
  --input="$OOS_PACK_DIR/daily_pack.jsonl" \
  --catalog="$FROZEN_CATALOG_PATH" \
  --out-dir="$OOS_APPLY_CLOSE28_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --exclude-recommendation-close-ret-pct-gte="$CLOSE28_FILTER_PCT" \
  --candle-path="$ROOT_DIR/data/candle_daily.jsonl" \
  --start="$OOS_START" \
  --end="$OOS_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

REPORT_EXTRA_ARGS=()
if [[ -n "$SUPPORT_CASES_FILE" ]]; then
  REPORT_EXTRA_ARGS+=(--support-cases-file="$SUPPORT_CASES_FILE")
fi

run_open_pack_node tools/report_stepb_plus_lite_open_eval_leaderboard.mjs \
  --catalog="$FROZEN_CATALOG_PATH" \
  --train-input="$TRAIN_PACK_DIR/daily_pack.jsonl" \
  --train-report-dir="$TRAIN_REPORT_DIR" \
  --train-apply-raw-dir="$TRAIN_APPLY_RAW_DIR" \
  --train-apply-close28-dir="$TRAIN_APPLY_CLOSE28_DIR" \
  --oos-input="$OOS_PACK_DIR/daily_pack.jsonl" \
  --oos-report-dir="$OOS_REPORT_DIR" \
  --oos-apply-raw-dir="$OOS_APPLY_RAW_DIR" \
  --oos-apply-close28-dir="$OOS_APPLY_CLOSE28_DIR" \
  --out-dir="$LEADERBOARD_DIR" \
  --run-id="$RUN_ID" \
  --split-policy="$SPLIT_POLICY" \
  --line-id="$EXPECTED_BASELINE_LINE_ID" \
  --selection-mode="$SELECTION_MODE" \
  --config-path="$CONFIG_PATH" \
  --config-sha256="$CONFIG_SHA256" \
  --train-config-path="$TRAIN_CONFIG_PATH" \
  --train-config-sha256="$TRAIN_CONFIG_SHA256" \
  --oos-config-path="$OOS_CONFIG_PATH" \
  --oos-config-sha256="$OOS_CONFIG_SHA256" \
  --train-start="$TRAIN_START" \
  --train-end="$TRAIN_END" \
  --oos-start="$OOS_START" \
  --oos-end="$OOS_END" \
  "${REPORT_EXTRA_ARGS[@]}"

echo "[ok] step-b dplus1 plus-lite run complete"
echo "runId=$RUN_ID"
echo "splitPolicy=$SPLIT_POLICY"
echo "discoveryUniverse=$DISCOVERY_UNIVERSE_ID"
echo "allowedStepALanes=${ALLOWED_STEPA_LANES:-}"
echo "maxGapTradingDays=$MAX_GAP_TRADING_DAYS"
echo "frozenCatalog=$FROZEN_CATALOG_PATH"
echo "catalogContentSha256=$EXPECTED_CATALOG_SHA256"
echo "ruleIdsSha256=$EXPECTED_RULE_IDS_SHA256"
echo "trainPackDir=$TRAIN_PACK_DIR"
echo "trainIndexRunId=${TRAIN_INDEX_RUN_ID:-}"
echo "trainMineRunId=$TRAIN_MINE_RUN_ID"
echo "oosPackDir=$OOS_PACK_DIR"
echo "trainReportDir=$TRAIN_REPORT_DIR"
echo "oosReportDir=$OOS_REPORT_DIR"
echo "oosApplyRawDir=$OOS_APPLY_RAW_DIR"
echo "oosApplyClose28Dir=$OOS_APPLY_CLOSE28_DIR"
echo "leaderboardDir=$LEADERBOARD_DIR"
