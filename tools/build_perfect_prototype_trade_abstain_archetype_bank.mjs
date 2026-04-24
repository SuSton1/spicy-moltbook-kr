#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { readJsonl } from "../src/lib/io.mjs"
import { buildPerfectPrototypeDailyCanonicalWinnerSlateDataset } from "../src/lib/perfect_prototype_daily_canonical_winner_slate_dataset.mjs"
import { buildPerfectPrototypeSupportTemporalEpisodeDataset } from "../src/lib/perfect_prototype_support_temporal_episode_dataset.mjs"
import { buildPerfectPrototypeSupportBagRoleTopologyFeatures } from "../src/lib/perfect_prototype_support_bag_role_topology_features.mjs"
import { buildPerfectPrototypeDailyCanonicalWinnerLabels } from "../src/lib/perfect_prototype_daily_canonical_winner_labels.mjs"
import { buildPerfectPrototypeSupportDateQueryDataset } from "../src/lib/perfect_prototype_support_date_query_dataset.mjs"
import { buildPerfectPrototypeSupportMatchedControlPool } from "../src/lib/perfect_prototype_support_matched_control_pool.mjs"
import { buildPerfectPrototypeSupportCounterfactualOutrankingFeatures } from "../src/lib/perfect_prototype_support_counterfactual_outranking_features.mjs"
import { buildPerfectPrototypeRecentMidLowWinnerQueryFeatures } from "../src/lib/perfect_prototype_recent_mid_low_winner_query_features.mjs"
import { buildPerfectPrototypeSupportFeatureSupplierUnion } from "../src/lib/perfect_prototype_support_feature_supplier_union.mjs"
import { buildPerfectPrototypeDailyTradeAbstainSlateDataset } from "../src/lib/perfect_prototype_daily_trade_abstain_slate_dataset.mjs"
import { calibratePerfectPrototypeDailyTradeAbstainGate } from "../src/lib/perfect_prototype_daily_trade_abstain_gate.mjs"
import { buildPerfectPrototypeDailyWinnerArchetypeRouter } from "../src/lib/perfect_prototype_daily_winner_archetype_router.mjs"
import { buildPerfectPrototypeDailyArchetypeRuleBank } from "../src/lib/perfect_prototype_daily_archetype_rule_bank.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_trade_abstain_archetype_bank.mjs \\
    --train-input=<daily_pack.jsonl> \\
    --train-control-input=<daily_pack.jsonl> \\
    --oos-input=<daily_pack.jsonl> \\
    --oos-control-input=<daily_pack.jsonl> \\
    --support-cases-file=<support_cases.json> \\
    --out-dir=<dir> \\
    [--family-id=trade_abstain_archetype_winner_bank] \\
    [--discovery-universe-id=same_day_plus_recent_upto_1d]`)
}

const parseArgs = (argv) => {
  const args = {
    familyId: "trade_abstain_archetype_winner_bank",
    discoveryUniverseId: "same_day_plus_recent_upto_1d",
    minTrainDates: 10,
    minTrainMonths: 6,
    minTrainFolds: 4,
    minCrossfitPositiveWindows: 2,
    maxCrossfitNegativeWindows: 0,
    minOosMatchCount: 3,
    lookbackTradingDays: 4,
    controlPoolSize: 5,
    sameDateNegativePoolSize: 2,
    gateMaxFeaturePool: 5,
    gateMaxFeatureCount: 3,
    archetypeMinDates: 2,
    archetypeMaxCount: 4,
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
      case "discovery-universe-id":
        args.discoveryUniverseId = value
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
      case "gate-max-feature-pool":
        args.gateMaxFeaturePool = Number(value)
        break
      case "gate-max-feature-count":
        args.gateMaxFeatureCount = Number(value)
        break
      case "archetype-min-dates":
        args.archetypeMinDates = Number(value)
        break
      case "archetype-max-count":
        args.archetypeMaxCount = Number(value)
        break
      default:
        throw new Error(`Unknown arg: --${key}`)
    }
  }
  if (!args.trainInput || !args.trainControlInput || !args.oosInput || !args.oosControlInput || !args.supportCasesFile || !args.outDir) {
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
      featureKey.startsWith("seq")
    ) {
      out[featureKey] = value
    }
  }
  return out
}

const compactCategoricalTokens = (tokens) =>
  Array.from(new Set((Array.isArray(tokens) ? tokens : []).map((token) => String(token ?? "").trim()).filter(Boolean)))

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
    symbol,
    dateKey,
    targetDateKey:
      toText(row?.targetDateKey) ??
      toText(row?.eventOutcome?.entryDateKey) ??
      toText(row?.entryDateKey),
    outcomeHitTarget,
    eventOutcome:
      row?.eventOutcome && typeof row.eventOutcome === "object"
        ? {
            ...(typeof row?.eventOutcome?.hitTarget === "boolean" ? { hitTarget: row.eventOutcome.hitTarget } : {}),
            ...(toFiniteNumber(row?.eventOutcome?.netRet) !== null ? { netRet: Number(row.eventOutcome.netRet) } : {}),
            ...(toText(row?.eventOutcome?.entryDateKey) ? { entryDateKey: String(row.eventOutcome.entryDateKey).trim() } : {}),
          }
        : null,
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
  writeJson(path.join(outDir, "no_support_trade_abstain_archetype_winner_bank_summary.json"), value)

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  await fs.mkdir(args.outDir, { recursive: true })
  const trainRows = await loadJsonl(args.trainInput)
  const controlTrainRows = await loadJsonl(args.trainControlInput)
  const oosRows = await loadJsonl(args.oosInput)
  const controlOosRows = await loadJsonl(args.oosControlInput)
  const supportCases = await loadSupportCases(args.supportCasesFile)

  let family = buildPerfectPrototypeDailyCanonicalWinnerSlateDataset({
    familyId: args.familyId,
    discoveryUniverseId: args.discoveryUniverseId,
    trainRows,
    oosRows,
    controlTrainRows,
    controlOosRows,
    supportCases,
  })
  await writeJson(path.join(args.outDir, "daily_canonical_winner_slate_dataset_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, reason: family.reason, supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
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

  family = buildPerfectPrototypeDailyCanonicalWinnerLabels({
    family,
    negativePoolPerDate: args.sameDateNegativePoolSize,
  })
  await writeJson(path.join(args.outDir, "daily_canonical_winner_labels_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_daily_canonical_winner_labels", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
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
  await writeJson(path.join(args.outDir, "daily_canonical_winner_query_feature_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_daily_canonical_winner_query_features", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  family = buildPerfectPrototypeSupportFeatureSupplierUnion({ family })
  await writeJson(path.join(args.outDir, "support_feature_supplier_union_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_supplier_union_features", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  family = buildPerfectPrototypeDailyTradeAbstainSlateDataset({ family })
  await writeJson(path.join(args.outDir, "daily_trade_abstain_dataset_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({ outDir: args.outDir, value: { ok: false, reason: family.reason ?? "unsat_no_trade_abstain_date_rows", supportFitExcluded: family.supportFitExcluded === true, summary: family.summary } })
    return
  }

  family = calibratePerfectPrototypeDailyTradeAbstainGate({
    family,
    minTradeDates: args.minTrainDates,
    minTradeMonths: args.minTrainMonths,
    minTradeFolds: args.minTrainFolds,
    maxFeaturePool: args.gateMaxFeaturePool,
    maxFeatureCount: args.gateMaxFeatureCount,
  })
  await writeJson(path.join(args.outDir, "daily_trade_abstain_gate_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_trade_abstain_gate",
        supportFitExcluded: family.supportFitExcluded === true,
        supportLeaveOneOutRecovered: false,
        tradeGateCandidateCount: Number(family?.summary?.tradeGateCandidateCount ?? 0),
        tradeGateQualifiedCandidateCount: Number(family?.summary?.tradeGateQualifiedCandidateCount ?? 0),
        tradeGateBestCandidate: family?.summary?.tradeGateBestCandidate ?? null,
      },
    })
    return
  }

  family = buildPerfectPrototypeDailyWinnerArchetypeRouter({
    family,
    minArchetypeDates: args.archetypeMinDates,
    maxArchetypes: args.archetypeMaxCount,
  })
  await writeJson(path.join(args.outDir, "daily_winner_archetype_router_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_daily_winner_archetypes",
        supportFitExcluded: family.supportFitExcluded === true,
        supportLeaveOneOutRecovered: false,
        winnerArchetypeCount: Number(family?.summary?.winnerArchetypeCount ?? 0),
        winnerArchetypeDistinctDateSignatureCount: Number(family?.summary?.winnerArchetypeDistinctDateSignatureCount ?? 0),
      },
    })
    return
  }

  family = buildPerfectPrototypeDailyArchetypeRuleBank({
    family,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    minCrossfitPositiveWindows: args.minCrossfitPositiveWindows,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
    minOosMatchCount: args.minOosMatchCount,
  })
  await writeJson(path.join(args.outDir, "daily_archetype_rule_bank_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_archetype_rule_bank",
        supportFitExcluded: family.supportFitExcluded === true,
        supportLeaveOneOutRecovered: false,
        archetypeRuleBankCandidateCount: Number(family?.summary?.archetypeRuleBankCandidateCount ?? 0),
        archetypeRuleBankQualifiedCount: Number(family?.summary?.archetypeRuleBankQualifiedCount ?? 0),
        archetypeRuleBankBestCandidate: family?.summary?.archetypeRuleBankBestCandidate ?? null,
      },
    })
    return
  }

  const best = family.archetypeRuleBank?.[0] ?? null
  await writeJson(path.join(args.outDir, "daily_trade_abstain_archetype_rule_bank.json"), family.archetypeRuleBank ?? [])
  await writeJson(path.join(args.outDir, "daily_trade_abstain_archetype_solution.json"), {
    familyId: args.familyId,
    bestArchetype: best ?? null,
    summary: family.summary,
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
