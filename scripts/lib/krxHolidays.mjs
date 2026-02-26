import { normalizeDateKey } from "../ai-date-range.lib.mjs"

const HOSTS = ["https://open.krx.co.kr", "https://marketdata.krx.co.kr"]
const HOLIDAY_PAGE_PATHS = [
  "/contents/MKD/01/0110/01100305/MKD01100305.jsp",
  "/contents/MKD/04/0406/04060100/MKD04060100.jsp",
]
const LEGACY_BLD = "MKD/04/0406/04060100/mkd04060100"
const OTP_PATHS = ["/comm/GenerateOTP.jspx", "/contents/COM/GenerateOTP.jspx"]
const LEGACY_DATA_PATHS = [
  "/contents/OPN/99/OPN99000001.jspx",
  "/contents/COM/MKD99000001.jspx",
  "/comm/MKD99000001.jspx",
]
const SESSION_TTL_MS = 20 * 60_000

const sessionByHost = new Map()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const buildCookieHeader = (setCookies) =>
  (setCookies ?? [])
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((value) => Boolean(value))
    .join("; ")

const buildFormBody = (params) => new URLSearchParams(params).toString()

const isHtmlResponse = (_contentType, bodyText) => {
  const trimmed = String(bodyText ?? "")
    .trim()
    .toLowerCase()
  if (!trimmed) {
    return false
  }
  if (trimmed.startsWith("<!doctype html")) {
    return true
  }
  if (trimmed.startsWith("<html")) {
    return true
  }
  if (trimmed.startsWith("<head")) {
    return true
  }
  if (trimmed.startsWith("<body")) {
    return true
  }
  return trimmed.startsWith("<")
}

export const parseHolidayPageHtml = (bodyText) => {
  if (!bodyText) {
    return null
  }
  const extractAttr = (source, attr) => {
    for (const quote of ['"', "'"]) {
      const token = `${attr}=${quote}`
      const idx = source.indexOf(token)
      if (idx < 0) continue
      const start = idx + token.length
      const end = source.indexOf(quote, start)
      if (end > start) {
        return source.slice(start, end)
      }
    }
    return null
  }

  const extractInputValue = (source, name) => {
    const nameToken = `name=\"${name}\"`
    const nameTokenAlt = `name='${name}'`
    const idx =
      source.indexOf(nameToken) >= 0
        ? source.indexOf(nameToken)
        : source.indexOf(nameTokenAlt)
    if (idx < 0) {
      return null
    }
    const chunk = source.slice(idx, idx + 200)
    for (const quote of ['"', "'"]) {
      const token = `value=${quote}`
      const vIdx = chunk.indexOf(token)
      if (vIdx < 0) continue
      const start = vIdx + token.length
      const end = chunk.indexOf(quote, start)
      if (end > start) {
        return chunk.slice(start, end)
      }
    }
    return null
  }

  const formMatch = bodyText.match(
    /<form[^>]*data-bld=['"]([^'"]+)['"][^>]*>[\s\S]*?<\/form>/i,
  )
  if (!formMatch) {
    return null
  }
  const formHtml = formMatch[0]
  const bld = formMatch[1]
  const actionPath = extractAttr(formHtml, "action")
  const pagePath = extractInputValue(formHtml, "pagePath")
  const gridTp = extractInputValue(formHtml, "gridTp")
  if (!bld || !actionPath || !actionPath.includes("99000001")) {
    return null
  }
  return {
    bld,
    actionPath,
    pagePath,
    gridTp,
  }
}

const fetchWithTimeout = async (url, options, timeoutMs = 12_000) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const bodyText = await response.text()
    return { ok: response.ok, response, bodyText }
  } catch (error) {
    return {
      ok: false,
      response: null,
      bodyText: error instanceof Error ? error.message : String(error ?? ""),
    }
  } finally {
    clearTimeout(timeout)
  }
}

