import fs from "node:fs/promises"

import { normalizeDateKey } from "./date.mjs"
import { createJsonlWriter, iterateJsonl, pathExists, writeJson } from "./io.mjs"
import { TP12_INTRADAY_FEATURE_DATASET_KIND } from "./tp12_intraday_feature_builder.mjs"

export const TP12_INTRADAY_FEATURE_PACK_BRIDGE_KIND = "tp12_intraday_feature_pack_bridge_v1"

const toText = (value) => String(value ?? "").trim()

const toFiniteNumber = (value, label) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be finite: ${value ?? "<null>"}`)
  }
  return numeric
}

const ensureDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
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

const buildPrefixedIntradayFeatures = (gateFeatures) => {
  const normalized = normalizeNumericFeatureMap(gateFeatures, "intraday features")
  const prefixed = {}
  for (const [key, value] of Object.entries(normalized)) {
    prefixed[`intraday.${key}`] = value
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

export const loadTp12IntradayFeatureBridgeLookup = async (
  intradayFeaturePath,
  { gateId, decisionFrom = null, decisionTo = null } = {},
) => {
  const resolvedPath = toText(intradayFeaturePath)
  const resolvedGateId = toText(gateId)
  if (!resolvedPath) {
    throw new Error("intradayFeaturePath is required")
  }
  if (!pathExists(resolvedPath)) {
    throw new Error(`Missing intraday feature dataset: ${resolvedPath}`)
  }
  if (!resolvedGateId) {
    throw new Error("gateId is required")
  }
  const lookup = new Map()
  await iterateJsonl(resolvedPath, {
    strict: true,
    onRow: async (row) => {
      const kind = toText(row?.kind)
      if (kind && kind !== TP12_INTRADAY_FEATURE_DATASET_KIND) {
        throw new Error(`Unexpected intraday feature row kind=${kind} in ${resolvedPath}`)
      }
      if (toText(row?.gateId) !== resolvedGateId) return
      const symbol = toText(row?.symbol)
      const decisionDateKey = ensureDateKey(row?.decisionDateKey, "intraday decisionDateKey")
      if (decisionFrom && decisionDateKey < decisionFrom) return
      if (decisionTo && decisionDateKey > decisionTo) return
      const joinKey = featurePackJoinKey(symbol, decisionDateKey)
      if (lookup.has(joinKey)) {
        throw new Error(`Duplicate intraday bridge row for ${joinKey} gate=${resolvedGateId}`)
      }
      lookup.set(joinKey, {
        requestId: toText(row?.requestId),
        gateId: resolvedGateId,
        symbol,
        decisionDateKey,
        featureCutoffDateKey: ensureDateKey(row?.featureCutoffDateKey, "featureCutoffDateKey"),
        featureCutoffTsKst: toText(row?.featureCutoffTsKst),
        entryPriceMode: toText(row?.entryPriceMode),
        features: buildPrefixedIntradayFeatures(row?.features ?? {}),
      })
    },
  })
  if (lookup.size < 1) {
    throw new Error(`No intraday feature rows loaded for gate=${resolvedGateId} from ${resolvedPath}`)
  }
  return lookup
}

export const augmentFeaturePackRowWithIntraday = ({ baseRow, intradayRow, gateId }) => {
  const resolvedGateId = toText(gateId)
  const symbol = toText(baseRow?.symbol)
  const decisionDateKey = ensureDateKey(baseRow?.decisionDateKey, "featurePack decisionDateKey")
  const featureVec =
    baseRow?.featureVec && typeof baseRow.featureVec === "object" && !Array.isArray(baseRow.featureVec)
      ? { ...baseRow.featureVec }
      : {}
  const contextualTokens = Array.isArray(baseRow?.contextualTokens) ? [...baseRow.contextualTokens] : []
  const bridgeState = baseRow?.intradayBridge
  if (bridgeState && typeof bridgeState === "object") {
    throw new Error(`Feature pack row already has intradayBridge metadata for ${symbol}:${decisionDateKey}`)
  }
  for (const key of Object.keys(featureVec)) {
    if (String(key).startsWith("intraday.")) {
      throw new Error(`Feature pack row already contains intraday-prefixed feature ${key} for ${symbol}:${decisionDateKey}`)
    }
  }
  for (const [featureKey, value] of Object.entries(intradayRow?.features ?? {})) {
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
      `tag:intradayBridge.kind:${TP12_INTRADAY_FEATURE_PACK_BRIDGE_KIND}`,
      `tag:intradayGate:${resolvedGateId}`,
    ]),
    intradayBridge: {
      kind: TP12_INTRADAY_FEATURE_PACK_BRIDGE_KIND,
      gateId: resolvedGateId,
      requestId: toText(intradayRow?.requestId),
      featureCutoffDateKey: ensureDateKey(
        intradayRow?.featureCutoffDateKey,
        "intradayBridge featureCutoffDateKey",
      ),
      featureCutoffTsKst: toText(intradayRow?.featureCutoffTsKst),
      featureCount: Object.keys(intradayRow?.features ?? {}).length,
      entryPriceMode: toText(intradayRow?.entryPriceMode),
    },
  }
}

export const buildTp12IntradayFeaturePackBridge = async ({
  featurePackPath,
  intradayFeaturePath,
  gateId,
  outPath,
  metaOutPath = "",
  decisionFrom = null,
  decisionTo = null,
} = {}) => {
  const resolvedFeaturePackPath = toText(featurePackPath)
  const resolvedIntradayFeaturePath = toText(intradayFeaturePath)
  const resolvedGateId = toText(gateId)
  const resolvedOutPath = toText(outPath)
  const resolvedMetaOutPath = toText(metaOutPath)
  const normalizedDecisionFrom = decisionFrom ? ensureDateKey(decisionFrom, "decisionFrom") : null
  const normalizedDecisionTo = decisionTo ? ensureDateKey(decisionTo, "decisionTo") : null

  if (!resolvedFeaturePackPath || !resolvedIntradayFeaturePath || !resolvedGateId || !resolvedOutPath) {
    throw new Error("featurePackPath, intradayFeaturePath, gateId, and outPath are required")
  }
  if (!pathExists(resolvedFeaturePackPath)) {
    throw new Error(`Missing feature pack path: ${resolvedFeaturePackPath}`)
  }

  const intradayLookup = await loadTp12IntradayFeatureBridgeLookup(resolvedIntradayFeaturePath, {
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
        const intradayRow = intradayLookup.get(joinKey)
        if (!intradayRow) {
          throw new Error(`Missing intraday bridge row for feature pack key=${joinKey} gate=${resolvedGateId}`)
        }
        const bridgedRow = augmentFeaturePackRowWithIntraday({
          baseRow: row,
          intradayRow,
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
  for (const joinKey of intradayLookup.keys()) {
    if (!matchedKeys.has(joinKey)) {
      throw new Error(`Intraday bridge row has no matching feature pack row for ${joinKey}`)
    }
  }

  const summary = {
    status: "ok",
    kind: TP12_INTRADAY_FEATURE_PACK_BRIDGE_KIND,
    gateId: resolvedGateId,
    rowCount,
    decisionDateFrom: firstDecisionDateKey,
    decisionDateTo: lastDecisionDateKey,
    featurePackPath: resolvedFeaturePackPath,
    intradayFeaturePath: resolvedIntradayFeaturePath,
    outPath: resolvedOutPath,
    featurePackFingerprint: await buildFileFingerprint(resolvedFeaturePackPath),
    intradayFeatureFingerprint: await buildFileFingerprint(resolvedIntradayFeaturePath),
    outFingerprint: await buildFileFingerprint(resolvedOutPath),
    coverage: {
      matchedRows: matchedKeys.size,
      featurePackRowsSeen: seenFeaturePackKeys.size,
      intradayRowsSeen: intradayLookup.size,
      status: "full_match",
    },
  }
  if (resolvedMetaOutPath) {
    await writeJson(resolvedMetaOutPath, summary)
    summary.metaOutPath = resolvedMetaOutPath
  }
  return summary
}
