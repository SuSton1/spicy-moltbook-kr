import fsp from "node:fs/promises"
import os from "node:os"
import { Worker } from "node:worker_threads"

import { buildCandidateSchema } from "./candidate_schema.mjs"

const now = () => Date.now()

const safeInt = (value, fallback) => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

const resolveCpuCount = () => {
  if (typeof os.availableParallelism === "function") {
    const n = Number(os.availableParallelism())
    if (Number.isInteger(n) && n > 0) return n
  }
  const list = os.cpus?.()
  return Array.isArray(list) && list.length > 0 ? list.length : 1
}

const emptyPerf = () => ({
  totalCandidatesScored: 0,
  totalPrototypes: 0,
  totalPrototypesAfterCoarse: 0,
  coarsePruneRatioSum: 0,
  coarsePruneRatioCount: 0,
  totalPrototypeComparisons: 0,
  prototypesPrunedByGroupBound: 0,
  prototypesPrunedByFeatureBound: 0,
  totalClusters: 0,
  totalClustersConsidered: 0
})

const addPerf = (target, src) => {
  if (!target || !src) return
  for (const key of Object.keys(target)) {
    target[key] += Number(src?.[key] ?? 0) || 0
  }
}

const normalizeSeq = (value) => {
  if (Array.isArray(value)) return value
  if (ArrayBuffer.isView(value)) return value
  return []
}

const readJson = async (filePath) => {
  const raw = await fsp.readFile(filePath, "utf8")
  return JSON.parse(raw)
}

const packCandidateChunkDynamic = (chunk) => {
  const rows = Array.isArray(chunk) ? chunk : []
  const rowCount = rows.length

  const featureKeySet = new Set()
  const globalFeatureKeySet = new Set()

  let seq40Total = 0
  let seq150Total = 0
  for (let i = 0; i < rowCount; i += 1) {
    const row = rows[i] ?? {}
    const featureVec = row?.featureVec && typeof row.featureVec === "object" ? row.featureVec : {}
    const globalFeatureVec =
      row?.globalFeatureVec && typeof row.globalFeatureVec === "object" ? row.globalFeatureVec : {}
    for (const key of Object.keys(featureVec)) {
      const safe = String(key ?? "").trim()
      if (safe) featureKeySet.add(safe)
    }
    for (const key of Object.keys(globalFeatureVec)) {
      const safe = String(key ?? "").trim()
      if (safe) globalFeatureKeySet.add(safe)
    }
    const seq40 = normalizeSeq(row?.seq40 ?? row?.seq)
    const seq150 = normalizeSeq(row?.seq150)
    seq40Total += seq40.length
    seq150Total += seq150.length
  }

  const featureKeys = Array.from(featureKeySet).sort((a, b) => a.localeCompare(b))
  const globalFeatureKeys = Array.from(globalFeatureKeySet).sort((a, b) => a.localeCompare(b))
  const featureVals = new Float64Array(rowCount * featureKeys.length)
  const globalFeatureVals = new Float64Array(rowCount * globalFeatureKeys.length)
  featureVals.fill(Number.NaN)
  globalFeatureVals.fill(Number.NaN)

  const seq40Offsets = new Uint32Array(rowCount + 1)
  const seq150Offsets = new Uint32Array(rowCount + 1)
  const seq40Flat = new Float64Array(seq40Total)
  const seq150Flat = new Float64Array(seq150Total)

  let cursor40 = 0
  let cursor150 = 0
  for (let i = 0; i < rowCount; i += 1) {
    const row = rows[i] ?? {}
    const featureVec = row?.featureVec && typeof row.featureVec === "object" ? row.featureVec : {}
    const globalFeatureVec =
      row?.globalFeatureVec && typeof row.globalFeatureVec === "object" ? row.globalFeatureVec : {}

    for (let k = 0; k < featureKeys.length; k += 1) {
      const key = featureKeys[k]
      const n = Number(featureVec?.[key])
      featureVals[i * featureKeys.length + k] = Number.isFinite(n) ? n : Number.NaN
    }
    for (let k = 0; k < globalFeatureKeys.length; k += 1) {
      const key = globalFeatureKeys[k]
      const n = Number(globalFeatureVec?.[key])
      globalFeatureVals[i * globalFeatureKeys.length + k] = Number.isFinite(n) ? n : Number.NaN
    }

    seq40Offsets[i] = cursor40
    const seq40 = normalizeSeq(row?.seq40 ?? row?.seq)
    for (let j = 0; j < seq40.length; j += 1) {
      const n = Number(seq40[j])
      seq40Flat[cursor40] = Number.isFinite(n) ? n : 0
      cursor40 += 1
    }

    seq150Offsets[i] = cursor150
    const seq150 = normalizeSeq(row?.seq150)
    for (let j = 0; j < seq150.length; j += 1) {
      const n = Number(seq150[j])
      seq150Flat[cursor150] = Number.isFinite(n) ? n : 0
      cursor150 += 1
    }
  }
  seq40Offsets[rowCount] = cursor40
  seq150Offsets[rowCount] = cursor150

  return {
    payload: {
      candidatesPacked: {
        rowCount,
        featureKeys,
        globalFeatureKeys,
        featureVals,
        globalFeatureVals,
        seq40Offsets,
        seq150Offsets,
        seq40Flat,
        seq150Flat
      }
    },
    transferList: [
      featureVals.buffer,
      globalFeatureVals.buffer,
      seq40Offsets.buffer,
      seq150Offsets.buffer,
      seq40Flat.buffer,
      seq150Flat.buffer
    ]
  }
}

