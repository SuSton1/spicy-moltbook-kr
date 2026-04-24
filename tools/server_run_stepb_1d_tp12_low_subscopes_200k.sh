#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_RUN_ID="perfect_proto_stepb_1d_tp12_low_subscopes_probe200k_v1_$(date +%Y%m%d_%H%M%S)"
DEFAULT_SOURCE_RUN_ID="perfect_proto_stepb_1d_recent_impulse_upto_1d_t12_h3_s4_surface_v1_probe200k_v1_control"
EXPECTED_CONTEXT_SURFACE="v3_contextual_plus_lite"
OPEN_PACK_NODE_HEAP_MB="6144"
EXACT_INDEX_NODE_HEAP_MB="6144"
MINE_NODE_HEAP_MB="8192"
LIB_PATH="$ROOT_DIR/tools/lib_stepb_dplus1_baseline_wrapper.sh"

# shellcheck source=/dev/null
source "$LIB_PATH"

RUN_ID="$DEFAULT_RUN_ID"
SOURCE_RUN_ID="$DEFAULT_SOURCE_RUN_ID"
TRAIN_START="2020-11-27"
TRAIN_END="2024-12-31"
OOS_START="2025-01-01"
OOS_END="2026-01-31"
MAX_SEARCH_STATES="200000"
MIN_HIT_COUNT="4"
MIN_TRAIN_MATCHED_DATES="4"
MIN_TRAIN_MATCHED_MONTHS="4"
MIN_TRAIN_MATCHED_FOLDS="3"
FOLD_SCHEME="chronological_4"
MAX_RULE_SIZE="6"
MAX_SEED_TOKENS="4000"
MAX_RULES="4000"
MAX_GAP_TRADING_DAYS="100000"
SELECTION_MODE="union_all"
PROMOTABLE_FIRST="false"
ENABLE_PROMOTABLE_SEARCH_PRUNE=""
ENABLE_PROMOTABLE_SEARCH_ORDERING=""
PROMOTABLE_MIN_TRAIN_MATCHED_DATES="10"
PROMOTABLE_MIN_TRAIN_MATCHED_MONTHS="6"
PROMOTABLE_MIN_TRAIN_MATCHED_FOLDS="4"
PROMOTABLE_MAX_TOP1_DATE_HIT_SHARE=""
PROMOTABLE_MAX_TOP3_DATE_HIT_SHARE=""
PROMOTABLE_MAX_TOP1_FOLD_HIT_SHARE=""
PROMOTABLE_MAX_TOP3_FOLD_HIT_SHARE=""
CLOSE28_FILTER_PCT="28"
SUBSCOPE_IDS="LOW_GAP_TOP,LOW_GAP_HIGH,LOW_JUMP_BELOW"
ROW_CONTRACT="open_eval_recent_impulse_1d"
CONFIG_PATH="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite_target12.json"

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
  cat <<EOF2
Usage: bash tools/server_run_stepb_1d_tp12_low_subscopes_200k.sh [--run-id=<run_id>] [--source-run-id=<broad_control_run>] [--subscope-ids=LOW_GAP_TOP,...] [--promotable-first=true|false]
Reuses the existing broad 1D TP12 baseline control packs and reruns exact mining on filtered LOW subtype sub-scopes with:
  - strict_label_boundary
  - recent_impulse_upto_1d source contract
  - NEXT_DAY_OPEN / 3d / 12% / 4%
  - baseline conjunction language
  - baseline surface v3_contextual_plus_lite
  - max-rule-size=6
  - max-search-states=200000
Optional promotable-first mode:
  --promotable-first=true
  --enable-promotable-search-prune=true|false
  --enable-promotable-search-ordering=true|false
  --promotable-min-train-matched-dates=10
  --promotable-min-train-matched-months=6
  --promotable-min-train-matched-folds=4
  --promotable-max-top1-date-hit-share=<rate>
  --promotable-max-top3-date-hit-share=<rate>
  --promotable-max-top1-fold-hit-share=<rate>
  --promotable-max-top3-fold-hit-share=<rate>
EOF2
}

