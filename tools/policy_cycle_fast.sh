#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/policy_cycle_fast.sh [ROOT]

Environment:
  CONFIG_REL                  default: config/lab.config.server.lite.json
  RUN_ID                      default: fastcycle_YYYYMMDD_HHMMSS
  DISCOVER_SESSION            default: discover_fast
  SMOKE_SESSION               default: smoke_fast
  CONFIRM_SESSION             default: confirm_fast
  CD_ROUNDS                   default: 2
  CD_MIN_EPOCHS               default: 2
  CD_MAX_EPOCHS               default: 3
  SMOKE_RUNS                  default: 2
  CONFIRM_RUNS                default: 4
  STOP_ON_SMOKE_FAILURE       default: true
  VALIDATION_STAGE_GATE       default: promotion (always|survivor|promotion)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ROOT="${1:-/home/moltook/apps/stockdesk-lab-lite}"
CONFIG_REL="${CONFIG_REL:-config/lab.config.server.lite.json}"
RUN_ID="${RUN_ID:-fastcycle_$(date -u +%Y%m%d_%H%M%S)}"
DISCOVER_SESSION="${DISCOVER_SESSION:-discover_fast}"
SMOKE_SESSION="${SMOKE_SESSION:-smoke_fast}"
CONFIRM_SESSION="${CONFIRM_SESSION:-confirm_fast}"
CD_ROUNDS="${CD_ROUNDS:-2}"
CD_MIN_EPOCHS="${CD_MIN_EPOCHS:-2}"
CD_MAX_EPOCHS="${CD_MAX_EPOCHS:-3}"
SMOKE_RUNS="${SMOKE_RUNS:-2}"
CONFIRM_RUNS="${CONFIRM_RUNS:-4}"
STOP_ON_SMOKE_FAILURE="${STOP_ON_SMOKE_FAILURE:-true}"
VALIDATION_STAGE_GATE="${VALIDATION_STAGE_GATE:-promotion}"
REPLAY_CUMULATIVE_MAX_LINES="${REPLAY_CUMULATIVE_MAX_LINES:-120000}"
MERGE_REPLAY_TOOL="${ROOT}/tools/merge_replay_cumulative.sh"

AUTOPILOT_CHECKPOINT_LATEST_DIR="${ROOT}/artifacts/autopilot/checkpoint_latest"

carry_replay_checkpoint_store() {
  local latest_replay_source="${1:-}"
  local latest_trades_source="${2:-}"
  mkdir -p "${AUTOPILOT_CHECKPOINT_LATEST_DIR}"
  local latest_replay_target="${AUTOPILOT_CHECKPOINT_LATEST_DIR}/lockbox_replay_confirm_latest.jsonl"
  local cumulative_replay_target="${AUTOPILOT_CHECKPOINT_LATEST_DIR}/lockbox_replay_confirm_cumulative.jsonl"
  local cumulative_replay_index_target="${AUTOPILOT_CHECKPOINT_LATEST_DIR}/lockbox_replay_confirm_index.json"
  local latest_trades_target="${AUTOPILOT_CHECKPOINT_LATEST_DIR}/lockbox_trades_confirm_latest.jsonl"

  if [[ -n "${latest_trades_source}" && -f "${latest_trades_source}" ]]; then
    cp -f "${latest_trades_source}" "${latest_trades_target}" 2>/dev/null || true
  fi
  if [[ -n "${latest_replay_source}" && -f "${latest_replay_source}" ]]; then
    cp -f "${latest_replay_source}" "${latest_replay_target}" 2>/dev/null || true
    if [[ -f "${cumulative_replay_target}" ]]; then
      bash "${MERGE_REPLAY_TOOL}" \
        "${cumulative_replay_target}" \
        "${REPLAY_CUMULATIVE_MAX_LINES}" \
        "${cumulative_replay_target}" \
        "${latest_replay_source}"
    else
      bash "${MERGE_REPLAY_TOOL}" \
        "${cumulative_replay_target}" \
        "${REPLAY_CUMULATIVE_MAX_LINES}" \
        "${latest_replay_source}"
    fi
  elif [[ -f "${cumulative_replay_target}" && ! -f "${cumulative_replay_index_target}" ]]; then
    bash "${MERGE_REPLAY_TOOL}" \
      "${cumulative_replay_target}" \
      "${REPLAY_CUMULATIVE_MAX_LINES}" \
      "${cumulative_replay_target}"
  fi
}

