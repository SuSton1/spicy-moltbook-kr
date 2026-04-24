#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { createJsonlWriter, ensureDir, iterateJsonl, pathExists, writeJson } from "../src/lib/io.mjs"

const DEFAULT_PATCH_KEY = "tp12_year2hit_executable_zero_fp_tile_pool_audit_v1"

const toText = (value) => (value === null || value === undefined ? "" : String(value))

const toNumber = (value, defaultValue = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

const parseCliArgs = (argv) => {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "")
    if (!token.startsWith("--")) continue
    const body = token.slice(2)
    const eqIndex = body.indexOf("=")
    if (eqIndex >= 0) {
      flags[body.slice(0, eqIndex)] = body.slice(eqIndex + 1)
      continue
    }
    const next = argv[index + 1]
    if (next !== undefined && !String(next).startsWith("--")) {
      flags[body] = String(next)
      index += 1
    } else {
      flags[body] = true
    }
  }
  return { flags }
}

const getFlag = (flags, key, defaultValue = "") => {
  const value = flags[key]
  return value === undefined || value === null ? defaultValue : value
}

const requirePathFlag = (flags, key, cwd) => {
  const value = toText(getFlag(flags, key, "")).trim()
  if (!value) throw new Error(`--${key} is required`)
  const resolved = path.resolve(cwd, value)
  if (!pathExists(resolved)) throw new Error(`${key} not found: ${resolved}`)
  return resolved
}

const readJsonlRowsStrict = async (filePath, label) => {
  const rows = []
  await iterateJsonl(filePath, {
    strict: true,
    onRow: async (row) => {
      rows.push(row)
    },
  })
  if (rows.length < 1) throw new Error(`${label} produced zero rows: ${filePath}`)
  return rows
}

const medianOf = (values) => {
  const sorted = values.map((value) => toNumber(value, NaN)).filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length < 1) return 0
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

const minOf = (values) => {
  const finite = values.map((value) => toNumber(value, NaN)).filter(Number.isFinite)
  return finite.length > 0 ? Math.min(...finite) : 0
}

const maxOf = (values) => {
  const finite = values.map((value) => toNumber(value, NaN)).filter(Number.isFinite)
  return finite.length > 0 ? Math.max(...finite) : 0
}

