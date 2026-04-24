import path from "node:path"

import { parseCliArgs } from "../src/lib/args.mjs"
import { readJson, writeJson } from "../src/lib/io.mjs"

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const clampRate = (value) => {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 1
  return value
}

const resolveRunDir = (cwd, runId) => path.join(cwd, "artifacts", "runs", String(runId ?? "").trim())

const sortFamilyIds = (values) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))]
    .sort((left, right) => {
      const leftNum = Number.parseInt(left.replace(/^F/i, ""), 10)
      const rightNum = Number.parseInt(right.replace(/^F/i, ""), 10)
      if (Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum !== rightNum) {
        return leftNum - rightNum
      }
      return left.localeCompare(right)
    })

const scoreDiscoveryRow = (row) =>
  clampRate(toFiniteNumber(row?.rateD_U, 0)) * Math.log1p(Math.max(0, toFiniteNumber(row?.pickD_U, 0)))

const scoreValidationRow = (row) =>
  clampRate(toFiniteNumber(row?.rateD_V, 0)) * Math.log1p(Math.max(0, toFiniteNumber(row?.pickD_V, 0)))

const scoreExecutedValidationRow = (row) =>
  clampRate(toFiniteNumber(row?.executedRateD_V, 0)) *
  Math.log1p(Math.max(0, toFiniteNumber(row?.executedPickD_V, 0)))

const clusterCandidateView = (row) => ({
  clusterId: String(row?.clusterId ?? "").trim(),
  role: String(row?.role ?? "UNKNOWN").trim() || "UNKNOWN",
  sampleTier: String(row?.sampleTier ?? "EMPTY").trim() || "EMPTY",
  rateD_U: clampRate(toFiniteNumber(row?.rateD_U, 0)),
  pickD_U: Math.max(0, toFiniteNumber(row?.pickD_U, 0)),
  rateD_V: clampRate(toFiniteNumber(row?.rateD_V, 0)),
  pickD_V: Math.max(0, toFiniteNumber(row?.pickD_V, 0)),
  executedRateD_V: clampRate(toFiniteNumber(row?.executedRateD_V, 0)),
  executedPickD_V: Math.max(0, toFiniteNumber(row?.executedPickD_V, 0)),
  rateE: clampRate(toFiniteNumber(row?.rateE, 0)),
  pickE: Math.max(0, toFiniteNumber(row?.pickE, 0)),
  vetoScore: clampRate(toFiniteNumber(row?.vetoScore, 0)),
  discoveryScore: scoreDiscoveryRow(row),
  validationScore: scoreValidationRow(row),
  executedValidationScore: scoreExecutedValidationRow(row),
})

const sortDiscoveryCandidates = (rows) =>
  rows.slice().sort((left, right) => {
    const rightDiscovery = scoreDiscoveryRow(right)
    const leftDiscovery = scoreDiscoveryRow(left)
    if (rightDiscovery !== leftDiscovery) return rightDiscovery - leftDiscovery
    const rightValidation = scoreValidationRow(right)
    const leftValidation = scoreValidationRow(left)
    if (rightValidation !== leftValidation) return rightValidation - leftValidation
    const rightExecuted = scoreExecutedValidationRow(right)
    const leftExecuted = scoreExecutedValidationRow(left)
    if (rightExecuted !== leftExecuted) return rightExecuted - leftExecuted
    return String(left?.clusterId ?? "").localeCompare(String(right?.clusterId ?? ""))
  })

const sortValidationCandidates = (rows) =>
  rows.slice().sort((left, right) => {
    const rightValidation = scoreValidationRow(right)
    const leftValidation = scoreValidationRow(left)
    if (rightValidation !== leftValidation) return rightValidation - leftValidation
    const rightExecuted = scoreExecutedValidationRow(right)
    const leftExecuted = scoreExecutedValidationRow(left)
    if (rightExecuted !== leftExecuted) return rightExecuted - leftExecuted
    const rightDiscovery = scoreDiscoveryRow(right)
    const leftDiscovery = scoreDiscoveryRow(left)
    if (rightDiscovery !== leftDiscovery) return rightDiscovery - leftDiscovery
    return String(left?.clusterId ?? "").localeCompare(String(right?.clusterId ?? ""))
  })

const familySelectionRank = (candidate) => [
  candidate.primary === true ? 0 : candidate.nearMiss === true ? 1 : 2,
  -candidate.bestRateD_V,
  -candidate.bestPickD_V,
  -candidate.bestExecutedRateD_V,
  -candidate.bestRateD_U,
  -candidate.bestPickD_U,
  candidate.familyId,
]

