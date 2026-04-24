import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import {
  ensureDir,
  iterateJsonl,
  pathExists,
  readJson,
  readJsonl,
  writeJson,
  writeJsonAtomic,
  writeJsonl,
} from "./io.mjs"
import {
  PERFECT_PROTOTYPE_DISCOVERY_UNIVERSE_AFREE_OPEN,
  buildRecentImpulseUniverseId,
  buildSameDayPlusRecentUniverseId,
} from "./perfect_prototype_multiline_contract.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "./perfect_prototype_server_policy.mjs"

export const LIVE_PRIORITY_REGISTRY_VERSION = 1
export const LIVE_PRIORITY_STATE_VERSION = 1
export const LIVE_PRIORITY_LINE_RESULTS_MANIFEST_VERSION = 1
export const LIVE_PRIORITY_FINAL_UNION_POLICY = "priority_first_symbol_dedup"
export const LIVE_PRIORITY_TARGET_DATE_MODE = "latest_common_data_date"
export const LIVE_PRIORITY_CLOSE_RET_FILTER_GTE_PCT = 28

export const LIVE_PRIORITY_STATUS_COMPLETED = "completed"
export const LIVE_PRIORITY_STATUS_RUNNING = "running"
export const LIVE_PRIORITY_STATUS_NOOP_ALREADY_PROCESSED = "noop_already_processed"
export const LIVE_PRIORITY_STATUS_FAILED_STALE_DATA = "failed_stale_data"
export const LIVE_PRIORITY_STATUS_FAILED_LINE_ERROR = "failed_line_error"

export const LIVE_PRIORITY_RUNNER_AFREE_STEPB_OPEN = "afree_stepb_open"
export const LIVE_PRIORITY_RUNNER_PLUS_LITE_SAME_DAY_RECENT = "plus_lite_same_day_recent"
export const LIVE_PRIORITY_RUNNER_PLUS_LITE_SAME_DAY_RECENT_LANE_LOCAL =
  "plus_lite_same_day_recent_lane_local"
export const LIVE_PRIORITY_RUNNER_PLUS_LITE_RECENT_MID_LOW = "plus_lite_recent_mid_low"
export const LIVE_PRIORITY_REGISTRY_ROLE = "canonical_live_operating_stack"

const SHA256_HEX = /^[0-9a-f]{64}$/u
const ISO_DATE_KEY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u

const normalizeText = (value) => String(value ?? "").trim()

const uniqueSorted = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const firstText = (...values) => {
  for (const value of values) {
    const normalized = normalizeText(value)
    if (normalized) return normalized
  }
  return null
}

const toPositiveInteger = (value) => {
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n > 0 ? n : null
}

const toPositiveNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item))
  }
  if (value && typeof value === "object") {
    const out = {}
    for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      out[key] = canonicalize(value[key])
    }
    return out
  }
  return value
}

const sha256OfJson = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")

const sha256OfBuffer = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex")

const assertIsoDateKey = (value, label) => {
  const normalized = normalizeText(value)
  if (!ISO_DATE_KEY.test(normalized)) {
    throw new Error(`${label} must be YYYY-MM-DD, got: ${value ?? "null"}`)
  }
  return normalized
}

const assertSha256 = (value, label) => {
  const normalized = normalizeText(value).toLowerCase()
  if (!SHA256_HEX.test(normalized)) {
    throw new Error(`${label} must be a 64-char sha256 hex string, got: ${value ?? "null"}`)
  }
  return normalized
}

const resolveRepoPath = ({ policy, cwd, filePath }) => {
  const normalized = normalizeText(filePath)
  if (!normalized) return null
  if (path.isAbsolute(normalized)) return path.resolve(normalized)
  const base = policy?.repoRoot ?? cwd
  return path.resolve(base, normalized)
}

const buildCatalogLabel = ({ catalogLabel, catalogPath }) => {
  const direct = normalizeText(catalogLabel)
  if (direct) return direct
  return path.basename(path.dirname(String(catalogPath ?? "")))
}

const normalizeOptionalRepoPath = (value) => {
  const normalized = normalizeText(value)
  return normalized || null
}

const compareLinePrecedence = (left, right) => {
  if (Number(left?.priority ?? Number.MAX_SAFE_INTEGER) !== Number(right?.priority ?? Number.MAX_SAFE_INTEGER)) {
    return Number(left.priority ?? Number.MAX_SAFE_INTEGER) - Number(right.priority ?? Number.MAX_SAFE_INTEGER)
  }
  if (Number(left?.lineOrder ?? Number.MAX_SAFE_INTEGER) !== Number(right?.lineOrder ?? Number.MAX_SAFE_INTEGER)) {
    return Number(left.lineOrder ?? Number.MAX_SAFE_INTEGER) - Number(right.lineOrder ?? Number.MAX_SAFE_INTEGER)
  }
  return String(left?.lineId ?? "").localeCompare(String(right?.lineId ?? ""))
}