const ensureHolidaySession = async (host, debugLog) => {
  const cached = sessionByHost.get(host)
  if (cached && cached.expiresAt > Date.now() && cached.pageInfo) {
    return { ok: true, cookie: cached.cookie, pageInfo: cached.pageInfo }
  }
  for (const pagePath of HOLIDAY_PAGE_PATHS) {
    const url = new URL(pagePath, host).toString()
    const { ok, response, bodyText } = await fetchWithTimeout(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0",
      },
    })

    const setCookieHeader = response?.headers?.get("set-cookie") ?? null
    const setCookies =
      response?.headers?.getSetCookie?.() ??
      (setCookieHeader ? [setCookieHeader] : [])
    const cookieHeader = buildCookieHeader(setCookies)
    const pageInfo =
      parseHolidayPageHtml(bodyText) ?? (cookieHeader ? null : null)

    if (!ok || !response || !cookieHeader || !pageInfo) {
      debugLog?.({
        stage: "page",
        host,
        path: pagePath,
        status: response?.status ?? 0,
        contentType: response?.headers?.get("content-type") ?? "",
        bodySnippet: String(bodyText ?? "").slice(0, 200),
      })
    }

    if (cookieHeader && pageInfo) {
      const resolvedPagePath = pageInfo.pagePath ?? pagePath
      const resolvedInfo = {
        ...pageInfo,
        pagePath: resolvedPagePath,
        gridTp: pageInfo.gridTp ?? "KRX",
        actionPath: pageInfo.actionPath ?? LEGACY_DATA_PATHS[0],
      }
      sessionByHost.set(host, {
        cookie: cookieHeader,
        pageInfo: resolvedInfo,
        expiresAt: Date.now() + SESSION_TTL_MS,
      })
      return { ok: true, cookie: cookieHeader, pageInfo: resolvedInfo }
    }
  }

  return { ok: false, cookie: null, pageInfo: null }
}

const requestOtp = async ({ host, year, cookie, pageInfo, debugLog }) => {
  const bld = pageInfo?.bld ?? LEGACY_BLD
  const pagePath = pageInfo?.pagePath ?? HOLIDAY_PAGE_PATHS[0]
  const gridTp = pageInfo?.gridTp ?? "KRX"
  const body = buildFormBody({
    bld,
    gridTp,
    search_bas_yy: String(year),
    pagePath,
    nowtime: String(Date.now()),
  })

  for (const otpPath of OTP_PATHS) {
    const url = new URL(otpPath, host).toString()
    const { ok, response, bodyText } = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "text/plain, */*; q=0.01",
          Origin: host,
          Referer: new URL(pagePath, host).toString(),
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body,
      },
      12_000,
    )

    if (!ok || !response) {
      debugLog?.({
        stage: "otp",
        host,
        path: otpPath,
        status: response?.status ?? 0,
        contentType: response?.headers?.get("content-type") ?? "",
        bodySnippet: String(bodyText ?? "").slice(0, 200),
      })
      continue
    }

    if (isHtmlResponse(response.headers.get("content-type"), bodyText)) {
      debugLog?.({
        stage: "otp",
        host,
        path: otpPath,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        bodySnippet: String(bodyText ?? "").slice(0, 200),
      })
      continue
    }

    const otp = String(bodyText ?? "").trim()
    if (!otp) {
      debugLog?.({
        stage: "otp",
        host,
        path: otpPath,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        bodySnippet: String(bodyText ?? "").slice(0, 200),
      })
      continue
    }

    return { ok: true, otp }
  }

  return { ok: false, otp: null }
}

