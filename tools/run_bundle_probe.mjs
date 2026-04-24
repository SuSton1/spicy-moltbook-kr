import path from "node:path"

import { parseCliArgs } from "../src/lib/args.mjs"
import { loadConfig } from "../src/lib/config.mjs"
import { ensureDir, pathExists, readJson, readJsonl, writeJson } from "../src/lib/io.mjs"
import {
  evaluateBundleStatus,
  isStopExitReason,
  isTimeoutNegativeExitReason,
  normalizeBundleSpec,
  normalizeUpperKey,
  safeRate,
} from "../src/lib/bundle_role_classifier.mjs"

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

const normalizeIdSet = (values, { upper = false } = {}) =>
  new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => {
        const text = String(value ?? "").trim()
        return upper ? text.toUpperCase() : text
      })
      .filter(Boolean),
  )

const matchBundleEntity = ({ candidate, spec }) => {
  const clusterId = normalizeUpperKey(candidate?.matchedPrototypeClusterId)
  const prototypeId = String(candidate?.matchedPrototypeId ?? "").trim()
  const coreClusterSet = normalizeIdSet(spec.coreClusterIds, { upper: true })
  const corePrototypeSet = normalizeIdSet(spec.corePrototypeIds)
  const supportClusterSet = normalizeIdSet(spec.supportClusterIds, { upper: true })
  const supportPrototypeSet = normalizeIdSet(spec.supportPrototypeIds)
  const vetoClusterSet = normalizeIdSet(spec.vetoClusterIds, { upper: true })
  const vetoPrototypeSet = normalizeIdSet(spec.vetoPrototypeIds)
  return {
    clusterId,
    prototypeId,
    core: coreClusterSet.has(clusterId) || corePrototypeSet.has(prototypeId),
    support: supportClusterSet.has(clusterId) || supportPrototypeSet.has(prototypeId),
    veto: vetoClusterSet.has(clusterId) || vetoPrototypeSet.has(prototypeId),
  }
}

const buildBundleRouter = (spec) => {
  const normalizedSpec = normalizeBundleSpec(spec)
  const allowedDayTypes = normalizeIdSet(normalizedSpec.allowedDayTypes, { upper: true })
  const allowedRegimeTags = normalizeIdSet(normalizedSpec.allowedRegimeTags, { upper: true })
  const hasDefinedCore =
    normalizedSpec.coreClusterIds.length > 0 || normalizedSpec.corePrototypeIds.length > 0
  return {
    spec: normalizedSpec,
    evaluateRow(row) {
      const selectedCandidates = Array.isArray(row?.selectedCandidates) ? row.selectedCandidates : []
      const topCandidate = resolveSelectedCandidate(row)
      if (!topCandidate) {
        return { accepted: false, reason: "NO_TOP1_CANDIDATE" }
      }
      const topN = selectedCandidates.slice(0, 3)
      const topEntity = matchBundleEntity({ candidate: topCandidate, spec: normalizedSpec })
      const topNEntities = topN.map((candidate) => ({
        candidate,
        entity: matchBundleEntity({ candidate, spec: normalizedSpec }),
      }))
      const hasCoreInTopN = topNEntities.some(({ entity }) => entity.core)
      const vetoTopNCandidate = topNEntities.find(({ entity, candidate }) => {
        if (!entity.veto) return false
        if (normalizedSpec.maxVetoScore == null) return true
        return toFiniteNumber(candidate?.finalScore, 0) >= normalizedSpec.maxVetoScore
      })
      const dayType = normalizeUpperKey(row?.dayType ?? row?.ruleDayType)
      if (allowedDayTypes.size > 0 && !allowedDayTypes.has(dayType)) {
        return { accepted: false, reason: "DAY_TYPE_REJECTED", topEntity }
      }
      const regimeTag = normalizeUpperKey(topCandidate?.regimeTag ?? row?.regimeTag)
      if (allowedRegimeTags.size > 0 && !allowedRegimeTags.has(regimeTag)) {
        return { accepted: false, reason: "REGIME_REJECTED", topEntity }
      }
      if (normalizedSpec.minMargin > 0) {
        const margin = toFiniteNumber(topCandidate?.gateScoreMargin, 0)
        if (margin < normalizedSpec.minMargin) {
          return { accepted: false, reason: "MARGIN_REJECTED", topEntity }
        }
      }
      if (vetoTopNCandidate) {
        return { accepted: false, reason: "VETO_TOPN", topEntity }
      }
      const coreEligible = topEntity.core || (!hasDefinedCore && topEntity.support)
      const supportEligible =
        !coreEligible &&
        topEntity.support &&
        hasCoreInTopN &&
        normalizedSpec.abstainWhenNoConsensus !== true
      if (!coreEligible && !supportEligible) {
        return {
          accepted: false,
          reason: normalizedSpec.abstainWhenNoConsensus ? "NO_CONSENSUS" : "SUPPORT_ONLY_REJECTED",
          topEntity,
        }
      }
      return {
        accepted: true,
        reason: coreEligible ? "CORE_ACCEPTED" : "SUPPORT_ACCEPTED",
        topCandidate,
        topEntity,
      }
    },
  }
}

