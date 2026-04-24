#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

tmpdir="$(mktemp -d)"
run_id="smoke_tp12_year2hit_trainfirst_wrapper_args_$$"
trap 'rm -rf "$tmpdir" "$ROOT_DIR/artifacts/runs/$run_id"' EXIT

events="$tmpdir/events.jsonl"
for year in 2016 2017 2018 2019 2020 2021 2022 2023 2024; do
  printf '{"patternId":"p","decisionDateKey":"%s-01-05","hitTarget":true}\n' "$year" >> "$events"
  printf '{"patternId":"p","decisionDateKey":"%s-02-05","hitTarget":true}\n' "$year" >> "$events"
done

bash tools/run_tp12_year2hit_train_gate.sh \
  --contract-path=meta/tp12_year2hit_train_2016_2024_contract.json \
  "--events-path=$events" \
  "--out-dir=$tmpdir/gate" >/dev/null

source_catalog="$tmpdir/source_catalog.json"
cat > "$source_catalog" <<'JSON'
{
  "rules": [
    {
      "ruleId": "p",
      "tokens": [
        "tag:test:survivor"
      ]
    },
    {
      "ruleId": "q",
      "tokens": [
        "tag:test:reject"
      ]
    }
  ]
}
JSON

node tools/build_tp12_year2hit_gated_catalog.mjs \
  "--source-catalog=$source_catalog" \
  "--train-gate-summary=$tmpdir/gate/year2hit_train_gate_summary.json" \
  "--out-catalog=$tmpdir/gated_catalog.json" \
  "--out-manifest=$tmpdir/gated_catalog_manifest.json" >/dev/null

cat > "$tmpdir/label_events.jsonl" <<'JSONL'
{"kind":"tp12_label_event_v1","eventId":"e1","symbol":"000001","decisionDateKey":"2020-01-02","hitTarget":true}
JSONL
cat > "$tmpdir/label_manifest.json" <<JSON
{"kind":"tp12_label_event_build_summary_v1","status":"passed","outEventsPath":"$tmpdir/label_events.jsonl","validLabelCount":1,"failures":[]}
JSON
cat > "$tmpdir/tokenized_events.jsonl" <<'JSONL'
{"kind":"tp12_tokenized_event_v1","eventId":"e1","symbol":"000001","decisionDateKey":"2020-01-02","hitTarget":true,"tokens":["tag:test:survivor"]}
JSONL
cat > "$tmpdir/token_manifest.json" <<JSON
{"kind":"tp12_tokenized_event_build_summary_v1","status":"passed","labelEventsPath":"$tmpdir/label_events.jsonl","outEventsPath":"$tmpdir/tokenized_events.jsonl","outputRowCount":1,"failures":[]}
JSON
cat > "$tmpdir/candidate_events.jsonl" <<'JSONL'
{"kind":"tp12_candidate_event_v1","patternId":"p","symbol":"000001","decisionDateKey":"2020-01-02","hitTarget":true}
JSONL
cat > "$tmpdir/event_manifest.json" <<JSON
{"kind":"tp12_candidate_event_materialize_summary_v1","status":"passed","candidateCatalogPath":"$source_catalog","tokenizedEventsPath":"$tmpdir/tokenized_events.jsonl","outEventsPath":"$tmpdir/candidate_events.jsonl","outputRowCount":1,"failures":[]}
JSON
cat > "$tmpdir/data_readiness_summary.json" <<'JSON'
{"kind":"tp12_year2hit_data_readiness_summary_v1","status":"passed","failures":[]}
JSON
cat > "$tmpdir/asof_survivorship_summary.json" <<'JSON'
{"kind":"tp12_asof_survivorship_summary_v1","status":"passed","failures":[]}
JSON

node --input-type=module - "$tmpdir/gate/year2hit_train_gate_summary.json" "$tmpdir/quality_gate_summary.json" <<'NODE'
import fs from "node:fs"

