#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(pwd)}"
MEMORY_JSON="$ROOT/meta/experiment_patch_memory.json"
OUT_DIR="$ROOT/artifacts/state/experiment_memory"
OUT_JSON="$OUT_DIR/latest_experiment_memory.json"
OUT_MD="$OUT_DIR/latest_experiment_memory.md"

if [[ ! -f "$MEMORY_JSON" ]]; then
  echo "[fatal] memory file not found: $MEMORY_JSON" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

python3 - "$ROOT" "$MEMORY_JSON" "$OUT_JSON" "$OUT_MD" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(sys.argv[1])
memory_path = Path(sys.argv[2])
out_json = Path(sys.argv[3])
out_md = Path(sys.argv[4])


def load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def parse_iso(value):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text)
    except Exception:
        return None


def file_mtime(path):
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    except Exception:
        return None


def best_record(pattern):
    best = None
    for path in root.glob(pattern):
        row = load_json(path)
        if not isinstance(row, dict):
            continue
        ts = parse_iso(row.get("updatedAt")) or parse_iso(row.get("generatedAt")) or file_mtime(path)
        key = (ts or datetime.min.replace(tzinfo=timezone.utc), str(path))
        if best is None or key > best[0]:
            best = (key, path, row)
    return best[1:] if best else (None, None)


def best_cycle_state(pattern):
    best = None
    for path in root.glob(pattern):
        row = load_json(path)
        if not isinstance(row, dict):
            continue
        ts = file_mtime(path) or datetime.min.replace(tzinfo=timezone.utc)
        key = (ts, str(path))
        if best is None or key > best[0]:
            best = (key, path, row)
    return best[1:] if best else (None, None)


