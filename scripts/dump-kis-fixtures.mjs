import fs from "node:fs"
import path from "node:path"
import dotenv from "dotenv"

const rootDir = process.cwd()
const dataDir = path.join(rootDir, "server", "data")
const outputFile = path.join(dataDir, "kis.contract.json")

const APP_KEY_KEYS = [
  "KIS_APP_KEY",
  "KIS_APPKEY",
  "APP_KEY",
  "APPKEY",
  "VITE_KIS_APP_KEY",
  "VITE_KIS_APPKEY",
  "VITE_APP_KEY",
  "VITE_APPKEY",
]

const APP_SECRET_KEYS = [
  "KIS_APP_SECRET",
  "KIS_APPSECRET",
  "APP_SECRET",
  "APPSECRET",
  "VITE_KIS_APP_SECRET",
  "VITE_KIS_APPSECRET",
  "VITE_APP_SECRET",
  "VITE_APPSECRET",
]

const TR_QUOTE_KEYS = [
  "KIS_TR_PRICE",
  "KIS_TR_QUOTE",
  "KIS_TR_STOCK_PRICE",
  "KIS_TR_ID_PRICE",
  "KIS_TR_ID_QUOTE",
  "VITE_KIS_TR_PRICE",
  "VITE_KIS_TR_QUOTE",
  "VITE_KIS_TR_STOCK_PRICE",
  "VITE_KIS_TR_ID_PRICE",
  "VITE_KIS_TR_ID_QUOTE",
]

const ENV_MODE_KEYS = ["KIS_ENV", "VITE_KIS_ENV"]
const BASE_URL_KEYS = ["KIS_BASE_URL", "VITE_KIS_BASE_URL"]

const readEnvValue = (keys) => {
  for (const key of keys) {
    const value = process.env[key]
    if (value) {
      return value
    }
  }
  return ""
}

const loadLocalEnv = () => {
  const candidates = [".env.local", "env.local"]
  candidates.forEach((file) => {
    const fullPath = path.join(rootDir, file)
    if (fs.existsSync(fullPath)) {
      dotenv.config({ path: fullPath })
    }
  })
}

const DEFAULT_SYMBOLS = [
  "005930",
  "000660",
  "035420",
  "051910",
  "068270",
  "035720",
  "207940",
  "005380",
  "000270",
  "105560",
  "066570",
  "003550",
  "051900",
  "096770",
  "329180",
]

const pickSymbols = (count) => {
  const kospiPath = path.join(dataDir, "symbols.kospi.json")
  const kosdaqPath = path.join(dataDir, "symbols.kosdaq.json")
  const kospi = fs.existsSync(kospiPath)
    ? JSON.parse(fs.readFileSync(kospiPath, "utf8"))
    : []
  const kosdaq = fs.existsSync(kosdaqPath)
    ? JSON.parse(fs.readFileSync(kosdaqPath, "utf8"))
    : []
  const combined = [...kospi, ...kosdaq].map((item) => item.symbol)
  const merged = [...DEFAULT_SYMBOLS]
  for (const symbol of combined) {
    if (merged.length >= count) {
      break
    }
    if (!merged.includes(symbol)) {
      merged.push(symbol)
    }
  }
  return merged.slice(0, count)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const fetchToken = async (baseUrl, appKey, appSecret) => {
  const response = await fetch(`${baseUrl}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      appsecret: appSecret,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message =
      payload?.msg1 || payload?.error_description || "KIS token error"
    throw new Error(message)
  }
  return payload.access_token
}

const fetchQuoteOutput = async (
  baseUrl,
  token,
  appKey,
  appSecret,
  trId,
  code,
) => {
  const url = new URL(
    `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-price`,
  )
  url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J")
  url.searchParams.set("FID_INPUT_ISCD", code)

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: trId,
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.rt_cd !== "0") {
    const message = payload?.msg1 || payload?.message || "KIS quote error"
    throw new Error(message)
  }
  return payload.output ?? {}
}

const run = async () => {
  loadLocalEnv()
  const appKey = readEnvValue(APP_KEY_KEYS)
  const appSecret = readEnvValue(APP_SECRET_KEYS)
  const trId = readEnvValue(TR_QUOTE_KEYS)
  const envMode = readEnvValue(ENV_MODE_KEYS).toLowerCase()
  const baseUrl =
    readEnvValue(BASE_URL_KEYS) ||
    (envMode === "mock"
      ? "https://openapivts.koreainvestment.com:29443"
      : "https://openapi.koreainvestment.com:9443")

  if (!appKey || !appSecret || !trId) {
    throw new Error("Missing KIS keys or TR_ID for quote")
  }

  const symbols = pickSymbols(25)
  if (symbols.length === 0) {
    throw new Error("No symbols found to build fixtures")
  }

  const token = await fetchToken(baseUrl, appKey, appSecret)
  const quotes = {}

  for (const code of symbols) {
    const output = await fetchQuoteOutput(
      baseUrl,
      token,
      appKey,
      appSecret,
      trId,
      code,
    )
    quotes[code] = { output }
    await sleep(160)
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    source: "kis",
    symbols,
    quotes,
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true })
  fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  console.log(`contract fixtures written: ${outputFile}`)
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  console.error(`fixture dump failed: ${message}`)
  process.exitCode = 1
})
