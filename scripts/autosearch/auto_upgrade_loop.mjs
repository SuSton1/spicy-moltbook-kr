import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import crypto from "node:crypto"
import os from "node:os"
import { spawn, spawnSync } from "node:child_process"
import dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"

import { getArgValue, hasFlag, parseNumberArg } from "../lib/cliArgs.mjs"
import { assertServerOnly } from "../lib/heavy-run-guard.mjs"
import { assertNoKisRuntime } from "../lib/noKisGuard.mjs"
import {
  resolveLastTradingDateKey,
  resolveTradingCalendarRange,
  resolveTodayKstDateKey,
} from "../lib/tradingCalendar.mjs"
import {
  DEFAULT_RULES_LOCK,
  DEFAULT_TUNING,
  classifyAttemptFailure,
  evaluateAttemptSuccess,
  isInsufficientPoolFailureCode,
  normalizeRulesLock,
  normalizeTuning,
  planAutoActions,
} from "./automationCore.mjs"
import {
  ROOT_CAUSE_CLASS_CATALOG,
  applyAutotuneAllowlist,
  classifyFailureType,
  createStateMachine,
  detectSecretEnvFiles,
  evaluateCircuitBreaker,
  normalizeQuarantineStore,
  redactSensitiveObject,
  resolveActiveQuarantineFingerprints,
  updateQuarantineStoreOnFailure,
  validateRulesSchema,
  validateTuningSchema,
} from "./riskClosure.mjs"

const rootDir = process.cwd()
let runtimeCrashContext = null
let activeCommandChildPid = null
let activeCommandLabel = null
let shutdownSignalReceived = null

const loadLocalEnv = () => {
  const candidates = [".env", ".env.local", "env.local"]
  for (const file of candidates) {
    const fullPath = path.join(rootDir, file)
    if (fs.existsSync(fullPath)) {
      dotenv.config({ path: fullPath })
    }
  }
}

const toNumber = (value, fallback) => parseNumberArg(value) ?? fallback

const toBoolean = (value, fallback = false) => {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  return (
    raw === "1" ||
    raw === "true" ||
    raw === "yes" ||
    raw === "on" ||
    raw === "y"
  )
}

const clampInt = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

const clampNumber = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

const gcd = (a, b) => {
  let x = Math.abs(Math.floor(Number(a) || 0))
  let y = Math.abs(Math.floor(Number(b) || 0))
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

const normalizeCoverageStride = (bucketTotal, requestedStride) => {
  const total = clampInt(bucketTotal, 1, 1, 1024)
  if (total <= 1) return 1
  let stride = clampInt(requestedStride, 1, 1, total)
  stride = ((stride - 1) % total) + 1
  if (gcd(stride, total) !== 1) {
    for (let candidate = 1; candidate <= total; candidate += 1) {
      if (gcd(candidate, total) === 1) {
        stride = candidate
        break
      }
    }
  }
  return stride
}

const createSessionId = () => {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")
  const rand = crypto.randomBytes(3).toString("hex")
  return `auto_${ts}_${rand}`
}

const expectedTuningPath = "scripts/autosearch/config/tuning.mutable.json"

const parseArgs = () => {
  const args = process.argv.slice(2)
  const getValue = (key) => getArgValue(args, key)
  const maxAttemptsRaw = toNumber(getValue("--maxAttempts"), null)
  const autoApplyRaw = getValue("--autoApply")
  const rulesMutableRaw =
    getValue("--rulesMutable") ?? process.env.AUTOSEARCH_RULES_MUTABLE
  const dryRunOnly =
    hasFlag(args, "--dryRunOnly") || toNumber(getValue("--dryRunOnly"), 0) === 1
  return {
    sessionId: String(getValue("--sessionId") ?? "").trim(),
    rulesPath: String(
      getValue("--rulesPath") ?? "scripts/autosearch/config/rules.lock.json",
    ).trim(),
    tuningPath: String(getValue("--tuningPath") ?? expectedTuningPath).trim(),
    maxAttemptsOverride:
      maxAttemptsRaw !== null && Number.isFinite(maxAttemptsRaw)
        ? Math.max(1, Math.min(100_000, Math.floor(maxAttemptsRaw)))
        : null,
    autoApply: dryRunOnly ? false : toBoolean(autoApplyRaw, true),
    rulesMutable: toBoolean(rulesMutableRaw, false),
    dryRunOnly,
  }
}

const ensureParentDir = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

const writeJson = (filePath, payload) => {
  ensureParentDir(filePath)
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const writeJsonIfChanged = (filePath, payload) => {
  const next = `${JSON.stringify(payload, null, 2)}\n`
  let prev = null
  try {
    prev = fs.readFileSync(filePath, "utf8")
  } catch {
    prev = null
  }
  if (prev === next) {
    return
  }
  ensureParentDir(filePath)
  fs.writeFileSync(filePath, next, "utf8")
}

const writeText = (filePath, text) => {
  ensureParentDir(filePath)
  fs.writeFileSync(filePath, text, "utf8")
}

const appendNdjson = (filePath, payload) => {
  ensureParentDir(filePath)
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8")
}

const readJsonSafe = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

const normalizeRecommendationDateKey = (value) => {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw
  }
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  }
  return null
}

const buildEmptyRecommendationReasonCodes = ({
  failureCode,
  failureDetail,
}) => {
  const code = String(failureCode ?? "")
    .trim()
    .toUpperCase()
  const detail = String(failureDetail ?? "")
    .trim()
    .toUpperCase()
  const reasons = new Set()
  if (
    code.includes("DATA") ||
    code.includes("SIGNAL") ||
    code.includes("SYNC") ||
    detail.includes("DATA_MISSING")
  ) {
    reasons.add("DATA_MISSING")
  }
  if (
    code.includes("POOL") ||
    code.includes("TRACK_ZERO_PASS") ||
    code.includes("QUALITY_COLLAPSE") ||
    code.includes("INSUFFICIENT")
  ) {
    reasons.add("POOLSET_NO_MATCH")
  }
  if (detail.includes("TRADABILITY")) {
    reasons.add("ALL_FILTERED_BY_TRADABILITY")
  }
  if (reasons.size === 0) {
    reasons.add("ROUTER_NO_MATCH")
  }
  return Array.from(reasons)
}

const writeEmptyRecommendationOutput = ({
  asOfDateKey,
  mode,
  reasonCodes,
  routerCloseDecisionTimeKST = "15:30",
}) => {
  const normalizedAsOf = normalizeRecommendationDateKey(asOfDateKey)
  const normalizedMode = String(mode ?? "")
    .trim()
    .toUpperCase()
  if (!normalizedAsOf) {
    return null
  }
  if (normalizedMode !== "INTRADAY_1500" && normalizedMode !== "EOD_CLOSE") {
    return null
  }
  const slug =
    normalizedMode === "INTRADAY_1500" ? "intraday_1500" : "eod_close"
  const outputDir = path.join(rootDir, "output", "recommendations")
  fs.mkdirSync(outputDir, { recursive: true })
  const latestPath = path.join(outputDir, `latest_${slug}.json`)
  const datedPath = path.join(
    outputDir,
    `${normalizedAsOf.replace(/-/g, "")}_${slug}.json`,
  )
  const payload = {
    recommendationMode: normalizedMode,
    routerCloseDecisionTimeKST,
    asOfDateKey: normalizedAsOf,
    recommendations: [],
    emptyRecommendationReasons: Array.isArray(reasonCodes)
      ? reasonCodes
      : ["ROUTER_NO_MATCH"],
    generatedAt: isoNow(),
    generatedBy: "auto_upgrade_loop",
  }
  writeJson(latestPath, payload)
  writeJson(datedPath, payload)
  return {
    mode: normalizedMode,
    latestPath,
    datedPath,
  }
}

const ensureEmptyRecommendationOutputs = ({
  asOfDateKey,
  failureCode,
  failureDetail,
  routerCloseDecisionTimeKST = "15:30",
}) => {
  const normalizedAsOf = normalizeRecommendationDateKey(asOfDateKey)
  if (!normalizedAsOf) return null
  const reasonCodes = buildEmptyRecommendationReasonCodes({
    failureCode,
    failureDetail,
  })
  const results = [
    writeEmptyRecommendationOutput({
      asOfDateKey: normalizedAsOf,
      mode: "INTRADAY_1500",
      reasonCodes,
      routerCloseDecisionTimeKST,
    }),
    writeEmptyRecommendationOutput({
      asOfDateKey: normalizedAsOf,
      mode: "EOD_CLOSE",
      reasonCodes,
      routerCloseDecisionTimeKST,
    }),
  ].filter(Boolean)
  return {
    asOfDateKey: normalizedAsOf,
    reasonCodes,
    outputs: results,
  }
}

const SOURCE_FINGERPRINT_FILES = Object.freeze([
  "scripts/autosearch/auto_upgrade_loop.mjs",
  "scripts/autosearch/automationCore.mjs",
  "scripts/autosearch/go_live_sharded.mjs",
  "scripts/autosearch/go_live_autosearch.mjs",
  "scripts/autosearch/config/rules.lock.json",
  "scripts/autosearch/config/tuning.mutable.json",
])

const runCommandCapture = (command, args = []) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  })
  return {
    status: Number(result?.status ?? 1),
    stdout: String(result?.stdout ?? "").trim(),
    stderr: String(result?.stderr ?? "").trim(),
  }
}

const resolveGitIdentity = () => {
  if (!fs.existsSync(path.join(rootDir, ".git"))) {
    return {
      available: false,
      reason: "NO_GIT_DIR",
      head: null,
      shortHead: null,
      clean: null,
      dirtyCount: null,
    }
  }
  const head = runCommandCapture("git", ["rev-parse", "HEAD"])
  if (head.status !== 0 || !head.stdout) {
    return {
      available: false,
      reason: "GIT_HEAD_UNAVAILABLE",
      head: null,
      shortHead: null,
      clean: null,
      dirtyCount: null,
    }
  }
  const shortHead = runCommandCapture("git", [
    "rev-parse",
    "--short=12",
    "HEAD",
  ])
  const statusRaw = spawnSync("git", ["status", "--porcelain"], {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  })
  let dirtyCount = null
  let dirtyFiles = []
  if (Number(statusRaw?.status ?? 1) === 0) {
    const statusStdout = String(statusRaw?.stdout ?? "")
    const rows = statusStdout
      ? statusStdout
          .split(/\n+/)
          .map((line) => line.replace(/\r/g, ""))
          .filter((line) => line.trim().length > 0)
      : []
    dirtyFiles = rows
      .map((row) => {
        const body = (row.length > 3 ? row.slice(3) : row).trim()
        if (!body) return null
        if (body.includes(" -> ")) {
          return body.split(" -> ").pop()?.trim() || null
        }
        return body
      })
      .filter(Boolean)
    dirtyCount = dirtyFiles.length
  }
  return {
    available: true,
    reason: null,
    head: head.stdout,
    shortHead: shortHead.status === 0 ? shortHead.stdout : null,
    clean: dirtyCount === 0,
    dirtyCount,
    dirtyFiles,
  }
}

const resolveSourceIdentity = ({ rulesPath, tuningPath }) => {
  const hasher = crypto.createHash("sha256")
  const filePaths = [
    ...SOURCE_FINGERPRINT_FILES,
    rulesPath ? path.relative(rootDir, rulesPath) : null,
    tuningPath ? path.relative(rootDir, tuningPath) : null,
  ]
  const seen = new Set()
  const files = []
  for (const raw of filePaths) {
    const rel = String(raw ?? "").trim()
    if (!rel || seen.has(rel)) continue
    seen.add(rel)
    const abs = path.isAbsolute(rel) ? rel : path.join(rootDir, rel)
    let exists = false
    let size = 0
    let contentHash = null
    try {
      const buf = fs.readFileSync(abs)
      exists = true
      size = buf.length
      contentHash = crypto.createHash("sha256").update(buf).digest("hex")
      hasher.update(rel)
      hasher.update(":")
      hasher.update(contentHash)
      hasher.update("\n")
    } catch {
      hasher.update(rel)
      hasher.update(":MISSING\n")
    }
    files.push({
      path: rel,
      exists,
      size,
      sha256: contentHash,
    })
  }
  return {
    capturedAt: isoNow(),
    rootDir,
    git: resolveGitIdentity(),
    snapshotHash: hasher.digest("hex"),
    snapshotFileCount: files.length,
    files,
  }
}

const readNdjsonSafe = (filePath, maxRows = 0) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return []
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\n+/)
  const rows = []
  const limit = Math.max(0, Number(maxRows) || 0)
  for (const line of lines) {
    const value = String(line ?? "").trim()
    if (!value) continue
    try {
      rows.push(JSON.parse(value))
    } catch {
      // ignore malformed line
    }
    if (limit > 0 && rows.length >= limit) {
      break
    }
  }
  return rows
}

const readNdjsonTailSafe = (filePath, limit = 10) => {
  const maxRows = Math.max(0, Math.floor(Number(limit) || 0))
  if (maxRows <= 0 || !filePath || !fs.existsSync(filePath)) {
    return []
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\n+/)
  const rows = []
  for (let i = lines.length - 1; i >= 0 && rows.length < maxRows; i -= 1) {
    const value = String(lines[i] ?? "").trim()
    if (!value) continue
    try {
      rows.push(JSON.parse(value))
    } catch {
      // ignore malformed line
    }
  }
  return rows.reverse()
}

const normalizeFailureFingerprintList = (input, limit = 320) => {
  const max = Math.max(0, Math.floor(Number(limit) || 0))
  if (!Array.isArray(input) || max === 0) {
    return []
  }
  const seen = new Set()
  const deduped = []
  for (const item of input) {
    const value = String(item ?? "").trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    deduped.push(value)
  }
  if (deduped.length <= max) {
    return deduped
  }
  return deduped.slice(deduped.length - max)
}

const normalizeQualityCollapseResetCounts = (input, maxEntries = 64) => {
  const source = input && typeof input === "object" ? input : {}
  const limit = Math.max(1, Math.floor(Number(maxEntries) || 64))
  const rows = []
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = String(rawKey ?? "")
      .trim()
      .toUpperCase()
    if (!key) continue
    const count = clampInt(rawValue, 0, 0, 100_000)
    if (count <= 0) continue
    rows.push([key, count])
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]))
  const sliced = rows.slice(Math.max(0, rows.length - limit))
  return Object.fromEntries(sliced)
}

const normalizeResumeState = (raw, fingerprintLimit = 320) => {
  const source = raw && typeof raw === "object" ? raw : {}
  const stamp = String(source.updatedAt ?? "").trim()
  const sessionId = String(source.sessionId ?? "").trim()
  const sameFailureSignature = String(source.sameFailureSignature ?? "").trim()
  const lastFailureCode = String(source.lastFailureCode ?? "").trim()
  const lastFailureClass = String(source.lastFailureClass ?? "").trim()
  const lastFailureDetail = String(source.lastFailureDetail ?? "").trim()
  return {
    version: "autosearch_resume_state_v2",
    updatedAt: stamp || null,
    sessionId: sessionId || null,
    coverageCursor: Math.max(
      0,
      Math.floor(Number(source.coverageCursor ?? 0) || 0),
    ),
    sameFailureSignature: sameFailureSignature || null,
    sameFailureSignatureStreak: clampInt(
      source.sameFailureSignatureStreak,
      0,
      0,
      100_000,
    ),
    failureFingerprints: normalizeFailureFingerprintList(
      source.failureFingerprints,
      fingerprintLimit,
    ),
    qualityCollapseResetCounts: normalizeQualityCollapseResetCounts(
      source.qualityCollapseResetCounts,
    ),
    lastFailureCode: lastFailureCode || null,
    lastFailureClass: lastFailureClass || null,
    lastFailureDetail: lastFailureDetail || null,
  }
}

const isoNow = () => new Date().toISOString()

const isProcessAlive = (pid) => {
  const n = Number(pid)
  if (!Number.isFinite(n) || n <= 1) return false
  try {
    process.kill(Math.floor(n), 0)
    return true
  } catch {
    return false
  }
}

const tryKillPid = (pid, signal = "SIGTERM") => {
  const n = Number(pid)
  if (!Number.isFinite(n) || n <= 1) return false
  try {
    process.kill(Math.floor(n), signal)
    return true
  } catch {
    return false
  }
}

const trackActiveCommandChild = ({ pid, label }) => {
  const n = Number(pid)
  if (!Number.isFinite(n) || n <= 1) {
    activeCommandChildPid = null
    activeCommandLabel = null
    return
  }
  activeCommandChildPid = Math.floor(n)
  activeCommandLabel = String(label ?? "").trim() || null
}

const clearActiveCommandChild = (pid = null) => {
  if (pid !== null && pid !== undefined) {
    const n = Number(pid)
    if (
      Number.isFinite(n) &&
      n > 1 &&
      Number(activeCommandChildPid ?? 0) !== Math.floor(n)
    ) {
      return
    }
  }
  activeCommandChildPid = null
  activeCommandLabel = null
}

const handleTerminationSignal = (signal) => {
  const normalized = String(signal ?? "")
    .trim()
    .toUpperCase()
  if (!normalized) return
  if (shutdownSignalReceived) return
  shutdownSignalReceived = normalized
  const activePid = Number(activeCommandChildPid ?? 0) || null
  const activeLabel = String(activeCommandLabel ?? "").trim() || "UNKNOWN"
  if (activePid && activePid > 1) {
    console.error(
      `[auto-upgrade] signal=${normalized} terminating active command label=${activeLabel} pid=${activePid}`,
    )
    tryKillPid(activePid, "SIGTERM")
    setTimeout(() => {
      if (isProcessAlive(activePid)) {
        tryKillPid(activePid, "SIGKILL")
      }
    }, 5000).unref?.()
  } else {
    console.error(
      `[auto-upgrade] signal=${normalized} terminating without active command`,
    )
  }
  const exitCode = normalized === "SIGINT" ? 130 : 143
  setTimeout(() => {
    process.exit(exitCode)
  }, 1200).unref?.()
}

process.on("SIGINT", () => handleTerminationSignal("SIGINT"))
process.on("SIGTERM", () => handleTerminationSignal("SIGTERM"))

const acquireDataSyncLock = ({
  lockPath,
  sessionId,
  attempt,
  syncDateKey,
  market,
  staleMs = 8 * 60 * 60 * 1000,
}) => {
  const nowIso = isoNow()
  const payload = {
    sessionId: String(sessionId ?? "").trim(),
    attempt: Math.max(1, Math.floor(Number(attempt ?? 1) || 1)),
    syncDateKey: String(syncDateKey ?? "").trim() || null,
    market:
      String(market ?? "")
        .trim()
        .toUpperCase() || "KR",
    pid: process.pid,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
  ensureParentDir(lockPath)
  const readExisting = () => {
    const existing = readJsonSafe(lockPath)
    if (!existing || typeof existing !== "object") {
      return null
    }
    const createdAtMs = parseIsoMs(existing.createdAt)
    const ageMs = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : 0
    const ownerPid = Number(existing.pid)
    const ownerAlive =
      Number.isFinite(ownerPid) && ownerPid > 1
        ? isProcessAlive(ownerPid)
        : false
    const stale = !ownerAlive && ageMs > Math.max(60_000, Number(staleMs) || 0)
    return {
      raw: existing,
      ownerPid: Number.isFinite(ownerPid) ? Math.floor(ownerPid) : null,
      ownerAlive,
      stale,
      ageMs,
    }
  }
  for (let i = 0; i < 2; i += 1) {
    try {
      fs.writeFileSync(lockPath, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      })
      return { acquired: true, payload, reason: "LOCK_ACQUIRED", lockPath }
    } catch (error) {
      if (error?.code !== "EEXIST") {
        return {
          acquired: false,
          reason: "LOCK_ERROR",
          lockPath,
          error: String(error?.message ?? "LOCK_WRITE_FAILED"),
        }
      }
      const existing = readExisting()
      if (existing?.stale) {
        try {
          fs.unlinkSync(lockPath)
          continue
        } catch {
          // keep evaluating lock holder below
        }
      }
      return {
        acquired: false,
        reason: "LOCK_HELD",
        lockPath,
        existing: existing?.raw ?? null,
        ownerAlive: existing?.ownerAlive ?? false,
        ageMs: existing?.ageMs ?? null,
      }
    }
  }
  return { acquired: false, reason: "LOCK_CONFLICT_RETRY_EXHAUSTED", lockPath }
}

const releaseDataSyncLock = ({ lockPath, sessionId }) => {
  if (!lockPath || !fs.existsSync(lockPath)) {
    return { released: false, reason: "LOCK_NOT_FOUND" }
  }
  const existing = readJsonSafe(lockPath)
  const ownerSessionId = String(existing?.sessionId ?? "").trim()
  if (ownerSessionId && ownerSessionId !== String(sessionId ?? "").trim()) {
    return { released: false, reason: "LOCK_OWNED_BY_OTHER", ownerSessionId }
  }
  try {
    fs.unlinkSync(lockPath)
    return { released: true, reason: "LOCK_RELEASED" }
  } catch (error) {
    return {
      released: false,
      reason: "LOCK_RELEASE_FAILED",
      error: String(error?.message ?? "unknown"),
    }
  }
}

const acquireLoopRunLock = async ({
  lockPath,
  sessionId,
  staleMs = 6 * 60 * 60 * 1000,
  deadOwnerGraceMs = 2 * 60 * 1000,
  retries = 0,
  retryDelayMs = 5000,
}) => {
  const payload = {
    sessionId: String(sessionId ?? "").trim(),
    pid: process.pid,
    createdAt: isoNow(),
    updatedAt: isoNow(),
  }
  ensureParentDir(lockPath)
  const maxRetries = Math.max(0, Math.floor(Number(retries) || 0))
  const delayMs = Math.max(1000, Math.floor(Number(retryDelayMs) || 5000))
  for (let i = 0; i <= maxRetries; i += 1) {
    try {
      fs.writeFileSync(lockPath, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      })
      return { acquired: true, reason: "LOCK_ACQUIRED", lockPath, payload }
    } catch (error) {
      if (error?.code !== "EEXIST") {
        return {
          acquired: false,
          reason: "LOCK_WRITE_FAILED",
          lockPath,
          error: String(error?.message ?? "unknown"),
        }
      }
      const existing = readJsonSafe(lockPath)
      const ownerPid = Number(existing?.pid)
      const ownerAlive =
        Number.isFinite(ownerPid) && ownerPid > 1
          ? isProcessAlive(ownerPid)
          : false
      const createdMs = parseIsoMs(existing?.createdAt)
      const ageMs = Number.isFinite(createdMs) ? Date.now() - createdMs : 0
      const staleThresholdMs = Math.max(60_000, Number(staleMs) || 0)
      const deadOwnerThresholdMs = Math.max(
        15_000,
        Math.min(
          staleThresholdMs,
          Math.floor(Number(deadOwnerGraceMs) || 2 * 60 * 1000),
        ),
      )
      if (!ownerAlive && ageMs >= deadOwnerThresholdMs) {
        try {
          fs.unlinkSync(lockPath)
          // Preserve retry budget when reclaiming a dead-owner lock.
          i -= 1
          continue
        } catch {
          // keep lock-holder state
        }
      }
      if (i < maxRetries) {
        await sleep(delayMs)
        continue
      }
      return {
        acquired: false,
        reason: "LOCK_HELD",
        lockPath,
        ownerPid: Number.isFinite(ownerPid) ? Math.floor(ownerPid) : null,
        ownerAlive,
        ownerSessionId: String(existing?.sessionId ?? "").trim() || null,
        ageMs,
      }
    }
  }
  return { acquired: false, reason: "LOCK_CONFLICT_RETRY_EXHAUSTED", lockPath }
}

const releaseLoopRunLock = ({ lockPath, sessionId }) => {
  if (!lockPath || !fs.existsSync(lockPath)) {
    return { released: false, reason: "LOCK_NOT_FOUND" }
  }
  const existing = readJsonSafe(lockPath)
  const ownerSessionId = String(existing?.sessionId ?? "").trim()
  if (ownerSessionId && ownerSessionId !== String(sessionId ?? "").trim()) {
    return { released: false, reason: "LOCK_OWNED_BY_OTHER", ownerSessionId }
  }
  try {
    fs.unlinkSync(lockPath)
    return { released: true, reason: "LOCK_RELEASED" }
  } catch (error) {
    return {
      released: false,
      reason: "LOCK_RELEASE_FAILED",
      error: String(error?.message ?? "unknown"),
    }
  }
}

const extractHeartbeatSidecarMeta = (line) => {
  const body = String(line ?? "").trim()
  if (!body) return null
  const match = body.match(
    /^(\d+)\s+.*?(\/\S+\/autosearch_automation\/auto_[^/\s]+\/heartbeat\.json)\s+(\{.*?\})\s+\d+\s+\/\S+\/session_progress\.json/,
  )
  if (!match) return null
  const sidecarPid = Number(match[1])
  const heartbeatPath = match[2]
  let payload = null
  try {
    payload = JSON.parse(match[3])
  } catch {
    payload = null
  }
  if (!Number.isFinite(sidecarPid) || sidecarPid <= 1 || !payload) {
    return null
  }
  return {
    sidecarPid: Math.floor(sidecarPid),
    heartbeatPath,
    payload,
  }
}

const cleanupOrphanHeartbeatSidecars = ({ automationRootDir }) => {
  const result = {
    scanned: 0,
    terminated: [],
  }
  if (!automationRootDir || !fs.existsSync(automationRootDir)) {
    return result
  }
  const probe = spawnSync(
    "pgrep",
    ["-af", "autosearch_automation/.*/heartbeat.json"],
    {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    },
  )
  if (Number(probe?.status) !== 0) {
    return result
  }
  const lines = String(probe.stdout ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (const line of lines) {
    const meta = extractHeartbeatSidecarMeta(line)
    if (!meta) continue
    result.scanned += 1
    const sessionId = String(meta.payload?.sessionId ?? "").trim()
    const trackedPid = Number(meta.payload?.pid)
    const sessionDir =
      String(meta.payload?.sessionDir ?? "").trim() ||
      path.dirname(meta.heartbeatPath)
    const finalPath = path.join(sessionDir, "final_result.json")
    const trackedAlive =
      Number.isFinite(trackedPid) && trackedPid > 1
        ? isProcessAlive(trackedPid)
        : false
    const sessionFinalized = fs.existsSync(finalPath)
    if (trackedAlive && !sessionFinalized) {
      continue
    }
    const terminated = tryKillPid(meta.sidecarPid, "SIGTERM")
    if (terminated) {
      result.terminated.push({
        sidecarPid: meta.sidecarPid,
        sessionId: sessionId || null,
        trackedPid: Number.isFinite(trackedPid) ? Math.floor(trackedPid) : null,
        reason: sessionFinalized
          ? "SESSION_FINALIZED"
          : "TRACKED_PID_NOT_ALIVE",
      })
    }
  }
  return result
}

const buildSessionSummaryMarkdown = ({
  sessionManifest,
  progress,
  finalResult,
  recentMilestones,
  recentRisks,
}) => {
  const lines = []
  lines.push("# Auto Upgrade Session Summary")
  lines.push("")
  lines.push(`- sessionId: ${sessionManifest?.sessionId ?? "unknown"}`)
  lines.push(`- startedAt: ${sessionManifest?.startedAt ?? "unknown"}`)
  lines.push(`- endedAt: ${finalResult?.endedAt ?? "in_progress"}`)
  lines.push(`- status: ${progress?.status ?? "unknown"}`)
  lines.push(`- currentAttempt: ${progress?.currentAttempt ?? 0}`)
  lines.push(`- lastStage: ${progress?.lastStage ?? "unknown"}`)
  lines.push(`- lastFailureCode: ${progress?.lastFailureCode ?? "none"}`)
  lines.push(`- lastPassedStage: ${progress?.lastPassedStage ?? "none"}`)
  lines.push(`- milestonesCount: ${progress?.milestonesCount ?? 0}`)
  lines.push(`- riskEventsCount: ${progress?.riskEventsCount ?? 0}`)
  lines.push("")
  lines.push("## Recent Milestones")
  if ((recentMilestones ?? []).length === 0) {
    lines.push("- (none)")
  } else {
    for (const row of recentMilestones ?? []) {
      lines.push(
        `- ${row?.ts ?? "unknown"} | ${row?.status ?? "UNKNOWN"} | ${row?.name ?? "UNKNOWN"} | attempt=${row?.attempt ?? "?"} stage=${row?.stage ?? "?"}`,
      )
    }
  }
  lines.push("")
  lines.push("## Recent Risks")
  if ((recentRisks ?? []).length === 0) {
    lines.push("- (none)")
  } else {
    for (const row of recentRisks ?? []) {
      lines.push(
        `- ${row?.ts ?? "unknown"} | ${row?.severity ?? "WARN"} | ${row?.code ?? "UNKNOWN"} | attempt=${row?.attempt ?? "?"} stage=${row?.stage ?? "?"} | ${row?.summary ?? ""}`,
      )
    }
  }
  lines.push("")
  lines.push("## Final Result")
  lines.push(
    "```json\n" +
      JSON.stringify(
        finalResult?.result ?? { status: "IN_PROGRESS" },
        null,
        2,
      ) +
      "\n```",
  )
  lines.push("")
  return `${lines.join("\n")}\n`
}

const canonicalizeJson = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item))
  }
  if (!value || typeof value !== "object") {
    return value
  }
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
  return Object.fromEntries(
    entries.map(([key, item]) => [key, canonicalizeJson(item)]),
  )
}

const stableStringify = (value) => JSON.stringify(canonicalizeJson(value))

const enforceSpeedProfileCaps = ({ previousTuning, candidateTuning }) => {
  const prev = normalizeTuning(previousTuning)
  const next = normalizeTuning(candidateTuning)
  if (String(next.executionLane ?? "server") === "codex_cloud") {
    return next
  }
  if (next.speedProfileExpansionGuard !== true) {
    return next
  }
  const densityImproved =
    (Number(next.previousPassDensity ?? 0) || 0) >
    (Number(prev.previousPassDensity ?? 0) || 0)
  const terminalStable =
    (Number(next.previousTerminalRatio ?? 1) || 1) <=
    Math.min(
      Number(next.poolExpandMaxTerminalRatio ?? 0.8) || 0.8,
      (Number(prev.previousTerminalRatio ?? 1) || 1) + 0.05,
    )
  const allowExpand = densityImproved && terminalStable
  const tracks = ["SURGE_EOD", "GAP_15_BET", "MOONSHOT"]
  const clamped = {
    ...next,
    stage2TopKByTrack: { ...next.stage2TopKByTrack },
    dailyPassTopNByTrack: { ...next.dailyPassTopNByTrack },
    dailyPassPoolsetCountByTrack: { ...next.dailyPassPoolsetCountByTrack },
    poolsetCountByTrack: { ...next.poolsetCountByTrack },
  }
  for (const track of tracks) {
    const cap = Math.max(
      1,
      Number(next.speedProfileMaxStage2TopK?.[track] ?? 1) || 1,
    )
    clamped.stage2TopKByTrack[track] = Math.min(
      Number(clamped.stage2TopKByTrack?.[track] ?? cap) || cap,
      cap,
    )
    if (!allowExpand) {
      clamped.dailyPassTopNByTrack[track] = Math.min(
        Number(clamped.dailyPassTopNByTrack?.[track] ?? 1) || 1,
        Number(prev.dailyPassTopNByTrack?.[track] ?? 1) || 1,
      )
      clamped.dailyPassPoolsetCountByTrack[track] = Math.min(
        Number(clamped.dailyPassPoolsetCountByTrack?.[track] ?? 1) || 1,
        Number(prev.dailyPassPoolsetCountByTrack?.[track] ?? 1) || 1,
      )
      clamped.poolsetCountByTrack[track] = Math.min(
        Number(clamped.poolsetCountByTrack?.[track] ?? 1) || 1,
        Number(prev.poolsetCountByTrack?.[track] ?? 1) || 1,
      )
    }
  }
  return normalizeTuning(clamped)
}

const applyRuleLockToPlan = ({ rules, plan, rulesLocked }) => {
  const proposedRules = normalizeRulesLock(plan?.nextRules ?? rules)
  const sameRules = stableStringify(proposedRules) === stableStringify(rules)
  const baseActions = Array.isArray(plan?.actions) ? plan.actions : []
  if (!rulesLocked) {
    return {
      nextRules: proposedRules,
      actionItems: baseActions,
      rulesDriftBlocked: false,
      proposedRules: null,
    }
  }
  const actionItems = baseActions.filter(
    (action) => String(action?.type ?? "") !== "ADJUST_RULES_SAFE",
  )
  if (!sameRules) {
    actionItems.push({
      type: "RULE_LOCK_ENFORCED",
      reason: "RULES_LOCKED",
      summary: "Immutable rule lock blocked automatic rule changes.",
    })
  }
  return {
    nextRules: rules,
    actionItems,
    rulesDriftBlocked: !sameRules,
    proposedRules: sameRules ? null : proposedRules,
  }
}

const applyDeterministicTuningPolicy = ({ previousTuning, plannedTuning }) => {
  const prev = normalizeTuning(previousTuning)
  const candidate = enforceSpeedProfileCaps({
    previousTuning: prev,
    candidateTuning: plannedTuning,
  })
  if (prev.autotuneDeterministic === false) {
    return {
      nextTuning: candidate,
      policy: {
        deterministic: false,
        appliedKeys: [],
        blockedKeys: [],
        truncatedKeys: [],
      },
    }
  }
  const policy = applyAutotuneAllowlist({
    previousTuning: prev,
    candidateTuning: candidate,
    allowlist: prev.autotuneAllowlist,
    maxAdjustmentsPerRun: prev.autotuneMaxAdjustmentsPerRun,
  })
  return {
    nextTuning: normalizeTuning(policy.nextTuning),
    policy: {
      deterministic: true,
      appliedKeys: policy.appliedKeys,
      blockedKeys: policy.blockedKeys,
      truncatedKeys: policy.truncatedKeys,
    },
  }
}

const buildCandidateFingerprint = (row) => {
  const track = String(row?.track ?? "")
    .trim()
    .toUpperCase()
  if (!track || !row?.policyChoice || !row?.patternChoice) {
    return null
  }
  const digest = crypto
    .createHash("sha1")
    .update(
      stableStringify({
        track,
        policyChoice: row.policyChoice,
        patternChoice: row.patternChoice,
      }),
    )
    .digest("hex")
  return `fp_${digest.slice(0, 16)}`
}

const mergeRecentFingerprints = ({ current, incoming, limit }) => {
  const keep = Math.max(0, Math.floor(Number(limit) || 0))
  if (keep <= 0) return []
  const merged = []
  const seen = new Set()
  for (const value of [...(current ?? []), ...(incoming ?? [])]) {
    const item = String(value ?? "").trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    merged.push(item)
  }
  if (merged.length <= keep) {
    return merged
  }
  return merged.slice(merged.length - keep)
}

const collectFingerprintsFromPoolSummary = ({ summary, limit }) => {
  const maxItems = Math.max(0, Math.floor(Number(limit) || 0))
  if (maxItems <= 0) {
    return { poolPath: null, fingerprints: [] }
  }
  const poolPath = String(summary?.poolPath ?? "").trim()
  if (!poolPath) {
    return { poolPath: null, fingerprints: [] }
  }
  const rows = readNdjsonSafe(poolPath, maxItems * 4)
  const fingerprints = []
  const seen = new Set()
  for (const row of rows) {
    const fingerprint =
      String(row?.fingerprint ?? "").trim() || buildCandidateFingerprint(row)
    if (!fingerprint || seen.has(fingerprint)) {
      continue
    }
    seen.add(fingerprint)
    fingerprints.push(fingerprint)
    if (fingerprints.length >= maxItems) {
      break
    }
  }
  return { poolPath, fingerprints }
}

const collectFallbackFingerprintsFromSummary = ({ summary, limit }) => {
  const maxItems = Math.max(0, Math.floor(Number(limit) || 0))
  if (maxItems <= 0 || !summary || typeof summary !== "object") {
    return { source: null, fingerprints: [] }
  }
  const rescueTracks = ["SURGE_EOD", "GAP_15_BET", "MOONSHOT"]
  const fingerprints = []
  const seen = new Set()
  for (const track of rescueTracks) {
    const rows = Array.isArray(summary?.rescueDistByTrack?.[track]?.rows)
      ? summary.rescueDistByTrack[track].rows
      : []
    for (const row of rows) {
      const fingerprint = String(row?.fingerprint ?? "").trim()
      if (!fingerprint || seen.has(fingerprint)) continue
      seen.add(fingerprint)
      fingerprints.push(fingerprint)
      if (fingerprints.length >= maxItems) {
        return { source: `rescueRows:${track}`, fingerprints }
      }
    }
  }
  return {
    source: fingerprints.length > 0 ? "rescueRows" : null,
    fingerprints,
  }
}

const summarizeNumericValues = (values) => {
  const nums = (values ?? []).filter((value) => Number.isFinite(Number(value)))
  if (!nums.length) {
    return {
      count: 0,
      min: null,
      max: null,
      avg: null,
    }
  }
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  for (const value of nums) {
    const n = Number(value)
    if (n < min) min = n
    if (n > max) max = n
    sum += n
  }
  return {
    count: nums.length,
    min,
    max,
    avg: sum / nums.length,
  }
}

const normalizeDateKeyLoose = (value) => {
  const digits = String(value ?? "").replace(/[^0-9]/g, "")
  if (digits.length !== 8) {
    return null
  }
  const yyyy = digits.slice(0, 4)
  const mm = digits.slice(4, 6)
  const dd = digits.slice(6, 8)
  return `${yyyy}-${mm}-${dd}`
}

const summarizeDateKeyValues = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
    }
  }
  let count = 0
  let min = null
  let max = null
  for (const value of values) {
    const normalized = normalizeDateKeyLoose(value)
    if (!normalized) continue
    count += 1
    if (!min || normalized < min) {
      min = normalized
    }
    if (!max || normalized > max) {
      max = normalized
    }
  }
  return {
    count,
    min,
    max,
  }
}

const diffDateKeyDays = (a, b) => {
  const left = normalizeDateKeyLoose(a)
  const right = normalizeDateKeyLoose(b)
  if (!left || !right) return null
  const [ly, lm, ld] = left.split("-").map((token) => Number(token))
  const [ry, rm, rd] = right.split("-").map((token) => Number(token))
  if (
    !Number.isFinite(ly) ||
    !Number.isFinite(lm) ||
    !Number.isFinite(ld) ||
    !Number.isFinite(ry) ||
    !Number.isFinite(rm) ||
    !Number.isFinite(rd)
  ) {
    return null
  }
  const leftMs = Date.UTC(ly, lm - 1, ld)
  const rightMs = Date.UTC(ry, rm - 1, rd)
  const diffMs = Math.abs(rightMs - leftMs)
  return Number.isFinite(diffMs)
    ? Math.floor(diffMs / (24 * 60 * 60 * 1000))
    : null
}

const sortCountMap = (map, limit = 20) =>
  Array.from(map.entries())
    .map(([key, count]) => ({
      key: String(key ?? "").trim(),
      count: Number(count ?? 0) || 0,
    }))
    .filter((row) => row.key && row.count > 0)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, Math.max(1, Math.floor(Number(limit) || 20)))

const parseMoonshotLogDiagnostics = (logPath) => {
  const filePath = String(logPath ?? "").trim()
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      lines: 0,
      failLines: 0,
      lastReason: null,
      bucketsFailedObservedMax: null,
      bucketsEvaluatedObservedMax: null,
    }
  }
  let text = ""
  try {
    text = fs.readFileSync(filePath, "utf8")
  } catch {
    return {
      lines: 0,
      failLines: 0,
      lastReason: null,
      bucketsFailedObservedMax: null,
      bucketsEvaluatedObservedMax: null,
    }
  }
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("[moonshot-4w]"))
  let failLines = 0
  let lastReason = null
  let bucketsFailedObservedMax = null
  let bucketsEvaluatedObservedMax = null
  for (const line of lines) {
    if (!line.includes("pass=FAIL")) continue
    failLines += 1
    const reasonMatch = line.match(/reason=([A-Z0-9_:-]+)/i)
    if (reasonMatch?.[1]) {
      lastReason = String(reasonMatch[1]).trim().toUpperCase()
    }
    const bucketMatch = line.match(/bucketsFailed=(\d+)\/(\d+)/i)
    if (bucketMatch) {
      const failed = Number(bucketMatch[1])
      const evaluated = Number(bucketMatch[2])
      if (Number.isFinite(failed)) {
        bucketsFailedObservedMax =
          bucketsFailedObservedMax === null
            ? failed
            : Math.max(bucketsFailedObservedMax, failed)
      }
      if (Number.isFinite(evaluated)) {
        bucketsEvaluatedObservedMax =
          bucketsEvaluatedObservedMax === null
            ? evaluated
            : Math.max(bucketsEvaluatedObservedMax, evaluated)
      }
    }
  }
  return {
    lines: lines.length,
    failLines,
    lastReason,
    bucketsFailedObservedMax,
    bucketsEvaluatedObservedMax,
  }
}

const buildMoonshotDiagnosticsFromSummary = ({
  summary,
  logPath,
  maxRows = 40,
}) => {
  if (!summary || typeof summary !== "object") {
    return null
  }
  const rescueRows = Array.isArray(summary?.rescueDistByTrack?.SURGE_EOD?.rows)
    ? summary.rescueDistByTrack.SURGE_EOD.rows
    : []
  const rowCap = Math.max(1, Math.floor(Number(maxRows) || 40))
  const valSummaryPaths = []
  const seenPaths = new Set()
  for (const row of rescueRows) {
    const valPath = String(row?.valSummaryPath ?? "").trim()
    if (!valPath || seenPaths.has(valPath)) continue
    seenPaths.add(valPath)
    valSummaryPaths.push(valPath)
    if (valSummaryPaths.length >= rowCap) break
  }
  const reasonCounts = new Map()
  const failCauseCounts = new Map()
  const bucketFailureSignatures = new Map()
  const partialBucketReasonCounts = new Map()
  const signalsLoadedSeries = []
  const signalsQualifiedSeries = []
  const outcomesSeries = []
  const bucketsEvaluatedSeries = []
  const bucketsFailedSeries = []
  const evaluatedBucketStartDateKeys = []
  const evaluatedBucketEndDateKeys = []
  let observed = 0
  let failed = 0
  for (const valPath of valSummaryPaths) {
    const payload = readJsonSafe(valPath)
    const gate = payload?.moonshotGate
    if (!gate || typeof gate !== "object") continue
    observed += 1
    const pass = gate.pass === true
    const reason = String(gate.reason ?? "UNKNOWN")
      .trim()
      .toUpperCase()
    reasonCounts.set(reason || "UNKNOWN", (reasonCounts.get(reason) ?? 0) + 1)
    const signalsLoaded = Number(gate.signalsLoaded ?? 0) || 0
    const signalsQualified = Number(gate.signalsQualified ?? 0) || 0
    const outcomesCount = Number(gate.outcomesCount ?? 0) || 0
    signalsLoadedSeries.push(signalsLoaded)
    signalsQualifiedSeries.push(signalsQualified)
    outcomesSeries.push(outcomesCount)
    const bucketsEvaluated = Number(gate?.stats?.bucketsEvaluated ?? 0) || 0
    const bucketsFailed = Number(gate?.stats?.bucketsFailed ?? 0) || 0
    bucketsEvaluatedSeries.push(bucketsEvaluated)
    bucketsFailedSeries.push(bucketsFailed)
    const buckets = Array.isArray(gate?.stats?.buckets)
      ? gate.stats.buckets
      : []
    for (const bucket of buckets) {
      if (bucket?.evaluated !== true) continue
      const start = String(bucket?.bucketStartDateKey ?? "").trim()
      const end = String(bucket?.bucketEndDateKey ?? "").trim()
      if (start) {
        evaluatedBucketStartDateKeys.push(start)
      }
      if (end) {
        evaluatedBucketEndDateKeys.push(end)
      }
    }
    if (!pass) {
      failed += 1
      if (signalsLoaded > 0 && outcomesCount <= 0) {
        failCauseCounts.set(
          "OUTCOMES_EMPTY_WITH_SIGNALS",
          (failCauseCounts.get("OUTCOMES_EMPTY_WITH_SIGNALS") ?? 0) + 1,
        )
      } else if (signalsLoaded <= 0 && outcomesCount <= 0) {
        failCauseCounts.set(
          "NO_SIGNALS_OR_OUTCOMES",
          (failCauseCounts.get("NO_SIGNALS_OR_OUTCOMES") ?? 0) + 1,
        )
      }
      if (bucketsEvaluated <= 0) {
        failCauseCounts.set(
          "NO_EVALUATED_BUCKETS",
          (failCauseCounts.get("NO_EVALUATED_BUCKETS") ?? 0) + 1,
        )
      } else if (bucketsFailed > 0) {
        failCauseCounts.set(
          "EVALUATED_BUCKETS_FAILED",
          (failCauseCounts.get("EVALUATED_BUCKETS_FAILED") ?? 0) + 1,
        )
      }
      for (const bucket of buckets) {
        if (bucket?.evaluated !== true || bucket?.pass === true) continue
        const start = String(bucket?.bucketStartDateKey ?? "").trim()
        const end = String(bucket?.bucketEndDateKey ?? "").trim()
        const tradingDays = Number(bucket?.tradingDaysCount ?? 0) || 0
        const successCount = Number(bucket?.successCount ?? 0) || 0
        const key = `${start}~${end}|td=${tradingDays}|success=${successCount}`
        bucketFailureSignatures.set(
          key,
          (bucketFailureSignatures.get(key) ?? 0) + 1,
        )
      }
      const partialBuckets = Array.isArray(gate?.stats?.partialBuckets)
        ? gate.stats.partialBuckets
        : []
      for (const bucket of partialBuckets) {
        const partialReason = String(bucket?.reason ?? "UNKNOWN")
          .trim()
          .toUpperCase()
        partialBucketReasonCounts.set(
          partialReason || "UNKNOWN",
          (partialBucketReasonCounts.get(partialReason) ?? 0) + 1,
        )
      }
    }
  }
  const log = parseMoonshotLogDiagnostics(logPath)
  const topReason =
    sortCountMap(reasonCounts, 1)[0]?.key ?? log.lastReason ?? null
  return {
    rescueRowsInspected: rescueRows.length,
    sampledValidationSummaries: valSummaryPaths.length,
    moonshotGateObserved: observed,
    moonshotGateFailed: failed,
    topReason,
    reasonCounts: sortCountMap(reasonCounts, 12),
    failCauseCounts: sortCountMap(failCauseCounts, 12),
    signalsLoaded: summarizeNumericValues(signalsLoadedSeries),
    signalsQualified: summarizeNumericValues(signalsQualifiedSeries),
    outcomesCount: summarizeNumericValues(outcomesSeries),
    bucketsEvaluated: summarizeNumericValues(bucketsEvaluatedSeries),
    bucketsFailed: summarizeNumericValues(bucketsFailedSeries),
    evaluatedBucketStartDateKey: summarizeDateKeyValues(
      evaluatedBucketStartDateKeys,
    ),
    evaluatedBucketEndDateKey: summarizeDateKeyValues(
      evaluatedBucketEndDateKeys,
    ),
    bucketFailureSignatures: sortCountMap(bucketFailureSignatures, 20),
    partialBucketReasonCounts: sortCountMap(partialBucketReasonCounts, 12),
    log,
  }
}

const getCountFromPairs = (rows, key) => {
  const target = String(key ?? "")
    .trim()
    .toUpperCase()
  if (!target || !Array.isArray(rows)) {
    return 0
  }
  for (const row of rows) {
    const rowKey = String(row?.key ?? "")
      .trim()
      .toUpperCase()
    if (rowKey !== target) continue
    const count = Number(row?.count ?? 0) || 0
    return Math.max(0, count)
  }
  return 0
}

const evaluateMoonshotOutcomeGuard = ({ diagnostics, tuning }) => {
  const enabled = tuning?.moonshotOutcomeEmptyFailEnabled !== false
  if (!enabled) {
    return {
      enabled: false,
      pass: true,
      reason: null,
      metrics: { disabled: true },
    }
  }
  const observed = Number(diagnostics?.moonshotGateObserved ?? 0) || 0
  const failCount = getCountFromPairs(
    diagnostics?.failCauseCounts,
    "OUTCOMES_EMPTY_WITH_SIGNALS",
  )
  const signalsLoadedMin = Number(diagnostics?.signalsLoaded?.min ?? 0) || 0
  const outcomesMax = Number(diagnostics?.outcomesCount?.max ?? 0) || 0
  const minSamples = Math.max(
    1,
    Math.floor(Number(tuning?.moonshotOutcomeEmptyMinSamples ?? 4) || 4),
  )
  const pass = !(
    observed >= minSamples &&
    failCount > 0 &&
    signalsLoadedMin > 0 &&
    outcomesMax <= 0
  )
  return {
    enabled: true,
    pass,
    reason: pass ? null : "MOONSHOT_OUTCOME_EMPTY_WITH_SIGNALS",
    metrics: {
      observed,
      failCount,
      minSamples,
      signalsLoadedMin,
      outcomesMax,
    },
  }
}

const evaluateMoonshotSignalConsistencyGuard = ({
  diagnostics,
  preflightStage,
  tuning,
}) => {
  const enabled = tuning?.moonshotOutcomeEmptyFailEnabled !== false
  if (!enabled) {
    return {
      enabled: false,
      pass: true,
      reason: null,
      metrics: { disabled: true },
    }
  }
  const preflightPass =
    String(preflightStage?.status ?? "").toUpperCase() === "PASS"
  const preflightSignalsLoaded =
    Number(preflightStage?.details?.signalsLoaded ?? 0) || 0
  const preflightSignalsQualified =
    Number(preflightStage?.details?.signalsQualified ?? 0) || 0
  const observed = Number(diagnostics?.moonshotGateObserved ?? 0) || 0
  const evalSignalsLoadedMax = Number(diagnostics?.signalsLoaded?.max ?? 0) || 0
  const evalSignalsLoadedMin = Number(diagnostics?.signalsLoaded?.min ?? 0) || 0
  const evalOutcomesMax = Number(diagnostics?.outcomesCount?.max ?? 0) || 0
  const preflightWindowEndDateKey = normalizeDateKeyLoose(
    preflightStage?.details?.windowEndDateKey,
  )
  const evalWindowEndDateKey = normalizeDateKeyLoose(
    diagnostics?.evaluatedBucketEndDateKey?.max,
  )
  const windowGapDays = diffDateKeyDays(
    preflightWindowEndDateKey,
    evalWindowEndDateKey,
  )
  const maxGapDays = Math.max(
    0,
    Math.floor(Number(tuning?.moonshotSignalMismatchMaxGapDays ?? 60) || 60),
  )
  const windowComparable =
    windowGapDays !== null &&
    Number.isFinite(Number(windowGapDays)) &&
    Number(windowGapDays) <= maxGapDays
  const minObserved = Math.max(
    2,
    Math.floor(Number(tuning?.moonshotOutcomeEmptyMinSamples ?? 4) || 4),
  )
  const pass = !(
    preflightPass &&
    preflightSignalsLoaded > 0 &&
    observed >= minObserved &&
    windowComparable &&
    evalSignalsLoadedMax <= 0 &&
    evalOutcomesMax <= 0
  )
  return {
    enabled: true,
    pass,
    reason: pass ? null : "MOONSHOT_SIGNAL_MISMATCH_PREFLIGHT_GT0_EVAL_0",
    metrics: {
      preflightPass,
      preflightSignalsLoaded,
      preflightSignalsQualified,
      observed,
      minObserved,
      maxGapDays,
      preflightWindowEndDateKey,
      evalWindowEndDateKey,
      windowGapDays,
      windowComparable,
      evalSignalsLoadedMin,
      evalSignalsLoadedMax,
      evalOutcomesMax,
    },
  }
}

const resolveEvalWindowSignalPreflightConfig = ({ diagnostics, tuning }) => {
  const evalWindowStartDateKey = normalizeDateKeyLoose(
    diagnostics?.evaluatedBucketStartDateKey?.min,
  )
  const evalWindowEndDateKey = normalizeDateKeyLoose(
    diagnostics?.evaluatedBucketEndDateKey?.max,
  )
  if (!evalWindowEndDateKey) {
    return null
  }
  const spanDays = diffDateKeyDays(evalWindowStartDateKey, evalWindowEndDateKey)
  const paddingDays = Math.max(
    0,
    Math.floor(Number(tuning?.signalGapRepairPaddingDays ?? 7) || 7),
  )
  const defaultWindowTradingDays = Math.max(
    1,
    Math.floor(Number(tuning?.preflightSignalWindowTradingDays ?? 28) || 28),
  )
  const windowTradingDays = Number.isFinite(Number(spanDays))
    ? Math.max(
        1,
        Math.min(252, Math.floor(Number(spanDays) || 0) + paddingDays + 1),
      )
    : defaultWindowTradingDays
  return {
    asOfDateKey: evalWindowEndDateKey,
    windowTradingDays,
    evalWindowStartDateKey: evalWindowStartDateKey || null,
    evalWindowEndDateKey,
  }
}

const evaluateEvalWindowSignalGapGuard = ({
  diagnostics,
  preflightStage,
  baselinePreflightStage,
  rules,
  tuning,
  probeConfig,
}) => {
  if (!probeConfig) {
    return {
      enabled: false,
      pass: true,
      reason: null,
      metrics: { disabled: true },
    }
  }
  const observed = Number(diagnostics?.moonshotGateObserved ?? 0) || 0
  const evalSignalsLoadedMax = Number(diagnostics?.signalsLoaded?.max ?? 0) || 0
  const evalOutcomesMax = Number(diagnostics?.outcomesCount?.max ?? 0) || 0
  const probeSignalsLoaded =
    Number(preflightStage?.details?.signalsLoaded ?? 0) || 0
  const probeStatus = String(preflightStage?.status ?? "UNKNOWN")
    .trim()
    .toUpperCase()
  const noSignalsOrOutcomesCount = getCountFromPairs(
    diagnostics?.failCauseCounts,
    "NO_SIGNALS_OR_OUTCOMES",
  )
  const minObserved = Math.max(
    2,
    Math.floor(Number(tuning?.moonshotOutcomeEmptyMinSamples ?? 4) || 4),
  )
  const baselineWindowEndDateKey = normalizeDateKeyLoose(
    baselinePreflightStage?.details?.windowEndDateKey,
  )
  const rulesAsOfDateKey = normalizeDateKeyLoose(rules?.asOfInput)
  const evalWindowEndDateKey = normalizeDateKeyLoose(
    probeConfig?.evalWindowEndDateKey,
  )
  const baselineDateKey = baselineWindowEndDateKey || rulesAsOfDateKey
  const windowGapDays = diffDateKeyDays(baselineDateKey, evalWindowEndDateKey)
  const maxGapDays = Math.max(
    0,
    Math.floor(Number(tuning?.moonshotSignalMismatchMaxGapDays ?? 60) || 60),
  )
  const windowComparable =
    !Number.isFinite(Number(windowGapDays)) ||
    Number(windowGapDays) <= maxGapDays
  const baselineSignalsLoaded =
    Number(baselinePreflightStage?.details?.signalsLoaded ?? 0) || 0
  const evalWindowSignalEmpty =
    evalSignalsLoadedMax <= 0 && evalOutcomesMax <= 0
  const probeSignalEmpty = probeStatus !== "PASS" || probeSignalsLoaded <= 0
  const strongEvidenceSignalGap =
    observed > 0 &&
    noSignalsOrOutcomesCount >= Math.max(1, Math.floor(observed * 0.8))
  const gapDetected =
    observed >= minObserved &&
    noSignalsOrOutcomesCount > 0 &&
    evalWindowSignalEmpty &&
    probeSignalEmpty &&
    (windowComparable || (baselineSignalsLoaded > 0 && strongEvidenceSignalGap))
  const reason = gapDetected
    ? `SIGNAL_GAP_WINDOW_${probeConfig.evalWindowStartDateKey ?? "UNKNOWN"}_${probeConfig.evalWindowEndDateKey}`
    : null
  return {
    enabled: true,
    pass: !gapDetected,
    reason,
    metrics: {
      observed,
      minObserved,
      evalSignalsLoadedMax,
      evalOutcomesMax,
      noSignalsOrOutcomesCount,
      evalWindowSignalEmpty,
      probeStatus,
      probeSignalsLoaded,
      probeSignalEmpty,
      baselineSignalsLoaded,
      strongEvidenceSignalGap,
      evalWindowStartDateKey: probeConfig.evalWindowStartDateKey,
      evalWindowEndDateKey: probeConfig.evalWindowEndDateKey,
      windowTradingDays: probeConfig.windowTradingDays,
      baselineWindowEndDateKey: baselineDateKey,
      windowGapDays,
      maxGapDays,
      windowComparable,
    },
  }
}

const resolveAbsolutePath = (value) => {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  return path.isAbsolute(raw) ? raw : path.join(rootDir, raw)
}

const ensureJsonFile = ({ filePath, defaultPayload, normalize }) => {
  if (!fs.existsSync(filePath)) {
    writeJson(filePath, defaultPayload)
  }
  const loaded = readJsonSafe(filePath)
  const normalized = normalize(loaded ?? defaultPayload)
  writeJson(filePath, normalized)
  return normalized
}

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)))

const resolveRetryBackoffMs = (
  tuning,
  {
    sameFailureStreak = 1,
    jitterPct = 0.2,
    failureClass = null,
    failureCode = null,
  } = {},
) => {
  const baseMs = Math.max(
    0,
    Math.floor(Number(tuning?.retryBackoffMs ?? 0) || 0),
  )
  if (baseMs <= 0) return 0
  const streak = Math.max(1, Math.floor(Number(sameFailureStreak ?? 1) || 1))
  const normalizedClass = String(failureClass ?? "")
    .trim()
    .toUpperCase()
  const normalizedCode = String(failureCode ?? "")
    .trim()
    .toUpperCase()
  const isQualityBackoff =
    normalizedClass === "QUALITY" ||
    normalizedCode === "WORST2W_BELOW_THRESHOLD" ||
    normalizedCode === "WORST2W_TRACK_ZERO_PASS" ||
    normalizedCode === "TRADE_GATE_FAIL" ||
    normalizedCode === "MOONSHOT_GATE_FAIL"
  // Keep retries fast on repeated quality failures to avoid long idle gaps.
  const capMultiplier = isQualityBackoff ? 2 : 16
  const factorPowMax = isQualityBackoff ? 2 : 6
  const factor = Math.pow(2, Math.min(factorPowMax, Math.max(0, streak - 1)))
  const capMs = Math.max(baseMs, baseMs * capMultiplier)
  const scaled = Math.min(capMs, baseMs * factor)
  const defaultJitter = isQualityBackoff ? 0.1 : 0.2
  const jitter = Math.max(
    0,
    Math.min(0.9, Number(jitterPct ?? defaultJitter) || defaultJitter),
  )
  const ratio = 1 - jitter + Math.random() * (2 * jitter)
  return Math.max(0, Math.floor(scaled * ratio))
}

const resolveQualityCollapseTrackToken = ({
  failureCode = "",
  failureDetail = "",
}) => {
  const normalizedCode = String(failureCode ?? "")
    .trim()
    .toUpperCase()
  const normalizedDetail = String(failureDetail ?? "")
    .trim()
    .toUpperCase()
  const explicit = normalizedDetail.match(
    /\b(SURGE_EOD|GAP_15_BET|MOONSHOT)\b/g,
  )
  if (Array.isArray(explicit) && explicit.length > 0) {
    const unique = Array.from(new Set(explicit))
    return unique.length === 1 ? unique[0] : unique.sort().join("+")
  }
  if (
    normalizedCode === "WORST2W_TRACK_ZERO_PASS" &&
    normalizedDetail.includes("TRACK_ZERO_PASS")
  ) {
    const parsed = normalizedDetail
      .split("TRACK_ZERO_PASS:")[1]
      ?.split(/[|; ]/)[0]
      ?.split(",")
      ?.map((row) => row.trim())
      ?.filter(Boolean)
    if (Array.isArray(parsed) && parsed.length > 0) {
      const unique = Array.from(new Set(parsed))
      return unique.length === 1 ? unique[0] : unique.sort().join("+")
    }
  }
  return "GLOBAL"
}

const DEFAULT_DATA_SYNC_LEDGER = Object.freeze({
  version: "autosearch_data_sync_ledger_v1",
  updatedAt: null,
  lastDecision: null,
  lastSuccess: null,
  lastSuccessFull: null,
  lastFailure: null,
  inflight: null,
})

const normalizeDataSyncInflight = (raw) => {
  if (!raw || typeof raw !== "object") {
    return null
  }
  const startedAt = String(raw.startedAt ?? "").trim()
  const pid = Number(raw.pid)
  const sessionId = String(raw.sessionId ?? "").trim()
  const syncDateKey = String(raw.syncDateKey ?? "").trim()
  const market = String(raw.market ?? "")
    .trim()
    .toUpperCase()
  if (!startedAt || !sessionId || !syncDateKey || !market) {
    return null
  }
  return {
    startedAt,
    sessionId,
    attempt: Math.max(1, Math.floor(Number(raw.attempt ?? 1) || 1)),
    syncDateKey,
    market,
    mode:
      String(raw.mode ?? "smart")
        .trim()
        .toLowerCase() || "smart",
    tier:
      String(raw.tier ?? "UNKNOWN")
        .trim()
        .toUpperCase() || "UNKNOWN",
    lockPath: String(raw.lockPath ?? "").trim() || null,
    pid: Number.isFinite(pid) && pid > 1 ? Math.floor(pid) : null,
  }
}

const normalizeDataSyncLedger = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {}
  const lastSuccess =
    source.lastSuccess && typeof source.lastSuccess === "object"
      ? source.lastSuccess
      : null
  const lastSuccessFullRaw =
    source.lastSuccessFull && typeof source.lastSuccessFull === "object"
      ? source.lastSuccessFull
      : null
  const inferredLegacyFullDateKey = String(
    lastSuccess?.syncDateKey ?? "",
  ).trim()
  const lastSuccessFull =
    lastSuccessFullRaw ??
    (inferredLegacyFullDateKey
      ? {
          ...lastSuccess,
          tier:
            String(lastSuccess?.tier ?? "")
              .trim()
              .toUpperCase() || "FULL",
          tierReason:
            String(lastSuccess?.tierReason ?? "").trim() ||
            "INFERRED_FROM_LEGACY_LAST_SUCCESS",
        }
      : null)
  return {
    version: String(source.version ?? DEFAULT_DATA_SYNC_LEDGER.version),
    updatedAt: String(source.updatedAt ?? "").trim() || null,
    lastDecision:
      source.lastDecision && typeof source.lastDecision === "object"
        ? source.lastDecision
        : null,
    lastSuccess,
    lastSuccessFull,
    lastFailure:
      source.lastFailure && typeof source.lastFailure === "object"
        ? source.lastFailure
        : null,
    inflight: normalizeDataSyncInflight(source.inflight),
  }
}

const resolveDataSyncMarket = (tuning) => {
  const command = Array.isArray(tuning?.dataSyncCommand)
    ? tuning.dataSyncCommand
    : []
  const explicit = command.find((item) =>
    String(item ?? "")
      .trim()
      .startsWith("--market="),
  )
  const value =
    explicit?.split("=")?.[1] ??
    String(process.env.BACKFILL_MARKET ?? "KR").trim()
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
  return normalized || "KR"
}

const normalizeCommandList = (value, fallback = []) => {
  const list = Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : []
  if (list.length >= 2) {
    return list
  }
  const nextFallback = Array.isArray(fallback)
    ? fallback.map((item) => String(item ?? "").trim()).filter(Boolean)
    : []
  return nextFallback.length >= 2 ? nextFallback : []
}

const resolveDataSyncMode = (tuning) => {
  const raw = String(tuning?.dataSyncMode ?? "smart")
    .trim()
    .toLowerCase()
  if (raw === "legacy") return "legacy"
  if (raw === "weekly" || raw === "weekly_strict") return "weekly_strict"
  return "smart"
}

const resolveDataSyncCommandByTier = ({ tuning, tier }) => {
  const legacy = normalizeCommandList(tuning?.dataSyncCommand, [])
  const full = normalizeCommandList(tuning?.dataSyncFullCommand, legacy)
  const daily = normalizeCommandList(tuning?.dataSyncDailyCommand, full)
  if (String(tier ?? "").toUpperCase() === "DAILY") {
    return daily.length >= 2 ? daily : full
  }
  return full.length >= 2 ? full : daily
}

const attachSyncDateArgsToCommand = ({ command, syncDateKey }) => {
  const syncDate = String(syncDateKey ?? "").trim()
  const base = Array.isArray(command)
    ? command.map((item) => String(item ?? "").trim()).filter(Boolean)
    : []
  if (!syncDate || base.length < 2) {
    return base
  }
  const alreadyTagged = base.some(
    (item) => item.startsWith("--asof=") || item.startsWith("--to="),
  )
  if (alreadyTagged) {
    return base
  }
  const usesOrchestrator = base.some((item) =>
    item.includes("data_sync_orchestrator.mjs"),
  )
  if (!usesOrchestrator) {
    return base
  }
  return [...base, `--asof=${syncDate}`, `--to=${syncDate}`]
}

const stripCommandArgsByPrefix = (command, prefixes) => {
  const list = Array.isArray(command)
    ? command.map((item) => String(item ?? "").trim()).filter(Boolean)
    : []
  const matchers = Array.isArray(prefixes)
    ? prefixes
        .map((prefix) => String(prefix ?? "").trim())
        .filter(Boolean)
        .map((prefix) => prefix.toLowerCase())
    : []
  if (matchers.length === 0) {
    return list
  }
  return list.filter((item) => {
    const lower = item.toLowerCase()
    return !matchers.some((prefix) => lower.startsWith(prefix))
  })
}

const upsertCommandArg = (command, prefix, value) => {
  const key = String(prefix ?? "").trim()
  if (!key) return normalizeCommandList(command, [])
  const clean = stripCommandArgsByPrefix(command, [key])
  if (value === null || value === undefined || value === "") {
    return clean
  }
  return [...clean, `${key}${String(value).trim()}`]
}

const ensureCommandFlag = (command, flag) => {
  const token = String(flag ?? "").trim()
  if (!token) return normalizeCommandList(command, [])
  const list = normalizeCommandList(command, [])
  return list.some((item) => item === token) ? list : [...list, token]
}

const estimateCalendarDaysInclusive = ({ fromDateKey, toDateKey }) => {
  const from = normalizeDateKeyLoose(fromDateKey)
  const to = normalizeDateKeyLoose(toDateKey)
  if (!from || !to || to < from) {
    return 0
  }
  const fromMs = Date.parse(`${from}T00:00:00Z`)
  const toMs = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return 0
  }
  return Math.floor((toMs - fromMs) / 86_400_000) + 1
}

const estimateTradingDaysFromRange = ({
  fromDateKey,
  toDateKey,
  min = 28,
  max = 252,
}) => {
  const calendarDays = estimateCalendarDaysInclusive({ fromDateKey, toDateKey })
  if (!Number.isFinite(calendarDays) || calendarDays <= 0) {
    return min
  }
  const estimate = Math.round((calendarDays * 5) / 7)
  return Math.max(min, Math.min(max, estimate))
}

const buildSignalGapRepairCommand = ({
  baseCommand,
  fromDateKey,
  toDateKey,
  syncDateKey,
  stopAfter = "recommend",
}) => {
  const from = normalizeDateKeyLoose(fromDateKey)
  const to = normalizeDateKeyLoose(toDateKey)
  const syncDate = normalizeDateKeyLoose(syncDateKey)
  if (!from || !to || to < from) {
    return normalizeCommandList(baseCommand, [])
  }
  const rawStopAfter = String(stopAfter ?? "")
    .trim()
    .toLowerCase()
  const stopAfterToken = rawStopAfter === "recommend" ? "recommend" : "derived"
  const signalWindowTradingDays = estimateTradingDaysFromRange({
    fromDateKey: from,
    toDateKey: to,
    min: 28,
    max: 252,
  })
  const maxRepairLookbackDays = Math.max(
    30,
    Math.min(
      4000,
      estimateCalendarDaysInclusive({ fromDateKey: from, toDateKey: to }) + 7,
    ),
  )
  let next = normalizeCommandList(baseCommand, [])
  if (next.length < 2) {
    return next
  }
  next = upsertCommandArg(next, "--mode=", "smart")
  next = upsertCommandArg(next, "--window=", "6y")
  next = upsertCommandArg(next, "--stopAfter=", stopAfterToken)
  // For eval-window signal gaps, rebuild recommend artifacts anchored to the
  // missing window tail first so historical buckets can be repopulated.
  // When recommend regeneration requires training, widen the repair window so
  // ai-backfill training guards (>=1y coverage) do not fail immediately.
  const minRecommendTrainLookbackDays = 400
  const lookbackFromMs =
    Date.parse(`${to}T00:00:00Z`) - minRecommendTrainLookbackDays * 86_400_000
  const lookbackFrom = Number.isFinite(lookbackFromMs)
    ? new Date(lookbackFromMs).toISOString().slice(0, 10)
    : from
  const repairFrom =
    stopAfterToken === "recommend" && lookbackFrom < from ? lookbackFrom : from
  next = upsertCommandArg(next, "--from=", repairFrom)
  next = upsertCommandArg(next, "--to=", to)
  next = upsertCommandArg(next, "--recommend-asof=", to || syncDate)
  next = upsertCommandArg(
    next,
    "--signalWindowTradingDays=",
    String(signalWindowTradingDays),
  )
  next = upsertCommandArg(
    next,
    "--maxRepairLookbackDays=",
    String(maxRepairLookbackDays),
  )
  next = upsertCommandArg(next, "--requireSignals=", "1")
  next = upsertCommandArg(next, "--minSignalsLoaded=", "1")
  next = upsertCommandArg(next, "--forceRepair=", "1")
  next = upsertCommandArg(next, "--strict=", "1")
  next = ensureCommandFlag(next, "--no-kis")
  // Signal-gap recovery must regenerate train/recommend artifacts for the
  // missing historical window. Otherwise inherited --skip-train flags keep
  // the window permanently empty and loop failures repeat.
  next = stripCommandArgsByPrefix(next, [
    "--skip-train",
    "--skip-pattern-train",
  ])
  if (stopAfterToken === "recommend") {
    next = upsertCommandArg(next, "--skip-train=", "0")
    next = upsertCommandArg(next, "--skip-pattern-train=", "0")
  }
  return next
}

const countTradingDaysSince = async ({ prisma, fromDateKey, toDateKey }) => {
  const from = String(fromDateKey ?? "").trim()
  const to = String(toDateKey ?? "").trim()
  if (!from || !to || to <= from) {
    return 0
  }
  const calendar = await resolveTradingCalendarRange({
    prisma: prisma ?? null,
    fromDateKey: from,
    toDateKey: to,
  })
  if (!Array.isArray(calendar) || calendar.length === 0) {
    return 0
  }
  return calendar.filter((dateKey) => String(dateKey ?? "").trim() > from)
    .length
}

const resolveLastTradingDateKeySafe = async ({ prisma, asOfDateKey }) => {
  try {
    return await resolveLastTradingDateKey({ prisma, asOfDateKey })
  } catch {
    return resolveLastTradingDateKey({ prisma: null, asOfDateKey })
  }
}

const resolveDataSyncDecision = async ({
  attempt,
  tuning,
  ledger,
  prisma,
  asOfHint,
}) => {
  const enabled = tuning?.dataSyncEnabled !== false
  const forceDataSyncNextAttempt = toBoolean(
    tuning?.forceDataSyncNextAttempt,
    false,
  )
  const market = resolveDataSyncMarket(tuning)
  const todayDateKey = resolveTodayKstDateKey()
  const tradingDayOnly = toBoolean(tuning?.dataSyncTradingDayOnly, true)
  const oncePerTradingDay = toBoolean(tuning?.dataSyncOncePerTradingDay, true)
  const skipRetryAttempts = toBoolean(tuning?.dataSyncSkipRetryAttempts, true)
  const mode = resolveDataSyncMode(tuning)
  const fullEveryTradingDays = Math.max(
    1,
    Math.floor(Number(tuning?.dataSyncFullEveryTradingDays ?? 5) || 5),
  )
  const weeklyTradingDays = Math.max(
    1,
    Math.floor(Number(tuning?.dataSyncWeeklyTradingDays ?? 5) || 5),
  )
  const asOfHintDateKey = normalizeDateKeyLoose(asOfHint)
  const effectiveAsOfDateKey = asOfHintDateKey || todayDateKey
  const lastTradingDateKey = await resolveLastTradingDateKeySafe({
    prisma,
    asOfDateKey: effectiveAsOfDateKey,
  })
  const isTradingDayToday =
    Boolean(effectiveAsOfDateKey) && effectiveAsOfDateKey === lastTradingDateKey
  const syncDateKey = tradingDayOnly
    ? lastTradingDateKey || effectiveAsOfDateKey || todayDateKey
    : effectiveAsOfDateKey || todayDateKey
  const lastSuccess = ledger?.lastSuccess
  const basePolicy = {
    tradingDayOnly,
    oncePerTradingDay,
    skipRetryAttempts,
    forceDataSyncNextAttempt,
    mode,
    fullEveryTradingDays,
    weeklyTradingDays,
    asOfHintDateKey,
    effectiveAsOfDateKey,
  }
  if (!enabled && !forceDataSyncNextAttempt) {
    return {
      run: false,
      reason: "DISABLED",
      market,
      todayDateKey,
      lastTradingDateKey,
      isTradingDayToday,
      syncDateKey,
      policy: basePolicy,
      command: null,
      tier: null,
      tierReason: null,
      tradingDaysSinceFull: null,
    }
  }
  if (
    tradingDayOnly &&
    !isTradingDayToday &&
    !forceDataSyncNextAttempt &&
    !asOfHintDateKey
  ) {
    return {
      run: false,
      reason: "NON_TRADING_DAY",
      market,
      todayDateKey,
      lastTradingDateKey,
      isTradingDayToday,
      syncDateKey,
      policy: basePolicy,
      command: null,
      tier: null,
      tierReason: null,
      tradingDaysSinceFull: null,
    }
  }
  if (
    skipRetryAttempts &&
    Number(attempt ?? 0) > 1 &&
    !forceDataSyncNextAttempt
  ) {
    return {
      run: false,
      reason: "RETRY_SKIP",
      market,
      todayDateKey,
      lastTradingDateKey,
      isTradingDayToday,
      syncDateKey,
      policy: basePolicy,
      command: null,
      tier: null,
      tierReason: null,
      tradingDaysSinceFull: null,
    }
  }
  if (
    oncePerTradingDay &&
    !forceDataSyncNextAttempt &&
    String(lastSuccess?.market ?? "")
      .trim()
      .toUpperCase() === market &&
    String(lastSuccess?.syncDateKey ?? "").trim() === syncDateKey
  ) {
    return {
      run: false,
      reason: "ALREADY_SYNCED_TODAY",
      market,
      todayDateKey,
      lastTradingDateKey,
      isTradingDayToday,
      syncDateKey,
      policy: basePolicy,
      command: null,
      tier: null,
      tierReason: null,
      tradingDaysSinceFull: null,
    }
  }
  const inflight = normalizeDataSyncInflight(ledger?.inflight)
  if (
    inflight &&
    !forceDataSyncNextAttempt &&
    inflight.market === market &&
    inflight.syncDateKey === syncDateKey
  ) {
    return {
      run: false,
      reason: "INFLIGHT_SYNC_EXISTS",
      market,
      todayDateKey,
      lastTradingDateKey,
      isTradingDayToday,
      syncDateKey,
      policy: basePolicy,
      command: null,
      tier: inflight.tier ?? "UNKNOWN",
      tierReason: "INFLIGHT_LOCK",
      tradingDaysSinceFull: null,
      inflight,
    }
  }
  if (forceDataSyncNextAttempt) {
    const forcedTier =
      String(mode ?? "").toLowerCase() === "smart" ? "DAILY" : "FULL"
    let forcedCommand = attachSyncDateArgsToCommand({
      command: resolveDataSyncCommandByTier({
        tuning,
        tier: forcedTier,
      }),
      syncDateKey,
    })
    const signalGapRepairEnabled = toBoolean(
      tuning?.signalGapRepairEnabled,
      true,
    )
    const signalGapFromDateKey = normalizeDateKeyLoose(
      tuning?.signalGapRepairFromDateKey,
    )
    const signalGapToDateKey = normalizeDateKeyLoose(
      tuning?.signalGapRepairToDateKey,
    )
    const signalGapRepairStopAfter = String(
      tuning?.signalGapRepairStopAfter ?? "recommend",
    )
      .trim()
      .toLowerCase()
    const hasSignalGapWindow =
      signalGapRepairEnabled &&
      signalGapFromDateKey &&
      signalGapToDateKey &&
      signalGapToDateKey >= signalGapFromDateKey
    if (hasSignalGapWindow) {
      forcedCommand = buildSignalGapRepairCommand({
        baseCommand: forcedCommand,
        fromDateKey: signalGapFromDateKey,
        toDateKey: signalGapToDateKey,
        stopAfter: signalGapRepairStopAfter,
        syncDateKey,
      })
    }
    if (!Array.isArray(forcedCommand) || forcedCommand.length < 2) {
      return {
        run: false,
        reason: "COMMAND_MISSING",
        market,
        todayDateKey,
        lastTradingDateKey,
        isTradingDayToday,
        syncDateKey,
        policy: basePolicy,
        command: null,
        tier: forcedTier,
        tierReason: "FORCED_NEXT_ATTEMPT",
        tradingDaysSinceFull: null,
        forced: true,
        signalGapRepair: hasSignalGapWindow
          ? {
              fromDateKey: signalGapFromDateKey,
              toDateKey: signalGapToDateKey,
              stopAfter: signalGapRepairStopAfter,
            }
          : null,
      }
    }
    return {
      run: true,
      reason: "FORCED_NEXT_ATTEMPT",
      market,
      todayDateKey,
      lastTradingDateKey,
      isTradingDayToday,
      syncDateKey,
      forced: true,
      policy: basePolicy,
      command: forcedCommand,
      tier: forcedTier,
      tierReason: "FORCED_NEXT_ATTEMPT",
      tradingDaysSinceFull: null,
      signalGapRepair: hasSignalGapWindow
        ? {
            fromDateKey: signalGapFromDateKey,
            toDateKey: signalGapToDateKey,
            stopAfter: signalGapRepairStopAfter,
          }
        : null,
    }
  }
  let tier = "FULL"
  let tierReason = "LEGACY_MODE"
  let tradingDaysSinceFull = null
  if (mode === "smart") {
    tier = "DAILY"
    tierReason = "SMART_DAILY_DEFAULT"
    const lastFullDateKey = String(
      ledger?.lastSuccessFull?.syncDateKey ?? "",
    ).trim()
    if (!lastFullDateKey) {
      tier = "FULL"
      tierReason = "NO_FULL_BASELINE"
    } else if (syncDateKey && syncDateKey > lastFullDateKey) {
      try {
        tradingDaysSinceFull = await countTradingDaysSince({
          prisma,
          fromDateKey: lastFullDateKey,
          toDateKey: syncDateKey,
        })
      } catch {
        tradingDaysSinceFull = null
      }
      if (
        Number.isFinite(Number(tradingDaysSinceFull)) &&
        Number(tradingDaysSinceFull) >= fullEveryTradingDays
      ) {
        tier = "FULL"
        tierReason = "FULL_INTERVAL_REACHED"
      }
    }
  } else if (mode === "weekly_strict") {
    tier = "FULL"
    tierReason = "WEEKLY_STRICT_DEFAULT"
    const lastFullDateKey = String(
      ledger?.lastSuccessFull?.syncDateKey ?? "",
    ).trim()
    if (!lastFullDateKey) {
      tierReason = "NO_FULL_BASELINE"
    } else if (syncDateKey && syncDateKey > lastFullDateKey) {
      try {
        tradingDaysSinceFull = await countTradingDaysSince({
          prisma,
          fromDateKey: lastFullDateKey,
          toDateKey: syncDateKey,
        })
      } catch {
        tradingDaysSinceFull = null
      }
      if (
        Number.isFinite(Number(tradingDaysSinceFull)) &&
        Number(tradingDaysSinceFull) < weeklyTradingDays
      ) {
        return {
          run: false,
          reason: "WEEKLY_NOT_DUE",
          market,
          todayDateKey,
          lastTradingDateKey,
          isTradingDayToday,
          syncDateKey,
          policy: basePolicy,
          command: null,
          tier,
          tierReason: "WEEKLY_NOT_DUE",
          tradingDaysSinceFull,
        }
      }
      if (Number.isFinite(Number(tradingDaysSinceFull))) {
        tierReason = "WEEKLY_DUE"
      }
    }
  }
  const command = attachSyncDateArgsToCommand({
    command: resolveDataSyncCommandByTier({ tuning, tier }),
    syncDateKey,
  })
  if (!Array.isArray(command) || command.length < 2) {
    return {
      run: false,
      reason: "COMMAND_MISSING",
      market,
      todayDateKey,
      lastTradingDateKey,
      isTradingDayToday,
      syncDateKey,
      policy: basePolicy,
      command: null,
      tier,
      tierReason,
      tradingDaysSinceFull,
    }
  }
  return {
    run: true,
    reason: forceDataSyncNextAttempt ? "FORCED_NEXT_ATTEMPT" : "RUN_ALLOWED",
    market,
    todayDateKey,
    lastTradingDateKey,
    isTradingDayToday,
    syncDateKey,
    forced: forceDataSyncNextAttempt,
    policy: basePolicy,
    command,
    tier,
    tierReason,
    tradingDaysSinceFull,
  }
}

const buildNextDataSyncLedger = ({
  ledger,
  decision,
  stage,
  sessionId,
  attempt,
}) => {
  const next = normalizeDataSyncLedger(ledger)
  const updatedAt = isoNow()
  next.updatedAt = updatedAt
  next.lastDecision = {
    ts: updatedAt,
    sessionId,
    attempt,
    run: decision?.run === true,
    reason: String(decision?.reason ?? "UNKNOWN"),
    market:
      String(decision?.market ?? "")
        .trim()
        .toUpperCase() || "KR",
    todayDateKey: String(decision?.todayDateKey ?? "").trim() || null,
    lastTradingDateKey:
      String(decision?.lastTradingDateKey ?? "").trim() || null,
    syncDateKey: String(decision?.syncDateKey ?? "").trim() || null,
    mode:
      String(decision?.policy?.mode ?? "smart")
        .trim()
        .toLowerCase() || "smart",
    tier:
      String(decision?.tier ?? "UNKNOWN")
        .trim()
        .toUpperCase() || "UNKNOWN",
    tierReason: String(decision?.tierReason ?? "").trim() || null,
    signalGapRepair:
      decision?.signalGapRepair && typeof decision.signalGapRepair === "object"
        ? {
            fromDateKey:
              String(decision.signalGapRepair.fromDateKey ?? "").trim() || null,
            toDateKey:
              String(decision.signalGapRepair.toDateKey ?? "").trim() || null,
            stopAfter:
              String(decision.signalGapRepair.stopAfter ?? "").trim() || null,
          }
        : null,
    fullEveryTradingDays: Number.isFinite(
      Number(decision?.policy?.fullEveryTradingDays),
    )
      ? Number(decision.policy.fullEveryTradingDays)
      : null,
    tradingDaysSinceFull: Number.isFinite(
      Number(decision?.tradingDaysSinceFull),
    )
      ? Number(decision.tradingDaysSinceFull)
      : null,
    stageStatus: String(stage?.status ?? "UNKNOWN"),
    exitCode: Number.isFinite(Number(stage?.exitCode))
      ? Number(stage.exitCode)
      : null,
    durationMs: Number.isFinite(Number(stage?.durationMs))
      ? Number(stage.durationMs)
      : 0,
  }
  if (decision?.run === true) {
    next.inflight = null
  }
  if (decision?.run === true && stage?.status === "PASS") {
    next.lastSuccess = {
      ts: updatedAt,
      sessionId,
      attempt,
      market: next.lastDecision.market,
      syncDateKey: next.lastDecision.syncDateKey,
      todayDateKey: next.lastDecision.todayDateKey,
      lastTradingDateKey: next.lastDecision.lastTradingDateKey,
      mode: next.lastDecision.mode,
      tier: next.lastDecision.tier,
      tierReason: next.lastDecision.tierReason,
    }
    if (String(next.lastDecision.tier ?? "").toUpperCase() === "FULL") {
      next.lastSuccessFull = {
        ...next.lastSuccess,
      }
    }
  } else if (decision?.run === true && stage?.status === "FAIL") {
    next.lastFailure = {
      ts: updatedAt,
      sessionId,
      attempt,
      market: next.lastDecision.market,
      syncDateKey: next.lastDecision.syncDateKey,
      todayDateKey: next.lastDecision.todayDateKey,
      lastTradingDateKey: next.lastDecision.lastTradingDateKey,
      reason: String(stage?.reason ?? "COMMAND_FAILED"),
      exitCode: next.lastDecision.exitCode,
      mode: next.lastDecision.mode,
      tier: next.lastDecision.tier,
      tierReason: next.lastDecision.tierReason,
    }
  }
  return next
}

const buildDataSyncInflightLedger = ({
  ledger,
  sessionId,
  attempt,
  decision,
  lockPath = null,
}) => {
  const next = normalizeDataSyncLedger(ledger)
  const updatedAt = isoNow()
  next.updatedAt = updatedAt
  next.inflight = {
    startedAt: updatedAt,
    sessionId: String(sessionId ?? "").trim(),
    attempt: Math.max(1, Math.floor(Number(attempt ?? 1) || 1)),
    syncDateKey: String(decision?.syncDateKey ?? "").trim() || null,
    market:
      String(decision?.market ?? "")
        .trim()
        .toUpperCase() || "KR",
    mode:
      String(decision?.policy?.mode ?? "smart")
        .trim()
        .toLowerCase() || "smart",
    tier:
      String(decision?.tier ?? "UNKNOWN")
        .trim()
        .toUpperCase() || "UNKNOWN",
    lockPath: lockPath ? String(lockPath).trim() : null,
    pid: process.pid,
  }
  return next
}

const readMemoryHeadroom = (tuning) => {
  const guard = tuning?.memoryGuard
  const enabled = guard?.enabled !== false
  const totalBytes = Number(os.totalmem?.() ?? 0)
  const freeBytes = Number(os.freemem?.() ?? 0)
  const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 0
  const freeMb = Math.round(freeBytes / 1024 / 1024)
  const minFreeRatio = Number(guard?.minFreeRatio ?? 0.08) || 0.08
  const minFreeMb = Math.floor(Number(guard?.minFreeMb ?? 1024) || 1024)
  const ratioOk = freeRatio >= minFreeRatio
  const mbOk = freeMb >= minFreeMb
  return {
    enabled,
    totalMb: Math.round(totalBytes / 1024 / 1024),
    freeMb,
    freeRatio,
    minFreeRatio,
    minFreeMb,
    stop: enabled && !ratioOk && !mbOk,
    cooldownMs: Math.max(
      0,
      Math.floor(Number(guard?.cooldownMs ?? 120000) || 120000),
    ),
  }
}

const resolveStageTimeoutMs = (tuning, key) => {
  const value = Number(tuning?.timeoutsMs?.[key] ?? 0)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

const isSameFailureStopEnabled = (tuning) =>
  (Number(tuning?.sameFailureLimit ?? 0) || 0) > 0

const isSameFailureStopTarget = (failureCode) => {
  const code = String(failureCode ?? "")
    .trim()
    .toUpperCase()
  if (!code) return false
  if (isInsufficientPoolFailureCode(code)) return false
  return true
}

const classifyFailureClass = (failureCode) => {
  return classifyFailureType(failureCode)
}

const evaluateSummaryPreflight = ({ summary, tuning }) => {
  const enabled = tuning?.preflightEnabled !== false
  if (!enabled) {
    return {
      enabled: false,
      pass: true,
      reasons: [],
      metrics: { disabled: true },
    }
  }
  const stage1CandidatesObservedRaw = Number(summary?.stage1Candidates)
  const stage1CandidatesObserved = Number.isFinite(stage1CandidatesObservedRaw)
    ? Math.max(0, stage1CandidatesObservedRaw)
    : 0
  const poolCountFromObject =
    summary?.poolCountByTrack && typeof summary.poolCountByTrack === "object"
      ? Object.values(summary.poolCountByTrack).reduce(
          (acc, value) => acc + (Number(value) || 0),
          0,
        )
      : 0
  const poolCountRaw = Number(summary?.poolCount)
  const poolCount = Number.isFinite(poolCountRaw)
    ? Math.max(0, poolCountRaw)
    : Math.max(0, poolCountFromObject)
  const stage1Candidates =
    stage1CandidatesObserved > 0 ? stage1CandidatesObserved : poolCount
  const minSignalsLoaded = Math.max(
    0,
    Math.floor(Number(tuning?.preflightMinSignalsLoaded ?? 1) || 1),
  )
  const requireQualifiedSignals =
    tuning?.preflightRequireQualifiedSignals === true
  const minQualifiedSignals = Math.max(
    0,
    Math.floor(Number(tuning?.preflightMinQualifiedSignals ?? 0) || 0),
  )
  const reasons = []
  if (stage1Candidates < minSignalsLoaded) {
    reasons.push("PREFLIGHT_STAGE1_CANDIDATES_LOW")
  }
  if (requireQualifiedSignals && poolCount < Math.max(1, minQualifiedSignals)) {
    reasons.push("PREFLIGHT_POOL_QUALIFIED_LOW")
  }
  return {
    enabled: true,
    pass: reasons.length === 0,
    reasons,
    metrics: {
      stage1Candidates,
      stage1CandidatesObserved,
      poolCount,
      minSignalsLoaded,
      requireQualifiedSignals,
      minQualifiedSignals,
    },
  }
}

const buildSurgePoolDiagnostics = (summary) => {
  if (!summary || typeof summary !== "object") {
    return null
  }
  const poolQualityByTrack =
    summary.poolQualityByTrack && typeof summary.poolQualityByTrack === "object"
      ? summary.poolQualityByTrack
      : {}
  const surge = poolQualityByTrack.SURGE_EOD ?? null
  const rescueRows = Array.isArray(summary?.rescueDistByTrack?.SURGE_EOD?.rows)
    ? summary.rescueDistByTrack.SURGE_EOD.rows
    : []
  const rescueReasonCounts = {}
  let rescueInsufficientWeeks = 0
  const insufficientReasonSet = new Set([
    "WORST2W_INSUFFICIENT_WEEKS",
    "WEEK_SERIES_TOO_SHORT",
    "VAL_SUMMARY_MISSING",
    "VAL_SUMMARY_PARSE_ERROR",
  ])
  for (const row of rescueRows) {
    const reason = String(row?.reason ?? "UNKNOWN").trim() || "UNKNOWN"
    rescueReasonCounts[reason] =
      (Number(rescueReasonCounts[reason] ?? 0) || 0) + 1
    if (insufficientReasonSet.has(reason)) {
      rescueInsufficientWeeks += 1
    }
  }
  const prefilterDroppedByReason = Array.isArray(
    summary?.prefilter?.droppedByReason,
  )
    ? summary.prefilter.droppedByReason
    : []
  const prefilterDroppedByReasonByTrack =
    summary?.prefilter?.droppedByReasonByTrack &&
    typeof summary.prefilter.droppedByReasonByTrack === "object"
      ? summary.prefilter.droppedByReasonByTrack
      : {}
  return {
    status: String(summary.status ?? "").trim() || null,
    reason: String(summary.reason ?? "").trim() || null,
    stage1Candidates:
      Number(summary.stage1Candidates ?? 0) ||
      Number(summary.poolCount ?? 0) ||
      (summary.poolCountByTrack && typeof summary.poolCountByTrack === "object"
        ? Object.values(summary.poolCountByTrack).reduce(
            (acc, value) => acc + (Number(value) || 0),
            0,
          )
        : 0),
    poolCountByTrack:
      summary.poolCountByTrack && typeof summary.poolCountByTrack === "object"
        ? summary.poolCountByTrack
        : {},
    lowQualityTracks: Array.isArray(summary.lowQualityTracks)
      ? summary.lowQualityTracks
      : [],
    surgeQuality: surge,
    rescue: {
      inspected:
        Number(summary?.rescueDistByTrack?.SURGE_EOD?.inspected ?? 0) || 0,
      rescuedPassCount:
        Number(summary?.rescueDistByTrack?.SURGE_EOD?.rescuedPassCount ?? 0) ||
        0,
      deepInspected:
        Number(summary?.rescueDistByTrack?.SURGE_EOD?.deepInspected ?? 0) || 0,
      deepPassCount:
        Number(summary?.rescueDistByTrack?.SURGE_EOD?.deepPassCount ?? 0) || 0,
      deepSkippedByReason:
        Number(
          summary?.rescueDistByTrack?.SURGE_EOD?.deepSkippedByReason ?? 0,
        ) || 0,
      deepSkippedByCap:
        Number(summary?.rescueDistByTrack?.SURGE_EOD?.deepSkippedByCap ?? 0) ||
        0,
      reasonCounts: rescueReasonCounts,
      insufficientWeeksCount: rescueInsufficientWeeks,
    },
    prefilter: {
      enabled: summary?.prefilter?.enabled === true,
      inputRows: Number(summary?.prefilter?.inputRows ?? 0) || 0,
      outputRows: Number(summary?.prefilter?.outputRows ?? 0) || 0,
      droppedByExcludedFingerprint:
        Number(summary?.prefilter?.droppedByExcludedFingerprint ?? 0) || 0,
      droppedByReason: prefilterDroppedByReason,
      droppedByReasonByTrack: prefilterDroppedByReasonByTrack,
      excludedFingerprints:
        Number(summary?.prefilter?.excludedFingerprints ?? 0) || 0,
    },
  }
}

const toMapObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {}

const findStage = (stageResults, stageName) =>
  Array.isArray(stageResults)
    ? (stageResults.find((row) => String(row?.stage ?? "") === stageName) ??
      null)
    : null

const pickFirstPositiveNumber = (values, fallback = 0) => {
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) {
      return n
    }
  }
  return fallback
}

const readSummaryStatNumber = (value) => {
  if (Number.isFinite(Number(value))) {
    return Number(value) || 0
  }
  if (!value || typeof value !== "object") {
    return 0
  }
  return pickFirstPositiveNumber(
    [value.avg, value.max, value.min, value.count],
    0,
  )
}

const buildAttemptObservability = ({
  sessionId,
  attempt,
  stageResults,
  rules,
  tuning,
  failure = null,
  failureClass = null,
  sameFailureStreak = 0,
  sameFailureSignatureStreak = 0,
  coveragePlan = null,
  sourceIdentity = null,
  summary = null,
  report = null,
  memoryHeadroom = null,
  runtimeMeta = null,
}) => {
  const precheck = findStage(stageResults, "PRECHECK_SIGNAL_GUARD")
  const signalPreflight = findStage(stageResults, "SIGNAL_PREFLIGHT")
  const evalSignalPreflight = findStage(stageResults, "EVAL_SIGNAL_PREFLIGHT")
  const moonshotGuard = findStage(stageResults, "MOONSHOT_OUTCOME_GUARD")
  const summaryPreflight = findStage(stageResults, "SUMMARY_PREFLIGHT")
  const trainValidate = findStage(stageResults, "TRAIN_VALIDATE")
  const deployApply = findStage(stageResults, "DEPLOY_APPLY")
  const verify = findStage(stageResults, "VERIFY")
  const precheckDetails = toMapObject(precheck?.details)
  const signalDetails = toMapObject(signalPreflight?.details)
  const evalSignalDetails = toMapObject(evalSignalPreflight?.details)
  const statusSet = new Set(
    (stageResults ?? []).map((row) => String(row?.status ?? "").toUpperCase()),
  )
  const totalDurationMs = (stageResults ?? []).reduce(
    (acc, row) => acc + (Number(row?.durationMs ?? 0) || 0),
    0,
  )
  const stage1SummaryPath = String(summary?.stage1SummaryPath ?? "").trim()
  const stage1SummaryFallback = stage1SummaryPath
    ? toMapObject(readJsonSafe(stage1SummaryPath))
    : {}
  const poolCountByTrack = toMapObject(
    summary?.poolCountByTrack ?? stage1SummaryFallback?.poolCountByTrack,
  )
  const poolQualityByTrack = toMapObject(
    summary?.poolQualityByTrack ?? stage1SummaryFallback?.poolQualityByTrack,
  )
  const rescueAddedByTrack = toMapObject(
    summary?.rescueAddedByTrack ?? stage1SummaryFallback?.rescueAddedByTrack,
  )
  const activationCandidateByTrack = toMapObject(
    report?.activationCandidateByTrack ??
      report?.diagnostics?.activationCandidateByTrack,
  )
  const selectedPoolSetByTrackRaw = toMapObject(report?.selectedPoolSetByTrack)
  const activationPoolByTrack = toMapObject(report?.activationPoolByTrack)
  const persistedPoolByTrack = toMapObject(report?.persistedPoolByTrack)
  const readActivationPoolRows = (rawValue) => {
    if (Array.isArray(rawValue)) {
      return rawValue
    }
    if (!rawValue || typeof rawValue !== "object") {
      return []
    }
    if (Array.isArray(rawValue.rows)) {
      return rawValue.rows
    }
    if (Array.isArray(rawValue.items)) {
      return rawValue.items
    }
    return []
  }
  const stage1CandidatesObserved =
    Number(
      summary?.stage1Candidates ?? stage1SummaryFallback?.stage1Candidates ?? 0,
    ) || 0
  const poolSize =
    Number(summary?.poolCount ?? stage1SummaryFallback?.poolCount ?? 0) ||
    Object.values(poolCountByTrack).reduce(
      (acc, value) => acc + (Number(value) || 0),
      0,
    )
  const trackList = ["SURGE_EOD", "GAP_15_BET", "MOONSHOT"]
  const poolSizeByTrack = {}
  const poolAliveByTrack = {}
  const poolPassByTrack = {}
  const poolRefillByTrack = {}
  const activationPoolSizeByTrack = {}
  const selectedPoolCandidateByTrack = {}
  const selectedPoolSetByTrack = {}
  const selectedMemberByTrack = {}
  const poolSetAliveByTrack = {}
  const poolSetPassRateByTrack = {}
  for (const track of trackList) {
    const quality = toMapObject(poolQualityByTrack[track])
    const rescue = toMapObject(rescueAddedByTrack[track])
    const selected = toMapObject(activationCandidateByTrack[track])
    const effectiveActivationPool =
      persistedPoolByTrack?.[track] ?? activationPoolByTrack?.[track]
    const activationPoolMeta = toMapObject(effectiveActivationPool)
    const activationPoolRows = readActivationPoolRows(effectiveActivationPool)
    const selectedFromPool =
      activationPoolRows.find((row) => row?.state === "ACTIVE") ??
      activationPoolRows[0] ??
      null
    poolSizeByTrack[track] =
      Number(poolCountByTrack?.[track] ?? quality?.selected ?? 0) || 0
    poolAliveByTrack[track] =
      Number(
        quality?.selected ??
          activationPoolMeta?.active ??
          poolSizeByTrack[track] ??
          0,
      ) || 0
    poolPassByTrack[track] =
      Number(
        quality?.worst2wEffectivePassCount ??
          quality?.worst2wGatePassCount ??
          0,
      ) || 0
    poolRefillByTrack[track] = Number(rescue?.added ?? 0) || 0
    activationPoolSizeByTrack[track] =
      Number(activationPoolMeta?.total ?? activationPoolRows.length) || 0
    selectedPoolCandidateByTrack[track] = {
      version:
        Number(selected?.version ?? selectedFromPool?.version ?? 0) || null,
      versionLabel:
        String(
          selected?.versionLabel ?? selectedFromPool?.versionLabel ?? "",
        ).trim() || null,
      engineType:
        String(selected?.engineType ?? selectedFromPool?.engineType ?? "")
          .trim()
          .toLowerCase() === "chart"
          ? "chart"
          : "rule",
    }
    const selectedSet = toMapObject(selectedPoolSetByTrackRaw?.[track])
    selectedPoolSetByTrack[track] = {
      poolSetId:
        String(selectedSet?.poolSetId ?? "").trim() ||
        `${track}:POOLSET:FALLBACK`,
      selectedMemberCandidateId:
        String(selectedSet?.selectedMemberCandidateId ?? "").trim() ||
        String(selectedFromPool?.candidateId ?? "").trim() ||
        null,
      state: String(selectedSet?.state ?? "").trim() || "ACTIVE",
      passFinal: selectedSet?.passFinal === true,
      memberCount:
        Number(selectedSet?.memberCount ?? activationPoolRows.length) ||
        activationPoolRows.length,
      updatedAt: String(selectedSet?.updatedAt ?? "").trim() || null,
    }
    selectedMemberByTrack[track] =
      selectedPoolSetByTrack[track].selectedMemberCandidateId ?? null
    poolSetAliveByTrack[track] =
      Number(selectedPoolSetByTrack[track].memberCount ?? 0) > 0 ? 1 : 0
    poolSetPassRateByTrack[track] =
      selectedPoolSetByTrack[track].passFinal === true ? 1 : 0
  }
  const moonshotGate = toMapObject(
    report?.lockboxByTrack?.SURGE_EOD?.moonshotGate,
  )
  const moonshotConsistencyGuardDetails = toMapObject(
    findStage(stageResults, "MOONSHOT_SIGNAL_CONSISTENCY_GUARD")?.details,
  )
  const moonshotOutcomeGuardDetails = toMapObject(
    findStage(stageResults, "MOONSHOT_OUTCOME_GUARD")?.details,
  )
  const summaryMoonshotDiagnostics = toMapObject(
    summary?.moonshotPoolDiagnostics ??
      stage1SummaryFallback?.moonshotPoolDiagnostics,
  )
  const moonshotSignalsLoaded = pickFirstPositiveNumber(
    [
      moonshotGate.signalsLoaded,
      moonshotOutcomeGuardDetails.signalsLoadedMin,
      moonshotConsistencyGuardDetails.evalSignalsLoadedMax,
      evalSignalDetails.signalsLoaded,
      moonshotConsistencyGuardDetails.preflightSignalsLoaded,
      readSummaryStatNumber(summaryMoonshotDiagnostics.signalsLoaded),
    ],
    0,
  )
  const moonshotSignalsQualified = pickFirstPositiveNumber(
    [
      moonshotGate.signalsQualified,
      evalSignalDetails.signalsQualified,
      moonshotConsistencyGuardDetails.preflightSignalsQualified,
      readSummaryStatNumber(summaryMoonshotDiagnostics.signalsQualified),
    ],
    0,
  )
  const stage2EnteredFromReport =
    Number(
      report?.maxTargetPassed ??
        report?.lockboxByTrack?.SURGE_EOD?.summary?.metrics?.countWeeksGE ??
        0,
    ) || 0
  const stage2EnteredFromActivationPool = Object.values(
    activationPoolSizeByTrack,
  ).reduce((acc, value) => acc + (Number(value) || 0), 0)
  const stage2Summary = toMapObject(summary?.stage2)
  return {
    sessionId,
    attempt,
    ts: isoNow(),
    funnel: {
      signalsLoaded:
        Number(
          signalDetails.signalsLoaded ?? precheckDetails.signalsLoaded ?? 0,
        ) || 0,
      signalsQualified:
        Number(
          signalDetails.signalsQualified ??
            precheckDetails.signalsQualified ??
            0,
        ) || 0,
      universeSize:
        Number(
          signalDetails.universeSize ?? precheckDetails.universeSize ?? 0,
        ) || 0,
      weekCount:
        Number(
          signalDetails.weekCountObserved ??
            precheckDetails.weekCountObserved ??
            0,
        ) || 0,
      stage1Candidates:
        stage1CandidatesObserved > 0 ? stage1CandidatesObserved : poolSize,
      poolSize,
      stage1PassCount:
        Number(poolPassByTrack?.SURGE_EOD ?? 0) +
        Number(poolPassByTrack?.GAP_15_BET ?? 0),
      rescuePromoted:
        Number(summary?.rescueDistByTrack?.SURGE_EOD?.rescuedPassCount ?? 0) +
        Number(summary?.rescueDistByTrack?.GAP_15_BET?.rescuedPassCount ?? 0),
      stage2Entered:
        stage2EnteredFromReport > 0
          ? stage2EnteredFromReport
          : stage2EnteredFromActivationPool,
      passFinalCount: Number(
        String(report?.status ?? "")
          .trim()
          .toUpperCase() === "PASS",
      ),
    },
    gate: {
      minWorst2wAvgPct: Number(rules?.minWorst2wAvgPct ?? 0) || 0,
      targetPct: Number(rules?.targetPct ?? 0) || 0,
      rescueAlpha: Number(tuning?.rescueAlpha ?? 0) || 0,
      rescueP0: Number(tuning?.rescueP0 ?? 0) || 0,
      rescueLcbQuantile: Number(tuning?.rescueLcbQuantile ?? 0) || 0,
      reportStatus: String(report?.status ?? "").trim() || null,
      moonshotSignalsLoaded,
      moonshotSignalsQualified,
      lockboxOk: report?.lockboxOk === true,
    },
    pool: {
      sizeByTrack: poolSizeByTrack,
      aliveByTrack: poolAliveByTrack,
      passByTrack: poolPassByTrack,
      refillByTrack: poolRefillByTrack,
      activationPoolSizeByTrack,
      selectedCandidateByTrack: selectedPoolCandidateByTrack,
      selectedPoolSetByTrack,
      selectedMemberByTrack,
      poolSetAliveByTrack,
      poolSetPassRateByTrack,
      passDensity: Number(stage2Summary?.passDensity ?? 0) || 0,
      terminalRatio: Number(stage2Summary?.terminalRatio ?? 0) || 0,
      stage2PeakRamMb: Number(stage2Summary?.peakRamMb ?? 0) || 0,
      timeToFirstPassSec:
        Number(stage2Summary?.timeToFirstPassSec ?? Number.NaN) || 0,
      stage2ExecCount: Number(stage2Summary?.stage2ExecCount ?? 0) || 0,
      stage2CacheHitCount: Number(stage2Summary?.stage2CacheHitCount ?? 0) || 0,
      stage2CacheHitRate:
        Number(stage2Summary?.stage2CacheHitRate ?? Number.NaN) || 0,
      stage2DuplicateSkipCount:
        Number(stage2Summary?.duplicateSkipCount ?? 0) || 0,
      championVsDiscoveryPassShare: toMapObject(
        stage2Summary?.championVsDiscoveryPassShare,
      ),
    },
    failure: {
      code: failure?.code ?? null,
      detail: failure?.detail ?? null,
      class: failureClass ?? null,
      sameFailureStreak: Number(sameFailureStreak ?? 0) || 0,
      sameFailureSignatureStreak: Number(sameFailureSignatureStreak ?? 0) || 0,
      moonshotOutcomeGuardReason: moonshotGuard?.reason ?? null,
      summaryPreflightReason: summaryPreflight?.reason ?? null,
      evalSignalReasons: evalSignalDetails.reasons ?? null,
    },
    runtime: {
      totalDurationMs,
      stageCount: Array.isArray(stageResults) ? stageResults.length : 0,
      hasFail: statusSet.has("FAIL"),
      hasPass: statusSet.has("PASS"),
      trainValidateExitCode: Number(trainValidate?.exitCode ?? 0) || 0,
      deployApplyExitCode: Number(deployApply?.exitCode ?? 0) || 0,
      verifyExitCode: Number(verify?.exitCode ?? 0) || 0,
      peakFreeMb: Number(memoryHeadroom?.freeMb ?? 0) || 0,
      totalMb: Number(memoryHeadroom?.totalMb ?? 0) || 0,
      freeRatio: Number(memoryHeadroom?.freeRatio ?? 0) || 0,
      memoryGuardStop: memoryHeadroom?.stop === true,
      runtimeProfile: runtimeMeta?.profile ?? null,
      runtimeProfileModeSource: runtimeMeta?.modeSource ?? null,
      runtimeProfileBanditScore: Number(runtimeMeta?.bandit?.score ?? 0) || 0,
      runtimeProfileBanditPosteriorMean:
        Number(runtimeMeta?.bandit?.posteriorMean ?? 0) || 0,
      runtimeProfileBanditAttempts:
        Number(runtimeMeta?.bandit?.attempts ?? 0) || 0,
      runtimeBudgetBias:
        Number(runtimeMeta?.budgetBias?.roundsMultiplier ?? 1) || 1,
    },
    data: {
      dataSyncEnabled: tuning?.dataSyncEnabled !== false,
      deriveEnabled: tuning?.deriveEnabled === true,
      dataSyncMode: tuning?.dataSyncMode ?? null,
      dataSyncOncePerTradingDay: tuning?.dataSyncOncePerTradingDay !== false,
      dataSyncSkipRetryAttempts: tuning?.dataSyncSkipRetryAttempts !== false,
      coveragePlan,
    },
    environment: {
      noKis: String(tuning?.envOverrides?.NO_KIS ?? "0"),
      backfillDisableKis: String(
        tuning?.envOverrides?.BACKFILL_DISABLE_KIS ?? "0",
      ),
      backfillKisEnabled: String(
        tuning?.envOverrides?.BACKFILL_KIS_ENABLED ?? "1",
      ),
      gitCommitHash: sourceIdentity?.git?.shortHead ?? null,
      gitDirty: sourceIdentity?.git?.clean === false,
      snapshotHash: sourceIdentity?.snapshotHash ?? null,
    },
  }
}

const buildProgressObservabilityPatch = (observability) => {
  const obs =
    observability && typeof observability === "object" ? observability : {}
  const funnel = obs.funnel && typeof obs.funnel === "object" ? obs.funnel : {}
  const pool = obs.pool && typeof obs.pool === "object" ? obs.pool : {}
  const selectedCandidateByTrack =
    pool.selectedCandidateByTrack &&
    typeof pool.selectedCandidateByTrack === "object"
      ? pool.selectedCandidateByTrack
      : {}
  const selectedPoolSetByTrack =
    pool.selectedPoolSetByTrack &&
    typeof pool.selectedPoolSetByTrack === "object"
      ? pool.selectedPoolSetByTrack
      : {}
  const selectedMemberByTrack =
    pool.selectedMemberByTrack && typeof pool.selectedMemberByTrack === "object"
      ? pool.selectedMemberByTrack
      : {}
  const poolSetAliveByTrack =
    pool.poolSetAliveByTrack && typeof pool.poolSetAliveByTrack === "object"
      ? pool.poolSetAliveByTrack
      : {}
  const poolSetPassRateByTrack =
    pool.poolSetPassRateByTrack &&
    typeof pool.poolSetPassRateByTrack === "object"
      ? pool.poolSetPassRateByTrack
      : {}
  const championVsDiscoveryPassShare =
    pool.championVsDiscoveryPassShare &&
    typeof pool.championVsDiscoveryPassShare === "object"
      ? pool.championVsDiscoveryPassShare
      : {}
  return {
    lastSignalsLoaded: Number(funnel.signalsLoaded ?? 0) || 0,
    lastSignalsQualified: Number(funnel.signalsQualified ?? 0) || 0,
    lastUniverseSize: Number(funnel.universeSize ?? 0) || 0,
    lastWeekCount: Number(funnel.weekCount ?? 0) || 0,
    lastPoolSize: Number(funnel.poolSize ?? 0) || 0,
    lastPoolSizeByTrack:
      pool.sizeByTrack && typeof pool.sizeByTrack === "object"
        ? pool.sizeByTrack
        : {},
    lastPoolAliveByTrack:
      pool.aliveByTrack && typeof pool.aliveByTrack === "object"
        ? pool.aliveByTrack
        : {},
    lastPoolPassByTrack:
      pool.passByTrack && typeof pool.passByTrack === "object"
        ? pool.passByTrack
        : {},
    lastPoolRefillByTrack:
      pool.refillByTrack && typeof pool.refillByTrack === "object"
        ? pool.refillByTrack
        : {},
    lastStage1PassCount: Number(funnel.stage1PassCount ?? 0) || 0,
    lastRescuePromoted: Number(funnel.rescuePromoted ?? 0) || 0,
    lastStage2Entered: Number(funnel.stage2Entered ?? 0) || 0,
    lastPassFinalCount: Number(funnel.passFinalCount ?? 0) || 0,
    lastSelectedPoolCandidateByTrack: selectedCandidateByTrack,
    lastSelectedPoolSetByTrack: selectedPoolSetByTrack,
    lastSelectedMemberByTrack: selectedMemberByTrack,
    lastPoolSetAliveByTrack: poolSetAliveByTrack,
    lastPoolSetPassRateByTrack: poolSetPassRateByTrack,
    lastStage2PassDensity: Number(pool.passDensity ?? 0) || 0,
    lastStage2TerminalRatio: Number(pool.terminalRatio ?? 0) || 0,
    lastStage2PeakRamMb: Number(pool.stage2PeakRamMb ?? 0) || 0,
    lastTimeToFirstPassSec: Number(pool.timeToFirstPassSec ?? 0) || 0,
    lastStage2ExecCount: Number(pool.stage2ExecCount ?? 0) || 0,
    lastStage2CacheHitCount: Number(pool.stage2CacheHitCount ?? 0) || 0,
    lastStage2CacheHitRate: Number(pool.stage2CacheHitRate ?? 0) || 0,
    lastStage2DuplicateSkipCount:
      Number(pool.stage2DuplicateSkipCount ?? 0) || 0,
    lastChampionVsDiscoveryPassShare: championVsDiscoveryPassShare,
  }
}

const EXPLORATION_PROFILES = Object.freeze([
  {
    id: "balanced",
    shardsFactor: 1.0,
    topFactor: 1.0,
    roundsFactor: 1.0,
    seedOffset: 0,
  },
  {
    id: "symbol_wide",
    shardsFactor: 1.25,
    topFactor: 0.82,
    roundsFactor: 0.98,
    seedOffset: 173,
  },
  {
    id: "pattern_deep",
    shardsFactor: 0.84,
    topFactor: 1.22,
    roundsFactor: 0.98,
    seedOffset: 349,
  },
  {
    id: "round_deep",
    shardsFactor: 0.9,
    topFactor: 0.9,
    roundsFactor: 1.22,
    seedOffset: 521,
  },
  {
    id: "moonshot_focus",
    shardsFactor: 1.08,
    topFactor: 1.08,
    roundsFactor: 1.12,
    seedOffset: 733,
  },
])

const PROFILE_STATS_STORE_VERSION = "autosearch_profile_stats_v1"

const normalizeProfileStatsStore = ({
  raw,
  profiles = EXPLORATION_PROFILES,
} = {}) => {
  const source = raw && typeof raw === "object" ? raw : {}
  const profilesSrc =
    source.profiles && typeof source.profiles === "object"
      ? source.profiles
      : {}
  const normalizedProfiles = {}
  let attemptsTotal = 0
  for (const profile of profiles) {
    const profileId = String(profile?.id ?? "").trim()
    if (!profileId) continue
    const row =
      profilesSrc[profileId] && typeof profilesSrc[profileId] === "object"
        ? profilesSrc[profileId]
        : {}
    const attempts = Math.max(
      0,
      Math.floor(Number(row.attempts ?? row.total ?? 0) || 0),
    )
    const rewardSum = Number(row.rewardSum ?? 0) || 0
    const successes = Math.max(0, Math.floor(Number(row.successes ?? 0) || 0))
    const stage2Entered = Math.max(
      0,
      Math.floor(Number(row.stage2Entered ?? 0) || 0),
    )
    const passFinal = Math.max(0, Math.floor(Number(row.passFinal ?? 0) || 0))
    const qualityFails = Math.max(
      0,
      Math.floor(Number(row.qualityFails ?? 0) || 0),
    )
    const structuralFails = Math.max(
      0,
      Math.floor(Number(row.structuralFails ?? 0) || 0),
    )
    const transientFails = Math.max(
      0,
      Math.floor(Number(row.transientFails ?? 0) || 0),
    )
    const securityFails = Math.max(
      0,
      Math.floor(Number(row.securityFails ?? 0) || 0),
    )
    attemptsTotal += attempts
    normalizedProfiles[profileId] = {
      attempts,
      rewardSum,
      rewardMean: attempts > 0 ? rewardSum / attempts : 0,
      successes,
      stage2Entered,
      passFinal,
      qualityFails,
      structuralFails,
      transientFails,
      securityFails,
      lastUsedAt: String(row.lastUsedAt ?? "").trim() || null,
    }
  }
  return {
    version: PROFILE_STATS_STORE_VERSION,
    updatedAt: String(source.updatedAt ?? "").trim() || null,
    totalAttempts: Math.max(
      attemptsTotal,
      Math.floor(Number(source.totalAttempts ?? 0) || 0),
    ),
    profiles: normalizedProfiles,
  }
}

const scoreExplorationProfileBandit = ({
  profileId,
  profileStatsStore,
  tuning,
  moonshotPressure,
  bucketIndex,
  laneIndex,
  cursor,
}) => {
  const store = normalizeProfileStatsStore({
    raw: profileStatsStore,
    profiles: EXPLORATION_PROFILES,
  })
  const row =
    store?.profiles && typeof store.profiles === "object"
      ? (store.profiles[profileId] ?? {})
      : {}
  const attempts = Math.max(0, Math.floor(Number(row.attempts ?? 0) || 0))
  const rewardSum = Number(row.rewardSum ?? 0) || 0
  const totalAttempts = Math.max(
    1,
    Math.floor(Number(store.totalAttempts ?? 0) || 0),
  )
  const priorMean = clampNumber(tuning?.explorationBanditPriorMean, 0.25, -5, 5)
  const priorWeight = Math.max(
    0,
    Math.floor(Number(tuning?.explorationBanditPriorWeight ?? 2) || 0),
  )
  const ucbC = clampNumber(tuning?.explorationBanditUcbC, 0.75, 0.05, 4)
  const posteriorMean =
    (rewardSum + priorMean * priorWeight) / (attempts + priorWeight || 1)
  const uncertainty = Math.sqrt(Math.log(totalAttempts + 1) / (attempts + 1))
  let score = posteriorMean + ucbC * uncertainty
  if (moonshotPressure && profileId === "moonshot_focus") {
    score += 0.08
  }
  // Keep broad coverage while scores are close.
  if ((bucketIndex + laneIndex + cursor + attempts) % 3 === 0) {
    score += 0.01
  }
  return {
    attempts,
    rewardSum,
    posteriorMean,
    uncertainty,
    score,
  }
}

const resolveRuntimeBudgetBias = ({ tuning, profileDecision }) => {
  const enabled = tuning?.runtimeBudgetBiasEnabled !== false
  if (!enabled) {
    return {
      roundsMultiplier: 1,
      rescueMultiplier: 1,
      reason: "DISABLED",
      attempts: 0,
      posteriorMean: 0,
    }
  }
  const minBias = clampNumber(tuning?.runtimeBudgetBiasMin, 0.75, 0.4, 1)
  const maxBias = clampNumber(tuning?.runtimeBudgetBiasMax, 1.2, 1, 2)
  const bandit = profileDecision?.bandit ?? null
  if (!bandit) {
    return {
      roundsMultiplier: 1,
      rescueMultiplier: 1,
      reason: "NO_BANDIT_SIGNAL",
      attempts: 0,
      posteriorMean: 0,
    }
  }
  const attempts = Math.max(0, Math.floor(Number(bandit.attempts ?? 0) || 0))
  const posteriorMean = Number(bandit.posteriorMean ?? 0) || 0
  const minSamples = Math.max(
    1,
    Math.floor(Number(tuning?.explorationBanditMinSamples ?? 3) || 1),
  )
  let roundsMultiplier = 1
  let reason = "STABLE"
  if (attempts < minSamples) {
    roundsMultiplier = Math.max(minBias, 0.88)
    reason = "LOW_SAMPLE_EXPLORE_CHEAP"
  } else if (posteriorMean >= 0.85) {
    roundsMultiplier = Math.min(maxBias, 1.12)
    reason = "HIGH_CONFIDENCE_DEEPEN"
  } else if (posteriorMean >= 0.6) {
    roundsMultiplier = Math.min(maxBias, 1.03)
    reason = "MEDIUM_CONFIDENCE_STABLE"
  } else if (posteriorMean <= 0.25) {
    roundsMultiplier = Math.max(minBias, 0.82)
    reason = "LOW_CONFIDENCE_CHEAPEN"
  }
  const rescueMultiplier = Math.max(
    minBias,
    Math.min(
      maxBias,
      roundsMultiplier <= 1 ? roundsMultiplier : roundsMultiplier + 0.04,
    ),
  )
  return {
    roundsMultiplier,
    rescueMultiplier,
    reason,
    attempts,
    posteriorMean,
  }
}

const scoreProfileAttemptReward = ({
  observability,
  failureClass,
  resultStatus,
}) => {
  const funnel =
    observability && typeof observability === "object"
      ? observability.funnel
      : {}
  const runtime =
    observability && typeof observability === "object"
      ? observability.runtime
      : {}
  let reward = 0
  if ((Number(funnel?.signalsLoaded ?? 0) || 0) > 0) reward += 0.05
  if ((Number(funnel?.stage1Candidates ?? 0) || 0) > 0) reward += 0.15
  if ((Number(funnel?.stage1PassCount ?? 0) || 0) > 0) reward += 0.3
  if ((Number(funnel?.rescuePromoted ?? 0) || 0) > 0) reward += 0.15
  if ((Number(funnel?.stage2Entered ?? 0) || 0) > 0) reward += 0.45
  if ((Number(funnel?.passFinalCount ?? 0) || 0) > 0) reward += 0.7
  if (
    String(resultStatus ?? "")
      .trim()
      .toUpperCase()
      .startsWith("SUCCESS")
  ) {
    reward += 0.8
  }
  if (failureClass === "QUALITY") reward -= 0.2
  if (failureClass === "STRUCTURAL") reward -= 0.45
  if (failureClass === "SECURITY") reward -= 0.6
  const durationMs = Number(runtime?.totalDurationMs ?? 0) || 0
  if (durationMs > 0) {
    const runtimePenalty = Math.min(0.25, durationMs / (2 * 60 * 60 * 1000))
    reward -= runtimePenalty
  }
  return clampNumber(reward, 0, -1.5, 3.5)
}

const updateProfileStatsStoreOnAttempt = ({
  store,
  profileId,
  observability,
  failureClass,
  resultStatus,
}) => {
  const id = String(profileId ?? "").trim()
  if (!id) return normalizeProfileStatsStore({ raw: store })
  const normalized = normalizeProfileStatsStore({
    raw: store,
    profiles: EXPLORATION_PROFILES,
  })
  const next = {
    ...normalized,
    profiles: {
      ...normalized.profiles,
    },
  }
  const prevRow =
    next.profiles[id] && typeof next.profiles[id] === "object"
      ? next.profiles[id]
      : {
          attempts: 0,
          rewardSum: 0,
          rewardMean: 0,
          successes: 0,
          stage2Entered: 0,
          passFinal: 0,
          qualityFails: 0,
          structuralFails: 0,
          transientFails: 0,
          securityFails: 0,
          lastUsedAt: null,
        }
  const reward = scoreProfileAttemptReward({
    observability,
    failureClass,
    resultStatus,
  })
  const attempts = Math.max(0, Number(prevRow.attempts ?? 0) || 0) + 1
  const rewardSum = (Number(prevRow.rewardSum ?? 0) || 0) + reward
  const funnel =
    observability && typeof observability === "object"
      ? observability.funnel
      : {}
  const classKey =
    failureClass === "QUALITY"
      ? "qualityFails"
      : failureClass === "STRUCTURAL"
        ? "structuralFails"
        : failureClass === "SECURITY"
          ? "securityFails"
          : "transientFails"
  next.profiles[id] = {
    ...prevRow,
    attempts,
    rewardSum,
    rewardMean: rewardSum / attempts,
    successes:
      (Number(prevRow.successes ?? 0) || 0) +
      (String(resultStatus ?? "")
        .trim()
        .toUpperCase()
        .startsWith("SUCCESS")
        ? 1
        : 0),
    stage2Entered:
      (Number(prevRow.stage2Entered ?? 0) || 0) +
      ((Number(funnel?.stage2Entered ?? 0) || 0) > 0 ? 1 : 0),
    passFinal:
      (Number(prevRow.passFinal ?? 0) || 0) +
      ((Number(funnel?.passFinalCount ?? 0) || 0) > 0 ? 1 : 0),
    qualityFails: Number(prevRow.qualityFails ?? 0) || 0,
    structuralFails: Number(prevRow.structuralFails ?? 0) || 0,
    transientFails: Number(prevRow.transientFails ?? 0) || 0,
    securityFails: Number(prevRow.securityFails ?? 0) || 0,
    lastUsedAt: isoNow(),
  }
  next.profiles[id][classKey] =
    (Number(next.profiles[id][classKey] ?? 0) || 0) + (failureClass ? 1 : 0)
  next.updatedAt = isoNow()
  next.totalAttempts = Math.floor(
    Math.max(0, Number(normalized.totalAttempts ?? 0) || 0) + 1,
  )
  return next
}

const resolveExplorationProfile = ({
  attempt,
  sameFailureStreak,
  sameFailureSignatureStreak,
  coveragePlan,
  failureCode,
  failureDetail,
  profileStatsStore,
  tuning,
}) => {
  const profileCount = EXPLORATION_PROFILES.length
  const bucketIndex = Math.max(0, Number(coveragePlan?.bucketIndex ?? 0) || 0)
  const laneIndex = Math.max(0, Number(coveragePlan?.laneIndex ?? 0) || 0)
  const cursor = Math.max(0, Number(coveragePlan?.cursor ?? attempt - 1) || 0)
  const normalizedBaseIndex =
    Math.abs(
      attempt -
        1 +
        bucketIndex * 2 +
        laneIndex * 3 +
        Math.max(0, sameFailureStreak - 1) * 2 +
        Math.max(0, sameFailureSignatureStreak - 1),
    ) % profileCount
  const code = String(failureCode ?? "")
    .trim()
    .toUpperCase()
  const detail = String(failureDetail ?? "")
    .trim()
    .toUpperCase()
  const insufficientPoolPressure = isInsufficientPoolFailureCode(code)
  const moonshotPressure =
    code === "MOONSHOT_GATE_FAIL" ||
    detail.includes("MOONSHOT_GATE_FAILED") ||
    detail.includes("MOONSHOT")
  const moonshotProfileIndex = EXPLORATION_PROFILES.findIndex(
    (profile) => profile.id === "moonshot_focus",
  )
  const symbolWideProfileIndex = EXPLORATION_PROFILES.findIndex(
    (profile) => profile.id === "symbol_wide",
  )
  const balancedProfileIndex = EXPLORATION_PROFILES.findIndex(
    (profile) => profile.id === "balanced",
  )
  const patternDeepProfileIndex = EXPLORATION_PROFILES.findIndex(
    (profile) => profile.id === "pattern_deep",
  )
  const trackZeroPassPressure =
    code === "WORST2W_TRACK_ZERO_PASS" || detail.includes("TRACK_ZERO_PASS:")
  const avoidMoonshotFocus =
    !moonshotPressure &&
    (code === "WORST2W_BELOW_THRESHOLD" ||
      insufficientPoolPressure ||
      trackZeroPassPressure)
  const preferQualityProfile =
    (code === "WORST2W_BELOW_THRESHOLD" ||
      trackZeroPassPressure ||
      (insufficientPoolPressure && sameFailureStreak >= 2)) &&
    sameFailureStreak >= 1
  const preferSymbolWideProfile =
    insufficientPoolPressure &&
    !trackZeroPassPressure &&
    (sameFailureStreak >= 1 || sameFailureSignatureStreak >= 1)
  const remapMoonshotProfile = (decision, sourceSuffix) => {
    if (!decision?.profile) return decision
    if (!avoidMoonshotFocus) return decision
    if (decision.profile.id !== "moonshot_focus") return decision
    if (symbolWideProfileIndex < 0) return decision
    return {
      ...decision,
      profile: EXPLORATION_PROFILES[symbolWideProfileIndex],
      modeIndex: symbolWideProfileIndex,
      modeSource: String(decision.modeSource ?? "profile") + "_" + sourceSuffix,
    }
  }
  const promoteSymbolWideProfile = (decision, sourceSuffix) => {
    if (!decision?.profile) return decision
    if (!preferSymbolWideProfile) return decision
    if (decision.profile.id === "symbol_wide") return decision
    if (symbolWideProfileIndex < 0) return decision
    return {
      ...decision,
      profile: EXPLORATION_PROFILES[symbolWideProfileIndex],
      modeIndex: symbolWideProfileIndex,
      modeSource: String(decision.modeSource ?? "profile") + "_" + sourceSuffix,
    }
  }
  const promoteQualityProfile = (decision, sourceSuffix) => {
    if (!decision?.profile) return decision
    if (!preferQualityProfile) return decision
    const preferredIndex =
      trackZeroPassPressure && balancedProfileIndex >= 0
        ? balancedProfileIndex
        : patternDeepProfileIndex
    if (preferredIndex < 0) return decision
    if (decision.profile.id === EXPLORATION_PROFILES[preferredIndex]?.id)
      return decision
    return {
      ...decision,
      profile: EXPLORATION_PROFILES[preferredIndex],
      modeIndex: preferredIndex,
      modeSource: String(decision.modeSource ?? "profile") + "_" + sourceSuffix,
    }
  }
  let fallbackDecision = null
  if (
    moonshotPressure &&
    moonshotProfileIndex >= 0 &&
    sameFailureStreak >= 1 &&
    (attempt + bucketIndex + laneIndex) % 2 === 0
  ) {
    fallbackDecision = {
      profile: EXPLORATION_PROFILES[moonshotProfileIndex],
      modeIndex: moonshotProfileIndex,
      modeSource: "moonshot_pressure",
      normalizedBaseIndex,
      bandit: null,
    }
  } else if (sameFailureSignatureStreak >= 3) {
    const rotateBase = Math.max(1, profileCount - 1)
    const step = 1 + ((bucketIndex + laneIndex + cursor) % rotateBase)
    const modeIndex = (normalizedBaseIndex + step) % profileCount
    fallbackDecision = {
      profile: EXPLORATION_PROFILES[modeIndex],
      modeIndex,
      modeSource: "signature_rotation",
      normalizedBaseIndex,
      bandit: null,
    }
  } else {
    fallbackDecision = {
      profile: EXPLORATION_PROFILES[normalizedBaseIndex],
      modeIndex: normalizedBaseIndex,
      modeSource: "base_cycle",
      normalizedBaseIndex,
      bandit: null,
    }
  }

  fallbackDecision = remapMoonshotProfile(fallbackDecision, "avoid_moonshot")
  fallbackDecision = promoteSymbolWideProfile(
    fallbackDecision,
    "track_zero_pass_wide",
  )
  fallbackDecision = promoteQualityProfile(fallbackDecision, "quality_bias")

  const banditEnabled = tuning?.explorationBanditEnabled !== false
  if (!banditEnabled || attempt < 2) {
    return fallbackDecision
  }
  const banditRows = EXPLORATION_PROFILES.map((profile, idx) => {
    const bandit = scoreExplorationProfileBandit({
      profileId: profile.id,
      profileStatsStore,
      tuning,
      moonshotPressure,
      bucketIndex,
      laneIndex,
      cursor,
    })
    return {
      profile,
      modeIndex: idx,
      bandit,
    }
  }).sort((a, b) => {
    if (b.bandit.score !== a.bandit.score) {
      return b.bandit.score - a.bandit.score
    }
    return a.modeIndex - b.modeIndex
  })
  const best = banditRows[0]
  if (!best?.profile) {
    return fallbackDecision
  }
  const useBandit =
    sameFailureStreak >= 1 ||
    sameFailureSignatureStreak >= 2 ||
    code === "WORST2W_BELOW_THRESHOLD" ||
    isInsufficientPoolFailureCode(code) ||
    attempt >= 4
  if (!useBandit) {
    return fallbackDecision
  }
  const banditDecision = {
    profile: best.profile,
    modeIndex: best.modeIndex,
    modeSource: "bandit_ucb",
    normalizedBaseIndex,
    bandit: {
      score: best.bandit.score,
      posteriorMean: best.bandit.posteriorMean,
      uncertainty: best.bandit.uncertainty,
      attempts: best.bandit.attempts,
      totalAttempts: normalizeProfileStatsStore({
        raw: profileStatsStore,
        profiles: EXPLORATION_PROFILES,
      }).totalAttempts,
    },
  }
  return promoteQualityProfile(
    promoteSymbolWideProfile(
      remapMoonshotProfile(banditDecision, "avoid_moonshot"),
      "track_zero_pass_wide",
    ),
    "quality_bias",
  )
}

const normalizeBudget = ({
  base,
  candidate,
  scaleMin = 0.5,
  scaleMax = 1.0,
}) => {
  const baseBudget =
    Math.max(1, Number(base?.shards) || 1) *
    Math.max(1, Number(base?.topPerTrack) || 1) *
    Math.max(
      20,
      (Number(base?.stage1MaxRounds) || 10) +
        (Number(base?.stage2MaxRounds) || 10),
    )
  const candidateBudget =
    Math.max(1, Number(candidate?.shards) || 1) *
    Math.max(1, Number(candidate?.topPerTrack) || 1) *
    Math.max(
      20,
      (Number(candidate?.stage1MaxRounds) || 10) +
        (Number(candidate?.stage2MaxRounds) || 10),
    )
  if (!Number.isFinite(candidateBudget) || candidateBudget <= 0) {
    return { budgetScale: 1, roundScale: 1 }
  }
  const budgetScaleRaw = Math.max(
    scaleMin,
    Math.min(scaleMax, baseBudget / candidateBudget),
  )
  const roundScale = Math.sqrt(budgetScaleRaw)
  return { budgetScale: budgetScaleRaw, roundScale }
}

const resolveRuntimeMemoryThrottle = ({ memoryHeadroom }) => {
  const freeMb = Number(memoryHeadroom?.freeMb ?? 0) || 0
  const freeRatio = Number(memoryHeadroom?.freeRatio ?? 0) || 0
  // Soft throttles only: keep exploration active, reduce load only near pressure.
  if (freeMb <= 1500 || freeRatio <= 0.14) {
    return { level: 2, loadScale: 0.7, reason: "SOFT_PRESSURE_HIGH" }
  }
  if (freeMb <= 2200 || freeRatio <= 0.2) {
    return { level: 1, loadScale: 0.85, reason: "SOFT_PRESSURE_MEDIUM" }
  }
  return { level: 0, loadScale: 1, reason: "NORMAL" }
}

const buildFailureSignature = ({ failure, report }) => {
  const code = String(failure?.code ?? "")
    .trim()
    .toUpperCase()
  const reasons = (report?.failureLeaderboard?.top ?? [])
    .slice(0, 4)
    .map((row) =>
      String(row?.reason ?? "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean)
  const detailToken = String(failure?.detail ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_,:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160)
  return `${code}|${reasons.join(",") || detailToken || "NONE"}`
}

const resolveCoveragePlan = ({ tuning, cursor }) => {
  const bucketTotal = clampInt(tuning?.symbolBucketTotal, 8, 1, 1024)
  const stride = normalizeCoverageStride(
    bucketTotal,
    tuning?.symbolBucketStride,
  )
  const laneTotal = clampInt(tuning?.coverageSeedLanes, 4, 1, 64)
  const rawCursor = Math.floor(Number(cursor ?? 0) || 0)
  const bucketIndex = ((rawCursor % bucketTotal) + bucketTotal) % bucketTotal
  const laneIndex =
    ((Math.floor(rawCursor / bucketTotal) % laneTotal) + laneTotal) % laneTotal
  return {
    bucketTotal,
    bucketIndex,
    laneTotal,
    laneIndex,
    stride,
    cursor: rawCursor,
  }
}

const resolveNextCoverageCursor = ({
  coveragePlan,
  sameFailureStreak = 0,
  sameFailureSignatureStreak,
  failureCode = null,
  tuning,
}) => {
  const normalizedFailureCode = String(failureCode ?? "")
    .trim()
    .toUpperCase()
  const qualityStuckCode =
    isInsufficientPoolFailureCode(normalizedFailureCode) ||
    normalizedFailureCode === "MOONSHOT_GATE_FAIL" ||
    normalizedFailureCode === "MOONSHOT_OUTCOME_EMPTY" ||
    normalizedFailureCode === "SURGE_POOL_EMPTY" ||
    normalizedFailureCode === "MOONSHOT_SIGNAL_MISMATCH" ||
    normalizedFailureCode === "SIGNAL_GAP"
  let stepMultiplier = Math.max(1, sameFailureSignatureStreak >= 2 ? 2 : 1)
  if (qualityStuckCode && sameFailureStreak >= 2) {
    stepMultiplier *= 2
  }
  if (qualityStuckCode && sameFailureStreak >= 4) {
    stepMultiplier *= 2
  }
  const baseStep =
    Math.max(1, Number(coveragePlan?.stride ?? 1) || 1) * stepMultiplier
  const jumpThreshold = clampInt(
    tuning?.sameFailureSignatureJumpThreshold,
    3,
    2,
    50,
  )
  const jumpMultiplier = clampInt(
    tuning?.sameFailureSignatureCursorMultiplier,
    3,
    2,
    32,
  )
  const insufficientPoolFastJump =
    isInsufficientPoolFailureCode(normalizedFailureCode) &&
    sameFailureStreak >= 2 &&
    sameFailureSignatureStreak >= 2
  const qualityJump =
    (qualityStuckCode && sameFailureStreak >= 3) || insufficientPoolFastJump
  if (sameFailureSignatureStreak >= jumpThreshold || qualityJump) {
    const bucketBoost = Math.max(
      1,
      Math.floor((Number(coveragePlan?.bucketTotal ?? 1) || 1) / 2),
    )
    const laneBoost = Math.max(
      1,
      Math.floor((Number(coveragePlan?.laneTotal ?? 1) || 1) / 2),
    )
    const qualityBoost = qualityJump
      ? Math.max(
          Number(coveragePlan?.bucketTotal ?? 1) || 1,
          laneBoost * Math.max(1, Number(coveragePlan?.stride ?? 1) || 1),
        )
      : 0
    return (
      Number(coveragePlan?.cursor ?? 0) +
      Math.max(baseStep, jumpMultiplier * baseStep + bucketBoost + qualityBoost)
    )
  }
  return Number(coveragePlan?.cursor ?? 0) + baseStep
}

const buildRuntimeAttemptTuning = ({
  tuning,
  attempt,
  sameFailureStreak,
  sameFailureSignatureStreak,
  coveragePlan,
  memoryHeadroom,
  failureCode,
  failureDetail,
  profileStatsStore,
}) => {
  const profileDecision = resolveExplorationProfile({
    attempt,
    sameFailureStreak,
    sameFailureSignatureStreak,
    coveragePlan,
    failureCode,
    failureDetail,
    profileStatsStore,
    tuning,
  })
  const profile = profileDecision.profile
  const limits = tuning?.limits ?? {}
  const base = {
    shards: Number(tuning?.shards ?? 4) || 4,
    topPerTrack: Number(tuning?.topPerTrack ?? 24) || 24,
    stage1MaxRounds: Number(tuning?.stage1MaxRounds ?? 60) || 60,
    stage2MaxRounds: Number(tuning?.stage2MaxRounds ?? 160) || 160,
  }
  const raw = {
    shards: base.shards * profile.shardsFactor,
    topPerTrack: base.topPerTrack * profile.topFactor,
    stage1MaxRounds: base.stage1MaxRounds * profile.roundsFactor,
    stage2MaxRounds: base.stage2MaxRounds * profile.roundsFactor,
  }
  const memoryThrottle = resolveRuntimeMemoryThrottle({ memoryHeadroom })
  const budgetBias = resolveRuntimeBudgetBias({ tuning, profileDecision })
  const scaleMax = Math.max(
    0.55,
    Math.min(1, Number(memoryThrottle.loadScale) || 1),
  )
  const { roundScale } = normalizeBudget({
    base,
    candidate: raw,
    scaleMin: scaleMax,
    scaleMax,
  })

  const runtimeShards = clampInt(
    raw.shards,
    base.shards,
    Math.max(1, Number(limits.minShards ?? 1) || 1),
    Math.max(1, Number(limits.maxShards ?? 64) || 64),
  )
  let runtimeTopPerTrack = clampInt(
    raw.topPerTrack * roundScale,
    base.topPerTrack,
    Math.max(1, Number(limits.minTopPerTrack ?? 1) || 1),
    Math.max(1, Number(limits.maxTopPerTrack ?? 1000) || 1000),
  )
  const previousPassDensity = clampNumber(tuning?.previousPassDensity, 0, 0, 1)
  const previousTerminalRatio = clampNumber(
    tuning?.previousTerminalRatio,
    1,
    0,
    1,
  )
  const adaptivePoolTuningMode =
    tuning?.poolExpandEnabled === false
      ? "DISABLED"
      : previousPassDensity >=
            clampNumber(tuning?.poolExpandMinPassDensity, 0.02, 0, 1) &&
          previousTerminalRatio <=
            clampNumber(tuning?.poolExpandMaxTerminalRatio, 0.8, 0, 1)
        ? "EXPAND"
        : previousTerminalRatio >
              clampNumber(tuning?.poolExpandMaxTerminalRatio, 0.8, 0, 1) ||
            previousPassDensity <
              clampNumber(tuning?.poolExpandMinPassDensity, 0.02, 0, 1) * 0.5
          ? "SHRINK"
          : "STABLE"
  const runtimeStage2TopKByTrack = {
    SURGE_EOD: Math.max(
      1,
      Number(tuning?.stage2TopKByTrack?.SURGE_EOD ?? 4) || 4,
    ),
    GAP_15_BET: Math.max(
      1,
      Number(tuning?.stage2TopKByTrack?.GAP_15_BET ?? 3) || 3,
    ),
    MOONSHOT: Math.max(
      1,
      Number(tuning?.stage2TopKByTrack?.MOONSHOT ?? 2) || 2,
    ),
  }
  const trackIntOr = (map, track, fallback, min = 1) =>
    Math.max(min, Number(map?.[track] ?? fallback) || fallback)
  const runtimeDailyPassTopNByTrack = {
    SURGE_EOD: trackIntOr(tuning?.dailyPassTopNByTrack, "SURGE_EOD", 48, 1),
    GAP_15_BET: trackIntOr(tuning?.dailyPassTopNByTrack, "GAP_15_BET", 32, 1),
    MOONSHOT: trackIntOr(tuning?.dailyPassTopNByTrack, "MOONSHOT", 24, 1),
  }
  const runtimeDailyPassPoolsetCountByTrack = {
    SURGE_EOD: trackIntOr(
      tuning?.dailyPassPoolsetCountByTrack,
      "SURGE_EOD",
      2,
      1,
    ),
    GAP_15_BET: trackIntOr(
      tuning?.dailyPassPoolsetCountByTrack,
      "GAP_15_BET",
      2,
      1,
    ),
    MOONSHOT: trackIntOr(
      tuning?.dailyPassPoolsetCountByTrack,
      "MOONSHOT",
      1,
      1,
    ),
  }
  const runtimePoolsetCountByTrack = {
    SURGE_EOD: trackIntOr(tuning?.poolsetCountByTrack, "SURGE_EOD", 6, 1),
    GAP_15_BET: trackIntOr(tuning?.poolsetCountByTrack, "GAP_15_BET", 4, 1),
    MOONSHOT: trackIntOr(tuning?.poolsetCountByTrack, "MOONSHOT", 4, 1),
  }
  const poolsetCountMaxByTrack = {
    SURGE_EOD: trackIntOr(tuning?.poolsetCountMaxByTrack, "SURGE_EOD", 12, 1),
    GAP_15_BET: trackIntOr(tuning?.poolsetCountMaxByTrack, "GAP_15_BET", 8, 1),
    MOONSHOT: trackIntOr(tuning?.poolsetCountMaxByTrack, "MOONSHOT", 8, 1),
  }
  const splitSource =
    tuning?.championDiscoveryBudgetSplit &&
    typeof tuning.championDiscoveryBudgetSplit === "object"
      ? tuning.championDiscoveryBudgetSplit
      : null
  const splitChampionRaw = Number(splitSource?.champion ?? 0.4)
  const splitDiscoveryRaw = Number(splitSource?.discovery ?? 0.6)
  const splitChampion = Number.isFinite(splitChampionRaw)
    ? Math.max(0.01, splitChampionRaw)
    : 0.4
  const splitDiscovery = Number.isFinite(splitDiscoveryRaw)
    ? Math.max(0.01, splitDiscoveryRaw)
    : 0.6
  const splitTotal = splitChampion + splitDiscovery
  let runtimeChampionDiscoveryBudgetSplit =
    splitTotal > 0
      ? {
          champion: splitChampion / splitTotal,
          discovery: splitDiscovery / splitTotal,
        }
      : { champion: 0.4, discovery: 0.6 }
  const adaptivePoolExpandStep = Math.max(
    1,
    Number(tuning?.poolExpandStepTopPerTrack ?? 12) || 12,
  )
  const adaptivePoolExpandCapTopK = Math.max(
    1,
    Number(tuning?.poolExpandCapStage2TopK ?? 12) || 12,
  )
  if (adaptivePoolTuningMode === "EXPAND") {
    for (const track of Object.keys(runtimeStage2TopKByTrack)) {
      runtimeStage2TopKByTrack[track] = Math.max(
        1,
        Math.min(
          adaptivePoolExpandCapTopK,
          Number(runtimeStage2TopKByTrack[track] || 1) + 1,
        ),
      )
    }
    runtimeTopPerTrack = Math.max(
      runtimeTopPerTrack,
      Math.min(
        Math.max(1, Number(limits.maxTopPerTrack ?? 1000) || 1000),
        Number(tuning?.topPerTrack ?? runtimeTopPerTrack) +
          adaptivePoolExpandStep,
      ),
    )
  } else if (adaptivePoolTuningMode === "SHRINK") {
    for (const track of Object.keys(runtimeStage2TopKByTrack)) {
      runtimeStage2TopKByTrack[track] = Math.max(
        1,
        Number(runtimeStage2TopKByTrack[track] || 1) - 1,
      )
    }
  }
  const executionLane =
    String(tuning?.executionLane ?? "server")
      .trim()
      .toLowerCase() === "codex_cloud"
      ? "codex_cloud"
      : "server"
  const runtimeLowRamHardCap =
    executionLane !== "codex_cloud" &&
    ((Number(tuning?.maxParallelShards ?? 2) || 2) <= 2 ||
      (Number(tuning?.minFreeMbForParallelShards ?? 2200) || 2200) >= 1800)
  const lowRamStage1HardCap = 180
  const lowRamStage2HardCap = 240
  const lowRamRescueTopKHardCap = 96
  const lowRamRescueDeepTopKHardCap = 128
  const runtimeStage1UpperBound = runtimeLowRamHardCap
    ? Math.max(10, Math.min(base.stage1MaxRounds, lowRamStage1HardCap))
    : Math.max(10, Number(limits.maxStage1MaxRounds ?? 10000) || 10000)
  const runtimeStage2UpperBound = runtimeLowRamHardCap
    ? Math.max(10, Math.min(base.stage2MaxRounds, lowRamStage2HardCap))
    : Math.max(10, Number(limits.maxStage2MaxRounds ?? 10000) || 10000)
  const runtimeStage1 = clampInt(
    raw.stage1MaxRounds *
      roundScale *
      (Number(budgetBias.roundsMultiplier ?? 1) || 1),
    base.stage1MaxRounds,
    10,
    runtimeStage1UpperBound,
  )
  const runtimeStage2 = clampInt(
    raw.stage2MaxRounds *
      roundScale *
      (Number(budgetBias.roundsMultiplier ?? 1) || 1),
    base.stage2MaxRounds,
    10,
    runtimeStage2UpperBound,
  )
  const rescueScaleRaw =
    memoryThrottle.level >= 2 ? 0.35 : memoryThrottle.level >= 1 ? 0.6 : 1
  const rescueScale =
    rescueScaleRaw * (Number(budgetBias.rescueMultiplier ?? 1) || 1)
  const rescueTopKBase = Number(tuning?.rescueTopK ?? 20) || 20
  const rescueCheapBBase = Number(tuning?.rescueCheapB ?? 300) || 300
  const rescueCheapMBase = Number(tuning?.rescueCheapM ?? 50) || 50
  const rescueDeepTopKBase =
    Number(tuning?.rescueDeepTopK ?? rescueTopKBase) || rescueTopKBase
  const rescueDeepBBase = Number(tuning?.rescueDeepB ?? 600) || 600
  const rescueDeepMBase = Number(tuning?.rescueDeepM ?? 80) || 80
  const rescueTopKUpperBound = runtimeLowRamHardCap
    ? Math.min(rescueTopKBase, lowRamRescueTopKHardCap)
    : 1024
  const rescueCheapBUpperBound = runtimeLowRamHardCap ? rescueCheapBBase : 6000
  const rescueCheapMUpperBound = runtimeLowRamHardCap ? rescueCheapMBase : 512
  const rescueDeepTopKUpperBound = runtimeLowRamHardCap
    ? Math.min(rescueDeepTopKBase, lowRamRescueDeepTopKHardCap)
    : 1024
  const rescueDeepBUpperBound = runtimeLowRamHardCap ? rescueDeepBBase : 12000
  const rescueDeepMUpperBound = runtimeLowRamHardCap ? rescueDeepMBase : 1024
  const runtimeRescueTopK = clampInt(
    rescueTopKBase * rescueScale,
    rescueTopKBase,
    1,
    rescueTopKUpperBound,
  )
  const runtimeRescueCheapB = clampInt(
    rescueCheapBBase * rescueScale,
    rescueCheapBBase,
    20,
    rescueCheapBUpperBound,
  )
  const runtimeRescueCheapM = clampInt(
    rescueCheapMBase * rescueScale,
    rescueCheapMBase,
    1,
    rescueCheapMUpperBound,
  )
  const runtimeRescueDeepTopK = clampInt(
    rescueDeepTopKBase * rescueScale,
    rescueDeepTopKBase,
    1,
    rescueDeepTopKUpperBound,
  )
  const runtimeRescueDeepB = clampInt(
    rescueDeepBBase * rescueScale,
    rescueDeepBBase,
    20,
    rescueDeepBUpperBound,
  )
  const runtimeRescueDeepM = clampInt(
    rescueDeepMBase * rescueScale,
    rescueDeepMBase,
    1,
    rescueDeepMUpperBound,
  )

  const runtimeSeedOffset =
    profile.seedOffset +
    Math.max(0, Number(coveragePlan?.bucketIndex ?? 0) || 0) * 131 +
    Math.max(0, sameFailureStreak - 1) * 29 +
    Math.max(0, sameFailureSignatureStreak - 1) * 53 +
    Math.max(0, Number(coveragePlan?.laneIndex ?? 0) || 0) * 97
  const laneTag = Math.max(0, Number(coveragePlan?.laneIndex ?? 0) || 0)
  const bucketTag = Math.max(0, Number(coveragePlan?.bucketIndex ?? 0) || 0)
  const runtimeSeedTag = `${profile.id}:sf${Math.max(0, sameFailureStreak)}:sg${Math.max(
    0,
    sameFailureSignatureStreak,
  )}:ln${laneTag}:bk${bucketTag}`
  const normalizedFailureCode = String(failureCode ?? "")
    .trim()
    .toUpperCase()
  const normalizedFailureDetail = String(failureDetail ?? "")
    .trim()
    .toUpperCase()
  const trackZeroPassPressure =
    normalizedFailureCode === "WORST2W_TRACK_ZERO_PASS" ||
    normalizedFailureDetail.includes("TRACK_ZERO_PASS:")
  const zeroPassStreak = Math.max(
    0,
    Math.floor(Number(sameFailureStreak ?? 0) || 0),
  )
  const minTopPerTrack = Math.max(1, Number(limits.minTopPerTrack ?? 1) || 1)
  const maxTopPerTrack = Math.max(
    minTopPerTrack,
    Number(limits.maxTopPerTrack ?? 1000) || 1000,
  )
  const trackZeroPassTopPerTrackFloor =
    zeroPassStreak >= 3 ? 140 : zeroPassStreak >= 2 ? 132 : 120
  if (trackZeroPassPressure) {
    runtimeTopPerTrack = Math.max(
      minTopPerTrack,
      Math.min(
        maxTopPerTrack,
        Math.max(runtimeTopPerTrack, trackZeroPassTopPerTrackFloor),
      ),
    )
  }
  const runtimePrefilterWorst2wBufferBase = Math.max(
    14,
    Math.min(24, Number(tuning.prefilterWorst2wBuffer ?? 4) || 4),
  )
  const runtimePrefilterStopLikeCeilBase = Math.max(
    0.74,
    Math.min(0.99, Number(tuning.prefilterStopLikeCeil ?? 0.9) || 0.9),
  )
  const runtimePrefilterNoFillCeilBase = Math.max(
    0.86,
    Math.min(0.999, Number(tuning.prefilterNoFillCeil ?? 0.95) || 0.95),
  )
  const trackZeroPassWorst2wBufferFloor = Math.max(
    2,
    Math.min(
      24,
      Number(tuning.trackZeroPassPrefilterWorst2wBufferFloor ?? 14) || 14,
    ),
  )
  const trackZeroPassStopLikeCeilFloor = Math.max(
    0.72,
    Math.min(
      0.98,
      Number(tuning.trackZeroPassPrefilterStopLikeCeilFloor ?? 0.78) || 0.78,
    ),
  )
  const trackZeroPassNoFillCeilFloor = Math.max(
    0.84,
    Math.min(
      0.99,
      Number(tuning.trackZeroPassPrefilterNoFillCeilFloor ?? 0.9) || 0.9,
    ),
  )
  const stagedWorst2wBufferFloor = trackZeroPassPressure
    ? zeroPassStreak >= 3
      ? Math.max(trackZeroPassWorst2wBufferFloor, 18)
      : zeroPassStreak >= 2
        ? Math.max(trackZeroPassWorst2wBufferFloor, 16)
        : trackZeroPassWorst2wBufferFloor
    : trackZeroPassWorst2wBufferFloor
  const runtimePrefilterWorst2wBuffer = trackZeroPassPressure
    ? Math.max(runtimePrefilterWorst2wBufferBase, stagedWorst2wBufferFloor)
    : runtimePrefilterWorst2wBufferBase
  const runtimePrefilterStopLikeCeil = trackZeroPassPressure
    ? Math.max(runtimePrefilterStopLikeCeilBase, trackZeroPassStopLikeCeilFloor)
    : runtimePrefilterStopLikeCeilBase
  const runtimePrefilterNoFillCeil = trackZeroPassPressure
    ? Math.max(runtimePrefilterNoFillCeilBase, trackZeroPassNoFillCeilFloor)
    : runtimePrefilterNoFillCeilBase
  const runtimeRescueTopKFinal = trackZeroPassPressure
    ? Math.max(runtimeRescueTopK, Math.min(runtimeTopPerTrack, 128))
    : runtimeRescueTopK
  const runtimeRescueDeepTopKFinal = trackZeroPassPressure
    ? Math.max(runtimeRescueDeepTopK, Math.min(runtimeTopPerTrack, 128))
    : runtimeRescueDeepTopK
  const runtimeRescueAllowRequiredTrackEarlyExit = trackZeroPassPressure
    ? zeroPassStreak >= 1
    : tuning.rescueAllowRequiredTrackEarlyExit !== false
  const zeroPassHasSurge = normalizedFailureDetail.includes("SURGE_EOD")
  const zeroPassHasGap = normalizedFailureDetail.includes("GAP_15_BET")
  let runtimeMinWorst2wPassPerTrackSurge =
    trackZeroPassPressure && zeroPassHasSurge
      ? 0
      : Math.max(0, Number(tuning.minWorst2wPassPerTrackSurge ?? 1) || 1)
  let runtimeMinWorst2wPassPerTrackGap =
    trackZeroPassPressure && zeroPassHasGap
      ? 0
      : Math.max(0, Number(tuning.minWorst2wPassPerTrackGap ?? 1) || 1)
  const runtimeRescueEarlyExitNoPassMinEval = trackZeroPassPressure
    ? runtimeRescueTopKFinal
    : Math.max(48, Number(tuning.rescueEarlyExitNoPassMinEval ?? 48) || 48)
  const runtimeRescueEarlyExitNoPassMaxEval = trackZeroPassPressure
    ? runtimeRescueTopKFinal
    : Math.max(
        runtimeRescueEarlyExitNoPassMinEval,
        Number(tuning.rescueEarlyExitNoPassMaxEval ?? 64) || 64,
      )
  const qualityPressureForGapChartFallback =
    normalizedFailureCode === "WORST2W_BELOW_THRESHOLD" ||
    normalizedFailureCode === "WORST2W_TRACK_ZERO_PASS" ||
    normalizedFailureCode === "TRADE_GATE_FAIL" ||
    normalizedFailureCode === "INSUFFICIENT_POOL" ||
    normalizedFailureCode === "INSUFFICIENT_POOL_SURGE_ONLY" ||
    normalizedFailureCode === "INSUFFICIENT_POOL_GAP_ONLY" ||
    normalizedFailureCode === "SURGE_POOL_EMPTY"
  const gapChartUnsafeCooldownRounds = Math.max(
    0,
    Math.floor(Number(tuning.gapChartUnsafeCooldownRounds ?? 6) || 6),
  )
  const gapChartUnsafeCooldownActive =
    qualityPressureForGapChartFallback &&
    normalizedFailureDetail.includes("GAP_15_BET") &&
    zeroPassStreak > 0 &&
    zeroPassStreak <= gapChartUnsafeCooldownRounds
  const forceAllowUnsafeGapChartFallbackStage1 = toBoolean(
    tuning.allowUnsafeGapChartFallbackStage1,
  )
  const runtimeAllowUnsafeGapChartFallbackStage1 =
    forceAllowUnsafeGapChartFallbackStage1 ||
    // When quality is collapsing, allow chart fallback immediately so
    // quota recovery does not wait on long repeated failure streaks.
    (!gapChartUnsafeCooldownActive &&
      qualityPressureForGapChartFallback &&
      (zeroPassStreak >= 1 ||
        normalizedFailureCode === "WORST2W_TRACK_ZERO_PASS" ||
        normalizedFailureCode === "INSUFFICIENT_POOL" ||
        normalizedFailureCode === "INSUFFICIENT_POOL_SURGE_ONLY" ||
        normalizedFailureCode === "INSUFFICIENT_POOL_GAP_ONLY" ||
        normalizedFailureCode === "SURGE_POOL_EMPTY"))
  const moonshotPatternMissingCooldownRounds = Math.max(
    0,
    Math.floor(Number(tuning.moonshotPatternMissingCooldownRounds ?? 12) || 12),
  )
  const moonshotPatternMissingPressure =
    normalizedFailureCode === "MOONSHOT_GATE_FAIL" ||
    normalizedFailureCode === "MOONSHOT_OUTCOME_EMPTY" ||
    normalizedFailureCode === "MOONSHOT_SIGNAL_MISMATCH" ||
    normalizedFailureDetail.includes("PATTERN_MISSING") ||
    normalizedFailureDetail.includes("MOONSHOT")
  const moonshotPatternMissingCooldownActive =
    moonshotPatternMissingPressure &&
    zeroPassStreak > 0 &&
    zeroPassStreak <= moonshotPatternMissingCooldownRounds
  if (moonshotPatternMissingCooldownActive) {
    runtimeStage2TopKByTrack.MOONSHOT = 1
    runtimeDailyPassPoolsetCountByTrack.MOONSHOT = 1
    runtimeDailyPassTopNByTrack.MOONSHOT = Math.max(
      8,
      Math.min(runtimeDailyPassTopNByTrack.MOONSHOT, 16),
    )
    runtimePoolsetCountByTrack.MOONSHOT = Math.max(
      1,
      Math.min(
        runtimePoolsetCountByTrack.MOONSHOT,
        Number(tuning?.poolsetMinAliveByTrack?.MOONSHOT ?? 1) || 1,
      ),
    )
  }

  const requiredTrackCollapse =
    normalizedFailureCode === "WORST2W_BELOW_THRESHOLD" &&
    normalizedFailureDetail.includes("WORST2W_REQUIRED_TRACKS:")
  if (requiredTrackCollapse) {
    runtimeChampionDiscoveryBudgetSplit = {
      champion: 0.25,
      discovery: 0.75,
    }
    runtimeStage2TopKByTrack.SURGE_EOD = Math.max(
      Number(runtimeStage2TopKByTrack.SURGE_EOD ?? 1) || 1,
      4,
    )
    runtimeStage2TopKByTrack.GAP_15_BET = Math.max(
      Number(runtimeStage2TopKByTrack.GAP_15_BET ?? 1) || 1,
      3,
    )
    runtimeStage2TopKByTrack.MOONSHOT = 1
    runtimePoolsetCountByTrack.SURGE_EOD = Math.min(
      poolsetCountMaxByTrack.SURGE_EOD,
      Math.max(Number(runtimePoolsetCountByTrack.SURGE_EOD ?? 1) || 1, 8),
    )
    runtimePoolsetCountByTrack.GAP_15_BET = Math.min(
      poolsetCountMaxByTrack.GAP_15_BET,
      Math.max(Number(runtimePoolsetCountByTrack.GAP_15_BET ?? 1) || 1, 6),
    )
    runtimePoolsetCountByTrack.MOONSHOT = Math.max(
      1,
      Math.min(Number(runtimePoolsetCountByTrack.MOONSHOT ?? 1) || 1, 2),
    )
    runtimeDailyPassPoolsetCountByTrack.SURGE_EOD = Math.min(
      3,
      Math.max(
        1,
        Number(runtimeDailyPassPoolsetCountByTrack.SURGE_EOD ?? 1) || 1,
      ),
    )
    runtimeDailyPassPoolsetCountByTrack.GAP_15_BET = Math.min(
      3,
      Math.max(
        1,
        Number(runtimeDailyPassPoolsetCountByTrack.GAP_15_BET ?? 1) || 1,
      ),
    )
    runtimeDailyPassPoolsetCountByTrack.MOONSHOT = 1
    runtimeDailyPassTopNByTrack.SURGE_EOD = Math.max(
      24,
      Math.min(Number(runtimeDailyPassTopNByTrack.SURGE_EOD ?? 24) || 24, 44),
    )
    runtimeDailyPassTopNByTrack.GAP_15_BET = Math.max(
      20,
      Math.min(Number(runtimeDailyPassTopNByTrack.GAP_15_BET ?? 20) || 20, 36),
    )
    runtimeDailyPassTopNByTrack.MOONSHOT = Math.max(
      8,
      Math.min(Number(runtimeDailyPassTopNByTrack.MOONSHOT ?? 8) || 8, 12),
    )
    // PoolSet-first: when required-track collapse is detected, stage1 must
    // remain selector-only and stage2 must decide final pass.
    runtimeMinWorst2wPassPerTrackSurge = 0
    runtimeMinWorst2wPassPerTrackGap = 0
  }

  const runtimeTuning = {
    ...tuning,
    shards: runtimeShards,
    topPerTrack: runtimeTopPerTrack,
    stage1MaxRounds: runtimeStage1,
    stage2MaxRounds: runtimeStage2,
    rescueTopK: runtimeRescueTopKFinal,
    rescueCheapB: runtimeRescueCheapB,
    rescueCheapM: runtimeRescueCheapM,
    rescueDeepTopK: runtimeRescueDeepTopKFinal,
    rescueDeepB: runtimeRescueDeepB,
    rescueDeepM: runtimeRescueDeepM,
    rescueAllowRequiredTrackEarlyExit: runtimeRescueAllowRequiredTrackEarlyExit,
    minWorst2wPassPerTrackSurge: runtimeMinWorst2wPassPerTrackSurge,
    minWorst2wPassPerTrackGap: runtimeMinWorst2wPassPerTrackGap,
    rescueEarlyExitNoPassMinEval: runtimeRescueEarlyExitNoPassMinEval,
    rescueEarlyExitNoPassMaxEval: runtimeRescueEarlyExitNoPassMaxEval,
    allowUnsafeGapChartFallbackStage1: runtimeAllowUnsafeGapChartFallbackStage1,
    dailyPassTopNByTrack: runtimeDailyPassTopNByTrack,
    dailyPassPoolsetCountByTrack: runtimeDailyPassPoolsetCountByTrack,
    poolsetCountByTrack: runtimePoolsetCountByTrack,
    stage2TopKByTrack: runtimeStage2TopKByTrack,
    prefilterWorst2wBuffer: runtimePrefilterWorst2wBuffer,
    prefilterStopLikeCeil: runtimePrefilterStopLikeCeil,
    prefilterNoFillCeil: runtimePrefilterNoFillCeil,
    gapChartUnsafeCooldownActive,
    moonshotPatternMissingCooldownActive,
    runtimeSeedOffset,
    runtimeSeedTag,
    championDiscoveryBudgetSplit: runtimeChampionDiscoveryBudgetSplit,
  }
  return {
    runtimeTuning,
    runtimeMeta: {
      profile: profile.id,
      modeSource: profileDecision.modeSource,
      modeIndex: profileDecision.modeIndex,
      normalizedBaseIndex: profileDecision.normalizedBaseIndex,
      bandit: profileDecision.bandit,
      budgetBias,
      memoryThrottle,
      base,
      applied: {
        shards: runtimeShards,
        topPerTrack: runtimeTopPerTrack,
        stage1MaxRounds: runtimeStage1,
        stage2MaxRounds: runtimeStage2,
        rescueScale,
        rescueTopK: runtimeRescueTopKFinal,
        rescueCheapB: runtimeRescueCheapB,
        rescueCheapM: runtimeRescueCheapM,
        rescueDeepTopK: runtimeRescueDeepTopKFinal,
        rescueDeepB: runtimeRescueDeepB,
        rescueDeepM: runtimeRescueDeepM,
        minWorst2wPassPerTrackSurge: runtimeMinWorst2wPassPerTrackSurge,
        minWorst2wPassPerTrackGap: runtimeMinWorst2wPassPerTrackGap,
        rescueEarlyExitNoPassMinEval: runtimeRescueEarlyExitNoPassMinEval,
        rescueEarlyExitNoPassMaxEval: runtimeRescueEarlyExitNoPassMaxEval,
        allowUnsafeGapChartFallbackStage1:
          runtimeAllowUnsafeGapChartFallbackStage1,
        gapChartUnsafeCooldownActive,
        moonshotPatternMissingCooldownActive,
        adaptivePoolTuningMode,
        previousPassDensity,
        previousTerminalRatio,
        runtimeDailyPassTopNByTrack,
        runtimeDailyPassPoolsetCountByTrack,
        runtimePoolsetCountByTrack,
        runtimeStage2TopKByTrack,
        prefilterWorst2wBuffer: runtimePrefilterWorst2wBuffer,
        prefilterStopLikeCeil: runtimePrefilterStopLikeCeil,
        prefilterNoFillCeil: runtimePrefilterNoFillCeil,
        roundsMultiplier: budgetBias.roundsMultiplier,
        rescueMultiplier: budgetBias.rescueMultiplier,
        runtimeSeedOffset,
        runtimeSeedTag,
        requiredTrackCollapse,
        runtimeChampionDiscoveryBudgetSplit,
      },
    },
  }
}

const runCommandLogged = ({
  command,
  args,
  env,
  cwd = rootDir,
  logPath,
  label,
  timeoutMs = 0,
  heartbeatTicker = null,
}) => {
  const startHeartbeatSidecar = (ticker) => {
    const filePath = String(ticker?.heartbeatPath ?? "").trim()
    if (!filePath) return null
    const progressPath = String(ticker?.progressPath ?? "").trim()
    const latestIndexPath = String(ticker?.latestIndexPath ?? "").trim()
    const intervalMs = Math.max(
      1_000,
      Math.min(
        60_000,
        Math.floor(Number(ticker?.intervalMs ?? 15_000) || 15_000),
      ),
    )
    const basePayload = {
      sessionId: ticker?.sessionId ?? null,
      sessionDir: ticker?.sessionDir ?? null,
      pid: Number(ticker?.pid ?? process.pid) || process.pid,
      status: String(ticker?.status ?? "RUNNING"),
      phase: String(ticker?.phase ?? "RUNNING_STAGE"),
      attempt: Number(ticker?.attempt ?? 0) || 0,
      stage: String(ticker?.stage ?? "UNKNOWN"),
      timeoutMs: Math.max(0, Number(ticker?.timeoutMs ?? 0) || 0),
    }
    const script = [
      "const fs=require('node:fs')",
      "const filePath=process.argv[1]",
      "const base=JSON.parse(process.argv[2]||'{}')",
      "const intervalMs=Math.max(1000, Math.floor(Number(process.argv[3]||15000)))",
      "const progressPath=String(process.argv[4]||'')",
      "const latestPath=String(process.argv[5]||'')",
      "const writeJson=(p,obj)=>fs.writeFileSync(p, JSON.stringify(obj, null, 2)+'\\n', 'utf8')",
      "const touchProgress=(updatedAt)=>{",
      "  if(!progressPath) return",
      "  try{",
      "    const raw=fs.readFileSync(progressPath,'utf8')",
      "    const obj=JSON.parse(raw)",
      "    obj.lastUpdatedAt=updatedAt",
      "    obj.pid=Number(base.pid)||obj.pid",
      "    if(String(obj.status||'').toUpperCase()==='RUNNING'){ obj.status='RUNNING' }",
      "    writeJson(progressPath,obj)",
      "  }catch{}",
      "}",
      "const touchLatest=(updatedAt)=>{",
      "  if(!latestPath) return",
      "  try{",
      "    const raw=fs.readFileSync(latestPath,'utf8')",
      "    const obj=JSON.parse(raw)",
      "    if(String(obj.sessionId||'').trim()!==String(base.sessionId||'').trim()) return",
      "    obj.lastUpdatedAt=updatedAt",
      "    obj.pid=Number(base.pid)||obj.pid",
      "    if(String(obj.status||'').toUpperCase()==='RUNNING'){ obj.status='RUNNING' }",
      "    writeJson(latestPath,obj)",
      "  }catch{}",
      "}",
      "const write=()=>{",
      "  const updatedAt=new Date().toISOString()",
      "  const payload={...base,updatedAt}",
      "  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2)+'\\n', 'utf8')",
      "  touchProgress(updatedAt)",
      "  touchLatest(updatedAt)",
      "}",
      "write()",
      "setInterval(write, intervalMs)",
    ].join(";")
    try {
      const child = spawn(
        process.execPath,
        [
          "-e",
          script,
          filePath,
          JSON.stringify(basePayload),
          String(intervalMs),
          progressPath,
          latestIndexPath,
        ],
        {
          cwd,
          env,
          stdio: "ignore",
          detached: true,
        },
      )
      child.unref()
      return {
        pid: child.pid,
        basePayload,
        filePath,
        progressPath,
        latestIndexPath,
      }
    } catch {
      return null
    }
  }

  const stopHeartbeatSidecar = (sidecar) => {
    if (!sidecar) return
    const sidecarPid = Number(sidecar.pid)
    if (Number.isFinite(sidecarPid) && sidecarPid > 1) {
      try {
        process.kill(Math.floor(sidecarPid), "SIGTERM")
      } catch {
        // ignore stop failure
      }
    }
    if (sidecar.filePath) {
      const updatedAt = new Date().toISOString()
      try {
        writeJson(sidecar.filePath, {
          ...sidecar.basePayload,
          updatedAt,
        })
      } catch {
        // ignore flush failure
      }
      const flushJsonUpdate = (targetPath, patchFn) => {
        if (!targetPath) return
        try {
          const payload = readJsonSafe(targetPath)
          if (!payload || typeof payload !== "object") return
          const next = patchFn(payload)
          if (next && typeof next === "object") {
            writeJson(targetPath, next)
          }
        } catch {
          // ignore flush failure
        }
      }
      flushJsonUpdate(sidecar.progressPath, (payload) => ({
        ...payload,
        pid: Number(sidecar.basePayload?.pid ?? payload?.pid) || payload?.pid,
        lastUpdatedAt: updatedAt,
      }))
      flushJsonUpdate(sidecar.latestIndexPath, (payload) => {
        if (
          String(payload?.sessionId ?? "").trim() !==
          String(sidecar.basePayload?.sessionId ?? "").trim()
        ) {
          return payload
        }
        return {
          ...payload,
          pid: Number(sidecar.basePayload?.pid ?? payload?.pid) || payload?.pid,
          lastUpdatedAt: updatedAt,
        }
      })
    }
  }

  const heartbeatSidecar = startHeartbeatSidecar(heartbeatTicker)
  const startedAt = new Date().toISOString()
  const startMs = Date.now()
  const timeout = Number.isFinite(Number(timeoutMs))
    ? Math.max(0, Math.floor(Number(timeoutMs)))
    : 0
  const runningHeader = [
    `label=${label}`,
    `command=${command} ${(args ?? []).join(" ")}`,
    "status=RUNNING",
    `timeoutMs=${timeout}`,
    "timedOut=0",
    `startedAt=${startedAt}`,
    "endedAt=",
    "durationMs=",
    "",
    "[stdout]",
    "",
    "[stderr]",
    "",
  ].join("\n")
  writeText(logPath, runningHeader)
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...(timeout > 0 ? { timeout } : {}),
  })
  stopHeartbeatSidecar(heartbeatSidecar)
  const endedAt = new Date().toISOString()
  const durationMs = Date.now() - startMs
  const stdout = String(result.stdout ?? "")
  const stderr = String(result.stderr ?? "")
  const timedOut =
    Boolean(result.error) && String(result.error?.code ?? "") === "ETIMEDOUT"
  const status = Number.isInteger(result.status)
    ? result.status
    : timedOut
      ? 124
      : 1
  const stderrWithTimeout = timedOut ? `${stderr}\nPROCESS_TIMEOUT` : stderr
  const header = [
    `label=${label}`,
    `command=${command} ${(args ?? []).join(" ")}`,
    `status=${status}`,
    `timeoutMs=${timeout}`,
    `timedOut=${timedOut ? "1" : "0"}`,
    `startedAt=${startedAt}`,
    `endedAt=${endedAt}`,
    `durationMs=${durationMs}`,
    "",
    "[stdout]",
    stdout,
    "",
    "[stderr]",
    stderrWithTimeout,
    "",
  ].join("\n")
  writeText(logPath, header)
  if (result.error) {
    return {
      status,
      stdout,
      stderr: `${stderrWithTimeout}\n${result.error.message}`,
      durationMs,
      timedOut,
      timeoutMs: timeout,
    }
  }
  return {
    status,
    stdout,
    stderr: stderrWithTimeout,
    durationMs,
    timedOut,
    timeoutMs: timeout,
  }
}

const updateFillLatestMonitorPointers = ({ pid, logPath }) => {
  try {
    const logsDir = path.join(rootDir, "logs")
    fs.mkdirSync(logsDir, { recursive: true })
    const pidPath = path.join(logsDir, "fill_latest.pid")
    const logAliasPath = path.join(logsDir, "fill_latest.log")
    const monitorPid = Number(pid)
    if (Number.isFinite(monitorPid) && monitorPid > 1) {
      try {
        const stat = fs.lstatSync(pidPath)
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(pidPath)
        }
      } catch {
        // ignore
      }
      fs.writeFileSync(pidPath, `${Math.floor(monitorPid)}\n`, "utf8")
    }
    const absoluteLogPath = path.isAbsolute(String(logPath ?? ""))
      ? String(logPath)
      : path.join(rootDir, String(logPath ?? ""))
    if (absoluteLogPath) {
      try {
        fs.unlinkSync(logAliasPath)
      } catch {
        // ignore
      }
      const linkTarget = path.relative(logsDir, absoluteLogPath)
      try {
        fs.symlinkSync(linkTarget, logAliasPath)
      } catch {
        fs.writeFileSync(logAliasPath, `${absoluteLogPath}\n`, "utf8")
      }
    }
  } catch {
    // monitor pointer update failure should not break stage execution
  }
}

const runCommandLoggedLive = async ({
  command,
  args,
  env,
  cwd = rootDir,
  logPath,
  label,
  timeoutMs = 0,
  progressEveryMs = 30_000,
  stallNoOutputMs = 0,
  stallMinElapsedMs = 0,
  heartbeatTicker = null,
}) => {
  const startedAt = new Date().toISOString()
  const startMs = Date.now()
  const timeout = Number.isFinite(Number(timeoutMs))
    ? Math.max(0, Math.floor(Number(timeoutMs)))
    : 0
  const runningHeader = [
    `label=${label}`,
    `command=${command} ${(args ?? []).join(" ")}`,
    "status=RUNNING",
    `timeoutMs=${timeout}`,
    "timedOut=0",
    `startedAt=${startedAt}`,
    "endedAt=",
    "durationMs=",
    "",
    "[live]",
    `ts=${startedAt} message=PROCESS_STARTED`,
    "",
    "[stdout]",
    "",
    "[stderr]",
    "",
  ].join("\n")
  writeText(logPath, runningHeader)

  const maxCaptureBytes = 8 * 1024 * 1024
  let stdoutCapture = ""
  let stderrCapture = ""
  const appendCapture = (kind, chunk) => {
    const text = String(chunk ?? "")
    if (!text) return
    if (kind === "stdout") {
      const remain = Math.max(
        0,
        maxCaptureBytes - Buffer.byteLength(stdoutCapture),
      )
      if (remain > 0) {
        stdoutCapture += text.slice(0, remain)
      }
    } else {
      const remain = Math.max(
        0,
        maxCaptureBytes - Buffer.byteLength(stderrCapture),
      )
      if (remain > 0) {
        stderrCapture += text.slice(0, remain)
      }
    }
  }

  const child = spawn(command, args ?? [], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const childPid = Number(child?.pid) || null
  trackActiveCommandChild({ pid: childPid, label })
  if (String(label ?? "").toUpperCase() === "DATA_SYNC" && childPid > 1) {
    updateFillLatestMonitorPointers({ pid: childPid, logPath })
  }
  const ticker = {
    ...(heartbeatTicker ?? {}),
    pid: childPid && childPid > 1 ? childPid : process.pid,
  }
  let timedOut = false
  let stalled = false
  let lastOutputAtMs = Date.now()
  let timeoutHandle = null
  let progressHandle = null
  let stallHandle = null
  const progressInterval = Math.max(
    10_000,
    Math.floor(Number(progressEveryMs) || 30_000),
  )
  const heartbeatHandle = setInterval(() => {
    if (ticker?.heartbeatPath) {
      writeJson(ticker.heartbeatPath, {
        sessionId: ticker?.sessionId ?? null,
        sessionDir: ticker?.sessionDir ?? null,
        pid: Number(ticker?.pid ?? process.pid) || process.pid,
        updatedAt: isoNow(),
        status: "RUNNING",
        phase: "RUNNING_STAGE",
        attempt: Number(ticker?.attempt ?? 0) || 0,
        stage: String(ticker?.stage ?? "UNKNOWN"),
        timeoutMs: Math.max(0, Number(ticker?.timeoutMs ?? timeout) || timeout),
      })
    }
  }, 15_000)
  if (typeof heartbeatHandle.unref === "function") {
    heartbeatHandle.unref()
  }
  const appendLive = (message) => {
    fs.appendFileSync(
      logPath,
      `[live] ts=${isoNow()} elapsedMs=${Date.now() - startMs} ${message}\n`,
      "utf8",
    )
  }
  progressHandle = setInterval(() => {
    appendLive(`pid=${childPid ?? "na"} heartbeat=1`)
  }, progressInterval)
  if (typeof progressHandle.unref === "function") {
    progressHandle.unref()
  }

  if (timeout > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      appendLive("timeout=1 action=SIGTERM")
      tryKillPid(childPid, "SIGTERM")
      setTimeout(() => {
        if (isProcessAlive(childPid)) {
          appendLive("timeout=1 action=SIGKILL")
          tryKillPid(childPid, "SIGKILL")
        }
      }, 5000)
    }, timeout)
    if (typeof timeoutHandle.unref === "function") {
      timeoutHandle.unref()
    }
  }
  const noOutputTimeout = Math.max(0, Math.floor(Number(stallNoOutputMs) || 0))
  const stallMinElapsed = Math.max(
    0,
    Math.floor(Number(stallMinElapsedMs) || 0),
  )
  if (noOutputTimeout > 0) {
    stallHandle = setInterval(() => {
      if (timedOut || stalled) return
      const nowMs = Date.now()
      const elapsedMs = nowMs - startMs
      const noOutputMs = nowMs - lastOutputAtMs
      if (elapsedMs < stallMinElapsed || noOutputMs < noOutputTimeout) {
        return
      }
      stalled = true
      appendLive(`stall=1 noOutputMs=${noOutputMs} action=SIGTERM`)
      tryKillPid(childPid, "SIGTERM")
      setTimeout(() => {
        if (isProcessAlive(childPid)) {
          appendLive("stall=1 action=SIGKILL")
          tryKillPid(childPid, "SIGKILL")
        }
      }, 5000)
    }, 10_000)
    if (typeof stallHandle.unref === "function") {
      stallHandle.unref()
    }
  }

  child.stdout?.on("data", (chunk) => {
    lastOutputAtMs = Date.now()
    appendCapture("stdout", chunk)
    fs.appendFileSync(logPath, String(chunk), "utf8")
  })
  child.stderr?.on("data", (chunk) => {
    lastOutputAtMs = Date.now()
    appendCapture("stderr", chunk)
    fs.appendFileSync(logPath, String(chunk), "utf8")
  })

  const closeResult = await new Promise((resolve) => {
    child.on("close", (code, signal) => {
      clearActiveCommandChild(childPid)
      resolve({ code, signal })
    })
    child.on("error", (error) => {
      clearActiveCommandChild(childPid)
      resolve({ code: 1, signal: "ERROR", error })
    })
  })

  if (timeoutHandle) clearTimeout(timeoutHandle)
  if (progressHandle) clearInterval(progressHandle)
  if (stallHandle) clearInterval(stallHandle)
  clearInterval(heartbeatHandle)

  const endedAt = new Date().toISOString()
  const durationMs = Date.now() - startMs
  const status = Number.isInteger(closeResult?.code)
    ? Number(closeResult.code)
    : timedOut
      ? 124
      : stalled
        ? 75
        : 1
  const stderrWithTimeout = timedOut
    ? `${stderrCapture}\nPROCESS_TIMEOUT`
    : stalled
      ? `${stderrCapture}\nPROCESS_STALL`
      : stderrCapture

  fs.appendFileSync(
    logPath,
    [
      "",
      "[live]",
      `ts=${endedAt} message=PROCESS_ENDED signal=${closeResult?.signal ?? "none"}`,
      "",
      "[footer]",
      `status=${status}`,
      `timedOut=${timedOut ? "1" : "0"}`,
      `stalled=${stalled ? "1" : "0"}`,
      `startedAt=${startedAt}`,
      `endedAt=${endedAt}`,
      `durationMs=${durationMs}`,
      "",
    ].join("\n"),
    "utf8",
  )

  return {
    status,
    stdout: stdoutCapture,
    stderr: stderrWithTimeout,
    durationMs,
    timedOut,
    stalled,
    stallNoOutputMs: noOutputTimeout,
    timeoutMs: timeout,
  }
}

const runOptionalCommandStage = async ({
  stage,
  enabled,
  disabledReason = "DISABLED",
  command,
  env,
  attemptDir,
  timeoutMs = 0,
  liveOutput = false,
  stallNoOutputMs = 0,
  stallMinElapsedMs = 0,
  heartbeatTicker = null,
}) => {
  if (!enabled) {
    return {
      stage,
      status: "SKIPPED",
      reason: String(disabledReason ?? "DISABLED").trim() || "DISABLED",
      command: null,
      exitCode: 0,
      durationMs: 0,
    }
  }
  if (!Array.isArray(command) || command.length < 2) {
    return {
      stage,
      status: "SKIPPED",
      reason: "COMMAND_MISSING",
      command: command ?? null,
      exitCode: 0,
      durationMs: 0,
    }
  }
  const [cmd, ...args] = command
  const run = liveOutput
    ? await runCommandLoggedLive({
        command: cmd,
        args,
        env,
        logPath: path.join(attemptDir, `${stage.toLowerCase()}.log`),
        label: stage,
        timeoutMs,
        stallNoOutputMs,
        stallMinElapsedMs,
        heartbeatTicker,
      })
    : runCommandLogged({
        command: cmd,
        args,
        env,
        logPath: path.join(attemptDir, `${stage.toLowerCase()}.log`),
        label: stage,
        timeoutMs,
        heartbeatTicker,
      })
  return {
    stage,
    status: run.status === 0 ? "PASS" : "FAIL",
    reason:
      run.status === 0
        ? null
        : run.timedOut
          ? "TIMEOUT"
          : run.stalled
            ? "STALL"
            : "COMMAND_FAILED",
    command,
    exitCode: run.status,
    durationMs: run.durationMs,
    timedOut: run.timedOut === true,
    stalled: run.stalled === true,
    timeoutMs: run.timeoutMs,
    logPath: path.join(attemptDir, `${stage.toLowerCase()}.log`),
  }
}

const readTextTailSafe = (filePath, maxBytes = 2 * 1024 * 1024) => {
  try {
    const text = String(fs.readFileSync(filePath, "utf8") ?? "")
    if (!text) return ""
    const keep = Math.max(0, Math.floor(Number(maxBytes) || 0))
    if (keep <= 0 || Buffer.byteLength(text) <= keep) {
      return text
    }
    return text.slice(-keep)
  } catch {
    return ""
  }
}

const includesAny = (text, patterns = []) => {
  const body = String(text ?? "").toUpperCase()
  return (patterns ?? []).some((pattern) =>
    body.includes(String(pattern ?? "").toUpperCase()),
  )
}

const detectDataSyncFailureFromLog = (logPath) => {
  const body = readTextTailSafe(logPath)
  if (!body) return null
  if (includesAny(body, ["ACTIVE_STRATEGY_REQUIRED"])) {
    return {
      code: "ACTIVE_STRATEGY_MISSING",
      detail: "ACTIVE_STRATEGY_REQUIRED",
    }
  }
  if (
    includesAny(body, [
      "PREFLIGHT_SIGNALS_LOADED_LOW",
      "PREFLIGHT_SIGNALS_QUALIFIED_LOW",
      "SIGNAL_GAP",
      "SIGNAL_ONLY_SHORTAGE",
    ])
  ) {
    return {
      code: "SIGNAL_GAP",
      detail: "SIGNAL_PREFLIGHT_SHORTAGE",
    }
  }
  return null
}

const buildBatchId = ({ sessionId, attempt, mode }) =>
  `${sessionId}_a${String(attempt).padStart(3, "0")}_${mode}`

const runSharded = async ({
  sessionId,
  attempt,
  mode,
  rules,
  tuning,
  coveragePlan,
  blockedFingerprintsPath,
  env,
  attemptDir,
  dryRunOnly,
  timeoutMs = 0,
  heartbeatTicker = null,
}) => {
  const batchId = buildBatchId({ sessionId, attempt, mode })
  const runtimeSeedOffset = clampInt(
    tuning.runtimeSeedOffset,
    0,
    0,
    1_000_000_000,
  )
  const runtimeSeedTag = String(tuning.runtimeSeedTag ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, "")
  const policyConflictResolution = String(
    tuning.policyConflictResolution ?? "POOLSET_FIRST_STRICT",
  )
    .trim()
    .toUpperCase()
  if (policyConflictResolution !== "POOLSET_FIRST_STRICT") {
    const policyError = new Error(
      `POLICY_CONFLICT_BLOCKED policyConflictResolution=${policyConflictResolution || "UNKNOWN"}`,
    )
    policyError.code = "POLICY_CONFLICT_BLOCKED"
    throw policyError
  }
  const symbolSeedBase = runtimeSeedTag
    ? `${tuning.symbolSeedBase}:a${attempt}:${runtimeSeedTag}`
    : `${tuning.symbolSeedBase}:a${attempt}`
  // apply/final 모드는 항상 엄격 차단.
  // dry 모드에서만 명시적으로 허용된 경우 제한 우회 가능.
  // passMode=all에서는 required-track 저품질 상태에서 stage2를 계속 돌아도
  // 최종 합격이 불가능하므로 기본적으로 우회를 비활성화한다.
  const passModeAll = String(rules.passMode ?? "all").toLowerCase() === "all"
  const disableDryLowQualityContinuation =
    passModeAll &&
    tuning.disableStage2OnLowQualityRequiredDryOnZeroPass !== false
  const allowLowQualityRequiredForThisMode =
    !disableDryLowQualityContinuation &&
    (mode === "dry" || dryRunOnly === true) &&
    tuning.allowStage2OnLowQualityRequiredDry === true
  const executionLane =
    String(tuning.executionLane ?? "server")
      .trim()
      .toLowerCase() === "codex_cloud"
      ? "codex_cloud"
      : "server"
  const detectedCpuCount = Math.max(1, Number(os.cpus()?.length ?? 1) || 1)
  const detectedMemMb = Math.max(
    1,
    Math.floor((Number(os.totalmem?.() ?? 0) || 0) / (1024 * 1024)),
  )
  const detectedStage2ConcurrencyCap = Math.max(
    1,
    Math.min(
      detectedCpuCount,
      Math.floor(detectedMemMb / 1024) || detectedCpuCount,
    ),
  )
  const maxParallelCap =
    executionLane === "codex_cloud" ? Number.MAX_SAFE_INTEGER : 2
  const stage2ConcurrencyCap =
    executionLane === "codex_cloud"
      ? Number.MAX_SAFE_INTEGER
      : 1
  const dailyPassRecombineCap =
    executionLane === "codex_cloud" ? Number.MAX_SAFE_INTEGER : 5
  const maxParallelShards = Math.max(
    1,
    Math.min(
      maxParallelCap,
      executionLane === "codex_cloud"
        ? Math.max(
            detectedCpuCount,
            Number(tuning.maxWorkers ?? tuning.maxParallelShards ?? 2) || 2,
          )
        : Number(tuning.maxWorkers ?? tuning.maxParallelShards ?? 2) || 2,
    ),
  )
  const stage2EvalConcurrency = Math.max(
    1,
    Math.min(
      stage2ConcurrencyCap,
      executionLane === "codex_cloud"
        ? Math.max(
            detectedStage2ConcurrencyCap,
            Number(
              tuning.stage2EvalConcurrency ??
                tuning.poolsetMaxConcurrentEval ??
                1,
            ) || 1,
          )
        : Number(
            tuning.stage2EvalConcurrency ?? tuning.poolsetMaxConcurrentEval ?? 1,
          ) || 1,
    ),
  )
  const args = [
    "scripts/autosearch/go_live_sharded.mjs",
    `--executionLane=${executionLane}`,
    `--policyConflictResolution=${policyConflictResolution}`,
    `--batchId=${batchId}`,
    `--asof=${rules.asOfInput}`,
    `--tracks=${rules.tracks.join(",")}`,
    `--passMode=${rules.passMode}`,
    `--targetPct=${rules.targetPct}`,
    `--minWorst2wAvgPct=${rules.minWorst2wAvgPct}`,
    `--highWeekPct=${rules.highWeekPct}`,
    `--minHighWeeks=${rules.minHighWeeks}`,
    `--nearHighWeeks=${rules.nearHighWeeks}`,
    `--minOtherWeekPct=${rules.minOtherWeekPct}`,
    `--requireCompletedTradesEveryWeek=${rules.requireCompletedTradesEveryWeek}`,
    `--stage1MaxRounds=${tuning.stage1MaxRounds}`,
    `--stage2MaxRounds=${tuning.stage2MaxRounds}`,
    `--stage1PlateauRounds=${tuning.stage1PlateauRounds}`,
    `--stage2PlateauRounds=${tuning.stage2PlateauRounds}`,
    `--shards=${tuning.shards}`,
    `--topPerTrack=${tuning.topPerTrack}`,
    `--seedStart=${tuning.seedStart + attempt * 1000 + runtimeSeedOffset}`,
    `--symbolSeedBase=${symbolSeedBase}`,
    `--maxParallelShards=${maxParallelShards}`,
    `--minFreeMbForParallel=${Math.max(
      512,
      Number(tuning.minFreeMbForParallelShards ?? 2200) || 2200,
    )}`,
    `--rescueEnabled=${tuning.rescueEnabled === false ? 0 : 1}`,
    `--rescueTopK=${Math.max(1, Number(tuning.rescueTopK ?? 20) || 20)}`,
    `--rescueCheapB=${Math.max(20, Number(tuning.rescueCheapB ?? 300) || 300)}`,
    `--rescueCheapM=${Math.max(1, Number(tuning.rescueCheapM ?? 50) || 50)}`,
    `--rescueDeepTopK=${Math.max(
      1,
      Number(
        tuning.rescueDeepTopK ??
          Math.max(12, Number(tuning.rescueTopK ?? 20) || 20),
      ) || 12,
    )}`,
    `--rescueDeepB=${Math.max(20, Number(tuning.rescueDeepB ?? 600) || 600)}`,
    `--rescueDeepM=${Math.max(1, Number(tuning.rescueDeepM ?? 80) || 80)}`,
    `--rescueDeepAllowMoonshotDominant=${
      tuning.rescueDeepAllowMoonshotDominant === true ? 1 : 0
    }`,
    `--rescueAlpha=${Math.max(
      1e-6,
      Math.min(0.5, Number(tuning.rescueAlpha ?? 0.05) || 0.05),
    )}`,
    `--rescueP0=${Math.max(
      0.5,
      Math.min(0.9999, Number(tuning.rescueP0 ?? 0.95) || 0.95),
    )}`,
    `--rescueLcbQuantile=${Math.max(
      0.01,
      Math.min(0.5, Number(tuning.rescueLcbQuantile ?? 0.1) || 0.1),
    )}`,
    `--policyEvalEnabled=${tuning.policyEvalEnabled === false ? 0 : 1}`,
    `--policyEvalTopKSurge=${Math.max(
      1,
      Number(tuning.policyEvalTopKSurge ?? 10) || 10,
    )}`,
    `--policyEvalTopKGap=${Math.max(
      1,
      Number(tuning.policyEvalTopKGap ?? 8) || 8,
    )}`,
    `--policyEvalMinWeeks=${Math.max(
      2,
      Number(tuning.policyEvalMinWeeks ?? 8) || 8,
    )}`,
    `--policyEvalLookbackWeeks=${Math.max(
      1,
      Number(tuning.policyEvalLookbackWeeks ?? 4) || 4,
    )}`,
    `--policyEvalMinDistinctCandidates=${Math.max(
      1,
      Number(tuning.policyEvalMinDistinctCandidates ?? 2) || 2,
    )}`,
    `--policyEvalMaxConsecutiveDays=${Math.max(
      1,
      Number(tuning.policyEvalMaxConsecutiveDays ?? 4) || 4,
    )}`,
    `--policyEvalMaxConsecutiveWeeks=${Math.max(
      1,
      Number(tuning.policyEvalMaxConsecutiveWeeks ?? 2) || 2,
    )}`,
    `--moonshotTrackRequiredForCorePass=${
      tuning.moonshotTrackRequiredForCorePass === true ? 1 : 0
    }`,
    `--rescueEarlyExitEnabled=${tuning.rescueEarlyExitEnabled === false ? 0 : 1}`,
    `--rescueEarlyExitNoPassMinEval=${Math.max(
      1,
      Number(tuning.rescueEarlyExitNoPassMinEval ?? 12) || 12,
    )}`,
    `--rescueEarlyExitNoPassMaxEval=${Math.max(
      1,
      Number(tuning.rescueEarlyExitNoPassMaxEval ?? 64) || 64,
    )}`,
    `--rescueEarlyExitMinEvalRatio=${Math.max(
      0,
      Math.min(1, Number(tuning.rescueEarlyExitMinEvalRatio ?? 0.25) || 0.25),
    )}`,
    `--rescueEarlyExitTerminalReasonRatio=${Math.max(
      0.5,
      Math.min(
        1,
        Number(tuning.rescueEarlyExitTerminalReasonRatio ?? 0.85) || 0.85,
      ),
    )}`,
    `--rescueAllowRequiredTrackEarlyExit=${
      tuning.rescueAllowRequiredTrackEarlyExit === false ? 0 : 1
    }`,
    `--minPoolPerTrackSurge=${Math.max(
      0,
      Number.isFinite(Number(tuning.minPoolPerTrackSurge))
        ? Number(tuning.minPoolPerTrackSurge)
        : 6,
    )}`,
    `--minPoolPerTrackGap=${Math.max(
      0,
      Number.isFinite(Number(tuning.minPoolPerTrackGap))
        ? Number(tuning.minPoolPerTrackGap)
        : 8,
    )}`,
    `--minWorst2wPassPerTrackSurge=${Math.max(
      0,
      Number.isFinite(Number(tuning.minWorst2wPassPerTrackSurge))
        ? Number(tuning.minWorst2wPassPerTrackSurge)
        : 2,
    )}`,
    `--minWorst2wPassPerTrackGap=${Math.max(
      0,
      Number.isFinite(Number(tuning.minWorst2wPassPerTrackGap))
        ? Number(tuning.minWorst2wPassPerTrackGap)
        : 2,
    )}`,
    `--allowStage2OnLowQualityRequired=${allowLowQualityRequiredForThisMode ? 1 : 0}`,
    `--printEvery=${tuning.printEvery}`,
    `--poolsetEnabled=${tuning.poolsetEnabled === false ? 0 : 1}`,
    `--dailyPassAvengersEnabled=${
      tuning.dailyPassAvengersEnabled === false ? 0 : 1
    }`,
    `--dailyPassRecombineRounds=${Math.max(
      1,
      Math.min(
        dailyPassRecombineCap,
        Number(tuning.dailyPassRecombineRounds ?? 2) || 2,
      ),
    )}`,
    `--poolsetBatchSize=${Math.max(1, Number(tuning.poolsetBatchSize ?? 2) || 2)}`,
    `--poolsetMaxConcurrentEval=${stage2EvalConcurrency}`,
    `--stage2ResultCacheEnabled=${tuning.stage2ResultCacheEnabled === false ? 0 : 1}`,
    `--stage2ResultCacheTtlSec=${Math.max(
      60,
      Number(tuning.stage2ResultCacheTtlSec ?? 86400) || 86400,
    )}`,
    `--stage2SkipDuplicatePoolSetSignature=${
      tuning.stage2SkipDuplicatePoolSetSignature === false ? 0 : 1
    }`,
    `--stage2ScheduleMode=${
      String(tuning.stage2ScheduleMode ?? "champion_first")
        .trim()
        .toLowerCase() === "fifo"
        ? "fifo"
        : "champion_first"
    }`,
    `--stage2ContinueAfterFirstPass=${
      tuning.stage2ContinueAfterFirstPass === false ? 0 : 1
    }`,
  ]
  const pushEncodedJsonArg = (flag, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return
    }
    args.push(`--${flag}=${encodeURIComponent(JSON.stringify(value))}`)
  }
  if (
    tuning.poolEngineQuotaByTrack &&
    typeof tuning.poolEngineQuotaByTrack === "object"
  ) {
    pushEncodedJsonArg("poolEngineQuotaByTrack", tuning.poolEngineQuotaByTrack)
  }
  if (
    tuning.championDiscoveryBudgetSplit &&
    typeof tuning.championDiscoveryBudgetSplit === "object"
  ) {
    pushEncodedJsonArg(
      "championDiscoveryBudgetSplit",
      tuning.championDiscoveryBudgetSplit,
    )
  }
  pushEncodedJsonArg("poolsetCountByTrack", tuning.poolsetCountByTrack)
  pushEncodedJsonArg("poolsetCountMaxByTrack", tuning.poolsetCountMaxByTrack)
  pushEncodedJsonArg(
    "poolsetActiveSizeByTrack",
    tuning.poolsetActiveSizeByTrack,
  )
  pushEncodedJsonArg("poolsetBenchSizeByTrack", tuning.poolsetBenchSizeByTrack)
  pushEncodedJsonArg("poolsetMinAliveByTrack", tuning.poolsetMinAliveByTrack)
  pushEncodedJsonArg(
    "poolsetRefillCountByTrack",
    tuning.poolsetRefillCountByTrack,
  )
  pushEncodedJsonArg("dailyPassTopNByTrack", tuning.dailyPassTopNByTrack)
  pushEncodedJsonArg(
    "dailyPassPoolsetCountByTrack",
    tuning.dailyPassPoolsetCountByTrack,
  )
  pushEncodedJsonArg("stage2TopKByTrack", tuning.stage2TopKByTrack)
  if ((Number(coveragePlan?.bucketTotal ?? 1) || 1) > 1) {
    args.push(`--symbolBucketTotal=${coveragePlan.bucketTotal}`)
    args.push(`--symbolBucketIndex=${coveragePlan.bucketIndex}`)
  }
  if (blockedFingerprintsPath) {
    args.push(`--excludeFingerprintsPath=${blockedFingerprintsPath}`)
  }
  if (tuning.prefilterEnabled !== false) {
    const prefilterWorst2wBuffer = Math.max(
      14,
      Math.min(24, Number(tuning.prefilterWorst2wBuffer ?? 4) || 4),
    )
    const prefilterStopLikeCeil = Math.max(
      0.74,
      Math.min(0.99, Number(tuning.prefilterStopLikeCeil ?? 0.9) || 0.9),
    )
    const prefilterNoFillCeil = Math.max(
      0.86,
      Math.min(0.999, Number(tuning.prefilterNoFillCeil ?? 0.95) || 0.95),
    )
    const worst2wFloor =
      Number(rules.minWorst2wAvgPct ?? -1.5) - prefilterWorst2wBuffer
    args.push("--prefilter=1")
    args.push(`--prefilterWorst2wFloor=${worst2wFloor}`)
    args.push(`--prefilterStopLikeCeil=${prefilterStopLikeCeil}`)
    args.push(`--prefilterNoFillCeil=${prefilterNoFillCeil}`)
  }
  if (mode === "dry" || dryRunOnly) {
    args.push("--dryRunOnly=1")
  } else {
    args.push("--apply=1")
  }
  const logName = mode === "dry" ? "rampup_dry.log" : "rampup_apply.log"
  const run = await runCommandLoggedLive({
    command: "node",
    args,
    env,
    logPath: path.join(attemptDir, logName),
    label: `RAMPUP_${mode.toUpperCase()}`,
    timeoutMs,
    progressEveryMs: 20_000,
    heartbeatTicker,
  })

  const summaryDir = path.join(
    rootDir,
    "artifacts",
    "autosearch_sharded",
    batchId,
  )
  const summaryJsonPath = path.join(summaryDir, "summary.json")
  const stage1SummaryPath = path.join(summaryDir, "stage1_summary.json")
  const summaryFromJson = readJsonSafe(summaryJsonPath)
  const stage1Summary = readJsonSafe(stage1SummaryPath)
  const summary =
    summaryFromJson && typeof summaryFromJson === "object"
      ? summaryFromJson
      : stage1Summary && typeof stage1Summary === "object"
        ? {
            batchId,
            stage1SummaryPath,
            stage1Candidates: Number(stage1Summary.stage1Candidates ?? 0) || 0,
            poolCount: Number(stage1Summary.poolCount ?? 0) || 0,
            poolCountByTrack:
              stage1Summary.poolCountByTrack &&
              typeof stage1Summary.poolCountByTrack === "object"
                ? stage1Summary.poolCountByTrack
                : {},
            poolQualityByTrack:
              stage1Summary.poolQualityByTrack &&
              typeof stage1Summary.poolQualityByTrack === "object"
                ? stage1Summary.poolQualityByTrack
                : {},
            stage1QualityWarning: stage1Summary.stage1QualityWarning ?? null,
            stage1MissingTrackWarning:
              stage1Summary.stage1MissingTrackWarning ?? null,
            status: "STAGE1_READY",
            reason: "SUMMARY_JSON_MISSING_STAGE1_FALLBACK",
            stage2: null,
          }
        : null
  const summaryPath =
    summaryFromJson && typeof summaryFromJson === "object"
      ? summaryJsonPath
      : stage1Summary && typeof stage1Summary === "object"
        ? stage1SummaryPath
        : summaryJsonPath
  const reportPath = String(summary?.stage2?.reportPath ?? "").trim()
  const report = reportPath ? readJsonSafe(reportPath) : null
  const selectionSource = String(report?.selectionSource ?? "").trim()
  console.log(
    `[rampup-stage] mode=${mode} selectionSource=${selectionSource || "MISSING"}`,
  )
  return {
    mode,
    batchId,
    run,
    summaryDir,
    summaryPath,
    summary,
    reportPath: reportPath || null,
    report,
    logPath: path.join(attemptDir, logName),
  }
}

const runVerifyStage = ({
  env,
  attemptDir,
  timeoutMs = 0,
  heartbeatTicker = null,
}) => {
  const run = runCommandLogged({
    command: "npm",
    args: ["run", "verify"],
    env,
    logPath: path.join(attemptDir, "verify.log"),
    label: "VERIFY",
    timeoutMs,
    heartbeatTicker,
  })
  return {
    stage: "VERIFY",
    status: run.status === 0 ? "PASS" : "FAIL",
    reason: run.status === 0 ? null : run.timedOut ? "TIMEOUT" : "VERIFY_FAIL",
    exitCode: run.status,
    durationMs: run.durationMs,
    timedOut: run.timedOut === true,
    timeoutMs: run.timeoutMs,
    logPath: path.join(attemptDir, "verify.log"),
  }
}

const runSignalPreflight = ({
  rules,
  tuning,
  env,
  attemptDir,
  timeoutMs = 0,
  heartbeatTicker = null,
  stageLabel = "SIGNAL_PREFLIGHT",
  outputFileName = "signal_preflight.json",
  logFileName = "signal_preflight.log",
  asOfOverride = null,
  windowTradingDaysOverride = null,
  minSignalsLoadedOverride = null,
  requireQualifiedOverride = null,
  minQualifiedSignalsOverride = null,
  failureCodeOnSignalShortage = "SURGE_POOL_EMPTY",
}) => {
  if (tuning?.preflightEnabled === false) {
    return {
      stage: stageLabel,
      status: "SKIPPED",
      reason: "DISABLED",
      command: null,
      exitCode: 0,
      durationMs: 0,
    }
  }
  const outputPath = path.join(attemptDir, outputFileName)
  const asOfInput = normalizeDateKeyLoose(asOfOverride) || rules.asOfInput
  const windowTradingDays = Math.max(
    1,
    Math.floor(
      Number(
        windowTradingDaysOverride ?? tuning?.preflightSignalWindowTradingDays,
      ) || 28,
    ),
  )
  const minSignalsLoaded = Math.max(
    0,
    Math.floor(
      Number(minSignalsLoadedOverride ?? tuning?.preflightMinSignalsLoaded) ||
        1,
    ),
  )
  const minTradingDays = Math.max(
    1,
    Math.floor(Number(tuning?.preflightMinTradingDays ?? 16) || 16),
  )
  const minWeekCount = Math.max(
    1,
    Math.floor(Number(tuning?.preflightMinWeekCount ?? 16) || 16),
  )
  const minUniverseSize = Math.max(
    1,
    Math.floor(Number(tuning?.preflightMinUniverseSize ?? 1) || 1),
  )
  const minQualifiedSignals = Math.max(
    0,
    Math.floor(
      Number(
        minQualifiedSignalsOverride ?? tuning?.preflightMinQualifiedSignals,
      ) || 0,
    ),
  )
  const requireQualified =
    requireQualifiedOverride === null
      ? tuning?.preflightRequireQualifiedSignals === true
      : toBoolean(requireQualifiedOverride, false)
  const args = [
    "scripts/autosearch/preflight_signal_probe.mjs",
    `--asof=${asOfInput}`,
    `--windowTradingDays=${windowTradingDays}`,
    `--minTradingDays=${minTradingDays}`,
    `--minWeekCount=${minWeekCount}`,
    `--minUniverseSize=${minUniverseSize}`,
    `--minSignalsLoaded=${minSignalsLoaded}`,
    `--requireQualified=${requireQualified ? 1 : 0}`,
    `--minQualifiedSignals=${minQualifiedSignals}`,
    `--out=${outputPath}`,
  ]
  const run = runCommandLogged({
    command: "node",
    args,
    env,
    logPath: path.join(attemptDir, logFileName),
    label: stageLabel,
    timeoutMs,
    heartbeatTicker,
  })
  const payload = readJsonSafe(outputPath)
  const reasons = Array.isArray(payload?.reasons)
    ? payload.reasons.map((item) => String(item ?? "").trim()).filter(Boolean)
    : []
  const reason =
    run.status === 0
      ? null
      : run.timedOut
        ? "TIMEOUT"
        : String(reasons[0] ?? `${stageLabel}_FAILED`)
  const isSignalShortage =
    reasons.includes("PREFLIGHT_SIGNALS_LOADED_LOW") ||
    reasons.includes("PREFLIGHT_SIGNALS_QUALIFIED_LOW")
  const isCoverageShortage =
    reasons.includes("PREFLIGHT_TRADING_DAYS_LOW") ||
    reasons.includes("PREFLIGHT_WEEK_COUNT_LOW") ||
    reasons.includes("PREFLIGHT_UNIVERSE_LOW") ||
    reasons.includes("REQUIRED_DATASET_COVERAGE_LOW")
  const failureCode = run.timedOut
    ? "PROCESS_TIMEOUT"
    : isCoverageShortage
      ? "DATA_COVERAGE_LOW"
      : isSignalShortage
        ? failureCodeOnSignalShortage
        : `${stageLabel}_FAIL`
  return {
    stage: stageLabel,
    status: run.status === 0 ? "PASS" : "FAIL",
    reason,
    failureCode,
    command: ["node", ...args],
    exitCode: run.status,
    durationMs: run.durationMs,
    timedOut: run.timedOut === true,
    timeoutMs: run.timeoutMs,
    logPath: path.join(attemptDir, logFileName),
    outputPath,
    details:
      payload && typeof payload === "object"
        ? payload
        : {
            pass: false,
            reasons: [`${stageLabel}_OUTPUT_MISSING`],
          },
  }
}

const parseIsoMs = (value) => {
  const ts = String(value ?? "").trim()
  if (!ts) return Number.NaN
  const ms = Date.parse(ts)
  return Number.isFinite(ms) ? ms : Number.NaN
}

const safeMtimeMs = (filePath) => {
  try {
    return Number(fs.statSync(filePath).mtimeMs)
  } catch {
    return Number.NaN
  }
}

const resolveLastUpdatedMs = ({
  heartbeat,
  progress,
  latest,
  manifest,
  heartbeatPath,
  progressPath,
  manifestPath,
}) => {
  const candidates = [
    parseIsoMs(heartbeat?.updatedAt),
    parseIsoMs(progress?.lastUpdatedAt),
    parseIsoMs(latest?.lastUpdatedAt),
    parseIsoMs(manifest?.startedAt),
    safeMtimeMs(heartbeatPath),
    safeMtimeMs(progressPath),
    safeMtimeMs(manifestPath),
  ].filter((value) => Number.isFinite(value))
  if (candidates.length === 0) {
    return Number.NaN
  }
  return Math.max(...candidates)
}

const reconcileStaleSessionDir = ({
  sessionId,
  sessionDir,
  latestIndexPath,
  latestSnapshot,
  sessionsIndexPath,
  staleThresholdMs = 10 * 60 * 1000,
}) => {
  const finalPath = path.join(sessionDir, "final_result.json")
  if (fs.existsSync(finalPath)) {
    return null
  }
  const heartbeatPath = path.join(sessionDir, "heartbeat.json")
  const progressPath = path.join(sessionDir, "session_progress.json")
  const manifestPath = path.join(sessionDir, "session_manifest.json")
  const riskPath = path.join(sessionDir, "risk_events.ndjson")
  const heartbeat = readJsonSafe(heartbeatPath) ?? {}
  const progress = readJsonSafe(progressPath) ?? {}
  const manifest = readJsonSafe(manifestPath) ?? {}
  const latest =
    String(latestSnapshot?.sessionId ?? "").trim() === sessionId
      ? latestSnapshot
      : {}
  const updatedAtMs = resolveLastUpdatedMs({
    heartbeat,
    progress,
    latest,
    manifest,
    heartbeatPath,
    progressPath,
    manifestPath,
  })
  if (!Number.isFinite(updatedAtMs)) {
    return null
  }
  const pidCandidates = [heartbeat?.pid, progress?.pid, latest?.pid]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 1)
  const alive = pidCandidates.some((pid) => isProcessAlive(pid))
  const ageMs = Date.now() - updatedAtMs
  const noPidGraceMs = 2 * 60 * 1000
  const noPidFastStale =
    !alive && pidCandidates.length > 0 && ageMs >= noPidGraceMs
  if (
    alive ||
    (!noPidFastStale &&
      ageMs <= Math.max(60_000, Math.floor(Number(staleThresholdMs) || 0)))
  ) {
    return null
  }
  const staleSeconds = Math.floor(ageMs / 1000)
  const endedAt = isoNow()
  appendNdjson(riskPath, {
    ts: endedAt,
    severity: "HIGH",
    code: "STALE_OR_CRASHED",
    stage: String(progress?.lastStage ?? "UNKNOWN"),
    attempt: Number(progress?.currentAttempt ?? 0) || 0,
    summary: `heartbeat stale for ${staleSeconds}s and process is not alive`,
    evidencePaths: [heartbeatPath, progressPath],
  })
  const nextProgress = {
    ...progress,
    sessionId,
    sessionDir,
    status: "STALE_OR_CRASHED",
    lastFailureCode: "STALE_OR_CRASHED",
    lastFailureDetail: `heartbeat stale for ${staleSeconds}s`,
    lastUpdatedAt: endedAt,
  }
  writeJson(progressPath, nextProgress)
  writeJson(finalPath, {
    sessionId,
    endedAt,
    result: {
      status: "STALE_OR_CRASHED",
      reason: "HEARTBEAT_STALE_AND_PROCESS_MISSING",
      staleSeconds,
    },
    rulesPath: manifest?.rulesPath ?? null,
    tuningPath: manifest?.tuningPath ?? null,
  })
  appendNdjson(sessionsIndexPath, {
    ts: endedAt,
    sessionId,
    event: "STALE_OR_CRASHED",
    status: "STALE_OR_CRASHED",
    sessionDir,
    staleSeconds,
  })
  if (String(latest?.sessionId ?? "").trim() === sessionId) {
    writeJson(latestIndexPath, {
      sessionId,
      sessionDir,
      pid: Number(nextProgress?.pid ?? 0) || 0,
      startedAt: String(nextProgress?.startedAt ?? ""),
      lastUpdatedAt: endedAt,
      status: "STALE_OR_CRASHED",
      currentAttempt: Number(nextProgress?.currentAttempt ?? 0) || 0,
      lastFailureCode: "STALE_OR_CRASHED",
      lastPassedStage: nextProgress?.lastPassedStage ?? null,
    })
  }
  return {
    sessionId,
    sessionDir,
    staleSeconds,
  }
}

const reconcileStaleSessions = ({
  automationRootDir,
  latestIndexPath,
  sessionsIndexPath,
  staleThresholdMs = 10 * 60 * 1000,
}) => {
  if (!fs.existsSync(automationRootDir)) {
    return { total: 0, reconciled: [] }
  }
  const latestSnapshot = readJsonSafe(latestIndexPath) ?? {}
  const dirs = fs
    .readdirSync(automationRootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "_index")
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))
  const reconciled = []
  for (const sessionId of dirs) {
    const sessionDir = path.join(automationRootDir, sessionId)
    const result = reconcileStaleSessionDir({
      sessionId,
      sessionDir,
      latestIndexPath,
      latestSnapshot,
      sessionsIndexPath,
      staleThresholdMs,
    })
    if (result?.sessionId) {
      reconciled.push(result)
    }
  }
  return { total: dirs.length, reconciled }
}

const run = async () => {
  loadLocalEnv()
  assertServerOnly({ script: "autosearch/auto_upgrade_loop" })
  assertNoKisRuntime({ script: "autosearch/auto_upgrade_loop" })

  const args = parseArgs()
  const automationRootDir = path.join(
    rootDir,
    "artifacts",
    "autosearch_automation",
  )
  const indexDir = path.join(automationRootDir, "_index")
  const latestIndexPath = path.join(indexDir, "latest.json")
  const sessionsIndexPath = path.join(indexDir, "sessions.ndjson")
  fs.mkdirSync(indexDir, { recursive: true })
  const sidecarCleanup = cleanupOrphanHeartbeatSidecars({ automationRootDir })
  if ((sidecarCleanup?.terminated?.length ?? 0) > 0) {
    console.warn(
      `[auto-upgrade] cleaned orphan heartbeat sidecars=${sidecarCleanup.terminated.length}/${sidecarCleanup.scanned}`,
    )
    for (const item of sidecarCleanup.terminated) {
      console.warn(
        `[auto-upgrade] cleaned sidecar pid=${item.sidecarPid} session=${item.sessionId ?? "unknown"} reason=${item.reason}`,
      )
    }
  }
  const reconciled = reconcileStaleSessions({
    automationRootDir,
    latestIndexPath,
    sessionsIndexPath,
  })
  if ((reconciled?.reconciled?.length ?? 0) > 0) {
    console.warn(
      `[auto-upgrade] reconciled stale sessions=${reconciled.reconciled.length}/${reconciled.total}`,
    )
    for (const item of reconciled.reconciled) {
      console.warn(
        `[auto-upgrade] reconciled stale session=${item.sessionId} staleSeconds=${item.staleSeconds}`,
      )
    }
  }
  const sessionId = args.sessionId || createSessionId()
  const sessionDir = path.join(automationRootDir, sessionId)
  fs.mkdirSync(sessionDir, { recursive: true })
  const runLockPath = path.join(indexDir, "auto_upgrade_loop.lock")
  const earlySessionProgressPath = path.join(
    sessionDir,
    "session_progress.json",
  )
  const earlySessionHeartbeatPath = path.join(sessionDir, "heartbeat.json")
  const earlySessionRiskPath = path.join(sessionDir, "risk_events.ndjson")

  // Set crash context before precheck throws so supervisor can read final status.
  runtimeCrashContext = {
    sessionId,
    sessionDir,
    runLockPath,
    latestIndexPath,
    sessionsIndexPath,
    sessionProgressPath: earlySessionProgressPath,
    sessionHeartbeatPath: earlySessionHeartbeatPath,
    sessionRiskPath: earlySessionRiskPath,
  }

  const rulesPath = resolveAbsolutePath(args.rulesPath)
  const tuningPath = resolveAbsolutePath(args.tuningPath)
  if (!rulesPath || !tuningPath) {
    throw new Error("rulesPath/tuningPath invalid")
  }
  const expectedTuningAbsPath = resolveAbsolutePath(expectedTuningPath)
  if (
    expectedTuningAbsPath &&
    path.resolve(tuningPath) !== path.resolve(expectedTuningAbsPath)
  ) {
    const error = new Error(
      `POLICY_CONFLICT_BLOCKED tuningPath must be ${expectedTuningPath}`,
    )
    error.code = "POLICY_CONFLICT_BLOCKED"
    throw error
  }
  runtimeCrashContext = {
    ...(runtimeCrashContext ?? {}),
    rulesPath,
    tuningPath,
  }
  const rulesLocked = args.rulesMutable !== true

  const existingRules = readJsonSafe(rulesPath)
  let rules = normalizeRulesLock(existingRules ?? DEFAULT_RULES_LOCK)
  if (existingRules === null) {
    writeJson(rulesPath, rules)
  } else if (!rulesLocked) {
    writeJsonIfChanged(rulesPath, rules)
  }
  let tuning = ensureJsonFile({
    filePath: tuningPath,
    defaultPayload: DEFAULT_TUNING,
    normalize: normalizeTuning,
  })
  const rulesSchema = validateRulesSchema(rules)
  const tuningSchema = validateTuningSchema(tuning)
  const schemaValidation = {
    ok: rulesSchema.ok && tuningSchema.ok,
    rulesErrors: rulesSchema.errors,
    tuningErrors: tuningSchema.errors,
  }
  writeJson(path.join(sessionDir, "schema_validation.json"), schemaValidation)
  if (!schemaValidation.ok) {
    const error = new Error(
      [
        "SCHEMA_INVALID",
        ...schemaValidation.rulesErrors,
        ...schemaValidation.tuningErrors,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    error.code = "SCHEMA_INVALID"
    throw error
  }
  if (rulesLocked) {
    console.log("[auto-upgrade] immutable rule lock enabled")
  }
  const sourceIdentity = resolveSourceIdentity({ rulesPath, tuningPath })
  const mutableDirtyAllowlist = new Set(
    [path.relative(rootDir, tuningPath).replace(/\\/g, "/"), expectedTuningPath]
      .map((item) => String(item ?? "").trim())
      .filter(Boolean),
  )
  const dirtyFiles = Array.isArray(sourceIdentity?.git?.dirtyFiles)
    ? sourceIdentity.git.dirtyFiles
        .map((item) =>
          String(item ?? "")
            .trim()
            .replace(/\\/g, "/"),
        )
        .filter(Boolean)
    : []
  const isMutableDirtyFile = (item) => {
    const normalized = String(item ?? "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
    if (!normalized) return false
    if (mutableDirtyAllowlist.has(normalized)) return true
    return (
      normalized.endsWith("/scripts/autosearch/config/tuning.mutable.json") ||
      normalized.endsWith("scripts/autosearch/config/tuning.mutable.json")
    )
  }
  const blockingDirtyFiles = dirtyFiles.filter(
    (item) => !isMutableDirtyFile(item),
  )
  if (sourceIdentity?.git?.available !== true) {
    console.warn(
      `[auto-upgrade] source-trace git unavailable reason=${sourceIdentity?.git?.reason ?? "UNKNOWN"} snapshotHash=${String(sourceIdentity?.snapshotHash ?? "").slice(0, 16)}`,
    )
  } else if (blockingDirtyFiles.length > 0) {
    console.warn(
      `[auto-upgrade] source-trace dirty worktree detected dirtyCount=${blockingDirtyFiles.length} head=${sourceIdentity?.git?.shortHead ?? "unknown"} files=${blockingDirtyFiles.slice(0, 5).join(",")}`,
    )
  } else if (dirtyFiles.length > 0) {
    console.warn(
      `[auto-upgrade] source-trace mutable dirty ignored count=${dirtyFiles.length} head=${sourceIdentity?.git?.shortHead ?? "unknown"}`,
    )
  }
  if (tuning.precheckRequireCleanGit !== false) {
    if (sourceIdentity?.git?.available !== true) {
      const error = new Error(
        "DIRTY_TREE_BLOCKED git unavailable in strict mode",
      )
      error.code = "DIRTY_TREE_BLOCKED"
      throw error
    }
    if (blockingDirtyFiles.length > 0) {
      const error = new Error(
        `DIRTY_TREE_BLOCKED dirtyCount=${blockingDirtyFiles.length}`,
      )
      error.code = "DIRTY_TREE_BLOCKED"
      throw error
    }
  }
  const secretEnvHits = detectSecretEnvFiles({ rootDir })
  writeJson(path.join(sessionDir, "secret_env_scan.json"), {
    scannedAt: isoNow(),
    hitCount: secretEnvHits.length,
    hits: secretEnvHits,
    blockOnSecrets: tuning.precheckBlockOnSecretFiles === true,
  })
  if (secretEnvHits.length > 0) {
    const msg = `[auto-upgrade] secret-env scan hitCount=${secretEnvHits.length}`
    if (tuning.precheckBlockOnSecretFiles === true) {
      const error = new Error(`SECRET_FILE_DETECTED ${msg}`)
      error.code = "SECRET_FILE_DETECTED"
      throw error
    }
    console.warn(msg)
  }

  const loopRunLock = await acquireLoopRunLock({
    lockPath: runLockPath,
    sessionId,
    staleMs: tuning.runLockStaleMs,
    retries: tuning.runLockAcquireRetries,
    retryDelayMs: tuning.runLockRetryDelayMs,
  })
  writeJson(path.join(sessionDir, "run_lock.json"), loopRunLock)
  if (loopRunLock.acquired !== true) {
    const error = new Error(
      `RUN_LOCK_HELD reason=${loopRunLock.reason ?? "LOCK_HELD"} ownerPid=${loopRunLock.ownerPid ?? "unknown"}`,
    )
    error.code = "RUN_LOCK_HELD"
    throw error
  }
  runtimeCrashContext = {
    sessionId,
    sessionDir,
    rulesPath,
    tuningPath,
    runLockPath,
    latestIndexPath,
    sessionsIndexPath,
    sessionProgressPath: path.join(sessionDir, "session_progress.json"),
    sessionHeartbeatPath: path.join(sessionDir, "heartbeat.json"),
    sessionRiskPath: path.join(sessionDir, "risk_events.ndjson"),
  }

  const maxAttempts = args.maxAttemptsOverride ?? tuning.maxAttempts
  const stateMachine = createStateMachine({
    initialState: "PRECHECK",
  })
  const stateMachinePath = path.join(sessionDir, "state_machine.ndjson")
  appendNdjson(stateMachinePath, {
    ts: isoNow(),
    from: null,
    to: stateMachine.current,
    accepted: true,
    note: "SESSION_INIT",
  })
  const sessionManifest = {
    sessionId,
    startedAt: isoNow(),
    args,
    rulesLocked,
    rulesPath,
    tuningPath,
    maxAttempts,
    autoApply: args.autoApply,
    dryRunOnly: args.dryRunOnly,
    resumeStatePath: path.join(indexDir, "resume_state.json"),
    profileStatsPath: path.join(indexDir, "profile_stats.json"),
    sourceIdentity,
    runLockPath,
    rootCauseClassCatalog: ROOT_CAUSE_CLASS_CATALOG,
    schemaValidation,
  }
  writeJson(path.join(sessionDir, "session_manifest.json"), sessionManifest)
  const sessionStartMs = Date.parse(sessionManifest.startedAt) || Date.now()
  const sessionProgressPath = path.join(sessionDir, "session_progress.json")
  const sessionHeartbeatPath = path.join(sessionDir, "heartbeat.json")
  const sessionRiskPath = path.join(sessionDir, "risk_events.ndjson")
  const sessionMilestonePath = path.join(sessionDir, "milestones.ndjson")
  const sessionSummaryPath = path.join(sessionDir, "summary.md")
  const progressState = {
    sessionId,
    sessionDir,
    pid: process.pid,
    startedAt: sessionManifest.startedAt,
    lastUpdatedAt: sessionManifest.startedAt,
    status: "RUNNING",
    currentAttempt: 0,
    attemptsStarted: 0,
    attemptsCompleted: 0,
    passCount: 0,
    failCount: 0,
    milestonesCount: 0,
    riskEventsCount: 0,
    lastStage: "INIT",
    lastFailureCode: null,
    lastFailureDetail: null,
    lastPassedStage: null,
    lastMilestone: null,
    lastMilestoneStatus: null,
    lastRiskCode: null,
    lastRiskStage: null,
    lastRiskAt: null,
  }
  const writeLatestIndex = () => {
    writeJson(latestIndexPath, {
      sessionId,
      sessionDir,
      pid: process.pid,
      startedAt: progressState.startedAt,
      lastUpdatedAt: progressState.lastUpdatedAt,
      status: progressState.status,
      currentAttempt: progressState.currentAttempt,
      lastFailureCode: progressState.lastFailureCode,
      lastPassedStage: progressState.lastPassedStage,
    })
  }
  const appendSessionIndex = (event, extra = {}) => {
    appendNdjson(sessionsIndexPath, {
      ts: isoNow(),
      sessionId,
      sessionDir,
      event,
      status: progressState.status,
      currentAttempt: progressState.currentAttempt,
      ...extra,
    })
  }
  const transitionState = ({
    nextState,
    attempt = 0,
    stage = null,
    note = "",
  }) => {
    const result = stateMachine.transition(nextState, note)
    appendNdjson(stateMachinePath, {
      ts: isoNow(),
      sessionId,
      attempt,
      stage,
      from: result.from ?? stateMachine.current,
      to: result.to ?? nextState,
      accepted: result.ok === true,
      code: result.code ?? null,
      detail: result.detail ?? null,
      note,
    })
    return result
  }
  const touchHeartbeat = ({
    attempt = progressState.currentAttempt,
    stage = progressState.lastStage,
    phase = progressState.status,
    timeoutMs = 0,
  } = {}) => {
    writeJson(sessionHeartbeatPath, {
      sessionId,
      sessionDir,
      pid: process.pid,
      updatedAt: isoNow(),
      status: progressState.status,
      phase,
      attempt,
      stage,
      timeoutMs,
    })
  }
  const updateProgress = (patch = {}, heartbeatMeta = null) => {
    Object.assign(progressState, patch)
    progressState.lastUpdatedAt = isoNow()
    progressState.pid = process.pid
    writeJson(sessionProgressPath, progressState)
    writeLatestIndex()
    if (heartbeatMeta) {
      touchHeartbeat(heartbeatMeta)
    }
  }
  const buildHeartbeatTicker = ({
    attempt = 0,
    stage = "UNKNOWN",
    timeoutMs = 0,
  }) => ({
    heartbeatPath: sessionHeartbeatPath,
    progressPath: sessionProgressPath,
    latestIndexPath,
    sessionId,
    sessionDir,
    pid: process.pid,
    status: progressState.status,
    phase: "RUNNING_STAGE",
    attempt,
    stage,
    timeoutMs,
    intervalMs: 15000,
  })
  const recordRisk = ({
    attempt = progressState.currentAttempt,
    stage = progressState.lastStage,
    severity = "WARN",
    code = "UNKNOWN_RISK",
    summary = "",
    evidencePaths = [],
  }) => {
    const entry = {
      ts: isoNow(),
      sessionId,
      attempt,
      stage,
      severity,
      code,
      summary: String(summary ?? "").trim(),
      evidencePaths: Array.isArray(evidencePaths)
        ? evidencePaths.filter((item) => String(item ?? "").trim())
        : [],
    }
    appendNdjson(sessionRiskPath, entry)
    updateProgress({
      riskEventsCount: (Number(progressState.riskEventsCount ?? 0) || 0) + 1,
      lastRiskCode: code,
      lastRiskStage: stage,
      lastRiskAt: entry.ts,
      lastFailureCode: code,
      lastFailureDetail: entry.summary || progressState.lastFailureDetail,
    })
  }
  const recordMilestone = ({
    name,
    attempt = progressState.currentAttempt,
    stage = progressState.lastStage,
    status = "PASS",
    details = null,
  }) => {
    const entry = {
      ts: isoNow(),
      sessionId,
      attempt,
      stage,
      name: String(name ?? "").trim() || "MILESTONE",
      status: String(status ?? "PASS")
        .trim()
        .toUpperCase(),
      details: details ?? null,
    }
    appendNdjson(sessionMilestonePath, entry)
    updateProgress({
      milestonesCount: (Number(progressState.milestonesCount ?? 0) || 0) + 1,
      passCount:
        (Number(progressState.passCount ?? 0) || 0) +
        (entry.status === "PASS" ? 1 : 0),
      failCount:
        (Number(progressState.failCount ?? 0) || 0) +
        (entry.status === "FAIL" ? 1 : 0),
      lastMilestone: entry.name,
      lastMilestoneStatus: entry.status,
      lastPassedStage:
        entry.status === "PASS"
          ? `${entry.stage}:${entry.name}`
          : progressState.lastPassedStage,
    })
  }
  updateProgress(
    {
      status: "RUNNING",
      lastStage: "INIT",
    },
    { attempt: 0, stage: "INIT", phase: "STARTED", timeoutMs: 0 },
  )
  appendSessionIndex("STARTED", { pid: process.pid })
  runtimeCrashContext = {
    sessionId,
    sessionDir,
    rulesPath,
    tuningPath,
    runLockPath,
    latestIndexPath,
    sessionsIndexPath,
    sessionProgressPath,
    sessionHeartbeatPath,
    sessionRiskPath,
  }
  const progressPulse = setInterval(() => {
    if (String(progressState.status ?? "").toUpperCase() !== "RUNNING") {
      return
    }
    progressState.lastUpdatedAt = isoNow()
    progressState.pid = process.pid
    writeJson(sessionProgressPath, progressState)
    writeLatestIndex()
  }, 15_000)
  if (typeof progressPulse.unref === "function") {
    progressPulse.unref()
  }

  const resumeStatePath = path.join(indexDir, "resume_state.json")
  const profileStatsPath = path.join(indexDir, "profile_stats.json")
  const initialFingerprintCarryLimit = Math.max(
    0,
    Math.floor(Number(tuning.failureFingerprintCarryLimit ?? 320) || 320),
  )
  let resumeState = normalizeResumeState(
    readJsonSafe(resumeStatePath),
    initialFingerprintCarryLimit,
  )
  const resumeFailureCode = String(resumeState.lastFailureCode ?? "")
    .trim()
    .toUpperCase()
  let sameFailureCode = resumeFailureCode || null
  let sameFailureStreak = 0
  let sameFailureSignature = resumeState.sameFailureSignature
  let sameFailureSignatureStreak = resumeState.sameFailureSignatureStreak
  let qualityCollapseResetCounts = normalizeQualityCollapseResetCounts(
    resumeState.qualityCollapseResetCounts,
  )
  let lastFailureDetail = String(resumeState.lastFailureDetail ?? "").trim()
  let structuralFailures = 0
  let qualityFailures = 0
  let transientFailures = 0
  let securityFailures = 0
  let precheckAutoRecoveryCount = 0
  let dryPassStreak = 0
  let recentFailureFingerprints = resumeState.failureFingerprints
  let finalResult = null
  let coverageCursor = resumeState.coverageCursor
  const coverageLedgerPath = path.join(sessionDir, "coverage_ledger.json")
  const dataSyncLedgerPath = path.join(indexDir, "data_sync_ledger.json")
  const dataSyncLockPath = path.join(indexDir, "data_sync.lock")
  const blockedFingerprintsPath = path.join(
    sessionDir,
    "blocked_fingerprints.json",
  )
  const quarantinePath = path.join(indexDir, "quarantine.json")
  const persistResumeState = (patch = {}) => {
    const carryLimit = Math.max(
      0,
      Math.floor(Number(tuning.failureFingerprintCarryLimit ?? 320) || 320),
    )
    resumeState = normalizeResumeState(
      {
        ...resumeState,
        ...patch,
        sessionId,
        updatedAt: isoNow(),
      },
      carryLimit,
    )
    writeJsonIfChanged(resumeStatePath, resumeState)
  }
  persistResumeState({
    coverageCursor,
    sameFailureSignature,
    sameFailureSignatureStreak,
    qualityCollapseResetCounts,
    failureFingerprints: recentFailureFingerprints,
    lastFailureCode: resumeState.lastFailureCode,
    lastFailureClass: resumeState.lastFailureClass,
    lastFailureDetail: resumeState.lastFailureDetail,
  })
  let dataSyncLedger = normalizeDataSyncLedger(readJsonSafe(dataSyncLedgerPath))
  writeJsonIfChanged(dataSyncLedgerPath, dataSyncLedger)
  let profileStatsStore = normalizeProfileStatsStore({
    raw: readJsonSafe(profileStatsPath),
    profiles: EXPLORATION_PROFILES,
  })
  writeJsonIfChanged(profileStatsPath, profileStatsStore)
  let quarantineStore = normalizeQuarantineStore(
    readJsonSafe(quarantinePath),
    tuning.quarantineMaxEntries,
  )
  writeJsonIfChanged(quarantinePath, quarantineStore)
  let prisma = null
  try {
    prisma = new PrismaClient()
  } catch {
    prisma = null
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const runtimeLimitMinutes = Math.max(
      0,
      Math.floor(Number(tuning.maxRuntimeMinutes ?? 0) || 0),
    )
    const elapsedMs = Date.now() - sessionStartMs
    if (
      runtimeLimitMinutes > 0 &&
      elapsedMs >= runtimeLimitMinutes * 60 * 1000
    ) {
      finalResult = {
        status: "STOPPED_BY_RUNTIME_LIMIT",
        attempt: Math.max(1, attempt - 1),
        runtimeLimitMinutes,
        runtimeElapsedMinutes: Math.floor(elapsedMs / 60000),
        sessionId,
      }
      updateProgress(
        {
          status: "STOPPED_BY_RUNTIME_LIMIT",
          lastAttemptStatus: "STOPPED_BY_RUNTIME_LIMIT",
        },
        {
          attempt: Math.max(1, attempt - 1),
          stage: String(progressState.lastStage ?? "UNKNOWN"),
          phase: "SESSION_STOPPED",
          timeoutMs: 0,
        },
      )
      appendSessionIndex("SESSION_STOPPED", {
        attempt: Math.max(1, attempt - 1),
        reason: "RUNTIME_LIMIT",
        runtimeLimitMinutes,
      })
      persistResumeState({
        coverageCursor,
        sameFailureSignature,
        sameFailureSignatureStreak,
        qualityCollapseResetCounts,
        failureFingerprints: recentFailureFingerprints,
        lastFailureCode: "STOPPED_BY_RUNTIME_LIMIT",
        lastFailureClass: "STRUCTURAL",
        lastFailureDetail: `RUNTIME_LIMIT_${runtimeLimitMinutes}`,
      })
      break
    }
    console.log(`[auto-upgrade] attempt=${attempt} maxAttempts=${maxAttempts}`)
    updateProgress(
      {
        status: "RUNNING",
        currentAttempt: attempt,
        attemptsStarted: (Number(progressState.attemptsStarted ?? 0) || 0) + 1,
        lastStage: "PRECHECK",
      },
      {
        attempt,
        stage: "PRECHECK",
        phase: "ATTEMPT_START",
        timeoutMs: 0,
      },
    )
    transitionState({
      nextState: "PRECHECK",
      attempt,
      stage: "PRECHECK",
      note: "ATTEMPT_START",
    })
    appendSessionIndex("ATTEMPT_START", { attempt })
    const attemptDir = path.join(
      sessionDir,
      `attempt_${String(attempt).padStart(3, "0")}`,
    )
    fs.mkdirSync(attemptDir, { recursive: true })
    const onDiskRules = normalizeRulesLock(
      readJsonSafe(rulesPath) ?? DEFAULT_RULES_LOCK,
    )
    if (stableStringify(onDiskRules) !== stableStringify(rules)) {
      if (rulesLocked) {
        writeJsonIfChanged(rulesPath, rules)
        recordRisk({
          attempt,
          stage: "PRECHECK",
          severity: "MEDIUM",
          code: "RULE_LOCK_DRIFT_RESTORED",
          summary: "Detected external rules drift and restored locked rules.",
          evidencePaths: [rulesPath],
        })
      } else {
        rules = onDiskRules
      }
    }
    const coveragePlan = resolveCoveragePlan({
      tuning,
      cursor: coverageCursor,
    })
    const quarantineResolved = resolveActiveQuarantineFingerprints({
      store: quarantineStore,
      nowIso: isoNow(),
      maxEntries: tuning.quarantineMaxEntries,
    })
    quarantineStore = quarantineResolved.nextStore
    writeJsonIfChanged(quarantinePath, quarantineStore)
    const activeQuarantineFingerprints = Array.isArray(
      quarantineResolved.activeFingerprints,
    )
      ? quarantineResolved.activeFingerprints
      : []
    const blockedFingerprintsCombined = Array.from(
      new Set([...recentFailureFingerprints, ...activeQuarantineFingerprints]),
    )
    if (blockedFingerprintsCombined.length > 0) {
      writeJson(blockedFingerprintsPath, {
        sessionId,
        updatedAt: new Date().toISOString(),
        count: blockedFingerprintsCombined.length,
        carriedCount: recentFailureFingerprints.length,
        quarantineCount: activeQuarantineFingerprints.length,
        fingerprints: blockedFingerprintsCombined,
      })
    }
    writeJson(path.join(attemptDir, "run_manifest.json"), {
      sessionId,
      attempt,
      startedAt: new Date().toISOString(),
      rules: redactSensitiveObject(rules),
      tuning: redactSensitiveObject(tuning),
      sourceIdentity: {
        capturedAt: sourceIdentity?.capturedAt ?? null,
        snapshotHash: sourceIdentity?.snapshotHash ?? null,
        snapshotFileCount: Number(sourceIdentity?.snapshotFileCount ?? 0) || 0,
        git: sourceIdentity?.git ?? null,
      },
      runLockPath,
      schemaValidation,
      stateMachineState: stateMachine.current,
      coveragePlan,
      dryPassStreak,
      blockedFingerprints:
        blockedFingerprintsCombined.length > 0
          ? {
              path: blockedFingerprintsPath,
              count: blockedFingerprintsCombined.length,
              carriedCount: recentFailureFingerprints.length,
              quarantineCount: activeQuarantineFingerprints.length,
            }
          : null,
    })

    const env = {
      ...process.env,
      ...tuning.envOverrides,
      BACKFILL_KIS_ENABLED: "0",
      GOLIVE_MIN_WORST2W_AVG_PCT: String(rules.minWorst2wAvgPct),
      CYCLE_MIN_WORST2W_AVG_PCT: String(rules.minWorst2wAvgPct),
    }

    const stageResults = []
    const memoryHeadroom = readMemoryHeadroom(tuning)
    const runtimeAttempt = buildRuntimeAttemptTuning({
      tuning,
      attempt,
      sameFailureStreak,
      sameFailureSignatureStreak,
      coveragePlan,
      memoryHeadroom,
      failureCode: sameFailureCode,
      failureDetail: lastFailureDetail,
      profileStatsStore,
    })
    const runtimeTuning = runtimeAttempt.runtimeTuning
    env.GOLIVE_POOL_ACTIVE_LIMIT_SURGE = String(
      Math.max(
        1,
        Number(runtimeTuning?.poolActiveLimitByTrack?.SURGE_EOD ?? 5) || 5,
      ),
    )
    env.GOLIVE_POOL_ACTIVE_LIMIT_GAP = String(
      Math.max(
        1,
        Number(runtimeTuning?.poolActiveLimitByTrack?.GAP_15_BET ?? 3) || 3,
      ),
    )
    env.GOLIVE_POOL_BENCH_LIMIT_SURGE = String(
      Math.max(
        0,
        Number(runtimeTuning?.poolBenchLimitByTrack?.SURGE_EOD ?? 10) || 10,
      ),
    )
    env.GOLIVE_POOL_BENCH_LIMIT_GAP = String(
      Math.max(
        0,
        Number(runtimeTuning?.poolBenchLimitByTrack?.GAP_15_BET ?? 6) || 6,
      ),
    )
    env.GOLIVE_POOL_MIN_ALIVE_SURGE = String(
      Math.max(
        1,
        Number(runtimeTuning?.poolMinAliveByTrack?.SURGE_EOD ?? 3) || 3,
      ),
    )
    env.GOLIVE_POOL_MIN_ALIVE_GAP = String(
      Math.max(
        1,
        Number(runtimeTuning?.poolMinAliveByTrack?.GAP_15_BET ?? 2) || 2,
      ),
    )
    env.GOLIVE_STAGE2_TOPK_SURGE = String(
      Math.max(
        1,
        Number(runtimeTuning?.stage2TopKByTrack?.SURGE_EOD ?? 4) || 4,
      ),
    )
    env.GOLIVE_STAGE2_TOPK_GAP = String(
      Math.max(
        1,
        Number(runtimeTuning?.stage2TopKByTrack?.GAP_15_BET ?? 3) || 3,
      ),
    )
    env.GOLIVE_ALLOW_UNSAFE_GAP_CHART_FALLBACK =
      runtimeTuning?.allowUnsafeGapChartFallbackStage1 === true ? "1" : "0"
    const timeoutMs = {
      dataSync: resolveStageTimeoutMs(tuning, "dataSync"),
      derive: resolveStageTimeoutMs(tuning, "derive"),
      signalPreflight: resolveStageTimeoutMs(tuning, "signalPreflight"),
      trainValidate: resolveStageTimeoutMs(tuning, "trainValidate"),
      deployApply: resolveStageTimeoutMs(tuning, "deployApply"),
      verify: resolveStageTimeoutMs(tuning, "verify"),
    }
    stageResults.push({
      stage: "PRECHECK",
      status: "PASS",
      reason: null,
      details: {
        tracks: rules.tracks,
        requiredTracks: rules.requiredTracks,
        targetPct: rules.targetPct,
        minWorst2wAvgPct: rules.minWorst2wAvgPct,
        highWeekPct: rules.highWeekPct,
        minHighWeeks: rules.minHighWeeks,
        nearHighWeeks: rules.nearHighWeeks,
        minOtherWeekPct: rules.minOtherWeekPct,
        requireCompletedTradesEveryWeek: rules.requireCompletedTradesEveryWeek,
        timeoutMs,
        memoryHeadroom,
        preflight: {
          enabled: tuning.preflightEnabled !== false,
          signalWindowTradingDays: Math.max(
            1,
            Number(tuning.preflightSignalWindowTradingDays ?? 28) || 28,
          ),
          minTradingDays: Math.max(
            1,
            Number(tuning.preflightMinTradingDays ?? 16) || 16,
          ),
          minUniverseSize: Math.max(
            0,
            Number(tuning.preflightMinUniverseSize ?? 1) || 1,
          ),
          minSignalsLoaded: Math.max(
            0,
            Number(tuning.preflightMinSignalsLoaded ?? 1) || 1,
          ),
          requireQualifiedSignals:
            tuning.preflightRequireQualifiedSignals === true,
          minQualifiedSignals: Math.max(
            0,
            Number(tuning.preflightMinQualifiedSignals ?? 0) || 0,
          ),
        },
        runtimeTuning: runtimeAttempt.runtimeMeta,
        coveragePlan,
      },
    })
    const precheckSignalStage = runSignalPreflight({
      rules,
      tuning,
      env,
      attemptDir,
      timeoutMs: timeoutMs.signalPreflight,
      heartbeatTicker: buildHeartbeatTicker({
        attempt,
        stage: "PRECHECK_SIGNAL_GUARD",
        timeoutMs: timeoutMs.signalPreflight,
      }),
      stageLabel: "PRECHECK_SIGNAL_GUARD",
      outputFileName: "precheck_signal_guard.json",
      logFileName: "precheck_signal_guard.log",
      failureCodeOnSignalShortage: "SIGNAL_PREFLIGHT_FAIL",
    })
    stageResults.push(precheckSignalStage)
    if (precheckSignalStage.status === "FAIL") {
      const recoveryLimit = Math.max(
        0,
        Number(tuning.precheckStructuralRecoveryAttempts ?? 1) || 1,
      )
      const canRecover = precheckAutoRecoveryCount < recoveryLimit
      const failure = {
        code: "PREFLIGHT_INVARIANT_FAIL",
        detail: String(
          precheckSignalStage.reason ?? "PRECHECK_SIGNAL_GUARD_FAIL",
        ),
      }
      writeJson(path.join(attemptDir, "failure_report.json"), failure)
      writeJson(path.join(attemptDir, "root_cause.json"), {
        ts: isoNow(),
        attempt,
        stage: "PRECHECK",
        code: failure.code,
        detail: failure.detail,
        class: classifyFailureClass(failure.code),
        precheckSignalGuard: redactSensitiveObject(precheckSignalStage.details),
        canRecover,
        recoveryLimit,
        precheckAutoRecoveryCount,
      })
      if (canRecover) {
        precheckAutoRecoveryCount += 1
        tuning = normalizeTuning({
          ...tuning,
          dataSyncEnabled: true,
          forceDataSyncNextAttempt: true,
          retryBackoffMs: Math.max(
            15_000,
            Number(tuning.retryBackoffMs ?? 0) || 0,
          ),
        })
        writeJsonIfChanged(tuningPath, tuning)
        recordRisk({
          attempt,
          stage: "PRECHECK",
          severity: "HIGH",
          code: "PREFLIGHT_AUTO_RECOVERY_ARMED",
          summary: `precheck invariant fail, armed one data-sync auto-recovery (${precheckAutoRecoveryCount}/${recoveryLimit})`,
          evidencePaths: [
            path.join(attemptDir, "precheck_signal_guard.json"),
            path.join(attemptDir, "root_cause.json"),
          ],
        })
      } else {
        finalResult = {
          status: "STOPPED_BY_PREFLIGHT_INVARIANT",
          attempt,
          failureCode: failure.code,
          detail: failure.detail,
          sessionId,
        }
        updateProgress(
          {
            status: "STOPPED_BY_PREFLIGHT_INVARIANT",
            lastAttemptStatus: "STOPPED_BY_PREFLIGHT_INVARIANT",
            attemptsCompleted:
              (Number(progressState.attemptsCompleted ?? 0) || 0) + 1,
            lastStage: "PRECHECK",
          },
          {
            attempt,
            stage: "PRECHECK",
            phase: "SESSION_STOPPED",
            timeoutMs: 0,
          },
        )
        appendSessionIndex("SESSION_STOPPED", {
          attempt,
          reason: "PREFLIGHT_INVARIANT_FAIL",
        })
        break
      }
    }

    if (memoryHeadroom.stop) {
      console.warn(
        `[auto-upgrade] memory-guard stop(before precheck) freeMb=${memoryHeadroom.freeMb} totalMb=${memoryHeadroom.totalMb} freeRatio=${memoryHeadroom.freeRatio.toFixed(3)}`,
      )
      const failure = {
        code: "OOM_RISK",
        detail:
          "MEMORY_HEADROOM_LOW_PRECHECK" +
          ` freeMb=${memoryHeadroom.freeMb} totalMb=${memoryHeadroom.totalMb} freeRatio=${memoryHeadroom.freeRatio.toFixed(3)}`,
      }
      const plan = planAutoActions({
        failureCode: failure.code,
        failureDetail: failure.detail,
        tuning,
        rules,
        sameFailureStreak: 1,
        successEval: null,
      })
      const prevRules = rules
      const prevTuning = tuning
      const tuningPolicy = applyDeterministicTuningPolicy({
        previousTuning: prevTuning,
        plannedTuning: plan.nextTuning,
      })
      const nextTuning = tuningPolicy.nextTuning
      const { nextRules, actionItems, rulesDriftBlocked, proposedRules } =
        applyRuleLockToPlan({ rules, plan, rulesLocked })
      writeJson(path.join(attemptDir, "failure_report.json"), failure)
      writeJson(path.join(attemptDir, "action_plan.json"), actionItems)
      writeJson(path.join(attemptDir, "root_cause.json"), {
        ts: isoNow(),
        attempt,
        stage: "PRECHECK",
        code: failure.code,
        detail: failure.detail,
        class: classifyFailureClass(failure.code),
        forced: null,
        decision: null,
        evidencePaths: [],
      })
      rules = nextRules
      tuning = nextTuning
      if (!rulesLocked) {
        writeJsonIfChanged(rulesPath, rules)
      }
      writeJsonIfChanged(tuningPath, tuning)
      writeJson(path.join(attemptDir, "action_result.json"), {
        previousRules: prevRules,
        nextRules,
        proposedRules,
        rulesDriftBlocked,
        ruleLockMode: rulesLocked ? "IMMUTABLE" : "MUTABLE",
        previousTuning: redactSensitiveObject(prevTuning),
        nextTuning: redactSensitiveObject(nextTuning),
        tuningPolicy: tuningPolicy.policy,
      })
      writeJson(path.join(attemptDir, "attempt_result.json"), {
        finalResult: null,
        stageResults,
      })
      recordRisk({
        attempt,
        stage: "PRECHECK",
        severity: "HIGH",
        code: failure.code,
        summary: failure.detail,
        evidencePaths: [
          path.join(attemptDir, "failure_report.json"),
          path.join(attemptDir, "attempt_result.json"),
        ],
      })
      recordMilestone({
        name: "ATTEMPT_FAIL",
        attempt,
        stage: "PRECHECK",
        status: "FAIL",
        details: { code: failure.code },
      })
      updateProgress(
        {
          attemptsCompleted:
            (Number(progressState.attemptsCompleted ?? 0) || 0) + 1,
          lastAttemptStatus: "FAIL",
          lastStage: "PRECHECK",
        },
        {
          attempt,
          stage: "PRECHECK",
          phase: "ATTEMPT_FAIL",
          timeoutMs: 0,
        },
      )
      appendSessionIndex("ATTEMPT_FAIL", {
        attempt,
        stage: "PRECHECK",
        code: failure.code,
      })
      const waitMs = Math.max(
        resolveRetryBackoffMs(tuning),
        Number(memoryHeadroom.cooldownMs ?? 0),
      )
      if (waitMs > 0) {
        await sleep(waitMs)
      }
      dryPassStreak = 0
      continue
    }

    let dataSyncDecision = await resolveDataSyncDecision({
      attempt,
      tuning,
      ledger: dataSyncLedger,
      prisma,
      asOfHint: rules?.asOfInput,
    })
    let dataSyncLock = null
    if (dataSyncDecision.run === true) {
      dataSyncLock = acquireDataSyncLock({
        lockPath: dataSyncLockPath,
        sessionId,
        attempt,
        syncDateKey: dataSyncDecision.syncDateKey,
        market: dataSyncDecision.market,
      })
      if (dataSyncLock.acquired !== true) {
        dataSyncDecision = {
          ...dataSyncDecision,
          run: false,
          reason: "INFLIGHT_SYNC_LOCKED",
          lock: dataSyncLock,
        }
      } else {
        dataSyncLedger = buildDataSyncInflightLedger({
          ledger: dataSyncLedger,
          sessionId,
          attempt,
          decision: dataSyncDecision,
          lockPath: dataSyncLockPath,
        })
        writeJson(dataSyncLedgerPath, dataSyncLedger)
      }
    }
    if (dataSyncDecision.run === true) {
      const signalGapToken =
        dataSyncDecision?.signalGapRepair &&
        typeof dataSyncDecision.signalGapRepair === "object"
          ? ` signalGap=${String(dataSyncDecision.signalGapRepair.fromDateKey ?? "").trim() || "?"}~${String(dataSyncDecision.signalGapRepair.toDateKey ?? "").trim() || "?"} stopAfter=${String(dataSyncDecision.signalGapRepair.stopAfter ?? "").trim() || "recommend"}`
          : ""
      console.log(
        `[auto-upgrade] DATA_SYNC plan mode=${dataSyncDecision.policy?.mode ?? "smart"} tier=${dataSyncDecision.tier ?? "FULL"} reason=${dataSyncDecision.tierReason ?? "NONE"} syncDate=${dataSyncDecision.syncDateKey ?? "unknown"}${signalGapToken}`,
      )
    }
    updateProgress(
      {
        lastStage: "DATA_SYNC",
      },
      {
        attempt,
        stage: "DATA_SYNC",
        phase: "RUNNING_STAGE",
        timeoutMs: timeoutMs.dataSync,
      },
    )
    const buildInputsTransition = transitionState({
      nextState: "BUILD_INPUTS",
      attempt,
      stage: "DATA_SYNC",
      note: "ENTER_BUILD_INPUTS",
    })
    if (!buildInputsTransition.ok) {
      const failure = {
        code: "STATE_MACHINE_VIOLATION",
        detail: buildInputsTransition.detail,
      }
      writeJson(path.join(attemptDir, "failure_report.json"), failure)
      finalResult = {
        status: "STOPPED_BY_STATE_MACHINE",
        attempt,
        failureCode: failure.code,
        detail: failure.detail,
        sessionId,
      }
      break
    }
    const dataSyncNoOutputTimeoutMs = Math.max(
      0,
      Number(tuning?.dataSyncNoOutputTimeoutMs ?? 0) || 0,
    )
    const dataSyncForcedNoOutputTimeoutMs = Math.max(
      0,
      Number(tuning?.dataSyncForcedNoOutputTimeoutMs ?? 0) || 0,
    )
    const effectiveDataSyncNoOutputTimeoutMs =
      dataSyncDecision?.forced === true && dataSyncForcedNoOutputTimeoutMs > 0
        ? dataSyncNoOutputTimeoutMs > 0
          ? Math.max(dataSyncNoOutputTimeoutMs, dataSyncForcedNoOutputTimeoutMs)
          : dataSyncForcedNoOutputTimeoutMs
        : dataSyncNoOutputTimeoutMs
    let dataSyncStageBase = null
    try {
      dataSyncStageBase = await runOptionalCommandStage({
        stage: "DATA_SYNC",
        enabled: dataSyncDecision.run === true,
        disabledReason: dataSyncDecision.reason,
        command: dataSyncDecision.command ?? tuning.dataSyncCommand,
        env,
        attemptDir,
        timeoutMs: timeoutMs.dataSync,
        stallNoOutputMs: effectiveDataSyncNoOutputTimeoutMs,
        stallMinElapsedMs: Math.max(
          0,
          Number(tuning?.dataSyncNoOutputMinElapsedMs ?? 0) || 0,
        ),
        liveOutput: dataSyncDecision.run === true,
        heartbeatTicker: buildHeartbeatTicker({
          attempt,
          stage: "DATA_SYNC",
          timeoutMs: timeoutMs.dataSync,
        }),
      })
    } finally {
      if (dataSyncLock?.acquired === true) {
        const release = releaseDataSyncLock({
          lockPath: dataSyncLockPath,
          sessionId,
        })
        if (release.released !== true) {
          recordRisk({
            attempt,
            stage: "DATA_SYNC",
            severity: "MEDIUM",
            code: "DATA_SYNC_LOCK_RELEASE_FAIL",
            summary: String(release.reason ?? "LOCK_RELEASE_FAILED"),
            evidencePaths: [dataSyncLockPath],
          })
        }
      }
    }
    if (!dataSyncStageBase) {
      throw new Error("DATA_SYNC_STAGE_RESULT_MISSING")
    }
    const dataSyncStage = {
      ...dataSyncStageBase,
      details: {
        decision: dataSyncDecision,
        ledgerPath: dataSyncLedgerPath,
        lockPath: dataSyncLockPath,
        lock: dataSyncLock,
        stallNoOutputMs: effectiveDataSyncNoOutputTimeoutMs,
      },
    }
    stageResults.push(dataSyncStage)
    dataSyncLedger = buildNextDataSyncLedger({
      ledger: dataSyncLedger,
      decision: dataSyncDecision,
      stage: dataSyncStage,
      sessionId,
      attempt,
    })
    writeJson(dataSyncLedgerPath, dataSyncLedger)
    if (
      dataSyncDecision?.forced === true &&
      tuning?.forceDataSyncNextAttempt === true &&
      (dataSyncStage.status === "PASS" ||
        dataSyncStage.status === "FAIL" ||
        dataSyncStage.status === "SKIPPED")
    ) {
      // Keep signal-gap repair window after failed/ skipped forced sync.
      // This prevents losing the eval-window repair target between attempts.
      const clearSignalGapWindow = dataSyncStage.status === "PASS"
      tuning = normalizeTuning({
        ...tuning,
        forceDataSyncNextAttempt: false,
        signalGapRepairFromDateKey: clearSignalGapWindow
          ? ""
          : tuning?.signalGapRepairFromDateKey,
        signalGapRepairToDateKey: clearSignalGapWindow
          ? ""
          : tuning?.signalGapRepairToDateKey,
      })
      writeJsonIfChanged(tuningPath, tuning)
      appendSessionIndex("DATA_SYNC_FORCE_CONSUMED", {
        attempt,
        reason:
          dataSyncStage.status === "PASS"
            ? "FORCED_NEXT_ATTEMPT"
            : `FORCED_NEXT_ATTEMPT_${dataSyncStage.status}`,
        signalGapWindowCleared: clearSignalGapWindow,
      })
    }
    if (dataSyncStage.status === "SKIPPED") {
      console.log(
        `[auto-upgrade] DATA_SYNC skipped reason=${dataSyncStage.reason} attempt=${attempt} market=${dataSyncDecision.market} syncDate=${dataSyncDecision.syncDateKey ?? "unknown"}`,
      )
      appendSessionIndex("DATA_SYNC_SKIPPED", {
        attempt,
        reason: dataSyncStage.reason,
        market: dataSyncDecision.market,
        syncDateKey: dataSyncDecision.syncDateKey ?? null,
      })
      updateProgress(
        {
          consecutiveDataSyncFail: 0,
        },
        {
          attempt,
          stage: "DATA_SYNC",
          phase: "SKIPPED",
          timeoutMs: 0,
        },
      )
    }
    if (dataSyncStage.status === "FAIL") {
      console.warn(
        `[auto-upgrade] DATA_SYNC failed (timedOut=${dataSyncStage.timedOut === true})`,
      )
      const dataSyncFailureHint = detectDataSyncFailureFromLog(
        dataSyncStage.logPath,
      )
      const stageFailureCode = dataSyncStage.stalled
        ? "DATA_SYNC_STALL"
        : dataSyncStage.timedOut
          ? "PROCESS_TIMEOUT"
          : dataSyncFailureHint?.code
            ? dataSyncFailureHint.code
            : Number(dataSyncStage.exitCode ?? 0) === 2
              ? "DATA_COVERAGE_LOW"
              : "DATA_SYNC_FAIL"
      const failure = {
        code: stageFailureCode,
        detail: dataSyncStage.stalled
          ? "DATA_SYNC_NO_OUTPUT_STALL"
          : dataSyncStage.timedOut
            ? "DATA_SYNC_TIMEOUT"
            : (dataSyncFailureHint?.detail ?? "DATA_SYNC_COMMAND_FAILED"),
      }
      const plan = planAutoActions({
        failureCode: stageFailureCode,
        failureDetail: failure.detail,
        tuning,
        rules,
        sameFailureStreak: 1,
        successEval: null,
      })
      const prevRules = rules
      const prevTuning = tuning
      const tuningPolicy = applyDeterministicTuningPolicy({
        previousTuning: prevTuning,
        plannedTuning: plan.nextTuning,
      })
      const nextTuning = tuningPolicy.nextTuning
      const { nextRules, actionItems, rulesDriftBlocked, proposedRules } =
        applyRuleLockToPlan({ rules, plan, rulesLocked })
      writeJson(path.join(attemptDir, "failure_report.json"), failure)
      writeJson(path.join(attemptDir, "root_cause.json"), {
        ts: isoNow(),
        attempt,
        stage: "DATA_SYNC",
        code: failure.code,
        detail: failure.detail,
        class: classifyFailureClass(failure.code),
        hint: dataSyncFailureHint ?? null,
        decision: {
          run: dataSyncDecision?.run === true,
          reason: dataSyncDecision?.reason ?? null,
          tier: dataSyncDecision?.tier ?? null,
          tierReason: dataSyncDecision?.tierReason ?? null,
          syncDateKey: dataSyncDecision?.syncDateKey ?? null,
          forced: dataSyncDecision?.forced === true,
        },
        evidencePaths: [dataSyncStage.logPath],
      })
      writeJson(path.join(attemptDir, "action_plan.json"), actionItems)
      rules = nextRules
      tuning = nextTuning
      if (!rulesLocked) {
        writeJsonIfChanged(rulesPath, rules)
      }
      writeJsonIfChanged(tuningPath, tuning)
      writeJson(path.join(attemptDir, "action_result.json"), {
        previousRules: prevRules,
        nextRules,
        proposedRules,
        rulesDriftBlocked,
        ruleLockMode: rulesLocked ? "IMMUTABLE" : "MUTABLE",
        previousTuning: redactSensitiveObject(prevTuning),
        nextTuning: redactSensitiveObject(nextTuning),
        tuningPolicy: tuningPolicy.policy,
      })
      writeJson(path.join(attemptDir, "attempt_result.json"), {
        finalResult: null,
        stageResults,
      })
      recordRisk({
        attempt,
        stage: "DATA_SYNC",
        severity: "HIGH",
        code: failure.code,
        summary: failure.detail,
        evidencePaths: [
          path.join(attemptDir, "failure_report.json"),
          path.join(attemptDir, "attempt_result.json"),
          dataSyncStage.logPath,
        ],
      })
      recordMilestone({
        name: "ATTEMPT_FAIL",
        attempt,
        stage: "DATA_SYNC",
        status: "FAIL",
        details: { code: failure.code },
      })
      const dataSyncFailStreak =
        (Number(progressState.consecutiveDataSyncFail ?? 0) || 0) + 1
      updateProgress(
        {
          attemptsCompleted:
            (Number(progressState.attemptsCompleted ?? 0) || 0) + 1,
          lastAttemptStatus: "FAIL",
          lastStage: "DATA_SYNC",
          consecutiveDataSyncFail: dataSyncFailStreak,
        },
        {
          attempt,
          stage: "DATA_SYNC",
          phase: "ATTEMPT_FAIL",
          timeoutMs: 0,
        },
      )
      appendSessionIndex("ATTEMPT_FAIL", {
        attempt,
        stage: "DATA_SYNC",
        code: failure.code,
      })
      const dataSyncFailLimit = Math.max(
        1,
        Math.floor(
          Number(
            tuning?.dataSyncFailMaxConsecutive ?? tuning?.sameFailureLimit,
          ) || 3,
        ),
      )
      if (dataSyncFailStreak >= dataSyncFailLimit) {
        finalResult = {
          status: "STOPPED_BY_DATA_SYNC_LIMIT",
          attempt,
          failureCode: failure.code,
          sameFailureStreak: dataSyncFailStreak,
          dataSyncFailLimit,
          sessionId,
        }
        updateProgress(
          {
            status: "STOPPED_BY_DATA_SYNC_LIMIT",
            lastAttemptStatus: "STOPPED_BY_DATA_SYNC_LIMIT",
          },
          {
            attempt,
            stage: "DATA_SYNC",
            phase: "SESSION_STOPPED",
            timeoutMs: 0,
          },
        )
        appendSessionIndex("SESSION_STOPPED", {
          attempt,
          reason: "DATA_SYNC_LIMIT",
          failureCode: failure.code,
          sameFailureStreak: dataSyncFailStreak,
          dataSyncFailLimit,
        })
        break
      }
      const waitMs = resolveRetryBackoffMs(tuning)
      if (waitMs > 0) {
        await sleep(waitMs)
      }
      dryPassStreak = 0
      continue
    }

    updateProgress(
      {
        lastStage: "DERIVE",
        consecutiveDataSyncFail: 0,
      },
      {
        attempt,
        stage: "DERIVE",
        phase: "RUNNING_STAGE",
        timeoutMs: timeoutMs.derive,
      },
    )
    const deriveStage = await runOptionalCommandStage({
      stage: "DERIVE",
      enabled: tuning.deriveEnabled,
      command: tuning.deriveCommand,
      env,
      attemptDir,
      timeoutMs: timeoutMs.derive,
      heartbeatTicker: buildHeartbeatTicker({
        attempt,
        stage: "DERIVE",
        timeoutMs: timeoutMs.derive,
      }),
    })
    stageResults.push(deriveStage)
    if (deriveStage.status === "FAIL") {
      console.warn(
        `[auto-upgrade] DERIVE failed (timedOut=${deriveStage.timedOut === true})`,
      )
      const stageFailureCode = deriveStage.timedOut
        ? "PROCESS_TIMEOUT"
        : "DERIVE_FAIL"
      const failure = {
        code: stageFailureCode,
        detail: deriveStage.timedOut
          ? "DERIVE_TIMEOUT"
          : "DERIVE_COMMAND_FAILED",
      }
      const plan = planAutoActions({
        failureCode: stageFailureCode,
        failureDetail: failure.detail,
        tuning,
        rules,
        sameFailureStreak: 1,
        successEval: null,
      })
      const prevRules = rules
      const prevTuning = tuning
      const tuningPolicy = applyDeterministicTuningPolicy({
        previousTuning: prevTuning,
        plannedTuning: plan.nextTuning,
      })
      const nextTuning = tuningPolicy.nextTuning
      const { nextRules, actionItems, rulesDriftBlocked, proposedRules } =
        applyRuleLockToPlan({ rules, plan, rulesLocked })
      writeJson(path.join(attemptDir, "failure_report.json"), failure)
      writeJson(path.join(attemptDir, "action_plan.json"), actionItems)
      rules = nextRules
      tuning = nextTuning
      if (!rulesLocked) {
        writeJsonIfChanged(rulesPath, rules)
      }
      writeJsonIfChanged(tuningPath, tuning)
      writeJson(path.join(attemptDir, "action_result.json"), {
        previousRules: prevRules,
        nextRules,
        proposedRules,
        rulesDriftBlocked,
        ruleLockMode: rulesLocked ? "IMMUTABLE" : "MUTABLE",
        previousTuning: redactSensitiveObject(prevTuning),
        nextTuning: redactSensitiveObject(nextTuning),
        tuningPolicy: tuningPolicy.policy,
      })
      writeJson(path.join(attemptDir, "attempt_result.json"), {
        finalResult: null,
        stageResults,
      })
      recordRisk({
        attempt,
        stage: "DERIVE",
        severity: "HIGH",
        code: failure.code,
        summary: failure.detail,
        evidencePaths: [
          path.join(attemptDir, "failure_report.json"),
          path.join(attemptDir, "attempt_result.json"),
          deriveStage.logPath,
        ],
      })
      recordMilestone({
        name: "ATTEMPT_FAIL",
        attempt,
        stage: "DERIVE",
        status: "FAIL",
        details: { code: failure.code },
      })
      updateProgress(
        {
          attemptsCompleted:
            (Number(progressState.attemptsCompleted ?? 0) || 0) + 1,
          lastAttemptStatus: "FAIL",
          lastStage: "DERIVE",
        },
        {
          attempt,
          stage: "DERIVE",
          phase: "ATTEMPT_FAIL",
          timeoutMs: 0,
        },
      )
      appendSessionIndex("ATTEMPT_FAIL", {
        attempt,
        stage: "DERIVE",
        code: failure.code,
      })
      const waitMs = resolveRetryBackoffMs(tuning)
      if (waitMs > 0) {
        await sleep(waitMs)
      }
      dryPassStreak = 0
      continue
    }

    updateProgress(
      {
        lastStage: "SIGNAL_PREFLIGHT",
      },
      {
        attempt,
        stage: "SIGNAL_PREFLIGHT",
        phase: "RUNNING_STAGE",
        timeoutMs: timeoutMs.signalPreflight,
      },
    )
    const signalPreflightStage = runSignalPreflight({
      rules,
      tuning,
      env,
      attemptDir,
      timeoutMs: timeoutMs.signalPreflight,
      heartbeatTicker: buildHeartbeatTicker({
        attempt,
        stage: "SIGNAL_PREFLIGHT",
        timeoutMs: timeoutMs.signalPreflight,
      }),
    })
    stageResults.push(signalPreflightStage)
    if (signalPreflightStage.status === "FAIL") {
      console.warn(
        `[auto-upgrade] SIGNAL_PREFLIGHT failed (timedOut=${signalPreflightStage.timedOut === true})`,
      )
      const stageFailureCode =
        signalPreflightStage.failureCode ??
        (signalPreflightStage.timedOut
          ? "PROCESS_TIMEOUT"
          : "SIGNAL_PREFLIGHT_FAIL")
      const failure = {
        code: stageFailureCode,
        detail: signalPreflightStage.timedOut
          ? "SIGNAL_PREFLIGHT_TIMEOUT"
          : String(signalPreflightStage.reason ?? "SIGNAL_PREFLIGHT_FAILED"),
      }
      const plan = planAutoActions({
        failureCode: stageFailureCode,
        failureDetail: failure.detail,
        tuning,
        rules,
        sameFailureStreak: 1,
        successEval: null,
      })
      const prevRules = rules
      const prevTuning = tuning
      const tuningPolicy = applyDeterministicTuningPolicy({
        previousTuning: prevTuning,
        plannedTuning: plan.nextTuning,
      })
      const nextTuning = tuningPolicy.nextTuning
      const { nextRules, actionItems, rulesDriftBlocked, proposedRules } =
        applyRuleLockToPlan({ rules, plan, rulesLocked })
      writeJson(path.join(attemptDir, "failure_report.json"), failure)
      writeJson(path.join(attemptDir, "action_plan.json"), actionItems)
      rules = nextRules
      tuning = nextTuning
      if (!rulesLocked) {
        writeJsonIfChanged(rulesPath, rules)
      }
      writeJsonIfChanged(tuningPath, tuning)
      writeJson(path.join(attemptDir, "action_result.json"), {
        previousRules: prevRules,
        nextRules,
        proposedRules,
        rulesDriftBlocked,
        ruleLockMode: rulesLocked ? "IMMUTABLE" : "MUTABLE",
        previousTuning: redactSensitiveObject(prevTuning),
        nextTuning: redactSensitiveObject(nextTuning),
        tuningPolicy: tuningPolicy.policy,
      })
      writeJson(path.join(attemptDir, "attempt_result.json"), {
        finalResult: null,
        stageResults,
      })
      recordRisk({
        attempt,
        stage: "SIGNAL_PREFLIGHT",
        severity: "HIGH",
        code: failure.code,
        summary: failure.detail,
        evidencePaths: [
          path.join(attemptDir, "failure_report.json"),
          path.join(attemptDir, "attempt_result.json"),
          signalPreflightStage.logPath,
          signalPreflightStage.outputPath,
        ],
      })
      recordMilestone({
        name: "ATTEMPT_FAIL",
        attempt,
        stage: "SIGNAL_PREFLIGHT",
        status: "FAIL",
        details: { code: failure.code },
      })
      updateProgress(
        {
          attemptsCompleted:
            (Number(progressState.attemptsCompleted ?? 0) || 0) + 1,
          lastAttemptStatus: "FAIL",
          lastStage: "SIGNAL_PREFLIGHT",
        },
        {
          attempt,
          stage: "SIGNAL_PREFLIGHT",
          phase: "ATTEMPT_FAIL",
          timeoutMs: 0,
        },
      )
      appendSessionIndex("ATTEMPT_FAIL", {
        attempt,
        stage: "SIGNAL_PREFLIGHT",
        code: failure.code,
      })
      const waitMs = resolveRetryBackoffMs(tuning)
      if (waitMs > 0) {
        await sleep(waitMs)
      }
      dryPassStreak = 0
      continue
    }

    const memoryBeforeTrain = readMemoryHeadroom(tuning)
    if (memoryBeforeTrain.stop) {
      console.warn(
        `[auto-upgrade] memory-guard stop(before train) freeMb=${memoryBeforeTrain.freeMb} totalMb=${memoryBeforeTrain.totalMb} freeRatio=${memoryBeforeTrain.freeRatio.toFixed(3)}`,
      )
      const failure = {
        code: "OOM_RISK",
        detail:
          "MEMORY_HEADROOM_LOW_TRAIN_VALIDATE" +
          ` freeMb=${memoryBeforeTrain.freeMb} totalMb=${memoryBeforeTrain.totalMb} freeRatio=${memoryBeforeTrain.freeRatio.toFixed(3)}`,
      }
      const plan = planAutoActions({
        failureCode: failure.code,
        failureDetail: failure.detail,
        tuning,
        rules,
        sameFailureStreak: 1,
        successEval: null,
      })
      const prevRules = rules
      const prevTuning = tuning
      const tuningPolicy = applyDeterministicTuningPolicy({
        previousTuning: prevTuning,
        plannedTuning: plan.nextTuning,
      })
      const nextTuning = tuningPolicy.nextTuning
      const { nextRules, actionItems, rulesDriftBlocked, proposedRules } =
        applyRuleLockToPlan({ rules, plan, rulesLocked })
      writeJson(path.join(attemptDir, "failure_report.json"), failure)
      writeJson(path.join(attemptDir, "action_plan.json"), actionItems)
      rules = nextRules
      tuning = nextTuning
      if (!rulesLocked) {
        writeJsonIfChanged(rulesPath, rules)
      }
      writeJsonIfChanged(tuningPath, tuning)
      writeJson(path.join(attemptDir, "action_result.json"), {
        previousRules: prevRules,
        nextRules,
        proposedRules,
        rulesDriftBlocked,
        ruleLockMode: rulesLocked ? "IMMUTABLE" : "MUTABLE",
        previousTuning: redactSensitiveObject(prevTuning),
        nextTuning: redactSensitiveObject(nextTuning),
        tuningPolicy: tuningPolicy.policy,
      })
      writeJson(path.join(attemptDir, "attempt_result.json"), {
        finalResult: null,
        stageResults,
      })
      recordRisk({
        attempt,
        stage: "TRAIN_VALIDATE",
        severity: "HIGH",
        code: failure.code,
        summary: failure.detail,
        evidencePaths: [
          path.join(attemptDir, "failure_report.json"),
          path.join(attemptDir, "attempt_result.json"),
        ],
      })
      recordMilestone({
        name: "ATTEMPT_FAIL",
        attempt,
        stage: "TRAIN_VALIDATE",
        status: "FAIL",
        details: { code: failure.code },
      })
      updateProgress(
        {
          attemptsCompleted:
            (Number(progressState.attemptsCompleted ?? 0) || 0) + 1,
          lastAttemptStatus: "FAIL",
          lastStage: "TRAIN_VALIDATE",
        },
        {
          attempt,
          stage: "TRAIN_VALIDATE",
          phase: "ATTEMPT_FAIL",
          timeoutMs: 0,
        },
      )
      appendSessionIndex("ATTEMPT_FAIL", {
        attempt,
        stage: "TRAIN_VALIDATE",
        code: failure.code,
      })
      const waitMs = Math.max(
        resolveRetryBackoffMs(tuning),
        Number(memoryBeforeTrain.cooldownMs ?? 0),
      )
      if (waitMs > 0) {
        await sleep(waitMs)
      }
      dryPassStreak = 0
      continue
    }

    updateProgress(
      {
        lastStage: "TRAIN_VALIDATE",
      },
      {
        attempt,
        stage: "TRAIN_VALIDATE",
        phase: "RUNNING_STAGE",
        timeoutMs: timeoutMs.trainValidate,
      },
    )
    const generateTransition = transitionState({
      nextState: "GENERATE_CANDIDATES",
      attempt,
      stage: "TRAIN_VALIDATE",
      note: "RUN_SHARDED_DRY",
    })
    if (!generateTransition.ok) {
      const failure = {
        code: "STATE_MACHINE_VIOLATION",
        detail: generateTransition.detail,
      }
      writeJson(path.join(attemptDir, "failure_report.json"), failure)
      finalResult = {
        status: "STOPPED_BY_STATE_MACHINE",
        attempt,
        failureCode: failure.code,
        detail: failure.detail,
        sessionId,
      }
      break
    }
    const dryRun = await runSharded({
      sessionId,
      attempt,
      mode: "dry",
      rules,
      tuning: runtimeTuning,
      coveragePlan,
      blockedFingerprintsPath:
        blockedFingerprintsCombined.length > 0 ? blockedFingerprintsPath : null,
      env,
      attemptDir,
      dryRunOnly: true,
      timeoutMs: timeoutMs.trainValidate,
      heartbeatTicker: buildHeartbeatTicker({
        attempt,
        stage: "TRAIN_VALIDATE",
        timeoutMs: timeoutMs.trainValidate,
      }),
    })
    stageResults.push({
      stage: "TRAIN_VALIDATE",
      status: dryRun.run.status === 0 ? "PASS" : "FAIL",
      reason:
        dryRun.run.status === 0
          ? null
          : dryRun.run.timedOut
            ? "TIMEOUT"
            : "PROCESS_ERROR",
      batchId: dryRun.batchId,
      summaryPath: dryRun.summaryPath,
      reportPath: dryRun.reportPath,
      logPath: dryRun.logPath,
      exitCode: dryRun.run.status,
      durationMs: dryRun.run.durationMs,
      timedOut: dryRun.run.timedOut === true,
      timeoutMs: dryRun.run.timeoutMs ?? timeoutMs.trainValidate,
    })
    const stage1Transition = transitionState({
      nextState: "STAGE1_EVAL",
      attempt,
      stage: "TRAIN_VALIDATE",
      note: "DRY_RUN_COMPLETED",
    })
    if (!stage1Transition.ok) {
      const failure = {
        code: "STATE_MACHINE_VIOLATION",
        detail: stage1Transition.detail,
      }
      writeJson(path.join(attemptDir, "failure_report.json"), failure)
      finalResult = {
        status: "STOPPED_BY_STATE_MACHINE",
        attempt,
        failureCode: failure.code,
        detail: failure.detail,
        sessionId,
      }
      break
    }
    const drySuccess = evaluateAttemptSuccess({ report: dryRun.report, rules })
    dryPassStreak = drySuccess.pass ? dryPassStreak + 1 : 0
    console.log(
      `[auto-upgrade] TRAIN_VALIDATE status=${dryRun.run.status} pass=${drySuccess.pass}`,
    )
    if (drySuccess.pass) {
      recordMilestone({
        name: "TRAIN_VALIDATE_PASS",
        attempt,
        stage: "TRAIN_VALIDATE",
        status: "PASS",
        details: {
          dryPassStreak,
          batchId: dryRun.batchId,
        },
      })
      updateProgress({
        lastStage: "TRAIN_VALIDATE",
        lastAttemptStatus: "PASS_STAGE",
      })
      appendSessionIndex("STAGE_PASS", {
        attempt,
        stage: "TRAIN_VALIDATE",
        name: "TRAIN_VALIDATE_PASS",
      })
    }

    let failureExitCode = dryRun.run.status
    let failureStdout = dryRun.run.stdout
    let failureStderr = dryRun.run.stderr
    let referenceSummary = dryRun.summary
    let referenceReport = dryRun.report
    let referenceSuccessEval = drySuccess
    let explicitFailure = null
    const surgePoolDiagnostics = buildSurgePoolDiagnostics(dryRun.summary)
    const surgePoolDiagnosticsPath = path.join(
      attemptDir,
      "surge_pool_diagnostics.json",
    )
    if (surgePoolDiagnostics) {
      writeJson(surgePoolDiagnosticsPath, surgePoolDiagnostics)
    }
    const moonshotDiagnosticsMaxRows = Math.max(
      1,
      Math.floor(Number(tuning.moonshotDiagnosticsMaxRows ?? 40) || 40),
    )
    const moonshotGateDiagnostics = buildMoonshotDiagnosticsFromSummary({
      summary: dryRun.summary,
      logPath: dryRun.logPath,
      maxRows: moonshotDiagnosticsMaxRows,
    })
    const moonshotGateDiagnosticsPath = path.join(
      attemptDir,
      "moonshot_gate_diagnostics.json",
    )
    if (moonshotGateDiagnostics) {
      writeJson(moonshotGateDiagnosticsPath, moonshotGateDiagnostics)
    }
    const moonshotOutcomeGuard = evaluateMoonshotOutcomeGuard({
      diagnostics: moonshotGateDiagnostics,
      tuning,
    })
    stageResults.push({
      stage: "MOONSHOT_OUTCOME_GUARD",
      status: moonshotOutcomeGuard.pass ? "PASS" : "FAIL",
      reason: moonshotOutcomeGuard.reason,
      details: moonshotOutcomeGuard.metrics,
    })
    if (!moonshotOutcomeGuard.pass && !explicitFailure) {
      explicitFailure = {
        code: "MOONSHOT_OUTCOME_EMPTY",
        detail:
          moonshotOutcomeGuard.reason ?? "MOONSHOT_OUTCOME_EMPTY_WITH_SIGNALS",
      }
    }
    const moonshotSignalConsistencyGuard =
      evaluateMoonshotSignalConsistencyGuard({
        diagnostics: moonshotGateDiagnostics,
        preflightStage: signalPreflightStage,
        tuning,
      })
    stageResults.push({
      stage: "MOONSHOT_SIGNAL_CONSISTENCY_GUARD",
      status: moonshotSignalConsistencyGuard.pass ? "PASS" : "FAIL",
      reason: moonshotSignalConsistencyGuard.reason,
      details: moonshotSignalConsistencyGuard.metrics,
    })
    if (!moonshotSignalConsistencyGuard.pass && !explicitFailure) {
      explicitFailure = {
        code: "MOONSHOT_SIGNAL_MISMATCH",
        detail:
          moonshotSignalConsistencyGuard.reason ??
          "MOONSHOT_SIGNAL_MISMATCH_PREFLIGHT_GT0_EVAL_0",
      }
    }
    const evalWindowSignalProbeConfig = resolveEvalWindowSignalPreflightConfig({
      diagnostics: moonshotGateDiagnostics,
      tuning,
    })
    const evalWindowSignalPreflightStage = evalWindowSignalProbeConfig
      ? runSignalPreflight({
          rules,
          tuning,
          env,
          attemptDir,
          timeoutMs: timeoutMs.signalPreflight,
          heartbeatTicker: buildHeartbeatTicker({
            attempt,
            stage: "EVAL_SIGNAL_PREFLIGHT",
            timeoutMs: timeoutMs.signalPreflight,
          }),
          stageLabel: "EVAL_SIGNAL_PREFLIGHT",
          outputFileName: "eval_signal_preflight.json",
          logFileName: "eval_signal_preflight.log",
          asOfOverride: evalWindowSignalProbeConfig.asOfDateKey,
          windowTradingDaysOverride:
            evalWindowSignalProbeConfig.windowTradingDays,
          failureCodeOnSignalShortage: "SIGNAL_GAP",
        })
      : {
          stage: "EVAL_SIGNAL_PREFLIGHT",
          status: "SKIPPED",
          reason: "NO_EVALUATED_BUCKET_WINDOW",
          failureCode: null,
          command: null,
          exitCode: 0,
          durationMs: 0,
          timedOut: false,
          timeoutMs: timeoutMs.signalPreflight,
          logPath: null,
          outputPath: null,
          details: {
            pass: true,
            reasons: [],
          },
        }
    stageResults.push(evalWindowSignalPreflightStage)
    const evalWindowSignalGapGuard = evaluateEvalWindowSignalGapGuard({
      diagnostics: moonshotGateDiagnostics,
      preflightStage: evalWindowSignalPreflightStage,
      baselinePreflightStage: signalPreflightStage,
      rules,
      tuning,
      probeConfig: evalWindowSignalProbeConfig,
    })
    stageResults.push({
      stage: "EVAL_SIGNAL_GAP_GUARD",
      status: evalWindowSignalGapGuard.pass ? "PASS" : "FAIL",
      reason: evalWindowSignalGapGuard.reason,
      details: {
        ...evalWindowSignalGapGuard.metrics,
        probeOutputPath: evalWindowSignalPreflightStage.outputPath ?? null,
      },
    })
    if (
      !evalWindowSignalGapGuard.pass &&
      (!explicitFailure || explicitFailure.code === "MOONSHOT_SIGNAL_MISMATCH")
    ) {
      explicitFailure = {
        code: "SIGNAL_GAP_EVAL_WINDOW",
        detail:
          evalWindowSignalGapGuard.reason ??
          "SIGNAL_GAP_EVAL_WINDOW_SIGNALS_MISSING",
      }
    }
    const summaryPreflight = evaluateSummaryPreflight({
      summary: dryRun.summary,
      tuning,
    })
    stageResults.push({
      stage: "SUMMARY_PREFLIGHT",
      status: summaryPreflight.pass ? "PASS" : "FAIL",
      reason: summaryPreflight.pass
        ? null
        : summaryPreflight.reasons.join(",") || "PREFLIGHT_FAILED",
      details: {
        ...summaryPreflight.metrics,
        surgePoolDiagnosticsPath: surgePoolDiagnostics
          ? surgePoolDiagnosticsPath
          : null,
        moonshotGateDiagnosticsPath: moonshotGateDiagnostics
          ? moonshotGateDiagnosticsPath
          : null,
      },
    })
    if (!summaryPreflight.pass && !explicitFailure) {
      explicitFailure = {
        code: "SURGE_POOL_EMPTY",
        detail: summaryPreflight.reasons.join(",") || "PREFLIGHT_FAILED",
      }
    }

    const stage2Transition = transitionState({
      nextState: "STAGE2_EVAL",
      attempt,
      stage: "SUMMARY_PREFLIGHT",
      note: "ENTER_STAGE2_EVAL",
    })
    if (!stage2Transition.ok) {
      explicitFailure = {
        code: "STATE_MACHINE_VIOLATION",
        detail: stage2Transition.detail,
      }
    }

    const requiredDryPassStreak = Math.max(
      1,
      Math.floor(Number(tuning.applyAfterDryPassStreak ?? 2) || 2),
    )
    const dryApplyGateBlocked =
      drySuccess.pass &&
      !explicitFailure &&
      args.autoApply &&
      !args.dryRunOnly &&
      dryPassStreak < requiredDryPassStreak

    if (dryApplyGateBlocked) {
      stageResults.push({
        stage: "DEPLOY_GATE",
        status: "SKIPPED",
        reason: "DRY_STREAK_NOT_REACHED",
        details: {
          dryPassStreak,
          requiredDryPassStreak,
        },
      })
      const nextCoverageCursor = resolveNextCoverageCursor({
        coveragePlan,
        sameFailureStreak: 1,
        sameFailureSignatureStreak: 1,
        failureCode: "WAITING_APPLY_GATE",
        tuning,
      })
      writeJson(path.join(attemptDir, "next_retry_plan.json"), {
        attemptNext: attempt + 1,
        nextCoverageCursor,
        reason: "DRY_STREAK_NOT_REACHED",
      })
      writeJson(path.join(attemptDir, "attempt_result.json"), {
        finalResult: null,
        stageResults,
      })
      const waitingObservability = buildAttemptObservability({
        sessionId,
        attempt,
        stageResults,
        rules,
        tuning,
        failure: {
          code: "WAITING_APPLY_GATE",
          detail: `DRY_STREAK_${dryPassStreak}/${requiredDryPassStreak}`,
        },
        failureClass: "QUALITY",
        sameFailureStreak: 1,
        sameFailureSignatureStreak: 1,
        coveragePlan,
        sourceIdentity,
        summary: dryRun.summary,
        report: dryRun.report,
        memoryHeadroom,
        runtimeMeta: runtimeAttempt.runtimeMeta,
      })
      writeJson(
        path.join(attemptDir, "observability.json"),
        redactSensitiveObject(waitingObservability),
      )
      coverageCursor = nextCoverageCursor
      writeJson(coverageLedgerPath, {
        sessionId,
        updatedAt: new Date().toISOString(),
        coverageCursor,
        coveragePlan,
        dryPassStreak,
        status: "WAITING_APPLY_GATE",
      })
      persistResumeState({
        coverageCursor,
        sameFailureSignature,
        sameFailureSignatureStreak,
        qualityCollapseResetCounts,
        failureFingerprints: recentFailureFingerprints,
        lastFailureCode: "WAITING_APPLY_GATE",
        lastFailureClass: "QUALITY",
        lastFailureDetail: `DRY_STREAK_${dryPassStreak}/${requiredDryPassStreak}`,
      })
      recordMilestone({
        name: "DRY_PASS_WAIT_APPLY_GATE",
        attempt,
        stage: "DEPLOY_GATE",
        status: "PASS",
        details: {
          dryPassStreak,
          requiredDryPassStreak,
        },
      })
      updateProgress(
        {
          attemptsCompleted:
            (Number(progressState.attemptsCompleted ?? 0) || 0) + 1,
          lastAttemptStatus: "WAITING_APPLY_GATE",
          lastStage: "DEPLOY_GATE",
          ...buildProgressObservabilityPatch(waitingObservability),
        },
        {
          attempt,
          stage: "DEPLOY_GATE",
          phase: "WAITING_APPLY_GATE",
          timeoutMs: 0,
        },
      )
      appendSessionIndex("WAITING_APPLY_GATE", {
        attempt,
        dryPassStreak,
        requiredDryPassStreak,
      })
      const waitMs = resolveRetryBackoffMs(tuning)
      if (waitMs > 0) {
        await sleep(waitMs)
      }
      continue
    }

    if (drySuccess.pass && args.autoApply && !args.dryRunOnly) {
      const memoryBeforeApply = readMemoryHeadroom(tuning)
      if (memoryBeforeApply.stop) {
        console.warn(
          `[auto-upgrade] memory-guard stop(before apply) freeMb=${memoryBeforeApply.freeMb} totalMb=${memoryBeforeApply.totalMb} freeRatio=${memoryBeforeApply.freeRatio.toFixed(3)}`,
        )
        explicitFailure = {
          code: "OOM_RISK",
          detail:
            "MEMORY_HEADROOM_LOW_DEPLOY_APPLY" +
            ` freeMb=${memoryBeforeApply.freeMb} totalMb=${memoryBeforeApply.totalMb} freeRatio=${memoryBeforeApply.freeRatio.toFixed(3)}`,
        }
      }
    }

    if (
      drySuccess.pass &&
      args.autoApply &&
      !args.dryRunOnly &&
      !explicitFailure
    ) {
      updateProgress(
        {
          lastStage: "DEPLOY_APPLY",
        },
        {
          attempt,
          stage: "DEPLOY_APPLY",
          phase: "RUNNING_STAGE",
          timeoutMs: timeoutMs.deployApply,
        },
      )
      const applyRun = await runSharded({
        sessionId,
        attempt,
        mode: "apply",
        rules,
        tuning: runtimeTuning,
        coveragePlan,
        blockedFingerprintsPath:
          blockedFingerprintsCombined.length > 0
            ? blockedFingerprintsPath
            : null,
        env,
        attemptDir,
        dryRunOnly: false,
        timeoutMs: timeoutMs.deployApply,
        heartbeatTicker: buildHeartbeatTicker({
          attempt,
          stage: "DEPLOY_APPLY",
          timeoutMs: timeoutMs.deployApply,
        }),
      })
      failureExitCode = applyRun.run.status
      failureStdout = applyRun.run.stdout
      failureStderr = applyRun.run.stderr
      referenceSummary = applyRun.summary
      referenceReport = applyRun.report
      stageResults.push({
        stage: "DEPLOY_APPLY",
        status: applyRun.run.status === 0 ? "PASS" : "FAIL",
        reason:
          applyRun.run.status === 0
            ? null
            : applyRun.run.timedOut
              ? "TIMEOUT"
              : "PROCESS_ERROR",
        batchId: applyRun.batchId,
        summaryPath: applyRun.summaryPath,
        reportPath: applyRun.reportPath,
        logPath: applyRun.logPath,
        exitCode: applyRun.run.status,
        durationMs: applyRun.run.durationMs,
        timedOut: applyRun.run.timedOut === true,
        timeoutMs: applyRun.run.timeoutMs ?? timeoutMs.deployApply,
      })
      const applySuccess = evaluateAttemptSuccess({
        report: applyRun.report,
        rules,
      })
      console.log(
        `[auto-upgrade] DEPLOY_APPLY status=${applyRun.run.status} pass=${applySuccess.pass}`,
      )
      referenceSuccessEval = applySuccess
      if (applySuccess.pass) {
        recordMilestone({
          name: "DEPLOY_APPLY_PASS",
          attempt,
          stage: "DEPLOY_APPLY",
          status: "PASS",
          details: {
            batchId: applyRun.batchId,
          },
        })
        appendSessionIndex("STAGE_PASS", {
          attempt,
          stage: "DEPLOY_APPLY",
          name: "DEPLOY_APPLY_PASS",
        })
      }
      if (applySuccess.pass) {
        const memoryBeforeVerify = readMemoryHeadroom(tuning)
        if (memoryBeforeVerify.stop) {
          console.warn(
            `[auto-upgrade] memory-guard stop(before verify) freeMb=${memoryBeforeVerify.freeMb} totalMb=${memoryBeforeVerify.totalMb} freeRatio=${memoryBeforeVerify.freeRatio.toFixed(3)}`,
          )
          explicitFailure = {
            code: "OOM_RISK",
            detail:
              "MEMORY_HEADROOM_LOW_VERIFY" +
              ` freeMb=${memoryBeforeVerify.freeMb} totalMb=${memoryBeforeVerify.totalMb} freeRatio=${memoryBeforeVerify.freeRatio.toFixed(3)}`,
          }
        }
      }
      if (applySuccess.pass && !explicitFailure) {
        updateProgress(
          {
            lastStage: "VERIFY",
          },
          {
            attempt,
            stage: "VERIFY",
            phase: "RUNNING_STAGE",
            timeoutMs: timeoutMs.verify,
          },
        )
        const verify = runVerifyStage({
          env,
          attemptDir,
          timeoutMs: timeoutMs.verify,
          heartbeatTicker: buildHeartbeatTicker({
            attempt,
            stage: "VERIFY",
            timeoutMs: timeoutMs.verify,
          }),
        })
        stageResults.push(verify)
        if (verify.status === "PASS") {
          recordMilestone({
            name: "VERIFY_PASS",
            attempt,
            stage: "VERIFY",
            status: "PASS",
          })
          finalResult = {
            status: "SUCCESS",
            attempt,
            mode: "apply",
            reportPath: applyRun.reportPath,
            summaryPath: applyRun.summaryPath,
            sessionId,
          }
          writeJson(path.join(attemptDir, "attempt_result.json"), {
            finalResult,
            stageResults,
          })
          const successObservability = buildAttemptObservability({
            sessionId,
            attempt,
            stageResults,
            rules,
            tuning,
            failure: null,
            failureClass: null,
            sameFailureStreak,
            sameFailureSignatureStreak,
            coveragePlan,
            sourceIdentity,
            summary: applyRun.summary,
            report: applyRun.report,
            memoryHeadroom,
            runtimeMeta: runtimeAttempt.runtimeMeta,
          })
          writeJson(
            path.join(attemptDir, "observability.json"),
            redactSensitiveObject(successObservability),
          )
          profileStatsStore = updateProfileStatsStoreOnAttempt({
            store: profileStatsStore,
            profileId: runtimeAttempt?.runtimeMeta?.profile,
            observability: successObservability,
            failureClass: null,
            resultStatus: finalResult.status,
          })
          writeJsonIfChanged(profileStatsPath, profileStatsStore)
          writeJson(coverageLedgerPath, {
            sessionId,
            updatedAt: new Date().toISOString(),
            coverageCursor,
            coveragePlan,
            status: finalResult.status,
          })
          persistResumeState({
            coverageCursor,
            sameFailureSignature: null,
            sameFailureSignatureStreak: 0,
            qualityCollapseResetCounts: {},
            failureFingerprints: [],
            lastFailureCode: null,
            lastFailureClass: null,
            lastFailureDetail: null,
          })
          recordMilestone({
            name: "SESSION_SUCCESS",
            attempt,
            stage: "VERIFY",
            status: "PASS",
            details: { mode: "apply" },
          })
          updateProgress(
            {
              status: "SUCCESS",
              attemptsCompleted:
                (Number(progressState.attemptsCompleted ?? 0) || 0) + 1,
              lastAttemptStatus: "SUCCESS",
              lastStage: "VERIFY",
              ...buildProgressObservabilityPatch(successObservability),
            },
            {
              attempt,
              stage: "VERIFY",
              phase: "SESSION_SUCCESS",
              timeoutMs: 0,
            },
          )
          appendSessionIndex("SESSION_SUCCESS", {
            attempt,
            mode: "apply",
          })
          break
        }
        explicitFailure = {
          code: verify.timedOut ? "PROCESS_TIMEOUT" : "VERIFY_FAIL",
          detail: verify.timedOut
            ? "VERIFY_TIMEOUT"
            : `EXIT_${verify.exitCode}`,
        }
      }
    } else if (drySuccess.pass) {
      recordMilestone({
        name: "SESSION_SUCCESS_DRY",
        attempt,
        stage: "TRAIN_VALIDATE",
        status: "PASS",
        details: { mode: "dry" },
      })
      finalResult = {
        status: "SUCCESS_DRY",
        attempt,
        mode: "dry",
        reportPath: dryRun.reportPath,
        summaryPath: dryRun.summaryPath,
        sessionId,
      }
      writeJson(path.join(attemptDir, "attempt_result.json"), {
        finalResult,
        stageResults,
      })
      const successDryObservability = buildAttemptObservability({
        sessionId,
        attempt,
        stageResults,
        rules,
        tuning,
        failure: null,
        failureClass: null,
        sameFailureStreak,
        sameFailureSignatureStreak,
        coveragePlan,
        sourceIdentity,
        summary: dryRun.summary,
        report: dryRun.report,
        memoryHeadroom,
        runtimeMeta: runtimeAttempt.runtimeMeta,
      })
      writeJson(
        path.join(attemptDir, "observability.json"),
        redactSensitiveObject(successDryObservability),
      )
      profileStatsStore = updateProfileStatsStoreOnAttempt({
        store: profileStatsStore,
        profileId: runtimeAttempt?.runtimeMeta?.profile,
        observability: successDryObservability,
        failureClass: null,
        resultStatus: finalResult.status,
      })
      writeJsonIfChanged(profileStatsPath, profileStatsStore)
      writeJson(coverageLedgerPath, {
        sessionId,
        updatedAt: new Date().toISOString(),
        coverageCursor,
        coveragePlan,
        status: finalResult.status,
      })
      persistResumeState({
        coverageCursor,
        sameFailureSignature: null,
        sameFailureSignatureStreak: 0,
        qualityCollapseResetCounts: {},
        failureFingerprints: [],
        lastFailureCode: null,
        lastFailureClass: null,
        lastFailureDetail: null,
      })
      updateProgress(
        {
          status: "SUCCESS_DRY",
          attemptsCompleted:
            (Number(progressState.attemptsCompleted ?? 0) || 0) + 1,
          lastAttemptStatus: "SUCCESS_DRY",
          lastStage: "TRAIN_VALIDATE",
          ...buildProgressObservabilityPatch(successDryObservability),
        },
        {
          attempt,
          stage: "TRAIN_VALIDATE",
          phase: "SESSION_SUCCESS_DRY",
          timeoutMs: 0,
        },
      )
      appendSessionIndex("SESSION_SUCCESS", {
        attempt,
        mode: "dry",
      })
      break
    }
    dryPassStreak = 0
    const classificationSummary = (() => {
      const base =
        referenceSummary && typeof referenceSummary === "object"
          ? { ...referenceSummary }
          : {}
      const stage1SummaryPath = String(base.stage1SummaryPath ?? "").trim()
      if (!stage1SummaryPath) {
        return base
      }
      const stage1Summary = readJsonSafe(stage1SummaryPath)
      if (!stage1Summary || typeof stage1Summary !== "object") {
        return base
      }
      if (
        !base.poolQualityByTrack &&
        stage1Summary.poolQualityByTrack &&
        typeof stage1Summary.poolQualityByTrack === "object"
      ) {
        base.poolQualityByTrack = stage1Summary.poolQualityByTrack
      }
      if (
        !base.poolCountByTrack &&
        stage1Summary.poolCountByTrack &&
        typeof stage1Summary.poolCountByTrack === "object"
      ) {
        base.poolCountByTrack = stage1Summary.poolCountByTrack
      }
      return base
    })()
    const failure =
      explicitFailure ??
      classifyAttemptFailure({
        exitCode: failureExitCode,
        report: referenceReport,
        summary: classificationSummary,
        stdout: failureStdout,
        stderr: failureStderr,
        successEval: referenceSuccessEval,
      })
    const failureClass = classifyFailureClass(failure.code)
    if (failureClass === "STRUCTURAL") {
      structuralFailures += 1
    } else if (failureClass === "QUALITY") {
      qualityFailures += 1
    } else if (failureClass === "SECURITY") {
      securityFailures += 1
    } else {
      transientFailures += 1
    }
    console.warn(
      `[auto-upgrade] failed code=${failure.code} class=${failureClass} detail=${failure.detail} streak=${sameFailureStreak}`,
    )
    if (failure.code === sameFailureCode) {
      sameFailureStreak += 1
    } else {
      sameFailureCode = failure.code
      sameFailureStreak = 1
    }
    const failureSignature = buildFailureSignature({
      failure,
      report: referenceReport,
    })
    if (failureSignature === sameFailureSignature) {
      sameFailureSignatureStreak += 1
    } else {
      sameFailureSignature = failureSignature
      sameFailureSignatureStreak = 1
    }
    const nextCoverageCursor = resolveNextCoverageCursor({
      coveragePlan,
      sameFailureStreak,
      sameFailureSignatureStreak,
      failureCode: failure.code,
      tuning,
    })
    const prolongedQualityCodes = new Set([
      "WORST2W_BELOW_THRESHOLD",
      "WORST2W_TRACK_ZERO_PASS",
      "TRADE_GATE_FAIL",
      "MOONSHOT_GATE_FAIL",
    ])
    const isProlongedQualityStreak = prolongedQualityCodes.has(
      String(failure.code ?? "")
        .trim()
        .toUpperCase(),
    )
    // Keep exploring longer for persistent quality failures (rules remain fixed),
    // so the loop does not terminate before bucket/seed diversity is exhausted.
    const qualityRecoveryLimit = isProlongedQualityStreak
      ? Math.max(8, Number(tuning.qualityRecoveryLimit ?? 1) || 1)
      : Number(tuning.qualityRecoveryLimit ?? 1) || 1
    const sameFailureLimit = isProlongedQualityStreak
      ? Math.max(8, Number(tuning.sameFailureLimit ?? 3) || 3)
      : Number(tuning.sameFailureLimit ?? 3) || 3
    const qualityCollapseResetEnabled =
      tuning.qualityCollapseResetEnabled !== false
    const qualityCollapseResetLimit = Math.max(
      0,
      Math.floor(Number(tuning.qualityCollapseResetLimit ?? 1) || 1),
    )
    const qualityCollapseResetStreakConfigured = Math.max(
      2,
      Number(tuning.qualityCollapseResetStreak ?? 3) || 3,
    )
    const qualityCollapseCode = String(failure.code ?? "")
      .trim()
      .toUpperCase()
    const qualityCollapseDetail = String(failure.detail ?? "")
      .trim()
      .toUpperCase()
    const qualityCollapseTrackToken = resolveQualityCollapseTrackToken({
      failureCode: qualityCollapseCode,
      failureDetail: qualityCollapseDetail,
    })
    const qualityCollapseResetScopeKey = `${qualityCollapseCode}:${qualityCollapseTrackToken}`
    const qualityCollapseResetCount = Math.max(
      0,
      Math.floor(
        Number(qualityCollapseResetCounts[qualityCollapseResetScopeKey] ?? 0) ||
          0,
      ),
    )
    const qualityCollapseResetAllowedByLimit =
      qualityCollapseResetLimit > 0 &&
      qualityCollapseResetCount < qualityCollapseResetLimit
    const qualityCollapseResetStreak = Math.max(
      2,
      qualityCollapseCode === "WORST2W_TRACK_ZERO_PASS"
        ? Math.min(
            qualityCollapseResetStreakConfigured,
            Math.max(2, Number(tuning.trackZeroPassResetStreak ?? 2) || 2),
          )
        : qualityCollapseResetStreakConfigured,
    )
    const isQualityCollapseResetTarget =
      isInsufficientPoolFailureCode(qualityCollapseCode) ||
      qualityCollapseCode === "WORST2W_TRACK_ZERO_PASS" ||
      qualityCollapseCode === "WORST2W_BELOW_THRESHOLD" ||
      qualityCollapseCode === "TRADE_GATE_FAIL" ||
      qualityCollapseCode === "MOONSHOT_GATE_FAIL"
    const qualityCollapseResetPlanned =
      qualityCollapseResetEnabled &&
      isQualityCollapseResetTarget &&
      sameFailureStreak >= qualityCollapseResetStreak &&
      qualityCollapseResetAllowedByLimit
    const breakerSameFailureStreak = qualityCollapseResetPlanned
      ? 0
      : sameFailureStreak
    const breakerDecision = evaluateCircuitBreaker({
      failureType: failureClass,
      structuralFailures,
      qualityFailures,
      transientFailures,
      sameFailureStreak: breakerSameFailureStreak,
      maxAttempts,
      attempt,
      runtimeLimitHit: false,
      structuralRecoveryLimit: Number(tuning.structuralRecoveryLimit ?? 1) || 1,
      qualityRecoveryLimit,
      transientRetryLimit: Number(tuning.transientRetryLimit ?? 6) || 6,
      sameFailureLimit,
    })
    const zeroPassSurgeFailure =
      failure.code === "WORST2W_TRACK_ZERO_PASS" &&
      String(failure.detail ?? "")
        .trim()
        .toUpperCase()
        .includes("SURGE_EOD")
    let fingerprintCarryLimit = Math.max(
      0,
      Math.floor(Number(tuning.failureFingerprintCarryLimit ?? 320) || 320),
    )
    if (zeroPassSurgeFailure) {
      fingerprintCarryLimit = Math.min(fingerprintCarryLimit, 16)
    }
    let fingerprintCarry = {
      poolPath: null,
      added: 0,
      total: recentFailureFingerprints.length,
      fallbackSource: null,
    }
    if (
      isInsufficientPoolFailureCode(failure.code) &&
      sameFailureStreak >= 2 &&
      recentFailureFingerprints.length > 0
    ) {
      const keepRatio =
        sameFailureStreak >= 4 ? 0.2 : sameFailureStreak >= 3 ? 0.35 : 0.5
      const keepCount = Math.max(
        0,
        Math.floor(recentFailureFingerprints.length * keepRatio),
      )
      const removedCount = Math.max(
        0,
        recentFailureFingerprints.length - keepCount,
      )
      recentFailureFingerprints =
        keepCount > 0
          ? recentFailureFingerprints.slice(
              recentFailureFingerprints.length - keepCount,
            )
          : []
      fingerprintCarry = {
        ...fingerprintCarry,
        total: recentFailureFingerprints.length,
        decay: {
          removedCount,
          keepCount,
          keepRatio,
          reason: "INSUFFICIENT_POOL_STREAK_DECAY",
        },
      }
    }
    if (zeroPassSurgeFailure && recentFailureFingerprints.length > 0) {
      const keepCount = Math.max(
        6,
        Math.min(12, Math.floor(recentFailureFingerprints.length * 0.4)),
      )
      const removedCount = Math.max(
        0,
        recentFailureFingerprints.length - keepCount,
      )
      recentFailureFingerprints =
        keepCount > 0
          ? recentFailureFingerprints.slice(
              recentFailureFingerprints.length - keepCount,
            )
          : []
      fingerprintCarry = {
        ...fingerprintCarry,
        total: recentFailureFingerprints.length,
        decay: {
          removedCount,
          keepCount,
          keepRatio: 0.4,
          reason: "SURGE_ZERO_PASS_DECAY",
        },
      }
    }
    if (
      failure.code === "SURGE_POOL_EMPTY" &&
      recentFailureFingerprints.length > 0
    ) {
      const cleared = recentFailureFingerprints.length
      recentFailureFingerprints = []
      fingerprintCarry = {
        poolPath: null,
        added: 0,
        total: 0,
        cleared,
        reason: "SURGE_POOL_EMPTY_RESET",
      }
    }
    if (
      fingerprintCarryLimit > 0 &&
      failure.code !== "SURGE_POOL_EMPTY" &&
      (sameFailureSignatureStreak >= 2 ||
        isInsufficientPoolFailureCode(failure.code) ||
        failure.code === "WORST2W_BELOW_THRESHOLD" ||
        failure.code === "WORST2W_TRACK_ZERO_PASS" ||
        failure.code === "PERFORMANCE_NOT_PASS")
    ) {
      const collected = collectFingerprintsFromPoolSummary({
        summary: dryRun.summary,
        limit: Math.min(fingerprintCarryLimit, 256),
      })
      const fallbackCollected =
        collected.fingerprints.length > 0
          ? { source: null, fingerprints: [] }
          : collectFallbackFingerprintsFromSummary({
              summary: dryRun.summary,
              limit: Math.min(fingerprintCarryLimit, 256),
            })
      const merged = mergeRecentFingerprints({
        current: recentFailureFingerprints,
        incoming:
          collected.fingerprints.length > 0
            ? collected.fingerprints
            : fallbackCollected.fingerprints,
        limit: fingerprintCarryLimit,
      })
      fingerprintCarry = {
        ...fingerprintCarry,
        poolPath: collected.poolPath,
        added: Math.max(0, merged.length - recentFailureFingerprints.length),
        total: merged.length,
        fallbackSource: fallbackCollected.source,
      }
      recentFailureFingerprints = merged
    }
    if (
      tuning.quarantineEnabled !== false &&
      recentFailureFingerprints.length > 0
    ) {
      quarantineStore = updateQuarantineStoreOnFailure({
        store: quarantineStore,
        fingerprints: recentFailureFingerprints,
        failureCode: failure.code,
        failThreshold: tuning.quarantineFailThreshold,
        ttlMinutes: tuning.quarantineTtlMinutes,
        maxEntries: tuning.quarantineMaxEntries,
        nowIso: isoNow(),
      })
      writeJsonIfChanged(quarantinePath, quarantineStore)
    }
    persistResumeState({
      coverageCursor: nextCoverageCursor,
      sameFailureSignature,
      sameFailureSignatureStreak,
      qualityCollapseResetCounts,
      failureFingerprints: recentFailureFingerprints,
      lastFailureCode: failure.code,
      lastFailureClass: failureClass,
      lastFailureDetail: failure.detail,
    })

    const plan = planAutoActions({
      failureCode: failure.code,
      failureDetail: failure.detail,
      tuning,
      rules,
      sameFailureStreak,
      sameFailureSignatureStreak,
      successEval: referenceSuccessEval,
    })
    const prevRules = rules
    const prevTuning = tuning
    const { nextRules, actionItems, rulesDriftBlocked, proposedRules } =
      applyRuleLockToPlan({ rules, plan, rulesLocked })
    const tuningPolicy = applyDeterministicTuningPolicy({
      previousTuning: prevTuning,
      plannedTuning: plan.nextTuning,
    })
    const nextTuning = tuningPolicy.nextTuning
    writeJson(path.join(attemptDir, "failure_report.json"), {
      ...failure,
      failureClass,
      sameFailureCode,
      sameFailureStreak,
      sameFailureSignature,
      sameFailureSignatureStreak,
      coveragePlan,
      breakerDecision,
      qualityCollapseResetPlanned,
      qualityCollapseResetLimit,
      qualityCollapseResetStreak,
      qualityCollapseResetScopeKey,
      qualityCollapseResetCount,
      qualityCollapseResetAllowedByLimit,
      qualityCollapseResetCounts,
      failureCounters: {
        structuralFailures,
        qualityFailures,
        transientFailures,
        securityFailures,
      },
      failureFingerprintCarry: fingerprintCarry,
      topReasons: referenceReport?.failureLeaderboard?.top ?? [],
      reportStatus: referenceReport?.status ?? null,
      lockboxOk: referenceReport?.lockboxOk ?? null,
      maxTargetPassed: referenceReport?.maxTargetPassed ?? null,
      moonshotGateDiagnostics: moonshotGateDiagnostics ?? null,
      moonshotGateDiagnosticsPath: moonshotGateDiagnostics
        ? moonshotGateDiagnosticsPath
        : null,
      surgePoolDiagnostics:
        failure.code === "SURGE_POOL_EMPTY" ||
        isInsufficientPoolFailureCode(failure.code)
          ? surgePoolDiagnostics
          : null,
      surgePoolDiagnosticsPath:
        (failure.code === "SURGE_POOL_EMPTY" ||
          isInsufficientPoolFailureCode(failure.code)) &&
        surgePoolDiagnostics
          ? surgePoolDiagnosticsPath
          : null,
    })
    writeJson(path.join(attemptDir, "root_cause.json"), {
      ts: isoNow(),
      attempt,
      stage: String(stageResults[stageResults.length - 1]?.stage ?? "UNKNOWN"),
      code: failure.code,
      detail: failure.detail,
      class: failureClass,
      sameFailureCode,
      sameFailureStreak,
      sameFailureSignature,
      sameFailureSignatureStreak,
      coveragePlan,
      breakerDecision,
      qualityCollapseResetLimit,
      qualityCollapseResetScopeKey,
      qualityCollapseResetCount,
      qualityCollapseResetAllowedByLimit,
      failureCounters: {
        structuralFailures,
        qualityFailures,
        transientFailures,
        securityFailures,
      },
      reportStatus: referenceReport?.status ?? null,
      topReasons: referenceReport?.failureLeaderboard?.top ?? [],
      moonshotGateDiagnosticsPath: moonshotGateDiagnosticsPath ?? null,
      surgePoolDiagnosticsPath: surgePoolDiagnosticsPath ?? null,
    })
    writeJson(path.join(attemptDir, "action_plan.json"), actionItems)
    writeJson(path.join(attemptDir, "action_result.json"), {
      previousRules: prevRules,
      nextRules,
      proposedRules,
      rulesDriftBlocked,
      ruleLockMode: rulesLocked ? "IMMUTABLE" : "MUTABLE",
      previousTuning: redactSensitiveObject(prevTuning),
      nextTuning: redactSensitiveObject(nextTuning),
      tuningPolicy: tuningPolicy.policy,
    })
    writeJson(path.join(attemptDir, "next_retry_plan.json"), {
      attemptNext: attempt + 1,
      nextCoverageCursor,
      failureFingerprintCarry: {
        total: recentFailureFingerprints.length,
      },
      stopOnSameFailure:
        isSameFailureStopEnabled(tuning) &&
        isSameFailureStopTarget(sameFailureCode) &&
        sameFailureStreak >= Math.max(1, sameFailureLimit),
      stopOnPoolEmptyConsecutive:
        failure.code === "SURGE_POOL_EMPTY" &&
        (Number(tuning.poolEmptyMaxConsecutive ?? 0) || 0) > 0 &&
        sameFailureStreak >=
          Math.max(1, Number(tuning.poolEmptyMaxConsecutive)),
      stopOnInsufficientPoolRecycle:
        !qualityCollapseResetPlanned &&
        isInsufficientPoolFailureCode(failure.code) &&
        (Number(tuning.insufficientPoolRecycleLimit ?? 4) || 0) > 0 &&
        sameFailureStreak >=
          Math.max(1, Number(tuning.insufficientPoolRecycleLimit ?? 4)),
      qualityCollapseResetPlanned,
      qualityCollapseResetLimit,
      qualityCollapseResetScopeKey,
      qualityCollapseResetCount,
      qualityCollapseResetAllowedByLimit,
    })
    writeJson(path.join(attemptDir, "attempt_result.json"), {
      finalResult: null,
      stageResults,
      failure: {
        code: failure.code,
        detail: failure.detail,
        class: failureClass,
        sameFailureStreak,
        sameFailureSignatureStreak,
      },
    })
    const observability = buildAttemptObservability({
      sessionId,
      attempt,
      stageResults,
      rules,
      tuning,
      failure,
      failureClass,
      sameFailureStreak,
      sameFailureSignatureStreak,
      coveragePlan,
      sourceIdentity,
      summary: referenceSummary,
      report: referenceReport,
      memoryHeadroom,
      runtimeMeta: runtimeAttempt.runtimeMeta,
    })
    const observabilityPath = path.join(attemptDir, "observability.json")
    writeJson(observabilityPath, redactSensitiveObject(observability))
    profileStatsStore = updateProfileStatsStoreOnAttempt({
      store: profileStatsStore,
      profileId: runtimeAttempt?.runtimeMeta?.profile,
      observability,
      failureClass,
      resultStatus: "FAIL",
    })
    writeJsonIfChanged(profileStatsPath, profileStatsStore)
    const funnel = observability.funnel ?? {}
    const funnelDropStage =
      (Number(funnel.signalsLoaded ?? 0) || 0) <= 0
        ? "SIGNALS_LOADED"
        : (Number(funnel.signalsQualified ?? 0) || 0) <= 0
          ? "SIGNALS_QUALIFIED"
          : (Number(funnel.stage1Candidates ?? 0) || 0) <= 0
            ? "CANDIDATE_GENERATION"
            : (Number(funnel.stage1PassCount ?? 0) || 0) <= 0
              ? "STAGE1_GATE"
              : (Number(funnel.stage2Entered ?? 0) || 0) <= 0
                ? "STAGE2_ENTRY"
                : (Number(funnel.passFinalCount ?? 0) || 0) <= 0
                  ? "PASS_FINAL"
                  : "NONE"
    const postmortem = {
      ts: isoNow(),
      sessionId,
      attempt,
      failureType: failureClass,
      failureCode: failure.code,
      failureDetail: failure.detail,
      funnelDropStage,
      recommendedNextActions: actionItems
        .map((row) => String(row?.type ?? "").trim())
        .filter(Boolean),
      circuitBreaker: breakerDecision,
      lockStatus: loopRunLock,
      quarantine: {
        enabled: tuning.quarantineEnabled !== false,
        path: quarantinePath,
      },
      evidencePaths: [
        path.join(attemptDir, "failure_report.json"),
        path.join(attemptDir, "root_cause.json"),
        observabilityPath,
      ],
    }
    const emptyRecommendationOutputs = ensureEmptyRecommendationOutputs({
      asOfDateKey: rules?.asOfInput ?? null,
      failureCode: failure.code,
      failureDetail: failure.detail,
      routerCloseDecisionTimeKST: tuning?.routerCloseDecisionTimeKST ?? "15:30",
    })
    if (emptyRecommendationOutputs) {
      postmortem.recommendationOutputs = emptyRecommendationOutputs
      for (const row of emptyRecommendationOutputs.outputs ?? []) {
        if (row?.latestPath) {
          postmortem.evidencePaths.push(row.latestPath)
        }
        if (row?.datedPath) {
          postmortem.evidencePaths.push(row.datedPath)
        }
      }
    }
    writeJson(path.join(attemptDir, "postmortem.auto.json"), postmortem)
    recordRisk({
      attempt,
      stage: String(stageResults[stageResults.length - 1]?.stage ?? "UNKNOWN"),
      severity:
        failureClass === "STRUCTURAL"
          ? "HIGH"
          : failureClass === "QUALITY"
            ? "MEDIUM"
            : "MEDIUM",
      code: failure.code,
      summary: failure.detail,
      evidencePaths: [
        path.join(attemptDir, "failure_report.json"),
        path.join(attemptDir, "attempt_result.json"),
        String(stageResults[stageResults.length - 1]?.logPath ?? "").trim(),
        moonshotGateDiagnostics ? moonshotGateDiagnosticsPath : "",
        (failure.code === "SURGE_POOL_EMPTY" ||
          isInsufficientPoolFailureCode(failure.code)) &&
        surgePoolDiagnostics
          ? surgePoolDiagnosticsPath
          : "",
      ],
    })
    recordMilestone({
      name: "ATTEMPT_FAIL",
      attempt,
      stage: String(stageResults[stageResults.length - 1]?.stage ?? "UNKNOWN"),
      status: "FAIL",
      details: { code: failure.code },
    })
    updateProgress(
      {
        attemptsCompleted:
          (Number(progressState.attemptsCompleted ?? 0) || 0) + 1,
        lastAttemptStatus: "FAIL",
        lastStage: String(
          stageResults[stageResults.length - 1]?.stage ?? "UNKNOWN",
        ),
        consecutiveInsufficientPool: isInsufficientPoolFailureCode(failure.code)
          ? sameFailureStreak
          : 0,
        lastMoonshotGateFailLines:
          Number(moonshotGateDiagnostics?.log?.failLines ?? 0) || 0,
        lastMoonshotGateReason:
          String(moonshotGateDiagnostics?.topReason ?? "").trim() || null,
        ...buildProgressObservabilityPatch(observability),
      },
      {
        attempt,
        stage: String(
          stageResults[stageResults.length - 1]?.stage ?? "UNKNOWN",
        ),
        phase: "ATTEMPT_FAIL",
        timeoutMs: 0,
      },
    )
    appendSessionIndex("ATTEMPT_FAIL", {
      attempt,
      stage: String(stageResults[stageResults.length - 1]?.stage ?? "UNKNOWN"),
      code: failure.code,
      class: failureClass,
    })

    lastFailureDetail = failure.detail
    rules = nextRules
    tuning = nextTuning
    coverageCursor = nextCoverageCursor
    writeJson(coverageLedgerPath, {
      sessionId,
      updatedAt: new Date().toISOString(),
      coverageCursor,
      coveragePlan,
      sameFailureSignature,
      sameFailureSignatureStreak,
      failureFingerprintCarry: {
        total: recentFailureFingerprints.length,
      },
    })
    if (!rulesLocked) {
      writeJsonIfChanged(rulesPath, rules)
    }
    writeJsonIfChanged(tuningPath, tuning)
    if (breakerDecision.stop) {
      finalResult = {
        status: breakerDecision.status,
        attempt,
        failureCode: failure.code,
        failureClass,
        sameFailureStreak,
        sessionId,
      }
      updateProgress(
        {
          status: breakerDecision.status,
          lastAttemptStatus: breakerDecision.status,
        },
        {
          attempt,
          stage: String(
            stageResults[stageResults.length - 1]?.stage ?? "UNKNOWN",
          ),
          phase: "SESSION_STOPPED",
          timeoutMs: 0,
        },
      )
      appendSessionIndex("SESSION_STOPPED", {
        attempt,
        reason: breakerDecision.status,
        failureCode: failure.code,
        failureClass,
      })
      break
    }

    if (qualityCollapseResetPlanned) {
      const nextQualityCollapseResetCounts = {
        ...qualityCollapseResetCounts,
        [qualityCollapseResetScopeKey]: qualityCollapseResetCount + 1,
      }
      qualityCollapseResetCounts = normalizeQualityCollapseResetCounts(
        nextQualityCollapseResetCounts,
      )
      const clearedFingerprints = recentFailureFingerprints.length
      recentFailureFingerprints = []
      sameFailureCode = null
      sameFailureStreak = 0
      sameFailureSignature = null
      sameFailureSignatureStreak = 0
      recordMilestone({
        name: "QUALITY_COLLAPSE_RESET",
        attempt,
        stage: String(
          stageResults[stageResults.length - 1]?.stage ?? "UNKNOWN",
        ),
        status: "APPLIED",
        details: {
          failureCode: failure.code,
          threshold: qualityCollapseResetStreak,
          qualityCollapseResetLimit,
          qualityCollapseResetScopeKey,
          qualityCollapseResetCount,
          qualityCollapseResetAllowedByLimit,
          clearedFingerprints,
        },
      })
      recordRisk({
        attempt,
        stage: String(
          stageResults[stageResults.length - 1]?.stage ?? "UNKNOWN",
        ),
        severity: "MEDIUM",
        code: "QUALITY_COLLAPSE_RESET",
        summary: `reset applied after streak=${qualityCollapseResetStreak}`,
        evidencePaths: [path.join(attemptDir, "failure_report.json")],
      })
      persistResumeState({
        coverageCursor,
        sameFailureSignature,
        sameFailureSignatureStreak,
        qualityCollapseResetCounts,
        failureFingerprints: recentFailureFingerprints,
        lastFailureCode: "QUALITY_COLLAPSE_RESET",
        lastFailureClass: "QUALITY",
        lastFailureDetail: qualityCollapseResetScopeKey,
      })
    } else if (
      qualityCollapseResetEnabled &&
      isQualityCollapseResetTarget &&
      sameFailureStreak >= qualityCollapseResetStreak &&
      !qualityCollapseResetAllowedByLimit
    ) {
      recordMilestone({
        name: "QUALITY_COLLAPSE_RESET_LIMIT_REACHED",
        attempt,
        stage: String(
          stageResults[stageResults.length - 1]?.stage ?? "UNKNOWN",
        ),
        status: "FAIL",
        details: {
          failureCode: failure.code,
          qualityCollapseResetLimit,
          qualityCollapseResetScopeKey,
          qualityCollapseResetCount,
        },
      })
    }

    const poolEmptyMaxConsecutive = Math.max(
      0,
      Math.floor(Number(tuning.poolEmptyMaxConsecutive ?? 0) || 0),
    )
    const insufficientPoolRecycleLimit = Math.max(
      0,
      Math.floor(Number(tuning.insufficientPoolRecycleLimit ?? 4) || 4),
    )
    if (
      failure.code === "SURGE_POOL_EMPTY" &&
      poolEmptyMaxConsecutive > 0 &&
      sameFailureStreak >= Math.max(1, poolEmptyMaxConsecutive)
    ) {
      finalResult = {
        status: "STOPPED_BY_POOL_EMPTY_LIMIT",
        attempt,
        failureCode: failure.code,
        sameFailureStreak,
        poolEmptyMaxConsecutive,
        sessionId,
      }
      updateProgress(
        {
          status: "STOPPED_BY_POOL_EMPTY_LIMIT",
          lastAttemptStatus: "STOPPED_BY_POOL_EMPTY_LIMIT",
        },
        {
          attempt,
          stage: String(
            stageResults[stageResults.length - 1]?.stage ?? "UNKNOWN",
          ),
          phase: "SESSION_STOPPED",
          timeoutMs: 0,
        },
      )
      appendSessionIndex("SESSION_STOPPED", {
        attempt,
        reason: "POOL_EMPTY_LIMIT",
        failureCode: failure.code,
      })
      break
    }

    if (
      !qualityCollapseResetPlanned &&
      isInsufficientPoolFailureCode(failure.code) &&
      insufficientPoolRecycleLimit > 0 &&
      sameFailureStreak >= Math.max(1, insufficientPoolRecycleLimit)
    ) {
      finalResult = {
        status: "STOPPED_BY_INSUFFICIENT_POOL_RECYCLE",
        attempt,
        failureCode: failure.code,
        sameFailureStreak,
        insufficientPoolRecycleLimit,
        sessionId,
      }
      updateProgress(
        {
          status: "STOPPED_BY_INSUFFICIENT_POOL_RECYCLE",
          lastAttemptStatus: "STOPPED_BY_INSUFFICIENT_POOL_RECYCLE",
        },
        {
          attempt,
          stage: String(
            stageResults[stageResults.length - 1]?.stage ?? "UNKNOWN",
          ),
          phase: "SESSION_STOPPED",
          timeoutMs: 0,
        },
      )
      appendSessionIndex("SESSION_STOPPED", {
        attempt,
        reason: "INSUFFICIENT_POOL_RECYCLE",
        failureCode: failure.code,
        sameFailureStreak,
      })
      break
    }

    if (
      isSameFailureStopEnabled(tuning) &&
      isSameFailureStopTarget(sameFailureCode) &&
      sameFailureStreak >= Math.max(1, sameFailureLimit)
    ) {
      finalResult = {
        status: "STOPPED_BY_SAME_FAILURE_LIMIT",
        attempt,
        failureCode: sameFailureCode,
        sameFailureStreak,
        sessionId,
      }
      updateProgress(
        {
          status: "STOPPED_BY_SAME_FAILURE_LIMIT",
          lastAttemptStatus: "STOPPED_BY_SAME_FAILURE_LIMIT",
        },
        {
          attempt,
          stage: String(
            stageResults[stageResults.length - 1]?.stage ?? "UNKNOWN",
          ),
          phase: "SESSION_STOPPED",
          timeoutMs: 0,
        },
      )
      appendSessionIndex("SESSION_STOPPED", {
        attempt,
        reason: "SAME_FAILURE_LIMIT",
        failureCode: sameFailureCode,
      })
      break
    }
    const waitMs = resolveRetryBackoffMs(tuning, {
      sameFailureStreak,
      failureClass,
      failureCode: sameFailureCode ?? failure.code,
    })
    if (waitMs > 0) {
      await sleep(waitMs)
    }
  }

  const completed = {
    sessionId,
    endedAt: isoNow(),
    result: finalResult ?? {
      status: "FAILED_MAX_ATTEMPTS",
      maxAttempts,
      sessionId,
    },
    rulesPath,
    tuningPath,
  }
  transitionState({
    nextState: "FINALIZE",
    attempt: progressState.currentAttempt,
    stage: progressState.lastStage,
    note: "WRITE_FINAL_RESULT",
  })
  writeJson(path.join(sessionDir, "final_result.json"), completed)
  if (
    completed.result.status !== "SUCCESS" &&
    completed.result.status !== "SUCCESS_DRY"
  ) {
    recordMilestone({
      name: "SESSION_COMPLETE",
      attempt:
        Number(
          completed.result?.attempt ?? progressState.currentAttempt ?? 0,
        ) || 0,
      stage: progressState.lastStage,
      status: "FAIL",
      details: { status: completed.result.status },
    })
  }
  updateProgress(
    {
      status: completed.result.status,
      lastAttemptStatus: completed.result.status,
    },
    {
      attempt: progressState.currentAttempt,
      stage: progressState.lastStage,
      phase: "SESSION_COMPLETED",
      timeoutMs: 0,
    },
  )
  appendSessionIndex("COMPLETED", {
    result: completed.result.status,
  })
  transitionState({
    nextState: "STOP",
    attempt: progressState.currentAttempt,
    stage: "STOP",
    note: "SESSION_COMPLETED",
  })
  const recentMilestones = readNdjsonTailSafe(sessionMilestonePath, 20)
  const recentRisks = readNdjsonTailSafe(sessionRiskPath, 20)
  const summaryText = buildSessionSummaryMarkdown({
    sessionManifest,
    progress: progressState,
    finalResult: completed,
    recentMilestones,
    recentRisks,
  })
  writeText(sessionSummaryPath, summaryText)
  releaseLoopRunLock({ lockPath: runLockPath, sessionId })
  clearInterval(progressPulse)
  if (prisma && typeof prisma.$disconnect === "function") {
    await prisma.$disconnect().catch(() => null)
  }
  runtimeCrashContext = null
  console.log(`[auto-upgrade] session=${sessionId}`)
  console.log(`[auto-upgrade] result=${completed.result.status}`)
  console.log(`[auto-upgrade] artifacts=${sessionDir}`)
}

run().catch((error) => {
  const ctx = runtimeCrashContext
  const rawCode = String(error?.code ?? "FAILED_CRASH")
    .trim()
    .toUpperCase()
  const mappedStatus =
    rawCode === "RUN_LOCK_HELD"
      ? "STOPPED_BY_RUN_LOCK"
      : rawCode === "SCHEMA_INVALID"
        ? "STOPPED_BY_SCHEMA_VALIDATION"
        : rawCode === "DIRTY_TREE_BLOCKED" ||
            rawCode === "SECRET_FILE_DETECTED" ||
            rawCode === "NO_KIS_REQUIRED" ||
            rawCode === "KIS_ENABLED_BLOCKED" ||
            rawCode === "POLICY_CONFLICT_BLOCKED"
          ? "STOPPED_BY_SECURITY_GUARD"
          : "FAILED_CRASH"
  if (ctx?.sessionId && ctx?.sessionDir) {
    const endedAt = isoNow()
    const errorMessage = String(error?.stack ?? error?.message ?? error ?? "")
      .trim()
      .slice(0, 4000)
    try {
      appendNdjson(ctx.sessionRiskPath, {
        ts: endedAt,
        sessionId: ctx.sessionId,
        attempt: 0,
        stage: "PROCESS",
        severity: "HIGH",
        code: mappedStatus,
        summary: errorMessage || "unknown crash",
        evidencePaths: [],
      })
      const prevProgress = readJsonSafe(ctx.sessionProgressPath) ?? {}
      const nextProgress = {
        ...prevProgress,
        sessionId: ctx.sessionId,
        sessionDir: ctx.sessionDir,
        pid: process.pid,
        status: mappedStatus,
        lastFailureCode: mappedStatus,
        lastFailureDetail: errorMessage || "unknown crash",
        lastUpdatedAt: endedAt,
        riskEventsCount: (Number(prevProgress?.riskEventsCount ?? 0) || 0) + 1,
      }
      writeJson(ctx.sessionProgressPath, nextProgress)
      writeJson(ctx.sessionHeartbeatPath, {
        sessionId: ctx.sessionId,
        sessionDir: ctx.sessionDir,
        pid: process.pid,
        updatedAt: endedAt,
        status: mappedStatus,
        phase: "CRASHED",
        attempt: Number(prevProgress?.currentAttempt ?? 0) || 0,
        stage: String(prevProgress?.lastStage ?? "PROCESS"),
        timeoutMs: 0,
      })
      const finalPath = path.join(ctx.sessionDir, "final_result.json")
      if (!fs.existsSync(finalPath)) {
        writeJson(finalPath, {
          sessionId: ctx.sessionId,
          endedAt,
          result: {
            status: mappedStatus,
            reason: "UNCAUGHT_ERROR",
            code: rawCode,
            detail: errorMessage || "unknown crash",
          },
          rulesPath: ctx.rulesPath ?? null,
          tuningPath: ctx.tuningPath ?? null,
        })
      }
      writeJson(ctx.latestIndexPath, {
        sessionId: ctx.sessionId,
        sessionDir: ctx.sessionDir,
        pid: process.pid,
        startedAt: String(prevProgress?.startedAt ?? ""),
        lastUpdatedAt: endedAt,
        status: mappedStatus,
        currentAttempt: Number(prevProgress?.currentAttempt ?? 0) || 0,
        lastFailureCode: mappedStatus,
        lastPassedStage: prevProgress?.lastPassedStage ?? null,
      })
      appendNdjson(ctx.sessionsIndexPath, {
        ts: endedAt,
        sessionId: ctx.sessionId,
        sessionDir: ctx.sessionDir,
        event: "CRASHED",
        status: mappedStatus,
      })
    } catch {
      // keep original error reporting path
    }
    releaseLoopRunLock({
      lockPath: ctx.runLockPath,
      sessionId: ctx.sessionId,
    })
  }
  console.error("[auto-upgrade] failed", error)
  process.exitCode = 1
})
