const DEFAULT_ROLE_SPECS = Object.freeze({
  donor_exact: Object.freeze({ weight: 3, maxSelected: 2 }),
  cluster_any: Object.freeze({ weight: 2, maxSelected: 2 }),
  broadened_rule: Object.freeze({ weight: 2, maxSelected: 2 }),
  parent_lift: Object.freeze({ weight: 2, maxSelected: 3 }),
})

const uniqueSorted = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const buildRowKey = (row) =>
  String(row?.rowKey ?? row?.sourceId ?? `${row?.symbol ?? "?"}:${row?.dateKey ?? "?"}`).trim()

const normalizeRoleCaps = (roleCaps = {}) => ({
  donor_exact: Math.max(0, Math.floor(Number(roleCaps?.donor_exact ?? DEFAULT_ROLE_SPECS.donor_exact.maxSelected))),
  cluster_any: Math.max(0, Math.floor(Number(roleCaps?.cluster_any ?? DEFAULT_ROLE_SPECS.cluster_any.maxSelected))),
  broadened_rule: Math.max(
    0,
    Math.floor(Number(roleCaps?.broadened_rule ?? DEFAULT_ROLE_SPECS.broadened_rule.maxSelected)),
  ),
  parent_lift: Math.max(0, Math.floor(Number(roleCaps?.parent_lift ?? DEFAULT_ROLE_SPECS.parent_lift.maxSelected))),
})

const buildTokenSet = (row) =>
  row?.tokenSet instanceof Set
    ? row.tokenSet
    : new Set(
        uniqueSorted([
          ...(Array.isArray(row?.categoricalTokens) ? row.categoricalTokens : []),
          ...(Array.isArray(row?.contextualTokens) ? row.contextualTokens : []),
          ...(Array.isArray(row?.tokens) ? row.tokens : []),
        ]),
      )

const rowMatchesTokens = (row, tokens = []) => {
  const tokenSet = buildTokenSet(row)
  return uniqueSorted(tokens).every((token) => tokenSet.has(token))
}

const termMatchesRow = (term, row, donorLookup = new Map()) => {
  if (term?.role === "cluster_any") {
    const clusterRuleTokensList = Array.isArray(term?.clusterRuleTokensList) ? term.clusterRuleTokensList : []
    if (clusterRuleTokensList.length > 0) {
      return clusterRuleTokensList.some((tokens) => rowMatchesTokens(row, tokens))
    }
    return (Array.isArray(term?.donorRuleIds) ? term.donorRuleIds : []).some((ruleId) => {
      const donor = donorLookup.get(String(ruleId ?? "").trim())
      return donor ? rowMatchesTokens(row, donor.tokens) : false
    })
  }
  return rowMatchesTokens(row, term?.ruleTokens ?? [])
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
    topDateCounts.set(dateKey, Number(topDateCounts.get(dateKey) ?? 0) + 1)
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
    perfectDateFloor3:
      safeRows.length > 0 && negatives.length === 0 && positives.length >= 3 && hitDates.length >= 3,
  }
}

const rankDonors = (left, right) => {
  if (Number(right?.oos?.touchPerfectDateFloor3 === true) !== Number(left?.oos?.touchPerfectDateFloor3 === true)) {
    return Number(right?.oos?.touchPerfectDateFloor3 === true) - Number(left?.oos?.touchPerfectDateFloor3 === true)
  }
  if (Number(right?.oos?.touchZeroNegative === true) !== Number(left?.oos?.touchZeroNegative === true)) {
    return Number(right?.oos?.touchZeroNegative === true) - Number(left?.oos?.touchZeroNegative === true)
  }
  if (toNumber(right?.train?.touchMatchedFoldCount, 0) !== toNumber(left?.train?.touchMatchedFoldCount, 0)) {
    return toNumber(right?.train?.touchMatchedFoldCount, 0) - toNumber(left?.train?.touchMatchedFoldCount, 0)
  }
  if (toNumber(right?.train?.touchMatchedMonthCount, 0) !== toNumber(left?.train?.touchMatchedMonthCount, 0)) {
    return toNumber(right?.train?.touchMatchedMonthCount, 0) - toNumber(left?.train?.touchMatchedMonthCount, 0)
  }
  if (toNumber(right?.train?.touchMatchedDateCount, 0) !== toNumber(left?.train?.touchMatchedDateCount, 0)) {
    return toNumber(right?.train?.touchMatchedDateCount, 0) - toNumber(left?.train?.touchMatchedDateCount, 0)
  }
  if (toNumber(right?.train?.touchPrecision, 0) !== toNumber(left?.train?.touchPrecision, 0)) {
    return toNumber(right?.train?.touchPrecision, 0) - toNumber(left?.train?.touchPrecision, 0)
  }
  return String(left?.ruleId ?? "").localeCompare(String(right?.ruleId ?? ""))
}

