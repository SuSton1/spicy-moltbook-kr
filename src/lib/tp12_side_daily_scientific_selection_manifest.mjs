import path from "node:path"

import { normalizeDateKey } from "./date.mjs"
import { iterateJsonl, pathExists, readJson, writeJson, writeJsonl } from "./io.mjs"
import {
  loadTp12SideDailyScientificControlPipelineSummary,
  TP12_SIDE_DAILY_SCIENTIFIC_SELECTION_MANIFEST_KIND,
} from "./tp12_side_daily_scientific_comparison.mjs"


const toText = (value) => String(value ?? "").trim()

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

const ensureDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
}

const pairKey = (symbol, decisionDateKey) => `${toText(symbol)}::${ensureDateKey(decisionDateKey, "decisionDateKey")}`

const resolveCoverageRange = (pipelineSummary, splitBucket) => {
  const featureCoverage = pipelineSummary?.effectiveCoverage?.featurePack ?? null
  if (!featureCoverage || typeof featureCoverage !== "object") {
    return null
  }
  const scopedCoverage =
    splitBucket === "train" || splitBucket === "oos"
      ? featureCoverage?.[splitBucket] ?? null
      : featureCoverage
  if (!scopedCoverage || typeof scopedCoverage !== "object") {
    return null
  }
  const decisionDateFrom = normalizeDateKey(scopedCoverage?.decisionDateFrom)
  const decisionDateTo = normalizeDateKey(scopedCoverage?.decisionDateTo)
  if (!decisionDateFrom || !decisionDateTo) {
    return null
  }
  return {
    decisionDateFrom,
    decisionDateTo,
  }
}

const parseVariantPathMap = (raw) => {
  const text = toText(raw)
  if (!text) return new Map()
  const out = new Map()
  for (const entry of text.split(";")) {
    const token = String(entry ?? "").trim()
    if (!token) continue
    const eqIndex = token.indexOf("=")
    if (eqIndex <= 0 || eqIndex >= token.length - 1) {
      throw new Error(`Invalid variant path mapping entry=${token}`)
    }
    const variantId = token.slice(0, eqIndex).trim()
    const filePath = token.slice(eqIndex + 1).trim()
    if (!variantId || !filePath) {
      throw new Error(`Invalid variant path mapping entry=${token}`)
    }
    if (out.has(variantId)) {
      throw new Error(`Duplicate variant path mapping for ${variantId}`)
    }
    out.set(variantId, filePath)
  }
  return out
}

const resolveAbsolutePath = (value, cwd) => {
  const text = toText(value)
  if (!text) return null
  return path.resolve(cwd, text)
}

const resolveOpenEvalManifestCandidatePaths = (sourcePath) => {
  const basename = path.basename(sourcePath)
  const candidates = []
  if (basename === "open_eval_manifest.json") {
    candidates.push(sourcePath)
  }
  candidates.push(path.join(sourcePath, "open_eval_manifest.json"))
  candidates.push(path.join(sourcePath, "step-perfect-prototype-open-eval-report", "open_eval_manifest.json"))
  return uniqueSorted(candidates)
}

