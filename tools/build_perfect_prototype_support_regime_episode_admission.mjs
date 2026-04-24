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
import { buildPerfectPrototypeSupportFeatureSupplierUnion } from "../src/lib/perfect_prototype_support_feature_supplier_union.mjs"
import { buildPerfectPrototypeSupportRegimeSeedHarvest } from "../src/lib/perfect_prototype_support_regime_seed_harvest.mjs"
import { buildPerfectPrototypeSupportRegimeEpisodeDataset } from "../src/lib/perfect_prototype_support_regime_episode_dataset.mjs"
import { buildPerfectPrototypeSupportEpisodeAdmissionFeatures } from "../src/lib/perfect_prototype_support_episode_admission_features.mjs"
import { calibratePerfectPrototypeSupportEpisodeAdmission } from "../src/lib/perfect_prototype_support_episode_admission_calibrate.mjs"
import { buildPerfectPrototypeSupportAdmittedQueryDataset } from "../src/lib/perfect_prototype_support_admitted_query_dataset.mjs"
import { calibratePerfectPrototypeSupportAdmittedTop1Ranker } from "../src/lib/perfect_prototype_support_admitted_top1_ranker.mjs"
import { buildPerfectPrototypeSupportTop1QueryUnsat } from "../src/lib/perfect_prototype_support_top1_query_unsat.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_support_regime_episode_admission.mjs \\
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
  writeJson(path.join(outDir, "no_support_regime_episode_summary.json"), value)

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
      value: { ok: false, stage: "bridge", reason: family.reason ?? "unsat_support_leave_one_out_fit", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportBoundaryResidualFamily({ cohort: family })
  await writeJson(path.join(args.outDir, "support_boundary_residual_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, stage: "boundary", reason: family.reason ?? "unsat_boundary_residual_not_separable", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportRecurrencePurityFamily({ cohort: family })
  await writeJson(path.join(args.outDir, "support_recurrence_purity_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, stage: "recurrence", reason: family.reason ?? "unsat_boundary_residual_not_separable", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportOrdinalMotifFeatures({ cohort: family })
  await writeJson(path.join(args.outDir, "support_ordinal_motif_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, stage: "ordinal_motif", reason: family.reason ?? "unsat_no_ordinal_motif_groups", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
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
      value: { ok: false, stage: "temporal_episode", reason: family.reason ?? "unsat_no_episode_windows", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportBagRoleTopologyFeatures({ family })
  await writeJson(path.join(args.outDir, "support_role_topology_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, stage: "role_topology", reason: family.reason ?? "unsat_no_role_topology_features", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportDateQueryDataset({ family })
  await writeJson(path.join(args.outDir, "support_date_query_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, stage: "date_query", reason: family.reason ?? "unsat_no_date_queries", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
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
      value: { ok: false, stage: "matched_control", reason: family.reason ?? "unsat_no_matched_control_queries", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportCounterfactualOutrankingFeatures({ family })
  await writeJson(path.join(args.outDir, "support_counterfactual_outranking_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, stage: "counterfactual_outranking", reason: family.reason ?? "unsat_no_counterfactual_outranking_features", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportFeatureSupplierUnion({ family })
  await writeJson(path.join(args.outDir, "support_supplier_union_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, stage: "supplier_union", reason: family.reason ?? "unsat_no_supplier_union_features", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportRegimeSeedHarvest({ family, excludedFitSymbols: ["076610"] })
  await writeJson(path.join(args.outDir, "support_regime_seed_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, stage: "regime_seed", reason: family.reason ?? "unsat_no_regime_seed_harvest", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportRegimeEpisodeDataset({
    family,
    lookbackTradingDays: args.lookbackTradingDays,
  })
  await writeJson(path.join(args.outDir, "support_regime_episode_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, stage: "regime_episode", reason: family.reason ?? "unsat_no_regime_episode_dataset", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  family = buildPerfectPrototypeSupportEpisodeAdmissionFeatures({ family })
  await writeJson(path.join(args.outDir, "support_episode_admission_feature_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, stage: "episode_admission_features", reason: family.reason ?? "unsat_no_episode_admission_features", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  const admission = calibratePerfectPrototypeSupportEpisodeAdmission({
    family,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
  })
  await writeJson(path.join(args.outDir, "support_episode_admission_summary.json"), admission)
  if (!admission.ok) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        stage: "episode_admission",
        reason: admission.reason ?? "unsat_episode_admission_train_precision",
        supportFitExcluded: admission.supportFitExcluded === true,
        supportProjectionPositive: admission.supportProjectionPositive === true,
        summary: family.summary,
        admissionSummary: admission,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportAdmittedQueryDataset({
    family: {
      ...family,
      episodeAdmissionArtifactHash: admission.artifactHashAfterAcceptance ?? admission.artifactHashBeforeAcceptance ?? null,
    },
    admissionArtifact: admission.artifact,
  })
  await writeJson(path.join(args.outDir, "support_admitted_query_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        stage: "admitted_query_dataset",
        reason: family.reason ?? "unsat_no_admitted_queries",
        supportFitExcluded: family.supportFitExcluded === true,
        supportProjectionPositive: family.summary?.supportProjectionPositive === true,
        summary: family.summary,
        admissionSummary: admission,
      },
    })
    return
  }

  const ranker = calibratePerfectPrototypeSupportAdmittedTop1Ranker({
    family,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    minCrossfitPositiveWindows: args.minCrossfitPositiveWindows,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
    minOosMatchCount: args.minOosMatchCount,
  })
  await writeJson(path.join(args.outDir, "support_admitted_top1_summary.json"), ranker)
  if (!ranker.ok) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ...buildPerfectPrototypeSupportTop1QueryUnsat(ranker),
        stage: "admitted_top1",
        admissionSummary: admission,
      },
    })
    return
  }

  const combinedArtifact = {
    familyId: args.familyId,
    supplierFamilyId: args.familyId,
    admissionArtifact: admission.artifact,
    top1Artifact: ranker.artifact,
    episodeAdmissionArtifactHash: admission.artifactHashAfterAcceptance ?? null,
    admittedTop1ArtifactHash: ranker.artifactHashAfterAcceptance ?? null,
    supportAcceptanceOnly: true,
  }
  await writeJson(path.join(args.outDir, "support_regime_artifact.json"), combinedArtifact)
  await writeJson(path.join(args.outDir, "support_regime_solution_summary.json"), {
    ok: true,
    supportFitExcluded: ranker.supportFitExcluded === true,
    supportSymbolExcluded: family.supportSymbolExcluded === true,
    supportLeaveOneOutRecovered: ranker.supportLeaveOneOutRecovered === true,
    supportProjectionPositive: admission.supportProjectionPositive === true,
    supplierFeatureCount: family.summary?.supplierUnionFeatureCount ?? 0,
    regimeEpisodeFeatureCount: family.summary?.regimeEpisodeFeatureCount ?? 0,
    episodeAdmissionFeatureCount: family.summary?.episodeAdmissionFeatureCount ?? 0,
    episodeAdmissionCandidateCount: admission.candidateCount ?? 0,
    episodeAdmissionQualifiedCount: admission.qualifiedCandidateCount ?? 0,
    admittedTrainDateCount: family.summary?.admittedTrainDateCount ?? 0,
    top1CandidateCount: ranker.candidateCount ?? 0,
    top1QualifiedCandidateCount: ranker.qualifiedCandidateCount ?? 0,
    trainSummary: ranker.trainSummary,
    oosSummary: ranker.oosSummary,
    supportMatched: ranker.supportMatched ?? [],
    admissionArtifactPath: path.join(args.outDir, "support_episode_admission_summary.json"),
    regimeArtifactPath: path.join(args.outDir, "support_regime_artifact.json"),
  })
}

await main()
