#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/check_probe_monotonic_progress.sh --previous=<probe_dir> --current=<probe_dir>

Notes:
  - probe_dir should be a cd-loop probe session directory, e.g.
    artifacts/runs/<run-id>/cd-loop/codex_stepE_probe20_20260307
  - Compares the current probe against the previous accepted probe.
  - Fails if any required metric regresses.
  - Requires at least one strict improvement.
EOF
}

PREV_DIR=""
CURR_DIR=""

for arg in "$@"; do
  case "$arg" in
    --previous=*)
      PREV_DIR="${arg#--previous=}"
      ;;
    --current=*)
      CURR_DIR="${arg#--current=}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[fatal] unknown arg: $arg" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$PREV_DIR" || -z "$CURR_DIR" ]]; then
  echo "[fatal] --previous and --current are required" >&2
  usage
  exit 1
fi

resolve_stepd_summary() {
  local probe_dir="$1"
  local full_path="$probe_dir/r01/e01_full/step-d/step_d_summary.json"
  local fast_path="$probe_dir/r01/e01/step-d/step_d_summary.json"
  if [[ -f "$full_path" ]]; then
    printf '%s\n' "$full_path"
    return 0
  fi
  if [[ -f "$fast_path" ]]; then
    printf '%s\n' "$fast_path"
    return 0
  fi
  return 1
}

resolve_stepe_summary() {
  local probe_dir="$1"
  local step_e_path="$probe_dir/lockbox-eval/r01/step-e/step_e_summary.json"
  if [[ -f "$step_e_path" ]]; then
    printf '%s\n' "$step_e_path"
    return 0
  fi
  return 1
}

PREV_STEPD="$(resolve_stepd_summary "$PREV_DIR")" || {
  echo "[fatal] previous step_d_summary missing under: $PREV_DIR" >&2
  exit 1
}
CURR_STEPD="$(resolve_stepd_summary "$CURR_DIR")" || {
  echo "[fatal] current step_d_summary missing under: $CURR_DIR" >&2
  exit 1
}

PREV_STEPE="$(resolve_stepe_summary "$PREV_DIR" || true)"
CURR_STEPE="$(resolve_stepe_summary "$CURR_DIR" || true)"

python3 - "$PREV_STEPD" "$CURR_STEPD" "$PREV_STEPE" "$CURR_STEPE" <<'PY'
import json
import os
import sys

prev_stepd, curr_stepd, prev_stepe, curr_stepe = sys.argv[1:5]
eps = 1e-12

with open(prev_stepd) as f:
    prev_d = json.load(f)
with open(curr_stepd) as f:
    curr_d = json.load(f)

prev_e = None
curr_e = None
if prev_stepe:
    with open(prev_stepe) as f:
        prev_e = json.load(f)
if curr_stepe:
    with open(curr_stepe) as f:
        curr_e = json.load(f)

checks = [
    ("step_d.pickHitRateEval", float(prev_d.get("pickHitRateEval") or 0), float(curr_d.get("pickHitRateEval") or 0)),
    ("step_d.executedHitRateEval", float(prev_d.get("executedHitRateEval") or 0), float(curr_d.get("executedHitRateEval") or 0)),
    ("step_d.top1ToOracleConversionEval", float(prev_d.get("top1ToOracleConversionEval") or 0), float(curr_d.get("top1ToOracleConversionEval") or 0)),
]

if bool(prev_e) != bool(curr_e):
    print("[fatal] Step E availability mismatch between probes", file=sys.stderr)
    print(json.dumps({
        "previousStepE": bool(prev_e),
        "currentStepE": bool(curr_e),
    }, ensure_ascii=False, indent=2), file=sys.stderr)
    sys.exit(1)

if prev_e and curr_e:
    checks.extend([
        ("step_e.winRate", float(prev_e.get("winRate") or 0), float(curr_e.get("winRate") or 0)),
        ("step_e.avgNetRet", float(prev_e.get("avgNetRet") or 0), float(curr_e.get("avgNetRet") or 0)),
        ("step_e.cumulativeReturn", float(prev_e.get("cumulativeReturn") or 0), float(curr_e.get("cumulativeReturn") or 0)),
    ])

regressions = []
improvements = []
for name, prev_value, curr_value in checks:
    if curr_value + eps < prev_value:
      regressions.append({
          "metric": name,
          "previous": prev_value,
          "current": curr_value,
      })
    elif curr_value > prev_value + eps:
      improvements.append({
          "metric": name,
          "previous": prev_value,
          "current": curr_value,
      })

result = {
    "previousProbe": os.path.dirname(os.path.dirname(os.path.dirname(prev_stepd))),
    "currentProbe": os.path.dirname(os.path.dirname(os.path.dirname(curr_stepd))),
    "checks": [
        {
            "metric": name,
            "previous": prev_value,
            "current": curr_value,
            "delta": curr_value - prev_value,
        }
        for name, prev_value, curr_value in checks
    ],
    "regressions": regressions,
    "improvements": improvements,
}

print(json.dumps(result, ensure_ascii=False, indent=2))
if regressions:
    sys.exit(1)
if not improvements:
    print("[fatal] no strict improvement detected", file=sys.stderr)
    sys.exit(1)
PY
