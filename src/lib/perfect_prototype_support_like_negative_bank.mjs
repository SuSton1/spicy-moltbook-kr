import { groupRowsByDate, summarizeRows, uniqueStrings } from "./perfect_prototype_daily_symbolic_common.mjs"

const rowTokens = (row) =>
  uniqueStrings([...(row?.categoricalTokens ?? []), ...Array.from(row?.tokenSet ?? [])].filter((token) => String(token ?? "").startsWith("sig.")))

const eventNetRet = (row) => {
  const numeric = Number(row?.eventOutcome?.netRet ?? row?.numericFeatureMap?.["sig.dailyWinner.eventNetRet"])
  if (Number.isFinite(numeric)) return numeric
  return row?.outcomeHitTarget === true ? 0.01 : -0.01
}

const dedupeRowsByKey = (rows = []) =>
  Array.from(
    new Map(
      (Array.isArray(rows) ? rows : [])
        .map((row) => [String(row?.rowKey ?? row?.sourceId ?? "").trim(), row])
        .filter(([rowKey]) => rowKey),
    ).values(),
  )

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

const scoreNegativeRow = ({ row, tokenLiftMap = new Map() } = {}) => {
  const tokens = rowTokens(row)
  const overlapLift = tokens.reduce((sum, token) => sum + Number(tokenLiftMap.get(token) ?? 0), 0)
  const positiveLikeTokenCount = tokens.filter((token) => Number(tokenLiftMap.get(token) ?? 0) > 0.03).length
  return overlapLift + positiveLikeTokenCount * 0.1 + eventNetRet(row) * 0.05
}

export const buildPerfectPrototypeSupportLikeNegativeBank = ({
  family,
  maxSameDateNegativesPerDate = 2,
  maxHardNegativesPerDate = 1,
} = {}) => {
  const positiveRows = Array.isArray(family?.detectorPositiveRows) ? family.detectorPositiveRows : []
  const sameDatePool = Array.isArray(family?.detectorSameDateNegativePool) ? family.detectorSameDateNegativePool : []
  const hardNegativePool = Array.isArray(family?.detectorHardNegativePool) ? family.detectorHardNegativePool : []

  const positiveDateSupport = new Map()
  const baseNegativeDateSupport = new Map()
  for (const row of positiveRows) addDateSupport(positiveDateSupport, row?.dateKey, rowTokens(row))
  for (const row of [...sameDatePool, ...hardNegativePool]) addDateSupport(baseNegativeDateSupport, row?.dateKey, rowTokens(row))

  const positiveDateCount = new Set(positiveRows.map((row) => row?.dateKey).filter(Boolean)).size
  const negativeDateCount = new Set([...sameDatePool, ...hardNegativePool].map((row) => row?.dateKey).filter(Boolean)).size
  const allTokens = uniqueStrings([...positiveDateSupport.keys(), ...baseNegativeDateSupport.keys()])
  const tokenLiftMap = new Map(
    allTokens.map((token) => [
      token,
      tokenLiftScore(token, positiveDateSupport, baseNegativeDateSupport, positiveDateCount, negativeDateCount),
    ]),
  )

  const sameDateNegatives = Array.from(groupRowsByDate(sameDatePool).values())
    .flatMap((rows) =>
      rows
        .slice()
        .sort(
          (left, right) =>
            scoreNegativeRow({ row: right, tokenLiftMap }) - scoreNegativeRow({ row: left, tokenLiftMap }) ||
            String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
        )
        .slice(0, Math.max(1, Math.floor(Number(maxSameDateNegativesPerDate) || 2))),
    )
  const hardNegatives = Array.from(groupRowsByDate(hardNegativePool).values())
    .flatMap((rows) =>
      rows
        .slice()
        .sort(
          (left, right) =>
            scoreNegativeRow({ row: right, tokenLiftMap }) - scoreNegativeRow({ row: left, tokenLiftMap }) ||
            String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
        )
        .slice(0, Math.max(1, Math.floor(Number(maxHardNegativesPerDate) || 1))),
    )

  const detectorNegativeRows = dedupeRowsByKey([...sameDateNegatives, ...hardNegatives])
  const ok = detectorNegativeRows.length > 0
  return {
    ...family,
    ok,
    reason: ok ? null : "unsat_no_support_like_negative_rows",
    detectorNegativeRows,
    supportLikeDetectorTokenLiftMap: tokenLiftMap,
    summary: {
      ...(family?.summary ?? {}),
      supportLikeNegativeBankReady: ok,
      detectorNegativeSummary: summarizeRows(detectorNegativeRows),
      detectorSameDateNegativeSummary: summarizeRows(sameDateNegatives),
      detectorHardNegativeSummary: summarizeRows(hardNegatives),
      detectorNegativePreview: detectorNegativeRows.slice(0, 8).map((row) => ({
        rowKey: row?.rowKey ?? null,
        dateKey: row?.dateKey ?? null,
        symbol: row?.symbol ?? null,
        score: scoreNegativeRow({ row, tokenLiftMap }),
      })),
    },
  }
}
