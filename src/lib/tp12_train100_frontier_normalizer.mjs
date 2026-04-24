import fs from "node:fs"
import path from "node:path"

import { readJson } from "./io.mjs"
import {
  canonicalStateId,
  loadTp12Train100UnsatCompletionContract,
  outputPathFromContract,
  readFrontierRows,
  readJsonRequired,
  resolvePath,
  stateSummary,
  supportHashBucket,
  toText,
  toNumber,
  writeFrontierRows,
  writeSummary,
} from "./tp12_train100_unsat_completion_common.mjs"

const readCheckpoint = async (cwd, checkpointPath) => {
  const resolved = resolvePath(cwd, checkpointPath, "resumeCheckpointPath")
  const checkpoint = await readJson(resolved, null)
  if (!checkpoint) throw new Error(`resumeCheckpointPath is not readable JSON: ${resolved}`)
  if (checkpoint.kind !== "tp12_train100_counterexample_exact_completion_checkpoint_v1") {
    throw new Error(`invalid checkpoint kind: ${checkpoint.kind ?? "missing"}`)
  }
  if (checkpoint.oosRead === true) throw new Error("resume checkpoint has oosRead=true")
  const frontierPath = toText(checkpoint.frontierPath)
  if (!frontierPath) throw new Error(`checkpoint missing frontierPath: ${resolved}`)
  return { checkpointPath: resolved, checkpoint, frontierPath: path.resolve(frontierPath) }
}

const missingFrontierSummary = ({ contract, contractPath, closeoutPath, closeout, outFrontierPath }) => ({
  kind: "tp12_train100_frontier_normalization_summary_v1",
  generatedAt: new Date().toISOString(),
  patchKey: contract.patchKey,
  status: "blocked_missing_frontier_source",
  contractPath,
  sourceCloseoutSummaryPath: closeoutPath,
  checkpointPath: null,
  checkpointFrontierPath: null,
  sourceAvailable: false,
  oosRead: false,
  inputFrontierSize: Math.max(0, Math.trunc(toNumber(closeout?.remainingFrontierSize, 0))),
  outputFrontierSize: 0,
  duplicateStateCount: 0,
  emptyAtomStateCount: 0,
  missingSupportHashCount: 0,
  unresolvedFrontierCount: Math.max(0, Math.trunc(toNumber(closeout?.remainingFrontierSize, 0))),
  blockedReason: "missing_resume_checkpoint_or_frontier_sidecar",
  outFrontierPath,
})

export const normalizeTp12Train100Frontier = async ({
  contractPath,
  outFrontierPath = "",
  outSummaryPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100UnsatCompletionContract(contractPath, { cwd })
  const outputFrontierPath = outputPathFromContract(cwd, contract, "normalizedFrontier", outFrontierPath)
  const outputSummaryPath = outputPathFromContract(cwd, contract, "frontierNormalizationSummary", outSummaryPath)

  const closeoutSpec = toText(contract?.searchScope?.sourceCloseoutSummary)
  const { path: closeoutPath, payload: closeout } = closeoutSpec
    ? await readJsonRequired(cwd, closeoutSpec, "sourceCloseoutSummary")
    : { path: "", payload: null }

  const checkpointSpec = toText(contract?.searchScope?.resumeCheckpointPath)
  if (!checkpointSpec || !fs.existsSync(path.resolve(cwd, checkpointSpec))) {
    if (contract?.searchScope?.allowMissingFrontierSourceForCertificate !== true) {
      throw new Error(`resumeCheckpointPath is required and must exist for frontier normalization: ${checkpointSpec || "missing"}`)
    }
    await writeFrontierRows(outputFrontierPath, [])
    return writeSummary(
      outputSummaryPath,
      missingFrontierSummary({
        contract,
        contractPath: resolvedContractPath,
        closeoutPath,
        closeout,
        outFrontierPath: outputFrontierPath,
      }),
    )
  }

  const { checkpointPath: resolvedCheckpointPath, checkpoint, frontierPath } = await readCheckpoint(cwd, checkpointSpec)
  if (!fs.existsSync(frontierPath)) {
    if (contract?.searchScope?.allowMissingFrontierSourceForCertificate !== true) {
      throw new Error(`checkpoint frontierPath not found: ${frontierPath}`)
    }
    await writeFrontierRows(outputFrontierPath, [])
    return writeSummary(
      outputSummaryPath,
      missingFrontierSummary({
        contract,
        contractPath: resolvedContractPath,
        closeoutPath,
        closeout,
        outFrontierPath: outputFrontierPath,
      }),
    )
  }

  const partitionCount = Math.max(1, Math.trunc(toNumber(contract?.completion?.partitionCount, 1)))
  const rows = await readFrontierRows(frontierPath)
  const byId = new Map()
  let duplicateStateCount = 0
  for (const row of rows) {
    const id = canonicalStateId(row)
    if (byId.has(id)) {
      duplicateStateCount += 1
      continue
    }
    byId.set(id, {
      kind: "tp12_train100_normalized_frontier_state_v1",
      canonicalStateId: id,
      atomIds: row.atomIds,
      atomCount: row.atomIds.length,
      supportHash: row.supportHash,
      supportHashBucket: supportHashBucket(row.supportHash, partitionCount),
      sourceCheckpointPath: resolvedCheckpointPath,
    })
  }
  const normalizedRows = [...byId.values()].sort(
    (left, right) =>
      left.atomCount - right.atomCount ||
      left.supportHash.localeCompare(right.supportHash) ||
      left.canonicalStateId.localeCompare(right.canonicalStateId),
  )
  await writeFrontierRows(outputFrontierPath, normalizedRows)
  return writeSummary(outputSummaryPath, {
    kind: "tp12_train100_frontier_normalization_summary_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    status: "passed",
    contractPath: resolvedContractPath,
    sourceCloseoutSummaryPath: closeoutPath || null,
    checkpointPath: resolvedCheckpointPath,
    checkpointFrontierPath: frontierPath,
    sourceAvailable: true,
    oosRead: false,
    inputFrontierSize: rows.length,
    outputFrontierSize: normalizedRows.length,
    duplicateStateCount,
    emptyAtomStateCount: 0,
    missingSupportHashCount: 0,
    unresolvedFrontierCount: normalizedRows.length,
    checkpointFrontierSize: checkpoint.frontierSize ?? null,
    outFrontierPath: outputFrontierPath,
    ...stateSummary(normalizedRows),
  })
}
