import { readJsonl } from "./io.mjs"
import { loadPerfectPrototypeCatalog } from "./perfect_prototype_catalog.mjs"
import { replayPerfectPrototypeOverlayCatalog } from "./perfect_prototype_overlay_catalog_replay.mjs"
import { mergeLivePriorityNormalizedLineResults } from "./live_priority_ops.mjs"

const SECONDARY_100PCT_DAYDEDUP_CATALOG_LABEL = "second_priority_hitge4_100pct_daydedup_live0323_v1"
const PRIMARY_DUAL80_RECENT80_CATALOG_LABEL = "dual80_recent80_live0323_v1"
const SECONDARY_CONTRACT_SELECTION_MODE = "top1_per_day_union"

const uniqueSortedStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const safePrecision = (summary) => {
  const precision = Number(summary?.precision ?? Number.NaN)
  return Number.isFinite(precision) ? precision : 0
}

const summarizeRows = (rows = []) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const hits = safeRows.filter((row) => row?.outcomeHitTarget === true)
  return {
    selectedRows: safeRows.length,
    hitRows: hits.length,
    negativeRows: safeRows.length - hits.length,
    precision: safeRows.length > 0 ? hits.length / safeRows.length : 0,
    selectedDates: new Set(safeRows.map((row) => row?.dateKey).filter(Boolean)).size,
    selectedSymbols: new Set(safeRows.map((row) => row?.symbol).filter(Boolean)).size,
  }
}

const buildContractType = (line) => {
  const catalogLabel = String(line?.catalogLabel ?? "").trim()
  if (catalogLabel === SECONDARY_100PCT_DAYDEDUP_CATALOG_LABEL) {
    return "secondary_hitge4_100pct_daydedup"
  }
  if (catalogLabel === PRIMARY_DUAL80_RECENT80_CATALOG_LABEL) {
    return "primary_dual80_recent80"
  }
  return "unmodeled_contract"
}

const buildSecondaryContractVerdict = ({ line, oosReplay, contractOosReplay }) => {
  const summary = contractOosReplay?.dedupedSummary ?? oosReplay?.dedupedSummary ?? null
  const rawSummary = oosReplay?.dedupedSummary ?? null
  const selectedRows = Number(summary?.selectedRowCount ?? 0)
  const hitRows = Number(summary?.hitRowCount ?? 0)
  const hitDateCount = Number(summary?.hitDateCount ?? 0)
  const precision = safePrecision(summary)
  const rejectReasons = []
  if (selectedRows < 4) rejectReasons.push("selected_rows_below_4")
  if (hitRows < 4) rejectReasons.push("hit_rows_below_4")
  if (hitDateCount < 4) rejectReasons.push("hit_dates_below_4")
  if (precision !== 1) rejectReasons.push("precision_below_1")
  return {
    contractType: "secondary_hitge4_100pct_daydedup",
    evaluationWindow: "oos_close28_day_dedup_top1",
    evaluationSelectionMode: SECONDARY_CONTRACT_SELECTION_MODE,
    requiredSelectedRows: 4,
    requiredHitRows: 4,
    requiredHitDateCount: 4,
    requiredPrecision: 1,
    actualSelectedRows: selectedRows,
    actualHitRows: hitRows,
    actualHitDateCount: hitDateCount,
    actualPrecision: precision,
    rawLineSelectionMode: String(line?.selectionMode ?? "union_all").trim() || "union_all",
    rawLineSelectedRows: Number(rawSummary?.selectedRowCount ?? 0),
    rawLineHitRows: Number(rawSummary?.hitRowCount ?? 0),
    rawLineHitDateCount: Number(rawSummary?.hitDateCount ?? 0),
    rawLinePrecision: safePrecision(rawSummary),
    satisfied: rejectReasons.length < 1,
    rejectReasons,
  }
}

const buildPrimaryContractVerdict = ({ line, oosReplay, recentReplay }) => {
  const oosPrecision = safePrecision(oosReplay?.dedupedSummary)
  const recentPrecision = safePrecision(recentReplay?.dedupedSummary)
  const rejectReasons = []
  if (!recentReplay) rejectReasons.push("missing_recent_window_replay")
  if (oosPrecision < 0.8) rejectReasons.push("oos_precision_below_0.8")
  if (recentReplay && recentPrecision < 0.8) rejectReasons.push("recent_precision_below_0.8")
  return {
    contractType: "primary_dual80_recent80",
    evaluationWindows: {
      oos: "oos_close28_day_dedup",
      recent: "recent_close28_day_dedup",
    },
    evaluationSelectionMode: String(line?.selectionMode ?? "union_all").trim() || "union_all",
    requiredOosPrecision: 0.8,
    requiredRecentPrecision: 0.8,
    actualOosPrecision: oosPrecision,
    actualRecentPrecision: recentReplay ? recentPrecision : null,
    satisfied: rejectReasons.length < 1,
    rejectReasons,
  }
}

