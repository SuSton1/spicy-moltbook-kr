import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJson, toRunId, writeJson, writeJsonl } from "../src/lib/io.mjs"
import {
  normalizePerfectPrototypeRow,
  tokenizePerfectPrototypeRow,
} from "../src/lib/perfect_prototype_tokenizer.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import {
  buildPerfectPrototypeRuleOverlapClusters,
  createPerfectPrototypeRuleEvaluationAccumulator,
  finalizePerfectPrototypeRuleEvaluationAccumulator,
  updatePerfectPrototypeRuleEvaluationAccumulator,
} from "../src/lib/perfect_prototype_rule_overlap.mjs"
import {
  createPerfectPrototypeParentRuleAccumulator,
  finalizePerfectPrototypeParentRuleAccumulator,
  rankPerfectPrototypeParentRules,
  resolvePerfectPrototypeRowPartition,
  updatePerfectPrototypeParentRuleAccumulator,
} from "../src/lib/perfect_prototype_parent_rule.mjs"
import {
  buildNegativeFirstParentClusterPlans,
  createNegativeFirstParentSearchState,
  generateNegativeFirstParentNeighbors,
  normalizeNegativeFirstParentSearchOptions,
  rankNegativeFirstParentSearchStates,
  summarizeNegativeFirstParentSearchFailures,
} from "../src/lib/perfect_prototype_parent_search.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const toNumber = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const chooseBetterRule = (left, right) => {
  const ranked = rankPerfectPrototypeParentRules([left, right])
  return ranked[0] ?? left
}

