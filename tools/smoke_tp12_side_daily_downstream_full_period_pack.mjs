import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildTp12SideDailyDownstreamFullPeriodPack } from "../src/lib/tp12_side_daily_downstream_full_period_pack.mjs"
import { ensureDir, readJson, readJsonl, writeJsonl } from "../src/lib/io.mjs"


const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const main = async () => {
  const tmpRoot = path.join(ROOT, "artifacts", "checks", "smoke_tp12_side_daily_downstream_full_period_pack")
  const trainPackPath = path.join(tmpRoot, "train", "daily_pack.jsonl")
  const oosPackPath = path.join(tmpRoot, "oos", "daily_pack.jsonl")
  const outPath = path.join(tmpRoot, "combined", "daily_pack.jsonl")
  const summaryOutPath = path.join(tmpRoot, "combined", "downstream_full_period_pack_summary.json")

  await ensureDir(tmpRoot)
  await writeJsonl(trainPackPath, [
    {
      symbol: "111111",
      decisionDateKey: "2024-12-30",
      stepALaneId: "recent_impulse_1d",
      featureVec: { "daily.alpha": 1 },
      sourceType: "perfect_prototype_stepb_open_eval_pack",
      baselineLineId: "stepb_dplus1_plus_lite",
      discoveryUniverseId: "recent_impulse_upto_1d",
    },
  ])
  await writeJsonl(oosPackPath, [
    {
      symbol: "222222",
      decisionDateKey: "2025-01-02",
      stepALaneId: "recent_impulse_1d",
      featureVec: { "daily.alpha": 2 },
      sourceType: "perfect_prototype_stepb_open_eval_pack",
      baselineLineId: "stepb_dplus1_plus_lite",
      discoveryUniverseId: "recent_impulse_upto_1d",
    },
  ])

  const result = await buildTp12SideDailyDownstreamFullPeriodPack({
    trainPackPath,
    oosPackPath,
    outPath,
    summaryOutPath,
  })

  const rows = await readJsonl(outPath)
  const summary = await readJson(summaryOutPath)

  assert(rows.length === 2, `unexpected combined row count: ${rows.length}`)
  assert(result.summary.rowCount === 2, `unexpected builder rowCount: ${result.summary.rowCount}`)
  assert(
    summary.kind === "tp12_side_daily_downstream_full_period_pack_v1",
    `unexpected summary kind: ${summary.kind}`,
  )
  assert(summary.trainRowCount === 1, `unexpected trainRowCount: ${summary.trainRowCount}`)
  assert(summary.oosRowCount === 1, `unexpected oosRowCount: ${summary.oosRowCount}`)
  assert(summary.decisionDateFrom === "2024-12-30", `unexpected decisionDateFrom: ${summary.decisionDateFrom}`)
  assert(summary.decisionDateTo === "2025-01-02", `unexpected decisionDateTo: ${summary.decisionDateTo}`)
  assert(summary.stepALaneIds?.includes("recent_impulse_1d"), "missing stepALaneIds coverage")

  console.log("ok smoke_tp12_side_daily_downstream_full_period_pack")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
