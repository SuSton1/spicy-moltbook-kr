import fsp from "node:fs/promises"
import { readPerfectPrototypeBinaryRange } from "./perfect_prototype_binary_io.mjs"
import { nativePerfectPrototypeRowsetKernel } from "./perfect_prototype_rowset_native.mjs"

const toUint32List = (values, { sort = true } = {}) => {
  const normalized = (Array.isArray(values) || ArrayBuffer.isView(values) ? Array.from(values) : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0)
  if (sort) {
    normalized.sort((left, right) => left - right)
  }
  return normalized
}

const encodeDeltaVarintBytes = (delta, outBytes) => {
  let nextDelta = delta >>> 0
  while (nextDelta >= 0x80) {
    outBytes.push((nextDelta & 0x7f) | 0x80)
    nextDelta >>>= 7
  }
  outBytes.push(nextDelta)
}

export const encodePerfectPrototypeDeltaPostings = (values, { preSorted = false } = {}) => {
  const sorted = preSorted ? toUint32List(values, { sort: false }) : toUint32List(values)
  const bytes = []
  let previous = 0
  for (const value of sorted) {
    let delta = value - previous
    previous = value
    while (delta >= 0x80) {
      bytes.push((delta & 0x7f) | 0x80)
      delta >>>= 7
    }
    bytes.push(delta)
  }
  return Buffer.from(bytes)
}

const buildPostingRangeMeta = (values) => ({
  firstRowIdx:
    (Array.isArray(values) || ArrayBuffer.isView(values)) && Number(values.length) > 0
      ? Number(values[0])
      : null,
  lastRowIdx:
    (Array.isArray(values) || ArrayBuffer.isView(values)) && Number(values.length) > 0
      ? Number(values[Number(values.length) - 1])
      : null,
})

export const decodePerfectPrototypeDeltaPostingsJsReference = (buffer, count = null) => {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
  const out = []
  let previous = 0
  let shift = 0
  let value = 0
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      previous += value >>> 0
      out.push(previous >>> 0)
      value = 0
      shift = 0
      if (count != null && out.length >= count) {
        break
      }
      continue
    }
    shift += 7
  }
  return Uint32Array.from(out)
}

export const summarizePerfectPrototypeDeltaPostingBuffer = (buffer, count = null) => {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
  let previous = 0
  let shift = 0
  let value = 0
  let decodedCount = 0
  let firstRowIdx = null
  let lastRowIdx = null
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      previous += value >>> 0
      if (firstRowIdx == null) {
        firstRowIdx = previous
      }
      lastRowIdx = previous
      decodedCount += 1
      value = 0
      shift = 0
      if (count != null && decodedCount >= Number(count)) {
        break
      }
      continue
    }
    shift += 7
    if (shift > 35) {
      throw new Error("Perfect prototype postings summary encountered malformed varint")
    }
  }
  if (shift !== 0 || value !== 0) {
    throw new Error("Perfect prototype postings summary encountered unterminated varint")
  }
  if (count != null && decodedCount !== Number(count)) {
    throw new Error(
      `Perfect prototype postings summary count mismatch: expected=${Number(count)} actual=${decodedCount}`,
    )
  }
  return {
    count: decodedCount,
    firstRowIdx,
    lastRowIdx,
  }
}

export const decodePerfectPrototypeDeltaPostings = (buffer, count = null) =>
  nativePerfectPrototypeRowsetKernel.decodeDeltaToArray(
    Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []),
    Number.isInteger(count) ? count : null,
  )

export const decodePerfectPrototypeDeltaPostingsToBitsetJsReference = ({
  buffer,
  count = null,
  universeSize,
}) => {
  const safeUniverseSize = Math.max(0, Math.floor(Number(universeSize) || 0))
  if (safeUniverseSize < 1) {
    throw new Error(
      `Perfect prototype bitset decode requires a positive universe size: ${universeSize}`,
    )
  }
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
  const words = new Uint32Array(Math.ceil(safeUniverseSize / 32))
  let previous = 0
  let shift = 0
  let value = 0
  let decodedCount = 0
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      previous += value >>> 0
      if (previous >= safeUniverseSize) {
        throw new Error(
          `Perfect prototype bitset decode exceeded universe: value=${previous} universeSize=${safeUniverseSize}`,
        )
      }
      const wordIndex = previous >>> 5
      const bitOffset = previous & 31
      words[wordIndex] |= 1 << bitOffset
      decodedCount += 1
      value = 0
      shift = 0
      if (count != null && decodedCount >= count) {
        break
      }
      continue
    }
    shift += 7
  }
  if (count != null && decodedCount !== Number(count)) {
    throw new Error(
      `Perfect prototype bitset decode count mismatch: expected=${Number(count)} actual=${decodedCount}`,
    )
  }
  return {
    words,
    count: decodedCount,
    universeSize: safeUniverseSize,
  }
}