const compareSymbolRows = (left, right) => {
  if (String(left?.recommendationDateKey ?? "") !== String(right?.recommendationDateKey ?? "")) {
    return String(left?.recommendationDateKey ?? "").localeCompare(String(right?.recommendationDateKey ?? ""))
  }
  if (String(left?.symbol ?? "") !== String(right?.symbol ?? "")) {
    return String(left?.symbol ?? "").localeCompare(String(right?.symbol ?? ""))
  }
  return compareLinePrecedence(left, right)
}

const extractSummaryCount = (summary, keys) => {
  for (const key of keys) {
    const value = Number(summary?.[key])
    if (Number.isFinite(value)) return value
  }
  return 0
}

const normalizeLinePickRow = (row, line) => {
  const recommendationDateKey = firstText(row?.recommendationDateKey, row?.dateKey)
  const symbol = normalizeText(row?.symbol)
  if (!recommendationDateKey || !symbol) return null
  return {
    recommendationDateKey,
    dateKey: recommendationDateKey,
    symbol,
    name: firstText(row?.name, row?.symbolName),
    asOfDateKey: firstText(row?.asOfDateKey),
    entryDateKey: firstText(row?.entryDateKey),
    exitDateKey: firstText(row?.exitDateKey),
    matchedRuleIds: uniqueSorted(row?.matchedRuleIds),
    primaryRuleId: firstText(row?.primaryRuleId),
    outcomeHitTarget:
      typeof row?.outcomeHitTarget === "boolean"
        ? row.outcomeHitTarget
        : typeof row?.eventOutcome?.hitTarget === "boolean"
          ? row.eventOutcome.hitTarget
          : null,
    recommendationDateCloseRetPct:
      Number.isFinite(Number(row?.recommendationDateCloseRetPct)) ? Number(row.recommendationDateCloseRetPct) : null,
    priority: Number(line.priority),
    lineId: String(line.lineId),
    lineOrder: Number(line.lineOrder),
    lineRole: firstText(line?.lineRole),
    status: firstText(line?.status),
    reportLabel: firstText(line?.reportLabel),
    runnerType: String(line.runnerType),
    sourceCatalogLabel: String(line.catalogLabel),
    catalogPath: String(line.catalogPath),
    runId: firstText(line?.runId),
  }
}

const summarizeSupportingLine = (row) => ({
  priority: Number(row.priority),
  lineId: String(row.lineId),
  lineOrder: Number(row.lineOrder),
  lineRole: firstText(row?.lineRole),
  status: firstText(row?.status),
  reportLabel: firstText(row?.reportLabel),
  sourceCatalogLabel: String(row.sourceCatalogLabel),
  primaryRuleId: firstText(row.primaryRuleId),
  matchedRuleIds: uniqueSorted(row.matchedRuleIds),
  runId: firstText(row.runId),
})

export const computeFileSha256 = async (filePath) => {
  const payload = await fs.readFile(filePath)
  return sha256OfBuffer(payload)
}

export const computeLivePriorityRegistrySha256 = async (registryPath) => computeFileSha256(registryPath)

