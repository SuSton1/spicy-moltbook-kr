import path from "node:path"

import { pathExists } from "./io.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const normalizeOutputMode = (value, defaultMode = "both") => {
  const mode = String(value ?? defaultMode)
    .trim()
    .toLowerCase()
  if (mode === "full" || mode === "lite" || mode === "both") return mode
  return defaultMode
}

export const shouldWriteFull = (mode) => mode === "full" || mode === "both"

export const shouldWriteLite = (mode) => mode === "lite" || mode === "both"

export const roundNumber = (value, digits = 6) => {
  const n = num(value)
  if (!Number.isFinite(n)) return null
  const d = Math.max(0, Math.min(12, Number(digits) || 0))
  const m = 10 ** d
  return Math.round(n * m) / m
}

export const compactFeatureVec = (featureVec, digits = 6) => {
  const out = {}
  for (const [key, value] of Object.entries(featureVec ?? {})) {
    const v = roundNumber(value, digits)
    out[key] = Number.isFinite(v) ? v : null
  }
  return out
}

export const quantizeSequence = (seq, scale = 10000) => {
  const s = Math.max(1, Number(scale) || 10000)
  return (Array.isArray(seq) ? seq : []).map((value) => {
    const n = num(value)
    if (!Number.isFinite(n)) return 0
    return Math.round(n * s)
  })
}

export const dequantizeSequence = (seqQ, scale = 10000) => {
  const s = Math.max(1, Number(scale) || 10000)
  return (Array.isArray(seqQ) ? seqQ : []).map((value) => {
    const n = num(value)
    if (!Number.isFinite(n)) return 0
    return n / s
  })
}

export const resolveStepBInputPath = ({
  runDir,
  lightweightCfg,
  preferLiteArtifacts
}) => {
  const stepBInputMode = String(lightweightCfg?.stepB?.inputMode ?? "auto")
    .trim()
    .toLowerCase()
  const fullPath = path.join(runDir, "step-a", "events_high8.jsonl")
  const litePath = path.join(runDir, "step-a", "events_high8_lite.jsonl")

  if (stepBInputMode === "full") {
    return { inPath: fullPath, mode: "full" }
  }
  if (stepBInputMode === "lite") {
    return { inPath: litePath, mode: "lite" }
  }

  const preferLite = preferLiteArtifacts !== false
  if (preferLite && pathExists(litePath)) {
    return { inPath: litePath, mode: "lite" }
  }
  return { inPath: fullPath, mode: "full" }
}

export const resolveStepCInputPath = ({
  runDir,
  lightweightCfg,
  preferLiteArtifacts
}) => {
  const fullPath = path.join(runDir, "step-b", "templates.jsonl")
  const litePath = path.join(runDir, "step-b", "templates_lite.jsonl")
  const stepCInputMode = String(lightweightCfg?.stepC?.inputMode ?? "auto")
    .trim()
    .toLowerCase()

  if (stepCInputMode === "full") {
    return { inPath: fullPath, mode: "full" }
  }
  if (stepCInputMode === "lite") {
    return { inPath: litePath, mode: "lite" }
  }

  const preferLite = preferLiteArtifacts !== false
  if (preferLite && pathExists(litePath)) {
    return { inPath: litePath, mode: "lite" }
  }
  return { inPath: fullPath, mode: "full" }
}

export const resolveStepC0InputPath = ({
  runDir,
  lightweightCfg,
  preferLiteArtifacts
}) => {
  const runtimePackPath = path.join(runDir, "step-b", "templates_runtime_pack.jsonl")
  const litePath = path.join(runDir, "step-b", "templates_lite.jsonl")
  const fullPath = path.join(runDir, "step-b", "templates.jsonl")
  const stepC0InputMode = String(lightweightCfg?.stepC0?.inputMode ?? "auto")
    .trim()
    .toLowerCase()

  if (stepC0InputMode === "runtime_pack") {
    return { inPath: runtimePackPath, mode: "runtime_pack" }
  }
  if (stepC0InputMode === "lite") {
    return { inPath: litePath, mode: "lite" }
  }
  if (stepC0InputMode === "full") {
    return { inPath: fullPath, mode: "full" }
  }

  const preferLite = preferLiteArtifacts !== false
  if (pathExists(runtimePackPath)) {
    return { inPath: runtimePackPath, mode: "runtime_pack" }
  }
  if (preferLite && pathExists(litePath)) {
    return { inPath: litePath, mode: "lite" }
  }
  return { inPath: fullPath, mode: "full" }
}
