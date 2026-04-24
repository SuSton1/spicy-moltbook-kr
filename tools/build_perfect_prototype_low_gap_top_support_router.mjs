#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { buildPerfectPrototypeLowGapTopPrototypeCohort } from "../src/lib/perfect_prototype_low_gap_top_prototype_cohort.mjs"
import { buildPerfectPrototypeSupportPrototypeRouterCandidateSpace } from "../src/lib/perfect_prototype_support_prototype_router_builder.mjs"
import { calibratePerfectPrototypeSupportPrototypeRouter } from "../src/lib/perfect_prototype_support_prototype_router_calibrate.mjs"
import { buildPerfectPrototypeSupportPrototypeRouterArtifact } from "../src/lib/perfect_prototype_support_prototype_router_artifact.mjs"
import {
  applyPerfectPrototypeSupportPrototypeRouter,
  summarizePerfectPrototypeSupportPrototypeRouterSelections,
} from "../src/lib/perfect_prototype_support_prototype_router_apply.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_low_gap_top_support_router.mjs \\
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
    [--max-threshold-features=4]`)
}

const parseArgs = (argv) => {
  const args = {
    familyId: "low_gap_top_continuation",
    minTrainDates: 10,
    minTrainMonths: 6,
    minTrainFolds: 4,
    minCrossfitPositiveWindows: 2,
    maxCrossfitNegativeWindows: 0,
    maxThresholdFeatures: 4,
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
      case "max-threshold-features":
        args.maxThresholdFeatures = Number(value)
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
  const candidateSpace = buildPerfectPrototypeSupportPrototypeRouterCandidateSpace({
    cohort,
  })
  await writeJson(path.join(args.outDir, "support_prototype_router_candidate_space.json"), {
    summary: candidateSpace.summary,
    featureCandidates: candidateSpace.featureCandidates,
  })
  const solution = calibratePerfectPrototypeSupportPrototypeRouter({
    cohort,
    candidateSpace,
    maxThresholdFeatures: args.maxThresholdFeatures,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    minCrossfitPositiveWindows: args.minCrossfitPositiveWindows,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
  })
  if (!solution.ok) {
    await writeJson(
      path.join(args.outDir, "no_support_prototype_router_summary.json"),
      solution,
    )
    return
  }
  const artifact = buildPerfectPrototypeSupportPrototypeRouterArtifact({
    solution,
    cohortSummary: cohort.summary,
    candidateSummary: candidateSpace.summary,
  })
  await writeJson(path.join(args.outDir, "support_prototype_router_artifact.json"), artifact)
  const trainSummary = summarizePerfectPrototypeSupportPrototypeRouterSelections({
    evaluations: applyPerfectPrototypeSupportPrototypeRouter({
      artifact,
      rows: cohort.trainRows,
    }),
    supportCaseIds: artifact.supportCaseIds,
  })
  const oosSummary = summarizePerfectPrototypeSupportPrototypeRouterSelections({
    evaluations: applyPerfectPrototypeSupportPrototypeRouter({
      artifact,
      rows: cohort.oosRows,
    }),
    supportCaseIds: artifact.supportCaseIds,
  })
  await writeJson(path.join(args.outDir, "support_prototype_router_train_summary.json"), trainSummary)
  await writeJson(path.join(args.outDir, "support_prototype_router_oos_summary.json"), oosSummary)
  await writeJson(path.join(args.outDir, "support_prototype_router_solution_summary.json"), {
    ok: true,
    routerSolvedCount: solution.routerSolvedCount,
    routerHistoricalSupportMatchedCount: solution.routerHistoricalSupportMatchedCount,
    trainSummary,
    oosSummary,
    artifactPath: path.join(args.outDir, "support_prototype_router_artifact.json"),
  })
}

await main()

