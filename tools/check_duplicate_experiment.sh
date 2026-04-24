#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEMORY_JSON="$ROOT/meta/experiment_patch_memory.json"
CONTRACT_JSON="$ROOT/meta/active_research_contract.json"
SHORTLIST_JSON="$ROOT/meta/target_first_probe_shortlist.json"
REGISTRY_JSONL="$ROOT/meta/experiment_registry.jsonl"

usage() {
  cat <<'EOF'
Usage:
  tools/check_duplicate_experiment.sh --patch-key=<key> [--run-id=<run_id>] [--scope=<scope>] [--probe-id=<probe_id>] [--candidate-mode=<mode>] [--major-change-type=<type>] [--root=<repo_root>]

Notes:
  - target-first exploratory scopes require --probe-id and enforce the active shortlist.
  - target-first exploratory/confirm/final scopes require --candidate-mode.

Exit codes:
  0 = safe/new
  2 = duplicate or already logged
  3 = forbidden / do-not-repeat
  4 = invalid input
EOF
}

PATCH_KEY=""
RUN_ID=""
SCOPE=""
PROBE_ID=""
CANDIDATE_MODE=""
MAJOR_CHANGE_TYPE=""

for arg in "$@"; do
  case "$arg" in
    --patch-key=*)
      PATCH_KEY="${arg#*=}"
      ;;
    --run-id=*)
      RUN_ID="${arg#*=}"
      ;;
    --scope=*)
      SCOPE="${arg#*=}"
      ;;
    --probe-id=*)
      PROBE_ID="${arg#*=}"
      ;;
    --candidate-mode=*)
      CANDIDATE_MODE="${arg#*=}"
      ;;
    --major-change-type=*)
      MAJOR_CHANGE_TYPE="${arg#*=}"
      ;;
    --root=*)
      ROOT="${arg#*=}"
      MEMORY_JSON="$ROOT/meta/experiment_patch_memory.json"
      CONTRACT_JSON="$ROOT/meta/active_research_contract.json"
      SHORTLIST_JSON="$ROOT/meta/target_first_probe_shortlist.json"
      REGISTRY_JSONL="$ROOT/meta/experiment_registry.jsonl"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$PATCH_KEY" ]]; then
        PATCH_KEY="$arg"
      else
        echo "[fatal] unknown arg: $arg" >&2
        usage >&2
        exit 4
      fi
      ;;
  esac
done

if [[ -z "$PATCH_KEY" ]]; then
  echo "[fatal] missing --patch-key" >&2
  usage >&2
  exit 4
fi

if [[ ! -f "$MEMORY_JSON" ]]; then
  echo "[fatal] memory file not found: $MEMORY_JSON" >&2
  exit 4
fi

python3 - "$MEMORY_JSON" "$CONTRACT_JSON" "$SHORTLIST_JSON" "$REGISTRY_JSONL" "$ROOT/meta/candidate_mode_manifest.json" "$PATCH_KEY" "$RUN_ID" "$SCOPE" "$PROBE_ID" "$CANDIDATE_MODE" "$MAJOR_CHANGE_TYPE" <<'PY'
import json
import sys

memory_path, contract_path, shortlist_path, registry_path, manifest_path, patch_key_raw, run_id_raw, scope_raw, probe_id_raw, candidate_mode_raw, major_change_type_raw = sys.argv[1:]

def normalize_key(value):
    text = str(value or "").strip().lower()
    text = text.replace("-", "_").replace(" ", "_")
    while "__" in text:
        text = text.replace("__", "_")
    return text

def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default
    except Exception as exc:
        print(f"[fatal] failed to read json {path}: {exc}", file=sys.stderr)
        raise SystemExit(4)

def load_jsonl(path):
    rows = []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                text = line.strip()
                if not text:
                    continue
                try:
                    rows.append(json.loads(text))
                except Exception:
                    continue
    except FileNotFoundError:
        return []
    except Exception as exc:
        print(f"[fatal] failed to read jsonl {path}: {exc}", file=sys.stderr)
        raise SystemExit(4)
    return rows

