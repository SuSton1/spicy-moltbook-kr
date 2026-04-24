const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const quantile = (values = [], q = 0.5) => {
  const filtered = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (filtered.length < 1) return null
  if (filtered.length === 1) return filtered[0]
  const clamped = Math.max(0, Math.min(1, Number(q) || 0))
  const position = (filtered.length - 1) * clamped
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return filtered[lowerIndex]
  const fraction = position - lowerIndex
  return filtered[lowerIndex] + (filtered[upperIndex] - filtered[lowerIndex]) * fraction
}

const uniqueStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const ROUTER_FEATURES = [
  "sig.slateJoint.jointRarity",
  "sig.sponsor.upStrength",
  "sig.stateTrans.releaseQuality",
  "sig.phaseDiv.ignitionOnBase",
  "sig.pathGeom.efficiencyProxy",
  "sig.liqPath.stability",
]

export const buildPerfectPrototypeDailyMechanismArchetypeRouter = ({
  family,
  minArchetypeDates = 2,
  maxArchetypes = 4,
} = {}) => {
  const admittedDateSet = new Set((family?.admittedTradeDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const positiveRows = (family?.winnerPositiveRows ?? []).filter((row) => admittedDateSet.has(String(row?.dateKey ?? "").trim()))
  const availableFeatures = ROUTER_FEATURES.filter((featureKey) =>
    positiveRows.some((row) => Number.isFinite(num(row?.numericFeatureMap?.[featureKey]))),
  ).slice(0, 4)
  if (positiveRows.length < 2 || availableFeatures.length < 2) {
    return {
      ...family,
      ok: false,
      reason: "unsat_no_mechanism_archetypes",
      archetypes: [],
      summary: {
        ...(family?.summary ?? {}),
        archetypeRouterReady: false,
        archetypeFeatureCount: availableFeatures.length,
        winnerArchetypeCount: 0,
      },
    }
  }
  const medians = Object.fromEntries(
    availableFeatures.map((featureKey) => [
      featureKey,
      quantile(
        positiveRows.map((row) => row?.numericFeatureMap?.[featureKey]).filter((value) => Number.isFinite(num(value))),
        0.5,
      ) ?? 0,
    ]),
  )
  const grouped = new Map()
  for (const row of positiveRows) {
    const signature = availableFeatures
      .map((featureKey) => {
        const value = num(row?.numericFeatureMap?.[featureKey]) ?? 0
        const label = value >= Number(medians[featureKey] ?? 0) ? "hi" : "lo"
        return `${featureKey.split(".").slice(-1)[0]}:${label}`
      })
      .join("|")
    const bucket = grouped.get(signature) ?? []
    bucket.push(row)
    grouped.set(signature, bucket)
  }
  const archetypes = Array.from(grouped.entries())
    .map(([signature, rows], index) => ({
      archetypeId: `A${index + 1}`,
      signature,
      winnerRows: rows,
      dateKeys: uniqueStrings(rows.map((row) => row?.dateKey).filter(Boolean)),
    }))
    .filter((entry) => entry.dateKeys.length >= Math.max(1, Math.floor(Number(minArchetypeDates) || 2)))
    .sort((left, right) => right.dateKeys.length - left.dateKeys.length || left.signature.localeCompare(right.signature))
    .slice(0, Math.max(1, Math.floor(Number(maxArchetypes) || 4)))
    .map((entry, index) => ({
      ...entry,
      archetypeId: `A${index + 1}`,
    }))
  const distinctDateSignatures = new Set(archetypes.map((entry) => entry.dateKeys.join(",")))
  const ok = archetypes.length >= 2 && distinctDateSignatures.size >= 2
  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_mechanism_archetypes",
    archetypes,
    archetypeRouterFeatureKeys: availableFeatures,
    summary: {
      ...(family?.summary ?? {}),
      archetypeRouterReady: ok,
      archetypeFeatureCount: availableFeatures.length,
      winnerArchetypeCount: archetypes.length,
      winnerArchetypeDistinctDateSignatureCount: distinctDateSignatures.size,
      winnerArchetypePreview: archetypes.map((entry) => ({
        archetypeId: entry.archetypeId,
        signature: entry.signature,
        dateCount: entry.dateKeys.length,
        dateKeys: entry.dateKeys,
      })),
    },
  }
}
