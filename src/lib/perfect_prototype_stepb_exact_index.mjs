import path from "node:path"
import fsp from "node:fs/promises"
import v8 from "node:v8"

import { ensureDir, pathExists, readJson, writeJson, writeJsonAtomic, writeJsonl } from "./io.mjs"
import {
  preparePerfectPrototypeMiningSnapshot,
  PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
} from "./perfect_prototype_miner.mjs"
import {
  buildPerfectPrototypeTokenizerSpecHash,
  buildPerfectPrototypeTokenizerSpecFingerprintMetadata,
} from "./perfect_prototype_tokenizer_spec_integrity.mjs"
import {
  inferPerfectPrototypeDatasetContract,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
} from "./perfect_prototype_prejump_contract.mjs"
import {
  buildPerfectPrototypeDirectIndexProvenanceRecord,
  buildPerfectPrototypePartitionStateHash,
} from "./perfect_prototype_index_provenance.mjs"
import {
  appendPerfectPrototypeDeltaPostingsToFile,
  openPerfectPrototypePostingsFile,
} from "./perfect_prototype_postings_codec.mjs"
import {
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA,
  PERFECT_PROTOTYPE_TOKEN_ROW_LANE_META_SINK_SCHEMA,
  PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA,
  PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA,
} from "./perfect_prototype_token_index.mjs"
import {
  choosePerfectPrototypeRowTokenIdWidthBits,
  encodePerfectPrototypeRowTokenIdChunk,
  openPerfectPrototypeAtomicBinaryWriter,
  writePerfectPrototypeUint32ArrayAtomic,
} from "./perfect_prototype_row_token_index.mjs"
import {
  createDuckdbDelimitedToParquetSink,
  resolvePerfectPrototypeDuckdbCli,
} from "./perfect_prototype_duckdb.mjs"

export const PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_ARTIFACT_TYPE = "stepb_exact_compiled_index_v1"
export const PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_MANIFEST_VERSION = 1
export const PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_CONTRACT_VERSION = 1
export const PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_LAYOUT_COMPILED_DIRECT_V1 = "compiled_direct_v1"
export const PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_LAYOUT_INDEXED_ONLY_V1 = "indexed_only_v1"

