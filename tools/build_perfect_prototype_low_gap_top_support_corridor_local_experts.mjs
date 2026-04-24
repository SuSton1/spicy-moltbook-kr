#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { buildPerfectPrototypeLowGapTopPrototypeCohort } from "../src/lib/perfect_prototype_low_gap_top_prototype_cohort.mjs"
import { buildPerfectPrototypeSupportContrastiveBridgeFamily } from "../src/lib/perfect_prototype_support_bridge_family.mjs"
import { buildPerfectPrototypeSupportBoundaryResidualFamily } from "../src/lib/perfect_prototype_support_boundary_residual_features.mjs"
import { buildPerfectPrototypeSupportRecurrencePurityFamily } from "../src/lib/perfect_prototype_support_recurrence_purity_features.mjs"
import { buildPerfectPrototypeSupportOrdinalMotifFeatures } from "../src/lib/perfect_prototype_support_ordinal_motif_features.mjs"
import { buildPerfectPrototypeSupportCorridorPositiveBasins } from "../src/lib/perfect_prototype_support_corridor_positive_basins.mjs"
import { buildPerfectPrototypeSupportCorridorSeedCover } from "../src/lib/perfect_prototype_support_corridor_seed_cover.mjs"
import { buildPerfectPrototypeSupportCorridorGraphDataset } from "../src/lib/perfect_prototype_support_corridor_graph_dataset.mjs"
import { buildPerfectPrototypeSupportCorridorMetricLearning } from "../src/lib/perfect_prototype_support_corridor_metric_learning.mjs"
import { buildPerfectPrototypeSupportCorridorGraphBuilder } from "../src/lib/perfect_prototype_support_corridor_graph_builder.mjs"
import { propagatePerfectPrototypeSupportCorridorGraph } from "../src/lib/perfect_prototype_support_graph_propagation.mjs"
import { buildPerfectPrototypeSupportCorridorBasinProjection } from "../src/lib/perfect_prototype_support_corridor_basin_projection.mjs"
import { buildPerfectPrototypeSupportMultibasinSimplexFeatures } from "../src/lib/perfect_prototype_support_multibasin_simplex_features.mjs"
import { buildPerfectPrototypeSupportBoundaryGroupDataset } from "../src/lib/perfect_prototype_support_boundary_group_dataset.mjs"
import { calibratePerfectPrototypeSupportBoundaryLocalExperts } from "../src/lib/perfect_prototype_support_boundary_local_expert_calibrate.mjs"
import { solvePerfectPrototypeSupportBoundaryExpertUnion } from "../src/lib/perfect_prototype_support_boundary_expert_union.mjs"
import { buildPerfectPrototypeSupportBoundaryExpertUnsat } from "../src/lib/perfect_prototype_support_boundary_expert_unsat.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_low_gap_top_support_corridor_local_experts.mjs \\
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
    [--min-oos-match-count=3]`)
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
  writeJson(path.join(outDir, "no_support_corridor_local_experts_summary.json"), value)

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
      value: buildPerfectPrototypeSupportBoundaryExpertUnsat({
        reason: family.reason ?? "unsat_support_leave_one_out_fit",
        reasonCounts: { [family.reason ?? "unsat_support_leave_one_out_fit"]: 1 },
        familySummary: family.summary,
        supportFitExcluded: family.supportFitExcluded === true,
      }),
    })
    return
  }

  family = buildPerfectPrototypeSupportBoundaryResidualFamily({
    cohort: family,
  })
  await writeJson(path.join(args.outDir, "support_boundary_residual_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportBoundaryExpertUnsat({
        reason: family.reason ?? "unsat_boundary_residual_not_separable",
        reasonCounts: { [family.reason ?? "unsat_boundary_residual_not_separable"]: 1 },
        familySummary: family.summary,
        supportFitExcluded: family.supportFitExcluded === true,
      }),
    })
    return
  }

  family = buildPerfectPrototypeSupportRecurrencePurityFamily({
    cohort: family,
  })
  await writeJson(path.join(args.outDir, "support_recurrence_purity_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportBoundaryExpertUnsat({
        reason: family.reason ?? "unsat_boundary_residual_not_separable",
        reasonCounts: { [family.reason ?? "unsat_boundary_residual_not_separable"]: 1 },
        familySummary: family.summary,
        supportFitExcluded: family.supportFitExcluded === true,
      }),
    })
    return
  }

  family = buildPerfectPrototypeSupportOrdinalMotifFeatures({
    cohort: family,
  })
  await writeJson(path.join(args.outDir, "support_ordinal_motif_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportBoundaryExpertUnsat({
        reason: family.reason ?? "unsat_no_ordinal_motif_groups",
        reasonCounts: { [family.reason ?? "unsat_no_ordinal_motif_groups"]: 1 },
        familySummary: family.summary,
        supportFitExcluded: family.supportFitExcluded === true,
      }),
    })
    return
  }

  family = buildPerfectPrototypeSupportCorridorPositiveBasins({
    family,
  })
  await writeJson(path.join(args.outDir, "support_corridor_positive_basins_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportBoundaryExpertUnsat({
        reason: family.reason ?? "unsat_no_corridor_positive_basins",
        reasonCounts: { [family.reason ?? "unsat_no_corridor_positive_basins"]: 1 },
        familySummary: family.summary,
        supportFitExcluded: family.supportFitExcluded === true,
      }),
    })
    return
  }

  family = buildPerfectPrototypeSupportCorridorSeedCover({
    family,
  })
  await writeJson(path.join(args.outDir, "support_corridor_seed_cover_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportBoundaryExpertUnsat({
        reason: family.reason ?? "unsat_no_corridor_positive_seed_cover",
        reasonCounts: { [family.reason ?? "unsat_no_corridor_positive_seed_cover"]: 1 },
        familySummary: family.summary,
        supportFitExcluded: family.supportFitExcluded === true,
      }),
    })
    return
  }

  family = buildPerfectPrototypeSupportCorridorGraphDataset({
    family,
    minPositiveSeedDates: args.minTrainDates,
    minPositiveSeedMonths: args.minTrainMonths,
    minPositiveSeedFolds: args.minTrainFolds,
  })
  await writeJson(path.join(args.outDir, "support_corridor_graph_dataset_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportBoundaryExpertUnsat({
        reason: family.reason ?? "unsat_no_positive_graph_seeds",
        reasonCounts: { [family.reason ?? "unsat_no_positive_graph_seeds"]: 1 },
        familySummary: family.summary,
        supportFitExcluded: family.supportFitExcluded === true,
      }),
    })
    return
  }

  family = buildPerfectPrototypeSupportCorridorMetricLearning({
    family,
  })
  await writeJson(path.join(args.outDir, "support_corridor_metric_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportBoundaryExpertUnsat({
        reason: family.reason ?? "unsat_no_corridor_metric_features",
        reasonCounts: { [family.reason ?? "unsat_no_corridor_metric_features"]: 1 },
        familySummary: family.summary,
        supportFitExcluded: family.supportFitExcluded === true,
      }),
    })
    return
  }

  family = buildPerfectPrototypeSupportCorridorGraphBuilder({
    family,
  })
  await writeJson(path.join(args.outDir, "support_corridor_graph_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportBoundaryExpertUnsat({
        reason: family.reason ?? "unsat_no_corridor_graph",
        reasonCounts: { [family.reason ?? "unsat_no_corridor_graph"]: 1 },
        familySummary: family.summary,
        supportFitExcluded: family.supportFitExcluded === true,
      }),
    })
    return
  }

  family = propagatePerfectPrototypeSupportCorridorGraph({
    family,
  })
  await writeJson(path.join(args.outDir, "support_corridor_graph_propagation_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportBoundaryExpertUnsat({
        reason: family.reason ?? "unsat_no_graph_nodes",
        reasonCounts: { [family.reason ?? "unsat_no_graph_nodes"]: 1 },
        familySummary: family.summary,
        supportFitExcluded: family.supportFitExcluded === true,
      }),
    })
    return
  }

  family = buildPerfectPrototypeSupportCorridorBasinProjection({
    family,
  })
  await writeJson(path.join(args.outDir, "support_corridor_basin_projection_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportBoundaryExpertUnsat({
        reason: family.reason ?? "unsat_support_case_not_basin_reachable",
        reasonCounts: { [family.reason ?? "unsat_support_case_not_basin_reachable"]: 1 },
        familySummary: family.summary,
        supportFitExcluded: family.supportFitExcluded === true,
      }),
    })
    return
  }

  family = buildPerfectPrototypeSupportMultibasinSimplexFeatures({
    family,
  })
  await writeJson(path.join(args.outDir, "support_multibasin_simplex_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportBoundaryExpertUnsat({
        reason: family.reason ?? "unsat_no_multibasin_simplex_features",
        reasonCounts: { [family.reason ?? "unsat_no_multibasin_simplex_features"]: 1 },
        familySummary: family.summary,
        supportFitExcluded: family.supportFitExcluded === true,
      }),
    })
    return
  }

  const groupDataset = buildPerfectPrototypeSupportBoundaryGroupDataset({
    family,
  })
  await writeJson(path.join(args.outDir, "support_boundary_group_dataset_summary.json"), groupDataset.summary)
  if (groupDataset.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportBoundaryExpertUnsat({
        reason: "unsat_no_local_experts",
        reasonCounts: { unsat_no_local_experts: 1 },
        familySummary: family.summary,
        groupDatasetSummary: groupDataset.summary,
        supportFitExcluded: family.supportFitExcluded === true,
      }),
    })
    return
  }

  const localExperts = calibratePerfectPrototypeSupportBoundaryLocalExperts({
    family,
    groupDataset,
    minTrainMatchedDates: 3,
    minTrainMatchedMonths: 3,
    minTrainMatchedFolds: 2,
    minCrossfitPositiveWindows: 1,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
  })
  await writeJson(path.join(args.outDir, "support_boundary_local_expert_summary.json"), localExperts)
  if (localExperts.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: localExperts })
    return
  }

  const solution = solvePerfectPrototypeSupportBoundaryExpertUnion({
    family,
    groupDataset,
    localExpertCalibration: localExperts,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    minCrossfitPositiveWindows: args.minCrossfitPositiveWindows,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
    minOosMatchCount: args.minOosMatchCount,
  })
  await writeJson(path.join(args.outDir, "support_expert_complement_frontier_summary.json"), {
    distinctMatchedDateSignatureCount: solution?.distinctMatchedDateSignatureCount ?? 0,
    distinctMatchedMonthSignatureCount: solution?.distinctMatchedMonthSignatureCount ?? 0,
    distinctMatchedFoldSignatureCount: solution?.distinctMatchedFoldSignatureCount ?? 0,
    coverageFrontierCandidateCount: solution?.coverageFrontierCandidateCount ?? 0,
    coverageFrontierQualifiedCount: solution?.coverageFrontierQualifiedCount ?? 0,
    bestSingleExpertTrainMatchedDateCount: solution?.bestSingleExpertTrainMatchedDateCount ?? 0,
    bestSingleExpertTrainMatchedMonthCount: solution?.bestSingleExpertTrainMatchedMonthCount ?? 0,
    bestSingleExpertTrainMatchedFoldCount: solution?.bestSingleExpertTrainMatchedFoldCount ?? 0,
    expertUnionDateGainOverBestSingleExpert: solution?.expertUnionDateGainOverBestSingleExpert ?? 0,
    expertUnionMonthGainOverBestSingleExpert: solution?.expertUnionMonthGainOverBestSingleExpert ?? 0,
    expertUnionFoldGainOverBestSingleExpert: solution?.expertUnionFoldGainOverBestSingleExpert ?? 0,
    coverageFrontierRejectReasonCounts: solution?.coverageFrontier?.coverageFrontierRejectReasonCounts ?? {},
  })
  if (!solution.ok) {
    await writeUnsat({ outDir: args.outDir, value: solution })
    return
  }

  await writeJson(path.join(args.outDir, "support_corridor_local_experts_artifact.json"), solution.artifact)
  await writeJson(path.join(args.outDir, "support_corridor_local_experts_train_summary.json"), solution.trainSummary)
  await writeJson(path.join(args.outDir, "support_corridor_local_experts_oos_summary.json"), solution.oosSummary)
  await writeJson(path.join(args.outDir, "support_corridor_local_experts_solution_summary.json"), {
    ok: true,
    supportFitExcluded: solution.supportFitExcluded === true,
    supportLeaveOneOutRecovered: solution.supportLeaveOneOutRecovered === true,
    corridorPositiveBasinCount: family.summary?.corridorPositiveBasinCount ?? 0,
    corridorPositiveSeedCount: family.summary?.corridorPositiveSeedCount ?? 0,
    supportCaseReachableBasinCount: family.summary?.supportCaseReachableBasinCount ?? 0,
    simplexFeatureCount: family.summary?.simplexFeatureCount ?? 0,
    localExpertCandidateCount: solution.localExpertCandidateCount ?? 0,
    localExpertQualifiedCount: solution.localExpertQualifiedCount ?? 0,
    distinctMatchedDateSignatureCount: solution.distinctMatchedDateSignatureCount ?? 0,
    distinctMatchedMonthSignatureCount: solution.distinctMatchedMonthSignatureCount ?? 0,
    distinctMatchedFoldSignatureCount: solution.distinctMatchedFoldSignatureCount ?? 0,
    expertUnionCandidateCount: solution.expertUnionCandidateCount ?? 0,
    expertUnionQualifiedCount: solution.expertUnionQualifiedCount ?? 0,
    coverageFrontierCandidateCount: solution.coverageFrontierCandidateCount ?? 0,
    coverageFrontierQualifiedCount: solution.coverageFrontierQualifiedCount ?? 0,
    bestSingleExpertTrainMatchedDateCount: solution.bestSingleExpertTrainMatchedDateCount ?? 0,
    bestSingleExpertTrainMatchedMonthCount: solution.bestSingleExpertTrainMatchedMonthCount ?? 0,
    bestSingleExpertTrainMatchedFoldCount: solution.bestSingleExpertTrainMatchedFoldCount ?? 0,
    expertUnionDateGainOverBestSingleExpert: solution.expertUnionDateGainOverBestSingleExpert ?? 0,
    expertUnionMonthGainOverBestSingleExpert: solution.expertUnionMonthGainOverBestSingleExpert ?? 0,
    expertUnionFoldGainOverBestSingleExpert: solution.expertUnionFoldGainOverBestSingleExpert ?? 0,
    trainSummary: solution.trainSummary,
    oosSummary: solution.oosSummary,
    artifactPath: path.join(args.outDir, "support_corridor_local_experts_artifact.json"),
  })
}

await main()
