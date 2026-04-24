#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/technique_pattern_discovery_contract.json"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'USAGE'
Usage: bash tools/run_technique_positive_first_discovery.sh --run-id=<run_id> --rows-path=<rows.jsonl> [--contract-path=PATH] [--label-id=LABEL] [--default-scope-id=SCOPE] [--default-lookback-candidate-id=ID] [--max-patterns=N]
Server-only helper that runs positive-first year-constrained discovery end-to-end.
USAGE
}

RUN_ID=""
ROWS_PATH=""
CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
LABEL_ID=""
DEFAULT_SCOPE_ID=""
DEFAULT_LOOKBACK_CANDIDATE_ID=""
MAX_PATTERNS=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --run-id=*) RUN_ID="${1#*=}"; shift ;;
    --rows-path=*) ROWS_PATH="${1#*=}"; shift ;;
    --contract-path=*) CONTRACT_PATH="${1#*=}"; shift ;;
    --label-id=*) LABEL_ID="${1#*=}"; shift ;;
    --default-scope-id=*) DEFAULT_SCOPE_ID="${1#*=}"; shift ;;
    --default-lookback-candidate-id=*) DEFAULT_LOOKBACK_CANDIDATE_ID="${1#*=}"; shift ;;
    --max-patterns=*) MAX_PATTERNS="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: ${1}" >&2; exit 1 ;;
  esac
done

cd "$ROOT_DIR"
ROOT_REAL="$(cd "$ROOT_DIR" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  fatal "Run this wrapper on the server repo root: expected=$EXPECTED_REAL actual=$ROOT_REAL"
fi

[[ -n "$RUN_ID" ]] || fatal "--run-id is required"
[[ -n "$ROWS_PATH" ]] || fatal "--rows-path is required"
[[ -f "$ROWS_PATH" ]] || fatal "rows path missing: $ROWS_PATH"
[[ -f "$CONTRACT_PATH" ]] || fatal "contract path missing: $CONTRACT_PATH"

OUT_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-technique-pattern-discovery"
if [[ -e "$OUT_DIR" ]]; then
  fatal "discovery out dir already exists: $OUT_DIR"
fi
mkdir -p "$OUT_DIR"

TRANSACTIONS_PATH="$OUT_DIR/atomic_transactions.jsonl"
TRANSACTION_SUMMARY_PATH="$OUT_DIR/atomic_transaction_summary.json"
POSITIVE_INDEX_PATH="$OUT_DIR/positive_year_index.json"
POSITIVE_MANIFEST_PATH="$OUT_DIR/positive_row_manifest.json"
POSITIVE_INDEX_SUMMARY_PATH="$OUT_DIR/positive_year_index_summary.json"
NEGATIVE_INDEX_PATH="$OUT_DIR/negative_atom_index.json"
NEGATIVE_MANIFEST_PATH="$OUT_DIR/negative_row_manifest.json"
NEGATIVE_INDEX_SUMMARY_PATH="$OUT_DIR/negative_atom_index_summary.json"
CLOSED_PATTERNS_PATH="$OUT_DIR/closed_patterns.jsonl"
CLOSED_PATTERN_SUMMARY_PATH="$OUT_DIR/closed_pattern_summary.json"
PREVERIFIED_PATTERNS_PATH="$OUT_DIR/preverified_patterns.jsonl"
PREVERIFY_SUMMARY_PATH="$OUT_DIR/preverify_summary.json"
CONTRASTIVE_PATTERNS_PATH="$OUT_DIR/contrastive_veto_patterns.jsonl"
CONTRASTIVE_SUMMARY_PATH="$OUT_DIR/contrastive_veto_summary.json"
VERIFIED_PATTERNS_PATH="$OUT_DIR/zero_negative_verified_patterns.jsonl"
ZERO_NEGATIVE_SUMMARY_PATH="$OUT_DIR/zero_negative_summary.json"
DISCOVERY_SUMMARY_PATH="$OUT_DIR/discovery_summary.json"
TOP_PATTERNS_PATH="$OUT_DIR/top_patterns.json"
MANIFEST_PATH="$OUT_DIR/manifest.json"
PHASE_STATUS_PATH="$OUT_DIR/phase_status.json"
RUN_STATUS_PATH="$OUT_DIR/run_status.json"
CURRENT_PHASE="bootstrap"

