#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

events="$tmpdir/events.jsonl"
for year in 2016 2017 2018 2019 2020 2021 2022 2023 2024; do
  printf '{"patternId":"p","decisionDateKey":"%s-01-05","hitTarget":true}\n' "$year" >> "$events"
  printf '{"patternId":"p","decisionDateKey":"%s-02-05","hitTarget":true}\n' "$year" >> "$events"
done

bash tools/run_tp12_year2hit_train_gate.sh \
  --contract-path=meta/tp12_year2hit_train_2016_2024_contract.json \
  "--events-path=$events" \
  "--out-dir=$tmpdir/out" >/dev/null

node - "$tmpdir/out/year2hit_train_gate_summary.json" <<'NODE'
const summary = require(process.argv[2])
if (summary.status !== "passed") throw new Error(JSON.stringify(summary))
if (summary.trainDateRange.from !== "2016-01-04" || summary.trainDateRange.to !== "2024-12-30") {
  throw new Error(`contract date range not applied: ${JSON.stringify(summary.trainDateRange)}`)
}
if (summary.coreYears.length !== 9 || summary.survivorCount !== 1) {
  throw new Error(`contract gate mismatch: coreYears=${summary.coreYears.length} survivorCount=${summary.survivorCount}`)
}
NODE

bad_events="$tmpdir/bad_events.jsonl"
printf '{"patternId":"p","decisionDateKey":"2016-01-05","hitTarget":true}\n' > "$bad_events"
if bash tools/run_tp12_year2hit_train_gate.sh \
  --contract-path=meta/tp12_year2hit_train_2016_2024_contract.json \
  "--events-path=$bad_events" \
  "--out-dir=$tmpdir/bad_out" >"$tmpdir/bad.log" 2>&1; then
  echo "expected contract-driven zero-survivor failure" >&2
  exit 1
fi
grep -q "zero_survivors" "$tmpdir/bad.log"

echo "ok smoke_tp12_year2hit_contract_wrapper"
