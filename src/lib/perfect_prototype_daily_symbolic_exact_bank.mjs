import { buildPerfectPrototypeDailySymbolicMicrocardHypothesisCatalog } from "./perfect_prototype_feature_bank_contract.mjs"
import { summarizeRows, uniqueStrings } from "./perfect_prototype_daily_symbolic_common.mjs"

const rowTokens = (row) =>
  uniqueStrings([...(row?.categoricalTokens ?? []), ...Array.from(row?.tokenSet ?? [])].filter((token) => String(token).startsWith("sig.")))

const rowScore = (row, tokenLiftMap = new Map()) =>
  rowTokens(row).reduce((sum, token) => sum + Number(tokenLiftMap.get(token) ?? 0), 0)

const groupRowsByDate = (rows = []) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    const bucket = grouped.get(dateKey) ?? []
    bucket.push(row)
    grouped.set(dateKey, bucket)
  }
  return grouped
}

const uniqueDateSupport = (rows = [], tokenFilter = null) => {
  const support = new Map()
  for (const row of rows) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    for (const token of rowTokens(row)) {
      if (typeof tokenFilter === "function" && tokenFilter(token) !== true) continue
      const bucket = support.get(token) ?? new Set()
      bucket.add(dateKey)
      support.set(token, bucket)
    }
  }
  return support
}

const countNegativeRows = (rows = []) => rows.filter((row) => row?.outcomeHitTarget !== true).length

const belongsToMicroCard = (row, microCard) => {
  const cardTokens = Array.isArray(microCard?.seedTokens) ? microCard.seedTokens : []
  if (cardTokens.length < 1) return false
  const tokenSet = new Set(rowTokens(row))
  let matched = 0
  for (const token of cardTokens) {
    if (tokenSet.has(token)) matched += 1
  }
  return matched >= Math.max(1, Math.ceil(cardTokens.length / 2))
}

const pickTop1ByDate = (rows = [], tokenLiftMap = new Map()) =>
  Array.from(groupRowsByDate(rows).values()).map((bucket) =>
    bucket
      .slice()
      .sort(
        (left, right) =>
          rowScore(right, tokenLiftMap) - rowScore(left, tokenLiftMap) ||
          rowTokens(right).length - rowTokens(left).length ||
          String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
      )[0],
  )

