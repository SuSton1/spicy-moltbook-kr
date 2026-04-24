import fs from "node:fs"
import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  closeWriteStream,
  iterateJsonlMaybeGzip,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"

const rowDateKey = (row) => toText(row?.decisionDateKey ?? row?.dateKey)
const rowSymbol = (row) => toText(row?.symbol).toUpperCase()
const keyOf = (symbol, decisionDateKey) => `${decisionDateKey}\t${symbol}`

const CONTEXT_KEY_FIELDS = new Set(["kind", "symbol", "decisionDateKey", "dateKey"])

const loadContextRows = async (contextPath) => {
  const byKey = new Map()
  let contextRowCount = 0
  await iterateJsonlMaybeGzip(contextPath, {
    strict: true,
    onRow: async (row, context) => {
      contextRowCount += 1
      const symbol = rowSymbol(row)
      const decisionDateKey = rowDateKey(row)
      if (!symbol) throw new Error(`context row missing symbol at ${context.filePath}:${context.lineNumber}`)
      if (!validDateKey(decisionDateKey)) {
        throw new Error(`context row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
      }
      const key = keyOf(symbol, decisionDateKey)
      if (byKey.has(key)) throw new Error(`duplicate context row for symbol/date: ${decisionDateKey}::${symbol}`)
      byKey.set(key, row)
    },
  })
  if (contextRowCount < 1) throw new Error(`context source produced zero rows: ${contextPath}`)
  return { byKey, contextRowCount }
}

const contextPayload = ({ consensusRow, contextRow, sourceLabel }) => {
  const payload = {}
  for (const [field, value] of Object.entries(contextRow)) {
    if (CONTEXT_KEY_FIELDS.has(field)) continue
    if (Object.prototype.hasOwnProperty.call(consensusRow, field)) {
      throw new Error(`context field collision at ${sourceLabel}: ${field}`)
    }
    payload[field] = value
  }
  return payload
}

export const buildTp12ContextConsensusFeatures = async ({
  consensusPath,
  contextPath,
  outPath,
  summaryPath,
  foldId = "",
} = {}) => {
  if (!toText(consensusPath)) throw new Error("consensusPath is required")
  if (!fs.existsSync(consensusPath)) throw new Error(`consensus path not found: ${consensusPath}`)
  if (!toText(contextPath)) throw new Error("contextPath is required")
  if (!fs.existsSync(contextPath)) throw new Error(`context path not found: ${contextPath}`)
  if (!toText(outPath)) throw new Error("outPath is required")
  if (!toText(summaryPath)) throw new Error("summaryPath is required")
  const requestedFoldId = toText(foldId)
  const { byKey: contextByKey, contextRowCount } = await loadContextRows(contextPath)
  await ensureDir(path.dirname(outPath))
  const stream = fs.createWriteStream(outPath, { encoding: "utf8" })
  let consensusRowCount = 0
  let outputRowCount = 0
  let hitRows = 0
  const contextFieldNames = new Set()
  const missingSamples = []
  try {
    await iterateJsonlMaybeGzip(consensusPath, {
      strict: true,
      onRow: async (row, context) => {
        consensusRowCount += 1
        const symbol = rowSymbol(row)
        const decisionDateKey = rowDateKey(row)
        if (!symbol) throw new Error(`consensus row missing symbol at ${context.filePath}:${context.lineNumber}`)
        if (!validDateKey(decisionDateKey)) {
          throw new Error(`consensus row invalid decisionDateKey at ${context.filePath}:${context.lineNumber}: ${decisionDateKey || "missing"}`)
        }
        if (!Object.prototype.hasOwnProperty.call(row, "hitTarget")) {
          throw new Error(`consensus row missing hitTarget at ${context.filePath}:${context.lineNumber}`)
        }
        const key = keyOf(symbol, decisionDateKey)
        const contextRow = contextByKey.get(key)
        if (!contextRow) {
          if (missingSamples.length < 20) missingSamples.push({ symbol, decisionDateKey })
          return
        }
        if (requestedFoldId && row.foldId && toText(row.foldId) !== requestedFoldId) {
          throw new Error(`consensus row foldId mismatch at ${context.filePath}:${context.lineNumber}: expected ${requestedFoldId} got ${row.foldId}`)
        }
        const appended = contextPayload({
          consensusRow: row,
          contextRow,
          sourceLabel: `${context.filePath}:${context.lineNumber}`,
        })
        for (const field of Object.keys(appended)) contextFieldNames.add(field)
        const output = {
          ...row,
          ...appended,
          kind: "tp12_context_consensus_feature_v1",
        }
        if (requestedFoldId) output.foldId = requestedFoldId
        if (output.hitTarget === true) hitRows += 1
        outputRowCount += 1
        await writeJsonlRow(stream, output)
      },
    })
  } finally {
    await closeWriteStream(stream)
  }
  const missingContextRowCount = consensusRowCount - outputRowCount
  const failures = []
  if (missingContextRowCount > 0) failures.push(`missing_context_rows:${missingContextRowCount}`)
  const summary = {
    kind: "tp12_context_consensus_feature_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    consensusPath: path.resolve(consensusPath),
    contextPath: path.resolve(contextPath),
    outPath: path.resolve(outPath),
    foldId: requestedFoldId || null,
    contextRowCount,
    consensusRowCount,
    outputRowCount,
    hitRows,
    missingContextRowCount,
    missingSamples,
    contextFieldNames: [...contextFieldNames].sort(),
    failures,
  }
  await writeJson(summaryPath, summary)
  if (failures.length > 0) throw new Error(`tp12 context consensus join failed: ${failures.join("; ")}`)
  return summary
}
