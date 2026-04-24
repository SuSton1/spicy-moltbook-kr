#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_RULE_IDS_FILE="$ROOT_DIR/artifacts/curated/perfect_proto_prejump_live_rule_ids.txt"
DEFAULT_LABEL="prejump_live_v2"

SOURCE_CATALOG=""
RULE_IDS_FILE="$DEFAULT_RULE_IDS_FILE"
OUT_PATH=""
LABEL="$DEFAULT_LABEL"
NOTE=""
ALLOW_MUTABLE_OUTPUT=""

usage() {
  cat <<EOF
Usage: bash tools/server_rebuild_prejump_curated_perfect_prototype_catalog.sh --source-catalog=/abs/path/catalog.json [--rule-ids-file=/abs/path/ids.txt] [--out-path=/abs/path/catalog.json] [--label=<label>] [--note=<note>] [--allow-mutable-output=true]
EOF
}

for arg in "$@"; do
  case "$arg" in
    --source-catalog=*) SOURCE_CATALOG="${arg#*=}" ;;
    --rule-ids-file=*) RULE_IDS_FILE="${arg#*=}" ;;
    --out-path=*) OUT_PATH="${arg#*=}" ;;
    --label=*) LABEL="${arg#*=}" ;;
    --note=*) NOTE="${arg#*=}" ;;
    --allow-mutable-output=*) ALLOW_MUTABLE_OUTPUT="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "[fatal] unknown arg: $arg" >&2
      usage >&2
      exit 4
      ;;
  esac
done

if [[ -z "$SOURCE_CATALOG" ]]; then
  echo "[fatal] missing --source-catalog" >&2
  usage >&2
  exit 4
fi

if [[ ! -f "$SOURCE_CATALOG" ]]; then
  echo "[fatal] source catalog not found: $SOURCE_CATALOG" >&2
  exit 4
fi

if [[ ! -f "$RULE_IDS_FILE" ]]; then
  echo "[fatal] rule ids file not found: $RULE_IDS_FILE" >&2
  exit 4
fi

node - "$SOURCE_CATALOG" <<'NODE'
const fs = require("fs")

const [catalogPath] = process.argv.slice(2)
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"))
const surface = String(catalog?.tokenizerSpec?.surface ?? "").trim().toLowerCase()
if (surface !== "v5_prejump_contextual") {
  throw new Error(
    [
      "Predictive curated rebuild requires a v5_prejump_contextual source catalog.",
      `Found tokenizer surface: ${surface || "unknown"}`,
    ].join(" "),
  )
}
NODE

cmd=(
  node tools/build_curated_perfect_prototype_catalog.mjs
  "--source-catalog=$SOURCE_CATALOG"
  "--rule-ids-file=$RULE_IDS_FILE"
  "--label=$LABEL"
)

if [[ -n "$OUT_PATH" ]]; then
  cmd+=("--out-path=$OUT_PATH")
fi

if [[ -n "$NOTE" ]]; then
  cmd+=("--note=$NOTE")
fi

if [[ -n "$ALLOW_MUTABLE_OUTPUT" ]]; then
  cmd+=("--allow-mutable-output=$ALLOW_MUTABLE_OUTPUT")
fi

builder_output="$("${cmd[@]}")"
echo "$builder_output"

readarray -t BUILDER_PATHS < <(printf '%s\n' "$builder_output" | node - <<'NODE'
const fs = require("fs")
const text = fs.readFileSync(0, "utf8").trim()
if (!text) process.exit(0)
const parsed = JSON.parse(text)
if (parsed?.outPath) console.log(parsed.outPath)
if (parsed?.manifestPath) console.log(parsed.manifestPath)
NODE
)
if [[ -n "${BUILDER_PATHS[0]:-}" ]]; then
  OUT_PATH="${BUILDER_PATHS[0]}"
fi

echo "[ok] predictive curated catalog rebuilt"
echo "sourceCatalog=$SOURCE_CATALOG"
echo "ruleIdsFile=$RULE_IDS_FILE"
echo "outPath=$OUT_PATH"
echo "manifestPath=$(dirname "$OUT_PATH")/manifest.json"
