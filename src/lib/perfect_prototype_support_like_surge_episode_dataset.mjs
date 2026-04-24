import { groupRowsByDate, summarizeRows, uniqueStrings } from "./perfect_prototype_daily_symbolic_common.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const eventNetRet = (row) =>
  num(row?.eventOutcome?.netRet) ??
  num(row?.numericFeatureMap?.["sig.dailyWinner.eventNetRet"]) ??
  (row?.outcomeHitTarget === true ? 0.01 : -0.01)

const dedupeRowsByKey = (rows = []) =>
  Array.from(
    new Map(
      (Array.isArray(rows) ? rows : [])
        .map((row) => [String(row?.rowKey ?? row?.sourceId ?? "").trim(), row])
        .filter(([rowKey]) => rowKey),
    ).values(),
  )

export const buildPerfectPrototypeSupportLikeSurgeEpisodeDataset = ({
  family,
  maxPositiveRowsPerDate = 2,
  maxSameDateNegativesPerDate = 2,
} = {}) => {
  const admittedTradeDateSet = new Set((family?.admittedTradeDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const byDate = groupRowsByDate(family?.gatedTrainRows ?? [])
  const detectorPositiveRows = []
  const detectorSameDateNegativePool = []

  for (const dateKey of Array.from(admittedTradeDateSet.values()).sort((left, right) => left.localeCompare(right))) {
    const rows = byDate.get(dateKey) ?? []
    const positiveRows = rows
      .filter((row) => row?.outcomeHitTarget === true)
      .slice()
      .sort(
        (left, right) =>
          eventNetRet(right) - eventNetRet(left) ||
          String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
      )
      .slice(0, Math.max(1, Math.floor(Number(maxPositiveRowsPerDate) || 2)))
    const negativeRows = rows
      .filter((row) => row?.outcomeHitTarget !== true)
      .slice()
      .sort(
        (left, right) =>
          eventNetRet(right) - eventNetRet(left) ||
          String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
      )
      .slice(0, Math.max(1, Math.floor(Number(maxSameDateNegativesPerDate) || 2)))
    detectorPositiveRows.push(...positiveRows)
    detectorSameDateNegativePool.push(...negativeRows)
  }

  const admittedPositiveDateSet = new Set(detectorPositiveRows.map((row) => row?.dateKey).filter(Boolean))
  const hardNegativePool = dedupeRowsByKey(
    (family?.supportNearHardNegativeRows ?? []).filter(
      (row) => !admittedPositiveDateSet.has(String(row?.dateKey ?? "").trim()),
    ),
  )
  const detectorOosRows = dedupeRowsByKey(family?.oosRows ?? [])
  const ok = detectorPositiveRows.length > 0 && admittedPositiveDateSet.size > 0

  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_support_like_positive_rows",
    detectorPositiveRows: dedupeRowsByKey(detectorPositiveRows),
    detectorSameDateNegativePool: dedupeRowsByKey(detectorSameDateNegativePool),
    detectorHardNegativePool: hardNegativePool,
    detectorOosRows,
    summary: {
      ...(family?.summary ?? {}),
      supportLikeEpisodeDatasetReady: ok,
      detectorPositiveSummary: summarizeRows(detectorPositiveRows),
      detectorSameDateNegativePoolSummary: summarizeRows(detectorSameDateNegativePool),
      detectorHardNegativePoolSummary: summarizeRows(hardNegativePool),
      detectorOosSummary: summarizeRows(detectorOosRows),
      detectorPositiveDateCount: admittedPositiveDateSet.size,
      detectorAdmittedTradeDateCount: admittedTradeDateSet.size,
      detectorPositivePreview: detectorPositiveRows.slice(0, 6).map((row) => ({
        rowKey: row?.rowKey ?? null,
        dateKey: row?.dateKey ?? null,
        symbol: row?.symbol ?? null,
        netRet: eventNetRet(row),
      })),
      detectorNegativePreview: uniqueStrings(
        [...detectorSameDateNegativePool, ...hardNegativePool].slice(0, 6).map((row) => row?.rowKey).filter(Boolean),
      ),
    },
  }
}
