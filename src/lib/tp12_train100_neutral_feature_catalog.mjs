import crypto from "node:crypto"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  createJsonlWriteStreamMaybeGzip,
  toText,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"
import {
  assertNeutralAtomNaming,
  assertNoForbiddenExpressionFields,
  assertNoOosPath,
  assertThresholdInContractGrid,
  loadTp12Train100NeutralContract,
  outputPathFromContract,
} from "./tp12_train100_neutral_search_guards.mjs"

const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex")

const atomIdFor = ({ featureSpaceId, featureName, operator, thresholdSpec }) =>
  `sha256:${sha256(JSON.stringify({ featureSpaceId, featureName, operator, thresholdSpec })).slice(0, 32)}`

const rankSpecs = [
  { operator: ">=", thresholdSpec: { type: "rankBucket", value: "top10" } },
  { operator: ">=", thresholdSpec: { type: "rankBucket", value: "top20" } },
  { operator: ">=", thresholdSpec: { type: "rankBucket", value: "top30" } },
  { operator: "<=", thresholdSpec: { type: "rankBucket", value: "bottom20" } },
  { operator: "<=", thresholdSpec: { type: "rankBucket", value: "bottom30" } },
  { operator: "between", thresholdSpec: { type: "rankBucket", value: "mid20_80" } },
]

const percentileSpecs = [
  { operator: ">=", thresholdSpec: { type: "percentile", value: 0.7 } },
  { operator: ">=", thresholdSpec: { type: "percentile", value: 0.8 } },
  { operator: ">=", thresholdSpec: { type: "percentile", value: 0.9 } },
  { operator: "<=", thresholdSpec: { type: "percentile", value: 0.1 } },
  { operator: "<=", thresholdSpec: { type: "percentile", value: 0.2 } },
  { operator: "<=", thresholdSpec: { type: "percentile", value: 0.3 } },
  { operator: "between", thresholdSpec: { type: "rankBucket", value: "mid20_80" } },
]

const zSpecs = [
  { operator: ">=", thresholdSpec: { type: "zScore", value: 0.5 } },
  { operator: ">=", thresholdSpec: { type: "zScore", value: 1 } },
  { operator: ">=", thresholdSpec: { type: "zScore", value: 1.5 } },
  { operator: "<=", thresholdSpec: { type: "zScore", value: -0.5 } },
  { operator: "<=", thresholdSpec: { type: "zScore", value: -1 } },
  { operator: "<=", thresholdSpec: { type: "zScore", value: -1.5 } },
]

const countSpecs = [
  { operator: ">=", thresholdSpec: { type: "count", value: 1 } },
  { operator: ">=", thresholdSpec: { type: "count", value: 2 } },
  { operator: ">=", thresholdSpec: { type: "count", value: 3 } },
  { operator: ">=", thresholdSpec: { type: "count", value: 5 } },
  { operator: ">=", thresholdSpec: { type: "count", value: 8 } },
  { operator: ">=", thresholdSpec: { type: "count", value: 13 } },
  { operator: "<=", thresholdSpec: { type: "count", value: 0 } },
  { operator: "<=", thresholdSpec: { type: "count", value: 1 } },
  { operator: "<=", thresholdSpec: { type: "count", value: 2 } },
  { operator: "<=", thresholdSpec: { type: "count", value: 3 } },
]

const shareSpecs = [
  { operator: ">=", thresholdSpec: { type: "share", value: 0.25 } },
  { operator: ">=", thresholdSpec: { type: "share", value: 0.5 } },
  { operator: ">=", thresholdSpec: { type: "share", value: 0.75 } },
  { operator: "<=", thresholdSpec: { type: "share", value: 0.25 } },
  { operator: "<=", thresholdSpec: { type: "share", value: 0.5 } },
  { operator: "<=", thresholdSpec: { type: "share", value: 0.75 } },
]

const wickSpecs = [
  { operator: ">=", thresholdSpec: { type: "wickRatio", value: 0.1 } },
  { operator: ">=", thresholdSpec: { type: "wickRatio", value: 0.2 } },
  { operator: ">=", thresholdSpec: { type: "wickRatio", value: 0.3 } },
  { operator: ">=", thresholdSpec: { type: "wickRatio", value: 0.4 } },
  { operator: ">=", thresholdSpec: { type: "wickRatio", value: 0.5 } },
  { operator: "<=", thresholdSpec: { type: "wickRatio", value: 0.1 } },
  { operator: "<=", thresholdSpec: { type: "wickRatio", value: 0.2 } },
  { operator: "<=", thresholdSpec: { type: "wickRatio", value: 0.3 } },
]