write_phase_status() {
  local phase="$1"
  node --input-type=module - "$PHASE_STATUS_PATH" "$RUN_ID" "$phase" <<'NODE'
import { writeJson } from "./src/lib/io.mjs"
const [phaseStatusPath, runId, phase] = process.argv.slice(2)
await writeJson(phaseStatusPath, {
  kind: "technique_positive_first_phase_status_v1",
  generatedAt: new Date().toISOString(),
  runId,
  phase,
})
NODE
}

write_run_status() {
  local state="$1"
  local phase="$2"
  local exit_code="$3"
  node --input-type=module - "$RUN_STATUS_PATH" "$RUN_ID" "$state" "$phase" "$exit_code" "$ROWS_PATH" "$CONTRACT_PATH" <<'NODE'
import { writeJson } from "./src/lib/io.mjs"
const [runStatusPath, runId, state, phase, exitCodeRaw, rowsPath, contractPath] = process.argv.slice(2)
const parsedExitCode = Number.parseInt(exitCodeRaw, 10)
await writeJson(runStatusPath, {
  kind: "technique_positive_first_run_status_v1",
  generatedAt: new Date().toISOString(),
  runId,
  state,
  phase,
  exitCode: Number.isFinite(parsedExitCode) && parsedExitCode >= 0 ? parsedExitCode : null,
  rowsPath,
  contractPath,
})
NODE
}

run_phase() {
  local phase="$1"
  shift
  CURRENT_PHASE="$phase"
  write_phase_status "$CURRENT_PHASE"
  write_run_status "running" "$CURRENT_PHASE" -1
  "$@"
}

on_exit() {
  local exit_code=$?
  if [[ $exit_code -eq 0 ]]; then
    write_run_status "completed" "$CURRENT_PHASE" "$exit_code"
  else
    write_run_status "failed" "$CURRENT_PHASE" "$exit_code"
  fi
  exit $exit_code
}
trap on_exit EXIT

write_phase_status "$CURRENT_PHASE"
write_run_status "running" "$CURRENT_PHASE" -1

transaction_args=(
  "--rows-path=${ROWS_PATH}"
  "--out=${TRANSACTIONS_PATH}"
  "--summary-out=${TRANSACTION_SUMMARY_PATH}"
  "--contract-path=${CONTRACT_PATH}"
)
if [[ -n "$LABEL_ID" ]]; then
  transaction_args+=("--label-id=${LABEL_ID}")
fi
if [[ -n "$DEFAULT_SCOPE_ID" ]]; then
  transaction_args+=("--default-scope-id=${DEFAULT_SCOPE_ID}")
fi
if [[ -n "$DEFAULT_LOOKBACK_CANDIDATE_ID" ]]; then
  transaction_args+=("--default-lookback-candidate-id=${DEFAULT_LOOKBACK_CANDIDATE_ID}")
fi
run_phase "atomic_transactions" node tools/build_technique_atomic_transactions.mjs "${transaction_args[@]}"

run_phase "positive_year_index" node tools/build_technique_positive_year_index.mjs \
  "--transactions-path=${TRANSACTIONS_PATH}" \
  "--out=${POSITIVE_INDEX_PATH}" \
  "--manifest-out=${POSITIVE_MANIFEST_PATH}" \
  "--summary-out=${POSITIVE_INDEX_SUMMARY_PATH}" \
  "--contract-path=${CONTRACT_PATH}"

run_phase "negative_atom_index" node tools/build_technique_negative_atom_index.mjs \
  "--transactions-path=${TRANSACTIONS_PATH}" \
  "--out=${NEGATIVE_INDEX_PATH}" \
  "--manifest-out=${NEGATIVE_MANIFEST_PATH}" \
  "--summary-out=${NEGATIVE_INDEX_SUMMARY_PATH}" \
  "--contract-path=${CONTRACT_PATH}"

