import fs from "node:fs"
import path from "node:path"

import {
  loadTp12Train100UnsatCompletionContract,
  outputPathFromContract,
  readFrontierRows,
  readJsonRequired,
  supportHashBucket,
  toNumber,
  toText,
  writeFrontierRows,
  writeSummary,
} from "./tp12_train100_unsat_completion_common.mjs"

const shardPath = (rootDir, index) => path.join(rootDir, `shard_${String(index).padStart(3, "0")}_frontier.jsonl.gz`)
const shardManifestPath = (rootDir, index) => path.join(rootDir, `shard_${String(index).padStart(3, "0")}_plan.json`)

const blockedSummary = ({ contract, contractPath, inputSummary }) => ({
  kind: "tp12_train100_partitioned_completion_plan_v1",
  generatedAt: new Date().toISOString(),
  patchKey: contract.patchKey,
  status: "blocked_missing_frontier_source",
  contractPath,
  inputSummaryPath: inputSummary.path,
  inputStatus: inputSummary.payload?.status ?? null,
  oosRead: false,
  searchComplete: false,
  partitionCount: Math.max(1, Math.trunc(toNumber(contract?.completion?.partitionCount, 8))),
  shardCount: 0,
  sourceFrontierSize: Math.max(0, Math.trunc(toNumber(inputSummary.payload?.unresolvedFrontierCount, 0))),
  plannedFrontierSize: 0,
  unresolvedFrontierCount: Math.max(0, Math.trunc(toNumber(inputSummary.payload?.unresolvedFrontierCount, 0))),
  blockedReason: inputSummary.payload?.blockedReason ?? "missing_frontier_source",
  shards: [],
})

