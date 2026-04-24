import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { parseCliArgs, getFlag } from "../src/lib/args.mjs"
import { ensureDir, readJson, readJsonl, writeJson } from "../src/lib/io.mjs"
import { loadPerfectPrototypeCatalog } from "../src/lib/perfect_prototype_catalog.mjs"
import {
  evaluatePerfectPrototypeRuleSupportCases,
  normalizePerfectPrototypeSupportCases,
} from "../src/lib/perfect_prototype_support_case.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const toNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const serializeJsonForFileHash = (value) => `${JSON.stringify(value ?? null, null, 2)}\n`

const sha256JsonFilePayload = (value) =>
  crypto.createHash("sha256").update(serializeJsonForFileHash(value)).digest("hex")

const resolveOutcomeHitTarget = (row) => {
  if (typeof row?.outcomeHitTarget === "boolean") return row.outcomeHitTarget
  if (typeof row?.eventOutcome?.hitTarget === "boolean") return row.eventOutcome.hitTarget
  return null
}

const readEvaluationBundle = async (dirPath) => ({
  summary: await readJson(path.join(dirPath, "oos_summary.json"), null),
  ruleReport: await readJson(path.join(dirPath, "oos_rule_report.json"), null),
  matches: await readJsonl(path.join(dirPath, "oos_matches.jsonl")),
  dedupedMatches: await readJsonl(path.join(dirPath, "oos_deduped_symbols.jsonl")),
})

const readApplyBundle = async (dirPath) => ({
  summary: await readJson(path.join(dirPath, "summary.json"), null),
  matches: await readJsonl(path.join(dirPath, "matches.jsonl")),
  dedupedMatches: await readJsonl(path.join(dirPath, "deduped_symbols.jsonl")),
})

const buildRuleReportLookup = (ruleReport) =>
  new Map((Array.isArray(ruleReport) ? ruleReport : []).map((row) => [String(row?.ruleId ?? "").trim(), row]))

const buildRuleMatchLookup = (matches) => {
  const lookup = new Map()
  for (const row of Array.isArray(matches) ? matches : []) {
    const matchedRuleIds = Array.isArray(row?.matchedRuleIds) ? row.matchedRuleIds : []
    const outcomeHitTarget = resolveOutcomeHitTarget(row)
    for (const rawRuleId of matchedRuleIds) {
      const ruleId = String(rawRuleId ?? "").trim()
      if (!ruleId) continue
      const current = lookup.get(ruleId) ?? {
        rawMatchedRows: 0,
        hitCount: 0,
        negativeCount: 0,
        uniqueDates: new Set(),
        uniqueSymbols: new Set(),
      }
      current.rawMatchedRows += 1
      if (outcomeHitTarget === true) current.hitCount += 1
      if (outcomeHitTarget === false) current.negativeCount += 1
      if (row?.dateKey) current.uniqueDates.add(String(row.dateKey))
      if (row?.symbol) current.uniqueSymbols.add(String(row.symbol))
      lookup.set(ruleId, current)
    }
  }
  return lookup
}

const buildPrecision = (hitCount, matchCount) => (matchCount > 0 ? hitCount / matchCount : 0)

const hasTokenPrefix = (tokens, prefix) =>
  (Array.isArray(tokens) ? tokens : []).some((token) =>
    String(token ?? "").trim().toLowerCase().startsWith(String(prefix ?? "").trim().toLowerCase()),
  )

