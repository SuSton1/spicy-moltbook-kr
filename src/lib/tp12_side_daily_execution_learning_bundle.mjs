import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { buildCandleDateIndexMap, buildCandleSeriesMap } from "./data.mjs"
import { normalizeDateKey } from "./date.mjs"
import { ensureDir, iterateJsonl, readJsonl, writeJson, writeJsonl } from "./io.mjs"
import {
  TP12_EXECUTION_POLICY_MENU_STOP_RECOVERY_V1,
  simulateTp12ExecutionPolicyFromDecision,
} from "./perfect_prototype_tp12_execution_policy.mjs"
import {
  loadTp12SideDailyScientificControlPipelineSummary,
  loadTp12SideDailyScientificSelectionManifest,
  TP12_SIDE_DAILY_BASELINE_VARIANT_ID,
} from "./tp12_side_daily_scientific_comparison.mjs"

export const TP12_SIDE_DAILY_EXECUTION_LEARNING_BUNDLE_KIND = "tp12_side_daily_execution_learning_bundle_v1"
export const TP12_SIDE_DAILY_EXECUTION_DONOR_ROW_KIND = "tp12_side_daily_execution_donor_row_v1"
export const TP12_SIDE_DAILY_EXECUTION_LABEL_ROW_KIND = "tp12_side_daily_execution_label_row_v1"

const STOP_FIRST_POLICY_ID = "baseline_tp12_sl4_stop_first_3d"
const DELAY1_POLICY_ID = "tp12_sl4_stop_delay1_4d"
const ABSTAIN_POLICY_ID = "abstain"
const DEFAULT_RECENT_REPLAY_DECISION_COUNT = 30

const toText = (value) => String(value ?? "").trim()

const numOrNull = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

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

const sha256 = (value) => crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex")

const safeMean = (values) => {
  const numeric = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value))
  if (numeric.length < 1) return null
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length
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

const readSelectedKeySet = async (selectionPath) => {
  const selectedKeys = new Set()
  await iterateJsonl(selectionPath, {
    strict: true,
    onRow: async (row) => {
      const symbol = toText(row?.symbol)
      const decisionDateKey = ensureDateKey(
        row?.decisionDateKey ?? row?.recommendationDateKey ?? row?.dateKey,
        "selection decisionDateKey",
      )
      if (!symbol) {
        throw new Error(`Selection row is missing symbol in ${selectionPath}`)
      }
      const joinKey = pairKey(symbol, decisionDateKey)
      if (selectedKeys.has(joinKey)) {
        throw new Error(`Duplicate selected pair ${joinKey} in ${selectionPath}`)
      }
      selectedKeys.add(joinKey)
    },
  })
  if (selectedKeys.size < 1) {
    throw new Error(`Selection path resolved zero rows: ${selectionPath}`)
  }
  return selectedKeys
}

const loadControlRowIndex = async ({ controlPackPath, selectedKeys }) => {
  const rowsByPair = new Map()
  await iterateJsonl(controlPackPath, {
    strict: true,
    onRow: async (row) => {
      const symbol = toText(row?.symbol)
      const decisionDateKey = ensureDateKey(row?.decisionDateKey, "control decisionDateKey")
      const joinKey = pairKey(symbol, decisionDateKey)
      if (!selectedKeys.has(joinKey)) return
      if (rowsByPair.has(joinKey)) {
        throw new Error(`Duplicate control feature row for ${joinKey} in ${controlPackPath}`)
      }
      rowsByPair.set(joinKey, row)
    },
  })
  return rowsByPair
}

const loadLabelRowIndex = async ({ controlLabelPath, selectedKeys }) => {
  const rowsByPair = new Map()
  let targetLabelIds = null
  await iterateJsonl(controlLabelPath, {
    strict: true,
    onRow: async (row) => {
      const symbol = toText(row?.symbol)
      const decisionDateKey = ensureDateKey(row?.decisionDateKey, "label decisionDateKey")
      const joinKey = pairKey(symbol, decisionDateKey)
      if (!selectedKeys.has(joinKey)) return
      if (rowsByPair.has(joinKey)) {
        throw new Error(`Duplicate control label row for ${joinKey} in ${controlLabelPath}`)
      }
      const rowTargetLabelIds = uniqueSorted(row?.targetLabelIds)
      if (rowTargetLabelIds.length < 1) {
        throw new Error(`Control label row is missing targetLabelIds for ${joinKey}`)
      }
      if (targetLabelIds === null) {
        targetLabelIds = rowTargetLabelIds
      } else if (JSON.stringify(targetLabelIds) !== JSON.stringify(rowTargetLabelIds)) {
        throw new Error(`Inconsistent targetLabelIds in ${controlLabelPath}`)
      }
      rowsByPair.set(joinKey, row)
    },
  })
  return {
    rowsByPair,
    targetLabelIds: targetLabelIds ?? [],
  }
}

