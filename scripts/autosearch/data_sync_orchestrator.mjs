import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { spawn, spawnSync } from "node:child_process"
import dotenv from "dotenv"

import { normalizeDateKey, shiftDateKey } from "../ai-date-range.lib.mjs"
import { assertServerOnly } from "../lib/heavy-run-guard.mjs"

const rootDir = process.cwd()

const loadLocalEnv = () => {
  const candidates = [".env", ".env.local", "env.local"]
  for (const file of candidates) {
    const fullPath = path.join(rootDir, file)
    if (fs.existsSync(fullPath)) {
      dotenv.config({ path: fullPath })
    }
  }
}

const toDateKeyKst = (ts = Date.now()) => {
  const kst = new Date(Number(ts) + 9 * 60 * 60_000)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0")
  const d = String(kst.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

const parseIntSafe = (value, fallback) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

const parseNumberSafe = (value, fallback) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

const parseBoolean = (value, fallback = false) => {
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

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.floor(Number(ms) || 0)))
  })

const resolveWindowDays = (windowRaw) => {
  const window = String(windowRaw ?? "6y")
    .trim()
    .toLowerCase()
  if (!window) return 6 * 365
  const yearMatch = window.match(/^(\d+)y(r)?$/)
  if (yearMatch) {
    return Math.max(30, Math.min(20 * 365, parseIntSafe(yearMatch[1], 6) * 365))
  }
  const dayMatch = window.match(/^(\d+)d$/)
  if (dayMatch) {
    return Math.max(7, Math.min(20 * 365, parseIntSafe(dayMatch[1], 180)))
  }
  if (window === "6y") return 6 * 365
  if (window === "2y") return 2 * 365
  return 6 * 365
}

