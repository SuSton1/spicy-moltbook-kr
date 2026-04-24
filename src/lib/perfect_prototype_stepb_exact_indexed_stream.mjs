import path from "node:path"
import fsp from "node:fs/promises"

import {
  ensureDir,
  iterateJsonl,
  pathExists,
  writeJsonAtomic,
} from "./io.mjs"
import {
  buildDelimitedSelectSqlFromSchema,
  createDuckdbDelimitedToParquetSink,
  createDuckdbDelimitedToTableSink,
  resolvePerfectPrototypeDuckdbCli,
} from "./perfect_prototype_duckdb.mjs"
import {
  buildPerfectPrototypeDirectIndexProvenanceRecord,
  buildPerfectPrototypePartitionStateHash,
  assertPerfectPrototypeCleanOutputDir,
} from "./perfect_prototype_index_provenance.mjs"
import {
  appendPerfectPrototypeDeltaPostingsToFile,
  openPerfectPrototypePostingsFile,
} from "./perfect_prototype_postings_codec.mjs"
import {
  PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_ARTIFACT_TYPE,
  PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_CONTRACT_VERSION,
  PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_LAYOUT_INDEXED_ONLY_V1,
  PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_MANIFEST_VERSION,
  resolvePerfectPrototypeStepbExactIndexPaths,
} from "./perfect_prototype_stepb_exact_index.mjs"
import { PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE } from "./perfect_prototype_miner.mjs"
import {
  normalizePerfectPrototypeRow,
  summarizePerfectPrototypeTokenizerSpec,
  tokenizePerfectPrototypeRow,
} from "./perfect_prototype_tokenizer.mjs"
import {
  buildPerfectPrototypeTokenizerSpecFingerprintMetadata,
  buildPerfectPrototypeTokenizerSpecHash,
} from "./perfect_prototype_tokenizer_spec_integrity.mjs"
import {
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS,
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SCHEMA_VERSION,
  PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA,
  PERFECT_PROTOTYPE_TOKEN_POSTINGS_SINK_SCHEMA,
  PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA,
  PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA,
} from "./perfect_prototype_token_index.mjs"
import {
  choosePerfectPrototypeRowTokenIdWidthBits,
  encodePerfectPrototypeRowTokenIdChunk,
  openPerfectPrototypeAtomicBinaryWriter,
  writePerfectPrototypeUint32ArrayAtomic,
} from "./perfect_prototype_row_token_index.mjs"

const normalizeText = (value) => {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

const hrtimeSecondsSince = (startedAt) =>
  Number(process.hrtime.bigint() - startedAt) / 1_000_000_000

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const comparePerfectPrototypeTokenOrder = (left, right) => {
  const normalizedLeft = String(left ?? "")
  const normalizedRight = String(right ?? "")
  if (normalizedLeft < normalizedRight) return -1
  if (normalizedLeft > normalizedRight) return 1
  return 0
}

const hasMeaningfulValue = (value) => {
  if (value == null) return false
  if (Array.isArray(value)) return value.some((entry) => hasMeaningfulValue(entry))
  if (typeof value === "object") {
    return Object.values(value).some((entry) => hasMeaningfulValue(entry))
  }
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "boolean") return true
  return String(value).trim().length > 0
}

const buildCoverageFromDateKeys = (dateKeys) => {
  const sorted = uniqueSorted(dateKeys)
  return {
    from: sorted[0] ?? null,
    to: sorted[sorted.length - 1] ?? null,
    count: sorted.length,
  }
}

const updateProgress = async (progressPath, payload) => {
  await writeJsonAtomic(progressPath, payload)
}