const assertCoverage = ({ selectedKeys, controlRowsByPair, labelRowsByPair, baselineVariantId }) => {
  for (const joinKey of selectedKeys) {
    if (!controlRowsByPair.has(joinKey)) {
      throw new Error(`Baseline donor selection ${joinKey} is missing control feature-pack coverage for ${baselineVariantId}`)
    }
    if (!labelRowsByPair.has(joinKey)) {
      throw new Error(`Baseline donor selection ${joinKey} is missing control label coverage for ${baselineVariantId}`)
    }
  }
}

const resolveReplayDateSets = ({ oosDecisionDates, recentReplayDecisionCount }) => {
  const safeDates = uniqueSorted(oosDecisionDates)
  if (safeDates.length <= recentReplayDecisionCount) {
    throw new Error(
      `OOS donor decision-date count ${safeDates.length} must be greater than recentReplayDecisionCount=${recentReplayDecisionCount}`,
    )
  }
  const validationDates = safeDates.slice(0, safeDates.length - recentReplayDecisionCount)
  const recentReplayDates = safeDates.slice(-recentReplayDecisionCount)
  if (validationDates.length < 1 || recentReplayDates.length < 1) {
    throw new Error("Execution-learning replay split resolved an empty validation or recent bucket")
  }
  return {
    validationDateSet: new Set(validationDates),
    recentReplayDateSet: new Set(recentReplayDates),
    validationDates,
    recentReplayDates,
  }
}

const classifyLearningSplitBucket = ({ scientificSplitBucket, decisionDateKey, validationDateSet, recentReplayDateSet }) => {
  if (scientificSplitBucket === "train") return "train"
  if (scientificSplitBucket !== "oos") {
    throw new Error(`Unsupported scientific split bucket: ${scientificSplitBucket}`)
  }
  if (recentReplayDateSet.has(decisionDateKey)) return "recent_replay"
  if (validationDateSet.has(decisionDateKey)) return "validation"
  throw new Error(`OOS donor row ${decisionDateKey} is outside the frozen validation/recent replay split`)
}

const normalizePolicyOutcome = (outcome) => ({
  policyId: toText(outcome?.policyId),
  label: toText(outcome?.label),
  entry: toText(outcome?.entry),
  holdDays: Number(outcome?.holdDays ?? 0) || 0,
  targetPct: numOrNull(outcome?.targetPct),
  stopLossPct: numOrNull(outcome?.stopLossPct),
  stopActivationDelayBars: Number(outcome?.stopActivationDelayBars ?? 0) || 0,
  sameBarTiePolicy: toText(outcome?.sameBarTiePolicy),
  decisionIdx: Number(outcome?.decisionIdx ?? 0) || 0,
  entryIdx: Number(outcome?.entryIdx ?? 0) || 0,
  exitIdx: Number(outcome?.exitIdx ?? 0) || 0,
  maxExitIdx: Number(outcome?.maxExitIdx ?? 0) || 0,
  entryDateKey: toText(outcome?.entryDateKey),
  exitDateKey: toText(outcome?.exitDateKey),
  entryPrice: numOrNull(outcome?.entryPrice),
  exitPrice: numOrNull(outcome?.exitPrice),
  targetPrice: numOrNull(outcome?.targetPrice),
  stopPrice: numOrNull(outcome?.stopPrice),
  grossRet: numOrNull(outcome?.grossRet),
  netRet: numOrNull(outcome?.netRet),
  exitReason: toText(outcome?.exitReason),
  hitTarget: outcome?.hitTarget === true,
  hitStop: outcome?.hitStop === true,
  timeoutPositive: outcome?.timeoutPositive === true,
  timeoutNegative: outcome?.timeoutNegative === true,
})

