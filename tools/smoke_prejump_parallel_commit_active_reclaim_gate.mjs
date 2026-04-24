import assert from "node:assert/strict"

import { classifyParallelBudgetRecoveryWindow } from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const main = async () => {
  const requestPending = classifyParallelBudgetRecoveryWindow({
    remainingBudgetHeadroom: 0,
    completedUnreclaimedSearchBudget: 0,
    activeSiblingReclaimableSearchBudget: 1,
    requiredDelta: 1,
    fallbackReason: "awaiting_budget_request_service",
  })
  assert.equal(requestPending.canRecover, true)
  assert.equal(requestPending.reason, "awaiting_active_chunk_reclaim")
  assert.equal(requestPending.totalRecoverableSearchBudget, 1)

  const commitPending = classifyParallelBudgetRecoveryWindow({
    remainingBudgetHeadroom: 0,
    completedUnreclaimedSearchBudget: 0,
    activeSiblingReclaimableSearchBudget: 24,
    requiredDelta: 24,
    fallbackReason: "awaiting_commit_budget_service",
  })
  assert.equal(commitPending.canRecover, true)
  assert.equal(commitPending.reason, "awaiting_active_chunk_reclaim")
  assert.equal(commitPending.totalRecoverableSearchBudget, 24)

  const combinedPending = classifyParallelBudgetRecoveryWindow({
    remainingBudgetHeadroom: 0,
    completedUnreclaimedSearchBudget: 11,
    activeSiblingReclaimableSearchBudget: 13,
    requiredDelta: 24,
    fallbackReason: "awaiting_commit_budget_service",
  })
  assert.equal(combinedPending.canRecover, true)
  assert.equal(combinedPending.reason, "awaiting_combined_chunk_reclaim")
  assert.equal(combinedPending.totalRecoverableSearchBudget, 24)

  const commitDenied = classifyParallelBudgetRecoveryWindow({
    remainingBudgetHeadroom: 0,
    completedUnreclaimedSearchBudget: 0,
    activeSiblingReclaimableSearchBudget: 23,
    requiredDelta: 24,
    fallbackReason: "awaiting_commit_budget_service",
  })
  assert.equal(commitDenied.canRecover, false)
  assert.equal(commitDenied.reason, "awaiting_active_chunk_reclaim")
  assert.equal(commitDenied.totalRecoverableSearchBudget, 23)

  const fallbackDirectHeadroom = classifyParallelBudgetRecoveryWindow({
    remainingBudgetHeadroom: 3,
    completedUnreclaimedSearchBudget: 0,
    activeSiblingReclaimableSearchBudget: 0,
    requiredDelta: 2,
    fallbackReason: "awaiting_commit_budget_service",
  })
  assert.equal(fallbackDirectHeadroom.canRecover, true)
  assert.equal(fallbackDirectHeadroom.reason, "awaiting_commit_budget_service")
  assert.equal(fallbackDirectHeadroom.totalRecoverableSearchBudget, 0)

  console.log(
    JSON.stringify({
      status: "ok",
      requestPending,
      commitPending,
      combinedPending,
      commitDenied,
      fallbackDirectHeadroom,
    }),
  )
}

await main()
