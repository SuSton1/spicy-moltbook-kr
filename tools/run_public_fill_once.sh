#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

summary_out=""
args=()
while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --summary-out=*)
      summary_out="${1#*=}"
      args+=("$1")
      shift
      ;;
    --summary-out)
      if [[ $# -lt 2 ]]; then
        echo "[public-fill] missing value for --summary-out" >&2
        exit 4
      fi
      summary_out="$2"
      args+=("$1" "$2")
      shift 2
      ;;
    *)
      args+=("$1")
      shift
      ;;
  esac
done

if [[ -n "${summary_out}" ]]; then
  rm -f "${summary_out}"
fi

echo "[public-fill] start ts=$(date '+%Y-%m-%d %H:%M:%S %Z')"
set +e
bash tools/start_fill_public_kr_daily.sh --foreground "${args[@]}"
fill_exit=$?
set -e
if [[ -n "${summary_out}" && ! -f "${summary_out}" ]]; then
  echo "[public-fill] missing fill summary artifact: ${summary_out}" >&2
  exit 1
fi
if (( fill_exit != 0 )); then
  echo "[public-fill] fill failed exit=${fill_exit}" >&2
  exit "${fill_exit}"
fi
echo "[public-fill] verify"
npm run verify
echo "[public-fill] done ts=$(date '+%Y-%m-%d %H:%M:%S %Z')"
