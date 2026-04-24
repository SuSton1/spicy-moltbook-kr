import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { normalizeDateKey } from "./date.mjs"
import { createJsonlWriter, ensureDir, iterateJsonl, pathExists, writeJson } from "./io.mjs"
import {
  computeTp12NoStopTargetLabelsForDecision,
  TP12_NO_STOP_TARGET_CONTRACT_KIND,
  TP12_NO_STOP_TARGET_SPECS,
} from "./tp12_no_stop_target_contract.mjs"
import {
  buildTp12SideDailyRequestedSets,
  loadTp12SideDailyCandleIndex,
  readTp12SideDailyManifestRows,
} from "./tp12_side_daily_feature_builder.mjs"


export const TP12_SIDE_DAILY_CONTROL_FEATURE_PACK_KIND = "tp12_side_daily_control_feature_pack_v1"
export const TP12_SIDE_DAILY_CONTROL_LABEL_DATASET_KIND = "tp12_side_daily_control_label_dataset_v1"
export const TP12_SIDE_DAILY_CONTROL_ARTIFACT_KIND = "tp12_side_daily_control_artifact_v1"
export const TP12_SIDE_DAILY_CONTROL_ID = "daily_only_no_stop"

const toText = (value) => String(value ?? "").trim()

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

const assertDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
}

const pairKey = (symbol, decisionDateKey) => `${toText(symbol)}::${assertDateKey(decisionDateKey, "decisionDateKey")}`

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

const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex")

const resolveTargetSpecs = (targetLabelIds) => {
  const requested = uniqueSorted(
    Array.isArray(targetLabelIds) && targetLabelIds.length > 0
      ? targetLabelIds
      : TP12_NO_STOP_TARGET_SPECS.map((spec) => spec.labelId),
  )
  if (requested.length < 1) {
    throw new Error("At least one targetLabelId is required")
  }
  const specById = new Map(TP12_NO_STOP_TARGET_SPECS.map((spec) => [String(spec.labelId), spec]))
  const resolved = requested.map((labelId) => {
    const spec = specById.get(labelId)
    if (!spec) {
      throw new Error(`Unsupported no-stop target labelId=${labelId}`)
    }
    return spec
  })
  return {
    targetLabelIds: requested,
    targetSpecs: resolved,
  }
}

const buildDailySeries = (candleIndex, manifestRow) => {
  const symbolMap = candleIndex.get(manifestRow.symbol)
  if (!symbolMap) {
    throw new Error(`Missing candle series for ${manifestRow.symbol}`)
  }
  const seriesDateKeys = manifestRow.windowDateKeys.slice(1)
  return seriesDateKeys.map((dateKey) => {
    const row = symbolMap.get(dateKey)
    if (!row) {
      throw new Error(`Missing daily series candle for ${manifestRow.symbol}:${dateKey}`)
    }
    return row
  })
}

const loadFeaturePackIndex = async (featurePackPath, { decisionFrom = null, decisionTo = null, manifestPairSet } = {}) => {
  if (!pathExists(featurePackPath)) {
    throw new Error(`Missing feature pack path: ${featurePackPath}`)
  }
  const byPair = new Map()
  await iterateJsonl(featurePackPath, {
    strict: true,
    onRow: async (row) => {
      const symbol = toText(row?.symbol)
      const decisionDateKey = assertDateKey(row?.decisionDateKey, "feature pack decisionDateKey")
      if (decisionFrom && decisionDateKey < decisionFrom) return
      if (decisionTo && decisionDateKey > decisionTo) return
      const joinKey = pairKey(symbol, decisionDateKey)
      if (!manifestPairSet.has(joinKey)) return
      if (byPair.has(joinKey)) {
        throw new Error(`Duplicate feature pack row for ${joinKey}`)
      }
      byPair.set(joinKey, row)
    },
  })
  return byPair
}

const buildControlFeaturePackRow = ({ baseRow, manifestRow, targetLabelIds }) => {
  const contextualTokens = Array.isArray(baseRow?.contextualTokens) ? [...baseRow.contextualTokens] : []
  if (baseRow?.sideDailyControl && typeof baseRow.sideDailyControl === "object") {
    throw new Error(`Feature pack row already contains sideDailyControl metadata for ${manifestRow.symbol}:${manifestRow.decisionDateKey}`)
  }
  return {
    ...baseRow,
    contextualTokens: uniqueSorted([
      ...contextualTokens,
      `tag:sideDailyControl.kind:${TP12_SIDE_DAILY_CONTROL_FEATURE_PACK_KIND}`,
      `tag:sideDailyControlId:${TP12_SIDE_DAILY_CONTROL_ID}`,
    ]),
    sideDailyControl: {
      kind: TP12_SIDE_DAILY_CONTROL_FEATURE_PACK_KIND,
      controlId: TP12_SIDE_DAILY_CONTROL_ID,
      requestId: manifestRow.requestId,
      stepALaneId: manifestRow.stepALaneId,
      prevDateKey: manifestRow.prevDateKey,
      featureCutoffDateKey: manifestRow.decisionDateKey,
      labelContractKind: TP12_NO_STOP_TARGET_CONTRACT_KIND,
      targetLabelIds,
    },
  }
}

