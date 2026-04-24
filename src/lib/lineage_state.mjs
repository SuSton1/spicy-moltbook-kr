import crypto from "node:crypto"
import path from "node:path"

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item))
  }
  if (value && typeof value === "object") {
    const out = {}
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      out[key] = canonicalize(value[key])
    }
    return out
  }
  return value
}

const stableStringify = (value) => JSON.stringify(canonicalize(value))

const pick = (obj, keys) => {
  const out = {}
  for (const key of keys) out[key] = obj?.[key]
  return out
}

const buildSharedConfigSnapshot = (config) => ({
  timeline: config?.timeline ?? null,
  periods: config?.periods ?? null,
  event: config?.event ?? {},
  filters: config?.filters ?? {},
  template: config?.template ?? {},
  similarity: {
    scorerVersion: config?.similarity?.scorerVersion ?? null,
    topK: config?.similarity?.topK ?? null,
    coarseTopN: config?.similarity?.coarseTopN ?? null,
    coarseTopClusters: config?.similarity?.coarseTopClusters ?? null,
    stageWeights: config?.similarity?.stageWeights ?? null,
    postScoreAdjust: config?.similarity?.postScoreAdjust ?? null
  },
  pattern: {
    mode: config?.pattern?.mode ?? null,
    recallOnly: config?.pattern?.recallOnly ?? null,
    maxGlobalPrototypes: config?.pattern?.maxGlobalPrototypes ?? null,
    maxLocalPrototypes: config?.pattern?.maxLocalPrototypes ?? null,
    globalClusterBins: config?.pattern?.globalClusterBins ?? null,
    globalClusterBinMode: config?.pattern?.globalClusterBinMode ?? null,
    globalClusterMinBins: config?.pattern?.globalClusterMinBins ?? null,
    globalClusterMaxBins: config?.pattern?.globalClusterMaxBins ?? null,
    minRuleSupportRatio: config?.pattern?.minRuleSupportRatio ?? null,
    excludeFeatureGroups: config?.pattern?.excludeFeatureGroups ?? null,
    quality: config?.pattern?.quality ?? null,
    antiPattern: config?.pattern?.antiPattern ?? null,
    contrastive: config?.pattern?.contrastive ?? null,
    prototypeSelection: config?.pattern?.prototypeSelection ?? null,
    commonState: config?.pattern?.commonState ?? null
  },
  decisionGate: config?.decisionGate ?? {},
  onlineLearning: {
    enabled: config?.onlineLearning?.enabled === true,
    learningRate: config?.onlineLearning?.learningRate ?? null,
    reinforceBeta: config?.onlineLearning?.reinforceBeta ?? null,
    weightFloor: config?.onlineLearning?.weightFloor ?? null,
    generalization: config?.onlineLearning?.generalization ?? null
  },
  backtest: config?.backtest ?? {},
  holdoutPolicy: config?.holdoutPolicy ?? {},
  qualityGate: config?.qualityGate ?? {},
  cdLoop: config?.cdLoop ?? {},
  smokeConfirm: config?.smokeConfirm ?? {},
  dataPaths: pick(config?.dataPaths ?? {}, [
    "candleDailyJsonl",
    "universeJsonl",
    "symbolMasterJsonl"
  ])
})

export const buildCdLoopLineageSnapshot = ({ config, periods, abRunId }) => ({
  version: 1,
  kind: "cd-loop",
  abRunId: String(abRunId ?? "").trim() || null,
  periods: periods ?? null,
  config: buildSharedConfigSnapshot(config)
})

export const buildSmokeConfirmLineageSnapshot = ({
  config,
  periods,
  baseStepCFingerprint,
  startWeightsPath = null
  ,
  championBundleHash = null
}) => ({
  version: 1,
  kind: "smoke-confirm",
  baseStepCFingerprint: String(baseStepCFingerprint ?? "").trim() || null,
  startWeightsPath: String(startWeightsPath ?? "").trim() || null,
  championBundleHash: String(championBundleHash ?? "").trim() || null,
  periods: periods ?? null,
  config: buildSharedConfigSnapshot(config)
})

export const computeLineageKey = (snapshot) =>
  crypto.createHash("sha256").update(stableStringify(snapshot ?? null)).digest("hex")

export const resolveLineageStatePaths = ({ cwd, lineageKey }) => {
  const dir = path.join(cwd, "artifacts", "state", "lineages", String(lineageKey ?? "unknown"))
  return {
    dir,
    dropRegistryPath: path.join(dir, "drop_registry.json"),
    smokeConfirmLedgerPath: path.join(dir, "smoke_confirm_ledger.jsonl"),
    smokeConfirmStatePath: path.join(dir, "smoke_confirm_state.json")
  }
}
