import path from "node:path"
import crypto from "node:crypto"

import { ensureDir, createJsonlWriter, pathExists, readJson, writeJson } from "./io.mjs"
import {
  buildDelimitedSelectSqlFromSchema,
  createDuckdbDelimitedToParquetSink,
  createDuckdbStructuredToParquetSink,
  resolvePerfectPrototypeDuckdbCli,
  streamParquetQueryDelimitedRows,
} from "./perfect_prototype_duckdb.mjs"
import {
  buildPerfectPrototypeTypedParquetWrapperRow,
  unwrapPerfectPrototypeTypedParquetWrapperRow,
} from "./perfect_prototype_parquet_io.mjs"
import {
  PERFECT_PROTOTYPE_FEATURE_STATS_FILENAME,
  collectPerfectPrototypeFeatureStatsFromNumericFeatureMap,
  createPerfectPrototypeFeatureStatsAccumulator,
  finalizePerfectPrototypeFeatureStatsRows,
  resolvePerfectPrototypeFeatureStatsPartitionPath,
} from "./perfect_prototype_feature_stats_sidecar.mjs"
import {
  PERFECT_PROTOTYPE_FEATURE_VALUES_BIN_FILENAME,
  PERFECT_PROTOTYPE_FEATURE_VALUES_INDEX_FILENAME,
  resolvePerfectPrototypeFeatureValuesPartitionBinPath,
  resolvePerfectPrototypeFeatureValuesPartitionIndexPath,
  writePerfectPrototypeFeatureValuesSidecar,
} from "./perfect_prototype_feature_values_sidecar.mjs"
import {
  PERFECT_PROTOTYPE_FEATURE_STATS_SINK_SCHEMA,
  PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
} from "./perfect_prototype_structured_sink_schemas.mjs"
import { selectPerfectPrototypePrejumpDecisionDateStratifiedPartitions } from "./perfect_prototype_prejump_decision_date_stratified_sampler.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const FEATURE_STORE_DIRNAME = "artifacts/feature-store/prejump_v5"
const FEATURE_STORE_PART_FILENAME = "part-000.parquet"
const PERFECT_PROTOTYPE_PRIMARY_SINK_MODE_STRUCTURED = "structured"

export const resolvePerfectPrototypePrejumpFeatureStoreDir = ({
  cwd = process.cwd(),
  featureStoreDir = null,
} = {}) =>
  path.resolve(
    featureStoreDir
      ? String(featureStoreDir).trim()
      : path.join(cwd, FEATURE_STORE_DIRNAME),
  )

export const resolvePerfectPrototypePrejumpFeatureStorePartitionDir = ({
  featureStoreDir,
  dateKey,
}) => path.join(path.resolve(featureStoreDir), `date=${String(dateKey ?? "").trim()}`)

export const resolvePerfectPrototypePrejumpFeatureStorePartitionPath = ({
  featureStoreDir,
  dateKey,
}) =>
  path.join(
    resolvePerfectPrototypePrejumpFeatureStorePartitionDir({
      featureStoreDir,
      dateKey,
    }),
    FEATURE_STORE_PART_FILENAME,
  )

export const listPerfectPrototypePrejumpFeatureStorePartitions = async ({
  featureStoreDir,
  startDate = null,
  endDate = null,
} = {}) => {
  const resolvedFeatureStoreDir = path.resolve(featureStoreDir)
  if (!pathExists(resolvedFeatureStoreDir)) return []
  const entries = await (await import("node:fs/promises")).readdir(resolvedFeatureStoreDir, {
    withFileTypes: true,
  })
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("date="))
    .map((entry) => {
      const dateKey = String(entry.name.slice(5)).trim()
      return {
        dateKey,
        partitionDir: path.join(resolvedFeatureStoreDir, entry.name),
        parquetPath: path.join(resolvedFeatureStoreDir, entry.name, FEATURE_STORE_PART_FILENAME),
        featureStatsParquetPath: path.join(
          resolvedFeatureStoreDir,
          entry.name,
          PERFECT_PROTOTYPE_FEATURE_STATS_FILENAME,
        ),
        featureValuesBinPath: path.join(
          resolvedFeatureStoreDir,
          entry.name,
          PERFECT_PROTOTYPE_FEATURE_VALUES_BIN_FILENAME,
        ),
        featureValuesIndexParquetPath: path.join(
          resolvedFeatureStoreDir,
          entry.name,
          PERFECT_PROTOTYPE_FEATURE_VALUES_INDEX_FILENAME,
        ),
      }
    })
    .filter((entry) => entry.dateKey)
    .filter((entry) => (!startDate || entry.dateKey >= startDate) && (!endDate || entry.dateKey <= endDate))
    .filter((entry) => pathExists(entry.parquetPath))
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
}