const quoteCsv = (value) => {
  const text = String(value ?? "")
  if (!/[",\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

const buildCsv = (rows, columns) => {
  const header = columns.join(",")
  const lines = (Array.isArray(rows) ? rows : []).map((row) =>
    columns.map((column) => quoteCsv(row?.[column] ?? "")).join(","),
  )
  return `${[header, ...lines].join("\n")}\n`
}

const buildConcentrationRows = ({ rows, field, topN }) => {
  const counts = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.[field] ?? "").trim()
    if (!key) continue
    counts.set(key, Number(counts.get(key) ?? 0) + 1)
  }
  const total = Array.from(counts.values()).reduce((sum, value) => sum + Number(value ?? 0), 0)
  return Array.from(counts.entries())
    .map(([key, count]) => ({
      [field]: key,
      matchedRows: count,
      share: total > 0 ? count / total : 0,
    }))
    .sort((left, right) => {
      if (right.matchedRows !== left.matchedRows) return right.matchedRows - left.matchedRows
      return String(left[field]).localeCompare(String(right[field]))
    })
    .slice(0, topN)
}

const sumShares = (rows) =>
  (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + toNumber(row?.share, 0), 0)

const buildBundleOverlapRate = ({ rawDedupedMatches, close28DedupedMatches }) => {
  const rawKeys = new Set(
    (Array.isArray(rawDedupedMatches) ? rawDedupedMatches : []).map((row) =>
      `${String(row?.dateKey ?? "").trim()}::${String(row?.symbol ?? "").trim()}`,
    ),
  )
  const closeKeys = new Set(
    (Array.isArray(close28DedupedMatches) ? close28DedupedMatches : []).map((row) =>
      `${String(row?.dateKey ?? "").trim()}::${String(row?.symbol ?? "").trim()}`,
    ),
  )
  if (rawKeys.size < 1) return 0
  let overlap = 0
  for (const key of closeKeys) {
    if (rawKeys.has(key)) overlap += 1
  }
  return overlap / rawKeys.size
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const catalogPath = path.resolve(String(getFlag(parsed.flags, "catalog", "")).trim())
  const trainInputPath = path.resolve(String(getFlag(parsed.flags, "train-input", "")).trim())
  const trainReportDir = path.resolve(String(getFlag(parsed.flags, "train-report-dir", "")).trim())
  const trainApplyRawDir = path.resolve(String(getFlag(parsed.flags, "train-apply-raw-dir", "")).trim())
  const trainApplyClose28Dir = path.resolve(String(getFlag(parsed.flags, "train-apply-close28-dir", "")).trim())
  const oosInputPath = path.resolve(String(getFlag(parsed.flags, "oos-input", "")).trim())
  const oosReportDir = path.resolve(String(getFlag(parsed.flags, "oos-report-dir", "")).trim())
  const oosApplyRawDir = path.resolve(String(getFlag(parsed.flags, "oos-apply-raw-dir", "")).trim())
  const oosApplyClose28Dir = path.resolve(String(getFlag(parsed.flags, "oos-apply-close28-dir", "")).trim())
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  const supportCasesFile = toText(getFlag(parsed.flags, "support-cases-file", ""))
  if (
    !catalogPath ||
    !trainInputPath ||
    !trainReportDir ||
    !trainApplyRawDir ||
    !trainApplyClose28Dir ||
    !oosInputPath ||
    !oosReportDir ||
    !oosApplyRawDir ||
    !oosApplyClose28Dir ||
    !outDir
  ) {
    throw new Error(
      "Usage: node tools/report_stepb_plus_lite_open_eval_leaderboard.mjs --catalog=<catalog.json> --train-input=<daily_pack.jsonl> --train-report-dir=<dir> --train-apply-raw-dir=<dir> --train-apply-close28-dir=<dir> --oos-input=<daily_pack.jsonl> --oos-report-dir=<dir> --oos-apply-raw-dir=<dir> --oos-apply-close28-dir=<dir> --out-dir=<dir> [--support-cases-file=<support_cases.json>]",
    )
  }

  await ensureDir(outDir)
  const catalog = await loadPerfectPrototypeCatalog(catalogPath, { requireFrozen: true })
  const generalizedSubgroupEnabled = catalog?.metadata?.enableSubgroupPrepass === true
  const generalizedSubgroupEffectiveRootSeedCountRaw =
    catalog?.metadata?.subgroupEffectiveRootSeedCount
  const generalizedSubgroupEffectiveRootSeedCount = Number(
    generalizedSubgroupEffectiveRootSeedCountRaw,
  )
  if (
    generalizedSubgroupEnabled &&
    !Number.isFinite(generalizedSubgroupEffectiveRootSeedCount)
  ) {
    throw new Error("generalized subgroup catalog is missing subgroupEffectiveRootSeedCount telemetry")
  }
  const supportCasesPayload = supportCasesFile ? await readJson(path.resolve(supportCasesFile), null) : null
  const supportCases = normalizePerfectPrototypeSupportCases(
    Array.isArray(supportCasesPayload?.supportCases)
      ? supportCasesPayload.supportCases
      : Array.isArray(supportCasesPayload?.cases)
        ? supportCasesPayload.cases
        : [],
  )
  if (supportCasesFile && supportCases.length < 1) {
    throw new Error(`support-cases-file resolved zero support cases: ${supportCasesFile}`)
  }
  const trainEvalBundle = await readEvaluationBundle(trainReportDir)
  const oosEvalBundle = await readEvaluationBundle(oosReportDir)
  const trainApplyRawBundle = await readApplyBundle(trainApplyRawDir)
  const trainApplyClose28Bundle = await readApplyBundle(trainApplyClose28Dir)
  const oosApplyRawBundle = await readApplyBundle(oosApplyRawDir)
  const oosApplyClose28Bundle = await readApplyBundle(oosApplyClose28Dir)

  const bundleSelectionMode = uniqueSorted([
    trainEvalBundle.summary?.selectionMode,
    oosEvalBundle.summary?.selectionMode,
    trainApplyRawBundle.summary?.selectionMode,
    trainApplyClose28Bundle.summary?.selectionMode,
    oosApplyRawBundle.summary?.selectionMode,
    oosApplyClose28Bundle.summary?.selectionMode,
  ].filter(Boolean))
  if (bundleSelectionMode.length > 1) {
    throw new Error(`open-eval bundle selectionMode mismatch: ${bundleSelectionMode.join(", ")}`)
  }

  const expectedCatalogSha256 = toText(catalog?.metadata?.catalogContentSha256)
  const expectedRuleIdsSha256 = toText(catalog?.metadata?.ruleIdsSha256)
  for (const [label, summary] of [
    ["trainEval", trainEvalBundle.summary],
    ["oosEval", oosEvalBundle.summary],
    ["trainApplyRaw", trainApplyRawBundle.summary],
    ["trainApplyClose28", trainApplyClose28Bundle.summary],
    ["oosApplyRaw", oosApplyRawBundle.summary],
    ["oosApplyClose28", oosApplyClose28Bundle.summary],
  ]) {
    if (toText(summary?.catalogContentSha256) !== expectedCatalogSha256) {
      throw new Error(`${label} catalogContentSha256 mismatch`)
    }
    if (toText(summary?.ruleIdsSha256) !== expectedRuleIdsSha256) {
      throw new Error(`${label} ruleIdsSha256 mismatch`)
    }
  }

  const trainRuleReportLookup = buildRuleReportLookup(trainEvalBundle.ruleReport)
  const oosRuleReportLookup = buildRuleReportLookup(oosEvalBundle.ruleReport)
  const trainRawMatchLookup = buildRuleMatchLookup(trainApplyRawBundle.matches)
  const trainClose28MatchLookup = buildRuleMatchLookup(trainApplyClose28Bundle.matches)
  const oosRawMatchLookup = buildRuleMatchLookup(oosApplyRawBundle.matches)
  const oosClose28MatchLookup = buildRuleMatchLookup(oosApplyClose28Bundle.matches)

  const leaderboard = (Array.isArray(catalog?.rules) ? catalog.rules : []).map((rule) => {
    const ruleId = String(rule?.ruleId ?? "").trim()
    const trainEval = trainRuleReportLookup.get(ruleId) ?? {}
    const oosEval = oosRuleReportLookup.get(ruleId) ?? {}
    const trainRaw = trainRawMatchLookup.get(ruleId) ?? {}
    const trainClose28 = trainClose28MatchLookup.get(ruleId) ?? {}
    const oosRaw = oosRawMatchLookup.get(ruleId) ?? {}
    const oosClose28 = oosClose28MatchLookup.get(ruleId) ?? {}
    const supportEvaluation = evaluatePerfectPrototypeRuleSupportCases({
      rule,
      supportCases,
    })
    const openTrainMatchCount = toNumber(trainEval?.oosMatchCount, 0)
    const openTrainHitCount = toNumber(trainEval?.oosHitCount, 0)
    const openTrainNegativeCount = toNumber(trainEval?.oosNegativeCount, 0)
    const openOosMatchCount = toNumber(oosEval?.oosMatchCount, 0)
    const openOosHitCount = toNumber(oosEval?.oosHitCount, 0)
    const openOosNegativeCount = toNumber(oosEval?.oosNegativeCount, 0)
    const row = {
      ruleId,
      familyId: toText(rule?.familyId),
      tokens: Array.isArray(rule?.tokens) ? rule.tokens : [],
      ruleSize: Number(rule?.ruleSize ?? (Array.isArray(rule?.tokens) ? rule.tokens.length : 0)) || 0,
      trainMatchedDateCount: toNumber(rule?.matchedDateCount, 0),
      trainMatchedMonthCount: toNumber(rule?.matchedMonthCount, 0),
      trainMatchedFoldCount: toNumber(rule?.matchedFoldCount, 0),
      discoveryTrainMatchCount: toNumber(rule?.trainMatchCount, 0),
      discoveryTrainHitCount: toNumber(rule?.trainHitCount, 0),
      discoveryTrainNegativeCount: toNumber(rule?.trainNegativeCount, 0),
      discoveryTrainPrecision: Number.isFinite(Number(rule?.precision))
        ? Number(rule.precision)
        : buildPrecision(toNumber(rule?.trainHitCount, 0), toNumber(rule?.trainMatchCount, 0)),
      openTrainMatchCount,
      openTrainHitCount,
      openTrainNegativeCount,
      openTrainPrecision: buildPrecision(openTrainHitCount, openTrainMatchCount),
      openTrainUniqueMatchedDates: toNumber(trainRaw?.uniqueDates?.size, 0),
      openTrainUniqueMatchedSymbols: toNumber(trainRaw?.uniqueSymbols?.size, 0),
      openTrainRawMatchedRows: toNumber(trainRaw?.rawMatchedRows, 0),
      openTrainClose28MatchedRows: toNumber(trainClose28?.rawMatchedRows, 0),
      openTrainClose28Delta:
        toNumber(trainRaw?.rawMatchedRows, 0) - toNumber(trainClose28?.rawMatchedRows, 0),
      openTrainMaxGapTradingDays: toNumber(trainEval?.oosMaxGapTradingDays, 0),
      openTrainFirstHitDate: toText(trainEval?.oosFirstHitDate),
      openTrainLastHitDate: toText(trainEval?.oosLastHitDate),
      openTrainHitDateCount: toNumber(trainEval?.oosHitDateCount, 0),
      openTrainMatchedDateCount: toNumber(trainEval?.oosMatchedDateCount, 0),
      openOosMatchCount,
      openOosHitCount,
      openOosNegativeCount,
      openOosPrecision: buildPrecision(openOosHitCount, openOosMatchCount),
      openOosUniqueMatchedDates: toNumber(oosRaw?.uniqueDates?.size, 0),
      openOosUniqueMatchedSymbols: toNumber(oosRaw?.uniqueSymbols?.size, 0),
      openOosRawMatchedRows: toNumber(oosRaw?.rawMatchedRows, 0),
      openOosClose28MatchedRows: toNumber(oosClose28?.rawMatchedRows, 0),
      openOosClose28Delta:
        toNumber(oosRaw?.rawMatchedRows, 0) - toNumber(oosClose28?.rawMatchedRows, 0),
      openOosMaxGapTradingDays: toNumber(oosEval?.oosMaxGapTradingDays, 0),
      openOosFirstHitDate: toText(oosEval?.oosFirstHitDate),
      openOosLastHitDate: toText(oosEval?.oosLastHitDate),
      openOosHitDateCount: toNumber(oosEval?.oosHitDateCount, 0),
      openOosMatchedDateCount: toNumber(oosEval?.oosMatchedDateCount, 0),
      matchesSupportCases: supportEvaluation.matchesSupportCases,
      supportCaseIds: supportEvaluation.supportCaseIds,
      supportCaseCount: supportEvaluation.supportCaseCount,
      haesungSupport: supportEvaluation.haesungSupport,
      generalizedSubgroupId: toText(rule?.generalizedSubgroupId),
      generalizedSubgroupBundleAxes: Array.isArray(rule?.generalizedSubgroupBundleAxes)
        ? rule.generalizedSubgroupBundleAxes
        : [],
      generalizedSubgroupBundleTokenCount: toNumber(rule?.generalizedSubgroupBundleTokenCount, 0),
      generalizedSubgroupMatchedDateCount: toNumber(rule?.generalizedSubgroupMatchedDateCount, 0),
      generalizedSubgroupMatchedMonthCount: toNumber(rule?.generalizedSubgroupMatchedMonthCount, 0),
      generalizedSubgroupMatchedFoldCount: toNumber(rule?.generalizedSubgroupMatchedFoldCount, 0),
      generalizedSubgroupCoverageShare: toNumber(rule?.generalizedSubgroupCoverageShare, 0),
      generalizedSubgroupPrecision: toNumber(rule?.generalizedSubgroupPrecision, 0),
      generalizedSubgroupTpLift: toNumber(rule?.generalizedSubgroupTpLift, 0),
      generalizedSubgroupWracc: toNumber(rule?.generalizedSubgroupWracc, 0),
      generalizedSubgroupFpPenalty: toNumber(rule?.generalizedSubgroupFpPenalty, 0),
      generalizedSubgroupTop1DateHitShare: toNumber(rule?.generalizedSubgroupTop1DateHitShare, 0),
      generalizedSubgroupSelectionFrequency: Number(rule?.generalizedSubgroupSelectionFrequency ?? 0) || 0,
      generalizedSubgroupFoldPresenceCount: toNumber(rule?.generalizedSubgroupFoldPresenceCount, 0),
      generalizedSubgroupWindowPresenceCount: toNumber(rule?.generalizedSubgroupWindowPresenceCount, 0),
      exactCompletionSolved: rule?.exactCompletionSolved === true,
      exactCompletionMode: toText(rule?.exactCompletionMode),
      exactCompletionAddedTokenCount: toNumber(rule?.exactCompletionAddedTokenCount, 0),
      exactCompletionCandidatePoolSize: toNumber(rule?.exactCompletionCandidatePoolSize, 0),
      exactCompletionNegativeFrontierSize: toNumber(rule?.exactCompletionNegativeFrontierSize, 0),
      exactCompletionSubgroupId: toText(rule?.exactCompletionSubgroupId),
      crossfitWindowCount: toNumber(rule?.crossfitWindowCount, 0),
      crossfitMatchedWindowCount: toNumber(rule?.crossfitMatchedWindowCount, 0),
      crossfitNegativeWindowCount: toNumber(rule?.crossfitNegativeWindowCount, 0),
      crossfitFalsePositiveRowCount: toNumber(rule?.crossfitFalsePositiveRowCount, 0),
      hardNegativeAddedCount: toNumber(rule?.hardNegativeAddedCount, 0),
      hardNegativeRefined: rule?.hardNegativeRefined === true,
      postRefineTrainMatchedDateCount: toNumber(rule?.postRefineTrainMatchedDateCount, 0),
      postRefineTrainMatchedMonthCount: toNumber(rule?.postRefineTrainMatchedMonthCount, 0),
      postRefineTrainMatchedFoldCount: toNumber(rule?.postRefineTrainMatchedFoldCount, 0),
      jointFeasibilitySolved: rule?.jointFeasibilitySolved === true,
      jointUnsatReason: toText(rule?.jointUnsatReason),
      jointHistoricalSupportMatched: rule?.jointHistoricalSupportMatched === true,
      jointHistoricalSupportCaseIds: Array.isArray(rule?.jointHistoricalSupportCaseIds)
        ? rule.jointHistoricalSupportCaseIds
        : [],
      jointCrossfitRetainedPositiveWindowCount: toNumber(
        rule?.jointCrossfitRetainedPositiveWindowCount,
        0,
      ),
      jointCrossfitNegativeWindowCount: toNumber(rule?.jointCrossfitNegativeWindowCount, 0),
      candidateAtomTypeCounts:
        rule?.candidateAtomTypeCounts && typeof rule.candidateAtomTypeCounts === "object"
          ? { ...rule.candidateAtomTypeCounts }
          : {},
      supportSignatureAtomCount: toNumber(rule?.supportSignatureAtomCount, 0),
      adaptiveThresholdAtomCount: toNumber(rule?.adaptiveThresholdAtomCount, 0),
      intervalAtomCount: toNumber(rule?.intervalAtomCount, 0),
      macroAtomCount: toNumber(rule?.macroAtomCount, 0),
      supportAnchorAtomCount: toNumber(rule?.supportAnchorAtomCount, 0),
      tpRegimeTagPresent:
        hasTokenPrefix(rule?.tokens, "tag:lowGapTop.retentionRegime:") ||
        hasTokenPrefix(rule?.tokens, "tag:lowGapTop.gapContinuationRegime:") ||
        hasTokenPrefix(rule?.tokens, "tag:lowGapTop.volumeRegime:") ||
        hasTokenPrefix(rule?.tokens, "tag:lowGapTop.trendRegime:") ||
        hasTokenPrefix(rule?.tokens, "tag:lowGapTop.isolationRegime:") ||
        hasTokenPrefix(rule?.tokens, "tag:lowGapTop.bodyWickRegime:"),
      fpRiskTagPresent: hasTokenPrefix(rule?.tokens, "tag:lowGapTop.fpRisk:"),
      generalizedQualified:
        String(rule?.familyId ?? "").trim() === "low_gap_top_continuation" &&
        toNumber(rule?.matchedDateCount, 0) >= 10 &&
        toNumber(rule?.matchedMonthCount, 0) >= 6 &&
        toNumber(rule?.matchedFoldCount, 0) >= 4,
      oosPerfectQualified:
        supportEvaluation.haesungSupport === true &&
        buildPrecision(openOosHitCount, openOosMatchCount) === 1 &&
        openOosMatchCount >= 3 &&
        toNumber(oosEval?.oosMatchedDateCount, 0) >= 3,
      postRefineOosPerfectQualified:
        rule?.hardNegativeRefined === true &&
        supportEvaluation.haesungSupport === true &&
        buildPrecision(openOosHitCount, openOosMatchCount) === 1 &&
        openOosMatchCount >= 3 &&
        toNumber(oosEval?.oosMatchedDateCount, 0) >= 3,
    }
    return {
      ...row,
      rawMatchedRows: row.openOosRawMatchedRows,
      close28MatchedRows: row.openOosClose28MatchedRows,
      close28Delta: row.openOosClose28Delta,
    }
  })
    .sort((left, right) => {
      if (right.openOosPrecision !== left.openOosPrecision) return right.openOosPrecision - left.openOosPrecision
      if (right.openOosHitCount !== left.openOosHitCount) return right.openOosHitCount - left.openOosHitCount
      if (right.openOosUniqueMatchedDates !== left.openOosUniqueMatchedDates) {
        return right.openOosUniqueMatchedDates - left.openOosUniqueMatchedDates
      }
      if (right.openOosUniqueMatchedSymbols !== left.openOosUniqueMatchedSymbols) {
        return right.openOosUniqueMatchedSymbols - left.openOosUniqueMatchedSymbols
      }
      if (right.openOosRawMatchedRows !== left.openOosRawMatchedRows) {
        return right.openOosRawMatchedRows - left.openOosRawMatchedRows
      }
      if (left.ruleSize !== right.ruleSize) return left.ruleSize - right.ruleSize
      return String(left.ruleId).localeCompare(String(right.ruleId))
    })
    .map((row, index) => ({
      ...row,
      selectionRank: index + 1,
    }))

  const selectionLeaderboard = leaderboard.slice()
  const familySummary = Array.from(
    leaderboard.reduce((acc, row) => {
      const familyId = toText(row?.familyId) ?? "unclassified"
      const current = acc.get(familyId) ?? {
        familyId,
        ruleCount: 0,
        openOosMatchedRules: 0,
        openOosHitCount: 0,
        openOosMatchCount: 0,
        openOosZeroNegativeRules: 0,
        maxOpenOosPrecision: 0,
      }
      current.ruleCount += 1
      current.openOosHitCount += toNumber(row?.openOosHitCount, 0)
      current.openOosMatchCount += toNumber(row?.openOosMatchCount, 0)
      if (toNumber(row?.openOosMatchCount, 0) > 0) current.openOosMatchedRules += 1
      if (toNumber(row?.openOosMatchCount, 0) > 0 && toNumber(row?.openOosNegativeCount, 0) === 0) {
        current.openOosZeroNegativeRules += 1
      }
      current.maxOpenOosPrecision = Math.max(current.maxOpenOosPrecision, toNumber(row?.openOosPrecision, 0))
      acc.set(familyId, current)
      return acc
    }, new Map()).values(),
  )
    .map((row) => ({
      ...row,
      openOosPrecision:
        row.openOosMatchCount > 0 ? row.openOosHitCount / row.openOosMatchCount : 0,
    }))
    .sort((left, right) => {
      if (right.openOosPrecision !== left.openOosPrecision) return right.openOosPrecision - left.openOosPrecision
      if (right.openOosHitCount !== left.openOosHitCount) return right.openOosHitCount - left.openOosHitCount
      return String(left.familyId).localeCompare(String(right.familyId))
    })
  const leaderboardColumns = [
    "selectionRank",
    "ruleId",
    "familyId",
    "ruleSize",
    "trainMatchedDateCount",
    "trainMatchedMonthCount",
    "trainMatchedFoldCount",
    "discoveryTrainMatchCount",
    "discoveryTrainHitCount",
    "discoveryTrainNegativeCount",
    "discoveryTrainPrecision",
    "openTrainMatchCount",
    "openTrainHitCount",
    "openTrainNegativeCount",
    "openTrainPrecision",
    "openTrainUniqueMatchedDates",
    "openTrainUniqueMatchedSymbols",
    "openTrainRawMatchedRows",
    "openTrainClose28MatchedRows",
    "openTrainClose28Delta",
    "openOosMatchCount",
    "openOosHitCount",
    "openOosNegativeCount",
    "openOosPrecision",
    "openOosUniqueMatchedDates",
    "openOosUniqueMatchedSymbols",
    "openOosRawMatchedRows",
    "openOosClose28MatchedRows",
    "openOosClose28Delta",
    "supportCaseIds",
    "supportCaseCount",
    "haesungSupport",
    "tpRegimeTagPresent",
    "fpRiskTagPresent",
    "generalizedQualified",
    "exactCompletionSolved",
    "exactCompletionMode",
    "exactCompletionAddedTokenCount",
    "exactCompletionCandidatePoolSize",
    "exactCompletionNegativeFrontierSize",
    "crossfitWindowCount",
    "crossfitMatchedWindowCount",
    "crossfitNegativeWindowCount",
    "crossfitFalsePositiveRowCount",
    "hardNegativeAddedCount",
    "hardNegativeRefined",
    "postRefineTrainMatchedDateCount",
    "postRefineTrainMatchedMonthCount",
    "postRefineTrainMatchedFoldCount",
    "jointFeasibilitySolved",
    "jointUnsatReason",
    "jointHistoricalSupportMatched",
    "jointHistoricalSupportCaseIds",
    "jointCrossfitRetainedPositiveWindowCount",
    "jointCrossfitNegativeWindowCount",
    "postRefineOosPerfectQualified",
    "oosPerfectQualified",
  ]

  const oosRawTopDates = buildConcentrationRows({
    rows: oosApplyRawBundle.dedupedMatches,
    field: "dateKey",
    topN: 5,
  })
  const oosRawTopSymbols = buildConcentrationRows({
    rows: oosApplyRawBundle.dedupedMatches,
    field: "symbol",
    topN: 10,
  })
  const oosClose28TopDates = buildConcentrationRows({
    rows: oosApplyClose28Bundle.dedupedMatches,
    field: "dateKey",
    topN: 5,
  })
  const oosClose28TopSymbols = buildConcentrationRows({
    rows: oosApplyClose28Bundle.dedupedMatches,
    field: "symbol",
    topN: 10,
  })

const selectionGuardrailSummary = {
    runId: toText(getFlag(parsed.flags, "run-id", "")),
    lineId: toText(getFlag(parsed.flags, "line-id", "")),
    splitPolicy: toText(getFlag(parsed.flags, "split-policy", "")),
    selectionMode: bundleSelectionMode[0] ?? null,
    surface: toText(catalog?.tokenizerSpec?.surface),
    discoveryUniverseId: toText(catalog?.metadata?.datasetContract?.discoveryUniverseId),
    requestedLookbackTradingDays: toNumber(catalog?.metadata?.datasetContract?.requestedLookbackTradingDays, null),
    enabledRecentImpulseLanes: Array.isArray(catalog?.metadata?.datasetContract?.enabledRecentImpulseLanes)
      ? catalog.metadata.datasetContract.enabledRecentImpulseLanes.slice()
      : [],
    allowedStepALanes: Array.isArray(catalog?.metadata?.datasetContract?.allowedStepALanes)
      ? catalog.metadata.datasetContract.allowedStepALanes.slice()
      : [],
    includeSameDayHigh8:
      catalog?.metadata?.datasetContract?.includeSameDayHigh8 === true
        ? true
        : catalog?.metadata?.datasetContract?.includeSameDayHigh8 === false
          ? false
          : null,
    familyCount: familySummary.length,
    supportCasesFile: supportCasesFile ? path.resolve(supportCasesFile) : null,
    supportCaseIds: supportCases.map((entry) => entry.caseId),
    supportCaseCount: supportCases.length,
    generalizedSubgroupEnabled,
    subgroupMinMatchedDates: toNumber(catalog?.metadata?.subgroupMinMatchedDates, null),
    subgroupMinMatchedMonths: toNumber(catalog?.metadata?.subgroupMinMatchedMonths, null),
    subgroupMinMatchedFolds: toNumber(catalog?.metadata?.subgroupMinMatchedFolds, null),
    subgroupEffectiveRootSeedCount: generalizedSubgroupEffectiveRootSeedCount,
    subgroupManifestCandidateCount: toNumber(catalog?.metadata?.subgroupManifestCandidateCount, 0),
    subgroupStableManifestCount: toNumber(catalog?.metadata?.subgroupStableManifestCount, 0),
    subgroupDiverseManifestCount: toNumber(catalog?.metadata?.subgroupDiverseManifestCount, 0),
    subgroupPrefixPruneCount: toNumber(catalog?.metadata?.subgroupPrefixPruneCount, 0),
    exactCompletionManifestCount: toNumber(catalog?.metadata?.exactCompletionManifestCount, 0),
    exactCompletionSolvedCount: toNumber(catalog?.metadata?.exactCompletionSolvedCount, 0),
    exactCompletionUnsatCount: toNumber(catalog?.metadata?.exactCompletionUnsatCount, 0),
    exactCompletionCollectedRuleCount: toNumber(
      catalog?.metadata?.exactCompletionCollectedRuleCount,
      0,
    ),
    crossfitWindowCount: toNumber(catalog?.metadata?.crossfitWindowCount, 0),
    crossfitMatchedWindowCount: toNumber(catalog?.metadata?.crossfitMatchedWindowCount, 0),
    crossfitNegativeWindowCount: toNumber(catalog?.metadata?.crossfitNegativeWindowCount, 0),
    crossfitFalsePositiveRowCount: toNumber(catalog?.metadata?.crossfitFalsePositiveRowCount, 0),
    hardNegativeAddedCount: toNumber(catalog?.metadata?.hardNegativeAddedCount, 0),
    catalogHardNegativeRefinedRuleCount: toNumber(
      catalog?.metadata?.hardNegativeRefinedRuleCount,
      0,
    ),
    jointFeasibilityManifestCount: toNumber(
      catalog?.metadata?.jointFeasibilityManifestCount,
      0,
    ),
    jointFeasibilitySolvedCount: toNumber(
      catalog?.metadata?.jointFeasibilitySolvedCount,
      0,
    ),
    jointFeasibilityUnsatCount: toNumber(
      catalog?.metadata?.jointFeasibilityUnsatCount,
      0,
    ),
    jointFeasibilityUnsatReasonCounts:
      catalog?.metadata?.jointFeasibilityUnsatReasonCounts ?? {},
    jointHistoricalSupportMatchedCount: toNumber(
      catalog?.metadata?.jointHistoricalSupportMatchedCount,
      0,
    ),
    jointCrossfitRetainedPositiveWindowCount: toNumber(
      catalog?.metadata?.jointCrossfitRetainedPositiveWindowCount,
      0,
    ),
    jointCrossfitNegativeWindowCount: toNumber(
      catalog?.metadata?.jointCrossfitNegativeWindowCount,
      0,
    ),
    exactCoreCandidateCount: toNumber(catalog?.metadata?.exactCoreCandidateCount, 0),
    exactCoreQualifiedCount: toNumber(catalog?.metadata?.exactCoreQualifiedCount, 0),
    exactCoreSolvedCount: toNumber(catalog?.metadata?.exactCoreSolvedCount, 0),
    exactCoreUnsatCount: toNumber(catalog?.metadata?.exactCoreUnsatCount, 0),
    exactCoreFrontierBestRetainedDateCount: toNumber(
      catalog?.metadata?.exactCoreFrontierBestRetainedDateCount,
      0,
    ),
    exactCoreFrontierBestRetainedMonthCount: toNumber(
      catalog?.metadata?.exactCoreFrontierBestRetainedMonthCount,
      0,
    ),
    exactCoreFrontierBestRetainedFoldCount: toNumber(
      catalog?.metadata?.exactCoreFrontierBestRetainedFoldCount,
      0,
    ),
    matchedFamilyCount: familySummary.filter((row) => row.openOosMatchedRules > 0).length,
    openOosMatchedRules: leaderboard.filter((row) => row.openOosMatchCount > 0).length,
    zeroNegativeRuleCount: leaderboard.filter(
      (row) => row.openOosMatchCount > 0 && row.openOosNegativeCount === 0,
    ).length,
    hit2ZeroNegativeRuleCount: leaderboard.filter(
      (row) => row.openOosHitCount >= 2 && row.openOosNegativeCount === 0,
    ).length,
    hit3ZeroNegativeRuleCount: leaderboard.filter(
      (row) => row.openOosHitCount >= 3 && row.openOosNegativeCount === 0,
    ).length,
    generalizedQualifiedRuleCount: leaderboard.filter((row) => row.generalizedQualified === true).length,
    exactCompletionSolvedRuleCount: leaderboard.filter((row) => row.exactCompletionSolved === true).length,
    hardNegativeRefinedRuleCount: leaderboard.filter((row) => row.hardNegativeRefined === true).length,
    jointFeasibilitySolvedRuleCount: leaderboard.filter((row) => row.jointFeasibilitySolved === true).length,
    tpRegimeRuleCount: leaderboard.filter((row) => row.tpRegimeTagPresent === true).length,
    fpRiskRuleCount: leaderboard.filter((row) => row.fpRiskTagPresent === true).length,
    rawMatchedRows: toNumber(oosApplyRawBundle.summary?.rawMatches, oosApplyRawBundle.matches.length),
    close28MatchedRows: toNumber(oosApplyClose28Bundle.summary?.rawMatches, oosApplyClose28Bundle.matches.length),
    close28SelectedRows: toNumber(
      oosApplyClose28Bundle.summary?.dedupedMatches,
      oosApplyClose28Bundle.dedupedMatches.length,
    ),
    close28HitRows: (Array.isArray(oosApplyClose28Bundle.dedupedMatches) ? oosApplyClose28Bundle.dedupedMatches : []).filter(
      (row) => resolveOutcomeHitTarget(row) === true,
    ).length,
    lineLevelHitCount: (Array.isArray(oosApplyClose28Bundle.dedupedMatches) ? oosApplyClose28Bundle.dedupedMatches : []).filter(
      (row) => resolveOutcomeHitTarget(row) === true,
    ).length,
    lineLevelHitRate:
      (Array.isArray(oosApplyClose28Bundle.dedupedMatches) ? oosApplyClose28Bundle.dedupedMatches : []).length > 0
        ? (Array.isArray(oosApplyClose28Bundle.dedupedMatches) ? oosApplyClose28Bundle.dedupedMatches : []).filter(
            (row) => resolveOutcomeHitTarget(row) === true,
          ).length /
          (Array.isArray(oosApplyClose28Bundle.dedupedMatches) ? oosApplyClose28Bundle.dedupedMatches : []).length
        : 0,
    rawUniqueMatchedDates: uniqueSorted(oosApplyRawBundle.dedupedMatches.map((row) => row?.dateKey)).length,
    rawUniqueMatchedSymbols: uniqueSorted(oosApplyRawBundle.dedupedMatches.map((row) => row?.symbol)).length,
    uniqueMatchedDates: uniqueSorted(oosApplyClose28Bundle.dedupedMatches.map((row) => row?.dateKey)).length,
    uniqueMatchedSymbols: uniqueSorted(oosApplyClose28Bundle.dedupedMatches.map((row) => row?.symbol)).length,
    top1DateShare: toNumber(oosClose28TopDates[0]?.share, 0),
    top5DateShare: sumShares(oosClose28TopDates),
    top1SymbolShare: toNumber(oosClose28TopSymbols[0]?.share, 0),
    top10SymbolShare: sumShares(oosClose28TopSymbols),
    overlapRate: buildBundleOverlapRate({
      rawDedupedMatches: oosApplyRawBundle.dedupedMatches,
      close28DedupedMatches: oosApplyClose28Bundle.dedupedMatches,
    }),
  }

  const rawVsClose28Delta = {
    rawMatchedRows: selectionGuardrailSummary.rawMatchedRows,
    close28MatchedRows: selectionGuardrailSummary.close28MatchedRows,
    removedRawMatches: selectionGuardrailSummary.rawMatchedRows - selectionGuardrailSummary.close28MatchedRows,
    rawUniqueMatchedDates: selectionGuardrailSummary.rawUniqueMatchedDates,
    close28UniqueMatchedDates: selectionGuardrailSummary.uniqueMatchedDates,
    removedUniqueMatchedDates:
      selectionGuardrailSummary.rawUniqueMatchedDates - selectionGuardrailSummary.uniqueMatchedDates,
    rawUniqueMatchedSymbols: selectionGuardrailSummary.rawUniqueMatchedSymbols,
    close28UniqueMatchedSymbols: selectionGuardrailSummary.uniqueMatchedSymbols,
    removedUniqueMatchedSymbols:
      selectionGuardrailSummary.rawUniqueMatchedSymbols - selectionGuardrailSummary.uniqueMatchedSymbols,
    close28SelectedRows: selectionGuardrailSummary.close28SelectedRows,
    close28HitRows: selectionGuardrailSummary.close28HitRows,
    lineLevelHitCount: selectionGuardrailSummary.lineLevelHitCount,
    lineLevelHitRate: selectionGuardrailSummary.lineLevelHitRate,
    rawMatchedRules: leaderboard.filter((row) => row.openOosRawMatchedRows > 0).length,
    close28MatchedRules: leaderboard.filter((row) => row.openOosClose28MatchedRows > 0).length,
    removedMatchedRules:
      leaderboard.filter((row) => row.openOosRawMatchedRows > 0).length -
      leaderboard.filter((row) => row.openOosClose28MatchedRows > 0).length,
  }

  const selectionConcentration = {
    raw: {
      topDates: oosRawTopDates,
      topSymbols: oosRawTopSymbols,
    },
    close28: {
      topDates: oosClose28TopDates,
      topSymbols: oosClose28TopSymbols,
    },
  }

  const manifest = {
    runId: selectionGuardrailSummary.runId,
    lineId: selectionGuardrailSummary.lineId,
    splitPolicy: selectionGuardrailSummary.splitPolicy,
    selectionMode: selectionGuardrailSummary.selectionMode,
    supportCasesFile: selectionGuardrailSummary.supportCasesFile,
    supportCaseIds: selectionGuardrailSummary.supportCaseIds,
    supportCaseCount: selectionGuardrailSummary.supportCaseCount,
    generalizedSubgroupEnabled: selectionGuardrailSummary.generalizedSubgroupEnabled,
    subgroupMinMatchedDates: selectionGuardrailSummary.subgroupMinMatchedDates,
    subgroupMinMatchedMonths: selectionGuardrailSummary.subgroupMinMatchedMonths,
    subgroupMinMatchedFolds: selectionGuardrailSummary.subgroupMinMatchedFolds,
    subgroupEffectiveRootSeedCount: selectionGuardrailSummary.subgroupEffectiveRootSeedCount,
    subgroupPrefixPruneCount: selectionGuardrailSummary.subgroupPrefixPruneCount,
    catalogPath,
    catalogContentSha256: expectedCatalogSha256,
    ruleIdsSha256: expectedRuleIdsSha256,
    surface: selectionGuardrailSummary.surface,
    datasetContract:
      catalog?.metadata?.datasetContract && typeof catalog.metadata.datasetContract === "object"
        ? { ...catalog.metadata.datasetContract }
        : null,
    discoveryUniverseId: selectionGuardrailSummary.discoveryUniverseId,
    requestedLookbackTradingDays: selectionGuardrailSummary.requestedLookbackTradingDays,
    enabledRecentImpulseLanes: selectionGuardrailSummary.enabledRecentImpulseLanes,
    allowedStepALanes: selectionGuardrailSummary.allowedStepALanes,
    includeSameDayHigh8: selectionGuardrailSummary.includeSameDayHigh8,
    trainInputPath,
    oosInputPath,
    trainReportDir,
    oosReportDir,
    trainApplyRawDir,
    trainApplyClose28Dir,
    oosApplyRawDir,
    oosApplyClose28Dir,
    configPath: toText(getFlag(parsed.flags, "config-path", "")),
    configSha256: toText(getFlag(parsed.flags, "config-sha256", "")),
    trainConfigPath: toText(getFlag(parsed.flags, "train-config-path", "")),
    trainConfigSha256: toText(getFlag(parsed.flags, "train-config-sha256", "")),
    oosConfigPath: toText(getFlag(parsed.flags, "oos-config-path", "")),
    oosConfigSha256: toText(getFlag(parsed.flags, "oos-config-sha256", "")),
    openTrainWindow: {
      start: toText(getFlag(parsed.flags, "train-start", "")),
      end: toText(getFlag(parsed.flags, "train-end", "")),
    },
    openOosWindow: {
      start: toText(getFlag(parsed.flags, "oos-start", "")),
      end: toText(getFlag(parsed.flags, "oos-end", "")),
    },
    selectionLeaderboardSha256: sha256JsonFilePayload(selectionLeaderboard),
  }

  await writeJson(path.join(outDir, "open_train_oos_leaderboard.json"), leaderboard)
  await writeJson(path.join(outDir, "selection_leaderboard.json"), selectionLeaderboard)
  await writeJson(path.join(outDir, "family_summary.json"), familySummary)
  await writeJson(path.join(outDir, "selection_guardrail_summary.json"), selectionGuardrailSummary)
  await writeJson(path.join(outDir, "selection_concentration.json"), selectionConcentration)
  await writeJson(path.join(outDir, "selection_raw_vs_close28_delta.json"), rawVsClose28Delta)
  await writeJson(path.join(outDir, "open_eval_manifest.json"), manifest)
  await fs.writeFile(
    path.join(outDir, "open_train_oos_leaderboard.csv"),
    buildCsv(leaderboard, leaderboardColumns),
    "utf8",
  )
  await fs.writeFile(
    path.join(outDir, "selection_leaderboard.csv"),
    buildCsv(selectionLeaderboard, leaderboardColumns),
    "utf8",
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
