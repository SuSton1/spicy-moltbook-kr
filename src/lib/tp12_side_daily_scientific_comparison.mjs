import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { normalizeDateKey } from "./date.mjs"
import { iterateJsonl, readJson, writeJson } from "./io.mjs"


export const TP12_SIDE_DAILY_SCIENTIFIC_CONTROL_PIPELINE_KIND = "tp12_side_daily_scientific_control_pipeline_v1"
export const TP12_SIDE_DAILY_SCIENTIFIC_SELECTION_MANIFEST_KIND = "tp12_side_daily_scientific_selection_manifest_v1"
export const TP12_SIDE_DAILY_SCIENTIFIC_COMPARISON_REPORT_KIND = "tp12_side_daily_scientific_comparison_report_v1"
export const TP12_SIDE_DAILY_BASELINE_VARIANT_ID = "daily_only_no_stop"

const SPLIT_BUCKETS = Object.freeze(["train", "oos"])

const toText = (value) => String(value ?? "").trim()

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

const ensureDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
}

const pairKey = (symbol, decisionDateKey) => `${toText(symbol)}::${ensureDateKey(decisionDateKey, "decisionDateKey")}`

const safeDiv = (numerator, denominator) => {
  const left = Number(numerator)
  const right = Number(denominator)
  if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(right) < 1e-12) return 0
  return left / right
}

const safeMean = (values) => {
  const numeric = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value))
  if (numeric.length < 1) return null
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length
}

const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex")

const buildFileFingerprint = async (filePath) => {
  const resolved = toText(filePath)
  if (!resolved) return null
  const stats = await fs.stat(resolved)
  return {
    path: resolved,
    size: Number(stats?.size ?? 0) || 0,
    mtimeMs: Math.floor(Number(stats?.mtimeMs ?? 0) || 0),
  }
}

const deltaNumberOrNull = (currentValue, baselineValue) => {
  const current = Number(currentValue)
  const baseline = Number(baselineValue)
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return null
  return current - baseline
}

const intersectSets = (left, right) => {
  const smaller = left.size <= right.size ? left : right
  const larger = left.size <= right.size ? right : left
  const out = new Set()
  for (const value of smaller) {
    if (larger.has(value)) out.add(value)
  }
  return out
}

const filterSet = (source, predicate) => {
  const out = new Set()
  for (const value of source) {
    if (predicate(value)) out.add(value)
  }
  return out
}

const sortSetValues = (source) => Array.from(source).sort((left, right) => String(left).localeCompare(String(right)))

const readRequiredJson = async (filePath, label) => {
  const resolved = path.resolve(filePath)
  const value = await readJson(resolved, null)
  if (!value || typeof value !== "object") {
    throw new Error(`Missing or invalid ${label}: ${resolved}`)
  }
  return value
}

const resolveVariantPath = (summaryPath, value) => {
  const text = toText(value)
  if (!text) return null
  return path.resolve(path.dirname(summaryPath), path.relative(path.dirname(summaryPath), text))
}

const hasExpectedBasename = (filePath, expectedBasename) =>
  toText(filePath).endsWith(String(expectedBasename ?? "").trim())

const normalizeLegacyControlVariantShape = (variant) => {
  const normalized = { ...variant }
  if (normalized.kind !== "control" || normalized.controlLabelPath) {
    return normalized
  }
  const legacyControlPackPath = [
    normalized.sideFeatureSummaryPath,
    normalized.bridgedFeaturePackPath,
    normalized.controlPackPath,
  ].find((filePath) => hasExpectedBasename(filePath, "decision_candidates_feature_pack_control.jsonl")) ?? null
  const legacyControlLabelPath = [
    normalized.bridgedFeaturePackPath,
    normalized.controlPackPath,
    normalized.controlLabelPath,
  ].find((filePath) => hasExpectedBasename(filePath, "no_stop_label_rows.jsonl")) ?? null
  const legacyControlSummaryPath = [
    normalized.controlPackPath,
    normalized.controlLabelPath,
    normalized.controlSummaryPath,
  ].find((filePath) => hasExpectedBasename(filePath, "control_summary.json")) ?? null
  if (!legacyControlPackPath || !legacyControlLabelPath) {
    return normalized
  }
  normalized.sideFeaturePath = null
  normalized.sideFeatureSummaryPath = null
  normalized.bridgedFeaturePackPath = null
  normalized.controlPackPath = legacyControlPackPath
  normalized.controlLabelPath = legacyControlLabelPath
  normalized.controlSummaryPath = legacyControlSummaryPath
  return normalized
}

