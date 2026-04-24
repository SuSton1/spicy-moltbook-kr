#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { readJsonl } from "../src/lib/io.mjs"
import { buildPerfectPrototypePrejumpEpisodeTransitionControlDataset } from "../src/lib/perfect_prototype_prejump_episode_transition_control_dataset.mjs"
import { buildPerfectPrototypePrejumpHypothesisPortfolioFeatures } from "../src/lib/perfect_prototype_prejump_hypothesis_portfolio_features.mjs"
import { auditPerfectPrototypePrejumpEpisodeTransition } from "../src/lib/perfect_prototype_prejump_episode_transition_audit.mjs"
import { calibratePerfectPrototypeSupportTop1QueryRanker } from "../src/lib/perfect_prototype_support_top1_query_calibrate.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_prejump_episode_transition_counterfactual_controls.mjs \\
    --train-input=<prejump_pack.jsonl> \\
    --oos-input=<prejump_pack.jsonl> \\
    --support-cases-file=<support_cases.json> \\
    --out-dir=<dir> \\
    [--family-id=prejump_episode_transition_counterfactual_controls]`)
}

const parseArgs = (argv) => {
  const args = {
    familyId: "prejump_episode_transition_counterfactual_controls",
    minTrainDates: 10,
    minTrainMonths: 6,
    minTrainFolds: 4,
    minCrossfitPositiveWindows: 2,
    maxCrossfitNegativeWindows: 0,
    minOosMatchCount: 3,
    crossfitWindowCount: 6,
    crossfitFoldCount: 4,
    sameDateNegativePoolSize: 2,
    matchedControlNegativePoolSize: 2,
    failureNegativePoolSize: 2,
    auditMinPairwiseWinRate: 0.95,
    auditMinSameDateBeatRate: 0.95,
    auditMinMatchedControlBeatRate: 0.9,
    auditMinFailureBeatRate: 0.9,
    auditMinFoldPairwiseWinRate: 0.9,
    auditMaxHardNegativeLeakCount: 0,
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
      case "crossfit-window-count":
        args.crossfitWindowCount = Number(value)
        break
      case "crossfit-fold-count":
        args.crossfitFoldCount = Number(value)
        break
      case "same-date-negative-pool-size":
        args.sameDateNegativePoolSize = Number(value)
        break
      case "matched-control-negative-pool-size":
        args.matchedControlNegativePoolSize = Number(value)
        break
      case "failure-negative-pool-size":
        args.failureNegativePoolSize = Number(value)
        break
      case "audit-min-pairwise-win-rate":
        args.auditMinPairwiseWinRate = Number(value)
        break
      case "audit-min-same-date-beat-rate":
        args.auditMinSameDateBeatRate = Number(value)
        break
      case "audit-min-matched-control-beat-rate":
        args.auditMinMatchedControlBeatRate = Number(value)
        break
      case "audit-min-failure-beat-rate":
        args.auditMinFailureBeatRate = Number(value)
        break
      case "audit-min-fold-pairwise-win-rate":
        args.auditMinFoldPairwiseWinRate = Number(value)
        break
      case "audit-max-hard-negative-leak-count":
        args.auditMaxHardNegativeLeakCount = Number(value)
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

const INPUT_NUMERIC_FEATURE_KEYS = [
  "seq40.mean",
  "seq40.delta",
  "seq40.last",
  "seq40.positiveShare",
  "seq40.negativeShare",
  "seq40.stdev",
  "seq150.mean",
  "seq150.delta",
  "seq150.last",
  "seq150.positiveShare",
  "seq150.negativeShare",
  "seq150.stdev",
  "feature.avgTradingValue20d",
  "global.avgTradingValue20d",
  "feature.marketCapKrw",
  "global.marketCapKrw",
]

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const toFiniteNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const compactNumericFeatureMap = (numericFeatureMap) => {
  const safeMap = numericFeatureMap && typeof numericFeatureMap === "object" ? numericFeatureMap : {}
  const out = {}
  for (const featureKey of INPUT_NUMERIC_FEATURE_KEYS) {
    const value = toFiniteNumber(safeMap?.[featureKey])
    if (value === null) continue
    out[featureKey] = value
  }
  return out
}

const compactEventOutcome = (eventOutcome) => {
  if (!eventOutcome || typeof eventOutcome !== "object") return null
  const hitTarget = typeof eventOutcome?.hitTarget === "boolean" ? eventOutcome.hitTarget : null
  const netRet = toFiniteNumber(eventOutcome?.netRet)
  if (hitTarget === null && netRet === null) return null
  return {
    ...(hitTarget === null ? {} : { hitTarget }),
    ...(netRet === null ? {} : { netRet }),
  }
}

const compactCategoricalTokens = (tokens) =>
  Array.from(
    new Set((Array.isArray(tokens) ? tokens : []).map((token) => String(token ?? "").trim()).filter(Boolean)),
  )

const compactRow = (row) => {
  if (!row || typeof row !== "object") return undefined
  const symbol = toText(row?.symbol)
  const dateKey = toText(row?.dateKey)
  if (!symbol || !dateKey) return undefined
  const outcomeHitTarget =
    typeof row?.outcomeHitTarget === "boolean"
      ? row.outcomeHitTarget
      : typeof row?.eventOutcome?.hitTarget === "boolean"
        ? row.eventOutcome.hitTarget
        : null
  return {
    sourceId: toText(row?.sourceId),
    symbol,
    dateKey,
    targetDateKey: toText(row?.targetDateKey),
    outcomeHitTarget,
    eventOutcome: compactEventOutcome(row?.eventOutcome),
    numericFeatureMap: compactNumericFeatureMap(row?.numericFeatureMap),
    categoricalTokens: compactCategoricalTokens(row?.categoricalTokens),
  }
}

const loadJsonl = async (filePath) =>
  readJsonl(filePath, {
    strict: true,
    map: (row) => compactRow(row),
  })

const loadSupportCases = async (filePath) => {
  const payload = JSON.parse(await fs.readFile(filePath, "utf8"))
  return payload?.supportCases ?? payload
}

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

const writeUnsat = async ({ outDir, value }) =>
  writeJson(path.join(outDir, "no_support_prejump_episode_transition_counterfactual_controls_summary.json"), value)

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  await fs.mkdir(args.outDir, { recursive: true })
  const trainRows = await loadJsonl(args.trainInput)
  const oosRows = await loadJsonl(args.oosInput)
  const supportCases = await loadSupportCases(args.supportCasesFile)

  let family = buildPerfectPrototypePrejumpEpisodeTransitionControlDataset({
    familyId: args.familyId,
    trainRows,
    oosRows,
    supportCases,
    crossfitWindowCount: args.crossfitWindowCount,
    crossfitFoldCount: args.crossfitFoldCount,
    sameDateNegativePoolSize: args.sameDateNegativePoolSize,
    matchedControlNegativePoolSize: args.matchedControlNegativePoolSize,
    failureNegativePoolSize: args.failureNegativePoolSize,
  })
  await writeJson(path.join(args.outDir, "prejump_episode_transition_dataset_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_prejump_episode_transition_dataset",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypePrejumpHypothesisPortfolioFeatures({ family })
  await writeJson(path.join(args.outDir, "prejump_episode_transition_feature_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_prejump_episode_transition_features",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  const audit = auditPerfectPrototypePrejumpEpisodeTransition({
    family,
    minPairwiseWinRate: args.auditMinPairwiseWinRate,
    minSameDateBeatRate: args.auditMinSameDateBeatRate,
    minMatchedControlBeatRate: args.auditMinMatchedControlBeatRate,
    minFailureBeatRate: args.auditMinFailureBeatRate,
    minFoldPairwiseWinRate: args.auditMinFoldPairwiseWinRate,
    maxHardNegativeLeakCount: args.auditMaxHardNegativeLeakCount,
  })
  await writeJson(path.join(args.outDir, "prejump_episode_transition_audit_summary.json"), audit)
  await writeJson(path.join(args.outDir, "prejump_episode_transition_hypothesis_reports.json"), audit.hypothesisReports ?? [])
  if (!audit.ok) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: audit.reason ?? "unsat_prejump_episode_transition_audit",
        supportFitExcluded: family.supportFitExcluded === true,
        supportLeaveOneOutRecovered: false,
        portfolioFeatureCount: Number(family?.summary?.portfolioFeatureCount ?? 0),
        pairwiseCandidateCount: Number(audit?.pairwiseCandidateCount ?? 0),
        pairwiseQualifiedCandidateCount: Number(audit?.pairwiseQualifiedCandidateCount ?? 0),
        bestHypothesis: audit?.bestHypothesis ?? null,
        canonicalReport: audit?.canonicalReport ?? null,
        diagnosticComparator: audit?.diagnosticComparator ?? null,
        unsatReasonCounts: audit?.unsatReasonCounts ?? {},
      },
    })
    return
  }

  family = {
    ...family,
    portfolioSelectedHypothesisId: audit.canonicalHypothesisId ?? "H2",
    portfolioSelectedFeatureKeys: audit.selectedFeatureKeys ?? [],
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
  await writeJson(path.join(args.outDir, "prejump_episode_transition_top1_summary.json"), ranker)
  if (!ranker.ok) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ...ranker,
        reason: ranker.reason ?? "unsat_prejump_episode_transition_top1",
        selectedHypothesisId: audit.canonicalHypothesisId ?? "H2",
        canonicalReport: audit.canonicalReport ?? null,
      },
    })
    return
  }

  await writeJson(path.join(args.outDir, "prejump_episode_transition_artifact.json"), ranker.artifact)
  await writeJson(path.join(args.outDir, "prejump_episode_transition_solution.json"), {
    ...ranker,
    auditSummary: audit,
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