const resolveOpenEvalSelectionSource = async ({ sourcePath, explicitSummaryPath }) => {
  for (const manifestPath of resolveOpenEvalManifestCandidatePaths(sourcePath)) {
    if (!pathExists(manifestPath)) continue
    const manifest = await readJson(manifestPath, null)
    if (!manifest || typeof manifest !== "object") continue
    const trainApplyClose28Dir = toText(manifest?.trainApplyClose28Dir)
    const oosApplyClose28Dir = toText(manifest?.oosApplyClose28Dir)
    if (!trainApplyClose28Dir || !oosApplyClose28Dir) continue
    const trainSelectionPath = path.resolve(path.dirname(manifestPath), trainApplyClose28Dir, "deduped_symbols.jsonl")
    const oosSelectionPath = path.resolve(path.dirname(manifestPath), oosApplyClose28Dir, "deduped_symbols.jsonl")
    if (!pathExists(trainSelectionPath) || !pathExists(oosSelectionPath)) {
      throw new Error(
        `Open-eval selection source is missing deduped_symbols.jsonl: manifest=${manifestPath}`,
      )
    }
    const inferredSummaryPath = path.join(path.dirname(manifestPath), "selection_guardrail_summary.json")
    const sourceSummaryPath = explicitSummaryPath
      ? explicitSummaryPath
      : pathExists(inferredSummaryPath)
        ? inferredSummaryPath
        : null
    return {
      sourceKind: "open_eval_manifest",
      sourcePath,
      sourceManifestPath: manifestPath,
      sourceSummaryPath,
      manifest,
      rowSources: [
        {
          splitBucket: "train",
          path: trainSelectionPath,
        },
        {
          splitBucket: "oos",
          path: oosSelectionPath,
        },
      ],
    }
  }
  return null
}

const resolveScientificSelectionSource = async ({
  sourcePath,
  explicitSummaryPath = null,
}) => {
  if (explicitSummaryPath && !pathExists(explicitSummaryPath)) {
    throw new Error(`Scientific selection summary path does not exist: ${explicitSummaryPath}`)
  }
  if (!pathExists(sourcePath)) {
    throw new Error(`Scientific selection source does not exist: ${sourcePath}`)
  }
  if (path.extname(sourcePath) === ".jsonl") {
    return {
      sourceKind: "jsonl",
      sourcePath,
      sourceManifestPath: null,
      sourceSummaryPath: explicitSummaryPath,
      manifest: null,
      rowSources: [
        {
          splitBucket: null,
          path: sourcePath,
        },
      ],
    }
  }
  const openEvalSource = await resolveOpenEvalSelectionSource({ sourcePath, explicitSummaryPath })
  if (openEvalSource) {
    return openEvalSource
  }
  throw new Error(
    [
      `Unsupported scientific selection source=${sourcePath}`,
      "Expected one of: exact .jsonl selected rows, open_eval_manifest.json, step-perfect-prototype-open-eval-report directory, or run directory.",
    ].join(" "),
  )
}

const materializeScientificSelectionRows = async ({
  variantId,
  selectionSource,
  outDir,
  pipelineSummary,
}) => {
  const selectionPath = path.join(outDir, `${variantId}_selected_rows.jsonl`)
  const selectionSummaryPath = path.join(outDir, `${variantId}_selected_rows_summary.json`)
  const rows = []
  const pairKeys = new Set()
  let requestedRowCount = 0
  let trimmedByEffectiveCoverage = 0
  for (const rowSource of selectionSource.rowSources) {
    const coverageRange = resolveCoverageRange(pipelineSummary, rowSource.splitBucket)
    await iterateJsonl(rowSource.path, {
      strict: true,
      onRow: async (row) => {
        requestedRowCount += 1
        const symbol = toText(row?.symbol)
        const decisionDateKey = ensureDateKey(
          row?.decisionDateKey ?? row?.recommendationDateKey ?? row?.dateKey,
          "selection decisionDateKey",
        )
        if (!symbol) {
          throw new Error(`Scientific selection row is missing symbol: ${rowSource.path}`)
        }
        if (
          coverageRange &&
          (decisionDateKey < coverageRange.decisionDateFrom || decisionDateKey > coverageRange.decisionDateTo)
        ) {
          trimmedByEffectiveCoverage += 1
          return
        }
        const joinKey = pairKey(symbol, decisionDateKey)
        if (pairKeys.has(joinKey)) {
          throw new Error(`Duplicate scientific selection pair for ${variantId}: ${joinKey}`)
        }
        pairKeys.add(joinKey)
        rows.push({
          symbol,
          decisionDateKey,
          splitBucket: rowSource.splitBucket,
        })
      },
    })
  }
  if (rows.length < 1) {
    throw new Error(`Scientific selection source resolved zero rows for variant=${variantId}`)
  }
  rows.sort((left, right) => {
    const dateCmp = String(left.decisionDateKey).localeCompare(String(right.decisionDateKey))
    if (dateCmp !== 0) return dateCmp
    return String(left.symbol).localeCompare(String(right.symbol))
  })
  await writeJsonl(selectionPath, rows)
  await writeJson(selectionSummaryPath, {
    kind: "tp12_side_daily_scientific_selected_rows_v1",
    status: "ok",
    variantId,
    sourceKind: selectionSource.sourceKind,
    sourcePath: selectionSource.sourcePath,
    sourceManifestPath: selectionSource.sourceManifestPath,
    sourceSelectionSummaryPath: selectionSource.sourceSummaryPath,
    selectionMode: toText(selectionSource.manifest?.selectionMode),
    requestedRowCount,
    rowCount: rows.length,
    trimmedByEffectiveCoverage,
    uniqueDecisionDates: uniqueSorted(rows.map((row) => row.decisionDateKey)).length,
    uniqueSymbols: uniqueSorted(rows.map((row) => row.symbol)).length,
    decisionDateFrom: rows[0]?.decisionDateKey ?? null,
    decisionDateTo: rows[rows.length - 1]?.decisionDateKey ?? null,
    rowSourcePaths: selectionSource.rowSources.map((entry) => ({
      splitBucket: entry.splitBucket,
      path: entry.path,
      effectiveCoverage: resolveCoverageRange(pipelineSummary, entry.splitBucket),
    })),
  })
  return {
    selectionPath,
    selectionSummaryPath,
  }
}

