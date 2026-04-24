import { buildMonthKey, summarizeRows, uniqueStrings } from "./perfect_prototype_daily_symbolic_common.mjs"

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

const stableTokens = (row) =>
  uniqueStrings([...(row?.categoricalTokens ?? []), ...Array.from(row?.tokenSet ?? [])].filter((token) => String(token).startsWith("sig.")))

const addDateSupport = (supportMap, dateKey, tokens = []) => {
  for (const token of stableTokens({ categoricalTokens: tokens })) {
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

const buildSignature = (row, tokenLiftMap) =>
  stableTokens(row)
    .sort((left, right) => (tokenLiftMap.get(right) ?? 0) - (tokenLiftMap.get(left) ?? 0) || left.localeCompare(right))
    .slice(0, 4)
    .join("|")

const annotateRows = ({ rows = [], tokenLiftMap = new Map() } = {}) =>
  rows.map((row) => {
    const tokens = stableTokens(row)
    const supportiveTokens = tokens.filter((token) => (tokenLiftMap.get(token) ?? 0) > 0.04)
    const impostorTokens = tokens.filter((token) => (tokenLiftMap.get(token) ?? 0) < -0.02)
    const tokenLiftScoreValue = tokens.reduce((sum, token) => sum + Number(tokenLiftMap.get(token) ?? 0), 0)
    return {
      ...row,
      symbolicWitnessTokens: tokens,
      symbolicWitnessSupportiveTokenCount: supportiveTokens.length,
      symbolicWitnessImpostorTokenCount: impostorTokens.length,
      symbolicWitnessScore: tokenLiftScoreValue + supportiveTokens.length * 0.05 - impostorTokens.length * 0.08,
    }
  })

export const buildPerfectPrototypeDailyTradeWitnessSelector = ({
  family,
  maxWitnessPerPositiveDate = 2,
  maxNegativePerPositiveDate = 2,
} = {}) => {
  const admittedTradeDateSet = new Set((family?.admittedTradeDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const canonicalPositiveDateSet = new Set((family?.canonicalPositiveDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const controlOnlyDateSet = new Set((family?.controlOnlyDateKeys ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  const positiveAdmittedDateSet = new Set(
    Array.from(canonicalPositiveDateSet.values()).filter((dateKey) => admittedTradeDateSet.has(dateKey)),
  )
  const byDate = groupRowsByDate(family?.gatedTrainRows ?? [])
  const positiveDateSupport = new Map()
  const negativeDateSupport = new Map()
  const controlRows = []

  for (const [dateKey, rows] of byDate.entries()) {
    if (positiveAdmittedDateSet.has(dateKey)) {
      const positiveTokens = uniqueStrings(
        rows.filter((row) => row?.outcomeHitTarget === true).flatMap((row) => stableTokens(row)),
      )
      const negativeTokens = uniqueStrings(
        rows.filter((row) => row?.outcomeHitTarget !== true).flatMap((row) => stableTokens(row)),
      )
      addDateSupport(positiveDateSupport, dateKey, positiveTokens)
      addDateSupport(negativeDateSupport, dateKey, negativeTokens)
    } else if (controlOnlyDateSet.has(dateKey)) {
      const tokens = uniqueStrings(rows.flatMap((row) => stableTokens(row)))
      addDateSupport(negativeDateSupport, dateKey, tokens)
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
    const rows = annotateRows({
      rows: byDate.get(dateKey) ?? [],
      tokenLiftMap,
    })
    const positiveRows = rows
      .filter((row) => row?.outcomeHitTarget === true)
      .sort(
        (left, right) =>
          Number(right?.symbolicWitnessScore ?? 0) - Number(left?.symbolicWitnessScore ?? 0) ||
          Number(right?.symbolicWitnessSupportiveTokenCount ?? 0) - Number(left?.symbolicWitnessSupportiveTokenCount ?? 0) ||
          String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
      )
    const negativeRows = rows
      .filter((row) => row?.outcomeHitTarget !== true)
      .sort(
        (left, right) =>
          Number(right?.symbolicWitnessScore ?? 0) - Number(left?.symbolicWitnessScore ?? 0) ||
          String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
      )
    witnessRows.push(...positiveRows.slice(0, Math.max(1, Math.floor(Number(maxWitnessPerPositiveDate) || 2))))
    witnessNegativeRows.push(...negativeRows.slice(0, Math.max(1, Math.floor(Number(maxNegativePerPositiveDate) || 2))))
  }

  const annotatedControlRows = annotateRows({ rows: controlRows, tokenLiftMap })
  const controlNegativeRows = Array.from(groupRowsByDate(annotatedControlRows).values())
    .map((rows) =>
      rows.sort(
        (left, right) =>
          Number(right?.symbolicWitnessScore ?? 0) - Number(left?.symbolicWitnessScore ?? 0) ||
          String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
      )[0],
    )
    .filter(Boolean)

  const selectedWitnessNegativeRows = [...witnessNegativeRows, ...controlNegativeRows]
  const witnessSignatures = new Set(witnessRows.map((row) => buildSignature(row, tokenLiftMap)).filter(Boolean))
  const ok = witnessRows.length > 0 && positiveAdmittedDateSet.size > 0

  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_symbolic_witness_rows",
    witnessRows,
    witnessNegativeRows: selectedWitnessNegativeRows,
    witnessPositiveDateKeys: Array.from(new Set(witnessRows.map((row) => row?.dateKey).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right),
    ),
    witnessNegativeDateKeys: Array.from(new Set(selectedWitnessNegativeRows.map((row) => row?.dateKey).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right),
    ),
    symbolicTokenLiftMap: tokenLiftMap,
    summary: {
      ...(family?.summary ?? {}),
      witnessSelectorReady: ok,
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
        score: Number(row?.symbolicWitnessScore ?? 0),
        supportiveTokenCount: Number(row?.symbolicWitnessSupportiveTokenCount ?? 0),
        impostorTokenCount: Number(row?.symbolicWitnessImpostorTokenCount ?? 0),
        signature: buildSignature(row, tokenLiftMap),
        monthKey: row?.monthKey ?? buildMonthKey(row?.dateKey) ?? null,
      })),
    },
  }
}
