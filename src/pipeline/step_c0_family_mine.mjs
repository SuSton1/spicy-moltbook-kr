import path from "node:path"

import { resolveGlobalWindow, resolveLocalWindow } from "../lib/config.mjs"
import { dequantizeSequence, resolveStepC0InputPath } from "../lib/lightweight.mjs"
import { ensureDir, pathExists, readJsonl, writeJson, writeJsonl } from "../lib/io.mjs"
import { loadPrototypeContributionLedger } from "../lib/prototype_ledger.mjs"
import { computeFamilyCohesion } from "../lib/similarity.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const clamp01 = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

const average = (values) => {
  const list = (Array.isArray(values) ? values : []).map(num).filter(Number.isFinite)
  if (!list.length) return null
  return list.reduce((acc, value) => acc + value, 0) / list.length
}

const median = (values) => quantile(values, 0.5)

const stdev = (values) => {
  const list = (Array.isArray(values) ? values : []).map(num).filter(Number.isFinite)
  if (list.length < 2) return 0
  const mean = average(list) ?? 0
  const variance = list.reduce((acc, value) => acc + (value - mean) ** 2, 0) / list.length
  return Math.sqrt(variance)
}

const normalizeDateKeyText = (value) => {
  const text = String(value ?? "").trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

const resolveRowDateKey = (row) =>
  normalizeDateKeyText(row?.eventDate ?? row?.asOfDate ?? null)

const normalizeLedgerStatus = (value) => {
  const text = String(value ?? "WATCH").trim().toUpperCase()
  if (["CORE", "WATCH", "PENALTY", "QUARANTINE", "RETIRED"].includes(text)) {
    return text
  }
  return "WATCH"
}

const normalizeFeatureVec = (featureVec) => {
  const out = {}
  for (const [key, value] of Object.entries(featureVec ?? {})) {
    out[key] = num(value)
  }
  return out
}

const resolveTemplateKind = (row) => {
  const templateKind = String(row?.templateKind ?? "").trim().toUpperCase()
  if (templateKind === "NEGATIVE") return { label: 0, templateKind }
  if (templateKind === "POSITIVE") return { label: 1, templateKind }
  const label = Number(row?.label)
  return {
    label: Number.isFinite(label) && label === 0 ? 0 : 1,
    templateKind: Number.isFinite(label) && label === 0 ? "NEGATIVE" : "POSITIVE"
  }
}

const REQUIRED_C0_FEATURE_KEYS = [
  "shape.failedBreakoutCount20",
  "gap.fillThenContinueScore",
  "gap.fillThenRevertScore",
  "execution.feasibilityScore"
]

const resolveMissingRequiredC0FeatureKeys = (row) => {
  const featureVec =
    row?.featureVec && typeof row.featureVec === "object" && !Array.isArray(row.featureVec)
      ? row.featureVec
      : {}
  return REQUIRED_C0_FEATURE_KEYS.filter((key) => !Number.isFinite(num(featureVec?.[key])))
}

const normalizeTemplateRow = (row) => {
  const templateId = String(row?.templateId ?? "").trim()
  if (!templateId) return null
  const localWindowRaw = Number(row?.localWindow)
  const globalWindowRaw = Number(row?.globalWindow)
  if (!Number.isInteger(localWindowRaw) || localWindowRaw < 1) return null
  if (!Number.isInteger(globalWindowRaw) || globalWindowRaw <= localWindowRaw) return null
  let seq40 = null
  if (Array.isArray(row?.seq40)) {
    seq40 = row.seq40
  } else if (Array.isArray(row?.seq40q)) {
    const scale = Number(row?.seq40Scale)
    if (!Number.isFinite(scale) || scale <= 0) return null
    seq40 = dequantizeSequence(row.seq40q, scale)
  }
  let seq150 = null
  if (Array.isArray(row?.seq150)) {
    seq150 = row.seq150
  } else if (Array.isArray(row?.seq150q)) {
    const scale = Number(row?.seq150Scale)
    if (!Number.isFinite(scale) || scale <= 0) return null
    seq150 = dequantizeSequence(row.seq150q, scale)
  }
  const featureVec = normalizeFeatureVec(row?.featureVec)
  const globalFeatureVec = normalizeFeatureVec(row?.globalFeatureVec)
  if (!seq40 || !seq150 || !Object.keys(featureVec).length || !Object.keys(globalFeatureVec).length) {
    return null
  }
  const labelInfo = resolveTemplateKind(row)
  return {
    templateId,
    symbol: String(row?.symbol ?? "").trim() || null,
    eventDate: normalizeDateKeyText(row?.eventDate) ?? null,
    asOfDate: normalizeDateKeyText(row?.asOfDate) ?? null,
    localWindow: localWindowRaw,
    globalWindow: globalWindowRaw,
    featureVec,
    globalFeatureVec,
    seq40: seq40.map((value) => num(value) ?? 0),
    seq150: seq150.map((value) => num(value) ?? 0),
    label: labelInfo.label,
    templateKind: labelInfo.templateKind,
    eventMeta: row?.eventMeta && typeof row.eventMeta === "object" ? row.eventMeta : {}
  }
}

const summarizeFamilyPrototypeLedger = ({ rows, ledgerById }) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const lookup = ledgerById instanceof Map ? ledgerById : new Map()
  if (safeRows.length < 1) {
    return {
      prototypeQualityAvailable: false,
      prototypeLedgerMatchedCount: 0,
      prototypeLedgerCoverage: 0,
      corePrototypeShare: 0,
      penaltyPrototypeShare: 0,
      quarantinePrototypeShare: 0,
      retiredPrototypeShare: 0,
      prototypeQualityMedian: null,
      prototypeQualityMean: null,
      prototypeLedgerConfidenceMean: null
    }
  }
  let core = 0
  let penalty = 0
  let quarantine = 0
  let retired = 0
  let matchedCount = 0
  const qualityValues = []
  const confidenceValues = []
  for (const row of safeRows) {
    const templateId = String(row?.templateId ?? "").trim()
    const ledger = templateId ? lookup.get(templateId) ?? null : null
    if (!ledger) continue
    matchedCount += 1
    const status = normalizeLedgerStatus(ledger?.status)
    if (status === "CORE") core += 1
    else if (status === "PENALTY") penalty += 1
    else if (status === "QUARANTINE") quarantine += 1
    else if (status === "RETIRED") retired += 1
    qualityValues.push(Number(ledger?.compositeQuality ?? 0) || 0)
    confidenceValues.push(Number(ledger?.confidence ?? 0) || 0)
  }
  return {
    prototypeQualityAvailable: matchedCount > 0,
    prototypeLedgerMatchedCount: matchedCount,
    prototypeLedgerCoverage: matchedCount / safeRows.length,
    corePrototypeShare: core / safeRows.length,
    penaltyPrototypeShare: penalty / safeRows.length,
    quarantinePrototypeShare: quarantine / safeRows.length,
    retiredPrototypeShare: retired / safeRows.length,
    prototypeQualityMedian: qualityValues.length > 0 ? median(qualityValues) : null,
    prototypeQualityMean: qualityValues.length > 0 ? average(qualityValues) : null,
    prototypeLedgerConfidenceMean: confidenceValues.length > 0 ? average(confidenceValues) : null
  }
}

