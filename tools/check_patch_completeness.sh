#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/check_patch_completeness.sh --bundle <bundle_dir> [--repo-root <repo_root>] [--strict-log]

Options:
  --bundle     Bundle directory created from docs/templates/gptpro_patch
  --repo-root  Repo root path (default: current directory)
  --strict-log Fail if APPLY_LOG.jsonl has no "done" chunk
EOF
}

if ! command -v node >/dev/null 2>&1; then
  echo "[fatal] node not found" >&2
  exit 1
fi

BUNDLE_DIR=""
REPO_ROOT="$(pwd)"
STRICT_LOG=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle)
      BUNDLE_DIR="${2:-}"
      shift 2
      ;;
    --repo-root)
      REPO_ROOT="${2:-}"
      shift 2
      ;;
    --strict-log)
      STRICT_LOG=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[fatal] unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$BUNDLE_DIR" ]]; then
  echo "[fatal] --bundle is required" >&2
  usage
  exit 1
fi

if [[ ! -d "$REPO_ROOT" ]]; then
  echo "[fatal] repo root not found: $REPO_ROOT" >&2
  exit 1
fi

if [[ ! -d "$BUNDLE_DIR" ]]; then
  echo "[fatal] bundle dir not found: $BUNDLE_DIR" >&2
  exit 1
fi

required_files=(
  "PLAN.md"
  "FILELIST.tsv"
  "FORMULA.md"
  "ACCEPTANCE.md"
  "PATCH_CHUNKS.tsv"
  "APPLY_LOG.jsonl"
)

for f in "${required_files[@]}"; do
  if [[ ! -f "$BUNDLE_DIR/$f" ]]; then
    echo "[fatal] missing required file: $BUNDLE_DIR/$f" >&2
    exit 1
  fi
done

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

declare -A expected_type
declare -A expected_seen
expected_order=()

while IFS=$'\t' read -r type path _rest; do
  type="$(trim "$type")"
  path="$(trim "$path")"
  [[ -z "$type" || "$type" == \#* ]] && continue
  case "$type" in
    MOD|NEW|DEL|MOVE) ;;
    *)
      echo "[fatal] invalid TYPE in FILELIST.tsv: $type" >&2
      exit 1
      ;;
  esac
  if [[ -z "$path" ]]; then
    echo "[fatal] empty PATH in FILELIST.tsv" >&2
    exit 1
  fi

  if [[ "$type" == "MOVE" ]]; then
    if [[ "$path" != *"=>"* ]]; then
      echo "[fatal] MOVE path must use old=>new format: $path" >&2
      exit 1
    fi
    old_path="$(trim "${path%%=>*}")"
    new_path="$(trim "${path##*=>}")"
    expected_type["$old_path"]="MOVE_OLD"
    expected_type["$new_path"]="MOVE_NEW"
    expected_order+=("$old_path")
    expected_order+=("$new_path")
  else
    expected_type["$path"]="$type"
    expected_order+=("$path")
  fi
done < "$BUNDLE_DIR/FILELIST.tsv"

if [[ "${#expected_order[@]}" -eq 0 ]]; then
  echo "[fatal] FILELIST.tsv has no effective rows" >&2
  exit 1
fi

declare -A chunk_declared
chunk_ids=()
while IFS=$'\t' read -r chunk_id _goal files_csv _verify; do
  chunk_id="$(trim "$chunk_id")"
  files_csv="$(trim "$files_csv")"
  [[ -z "$chunk_id" || "$chunk_id" == \#* ]] && continue
  chunk_ids+=("$chunk_id")
  IFS=',' read -ra arr <<< "$files_csv"
  for raw in "${arr[@]}"; do
    f="$(trim "$raw")"
    [[ -z "$f" ]] && continue
    chunk_declared["$f"]=1
  done
done < "$BUNDLE_DIR/PATCH_CHUNKS.tsv"

if [[ "${#chunk_ids[@]}" -eq 0 ]]; then
  echo "[fatal] PATCH_CHUNKS.tsv has no effective rows" >&2
  exit 1
fi

declare -A chunk_done
declare -A log_files
done_count=0

while IFS=$'\t' read -r kind a b; do
  case "$kind" in
    CHUNK)
      chunk="$a"
      status="$b"
      if [[ -n "$chunk" && "$status" == "done" ]]; then
        chunk_done["$chunk"]=1
        done_count=$((done_count + 1))
      fi
      ;;
    FILE)
      if [[ -n "$a" ]]; then
        log_files["$a"]=1
      fi
      ;;
  esac
done < <(
  node - "$BUNDLE_DIR/APPLY_LOG.jsonl" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const txt = fs.readFileSync(path, "utf8");
for (const raw of txt.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line) continue;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    continue;
  }
  const chunk = typeof obj.chunk === "string" ? obj.chunk : "";
  const status = typeof obj.status === "string" ? obj.status : "";
  if (chunk) process.stdout.write(`CHUNK\t${chunk}\t${status}\n`);
  const files = Array.isArray(obj.files) ? obj.files : [];
  for (const f of files) {
    if (typeof f === "string" && f.trim()) {
      process.stdout.write(`FILE\t${f.trim()}\t\n`);
    }
  }
}
NODE
)