const closeLocationSpecs = [
  { operator: ">=", thresholdSpec: { type: "closeLocation", value: 0.5 } },
  { operator: ">=", thresholdSpec: { type: "closeLocation", value: 0.65 } },
  { operator: ">=", thresholdSpec: { type: "closeLocation", value: 0.8 } },
  { operator: ">=", thresholdSpec: { type: "closeLocation", value: 0.9 } },
  { operator: "<=", thresholdSpec: { type: "closeLocation", value: 0.25 } },
  { operator: "<=", thresholdSpec: { type: "closeLocation", value: 0.5 } },
  { operator: "<=", thresholdSpec: { type: "closeLocation", value: 0.65 } },
]

const daySpecs = [
  { operator: ">=", thresholdSpec: { type: "day", value: 5 } },
  { operator: ">=", thresholdSpec: { type: "day", value: 10 } },
  { operator: ">=", thresholdSpec: { type: "day", value: 20 } },
  { operator: "<=", thresholdSpec: { type: "day", value: 5 } },
  { operator: "<=", thresholdSpec: { type: "day", value: 10 } },
  { operator: "<=", thresholdSpec: { type: "day", value: 20 } },
  { operator: "<=", thresholdSpec: { type: "day", value: 40 } },
]

const featureSpaces = [
  {
    featureSpaceId: "tp12_fs1_neutral_ohlcv_intensity_v1",
    family: "ohlcv_intensity",
    overfitRisk: "medium",
    features: [
      "ret1d",
      "ret3d",
      "ret5d",
      "ret20d",
      "gapPrevClose",
      "rangePct",
      "bodyPct",
      "atrPct14",
      "closeToHigh20",
      "closeFromLow20",
      "ma5Distance",
      "ma20Distance",
      "ma5Ma20Alignment",
      "breakout20Strength",
    ],
    specs: [...percentileSpecs, ...zSpecs],
  },
  {
    featureSpaceId: "tp12_fs2_neutral_candle_shape_v1",
    family: "candle_shape",
    overfitRisk: "medium_high",
    features: ["upperWickRatio", "lowerWickRatio", "closeLocation", "bodyToRange", "openLocation", "highLowRangeRank"],
    specsByFeature: {
      upperWickRatio: wickSpecs,
      lowerWickRatio: wickSpecs,
      closeLocation: closeLocationSpecs,
    },
    specs: [...percentileSpecs, ...zSpecs],
  },
  {
    featureSpaceId: "tp12_fs3_neutral_liquidity_volume_v1",
    family: "liquidity_volume",
    overfitRisk: "low_medium",
    features: [
      "tradedValue",
      "avgTradingValue20d",
      "tradedValueRel20",
      "tradedValueRel60",
      "volumeRel20",
      "volumeDryupRel20",
      "turnoverProxy",
      "marketCapProxyBucket",
    ],
    specs: [...percentileSpecs, ...zSpecs],
  },
  {
    featureSpaceId: "tp12_fs4_neutral_cross_section_rank_v1",
    family: "cross_section_rank",
    overfitRisk: "medium",
    features: [
      "ret1dRankInUniverse",
      "ret3dRankInUniverse",
      "ret20dRankInUniverse",
      "tradedValueRel20RankInUniverse",
      "rangePctRankInUniverse",
      "atrPctRankInUniverse",
      "closeLocationRankInUniverse",
    ],
    specs: rankSpecs,
  },
  {
    featureSpaceId: "tp12_fs5_neutral_support_consensus_v1",
    family: "support_consensus",
    overfitRisk: "high",
    features: [
      "supportPatternCount",
      "supportClusterCount",
      "supportLog",
      "supportOvercrowdRatio",
      "supportQualityRatio",
      "effectiveSupportEntropy",
      "topClusterShare",
      "familyDiversity",
    ],
    specsByFeature: {
      supportPatternCount: countSpecs,
      supportClusterCount: countSpecs,
      familyDiversity: countSpecs,
      supportOvercrowdRatio: shareSpecs,
      topClusterShare: shareSpecs,
    },
    specs: [...percentileSpecs, ...zSpecs],
  },
  {
    featureSpaceId: "tp12_fs6_neutral_market_context_v1",
    family: "market_context",
    overfitRisk: "medium",
    features: [
      "dayCandidateRows",
      "dayUniqueSymbols",
      "dayUniquePatterns",
      "marketUpRatio",
      "marketMeanReturn1d",
      "marketMeanReturn5d",
      "limitUpProxyCount",
      "candidateDensityRel20",
    ],
    specsByFeature: {
      dayCandidateRows: countSpecs,
      dayUniqueSymbols: countSpecs,
      dayUniquePatterns: countSpecs,
      limitUpProxyCount: countSpecs,
    },
    specs: [...percentileSpecs, ...zSpecs, ...shareSpecs],
  },
  {
    featureSpaceId: "tp12_fs7_neutral_same_symbol_matured_prior_v1",
    family: "same_symbol_matured_prior",
    overfitRisk: "high",
    features: [
      "priorMaturedSignalCount20d",
      "priorMaturedHitCount60d",
      "priorMaturedFalsePositiveCount60d",
      "daysSinceMaturedSignal",
      "daysSinceMaturedSpike",
    ],
    specsByFeature: {
      priorMaturedSignalCount20d: countSpecs,
      priorMaturedHitCount60d: countSpecs,
      priorMaturedFalsePositiveCount60d: countSpecs,
      daysSinceMaturedSignal: daySpecs,
      daysSinceMaturedSpike: daySpecs,
    },
    specs: countSpecs,
  },
]