export const loadLivePriorityRegistry = async ({
  registryPath = "config/ops/live_priority_registry.server.json",
  cwd = process.cwd(),
  toolName = "live_priority_registry",
} = {}) => {
  const policy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName,
  })
  const resolvedRegistryPath = resolveRepoPath({
    policy,
    cwd,
    filePath: registryPath,
  })
  if (!resolvedRegistryPath || !pathExists(resolvedRegistryPath)) {
    throw new Error(`live priority registry not found: ${registryPath}`)
  }
  assertPerfectPrototypeServerPaths({
    entries: [{ label: "registryPath", filePath: resolvedRegistryPath }],
    policy,
    toolName,
  })
  const rawRegistry = await readJson(resolvedRegistryPath, null)
  if (!rawRegistry || typeof rawRegistry !== "object") {
    throw new Error(`live priority registry must be a JSON object: ${resolvedRegistryPath}`)
  }
  const registryVersion = Number(rawRegistry?.version ?? 0)
  if (registryVersion !== LIVE_PRIORITY_REGISTRY_VERSION) {
    throw new Error(
      `live priority registry version must be ${LIVE_PRIORITY_REGISTRY_VERSION}, got ${rawRegistry?.version ?? "null"}`,
    )
  }
  const finalUnionPolicy = normalizeText(rawRegistry?.finalUnionPolicy)
  if (finalUnionPolicy !== LIVE_PRIORITY_FINAL_UNION_POLICY) {
    throw new Error(
      `live priority registry finalUnionPolicy must be ${LIVE_PRIORITY_FINAL_UNION_POLICY}, got ${rawRegistry?.finalUnionPolicy ?? "null"}`,
    )
  }
  const registryRole = firstText(rawRegistry?.registryRole) ?? LIVE_PRIORITY_REGISTRY_ROLE
  if (registryRole !== LIVE_PRIORITY_REGISTRY_ROLE) {
    throw new Error(
      `live priority registry registryRole must be ${LIVE_PRIORITY_REGISTRY_ROLE}, got ${rawRegistry?.registryRole ?? "null"}`,
    )
  }
  const stackId = firstText(rawRegistry?.stackId, rawRegistry?.registryId) ?? path.basename(resolvedRegistryPath)
  const contractDocPath = normalizeOptionalRepoPath(rawRegistry?.contractDocPath)
  const artifactsDocPath = normalizeOptionalRepoPath(rawRegistry?.artifactsDocPath)
  const targetDateMode = normalizeText(rawRegistry?.targetDateMode)
  if (targetDateMode !== LIVE_PRIORITY_TARGET_DATE_MODE) {
    throw new Error(
      `live priority registry targetDateMode must be ${LIVE_PRIORITY_TARGET_DATE_MODE}, got ${rawRegistry?.targetDateMode ?? "null"}`,
    )
  }
  const recommendationCloseRetFilterGtePct = toPositiveNumber(rawRegistry?.recommendationCloseRetFilterGtePct)
  if (recommendationCloseRetFilterGtePct == null) {
    throw new Error(
      "live priority registry recommendationCloseRetFilterGtePct must be a positive number",
    )
  }
  const rawLines = Array.isArray(rawRegistry?.lines) ? rawRegistry.lines : []
  if (rawLines.length < 1) {
    throw new Error(`live priority registry has no lines: ${resolvedRegistryPath}`)
  }

  const seenLineIds = new Set()
  const seenLineOrders = new Set()
  const normalizedLines = rawLines.map((rawLine, index) => {
    const lineId = normalizeText(rawLine?.lineId)
    if (!lineId) {
      throw new Error(`live priority registry line[${index}] missing lineId`)
    }
    if (seenLineIds.has(lineId)) {
      throw new Error(`duplicate live priority lineId: ${lineId}`)
    }
    seenLineIds.add(lineId)

    const priority = toPositiveInteger(rawLine?.priority)
    if (priority == null || ![1, 2, 3].includes(priority)) {
      throw new Error(`live priority line ${lineId} priority must be 1, 2, or 3`)
    }

    const lineOrder = toPositiveInteger(rawLine?.lineOrder)
    if (lineOrder == null) {
      throw new Error(`live priority line ${lineId} lineOrder must be integer >= 1`)
    }
    if (seenLineOrders.has(lineOrder)) {
      throw new Error(`duplicate live priority lineOrder: ${lineOrder}`)
    }
    seenLineOrders.add(lineOrder)

    const runnerType = normalizeText(rawLine?.runnerType)
    if (
      runnerType !== LIVE_PRIORITY_RUNNER_AFREE_STEPB_OPEN &&
      runnerType !== LIVE_PRIORITY_RUNNER_PLUS_LITE_SAME_DAY_RECENT &&
      runnerType !== LIVE_PRIORITY_RUNNER_PLUS_LITE_SAME_DAY_RECENT_LANE_LOCAL &&
      runnerType !== LIVE_PRIORITY_RUNNER_PLUS_LITE_RECENT_MID_LOW
    ) {
      throw new Error(`live priority line ${lineId} has unsupported runnerType: ${rawLine?.runnerType ?? "null"}`)
    }

    const selectionMode = normalizeText(rawLine?.selectionMode)
    if (selectionMode !== "union_all") {
      throw new Error(`live priority line ${lineId} selectionMode must be union_all`)
    }

    const enabled = rawLine?.enabled !== false
    const catalogPath = resolveRepoPath({
      policy,
      cwd,
      filePath: rawLine?.catalogPath,
    })
    if (!catalogPath) {
      throw new Error(`live priority line ${lineId} missing catalogPath`)
    }
    assertPerfectPrototypeServerPaths({
      entries: [{ label: `${lineId}.catalogPath`, filePath: catalogPath }],
      policy,
      toolName,
    })
    if (enabled && !pathExists(catalogPath)) {
      throw new Error(`enabled live priority line ${lineId} catalog not found: ${catalogPath}`)
    }

    const expectedCatalogSha256 = assertSha256(rawLine?.expectedCatalogSha256, `${lineId}.expectedCatalogSha256`)
    const expectedRuleIdsSha256 = assertSha256(rawLine?.expectedRuleIdsSha256, `${lineId}.expectedRuleIdsSha256`)
    const catalogLabel = buildCatalogLabel({
      catalogLabel: rawLine?.catalogLabel,
      catalogPath,
    })
    const lineRole =
      firstText(rawLine?.lineRole) ??
      (priority === 1
        ? "primary_operating_subset"
        : priority === 2
          ? "secondary_operating_subset"
          : "shadow_operating_subset")
    const status = firstText(rawLine?.status) ?? "active"
    const promotionBasis = firstText(rawLine?.promotionBasis)
    const reportLabel = firstText(rawLine?.reportLabel, lineId) ?? lineId

    const discoveryUniverseId = normalizeText(rawLine?.discoveryUniverseId)
    const lookbackTradingDays = toPositiveInteger(rawLine?.lookbackTradingDays)
    const excludeRecommendationCloseRetPctGte = toPositiveNumber(rawLine?.excludeRecommendationCloseRetPctGte)
    if (excludeRecommendationCloseRetPctGte == null) {
      throw new Error(
        `live priority line ${lineId} excludeRecommendationCloseRetPctGte must be a positive number`,
      )
    }
    if (excludeRecommendationCloseRetPctGte !== recommendationCloseRetFilterGtePct) {
      throw new Error(
        `live priority line ${lineId} excludeRecommendationCloseRetPctGte must equal registry recommendationCloseRetFilterGtePct=${recommendationCloseRetFilterGtePct}`,
      )
    }
    if (runnerType === LIVE_PRIORITY_RUNNER_AFREE_STEPB_OPEN) {
      if (discoveryUniverseId !== PERFECT_PROTOTYPE_DISCOVERY_UNIVERSE_AFREE_OPEN) {
        throw new Error(
          `live priority line ${lineId} discoveryUniverseId must be ${PERFECT_PROTOTYPE_DISCOVERY_UNIVERSE_AFREE_OPEN}`,
        )
      }
      if (lookbackTradingDays != null) {
        throw new Error(`live priority line ${lineId} lookbackTradingDays must be empty for afree_stepb_open`)
      }
    }
    if (
      runnerType === LIVE_PRIORITY_RUNNER_PLUS_LITE_SAME_DAY_RECENT ||
      runnerType === LIVE_PRIORITY_RUNNER_PLUS_LITE_SAME_DAY_RECENT_LANE_LOCAL
    ) {
      if (lookbackTradingDays == null) {
        throw new Error(`live priority line ${lineId} lookbackTradingDays must be integer >= 1`)
      }
      const expectedUniverseId =
        runnerType === LIVE_PRIORITY_RUNNER_PLUS_LITE_SAME_DAY_RECENT_LANE_LOCAL
          ? buildSameDayPlusRecentUniverseId(1)
          : buildSameDayPlusRecentUniverseId(lookbackTradingDays)
      if (discoveryUniverseId !== expectedUniverseId) {
        throw new Error(
          `live priority line ${lineId} discoveryUniverseId must equal ${expectedUniverseId}, got ${rawLine?.discoveryUniverseId ?? "null"}`,
        )
      }
      if (runnerType === LIVE_PRIORITY_RUNNER_PLUS_LITE_SAME_DAY_RECENT_LANE_LOCAL && lookbackTradingDays !== 1) {
        throw new Error(`live priority line ${lineId} lane-local shadow lines must use lookbackTradingDays=1`)
      }
    }
    if (runnerType === LIVE_PRIORITY_RUNNER_PLUS_LITE_RECENT_MID_LOW) {
      if (lookbackTradingDays !== 1) {
        throw new Error(`live priority line ${lineId} recent MID/LOW shadow lines must use lookbackTradingDays=1`)
      }
      const expectedUniverseId = buildRecentImpulseUniverseId(1)
      if (discoveryUniverseId !== expectedUniverseId) {
        throw new Error(
          `live priority line ${lineId} discoveryUniverseId must equal ${expectedUniverseId}, got ${rawLine?.discoveryUniverseId ?? "null"}`,
        )
      }
    }

    return {
      lineId,
      priority,
      lineOrder,
      enabled,
      runnerType,
      selectionMode,
      catalogPath,
      catalogLabel,
      lineRole,
      status,
      promotionBasis,
      reportLabel,
      expectedCatalogSha256,
      expectedRuleIdsSha256,
      discoveryUniverseId,
      lookbackTradingDays,
      excludeRecommendationCloseRetPctGte,
      notes: Array.isArray(rawLine?.notes) ? rawLine.notes.map((value) => normalizeText(value)).filter(Boolean) : [],
    }
  })

  normalizedLines.sort(compareLinePrecedence)
  const registrySha256 = await computeLivePriorityRegistrySha256(resolvedRegistryPath)
  return {
    policy,
    registryPath: resolvedRegistryPath,
    registrySha256,
    registryId: firstText(rawRegistry?.registryId) ?? path.basename(resolvedRegistryPath),
    stackId,
    registryRole,
    contractDocPath,
    artifactsDocPath,
    targetDateMode,
    finalUnionPolicy,
    recommendationCloseRetFilterGtePct,
    lines: normalizedLines,
    enabledLines: normalizedLines.filter((line) => line.enabled === true),
    notes: Array.isArray(rawRegistry?.notes) ? rawRegistry.notes.map((value) => normalizeText(value)).filter(Boolean) : [],
    raw: rawRegistry,
  }
}

