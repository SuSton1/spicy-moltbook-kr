import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"

import { createJsonlWriter, ensureDir, iterateJsonl, readJson, writeJson } from "./io.mjs"
import {
  resolveTp12Year2hitPatternId,
  sha256TextLines,
} from "./tp12_year2hit_train_gate.mjs"

const toText = (value) => String(value ?? "").trim()

export const computeFileSha256 = async (filePath) => {
  const payload = await fs.readFile(filePath)
  return createHash("sha256").update(payload).digest("hex")
}

const assertPassedTrainGate = ({ trainGateSummary, expectedGateSha256 = "" }) => {
  if (!trainGateSummary || typeof trainGateSummary !== "object") {
    throw new Error("train gate summary is required")
  }
  if (toText(trainGateSummary.status) !== "passed") {
    throw new Error(`train gate summary is not passed: ${toText(trainGateSummary.status) || "missing"}`)
  }
  const survivorPatternIds = Array.isArray(trainGateSummary.survivorPatternIds)
    ? trainGateSummary.survivorPatternIds.map((value) => toText(value)).filter(Boolean).sort()
    : (Array.isArray(trainGateSummary.survivors) ? trainGateSummary.survivors : [])
        .map((row) => toText(row?.patternId))
        .filter(Boolean)
        .sort()
  if (survivorPatternIds.length < 1) {
    throw new Error("train gate summary has zero survivor pattern IDs")
  }
  const computedSha256 = sha256TextLines(survivorPatternIds)
  const summarySha256 = toText(trainGateSummary.survivorPatternIdsSha256)
  if (summarySha256 && summarySha256 !== computedSha256) {
    throw new Error(`train gate survivor ID hash mismatch: summary=${summarySha256} computed=${computedSha256}`)
  }
  const expected = toText(expectedGateSha256)
  if (expected && expected !== computedSha256) {
    throw new Error(`expected gate sha256 mismatch: expected=${expected} actual=${computedSha256}`)
  }
  return { survivorPatternIds, survivorPatternIdsSha256: computedSha256 }
}

const readJsonCatalogRows = async ({ sourceCatalogPath, catalogArrayKey }) => {
  const payload = await readJson(sourceCatalogPath, null)
  if (payload === null) throw new Error(`source catalog not found: ${sourceCatalogPath}`)
  if (Array.isArray(payload)) {
    return { payload, rows: payload, writeMode: "json-array", catalogArrayKey: null }
  }
  if (!payload || typeof payload !== "object") {
    throw new Error(`source JSON catalog must be an object or array: ${sourceCatalogPath}`)
  }
  const requestedKey = toText(catalogArrayKey)
  if (requestedKey) {
    if (!Array.isArray(payload[requestedKey])) {
      throw new Error(`catalog array key is not an array: ${requestedKey}`)
    }
    return { payload, rows: payload[requestedKey], writeMode: "json-object", catalogArrayKey: requestedKey }
  }
  const candidateKeys = ["rules", "candidates", "patterns", "templates", "rows"].filter((key) => Array.isArray(payload[key]))
  if (candidateKeys.length !== 1) {
    throw new Error(
      `JSON catalog requires --catalog-array-key when exactly one known array is not present: keys=${candidateKeys.join(",") || "none"}`,
    )
  }
  return { payload, rows: payload[candidateKeys[0]], writeMode: "json-object", catalogArrayKey: candidateKeys[0] }
}

const buildRowLookup = (rows) => {
  const lookup = new Map()
  const duplicateIds = new Set()
  const missingIdRows = []
  for (const [index, row] of rows.entries()) {
    const patternId = resolveTp12Year2hitPatternId(row)
    if (!patternId) {
      missingIdRows.push(index)
      continue
    }
    if (lookup.has(patternId)) duplicateIds.add(patternId)
    lookup.set(patternId, row)
  }
  if (missingIdRows.length > 0) {
    throw new Error(`source catalog has rows without pattern/rule ID: count=${missingIdRows.length}`)
  }
  if (duplicateIds.size > 0) {
    throw new Error(`source catalog has duplicate pattern/rule IDs: ${[...duplicateIds].sort().join(",")}`)
  }
  return lookup
}

