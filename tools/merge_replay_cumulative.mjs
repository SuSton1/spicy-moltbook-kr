#!/usr/bin/env node

import { createHash } from "node:crypto"
import path from "node:path"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import fs from "node:fs"

const [, , outputPathArg = "", maxLinesArg = "", ...sourceArgs] = process.argv

const safeOutputPath = String(outputPathArg ?? "").trim()
const safeMaxLines = Math.max(1, Number.parseInt(String(maxLinesArg ?? "0"), 10) || 0)

if (!safeOutputPath || safeMaxLines < 1) {
  console.error("usage: merge_replay_cumulative.mjs <output_path> <max_lines> [source...]")
  process.exit(1)
}

const sourcePaths = sourceArgs
  .map((value) => String(value ?? "").trim())
  .filter((value) => value && fs.existsSync(value))

const ensureDir = async (targetPath) => {
  await mkdir(path.dirname(targetPath), { recursive: true })
}

const deriveIndexPath = (outputPath) => {
  const dir = path.dirname(outputPath)
  const base = path.basename(outputPath)
  if (base.endsWith("_cumulative.jsonl")) {
    return path.join(dir, base.replace("_cumulative.jsonl", "_index.json"))
  }
  if (base.endsWith(".jsonl")) {
    return path.join(dir, `${base.slice(0, -6)}_index.json`)
  }
  return path.join(dir, `${base}_index.json`)
}

const parseJsonl = async (filePath) => {
  const content = await readFile(filePath, "utf8")
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

const normalizeCandidateRole = (row) => {
  const explicit = String(row?.candidateRole ?? "").trim().toUpperCase()
  if (explicit) return explicit
  if (row?.executedByPolicy === true) return "EXECUTED"
  if (row?.selectedByPolicy === true) return "PICK"
  if (row?.top1Candidate === true) return "TOP1"
  return "UNKNOWN"
}

const buildSemanticReplayKey = (row) => {
  const decisionDateKey = String(row?.decisionDateKey ?? "").trim()
  const symbol = String(row?.symbol ?? "").trim().toUpperCase()
  const role = normalizeCandidateRole(row)
  if (decisionDateKey && symbol) {
    return `${decisionDateKey}::${role}::${symbol}`
  }
  return `RAW::${createHash("sha1").update(JSON.stringify(row ?? null)).digest("hex")}`
}

const normalizeReplayRow = (row) => {
  const normalized = {
    ...(row && typeof row === "object" ? row : {}),
    decisionDateKey: String(row?.decisionDateKey ?? "").trim(),
    symbol: String(row?.symbol ?? "").trim().toUpperCase(),
    candidateRole: normalizeCandidateRole(row),
  }
  return normalized
}

const main = async () => {
  await ensureDir(safeOutputPath)
  const indexPath = deriveIndexPath(safeOutputPath)
  await ensureDir(indexPath)

  if (sourcePaths.length < 1) {
    await writeFile(safeOutputPath, "")
    await writeFile(
      indexPath,
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        rowCount: 0,
        maxLines: safeMaxLines,
        rows: [],
      }, null, 2),
    )
    return
  }

  const mergedByKey = new Map()
  let order = 0
  for (const sourcePath of sourcePaths) {
    const rows = await parseJsonl(sourcePath)
    for (const rawRow of rows) {
      const normalizedRow = normalizeReplayRow(rawRow)
      const semanticKey = buildSemanticReplayKey(normalizedRow)
      order += 1
      mergedByKey.set(semanticKey, {
        key: semanticKey,
        order,
        row: normalizedRow,
      })
    }
  }

  const dedupedRows = Array.from(mergedByKey.values())
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
    .slice(-safeMaxLines)

  const jsonlPayload = dedupedRows
    .map((entry) => JSON.stringify(entry.row))
    .join("\n")

  await writeFile(safeOutputPath, jsonlPayload ? `${jsonlPayload}\n` : "")
  await writeFile(
    indexPath,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      rowCount: dedupedRows.length,
      maxLines: safeMaxLines,
      rows: dedupedRows.map((entry) => entry.row),
    }, null, 2),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
