const FILE_SIZE_CACHE_SYMBOL = Symbol.for("perfectPrototypeBinaryIo.fileSize")

const toNonNegativeInteger = (value) => Math.max(0, Math.floor(Number(value) || 0))

const resolveFilePathLabel = ({ fileHandle, filePath = null, label = "binary file" }) => {
  const explicitPath = String(filePath ?? "").trim()
  if (explicitPath) return explicitPath
  const handlePath = typeof fileHandle?.path === "string" ? String(fileHandle.path).trim() : ""
  if (handlePath) return handlePath
  return label
}

const resolveCachedFileSize = async (fileHandle) => {
  const cached = Number(fileHandle?.[FILE_SIZE_CACHE_SYMBOL])
  if (Number.isFinite(cached) && cached >= 0) {
    return cached
  }
  const stats = await fileHandle.stat()
  const size = toNonNegativeInteger(stats?.size)
  fileHandle[FILE_SIZE_CACHE_SYMBOL] = size
  return size
}

export const assertPerfectPrototypeBinaryReadRange = async ({
  fileHandle,
  filePath = null,
  offset,
  byteLength,
  label = "binary file",
}) => {
  if (!fileHandle) {
    throw new Error(`Missing fileHandle for ${label}`)
  }
  const normalizedOffset = toNonNegativeInteger(offset)
  const normalizedByteLength = toNonNegativeInteger(byteLength)
  const fileSize = await resolveCachedFileSize(fileHandle)
  const endOffset = normalizedOffset + normalizedByteLength
  if (endOffset > fileSize) {
    const resolvedPath = resolveFilePathLabel({ fileHandle, filePath, label })
    throw new Error(
      [
        `${label} read range exceeds file size: ${resolvedPath}`,
        `offset=${normalizedOffset}`,
        `requestedBytes=${normalizedByteLength}`,
        `fileSize=${fileSize}`,
      ].join(" "),
    )
  }
  return {
    offset: normalizedOffset,
    byteLength: normalizedByteLength,
    fileSize,
  }
}

export const readPerfectPrototypeBinaryRange = async ({
  fileHandle,
  filePath = null,
  offset,
  byteLength,
  label = "binary file",
}) => {
  const validated = await assertPerfectPrototypeBinaryReadRange({
    fileHandle,
    filePath,
    offset,
    byteLength,
    label,
  })
  if (validated.byteLength < 1) {
    return Buffer.alloc(0)
  }
  const buffer = Buffer.allocUnsafe(validated.byteLength)
  const { bytesRead } = await fileHandle.read(
    buffer,
    0,
    validated.byteLength,
    validated.offset,
  )
  if (bytesRead !== validated.byteLength) {
    const resolvedPath = resolveFilePathLabel({ fileHandle, filePath, label })
    throw new Error(
      [
        `${label} short read: ${resolvedPath}`,
        `offset=${validated.offset}`,
        `requestedBytes=${validated.byteLength}`,
        `actualBytes=${toNonNegativeInteger(bytesRead)}`,
        `fileSize=${validated.fileSize}`,
      ].join(" "),
    )
  }
  return buffer
}

export const clearPerfectPrototypeBinaryIoFileSizeCache = (fileHandle) => {
  if (!fileHandle) return
  delete fileHandle[FILE_SIZE_CACHE_SYMBOL]
}