const buildCoverage = (dateKeys) => {
  const sorted = uniqueSorted(dateKeys)
  return {
    from: sorted[0] ?? null,
    to: sorted[sorted.length - 1] ?? null,
    count: sorted.length,
  }
}

const buildFeatureStoreContractHash = ({
  strategyModes,
  contextSurfaces,
  numericFeatureKeys,
}) =>
  crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        strategyModes: uniqueSorted(strategyModes),
        contextSurfaces: uniqueSorted(contextSurfaces),
        numericFeatureKeys: uniqueSorted(numericFeatureKeys),
      }),
    )
    .digest("hex")

const normalizeManifestContractMetadata = (manifest) => ({
  strategyModes: uniqueSorted([
    ...(Array.isArray(manifest?.strategyModes) ? manifest.strategyModes : []),
    ...(manifest?.strategyMode ? [manifest.strategyMode] : []),
  ]),
  contextSurfaces: uniqueSorted([
    ...(Array.isArray(manifest?.contextSurfaces) ? manifest.contextSurfaces : []),
    ...(manifest?.surface ? [manifest.surface] : []),
  ]),
  numericFeatureKeys: uniqueSorted(Array.isArray(manifest?.numericFeatureKeys) ? manifest.numericFeatureKeys : []),
})

const sortedStringArraysEqual = (left, right) => {
  const normalizedLeft = uniqueSorted(left)
  const normalizedRight = uniqueSorted(right)
  if (normalizedLeft.length !== normalizedRight.length) return false
  for (let index = 0; index < normalizedLeft.length; index += 1) {
    if (normalizedLeft[index] !== normalizedRight[index]) return false
  }
  return true
}

const canReusePreviousManifestOnOverwrite = ({
  previousManifest,
  strategyModes,
  contextSurfaces,
  numericFeatureKeys,
}) => {
  if (!previousManifest || typeof previousManifest !== "object") return false
  const previousContract = normalizeManifestContractMetadata(previousManifest)
  return (
    sortedStringArraysEqual(previousContract.strategyModes, Array.from(strategyModes ?? [])) &&
    sortedStringArraysEqual(previousContract.contextSurfaces, Array.from(contextSurfaces ?? [])) &&
    sortedStringArraysEqual(previousContract.numericFeatureKeys, Array.from(numericFeatureKeys ?? []))
  )
}

const readWrapperRowsByDate = async ({
  cwd,
  duckdb,
  parquetPath,
  orderMode = "sorted",
  onRow,
}) => {
  const resolvedOrderMode = String(orderMode ?? "sorted").trim().toLowerCase() || "sorted"
  let previousDateKey = null
  let previousRowOrdinal = null
  await streamParquetQueryDelimitedRows({
    cwd,
    duckdb,
    parquetPath,
    schema: PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
    selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA),
    orderBySql: resolvedOrderMode === "sorted" ? "dateKey, rowOrdinal" : null,
    onRow: async (row) => {
      const typedRow = unwrapPerfectPrototypeTypedParquetWrapperRow(row)
      if (resolvedOrderMode === "physical_verify") {
        const currentDateKey = String(typedRow?.dateKey ?? "").trim()
        const currentRowOrdinal = Number(row?.rowOrdinal ?? Number.NaN)
        if (!currentDateKey) {
          throw new Error(
            `Feature-store wrapper stream row missing dateKey: ${path.resolve(parquetPath)}`,
          )
        }
        if (!Number.isInteger(currentRowOrdinal) || currentRowOrdinal < 0) {
          throw new Error(
            `Feature-store wrapper stream row missing valid rowOrdinal: ${path.resolve(parquetPath)}`,
          )
        }
        if (previousDateKey != null) {
          if (currentDateKey < previousDateKey) {
            throw new Error(
              [
                "Feature-store wrapper stream is not physically date-ordered.",
                `parquetPath=${path.resolve(parquetPath)}`,
                `previousDateKey=${previousDateKey}`,
                `currentDateKey=${currentDateKey}`,
              ].join(" "),
            )
          }
          if (currentDateKey === previousDateKey && currentRowOrdinal <= previousRowOrdinal) {
            throw new Error(
              [
                "Feature-store wrapper stream rowOrdinal is not strictly increasing within dateKey.",
                `parquetPath=${path.resolve(parquetPath)}`,
                `dateKey=${currentDateKey}`,
                `previousRowOrdinal=${previousRowOrdinal}`,
                `currentRowOrdinal=${currentRowOrdinal}`,
                "Rebuild the source pack with preserveInsertionOrder enabled.",
              ].join(" "),
            )
          }
        }
        previousDateKey = currentDateKey
        previousRowOrdinal = currentRowOrdinal
      }
      await onRow(typedRow)
    },
  })
}

