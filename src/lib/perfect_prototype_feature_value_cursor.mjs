import fsp from "node:fs/promises"

import { readPerfectPrototypeBinaryRange } from "./perfect_prototype_binary_io.mjs"

const touchMapEntry = (map, key, value) => {
  if (map.has(key)) {
    map.delete(key)
  }
  map.set(key, value)
}

export const createPerfectPrototypeFeatureValueFilePool = ({
  maxOpenHandles = 64,
} = {}) => {
  const safeMaxOpenHandles = Math.max(1, Math.floor(Number(maxOpenHandles) || 64))
  const handles = new Map()
  let peakOpenHandles = 0

  const evictIfNeeded = async () => {
    while (handles.size >= safeMaxOpenHandles) {
      const oldestKey = handles.keys().next().value
      const oldest = handles.get(oldestKey)
      handles.delete(oldestKey)
      await oldest?.handle?.close().catch(() => {})
    }
    peakOpenHandles = Math.max(peakOpenHandles, handles.size)
  }

  const getHandle = async (binPath) => {
    const normalizedPath = String(binPath ?? "").trim()
    if (!normalizedPath) {
      throw new Error("Feature value cursor requires binPath")
    }
    const cached = handles.get(normalizedPath)
    if (cached?.handle) {
      touchMapEntry(handles, normalizedPath, cached)
      return cached.handle
    }
    await evictIfNeeded()
    const handle = await fsp.open(normalizedPath, "r")
    touchMapEntry(handles, normalizedPath, { handle })
    peakOpenHandles = Math.max(peakOpenHandles, handles.size)
    return handle
  }

  return {
    async readRange({ binPath, offset, byteLength }) {
      const handle = await getHandle(binPath)
      return readPerfectPrototypeBinaryRange({
        fileHandle: handle,
        filePath: binPath,
        offset,
        byteLength,
        label: "feature_values.bin",
      })
    },
    async close() {
      const closing = Array.from(handles.values())
      handles.clear()
      for (const entry of closing) {
        await entry?.handle?.close().catch(() => {})
      }
    },
    getPeakOpenHandles() {
      return peakOpenHandles
    },
  }
}

export const createPerfectPrototypeFeatureValueCursor = ({
  filePool,
  binPath,
  offset,
  count,
  chunkSize = 4096,
}) => {
  const normalizedBinPath = String(binPath ?? "").trim()
  const totalCount = Math.max(0, Math.floor(Number(count) || 0))
  const safeChunkSize = Math.max(1, Math.floor(Number(chunkSize) || 4096))
  const baseOffset = Math.max(0, Math.floor(Number(offset) || 0))
  let cursorIndex = 0
  let chunkStartIndex = 0
  let chunkValueCount = 0
  let chunkBuffer = null

  const ensureChunkLoaded = async () => {
    if (cursorIndex >= totalCount) {
      chunkBuffer = null
      chunkValueCount = 0
      return false
    }
    if (
      chunkBuffer &&
      cursorIndex >= chunkStartIndex &&
      cursorIndex < chunkStartIndex + chunkValueCount
    ) {
      return true
    }
    chunkStartIndex = cursorIndex
    chunkValueCount = Math.min(safeChunkSize, totalCount - chunkStartIndex)
    chunkBuffer = await filePool.readRange({
      binPath: normalizedBinPath,
      offset: baseOffset + chunkStartIndex * 8,
      byteLength: chunkValueCount * 8,
    })
    return true
  }

  const readCurrentValue = () => {
    const localIndex = cursorIndex - chunkStartIndex
    return chunkBuffer.readDoubleLE(localIndex * 8)
  }

  return {
    async peek() {
      const loaded = await ensureChunkLoaded()
      if (!loaded) return null
      return readCurrentValue()
    },
    async advance() {
      if (cursorIndex >= totalCount) return false
      cursorIndex += 1
      if (cursorIndex >= totalCount) {
        chunkBuffer = null
        chunkValueCount = 0
        return false
      }
      await ensureChunkLoaded()
      return true
    },
  }
}