const packCandidateChunkBySchema = (chunk, candidateSchema) => {
  const rows = Array.isArray(chunk) ? chunk : []
  const rowCount = rows.length
  const featureKeys = Array.isArray(candidateSchema?.featureKeys) ? candidateSchema.featureKeys : []
  const globalFeatureKeys = Array.isArray(candidateSchema?.globalFeatureKeys)
    ? candidateSchema.globalFeatureKeys
    : []

  let seq40Total = 0
  let seq150Total = 0
  for (let i = 0; i < rowCount; i += 1) {
    const row = rows[i] ?? {}
    seq40Total += normalizeSeq(row?.seq40 ?? row?.seq).length
    seq150Total += normalizeSeq(row?.seq150).length
  }

  const featureVals = new Float64Array(rowCount * featureKeys.length)
  const globalFeatureVals = new Float64Array(rowCount * globalFeatureKeys.length)
  featureVals.fill(Number.NaN)
  globalFeatureVals.fill(Number.NaN)

  const seq40Offsets = new Uint32Array(rowCount + 1)
  const seq150Offsets = new Uint32Array(rowCount + 1)
  const seq40Flat = new Float64Array(seq40Total)
  const seq150Flat = new Float64Array(seq150Total)

  let cursor40 = 0
  let cursor150 = 0
  for (let i = 0; i < rowCount; i += 1) {
    const row = rows[i] ?? {}
    const featureVec = row?.featureVec && typeof row.featureVec === "object" ? row.featureVec : {}
    const globalFeatureVec =
      row?.globalFeatureVec && typeof row.globalFeatureVec === "object" ? row.globalFeatureVec : {}

    for (let k = 0; k < featureKeys.length; k += 1) {
      const n = Number(featureVec?.[featureKeys[k]])
      featureVals[i * featureKeys.length + k] = Number.isFinite(n) ? n : Number.NaN
    }
    for (let k = 0; k < globalFeatureKeys.length; k += 1) {
      const n = Number(globalFeatureVec?.[globalFeatureKeys[k]])
      globalFeatureVals[i * globalFeatureKeys.length + k] = Number.isFinite(n) ? n : Number.NaN
    }

    seq40Offsets[i] = cursor40
    const seq40 = normalizeSeq(row?.seq40 ?? row?.seq)
    for (let j = 0; j < seq40.length; j += 1) {
      const n = Number(seq40[j])
      seq40Flat[cursor40] = Number.isFinite(n) ? n : 0
      cursor40 += 1
    }

    seq150Offsets[i] = cursor150
    const seq150 = normalizeSeq(row?.seq150)
    for (let j = 0; j < seq150.length; j += 1) {
      const n = Number(seq150[j])
      seq150Flat[cursor150] = Number.isFinite(n) ? n : 0
      cursor150 += 1
    }
  }
  seq40Offsets[rowCount] = cursor40
  seq150Offsets[rowCount] = cursor150

  return {
    payload: {
      candidatesPacked: {
        rowCount,
        featureVals,
        globalFeatureVals,
        seq40Offsets,
        seq150Offsets,
        seq40Flat,
        seq150Flat
      }
    },
    transferList: [
      featureVals.buffer,
      globalFeatureVals.buffer,
      seq40Offsets.buffer,
      seq150Offsets.buffer,
      seq40Flat.buffer,
      seq150Flat.buffer
    ]
  }
}

const chunkHasUnknownSchemaKeys = (rows, candidateSchema) => {
  const featureIndexByKey = candidateSchema?.featureIndexByKey ?? {}
  const globalFeatureIndexByKey = candidateSchema?.globalFeatureIndexByKey ?? {}
  for (const row of rows ?? []) {
    const featureVec = row?.featureVec && typeof row.featureVec === "object" ? row.featureVec : null
    if (featureVec) {
      for (const key of Object.keys(featureVec)) {
        if (!Object.prototype.hasOwnProperty.call(featureIndexByKey, key)) return true
      }
    }
    const globalFeatureVec =
      row?.globalFeatureVec && typeof row.globalFeatureVec === "object" ? row.globalFeatureVec : null
    if (globalFeatureVec) {
      for (const key of Object.keys(globalFeatureVec)) {
        if (!Object.prototype.hasOwnProperty.call(globalFeatureIndexByKey, key)) return true
      }
    }
  }
  return false
}