const collectFeatureStoreContractMetadata = async ({
  cwd,
  duckdb,
  partitions,
}) => {
  const strategyModes = new Set()
  const contextSurfaces = new Set()
  const numericFeatureKeys = new Set()
  for (const partition of Array.isArray(partitions) ? partitions : []) {
    await readWrapperRowsByDate({
      cwd,
      duckdb,
      parquetPath: partition.parquetPath,
      onRow: async (row) => {
        if (row?.strategyMode) strategyModes.add(String(row.strategyMode).trim())
        if (row?.contextSurface) contextSurfaces.add(String(row.contextSurface).trim())
        for (const key of Object.keys(row?.numericFeatureMap ?? {})) {
          numericFeatureKeys.add(key)
        }
      },
    })
  }
  return {
    strategyModes: uniqueSorted(Array.from(strategyModes)),
    contextSurfaces: uniqueSorted(Array.from(contextSurfaces)),
    numericFeatureKeys: uniqueSorted(Array.from(numericFeatureKeys)),
  }
}

const mergeIncrementalFeatureStoreMetadata = ({
  featureStoreDir,
  previousManifest,
  writtenDateKeys,
  strategyModes,
  contextSurfaces,
  numericFeatureKeys,
}) => {
  const previousPartitions = Array.isArray(previousManifest?.partitions)
    ? previousManifest.partitions
    : []
  const previousPartitionsMissing =
    previousPartitions.some((entry) => {
      const parquetPath = String(entry?.parquetPath ?? "").trim()
      const featureStatsParquetPath = String(entry?.featureStatsParquetPath ?? "").trim()
      const featureValuesBinPath = String(entry?.featureValuesBinPath ?? "").trim()
      const featureValuesIndexParquetPath = String(entry?.featureValuesIndexParquetPath ?? "").trim()
      return (
        !pathExists(parquetPath) ||
        !pathExists(featureStatsParquetPath) ||
        !pathExists(featureValuesBinPath) ||
        !pathExists(featureValuesIndexParquetPath)
      )
    })
  if (previousPartitionsMissing) {
    return null
  }
  const partitionMap = new Map()
  for (const entry of previousPartitions) {
    const dateKey = String(entry?.dateKey ?? "").trim()
    if (!dateKey) continue
      partitionMap.set(dateKey, {
        dateKey,
        parquetPath:
          String(entry?.parquetPath ?? "").trim() ||
          resolvePerfectPrototypePrejumpFeatureStorePartitionPath({
            featureStoreDir,
            dateKey,
          }),
        featureStatsParquetPath:
          String(entry?.featureStatsParquetPath ?? "").trim() ||
          resolvePerfectPrototypeFeatureStatsPartitionPath({
            featureStoreDir,
            dateKey,
          }),
        featureValuesBinPath:
          String(entry?.featureValuesBinPath ?? "").trim() ||
          resolvePerfectPrototypeFeatureValuesPartitionBinPath({
            featureStoreDir,
            dateKey,
          }),
        featureValuesIndexParquetPath:
          String(entry?.featureValuesIndexParquetPath ?? "").trim() ||
          resolvePerfectPrototypeFeatureValuesPartitionIndexPath({
            featureStoreDir,
            dateKey,
          }),
      })
  }
  for (const dateKey of Array.isArray(writtenDateKeys) ? writtenDateKeys : []) {
    const normalizedDateKey = String(dateKey ?? "").trim()
    if (!normalizedDateKey) continue
    partitionMap.set(normalizedDateKey, {
      dateKey: normalizedDateKey,
      parquetPath: resolvePerfectPrototypePrejumpFeatureStorePartitionPath({
        featureStoreDir,
        dateKey: normalizedDateKey,
      }),
      featureStatsParquetPath: resolvePerfectPrototypeFeatureStatsPartitionPath({
        featureStoreDir,
        dateKey: normalizedDateKey,
      }),
      featureValuesBinPath: resolvePerfectPrototypeFeatureValuesPartitionBinPath({
        featureStoreDir,
        dateKey: normalizedDateKey,
      }),
      featureValuesIndexParquetPath: resolvePerfectPrototypeFeatureValuesPartitionIndexPath({
        featureStoreDir,
        dateKey: normalizedDateKey,
      }),
    })
  }
  const mergedStrategyModes = uniqueSorted([
    ...(Array.isArray(previousManifest?.strategyModes) ? previousManifest.strategyModes : []),
    ...(previousManifest?.strategyMode ? [previousManifest.strategyMode] : []),
    ...Array.from(strategyModes ?? []),
  ])
  const mergedContextSurfaces = uniqueSorted([
    ...(Array.isArray(previousManifest?.contextSurfaces) ? previousManifest.contextSurfaces : []),
    ...(previousManifest?.surface ? [previousManifest.surface] : []),
    ...Array.from(contextSurfaces ?? []),
  ])
  const mergedNumericFeatureKeys = uniqueSorted([
    ...(Array.isArray(previousManifest?.numericFeatureKeys) ? previousManifest.numericFeatureKeys : []),
    ...Array.from(numericFeatureKeys ?? []),
  ])
  const partitions = Array.from(partitionMap.values()).sort((left, right) =>
    String(left.dateKey).localeCompare(String(right.dateKey)),
  )
  return {
    strategyModes: mergedStrategyModes,
    contextSurfaces: mergedContextSurfaces,
    numericFeatureKeys: mergedNumericFeatureKeys,
    partitions,
    coverage: buildCoverage(partitions.map((entry) => entry.dateKey)),
  }
}

