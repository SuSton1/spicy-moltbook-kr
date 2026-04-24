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
import { buildPerfectPrototypeSupportFeatureSupplierUnion } from "../src/lib/perfect_prototype_support_feature_supplier_union.mjs"
import { buildPerfectPrototypeShadowWinnerSlateDataset } from "../src/lib/perfect_prototype_shadow_winner_slate_dataset.mjs"
import { buildPerfectPrototypeShadowWinnerSlateFeatures } from "../src/lib/perfect_prototype_shadow_winner_slate_features.mjs"
import { auditPerfectPrototypeShadowWinnerSlateSeparability } from "../src/lib/perfect_prototype_shadow_winner_slate_separability_audit.mjs"
import { calibratePerfectPrototypeSupportTop1QueryRanker } from "../src/lib/perfect_prototype_support_top1_query_calibrate.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_shadow_winner_slate.mjs \\
    --train-input=<daily_pack.jsonl> \\
    --oos-input=<daily_pack.jsonl> \\
    --support-cases-file=<support_cases.json> \\
    --out-dir=<dir> \\
    [--family-id=shadow_winner_slate_top1] \\
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
    familyId: "shadow_winner_slate_top1",
    supportSignatureFamilyId: "low_gap_top_continuation",
    minTrainDates: 10,
    minTrainMonths: 6,
    minTrainFolds: 4,
    minCrossfitPositiveWindows: 2,
    maxCrossfitNegativeWindows: 0,
    minOosMatchCount: 3,
    lookbackTradingDays: 4,
    controlPoolSize: 5,
    sameDateNegativePoolSize: 2,
    matchedControlNegativePoolSize: 2,
    failureNegativePoolSize: 2,
    auditMinPairwiseWinRate: 0.9,
    auditMinSameDateBeatRate: 0.9,
    auditMinMatchedControlBeatRate: 0.85,
    auditMinFailureBeatRate: 0.85,
    auditMinFoldPairwiseWinRate: 0.8,
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
  writeJson(path.join(outDir, "no_support_shadow_winner_slate_summary.json"), value)

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
  await writeJson(path.join(args.outDir, "recent_mid_low_supplier_dataset_summary.json"), family.summary)
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

  family = buildPerfectPrototypeSupportFeatureSupplierUnion({ family })
  await writeJson(path.join(args.outDir, "support_feature_supplier_union_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_supplier_union_features", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  family = buildPerfectPrototypeShadowWinnerSlateDataset({
    family,
    sameDateNegativePoolSize: args.sameDateNegativePoolSize,
    matchedControlNegativePoolSize: args.matchedControlNegativePoolSize,
    failureNegativePoolSize: args.failureNegativePoolSize,
  })
  await writeJson(path.join(args.outDir, "shadow_winner_slate_dataset_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_shadow_winner_slate_dataset", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  family = buildPerfectPrototypeShadowWinnerSlateFeatures({ family })
  await writeJson(path.join(args.outDir, "shadow_winner_slate_feature_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_shadow_winner_slate_features", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  const audit = auditPerfectPrototypeShadowWinnerSlateSeparability({
    family,
    minPairwiseWinRate: args.auditMinPairwiseWinRate,
    minSameDateBeatRate: args.auditMinSameDateBeatRate,
    minMatchedControlBeatRate: args.auditMinMatchedControlBeatRate,
    minFailureBeatRate: args.auditMinFailureBeatRate,
    minFoldPairwiseWinRate: args.auditMinFoldPairwiseWinRate,
    maxHardNegativeLeakCount: args.auditMaxHardNegativeLeakCount,
  })
  await writeJson(path.join(args.outDir, "shadow_winner_slate_separability_summary.json"), audit)
  if (!audit.ok) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: audit.reason ?? "unsat_shadow_winner_slate_audit",
        supportFitExcluded: family.supportFitExcluded === true,
        supportLeaveOneOutRecovered: false,
        supplierFeatureCount: Number(family?.summary?.supplierUnionFeatureCount ?? 0),
        shadowWinnerSlateFeatureCount: Number(family?.summary?.shadowWinnerSlateFeatureCount ?? 0),
        pairwiseCandidateCount: Number(audit?.pairwiseCandidateCount ?? 0),
        pairwiseQualifiedCandidateCount: Number(audit?.pairwiseQualifiedCandidateCount ?? 0),
        bestCandidate: audit?.bestCandidate ?? null,
        unsatReasonCounts: audit?.unsatReasonCounts ?? {},
      },
    })
    return
  }

  family = {
    ...family,
    shadowWinnerSlateAuditFeatureKeys: audit.selectedFeatureKeys ?? [],
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
  await writeJson(path.join(args.outDir, "shadow_winner_slate_ranker_summary.json"), ranker)
  if (!ranker.ok) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ...ranker,
        reason: ranker.reason ?? "unsat_shadow_winner_slate_top1",
      },
    })
    return
  }

  await writeJson(path.join(args.outDir, "shadow_winner_slate_artifact.json"), ranker.artifact)
  await writeJson(path.join(args.outDir, "shadow_winner_slate_solution.json"), {
    ...ranker,
    auditSummary: audit,
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
