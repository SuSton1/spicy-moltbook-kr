#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEMORY_JSON="$ROOT/meta/experiment_patch_memory.json"
REGISTRY_JSONL="$ROOT/meta/experiment_registry.jsonl"
LEGACY_ARCHIVE_JSON="$ROOT/meta/legacy_experiment_archive.json"
SCOREBOARD_JSON="$ROOT/reports/target_first_probe_scoreboard.json"

usage() {
  cat <<'EOF'
Usage:
  tools/register_experiment_result.sh \
    --patch-key=<key> \
    --status=<status> \
    [--scope=<scope>] \
    [--candidate-mode=<mode>] \
    [--goal-mode=<goal_mode>] \
    [--position-semantics=<semantics>] \
    [--probe-id=<probe>] \
    [--run-ids=<id1,id2>] \
    [--summary=<text>] \
    [--primary-metrics=<json>] \
    [--secondary-metrics=<json>] \
    [--set-baseline=true|false] \
    [--add-do-not-repeat=true|false] \
    [--date=<yyyy-mm-dd>]
EOF
}

PATCH_KEY=""
STATUS=""
SCOPE="target_first_v2"
CANDIDATE_MODE=""
GOAL_MODE="TARGET_FIRST_V2"
POSITION_SEMANTICS="OVERLAP_DAILY_ONE_PICK_V2"
PROBE_ID=""
RUN_IDS=""
SUMMARY=""
PRIMARY_METRICS="{}"
SECONDARY_METRICS="{}"
SET_BASELINE=""
ADD_DO_NOT_REPEAT=""
DATE_VALUE=""

for arg in "$@"; do
  case "$arg" in
    --patch-key=*) PATCH_KEY="${arg#*=}" ;;
    --status=*) STATUS="${arg#*=}" ;;
    --scope=*) SCOPE="${arg#*=}" ;;
    --candidate-mode=*) CANDIDATE_MODE="${arg#*=}" ;;
    --goal-mode=*) GOAL_MODE="${arg#*=}" ;;
    --position-semantics=*) POSITION_SEMANTICS="${arg#*=}" ;;
    --probe-id=*) PROBE_ID="${arg#*=}" ;;
    --run-ids=*) RUN_IDS="${arg#*=}" ;;
    --summary=*) SUMMARY="${arg#*=}" ;;
    --primary-metrics=*) PRIMARY_METRICS="${arg#*=}" ;;
    --secondary-metrics=*) SECONDARY_METRICS="${arg#*=}" ;;
    --set-baseline=*) SET_BASELINE="${arg#*=}" ;;
    --add-do-not-repeat=*) ADD_DO_NOT_REPEAT="${arg#*=}" ;;
    --date=*) DATE_VALUE="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "[fatal] unknown arg: $arg" >&2
      usage >&2
      exit 4
      ;;
  esac
done

if [[ -z "$PATCH_KEY" || -z "$STATUS" ]]; then
  echo "[fatal] --patch-key and --status are required" >&2
  usage >&2
  exit 4
fi

python3 - "$MEMORY_JSON" "$REGISTRY_JSONL" "$LEGACY_ARCHIVE_JSON" "$SCOREBOARD_JSON" "$PATCH_KEY" "$STATUS" "$SCOPE" "$CANDIDATE_MODE" "$GOAL_MODE" "$POSITION_SEMANTICS" "$PROBE_ID" "$RUN_IDS" "$SUMMARY" "$PRIMARY_METRICS" "$SECONDARY_METRICS" "$SET_BASELINE" "$ADD_DO_NOT_REPEAT" "$DATE_VALUE" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

(
    memory_path,
    registry_path,
    legacy_archive_path,
    scoreboard_path,
    patch_key,
    status,
    scope,
    candidate_mode,
    goal_mode,
    position_semantics,
    probe_id,
    run_ids_raw,
    summary,
    primary_metrics_raw,
    secondary_metrics_raw,
    set_baseline_raw,
    add_do_not_repeat_raw,
    date_value,
) = sys.argv[1:]

def parse_json(text):
    text = str(text or "").strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception as exc:
        raise SystemExit(f"[fatal] invalid json payload: {exc}")

def parse_bool(text, default=None):
    value = str(text or "").strip().lower()
    if not value:
        return default
    if value in {"1", "true", "yes", "y", "on"}:
        return True
    if value in {"0", "false", "no", "n", "off"}:
        return False
    raise SystemExit(f"[fatal] invalid bool flag: {text}")

def normalize_key(value):
    text = str(value or "").strip().lower()
    text = text.replace("-", "_").replace(" ", "_")
    while "__" in text:
        text = text.replace("__", "_")
    return text