memory = load_json(memory_path, {})
contract = load_json(contract_path, {})
shortlist = load_json(shortlist_path, {})
registry_rows = load_jsonl(registry_path)
candidate_manifest = load_json(manifest_path, {})

patch_key = normalize_key(patch_key_raw)
run_id = str(run_id_raw or "").strip()
scope = normalize_key(scope_raw)
probe_id = str(probe_id_raw or "").strip()
candidate_mode = normalize_key(candidate_mode_raw)
major_change_type = normalize_key(major_change_type_raw)
if not major_change_type and candidate_mode:
    major_change_type = candidate_mode
legacy_goal_misaligned = {
    normalize_key(item)
    for item in (memory.get("legacyGoalMisalignedKeys") or [])
}
contract_forbidden = {
    normalize_key(item)
    for item in (contract.get("forbiddenLegacyPatchKeys") or [])
}
allowed_scopes = {
    normalize_key(item)
    for item in (contract.get("allowedExperimentScopes") or [])
}
allowed_candidate_modes = {
    normalize_key(item)
    for item in (contract.get("allowedCandidateModes") or [])
}
allowed_major_change_types = {
    normalize_key(item)
    for item in ((((contract.get("researchMode") or {}).get("candidateControlPlane") or {}).get("allowedMajorChangeTypes")) or [])
}
active_goal = str(contract.get("goalMode", "")).strip().upper()
active_position_semantics = str(contract.get("positionSemantics", "")).strip().upper()
memory_goal = str(memory.get("goalModePolicy", {}).get("activeGoalMode", "")).strip().upper()
memory_position_semantics = str(memory.get("goalModePolicy", {}).get("activePositionSemantics", "")).strip().upper()

def scope_allows(row_scope, active_scope):
    row_scope_norm = normalize_key(row_scope or "global")
    active_scope_norm = normalize_key(active_scope or "")
    if not active_scope_norm:
        return True
    if row_scope_norm in ("", "global", "all"):
        return True
    return row_scope_norm == active_scope_norm

def target_first_scope(active_scope):
    return "target_first_v2" in normalize_key(active_scope)

def requires_candidate_mode(active_scope):
    scope_norm = normalize_key(active_scope)
    return scope_norm in {
        "exploratory_target_first_v2",
        "confirm_target_first_v2",
        "final_target_first_v2",
    }

if target_first_scope(scope):
    if allowed_scopes and scope not in allowed_scopes:
        print(f"[fatal] scope not allowed by active contract: {scope_raw}", file=sys.stderr)
        raise SystemExit(4)
    if active_goal != "TARGET_FIRST_V2" or active_position_semantics != "OVERLAP_DAILY_ONE_PICK_V2":
        print(
            "[fatal] active contract mismatch for target-first scope "
            f"goal={active_goal} semantics={active_position_semantics}",
            file=sys.stderr,
        )
        raise SystemExit(4)
    if memory_goal != active_goal or memory_position_semantics != active_position_semantics:
        print(
            "[fatal] memory active goal/semantics mismatch "
            f"memory={memory_goal}::{memory_position_semantics} contract={active_goal}::{active_position_semantics}",
            file=sys.stderr,
        )
        raise SystemExit(4)
    if any(
        legacy_key == patch_key or legacy_key in patch_key or patch_key in legacy_key
        for legacy_key in (legacy_goal_misaligned | contract_forbidden)
    ):
        print(
            f"[forbidden] patchKey={patch_key_raw} matches legacy-goal-misaligned rule under target-first scope",
            file=sys.stderr,
        )
        raise SystemExit(3)
    if "exploratory" in scope and not probe_id:
        print(
            "[fatal] exploratory target-first scope requires --probe-id for shortlist enforcement",
            file=sys.stderr,
        )
        raise SystemExit(4)
    if requires_candidate_mode(scope) and not candidate_mode:
        print(
            "[fatal] target-first exploratory/confirm/final scopes require --candidate-mode",
            file=sys.stderr,
        )
        raise SystemExit(4)
    if candidate_mode and allowed_candidate_modes and candidate_mode not in allowed_candidate_modes:
        print(
            f"[fatal] candidate-mode not allowed by active contract: {candidate_mode_raw}",
            file=sys.stderr,
        )
        raise SystemExit(4)
    if major_change_type and allowed_major_change_types and major_change_type not in allowed_major_change_types:
        print(
            f"[fatal] major-change-type not allowed by active contract: {major_change_type_raw}",
            file=sys.stderr,
        )
        raise SystemExit(4)
    if "exploratory" in scope and probe_id:
        shortlist_values = set()
        for key in ("smoke", "confirm", "promotion"):
            shortlist_values.update(str(item).strip() for item in (shortlist.get(key) or []))
        if shortlist_values and probe_id not in shortlist_values:
            print(
                f"[forbidden] probeId={probe_id} is outside target-first shortlist for exploratory scope",
                file=sys.stderr,
            )
            raise SystemExit(3)