const summarizeSelectedRows = (rows = []) => {
  const positives = rows.filter((row) => row?.outcomeHitTarget === true)
  const negatives = rows.filter((row) => row?.outcomeHitTarget !== true)
  return {
    selectedRowCount: rows.length,
    positiveRowCount: positives.length,
    negativeRowCount: negatives.length,
    precision: rows.length > 0 ? positives.length / rows.length : 0,
    trainMatchedDateCount: new Set(positives.map((row) => row?.dateKey).filter(Boolean)).size,
    trainMatchedMonthCount: new Set(positives.map((row) => row?.monthKey).filter(Boolean)).size,
    trainMatchedFoldCount: new Set(positives.map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
    crossfitNegativeWindowCount: new Set(negatives.map((row) => Number(row?.windowId ?? 0)).filter((value) => value > 0)).size,
  }
}

const compareCandidates = (left, right) => {
  const leftQualified = left?.ok === true ? 1 : 0
  const rightQualified = right?.ok === true ? 1 : 0
  if (rightQualified !== leftQualified) return rightQualified - leftQualified
  const leftPrecision = Number(left?.trainSummary?.precision ?? 0)
  const rightPrecision = Number(right?.trainSummary?.precision ?? 0)
  if (rightPrecision !== leftPrecision) return rightPrecision - leftPrecision
  const leftDates = Number(left?.trainSummary?.trainMatchedDateCount ?? 0)
  const rightDates = Number(right?.trainSummary?.trainMatchedDateCount ?? 0)
  if (rightDates !== leftDates) return rightDates - leftDates
  const leftOos = Number(left?.oosSummary?.openOosMatchCount ?? 0)
  const rightOos = Number(right?.oosSummary?.openOosMatchCount ?? 0)
  if (rightOos !== leftOos) return rightOos - leftOos
  return Number(left?.ruleTokens?.length ?? 0) - Number(right?.ruleTokens?.length ?? 0)
}

const primaryReasonFor = ({
  trainSummary,
  minTrainMatchedDates,
  minTrainMatchedMonths,
  minTrainMatchedFolds,
  maxCrossfitNegativeWindows,
  supportLeaveOneOutRecovered,
  oosSummary,
  minOosMatchCount,
} = {}) => {
  if (Number(trainSummary?.selectedRowCount ?? 0) < 1) return "unsat_symbolic_microcard_no_selections"
  if (Number(trainSummary?.precision ?? 0) < 1) return "unsat_symbolic_microcard_train_precision"
  if (Number(trainSummary?.trainMatchedDateCount ?? 0) < Number(minTrainMatchedDates ?? 10)) return "unsat_top1_query_train_breadth"
  if (Number(trainSummary?.trainMatchedMonthCount ?? 0) < Number(minTrainMatchedMonths ?? 6)) return "unsat_top1_query_train_breadth"
  if (Number(trainSummary?.trainMatchedFoldCount ?? 0) < Number(minTrainMatchedFolds ?? 4)) return "unsat_top1_query_train_breadth"
  if (Number(trainSummary?.crossfitNegativeWindowCount ?? 0) > Number(maxCrossfitNegativeWindows ?? 0)) {
    return "unsat_symbolic_microcard_crossfit_negative"
  }
  if (supportLeaveOneOutRecovered !== true) return "unsat_symbolic_microcard_support_recovery"
  if (Number(oosSummary?.openOosPrecision ?? 0) < 1) return "unsat_symbolic_microcard_oos_precision"
  if (Number(oosSummary?.openOosMatchCount ?? 0) < Number(minOosMatchCount ?? 3)) return "unsat_symbolic_microcard_oos_breadth"
  return null
}

const evaluateRule = ({
  family,
  microCard,
  ruleTokens = [],
  tokenLiftMap = new Map(),
  minTrainMatchedDates,
  minTrainMatchedMonths,
  minTrainMatchedFolds,
  maxCrossfitNegativeWindows,
  minOosMatchCount,
} = {}) => {
  const trainCandidates = (family?.gatedTrainRows ?? []).filter((row) => belongsToMicroCard(row, microCard))
  const matchedTrainRows = pickTop1ByDate(
    trainCandidates.filter((row) => ruleTokens.every((token) => rowTokens(row).includes(token))),
    tokenLiftMap,
  )
  const trainSummary = summarizeSelectedRows(matchedTrainRows)
  const supportMatchedRows = pickTop1ByDate(
    (family?.supportCaseViews ?? []).filter((row) => belongsToMicroCard(row, microCard) && ruleTokens.every((token) => rowTokens(row).includes(token))),
    tokenLiftMap,
  )
  const oosMatchedRows = pickTop1ByDate(
    (family?.oosRows ?? []).filter((row) => belongsToMicroCard(row, microCard) && ruleTokens.every((token) => rowTokens(row).includes(token))),
    tokenLiftMap,
  )
  const oosHits = oosMatchedRows.filter((row) => row?.outcomeHitTarget === true)
  const oosSummary = {
    openOosSelectedRowCount: oosMatchedRows.length,
    openOosHitCount: oosHits.length,
    openOosMatchCount: oosHits.length,
    openOosPrecision: oosMatchedRows.length > 0 ? oosHits.length / oosMatchedRows.length : 0,
    openOosUniqueMatchedDates: new Set(oosHits.map((row) => row?.dateKey).filter(Boolean)).size,
  }
  const supportLeaveOneOutRecovered = supportMatchedRows.length > 0
  const reason = primaryReasonFor({
    trainSummary,
    minTrainMatchedDates,
    minTrainMatchedMonths,
    minTrainMatchedFolds,
    maxCrossfitNegativeWindows,
    supportLeaveOneOutRecovered,
    oosSummary,
    minOosMatchCount,
  })
  return {
    ok: reason === null,
    reason,
    ruleTokens,
    microCardId: microCard?.microCardId ?? null,
    microCardSignature: microCard?.signature ?? null,
    trainSummary,
    oosSummary,
    supportLeaveOneOutRecovered,
    supportMatchedRows,
    matchedTrainRows,
  }
}

const hypothesisTokenFilter = (hypothesis, microCard) => {
  const prefixes = Array.isArray(hypothesis?.featurePrefixes) ? hypothesis.featurePrefixes : []
  const microCardSeedTokens = Array.isArray(microCard?.seedTokens) ? microCard.seedTokens : []
  return (token) =>
    microCardSeedTokens.includes(token) ||
    prefixes.some((prefix) => String(token ?? "").startsWith(prefix))
}

const tokenFamily = (token) => String(token ?? "").split(".").slice(0, 3).join(".")

const searchTokenRules = ({
  family,
  microCard,
  positiveRows = [],
  negativeRows = [],
  tokenLiftMap = new Map(),
  hypothesis,
  minTrainMatchedDates,
  minTrainMatchedMonths,
  minTrainMatchedFolds,
  maxCrossfitNegativeWindows,
  minOosMatchCount,
} = {}) => {
  const filterToken = hypothesisTokenFilter(hypothesis, microCard)
  const positiveSupport = uniqueDateSupport(positiveRows, filterToken)
  const negativeSupport = uniqueDateSupport(negativeRows, filterToken)
  const positiveDateCount = new Set(positiveRows.map((row) => row?.dateKey).filter(Boolean)).size
  const negativeDateCount = new Set(negativeRows.map((row) => row?.dateKey).filter(Boolean)).size
  const candidateTokens = uniqueStrings([...positiveSupport.keys()])
    .map((token) => ({
      token,
      positiveDateSupport: positiveSupport.get(token)?.size ?? 0,
      negativeDateSupport: negativeSupport.get(token)?.size ?? 0,
      lift:
        (positiveSupport.get(token)?.size ?? 0) / Math.max(1, positiveDateCount) -
        (negativeSupport.get(token)?.size ?? 0) / Math.max(1, negativeDateCount),
    }))
    .filter((entry) => entry.positiveDateSupport >= 2)
    .sort(
      (left, right) =>
        right.lift - left.lift ||
        right.positiveDateSupport - left.positiveDateSupport ||
        left.token.localeCompare(right.token),
    )
    .slice(0, 12)

  const candidates = []
  const evaluateAndMaybeRecurse = (ruleTokens, startIndex, usedFamilies = new Set()) => {
    const candidate = evaluateRule({
      family,
      microCard,
      ruleTokens,
      tokenLiftMap,
      minTrainMatchedDates,
      minTrainMatchedMonths,
      minTrainMatchedFolds,
      maxCrossfitNegativeWindows,
      minOosMatchCount,
    })
    candidates.push(candidate)
    if (ruleTokens.length >= 6) return
    if (candidate.trainSummary?.precision === 1 && candidate.trainSummary?.trainMatchedDateCount >= minTrainMatchedDates) return
    for (let index = startIndex; index < candidateTokens.length; index += 1) {
      const token = candidateTokens[index]?.token
      const familyKey = tokenFamily(token)
      if (!token || ruleTokens.includes(token)) continue
      if ([...usedFamilies].filter((entry) => entry === familyKey).length >= 2) continue
      const nextTokens = uniqueStrings([...ruleTokens, token])
      const nextCandidate = evaluateRule({
        family,
        microCard,
        ruleTokens: nextTokens,
        tokenLiftMap,
        minTrainMatchedDates,
        minTrainMatchedMonths,
        minTrainMatchedFolds,
        maxCrossfitNegativeWindows,
        minOosMatchCount,
      })
      candidates.push(nextCandidate)
      if (
        Number(nextCandidate?.trainSummary?.selectedRowCount ?? 0) > 0 &&
        Number(nextCandidate?.trainSummary?.negativeRowCount ?? 0) < Number(candidate?.trainSummary?.negativeRowCount ?? Infinity)
      ) {
        const nextFamilies = new Set([...usedFamilies, familyKey])
        evaluateAndMaybeRecurse(nextTokens, index + 1, nextFamilies)
      }
    }
  }

  for (let index = 0; index < Math.min(6, candidateTokens.length); index += 1) {
    const token = candidateTokens[index]?.token
    if (!token) continue
    evaluateAndMaybeRecurse([token], index + 1, new Set([tokenFamily(token)]))
  }
  candidates.sort(compareCandidates)
  return candidates
}

export const buildPerfectPrototypeDailySymbolicExactBank = ({
  family,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  maxCrossfitNegativeWindows = 0,
  minOosMatchCount = 3,
} = {}) => {
  const hypotheses = buildPerfectPrototypeDailySymbolicMicrocardHypothesisCatalog()
  const tokenLiftMap = family?.symbolicTokenLiftMap instanceof Map ? family.symbolicTokenLiftMap : new Map()
  const hypothesisResults = []

  for (const hypothesis of hypotheses) {
    const perCard = []
    for (const microCard of Array.isArray(family?.microCards) ? family.microCards : []) {
      const positiveRows = (family?.witnessRows ?? []).filter((row) => belongsToMicroCard(row, microCard))
      const negativeRows = (family?.witnessNegativeRows ?? []).filter((row) => belongsToMicroCard(row, microCard))
      const candidates = searchTokenRules({
        family,
        microCard,
        positiveRows,
        negativeRows,
        tokenLiftMap,
        hypothesis,
        minTrainMatchedDates,
        minTrainMatchedMonths,
        minTrainMatchedFolds,
        maxCrossfitNegativeWindows,
        minOosMatchCount,
      }).map((candidate) => ({
        ...candidate,
        hypothesisId: hypothesis.hypothesisId,
        hypothesisName: hypothesis.name,
        microCardId: microCard.microCardId,
        microCardSignature: microCard.signature,
      }))
      perCard.push({
        hypothesisId: hypothesis.hypothesisId,
        hypothesisName: hypothesis.name,
        microCardId: microCard.microCardId,
        microCardSignature: microCard.signature,
        candidateCount: candidates.length,
        qualifiedCandidateCount: candidates.filter((candidate) => candidate.ok === true).length,
        bestCandidate: candidates[0] ?? null,
        candidates,
      })
    }
    perCard.sort((left, right) => compareCandidates(left?.bestCandidate ?? {}, right?.bestCandidate ?? {}))
    hypothesisResults.push({
      hypothesisId: hypothesis.hypothesisId,
      hypothesisName: hypothesis.name,
      featurePrefixes: hypothesis.featurePrefixes,
      cards: perCard,
      bestCandidate: perCard[0]?.bestCandidate ?? null,
      ok: perCard.some((entry) => entry?.bestCandidate?.ok === true),
    })
  }

  hypothesisResults.sort((left, right) => compareCandidates(left?.bestCandidate ?? {}, right?.bestCandidate ?? {}))
  const qualified = hypothesisResults
    .flatMap((entry) => entry.cards.flatMap((card) => card.candidates.filter((candidate) => candidate.ok === true)))
    .sort(compareCandidates)
  const bestCandidate = qualified[0] ?? hypothesisResults[0]?.bestCandidate ?? null
  const ok = qualified.length > 0
  return {
    ...family,
    ok,
    reason: ok ? null : bestCandidate?.reason ?? "unsat_no_symbolic_exact_bank",
    symbolicHypothesisResults: hypothesisResults,
    symbolicExactRuleBank: qualified,
    summary: {
      ...(family?.summary ?? {}),
      symbolicHypothesisCount: hypothesisResults.length,
      symbolicHypothesisQualifiedCount: hypothesisResults.filter((entry) => entry.ok === true).length,
      symbolicRuleBankCandidateCount: hypothesisResults.reduce(
        (sum, entry) => sum + entry.cards.reduce((cardSum, card) => cardSum + Number(card?.candidateCount ?? 0), 0),
        0,
      ),
      qualifiedRuleCount: qualified.length,
      symbolicBestCandidate: bestCandidate
        ? {
            hypothesisId: bestCandidate.hypothesisId ?? null,
            microCardId: bestCandidate.microCardId ?? null,
            reason: bestCandidate.reason ?? null,
            ruleTokens: bestCandidate.ruleTokens ?? [],
            trainSummary: bestCandidate.trainSummary ?? null,
            oosSummary: bestCandidate.oosSummary ?? null,
            supportLeaveOneOutRecovered: bestCandidate.supportLeaveOneOutRecovered === true,
          }
        : null,
      symbolicHypothesisPreview: hypothesisResults.map((entry) => ({
        hypothesisId: entry.hypothesisId,
        hypothesisName: entry.hypothesisName,
        bestCandidate: entry.bestCandidate
          ? {
              microCardId: entry.bestCandidate.microCardId,
              reason: entry.bestCandidate.reason,
              precision: Number(entry.bestCandidate?.trainSummary?.precision ?? 0),
              trainMatchedDateCount: Number(entry.bestCandidate?.trainSummary?.trainMatchedDateCount ?? 0),
              candidateTokenCount: Number(entry.bestCandidate?.ruleTokens?.length ?? 0),
            }
          : null,
      })),
    },
  }
}