const resolveSelectionDecisionDateKey = (row) =>
  ensureDateKey(row?.decisionDateKey ?? row?.recommendationDateKey ?? row?.dateKey, "selection decisionDateKey")

export const loadTp12SideDailyScientificControlPipelineSummary = async ({
  pipelineSummaryPath,
  cwd = process.cwd(),
} = {}) => {
  const resolvedPath = path.resolve(cwd, toText(pipelineSummaryPath))
  const summary = await readRequiredJson(resolvedPath, "scientific control pipeline summary")
  if (toText(summary.kind) !== TP12_SIDE_DAILY_SCIENTIFIC_CONTROL_PIPELINE_KIND) {
    throw new Error(`Unsupported scientific control pipeline kind=${summary.kind}`)
  }
  const variants = Array.isArray(summary.variants) ? summary.variants : []
  if (variants.length < 2) {
    throw new Error(`Scientific control pipeline must carry at least two variants: ${resolvedPath}`)
  }
  const normalizedVariants = variants.map((variant) => {
    const variantId = toText(variant?.variantId)
    const normalizedVariant = normalizeLegacyControlVariantShape({
      variantId,
      kind: toText(variant?.kind),
      gateId: toText(variant?.gateId),
      datasetIds: uniqueSorted(variant?.datasetIds),
      sideFeaturePath: resolveVariantPath(resolvedPath, variant?.sideFeaturePath),
      sideFeatureSummaryPath: resolveVariantPath(resolvedPath, variant?.sideFeatureSummaryPath),
      bridgedFeaturePackPath: resolveVariantPath(resolvedPath, variant?.bridgedFeaturePackPath),
      controlPackPath: resolveVariantPath(resolvedPath, variant?.controlPackPath),
      controlLabelPath: resolveVariantPath(resolvedPath, variant?.controlLabelPath),
      controlSummaryPath: resolveVariantPath(resolvedPath, variant?.controlSummaryPath),
    })
    if (!variantId || !normalizedVariant.controlLabelPath) {
      throw new Error(`Malformed scientific control pipeline variant in ${resolvedPath}`)
    }
    return normalizedVariant
  })
  const baseline = normalizedVariants.find((variant) => variant.variantId === TP12_SIDE_DAILY_BASELINE_VARIANT_ID)
  if (!baseline) {
    throw new Error(`Scientific control pipeline summary is missing baseline variant=${TP12_SIDE_DAILY_BASELINE_VARIANT_ID}`)
  }
  return {
    path: resolvedPath,
    summary,
    variants: normalizedVariants,
  }
}

export const loadTp12SideDailyScientificSelectionManifest = async ({
  selectionManifestPath,
  expectedVariantIds,
  cwd = process.cwd(),
} = {}) => {
  const resolvedPath = path.resolve(cwd, toText(selectionManifestPath))
  const manifest = await readRequiredJson(resolvedPath, "scientific selection manifest")
  if (toText(manifest.kind) !== TP12_SIDE_DAILY_SCIENTIFIC_SELECTION_MANIFEST_KIND) {
    throw new Error(`Unsupported scientific selection manifest kind=${manifest.kind}`)
  }
  const variants = Array.isArray(manifest.variants) ? manifest.variants : []
  const normalizedVariants = variants.map((variant) => {
    const variantId = toText(variant?.variantId)
    const selectionPath = toText(variant?.selectionPath)
    if (!variantId || !selectionPath) {
      throw new Error(`Malformed scientific selection manifest variant in ${resolvedPath}`)
    }
    return {
      variantId,
      selectionPath: path.resolve(path.dirname(resolvedPath), path.relative(path.dirname(resolvedPath), selectionPath)),
      selectionSummaryPath: toText(variant?.selectionSummaryPath)
        ? path.resolve(path.dirname(resolvedPath), path.relative(path.dirname(resolvedPath), toText(variant.selectionSummaryPath)))
        : null,
    }
  })
  const expectedIds = uniqueSorted(expectedVariantIds)
  const actualIds = uniqueSorted(normalizedVariants.map((variant) => variant.variantId))
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
    throw new Error(
      `Scientific selection manifest variants mismatch: expected=${JSON.stringify(expectedIds)} actual=${JSON.stringify(actualIds)}`,
    )
  }
  return {
    path: resolvedPath,
    manifest,
    variants: normalizedVariants,
  }
}