const requestHolidayJson = async ({
  host,
  year,
  otp,
  cookie,
  pageInfo,
  debugLog,
}) => {
  const pagePath = pageInfo?.pagePath ?? HOLIDAY_PAGE_PATHS[0]
  const gridTp = pageInfo?.gridTp ?? "KRX"
  const actionPaths = pageInfo?.actionPath
    ? [pageInfo.actionPath]
    : LEGACY_DATA_PATHS
  const body = buildFormBody({
    code: otp,
    gridTp,
    search_bas_yy: String(year),
    pagePath,
  })

  for (const dataPath of actionPaths) {
    const url = new URL(dataPath, host).toString()
    const { ok, response, bodyText } = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json, text/javascript, */*; q=0.01",
          Origin: host,
          Referer: new URL(pagePath, host).toString(),
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body,
      },
      12_000,
    )

    if (!ok || !response) {
      debugLog?.({
        stage: "data",
        host,
        path: dataPath,
        status: response?.status ?? 0,
        contentType: response?.headers?.get("content-type") ?? "",
        bodySnippet: String(bodyText ?? "").slice(0, 200),
      })
      continue
    }

    if (isHtmlResponse(response.headers.get("content-type"), bodyText)) {
      debugLog?.({
        stage: "data",
        host,
        path: dataPath,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        bodySnippet: String(bodyText ?? "").slice(0, 200),
      })
      continue
    }

    try {
      const payload = JSON.parse(bodyText)
      return { ok: true, payload }
    } catch {
      debugLog?.({
        stage: "data",
        host,
        path: dataPath,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        bodySnippet: String(bodyText ?? "").slice(0, 200),
      })
    }
  }

  return { ok: false, payload: null }
}

const listYears = (fromDateKey, toDateKey) => {
  const from = normalizeDateKey(fromDateKey)
  const to = normalizeDateKey(toDateKey)
  if (!from || !to) {
    return []
  }
  const start = Number(from.slice(0, 4))
  const end = Number(to.slice(0, 4))
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return []
  }
  const years = []
  for (let year = start; year <= end; year += 1) {
    years.push(String(year))
  }
  return years
}

export const parseKrxHolidayPayload = ({ payload, fromDateKey, toDateKey }) => {
  const rows = Array.isArray(payload?.block1) ? payload.block1 : []
  const from = normalizeDateKey(fromDateKey)
  const to = normalizeDateKey(toDateKey)
  const out = []
  for (const row of rows) {
    const raw = row?.calnd_dd_dy ?? row?.CALND_DD_DY
    const dateKey = normalizeDateKey(raw)
    if (!dateKey) {
      continue
    }
    if (from && dateKey < from) {
      continue
    }
    if (to && dateKey > to) {
      continue
    }
    out.push(dateKey)
  }
  return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b))
}

const fetchHolidayYear = async ({
  host,
  year,
  fromDateKey,
  toDateKey,
  debugLog,
}) => {
  const session = await ensureHolidaySession(host, debugLog)
  if (!session.ok || !session.cookie || !session.pageInfo) {
    return { ok: false, dates: [] }
  }

  const otpResult = await requestOtp({
    host,
    year,
    cookie: session.cookie,
    pageInfo: session.pageInfo,
    debugLog,
  })
  if (!otpResult.ok || !otpResult.otp) {
    return { ok: false, dates: [] }
  }

  const dataResult = await requestHolidayJson({
    host,
    year,
    otp: otpResult.otp,
    cookie: session.cookie,
    pageInfo: session.pageInfo,
    debugLog,
  })
  if (!dataResult.ok || !dataResult.payload) {
    return { ok: false, dates: [] }
  }

  const dates = parseKrxHolidayPayload({
    payload: dataResult.payload,
    fromDateKey,
    toDateKey,
  })
  return { ok: dates.length > 0, dates }
}

export const fetchKrxHolidayList = async ({
  fromDateKey,
  toDateKey,
  retries = 3,
  debug = false,
}) => {
  const years = listYears(fromDateKey, toDateKey)
  if (!years.length) {
    return {
      ok: false,
      dates: [],
      source: null,
      host: null,
      detail: "range invalid",
      debugEvents: [],
    }
  }

  const debugEvents = []
  const debugLog = debug ? (event) => debugEvents.push(event) : null

  for (const host of HOSTS) {
    const holidaySet = new Set()
    let failed = false
    for (const year of years) {
      let attempt = 0
      let dates = []
      while (attempt < retries) {
        attempt += 1
        const result = await fetchHolidayYear({
          host,
          year,
          fromDateKey,
          toDateKey,
          debugLog,
        })
        if (result.ok) {
          dates = result.dates
          break
        }
        await sleep(500 * attempt)
      }
      if (!dates.length) {
        failed = true
        break
      }
      dates.forEach((dateKey) => holidaySet.add(dateKey))
    }
    if (!failed && holidaySet.size > 0) {
      const dates = Array.from(holidaySet).sort((a, b) => a.localeCompare(b))
      return {
        ok: true,
        dates,
        source: "KRX_OTP",
        host,
        detail: `host=${host}`,
        debugEvents,
      }
    }
  }

  return {
    ok: false,
    dates: [],
    source: null,
    host: null,
    detail: "KRX holiday fetch failed",
    debugEvents,
  }
}