const buildFeatureStats = (rows, vectorKey) => {
  const byKey = new Map()
  for (const row of rows ?? []) {
    for (const [key, value] of Object.entries(row?.[vectorKey] ?? {})) {
      const n = num(value)
      if (!Number.isFinite(n)) continue
      const list = byKey.get(key) ?? []
      list.push(n)
      byKey.set(key, list)
    }
  }
  const out = {}
  for (const [key, values] of byKey.entries()) {
    out[key] = {
      mean: average(values) ?? 0,
      stdev: stdev(values)
    }
  }
  return out
}

const quantile = (values, q) => {
  const list = (Array.isArray(values) ? values : []).map(num).filter(Number.isFinite).sort((a, b) => a - b)
  if (!list.length) return null
  const clamped = clamp01(q)
  const pos = (list.length - 1) * clamped
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return list[lo]
  const ratio = pos - lo
  return list[lo] * (1 - ratio) + list[hi] * ratio
}

const assignBin = (value, thresholds) => {
  const n = num(value)
  if (!Number.isFinite(n)) return "NA"
  const safe = Array.isArray(thresholds) ? thresholds.map(num).filter(Number.isFinite) : []
  if (!safe.length) return "B1"
  let idx = 0
  while (idx < safe.length && n > safe[idx]) idx += 1
  return `B${idx + 1}`
}

const resolveC0Config = (config) => {
  const raw = config?.pattern?.c0 ?? {}
  const temporalEraCount = Math.max(2, Math.floor(Number(config?.pattern?.temporalStability?.eraCount ?? 4) || 4))
  return {
    enabled: raw?.enabled === true,
    inputMode: String(raw?.inputMode ?? "auto").trim().toLowerCase(),
    familyBuildSource: String(raw?.familyBuildSource ?? "positive_only").trim().toLowerCase(),
    minFamilySupport: Math.max(2, Math.floor(Number(raw?.minFamilySupport ?? 6) || 6)),
    maxFamilyShare: clamp01(raw?.maxFamilyShare ?? 0.22),
    minEraCoverageRatio: clamp01(raw?.minEraCoverageRatio ?? 0.5),
    minEraCoverageRatioForBackfill: clamp01(
      raw?.minEraCoverageRatioForBackfill ?? raw?.minEraCoverageRatio ?? 0.5,
    ),
    minEffectiveEraCountRatio: clamp01(raw?.minEffectiveEraCountRatio ?? 0.6),
    minEffectiveEraCountRatioForBackfill: clamp01(
      raw?.minEffectiveEraCountRatioForBackfill ?? raw?.minEffectiveEraCountRatio ?? 0.5,
    ),
    minNormalizedEraEntropy: clamp01(raw?.minNormalizedEraEntropy ?? 0.25),
    minNormalizedEraEntropyForBackfill: clamp01(
      raw?.minNormalizedEraEntropyForBackfill ?? raw?.minNormalizedEraEntropy ?? 0.2,
    ),
    maxSingleEraShare: clamp01(raw?.maxSingleEraShare ?? 0.72),
    maxSingleEraShareForBackfill: clamp01(
      raw?.maxSingleEraShareForBackfill ?? raw?.maxSingleEraShare ?? 0.72,
    ),
    minShapeCohesion: clamp01(raw?.minShapeCohesion ?? 0.58),
    minFeatureCohesion: clamp01(raw?.minFeatureCohesion ?? 0.56),
    maxNegativeContaminationRate: clamp01(raw?.maxNegativeContaminationRate ?? 0.38),
    shortlistFamilyCount: Math.max(1, Math.floor(Number(raw?.shortlistFamilyCount ?? 18) || 18)),
    familyBackfillFloor: Math.max(1, Math.floor(Number(raw?.familyBackfillFloor ?? 10) || 10)),
    familyBackfillMax: Math.max(0, Math.floor(Number(raw?.familyBackfillMax ?? 8) || 8)),
    eraCount: Math.max(2, Math.floor(Number(raw?.eraCount ?? temporalEraCount) || temporalEraCount)),
    familySignature: {
      useGlobalBins: raw?.familySignature?.useGlobalBins !== false,
      useShapeBucket: raw?.familySignature?.useShapeBucket !== false,
      useFeatureBucket: raw?.familySignature?.useFeatureBucket !== false,
      useTemplateKindMix: raw?.familySignature?.useTemplateKindMix === true,
      useJumpBand: raw?.familySignature?.useJumpBand !== false,
      globalKeyCount: Math.max(1, Math.floor(Number(raw?.familySignature?.globalKeyCount ?? 3) || 3)),
      featureKeyCount: Math.max(1, Math.floor(Number(raw?.familySignature?.featureKeyCount ?? 2) || 2))
    },
    scoreWeights: {
      recurrence: Math.max(0, Number(raw?.scoreWeights?.recurrence ?? 0.28) || 0),
      shapeCohesion: Math.max(0, Number(raw?.scoreWeights?.shapeCohesion ?? 0.18) || 0),
      featureCohesion: Math.max(0, Number(raw?.scoreWeights?.featureCohesion ?? 0.16) || 0),
      eraCoverage: Math.max(0, Number(raw?.scoreWeights?.eraCoverage ?? 0.14) || 0),
      effectiveEraCount: Math.max(0, Number(raw?.scoreWeights?.effectiveEraCount ?? 0.08) || 0),
      normalizedEraEntropy: Math.max(0, Number(raw?.scoreWeights?.normalizedEraEntropy ?? 0.08) || 0),
      regimeCoverage: Math.max(0, Number(raw?.scoreWeights?.regimeCoverage ?? 0.1) || 0),
      negativeContaminationPenalty: Math.max(0, Number(raw?.scoreWeights?.negativeContaminationPenalty ?? 0.08) || 0),
      singleEraPenalty: Math.max(0, Number(raw?.scoreWeights?.singleEraPenalty ?? 0.04) || 0),
      failedBreakoutPenalty: Math.max(0, Number(raw?.scoreWeights?.failedBreakoutPenalty ?? 0) || 0),
      gapContinueBonus: Math.max(0, Number(raw?.scoreWeights?.gapContinueBonus ?? 0) || 0),
      gapRevertPenalty: Math.max(0, Number(raw?.scoreWeights?.gapRevertPenalty ?? 0) || 0),
      executionFeasibilityBonus: Math.max(
        0,
        Number(raw?.scoreWeights?.executionFeasibilityBonus ?? 0) || 0,
      ),
      prototypeQualityBonus: Math.max(
        0,
        Number(raw?.scoreWeights?.prototypeQualityBonus ?? 0.05) || 0,
      ),
      corePrototypeShareBonus: Math.max(
        0,
        Number(raw?.scoreWeights?.corePrototypeShareBonus ?? 0.04) || 0,
      ),
      penaltyPrototypePenalty: Math.max(
        0,
        Number(raw?.scoreWeights?.penaltyPrototypePenalty ?? 0.03) || 0,
      ),
      quarantinePrototypePenalty: Math.max(
        0,
        Number(raw?.scoreWeights?.quarantinePrototypePenalty ?? 0.04) || 0,
      ),
      failedBreakoutScale: Math.max(
        1,
        Number(raw?.scoreWeights?.failedBreakoutScale ?? 4) || 4,
      ),
      overCommonNoisePenalty: Math.max(0, Number(raw?.scoreWeights?.overCommonNoisePenalty ?? 0.02) || 0)
    }
  }
}

