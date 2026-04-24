import path from "node:path"
import fsp from "node:fs/promises"

import { ensureDir, pathExists, readJson, writeJson } from "../lib/io.mjs"
import { runStepD } from "./step_d_online_loop.mjs"

const clonePlain = (value) => JSON.parse(JSON.stringify(value ?? {}))

const copyDirIfExists = async (src, dst) => {
  const safeSrc = String(src ?? "").trim()
  const safeDst = String(dst ?? "").trim()
  if (!safeSrc || !safeDst || !pathExists(safeSrc)) return false
  await fsp.rm(safeDst, { recursive: true, force: true })
  await ensureDir(path.dirname(safeDst))
  await fsp.cp(safeSrc, safeDst, { recursive: true, force: true })
  return true
}

const readPayload = async (flags) => {
  const payloadPath = String(flags?.payload ?? "").trim()
  if (!payloadPath) {
    throw new Error("step-d-materialize requires --payload")
  }
  const payload = await readJson(payloadPath, null)
  if (!payload || typeof payload !== "object") {
    throw new Error(`step-d-materialize payload missing or invalid: ${payloadPath}`)
  }
  return {
    payloadPath,
    payload
  }
}

const resolveSourceRunDirFromPayloadPath = ({ payloadPath }) => {
  const safePayloadPath = String(payloadPath ?? "").trim()
  if (!safePayloadPath) return null
  const payloadDir = path.dirname(safePayloadPath)
  const candidateRunDirs = [
    path.dirname(payloadDir),
    path.dirname(path.dirname(payloadDir)),
    payloadDir
  ]
  for (const candidateRunDir of candidateRunDirs) {
    const candidateStepCDir = path.join(candidateRunDir, "step-c")
    if (pathExists(path.join(candidateStepCDir, "pattern_library.json"))) {
      return {
        sourceRunId: "",
        sourceRunDir: candidateRunDir
      }
    }
  }
  return null
}

const resolveSourceRunDir = ({ cwd, payload, payloadPath }) => {
  const rawRunId = String(payload?.sourceRunId ?? "").trim()
  if (rawRunId) {
    const sourceRunDir = path.join(cwd, "artifacts", "runs", rawRunId)
    const sourceStepCDir = path.join(sourceRunDir, "step-c")
    if (pathExists(path.join(sourceStepCDir, "pattern_library.json"))) {
      return {
        sourceRunId: rawRunId,
        sourceRunDir
      }
    }
    const payloadFallback = resolveSourceRunDirFromPayloadPath({ payloadPath })
    if (payloadFallback) {
      return payloadFallback
    }
    return {
      sourceRunId: rawRunId,
      sourceRunDir
    }
  }
  const rawRunDir = String(payload?.sourceRunDir ?? "").trim()
  if (rawRunDir) {
    return {
      sourceRunId: "",
      sourceRunDir: path.isAbsolute(rawRunDir) ? rawRunDir : path.resolve(cwd, rawRunDir)
    }
  }
  const payloadFallback = resolveSourceRunDirFromPayloadPath({ payloadPath })
  if (payloadFallback) {
    return payloadFallback
  }
  throw new Error("step-d-materialize payload missing sourceRunId/sourceRunDir")
}

