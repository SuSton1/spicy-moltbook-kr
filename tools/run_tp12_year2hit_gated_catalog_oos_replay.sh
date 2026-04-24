#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID=""
CONTRACT_PATH="meta/tp12_year2hit_train_2016_2024_contract.json"
CANDLE_PATH="data/candle_daily.jsonl"
UNIVERSE_PATH="data/universe_daily.jsonl"
OUT_ROOT=""
TRAIN_GATE_SUMMARY=""
DATA_READINESS_SUMMARY=""
ASOF_SURVIVORSHIP_SUMMARY=""
LABEL_MANIFEST=""
TOKEN_DICTIONARY_MANIFEST=""
EVENT_ROW_MANIFEST=""
QUALITY_GATE_SUMMARY=""
SURVIVOR_CATALOG_MANIFEST=""
GATED_CATALOG=""
GATED_CATALOG_MANIFEST=""
EXPECTED_GATE_SHA256=""
EXPECTED_CATALOG_SHA256=""
OOS_FROM=""
OOS_TO=""
LABEL_HORIZON_TO=""
REQUIRE_EXTENDED_MANIFESTS="false"
HIT_DEFINITION=""
HIT_FIELD="hitTarget"
RUN_MONTHLY_QUOTA_SCHEDULER="false"
MONTHLY_QUOTA_FULL_MONTH_KEYS=""
MONTHLY_QUOTA_FAIL_ON_GATE_FAILURE="true"

usage() {
  cat <<'EOF'
Usage:
  bash tools/run_tp12_year2hit_gated_catalog_oos_replay.sh --run-id=ID \
    --train-gate-summary=PATH --gated-catalog=PATH --gated-catalog-manifest=PATH [options]

Runs the explicit OOS replay path for an already gated year2hit catalog:
preflight -> OOS label events -> OOS tokenized events -> gated-catalog materialization -> replay report.

This wrapper does not mine new candidates and does not delegate to the fixed-window remine runner.
Pass --require-extended-manifests=true with train label/token/event and survivor manifests for the
strict frozen-survivor preflight path.
For operational monthly quota evaluation, pass --hit-definition=operational_hit_v1,
--hit-field=operationalHitTarget, --run-monthly-quota-scheduler=true, and explicit
--monthly-quota-full-month-keys=YYYY-MM,YYYY-MM.
EOF
}

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --run-id=*) RUN_ID="${1#*=}"; shift ;;
    --contract-path=*) CONTRACT_PATH="${1#*=}"; shift ;;
    --candle-path=*) CANDLE_PATH="${1#*=}"; shift ;;
    --universe-path=*) UNIVERSE_PATH="${1#*=}"; shift ;;
    --out-root=*) OUT_ROOT="${1#*=}"; shift ;;
    --train-gate-summary=*) TRAIN_GATE_SUMMARY="${1#*=}"; shift ;;
    --data-readiness-summary=*) DATA_READINESS_SUMMARY="${1#*=}"; shift ;;
    --asof-survivorship-summary=*) ASOF_SURVIVORSHIP_SUMMARY="${1#*=}"; shift ;;
    --label-manifest=*) LABEL_MANIFEST="${1#*=}"; shift ;;
    --token-dictionary-manifest=*) TOKEN_DICTIONARY_MANIFEST="${1#*=}"; shift ;;
    --event-row-manifest=*) EVENT_ROW_MANIFEST="${1#*=}"; shift ;;
    --quality-gate-summary=*) QUALITY_GATE_SUMMARY="${1#*=}"; shift ;;
    --survivor-catalog-manifest=*) SURVIVOR_CATALOG_MANIFEST="${1#*=}"; shift ;;
    --gated-catalog=*) GATED_CATALOG="${1#*=}"; shift ;;
    --gated-catalog-manifest=*) GATED_CATALOG_MANIFEST="${1#*=}"; shift ;;
    --expected-gate-sha256=*) EXPECTED_GATE_SHA256="${1#*=}"; shift ;;
    --expected-catalog-sha256=*) EXPECTED_CATALOG_SHA256="${1#*=}"; shift ;;
    --oos-from=*) OOS_FROM="${1#*=}"; shift ;;
    --oos-to=*) OOS_TO="${1#*=}"; shift ;;
    --label-horizon-to=*) LABEL_HORIZON_TO="${1#*=}"; shift ;;
    --require-extended-manifests=*) REQUIRE_EXTENDED_MANIFESTS="${1#*=}"; shift ;;
    --hit-definition=*) HIT_DEFINITION="${1#*=}"; shift ;;
    --hit-field=*) HIT_FIELD="${1#*=}"; shift ;;
    --run-monthly-quota-scheduler=*) RUN_MONTHLY_QUOTA_SCHEDULER="${1#*=}"; shift ;;
    --monthly-quota-full-month-keys=*) MONTHLY_QUOTA_FULL_MONTH_KEYS="${1#*=}"; shift ;;
    --monthly-quota-full-months=*) MONTHLY_QUOTA_FULL_MONTH_KEYS="${1#*=}"; shift ;;
    --monthly-quota-fail-on-gate-failure=*) MONTHLY_QUOTA_FAIL_ON_GATE_FAILURE="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: ${1}" >&2; exit 1 ;;
  esac
