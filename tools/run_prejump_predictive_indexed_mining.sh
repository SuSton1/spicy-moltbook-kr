#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_REPO_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"

forwarded_args=()
for arg in "$@"; do
  case "$arg" in
    --config=*|--pack-out-dir=*|--index-out-dir=*|--mine-out-dir=*|--feature-store-dir=*)
      arg_name="${arg%%=*}"
      raw_path="${arg#*=}"
      if [[ "$raw_path" == "$ROOT_DIR/"* ]]; then
        rel_path="${raw_path#$ROOT_DIR/}"
        forwarded_args+=("${arg_name}=$SERVER_REPO_ROOT/$rel_path")
      else
        forwarded_args+=("$arg")
      fi
      ;;
    *)
      forwarded_args+=("$arg")
      ;;
  esac
done

"$ROOT_DIR/tools/run_server_command.sh" bash tools/server_run_prejump_predictive_indexed_mining.sh "${forwarded_args[@]}"
