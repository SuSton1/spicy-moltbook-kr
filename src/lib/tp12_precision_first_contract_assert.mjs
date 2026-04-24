import path from "node:path"

import { readJson, writeJson } from "./io.mjs"
import { assertLiveFeatureFieldList, PATCH_KEY } from "./tp12_precision_first_feature_whitelist.mjs"
import { toBool, toText, validDateKey } from "./tp12_year2hit_foundation_io.mjs"

const assertDateRange = (range, label) => {
  const from = toText(range?.from)
  const to = toText(range?.to)
  if (!validDateKey(from) || !validDateKey(to) || from > to) {
    throw new Error(`${label} must be a valid YYYY-MM-DD range: ${from || "missing"}..${to || "missing"}`)
  }
  return { from, to }
}

const assertFalse = (value, label) => {
  if (toBool(value, false) !== false) throw new Error(`${label} must be false`)
}

const assertTrue = (value, label) => {
  if (toBool(value, false) !== true) throw new Error(`${label} must be true`)
}

const assertNoForbiddenPath = ({ candidatePath = "", forbiddenRange, label }) => {
  const text = toText(candidatePath)
  if (!text) return
  const normalized = text.replaceAll("\\", "/").toLowerCase()
  const baseName = path.basename(normalized)
  const segments = normalized.split("/").filter(Boolean)
  const hasOosSegment = segments.some((segment) => segment === "oos" || segment.startsWith("oos_") || segment.startsWith("oos-"))
  const hasForbiddenIsoDate = /(?:^|[^0-9])20(?:25|26)-[0-9]{2}-[0-9]{2}(?:[^0-9]|$)/.test(normalized)
  if (hasOosSegment || baseName.startsWith("oos") || hasForbiddenIsoDate) {
    throw new Error(`${label} appears to reference OOS or forbidden path: ${text}`)
  }
  if (text.includes(forbiddenRange.from) || text.includes(forbiddenRange.to)) {
    throw new Error(`${label} references forbidden date range boundary: ${text}`)
  }
}

export const assertTp12PrecisionFirstDailyOnlyContract = async ({
  contractPath,
  candidatePath = "",
  outSummaryPath = "",
  liveFeatureFields = [],
} = {}) => {
  if (!toText(contractPath)) throw new Error("contractPath is required")
  const resolvedContractPath = path.resolve(contractPath)
  const contract = await readJson(resolvedContractPath, null)
  if (!contract) throw new Error(`contract not found: ${resolvedContractPath}`)
  if (toText(contract.patchKey) !== PATCH_KEY) {
    throw new Error(`unexpected patchKey: ${toText(contract.patchKey) || "missing"}`)
  }
  if (toText(contract.kind) !== "tp12_year2hit_precision_first_daily_only_contract_v1") {
    throw new Error(`unexpected contract kind: ${toText(contract.kind) || "missing"}`)
  }
  const trainDateRange = assertDateRange(contract.trainDateRange, "trainDateRange")
  const forbiddenOosDateRange = assertDateRange(contract.forbiddenOosDateRange, "forbiddenOosDateRange")
  if (trainDateRange.to >= forbiddenOosDateRange.from) {
    throw new Error(`train range overlaps forbidden OOS range: ${trainDateRange.to} >= ${forbiddenOosDateRange.from}`)
  }
  assertTrue(contract.featureScope?.dailyOnly, "featureScope.dailyOnly")
  assertFalse(contract.featureScope?.sideDailyAllowed, "featureScope.sideDailyAllowed")
  assertFalse(contract.featureScope?.intradayAllowed, "featureScope.intradayAllowed")
  assertFalse(contract.featureScope?.themeAllowed, "featureScope.themeAllowed")
  assertFalse(
    contract.featureScope?.futureLabelFieldsAllowedAsLiveFeatures,
    "featureScope.futureLabelFieldsAllowedAsLiveFeatures",
  )
  assertFalse(contract.lockRules?.emitLockedSelector, "lockRules.emitLockedSelector")
  assertFalse(contract.lockRules?.oosReplayAllowed, "lockRules.oosReplayAllowed")
  assertFalse(contract.lockRules?.fallbackAllowed, "lockRules.fallbackAllowed")
  assertFalse(contract.lockRules?.oosTuningAllowed, "lockRules.oosTuningAllowed")
  if (Number(contract.year2hitGate?.minHitsPerCoreYear) !== 2) {
    throw new Error("year2hitGate.minHitsPerCoreYear must be exactly 2")
  }
  assertFalse(contract.year2hitGate?.relaxAllowed, "year2hitGate.relaxAllowed")
  if (Array.isArray(liveFeatureFields) && liveFeatureFields.length > 0) {
    assertLiveFeatureFieldList(liveFeatureFields, { contextLabel: "contract liveFeatureFields" })
  }
  assertNoForbiddenPath({ candidatePath, forbiddenRange: forbiddenOosDateRange, label: "candidatePath" })
  const summary = {
    kind: "tp12_year2hit_precision_first_daily_only_contract_assert_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    patchKey: PATCH_KEY,
    contractPath: resolvedContractPath,
    trainDateRange,
    forbiddenOosDateRange,
    dailyOnly: true,
    sideDailyAllowed: false,
    intradayAllowed: false,
    themeAllowed: false,
    lockedSelectorEmitted: false,
    oosReplayAllowed: false,
    fallbackAllowed: false,
  }
  if (toText(outSummaryPath)) await writeJson(path.resolve(outSummaryPath), summary)
  return { contract, summary }
}
