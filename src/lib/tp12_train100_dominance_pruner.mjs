import {
  canonicalStateId,
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
  kind: "tp12_train100_dominance_prune_summary_v1",
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
  exactDuplicatePrunedCount: 0,
  certifiedDominatedPrunedCount: 0,
  unresolvedFrontierCount: Math.max(0, Math.trunc(toNumber(inputSummary.payload?.unresolvedFrontierCount, 0))),
  blockedReason: inputSummary.payload?.blockedReason ?? "missing_frontier_source",
  outFrontierPath,
})

export const pruneTp12Train100FrontierDominance = async ({
  contractPath,
  frontierPath = "",
  normalizationSummaryPath = "",
  outFrontierPath = "",
  outSummaryPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100UnsatCompletionContract(contractPath, { cwd })
  const inputSummarySpec = toText(normalizationSummaryPath) || toText(contract?.outputPaths?.frontierNormalizationSummary)
  const inputSummary = await readJsonRequired(cwd, inputSummarySpec, "frontierNormalizationSummary")
  const outputFrontierPath = outputPathFromContract(cwd, contract, "dominancePrunedFrontier", outFrontierPath)
  const outputSummaryPath = outputPathFromContract(cwd, contract, "dominancePruneSummary", outSummaryPath)

  if (inputSummary.payload?.status === "blocked_missing_frontier_source" || inputSummary.payload?.sourceAvailable === false) {
    await writeFrontierRows(outputFrontierPath, [])
    return writeSummary(outputSummaryPath, blockedSummary({ contract, contractPath: resolvedContractPath, inputSummary, outFrontierPath: outputFrontierPath }))
  }

  const sourceFrontierPath = toText(frontierPath) || toText(inputSummary.payload?.outFrontierPath) || toText(contract?.outputPaths?.normalizedFrontier)
  const rows = await readFrontierRows(sourceFrontierPath)
  const byId = new Map()
  let exactDuplicatePrunedCount = 0
  for (const row of rows) {
    const id = canonicalStateId(row)
    if (byId.has(id)) {
      exactDuplicatePrunedCount += 1
      continue
    }
    byId.set(id, row)
  }

  // Certificate-grade dominance pruning requires support set inclusion data. The
  // checkpoint frontier sidecar only stores atomIds/supportHash, so this pass is
  // intentionally limited to exact duplicate states unless explicit dominance
  // witness fields are present in future frontier rows.
  const outputRows = [...byId.values()].sort(
    (left, right) =>
      Number(left.atomCount ?? left.atomIds.length) - Number(right.atomCount ?? right.atomIds.length) ||
      left.supportHash.localeCompare(right.supportHash) ||
      left.canonicalStateId.localeCompare(right.canonicalStateId),
  )
  await writeFrontierRows(outputFrontierPath, outputRows)
  return writeSummary(outputSummaryPath, {
    kind: "tp12_train100_dominance_prune_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    status: "passed",
    contractPath: resolvedContractPath,
    inputSummaryPath: inputSummary.path,
    inputFrontierPath: sourceFrontierPath,
    outFrontierPath: outputFrontierPath,
    oosRead: false,
    proofMode: "exact_duplicate_only_without_support_inclusion_witness",
    inputFrontierSize: rows.length,
    outputFrontierSize: outputRows.length,
    exactDuplicatePrunedCount,
    certifiedDominatedPrunedCount: 0,
    unresolvedFrontierCount: outputRows.length,
    ...stateSummary(outputRows),
  })
}