const rankClusters = (left, right) => {
  if (toNumber(right?.donorCount, 0) !== toNumber(left?.donorCount, 0)) {
    return toNumber(right?.donorCount, 0) - toNumber(left?.donorCount, 0)
  }
  if ((right?.signalDates?.length ?? 0) !== (left?.signalDates?.length ?? 0)) {
    return (right?.signalDates?.length ?? 0) - (left?.signalDates?.length ?? 0)
  }
  return String(left?.clusterId ?? "").localeCompare(String(right?.clusterId ?? ""))
}

const rankCandidates = (left, right) => {
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
  return String(left?.candidateId ?? "").localeCompare(String(right?.candidateId ?? ""))
}

const evaluateTermSelection = ({ term, rows = [], donorLookup = new Map() } = {}) => {
  const selectedRows = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!termMatchesRow(term, row, donorLookup)) continue
    selectedRows.push(row)
  }
  return {
    selectedRows,
    summary: summarizeSelectedRows(selectedRows),
  }
}

const buildTerm = ({
  role,
  weight,
  termId,
  label,
  donorRuleIds = [],
  ruleTokens = [],
  clusterRuleTokensList = [],
  meta = {},
} = {}) => ({
  termId,
  role,
  weight,
  label,
  donorRuleIds: uniqueSorted(donorRuleIds),
  ruleTokens: uniqueSorted(ruleTokens),
  clusterRuleTokensList: (Array.isArray(clusterRuleTokensList) ? clusterRuleTokensList : []).map((tokens) => uniqueSorted(tokens)),
  meta,
})

const buildObjective = ({ summary = {}, totalRows = 0, baseRate = 0 } = {}) => {
  const selectedRatio = totalRows > 0 ? toNumber(summary?.selectedRowCount, 0) / totalRows : 0
  const precision = toNumber(summary?.precision, 0)
  return {
    wracc: selectedRatio * (precision - baseRate),
    selectedRatio,
  }
}

const buildSolutionPreview = (solution) => ({
  valid: solution?.valid === true,
  termCount: toNumber(solution?.termCount, 0),
  threshold: toNumber(solution?.threshold, 0),
  selectedTermIds: (solution?.artifact?.terms ?? []).map((term) => term?.termId).filter(Boolean),
  roleCounts: solution?.roleCounts ?? {},
  trainSummary: solution?.trainSummary ?? {},
  trainObjective: solution?.trainObjective ?? {},
})