export const decodePerfectPrototypeDeltaPostingsToBitset = ({
  buffer,
  count = null,
  universeSize,
}) => {
  if (!Number.isInteger(count) || Number(count) < 0) {
    throw new Error(
      `Perfect prototype bitset decode requires an explicit non-negative count: ${count}`,
    )
  }
  const safeCount = Math.max(0, Math.floor(Number(count) || 0))
  const safeUniverseSize = Math.max(0, Math.floor(Number(universeSize) || 0))
  if (safeUniverseSize < 1) {
    throw new Error(
      `Perfect prototype bitset decode requires a positive universe size: ${universeSize}`,
    )
  }
  return nativePerfectPrototypeRowsetKernel.decodeDeltaToBitmap(
    Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []),
    safeCount,
    safeUniverseSize,
  )
}

export const readPerfectPrototypeDeltaPostingsFromFile = async ({
  fileHandle,
  filePath = null,
  offset,
  byteLength,
  count = null,
}) => {
  const length = Math.max(0, Math.floor(Number(byteLength) || 0))
  if (length < 1) return Uint32Array.from([])
  const buffer = await readPerfectPrototypeBinaryRange({
    fileHandle,
    filePath,
    offset,
    byteLength: length,
    label: "token_postings.bin",
  })
  return decodePerfectPrototypeDeltaPostings(buffer, count)
}

export const readPerfectPrototypePostingBufferFromFile = async ({
  fileHandle,
  filePath = null,
  offset,
  byteLength,
}) => {
  const length = Math.max(0, Math.floor(Number(byteLength) || 0))
  if (length < 1) return Buffer.alloc(0)
  return readPerfectPrototypeBinaryRange({
    fileHandle,
    filePath,
    offset,
    byteLength: length,
    label: "token_postings.bin",
  })
}

export const appendPerfectPrototypeDeltaPostingsToFile = async ({
  fileHandle,
  values,
  offset,
}) => {
  const normalizedValues = toUint32List(values)
  const buffer = encodePerfectPrototypeDeltaPostings(normalizedValues, { preSorted: true })
  const writeStartedAt = performance.now()
  if (buffer.length > 0) {
    await fileHandle.write(buffer, 0, buffer.length, offset)
  }
  const rangeMeta = buildPostingRangeMeta(normalizedValues)
  return {
    offset,
    byteLength: buffer.length,
    count: normalizedValues.length,
    ...rangeMeta,
    mergeMs: 0,
    writeMs: Number((performance.now() - writeStartedAt).toFixed(3)),
  }
}

export const appendPerfectPrototypeDeltaPostingGroupsToFile = async ({
  fileHandle,
  groups,
  offset,
}) => {
  const safeGroups = Array.isArray(groups) ? groups : []
  const baseOffset = Math.max(0, Math.floor(Number(offset) || 0))
  let previous = 0
  let byteLength = 0
  let count = 0
  let firstRowIdx = null
  let lastRowIdx = null
  const mergeStartedAt = performance.now()
  let writeMs = 0
  for (const group of safeGroups) {
    const rowOffset = Math.max(0, Math.floor(Number(group?.rowOffset) || 0))
    const values = toUint32List(group?.values, { sort: false })
    if (values.length < 1) continue
    const bytes = []
    for (const rawValue of values) {
      const value = rawValue + rowOffset
      if (firstRowIdx == null) {
        firstRowIdx = value
      }
      lastRowIdx = value
      let delta = value - previous
      previous = value
      while (delta >= 0x80) {
        bytes.push((delta & 0x7f) | 0x80)
        delta >>>= 7
      }
      bytes.push(delta)
    }
    if (bytes.length < 1) continue
    const buffer = Buffer.from(bytes)
    const writeStartedAt = performance.now()
    await fileHandle.write(buffer, 0, buffer.length, baseOffset + byteLength)
    writeMs += performance.now() - writeStartedAt
    byteLength += buffer.length
    count += values.length
  }
  return {
    offset: baseOffset,
    byteLength,
    count,
    firstRowIdx,
    lastRowIdx,
    mergeMs: Number((performance.now() - mergeStartedAt - writeMs).toFixed(3)),
    writeMs: Number(writeMs.toFixed(3)),
  }
}

