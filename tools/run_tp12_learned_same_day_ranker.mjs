#!/usr/bin/env node
import { runTp12LearnedSameDayRanker } from "../src/lib/tp12_learned_same_day_ranker.mjs"

const parseArgs = (argv) => {
  const out = {}
  for (const arg of argv) {
    if (!arg.startsWith("--")) throw new Error(`unknown positional arg: ${arg}`)
    const index = arg.indexOf("=")
    if (index === -1) out[arg.slice(2)] = true
    else out[arg.slice(2, index)] = arg.slice(index + 1)
  }
  return out
}

const requireArg = (args, key) => {
  const value = args[key]
  if (!value) throw new Error(`missing required --${key}`)
  return value
}

const numberArg = (args, key, fallback) => {
  if (args[key] === undefined || args[key] === "") return fallback
  const value = Number(args[key])
  if (!Number.isFinite(value)) throw new Error(`--${key} must be finite`)
  return value
}

const listArg = (args, key, fallback) => {
  const raw = args[key]
  if (raw === undefined || raw === "") return fallback
  return String(raw).split(",").map((value) => {
    const parsed = Number(value.trim())
    if (!Number.isFinite(parsed)) throw new Error(`--${key} contains non-finite value: ${value}`)
    return parsed
  })
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const summary = await runTp12LearnedSameDayRanker({
    featuresPath: requireArg(args, "features"),
    outSummaryPath: requireArg(args, "out-summary"),
    outPredictionsPath: requireArg(args, "out-predictions"),
    dateFrom: args["date-from"] ?? null,
    dateTo: args["date-to"] ?? null,
    forbiddenDateFrom: args["forbidden-date-from"] ?? null,
    forbiddenDateTo: args["forbidden-date-to"] ?? null,
    minSelectedRows: numberArg(args, "min-selected-rows", 150),
    targetWilsonLower95: numberArg(args, "target-wilson-lower95", 0.8),
    topCuts: listArg(args, "top-cuts", [50, 75, 100, 150, 200, 300, 500, 978]),
    epochs: numberArg(args, "epochs", 60),
    learningRate: numberArg(args, "learning-rate", 0.005),
    lambda: numberArg(args, "lambda", 0.01),
    maxPairsPerDate: numberArg(args, "max-pairs-per-date", 120),
    baselineSelectedFalsePositiveMultiplier: numberArg(args, "baseline-selected-fp-multiplier", 1.5),
  })
  console.log(JSON.stringify({
    status: summary.status,
    mode: summary.mode,
    modelId: summary.modelId,
    candidateRows: summary.candidateRows,
    candidateDateCount: summary.candidateDateCount,
    baselineHitRows: summary.baselineForced.hitRows,
    baselineHitRate: summary.baselineForced.hitRate,
    supportTemperedHitRows: summary.supportTemperedForced.hitRows,
    supportTemperedHitRate: summary.supportTemperedForced.hitRate,
    learnedHitRows: summary.learnedForced.hitRows,
    learnedHitRate: summary.learnedForced.hitRate,
    learnedVsBaselineHitRateDelta: summary.learnedVsBaselineHitRateDelta,
    learnedTopCut150HitRows: summary.learnedTopCut150?.hitRows ?? null,
    learnedTopCut150HitRate: summary.learnedTopCut150?.hitRate ?? null,
    learnedTopCut150WilsonLower95: summary.learnedTopCut150?.wilsonLower95 ?? null,
    learnedBestTopCutRows: summary.learnedBestTopCut?.topCutRows ?? null,
    learnedBestTopCutHitRows: summary.learnedBestTopCut?.hitRows ?? null,
    learnedBestTopCutHitRate: summary.learnedBestTopCut?.hitRate ?? null,
    h80PassedTopCutCount: summary.h80PassedTopCutCount,
    lockedSelectorEmitted: summary.lockedSelectorEmitted,
    outSummaryPath: args["out-summary"],
  }, null, 2))
}

main().catch((error) => {
  console.error(error.stack || String(error))
  process.exit(1)
})