const normalizeRecommendAsOf = (value) => {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  if (raw.toLowerCase() === "last_trading_day") {
    return "last_trading_day"
  }
  return normalizeDateKey(raw)
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const get = (key) => {
    const prefix = `${key}=`
    const found = args.find((arg) => arg.startsWith(prefix))
    return found ? found.slice(prefix.length) : undefined
  }
  const hasFlag = (key) => args.includes(key)

  return {
    asOfDateKey: normalizeDateKey(get("--asof")) ?? toDateKeyKst(),
    fromDateKey: normalizeDateKey(get("--from")),
    toDateKey: normalizeDateKey(get("--to")) ?? null,
    window: String(get("--window") ?? "6y")
      .trim()
      .toLowerCase(),
    market: String(get("--market") ?? "KR")
      .trim()
      .toUpperCase(),
    symbolLimit: String(get("--symbol-limit") ?? "all")
      .trim()
      .toLowerCase(),
    stopAfter: String(get("--stopAfter") ?? "derived")
      .trim()
      .toLowerCase(),
    recommendAsOf: normalizeRecommendAsOf(
      get("--recommendAsOf") ?? get("--recommend-asof"),
    ),
    skipTrain: parseBoolean(get("--skip-train"), true),
    skipPatternTrain: parseBoolean(get("--skip-pattern-train"), true),
    noKis: parseBoolean(get("--no-kis"), true),
    allowNoActiveStrategy: parseBoolean(get("--allowNoActiveStrategy"), true),
    allowEmptyEligible: parseBoolean(
      get("--allowEmptyEligible") ?? get("--allow-empty-eligible"),
      true,
    ),
    skipSymbolMaster:
      hasFlag("--skipSymbolMaster") ||
      hasFlag("--skip-symbol-master") ||
      parseBoolean(
        get("--skipSymbolMaster") ?? get("--skip-symbol-master"),
        false,
      ),
    mode: String(get("--mode") ?? "weekly_strict")
      .trim()
      .toLowerCase(),
    forceRepair: parseBoolean(get("--forceRepair"), false),
    fastRecommendRepair: parseBoolean(
      get("--fastRecommendRepair") ?? get("--fast-recommend-repair"),
      true,
    ),
    strict: parseBoolean(get("--strict"), true),
    minCoverage: Math.max(
      0,
      Math.min(1, parseNumberSafe(get("--minCoverage"), 0.985)),
    ),
    minUniverseSize: Math.max(0, parseIntSafe(get("--minUniverseSize"), 1)),
    minTradingDays: Math.max(1, parseIntSafe(get("--minTradingDays"), 16)),
    requireSignals: parseBoolean(get("--requireSignals"), false),
    minSignalsLoaded: Math.max(0, parseIntSafe(get("--minSignalsLoaded"), 1)),
    signalWindowTradingDays: Math.max(
      1,
      Math.min(252, parseIntSafe(get("--signalWindowTradingDays"), 28)),
    ),
    repairPaddingDays: Math.max(
      0,
      parseIntSafe(get("--repairPaddingDays"), 10),
    ),
    repairTailDays: Math.max(5, parseIntSafe(get("--repairTailDays"), 45)),
    maxRepairLookbackDays: Math.max(
      30,
      parseIntSafe(
        get("--maxRepairLookbackDays"),
        resolveWindowDays(get("--window") ?? "6y"),
      ),
    ),
    auditOutPath: String(get("--auditOut") ?? "").trim(),
    fullAuditOnly: parseBoolean(get("--fullAuditOnly"), false),
    signalFilter: {
      track: String(get("--track") ?? "SURGE_EOD").trim() || "SURGE_EOD",
      role: String(get("--role") ?? "MOONSHOT").trim() || "MOONSHOT",
      policyType:
        String(get("--policyType") ?? "RECOMMEND").trim() || "RECOMMEND",
      mode: String(get("--modeSignal") ?? "EOD").trim() || "EOD",
      status: String(get("--status") ?? "ACTIVE").trim() || "ACTIVE",
      emitStatus: String(get("--emitStatus") ?? "EMITTED").trim() || "EMITTED",
    },
    lockPath: String(get("--lockPath") ?? "").trim(),
    lockWaitMs: Math.max(0, parseIntSafe(get("--lockWaitMs"), 60 * 60 * 1000)),
    lockPollMs: Math.max(1000, parseIntSafe(get("--lockPollMs"), 5000)),
    lockStaleMs: Math.max(15_000, parseIntSafe(get("--lockStaleMs"), 60_000)),
  }
}

const resolveSingleFlightLockPath = (args) => {
  const configured = String(args?.lockPath ?? "").trim()
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(rootDir, configured)
  }
  return path.join(
    rootDir,
    "artifacts",
    "autosearch_automation",
    "_index",
    "data_sync_orchestrator.lock",
  )
}

