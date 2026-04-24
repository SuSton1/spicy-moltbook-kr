const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const summarizeRows = (rows) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey).filter(Boolean)).size,
  matchedFoldCount: new Set(
    (rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0),
  ).size,
})

const groupIdsOfRow = (row) =>
  uniqueStrings([
    row?.corridorDominantBasin,
    ...(Array.isArray(row?.corridorReachableBasinIds) ? row.corridorReachableBasinIds : []),
    row?.carrierDominantComponent,
    ...(Array.isArray(row?.carrierReachableComponentIds) ? row.carrierReachableComponentIds : []),
    row?.recurBoundaryDominantGroup,
    row?.dominantGroup,
  ])

const rowMatchesGroup = (row, groupId) => {
  const normalizedGroupId = String(groupId ?? "").trim()
  if (!normalizedGroupId) return false
  return groupIdsOfRow(row).includes(normalizedGroupId)
}

const simplexLocalPositiveAccepted = ({ row, groupId } = {}) => {
  const affinity = Number(row?.numericFeatureMap?.[`sig.simplex.basin.${groupId}.affinity`] ?? Number.NaN)
  const exclusiveAffinity = Number(
    row?.numericFeatureMap?.[`sig.simplex.basin.${groupId}.exclusiveAffinity`] ?? Number.NaN,
  )
  const borderMargin = Number(row?.numericFeatureMap?.[`sig.simplex.basin.${groupId}.borderMargin`] ?? Number.NaN)
  const positiveBorderMargin = Number(
    row?.numericFeatureMap?.["sig.simplex.global.positiveBorderMargin"] ?? Number.NaN,
  )
  if (
    Number.isFinite(affinity) ||
    Number.isFinite(exclusiveAffinity) ||
    Number.isFinite(borderMargin) ||
    Number.isFinite(positiveBorderMargin)
  ) {
    const dominant = String(row?.simplexDominantBasin ?? row?.corridorDominantBasin ?? "").trim()
    return (
      dominant === String(groupId ?? "").trim() ||
      (Number.isFinite(affinity) && affinity >= -0.08 && Number.isFinite(exclusiveAffinity) && exclusiveAffinity >= -0.12) ||
      (Number.isFinite(borderMargin) && borderMargin >= -0.08 && Number.isFinite(exclusiveAffinity) && exclusiveAffinity >= -0.15) ||
      (Number.isFinite(positiveBorderMargin) && positiveBorderMargin >= 0 && Number.isFinite(exclusiveAffinity) && exclusiveAffinity >= -0.08)
    )
  }
  return null
}

export const buildPerfectPrototypeSupportBoundaryGroupDataset = ({
  family,
  minLocalDates = 3,
  minLocalMonths = 3,
  minLocalFolds = 2,
  minNegativeRows = 3,
} = {}) => {
  const groupIds = uniqueStrings(
    family?.corridorPositiveEligibleBasinIds ??
      family?.corridorPositiveBasinIds ??
    family?.carrierEligibleComponentIds ??
      family?.carrierComponentIds ??
      family?.recurrencePurityGroupIds ??
      family?.boundaryResidualGroupStats?.map((entry) => entry?.group),
  )
  const datasets = []
  for (const groupId of groupIds) {
    const localPositiveCore = (family?.carrierPositiveRows ?? family?.bridgePositiveRows ?? []).filter((row) => {
      if (!rowMatchesGroup(row, groupId)) return false
      const simplexAccepted = simplexLocalPositiveAccepted({ row, groupId })
      if (simplexAccepted !== null) return simplexAccepted
      const corridorProjection = Number(
        row?.numericFeatureMap?.[`sig.corridorBasin.basin.${groupId}.projectionMargin`] ?? Number.NaN,
      )
      const corridorGap = Number(row?.numericFeatureMap?.["sig.corridorBasin.localRecoveryMargin"] ?? Number.NaN)
      if (Number.isFinite(corridorProjection) || Number.isFinite(corridorGap)) {
        return Number.isFinite(corridorProjection) ? corridorProjection > -0.15 : corridorGap >= 0
      }
      const carrierScore = Number(row?.numericFeatureMap?.["sig.carrierGraph.recurrenceCarrierScore"] ?? Number.NaN)
      const carrierGap = Number(row?.numericFeatureMap?.["sig.carrierGraph.componentBoundaryGap"] ?? Number.NaN)
      const legacyGap = Number(row?.numericFeatureMap?.["sig.recurBoundary.localBreadthPurityGap"] ?? Number.NaN)
      if (Number.isFinite(carrierScore) || Number.isFinite(carrierGap)) {
        return Number.isFinite(carrierGap) ? carrierGap > -0.25 : carrierScore > 0
      }
      return legacyGap > 0
    })
    const supportNearHardNegativeRows = (family?.supportNearHardNegativeRows ?? []).filter(
      (row) =>
        row?.corridorBorderBasin === groupId ||
        row?.carrierBorderComponent === groupId ||
        rowMatchesGroup(row, groupId),
    )
    const localNegativeShell = supportNearHardNegativeRows.length >= minNegativeRows
      ? supportNearHardNegativeRows
      : (family?.hardNegativeRows ?? []).filter((row) => rowMatchesGroup(row, groupId))
    const gatedRows = (family?.gatedTrainRows ?? []).filter((row) => rowMatchesGroup(row, groupId))
    const supportCaseViews = (family?.supportCaseViews ?? []).filter((row) => rowMatchesGroup(row, groupId))
    const positiveSummary = summarizeRows(localPositiveCore)
    const negativeSummary = summarizeRows(localNegativeShell)
    const gatedSummary = summarizeRows(gatedRows.filter((row) => row?.outcomeHitTarget === true))
    const eligible =
      positiveSummary.matchedDateCount >= minLocalDates &&
      positiveSummary.matchedMonthCount >= minLocalMonths &&
      positiveSummary.matchedFoldCount >= minLocalFolds &&
      negativeSummary.rowCount >= minNegativeRows
    datasets.push({
      groupId,
      localPositiveCore,
      localNegativeShell,
      gatedRows,
      supportCaseViews,
      positiveSummary,
      negativeSummary,
      gatedSummary,
      eligible,
    })
  }

  return {
    ok: datasets.some((entry) => entry.eligible === true),
    datasets,
    summary: {
      boundaryGroupCount: datasets.length,
      boundaryGroupEligibleCount: datasets.filter((entry) => entry.eligible === true).length,
      boundaryGroupDatasetRowCount: datasets.reduce(
        (sum, entry) => sum + Number(entry.localPositiveCore.length ?? 0) + Number(entry.localNegativeShell.length ?? 0),
        0,
      ),
      supportCaseEligibleGroups: datasets.filter((entry) => (entry.supportCaseViews ?? []).length > 0).map((entry) => entry.groupId),
    },
  }
}
