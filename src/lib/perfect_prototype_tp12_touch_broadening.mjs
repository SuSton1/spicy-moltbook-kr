import { createHash } from "node:crypto"

const uniqueSorted = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const buildRowKey = (row) =>
  String(row?.rowKey ?? row?.sourceId ?? `${row?.symbol ?? "?"}:${row?.dateKey ?? "?"}`).trim()

const buildHashId = (prefix, values = []) => {
  const hash = createHash("sha1")
  hash.update(String(prefix ?? ""))
  for (const value of Array.isArray(values) ? values : []) {
    hash.update("")
    hash.update(String(value ?? ""))
  }
  return `${String(prefix ?? "ID").toUpperCase()}_${hash.digest("hex").slice(0, 12)}`
}

const tokenPriority = (token) => {
  const text = String(token ?? "")
  if (text.startsWith("tag:")) return 0
  if (text.startsWith("num:")) return 1
  return 2
}

const compareTokenFrequencyRows = (left, right) => {
  if (Number(right?.count ?? 0) !== Number(left?.count ?? 0)) {
    return Number(right?.count ?? 0) - Number(left?.count ?? 0)
  }
  if (tokenPriority(left?.token) !== tokenPriority(right?.token)) {
    return tokenPriority(left?.token) - tokenPriority(right?.token)
  }
  if (String(left?.token ?? "").length !== String(right?.token ?? "").length) {
    return String(left?.token ?? "").length - String(right?.token ?? "").length
  }
  return String(left?.token ?? "").localeCompare(String(right?.token ?? ""))
}

const buildTemporalSignature = ({ hitDates = [], hitMonths = [], hitFoldKeys = [] } = {}) => {
  const safeDates = uniqueSorted(hitDates)
  const safeMonths = uniqueSorted(
    hitMonths.length > 0 ? hitMonths : safeDates.map(buildMonthKey).filter(Boolean),
  )
  const safeFolds = uniqueSorted(hitFoldKeys)
  return [safeMonths.join("+"), String(safeDates.length), safeFolds.join("+")].join("::")
}

const intersectSorted = (left = [], right = []) => {
  const rightSet = new Set(uniqueSorted(right))
  return uniqueSorted(left).filter((value) => rightSet.has(value))
}

const buildDonorSignalDates = (donor) => {
  const oosDates = uniqueSorted(donor?.oos?.touchHitDates ?? [])
  if (oosDates.length > 0) return oosDates
  return uniqueSorted(donor?.train?.touchHitDates ?? [])
}

const buildDonorSignalMonths = (donor) => {
  const oosMonths = uniqueSorted(donor?.oos?.touchHitMonths ?? [])
  if (oosMonths.length > 0) return oosMonths
  return uniqueSorted(donor?.train?.touchHitMonths ?? [])
}