SUMMARY_PATH="${ROOT}/artifacts/runs/${RUN_ID}/cd-loop/${DISCOVER_SESSION}/cd_loop_summary.json"
SMOKE_SUMMARY_PATH="${ROOT}/artifacts/runs/${RUN_ID}/smoke-confirm/${SMOKE_SESSION}/smoke_confirm_summary.json"
CONFIRM_SUMMARY_PATH="${ROOT}/artifacts/runs/${RUN_ID}/smoke-confirm/${CONFIRM_SESSION}/smoke_confirm_summary.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "[fatal] jq is required" >&2
  exit 1
fi

normalize_validation_stage_gate() {
  local raw="${1:-promotion}"
  local normalized=""
  normalized="$(printf "%s" "${raw}" | tr '[:upper:]' '[:lower:]')"
  case "${normalized}" in
    always|survivor|promotion)
      printf "%s" "${normalized}"
      ;;
    *)
      printf "promotion"
      ;;
  esac
}

build_skipped_phase_summary() {
  local summary_path="$1"
  local phase="$2"
  local session_id="$3"
  local skip_reason="$4"
  local discover_discard_reason="$5"
  local requested_smoke_runs="$6"
  local requested_confirm_runs="$7"

  mkdir -p "$(dirname "${summary_path}")"
  jq -n \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg runId "${RUN_ID}" \
    --arg sessionId "${session_id}" \
    --arg configPath "${ROOT}/${CONFIG_REL}" \
    --arg phase "${phase}" \
    --arg stopOnSmokeFailure "${STOP_ON_SMOKE_FAILURE}" \
    --arg validationStageGate "${VALIDATION_STAGE_GATE}" \
    --arg reason "${skip_reason}" \
    --arg discoverSummaryPath "${SUMMARY_PATH}" \
    --arg discoverDiscardReason "${discover_discard_reason}" \
    --argjson smokeRunsRequested "${requested_smoke_runs}" \
    --argjson confirmRunsRequested "${requested_confirm_runs}" \
    '{
      mode:"smoke-confirm",
      generatedAt:$ts,
      updatedAt:$ts,
      runId:$runId,
      sessionId:$sessionId,
      configPath:$configPath,
      phase:$phase,
      smokeRunsRequested:$smokeRunsRequested,
      confirmRunsRequested:$confirmRunsRequested,
      stopOnSmokeFailure:($stopOnSmokeFailure=="true"),
      forceStepC:false,
      startWeightsPath:null,
      championBundlePath:null,
      status:"skipped",
      validationStageGate:{
        mode:$validationStageGate,
        eligible:false,
        reason:$reason,
        discoverSummaryPath:$discoverSummaryPath,
        discoverDiscardReason:($discoverDiscardReason | if . == "" then null else . end)
      },
      smoke:{
        requestedRuns:$smokeRunsRequested,
        executedRuns:0,
        stoppedEarly:true,
        stopReason:$reason,
        runs:[],
        aggregate:{
          runCount:0,
          dWallMs:{count:0,min:0,max:0,mean:0},
          eWallMs:{count:0,min:0,max:0,mean:0},
          totalWallMs:{count:0,min:0,max:0,mean:0},
          runtimeCacheHitRate:0,
          workerPoolCacheHitRate:0,
          lockboxArtifactCacheHitRate:0,
          decisionStable:false,
          distinctStepDSignatures:0,
          distinctStepESignatures:0,
          distinctStepDWeightsPaths:0,
          distinctStepDWeightsHashes:0,
          stableStepDWeightsHash:null,
          stepDWeightsStable:false,
          stableStepDWeightsPath:null,
          stableStepDMetrics:null,
          stableStepEMetrics:null,
          confirmedWeightsPath:null,
          confirmedWeightsHash:null,
          confirmedStepDMetrics:null,
          confirmedStepEMetrics:null,
          lastStepDWeightsPath:null,
          lastStepDMetrics:null,
          lastStepEMetrics:null,
          sanityPass:false,
          lockboxGate:{available:false,runCount:0,eligibleCount:0,eligibleRate:0,allEligible:false,reasonCounts:{},last:null},
          validationGate:{
            eligible:false,
            reason:$reason,
            checks:{hasRuns:false,sanityPass:false,decisionStable:false,lockboxGateAvailable:false,lockboxGateEligible:false},
            metrics:{runCount:0,eligibleCount:0,eligibleRate:0,distinctFailureReasons:0}
          },
          validationStageGate:{
            mode:$validationStageGate,
            eligible:false,
            reason:$reason,
            discoverSummaryPath:$discoverSummaryPath,
            discoverDiscardReason:($discoverDiscardReason | if . == "" then null else . end)
          }
        }
      },
      confirm:{
        requestedRuns:$confirmRunsRequested,
        executedRuns:0,
        stoppedEarly:true,
        stopReason:$reason,
        runs:[],
        aggregate:{
          runCount:0,
          dWallMs:{count:0,min:0,max:0,mean:0},
          eWallMs:{count:0,min:0,max:0,mean:0},
          totalWallMs:{count:0,min:0,max:0,mean:0},
          runtimeCacheHitRate:0,
          workerPoolCacheHitRate:0,
          lockboxArtifactCacheHitRate:0,
          decisionStable:false,
          distinctStepDSignatures:0,
          distinctStepESignatures:0,
          distinctStepDWeightsPaths:0,
          distinctStepDWeightsHashes:0,
          stableStepDWeightsHash:null,
          stepDWeightsStable:false,
          stableStepDWeightsPath:null,
          stableStepDMetrics:null,
          stableStepEMetrics:null,
          confirmedWeightsPath:null,
          confirmedWeightsHash:null,
          confirmedStepDMetrics:null,
          confirmedStepEMetrics:null,
          lastStepDWeightsPath:null,
          lastStepDMetrics:null,
          lastStepEMetrics:null,
          sanityPass:false,
          lockboxGate:{available:false,runCount:0,eligibleCount:0,eligibleRate:0,allEligible:false,reasonCounts:{},last:null},
          validationGate:{
            eligible:false,
            reason:$reason,
            checks:{hasRuns:false,sanityPass:false,decisionStable:false,lockboxGateAvailable:false,lockboxGateEligible:false},
            metrics:{runCount:0,eligibleCount:0,eligibleRate:0,distinctFailureReasons:0}
          },
          validationStageGate:{
            mode:$validationStageGate,
            eligible:false,
            reason:$reason,
            discoverSummaryPath:$discoverSummaryPath,
            discoverDiscardReason:($discoverDiscardReason | if . == "" then null else . end)
          }
        }
      }
    }' > "${summary_path}"
}

