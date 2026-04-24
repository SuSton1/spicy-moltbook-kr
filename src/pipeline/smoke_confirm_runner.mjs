import path from "node:path"
import { createHash } from "node:crypto"
import { appendFile, copyFile, link, readFile, symlink, unlink } from "node:fs/promises"

import { ensureDir, pathExists, readJson, readJsonl, toRunId, writeJson } from "../lib/io.mjs"
import { readChampionBundle } from "../lib/champion_bundle.mjs"
import { evaluateStepELockboxGate } from "../lib/lockbox_gate.mjs"
import {
  buildSmokeConfirmLineageSnapshot,
  computeLineageKey,
  resolveLineageStatePaths
} from "../lib/lineage_state.mjs"
import { resolveStepCInputPath } from "../lib/lightweight.mjs"
import { verifyChampionBundleParity } from "../lib/policy_parity.mjs"

import { runStepA } from "./step_a_event_extract.mjs"
import { runStepB } from "./step_b_template_build.mjs"
import { runStepC } from "./step_c_pattern_mine.mjs"
import { runStepD } from "./step_d_online_loop.mjs"
import { runStepE } from "./step_e_lockbox_backtest.mjs"

const cloneJson = (value) => JSON.parse(JSON.stringify(value))

const parseBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") return defaultValue
  if (typeof value === "boolean") return value
  const text = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  return defaultValue
}

const parseCount = (value, defaultValue) => {
  const n = Number(value ?? defaultValue)
  if (!Number.isFinite(n)) return defaultValue
  return Math.max(0, Math.floor(n))
}

const toSessionId = (value) => {
  const raw = String(value ?? "").trim()
  if (raw) return raw
  return `smcf_${toRunId()}`
}

const hashPayload = (value) =>
  createHash("sha1").update(JSON.stringify(value ?? null)).digest("hex")

const hashFileIfExists = async (filePath) => {
  const safePath = String(filePath ?? "").trim()
  if (!safePath || !pathExists(safePath)) return null
  try {
    const buffer = await readFile(safePath)
    return createHash("sha1").update(buffer).digest("hex")
  } catch {
    return null
  }
}

const linkOrCopyIfExists = async (src, dst) => {
  const safeSrc = String(src ?? "").trim()
  const safeDst = String(dst ?? "").trim()
  if (!safeSrc || !safeDst || !pathExists(safeSrc)) return false
  await ensureDir(path.dirname(safeDst))
  await unlink(safeDst).catch(() => {})
  try {
    await link(safeSrc, safeDst)
    return true
  } catch {
    // fall through
  }
  try {
    const relativeTarget = path.relative(path.dirname(safeDst), safeSrc)
    await symlink(relativeTarget, safeDst)
    return true
  } catch {
    // fall through
  }
  await copyFile(safeSrc, safeDst)
  return true
}

const ensureBaseStepCSnapshot = async (ctx, { forceStepC = false } = {}) => {
  const lightweightCfg = ctx.config?.lightweight ?? {}
  const stepASummaryPath = path.join(ctx.runDir, "step-a", "step_a_summary.json")
  const stepBSummaryPath = path.join(ctx.runDir, "step-b", "step_b_summary.json")
  const stepCSummaryPath = path.join(ctx.runDir, "step-c", "step_c_summary.json")
  const libraryPath = path.join(ctx.runDir, "step-c", "pattern_library.json")
  const runtimePath = path.join(ctx.runDir, "step-c", "pattern_library_runtime.json")

  let stepCInput = resolveStepCInputPath({
    runDir: ctx.runDir,
    lightweightCfg,
    preferLiteArtifacts: lightweightCfg?.pipeline?.preferLiteArtifacts
  })

  if (!pathExists(stepASummaryPath) && !pathExists(stepBSummaryPath)) {
    await runStepA(ctx)
  }
  if (!pathExists(stepBSummaryPath) || !pathExists(stepCInput.inPath)) {
    if (!pathExists(stepASummaryPath)) {
      await runStepA(ctx)
    }
    await runStepB(ctx)
    stepCInput = resolveStepCInputPath({
      runDir: ctx.runDir,
      lightweightCfg,
      preferLiteArtifacts: lightweightCfg?.pipeline?.preferLiteArtifacts
    })
  }
  if (!pathExists(stepCInput.inPath)) {
    throw new Error(
      [
        "smoke-confirm base Step B artifact missing for Step C.",
        `expected=${stepCInput.inPath}`,
        "Check lightweight.stepB.outputMode and lightweight.stepC.inputMode."
      ].join(" "),
    )
  }

  if (
    forceStepC === true ||
    !pathExists(stepCSummaryPath) ||
    !pathExists(libraryPath) ||
    !pathExists(runtimePath)
  ) {
    await runStepC(ctx)
  }

  if (!pathExists(libraryPath) || !pathExists(runtimePath) || !pathExists(stepCSummaryPath)) {
    throw new Error("smoke-confirm requires a valid Step C snapshot.")
  }

  return {
    sourceRunDir: ctx.runDir,
    libraryPath,
    runtimePath,
    summaryPath: stepCSummaryPath
  }
}

const ensureBundleStepCSnapshot = async ({ bundle, snapshotDir }) => {
  const libraryPath = String(bundle?.stepC?.libraryPath ?? "").trim()
  const runtimePath = String(bundle?.stepC?.runtimePath ?? "").trim()
  const summaryPath = String(bundle?.stepC?.summaryPath ?? "").trim()
  if (!libraryPath || !runtimePath || !summaryPath) {
    throw new Error("Champion bundle missing Step C snapshot paths.")
  }
  if (!pathExists(libraryPath) || !pathExists(runtimePath) || !pathExists(summaryPath)) {
    throw new Error("Champion bundle Step C snapshot files are missing.")
  }
  await ensureDir(snapshotDir)
  await linkOrCopyIfExists(libraryPath, path.join(snapshotDir, "pattern_library.json"))
  await linkOrCopyIfExists(runtimePath, path.join(snapshotDir, "pattern_library_runtime.json"))
  await linkOrCopyIfExists(summaryPath, path.join(snapshotDir, "step_c_summary.json"))
  return {
    sourceRunDir: path.dirname(path.dirname(libraryPath)),
    libraryPath,
    runtimePath,
    summaryPath
  }
}