export const computeLatestDateKeyFromJsonl = async (filePath, { fields = ["dateKey"] } = {}) => {
  let latest = null
  const normalizedFields = uniqueSorted(fields)
  await iterateJsonl(filePath, {
    strict: true,
    onRow: async (row) => {
      const value = firstText(...normalizedFields.map((field) => row?.[field]))
      if (!ISO_DATE_KEY.test(value)) return
      if (!latest || value > latest) latest = value
    },
  })
  return latest
}

export const computeLivePriorityDataSnapshot = async ({ policy }) => {
  const candlePath = path.join(policy.dataRoot, "candle_daily.jsonl")
  const universePath = path.join(policy.dataRoot, "universe_daily.jsonl")
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "candleDailyJsonl", filePath: candlePath, allowedRoot: policy.dataRoot },
      { label: "universeDailyJsonl", filePath: universePath, allowedRoot: policy.dataRoot },
    ],
    policy,
    toolName: "live_priority_data_snapshot",
  })
  const candleLatestDate = pathExists(candlePath)
    ? await computeLatestDateKeyFromJsonl(candlePath, { fields: ["dateKey"] })
    : null
  const universeLatestDate = pathExists(universePath)
    ? await computeLatestDateKeyFromJsonl(universePath, { fields: ["tradingDateKey", "dateKey"] })
    : null
  const isSynchronized = !!candleLatestDate && candleLatestDate === universeLatestDate
  return {
    candlePath,
    universePath,
    candleLatestDate,
    universeLatestDate,
    isSynchronized,
    latestCommonDate: isSynchronized ? candleLatestDate : null,
  }
}

