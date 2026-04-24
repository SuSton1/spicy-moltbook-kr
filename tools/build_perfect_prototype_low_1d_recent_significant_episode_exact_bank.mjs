#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { loadConfig } from "../src/lib/config.mjs"
import { readJsonl, writeJson } from "../src/lib/io.mjs"
import { loadPerfectPrototypeCatalog } from "../src/lib/perfect_prototype_catalog.mjs"
import { buildPerfectPrototypeLow1dRecentEpisodeDataset } from "../src/lib/perfect_prototype_low_1d_recent_episode_dataset.mjs"
import { buildPerfectPrototypeLow1dRecentEpisodeExactBank } from "../src/lib/perfect_prototype_low_1d_recent_episode_exact_bank.mjs"

const DEFAULT_FAMILY_IDS = [
  "low_gap_top_continuation",
  "low_gap_high_continuation",
  "low_jump_below_continuation",
]

const usage = () => {
  console.error(`Usage:
  node tools/build_perfect_prototype_low_1d_recent_significant_episode_exact_bank.mjs \\
    --config=<config.json> \\
    --train-input=<daily_pack.jsonl> \\
    --oos-input=<daily_pack.jsonl> \\
    --out-dir=<dir> \\
    [--catalog=<catalog.json>]`)
}

const parseArgs = (argv) => {
  const args = {
    familyIds: DEFAULT_FAMILY_IDS.slice(),
    lookbackTradingDays: 4,
    minTrainDates: 4,
    minTrainMonths: 4,
    minTrainFolds: 3,
    minUnionDates: 10,
    minUnionMonths: 6,
    minUnionFolds: 4,
    minSelectionFrequency: 0.6,
    minFoldPresenceCount: 3,
    minWindowPresenceCount: 2,
    qValueThreshold: 0.05,
    maxEpisodeSeedTokens: 6,
    maxAdditionalEpisodeTokens: 2,
    maxUnionRules: 6,
    maxUnionRulesPerFamily: 2,
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
      case "oos-input":
        args.oosInput = value
        break
      case "catalog":
        args.catalogPath = value
        break
      case "out-dir":
        args.outDir = value
        break
      case "family-ids":
        args.familyIds = String(value ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
        break
      case "lookback-trading-days":
        args.lookbackTradingDays = Number(value)
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
      case "min-union-dates":
        args.minUnionDates = Number(value)
        break
      case "min-union-months":
        args.minUnionMonths = Number(value)
        break
      case "min-union-folds":
        args.minUnionFolds = Number(value)
        break
      case "min-selection-frequency":
        args.minSelectionFrequency = Number(value)
        break
      case "min-fold-presence-count":
        args.minFoldPresenceCount = Number(value)
        break
      case "min-window-presence-count":
        args.minWindowPresenceCount = Number(value)
        break
      case "q-value-threshold":
        args.qValueThreshold = Number(value)
        break
      case "max-episode-seed-tokens":
        args.maxEpisodeSeedTokens = Number(value)
        break
      case "max-additional-episode-tokens":
        args.maxAdditionalEpisodeTokens = Number(value)
        break
      case "max-union-rules":
        args.maxUnionRules = Number(value)
        break
      case "max-union-rules-per-family":
        args.maxUnionRulesPerFamily = Number(value)
        break
      default:
        throw new Error(`Unknown arg: --${key}`)
    }
  }
  if (!args.configPath || !args.trainInput || !args.oosInput || !args.outDir) {
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
    if (value == null) continue
    out[featureKey] = value
  }
  return out
}

const mergeNumericFeatureMaps = (...featureMaps) =>
  Object.assign({}, ...featureMaps.map((featureMap) => compactNumericFeatureMap(featureMap)))

