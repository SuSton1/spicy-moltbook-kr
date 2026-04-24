import fs from "node:fs"
import { once } from "node:events"
import readline from "node:readline"
import zlib from "node:zlib"

export const toText = (value) => String(value ?? "").trim()

export const toNumber = (value, fallback = NaN) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback
  if (value === true || value === false) return value
  const text = toText(value).toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  return fallback
}

export const validDateKey = (dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(toText(dateKey))

export const assertDateKey = (dateKey, label) => {
  const text = toText(dateKey)
  if (!validDateKey(text)) throw new Error(`${label} must be YYYY-MM-DD: ${text || "missing"}`)
  return text
}

export const iterateJsonlMaybeGzip = async (filePath, { strict = true, onRow } = {}) => {
  const sourcePath = toText(filePath)
  if (!sourcePath) throw new Error("JSONL input path is required")
  const source = fs.createReadStream(sourcePath)
  const input = sourcePath.endsWith(".gz") ? source.pipe(zlib.createGunzip()) : source
  const rl = readline.createInterface({ input, crlfDelay: Infinity })
  let lineNumber = 0
  try {
    for await (const line of rl) {
      lineNumber += 1
      const text = String(line ?? "")
      if (!text.trim()) continue
      let row = null
      try {
        row = JSON.parse(text)
      } catch (error) {
        if (strict) {
          throw new Error(
            `Malformed JSONL at ${sourcePath}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        continue
      }
      if (typeof onRow === "function") {
        const outcome = await onRow(row, { lineNumber, filePath: sourcePath })
        if (outcome === false) break
      }
    }
  } finally {
    rl.close()
    source.destroy()
    if (input !== source && typeof input.destroy === "function") input.destroy()
  }
}

export const closeWriteStream = async (stream) => {
  await new Promise((resolve, reject) => {
    stream.once("error", reject)
    stream.end(() => {
      stream.removeListener("error", reject)
      resolve()
    })
  })
}

export const createJsonlWriteStreamMaybeGzip = (filePath) => {
  const targetPath = toText(filePath)
  if (!targetPath) throw new Error("JSONL output path is required")
  const fileStream = fs.createWriteStream(targetPath)
  if (!targetPath.endsWith(".gz")) {
    return {
      stream: fileStream,
      close: async () => {
        await closeWriteStream(fileStream)
      },
    }
  }
  const gzipStream = zlib.createGzip()
  gzipStream.pipe(fileStream)
  return {
    stream: gzipStream,
    close: async () => {
      const finished = once(fileStream, "finish")
      await closeWriteStream(gzipStream)
      await finished
    },
  }
}

export const writeJsonlRows = async (filePath, rows) => {
  const writer = createJsonlWriteStreamMaybeGzip(filePath)
  try {
    for (const row of rows) {
      const ok = writer.stream.write(`${JSON.stringify(row)}\n`)
      if (!ok) await once(writer.stream, "drain")
    }
  } finally {
    await writer.close()
  }
}

export const writeJsonlRow = async (stream, row) => {
  const ok = stream.write(`${JSON.stringify(row)}\n`)
  if (!ok) await once(stream, "drain")
}

export const dateYear = (dateKey) => Number(toText(dateKey).slice(0, 4))

export const incrementMap = (map, key, amount = 1) => {
  map.set(key, (map.get(key) ?? 0) + amount)
}

export const mapToSortedObject = (map) =>
  Object.fromEntries([...map.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))))

export const uniqueSorted = (values) => [...new Set(values.map((value) => toText(value)).filter(Boolean))].sort()