const compareSolutions = (left, right) => {
  if ((left?.valid === true) !== (right?.valid === true)) return left?.valid === true ? -1 : 1
  if (toNumber(right?.trainSummary?.matchedFoldCount, 0) !== toNumber(left?.trainSummary?.matchedFoldCount, 0)) {
    return toNumber(right?.trainSummary?.matchedFoldCount, 0) - toNumber(left?.trainSummary?.matchedFoldCount, 0)
  }
  if (toNumber(right?.trainSummary?.matchedMonthCount, 0) !== toNumber(left?.trainSummary?.matchedMonthCount, 0)) {
    return toNumber(right?.trainSummary?.matchedMonthCount, 0) - toNumber(left?.trainSummary?.matchedMonthCount, 0)
  }
  if (toNumber(right?.trainSummary?.matchedDateCount, 0) !== toNumber(left?.trainSummary?.matchedDateCount, 0)) {
    return toNumber(right?.trainSummary?.matchedDateCount, 0) - toNumber(left?.trainSummary?.matchedDateCount, 0)
  }
  if (toNumber(right?.trainObjective?.wracc, 0) !== toNumber(left?.trainObjective?.wracc, 0)) {
    return toNumber(right?.trainObjective?.wracc, 0) - toNumber(left?.trainObjective?.wracc, 0)
  }
  if (toNumber(right?.trainSummary?.precision, 0) !== toNumber(left?.trainSummary?.precision, 0)) {
    return toNumber(right?.trainSummary?.precision, 0) - toNumber(left?.trainSummary?.precision, 0)
  }
  if (toNumber(right?.trainSummary?.positiveRowCount, 0) !== toNumber(left?.trainSummary?.positiveRowCount, 0)) {
    return toNumber(right?.trainSummary?.positiveRowCount, 0) - toNumber(left?.trainSummary?.positiveRowCount, 0)
  }
  if (toNumber(right?.trainSummary?.selectedRowCount, 0) !== toNumber(left?.trainSummary?.selectedRowCount, 0)) {
    return toNumber(right?.trainSummary?.selectedRowCount, 0) - toNumber(left?.trainSummary?.selectedRowCount, 0)
  }
  if (toNumber(left?.trainSummary?.top1DateHitShare, 1) !== toNumber(right?.trainSummary?.top1DateHitShare, 1)) {
    return toNumber(left?.trainSummary?.top1DateHitShare, 1) - toNumber(right?.trainSummary?.top1DateHitShare, 1)
  }
  if (toNumber(left?.termCount, 0) !== toNumber(right?.termCount, 0)) {
    return toNumber(left?.termCount, 0) - toNumber(right?.termCount, 0)
  }
  return String(left?.solutionId ?? "").localeCompare(String(right?.solutionId ?? ""))
}

const buildRoleCounts = (terms = []) => {
  const out = {
    donor_exact: 0,
    cluster_any: 0,
    broadened_rule: 0,
    parent_lift: 0,
  }
  for (const term of Array.isArray(terms) ? terms : []) {
    const role = String(term?.role ?? "").trim()
    if (role in out) out[role] += 1
  }
  return out
}

