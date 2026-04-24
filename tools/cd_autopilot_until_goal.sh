#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-/home/moltook/apps/stockdesk-lab-lite}"
CONFIG_REL="${CONFIG_REL:-config/lab.config.server.lite.json}"
CONFIG_PATH="${ROOT}/${CONFIG_REL}"

AUTOPILOT_DIR="${ROOT}/artifacts/autopilot"
LOG_DIR="${AUTOPILOT_DIR}/logs"
CHECKPOINT_DIR="${AUTOPILOT_DIR}/checkpoints"
STATUS_LOG="${AUTOPILOT_DIR}/cd_autopilot_status.jsonl"
STATE_PATH="${AUTOPILOT_DIR}/cd_autopilot_state.json"
PID_PATH="${AUTOPILOT_DIR}/cd_autopilot.pid"
LOCK_PATH="${AUTOPILOT_DIR}/cd_autopilot.lock"
ENV_SNAPSHOT_PATH="${AUTOPILOT_DIR}/cd_autopilot_env_snapshot.json"
LATEST_WEIGHTS_COPY="${AUTOPILOT_DIR}/champion_weights_latest.json"
LATEST_SNAPSHOT_COPY="${AUTOPILOT_DIR}/champion_snapshot_latest.json"
LATEST_CHECKPOINT_LINK="${AUTOPILOT_DIR}/checkpoint_latest"
CHECKPOINT_KEEP="${CHECKPOINT_KEEP:-40}"

GOAL_PICK_HIT_RATE="${GOAL_PICK_HIT_RATE:-0.60}"
GOAL_PICKED_COUNT="${GOAL_PICKED_COUNT:-60}"
GOAL_CONFIRM_WIN_RATE="${GOAL_CONFIRM_WIN_RATE:-${GOAL_PICK_HIT_RATE}}"
GOAL_CONFIRM_TRADES="${GOAL_CONFIRM_TRADES:-${GOAL_PICKED_COUNT}}"
GOAL_TOP1_TO_ORACLE_CONVERSION="${GOAL_TOP1_TO_ORACLE_CONVERSION:-0.35}"
CONVERSION_LAG_TRIGGER="${CONVERSION_LAG_TRIGGER:-0.28}"
ORACLE_TOPK_STRONG_FLOOR="${ORACLE_TOPK_STRONG_FLOOR:-0.90}"
ORACLE_DISCOVERY_ENABLED="${ORACLE_DISCOVERY_ENABLED:-1}"
ORACLE_DISCOVERY_TOPK_TARGET="${ORACLE_DISCOVERY_TOPK_TARGET:-0.93}"
ORACLE_DISCOVERY_GOAL_TOPK_TARGET="${ORACLE_DISCOVERY_GOAL_TOPK_TARGET:-0.95}"
ORACLE_DISCOVERY_SUSTAIN_RUNS="${ORACLE_DISCOVERY_SUSTAIN_RUNS:-2}"
ORACLE_DISCOVERY_REBUILD_C_ROUNDS="${ORACLE_DISCOVERY_REBUILD_C_ROUNDS:-1}"
ORACLE_FREEZE_REBUILD_C_ROUNDS="${ORACLE_FREEZE_REBUILD_C_ROUNDS:-999}"
ORACLE_DISCOVERY_MIN_EPOCHS_PER_ROUND="${ORACLE_DISCOVERY_MIN_EPOCHS_PER_ROUND:-2}"
ORACLE_DISCOVERY_MAX_EPOCHS_PER_ROUND="${ORACLE_DISCOVERY_MAX_EPOCHS_PER_ROUND:-3}"
ORACLE_DISCOVERY_LEARNING_RATE="${ORACLE_DISCOVERY_LEARNING_RATE:-0.0}"
ORACLE_FREEZE_MIN_EPOCHS_PER_ROUND="${ORACLE_FREEZE_MIN_EPOCHS_PER_ROUND:-3}"
ORACLE_FREEZE_MAX_EPOCHS_PER_ROUND="${ORACLE_FREEZE_MAX_EPOCHS_PER_ROUND:-8}"
ORACLE_FREEZE_LEARNING_RATE="${ORACLE_FREEZE_LEARNING_RATE:-0.02}"
LOOP_SLEEP_SEC="${LOOP_SLEEP_SEC:-8}"
FAIL_BACKOFF_SEC="${FAIL_BACKOFF_SEC:-20}"
PROMOTION_HIT_BAND="${PROMOTION_HIT_BAND:-0.01}"
MARGIN_SIGNAL_CONFIRM="${MARGIN_SIGNAL_CONFIRM:-2}"
MARGIN_UPPER_BOUND_DEFAULT="${MARGIN_UPPER_BOUND_DEFAULT:-0.08}"
ENABLE_AGGRESSIVE_C_WHEN_HIT_LAGS="${ENABLE_AGGRESSIVE_C_WHEN_HIT_LAGS:-1}"
REBUILD_C_STAGNATION_BASE="${REBUILD_C_STAGNATION_BASE:-3}"
REBUILD_C_STAGNATION_AGGRESSIVE="${REBUILD_C_STAGNATION_AGGRESSIVE:-1}"
SECOND_PICK_STRONG_RATE_GAP="${SECOND_PICK_STRONG_RATE_GAP:-0.08}"
SECOND_PICK_STRONG_COUNT_SURPLUS="${SECOND_PICK_STRONG_COUNT_SURPLUS:-10}"
SECOND_PICK_VERY_STRONG_RATE_GAP="${SECOND_PICK_VERY_STRONG_RATE_GAP:-0.20}"
SECOND_PICK_VERY_STRONG_COUNT_SURPLUS="${SECOND_PICK_VERY_STRONG_COUNT_SURPLUS:-20}"
SWEEP_MIN_RATE_GAIN_AGGRESSIVE="${SWEEP_MIN_RATE_GAIN_AGGRESSIVE:-0.03}"
SWEEP_MIN_HIT_COUNT_GAIN_AGGRESSIVE="${SWEEP_MIN_HIT_COUNT_GAIN_AGGRESSIVE:-2}"
RUNS_KEEP="${RUNS_KEEP:-20}"
DISK_WARN_GB="${DISK_WARN_GB:-25}"
DISK_CLEANUP_GB="${DISK_CLEANUP_GB:-15}"
DISK_PAUSE_GB="${DISK_PAUSE_GB:-10}"
DISK_TARGET_GB="${DISK_TARGET_GB:-30}"
SPEED_WARN_MS_PER_SEED="${SPEED_WARN_MS_PER_SEED:-1.30}"
SPEED_HARD_MS_PER_SEED="${SPEED_HARD_MS_PER_SEED:-1.45}"
AUTOPILOT_FORCE_SINGLE_PICK="${AUTOPILOT_FORCE_SINGLE_PICK:-1}"
SUMMARY_MISSING_MAX_STREAK="${SUMMARY_MISSING_MAX_STREAK:-3}"
FAST_DISCOVER_ROUNDS="${FAST_DISCOVER_ROUNDS:-2}"
FAST_MIN_EPOCHS="${FAST_MIN_EPOCHS:-2}"
FAST_MAX_EPOCHS="${FAST_MAX_EPOCHS:-3}"
FAST_SMOKE_RUNS="${FAST_SMOKE_RUNS:-2}"
FAST_CONFIRM_RUNS="${FAST_CONFIRM_RUNS:-4}"
FAST_STOP_ON_SMOKE_FAILURE="${FAST_STOP_ON_SMOKE_FAILURE:-true}"
FAST_VALIDATION_STAGE_GATE="${FAST_VALIDATION_STAGE_GATE:-promotion}"
REPLAY_CUMULATIVE_MAX_LINES="${REPLAY_CUMULATIVE_MAX_LINES:-120000}"
MERGE_REPLAY_TOOL="${ROOT}/tools/merge_replay_cumulative.sh"

mkdir -p "${AUTOPILOT_DIR}" "${LOG_DIR}" "${CHECKPOINT_DIR}"

if ! command -v jq >/dev/null 2>&1; then
  echo "[fatal] jq is required but not found" >&2
  exit 1
fi

if ! command -v flock >/dev/null 2>&1; then
  echo "[fatal] flock is required but not found" >&2
  exit 1
fi

carry_replay_checkpoint_store() {
  local checkpoint_path="$1"
  local latest_replay_source="${2:-}"
  local latest_trades_source="${3:-}"
  local previous_dir="${LATEST_CHECKPOINT_LINK}"
  local previous_latest_replay="${previous_dir}/lockbox_replay_confirm_latest.jsonl"
  local previous_cumulative_replay="${previous_dir}/lockbox_replay_confirm_cumulative.jsonl"
  local previous_cumulative_index="${previous_dir}/lockbox_replay_confirm_index.json"
  local previous_latest_trades="${previous_dir}/lockbox_trades_confirm_latest.jsonl"
  local new_latest_replay="${checkpoint_path}/lockbox_replay_confirm_latest.jsonl"
  local new_cumulative_replay="${checkpoint_path}/lockbox_replay_confirm_cumulative.jsonl"
  local new_cumulative_index="${checkpoint_path}/lockbox_replay_confirm_index.json"
  local new_latest_trades="${checkpoint_path}/lockbox_trades_confirm_latest.jsonl"
  if [[ -n "${latest_trades_source}" && -f "${latest_trades_source}" ]]; then
    cp -f "${latest_trades_source}" "${new_latest_trades}" 2>/dev/null || true
  elif [[ -f "${previous_latest_trades}" ]]; then
    cp -f "${previous_latest_trades}" "${new_latest_trades}" 2>/dev/null || true
  fi

  if [[ -n "${latest_replay_source}" && -f "${latest_replay_source}" ]]; then
    cp -f "${latest_replay_source}" "${new_latest_replay}" 2>/dev/null || true
    if [[ -f "${previous_cumulative_replay}" ]]; then
      bash "${MERGE_REPLAY_TOOL}" \
        "${new_cumulative_replay}" \
        "${REPLAY_CUMULATIVE_MAX_LINES}" \
        "${previous_cumulative_replay}" \
        "${latest_replay_source}"
    else
      bash "${MERGE_REPLAY_TOOL}" \
        "${new_cumulative_replay}" \
        "${REPLAY_CUMULATIVE_MAX_LINES}" \
        "${latest_replay_source}"
    fi
  else
    if [[ -f "${previous_latest_replay}" ]]; then
      cp -f "${previous_latest_replay}" "${new_latest_replay}" 2>/dev/null || true
    fi
    if [[ -f "${previous_cumulative_replay}" ]]; then
      cp -f "${previous_cumulative_replay}" "${new_cumulative_replay}" 2>/dev/null || true
      if [[ -f "${previous_cumulative_index}" ]]; then
        cp -f "${previous_cumulative_index}" "${new_cumulative_index}" 2>/dev/null || true
      else
        bash "${MERGE_REPLAY_TOOL}" \
          "${new_cumulative_replay}" \
          "${REPLAY_CUMULATIVE_MAX_LINES}" \
          "${new_cumulative_replay}"
      fi
    elif [[ -f "${previous_latest_replay}" ]]; then
      tail -n "${REPLAY_CUMULATIVE_MAX_LINES}" "${previous_latest_replay}" > "${new_cumulative_replay}" || true
      bash "${MERGE_REPLAY_TOOL}" \
        "${new_cumulative_replay}" \
        "${REPLAY_CUMULATIVE_MAX_LINES}" \
        "${new_cumulative_replay}"
    fi
  fi
}

exec {LOCK_FD}> "${LOCK_PATH}"
if ! flock -n "${LOCK_FD}"; then
  echo "[fatal] autopilot lock busy: ${LOCK_PATH}" >&2
  exit 1
fi

ACTIVE_RUN_PGID=""

is_ancestor_pid() {
  local target="$1"
  local cursor="$$"
  while [[ -n "${cursor}" && "${cursor}" -gt 1 ]]; do
    if [[ "${cursor}" == "${target}" ]]; then
      return 0
    fi
    cursor="$(ps -o ppid= -p "${cursor}" 2>/dev/null | awk '{print $1}' || true)"
  done
  return 1
}

collect_stale_autopilot_runner_pids() {
  local pid
  local cmdline
  local etimes
  local found=""
  for pid in $(pgrep -f 'cd_autopilot_until_goal.sh' 2>/dev/null || true); do
    if [[ -z "${pid}" ]]; then
      continue
    fi
    if is_ancestor_pid "${pid}"; then
      continue
    fi
    if [[ ! -r "/proc/${pid}/cmdline" ]]; then
      continue
    fi
    cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
    if [[ -z "${cmdline}" ]]; then
      continue
    fi
    if [[ "${cmdline}" == *"bash -c "* || "${cmdline}" == *"sh -c "* ]]; then
      etimes="$(ps -o etimes= -p "${pid}" 2>/dev/null | awk '{print int($1)}' || echo 0)"
      if [[ "${etimes:-0}" -lt 120 ]]; then
        continue
      fi
    fi
    if [[ "${cmdline}" == *"${ROOT}/tools/cd_autopilot_until_goal.sh"* || "${cmdline}" == *"tools/cd_autopilot_until_goal.sh"* ]]; then
      found+="${pid}"$'\n'
    fi
  done
  if [[ -n "${found}" ]]; then
    printf "%s" "${found}" | sort -n | uniq
  fi
}

cleanup_stale_autopilot_runners() {
  local stale_pids=()
  local alive_pids=()
  mapfile -t stale_pids < <(collect_stale_autopilot_runner_pids)
  if [[ "${#stale_pids[@]}" -lt 1 ]]; then
    return
  fi
  echo "[$(date +"%Y-%m-%dT%H:%M:%S%z")] [warn] stale autopilot runners found. terminating: ${stale_pids[*]}" >&2
  kill "${stale_pids[@]}" >/dev/null 2>&1 || true
  sleep 2
  mapfile -t alive_pids < <(collect_stale_autopilot_runner_pids)
  if [[ "${#alive_pids[@]}" -gt 0 ]]; then
    echo "[$(date +"%Y-%m-%dT%H:%M:%S%z")] [warn] force kill stale autopilot runners: ${alive_pids[*]}" >&2
    kill -9 "${alive_pids[@]}" >/dev/null 2>&1 || true
  fi
}

collect_stale_cd_auto_pids() {
  local pid
  local cmdline
  local found=""
  for pid in $(pgrep -f 'cd_auto_|policy_cycle_fast.sh' 2>/dev/null || true); do
    if [[ -z "${pid}" || "${pid}" == "$$" ]]; then
      continue
    fi
    if [[ ! -r "/proc/${pid}/cmdline" ]]; then
      continue
    fi
    cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
    if [[ -z "${cmdline}" ]]; then
      continue
    fi
    if [[ "${cmdline}" == *"src/cli.mjs cd-loop"* || "${cmdline}" == *"npm run lab:cd-loop"* || "${cmdline}" == *"src/cli.mjs smoke-confirm"* || "${cmdline}" == *"npm run lab:smoke-confirm"* || "${cmdline}" == *"tools/policy_cycle_fast.sh"* ]]; then
      found+="${pid}"$'\n'
    fi
  done
  if [[ -n "${found}" ]]; then
    printf "%s" "${found}" | sort -n | uniq
  fi
}

cleanup_stale_cd_auto_processes() {
  local stale_pids=()
  local alive_pids=()
  mapfile -t stale_pids < <(collect_stale_cd_auto_pids)
  if [[ "${#stale_pids[@]}" -lt 1 ]]; then
    return
  fi
  echo "[$(date +"%Y-%m-%dT%H:%M:%S%z")] [warn] stale cd-auto processes found. terminating: ${stale_pids[*]}" >&2
  kill "${stale_pids[@]}" >/dev/null 2>&1 || true
  sleep 2
  mapfile -t alive_pids < <(collect_stale_cd_auto_pids)
  if [[ "${#alive_pids[@]}" -gt 0 ]]; then
    echo "[$(date +"%Y-%m-%dT%H:%M:%S%z")] [warn] force kill stale cd-auto processes: ${alive_pids[*]}" >&2
    kill -9 "${alive_pids[@]}" >/dev/null 2>&1 || true
  fi
}

cleanup_active_run_group() {
  local pgid="${ACTIVE_RUN_PGID:-}"
  if [[ -z "${pgid}" ]]; then
    return
  fi
  if ps -p "${pgid}" >/dev/null 2>&1; then
    kill -TERM -- "-${pgid}" >/dev/null 2>&1 || true
    sleep 2
    if ps -p "${pgid}" >/dev/null 2>&1; then
      kill -KILL -- "-${pgid}" >/dev/null 2>&1 || true
    fi
  fi
  ACTIVE_RUN_PGID=""
}

on_exit() {
  cleanup_active_run_group
  rm -f "${PID_PATH}"
  flock -u "${LOCK_FD}" >/dev/null 2>&1 || true
}

cleanup_stale_autopilot_runners
if [[ -f "${PID_PATH}" ]]; then
  old_pid="$(cat "${PID_PATH}" 2>/dev/null || true)"
  if [[ -n "${old_pid}" && "${old_pid}" != "$$" ]] && ps -p "${old_pid}" >/dev/null 2>&1; then
    echo "[$(date +"%Y-%m-%dT%H:%M:%S%z")] [warn] replacing stale pid file owner pid=${old_pid}" >&2
    kill "${old_pid}" >/dev/null 2>&1 || true
    sleep 2
    if ps -p "${old_pid}" >/dev/null 2>&1; then
      kill -9 "${old_pid}" >/dev/null 2>&1 || true
    fi
  fi
fi
echo "$$" > "${PID_PATH}"
trap on_exit EXIT INT TERM

cleanup_stale_cd_auto_processes

timestamp() {
  date +"%Y-%m-%dT%H:%M:%S%z"
}

float_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN { exit (a+0 >= b+0 ? 0 : 1) }'
}

float_gt() {
  awk -v a="$1" -v b="$2" 'BEGIN { exit (a+0 > b+0 ? 0 : 1) }'
}

float_eq() {
  awk -v a="$1" -v b="$2" 'BEGIN { d=a-b; if (d<0) d=-d; exit (d <= 1e-12 ? 0 : 1) }'
}