resolve_validation_stage_decision() {
  local summary_path="$1"
  local c_gate_failed=""
  local line_discarded=""
  local discard_reason=""
  local promotion_eligible=""

  c_gate_failed="$(jq -r '.cGate.failed // false' "${summary_path}" 2>/dev/null || true)"
  line_discarded="$(jq -r '.researchGate.lineDiscarded // false' "${summary_path}" 2>/dev/null || true)"
  discard_reason="$(jq -r '.discardReason // .researchGate.discardReason // empty' "${summary_path}" 2>/dev/null || true)"
  promotion_eligible="$(jq -r '.promotionGate.eligible // false' "${summary_path}" 2>/dev/null || true)"

  case "${VALIDATION_STAGE_GATE}" in
    always)
      printf "true|PASS|%s\n" "${discard_reason}"
      ;;
    survivor)
      if [[ "${c_gate_failed}" == "true" ]]; then
        printf "false|C_GATE_FAILED|%s\n" "${discard_reason:-C_GATE_FAILED}"
        return
      fi
      if [[ "${line_discarded}" == "true" ]]; then
        printf "false|%s|%s\n" "${discard_reason:-RESEARCH_GATE_DISCARDED}" "${discard_reason:-RESEARCH_GATE_DISCARDED}"
        return
      fi
      printf "true|PASS|%s\n" "${discard_reason:-LINE_ACCEPTED}"
      ;;
    promotion)
      if [[ "${promotion_eligible}" == "true" ]]; then
        printf "true|PASS|%s\n" "${discard_reason:-LINE_ACCEPTED}"
        return
      fi
      if [[ "${c_gate_failed}" == "true" ]]; then
        printf "false|C_GATE_FAILED|%s\n" "${discard_reason:-C_GATE_FAILED}"
        return
      fi
      if [[ "${line_discarded}" == "true" ]]; then
        printf "false|%s|%s\n" "${discard_reason:-RESEARCH_GATE_DISCARDED}" "${discard_reason:-RESEARCH_GATE_DISCARDED}"
        return
      fi
      printf "false|SKIPPED_UNTIL_PROMOTION_GATE|%s\n" "${discard_reason:-LINE_ACCEPTED}"
      ;;
  esac
}

