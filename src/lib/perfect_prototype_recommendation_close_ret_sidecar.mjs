import path from "node:path"
import fsp from "node:fs/promises"
import crypto from "node:crypto"

import { ensureDir, pathExists, readJson, writeJson } from "./io.mjs"
import {
  buildDelimitedSelectSqlFromSchema,
  resolvePerfectPrototypeDuckdbCli,
  runPerfectPrototypeDuckdbSql,
  sqlQuote,
  streamDuckdbQueryDelimitedRows,
  streamParquetQueryDelimitedRows,
} from "./perfect_prototype_duckdb.mjs"

const SIDECAR_DIRNAME = path.join("artifacts", "sidecar", "recommendation_close_ret")
const SIDECAR_MANIFEST_FILENAME = "manifest.json"
const RECOMMENDATION_CLOSE_RET_SIDECAR_STREAM_SCHEMA = Object.freeze([
  Object.freeze({ name: "symbol", duckdbType: "VARCHAR" }),
  Object.freeze({ name: "recommendationCloseRetPct", duckdbType: "DOUBLE" }),
])
const RECOMMENDATION_CLOSE_RET_CANDLE_FINGERPRINT_STREAM_SCHEMA = Object.freeze([
  Object.freeze({ name: "dateKey", duckdbType: "VARCHAR" }),
  Object.freeze({ name: "dateFingerprint", duckdbType: "VARCHAR" }),
  Object.freeze({ name: "rowCount", duckdbType: "BIGINT" }),
])

const normalizeDateKey = (value) => String(value ?? "").trim()

const buildCoverage = (dateKeys) => {
  const sorted = Array.from(new Set((Array.isArray(dateKeys) ? dateKeys : []).map(normalizeDateKey).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )
  return {
    from: sorted[0] ?? null,
    to: sorted[sorted.length - 1] ?? null,
    count: sorted.length,
  }
}

const captureFileFingerprint = async (filePath) => {
  const stats = await fsp.stat(filePath)
  return {
    sizeBytes: Number(stats.size ?? 0),
    mtimeMs: Number(Math.trunc(stats.mtimeMs ?? 0)),
  }
}

const assertSidecarDirectoryContract = (resolvedSidecarPath) => {
  if (resolvedSidecarPath.endsWith(".parquet")) {
    throw new Error(
      [
        `Recommendation close-return sidecar now requires a directory path, not a parquet file: ${resolvedSidecarPath}`,
        "Rebuild with tools/build_recommendation_close_ret_sidecar.mjs to create sidecar v3.",
      ].join("\n"),
    )
  }
}

const buildSourceFingerprint = ({
  dateKey,
  dateFingerprint,
  prevDateKeyDependency,
  prevDateFingerprint,
}) =>
  crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        dateKey,
        dateFingerprint: dateFingerprint ?? null,
        prevDateKeyDependency: prevDateKeyDependency ?? null,
        prevDateFingerprint: prevDateFingerprint ?? null,
      }),
    )
    .digest("hex")

const buildGlobalFingerprint = (dateFingerprintRows) =>
  crypto
    .createHash("sha1")
    .update(JSON.stringify(dateFingerprintRows))
    .digest("hex")

const assertDateKeyFormat = (label, value) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid ${label}: ${normalized}`)
  }
  return normalized
}

const collectRecommendationCloseRetCandleDateFingerprints = async ({
  cwd = process.cwd(),
  candlePath,
}) => {
  const resolvedCandlePath = path.resolve(String(candlePath ?? "").trim())
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const rows = []
  await streamDuckdbQueryDelimitedRows({
    cwd,
    duckdb,
    sql: `
WITH candles AS (
  SELECT
    TRIM(CAST(symbol AS VARCHAR)) AS symbol,
    NULLIF(TRIM(CAST(dateKey AS VARCHAR)), '') AS dateKey,
    CAST(close AS DOUBLE) AS close
  FROM read_json_auto(${sqlQuote(resolvedCandlePath)})
  WHERE symbol IS NOT NULL
    AND TRIM(CAST(symbol AS VARCHAR)) <> ''
    AND dateKey IS NOT NULL
    AND TRIM(CAST(dateKey AS VARCHAR)) <> ''
    AND close IS NOT NULL
),
fingerprints AS (
  SELECT
    dateKey,
    md5(string_agg(concat(symbol, '|', CAST(close AS VARCHAR)), '||' ORDER BY symbol, close)) AS dateFingerprint,
    COUNT(*) AS rowCount
  FROM candles
  GROUP BY dateKey
)
SELECT
  ${buildDelimitedSelectSqlFromSchema(RECOMMENDATION_CLOSE_RET_CANDLE_FINGERPRINT_STREAM_SCHEMA)}
