import { createHash } from "node:crypto"

import { scoreTp12TouchBundleRow } from "./perfect_prototype_tp12_touch_scorecard_bundle.mjs"

const uniqueSorted = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const buildHashId = (prefix, values = []) => {
  const hash = createHash("sha1")
  hash.update(String(prefix ?? ""))
  for (const value of Array.isArray(values) ? values : []) {
    hash.update("\u001f")
    hash.update(String(value ?? ""))
  }
  return `${String(prefix ?? "PARENT").toUpperCase()}_${hash.digest("hex").slice(0, 12)}`
}

const tokenPriority = (token) => {
  const text = String(token ?? "")
  if (text.startsWith("tag:")) return 0
  if (text.startsWith("num:")) return 1
  return 2
}

const compareTokenRows = (left, right) => {
  if (toNumber(right?.count, 0) !== toNumber(left?.count, 0)) {
    return toNumber(right?.count, 0) - toNumber(left?.count, 0)
  }
  if (tokenPriority(left?.token) !== tokenPriority(right?.token)) {
    return tokenPriority(left?.token) - tokenPriority(right?.token)
  }
  if (String(left?.token ?? "").length !== String(right?.token ?? "").length) {
    return String(left?.token ?? "").length - String(right?.token ?? "").length
  }
  return String(left?.token ?? "").localeCompare(String(right?.token ?? ""))
}

const summarizeSelectedRows = (rows = []) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const positives = safeRows.filter((row) => row?.outcomeHitTarget === true)
  const negatives = safeRows.filter((row) => row?.outcomeHitTarget !== true)
  const hitDates = uniqueSorted(positives.map((row) => row?.dateKey).filter(Boolean))
  const topDateCounts = new Map()
  for (const row of positives) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    topDateCounts.set(dateKey, toNumber(topDateCounts.get(dateKey), 0) + 1)
  }
  const top1DateHits = Array.from(topDateCounts.values()).sort((a, b) => b - a)[0] ?? 0
  return {
    selectedRowCount: safeRows.length,
    positiveRowCount: positives.length,
    negativeRowCount: negatives.length,
    precision: safeRows.length > 0 ? positives.length / safeRows.length : 0,
    matchedDateCount: hitDates.length,
    matchedMonthCount: uniqueSorted(hitDates.map(buildMonthKey).filter(Boolean)).length,
    matchedFoldCount: uniqueSorted(positives.map((row) => row?.dateFoldKey).filter(Boolean)).length,
    selectedDateCount: uniqueSorted(safeRows.map((row) => row?.dateKey).filter(Boolean)).length,
    selectedSymbolCount: uniqueSorted(safeRows.map((row) => row?.symbol).filter(Boolean)).length,
    top1DateHitShare: positives.length > 0 ? top1DateHits / positives.length : 0,
    zeroNegative: safeRows.length > 0 && negatives.length === 0,
    perfectDateFloor3: safeRows.length > 0 && negatives.length === 0 && positives.length >= 3 && hitDates.length >= 3,
  }
}

const evaluateTerm = ({ term, rows = [] } = {}) => {
  const artifact = {
    threshold: 1,
    terms: [term],
  }
  const selectedRows = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const evaluation = scoreTp12TouchBundleRow({ artifact, row })
    if (evaluation?.selected !== true) continue
    selectedRows.push(row)
  }
  return {
    selectedRows,
    summary: summarizeSelectedRows(selectedRows),
  }
}

const buildRoleCounts = (terms = []) => {
  const out = {
    parent_lift: 0,
  }
  for (const term of Array.isArray(terms) ? terms : []) {
    if (String(term?.role ?? "") === "parent_lift") out.parent_lift += 1
  }
  return out
}

const buildClusterLookup = (clusters = []) => new Map((Array.isArray(clusters) ? clusters : []).map((row) => [String(row?.clusterId ?? "").trim(), row]))
const buildDonorLookup = (donors = []) => new Map((Array.isArray(donors) ? donors : []).map((row) => [String(row?.ruleId ?? "").trim(), row]))

const buildSeedClusterIds = ({ termBank = {}, bundle = {}, donorClusters = {}, maxSeedClusters = 2 } = {}) => {
  const termLookup = new Map((Array.isArray(termBank?.qualifiedTerms) ? termBank.qualifiedTerms : []).map((term) => [term.termId, term]))
  const selectedTerms = (bundle?.positiveBundle?.termIds ?? []).map((termId) => termLookup.get(termId)).filter(Boolean)
  const selectedClusterIds = selectedTerms
    .filter((term) => String(term?.role ?? "") === "cluster_any")
    .map((term) => String(term?.label ?? term?.meta?.clusterId ?? "").trim())
    .filter(Boolean)
  if (selectedClusterIds.length > 0) return uniqueSorted(selectedClusterIds).slice(0, Math.max(1, Number(maxSeedClusters) || 2))
  return (Array.isArray(donorClusters?.clusters) ? donorClusters.clusters : [])
    .slice()
    .sort((left, right) => {
      if (toNumber(right?.donorCount, 0) !== toNumber(left?.donorCount, 0)) {
        return toNumber(right?.donorCount, 0) - toNumber(left?.donorCount, 0)
      }
      return String(left?.clusterId ?? "").localeCompare(String(right?.clusterId ?? ""))
    })
    .slice(0, Math.max(1, Number(maxSeedClusters) || 2))
    .map((row) => String(row?.clusterId ?? "").trim())
    .filter(Boolean)
}

