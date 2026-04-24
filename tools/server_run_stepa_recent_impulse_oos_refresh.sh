#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONFIG="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite.json"
DEFAULT_RUN_ID="stepa_recent_impulse_upto_1d_oos_refresh_$(date +%Y%m%d_%H%M%S)"
EXPECTED_BASELINE_LINE_ID="${STEPB_PLUS_LITE_WRAPPER_LINE_ID:-stepb_dplus1_plus_lite}"
EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS="100000"
EXPECTED_CONTEXT_SURFACE="${STEPB_PLUS_LITE_WRAPPER_CONTEXT_SURFACE:-v3_contextual_plus_lite}"
LIB_PATH="$ROOT_DIR/tools/lib_stepb_dplus1_baseline_wrapper.sh"
CONFIG_DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS="3"

CONFIG_PATH="$DEFAULT_CONFIG"
RUN_ID="$DEFAULT_RUN_ID"
SPLIT_POLICY="decision_date_only"
OOS_START="2025-01-01"
OOS_END="2026-01-31"
DISCOVERY_UNIVERSE_ID="recent_impulse_upto_1d"
RECENT_IMPULSE_LOOKBACK_DAYS="1"
SUMMARY_OUT=""

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<EOF
Usage: bash tools/server_run_stepa_recent_impulse_oos_refresh.sh [options]

Server-only wrapper that rebuilds a fresh recent-impulse OOS Step A artifact against the
current canonical candle calendar so downstream TP12 intraday manifests can fail-fast
against current truth instead of stale historical Step A outputs.

Options:
  --config=PATH                         Base config path. Default: $DEFAULT_CONFIG
  --run-id=ID                          Output Step A run id. Default: $DEFAULT_RUN_ID
  --split-policy=decision_date_only|strict_label_boundary
                                       Baseline split policy written into the runtime config.
                                       Default: decision_date_only
  --oos-start=YYYY-MM-DD               OOS discovery start. Default: $OOS_START
  --oos-end=YYYY-MM-DD                 OOS discovery end. Default: $OOS_END
  --discovery-universe-id=ID           Discovery universe id. Default: $DISCOVERY_UNIVERSE_ID
  --recent-impulse-lookback-days=N     Explicit recent impulse lookback. Default: $RECENT_IMPULSE_LOOKBACK_DAYS
  --summary-out=PATH                   Optional summary output path. Default:
                                       artifacts/runs/<run-id>/step-a_refresh_summary.json
EOF
}

for arg in "$@"; do
  case "$arg" in
    --config=*) CONFIG_PATH="${arg#*=}" ;;
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --split-policy=*) SPLIT_POLICY="${arg#*=}" ;;
    --oos-start=*) OOS_START="${arg#*=}" ;;
    --oos-end=*) OOS_END="${arg#*=}" ;;
    --discovery-universe-id=*) DISCOVERY_UNIVERSE_ID="${arg#*=}" ;;
    --recent-impulse-lookback-days=*) RECENT_IMPULSE_LOOKBACK_DAYS="${arg#*=}" ;;
    --summary-out=*) SUMMARY_OUT="${arg#*=}" ;;
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
  fatal "server-only recent-impulse Step A refresh wrapper must run from $EXPECTED_REAL, got $ROOT_REAL"
fi

if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
fi
[[ -f "$CONFIG_PATH" ]] || fatal "config not found: $CONFIG_PATH"
[[ -f "$LIB_PATH" ]] || fatal "shared Step-B baseline helper library not found: $LIB_PATH"

case "$SPLIT_POLICY" in
  decision_date_only|strict_label_boundary) ;;
  *) fatal "invalid --split-policy: $SPLIT_POLICY" ;;
esac