if [[ "$STRICT_LOG" -eq 1 && "$done_count" -eq 0 ]]; then
  echo "[fatal] no done chunk in APPLY_LOG.jsonl" >&2
  exit 1
fi

missing_chunks=()
for id in "${chunk_ids[@]}"; do
  if [[ -z "${chunk_done[$id]:-}" ]]; then
    missing_chunks+=("$id")
  fi
done

missing_in_chunks=()
missing_in_log=()
fs_failures=()

for path in "${expected_order[@]}"; do
  typ="${expected_type[$path]}"
  if [[ -z "${chunk_declared[$path]:-}" ]]; then
    missing_in_chunks+=("$path")
  fi
  if [[ -z "${log_files[$path]:-}" ]]; then
    missing_in_log+=("$path")
  fi

  abs="$REPO_ROOT/$path"
  case "$typ" in
    MOD|NEW|MOVE_NEW)
      if [[ ! -e "$abs" ]]; then
        fs_failures+=("$typ:$path (missing)")
      fi
      ;;
    DEL|MOVE_OLD)
      if [[ -e "$abs" ]]; then
        fs_failures+=("$typ:$path (still exists)")
      fi
      ;;
  esac
done

echo "[summary] bundle=$BUNDLE_DIR"
echo "[summary] expected_paths=${#expected_order[@]} chunks=${#chunk_ids[@]} done_chunks=$done_count"

if [[ "${#missing_chunks[@]}" -gt 0 ]]; then
  echo "[fail] missing done chunks:"
  printf '  - %s\n' "${missing_chunks[@]}"
fi
if [[ "${#missing_in_chunks[@]}" -gt 0 ]]; then
  echo "[fail] FILELIST path not declared in PATCH_CHUNKS:"
  printf '  - %s\n' "${missing_in_chunks[@]}"
fi
if [[ "${#missing_in_log[@]}" -gt 0 ]]; then
  echo "[fail] FILELIST path not present in APPLY_LOG files:"
  printf '  - %s\n' "${missing_in_log[@]}"
fi
if [[ "${#fs_failures[@]}" -gt 0 ]]; then
  echo "[fail] filesystem contract violations:"
  printf '  - %s\n' "${fs_failures[@]}"
fi

if [[ "${#missing_chunks[@]}" -gt 0 || "${#missing_in_chunks[@]}" -gt 0 || "${#missing_in_log[@]}" -gt 0 || "${#fs_failures[@]}" -gt 0 ]]; then
  exit 1
fi

echo "[ok] patch completeness check passed"