VALIDATION_STAGE_GATE="$(normalize_validation_stage_gate "${VALIDATION_STAGE_GATE}")"

cd "${ROOT}"

echo "[run] discover: run_id=${RUN_ID} session=${DISCOVER_SESSION} rounds=${CD_ROUNDS} min_epochs=${CD_MIN_EPOCHS} max_epochs=${CD_MAX_EPOCHS}"
NO_KIS=1 BACKFILL_DISABLE_KIS=1 BACKFILL_KIS_ENABLED=0 \
  npm run lab:cd-loop -- \
  --config="${CONFIG_REL}" \
  --run-id="${RUN_ID}" \
  --session-id="${DISCOVER_SESSION}" \
  --rounds="${CD_ROUNDS}" \
  --min-epochs="${CD_MIN_EPOCHS}" \
  --max-epochs="${CD_MAX_EPOCHS}"

if [[ ! -f "${SUMMARY_PATH}" ]]; then
  echo "[fatal] cd-loop summary missing: ${SUMMARY_PATH}" >&2
  exit 1
fi

validation_stage_gate_result="$(resolve_validation_stage_decision "${SUMMARY_PATH}")"
IFS='|' read -r validation_stage_eligible validation_stage_reason discover_discard_reason <<< "${validation_stage_gate_result}"
if [[ "${validation_stage_eligible}" != "true" ]]; then
  echo "[skip] validation stage gate=${VALIDATION_STAGE_GATE} reason=${validation_stage_reason} discoverDiscardReason=${discover_discard_reason:-null}"
  build_skipped_phase_summary \
    "${SMOKE_SUMMARY_PATH}" \
    "smoke" \
    "${SMOKE_SESSION}" \
    "${validation_stage_reason}" \
    "${discover_discard_reason}" \
    "${SMOKE_RUNS}" \
    "0"
  build_skipped_phase_summary \
    "${CONFIRM_SUMMARY_PATH}" \
    "confirm" \
    "${CONFIRM_SESSION}" \
    "${validation_stage_reason}" \
    "${discover_discard_reason}" \
    "0" \
    "${CONFIRM_RUNS}"
  echo "[ok] policy cycle discover-only complete: ${RUN_ID}"
  echo "[ok] cd_summary=${SUMMARY_PATH}"
  echo "[ok] smoke_summary=${SMOKE_SUMMARY_PATH}"
  echo "[ok] confirm_summary=${CONFIRM_SUMMARY_PATH}"
  exit 0
fi

CHAMPION_BUNDLE_PATH="$(jq -r '.championBundlePath // empty' "${SUMMARY_PATH}")"
if [[ -z "${CHAMPION_BUNDLE_PATH}" || "${CHAMPION_BUNDLE_PATH}" == "null" || ! -f "${CHAMPION_BUNDLE_PATH}" ]]; then
  echo "[fatal] no champion bundle path found in ${SUMMARY_PATH}" >&2
  exit 1
fi