const classifySplitBucket = (decisionDateKey, split) => {
  if (decisionDateKey >= split.trainDateFrom && decisionDateKey <= split.trainDateTo) return "train"
  if (decisionDateKey >= split.oosDateFrom && decisionDateKey <= split.oosDateTo) return "oos"
  throw new Error(
    `Decision date ${decisionDateKey} is outside frozen train/oos ranges train=${split.trainDateFrom}:${split.trainDateTo} oos=${split.oosDateFrom}:${split.oosDateTo}`,
  )
}

export const buildTp12SideDailyControlArtifact = async ({
  manifestPath,
  featurePackPath,
  candlePath,
  outPath,
  labelOutPath,
  summaryOutPath,
  researchContract = null,
  decisionFrom = null,
  decisionTo = null,
  trainDateFrom,
  trainDateTo,
  oosDateFrom,
  oosDateTo,
  stepALaneSet = [],
  targetLabelIds = TP12_NO_STOP_TARGET_SPECS.map((spec) => spec.labelId),
  allowlistPolicy,
  commonSupportPolicy,
} = {}) => {
  const resolvedManifestPath = path.resolve(manifestPath)
  const resolvedFeaturePackPath = path.resolve(featurePackPath)
  const resolvedCandlePath = path.resolve(candlePath)
  const resolvedOutPath = path.resolve(outPath)
  const resolvedLabelOutPath = path.resolve(labelOutPath)
  const resolvedSummaryOutPath = path.resolve(summaryOutPath)
  const normalizedDecisionFrom = decisionFrom ? assertDateKey(decisionFrom, "decisionFrom") : null
  const normalizedDecisionTo = decisionTo ? assertDateKey(decisionTo, "decisionTo") : null
  const split = {
    trainDateFrom: assertDateKey(trainDateFrom, "trainDateFrom"),
    trainDateTo: assertDateKey(trainDateTo, "trainDateTo"),
    oosDateFrom: assertDateKey(oosDateFrom, "oosDateFrom"),
    oosDateTo: assertDateKey(oosDateTo, "oosDateTo"),
  }
  if (split.trainDateFrom > split.trainDateTo) {
    throw new Error(`Invalid train range ${split.trainDateFrom}:${split.trainDateTo}`)
  }
  if (split.oosDateFrom > split.oosDateTo) {
    throw new Error(`Invalid oos range ${split.oosDateFrom}:${split.oosDateTo}`)
  }
  if (!(split.trainDateTo < split.oosDateFrom)) {
    throw new Error(`Frozen split must not overlap: trainEnd=${split.trainDateTo} oosStart=${split.oosDateFrom}`)
  }
  const resolvedAllowlistPolicy = toText(allowlistPolicy)
  const resolvedCommonSupportPolicy = toText(commonSupportPolicy)
  if (!resolvedAllowlistPolicy) {
    throw new Error("allowlistPolicy is required")
  }
  if (!resolvedCommonSupportPolicy) {
    throw new Error("commonSupportPolicy is required")
  }
  const resolvedLaneSet = uniqueSorted(stepALaneSet)
  if (resolvedLaneSet.length < 1) {
    throw new Error("stepALaneSet is required")
  }
  const { targetLabelIds: resolvedTargetLabelIds, targetSpecs } = resolveTargetSpecs(targetLabelIds)

  const manifestRows = await readTp12SideDailyManifestRows(resolvedManifestPath, {
    decisionFrom: normalizedDecisionFrom,
    decisionTo: normalizedDecisionTo,
  })
  const manifestPairToRow = new Map()
  const manifestLaneSet = new Set()
  for (const row of manifestRows) {
    const joinKey = pairKey(row.symbol, row.decisionDateKey)
    if (manifestPairToRow.has(joinKey)) {
      throw new Error(`Manifest slice must be pair-unique for control artifact: duplicate ${joinKey}`)
    }
    manifestPairToRow.set(joinKey, row)
    manifestLaneSet.add(row.stepALaneId)
  }
  const discoveredLaneSet = uniqueSorted(Array.from(manifestLaneSet))
  if (JSON.stringify(discoveredLaneSet) !== JSON.stringify(resolvedLaneSet)) {
    throw new Error(
      `stepALaneSet mismatch: expected=${JSON.stringify(resolvedLaneSet)} actual=${JSON.stringify(discoveredLaneSet)}`,
    )
  }

  const requestedSets = buildTp12SideDailyRequestedSets(manifestRows)
  const candleIndex = await loadTp12SideDailyCandleIndex(
    resolvedCandlePath,
    requestedSets.symbolSet,
    requestedSets.requestedPairSet,
  )
  const featurePackIndex = await loadFeaturePackIndex(resolvedFeaturePackPath, {
    decisionFrom: normalizedDecisionFrom,
    decisionTo: normalizedDecisionTo,
    manifestPairSet: new Set(manifestPairToRow.keys()),
  })

  const controlWriter = await createJsonlWriter(resolvedOutPath)
  const labelWriter = await createJsonlWriter(resolvedLabelOutPath)
  let rowCount = 0
  let trainRowCount = 0
  let oosRowCount = 0
  let firstDecisionDateKey = null
  let lastDecisionDateKey = null
  const matchedPairs = []
  try {
    for (const manifestRow of manifestRows) {
      const joinKey = pairKey(manifestRow.symbol, manifestRow.decisionDateKey)
      const baseRow = featurePackIndex.get(joinKey)
      if (!baseRow) {
        throw new Error(`Missing feature pack coverage for manifest pair ${joinKey}`)
      }
      const splitBucket = classifySplitBucket(manifestRow.decisionDateKey, split)
      const controlRow = buildControlFeaturePackRow({
        baseRow,
        manifestRow,
        targetLabelIds: resolvedTargetLabelIds,
      })
      const dailySeries = buildDailySeries(candleIndex, manifestRow)
      const targetContract = computeTp12NoStopTargetLabelsForDecision({
        series: dailySeries,
        decisionIdx: 0,
        targetSpecs,
      })
      const labelRow = {
        kind: TP12_SIDE_DAILY_CONTROL_LABEL_DATASET_KIND,
        controlId: TP12_SIDE_DAILY_CONTROL_ID,
        requestId: manifestRow.requestId,
        symbol: manifestRow.symbol,
        decisionDateKey: manifestRow.decisionDateKey,
        prevDateKey: manifestRow.prevDateKey,
        asOfDateKey: manifestRow.asOfDateKey,
        stepALaneId: manifestRow.stepALaneId,
        runId: manifestRow.runId,
        eventLabel: manifestRow.eventLabel,
        splitBucket,
        targetLabelIds: resolvedTargetLabelIds,
        labels: targetContract.labels,
        labelContractKind: TP12_NO_STOP_TARGET_CONTRACT_KIND,
        windowDateKeys: manifestRow.windowDateKeys,
      }
      await controlWriter.writeRow(controlRow)
      await labelWriter.writeRow(labelRow)
      matchedPairs.push(joinKey)
      rowCount += 1
      if (splitBucket === "train") trainRowCount += 1
      if (splitBucket === "oos") oosRowCount += 1
      firstDecisionDateKey = firstDecisionDateKey ?? manifestRow.decisionDateKey
      lastDecisionDateKey = manifestRow.decisionDateKey
    }
  } finally {
    await controlWriter.close()
    await labelWriter.close()
  }

  if (rowCount < 1) {
    throw new Error("No control rows were written")
  }

  const summary = {
    status: "ok",
    kind: TP12_SIDE_DAILY_CONTROL_ARTIFACT_KIND,
    controlId: TP12_SIDE_DAILY_CONTROL_ID,
    manifestPath: resolvedManifestPath,
    featurePackPath: resolvedFeaturePackPath,
    candlePath: resolvedCandlePath,
    outPath: resolvedOutPath,
    labelOutPath: resolvedLabelOutPath,
    rowCount,
    trainRowCount,
    oosRowCount,
    decisionDateFrom: firstDecisionDateKey,
    decisionDateTo: lastDecisionDateKey,
    split,
    stepALaneSet: resolvedLaneSet,
    targetLabelIds: resolvedTargetLabelIds,
    allowlistPolicy: resolvedAllowlistPolicy,
    commonSupportPolicy: resolvedCommonSupportPolicy,
    researchContract:
      researchContract && typeof researchContract === "object"
        ? {
            kind: toText(researchContract.kind),
            contractId: toText(researchContract.contractId),
            scopeId: toText(researchContract.scopeId),
            contractPath: toText(researchContract.contractPath),
          }
        : null,
    pairSignatureSha256: sha256(matchedPairs.sort((left, right) => left.localeCompare(right)).join("\n")),
    manifestFingerprint: await buildFileFingerprint(resolvedManifestPath),
    featurePackFingerprint: await buildFileFingerprint(resolvedFeaturePackPath),
    candleFingerprint: await buildFileFingerprint(resolvedCandlePath),
    outFingerprint: await buildFileFingerprint(resolvedOutPath),
    labelOutFingerprint: await buildFileFingerprint(resolvedLabelOutPath),
    coverage: {
      manifestPairCount: manifestPairToRow.size,
      matchedPairCount: matchedPairs.length,
      featurePackMatchedPairCount: featurePackIndex.size,
    },
  }

  await ensureDir(path.dirname(resolvedSummaryOutPath))
  await writeJson(resolvedSummaryOutPath, summary)
  return {
    outPath: resolvedOutPath,
    labelOutPath: resolvedLabelOutPath,
    summaryOutPath: resolvedSummaryOutPath,
    summary,
  }
}
