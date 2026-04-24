#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { runTp12LearnedSameDayRanker } from "../src/lib/tp12_learned_same_day_ranker.mjs"

const rankKeys = [
  "selectorScoreHigh",
  "selectorScoreLow",
  "supportClusterCountHigh",
  "supportClusterCountLow",
  "supportPatternCountHigh",
  "sumClusterRowEbHigh",
  "meanClusterRowEbHigh",
  "maxClusterRowEbHigh",
  "maxClusterRowWilsonLBHigh",
  "supportWeightedClusterRowEbHigh",
  "supportSaturatedHigh",
  "supportOvercrowdRatioHigh",
  "supportOvercrowdRatioLow",
  "supportQualityRatioHigh",
  "supportWeightedPerClusterHigh",
  "effectiveClusterSupportHigh",
  "topClusterWeightShareHigh",
  "topClusterWeightShareLow",
  "return1dHigh",
  "return1dLow",
  "return3dHigh",
  "return5dHigh",
  "return20dHigh",
  "return20dLow",
  "gapPctHigh",
  "gapPctLow",
  "rangePctHigh",
  "closeLocationHigh",
  "tradedValueRel20High",
  "tradedValueRel20Low",
  "rangeRel20High",
  "returnVol20High",
  "returnVol20Low",
  "closeToHigh20PctHigh",
  "closeToHigh20PctLow",
  "closeFromLow20PctHigh",
  "exhaustionScoreRawHigh",
  "exhaustionScoreRawLow",
  "liquidityScoreRawHigh",
  "qualityScoreRawHigh",
]

const makeRank = ({ quality = 0.2, crowded = 0.8, exhausted = 0.8 } = {}) => {
  const rank = {}
  for (const key of rankKeys) rank[key] = 0.5
  rank.selectorScoreHigh = crowded
  rank.selectorScoreLow = 1 - crowded
  rank.supportClusterCountHigh = crowded
  rank.supportClusterCountLow = 1 - crowded
  rank.supportPatternCountHigh = crowded
  rank.sumClusterRowEbHigh = crowded
  rank.meanClusterRowEbHigh = quality
  rank.maxClusterRowEbHigh = quality
  rank.maxClusterRowWilsonLBHigh = quality
  rank.supportWeightedClusterRowEbHigh = crowded
  rank.supportSaturatedHigh = crowded
  rank.supportOvercrowdRatioHigh = crowded
  rank.supportOvercrowdRatioLow = 1 - crowded
  rank.supportQualityRatioHigh = quality
  rank.supportWeightedPerClusterHigh = quality
  rank.effectiveClusterSupportHigh = quality
  rank.topClusterWeightShareHigh = crowded
  rank.topClusterWeightShareLow = 1 - crowded
  rank.return1dHigh = exhausted
  rank.return1dLow = 1 - exhausted
  rank.return3dHigh = exhausted
  rank.return5dHigh = exhausted
  rank.return20dHigh = exhausted
  rank.return20dLow = 1 - exhausted
  rank.gapPctHigh = exhausted
  rank.gapPctLow = 1 - exhausted
  rank.rangePctHigh = quality
  rank.closeLocationHigh = quality
  rank.tradedValueRel20High = quality
  rank.tradedValueRel20Low = 1 - quality
  rank.rangeRel20High = quality
  rank.returnVol20High = exhausted
  rank.returnVol20Low = 1 - exhausted
  rank.closeToHigh20PctHigh = exhausted
  rank.closeToHigh20PctLow = 1 - exhausted
  rank.closeFromLow20PctHigh = quality
  rank.exhaustionScoreRawHigh = exhausted
  rank.exhaustionScoreRawLow = 1 - exhausted
  rank.liquidityScoreRawHigh = quality
  rank.qualityScoreRawHigh = quality
  rank.marketUpRatioHigh = quality
  rank.limitUpProxyRel20High = quality
  return rank
}