const loadLabelIndex = async (labelPath) => {
  const rowsByPair = new Map()
  const coverageBySplit = new Map(SPLIT_BUCKETS.map((bucket) => [bucket, new Set()]))
  let targetLabelIds = null
  await iterateJsonl(labelPath, {
    strict: true,
    onRow: async (row) => {
      const symbol = toText(row?.symbol)
      const decisionDateKey = ensureDateKey(row?.decisionDateKey, "label decisionDateKey")
      const splitBucket = toText(row?.splitBucket)
      if (!coverageBySplit.has(splitBucket)) {
        throw new Error(`Unsupported splitBucket=${splitBucket} in ${labelPath}`)
      }
      const labels = row?.labels
      if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
        throw new Error(`Label row is missing labels object for ${symbol}:${decisionDateKey}`)
      }
      const rowTargetLabelIds = uniqueSorted(row?.targetLabelIds)
      if (rowTargetLabelIds.length < 1) {
        throw new Error(`Label row is missing targetLabelIds for ${symbol}:${decisionDateKey}`)
      }
      if (targetLabelIds === null) {
        targetLabelIds = rowTargetLabelIds
      } else if (JSON.stringify(targetLabelIds) !== JSON.stringify(rowTargetLabelIds)) {
        throw new Error(`Inconsistent targetLabelIds in ${labelPath}`)
      }
      const joinKey = pairKey(symbol, decisionDateKey)
      if (rowsByPair.has(joinKey)) {
        throw new Error(`Duplicate label row for ${joinKey} in ${labelPath}`)
      }
      coverageBySplit.get(splitBucket).add(joinKey)
      rowsByPair.set(joinKey, {
        symbol,
        decisionDateKey,
        splitBucket,
        targetLabelIds: rowTargetLabelIds,
        labels,
      })
    },
  })
  if (rowsByPair.size < 1) {
    throw new Error(`No label rows loaded from ${labelPath}`)
  }
  return {
    rowsByPair,
    coverageBySplit,
    targetLabelIds: targetLabelIds ?? [],
  }
}

const loadSelectionKeySet = async (selectionPath) => {
  const selectedKeys = new Set()
  await iterateJsonl(selectionPath, {
    strict: true,
    onRow: async (row) => {
      const symbol = toText(row?.symbol)
      const decisionDateKey = resolveSelectionDecisionDateKey(row)
      const joinKey = pairKey(symbol, decisionDateKey)
      if (selectedKeys.has(joinKey)) {
        throw new Error(`Duplicate scientific selection row for ${joinKey} in ${selectionPath}`)
      }
      selectedKeys.add(joinKey)
    },
  })
  return selectedKeys
}

const assertSelectionCoverage = ({ variantId, selectedKeys, labelIndex, selectionPath }) => {
  for (const joinKey of selectedKeys) {
    if (!labelIndex.rowsByPair.has(joinKey)) {
      throw new Error(`Selection row ${joinKey} for variant=${variantId} is outside frozen label coverage: ${selectionPath}`)
    }
  }
}

const buildMetricPayload = ({ selectedKeys, labelIndex, targetLabelIds, splitBucket }) => {
  const rows = sortSetValues(selectedKeys)
    .map((joinKey) => labelIndex.rowsByPair.get(joinKey))
    .filter((row) => row?.splitBucket === splitBucket)
  const selectedRowCount = rows.length
  const uniqueDecisionDates = uniqueSorted(rows.map((row) => row?.decisionDateKey))
  const uniqueSymbols = uniqueSorted(rows.map((row) => row?.symbol))
  const dateCounts = new Map()
  for (const row of rows) {
    dateCounts.set(row.decisionDateKey, Number(dateCounts.get(row.decisionDateKey) ?? 0) + 1)
  }
  const top1DateShare =
    selectedRowCount > 0 ? Math.max(...Array.from(dateCounts.values()).map((count) => count / selectedRowCount)) : 0
  const metricsByLabel = {}
  for (const labelId of targetLabelIds) {
    const hitKey = labelId
    const terminalKey = `${labelId}_terminal_ret`
    const maxHighKey = `${labelId}_max_high_ret`
    const minLowKey = `${labelId}_min_low_ret`
    const hitRows = rows.filter((row) => Number(row?.labels?.[hitKey] ?? 0) === 1)
    metricsByLabel[labelId] = {
      selectedRows: selectedRowCount,
      hitRows: hitRows.length,
      hitRate: safeDiv(hitRows.length, selectedRowCount),
      uniqueDecisionDates: uniqueDecisionDates.length,
      uniqueSymbols: uniqueSymbols.length,
      avgTerminalRet: safeMean(rows.map((row) => row?.labels?.[terminalKey])),
      avgMaxHighRet: safeMean(rows.map((row) => row?.labels?.[maxHighKey])),
      avgMinLowRet: safeMean(rows.map((row) => row?.labels?.[minLowKey])),
      pairSignatureSha256: sha256(rows.map((row) => `${row.symbol}::${row.decisionDateKey}`).join("\n")),
    }
  }
  return {
    splitBucket,
    coveragePairCount: labelIndex.coverageBySplit.get(splitBucket)?.size ?? 0,
    selectedPairCount: selectedRowCount,
    uniqueDecisionDates: uniqueDecisionDates.length,
    uniqueSymbols: uniqueSymbols.length,
    top1DateShare,
    metricsByLabel,
  }
}