export const buildTp12TouchDonorManifest = ({
  trainRuleRows = [],
  oosRuleRows = [],
  minTrainHitDates = 3,
  minTrainHitCount = 3,
  maxTop1DateHitShare = 1,
} = {}) => {
  const trainRows = Array.isArray(trainRuleRows) ? trainRuleRows : []
  const oosById = new Map(
    (Array.isArray(oosRuleRows) ? oosRuleRows : []).map((row) => [String(row?.ruleId ?? "").trim(), row]),
  )
  const donors = trainRows
    .filter(
      (row) =>
        row?.touchZeroNegative === true &&
        Number(row?.touchHitCount ?? 0) >= Number(minTrainHitCount) &&
        Number(row?.touchMatchedDateCount ?? 0) >= Number(minTrainHitDates) &&
        Number(row?.touchTop1DateHitShare ?? 0) <= Number(maxTop1DateHitShare),
    )
    .map((row) => {
      const ruleId = String(row?.ruleId ?? "").trim()
      const oos = oosById.get(ruleId) ?? null
      const touchHitDates = uniqueSorted(row?.touchHitDates ?? [])
      const touchHitMonths = uniqueSorted(row?.touchHitMonths ?? touchHitDates.map(buildMonthKey).filter(Boolean))
      const touchHitFoldKeys = uniqueSorted(row?.touchHitFoldKeys ?? [])
      const oosHitDates = uniqueSorted(oos?.touchHitDates ?? [])
      const oosHitMonths = uniqueSorted(oos?.touchHitMonths ?? oosHitDates.map(buildMonthKey).filter(Boolean))
      const oosHitFoldKeys = uniqueSorted(oos?.touchHitFoldKeys ?? [])
      const oosZeroNegative = oos?.touchZeroNegative === true
      const oosPerfectDateFloor3 = oos?.touchPerfectDateFloor3 === true
      const donorKind = oosPerfectDateFloor3
        ? "oos_perfect_date_floor3"
        : oosZeroNegative
          ? "oos_zero_negative"
          : "train_zero_negative_only"
      return {
        ruleId,
        familyId: String(row?.familyId ?? "").trim() || null,
        tokens: uniqueSorted(row?.tokens ?? []),
        temporalSignature: buildTemporalSignature({
          hitDates: oosHitDates.length > 0 ? oosHitDates : touchHitDates,
          hitMonths: oosHitMonths.length > 0 ? oosHitMonths : touchHitMonths,
          hitFoldKeys: oosHitFoldKeys.length > 0 ? oosHitFoldKeys : touchHitFoldKeys,
        }),
        donorKind,
        train: {
          touchMatchCount: Number(row?.touchMatchCount ?? 0),
          touchHitCount: Number(row?.touchHitCount ?? 0),
          touchNegativeCount: Number(row?.touchNegativeCount ?? 0),
          touchPrecision: Number(row?.touchPrecision ?? 0),
          touchMatchedDateCount: Number(row?.touchMatchedDateCount ?? 0),
          touchMatchedMonthCount: Number(row?.touchMatchedMonthCount ?? 0),
          touchMatchedFoldCount: Number(row?.touchMatchedFoldCount ?? 0),
          touchTop1DateHitShare: Number(row?.touchTop1DateHitShare ?? 0),
          touchTop3DateHitShare: Number(row?.touchTop3DateHitShare ?? 0),
          touchHitDates,
          touchHitMonths,
          touchHitFoldKeys,
        },
        oos: oos
          ? {
              touchMatchCount: Number(oos?.touchMatchCount ?? 0),
              touchHitCount: Number(oos?.touchHitCount ?? 0),
              touchNegativeCount: Number(oos?.touchNegativeCount ?? 0),
              touchPrecision: Number(oos?.touchPrecision ?? 0),
              touchMatchedDateCount: Number(oos?.touchMatchedDateCount ?? 0),
              touchMatchedMonthCount: Number(oos?.touchMatchedMonthCount ?? 0),
              touchMatchedFoldCount: Number(oos?.touchMatchedFoldCount ?? 0),
              touchTop1DateHitShare: Number(oos?.touchTop1DateHitShare ?? 0),
              touchTop3DateHitShare: Number(oos?.touchTop3DateHitShare ?? 0),
              touchHitDates: oosHitDates,
              touchHitMonths: oosHitMonths,
              touchHitFoldKeys: oosHitFoldKeys,
              touchZeroNegative: oosZeroNegative,
              touchPerfectDateFloor3: oosPerfectDateFloor3,
            }
          : null,
      }
    })
    .filter((row) => row?.oos?.touchZeroNegative === true || row?.oos?.touchPerfectDateFloor3 === true)
    .sort((left, right) => {
      if (right.train.touchMatchedFoldCount !== left.train.touchMatchedFoldCount) {
        return right.train.touchMatchedFoldCount - left.train.touchMatchedFoldCount
      }
      if (right.train.touchMatchedMonthCount !== left.train.touchMatchedMonthCount) {
        return right.train.touchMatchedMonthCount - left.train.touchMatchedMonthCount
      }
      if (right.train.touchMatchedDateCount !== left.train.touchMatchedDateCount) {
        return right.train.touchMatchedDateCount - left.train.touchMatchedDateCount
      }
      if (right.train.touchPrecision !== left.train.touchPrecision) {
        return right.train.touchPrecision - left.train.touchPrecision
      }
      return left.ruleId.localeCompare(right.ruleId)
    })
  return {
    donorCount: donors.length,
    repeatedOosPerfectDonorCount: donors.filter((row) => row?.oos?.touchPerfectDateFloor3 === true).length,
    oosZeroNegativeDonorCount: donors.filter((row) => row?.oos?.touchZeroNegative === true).length,
    donors,
    donorRuleIds: donors.map((row) => row.ruleId),
  }
}

