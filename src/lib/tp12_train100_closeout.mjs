import path from "node:path"

import { readJson, writeJson } from "./io.mjs"
import { toBool, toNumber, toText } from "./tp12_year2hit_foundation_io.mjs"

const asPath = (value) => {
  const text = toText(value)
  return text ? path.resolve(text) : null
}

const readRequiredJson = async (filePath, label) => {
  const sourcePath = toText(filePath)
  if (!sourcePath) throw new Error(`${label} is required`)
  const payload = await readJson(sourcePath, null)
  if (!payload) throw new Error(`${label} not found: ${sourcePath}`)
  return payload
}

const firstNumber = (payload, keys, fallback = 0) => {
  for (const key of keys) {
    const value = key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), payload)
    const numeric = toNumber(value, NaN)
    if (Number.isFinite(numeric)) return numeric
  }
  return fallback
}

const firstBool = (payload, keys, fallback = false) => {
  for (const key of keys) {
    const value = key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), payload)
    if (value === true || value === false) return value
    const text = toText(value).toLowerCase()
    if (["true", "false"].includes(text)) return text === "true"
  }
  return fallback
}

const sourceSnapshot = ({ label, filePath, payload }) => ({
  label,
  path: asPath(filePath),
  kind: toText(payload?.kind) || null,
  status: toText(payload?.status) || null,
  searchComplete: firstBool(payload, ["searchComplete"], false),
  oosRead: firstBool(payload, ["oosRead"], false),
  acceptedCandidateCount: firstNumber(payload, ["acceptedCandidateCount", "counterexampleExactCompletionAcceptedCandidateCount"], 0),
  acceptedTrain100PatternCount: firstNumber(payload, ["acceptedTrain100PatternCount"], 0),
  visitedStateCount: firstNumber(payload, ["globalVisitedStateCount", "visitedStateCount"], 0),
  remainingFrontierSize: firstNumber(payload, ["remainingFrontierSize"], 0),
})

export const buildTp12Train100Closeout = async ({
  partitionSummaryPath = "",
  discoverySummaryPath = "",
  resumeManifestPath = "",
  outPath = "",
  patchKey = "tp12_train100_closeout_zero_survivor_v1",
  failOnUnsafe = true,
} = {}) => {
  if (!toText(outPath)) throw new Error("outPath is required")
  const partitionSummary = await readRequiredJson(partitionSummaryPath, "partitionSummaryPath")
  const discoverySummary = await readRequiredJson(discoverySummaryPath, "discoverySummaryPath")
  const resumeManifest = toText(resumeManifestPath)
    ? await readRequiredJson(resumeManifestPath, "resumeManifestPath")
    : null

  const sources = [
    sourceSnapshot({ label: "partition_summary", filePath: partitionSummaryPath, payload: partitionSummary }),
    sourceSnapshot({ label: "discovery_summary", filePath: discoverySummaryPath, payload: discoverySummary }),
  ]
  if (resumeManifest) {
    sources.push(sourceSnapshot({ label: "resume_manifest", filePath: resumeManifestPath, payload: resumeManifest }))
  }

  const acceptedTrain100PatternCount = Math.max(...sources.map((source) => source.acceptedTrain100PatternCount), 0)
  const acceptedCandidateCount = Math.max(...sources.map((source) => source.acceptedCandidateCount), 0)
  const globalVisitedStateCount = Math.max(...sources.map((source) => source.visitedStateCount), 0)
  const remainingFrontierSize = Math.max(...sources.map((source) => source.remainingFrontierSize), 0)
  const anyOosRead = sources.some((source) => source.oosRead === true)
  const allSearchComplete = sources.length > 0 && sources.every((source) => source.searchComplete === true)

  const rejectReasons = []
  if (toText(patchKey) !== "tp12_train100_closeout_zero_survivor_v1") {
    rejectReasons.push("unexpected_patch_key")
  }
  if (anyOosRead) rejectReasons.push("source_oos_read_true")
  if (acceptedTrain100PatternCount > 0) rejectReasons.push("accepted_train100_patterns_above_zero")
  if (acceptedCandidateCount > 0) rejectReasons.push("accepted_candidates_above_zero")

  const closeoutStatus = rejectReasons.length > 0
    ? "invalid_closeout"
    : allSearchComplete
      ? "closed_negative_complete"
      : "closed_negative_incomplete"

  const payload = {
    kind: "tp12_train100_closeout_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: toText(patchKey),
    status: rejectReasons.length > 0 ? "failed" : "passed",
    closeoutStatus,
    decision: rejectReasons.length > 0 ? "do_not_close" : "do_not_continue_as_primary_h80_path",
    acceptedTrain100PatternCount,
    acceptedCandidateCount,
    globalVisitedStateCount,
    remainingFrontierSize,
    searchComplete: allSearchComplete,
    oosRead: anyOosRead,
    allowedFutureUse: ["unsat_diagnostic", "feature_gap_analysis"],
    forbiddenFutureUse: ["oos_apply", "selector_source", "hidden_fallback"],
    sourceSnapshots: sources,
    rejectReasons,
  }
  await writeJson(outPath, payload)
  if (payload.status !== "passed" && toBool(failOnUnsafe, true)) {
    throw new Error(`tp12 train100 closeout failed: ${rejectReasons.join("; ")}`)
  }
  return payload
}
