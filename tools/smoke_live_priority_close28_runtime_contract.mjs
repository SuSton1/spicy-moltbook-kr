import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"

import { readJson } from "../src/lib/io.mjs"

const main = async () => {
  const root = process.cwd()
  const registry = await readJson(path.join(root, "config", "ops", "live_priority_registry.server.json"), null)
  assert.ok(registry && typeof registry === "object")
  assert.equal(Number(registry?.recommendationCloseRetFilterGtePct ?? 0), 28)

  const lines = Array.isArray(registry?.lines) ? registry.lines : []
  assert.ok(lines.length > 0, "expected live priority lines")
  for (const line of lines) {
    assert.equal(
      Number(line?.excludeRecommendationCloseRetPctGte ?? 0),
      28,
      `expected close28 filter for ${line?.lineId ?? "unknown"}`,
    )
  }

  const plusLiteWrapper = await fs.readFile(
    path.join(root, "tools", "server_stepb_plus_lite_curated_after_close.sh"),
    "utf8",
  )
  assert.match(
    plusLiteWrapper,
    /--exclude-recommendation-close-ret-pct-gte="\$EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE"/,
  )
  assert.match(plusLiteWrapper, /--candle-path="\$ROOT_DIR\/data\/candle_daily\.jsonl"/)

  const afreeWrapper = await fs.readFile(
    path.join(root, "tools", "server_stepb_afree_curated_perfect_prototypes_after_close.sh"),
    "utf8",
  )
  assert.match(
    afreeWrapper,
    /--exclude-recommendation-close-ret-pct-gte="\$EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE"/,
  )
  assert.match(afreeWrapper, /--candle-path="\$ROOT_DIR\/data\/candle_daily\.jsonl"/)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
