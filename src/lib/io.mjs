import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { once } from "node:events"
import readline from "node:readline"

export const ensureDir = async (dirPath) => {
  await fsp.mkdir(dirPath, { recursive: true })
}

export const pathExists = (filePath) => fs.existsSync(filePath)

export const readJson = async (filePath, defaultValue = null) => {
  if (!pathExists(filePath)) return defaultValue
  const raw = await fsp.readFile(filePath, "utf8")
  return JSON.parse(raw)
}

export const readJsonIfExistsStrict = async (filePath) => {
  try {
    const raw = await fsp.readFile(filePath, "utf8")
    return JSON.parse(raw)
  } catch (error) {
    if (error && typeof error === "object" && String(error.code ?? "") === "ENOENT") {
      return null
    }
    throw error
  }
}

export const writeJson = async (filePath, value) => {
  await ensureDir(path.dirname(filePath))
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

export const writeJsonAtomic = async (filePath, value) => {
  const dirPath = path.dirname(filePath)
  await ensureDir(dirPath)
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  const tempPath = path.join(
    dirPath,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  let handle = null
  try {
    handle = await fsp.open(tempPath, "w")
    await handle.writeFile(serialized, "utf8")
    await handle.sync()
    await handle.close()
    handle = null
    await fsp.rename(tempPath, filePath)
  } catch (error) {
    if (handle) {
      try {
        await handle.close()
      } catch {}
    }
    try {
      await fsp.unlink(tempPath)
    } catch {}
    throw error
  }
}

export const readJsonl = async (filePath, options = {}) => {
  if (!pathExists(filePath)) return []
  const filterFn = typeof options?.filter === "function" ? options.filter : null
  const mapFn = typeof options?.map === "function" ? options.map : null
  const limitRaw = Number(options?.limit)
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : null
  const rows = []
  await iterateJsonl(filePath, {
    ...options,
    onRow: async (row) => {
      if (filterFn && filterFn(row) !== true) return
      const mapped = mapFn ? mapFn(row) : row
      if (mapped === undefined) return
      rows.push(mapped)
      if (limit && rows.length >= limit) return false
      return undefined
    },
  })
  return rows
}

export const iterateJsonl = async (filePath, options = {}) => {
  if (!pathExists(filePath)) return
  const strict = options?.strict === true
  const onRow = typeof options?.onRow === "function" ? options.onRow : null
  const stream = fs.createReadStream(filePath, { encoding: "utf8" })
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  })
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
            `Malformed JSONL at ${filePath}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        continue
      }
      if (!onRow) continue
      const outcome = await onRow(row)
      if (outcome === false) break
    }
  } finally {
    rl.close()
    stream.destroy()
  }
}

export const parseDelimitedLine = (line, options = {}) => {
  const separator = typeof options?.separator === "string" && options.separator.length > 0
    ? options.separator
    : "\t"
  const quote = typeof options?.quote === "string" && options.quote.length > 0
    ? options.quote
    : "\""
  const values = []
  let current = ""
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (inQuotes) {
      if (char === quote) {
        if (line[index + 1] === quote) {
          current += quote
          index += 1
          continue
        }
        inQuotes = false
        continue
      }
      current += char
      continue
    }
    if (char === quote) {
      inQuotes = true
      continue
    }
    if (char === separator) {
      values.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (inQuotes) {
    throw new Error("Unterminated quoted field in delimited row")
  }
  values.push(current)
  return values
}

export const iterateDelimited = async (filePath, options = {}) => {
  if (!pathExists(filePath)) return
  const strict = options?.strict !== false
  const onRow = typeof options?.onRow === "function" ? options.onRow : null
  const parseRow = typeof options?.parseRow === "function" ? options.parseRow : null
  const separator = typeof options?.separator === "string" && options.separator.length > 0
    ? options.separator
    : "\t"
  const quote = typeof options?.quote === "string" && options.quote.length > 0
    ? options.quote
    : "\""
  const stream = fs.createReadStream(filePath, { encoding: "utf8" })
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  })
  let lineNumber = 0
  try {
    for await (const line of rl) {
      lineNumber += 1
      const text = String(line ?? "")
      if (!text.trim()) continue
      let row = null
      try {
        const values = parseDelimitedLine(text, { separator, quote })
        row = parseRow ? parseRow(values, { filePath, lineNumber, line: text }) : values
      } catch (error) {
        if (strict) {
          throw new Error(
            `Malformed delimited row at ${filePath}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        continue
      }
      if (!onRow) continue
      const outcome = await onRow(row)
      if (outcome === false) break
    }
  } finally {
    rl.close()
    stream.destroy()
  }
}

export const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath))
  const safeRows = Array.isArray(rows) ? rows : []
  const stream = fs.createWriteStream(filePath, { encoding: "utf8" })
  try {
    for (const row of safeRows) {
      const ok = stream.write(`${JSON.stringify(row)}\n`)
      if (!ok) {
        await once(stream, "drain")
      }
    }
  } finally {
    await new Promise((resolve, reject) => {
      stream.once("error", reject)
      stream.end(() => {
        stream.removeListener("error", reject)
        resolve()
      })
    })
  }
}

export const createJsonlWriter = async (filePath) => {
  await ensureDir(path.dirname(filePath))
  const stream = fs.createWriteStream(filePath, { encoding: "utf8" })
  let closed = false

  const writeRow = async (row) => {
    if (closed) {
      throw new Error(`JSONL writer already closed: ${filePath}`)
    }
    const chunk = `${JSON.stringify(row)}\n`
    const ok = stream.write(chunk)
    if (!ok) {
      await once(stream, "drain")
    }
  }

  const writeRows = async (rows) => {
    const safeRows = Array.isArray(rows) ? rows : []
    if (safeRows.length < 1) return
    if (closed) {
      throw new Error(`JSONL writer already closed: ${filePath}`)
    }
    const chunk = `${safeRows.map((row) => JSON.stringify(row)).join("\n")}\n`
    const ok = stream.write(chunk)
    if (!ok) {
      await once(stream, "drain")
    }
  }

  const close = async () => {
    if (closed) return
    closed = true
    await new Promise((resolve, reject) => {
      stream.once("error", reject)
      stream.end(() => {
        stream.removeListener("error", reject)
        resolve()
      })
    })
  }

  return { writeRow, writeRows, close }
}

export const toRunId = (now = new Date()) => {
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(now.getUTCDate()).padStart(2, "0")
  const hh = String(now.getUTCHours()).padStart(2, "0")
  const mi = String(now.getUTCMinutes()).padStart(2, "0")
  const ss = String(now.getUTCSeconds()).padStart(2, "0")
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`
}