done

[[ -n "$RUN_ID" ]] || { echo "--run-id is required" >&2; exit 4; }
[[ -f "$CONTRACT_PATH" ]] || { echo "contract not found: $CONTRACT_PATH" >&2; exit 4; }
[[ -f "$CANDLE_PATH" ]] || { echo "candle path not found: $CANDLE_PATH" >&2; exit 4; }
[[ -f "$UNIVERSE_PATH" ]] || { echo "universe path not found: $UNIVERSE_PATH" >&2; exit 4; }
[[ -f "$TRAIN_GATE_SUMMARY" ]] || { echo "train gate summary not found: $TRAIN_GATE_SUMMARY" >&2; exit 4; }
[[ -f "$GATED_CATALOG" ]] || { echo "gated catalog not found: $GATED_CATALOG" >&2; exit 4; }
[[ -f "$GATED_CATALOG_MANIFEST" ]] || { echo "gated catalog manifest not found: $GATED_CATALOG_MANIFEST" >&2; exit 4; }
if [[ -n "$QUALITY_GATE_SUMMARY" && ! -f "$QUALITY_GATE_SUMMARY" ]]; then
  echo "quality gate summary not found: $QUALITY_GATE_SUMMARY" >&2
  exit 4
fi
if [[ -n "$DATA_READINESS_SUMMARY" && ! -f "$DATA_READINESS_SUMMARY" ]]; then
  echo "data readiness summary not found: $DATA_READINESS_SUMMARY" >&2
  exit 4
fi
if [[ -n "$ASOF_SURVIVORSHIP_SUMMARY" && ! -f "$ASOF_SURVIVORSHIP_SUMMARY" ]]; then
  echo "as-of survivorship summary not found: $ASOF_SURVIVORSHIP_SUMMARY" >&2
  exit 4
fi
if [[ -n "$LABEL_MANIFEST" && ! -f "$LABEL_MANIFEST" ]]; then
  echo "label manifest not found: $LABEL_MANIFEST" >&2
  exit 4
fi
if [[ -n "$TOKEN_DICTIONARY_MANIFEST" && ! -f "$TOKEN_DICTIONARY_MANIFEST" ]]; then
  echo "token dictionary manifest not found: $TOKEN_DICTIONARY_MANIFEST" >&2
  exit 4
fi
if [[ -n "$EVENT_ROW_MANIFEST" && ! -f "$EVENT_ROW_MANIFEST" ]]; then
  echo "event row manifest not found: $EVENT_ROW_MANIFEST" >&2
  exit 4
fi
if [[ -n "$SURVIVOR_CATALOG_MANIFEST" && ! -f "$SURVIVOR_CATALOG_MANIFEST" ]]; then
  echo "survivor catalog manifest not found: $SURVIVOR_CATALOG_MANIFEST" >&2
  exit 4
fi

mapfile -t contract_oos_range < <(node --input-type=module - "$CONTRACT_PATH" <<'NODE'
import fs from "node:fs"

const contractPath = process.argv[2]
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"))
const from = String(contract?.oosDateRange?.from ?? "").trim()
const to = String(contract?.oosDateRange?.to ?? "").trim()
if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
  throw new Error(`contract oosDateRange is invalid: ${from || "missing"}..${to || "missing"}`)
}
console.log(from)
console.log(to)
NODE
)

