#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONFIG="$ROOT/config/lab.config.server.lite.stepb_dplus1_plus_lite.json"
DEFAULT_CONTRACT_PATH="meta/tp12_side_daily_research_contract.json"
DEFAULT_RUN_ID="tp12_side_daily_control_inputs_$(date +%Y%m%d_%H%M%S)"
EXPECTED_BASELINE_LINE_ID="${STEPB_PLUS_LITE_WRAPPER_LINE_ID:-stepb_dplus1_plus_lite}"
EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS="100000"
EXPECTED_CONTEXT_SURFACE="${STEPB_PLUS_LITE_WRAPPER_CONTEXT_SURFACE:-v3_contextual_plus_lite}"
OPEN_PACK_NODE_HEAP_MB="6144"
LIB_PATH="$ROOT/tools/lib_stepb_dplus1_baseline_wrapper.sh"

run_open_pack_node() {
  NODE_OPTIONS="--max-old-space-size=$OPEN_PACK_NODE_HEAP_MB ${NODE_OPTIONS:-}" node "$@"
}

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'EOF'
Usage: bash tools/run_tp12_side_daily_control_inputs.sh [options]

Server-only builder for the first 2016-floor TP12 side-daily control inputs.
It builds:
  1. fresh broad train/oos Step A (if discovery universe requires seed input)
  2. fresh broad open train/oos daily packs
  3. a combined control-input daily pack for tools/build_tp12_side_daily_control.mjs

Options:
  --config=PATH
  --contract-path=PATH
  --run-id=ID
  --split-policy=strict_label_boundary|decision_date_only
  --train-start=YYYY-MM-DD
  --train-end=YYYY-MM-DD
  --oos-start=YYYY-MM-DD
  --oos-end=YYYY-MM-DD
  --discovery-universe-id=ID
  --recent-impulse-lookback-days=N
  --skip-coverage-floor-check
EOF
}

CONFIG_PATH="$DEFAULT_CONFIG"
CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
RUN_ID="$DEFAULT_RUN_ID"
SPLIT_POLICY="strict_label_boundary"
TRAIN_START=""
TRAIN_END=""
OOS_START=""
OOS_END=""
DISCOVERY_UNIVERSE_ID="recent_impulse_upto_1d"
RECENT_IMPULSE_LOOKBACK_DAYS="1"
SKIP_COVERAGE_FLOOR_CHECK=0

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --config=*)
      CONFIG_PATH="${1#*=}"
      shift
      ;;
    --contract-path=*)
      CONTRACT_PATH="${1#*=}"
      shift
      ;;
    --run-id=*)
      RUN_ID="${1#*=}"
      shift
      ;;
    --split-policy=*)
      SPLIT_POLICY="${1#*=}"
      shift
      ;;
    --train-start=*)
      TRAIN_START="${1#*=}"
      shift
      ;;
    --train-end=*)
      TRAIN_END="${1#*=}"
      shift
      ;;
    --oos-start=*)
      OOS_START="${1#*=}"
      shift
      ;;
    --oos-end=*)
      OOS_END="${1#*=}"
      shift
      ;;
    --discovery-universe-id=*)
      DISCOVERY_UNIVERSE_ID="${1#*=}"
      shift
      ;;
    --recent-impulse-lookback-days=*)
      RECENT_IMPULSE_LOOKBACK_DAYS="${1#*=}"
      shift
      ;;
    --skip-coverage-floor-check)
      SKIP_COVERAGE_FLOOR_CHECK=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown arg: ${1}" >&2
      exit 1
      ;;
  esac
done

cd "$ROOT"

ROOT_REAL="$(cd "$ROOT" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  fatal "tp12 side-daily control inputs must run from $EXPECTED_REAL, got $ROOT_REAL"
fi

