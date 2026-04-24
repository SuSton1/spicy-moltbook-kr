#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_SUBSTRATE_CONTRACT_PATH="meta/technique_episode_substrate_contract.json"
DEFAULT_SLICE_CONTRACT_PATH="meta/technique_episode_slice_contract.json"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'USAGE'
Usage: bash tools/run_technique_episode_matched_control_purity_slice.sh --run-id=<run_id> --rows-path=<rows.jsonl> [--substrate-contract-path=PATH] [--slice-contract-path=PATH] [--default-scope-id=SCOPE] [--default-lookback-candidate-id=ID] [--top-slices=N]
Server-only helper that runs matched-control purity-slice discovery end-to-end.
USAGE
}

RUN_ID=""
ROWS_PATH=""
SUBSTRATE_CONTRACT_PATH="$DEFAULT_SUBSTRATE_CONTRACT_PATH"
SLICE_CONTRACT_PATH="$DEFAULT_SLICE_CONTRACT_PATH"
DEFAULT_SCOPE_ID=""
DEFAULT_LOOKBACK_CANDIDATE_ID=""
TOP_SLICES=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --run-id=*) RUN_ID="${1#*=}"; shift ;;
    --rows-path=*) ROWS_PATH="${1#*=}"; shift ;;
    --substrate-contract-path=*) SUBSTRATE_CONTRACT_PATH="${1#*=}"; shift ;;
    --slice-contract-path=*) SLICE_CONTRACT_PATH="${1#*=}"; shift ;;
    --default-scope-id=*) DEFAULT_SCOPE_ID="${1#*=}"; shift ;;
    --default-lookback-candidate-id=*) DEFAULT_LOOKBACK_CANDIDATE_ID="${1#*=}"; shift ;;
    --top-slices=*) TOP_SLICES="${1#*=}"; shift ;;
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
[[ -f "$SUBSTRATE_CONTRACT_PATH" ]] || fatal "substrate contract path missing: $SUBSTRATE_CONTRACT_PATH"
[[ -f "$SLICE_CONTRACT_PATH" ]] || fatal "slice contract path missing: $SLICE_CONTRACT_PATH"

OUT_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-technique-episode-purity-slice"
[[ ! -e "$OUT_DIR" ]] || fatal "episode purity-slice out dir already exists: $OUT_DIR"
mkdir -p "$OUT_DIR"

EPISODES_PATH="$OUT_DIR/episode_windows.jsonl"
EPISODE_SUMMARY_PATH="$OUT_DIR/episode_window_summary.json"
CONTROL_PAIRS_PATH="$OUT_DIR/episode_control_pairs.jsonl"
CONTROL_PAIR_SUMMARY_PATH="$OUT_DIR/episode_control_pair_summary.json"
DELTA_ATOMS_PATH="$OUT_DIR/episode_delta_atoms.jsonl"
DELTA_ATOM_SUMMARY_PATH="$OUT_DIR/episode_delta_atom_summary.json"
SLICE_CONTRACTS_PATH="$OUT_DIR/slice_contracts.jsonl"
SLICE_CONTRACT_SUMMARY_PATH="$OUT_DIR/slice_contract_summary.json"
SLICE_RECHECK_DIR="$OUT_DIR/slice_rechecks"
FINAL_SUMMARY_PATH="$OUT_DIR/purity_slice_summary.json"
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
  kind: "technique_episode_matched_control_purity_slice_phase_status_v1",
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
  node --input-type=module - "$RUN_STATUS_PATH" "$RUN_ID" "$state" "$phase" "$exit_code" "$ROWS_PATH" "$SUBSTRATE_CONTRACT_PATH" "$SLICE_CONTRACT_PATH" <<'NODE'