export const buildTp12TouchRuleClusters = ({ donors = [], minDateOverlap = 1 } = {}) => {
  const donorRows = Array.isArray(donors) ? donors : []
  const adjacency = new Map()
  for (const donor of donorRows) {
    adjacency.set(donor.ruleId, new Set())
  }
  for (let leftIndex = 0; leftIndex < donorRows.length; leftIndex += 1) {
    const left = donorRows[leftIndex]
    const leftDates = buildDonorSignalDates(left)
    for (let rightIndex = leftIndex + 1; rightIndex < donorRows.length; rightIndex += 1) {
      const right = donorRows[rightIndex]
      const overlapDates = intersectSorted(leftDates, buildDonorSignalDates(right))
      if (overlapDates.length < Number(minDateOverlap)) continue
      adjacency.get(left.ruleId)?.add(right.ruleId)
      adjacency.get(right.ruleId)?.add(left.ruleId)
    }
  }

  const donorById = new Map(donorRows.map((row) => [row.ruleId, row]))
  const visited = new Set()
  const clusters = []
  for (const donor of donorRows) {
    if (visited.has(donor.ruleId)) continue
    const queue = [donor.ruleId]
    const componentIds = []
    visited.add(donor.ruleId)
    while (queue.length > 0) {
      const ruleId = queue.shift()
      componentIds.push(ruleId)
      for (const neighborId of adjacency.get(ruleId) ?? []) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)
        queue.push(neighborId)
      }
    }
    const bucket = componentIds.map((ruleId) => donorById.get(ruleId)).filter(Boolean)
    const donorTokenSets = bucket.map((row) => new Set(uniqueSorted(row?.tokens ?? [])))
    const signalDates = uniqueSorted(bucket.flatMap((row) => buildDonorSignalDates(row)))
    const signalMonths = uniqueSorted(bucket.flatMap((row) => buildDonorSignalMonths(row)))
    const signalFoldKeys = uniqueSorted(
      bucket.flatMap((row) => uniqueSorted(row?.oos?.touchHitFoldKeys?.length ? row.oos.touchHitFoldKeys : row?.train?.touchHitFoldKeys ?? [])),
    )
    const sharedTokens = uniqueSorted(
      donorTokenSets.length > 0
        ? Array.from(donorTokenSets[0]).filter((token) => donorTokenSets.every((set) => set.has(token)))
        : [],
    )
    clusters.push({
      clusterId: buildHashId("TOUCH_CLUSTER", componentIds),
      temporalSignature: buildTemporalSignature({
        hitDates: signalDates,
        hitMonths: signalMonths,
        hitFoldKeys: signalFoldKeys,
      }),
      donorCount: bucket.length,
      donorRuleIds: componentIds.sort((left, right) => left.localeCompare(right)),
      signalDates,
      signalMonths,
      signalFoldKeys,
      sharedTokens,
    })
  }

  clusters.sort((left, right) => {
    if (right.donorCount !== left.donorCount) return right.donorCount - left.donorCount
    if (right.signalDates.length !== left.signalDates.length) return right.signalDates.length - left.signalDates.length
    return left.clusterId.localeCompare(right.clusterId)
  })
  return {
    clusterCount: clusters.length,
    multiDonorClusterCount: clusters.filter((row) => row.donorCount > 1).length,
    clusters,
  }
}