const copyStepCSnapshot = async ({ snapshotDir, targetRunDir }) => {
  const targetDir = path.join(targetRunDir, "step-c")
  await ensureDir(targetDir)
  await linkOrCopyIfExists(
    path.join(snapshotDir, "pattern_library.json"),
    path.join(targetDir, "pattern_library.json"),
  )
  await linkOrCopyIfExists(
    path.join(snapshotDir, "pattern_library_runtime.json"),
    path.join(targetDir, "pattern_library_runtime.json"),
  )
  await linkOrCopyIfExists(
    path.join(snapshotDir, "step_c_summary.json"),
    path.join(targetDir, "step_c_summary.json"),
  )
  return targetDir
}

const buildStepDSignaturePayload = (summary) => ({
  pickHitRate: Number(summary?.pickHitRate ?? 0) || 0,
  pickHitRateLcb95: Number(summary?.pickHitRateLcb95 ?? 0) || 0,
  pickHitRateEval: Number(summary?.pickHitRateEval ?? 0) || 0,
  pickHitRateEvalLcb95: Number(summary?.pickHitRateEvalLcb95 ?? 0) || 0,
  pickedCount: Math.max(0, Number(summary?.pickedCount ?? 0) || 0),
  pickedDays: Math.max(0, Number(summary?.pickedDays ?? 0) || 0),
  top1ToOracleConversion: Number(summary?.top1ToOracleConversion ?? 0) || 0,
  top1ToOracleConversionEval: Number(summary?.top1ToOracleConversionEval ?? 0) || 0,
  budgetedConversion80: Number(summary?.budgetedConversion80 ?? 0) || 0,
  budgetedConversion80Eval: Number(summary?.budgetedConversion80Eval ?? 0) || 0,
  gateReasonCounts: summary?.gateReasonCounts ?? {},
  agreementDecisionCounts: summary?.agreementDecisionCounts ?? {},
  dayTypeCounts: summary?.dayTypeCounts ?? {},
  falsePositiveDecisionCounts: summary?.falsePositiveDecisionCounts ?? {},
  budgetDecisionCounts: summary?.budgetDecisionCounts ?? {}
})

const extractStepEPrimaryMetrics = (summary) => {
  const goalMode = String(summary?.goalMode ?? "").trim().toUpperCase()
  if (goalMode === "TARGET_FIRST_V2") {
    return {
      goalMode,
      primaryMetric: "target_hit_rate",
      primaryRate: Number(summary?.targetHitRate ?? 0) || 0,
      primaryCount: Math.max(0, Number(summary?.targetHitCount ?? 0) || 0)
    }
  }
  return {
    goalMode,
    primaryMetric: "win_rate",
    primaryRate: Number(summary?.winRate ?? 0) || 0,
    primaryCount: Math.max(0, Number(summary?.totalTrades ?? 0) || 0)
  }
}

const buildStepESignaturePayload = (summary) => ({
  ...extractStepEPrimaryMetrics(summary),
  winRate: Number(summary?.winRate ?? 0) || 0,
  avgNetRet: Number(summary?.avgNetRet ?? 0) || 0,
  cumulativeReturn: Number(summary?.cumulativeReturn ?? 0) || 0,
  maxDrawdown: Number(summary?.maxDrawdown ?? 0) || 0,
  totalTrades: Math.max(0, Number(summary?.totalTrades ?? 0) || 0),
  targetHitRate: Number(summary?.targetHitRate ?? 0) || 0,
  targetHitCount: Math.max(0, Number(summary?.targetHitCount ?? 0) || 0),
  lookaheadViolations: Math.max(0, Number(summary?.lookaheadViolations ?? 0) || 0),
  executionLookaheadViolations: Math.max(
    0,
    Number(summary?.executionLookaheadViolations ?? 0) || 0,
  ),
  policyDriftScore: Number(summary?.policyDrift?.policyDriftScore ?? 0) || 0,
  traceMismatchRate: Number(summary?.traceDiff?.mismatchRate ?? 0) || 0,
  traceCriticalMismatchDays: Math.max(
    0,
    Number(summary?.traceDiff?.criticalMismatchDays ?? 0) || 0,
  )
})

const buildStepEMetricsSnapshot = (summary) => {
  if (!summary || typeof summary !== "object") return null
  const primary = extractStepEPrimaryMetrics(summary)
  return {
    summaryPath: summary?.summaryPath ?? null,
    goalMode: primary.goalMode || null,
    primaryMetric: primary.primaryMetric,
    primaryRate: primary.primaryRate,
    primaryCount: primary.primaryCount,
    targetHitRate: Number(summary?.targetHitRate ?? 0) || 0,
    targetHitCount: Math.max(0, Number(summary?.targetHitCount ?? 0) || 0),
    winRate: Number(summary?.winRate ?? 0) || 0,
    avgNetRet: Number(summary?.avgNetRet ?? 0) || 0,
    cumulativeReturn: Number(summary?.cumulativeReturn ?? 0) || 0,
    maxDrawdown: Number(summary?.maxDrawdown ?? 0) || 0,
    totalTrades: Math.max(0, Number(summary?.totalTrades ?? 0) || 0),
    policyDriftScore: Number(summary?.policyDriftScore ?? 0) || 0,
    traceMismatchRate: Number(summary?.traceMismatchRate ?? 0) || 0,
    traceCriticalMismatchDays: Math.max(
      0,
      Number(summary?.traceCriticalMismatchDays ?? 0) || 0,
    )
  }
}