echo "[run] smoke: bundle=${CHAMPION_BUNDLE_PATH} runs=${SMOKE_RUNS}"
NO_KIS=1 BACKFILL_DISABLE_KIS=1 BACKFILL_KIS_ENABLED=0 \
  npm run lab:smoke-confirm -- \
  --config="${CONFIG_REL}" \
  --run-id="${RUN_ID}" \
  --session-id="${SMOKE_SESSION}" \
  --phase=smoke \
  --smoke-runs="${SMOKE_RUNS}" \
  --stop-on-smoke-failure="${STOP_ON_SMOKE_FAILURE}" \
  --champion-bundle-path="${CHAMPION_BUNDLE_PATH}"

if [[ ! -f "${SMOKE_SUMMARY_PATH}" ]]; then
  echo "[fatal] smoke summary missing: ${SMOKE_SUMMARY_PATH}" >&2
  exit 1
fi

SMOKE_VALIDATION="$(jq -r '.smoke.aggregate.validationGate.eligible // false' "${SMOKE_SUMMARY_PATH}")"
SMOKE_REASON="$(jq -r '.smoke.aggregate.validationGate.reason // "SMOKE_VALIDATION_UNKNOWN"' "${SMOKE_SUMMARY_PATH}")"
if [[ "${SMOKE_VALIDATION}" != "true" ]]; then
  echo "[stop] smoke failed validation gate: reason=${SMOKE_REASON}. skip confirm." >&2
  exit 2
fi

echo "[run] confirm: bundle=${CHAMPION_BUNDLE_PATH} runs=${CONFIRM_RUNS}"
NO_KIS=1 BACKFILL_DISABLE_KIS=1 BACKFILL_KIS_ENABLED=0 \
  npm run lab:smoke-confirm -- \
  --config="${CONFIG_REL}" \
  --run-id="${RUN_ID}" \
  --session-id="${CONFIRM_SESSION}" \
  --phase=confirm \
  --confirm-runs="${CONFIRM_RUNS}" \
  --champion-bundle-path="${CHAMPION_BUNDLE_PATH}"

if [[ ! -f "${CONFIRM_SUMMARY_PATH}" ]]; then
  echo "[fatal] confirm summary missing: ${CONFIRM_SUMMARY_PATH}" >&2
  exit 1
fi

CONFIRM_REPLAY_PATH="$(jq -r '.confirm.runs[-1].stepE.replayFeedbackPath // empty' "${CONFIRM_SUMMARY_PATH}")"
CONFIRM_TRADES_PATH="$(jq -r '.confirm.runs[-1].stepE.tradesPath // empty' "${CONFIRM_SUMMARY_PATH}")"
CONFIRM_WEIGHTS_PATH="$(jq -r '.confirm.aggregate.confirmedWeightsPath // empty' "${CONFIRM_SUMMARY_PATH}")"
carry_replay_checkpoint_store "${CONFIRM_REPLAY_PATH}" "${CONFIRM_TRADES_PATH}"

CONFIRM_VALIDATION="$(jq -r '.confirm.aggregate.validationGate.eligible // false' "${CONFIRM_SUMMARY_PATH}")"
CONFIRM_REASON="$(jq -r '.confirm.aggregate.validationGate.reason // "CONFIRM_VALIDATION_UNKNOWN"' "${CONFIRM_SUMMARY_PATH}")"
if [[ "${CONFIRM_VALIDATION}" != "true" ]]; then
  echo "[stop] confirm failed validation gate: reason=${CONFIRM_REASON}." >&2
  exit 3
fi
if [[ -z "${CONFIRM_WEIGHTS_PATH}" || ! -f "${CONFIRM_WEIGHTS_PATH}" ]]; then
  echo "[fatal] confirm validated but confirmedWeightsPath missing." >&2
  exit 1
fi

echo "[ok] policy cycle complete: ${RUN_ID}"
echo "[ok] cd_summary=${SUMMARY_PATH}"
echo "[ok] champion_bundle=${CHAMPION_BUNDLE_PATH}"
echo "[ok] smoke_summary=${SMOKE_SUMMARY_PATH}"
echo "[ok] confirm_summary=${CONFIRM_SUMMARY_PATH}"
if [[ -n "${CONFIRM_WEIGHTS_PATH}" && "${CONFIRM_WEIGHTS_PATH}" != "null" ]]; then
  echo "[ok] confirm_weights=${CONFIRM_WEIGHTS_PATH}"
fi