def ensure_parent(path_text):
    Path(path_text).parent.mkdir(parents=True, exist_ok=True)

primary_metrics = parse_json(primary_metrics_raw)
secondary_metrics = parse_json(secondary_metrics_raw)
set_baseline = parse_bool(set_baseline_raw, None)
add_do_not_repeat = parse_bool(add_do_not_repeat_raw, None)
run_ids = [item.strip() for item in str(run_ids_raw or "").split(",") if item.strip()]
ts = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
date_text = date_value.strip() if str(date_value or "").strip() else ts[:10]
goal_key = f"{goal_mode}::{position_semantics}"
normalized_patch_key = normalize_key(patch_key)

entry = {
    "ts": ts,
    "patchKey": patch_key,
    "status": status,
    "scope": scope,
    "candidateMode": candidate_mode or None,
    "goalMode": goal_mode,
    "positionSemantics": position_semantics,
    "probeId": probe_id or None,
    "runIds": run_ids,
    "primaryMetrics": primary_metrics,
    "secondaryMetrics": secondary_metrics,
    "notes": summary or None,
}

ensure_parent(registry_path)
with open(registry_path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps(entry, ensure_ascii=True) + "\n")

with open(memory_path, "r", encoding="utf-8") as fh:
    memory = json.load(fh)

memory["updatedAt"] = ts
memory.setdefault("recentTargetFirstHighlights", [])
memory.setdefault("legacyArchiveRef", "meta/legacy_experiment_archive.json")
memory.setdefault("recentExperimentLog", [])
memory.setdefault("doNotRepeat", [])
memory.setdefault("goalModePolicy", {})
memory["goalModePolicy"].setdefault("acceptedBaselineByGoalMode", {})

memory["recentExperimentLog"].append({
    "date": date_text,
    "key": patch_key,
    "goalMode": goal_mode,
    "positionSemantics": position_semantics,
    "scope": scope,
    "candidateMode": candidate_mode or None,
    "status": status,
    "runs": run_ids,
    "summary": summary or "",
})

if goal_mode == "TARGET_FIRST_V2":
    memory["recentTargetFirstHighlights"].append({
        "date": date_text,
        "key": patch_key,
        "scope": scope,
        "candidateMode": candidate_mode or None,
        "probeId": probe_id or None,
        "status": status,
        "runs": run_ids,
        "primaryMetrics": primary_metrics,
        "summary": summary or "",
    })
    memory["recentTargetFirstHighlights"] = memory["recentTargetFirstHighlights"][-20:]

should_set_baseline = (
    set_baseline is True or
    (set_baseline is None and status in {"accepted_baseline", "promoted_baseline"})
)
if should_set_baseline:
    memory["goalModePolicy"]["acceptedBaselineByGoalMode"][goal_key] = {
        "patchKey": patch_key,
        "probeId": probe_id or None,
        "runIds": run_ids,
        "date": date_text,
        "status": status,
        "summary": summary or "",
        "primaryMetrics": primary_metrics,
    }

terminal_repeat_block_statuses = {
    "failed_and_reverted",
    "invalid_or_inconclusive",
    "forbidden",
}
should_add_do_not_repeat = (
    add_do_not_repeat is True or
    (add_do_not_repeat is None and status in terminal_repeat_block_statuses)
)
if should_add_do_not_repeat:
    existing = next(
        (
            row for row in memory["doNotRepeat"]
            if normalize_key(row.get("patchKey")) == normalized_patch_key
            and str(row.get("scope", "")).strip() == scope
            and str(row.get("goalMode", "")).strip() == goal_mode
            and str(row.get("positionSemantics", "")).strip() == position_semantics
        ),
        None,
    )
    do_not_repeat_row = {
        "probeId": probe_id or None,
        "patchKey": patch_key,
        "goalMode": goal_mode,
        "positionSemantics": position_semantics,
        "scope": scope,
        "candidateMode": candidate_mode or None,
        "area": "RESEARCH_CONTROL_PLANE",
        "status": status,
        "reason": summary or f"Auto-promoted from status={status}",
    }
    if existing is None:
        memory["doNotRepeat"].append(do_not_repeat_row)
    else:
        existing.update(do_not_repeat_row)