export const buildTp12Train100PartitionedCompletionPlan = async ({
  contractPath,
  frontierPath = "",
  boundsSummaryPath = "",
  outPlanPath = "",
  outShardDir = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100UnsatCompletionContract(contractPath, { cwd })
  const inputSummarySpec = toText(boundsSummaryPath) || toText(contract?.outputPaths?.unsatBoundsSummary)
  const inputSummary = await readJsonRequired(cwd, inputSummarySpec, "unsatBoundsSummary")
  const outputPlanPath = outputPathFromContract(cwd, contract, "partitionPlan", outPlanPath)
  const outputShardDir = path.resolve(cwd, toText(outShardDir) || toText(contract?.outputPaths?.partitionShardDir) || path.join(path.dirname(outputPlanPath), "shards"))

  if (inputSummary.payload?.status === "blocked_missing_frontier_source") {
    return writeSummary(outputPlanPath, blockedSummary({ contract, contractPath: resolvedContractPath, inputSummary }))
  }

  const sourceFrontierPath = toText(frontierPath) || toText(inputSummary.payload?.outFrontierPath) || toText(contract?.outputPaths?.boundsPrunedFrontier)
  const rows = await readFrontierRows(sourceFrontierPath)
  const partitionCount = Math.max(1, Math.trunc(toNumber(contract?.completion?.partitionCount, 8)))
  const shards = Array.from({ length: partitionCount }, (_, index) => ({
    index,
    rows: [],
    frontierPath: shardPath(outputShardDir, index),
    planPath: shardManifestPath(outputShardDir, index),
  }))
  for (const row of rows) {
    const index = supportHashBucket(row.supportHash, partitionCount)
    shards[index].rows.push(row)
  }
  const resumeCheckpointPath = toText(contract?.searchScope?.resumeCheckpointPath)
  const miningContractPath = toText(contract?.searchScope?.miningContractPath)
  const atomEventsPath = toText(contract?.searchScope?.atomEventsPath)
  const shardSummaries = []
  for (const shard of shards) {
    await writeFrontierRows(shard.frontierPath, shard.rows)
    const plan = {
      kind: "tp12_train100_partitioned_completion_shard_plan_v1",
      generatedAt: new Date().toISOString(),
      patchKey: contract.patchKey,
      shardIndex: shard.index,
      partitionCount,
      stateCount: shard.rows.length,
      frontierPath: shard.frontierPath,
      resumeCheckpointPath: resumeCheckpointPath ? path.resolve(cwd, resumeCheckpointPath) : null,
      miningContractPath: miningContractPath ? path.resolve(cwd, miningContractPath) : null,
      atomEventsPath: atomEventsPath ? path.resolve(cwd, atomEventsPath) : null,
      runnableWithExistingMiner: Boolean(resumeCheckpointPath && miningContractPath && atomEventsPath),
      maxAdditionalVisitedStates: Math.max(1, Math.trunc(toNumber(contract?.completion?.maxAdditionalVisitedStatesPerShard, 1000000))),
      maxCounterexampleScan: Math.max(1, Math.trunc(toNumber(contract?.completion?.maxCounterexampleScan, 1))),
      allowIncomplete: true,
      oosRead: false,
    }
    await writeSummary(shard.planPath, plan)
    shardSummaries.push({
      index: shard.index,
      stateCount: shard.rows.length,
      frontierPath: shard.frontierPath,
      planPath: shard.planPath,
      runnableWithExistingMiner: plan.runnableWithExistingMiner,
    })
  }
  const plannedFrontierSize = shardSummaries.reduce((sum, shard) => sum + shard.stateCount, 0)
  return writeSummary(outputPlanPath, {
    kind: "tp12_train100_partitioned_completion_plan_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    status: "planned",
    contractPath: resolvedContractPath,
    inputSummaryPath: inputSummary.path,
    inputFrontierPath: sourceFrontierPath,
    oosRead: false,
    searchComplete: false,
    partitionMethod: "support_hash_mod_v1",
    partitionCount,
    shardCount: shardSummaries.length,
    sourceFrontierSize: rows.length,
    plannedFrontierSize,
    unresolvedFrontierCount: plannedFrontierSize,
    allShardsRunnableWithExistingMiner: shardSummaries.every((shard) => shard.runnableWithExistingMiner),
    shardDir: outputShardDir,
    shards: shardSummaries,
  })
}

export const buildTp12Train100PartitionCompletionStatus = async ({
  contractPath,
  partitionReportPath = "",
  partitionPlanPath = "",
  outSummaryPath = "",
  cwd = process.cwd(),
} = {}) => {
  const { contract, contractPath: resolvedContractPath } = await loadTp12Train100UnsatCompletionContract(contractPath, { cwd })
  const outputPath = outputPathFromContract(cwd, contract, "partitionCompletionStatus", outSummaryPath)
  const planSpec = toText(partitionPlanPath) || toText(contract?.outputPaths?.partitionPlan)
  const plan = await readJsonRequired(cwd, planSpec, "partitionPlan")
  const reportSpec = toText(partitionReportPath) || toText(contract?.outputPaths?.partitionReport)
  let report = null
  if (reportSpec) {
    const resolvedReportPath = path.resolve(cwd, reportSpec)
    if (fs.existsSync(resolvedReportPath)) {
      report = await readJsonRequired(cwd, reportSpec, "partitionReport")
    }
  }
  const reportPayload = report?.payload ?? null
  const searchComplete = reportPayload?.searchComplete === true
  const acceptedCandidateCount = Math.max(0, Math.trunc(toNumber(reportPayload?.acceptedCandidateCount, 0)))
  const status = searchComplete ? "complete" : plan.payload?.status === "blocked_missing_frontier_source" ? "blocked_missing_frontier_source" : "incomplete"
  return writeSummary(outputPath, {
    kind: "tp12_train100_partition_completion_status_v1",
    generatedAt: new Date().toISOString(),
    patchKey: contract.patchKey,
    status,
    contractPath: resolvedContractPath,
    planPath: plan.path,
    reportPath: report?.path ?? null,
    oosRead: false,
    searchComplete,
    acceptedCandidateCount,
    remainingFrontierSize: Math.max(
      0,
      Math.trunc(toNumber(reportPayload?.remainingFrontierSize, plan.payload?.unresolvedFrontierCount ?? 0)),
    ),
    sourceFrontierSize: plan.payload?.sourceFrontierSize ?? null,
    plannedFrontierSize: plan.payload?.plannedFrontierSize ?? null,
    blockedReason: status === "blocked_missing_frontier_source" ? plan.payload?.blockedReason ?? "missing_frontier_source" : null,
  })
}
