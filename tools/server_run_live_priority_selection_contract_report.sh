#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
LIB_PATH="$ROOT_DIR/tools/lib_stepb_dplus1_baseline_wrapper.sh"
DEFAULT_CONFIG_PATH="config/lab.config.server.lite.stepb_dplus1_plus_lite.json"
DEFAULT_REGISTRY_PATH="config/ops/live_priority_registry.server.json"
DEFAULT_RUN_ID="live_priority_selection_contract_replay_v61r_$(date +%Y%m%d_%H%M%S)"
DEFAULT_INCLUDE_LINE_IDS="1d_primary,1d_secondary,7d_primary,7d_secondary,8d_primary,8d_secondary"
EXPECTED_BASELINE_LINE_ID="stepb_dplus1_plus_lite"
EXPECTED_CONTEXT_SURFACE="v3_contextual_plus_lite"
EXPECTED_MAX_GAP_TRADING_DAYS="100000"

ROOT_REAL="$(cd "$ROOT_DIR" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  echo "[fatal] server_run_live_priority_selection_contract_report.sh must run from $EXPECTED_REAL, got $ROOT_REAL" >&2
  exit 4
fi

RUN_ID="$DEFAULT_RUN_ID"
CONFIG_PATH="$DEFAULT_CONFIG_PATH"
REGISTRY_PATH="$DEFAULT_REGISTRY_PATH"
INCLUDE_LINE_IDS="$DEFAULT_INCLUDE_LINE_IDS"
TRAIN_START="2020-11-27"
TRAIN_END="2024-12-31"
OOS_START="2025-01-01"
OOS_END="2026-01-31"
RECENT_START="2026-02-02"
RECENT_END="2026-03-17"
CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"

for arg in "$@"; do
  case "$arg" in
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --config=*) CONFIG_PATH="${arg#*=}" ;;
    --registry=*) REGISTRY_PATH="${arg#*=}" ;;
    --include-line-ids=*) INCLUDE_LINE_IDS="${arg#*=}" ;;
    --train-start=*) TRAIN_START="${arg#*=}" ;;
    --train-end=*) TRAIN_END="${arg#*=}" ;;
    --oos-start=*) OOS_START="${arg#*=}" ;;
    --oos-end=*) OOS_END="${arg#*=}" ;;
    --recent-start=*) RECENT_START="${arg#*=}" ;;
    --recent-end=*) RECENT_END="${arg#*=}" ;;
    --candle-path=*) CANDLE_PATH="${arg#*=}" ;;
    *) echo "[fatal] unknown arg: $arg" >&2; exit 4 ;;
  esac
done