legacy_keys = {
    normalize_key(item)
    for item in (memory.get("legacyGoalMisalignedKeys") or [])
}
should_archive_legacy = scope == "legacy_only" or normalized_patch_key in legacy_keys or goal_mode == "LEGACY_PNL_V1"
if should_archive_legacy:
    try:
        with open(legacy_archive_path, "r", encoding="utf-8") as fh:
            legacy_archive = json.load(fh)
    except FileNotFoundError:
        legacy_archive = {
            "version": 1,
            "updatedAt": ts,
            "goalMode": "LEGACY_PNL_V1",
            "positionSemantics": "SINGLE_POSITION_V1",
            "archivedKeys": [],
            "archivedEntries": [],
            "notes": [],
        }
    legacy_archive.setdefault("archivedKeys", [])
    legacy_archive.setdefault("archivedEntries", [])
    if patch_key not in legacy_archive["archivedKeys"]:
        legacy_archive["archivedKeys"].append(patch_key)
    legacy_entry = {
        "date": date_text,
        "patchKey": patch_key,
        "status": status,
        "scope": scope,
        "probeId": probe_id or None,
        "runIds": run_ids,
        "summary": summary or "",
    }
    existing_legacy = next(
        (row for row in legacy_archive["archivedEntries"] if normalize_key(row.get("patchKey")) == normalized_patch_key),
        None,
    )
    if existing_legacy is None:
        legacy_archive["archivedEntries"].append(legacy_entry)
    else:
        existing_legacy.update(legacy_entry)
    legacy_archive["updatedAt"] = ts
    ensure_parent(legacy_archive_path)
    with open(legacy_archive_path, "w", encoding="utf-8") as fh:
        json.dump(legacy_archive, fh, ensure_ascii=True, indent=2)
        fh.write("\n")

with open(memory_path, "w", encoding="utf-8") as fh:
    json.dump(memory, fh, ensure_ascii=True, indent=2)
    fh.write("\n")

def metric_value(row, container_key, metric_key, default, invert=False):
    value = row.get(container_key, {}).get(metric_key, default)
    try:
        numeric = float(value)
    except Exception:
        numeric = float(default)
    return -numeric if invert else numeric

try:
    with open(registry_path, "r", encoding="utf-8") as fh:
        registry_rows = [json.loads(line) for line in fh if line.strip()]
except FileNotFoundError:
    registry_rows = []

target_rows = [
    row for row in registry_rows
    if str(row.get("goalMode", "")).strip() == "TARGET_FIRST_V2"
    and str(row.get("positionSemantics", "")).strip() == "OVERLAP_DAILY_ONE_PICK_V2"
]

best_by_probe = {}
for row in target_rows:
    probe = str(row.get("probeId") or "").strip()
    if not probe:
        continue
    current = best_by_probe.get(probe)
    score = (
        metric_value(row, "primaryMetrics", "targetHitRate", 0.0),
        metric_value(row, "primaryMetrics", "targetHitCount", 0.0),
        metric_value(row, "primaryMetrics", "targetsPer20TradingDays", 0.0),
        metric_value(row, "secondaryMetrics", "stopRate", 1.0, invert=True),
        metric_value(row, "secondaryMetrics", "timeoutNegativeRate", 1.0, invert=True),
        str(row.get("ts", "")),
    )
    current_score = current.get("_score") if current else None
    if current is None or score > current_score:
        next_row = dict(row)
        next_row["_score"] = score
        best_by_probe[probe] = next_row

scoreboard_rows = []
for probe, row in sorted(best_by_probe.items(), key=lambda item: item[0]):
    safe = dict(row)
    safe.pop("_score", None)
    scoreboard_rows.append(safe)

scoreboard_rows.sort(
    key=lambda row: (
        metric_value(row, "primaryMetrics", "targetHitRate", 0.0),
        metric_value(row, "primaryMetrics", "targetHitCount", 0.0),
        metric_value(row, "primaryMetrics", "targetsPer20TradingDays", 0.0),
        metric_value(row, "secondaryMetrics", "stopRate", 1.0, invert=True),
        metric_value(row, "secondaryMetrics", "timeoutNegativeRate", 1.0, invert=True),
        str(row.get("ts", "")),
    ),
    reverse=True,
)

scoreboard_payload = {
    "generatedAt": ts,
    "goalMode": "TARGET_FIRST_V2",
    "positionSemantics": "OVERLAP_DAILY_ONE_PICK_V2",
    "sourceRegistryPath": "meta/experiment_registry.jsonl",
    "rows": scoreboard_rows,
}
ensure_parent(scoreboard_path)
with open(scoreboard_path, "w", encoding="utf-8") as fh:
    json.dump(scoreboard_payload, fh, ensure_ascii=True, indent=2)
    fh.write("\n")

print(f"[ok] registered patchKey={patch_key} status={status}")
PY
