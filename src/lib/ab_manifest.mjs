import crypto from "node:crypto"
import path from "node:path"

import { pathExists, readJson, writeJson } from "./io.mjs"

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item))
  }
  if (value && typeof value === "object") {
    const out = {}
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      out[key] = canonicalize(value[key])
    }
    return out
  }
  return value
}

const stableStringify = (value) => JSON.stringify(canonicalize(value))

const pick = (obj, keys) => {
  const out = {}
  for (const key of keys) {
    out[key] = obj?.[key]
  }
  return out
}

export const getActiveAbManifestPath = (cwd) =>
  path.join(cwd, "artifacts", "ab_registry", "active_ab_manifest.json")

export const computeAbConfigSnapshot = (config) => ({
  event: config?.event ?? {},
  filters: config?.filters ?? {},
  template: config?.template ?? {},
  lightweight: {
    pipeline: config?.lightweight?.pipeline ?? {},
    stepA: config?.lightweight?.stepA ?? {},
    stepB: config?.lightweight?.stepB ?? {}
  },
  dataPaths: pick(config?.dataPaths ?? {}, [
    "candleDailyJsonl",
    "universeJsonl",
    "symbolMasterJsonl"
  ])
})

export const computeAbConfigHash = (config) => {
  const snapshot = computeAbConfigSnapshot(config)
  return crypto.createHash("sha256").update(stableStringify(snapshot)).digest("hex")
}

export const readActiveAbManifest = async ({ cwd }) => {
  const manifestPath = getActiveAbManifestPath(cwd)
  const manifest = await readJson(manifestPath, null)
  return {
    manifestPath,
    manifest
  }
}

export const verifyAbArtifacts = ({ cwd, runId }) => {
  const id = String(runId ?? "").trim()
  if (!id) {
    throw new Error("AB verify failed: runId is empty")
  }
  const runDir = path.join(cwd, "artifacts", "runs", id)
  const mustHave = [
    path.join(runDir, "step-a", "step_a_summary.json"),
    path.join(runDir, "step-b", "step_b_summary.json")
  ]
  for (const filePath of mustHave) {
    if (!pathExists(filePath)) {
      throw new Error(`AB verify failed: missing artifact ${filePath}`)
    }
  }
  const stepBInputs = [
    path.join(runDir, "step-b", "templates_lite.jsonl"),
    path.join(runDir, "step-b", "templates.jsonl"),
    path.join(runDir, "step-b", "templates_runtime_pack.jsonl")
  ]
  if (!stepBInputs.some((p) => pathExists(p))) {
    throw new Error(`AB verify failed: missing Step B template artifacts under ${path.join(runDir, "step-b")}`)
  }
  return runDir
}

export const promoteActiveAbManifest = async ({
  cwd,
  runId,
  config,
  note = ""
}) => {
  const activeAbRunId = String(runId ?? "").trim()
  if (!activeAbRunId) {
    throw new Error("ab-promote requires --run-id")
  }
  verifyAbArtifacts({ cwd, runId: activeAbRunId })
  const { manifestPath, manifest: prev } = await readActiveAbManifest({ cwd })
  const activeConfigHash = computeAbConfigHash(config)
  const nowIso = new Date().toISOString()
  const prevHistory = Array.isArray(prev?.history) ? prev.history : []
  const history = [
    ...prevHistory.slice(-49),
    {
      at: nowIso,
      runId: activeAbRunId,
      configHash: activeConfigHash,
      note: String(note ?? "").trim() || null
    }
  ]
  const next = {
    version: 1,
    state: "LOCKED",
    activeAbRunId,
    activeConfigHash,
    updatedAt: nowIso,
    note: String(note ?? "").trim() || null,
    history
  }
  await writeJson(manifestPath, next)
  return {
    manifestPath,
    manifest: next
  }
}

export const resolveActiveAbBinding = async ({
  cwd,
  config,
  requestedAbRunId,
  ignoreConfigHash = false
}) => {
  const requested = String(requestedAbRunId ?? "").trim()
  const currentConfigHash = computeAbConfigHash(config)
  const { manifestPath, manifest } = await readActiveAbManifest({ cwd })

  if (requested) {
    const abRunDir = verifyAbArtifacts({ cwd, runId: requested })
    return {
      source: "flag",
      manifestPath,
      manifest,
      abRunId: requested,
      abRunDir,
      currentConfigHash,
      activeConfigHash: null,
      configHashMatch: true
    }
  }

  const state = String(manifest?.state ?? "").trim().toUpperCase()
  const activeAbRunId = String(manifest?.activeAbRunId ?? "").trim()
  if (state !== "LOCKED" || !activeAbRunId) {
    throw new Error(
      [
        "Active AB manifest is not ready.",
        `manifestPath=${manifestPath}`,
        "Run `ab-promote --run-id=<AB_RUN_ID>` first."
      ].join(" "),
    )
  }
  const abRunDir = verifyAbArtifacts({ cwd, runId: activeAbRunId })
  const activeConfigHash = String(manifest?.activeConfigHash ?? "").trim() || null
  const configHashMatch = !activeConfigHash || activeConfigHash === currentConfigHash
  if (!configHashMatch && ignoreConfigHash !== true) {
    throw new Error(
      [
        "AB config hash mismatch.",
        `activeAbRunId=${activeAbRunId}`,
        `activeHash=${activeConfigHash}`,
        `currentHash=${currentConfigHash}`,
        "Use --ab-ignore-config-hash=true only if you intentionally reuse old AB."
      ].join(" "),
    )
  }
  return {
    source: "manifest",
    manifestPath,
    manifest,
    abRunId: activeAbRunId,
    abRunDir,
    currentConfigHash,
    activeConfigHash,
    configHashMatch
  }
}