const writeFilteredJsonCatalog = async ({ source, outCatalogPath, gatedRows, gateDetails }) => {
  if (source.writeMode === "json-array") {
    await writeJson(outCatalogPath, gatedRows)
    return
  }
  const payload = {
    ...source.payload,
    [source.catalogArrayKey]: gatedRows,
    year2hitGate: {
      kind: "tp12_year2hit_gated_catalog_metadata_v1",
      survivorPatternIdsSha256: gateDetails.survivorPatternIdsSha256,
      survivorCount: gateDetails.survivorPatternIds.length,
      generatedAt: new Date().toISOString(),
    },
  }
  await writeJson(outCatalogPath, payload)
}

export const buildTp12Year2hitGatedCatalog = async ({
  sourceCatalogPath,
  trainGateSummaryPath,
  outCatalogPath,
  outManifestPath = null,
  catalogArrayKey = "",
  expectedGateSha256 = "",
} = {}) => {
  if (!toText(sourceCatalogPath)) throw new Error("sourceCatalogPath is required")
  if (!toText(trainGateSummaryPath)) throw new Error("trainGateSummaryPath is required")
  if (!toText(outCatalogPath)) throw new Error("outCatalogPath is required")
  const sourcePath = path.resolve(sourceCatalogPath)
  const gatePath = path.resolve(trainGateSummaryPath)
  const outputPath = path.resolve(outCatalogPath)
  const manifestPath = outManifestPath ? path.resolve(outManifestPath) : path.join(path.dirname(outputPath), "gated_catalog_manifest.json")
  const trainGateSummary = await readJson(gatePath, null)
  const gateDetails = assertPassedTrainGate({ trainGateSummary, expectedGateSha256 })
  const survivorSet = new Set(gateDetails.survivorPatternIds)
  const sourceIsJsonl = sourcePath.endsWith(".jsonl")
  const sourceRows = []
  if (sourceIsJsonl) {
    await iterateJsonl(sourcePath, {
      strict: true,
      onRow: async (row) => {
        sourceRows.push(row)
      },
    })
  }
  const source = sourceIsJsonl
    ? { rows: sourceRows, writeMode: "jsonl", catalogArrayKey: null, payload: null }
    : await readJsonCatalogRows({ sourceCatalogPath: sourcePath, catalogArrayKey })
  const lookup = buildRowLookup(source.rows)
  const missingSurvivorIds = gateDetails.survivorPatternIds.filter((patternId) => !lookup.has(patternId))
  if (missingSurvivorIds.length > 0) {
    throw new Error(`train gate survivors not found in source catalog: ${missingSurvivorIds.join(",")}`)
  }
  const gatedRows = gateDetails.survivorPatternIds.map((patternId) => lookup.get(patternId))
  await ensureDir(path.dirname(outputPath))
  if (source.writeMode === "jsonl") {
    const writer = await createJsonlWriter(outputPath)
    try {
      for (const row of gatedRows) await writer.writeRow(row)
    } finally {
      await writer.close()
    }
  } else {
    await writeFilteredJsonCatalog({ source, outCatalogPath: outputPath, gatedRows, gateDetails })
  }
  const manifest = {
    kind: "tp12_year2hit_gated_catalog_manifest_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    sourceCatalogPath: sourcePath,
    sourceCatalogSha256: await computeFileSha256(sourcePath),
    trainGateSummaryPath: gatePath,
    trainGateSummarySha256: await computeFileSha256(gatePath),
    outCatalogPath: outputPath,
    outCatalogSha256: await computeFileSha256(outputPath),
    catalogArrayKey: source.catalogArrayKey,
    survivorPatternIdsSha256: gateDetails.survivorPatternIdsSha256,
    sourcePatternCount: source.rows.length,
    gatedPatternCount: gatedRows.length,
    survivorCount: gateDetails.survivorPatternIds.length,
    gatedPatternIds: gateDetails.survivorPatternIds,
  }
  await writeJson(manifestPath, manifest)
  return { manifest, gatedRows }
}