export const runStepDFullMaterialize = async ({ ctx, flags }) => {
  const { payloadPath, payload } = await readPayload(flags)
  const { sourceRunId, sourceRunDir } = resolveSourceRunDir({
    cwd: ctx.cwd,
    payload,
    payloadPath
  })
  const sourceStepCDir = path.join(sourceRunDir, "step-c")
  const sourceStepBDir = path.join(sourceRunDir, "step-b")
  if (!pathExists(path.join(sourceStepCDir, "pattern_library.json"))) {
    throw new Error(`step-d-materialize source step-c missing: ${sourceStepCDir}`)
  }

  await ensureDir(ctx.runDir)
  await copyDirIfExists(sourceStepCDir, path.join(ctx.runDir, "step-c"))
  if (pathExists(sourceStepBDir)) {
    await copyDirIfExists(sourceStepBDir, path.join(ctx.runDir, "step-b"))
  }
  await fsp.rm(path.join(ctx.runDir, "step-d"), { recursive: true, force: true })

  ctx.config = clonePlain(ctx.config ?? {})
  ctx.config.decisionGate = {
    ...(ctx.config?.decisionGate ?? {}),
    minScoreMargin: Number(payload?.minScoreMargin ?? ctx.config?.decisionGate?.minScoreMargin ?? 0),
    maxScoreMargin: Number(payload?.maxScoreMargin ?? ctx.config?.decisionGate?.maxScoreMargin ?? 0),
    secondPick: clonePlain(payload?.secondPickGate ?? ctx.config?.decisionGate?.secondPick ?? {})
  }
  if (payload?.inversionAdjust && typeof payload.inversionAdjust === "object") {
    ctx.config.decisionGate.inversionAdjust = clonePlain(payload.inversionAdjust)
  }
  ctx.config.onlineLearning = {
    ...(ctx.config?.onlineLearning ?? {}),
    startWeightsPath: String(
      payload?.startWeightsPath ?? ctx.config?.onlineLearning?.startWeightsPath ?? "",
    )
  }
  ctx.config.lightweight = {
    ...(ctx.config?.lightweight ?? {}),
    stepD: {
      ...(ctx.config?.lightweight?.stepD ?? {}),
      executionProfile: "full_audit",
      prepareLockboxDuringStepD: true,
      scoringWorkers: 1,
      keepWorkerPoolAlive: false,
      reuseRuntimeCache: false
    }
  }

  ctx.__runtime = ctx.__runtime ?? {}
  ctx.__runtime.stepDExecutionProfileOverride = "FULL_AUDIT"
  ctx.__runtime.stepDPrepareLockboxDuringStepDOverride = true
  ctx.__runtime.stepDWritebackTrace = true

  const stepD = await runStepD(ctx)
  const missingArtifacts = []
  if (!String(stepD?.summaryPath ?? "").trim() || !pathExists(stepD.summaryPath)) {
    missingArtifacts.push("step_d_summary.json")
  }
  if (!String(stepD?.policyStatePath ?? "").trim() || !pathExists(stepD.policyStatePath)) {
    missingArtifacts.push("step_d_policy_state.json")
  }
  if (!String(stepD?.weightsPath ?? "").trim() || !pathExists(stepD.weightsPath)) {
    missingArtifacts.push("weights_final.json")
  }
  if (missingArtifacts.length > 0) {
    const partialStepDDir = path.join(ctx.runDir, "step-d")
    const writebackTracePath = path.join(partialStepDDir, "step_d_writeback_trace.jsonl")
    const partialArtifacts = pathExists(partialStepDDir)
      ? (await fsp.readdir(partialStepDDir)).sort()
      : []
    throw new Error(
      `step-d-materialize incomplete output: missing ${missingArtifacts.join(", ")}; ` +
        `sourceRunDir=${sourceRunDir}; writebackTracePath=${writebackTracePath}; ` +
        `partialArtifacts=${partialArtifacts.join(", ")}`,
    )
  }
  const metadata = {
    step: "D_FULL_MATERIALIZE",
    generatedAt: new Date().toISOString(),
    payloadPath,
    sourceRunId,
    sourceRunDir,
    targetRunId: ctx.runId,
    targetRunDir: ctx.runDir,
    summaryPath: String(stepD?.summaryPath ?? ""),
    writebackTracePath: path.join(ctx.runDir, "step-d", "step_d_writeback_trace.jsonl"),
    stepDExecutionProfile: String(stepD?.summary?.stepDExecutionProfile ?? ""),
    stepDMode: String(stepD?.summary?.stepDMode ?? "")
  }
  const metadataPath = path.join(ctx.runDir, "step-d", "step_d_full_materialize_meta.json")
  await writeJson(metadataPath, metadata)
  return {
    ...stepD,
    metadataPath,
    metadata
  }
}
