#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_JSON="$ROOT/meta/active_research_contract.json"
MEMORY_JSON="$ROOT/meta/experiment_patch_memory.json"
SHORTLIST_JSON="$ROOT/meta/target_first_probe_shortlist.json"
SALVAGE_JSON="$ROOT/meta/salvaged_pattern_pool.json"
QUARANTINE_JSON="$ROOT/meta/pattern_quarantine_pool.json"
CHECKER="$ROOT/tools/check_duplicate_experiment.sh"
SCOPE="target_first_v2"

usage() {
  cat <<'EOF'
Usage:
  tools/bootstrap_target_first_session.sh [--scope=<scope>]
EOF
}

for arg in "$@"; do
  case "$arg" in
    --scope=*) SCOPE="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "[fatal] unknown arg: $arg" >&2
      usage >&2
      exit 4
      ;;
  esac
done

for required in "$CONTRACT_JSON" "$MEMORY_JSON" "$SHORTLIST_JSON" "$CHECKER" "$SALVAGE_JSON" "$QUARANTINE_JSON"; do
  if [[ ! -f "$required" ]]; then
    echo "[fatal] required file missing: $required" >&2
    exit 4
  fi
done

python3 - "$CONTRACT_JSON" "$MEMORY_JSON" "$SHORTLIST_JSON" "$SALVAGE_JSON" "$QUARANTINE_JSON" "$SCOPE" <<'PY'
import json
import sys

contract_path, memory_path, shortlist_path, salvage_path, quarantine_path, scope = sys.argv[1:]

with open(contract_path, "r", encoding="utf-8") as fh:
    contract = json.load(fh)
with open(memory_path, "r", encoding="utf-8") as fh:
    memory = json.load(fh)
with open(shortlist_path, "r", encoding="utf-8") as fh:
    shortlist = json.load(fh)
with open(salvage_path, "r", encoding="utf-8") as fh:
    salvage = json.load(fh)
with open(quarantine_path, "r", encoding="utf-8") as fh:
    quarantine = json.load(fh)

goal = str(contract.get("goalMode", "")).strip().upper()
semantics = str(contract.get("positionSemantics", "")).strip().upper()
active_goal = str(memory.get("goalModePolicy", {}).get("activeGoalMode", "")).strip().upper()
active_semantics = str(memory.get("goalModePolicy", {}).get("activePositionSemantics", "")).strip().upper()

if goal != "TARGET_FIRST_V2":
    print(f"[fatal] active contract goalMode mismatch: {goal}", file=sys.stderr)
    raise SystemExit(4)
if semantics != "OVERLAP_DAILY_ONE_PICK_V2":
    print(f"[fatal] active contract positionSemantics mismatch: {semantics}", file=sys.stderr)
    raise SystemExit(4)
if active_goal != goal or active_semantics != semantics:
    print(
        "[fatal] memory active goal/semantics mismatch "
        f"memory={active_goal}::{active_semantics} contract={goal}::{semantics}",
        file=sys.stderr,
    )
    raise SystemExit(4)

allowed_scopes = {str(item).strip() for item in (contract.get("allowedExperimentScopes") or [])}
if scope not in allowed_scopes:
    print(f"[fatal] scope not allowed by active contract: {scope}", file=sys.stderr)
    raise SystemExit(4)

confirm = shortlist.get("confirm") or []
if not confirm:
    print("[fatal] shortlist confirm set is empty", file=sys.stderr)
    raise SystemExit(4)

baseline = (
    memory.get("goalModePolicy", {})
    .get("acceptedBaselineByGoalMode", {})
    .get("TARGET_FIRST_V2::OVERLAP_DAILY_ONE_PICK_V2")
)
research_mode = contract.get("researchMode") or {}
line_discard = research_mode.get("lineDiscard") or {}
promotion = research_mode.get("parentPromotion") or {}
salvage_boost = salvage.get("salvagedBoostPatterns") or []
salvage_penalty = salvage.get("salvagedPenaltyPatterns") or []
quarantined = quarantine.get("quarantinedPatterns") or []

print("[ok] target-first session bootstrapped")
print(f"goalMode={goal}")
print(f"positionSemantics={semantics}")
print(f"scope={scope}")
print(f"targetFirstBaseline={'set' if baseline else 'unset'}")
print(f"shortlistConfirmCount={len(confirm)}")
print(f"lineDiscardMinD={line_discard.get('minD', 'n/a')}")
print(f"lineDiscardMinE={line_discard.get('minE', 'n/a')}")
print(f"parentPromotionMinD={promotion.get('minD', 'n/a')}")
print(f"parentPromotionMinE={promotion.get('minE', 'n/a')}")
print(f"salvagedBoostPatterns={len(salvage_boost)}")
print(f"salvagedPenaltyPatterns={len(salvage_penalty)}")
print(f"quarantinedPatterns={len(quarantined)}")
PY