export const buildTp12TouchBundleTermBank = ({
  donorManifest = {},
  donorClusters = {},
  qualifiedCandidates = {},
  trainRows = [],
  oosRows = [],
  maxDonorTerms = 12,
  maxClusterTerms = 6,
  maxCandidateTerms = 6,
  minTermTrainPrecision = 0.3,
  minTermTrainDates = 3,
} = {}) => {
  const donors = (Array.isArray(donorManifest?.donors) ? donorManifest.donors : []).slice().sort(rankDonors)
  const clusters = (Array.isArray(donorClusters?.clusters) ? donorClusters.clusters : []).slice().sort(rankClusters)
  const candidates = (Array.isArray(qualifiedCandidates?.candidates) ? qualifiedCandidates.candidates : [])
    .slice()
    .sort(rankCandidates)
  const donorLookup = new Map(donors.map((row) => [String(row?.ruleId ?? "").trim(), row]))

  const allTerms = []
  for (const donor of donors.slice(0, Math.max(0, Number(maxDonorTerms) || 0))) {
    allTerms.push(
      buildTerm({
        termId: `DONOR_${String(donor.ruleId).trim()}`,
        role: "donor_exact",
        weight: DEFAULT_ROLE_SPECS.donor_exact.weight,
        label: donor.ruleId,
        ruleTokens: donor.tokens,
        meta: {
          donorKind: donor.donorKind,
          familyId: donor.familyId,
        },
      }),
    )
  }
  for (const cluster of clusters.slice(0, Math.max(0, Number(maxClusterTerms) || 0))) {
    allTerms.push(
      buildTerm({
        termId: `CLUSTER_${String(cluster.clusterId).trim()}`,
        role: "cluster_any",
        weight: DEFAULT_ROLE_SPECS.cluster_any.weight,
        label: cluster.clusterId,
        donorRuleIds: cluster.donorRuleIds,
        clusterRuleTokensList: (Array.isArray(cluster.donorRuleIds) ? cluster.donorRuleIds : [])
          .map((ruleId) => donorLookup.get(String(ruleId ?? "").trim())?.tokens ?? [])
          .filter((tokens) => Array.isArray(tokens) && tokens.length > 0),
        meta: {
          donorCount: cluster.donorCount,
          temporalSignature: cluster.temporalSignature,
        },
      }),
    )
  }
  for (const candidate of candidates.slice(0, Math.max(0, Number(maxCandidateTerms) || 0))) {
    allTerms.push(
      buildTerm({
        termId: `BROAD_${String(candidate.candidateId).trim()}`,
        role: "broadened_rule",
        weight: DEFAULT_ROLE_SPECS.broadened_rule.weight,
        label: candidate.candidateId,
        ruleTokens: candidate.ruleTokens,
        meta: {
          clusterId: candidate.clusterId,
          donorCount: candidate.donorCount,
          supportFraction: candidate.supportFraction,
        },
      }),
    )
  }

  const evaluatedTerms = allTerms.map((term) => {
    const train = evaluateTermSelection({ term, rows: trainRows, donorLookup })
    const oos = evaluateTermSelection({ term, rows: oosRows, donorLookup })
    return {
      ...term,
      trainSummary: train.summary,
      oosSummary: oos.summary,
    }
  })

  const qualifiedTerms = evaluatedTerms.filter(
    (term) =>
      toNumber(term?.trainSummary?.positiveRowCount, 0) > 0 &&
      toNumber(term?.trainSummary?.precision, 0) >= Number(minTermTrainPrecision) &&
      toNumber(term?.trainSummary?.matchedDateCount, 0) >= Number(minTermTrainDates),
  )

  return {
    summary: {
      candidateTermCount: evaluatedTerms.length,
      qualifiedTermCount: qualifiedTerms.length,
      roleCounts: {
        donor_exact: evaluatedTerms.filter((term) => term.role === "donor_exact").length,
        cluster_any: evaluatedTerms.filter((term) => term.role === "cluster_any").length,
        broadened_rule: evaluatedTerms.filter((term) => term.role === "broadened_rule").length,
      },
      qualifiedRoleCounts: {
        donor_exact: qualifiedTerms.filter((term) => term.role === "donor_exact").length,
        cluster_any: qualifiedTerms.filter((term) => term.role === "cluster_any").length,
        broadened_rule: qualifiedTerms.filter((term) => term.role === "broadened_rule").length,
      },
    },
    allTerms: evaluatedTerms,
    qualifiedTerms: qualifiedTerms.slice().sort((left, right) => {
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
      return String(left?.termId ?? "").localeCompare(String(right?.termId ?? ""))
    }),
  }
}

export const scoreTp12TouchBundleRow = ({ artifact, row } = {}) => {
  const matchedTerms = []
  let score = 0
  for (const term of Array.isArray(artifact?.terms) ? artifact.terms : []) {
    if (!termMatchesRow(term, row, new Map())) continue
    matchedTerms.push(term.termId)
    score += toNumber(term?.weight, 0)
  }
  const threshold = Math.max(1, Math.floor(Number(artifact?.threshold) || 1))
  return {
    matchedTerms,
    score,
    selected: score >= threshold,
  }
}

export const applyTp12TouchBundleArtifact = ({ artifact, rows = [] } = {}) =>
  (Array.isArray(rows) ? rows : []).map((row) => ({
    row,
    ...scoreTp12TouchBundleRow({ artifact, row }),
  }))

