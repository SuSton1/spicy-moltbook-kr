const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const bucket = (value, cuts = [], labels = []) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return labels[0] ?? "NONE"
  for (let index = 0; index < cuts.length; index += 1) {
    if (numeric < cuts[index]) return labels[index] ?? `B${index}`
  }
  return labels[cuts.length] ?? `B${cuts.length}`
}

const buildBundleId = (row) => {
  const dominantGroup = String(row?.ordinalMotifDominantGroup ?? row?.recurBoundaryDominantGroup ?? "NONE").trim() || "NONE"
  const signature = String(row?.ordinalMotifSignature ?? "NONE").trim() || "NONE"
  const recoveryBand = bucket(num(row?.numericFeatureMap?.["sig.ordinalMotif.supportRecoveryPotential"]), [0, 0.75, 1.5], [
    "NEG",
    "WEAK",
    "MID",
    "STRONG",
  ])
  const purityBand = bucket(num(row?.numericFeatureMap?.["sig.recurBoundary.localBreadthPurityGap"]), [0, 1, 2], [
    "NEG",
    "MID",
    "HIGH",
    "ELITE",
  ])
  const leakBand = bucket(num(row?.numericFeatureMap?.["sig.recurBoundary.crossfitLeakShare"]), [0.1, 0.25, 0.5], [
    "LOW",
    "MID",
    "HIGH",
    "EXTREME",
  ])
  const agreementBand = bucket(num(row?.numericFeatureMap?.["sig.ordinalMotif.motifAgreement"]), [0.35, 0.65, 0.85], [
    "LOW",
    "MID",
    "HIGH",
    "ELITE",
  ])
  return `${dominantGroup}|${signature}|R:${recoveryBand}|P:${purityBand}|L:${leakBand}|A:${agreementBand}`
}

const collectRows = (bags = []) => (Array.isArray(bags) ? bags : []).flatMap((bag) => bag?.rows ?? [])

const rebuildBags = (bags = [], rowLookup = new Map()) =>
  (Array.isArray(bags) ? bags : []).map((bag) => ({
    ...bag,
    rows: (bag?.rows ?? []).map((row) => rowLookup.get(row?.rowKey) ?? row),
  }))

const collectFeatureKeys = (rows = []) =>
  uniqueStrings(
    (Array.isArray(rows) ? rows : []).flatMap((row) =>
      Object.keys(row?.numericFeatureMap ?? {}).filter((featureKey) => featureKey.startsWith("sig.motifLattice.")),
    ),
  )

