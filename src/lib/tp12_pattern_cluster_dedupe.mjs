import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import {
  closeWriteStream,
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toNumber,
  toText,
  uniqueSorted,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const resolvePatternId = (row) => toText(row?.patternId ?? row?.ruleId ?? row?.id)
const supportKey = (row) => `${toText(row?.decisionDateKey)}::${toText(row?.symbol).toUpperCase()}`
const familyOf = (token) => toText(token).split(":")[0] || "unknown"

const stableClusterId = (patternIds) =>
  `tp12_pcluster_${crypto.createHash("sha256").update(patternIds.join("\n")).digest("hex").slice(0, 12)}`

const jaccard = (left, right) => {
  if (!left || !right || (left.size < 1 && right.size < 1)) return 0
  let intersection = 0
  const smaller = left.size <= right.size ? left : right
  const larger = left.size <= right.size ? right : left
  for (const value of smaller) if (larger.has(value)) intersection += 1
  const union = left.size + right.size - intersection
  return union > 0 ? intersection / union : 0
}

const loadCatalogRows = async (catalogPath) => {
  const sourcePath = toText(catalogPath)
  if (!sourcePath) throw new Error("catalogPath is required")
  if (!fs.existsSync(sourcePath)) throw new Error(`catalog not found: ${sourcePath}`)
  const rows = []
  const pushRow = (row, contextLabel) => {
    const patternId = resolvePatternId(row)
    const tokenSet = uniqueSorted(row?.tokenSet ?? row?.tokens ?? [])
    if (!patternId) throw new Error(`catalog row missing patternId at ${contextLabel}`)
    if (tokenSet.length < 1) throw new Error(`catalog row missing tokenSet at ${contextLabel}`)
    rows.push({ ...row, patternId, tokenSet })
  }
  if (sourcePath.endsWith(".jsonl") || sourcePath.endsWith(".jsonl.gz")) {
    await iterateJsonlMaybeGzip(sourcePath, {
      strict: true,
      onRow: async (row, context) => pushRow(row, `${context.filePath}:${context.lineNumber}`),
    })
  } else {
    const payload = await readJson(sourcePath, null)
    const sourceRows = Array.isArray(payload)
      ? payload
      : ["patterns", "candidates", "rows", "rules"].flatMap((key) => (Array.isArray(payload?.[key]) ? payload[key] : []))
    if (sourceRows.length < 1) throw new Error(`catalog JSON contains no pattern rows: ${sourcePath}`)
    sourceRows.forEach((row, index) => pushRow(row, `JSON index ${index}`))
  }
  const seen = new Set()
  for (const row of rows) {
    if (seen.has(row.patternId)) throw new Error(`duplicate catalog patternId: ${row.patternId}`)
    seen.add(row.patternId)
  }
  return rows
}

const loadSupportSets = async ({ eventsPath, patternIds }) => {
  const supportByPattern = new Map([...patternIds].map((patternId) => [patternId, new Set()]))
  if (!toText(eventsPath)) return supportByPattern
  if (!fs.existsSync(eventsPath)) throw new Error(`events path not found: ${eventsPath}`)
  await iterateJsonlMaybeGzip(eventsPath, {
    strict: true,
    onRow: async (row, context) => {
      const patternId = resolvePatternId(row)
      if (!patternId) throw new Error(`event row missing patternId at ${context.filePath}:${context.lineNumber}`)
      if (!supportByPattern.has(patternId)) return
      const key = supportKey(row)
      if (!key.includes("::") || key.endsWith("::")) {
        throw new Error(`event row missing support key at ${context.filePath}:${context.lineNumber}`)
      }
      supportByPattern.get(patternId).add(key)
    },
  })
  return supportByPattern
}

class UnionFind {
  constructor(values) {
    this.parent = new Map(values.map((value) => [value, value]))
  }
  find(value) {
    const parent = this.parent.get(value)
    if (parent === value) return value
    const root = this.find(parent)
    this.parent.set(value, root)
    return root
  }
  union(left, right) {
    const leftRoot = this.find(left)
    const rightRoot = this.find(right)
    if (leftRoot !== rightRoot) this.parent.set(rightRoot, leftRoot)
  }
}

export const buildTp12PatternClusters = async ({
  catalogPath,
  eventsPath = "",
  outPath,
  summaryPath,
  tokenJaccardThreshold = 0.8,
  supportJaccardThreshold = 0.85,
} = {}) => {
  if (!toText(outPath)) throw new Error("outPath is required")
  if (!toText(summaryPath)) throw new Error("summaryPath is required")
  const patterns = await loadCatalogRows(catalogPath)
  const patternIds = patterns.map((row) => row.patternId)
  const supportByPattern = await loadSupportSets({ eventsPath, patternIds })
  const uf = new UnionFind(patternIds)
  const tokenThreshold = Math.min(1, Math.max(0, toNumber(tokenJaccardThreshold, 0.8)))
  const supportThreshold = Math.min(1, Math.max(0, toNumber(supportJaccardThreshold, 0.85)))
  const patternById = new Map(patterns.map((row) => [row.patternId, row]))
  const edgeReasonCounts = new Map()
  for (let leftIndex = 0; leftIndex < patternIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < patternIds.length; rightIndex += 1) {
      const leftId = patternIds[leftIndex]
      const rightId = patternIds[rightIndex]
      const tokenScore = jaccard(new Set(patternById.get(leftId).tokenSet), new Set(patternById.get(rightId).tokenSet))
      const supportScore = jaccard(supportByPattern.get(leftId), supportByPattern.get(rightId))
      const reasons = []
      if (tokenScore >= tokenThreshold) reasons.push("token_jaccard")
      if (supportScore >= supportThreshold) reasons.push("support_jaccard")
      if (reasons.length > 0) {
        uf.union(leftId, rightId)
        for (const reason of reasons) incrementMap(edgeReasonCounts, reason)
      }
    }
  }
  const grouped = new Map()
  for (const patternId of patternIds) {
    const root = uf.find(patternId)
    const rows = grouped.get(root) ?? []
    rows.push(patternId)
    grouped.set(root, rows)
  }
  const clusters = [...grouped.values()]
    .map((ids) => ids.sort())
    .sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]))
    .map((ids) => {
      const tokenSet = uniqueSorted(ids.flatMap((patternId) => patternById.get(patternId).tokenSet))
      const familySet = uniqueSorted(tokenSet.map(familyOf))
      const supportKeys = new Set()
      for (const patternId of ids) for (const key of supportByPattern.get(patternId) ?? []) supportKeys.add(key)
      return {
        kind: "tp12_pattern_cluster_v1",
        clusterId: stableClusterId(ids),
        patternIds: ids,
        patternCount: ids.length,
        tokenSet,
        familySet,
        supportKeyCount: supportKeys.size,
      }
    })
  await ensureDir(path.dirname(outPath))
  const stream = fs.createWriteStream(outPath, { encoding: "utf8" })
  try {
    for (const cluster of clusters) await writeJsonlRow(stream, cluster)
  } finally {
    await closeWriteStream(stream)
  }
  const summary = {
    kind: "tp12_pattern_cluster_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    catalogPath: path.resolve(catalogPath),
    eventsPath: toText(eventsPath) ? path.resolve(eventsPath) : null,
    outPath: path.resolve(outPath),
    tokenJaccardThreshold: tokenThreshold,
    supportJaccardThreshold: supportThreshold,
    patternCount: patterns.length,
    clusterCount: clusters.length,
    singletonClusterCount: clusters.filter((row) => row.patternCount === 1).length,
    maxClusterPatternCount: Math.max(...clusters.map((row) => row.patternCount)),
    edgeReasonCounts: mapToSortedObject(edgeReasonCounts),
    topClusters: clusters.slice(0, 20).map((row) => ({
      clusterId: row.clusterId,
      patternCount: row.patternCount,
      patternIds: row.patternIds,
      familySet: row.familySet,
      supportKeyCount: row.supportKeyCount,
    })),
  }
  await writeJson(summaryPath, summary)
  return summary
}