export const loadLivePriorityState = async (statePath) => {
  if (!statePath || !pathExists(statePath)) return null
  const payload = await readJson(statePath, null)
  if (!payload || typeof payload !== "object") return null
  return payload
}

export const buildLivePriorityStatePayload = ({ summary }) => ({
  version: LIVE_PRIORITY_STATE_VERSION,
  updatedAt: new Date().toISOString(),
  status: String(summary?.status ?? LIVE_PRIORITY_STATUS_COMPLETED),
  lastSuccessfulTargetDate: assertIsoDateKey(summary?.targetDate, "summary.targetDate"),
  runId: firstText(summary?.runId),
  registryPath: firstText(summary?.registryPath),
  registrySha256: firstText(summary?.registrySha256),
  finalUnionCount: Number(summary?.finalUnionCount ?? 0) || 0,
  priorityCounts: summary?.priorityCounts ?? { priority1: 0, priority2: 0, priority3: 0 },
})

export const buildLivePriorityActivityPayload = ({
  status = LIVE_PRIORITY_STATUS_RUNNING,
  runId = null,
  targetDate = null,
  dataSnapshot = null,
  registry = null,
  lastSuccessfulTargetDate = null,
  activeLine = null,
  completedLineIds = [],
  lineResults = [],
  failureReason = null,
} = {}) => ({
  version: LIVE_PRIORITY_STATE_VERSION,
  updatedAt: new Date().toISOString(),
  status: firstText(status, LIVE_PRIORITY_STATUS_RUNNING),
  runId: firstText(runId),
  targetDate: firstText(targetDate),
  candleLatestDate: firstText(dataSnapshot?.candleLatestDate),
  universeLatestDate: firstText(dataSnapshot?.universeLatestDate),
  latestCommonDate: firstText(dataSnapshot?.latestCommonDate),
  lastSuccessfulTargetDate: firstText(lastSuccessfulTargetDate),
  registryId: firstText(registry?.registryId),
  registryPath: firstText(registry?.registryPath),
  registrySha256: firstText(registry?.registrySha256),
  stackId: firstText(registry?.stackId),
  registryRole: firstText(registry?.registryRole),
  activeLine:
    activeLine && typeof activeLine === "object"
      ? {
          lineId: firstText(activeLine?.lineId),
          priority: Number(activeLine?.priority ?? 0) || null,
          lineOrder: Number(activeLine?.lineOrder ?? 0) || null,
          runId: firstText(activeLine?.runId),
        }
      : null,
  completedLineIds: uniqueSorted(completedLineIds),
  completedLineCount: uniqueSorted(completedLineIds).length,
  lineResults: (Array.isArray(lineResults) ? lineResults : []).map((row) => ({
    lineId: firstText(row?.lineId),
    priority: Number(row?.priority ?? 0) || null,
    runId: firstText(row?.runId),
    rawMatchedRows: Number(row?.rawMatchedRows ?? 0) || 0,
    dedupedRows: Number(row?.dedupedRows ?? 0) || 0,
  })),
  failureReason: firstText(failureReason),
})