export const buildTp12SideDailyScientificSelectionManifest = async ({
  pipelineSummaryPath,
  outPath,
  variantSelectionMap = "",
  variantSelectionSummaryMap = "",
  cwd = process.cwd(),
} = {}) => {
  const pipeline = await loadTp12SideDailyScientificControlPipelineSummary({ pipelineSummaryPath, cwd })
  const selectionMap = parseVariantPathMap(variantSelectionMap)
  const selectionSummaryMap = parseVariantPathMap(variantSelectionSummaryMap)
  const expectedVariantIds = uniqueSorted(pipeline.variants.map((variant) => variant.variantId))
  const actualSelectionIds = uniqueSorted(Array.from(selectionMap.keys()))
  if (JSON.stringify(expectedVariantIds) !== JSON.stringify(actualSelectionIds)) {
    throw new Error(
      `selection variant set mismatch: expected=${JSON.stringify(expectedVariantIds)} actual=${JSON.stringify(actualSelectionIds)}`,
    )
  }
  for (const variantId of selectionSummaryMap.keys()) {
    if (!selectionMap.has(variantId)) {
      throw new Error(`selection summary provided without selection path for variant=${variantId}`)
    }
  }

  const resolvedOutPath = path.resolve(cwd, toText(outPath))
  const selectionRowsDir = path.join(path.dirname(resolvedOutPath), "selection_rows")
  const variants = []
  for (const variantId of expectedVariantIds) {
    const sourcePath = resolveAbsolutePath(selectionMap.get(variantId), cwd)
    const sourceSummaryPath = resolveAbsolutePath(selectionSummaryMap.get(variantId), cwd)
    const selectionSource = await resolveScientificSelectionSource({
      sourcePath,
      explicitSummaryPath: sourceSummaryPath,
    })
    const materialized = await materializeScientificSelectionRows({
      variantId,
      selectionSource,
      outDir: selectionRowsDir,
      pipelineSummary: pipeline.summary,
    })
    variants.push({
      variantId,
      selectionPath: materialized.selectionPath,
      selectionSummaryPath: materialized.selectionSummaryPath,
    })
  }

  const manifest = {
    kind: TP12_SIDE_DAILY_SCIENTIFIC_SELECTION_MANIFEST_KIND,
    pipelineSummaryPath: pipeline.path,
    variants,
  }
  await writeJson(resolvedOutPath, manifest)
  return {
    outPath: resolvedOutPath,
    manifest,
  }
}
