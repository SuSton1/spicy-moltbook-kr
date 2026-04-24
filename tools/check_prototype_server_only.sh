#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

tool_files=(
  "tools/build_perfect_prototype_daily_pack.mjs"
  "tools/build_perfect_prototype_prejump_pack.mjs"
  "tools/mine_perfect_prototypes.mjs"
  "tools/report_perfect_prototypes_oos.mjs"
  "tools/mine_perfect_prototype_parents.mjs"
  "tools/apply_perfect_prototypes.mjs"
  "tools/merge_curated_perfect_prototype_live_results.mjs"
  "tools/merge_live_priority_results.mjs"
  "tools/server_run_live_priority_stack.mjs"
)

for file in "${tool_files[@]}"; do
  grep -q "assertPerfectPrototypeServerWorkspace" "$file" \
    || { echo "missing server workspace guard: $file"; exit 1; }
  grep -q "assertPerfectPrototypeServerPaths" "$file" \
    || { echo "missing server path guard: $file"; exit 1; }
done

grep -q "assertPerfectPrototypeServerDataPaths" "src/lib/perfect_prototype_daily_pack.mjs" \
  || { echo "missing server data-path guard: src/lib/perfect_prototype_daily_pack.mjs"; exit 1; }
grep -q "assertPerfectPrototypeServerDataPaths" "src/lib/perfect_prototype_prejump_pack.mjs" \
  || { echo "missing server data-path guard: src/lib/perfect_prototype_prejump_pack.mjs"; exit 1; }

[[ -x "tools/run_server_command.sh" ]] \
  || { echo "missing executable server runner: tools/run_server_command.sh"; exit 1; }

echo "prototype server-only guard ok"