const summarizeWallTimes = (runs, key) => {
  const values = runs
    .map((row) => Number(row?.[key] ?? 0))
    .filter((value) => Number.isFinite(value) && value >= 0)
  if (values.length < 1) {
    return { count: 0, min: 0, max: 0, mean: 0 }
  }
  const total = values.reduce((acc, value) => acc + value, 0)
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: total / values.length
  }
}

const summarizeHitRate = (runs, key) => {
  if (!Array.isArray(runs) || runs.length < 1) return 0
  const count = runs.length
  const total = runs.reduce(
    (acc, row) => acc + (row?.[key] === true ? 1 : 0),
    0,
  )
  return total / count
}

const summarizeLockboxGate = (runs) => {
  const safeRuns = Array.isArray(runs) ? runs : []
  const reasonCounts = {}
  let eligibleCount = 0
  let availableCount = 0
  let lastEval = null
  for (const row of safeRuns) {
    const evalResult = row?.stepE?.lockboxGate
    if (!evalResult || typeof evalResult !== "object") continue
    availableCount += 1
    lastEval = cloneJson(evalResult)
    const reason = String(evalResult?.reason ?? "UNKNOWN")
    reasonCounts[reason] = Number(reasonCounts[reason] ?? 0) + 1
    if (evalResult?.eligible === true) {
      eligibleCount += 1
    }
  }
  return {
    available: availableCount > 0,
    runCount: availableCount,
    eligibleCount,
    eligibleRate: availableCount > 0 ? eligibleCount / availableCount : 0,
    allEligible: availableCount > 0 && eligibleCount === availableCount,
    reasonCounts,
    last: lastEval
  }
}

const buildBaseStepCFingerprint = ({ libraryHash, runtimeHash }) =>
  hashPayload({
    libraryHash: String(libraryHash ?? "").trim() || null,
    runtimeHash: String(runtimeHash ?? "").trim() || null
  })

const buildSmokeConfirmLedgerEventKey = ({ sessionId, phase, index }) =>
  `${String(sessionId ?? "").trim()}::${String(phase ?? "").trim()}::${Math.max(0, Number(index ?? 0) || 0)}`

const normalizePhaseRuns = (runs) =>
  (Array.isArray(runs) ? runs : [])
    .filter((row) => row && typeof row === "object")
    .slice()
    .sort((left, right) => {
      const phaseCmp = String(left?.phase ?? "").localeCompare(String(right?.phase ?? ""))
      if (phaseCmp !== 0) return phaseCmp
      return Number(left?.index ?? 0) - Number(right?.index ?? 0)
    })

const dedupeSmokeConfirmLedgerEvents = (rows) => {
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = buildSmokeConfirmLedgerEventKey(row)
    if (!key) continue
    map.set(key, row)
  }
  return Array.from(map.values()).sort((left, right) => {
    const lKey = buildSmokeConfirmLedgerEventKey(left)
    const rKey = buildSmokeConfirmLedgerEventKey(right)
    return lKey.localeCompare(rKey)
  })
}

const appendSmokeConfirmLedgerEvent = async ({ ledgerPath, event }) => {
  await ensureDir(path.dirname(ledgerPath))
  await appendFile(ledgerPath, `${JSON.stringify(event)}\n`, "utf8")
}

const extractSessionPhaseRunsFromLedger = ({ events, sessionId, phase }) =>
  dedupeSmokeConfirmLedgerEvents(events)
    .filter((row) => {
      const rowSessionId = String(row?.sessionId ?? "").trim()
      const rowPhase = String(row?.phase ?? "").trim().toLowerCase()
      return rowSessionId === String(sessionId ?? "").trim() && rowPhase === String(phase ?? "").trim().toLowerCase()
    })
    .map((row) => row?.run ?? {})

const summarizeValidationGate = ({
  runCount,
  sanityPass,
  decisionStable,
  lockboxGate
}) => {
  const hasRuns = Math.max(0, Number(runCount ?? 0) || 0) > 0
  const lockboxAllEligible = lockboxGate?.allEligible === true
  const eligible =
    hasRuns &&
    sanityPass === true &&
    decisionStable === true &&
    lockboxAllEligible
  const reason = (() => {
    if (!hasRuns) return "NO_RUNS"
    if (sanityPass !== true) return "SANITY_FAIL"
    if (lockboxGate?.available !== true) return "LOCKBOX_GATE_MISSING"
    if (lockboxAllEligible !== true) {
      const reasonCounts = lockboxGate?.reasonCounts ?? {}
      const firstFailure = Object.keys(reasonCounts).find((key) => key !== "PASS")
      return String(firstFailure ?? lockboxGate?.last?.reason ?? "LOCKBOX_GATE_FAIL")
    }
    if (decisionStable !== true) return "DECISION_UNSTABLE"
    return "PASS"
  })()
  return {
    eligible,
    reason,
    checks: {
      hasRuns,
      sanityPass: sanityPass === true,
      decisionStable: decisionStable === true,
      lockboxGateAvailable: lockboxGate?.available === true,
      lockboxGateEligible: lockboxAllEligible
    },
    metrics: {
      runCount: Math.max(0, Number(runCount ?? 0) || 0),
      eligibleCount: Math.max(0, Number(lockboxGate?.eligibleCount ?? 0) || 0),
      eligibleRate: Number(lockboxGate?.eligibleRate ?? 0) || 0,
      distinctFailureReasons: Object.keys(lockboxGate?.reasonCounts ?? {}).filter((key) => key !== "PASS").length
    }
  }
}