const buildContractVerdict = ({ line, oosReplay, recentReplay, contractOosReplay }) => {
  const contractType = buildContractType(line)
  if (contractType === "secondary_hitge4_100pct_daydedup") {
    return buildSecondaryContractVerdict({ line, oosReplay, contractOosReplay })
  }
  if (contractType === "primary_dual80_recent80") {
    return buildPrimaryContractVerdict({ line, oosReplay, recentReplay })
  }
  return {
    contractType,
    satisfied: null,
    rejectReasons: ["unmodeled_contract"],
  }
}

const buildOwnershipSummary = ({ finalUnionRows, lineReports }) => {
  const rows = Array.isArray(finalUnionRows) ? finalUnionRows : []
  return (Array.isArray(lineReports) ? lineReports : []).map((lineReport) => {
    const ownedRows = rows.filter((row) => String(row?.lineId ?? "").trim() === String(lineReport?.lineId ?? "").trim())
    return {
      lineId: String(lineReport?.lineId ?? ""),
      priority: Number(lineReport?.priority ?? 0) || 0,
      lineOrder: Number(lineReport?.lineOrder ?? 0) || 0,
      reportLabel: String(lineReport?.reportLabel ?? "").trim() || null,
      contractType: lineReport?.contractVerdict?.contractType ?? null,
      owned: summarizeRows(ownedRows),
      supportingOverlapRows: rows.filter((row) =>
        Array.isArray(row?.supportingLines)
          ? row.supportingLines.some((entry) => String(entry?.lineId ?? "").trim() === String(lineReport?.lineId ?? "").trim())
          : false,
      ).length,
    }
  })
}

const buildLineReplayDescriptor = ({ line, scope }) => ({
  lineId: String(line?.lineId ?? ""),
  priority: Number(line?.priority ?? 0) || 0,
  lineOrder: Number(line?.lineOrder ?? 0) || 0,
  lineRole: String(line?.lineRole ?? "").trim() || null,
  status: String(line?.status ?? "").trim() || null,
  reportLabel: String(line?.reportLabel ?? "").trim() || null,
  runnerType: String(line?.runnerType ?? "").trim(),
  sourceCatalogLabel: String(line?.catalogLabel ?? "").trim() || null,
  catalogPath: String(line?.catalogPath ?? "").trim(),
  runId: null,
  selectionMode: String(line?.selectionMode ?? "union_all").trim() || "union_all",
  discoveryUniverseId: String(scope?.discoveryUniverseId ?? "").trim() || null,
  lookbackTradingDays: Number(scope?.lookbackTradingDays ?? 0) || null,
  excludeRecommendationCloseRetPctGte: Number(line?.excludeRecommendationCloseRetPctGte ?? 0) || null,
})

const resolveContractReplaySelectionMode = (line) => {
  const contractType = buildContractType(line)
  if (contractType === "secondary_hitge4_100pct_daydedup") {
    return SECONDARY_CONTRACT_SELECTION_MODE
  }
  return String(line?.selectionMode ?? "union_all").trim() || "union_all"
}

