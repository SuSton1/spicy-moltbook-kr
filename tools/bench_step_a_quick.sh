#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TAG="${1:-$(date +%Y%m%d_%H%M%S)}"
OUT_DIR="artifacts/bench"
mkdir -p "$OUT_DIR"

run_case() {
  local name="$1"
  local config_path="$2"
  local run_id="bench_${name}_${TAG}"
  local log_path="${OUT_DIR}/${run_id}.log"

  local start_ns end_ns elapsed_ms
  start_ns="$(date +%s%N)"
  npm run lab:step-a -- --config="$config_path" --run-id="$run_id" >"$log_path" 2>&1
  end_ns="$(date +%s%N)"
  elapsed_ms=$(((end_ns - start_ns) / 1000000))

  local summary_path="artifacts/runs/${run_id}/step-a/step_a_summary.json"
  if [[ ! -f "$summary_path" ]]; then
    echo "missing summary: $summary_path" >&2
    exit 1
  fi

  local metrics
  metrics="$(node -e '
    const fs = require("node:fs");
    const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const out = {
      engineResolved: s.engineResolved,
      engineComposition: s.engineComposition ?? s.engineResolved,
      rawEventCandidates: s.rawEventCandidates,
      passedEvents: s.passedEvents,
      passedEventsEligible40d: s.passedEventsEligible40d
    };
    process.stdout.write(JSON.stringify(out));
  ' "$summary_path")"

  echo "${name}|${elapsed_ms}|${run_id}|${metrics}"
}

hybrid_row="$(run_case "hybrid" "config/lab.config.bench.hybrid.json")"
classic_row="$(run_case "classic" "config/lab.config.bench.classic.json")"

hybrid_ms="$(echo "$hybrid_row" | cut -d'|' -f2)"
classic_ms="$(echo "$classic_row" | cut -d'|' -f2)"

speedup="$(node -e '
  const h = Number(process.argv[1]);
  const c = Number(process.argv[2]);
  if (!Number.isFinite(h) || !Number.isFinite(c) || h <= 0) {
    process.stdout.write("null");
    process.exit(0);
  }
  process.stdout.write(String(c / h));
' "$hybrid_ms" "$classic_ms")"

report_path="${OUT_DIR}/step_a_quick_${TAG}.json"
node -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const hybrid = process.argv[2].split("|");
  const classic = process.argv[3].split("|");
  const speedup = process.argv[4];
  const parseMetrics = (raw) => {
    try { return JSON.parse(raw); } catch { return {}; }
  };
  const out = {
    tag: process.argv[5],
    createdAt: new Date().toISOString(),
    period: "quick-small-candidate-sample",
    hybrid: {
      elapsedMs: Number(hybrid[1]),
      runId: hybrid[2],
      ...parseMetrics(hybrid[3])
    },
    classic: {
      elapsedMs: Number(classic[1]),
      runId: classic[2],
      ...parseMetrics(classic[3])
    },
    speedupClassicOverHybrid: speedup === "null" ? null : Number(speedup)
  };
  fs.writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
' "$report_path" "$hybrid_row" "$classic_row" "$speedup" "$TAG"

echo "report: $report_path"