const pushCandidate = ({ out = [], seen = new Set(), clusterId, sourceKind, ruleTokens = [], meta = {} } = {}) => {
  const uniqueTokens = uniqueSorted(ruleTokens)
  if (uniqueTokens.length < 2) return
  const signature = uniqueTokens.join("\u001f")
  if (!signature || seen.has(signature)) return
  seen.add(signature)
  out.push({
    candidateId: buildHashId("TOUCH_PARENT", [clusterId, sourceKind, ...uniqueTokens]),
    clusterId,
    sourceKind,
    ruleTokens: uniqueTokens,
    meta,
  })
}

const buildParentCandidatesForCluster = ({ cluster, donors = [], qualifiedCandidates = [] } = {}) => {
  const out = []
  const seen = new Set()
  const donorRows = Array.isArray(donors) ? donors : []
  const clusterCandidates = (Array.isArray(qualifiedCandidates) ? qualifiedCandidates : []).filter(
    (row) => String(row?.clusterId ?? "").trim() === String(cluster?.clusterId ?? "").trim(),
  )
  const tokenCounts = new Map()
  for (const donor of donorRows) {
    for (const token of uniqueSorted(donor?.tokens ?? [])) {
      tokenCounts.set(token, toNumber(tokenCounts.get(token), 0) + 1)
    }
  }
  const rankedTokens = Array.from(tokenCounts.entries())
    .map(([token, count]) => ({ token, count }))
    .sort(compareTokenRows)

  pushCandidate({
    out,
    seen,
    clusterId: cluster?.clusterId,
    sourceKind: "cluster_shared",
    ruleTokens: cluster?.sharedTokens ?? [],
    meta: { donorCount: cluster?.donorCount ?? donorRows.length },
  })

  pushCandidate({
    out,
    seen,
    clusterId: cluster?.clusterId,
    sourceKind: "cluster_shared_tags_only",
    ruleTokens: uniqueSorted(cluster?.sharedTokens ?? []).filter((token) => token.startsWith("tag:")),
    meta: { donorCount: cluster?.donorCount ?? donorRows.length },
  })

  for (const supportFraction of [0.67, 0.5, 0.34]) {
    const minSupport = Math.max(1, Math.ceil(donorRows.length * supportFraction))
    const supportTokens = rankedTokens
      .filter((row) => row.count >= minSupport)
      .slice(0, 6)
      .map((row) => row.token)
    pushCandidate({
      out,
      seen,
      clusterId: cluster?.clusterId,
      sourceKind: `support_${supportFraction.toFixed(2)}`,
      ruleTokens: supportTokens,
      meta: { supportFraction, minSupport },
    })
  }

  for (const candidate of clusterCandidates) {
    pushCandidate({
      out,
      seen,
      clusterId: cluster?.clusterId,
      sourceKind: "qualified_candidate_original",
      ruleTokens: candidate?.ruleTokens ?? [],
      meta: { sourceCandidateId: candidate?.candidateId ?? null },
    })
    const baseTokens = uniqueSorted(candidate?.ruleTokens ?? [])
    if (baseTokens.length > 2) {
      for (let index = 0; index < baseTokens.length; index += 1) {
        const nextTokens = baseTokens.filter((_, tokenIndex) => tokenIndex !== index)
        pushCandidate({
          out,
          seen,
          clusterId: cluster?.clusterId,
          sourceKind: "drop_one",
          ruleTokens: nextTokens,
          meta: {
            sourceCandidateId: candidate?.candidateId ?? null,
            droppedToken: baseTokens[index],
          },
        })
      }
    }
    const tagTokens = baseTokens.filter((token) => token.startsWith("tag:"))
    pushCandidate({
      out,
      seen,
      clusterId: cluster?.clusterId,
      sourceKind: "candidate_tags_only",
      ruleTokens: tagTokens,
      meta: { sourceCandidateId: candidate?.candidateId ?? null },
    })
  }

  return out
}