const countBy = (rows, keyFn) => {
  const counts = new Map()
  for (const row of rows) {
    const key = keyFn(row)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Object.fromEntries(
    [...counts.entries()].sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  )
}

const hitCountsByYear = (tile, key) => {
  const raw = tile?.metrics?.[key]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
  return Object.values(raw).map((value) => toNumber(value, 0))
}

const positiveYearCount = (tile, key = "hitDatesByYear") => hitCountsByYear(tile, key).filter((count) => count > 0).length

const minPositiveYearCount = (tile, key = "hitDatesByYear") => {
  const counts = hitCountsByYear(tile, key)
  return counts.length > 0 ? Math.min(...counts) : 0
}

const stableTileScore = (tile) =>
  positiveYearCount(tile) * 100000 +
  (tile?.metrics?.year2hitPassed === true ? 10000 : 0) +
  toNumber(tile?.metrics?.minHitDatesPerYear, 0) * 1000 +
  toNumber(tile?.metrics?.matchRows, 0) * 10 +
  toNumber(tile?.metrics?.totalHitSymbolDates, 0)

const stableCandidate = (tile, thresholds) => {
  if (toNumber(tile?.metrics?.falsePositiveRows, 1) > 0) return false
  if (toNumber(tile?.metrics?.matchRows, 0) < thresholds.minMatchRows) return false
  if (toNumber(tile?.metrics?.hitRows, 0) < thresholds.minHitRows) return false
  if (positiveYearCount(tile, "hitDatesByYear") < thresholds.minPositiveYears) return false
  if (positiveYearCount(tile, "hitSymbolDatesByYear") < thresholds.minPositiveSymbolDateYears) return false
  if (thresholds.requireYear2Hit && tile?.metrics?.year2hitPassed !== true) return false
  return true
}

export const buildTp12ExecutableZeroFpTilePoolAudit = async ({
  tilesPath,
  outDir,
  patchKey = DEFAULT_PATCH_KEY,
  thresholds = {},
}) => {
  const resolvedThresholds = {
    minMatchRows: toNumber(thresholds.minMatchRows, 10),
    minHitRows: toNumber(thresholds.minHitRows, 10),
    minPositiveYears: toNumber(thresholds.minPositiveYears, 2),
    minPositiveSymbolDateYears: toNumber(thresholds.minPositiveSymbolDateYears, 2),
    requireYear2Hit: thresholds.requireYear2Hit === true,
  }
  const tiles = await readJsonlRowsStrict(tilesPath, "tile pool")
  await ensureDir(outDir)
  const outputPaths = {
    summary: path.join(outDir, "tile_pool_audit_summary.json"),
    stableTileCandidates: path.join(outDir, "stable_tile_candidates.jsonl"),
  }

  const stableTiles = tiles
    .filter((tile) => stableCandidate(tile, resolvedThresholds))
    .sort(
      (left, right) =>
        stableTileScore(right) - stableTileScore(left) ||
        toText(left.tileId).localeCompare(toText(right.tileId)),
    )

  const writer = await createJsonlWriter(outputPaths.stableTileCandidates)
  try {
    for (const tile of stableTiles) await writer.writeRow(tile)
  } finally {
    await writer.close()
  }

  const summary = {
    kind: "tp12_executable_zero_fp_tile_pool_audit_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "completed",
    patchKey,
    inputs: {
      tilesPath,
      thresholds: resolvedThresholds,
    },
    tilePoolCount: tiles.length,
    stableTileCandidateCount: stableTiles.length,
    distributions: {
      baseType: countBy(tiles, (tile) => toText(tile?.baseType) || "unknown"),
      positiveYears: countBy(tiles, (tile) => String(positiveYearCount(tile))),
      positiveSymbolDateYears: countBy(tiles, (tile) => String(positiveYearCount(tile, "hitSymbolDatesByYear"))),
      year2HitPassed: countBy(tiles, (tile) => String(tile?.metrics?.year2hitPassed === true)),
      matchRowsBucket: countBy(tiles, (tile) => {
        const matchRows = toNumber(tile?.metrics?.matchRows, 0)
        if (matchRows < 8) return "lt8"
        if (matchRows < 10) return "8_9"
        if (matchRows < 16) return "10_15"
        if (matchRows < 24) return "16_23"
        return "ge24"
      }),
    },
    metrics: {
      matchRows: {
        min: minOf(tiles.map((tile) => tile?.metrics?.matchRows)),
        median: medianOf(tiles.map((tile) => tile?.metrics?.matchRows)),
        max: maxOf(tiles.map((tile) => tile?.metrics?.matchRows)),
      },
      positiveYears: {
        min: minOf(tiles.map((tile) => positiveYearCount(tile))),
        median: medianOf(tiles.map((tile) => positiveYearCount(tile))),
        max: maxOf(tiles.map((tile) => positiveYearCount(tile))),
      },
    },
    thresholdDiagnostics: {
      minPositiveYearsGe2: tiles.filter((tile) => positiveYearCount(tile) >= 2).length,
      minPositiveYearsGe3: tiles.filter((tile) => positiveYearCount(tile) >= 3).length,
      year2HitPassed: tiles.filter((tile) => tile?.metrics?.year2hitPassed === true).length,
      matchRowsGe10: tiles.filter((tile) => toNumber(tile?.metrics?.matchRows, 0) >= 10).length,
      matchRowsGe10AndPositiveYearsGe2: tiles.filter(
        (tile) => toNumber(tile?.metrics?.matchRows, 0) >= 10 && positiveYearCount(tile) >= 2,
      ).length,
      matchRowsGe10AndYear2HitPassed: tiles.filter(
        (tile) => toNumber(tile?.metrics?.matchRows, 0) >= 10 && tile?.metrics?.year2hitPassed === true,
      ).length,
    },
    topStableTiles: stableTiles.slice(0, 20).map((tile) => ({
      tileId: toText(tile?.tileId),
      baseType: toText(tile?.baseType),
      baseId: toText(tile?.baseId),
      metrics: tile?.metrics ?? {},
    })),
    outputPaths,
  }
  await writeJson(outputPaths.summary, summary)
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        tilePoolCount: summary.tilePoolCount,
        stableTileCandidateCount: summary.stableTileCandidateCount,
        thresholdDiagnostics: summary.thresholdDiagnostics,
        summaryPath: outputPaths.summary,
      },
      null,
      2,
    ),
  )
  return summary
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const { flags } = parseCliArgs(argv)
  const tilesPath = requirePathFlag(flags, "tiles", cwd)
  const outDirValue = toText(getFlag(flags, "out-dir", "")).trim()
  if (!outDirValue) throw new Error("--out-dir is required")
  const outDir = path.resolve(cwd, outDirValue)
  const patchKey = toText(getFlag(flags, "patch-key", DEFAULT_PATCH_KEY)).trim() || DEFAULT_PATCH_KEY
  return buildTp12ExecutableZeroFpTilePoolAudit({
    tilesPath,
    outDir,
    patchKey,
    thresholds: {
      minMatchRows: getFlag(flags, "min-match-rows", 10),
      minHitRows: getFlag(flags, "min-hit-rows", 10),
      minPositiveYears: getFlag(flags, "min-positive-years", 2),
      minPositiveSymbolDateYears: getFlag(flags, "min-positive-symbol-date-years", 2),
      requireYear2Hit:
        String(getFlag(flags, "require-year2-hit", "false")).toLowerCase() === "true",
    },
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