const tryAcquireSingleFlightLock = ({
  lockPath,
  waitMs = 0,
  pollMs = 5000,
  staleMs = 12 * 60 * 60 * 1000,
}) => {
  const deadlineMs = Date.now() + Math.max(0, Number(waitMs) || 0)
  const lockPayload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    argv: process.argv.slice(2),
  }
  const minStaleMs = Math.max(15_000, Number(staleMs) || 0)

  const attemptAcquire = () => {
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true })
      fs.writeFileSync(lockPath, `${JSON.stringify(lockPayload, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      })
      return { acquired: true, lockPath, lockPayload }
    } catch (error) {
      if (error?.code !== "EEXIST") {
        return {
          acquired: false,
          reason: "LOCK_WRITE_FAILED",
          lockPath,
          error: String(error?.message ?? error ?? "unknown"),
        }
      }
      const existing = (() => {
        try {
          return JSON.parse(fs.readFileSync(lockPath, "utf8"))
        } catch {
          return null
        }
      })()
      const ownerPid = Number(existing?.pid ?? 0) || 0
      const ownerAlive = isProcessAlive(ownerPid)
      const startedAtMs = Date.parse(String(existing?.startedAt ?? ""))
      const ageMs = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : 0
      const stale =
        !ownerAlive && (!Number.isFinite(startedAtMs) || ageMs >= minStaleMs)
      if (stale) {
        try {
          fs.unlinkSync(lockPath)
          return { acquired: false, reason: "LOCK_STALE_REMOVED", retry: true }
        } catch (unlinkError) {
          return {
            acquired: false,
            reason: "LOCK_STALE_REMOVE_FAILED",
            lockPath,
            ownerPid,
            ownerAlive,
            ageMs,
            error: String(unlinkError?.message ?? unlinkError ?? "unknown"),
          }
        }
      }
      return {
        acquired: false,
        reason: "LOCK_HELD",
        lockPath,
        ownerPid,
        ownerAlive,
        ageMs,
      }
    }
  }

  return (async () => {
    while (true) {
      const result = attemptAcquire()
      if (result.acquired === true) {
        return result
      }
      if (result.retry === true) {
        continue
      }
      const now = Date.now()
      if (now >= deadlineMs) {
        return {
          ...result,
          acquired: false,
          reason: "LOCK_WAIT_TIMEOUT",
        }
      }
      const remainingMs = Math.max(0, deadlineMs - now)
      process.stdout.write(
        `[data_sync_orchestrator] lock-wait ownerPid=${result.ownerPid ?? "unknown"} ownerAlive=${result.ownerAlive ? 1 : 0} remainingMs=${remainingMs}\n`,
      )
      await sleep(Math.min(Math.max(1000, pollMs), remainingMs))
    }
  })()
}

const releaseSingleFlightLock = ({ lockPath, lockPayload }) => {
  if (!lockPath || !fs.existsSync(lockPath)) return
  try {
    const existing = JSON.parse(fs.readFileSync(lockPath, "utf8"))
    const ownerPid = Number(existing?.pid ?? 0) || 0
    if (ownerPid > 1 && ownerPid !== process.pid) {
      return
    }
  } catch {
    // ignore ownership parse failures and try unlink
  }
  try {
    fs.unlinkSync(lockPath)
  } catch {
    // ignore
  }
}

const resolveAuditOutPath = (args) => {
  if (args.auditOutPath) {
    return path.isAbsolute(args.auditOutPath)
      ? args.auditOutPath
      : path.join(rootDir, args.auditOutPath)
  }
  const dir = path.join(rootDir, "artifacts", "autosearch_data_sync")
  fs.mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  return path.join(dir, `audit_${ts}.json`)
}

const spawnCollect = ({ command, args, cwd = rootDir, env = process.env }) => {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  })
  return {
    status: Number.isInteger(result.status) ? result.status : 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  }
}

const runAudit = ({ args, outPath, strict = false }) => {
  const commandArgs = [
    "scripts/autosearch/data_coverage_audit.mjs",
    `--asof=${args.asOfDateKey}`,
    `--window=${args.window}`,
    `--minCoverage=${args.minCoverage}`,
    `--minTradingDays=${args.minTradingDays}`,
    `--minUniverseSize=${args.minUniverseSize}`,
    `--signalWindowTradingDays=${args.signalWindowTradingDays}`,
    `--requireSignals=${args.requireSignals ? 1 : 0}`,
    `--minSignalsLoaded=${args.minSignalsLoaded}`,
    `--track=${args.signalFilter.track}`,
    `--role=${args.signalFilter.role}`,
    `--policyType=${args.signalFilter.policyType}`,
    `--mode=${args.signalFilter.mode}`,
    `--status=${args.signalFilter.status}`,
    `--emitStatus=${args.signalFilter.emitStatus}`,
    `--strict=${strict ? 1 : 0}`,
    `--out=${outPath}`,
  ]
  if (args.fromDateKey) {
    commandArgs.push(`--from=${args.fromDateKey}`)
  }
  const run = spawnCollect({
    command: "node",
    args: commandArgs,
  })

  let payload = null
  try {
    payload = JSON.parse(String(run.stdout ?? "").trim())
  } catch {
    try {
      payload = JSON.parse(fs.readFileSync(outPath, "utf8"))
    } catch {
      payload = null
    }
  }

  return {
    ...run,
    payload,
    command: ["node", ...commandArgs],
  }
}

const runFillStreaming = async ({ command, args, env }) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk)
    })
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk)
    })
    child.on("error", (error) => {
      process.stderr.write(
        `[data_sync_orchestrator] ${String(error?.message ?? error)}\n`,
      )
      resolve(1)
    })
    child.on("close", (code) => {
      resolve(Number.isInteger(code) ? code : 1)
    })
  })

const isRecommendRepairMode = (args) =>
  args.forceRepair && String(args.stopAfter ?? "").toLowerCase() === "recommend"

const buildFillArgs = ({ args, fromDateKey, toDateKey }) => {
  const recommendAsOf =
    normalizeRecommendAsOf(args?.recommendAsOf) ??
    normalizeDateKey(args?.asOfDateKey) ??
    normalizeDateKey(toDateKey) ??
    "last_trading_day"
  const fillArgs = [
    "run",
    "data:fill",
    "--",
    `--from=${fromDateKey}`,
    `--to=${toDateKey}`,
    `--market=${args.market}`,
    `--symbol-limit=${args.symbolLimit}`,
    `--stopAfter=${args.stopAfter}`,
    `--recommend-asof=${recommendAsOf}`,
  ]
  if (args.skipTrain) {
    fillArgs.push("--skip-train")
  }
  if (args.skipPatternTrain) {
    fillArgs.push("--skip-pattern-train")
  }
  if (args.noKis !== false) {
    fillArgs.push("--no-kis")
  }
  if (args.allowNoActiveStrategy !== false) {
    fillArgs.push("--recommend-no-require-active")
  }
  if (args.allowEmptyEligible !== false) {
    fillArgs.push("--recommend-allow-empty-eligible")
  }
  if (
    args.forceRepair &&
    String(args.stopAfter ?? "").toLowerCase() === "recommend"
  ) {
    fillArgs.push("--recommend-range")
  }
  if (args.skipSymbolMaster || args.forceRepair) {
    fillArgs.push("--skip-symbol-master")
  }
  return fillArgs
}

const buildQuickRecommendRepairSteps = ({ args, fromDateKey, toDateKey }) => {
  if (!isRecommendRepairMode(args) || args.fastRecommendRepair === false) {
    return null
  }
  const recommendAsOf =
    normalizeRecommendAsOf(args?.recommendAsOf) ??
    normalizeDateKey(args?.asOfDateKey) ??
    normalizeDateKey(toDateKey) ??
    "last_trading_day"
  return [
    {
      label: "quick:level-policy",
      command: "node",
      args: ["scripts/ai-level-policy.mjs", `--asOf=${recommendAsOf}`],
    },
    {
      label: "quick:recommend-range",
      command: "node",
      args: [
        "scripts/ai-recommend.mjs",
        `--asOf=${recommendAsOf}`,
        `--from=${fromDateKey}`,
        `--to=${toDateKey}`,
        ...(args.allowNoActiveStrategy !== false
          ? ["--no-requireActiveStrategy"]
          : []),
        ...(args.allowEmptyEligible !== false
          ? ["--allow-empty-eligible"]
          : []),
      ],
    },
  ]
}

const runQuickRecommendRepair = async ({ steps, env }) => {
  for (const step of steps) {
    process.stdout.write(
      `[data_sync_orchestrator] ${step.label} command=${step.command} ${step.args.join(" ")}\n`,
    )
    const code = await runFillStreaming({
      command: step.command,
      args: step.args,
      env,
    })
    if (code !== 0) {
      return { ok: false, failedStep: step.label, code }
    }
  }
  return { ok: true, failedStep: null, code: 0 }
}

const diffCalendarDaysInclusive = ({ fromDateKey, toDateKey }) => {
  const fromMs = Date.parse(`${String(fromDateKey ?? "").trim()}T00:00:00Z`)
  const toMs = Date.parse(`${String(toDateKey ?? "").trim()}T00:00:00Z`)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return 0
  }
  return Math.floor((toMs - fromMs) / 86_400_000) + 1
}

const resolveForceRepairHourlyLookbackDays = ({ fromDateKey, toDateKey }) => {
  const calendarDays = diffCalendarDaysInclusive({ fromDateKey, toDateKey })
  if (!Number.isFinite(calendarDays) || calendarDays <= 0) {
    return null
  }
  // Keep a small buffer so hourly/intraday recomputation covers the full repair window.
  return Math.max(30, Math.min(4000, calendarDays + 7))
}

const resolveRepairRange = ({ args, auditPayload }) => {
  const toDateKey = args.toDateKey ?? args.asOfDateKey
  const minDateKey =
    args.fromDateKey ??
    shiftDateKey(toDateKey, -args.maxRepairLookbackDays) ??
    toDateKey

  if (args.forceRepair && args.fromDateKey) {
    let fromDateKey = args.fromDateKey
    if (fromDateKey < minDateKey) {
      fromDateKey = minDateKey
    }
    if (fromDateKey > toDateKey) {
      fromDateKey = toDateKey
    }
    return { fromDateKey, toDateKey }
  }

  const earliestMissing = String(
    auditPayload?.repairHints?.earliestMissingDateKey ?? "",
  ).trim()

  let fromDateKey = minDateKey
  if (earliestMissing) {
    fromDateKey =
      shiftDateKey(earliestMissing, -args.repairPaddingDays) ?? earliestMissing
  } else {
    fromDateKey = shiftDateKey(toDateKey, -args.repairTailDays) ?? minDateKey
  }

  if (fromDateKey < minDateKey) {
    fromDateKey = minDateKey
  }
  if (fromDateKey > toDateKey) {
    fromDateKey = toDateKey
  }

  return { fromDateKey, toDateKey }
}

const summarizeAudit = (label, payload) => {
  const pass = payload?.pass === true
  const tradingDayCount =
    Number(payload?.tradingCalendar?.tradingDayCount ?? 0) || 0
  const universeSize = Number(payload?.universe?.universeSize ?? 0) || 0
  const missing = Number(payload?.repairHints?.requiredMissingCount ?? 0) || 0
  const reasons = Array.isArray(payload?.reasons)
    ? payload.reasons.filter(Boolean).join(",")
    : ""
  process.stdout.write(
    `[data_sync_orchestrator] ${label} pass=${pass ? 1 : 0} tradingDays=${tradingDayCount} universe=${universeSize} requiredMissing=${missing}${reasons ? ` reasons=${reasons}` : ""}\n`,
  )
}

const normalizeDateKeyLoose = (value) => {
  const digits = String(value ?? "").replace(/[^0-9]/g, "")
  if (digits.length !== 8) {
    return null
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

const getReasonSet = (payload) =>
  new Set(
    (Array.isArray(payload?.reasons) ? payload.reasons : [])
      .map((item) =>
        String(item ?? "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  )

const resolveFallbackAsOfDateKey = ({ payload, asOfDateKey }) => {
  const currentAsOf = normalizeDateKeyLoose(asOfDateKey)
  const requiredLatestDates = []
  const datasets = Array.isArray(payload?.datasets) ? payload.datasets : []
  for (const row of datasets) {
    if (row?.required !== true) continue
    const latest = normalizeDateKeyLoose(row?.latestPresentDateKey)
    if (latest) {
      requiredLatestDates.push(latest)
    }
  }
  const viable = requiredLatestDates.filter((dateKey) =>
    currentAsOf ? dateKey <= currentAsOf : true,
  )
  if (viable.length <= 0) {
    return null
  }
  return viable.sort((a, b) => a.localeCompare(b))[0]
}

const run = async () => {
  loadLocalEnv()
  assertServerOnly({ script: "autosearch:data_sync_orchestrator" })

  const args = parseArgs()
  const singleFlightLockPath = resolveSingleFlightLockPath(args)
  const lock = await tryAcquireSingleFlightLock({
    lockPath: singleFlightLockPath,
    waitMs: args.lockWaitMs,
    pollMs: args.lockPollMs,
    staleMs: args.lockStaleMs,
  })
  if (lock.acquired !== true) {
    process.stderr.write(
      `[data_sync_orchestrator] single-flight lock failed reason=${lock.reason ?? "LOCK_FAILED"} ownerPid=${lock.ownerPid ?? "unknown"}\n`,
    )
    return 75
  }

  try {
    const auditOutPath = resolveAuditOutPath(args)

    const preAudit = runAudit({ args, outPath: auditOutPath, strict: false })
    if (preAudit.status !== 0 || !preAudit.payload) {
      process.stderr.write(
        `[data_sync_orchestrator] pre-audit failed status=${preAudit.status} stderr=${preAudit.stderr.trim()}\n`,
      )
      return 1
    }

    summarizeAudit("pre-audit", preAudit.payload)

    let effectiveArgs = args
    let effectivePreAudit = preAudit
    let effectiveAuditOutPath = auditOutPath
    const preReasons = getReasonSet(preAudit.payload)
    const canFallback =
      preAudit.payload.pass !== true &&
      (preReasons.has("PREFLIGHT_UNIVERSE_LOW") ||
        preReasons.has("REQUIRED_DATASET_COVERAGE_LOW"))
    if (canFallback) {
      const fallbackAsOfDateKey = resolveFallbackAsOfDateKey({
        payload: preAudit.payload,
        asOfDateKey: args.asOfDateKey,
      })
      if (fallbackAsOfDateKey && fallbackAsOfDateKey !== args.asOfDateKey) {
        process.stdout.write(
          `[data_sync_orchestrator] fallback-asof enabled from=${args.asOfDateKey} to=${fallbackAsOfDateKey}\n`,
        )
        effectiveArgs = {
          ...args,
          asOfDateKey: fallbackAsOfDateKey,
          toDateKey: args.toDateKey ?? fallbackAsOfDateKey,
        }
        effectiveAuditOutPath = auditOutPath.replace(
          /\.json$/,
          `.fallback.${fallbackAsOfDateKey}.json`,
        )
        const fallbackAudit = runAudit({
          args: effectiveArgs,
          outPath: effectiveAuditOutPath,
          strict: false,
        })
        if (fallbackAudit.status !== 0 || !fallbackAudit.payload) {
          process.stderr.write(
            `[data_sync_orchestrator] fallback pre-audit failed status=${fallbackAudit.status} stderr=${fallbackAudit.stderr.trim()}\n`,
          )
          return 1
        }
        summarizeAudit("pre-audit-fallback", fallbackAudit.payload)
        effectivePreAudit = fallbackAudit
      }
    }

    if (args.fullAuditOnly) {
      return effectivePreAudit.payload.pass ? 0 : 2
    }

    if (effectivePreAudit.payload.pass === true && !args.forceRepair) {
      process.stdout.write(
        "[data_sync_orchestrator] repair skipped (coverage already healthy)\n",
      )
      return 0
    }

    const repairRange = resolveRepairRange({
      args: effectiveArgs,
      auditPayload: effectivePreAudit.payload,
    })
    const fillArgs = buildFillArgs({
      args: effectiveArgs,
      fromDateKey: repairRange.fromDateKey,
      toDateKey: repairRange.toDateKey,
    })
    const baseFillEnv = {
      ...process.env,
      NO_KIS: "1",
      BACKFILL_DISABLE_KIS: "1",
      BACKFILL_KIS_ENABLED: "0",
    }
    const quickRecommendSteps = buildQuickRecommendRepairSteps({
      args: effectiveArgs,
      fromDateKey: repairRange.fromDateKey,
      toDateKey: repairRange.toDateKey,
    })
    const forcedHourlyLookbackDays = effectiveArgs.forceRepair
      ? resolveForceRepairHourlyLookbackDays({
          fromDateKey: repairRange.fromDateKey,
          toDateKey: repairRange.toDateKey,
        })
      : null

    if (quickRecommendSteps) {
      process.stdout.write(
        `[data_sync_orchestrator] quick-repair enabled from=${repairRange.fromDateKey} to=${repairRange.toDateKey}\n`,
      )
      const quickResult = await runQuickRecommendRepair({
        steps: quickRecommendSteps,
        env: baseFillEnv,
      })
      if (quickResult.ok) {
        const quickPostAuditPath = effectiveAuditOutPath.replace(
          /\.json$/,
          ".quick.post.json",
        )
        const quickPostAudit = runAudit({
          args: effectiveArgs,
          outPath: quickPostAuditPath,
          strict: false,
        })
        if (quickPostAudit.status === 0 && quickPostAudit.payload) {
          summarizeAudit("post-audit-quick", quickPostAudit.payload)
          if (quickPostAudit.payload.pass) {
            process.stdout.write(
              "[data_sync_orchestrator] quick-repair PASS (full delta-repair skipped)\n",
            )
            return 0
          }
        } else {
          process.stderr.write(
            `[data_sync_orchestrator] quick post-audit failed status=${quickPostAudit.status} stderr=${quickPostAudit.stderr.trim()}\n`,
          )
        }
      } else {
        process.stderr.write(
          `[data_sync_orchestrator] quick-repair failed step=${quickResult.failedStep} exitCode=${quickResult.code}\n`,
        )
      }
      process.stdout.write(
        "[data_sync_orchestrator] quick-repair incomplete, falling back to full delta-repair\n",
      )
    }

    process.stdout.write(
      `[data_sync_orchestrator] delta-repair from=${repairRange.fromDateKey} to=${repairRange.toDateKey} mode=${effectiveArgs.mode} command=npm ${fillArgs.join(" ")}\n`,
    )
    if (forcedHourlyLookbackDays) {
      process.stdout.write(
        `[data_sync_orchestrator] force-repair hourlyLookbackDays=${forcedHourlyLookbackDays}\n`,
      )
    }

    const fillCode = await runFillStreaming({
      command: "npm",
      args: fillArgs,
      env: {
        ...baseFillEnv,
        ...(isRecommendRepairMode(effectiveArgs)
          ? {
              FILL_SKIP_HOURLY: "1",
              BACKFILL_SKIP_HOURLY: "1",
            }
          : null),
        ...(forcedHourlyLookbackDays
          ? {
              FILL_HOURLY_LOOKBACK_DAYS: String(forcedHourlyLookbackDays),
            }
          : null),
      },
    })

    if (fillCode !== 0) {
      process.stderr.write(
        `[data_sync_orchestrator] delta-repair failed exitCode=${fillCode}\n`,
      )
      return fillCode
    }

    const postAuditPath = effectiveAuditOutPath.replace(/\.json$/, ".post.json")
    const postAudit = runAudit({
      args: effectiveArgs,
      outPath: postAuditPath,
      strict: false,
    })
    if (postAudit.status !== 0 || !postAudit.payload) {
      process.stderr.write(
        `[data_sync_orchestrator] post-audit failed status=${postAudit.status} stderr=${postAudit.stderr.trim()}\n`,
      )
      return 1
    }

    summarizeAudit("post-audit", postAudit.payload)

    if (postAudit.payload.pass) {
      process.stdout.write("[data_sync_orchestrator] data sync PASS\n")
      return 0
    }

    process.stderr.write(
      "[data_sync_orchestrator] data coverage still low after delta-repair\n",
    )
    return args.strict ? 2 : 0
  } finally {
    releaseSingleFlightLock({
      lockPath: singleFlightLockPath,
      lockPayload: lock.lockPayload,
    })
  }
}

run()
  .catch((error) => {
    const message = String(error?.message ?? error ?? "UNKNOWN_ERROR")
    process.stderr.write(`[data_sync_orchestrator] ${message}\n`)
    return 1
  })
  .then((code) => {
    process.exit(Number.isInteger(code) ? Number(code) : 1)
  })
