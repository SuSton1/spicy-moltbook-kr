import assert from "node:assert/strict"

import {
  classifyParallelBudgetRecoveryWindow,
  resolveParallelChunkRunObservedBudgetState,
} from "../src/lib/perfect_prototype_parallel_indexed_miner.mjs"

const measureReclaimableBudget = ({ chunkRun, observedBudgetState }) =>
  Math.max(
    0,
    Math.max(
      Number(chunkRun?.effectiveAllocatedMaxSearchStates ?? chunkRun?.allocatedMaxSearchStates ?? 0),
      Number(observedBudgetState?.effectiveAllocatedMaxSearchStates ?? 0),
    ) - Math.max(0, Number(observedBudgetState?.exploredStates ?? 0)),
  )

const main = async () => {
  const budgetEdgeChunkRun = {
    chunkIndex: 7,
    allocatedMaxSearchStates: 9,
    effectiveAllocatedMaxSearchStates: 9,
  }
  const staleProgress = {
    exploredStates: 0,
    effectiveAllocatedMaxSearchStates: 9,
  }
  const exhaustedBudgetRequest = {
    exploredStatesAtRequest: 28,
    effectiveAllocatedMaxSearchStates: 28,
  }
  const exhaustedObservedBudgetState = resolveParallelChunkRunObservedBudgetState({
    chunkRun: budgetEdgeChunkRun,
    progressJson: staleProgress,
    budgetRequest: exhaustedBudgetRequest,
    committedAllocatedMaxSearchStates: 9,
  })
  assert.deepStrictEqual(exhaustedObservedBudgetState, {
    exploredStates: 28,
    effectiveAllocatedMaxSearchStates: 28,
  })
  const exhaustedReclaimableBudget = measureReclaimableBudget({
    chunkRun: budgetEdgeChunkRun,
    observedBudgetState: exhaustedObservedBudgetState,
  })
  assert.equal(
    exhaustedReclaimableBudget,
    0,
    "budget-edge sibling must not appear reclaimable from stale progress alone",
  )
  const exhaustedWindow = classifyParallelBudgetRecoveryWindow({
    remainingBudgetHeadroom: 0,
    completedUnreclaimedSearchBudget: 0,
    activeSiblingReclaimableSearchBudget: exhaustedReclaimableBudget,
    requiredDelta: 1,
    fallbackReason: "awaiting_budget_request_service",
  })
  assert.equal(exhaustedWindow.canRecover, false)
  assert.equal(exhaustedWindow.reason, "awaiting_budget_request_service")

  const activeBudgetRequest = {
    exploredStatesAtRequest: 20,
    effectiveAllocatedMaxSearchStates: 28,
  }
  const activeObservedBudgetState = resolveParallelChunkRunObservedBudgetState({
    chunkRun: budgetEdgeChunkRun,
    progressJson: staleProgress,
    budgetRequest: activeBudgetRequest,
    committedAllocatedMaxSearchStates: 9,
  })
  assert.deepStrictEqual(activeObservedBudgetState, {
    exploredStates: 20,
    effectiveAllocatedMaxSearchStates: 28,
  })
  const activeReclaimableBudget = measureReclaimableBudget({
    chunkRun: budgetEdgeChunkRun,
    observedBudgetState: activeObservedBudgetState,
  })
  assert.equal(activeReclaimableBudget, 8)
  const activeWindow = classifyParallelBudgetRecoveryWindow({
    remainingBudgetHeadroom: 0,
    completedUnreclaimedSearchBudget: 0,
    activeSiblingReclaimableSearchBudget: activeReclaimableBudget,
    requiredDelta: 1,
    fallbackReason: "awaiting_budget_request_service",
  })
  assert.equal(activeWindow.canRecover, true)
  assert.equal(activeWindow.reason, "awaiting_active_chunk_reclaim")
}

await main()