export const mergePerfectPrototypeShiftedDeltaPostingRefsJsReference = ({
  refs,
}) => {
  const safeRefs = Array.isArray(refs) ? refs : []
  let previous = 0
  let count = 0
  let firstRowIdx = null
  let lastRowIdx = null
  const pendingBytes = []
  for (const ref of safeRefs) {
    const rowOffset = Math.max(0, Math.floor(Number(ref?.rowOffset) || 0))
    const expectedCount = Math.max(0, Math.floor(Number(ref?.count) || 0))
    const buffer = Buffer.isBuffer(ref?.buffer) ? ref.buffer : Buffer.from(ref?.buffer ?? [])
    let localCount = 0
    let decodedValue = 0
    let shift = 0
    let previousLocal = 0
    for (let index = 0; index < buffer.length; index += 1) {
      const byte = buffer[index]
      decodedValue |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) {
        previousLocal += decodedValue >>> 0
        const shiftedValue = previousLocal + rowOffset
        if (lastRowIdx != null && shiftedValue <= lastRowIdx) {
          throw new Error(
            `Perfect prototype shifted-delta JS reference encountered non-monotonic shifted row indexes: previous=${lastRowIdx} current=${shiftedValue}`,
          )
        }
        if (firstRowIdx == null) {
          firstRowIdx = shiftedValue
        }
        lastRowIdx = shiftedValue
        const delta = shiftedValue - previous
        previous = shiftedValue
        encodeDeltaVarintBytes(delta, pendingBytes)
        localCount += 1
        decodedValue = 0
        shift = 0
        if (expectedCount > 0 && localCount >= expectedCount) {
          break
        }
      } else {
        shift += 7
        if (shift > 35) {
          throw new Error(
            "Perfect prototype shifted-delta JS reference encountered malformed varint",
          )
        }
      }
    }
    if (shift !== 0 || decodedValue !== 0) {
      throw new Error(
        "Perfect prototype shifted-delta JS reference encountered unterminated varint",
      )
    }
    if (localCount !== expectedCount) {
      throw new Error(
        `Perfect prototype shifted-delta JS reference count mismatch: expected=${expectedCount} actual=${localCount}`,
      )
    }
    count += localCount
  }
  return {
    buffer: Buffer.from(pendingBytes),
    count,
    firstRowIdx,
    lastRowIdx,
  }
}

export const mergePerfectPrototypeShiftedDeltaPostingFileRefsJsReference = async ({
  refs,
}) => {
  const safeRefs = Array.isArray(refs) ? refs : []
  const bufferedRefs = await Promise.all(
    safeRefs.map(async (ref) => ({
      rowOffset: Math.max(0, Math.floor(Number(ref?.rowOffset) || 0)),
      count: Math.max(0, Math.floor(Number(ref?.count) || 0)),
      buffer: await readPerfectPrototypeBinaryRange({
        fileHandle: ref?.fileHandle ?? null,
        filePath: ref?.filePath ?? null,
        offset: ref?.offset,
        byteLength: ref?.byteLength,
        label: "token_postings.bin",
      }),
    })),
  )
  return mergePerfectPrototypeShiftedDeltaPostingRefsJsReference({
    refs: bufferedRefs,
  })
}