export const buildPerfectPrototypeSupportContrastiveMotifLatticeFeatures = ({
  family,
} = {}) => {
  const annotateRows = (rows) =>
    (Array.isArray(rows) ? rows : []).map((row) => ({
      ...row,
      motifBundleId: buildBundleId(row),
    }))

  const trainRows = annotateRows(family?.trainRows)
  const gatedTrainRows = annotateRows(family?.gatedTrainRows)
  const oosRows = annotateRows(family?.oosRows)
  const supportCaseViews = annotateRows(family?.supportCaseViews)
  const gatedLookup = new Map(gatedTrainRows.map((row) => [row?.rowKey, row]))
  const trainLookup = new Map(trainRows.map((row) => [row?.rowKey, row]))
  const supportLookup = new Map(supportCaseViews.map((row) => [row?.rowKey, row]))

  const positiveBags = rebuildBags(family?.positiveBags, gatedLookup)
  const negativeBags = rebuildBags(family?.negativeBags, gatedLookup)
  const unlabeledBags = rebuildBags(family?.unlabeledBags, gatedLookup)
  const supportBags = rebuildBags(family?.supportBags, supportLookup)

  const bundleStats = new Map()
  const registerBag = (bag, label) => {
    const bundleIds = uniqueStrings((bag?.rows ?? []).map((row) => row?.motifBundleId))
    for (const bundleId of bundleIds) {
      const entry = bundleStats.get(bundleId) ?? {
        bundleId,
        positiveBagIds: new Set(),
        negativeBagIds: new Set(),
      }
      if (label === "positive") entry.positiveBagIds.add(bag?.bagId)
      if (label === "negative") entry.negativeBagIds.add(bag?.bagId)
      bundleStats.set(bundleId, entry)
    }
  }
  for (const bag of positiveBags) registerBag(bag, "positive")
  for (const bag of negativeBags) registerBag(bag, "negative")

  const motifBundleStats = Array.from(bundleStats.values())
    .map((entry) => {
      const positiveBagIds = Array.from(entry.positiveBagIds).sort((left, right) => left.localeCompare(right))
      const negativeBagIds = Array.from(entry.negativeBagIds).sort((left, right) => left.localeCompare(right))
      const total = positiveBagIds.length + negativeBagIds.length
      const purity = total > 0 ? positiveBagIds.length / total : 0
      return {
        bundleId: entry.bundleId,
        positiveBagIds,
        negativeBagIds,
        positiveBagCount: positiveBagIds.length,
        negativeBagCount: negativeBagIds.length,
        purity,
        breadthCarry: positiveBagIds.length * purity,
        negativeConflict: negativeBagIds.length / Math.max(1, total),
        bagCoverSignature: positiveBagIds.join("|"),
      }
    })
    .sort((left, right) => {
      if (right.breadthCarry !== left.breadthCarry) return right.breadthCarry - left.breadthCarry
      return left.bundleId.localeCompare(right.bundleId)
    })

  const motifBundleLookup = Object.fromEntries(motifBundleStats.map((entry) => [entry.bundleId, entry]))
  const augmentRows = (rows) =>
    (Array.isArray(rows) ? rows : []).map((row) => {
      const bundleId = row?.motifBundleId ?? buildBundleId(row)
      const bundle = motifBundleLookup[bundleId] ?? {
        positiveBagCount: 0,
        negativeBagCount: 0,
        purity: 0,
        breadthCarry: 0,
        negativeConflict: 1,
      }
      const bagCoverMargin = Number(bundle.positiveBagCount ?? 0) - Number(bundle.negativeBagCount ?? 0)
      const complementarityPotential = Number(bundle.breadthCarry ?? 0) - Number(bundle.negativeConflict ?? 0)
      const numericFeatureMap = {
        ...(row?.numericFeatureMap ?? {}),
        "sig.motifLattice.positiveBagCount": Number(bundle.positiveBagCount ?? 0),
        "sig.motifLattice.negativeBagCount": Number(bundle.negativeBagCount ?? 0),
        "sig.motifLattice.purity": Number(bundle.purity ?? 0),
        "sig.motifLattice.breadthCarry": Number(bundle.breadthCarry ?? 0),
        "sig.motifLattice.negativeConflict": Number(bundle.negativeConflict ?? 0),
        "sig.motifLattice.bagCoverMargin": bagCoverMargin,
        "sig.motifLattice.complementarityPotential": complementarityPotential,
      }
      const categoricalTokens = uniqueStrings([
        ...(row?.categoricalTokens ?? []),
        `sig:motifLattice.bundle:${bundleId}`,
        `sig:motifLattice.purity:${Number(bundle.purity ?? 0) >= 0.8 ? "HIGH" : Number(bundle.purity ?? 0) >= 0.5 ? "MID" : "LOW"}`,
      ])
      return {
        ...row,
        motifBundleId: bundleId,
        numericFeatureMap,
        categoricalTokens,
        tokenSet: new Set(categoricalTokens),
      }
    })

  const augmentedTrainRows = augmentRows(trainRows)
  const augmentedGatedTrainRows = augmentRows(gatedTrainRows)
  const augmentedOosRows = augmentRows(oosRows)
  const augmentedSupportCaseViews = augmentRows(supportCaseViews)
  const augmentedLookup = new Map(augmentedGatedTrainRows.map((row) => [row?.rowKey, row]))
  const augmentedTrainLookup = new Map(augmentedTrainRows.map((row) => [row?.rowKey, row]))
  const augmentedSupportLookup = new Map(augmentedSupportCaseViews.map((row) => [row?.rowKey, row]))

  const rebuiltPositiveBags = rebuildBags(positiveBags, augmentedLookup)
  const rebuiltNegativeBags = rebuildBags(negativeBags, augmentedLookup)
  const rebuiltUnlabeledBags = rebuildBags(unlabeledBags, augmentedLookup)
  const rebuiltSupportBags = rebuildBags(supportBags, augmentedSupportLookup)
  const bridgePositiveRows = (Array.isArray(family?.bridgePositiveRows) ? family.bridgePositiveRows : []).map(
    (row) => augmentedLookup.get(row?.rowKey) ?? augmentedTrainLookup.get(row?.rowKey) ?? row,
  )
  const supportNearHardNegativeRows = (
    Array.isArray(family?.supportNearHardNegativeRows)
      ? family.supportNearHardNegativeRows
      : Array.isArray(family?.hardNegativeRows)
        ? family.hardNegativeRows
        : []
  ).map((row) => augmentedLookup.get(row?.rowKey) ?? augmentedTrainLookup.get(row?.rowKey) ?? row)

  const motifLatticeFeatureKeys = collectFeatureKeys([
    ...augmentedTrainRows,
    ...augmentedOosRows,
    ...augmentedSupportCaseViews,
  ])
  const distinctBagCoverSignatureCount = new Set(
    motifBundleStats.map((entry) => entry.bagCoverSignature).filter(Boolean),
  ).size
  const supportCaseTopBundleCount = uniqueStrings(
    collectRows(rebuiltSupportBags)
      .map((row) => row?.motifBundleId)
      .filter((bundleId) => Number(motifBundleLookup[bundleId]?.positiveBagCount ?? 0) > 0),
  ).length

  return {
    ...family,
    ok: motifBundleStats.length > 0,
    reason: motifBundleStats.length > 0 ? null : "unsat_no_motif_lattice_bundles",
    trainRows: augmentedTrainRows,
    gatedTrainRows: augmentedGatedTrainRows,
    oosRows: augmentedOosRows,
    supportCaseViews: augmentedSupportCaseViews,
    positiveBags: rebuiltPositiveBags,
    negativeBags: rebuiltNegativeBags,
    unlabeledBags: rebuiltUnlabeledBags,
    supportBags: rebuiltSupportBags,
    bridgePositiveRows,
    supportNearHardNegativeRows,
    motifBundleStats,
    motifBundleLookup,
    motifLatticeFeatureKeys,
    summary: {
      ...(family?.summary ?? {}),
      motifLatticeReady: motifBundleStats.length > 0,
      motifBundleCount: motifBundleStats.length,
      motifLatticeFeatureCount: motifLatticeFeatureKeys.length,
      distinctBagCoverSignatureCount,
      supportCaseTopBundleCount,
    },
  }
}