const buildEraPlan = ({ rows, eraCount }) => {
  const dates = Array.from(new Set((rows ?? []).map((row) => resolveRowDateKey(row)).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  )
  const appliedEraCount = Math.max(1, Math.min(Math.max(2, eraCount), dates.length || 1))
  const dateToEra = new Map()
  const eras = []
  if (!dates.length) {
    return {
      appliedEraCount: 0,
      eras: [],
      resolveEraId: () => null
    }
  }
  for (let idx = 0; idx < appliedEraCount; idx += 1) {
    const start = Math.floor((idx * dates.length) / appliedEraCount)
    const rawEnd = Math.floor(((idx + 1) * dates.length) / appliedEraCount)
    const end = idx === appliedEraCount - 1 ? dates.length : Math.max(start + 1, rawEnd)
    const eraId = `E${String(idx + 1).padStart(2, "0")}`
    eras.push({
      eraId,
      from: dates[start] ?? dates[0],
      to: dates[end - 1] ?? dates[dates.length - 1]
    })
    for (let dateIdx = start; dateIdx < end; dateIdx += 1) {
      dateToEra.set(dates[dateIdx], eraId)
    }
  }
  return {
    appliedEraCount,
    eras,
    resolveEraId: (row) => dateToEra.get(resolveRowDateKey(row)) ?? null
  }
}

const buildKeyThresholdPlan = ({ stats, rows, keyCount, bins = [1 / 3, 2 / 3] }) => {
  const keys = Object.entries(stats ?? {})
    .sort((left, right) => Number(right?.[1]?.stdev ?? 0) - Number(left?.[1]?.stdev ?? 0))
    .slice(0, Math.max(1, keyCount))
    .map(([key]) => key)
  const thresholds = {}
  for (const key of keys) {
    const values = rows.map((row) => row?.globalFeatureVec?.[key]).filter((value) => Number.isFinite(Number(value)))
    thresholds[key] = bins.map((entry) => quantile(values, entry)).filter(Number.isFinite)
  }
  return {
    keys,
    thresholds
  }
}

const buildFeatureBucketPlan = ({ stats, rows, keyCount, bins = [0.5] }) => {
  const keys = Object.entries(stats ?? {})
    .sort((left, right) => Number(right?.[1]?.stdev ?? 0) - Number(left?.[1]?.stdev ?? 0))
    .slice(0, Math.max(1, keyCount))
    .map(([key]) => key)
  const thresholds = {}
  for (const key of keys) {
    const values = rows.map((row) => row?.featureVec?.[key]).filter((value) => Number.isFinite(Number(value)))
    thresholds[key] = bins.map((entry) => quantile(values, entry)).filter(Number.isFinite)
  }
  return {
    keys,
    thresholds
  }
}

const buildShapeBucket = (row) => {
  const seq = Array.isArray(row?.seq40) ? row.seq40 : []
  if (!seq.length) return "shape:NA"
  const first = Number(seq[0] ?? 0) || 0
  const last = Number(seq[seq.length - 1] ?? 0) || 0
  const slope = last - first
  const vol = stdev(seq)
  const slopeBucket = slope >= 0.15 ? "UP" : slope <= -0.15 ? "DOWN" : "FLAT"
  const volBucket = vol >= 0.18 ? "WILD" : vol >= 0.1 ? "MID" : "CALM"
  return `shape:${slopeBucket}:${volBucket}`
}

const buildJumpBand = (row) => {
  const jumpPct = Number(row?.eventMeta?.jumpPct ?? 0)
  if (!Number.isFinite(jumpPct)) return "jump:NA"
  if (jumpPct >= 0.12) return "jump:HIGH"
  if (jumpPct >= 0.08) return "jump:MID"
  return "jump:LOW"
}

const buildFamilySignature = ({ row, cfg, globalPlan, featurePlan }) => {
  const parts = []
  if (cfg.familySignature.useGlobalBins) {
    for (const key of globalPlan.keys) {
      parts.push(`g:${key}:${assignBin(row?.globalFeatureVec?.[key], globalPlan.thresholds[key])}`)
    }
  }
  if (cfg.familySignature.useFeatureBucket) {
    for (const key of featurePlan.keys) {
      parts.push(`f:${key}:${assignBin(row?.featureVec?.[key], featurePlan.thresholds[key])}`)
    }
  }
  if (cfg.familySignature.useShapeBucket) {
    parts.push(buildShapeBucket(row))
  }
  if (cfg.familySignature.useJumpBand) {
    parts.push(buildJumpBand(row))
  }
  return parts.filter(Boolean).join("|") || "family:default"
}

const buildFamilyTemplateKindMixKey = (familyRows) => {
  const counts = new Map()
  for (const row of familyRows ?? []) {
    const key = String(row?.templateKind ?? "NA").trim().toUpperCase() || "NA"
    counts.set(key, Number(counts.get(key) ?? 0) + 1)
  }
  const ranked = Array.from(counts.entries()).sort((left, right) => Number(right[1]) - Number(left[1]))
  const topKey = ranked[0]?.[0] ?? "NA"
  const topCount = Number(ranked[0]?.[1] ?? 0) || 0
  const total = Math.max(1, (familyRows ?? []).length)
  const topShare = topCount / total
  const polarity =
    topKey === "NEGATIVE" ? "NEG_DOM" : topKey === "POSITIVE" ? "POS_DOM" : `${topKey}_DOM`
  return {
    dominantTemplateKind: topKey,
    dominantTemplateKindShare: topShare,
    templateKindMixKey: `kindmix:${polarity}:${topShare >= 0.75 ? "STRONG" : "MIXED"}`
  }
}

const buildRegimeKey = ({ row, globalPlan }) => {
  const key = globalPlan.keys[0]
  if (!key) return "REGIME_DEFAULT"
  return `regime:${key}:${assignBin(row?.globalFeatureVec?.[key], globalPlan.thresholds[key])}`
}

const scoreFamilyRecurrence = ({
  familyRows,
  totalRows,
  eraIds,
  regimeKeys,
  regimeUniverseSize,
  cfg,
  appliedEraCount
}) => {
  const support = familyRows.length
  const supportScore = clamp01(support / Math.max(cfg.minFamilySupport * 2, 1))
  const uniqueSymbols = new Set(familyRows.map((row) => String(row?.symbol ?? "").trim()).filter(Boolean)).size
  const symbolCoverage = clamp01(uniqueSymbols / Math.max(Math.min(support, 6), 1))
  const eraCoverageRatio = clamp01(eraIds.size / Math.max(appliedEraCount ?? cfg.eraCount, 1))
  const regimeCoverageRatio = clamp01(regimeKeys.size / Math.max(1, Number(regimeUniverseSize ?? 0) || 1))
  const supportRatio = totalRows > 0 ? support / totalRows : 0
  return {
    support,
    supportRatio,
    symbolCoverage,
    eraCoverageRatio,
    regimeCoverageRatio,
    recurrenceScore: clamp01((supportScore + symbolCoverage + eraCoverageRatio) / 3)
  }
}

const scoreFamilyNoise = ({ familyRows, matchedNegativeRows, supportRatio, cfg }) => {
  const extraNegativeRows = Array.isArray(matchedNegativeRows) ? matchedNegativeRows : []
  const positiveRows = familyRows.filter((row) => Number(row?.label) !== 0)
  const inFamilyNegativeRows = familyRows.filter((row) => Number(row?.label) === 0)
  const rowsForShare = positiveRows.length > 0 ? positiveRows : familyRows
  const positiveCount = positiveRows.length
  const negativeCount = inFamilyNegativeRows.length + extraNegativeRows.length
  const totalCount = positiveCount + negativeCount
  const negativeContaminationRate = totalCount > 0 ? negativeCount / totalCount : 0
  const eraCounts = new Map()
  const symbolCounts = new Map()
  for (const row of rowsForShare) {
    const eraId = row?.c0EraId ?? null
    if (eraId) eraCounts.set(eraId, Number(eraCounts.get(eraId) ?? 0) + 1)
    const symbol = String(row?.symbol ?? "").trim()
    if (symbol) symbolCounts.set(symbol, Number(symbolCounts.get(symbol) ?? 0) + 1)
  }
  const dominantEraShare = rowsForShare.length
    ? Math.max(...Array.from(eraCounts.values()), 0) / rowsForShare.length
    : 0
  const dominantSymbolShare = rowsForShare.length
    ? Math.max(...Array.from(symbolCounts.values()), 0) / rowsForShare.length
    : 0
  const familySharePenalty = supportRatio > cfg.maxFamilyShare
    ? clamp01((supportRatio - cfg.maxFamilyShare) / Math.max(1 - cfg.maxFamilyShare, 1e-6))
    : 0
  const overCommonNoisePenalty = clamp01(Math.max(familySharePenalty, dominantSymbolShare - 0.6))
  return {
    positiveCount,
    negativeCount,
    negativeContaminationRate,
    singleEraShare: dominantEraShare,
    dominantEraId:
      Array.from(eraCounts.entries()).sort((left, right) => Number(right[1]) - Number(left[1]))[0]?.[0] ?? null,
    dominantSymbolShare,
    noisePenalty: overCommonNoisePenalty
  }
}

const summarizeFamilyFeatureBehavior = (familyRows) => {
  const rows = Array.isArray(familyRows) ? familyRows : []
  const positiveRows = rows.filter((row) => Number(row?.label) !== 0)
  const sourceRows = positiveRows.length > 0 ? positiveRows : rows
  const failedBreakoutValues = sourceRows.map(
    (row) => Number(row?.featureVec?.["shape.failedBreakoutCount20"] ?? 0) || 0,
  )
  const gapContinueValues = sourceRows.map(
    (row) => Number(row?.featureVec?.["gap.fillThenContinueScore"] ?? 0) || 0,
  )
  const gapRevertValues = sourceRows.map(
    (row) => Number(row?.featureVec?.["gap.fillThenRevertScore"] ?? 0) || 0,
  )
  const executionFeasibilityValues = sourceRows.map(
    (row) => Number(row?.featureVec?.["execution.feasibilityScore"] ?? 0) || 0,
  )
  return {
    failedBreakoutCount20Median: Math.max(0, Number(median(failedBreakoutValues) ?? 0) || 0),
    gapFillThenContinueScoreMedian: clamp01(median(gapContinueValues) ?? 0),
    gapFillThenRevertScoreMedian: clamp01(median(gapRevertValues) ?? 0),
    executionFeasibilityMedian: clamp01(median(executionFeasibilityValues) ?? 0)
  }
}

const scoreFamilyTemporalDiversity = ({ familyRows, appliedEraCount }) => {
  const rows = Array.isArray(familyRows) ? familyRows : []
  const positiveRows = rows.filter((row) => Number(row?.label) !== 0)
  const sourceRows = positiveRows.length > 0 ? positiveRows : rows
  const safeAppliedEraCount = Math.max(1, Math.floor(Number(appliedEraCount ?? 0) || 0))
  const eraCounts = new Map()
  for (const row of sourceRows) {
    const eraId = String(row?.c0EraId ?? "").trim()
    if (!eraId) continue
    eraCounts.set(eraId, Number(eraCounts.get(eraId) ?? 0) + 1)
  }
  const supportValues = Array.from(eraCounts.values()).map((value) => Number(value ?? 0) || 0)
  const total = supportValues.reduce((acc, value) => acc + value, 0)
  const supportShares = supportValues
    .map((value) => (total > 0 ? value / total : 0))
    .filter((value) => Number.isFinite(value) && value > 0)
  const eraEntropy = supportShares.reduce((acc, share) => acc - share * Math.log(share), 0)
  const normalizedEraEntropy =
    safeAppliedEraCount > 1 ? clamp01(eraEntropy / Math.log(safeAppliedEraCount)) : 0
  const effectiveEraCount = supportShares.length ? Math.exp(eraEntropy) : 0
  const effectiveEraCountRatio =
    safeAppliedEraCount > 0 ? clamp01(effectiveEraCount / safeAppliedEraCount) : 0
  const maxSingleEraShare = supportShares.length ? Math.max(...supportShares) : 0
  const lowDiversityPenalty = clamp01(
    ((1 - normalizedEraEntropy) + (1 - effectiveEraCountRatio) + maxSingleEraShare) / 3,
  )
  return {
    eraEntropy,
    normalizedEraEntropy,
    effectiveEraCount,
    effectiveEraCountRatio,
    maxSingleEraShare,
    lowDiversityPenalty
  }
}

const buildFamilyShortlist = ({ families, cfg }) => {
  const sorted = families
    .slice()
    .sort((left, right) => {
      const byScore = Number(right?.c0Score ?? 0) - Number(left?.c0Score ?? 0)
      if (byScore !== 0) return byScore
      return Number(right?.support ?? 0) - Number(left?.support ?? 0)
    })
  const shortlisted = []
  const near = []
  let droppedLowSupportFamilies = 0
  let droppedLowCohesionFamilies = 0
  let droppedHighNoiseFamilies = 0
  let droppedLowEraDiversityFamilies = 0
  let droppedEraDominanceFamilies = 0
  for (const family of sorted) {
    const supportOk = Number(family?.support ?? 0) >= cfg.minFamilySupport
    const shapeOk = Number(family?.shapeCohesionScore ?? 0) >= cfg.minShapeCohesion
    const featureOk = Number(family?.featureCohesionScore ?? 0) >= cfg.minFeatureCohesion
    const eraOk = Number(family?.eraCoverageRatio ?? 0) >= cfg.minEraCoverageRatio
    const effectiveEraOk =
      Number(family?.effectiveEraCountRatio ?? 0) >= cfg.minEffectiveEraCountRatio
    const entropyOk =
      Number(family?.normalizedEraEntropy ?? 0) >= cfg.minNormalizedEraEntropy
    const shareOk = Number(family?.singleEraShare ?? 1) <= cfg.maxSingleEraShare
    const backfillEraOk =
      Number(family?.eraCoverageRatio ?? 0) >= cfg.minEraCoverageRatioForBackfill
    const backfillEffectiveEraOk =
      Number(family?.effectiveEraCountRatio ?? 0) >= cfg.minEffectiveEraCountRatioForBackfill
    const backfillEntropyOk =
      Number(family?.normalizedEraEntropy ?? 0) >= cfg.minNormalizedEraEntropyForBackfill
    const backfillShareOk =
      Number(family?.singleEraShare ?? 1) <= cfg.maxSingleEraShareForBackfill
    const noiseOk = Number(family?.negativeContaminationRate ?? 1) <= cfg.maxNegativeContaminationRate
    if (!supportOk) {
      droppedLowSupportFamilies += 1
      family.status = "DROP_LOW_SUPPORT"
      continue
    }
    if (!shapeOk || !featureOk) {
      droppedLowCohesionFamilies += 1
      family.status = "DROP_LOW_COHESION"
      continue
    }
    if (!noiseOk) {
      droppedHighNoiseFamilies += 1
      family.status = "DROP_HIGH_NOISE"
      continue
    }
    if (eraOk && effectiveEraOk && entropyOk && shareOk && shortlisted.length < cfg.shortlistFamilyCount) {
      family.status = "SHORTLIST"
      family.shortlisted = true
      shortlisted.push(family)
      continue
    }
    if (!eraOk || !effectiveEraOk || !entropyOk || !shareOk) {
      droppedLowEraDiversityFamilies += 1
    }
    if (!backfillEraOk || !backfillEffectiveEraOk || !backfillEntropyOk || !backfillShareOk) {
      droppedEraDominanceFamilies += 1
      family.status = "DROP_ERA_DOMINANCE_BACKFILL"
      continue
    }
    family.status = "NEAR_THRESHOLD"
    near.push(family)
  }
  let backfilled = 0
  for (const family of near) {
    if (shortlisted.length >= cfg.familyBackfillFloor) break
    if (backfilled >= cfg.familyBackfillMax) break
    family.status = "SHORTLIST_BACKFILL"
    family.shortlisted = true
    shortlisted.push(family)
    backfilled += 1
  }
  return {
    shortlisted,
    droppedLowSupportFamilies,
    droppedLowCohesionFamilies,
    droppedHighNoiseFamilies,
    droppedLowEraDiversityFamilies,
    droppedEraDominanceFamilies,
    backfilled
  }
}

export const runStepC0 = async (ctx) => {
  const c0Cfg = resolveC0Config(ctx.config)
  const lightweightCfg = ctx.config?.lightweight ?? {}
  const stepBSourceRunDir = String(ctx?.abRunDir ?? "").trim() ? String(ctx.abRunDir) : String(ctx.runDir)
  const stepBSourceRunId = String(ctx?.abRunId ?? "").trim() || path.basename(stepBSourceRunDir)
  const outDir = path.join(ctx.runDir, "step-c0")
  await ensureDir(outDir)
  if (c0Cfg.enabled !== true) {
    const summary = {
      step: "C0",
      enabled: false,
      inputMode: "disabled",
      stepBSourceRunId,
      stepBSourceRunDir,
      families: 0,
      shortlistedFamilies: 0,
      gate: {
        enabled: false,
        failed: false,
        reason: "DISABLED",
        fallbackUsed: false
      },
      shortlistPolicy: {
        shortlistFamilyCount: c0Cfg.shortlistFamilyCount,
        familyBackfillFloor: c0Cfg.familyBackfillFloor,
        familyBackfillMax: c0Cfg.familyBackfillMax
      }
    }
    const familyIndexPath = path.join(outDir, "c0_family_index.json")
    const membershipPath = path.join(outDir, "c0_family_membership.jsonl")
    const summaryPath = path.join(outDir, "c0_summary.json")
    await writeJson(familyIndexPath, {
      version: 1,
      generatedAt: new Date().toISOString(),
      enabled: false,
      familyCount: 0,
      shortlistedFamilyCount: 0,
      families: [],
      membershipPath,
      summaryPath
    })
    await writeJsonl(membershipPath, [])
    await writeJson(summaryPath, summary)
    return {
      step: "C0",
      familyIndexPath,
      membershipPath,
      summaryPath,
      summary
    }
  }

  const { inPath, mode: inputMode } = resolveStepC0InputPath({
    runDir: stepBSourceRunDir,
    lightweightCfg,
    preferLiteArtifacts: lightweightCfg?.pipeline?.preferLiteArtifacts
  })
  if (!pathExists(inPath)) {
    throw new Error(`Step C0 input file not found: ${inPath}`)
  }
  const rawRows = await readJsonl(inPath)
  const prototypeLedger = await loadPrototypeContributionLedger({ ctx }).catch(() => ({
    enabled: false,
    path: null,
    manifest: null,
    byId: new Map()
  }))
  const schemaInvalidRow = rawRows.find((row) => resolveMissingRequiredC0FeatureKeys(row).length > 0)
  if (schemaInvalidRow) {
    const missingKeys = resolveMissingRequiredC0FeatureKeys(schemaInvalidRow)
    throw new Error(
      `Step C0 required feature schema mismatch: template=${String(schemaInvalidRow?.templateId ?? "(unknown)")} missing=${missingKeys.join(", ")}`,
    )
  }
  const rows = rawRows
    .map((row) => normalizeTemplateRow(row))
    .filter(Boolean)
    .sort((left, right) => String(left?.eventDate ?? "").localeCompare(String(right?.eventDate ?? "")))
  if (!rows.length) {
    throw new Error("Step C0 input is empty after normalization.")
  }
  const positiveRows = rows.filter((row) => row.label === 1)
  const negativeRows = rows.filter((row) => row.label === 0)
  const familyBuildRows =
    c0Cfg.familyBuildSource === "all_templates"
      ? rows
      : positiveRows
  if (!familyBuildRows.length) {
    throw new Error(`Step C0 has no templates available for familyBuildSource=${c0Cfg.familyBuildSource}`)
  }
  const localWindow = resolveLocalWindow(ctx.config)
  const globalWindow = resolveGlobalWindow(ctx.config)
  const badWindow = rows.find(
    (row) => Number(row?.localWindow) !== localWindow || Number(row?.globalWindow) !== globalWindow,
  )
  if (badWindow) {
    throw new Error(
      `Step C0 template window mismatch: template=${badWindow.templateId} templateWindow=${badWindow.localWindow}/${badWindow.globalWindow} configWindow=${localWindow}/${globalWindow}`,
    )
  }
  const statsRows = positiveRows.length > 0 ? positiveRows : familyBuildRows
  const localFeatureStats = buildFeatureStats(statsRows, "featureVec")
  const globalFeatureStats = buildFeatureStats(statsRows, "globalFeatureVec")
  const globalPlan = buildKeyThresholdPlan({
    stats: globalFeatureStats,
    rows: statsRows,
    keyCount: c0Cfg.familySignature.globalKeyCount
  })
  const featurePlan = buildFeatureBucketPlan({
    stats: localFeatureStats,
    rows: statsRows,
    keyCount: c0Cfg.familySignature.featureKeyCount
  })
  const eraPlan = buildEraPlan({
    rows,
    eraCount: c0Cfg.eraCount
  })
  for (const row of rows) {
    row.c0EraId = eraPlan.resolveEraId(row)
    row.c0RegimeKey = buildRegimeKey({
      row,
      globalPlan
    })
    row.c0FamilySignatureBase = buildFamilySignature({
      row,
      cfg: c0Cfg,
      globalPlan,
      featurePlan
    })
  }
  const coarseByFamily = new Map()
  for (const row of familyBuildRows) {
    const signature = String(row?.c0FamilySignatureBase ?? "").trim() || "family:default"
    const list = coarseByFamily.get(signature) ?? []
    list.push(row)
    coarseByFamily.set(signature, list)
  }
  const finalSignatureByBase = new Map()
  const familyMixBySignature = new Map()
  const byFamily = new Map()
  for (const [coarseSignature, familyRows] of coarseByFamily.entries()) {
    const mix = buildFamilyTemplateKindMixKey(familyRows)
    const finalSignature =
      c0Cfg.familySignature.useTemplateKindMix === true
        ? `${coarseSignature}|${mix.templateKindMixKey}`
        : coarseSignature
    finalSignatureByBase.set(coarseSignature, finalSignature)
    familyMixBySignature.set(finalSignature, mix)
    for (const row of familyRows) {
      row.c0FamilySignature = finalSignature
      row.c0FamilyTemplateKindMixKey = mix.templateKindMixKey
      row.c0DominantTemplateKind = mix.dominantTemplateKind
      row.c0DominantTemplateKindShare = mix.dominantTemplateKindShare
    }
    const list = byFamily.get(finalSignature) ?? []
    list.push(...familyRows)
    byFamily.set(finalSignature, list)
  }
  for (const row of rows) {
    const finalSignature = finalSignatureByBase.get(String(row?.c0FamilySignatureBase ?? "").trim())
    if (!finalSignature) continue
    const mix = familyMixBySignature.get(finalSignature) ?? buildFamilyTemplateKindMixKey([])
    row.c0FamilySignature = finalSignature
    row.c0FamilyTemplateKindMixKey = mix.templateKindMixKey
    row.c0DominantTemplateKind = mix.dominantTemplateKind
    row.c0DominantTemplateKindShare = mix.dominantTemplateKindShare
  }
  const negativeRowsByFamilySignature = new Map()
  for (const row of negativeRows) {
    const signature = String(row?.c0FamilySignature ?? "").trim()
    if (!signature) continue
    const list = negativeRowsByFamilySignature.get(signature) ?? []
    list.push(row)
    negativeRowsByFamilySignature.set(signature, list)
  }
  const regimeUniverseSize = new Set(familyBuildRows.map((row) => row?.c0RegimeKey).filter(Boolean)).size
  const similarityWeights = ctx.config?.similarity?.initialWeights ?? {}
  const families = Array.from(byFamily.entries()).map(([signature, familyRows], idx) => {
    const ordered = familyRows
      .slice()
      .sort((left, right) => String(left?.eventDate ?? "").localeCompare(String(right?.eventDate ?? "")))
    const familyId = `F${String(idx + 1).padStart(3, "0")}`
    const cohesion = computeFamilyCohesion({
      rows: ordered,
      featureStats: localFeatureStats,
      weights: similarityWeights,
      maxPairs: 24
    })
    const eraIds = new Set(ordered.map((row) => row?.c0EraId).filter(Boolean))
    const regimeKeys = new Set(ordered.map((row) => row?.c0RegimeKey).filter(Boolean))
    const recurrence = scoreFamilyRecurrence({
      familyRows: ordered,
      totalRows: familyBuildRows.length,
      eraIds,
      regimeKeys,
      regimeUniverseSize,
      cfg: c0Cfg,
      appliedEraCount: eraPlan?.appliedEraCount ?? c0Cfg.eraCount
    })
    const matchedNegativeRows =
      c0Cfg.familyBuildSource === "all_templates"
        ? []
        : (negativeRowsByFamilySignature.get(signature) ?? [])
    const temporalDiversity = scoreFamilyTemporalDiversity({
      familyRows: ordered,
      appliedEraCount: eraPlan?.appliedEraCount ?? c0Cfg.eraCount
    })
    const prototypeLedgerStats = summarizeFamilyPrototypeLedger({
      rows: ordered,
      ledgerById: prototypeLedger?.byId
    })
    const featureBehavior = summarizeFamilyFeatureBehavior(ordered)
    const noise = scoreFamilyNoise({
      familyRows: ordered,
      matchedNegativeRows,
      supportRatio: recurrence.supportRatio,
      cfg: c0Cfg
    })
    const scoreWeights = c0Cfg.scoreWeights
    const failedBreakoutPenalty = clamp01(
      featureBehavior.failedBreakoutCount20Median / Math.max(1, scoreWeights.failedBreakoutScale),
    )
    const c0ScoreBase = clamp01(
      recurrence.recurrenceScore * scoreWeights.recurrence +
        Number(cohesion?.shapeScore ?? 0) * scoreWeights.shapeCohesion +
        Number(cohesion?.averageTotal ?? 0) * scoreWeights.featureCohesion +
        recurrence.eraCoverageRatio * scoreWeights.eraCoverage +
        temporalDiversity.effectiveEraCountRatio * scoreWeights.effectiveEraCount +
        temporalDiversity.normalizedEraEntropy * scoreWeights.normalizedEraEntropy +
        recurrence.regimeCoverageRatio * scoreWeights.regimeCoverage -
        noise.negativeContaminationRate * scoreWeights.negativeContaminationPenalty -
        noise.singleEraShare * scoreWeights.singleEraPenalty -
        failedBreakoutPenalty * scoreWeights.failedBreakoutPenalty -
        featureBehavior.gapFillThenRevertScoreMedian * scoreWeights.gapRevertPenalty -
        noise.noisePenalty * scoreWeights.overCommonNoisePenalty,
    )
    const prototypeLedgerCoverage =
      Number(prototypeLedgerStats?.prototypeLedgerCoverage ?? 0) || 0
    const prototypeQualityMedian =
      Number(prototypeLedgerStats?.prototypeQualityMedian ?? NaN)
    const c0Score = clamp01(
      c0ScoreBase +
        featureBehavior.gapFillThenContinueScoreMedian * scoreWeights.gapContinueBonus +
        featureBehavior.executionFeasibilityMedian * scoreWeights.executionFeasibilityBonus +
        (Number.isFinite(prototypeQualityMedian) ? prototypeQualityMedian : 0) *
          prototypeLedgerCoverage *
          scoreWeights.prototypeQualityBonus +
        Number(prototypeLedgerStats?.corePrototypeShare ?? 0) * scoreWeights.corePrototypeShareBonus -
        Number(prototypeLedgerStats?.penaltyPrototypeShare ?? 0) * scoreWeights.penaltyPrototypePenalty -
        Number(prototypeLedgerStats?.quarantinePrototypeShare ?? 0) * scoreWeights.quarantinePrototypePenalty,
    )
    const familyRepresentativeTemplateIds = ordered
      .slice()
      .sort((left, right) => Number(right?.label ?? 0) - Number(left?.label ?? 0))
      .slice(0, 3)
      .map((row) => row.templateId)
    const positiveCount = Number(noise?.positiveCount ?? ordered.filter((row) => row.label === 1).length) || 0
    const negativeCount = Number(noise?.negativeCount ?? matchedNegativeRows.length) || 0
    const symbolCount = new Set(ordered.map((row) => String(row?.symbol ?? "").trim()).filter(Boolean)).size
    return {
      familyId,
      signature,
      support: recurrence.support,
      supportRatio: recurrence.supportRatio,
      symbolCoverage: recurrence.symbolCoverage,
      symbolCount,
      eraCoverageRatio: recurrence.eraCoverageRatio,
      effectiveEraCount: temporalDiversity.effectiveEraCount,
      effectiveEraCountRatio: temporalDiversity.effectiveEraCountRatio,
      normalizedEraEntropy: temporalDiversity.normalizedEraEntropy,
      lowDiversityPenalty: temporalDiversity.lowDiversityPenalty,
      regimeCoverageRatio: recurrence.regimeCoverageRatio,
      shapeCohesionScore: Number(cohesion?.shapeScore ?? 0) || 0,
      featureCohesionScore: Number(cohesion?.averageTotal ?? 0) || 0,
      recurrenceScore: recurrence.recurrenceScore,
      negativeContaminationRate: noise.negativeContaminationRate,
      singleEraShare: noise.singleEraShare,
      dominantEraId: noise.dominantEraId,
      noisePenalty: noise.noisePenalty,
      failedBreakoutCount20Median: featureBehavior.failedBreakoutCount20Median,
      gapFillThenContinueScoreMedian: featureBehavior.gapFillThenContinueScoreMedian,
      gapFillThenRevertScoreMedian: featureBehavior.gapFillThenRevertScoreMedian,
      executionFeasibilityMedian: featureBehavior.executionFeasibilityMedian,
      c0Score,
      corePrototypeShare: Number(prototypeLedgerStats?.corePrototypeShare ?? 0) || 0,
      penaltyPrototypeShare: Number(prototypeLedgerStats?.penaltyPrototypeShare ?? 0) || 0,
      quarantinePrototypeShare: Number(prototypeLedgerStats?.quarantinePrototypeShare ?? 0) || 0,
      retiredPrototypeShare: Number(prototypeLedgerStats?.retiredPrototypeShare ?? 0) || 0,
      prototypeLedgerMatchedCount: Number(prototypeLedgerStats?.prototypeLedgerMatchedCount ?? 0) || 0,
      prototypeLedgerCoverage: Number(prototypeLedgerStats?.prototypeLedgerCoverage ?? 0) || 0,
      prototypeQualityMedian: Number(prototypeLedgerStats?.prototypeQualityMedian ?? 0) || 0,
      prototypeQualityMean: Number(prototypeLedgerStats?.prototypeQualityMean ?? 0) || 0,
      prototypeLedgerConfidenceMean:
        Number(prototypeLedgerStats?.prototypeLedgerConfidenceMean ?? 0) || 0,
      status: "UNSET",
      shortlisted: false,
      positiveCount,
      negativeCount,
      familyBuildSource: c0Cfg.familyBuildSource,
      templateKindMix: {
        positive: positiveCount,
        negative: negativeCount
      },
      dominantTemplateKind:
        ordered[0]?.c0DominantTemplateKind ?? buildFamilyTemplateKindMixKey(ordered).dominantTemplateKind,
      dominantTemplateKindShare:
        Number(ordered[0]?.c0DominantTemplateKindShare ?? 0) || 0,
      templateKindMixKey:
        ordered[0]?.c0FamilyTemplateKindMixKey ?? buildFamilyTemplateKindMixKey(ordered).templateKindMixKey,
      regimeKeys: Array.from(regimeKeys).sort((a, b) => a.localeCompare(b)),
      eraIds: Array.from(eraIds).sort((a, b) => a.localeCompare(b)),
      familyRepresentativeTemplateIds
    }
  })
  const shortlist = buildFamilyShortlist({
    families,
    cfg: c0Cfg
  })
  const shortlistedFamilyIds = new Set(shortlist.shortlisted.map((row) => row.familyId))
  const shortlistedPositiveTemplateCount = familyBuildRows.filter((row) =>
    shortlistedFamilyIds.has(families.find((family) => family.signature === row.c0FamilySignature)?.familyId),
  ).length
  const shortlistedNegativeMatchCount = negativeRows.filter((row) =>
    shortlistedFamilyIds.has(families.find((family) => family.signature === row.c0FamilySignature)?.familyId),
  ).length
  const shortlistedTemplateCount = shortlistedPositiveTemplateCount
  const dominantShortlistedFamilyShare = shortlist.shortlisted.length
    ? Math.max(...shortlist.shortlisted.map((row) => Number(row?.supportRatio ?? 0)), 0)
    : 0
  const shortlistedNegativeContaminationRate =
    shortlist.shortlisted.length > 0
      ? average(
          shortlist.shortlisted.map((row) => Number(row?.negativeContaminationRate ?? 0)),
        ) ?? 0
      : 0
  const fallbackUsed =
    shortlist.backfilled > 0 ||
    shortlist.shortlisted.length < Math.max(1, c0Cfg.familyBackfillFloor) ||
    shortlistedTemplateCount < c0Cfg.minFamilySupport
  const c0GateFailed =
    shortlist.shortlisted.length < 1 ||
    dominantShortlistedFamilyShare > c0Cfg.maxFamilyShare ||
    shortlist.shortlisted.every((row) => Number(row?.eraCoverageRatio ?? 0) < c0Cfg.minEraCoverageRatio) ||
    shortlistedNegativeContaminationRate > c0Cfg.maxNegativeContaminationRate
  const familyBySignature = new Map(families.map((family) => [family.signature, family]))
  const membershipRows = rows.map((row) => {
    const family = familyBySignature.get(String(row?.c0FamilySignature ?? "")) ?? null
    return {
      templateId: row.templateId,
      familyId: family?.familyId ?? null,
      familySignature: row.c0FamilySignature ?? null,
      familyRank:
        family && shortlistedFamilyIds.has(family.familyId)
          ? shortlist.shortlisted.findIndex((entry) => entry.familyId === family.familyId) + 1
          : null,
      shortlisted: family ? shortlistedFamilyIds.has(family.familyId) : false,
      familyStatus: family?.status ?? null,
      c0Score: Number(family?.c0Score ?? 0) || 0,
      corePrototypeShare: Number(family?.corePrototypeShare ?? 0) || 0,
      penaltyPrototypeShare: Number(family?.penaltyPrototypeShare ?? 0) || 0,
      quarantinePrototypeShare: Number(family?.quarantinePrototypeShare ?? 0) || 0,
      prototypeQualityMedian: Number(family?.prototypeQualityMedian ?? 0) || 0,
      memberRole:
        row.label === 1
          ? family
            ? "POSITIVE_SEED"
            : "UNASSIGNED_POSITIVE"
          : family
            ? "NEGATIVE_MATCH"
            : "UNASSIGNED_NEGATIVE",
      familyBuildIncluded:
        family && (c0Cfg.familyBuildSource === "all_templates" || row.label === 1) ? true : false
    }
  })
  const familyIndexPath = path.join(outDir, "c0_family_index.json")
  const membershipPath = path.join(outDir, "c0_family_membership.jsonl")
  const summaryPath = path.join(outDir, "c0_summary.json")
  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    enabled: true,
    sourceStepBPath: inPath,
    sourceStepBRunId: stepBSourceRunId,
    sourceStepBRunDir: stepBSourceRunDir,
    inputMode,
    familyBuildSource: c0Cfg.familyBuildSource,
    familyCount: families.length,
    shortlistedFamilyCount: shortlist.shortlisted.length,
    shortlistedTemplateCount,
    shortlistedNegativeMatchCount,
    familyBuildTemplateCount: familyBuildRows.length,
    prototypeLedgerPath: prototypeLedger?.path ?? null,
    c0Gate: {
      enabled: true,
      failed: c0GateFailed,
      reason:
        shortlist.shortlisted.length < 1
          ? "NO_SHORTLISTED_FAMILY"
          : dominantShortlistedFamilyShare > c0Cfg.maxFamilyShare
            ? "DOMINANT_FAMILY_SHARE_TOO_HIGH"
            : shortlist.shortlisted.every((row) => Number(row?.eraCoverageRatio ?? 0) < c0Cfg.minEraCoverageRatio)
              ? "ERA_COVERAGE_TOO_LOW"
              : shortlistedNegativeContaminationRate > c0Cfg.maxNegativeContaminationRate
                ? "NEGATIVE_CONTAMINATION_TOO_HIGH"
              : "PASS",
      fallbackUsed,
      metrics: {
        dominantShortlistedFamilyShare,
        shortlistedNegativeContaminationRate
      },
      thresholds: {
        maxFamilyShare: c0Cfg.maxFamilyShare,
        minEraCoverageRatio: c0Cfg.minEraCoverageRatio,
        minEffectiveEraCountRatio: c0Cfg.minEffectiveEraCountRatio,
        minNormalizedEraEntropy: c0Cfg.minNormalizedEraEntropy,
        maxNegativeContaminationRate: c0Cfg.maxNegativeContaminationRate
      }
    },
    shortlistPolicy: {
      shortlistFamilyCount: c0Cfg.shortlistFamilyCount,
      familyBackfillFloor: c0Cfg.familyBackfillFloor,
      familyBackfillMax: c0Cfg.familyBackfillMax,
      minEraCoverageRatioForBackfill: c0Cfg.minEraCoverageRatioForBackfill,
      minEffectiveEraCountRatioForBackfill: c0Cfg.minEffectiveEraCountRatioForBackfill,
      minNormalizedEraEntropyForBackfill: c0Cfg.minNormalizedEraEntropyForBackfill,
      maxSingleEraShareForBackfill: c0Cfg.maxSingleEraShareForBackfill
    },
    familySignaturePolicy: c0Cfg.familySignature,
    membershipPath,
    summaryPath,
    families
  }
  const summary = {
    step: "C0",
    enabled: true,
    inputMode,
    inputPath: inPath,
    stepBSourceRunId,
    stepBSourceRunDir,
    localWindow,
    globalWindow,
    familyBuildSource: c0Cfg.familyBuildSource,
    templates: rows.length,
    positiveTemplates: positiveRows.length,
    negativeTemplates: negativeRows.length,
    familyBuildTemplates: familyBuildRows.length,
    families: families.length,
    shortlistedFamilies: shortlist.shortlisted.length,
    shortlistedTemplateCount,
    shortlistedNegativeMatchCount,
    droppedLowSupportFamilies: shortlist.droppedLowSupportFamilies,
    droppedLowCohesionFamilies: shortlist.droppedLowCohesionFamilies,
    droppedHighNoiseFamilies: shortlist.droppedHighNoiseFamilies,
    droppedLowEraDiversityFamilies: shortlist.droppedLowEraDiversityFamilies,
    droppedEraDominanceFamilies: shortlist.droppedEraDominanceFamilies,
    avgFamilySupport: average(families.map((row) => row.support)) ?? 0,
    avgFamilyC0Score: average(families.map((row) => row.c0Score)) ?? 0,
    avgFamilyPrototypeQualityMedian:
      average(families.map((row) => row.prototypeQualityMedian)) ?? 0,
    avgFamilyCorePrototypeShare:
      average(families.map((row) => row.corePrototypeShare)) ?? 0,
    avgFamilyPenaltyPrototypeShare:
      average(families.map((row) => row.penaltyPrototypeShare)) ?? 0,
    avgFamilyQuarantinePrototypeShare:
      average(families.map((row) => row.quarantinePrototypeShare)) ?? 0,
    avgEffectiveEraCountRatio:
      average(families.map((row) => row.effectiveEraCountRatio)) ?? 0,
    avgNormalizedEraEntropy:
      average(families.map((row) => row.normalizedEraEntropy)) ?? 0,
    avgFailedBreakoutCount20Median:
      average(families.map((row) => row.failedBreakoutCount20Median)) ?? 0,
    avgGapFillThenContinueScoreMedian:
      average(families.map((row) => row.gapFillThenContinueScoreMedian)) ?? 0,
    avgGapFillThenRevertScoreMedian:
      average(families.map((row) => row.gapFillThenRevertScoreMedian)) ?? 0,
    avgExecutionFeasibilityMedian:
      average(families.map((row) => row.executionFeasibilityMedian)) ?? 0,
    dominantShortlistedFamilyShare,
    shortlistedNegativeContaminationRate,
    gate: index.c0Gate,
    featureSchemaValid: true,
    requiredFeatureKeys: REQUIRED_C0_FEATURE_KEYS,
    shortlistPolicy: index.shortlistPolicy,
    familySignaturePolicy: c0Cfg.familySignature,
    familyPlan: {
      globalKeys: globalPlan.keys,
      featureKeys: featurePlan.keys,
      eras: eraPlan.eras
    },
    outputPaths: {
      familyIndexPath,
      membershipPath,
      summaryPath
    }
  }
  await writeJson(familyIndexPath, index)
  await writeJsonl(membershipPath, membershipRows)
  await writeJson(summaryPath, summary)
  return {
    step: "C0",
    familyIndexPath,
    membershipPath,
    summaryPath,
    summary
  }
}
