#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { buildPerfectPrototypeRecentMidLowWinnerQueryDataset } from "../src/lib/perfect_prototype_recent_mid_low_winner_query_dataset.mjs"
import { buildPerfectPrototypeSupportTemporalEpisodeDataset } from "../src/lib/perfect_prototype_support_temporal_episode_dataset.mjs"
import { buildPerfectPrototypeSupportBagRoleTopologyFeatures } from "../src/lib/perfect_prototype_support_bag_role_topology_features.mjs"
import { buildPerfectPrototypeRecentMidLowWinnerLabels } from "../src/lib/perfect_prototype_recent_mid_low_winner_labels.mjs"
import { buildPerfectPrototypeSupportDateQueryDataset } from "../src/lib/perfect_prototype_support_date_query_dataset.mjs"
import { buildPerfectPrototypeSupportMatchedControlPool } from "../src/lib/perfect_prototype_support_matched_control_pool.mjs"
import { buildPerfectPrototypeSupportCounterfactualOutrankingFeatures } from "../src/lib/perfect_prototype_support_counterfactual_outranking_features.mjs"
import { buildPerfectPrototypeRecentMidLowWinnerQueryFeatures } from "../src/lib/perfect_prototype_recent_mid_low_winner_query_features.mjs"
import { calibratePerfectPrototypeRecentMidLowWinnerQuery } from "../src/lib/perfect_prototype_recent_mid_low_winner_query_calibrate.mjs"
import { buildPerfectPrototypeRecentMidLowWinnerQueryUnsat } from "../src/lib/perfect_prototype_recent_mid_low_winner_query_unsat.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_recent_mid_low_winner_query.mjs \\
    --train-input=<daily_pack.jsonl> \\
    --oos-input=<daily_pack.jsonl> \\
    --support-cases-file=<support_cases.json> \\
    --out-dir=<dir> \\
    [--family-id=recent_mid_low_same_date_winner_query] \\
    [--support-signature-family-id=low_gap_top_continuation] \\
    [--min-train-dates=10] \\
    [--min-train-months=6] \\
    [--min-train-folds=4] \\
    [--min-crossfit-positive-windows=2] \\
    [--max-crossfit-negative-windows=0] \\
    [--min-oos-match-count=3] \\
    [--lookback-trading-days=4] \\
    [--control-pool-size=5]`)
}

const parseArgs = (argv) => {
  const args = {
    familyId: "recent_mid_low_same_date_winner_query",
    supportSignatureFamilyId: "low_gap_top_continuation",
    minTrainDates: 10,
    minTrainMonths: 6,
    minTrainFolds: 4,
    minCrossfitPositiveWindows: 2,
    maxCrossfitNegativeWindows: 0,
    minOosMatchCount: 3,
    lookbackTradingDays: 4,
    controlPoolSize: 5,
  }
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      usage()
      process.exit(0)
    }
    if (!arg.startsWith("--")) continue
    const [key, ...rest] = arg.slice(2).split("=")
    const value = rest.join("=")
    switch (key) {
      case "train-input":
        args.trainInput = value
        break
      case "oos-input":
        args.oosInput = value
        break
      case "support-cases-file":
        args.supportCasesFile = value
        break
      case "out-dir":
        args.outDir = value
        break
      case "family-id":
        args.familyId = value
        break
      case "support-signature-family-id":
        args.supportSignatureFamilyId = value
        break
      case "min-train-dates":
        args.minTrainDates = Number(value)
        break
      case "min-train-months":
        args.minTrainMonths = Number(value)
        break
      case "min-train-folds":
        args.minTrainFolds = Number(value)
        break
      case "min-crossfit-positive-windows":
        args.minCrossfitPositiveWindows = Number(value)
        break
      case "max-crossfit-negative-windows":
        args.maxCrossfitNegativeWindows = Number(value)
        break
      case "min-oos-match-count":
        args.minOosMatchCount = Number(value)
        break
      case "lookback-trading-days":
        args.lookbackTradingDays = Number(value)
        break
      case "control-pool-size":
        args.controlPoolSize = Number(value)
        break
      default:
        throw new Error(`Unknown arg: --${key}`)
    }
  }
  if (!args.trainInput || !args.oosInput || !args.supportCasesFile || !args.outDir) {
    usage()
    throw new Error("Missing required args")
  }
  return args
}

const loadJsonl = async (filePath) =>
  (await fs.readFile(filePath, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))

const loadSupportCases = async (filePath) => {
  const payload = JSON.parse(await fs.readFile(filePath, "utf8"))
  return payload?.supportCases ?? payload
}

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

const writeUnsat = async ({ outDir, value }) =>
  writeJson(path.join(outDir, "no_support_recent_mid_low_winner_query_summary.json"), value)

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  await fs.mkdir(args.outDir, { recursive: true })
  const trainRows = await loadJsonl(args.trainInput)
  const oosRows = await loadJsonl(args.oosInput)
  const supportCases = await loadSupportCases(args.supportCasesFile)

  let family = buildPerfectPrototypeRecentMidLowWinnerQueryDataset({
    familyId: args.familyId,
    supportSignatureFamilyId: args.supportSignatureFamilyId,
    trainRows,
    oosRows,
    supportCases,
  })
  await writeJson(path.join(args.outDir, "recent_mid_low_winner_query_dataset_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason, supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  family = buildPerfectPrototypeSupportTemporalEpisodeDataset({
    family,
    lookbackTradingDays: args.lookbackTradingDays,
  })
  await writeJson(path.join(args.outDir, "support_temporal_episode_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_episode_windows", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  family = buildPerfectPrototypeSupportBagRoleTopologyFeatures({ family })
  await writeJson(path.join(args.outDir, "support_role_topology_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_role_topology_features", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  family = buildPerfectPrototypeRecentMidLowWinnerLabels({ family })
  await writeJson(path.join(args.outDir, "recent_mid_low_winner_labels_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_recent_mid_low_winner_labels", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  family = buildPerfectPrototypeSupportDateQueryDataset({ family })
  await writeJson(path.join(args.outDir, "support_date_query_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_date_queries", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  family = buildPerfectPrototypeSupportMatchedControlPool({
    family,
    controlPoolSize: args.controlPoolSize,
  })
  await writeJson(path.join(args.outDir, "support_matched_control_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_matched_control_queries", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  family = buildPerfectPrototypeSupportCounterfactualOutrankingFeatures({ family })
  await writeJson(path.join(args.outDir, "support_counterfactual_outranking_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_counterfactual_outranking_features", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  family = buildPerfectPrototypeRecentMidLowWinnerQueryFeatures({ family })
  await writeJson(path.join(args.outDir, "recent_mid_low_winner_query_feature_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_recent_mid_low_winner_query_features", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  const ranker = calibratePerfectPrototypeRecentMidLowWinnerQuery({
    family,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    minCrossfitPositiveWindows: args.minCrossfitPositiveWindows,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
    minOosMatchCount: args.minOosMatchCount,
  })
  await writeJson(path.join(args.outDir, "recent_mid_low_winner_query_ranker_summary.json"), ranker)
  if (!ranker.ok) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeRecentMidLowWinnerQueryUnsat(ranker),
    })
    return
  }

  await writeJson(path.join(args.outDir, "recent_mid_low_winner_query_artifact.json"), ranker.artifact)
  await writeJson(path.join(args.outDir, "recent_mid_low_winner_query_solution.json"), ranker)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
