import { buildMonthKey, summarizeRows, uniqueStrings } from "./perfect_prototype_daily_symbolic_common.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const eventNetRet = (row) =>
  num(row?.eventOutcome?.netRet) ??
  num(row?.numericFeatureMap?.["sig.dailyWinner.eventNetRet"]) ??
  (row?.outcomeHitTarget === true ? 0.01 : -0.01)

const groupRowsByDate = (rows = []) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    const bucket = grouped.get(dateKey) ?? []
    bucket.push(row)
    grouped.set(dateKey, bucket)
  }
  return grouped
}

const rowTokens = (row) =>
  uniqueStrings([...(row?.categoricalTokens ?? []), ...Array.from(row?.tokenSet ?? [])].filter((token) => String(token).startsWith("sig.")))

const addDateSupport = (supportMap, dateKey, tokens = []) => {
  for (const token of uniqueStrings(tokens)) {
    const bucket = supportMap.get(token) ?? new Set()
    bucket.add(dateKey)
    supportMap.set(token, bucket)
  }
}

const tokenLiftScore = (token, positiveDateSupport, negativeDateSupport, positiveDateCount, negativeDateCount) => {
  const pos = (positiveDateSupport.get(token)?.size ?? 0) / Math.max(1, positiveDateCount)
  const neg = (negativeDateSupport.get(token)?.size ?? 0) / Math.max(1, negativeDateCount)
  return pos - neg
}

const buildWitnessSignature = (row, assignmentMapByRowKey = new Map()) => {
  const rowKey = String(row?.rowKey ?? row?.sourceId ?? "").trim()
  const assignment = assignmentMapByRowKey.get(rowKey) ?? {}
  return uniqueStrings([
    assignment.price10,
    assignment.price20,
    assignment.range20,
    assignment.volume20,
    assignment.combo,
  ]).join("|")
}

const annotateRows = ({ rows = [], tokenLiftMap = new Map(), assignmentMapByRowKey = new Map() } = {}) =>
  rows.map((row) => {
    const tokens = rowTokens(row)
    const supportiveTokens = tokens.filter((token) => (tokenLiftMap.get(token) ?? 0) > 0.03)
    const impostorTokens = tokens.filter((token) => (tokenLiftMap.get(token) ?? 0) < -0.02)
    const assignment = assignmentMapByRowKey.get(String(row?.rowKey ?? "").trim()) ?? {}
    const assignmentTokens = uniqueStrings(Object.values(assignment))
    const assignmentLift = assignmentTokens.reduce((sum, token) => sum + Number(tokenLiftMap.get(token) ?? 0), 0)
    const score =
      tokens.reduce((sum, token) => sum + Number(tokenLiftMap.get(token) ?? 0), 0) +
      supportiveTokens.length * 0.08 -
      impostorTokens.length * 0.1 +
      assignmentLift * 0.25 +
      eventNetRet(row) * 0.05
    return {
      ...row,
      sequenceWitnessTokens: tokens,
      sequenceWitnessSupportiveTokenCount: supportiveTokens.length,
      sequenceWitnessImpostorTokenCount: impostorTokens.length,
      sequenceWitnessAssignmentTokenCount: assignmentTokens.length,
      sequenceWitnessScore: score,
      sequenceWitnessSignature: buildWitnessSignature(row, assignmentMapByRowKey),
    }
  })

