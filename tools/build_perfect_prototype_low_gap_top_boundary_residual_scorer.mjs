#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { buildPerfectPrototypeLowGapTopPrototypeCohort } from "../src/lib/perfect_prototype_low_gap_top_prototype_cohort.mjs"
import { buildPerfectPrototypeSupportContrastiveBridgeFamily } from "../src/lib/perfect_prototype_support_bridge_family.mjs"
import { buildPerfectPrototypeSupportBoundaryResidualFamily } from "../src/lib/perfect_prototype_support_boundary_residual_features.mjs"
import { calibratePerfectPrototypeSupportBoundaryResidualScorer } from "../src/lib/perfect_prototype_support_boundary_residual_calibrate.mjs"
import { buildPerfectPrototypeSupportBoundaryResidualUnsat } from "../src/lib/perfect_prototype_support_boundary_residual_unsat.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_low_gap_top_boundary_residual_scorer.mjs \\
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

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const trainRows = await loadJsonl(args.trainInput)
  const oosRows = await loadJsonl(args.oosInput)
  const supportCases = await loadSupportCases(args.supportCasesFile)

  const cohort = buildPerfectPrototypeLowGapTopPrototypeCohort({
    familyId: args.familyId,
    trainRows,
    oosRows,
    supportCases,
  })
  await writeJson(path.join(args.outDir, "prototype_cohort_summary.json"), cohort.summary)

  const bridgeFamily = buildPerfectPrototypeSupportContrastiveBridgeFamily({
    cohort,
    minBridgePositiveDates: args.minTrainDates,
    minBridgePositiveMonths: args.minTrainMonths,
    minBridgePositiveFolds: args.minTrainFolds,
    excludeSupportCaseFromFit: true,
  })
  await writeJson(path.join(args.outDir, "support_bridge_summary.json"), bridgeFamily.summary)
  if (bridgeFamily.ok !== true) {
    await writeJson(
      path.join(args.outDir, "no_support_boundary_residual_scorer_summary.json"),
      buildPerfectPrototypeSupportBoundaryResidualUnsat({
        reason: bridgeFamily.reason ?? "unsat_support_leave_one_out_fit",
        reasonCounts: { [bridgeFamily.reason ?? "unsat_support_leave_one_out_fit"]: 1 },
        familySummary: bridgeFamily.summary,
        supportFitExcluded: bridgeFamily.supportFitExcluded === true,
      }),
    )
    return
  }

  const boundaryFamily = buildPerfectPrototypeSupportBoundaryResidualFamily({
    cohort: bridgeFamily,
  })
  await writeJson(path.join(args.outDir, "support_boundary_residual_summary.json"), boundaryFamily.summary)
  if (boundaryFamily.ok !== true) {
    await writeJson(
      path.join(args.outDir, "no_support_boundary_residual_scorer_summary.json"),
      buildPerfectPrototypeSupportBoundaryResidualUnsat({
        reason: boundaryFamily.reason ?? "unsat_boundary_residual_not_separable",
        reasonCounts: { [boundaryFamily.reason ?? "unsat_boundary_residual_not_separable"]: 1 },
        familySummary: boundaryFamily.summary,
        supportFitExcluded: boundaryFamily.supportFitExcluded === true,
      }),
    )
    return
  }

  const solution = calibratePerfectPrototypeSupportBoundaryResidualScorer({
    family: boundaryFamily,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    minCrossfitPositiveWindows: args.minCrossfitPositiveWindows,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
    minOosMatchCount: args.minOosMatchCount,
  })
  if (!solution.ok) {
    await writeJson(path.join(args.outDir, "no_support_boundary_residual_scorer_summary.json"), solution)
    return
  }

  await writeJson(path.join(args.outDir, "support_boundary_residual_scorer_artifact.json"), solution.artifact)
  await writeJson(path.join(args.outDir, "support_boundary_residual_train_summary.json"), solution.trainSummary)
  await writeJson(path.join(args.outDir, "support_boundary_residual_oos_summary.json"), solution.oosSummary)
  await writeJson(path.join(args.outDir, "support_boundary_residual_solution_summary.json"), {
    ok: true,
    supportFitExcluded: solution.supportFitExcluded === true,
    supportLeaveOneOutRecovered: solution.supportLeaveOneOutRecovered === true,
    scorerCandidateCount: solution.scorerCandidateCount ?? 0,
    scorerQualifiedCount: solution.scorerQualifiedCount ?? 0,
    scorerHistoricalSupportMatchedCount: solution.scorerHistoricalSupportMatchedCount ?? 0,
    trainSummary: solution.trainSummary,
    oosSummary: solution.oosSummary,
    artifactPath: path.join(args.outDir, "support_boundary_residual_scorer_artifact.json"),
  })
}

await main()