const loadBundleEvalConfig = async ({ cwd, configPath }) => {
  const { config } = await loadConfig({ cwd, configPath })
  const raw = config?.pattern?.c1?.bundleEval ?? {}
  return {
    enabled: raw?.enabled === true,
    minPickFloorDWeak: Math.max(0, Math.floor(toFiniteNumber(raw?.minPickFloorDWeak, 6))),
    minPickFloorEWeak: Math.max(0, Math.floor(toFiniteNumber(raw?.minPickFloorEWeak, 6))),
    minPickFloorDStrong: Math.max(0, Math.floor(toFiniteNumber(raw?.minPickFloorDStrong, 10))),
    minPickFloorEStrong: Math.max(0, Math.floor(toFiniteNumber(raw?.minPickFloorEStrong, 10))),
    defaultAbstainWhenNoConsensus: raw?.defaultAbstainWhenNoConsensus !== false,
    maxConcurrentBundles: Math.max(1, Math.floor(toFiniteNumber(raw?.maxConcurrentBundles, 4))),
  }
}

const incrementReason = (counts, key) => {
  const reason = String(key ?? "").trim() || "UNKNOWN"
  counts[reason] = Number(counts[reason] ?? 0) + 1
}

const buildMetrics = () => ({
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
})

const finalizeMetrics = (metrics) => {
  metrics.rateD_U = safeRate(metrics.hitD_U, metrics.pickD_U)
  metrics.rateD_V = safeRate(metrics.hitD_V, metrics.pickD_V)
  metrics.executedRateD_V = safeRate(metrics.executedHitD_V, metrics.executedPickD_V)
  metrics.rateE = safeRate(metrics.hitE, metrics.pickE)
  metrics.executedRateE = safeRate(metrics.executedHitE, metrics.executedPickE)
  metrics.stopRateE = safeRate(metrics.stopCountE, metrics.executedPickE)
  metrics.timeoutNegativeRateE = safeRate(metrics.timeoutNegativeCountE, metrics.executedPickE)
  return metrics
}