export const buildTp12TouchConsensusCandidates = ({
  donors = [],
  clusters = [],
  supportFractions = [1, 0.75, 0.5],
  minTokenCount = 2,
  maxTokenCount = 6,
} = {}) => {
  const donorById = new Map((Array.isArray(donors) ? donors : []).map((row) => [row.ruleId, row]))
  const candidates = []
  const seenTokenSignatures = new Set()
  for (const cluster of Array.isArray(clusters) ? clusters : []) {
    const clusterDonors = (Array.isArray(cluster?.donorRuleIds) ? cluster.donorRuleIds : [])
      .map((ruleId) => donorById.get(ruleId))
      .filter(Boolean)
    if (clusterDonors.length < 1) continue
    const tokenCounts = new Map()
    for (const donor of clusterDonors) {
      for (const token of uniqueSorted(donor?.tokens ?? [])) {
        tokenCounts.set(token, Number(tokenCounts.get(token) ?? 0) + 1)
      }
    }
    const rankedTokenRows = Array.from(tokenCounts.entries())
      .map(([token, count]) => ({ token, count }))
      .sort(compareTokenFrequencyRows)
    for (const supportFractionRaw of Array.isArray(supportFractions) ? supportFractions : []) {
      const supportFraction = Number(supportFractionRaw)
      if (!(supportFraction > 0 && supportFraction <= 1)) continue
      const supportRuleCount = Math.max(1, Math.ceil(clusterDonors.length * supportFraction))
      const tokens = rankedTokenRows
        .filter((row) => row.count >= supportRuleCount)
        .slice(0, Math.max(1, Math.floor(Number(maxTokenCount) || 6)))
        .map((row) => row.token)
      const uniqueTokens = uniqueSorted(tokens)
      if (uniqueTokens.length < Math.max(1, Math.floor(Number(minTokenCount) || 2))) continue
      const tokenSignature = uniqueTokens.join("")
      if (!tokenSignature || seenTokenSignatures.has(tokenSignature)) continue
      seenTokenSignatures.add(tokenSignature)
      candidates.push({
        candidateId: buildHashId("TOUCH_BROAD", [cluster.clusterId, supportFraction, ...uniqueTokens]),
        clusterId: cluster.clusterId,
        temporalSignature: cluster.temporalSignature,
        donorRuleIds: cluster.donorRuleIds,
        donorCount: cluster.donorCount,
        supportFraction,
        supportRuleCount,
        ruleTokens: uniqueTokens,
        donorSignalDates: cluster.signalDates,
        donorSignalMonths: cluster.signalMonths,
        donorSignalFoldKeys: cluster.signalFoldKeys,
        sharedTokens: uniqueSorted(cluster.sharedTokens ?? []),
      })
    }
  }
  return {
    candidateCount: candidates.length,
    candidates,
  }
}

const rowMatchesRule = (row, rule) => {
  const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(uniqueSorted(row?.categoricalTokens ?? []))
  return Array.isArray(rule?.ruleTokens) && rule.ruleTokens.every((token) => tokenSet.has(token))
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
    perfectDateFloor3: safeRows.length > 0 && negatives.length === 0 && positives.length >= 3 && hitDates.length >= 3,
  }
}

const evaluateUnion = ({ rows = [], rules = [] } = {}) => {
  const seen = new Set()
  const selectedRows = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!(Array.isArray(rules) ? rules : []).some((rule) => rowMatchesRule(row, rule))) continue
    const rowKey = buildRowKey(row)
    if (!rowKey || seen.has(rowKey)) continue
    seen.add(rowKey)
    selectedRows.push(row)
  }
  return {
    selectedRows,
    summary: summarizeSelectedRows(selectedRows),
  }
}