export const splitPerfectPrototypePrejumpPackIntoFeatureStore = async ({
  cwd = process.cwd(),
  inputPackPath,
  inputPackSummary = null,
  inputPackSummaryPath = null,
  featureStoreDir,
  overwriteExisting = false,
}) => {
  const resolvedInputPath = path.resolve(inputPackPath)
  const resolvedFeatureStoreDir = path.resolve(featureStoreDir)
  const primarySinkMode =
    String(process.env.PREJUMP_FEATURE_STORE_SINK_MODE ?? process.env.PREJUMP_PRIMARY_SINK_MODE ?? "structured")
      .trim()
      .toLowerCase() || "structured"
  if (primarySinkMode !== PERFECT_PROTOTYPE_PRIMARY_SINK_MODE_STRUCTURED) {
    throw new Error(
      `Perfect prototype feature-store sink mode must remain ${PERFECT_PROTOTYPE_PRIMARY_SINK_MODE_STRUCTURED}: ${primarySinkMode}`,
    )
  }
  await ensureDir(resolvedFeatureStoreDir)
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const manifestPath = path.join(resolvedFeatureStoreDir, "manifest.json")
  const previousManifest = await readJson(manifestPath, null)
  let currentDateKey = null
  let currentSink = null
  let currentFeatureStatsSink = null
  let currentFeatureStatsAccumulator = createPerfectPrototypeFeatureStatsAccumulator()
  let currentRowOrdinal = 0
  let partitionCount = 0
  const writtenDateKeys = []
  const strategyModes = new Set()
  const contextSurfaces = new Set()
  const numericFeatureKeys = new Set()

  const closeCurrentSink = async () => {
    if (currentFeatureStatsSink) {
      const featureStatsRows = finalizePerfectPrototypeFeatureStatsRows(currentFeatureStatsAccumulator)
      if (featureStatsRows.length > 0) {
        await currentFeatureStatsSink.writeRows(featureStatsRows)
      }
      await currentFeatureStatsSink.close()
      if (currentDateKey) {
        await writePerfectPrototypeFeatureValuesSidecar({
          cwd,
          featureStoreDir: resolvedFeatureStoreDir,
          dateKey: currentDateKey,
          accumulator: currentFeatureStatsAccumulator,
        })
      }
      currentFeatureStatsSink = null
      currentFeatureStatsAccumulator = createPerfectPrototypeFeatureStatsAccumulator()
    }
    if (!currentSink) return
    await currentSink.close()
    currentSink = null
    currentDateKey = null
    currentRowOrdinal = 0
  }

  await readWrapperRowsByDate({
    cwd,
    duckdb,
    parquetPath: resolvedInputPath,
    orderMode: "physical_verify",
    onRow: async (row) => {
      const rowDateKey = String(row?.dateKey ?? "").trim()
      if (!rowDateKey) {
        throw new Error(`Feature store split encountered wrapper row without dateKey: ${resolvedInputPath}`)
      }
      if (rowDateKey !== currentDateKey) {
        await closeCurrentSink()
        currentDateKey = rowDateKey
        const partitionPath = resolvePerfectPrototypePrejumpFeatureStorePartitionPath({
          featureStoreDir: resolvedFeatureStoreDir,
          dateKey: currentDateKey,
        })
        const featureStatsPartitionPath = resolvePerfectPrototypeFeatureStatsPartitionPath({
          featureStoreDir: resolvedFeatureStoreDir,
          dateKey: currentDateKey,
        })
        if (!overwriteExisting && pathExists(partitionPath)) {
          throw new Error(
            `Predictive feature-store partition already exists: ${partitionPath}. Use explicit overwrite mode to replace it.`,
          )
        }
        await ensureDir(path.dirname(partitionPath))
        currentSink = await createDuckdbStructuredToParquetSink({
          cwd,
          duckdb,
          parquetPath: partitionPath,
          schema: PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
          sessionOverrides: {
            preserveInsertionOrder: true,
          },
        })
        currentFeatureStatsSink = await createDuckdbDelimitedToParquetSink({
          cwd,
          duckdb,
          parquetPath: featureStatsPartitionPath,
          schema: PERFECT_PROTOTYPE_FEATURE_STATS_SINK_SCHEMA,
          sessionOverrides: {
            preserveInsertionOrder: true,
          },
        })
        currentRowOrdinal = 0
        partitionCount += 1
        writtenDateKeys.push(currentDateKey)
      }
      await currentSink.writeRow(
        buildPerfectPrototypeTypedParquetWrapperRow({
          rowOrdinal: currentRowOrdinal,
          row,
        }),
      )
      if (row?.strategyMode) strategyModes.add(String(row.strategyMode).trim())
      if (row?.contextSurface) contextSurfaces.add(String(row.contextSurface).trim())
      for (const key of Object.keys(row?.numericFeatureMap ?? {})) {
        numericFeatureKeys.add(key)
      }
      collectPerfectPrototypeFeatureStatsFromNumericFeatureMap({
        accumulator: currentFeatureStatsAccumulator,
        numericFeatureMap: row?.numericFeatureMap ?? {},
      })
      currentRowOrdinal += 1
    },
  })
  await closeCurrentSink()

  let partitions
  let coverage
  let contractMetadata
  const requestedDecisionRange =
    inputPackSummary && typeof inputPackSummary === "object"
      ? {
          from:
            String(
              inputPackSummary?.requestedDecisionRange?.from ??
                inputPackSummary?.requestedPeriod?.from ??
                inputPackSummary?.period?.from ??
                "",
            ).trim() || null,
          to:
            String(
              inputPackSummary?.requestedDecisionRange?.to ??
                inputPackSummary?.requestedPeriod?.to ??
                inputPackSummary?.period?.to ??
                "",
            ).trim() || null,
        }
      : null
  const sourcePackEffectiveDecisionCoverage =
    inputPackSummary && typeof inputPackSummary === "object"
      ? {
          from:
            String(
              inputPackSummary?.effectiveDecisionCoverage?.from ??
                inputPackSummary?.outputCoverage?.from ??
                "",
            ).trim() || null,
          to:
            String(
              inputPackSummary?.effectiveDecisionCoverage?.to ??
                inputPackSummary?.outputCoverage?.to ??
                "",
            ).trim() || null,
          count:
            Number(
              inputPackSummary?.effectiveDecisionCoverage?.count ??
                inputPackSummary?.outputCoverage?.count ??
                0,
            ) || 0,
        }
      : null
  const reusePreviousManifestOnOverwrite =
    overwriteExisting === true &&
    canReusePreviousManifestOnOverwrite({
      previousManifest,
      strategyModes,
      contextSurfaces,
      numericFeatureKeys,
    })
  const mergedIncrementalMetadata =
    previousManifest && (overwriteExisting !== true || reusePreviousManifestOnOverwrite)
      ? mergeIncrementalFeatureStoreMetadata({
          featureStoreDir: resolvedFeatureStoreDir,
          previousManifest,
          writtenDateKeys,
          strategyModes,
          contextSurfaces,
          numericFeatureKeys,
        })
      : null
  if (mergedIncrementalMetadata) {
    partitions = mergedIncrementalMetadata.partitions
    coverage = mergedIncrementalMetadata.coverage
    contractMetadata = {
      strategyModes: mergedIncrementalMetadata.strategyModes,
      contextSurfaces: mergedIncrementalMetadata.contextSurfaces,
      numericFeatureKeys: mergedIncrementalMetadata.numericFeatureKeys,
    }
  } else {
    const allPartitions = await listPerfectPrototypePrejumpFeatureStorePartitions({
      featureStoreDir: resolvedFeatureStoreDir,
    })
    partitions = allPartitions.map((entry) => ({
      dateKey: entry.dateKey,
      parquetPath: entry.parquetPath,
      featureStatsParquetPath: entry.featureStatsParquetPath,
      featureValuesBinPath: entry.featureValuesBinPath,
      featureValuesIndexParquetPath: entry.featureValuesIndexParquetPath,
    }))
    coverage = buildCoverage(allPartitions.map((entry) => entry.dateKey))
    contractMetadata = await collectFeatureStoreContractMetadata({
      cwd,
      duckdb,
      partitions: allPartitions,
    })
  }
  if (
    sourcePackEffectiveDecisionCoverage?.from &&
    sourcePackEffectiveDecisionCoverage?.to &&
    (sourcePackEffectiveDecisionCoverage.from !== coverage.from ||
      sourcePackEffectiveDecisionCoverage.to !== coverage.to ||
      Number(sourcePackEffectiveDecisionCoverage.count ?? 0) !== Number(coverage.count ?? 0))
  ) {
    throw new Error(
      [
        "Predictive feature-store effective coverage does not match the source pack summary.",
        `sourcePackSummaryPath=${String(inputPackSummaryPath ?? "").trim() || "null"}`,
        `packEffectiveCoverage=${JSON.stringify(sourcePackEffectiveDecisionCoverage)}`,
        `featureStoreCoverage=${JSON.stringify(coverage)}`,
      ].join("\n"),
    )
  }
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    featureStoreDir: resolvedFeatureStoreDir,
    sourcePackSummaryPath: String(inputPackSummaryPath ?? "").trim() || null,
    requestedDecisionRange,
    effectiveDecisionCoverage: coverage,
    strategyMode: contractMetadata.strategyModes[0] ?? null,
    strategyModes: contractMetadata.strategyModes,
    surface: contractMetadata.contextSurfaces[0] ?? null,
    contextSurfaces: contractMetadata.contextSurfaces,
    featureVersion: contractMetadata.contextSurfaces[0] ?? null,
    numericFeatureKeys: contractMetadata.numericFeatureKeys,
    dataContractHash: buildFeatureStoreContractHash({
      strategyModes: contractMetadata.strategyModes,
      contextSurfaces: contractMetadata.contextSurfaces,
      numericFeatureKeys: contractMetadata.numericFeatureKeys,
    }),
    partitionCount: partitions.length,
    writtenPartitionCount: partitionCount,
    coverage,
    partitions,
  }
  await writeJson(manifestPath, manifest)
  return {
    featureStoreDir: resolvedFeatureStoreDir,
    manifestPath,
    manifest,
  }
}