const compactCategoricalTokens = (tokens) =>
  Array.from(new Set((Array.isArray(tokens) ? tokens : []).map((token) => String(token ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

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
          : false
  const categoricalTokens = compactCategoricalTokens([...(row?.categoricalTokens ?? []), ...(row?.contextualTokens ?? [])])
  const numericFeatureMap = mergeNumericFeatureMaps(
    row?.featureVec,
    row?.globalFeatureVec,
    row?.eventFeatureVec,
    row?.marketContextVec,
    row?.xsecEventVec,
    row?.numericFeatureMap,
  )
  return {
    sourceId: toText(row?.sourceId),
    rowKey: toText(row?.rowKey) ?? `${symbol}:${dateKey}:${toText(row?.targetDateKey) ?? "na"}`,
    symbol,
    dateKey,
    decisionDateKey: toText(row?.decisionDateKey) ?? dateKey,
    monthKey: toText(row?.monthKey) ?? (dateKey.length >= 7 ? dateKey.slice(0, 7) : null),
    targetDateKey:
      toText(row?.targetDateKey) ??
      toText(row?.eventOutcome?.entryDateKey) ??
      toText(row?.entryDateKey),
    foldId: toFiniteNumber(row?.foldId),
    windowId: toFiniteNumber(row?.windowId),
    outcomeHitTarget,
    seq40: compactSequence(row?.seq40),
    seq150: compactSequence(row?.seq150),
    featureVec: compactNumericFeatureMap(row?.featureVec),
    globalFeatureVec: compactNumericFeatureMap(row?.globalFeatureVec),
    eventFeatureVec: compactNumericFeatureMap(row?.eventFeatureVec),
    marketContextVec: compactNumericFeatureMap(row?.marketContextVec),
    xsecEventVec: compactNumericFeatureMap(row?.xsecEventVec),
    numericFeatureMap,
    contextualTokens: categoricalTokens,
    categoricalTokens,
    tokenSet: new Set(categoricalTokens),
  }
}

const loadJsonl = async (filePath) =>
  readJsonl(filePath, {
    strict: true,
    map: (row) => compactRow(row),
  })

const writeMarkdown = async (filePath, lines = []) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${Array.isArray(lines) ? lines.join("\n") : String(lines ?? "")}\n`, "utf8")
}

const summarizeCatalog = (catalog, familyIds) => {
  const rules = Array.isArray(catalog?.rules) ? catalog.rules : []
  return {
    ruleCount: rules.length,
    exactRuleCount: rules.filter((rule) => Number(rule?.precision ?? 0) >= 1).length,
    families: (Array.isArray(familyIds) ? familyIds : []).map((familyId) => ({
      familyId,
      totalRuleCount: rules.filter((rule) => String(rule?.familyId ?? "").trim() === familyId).length,
      exactRuleCount: rules.filter(
        (rule) => String(rule?.familyId ?? "").trim() === familyId && Number(rule?.precision ?? 0) >= 1,
      ).length,
    })),
  }
}

const summarizeCandidate = (candidate = {}) => ({
  familyId: candidate?.familyId ?? null,
  ruleId: candidate?.ruleId ?? null,
  ruleTokens: candidate?.ruleTokens ?? [],
  episodeTokens: candidate?.episodeTokens ?? [],
  trainSummary: candidate?.trainSummary ?? null,
  oosSummary: candidate?.oosSummary ?? null,
  selectionFrequency: Number(candidate?.selectionFrequency ?? 0),
  foldPresenceCount: Number(candidate?.foldPresenceCount ?? 0),
  windowPresenceCount: Number(candidate?.windowPresenceCount ?? 0),
  crossfitNegativeWindowCount: Number(candidate?.crossfitNegativeWindowCount ?? 0),
  pValue: Number(candidate?.pValue ?? 1),
  qValue: Number(candidate?.qValue ?? 1),
  significanceQualified: candidate?.significanceQualified === true,
  individualQualified: candidate?.individualQualified === true,
})

const summarizeQualifiedRule = (candidate = {}) => ({
  familyId: candidate?.familyId ?? null,
  ruleId: candidate?.ruleId ?? null,
  ruleTokens: candidate?.ruleTokens ?? [],
  episodeTokens: candidate?.episodeTokens ?? [],
  trainSummary: candidate?.trainSummary ?? null,
  oosSummary: candidate?.oosSummary ?? null,
  selectionFrequency: Number(candidate?.selectionFrequency ?? 0),
  qValue: Number(candidate?.qValue ?? 1),
  crossfitNegativeWindowCount: Number(candidate?.crossfitNegativeWindowCount ?? 0),
})

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const { config, configPath } = await loadConfig({ cwd, configPath: args.configPath })
  await fs.mkdir(args.outDir, { recursive: true })

  const [trainRows, oosRows, catalog] = await Promise.all([
    loadJsonl(args.trainInput),
    loadJsonl(args.oosInput),
    args.catalogPath ? loadPerfectPrototypeCatalog(args.catalogPath) : Promise.resolve(null),
  ])

  const episodeDataset = buildPerfectPrototypeLow1dRecentEpisodeDataset({
    trainRows,
    oosRows,
    familyIds: args.familyIds,
    lookbackTradingDays: args.lookbackTradingDays,
  })
  const exactBank = buildPerfectPrototypeLow1dRecentEpisodeExactBank({
    episodeDataset,
    minTrainDates: args.minTrainDates,
    minTrainMonths: args.minTrainMonths,
    minTrainFolds: args.minTrainFolds,
    minUnionDates: args.minUnionDates,
    minUnionMonths: args.minUnionMonths,
    minUnionFolds: args.minUnionFolds,
    minSelectionFrequency: args.minSelectionFrequency,
    minFoldPresenceCount: args.minFoldPresenceCount,
    minWindowPresenceCount: args.minWindowPresenceCount,
    qValueThreshold: args.qValueThreshold,
    maxEpisodeSeedTokens: args.maxEpisodeSeedTokens,
    maxAdditionalEpisodeTokens: args.maxAdditionalEpisodeTokens,
    maxUnionRules: args.maxUnionRules,
    maxUnionRulesPerFamily: args.maxUnionRulesPerFamily,
  })

  const datasetSummary = {
    generatedAt: new Date().toISOString(),
    configPath,
    baselineLineId: String(config?.lightweight?.stepB?.perfectPrototypeBaseline?.lineId ?? "").trim() || null,
    trainInput: path.resolve(args.trainInput),
    oosInput: path.resolve(args.oosInput),
    catalogPath: args.catalogPath ? path.resolve(args.catalogPath) : null,
    catalogSummary: catalog ? summarizeCatalog(catalog, args.familyIds) : null,
    episodeDataset: episodeDataset.summary,
  }
  const featureSummary = {
    familyTokenSummaries: (episodeDataset?.familyDatasets ?? []).map((familyDataset) => ({
      familyId: familyDataset?.familyId ?? null,
      episodeTokenCount: Number(familyDataset?.episodeTokenStats?.length ?? 0),
      topEpisodeTokens: (familyDataset?.episodeTokenStats ?? []).slice(0, 12),
      dateSummaries: (familyDataset?.dateSummaries ?? []).slice(0, 32),
    })),
  }
  const candidateSummary = {
    familyResults: (exactBank?.familyResults ?? []).map((familyResult) => ({
      familyId: familyResult?.familyId ?? null,
      candidateRuleCount: Number(familyResult?.candidateRuleCount ?? 0),
      candidates: (familyResult?.candidates ?? []).map((candidate) => summarizeCandidate(candidate)),
    })),
  }
  const stabilitySummary = {
    familyResults: (exactBank?.familyResults ?? []).map((familyResult) => ({
      familyId: familyResult?.familyId ?? null,
      candidates: (familyResult?.candidates ?? []).map((candidate) => ({
        familyId: candidate?.familyId ?? null,
        ruleId: candidate?.ruleId ?? null,
        selectionFrequency: Number(candidate?.selectionFrequency ?? 0),
        foldPresenceCount: Number(candidate?.foldPresenceCount ?? 0),
        windowPresenceCount: Number(candidate?.windowPresenceCount ?? 0),
        crossfitNegativeWindowCount: Number(candidate?.crossfitNegativeWindowCount ?? 0),
        stabilityQualified:
          Number(candidate?.selectionFrequency ?? 0) >= Number(args.minSelectionFrequency) &&
          Number(candidate?.foldPresenceCount ?? 0) >= Number(args.minFoldPresenceCount) &&
          Number(candidate?.windowPresenceCount ?? 0) >= Number(args.minWindowPresenceCount),
      })),
    })),
  }
  const significanceSummary = {
    familyResults: (exactBank?.familyResults ?? []).map((familyResult) => ({
      familyId: familyResult?.familyId ?? null,
      candidates: (familyResult?.candidates ?? []).map((candidate) => ({
        familyId: candidate?.familyId ?? null,
        ruleId: candidate?.ruleId ?? null,
        pValue: Number(candidate?.pValue ?? 1),
        qValue: Number(candidate?.qValue ?? 1),
        significanceQualified: candidate?.significanceQualified === true,
      })),
    })),
  }
  const qualifiedRuleBank = {
    ok: Array.isArray(exactBank?.qualifiedRules) && exactBank.qualifiedRules.length > 0,
    qualifiedRuleCount: Number(exactBank?.qualifiedRules?.length ?? 0),
    rules: (exactBank?.qualifiedRules ?? []).map((candidate) => summarizeQualifiedRule(candidate)),
  }
  const unionSelectionSummary = {
    ok: exactBank?.unionSelection?.ok === true,
    reason: exactBank?.unionSelection?.reason ?? null,
    selectedRuleCount: Number(exactBank?.unionSelection?.selectedRuleCount ?? 0),
    selectedRuleIds: exactBank?.unionSelection?.selectedRuleIds ?? [],
    unionTrainSummary: exactBank?.unionSelection?.unionTrainSummary ?? null,
    unionOosSummary: exactBank?.unionSelection?.unionOosSummary ?? null,
    rules: (exactBank?.unionSelection?.selectedRules ?? []).map((candidate) => summarizeQualifiedRule(candidate)),
  }
  const oosUnionReport = {
    ok: exactBank?.ok === true,
    reason: exactBank?.reason ?? null,
    unionOosSummary: exactBank?.unionSelection?.unionOosSummary ?? null,
    unionTrainSummary: exactBank?.unionSelection?.unionTrainSummary ?? null,
  }

  await Promise.all([
    writeJson(path.join(args.outDir, "episode_dataset_summary.json"), datasetSummary),
    writeJson(path.join(args.outDir, "episode_feature_summary.json"), featureSummary),
    writeJson(path.join(args.outDir, "candidate_rule_recheck.json"), candidateSummary),
    writeJson(path.join(args.outDir, "rule_stability_summary.json"), stabilitySummary),
    writeJson(path.join(args.outDir, "rule_significance_summary.json"), significanceSummary),
    writeJson(path.join(args.outDir, "qualified_rule_bank.json"), qualifiedRuleBank),
    writeJson(path.join(args.outDir, "union_selection_summary.json"), unionSelectionSummary),
    writeJson(path.join(args.outDir, "oos_union_report.json"), oosUnionReport),
  ])
  if (exactBank?.reason) {
    await writeJson(path.join(args.outDir, `${exactBank.reason}.json`), {
      ok: false,
      reason: exactBank.reason,
      summary: exactBank.summary,
    })
  }

  await writeMarkdown(path.join(args.outDir, "report.md"), [
    "# v60a LOW 1D recent significant episode exact bank",
    "",
    `- generatedAt: ${datasetSummary.generatedAt}`,
    `- baselineLineId: ${datasetSummary.baselineLineId ?? "null"}`,
    `- familyCount: ${Number(episodeDataset?.summary?.familyCount ?? 0)}`,
    `- readyFamilyCount: ${Number(episodeDataset?.summary?.readyFamilyCount ?? 0)}`,
    `- candidateRuleCount: ${Number(exactBank?.summary?.candidateRuleCount ?? 0)}`,
    `- qualifiedRuleCount: ${Number(exactBank?.summary?.qualifiedRuleCount ?? 0)}`,
    `- selectedUnionRuleCount: ${Number(exactBank?.summary?.selectedUnionRuleCount ?? 0)}`,
    `- unionTrainPrecision: ${Number(exactBank?.summary?.unionTrainSummary?.precision ?? 0).toFixed(4)}`,
    `- unionTrainDates: ${Number(exactBank?.summary?.unionTrainSummary?.matchedDateCount ?? 0)}`,
    `- unionTrainMonths: ${Number(exactBank?.summary?.unionTrainSummary?.matchedMonthCount ?? 0)}`,
    `- unionTrainFolds: ${Number(exactBank?.summary?.unionTrainSummary?.matchedFoldCount ?? 0)}`,
    `- finalStatus: ${exactBank?.ok === true ? "success" : exactBank?.reason ?? "invalid_or_inconclusive"}`,
  ])
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