if [[ -z "$OOS_FROM" ]]; then OOS_FROM="${contract_oos_range[0]}"; fi
if [[ -z "$OOS_TO" ]]; then OOS_TO="${contract_oos_range[1]}"; fi
if [[ -z "$LABEL_HORIZON_TO" ]]; then LABEL_HORIZON_TO="$OOS_TO"; fi

[[ "$OOS_FROM" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "invalid --oos-from: $OOS_FROM" >&2; exit 4; }
[[ "$OOS_TO" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "invalid --oos-to: $OOS_TO" >&2; exit 4; }
[[ "$LABEL_HORIZON_TO" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || {
  echo "invalid --label-horizon-to: $LABEL_HORIZON_TO" >&2
  exit 4
}
if [[ "$OOS_FROM" > "$OOS_TO" ]]; then
  echo "invalid OOS range: $OOS_FROM..$OOS_TO" >&2
  exit 4
fi

if [[ -z "$OUT_ROOT" ]]; then
  OUT_ROOT="$ROOT_DIR/artifacts/runs/$RUN_ID/step-tp12-year2hit-gated-catalog-oos-replay"
fi
if [[ -e "$OUT_ROOT" ]]; then
  echo "out root already exists: $OUT_ROOT" >&2
  exit 4
fi
mkdir -p "$OUT_ROOT"

PREFLIGHT_SUMMARY="$OUT_ROOT/oos_preflight_summary.json"
LABEL_EVENTS="$OUT_ROOT/oos_label_events.jsonl"
LABEL_SUMMARY="$OUT_ROOT/oos_label_event_summary.json"
TOKENIZED_EVENTS="$OUT_ROOT/oos_tokenized_events.jsonl"
TOKENIZED_SUMMARY="$OUT_ROOT/oos_tokenized_event_summary.json"
CANDIDATE_EVENTS="$OUT_ROOT/oos_candidate_events.jsonl"
MATERIALIZE_SUMMARY="$OUT_ROOT/oos_candidate_event_materialize_summary.json"
REPLAY_SUMMARY="$OUT_ROOT/oos_replay_summary.json"
REPLAY_REPORT="$OUT_ROOT/oos_replay_report.md"
SYMBOL_DATE_UNION="$OUT_ROOT/oos_symbol_date_union.jsonl"
ONE_PICK_PER_DAY="$OUT_ROOT/oos_one_pick_per_day.jsonl"
MONTHLY_QUOTA_SUMMARY="$OUT_ROOT/oos_monthly_quota_scheduler_summary.json"
MONTHLY_QUOTA_SELECTIONS="$OUT_ROOT/oos_monthly_quota_scheduler_selections.jsonl"

preflight_args=(
  "tools/assert_tp12_year2hit_oos_preflight.mjs"
  "--contract-path=$CONTRACT_PATH"
  "--train-gate-summary=$TRAIN_GATE_SUMMARY"
  "--gated-catalog=$GATED_CATALOG"
  "--gated-catalog-manifest=$GATED_CATALOG_MANIFEST"
  "--oos-from=$OOS_FROM"
  "--oos-to=$OOS_TO"
  "--require-extended-manifests=$REQUIRE_EXTENDED_MANIFESTS"
  "--out=$PREFLIGHT_SUMMARY"
)
if [[ -n "$LABEL_MANIFEST" ]]; then
  preflight_args+=("--label-manifest=$LABEL_MANIFEST")
fi
if [[ -n "$DATA_READINESS_SUMMARY" ]]; then
  preflight_args+=("--data-readiness-summary=$DATA_READINESS_SUMMARY")
fi
if [[ -n "$ASOF_SURVIVORSHIP_SUMMARY" ]]; then
  preflight_args+=("--asof-survivorship-summary=$ASOF_SURVIVORSHIP_SUMMARY")
fi
if [[ -n "$TOKEN_DICTIONARY_MANIFEST" ]]; then
  preflight_args+=("--token-dictionary-manifest=$TOKEN_DICTIONARY_MANIFEST")
fi
if [[ -n "$EVENT_ROW_MANIFEST" ]]; then
  preflight_args+=("--event-row-manifest=$EVENT_ROW_MANIFEST")
fi
if [[ -n "$QUALITY_GATE_SUMMARY" ]]; then
  preflight_args+=("--quality-gate-summary=$QUALITY_GATE_SUMMARY")
fi
if [[ -n "$SURVIVOR_CATALOG_MANIFEST" ]]; then
  preflight_args+=("--survivor-catalog-manifest=$SURVIVOR_CATALOG_MANIFEST")
fi
if [[ -n "$EXPECTED_GATE_SHA256" ]]; then
  preflight_args+=("--expected-gate-sha256=$EXPECTED_GATE_SHA256")
fi
if [[ -n "$EXPECTED_CATALOG_SHA256" ]]; then
  preflight_args+=("--expected-catalog-sha256=$EXPECTED_CATALOG_SHA256")
fi
node "${preflight_args[@]}"

node tools/build_tp12_label_events.mjs \
  "--contract-path=$CONTRACT_PATH" \
  "--candle-path=$CANDLE_PATH" \
  "--decision-from=$OOS_FROM" \
  "--decision-to=$OOS_TO" \
  "--label-horizon-to=$LABEL_HORIZON_TO" \
  "--horizon-boundary-policy=skip_cross_boundary" \
  "--terminal-forward-policy=skip_terminal_incomplete_forward" \
  "--out-events=$LABEL_EVENTS" \
  "--out-summary=$LABEL_SUMMARY"

node tools/build_tp12_tokenized_events.mjs \
  "--contract-path=$CONTRACT_PATH" \
  "--label-events=$LABEL_EVENTS" \
  "--candle-path=$CANDLE_PATH" \
  "--universe-path=$UNIVERSE_PATH" \
  "--out-events=$TOKENIZED_EVENTS" \
  "--out-summary=$TOKENIZED_SUMMARY"

node tools/materialize_tp12_candidate_events.mjs \
  "--contract-path=$CONTRACT_PATH" \
  "--candidate-catalog=$GATED_CATALOG" \
  "--tokenized-events=$TOKENIZED_EVENTS" \
  "--date-from=$OOS_FROM" \
  "--date-to=$OOS_TO" \
  "--require-year2hit-passed=true" \
  "--require-candidate-quality-passed=true" \
  "--fail-on-zero-match-candidates=false" \
  "--out-events=$CANDIDATE_EVENTS" \
  "--out-summary=$MATERIALIZE_SUMMARY"

node tools/build_tp12_year2hit_candidate_replay_report.mjs \
  "--candidate-events=$CANDIDATE_EVENTS" \
  "--candidate-catalog=$GATED_CATALOG" \
  "--date-from=$OOS_FROM" \
  "--date-to=$OOS_TO" \
  "--hit-definition=$HIT_DEFINITION" \
  "--hit-field=$HIT_FIELD" \
  "--label-summary=$LABEL_SUMMARY" \
  "--tokenized-summary=$TOKENIZED_SUMMARY" \
  "--materialize-summary=$MATERIALIZE_SUMMARY" \
  "--preflight-summary=$PREFLIGHT_SUMMARY" \
  "--out-summary=$REPLAY_SUMMARY" \
  "--out-report=$REPLAY_REPORT" \
  "--out-symbol-date-union=$SYMBOL_DATE_UNION" \
  "--out-one-pick-per-day=$ONE_PICK_PER_DAY"

if [[ "$RUN_MONTHLY_QUOTA_SCHEDULER" == "true" ]]; then
  [[ "$HIT_DEFINITION" == "operational_hit_v1" ]] || {
    echo "monthly quota scheduler requires --hit-definition=operational_hit_v1" >&2
    exit 4
  }
  [[ "$HIT_FIELD" == "operationalHitTarget" ]] || {
    echo "monthly quota scheduler requires --hit-field=operationalHitTarget" >&2
    exit 4
  }
  [[ -n "$MONTHLY_QUOTA_FULL_MONTH_KEYS" ]] || {
    echo "monthly quota scheduler requires --monthly-quota-full-month-keys" >&2
    exit 4
  }
  node tools/build_tp12_monthly_quota_precision_scheduler.mjs \
    "--candidates=$ONE_PICK_PER_DAY" \
    "--out-summary=$MONTHLY_QUOTA_SUMMARY" \
    "--out-selections=$MONTHLY_QUOTA_SELECTIONS" \
    "--full-month-keys=$MONTHLY_QUOTA_FULL_MONTH_KEYS" \
    "--score-field=schedulerScore" \
    "--fail-on-gate-failure=$MONTHLY_QUOTA_FAIL_ON_GATE_FAILURE"
fi

echo "[done] tp12 year2hit gated catalog OOS replay out=$OUT_ROOT"
