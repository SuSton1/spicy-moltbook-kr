#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { buildPerfectPrototypeLowGapTopPrototypeCohort } from "../src/lib/perfect_prototype_low_gap_top_prototype_cohort.mjs"
import { buildPerfectPrototypeSupportScorecardTermBank } from "../src/lib/perfect_prototype_support_scorecard_term_bank.mjs"
import { solvePerfectPrototypeSupportScorecard } from "../src/lib/perfect_prototype_support_scorecard_solver.mjs"
import { buildPerfectPrototypeSupportScorecardArtifact } from "../src/lib/perfect_prototype_support_scorecard_artifact.mjs"
import {
  applyPerfectPrototypeSupportScorecard,
  summarizePerfectPrototypeSupportScorecardSelections,
} from "../src/lib/perfect_prototype_support_scorecard_apply.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_low_gap_top_support_scorecard.mjs \
    --train-input=<daily_pack.jsonl> \
    --oos-input=<daily_pack.jsonl> \
    --support-cases-file=<support_cases.json> \
    --out-dir=<dir> \
    [--family-id=low_gap_top_continuation] \
    [--min-train-dates=10] \
    [--min-train-months=6] \
    [--min-train-folds=4] \
    [--min-crossfit-positive-windows=2] \
    [--max-crossfit-negative-windows=0]`)
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const parseArgs = (argv) => {
  const args = {
    familyId: "low_gap_top_continuation",
    minTrainDates: 10,
    minTrainMonths: 6,
    minTrainFolds: 4,
    minCrossfitPositiveWindows: 2,
    maxCrossfitNegativeWindows: 0,
    maxTerms: 5,
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
      case "max-terms":
        args.maxTerms = Number(value)
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

const serializeTerm = (term) => ({
  termId: term?.termId ?? null,
  role: term?.role ?? null,
  kind: term?.kind ?? null,
  token: term?.token ?? null,
  featureKey: term?.featureKey ?? null,
  operator: term?.operator ?? null,
  threshold: term?.threshold ?? null,
  sign: term?.sign ?? null,
  weight: term?.weight ?? null,
  positiveCount: Number(term?.positiveCount ?? 0),
  negativeCount: Number(term?.negativeCount ?? 0),
  positiveDateCount: Number(term?.positiveDateCount ?? 0),
  positiveMonthCount: Number(term?.positiveMonthCount ?? 0),
  positiveFoldCount: Number(term?.positiveFoldCount ?? 0),
  supportPositiveCount: Number(term?.supportPositiveCount ?? 0),
  hardNegativeCount: Number(term?.hardNegativeCount ?? 0),
  supportCaseIds: Array.isArray(term?.supportCaseIds) ? term.supportCaseIds : [],
  crossfitPositiveWindowCount: Number(term?.crossfitPositiveWindowCount ?? 0),
  crossfitNegativeWindowCount: Number(term?.crossfitNegativeWindowCount ?? 0),
  termScore: Number(term?.termScore ?? 0),
  qualified: term?.qualified === true,
})

const serializeTermBank = (termBank) => ({
  summary: termBank?.summary ?? {},
  roleTerms: {
    support_anchor: (termBank?.roleTerms?.support_anchor ?? []).map(serializeTerm),
    breadth_extender: (termBank?.roleTerms?.breadth_extender ?? []).map(serializeTerm),
    risk_killer: (termBank?.roleTerms?.risk_killer ?? []).map(serializeTerm),
  },
  topQualifiedTerms: (Array.isArray(termBank?.candidateTerms) ? termBank.candidateTerms : [])
    .slice(0, 128)
    .map(serializeTerm),
})

const serializeCandidate = (candidate) => ({
  termCount: Number(candidate?.termCount ?? 0),
  threshold: Number(candidate?.threshold ?? 0),
  selectedTermIds: (candidate?.selectedTerms ?? []).map((term) => term?.termId).filter(Boolean),
  supportMatched: Array.isArray(candidate?.supportMatched) ? candidate.supportMatched : [],
  failureReason: candidate?.failureReason ?? null,
  trainSummary: candidate?.trainSummary ?? {},
})

const serializeSolution = (solution) => ({
  ok: solution?.ok === true,
  reason: solution?.reason ?? null,
  scorecardSolvedCount: Number(solution?.scorecardSolvedCount ?? 0),
  scorecardHistoricalSupportMatchedCount: Number(
    solution?.scorecardHistoricalSupportMatchedCount ?? 0,
  ),
  scorecardTermCandidateCount: Number(solution?.scorecardTermCandidateCount ?? 0),
  scorecardTermQualifiedCount: Number(solution?.scorecardTermQualifiedCount ?? 0),
  triedCandidateCount: Number(solution?.triedCandidateCount ?? 0),
  scorecardUnsatReasonCounts: solution?.scorecardUnsatReasonCounts ?? {},
  topCandidates: (Array.isArray(solution?.candidatesEvaluated) ? solution.candidatesEvaluated : [])
    .slice(0, 64)
    .map(serializeCandidate),
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
  const termBank = buildPerfectPrototypeSupportScorecardTermBank({
    cohort,
  })
  await writeJson(
    path.join(args.outDir, "scorecard_term_bank.json"),
    serializeTermBank(termBank),
  )
  const solution = solvePerfectPrototypeSupportScorecard({
    cohort,
    termBank,
    maxTerms: args.maxTerms,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    minCrossfitPositiveWindows: args.minCrossfitPositiveWindows,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
  })
  if (!solution.ok) {
    await writeJson(
      path.join(args.outDir, "no_support_scorecard_summary.json"),
      serializeSolution(solution),
    )
    return
  }
  const artifact = buildPerfectPrototypeSupportScorecardArtifact({
    solution,
    cohortSummary: cohort.summary,
    termBankSummary: termBank.summary,
  })
  await writeJson(path.join(args.outDir, "support_scorecard_artifact.json"), artifact)
  const trainSummary = summarizePerfectPrototypeSupportScorecardSelections({
    evaluations: applyPerfectPrototypeSupportScorecard({
      artifact,
      rows: cohort.trainRows,
    }),
    supportCaseIds: artifact.supportCaseIds,
  })
  const oosSummary = summarizePerfectPrototypeSupportScorecardSelections({
    evaluations: applyPerfectPrototypeSupportScorecard({
      artifact,
      rows: cohort.oosRows,
    }),
    supportCaseIds: artifact.supportCaseIds,
  })
  await writeJson(path.join(args.outDir, "support_scorecard_train_summary.json"), trainSummary)
  await writeJson(path.join(args.outDir, "support_scorecard_oos_summary.json"), oosSummary)
  await writeJson(path.join(args.outDir, "support_scorecard_solution_summary.json"), {
    ok: true,
    scorecardSolvedCount: solution.scorecardSolvedCount,
    scorecardHistoricalSupportMatchedCount: solution.scorecardHistoricalSupportMatchedCount,
    trainSummary,
    oosSummary,
    artifactPath: path.join(args.outDir, "support_scorecard_artifact.json"),
  })
}

await main()
