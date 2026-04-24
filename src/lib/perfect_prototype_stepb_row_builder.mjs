import {
  extractGlobalContextFeaturesFromCache,
  extractSnapshotFeaturesFromCache,
  makeSequenceFromCache,
} from "./features.mjs"
import { buildPerfectPrototypeEventFeatureVec } from "./perfect_prototype_event_features.mjs"
import { simulateTradeFromDecision } from "./trade_rules.mjs"

const maybeAssign = (target, key, value) => {
  if (value == null) return
  target[key] = value
}

export const buildPerfectPrototypeDecisionFeatureBundle = ({
  cache,
  series,
  asOfIdx,
  symbol,
  universeRow,
  localWindow,
  globalWindow,
  surfaceName,
  eventMeta,
  highJumpMode,
}) => {
  const featureVec = extractSnapshotFeaturesFromCache({
    cache,
    series,
    asOfIdx,
    symbol,
    universeRow,
    surfaceName,
  })
  if (!featureVec) return null
  const globalFeatureVec = extractGlobalContextFeaturesFromCache({
    cache,
    series,
    asOfIdx,
    globalWindow,
  })
  const seq40 = makeSequenceFromCache({
    cache,
    series,
    endIdx: asOfIdx,
    window: localWindow,
  })
  const seq150 = makeSequenceFromCache({
    cache,
    series,
    endIdx: asOfIdx,
    window: globalWindow,
  })
  const eventFeatureVec = buildPerfectPrototypeEventFeatureVec(eventMeta, {
    highJumpMode,
  })
  return {
    featureVec,
    globalFeatureVec,
    eventFeatureVec,
    seq40,
    seq150,
  }
}

export const buildPerfectPrototypeDecisionOutcome = ({
  series,
  decisionIdx,
  entryRule,
  holdDays,
  targetPct,
  stopLossPct,
  costPct,
}) =>
  simulateTradeFromDecision({
    series,
    decisionIdx,
    entryRule,
    holdDays,
    targetPct,
    stopLossPct,
    costPct,
  })

export const buildPerfectPrototypeDecisionRow = ({
  sourceType = null,
  sourceId = null,
  templateId = null,
  symbol,
  name = null,
  dateKey = null,
  decisionDateKey = null,
  eventDate = null,
  eventDateKey = null,
  asOfDateKey = null,
  asOfDate = null,
  targetDateKey = null,
  decisionIdx = null,
  asOfIdx = null,
  targetIdx = null,
  sequenceWindow = null,
  localWindow = null,
  globalWindow = null,
  featureVec = null,
  globalFeatureVec = null,
  eventMeta = null,
  eventFeatureVec = null,
  marketContextVec = null,
  xsecEventVec = null,
  contextualTokens = [],
  stepALaneId = null,
  impulseSourceDateKey = null,
  impulseLookbackDays = null,
  impulseJumpPct = null,
  impulseJumpPctFromPrevClose = null,
  impulseJumpPctFromOpen = null,
  seq40 = null,
  seq150 = null,
  eventOutcome = null,
  label = null,
  templateKind = null,
  extraFields = null,
}) => {
  const row = {
    symbol,
    name: name ?? symbol,
    featureVec,
    globalFeatureVec,
    eventMeta,
    eventFeatureVec,
    marketContextVec,
    xsecEventVec,
    contextualTokens: Array.isArray(contextualTokens) ? contextualTokens : [],
    seq40,
    seq150,
    eventOutcome,
    outcomeHitTarget:
      typeof eventOutcome?.hitTarget === "boolean" ? eventOutcome.hitTarget : null,
  }
  maybeAssign(row, "sourceType", sourceType)
  maybeAssign(row, "sourceId", sourceId)
  maybeAssign(row, "templateId", templateId)
  maybeAssign(row, "dateKey", dateKey)
  maybeAssign(row, "decisionDateKey", decisionDateKey)
  maybeAssign(row, "eventDate", eventDate)
  maybeAssign(row, "eventDateKey", eventDateKey)
  maybeAssign(row, "asOfDateKey", asOfDateKey)
  maybeAssign(row, "asOfDate", asOfDate)
  maybeAssign(row, "targetDateKey", targetDateKey)
  maybeAssign(row, "decisionIdx", decisionIdx)
  maybeAssign(row, "asOfIdx", asOfIdx)
  maybeAssign(row, "targetIdx", targetIdx)
  maybeAssign(row, "sequenceWindow", sequenceWindow)
  maybeAssign(row, "localWindow", localWindow)
  maybeAssign(row, "globalWindow", globalWindow)
  maybeAssign(row, "stepALaneId", stepALaneId)
  maybeAssign(row, "impulseSourceDateKey", impulseSourceDateKey)
  maybeAssign(row, "impulseLookbackDays", impulseLookbackDays)
  maybeAssign(row, "impulseJumpPct", impulseJumpPct)
  maybeAssign(row, "impulseJumpPctFromPrevClose", impulseJumpPctFromPrevClose)
  maybeAssign(row, "impulseJumpPctFromOpen", impulseJumpPctFromOpen)
  maybeAssign(row, "label", label)
  maybeAssign(row, "templateKind", templateKind)
  if (extraFields && typeof extraFields === "object") {
    for (const [key, value] of Object.entries(extraFields)) {
      maybeAssign(row, key, value)
    }
  }
  return row
}