export const summarizeLivePriorityLineResult = async (lineManifestRow) => {
  const packSummary = await readJson(lineManifestRow.packSummaryPath, null)
  const applySummary = await readJson(lineManifestRow.applySummaryPath, null)
  const dedupedRows = await readJsonl(lineManifestRow.dedupedInputPath)
  const pickedSymbols = dedupedRows
    .map((row) => ({
      symbol: normalizeText(row?.symbol),
      name: firstText(row?.name, row?.symbolName),
      primaryRuleId: firstText(row?.primaryRuleId),
    }))
    .filter((row) => row.symbol)
  return {
    lineId: String(lineManifestRow.lineId),
    priority: Number(lineManifestRow.priority),
    lineOrder: Number(lineManifestRow.lineOrder),
    lineRole: firstText(lineManifestRow.lineRole),
    status: firstText(lineManifestRow.status),
    promotionBasis: firstText(lineManifestRow.promotionBasis),
    reportLabel: firstText(lineManifestRow.reportLabel),
    runnerType: String(lineManifestRow.runnerType),
    runId: firstText(lineManifestRow.runId),
    catalogPath: String(lineManifestRow.catalogPath),
    sourceCatalogLabel: String(lineManifestRow.catalogLabel),
    selectionMode: String(lineManifestRow.selectionMode),
    discoveryUniverseId: firstText(lineManifestRow.discoveryUniverseId),
    lookbackTradingDays: Number(lineManifestRow.lookbackTradingDays ?? 0) || null,
    excludeRecommendationCloseRetPctGte: Number(lineManifestRow.excludeRecommendationCloseRetPctGte ?? 0) || null,
    packSummaryPath: String(lineManifestRow.packSummaryPath),
    applySummaryPath: String(lineManifestRow.applySummaryPath),
    dedupedInputPath: String(lineManifestRow.dedupedInputPath),
    rowsWritten: extractSummaryCount(packSummary, ["rowsWritten"]),
    uniqueSymbols: extractSummaryCount(packSummary, ["uniqueSymbols"]),
    rawMatchedRows: extractSummaryCount(applySummary, ["rawMatchedRows", "rawMatches"]),
    dedupedRows: dedupedRows.length,
    dedupedMatches: dedupedRows.length,
    pickedSymbols,
    packSummary,
    applySummary,
  }
}

export const mergeLivePriorityLineResults = async ({ manifest }) => {
  const rawLines = Array.isArray(manifest?.lines) ? manifest.lines : []
  const lineResults = []
  for (const rawLine of rawLines) {
    lineResults.push(await summarizeLivePriorityLineResult(rawLine))
  }
  const dedupedRowsByLineId = new Map()
  for (const lineResult of lineResults) {
    dedupedRowsByLineId.set(lineResult.lineId, await readJsonl(lineResult.dedupedInputPath))
  }
  return mergeLivePriorityNormalizedLineResults({
    lineResults,
    dedupedRowsByLineId,
  })
}