export const buildTp12TouchBroadeningCandidateRows = ({
  candidateRows = [],
  trainRows = [],
  oosRows = [],
} = {}) => {
  const evaluated = (Array.isArray(candidateRows) ? candidateRows : []).map((candidate) => {
    const trainSummary = summarizeSelectedRows((Array.isArray(trainRows) ? trainRows : []).filter((row) => rowMatchesRule(row, candidate)))
    const oosSummary = summarizeSelectedRows((Array.isArray(oosRows) ? oosRows : []).filter((row) => rowMatchesRule(row, candidate)))
    return {
      ...candidate,
      trainSummary,
      oosSummary,
      trainPromotableBreadth:
        Number(trainSummary?.matchedDateCount ?? 0) >= 10 &&
        Number(trainSummary?.matchedMonthCount ?? 0) >= 6 &&
        Number(trainSummary?.matchedFoldCount ?? 0) >= 4,
      oosZeroNegative: oosSummary?.zeroNegative === true,
      oosPerfectDateFloor3: oosSummary?.perfectDateFloor3 === true,
    }
  })
  return {
    candidateCount: evaluated.length,
    candidates: evaluated,
  }
}

export const buildTp12TouchBroadeningQualifiedCandidates = ({
  candidateRows = [],
  minTrainDates = 6,
  minTrainMonths = 4,
  minTrainFolds = 3,
  minTrainPrecision = 0.4,
  maxTrainTop1DateHitShare = 1,
} = {}) => {
  const qualified = (Array.isArray(candidateRows) ? candidateRows : [])
    .filter(
      (row) =>
        Number(row?.trainSummary?.matchedDateCount ?? 0) >= Number(minTrainDates) &&
        Number(row?.trainSummary?.matchedMonthCount ?? 0) >= Number(minTrainMonths) &&
        Number(row?.trainSummary?.matchedFoldCount ?? 0) >= Number(minTrainFolds) &&
        Number(row?.trainSummary?.precision ?? 0) >= Number(minTrainPrecision) &&
        Number(row?.trainSummary?.top1DateHitShare ?? 0) <= Number(maxTrainTop1DateHitShare),
    )
    .sort(compareCandidates)
  return {
    candidateCount: qualified.length,
    promotableCandidateCount: qualified.filter((row) => row?.trainPromotableBreadth === true).length,
    oosZeroNegativeCandidateCount: qualified.filter((row) => row?.oosZeroNegative === true).length,
    oosPerfectDateFloor3CandidateCount: qualified.filter((row) => row?.oosPerfectDateFloor3 === true).length,
    candidates: qualified,
  }
}

const compareCandidates = (left, right) => {
  if (Number(right?.trainSummary?.matchedFoldCount ?? 0) !== Number(left?.trainSummary?.matchedFoldCount ?? 0)) {
    return Number(right?.trainSummary?.matchedFoldCount ?? 0) - Number(left?.trainSummary?.matchedFoldCount ?? 0)
  }
  if (Number(right?.trainSummary?.matchedMonthCount ?? 0) !== Number(left?.trainSummary?.matchedMonthCount ?? 0)) {
    return Number(right?.trainSummary?.matchedMonthCount ?? 0) - Number(left?.trainSummary?.matchedMonthCount ?? 0)
  }
  if (Number(right?.trainSummary?.matchedDateCount ?? 0) !== Number(left?.trainSummary?.matchedDateCount ?? 0)) {
    return Number(right?.trainSummary?.matchedDateCount ?? 0) - Number(left?.trainSummary?.matchedDateCount ?? 0)
  }
  if (Number(right?.trainSummary?.precision ?? 0) !== Number(left?.trainSummary?.precision ?? 0)) {
    return Number(right?.trainSummary?.precision ?? 0) - Number(left?.trainSummary?.precision ?? 0)
  }
  if (Number(left?.ruleTokens?.length ?? 0) !== Number(right?.ruleTokens?.length ?? 0)) {
    return Number(left?.ruleTokens?.length ?? 0) - Number(right?.ruleTokens?.length ?? 0)
  }
  return String(left?.candidateId ?? "").localeCompare(String(right?.candidateId ?? ""))
}

