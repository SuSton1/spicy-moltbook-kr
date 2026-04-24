import path from "node:path"

import { createJsonlWriter, ensureDir, iterateJsonl, readJson, writeJson } from "./io.mjs"
import { computeFileSha256 } from "./tp12_year2hit_gated_catalog.mjs"
import { resolveTp12Year2hitPatternId, sha256TextLines } from "./tp12_year2hit_train_gate.mjs"
import { iterateJsonlMaybeGzip, toText, uniqueSorted } from "./tp12_year2hit_foundation_io.mjs"

const readCatalogRows = async (catalogPath) => {
  const rows = []
  const text = toText(catalogPath)
  if (text.endsWith(".jsonl") || text.endsWith(".jsonl.gz")) {
    const iterator = text.endsWith(".jsonl.gz") ? iterateJsonlMaybeGzip : iterateJsonl
    await iterator(text, {
      strict: true,
      onRow: async (row) => rows.push(row),
    })
    return rows
  }
  const payload = await readJson(text, null)
  if (!payload) throw new Error(`candidate catalog not found: ${text}`)
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== "object") {
    throw new Error(`candidate catalog must be JSONL, JSON array, or JSON object: ${text}`)
  }
  const sourceRows = ["candidates", "patterns", "rules", "templates", "rows"]
    .flatMap((key) => (Array.isArray(payload[key]) ? payload[key] : []))
  if (sourceRows.length < 1) {
    throw new Error(`candidate catalog JSON contains no known row array: ${text}`)
  }
  return sourceRows
}

const buildCatalogMap = async (candidateCatalogPath) => {
  const rows = await readCatalogRows(candidateCatalogPath)
  const lookup = new Map()
  const duplicatePatternIds = new Set()
  for (const [index, row] of rows.entries()) {
    const patternId = resolveTp12Year2hitPatternId(row)
    if (!patternId) {
      throw new Error(`candidate catalog row missing pattern/rule ID at index ${index}`)
    }
    if (lookup.has(patternId)) duplicatePatternIds.add(patternId)
    lookup.set(patternId, { ...row, patternId })
  }
  if (duplicatePatternIds.size > 0) {
    throw new Error(`candidate catalog has duplicate pattern IDs: ${[...duplicatePatternIds].sort().join(",")}`)
  }
  return { lookup, sourcePatternCount: rows.length }
}

const assertPassedQualityGate = (summary) => {
  if (!summary || typeof summary !== "object") throw new Error("quality gate summary is required")
  if (toText(summary.status) !== "passed") {
    throw new Error(`quality gate summary is not passed: ${toText(summary.status) || "missing"}`)
  }
  const passed = Array.isArray(summary.passed) ? summary.passed : []
  if (passed.length < 1) throw new Error("quality gate summary has zero passed rows")
  const passedPatternIds = uniqueSorted(
    Array.isArray(summary.passedPatternIds)
      ? summary.passedPatternIds
      : passed.map((row) => row?.patternId),
  )
  if (passedPatternIds.length !== passed.length) {
    throw new Error(`quality gate passed row/ID count mismatch: rows=${passed.length} ids=${passedPatternIds.length}`)
  }
  const passedPatternIdsSha256 = sha256TextLines(passedPatternIds)
  const summarySha256 = toText(summary.passedPatternIdsSha256 || summary.survivorPatternIdsSha256)
  if (!summarySha256) throw new Error("quality gate summary is missing passedPatternIdsSha256")
  if (summarySha256 !== passedPatternIdsSha256) {
    throw new Error(`quality gate passed ID hash mismatch: summary=${summarySha256} computed=${passedPatternIdsSha256}`)
  }
  if (Number(summary.passedSurvivorCount ?? passed.length) !== passed.length) {
    throw new Error(`quality gate passed count mismatch: summary=${summary.passedSurvivorCount} rows=${passed.length}`)
  }
  return { passed, passedPatternIds, passedPatternIdsSha256 }
}