const buildAbstainOutcome = ({ decisionIdx, decisionDateKey }) => ({
  policyId: ABSTAIN_POLICY_ID,
  label: "Abstain",
  entry: "NONE",
  holdDays: 0,
  targetPct: null,
  stopLossPct: null,
  stopActivationDelayBars: 0,
  sameBarTiePolicy: "",
  decisionIdx,
  entryIdx: decisionIdx,
  exitIdx: decisionIdx,
  maxExitIdx: decisionIdx,
  entryDateKey: decisionDateKey,
  exitDateKey: decisionDateKey,
  entryPrice: null,
  exitPrice: null,
  targetPrice: null,
  stopPrice: null,
  grossRet: 0,
  netRet: 0,
  exitReason: "ABSTAIN",
  hitTarget: false,
  hitStop: false,
  timeoutPositive: false,
  timeoutNegative: false,
})

const chooseBestPolicy = ({ outcomeByPolicyId, policyOrder }) => {
  const candidates = (Array.isArray(policyOrder) ? policyOrder : [])
    .map((policyId) => outcomeByPolicyId[policyId])
    .filter((entry) => Number.isFinite(Number(entry?.netRet)))
  if (candidates.length < 1) {
    return {
      policyId: null,
      netRet: null,
      outcome: null,
    }
  }
  candidates.sort((left, right) => {
    if (Number(right.netRet) !== Number(left.netRet)) return Number(right.netRet) - Number(left.netRet)
    return policyOrder.indexOf(left.policyId) - policyOrder.indexOf(right.policyId)
  })
  return {
    policyId: candidates[0].policyId,
    netRet: Number(candidates[0].netRet),
    outcome: candidates[0],
  }
}

const classifyBarrierOutcome = (policyOutcome) => {
  const exitReason = toText(policyOutcome?.exitReason)
  if (exitReason.startsWith("TARGET")) return "tp12_first"
  if (exitReason.startsWith("STOP")) return "sl4_first"
  if (exitReason === "TIMEOUT") return "no_barrier_hit"
  throw new Error(`Unsupported barrier outcome exitReason=${exitReason}`)
}

const buildBaseMeta = (controlRow) => ({
  sourceType: toText(controlRow?.sourceType),
  sourceId: toText(controlRow?.sourceId),
  lineId: toText(controlRow?.lineId),
  selectionMode: toText(controlRow?.selectionMode),
  primaryRuleId: toText(controlRow?.primaryRuleId),
  matchedRuleIds: uniqueSorted(controlRow?.matchedRuleIds),
  matchedRuleCount: Number.isFinite(Number(controlRow?.matchedRuleCount)) ? Number(controlRow.matchedRuleCount) : null,
})

const summarizeCounts = (values) =>
  Object.fromEntries(
    Array.from(
      (Array.isArray(values) ? values : []).reduce((acc, value) => {
        const key = toText(value)
        if (!key) return acc
        acc.set(key, Number(acc.get(key) ?? 0) + 1)
        return acc
      }, new Map()).entries(),
    ).sort((left, right) => left[0].localeCompare(right[0])),
  )

const summarizePolicyNetRet = ({ labelRows, policyIds }) =>
  Object.fromEntries(
    (Array.isArray(policyIds) ? policyIds : []).map((policyId) => [
      policyId,
      safeMean((Array.isArray(labelRows) ? labelRows : []).map((row) => row?.policyOutcomes?.[policyId]?.netRet)),
    ]),
  )