const mergeBundleRow = async ({ ledgerPath, row }) => {
  const previous = await readJson(ledgerPath, null)
  const existingRows = Array.isArray(previous?.bundles) ? previous.bundles : []
  const nextRows = existingRows.filter((bundle) => String(bundle?.bundleId ?? "") !== row.bundleId)
  nextRows.push(row)
  nextRows.sort((left, right) => {
    const rightPrimary = Math.min(toFiniteNumber(right?.rateD_V, 0), toFiniteNumber(right?.rateE, 0))
    const leftPrimary = Math.min(toFiniteNumber(left?.rateD_V, 0), toFiniteNumber(left?.rateE, 0))
    if (rightPrimary !== leftPrimary) return rightPrimary - leftPrimary
    const rightSample = Math.min(toFiniteNumber(right?.pickD_V, 0), toFiniteNumber(right?.pickE, 0))
    const leftSample = Math.min(toFiniteNumber(left?.pickD_V, 0), toFiniteNumber(left?.pickE, 0))
    if (rightSample !== leftSample) return rightSample - leftSample
    return String(left?.bundleId ?? "").localeCompare(String(right?.bundleId ?? ""))
  })
  const next = {
    version: 1,
    generatedAt: new Date().toISOString(),
    bundles: nextRows,
  }
  await writeJson(ledgerPath, next)
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const configPath = String(parsed.flags.config ?? "config/lab.config.server.lite.json").trim()
  const sourceRunId = String(parsed.flags["source-run-id"] ?? "").trim()
  const outRunId = String(parsed.flags["out-run-id"] ?? "").trim()
  const familyId = String(parsed.flags["family-id"] ?? "").trim()
  const bundleSpecPath = String(parsed.flags["bundle-spec"] ?? "").trim()
  if (!sourceRunId || !outRunId || !familyId || !bundleSpecPath) {
    throw new Error(
      "Usage: node tools/run_bundle_probe.mjs --config=... --source-run-id=<run> --out-run-id=<run> --family-id=<family> --bundle-spec=<path>",
    )
  }
  const bundleCfg = await loadBundleEvalConfig({ cwd, configPath })
  const spec = normalizeBundleSpec(await readJson(bundleSpecPath, null))
  if (!spec.bundleId) {
    throw new Error(`Bundle spec missing bundleId: ${bundleSpecPath}`)
  }
  if (spec.familyId && spec.familyId !== familyId) {
    throw new Error(`Bundle spec familyId mismatch: ${spec.familyId} !== ${familyId}`)
  }
  if (spec.abstainWhenNoConsensus == null) {
    spec.abstainWhenNoConsensus = bundleCfg.defaultAbstainWhenNoConsensus
  }
  const sourceProbeDir = path.join(
    resolveRunDir(cwd, sourceRunId),
    "step-c1",
    "probes",
    familyId,
  )
  const dAuditPath = path.join(sourceProbeDir, "step-d", "d2_execution_audit.jsonl")
  const eAuditPath = path.join(sourceProbeDir, "step-e", "d2_lockbox_execution_audit.jsonl")
  const eTradesPath = path.join(sourceProbeDir, "step-e", "lockbox_trades.jsonl")
  if (!pathExists(dAuditPath)) {
    throw new Error(`Bundle source D audit not found: ${dAuditPath}`)
  }
  const dRows = await readJsonl(dAuditPath)
  const eRows = await readJsonl(eAuditPath)
  const eTrades = await readJsonl(eTradesPath)
  const router = buildBundleRouter(spec)
  const metrics = buildMetrics()
  const routingDiagnostics = {
    d_u: {},
    d_v: {},
    e: {},
  }
  const acceptedEKeys = new Set()

  for (const row of dRows) {
    const partition = normalizeUpperKey(row?.partition)
    if (!["U", "V"].includes(partition)) continue
    const decision = router.evaluateRow(row)
    incrementReason(routingDiagnostics[partition === "U" ? "d_u" : "d_v"], decision.reason)
    if (!decision.accepted) continue
    const hit = decision.topCandidate?.successInWindow === true
    if (partition === "U") {
      metrics.pickD_U += 1
      if (hit) metrics.hitD_U += 1
      continue
    }
    metrics.pickD_V += 1
    if (hit) metrics.hitD_V += 1
    if (wasCandidateExecuted(row, decision.topCandidate)) {
      metrics.executedPickD_V += 1
      if (hit) metrics.executedHitD_V += 1
    }
  }

  for (const row of eRows) {
    const decision = router.evaluateRow(row)
    incrementReason(routingDiagnostics.e, decision.reason)
    if (!decision.accepted) continue
    const hit = decision.topCandidate?.successInWindow === true
    metrics.pickE += 1
    if (hit) metrics.hitE += 1
    const key = `${String(row?.decisionDateKey ?? "").trim()}::${String(decision.topCandidate?.symbol ?? "").trim()}`
    if (key !== "::") acceptedEKeys.add(key)
  }

  for (const trade of eTrades) {
    const key = `${String(trade?.decisionDateKey ?? "").trim()}::${String(trade?.symbol ?? "").trim()}`
    if (!acceptedEKeys.has(key)) continue
    metrics.executedPickE += 1
    if (trade?.hitTarget === true) metrics.executedHitE += 1
    if (trade?.hitStop === true || isStopExitReason(trade?.exitReason)) metrics.stopCountE += 1
    if (isTimeoutNegativeExitReason(trade?.exitReason, trade?.netRet)) {
      metrics.timeoutNegativeCountE += 1
    }
  }

  finalizeMetrics(metrics)
  const bundleStatus = evaluateBundleStatus(metrics, bundleCfg)
  const summary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    bundleId: spec.bundleId,
    familyId,
    sourceRunId,
    sourceProbeDir,
    bundleSpecPath,
    quorumMode: "CLUSTER_FIRST_NO_TRUE_QUORUM",
    bundleSpec: spec,
    ...metrics,
    ...bundleStatus,
    routingDiagnostics,
  }

  const outRunDir = resolveRunDir(cwd, outRunId)
  const outBundleDir = path.join(outRunDir, "step-c1", "bundle_probes", spec.bundleId)
  await ensureDir(outBundleDir)
  await writeJson(path.join(outBundleDir, "bundle_probe_summary.json"), summary)
  await writeJson(path.join(outBundleDir, "bundle_spec.json"), spec)
  await mergeBundleRow({
    ledgerPath: path.join(outRunDir, "step-c1", "bundle_leaderboard.json"),
    row: summary,
  })
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error?.stack ?? String(error))
  process.exit(1)
})