export const mergeLivePriorityNormalizedLineResults = ({
  lineResults = [],
  dedupedRowsByLineId = new Map(),
} = {}) => {
  const sortedLineResults = (Array.isArray(lineResults) ? lineResults : []).slice().sort(compareLinePrecedence)
  const merged = new Map()
  for (const lineResult of sortedLineResults) {
    const dedupedRows = Array.isArray(dedupedRowsByLineId?.get?.(lineResult.lineId))
      ? dedupedRowsByLineId.get(lineResult.lineId)
      : []
    for (const rawRow of dedupedRows) {
      const normalizedRow = normalizeLinePickRow(rawRow, {
        ...lineResult,
        catalogLabel: lineResult.sourceCatalogLabel ?? lineResult.catalogLabel,
      })
      if (!normalizedRow) continue
      const key = `${normalizedRow.recommendationDateKey}::${normalizedRow.symbol}`
      const previous = merged.get(key)
      if (!previous) {
        merged.set(key, {
          ...normalizedRow,
          matchedRuleIds: uniqueSorted(normalizedRow.matchedRuleIds),
          supportingLines: [],
          matchedSources: [normalizedRow.lineId],
          matchedSourceCount: 1,
        })
        continue
      }
      if (compareLinePrecedence(normalizedRow, previous) < 0) {
        const nextSupportingLines = [summarizeSupportingLine(previous), ...previous.supportingLines].sort(
          compareLinePrecedence,
        )
        merged.set(key, {
          ...normalizedRow,
          matchedRuleIds: uniqueSorted(normalizedRow.matchedRuleIds),
          supportingLines: nextSupportingLines,
          matchedSources: uniqueSorted([normalizedRow.lineId, ...previous.matchedSources]),
          matchedSourceCount: uniqueSorted([normalizedRow.lineId, ...previous.matchedSources]).length,
        })
        continue
      }
      previous.supportingLines = uniqueSorted([
        ...previous.supportingLines.map((line) => `${line.priority}::${line.lineOrder}::${line.lineId}`),
        `${normalizedRow.priority}::${normalizedRow.lineOrder}::${normalizedRow.lineId}`,
      ]).map((encoded) => {
        const directExisting = previous.supportingLines.find(
          (entry) => `${entry.priority}::${entry.lineOrder}::${entry.lineId}` === encoded,
        )
        if (directExisting) return directExisting
        return summarizeSupportingLine(normalizedRow)
      })
      previous.matchedSources = uniqueSorted([...previous.matchedSources, normalizedRow.lineId])
      previous.matchedSourceCount = previous.matchedSources.length
    }
  }

  const finalUnionRows = Array.from(merged.values())
    .map((row) => ({
      recommendationDateKey: row.recommendationDateKey,
      dateKey: row.dateKey,
      symbol: row.symbol,
      name: row.name,
      asOfDateKey: row.asOfDateKey,
      entryDateKey: row.entryDateKey,
      exitDateKey: row.exitDateKey,
      priority: Number(row.priority),
      lineId: String(row.lineId),
      lineOrder: Number(row.lineOrder),
      lineRole: firstText(row.lineRole),
      status: firstText(row.status),
      reportLabel: firstText(row.reportLabel),
      runnerType: String(row.runnerType),
      sourceCatalogLabel: String(row.sourceCatalogLabel),
      catalogPath: String(row.catalogPath),
      runId: firstText(row.runId),
      matchedRuleIds: uniqueSorted(row.matchedRuleIds),
      matchedRuleCount: uniqueSorted(row.matchedRuleIds).length,
      primaryRuleId: firstText(row.primaryRuleId),
      outcomeHitTarget: typeof row.outcomeHitTarget === "boolean" ? row.outcomeHitTarget : null,
      recommendationDateCloseRetPct:
        Number.isFinite(Number(row.recommendationDateCloseRetPct)) ? Number(row.recommendationDateCloseRetPct) : null,
      matchedSources: uniqueSorted(row.matchedSources),
      matchedSourceCount: Number(row.matchedSourceCount ?? 0) || 0,
      supportingLines: Array.isArray(row.supportingLines)
        ? row.supportingLines
            .slice()
            .sort(compareLinePrecedence)
            .map((entry) => ({
              priority: Number(entry.priority),
              lineId: String(entry.lineId),
              lineOrder: Number(entry.lineOrder),
              lineRole: firstText(entry.lineRole),
              status: firstText(entry.status),
              reportLabel: firstText(entry.reportLabel),
              sourceCatalogLabel: String(entry.sourceCatalogLabel),
              primaryRuleId: firstText(entry.primaryRuleId),
              matchedRuleIds: uniqueSorted(entry.matchedRuleIds),
              runId: firstText(entry.runId),
            }))
        : [],
    }))
    .sort(compareSymbolRows)

  const priorityCounts = {
    priority1: finalUnionRows.filter((row) => Number(row.priority) === 1).length,
    priority2: finalUnionRows.filter((row) => Number(row.priority) === 2).length,
    priority3: finalUnionRows.filter((row) => Number(row.priority) === 3).length,
  }
  return {
    lineResults: sortedLineResults,
    finalUnionRows,
    priorityCounts,
    finalUnionCount: finalUnionRows.length,
  }
}

export const renderLivePriorityReportMarkdown = ({
  summary,
  lineResults = [],
  finalUnionRows = [],
} = {}) => {
  const lines = [
    "# Live Priority Stack Report",
    "",
    `- status: ${summary?.status ?? "unknown"}`,
    `- runId: ${summary?.runId ?? "null"}`,
    `- targetDate: ${summary?.targetDate ?? "null"}`,
    `- candleLatestDate: ${summary?.candleLatestDate ?? "null"}`,
    `- universeLatestDate: ${summary?.universeLatestDate ?? "null"}`,
    `- lastSuccessfulTargetDate: ${summary?.lastSuccessfulTargetDate ?? "null"}`,
    `- registryPath: ${summary?.registryPath ?? "null"}`,
    `- registrySha256: ${summary?.registrySha256 ?? "null"}`,
    `- stackId: ${summary?.stackId ?? "null"}`,
    `- registryRole: ${summary?.registryRole ?? "null"}`,
    `- targetDateMode: ${summary?.targetDateMode ?? "null"}`,
    `- finalUnionPolicy: ${summary?.finalUnionPolicy ?? "null"}`,
    `- finalUnionCount: ${summary?.finalUnionCount ?? 0}`,
    `- priority1Count: ${summary?.priorityCounts?.priority1 ?? 0}`,
    `- priority2Count: ${summary?.priorityCounts?.priority2 ?? 0}`,
    `- priority3Count: ${summary?.priorityCounts?.priority3 ?? 0}`,
  ]
  if (summary?.failureReason) {
    lines.push(`- failureReason: ${summary.failureReason}`)
  }
  lines.push("", "## Lines", "")
  if (lineResults.length < 1) {
    lines.push("No line results.")
  } else {
    lines.push("| priority | lineId | rawMatchedRows | dedupedRows | rowsWritten | runId |")
    lines.push("| --- | --- | ---: | ---: | ---: | --- |")
    for (const lineResult of lineResults) {
      lines.push(
        `| ${lineResult.priority} | ${lineResult.lineId} | ${lineResult.rawMatchedRows} | ${lineResult.dedupedRows} | ${lineResult.rowsWritten} | ${lineResult.runId ?? ""} |`,
      )
    }
  }
  lines.push("", "## Final Union", "")
  if (finalUnionRows.length < 1) {
    lines.push("No symbols selected.")
  } else {
    lines.push("| priority | lineId | symbol | name | primaryRuleId | supportingLines |")
    lines.push("| --- | --- | --- | --- | --- | --- |")
    for (const row of finalUnionRows) {
      const supportingLines = (Array.isArray(row.supportingLines) ? row.supportingLines : [])
        .map((entry) => String(entry?.lineId ?? "").trim())
        .filter(Boolean)
        .join(", ")
      lines.push(
        `| ${row.priority} | ${row.lineId} | ${row.symbol} | ${row.name ?? ""} | ${row.primaryRuleId ?? ""} | ${supportingLines} |`,
      )
    }
  }
  lines.push("")
  return `${lines.join("\n")}\n`
}

