import path from "node:path"

import { parseCliArgs, getFlag } from "../src/lib/args.mjs"
import { readJson, readJsonl, writeJson } from "../src/lib/io.mjs"
import { loadPerfectPrototypeRowsFromInput } from "../src/lib/perfect_prototype_parquet_io.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const resolveRowDateKey = (row) =>
  String(row?.dateKey ?? row?.decisionDateKey ?? row?.eventDate ?? row?.targetDateKey ?? "").trim() || null

const buildRowKey = (row) => {
  const dateKey = resolveRowDateKey(row)
  const symbol = String(row?.symbol ?? "").trim()
  if (!dateKey || !symbol) return null
  return `${dateKey}::${symbol}`
}

const extractRowTokens = (row) =>
  uniqueSorted([
    ...(Array.isArray(row?.tokens) ? row.tokens : []),
    ...(Array.isArray(row?.contextualTokens) ? row.contextualTokens : []),
    ...(Array.isArray(row?.categoricalTokens) ? row.categoricalTokens : []),
  ])

const tokenFrequencyMap = (rows) => {
  const freq = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const tokens = extractRowTokens(row)
    for (const token of tokens) {
      freq.set(token, Number(freq.get(token) ?? 0) + 1)
    }
  }
  return freq
}

const summarizeDifferential = ({ positiveRows, negativeRows, topN = 40 }) => {
  const positiveFreq = tokenFrequencyMap(positiveRows)
  const negativeFreq = tokenFrequencyMap(negativeRows)
  const positiveRowCount = Math.max(1, Array.isArray(positiveRows) ? positiveRows.length : 0)
  const negativeRowCount = Math.max(1, Array.isArray(negativeRows) ? negativeRows.length : 0)
  const allTokens = uniqueSorted([...positiveFreq.keys(), ...negativeFreq.keys()])
  const rows = allTokens.map((token) => {
    const positiveCount = Number(positiveFreq.get(token) ?? 0)
    const negativeCount = Number(negativeFreq.get(token) ?? 0)
    const positiveShare = positiveCount / positiveRowCount
    const negativeShare = negativeCount / negativeRowCount
    return {
      token,
      positiveCount,
      negativeCount,
      positiveShare,
      negativeShare,
      shareDelta: positiveShare - negativeShare,
      absoluteShareDelta: Math.abs(positiveShare - negativeShare),
    }
  })
  const sharedTpNotFp = rows
    .filter((row) => row.positiveCount > 0 && row.negativeCount === 0)
    .sort((left, right) => {
      if (right.positiveShare !== left.positiveShare) return right.positiveShare - left.positiveShare
      return String(left.token).localeCompare(String(right.token))
    })
    .slice(0, topN)
  const sharedFpNotTp = rows
    .filter((row) => row.negativeCount > 0 && row.positiveCount === 0)
    .sort((left, right) => {
      if (right.negativeShare !== left.negativeShare) return right.negativeShare - left.negativeShare
      return String(left.token).localeCompare(String(right.token))
    })
    .slice(0, topN)
  const candidateRegimeAxes = rows
    .filter((row) => row.absoluteShareDelta > 0)
    .sort((left, right) => {
      if (right.absoluteShareDelta !== left.absoluteShareDelta) {
        return right.absoluteShareDelta - left.absoluteShareDelta
      }
      return String(left.token).localeCompare(String(right.token))
    })
    .slice(0, topN)
  return {
    positiveRowCount: Array.isArray(positiveRows) ? positiveRows.length : 0,
    negativeRowCount: Array.isArray(negativeRows) ? negativeRows.length : 0,
    sharedTpNotFp,
    sharedFpNotTp,
    candidateRegimeAxes,
  }
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const leaderboardPath = path.resolve(String(getFlag(parsed.flags, "leaderboard", "")).trim())
  const inputPath = path.resolve(String(getFlag(parsed.flags, "input", "")).trim())
  const matchesPath = path.resolve(String(getFlag(parsed.flags, "matches", "")).trim())
  const outPath = path.resolve(String(getFlag(parsed.flags, "out", "")).trim())
  const familyId = String(getFlag(parsed.flags, "family-id", "low_gap_top_continuation")).trim()
  if (!leaderboardPath || !inputPath || !matchesPath || !outPath) {
    throw new Error(
      "Usage: node tools/report_low_gap_top_cluster_differentials.mjs --leaderboard=<selection_leaderboard.json> --input=<daily_pack.jsonl|parquet> --matches=<matches.jsonl> --out=<report.json> [--family-id=low_gap_top_continuation]",
    )
  }

  const leaderboard = await readJson(leaderboardPath, [])
  const familyRows = (Array.isArray(leaderboard) ? leaderboard : []).filter(
    (row) => String(row?.familyId ?? "").trim() === familyId,
  )
  const tpRuleIds = new Set(
    familyRows
      .filter(
        (row) =>
          Number(row?.openOosMatchCount ?? 0) > 0 &&
          Number(row?.openOosNegativeCount ?? 0) === 0,
      )
      .map((row) => String(row?.ruleId ?? "").trim())
      .filter(Boolean),
  )
  const fpRuleIds = new Set(
    familyRows
      .filter((row) => Number(row?.openOosNegativeCount ?? 0) > 0)
      .map((row) => String(row?.ruleId ?? "").trim())
      .filter(Boolean),
  )

  const matches = await readJsonl(matchesPath)
  const positiveRowKeys = new Set()
  const negativeRowKeys = new Set()
  for (const row of Array.isArray(matches) ? matches : []) {
    const rowKey = buildRowKey(row)
    if (!rowKey) continue
    const matchedRuleIds = new Set(
      (Array.isArray(row?.matchedRuleIds) ? row.matchedRuleIds : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    )
    const outcomeHitTarget =
      typeof row?.outcomeHitTarget === "boolean"
        ? row.outcomeHitTarget
        : typeof row?.eventOutcome?.hitTarget === "boolean"
          ? row.eventOutcome.hitTarget
          : null
    if (
      outcomeHitTarget === true &&
      Array.from(matchedRuleIds).some((ruleId) => tpRuleIds.has(ruleId))
    ) {
      positiveRowKeys.add(rowKey)
    }
    if (
      outcomeHitTarget === false &&
      Array.from(matchedRuleIds).some((ruleId) => fpRuleIds.has(ruleId))
    ) {
      negativeRowKeys.add(rowKey)
    }
  }

  const overlapRowKeys = uniqueSorted(
    Array.from(positiveRowKeys).filter((rowKey) => negativeRowKeys.has(rowKey)),
  )
  for (const rowKey of overlapRowKeys) {
    positiveRowKeys.delete(rowKey)
    negativeRowKeys.delete(rowKey)
  }

  const inputRows = await loadPerfectPrototypeRowsFromInput({
    cwd: process.cwd(),
    inputPath,
    inputLabel: "low-gap-top differential input",
  })
  const rowByKey = new Map()
  for (const row of Array.isArray(inputRows) ? inputRows : []) {
    const rowKey = buildRowKey(row)
    if (!rowKey) continue
    rowByKey.set(rowKey, row)
  }

  const positiveRows = Array.from(positiveRowKeys)
    .map((rowKey) => rowByKey.get(rowKey) ?? null)
    .filter(Boolean)
  const negativeRows = Array.from(negativeRowKeys)
    .map((rowKey) => rowByKey.get(rowKey) ?? null)
    .filter(Boolean)
  const missingPositiveRowKeys = uniqueSorted(
    Array.from(positiveRowKeys).filter((rowKey) => !rowByKey.has(rowKey)),
  )
  const missingNegativeRowKeys = uniqueSorted(
    Array.from(negativeRowKeys).filter((rowKey) => !rowByKey.has(rowKey)),
  )

  const report = {
    familyId,
    sourceLeaderboardPath: leaderboardPath,
    sourceInputPath: inputPath,
    sourceMatchesPath: matchesPath,
    tpRuleCount: tpRuleIds.size,
    fpRuleCount: fpRuleIds.size,
    overlapRowKeyCount: overlapRowKeys.length,
    overlapRowKeys,
    missingPositiveRowKeyCount: missingPositiveRowKeys.length,
    missingPositiveRowKeys,
    missingNegativeRowKeyCount: missingNegativeRowKeys.length,
    missingNegativeRowKeys,
    ...summarizeDifferential({
      positiveRows,
      negativeRows,
    }),
  }
  await writeJson(outPath, report)
}

await main()
