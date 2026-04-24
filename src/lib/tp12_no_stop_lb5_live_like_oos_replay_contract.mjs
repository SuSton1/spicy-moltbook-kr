import path from "node:path"

import { normalizeDateKey } from "./date.mjs"
import { readJson } from "./io.mjs"

export const TP12_NO_STOP_LB5_LIVE_LIKE_OOS_REPLAY_CONTRACT_KIND =
  "tp12_no_stop_lb5_live_like_oos_replay_contract_v1"
export const DEFAULT_TP12_NO_STOP_LB5_LIVE_LIKE_OOS_REPLAY_CONTRACT_PATH =
  "meta/tp12_no_stop_lb5_live_like_oos_replay_contract.json"

const toText = (value) => String(value ?? "").trim()

const assertNonEmpty = (value, label) => {
  const text = toText(value)
  if (!text) {
    throw new Error(`${label} is required`)
  }
  return text
}

const assertDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
}

const assertPositiveInteger = (value, label) => {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(`${label} must be a positive integer: ${value ?? "<null>"}`)
  }
  return numeric
}

const assertFiniteNumber = (value, label) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be finite: ${value ?? "<null>"}`)
  }
  return numeric
}

export const loadTp12NoStopLb5LiveLikeOosReplayContract = async ({
  contractPath = DEFAULT_TP12_NO_STOP_LB5_LIVE_LIKE_OOS_REPLAY_CONTRACT_PATH,
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = path.resolve(
    cwd,
    toText(contractPath) || DEFAULT_TP12_NO_STOP_LB5_LIVE_LIKE_OOS_REPLAY_CONTRACT_PATH,
  )
  const raw = await readJson(resolvedContractPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing TP12 no-stop lb5 live-like OOS replay contract: ${resolvedContractPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "contract.kind")
  if (kind !== TP12_NO_STOP_LB5_LIVE_LIKE_OOS_REPLAY_CONTRACT_KIND) {
    throw new Error(`Unsupported TP12 no-stop lb5 live-like OOS replay contract kind=${kind}`)
  }
  const trainWindow = {
    from: assertDateKey(raw?.trainWindow?.from, "trainWindow.from"),
    to: assertDateKey(raw?.trainWindow?.to, "trainWindow.to"),
  }
  const oosWindow = {
    from: assertDateKey(raw?.oosWindow?.from, "oosWindow.from"),
    to: assertDateKey(raw?.oosWindow?.to, "oosWindow.to"),
  }
  if (trainWindow.from > trainWindow.to) {
    throw new Error(`Invalid train window ${trainWindow.from}:${trainWindow.to}`)
  }
  if (oosWindow.from > oosWindow.to) {
    throw new Error(`Invalid oos window ${oosWindow.from}:${oosWindow.to}`)
  }
  if (!(trainWindow.to < oosWindow.from)) {
    throw new Error(`train/oos overlap: trainEnd=${trainWindow.to} oosStart=${oosWindow.from}`)
  }
  const selectionMode = assertNonEmpty(raw.selectionMode, "contract.selectionMode").toLowerCase()
  if (selectionMode !== "union_all") {
    throw new Error(`live-like replay selectionMode must stay union_all: ${selectionMode}`)
  }
  return {
    kind,
    contractId: assertNonEmpty(raw.contractId, "contract.contractId"),
    contractPath: resolvedContractPath,
    updatedAt: assertNonEmpty(raw.updatedAt, "contract.updatedAt"),
    scopeId: assertNonEmpty(raw.scopeId, "contract.scopeId"),
    baseCandidateId: assertNonEmpty(raw.baseCandidateId, "contract.baseCandidateId"),
    lookbackTradingDays: assertPositiveInteger(raw.lookbackTradingDays, "contract.lookbackTradingDays"),
    selectionMode,
    baseRollingContractPath: path.resolve(
      cwd,
      assertNonEmpty(raw.baseRollingContractPath, "contract.baseRollingContractPath"),
    ),
    trainWindow,
    oosWindow,
    labelContract: {
      primaryLabelId: assertNonEmpty(raw?.labelContract?.primaryLabelId, "labelContract.primaryLabelId"),
      secondaryLabelId: assertNonEmpty(raw?.labelContract?.secondaryLabelId, "labelContract.secondaryLabelId"),
    },
    baselineRunIds: {
      baseRunId: assertNonEmpty(raw?.baselineRunIds?.baseRunId, "baselineRunIds.baseRunId"),
      sourceRunId: assertNonEmpty(raw?.baselineRunIds?.sourceRunId, "baselineRunIds.sourceRunId"),
      scopeRunId: assertNonEmpty(raw?.baselineRunIds?.scopeRunId, "baselineRunIds.scopeRunId"),
    },
    baselineMetrics: {
      curatedRuleCount: assertPositiveInteger(raw?.baselineMetrics?.curatedRuleCount, "baselineMetrics.curatedRuleCount"),
      oosCandidateRows: assertPositiveInteger(raw?.baselineMetrics?.oosCandidateRows, "baselineMetrics.oosCandidateRows"),
      oosSelectedRows: assertPositiveInteger(raw?.baselineMetrics?.oosSelectedRows, "baselineMetrics.oosSelectedRows"),
      oosHitRows: assertPositiveInteger(raw?.baselineMetrics?.oosHitRows, "baselineMetrics.oosHitRows"),
      oosHitRate: assertFiniteNumber(raw?.baselineMetrics?.oosHitRate, "baselineMetrics.oosHitRate"),
      oosUniqueMatchedDates: assertPositiveInteger(
        raw?.baselineMetrics?.oosUniqueMatchedDates,
        "baselineMetrics.oosUniqueMatchedDates",
      ),
      oosUniqueMatchedSymbols: assertPositiveInteger(
        raw?.baselineMetrics?.oosUniqueMatchedSymbols,
        "baselineMetrics.oosUniqueMatchedSymbols",
      ),
      oosTop1DateShare: assertFiniteNumber(raw?.baselineMetrics?.oosTop1DateShare, "baselineMetrics.oosTop1DateShare"),
    },
    hardStops: Array.isArray(raw?.hardStops) ? raw.hardStops.map((value) => toText(value)).filter(Boolean) : [],
    notes: Array.isArray(raw?.notes) ? raw.notes.map((value) => toText(value)).filter(Boolean) : [],
  }
}
