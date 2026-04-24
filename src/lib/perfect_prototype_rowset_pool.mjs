const DEFAULT_MAX_BUCKET_SIZE = 64

const borrowBufferFromBucket = (bucketMap, length) => {
  const bucket = bucketMap.get(length) ?? null
  if (!bucket || bucket.length < 1) return null
  return bucket.pop() ?? null
}

const releaseBufferToBucket = (bucketMap, length, buffer, maxBucketSize) => {
  if (!(buffer instanceof Uint32Array) || buffer.length !== length || length < 0) return
  const bucket = bucketMap.get(length) ?? []
  if (bucket.length >= maxBucketSize) return
  bucket.push(buffer)
  bucketMap.set(length, bucket)
}

export const createPerfectPrototypeRowsetPool = ({
  maxBucketSize = DEFAULT_MAX_BUCKET_SIZE,
} = {}) => {
  const safeMaxBucketSize = Math.max(1, Math.floor(Number(maxBucketSize) || DEFAULT_MAX_BUCKET_SIZE))
  const sparseValuesBuckets = new Map()
  const bitsetWordsBuckets = new Map()

  let sparseBorrowHitCount = 0
  let sparseBorrowMissCount = 0
  let bitsetBorrowHitCount = 0
  let bitsetBorrowMissCount = 0
  let releaseCount = 0

  const borrowSparseValues = (length) => {
    const safeLength = Math.max(0, Math.floor(Number(length) || 0))
    const buffer = borrowBufferFromBucket(sparseValuesBuckets, safeLength)
    if (buffer) {
      sparseBorrowHitCount += 1
      return {
        kind: "sparse",
        length: safeLength,
        buffer,
      }
    }
    sparseBorrowMissCount += 1
    return {
      kind: "sparse",
      length: safeLength,
      buffer: new Uint32Array(safeLength),
    }
  }

  const borrowBitsetWords = (length) => {
    const safeLength = Math.max(0, Math.floor(Number(length) || 0))
    const buffer = borrowBufferFromBucket(bitsetWordsBuckets, safeLength)
    if (buffer) {
      bitsetBorrowHitCount += 1
      buffer.fill(0)
      return {
        kind: "bitset",
        length: safeLength,
        buffer,
      }
    }
    bitsetBorrowMissCount += 1
    return {
      kind: "bitset",
      length: safeLength,
      buffer: new Uint32Array(safeLength),
    }
  }

  const releaseLease = (lease) => {
    if (!lease || typeof lease !== "object") return
    const kind = String(lease.kind ?? "").trim()
    const length = Math.max(0, Math.floor(Number(lease.length) || 0))
    const buffer = lease.buffer instanceof Uint32Array ? lease.buffer : null
    if (!buffer) return
    releaseCount += 1
    if (kind === "bitset") {
      buffer.fill(0)
      releaseBufferToBucket(bitsetWordsBuckets, length, buffer, safeMaxBucketSize)
      return
    }
    releaseBufferToBucket(sparseValuesBuckets, length, buffer, safeMaxBucketSize)
  }

  const getStats = () => ({
    sparseBorrowHitCount,
    sparseBorrowMissCount,
    bitsetBorrowHitCount,
    bitsetBorrowMissCount,
    releaseCount,
  })

  const resetStats = () => {
    sparseBorrowHitCount = 0
    sparseBorrowMissCount = 0
    bitsetBorrowHitCount = 0
    bitsetBorrowMissCount = 0
    releaseCount = 0
  }

  return {
    borrowSparseValues,
    borrowBitsetWords,
    releaseLease,
    getStats,
    resetStats,
  }
}