const summarizePhaseRuns = (runs) => {
  const safeRuns = Array.isArray(runs) ? runs : []
  const stepDSignatures = new Set(safeRuns.map((row) => String(row?.stepD?.signature ?? "")))
  stepDSignatures.delete("")
  const stepESignatures = new Set(safeRuns.map((row) => String(row?.stepE?.signature ?? "")))
  stepESignatures.delete("")
  const stepDWeightHashes = safeRuns
    .map((row) => String(row?.stepD?.weightsHash ?? "").trim())
    .filter(Boolean)
  const stepDWeightsPaths = safeRuns
    .map((row) => String(row?.stepD?.weightsPath ?? "").trim())
    .filter(Boolean)
  const distinctStepDWeightsPaths = new Set(stepDWeightsPaths)
  const distinctStepDWeightsHashes = new Set(stepDWeightHashes)
  const stableStepDWeightsHash =
    distinctStepDWeightsHashes.size === 1
      ? Array.from(distinctStepDWeightsHashes)[0]
      : null
  const stableStepDRun =
    stableStepDWeightsHash
      ? [...safeRuns]
        .reverse()
        .find((row) => String(row?.stepD?.weightsHash ?? "").trim() === stableStepDWeightsHash) ?? null
      : null
  const stableStepESignature =
    stepESignatures.size === 1
      ? Array.from(stepESignatures)[0]
      : null
  const stableStepERun =
    stableStepESignature
      ? [...safeRuns]
        .reverse()
        .find((row) => String(row?.stepE?.signature ?? "").trim() === stableStepESignature) ?? null
      : null
  const lastStepDRun =
    [...safeRuns]
      .reverse()
      .find((row) => row?.stepD && (row?.stepD?.weightsPath || row?.stepD?.weightsHash)) ??
    (safeRuns.length > 0 ? safeRuns[safeRuns.length - 1] : null)
  const lastStepERun =
    [...safeRuns]
      .reverse()
      .find((row) => row?.stepE && (row?.stepE?.summaryPath || row?.stepE?.signature)) ??
    (safeRuns.length > 0 ? safeRuns[safeRuns.length - 1] : null)
  const sanityPass = safeRuns.every((row) => row?.sanityPass === true)
  const stepDWeightsStable =
    distinctStepDWeightsHashes.size > 0
      ? distinctStepDWeightsHashes.size <= 1
      : distinctStepDWeightsPaths.size <= 1
  const decisionStable =
    stepDSignatures.size <= 1 &&
    stepESignatures.size <= 1 &&
    stepDWeightsStable
  const lockboxGate = summarizeLockboxGate(safeRuns)
  const validationGate = summarizeValidationGate({
    runCount: safeRuns.length,
    sanityPass,
    decisionStable,
    lockboxGate
  })
  const confirmedStepDRun =
    validationGate?.eligible === true &&
    decisionStable === true &&
    stableStepDRun?.stepD?.weightsPath &&
    stableStepDRun?.stepD?.weightsHash
      ? stableStepDRun
      : null
  const confirmedStepERun =
    validationGate?.eligible === true &&
    decisionStable === true &&
    stableStepERun?.stepE
      ? stableStepERun
      : null
  return {
    runCount: safeRuns.length,
    dWallMs: summarizeWallTimes(safeRuns, "dWallMs"),
    eWallMs: summarizeWallTimes(safeRuns, "eWallMs"),
    totalWallMs: summarizeWallTimes(safeRuns, "totalWallMs"),
    runtimeCacheHitRate: summarizeHitRate(safeRuns, "runtimeCacheHit"),
    workerPoolCacheHitRate: summarizeHitRate(safeRuns, "workerPoolCacheHit"),
    lockboxArtifactCacheHitRate: summarizeHitRate(safeRuns, "lockboxArtifactCacheHit"),
    decisionStable,
    distinctStepDSignatures: stepDSignatures.size,
    distinctStepESignatures: stepESignatures.size,
    distinctStepDWeightsPaths: distinctStepDWeightsPaths.size,
    distinctStepDWeightsHashes: distinctStepDWeightsHashes.size,
    stableStepDWeightsHash,
    stepDWeightsStable,
    stableStepDWeightsPath: stableStepDRun?.stepD?.weightsPath ?? null,
    stableStepDMetrics: stableStepDRun?.stepD
      ? {
        weightsPath: stableStepDRun.stepD.weightsPath ?? null,
        weightsHash: stableStepDRun.stepD.weightsHash ?? null,
        pickHitRate: Number(stableStepDRun.stepD.pickHitRate ?? 0) || 0,
        pickHitRateLcb95: Number(stableStepDRun.stepD.pickHitRateLcb95 ?? 0) || 0,
        pickedCount: Math.max(0, Number(stableStepDRun.stepD.pickedCount ?? 0) || 0),
        pickedDays: Math.max(0, Number(stableStepDRun.stepD.pickedDays ?? 0) || 0),
        top1ToOracleConversion: Number(stableStepDRun.stepD.top1ToOracleConversion ?? 0) || 0,
        budgetedConversion80: Number(stableStepDRun.stepD.budgetedConversion80 ?? 0) || 0
      }
      : null,
    stableStepEMetrics: buildStepEMetricsSnapshot(stableStepERun?.stepE),
    confirmedWeightsPath: confirmedStepDRun?.stepD?.weightsPath ?? null,
    confirmedWeightsHash: confirmedStepDRun?.stepD?.weightsHash ?? null,
    confirmedStepDMetrics: confirmedStepDRun?.stepD
      ? {
        weightsPath: confirmedStepDRun.stepD.weightsPath ?? null,
        weightsHash: confirmedStepDRun.stepD.weightsHash ?? null,
        pickHitRate: Number(confirmedStepDRun.stepD.pickHitRate ?? 0) || 0,
        pickHitRateLcb95: Number(confirmedStepDRun.stepD.pickHitRateLcb95 ?? 0) || 0,
        pickedCount: Math.max(0, Number(confirmedStepDRun.stepD.pickedCount ?? 0) || 0),
        pickedDays: Math.max(0, Number(confirmedStepDRun.stepD.pickedDays ?? 0) || 0),
        top1ToOracleConversion: Number(confirmedStepDRun.stepD.top1ToOracleConversion ?? 0) || 0,
        budgetedConversion80: Number(confirmedStepDRun.stepD.budgetedConversion80 ?? 0) || 0
      }
      : null,
    confirmedStepEMetrics: buildStepEMetricsSnapshot(confirmedStepERun?.stepE),
    lastStepDWeightsPath: stepDWeightsPaths.length > 0 ? stepDWeightsPaths[stepDWeightsPaths.length - 1] : null,
    lastStepDMetrics: lastStepDRun?.stepD
      ? {
        weightsPath: lastStepDRun.stepD.weightsPath ?? null,
        weightsHash: lastStepDRun.stepD.weightsHash ?? null,
        pickHitRate: Number(lastStepDRun.stepD.pickHitRate ?? 0) || 0,
        pickHitRateLcb95: Number(lastStepDRun.stepD.pickHitRateLcb95 ?? 0) || 0,
        pickedCount: Math.max(0, Number(lastStepDRun.stepD.pickedCount ?? 0) || 0),
        pickedDays: Math.max(0, Number(lastStepDRun.stepD.pickedDays ?? 0) || 0),
        top1ToOracleConversion: Number(lastStepDRun.stepD.top1ToOracleConversion ?? 0) || 0,
        budgetedConversion80: Number(lastStepDRun.stepD.budgetedConversion80 ?? 0) || 0
      }
      : null,
    lastStepEMetrics: buildStepEMetricsSnapshot(lastStepERun?.stepE),
    sanityPass,
    lockboxGate,
    validationGate
  }
}

