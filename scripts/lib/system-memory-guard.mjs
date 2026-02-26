import fs from "node:fs"
import os from "node:os"

const toBytes = (kb) => {
  const n = Number(kb)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n * 1024)
}

export const parseProcMeminfo = (raw) => {
  const text = String(raw ?? "")
  const totalMatch = text.match(/^MemTotal:\s+(\d+)\s+kB$/m)
  const availableMatch = text.match(/^MemAvailable:\s+(\d+)\s+kB$/m)
  const freeMatch = text.match(/^MemFree:\s+(\d+)\s+kB$/m)
  const buffersMatch = text.match(/^Buffers:\s+(\d+)\s+kB$/m)
  const cachedMatch = text.match(/^Cached:\s+(\d+)\s+kB$/m)
  const swapTotalMatch = text.match(/^SwapTotal:\s+(\d+)\s+kB$/m)
  const swapFreeMatch = text.match(/^SwapFree:\s+(\d+)\s+kB$/m)

  const totalBytes = toBytes(totalMatch?.[1] ?? 0)
  let availableBytes = toBytes(availableMatch?.[1] ?? 0)
  if (availableBytes <= 0) {
    availableBytes =
      toBytes(freeMatch?.[1] ?? 0) +
      toBytes(buffersMatch?.[1] ?? 0) +
      toBytes(cachedMatch?.[1] ?? 0)
  }
  if (totalBytes <= 0) {
    return null
  }
  return {
    source: "procfs",
    totalBytes,
    availableBytes: Math.max(0, Math.min(totalBytes, availableBytes)),
    swapTotalBytes: toBytes(swapTotalMatch?.[1] ?? 0),
    swapFreeBytes: toBytes(swapFreeMatch?.[1] ?? 0),
  }
}

export const readSystemMemorySnapshot = (fsImpl = fs) => {
  try {
    const parsed = parseProcMeminfo(
      fsImpl.readFileSync("/proc/meminfo", "utf8"),
    )
    if (parsed) {
      const usedBytes = Math.max(0, parsed.totalBytes - parsed.availableBytes)
      const usedPct =
        parsed.totalBytes > 0 ? (usedBytes / parsed.totalBytes) * 100 : 0
      const swapUsedBytes = Math.max(
        0,
        Number(parsed.swapTotalBytes ?? 0) - Number(parsed.swapFreeBytes ?? 0),
      )
      const swapUsedPct =
        Number(parsed.swapTotalBytes ?? 0) > 0
          ? (swapUsedBytes / Number(parsed.swapTotalBytes)) * 100
          : 0
      return { ...parsed, usedBytes, usedPct, swapUsedBytes, swapUsedPct }
    }
  } catch {
    // fallback to os module when /proc/meminfo is unavailable
  }
  const totalBytes = Number(os.totalmem?.() ?? 0)
  const availableBytes = Number(os.freemem?.() ?? 0)
  const usedBytes = Math.max(0, totalBytes - availableBytes)
  const usedPct = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0
  return {
    source: "os",
    totalBytes,
    availableBytes,
    usedBytes,
    usedPct,
    swapTotalBytes: 0,
    swapFreeBytes: 0,
    swapUsedBytes: 0,
    swapUsedPct: 0,
  }
}

export const createSystemMemoryGuard = (input = {}) => {
  const warnPct = Number.isFinite(input.warnPct) ? Number(input.warnPct) : 80
  const stopPct = Number.isFinite(input.stopPct) ? Number(input.stopPct) : 90
  const swapWarnPct = Number.isFinite(input.swapWarnPct)
    ? Number(input.swapWarnPct)
    : 45
  const swapStopPct = Number.isFinite(input.swapStopPct)
    ? Number(input.swapStopPct)
    : 60
  const sampleMinIntervalMs = Number.isFinite(input.sampleMinIntervalMs)
    ? Number(input.sampleMinIntervalMs)
    : 4000
  const now = typeof input.now === "function" ? input.now : () => Date.now()
  const readSnapshot =
    typeof input.readSnapshot === "function"
      ? input.readSnapshot
      : () => readSystemMemorySnapshot()
  const onWarn = typeof input.onWarn === "function" ? input.onWarn : () => {}

  let lastSampleAt = 0
  let lastSnapshot = null
  let lastWarnAt = 0

  const sample = (force = false) => {
    const ts = now()
    if (!force && lastSnapshot && ts - lastSampleAt < sampleMinIntervalMs) {
      return lastSnapshot
    }
    const snap = readSnapshot()
    lastSampleAt = ts
    lastSnapshot = {
      ...snap,
      usedPct: Number.isFinite(snap?.usedPct) ? Number(snap.usedPct) : 0,
      swapUsedPct: Number.isFinite(snap?.swapUsedPct)
        ? Number(snap.swapUsedPct)
        : 0,
      stop:
        (Number.isFinite(snap?.usedPct) && snap.usedPct >= stopPct) ||
        (Number.isFinite(snap?.swapUsedPct) && snap.swapUsedPct >= swapStopPct),
      warn:
        (Number.isFinite(snap?.usedPct) && snap.usedPct >= warnPct) ||
        (Number.isFinite(snap?.swapUsedPct) && snap.swapUsedPct >= swapWarnPct),
    }
    return lastSnapshot
  }

  const check = (context = "") => {
    const snap = sample(false)
    const ts = now()
    if (snap.warn && ts - lastWarnAt >= sampleMinIntervalMs) {
      lastWarnAt = ts
      onWarn({
        ...snap,
        context: String(context ?? ""),
        warnPct,
        stopPct,
        swapWarnPct,
        swapStopPct,
      })
    }
    return snap
  }

  return {
    warnPct,
    stopPct,
    swapWarnPct,
    swapStopPct,
    sampleMinIntervalMs,
    check,
    forceSample: () => sample(true),
  }
}
