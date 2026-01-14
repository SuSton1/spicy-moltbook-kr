import fs from "node:fs"
import path from "node:path"
import dotenv from "dotenv"
import iconv from "iconv-lite"
import yauzl from "yauzl"

const rootDir = process.cwd()
const dataDir = path.join(rootDir, "server", "data")
const publicDir = path.join(rootDir, "public", "data")
const DEFAULT_KOSPI_URL =
  "https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip"
const DEFAULT_KOSDAQ_URL =
  "https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip"

const loadLocalEnv = () => {
  const candidates = [".env.local", "env.local"]
  candidates.forEach((file) => {
    const fullPath = path.join(rootDir, file)
    if (fs.existsSync(fullPath)) {
      dotenv.config({ path: fullPath })
    }
  })
}

const normalizeSymbol = (value) => value.trim().toUpperCase()
const isSymbol = (value) => /^[0-9A-Z]{6}$/.test(value)

const pickName = (parts) => {
  const candidate = parts.find((part) => /[A-Za-z가-힣]/.test(part))
  return candidate?.trim() ?? ""
}

const readFixedWidthName = (raw) => {
  const nameField = raw.slice(21)
  if (!nameField) {
    return ""
  }
  return nameField.split(/\s{2,}/)[0].trim()
}

const parseSymbolLines = (content, market, updatedAt) => {
  const items = []
  const seen = new Set()
  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    const raw = line.trim()
    if (!raw) {
      continue
    }

    let symbol = ""
    let name = ""

    if (raw.includes("|")) {
      const parts = raw.split("|").map((part) => part.trim())
      const symbolPart = parts.find((part) => isSymbol(normalizeSymbol(part)))
      symbol = symbolPart ? normalizeSymbol(symbolPart) : ""
      if (!symbol) {
        const candidate = normalizeSymbol(parts[0] ?? "")
        if (isSymbol(candidate)) {
          symbol = candidate
        }
      }
      name = pickName(parts)
    } else {
      const candidate = normalizeSymbol(raw.slice(0, 6))
      if (isSymbol(candidate)) {
        symbol = candidate
        name = readFixedWidthName(raw)
      }
    }

    if (!symbol || !name || seen.has(symbol)) {
      continue
    }

    seen.add(symbol)
    items.push({
      symbol,
      name,
      market,
      kind: "UNKNOWN",
      status: "UNKNOWN",
      updatedAt,
    })
  }

  return items
}

const download = async (url) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

const isZip = (buffer) =>
  buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b

const extractZipEntry = (buffer) =>
  new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(err || new Error("Zip open failed"))
        return
      }
      let resolved = false
      zip.readEntry()
      zip.on("entry", (entry) => {
        if (/\.mst$/i.test(entry.fileName)) {
          zip.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) {
              reject(streamErr || new Error("Zip stream failed"))
              return
            }
            const chunks = []
            stream.on("data", (chunk) => chunks.push(chunk))
            stream.on("end", () => {
              resolved = true
              resolve(Buffer.concat(chunks))
            })
            stream.on("error", reject)
          })
        } else {
          zip.readEntry()
        }
      })
      zip.on("end", () => {
        if (!resolved) {
          reject(new Error("No .mst entry found"))
        }
      })
      zip.on("error", reject)
    })
  })

const decodeText = (buffer) => iconv.decode(buffer, "euc-kr")

const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const run = async () => {
  loadLocalEnv()
  const kospiEnv = process.env.KIS_MASTER_KOSPI_URL
  const kosdaqEnv = process.env.KIS_MASTER_KOSDAQ_URL
  const kospiUrl = kospiEnv || DEFAULT_KOSPI_URL
  const kosdaqUrl = kosdaqEnv || DEFAULT_KOSDAQ_URL
  const usedDefault = {
    kospi: !kospiEnv,
    kosdaq: !kosdaqEnv,
  }

  const updatedAt = new Date().toISOString()

  try {
    const kospiBuffer = await download(kospiUrl)
    const kospiPayload = isZip(kospiBuffer)
      ? await extractZipEntry(kospiBuffer)
      : kospiBuffer
    const kospiContent = decodeText(kospiPayload)
    const kospiItems = parseSymbolLines(kospiContent, "KOSPI", updatedAt)

    const kosdaqBuffer = await download(kosdaqUrl)
    const kosdaqPayload = isZip(kosdaqBuffer)
      ? await extractZipEntry(kosdaqBuffer)
      : kosdaqBuffer
    const kosdaqContent = decodeText(kosdaqPayload)
    const kosdaqItems = parseSymbolLines(kosdaqContent, "KOSDAQ", updatedAt)

    const allItems = [...kospiItems, ...kosdaqItems]

    writeJson(path.join(dataDir, "symbols.kospi.json"), kospiItems)
    writeJson(path.join(dataDir, "symbols.kosdaq.json"), kosdaqItems)
    writeJson(path.join(dataDir, "symbols.all.json"), allItems)

    const clientItems = allItems.map(({ symbol, name, market }) => ({
      symbol,
      name,
      market,
    }))
    writeJson(path.join(publicDir, "symbols.all.json"), clientItems)

    console.log(
      `symbols updated: KOSPI ${kospiItems.length}, KOSDAQ ${kosdaqItems.length}, ALL ${allItems.length}`,
    )
  } catch (error) {
    if (usedDefault.kospi || usedDefault.kosdaq) {
      const message =
        error instanceof Error ? error.message : String(error ?? "")
      throw new Error(
        `${message}\nIf the public master URLs are blocked, set KIS_MASTER_KOSPI_URL/KIS_MASTER_KOSDAQ_URL in env.local to override.`,
      )
    }
    throw error
  }
}

run().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