const materializeSmokeConfirmLineageState = ({ lineageKey, events }) => {
  const deduped = dedupeSmokeConfirmLedgerEvents(events)
  const smokeRuns = []
  const confirmRuns = []
  const sessionIds = new Set()
  for (const row of deduped) {
    const phase = String(row?.phase ?? "").trim().toLowerCase()
    if (phase !== "smoke" && phase !== "confirm") continue
    sessionIds.add(String(row?.sessionId ?? "").trim())
    if (phase === "smoke") smokeRuns.push(row?.run ?? {})
    else confirmRuns.push(row?.run ?? {})
  }
  return {
    lineageKey,
    updatedAt: new Date().toISOString(),
    eventCount: deduped.length,
    sessionCount: Array.from(sessionIds).filter(Boolean).length,
    sessions: Array.from(sessionIds).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    smoke: {
      runCount: smokeRuns.length,
      aggregate: summarizePhaseRuns(smokeRuns)
    },
    confirm: {
      runCount: confirmRuns.length,
      aggregate: summarizePhaseRuns(confirmRuns)
    }
  }
}

const resolveSmokeConfirmConfig = ({ ctx, flags }) => {
  const cfg = ctx.config?.smokeConfirm ?? {}
  const phaseRaw = String(flags?.phase ?? cfg?.phase ?? "both")
    .trim()
    .toLowerCase()
  const phase = ["both", "smoke", "confirm"].includes(phaseRaw) ? phaseRaw : "both"
  const smokeRuns = parseCount(flags?.["smoke-runs"] ?? cfg?.smokeRuns, 2)
  const confirmRuns = parseCount(flags?.["confirm-runs"] ?? cfg?.confirmRuns, 4)
  const stopOnSmokeFailure = parseBool(
    flags?.["stop-on-smoke-failure"],
    cfg?.stopOnSmokeFailure === true,
  )
  const forceStepC = parseBool(flags?.["force-step-c"], cfg?.forceStepC === true)
  const startWeightsPath = String(flags?.["start-weights-path"] ?? "").trim()
  const championBundlePath = String(flags?.["champion-bundle-path"] ?? "").trim()
  return {
    sessionId: toSessionId(flags?.["session-id"]),
    phase,
    smokeRuns,
    confirmRuns,
    stopOnSmokeFailure,
    forceStepC,
    startWeightsPath,
    championBundlePath
  }
}

const shouldRunPhase = (phase, phaseName) =>
  phase === "both" || phase === phaseName

