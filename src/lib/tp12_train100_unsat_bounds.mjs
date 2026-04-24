import {
  loadTp12Train100UnsatCompletionContract,
  outputPathFromContract,
  readFrontierRows,
  readJsonRequired,
  stateSummary,
  toNumber,
  toText,
  writeFrontierRows,
  writeSummary,
} from "./tp12_train100_unsat_completion_common.mjs"

const blockedSummary = ({ contract, contractPath, inputSummary, outFrontierPath }) => ({
  kind: "tp12_train100_unsat_bounds_summary_v1",
  generatedAt: new Date().toISOString(),
  patchKey: contract.patchKey,
  status: "blocked_missing_frontier_source",
  contractPath,
  inputSummaryPath: inputSummary.path,
  inputStatus: inputSummary.payload?.status ?? null,
  oosRead: false,
  proofMode: "none_missing_frontier_source",
  inputFrontierSize: Math.max(0, Math.trunc(toNumber(inputSummary.payload?.unresolvedFrontierCount, 0))),
  outputFrontierSize: 0,
  certifiedPrunedCount: 0,
  pruneReasonCounts: {},
  unresolvedFrontierCount: Math.max(0, Math.trunc(toNumber(inputSummary.payload?.unresolvedFrontierCount, 0))),
  blockedReason: inputSummary.payload?.blockedReason ?? "missing_frontier_source",
  outFrontierPath,
})

const canPruneByBounds = ({ row, contract }) => {
  const reasons = []
  const target = contract.target ?? {}
  const maxPatternAtoms = Math.max(1, Math.trunc(toNumber(contract?.searchScope?.maxPatternAtoms ?? contract?.completion?.maxPatternAtoms, 7)))
  const atomCount = Math.trunc(toNumber(row.atomCount ?? row.atomIds?.length, 0))
  const falsePositiveRows = toNumber(row.falsePositiveRows, NaN)
  const hitRows = toNumber(row.hitRows, NaN)
  const minPositiveTotal = Math.max(18, Math.trunc(toNumber(target.minPositiveSymbolDatesTotal, 18)))
  if (row.canMeetYearGate === false) reasons.push("cannot_meet_year_gate")
  if (Number.isFinite(hitRows) && hitRows < minPositiveTotal) reasons.push("positive_symbol_dates_below_upper_bound")
  if (atomCount >= maxPatternAtoms && Number.isFinite(falsePositiveRows) && falsePositiveRows > 0) {
    reasons.push("max_pattern_atoms_reached_with_false_positives")
  }
  if (row.remainingAtomsCanEliminateNegatives === false) reasons.push("remaining_atoms_cannot_eliminate_negatives")
  return reasons
}

export const applyTp12Train100UnsatBounds = async ({
  contractPath,
  frontierPath = "",
  dominanceSummaryPath = "",
  outFrontierPath = "",
  outSummaryPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100UnsatCompletionContract(contractPath, { cwd })
  const inputSummarySpec = toText(dominanceSummaryPath) || toText(contract?.outputPaths?.dominancePruneSummary)
  const inputSummary = await readJsonRequired(cwd, inputSummarySpec, "dominancePruneSummary")
  const outputFrontierPath = outputPathFromContract(cwd, contract, "boundsPrunedFrontier", outFrontierPath)
  const outputSummaryPath = outputPathFromContract(cwd, contract, "unsatBoundsSummary", outSummaryPath)

  if (inputSummary.payload?.status === "blocked_missing_frontier_source") {
    await writeFrontierRows(outputFrontierPath, [])
    return writeSummary(outputSummaryPath, blockedSummary({ contract, contractPath: resolvedContractPath, inputSummary, outFrontierPath: outputFrontierPath }))
  }

  const sourceFrontierPath = toText(frontierPath) || toText(inputSummary.payload?.outFrontierPath) || toText(contract?.outputPaths?.dominancePrunedFrontier)
  const rows = await readFrontierRows(sourceFrontierPath)
  const outputRows = []
  const pruneReasonCounts = new Map()
  let certifiedPrunedCount = 0
  for (const row of rows) {
    const reasons = canPruneByBounds({ row, contract })
    if (reasons.length > 0) {
      certifiedPrunedCount += 1
      for (const reason of reasons) pruneReasonCounts.set(reason, (pruneReasonCounts.get(reason) ?? 0) + 1)
      continue
    }
    outputRows.push(row)
  }
  await writeFrontierRows(outputFrontierPath, outputRows)
  return writeSummary(outputSummaryPath, {
    kind: "tp12_train100_unsat_bounds_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    status: "passed",
    contractPath: resolvedContractPath,
    inputSummaryPath: inputSummary.path,
    inputFrontierPath: sourceFrontierPath,
    outFrontierPath: outputFrontierPath,
    oosRead: false,
    proofMode: "safe_bound_pruning_only_when_required_witness_fields_exist",
    inputFrontierSize: rows.length,
    outputFrontierSize: outputRows.length,
    certifiedPrunedCount,
    pruneReasonCounts: Object.fromEntries([...pruneReasonCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    unresolvedFrontierCount: outputRows.length,
    ...stateSummary(outputRows),
  })
}