for arg in "$@"; do
  case "$arg" in
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --source-run-id=*) SOURCE_RUN_ID="${arg#*=}" ;;
    --subscope-ids=*) SUBSCOPE_IDS="${arg#*=}" ;;
    --promotable-first=*) PROMOTABLE_FIRST="${arg#*=}" ;;
    --enable-promotable-search-prune=*) ENABLE_PROMOTABLE_SEARCH_PRUNE="${arg#*=}" ;;
    --enable-promotable-search-ordering=*) ENABLE_PROMOTABLE_SEARCH_ORDERING="${arg#*=}" ;;
    --promotable-min-train-matched-dates=*) PROMOTABLE_MIN_TRAIN_MATCHED_DATES="${arg#*=}" ;;
    --promotable-min-train-matched-months=*) PROMOTABLE_MIN_TRAIN_MATCHED_MONTHS="${arg#*=}" ;;
    --promotable-min-train-matched-folds=*) PROMOTABLE_MIN_TRAIN_MATCHED_FOLDS="${arg#*=}" ;;
    --promotable-max-top1-date-hit-share=*) PROMOTABLE_MAX_TOP1_DATE_HIT_SHARE="${arg#*=}" ;;
    --promotable-max-top3-date-hit-share=*) PROMOTABLE_MAX_TOP3_DATE_HIT_SHARE="${arg#*=}" ;;
    --promotable-max-top1-fold-hit-share=*) PROMOTABLE_MAX_TOP1_FOLD_HIT_SHARE="${arg#*=}" ;;
    --promotable-max-top3-fold-hit-share=*) PROMOTABLE_MAX_TOP3_FOLD_HIT_SHARE="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) fatal "Unknown argument: $arg" ;;
  esac
done

[[ "$ROOT_DIR" == "$EXPECTED_SERVER_ROOT" ]] || fatal "Run this wrapper on the server repo root: expected=$EXPECTED_SERVER_ROOT actual=$ROOT_DIR"
validate_baseline_contract_config "$CONFIG_PATH" "stepb_dplus1_plus_lite_target12" "$MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
[[ "$PROMOTABLE_FIRST" == "true" || "$PROMOTABLE_FIRST" == "false" ]] || fatal "--promotable-first must be true or false"
[[ -z "$ENABLE_PROMOTABLE_SEARCH_PRUNE" || "$ENABLE_PROMOTABLE_SEARCH_PRUNE" == "true" || "$ENABLE_PROMOTABLE_SEARCH_PRUNE" == "false" ]] || fatal "--enable-promotable-search-prune must be true, false, or omitted"
[[ -z "$ENABLE_PROMOTABLE_SEARCH_ORDERING" || "$ENABLE_PROMOTABLE_SEARCH_ORDERING" == "true" || "$ENABLE_PROMOTABLE_SEARCH_ORDERING" == "false" ]] || fatal "--enable-promotable-search-ordering must be true, false, or omitted"
CONFIG_SHA256="$(compute_sha256 "$CONFIG_PATH")"
SOURCE_RUN_DIR="$ROOT_DIR/artifacts/runs/$SOURCE_RUN_ID"
SOURCE_TRAIN_PACK="$SOURCE_RUN_DIR/step-perfect-prototype-open-train-pack/daily_pack.jsonl"
SOURCE_OOS_PACK="$SOURCE_RUN_DIR/step-perfect-prototype-open-oos-pack/daily_pack.jsonl"
[[ -f "$SOURCE_TRAIN_PACK" ]] || fatal "source train pack missing: $SOURCE_TRAIN_PACK"
[[ -f "$SOURCE_OOS_PACK" ]] || fatal "source oos pack missing: $SOURCE_OOS_PACK"

PARENT_RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
OUT_DIR="$PARENT_RUN_DIR/step-perfect-prototype-1d-tp12-low-subscopes-report"
mkdir -p "$OUT_DIR"

subscope_slug() {
  local subscope_id="$1"
  case "$subscope_id" in
    LOW_GAP_TOP) printf 'gap_top' ;;
    LOW_GAP_HIGH) printf 'gap_high' ;;
    LOW_JUMP_BELOW) printf 'jump_below' ;;
    *) printf '%s' "$(printf '%s' "$subscope_id" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_')" ;;
  esac
}

subscope_line_id() {
  local subscope_id="$1"
  case "$subscope_id" in
    LOW_GAP_TOP) printf 'stepb_dplus1_plus_lite_target12_low_gap_top_probe' ;;
    LOW_GAP_HIGH) printf 'stepb_dplus1_plus_lite_target12_low_gap_high_probe' ;;
    LOW_JUMP_BELOW) printf 'stepb_dplus1_plus_lite_target12_low_jump_below_probe' ;;
    *) printf 'stepb_dplus1_plus_lite_target12_low_%s_probe' "$(subscope_slug "$subscope_id")" ;;
  esac
}

