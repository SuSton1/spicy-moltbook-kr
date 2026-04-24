#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { createJsonlWriter, ensureDir, iterateJsonl, pathExists, writeJson } from "../src/lib/io.mjs"

const DEFAULT_PATCH_KEY = "tp12_year2hit_executable_global_greedy_stability_audit_v1"

const toText = (value) => (value === null || value === undefined ? "" : String(value))

const toNumber = (value, defaultValue = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

const safeRatio = (numerator, denominator) => {
  const den = toNumber(denominator, 0)
  if (den <= 0) return 0
  return toNumber(numerator, 0) / den
}

const parseCliArgs = (argv) => {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith("--")) continue
    const raw = arg.slice(2)
    const eqIndex = raw.indexOf("=")
    if (eqIndex >= 0) {
      const key = raw.slice(0, eqIndex)
      const value = raw.slice(eqIndex + 1)
      flags[key] = value
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      flags[raw] = next
      index += 1
    } else {
      flags[raw] = true
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
  return path.resolve(cwd, value)
}

const optionalPathFlag = (flags, key, cwd) => {
  const value = toText(getFlag(flags, key, "")).trim()
  return value ? path.resolve(cwd, value) : ""
}

const requireExistingFile = (filePath, label) => {
  if (!pathExists(filePath)) throw new Error(`${label} not found: ${filePath}`)
}

const readJsonlRowsStrict = async (filePath, label) => {
  requireExistingFile(filePath, label)
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

const sumOf = (values) => values.reduce((sum, value) => sum + toNumber(value, 0), 0)

const yearCounts = (metrics, key) => {
  const raw = metrics?.[key]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
  return Object.values(raw).map((value) => toNumber(value, 0))
}

const positiveYearCount = (metrics, key) => yearCounts(metrics, key).filter((count) => count > 0).length

const minYearCount = (metrics, key) => {
  const counts = yearCounts(metrics, key)
  return counts.length > 0 ? Math.min(...counts) : 0
}

const uniqueCount = (values) => new Set(values.map(toText).filter(Boolean)).size

const atomTypeOf = (atom) => toText(atom?.type)

const isExtremeFeatureRankAtom = (atom) => {
  if (atomTypeOf(atom) !== "feature_rank") return false
  const threshold = toNumber(atom?.threshold, NaN)
  return Number.isFinite(threshold) && (threshold <= 0.05 || threshold >= 0.95)
}

const atomsOfTile = (tile) => ({
  includeAtoms: Array.isArray(tile?.includeAtoms) ? tile.includeAtoms : [],
  vetoAtoms: Array.isArray(tile?.vetoAtoms) ? tile.vetoAtoms : [],
})

const buildTileDiagnostics = (cover) => {
  const tiles = Array.isArray(cover?.tiles) ? cover.tiles : []
  if (tiles.length < 1) {
    throw new Error(`cover has no tiles for stability audit: ${toText(cover?.coverId)}`)
  }

  const matchRows = tiles.map((tile) => toNumber(tile?.metrics?.matchRows, 0))
  const hitRows = tiles.map((tile) => toNumber(tile?.metrics?.hitRows, 0))
  const falsePositiveRows = tiles.map((tile) => toNumber(tile?.metrics?.falsePositiveRows, 0))
  const tileYearCoverageCounts = tiles.map((tile) => positiveYearCount(tile?.metrics, "hitDatesByYear"))
  const tileMinHitDatesByYear = tiles.map((tile) => minYearCount(tile?.metrics, "hitDatesByYear"))
  const tileMinHitSymbolDatesByYear = tiles.map((tile) => minYearCount(tile?.metrics, "hitSymbolDatesByYear"))

  let includeAtomCount = 0
  let vetoAtomCount = 0
  let featureRankAtomCount = 0
  let extremeFeatureRankAtomCount = 0
  let patternIncludeAtomCount = 0
  let clusterIncludeAtomCount = 0
  let tokenIncludeAtomCount = 0
  let familyIncludeAtomCount = 0
  for (const tile of tiles) {
    const { includeAtoms, vetoAtoms } = atomsOfTile(tile)
    includeAtomCount += includeAtoms.length
    vetoAtomCount += vetoAtoms.length
    for (const atom of [...includeAtoms, ...vetoAtoms]) {
      const type = atomTypeOf(atom)
      if (type === "feature_rank") featureRankAtomCount += 1
      if (isExtremeFeatureRankAtom(atom)) extremeFeatureRankAtomCount += 1
      if (type === "pattern_include") patternIncludeAtomCount += 1
      if (type === "cluster_include") clusterIncludeAtomCount += 1
      if (type === "token_include") tokenIncludeAtomCount += 1
      if (type === "family_include") familyIncludeAtomCount += 1
    }
  }

  const totalAtomCount = includeAtomCount + vetoAtomCount
  const baseKeys = tiles.map((tile) => `${toText(tile?.baseType)}:${toText(tile?.baseId)}`)
  const allTilesYear2Incomplete =
    tileMinHitDatesByYear.every((count) => count < 2) || tileMinHitSymbolDatesByYear.every((count) => count < 2)
  const tileSupportMedian = medianOf(matchRows)
  const tileSupportMin = minOf(matchRows)
  const tileSupportMax = maxOf(matchRows)

  return {
    tileCount: tiles.length,
    uniqueBaseCount: uniqueCount(baseKeys),
    tileSupport: {
      sumMatchRows: sumOf(matchRows),
      minMatchRows: tileSupportMin,
      medianMatchRows: tileSupportMedian,
      maxMatchRows: tileSupportMax,
      minHitRows: minOf(hitRows),
      medianHitRows: medianOf(hitRows),
      maxHitRows: maxOf(hitRows),
      totalFalsePositiveRowsAcrossTiles: sumOf(falsePositiveRows),
      tilesWithMatchRowsLt8: matchRows.filter((value) => value < 8).length,
      tilesWithMatchRowsLt10: matchRows.filter((value) => value < 10).length,
    },
    tileYearCoverage: {
      zeroYearTiles: tileYearCoverageCounts.filter((value) => value === 0).length,
      oneYearTiles: tileYearCoverageCounts.filter((value) => value === 1).length,
      twoYearTiles: tileYearCoverageCounts.filter((value) => value === 2).length,
      threeOrMoreYearTiles: tileYearCoverageCounts.filter((value) => value >= 3).length,
      minYearsCoveredByTile: minOf(tileYearCoverageCounts),
      medianYearsCoveredByTile: medianOf(tileYearCoverageCounts),
      maxYearsCoveredByTile: maxOf(tileYearCoverageCounts),
      tilesWithMinHitDatesBelow2: tileMinHitDatesByYear.filter((value) => value < 2).length,
      tilesWithMinHitSymbolDatesBelow2: tileMinHitSymbolDatesByYear.filter((value) => value < 2).length,
      allTilesYear2Incomplete,
    },
    atomComplexity: {
      includeAtomCount,
      vetoAtomCount,
      totalAtomCount,
      featureRankAtomCount,
      extremeFeatureRankAtomCount,
      extremeFeatureRankShare: safeRatio(extremeFeatureRankAtomCount, featureRankAtomCount),
      patternIncludeAtomCount,
      clusterIncludeAtomCount,
      tokenIncludeAtomCount,
      familyIncludeAtomCount,
    },
    flags: {
      smallTileDominatedLt8: tileSupportMedian < 8,
      smallTileDominatedLt10: tileSupportMedian < 10,
      allTilesYear2Incomplete,
      stitchedYearCoverage: allTilesYear2Incomplete && tiles.length > 1,
      extremeRankHeavy: safeRatio(extremeFeatureRankAtomCount, Math.max(totalAtomCount, 1)) >= 0.25,
      mixedBaseCover: uniqueCount(baseKeys) > 1,
    },
  }
}

const replayByCoverId = (rows, label) => {
  const map = new Map()
  for (const row of rows) {
    const coverId = toText(row?.coverId)
    if (!coverId) throw new Error(`${label} row missing coverId`)
    if (map.has(coverId)) throw new Error(`${label} contains duplicate coverId: ${coverId}`)
    map.set(coverId, row)
  }
  return map
}

const assertTrainOperationalPass = (metrics, coverId) => {
  if (toNumber(metrics?.operationalFalsePositiveRows, NaN) !== 0) {
    throw new Error(`train replay cover is not operational zero-FP: ${coverId}`)
  }
  if (metrics?.year2ExecutableHitPassedOnObservedYears !== true) {
    throw new Error(`train replay cover is not executable year2-hit: ${coverId}`)
  }
}

const compactReplayMetrics = (metrics) => ({
  totalRows: toNumber(metrics?.totalRows, 0),
  executableRows: toNumber(metrics?.executableRows, 0),
  nonExecutableRows: toNumber(metrics?.nonExecutableRows, 0),
  executableHitRows: toNumber(metrics?.executableHitRows, 0),
  operationalFalsePositiveRows: toNumber(metrics?.operationalFalsePositiveRows, 0),
  executablePrecisionPenalizingNonExecutable: toNumber(metrics?.executablePrecisionPenalizingNonExecutable, 0),
  totalExecutableHitDates: toNumber(metrics?.totalExecutableHitDates, 0),
  totalExecutableHitSymbolDates: toNumber(metrics?.totalExecutableHitSymbolDates, 0),
  executableHitDatesByYear: metrics?.executableHitDatesByYear ?? {},
  executableHitSymbolDatesByYear: metrics?.executableHitSymbolDatesByYear ?? {},
  minExecutableHitDatesPerObservedYear: toNumber(metrics?.minExecutableHitDatesPerObservedYear, 0),
  minExecutableHitSymbolDatesPerObservedYear: toNumber(metrics?.minExecutableHitSymbolDatesPerObservedYear, 0),
  year2ExecutableHitPassedOnObservedYears: metrics?.year2ExecutableHitPassedOnObservedYears === true,
})

const summarizeOosBuckets = (rows) => {
  const buckets = new Map()
  for (const row of rows) {
    const metrics = row?.oosDiagnostic?.metrics ?? {}
    const yearCountsText = Object.entries(metrics.executableHitDatesByYear ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([year, count]) => `${year}:${count}`)
      .join(",")
    const key = [
      `rows=${toNumber(metrics.totalRows, 0)}`,
      `hits=${toNumber(metrics.executableHitRows, 0)}`,
      `fp=${toNumber(metrics.operationalFalsePositiveRows, 0)}`,
      `years=${yearCountsText}`,
    ].join("|")
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  return [...buckets.entries()]
    .map(([bucket, count]) => ({ bucket, coverCount: count }))
    .sort((left, right) => right.coverCount - left.coverCount || left.bucket.localeCompare(right.bucket))
}

export const buildTp12ExecutableGlobalGreedyStabilityAudit = async ({
  survivorsPath,
  trainReplayPath,
  oosReplayPath = "",
  outDir,
  patchKey = DEFAULT_PATCH_KEY,
}) => {
  if (!toText(outDir)) throw new Error("outDir is required")
  requireExistingFile(survivorsPath, "survivors")
  requireExistingFile(trainReplayPath, "train replay")
  if (oosReplayPath) requireExistingFile(oosReplayPath, "OOS replay")

  const survivors = await readJsonlRowsStrict(survivorsPath, "survivors")
  const trainReplayRows = await readJsonlRowsStrict(trainReplayPath, "train replay")
  const oosReplayRows = oosReplayPath ? await readJsonlRowsStrict(oosReplayPath, "OOS replay") : []
  const trainReplayByCover = replayByCoverId(trainReplayRows, "train replay")
  const oosReplayByCover = oosReplayPath ? replayByCoverId(oosReplayRows, "OOS replay") : new Map()

  await ensureDir(outDir)
  const outputPaths = {
    summary: path.join(outDir, "stability_audit_summary.json"),
    coverScores: path.join(outDir, "stability_audit_cover_scores.jsonl"),
  }

  const writer = await createJsonlWriter(outputPaths.coverScores)
  const coverScores = []
  try {
    for (const survivor of survivors) {
      const coverId = toText(survivor?.coverId)
      if (!coverId) throw new Error("survivor row missing coverId")
      const trainReplay = trainReplayByCover.get(coverId)
      if (!trainReplay) throw new Error(`survivor missing train replay row: ${coverId}`)
      assertTrainOperationalPass(trainReplay.metrics, coverId)
      const tileDiagnostics = buildTileDiagnostics(survivor)
      const oosReplay = oosReplayByCover.get(coverId) ?? null
      if (oosReplayPath && !oosReplay) throw new Error(`survivor missing OOS replay row: ${coverId}`)
      const score = {
        kind: "tp12_executable_global_greedy_stability_audit_cover_score_v1",
        patchKey,
        coverId,
        baseType: toText(survivor?.baseType),
        baseId: toText(survivor?.baseId),
        trainOperational: {
          metrics: compactReplayMetrics(trainReplay.metrics ?? {}),
        },
        tileDiagnostics,
        fragilityFlags: tileDiagnostics.flags,
        oosDiagnostic: oosReplay
          ? {
              usage: "diagnostic_only_after_train_survivors_frozen",
              metrics: compactReplayMetrics(oosReplay.metrics ?? {}),
            }
          : null,
      }
      coverScores.push(score)
      await writer.writeRow(score)
    }
  } finally {
    await writer.close()
  }

  const trainZeroFpYear2Count = coverScores.filter(
    (row) =>
      row.trainOperational.metrics.operationalFalsePositiveRows === 0 &&
      row.trainOperational.metrics.year2ExecutableHitPassedOnObservedYears,
  ).length
  const oosProvided = Boolean(oosReplayPath)
  const oosZeroFpYear2Count = oosProvided
    ? coverScores.filter(
        (row) =>
          row.oosDiagnostic?.metrics?.operationalFalsePositiveRows === 0 &&
          row.oosDiagnostic?.metrics?.year2ExecutableHitPassedOnObservedYears,
      ).length
    : null
  const oosRowsWithMatches = oosProvided
    ? coverScores.filter((row) => toNumber(row.oosDiagnostic?.metrics?.totalRows, 0) > 0).length
    : null
  const oosBestCovers = oosProvided
    ? coverScores
        .slice()
        .sort(
          (left, right) =>
            toNumber(right.oosDiagnostic?.metrics?.executablePrecisionPenalizingNonExecutable, 0) -
              toNumber(left.oosDiagnostic?.metrics?.executablePrecisionPenalizingNonExecutable, 0) ||
            toNumber(right.oosDiagnostic?.metrics?.executableHitRows, 0) -
              toNumber(left.oosDiagnostic?.metrics?.executableHitRows, 0) ||
            toNumber(left.oosDiagnostic?.metrics?.operationalFalsePositiveRows, 0) -
              toNumber(right.oosDiagnostic?.metrics?.operationalFalsePositiveRows, 0) ||
            left.coverId.localeCompare(right.coverId),
        )
        .slice(0, 10)
        .map((row) => ({
          coverId: row.coverId,
          tileCount: row.tileDiagnostics.tileCount,
          fragilityFlags: row.fragilityFlags,
          metrics: row.oosDiagnostic.metrics,
        }))
    : []

  const summary = {
    kind: "tp12_executable_global_greedy_stability_audit_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "completed",
    patchKey,
    inputs: {
      survivorsPath,
      trainReplayPath,
      oosReplayPath: oosReplayPath || null,
      oosUsage: oosProvided ? "diagnostic_only_after_train_survivors_frozen" : "not_used",
    },
    hardStops: {
      emitsSelector: false,
      tunesOnOos: false,
      promotesOosWinners: false,
      changesRuntimePath: false,
    },
    survivorCoverCount: survivors.length,
    trainReplayCoverCount: trainReplayRows.length,
    trainOperationalZeroFpYear2CoverCount: trainZeroFpYear2Count,
    allCoversTrainOperationalZeroFpYear2: trainZeroFpYear2Count === survivors.length,
    fragilityCounts: {
      smallTileDominatedLt8: coverScores.filter((row) => row.fragilityFlags.smallTileDominatedLt8).length,
      smallTileDominatedLt10: coverScores.filter((row) => row.fragilityFlags.smallTileDominatedLt10).length,
      allTilesYear2Incomplete: coverScores.filter((row) => row.fragilityFlags.allTilesYear2Incomplete).length,
      stitchedYearCoverage: coverScores.filter((row) => row.fragilityFlags.stitchedYearCoverage).length,
      extremeRankHeavy: coverScores.filter((row) => row.fragilityFlags.extremeRankHeavy).length,
      mixedBaseCover: coverScores.filter((row) => row.fragilityFlags.mixedBaseCover).length,
    },
    distributions: {
      tileCount: {
        min: minOf(coverScores.map((row) => row.tileDiagnostics.tileCount)),
        median: medianOf(coverScores.map((row) => row.tileDiagnostics.tileCount)),
        max: maxOf(coverScores.map((row) => row.tileDiagnostics.tileCount)),
      },
      tileMedianMatchRows: {
        min: minOf(coverScores.map((row) => row.tileDiagnostics.tileSupport.medianMatchRows)),
        median: medianOf(coverScores.map((row) => row.tileDiagnostics.tileSupport.medianMatchRows)),
        max: maxOf(coverScores.map((row) => row.tileDiagnostics.tileSupport.medianMatchRows)),
      },
      uniqueBaseCount: {
        min: minOf(coverScores.map((row) => row.tileDiagnostics.uniqueBaseCount)),
        median: medianOf(coverScores.map((row) => row.tileDiagnostics.uniqueBaseCount)),
        max: maxOf(coverScores.map((row) => row.tileDiagnostics.uniqueBaseCount)),
      },
    },
    oosDiagnostic: oosProvided
      ? {
          usage: "diagnostic_only_after_train_survivors_frozen",
          coverCountWithMatches: oosRowsWithMatches,
          zeroOperationalFalsePositiveYear2CoverCount: oosZeroFpYear2Count,
          bestCovers: oosBestCovers,
          metricBuckets: summarizeOosBuckets(coverScores),
        }
      : null,
    verdict:
      oosProvided && oosZeroFpYear2Count === 0
        ? "train_survivors_fragile_oos_failed"
        : "train_stability_diagnostic_completed",
    recommendation:
      oosProvided && oosZeroFpYear2Count === 0
        ? "do_not_promote_current_40_covers; add train-only stability gates before any next OOS replay"
        : "use audit outputs to design train-only stability gates before promotion",
    nextPatchHint:
      "Require minimum per-tile support, year-dispersion inside each tile or leave-one-year-out train replay, and reject covers that pass only by stitching tiny one-year tiles.",
    outputPaths,
  }

  await writeJson(outputPaths.summary, summary)
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        verdict: summary.verdict,
        survivorCoverCount: summary.survivorCoverCount,
        fragilityCounts: summary.fragilityCounts,
        oosZeroOperationalFalsePositiveYear2CoverCount:
          summary.oosDiagnostic?.zeroOperationalFalsePositiveYear2CoverCount ?? null,
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
  const survivorsPath = requirePathFlag(flags, "survivors", cwd)
  const trainReplayPath = requirePathFlag(flags, "train-replay", cwd)
  const oosReplayPath = optionalPathFlag(flags, "oos-replay", cwd)
  const outDir = path.resolve(cwd, toText(getFlag(flags, "out-dir", "")))
  if (!toText(getFlag(flags, "out-dir", "")).trim()) throw new Error("--out-dir is required")
  const patchKey = toText(getFlag(flags, "patch-key", DEFAULT_PATCH_KEY)).trim() || DEFAULT_PATCH_KEY
  return buildTp12ExecutableGlobalGreedyStabilityAudit({
    survivorsPath,
    trainReplayPath,
    oosReplayPath,
    outDir,
    patchKey,
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
