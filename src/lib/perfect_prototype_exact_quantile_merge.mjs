import {
  streamPerfectPrototypeFeatureValueIndexRows,
} from "./perfect_prototype_feature_values_sidecar.mjs"
import {
  createPerfectPrototypeFeatureValueCursor,
  createPerfectPrototypeFeatureValueFilePool,
} from "./perfect_prototype_feature_value_cursor.mjs"

const buildQuantileRequest = (binCount) =>
  Array.from({ length: Math.max(0, Number(binCount ?? 0) - 1) }, (_, index) => {
    const qIndex = index + 1
    const q = qIndex / binCount
    const key = `q_${String(qIndex).padStart(2, "0")}`
    return { q, key }
  })

const selectExactQuantilesFromSortedCursors = async ({ cursors, binCount, count }) => {
  const requests = buildQuantileRequest(binCount)
  const valuesByRequestKey = new Map()
  if (count < 2 || requests.length < 1) {
    return valuesByRequestKey
  }
  const positions = []
  for (const request of requests) {
    const rawPosition = request.q * (count - 1)
    positions.push({
      ...request,
      lowerIndex: Math.floor(rawPosition),
      upperIndex: Math.ceil(rawPosition),
      fraction: rawPosition - Math.floor(rawPosition),
      lowerValue: null,
      upperValue: null,
    })
  }
  const heap = []
  const pushHeap = (entry) => {
    heap.push(entry)
    let cursor = heap.length - 1
    while (cursor > 0) {
      const parent = Math.floor((cursor - 1) / 2)
      if (heap[parent].value <= heap[cursor].value) break
      ;[heap[parent], heap[cursor]] = [heap[cursor], heap[parent]]
      cursor = parent
    }
  }
  const popHeap = () => {
    if (heap.length < 1) return null
    const first = heap[0]
    const last = heap.pop()
    if (heap.length > 0 && last) {
      heap[0] = last
      let cursor = 0
      for (;;) {
        const left = cursor * 2 + 1
        const right = left + 1
        let smallest = cursor
        if (left < heap.length && heap[left].value < heap[smallest].value) {
          smallest = left
        }
        if (right < heap.length && heap[right].value < heap[smallest].value) {
          smallest = right
        }
        if (smallest === cursor) break
        ;[heap[cursor], heap[smallest]] = [heap[smallest], heap[cursor]]
        cursor = smallest
      }
    }
    return first
  }

  const maxTargetIndex = Math.max(...positions.map((request) => request.upperIndex))
  for (const cursor of Array.isArray(cursors) ? cursors : []) {
    const value = await cursor?.peek?.()
    if (!Number.isFinite(value)) continue
    pushHeap({
      cursor,
      value,
    })
  }
  let globalIndex = 0
  while (heap.length > 0 && globalIndex <= maxTargetIndex) {
    const current = popHeap()
    const value = Number(current?.value)
    for (const request of positions) {
      if (request.lowerValue == null && globalIndex === request.lowerIndex) {
        request.lowerValue = value
      }
      if (request.upperValue == null && globalIndex === request.upperIndex) {
        request.upperValue = value
      }
    }
    const hasNext = await current.cursor.advance()
    if (hasNext) {
      const nextValue = await current.cursor.peek()
      if (Number.isFinite(nextValue)) {
        pushHeap({
          cursor: current.cursor,
          value: nextValue,
        })
      }
    }
    globalIndex += 1
  }
  for (const request of positions) {
    if (!Number.isFinite(request.lowerValue) || !Number.isFinite(request.upperValue)) continue
    const quantileValue =
      request.lowerIndex === request.upperIndex
        ? request.lowerValue
        : request.lowerValue + (request.upperValue - request.lowerValue) * request.fraction
    valuesByRequestKey.set(request.key, quantileValue)
  }
  return valuesByRequestKey
}

export const collectPerfectPrototypeTokenizerFeatureStatsRowsFromFeatureValueSidecars = async ({
  cwd = process.cwd(),
  featureValueInputs,
  binCount,
  maxOpenHandles = 64,
  statsTarget = null,
}) => {
  const startedAt = Date.now()
  const refsByFeatureKey = new Map()
  for (const input of Array.isArray(featureValueInputs) ? featureValueInputs : []) {
    const binPath = String(input?.binPath ?? "").trim()
    const indexPath = String(input?.indexPath ?? "").trim()
    if (!binPath || !indexPath) continue
    await streamPerfectPrototypeFeatureValueIndexRows({
      cwd,
      indexPath,
      onRow: async (row) => {
        const featureKey = String(row?.featureKey ?? "").trim()
        if (!featureKey) return
        const bucket = refsByFeatureKey.get(featureKey) ?? []
        bucket.push({
          binPath,
          offset: Number(row?.offset ?? 0),
          count: Number(row?.count ?? 0),
          min: Number(row?.min),
          max: Number(row?.max),
        })
        refsByFeatureKey.set(featureKey, bucket)
      },
    })
  }
  const rows = []
  const filePool = createPerfectPrototypeFeatureValueFilePool({
    maxOpenHandles,
  })
  try {
    for (const featureKey of Array.from(refsByFeatureKey.keys()).sort((left, right) =>
      left.localeCompare(right),
    )) {
      const refs = refsByFeatureKey.get(featureKey) ?? []
      const cursors = []
      let count = 0
      let min = null
      let max = null
      for (const ref of refs) {
        const refCount = Math.max(0, Math.floor(Number(ref?.count) || 0))
        if (refCount < 1) continue
        count += refCount
        const refMin = Number(ref?.min)
        const refMax = Number(ref?.max)
        if (Number.isFinite(refMin)) {
          min = min == null ? refMin : Math.min(min, refMin)
        }
        if (Number.isFinite(refMax)) {
          max = max == null ? refMax : Math.max(max, refMax)
        }
        cursors.push(
          createPerfectPrototypeFeatureValueCursor({
            filePool,
            binPath: ref.binPath,
            offset: ref.offset,
            count: refCount,
          }),
        )
      }
      if (count < 2 || cursors.length < 1) continue
      const quantiles = await selectExactQuantilesFromSortedCursors({
        cursors,
        binCount,
        count,
      })
      const row = {
        featureKey,
        count,
        min,
        max,
      }
      for (const [key, value] of quantiles.entries()) {
        row[key] = value
      }
      rows.push(row)
    }
  } finally {
    await filePool.close()
    if (statsTarget && typeof statsTarget === "object") {
      statsTarget.quantileMergeMs = Date.now() - startedAt
      statsTarget.fdPoolPeak = Number(filePool.getPeakOpenHandles?.() ?? 0)
    }
  }
  return rows
}