def compute_target_leaderboard():
    rows = []
    seen = set()
    for trades_path in root.glob("artifacts/runs/*/cd-loop/*/lockbox-eval/r*/step-e/lockbox_trades.jsonl"):
        parts = trades_path.parts
        try:
            cd_loop_idx = parts.index("cd-loop")
        except ValueError:
            continue
        session_id = parts[cd_loop_idx + 1]
        round_tag = parts[cd_loop_idx + 3]
        key = (session_id, round_tag, str(trades_path))
        if key in seen:
            continue
        seen.add(key)
        total = 0
        target = 0
        stop = 0
        timeout = 0
        both_stop = 0
        try:
            with open(trades_path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        row = json.loads(line)
                    except Exception:
                        continue
                    total += 1
                    reason = str(row.get("exitReason") or "").strip()
                    if reason == "TARGET":
                        target += 1
                    elif reason == "STOP":
                        stop += 1
                    elif reason == "TIMEOUT":
                        timeout += 1
                    elif reason == "BOTH_HIT_STOP_FIRST":
                        both_stop += 1
        except Exception:
            continue
        if total <= 0:
            continue
        rows.append({
            "sessionId": session_id,
            "roundTag": round_tag,
            "tradesPath": str(trades_path),
            "targetRate": target / total,
            "targetCount": target,
            "totalTrades": total,
            "stopCount": stop,
            "timeoutCount": timeout,
            "bothHitStopFirstCount": both_stop
        })
    rows.sort(key=lambda r: (r["targetRate"], r["targetCount"], r["totalTrades"], r["sessionId"]), reverse=True)
    return rows[:10]


memory = load_json(memory_path) or {}
accepted_path, accepted = best_record("artifacts/state/lineages/*/accepted_probe_baseline.json")
peak_path, peak = best_record("artifacts/state/lineages/*/candidate_peak_probe.json")
operating_cycle_path, operating_cycle = best_cycle_state("artifacts/state/accepted_probe_cycles/*/accepted_probe_cycle_state.json")
research_cycle_path, research_cycle = best_cycle_state("artifacts/state/research_probe_cycles/*/accepted_probe_cycle_state.json")
leaderboard = compute_target_leaderboard()

result = {
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "memoryFile": str(memory_path),
    "acceptedBaseline": {
        "path": str(accepted_path) if accepted_path else "",
        "record": accepted or {}
    },
    "candidatePeak": {
        "path": str(peak_path) if peak_path else "",
        "record": peak or {}
    },
    "probeCycle": {
        "path": str(operating_cycle_path) if operating_cycle_path else "",
        "record": operating_cycle or {}
    },
    "probeCycles": {
        "operating": {
            "path": str(operating_cycle_path) if operating_cycle_path else "",
            "record": operating_cycle or {}
        },
        "research": {
            "path": str(research_cycle_path) if research_cycle_path else "",
            "record": research_cycle or {}
        }
    },
    "staticMemory": memory,
    "targetHitLeaderboard": leaderboard
}

out_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

accepted_stepd = (accepted or {}).get("stepD") or {}
accepted_stepe = (accepted or {}).get("stepE") or {}
peak_stepd = (peak or {}).get("stepD") or {}
operating_cycle_row = operating_cycle or {}
research_cycle_row = research_cycle or {}

lines = []
lines.append("# Experiment Memory Report")
lines.append("")
lines.append(f"- generatedAt: {result['generatedAt']}")
lines.append(f"- memoryFile: {memory_path}")
lines.append("")
lines.append("## Active Parent")
if accepted:
    lines.append(f"- acceptedBaselineProbe: {accepted.get('sessionId', '')}")
    lines.append(f"- path: {accepted_path}")
    lines.append(f"- stepD.pickHitRateEval: {accepted_stepd.get('pickHitRateEval')}")
    lines.append(f"- stepD.executedHitRateEval: {accepted_stepd.get('executedHitRateEval')}")
    lines.append(f"- stepE.winRate: {accepted_stepe.get('winRate')}")
    lines.append(f"- stepE.avgNetRet: {accepted_stepe.get('avgNetRet')}")
    lines.append(f"- stepE.cumulativeReturn: {accepted_stepe.get('cumulativeReturn')}")
else:
    lines.append("- accepted baseline not found")
lines.append("")
lines.append("## Candidate Peak")
if peak:
    lines.append(f"- candidatePeakProbe: {peak.get('sessionId', '')}")
    lines.append(f"- path: {peak_path}")
    lines.append(f"- stepD.pickHitRateEval: {peak_stepd.get('pickHitRateEval')}")
    lines.append(f"- stepD.executedHitRateEval: {peak_stepd.get('executedHitRateEval')}")
    lines.append(f"- stepD.top1ToOracleConversionEval: {peak_stepd.get('top1ToOracleConversionEval')}")
else:
    lines.append("- candidate peak not found")
lines.append("")
lines.append("## Probe Cycles")
lines.append("### Operating Lane")
if operating_cycle:
    lines.append(f"- statePath: {operating_cycle_path}")
    lines.append(f"- lastSessionId: {operating_cycle_row.get('lastSessionId', '')}")
    lines.append(f"- lastSessionMode: {operating_cycle_row.get('lastSessionMode', '')}")
    lines.append(f"- parentKey: {operating_cycle_row.get('parentKey', '')}")
    lines.append(f"- noCodeProbeStreak: {operating_cycle_row.get('noCodeProbeStreak')}")
    lines.append(f"- nonImprovementStreak: {operating_cycle_row.get('nonImprovementStreak')}")
    lines.append(f"- stepEMissingStreak: {operating_cycle_row.get('stepEMissingStreak')}")
    lines.append(f"- plateauActive: {operating_cycle_row.get('plateauActive')}")
    lines.append(f"- lastNextAction: {operating_cycle_row.get('lastNextAction', '')}")
else:
    lines.append("- operating probe cycle state not found")
lines.append("")
lines.append("### Research Lane")
if research_cycle:
    lines.append(f"- statePath: {research_cycle_path}")
    lines.append(f"- lastSessionId: {research_cycle_row.get('lastSessionId', '')}")
    lines.append(f"- lastSessionMode: {research_cycle_row.get('lastSessionMode', '')}")
    lines.append(f"- parentKey: {research_cycle_row.get('parentKey', '')}")
    lines.append(f"- noCodeProbeStreak: {research_cycle_row.get('noCodeProbeStreak')}")
    lines.append(f"- nonImprovementStreak: {research_cycle_row.get('nonImprovementStreak')}")
    lines.append(f"- stepEMissingStreak: {research_cycle_row.get('stepEMissingStreak')}")
    lines.append(f"- plateauActive: {research_cycle_row.get('plateauActive')}")
    lines.append(f"- lastNextAction: {research_cycle_row.get('lastNextAction', '')}")
else:
    lines.append("- research probe cycle state not found")
lines.append("")
lines.append("## Confirmed Diagnosis")
diag = (memory.get("confirmedDiagnosis") or {})
lines.append(f"- primaryBottleneck: {diag.get('primaryBottleneck', '')}")
lines.append(f"- secondaryBottleneck: {diag.get('secondaryBottleneck', '')}")
lines.append(f"- notPrimary: {', '.join(diag.get('notPrimary') or [])}")
lines.append(f"- summary: {diag.get('summary', '')}")
lines.append("")
lines.append("## Do Not Repeat")
for row in memory.get("doNotRepeat") or []:
    lines.append(
        f"- {row.get('probeId', '')} | {row.get('patchKey', '')} | {row.get('status', '')} | {row.get('reason', '')}"
    )
lines.append("")
lines.append("## Next Patch Priorities")
for row in memory.get("nextPatchPriorities") or []:
    lines.append(f"- P{row.get('rank', '')}: {row.get('title', '')} [{row.get('area', '')}]")
    for note in row.get("notes") or []:
        lines.append(f"  - {note}")
lines.append("")
lines.append("## Step E TARGET Leaderboard")
for row in leaderboard:
    lines.append(
        f"- {row['sessionId']} | targetRate={row['targetRate']:.4f} | target={row['targetCount']}/{row['totalTrades']} | stop={row['stopCount']} | timeout={row['timeoutCount']} | bothStop={row['bothHitStopFirstCount']}"
    )
lines.append("")
lines.append("## Patch Start Checklist")
for item in memory.get("patchStartChecklist") or []:
    lines.append(f"- {item}")
lines.append("")

out_md.write_text("\n".join(lines), encoding="utf-8")
print(out_md.read_text(encoding="utf-8"))
PY
