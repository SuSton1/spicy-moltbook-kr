const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => Number(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

export const computePerfectPrototypeSupportWitnessScore = (row) =>
  num(row?.numericFeatureMap?.["sig.ordinalMotif.supportRecoveryPotential"]) +
  num(row?.numericFeatureMap?.["sig.ordinalMotif.motifAgreement"]) +
  num(row?.numericFeatureMap?.["sig.recurBoundary.localRecoveryMargin"]) +
  num(row?.numericFeatureMap?.["sig.recurBoundary.localBreadthPurityGap"]) +
  num(row?.numericFeatureMap?.["sig.motifLattice.bagCoverMargin"]) * 0.35 +
  num(row?.numericFeatureMap?.["sig.motifLattice.complementarityPotential"]) * 0.5 -
  num(row?.numericFeatureMap?.["sig.ordinalMotif.recurrenceLeakPressure"]) -
  num(row?.numericFeatureMap?.["sig.ordinalMotif.negativeMotifConflict"]) -
  num(row?.numericFeatureMap?.["sig.recurBoundary.crossfitLeakShare"])

export const buildPerfectPrototypeSupportBagWitnessSelector = ({
  family,
  maxWitnessPerBag = 2,
} = {}) => {
  const witnessSelections = []
  for (const bag of Array.isArray(family?.positiveBags) ? family.positiveBags : []) {
    const scoredRows = (bag?.rows ?? [])
      .map((row) => ({
        row,
        bagId: bag?.bagId,
        dateKey: bag?.dateKey,
        motifBundleId: row?.motifBundleId ?? null,
        witnessScore: computePerfectPrototypeSupportWitnessScore(row),
      }))
      .filter((entry) => Number.isFinite(entry.witnessScore))
      .sort((left, right) => right.witnessScore - left.witnessScore || String(left?.row?.rowKey ?? "").localeCompare(String(right?.row?.rowKey ?? "")))
    const usedBundles = new Set()
    for (const entry of scoredRows) {
      if (usedBundles.has(entry.motifBundleId)) continue
      usedBundles.add(entry.motifBundleId)
      witnessSelections.push(entry)
      if (usedBundles.size >= Math.max(1, Math.floor(Number(maxWitnessPerBag) || 2))) break
    }
    if (usedBundles.size < 1 && scoredRows[0]) {
      witnessSelections.push(scoredRows[0])
    }
  }

  const witnessRows = witnessSelections.map((entry) => entry.row)
  return {
    ...family,
    ok: witnessSelections.length > 0,
    reason: witnessSelections.length > 0 ? null : "unsat_no_bag_witness_rows",
    bagWitnessSelections: witnessSelections,
    bagWitnessRows: witnessRows,
    summary: {
      ...(family?.summary ?? {}),
      witnessReady: witnessSelections.length > 0,
      witnessCandidateCount: Array.isArray(family?.positiveBags) ? family.positiveBags.reduce((sum, bag) => sum + (bag?.rows?.length ?? 0), 0) : 0,
      witnessAcceptedCount: witnessSelections.length,
      witnessAcceptedBagCount: new Set(witnessSelections.map((entry) => entry?.bagId).filter(Boolean)).size,
      witnessAverageScore: average(witnessSelections.map((entry) => entry?.witnessScore)),
    },
  }
}