FROM fingerprints
ORDER BY dateKey
`,
    schema: RECOMMENDATION_CLOSE_RET_CANDLE_FINGERPRINT_STREAM_SCHEMA,
    onRow: async (row) => {
      const dateKey = normalizeDateKey(row?.dateKey)
      const dateFingerprint = String(row?.dateFingerprint ?? "").trim()
      if (!dateKey || !dateFingerprint) return
      rows.push({
        dateKey,
        dateFingerprint,
        rowCount: Number(row?.rowCount ?? 0),
      })
    },
  })
  return rows
}

const buildDateFingerprintIndex = (rows) => {
  const sortedRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => normalizeDateKey(row?.dateKey) && String(row?.dateFingerprint ?? "").trim())
    .map((row) => ({
      dateKey: normalizeDateKey(row.dateKey),
      dateFingerprint: String(row.dateFingerprint).trim(),
      rowCount: Number(row?.rowCount ?? 0),
    }))
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
  const dateFingerprintByDate = new Map()
  const prevDateKeyByDate = new Map()
  let previousDateKey = null
  for (const row of sortedRows) {
    dateFingerprintByDate.set(row.dateKey, row.dateFingerprint)
    prevDateKeyByDate.set(row.dateKey, previousDateKey)
    previousDateKey = row.dateKey
  }
  return {
    sortedRows,
    dateFingerprintByDate,
    prevDateKeyByDate,
  }
}

const buildRecommendationCloseRetPartitionMetadata = ({
  dateKey,
  partitionDir,
  parquetPaths,
  dateFingerprintIndex,
}) => {
  const normalizedDateKey = normalizeDateKey(dateKey)
  const prevDateKeyDependency = normalizeDateKey(
    dateFingerprintIndex?.prevDateKeyByDate?.get(normalizedDateKey) ?? null,
  )
  const sourceDateFingerprint = String(
    dateFingerprintIndex?.dateFingerprintByDate?.get(normalizedDateKey) ?? "",
  ).trim()
  if (!sourceDateFingerprint) {
    throw new Error(
      `Recommendation close-return manifest cannot resolve source fingerprint for output date ${normalizedDateKey}`,
    )
  }
  const dependencyDateFingerprint = prevDateKeyDependency
    ? String(dateFingerprintIndex?.dateFingerprintByDate?.get(prevDateKeyDependency) ?? "").trim() || null
    : null
  return {
    dateKey: normalizedDateKey,
    partitionDir,
    parquetPaths: (Array.isArray(parquetPaths) ? parquetPaths : []).map((entry) => path.resolve(entry)).sort((left, right) =>
      left.localeCompare(right),
    ),
    prevDateKeyDependency: prevDateKeyDependency || null,
    sourceDateFingerprint,
    dependencyDateFingerprint,
    sourceFingerprint: buildSourceFingerprint({
      dateKey: normalizedDateKey,
      dateFingerprint: sourceDateFingerprint,
      prevDateKeyDependency: prevDateKeyDependency || null,
      prevDateFingerprint: dependencyDateFingerprint,
    }),
  }
}

const listSidecarPartitionEntries = async ({ sidecarPath }) => {
  const resolvedSidecarPath = path.resolve(String(sidecarPath ?? "").trim())
  if (!pathExists(resolvedSidecarPath)) return []
  const entries = await fsp.readdir(resolvedSidecarPath, {
    withFileTypes: true,
  })
  const partitions = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("date=")) continue
    const partitionDir = path.join(resolvedSidecarPath, entry.name)
    const partitionEntries = await fsp.readdir(partitionDir, { withFileTypes: true })
    const parquetPaths = partitionEntries
      .filter((partitionEntry) => partitionEntry.isFile() && partitionEntry.name.endsWith(".parquet"))
      .map((partitionEntry) => path.join(partitionDir, partitionEntry.name))
      .sort((left, right) => left.localeCompare(right))
    partitions.push({
      dateKey: normalizeDateKey(entry.name.slice("date=".length)),
      partitionDir,
      parquetPaths,
    })
  }
  return partitions.sort((left, right) => left.dateKey.localeCompare(right.dateKey))
}

const buildRecommendationCloseRetManifest = ({
  candlePath,
  candleFingerprint,
  globalFingerprint,
  sidecarPath,
  sourceCoverage,
  outputPartitions,
}) => ({
  version: 4,
  generatedAt: new Date().toISOString(),
  candlePath: path.resolve(candlePath),
  candleFingerprint,
  globalFingerprint,
  sidecarPath: path.resolve(sidecarPath),
  sourceCoverage,
  outputCoverage: buildCoverage(outputPartitions.map((entry) => entry.dateKey)),
  coverage: buildCoverage(outputPartitions.map((entry) => entry.dateKey)),
  partitionPaths: outputPartitions.map((entry) => entry.partitionDir),
  partitions: outputPartitions,
})

const assertManifestVersion = (manifestPath, manifest) => {
  if (Number(manifest?.version ?? 0) < 4) {
    throw new Error(
      [
        `Recommendation close-return sidecar v4 is required at ${manifestPath}.`,
        "Rebuild with tools/build_recommendation_close_ret_sidecar.mjs before filtered predictive apply or incremental sidecar updates.",
      ].join("\n"),
    )
  }
}

const validatePreservedRecommendationPartitions = async ({
  sidecarPath,
  manifest,
  rebuildFromDateKey,
  dateFingerprintIndex,
}) => {
  const preserved = []
  const requestedRebuildFrom = normalizeDateKey(rebuildFromDateKey)
  const manifestPartitions = Array.isArray(manifest?.partitions) ? manifest.partitions : []
  for (const entry of manifestPartitions) {
    const dateKey = normalizeDateKey(entry?.dateKey)
    if (!dateKey) continue
    if (requestedRebuildFrom && dateKey >= requestedRebuildFrom) {
      continue
    }
    const partitionDir = path.resolve(String(entry?.partitionDir ?? "").trim())
    const parquetPaths = (Array.isArray(entry?.parquetPaths) ? entry.parquetPaths : [])
      .map((filePath) => path.resolve(String(filePath ?? "").trim()))
      .filter(Boolean)
    if (!partitionDir || !pathExists(partitionDir) || parquetPaths.some((filePath) => !pathExists(filePath))) {
      throw new Error(
        `Recommendation close-return sidecar preserved partition is missing on disk: ${dateKey} ${partitionDir}`,
      )
    }
    const expected = buildRecommendationCloseRetPartitionMetadata({
      dateKey,
      partitionDir,
      parquetPaths,
      dateFingerprintIndex,
    })
    if (
      expected.prevDateKeyDependency !== normalizeDateKey(entry?.prevDateKeyDependency ?? null) ||
      expected.sourceFingerprint !== String(entry?.sourceFingerprint ?? "").trim()
    ) {
      throw new Error(
        [
          `Recommendation close-return sidecar preserved partition is stale before rebuild-from boundary.`,
          `dateKey=${dateKey}`,
          `requestedRebuildFrom=${requestedRebuildFrom || "<none>"}`,
          "Use a full rebuild or set --rebuild-from to an earlier affected date.",
        ].join("\n"),
      )
    }
    preserved.push(expected)
  }
  return preserved
}

const buildRecommendationCloseRetPartitions = async ({
  cwd = process.cwd(),
  candlePath,
  sidecarPath,
  outputDateFrom = null,
}) => {
  const resolvedCandlePath = path.resolve(String(candlePath ?? "").trim())
  const resolvedSidecarPath = path.resolve(String(sidecarPath ?? "").trim())
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const outputDateFilter = normalizeDateKey(outputDateFrom)
    ? `AND dateKey >= ${sqlQuote(normalizeDateKey(outputDateFrom))}`
    : ""
  await runPerfectPrototypeDuckdbSql({
    cwd,
    duckdb,
    sql: `
