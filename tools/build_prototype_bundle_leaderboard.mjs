import path from "node:path"
import fsp from "node:fs/promises"

import { parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, pathExists, readJsonl, writeJson } from "../src/lib/io.mjs"
import {
  classifyBundleRole,
  classifySampleTier,
  computeVetoScore,
  isStopExitReason,
  isTimeoutNegativeExitReason,
  safeRate,
} from "../src/lib/bundle_role_classifier.mjs"

const sortFamilyIds = (values) =>
  (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .sort((left, right) => {
      const leftNum = Number.parseInt(left.replace(/^F/i, ""), 10)
      const rightNum = Number.parseInt(right.replace(/^F/i, ""), 10)
      if (Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum !== rightNum) {
        return leftNum - rightNum
      }
      return left.localeCompare(right)
    })

const normalizeUpperKey = (value) => String(value ?? "").trim().toUpperCase()

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const resolveRunDir = (cwd, runId) => path.join(cwd, "artifacts", "runs", String(runId ?? "").trim())

const resolveSelectedCandidate = (row) => {
  const selectedCandidates = Array.isArray(row?.selectedCandidates) ? row.selectedCandidates : []
  if (selectedCandidates.length < 1) return null
  const finalSymbol =
    String(row?.finalSelectedTop1Symbol ?? "").trim() ||
    String(row?.finalExecutedTop1Symbol ?? "").trim()
  if (finalSymbol) {
    const matched = selectedCandidates.find(
      (candidate) => String(candidate?.symbol ?? "").trim() === finalSymbol,
    )
    if (matched) return matched
  }
  return selectedCandidates.length === 1 ? selectedCandidates[0] : null
}

const wasCandidateExecuted = (row, candidate) => {
  const symbol = String(candidate?.symbol ?? "").trim()
  if (!symbol) return false
  const finalExecuted = String(row?.finalExecutedTop1Symbol ?? "").trim()
  if (finalExecuted && finalExecuted === symbol) return true
  const executedSymbols = Array.isArray(row?.executedSymbols) ? row.executedSymbols : []
  if (executedSymbols.some((value) => String(value ?? "").trim() === symbol)) return true
  const executionDecision = normalizeUpperKey(candidate?.executionDecision)
  return executionDecision === "APPROVED" || executionDecision === "EXECUTED"
}

const metricKey = ({ familyId, entityType, prototypeId, clusterId }) =>
  [familyId, entityType, prototypeId ?? "", clusterId ?? ""].join("::")

const initMetric = ({ familyId, prototypeId = null, clusterId = null, entityType }) => ({
  familyId,
  entityType,
  prototypeId,
  clusterId,
  pickD_U: 0,
  hitD_U: 0,
  rateD_U: 0,
  pickD_V: 0,
  hitD_V: 0,
  rateD_V: 0,
  executedPickD_V: 0,
  executedHitD_V: 0,
  executedRateD_V: 0,
  pickE: 0,
  hitE: 0,
  rateE: 0,
  executedPickE: 0,
  executedHitE: 0,
  executedRateE: 0,
  stopCountE: 0,
  timeoutNegativeCountE: 0,
  stopRateE: 0,
  timeoutNegativeRateE: 0,
  role: "UNKNOWN",
  sampleTier: "EMPTY",
  vetoScore: 0,
})

const upsertMetric = (map, seed) => {
  const key = metricKey(seed)
  if (!map.has(key)) {
    map.set(key, initMetric(seed))
  }
  return map.get(key)
}

const accumulatePick = ({ metric, partition, hit, executed }) => {
  if (partition === "U") {
    metric.pickD_U += 1
    if (hit) metric.hitD_U += 1
    return
  }
  if (partition === "V") {
    metric.pickD_V += 1
    if (hit) metric.hitD_V += 1
    if (executed) {
      metric.executedPickD_V += 1
      if (hit) metric.executedHitD_V += 1
    }
  }
}

const finalizeMetric = (metric, floors) => {
  metric.rateD_U = safeRate(metric.hitD_U, metric.pickD_U)
  metric.rateD_V = safeRate(metric.hitD_V, metric.pickD_V)
  metric.executedRateD_V = safeRate(metric.executedHitD_V, metric.executedPickD_V)
  metric.rateE = safeRate(metric.hitE, metric.pickE)
  metric.executedRateE = safeRate(metric.executedHitE, metric.executedPickE)
  metric.stopRateE = safeRate(metric.stopCountE, metric.executedPickE)
  metric.timeoutNegativeRateE = safeRate(metric.timeoutNegativeCountE, metric.executedPickE)
  metric.vetoScore = computeVetoScore(metric)
  metric.role = classifyBundleRole(metric)
  metric.sampleTier = classifySampleTier(metric, floors)
  return metric
}

const collectProbeFamilies = async ({ probeRoot, explicitFamilyIds }) => {
  if (explicitFamilyIds.length > 0) return sortFamilyIds(explicitFamilyIds)
  if (!pathExists(probeRoot)) return []
  const entries = await fsp.readdir(probeRoot, { withFileTypes: true })
  return sortFamilyIds(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  )
}

const resolveProbeSources = async ({ cwd, runId }) => {
  const exactRunDir = resolveRunDir(cwd, runId)
  const exactProbeRoot = path.join(exactRunDir, "step-c1", "probes")
  if (pathExists(exactProbeRoot)) {
    return [
      {
        sourceRunId: runId,
        runDir: exactRunDir,
        probeRoot: exactProbeRoot,
      },
    ]
  }
  const runsRoot = path.join(cwd, "artifacts", "runs")
  if (!pathExists(runsRoot)) return []
  const shardPrefix = `${runId}_b`
  const entries = await fsp.readdir(runsRoot, { withFileTypes: true })
  const shardSources = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(shardPrefix))
    .map((entry) => ({
      sourceRunId: entry.name,
      runDir: path.join(runsRoot, entry.name),
      probeRoot: path.join(runsRoot, entry.name, "step-c1", "probes"),
    }))
    .filter((entry) => pathExists(entry.probeRoot))
    .sort((left, right) => left.sourceRunId.localeCompare(right.sourceRunId))
  return shardSources
}