const buildMetricDeltaMap = ({ baselineMetricsByLabel, variantMetricsByLabel, targetLabelIds }) => {
  const deltas = {}
  for (const labelId of targetLabelIds) {
    const baseline = baselineMetricsByLabel?.[labelId] ?? {}
    const variant = variantMetricsByLabel?.[labelId] ?? {}
    deltas[labelId] = {
      selectedRowsDelta: deltaNumberOrNull(variant.selectedRows, baseline.selectedRows),
      hitRowsDelta: deltaNumberOrNull(variant.hitRows, baseline.hitRows),
      hitRateDelta: deltaNumberOrNull(variant.hitRate, baseline.hitRate),
      uniqueDecisionDatesDelta: deltaNumberOrNull(variant.uniqueDecisionDates, baseline.uniqueDecisionDates),
      uniqueSymbolsDelta: deltaNumberOrNull(variant.uniqueSymbols, baseline.uniqueSymbols),
      avgTerminalRetDelta: deltaNumberOrNull(variant.avgTerminalRet, baseline.avgTerminalRet),
      avgMaxHighRetDelta: deltaNumberOrNull(variant.avgMaxHighRet, baseline.avgMaxHighRet),
      avgMinLowRetDelta: deltaNumberOrNull(variant.avgMinLowRet, baseline.avgMinLowRet),
    }
  }
  return deltas
}

