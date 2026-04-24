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
import { buildPerfectPrototypeSupportSeparabilityDataset } from "../src/lib/perfect_prototype_support_separability_dataset.mjs"
import { auditPerfectPrototypeSupportSeparabilityPairwise } from "../src/lib/perfect_prototype_support_separability_pairwise_audit.mjs"
import { auditPerfectPrototypeSupportSeparabilityQueries } from "../src/lib/perfect_prototype_support_separability_query_audit.mjs"
import { derivePerfectPrototypeSupportSeparabilityFamilyContract } from "../src/lib/perfect_prototype_support_separability_family_derive.mjs"
import { buildPerfectPrototypeSupportSeparabilityUnsat } from "../src/lib/perfect_prototype_support_separability_unsat.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_low_gap_top_support_separability_audit.mjs \\
    --train-input=<daily_pack.jsonl> \\
    --oos-input=<daily_pack.jsonl> \\
    --support-cases-file=<support_cases.json> \\
    --out-dir=<dir> \\
    [--family-id=low_gap_top_continuation] \\
    [--min-train-dates=10] \\
    [--min-train-months=6] \\
    [--min-train-folds=4] \\
    [--min-heldout-pairwise-win-rate=0.9] \\
    [--min-fold-pairwise-win-rate=0.8] \\
    [--min-runner-up-beat-rate=0.85] \\
    [--min-positive-signature-count=2] \\
    [--max-hard-negative-leak-count=0] \\
    [--lookback-trading-days=4] \\
    [--control-pool-size=5]`)
}

const parseArgs = (argv) => {
  const args = {
    familyId: "low_gap_top_continuation",
    minTrainDates: 10,
    minTrainMonths: 6,
    minTrainFolds: 4,
    minHeldoutPairwiseWinRate: 0.9,
    minFoldPairwiseWinRate: 0.8,
    minRunnerUpBeatRate: 0.85,
    minPositiveSignatureCount: 2,
    maxHardNegativeLeakCount: 0,
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
      case "min-heldout-pairwise-win-rate":
        args.minHeldoutPairwiseWinRate = Number(value)
        break
      case "min-fold-pairwise-win-rate":
        args.minFoldPairwiseWinRate = Number(value)
        break
      case "min-runner-up-beat-rate":
        args.minRunnerUpBeatRate = Number(value)
        break
      case "min-positive-signature-count":
        args.minPositiveSignatureCount = Number(value)
        break
      case "max-hard-negative-leak-count":
        args.maxHardNegativeLeakCount = Number(value)
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
  writeJson(path.join(outDir, "no_support_separability_summary.json"), value)

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

  family = buildPerfectPrototypeSupportTemporalEpisodeDataset({
    family,
    lookbackTradingDays: args.lookbackTradingDays,
  })
  await writeJson(path.join(args.outDir, "support_temporal_episode_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_episode_windows",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportBagRoleTopologyFeatures({ family })
  await writeJson(path.join(args.outDir, "support_role_topology_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_role_topology_features",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportDateQueryDataset({ family })
  await writeJson(path.join(args.outDir, "support_date_query_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_date_queries",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
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
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_matched_control_queries",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportCounterfactualOutrankingFeatures({ family })
  await writeJson(path.join(args.outDir, "support_counterfactual_outranking_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_counterfactual_outranking_features",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportFeatureSupplierUnion({ family })
  await writeJson(path.join(args.outDir, "support_feature_supplier_union_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_supplier_union_features",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  const dataset = buildPerfectPrototypeSupportSeparabilityDataset({ family })
  await writeJson(path.join(args.outDir, "support_separability_dataset_summary.json"), dataset.summary)
  if (dataset.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: dataset.reason ?? "unsat_no_separability_pairs",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: dataset.summary,
      },
    })
    return
  }

  const pairwiseAudit = auditPerfectPrototypeSupportSeparabilityPairwise({
    family,
    dataset,
    minHeldoutPairwiseWinRate: args.minHeldoutPairwiseWinRate,
    minFoldPairwiseWinRate: args.minFoldPairwiseWinRate,
    minRunnerUpBeatRate: args.minRunnerUpBeatRate,
    maxHardNegativeLeakCount: args.maxHardNegativeLeakCount,
    minPositiveSignatureCount: args.minPositiveSignatureCount,
  })
  await writeJson(path.join(args.outDir, "support_separability_pairwise_report.json"), {
    ...pairwiseAudit,
    candidates: undefined,
  })
  await writeJson(path.join(args.outDir, "support_separability_feature_leaderboard.json"), {
    featurePool: pairwiseAudit.featurePool ?? [],
    bestCandidate: pairwiseAudit.bestCandidate
      ? {
          selectedFeatureKeys: pairwiseAudit.bestCandidate.selectedFeatureKeys,
          pairwiseWinRate: pairwiseAudit.bestCandidate.pairwiseWinRate,
          sameDateRunnerUpBeatRate: pairwiseAudit.bestCandidate.sameDateRunnerUpBeatRate,
          minFoldPairwiseWinRate: pairwiseAudit.bestCandidate.minFoldPairwiseWinRate,
          hardNegativeLeakCount: pairwiseAudit.bestCandidate.hardNegativeLeakCount,
          distinctPositiveSignatureCount: pairwiseAudit.bestCandidate.distinctPositiveSignatureCount,
        }
      : null,
      candidatePreviews: pairwiseAudit.candidatePreviews ?? [],
  })
  if (pairwiseAudit.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportSeparabilityUnsat({
        family,
        pairwiseAudit,
      }),
    })
    return
  }

  const queryAudit = auditPerfectPrototypeSupportSeparabilityQueries({
    family,
    pairwiseAudit,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    maxCrossfitNegativeWindows: args.maxHardNegativeLeakCount,
  })
  await writeJson(path.join(args.outDir, "support_separability_query_report.json"), {
    ...queryAudit,
    candidates: undefined,
  })

  const derivedContract = derivePerfectPrototypeSupportSeparabilityFamilyContract({
    family,
    pairwiseAudit,
    queryAudit,
  })

  if (!derivedContract.ok) {
    await writeUnsat({
      outDir: args.outDir,
      value: buildPerfectPrototypeSupportSeparabilityUnsat({
        family,
        pairwiseAudit,
        queryAudit,
      }),
    })
    return
  }

  await writeJson(path.join(args.outDir, "derived_support_regime_family_contract.json"), derivedContract)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

