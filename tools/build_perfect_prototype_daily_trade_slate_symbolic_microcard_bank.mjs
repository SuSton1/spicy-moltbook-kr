#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { readJsonl } from "../src/lib/io.mjs"
import { buildPerfectPrototypeDailyCanonicalWinnerSlateDataset } from "../src/lib/perfect_prototype_daily_canonical_winner_slate_dataset.mjs"
import {
  buildPerfectPrototypeDailySymbolicMicrocardHypothesisCatalog,
  buildPerfectPrototypeFeatureBankContract,
} from "../src/lib/perfect_prototype_feature_bank_contract.mjs"
import { buildPerfectPrototypeFeatureBankSidecarStore } from "../src/lib/perfect_prototype_feature_bank_sidecar_store.mjs"
import { assemblePerfectPrototypeFeatureBankRows } from "../src/lib/perfect_prototype_feature_bank_assembler.mjs"
import { buildPerfectPrototypeDailyTradeSlateDataset } from "../src/lib/perfect_prototype_daily_trade_slate_dataset.mjs"
import { calibratePerfectPrototypeDailyTradeAbstainGateV2 } from "../src/lib/perfect_prototype_daily_trade_abstain_gate_v2.mjs"
import { buildPerfectPrototypeDailySymbolicGlyphBank } from "../src/lib/perfect_prototype_daily_symbolic_glyph_bank.mjs"
import { buildPerfectPrototypeDailySymbolicStateGrammar } from "../src/lib/perfect_prototype_daily_symbolic_state_grammar.mjs"
import { buildPerfectPrototypeDailySymbolicSlateContrast } from "../src/lib/perfect_prototype_daily_symbolic_slate_contrast.mjs"
import { buildPerfectPrototypeDailyTradeWitnessSelector } from "../src/lib/perfect_prototype_daily_trade_witness_selector.mjs"
import { buildPerfectPrototypeDailySymbolicMicrocardRouter } from "../src/lib/perfect_prototype_daily_symbolic_microcard_router.mjs"
import { buildPerfectPrototypeDailySymbolicExactBank } from "../src/lib/perfect_prototype_daily_symbolic_exact_bank.mjs"

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_daily_trade_slate_symbolic_microcard_bank.mjs \\
    --train-input=<daily_pack.jsonl> \\
    --train-control-input=<daily_pack.jsonl> \\
    --oos-input=<daily_pack.jsonl> \\
    --oos-control-input=<daily_pack.jsonl> \\
    --support-cases-file=<support_cases.json> \\
    --out-dir=<dir> \\
    [--family-id=daily_trade_slate_symbolic_microcard_bank] \\
    [--target-universe-id=daily_trade_slate_v1] \\
    [--supplier-universe-id=same_day_plus_recent_upto_1d]`)
}

const parseArgs = (argv) => {
  const args = {
    familyId: "daily_trade_slate_symbolic_microcard_bank",
    targetUniverseId: "daily_trade_slate_v1",
    supplierUniverseId: "same_day_plus_recent_upto_1d",
    minTrainDates: 10,
    minTrainMonths: 6,
    minTrainFolds: 4,
    maxCrossfitNegativeWindows: 0,
    minOosMatchCount: 3,
    gateMaxFeaturePool: 8,
    gateMaxFeatureCount: 4,
    maxWitnessPerPositiveDate: 2,
    maxNegativePerPositiveDate: 2,
    microCardMinDateCount: 4,
    microCardMaxCount: 5,
    microCardMaxShare: 0.8,
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
      case "max-witness-per-positive-date":
        args.maxWitnessPerPositiveDate = Number(value)
        break
      case "max-negative-per-positive-date":
        args.maxNegativePerPositiveDate = Number(value)
        break
      case "microcard-min-date-count":
        args.microCardMinDateCount = Number(value)
        break
      case "microcard-max-count":
        args.microCardMaxCount = Number(value)
        break
      case "microcard-max-share":
        args.microCardMaxShare = Number(value)
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
  writeJson(path.join(outDir, "no_support_daily_trade_slate_symbolic_microcard_bank_summary.json"), value)

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
    discoveryUniverseId: args.supplierUniverseId,
    trainRows,
    oosRows,
    controlTrainRows,
    controlOosRows,
    supportCases,
  })
  await writeJson(path.join(args.outDir, "daily_symbolic_microcard_base_dataset_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: { ok: false, reason: family.reason, supportFitExcluded: family.supportFitExcluded === true, summary: family.summary },
    })
    return
  }

  const bankContract = buildPerfectPrototypeFeatureBankContract({
    bankId: "daily_symbolic_microcard_bank_v1",
    targetUniverseId: args.targetUniverseId,
    hypotheses: buildPerfectPrototypeDailySymbolicMicrocardHypothesisCatalog(),
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

  family = buildPerfectPrototypeDailySymbolicGlyphBank({ family })
  await writeJson(path.join(args.outDir, "daily_symbolic_glyph_bank_summary.json"), family.summary)

  family = buildPerfectPrototypeDailySymbolicStateGrammar({ family })
  await writeJson(path.join(args.outDir, "daily_symbolic_state_grammar_summary.json"), family.summary)

  family = buildPerfectPrototypeDailySymbolicSlateContrast({ family })
  await writeJson(path.join(args.outDir, "daily_symbolic_slate_contrast_summary.json"), family.summary)

  family = buildPerfectPrototypeDailyTradeWitnessSelector({
    family,
    maxWitnessPerPositiveDate: args.maxWitnessPerPositiveDate,
    maxNegativePerPositiveDate: args.maxNegativePerPositiveDate,
  })
  await writeJson(path.join(args.outDir, "daily_trade_witness_selector_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_symbolic_witness_rows",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeDailySymbolicMicrocardRouter({
    family,
    minCardDateCount: args.microCardMinDateCount,
    maxCardCount: args.microCardMaxCount,
    maxCardShare: args.microCardMaxShare,
  })
  await writeJson(path.join(args.outDir, "daily_symbolic_microcard_router_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_symbolic_microcard_router",
        supportFitExcluded: family.supportFitExcluded === true,
        summary: family.summary,
      },
    })
    return
  }

  family = buildPerfectPrototypeDailySymbolicExactBank({
    family,
    minTrainMatchedDates: args.minTrainDates,
    minTrainMatchedMonths: args.minTrainMonths,
    minTrainMatchedFolds: args.minTrainFolds,
    maxCrossfitNegativeWindows: args.maxCrossfitNegativeWindows,
    minOosMatchCount: args.minOosMatchCount,
  })
  await writeJson(path.join(args.outDir, "daily_symbolic_exact_bank_summary.json"), family.summary)
  if (family.ok !== true) {
    await writeUnsat({
      outDir: args.outDir,
      value: {
        ok: false,
        reason: family.reason ?? "unsat_no_symbolic_exact_bank",
        supportFitExcluded: family.supportFitExcluded === true,
        supportLeaveOneOutRecovered: false,
        symbolicHypothesisCount: Number(family?.summary?.symbolicHypothesisCount ?? 0),
        symbolicHypothesisQualifiedCount: Number(family?.summary?.symbolicHypothesisQualifiedCount ?? 0),
        symbolicRuleBankCandidateCount: Number(family?.summary?.symbolicRuleBankCandidateCount ?? 0),
        qualifiedRuleCount: Number(family?.summary?.qualifiedRuleCount ?? 0),
        symbolicBestCandidate: family?.summary?.symbolicBestCandidate ?? null,
        symbolicHypothesisPreview: family?.summary?.symbolicHypothesisPreview ?? [],
      },
    })
    return
  }

  const best = family.symbolicExactRuleBank?.[0] ?? null
  await writeJson(path.join(args.outDir, "daily_trade_slate_symbolic_microcard_rule_bank.json"), family.symbolicExactRuleBank ?? [])
  await writeJson(path.join(args.outDir, "daily_trade_slate_symbolic_microcard_solution.json"), {
    familyId: args.familyId,
    targetUniverseId: args.targetUniverseId,
    supplierUniverseId: args.supplierUniverseId,
    bestCandidate: best ?? null,
    summary: family.summary,
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
