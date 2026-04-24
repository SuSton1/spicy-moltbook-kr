#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { buildPerfectPrototypeLowGapTopPrototypeCohort } from "../src/lib/perfect_prototype_low_gap_top_prototype_cohort.mjs"
import { buildPerfectPrototypeSupportContrastiveBridgeFamily } from "../src/lib/perfect_prototype_support_bridge_family.mjs"
import { liftPerfectPrototypeSupportBridgeRecurrence } from "../src/lib/perfect_prototype_support_bridge_recurrence_lift.mjs"
import { buildPerfectPrototypeSupportAtlasDataset } from "../src/lib/perfect_prototype_support_atlas_dataset.mjs"
import { buildPerfectPrototypeSupportAtlasCandidateSpace } from "../src/lib/perfect_prototype_support_atlas_builder.mjs"
import { calibratePerfectPrototypeSupportAtlas } from "../src/lib/perfect_prototype_support_atlas_calibrate.mjs"
import {
  applyPerfectPrototypeSupportAtlas,
  summarizePerfectPrototypeSupportAtlasSelections,
} from "../src/lib/perfect_prototype_support_atlas_apply.mjs"
import { buildPerfectPrototypeSupportAtlasUnsat } from "../src/lib/perfect_prototype_support_atlas_unsat.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_low_gap_top_support_atlas.mjs \\
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
    [--max-active-cells=3] \\
    [--exclude-support-case-from-fit=true]`)
}

const parseArgs = (argv) => {
  const args = {
    familyId: "low_gap_top_continuation",
    minTrainDates: 10,
    minTrainMonths: 6,
    minTrainFolds: 4,
    minCrossfitPositiveWindows: 2,
    maxCrossfitNegativeWindows: 0,
    maxActiveCells: 3,
    excludeSupportCaseFromFit: false,
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
      case "max-active-cells":
        args.maxActiveCells = Number(value)
        break
      case "exclude-support-case-from-fit":
        args.excludeSupportCaseFromFit = value === "true"
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

const buildCellPreview = (cell) => ({
  cellId: cell?.cellId ?? null,
  seedRowKey: cell?.seedRowKey ?? null,
  seedSymbol: cell?.seedSymbol ?? null,
  seedDateKey: cell?.seedDateKey ?? null,
  positiveSummary: cell?.positiveSummary ?? {},
  negativeSummary: cell?.negativeSummary ?? {},
  cellScore: Number(cell?.cellScore ?? 0),
  supportCaseMarginMean:
    Array.isArray(cell?.supportCaseEvaluations) && cell.supportCaseEvaluations.length > 0
      ? cell.supportCaseEvaluations.reduce((sum, entry) => sum + Number(entry?.margin ?? 0), 0) /
        cell.supportCaseEvaluations.length
      : null,
  positiveAnchorCount: Array.isArray(cell?.positiveAnchors) ? cell.positiveAnchors.length : 0,
  negativeBorderAnchorCount: Array.isArray(cell?.negativeBorderAnchors)
    ? cell.negativeBorderAnchors.length
    : 0,
  anchorCoverageSummary: cell?.anchorCoverageSummary ?? {},
})

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
  const bridgeCohort = buildPerfectPrototypeSupportContrastiveBridgeFamily({
    cohort,
    minBridgePositiveDates: args.minTrainDates,
    minBridgePositiveMonths: args.minTrainMonths,
    minBridgePositiveFolds: args.minTrainFolds,
    excludeSupportCaseFromFit: args.excludeSupportCaseFromFit,
  })
  await writeJson(path.join(args.outDir, "support_bridge_summary.json"), bridgeCohort.summary)
  if (bridgeCohort.ok !== true) {
    await writeJson(
      path.join(args.outDir, "no_support_atlas_summary.json"),
      buildPerfectPrototypeSupportAtlasUnsat({
        reason: bridgeCohort.reason ?? "unsat_no_bridge_positive_cohort",
        reasonCounts: { [bridgeCohort.reason ?? "unsat_no_bridge_positive_cohort"]: 1 },
        candidateSummary: {},
      }),
    )
    return
  }

  const liftedBridgeCohort = liftPerfectPrototypeSupportBridgeRecurrence({
    cohort: bridgeCohort,
    minTrainDates: args.minTrainDates,
    minTrainMonths: args.minTrainMonths,
    minTrainFolds: args.minTrainFolds,
  })
  await writeJson(path.join(args.outDir, "support_bridge_lift_summary.json"), liftedBridgeCohort.summary)
  if (liftedBridgeCohort.ok !== true) {
    await writeJson(
      path.join(args.outDir, "no_support_atlas_summary.json"),
      buildPerfectPrototypeSupportAtlasUnsat({
        reason: liftedBridgeCohort.reason ?? "unsat_no_recurrence_companion_candidates",
        reasonCounts: { [liftedBridgeCohort.reason ?? "unsat_no_recurrence_companion_candidates"]: 1 },
        candidateSummary: liftedBridgeCohort.summary ?? {},
      }),
    )
    return
  }

  const dataset = buildPerfectPrototypeSupportAtlasDataset({ cohort: liftedBridgeCohort })
  await writeJson(path.join(args.outDir, "support_atlas_dataset_summary.json"), dataset.summary)
  const candidateSpace = buildPerfectPrototypeSupportAtlasCandidateSpace({ dataset })
  await writeJson(path.join(args.outDir, "support_atlas_candidate_space.json"), {
    summary: candidateSpace.summary,
    cellCandidates: candidateSpace.cellCandidates.map(buildCellPreview),
  })
  const solution = calibratePerfectPrototypeSupportAtlas({
    dataset,
    candidateSpace,
    maxActiveCells: args.maxActiveCells,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    minCrossfitPositiveWindows: args.minCrossfitPositiveWindows,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
  })
  if (!solution.ok) {
    await writeJson(path.join(args.outDir, "no_support_atlas_summary.json"), solution)
    if (Array.isArray(solution?.preThresholdFrontier) && solution.preThresholdFrontier.length > 0) {
      await writeJson(path.join(args.outDir, "support_atlas_frontier.json"), solution.preThresholdFrontier)
    }
    return
  }
  if (Array.isArray(solution?.preThresholdFrontier) && solution.preThresholdFrontier.length > 0) {
    await writeJson(path.join(args.outDir, "support_atlas_frontier.json"), solution.preThresholdFrontier)
  }
  await writeJson(path.join(args.outDir, "support_atlas_artifact.json"), solution.artifact)
  const trainSummary = summarizePerfectPrototypeSupportAtlasSelections({
    evaluations: applyPerfectPrototypeSupportAtlas({
      artifact: solution.artifact,
      rows: cohort.trainRows,
    }),
    supportCaseIds: solution.artifact.supportCaseIds ?? [],
  })
  const oosSummary = summarizePerfectPrototypeSupportAtlasSelections({
    evaluations: applyPerfectPrototypeSupportAtlas({
      artifact: solution.artifact,
      rows: cohort.oosRows,
    }),
    supportCaseIds: solution.artifact.supportCaseIds ?? [],
  })
  await writeJson(path.join(args.outDir, "support_atlas_train_summary.json"), trainSummary)
  await writeJson(path.join(args.outDir, "support_atlas_oos_summary.json"), oosSummary)
  await writeJson(path.join(args.outDir, "support_atlas_solution_summary.json"), {
    ok: true,
    atlasSolvedCount: solution.atlasSolvedCount,
    atlasHistoricalSupportMatchedCount: solution.atlasHistoricalSupportMatchedCount,
    trainSummary,
    oosSummary,
    artifactPath: path.join(args.outDir, "support_atlas_artifact.json"),
  })
}

await main()