closed_args=(
  "--index-path=${POSITIVE_INDEX_PATH}"
  "--out=${CLOSED_PATTERNS_PATH}"
  "--summary-out=${CLOSED_PATTERN_SUMMARY_PATH}"
  "--contract-path=${CONTRACT_PATH}"
)
if [[ -n "$MAX_PATTERNS" ]]; then
  closed_args+=("--max-patterns=${MAX_PATTERNS}")
fi
run_phase "closed_patterns" node tools/build_technique_closed_patterns.mjs "${closed_args[@]}"

run_phase "preverify" node tools/build_technique_pattern_preverify_report.mjs \
  "--patterns-path=${CLOSED_PATTERNS_PATH}" \
  "--negative-index-path=${NEGATIVE_INDEX_PATH}" \
  "--out=${PREVERIFIED_PATTERNS_PATH}" \
  "--summary-out=${PREVERIFY_SUMMARY_PATH}" \
  "--contract-path=${CONTRACT_PATH}"

run_phase "contrastive_veto" node tools/build_technique_contrastive_veto_report.mjs \
  "--patterns-path=${PREVERIFIED_PATTERNS_PATH}" \
  "--transactions-path=${TRANSACTIONS_PATH}" \
  "--out=${CONTRASTIVE_PATTERNS_PATH}" \
  "--summary-out=${CONTRASTIVE_SUMMARY_PATH}" \
  "--contract-path=${CONTRACT_PATH}"

run_phase "zero_negative_verify" node tools/build_technique_zero_negative_report.mjs \
  "--patterns-path=${CONTRASTIVE_PATTERNS_PATH}" \
  "--transactions-path=${TRANSACTIONS_PATH}" \
  "--out=${VERIFIED_PATTERNS_PATH}" \
  "--summary-out=${ZERO_NEGATIVE_SUMMARY_PATH}" \
  "--preverify-summary-path=${PREVERIFY_SUMMARY_PATH}" \
  "--contract-path=${CONTRACT_PATH}"

run_phase "discovery_summary" node tools/build_technique_pattern_discovery_summary.mjs \
  "--patterns-path=${VERIFIED_PATTERNS_PATH}" \
  "--out=${DISCOVERY_SUMMARY_PATH}" \
  "--top-out=${TOP_PATTERNS_PATH}"

CURRENT_PHASE="manifest"
write_phase_status "$CURRENT_PHASE"
write_run_status "running" "$CURRENT_PHASE" -1
node --input-type=module - "$MANIFEST_PATH" "$RUN_ID" "$ROWS_PATH" "$CONTRACT_PATH" "$TRANSACTIONS_PATH" "$POSITIVE_INDEX_PATH" "$NEGATIVE_INDEX_PATH" "$CLOSED_PATTERNS_PATH" "$PREVERIFIED_PATTERNS_PATH" "$CONTRASTIVE_PATTERNS_PATH" "$VERIFIED_PATTERNS_PATH" "$DISCOVERY_SUMMARY_PATH" <<'NODE'
import { writeJson } from "./src/lib/io.mjs"

const [manifestPath, runId, rowsPath, contractPath, transactionsPath, positiveIndexPath, negativeIndexPath, closedPatternsPath, preverifiedPatternsPath, contrastivePatternsPath, verifiedPatternsPath, discoverySummaryPath] = process.argv.slice(2)
await writeJson(manifestPath, {
  kind: "technique_positive_first_discovery_manifest_v1",
  generatedAt: new Date().toISOString(),
  runId,
  rowsPath,
  contractPath,
  transactionsPath,
  positiveIndexPath,
  negativeIndexPath,
  closedPatternsPath,
  preverifiedPatternsPath,
  contrastivePatternsPath,
  verifiedPatternsPath,
  discoverySummaryPath,
})
NODE

echo "[done] technique positive-first discovery completed runId=${RUN_ID} summary=${DISCOVERY_SUMMARY_PATH}"