for value in "$OOS_START" "$OOS_END"; do
  [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fatal "invalid date: $value"
done
if [[ "$OOS_START" > "$OOS_END" ]]; then
  fatal "invalid OOS range: oos-start ($OOS_START) must be <= oos-end ($OOS_END)"
fi
if ! [[ "$RECENT_IMPULSE_LOOKBACK_DAYS" =~ ^[0-9]+$ ]]; then
  fatal "recent impulse lookback must be an integer: $RECENT_IMPULSE_LOOKBACK_DAYS"
fi

source "$LIB_PATH"

validate_baseline_contract_config "$CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
validate_recent_impulse_runtime_config "$CONFIG_PATH" "$CONFIG_DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS"

eval "$(
  node --input-type=module - "$DISCOVERY_UNIVERSE_ID" "$RECENT_IMPULSE_LOOKBACK_DAYS" <<'NODE'
import { resolvePerfectPrototypeDiscoveryUniverse } from "./src/lib/perfect_prototype_multiline_contract.mjs"

const [discoveryUniverseId, requestedLookbackTradingDaysRaw] = process.argv.slice(2)
const requestedLookbackTradingDays = Number(requestedLookbackTradingDaysRaw)
const contract = resolvePerfectPrototypeDiscoveryUniverse({
  discoveryUniverseId,
  requestedLookbackTradingDays,
})
if (contract.usesStepASeedInput !== true) {
  throw new Error(
    `recent-impulse Step A refresh requires a Step-A-seeded discovery universe, got ${discoveryUniverseId}`,
  )
}
console.log(`ENABLED_RECENT_IMPULSE_LANES=${contract.enabledRecentImpulseLanes.join(",")}`)
console.log(`ALLOWED_STEPA_LANES=${contract.allowedStepALanes.join(",")}`)
NODE
)"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
RUNTIME_CONFIG_PATH="$RUN_DIR/oos_runtime_config.json"
STEP_A_DIR="$RUN_DIR/step-a"
EVENTS_PATH="$STEP_A_DIR/events_high8_lite.jsonl"
STEP_A_SUMMARY_PATH="$STEP_A_DIR/step_a_summary.json"
if [[ -n "$SUMMARY_OUT" ]]; then
  if [[ "$SUMMARY_OUT" != /* ]]; then
    SUMMARY_OUT="$ROOT_DIR/$SUMMARY_OUT"
  fi
else
  SUMMARY_OUT="$RUN_DIR/step-a_refresh_summary.json"
fi

if [[ -e "$RUN_DIR" ]]; then
  fatal "run dir already exists: $RUN_DIR"
fi
mkdir -p "$RUN_DIR"

write_period_config "$CONFIG_PATH" "$RUNTIME_CONFIG_PATH" "$OOS_START" "$OOS_END" "$SPLIT_POLICY"
rewrite_recent_impulse_runtime_config "$RUNTIME_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"
validate_baseline_contract_config "$RUNTIME_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
validate_recent_impulse_runtime_config "$RUNTIME_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"

CONFIG_SHA256="$(compute_sha256 "$CONFIG_PATH")"
RUNTIME_CONFIG_SHA256="$(compute_sha256 "$RUNTIME_CONFIG_PATH")"

node src/cli.mjs step-a --config="$RUNTIME_CONFIG_PATH" --run-id="$RUN_ID"

[[ -f "$EVENTS_PATH" ]] || fatal "step-a refresh did not produce events file: $EVENTS_PATH"
[[ -f "$STEP_A_SUMMARY_PATH" ]] || fatal "step-a refresh did not produce summary file: $STEP_A_SUMMARY_PATH"

node --input-type=module - "$EVENTS_PATH" "$STEP_A_SUMMARY_PATH" "$SUMMARY_OUT" "$RUN_ID" "$CONFIG_PATH" "$CONFIG_SHA256" "$RUNTIME_CONFIG_PATH" "$RUNTIME_CONFIG_SHA256" "$DISCOVERY_UNIVERSE_ID" "$RECENT_IMPULSE_LOOKBACK_DAYS" "$ENABLED_RECENT_IMPULSE_LANES" "$ALLOWED_STEPA_LANES" "$OOS_START" "$OOS_END" "$SPLIT_POLICY" <<'NODE'
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import readline from "node:readline"

const [
  eventsPath,
  stepASummaryPath,
  summaryOut,
  runId,
  configPath,
  configSha256,
  runtimeConfigPath,
  runtimeConfigSha256,
  discoveryUniverseId,
  lookbackRaw,
  enabledRecentImpulseLanesRaw,
  allowedStepALanesRaw,
  oosStart,
  oosEnd,
  splitPolicy,
] = process.argv.slice(2)
const recentImpulseLookbackTradingDays = Number(lookbackRaw)
const enabledRecentImpulseLanes = String(enabledRecentImpulseLanesRaw ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
const allowedStepALanes = String(allowedStepALanesRaw ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)

const laneCounts = {}
let eventCount = 0
let decisionDateFrom = null
let decisionDateTo = null

const rl = readline.createInterface({
  input: fs.createReadStream(eventsPath),
  crlfDelay: Infinity,
})
for await (const rawLine of rl) {
  const line = String(rawLine ?? "").trim()
  if (!line) continue
  const row = JSON.parse(line)
  const decisionDateKey = String(row?.decisionDateKey ?? row?.dateKey ?? "").trim()
  const stepALaneId = String(row?.stepALaneId ?? "").trim()
  if (!decisionDateKey) {
    throw new Error(`missing decision date key (decisionDateKey/dateKey) in ${eventsPath}`)
  }
  eventCount += 1
  if (!decisionDateFrom || decisionDateKey < decisionDateFrom) decisionDateFrom = decisionDateKey
  if (!decisionDateTo || decisionDateKey > decisionDateTo) decisionDateTo = decisionDateKey
  laneCounts[stepALaneId || "unknown"] = (laneCounts[stepALaneId || "unknown"] ?? 0) + 1
}
if (eventCount < 1) {
  throw new Error(`step-a refresh produced zero rows: ${eventsPath}`)
}

const stepASummary = JSON.parse(await fsp.readFile(stepASummaryPath, "utf8"))
const payload = {
  generatedAt: new Date().toISOString(),
  runId,
  discoveryUniverseId,
  recentImpulseLookbackTradingDays,
  enabledRecentImpulseLanes,
  allowedStepALanes,
  splitPolicy,
  oosWindow: {
    start: oosStart,
    end: oosEnd,
  },
  configPath,
  configSha256,
  runtimeConfigPath,
  runtimeConfigSha256,
  stepADir: path.dirname(eventsPath),
  eventsPath,
  stepASummaryPath,
  eventCount,
  decisionDateFrom,
  decisionDateTo,
  laneCounts,
  sourceStepASummary: stepASummary,
}
await fsp.mkdir(path.dirname(summaryOut), { recursive: true })
await fsp.writeFile(summaryOut, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
NODE

echo "[ok] recent-impulse OOS Step A refresh complete"
echo "runId=$RUN_ID"
echo "eventsPath=$EVENTS_PATH"
echo "summaryOut=$SUMMARY_OUT"