if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$ROOT/$CONFIG_PATH"
fi
if [[ "$CONTRACT_PATH" != /* ]]; then
  CONTRACT_PATH="$ROOT/$CONTRACT_PATH"
fi
[[ -f "$CONFIG_PATH" ]] || fatal "config not found: $CONFIG_PATH"
[[ -f "$CONTRACT_PATH" ]] || fatal "contract not found: $CONTRACT_PATH"
[[ -f "$LIB_PATH" ]] || fatal "shared Step-B baseline helper library not found: $LIB_PATH"

case "$SPLIT_POLICY" in
  strict_label_boundary|decision_date_only) ;;
  *) fatal "invalid --split-policy: $SPLIT_POLICY" ;;
esac

source "$LIB_PATH"

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
  throw new Error(`invalid Step-B recentImpulseDiscovery.lookbackTradingDays in config: ${configPath}`)
}
console.log(String(lookback))
NODE
)"

eval "$(
  node --input-type=module - "$CONTRACT_PATH" "$TRAIN_START" "$TRAIN_END" "$OOS_START" "$OOS_END" <<'NODE'
import { loadTp12SideDailyResearchContract } from "./src/lib/tp12_side_daily_contract.mjs"

const [contractPath, trainStartRaw, trainEndRaw, oosStartRaw, oosEndRaw] = process.argv.slice(2)
const contract = await loadTp12SideDailyResearchContract({ contractPath, cwd: process.cwd() })
const pick = (direct, fallback) => {
  const text = String(direct ?? "").trim()
  return text || String(fallback ?? "").trim()
}
console.log(`RESOLVED_TRAIN_START=${pick(trainStartRaw, contract.control?.trainDateFrom)}`)
console.log(`RESOLVED_TRAIN_END=${pick(trainEndRaw, contract.control?.trainDateTo)}`)
console.log(`RESOLVED_OOS_START=${pick(oosStartRaw, contract.control?.oosDateFrom)}`)
console.log(`RESOLVED_OOS_END=${pick(oosEndRaw, contract.control?.oosDateTo)}`)
console.log(`CONTRACT_ID=${String(contract.contractId ?? "").trim()}`)
NODE
)"

TRAIN_START="$RESOLVED_TRAIN_START"
TRAIN_END="$RESOLVED_TRAIN_END"
OOS_START="$RESOLVED_OOS_START"
OOS_END="$RESOLVED_OOS_END"

for value in "$TRAIN_START" "$TRAIN_END" "$OOS_START" "$OOS_END"; do
  [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fatal "invalid date: $value"
done
if [[ "$TRAIN_START" > "$TRAIN_END" ]]; then
  fatal "invalid train range: $TRAIN_START > $TRAIN_END"
fi
if [[ "$OOS_START" > "$OOS_END" ]]; then
  fatal "invalid oos range: $OOS_START > $OOS_END"
fi
if [[ ! "$TRAIN_END" < "$OOS_START" ]]; then
  fatal "train/oos ranges must not overlap: trainEnd=$TRAIN_END oosStart=$OOS_START"
fi

TRAIN_WARMUP_DAY="$(date -I -d "$TRAIN_START - 1 day")"
OOS_WARMUP_DAY="$(date -I -d "$OOS_START - 1 day")"

validate_baseline_contract_config "$CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
validate_recent_impulse_runtime_config "$CONFIG_PATH" "$CONFIG_DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS"

write_control_input_period_config() {
  local base_config="$1"
  local out_config="$2"
  local warmup_day="$3"
  local from_date="$4"
  local to_date="$5"
  local split_policy="$6"
  node --input-type=module - "$base_config" "$out_config" "$warmup_day" "$from_date" "$to_date" "$split_policy" <<'NODE'
import fs from "node:fs/promises"
import path from "node:path"

import { loadConfig, resolvePeriods } from "./src/lib/config.mjs"

const [configPath, outPath, warmupDay, fromDate, toDate, splitPolicy] = process.argv.slice(2)
const { config } = await loadConfig({
  configPath,
  cwd: process.cwd(),
})
const periods = resolvePeriods(config)
const next = {
  ...config,
  periods: {
    warmup: {
      from: warmupDay,
      to: warmupDay,
    },
    discovery: {
      from: fromDate,
      to: toDate,
    },
    online: periods.online,
    lockbox: periods.lockbox,
  },
  lightweight: {
    ...(config?.lightweight ?? {}),
    stepB: {
      ...(config?.lightweight?.stepB ?? {}),
      perfectPrototypeBaseline: {
        ...(config?.lightweight?.stepB?.perfectPrototypeBaseline ?? {}),
        enabled: true,
        splitPolicy,
      },
    },
  },
}
await fs.mkdir(path.dirname(outPath), { recursive: true })
await fs.writeFile(outPath, `${JSON.stringify(next, null, 2)}\n`, "utf8")
NODE
}

RUN_DIR="$ROOT/artifacts/runs/$RUN_ID"
TRAIN_CONFIG_PATH="$RUN_DIR/train_runtime_config.json"
OOS_CONFIG_PATH="$RUN_DIR/oos_runtime_config.json"
TRAIN_STEPA_RUN_ID="${RUN_ID}_train_stepa"
OOS_STEPA_RUN_ID="${RUN_ID}_oos_stepa"
TRAIN_STEPA_DIR="$ROOT/artifacts/runs/$TRAIN_STEPA_RUN_ID/step-a"
OOS_STEPA_DIR="$ROOT/artifacts/runs/$OOS_STEPA_RUN_ID/step-a"
TRAIN_PACK_DIR="$RUN_DIR/step-perfect-prototype-open-train-pack"
OOS_PACK_DIR="$RUN_DIR/step-perfect-prototype-open-oos-pack"
CONTROL_INPUT_DIR="$RUN_DIR/step-perfect-prototype-open-control-input-pack"
CONTROL_INPUT_PATH="$CONTROL_INPUT_DIR/daily_pack.jsonl"
CONTROL_INPUT_SUMMARY_PATH="$CONTROL_INPUT_DIR/control_input_summary.json"
PIPELINE_SUMMARY_PATH="$RUN_DIR/control_input_pipeline_summary.json"

if [[ -e "$RUN_DIR" ]]; then
  fatal "run dir already exists: $RUN_DIR"
fi
mkdir -p "$RUN_DIR" "$CONTROL_INPUT_DIR"

write_control_input_period_config "$CONFIG_PATH" "$TRAIN_CONFIG_PATH" "$TRAIN_WARMUP_DAY" "$TRAIN_START" "$TRAIN_END" "$SPLIT_POLICY"
write_control_input_period_config "$CONFIG_PATH" "$OOS_CONFIG_PATH" "$OOS_WARMUP_DAY" "$OOS_START" "$OOS_END" "$SPLIT_POLICY"
rewrite_recent_impulse_runtime_config "$TRAIN_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"
rewrite_recent_impulse_runtime_config "$OOS_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"
validate_baseline_contract_config "$TRAIN_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
validate_baseline_contract_config "$OOS_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
validate_recent_impulse_runtime_config "$TRAIN_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"
validate_recent_impulse_runtime_config "$OOS_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"

eval "$(
  node --input-type=module - "$DISCOVERY_UNIVERSE_ID" "$RECENT_IMPULSE_LOOKBACK_DAYS" <<'NODE'
import { resolvePerfectPrototypeDiscoveryUniverse } from "./src/lib/perfect_prototype_multiline_contract.mjs"

const [discoveryUniverseId, requestedLookbackTradingDaysRaw] = process.argv.slice(2)
const requestedLookbackTradingDays = Number(requestedLookbackTradingDaysRaw)
const contract = resolvePerfectPrototypeDiscoveryUniverse({
  discoveryUniverseId,
  requestedLookbackTradingDays,
})
console.log(`ENABLED_RECENT_IMPULSE_LANES=${contract.enabledRecentImpulseLanes.join(",")}`)
console.log(`ALLOWED_STEPA_LANES=${contract.allowedStepALanes.join(",")}`)
console.log(`USES_STEPA_SEED_INPUT=${contract.usesStepASeedInput ? 1 : 0}`)
NODE
)"

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
  ln -sfn "$TRAIN_STEPA_DIR" "$RUN_DIR/step-a-train"
  ln -sfn "$OOS_STEPA_DIR" "$RUN_DIR/step-a-oos"
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
run_open_pack_node tools/build_perfect_prototype_daily_pack.mjs "${OOS_PACK_ARGS[@]}"
apply_strict_label_boundary_to_daily_pack "$OOS_PACK_DIR" "$OOS_START" "$OOS_END" "$SPLIT_POLICY"

ln -sfn "$TRAIN_PACK_DIR" "$RUN_DIR/step-perfect-prototype-open-train-pack"
ln -sfn "$OOS_PACK_DIR" "$RUN_DIR/step-perfect-prototype-open-oos-pack"

node tools/build_tp12_side_daily_control_input_pack.mjs \
  "--train-pack-path=$TRAIN_PACK_DIR/daily_pack.jsonl" \
  "--oos-pack-path=$OOS_PACK_DIR/daily_pack.jsonl" \
  "--out=$CONTROL_INPUT_PATH" \
  "--summary-out=$CONTROL_INPUT_SUMMARY_PATH"

if (( SKIP_COVERAGE_FLOOR_CHECK == 0 )); then
  node --input-type=module - "$CONTROL_INPUT_SUMMARY_PATH" "$TRAIN_START" <<'NODE'
import fs from "node:fs/promises"

const [summaryPath, trainStart] = process.argv.slice(2)
const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"))
const decisionDateFrom = String(summary?.decisionDateFrom ?? "").trim()
if (!decisionDateFrom) {
  throw new Error(`control input summary missing decisionDateFrom: ${summaryPath}`)
}
if (decisionDateFrom > trainStart) {
  throw new Error(
    `control input pack does not reach requested train floor: requested=${trainStart} actual=${decisionDateFrom}`,
  )
}
NODE
fi

node --input-type=module - "$PIPELINE_SUMMARY_PATH" "$RUN_ID" "$CONTRACT_ID" "$CONFIG_PATH" "$CONTRACT_PATH" "$TRAIN_CONFIG_PATH" "$OOS_CONFIG_PATH" "$TRAIN_PACK_DIR" "$OOS_PACK_DIR" "$CONTROL_INPUT_PATH" "$CONTROL_INPUT_SUMMARY_PATH" "$TRAIN_START" "$TRAIN_END" "$OOS_START" "$OOS_END" "$DISCOVERY_UNIVERSE_ID" "$RECENT_IMPULSE_LOOKBACK_DAYS" "$SPLIT_POLICY" <<'NODE'
import fs from "node:fs/promises"

const [
  outPath,
  runId,
  contractId,
  configPath,
  contractPath,
  trainConfigPath,
  oosConfigPath,
  trainPackDir,
  oosPackDir,
  controlInputPath,
  controlInputSummaryPath,
  trainStart,
  trainEnd,
  oosStart,
  oosEnd,
  discoveryUniverseId,
  recentImpulseLookbackDaysRaw,
  splitPolicy,
] = process.argv.slice(2)

const payload = {
  generatedAt: new Date().toISOString(),
  runId,
  contractId,
  configPath,
  contractPath,
  trainConfigPath,
  oosConfigPath,
  trainPackDir,
  oosPackDir,
  controlInputPath,
  controlInputSummaryPath,
  splitPolicy,
  discoveryUniverseId,
  recentImpulseLookbackDays: Number(recentImpulseLookbackDaysRaw),
  trainWindow: {
    start: trainStart,
    end: trainEnd,
  },
  oosWindow: {
    start: oosStart,
    end: oosEnd,
  },
}
await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
NODE

echo "DONE run_tp12_side_daily_control_inputs runId=$RUN_ID"
echo "controlInputPath=$CONTROL_INPUT_PATH"
echo "controlInputSummaryPath=$CONTROL_INPUT_SUMMARY_PATH"