export const buildTp12SideDailyExecutionLearningBundle = async ({
  pipelineSummaryPath,
  selectionManifestPath,
  outDir,
  candlePath = path.join(process.cwd(), "data", "candle_daily.jsonl"),
  baselineVariantId = TP12_SIDE_DAILY_BASELINE_VARIANT_ID,
  recentReplayDecisionCount = DEFAULT_RECENT_REPLAY_DECISION_COUNT,
  cwd = process.cwd(),
} = {}) => {
  const replayDecisionCount = Math.max(1, Math.floor(Number(recentReplayDecisionCount) || DEFAULT_RECENT_REPLAY_DECISION_COUNT))
  const pipeline = await loadTp12SideDailyScientificControlPipelineSummary({ pipelineSummaryPath, cwd })
  const selectionManifest = await loadTp12SideDailyScientificSelectionManifest({
    selectionManifestPath,
    expectedVariantIds: pipeline.variants.map((variant) => variant.variantId),
    cwd,
  })
  const baselineVariant = pipeline.variants.find((variant) => variant.variantId === baselineVariantId)
  if (!baselineVariant) {
    throw new Error(`Execution-learning bundle is missing baseline variant=${baselineVariantId}`)
  }
  const baselineSelection = selectionManifest.variants.find((variant) => variant.variantId === baselineVariantId)
  if (!baselineSelection) {
    throw new Error(`Execution-learning bundle is missing baseline selection binding for ${baselineVariantId}`)
  }
  const resolvedCandlePath = path.resolve(cwd, toText(candlePath))
  const resolvedOutDir = path.resolve(cwd, toText(outDir))
  if (!toText(baselineVariant.controlPackPath) || !toText(baselineVariant.controlLabelPath)) {
    throw new Error(`Baseline variant=${baselineVariantId} is missing control pack or control labels`)
  }

  const selectedKeys = await readSelectedKeySet(baselineSelection.selectionPath)
  const controlRowsByPair = await loadControlRowIndex({
    controlPackPath: baselineVariant.controlPackPath,
    selectedKeys,
  })
  const { rowsByPair: labelRowsByPair, targetLabelIds } = await loadLabelRowIndex({
    controlLabelPath: baselineVariant.controlLabelPath,
    selectedKeys,
  })
  assertCoverage({
    selectedKeys,
    controlRowsByPair,
    labelRowsByPair,
    baselineVariantId,
  })

  const donorPairs = Array.from(selectedKeys.values()).sort((left, right) => left.localeCompare(right))
  const oosDecisionDates = uniqueSorted(
    donorPairs
      .map((joinKey) => labelRowsByPair.get(joinKey))
      .filter((row) => row?.splitBucket === "oos")
      .map((row) => row?.decisionDateKey),
  )
  const replayDateSets = resolveReplayDateSets({
    oosDecisionDates,
    recentReplayDecisionCount: replayDecisionCount,
  })

  const symbolAllowSet = new Set(donorPairs.map((joinKey) => joinKey.split("::")[0]).filter(Boolean))
  const candleRows = await readJsonl(resolvedCandlePath, {
    filter: (row) => symbolAllowSet.has(toText(row?.symbol)),
  })
  const seriesMap = buildCandleSeriesMap(candleRows, symbolAllowSet)
  const dateIndexMap = buildCandleDateIndexMap(seriesMap)

  const fullPolicyMenu = [...TP12_EXECUTION_POLICY_MENU_STOP_RECOVERY_V1]
  const fullPolicyIds = fullPolicyMenu.map((policy) => policy.policyId)
  if (!fullPolicyIds.includes(STOP_FIRST_POLICY_ID) || !fullPolicyIds.includes(DELAY1_POLICY_ID)) {
    throw new Error("Execution-learning bundle requires stop_first and delay1_4d policies in the TP12 menu")
  }
  const expandedPolicyOrder = [...fullPolicyIds, ABSTAIN_POLICY_ID]
  const corePolicyOrder = ["delay1_4d", "stop_first", ABSTAIN_POLICY_ID]

  const donorRows = []
  const labelRows = []
  for (const joinKey of donorPairs) {
    const controlRow = controlRowsByPair.get(joinKey)
    const labelRow = labelRowsByPair.get(joinKey)
    const symbol = toText(labelRow?.symbol ?? controlRow?.symbol)
    const decisionDateKey = ensureDateKey(labelRow?.decisionDateKey ?? controlRow?.decisionDateKey, "donor decisionDateKey")
    const scientificSplitBucket = toText(labelRow?.splitBucket)
    const learningSplitBucket = classifyLearningSplitBucket({
      scientificSplitBucket,
      decisionDateKey,
      validationDateSet: replayDateSets.validationDateSet,
      recentReplayDateSet: replayDateSets.recentReplayDateSet,
    })
    const symbolSeries = seriesMap.get(symbol)
    const symbolDateIndex = dateIndexMap.get(symbol)
    if (!symbolSeries || !symbolDateIndex || !symbolDateIndex.has(decisionDateKey)) {
      throw new Error(`Execution-learning bundle is missing candle decision index for ${joinKey}`)
    }
    const decisionIdx = Number(symbolDateIndex.get(decisionDateKey))
    const outcomeByPolicyId = {}
    for (const policy of fullPolicyMenu) {
      const outcome = simulateTp12ExecutionPolicyFromDecision({
        series: symbolSeries,
        decisionIdx,
        policy,
      })
      if (!outcome) {
        throw new Error(`Execution-learning policy simulation failed for ${joinKey} policy=${policy.policyId}`)
      }
      outcomeByPolicyId[policy.policyId] = normalizePolicyOutcome(outcome)
    }
    outcomeByPolicyId[ABSTAIN_POLICY_ID] = buildAbstainOutcome({
      decisionIdx,
      decisionDateKey,
    })

    const bestExpandedPolicy = chooseBestPolicy({
      outcomeByPolicyId,
      policyOrder: expandedPolicyOrder,
    })
    const coreOutcomeByPolicyId = {
      delay1_4d: {
        ...outcomeByPolicyId[DELAY1_POLICY_ID],
        policyId: "delay1_4d",
      },
      stop_first: {
        ...outcomeByPolicyId[STOP_FIRST_POLICY_ID],
        policyId: "stop_first",
      },
      [ABSTAIN_POLICY_ID]: outcomeByPolicyId[ABSTAIN_POLICY_ID],
    }
    const bestCorePolicy = chooseBestPolicy({
      outcomeByPolicyId: coreOutcomeByPolicyId,
      policyOrder: corePolicyOrder,
    })
    const stopFirstOutcome = outcomeByPolicyId[STOP_FIRST_POLICY_ID]
    const barrierOutcomeLabel = classifyBarrierOutcome(stopFirstOutcome)

    donorRows.push({
      kind: TP12_SIDE_DAILY_EXECUTION_DONOR_ROW_KIND,
      rowKey: joinKey,
      baselineVariantId,
      symbol,
      decisionDateKey,
      monthKey: decisionDateKey.slice(0, 7),
      requestId: toText(labelRow?.requestId),
      prevDateKey: ensureDateKey(labelRow?.prevDateKey, "donor prevDateKey"),
      asOfDateKey: ensureDateKey(labelRow?.asOfDateKey, "donor asOfDateKey"),
      stepALaneId: toText(labelRow?.stepALaneId),
      runId: toText(labelRow?.runId),
      eventLabel: toText(labelRow?.eventLabel),
      windowDateKeys: Array.isArray(labelRow?.windowDateKeys) ? labelRow.windowDateKeys.map((value) => ensureDateKey(value, "windowDateKey")) : [],
      scientificSplitBucket,
      learningSplitBucket,
      decisionIdx,
      targetLabelIds,
      noStopLabels: labelRow?.labels ?? {},
      featureVec: controlRow?.featureVec ?? {},
      contextualTokens: Array.isArray(controlRow?.contextualTokens) ? controlRow.contextualTokens : [],
      sideDailyControl: controlRow?.sideDailyControl ?? null,
      baseMeta: buildBaseMeta(controlRow),
    })

    labelRows.push({
      kind: TP12_SIDE_DAILY_EXECUTION_LABEL_ROW_KIND,
      rowKey: joinKey,
      baselineVariantId,
      symbol,
      decisionDateKey,
      scientificSplitBucket,
      learningSplitBucket,
      barrierOutcomeLabel,
      labels: {
        tp12_first: barrierOutcomeLabel === "tp12_first" ? 1 : 0,
        sl4_first: barrierOutcomeLabel === "sl4_first" ? 1 : 0,
        no_barrier_hit: barrierOutcomeLabel === "no_barrier_hit" ? 1 : 0,
        stop_first_net_ret: outcomeByPolicyId[STOP_FIRST_POLICY_ID]?.netRet ?? null,
        delay1_4d_net_ret: outcomeByPolicyId[DELAY1_POLICY_ID]?.netRet ?? null,
        bestPolicyChoice: bestCorePolicy.policyId,
        bestPolicyNetRet: bestCorePolicy.netRet,
        abstain_best_choice: bestCorePolicy.policyId === ABSTAIN_POLICY_ID ? 1 : 0,
        bestExecutionPolicyId: bestExpandedPolicy.policyId,
        bestExecutionPolicyNetRet: bestExpandedPolicy.netRet,
        bestHoldDays: Number(bestExpandedPolicy.outcome?.holdDays ?? 0) || 0,
        bestStopLossPct: numOrNull(bestExpandedPolicy.outcome?.stopLossPct),
        bestStopActivationDelayBars: Number(bestExpandedPolicy.outcome?.stopActivationDelayBars ?? 0) || 0,
        bestSameBarTiePolicy: toText(bestExpandedPolicy.outcome?.sameBarTiePolicy) || null,
        bestEntryMode: toText(bestExpandedPolicy.outcome?.entry) || null,
      },
      policyOutcomes: outcomeByPolicyId,
    })
  }

  donorRows.sort((left, right) => {
    const dateCmp = String(left.decisionDateKey).localeCompare(String(right.decisionDateKey))
    if (dateCmp !== 0) return dateCmp
    return String(left.symbol).localeCompare(String(right.symbol))
  })
  labelRows.sort((left, right) => {
    const dateCmp = String(left.decisionDateKey).localeCompare(String(right.decisionDateKey))
    if (dateCmp !== 0) return dateCmp
    return String(left.symbol).localeCompare(String(right.symbol))
  })

  await ensureDir(resolvedOutDir)
  const donorPath = path.join(resolvedOutDir, "donor_rows.jsonl")
  const labelPath = path.join(resolvedOutDir, "execution_label_rows.jsonl")
  const summaryPath = path.join(resolvedOutDir, "execution_learning_summary.json")
  await writeJsonl(donorPath, donorRows)
  await writeJsonl(labelPath, labelRows)

  const summary = {
    status: "ok",
    kind: TP12_SIDE_DAILY_EXECUTION_LEARNING_BUNDLE_KIND,
    pipelineSummaryPath: pipeline.path,
    selectionManifestPath: selectionManifest.path,
    baselineVariantId,
    decisionWindow: pipeline.summary?.decisionWindow ?? null,
    split: pipeline.summary?.split ?? null,
    recentReplayDecisionCount: replayDecisionCount,
    replaySplit: {
      trainSource: "scientific_split.train",
      validationSource: "scientific_split.oos excluding recent_replay trailing decision dates",
      recentReplaySource: "scientific_split.oos trailing decision dates",
      validationDecisionDateCount: replayDateSets.validationDates.length,
      recentReplayDecisionDateCount: replayDateSets.recentReplayDates.length,
      validationDecisionDateFrom: replayDateSets.validationDates[0] ?? null,
      validationDecisionDateTo: replayDateSets.validationDates[replayDateSets.validationDates.length - 1] ?? null,
      recentReplayDecisionDateFrom: replayDateSets.recentReplayDates[0] ?? null,
      recentReplayDecisionDateTo: replayDateSets.recentReplayDates[replayDateSets.recentReplayDates.length - 1] ?? null,
    },
    labelSchema: {
      coreActionChoices: ["delay1_4d", "stop_first", "abstain"],
      barrierOutcomeLabels: ["tp12_first", "sl4_first", "no_barrier_hit"],
      fullExecutionPolicyIds: expandedPolicyOrder,
      targetLabelIds,
    },
    donorRows: {
      path: donorPath,
      rowCount: donorRows.length,
      uniqueSymbols: uniqueSorted(donorRows.map((row) => row.symbol)).length,
      uniqueDecisionDates: uniqueSorted(donorRows.map((row) => row.decisionDateKey)).length,
      scientificSplitCounts: summarizeCounts(donorRows.map((row) => row.scientificSplitBucket)),
      learningSplitCounts: summarizeCounts(donorRows.map((row) => row.learningSplitBucket)),
      pairSignatureSha256: sha256(donorRows.map((row) => row.rowKey).join("\n")),
      fingerprint: await buildFileFingerprint(donorPath),
    },
    executionLabels: {
      path: labelPath,
      rowCount: labelRows.length,
      barrierOutcomeCounts: summarizeCounts(labelRows.map((row) => row.barrierOutcomeLabel)),
      bestPolicyChoiceCounts: summarizeCounts(labelRows.map((row) => row?.labels?.bestPolicyChoice)),
      bestExecutionPolicyCounts: summarizeCounts(labelRows.map((row) => row?.labels?.bestExecutionPolicyId)),
      meanNetRetByPolicyId: summarizePolicyNetRet({
        labelRows,
        policyIds: expandedPolicyOrder,
      }),
      fingerprint: await buildFileFingerprint(labelPath),
    },
    provenance: {
      candlePath: resolvedCandlePath,
      baselineSelectionPath: baselineSelection.selectionPath,
      baselineSelectionSummaryPath: baselineSelection.selectionSummaryPath,
      controlPackPath: baselineVariant.controlPackPath,
      controlLabelPath: baselineVariant.controlLabelPath,
      controlSummaryPath: baselineVariant.controlSummaryPath,
      candleFingerprint: await buildFileFingerprint(resolvedCandlePath),
      baselineSelectionFingerprint: await buildFileFingerprint(baselineSelection.selectionPath),
      controlPackFingerprint: await buildFileFingerprint(baselineVariant.controlPackPath),
      controlLabelFingerprint: await buildFileFingerprint(baselineVariant.controlLabelPath),
    },
  }

  await writeJson(summaryPath, summary)
  return {
    outDir: resolvedOutDir,
    donorPath,
    labelPath,
    summaryPath,
    summary,
  }
}
