import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildTp12SideDailyFeaturePackBridge } from "../src/lib/tp12_side_daily_feature_bridge.mjs"
import { ensureDir, readJson, readJsonl, writeJsonl } from "../src/lib/io.mjs"


const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const main = async () => {
  const tmpRoot = path.join(ROOT, "artifacts", "checks", "smoke_tp12_side_daily_feature_bridge")
  const featurePackPath = path.join(tmpRoot, "step-d", "decision_candidates_feature_pack.jsonl")
  const sideFeaturePath = path.join(tmpRoot, "features", "feature_rows.jsonl")
  const outPath = path.join(tmpRoot, "bridged", "decision_candidates_feature_pack_side_d0_close.jsonl")
  const metaOutPath = `${outPath}.meta.json`

  await ensureDir(tmpRoot)
  await writeJsonl(featurePackPath, [
    {
      symbol: "111111",
      decisionDateKey: "2024-01-04",
      featureVec: {
        "daily.alpha": 1.5,
      },
      contextualTokens: ["tag:baseline"],
    },
  ])
  await writeJsonl(sideFeaturePath, [
    {
      kind: "tp12_side_daily_feature_dataset_v1",
      requestId: "2024-01-04::111111::same_day_high8",
      symbol: "111111",
      decisionDateKey: "2024-01-04",
      gateId: "d0_close",
      featureCutoffDateKey: "2024-01-04",
      entryPriceMode: "next_day_open",
      supportedDatasetIds: ["investor_daily", "program_daily"],
      features: {
        investor_day_delta: 80,
        program_day_delta: 3000,
      },
      labels: {
        tp12_no_stop_hit_3d: 1,
      },
    },
  ])

  const summary = await buildTp12SideDailyFeaturePackBridge({
    featurePackPath,
    sideFeaturePath,
    gateId: "d0_close",
    outPath,
    metaOutPath,
  })

  const bridgedRows = await readJsonl(outPath)
  const meta = await readJson(metaOutPath)
  assert(summary.rowCount === 1, `unexpected bridge rowCount: ${summary.rowCount}`)
  assert(bridgedRows.length === 1, `unexpected bridged row count: ${bridgedRows.length}`)
  const row = bridgedRows[0]
  assert(row.featureVec["daily.alpha"] === 1.5, "missing baseline feature")
  assert(row.featureVec["side.investor_day_delta"] === 80, "missing side investor feature")
  assert(row.featureVec["side.program_day_delta"] === 3000, "missing side program feature")
  assert(!("labels" in row), "bridge must not copy labels")
  assert(Array.isArray(row.contextualTokens) && row.contextualTokens.includes("tag:sideDailyGate:d0_close"), "missing sideDailyGate token")
  assert(row.sideDailyBridge?.featureCount === 2, `unexpected sideDailyBridge featureCount: ${row.sideDailyBridge?.featureCount}`)
  assert(meta.kind === "tp12_side_daily_feature_pack_bridge_v1", `unexpected meta kind: ${meta.kind}`)

  console.log("ok smoke_tp12_side_daily_feature_bridge")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