export const buildPerfectPrototypeDailyBagLatentWitnessSelector = ({
  family,
  maxWitnessPerPositiveDate = 2,
  maxNegativePerPositiveDate = 2,
} = {}) => {
  const admittedTradeDateSet = new Set((family?.admittedTradeDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const canonicalPositiveDateSet = new Set((family?.canonicalPositiveDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const controlOnlyDateSet = new Set((family?.controlOnlyDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const positiveAdmittedDateSet = new Set(Array.from(canonicalPositiveDateSet.values()).filter((dateKey) => admittedTradeDateSet.has(dateKey)))
  const byDate = groupRowsByDate(family?.gatedTrainRows ?? [])
  const assignmentMapByRowKey =
    family?.sequenceShapeletAssignmentsByRowKey instanceof Map ? family.sequenceShapeletAssignmentsByRowKey : new Map()

  const positiveDateSupport = new Map()
  const negativeDateSupport = new Map()
  const controlRows = []

  for (const [dateKey, rows] of byDate.entries()) {
    if (positiveAdmittedDateSet.has(dateKey)) {
      const positiveTokens = uniqueStrings(rows.filter((row) => row?.outcomeHitTarget === true).flatMap((row) => rowTokens(row)))
      const negativeTokens = uniqueStrings(rows.filter((row) => row?.outcomeHitTarget !== true).flatMap((row) => rowTokens(row)))
      addDateSupport(positiveDateSupport, dateKey, positiveTokens)
      addDateSupport(negativeDateSupport, dateKey, negativeTokens)
    } else if (controlOnlyDateSet.has(dateKey)) {
      const controlTokens = uniqueStrings(rows.flatMap((row) => rowTokens(row)))
      addDateSupport(negativeDateSupport, dateKey, controlTokens)
      controlRows.push(...rows)
    }
  }

  const allTokens = uniqueStrings([...positiveDateSupport.keys(), ...negativeDateSupport.keys()])
  const tokenLiftMap = new Map(
    allTokens.map((token) => [
      token,
      tokenLiftScore(
        token,
        positiveDateSupport,
        negativeDateSupport,
        positiveAdmittedDateSet.size,
        new Set([...positiveAdmittedDateSet.values(), ...controlOnlyDateSet.values()]).size,
      ),
    ]),
  )

  const witnessRows = []
  const witnessNegativeRows = []
  for (const dateKey of Array.from(positiveAdmittedDateSet.values()).sort((left, right) => left.localeCompare(right))) {
    const annotatedRows = annotateRows({
      rows: byDate.get(dateKey) ?? [],
      tokenLiftMap,
      assignmentMapByRowKey,
    })
    const positiveRows = annotatedRows
      .filter((row) => row?.outcomeHitTarget === true)
      .sort(
        (left, right) =>
          Number(right?.sequenceWitnessScore ?? 0) - Number(left?.sequenceWitnessScore ?? 0) ||
          Number(right?.sequenceWitnessSupportiveTokenCount ?? 0) - Number(left?.sequenceWitnessSupportiveTokenCount ?? 0) ||
          eventNetRet(right) - eventNetRet(left) ||
          String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
      )
    const negativeRows = annotatedRows
      .filter((row) => row?.outcomeHitTarget !== true)
      .sort(
        (left, right) =>
          Number(right?.sequenceWitnessScore ?? 0) - Number(left?.sequenceWitnessScore ?? 0) ||
          String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
      )
    witnessRows.push(...positiveRows.slice(0, Math.max(1, Math.floor(Number(maxWitnessPerPositiveDate) || 2))))
    witnessNegativeRows.push(...negativeRows.slice(0, Math.max(1, Math.floor(Number(maxNegativePerPositiveDate) || 2))))
  }

  const controlNegativeRows = Array.from(groupRowsByDate(annotateRows({
    rows: controlRows,
    tokenLiftMap,
    assignmentMapByRowKey,
  })).values())
    .map((rows) =>
      rows
        .slice()
        .sort(
          (left, right) =>
            Number(right?.sequenceWitnessScore ?? 0) - Number(left?.sequenceWitnessScore ?? 0) ||
            String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
        )[0],
    )
    .filter(Boolean)

  const selectedWitnessNegativeRows = [...witnessNegativeRows, ...controlNegativeRows]
  const witnessSignatures = new Set(witnessRows.map((row) => row?.sequenceWitnessSignature).filter(Boolean))
  const ok = witnessRows.length > 0 && positiveAdmittedDateSet.size > 0

  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_shapelet_witness_rows",
    witnessRows,
    witnessNegativeRows: selectedWitnessNegativeRows,
    witnessPositiveDateKeys: Array.from(new Set(witnessRows.map((row) => row?.dateKey).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right),
    ),
    witnessNegativeDateKeys: Array.from(new Set(selectedWitnessNegativeRows.map((row) => row?.dateKey).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right),
    ),
    sequenceWitnessTokenLiftMap: tokenLiftMap,
    summary: {
      ...(family?.summary ?? {}),
      shapeletWitnessReady: ok,
      witnessQualifiedCount: witnessRows.length,
      witnessPositiveSummary: summarizeRows(witnessRows),
      witnessNegativeSummary: summarizeRows(selectedWitnessNegativeRows),
      witnessPositiveDateCount: new Set(witnessRows.map((row) => row?.dateKey).filter(Boolean)).size,
      witnessNegativeDateCount: new Set(selectedWitnessNegativeRows.map((row) => row?.dateKey).filter(Boolean)).size,
      witnessDistinctSignatureCount: witnessSignatures.size,
      witnessPreview: witnessRows.slice(0, 8).map((row) => ({
        rowKey: row?.rowKey ?? null,
        dateKey: row?.dateKey ?? null,
        symbol: row?.symbol ?? null,
        score: Number(row?.sequenceWitnessScore ?? 0),
        signature: row?.sequenceWitnessSignature ?? null,
        monthKey: row?.monthKey ?? buildMonthKey(row?.dateKey) ?? null,
      })),
    },
  }
}