const normalizeText = (value) => {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

const comparePerfectPrototypeTokenOrder = (left, right) => {
  const normalizedLeft = String(left ?? "")
  const normalizedRight = String(right ?? "")
  if (normalizedLeft < normalizedRight) return -1
  if (normalizedLeft > normalizedRight) return 1
  return 0
}

const writeBinaryAtomic = async (filePath, buffer) => {
  const dirPath = path.dirname(filePath)
  await ensureDir(dirPath)
  const tempPath = path.join(
    dirPath,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  let handle = null
  try {
    handle = await fsp.open(tempPath, "w")
    await handle.writeFile(buffer)
    await handle.sync()
    await handle.close()
    handle = null
    await fsp.rename(tempPath, filePath)
  } catch (error) {
    if (handle) {
      try {
        await handle.close()
      } catch {}
    }
    try {
      await fsp.unlink(tempPath)
    } catch {}
    throw error
  }
}

const assertSnapshotShape = ({ snapshot, snapshotPath }) => {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error(`Step-B exact compiled snapshot must be an object: ${snapshotPath}`)
  }
  if (!Array.isArray(snapshot?.rows)) {
    throw new Error(`Step-B exact compiled snapshot is missing rows: ${snapshotPath}`)
  }
  if (!snapshot?.tokenizerSpec || typeof snapshot.tokenizerSpec !== "object") {
    throw new Error(`Step-B exact compiled snapshot is missing tokenizerSpec: ${snapshotPath}`)
  }
  if (!Array.isArray(snapshot?.calendarDateKeys)) {
    throw new Error(`Step-B exact compiled snapshot is missing calendarDateKeys: ${snapshotPath}`)
  }
  if (!Array.isArray(snapshot?.tokenStatsEntries)) {
    throw new Error(`Step-B exact compiled snapshot is missing tokenStatsEntries: ${snapshotPath}`)
  }
  if (!(snapshot?.allPositiveRowIndexes instanceof Uint32Array)) {
    throw new Error(`Step-B exact compiled snapshot is missing allPositiveRowIndexes: ${snapshotPath}`)
  }
  if (!(snapshot?.allNegativeRowIndexes instanceof Uint32Array)) {
    throw new Error(`Step-B exact compiled snapshot is missing allNegativeRowIndexes: ${snapshotPath}`)
  }
  return snapshot
}

const assertManifestShape = ({ manifest, manifestPath, resolvedIndexDir, expectedSearchMode = null }) => {
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Step-B exact compiled manifest must be an object: ${manifestPath}`)
  }
  if (String(manifest?.artifactType ?? "").trim() !== PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_ARTIFACT_TYPE) {
    throw new Error(
      `Step-B exact compiled manifest artifactType mismatch: expected=${PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_ARTIFACT_TYPE} actual=${manifest?.artifactType ?? "null"} path=${manifestPath}`,
    )
  }
  if (Number(manifest?.version) !== PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_MANIFEST_VERSION) {
    throw new Error(
      `Step-B exact compiled manifest version mismatch: expected=${PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_MANIFEST_VERSION} actual=${manifest?.version ?? "null"} path=${manifestPath}`,
    )
  }
  if (Number(manifest?.contractVersion) !== PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_CONTRACT_VERSION) {
    throw new Error(
      `Step-B exact compiled manifest contractVersion mismatch: expected=${PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_CONTRACT_VERSION} actual=${manifest?.contractVersion ?? "null"} path=${manifestPath}`,
    )
  }
  const searchMode = String(manifest?.searchMode ?? "").trim()
  const layout = normalizeText(manifest?.layout) ?? PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_LAYOUT_COMPILED_DIRECT_V1
  if (searchMode !== PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE) {
    throw new Error(
      `Step-B exact compiled manifest requires searchMode=${PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE}: actual=${searchMode || "null"} path=${manifestPath}`,
    )
  }
  if (expectedSearchMode && searchMode !== expectedSearchMode) {
    throw new Error(
      `Step-B exact compiled manifest searchMode mismatch: expected=${expectedSearchMode} actual=${searchMode} path=${manifestPath}`,
    )
  }
  const snapshotPath = path.join(
    resolvedIndexDir,
    normalizeText(manifest?.snapshotPath) ?? "snapshot.bin",
  )
  const tokenizerSpecPath = path.join(
    resolvedIndexDir,
    normalizeText(manifest?.tokenizerSpecPath) ?? "tokenizer_spec.json",
  )
  const rowMetaPath = path.join(
    resolvedIndexDir,
    normalizeText(manifest?.rowMetaPath) ?? "row_meta.jsonl",
  )
  const rowLaneMetaParquetPath = normalizeText(manifest?.rowLaneMetaParquetPath)
    ? path.join(resolvedIndexDir, normalizeText(manifest?.rowLaneMetaParquetPath))
    : null
  const tokenizerSpecHash = String(manifest?.tokenizerSpecHash ?? "").trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/u.test(tokenizerSpecHash)) {
    throw new Error(`Step-B exact compiled manifest requires tokenizerSpecHash: ${manifestPath}`)
  }
  return {
    ...manifest,
    searchMode,
    layout,
    snapshotPath,
    tokenizerSpecPath,
    rowMetaPath,
    rowLaneMetaParquetPath,
    tokenizerSpecHash,
  }
}

export const resolvePerfectPrototypeStepbExactIndexPaths = (indexDir) => {
  const resolvedIndexDir = path.resolve(String(indexDir ?? "").trim())
  return {
    indexDir: resolvedIndexDir,
    manifestPath: path.join(resolvedIndexDir, "manifest.json"),
    tokenizerSpecPath: path.join(resolvedIndexDir, "tokenizer_spec.json"),
    snapshotPath: path.join(resolvedIndexDir, "snapshot.bin"),
    rowMetaPath: path.join(resolvedIndexDir, "row_meta.jsonl"),
    rowMetaParquetPath: path.join(resolvedIndexDir, "row_meta.parquet"),
    rowLaneMetaParquetPath: path.join(resolvedIndexDir, "row_lane_meta.parquet"),
    tokenStatsParquetPath: path.join(resolvedIndexDir, "token_stats.parquet"),
    tokenDictionaryParquetPath: path.join(resolvedIndexDir, "token_dictionary.parquet"),
    tokenPostingsBinPath: path.join(resolvedIndexDir, "token_postings.bin"),
    rowTokenOffsetsBinPath: path.join(resolvedIndexDir, "row_token_offsets.bin"),
    rowTokenIdsBinPath: path.join(resolvedIndexDir, "row_token_ids.bin"),
    summaryPath: path.join(resolvedIndexDir, "summary.json"),
  }
}

const buildTokenStatsRows = (tokenStatsEntries) =>
  (Array.isArray(tokenStatsEntries) ? tokenStatsEntries : [])
    .map((entry) => {
      const token = String(entry?.token ?? "").trim()
      const positiveMatchCount = Math.max(0, Math.floor(Number(entry?.positiveMatchCount ?? 0) || 0))
      const negativeMatchCount = Math.max(0, Math.floor(Number(entry?.negativeMatchCount ?? 0) || 0))
      const matchCount = positiveMatchCount + negativeMatchCount
      return {
        token,
        positiveMatchCount,
        negativeMatchCount,
        precision: matchCount > 0 ? positiveMatchCount / matchCount : 0,
        separationRatio: positiveMatchCount / (negativeMatchCount + 1),
        separationLift: positiveMatchCount - negativeMatchCount,
        positiveRowIndexes: entry?.positiveRowIndexes ?? new Uint32Array(),
        negativeRowIndexes: entry?.negativeRowIndexes ?? new Uint32Array(),
      }
    })
    .filter((entry) => entry.token)
    .sort((left, right) => comparePerfectPrototypeTokenOrder(left.token, right.token))

const writeRowsWithParquetSink = async ({ sink, rows, batchSize = 512 }) => {
  let completed = false
  try {
    const batch = []
    const safeRows = Array.isArray(rows) ? rows : []
    for (const row of safeRows) {
      batch.push(row)
      if (batch.length >= batchSize) {
        await sink.writeRows(batch)
        batch.length = 0
      }
    }
    if (batch.length > 0) {
      await sink.writeRows(batch)
      batch.length = 0
    }
    completed = true
  } finally {
    if (!completed) {
      await sink.abort().catch(() => {})
      return
    }
    await sink.close()
  }
}

const writeRowTokenAdjacencyArtifacts = async ({
  rowCount,
  tokenStatsRows,
  paths,
}) => {
  const safeTokenStatsRows = Array.isArray(tokenStatsRows) ? tokenStatsRows : []
  const safeRowCount = Math.max(0, Math.floor(Number(rowCount) || 0))
  const tokenIdByToken = new Map()
  for (let tokenIndex = 0; tokenIndex < safeTokenStatsRows.length; tokenIndex += 1) {
    const token = String(safeTokenStatsRows[tokenIndex]?.token ?? "").trim()
    if (!token) continue
    tokenIdByToken.set(token, tokenIndex)
  }
  const rowTokenIdWidthBits = choosePerfectPrototypeRowTokenIdWidthBits({
    tokenCount: safeTokenStatsRows.length,
  })
  const rowTokenOffsets = new Uint32Array(safeRowCount + 1)
  const rowTokenIdsWriter = await openPerfectPrototypeAtomicBinaryWriter({
    filePath: paths.rowTokenIdsBinPath,
  })
  try {
    for (let tokenIndex = 0; tokenIndex < safeTokenStatsRows.length; tokenIndex += 1) {
      const entry = safeTokenStatsRows[tokenIndex]
      const token = String(entry?.token ?? "").trim()
      const tokenId = tokenIdByToken.get(token)
      if (!Number.isInteger(tokenId) || tokenId < 0) {
        throw new Error(
          `Step-B exact compiled index row token adjacency is missing token id: token=${token || "<empty>"}`,
        )
      }
      const applyRowIndexCounts = (rowIndexes, label) => {
        const safeRowIndexes =
          rowIndexes instanceof Uint32Array || Array.isArray(rowIndexes) ? rowIndexes : []
        for (const rawRowIndex of safeRowIndexes) {
          const rowIndex = Number(rawRowIndex)
          if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= safeRowCount) {
            throw new Error(
              `Step-B exact compiled index row token adjacency encountered invalid ${label} row index: token=${token} rowIndex=${rawRowIndex} rowCount=${safeRowCount}`,
            )
          }
          rowTokenOffsets[rowIndex + 1] += 1
        }
      }
      applyRowIndexCounts(entry?.positiveRowIndexes, "positive")
      applyRowIndexCounts(entry?.negativeRowIndexes, "negative")
    }
    for (let rowIndex = 0; rowIndex < safeRowCount; rowIndex += 1) {
      rowTokenOffsets[rowIndex + 1] += rowTokenOffsets[rowIndex]
    }
    const tokenPostingCount = Number(rowTokenOffsets[safeRowCount] ?? 0)
    const rowWriteOffsets = rowTokenOffsets.slice(0, safeRowCount)
    const rowTokenIds =
      rowTokenIdWidthBits === 16
        ? new Uint16Array(tokenPostingCount)
        : new Uint32Array(tokenPostingCount)
    for (let tokenIndex = 0; tokenIndex < safeTokenStatsRows.length; tokenIndex += 1) {
      const entry = safeTokenStatsRows[tokenIndex]
      const token = String(entry?.token ?? "").trim()
      const tokenId = tokenIdByToken.get(token)
      const appendRowIndexes = (rowIndexes, label) => {
        const safeRowIndexes =
          rowIndexes instanceof Uint32Array || Array.isArray(rowIndexes) ? rowIndexes : []
        for (const rawRowIndex of safeRowIndexes) {
          const rowIndex = Number(rawRowIndex)
          if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= safeRowCount) {
            throw new Error(
              `Step-B exact compiled index row token adjacency encountered invalid ${label} row index during write: token=${token} rowIndex=${rawRowIndex} rowCount=${safeRowCount}`,
            )
          }
          const writeOffset = Number(rowWriteOffsets[rowIndex] ?? -1)
          if (
            !Number.isInteger(writeOffset) ||
            writeOffset < Number(rowTokenOffsets[rowIndex] ?? 0) ||
            writeOffset >= Number(rowTokenOffsets[rowIndex + 1] ?? 0)
          ) {
            throw new Error(
              `Step-B exact compiled index row token adjacency write cursor overflow: token=${token} rowIndex=${rowIndex} writeOffset=${writeOffset}`,
            )
          }
          rowTokenIds[writeOffset] = tokenId
          rowWriteOffsets[rowIndex] = writeOffset + 1
        }
      }
      appendRowIndexes(entry?.positiveRowIndexes, "positive")
      appendRowIndexes(entry?.negativeRowIndexes, "negative")
    }
    for (let rowIndex = 0; rowIndex < safeRowCount; rowIndex += 1) {
      const terminalOffset = Number(rowWriteOffsets[rowIndex] ?? -1)
      const expectedTerminalOffset = Number(rowTokenOffsets[rowIndex + 1] ?? -1)
      if (terminalOffset !== expectedTerminalOffset) {
        throw new Error(
          `Step-B exact compiled index row token adjacency terminal offset mismatch: rowIndex=${rowIndex} actual=${terminalOffset} expected=${expectedTerminalOffset}`,
        )
      }
    }
    await rowTokenIdsWriter.appendBuffer(
      encodePerfectPrototypeRowTokenIdChunk({
        tokenIds: rowTokenIds,
        widthBits: rowTokenIdWidthBits,
      }),
    )
    await writePerfectPrototypeUint32ArrayAtomic({
      filePath: paths.rowTokenOffsetsBinPath,
      values: rowTokenOffsets,
    })
    await rowTokenIdsWriter.commit()
  } catch (error) {
    await rowTokenIdsWriter.abort().catch(() => {})
    throw error
  }
  return {
    rowTokenIdWidthBits,
    tokenPostingCount: Number(rowTokenOffsets[safeRowCount] ?? 0),
  }
}

const buildStrategyModeForRowMeta = (snapshotRows, datasetContract) => {
  const strategyModes = Array.from(
    new Set(
      (Array.isArray(snapshotRows) ? snapshotRows : [])
        .map((row) => String(row?.strategyMode ?? "").trim())
        .filter(Boolean),
    ),
  )
  if (strategyModes.length === 1) return strategyModes[0]
  return String(datasetContract?.strategyMode ?? "").trim() || null
}

const writeParallelFrontierArtifacts = async ({
  cwd = process.cwd(),
  snapshot,
  paths,
  datasetContract,
}) => {
  const resolvedDuckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const rowStrategyMode = buildStrategyModeForRowMeta(snapshot?.rows, datasetContract)
  const rowMetaRows = (Array.isArray(snapshot?.rows) ? snapshot.rows : []).map((row, rowIdx) => ({
    rowIdx,
    sourceType: row?.sourceType ?? null,
    sourceId: row?.sourceId ?? null,
    dateKey: row?.dateKey ?? null,
    symbol: row?.symbol ?? null,
    outcomeHitTarget: row?.outcomeHitTarget === true,
    strategyMode: rowStrategyMode,
  }))
  const rowLaneMetaRows = (Array.isArray(snapshot?.rows) ? snapshot.rows : []).map((row, rowIdx) => ({
    rowIdx,
    stepALaneId: String(row?.stepALaneId ?? "").trim() || null,
    impulseLookbackDays:
      Number.isInteger(Number(row?.impulseLookbackDays)) && Number(row?.impulseLookbackDays) >= 0
        ? Number(row.impulseLookbackDays)
        : null,
  }))
  const rowMetaSink = await createDuckdbDelimitedToParquetSink({
    cwd,
    duckdb: resolvedDuckdb,
    parquetPath: paths.rowMetaParquetPath,
    schema: PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA,
  })
  await writeRowsWithParquetSink({
    sink: rowMetaSink,
    rows: rowMetaRows,
    batchSize: 1024,
  })
  const rowLaneMetaSink = await createDuckdbDelimitedToParquetSink({
    cwd,
    duckdb: resolvedDuckdb,
    parquetPath: paths.rowLaneMetaParquetPath,
    schema: PERFECT_PROTOTYPE_TOKEN_ROW_LANE_META_SINK_SCHEMA,
  })
  await writeRowsWithParquetSink({
    sink: rowLaneMetaSink,
    rows: rowLaneMetaRows,
    batchSize: 1024,
  })

  const tokenStatsRows = buildTokenStatsRows(snapshot?.tokenStatsEntries)
  const tokenStatsSink = await createDuckdbDelimitedToParquetSink({
    cwd,
    duckdb: resolvedDuckdb,
    parquetPath: paths.tokenStatsParquetPath,
    schema: PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA,
  })
  await writeRowsWithParquetSink({
    sink: tokenStatsSink,
    rows: tokenStatsRows.map((row) => ({
      token: row.token,
      positiveMatchCount: row.positiveMatchCount,
      negativeMatchCount: row.negativeMatchCount,
      precision: row.precision,
      separationRatio: row.separationRatio,
      separationLift: row.separationLift,
    })),
    batchSize: 1024,
  })

  await fsp.rm(paths.tokenPostingsBinPath, { force: true })
  const postingsHandle = await openPerfectPrototypePostingsFile(paths.tokenPostingsBinPath, "w")
  const tokenDictionarySink = await createDuckdbDelimitedToParquetSink({
    cwd,
    duckdb: resolvedDuckdb,
    parquetPath: paths.tokenDictionaryParquetPath,
    schema: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA,
  })
  let postingsByteOffset = 0
  try {
    const rows = []
    for (const entry of tokenStatsRows) {
      const positiveMeta = await appendPerfectPrototypeDeltaPostingsToFile({
        fileHandle: postingsHandle,
        values: entry.positiveRowIndexes,
        offset: postingsByteOffset,
      })
      postingsByteOffset += positiveMeta.byteLength
      const negativeMeta = await appendPerfectPrototypeDeltaPostingsToFile({
        fileHandle: postingsHandle,
        values: entry.negativeRowIndexes,
        offset: postingsByteOffset,
      })
      postingsByteOffset += negativeMeta.byteLength
      rows.push({
        token: entry.token,
        positiveOffset: positiveMeta.offset,
        positiveByteLength: positiveMeta.byteLength,
        positiveCount: positiveMeta.count,
        positiveFirstRowIdx: positiveMeta.firstRowIdx,
        positiveLastRowIdx: positiveMeta.lastRowIdx,
        negativeOffset: negativeMeta.offset,
        negativeByteLength: negativeMeta.byteLength,
        negativeCount: negativeMeta.count,
        negativeFirstRowIdx: negativeMeta.firstRowIdx,
        negativeLastRowIdx: negativeMeta.lastRowIdx,
        positiveMatchCount: entry.positiveMatchCount,
        negativeMatchCount: entry.negativeMatchCount,
        precision: entry.precision,
        separationRatio: entry.separationRatio,
        separationLift: entry.separationLift,
      })
    }
    await writeRowsWithParquetSink({
      sink: tokenDictionarySink,
      rows,
      batchSize: 512,
    })
  } finally {
    await postingsHandle.close().catch(() => {})
  }

  return {
    rowMetaCount: rowMetaRows.length,
    rowLaneMetaCount: rowLaneMetaRows.length,
    tokenCount: tokenStatsRows.length,
  }
}

export const buildPerfectPrototypeStepbExactIndex = async ({
  cwd = process.cwd(),
  rows,
  outDir,
  inputPath = null,
  inputSha256 = null,
  surfaceName = null,
  options = {},
}) => {
  const paths = resolvePerfectPrototypeStepbExactIndexPaths(outDir)
  const sourceRows = Array.isArray(rows) ? rows : []
  const datasetContract = inferPerfectPrototypeDatasetContract(sourceRows)
  const prepared = preparePerfectPrototypeMiningSnapshot({
    rows: sourceRows,
    options: {
      ...options,
      searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
      surfaceName: surfaceName ?? options?.surfaceName ?? null,
    },
  })
  const snapshot = assertSnapshotShape({
    snapshot: prepared.snapshot,
    snapshotPath: paths.snapshotPath,
  })
  if (datasetContract.strategyMode === PREJUMP_PREDICTIVE_STRATEGY_MODE) {
    throw new Error(
      "Step-B exact compiled index cannot be built for predictive dataset contracts; use predictive parquet/indexed mining instead.",
    )
  }
  const tokenizerSpecHash = buildPerfectPrototypeTokenizerSpecHash(snapshot.tokenizerSpec)
  const tokenizerFingerprintMetadata = buildPerfectPrototypeTokenizerSpecFingerprintMetadata(
    snapshot.tokenizerSpec,
  )
  const datasetSourceType =
    Array.from(
      new Set(
        (Array.isArray(snapshot?.rows) ? snapshot.rows : [])
          .map((row) => String(row?.sourceType ?? "").trim())
          .filter(Boolean),
      ),
    )[0] ?? null
  const datasetStrategyMode = String(datasetContract?.strategyMode ?? "").trim() || null
  const inputProvenance =
    normalizeText(inputPath) != null
      ? buildPerfectPrototypeDirectIndexProvenanceRecord({
          inputPath,
          inputPaths: [inputPath],
          inputStateHash: await buildPerfectPrototypePartitionStateHash([inputPath]),
        })
      : null
  const parallelArtifacts = await writeParallelFrontierArtifacts({
    cwd,
    snapshot,
    paths,
    datasetContract,
  })
  const tokenStatsRows = buildTokenStatsRows(snapshot?.tokenStatsEntries)
  const rowTokenAdjacency = await writeRowTokenAdjacencyArtifacts({
    rowCount: snapshot?.rows?.length ?? 0,
    tokenStatsRows,
    paths,
  })
  const manifest = {
    artifactType: PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_ARTIFACT_TYPE,
    version: PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_MANIFEST_VERSION,
    contractVersion: PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_CONTRACT_VERSION,
    layout: PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_LAYOUT_COMPILED_DIRECT_V1,
    ...tokenizerFingerprintMetadata,
    generatedAt: new Date().toISOString(),
    inputPath: normalizeText(inputPath),
    inputSha256: normalizeText(inputSha256)?.toLowerCase() ?? null,
    surfaceName: normalizeText(surfaceName ?? options?.surfaceName ?? null),
    sourceType: datasetSourceType,
    strategyMode: datasetStrategyMode,
    searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
    trainStartDate: normalizeText(options?.trainStartDate),
    trainEndDate: normalizeText(options?.trainEndDate),
    tokenizerSpecHash,
    tokenizerSpecPath: path.basename(paths.tokenizerSpecPath),
    snapshotPath: path.basename(paths.snapshotPath),
    rowMetaPath: path.basename(paths.rowMetaPath),
    rowMetaParquetPath: path.basename(paths.rowMetaParquetPath),
    rowLaneMetaParquetPath: path.basename(paths.rowLaneMetaParquetPath),
    tokenStatsParquetPath: path.basename(paths.tokenStatsParquetPath),
    tokenDictionaryParquetPath: path.basename(paths.tokenDictionaryParquetPath),
    tokenPostingsBinPath: path.basename(paths.tokenPostingsBinPath),
    rowTokenOffsetsBinPath: path.basename(paths.rowTokenOffsetsBinPath),
    rowTokenIdsBinPath: path.basename(paths.rowTokenIdsBinPath),
    rowTokenIdWidthBits: rowTokenAdjacency.rowTokenIdWidthBits,
    rowCount: snapshot.rows.length,
    tokenPostingCount: rowTokenAdjacency.tokenPostingCount,
    tokenCount: snapshot.tokenStatsEntries.length,
    positiveRowCount: snapshot.allPositiveRowIndexes.length,
    negativeRowCount: snapshot.allNegativeRowIndexes.length,
    calendarDateCount: snapshot.calendarDateKeys.length,
    partitioned: false,
    inputProvenance,
    datasetContract,
  }
  const summary = {
    ...tokenizerFingerprintMetadata,
    inputPath: normalizeText(inputPath),
    surfaceName: normalizeText(surfaceName ?? options?.surfaceName ?? null),
    searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
    inputSha256: normalizeText(inputSha256)?.toLowerCase() ?? null,
    sourceType: datasetSourceType,
    strategyMode: datasetStrategyMode,
    rows: snapshot.rows.length,
    tokenPostingCount: rowTokenAdjacency.tokenPostingCount,
    tokenCount: snapshot.tokenStatsEntries.length,
    inputProvenance,
    parallelArtifacts,
    manifest,
  }
  await ensureDir(paths.indexDir)
  await writeBinaryAtomic(paths.snapshotPath, v8.serialize(snapshot))
  await writeJsonAtomic(paths.tokenizerSpecPath, snapshot.tokenizerSpec)
  await writeJsonl(
    paths.rowMetaPath,
    snapshot.rows.map((row) => ({
      sourceType: row?.sourceType ?? null,
      sourceId: row?.sourceId ?? null,
      dateKey: row?.dateKey ?? null,
      symbol: row?.symbol ?? null,
      outcomeHitTarget: row?.outcomeHitTarget === true,
    })),
  )
  await writeJsonAtomic(paths.manifestPath, manifest)
  await writeJsonAtomic(paths.summaryPath, summary)
  return {
    paths,
    manifest,
    summary,
    tokenizerSpecHash,
    tokenizerFingerprintMetadata,
    inputProvenance,
    parallelArtifacts,
    snapshot,
    phaseTimings: prepared.phaseTimings,
  }
}

export const loadPerfectPrototypeStepbExactIndex = async ({
  indexDir,
  expectedSearchMode = PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
}) => {
  const paths = resolvePerfectPrototypeStepbExactIndexPaths(indexDir)
  if (!pathExists(paths.manifestPath)) {
    throw new Error(`Step-B exact compiled index is missing manifest.json: ${paths.indexDir}`)
  }
  const manifest = assertManifestShape({
    manifest: await readJson(paths.manifestPath, null),
    manifestPath: paths.manifestPath,
    resolvedIndexDir: paths.indexDir,
    expectedSearchMode,
  })
  if (manifest.layout === PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_LAYOUT_INDEXED_ONLY_V1) {
    throw new Error(
      [
        "Step-B exact index is indexed-only and cannot be loaded through the direct snapshot path.",
        `indexDir=${paths.indexDir}`,
        "Use: node tools/mine_perfect_prototypes_indexed.mjs --index-dir=<index_dir> --out-dir=<mine_dir>",
      ].join("\n"),
    )
  }
  if (!pathExists(manifest.snapshotPath)) {
    throw new Error(`Step-B exact compiled index is missing snapshot.bin: ${manifest.snapshotPath}`)
  }
  if (!pathExists(manifest.tokenizerSpecPath)) {
    throw new Error(
      `Step-B exact compiled index is missing tokenizer_spec.json: ${manifest.tokenizerSpecPath}`,
    )
  }
  const tokenizerSpec = await readJson(manifest.tokenizerSpecPath, null)
  if (!tokenizerSpec || typeof tokenizerSpec !== "object") {
    throw new Error(`Step-B exact compiled tokenizer spec must be an object: ${manifest.tokenizerSpecPath}`)
  }
  const tokenizerSpecHash = buildPerfectPrototypeTokenizerSpecHash(tokenizerSpec)
  if (tokenizerSpecHash !== manifest.tokenizerSpecHash) {
    throw new Error(
      `Step-B exact compiled tokenizer spec hash mismatch: expected=${manifest.tokenizerSpecHash} actual=${tokenizerSpecHash} path=${manifest.tokenizerSpecPath}`,
    )
  }
  const snapshot = assertSnapshotShape({
    snapshot: v8.deserialize(await fsp.readFile(manifest.snapshotPath)),
    snapshotPath: manifest.snapshotPath,
  })
  const snapshotTokenizerSpecHash = buildPerfectPrototypeTokenizerSpecHash(snapshot.tokenizerSpec)
  if (snapshotTokenizerSpecHash !== manifest.tokenizerSpecHash) {
    throw new Error(
      `Step-B exact compiled snapshot tokenizer spec hash mismatch: expected=${manifest.tokenizerSpecHash} actual=${snapshotTokenizerSpecHash} path=${manifest.snapshotPath}`,
    )
  }
  return {
    paths,
    manifest,
    snapshot,
    tokenizerSpec,
  }
}

export const writePerfectPrototypeStepbExactIndexSummary = async ({ outDir, summary }) => {
  const paths = resolvePerfectPrototypeStepbExactIndexPaths(outDir)
  await ensureDir(paths.indexDir)
  await writeJson(paths.summaryPath, summary)
  return paths.summaryPath
}