const buildTimedProgressPayload = ({
  payload,
  startedAtMs = null,
  estimatedRows = null,
}) => {
  const next = {
    ...payload,
    rssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
    heapUsedMb: Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)),
    updatedAt: new Date().toISOString(),
  }
  const elapsedSec =
    Number.isFinite(startedAtMs) && startedAtMs > 0
      ? Math.max(0.001, (Date.now() - startedAtMs) / 1000)
      : null
  if (!elapsedSec) {
    next.rowsPerSec = null
    next.tokensPerSec = null
    next.etaSeconds = null
    return next
  }
  const rowsScanned = Number(payload?.rowsScanned ?? 0)
  const tokensIndexed = Number(payload?.tokensIndexed ?? 0)
  const rowsPerSec = rowsScanned > 0 ? rowsScanned / elapsedSec : 0
  const tokensPerSec = tokensIndexed > 0 ? tokensIndexed / elapsedSec : 0
  next.rowsPerSec = Number(rowsPerSec.toFixed(3))
  next.tokensPerSec = Number(tokensPerSec.toFixed(3))
  next.etaSeconds =
    Number.isFinite(estimatedRows) && estimatedRows > rowsScanned && rowsPerSec > 0
      ? Number(((estimatedRows - rowsScanned) / rowsPerSec).toFixed(1))
      : payload?.phase === "completed"
        ? 0
        : null
  return next
}

const buildDatasetContractFromStreamState = (state) => {
  const strategyModes = uniqueSorted(Array.from(state.strategyModes))
  return {
    rowCount: state.rowsScanned,
    strategyModes,
    strategyMode: strategyModes.length === 1 ? strategyModes[0] : null,
    minDateKey: state.minDateKey,
    maxDateKey: state.maxDateKey,
    hasMeaningfulEventMetaRows: state.hasMeaningfulEventMetaRows,
    hasMeaningfulEventFeatureRows: state.hasMeaningfulEventFeatureRows,
    hasForbiddenPredictiveTags: state.hasForbiddenPredictiveTags,
  }
}

const removeArtifacts = async (paths) => {
  for (const filePath of Array.isArray(paths) ? paths : []) {
    const resolved = String(filePath ?? "").trim()
    if (!resolved) continue
    await fsp.rm(resolved, { force: true, recursive: false }).catch(() => {})
  }
}