import { writeJson } from "./src/lib/io.mjs"
const [runStatusPath, runId, state, phase, exitCodeRaw, rowsPath, substrateContractPath, sliceContractPath] = process.argv.slice(2)
const parsedExitCode = Number.parseInt(exitCodeRaw, 10)
await writeJson(runStatusPath, {
  kind: "technique_episode_matched_control_purity_slice_run_status_v1",
  generatedAt: new Date().toISOString(),
  runId,
  state,
  phase,
  exitCode: Number.isFinite(parsedExitCode) && parsedExitCode >= 0 ? parsedExitCode : null,
  rowsPath,
  substrateContractPath,
  sliceContractPath,
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

RECHECK_TOP_SLICES="$TOP_SLICES"
if [[ -z "$RECHECK_TOP_SLICES" ]]; then
  RECHECK_TOP_SLICES="$(node --input-type=module -e 'import { loadTechniqueEpisodeSliceContract } from "./src/lib/technique_episode_slice_contract.mjs"; const c = await loadTechniqueEpisodeSliceContract({ cwd: process.cwd(), contractPath: process.argv[1] }); process.stdout.write(String(c.recheckTopSlices));' "$SLICE_CONTRACT_PATH")"
fi

WINDOW_ARGS=(
  "--rows-path=$ROWS_PATH"
  "--out=$EPISODES_PATH"
  "--summary-out=$EPISODE_SUMMARY_PATH"
  "--contract-path=$SUBSTRATE_CONTRACT_PATH"
)
if [[ -n "$DEFAULT_SCOPE_ID" ]]; then
  WINDOW_ARGS+=("--default-scope-id=$DEFAULT_SCOPE_ID")
fi
if [[ -n "$DEFAULT_LOOKBACK_CANDIDATE_ID" ]]; then
  WINDOW_ARGS+=("--default-lookback-candidate-id=$DEFAULT_LOOKBACK_CANDIDATE_ID")
fi

run_phase "episode_windows" node tools/build_technique_episode_windows.mjs "${WINDOW_ARGS[@]}"
run_phase "control_pairs" node tools/build_technique_episode_control_pairs.mjs "--episodes-path=$EPISODES_PATH" "--out=$CONTROL_PAIRS_PATH" "--summary-out=$CONTROL_PAIR_SUMMARY_PATH" "--contract-path=$SLICE_CONTRACT_PATH"
run_phase "delta_atoms" node tools/build_technique_episode_delta_atoms.mjs "--episodes-path=$EPISODES_PATH" "--control-pairs-path=$CONTROL_PAIRS_PATH" "--out=$DELTA_ATOMS_PATH" "--summary-out=$DELTA_ATOM_SUMMARY_PATH" "--contract-path=$SLICE_CONTRACT_PATH"
run_phase "slice_contracts" node tools/build_technique_episode_slice_contracts.mjs "--episodes-path=$EPISODES_PATH" "--delta-atoms-path=$DELTA_ATOMS_PATH" "--out=$SLICE_CONTRACTS_PATH" "--summary-out=$SLICE_CONTRACT_SUMMARY_PATH" "--contract-path=$SLICE_CONTRACT_PATH"
run_phase "slice_rechecks" node tools/build_technique_episode_slice_recheck_report.mjs "--episodes-path=$EPISODES_PATH" "--slice-contracts-path=$SLICE_CONTRACTS_PATH" "--out-dir=$SLICE_RECHECK_DIR" "--summary-out=$FINAL_SUMMARY_PATH" "--substrate-contract-path=$SUBSTRATE_CONTRACT_PATH" "--top-n=$RECHECK_TOP_SLICES"

CURRENT_PHASE="manifest"
write_phase_status "$CURRENT_PHASE"
write_run_status "running" "$CURRENT_PHASE" -1
node --input-type=module - "$MANIFEST_PATH" "$RUN_ID" "$ROWS_PATH" "$SUBSTRATE_CONTRACT_PATH" "$SLICE_CONTRACT_PATH" "$EPISODES_PATH" "$CONTROL_PAIRS_PATH" "$DELTA_ATOMS_PATH" "$SLICE_CONTRACTS_PATH" "$FINAL_SUMMARY_PATH" <<'NODE'
import { writeJson } from "./src/lib/io.mjs"
const [manifestPath, runId, rowsPath, substrateContractPath, sliceContractPath, episodesPath, controlPairsPath, deltaAtomsPath, sliceContractsPath, finalSummaryPath] = process.argv.slice(2)
await writeJson(manifestPath, {
  kind: "technique_episode_matched_control_purity_slice_manifest_v1",
  generatedAt: new Date().toISOString(),
  runId,
  rowsPath,
  substrateContractPath,
  sliceContractPath,
  outputs: {
    episodesPath,
    controlPairsPath,
    deltaAtomsPath,
    sliceContractsPath,
    finalSummaryPath,
  },
})
NODE

CURRENT_PHASE="completed"
echo "[done] technique episode matched-control purity slice completed runId=${RUN_ID} summary=${FINAL_SUMMARY_PATH}"