write_no_rules_artifacts() {
  local summary_path="$1"
  local freeze_result_path="$2"
  local reason="$3"
  local subscope_id="$4"
  node --input-type=module - "$summary_path" "$freeze_result_path" "$reason" "$subscope_id" <<'NODE'
import fs from "node:fs/promises"

const [summaryPath, freezeResultPath, reason, subscopeId] = process.argv.slice(2)
const summary = {
  status: "no_rules",
  reason,
  subscopeId,
}
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
await fs.writeFile(
  freezeResultPath,
  `${JSON.stringify({ status: "no_rules", reason, summaryPath }, null, 2)}\n`,
  "utf8",
)
NODE
}

run_subscope() {
  local subscope_id="$1"
  local slug="$2"
  local line_id="$3"
  local scope_run_id="${RUN_ID}_${slug}"
  local scope_run_dir="$ROOT_DIR/artifacts/runs/$scope_run_id"
  local train_pack_dir="$scope_run_dir/step-perfect-prototype-open-train-pack"
  local oos_pack_dir="$scope_run_dir/step-perfect-prototype-open-oos-pack"
  local train_index_dir="$scope_run_dir/step-perfect-prototype-index-train"
  local train_mine_dir="$scope_run_dir/step-perfect-prototype-train"
  local train_report_dir="$scope_run_dir/step-perfect-prototype-open-train-report"
  local train_apply_raw_dir="$scope_run_dir/step-perfect-prototype-open-train-apply-raw"
  local train_apply_close28_dir="$scope_run_dir/step-perfect-prototype-open-train-apply-close28"
  local oos_report_dir="$scope_run_dir/step-perfect-prototype-open-oos-report"
  local oos_apply_raw_dir="$scope_run_dir/step-perfect-prototype-open-oos-apply-raw"
  local oos_apply_close28_dir="$scope_run_dir/step-perfect-prototype-open-oos-apply-close28"
  local leaderboard_dir="$scope_run_dir/step-perfect-prototype-open-eval-report"
  local freeze_result_path="$scope_run_dir/freeze_result.json"
  local no_rules_summary_path="$scope_run_dir/no_rules_summary.json"
  local train_rule_ids_path="$scope_run_dir/train_rule_ids.txt"
  local started_at finished_at elapsed_sec
  local train_matched_rows=0
  local oos_matched_rows=0
  local -a promotable_args=()
  local enable_promotable_search_prune="$PROMOTABLE_FIRST"
  local enable_promotable_search_ordering="$PROMOTABLE_FIRST"

  if [[ -n "$ENABLE_PROMOTABLE_SEARCH_PRUNE" ]]; then
    enable_promotable_search_prune="$ENABLE_PROMOTABLE_SEARCH_PRUNE"
  fi
  if [[ -n "$ENABLE_PROMOTABLE_SEARCH_ORDERING" ]]; then
    enable_promotable_search_ordering="$ENABLE_PROMOTABLE_SEARCH_ORDERING"
  fi

  if [[ "$enable_promotable_search_prune" == "true" || "$enable_promotable_search_ordering" == "true" ]]; then
    promotable_args+=(
      --enable-promotable-search-prune="$enable_promotable_search_prune"
      --enable-promotable-search-ordering="$enable_promotable_search_ordering"
    )
  fi
  if [[ "$enable_promotable_search_prune" == "true" ]]; then
    promotable_args+=(
      --promotable-min-train-matched-dates="$PROMOTABLE_MIN_TRAIN_MATCHED_DATES"
      --promotable-min-train-matched-months="$PROMOTABLE_MIN_TRAIN_MATCHED_MONTHS"
      --promotable-min-train-matched-folds="$PROMOTABLE_MIN_TRAIN_MATCHED_FOLDS"
    )
    [[ -n "$PROMOTABLE_MAX_TOP1_DATE_HIT_SHARE" ]] && promotable_args+=(--promotable-max-top1-date-hit-share="$PROMOTABLE_MAX_TOP1_DATE_HIT_SHARE")
    [[ -n "$PROMOTABLE_MAX_TOP3_DATE_HIT_SHARE" ]] && promotable_args+=(--promotable-max-top3-date-hit-share="$PROMOTABLE_MAX_TOP3_DATE_HIT_SHARE")
    [[ -n "$PROMOTABLE_MAX_TOP1_FOLD_HIT_SHARE" ]] && promotable_args+=(--promotable-max-top1-fold-hit-share="$PROMOTABLE_MAX_TOP1_FOLD_HIT_SHARE")
    [[ -n "$PROMOTABLE_MAX_TOP3_FOLD_HIT_SHARE" ]] && promotable_args+=(--promotable-max-top3-fold-hit-share="$PROMOTABLE_MAX_TOP3_FOLD_HIT_SHARE")
  fi

  mkdir -p "$scope_run_dir"
  node tools/build_perfect_prototype_tp12_low_subscope_filtered_pack.mjs \
    --input="$SOURCE_TRAIN_PACK" \
    --out-dir="$train_pack_dir" \
    --subscope-id="$subscope_id" \
    --source-run-id="$SOURCE_RUN_ID" \
    --source-stage-label=train \
    --row-contract="$ROW_CONTRACT" \
    --require-nonempty=false >/dev/null
  node tools/build_perfect_prototype_tp12_low_subscope_filtered_pack.mjs \
    --input="$SOURCE_OOS_PACK" \
    --out-dir="$oos_pack_dir" \
    --subscope-id="$subscope_id" \
    --source-run-id="$SOURCE_RUN_ID" \
    --source-stage-label=oos \
    --row-contract="$ROW_CONTRACT" \
    --require-nonempty=false >/dev/null

  train_matched_rows="$(read_json_field "$train_pack_dir/filter_summary.json" "matchedRows" || printf '0')"
  oos_matched_rows="$(read_json_field "$oos_pack_dir/filter_summary.json" "matchedRows" || printf '0')"

  started_at="$(date +%s)"
  if [[ "$train_matched_rows" -lt 1 || "$oos_matched_rows" -lt 1 ]]; then
    write_no_rules_artifacts "$no_rules_summary_path" "$freeze_result_path" "unsat_no_subscope_rows" "$subscope_id"
  else
    run_exact_index_node tools/build_stepb_exact_index.mjs \
      --input="$train_pack_dir/daily_pack.jsonl" \
      --out-dir="$train_index_dir" \
      --surface="$EXPECTED_CONTEXT_SURFACE" \
      --train-start="$TRAIN_START" \
      --train-end="$TRAIN_END" \
      --min-hit-count="$MIN_HIT_COUNT" \
      --max-gap="$MAX_GAP_TRADING_DAYS" \
      --max-rule-size="$MAX_RULE_SIZE" \
      --max-seed-tokens="$MAX_SEED_TOKENS" \
      --max-rules="$MAX_RULES" \
      --max-search-states="$MAX_SEARCH_STATES"

    run_mine_node tools/mine_perfect_prototypes_indexed.mjs \
      --index-dir="$train_index_dir" \
      --out-dir="$train_mine_dir" \
      --min-hit-count="$MIN_HIT_COUNT" \
      --max-gap="$MAX_GAP_TRADING_DAYS" \
      --max-rule-size="$MAX_RULE_SIZE" \
      --max-seed-tokens="$MAX_SEED_TOKENS" \
      --max-rules="$MAX_RULES" \
      --max-search-states="$MAX_SEARCH_STATES" \
      --enable-train-matched-date-prune=true \
      --min-train-matched-dates="$MIN_TRAIN_MATCHED_DATES" \
      --min-train-matched-months="$MIN_TRAIN_MATCHED_MONTHS" \
      --min-train-matched-folds="$MIN_TRAIN_MATCHED_FOLDS" \
      --fold-scheme="$FOLD_SCHEME" \
      "${promotable_args[@]}"

    node --input-type=module - "$train_mine_dir/catalog.json" "$train_rule_ids_path" <<'NODE'
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

    local train_rule_count
    train_rule_count="$(awk 'NF { count += 1 } END { print count + 0 }' "$train_rule_ids_path")"
    if [[ "$train_rule_count" -lt 1 ]]; then
      write_no_rules_artifacts "$no_rules_summary_path" "$freeze_result_path" "train_mine_produced_zero_rules" "$subscope_id"
    else
      node tools/build_curated_perfect_prototype_catalog.mjs \
        --source-catalog="$train_mine_dir/catalog.json" \
        --rule-ids-file="$train_rule_ids_path" \
        --label="${line_id}_${slug}_all_rules" \
        --note="line=${line_id} subscopeId=${subscope_id} sourceRunId=${SOURCE_RUN_ID} surface=${EXPECTED_CONTEXT_SURFACE} splitPolicy=strict_label_boundary discoveryUniverse=recent_impulse_upto_1d requestedLookbackTradingDays=1 maxGap=${MAX_GAP_TRADING_DAYS} train=${TRAIN_START}:${TRAIN_END} oos=${OOS_START}:${OOS_END}" \
        > "$freeze_result_path"

      local frozen_catalog_path
      local expected_catalog_sha256
      local expected_rule_ids_sha256
      frozen_catalog_path="$(read_json_field "$freeze_result_path" "outPath")"
      expected_catalog_sha256="$(read_json_field "$freeze_result_path" "catalogContentSha256")"
      expected_rule_ids_sha256="$(read_json_field "$freeze_result_path" "ruleIdsSha256")"

      run_open_pack_node tools/report_perfect_prototypes_oos.mjs \
        --input="$train_pack_dir/daily_pack.jsonl" \
        --catalog="$frozen_catalog_path" \
        --out-dir="$train_report_dir" \
        --selection-mode="$SELECTION_MODE" \
        --start="$TRAIN_START" \
        --end="$TRAIN_END" \
        --expected-catalog-sha256="$expected_catalog_sha256" \
        --expected-rule-ids-sha256="$expected_rule_ids_sha256"

      run_open_pack_node tools/apply_perfect_prototypes.mjs \
        --input="$train_pack_dir/daily_pack.jsonl" \
        --catalog="$frozen_catalog_path" \
        --out-dir="$train_apply_raw_dir" \
        --selection-mode="$SELECTION_MODE" \
        --start="$TRAIN_START" \
        --end="$TRAIN_END" \
        --expected-catalog-sha256="$expected_catalog_sha256" \
        --expected-rule-ids-sha256="$expected_rule_ids_sha256"

      run_open_pack_node tools/apply_perfect_prototypes.mjs \
        --input="$train_pack_dir/daily_pack.jsonl" \
        --catalog="$frozen_catalog_path" \
        --out-dir="$train_apply_close28_dir" \
        --selection-mode="$SELECTION_MODE" \
        --exclude-recommendation-close-ret-pct-gte="$CLOSE28_FILTER_PCT" \
        --candle-path="$ROOT_DIR/data/candle_daily.jsonl" \
        --start="$TRAIN_START" \
        --end="$TRAIN_END" \
        --expected-catalog-sha256="$expected_catalog_sha256" \
        --expected-rule-ids-sha256="$expected_rule_ids_sha256"

      run_open_pack_node tools/report_perfect_prototypes_oos.mjs \
        --input="$oos_pack_dir/daily_pack.jsonl" \
        --catalog="$frozen_catalog_path" \
        --out-dir="$oos_report_dir" \
        --selection-mode="$SELECTION_MODE" \
        --start="$OOS_START" \
        --end="$OOS_END" \
        --expected-catalog-sha256="$expected_catalog_sha256" \
        --expected-rule-ids-sha256="$expected_rule_ids_sha256"

      run_open_pack_node tools/apply_perfect_prototypes.mjs \
        --input="$oos_pack_dir/daily_pack.jsonl" \
        --catalog="$frozen_catalog_path" \
        --out-dir="$oos_apply_raw_dir" \
        --selection-mode="$SELECTION_MODE" \
        --start="$OOS_START" \
        --end="$OOS_END" \
        --expected-catalog-sha256="$expected_catalog_sha256" \
        --expected-rule-ids-sha256="$expected_rule_ids_sha256"

      run_open_pack_node tools/apply_perfect_prototypes.mjs \
        --input="$oos_pack_dir/daily_pack.jsonl" \
        --catalog="$frozen_catalog_path" \
        --out-dir="$oos_apply_close28_dir" \
        --selection-mode="$SELECTION_MODE" \
        --exclude-recommendation-close-ret-pct-gte="$CLOSE28_FILTER_PCT" \
        --candle-path="$ROOT_DIR/data/candle_daily.jsonl" \
        --start="$OOS_START" \
        --end="$OOS_END" \
        --expected-catalog-sha256="$expected_catalog_sha256" \
        --expected-rule-ids-sha256="$expected_rule_ids_sha256"

      run_open_pack_node tools/report_stepb_plus_lite_open_eval_leaderboard.mjs \
        --catalog="$frozen_catalog_path" \
        --train-input="$train_pack_dir/daily_pack.jsonl" \
        --train-report-dir="$train_report_dir" \
        --train-apply-raw-dir="$train_apply_raw_dir" \
        --train-apply-close28-dir="$train_apply_close28_dir" \
        --oos-input="$oos_pack_dir/daily_pack.jsonl" \
        --oos-report-dir="$oos_report_dir" \
        --oos-apply-raw-dir="$oos_apply_raw_dir" \
        --oos-apply-close28-dir="$oos_apply_close28_dir" \
        --out-dir="$leaderboard_dir" \
        --run-id="$scope_run_id" \
        --split-policy="strict_label_boundary" \
        --line-id="$line_id" \
        --selection-mode="$SELECTION_MODE" \
        --config-path="$CONFIG_PATH" \
        --config-sha256="$CONFIG_SHA256" \
        --train-config-path="$CONFIG_PATH" \
        --train-config-sha256="$CONFIG_SHA256" \
        --oos-config-path="$CONFIG_PATH" \
        --oos-config-sha256="$CONFIG_SHA256" \
        --train-start="$TRAIN_START" \
        --train-end="$TRAIN_END" \
        --oos-start="$OOS_START" \
        --oos-end="$OOS_END"
    fi
  fi
  finished_at="$(date +%s)"
  elapsed_sec="$(( finished_at - started_at ))"

  local exit_code=0
  if [[ -f "$no_rules_summary_path" ]]; then
    exit_code=42
  fi
  printf '%s\n' "$exit_code" > "$OUT_DIR/${slug}_exit_code.txt"
  cat > "$OUT_DIR/${slug}_runtime.json" <<EOF2
{
  "subscopeId": "$subscope_id",
  "runId": "$scope_run_id",
  "exitCode": $exit_code,
  "wallClockSec": $elapsed_sec
}
EOF2
}