export const buildTp12TouchParentLiftBank = ({
  donorManifest = {},
  donorClusters = {},
  qualifiedCandidates = {},
  termBank = {},
  bundle = {},
  trainRows = [],
  oosRows = [],
  maxSeedClusters = 2,
  maxParentTerms = 12,
  minTrainSelectedRows = 12,
  minTrainDates = 10,
  minTrainMonths = 6,
  minTrainFolds = 4,
  minTrainPrecision = 0.34,
} = {}) => {
  const clusterLookup = buildClusterLookup(donorClusters?.clusters)
  const donorLookup = buildDonorLookup(donorManifest?.donors)
  const seedClusterIds = buildSeedClusterIds({
    termBank,
    bundle,
    donorClusters,
    maxSeedClusters,
  })

  const rawCandidates = []
  for (const clusterId of seedClusterIds) {
    const cluster = clusterLookup.get(String(clusterId ?? "").trim())
    if (!cluster) continue
    const clusterDonors = (Array.isArray(cluster?.donorRuleIds) ? cluster.donorRuleIds : [])
      .map((ruleId) => donorLookup.get(String(ruleId ?? "").trim()))
      .filter(Boolean)
    rawCandidates.push(
      ...buildParentCandidatesForCluster({
        cluster,
        donors: clusterDonors,
        qualifiedCandidates: qualifiedCandidates?.candidates ?? [],
      }),
    )
  }

  const evaluated = rawCandidates.map((candidate) => {
    const term = {
      termId: `PARENT_${candidate.candidateId}`,
      role: "parent_lift",
      weight: 2,
      label: `${candidate.clusterId}:${candidate.sourceKind}`,
      ruleTokens: uniqueSorted(candidate.ruleTokens),
      meta: {
        ...candidate.meta,
        clusterId: candidate.clusterId,
        sourceKind: candidate.sourceKind,
      },
    }
    const train = evaluateTerm({ term, rows: trainRows })
    const oos = evaluateTerm({ term, rows: oosRows })
    return {
      ...term,
      trainSummary: train.summary,
      oosSummary: oos.summary,
    }
  })

  const qualifiedTerms = evaluated
    .filter(
      (term) =>
        toNumber(term?.trainSummary?.selectedRowCount, 0) >= Number(minTrainSelectedRows) &&
        toNumber(term?.trainSummary?.precision, 0) >= Number(minTrainPrecision) &&
        toNumber(term?.trainSummary?.matchedDateCount, 0) >= Number(minTrainDates) &&
        toNumber(term?.trainSummary?.matchedMonthCount, 0) >= Number(minTrainMonths) &&
        toNumber(term?.trainSummary?.matchedFoldCount, 0) >= Number(minTrainFolds),
    )
    .sort((left, right) => {
      if (toNumber(right?.trainSummary?.matchedFoldCount, 0) !== toNumber(left?.trainSummary?.matchedFoldCount, 0)) {
        return toNumber(right?.trainSummary?.matchedFoldCount, 0) - toNumber(left?.trainSummary?.matchedFoldCount, 0)
      }
      if (toNumber(right?.trainSummary?.matchedMonthCount, 0) !== toNumber(left?.trainSummary?.matchedMonthCount, 0)) {
        return toNumber(right?.trainSummary?.matchedMonthCount, 0) - toNumber(left?.trainSummary?.matchedMonthCount, 0)
      }
      if (toNumber(right?.trainSummary?.matchedDateCount, 0) !== toNumber(left?.trainSummary?.matchedDateCount, 0)) {
        return toNumber(right?.trainSummary?.matchedDateCount, 0) - toNumber(left?.trainSummary?.matchedDateCount, 0)
      }
      if (toNumber(right?.trainSummary?.precision, 0) !== toNumber(left?.trainSummary?.precision, 0)) {
        return toNumber(right?.trainSummary?.precision, 0) - toNumber(left?.trainSummary?.precision, 0)
      }
      if (toNumber(right?.oosSummary?.matchedDateCount, 0) !== toNumber(left?.oosSummary?.matchedDateCount, 0)) {
        return toNumber(right?.oosSummary?.matchedDateCount, 0) - toNumber(left?.oosSummary?.matchedDateCount, 0)
      }
      return String(left?.termId ?? "").localeCompare(String(right?.termId ?? ""))
    })
    .slice(0, Math.max(1, Number(maxParentTerms) || 12))

  return {
    seedClusterIds,
    candidateCount: evaluated.length,
    qualifiedTermCount: qualifiedTerms.length,
    roleCounts: buildRoleCounts(qualifiedTerms),
    candidates: evaluated,
    qualifiedTerms,
    summary: {
      seedClusterIds,
      candidateCount: evaluated.length,
      qualifiedTermCount: qualifiedTerms.length,
      roleCounts: buildRoleCounts(qualifiedTerms),
      minTrainSelectedRows,
      minTrainDates,
      minTrainMonths,
      minTrainFolds,
      minTrainPrecision,
    },
  }
}
