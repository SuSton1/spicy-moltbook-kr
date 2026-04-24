const uniqueStrings = (values) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => Number(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

export const buildPerfectPrototypeSupportMilMotifPrototypes = ({
  family,
  minPositiveBags = 2,
  maxPrototypes = 6,
} = {}) => {
  const grouped = new Map()
  for (const witness of Array.isArray(family?.bagWitnessSelections) ? family.bagWitnessSelections : []) {
    const bundleId = String(witness?.motifBundleId ?? "").trim()
    if (!bundleId) continue
    const bucket = grouped.get(bundleId) ?? []
    bucket.push(witness)
    grouped.set(bundleId, bucket)
  }

  const prototypes = []
  for (const [bundleId, witnesses] of Array.from(grouped.entries())) {
    const bundleStat = family?.motifBundleLookup?.[bundleId] ?? {}
    const positiveBagIds = uniqueStrings(witnesses.map((entry) => entry?.bagId))
    if (positiveBagIds.length < Math.max(1, Math.floor(Number(minPositiveBags) || 2))) continue
    const positiveRows = witnesses.map((entry) => entry?.row)
    const matchedMonthCount = new Set(positiveRows.map((row) => row?.monthKey).filter(Boolean)).size
    const matchedFoldCount = new Set(
      positiveRows.map((row) => Number(row?.foldId ?? 0)).filter((value) => Number.isFinite(value) && value > 0),
    ).size
    prototypes.push({
      prototypeId: `MOTIF_PROTO_${String(prototypes.length + 1).padStart(2, "0")}`,
      bundleId,
      positiveBagIds,
      negativeBagIds: bundleStat.negativeBagIds ?? [],
      bagCoverSignature: positiveBagIds.join("|"),
      positiveBagCount: positiveBagIds.length,
      matchedMonthCount,
      matchedFoldCount,
      witnessRows: positiveRows,
      witnessScores: witnesses.map((entry) => Number(entry?.witnessScore ?? 0)).filter(Number.isFinite),
      meanWitnessScore: average(witnesses.map((entry) => entry?.witnessScore)),
      purity: Number(bundleStat.purity ?? 0),
      breadthCarry: Number(bundleStat.breadthCarry ?? 0),
    })
  }

  prototypes.sort((left, right) => {
    if (right.positiveBagCount !== left.positiveBagCount) return right.positiveBagCount - left.positiveBagCount
    if (right.purity !== left.purity) return right.purity - left.purity
    return String(left.prototypeId).localeCompare(String(right.prototypeId))
  })

  const seenSignature = new Set()
  const distinctPrototypes = []
  for (const prototype of prototypes) {
    if (seenSignature.has(prototype.bagCoverSignature)) continue
    seenSignature.add(prototype.bagCoverSignature)
    distinctPrototypes.push(prototype)
    if (distinctPrototypes.length >= Math.max(1, Math.floor(Number(maxPrototypes) || 6))) break
  }

  return {
    ...family,
    ok: distinctPrototypes.length > 0,
    reason: distinctPrototypes.length > 0 ? null : "unsat_no_motif_prototypes",
    motifPrototypes: distinctPrototypes,
    summary: {
      ...(family?.summary ?? {}),
      motifPrototypeCount: distinctPrototypes.length,
      distinctBagCoverSignatureCount: seenSignature.size,
      motifPrototypeReady: distinctPrototypes.length > 0,
      topPrototypePositiveBagCount: Number(distinctPrototypes[0]?.positiveBagCount ?? 0),
      topPrototypeMonthCount: Number(distinctPrototypes[0]?.matchedMonthCount ?? 0),
      topPrototypeFoldCount: Number(distinctPrototypes[0]?.matchedFoldCount ?? 0),
    },
  }
}