const normalizeSurvivorRow = ({ qualityRow, catalogRow, freezePolicyId }) => {
  const patternId = toText(qualityRow?.patternId)
  if (!patternId) throw new Error("quality survivor row missing patternId")
  const tokenSet = uniqueSorted(
    catalogRow?.tokenSet ?? catalogRow?.tokens ?? qualityRow?.tokenSet ?? qualityRow?.tokens ?? [],
  )
  if (tokenSet.length < 1) throw new Error(`survivor ${patternId} has empty tokenSet`)
  return {
    kind: "tp12_year2hit_frozen_survivor_pattern_v1",
    patternId,
    freezePolicyId,
    status: "train_survivor_quality_passed",
    year2hitPassed: true,
    qualityPassed: true,
    patternKind: catalogRow?.patternKind ?? qualityRow?.patternKind ?? null,
    tokenSet,
    tokenCount: tokenSet.length,
    sourceCandidate: {
      patternId,
      status: catalogRow?.status ?? null,
      qualityPassed: catalogRow?.qualityPassed === true || toText(catalogRow?.status) === "quality_seed_passed",
      year2hitPassed: catalogRow?.year2hitPassed === true,
      patternKind: catalogRow?.patternKind ?? null,
    },
    trainMetrics: {
      matchRows: Number(qualityRow?.matchRows ?? 0),
      hitRows: Number(qualityRow?.hitRows ?? 0),
      rowPrecision: Number(qualityRow?.rowPrecision ?? 0),
      matchedDateCount: Number(qualityRow?.matchedDateCount ?? 0),
      hitDateCount: Number(qualityRow?.hitDateCount ?? 0),
      datePrecision: Number(qualityRow?.datePrecision ?? 0),
      uniqueMatchedSymbols: Number(qualityRow?.uniqueMatchedSymbols ?? 0),
      uniqueHitSymbols: Number(qualityRow?.uniqueHitSymbols ?? 0),
      top1HitDateShare: Number(qualityRow?.top1HitDateShare ?? 0),
      top1MatchDateShare: Number(qualityRow?.top1MatchDateShare ?? 0),
    },
    ruleSpec: {
      type: "token_conjunction",
      tokens: tokenSet,
    },
  }
}

export const freezeTp12Year2hitSurvivorCatalog = async ({
  candidateCatalogPath,
  qualityGateSummaryPath,
  outCatalogPath,
  outManifestPath = null,
  freezePolicyId = "tp12_train_quality_survivor_freeze_v1",
} = {}) => {
  if (!toText(candidateCatalogPath)) throw new Error("candidateCatalogPath is required")
  if (!toText(qualityGateSummaryPath)) throw new Error("qualityGateSummaryPath is required")
  if (!toText(outCatalogPath)) throw new Error("outCatalogPath is required")
  const sourcePath = path.resolve(candidateCatalogPath)
  const qualityPath = path.resolve(qualityGateSummaryPath)
  const outputPath = path.resolve(outCatalogPath)
  const manifestPath = outManifestPath
    ? path.resolve(outManifestPath)
    : path.join(path.dirname(outputPath), "survivor_catalog_manifest.json")
  const qualityGateSummary = await readJson(qualityPath, null)
  const { passed, passedPatternIds, passedPatternIdsSha256 } = assertPassedQualityGate(qualityGateSummary)
  const { lookup, sourcePatternCount } = await buildCatalogMap(sourcePath)
  const missingCandidatePatternIds = passedPatternIds.filter((patternId) => !lookup.has(patternId))
  if (missingCandidatePatternIds.length > 0) {
    throw new Error(`quality survivors missing from candidate catalog: ${missingCandidatePatternIds.join(",")}`)
  }
  const passedByPatternId = new Map(passed.map((row) => [toText(row?.patternId), row]))
  const survivorRows = passedPatternIds.map((patternId) =>
    normalizeSurvivorRow({
      qualityRow: passedByPatternId.get(patternId),
      catalogRow: lookup.get(patternId),
      freezePolicyId,
    }),
  )
  await ensureDir(path.dirname(outputPath))
  const writer = await createJsonlWriter(outputPath)
  try {
    for (const row of survivorRows) await writer.writeRow(row)
  } finally {
    await writer.close()
  }
  const manifest = {
    kind: "tp12_year2hit_survivor_catalog_manifest_v1",
    generatedAt: new Date().toISOString(),
    status: "passed",
    freezePolicyId,
    sourceCandidateCatalogPath: sourcePath,
    sourceCandidateCatalogSha256: await computeFileSha256(sourcePath),
    qualityGateSummaryPath: qualityPath,
    qualityGateSummarySha256: await computeFileSha256(qualityPath),
    outCatalogPath: outputPath,
    outCatalogSha256: await computeFileSha256(outputPath),
    sourcePatternCount,
    survivorCount: survivorRows.length,
    survivorPatternIds: passedPatternIds,
    survivorPatternIdsSha256: passedPatternIdsSha256,
    rejectedByQualityCount: Number(qualityGateSummary.rejectedSurvivorCount ?? 0),
  }
  await writeJson(manifestPath, manifest)
  return { manifest, survivorRows }
}