export const buildTp12SideDailyScientificComparisonReport = async ({
  pipelineSummaryPath,
  selectionManifestPath,
  outPath,
  cwd = process.cwd(),
} = {}) => {
  const resolvedOutPath = path.resolve(cwd, toText(outPath))
  const pipeline = await loadTp12SideDailyScientificControlPipelineSummary({ pipelineSummaryPath, cwd })
  const selectionManifest = await loadTp12SideDailyScientificSelectionManifest({
    selectionManifestPath,
    expectedVariantIds: pipeline.variants.map((variant) => variant.variantId),
    cwd,
  })

  const variantEntries = new Map()
  for (const pipelineVariant of pipeline.variants) {
    const selectionVariant = selectionManifest.variants.find((variant) => variant.variantId === pipelineVariant.variantId)
    const labelIndex = await loadLabelIndex(pipelineVariant.controlLabelPath)
    const selectedKeys = await loadSelectionKeySet(selectionVariant.selectionPath)
    assertSelectionCoverage({
      variantId: pipelineVariant.variantId,
      selectedKeys,
      labelIndex,
      selectionPath: selectionVariant.selectionPath,
    })
    variantEntries.set(pipelineVariant.variantId, {
      variantId: pipelineVariant.variantId,
      kind: pipelineVariant.kind,
      gateId: pipelineVariant.gateId,
      datasetIds: pipelineVariant.datasetIds,
      controlLabelPath: pipelineVariant.controlLabelPath,
      controlSummaryPath: pipelineVariant.controlSummaryPath,
      selectionPath: selectionVariant.selectionPath,
      selectionSummaryPath: selectionVariant.selectionSummaryPath,
      labelIndex,
      selectedKeys,
      targetLabelIds: labelIndex.targetLabelIds,
    })
  }

  const baseline = variantEntries.get(TP12_SIDE_DAILY_BASELINE_VARIANT_ID)
  if (!baseline) {
    throw new Error(`Missing baseline variant=${TP12_SIDE_DAILY_BASELINE_VARIANT_ID}`)
  }
  const targetLabelIds = baseline.targetLabelIds
  for (const entry of variantEntries.values()) {
    if (JSON.stringify(entry.targetLabelIds) !== JSON.stringify(targetLabelIds)) {
      throw new Error(`Target label mismatch for variant=${entry.variantId}`)
    }
  }

  const variants = []
  for (const entry of pipeline.variants.map((variant) => variantEntries.get(variant.variantId))) {
    const deploymentBySplit = {}
    for (const splitBucket of SPLIT_BUCKETS) {
      deploymentBySplit[splitBucket] = buildMetricPayload({
        selectedKeys: entry.selectedKeys,
        labelIndex: entry.labelIndex,
        targetLabelIds,
        splitBucket,
      })
    }

    let commonSupportVsBaseline = null
    let deploymentDeltaVsBaseline = null
    if (entry.variantId !== TP12_SIDE_DAILY_BASELINE_VARIANT_ID) {
      const commonSupportBySplit = {}
      const baselineCommonSupportBySplit = {}
      for (const splitBucket of SPLIT_BUCKETS) {
        const baselineCoverage = baseline.labelIndex.coverageBySplit.get(splitBucket) ?? new Set()
        const variantCoverage = entry.labelIndex.coverageBySplit.get(splitBucket) ?? new Set()
        const commonCoverage = intersectSets(baselineCoverage, variantCoverage)
        const baselineCoverageOnly = new Set([...baselineCoverage].filter((joinKey) => !commonCoverage.has(joinKey)))
        const variantCoverageOnly = new Set([...variantCoverage].filter((joinKey) => !commonCoverage.has(joinKey)))
        const baselineSelectedWithinCommon = intersectSets(baseline.selectedKeys, commonCoverage)
        const variantSelectedWithinCommon = intersectSets(entry.selectedKeys, commonCoverage)
        baselineCommonSupportBySplit[splitBucket] = buildMetricPayload({
          selectedKeys: baselineSelectedWithinCommon,
          labelIndex: baseline.labelIndex,
          targetLabelIds,
          splitBucket,
        })
        commonSupportBySplit[splitBucket] = {
          commonCoveragePairCount: commonCoverage.size,
          baselineCoverageOnlyPairCount: baselineCoverageOnly.size,
          variantCoverageOnlyPairCount: variantCoverageOnly.size,
          baseline: baselineCommonSupportBySplit[splitBucket],
          variant: buildMetricPayload({
            selectedKeys: variantSelectedWithinCommon,
            labelIndex: entry.labelIndex,
            targetLabelIds,
            splitBucket,
          }),
        }
        commonSupportBySplit[splitBucket].deltaVsBaseline = buildMetricDeltaMap({
          baselineMetricsByLabel: commonSupportBySplit[splitBucket].baseline.metricsByLabel,
          variantMetricsByLabel: commonSupportBySplit[splitBucket].variant.metricsByLabel,
          targetLabelIds,
        })
      }
      commonSupportVsBaseline = commonSupportBySplit
      deploymentDeltaVsBaseline = Object.fromEntries(
        SPLIT_BUCKETS.map((splitBucket) => [
          splitBucket,
          buildMetricDeltaMap({
            baselineMetricsByLabel: baseline.selectedKeys ? buildMetricPayload({
              selectedKeys: baseline.selectedKeys,
              labelIndex: baseline.labelIndex,
              targetLabelIds,
              splitBucket,
            }).metricsByLabel : {},
            variantMetricsByLabel: deploymentBySplit[splitBucket].metricsByLabel,
            targetLabelIds,
          }),
        ]),
      )
    }

    variants.push({
      variantId: entry.variantId,
      kind: entry.kind,
      gateId: entry.gateId,
      datasetIds: entry.datasetIds,
      targetLabelIds,
      controlLabelFingerprint: await buildFileFingerprint(entry.controlLabelPath),
      selectionFingerprint: await buildFileFingerprint(entry.selectionPath),
      deployment: deploymentBySplit,
      deploymentDeltaVsBaseline,
      commonSupportVsBaseline,
    })
  }

  const report = {
    kind: TP12_SIDE_DAILY_SCIENTIFIC_COMPARISON_REPORT_KIND,
    pipelineSummaryPath: pipeline.path,
    selectionManifestPath: selectionManifest.path,
    baselineVariantId: TP12_SIDE_DAILY_BASELINE_VARIANT_ID,
    contract: {
      contractId: toText(pipeline.summary?.contract?.contractId),
      contractPath: toText(pipeline.summary?.contract?.contractPath),
      commonSupportPolicy: toText(pipeline.summary?.commonSupportPolicy ?? pipeline.summary?.contract?.commonSupportPolicy ?? "pair_exact_intersection_v1"),
    },
    decisionWindow: pipeline.summary?.decisionWindow ?? null,
    split: pipeline.summary?.split ?? null,
    variants,
  }

  await fs.mkdir(path.dirname(resolvedOutPath), { recursive: true })
  await writeJson(resolvedOutPath, report)
  return {
    outPath: resolvedOutPath,
    report,
  }
}