export const buildPerfectPrototypeStepbExactIndexedStream = async ({
  cwd = process.cwd(),
  inputPath,
  inputSha256 = null,
  tokenizerSpec,
  tokenizerSpecPath = null,
  outDir,
  options = {},
}) => {
  const resolvedInputPath = path.resolve(String(inputPath ?? "").trim())
  const resolvedOutDir = path.resolve(String(outDir ?? "").trim())
  if (!resolvedInputPath) {
    throw new Error("Step-B streamed exact indexed build requires inputPath")
  }
  if (!resolvedOutDir) {
    throw new Error("Step-B streamed exact indexed build requires outDir")
  }
  if (!tokenizerSpec || typeof tokenizerSpec !== "object") {
    throw new Error("Step-B streamed exact indexed build requires a tokenizerSpec object")
  }
  const tokenizerSurface = String(tokenizerSpec?.surface ?? "").trim().toLowerCase()
  if (!tokenizerSurface) {
    throw new Error("Step-B streamed exact indexed build tokenizerSpec is missing surface")
  }
  const paths = resolvePerfectPrototypeStepbExactIndexPaths(resolvedOutDir)
  await assertPerfectPrototypeCleanOutputDir({
    dirPath: resolvedOutDir,
    label: "Step-B streamed exact indexed output directory",
  })
  await ensureDir(resolvedOutDir)
  const resolvedDuckdb = await resolvePerfectPrototypeDuckdbCli({ cwd })
  const tokenizerSpecHash = buildPerfectPrototypeTokenizerSpecHash(tokenizerSpec)
  const tokenizerFingerprintMetadata = buildPerfectPrototypeTokenizerSpecFingerprintMetadata(tokenizerSpec)
  const progressPath = path.join(resolvedOutDir, "progress.json")

  const artifactPaths = [
    paths.rowMetaParquetPath,
    paths.tokenStatsParquetPath,
    paths.tokenDictionaryParquetPath,
    paths.tokenPostingsBinPath,
    paths.rowTokenOffsetsBinPath,
    paths.rowTokenIdsBinPath,
    paths.tokenizerSpecPath,
    paths.manifestPath,
    paths.summaryPath,
    progressPath,
  ]

  const startedAt = process.hrtime.bigint()
  const scanStartedAtMs = Date.now()

  const rowMetaSink = await createDuckdbDelimitedToParquetSink({
    cwd,
    duckdb: resolvedDuckdb,
    parquetPath: paths.rowMetaParquetPath,
    schema: PERFECT_PROTOTYPE_TOKEN_ROW_META_SINK_SCHEMA,
  })
  const tokenPostingsSink = await createDuckdbDelimitedToTableSink({
    cwd,
    duckdb: resolvedDuckdb,
    tableName: "__stepb_exact_stream_token_postings__",
    schema: PERFECT_PROTOTYPE_TOKEN_POSTINGS_SINK_SCHEMA,
  })

  let buildSucceeded = false
  try {
    await writeJsonAtomic(paths.tokenizerSpecPath, tokenizerSpec)
    await updateProgress(
      progressPath,
      buildTimedProgressPayload({
        payload: {
          phase: "stream_pack_rows",
          rowsScanned: 0,
          rowsTokenized: 0,
          tokensIndexed: 0,
        },
        startedAtMs: scanStartedAtMs,
      }),
    )

    const streamState = {
      rowsScanned: 0,
      rowsTokenized: 0,
      tokenRows: 0,
      positiveRowCount: 0,
      negativeRowCount: 0,
      minDateKey: null,
      maxDateKey: null,
      sourceType: null,
      strategyMode: null,
      strategyModes: new Set(),
      dateKeySet: new Set(),
      hasMeaningfulEventMetaRows: false,
      hasMeaningfulEventFeatureRows: false,
      hasForbiddenPredictiveTags: false,
    }
    const tokenStats = new Map()
    const rowMetaBatch = []
    const tokenPostingsBatch = []
    let rowMetaSucceeded = false
    let lastProgressAt = Date.now()
    const flushRowMetaBatch = async () => {
      if (rowMetaBatch.length < 1) return
      await rowMetaSink.writeRows(rowMetaBatch)
      rowMetaBatch.length = 0
    }
    const flushTokenPostingsBatch = async () => {
      if (tokenPostingsBatch.length < 1) return
      await tokenPostingsSink.writeRows(tokenPostingsBatch)
      tokenPostingsBatch.length = 0
    }

    const streamInputStartedAt = process.hrtime.bigint()
    try {
      await iterateJsonl(resolvedInputPath, {
        strict: true,
        onRow: async (row) => {
          const normalized = normalizePerfectPrototypeRow(row, {
            ...(tokenizerSpec?.options ?? {}),
            surfaceName: tokenizerSurface,
          })
          if (!normalized?.dateKey || !normalized?.symbol || typeof normalized?.outcomeHitTarget !== "boolean") {
            return
          }
          if (options?.trainStartDate && normalized.dateKey < options.trainStartDate) return
          if (options?.trainEndDate && normalized.dateKey > options.trainEndDate) return
          const rowIdx = streamState.rowsScanned
          const sourceType = String(normalized?.sourceType ?? "").trim()
          const strategyMode = normalizeText(normalized?.strategyMode)
          if (!sourceType) {
            throw new Error(`Step-B streamed exact indexed build requires non-empty sourceType: rowIdx=${rowIdx}`)
          }
          if (streamState.rowsScanned === 0) {
            streamState.sourceType = sourceType
            streamState.strategyMode = strategyMode
          } else {
            if (sourceType !== streamState.sourceType) {
              throw new Error(
                `Step-B streamed exact indexed build requires a single sourceType: expected=${streamState.sourceType} actual=${sourceType} rowIdx=${rowIdx}`,
              )
            }
            if ((strategyMode ?? null) !== (streamState.strategyMode ?? null)) {
              throw new Error(
                `Step-B streamed exact indexed build requires a single strategyMode: expected=${streamState.strategyMode ?? "null"} actual=${strategyMode ?? "null"} rowIdx=${rowIdx}`,
              )
            }
          }
          if (strategyMode) {
            streamState.strategyModes.add(strategyMode)
          }
          streamState.rowsScanned += 1
          streamState.rowsTokenized += 1
          if (!streamState.minDateKey || normalized.dateKey < streamState.minDateKey) {
            streamState.minDateKey = normalized.dateKey
          }
          if (!streamState.maxDateKey || normalized.dateKey > streamState.maxDateKey) {
            streamState.maxDateKey = normalized.dateKey
          }
          streamState.dateKeySet.add(normalized.dateKey)
          if (hasMeaningfulValue(normalized?.raw?.eventMeta)) {
            streamState.hasMeaningfulEventMetaRows = true
          }
          if (hasMeaningfulValue(normalized?.eventFeatureVec)) {
            streamState.hasMeaningfulEventFeatureRows = true
          }
          const normalizedTags = [
            ...(Array.isArray(normalized?.categoricalTokens) ? normalized.categoricalTokens : []),
          ]
          if (normalizedTags.some((token) => String(token ?? "").startsWith("tag:event."))) {
            streamState.hasForbiddenPredictiveTags = true
          }
          if (normalized.outcomeHitTarget === true) {
            streamState.positiveRowCount += 1
          } else {
            streamState.negativeRowCount += 1
          }
          rowMetaBatch.push({
            rowIdx,
            sourceType,
            sourceId: normalized.sourceId,
            dateKey: normalized.dateKey,
            symbol: normalized.symbol,
            outcomeHitTarget: normalized.outcomeHitTarget,
            strategyMode,
          })
          if (rowMetaBatch.length >= 1024) {
            await flushRowMetaBatch()
          }
          const tokens = tokenizePerfectPrototypeRow(normalized, tokenizerSpec)
          for (const token of tokens) {
            tokenPostingsBatch.push({
              token,
              rowIdx,
              outcomeHitTarget: normalized.outcomeHitTarget,
            })
            if (tokenPostingsBatch.length >= 4096) {
              await flushTokenPostingsBatch()
            }
            streamState.tokenRows += 1
            const current = tokenStats.get(token) ?? {
              token,
              positiveMatchCount: 0,
              negativeMatchCount: 0,
            }
            if (normalized.outcomeHitTarget === true) {
              current.positiveMatchCount += 1
            } else {
              current.negativeMatchCount += 1
            }
            tokenStats.set(token, current)
          }
          if (Date.now() - lastProgressAt >= 30000) {
            lastProgressAt = Date.now()
            await updateProgress(
              progressPath,
              buildTimedProgressPayload({
                payload: {
                  phase: "tokenize_rows",
                  rowsScanned: streamState.rowsScanned,
                  rowsTokenized: streamState.rowsTokenized,
                  tokensIndexed: streamState.tokenRows,
                },
                startedAtMs: scanStartedAtMs,
              }),
            )
          }
        },
      })
      await flushRowMetaBatch()
      await flushTokenPostingsBatch()
      rowMetaSucceeded = true
    } finally {
      if (!rowMetaSucceeded) {
        await rowMetaSink.abort().catch(() => {})
        await tokenPostingsSink.abort().catch(() => {})
      }
    }
    const streamInputSec = hrtimeSecondsSince(streamInputStartedAt)
    await rowMetaSink.close()

    if (streamState.rowsScanned < 1) {
      throw new Error(`Step-B streamed exact indexed build found no eligible rows: ${resolvedInputPath}`)
    }
    if (tokenStats.size < 1) {
      throw new Error(`Step-B streamed exact indexed build found no tokens: ${resolvedInputPath}`)
    }

    const tokenStatsRows = Array.from(tokenStats.values())
      .map((entry) => {
        const matchCount = entry.positiveMatchCount + entry.negativeMatchCount
        return {
          token: entry.token,
          positiveMatchCount: entry.positiveMatchCount,
          negativeMatchCount: entry.negativeMatchCount,
          precision: matchCount > 0 ? entry.positiveMatchCount / matchCount : 0,
          separationRatio: entry.positiveMatchCount / (entry.negativeMatchCount + 1),
          separationLift: entry.positiveMatchCount - entry.negativeMatchCount,
        }
      })
      .sort((left, right) => comparePerfectPrototypeTokenOrder(left.token, right.token))
    const rowTokenIdWidthBits = choosePerfectPrototypeRowTokenIdWidthBits({
      tokenCount: tokenStatsRows.length,
    })

    const writeTokenStatsStartedAt = process.hrtime.bigint()
    const tokenStatsSink = await createDuckdbDelimitedToParquetSink({
      cwd,
      duckdb: resolvedDuckdb,
      parquetPath: paths.tokenStatsParquetPath,
      schema: PERFECT_PROTOTYPE_TOKEN_STATS_SINK_SCHEMA,
    })
    let tokenStatsSucceeded = false
    try {
      const batch = []
      for (const row of tokenStatsRows) {
        batch.push(row)
        if (batch.length >= 512) {
          await tokenStatsSink.writeRows(batch)
          batch.length = 0
        }
      }
      if (batch.length > 0) {
        await tokenStatsSink.writeRows(batch)
      }
      tokenStatsSucceeded = true
    } finally {
      if (!tokenStatsSucceeded) {
        await tokenStatsSink.abort().catch(() => {})
      }
    }
    await tokenStatsSink.close()
    const writeTokenStatsSec = hrtimeSecondsSince(writeTokenStatsStartedAt)

    const compressPostingsStartedAt = process.hrtime.bigint()
    await fsp.rm(paths.tokenPostingsBinPath, { force: true })
    const postingsHandle = await openPerfectPrototypePostingsFile(paths.tokenPostingsBinPath, "w")
    const tokenStatsByToken = new Map(tokenStatsRows.map((row) => [row.token, row]))
    const tokenIdByToken = new Map()
    const tokenDictionarySink = await createDuckdbDelimitedToParquetSink({
      cwd,
      duckdb: resolvedDuckdb,
      parquetPath: paths.tokenDictionaryParquetPath,
      schema: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SINK_SCHEMA,
    })
    let tokenDictionarySucceeded = false
    let rowTokenAdjacencySucceeded = false
    let postingsByteOffset = 0
    let tokenPostingsRowsStreamed = 0
    let currentToken = null
    let currentPositiveRowIndexes = []
    let currentNegativeRowIndexes = []
    let rowTokenIndexingSec = 0
    const tokenDictionaryBatch = []
    const rowTokenOffsets = new Uint32Array(streamState.rowsScanned + 1)
    const rowTokenIdWriter = await openPerfectPrototypeAtomicBinaryWriter({
      filePath: paths.rowTokenIdsBinPath,
    })
    const flushTokenDictionaryBatch = async () => {
      if (tokenDictionaryBatch.length < 1) return
      await tokenDictionarySink.writeRows(tokenDictionaryBatch)
      tokenDictionaryBatch.length = 0
    }
    const flushCompressedToken = async () => {
      if (!currentToken) return
      if (tokenIdByToken.has(currentToken)) {
        throw new Error(
          `Step-B streamed exact indexed build encountered duplicate token during dictionary write: token=${currentToken}`,
        )
      }
      const positiveMeta = await appendPerfectPrototypeDeltaPostingsToFile({
        fileHandle: postingsHandle,
        values: currentPositiveRowIndexes,
        offset: postingsByteOffset,
      })
      postingsByteOffset += positiveMeta.byteLength
      const negativeMeta = await appendPerfectPrototypeDeltaPostingsToFile({
        fileHandle: postingsHandle,
        values: currentNegativeRowIndexes,
        offset: postingsByteOffset,
      })
      postingsByteOffset += negativeMeta.byteLength
      const stat = tokenStatsByToken.get(currentToken)
      tokenIdByToken.set(currentToken, tokenIdByToken.size)
      tokenDictionaryBatch.push({
        token: currentToken,
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
        positiveMatchCount: Number(stat?.positiveMatchCount ?? positiveMeta.count),
        negativeMatchCount: Number(stat?.negativeMatchCount ?? negativeMeta.count),
        precision: Number(stat?.precision ?? 0),
        separationRatio: Number(stat?.separationRatio ?? 0),
        separationLift: Number(stat?.separationLift ?? 0),
      })
      if (tokenDictionaryBatch.length >= 512) {
        await flushTokenDictionaryBatch()
      }
      currentToken = null
      currentPositiveRowIndexes = []
      currentNegativeRowIndexes = []
    }
    try {
      await tokenPostingsSink.streamRows({
        schema: PERFECT_PROTOTYPE_TOKEN_POSTINGS_SINK_SCHEMA,
        selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TOKEN_POSTINGS_SINK_SCHEMA),
        orderBySql: "token, rowIdx",
        onRow: async (row) => {
          tokenPostingsRowsStreamed += 1
          const token = String(row?.token ?? "").trim()
          if (!token) return
          if (currentToken && token !== currentToken) {
            await flushCompressedToken()
          }
          if (!currentToken) {
            currentToken = token
          }
          const rowIdx = Number(row?.rowIdx)
          if (!Number.isInteger(rowIdx) || rowIdx < 0) return
          if (row?.outcomeHitTarget === true) {
            currentPositiveRowIndexes.push(rowIdx)
          } else if (row?.outcomeHitTarget === false) {
            currentNegativeRowIndexes.push(rowIdx)
          }
        },
      })
      await flushCompressedToken()
      await flushTokenDictionaryBatch()
      if (tokenIdByToken.size !== tokenStatsRows.length) {
        throw new Error(
          `Step-B streamed exact indexed build token dictionary/token stats count mismatch: dictionary=${tokenIdByToken.size} tokenStats=${tokenStatsRows.length}`,
        )
      }
      const rowTokenIndexingStartedAt = process.hrtime.bigint()
      let currentRowIndex = 0
      let rowTokenIdsWritten = 0
      const rowTokenIdBatch = []
      const flushRowTokenIdBatch = async () => {
        if (rowTokenIdBatch.length < 1) return
        await rowTokenIdWriter.appendBuffer(
          encodePerfectPrototypeRowTokenIdChunk({
            tokenIds: rowTokenIdBatch,
            widthBits: rowTokenIdWidthBits,
          }),
        )
        rowTokenIdBatch.length = 0
      }
      await tokenPostingsSink.streamRows({
        schema: PERFECT_PROTOTYPE_TOKEN_POSTINGS_SINK_SCHEMA,
        selectSql: buildDelimitedSelectSqlFromSchema(PERFECT_PROTOTYPE_TOKEN_POSTINGS_SINK_SCHEMA),
        orderBySql: "rowIdx, token",
        onRow: async (row) => {
          const rowIdx = Number(row?.rowIdx)
          if (!Number.isInteger(rowIdx) || rowIdx < 0) {
            throw new Error(
              `Step-B streamed exact indexed build row-token adjacency requires non-negative rowIdx: ${resolvedOutDir}`,
            )
          }
          if (rowIdx >= streamState.rowsScanned) {
            throw new Error(
              `Step-B streamed exact indexed build row-token adjacency rowIdx exceeds row count: rowIdx=${rowIdx} rowCount=${streamState.rowsScanned}`,
            )
          }
          while (currentRowIndex < rowIdx) {
            rowTokenOffsets[currentRowIndex + 1] = rowTokenIdsWritten
            currentRowIndex += 1
          }
          const token = String(row?.token ?? "").trim()
          const tokenId = tokenIdByToken.get(token)
          if (!Number.isInteger(tokenId) || tokenId < 0) {
            throw new Error(
              `Step-B streamed exact indexed build row-token adjacency missing token id: token=${token || "<empty>"}`,
            )
          }
          rowTokenIdBatch.push(tokenId)
          rowTokenIdsWritten += 1
          if (rowTokenIdBatch.length >= 16384) {
            await flushRowTokenIdBatch()
          }
        },
      })
      await flushRowTokenIdBatch()
      while (currentRowIndex < streamState.rowsScanned) {
        rowTokenOffsets[currentRowIndex + 1] = rowTokenIdsWritten
        currentRowIndex += 1
      }
      if (rowTokenIdsWritten !== streamState.tokenRows) {
        throw new Error(
          `Step-B streamed exact indexed build row-token adjacency token count mismatch: expected=${streamState.tokenRows} actual=${rowTokenIdsWritten}`,
        )
      }
      await writePerfectPrototypeUint32ArrayAtomic({
        filePath: paths.rowTokenOffsetsBinPath,
        values: rowTokenOffsets,
      })
      await rowTokenIdWriter.commit()
      rowTokenIndexingSec = hrtimeSecondsSince(rowTokenIndexingStartedAt)
      rowTokenAdjacencySucceeded = true
      tokenDictionarySucceeded = true
    } finally {
      await postingsHandle.close().catch(() => {})
      await tokenPostingsSink.close().catch(() => {})
      if (!rowTokenAdjacencySucceeded) {
        await rowTokenIdWriter.abort().catch(() => {})
      }
      if (!tokenDictionarySucceeded) {
        await tokenDictionarySink.abort().catch(() => {})
      }
      await tokenDictionarySink.close().catch(() => {})
    }
    const compressPostingsSec = hrtimeSecondsSince(compressPostingsStartedAt)

    const datasetContract = buildDatasetContractFromStreamState(streamState)

    const inputDir = path.dirname(resolvedInputPath)
    const packManifestPath = path.join(inputDir, "manifest.json")
    const packSummaryPath = path.join(inputDir, "summary.json")
    const outputCoverage = buildCoverageFromDateKeys(Array.from(streamState.dateKeySet))
    const inputProvenance = buildPerfectPrototypeDirectIndexProvenanceRecord({
      inputPath: resolvedInputPath,
      inputPaths: [resolvedInputPath],
      inputStateHash: await buildPerfectPrototypePartitionStateHash([resolvedInputPath]),
      packManifestPath: pathExists(packManifestPath) ? packManifestPath : null,
      packSummaryPath: pathExists(packSummaryPath) ? packSummaryPath : null,
      outputCoverage,
    })
    const manifest = {
      artifactType: PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_ARTIFACT_TYPE,
      version: PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_MANIFEST_VERSION,
      contractVersion: PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_CONTRACT_VERSION,
      layout: PERFECT_PROTOTYPE_STEPB_EXACT_INDEX_LAYOUT_INDEXED_ONLY_V1,
      ...tokenizerFingerprintMetadata,
      generatedAt: new Date().toISOString(),
      inputPath: resolvedInputPath,
      inputSha256: normalizeText(inputSha256)?.toLowerCase() ?? null,
      surfaceName: tokenizerSurface,
      sourceType: streamState.sourceType,
      strategyMode: streamState.strategyMode,
      searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
      trainStartDate: normalizeText(options?.trainStartDate),
      trainEndDate: normalizeText(options?.trainEndDate),
      tokenizerSpecHash,
      tokenizerSpecPath: path.basename(paths.tokenizerSpecPath),
      rowMetaParquetPath: path.basename(paths.rowMetaParquetPath),
      tokenStatsParquetPath: path.basename(paths.tokenStatsParquetPath),
      tokenDictionaryParquetPath: path.basename(paths.tokenDictionaryParquetPath),
      tokenPostingsBinPath: path.basename(paths.tokenPostingsBinPath),
      rowTokenOffsetsBinPath: path.basename(paths.rowTokenOffsetsBinPath),
      rowTokenIdsBinPath: path.basename(paths.rowTokenIdsBinPath),
      rowTokenIdWidthBits,
      rowCount: streamState.rowsScanned,
      tokenPostingCount: streamState.tokenRows,
      tokenCount: tokenStatsRows.length,
      positiveRowCount: streamState.positiveRowCount,
      negativeRowCount: streamState.negativeRowCount,
      partitioned: false,
      inputProvenance,
      datasetContract,
      tokenDictionarySchemaVersion: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_SCHEMA_VERSION,
      tokenDictionaryRequiredColumns: PERFECT_PROTOTYPE_TOKEN_DICTIONARY_REQUIRED_COLUMNS,
      tokenPostingsTableStreamMode: "delimited",
      tokenPostingsRowsStreamed,
      outputCoverage,
    }
    const summary = {
      ...tokenizerFingerprintMetadata,
      inputPath: resolvedInputPath,
      surfaceName: tokenizerSurface,
      searchMode: PERFECT_PROTOTYPE_EXACT_INDEXED_KERNEL_SEARCH_MODE,
      inputSha256: normalizeText(inputSha256)?.toLowerCase() ?? null,
      sourceType: streamState.sourceType,
      strategyMode: streamState.strategyMode,
      rows: streamState.rowsScanned,
      tokenCount: tokenStatsRows.length,
      tokenPostingCount: streamState.tokenRows,
      inputProvenance,
      manifest,
      tokenizer: summarizePerfectPrototypeTokenizerSpec(tokenizerSpec),
      phaseTimings: {
        streamInputSec: Number(streamInputSec.toFixed(6)),
        writeTokenStatsSec: Number(writeTokenStatsSec.toFixed(6)),
        compressPostingsSec: Number(compressPostingsSec.toFixed(6)),
        rowTokenIndexingSec: Number(rowTokenIndexingSec.toFixed(6)),
        elapsedSec: Number(hrtimeSecondsSince(startedAt).toFixed(6)),
      },
      datasetContract,
      outputCoverage,
      rowMetaOutputSinkStats: rowMetaSink.getStats(),
      tokenPostingsOutputSinkStats: tokenPostingsSink.getStats(),
      tokenStatsOutputSinkStats: tokenStatsSink.getStats(),
      tokenDictionaryOutputSinkStats: tokenDictionarySink.getStats(),
      tokenizerSpecSourcePath: normalizeText(tokenizerSpecPath),
    }
    await writeJsonAtomic(paths.manifestPath, manifest)
    await writeJsonAtomic(paths.summaryPath, summary)
    await updateProgress(
      progressPath,
      buildTimedProgressPayload({
        payload: {
          phase: "completed",
          rowsScanned: streamState.rowsScanned,
          rowsTokenized: streamState.rowsTokenized,
          tokensIndexed: streamState.tokenRows,
        },
        startedAtMs: scanStartedAtMs,
        estimatedRows: streamState.rowsScanned,
      }),
    )
    buildSucceeded = true
    return {
      paths,
      manifest,
      summary,
      tokenizerSpecHash,
      tokenizerFingerprintMetadata,
      inputProvenance,
    }
  } finally {
    if (!buildSucceeded) {
      await removeArtifacts(artifactPaths)
    }
  }
}