for subscope_id in $(printf '%s' "$SUBSCOPE_IDS" | tr ',' ' '); do
  run_subscope "$subscope_id" "$(subscope_slug "$subscope_id")" "$(subscope_line_id "$subscope_id")"
done

REPORT_ARGS=(
  --run-id="$RUN_ID"
  --source-run-id="$SOURCE_RUN_ID"
  --out-dir="$OUT_DIR"
)
DONE_LINES=(
  "[done] 1D TP12 LOW-subscope probes completed"
  "  parentRunId=$RUN_ID"
  "  sourceRunId=$SOURCE_RUN_ID"
)

for subscope_id in $(printf '%s' "$SUBSCOPE_IDS" | tr ',' ' '); do
  slug="$(subscope_slug "$subscope_id")"
  scope_run_id="${RUN_ID}_${slug}"
  exit_code_path="$OUT_DIR/${slug}_exit_code.txt"
  runtime_path="$OUT_DIR/${slug}_runtime.json"
  [[ -f "$exit_code_path" ]] || fatal "missing exit code artifact for $subscope_id: $exit_code_path"
  [[ -f "$runtime_path" ]] || fatal "missing runtime artifact for $subscope_id: $runtime_path"
  exit_code="$(cat "$exit_code_path")"
  wall_sec="$(read_json_field "$runtime_path" "wallClockSec")"
  case "$subscope_id" in
    LOW_GAP_TOP) REPORT_ARGS+=(--gap-top="${scope_run_id}:${exit_code}:${wall_sec}") ;;
    LOW_GAP_HIGH) REPORT_ARGS+=(--gap-high="${scope_run_id}:${exit_code}:${wall_sec}") ;;
    LOW_JUMP_BELOW) REPORT_ARGS+=(--jump-below="${scope_run_id}:${exit_code}:${wall_sec}") ;;
    *) fatal "unsupported subscope id for report aggregation: $subscope_id" ;;
  esac
  DONE_LINES+=("  ${slug}RunId=${scope_run_id} exit=${exit_code}")
done

node tools/build_stepb_1d_tp12_low_subscopes_report.mjs "${REPORT_ARGS[@]}"

DONE_LINES+=("  promotableFirst=$PROMOTABLE_FIRST")
DONE_LINES+=("  report=$OUT_DIR/report.md")
printf '%s\n' "${DONE_LINES[@]}"
