#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { buildPerfectPrototypeLowGapTopPrototypeCohort } from "../src/lib/perfect_prototype_low_gap_top_prototype_cohort.mjs"
import { buildPerfectPrototypeSupportContrastiveBridgeFamily } from "../src/lib/perfect_prototype_support_bridge_family.mjs"
import { buildPerfectPrototypeSupportBoundaryResidualFamily } from "../src/lib/perfect_prototype_support_boundary_residual_features.mjs"
import { buildPerfectPrototypeSupportRecurrencePurityFamily } from "../src/lib/perfect_prototype_support_recurrence_purity_features.mjs"
import { buildPerfectPrototypeSupportOrdinalMotifFeatures } from "../src/lib/perfect_prototype_support_ordinal_motif_features.mjs"
import { buildPerfectPrototypeSupportDateBagDataset } from "../src/lib/perfect_prototype_support_date_bag_dataset.mjs"
import { buildPerfectPrototypeSupportContrastiveMotifLatticeFeatures } from "../src/lib/perfect_prototype_support_contrastive_motif_lattice_features.mjs"
import { buildPerfectPrototypeSupportBagWitnessSelector } from "../src/lib/perfect_prototype_support_bag_witness_selector.mjs"
import { buildPerfectPrototypeSupportMilMotifPrototypes } from "../src/lib/perfect_prototype_support_mil_motif_prototypes.mjs"
import { calibratePerfectPrototypeSupportBagLocalDetectors } from "../src/lib/perfect_prototype_support_bag_local_detector.mjs"
import { solvePerfectPrototypeSupportBagCover } from "../src/lib/perfect_prototype_support_bag_cover_solver.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_low_gap_top_support_bag_cover.mjs \\
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
  writeJson(path.join(outDir, "no_support_bag_cover_summary.json"), value)

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
      value: {
        ok: false,
        reason: family.reason ?? "unsat_support_leave_one_out_fit",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportBoundaryResidualFamily({ cohort: family })
  await writeJson(path.join(args.outDir, "support_boundary_residual_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_boundary_residual_not_separable",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportRecurrencePurityFamily({ cohort: family })
  await writeJson(path.join(args.outDir, "support_recurrence_purity_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_boundary_residual_not_separable",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportOrdinalMotifFeatures({ cohort: family })
  await writeJson(path.join(args.outDir, "support_ordinal_motif_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_ordinal_motif_groups",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportDateBagDataset({ family })
  await writeJson(path.join(args.outDir, "support_date_bag_dataset_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_positive_date_bags",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportContrastiveMotifLatticeFeatures({ family })
  await writeJson(path.join(args.outDir, "support_motif_lattice_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_motif_lattice_bundles",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportBagWitnessSelector({ family })
  await writeJson(path.join(args.outDir, "support_bag_witness_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_bag_witness_rows",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportMilMotifPrototypes({ family })
  await writeJson(path.join(args.outDir, "support_mil_motif_prototypes_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_motif_prototypes",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  const localDetectors = calibratePerfectPrototypeSupportBagLocalDetectors({
    family,
    minTrainMatchedDates: 3,
    minTrainMatchedMonths: 3,
    minTrainMatchedFolds: 2,
    minCrossfitPositiveWindows: 1,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
  })
  await writeJson(path.join(args.outDir, "support_bag_local_detector_summary.json"), localDetectors)
  if (localDetectors.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: localDetectors })
    return
  }

  const solution = solvePerfectPrototypeSupportBagCover({
    family,
    bagLocalDetectorCalibration: localDetectors,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    minCrossfitPositiveWindows: args.minCrossfitPositiveWindows,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
    minOosMatchCount: args.minOosMatchCount,
  })
  await writeJson(path.join(args.outDir, "support_bag_cover_union_summary.json"), {
    distinctBagCoverSignatureCount: solution?.distinctBagCoverSignatureCount ?? 0,
    bagLocalDetectorQualifiedCount: solution?.bagLocalDetectorQualifiedCount ?? 0,
    bestSingleDetectorTrainMatchedDateCount: solution?.bestSingleDetectorTrainMatchedDateCount ?? 0,
    bestSingleDetectorTrainMatchedMonthCount: solution?.bestSingleDetectorTrainMatchedMonthCount ?? 0,
    bestSingleDetectorTrainMatchedFoldCount: solution?.bestSingleDetectorTrainMatchedFoldCount ?? 0,
    bagCoverUnionDateGainOverBestSingleDetector: solution?.bagCoverUnionDateGainOverBestSingleDetector ?? 0,
    bagCoverUnionMonthGainOverBestSingleDetector: solution?.bagCoverUnionMonthGainOverBestSingleDetector ?? 0,
    bagCoverUnionFoldGainOverBestSingleDetector: solution?.bagCoverUnionFoldGainOverBestSingleDetector ?? 0,
    unsatReasonCounts: solution?.unsatReasonCounts ?? {},
  })
  if (!solution.ok) {
    await writeUnsat({ outDir: args.outDir, value: solution })
    return
  }

  await writeJson(path.join(args.outDir, "support_bag_cover_artifact.json"), solution.artifact)
  await writeJson(path.join(args.outDir, "support_bag_cover_train_summary.json"), solution.trainSummary)
  await writeJson(path.join(args.outDir, "support_bag_cover_oos_summary.json"), solution.oosSummary)
  await writeJson(path.join(args.outDir, "support_bag_cover_solution_summary.json"), {
    ok: true,
    supportFitExcluded: solution.supportFitExcluded === true,
    supportLeaveOneOutRecovered: solution.supportLeaveOneOutRecovered === true,
    motifLatticeFeatureCount: family.summary?.motifLatticeFeatureCount ?? 0,
    motifPrototypeCount: family.summary?.motifPrototypeCount ?? 0,
    distinctBagCoverSignatureCount: solution.distinctBagCoverSignatureCount ?? 0,
    bagLocalDetectorCandidateCount: solution.bagLocalDetectorCandidateCount ?? 0,
    bagLocalDetectorQualifiedCount: solution.bagLocalDetectorQualifiedCount ?? 0,
    bagCoverUnionCandidateCount: solution.bagCoverUnionCandidateCount ?? 0,
    bagCoverUnionQualifiedCount: solution.bagCoverUnionQualifiedCount ?? 0,
    bestSingleDetectorTrainMatchedDateCount: solution.bestSingleDetectorTrainMatchedDateCount ?? 0,
    bestSingleDetectorTrainMatchedMonthCount: solution.bestSingleDetectorTrainMatchedMonthCount ?? 0,
    bestSingleDetectorTrainMatchedFoldCount: solution.bestSingleDetectorTrainMatchedFoldCount ?? 0,
    bagCoverUnionDateGainOverBestSingleDetector: solution.bagCoverUnionDateGainOverBestSingleDetector ?? 0,
    bagCoverUnionMonthGainOverBestSingleDetector: solution.bagCoverUnionMonthGainOverBestSingleDetector ?? 0,
    bagCoverUnionFoldGainOverBestSingleDetector: solution.bagCoverUnionFoldGainOverBestSingleDetector ?? 0,
    trainSummary: solution.trainSummary,
    oosSummary: solution.oosSummary,
    artifactPath: path.join(args.outDir, "support_bag_cover_artifact.json"),
  })
}

await main()
