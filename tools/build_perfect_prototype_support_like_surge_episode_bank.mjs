#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { loadConfig } from "../src/lib/config.mjs"
import { readJsonl } from "../src/lib/io.mjs"
import { buildPerfectPrototypeDailyCanonicalWinnerSlateDataset } from "../src/lib/perfect_prototype_daily_canonical_winner_slate_dataset.mjs"
import {
  buildPerfectPrototypeDailyMechanismHypothesisCatalog,
  buildPerfectPrototypeFeatureBankContract,
} from "../src/lib/perfect_prototype_feature_bank_contract.mjs"
import { buildPerfectPrototypeFeatureBankSidecarStore } from "../src/lib/perfect_prototype_feature_bank_sidecar_store.mjs"
import { assemblePerfectPrototypeFeatureBankRows } from "../src/lib/perfect_prototype_feature_bank_assembler.mjs"
import { buildPerfectPrototypeDailyTradeSlateDataset } from "../src/lib/perfect_prototype_daily_trade_slate_dataset.mjs"
import { calibratePerfectPrototypeDailyTradeAbstainGateV2 } from "../src/lib/perfect_prototype_daily_trade_abstain_gate_v2.mjs"
import { buildPerfectPrototypeDailySequenceShapeletBank } from "../src/lib/perfect_prototype_daily_sequence_shapelet_bank.mjs"
import { buildPerfectPrototypeDailySymbolicSlateContrast } from "../src/lib/perfect_prototype_daily_symbolic_slate_contrast.mjs"
import { buildPerfectPrototypeSupportLikeSurgeEpisodeDataset } from "../src/lib/perfect_prototype_support_like_surge_episode_dataset.mjs"
import { buildPerfectPrototypeSupportLikeNegativeBank } from "../src/lib/perfect_prototype_support_like_negative_bank.mjs"
import { buildPerfectPrototypeSupportLikeArchetypeRouter } from "../src/lib/perfect_prototype_support_like_archetype_router.mjs"
import { buildPerfectPrototypeSupportLikeExactDetectorBank } from "../src/lib/perfect_prototype_support_like_exact_detector_bank.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_support_like_surge_episode_bank.mjs \\
    --config=<config.json> \\
    --train-input=<daily_pack.jsonl> \\
    --train-control-input=<daily_pack.jsonl> \\
    --oos-input=<daily_pack.jsonl> \\
    --oos-control-input=<daily_pack.jsonl> \\
    --support-cases-file=<support_cases.json> \\
    --out-dir=<dir>`)
}

const parseArgs = (argv) => {
  const args = {
    familyId: "support_like_surge_episode_bank",
    targetUniverseId: "support_like_surge_episode_v1",
    supplierUniverseId: "same_day_plus_recent_upto_1d",
    minTrainDates: 10,
    minTrainMonths: 6,
    minTrainFolds: 4,
    maxCrossfitNegativeWindows: 0,
    minOosMatchCount: 3,
    gateMaxFeaturePool: 8,
    gateMaxFeatureCount: 4,
    maxPositiveRowsPerDate: 2,
    maxSameDateNegativesPerDate: 2,
    maxHardNegativesPerDate: 1,
    archetypeMinDateCount: 4,
    archetypeMaxCount: 5,
    archetypeMaxShare: 0.8,
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
      case "config":
        args.configPath = value
        break
      case "train-input":
        args.trainInput = value
        break
      case "train-control-input":
        args.trainControlInput = value
        break
      case "oos-input":
        args.oosInput = value
        break
      case "oos-control-input":
        args.oosControlInput = value
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
      case "target-universe-id":
        args.targetUniverseId = value
        break
      case "supplier-universe-id":
        args.supplierUniverseId = value
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
      case "max-crossfit-negative-windows":
        args.maxCrossfitNegativeWindows = Number(value)
        break
      case "min-oos-match-count":
        args.minOosMatchCount = Number(value)
        break
      case "gate-max-feature-pool":
        args.gateMaxFeaturePool = Number(value)
        break
      case "gate-max-feature-count":
        args.gateMaxFeatureCount = Number(value)
        break
      case "max-positive-rows-per-date":
        args.maxPositiveRowsPerDate = Number(value)
        break
      case "max-same-date-negatives-per-date":
        args.maxSameDateNegativesPerDate = Number(value)
        break
      case "max-hard-negatives-per-date":
        args.maxHardNegativesPerDate = Number(value)
        break
      case "archetype-min-date-count":
        args.archetypeMinDateCount = Number(value)
        break
      case "archetype-max-count":
        args.archetypeMaxCount = Number(value)
        break
      case "archetype-max-share":
        args.archetypeMaxShare = Number(value)
        break
      default:
        throw new Error(`Unknown arg: --${key}`)
    }
  }
  if (
    !args.configPath ||
    !args.trainInput ||
    !args.trainControlInput ||
    !args.oosInput ||
    !args.oosControlInput ||
    !args.supportCasesFile ||
    !args.outDir
  ) {
    usage()
    throw new Error("Missing required args")
  }
  return args
}

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
  for (const [featureKey, rawValue] of Object.entries(safeMap)) {
    const value = toFiniteNumber(rawValue)
    if (value === null) continue
    if (
      featureKey.startsWith("sig.") ||
      featureKey.startsWith("feature.") ||
      featureKey.startsWith("global.") ||
      featureKey.startsWith("trend.") ||
      featureKey.startsWith("candle.") ||
      featureKey.startsWith("shape.") ||
      featureKey.startsWith("volume.") ||
      featureKey.startsWith("level.")
    ) {
      out[featureKey] = value
    }
  }
  return out
}

const compactCategoricalTokens = (tokens) =>
  Array.from(new Set((Array.isArray(tokens) ? tokens : []).map((token) => String(token ?? "").trim()).filter(Boolean)))

const compactSequence = (values = []) =>
  (Array.isArray(values) ? values : [])
    .map((value) => toFiniteNumber(value))
    .filter(Number.isFinite)

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
        : typeof row?.successInWindow === "boolean"
          ? row.successInWindow
          : null
  return {
    sourceId: toText(row?.sourceId),
    rowKey: toText(row?.rowKey),
    symbol,
    dateKey,
    decisionDateKey: toText(row?.decisionDateKey) ?? dateKey,
    asOfDateKey: toText(row?.asOfDateKey),
    targetDateKey:
      toText(row?.targetDateKey) ??
      toText(row?.eventOutcome?.entryDateKey) ??
      toText(row?.entryDateKey),
    monthKey: toText(row?.monthKey),
    foldId: toFiniteNumber(row?.foldId),
    windowId: toFiniteNumber(row?.windowId),
    outcomeHitTarget,
    eventOutcome:
      row?.eventOutcome && typeof row.eventOutcome === "object"
        ? {
            ...(typeof row?.eventOutcome?.hitTarget === "boolean" ? { hitTarget: row.eventOutcome.hitTarget } : {}),
            ...(toFiniteNumber(row?.eventOutcome?.netRet) !== null ? { netRet: Number(row.eventOutcome.netRet) } : {}),
            ...(toText(row?.eventOutcome?.entryDateKey) ? { entryDateKey: String(row.eventOutcome.entryDateKey).trim() } : {}),
          }
        : null,
    seq40: compactSequence(row?.seq40),
    seq150: compactSequence(row?.seq150),
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
  writeJson(path.join(outDir, "no_support_support_like_surge_episode_bank_summary.json"), value)

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const { config } = await loadConfig({ cwd, configPath: args.configPath })
  await fs.mkdir(args.outDir, { recursive: true })
  const trainRows = await loadJsonl(args.trainInput)
  const controlTrainRows = await loadJsonl(args.trainControlInput)
  const oosRows = await loadJsonl(args.oosInput)
  const controlOosRows = await loadJsonl(args.oosControlInput)
  const supportCases = await loadSupportCases(args.supportCasesFile)

  let family = buildPerfectPrototypeDailyCanonicalWinnerSlateDataset({
    familyId: args.familyId,
    discoveryUniverseId: args.supplierUniverseId,
    trainRows,
    oosRows,
    controlTrainRows,
    controlOosRows,
    supportCases,
  })
  await writeJson(path.join(args.outDir, "support_like_surge_base_dataset_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason,
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  const bankContract = buildPerfectPrototypeFeatureBankContract({
    bankId: "support_like_surge_pregate_v1",
    targetUniverseId: args.targetUniverseId,
    hypotheses: buildPerfectPrototypeDailyMechanismHypothesisCatalog(),
  })
  await writeJson(path.join(args.outDir, "feature_bank_contract.json"), bankContract)
  const sidecarStore = buildPerfectPrototypeFeatureBankSidecarStore({ family, bankContract })
  await writeJson(path.join(args.outDir, "feature_bank_manifest.json"), sidecarStore.manifest ?? null)
  if (sidecarStore.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: sidecarStore.reason ?? "unsat_no_mechanism_feature_bank",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = assemblePerfectPrototypeFeatureBankRows({ family, sidecarStore })
  await writeJson(path.join(args.outDir, "feature_bank_assembly_summary.json"), family.summary)

  family = buildPerfectPrototypeDailyTradeSlateDataset({
    family,
    targetUniverseId: args.targetUniverseId,
  })
  await writeJson(path.join(args.outDir, "daily_trade_slate_dataset_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_trade_slate_rows",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = calibratePerfectPrototypeDailyTradeAbstainGateV2({
    family,
    minTradeDates: args.minTrainDates,
    minTradeMonths: args.minTrainMonths,
    minTradeFolds: args.minTrainFolds,
    maxFeaturePool: args.gateMaxFeaturePool,
    maxFeatureCount: args.gateMaxFeatureCount,
  })
  await writeJson(path.join(args.outDir, "daily_trade_abstain_gate_v2_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_trade_gate_v2",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = await buildPerfectPrototypeDailySequenceShapeletBank({
    family,
    cwd,
    config,
  })
  await writeJson(path.join(args.outDir, "daily_sequence_shapelet_bank_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_sequence_shapelets",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeDailySymbolicSlateContrast({ family })
  await writeJson(path.join(args.outDir, "daily_symbolic_slate_contrast_summary.json"), family.summary)

  family = buildPerfectPrototypeSupportLikeSurgeEpisodeDataset({
    family,
    maxPositiveRowsPerDate: args.maxPositiveRowsPerDate,
    maxSameDateNegativesPerDate: args.maxSameDateNegativesPerDate,
  })
  await writeJson(path.join(args.outDir, "support_like_surge_episode_dataset_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_support_like_episode_rows",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportLikeNegativeBank({
    family,
    maxSameDateNegativesPerDate: args.maxSameDateNegativesPerDate,
    maxHardNegativesPerDate: args.maxHardNegativesPerDate,
  })
  await writeJson(path.join(args.outDir, "support_like_negative_bank_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_support_like_negative_rows",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportLikeArchetypeRouter({
    family,
    minDateCount: args.archetypeMinDateCount,
    maxArchetypeCount: args.archetypeMaxCount,
    maxArchetypeShare: args.archetypeMaxShare,
  })
  await writeJson(path.join(args.outDir, "support_like_archetype_router_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_support_like_archetype_router",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeSupportLikeExactDetectorBank({
    family,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
    minOosMatchCount: args.minOosMatchCount,
  })
  await writeJson(path.join(args.outDir, "support_like_exact_detector_bank_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_support_like_detector_rule",
        supportFitExcluded: family.supportFitExcluded === true,
        supportLeaveOneOutRecovered: false,
        supportLikeHypothesisCount: Number(family?.summary?.supportLikeHypothesisCount ?? 0),
        supportLikeHypothesisQualifiedCount: Number(family?.summary?.supportLikeHypothesisQualifiedCount ?? 0),
        supportLikeDetectorCandidateCount: Number(family?.summary?.supportLikeDetectorCandidateCount ?? 0),
        qualifiedRuleCount: Number(family?.summary?.qualifiedRuleCount ?? 0),
        supportLikeBestCandidate: family?.summary?.supportLikeBestCandidate ?? null,
        supportLikeHypothesisPreview: family?.summary?.supportLikeHypothesisPreview ?? [],
      },
    })
    return
  }

  const best = family.supportLikeDetectorRuleBank?.[0] ?? null
  await writeJson(path.join(args.outDir, "support_like_detector_rule_bank.json"), family.supportLikeDetectorRuleBank ?? [])
  await writeJson(path.join(args.outDir, "support_like_detector_solution.json"), {
    familyId: args.familyId,
    targetUniverseId: args.targetUniverseId,
    supplierUniverseId: args.supplierUniverseId,
    bestCandidate: best,
    summary: family.summary,
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