const sourceFieldsFor = (featureName) => [featureName]

export const buildTp12Train100NeutralFeatureCatalog = async ({
  contractPath,
  outCatalogPath = "",
  outManifestPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100NeutralContract(contractPath, { cwd })
  const outputCatalogPath = outputPathFromContract(cwd, contract, "neutralFeatureCatalog", outCatalogPath)
  const outputManifestPath = outputPathFromContract(cwd, contract, "featureSpaceManifest", outManifestPath)
  assertNoOosPath(outputCatalogPath, "neutralFeatureCatalog")
  assertNoOosPath(outputManifestPath, "featureSpaceManifest")

  const allowedSpaces = new Set(contract.expression.allowedFeatureSpaceIds)
  const rows = []
  for (const space of featureSpaces) {
    if (!allowedSpaces.has(space.featureSpaceId)) continue
    for (const featureName of space.features) {
      const specs = space.specsByFeature?.[featureName] ?? space.specs
      for (const { operator, thresholdSpec } of specs) {
        const row = {
          kind: "tp12_train100_neutral_feature_atom_spec_v1",
          featureSpaceId: space.featureSpaceId,
          featureName,
          family: space.family,
          operator,
          thresholdSpec,
          atomId: atomIdFor({ featureSpaceId: space.featureSpaceId, featureName, operator, thresholdSpec }),
          sourceFields: sourceFieldsFor(featureName),
          sourceDatePolicy: "<=decisionDateKey",
          forbiddenAsLiveFeature: false,
          rolePolarity: "neutral",
          overfitRisk: space.overfitRisk,
          notes: "Neutral measurement atom; anchor/veto role is assigned only by train support behavior.",
        }
        assertNeutralAtomNaming(row)
        assertThresholdInContractGrid(row, contract)
        assertNoForbiddenExpressionFields(row, contract, "featureCatalogRow")
        rows.push(row)
      }
    }
  }

  await ensureDir(path.dirname(outputCatalogPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputCatalogPath)
  try {
    for (const row of rows) await writeJsonlRow(writer.stream, row)
  } finally {
    await writer.close()
  }

  const featureSpaceCounts = {}
  for (const row of rows) featureSpaceCounts[row.featureSpaceId] = (featureSpaceCounts[row.featureSpaceId] ?? 0) + 1
  const manifest = {
    kind: "tp12_train100_neutral_feature_space_manifest_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    outCatalogPath: outputCatalogPath,
    oosRead: false,
    fallbackUsed: false,
    rolePolarity: "neutral",
    featureSpaceCount: Object.keys(featureSpaceCounts).length,
    atomSpecCount: rows.length,
    featureSpaceCounts,
  }
  await writeJson(outputManifestPath, manifest)
  return manifest
}

export const validateTp12Train100NeutralFeatureCatalog = (catalogRows, contract) => {
  if (!Array.isArray(catalogRows)) throw new Error("catalogRows must be an array")
  const seen = new Set()
  for (const row of catalogRows) {
    assertNeutralAtomNaming(row)
    assertThresholdInContractGrid(row, contract)
    assertNoForbiddenExpressionFields(row, contract, "featureCatalogRow")
    const atomId = toText(row.atomId)
    if (!atomId) throw new Error("catalog row missing atomId")
    if (seen.has(atomId)) throw new Error(`duplicate atomId in feature catalog: ${atomId}`)
    seen.add(atomId)
  }
  return true
}