for row in memory.get("doNotRepeat") or []:
    row_key = normalize_key(row.get("patchKey"))
    row_scope = row.get("scope")
    if row_key and (
        row_key == patch_key or
        row_key in patch_key or
        patch_key in row_key
    ):
        if scope and not scope_allows(row_scope, scope):
            continue
        print(
            f"[forbidden] patchKey={patch_key_raw} matches doNotRepeat entry "
            f"probeId={row.get('probeId')} status={row.get('status')} reason={row.get('reason')}"
        )
        raise SystemExit(3)

for row in memory.get("recentExperimentLog") or []:
    row_key = normalize_key(row.get("key"))
    row_scope = row.get("scope")
    runs = [str(item) for item in (row.get("runs") or [])]
    if row_key and (
        row_key == patch_key or
        row_key in patch_key or
        patch_key in row_key
    ):
      if scope == "target_first_v2" and row_key in legacy_goal_misaligned:
        continue
      if scope and not scope_allows(row_scope, scope):
        continue
      print(
          f"[duplicate] patchKey={patch_key_raw} already logged "
          f"status={row.get('status')} runs={','.join(runs)} summary={row.get('summary')}"
      )
      raise SystemExit(2)
    if run_id and run_id in runs:
      print(
          f"[duplicate] runId={run_id} already logged under key={row.get('key')} "
          f"status={row.get('status')}"
      )
      raise SystemExit(2)

for row in registry_rows:
    row_key = normalize_key(row.get("patchKey"))
    row_scope = row.get("scope")
    runs = [str(item) for item in (row.get("runIds") or [])]
    if row_key and (
        row_key == patch_key or
        row_key in patch_key or
        patch_key in row_key
    ):
      if scope and not scope_allows(row_scope, scope):
        continue
      print(
          f"[duplicate] patchKey={patch_key_raw} already registered "
          f"status={row.get('status')} runs={','.join(runs)} notes={row.get('notes')}"
      )
      raise SystemExit(2)
    if run_id and run_id in runs:
      print(
          f"[duplicate] runId={run_id} already registered under patchKey={row.get('patchKey')} "
          f"status={row.get('status')}"
      )
      raise SystemExit(2)

for row in candidate_manifest.get("rows") or []:
    row_mode = normalize_key(row.get("candidateMode"))
    row_change = normalize_key(row.get("majorChangeType"))
    row_run_id = str(row.get("runId") or "").strip()
    if not row_mode or not row_change:
        continue
    if candidate_mode and major_change_type and row_mode == candidate_mode and row_change == major_change_type:
        if run_id and row_run_id and row_run_id == run_id:
            print(
                f"[forbidden] candidate-mode/major-change already recorded in run: mode={candidate_mode_raw} change={major_change_type_raw}",
                file=sys.stderr,
            )
            raise SystemExit(3)

print(f"[ok] new experiment key: {patch_key_raw}")
raise SystemExit(0)
PY