const sortMetricRows = (rows) =>
  rows.slice().sort((left, right) => {
    if (left.familyId !== right.familyId) {
      const leftNum = Number.parseInt(String(left.familyId).replace(/^F/i, ""), 10)
      const rightNum = Number.parseInt(String(right.familyId).replace(/^F/i, ""), 10)
      if (Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum !== rightNum) {
        return leftNum - rightNum
      }
      return String(left.familyId).localeCompare(String(right.familyId))
    }
    const rightPrimary = Math.min(right.rateD_V, right.rateE)
    const leftPrimary = Math.min(left.rateD_V, left.rateE)
    if (rightPrimary !== leftPrimary) return rightPrimary - leftPrimary
    const rightSupport = Math.min(right.pickD_V, right.pickE)
    const leftSupport = Math.min(left.pickD_V, left.pickE)
    if (rightSupport !== leftSupport) return rightSupport - leftSupport
    return String(left.prototypeId ?? left.clusterId ?? "").localeCompare(
      String(right.prototypeId ?? right.clusterId ?? ""),
    )
  })

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const runId = String(parsed.flags["run-id"] ?? "").trim()
  const familyIds = sortFamilyIds(String(parsed.flags["family-ids"] ?? "").split(","))
  const minPickFloorDWeak = Math.max(0, Math.floor(toFiniteNumber(parsed.flags["min-pick-floor-d-weak"], 6)))
  const minPickFloorEWeak = Math.max(0, Math.floor(toFiniteNumber(parsed.flags["min-pick-floor-e-weak"], 6)))
  const minPickFloorDStrong = Math.max(minPickFloorDWeak, Math.floor(toFiniteNumber(parsed.flags["min-pick-floor-d-strong"], 10)))
  const minPickFloorEStrong = Math.max(minPickFloorEWeak, Math.floor(toFiniteNumber(parsed.flags["min-pick-floor-e-strong"], 10)))
  if (!runId) {
    throw new Error("Usage: node tools/build_prototype_bundle_leaderboard.mjs --run-id=<run> [--family-ids=F001,F002]")
  }
  const runDir = resolveRunDir(cwd, runId)
  const sources = await resolveProbeSources({ cwd, runId })
  const stepC1Dir = path.join(runDir, "step-c1")
  const floors = {
    minPickFloorDWeak,
    minPickFloorEWeak,
    minPickFloorDStrong,
    minPickFloorEStrong,
  }
  const selectedFamilyIds =
    familyIds.length > 0
      ? familyIds
      : sortFamilyIds(
          (
            await Promise.all(
              sources.map((source) =>
                collectProbeFamilies({
                  probeRoot: source.probeRoot,
                  explicitFamilyIds: [],
                }),
              ),
            )
          ).flat(),
        )
  const probeDirByFamily = new Map()
  for (const source of sources) {
    const sourceFamilyIds = await collectProbeFamilies({
      probeRoot: source.probeRoot,
      explicitFamilyIds: familyIds,
    })
    for (const familyId of sourceFamilyIds) {
      if (!probeDirByFamily.has(familyId)) {
        probeDirByFamily.set(familyId, path.join(source.probeRoot, familyId))
      }
    }
  }
  const prototypeMetrics = new Map()
  const clusterMetrics = new Map()

  for (const familyId of selectedFamilyIds) {
    const probeDir = probeDirByFamily.get(familyId)
    if (!probeDir) continue
    const dAuditPath = path.join(probeDir, "step-d", "d2_execution_audit.jsonl")
    const eAuditPath = path.join(probeDir, "step-e", "d2_lockbox_execution_audit.jsonl")
    const eTradesPath = path.join(probeDir, "step-e", "lockbox_trades.jsonl")
    const dRows = await readJsonl(dAuditPath)
    const eRows = await readJsonl(eAuditPath)
    const eTrades = await readJsonl(eTradesPath)

    for (const row of dRows) {
      const partition = normalizeUpperKey(row?.partition)
      if (!["U", "V"].includes(partition)) continue
      const candidate = resolveSelectedCandidate(row)
      if (!candidate) continue
      const prototypeId = String(candidate?.matchedPrototypeId ?? "").trim()
      const clusterId = normalizeUpperKey(candidate?.matchedPrototypeClusterId)
      if (!prototypeId && !clusterId) continue
      const hit = candidate?.successInWindow === true
      const executed = wasCandidateExecuted(row, candidate)
      if (prototypeId) {
        accumulatePick({
          metric: upsertMetric(prototypeMetrics, {
            familyId,
            entityType: "prototype",
            prototypeId,
            clusterId,
          }),
          partition,
          hit,
          executed,
        })
      }
      if (clusterId) {
        accumulatePick({
          metric: upsertMetric(clusterMetrics, {
            familyId,
            entityType: "cluster",
            prototypeId: null,
            clusterId,
          }),
          partition,
          hit,
          executed,
        })
      }
    }

    for (const row of eRows) {
      const candidate = resolveSelectedCandidate(row)
      if (!candidate) continue
      const prototypeId = String(candidate?.matchedPrototypeId ?? "").trim()
      const clusterId = normalizeUpperKey(candidate?.matchedPrototypeClusterId)
      if (!prototypeId && !clusterId) continue
      const hit = candidate?.successInWindow === true
      if (prototypeId) {
        const metric = upsertMetric(prototypeMetrics, {
          familyId,
          entityType: "prototype",
          prototypeId,
          clusterId,
        })
        metric.pickE += 1
        if (hit) metric.hitE += 1
      }
      if (clusterId) {
        const metric = upsertMetric(clusterMetrics, {
          familyId,
          entityType: "cluster",
          prototypeId: null,
          clusterId,
        })
        metric.pickE += 1
        if (hit) metric.hitE += 1
      }
    }

    for (const trade of eTrades) {
      const prototypeId = String(trade?.matchedPrototypeId ?? "").trim()
      const clusterId = normalizeUpperKey(trade?.matchedPrototypeClusterId)
      const hit = trade?.hitTarget === true
      const stop = trade?.hitStop === true || isStopExitReason(trade?.exitReason)
      const timeoutNegative = isTimeoutNegativeExitReason(trade?.exitReason, trade?.netRet)
      if (prototypeId) {
        const metric = upsertMetric(prototypeMetrics, {
          familyId,
          entityType: "prototype",
          prototypeId,
          clusterId,
        })
        metric.executedPickE += 1
        if (hit) metric.executedHitE += 1
        if (stop) metric.stopCountE += 1
        if (timeoutNegative) metric.timeoutNegativeCountE += 1
      }
      if (clusterId) {
        const metric = upsertMetric(clusterMetrics, {
          familyId,
          entityType: "cluster",
          prototypeId: null,
          clusterId,
        })
        metric.executedPickE += 1
        if (hit) metric.executedHitE += 1
        if (stop) metric.stopCountE += 1
        if (timeoutNegative) metric.timeoutNegativeCountE += 1
      }
    }
  }

  const prototypeRows = sortMetricRows(
    Array.from(prototypeMetrics.values()).map((metric) => finalizeMetric(metric, floors)),
  )
  const clusterRows = sortMetricRows(
    Array.from(clusterMetrics.values()).map((metric) => finalizeMetric(metric, floors)),
  )

  const leaderboard = {
    version: 1,
    generatedAt: new Date().toISOString(),
    runId,
    sourceRunIds: sources.map((source) => source.sourceRunId),
    familyIds: selectedFamilyIds,
    floors,
    prototypeRows,
    clusterRows,
    summary: {
      familyCount: selectedFamilyIds.length,
      prototypeRowCount: prototypeRows.length,
      clusterRowCount: clusterRows.length,
      prototypeRoleCounts: prototypeRows.reduce((acc, row) => {
        acc[row.role] = Number(acc[row.role] ?? 0) + 1
        return acc
      }, {}),
      clusterRoleCounts: clusterRows.reduce((acc, row) => {
        acc[row.role] = Number(acc[row.role] ?? 0) + 1
        return acc
      }, {}),
    },
  }

  const vetoLibrary = {
    version: 1,
    generatedAt: leaderboard.generatedAt,
    runId,
    familyIds: selectedFamilyIds,
    prototypeRows: prototypeRows.filter((row) => row.role === "VETO_STOP"),
    clusterRows: clusterRows.filter((row) => row.role === "VETO_STOP"),
  }

  await writeJson(path.join(stepC1Dir, "prototype_bundle_leaderboard.json"), leaderboard)
  await writeJson(path.join(runDir, "step-c", "step_c_veto_library.json"), vetoLibrary)
  console.log(
    JSON.stringify(
      {
        step: "build-prototype-bundle-leaderboard",
        runId,
        sourceRunIds: sources.map((source) => source.sourceRunId),
        familyCount: selectedFamilyIds.length,
        prototypeRowCount: prototypeRows.length,
        clusterRowCount: clusterRows.length,
        vetoPrototypeCount: vetoLibrary.prototypeRows.length,
        vetoClusterCount: vetoLibrary.clusterRows.length,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error?.stack ?? String(error))
  process.exit(1)
})