const gatePath = process.argv[2]
const outPath = process.argv[3]
const gate = JSON.parse(fs.readFileSync(gatePath, "utf8"))
fs.writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      kind: "tp12_year2hit_quality_gate_summary_v1",
      status: "passed",
      survivorPatternIdsSha256: gate.survivorPatternIdsSha256,
      passedPatternIds: gate.survivorPatternIds,
      passedPatternIdsSha256: gate.survivorPatternIdsSha256,
      passedSurvivorCount: gate.survivorCount,
      rejectedSurvivorCount: 0,
      passed: [
        {
          patternId: "p",
          tokenSet: ["tag:test:survivor"],
          matchRows: 2,
          hitRows: 2,
          rowPrecision: 1,
          matchedDateCount: 2,
          hitDateCount: 2,
          datePrecision: 1,
          uniqueMatchedSymbols: 1,
          uniqueHitSymbols: 1
        }
      ],
      failures: []
    },
    null,
    2,
  )}\n`,
)
NODE

node tools/freeze_tp12_year2hit_survivor_catalog.mjs \
  "--candidate-catalog=$source_catalog" \
  "--quality-gate-summary=$tmpdir/quality_gate_summary.json" \
  "--out-catalog=$tmpdir/survivor_catalog.jsonl" \
  "--out-manifest=$tmpdir/survivor_catalog_manifest.json" >/dev/null

if bash tools/run_stepb_1d_tp12_no_stop_scope_fixed_trainfirst.sh \
  --contract-path=meta/tp12_year2hit_train_2016_2024_contract.json \
  --run-id="$run_id" \
  "--data-readiness-summary=$tmpdir/data_readiness_summary.json" \
  "--asof-survivorship-summary=$tmpdir/asof_survivorship_summary.json" \
  "--label-manifest=$tmpdir/label_manifest.json" \
  "--token-dictionary-manifest=$tmpdir/token_manifest.json" \
  "--event-row-manifest=$tmpdir/event_manifest.json" \
  "--quality-gate-summary=$tmpdir/quality_gate_summary.json" \
  "--survivor-catalog-manifest=$tmpdir/survivor_catalog_manifest.json" \
  "--train-gate-summary=$tmpdir/gate/year2hit_train_gate_summary.json" \
  "--gated-catalog=$tmpdir/gated_catalog.json" \
  "--gated-catalog-manifest=$tmpdir/gated_catalog_manifest.json" \
  --preflight-only >"$tmpdir/ambiguous.log" 2>&1; then
  echo "expected ambiguous --contract-path failure" >&2
  exit 1
fi
grep -q "ambiguous" "$tmpdir/ambiguous.log"

bash tools/run_stepb_1d_tp12_no_stop_scope_fixed_trainfirst.sh \
  --train-contract-path=meta/tp12_year2hit_train_2016_2024_contract.json \
  --fixed-contract-path=meta/tp12_no_stop_fixed_year2hit_research_contract.json \
  --run-id="$run_id" \
  "--data-readiness-summary=$tmpdir/data_readiness_summary.json" \
  "--asof-survivorship-summary=$tmpdir/asof_survivorship_summary.json" \
  "--label-manifest=$tmpdir/label_manifest.json" \
  "--token-dictionary-manifest=$tmpdir/token_manifest.json" \
  "--event-row-manifest=$tmpdir/event_manifest.json" \
  "--quality-gate-summary=$tmpdir/quality_gate_summary.json" \
  "--survivor-catalog-manifest=$tmpdir/survivor_catalog_manifest.json" \
  "--train-gate-summary=$tmpdir/gate/year2hit_train_gate_summary.json" \
  "--gated-catalog=$tmpdir/gated_catalog.json" \
  "--gated-catalog-manifest=$tmpdir/gated_catalog_manifest.json" \
  --preflight-only >/dev/null

node - "$ROOT_DIR/artifacts/runs/$run_id/step-tp12-year2hit-trainfirst-preflight/oos_preflight_summary.json" <<'NODE'
const summary = require(process.argv[2])
if (summary.status !== "passed") throw new Error(JSON.stringify(summary))
if (summary.survivorCount !== 1) throw new Error(`unexpected survivorCount=${summary.survivorCount}`)
if (!String(summary.contractPath || "").endsWith("meta/tp12_year2hit_train_2016_2024_contract.json")) {
  throw new Error(`train preflight used wrong contractPath=${summary.contractPath}`)
}
NODE

echo "ok smoke_tp12_year2hit_trainfirst_wrapper_args"