const row = ({ date, symbol, hitTarget, quality, crowded, exhausted }) => ({
  kind: "tp12_same_day_listwise_context_feature_v1",
  decisionDateKey: date,
  symbol,
  hitTarget,
  labelClass: hitTarget ? "positive" : "hard_negative",
  selectorScore: crowded * 10,
  supportClusterCount: Math.max(1, Math.round(crowded * 30)),
  supportQualityRatio: quality,
  maxClusterRowWilsonLB: quality,
  marketUpRatio: quality,
  limitUpProxyRel20: quality,
  topClusterId: hitTarget ? "quality" : "crowded",
  rank: makeRank({ quality, crowded, exhausted }),
  z: {},
})

const writeJsonl = (filePath, rows) => {
  fs.writeFileSync(filePath, `${rows.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8")
}

const expectReject = async (fn, pattern) => {
  let rejected = false
  try {
    await fn()
  } catch (error) {
    rejected = true
    assert.match(String(error.message || error), pattern)
  }
  assert.equal(rejected, true)
}

const main = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tp12-learned-ranker-"))
  const featuresPath = path.join(dir, "features.jsonl")
  const outSummaryPath = path.join(dir, "summary.json")
  const outPredictionsPath = path.join(dir, "predictions.jsonl")
  const rows = []
  for (const year of [2021, 2022, 2023, 2024]) {
    for (let day = 1; day <= 6; day += 1) {
      const date = `${year}-01-${String(day).padStart(2, "0")}`
      rows.push(row({ date, symbol: `${year}${day}01`, hitTarget: false, quality: 0.15, crowded: 0.95, exhausted: 0.95 }))
      rows.push(row({ date, symbol: `${year}${day}02`, hitTarget: true, quality: 0.92, crowded: 0.25, exhausted: 0.10 }))
      rows.push(row({ date, symbol: `${year}${day}03`, hitTarget: false, quality: 0.30, crowded: 0.40, exhausted: 0.60 }))
    }
  }
  writeJsonl(featuresPath, rows)
  const summary = await runTp12LearnedSameDayRanker({
    featuresPath,
    outSummaryPath,
    outPredictionsPath,
    dateFrom: "2021-01-01",
    dateTo: "2024-12-31",
    forbiddenDateFrom: "2025-01-02",
    forbiddenDateTo: "2026-04-17",
    minSelectedRows: 4,
    targetWilsonLower95: 0.8,
    topCuts: [4, 8, 24],
    epochs: 25,
    learningRate: 0.01,
    lambda: 0.001,
    maxPairsPerDate: 10,
  })
  assert.equal(summary.oosRead, false)
  assert.equal(summary.lockedSelectorEmitted, false)
  assert.equal(summary.candidateDateCount, 24)
  assert.equal(summary.baselineForced.hitRows, 0)
  assert.equal(summary.learnedForced.hitRows > summary.baselineForced.hitRows, true)
  assert.equal(fs.existsSync(outSummaryPath), true)
  assert.equal(fs.existsSync(outPredictionsPath), true)

  const oosFeaturesPath = path.join(dir, "oos-features.jsonl")
  writeJsonl(oosFeaturesPath, [row({ date: "2025-01-02", symbol: "999999", hitTarget: true, quality: 0.9, crowded: 0.1, exhausted: 0.1 })])
  await expectReject(() => runTp12LearnedSameDayRanker({
    featuresPath: oosFeaturesPath,
    outSummaryPath: path.join(dir, "bad-summary.json"),
    outPredictionsPath: path.join(dir, "bad-predictions.jsonl"),
    forbiddenDateFrom: "2025-01-02",
    forbiddenDateTo: "2026-04-17",
  }), /inside forbidden range/)

  const forbiddenFeaturePath = path.join(dir, "forbidden-feature.jsonl")
  writeJsonl(forbiddenFeaturePath, [{ ...rows[0], maxForwardReturn: 0.15 }])
  await expectReject(() => runTp12LearnedSameDayRanker({
    featuresPath: forbiddenFeaturePath,
    outSummaryPath: path.join(dir, "forbidden-summary.json"),
    outPredictionsPath: path.join(dir, "forbidden-predictions.jsonl"),
  }), /forbidden future\/path-quality live feature/)

  console.log("ok smoke_tp12_learned_same_day_ranker")
}

main().catch((error) => {
  console.error(error.stack || String(error))
  process.exit(1)
})
