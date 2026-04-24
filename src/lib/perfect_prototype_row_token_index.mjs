import path from "node:path"
import fsp from "node:fs/promises"

import { ensureDir } from "./io.mjs"

export const PERFECT_PROTOTYPE_ROW_TOKEN_ID_WIDTH_UINT16 = 16
export const PERFECT_PROTOTYPE_ROW_TOKEN_ID_WIDTH_UINT32 = 32

const resolveAtomicTempPath = (filePath) =>
  path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )

export const choosePerfectPrototypeRowTokenIdWidthBits = ({ tokenCount }) =>
  Number(tokenCount ?? 0) <= 0xffff
    ? PERFECT_PROTOTYPE_ROW_TOKEN_ID_WIDTH_UINT16
    : PERFECT_PROTOTYPE_ROW_TOKEN_ID_WIDTH_UINT32

export const encodePerfectPrototypeRowTokenIdChunk = ({
  tokenIds,
  widthBits,
}) => {
  const values =
    Array.isArray(tokenIds) || (ArrayBuffer.isView(tokenIds) && !(tokenIds instanceof DataView))
      ? tokenIds
      : []
  if (values.length < 1) return Buffer.alloc(0)
  if (widthBits === PERFECT_PROTOTYPE_ROW_TOKEN_ID_WIDTH_UINT16) {
    return Buffer.from(Uint16Array.from(values).buffer)
  }
  if (widthBits === PERFECT_PROTOTYPE_ROW_TOKEN_ID_WIDTH_UINT32) {
    return Buffer.from(Uint32Array.from(values).buffer)
  }
  throw new Error(`Unsupported row-token id width: ${widthBits}`)
}

export const openPerfectPrototypeAtomicBinaryWriter = async ({ filePath }) => {
  const resolvedPath = path.resolve(String(filePath ?? "").trim())
  if (!resolvedPath) {
    throw new Error("Atomic binary writer requires filePath")
  }
  await ensureDir(path.dirname(resolvedPath))
  const tempPath = resolveAtomicTempPath(resolvedPath)
  const handle = await fsp.open(tempPath, "w")
  let closed = false
  let committed = false
  return {
    async appendBuffer(buffer) {
      if (closed) {
        throw new Error(`Atomic binary writer already closed: ${resolvedPath}`)
      }
      const chunk = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
      if (chunk.length < 1) return
      await handle.write(chunk)
    },
    async commit() {
      if (closed) return
      await handle.sync()
      await handle.close()
      closed = true
      await fsp.rename(tempPath, resolvedPath)
      committed = true
    },
    async abort() {
      if (!closed) {
        await handle.close().catch(() => {})
        closed = true
      }
      if (!committed) {
        await fsp.unlink(tempPath).catch(() => {})
      }
    },
  }
}

export const writePerfectPrototypeUint32ArrayAtomic = async ({
  filePath,
  values,
}) => {
  const normalizedValues = values instanceof Uint32Array ? values : Uint32Array.from(values ?? [])
  const writer = await openPerfectPrototypeAtomicBinaryWriter({ filePath })
  try {
    await writer.appendBuffer(
      Buffer.from(
        normalizedValues.buffer,
        normalizedValues.byteOffset,
        normalizedValues.byteLength,
      ),
    )
    await writer.commit()
  } catch (error) {
    await writer.abort().catch(() => {})
    throw error
  }
}

export const loadPerfectPrototypeRowTokenAdjacency = async ({
  rowTokenOffsetsPath,
  rowTokenIdsPath,
  rowCount,
  tokenPostingCount,
  tokenIdWidthBits,
}) => {
  const resolvedOffsetsPath = path.resolve(String(rowTokenOffsetsPath ?? "").trim())
  const resolvedTokenIdsPath = path.resolve(String(rowTokenIdsPath ?? "").trim())
  const expectedRowCount = Math.max(0, Math.floor(Number(rowCount) || 0))
  const expectedTokenPostingCount = Math.max(0, Math.floor(Number(tokenPostingCount) || 0))
  if (!resolvedOffsetsPath || !resolvedTokenIdsPath) {
    throw new Error("Row-token adjacency loader requires both offsets and token-id paths")
  }
  if (expectedRowCount < 1) {
    throw new Error(`Row-token adjacency loader requires positive rowCount: ${expectedRowCount}`)
  }
  if (expectedTokenPostingCount < 0) {
    throw new Error(
      `Row-token adjacency loader requires non-negative tokenPostingCount: ${expectedTokenPostingCount}`,
    )
  }
  const offsetsBuffer = await fsp.readFile(resolvedOffsetsPath)
  const expectedOffsetsByteLength = (expectedRowCount + 1) * Uint32Array.BYTES_PER_ELEMENT
  if (offsetsBuffer.byteLength !== expectedOffsetsByteLength) {
    throw new Error(
      `Row-token offsets byte length mismatch: expected=${expectedOffsetsByteLength} actual=${offsetsBuffer.byteLength} path=${resolvedOffsetsPath}`,
    )
  }
  const rowTokenOffsets = new Uint32Array(
    offsetsBuffer.buffer,
    offsetsBuffer.byteOffset,
    expectedRowCount + 1,
  )
  if (rowTokenOffsets[0] !== 0) {
    throw new Error(`Row-token offsets must start at 0: ${resolvedOffsetsPath}`)
  }
  const lastOffset = rowTokenOffsets[rowTokenOffsets.length - 1]
  if (lastOffset !== expectedTokenPostingCount) {
    throw new Error(
      `Row-token offsets terminal count mismatch: expected=${expectedTokenPostingCount} actual=${lastOffset} path=${resolvedOffsetsPath}`,
    )
  }
  for (let rowIndex = 0; rowIndex < expectedRowCount; rowIndex += 1) {
    if (rowTokenOffsets[rowIndex + 1] < rowTokenOffsets[rowIndex]) {
      throw new Error(
        `Row-token offsets must be monotonic: rowIndex=${rowIndex} path=${resolvedOffsetsPath}`,
      )
    }
  }
  const tokenIdsBuffer = await fsp.readFile(resolvedTokenIdsPath)
  const bytesPerTokenId =
    tokenIdWidthBits === PERFECT_PROTOTYPE_ROW_TOKEN_ID_WIDTH_UINT16
      ? Uint16Array.BYTES_PER_ELEMENT
      : tokenIdWidthBits === PERFECT_PROTOTYPE_ROW_TOKEN_ID_WIDTH_UINT32
        ? Uint32Array.BYTES_PER_ELEMENT
        : 0
  if (bytesPerTokenId < 1) {
    throw new Error(`Unsupported row-token id width: ${tokenIdWidthBits}`)
  }
  const expectedTokenIdsByteLength = expectedTokenPostingCount * bytesPerTokenId
  if (tokenIdsBuffer.byteLength !== expectedTokenIdsByteLength) {
    throw new Error(
      `Row-token ids byte length mismatch: expected=${expectedTokenIdsByteLength} actual=${tokenIdsBuffer.byteLength} path=${resolvedTokenIdsPath}`,
    )
  }
  const rowTokenIds =
    tokenIdWidthBits === PERFECT_PROTOTYPE_ROW_TOKEN_ID_WIDTH_UINT16
      ? new Uint16Array(
          tokenIdsBuffer.buffer,
          tokenIdsBuffer.byteOffset,
          expectedTokenPostingCount,
        )
      : new Uint32Array(
          tokenIdsBuffer.buffer,
          tokenIdsBuffer.byteOffset,
          expectedTokenPostingCount,
        )
  return {
    rowTokenOffsets,
    rowTokenIds,
    tokenIdWidthBits,
  }
}
