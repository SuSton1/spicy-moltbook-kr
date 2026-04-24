import path from "node:path"

import { ensureDir, writeJson } from "./io.mjs"
import {
  createJsonlWriteStreamMaybeGzip,
  iterateJsonlMaybeGzip,
  toNumber,
  toText,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"
import {
  assertNoForbiddenExpressionFields,
  expressionLimitsFromContract,
  loadTp12Train100NeutralContract,
  outputPathFromContract,
  targetFromContract,
} from "./tp12_train100_neutral_search_guards.mjs"
import {
  evaluateExpressionSupport,
  loadTp12Train100NeutralEventRows,
  readNeutralAtomCatalog,
  summarizeSupportRows,
} from "./tp12_train100_neutral_atom_bitsets.mjs"

const loadPatternRows = async (patternsPath) => {
  const rows = []
  await iterateJsonlMaybeGzip(patternsPath, {
    strict: true,
    onRow: async (row) => rows.push(row),
  })
  return rows
}

const featureFamiliesForExpression = (pattern, atomById) => {
  const atoms = [
    ...(pattern.anchorAtoms ?? []),
    ...(pattern.vetoClauses ?? []).flatMap((clause) => clause.atoms ?? []),
  ]
  return [...new Set(atoms.map((atomId) => toText(atomById.get(atomId)?.family)).filter(Boolean))].sort()
}

const rejectReasonsForVerified = ({ support, pattern, contract, atomById }) => {
  const target = targetFromContract(contract)
  const limits = expressionLimitsFromContract(contract)
  const quality = contract.qualityGates ?? {}
  const reasons = []
  if (!Array.isArray(pattern.anchorAtoms) || pattern.anchorAtoms.length < 1) reasons.push("missing_anchor_atoms")
  if ((pattern.anchorAtoms ?? []).length > limits.maxAnchorAtoms) reasons.push("anchor_atom_count_above_max")
  const vetoClauses = Array.isArray(pattern.vetoClauses) ? pattern.vetoClauses : []
  if (vetoClauses.length > limits.maxVetoClauses) reasons.push("veto_clause_count_above_max")
  for (const clause of vetoClauses) {
    if (!Array.isArray(clause.atoms) || clause.atoms.length < 1) reasons.push("empty_veto_clause")
    if ((clause.atoms ?? []).length > limits.maxVetoAtomsPerClause) reasons.push("veto_clause_atom_count_above_max")
  }
  const totalAtoms = (pattern.anchorAtoms ?? []).length + vetoClauses.reduce((sum, clause) => sum + (clause.atoms ?? []).length, 0)
  if (totalAtoms > limits.maxTotalAtoms) reasons.push("total_atom_count_above_max")
  if (support.falsePositiveRowCount !== target.requireFalsePositiveRows) reasons.push("false_positive_rows_not_zero")
  if (support.trainPrecision !== target.requireTrainPrecision) reasons.push("train_precision_not_one")
  if (support.positiveSymbolDates < target.minTotalPositiveSymbolDates) reasons.push("positive_symbol_dates_below_min_total")
  for (const year of Object.keys(support.yearHitDecisionDates)) {
    if (support.yearHitDecisionDates[year] < target.minHitDecisionDatesPerYear) reasons.push(`year_${year}_hit_decision_dates_below_min`)
    if (support.yearHitSymbolDates[year] < target.minHitSymbolDatesPerYear) reasons.push(`year_${year}_hit_symbol_dates_below_min`)
  }
  if (support.activeMonths < Math.trunc(toNumber(quality.minActiveMonths, 12))) reasons.push("active_months_below_min")
  if (support.topSymbolShare > toNumber(quality.maxTopSymbolShare, 0.15)) reasons.push("top_symbol_share_above_max")
  if (support.topMonthShare > toNumber(quality.maxTopMonthShare, 0.2)) reasons.push("top_month_share_above_max")
  if (featureFamiliesForExpression(pattern, atomById).length < Math.trunc(toNumber(quality.minFeatureFamilyCount, 2))) {
    reasons.push("feature_family_count_below_min")
  }
  if (pattern.oosRead === true) reasons.push("pattern_oos_read_true")
  return reasons
}

export const evaluateTp12Train100NeutralExpression = ({ pattern, atomById, eventRows, contract }) => {
  assertNoForbiddenExpressionFields(pattern, contract, "neutralPattern")
  const finalRowIds = evaluateExpressionSupport({
    atomById,
    anchorAtoms: pattern.anchorAtoms ?? [],
    vetoClauses: pattern.vetoClauses ?? [],
  })
  const support = summarizeSupportRows(finalRowIds, eventRows)
  const featureFamilies = featureFamiliesForExpression(pattern, atomById)
  const rejectReasons = rejectReasonsForVerified({ support, pattern, contract, atomById })
  return {
    finalRowIds,
    support,
    featureFamilies,
    rejectReasons,
    passed: rejectReasons.length === 0,
  }
}

export const verifyTp12Train100NeutralSurvivors = async ({
  contractPath,
  patternsPath = "",
  atomCatalogPath = "",
  eventsPath = "",
  outSummaryPath = "",
  outSurvivorsPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100NeutralContract(contractPath, { cwd })
  const inputPatternsPath = patternsPath ? path.resolve(cwd, patternsPath) : outputPathFromContract(cwd, contract, "foundPatterns")
  const inputAtomCatalogPath = atomCatalogPath ? path.resolve(cwd, atomCatalogPath) : outputPathFromContract(cwd, contract, "neutralAtomCatalog")
  const atoms = await readNeutralAtomCatalog(inputAtomCatalogPath)
  const sourceEventsPath = eventsPath || atoms[0]?.sourceEventRowsPath
  if (!sourceEventsPath) throw new Error("eventsPath is required for neutral survivor verification")
  const eventRows = await loadTp12Train100NeutralEventRows(path.resolve(cwd, sourceEventsPath), contract)
  const patterns = await loadPatternRows(inputPatternsPath)
  const atomById = new Map(atoms.map((atom) => [atom.atomId, atom]))
  const outputSummaryPath = outputPathFromContract(cwd, contract, "survivorVerifierSummary", outSummaryPath)
  const outputSurvivorsPath = outputPathFromContract(cwd, contract, "verifiedSurvivors", outSurvivorsPath)

  await ensureDir(path.dirname(outputSurvivorsPath))
  const writer = createJsonlWriteStreamMaybeGzip(outputSurvivorsPath)
  const rejectReasonCounts = new Map()
  let verifiedPatternCount = 0
  let rejectedPatternCount = 0
  try {
    for (const pattern of patterns) {
      const result = evaluateTp12Train100NeutralExpression({ pattern, atomById, eventRows, contract })
      if (!result.passed) {
        rejectedPatternCount += 1
        for (const reason of result.rejectReasons) rejectReasonCounts.set(reason, (rejectReasonCounts.get(reason) ?? 0) + 1)
        continue
      }
      verifiedPatternCount += 1
      await writeJsonlRow(writer.stream, {
        ...pattern,
        kind: "tp12_train100_neutral_verified_survivor_v1",
        verificationPatchKey: contract.patchKey,
        verificationComplete: true,
        matchedRowIds: result.finalRowIds,
        ...result.support,
        featureFamilies: result.featureFamilies,
        thresholdCoarsenessPassed: true,
        asOfViolationCount: 0,
        forbiddenFieldViolationCount: 0,
        oosRead: false,
      })
    }
  } finally {
    await writer.close()
  }

  const summary = {
    kind: "tp12_train100_neutral_survivor_verifier_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    contractPath: resolvedContractPath,
    patternsPath: inputPatternsPath,
    atomCatalogPath: inputAtomCatalogPath,
    eventsPath: path.resolve(cwd, sourceEventsPath),
    status: "passed",
    inputPatternCount: patterns.length,
    verifiedPatternCount,
    rejectedPatternCount,
    rejectReasonCounts: Object.fromEntries([...rejectReasonCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    oosRead: false,
    fallbackUsed: false,
  }
  await writeJson(outputSummaryPath, summary)
  return summary
}

