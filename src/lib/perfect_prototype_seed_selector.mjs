import {
  PERFECT_PROTOTYPE_SEED_RANKING_SPECS,
  enrichSeedEntry,
  mergeDiversifiedSeedRankedLists,
} from "./perfect_prototype_miner.mjs"
import {
  buildDelimitedSelectSqlFromSchema,
  streamParquetQueryDelimitedRows,
} from "./perfect_prototype_duckdb.mjs"
import { PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA } from "./perfect_prototype_token_index.mjs"

const isBetterSeedEntry = (compare, left, right) => compare(left, right) < 0

const siftUpWorstFirst = (heap, index, compare) => {
  let cursor = index
  while (cursor > 0) {
    const parent = Math.floor((cursor - 1) / 2)
    if (!isBetterSeedEntry(compare, heap[parent], heap[cursor])) break
    ;[heap[parent], heap[cursor]] = [heap[cursor], heap[parent]]
    cursor = parent
  }
}

const siftDownWorstFirst = (heap, index, compare) => {
  let cursor = index
  for (;;) {
    const left = cursor * 2 + 1
    const right = left + 1
    let worst = cursor
    if (left < heap.length && isBetterSeedEntry(compare, heap[worst], heap[left])) {
      worst = left
    }
    if (right < heap.length && isBetterSeedEntry(compare, heap[worst], heap[right])) {
      worst = right
    }
    if (worst === cursor) break
    ;[heap[cursor], heap[worst]] = [heap[worst], heap[cursor]]
    cursor = worst
  }
}

const pushBoundedWorstFirstHeap = (heap, entry, limit, compare) => {
  if (limit <= 0) return
  if (heap.length < limit) {
    heap.push(entry)
    siftUpWorstFirst(heap, heap.length - 1, compare)
    return
  }
  if (!heap[0]) return
  if (!isBetterSeedEntry(compare, entry, heap[0])) return
  heap[0] = entry
  siftDownWorstFirst(heap, 0, compare)
}

export const streamSelectPerfectPrototypeSeedEntries = async ({
  cwd = process.cwd(),
  duckdb,
  tokenStatsPath,
  minHitCount,
  maxSeedTokens,
  maxRejectedRuleSamples = 0,
  expectedTokenCount = null,
}) => {
  const hasExplicitExpectedTokenCount =
    expectedTokenCount !== null &&
    expectedTokenCount !== undefined &&
    String(expectedTokenCount).trim() !== ""
  const resolvedMaxSeedTokens = Math.max(0, Math.floor(Number(maxSeedTokens) || 0))
  const resolvedMinHitCount = Math.max(1, Math.floor(Number(minHitCount) || 1))
  const resolvedMaxRejectedRuleSamples = Math.max(0, Math.floor(Number(maxRejectedRuleSamples) || 0))
  const resolvedExpectedTokenCount =
    hasExplicitExpectedTokenCount &&
    Number.isInteger(Number(expectedTokenCount)) &&
    Number(expectedTokenCount) >= 0
      ? Number(expectedTokenCount)
      : null
  const rankingHeaps = PERFECT_PROTOTYPE_SEED_RANKING_SPECS.map((spec) => ({
    ...spec,
    heap: [],
  }))
  let totalTokenCount = 0
  let seedBelowMinHitCount = 0
  const rejectedSeedSamples = []
  let previousToken = null
  await streamParquetQueryDelimitedRows({
    cwd,
    duckdb,
    parquetPath: tokenStatsPath,
    schema: PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA,
    selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA),
    orderBySql: "token",
    onRow: async (row) => {
      const token = String(row?.token ?? "").trim()
      if (!token) {
        throw new Error(`Invalid token in token_stats.parquet: ${tokenStatsPath}`)
      }
      if (previousToken && token <= previousToken) {
        throw new Error(
          `token_stats.parquet must contain strictly ascending unique tokens: current=${token} previous=${previousToken} path=${tokenStatsPath}`,
        )
      }
      previousToken = token
      totalTokenCount += 1
      const enriched = enrichSeedEntry({
        token,
        positiveMatchCount: Number(row?.positiveMatchCount ?? 0),
        negativeMatchCount: Number(row?.negativeMatchCount ?? 0),
      })
      if (enriched.positiveMatchCount < resolvedMinHitCount) {
        seedBelowMinHitCount += 1
        if (rejectedSeedSamples.length < resolvedMaxRejectedRuleSamples) {
          rejectedSeedSamples.push({
            token: enriched.token,
            positiveMatchCount: enriched.positiveMatchCount,
            negativeMatchCount: enriched.negativeMatchCount,
          })
        }
        return
      }
      for (const ranking of rankingHeaps) {
        pushBoundedWorstFirstHeap(
          ranking.heap,
          enriched,
          resolvedMaxSeedTokens,
          ranking.compare,
        )
      }
    },
  })
  if (resolvedExpectedTokenCount != null && totalTokenCount !== resolvedExpectedTokenCount) {
    throw new Error(
      `token_stats.parquet token count mismatch: actual=${totalTokenCount} expected=${resolvedExpectedTokenCount} path=${tokenStatsPath}`,
    )
  }
  const seedEntries = mergeDiversifiedSeedRankedLists({
    rankedLists: rankingHeaps.map((ranking) => ranking.heap.sort(ranking.compare)),
    maxSeedTokens: resolvedMaxSeedTokens,
  })
  return {
    totalTokenCount,
    seedBelowMinHitCount,
    seedEntries,
    rejectedSeedSamples,
  }
}
