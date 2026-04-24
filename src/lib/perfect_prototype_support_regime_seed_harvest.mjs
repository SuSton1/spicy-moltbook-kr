const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const uniqueStrings = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const buildMonthKey = (dateKey) => {
  const text = toText(dateKey)
  return text && text.length >= 7 ? text.slice(0, 7) : null
}

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set(
    (rows ?? []).map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean),
  ).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => Number.isFinite(value) && value > 0),
  ).size,
})

const dedupeRows = (rows = []) => {
  const deduped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowKey = toText(row?.rowKey)
    if (!rowKey) continue
    if (!deduped.has(rowKey)) deduped.set(rowKey, row)
  }
  return Array.from(deduped.values())
}

export const buildPerfectPrototypeSupportRegimeSeedHarvest = ({
  family,
  excludedFitSymbols = ["076610"],
} = {}) => {
  const excludedSymbolSet = new Set(uniqueStrings(excludedFitSymbols))
  const keepInFit = (row) => !excludedSymbolSet.has(toText(row?.symbol) ?? "")

  const fitTrainRows = dedupeRows((family?.trainRows ?? []).filter(keepInFit))
  const fitGatedTrainRows = dedupeRows((family?.gatedTrainRows ?? []).filter(keepInFit))
  const fitBridgePositiveRows = dedupeRows((family?.bridgePositiveRows ?? []).filter(keepInFit))
  const fitSupportNearHardNegativeRows = dedupeRows((family?.supportNearHardNegativeRows ?? []).filter(keepInFit))
  const fitDateKeys = new Set(fitGatedTrainRows.map((row) => row?.dateKey).filter(Boolean))
  const fitTrainQuerySummaries = (family?.trainQuerySummaries ?? []).filter((entry) => fitDateKeys.has(entry?.dateKey))
  const fitPositiveSeedDateKeys = uniqueStrings(fitBridgePositiveRows.map((row) => row?.dateKey))
  const fitNegativeSeedDateKeys = uniqueStrings(fitSupportNearHardNegativeRows.map((row) => row?.dateKey))

  const supportSymbolExcluded = excludedSymbolSet.size > 0
  const ok = fitBridgePositiveRows.length > 0 && fitSupportNearHardNegativeRows.length > 0 && fitGatedTrainRows.length > 0

  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_regime_seed_harvest",
    supportSymbolExcluded,
    excludedFitSymbols: Array.from(excludedSymbolSet.values()),
    fitTrainRows,
    fitGatedTrainRows,
    fitBridgePositiveRows,
    fitSupportNearHardNegativeRows,
    fitTrainQuerySummaries,
    fitPositiveSeedDateKeys,
    fitNegativeSeedDateKeys,
    summary: {
      ...(family?.summary ?? {}),
      regimeSeedHarvestReady: ok,
      supportSymbolExcluded,
      excludedFitSymbolCount: excludedSymbolSet.size,
      fitTrainRowCount: fitTrainRows.length,
      fitGatedTrainRowCount: fitGatedTrainRows.length,
      fitExcludedRowCount: Math.max(0, Number((family?.gatedTrainRows ?? []).length) - fitGatedTrainRows.length),
      fitPositiveSeedSummary: summarizeRows(fitBridgePositiveRows),
      fitNegativeSeedSummary: summarizeRows(fitSupportNearHardNegativeRows),
    },
  }
}