const streamTokenizedRows = async ({ inputPath, tokenizerSpec, onRow }) => {
  const stream = fs.createReadStream(inputPath, { encoding: "utf8" })
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  })
  try {
    for await (const line of rl) {
      const text = String(line ?? "").trim()
      if (!text) continue
      let rawRow = null
      try {
        rawRow = JSON.parse(text)
      } catch {
        continue
      }
      const normalized = normalizePerfectPrototypeRow(rawRow, tokenizerSpec?.options)
      if (!normalized?.dateKey || !normalized?.symbol || typeof normalized?.outcomeHitTarget !== "boolean") {
        continue
      }
      const tokens = tokenizePerfectPrototypeRow(normalized, tokenizerSpec)
      await onRow({
        sourceId: normalized.sourceId,
        dateKey: normalized.dateKey,
        symbol: normalized.symbol,
        outcomeHitTarget: normalized.outcomeHitTarget,
        tokens,
        tokenSet: new Set(tokens),
      })
    }
  } finally {
    rl.close()
    stream.close()
  }
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "mine_perfect_prototype_parents",
  })
  const rawInputPath = String(getFlag(parsed.flags, "input", "")).trim()
  const rawChildCatalogPath = String(getFlag(parsed.flags, "child-catalog", "")).trim()
  const rawOutDir = String(getFlag(parsed.flags, "out-dir", "")).trim()
  const inputPath = rawInputPath ? path.resolve(rawInputPath) : ""
  const childCatalogPath = rawChildCatalogPath ? path.resolve(rawChildCatalogPath) : ""
  const outDir = rawOutDir
    ? path.resolve(rawOutDir)
    : path.join(
      cwd,
      "artifacts",
      "runs",
      String(getFlag(parsed.flags, "out-run-id", `perfect_proto_parent_${toRunId(new Date())}`)).trim(),
      "step-perfect-prototype-parent",
    )
  if (!inputPath || !childCatalogPath || !outDir) {
    throw new Error(
      "Usage: node tools/mine_perfect_prototype_parents.mjs --input=<daily_pack.jsonl> --child-catalog=<catalog.json> --out-dir=<dir> [--search-end=2023-12-31 --validation-start=2024-01-01 --validation-end=2024-12-31 --oos-start=2025-01-01 --oos-end=2026-02-19]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "input", filePath: inputPath },
      { label: "childCatalog", filePath: childCatalogPath },
      { label: "outDir", filePath: outDir },
    ],
    policy: serverPolicy,
    toolName: "mine_perfect_prototype_parents",
  })

  const childCatalog = await readJson(childCatalogPath, null)
  if (!childCatalog || !Array.isArray(childCatalog?.rules)) {
    throw new Error(`Child catalog missing rules: ${childCatalogPath}`)
  }

  const tokenizerSpec = childCatalog?.tokenizerSpec
  if (!tokenizerSpec) {
    throw new Error(`Child catalog tokenizerSpec missing: ${childCatalogPath}`)
  }

  const split = {
    searchStart: String(getFlag(parsed.flags, "search-start", "2020-11-27")).trim(),
    searchEnd: String(getFlag(parsed.flags, "search-end", "2023-12-31")).trim(),
    validationStart: String(getFlag(parsed.flags, "validation-start", "2024-01-01")).trim(),
    validationEnd: String(getFlag(parsed.flags, "validation-end", "2024-12-31")).trim(),
    oosStart: String(getFlag(parsed.flags, "oos-start", "2025-01-01")).trim(),
    oosEnd: String(getFlag(parsed.flags, "oos-end", "2026-02-19")).trim(),
  }

  const childRules = childCatalog.rules
  const childAccumulators = childRules.map((rule) => createPerfectPrototypeRuleEvaluationAccumulator(rule))
  const sourceRowCounts = {
    search: 0,
    validation: 0,
    oos: 0,
  }
  const partitionCalendars = {
    search: new Set(),
    validation: new Set(),
    oos: new Set(),
  }
  await streamTokenizedRows({
    inputPath,
    tokenizerSpec,
    onRow: async (row) => {
      const partition = resolvePerfectPrototypeRowPartition(row.dateKey, split)
      if (!partition) return
      sourceRowCounts[partition] += 1
      partitionCalendars[partition].add(row.dateKey)
      if (partition !== "search") return
      for (const accumulator of childAccumulators) {
        updatePerfectPrototypeRuleEvaluationAccumulator(accumulator, row)
      }
    },
  })
  const childEvaluations = childAccumulators.map((accumulator) =>
    finalizePerfectPrototypeRuleEvaluationAccumulator(accumulator),
  )
  const overlap = buildPerfectPrototypeRuleOverlapClusters({
    evaluations: childEvaluations,
    minJaccard: toNumber(getFlag(parsed.flags, "min-jaccard", 0.6), 0.6),
    minSharedPositiveKeys: Math.max(
      1,
      Math.floor(toNumber(getFlag(parsed.flags, "min-shared-keys", 2), 2)),
    ),
  })
  const parentOptions = normalizeNegativeFirstParentSearchOptions({
    minSupportRatio: toNumber(getFlag(parsed.flags, "min-support-ratio", 0.5), 0.5),
    maxRuleSize: Math.max(1, Math.floor(toNumber(getFlag(parsed.flags, "max-rule-size", 6), 6))),
    beamSize: Math.max(1, Math.floor(toNumber(getFlag(parsed.flags, "beam-size", 8), 8))),
    maxRounds: Math.max(1, Math.floor(toNumber(getFlag(parsed.flags, "max-rounds", 4), 4))),
    maxSeedChildRulesPerCluster: Math.max(
      1,
      Math.floor(toNumber(getFlag(parsed.flags, "max-seed-child-rules", 8), 8)),
    ),
    maxAddTokensPerCandidate: Math.max(
      1,
      Math.floor(toNumber(getFlag(parsed.flags, "max-add-tokens", 6), 6)),
    ),
    maxDropTokensPerCandidate: Math.max(
      1,
      Math.floor(toNumber(getFlag(parsed.flags, "max-drop-tokens", 3), 3)),
    ),
    maxSwapTokensPerCandidate: Math.max(
      1,
      Math.floor(toNumber(getFlag(parsed.flags, "max-swap-tokens", 4), 4)),
    ),
    stagnationRounds: Math.max(
      1,
      Math.floor(toNumber(getFlag(parsed.flags, "stagnation-rounds", 2), 2)),
    ),
  })
  const evaluationOptions = {
    minSearchHits: Math.max(1, Math.floor(toNumber(getFlag(parsed.flags, "min-search-hits", 6), 6))),
    minValidationHits: Math.max(
      1,
      Math.floor(toNumber(getFlag(parsed.flags, "min-validation-hits", 2), 2)),
    ),
    maxValidationGapTradingDays: Math.max(
      1,
      Math.floor(toNumber(getFlag(parsed.flags, "max-validation-gap", 40), 40)),
    ),
    minOosHits: Math.max(1, Math.floor(toNumber(getFlag(parsed.flags, "min-oos-hits", 2), 2))),
  }
  const childRulesById = new Map(
    childRules.map((rule) => [String(rule?.ruleId ?? "").trim(), rule]),
  )
  const childEvaluationLookup = new Map(
    childEvaluations.map((evaluation) => [String(evaluation?.ruleId ?? "").trim(), evaluation]),
  )
  const clusterPlans = buildNegativeFirstParentClusterPlans({
    childClusters: overlap.clusters,
    childRulesById,
    childEvaluationLookup,
    options: parentOptions,
  })
  const stateCacheByCluster = new Map()
  const frontierByCluster = new Map()
  const clusterSearchSummary = []
  let totalEvaluatedCandidates = 0
  let stagnationRounds = 0

  for (const clusterPlan of clusterPlans) {
    const stateMap = new Map()
    stateCacheByCluster.set(clusterPlan.clusterId, stateMap)
    frontierByCluster.set(
      clusterPlan.clusterId,
      clusterPlan.seedCandidates.map((candidate) => createNegativeFirstParentSearchState(candidate)),
    )
  }

  for (let round = 1; round <= parentOptions.maxRounds; round += 1) {
    const pendingStates = []
    for (const clusterPlan of clusterPlans) {
      const stateMap = stateCacheByCluster.get(clusterPlan.clusterId)
      const frontier = frontierByCluster.get(clusterPlan.clusterId) ?? []
      for (const state of frontier) {
        const existing = stateMap.get(state.key)
        if (existing) continue
        stateMap.set(state.key, state)
        pendingStates.push(state)
      }
    }
    if (pendingStates.length < 1) break

    const accumulators = new Map(
      pendingStates.map((state) => [
        state.key,
        createPerfectPrototypeParentRuleAccumulator({
          tokens: state.tokens,
          overlapClusterId: state.clusterId,
          sourceChildRuleIds: state.sourceChildRuleIds,
          supportRatio: null,
        }),
      ]),
    )

    await streamTokenizedRows({
      inputPath,
      tokenizerSpec,
      onRow: async (row) => {
        const partition = resolvePerfectPrototypeRowPartition(row.dateKey, split)
        if (!partition) return
        for (const state of pendingStates) {
          updatePerfectPrototypeParentRuleAccumulator(
            accumulators.get(state.key),
            row,
            partition,
          )
        }
      },
    })

    for (const state of pendingStates) {
      state.metrics = finalizePerfectPrototypeParentRuleAccumulator({
        accumulator: accumulators.get(state.key),
        split,
        options: evaluationOptions,
        partitionCalendars,
      })
      totalEvaluatedCandidates += 1
    }

    let improvedClusters = 0
    const nextFrontierByCluster = new Map()
    for (const clusterPlan of clusterPlans) {
      const stateMap = stateCacheByCluster.get(clusterPlan.clusterId)
      const allStates = Array.from(stateMap.values()).filter((state) => state?.metrics)
      const rankedStates = rankNegativeFirstParentSearchStates(allStates)
      const keptStates = rankedStates.slice(0, parentOptions.beamSize)
      const previousSummary = clusterSearchSummary.find(
        (entry) => entry.clusterId === clusterPlan.clusterId,
      )
      const bestState = keptStates[0] ?? null
      if (
        bestState &&
        (!previousSummary ||
          previousSummary.bestRuleId !== bestState.metrics?.ruleId ||
          previousSummary.bestPromotionStatus !== bestState.metrics?.promotionStatus)
      ) {
        improvedClusters += 1
      }
      const seenNeighborKeys = new Set()
      const neighbors = []
      for (const state of keptStates) {
        for (const candidate of generateNegativeFirstParentNeighbors({
          clusterPlan,
          state,
          options: parentOptions,
        })) {
          if (stateMap.has(candidate.key) || seenNeighborKeys.has(candidate.key)) continue
          seenNeighborKeys.add(candidate.key)
          neighbors.push(createNegativeFirstParentSearchState(candidate))
        }
      }
      nextFrontierByCluster.set(clusterPlan.clusterId, neighbors)
      const failureSummary = summarizeNegativeFirstParentSearchFailures(keptStates, {
        maxValidationGapTradingDays: evaluationOptions.maxValidationGapTradingDays,
      })
      const summaryRow = {
        clusterId: clusterPlan.clusterId,
        round,
        childRuleCount: clusterPlan.childRuleIds.length,
        evaluatedStateCount: allStates.length,
        keptStateCount: keptStates.length,
        nextFrontierCount: neighbors.length,
        bestRuleId: bestState?.metrics?.ruleId ?? null,
        bestPromotionStatus: bestState?.metrics?.promotionStatus ?? null,
        bestValidationNegativeCount: Number(bestState?.metrics?.validationMetrics?.negativeCount ?? 0),
        bestValidationMatchedDateCount: Number(bestState?.metrics?.validationMetrics?.matchedDateCount ?? 0),
        bestValidationMaxGapTradingDays: bestState?.metrics?.validationMetrics?.maxGapTradingDays ?? null,
        failureReason: failureSummary.failureReason,
        leaderboard: keptStates.slice(0, 5).map((state) => ({
          ruleId: state?.metrics?.ruleId ?? null,
          tokens: state?.tokens ?? [],
          generation: state?.generation ?? 0,
          operation: state?.operation ?? null,
          promotionStatus: state?.metrics?.promotionStatus ?? null,
          validationNegativeCount: Number(state?.metrics?.validationMetrics?.negativeCount ?? 0),
          validationMatchedDateCount: Number(state?.metrics?.validationMetrics?.matchedDateCount ?? 0),
          validationMaxGapTradingDays: state?.metrics?.validationMetrics?.maxGapTradingDays ?? null,
          searchHitCount: Number(state?.metrics?.searchMetrics?.hitCount ?? 0),
        })),
      }
      const existingIndex = clusterSearchSummary.findIndex((entry) => entry.clusterId === clusterPlan.clusterId)
      if (existingIndex >= 0) {
        clusterSearchSummary[existingIndex] = summaryRow
      } else {
        clusterSearchSummary.push(summaryRow)
      }
    }

    if (improvedClusters < 1) {
      stagnationRounds += 1
    } else {
      stagnationRounds = 0
    }
    if (stagnationRounds >= parentOptions.stagnationRounds) {
      for (const [clusterId] of nextFrontierByCluster.entries()) {
        frontierByCluster.set(clusterId, [])
      }
      break
    }
    for (const [clusterId, nextFrontier] of nextFrontierByCluster.entries()) {
      frontierByCluster.set(clusterId, nextFrontier)
    }
  }

  const dedupedRules = new Map()
  for (const stateMap of stateCacheByCluster.values()) {
    for (const state of stateMap.values()) {
      if (!state?.metrics) continue
      const ruleId = String(state.metrics.ruleId ?? "").trim()
      if (!ruleId) continue
      const current = dedupedRules.get(ruleId)
      if (!current) {
        dedupedRules.set(ruleId, state.metrics)
        continue
      }
      dedupedRules.set(ruleId, chooseBetterRule(current, state.metrics))
    }
  }
  const rankedRules = rankPerfectPrototypeParentRules(Array.from(dedupedRules.values()))
  const validatedRules = rankedRules.filter((rule) => rule?.promotionStatus === "validated")
  const candidateRules = rankedRules.filter((rule) => rule?.promotionStatus === "candidate")
  const mined = {
    rules: rankedRules,
    validatedRules,
    candidateRules,
    champion: validatedRules[0] ?? null,
    metadata: {
      split,
      rowCounts: sourceRowCounts,
      clusterCount: overlap.clusters.length,
      childRuleCount: childRules.length,
      evaluatedParentRuleCount: rankedRules.length,
      validatedParentRuleCount: validatedRules.length,
      candidateParentRuleCount: candidateRules.length,
      totalEvaluatedCandidates,
    },
  }

  const catalog = {
    version: 1,
    generatedAt: new Date().toISOString(),
    metadata: {
      ...mined.metadata,
      inputPath,
      childCatalogPath,
      split,
    },
    tokenizerSpec,
    champion: mined.champion,
    rules: mined.rules,
  }
  const validatedCatalog = {
    ...catalog,
    champion: mined.champion,
    rules: mined.validatedRules,
    metadata: {
      ...catalog.metadata,
      ruleCount: mined.validatedRules.length,
      sourceRuleCount: mined.rules.length,
    },
  }

  const clusterReport = overlap.clusters.map((cluster) => ({
    clusterId: cluster.clusterId,
    childRuleCount: cluster.childRuleCount,
    unionPositiveKeyCount: cluster.unionPositiveKeyCount,
    childRuleIds: cluster.childRuleIds,
    tokenUnionSample: cluster.tokenUnion.slice(0, 24),
  }))

  await writeJson(path.join(outDir, "parent_catalog.json"), catalog)
  await writeJson(path.join(outDir, "validated_parent_catalog.json"), validatedCatalog)
  await writeJson(path.join(outDir, "parent_rule_report.json"), mined.rules)
  await writeJson(path.join(outDir, "parent_cluster_report.json"), clusterReport)
  await writeJson(path.join(outDir, "child_overlap_report.json"), {
    clusterCount: overlap.clusters.length,
    overlapEdgeCount: overlap.overlapRows.length,
    overlapRows: overlap.overlapRows.slice(0, 5000),
  })
  await writeJson(path.join(outDir, "cluster_candidate_leaderboard.json"), clusterSearchSummary)
  await writeJson(path.join(outDir, "parent_search_report.json"), {
    split,
    searchOptions: parentOptions,
    evaluationOptions,
    clusterCount: clusterPlans.length,
    totalEvaluatedCandidates,
    validatedParentRuleCount: mined.validatedRules.length,
    candidateParentRuleCount: mined.candidateRules.length,
    clusterSummaries: clusterSearchSummary.map((row) => ({
      clusterId: row.clusterId,
      childRuleCount: row.childRuleCount,
      evaluatedStateCount: row.evaluatedStateCount,
      nextFrontierCount: row.nextFrontierCount,
      bestRuleId: row.bestRuleId,
      bestPromotionStatus: row.bestPromotionStatus,
      failureReason: row.failureReason,
    })),
  })
  await writeJsonl(
    path.join(outDir, "parent_search_failures.jsonl"),
    clusterSearchSummary
      .filter((row) => row.bestPromotionStatus !== "validated")
      .map((row) => ({
        clusterId: row.clusterId,
        failureReason: row.failureReason,
        bestRuleId: row.bestRuleId,
        bestPromotionStatus: row.bestPromotionStatus,
        bestValidationNegativeCount: row.bestValidationNegativeCount,
        bestValidationMatchedDateCount: row.bestValidationMatchedDateCount,
        bestValidationMaxGapTradingDays: row.bestValidationMaxGapTradingDays,
      })),
  )
  await writeJson(path.join(outDir, "parent_summary.json"), {
    inputPath,
    childCatalogPath,
    split,
    sourceRows: sourceRowCounts.search + sourceRowCounts.validation + sourceRowCounts.oos,
    searchRows: sourceRowCounts.search,
    validationRows: sourceRowCounts.validation,
    oosRows: sourceRowCounts.oos,
    childRuleCount: childRules.length,
    childRulesWithPositiveSearchMatches: childEvaluations.filter((row) => row.positiveKeys.size > 0).length,
    overlapClusterCount: overlap.clusters.length,
    evaluatedParentRuleCount: mined.rules.length,
    validatedParentRuleCount: mined.validatedRules.length,
    candidateParentRuleCount: mined.candidateRules.length,
    totalEvaluatedCandidates,
    validatedRuleIds: uniqueSorted(mined.validatedRules.map((rule) => rule.ruleId)),
    championRuleId: mined.champion?.ruleId ?? null,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