export const summarizeTp12TouchBundleSelections = ({ evaluations = [] } = {}) => {
  const selectedRows = (Array.isArray(evaluations) ? evaluations : [])
    .filter((entry) => entry.selected === true)
    .map((entry) => entry.row)
  return summarizeSelectedRows(selectedRows)
}

const buildThresholdCandidates = (terms = []) => {
  const totalWeight = (Array.isArray(terms) ? terms : []).reduce(
    (sum, term) => sum + Math.max(1, Math.floor(Number(term?.weight) || 0)),
    0,
  )
  const out = []
  for (let threshold = 1; threshold <= Math.max(1, totalWeight); threshold += 1) {
    out.push(threshold)
  }
  return out
}

const evaluateTermSet = ({
  terms = [],
  trainRows = [],
  baseRate = 0,
  minTrainPrecision = 0.38,
  minTrainDates = 15,
  minTrainMonths = 8,
  minTrainFolds = 4,
  minSelectedRows = 60,
  maxTop1DateHitShare = 0.2,
} = {}) => {
  const thresholds = buildThresholdCandidates(terms)
  let best = null
  for (const threshold of thresholds) {
    const artifact = {
      threshold,
      terms: (Array.isArray(terms) ? terms : []).map((term) => ({ ...term })),
    }
    const trainEvaluations = applyTp12TouchBundleArtifact({ artifact, rows: trainRows })
    const trainSummary = summarizeTp12TouchBundleSelections({ evaluations: trainEvaluations })
    const trainObjective = buildObjective({ summary: trainSummary, totalRows: trainRows.length, baseRate })
    const valid =
      toNumber(trainSummary?.selectedRowCount, 0) >= Number(minSelectedRows) &&
      toNumber(trainSummary?.precision, 0) >= Number(minTrainPrecision) &&
      toNumber(trainSummary?.matchedDateCount, 0) >= Number(minTrainDates) &&
      toNumber(trainSummary?.matchedMonthCount, 0) >= Number(minTrainMonths) &&
      toNumber(trainSummary?.matchedFoldCount, 0) >= Number(minTrainFolds) &&
      toNumber(trainSummary?.top1DateHitShare, 0) <= Number(maxTop1DateHitShare)
    const candidate = {
      solutionId: uniqueSorted((terms ?? []).map((term) => term?.termId)).join("||"),
      valid,
      threshold,
      artifact,
      termCount: Array.isArray(terms) ? terms.length : 0,
      roleCounts: buildRoleCounts(terms),
      trainSummary,
      trainObjective,
    }
    if (!best || compareSolutions(candidate, best) < 0) {
      best = candidate
    }
  }
  return best
}

