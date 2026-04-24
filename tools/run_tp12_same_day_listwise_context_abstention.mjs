#!/usr/bin/env node
import { runTp12SameDayListwiseContextAbstention } from "../src/lib/tp12_same_day_listwise_context_abstention.mjs"

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
  const summary = await runTp12SameDayListwiseContextAbstention({
    candidatesPath: requireArg(args, "candidates"),
    pathLabelsPath: requireArg(args, "path-labels"),
    outSummaryPath: requireArg(args, "out-summary"),
    outSelectionsPath: requireArg(args, "out-selections"),
    outFeaturesPath: requireArg(args, "out-features"),
    dateFrom: args["date-from"] ?? null,
    dateTo: args["date-to"] ?? null,
    forbiddenDateFrom: args["forbidden-date-from"] ?? null,
    forbiddenDateTo: args["forbidden-date-to"] ?? null,
    targetPct: numberArg(args, "target-pct", 0.12),
    nearMissMinPct: numberArg(args, "near-miss-min-pct", 0.08),
    hardNegativeMaxForwardReturnPct: numberArg(args, "hard-negative-max-forward-return-pct", 0.04),
    minSelectedRows: numberArg(args, "min-selected-rows", 150),
    targetWilsonLower95: numberArg(args, "target-wilson-lower95", 0.8),
    primaryPolicyId: args["primary-policy-id"] ?? "listwise_context_quality_v1",
    primaryTopCutRows: numberArg(args, "primary-top-cut-rows", 150),
    topCuts: listArg(args, "top-cuts", [50, 75, 100, 150, 200, 300, 500]),
  })
  console.log(JSON.stringify({
    status: summary.status,
    mode: summary.mode,
    candidateRows: summary.candidateRows,
    candidateDateCount: summary.candidateDateCount,
    dailyOracleHitRate: summary.dailyOracleHitRate,
    baselineHitRows: summary.baselineForced?.hitRows ?? null,
    baselineHitRate: summary.baselineForced?.hitRate ?? null,
    primaryPolicyId: summary.primaryPolicyId,
    primaryForcedHitRows: summary.primaryForced.hitRows,
    primaryForcedHitRate: summary.primaryForced.hitRate,
    primaryTopCutRows: summary.primaryTopCutRows,
    primaryTopCutHitRows: summary.primaryTopCut.hitRows,
    primaryTopCutHitRate: summary.primaryTopCut.hitRate,
    primaryTopCutWilsonLower95: summary.primaryTopCut.wilsonLower95,
    bestForcedPolicyId: summary.bestForcedPolicyId,
    bestForcedHitRows: summary.bestForced.hitRows,
    bestForcedHitRate: summary.bestForced.hitRate,
    bestForcedVsBaselineHitRateDelta: summary.bestForcedVsBaselineHitRateDelta,
    bestTopCutPolicyId: summary.bestTopCutPolicyId,
    bestTopCutRows: summary.bestTopCut?.topCutRows ?? null,
    bestTopCutHitRows: summary.bestTopCut?.hitRows ?? null,
    bestTopCutHitRate: summary.bestTopCut?.hitRate ?? null,
    h80PassedTopCutCount: summary.h80PassedTopCutCount,
    lockedSelectorEmitted: summary.lockedSelectorEmitted,
    outSummaryPath: args["out-summary"],
  }, null, 2))
}

main().catch((error) => {
  console.error(error.stack || String(error))
  process.exit(1)
})
