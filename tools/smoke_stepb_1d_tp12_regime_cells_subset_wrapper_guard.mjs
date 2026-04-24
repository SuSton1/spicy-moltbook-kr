import fs from "node:fs/promises"
import path from "node:path"

const wrapperPath = path.join(process.cwd(), "tools", "server_run_stepb_1d_tp12_regime_cells_200k.sh")
const source = await fs.readFile(wrapperPath, "utf8")

const forbiddenPatterns = [
  'TOP_EXIT_CODE="$(cat "$OUT_DIR/top_1d_exit_code.txt")"',
  'MID_EXIT_CODE="$(cat "$OUT_DIR/mid_1d_exit_code.txt")"',
  'LOW_EXIT_CODE="$(cat "$OUT_DIR/low_1d_exit_code.txt")"',
]
for (const pattern of forbiddenPatterns) {
  if (source.includes(pattern)) {
    throw new Error(`wrapper still contains unconditional cell aggregation pattern: ${pattern}`)
  }
}

const requiredPatterns = [
  'REPORT_ARGS=(',
  'DONE_LINES=(',
  'case "$cell_id" in',
  'REPORT_ARGS+=(--top=',
  'REPORT_ARGS+=(--mid=',
  'REPORT_ARGS+=(--low=',
  'node tools/build_stepb_1d_tp12_regime_cells_report.mjs "${REPORT_ARGS[@]}"',
]
for (const pattern of requiredPatterns) {
  if (!source.includes(pattern)) {
    throw new Error(`wrapper missing subset-safe aggregation pattern: ${pattern}`)
  }
}

console.log('ok: smoke_stepb_1d_tp12_regime_cells_subset_wrapper_guard')