resolve_abs_path() {
  local raw="${1:-}"
  if [[ -z "${raw}" || "${raw}" == "null" ]]; then
    echo ""
    return
  fi
  if [[ "${raw}" == /* ]]; then
    echo "${raw}"
    return
  fi
  echo "${ROOT}/${raw}"
}

resolve_primary_validation_metric_names() {
  local goal_mode=""
  if [[ -f "${CONFIG_PATH}" ]]; then
    goal_mode="$(jq -r '.backtest.goalMode // .lockboxGate.goalMode // empty' "${CONFIG_PATH}" 2>/dev/null || true)"
  fi
  goal_mode="$(printf "%s" "${goal_mode}" | tr '[:lower:]' '[:upper:]')"
  if [[ "${goal_mode}" == "TARGET_FIRST_V2" ]]; then
    printf "target_hit_rate|target_hit_count"
    return
  fi
  printf "win_rate|total_trades"
}

read_confirm_primary_metric_name() {
  local summary_path="${1:-}"
  if [[ -z "${summary_path}" || ! -f "${summary_path}" ]]; then
    printf "%s" "${PRIMARY_VALIDATION_METRIC_NAME:-win_rate}"
    return
  fi
  jq -r '
    .confirm.aggregate.confirmedStepEMetrics.primaryMetric
    // (
      (.confirm.aggregate.confirmedStepEMetrics.goalMode // "" | ascii_upcase)
      | if . == "TARGET_FIRST_V2" then "target_hit_rate" else empty end
    )
    // "win_rate"
  ' "${summary_path}" 2>/dev/null || printf "%s" "${PRIMARY_VALIDATION_METRIC_NAME:-win_rate}"
}

read_confirm_primary_rate() {
  local summary_path="${1:-}"
  if [[ -z "${summary_path}" || ! -f "${summary_path}" ]]; then
    printf "0"
    return
  fi
  jq -r '
    .confirm.aggregate.confirmedStepEMetrics.primaryRate
    // .confirm.aggregate.confirmedStepEMetrics.targetHitRate
    // .confirm.aggregate.confirmedStepEMetrics.winRate
    // 0
  ' "${summary_path}" 2>/dev/null || printf "0"
}

read_confirm_primary_count() {
  local summary_path="${1:-}"
  if [[ -z "${summary_path}" || ! -f "${summary_path}" ]]; then
    printf "0"
    return
  fi
  jq -r '
    .confirm.aggregate.confirmedStepEMetrics.primaryCount
    // .confirm.aggregate.confirmedStepEMetrics.targetHitCount
    // .confirm.aggregate.confirmedStepEMetrics.totalTrades
    // 0
  ' "${summary_path}" 2>/dev/null || printf "0"
}

read_state_primary_metric_name() {
  local state_path="${1:-}"
  if [[ -z "${state_path}" || ! -f "${state_path}" ]]; then
    printf "%s" "${PRIMARY_VALIDATION_METRIC_NAME:-win_rate}"
    return
  fi
  jq -r '
    .globalBest.stepE.primaryMetric
    // (
      (.globalBest.stepE.goalMode // "" | ascii_upcase)
      | if . == "TARGET_FIRST_V2" then "target_hit_rate" else empty end
    )
    // .goal.stepE.primaryMetric
    // "win_rate"
  ' "${state_path}" 2>/dev/null || printf "%s" "${PRIMARY_VALIDATION_METRIC_NAME:-win_rate}"
}

read_state_primary_rate() {
  local state_path="${1:-}"
  if [[ -z "${state_path}" || ! -f "${state_path}" ]]; then
    printf "0"
    return
  fi
  jq -r '
    .globalBest.stepE.primaryRate
    // .globalBest.stepE.targetHitRate
    // .globalBest.stepE.winRate
    // .globalBest.pickHitRate
    // .lastBestPickHitRate
    // 0
  ' "${state_path}" 2>/dev/null || printf "0"
}

read_state_primary_count() {
  local state_path="${1:-}"
  if [[ -z "${state_path}" || ! -f "${state_path}" ]]; then
    printf "0"
    return
  fi
  jq -r '
    .globalBest.stepE.primaryCount
    // .globalBest.stepE.targetHitCount
    // .globalBest.stepE.totalTrades
    // .globalBest.pickedCount
    // .lastBestPickedCount
    // 0
  ' "${state_path}" 2>/dev/null || printf "0"
}

resolve_config_start_weights_path() {
  local raw=""
  local abs=""
  if [[ ! -f "${CONFIG_PATH}" ]]; then
    echo ""
    return
  fi
  raw="$(jq -r '.onlineLearning.startWeightsPath // empty' "${CONFIG_PATH}" 2>/dev/null || true)"
  abs="$(resolve_abs_path "${raw}")"
  if [[ -n "${abs}" && -f "${abs}" ]]; then
    echo "${abs}"
    return
  fi
  echo ""
}

normalize_second_pick_gate_json() {
  local raw="${1:-}"
  local out=""
  if [[ -z "${raw}" || "${raw}" == "null" ]]; then
    echo ""
    return
  fi
  if [[ "${AUTOPILOT_FORCE_SINGLE_PICK}" == "1" ]]; then
    jq -nc '{phase:"disabled",debugLog:false}'
    return
  fi
  out="$(echo "${raw}" | jq -c '
    if type == "object" then
      (.phase = (.phase // .mode // "disabled"))
      | del(.mode)
    else
      empty
    end
  ' 2>/dev/null || true)"
  if [[ -n "${out}" && "${out}" != "null" ]]; then
    echo "${out}"
    return
  fi
  echo ""
}

verify_ab_manifest_preflight() {
  local manifest_path="${ROOT}/artifacts/ab_registry/active_ab_manifest.json"
  local active_ab_run_id=""
  local ab_dir=""
  if [[ ! -f "${manifest_path}" ]]; then
    echo "[fatal] AB preflight failed: missing manifest ${manifest_path}" >&2
    return 1
  fi
  active_ab_run_id="$(jq -r '.activeAbRunId // empty' "${manifest_path}" 2>/dev/null || true)"
  if [[ -z "${active_ab_run_id}" ]]; then
    echo "[fatal] AB preflight failed: activeAbRunId empty in ${manifest_path}" >&2
    return 1
  fi
  ab_dir="${ROOT}/artifacts/runs/${active_ab_run_id}"
  if [[ ! -f "${ab_dir}/step-a/step_a_summary.json" ]]; then
    echo "[fatal] AB preflight failed: missing ${ab_dir}/step-a/step_a_summary.json" >&2
    return 1
  fi
  if [[ ! -f "${ab_dir}/step-b/step_b_summary.json" ]]; then
    echo "[fatal] AB preflight failed: missing ${ab_dir}/step-b/step_b_summary.json" >&2
    return 1
  fi
  if [[ ! -f "${ab_dir}/step-b/templates_lite.jsonl" && ! -f "${ab_dir}/step-b/templates.jsonl" && ! -f "${ab_dir}/step-b/templates_runtime_pack.jsonl" ]]; then
    echo "[fatal] AB preflight failed: missing step-b template artifacts under ${ab_dir}/step-b" >&2
    return 1
  fi
  return 0
}

sanitize_autopilot_state() {
  local tmp=""
  local tmp2=""
  local path_value=""
  local path_abs=""
  if [[ ! -f "${STATE_PATH}" ]]; then
    return 0
  fi
  tmp="$(mktemp)"
  if [[ "${AUTOPILOT_FORCE_SINGLE_PICK}" == "1" ]]; then
    jq '
      .resumeSecondPickGate = ((.resumeSecondPickGate // {}) | .phase = "disabled" | .debugLog = false | del(.mode))
      | .globalBestSecondPickGate = ((.globalBestSecondPickGate // {}) | .phase = "disabled" | .debugLog = false | del(.mode))
      | .globalBest = ((.globalBest // {}) | .secondPickGate = ((.globalBest.secondPickGate // {}) | .phase = "disabled" | .debugLog = false | del(.mode)))
      | .oracleChampion = ((.oracleChampion // {}) | .secondPickGate = ((.oracleChampion.secondPickGate // {}) | .phase = "disabled" | .debugLog = false | del(.mode)))
    ' "${STATE_PATH}" > "${tmp}"
  else
    jq '
      .resumeSecondPickGate = ((.resumeSecondPickGate // null) | if . == null then null else (.phase = (.phase // .mode // "disabled") | del(.mode)) end)
      | .globalBestSecondPickGate = ((.globalBestSecondPickGate // null) | if . == null then null else (.phase = (.phase // .mode // "disabled") | del(.mode)) end)
      | .globalBest = ((.globalBest // {}) | .secondPickGate = ((.globalBest.secondPickGate // null) | if . == null then null else (.phase = (.phase // .mode // "disabled") | del(.mode)) end))
      | .oracleChampion = ((.oracleChampion // {}) | .secondPickGate = ((.oracleChampion.secondPickGate // null) | if . == null then null else (.phase = (.phase // .mode // "disabled") | del(.mode)) end))
    ' "${STATE_PATH}" > "${tmp}"
  fi

  tmp2="$(mktemp)"
  jq '
    . as $root
    | .globalBest = (
        (.globalBest // {})
        | .stepD = (
            (.stepD // {})
            + {
              pickHitRate: (.stepD.pickHitRate // $root.lastBestPickHitRate // .pickHitRate // 0),
              pickedCount: (.stepD.pickedCount // $root.lastBestPickedCount // .pickedCount // 0)
            }
          )
        | .stepE = (
            (.stepE // {})
            + {
              winRate: (.stepE.winRate // .pickHitRate // 0),
              totalTrades: (.stepE.totalTrades // .pickedCount // 0),
              cumulativeReturn: (.stepE.cumulativeReturn // .validationCumulativeReturn // 0),
              maxDrawdown: (.stepE.maxDrawdown // .validationMaxDrawdown // 0)
            }
          )
      )
  ' "${tmp}" > "${tmp2}"
  mv "${tmp2}" "${tmp}"

  for field in '.resumeWeightsPath' '.globalBest.weightsPath' '.oracleChampion.weightsPath'; do
    path_value="$(jq -r "${field} // empty" "${tmp}" 2>/dev/null || true)"
    if [[ -z "${path_value}" || "${path_value}" == "null" ]]; then
      continue
    fi
    path_abs="$(resolve_abs_path "${path_value}")"
    if [[ -z "${path_abs}" || ! -f "${path_abs}" ]]; then
      tmp2="$(mktemp)"
      jq "${field} = null" "${tmp}" > "${tmp2}"
      mv "${tmp2}" "${tmp}"
    fi
  done

  mv "${tmp}" "${STATE_PATH}"
}

ensure_canonical_seed_weights() {
  local candidate=""
  local candidate_abs=""
  local cfg_start=""
  local updated="false"
  if [[ -f "${LATEST_WEIGHTS_COPY}" ]]; then
    return 0
  fi

  if [[ -f "${STATE_PATH}" ]]; then
    while IFS= read -r candidate; do
      [[ -z "${candidate}" || "${candidate}" == "null" ]] && continue
      candidate_abs="$(resolve_abs_path "${candidate}")"
      if [[ -n "${candidate_abs}" && -f "${candidate_abs}" ]]; then
        cp -f "${candidate_abs}" "${LATEST_WEIGHTS_COPY}"
        updated="true"
        break
      fi
    done < <(jq -r '.resumeWeightsPath // empty, .globalBest.weightsPath // empty, .oracleChampion.weightsPath // empty' "${STATE_PATH}" 2>/dev/null || true)
  fi

  if [[ "${updated}" != "true" ]]; then
    cfg_start="$(resolve_config_start_weights_path)"
    if [[ -n "${cfg_start}" && -f "${cfg_start}" ]]; then
      cp -f "${cfg_start}" "${LATEST_WEIGHTS_COPY}"
      updated="true"
    fi
  fi

  if [[ "${updated}" != "true" ]]; then
    return 1
  fi

  if [[ -f "${STATE_PATH}" ]]; then
    local tmp=""
    tmp="$(mktemp)"
    jq --arg p "${LATEST_WEIGHTS_COPY}" '
      .resumeWeightsPath = $p
      | .globalBest = ((.globalBest // {}) | .weightsPath = $p)
      | .oracleChampion = ((.oracleChampion // {}) | .weightsPath = $p)
    ' "${STATE_PATH}" > "${tmp}"
    mv "${tmp}" "${STATE_PATH}"
  fi
  return 0
}

classify_summary_missing_reason() {
  local run_log="$1"
  if grep -q "Unexpected effective config diff" "${run_log}" 2>/dev/null; then
    echo "effective_config_diff"
    return
  fi
  if grep -q "AB verify failed" "${run_log}" 2>/dev/null; then
    echo "ab_manifest_invalid"
    return
  fi
  if grep -q "Pairwise learning enabled but pairwiseUpdates=0" "${run_log}" 2>/dev/null; then
    echo "pairwise_update_path_broken"
    return
  fi
  if grep -q "config hash mismatch" "${run_log}" 2>/dev/null; then
    echo "ab_config_hash_mismatch"
    return
  fi
  echo "unknown"
}

run_preflight_guard() {
  local run_id="$1"
  local session_id="$2"
  local run_log="$3"
  if ! sanitize_autopilot_state; then
    echo "[$(timestamp)] [fatal] preflight failed: state sanitize error" | tee -a "${run_log}" >&2
    append_status_log "$(jq -nc --arg ts "$(timestamp)" --arg runId "${run_id}" --arg sessionId "${session_id}" '{ts:$ts,runId:$runId,sessionId:$sessionId,status:"fatal_preflight",reason:"state_sanitize_failed"}')"
    return 1
  fi
  if ! ensure_canonical_seed_weights; then
    echo "[$(timestamp)] [fatal] preflight failed: no canonical seed weights (state/config broken)" | tee -a "${run_log}" >&2
    append_status_log "$(jq -nc --arg ts "$(timestamp)" --arg runId "${run_id}" --arg sessionId "${session_id}" '{ts:$ts,runId:$runId,sessionId:$sessionId,status:"fatal_preflight",reason:"missing_canonical_seed_weights"}')"
    return 1
  fi
  if ! verify_ab_manifest_preflight; then
    echo "[$(timestamp)] [fatal] preflight failed: AB manifest/artifact invalid" | tee -a "${run_log}" >&2
    append_status_log "$(jq -nc --arg ts "$(timestamp)" --arg runId "${run_id}" --arg sessionId "${session_id}" '{ts:$ts,runId:$runId,sessionId:$sessionId,status:"fatal_preflight",reason:"ab_manifest_invalid"}')"
    return 1
  fi
  return 0
}

resolve_margin_upper_bound() {
  local from_config=""
  if [[ -f "${CONFIG_PATH}" ]]; then
    from_config="$(jq -r '.decisionGate.maxScoreMargin // empty' "${CONFIG_PATH}")"
    if [[ -n "${from_config}" && "${from_config}" != "null" ]]; then
      echo "${from_config}"
      return
    fi
  fi
  echo "${MARGIN_UPPER_BOUND_DEFAULT}"
}

clamp_margin_value() {
  local value="${1:-0}"
  local upper_bound="${2:-${MARGIN_UPPER_BOUND_DEFAULT}}"
  awk -v v="${value}" -v hi="${upper_bound}" 'BEGIN {
    x = v + 0
    h = hi + 0
    if (x < 0) x = 0
    if (x > h) x = h
    printf "%.6f", x
  }'
}

resolve_margin_signal() {
  local best_rate="${1:-0}"
  local best_count="${2:-0}"
  local best_conversion="${3:-0}"
  local best_oracle_topk="${4:-0}"
  if awk -v c="${best_count}" -v g="${GOAL_PICKED_COUNT}" 'BEGIN { exit (c+0 < g+0 ? 0 : 1) }'; then
    if awk -v o="${best_oracle_topk}" -v of="${ORACLE_TOPK_STRONG_FLOOR}" -v cv="${best_conversion}" -v cf="${GOAL_TOP1_TO_ORACLE_CONVERSION}" \
      'BEGIN { exit (o+0 >= of+0 && cv+0 < cf+0 ? 0 : 1) }'; then
      echo "HOLD"
      return
    fi
    echo "DOWN"
    return
  fi
  if awk -v c="${best_count}" -v g="${GOAL_PICKED_COUNT}" 'BEGIN { exit (c+0 >= g+0 ? 0 : 1) }' &&
    awk -v r="${best_rate}" -v g="${GOAL_PICK_HIT_RATE}" 'BEGIN { exit (r+0 < g+0 ? 0 : 1) }'; then
    echo "UP"
    return
  fi
  echo "HOLD"
}

calc_margin_step_down() {
  local best_count="${1:-0}"
  awk -v cnt="${best_count}" -v goal="${GOAL_PICKED_COUNT}" 'BEGIN {
    gap = goal - cnt
    if (gap < 0) gap = 0
    ratio = (goal > 0) ? (gap / goal) : 0
    step = 0.0012
    if (ratio >= 0.45) step = 0.0035
    else if (ratio >= 0.30) step = 0.0028
    else if (ratio >= 0.15) step = 0.0018
    printf "%.6f", step
  }'
}

calc_margin_step_up() {
  local best_rate="${1:-0}"
  awk -v rate="${best_rate}" -v goal="${GOAL_PICK_HIT_RATE}" 'BEGIN {
    gap = goal - rate
    if (gap < 0) gap = 0
    step = 0.0008
    if (gap >= 0.35) step = 0.0065
    else if (gap >= 0.25) step = 0.0050
    else if (gap >= 0.15) step = 0.0035
    else if (gap >= 0.08) step = 0.0022
    else if (gap >= 0.05) step = 0.0016
    else if (gap >= 0.03) step = 0.0012
    printf "%.6f", step
  }'
}

is_better_with_band() {
  local rate_left="$1"
  local count_left="$2"
  local rate_right="$3"
  local count_right="$4"
  local band="$5"
  awk -v rl="${rate_left}" -v cl="${count_left}" -v rr="${rate_right}" -v cr="${count_right}" -v b="${band}" \
    'BEGIN {
      d = rl - rr
      if (d > b) exit 0
      if (d < -b) exit 1
      exit (cl > cr ? 0 : 1)
    }'
}

is_better_validation_candidate() {
  local win_left="$1"
  local trades_left="$2"
  local cumret_left="$3"
  local mdd_left="$4"
  local win_right="$5"
  local trades_right="$6"
  local cumret_right="$7"
  local mdd_right="$8"
  local band="$9"
  awk \
    -v wl="${win_left}" \
    -v tl="${trades_left}" \
    -v cl="${cumret_left}" \
    -v ml="${mdd_left}" \
    -v wr="${win_right}" \
    -v tr="${trades_right}" \
    -v cr="${cumret_right}" \
    -v mr="${mdd_right}" \
    -v b="${band}" \
    'BEGIN {
      eps = 1e-12
      d = wl - wr
      if (d > b) exit 0
      if (d < -b) exit 1
      if ((cl + 0) > (cr + 0) + eps) exit 0
      if ((cl + 0) + eps < (cr + 0)) exit 1
      if ((ml + 0) + eps < (mr + 0)) exit 0
      if ((ml + 0) > (mr + 0) + eps) exit 1
      exit ((tl + 0) > (tr + 0) ? 0 : 1)
    }'
}

is_oracle_better() {
  local topk_left="$1"
  local goal_topk_left="$2"
  local conv_left="$3"
  local topk_right="$4"
  local goal_topk_right="$5"
  local conv_right="$6"
  awk \
    -v tl="${topk_left}" \
    -v gl="${goal_topk_left}" \
    -v cl="${conv_left}" \
    -v tr="${topk_right}" \
    -v gr="${goal_topk_right}" \
    -v cr="${conv_right}" \
    'BEGIN {
      eps = 1e-12
      if ((tl + 0) > (tr + 0) + eps) exit 0
      if ((tl + 0) + eps < (tr + 0)) exit 1
      if ((gl + 0) > (gr + 0) + eps) exit 0
      if ((gl + 0) + eps < (gr + 0)) exit 1
      exit ((cl + 0) > (cr + 0) + eps ? 0 : 1)
    }'
}

resolve_resume_weights() {
  if ensure_canonical_seed_weights && [[ -f "${LATEST_WEIGHTS_COPY}" ]]; then
    echo "${LATEST_WEIGHTS_COPY}"
    return
  fi

  echo ""
}

resolve_margin_from_weights_path() {
  local weights_path="${1:-}"
  local summary_path=""

  if [[ -z "${weights_path}" ]]; then
    echo ""
    return
  fi

  summary_path="$(dirname "${weights_path}")/step_d_summary.json"
  if [[ -f "${summary_path}" ]]; then
    jq -r '.decisionGate.minScoreMargin // empty' "${summary_path}"
    return
  fi

  echo ""
}

resolve_resume_margin() {
  local seed_weights_path="${1:-}"
  local from_state=""
  local from_global=""
  local from_global_weights=""
  local from_seed=""
  local oracle_phase=""
  local oracle_champion_margin=""
  local upper_bound=""

  upper_bound="$(resolve_margin_upper_bound)"

  if [[ "${ORACLE_DISCOVERY_ENABLED}" == "1" && -f "${STATE_PATH}" ]]; then
    oracle_phase="$(jq -r '.oracleTracking.phase // empty' "${STATE_PATH}")"
    if [[ "${oracle_phase}" == "freeze" ]]; then
      oracle_champion_margin="$(jq -r '.oracleChampion.gateMinScoreMargin // empty' "${STATE_PATH}")"
      if [[ -n "${oracle_champion_margin}" && "${oracle_champion_margin}" != "null" ]]; then
        clamp_margin_value "${oracle_champion_margin}" "${upper_bound}"
        return
      fi
    fi
  fi

  if [[ -f "${STATE_PATH}" ]]; then
    from_state="$(jq -r '.resumeMinScoreMargin // empty' "${STATE_PATH}")"
    if [[ -n "${from_state}" && "${from_state}" != "null" ]]; then
      clamp_margin_value "${from_state}" "${upper_bound}"
      return
    fi

    from_global="$(jq -r '.globalBest.gateMinScoreMargin // .globalBestGateMinScoreMargin // .lastGateMinScoreMargin // empty' "${STATE_PATH}")"
    if [[ -n "${from_global}" ]]; then
      clamp_margin_value "${from_global}" "${upper_bound}"
      return
    fi
    from_global_weights="$(jq -r '.globalBest.weightsPath // .resumeWeightsPath // empty' "${STATE_PATH}")"
    if [[ -n "${from_global_weights}" ]]; then
      from_seed="$(resolve_margin_from_weights_path "${from_global_weights}")"
      if [[ -n "${from_seed}" ]]; then
        clamp_margin_value "${from_seed}" "${upper_bound}"
        return
      fi
    fi
    from_state="$(jq -r '.lastGateMinScoreMargin // empty' "${STATE_PATH}")"
    if [[ -n "${from_state}" && "${from_state}" != "null" ]]; then
      clamp_margin_value "${from_state}" "${upper_bound}"
      return
    fi
    return
  fi

  if [[ -n "${seed_weights_path}" ]]; then
    from_seed="$(resolve_margin_from_weights_path "${seed_weights_path}")"
    if [[ -n "${from_seed}" ]]; then
      clamp_margin_value "${from_seed}" "${upper_bound}"
      return
    fi
  fi

  if [[ -f "${CONFIG_PATH}" ]]; then
    from_state="$(jq -r '.decisionGate.minScoreMargin // empty' "${CONFIG_PATH}")"
    if [[ -n "${from_state}" && "${from_state}" != "null" ]]; then
      clamp_margin_value "${from_state}" "${upper_bound}"
      return
    fi
    return
  fi
  echo ""
}

resolve_resume_second_pick() {
  local from_state=""
  local from_config=""
  local oracle_phase=""
  local oracle_second_pick=""
  local normalized=""

  if [[ "${AUTOPILOT_FORCE_SINGLE_PICK}" == "1" ]]; then
    normalize_second_pick_gate_json '{"phase":"disabled","debugLog":false}'
    return
  fi

  if [[ "${ORACLE_DISCOVERY_ENABLED}" == "1" && -f "${STATE_PATH}" ]]; then
    oracle_phase="$(jq -r '.oracleTracking.phase // empty' "${STATE_PATH}")"
    if [[ "${oracle_phase}" == "freeze" ]]; then
      oracle_second_pick="$(jq -c '.oracleChampion.secondPickGate // empty' "${STATE_PATH}")"
      normalized="$(normalize_second_pick_gate_json "${oracle_second_pick}")"
      if [[ -n "${normalized}" && "${normalized}" != "null" ]]; then
        echo "${normalized}"
        return
      fi
    fi
  fi

  if [[ -f "${STATE_PATH}" ]]; then
    from_state="$(jq -c \
      --argjson goalRate "${GOAL_PICK_HIT_RATE}" \
      --argjson goalCount "${GOAL_PICKED_COUNT}" \
      --argjson strongRateGap "${SECOND_PICK_STRONG_RATE_GAP}" \
      --argjson strongCountSurplus "${SECOND_PICK_STRONG_COUNT_SURPLUS}" \
      --argjson veryStrongRateGap "${SECOND_PICK_VERY_STRONG_RATE_GAP}" \
      --argjson veryStrongCountSurplus "${SECOND_PICK_VERY_STRONG_COUNT_SURPLUS}" \
      '
      def clamp(v; lo; hi): if v < lo then lo elif v > hi then hi else v end;
      (.resumeSecondPickGate // .globalBest.secondPickGate // .globalBestSecondPickGate) as $sp
      | if $sp == null then
          empty
        else
          (.lastBestPickedCount // .globalBest.stepD.pickedCount // .globalBest.pickedCount // 0) as $cnt
          | (.lastBestPickHitRate // .globalBest.stepD.pickHitRate // .globalBest.pickHitRate // 0) as $rate
          | ($sp + {phase: ($sp.phase // $sp.mode // "enforce"), debugLog: ($sp.debugLog // false)} | del(.mode)) as $base
          | if $cnt < $goalCount then
              $base
              | .minFinalScore = clamp((.minFinalScore // 0.60) - 0.01; 0.56; 0.92)
              | .minExpectedNetRet3d = clamp((.minExpectedNetRet3d // 0.022) - 0.0015; 0.02; 0.04)
              | .maxGapFromFirst = clamp((.maxGapFromFirst // 0.016) + 0.002; 0.01; 0.022)
              | .minMarginVsThird = clamp((.minMarginVsThird // 0.001) - 0.0005; 0; 0.01)
            elif ($cnt >= $goalCount and $rate < $goalRate) then
              if (($goalRate - $rate) >= $veryStrongRateGap and ($cnt - $goalCount) >= $veryStrongCountSurplus) then
                $base
                | .minFinalScore = clamp((.minFinalScore // 0.60) + 0.04; 0.56; 0.92)
                | .minExpectedNetRet3d = clamp((.minExpectedNetRet3d // 0.022) + 0.006; 0.02; 0.04)
                | .maxGapFromFirst = clamp((.maxGapFromFirst // 0.016) - 0.006; 0.008; 0.022)
                | .minMarginVsThird = clamp((.minMarginVsThird // 0.001) + 0.002; 0; 0.01)
              elif (($goalRate - $rate) >= $strongRateGap and ($cnt - $goalCount) >= $strongCountSurplus) then
                $base
                | .minFinalScore = clamp((.minFinalScore // 0.60) + 0.02; 0.56; 0.92)
                | .minExpectedNetRet3d = clamp((.minExpectedNetRet3d // 0.022) + 0.003; 0.02; 0.04)
                | .maxGapFromFirst = clamp((.maxGapFromFirst // 0.016) - 0.003; 0.008; 0.022)
                | .minMarginVsThird = clamp((.minMarginVsThird // 0.001) + 0.001; 0; 0.01)
              else
                $base
                | .minFinalScore = clamp((.minFinalScore // 0.60) + 0.01; 0.56; 0.92)
                | .minExpectedNetRet3d = clamp((.minExpectedNetRet3d // 0.022) + 0.0015; 0.02; 0.04)
                | .maxGapFromFirst = clamp((.maxGapFromFirst // 0.016) - 0.0015; 0.01; 0.022)
                | .minMarginVsThird = clamp((.minMarginVsThird // 0.001) + 0.0005; 0; 0.01)
              end
            else
              $base
            end
        end
      ' \
      "${STATE_PATH}")"
    normalized="$(normalize_second_pick_gate_json "${from_state}")"
    if [[ -n "${normalized}" && "${normalized}" != "null" ]]; then
      echo "${normalized}"
      return
    fi
  fi

  if [[ -f "${CONFIG_PATH}" ]]; then
    from_config="$(jq -c '.decisionGate.secondPick // empty' "${CONFIG_PATH}")"
    normalized="$(normalize_second_pick_gate_json "${from_config}")"
    if [[ -n "${normalized}" && "${normalized}" != "null" ]]; then
      echo "${normalized}"
      return
    fi
  fi

  echo ""
}

resolve_rebuild_c_stagnation_rounds() {
  local base_rounds=""
  local aggressive_rounds=""
  local best_count="0"
  local best_rate="0"
  local best_conversion="0"
  local best_oracle_topk="0"
  local oracle_phase=""
  local oracle_discovery_rounds=""
  local oracle_freeze_rounds=""

  base_rounds="$(awk -v n="${REBUILD_C_STAGNATION_BASE}" 'BEGIN { x=int(n+0); if (x < 1) x = 1; print x }')"
  aggressive_rounds="$(awk -v n="${REBUILD_C_STAGNATION_AGGRESSIVE}" 'BEGIN { x=int(n+0); if (x < 1) x = 1; print x }')"
  oracle_discovery_rounds="$(awk -v n="${ORACLE_DISCOVERY_REBUILD_C_ROUNDS}" 'BEGIN { x=int(n+0); if (x < 1) x = 1; print x }')"
  oracle_freeze_rounds="$(awk -v n="${ORACLE_FREEZE_REBUILD_C_ROUNDS}" 'BEGIN { x=int(n+0); if (x < 1) x = 1; print x }')"

  if [[ "${ORACLE_DISCOVERY_ENABLED}" == "1" ]]; then
    if [[ -f "${STATE_PATH}" ]]; then
      oracle_phase="$(jq -r '.oracleTracking.phase // "discovery"' "${STATE_PATH}")"
      if [[ "${oracle_phase}" == "freeze" ]]; then
        echo "${oracle_freeze_rounds}"
        return
      fi
      if [[ "${oracle_phase}" == "discovery" ]]; then
        echo "${oracle_discovery_rounds}"
        return
      fi
    else
      echo "${oracle_discovery_rounds}"
      return
    fi
  fi

  if [[ "${ENABLE_AGGRESSIVE_C_WHEN_HIT_LAGS}" != "1" ]]; then
    echo "${base_rounds}"
    return
  fi

  if [[ -f "${STATE_PATH}" ]]; then
    best_count="$(jq -r '.lastBestPickedCount // .globalBest.stepD.pickedCount // .globalBest.pickedCount // 0' "${STATE_PATH}")"
    best_rate="$(jq -r '.lastBestPickHitRate // .globalBest.stepD.pickHitRate // .globalBest.pickHitRate // 0' "${STATE_PATH}")"
    best_conversion="$(jq -r '.lastBestTop1ToOracleConversion // 0' "${STATE_PATH}")"
    best_oracle_topk="$(jq -r '.lastBestOracleHitRateTopK // 0' "${STATE_PATH}")"
    if awk -v o="${best_oracle_topk}" -v of="${ORACLE_TOPK_STRONG_FLOOR}" -v cv="${best_conversion}" -v ct="${CONVERSION_LAG_TRIGGER}" \
      'BEGIN { exit (o+0 >= of+0 && cv+0 < ct+0 ? 0 : 1) }'; then
      echo "${aggressive_rounds}"
      return
    fi
    if awk -v c="${best_count}" -v gc="${GOAL_PICKED_COUNT}" -v r="${best_rate}" -v gr="${GOAL_PICK_HIT_RATE}" \
      'BEGIN { exit (c+0 >= gc+0 && r+0 < gr+0 ? 0 : 1) }'; then
      echo "${aggressive_rounds}"
      return
    fi
  fi

  echo "${base_rounds}"
}

resolve_oracle_phase() {
  if [[ "${ORACLE_DISCOVERY_ENABLED}" != "1" ]]; then
    echo "disabled"
    return
  fi
  if [[ -f "${STATE_PATH}" ]]; then
    jq -r '.oracleTracking.phase // "discovery"' "${STATE_PATH}"
    return
  fi
  echo "discovery"
}

apply_run_seed_to_config() {
  local seed_weights="$1"
  local seed_margin="$2"
  local seed_second_pick="$3"
  local seed_rebuild_c_rounds="$4"
  local seed_oracle_phase="${5:-disabled}"
  local max_picks=2
  local aggressive_mode="false"
  local margin_upper_bound=""
  local tmp
  tmp="$(mktemp)"
  if [[ "${AUTOPILOT_FORCE_SINGLE_PICK}" == "1" ]]; then
    max_picks=1
  fi
  margin_upper_bound="$(resolve_margin_upper_bound)"
  if awk -v n="${seed_rebuild_c_rounds}" 'BEGIN { exit ((n+0) <= 1 ? 0 : 1) }'; then
    aggressive_mode="true"
  fi

  jq \
    --arg sw "${seed_weights}" \
    --argjson maxPicks "${max_picks}" \
    --argjson rebuildCRounds "${seed_rebuild_c_rounds}" \
    '.onlineLearning.enabled = true
     | .onlineLearning.startWeightsPath = $sw
     | .decisionGate.maxPicksPerDay = $maxPicks
     | .cdLoop.stagnationRoundsBeforeRebuildC = $rebuildCRounds' \
    "${CONFIG_PATH}" > "${tmp}"

  local tmp_oracle
  tmp_oracle="$(mktemp)"
  if [[ "${seed_oracle_phase}" == "freeze" ]]; then
    jq \
      --argjson floor "${ORACLE_TOPK_STRONG_FLOOR}" \
      --argjson minEpochs "${ORACLE_FREEZE_MIN_EPOCHS_PER_ROUND}" \
      --argjson maxEpochs "${ORACLE_FREEZE_MAX_EPOCHS_PER_ROUND}" \
      --argjson learningRate "${ORACLE_FREEZE_LEARNING_RATE}" \
      '.onlineLearning.learningRate = $learningRate
       | .cdLoop.minEpochsPerRound = ($minEpochs | floor | if . < 1 then 1 else . end)
       | (.cdLoop.minEpochsPerRound) as $minEp
       | .cdLoop.maxEpochsPerRound = ($maxEpochs | floor | if . < $minEp then $minEp else . end)
       | .cdLoop.scoreMarginSweep.enabled = true
       | .cdLoop.dOnlySprint.enabled = true
       | .cdLoop.dOnlySprint.rounds = 999
       | .cdLoop.dOnlySprint.noImproveRoundsToResumeC = 1
       | .cdLoop.dOnlySprint.oracleTopKFloor = ((.cdLoop.dOnlySprint.oracleTopKFloor // 0) | if . > $floor then . else $floor end)' \
      "${tmp}" > "${tmp_oracle}"
  elif [[ "${seed_oracle_phase}" == "discovery" ]]; then
    jq \
      --argjson minEpochs "${ORACLE_DISCOVERY_MIN_EPOCHS_PER_ROUND}" \
      --argjson maxEpochs "${ORACLE_DISCOVERY_MAX_EPOCHS_PER_ROUND}" \
      --argjson learningRate "${ORACLE_DISCOVERY_LEARNING_RATE}" \
      '.onlineLearning.learningRate = $learningRate
       | .cdLoop.minEpochsPerRound = ($minEpochs | floor | if . < 1 then 1 else . end)
       | (.cdLoop.minEpochsPerRound) as $minEp
       | .cdLoop.maxEpochsPerRound = ($maxEpochs | floor | if . < $minEp then $minEp else . end)
       | .cdLoop.scoreMarginSweep.enabled = false
       | .cdLoop.dOnlySprint.enabled = false
       | .cdLoop.dOnlySprint.rounds = ((.cdLoop.dOnlySprint.rounds // 2) | if . < 2 then 2 else . end)
       | .cdLoop.dOnlySprint.noImproveRoundsToResumeC = ((.cdLoop.dOnlySprint.noImproveRoundsToResumeC // 1) | if . < 1 then 1 else . end)' \
      "${tmp}" > "${tmp_oracle}"
  else
    cp -f "${tmp}" "${tmp_oracle}"
  fi
  mv "${tmp_oracle}" "${tmp}"

  if [[ "${aggressive_mode}" == "true" ]]; then
    local tmp_aggressive
    tmp_aggressive="$(mktemp)"
    jq \
      --argjson minRateGain "${SWEEP_MIN_RATE_GAIN_AGGRESSIVE}" \
      --argjson minHitGain "${SWEEP_MIN_HIT_COUNT_GAIN_AGGRESSIVE}" \
      '.cdLoop.scoreMarginSweep.minPickHitRateGain = ((.cdLoop.scoreMarginSweep.minPickHitRateGain // 0) | if . > $minRateGain then . else $minRateGain end)
       | .cdLoop.scoreMarginSweep.minPickHitCountGain = ((.cdLoop.scoreMarginSweep.minPickHitCountGain // 0) | if . > $minHitGain then . else $minHitGain end)' \
      "${tmp}" > "${tmp_aggressive}"
    mv "${tmp_aggressive}" "${tmp}"
  fi

  if [[ -n "${seed_margin}" ]]; then
    local clamped_margin=""
    local tmp2
    clamped_margin="$(clamp_margin_value "${seed_margin}" "${margin_upper_bound}")"
    tmp2="$(mktemp)"
    jq --argjson gm "${clamped_margin}" '.decisionGate.minScoreMargin = $gm' "${tmp}" > "${tmp2}"
    mv "${tmp2}" "${tmp}"
  fi

  if [[ "${AUTOPILOT_FORCE_SINGLE_PICK}" == "1" ]]; then
    local tmp4
    tmp4="$(mktemp)"
    jq '.decisionGate.secondPick = ((.decisionGate.secondPick // {}) + {phase:"disabled", debugLog:false} | del(.mode))' "${tmp}" > "${tmp4}"
    mv "${tmp4}" "${tmp}"
  elif [[ -n "${seed_second_pick}" && "${seed_second_pick}" != "null" ]]; then
    local tmp3
    tmp3="$(mktemp)"
    jq --argjson sp "${seed_second_pick}" '.decisionGate.secondPick = ($sp | .phase = (.phase // .mode // "enforce") | del(.mode))' "${tmp}" > "${tmp3}"
    mv "${tmp3}" "${tmp}"
  fi

  mv "${tmp}" "${CONFIG_PATH}"
}

append_status_log() {
  local payload="$1"
  echo "${payload}" >> "${STATUS_LOG}"
}

disk_metrics() {
  df -Pk "${ROOT}" | awk 'NR==2 {
    pct=$5
    gsub(/%/,"",pct)
    freeGb=$4/1048576
    printf "%s %s %.3f\n", pct, $4, freeGb
  }'
}

extract_run_id_from_path() {
  local path="${1:-}"
  if [[ -z "${path}" ]]; then
    return
  fi
  echo "${path}" | sed -n 's#.*artifacts/runs/\(cd_auto_[^/]*\)/.*#\1#p'
}

collect_protected_run_ids() {
  local current_run_id="${1:-}"
  local path
  local run_id
  local found=""

  if [[ -n "${current_run_id}" ]]; then
    found+="${current_run_id}"$'\n'
  fi

  if [[ -f "${LATEST_WEIGHTS_COPY}" ]]; then
    run_id="$(extract_run_id_from_path "${LATEST_WEIGHTS_COPY}")"
    if [[ -n "${run_id}" ]]; then
      found+="${run_id}"$'\n'
    fi
  fi

  if [[ -f "${STATE_PATH}" ]]; then
    while IFS= read -r path; do
      [[ -z "${path}" || "${path}" == "null" ]] && continue
      run_id="$(extract_run_id_from_path "${path}")"
      if [[ -n "${run_id}" ]]; then
        found+="${run_id}"$'\n'
      fi
    done < <(jq -r '.resumeWeightsPath // empty, .globalBest.weightsPath // empty, .oracleChampion.weightsPath // empty, .summaryPath // empty, .snapshotPath // empty' "${STATE_PATH}" 2>/dev/null || true)
  fi

  if [[ -n "${found}" ]]; then
    printf "%s" "${found}" | sort -u
  fi
}

cleanup_old_cd_runs() {
  local current_run_id="${1:-}"
  local keep_count
  local removed=0
  local run_dir
  local run_id
  local idx=0
  local use_pct="0"
  local avail_kb="0"
  local free_gb="0"
  local protected_ids=()
  keep_count="$(awk -v n="${RUNS_KEEP}" 'BEGIN { x=int(n+0); if (x < 5) x = 5; print x }')"

  mapfile -t protected_ids < <(collect_protected_run_ids "${current_run_id}")
  declare -A protected_map=()
  for run_id in "${protected_ids[@]}"; do
    [[ -z "${run_id}" ]] && continue
    protected_map["${run_id}"]=1
  done

  while IFS= read -r run_dir; do
    [[ -z "${run_dir}" ]] && continue
    read -r use_pct avail_kb free_gb < <(disk_metrics)
    if awk -v f="${free_gb}" -v t="${DISK_TARGET_GB}" 'BEGIN { exit (f+0 >= t+0 ? 0 : 1) }'; then
      break
    fi
    run_id="$(basename "${run_dir}")"
    idx=$((idx + 1))
    if [[ "${idx}" -le "${keep_count}" ]]; then
      continue
    fi
    if [[ -n "${protected_map["${run_id}"]+x}" ]]; then
      continue
    fi
    rm -rf "${run_dir}" 2>/dev/null || true
    removed=$((removed + 1))
  done < <(ls -1dt "${ROOT}"/artifacts/runs/cd_auto_* 2>/dev/null || true)

  echo "${removed}"
}

ensure_disk_headroom() {
  local run_id="$1"
  local session_id="$2"
  local run_log="$3"
  local stage="${4:-pre_run}"
  local use_pct="0"
  local avail_kb="0"
  local free_gb="0"
  local before_free_gb="0"
  local after_free_gb="0"
  local freed_gb="0"
  local cleaned="false"
  local removed_runs="0"

  read -r use_pct avail_kb free_gb < <(disk_metrics)
  append_status_log "$(jq -nc \
    --arg ts "$(timestamp)" \
    --arg runId "${run_id}" \
    --arg sessionId "${session_id}" \
    --arg stage "${stage}" \
    --argjson usePct "${use_pct}" \
    --argjson freeGb "${free_gb}" \
    --argjson warnGb "${DISK_WARN_GB}" \
    --argjson cleanupGb "${DISK_CLEANUP_GB}" \
    --argjson pauseGb "${DISK_PAUSE_GB}" \
    '{ts:$ts,runId:$runId,sessionId:$sessionId,status:"disk_probe",stage:$stage,disk:{usePct:$usePct,freeGb:$freeGb,warnGb:$warnGb,cleanupGb:$cleanupGb,pauseGb:$pauseGb}}')"

  if awk -v f="${free_gb}" -v w="${DISK_WARN_GB}" 'BEGIN { exit (f+0 < w+0 ? 0 : 1) }'; then
    echo "[$(timestamp)] [warn] low disk headroom stage=${stage} freeGb=${free_gb} usePct=${use_pct}" | tee -a "${run_log}"
  fi

  if awk -v f="${free_gb}" -v c="${DISK_CLEANUP_GB}" 'BEGIN { exit (f+0 < c+0 ? 0 : 1) }'; then
    before_free_gb="${free_gb}"
    removed_runs="$(cleanup_old_cd_runs "${run_id}")"
    read -r use_pct avail_kb free_gb < <(disk_metrics)
    after_free_gb="${free_gb}"
    freed_gb="$(awk -v a="${after_free_gb}" -v b="${before_free_gb}" 'BEGIN { d=a-b; if (d < 0) d=0; printf "%.3f", d }')"
    cleaned="true"
    append_status_log "$(jq -nc \
      --arg ts "$(timestamp)" \
      --arg runId "${run_id}" \
      --arg sessionId "${session_id}" \
      --arg stage "${stage}" \
      --arg cleaned "${cleaned}" \
      --argjson removedRuns "${removed_runs}" \
      --argjson beforeFreeGb "${before_free_gb}" \
      --argjson afterFreeGb "${after_free_gb}" \
      --argjson freedGb "${freed_gb}" \
      '{ts:$ts,runId:$runId,sessionId:$sessionId,status:"disk_cleanup",stage:$stage,cleaned:($cleaned=="true"),removedRuns:$removedRuns,beforeFreeGb:$beforeFreeGb,afterFreeGb:$afterFreeGb,freedGb:$freedGb}')"
    echo "[$(timestamp)] [warn] disk cleanup stage=${stage} removedRuns=${removed_runs} freedGb=${freed_gb} freeGb=${after_free_gb}" | tee -a "${run_log}"
  fi

  if awk -v f="${free_gb}" -v p="${DISK_PAUSE_GB}" 'BEGIN { exit (f+0 < p+0 ? 0 : 1) }'; then
    append_status_log "$(jq -nc \
      --arg ts "$(timestamp)" \
      --arg runId "${run_id}" \
      --arg sessionId "${session_id}" \
      --arg stage "${stage}" \
      --argjson freeGb "${free_gb}" \
      --argjson usePct "${use_pct}" \
      --argjson pauseGb "${DISK_PAUSE_GB}" \
      '{ts:$ts,runId:$runId,sessionId:$sessionId,status:"disk_blocked",stage:$stage,disk:{freeGb:$freeGb,usePct:$usePct,pauseGb:$pauseGb}}')"
    echo "[$(timestamp)] [warn] disk blocked stage=${stage} freeGb=${free_gb} < pauseGb=${DISK_PAUSE_GB}. backoff ${FAIL_BACKOFF_SEC}s" | tee -a "${run_log}"
    sleep "${FAIL_BACKOFF_SEC}"
    return 1
  fi

  return 0
}

emit_speed_probe() {
  local run_id="$1"
  local session_id="$2"
  local run_log="$3"
  local score_ms_per_seed="$4"
  local worker_pool_score_ms="$5"
  local level="ok"

  if awk -v s="${score_ms_per_seed}" -v t="${SPEED_HARD_MS_PER_SEED}" 'BEGIN { exit (s+0 >= t+0 ? 0 : 1) }'; then
    level="hard"
  elif awk -v s="${score_ms_per_seed}" -v t="${SPEED_WARN_MS_PER_SEED}" 'BEGIN { exit (s+0 >= t+0 ? 0 : 1) }'; then
    level="warn"
  fi

  append_status_log "$(jq -nc \
    --arg ts "$(timestamp)" \
    --arg runId "${run_id}" \
    --arg sessionId "${session_id}" \
    --arg level "${level}" \
    --argjson scoreMsPerSeed "${score_ms_per_seed}" \
    --argjson workerPoolScoreMs "${worker_pool_score_ms}" \
    --argjson warnThreshold "${SPEED_WARN_MS_PER_SEED}" \
    --argjson hardThreshold "${SPEED_HARD_MS_PER_SEED}" \
    '{ts:$ts,runId:$runId,sessionId:$sessionId,status:"speed_probe",speed:{level:$level,scoreMsPerSeed:$scoreMsPerSeed,workerPoolScoreMs:$workerPoolScoreMs,warnThreshold:$warnThreshold,hardThreshold:$hardThreshold}}')"

  if [[ "${level}" != "ok" ]]; then
    echo "[$(timestamp)] [warn] speed probe level=${level} scoreMsPerSeed=${score_ms_per_seed} workerPoolScoreMs=${worker_pool_score_ms}" | tee -a "${run_log}"
  fi
}

IFS='|' read -r PRIMARY_VALIDATION_METRIC_NAME PRIMARY_VALIDATION_COUNT_NAME <<< "$(resolve_primary_validation_metric_names)"
PRIMARY_VALIDATION_METRIC_NAME="${PRIMARY_VALIDATION_METRIC_NAME:-win_rate}"
PRIMARY_VALIDATION_COUNT_NAME="${PRIMARY_VALIDATION_COUNT_NAME:-total_trades}"

write_startup_snapshot() {
  local autopilot_count="0"
  local cd_loop_count="0"
  autopilot_count="$({ pgrep -af 'cd_autopilot_until_goal.sh' 2>/dev/null || true; } | awk 'BEGIN{c=0} /pgrep -af/ {next} {c+=1} END{print c+0}')"
  cd_loop_count="$({ pgrep -af 'node src/cli.mjs cd-loop' 2>/dev/null || true; } | awk 'BEGIN{c=0} /pgrep -af/ {next} {c+=1} END{print c+0}')"
  jq -n \
    --arg ts "$(timestamp)" \
    --arg root "${ROOT}" \
    --arg configPath "${CONFIG_PATH}" \
    --arg statusLog "${STATUS_LOG}" \
    --arg statePath "${STATE_PATH}" \
    --arg pidPath "${PID_PATH}" \
    --arg lockPath "${LOCK_PATH}" \
    --argjson pid "$$" \
    --argjson ppid "${PPID:-0}" \
    --argjson goalPickHitRate "${GOAL_PICK_HIT_RATE}" \
    --argjson goalPickedCount "${GOAL_PICKED_COUNT}" \
    --argjson goalConfirmWinRate "${GOAL_CONFIRM_WIN_RATE}" \
    --argjson goalConfirmTrades "${GOAL_CONFIRM_TRADES}" \
    --arg goalPrimaryMetric "${PRIMARY_VALIDATION_METRIC_NAME}" \
    --arg goalPrimaryCountMetric "${PRIMARY_VALIDATION_COUNT_NAME}" \
    --argjson goalTop1ToOracleConversion "${GOAL_TOP1_TO_ORACLE_CONVERSION}" \
    --argjson loopSleepSec "${LOOP_SLEEP_SEC}" \
    --argjson failBackoffSec "${FAIL_BACKOFF_SEC}" \
    --arg oracleDiscoveryEnabled "${ORACLE_DISCOVERY_ENABLED}" \
    --argjson oracleDiscoveryTopkTarget "${ORACLE_DISCOVERY_TOPK_TARGET}" \
    --argjson oracleDiscoveryGoalTopkTarget "${ORACLE_DISCOVERY_GOAL_TOPK_TARGET}" \
    --argjson oracleDiscoverySustainRuns "${ORACLE_DISCOVERY_SUSTAIN_RUNS}" \
    --argjson oracleDiscoveryRebuildCRounds "${ORACLE_DISCOVERY_REBUILD_C_ROUNDS}" \
    --argjson oracleFreezeRebuildCRounds "${ORACLE_FREEZE_REBUILD_C_ROUNDS}" \
    --argjson oracleDiscoveryMinEpochsPerRound "${ORACLE_DISCOVERY_MIN_EPOCHS_PER_ROUND}" \
    --argjson oracleDiscoveryMaxEpochsPerRound "${ORACLE_DISCOVERY_MAX_EPOCHS_PER_ROUND}" \
    --argjson oracleDiscoveryLearningRate "${ORACLE_DISCOVERY_LEARNING_RATE}" \
    --argjson oracleFreezeMinEpochsPerRound "${ORACLE_FREEZE_MIN_EPOCHS_PER_ROUND}" \
    --argjson oracleFreezeMaxEpochsPerRound "${ORACLE_FREEZE_MAX_EPOCHS_PER_ROUND}" \
    --argjson oracleFreezeLearningRate "${ORACLE_FREEZE_LEARNING_RATE}" \
    --argjson autopilotProcessCount "${autopilot_count}" \
    --argjson cdLoopProcessCount "${cd_loop_count}" \
    --arg autopilotForceSinglePick "${AUTOPILOT_FORCE_SINGLE_PICK}" \
    --argjson summaryMissingMaxStreak "${SUMMARY_MISSING_MAX_STREAK}" \
    --arg validationStageGate "${FAST_VALIDATION_STAGE_GATE}" \
    --argjson fastDiscoverRounds "${FAST_DISCOVER_ROUNDS}" \
    --argjson fastMinEpochs "${FAST_MIN_EPOCHS}" \
    --argjson fastMaxEpochs "${FAST_MAX_EPOCHS}" \
    --argjson fastSmokeRuns "${FAST_SMOKE_RUNS}" \
    --argjson fastConfirmRuns "${FAST_CONFIRM_RUNS}" \
    '{
      generatedAt:$ts,
      root:$root,
      configPath:$configPath,
      pid:$pid,
      ppid:$ppid,
      pidPath:$pidPath,
      lockPath:$lockPath,
      statusLog:$statusLog,
      statePath:$statePath,
      goal:{
        stepD:{pickHitRate:$goalPickHitRate,pickedCount:$goalPickedCount,top1ToOracleConversion:$goalTop1ToOracleConversion},
        stepE:{
          primaryMetric:$goalPrimaryMetric,
          primaryCountMetric:$goalPrimaryCountMetric,
          primaryRate:$goalConfirmWinRate,
          primaryCount:$goalConfirmTrades,
          winRate:$goalConfirmWinRate,
          totalTrades:$goalConfirmTrades
        }
      },
      fastLane:{
        validationStageGate:$validationStageGate,
        discoverRounds:$fastDiscoverRounds,
        minEpochs:$fastMinEpochs,
        maxEpochs:$fastMaxEpochs,
        smokeRuns:$fastSmokeRuns,
        confirmRuns:$fastConfirmRuns
      },
      oracleTracking:{
        enabled:($oracleDiscoveryEnabled=="1"),
        topkTarget:$oracleDiscoveryTopkTarget,
        goalTopkTarget:$oracleDiscoveryGoalTopkTarget,
        sustainRuns:$oracleDiscoverySustainRuns,
        discoveryRebuildCRounds:$oracleDiscoveryRebuildCRounds,
        freezeRebuildCRounds:$oracleFreezeRebuildCRounds,
        discoveryMode:{
          minEpochsPerRound:$oracleDiscoveryMinEpochsPerRound,
          maxEpochsPerRound:$oracleDiscoveryMaxEpochsPerRound,
          learningRate:$oracleDiscoveryLearningRate
        },
        freezeMode:{
          minEpochsPerRound:$oracleFreezeMinEpochsPerRound,
          maxEpochsPerRound:$oracleFreezeMaxEpochsPerRound,
          learningRate:$oracleFreezeLearningRate
        }
      },
      loop:{sleepSec:$loopSleepSec,failBackoffSec:$failBackoffSec,summaryMissingMaxStreak:$summaryMissingMaxStreak},
      processCounts:{autopilot:$autopilotProcessCount,cdLoop:$cdLoopProcessCount},
      seedPolicy:{
        forceSinglePick:($autopilotForceSinglePick=="1")
      }
    }' > "${ENV_SNAPSHOT_PATH}"
  append_status_log "$(jq -nc \
    --arg ts "$(timestamp)" \
    --arg snapshotPath "${ENV_SNAPSHOT_PATH}" \
    --argjson autopilotProcessCount "${autopilot_count}" \
    --argjson cdLoopProcessCount "${cd_loop_count}" \
    '{ts:$ts,status:"startup_snapshot",snapshotPath:$snapshotPath,processCounts:{autopilot:$autopilotProcessCount,cdLoop:$cdLoopProcessCount}}')"
}

write_iteration_checkpoint() {
  local run_id="$1"
  local session_id="$2"
  local summary_path="$3"
  local run_exit="$4"
  local best_rate="$5"
  local best_count="$6"
  local best_two_pick_days="$7"
  local gate_margin="$8"
  local gate_second_pick="$9"
  local global_rate="${10}"
  local global_count="${11}"
  local global_margin="${12}"
  local global_second_pick="${13}"
  local global_weights="${14}"
  local promoted="${15}"
  local goal_reached="${16}"
  local smoke_summary_path="${17:-}"
  local smoke_sanity="${18:-false}"
  local confirm_summary_path="${19:-}"
  local confirm_sanity="${20:-false}"
  local validation_pass="${21:-false}"
  local gate_max_margin=""
  local smoke_validation="false"
  local smoke_validation_reason="SMOKE_SUMMARY_MISSING"
  local confirm_validation="false"
  local confirm_validation_reason="CONFIRM_SUMMARY_MISSING"
  local confirm_trades_path=""
  local confirm_replay_path=""
  local checkpoint_global_stepd_rate="0"
  local checkpoint_global_stepd_count="0"
  local checkpoint_global_stepe_metric="${PRIMARY_VALIDATION_METRIC_NAME}"
  local checkpoint_global_stepe_rate="0"
  local checkpoint_global_stepe_count="0"
  local checkpoint_global_metric_source="cd_loop"
  local checkpoint_global_cumret="0"
  local checkpoint_global_mdd="0"
  local checkpoint_stable_stepd_weights_hash=""
  local checkpoint_stable_stepd_path=""
  local checkpoint_stable_stepe_metric="${PRIMARY_VALIDATION_METRIC_NAME}"
  local checkpoint_stable_stepe_rate="0"
  local checkpoint_stable_stepe_count="0"
  local checkpoint_stable_stepe_cumret="0"
  local checkpoint_stable_stepe_mdd="0"
  local checkpoint_goal_confirm_win_rate="${GOAL_CONFIRM_WIN_RATE}"
  local checkpoint_goal_confirm_trades="${GOAL_CONFIRM_TRADES}"
  local checkpoint_goal_stepd_rate="${GOAL_PICK_HIT_RATE}"
  local checkpoint_goal_stepd_count="${GOAL_PICKED_COUNT}"
  local checkpoint_path="${CHECKPOINT_DIR}/${run_id}"
  local previous_index_path="${LATEST_CHECKPOINT_LINK}/lockbox_replay_confirm_index.json"
  local new_index_path="${checkpoint_path}/lockbox_replay_confirm_index.json"
  mkdir -p "${checkpoint_path}"

  cp -f "${CONFIG_PATH}" "${checkpoint_path}/config_applied.json" 2>/dev/null || true
  cp -f "${STATE_PATH}" "${checkpoint_path}/autopilot_state_after.json" 2>/dev/null || true
  cp -f "${summary_path}" "${checkpoint_path}/cd_loop_summary.json" 2>/dev/null || true
  if [[ -n "${smoke_summary_path}" && -f "${smoke_summary_path}" ]]; then
    cp -f "${smoke_summary_path}" "${checkpoint_path}/smoke_confirm_smoke_summary.json" 2>/dev/null || true
  fi
  if [[ -n "${confirm_summary_path}" && -f "${confirm_summary_path}" ]]; then
    cp -f "${confirm_summary_path}" "${checkpoint_path}/smoke_confirm_confirm_summary.json" 2>/dev/null || true
    confirm_trades_path="$(jq -r '.confirm.runs[-1].stepE.tradesPath // empty' "${confirm_summary_path}" 2>/dev/null || true)"
    confirm_replay_path="$(jq -r '.confirm.runs[-1].stepE.replayFeedbackPath // empty' "${confirm_summary_path}" 2>/dev/null || true)"
  fi
  carry_replay_checkpoint_store "${checkpoint_path}" "${confirm_replay_path}" "${confirm_trades_path}"
  if [[ -f "${previous_index_path}" && ! -f "${new_index_path}" ]]; then
    cp -f "${previous_index_path}" "${new_index_path}" 2>/dev/null || true
  fi
  if [[ -f "${LATEST_WEIGHTS_COPY}" ]]; then
    cp -f "${LATEST_WEIGHTS_COPY}" "${checkpoint_path}/champion_weights_latest.json" 2>/dev/null || true
  fi
  if [[ -n "${global_weights}" && -f "${global_weights}" ]]; then
    cp -f "${global_weights}" "${checkpoint_path}/global_best_weights.json" 2>/dev/null || true
  fi
  if [[ -f "${LATEST_SNAPSHOT_COPY}" ]]; then
    cp -f "${LATEST_SNAPSHOT_COPY}" "${checkpoint_path}/champion_snapshot_latest.json" 2>/dev/null || true
  fi
  if [[ -f "${summary_path}" ]]; then
    gate_max_margin="$(jq -r '.finalDecisionGate.maxScoreMargin // empty' "${summary_path}")"
  fi
  if [[ -n "${smoke_summary_path}" && -f "${smoke_summary_path}" ]]; then
    smoke_validation="$(jq -r '.smoke.aggregate.validationGate.eligible // false' "${smoke_summary_path}")"
    smoke_validation_reason="$(jq -r '.smoke.aggregate.validationGate.reason // "SMOKE_VALIDATION_UNKNOWN"' "${smoke_summary_path}")"
  fi
  if [[ -n "${confirm_summary_path}" && -f "${confirm_summary_path}" ]]; then
    confirm_validation="$(jq -r '.confirm.aggregate.validationGate.eligible // false' "${confirm_summary_path}")"
    confirm_validation_reason="$(jq -r '.confirm.aggregate.validationGate.reason // "CONFIRM_VALIDATION_UNKNOWN"' "${confirm_summary_path}")"
    checkpoint_stable_stepd_weights_hash="$(jq -r '.confirm.aggregate.confirmedWeightsHash // empty' "${confirm_summary_path}" 2>/dev/null || true)"
    checkpoint_stable_stepd_path="$(jq -r '.confirm.aggregate.confirmedWeightsPath // empty' "${confirm_summary_path}" 2>/dev/null || true)"
    checkpoint_stable_stepe_metric="$(read_confirm_primary_metric_name "${confirm_summary_path}")"
    checkpoint_stable_stepe_rate="$(read_confirm_primary_rate "${confirm_summary_path}")"
    checkpoint_stable_stepe_count="$(read_confirm_primary_count "${confirm_summary_path}")"
    checkpoint_stable_stepe_cumret="$(jq -r '.confirm.aggregate.confirmedStepEMetrics.cumulativeReturn // 0' "${confirm_summary_path}" 2>/dev/null || true)"
    checkpoint_stable_stepe_mdd="$(jq -r '.confirm.aggregate.confirmedStepEMetrics.maxDrawdown // 0' "${confirm_summary_path}" 2>/dev/null || true)"
  fi
  if [[ -f "${STATE_PATH}" ]]; then
    checkpoint_global_stepd_rate="$(jq -r '.globalBest.stepD.pickHitRate // .lastBestPickHitRate // 0' "${STATE_PATH}" 2>/dev/null || true)"
    checkpoint_global_stepd_count="$(jq -r '.globalBest.stepD.pickedCount // .lastBestPickedCount // 0' "${STATE_PATH}" 2>/dev/null || true)"
    checkpoint_global_stepe_metric="$(read_state_primary_metric_name "${STATE_PATH}")"
    checkpoint_global_stepe_rate="$(read_state_primary_rate "${STATE_PATH}")"
    checkpoint_global_stepe_count="$(read_state_primary_count "${STATE_PATH}")"
    checkpoint_global_cumret="$(jq -r '.globalBest.stepE.cumulativeReturn // .globalBest.validationCumulativeReturn // 0' "${STATE_PATH}" 2>/dev/null || true)"
    checkpoint_global_mdd="$(jq -r '.globalBest.stepE.maxDrawdown // .globalBest.validationMaxDrawdown // 0' "${STATE_PATH}" 2>/dev/null || true)"
    checkpoint_global_metric_source="$(jq -r '.globalBest.metricSource // "cd_loop"' "${STATE_PATH}" 2>/dev/null || true)"
  fi

  jq -n \
    --arg ts "$(timestamp)" \
    --arg runId "${run_id}" \
    --arg sessionId "${session_id}" \
    --argjson exitCode "${run_exit}" \
    --argjson pickHitRate "${best_rate}" \
    --argjson pickedCount "${best_count}" \
    --argjson twoPickDays "${best_two_pick_days}" \
    --argjson gateMinScoreMargin "${gate_margin:-0}" \
    --argjson gateMaxScoreMargin "${gate_max_margin:-null}" \
    --argjson gateSecondPick "${gate_second_pick:-null}" \
    --argjson globalPickHitRate "${global_rate}" \
    --argjson globalPickedCount "${global_count}" \
    --argjson globalStepDPickHitRate "${checkpoint_global_stepd_rate}" \
    --argjson globalStepDPickedCount "${checkpoint_global_stepd_count}" \
    --argjson globalStepEWinRate "${checkpoint_global_stepe_rate}" \
    --argjson globalStepETotalTrades "${checkpoint_global_stepe_count}" \
    --argjson globalValidationCumulativeReturn "${checkpoint_global_cumret}" \
    --argjson globalValidationMaxDrawdown "${checkpoint_global_mdd}" \
    --arg globalMetricSource "${checkpoint_global_metric_source}" \
    --argjson globalGateMinScoreMargin "${global_margin:-0}" \
    --argjson globalSecondPick "${global_second_pick:-null}" \
    --arg globalWeightsPath "${global_weights}" \
    --arg promoted "${promoted}" \
    --arg goalReached "${goal_reached}" \
    --arg summaryPath "${summary_path}" \
    --arg smokeSummaryPath "${smoke_summary_path}" \
    --arg smokeSanity "${smoke_sanity}" \
    --arg smokeValidation "${smoke_validation}" \
    --arg smokeValidationReason "${smoke_validation_reason}" \
    --arg confirmSummaryPath "${confirm_summary_path}" \
    --arg confirmSanity "${confirm_sanity}" \
    --arg confirmValidation "${confirm_validation}" \
    --arg confirmValidationReason "${confirm_validation_reason}" \
    --arg confirmTradesPath "${confirm_trades_path}" \
    --arg confirmReplayPath "${confirm_replay_path}" \
    --arg stableStepDWeightsHash "${checkpoint_stable_stepd_weights_hash}" \
    --arg stableStepDWeightsPath "${checkpoint_stable_stepd_path}" \
    --arg stableStepEPrimaryMetric "${checkpoint_stable_stepe_metric}" \
    --argjson stableStepEWinRate "${checkpoint_stable_stepe_rate}" \
    --argjson stableStepETotalTrades "${checkpoint_stable_stepe_count}" \
    --argjson stableStepECumulativeReturn "${checkpoint_stable_stepe_cumret}" \
    --argjson stableStepEMaxDrawdown "${checkpoint_stable_stepe_mdd}" \
    --arg globalStepEPrimaryMetric "${checkpoint_global_stepe_metric}" \
    --argjson goalStepDPickHitRate "${checkpoint_goal_stepd_rate}" \
    --argjson goalStepDPickedCount "${checkpoint_goal_stepd_count}" \
    --argjson goalConfirmWinRate "${checkpoint_goal_confirm_win_rate}" \
    --argjson goalConfirmTrades "${checkpoint_goal_confirm_trades}" \
    --arg goalPrimaryMetric "${PRIMARY_VALIDATION_METRIC_NAME}" \
    --arg goalPrimaryCountMetric "${PRIMARY_VALIDATION_COUNT_NAME}" \
    --arg validationPass "${validation_pass}" \
    '{
      generatedAt:$ts,
      runId:$runId,
      sessionId:$sessionId,
      runExitCode:$exitCode,
      best:{
        pickHitRate:$pickHitRate,
        pickedCount:$pickedCount,
        stepD:{pickHitRate:$pickHitRate,pickedCount:$pickedCount},
        twoPickDays:$twoPickDays
      },
      finalDecisionGate:{minScoreMargin:$gateMinScoreMargin,maxScoreMargin:$gateMaxScoreMargin,secondPick:$gateSecondPick},
      globalBest:{
        pickHitRate:$globalPickHitRate,
        pickedCount:$globalPickedCount,
        stepD:{pickHitRate:$globalStepDPickHitRate,pickedCount:$globalStepDPickedCount},
        stepE:{
          primaryMetric:$globalStepEPrimaryMetric,
          primaryRate:$globalStepEWinRate,
          primaryCount:$globalStepETotalTrades,
          winRate:$globalStepEWinRate,
          totalTrades:$globalStepETotalTrades,
          cumulativeReturn:$globalValidationCumulativeReturn,
          maxDrawdown:$globalValidationMaxDrawdown
        },
        validationCumulativeReturn:$globalValidationCumulativeReturn,
        validationMaxDrawdown:$globalValidationMaxDrawdown,
        weightsPath:$globalWeightsPath,
        gateMinScoreMargin:$globalGateMinScoreMargin,
        secondPick:$globalSecondPick,
        metricSource:$globalMetricSource
      },
      validation:{
        smokeSummaryPath:$smokeSummaryPath,
        smokeSanityPass:($smokeSanity=="true"),
        smokeValidationPass:($smokeValidation=="true"),
        smokeValidationReason:$smokeValidationReason,
        confirmSummaryPath:$confirmSummaryPath,
        confirmSanityPass:($confirmSanity=="true"),
        confirmValidationPass:($confirmValidation=="true"),
        confirmValidationReason:$confirmValidationReason,
        confirmTradesPath:$confirmTradesPath,
        confirmReplayPath:$confirmReplayPath,
        stableStepDWeightsHash:$stableStepDWeightsHash,
        stableStepDWeightsPath:$stableStepDWeightsPath,
        stableStepEMetrics:{
          primaryMetric:$stableStepEPrimaryMetric,
          primaryRate:$stableStepEWinRate,
          primaryCount:$stableStepETotalTrades,
          winRate:$stableStepEWinRate,
          totalTrades:$stableStepETotalTrades,
          cumulativeReturn:$stableStepECumulativeReturn,
          maxDrawdown:$stableStepEMaxDrawdown
        },
        confirmedStepE:{
          primaryMetric:$globalStepEPrimaryMetric,
          primaryRate:$globalStepEWinRate,
          primaryCount:$globalStepETotalTrades,
          winRate:$globalStepEWinRate,
          totalTrades:$globalStepETotalTrades,
          cumulativeReturn:$globalValidationCumulativeReturn,
          maxDrawdown:$globalValidationMaxDrawdown
        },
        pass:($validationPass=="true")
      },
      goal:{
        stepD:{pickHitRate:$goalStepDPickHitRate,pickedCount:$goalStepDPickedCount},
        stepE:{
          primaryMetric:$goalPrimaryMetric,
          primaryCountMetric:$goalPrimaryCountMetric,
          primaryRate:$goalConfirmWinRate,
          primaryCount:$goalConfirmTrades,
          winRate:$goalConfirmWinRate,
          totalTrades:$goalConfirmTrades
        }
      },
      promotedThisRun:($promoted=="true"),
      goalReached:($goalReached=="true"),
      summaryPath:$summaryPath
    }' > "${checkpoint_path}/checkpoint_meta.json"

  ln -sfn "${checkpoint_path}" "${LATEST_CHECKPOINT_LINK}"

  local remove_list=""
  remove_list="$(ls -1dt "${CHECKPOINT_DIR}"/cd_auto_* 2>/dev/null | awk "NR>${CHECKPOINT_KEEP}")"
  if [[ -n "${remove_list}" ]]; then
    while IFS= read -r stale_path; do
      [[ -z "${stale_path}" ]] && continue
      rm -rf "${stale_path}" 2>/dev/null || true
    done <<< "${remove_list}"
  fi

  echo "${checkpoint_path}"
}

write_startup_snapshot

iteration=0
summary_missing_streak=0
while true; do
  iteration=$((iteration + 1))
  now_tag="$(date +%Y%m%d_%H%M%S)"
  run_id="cd_auto_${now_tag}_i$(printf '%03d' "${iteration}")"
  session_id="cdauto_${now_tag}_i$(printf '%03d' "${iteration}")"
  run_log="${LOG_DIR}/${run_id}.log"

  if ! run_preflight_guard "${run_id}" "${session_id}" "${run_log}"; then
    exit 1
  fi

  seed_weights="$(resolve_resume_weights)"
  seed_margin="$(resolve_resume_margin "${seed_weights}")"
  seed_second_pick="$(resolve_resume_second_pick)"
  seed_rebuild_c_rounds="$(resolve_rebuild_c_stagnation_rounds)"
  seed_oracle_phase="$(resolve_oracle_phase)"
  seed_second_pick_compact="$(echo "${seed_second_pick:-null}" | tr -d '\n')"

  if [[ -z "${seed_weights}" || ! -f "${seed_weights}" ]]; then
    echo "[$(timestamp)] [fatal] no valid seed weights path" | tee -a "${run_log}"
    exit 1
  fi

  if ! ensure_disk_headroom "${run_id}" "${session_id}" "${run_log}" "pre_run"; then
    continue
  fi

  apply_run_seed_to_config "${seed_weights}" "${seed_margin}" "${seed_second_pick}" "${seed_rebuild_c_rounds}" "${seed_oracle_phase}"

  echo "[$(timestamp)] [run] iteration=${iteration} run_id=${run_id} session_id=${session_id} seed_weights=${seed_weights} seed_margin=${seed_margin} seed_rebuild_c_rounds=${seed_rebuild_c_rounds} seed_oracle_phase=${seed_oracle_phase} seed_second_pick=${seed_second_pick_compact}" | tee -a "${run_log}"
  append_status_log "$(jq -nc \
    --arg ts "$(timestamp)" \
    --arg runId "${run_id}" \
    --arg sessionId "${session_id}" \
    --arg seedWeights "${seed_weights}" \
    --argjson seedMargin "${seed_margin:-0}" \
    --argjson seedRebuildCRounds "${seed_rebuild_c_rounds}" \
    --arg seedOraclePhase "${seed_oracle_phase}" \
    --argjson seedSecondPick "${seed_second_pick:-null}" \
    --argjson iteration "${iteration}" \
    '{ts:$ts,runId:$runId,sessionId:$sessionId,iteration:$iteration,status:"started",seed:{weightsPath:$seedWeights,minScoreMargin:$seedMargin,rebuildCRounds:$seedRebuildCRounds,oraclePhase:$seedOraclePhase,secondPickGate:$seedSecondPick}}')"

  cleanup_stale_cd_auto_processes
  smoke_session_id="${session_id}_smoke"
  confirm_session_id="${session_id}_confirm"
  set +e
  setsid bash -lc "cd '${ROOT}' && CONFIG_REL='${CONFIG_REL}' RUN_ID='${run_id}' DISCOVER_SESSION='${session_id}' SMOKE_SESSION='${smoke_session_id}' CONFIRM_SESSION='${confirm_session_id}' CD_ROUNDS='${FAST_DISCOVER_ROUNDS}' CD_MIN_EPOCHS='${FAST_MIN_EPOCHS}' CD_MAX_EPOCHS='${FAST_MAX_EPOCHS}' SMOKE_RUNS='${FAST_SMOKE_RUNS}' CONFIRM_RUNS='${FAST_CONFIRM_RUNS}' STOP_ON_SMOKE_FAILURE='${FAST_STOP_ON_SMOKE_FAILURE}' VALIDATION_STAGE_GATE='${FAST_VALIDATION_STAGE_GATE}' NO_KIS=1 BACKFILL_DISABLE_KIS=1 BACKFILL_KIS_ENABLED=0 NODE_OPTIONS='--max-old-space-size=4096' tools/policy_cycle_fast.sh '${ROOT}'" \
    > >(tee -a "${run_log}") 2>&1 &
  ACTIVE_RUN_PGID=$!
  wait "${ACTIVE_RUN_PGID}"
  run_exit=$?
  ACTIVE_RUN_PGID=""
  set -e
  ensure_disk_headroom "${run_id}" "${session_id}" "${run_log}" "post_run" || true

  summary_path="${ROOT}/artifacts/runs/${run_id}/cd-loop/${session_id}/cd_loop_summary.json"
  snapshot_path="${ROOT}/artifacts/runs/${run_id}/cd-loop/champion_snapshot.json"
  smoke_summary_path="${ROOT}/artifacts/runs/${run_id}/smoke-confirm/${smoke_session_id}/smoke_confirm_summary.json"
  confirm_summary_path="${ROOT}/artifacts/runs/${run_id}/smoke-confirm/${confirm_session_id}/smoke_confirm_summary.json"

  if [[ ! -f "${summary_path}" ]]; then
    summary_missing_streak=$((summary_missing_streak + 1))
    missing_reason="$(classify_summary_missing_reason "${run_log}")"
    append_status_log "$(jq -nc \
      --arg ts "$(timestamp)" \
      --arg runId "${run_id}" \
      --arg sessionId "${session_id}" \
      --arg reason "${missing_reason}" \
      --argjson streak "${summary_missing_streak}" \
      --argjson exitCode "${run_exit}" \
      '{ts:$ts,runId:$runId,sessionId:$sessionId,status:"summary_missing",reason:$reason,streak:$streak,exitCode:$exitCode}')"
    if [[ "${missing_reason}" != "unknown" ]]; then
      echo "[$(timestamp)] [fatal] summary missing due to structural error: reason=${missing_reason}. stopping autopilot." | tee -a "${run_log}"
      append_status_log "$(jq -nc \
        --arg ts "$(timestamp)" \
        --arg runId "${run_id}" \
        --arg sessionId "${session_id}" \
        --arg reason "${missing_reason}" \
        '{ts:$ts,runId:$runId,sessionId:$sessionId,status:"fatal_summary_missing",reason:$reason}')"
      exit 1
    fi
    if [[ "${summary_missing_streak}" -ge "${SUMMARY_MISSING_MAX_STREAK}" ]]; then
      echo "[$(timestamp)] [fatal] summary missing streak exceeded: ${summary_missing_streak}/${SUMMARY_MISSING_MAX_STREAK}. stopping autopilot." | tee -a "${run_log}"
      append_status_log "$(jq -nc \
        --arg ts "$(timestamp)" \
        --arg runId "${run_id}" \
        --arg sessionId "${session_id}" \
        --argjson streak "${summary_missing_streak}" \
        --argjson maxStreak "${SUMMARY_MISSING_MAX_STREAK}" \
        '{ts:$ts,runId:$runId,sessionId:$sessionId,status:"fatal_summary_missing_streak",streak:$streak,maxStreak:$maxStreak}')"
      exit 1
    fi
    echo "[$(timestamp)] [warn] summary missing. backoff ${FAIL_BACKOFF_SEC}s (reason=${missing_reason}, streak=${summary_missing_streak}/${SUMMARY_MISSING_MAX_STREAK})" | tee -a "${run_log}"
    sleep "${FAIL_BACKOFF_SEC}"
    continue
  fi
  summary_missing_streak=0

  best_rate="$(jq -r '.bestRound.bestMetrics.pickHitRate // 0' "${summary_path}")"
  best_count="$(jq -r '.bestRound.bestMetrics.pickedCount // 0' "${summary_path}")"
  stepd_best_pick_hit_rate="${best_rate}"
  stepd_best_picked_count="${best_count}"
  best_two_pick_days="$(jq -r '.bestRound.bestMetrics.twoPickDays // 0' "${summary_path}")"
  best_hit_count="$(jq -r '.bestRound.bestMetrics.pickHitCount // 0' "${summary_path}")"
  best_worker_pool_score_ms="$(jq -r '.bestRound.bestMetrics.workerPoolScoreMs // 0' "${summary_path}")"
  best_score_ms_per_seed="$(jq -r '.bestRound.bestMetrics.scoreMsPerSeed // 0' "${summary_path}")"
  best_score_margin_low_days="$(jq -r '.bestRound.bestMetrics.gateReasonCounts.SCORE_MARGIN_LOW // 0' "${summary_path}")"
  best_oracle_hit_rate_universe="$(jq -r '.bestRound.bestMetrics.oracleHitRateUniverse // 0' "${summary_path}")"
  best_oracle_hit_rate_topk="$(jq -r '.bestRound.bestMetrics.oracleHitRateTopK // 0' "${summary_path}")"
  best_oracle_max_hit_rate_topk_goal="$(jq -r '.bestRound.bestMetrics.oracleMaxHitRateAtPickedGoalTopK // 0' "${summary_path}")"
  best_oracle_coverage_gap="$(jq -r '.bestRound.bestMetrics.oracleCoverageGap // 0' "${summary_path}")"
  best_top1_to_oracle_conversion="$(jq -r '.bestRound.bestMetrics.top1ToOracleConversion // 0' "${summary_path}")"
  best_top1_to_oracle_goal_conversion="$(jq -r '.bestRound.bestMetrics.top1ToOracleGoalConversion // 0' "${summary_path}")"
  emit_speed_probe "${run_id}" "${session_id}" "${run_log}" "${best_score_ms_per_seed}" "${best_worker_pool_score_ms}"
  best_promotable="$(jq -r '.bestRound.promotable // false' "${summary_path}")"
  best_c_tag="$(jq -r '.bestRound.cTag // empty' "${summary_path}")"
  best_round_tag="$(jq -r '.bestRound.roundTag // empty' "${summary_path}")"
  best_epoch_num="$(jq -r '.bestRound.bestEpoch // empty' "${summary_path}")"
  best_epoch_tag=""
  best_daily_log_path=""
  best_two_pick_dates_json="[]"
  best_two_pick_hit_dates_json="[]"
  if [[ -n "${best_round_tag}" && -n "${best_epoch_num}" && "${best_epoch_num}" =~ ^[0-9]+$ ]]; then
    best_epoch_tag="$(printf "e%02d" "${best_epoch_num}")"
    best_daily_log_path="${ROOT}/artifacts/runs/${run_id}/cd-loop/${session_id}/${best_round_tag}/${best_epoch_tag}/daily_online_logs.jsonl"
    if [[ -f "${best_daily_log_path}" ]]; then
      best_two_pick_dates_json="$(jq -sc '[.[] | select(.pickCount == 2) | .decisionDateKey]' "${best_daily_log_path}")"
      best_two_pick_hit_dates_json="$(jq -sc '[.[] | select(.pickCount == 2) | select(([.pickedList[]?.successInWindow] | map(select(. == true)) | length) > 0) | .decisionDateKey]' "${best_daily_log_path}")"
    fi
  fi
  gate_margin="$(jq -r '.finalDecisionGate.minScoreMargin // empty' "${summary_path}")"
  gate_max_margin="$(jq -r '.finalDecisionGate.maxScoreMargin // empty' "${summary_path}")"
  gate_second_pick="$(jq -c '.finalDecisionGate.secondPick // empty' "${summary_path}")"
  champ_weights="$(jq -r '.safeChampion.weightsPath // empty' "${summary_path}")"
  confirmed_weights=""
  smoke_sanity="false"
  confirm_sanity="false"
  smoke_validation="false"
  smoke_validation_reason="SMOKE_SUMMARY_MISSING"
  confirm_validation="false"
  confirm_validation_reason="CONFIRM_SUMMARY_MISSING"
  confirm_stepd_rate=""
  confirm_stepd_count=""
  confirm_stepe_metric="${PRIMARY_VALIDATION_METRIC_NAME}"
  confirm_stepe_rate=""
  confirm_stepe_count=""
  confirm_stepe_cumret=""
  confirm_stepe_mdd=""
  validation_pass="false"
  if [[ -f "${smoke_summary_path}" ]]; then
    smoke_sanity="$(jq -r '.smoke.aggregate.sanityPass // false' "${smoke_summary_path}")"
    smoke_validation="$(jq -r '.smoke.aggregate.validationGate.eligible // false' "${smoke_summary_path}")"
    smoke_validation_reason="$(jq -r '.smoke.aggregate.validationGate.reason // "SMOKE_VALIDATION_UNKNOWN"' "${smoke_summary_path}")"
  fi
  if [[ -f "${confirm_summary_path}" ]]; then
    confirm_sanity="$(jq -r '.confirm.aggregate.sanityPass // false' "${confirm_summary_path}")"
    confirm_validation="$(jq -r '.confirm.aggregate.validationGate.eligible // false' "${confirm_summary_path}")"
    confirm_validation_reason="$(jq -r '.confirm.aggregate.validationGate.reason // "CONFIRM_VALIDATION_UNKNOWN"' "${confirm_summary_path}")"
    confirmed_weights="$(jq -r '.confirm.aggregate.confirmedWeightsPath // empty' "${confirm_summary_path}")"
    confirm_stepd_rate="$(jq -r '.confirm.aggregate.confirmedStepDMetrics.pickHitRate // empty' "${confirm_summary_path}")"
    confirm_stepd_count="$(jq -r '.confirm.aggregate.confirmedStepDMetrics.pickedCount // empty' "${confirm_summary_path}")"
    confirm_stepe_metric="$(read_confirm_primary_metric_name "${confirm_summary_path}")"
    confirm_stepe_rate="$(read_confirm_primary_rate "${confirm_summary_path}")"
    confirm_stepe_count="$(read_confirm_primary_count "${confirm_summary_path}")"
    confirm_stepe_cumret="$(jq -r '.confirm.aggregate.confirmedStepEMetrics.cumulativeReturn // empty' "${confirm_summary_path}")"
    confirm_stepe_mdd="$(jq -r '.confirm.aggregate.confirmedStepEMetrics.maxDrawdown // empty' "${confirm_summary_path}")"
  fi
  if [[ "${smoke_validation}" == "true" && "${confirm_validation}" == "true" ]]; then
    validation_pass="true"
  fi
  if [[ "${validation_pass}" == "true" ]]; then
    if [[ -z "${confirmed_weights}" || ! -f "${confirmed_weights}" ]]; then
      echo "[fatal] confirm validated but confirmedWeightsPath missing: ${confirm_summary_path}" >&2
      exit 1
    fi
    champ_weights="${confirmed_weights}"
  fi
  effective_best_rate="${best_rate}"
  effective_best_count="${best_count}"
  effective_best_metric_source="cd_loop"
  effective_best_primary_metric="${PRIMARY_VALIDATION_METRIC_NAME}"
  effective_best_cumret="0"
  effective_best_mdd="0"
  if [[ "${validation_pass}" == "true" ]]; then
    if [[ -n "${confirm_stepe_rate}" ]]; then
      effective_best_rate="${confirm_stepe_rate}"
    fi
    if [[ -n "${confirm_stepe_count}" ]]; then
      effective_best_count="${confirm_stepe_count}"
    fi
    if [[ -n "${confirm_stepe_cumret}" ]]; then
      effective_best_cumret="${confirm_stepe_cumret}"
    fi
    if [[ -n "${confirm_stepe_mdd}" ]]; then
      effective_best_mdd="${confirm_stepe_mdd}"
    fi
    if [[ -n "${confirm_stepe_metric}" ]]; then
      effective_best_primary_metric="${confirm_stepe_metric}"
    fi
    effective_best_metric_source="confirm_step_e"
  fi
  stepe_confirm_win_rate="${effective_best_rate}"
  stepe_confirm_total_trades="${effective_best_count}"
  stepe_confirm_cumulative_return="${effective_best_cumret}"
  stepe_confirm_max_drawdown="${effective_best_mdd}"
  best_promotable_effective="false"
  if [[ "${best_promotable}" == "true" && "${validation_pass}" == "true" ]]; then
    best_promotable_effective="true"
  fi

  if [[ "${validation_pass}" == "true" && ( -z "${champ_weights}" || ! -f "${champ_weights}" ) ]]; then
    echo "[$(timestamp)] [fatal] validation passed but no validated champion weights were produced." | tee -a "${run_log}"
    append_status_log "$(jq -nc \
      --arg ts "$(timestamp)" \
      --arg runId "${run_id}" \
      --arg sessionId "${session_id}" \
      '{ts:$ts,runId:$runId,sessionId:$sessionId,status:"fatal_validation_weights_missing",reason:"validated_champion_weights_missing"}')"
    exit 1
  fi

  if [[ -n "${champ_weights}" && -f "${champ_weights}" ]]; then
    cp -f "${champ_weights}" "${LATEST_WEIGHTS_COPY}"
  fi

  if [[ -f "${snapshot_path}" ]]; then
    cp -f "${snapshot_path}" "${LATEST_SNAPSHOT_COPY}"
  fi

  prev_global_rate="0"
  prev_global_count="0"
  prev_global_stepd_rate="0"
  prev_global_stepd_count="0"
  prev_global_primary_metric="${PRIMARY_VALIDATION_METRIC_NAME}"
  prev_global_weights=""
  prev_global_margin=""
  prev_global_second_pick=""
  prev_global_metric_source="cd_loop"
  prev_global_validation_cumret="0"
  prev_global_validation_mdd="0"
  prev_oracle_phase="discovery"
  prev_oracle_sustain_count="0"
  prev_oracle_champion_topk="0"
  prev_oracle_champion_goal_topk="0"
  prev_oracle_champion_conversion="0"
  prev_oracle_champion_weights=""
  prev_oracle_champion_margin=""
  prev_oracle_champion_second_pick=""
  prev_oracle_champion_run_id=""
  prev_oracle_champion_session_id=""
  prev_oracle_champion_c_tag=""
  if [[ -f "${STATE_PATH}" ]]; then
    prev_global_primary_metric="$(read_state_primary_metric_name "${STATE_PATH}")"
    prev_global_rate="$(read_state_primary_rate "${STATE_PATH}")"
    prev_global_count="$(read_state_primary_count "${STATE_PATH}")"
    prev_global_stepd_rate="$(jq -r '.globalBest.stepD.pickHitRate // .lastBestPickHitRate // 0' "${STATE_PATH}")"
    prev_global_stepd_count="$(jq -r '.globalBest.stepD.pickedCount // .lastBestPickedCount // 0' "${STATE_PATH}")"
    prev_global_weights="$(jq -r '.globalBest.weightsPath // .resumeWeightsPath // empty' "${STATE_PATH}")"
    prev_global_margin="$(jq -r '.globalBest.gateMinScoreMargin // .globalBestGateMinScoreMargin // .resumeMinScoreMargin // .lastGateMinScoreMargin // empty' "${STATE_PATH}")"
    prev_global_second_pick="$(jq -c '.globalBest.secondPickGate // .resumeSecondPickGate // empty' "${STATE_PATH}")"
    prev_global_metric_source="$(jq -r '.globalBest.metricSource // "cd_loop"' "${STATE_PATH}")"
    prev_global_validation_cumret="$(jq -r '.globalBest.validationCumulativeReturn // 0' "${STATE_PATH}")"
    prev_global_validation_mdd="$(jq -r '.globalBest.validationMaxDrawdown // 0' "${STATE_PATH}")"
    if [[ -n "${prev_global_weights}" && ! -f "${prev_global_weights}" ]]; then
      prev_global_weights=""
    fi
    prev_oracle_phase="$(jq -r '.oracleTracking.phase // "discovery"' "${STATE_PATH}")"
    prev_oracle_sustain_count="$(jq -r '.oracleTracking.sustainCount // 0' "${STATE_PATH}")"
    prev_oracle_champion_topk="$(jq -r '.oracleChampion.oracleHitRateTopK // 0' "${STATE_PATH}")"
    prev_oracle_champion_goal_topk="$(jq -r '.oracleChampion.oracleMaxHitRateAtPickedGoalTopK // 0' "${STATE_PATH}")"
    prev_oracle_champion_conversion="$(jq -r '.oracleChampion.top1ToOracleConversion // 0' "${STATE_PATH}")"
    prev_oracle_champion_weights="$(jq -r '.oracleChampion.weightsPath // empty' "${STATE_PATH}")"
    prev_oracle_champion_margin="$(jq -r '.oracleChampion.gateMinScoreMargin // empty' "${STATE_PATH}")"
    prev_oracle_champion_second_pick="$(jq -c '.oracleChampion.secondPickGate // empty' "${STATE_PATH}")"
    prev_oracle_champion_run_id="$(jq -r '.oracleChampion.runId // empty' "${STATE_PATH}")"
    prev_oracle_champion_session_id="$(jq -r '.oracleChampion.sessionId // empty' "${STATE_PATH}")"
    prev_oracle_champion_c_tag="$(jq -r '.oracleChampion.cTag // empty' "${STATE_PATH}")"
  fi

  oracle_discovery_enabled="false"
  if [[ "${ORACLE_DISCOVERY_ENABLED}" == "1" ]]; then
    oracle_discovery_enabled="true"
  fi
  oracle_sustain_required="$(awk -v n="${ORACLE_DISCOVERY_SUSTAIN_RUNS}" 'BEGIN { x=int(n+0); if (x < 1) x = 1; print x }')"
  oracle_met_this_run="false"
  if awk -v o="${best_oracle_hit_rate_topk}" -v t="${ORACLE_DISCOVERY_TOPK_TARGET}" -v g="${best_oracle_max_hit_rate_topk_goal}" -v gt="${ORACLE_DISCOVERY_GOAL_TOPK_TARGET}" \
    'BEGIN { exit (o+0 >= t+0 && g+0 >= gt+0 ? 0 : 1) }'; then
    oracle_met_this_run="true"
  fi
  prev_oracle_sustain_count="$(awk -v n="${prev_oracle_sustain_count}" 'BEGIN { x=int(n+0); if (x < 0) x = 0; print x }')"
  oracle_sustain_count_next="0"
  if [[ "${oracle_met_this_run}" == "true" ]]; then
    oracle_sustain_count_next=$((prev_oracle_sustain_count + 1))
  fi
  oracle_champion_topk="${prev_oracle_champion_topk}"
  oracle_champion_goal_topk="${prev_oracle_champion_goal_topk}"
  oracle_champion_conversion="${prev_oracle_champion_conversion}"
  oracle_champion_weights="${prev_oracle_champion_weights}"
  oracle_champion_margin="${prev_oracle_champion_margin}"
  oracle_champion_second_pick="${prev_oracle_champion_second_pick}"
  oracle_champion_run_id="${prev_oracle_champion_run_id}"
  oracle_champion_session_id="${prev_oracle_champion_session_id}"
  oracle_champion_c_tag="${prev_oracle_champion_c_tag}"
  oracle_champion_updated_at=""
  if [[ -n "${champ_weights}" && -f "${champ_weights}" ]] &&
    is_oracle_better \
      "${best_oracle_hit_rate_topk}" \
      "${best_oracle_max_hit_rate_topk_goal}" \
      "${best_top1_to_oracle_conversion}" \
      "${prev_oracle_champion_topk}" \
      "${prev_oracle_champion_goal_topk}" \
      "${prev_oracle_champion_conversion}"; then
    oracle_champion_topk="${best_oracle_hit_rate_topk}"
    oracle_champion_goal_topk="${best_oracle_max_hit_rate_topk_goal}"
    oracle_champion_conversion="${best_top1_to_oracle_conversion}"
    oracle_champion_weights="${champ_weights}"
    oracle_champion_margin="${gate_margin:-${seed_margin}}"
    oracle_champion_second_pick="${gate_second_pick:-${seed_second_pick}}"
    oracle_champion_run_id="${run_id}"
    oracle_champion_session_id="${session_id}"
    oracle_champion_c_tag="${best_c_tag}"
    oracle_champion_updated_at="$(timestamp)"
  fi

  oracle_phase_next="disabled"
  if [[ "${oracle_discovery_enabled}" == "true" ]]; then
    oracle_phase_next="${prev_oracle_phase}"
    if [[ "${oracle_phase_next}" != "freeze" && "${oracle_phase_next}" != "discovery" ]]; then
      oracle_phase_next="discovery"
    fi
    if [[ "${oracle_phase_next}" == "freeze" ]]; then
      if awk -v o="${best_oracle_hit_rate_topk}" -v f="${ORACLE_TOPK_STRONG_FLOOR}" -v c="${best_top1_to_oracle_conversion}" -v t="${CONVERSION_LAG_TRIGGER}" \
        'BEGIN { exit (o+0 < f+0 && c+0 < t+0 ? 0 : 1) }'; then
        oracle_phase_next="discovery"
        oracle_sustain_count_next=0
      fi
    else
      if [[ -n "${oracle_champion_weights}" && -f "${oracle_champion_weights}" ]] &&
        awk -v s="${oracle_sustain_count_next}" -v r="${oracle_sustain_required}" 'BEGIN { exit (s+0 >= r+0 ? 0 : 1) }'; then
        oracle_phase_next="freeze"
      else
        oracle_phase_next="discovery"
      fi
    fi
  fi

  global_rate="${prev_global_rate}"
  global_count="${prev_global_count}"
  global_stepd_rate="${prev_global_stepd_rate}"
  global_stepd_count="${prev_global_stepd_count}"
  global_primary_metric="${prev_global_primary_metric}"
  global_weights="${prev_global_weights}"
  global_margin="${prev_global_margin}"
  global_second_pick="${prev_global_second_pick}"
  global_metric_source="${prev_global_metric_source}"
  global_validation_cumret="${prev_global_validation_cumret}"
  global_validation_mdd="${prev_global_validation_mdd}"
  promoted="false"

  if [[ "${best_promotable_effective}" != "true" ]]; then
    promoted="false"
  elif [[ -z "${global_weights}" ]]; then
    global_rate="${effective_best_rate}"
    global_count="${effective_best_count}"
    global_stepd_rate="${confirm_stepd_rate:-${best_rate}}"
    global_stepd_count="${confirm_stepd_count:-${best_count}}"
    global_primary_metric="${effective_best_primary_metric}"
    global_weights="${champ_weights}"
    global_margin="${gate_margin:-${seed_margin}}"
    global_second_pick="${gate_second_pick:-${seed_second_pick}}"
    global_metric_source="${effective_best_metric_source}"
    global_validation_cumret="${effective_best_cumret}"
    global_validation_mdd="${effective_best_mdd}"
    promoted="true"
  elif is_better_validation_candidate \
    "${effective_best_rate}" \
    "${effective_best_count}" \
    "${effective_best_cumret}" \
    "${effective_best_mdd}" \
    "${global_rate}" \
    "${global_count}" \
    "${global_validation_cumret}" \
    "${global_validation_mdd}" \
    "${PROMOTION_HIT_BAND}"; then
    global_rate="${effective_best_rate}"
    global_count="${effective_best_count}"
    global_stepd_rate="${confirm_stepd_rate:-${best_rate}}"
    global_stepd_count="${confirm_stepd_count:-${best_count}}"
    global_primary_metric="${effective_best_primary_metric}"
    global_weights="${champ_weights}"
    global_margin="${gate_margin:-${seed_margin}}"
    global_second_pick="${gate_second_pick:-${seed_second_pick}}"
    global_metric_source="${effective_best_metric_source}"
    global_validation_cumret="${effective_best_cumret}"
    global_validation_mdd="${effective_best_mdd}"
    promoted="true"
  fi

  if [[ -z "${global_weights}" || ! -f "${global_weights}" ]]; then
    global_weights="${champ_weights}"
  fi
  if [[ -z "${global_margin}" ]]; then
    global_margin="${seed_margin}"
  fi
  if [[ -z "${global_margin}" ]]; then
    global_margin="$(jq -r '.decisionGate.minScoreMargin // 0' "${CONFIG_PATH}")"
  fi
  if [[ -z "${global_second_pick}" || "${global_second_pick}" == "null" ]]; then
    global_second_pick="${seed_second_pick}"
  fi
  global_second_pick="$(normalize_second_pick_gate_json "${global_second_pick}")"
  oracle_champion_second_pick="$(normalize_second_pick_gate_json "${oracle_champion_second_pick}")"

  margin_upper_bound="$(resolve_margin_upper_bound)"
  if [[ -n "${gate_max_margin}" && "${gate_max_margin}" != "null" ]]; then
    margin_upper_bound="${gate_max_margin}"
  fi
  global_margin="$(clamp_margin_value "${global_margin:-0}" "${margin_upper_bound}")"
  margin_signal="$(resolve_margin_signal "${best_rate}" "${best_count}" "${best_top1_to_oracle_conversion}" "${best_oracle_hit_rate_topk}")"
  prev_margin_signal="HOLD"
  prev_margin_streak="0"
  if [[ -f "${STATE_PATH}" ]]; then
    prev_margin_signal="$(jq -r '.marginAdjust.lastSignal // "HOLD"' "${STATE_PATH}")"
    prev_margin_streak="$(jq -r '.marginAdjust.signalStreak // 0' "${STATE_PATH}")"
  fi
  prev_margin_streak="$(awk -v n="${prev_margin_streak}" 'BEGIN { x = int(n+0); if (x < 0) x = 0; print x }')"
  margin_signal_streak="0"
  if [[ "${margin_signal}" == "HOLD" ]]; then
    margin_signal_streak="0"
  elif [[ "${margin_signal}" == "${prev_margin_signal}" ]]; then
    margin_signal_streak=$((prev_margin_streak + 1))
  else
    margin_signal_streak="1"
  fi
  margin_confirm_runs="$(awk -v n="${MARGIN_SIGNAL_CONFIRM}" 'BEGIN { x = int(n+0); if (x < 1) x = 1; print x }')"
  margin_adjust_applied="false"
  margin_adjust_step="0"
  resume_next_margin="${global_margin}"
  if [[ "${margin_signal}" != "HOLD" && "${margin_signal_streak}" -ge "${margin_confirm_runs}" ]]; then
    if [[ "${margin_signal}" == "DOWN" ]]; then
      margin_adjust_step="$(calc_margin_step_down "${best_count}")"
      resume_next_margin="$(awk -v base="${global_margin}" -v step="${margin_adjust_step}" 'BEGIN { printf "%.6f", (base+0) - (step+0) }')"
    else
      margin_adjust_step="$(calc_margin_step_up "${best_rate}")"
      resume_next_margin="$(awk -v base="${global_margin}" -v step="${margin_adjust_step}" 'BEGIN { printf "%.6f", (base+0) + (step+0) }')"
    fi
    resume_next_margin="$(clamp_margin_value "${resume_next_margin}" "${margin_upper_bound}")"
    margin_adjust_applied="true"
    margin_signal_streak="0"
  fi

  goal_reached="false"
  if [[ "${validation_pass}" == "true" ]] && float_ge "${effective_best_rate}" "${GOAL_CONFIRM_WIN_RATE}" && float_ge "${effective_best_count}" "${GOAL_CONFIRM_TRADES}"; then
    goal_reached="true"
  fi

  jq -n \
    --arg ts "$(timestamp)" \
    --arg runId "${run_id}" \
    --arg sessionId "${session_id}" \
    --arg resumeWeightsPath "${global_weights}" \
    --arg latestWeightsCopyPath "${LATEST_WEIGHTS_COPY}" \
    --arg latestSnapshotCopyPath "${LATEST_SNAPSHOT_COPY}" \
    --argjson resumeSecondPickGate "${global_second_pick:-null}" \
    --argjson resumeMinScoreMargin "${resume_next_margin:-0}" \
    --argjson lastBestPickHitRate "${best_rate}" \
    --argjson lastBestPickedCount "${best_count}" \
    --argjson lastBestStepDPickHitRate "${stepd_best_pick_hit_rate}" \
    --argjson lastBestStepDPickedCount "${stepd_best_picked_count}" \
    --argjson validatedBestPickHitRate "${effective_best_rate}" \
    --argjson validatedBestPickedCount "${effective_best_count}" \
    --arg validatedBestPrimaryMetric "${effective_best_primary_metric}" \
    --argjson validatedBestStepEWinRate "${stepe_confirm_win_rate}" \
    --argjson validatedBestStepETotalTrades "${stepe_confirm_total_trades}" \
    --argjson validatedBestCumulativeReturn "${effective_best_cumret}" \
    --argjson validatedBestMaxDrawdown "${effective_best_mdd}" \
    --arg validatedBestMetricSource "${effective_best_metric_source}" \
    --argjson lastBestTwoPickDays "${best_two_pick_days}" \
    --argjson lastBestPickHitCount "${best_hit_count}" \
    --argjson lastBestWorkerPoolScoreMs "${best_worker_pool_score_ms}" \
    --argjson lastBestScoreMsPerSeed "${best_score_ms_per_seed}" \
    --argjson lastBestScoreMarginLowDays "${best_score_margin_low_days}" \
    --argjson lastBestOracleHitRateUniverse "${best_oracle_hit_rate_universe}" \
    --argjson lastBestOracleHitRateTopK "${best_oracle_hit_rate_topk}" \
    --argjson lastBestOracleMaxHitRateAtPickedGoalTopK "${best_oracle_max_hit_rate_topk_goal}" \
    --argjson lastBestOracleCoverageGap "${best_oracle_coverage_gap}" \
    --argjson lastBestTop1ToOracleConversion "${best_top1_to_oracle_conversion}" \
    --argjson lastBestTop1ToOracleGoalConversion "${best_top1_to_oracle_goal_conversion}" \
    --argjson lastBestTwoPickDates "${best_two_pick_dates_json:-[]}" \
    --argjson lastBestTwoPickHitDates "${best_two_pick_hit_dates_json:-[]}" \
    --arg bestDailyLogPath "${best_daily_log_path}" \
    --arg bestPromotable "${best_promotable_effective}" \
    --arg bestPromotableRaw "${best_promotable}" \
    --argjson globalBestPickHitRate "${global_rate}" \
    --argjson globalBestPickedCount "${global_count}" \
    --argjson globalBestStepDPickHitRate "${global_stepd_rate}" \
    --argjson globalBestStepDPickedCount "${global_stepd_count}" \
    --arg globalBestPrimaryMetric "${global_primary_metric}" \
    --argjson globalBestStepEWinRate "${global_rate}" \
    --argjson globalBestStepETotalTrades "${global_count}" \
    --argjson globalBestValidationCumulativeReturn "${global_validation_cumret}" \
    --argjson globalBestValidationMaxDrawdown "${global_validation_mdd}" \
    --arg globalBestWeightsPath "${global_weights}" \
    --argjson globalBestSecondPickGate "${global_second_pick:-null}" \
    --argjson globalBestGateMinScoreMargin "${global_margin:-0}" \
    --argjson globalBestGateMaxScoreMargin "${margin_upper_bound:-null}" \
    --arg globalBestMetricSource "${global_metric_source}" \
    --arg promoted "${promoted}" \
    --argjson lastGateMinScoreMargin "${gate_margin:-0}" \
    --argjson lastGateMaxScoreMargin "${gate_max_margin:-null}" \
    --arg marginSignal "${margin_signal}" \
    --argjson marginSignalStreak "${margin_signal_streak}" \
    --argjson marginConfirmRuns "${margin_confirm_runs}" \
    --arg marginAdjustApplied "${margin_adjust_applied}" \
    --argjson marginAdjustStep "${margin_adjust_step}" \
    --argjson marginUpperBound "${margin_upper_bound}" \
    --arg oracleDiscoveryEnabled "${oracle_discovery_enabled}" \
    --arg oraclePhase "${oracle_phase_next}" \
    --arg oraclePhasePrev "${prev_oracle_phase}" \
    --arg oracleMetThisRun "${oracle_met_this_run}" \
    --argjson oracleTopkTarget "${ORACLE_DISCOVERY_TOPK_TARGET}" \
    --argjson oracleGoalTopkTarget "${ORACLE_DISCOVERY_GOAL_TOPK_TARGET}" \
    --argjson oracleSustainRequired "${oracle_sustain_required}" \
    --argjson oracleSustainCount "${oracle_sustain_count_next}" \
    --argjson oracleChampionOracleTopK "${oracle_champion_topk}" \
    --argjson oracleChampionOracleGoalTopK "${oracle_champion_goal_topk}" \
    --argjson oracleChampionConversion "${oracle_champion_conversion}" \
    --arg oracleChampionWeightsPath "${oracle_champion_weights}" \
    --argjson oracleChampionGateMinScoreMargin "${oracle_champion_margin:-0}" \
    --argjson oracleChampionSecondPickGate "${oracle_champion_second_pick:-null}" \
    --arg oracleChampionRunId "${oracle_champion_run_id}" \
    --arg oracleChampionSessionId "${oracle_champion_session_id}" \
    --arg oracleChampionCTag "${oracle_champion_c_tag}" \
    --arg oracleChampionUpdatedAt "${oracle_champion_updated_at}" \
    --argjson goalPickHitRate "${GOAL_PICK_HIT_RATE}" \
    --argjson goalPickedCount "${GOAL_PICKED_COUNT}" \
    --arg goalPrimaryMetric "${PRIMARY_VALIDATION_METRIC_NAME}" \
    --arg goalPrimaryCountMetric "${PRIMARY_VALIDATION_COUNT_NAME}" \
    --argjson goalConfirmWinRate "${GOAL_CONFIRM_WIN_RATE}" \
    --argjson goalConfirmTrades "${GOAL_CONFIRM_TRADES}" \
    --arg smokeSummaryPath "${smoke_summary_path}" \
    --arg smokeSanity "${smoke_sanity}" \
    --arg smokeValidation "${smoke_validation}" \
    --arg smokeValidationReason "${smoke_validation_reason}" \
    --arg confirmSummaryPath "${confirm_summary_path}" \
    --arg confirmSanity "${confirm_sanity}" \
    --arg confirmValidation "${confirm_validation}" \
    --arg confirmValidationReason "${confirm_validation_reason}" \
    --arg validationPass "${validation_pass}" \
    --argjson runExitCode "${run_exit}" \
    --arg summaryPath "${summary_path}" \
    --arg snapshotPath "${snapshot_path}" \
    --arg statusLog "${STATUS_LOG}" \
    --argjson iteration "${iteration}" \
    '{
      updatedAt:$ts,
      runId:$runId,
      sessionId:$sessionId,
      iteration:$iteration,
      resumeWeightsPath:$resumeWeightsPath,
      resumeSecondPickGate:$resumeSecondPickGate,
      resumeMinScoreMargin:$resumeMinScoreMargin,
      latestWeightsCopyPath:$latestWeightsCopyPath,
      latestSnapshotCopyPath:$latestSnapshotCopyPath,
      lastBestPickHitRate:$lastBestPickHitRate,
      lastBestPickedCount:$lastBestPickedCount,
      lastBest:{
        stepD:{
          pickHitRate:$lastBestStepDPickHitRate,
          pickedCount:$lastBestStepDPickedCount
        }
      },
      validatedBestPickHitRate:$validatedBestPickHitRate,
      validatedBestPickedCount:$validatedBestPickedCount,
      validatedBestPrimaryMetric:$validatedBestPrimaryMetric,
      validatedBestPrimaryRate:$validatedBestStepEWinRate,
      validatedBestPrimaryCount:$validatedBestStepETotalTrades,
      validatedBestStepEWinRate:$validatedBestStepEWinRate,
      validatedBestStepETotalTrades:$validatedBestStepETotalTrades,
      validatedBestCumulativeReturn:$validatedBestCumulativeReturn,
      validatedBestMaxDrawdown:$validatedBestMaxDrawdown,
      validatedBestMetricSource:$validatedBestMetricSource,
      validatedBest:{
        stepD:{
          pickHitRate:$lastBestStepDPickHitRate,
          pickedCount:$lastBestStepDPickedCount
        },
        stepE:{
          primaryMetric:$validatedBestPrimaryMetric,
          primaryRate:$validatedBestStepEWinRate,
          primaryCount:$validatedBestStepETotalTrades,
          winRate:$validatedBestStepEWinRate,
          totalTrades:$validatedBestStepETotalTrades,
          cumulativeReturn:$validatedBestCumulativeReturn,
          maxDrawdown:$validatedBestMaxDrawdown
        }
      },
      lastBestTwoPickDays:$lastBestTwoPickDays,
      lastBestPickHitCount:$lastBestPickHitCount,
      lastBestWorkerPoolScoreMs:$lastBestWorkerPoolScoreMs,
      lastBestScoreMsPerSeed:$lastBestScoreMsPerSeed,
      lastBestScoreMarginLowDays:$lastBestScoreMarginLowDays,
      lastBestOracleHitRateUniverse:$lastBestOracleHitRateUniverse,
      lastBestOracleHitRateTopK:$lastBestOracleHitRateTopK,
      lastBestOracleMaxHitRateAtPickedGoalTopK:$lastBestOracleMaxHitRateAtPickedGoalTopK,
      lastBestOracleCoverageGap:$lastBestOracleCoverageGap,
      lastBestTop1ToOracleConversion:$lastBestTop1ToOracleConversion,
      lastBestTop1ToOracleGoalConversion:$lastBestTop1ToOracleGoalConversion,
      lastBestTwoPickDates:$lastBestTwoPickDates,
      lastBestTwoPickHitDates:$lastBestTwoPickHitDates,
      lastBestDailyLogPath:$bestDailyLogPath,
      lastBestPromotableRaw:($bestPromotableRaw=="true"),
      lastBestPromotable:($bestPromotable=="true"),
      validation:{
        smokeSummaryPath:$smokeSummaryPath,
        smokeSanityPass:($smokeSanity=="true"),
        smokeValidationPass:($smokeValidation=="true"),
        smokeValidationReason:$smokeValidationReason,
        confirmSummaryPath:$confirmSummaryPath,
        confirmSanityPass:($confirmSanity=="true"),
        confirmValidationPass:($confirmValidation=="true"),
        confirmValidationReason:$confirmValidationReason,
        pass:($validationPass=="true")
      },
      globalBest:{
        pickHitRate:$globalBestPickHitRate,
        pickedCount:$globalBestPickedCount,
        stepD:{
          pickHitRate:$globalBestStepDPickHitRate,
          pickedCount:$globalBestStepDPickedCount
        },
        stepE:{
          primaryMetric:$globalBestPrimaryMetric,
          primaryRate:$globalBestStepEWinRate,
          primaryCount:$globalBestStepETotalTrades,
          winRate:$globalBestStepEWinRate,
          totalTrades:$globalBestStepETotalTrades,
          cumulativeReturn:$globalBestValidationCumulativeReturn,
          maxDrawdown:$globalBestValidationMaxDrawdown
        },
        validationCumulativeReturn:$globalBestValidationCumulativeReturn,
        validationMaxDrawdown:$globalBestValidationMaxDrawdown,
        weightsPath:$globalBestWeightsPath,
        secondPickGate:$globalBestSecondPickGate,
        gateMinScoreMargin:$globalBestGateMinScoreMargin,
        gateMaxScoreMargin:$globalBestGateMaxScoreMargin,
        metricSource:$globalBestMetricSource
      },
      globalBestSecondPickGate:$globalBestSecondPickGate,
      globalBestGateMinScoreMargin:$globalBestGateMinScoreMargin,
      globalBestGateMaxScoreMargin:$globalBestGateMaxScoreMargin,
      promotedThisRun:($promoted=="true"),
      goal:{
        stepD:{pickHitRate:$goalPickHitRate,pickedCount:$goalPickedCount},
        stepE:{
          primaryMetric:$goalPrimaryMetric,
          primaryCountMetric:$goalPrimaryCountMetric,
          primaryRate:$goalConfirmWinRate,
          primaryCount:$goalConfirmTrades,
          winRate:$goalConfirmWinRate,
          totalTrades:$goalConfirmTrades
        }
      },
      lastGateMinScoreMargin:$lastGateMinScoreMargin,
      lastGateMaxScoreMargin:$lastGateMaxScoreMargin,
      marginAdjust:{
        lastSignal:$marginSignal,
        signalStreak:$marginSignalStreak,
        confirmRuns:$marginConfirmRuns,
        applied:($marginAdjustApplied=="true"),
        step:$marginAdjustStep,
        upperBound:$marginUpperBound,
        nextResumeMinScoreMargin:$resumeMinScoreMargin
      },
      oracleTracking:{
        enabled:($oracleDiscoveryEnabled=="1"),
        phase:$oraclePhase,
        previousPhase:$oraclePhasePrev,
        metThisRun:($oracleMetThisRun=="true"),
        topkTarget:$oracleTopkTarget,
        goalTopkTarget:$oracleGoalTopkTarget,
        sustainRequired:$oracleSustainRequired,
        sustainCount:$oracleSustainCount
      },
      oracleChampion:{
        oracleHitRateTopK:$oracleChampionOracleTopK,
        oracleMaxHitRateAtPickedGoalTopK:$oracleChampionOracleGoalTopK,
        top1ToOracleConversion:$oracleChampionConversion,
        weightsPath:$oracleChampionWeightsPath,
        gateMinScoreMargin:$oracleChampionGateMinScoreMargin,
        secondPickGate:$oracleChampionSecondPickGate,
        runId:$oracleChampionRunId,
        sessionId:$oracleChampionSessionId,
        cTag:$oracleChampionCTag,
        updatedAt:$oracleChampionUpdatedAt
      },
      goal:{
        stepD:{pickHitRate:$goalPickHitRate,pickedCount:$goalPickedCount},
        stepE:{
          primaryMetric:$goalPrimaryMetric,
          primaryCountMetric:$goalPrimaryCountMetric,
          primaryRate:$goalConfirmWinRate,
          primaryCount:$goalConfirmTrades,
          winRate:$goalConfirmWinRate,
          totalTrades:$goalConfirmTrades
        }
      },
      runExitCode:$runExitCode,
      summaryPath:$summaryPath,
      snapshotPath:$snapshotPath,
      statusLog:$statusLog
    }' > "${STATE_PATH}"

  append_status_log "$(jq -nc \
    --arg ts "$(timestamp)" \
    --arg runId "${run_id}" \
    --arg sessionId "${session_id}" \
    --argjson exitCode "${run_exit}" \
    --argjson pickHitRate "${best_rate}" \
    --argjson pickedCount "${best_count}" \
    --argjson stepDBestPickHitRate "${stepd_best_pick_hit_rate}" \
    --argjson stepDBestPickedCount "${stepd_best_picked_count}" \
    --argjson validatedPickHitRate "${effective_best_rate}" \
    --argjson validatedPickedCount "${effective_best_count}" \
    --arg validatedPrimaryMetric "${effective_best_primary_metric}" \
    --argjson validatedStepEWinRate "${stepe_confirm_win_rate}" \
    --argjson validatedStepETotalTrades "${stepe_confirm_total_trades}" \
    --argjson validatedBestCumulativeReturn "${effective_best_cumret}" \
    --argjson validatedBestMaxDrawdown "${effective_best_mdd}" \
    --arg validatedMetricSource "${effective_best_metric_source}" \
    --argjson pickHitCount "${best_hit_count}" \
    --argjson twoPickDays "${best_two_pick_days}" \
    --argjson workerPoolScoreMs "${best_worker_pool_score_ms}" \
    --argjson scoreMsPerSeed "${best_score_ms_per_seed}" \
    --argjson scoreMarginLowDays "${best_score_margin_low_days}" \
    --argjson oracleHitRateUniverse "${best_oracle_hit_rate_universe}" \
    --argjson oracleHitRateTopK "${best_oracle_hit_rate_topk}" \
    --argjson oracleMaxHitRateAtPickedGoalTopK "${best_oracle_max_hit_rate_topk_goal}" \
    --argjson oracleCoverageGap "${best_oracle_coverage_gap}" \
    --argjson top1ToOracleConversion "${best_top1_to_oracle_conversion}" \
    --argjson top1ToOracleGoalConversion "${best_top1_to_oracle_goal_conversion}" \
    --arg oraclePhase "${oracle_phase_next}" \
    --arg oracleMetThisRun "${oracle_met_this_run}" \
    --argjson oracleSustainCount "${oracle_sustain_count_next}" \
    --argjson oracleSustainRequired "${oracle_sustain_required}" \
    --argjson oracleChampionOracleTopK "${oracle_champion_topk}" \
    --argjson oracleChampionOracleGoalTopK "${oracle_champion_goal_topk}" \
    --argjson oracleChampionConversion "${oracle_champion_conversion}" \
    --argjson twoPickDates "${best_two_pick_dates_json:-[]}" \
    --argjson twoPickHitDates "${best_two_pick_hit_dates_json:-[]}" \
    --arg bestPromotable "${best_promotable_effective}" \
    --arg bestPromotableRaw "${best_promotable}" \
    --argjson globalPickHitRate "${global_rate}" \
    --argjson globalPickedCount "${global_count}" \
    --argjson globalStepDPickHitRate "${global_stepd_rate}" \
    --argjson globalStepDPickedCount "${global_stepd_count}" \
    --arg globalStepEPrimaryMetric "${global_primary_metric}" \
    --argjson globalStepEWinRate "${global_rate}" \
    --argjson globalStepETotalTrades "${global_count}" \
    --argjson globalBestValidationCumulativeReturn "${global_validation_cumret}" \
    --argjson globalBestValidationMaxDrawdown "${global_validation_mdd}" \
    --arg globalWeightsPath "${global_weights}" \
    --argjson globalSecondPickGate "${global_second_pick:-null}" \
    --argjson globalGateMinScoreMargin "${global_margin:-0}" \
    --argjson globalGateMaxScoreMargin "${margin_upper_bound:-null}" \
    --arg globalMetricSource "${global_metric_source}" \
    --argjson goalPickHitRate "${GOAL_PICK_HIT_RATE}" \
    --argjson goalPickedCount "${GOAL_PICKED_COUNT}" \
    --arg goalPrimaryMetric "${PRIMARY_VALIDATION_METRIC_NAME}" \
    --arg goalPrimaryCountMetric "${PRIMARY_VALIDATION_COUNT_NAME}" \
    --argjson goalConfirmWinRate "${GOAL_CONFIRM_WIN_RATE}" \
    --argjson goalConfirmTrades "${GOAL_CONFIRM_TRADES}" \
    --arg promoted "${promoted}" \
    --argjson gateMinScoreMargin "${gate_margin:-0}" \
    --argjson gateMaxScoreMargin "${gate_max_margin:-null}" \
    --arg marginSignal "${margin_signal}" \
    --argjson marginSignalStreak "${margin_signal_streak}" \
    --argjson marginConfirmRuns "${margin_confirm_runs}" \
    --arg marginAdjustApplied "${margin_adjust_applied}" \
    --argjson marginAdjustStep "${margin_adjust_step}" \
    --argjson nextResumeMinScoreMargin "${resume_next_margin:-0}" \
    --arg smokeSummaryPath "${smoke_summary_path}" \
    --arg smokeSanity "${smoke_sanity}" \
    --arg smokeValidation "${smoke_validation}" \
    --arg smokeValidationReason "${smoke_validation_reason}" \
    --arg confirmSummaryPath "${confirm_summary_path}" \
    --arg confirmSanity "${confirm_sanity}" \
    --arg confirmValidation "${confirm_validation}" \
    --arg confirmValidationReason "${confirm_validation_reason}" \
    --arg validationPass "${validation_pass}" \
    --arg goalReached "${goal_reached}" \
      '{ts:$ts,runId:$runId,sessionId:$sessionId,exitCode:$exitCode,best:{pickHitRate:$pickHitRate,pickedCount:$pickedCount,stepD:{pickHitRate:$stepDBestPickHitRate,pickedCount:$stepDBestPickedCount},stepE:{primaryMetric:$validatedPrimaryMetric,primaryRate:$validatedStepEWinRate,primaryCount:$validatedStepETotalTrades,winRate:$validatedStepEWinRate,totalTrades:$validatedStepETotalTrades,cumulativeReturn:$validatedBestCumulativeReturn,maxDrawdown:$validatedBestMaxDrawdown},validatedPickHitRate:$validatedPickHitRate,validatedPickedCount:$validatedPickedCount,validatedPrimaryMetric:$validatedPrimaryMetric,validatedPrimaryRate:$validatedStepEWinRate,validatedPrimaryCount:$validatedStepETotalTrades,validatedStepEWinRate:$validatedStepEWinRate,validatedStepETotalTrades:$validatedStepETotalTrades,validatedCumulativeReturn:$validatedBestCumulativeReturn,validatedMaxDrawdown:$validatedBestMaxDrawdown,validatedMetricSource:$validatedMetricSource,pickHitCount:$pickHitCount,twoPickDays:$twoPickDays,workerPoolScoreMs:$workerPoolScoreMs,scoreMsPerSeed:$scoreMsPerSeed,scoreMarginLowDays:$scoreMarginLowDays,oracleHitRateUniverse:$oracleHitRateUniverse,oracleHitRateTopK:$oracleHitRateTopK,oracleMaxHitRateAtPickedGoalTopK:$oracleMaxHitRateAtPickedGoalTopK,oracleCoverageGap:$oracleCoverageGap,top1ToOracleConversion:$top1ToOracleConversion,top1ToOracleGoalConversion:$top1ToOracleGoalConversion,twoPickDates:$twoPickDates,twoPickHitDates:$twoPickHitDates,promotable:($bestPromotable=="true"),promotableRaw:($bestPromotableRaw=="true")},validation:{smokeSummaryPath:$smokeSummaryPath,smokeSanityPass:($smokeSanity=="true"),smokeValidationPass:($smokeValidation=="true"),smokeValidationReason:$smokeValidationReason,confirmSummaryPath:$confirmSummaryPath,confirmSanityPass:($confirmSanity=="true"),confirmValidationPass:($confirmValidation=="true"),confirmValidationReason:$confirmValidationReason,pass:($validationPass=="true")},globalBest:{pickHitRate:$globalPickHitRate,pickedCount:$globalPickedCount,stepD:{pickHitRate:$globalStepDPickHitRate,pickedCount:$globalStepDPickedCount},stepE:{primaryMetric:$globalStepEPrimaryMetric,primaryRate:$globalStepEWinRate,primaryCount:$globalStepETotalTrades,winRate:$globalStepEWinRate,totalTrades:$globalStepETotalTrades,cumulativeReturn:$globalBestValidationCumulativeReturn,maxDrawdown:$globalBestValidationMaxDrawdown},validationCumulativeReturn:$globalBestValidationCumulativeReturn,validationMaxDrawdown:$globalBestValidationMaxDrawdown,weightsPath:$globalWeightsPath,secondPickGate:$globalSecondPickGate,gateMinScoreMargin:$globalGateMinScoreMargin,gateMaxScoreMargin:$globalGateMaxScoreMargin,metricSource:$globalMetricSource},oracleTracking:{phase:$oraclePhase,metThisRun:($oracleMetThisRun=="true"),sustainCount:$oracleSustainCount,sustainRequired:$oracleSustainRequired,champion:{oracleHitRateTopK:$oracleChampionOracleTopK,oracleMaxHitRateAtPickedGoalTopK:$oracleChampionOracleGoalTopK,top1ToOracleConversion:$oracleChampionConversion}},promotedThisRun:($promoted=="true"),gateMinScoreMargin:$gateMinScoreMargin,gateMaxScoreMargin:$gateMaxScoreMargin,marginAdjust:{signal:$marginSignal,streak:$marginSignalStreak,confirmRuns:$marginConfirmRuns,applied:($marginAdjustApplied=="true"),step:$marginAdjustStep,nextResumeMinScoreMargin:$nextResumeMinScoreMargin},goal:{stepD:{pickHitRate:$goalPickHitRate,pickedCount:$goalPickedCount},stepE:{primaryMetric:$goalPrimaryMetric,primaryCountMetric:$goalPrimaryCountMetric,primaryRate:$goalConfirmWinRate,primaryCount:$goalConfirmTrades,winRate:$goalConfirmWinRate,totalTrades:$goalConfirmTrades}},goalReached:($goalReached=="true")}')"

  checkpoint_path="$(write_iteration_checkpoint \
    "${run_id}" \
    "${session_id}" \
    "${summary_path}" \
    "${run_exit}" \
    "${best_rate}" \
    "${best_count}" \
    "${best_two_pick_days}" \
    "${gate_margin:-0}" \
    "${gate_second_pick:-null}" \
    "${global_rate}" \
    "${global_count}" \
    "${global_margin:-0}" \
    "${global_second_pick:-null}" \
    "${global_weights}" \
    "${promoted}" \
    "${goal_reached}" \
    "${smoke_summary_path}" \
    "${smoke_sanity}" \
    "${confirm_summary_path}" \
    "${confirm_sanity}" \
    "${validation_pass}")"

  append_status_log "$(jq -nc \
    --arg ts "$(timestamp)" \
    --arg runId "${run_id}" \
    --arg sessionId "${session_id}" \
    --arg checkpointPath "${checkpoint_path}" \
    '{ts:$ts,runId:$runId,sessionId:$sessionId,status:"checkpoint_written",checkpointPath:$checkpointPath}')"

  echo "[$(timestamp)] [summary] run_id=${run_id} pickHitRate=${best_rate} pickedCount=${best_count} validatedPrimaryMetric=${effective_best_primary_metric} validatedPrimaryRate=${effective_best_rate} validatedPrimaryCount=${effective_best_count} twoPickDays=${best_two_pick_days} scoreMarginLowDays=${best_score_margin_low_days} oracleHitRateUniverse=${best_oracle_hit_rate_universe} oracleHitRateTopK=${best_oracle_hit_rate_topk} oracleMaxHitRateAtPickedGoalTopK=${best_oracle_max_hit_rate_topk_goal} oracleCoverageGap=${best_oracle_coverage_gap} top1ToOracleConversion=${best_top1_to_oracle_conversion} top1ToOracleGoalConversion=${best_top1_to_oracle_goal_conversion} oraclePhase=${oracle_phase_next} oracleMetThisRun=${oracle_met_this_run} oracleSustain=${oracle_sustain_count_next}/${oracle_sustain_required} oracleChampionTopK=${oracle_champion_topk} oracleChampionGoalTopK=${oracle_champion_goal_topk} oracleChampionConversion=${oracle_champion_conversion} workerPoolScoreMs=${best_worker_pool_score_ms} scoreMsPerSeed=${best_score_ms_per_seed} twoPickDates=${best_two_pick_dates_json} promotableRaw=${best_promotable} validationPass=${validation_pass} smokeSanity=${smoke_sanity} smokeValidation=${smoke_validation} smokeValidationReason=${smoke_validation_reason} confirmSanity=${confirm_sanity} confirmValidation=${confirm_validation} confirmValidationReason=${confirm_validation_reason} promotable=${best_promotable_effective} promoted=${promoted} globalBestRate=${global_rate} globalBestCount=${global_count} globalBestPrimaryMetric=${global_primary_metric} globalGateMinScoreMargin=${global_margin} gateMaxScoreMargin=${gate_max_margin} marginSignal=${margin_signal} marginSignalStreak=${margin_signal_streak} marginAdjustApplied=${margin_adjust_applied} nextResumeMinScoreMargin=${resume_next_margin} goalReached=${goal_reached} checkpoint=${checkpoint_path}" | tee -a "${run_log}"

  if [[ "${goal_reached}" == "true" ]]; then
    echo "[$(timestamp)] [done] goal reached. stopping autopilot." | tee -a "${run_log}"
    exit 0
  fi

  if [[ "${run_exit}" -eq 2 || "${run_exit}" -eq 3 ]]; then
    echo "[$(timestamp)] [info] policy-cycle validation rejected candidate exit=${run_exit}. sleep ${LOOP_SLEEP_SEC}s" | tee -a "${run_log}"
    sleep "${LOOP_SLEEP_SEC}"
  elif [[ "${run_exit}" -ne 0 ]]; then
    echo "[$(timestamp)] [warn] policy-cycle exit=${run_exit}. backoff ${FAIL_BACKOFF_SEC}s" | tee -a "${run_log}"
    sleep "${FAIL_BACKOFF_SEC}"
  else
    sleep "${LOOP_SLEEP_SEC}"
  fi
done