const compareFamilySelectionRank = (left, right) => {
  const leftRank = familySelectionRank(left)
  const rightRank = familySelectionRank(right)
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] < rightRank[index]) return -1
    if (leftRank[index] > rightRank[index]) return 1
  }
  return 0
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const runId = String(parsed.flags["run-id"] ?? "").trim()
  if (!runId) {
    throw new Error(
      "Usage: node tools/select_bundle_subset.mjs --run-id=<run> [--max-families=30 --sentinel-family-ids=F008,F123,F175]",
    )
  }

  const minRateDV = clampRate(toFiniteNumber(parsed.flags["min-rate-dv"], 0.3))
  const minPickDV = Math.max(0, Math.floor(toFiniteNumber(parsed.flags["min-pick-dv"], 8)))
  const nearRateDV = clampRate(toFiniteNumber(parsed.flags["near-rate-dv"], 0.2))
  const nearPickDV = Math.max(0, Math.floor(toFiniteNumber(parsed.flags["near-pick-dv"], 12)))
  const nearExecutedRateDV = clampRate(toFiniteNumber(parsed.flags["near-executed-rate-dv"], 0.25))
  const nearExecutedPickDV = Math.max(0, Math.floor(toFiniteNumber(parsed.flags["near-executed-pick-dv"], 8)))
  const maxFamilies = Math.max(1, Math.floor(toFiniteNumber(parsed.flags["max-families"], 30)))
  const maxClustersPerFamily = Math.max(1, Math.floor(toFiniteNumber(parsed.flags["max-clusters-per-family"], 3)))
  const sentinelFamilyIds = sortFamilyIds(String(parsed.flags["sentinel-family-ids"] ?? "F008,F123,F175").split(","))
  const includeFamilyIds = sortFamilyIds(String(parsed.flags["include-family-ids"] ?? "").split(","))

  const runDir = resolveRunDir(cwd, runId)
  const leaderboardPath = path.join(runDir, "step-c1", "prototype_bundle_leaderboard.json")
  const leaderboard = await readJson(leaderboardPath, null)
  if (!leaderboard) {
    throw new Error(`Bundle leaderboard not found: ${leaderboardPath}`)
  }

  const clusterRows = Array.isArray(leaderboard?.clusterRows) ? leaderboard.clusterRows : []
  const familyMap = new Map()

  for (const row of clusterRows) {
    const familyId = String(row?.familyId ?? "").trim()
    const clusterId = String(row?.clusterId ?? "").trim()
    if (!familyId || !clusterId) continue
    if (!familyMap.has(familyId)) {
      familyMap.set(familyId, [])
    }
    familyMap.get(familyId).push(row)
  }

  const sentinelSet = new Set([...sentinelFamilyIds, ...includeFamilyIds])
  const familyCandidates = []

  for (const familyId of sortFamilyIds(Array.from(familyMap.keys()))) {
    const rows = familyMap.get(familyId) ?? []
    const discoveryRows = sortDiscoveryCandidates(rows.filter((row) => toFiniteNumber(row?.pickD_U, 0) > 0))
    const validationRows = sortValidationCandidates(rows.filter((row) => toFiniteNumber(row?.pickD_V, 0) > 0))
    const bestDiscovery = discoveryRows[0] ?? null
    const bestValidation = validationRows[0] ?? null
    const primaryRows = validationRows.filter(
      (row) => clampRate(toFiniteNumber(row?.rateD_V, 0)) >= minRateDV && toFiniteNumber(row?.pickD_V, 0) >= minPickDV,
    )
    const nearMissRows = validationRows.filter(
      (row) =>
        (clampRate(toFiniteNumber(row?.rateD_V, 0)) >= nearRateDV &&
          toFiniteNumber(row?.pickD_V, 0) >= nearPickDV) ||
        (clampRate(toFiniteNumber(row?.executedRateD_V, 0)) >= nearExecutedRateDV &&
          toFiniteNumber(row?.executedPickD_V, 0) >= nearExecutedPickDV),
    )
    const sentinel = sentinelSet.has(familyId)
    const include = sentinel || primaryRows.length > 0 || nearMissRows.length > 0
    if (!include) continue

    const reasons = []
    if (primaryRows.length > 0) reasons.push("PRIMARY_DV")
    if (primaryRows.length < 1 && nearMissRows.length > 0) reasons.push("NEAR_MISS_DV")
    if (sentinel) reasons.push("SENTINEL")

    const designClusterCandidates = discoveryRows
      .slice(0, maxClustersPerFamily)
      .map(clusterCandidateView)
    const validationClusterCandidates = validationRows
      .slice(0, maxClustersPerFamily)
      .map(clusterCandidateView)

    familyCandidates.push({
      familyId,
      sentinel,
      primary: primaryRows.length > 0,
      nearMiss: primaryRows.length < 1 && nearMissRows.length > 0,
      selectionReasons: reasons,
      bestClusterByDU: bestDiscovery ? clusterCandidateView(bestDiscovery) : null,
      bestClusterByDV: bestValidation ? clusterCandidateView(bestValidation) : null,
      bestRateD_U: clampRate(toFiniteNumber(bestDiscovery?.rateD_U, 0)),
      bestPickD_U: Math.max(0, toFiniteNumber(bestDiscovery?.pickD_U, 0)),
      bestRateD_V: clampRate(toFiniteNumber(bestValidation?.rateD_V, 0)),
      bestPickD_V: Math.max(0, toFiniteNumber(bestValidation?.pickD_V, 0)),
      bestExecutedRateD_V: clampRate(toFiniteNumber(bestValidation?.executedRateD_V, 0)),
      bestExecutedPickD_V: Math.max(0, toFiniteNumber(bestValidation?.executedPickD_V, 0)),
      designClusterCandidates,
      validationClusterCandidates,
    })
  }

  const sortedCandidates = familyCandidates.sort(compareFamilySelectionRank)
  const sentinelCandidates = sortedCandidates.filter((candidate) => candidate.sentinel)
  const nonSentinelCandidates = sortedCandidates.filter((candidate) => candidate.sentinel !== true)
  const selectedFamilies = [...sentinelCandidates]
  const selectedFamilyIdSet = new Set(selectedFamilies.map((candidate) => candidate.familyId))
  for (const candidate of nonSentinelCandidates) {
    if (selectedFamilies.length >= maxFamilies) break
    if (selectedFamilyIdSet.has(candidate.familyId)) continue
    selectedFamilies.push(candidate)
    selectedFamilyIdSet.add(candidate.familyId)
  }

  const selectedFamilyIds = sortFamilyIds(selectedFamilies.map((candidate) => candidate.familyId))
  const availableFamilyIds = new Set(familyCandidates.map((candidate) => candidate.familyId))
  const availableSentinelFamilyIds = sentinelFamilyIds.filter((familyId) => availableFamilyIds.has(familyId))
  const missingSentinelFamilyIds = sentinelFamilyIds.filter((familyId) => !availableFamilyIds.has(familyId))
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    runId,
    leaderboardPath,
    selectionConfig: {
      minRateDV,
      minPickDV,
      nearRateDV,
      nearPickDV,
      nearExecutedRateDV,
      nearExecutedPickDV,
      maxFamilies,
      maxClustersPerFamily,
      sentinelFamilyIds,
      availableSentinelFamilyIds,
      missingSentinelFamilyIds,
      includeFamilyIds,
      designSource: "D_U",
      validationSource: "D_V",
      confirmationSource: "E",
    },
    summary: {
      familyCandidateCount: familyCandidates.length,
      selectedFamilyCount: selectedFamilies.length,
      primaryFamilyCount: selectedFamilies.filter((candidate) => candidate.primary).length,
      nearMissFamilyCount: selectedFamilies.filter((candidate) => candidate.nearMiss).length,
      sentinelFamilyCount: selectedFamilies.filter((candidate) => candidate.sentinel).length,
      availableSentinelFamilyIds,
      missingSentinelFamilyIds,
      selectedFamilyIds,
    },
    selectedFamilies: selectedFamilies.sort((left, right) =>
      compareFamilySelectionRank(left, right),
    ),
  }

  const outputPath = path.join(runDir, "step-c1", "bundle_subset_candidates.json")
  await writeJson(outputPath, output)
  console.log(
    JSON.stringify(
      {
        step: "select-bundle-subset",
        runId,
        selectedFamilyCount: output.summary.selectedFamilyCount,
        primaryFamilyCount: output.summary.primaryFamilyCount,
        nearMissFamilyCount: output.summary.nearMissFamilyCount,
        sentinelFamilyCount: output.summary.sentinelFamilyCount,
        availableSentinelFamilyIds,
        missingSentinelFamilyIds,
        selectedFamilyIds,
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