if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
fi
if [[ "$REGISTRY_PATH" != /* ]]; then
  REGISTRY_PATH="$ROOT_DIR/$REGISTRY_PATH"
fi
if [[ "$CANDLE_PATH" != /* ]]; then
  CANDLE_PATH="$ROOT_DIR/$CANDLE_PATH"
fi

[[ -f "$CONFIG_PATH" ]] || { echo "[fatal] config not found: $CONFIG_PATH" >&2; exit 4; }
[[ -f "$REGISTRY_PATH" ]] || { echo "[fatal] registry not found: $REGISTRY_PATH" >&2; exit 4; }
[[ -f "$CANDLE_PATH" ]] || { echo "[fatal] candle file not found: $CANDLE_PATH" >&2; exit 4; }
[[ -f "$LIB_PATH" ]] || { echo "[fatal] baseline wrapper helper library not found: $LIB_PATH" >&2; exit 4; }
source "$LIB_PATH"

validate_baseline_contract_config "$CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
REPORT_DIR="$RUN_DIR/step-live-priority-selection-contract-report"
SCOPE_MANIFEST_PATH="$RUN_DIR/selection_contract_scope_manifest.json"
mkdir -p "$RUN_DIR" "$REPORT_DIR"

while IFS=$'\t' read -r scope_id discovery_universe_id lookback_days; do
  [[ -n "$scope_id" ]] || continue
  TRAIN_CONFIG_PATH="$RUN_DIR/${scope_id}_train_runtime_config.json"
  OOS_CONFIG_PATH="$RUN_DIR/${scope_id}_oos_runtime_config.json"
  RECENT_CONFIG_PATH="$RUN_DIR/${scope_id}_recent_runtime_config.json"
  TRAIN_STEPA_RUN_ID="${RUN_ID}_${scope_id}_train_stepa"
  OOS_STEPA_RUN_ID="${RUN_ID}_${scope_id}_oos_stepa"
  RECENT_STEPA_RUN_ID="${RUN_ID}_${scope_id}_recent_stepa"
  TRAIN_STEPA_DIR="$ROOT_DIR/artifacts/runs/$TRAIN_STEPA_RUN_ID/step-a"
  OOS_STEPA_DIR="$ROOT_DIR/artifacts/runs/$OOS_STEPA_RUN_ID/step-a"
  RECENT_STEPA_DIR="$ROOT_DIR/artifacts/runs/$RECENT_STEPA_RUN_ID/step-a"
  TRAIN_PACK_DIR="$RUN_DIR/${scope_id}_train_pack"
  OOS_PACK_DIR="$RUN_DIR/${scope_id}_oos_pack"
  RECENT_PACK_DIR="$RUN_DIR/${scope_id}_recent_pack"

  write_period_config "$CONFIG_PATH" "$TRAIN_CONFIG_PATH" "$TRAIN_START" "$TRAIN_END" "strict_label_boundary"
  write_period_config "$CONFIG_PATH" "$OOS_CONFIG_PATH" "$OOS_START" "$OOS_END" "strict_label_boundary"
  write_period_config "$CONFIG_PATH" "$RECENT_CONFIG_PATH" "$RECENT_START" "$RECENT_END" "strict_label_boundary"
  rewrite_recent_impulse_runtime_config "$TRAIN_CONFIG_PATH" "$lookback_days"
  rewrite_recent_impulse_runtime_config "$OOS_CONFIG_PATH" "$lookback_days"
  rewrite_recent_impulse_runtime_config "$RECENT_CONFIG_PATH" "$lookback_days"
  validate_baseline_contract_config "$TRAIN_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
  validate_baseline_contract_config "$OOS_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
  validate_baseline_contract_config "$RECENT_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
  validate_recent_impulse_runtime_config "$TRAIN_CONFIG_PATH" "$lookback_days"
  validate_recent_impulse_runtime_config "$OOS_CONFIG_PATH" "$lookback_days"
  validate_recent_impulse_runtime_config "$RECENT_CONFIG_PATH" "$lookback_days"

  eval "$(
    node --input-type=module - "$discovery_universe_id" "$lookback_days" <<'NODE'
import { resolvePerfectPrototypeDiscoveryUniverse } from "./src/lib/perfect_prototype_multiline_contract.mjs"
const [discoveryUniverseId, requestedLookbackTradingDaysRaw] = process.argv.slice(2)
const contract = resolvePerfectPrototypeDiscoveryUniverse({
  discoveryUniverseId,
  requestedLookbackTradingDays: Number(requestedLookbackTradingDaysRaw),
})
console.log(`ENABLED_RECENT_IMPULSE_LANES=${contract.enabledRecentImpulseLanes.join(",")}`)
console.log(`ALLOWED_STEPA_LANES=${contract.allowedStepALanes.join(",")}`)
NODE
  )"

  node "$ROOT_DIR/src/cli.mjs" step-a --config="$TRAIN_CONFIG_PATH" --run-id="$TRAIN_STEPA_RUN_ID"
  node "$ROOT_DIR/src/cli.mjs" step-a --config="$OOS_CONFIG_PATH" --run-id="$OOS_STEPA_RUN_ID"
  node "$ROOT_DIR/src/cli.mjs" step-a --config="$RECENT_CONFIG_PATH" --run-id="$RECENT_STEPA_RUN_ID"

  COMMON_ARGS=(
    --surface-name="$EXPECTED_CONTEXT_SURFACE"
    --source-type=perfect_prototype_daily_pack
    --line-id="$EXPECTED_BASELINE_LINE_ID"
    --requested-lookback-trading-days="$lookback_days"
  )

  node "$ROOT_DIR/tools/build_perfect_prototype_daily_pack.mjs" \
    --config="$TRAIN_CONFIG_PATH" \
    --out-dir="$TRAIN_PACK_DIR" \
    --start="$TRAIN_START" \
    --end="$TRAIN_END" \
    --discovery-universe-id="$discovery_universe_id" \
    --seed-input="$TRAIN_STEPA_DIR/events_high8_lite.jsonl" \
    --enabled-recent-impulse-lanes="$ENABLED_RECENT_IMPULSE_LANES" \
    --allowed-stepa-lanes="$ALLOWED_STEPA_LANES" \
    "${COMMON_ARGS[@]}"

  node "$ROOT_DIR/tools/build_perfect_prototype_daily_pack.mjs" \
    --config="$OOS_CONFIG_PATH" \
    --out-dir="$OOS_PACK_DIR" \
    --start="$OOS_START" \
    --end="$OOS_END" \
    --discovery-universe-id="$discovery_universe_id" \
    --seed-input="$OOS_STEPA_DIR/events_high8_lite.jsonl" \
    --enabled-recent-impulse-lanes="$ENABLED_RECENT_IMPULSE_LANES" \
    --allowed-stepa-lanes="$ALLOWED_STEPA_LANES" \
    "${COMMON_ARGS[@]}"

  node "$ROOT_DIR/tools/build_perfect_prototype_daily_pack.mjs" \
    --config="$RECENT_CONFIG_PATH" \
    --out-dir="$RECENT_PACK_DIR" \
    --start="$RECENT_START" \
    --end="$RECENT_END" \
    --discovery-universe-id="$discovery_universe_id" \
    --seed-input="$RECENT_STEPA_DIR/events_high8_lite.jsonl" \
    --enabled-recent-impulse-lanes="$ENABLED_RECENT_IMPULSE_LANES" \
    --allowed-stepa-lanes="$ALLOWED_STEPA_LANES" \
    "${COMMON_ARGS[@]}"

  apply_strict_label_boundary_to_daily_pack "$TRAIN_PACK_DIR" "$TRAIN_START" "$TRAIN_END" "strict_label_boundary"
  apply_strict_label_boundary_to_daily_pack "$OOS_PACK_DIR" "$OOS_START" "$OOS_END" "strict_label_boundary"
  apply_strict_label_boundary_to_daily_pack "$RECENT_PACK_DIR" "$RECENT_START" "$RECENT_END" "strict_label_boundary"
done < <(
  node --input-type=module - "$REGISTRY_PATH" "$INCLUDE_LINE_IDS" <<'NODE'
import fs from "node:fs/promises"
const [registryPath, includeLineIdsRaw] = process.argv.slice(2)
const registry = JSON.parse(await fs.readFile(registryPath, "utf8"))
const includeLineIds = String(includeLineIdsRaw ?? "").split(",").map((entry) => entry.trim()).filter(Boolean)
const lines = Array.isArray(registry?.lines) ? registry.lines : []
const selectedLines = includeLineIds.map((lineId) => {
  const line = lines.find((entry) => String(entry?.lineId ?? "").trim() === lineId)
  if (!line) throw new Error(`registry missing requested lineId=${lineId}`)
  if (line.enabled !== true) throw new Error(`requested lineId=${lineId} is not enabled in registry`)
  if (String(line?.runnerType ?? "").trim() !== "plus_lite_same_day_recent") {
    throw new Error(`lineId=${lineId} has unsupported runnerType=${line?.runnerType ?? "null"} for v61r wrapper`)
  }
  return line
})
const seen = new Set()
for (const line of selectedLines) {
  const lookbackDays = Number(line?.lookbackTradingDays ?? 0)
  const discoveryUniverseId = String(line?.discoveryUniverseId ?? "").trim()
  const scopeId = `${discoveryUniverseId}__lb${lookbackDays}`
  if (seen.has(scopeId)) continue
  seen.add(scopeId)
  console.log([scopeId, discoveryUniverseId, String(lookbackDays)].join("\t"))
}
NODE
)

node --input-type=module - "$REGISTRY_PATH" "$INCLUDE_LINE_IDS" "$RUN_DIR" "$SCOPE_MANIFEST_PATH" <<'NODE'
import fs from "node:fs/promises"
import path from "node:path"
const [registryPath, includeLineIdsRaw, runDir, outPath] = process.argv.slice(2)
const registry = JSON.parse(await fs.readFile(registryPath, "utf8"))
const includeLineIds = String(includeLineIdsRaw ?? "").split(",").map((entry) => entry.trim()).filter(Boolean)
const lines = Array.isArray(registry?.lines) ? registry.lines : []
const selectedLines = includeLineIds.map((lineId) => {
  const line = lines.find((entry) => String(entry?.lineId ?? "").trim() === lineId)
  if (!line) throw new Error(`registry missing requested lineId=${lineId}`)
  if (String(line?.runnerType ?? "").trim() !== "plus_lite_same_day_recent") {
    throw new Error(`lineId=${lineId} has unsupported runnerType=${line?.runnerType ?? "null"} for v61r wrapper`)
  }
  return line
})
const scopes = []
const scopeById = new Map()
for (const line of selectedLines) {
  const lookbackTradingDays = Number(line?.lookbackTradingDays ?? 0)
  const discoveryUniverseId = String(line?.discoveryUniverseId ?? "").trim()
  const scopeId = `${discoveryUniverseId}__lb${lookbackTradingDays}`
  if (!scopeById.has(scopeId)) {
    const scope = {
      scopeId,
      discoveryUniverseId,
      lookbackTradingDays,
      trainInput: path.join(runDir, `${scopeId}_train_pack`, "daily_pack.jsonl"),
      oosInput: path.join(runDir, `${scopeId}_oos_pack`, "daily_pack.jsonl"),
      recentInput: path.join(runDir, `${scopeId}_recent_pack`, "daily_pack.jsonl"),
    }
    scopes.push(scope)
    scopeById.set(scopeId, scope)
  }
}
const manifest = {
  version: 1,
  registryPath,
  includeLineIds,
  scopes,
  lines: selectedLines.map((line) => ({
    lineId: line.lineId,
    priority: line.priority,
    lineOrder: line.lineOrder,
    lineRole: line.lineRole,
    status: line.status,
    reportLabel: line.reportLabel,
    runnerType: line.runnerType,
    selectionMode: line.selectionMode,
    excludeRecommendationCloseRetPctGte: line.excludeRecommendationCloseRetPctGte,
    catalogLabel: line.catalogLabel,
    catalogPath: line.catalogPath,
    expectedCatalogSha256: line.expectedCatalogSha256,
    expectedRuleIdsSha256: line.expectedRuleIdsSha256,
    scopeId: `${String(line.discoveryUniverseId)}__lb${Number(line.lookbackTradingDays ?? 0)}`,
  })),
}
await fs.writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
NODE

node "$ROOT_DIR/tools/build_live_priority_selection_contract_report.mjs" \
  --registry="$REGISTRY_PATH" \
  --scope-manifest="$SCOPE_MANIFEST_PATH" \
  --out-dir="$REPORT_DIR" \
  --candle-path="$CANDLE_PATH"

echo "[ok] v61r live selection-contract replay complete"
echo "runId=$RUN_ID"
echo "reportDir=$REPORT_DIR"
