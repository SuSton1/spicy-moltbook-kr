import fs from "node:fs/promises"
import path from "node:path"

const wrapperPath = path.join(process.cwd(), "tools", "server_run_stepb_1d_tp12_top_subscopes_200k.sh")
const source = await fs.readFile(wrapperPath, "utf8")

const forbiddenPatterns = [
  'GAP_TOPHIGH_EXIT_CODE="$(cat',
  'CLOSE_ABOVE_EXIT_CODE="$(cat',
  'JUMP_ABOVE_EXIT_CODE="$(cat',
  'CROWDING_HIGH_EXIT_CODE="$(cat',
  'CROWDING_LOWMID_EXIT_CODE="$(cat',
]
for (const pattern of forbiddenPatterns) {
  if (source.includes(pattern)) {
    throw new Error(`wrapper still contains unconditional subscope aggregation pattern: ${pattern}`)
  }
}

const requiredPatterns = [
  'REPORT_ARGS=(',
  'DONE_LINES=(',
  'case "$subscope_id" in',
  'ENABLE_PROMOTABLE_SEARCH_PRUNE=""',
  'ENABLE_PROMOTABLE_SEARCH_ORDERING=""',
  '--enable-promotable-search-prune=*) ENABLE_PROMOTABLE_SEARCH_PRUNE="${arg#*=}" ;;',
  '--enable-promotable-search-ordering=*) ENABLE_PROMOTABLE_SEARCH_ORDERING="${arg#*=}" ;;',
  'local enable_promotable_search_prune="$PROMOTABLE_FIRST"',
  'local enable_promotable_search_ordering="$PROMOTABLE_FIRST"',
  '--enable-promotable-search-prune="$enable_promotable_search_prune"',
  '--enable-promotable-search-ordering="$enable_promotable_search_ordering"',
  'REPORT_ARGS+=(--gap-tophigh=',
  'REPORT_ARGS+=(--close-above=',
  'REPORT_ARGS+=(--jump-above=',
  'REPORT_ARGS+=(--crowding-high=',
  'REPORT_ARGS+=(--crowding-lowmid=',
  'node tools/build_stepb_1d_tp12_top_subscopes_report.mjs "${REPORT_ARGS[@]}"',
]
for (const pattern of requiredPatterns) {
  if (!source.includes(pattern)) {
    throw new Error(`wrapper missing subset-safe top-subscope aggregation pattern: ${pattern}`)
  }
}

console.log('ok: smoke_stepb_1d_tp12_top_subscopes_subset_wrapper_guard')