export const appendPerfectPrototypeShiftedDeltaPostingRefsToFile = async ({
  fileHandle,
  refs,
  offset,
}) => {
  const safeRefs = Array.isArray(refs) ? refs : []
  const baseOffset = Math.max(0, Math.floor(Number(offset) || 0))
  const buffers = safeRefs.map((ref) =>
    Buffer.isBuffer(ref?.buffer) ? ref.buffer : Buffer.from(ref?.buffer ?? []),
  )
  const rowOffsets = Uint32Array.from(
    safeRefs.map((ref) => Math.max(0, Math.floor(Number(ref?.rowOffset) || 0))),
  )
  const counts = Uint32Array.from(
    safeRefs.map((ref) => Math.max(0, Math.floor(Number(ref?.count) || 0))),
  )
  const mergeStartedAt = performance.now()
  const merged = nativePerfectPrototypeRowsetKernel.mergeShiftedDeltaRefs(
    buffers,
    rowOffsets,
    counts,
  )
  const mergeMs = Number((performance.now() - mergeStartedAt).toFixed(3))
  const mergedBuffer = Buffer.isBuffer(merged?.buffer) ? merged.buffer : Buffer.from(merged?.buffer ?? [])
  const writeStartedAt = performance.now()
  if (mergedBuffer.length > 0) {
    await fileHandle.write(mergedBuffer, 0, mergedBuffer.length, baseOffset)
  }
  const writeMs = Number((performance.now() - writeStartedAt).toFixed(3))
  return {
    offset: baseOffset,
    byteLength: mergedBuffer.length,
    count: Number(merged?.count ?? 0),
    firstRowIdx: Number.isInteger(merged?.firstRowIdx) ? Number(merged.firstRowIdx) : null,
    lastRowIdx: Number.isInteger(merged?.lastRowIdx) ? Number(merged.lastRowIdx) : null,
    mergeMs,
    writeMs,
  }
}

export const appendPerfectPrototypeShiftedDeltaPostingFileRefsToFile = async ({
  fileHandle,
  refs,
  offset,
}) => {
  const nativePostingsSpliceRequired =
    String(process.env.PREJUMP_INDEX_NATIVE_POSTINGS_SPLICE_REQUIRED ?? "true").trim().toLowerCase() === "true"
  if (nativePostingsSpliceRequired !== true) {
    throw new Error(
      "Perfect prototype postings splice merge requires PREJUMP_INDEX_NATIVE_POSTINGS_SPLICE_REQUIRED=true",
    )
  }
  const safeRefs = Array.isArray(refs) ? refs : []
  const baseOffset = Math.max(0, Math.floor(Number(offset) || 0))
  const fileDescriptors = Int32Array.from(
    safeRefs.map((ref) => {
      const fd = Number(ref?.fileDescriptor ?? ref?.fileHandle?.fd ?? NaN)
      if (!Number.isInteger(fd) || fd < 0) {
        throw new Error(`Perfect prototype shifted-delta file merge requires a valid file descriptor: ${fd}`)
      }
      return fd
    }),
  )
  const offsets = BigUint64Array.from(
    safeRefs.map((ref) => {
      const nextOffset = Math.max(0, Math.floor(Number(ref?.offset) || 0))
      return BigInt(nextOffset)
    }),
  )
  const byteLengths = Uint32Array.from(
    safeRefs.map((ref) => Math.max(0, Math.floor(Number(ref?.byteLength) || 0))),
  )
  const rowOffsets = Uint32Array.from(
    safeRefs.map((ref) => Math.max(0, Math.floor(Number(ref?.rowOffset) || 0))),
  )
  const counts = Uint32Array.from(
    safeRefs.map((ref) => Math.max(0, Math.floor(Number(ref?.count) || 0))),
  )
  const firstRowIdxs = Int32Array.from(
    safeRefs.map((ref) =>
      Number.isInteger(Number(ref?.firstRowIdx)) ? Number(ref.firstRowIdx) : -1,
    ),
  )
  const lastRowIdxs = Int32Array.from(
    safeRefs.map((ref) =>
      Number.isInteger(Number(ref?.lastRowIdx)) ? Number(ref.lastRowIdx) : -1,
    ),
  )
  const mergeStartedAt = performance.now()
  const merged = nativePerfectPrototypeRowsetKernel.spliceShiftedDeltaRefsToFile(
    Number(fileHandle?.fd ?? -1),
    BigInt(baseOffset),
    fileDescriptors,
    offsets,
    byteLengths,
    rowOffsets,
    counts,
    firstRowIdxs,
    lastRowIdxs,
  )
  const mergeMs = Number((performance.now() - mergeStartedAt).toFixed(3))
  return {
    offset: baseOffset,
    byteLength: Number(merged?.byteLength ?? 0),
    count: Number(merged?.count ?? 0),
    firstRowIdx: Number.isInteger(merged?.firstRowIdx) ? Number(merged.firstRowIdx) : null,
    lastRowIdx: Number.isInteger(merged?.lastRowIdx) ? Number(merged.lastRowIdx) : null,
    mergeMs,
    writeMs: 0,
  }
}

export const openPerfectPrototypePostingsFile = async (filePath, mode = "r") =>
  fsp.open(filePath, mode)
