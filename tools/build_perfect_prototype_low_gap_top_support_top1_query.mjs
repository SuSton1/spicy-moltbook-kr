#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { buildPerfectPrototypeLowGapTopPrototypeCohort } from "../src/lib/perfect_prototype_low_gap_top_prototype_cohort.mjs"
import { buildPerfectPrototypeSupportContrastiveBridgeFamily } from "../src/lib/perfect_prototype_support_bridge_family.mjs"
import { buildPerfectPrototypeSupportBoundaryResidualFamily } from "../src/lib/perfect_prototype_support_boundary_residual_features.mjs"
import { buildPerfectPrototypeSupportRecurrencePurityFamily } from "../src/lib/perfect_prototype_support_recurrence_purity_features.mjs"
import { buildPerfectPrototypeSupportOrdinalMotifFeatures } from "../src/lib/perfect_prototype_support_ordinal_motif_features.mjs"
import { buildPerfectPrototypeSupportTemporalEpisodeDataset } from "../src/lib/perfect_prototype_support_temporal_episode_dataset.mjs"
import { buildPerfectPrototypeSupportBagRoleTopologyFeatures } from "../src/lib/perfect_prototype_support_bag_role_topology_features.mjs"
import { buildPerfectPrototypeSupportDateQueryDataset } from "../src/lib/perfect_prototype_support_date_query_dataset.mjs"
import { buildPerfectPrototypeSupportMatchedControlPool } from "../src/lib/perfect_prototype_support_matched_control_pool.mjs"
import { buildPerfectPrototypeSupportCounterfactualOutrankingFeatures } from "../src/lib/perfect_prototype_support_counterfactual_outranking_features.mjs"
import { calibratePerfectPrototypeSupportTop1QueryRanker } from "../src/lib/perfect_prototype_support_top1_query_calibrate.mjs"
import { buildPerfectPrototypeSupportTop1QueryUnsat } from "../src/lib/perfect_prototype_support_top1_query_unsat.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_low_gap_top_support_top1_query.mjs \\
    --train-input=<daily_pack.jsonl> \\
    --oos-input=<daily_pack.jsonl> \\
    --support-cases-file=<support_cases.json> \\
    --out-dir=<dir> \\
    [--family-id=low_gap_top_continuation] \\
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
    familyId: "low_gap_top_continuation",
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
  writeJson(path.join(outDir, "no_support_top1_query_summary.json"), value)

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  await fs.mkdir(args.outDir, { recursive: true })
  let trainRows = await loadJsonl(args.trainInput)
  let oosRows = await loadJsonl(args.oosInput)
  const supportCases = await loadSupportCases(args.supportCasesFile)

  let family = buildPerfectPrototypeLowGapTopPrototypeCohort({
    familyId: args.familyId,
    trainRows,
    oosRows,
    supportCases,
  })
  trainRows = null
  oosRows = null
  await writeJson(path.join(args.outDir, "prototype_cohort_summary.json"), family.summary)

  family = buildPerfectPrototypeSupportContrastiveBridgeFamily({
    cohort: family,
    minBridgePositiveDates: args.minTrainDates,
    minBridgePositiveMonths: args.minTrainMonths,
    minBridgePositiveFolds: args.minTrainFolds,
    excludeSupportCaseFromFit: true,
  })
  await writeJson(path.join(args.outDir, "support_bridge_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, reason: family.reason ?? "unsat_support_leave_one_out_fit", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportBoundaryResidualFamily({ cohort: family })
  await writeJson(path.join(args.outDir, "support_boundary_residual_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, reason: family.reason ?? "unsat_boundary_residual_not_separable", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportRecurrencePurityFamily({ cohort: family })
  await writeJson(path.join(args.outDir, "support_recurrence_purity_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, reason: family.reason ?? "unsat_boundary_residual_not_separable", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportOrdinalMotifFeatures({ cohort: family })
  await writeJson(path.join(args.outDir, "support_ordinal_motif_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, reason: family.reason ?? "unsat_no_ordinal_motif_groups", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportTemporalEpisodeDataset({
    family,
    lookbackTradingDays: args.lookbackTradingDays,
  })
  await writeJson(path.join(args.outDir, "support_temporal_episode_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, reason: family.reason ?? "unsat_no_episode_windows", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportBagRoleTopologyFeatures({ family })
  await writeJson(path.join(args.outDir, "support_role_topology_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, reason: family.reason ?? "unsat_no_role_topology_features", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportDateQueryDataset({ family })
  await writeJson(path.join(args.outDir, "support_date_query_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, reason: family.reason ?? "unsat_no_date_queries", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportMatchedControlPool({
    family,
    controlPoolSize: args.controlPoolSize,
  })
  await writeJson(path.join(args.outDir, "support_matched_control_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, reason: family.reason ?? "unsat_no_matched_control_queries", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportCounterfactualOutrankingFeatures({ family })
  await writeJson(path.join(args.outDir, "support_counterfactual_outranking_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, reason: family.reason ?? "unsat_no_counterfactual_outranking_features", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  const ranker = calibratePerfectPrototypeSupportTop1QueryRanker({
    family,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    minCrossfitPositiveWindows: args.minCrossfitPositiveWindows,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
    minOosMatchCount: args.minOosMatchCount,
  })
  await writeJson(path.join(args.outDir, "support_top1_query_ranker_summary.json"), ranker)
  if (!ranker.ok) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportTop1QueryUnsat(ranker),
    })
    return
  }

  await writeJson(path.join(args.outDir, "support_top1_query_artifact.json"), ranker.artifact)
  await writeJson(path.join(args.outDir, "support_top1_query_train_summary.json"), ranker.trainSummary)
  await writeJson(path.join(args.outDir, "support_top1_query_oos_summary.json"), ranker.oosSummary)
  await writeJson(path.join(args.outDir, "support_top1_query_solution_summary.json"), {
    ok: true,
    supportFitExcluded: ranker.supportFitExcluded === true,
    supportLeaveOneOutRecovered: ranker.supportLeaveOneOutRecovered === true,
    queryFeatureCount: family.summary?.queryFeatureCount ?? 0,
    residualFeatureCount: family.summary?.residualFeatureCount ?? 0,
    counterfactualOutrankingFeatureCount: family.summary?.counterfactualOutrankingFeatureCount ?? 0,
    selectedFeaturePoolCount: ranker.selectedFeaturePoolCount ?? 0,
    candidateCount: ranker.candidateCount ?? 0,
    qualifiedCandidateCount: ranker.qualifiedCandidateCount ?? 0,
    supportMatched: ranker.supportMatched ?? [],
    trainSummary: ranker.trainSummary,
    oosSummary: ranker.oosSummary,
    artifactHashBeforeAcceptance: ranker.artifactHashBeforeAcceptance ?? null,
    artifactHashAfterAcceptance: ranker.artifactHashAfterAcceptance ?? null,
    artifactPath: path.join(args.outDir, "support_top1_query_artifact.json"),
  })
}

await main()