export const runSmokeConfirmRunner = async ({ ctx, flags }) => {
  const resolved = resolveSmokeConfirmConfig({ ctx, flags })
  const sessionDir = path.join(ctx.runDir, "smoke-confirm", resolved.sessionId)
  const snapshotDir = path.join(sessionDir, "base-step-c")
  const summaryPath = path.join(sessionDir, "smoke_confirm_summary.json")
  await ensureDir(sessionDir)

  ctx.__runtime = ctx.__runtime ?? {}
  const sharedRuntime = ctx.__runtime
  let runnerSummary = {
    mode: "smoke-confirm",
    generatedAt: new Date().toISOString(),
    runId: String(ctx?.runId ?? ""),
    sessionId: resolved.sessionId,
    configPath: ctx.configPath,
    phase: resolved.phase,
    smokeRunsRequested: resolved.smokeRuns,
    confirmRunsRequested: resolved.confirmRuns,
    stopOnSmokeFailure: resolved.stopOnSmokeFailure,
    forceStepC: resolved.forceStepC,
    startWeightsPath: resolved.startWeightsPath || null,
    championBundlePath: resolved.championBundlePath || null,
    runtimeReuse: {
      reuseRuntimeCache: ctx?.config?.lightweight?.stepD?.reuseRuntimeCache === true,
      keepWorkerPoolAlive: ctx?.config?.lightweight?.stepD?.keepWorkerPoolAlive === true
    },
    baseStepC: null,
    smoke: {
      requestedRuns: shouldRunPhase(resolved.phase, "smoke") ? resolved.smokeRuns : 0,
      executedRuns: 0,
      stoppedEarly: false,
      stopReason: "",
      runs: [],
      aggregate: null
    },
    confirm: {
      requestedRuns: shouldRunPhase(resolved.phase, "confirm") ? resolved.confirmRuns : 0,
      executedRuns: 0,
      stoppedEarly: false,
      stopReason: "",
      runs: [],
      aggregate: null
    },
    status: "running"
  }
  let lineageKey = ""
  let lineageStatePaths = null

  const persistSummary = async () => {
    if (!runnerSummary) return
    runnerSummary.updatedAt = new Date().toISOString()
    await writeJson(summaryPath, runnerSummary)
  }

  try {
    const championBundle = resolved.championBundlePath
      ? await readChampionBundle(resolved.championBundlePath)
      : null
    const championBundleHash = resolved.championBundlePath
      ? await hashFileIfExists(resolved.championBundlePath)
      : null
    const effectiveStartWeightsPath =
      resolved.startWeightsPath ||
      String(championBundle?.stepD?.weightsPath ?? "").trim()
    const baseStepC = championBundle
      ? await ensureBundleStepCSnapshot({
          bundle: championBundle,
          snapshotDir
        })
      : await ensureBaseStepCSnapshot(ctx, {
          forceStepC: resolved.forceStepC
        })
    await ensureDir(snapshotDir)
    await linkOrCopyIfExists(baseStepC.libraryPath, path.join(snapshotDir, "pattern_library.json"))
    await linkOrCopyIfExists(baseStepC.runtimePath, path.join(snapshotDir, "pattern_library_runtime.json"))
    await linkOrCopyIfExists(baseStepC.summaryPath, path.join(snapshotDir, "step_c_summary.json"))
    const baseLibraryObject = await readJson(baseStepC.libraryPath, null)
    const baseRuntimeMetaObject = await readJson(baseStepC.runtimePath, null)
    if (!baseLibraryObject || !baseRuntimeMetaObject) {
      throw new Error("smoke-confirm requires readable Step C snapshot objects.")
    }
    const baseLibraryHash = await hashFileIfExists(baseStepC.libraryPath)
    const baseRuntimeHash = await hashFileIfExists(baseStepC.runtimePath)
    const baseStepCFingerprint = buildBaseStepCFingerprint({
      libraryHash: baseLibraryHash,
      runtimeHash: baseRuntimeHash
    })
    const lineageSnapshot = buildSmokeConfirmLineageSnapshot({
      config: ctx.config,
      periods: ctx.periods,
      baseStepCFingerprint,
      startWeightsPath: effectiveStartWeightsPath || null,
      championBundleHash
    })
    lineageKey = computeLineageKey(lineageSnapshot)
    lineageStatePaths = resolveLineageStatePaths({
      cwd: ctx.cwd,
      lineageKey
    })
    await ensureDir(lineageStatePaths.dir)
    const ledgerPath = lineageStatePaths.smokeConfirmLedgerPath
    const existingLedgerRows = pathExists(ledgerPath) ? await readJsonl(ledgerPath) : []
    const existingSummary = await readJson(summaryPath, null)
    if (
      existingSummary?.lineageKey &&
      String(existingSummary.lineageKey).trim() &&
      String(existingSummary.lineageKey).trim() !== lineageKey
    ) {
      throw new Error(
        [
          "smoke-confirm session lineage mismatch.",
          `sessionId=${resolved.sessionId}`,
          `existingLineage=${String(existingSummary.lineageKey).trim()}`,
          `currentLineage=${lineageKey}`
        ].join(" "),
      )
    }
    const existingSmokeRunsFromLedger = normalizePhaseRuns(
      extractSessionPhaseRunsFromLedger({
        events: existingLedgerRows,
        sessionId: resolved.sessionId,
        phase: "smoke"
      }),
    )
    const existingConfirmRunsFromLedger = normalizePhaseRuns(
      extractSessionPhaseRunsFromLedger({
        events: existingLedgerRows,
        sessionId: resolved.sessionId,
        phase: "confirm"
      }),
    )
    const existingSmokeRuns =
      existingSmokeRunsFromLedger.length > 0
        ? existingSmokeRunsFromLedger
        : normalizePhaseRuns(existingSummary?.smoke?.runs)
    const existingConfirmRuns =
      existingConfirmRunsFromLedger.length > 0
        ? existingConfirmRunsFromLedger
        : normalizePhaseRuns(existingSummary?.confirm?.runs)
    runnerSummary = {
      ...runnerSummary,
      startWeightsPath: effectiveStartWeightsPath || null,
      lineageKey,
      lineageSnapshot,
      lineageStatePath: lineageStatePaths.smokeConfirmStatePath,
      lineageLedgerPath: lineageStatePaths.smokeConfirmLedgerPath,
      championBundle: championBundle
        ? {
            path: resolved.championBundlePath,
            hash: championBundleHash,
            stepC: championBundle?.stepC ?? {},
            stepD: championBundle?.stepD ?? {}
          }
        : null,
      resume: {
        resumed: existingSmokeRuns.length + existingConfirmRuns.length > 0,
        existingSmokeRuns: existingSmokeRuns.length,
        existingConfirmRuns: existingConfirmRuns.length
      },
      baseStepC: {
        sourceRunDir: baseStepC.sourceRunDir,
        snapshotDir,
        libraryPath: path.join(snapshotDir, "pattern_library.json"),
        runtimePath: path.join(snapshotDir, "pattern_library_runtime.json"),
        summaryPath: path.join(snapshotDir, "step_c_summary.json"),
        fingerprint: baseStepCFingerprint,
        libraryHash: baseLibraryHash,
        runtimeHash: baseRuntimeHash
      },
      smoke: {
        requestedRuns: shouldRunPhase(resolved.phase, "smoke") ? resolved.smokeRuns : 0,
        executedRuns: existingSmokeRuns.length,
        stoppedEarly: existingSummary?.smoke?.stoppedEarly === true,
        stopReason: String(existingSummary?.smoke?.stopReason ?? ""),
        runs: existingSmokeRuns,
        aggregate:
          existingSmokeRuns.length > 0
            ? summarizePhaseRuns(existingSmokeRuns)
            : null
      },
      confirm: {
        requestedRuns: shouldRunPhase(resolved.phase, "confirm") ? resolved.confirmRuns : 0,
        executedRuns: existingConfirmRuns.length,
        stoppedEarly: existingSummary?.confirm?.stoppedEarly === true,
        stopReason: String(existingSummary?.confirm?.stopReason ?? ""),
        runs: existingConfirmRuns,
        aggregate:
          existingConfirmRuns.length > 0
            ? summarizePhaseRuns(existingConfirmRuns)
            : null
      },
      status: "running"
    }
    sharedRuntime.stepCRuntimeArtifacts = {
      libraryPath: baseStepC.libraryPath,
      runtimePath: baseStepC.runtimePath,
      libraryObject: baseLibraryObject,
      runtimeMetaObject: baseRuntimeMetaObject
    }
    if (championBundle) {
      sharedRuntime.championBundle = championBundle
    }
    sharedRuntime.reuseStepCRuntimeAcrossRunDirs = true
    const existingLedgerKeys = new Set(
      dedupeSmokeConfirmLedgerEvents(existingLedgerRows).map((row) => buildSmokeConfirmLedgerEventKey(row)),
    )
    for (const row of existingSmokeRuns) {
      const key = buildSmokeConfirmLedgerEventKey({
        sessionId: resolved.sessionId,
        phase: "smoke",
        index: row?.index
      })
      if (existingLedgerKeys.has(key)) continue
      await appendSmokeConfirmLedgerEvent({
        ledgerPath,
        event: {
          lineageKey,
          sessionId: resolved.sessionId,
          phase: "smoke",
          index: Number(row?.index ?? 0) || 0,
          run: row
        }
      })
      existingLedgerKeys.add(key)
    }
    for (const row of existingConfirmRuns) {
      const key = buildSmokeConfirmLedgerEventKey({
        sessionId: resolved.sessionId,
        phase: "confirm",
        index: row?.index
      })
      if (existingLedgerKeys.has(key)) continue
      await appendSmokeConfirmLedgerEvent({
        ledgerPath,
        event: {
          lineageKey,
          sessionId: resolved.sessionId,
          phase: "confirm",
          index: Number(row?.index ?? 0) || 0,
          run: row
        }
      })
      existingLedgerKeys.add(key)
    }
    const persistLineageState = async () => {
      if (!lineageStatePaths) return
      const ledgerRows = pathExists(ledgerPath) ? await readJsonl(ledgerPath) : []
      const materialized = materializeSmokeConfirmLineageState({
        lineageKey,
        events: ledgerRows
      })
      await writeJson(lineageStatePaths.smokeConfirmStatePath, materialized)
      runnerSummary.lineage = {
        key: lineageKey,
        statePath: lineageStatePaths.smokeConfirmStatePath,
        ledgerPath,
        sessionResumed: runnerSummary?.resume?.resumed === true,
        smokeLedgerRuns: Number(materialized?.smoke?.runCount ?? 0) || 0,
        confirmLedgerRuns: Number(materialized?.confirm?.runCount ?? 0) || 0
      }
    }
    await persistLineageState()
    await persistSummary()

    const runPhase = async (phaseName, count) => {
      if (!shouldRunPhase(resolved.phase, phaseName) || count < 1) return
      const phaseState = runnerSummary[phaseName]
      for (let index = phaseState.runs.length + 1; index <= count; index += 1) {
        const tag = `${phaseName[0]}${String(index).padStart(2, "0")}`
        const iterationRunDir = path.join(sessionDir, phaseName, tag)
        await copyStepCSnapshot({
          snapshotDir,
          targetRunDir: iterationRunDir
        })
        const iterationConfig = cloneJson(ctx.config)
        if (effectiveStartWeightsPath) {
          iterationConfig.onlineLearning = {
            ...(iterationConfig.onlineLearning ?? {}),
            startWeightsPath: effectiveStartWeightsPath
          }
        }
        const iterationCtx = {
          cwd: ctx.cwd,
          runId: `${ctx.runId}_${resolved.sessionId}_${tag}`,
          runDir: iterationRunDir,
          config: iterationConfig,
          configPath: ctx.configPath,
          periods: cloneJson(ctx.periods),
          __runtime: sharedRuntime
        }
        sharedRuntime.enableStepERuntimeCache = true
        sharedRuntime.stepERunMode = phaseName
        sharedRuntime.stepEWriteFullDiagnostics = phaseName !== "smoke"
        sharedRuntime.stepEForceDiagnosticReports = phaseName !== "smoke"
        const dStartedAt = Date.now()
        const stepD = await runStepD(iterationCtx)
        const dWallMs = Date.now() - dStartedAt
        const eStartedAt = Date.now()
        const stepE = await runStepE(iterationCtx)
        if (championBundle) {
          const parity = await verifyChampionBundleParity({
            bundle: championBundle,
            loadedStepCLibraryPath: path.join(iterationRunDir, "step-c", "pattern_library.json"),
            loadedStepCRuntimePath: path.join(iterationRunDir, "step-c", "pattern_library_runtime.json"),
            loadedPolicyStatePath: stepD?.policyStatePath,
            loadedWeightsPath: stepD?.weightsPath,
            loadedAuditPaths: {
              d1RankedCandidatesPath: stepD?.d1RankedCandidatesPath,
              d2ExecutionAuditPath: stepD?.d2ExecutionAuditPath,
              d1LockboxRankedCandidatesPath: stepD?.d1LockboxRankedCandidatesPath,
              d2LockboxExecutionAuditPath: stepD?.d2LockboxExecutionAuditPath
            }
          })
          if (!parity.ok) {
            throw new Error(
              `Champion bundle parity mismatch: ${JSON.stringify(parity.mismatches)}`
            )
          }
        }
        const eWallMs = Date.now() - eStartedAt
        const totalWallMs = dWallMs + eWallMs
        const stepDSummary = stepD?.summary ?? {}
        const stepESummary = stepE?.summary ?? {}
        const stepDWeightsHash =
          String(stepDSummary?.weightsHash ?? "").trim() ||
          await hashFileIfExists(stepD?.weightsPath)
        const lockboxGateEval = evaluateStepELockboxGate({
          lockboxSummary: stepESummary,
          cfg: iterationCtx?.config?.cdLoop
        })
        const stepDSignature = hashPayload(buildStepDSignaturePayload(stepDSummary))
        const stepESignature = hashPayload(buildStepESignaturePayload(stepESummary))
        const sanityPass =
          Math.max(0, Number(stepESummary?.lookaheadViolations ?? 0) || 0) === 0 &&
          Math.max(0, Number(stepESummary?.executionLookaheadViolations ?? 0) || 0) === 0 &&
          Math.max(0, Number(stepESummary?.traceDiff?.criticalMismatchDays ?? 0) || 0) === 0
        const phaseRunRow = {
          phase: phaseName,
          index,
          tag,
          runId: iterationCtx.runId,
          runDir: iterationRunDir,
          dWallMs,
          eWallMs,
          totalWallMs,
          runtimeCacheHit: stepDSummary?.runtimeCacheHit === true,
          workerPoolCacheHit: stepDSummary?.workerPoolCacheHit === true,
          lockboxArtifactCacheHit: stepDSummary?.lockboxArtifactCache?.hit === true,
          workerPoolScoreMs: Number(stepDSummary?.workerPoolScoreMs ?? 0) || 0,
          scoreMsPerSeed: Number(stepDSummary?.scoreMsPerSeed ?? 0) || 0,
          stepD: {
            summaryPath: stepD?.summaryPath ?? null,
            weightsPath: stepD?.weightsPath ?? null,
            weightsHash: stepDWeightsHash,
            pickHitRate: Number(stepDSummary?.pickHitRate ?? 0) || 0,
            pickHitRateLcb95: Number(stepDSummary?.pickHitRateLcb95 ?? 0) || 0,
            pickedCount: Math.max(0, Number(stepDSummary?.pickedCount ?? 0) || 0),
            pickedDays: Math.max(0, Number(stepDSummary?.pickedDays ?? 0) || 0),
            top1ToOracleConversion: Number(stepDSummary?.top1ToOracleConversion ?? 0) || 0,
            budgetedConversion80: Number(stepDSummary?.budgetedConversion80 ?? 0) || 0,
            signature: stepDSignature
          },
          stepE: {
            summaryPath: stepE?.summaryPath ?? null,
            tradesPath: stepE?.tradesPath ?? null,
            replayFeedbackPath: stepE?.replayFeedbackPath ?? null,
            traceDiffPath: stepE?.traceDiffPath ?? null,
            winRate: Number(stepESummary?.winRate ?? 0) || 0,
            avgNetRet: Number(stepESummary?.avgNetRet ?? 0) || 0,
            cumulativeReturn: Number(stepESummary?.cumulativeReturn ?? 0) || 0,
            maxDrawdown: Number(stepESummary?.maxDrawdown ?? 0) || 0,
            totalTrades: Math.max(0, Number(stepESummary?.totalTrades ?? 0) || 0),
            lookaheadViolations: Math.max(0, Number(stepESummary?.lookaheadViolations ?? 0) || 0),
            executionLookaheadViolations: Math.max(
              0,
              Number(stepESummary?.executionLookaheadViolations ?? 0) || 0,
            ),
            policyDriftScore: Number(stepESummary?.policyDrift?.policyDriftScore ?? 0) || 0,
            traceMismatchRate: Number(stepESummary?.traceDiff?.mismatchRate ?? 0) || 0,
            traceCriticalMismatchDays: Math.max(
              0,
              Number(stepESummary?.traceDiff?.criticalMismatchDays ?? 0) || 0,
            ),
            lockboxGate: lockboxGateEval,
            signature: stepESignature
          },
          sanityPass
        }
        phaseState.runs.push(phaseRunRow)
        await appendSmokeConfirmLedgerEvent({
          ledgerPath,
          event: {
            lineageKey,
            sessionId: resolved.sessionId,
            phase: phaseName,
            index,
            run: phaseRunRow
          }
        })
        phaseState.executedRuns = phaseState.runs.length
        phaseState.aggregate = summarizePhaseRuns(phaseState.runs)
        await persistLineageState()
        await persistSummary()
        if (
          phaseName === "smoke" &&
          resolved.stopOnSmokeFailure &&
          phaseState.aggregate?.validationGate?.eligible !== true
        ) {
          phaseState.stoppedEarly = true
          phaseState.stopReason = String(
            phaseState.aggregate?.validationGate?.reason ?? "SMOKE_VALIDATION_FAILURE",
          )
          break
        }
      }
    }

    await runPhase("smoke", resolved.smokeRuns)
    const shouldSkipConfirm =
      runnerSummary.smoke.stoppedEarly === true &&
      runnerSummary.smoke.stopReason !== ""
    if (shouldSkipConfirm) {
      runnerSummary.confirm.stoppedEarly = true
      runnerSummary.confirm.stopReason = "SKIPPED_AFTER_SMOKE_FAILURE"
    } else {
      await runPhase("confirm", resolved.confirmRuns)
    }

    runnerSummary.smoke.aggregate = summarizePhaseRuns(runnerSummary.smoke.runs)
    runnerSummary.confirm.aggregate = summarizePhaseRuns(runnerSummary.confirm.runs)
    runnerSummary.status = "ok"
    await persistLineageState()
    await persistSummary()
    return {
      step: "SMOKE_CONFIRM",
      summaryPath,
      summary: runnerSummary
    }
  } catch (error) {
    runnerSummary.status = "error"
    runnerSummary.error = error instanceof Error ? error.message : String(error)
    runnerSummary.errorStack = error instanceof Error ? error.stack ?? "" : ""
    if (lineageStatePaths?.smokeConfirmStatePath) {
      const ledgerRows = pathExists(lineageStatePaths.smokeConfirmLedgerPath)
        ? await readJsonl(lineageStatePaths.smokeConfirmLedgerPath)
        : []
      const materialized = materializeSmokeConfirmLineageState({
        lineageKey,
        events: ledgerRows
      })
      await writeJson(lineageStatePaths.smokeConfirmStatePath, materialized).catch(() => {})
    }
    await persistSummary().catch(() => {})
    throw error
  }
}