export const buildTp12TouchBroadeningUnionSelector = ({
  qualifiedCandidates = [],
  trainRows = [],
  oosRows = [],
  maxRules = 6,
  minUnionTrainPrecision = 0.3,
} = {}) => {
  const rankedCandidates = (Array.isArray(qualifiedCandidates) ? qualifiedCandidates : []).slice().sort(compareCandidates)
  const selectedRules = []
  let currentTrain = evaluateUnion({ rows: trainRows, rules: [] })
  for (const candidate of rankedCandidates) {
    if (selectedRules.length >= Number(maxRules)) break
    const nextRules = [...selectedRules, candidate]
    const nextTrain = evaluateUnion({ rows: trainRows, rules: nextRules })
    const improvement =
      Number(nextTrain.summary.matchedDateCount ?? 0) > Number(currentTrain.summary.matchedDateCount ?? 0) ||
      Number(nextTrain.summary.matchedMonthCount ?? 0) > Number(currentTrain.summary.matchedMonthCount ?? 0) ||
      Number(nextTrain.summary.matchedFoldCount ?? 0) > Number(currentTrain.summary.matchedFoldCount ?? 0) ||
      Number(nextTrain.summary.positiveRowCount ?? 0) > Number(currentTrain.summary.positiveRowCount ?? 0)
    if (!improvement) continue
    if (Number(nextTrain.summary.precision ?? 0) < Number(minUnionTrainPrecision)) continue
    selectedRules.push(candidate)
    currentTrain = nextTrain
  }
  const trainUnion = evaluateUnion({ rows: trainRows, rules: selectedRules })
  const oosUnion = evaluateUnion({ rows: oosRows, rules: selectedRules })
  const trainPromotable =
    Number(trainUnion.summary.matchedDateCount ?? 0) >= 10 &&
    Number(trainUnion.summary.matchedMonthCount ?? 0) >= 6 &&
    Number(trainUnion.summary.matchedFoldCount ?? 0) >= 4
  return {
    selectedRuleCount: selectedRules.length,
    selectedRules,
    selectedRuleIds: uniqueSorted(selectedRules.map((row) => row?.candidateId)),
    unionTrainSummary: trainUnion.summary,
    unionOosSummary: oosUnion.summary,
    unionTrainPromotableBreadth: trainPromotable,
    unionOosZeroNegative: oosUnion.summary?.zeroNegative === true,
    unionOosPerfectDateFloor3: oosUnion.summary?.perfectDateFloor3 === true,
  }
}

export const buildTp12TouchBroadeningVerdict = ({
  baselineOosLineSummary = {},
  qualifiedCandidateCount = 0,
  qualifiedPromotableCandidateCount = 0,
  unionSelector = {},
} = {}) => {
  const unionTrainPromotableBreadth = unionSelector?.unionTrainPromotableBreadth === true
  const unionHitRate = Number(unionSelector?.unionOosSummary?.precision ?? 0)
  const baselineHitRate = Number(baselineOosLineSummary?.hitRate ?? baselineOosLineSummary?.precision ?? 0)
  if (Number(qualifiedCandidateCount) < 1) {
    return {
      code: "no_viable_broadened_candidates",
      message: "Consensus broadening did not produce any train-qualified touch candidates.",
    }
  }
  if (unionTrainPromotableBreadth || Number(qualifiedPromotableCandidateCount) > 0) {
    return {
      code: "broadening_reaches_train_promotable_breadth",
      message: "Consensus broadening creates at least one train-promotable touch candidate or union.",
    }
  }
  if (Number(unionSelector?.selectedRuleCount ?? 0) > 0 && unionHitRate > baselineHitRate) {
    return {
      code: "broadening_improves_oos_line_only",
      message: "Consensus broadening improves OOS touch line hit-rate, but train-promotable breadth is still absent.",
    }
  }
  return {
    code: "broadening_inconclusive",
    message: "Consensus broadening produced candidates, but neither train-promotable breadth nor OOS line improvement cleared the gate.",
  }
}