COPY (
  WITH candles AS (
    SELECT
      TRIM(CAST(symbol AS VARCHAR)) AS symbol,
      NULLIF(TRIM(CAST(dateKey AS VARCHAR)), '') AS dateKey,
      CAST(close AS DOUBLE) AS close
    FROM read_json_auto(${sqlQuote(resolvedCandlePath)})
  ),
  ordered AS (
    SELECT
      symbol,
      dateKey,
      dateKey AS date,
      LAG(close) OVER (PARTITION BY symbol ORDER BY dateKey) AS previousClose,
      close
    FROM candles
    WHERE symbol IS NOT NULL
      AND TRIM(symbol) <> ''
      AND dateKey IS NOT NULL
      AND TRIM(dateKey) <> ''
      AND close IS NOT NULL
  )
  SELECT
    symbol,
    dateKey,
    date,
    ((close - previousClose) / previousClose) * 100.0 AS recommendationCloseRetPct
  FROM ordered
  WHERE previousClose IS NOT NULL
    AND previousClose > 0
    ${outputDateFilter}
) TO ${sqlQuote(resolvedSidecarPath)} (
  FORMAT PARQUET,
  COMPRESSION ZSTD,
  PARTITION_BY (date)
);
`,
  })
}

const replaceRecommendationPartitionsFromTemp = async ({
  targetSidecarPath,
  tempSidecarPath,
  rebuildFromDateKey,
}) => {
  const normalizedRebuildFrom = normalizeDateKey(rebuildFromDateKey)
  await ensureDir(targetSidecarPath)
  if (normalizedRebuildFrom) {
    const existingEntries = await fsp.readdir(targetSidecarPath, { withFileTypes: true }).catch(() => [])
    for (const entry of existingEntries) {
      if (!entry.isDirectory() || !entry.name.startsWith("date=")) continue
      const dateKey = normalizeDateKey(entry.name.slice("date=".length))
      if (!dateKey || dateKey < normalizedRebuildFrom) continue
      await fsp.rm(path.join(targetSidecarPath, entry.name), {
        recursive: true,
        force: true,
      })
    }
  }
  const tempEntries = await fsp.readdir(tempSidecarPath, { withFileTypes: true })
  for (const entry of tempEntries) {
    if (!entry.isDirectory() || !entry.name.startsWith("date=")) continue
    const sourceDir = path.join(tempSidecarPath, entry.name)
    const targetDir = path.join(targetSidecarPath, entry.name)
    await fsp.rm(targetDir, { recursive: true, force: true })
    await fsp.rename(sourceDir, targetDir)
  }
}

export const resolvePerfectPrototypeRecommendationCloseRetSidecarPath = ({
  cwd = process.cwd(),
  sidecarPath = null,
} = {}) => {
  const rawValue = String(sidecarPath ?? "").trim()
  if (rawValue) {
    return path.resolve(rawValue)
  }
  return path.resolve(path.join(cwd, SIDECAR_DIRNAME))
}

export const resolvePerfectPrototypeRecommendationCloseRetSidecarManifestPath = ({
  sidecarPath,
}) => path.join(path.resolve(sidecarPath), SIDECAR_MANIFEST_FILENAME)

export const resolvePerfectPrototypeRecommendationCloseRetSidecarPartitionDir = ({
  sidecarPath,
  dateKey,
}) => path.join(path.resolve(sidecarPath), `date=${normalizeDateKey(dateKey)}`)

export const buildPerfectPrototypeRecommendationCloseRetSidecar = async ({
  cwd = process.cwd(),
  candlePath,
  sidecarPath,
  overwrite = false,
  rebuildFrom = null,
  appendLatest = false,
}) => {
  const resolvedCandlePath = path.resolve(String(candlePath ?? "").trim())
  const resolvedSidecarPath = resolvePerfectPrototypeRecommendationCloseRetSidecarPath({
    cwd,
    sidecarPath,
  })
  assertSidecarDirectoryContract(resolvedSidecarPath)
  const normalizedRebuildFrom = assertDateKeyFormat("rebuild-from", rebuildFrom)
  if (overwrite && (appendLatest || normalizedRebuildFrom)) {
    throw new Error("Use either overwrite=true for a full rebuild, or append-latest / rebuild-from for incremental rebuilds, not both.")
  }
  const manifestPath = resolvePerfectPrototypeRecommendationCloseRetSidecarManifestPath({
    sidecarPath: resolvedSidecarPath,
  })
  const sidecarExists = pathExists(resolvedSidecarPath)
  const previousManifest = sidecarExists ? await readJson(manifestPath, null) : null
  if ((appendLatest || normalizedRebuildFrom) && !previousManifest) {
    throw new Error(
      `Recommendation close-return sidecar incremental rebuild requires an existing manifest at ${manifestPath}. Run a full rebuild first.`,
    )
  }

  const candleFingerprint = await captureFileFingerprint(resolvedCandlePath)
  const candleDateFingerprintRows = await collectRecommendationCloseRetCandleDateFingerprints({
    cwd,
    candlePath: resolvedCandlePath,
  })
  const dateFingerprintIndex = buildDateFingerprintIndex(candleDateFingerprintRows)
  const globalFingerprint = buildGlobalFingerprint(candleDateFingerprintRows)
  const sourceCoverage = buildCoverage(candleDateFingerprintRows.map((entry) => entry.dateKey))

  if (appendLatest && previousManifest) {
    assertManifestVersion(manifestPath, previousManifest)
    const existingOutputTo = normalizeDateKey(previousManifest?.outputCoverage?.to)
    const firstNewDate = dateFingerprintIndex.sortedRows.find((entry) => !existingOutputTo || entry.dateKey > existingOutputTo)?.dateKey ?? null
    if (!firstNewDate) {
      if (String(previousManifest?.globalFingerprint ?? "").trim() !== globalFingerprint) {
        throw new Error(
          [
            "Recommendation close-return sidecar append-latest found no new source dates, but candle source fingerprint changed.",
            "Run a full rebuild or use --rebuild-from=YYYY-MM-DD with the earliest affected date.",
          ].join("\n"),
        )
      }
      return {
        sidecarPath: resolvedSidecarPath,
        manifestPath,
        manifest: previousManifest,
        noOp: true,
      }
    }
  }

  const effectiveRebuildFrom =
    appendLatest && previousManifest
      ? dateFingerprintIndex.sortedRows.find((entry) => {
          const existingOutputTo = normalizeDateKey(previousManifest?.outputCoverage?.to)
          return !existingOutputTo || entry.dateKey > existingOutputTo
        })?.dateKey ?? null
      : normalizedRebuildFrom
  const incremental = Boolean(effectiveRebuildFrom)
  if (
    effectiveRebuildFrom &&
    !dateFingerprintIndex.dateFingerprintByDate.has(effectiveRebuildFrom)
  ) {
    throw new Error(
      `Recommendation close-return sidecar rebuild-from date is outside candle source coverage: ${effectiveRebuildFrom}`,
    )
  }

  if (incremental) {
    assertManifestVersion(manifestPath, previousManifest)
  } else if (sidecarExists && !overwrite) {
    throw new Error(
      `Recommendation close-return sidecar already exists: ${resolvedSidecarPath}. Pass overwrite=true for a full rebuild or --rebuild-from/--append-latest for an incremental rebuild.`,
    )
  }

  const preservedPartitions = incremental
    ? await validatePreservedRecommendationPartitions({
        sidecarPath: resolvedSidecarPath,
        manifest: previousManifest,
        rebuildFromDateKey: effectiveRebuildFrom,
        dateFingerprintIndex,
      })
    : []

  await ensureDir(path.dirname(resolvedSidecarPath))
  const tempRoot = await fsp.mkdtemp(path.join(path.dirname(resolvedSidecarPath), ".recommendation_close_ret_tmp_"))
  const tempSidecarPath = path.join(tempRoot, "sidecar")
  await ensureDir(tempSidecarPath)
  try {
    await buildRecommendationCloseRetPartitions({
      cwd,
      candlePath: resolvedCandlePath,
      sidecarPath: tempSidecarPath,
      outputDateFrom: effectiveRebuildFrom,
    })
    if (incremental) {
      await replaceRecommendationPartitionsFromTemp({
        targetSidecarPath: resolvedSidecarPath,
        tempSidecarPath,
        rebuildFromDateKey: effectiveRebuildFrom,
      })
    } else {
      await fsp.rm(resolvedSidecarPath, { recursive: true, force: true })
      await fsp.rename(tempSidecarPath, resolvedSidecarPath)
    }
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }

  const partitionEntries = await listSidecarPartitionEntries({
    sidecarPath: resolvedSidecarPath,
  })
  const partitions = partitionEntries.map((entry) =>
    buildRecommendationCloseRetPartitionMetadata({
      dateKey: entry.dateKey,
      partitionDir: entry.partitionDir,
      parquetPaths: entry.parquetPaths,
      dateFingerprintIndex,
    }),
  )
  const manifest = buildRecommendationCloseRetManifest({
    candlePath: resolvedCandlePath,
    candleFingerprint,
    globalFingerprint,
    sidecarPath: resolvedSidecarPath,
    sourceCoverage,
    outputPartitions: partitions,
  })
  await writeJson(manifestPath, manifest)
  return {
    sidecarPath: resolvedSidecarPath,
    manifestPath,
    manifest,
  }
}

export const assertPerfectPrototypeRecommendationCloseRetSidecar = async ({
  sidecarPath,
  candlePath = null,
  requestedDateKeys = null,
}) => {
  const resolvedSidecarPath = path.resolve(String(sidecarPath ?? "").trim())
  assertSidecarDirectoryContract(resolvedSidecarPath)
  if (!pathExists(resolvedSidecarPath)) {
    throw new Error(
      `Recommendation close-return sidecar not found: ${resolvedSidecarPath}. Build it first with tools/build_recommendation_close_ret_sidecar.mjs.`,
    )
  }
  const manifestPath = resolvePerfectPrototypeRecommendationCloseRetSidecarManifestPath({
    sidecarPath: resolvedSidecarPath,
  })
  if (!pathExists(manifestPath)) {
    throw new Error(
      `Recommendation close-return sidecar manifest missing: ${manifestPath}. Rebuild with tools/build_recommendation_close_ret_sidecar.mjs.`,
    )
  }
  const manifest = await readJson(manifestPath, null)
  assertManifestVersion(manifestPath, manifest)
  const manifestCandlePath = path.resolve(String(candlePath ?? manifest?.candlePath ?? "").trim())
  if (!manifestCandlePath) {
    throw new Error(
      `Recommendation close-return sidecar manifest is missing candlePath: ${manifestPath}. Rebuild with tools/build_recommendation_close_ret_sidecar.mjs.`,
    )
  }
  if (!pathExists(manifestCandlePath)) {
    throw new Error(
      `Recommendation close-return source candle file not found: ${manifestCandlePath}. Rebuild with tools/build_recommendation_close_ret_sidecar.mjs once the source is restored.`,
    )
  }
  if (
    candlePath &&
    path.resolve(String(candlePath).trim()) !== path.resolve(String(manifest?.candlePath ?? "").trim())
  ) {
    throw new Error(
      `Recommendation close-return sidecar source mismatch: manifest candlePath=${manifest?.candlePath ?? ""}, requested candlePath=${path.resolve(String(candlePath).trim())}. Rebuild with tools/build_recommendation_close_ret_sidecar.mjs.`,
    )
  }
  const manifestFingerprint = manifest?.candleFingerprint ?? null
  if (
    !manifestFingerprint ||
    !Number.isFinite(Number(manifestFingerprint?.sizeBytes)) ||
    !Number.isFinite(Number(manifestFingerprint?.mtimeMs))
  ) {
    throw new Error(
      `Recommendation close-return sidecar manifest is missing candle fingerprint metadata: ${manifestPath}. Rebuild with tools/build_recommendation_close_ret_sidecar.mjs.`,
    )
  }
  const currentFingerprint = await captureFileFingerprint(manifestCandlePath)
  if (
    Number(currentFingerprint.sizeBytes) !== Number(manifestFingerprint.sizeBytes) ||
    Number(currentFingerprint.mtimeMs) !== Number(manifestFingerprint.mtimeMs)
  ) {
    throw new Error(
      `Recommendation close-return sidecar is stale for candle source ${manifestCandlePath}. Rebuild with tools/build_recommendation_close_ret_sidecar.mjs before filtered predictive apply.`,
    )
  }
  const partitionMap = new Map()
  for (const entry of Array.isArray(manifest?.partitions) ? manifest.partitions : []) {
    const dateKey = normalizeDateKey(entry?.dateKey)
    const partitionDir = path.resolve(String(entry?.partitionDir ?? "").trim())
    const parquetPaths = (Array.isArray(entry?.parquetPaths) ? entry.parquetPaths : [])
      .map((filePath) => path.resolve(String(filePath ?? "").trim()))
      .filter(Boolean)
    if (!dateKey || !partitionDir || parquetPaths.length < 1) {
      throw new Error(
        `Recommendation close-return sidecar manifest contains an invalid partition entry: ${manifestPath}`,
      )
    }
    if (!pathExists(partitionDir) || parquetPaths.some((filePath) => !pathExists(filePath))) {
      throw new Error(
        `Recommendation close-return sidecar manifest references a missing partition artifact for date=${dateKey}. Rebuild with tools/build_recommendation_close_ret_sidecar.mjs.`,
      )
    }
    partitionMap.set(dateKey, {
      ...entry,
      dateKey,
      partitionDir,
      parquetPaths,
    })
  }
  for (const requestedDateKey of Array.isArray(requestedDateKeys) ? requestedDateKeys : []) {
    const normalizedDateKey = normalizeDateKey(requestedDateKey)
    if (!normalizedDateKey) continue
    if (!partitionMap.has(normalizedDateKey)) {
      throw new Error(
        `Recommendation close-return sidecar partition missing in manifest for date=${normalizedDateKey}. Rebuild with tools/build_recommendation_close_ret_sidecar.mjs.`,
      )
    }
  }
  return {
    sidecarPath: resolvedSidecarPath,
    manifest,
    partitionMap,
  }
}

export const loadPerfectPrototypeRecommendationCloseRetLookupForDate = async ({
  cwd = process.cwd(),
  sidecarPath,
  dateKey,
  manifest = null,
}) => {
  const resolvedSidecarPath = path.resolve(String(sidecarPath ?? "").trim())
  assertSidecarDirectoryContract(resolvedSidecarPath)
  const normalizedDateKey = normalizeDateKey(dateKey)
  if (!normalizedDateKey) {
    throw new Error("loadPerfectPrototypeRecommendationCloseRetLookupForDate requires dateKey")
  }
  const resolvedManifest =
    manifest && typeof manifest === "object"
      ? manifest
      : (
          await assertPerfectPrototypeRecommendationCloseRetSidecar({
            sidecarPath: resolvedSidecarPath,
            requestedDateKeys: [normalizedDateKey],
          })
        ).manifest
  const partitionEntry = (Array.isArray(resolvedManifest?.partitions) ? resolvedManifest.partitions : []).find(
    (entry) => normalizeDateKey(entry?.dateKey) === normalizedDateKey,
  )
  if (!partitionEntry) {
    const partitionDir = resolvePerfectPrototypeRecommendationCloseRetSidecarPartitionDir({
      sidecarPath: resolvedSidecarPath,
      dateKey: normalizedDateKey,
    })
    throw new Error(
      `Recommendation close-return sidecar partition missing for date=${normalizedDateKey}: ${partitionDir}. Rebuild with tools/build_recommendation_close_ret_sidecar.mjs.`,
    )
  }
  const parquetPaths = (Array.isArray(partitionEntry?.parquetPaths) ? partitionEntry.parquetPaths : [])
    .map((filePath) => path.resolve(String(filePath ?? "").trim()))
    .filter(Boolean)
  if (parquetPaths.length < 1 || parquetPaths.some((filePath) => !pathExists(filePath))) {
    throw new Error(
      `Recommendation close-return sidecar partition artifacts are missing for date=${normalizedDateKey}. Rebuild with tools/build_recommendation_close_ret_sidecar.mjs.`,
    )
  }
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const lookup = new Map()
  for (const parquetPath of parquetPaths) {
    await streamParquetQueryDelimitedRows({
      cwd,
      duckdb,
      parquetPath,
      schema: RECOMMENDATION_CLOSE_RET_SIDECAR_STREAM_SCHEMA,
      selectSql: buildDelimitedSelectSqlFromSchema(RECOMMENDATION_CLOSE_RET_SIDECAR_STREAM_SCHEMA),
      orderBySql: "symbol",
      onRow: async (row) => {
        const symbol = String(row?.symbol ?? "").trim()
        const recommendationCloseRetPct = Number(row?.recommendationCloseRetPct)
        if (!symbol || !Number.isFinite(recommendationCloseRetPct)) return
        lookup.set(symbol, recommendationCloseRetPct)
      },
    })
  }
  return lookup
}