export const solveTp12TouchBundleScorecard = ({
  termBank = {},
  trainRows = [],
  maxSelectedTerms = 6,
  beamSize = 8,
  minTrainPrecision = 0.38,
  minTrainDates = 15,
  minTrainMonths = 8,
  minTrainFolds = 4,
  minSelectedRows = 60,
  maxTop1DateHitShare = 0.2,
  roleCaps = {},
} = {}) => {
  const qualifiedTerms = Array.isArray(termBank?.qualifiedTerms) ? termBank.qualifiedTerms : []
  if (qualifiedTerms.length < 1) {
    return {
      ok: false,
      reason: "no_qualified_touch_bundle_terms",
      candidatePreviewCount: 0,
      termBankSummary: termBank?.summary ?? {},
      triedSolutionCount: 0,
      topCandidates: [],
    }
  }
  const safeRoleCaps = normalizeRoleCaps(roleCaps)
  const baseRate =
    Array.isArray(trainRows) && trainRows.length > 0
      ? trainRows.filter((row) => row?.outcomeHitTarget === true).length / trainRows.length
      : 0
  const seen = new Set()
  const topCandidates = []
  let triedSolutionCount = 0
  let bestOverall = null
  let frontier = [{ terms: [] }]

  for (let depth = 1; depth <= Math.max(1, Number(maxSelectedTerms) || 1); depth += 1) {
    const nextFrontier = []
    for (const state of frontier) {
      const stateTermIds = new Set((state?.terms ?? []).map((term) => term.termId))
      const stateRoleCounts = buildRoleCounts(state?.terms ?? [])
      for (const term of qualifiedTerms) {
        if (stateTermIds.has(term.termId)) continue
        if (toNumber(stateRoleCounts?.[term.role], 0) >= toNumber(safeRoleCaps?.[term.role], 0)) continue
        const nextTerms = [...(state?.terms ?? []), term].sort((left, right) =>
          String(left?.termId ?? "").localeCompare(String(right?.termId ?? "")),
        )
        const key = nextTerms.map((entry) => entry.termId).join("||")
        if (!key || seen.has(key)) continue
        seen.add(key)
        const candidate = evaluateTermSet({
          terms: nextTerms,
          trainRows,
          baseRate,
          minTrainPrecision,
          minTrainDates,
          minTrainMonths,
          minTrainFolds,
          minSelectedRows,
          maxTop1DateHitShare,
        })
        triedSolutionCount += 1
        if (!candidate) continue
        if (topCandidates.length < 256) topCandidates.push(buildSolutionPreview(candidate))
        nextFrontier.push({ terms: nextTerms, candidate })
        if (!bestOverall || compareSolutions(candidate, bestOverall) < 0) {
          bestOverall = candidate
        }
      }
    }
    nextFrontier.sort((left, right) => compareSolutions(left.candidate, right.candidate))
    frontier = nextFrontier.slice(0, Math.max(1, Number(beamSize) || 1))
    if (frontier.length < 1) break
  }

  if (!bestOverall || bestOverall.valid !== true) {
    return {
      ok: false,
      reason: "no_feasible_touch_bundle_scorecard",
      candidatePreviewCount: topCandidates.length,
      termBankSummary: termBank?.summary ?? {},
      triedSolutionCount,
      topCandidates,
    }
  }

  return {
    ok: true,
    artifact: bestOverall.artifact,
    threshold: bestOverall.threshold,
    termCount: bestOverall.termCount,
    roleCounts: bestOverall.roleCounts,
    trainSummary: bestOverall.trainSummary,
    trainObjective: bestOverall.trainObjective,
    candidatePreviewCount: topCandidates.length,
    termBankSummary: termBank?.summary ?? {},
    triedSolutionCount,
    topCandidates,
  }
}

export const buildTp12TouchBundleVerdict = ({
  baselineOosLineSummary = {},
  solution = {},
  minVerdictOosSelectedRows = 60,
  minVerdictOosDates = 30,
} = {}) => {
  if (solution?.ok !== true) {
    return {
      code: "no_feasible_touch_scorecard_bundle",
      message: "No touch scorecard bundle cleared the train breadth, precision, and selected-row floors.",
    }
  }
  const baselineHitRate = toNumber(baselineOosLineSummary?.hitRate, 0)
  const oosSummary = solution?.oosSummary ?? {}
  if (
    toNumber(oosSummary?.selectedRowCount, 0) >= Number(minVerdictOosSelectedRows) &&
    toNumber(oosSummary?.matchedDateCount, 0) >= Number(minVerdictOosDates) &&
    toNumber(oosSummary?.precision, 0) > baselineHitRate
  ) {
    return {
      code: "coverage_adjusted_oos_lift",
      message: "Touch scorecard bundle lifts OOS hit-rate while keeping a meaningful selected-row and matched-date footprint.",
    }
  }
  if (toNumber(oosSummary?.precision, 0) > baselineHitRate) {
    return {
      code: "precision_only_tradeoff",
      message: "Touch scorecard bundle improves OOS hit-rate, but coverage remains below the required floor.",
    }
  }
  return {
    code: "no_oos_lift",
    message: "Touch scorecard bundle does not improve the OOS touch line beyond the baseline under the current coverage floors.",
  }
}
