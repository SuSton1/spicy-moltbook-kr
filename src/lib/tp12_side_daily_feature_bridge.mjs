import fs from "node:fs/promises"

import { normalizeDateKey } from "./date.mjs"
import { createJsonlWriter, iterateJsonl, pathExists, writeJson } from "./io.mjs"
import { TP12_SIDE_DAILY_FEATURE_DATASET_KIND } from "./tp12_side_daily_feature_builder.mjs"


export const TP12_SIDE_DAILY_FEATURE_PACK_BRIDGE_KIND = "tp12_side_daily_feature_pack_bridge_v1"

const toText = (value) => String(value ?? "").trim()

const ensureDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
}

const toFiniteNumber = (value, label) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be finite: ${value ?? "<null>"}`)
  }
  return numeric
}

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

const featurePackJoinKey = (symbol, decisionDateKey) => `${toText(symbol)}::${ensureDateKey(decisionDateKey, "decisionDateKey")}`

const normalizeNumericFeatureMap = (featureMap, label) => {
  if (!featureMap || typeof featureMap !== "object" || Array.isArray(featureMap)) {
    throw new Error(`${label} must be an object`)
  }
  const normalized = {}
  for (const [key, value] of Object.entries(featureMap)) {
    const featureKey = toText(key)
    if (!featureKey) continue
    normalized[featureKey] = toFiniteNumber(value, `${label}.${featureKey}`)
  }
  if (Object.keys(normalized).length < 1) {
    throw new Error(`${label} is empty`)
  }
  return normalized
}

const buildPrefixedSideFeatures = (featureMap) => {
  const normalized = normalizeNumericFeatureMap(featureMap, "side features")
  const prefixed = {}
  for (const [key, value] of Object.entries(normalized)) {
    prefixed[`side.${key}`] = value
  }
  return prefixed
}

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

export const loadTp12SideDailyBridgeLookup = async (
  sideFeaturePath,
  { gateId, decisionFrom = null, decisionTo = null } = {},
) => {
  const resolvedPath = toText(sideFeaturePath)
  const resolvedGateId = toText(gateId)
  if (!resolvedPath) {
    throw new Error("sideFeaturePath is required")
  }
  if (!pathExists(resolvedPath)) {
    throw new Error(`Missing side-daily feature dataset: ${resolvedPath}`)
  }
  if (!resolvedGateId) {
    throw new Error("gateId is required")
  }
  const lookup = new Map()
  await iterateJsonl(resolvedPath, {
    strict: true,
    onRow: async (row) => {
      const kind = toText(row?.kind)
      if (kind && kind !== TP12_SIDE_DAILY_FEATURE_DATASET_KIND) {
        throw new Error(`Unexpected side-daily feature row kind=${kind} in ${resolvedPath}`)
      }
      if (toText(row?.gateId) !== resolvedGateId) return
      const symbol = toText(row?.symbol)
      const decisionDateKey = ensureDateKey(row?.decisionDateKey, "side feature decisionDateKey")
      if (decisionFrom && decisionDateKey < decisionFrom) return
      if (decisionTo && decisionDateKey > decisionTo) return
      const joinKey = featurePackJoinKey(symbol, decisionDateKey)
      if (lookup.has(joinKey)) {
        throw new Error(`Duplicate side-daily bridge row for ${joinKey} gate=${resolvedGateId}`)
      }
      lookup.set(joinKey, {
        requestId: toText(row?.requestId),
        gateId: resolvedGateId,
        symbol,
        decisionDateKey,
        featureCutoffDateKey: ensureDateKey(row?.featureCutoffDateKey, "featureCutoffDateKey"),
        entryPriceMode: toText(row?.entryPriceMode),
        supportedDatasetIds: uniqueSorted(row?.supportedDatasetIds),
        features: buildPrefixedSideFeatures(row?.features ?? {}),
      })
    },
  })
  if (lookup.size < 1) {
    throw new Error(`No side-daily feature rows loaded for gate=${resolvedGateId} from ${resolvedPath}`)
  }
  return lookup
}

export const augmentFeaturePackRowWithSideDaily = ({ baseRow, sideRow, gateId }) => {
  const resolvedGateId = toText(gateId)
  const symbol = toText(baseRow?.symbol)
  const decisionDateKey = ensureDateKey(baseRow?.decisionDateKey, "featurePack decisionDateKey")
  const featureVec =
    baseRow?.featureVec && typeof baseRow.featureVec === "object" && !Array.isArray(baseRow.featureVec)
      ? { ...baseRow.featureVec }
      : {}
  const contextualTokens = Array.isArray(baseRow?.contextualTokens) ? [...baseRow.contextualTokens] : []
  const bridgeState = baseRow?.sideDailyBridge
  if (bridgeState && typeof bridgeState === "object") {
    throw new Error(`Feature pack row already has sideDailyBridge metadata for ${symbol}:${decisionDateKey}`)
  }
  for (const key of Object.keys(featureVec)) {
    if (String(key).startsWith("side.")) {
      throw new Error(`Feature pack row already contains side-prefixed feature ${key} for ${symbol}:${decisionDateKey}`)
    }
  }
  for (const [featureKey, value] of Object.entries(sideRow?.features ?? {})) {
    if (Object.prototype.hasOwnProperty.call(featureVec, featureKey)) {
      throw new Error(`Feature collision on ${featureKey} for ${symbol}:${decisionDateKey}`)
    }
    featureVec[featureKey] = value
  }
  return {
    ...baseRow,
    featureVec,
    contextualTokens: uniqueSorted([
      ...contextualTokens,
      `tag:sideDailyBridge.kind:${TP12_SIDE_DAILY_FEATURE_PACK_BRIDGE_KIND}`,
      `tag:sideDailyGate:${resolvedGateId}`,
    ]),
    sideDailyBridge: {
      kind: TP12_SIDE_DAILY_FEATURE_PACK_BRIDGE_KIND,
      gateId: resolvedGateId,
      requestId: toText(sideRow?.requestId),
      featureCutoffDateKey: ensureDateKey(sideRow?.featureCutoffDateKey, "sideDailyBridge featureCutoffDateKey"),
      featureCount: Object.keys(sideRow?.features ?? {}).length,
      entryPriceMode: toText(sideRow?.entryPriceMode),
      supportedDatasetIds: uniqueSorted(sideRow?.supportedDatasetIds),
    },
  }
}

export const buildTp12SideDailyFeaturePackBridge = async ({
  featurePackPath,
  sideFeaturePath,
  gateId,
  outPath,
  metaOutPath = "",
  decisionFrom = null,
  decisionTo = null,
} = {}) => {
  const resolvedFeaturePackPath = toText(featurePackPath)
  const resolvedSideFeaturePath = toText(sideFeaturePath)
  const resolvedGateId = toText(gateId)
  const resolvedOutPath = toText(outPath)
  const resolvedMetaOutPath = toText(metaOutPath)
  const normalizedDecisionFrom = decisionFrom ? ensureDateKey(decisionFrom, "decisionFrom") : null
  const normalizedDecisionTo = decisionTo ? ensureDateKey(decisionTo, "decisionTo") : null
  if (!resolvedFeaturePackPath || !resolvedSideFeaturePath || !resolvedGateId || !resolvedOutPath) {
    throw new Error("featurePackPath, sideFeaturePath, gateId, and outPath are required")
  }
  if (!pathExists(resolvedFeaturePackPath)) {
    throw new Error(`Missing feature pack path: ${resolvedFeaturePackPath}`)
  }

  const sideLookup = await loadTp12SideDailyBridgeLookup(resolvedSideFeaturePath, {
    gateId: resolvedGateId,
    decisionFrom: normalizedDecisionFrom,
    decisionTo: normalizedDecisionTo,
  })

  const matchedKeys = new Set()
  const seenFeaturePackKeys = new Set()
  let rowCount = 0
  let firstDecisionDateKey = null
  let lastDecisionDateKey = null
  const writer = await createJsonlWriter(resolvedOutPath)
  try {
    await iterateJsonl(resolvedFeaturePackPath, {
      strict: true,
      onRow: async (row) => {
        const symbol = toText(row?.symbol)
        const decisionDateKey = ensureDateKey(row?.decisionDateKey, "featurePack decisionDateKey")
        if (normalizedDecisionFrom && decisionDateKey < normalizedDecisionFrom) return
        if (normalizedDecisionTo && decisionDateKey > normalizedDecisionTo) return
        const joinKey = featurePackJoinKey(symbol, decisionDateKey)
        if (seenFeaturePackKeys.has(joinKey)) {
          throw new Error(`Duplicate feature pack row for ${joinKey}`)
        }
        seenFeaturePackKeys.add(joinKey)
        const sideRow = sideLookup.get(joinKey)
        if (!sideRow) {
          throw new Error(`Missing side-daily bridge row for feature pack key=${joinKey} gate=${resolvedGateId}`)
        }
        const bridgedRow = augmentFeaturePackRowWithSideDaily({
          baseRow: row,
          sideRow,
          gateId: resolvedGateId,
        })
        await writer.writeRow(bridgedRow)
        matchedKeys.add(joinKey)
        rowCount += 1
        firstDecisionDateKey = firstDecisionDateKey ?? decisionDateKey
        lastDecisionDateKey = decisionDateKey
      },
    })
  } finally {
    await writer.close()
  }

  if (rowCount < 1) {
    throw new Error(`No feature pack rows bridged from ${resolvedFeaturePackPath}`)
  }
  for (const joinKey of sideLookup.keys()) {
    if (!matchedKeys.has(joinKey)) {
      throw new Error(`Side-daily bridge row has no matching feature pack row for ${joinKey}`)
    }
  }

  const summary = {
    status: "ok",
    kind: TP12_SIDE_DAILY_FEATURE_PACK_BRIDGE_KIND,
    gateId: resolvedGateId,
    rowCount,
    decisionDateFrom: firstDecisionDateKey,
    decisionDateTo: lastDecisionDateKey,
    featurePackPath: resolvedFeaturePackPath,
    sideFeaturePath: resolvedSideFeaturePath,
    outPath: resolvedOutPath,
    featurePackFingerprint: await buildFileFingerprint(resolvedFeaturePackPath),
    sideFeatureFingerprint: await buildFileFingerprint(resolvedSideFeaturePath),
    outFingerprint: await buildFileFingerprint(resolvedOutPath),
    coverage: {
      matchedRows: matchedKeys.size,
      featurePackRowsSeen: seenFeaturePackKeys.size,
      sideRowsSeen: sideLookup.size,
    },
  }
  if (resolvedMetaOutPath) {
    await writeJson(resolvedMetaOutPath, summary)
  }
  return summary
}