export const createScoreWorkerPool = async ({
  workerScriptPath,
  libraryPath,
  runtimePath,
  runtimeOverrides,
  workerCount,
  chunkSize
}) => {
  const runtimeMeta = await readJson(runtimePath)
  const candidateSchema = buildCandidateSchema({ runtimeMeta })
  const cpuCount = resolveCpuCount()
  const requested = Number(workerCount ?? 0)
  const resolvedCount = requested === 0
    ? Math.max(1, cpuCount - 1)
    : safeInt(requested, 1)
  const count = Math.max(1, Math.min(resolvedCount, cpuCount))
  const resolvedChunkSize = safeInt(chunkSize, 256)

  const workers = []
  for (let i = 0; i < count; i += 1) {
    const worker = new Worker(workerScriptPath, {
      workerData: {
        libraryPath,
        runtimePath,
        runtimeOverrides: runtimeOverrides && typeof runtimeOverrides === "object"
          ? { ...runtimeOverrides }
          : null
      }
    })
    const pending = new Map()
    worker.on("message", (msg) => {
      const taskId = Number(msg?.taskId)
      if (!Number.isInteger(taskId)) {
        if (msg?.error) {
          const error = new Error(String(msg.error))
          for (const [, resolver] of pending.entries()) {
            resolver.reject(error)
          }
          pending.clear()
        }
        return
      }
      const resolver = pending.get(taskId)
      if (!resolver) return
      pending.delete(taskId)
      if (msg?.error) {
        resolver.reject(new Error(String(msg.error)))
        return
      }
      resolver.resolve(msg)
    })
    worker.on("error", (error) => {
      for (const [, resolver] of pending.entries()) {
        resolver.reject(error)
      }
      pending.clear()
    })
    worker.on("exit", (code) => {
      if (code === 0) return
      const error = new Error(`score worker exited with code ${code}`)
      for (const [, resolver] of pending.entries()) {
        resolver.reject(error)
      }
      pending.clear()
    })
    workers.push({
      worker,
      pending
    })
  }

  let taskSeq = 0
  let rr = 0
  let schemaPackEnabled =
    Array.isArray(candidateSchema?.featureKeys) ||
    Array.isArray(candidateSchema?.globalFeatureKeys)

  const dispatch = (entry, payload, transferList = []) => {
    const taskId = ++taskSeq
    return new Promise((resolve, reject) => {
      entry.pending.set(taskId, { resolve, reject })
      entry.worker.postMessage(
        {
          ...payload,
          taskId
        },
        Array.isArray(transferList) ? transferList : [],
      )
    })
  }

  const scoreBatch = async ({
    candidates,
    weights,
    activeGroups,
    scoreOptions,
    similarityDisambiguation = null
  }) => {
    const rows = Array.isArray(candidates) ? candidates : []
    if (!rows.length) {
      return {
        rows: [],
        perf: emptyPerf(),
        workerCount: count,
        chunkSize: resolvedChunkSize,
        elapsedMs: 0
      }
    }
    const started = now()
    const out = new Array(rows.length)
    const perf = emptyPerf()
    let packMs = 0
    let computeMs = 0
    let batchCount = 0
    let cursor = 0
    while (cursor < rows.length) {
      const inFlight = []
      for (let i = 0; i < workers.length && cursor < rows.length; i += 1) {
        const entry = workers[rr % workers.length]
        rr += 1
        const begin = cursor
        const end = Math.min(rows.length, begin + resolvedChunkSize)
        const chunk = rows.slice(begin, end)
        if (schemaPackEnabled && chunkHasUnknownSchemaKeys(chunk, candidateSchema)) {
          schemaPackEnabled = false
        }
        const packStarted = now()
        const packedChunk =
          schemaPackEnabled
            ? packCandidateChunkBySchema(chunk, candidateSchema)
            : packCandidateChunkDynamic(chunk)
        packMs += Math.max(0, now() - packStarted)
        cursor = end
        batchCount += 1
        inFlight.push(
          dispatch(entry, {
            ...packedChunk.payload,
            weights,
            activeGroups,
            scoreOptions,
            similarityDisambiguation
          }, packedChunk.transferList).then((result) => {
            const scoredRows = Array.isArray(result?.rows) ? result.rows : []
            for (let k = 0; k < scoredRows.length; k += 1) {
              out[begin + k] = scoredRows[k]
            }
            addPerf(perf, result?.perf ?? {})
            computeMs += Math.max(0, Number(result?.computeMs ?? 0) || 0)
          }),
        )
      }
      if (inFlight.length) {
        await Promise.all(inFlight)
      }
    }
    return {
      rows: out,
      perf,
      workerCount: count,
      chunkSize: resolvedChunkSize,
      packMs,
      computeMs,
      batchCount,
      elapsedMs: now() - started
    }
  }

  const close = async () => {
    await Promise.all(workers.map(async (entry) => {
      try {
        await entry.worker.terminate()
      } catch (_error) {
        // noop
      }
    }))
  }

  return {
    workerCount: count,
    chunkSize: resolvedChunkSize,
    scoreBatch,
    close
  }
}