export const replayLivePrioritySelectionContracts = async ({
  scopeManifest,
  candlePath,
} = {}) => {
  if (!scopeManifest || typeof scopeManifest !== "object") {
    throw new Error("replayLivePrioritySelectionContracts requires scopeManifest")
  }
  const scopes = Array.isArray(scopeManifest?.scopes) ? scopeManifest.scopes : []
  const lines = Array.isArray(scopeManifest?.lines) ? scopeManifest.lines : []
  if (scopes.length < 1) {
    throw new Error("selection-contract replay scope manifest has no scopes")
  }
  if (lines.length < 1) {
    throw new Error("selection-contract replay scope manifest has no lines")
  }

  const scopeRows = new Map()
  for (const scope of scopes) {
    const scopeId = String(scope?.scopeId ?? "").trim()
    if (!scopeId) throw new Error("selection-contract replay scope is missing scopeId")
    scopeRows.set(scopeId, {
      scope,
      trainRows: await readJsonl(scope.trainInput),
      oosRows: await readJsonl(scope.oosInput),
      recentRows: scope?.recentInput ? await readJsonl(scope.recentInput) : [],
    })
  }

  const lineReports = []
  const oosDedupedRowsByLineId = new Map()
  for (const line of lines) {
    const scopeId = String(line?.scopeId ?? "").trim()
    const scopeEntry = scopeRows.get(scopeId)
    if (!scopeEntry) {
      throw new Error(`selection-contract replay scope not found for lineId=${line?.lineId ?? "unknown"} scopeId=${scopeId}`)
    }
    const catalog = await loadPerfectPrototypeCatalog(String(line?.catalogPath ?? "").trim(), {
      expectedCatalogSha256: line?.expectedCatalogSha256 ?? null,
      expectedRuleIdsSha256: line?.expectedRuleIdsSha256 ?? null,
    })
    const replayArgs = {
      catalog,
      selectionMode: String(line?.selectionMode ?? "union_all").trim() || "union_all",
      closeRetFilterGte: Number(line?.excludeRecommendationCloseRetPctGte ?? 0) || null,
      candlePath,
    }
    const trainReplay = await replayPerfectPrototypeOverlayCatalog({
      rows: scopeEntry.trainRows,
      ...replayArgs,
    })
    const oosReplay = await replayPerfectPrototypeOverlayCatalog({
      rows: scopeEntry.oosRows,
      ...replayArgs,
    })
    const recentReplay =
      Array.isArray(scopeEntry.recentRows) && scopeEntry.recentRows.length > 0
        ? await replayPerfectPrototypeOverlayCatalog({
            rows: scopeEntry.recentRows,
            ...replayArgs,
          })
        : null
    const contractReplaySelectionMode = resolveContractReplaySelectionMode(line)
    const contractOosReplay =
      contractReplaySelectionMode === replayArgs.selectionMode
        ? oosReplay
        : await replayPerfectPrototypeOverlayCatalog({
            rows: scopeEntry.oosRows,
            ...replayArgs,
            selectionMode: contractReplaySelectionMode,
          })
    const contractVerdict = buildContractVerdict({
      line,
      oosReplay,
      recentReplay,
      contractOosReplay,
    })
    const report = {
      lineId: String(line?.lineId ?? ""),
      priority: Number(line?.priority ?? 0) || 0,
      lineOrder: Number(line?.lineOrder ?? 0) || 0,
      lineRole: String(line?.lineRole ?? "").trim() || null,
      status: String(line?.status ?? "").trim() || null,
      reportLabel: String(line?.reportLabel ?? "").trim() || null,
      runnerType: String(line?.runnerType ?? "").trim(),
      catalogLabel: String(line?.catalogLabel ?? "").trim() || null,
      catalogPath: String(line?.catalogPath ?? "").trim(),
      scopeId,
      discoveryUniverseId: String(scopeEntry.scope?.discoveryUniverseId ?? "").trim() || null,
      lookbackTradingDays: Number(scopeEntry.scope?.lookbackTradingDays ?? 0) || null,
      selectionMode: String(line?.selectionMode ?? "union_all").trim() || "union_all",
      excludeRecommendationCloseRetPctGte: Number(line?.excludeRecommendationCloseRetPctGte ?? 0) || null,
      contractReplaySelectionMode,
      contractVerdict,
      trainReplay,
      oosReplay,
      contractOosReplay,
      recentReplay,
    }
    lineReports.push(report)
    oosDedupedRowsByLineId.set(report.lineId, oosReplay?.dedupedMatches ?? [])
  }

  const ownershipAware = mergeLivePriorityNormalizedLineResults({
    lineResults: lineReports.map((report) =>
      buildLineReplayDescriptor({
        line: report,
        scope: {
          discoveryUniverseId: report.discoveryUniverseId,
          lookbackTradingDays: report.lookbackTradingDays,
        },
      }),
    ),
    dedupedRowsByLineId: oosDedupedRowsByLineId,
  })

  return {
    lineReports,
    ownershipAware: {
      ...ownershipAware,
      lineOwnership: buildOwnershipSummary({
        finalUnionRows: ownershipAware.finalUnionRows,
        lineReports,
      }),
    },
    rollup: {
      lineCount: lineReports.length,
      replayedLineIds: uniqueSortedStrings(lineReports.map((report) => report.lineId)),
      satisfiedContracts: lineReports.filter((report) => report?.contractVerdict?.satisfied === true).map((report) => report.lineId),
      failedContracts: lineReports.filter((report) => report?.contractVerdict?.satisfied === false).map((report) => report.lineId),
      unmodeledContracts: lineReports
        .filter((report) => report?.contractVerdict?.contractType === "unmodeled_contract")
        .map((report) => report.lineId),
      ownershipFinalUnionCount: Number(ownershipAware?.finalUnionCount ?? 0) || 0,
    },
  }
}