export const assemblePerfectPrototypePrejumpPackFromFeatureStore = async ({
  cwd = process.cwd(),
  featureStoreDir,
  startDate,
  endDate,
  outDir,
  emitJsonl = false,
  limitRows = null,
  maxDecisionDates = null,
  maxRowsPerDate = null,
  decisionDateSamplingMode = "decision_date_stratified",
}) => {
  const resolvedLimitRows = Number.isInteger(Math.floor(Number(limitRows))) && Number(limitRows) > 0
    ? Math.floor(Number(limitRows))
    : null
  const resolvedMaxRowsPerDate =
    Number.isInteger(Math.floor(Number(maxRowsPerDate))) && Number(maxRowsPerDate) > 0
      ? Math.floor(Number(maxRowsPerDate))
      : null
  const LIMIT_REACHED_CODE = "PERFECT_PROTO_PREJUMP_FEATURE_STORE_LIMIT_REACHED"
  const PER_DATE_LIMIT_REACHED_CODE = "PERFECT_PROTO_PREJUMP_FEATURE_STORE_PER_DATE_LIMIT_REACHED"
  const primarySinkMode =
    String(process.env.PREJUMP_PRIMARY_SINK_MODE ?? "structured").trim().toLowerCase() || "structured"
  if (primarySinkMode !== PERFECT_PROTOTYPE_PRIMARY_SINK_MODE_STRUCTURED) {
    throw new Error(
      `Perfect prototype predictive pack sink mode must remain ${PERFECT_PROTOTYPE_PRIMARY_SINK_MODE_STRUCTURED}: ${primarySinkMode}`,
    )
  }
  const resolvedFeatureStoreDir = path.resolve(featureStoreDir)
  const partitions = await listPerfectPrototypePrejumpFeatureStorePartitions({
    featureStoreDir: resolvedFeatureStoreDir,
    startDate,
    endDate,
  })
  if (partitions.length < 1) {
    throw new Error(
      `No predictive feature-store partitions found for requested range: ${resolvedFeatureStoreDir} ${startDate ?? ""}..${endDate ?? ""}`.trim(),
    )
  }
  const selection = selectPerfectPrototypePrejumpDecisionDateStratifiedPartitions({
    partitions,
    maxDecisionDates,
    samplingMode: decisionDateSamplingMode,
  })
  const selectedPartitions = selection.selectedPartitions
  await ensureDir(outDir)
  const duckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const outputPath = path.join(outDir, "prejump_pack.parquet")
  const outputJsonlPath = emitJsonl ? path.join(outDir, "prejump_pack.jsonl") : null
  const progressPath = path.join(outDir, "progress.json")
  const schemaPath = path.join(outDir, "schema.json")
  const summaryPath = path.join(outDir, "summary.json")
  const sink = await createDuckdbStructuredToParquetSink({
    cwd,
    duckdb,
    parquetPath: outputPath,
    schema: PERFECT_PROTOTYPE_TYPED_WRAPPER_SINK_SCHEMA,
    sessionOverrides: {
      preserveInsertionOrder: true,
    },
  })
  const jsonlWriter = emitJsonl ? await createJsonlWriter(outputJsonlPath) : null
  let rowOrdinal = 0
  let rowsWritten = 0
  let truncatedByLimitRows = false
  let truncatedByMaxRowsPerDate = false
  const dateKeys = []
  const numericFeatureKeySet = new Set()
  const flushJsonlRow = async (row) => {
    if (!jsonlWriter) return
    await jsonlWriter.writeRow(row)
  }

  try {
    for (const partition of selectedPartitions) {
      let perDateRowsWritten = 0
      try {
        await readWrapperRowsByDate({
          cwd,
          duckdb,
          parquetPath: partition.parquetPath,
          onRow: async (row) => {
            if (resolvedLimitRows && rowsWritten >= resolvedLimitRows) {
              truncatedByLimitRows = true
              const error = new Error(LIMIT_REACHED_CODE)
              error.code = LIMIT_REACHED_CODE
              throw error
            }
            if (resolvedMaxRowsPerDate && perDateRowsWritten >= resolvedMaxRowsPerDate) {
              truncatedByMaxRowsPerDate = true
              const error = new Error(PER_DATE_LIMIT_REACHED_CODE)
              error.code = PER_DATE_LIMIT_REACHED_CODE
              throw error
            }
            await sink.writeRow(
              buildPerfectPrototypeTypedParquetWrapperRow({
                rowOrdinal,
                row,
              }),
            )
            rowOrdinal += 1
            rowsWritten += 1
            perDateRowsWritten += 1
            dateKeys.push(String(row?.dateKey ?? "").trim())
            for (const key of Object.keys(row?.numericFeatureMap ?? {})) {
              numericFeatureKeySet.add(key)
            }
            await flushJsonlRow(row)
          },
        })
      } catch (error) {
        if (error?.code !== LIMIT_REACHED_CODE && error?.code !== PER_DATE_LIMIT_REACHED_CODE) {
          throw error
        }
      }
      await writeJson(progressPath, {
        phase: "assemble_from_feature_store",
        rowsScanned: rowsWritten,
        rowsWritten,
        rowsContextualized: rowsWritten,
        distinctDecisionDatesWritten: uniqueSorted(dateKeys).length,
        sourcePartitionCount: partitions.length,
        selectedPartitionCount: selectedPartitions.length,
        updatedAt: new Date().toISOString(),
      })
      if (truncatedByLimitRows) {
        break
      }
    }
  } finally {
    if (jsonlWriter) {
      await jsonlWriter.close()
    }
  }

  await sink.close()
  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceMode: "feature_store",
    featureStoreDir: resolvedFeatureStoreDir,
    sourcePartitionCount: partitions.length,
    selectedPartitionCount: selectedPartitions.length,
    requestedPeriod: {
      from: startDate,
      to: endDate,
    },
    requestedDecisionRange: {
      from: startDate,
      to: endDate,
    },
    limitRowsApplied: resolvedLimitRows,
    maxDecisionDatesApplied:
      Number.isInteger(Math.floor(Number(maxDecisionDates))) && Number(maxDecisionDates) > 0
        ? Math.floor(Number(maxDecisionDates))
        : null,
    maxRowsPerDateApplied: resolvedMaxRowsPerDate,
    decisionDateSamplingMode: selection.samplingMode,
    decisionDateSamplingApplied: selection.samplingApplied === true,
    truncatedByLimitRows,
    truncatedByMaxRowsPerDate,
    rowCount: rowsWritten,
    rowsWritten,
    contextualDecisionDates: uniqueSorted(dateKeys).length,
    contextualDecisionMonths: uniqueSorted(dateKeys.map((dateKey) => String(dateKey ?? "").slice(0, 7))).length,
    effectiveDecisionCoverage: buildCoverage(dateKeys),
    outputCoverage: buildCoverage(dateKeys),
    selectedDecisionCoverage: selection.selectedDecisionCoverage,
    selectedDecisionDateCount: selection.selectedDecisionDateCount,
    selectedDecisionMonthCount: selection.selectedDecisionMonthCount,
    coverageComplete:
      truncatedByLimitRows !== true &&
      truncatedByMaxRowsPerDate !== true &&
      selection.samplingApplied !== true,
    storageFormat: "parquet",
    outputPath,
    outputJsonlPath,
    schemaPath,
    summaryPath,
    progressPath,
  }
  await writeJson(schemaPath, {
    storageFormat: "parquet",
    rowOrdinalColumn: "rowOrdinal",
    typedRowContract: true,
    numericFeatureMapColumn: "numericFeatureMap",
    categoricalTokensColumn: "categoricalTokens",
    numericFeatureKeys: Array.from(numericFeatureKeySet).sort((left, right) => left.localeCompare(right)),
    outputPath,
    outputJsonlPath,
  })
  await writeJson(summaryPath, summary)
  await writeJson(progressPath, {
    phase: "completed",
    rowsScanned: rowsWritten,
    rowsWritten,
    rowsContextualized: rowsWritten,
    distinctDecisionDatesWritten: uniqueSorted(dateKeys).length,
    sourcePartitionCount: partitions.length,
    selectedPartitionCount: selectedPartitions.length,
    updatedAt: new Date().toISOString(),
  })
  return {
    outputPath,
    summaryPath,
    summary,
  }
}
