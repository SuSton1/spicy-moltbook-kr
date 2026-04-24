#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_HOST="${STOCKDESK_SERVER_HOST:-spicy-moltbook}"
SERVER_REPO_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"

LOCAL_OUT_PATH=""
SERVER_OUT_PATH=""
forwarded_args=()

for arg in "$@"; do
  case "$arg" in
    --source-catalog=*|--rule-ids-file=*)
      arg_name="${arg%%=*}"
      raw_path="${arg#*=}"
      if [[ "$raw_path" == "$ROOT_DIR/"* ]]; then
        rel_path="${raw_path#$ROOT_DIR/}"
        forwarded_args+=("${arg_name}=$SERVER_REPO_ROOT/$rel_path")
      else
        forwarded_args+=("$arg")
      fi
      ;;
    --out-path=*)
      raw_out_path="${arg#*=}"
      if [[ "$raw_out_path" == "$ROOT_DIR/"* ]]; then
        LOCAL_OUT_PATH="$raw_out_path"
        rel_path="${raw_out_path#$ROOT_DIR/}"
        SERVER_OUT_PATH="$SERVER_REPO_ROOT/$rel_path"
        forwarded_args+=("--out-path=$SERVER_OUT_PATH")
      elif [[ "$raw_out_path" == "$SERVER_REPO_ROOT/"* ]]; then
        SERVER_OUT_PATH="$raw_out_path"
        rel_path="${raw_out_path#$SERVER_REPO_ROOT/}"
        LOCAL_OUT_PATH="$ROOT_DIR/$rel_path"
        forwarded_args+=("$arg")
      else
        LOCAL_OUT_PATH="$raw_out_path"
        SERVER_OUT_PATH="$raw_out_path"
        forwarded_args+=("$arg")
      fi
      ;;
    *)
      forwarded_args+=("$arg")
      ;;
  esac
done

server_output="$("$ROOT_DIR/tools/run_server_command.sh" bash tools/server_rebuild_prejump_curated_perfect_prototype_catalog.sh "${forwarded_args[@]}")"
echo "$server_output"

if [[ -z "$SERVER_OUT_PATH" ]]; then
  parsed_server_out_path="$(printf '%s\n' "$server_output" | sed -n 's/^outPath=//p' | tail -n 1)"
  if [[ -n "$parsed_server_out_path" ]]; then
    SERVER_OUT_PATH="$parsed_server_out_path"
    if [[ "$SERVER_OUT_PATH" == "$SERVER_REPO_ROOT/"* ]]; then
      rel_path="${SERVER_OUT_PATH#$SERVER_REPO_ROOT/}"
      LOCAL_OUT_PATH="$ROOT_DIR/$rel_path"
    fi
  fi
fi

if [[ "$SERVER_OUT_PATH" == "$SERVER_REPO_ROOT/"* && "$LOCAL_OUT_PATH" == "$ROOT_DIR/"* && -n "$LOCAL_OUT_PATH" ]]; then
  mkdir -p "$(dirname "$LOCAL_OUT_PATH")"
  rsync -az "${SERVER_HOST}:${SERVER_OUT_PATH}" "$LOCAL_OUT_PATH"
  if [[ -n "$SERVER_OUT_PATH" ]]; then
    server_manifest_path="$(dirname "$SERVER_OUT_PATH")/manifest.json"
    local_manifest_path="$(dirname "$LOCAL_OUT_PATH")/manifest.json"
    mkdir -p "$(dirname "$local_manifest_path")"
    rsync -az "${SERVER_HOST}:${server_manifest_path}" "$local_manifest_path"
  fi
  echo "syncedLocalOutPath=$LOCAL_OUT_PATH"
fi
