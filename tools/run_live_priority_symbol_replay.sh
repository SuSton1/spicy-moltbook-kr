#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RUN_DIR=""
RUN_ID=""
CASES=""
OUT_PATH=""

usage() {
  cat <<'USAGE'
Usage: bash tools/run_live_priority_symbol_replay.sh --run-dir=<artifacts/runs/...> --cases=<SYMBOL:YYYY-MM-DD[,SYMBOL:YYYY-MM-DD...]> [--out-path=<json>]
   or: bash tools/run_live_priority_symbol_replay.sh --run-id=<run_id> --cases=<SYMBOL:YYYY-MM-DD[,SYMBOL:YYYY-MM-DD...]> [--out-path=<json>]

This tool is report-only. It does not run mining or live stack jobs itself.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --run-dir=*) RUN_DIR="${arg#*=}" ;;
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --cases=*) CASES="${arg#*=}" ;;
    --out-path=*) OUT_PATH="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[fatal] unknown arg: $arg" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$RUN_DIR" && -z "$RUN_ID" ]]; then
  echo "[fatal] missing --run-dir or --run-id" >&2
  usage
  exit 2
fi
if [[ -z "$CASES" ]]; then
  echo "[fatal] missing --cases" >&2
  usage
  exit 2
fi

ARGS=()
if [[ -n "$RUN_DIR" ]]; then
  ARGS+=("--run-dir=$RUN_DIR")
else
  ARGS+=("--run-id=$RUN_ID")
fi
ARGS+=("--cases=$CASES")
if [[ -n "$OUT_PATH" ]]; then
  ARGS+=("--out-path=$OUT_PATH")
fi

cd "$ROOT_DIR"
node tools/report_live_priority_symbol_rule_support.mjs "${ARGS[@]}"