export const writeLivePriorityArtifacts = async ({
  outDir,
  summary,
  finalUnionRows = [],
  lineResultsManifest = null,
  registrySnapshot = null,
} = {}) => {
  const resolvedOutDir = path.resolve(String(outDir ?? "").trim())
  if (!resolvedOutDir) {
    throw new Error("writeLivePriorityArtifacts requires outDir")
  }
  await ensureDir(resolvedOutDir)
  const finalUnionPath = path.join(resolvedOutDir, "final_union.jsonl")
  const finalSummaryPath = path.join(resolvedOutDir, "final_summary.json")
  const reportPath = path.join(resolvedOutDir, "report.md")
  await writeJsonl(finalUnionPath, finalUnionRows)
  await writeJson(finalSummaryPath, summary)
  await fs.writeFile(
    reportPath,
    renderLivePriorityReportMarkdown({
      summary,
      lineResults: Array.isArray(summary?.lineResults) ? summary.lineResults : [],
      finalUnionRows,
    }),
    "utf8",
  )
  if (lineResultsManifest) {
    await writeJson(path.join(resolvedOutDir, "line_results_manifest.json"), lineResultsManifest)
  }
  if (registrySnapshot) {
    await writeJson(path.join(resolvedOutDir, "registry_snapshot.json"), registrySnapshot)
  }
  return {
    finalUnionPath,
    finalSummaryPath,
    reportPath,
  }
}

export const writeLivePriorityState = async ({ statePath, summary }) => {
  const payload = buildLivePriorityStatePayload({ summary })
  await writeJsonAtomic(statePath, payload)
  return payload
}

export const writeLivePriorityActivityState = async ({ activityStatePath, payload }) => {
  await writeJsonAtomic(activityStatePath, payload)
  return payload
}

export const buildLivePrioritySummary = ({
  status,
  runId,
  targetDate = null,
  dataSnapshot = null,
  registry = null,
  lastSuccessfulTargetDate = null,
  lineResults = [],
  priorityCounts = null,
  finalUnionCount = 0,
  failureReason = null,
  lineFailure = null,
} = {}) => ({
  version: LIVE_PRIORITY_STATE_VERSION,
  generatedAt: new Date().toISOString(),
  status,
  runId: firstText(runId),
  targetDate: firstText(targetDate),
  candleLatestDate: firstText(dataSnapshot?.candleLatestDate),
  universeLatestDate: firstText(dataSnapshot?.universeLatestDate),
  latestCommonDate: firstText(dataSnapshot?.latestCommonDate),
  lastSuccessfulTargetDate: firstText(lastSuccessfulTargetDate),
  registryId: firstText(registry?.registryId),
  registryPath: firstText(registry?.registryPath),
  registrySha256: firstText(registry?.registrySha256),
  stackId: firstText(registry?.stackId),
  registryRole: firstText(registry?.registryRole),
  contractDocPath: firstText(registry?.contractDocPath),
  artifactsDocPath: firstText(registry?.artifactsDocPath),
  targetDateMode: firstText(registry?.targetDateMode),
  finalUnionPolicy: firstText(registry?.finalUnionPolicy),
  enabledLineCount: Array.isArray(registry?.enabledLines) ? registry.enabledLines.length : 0,
  lineResults,
  priorityCounts: priorityCounts ?? { priority1: 0, priority2: 0, priority3: 0 },
  finalUnionCount: Number(finalUnionCount ?? 0) || 0,
  failureReason: firstText(failureReason),
  lineFailure:
    lineFailure && typeof lineFailure === "object"
      ? {
          lineId: firstText(lineFailure?.lineId),
          priority: Number(lineFailure?.priority ?? 0) || null,
          runId: firstText(lineFailure?.runId),
        }
      : null,
})
