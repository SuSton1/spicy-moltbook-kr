#!/usr/bin/env node
import assert from "node:assert/strict"
import path from "node:path"

import { readJson } from "../src/lib/io.mjs"
import {
  loadTp12NoStopLookbackLadderContract,
  resolveTp12NoStopLookbackCandidate,
  resolveTp12NoStopLookbackCandidates,
  writeTp12NoStopLookbackCandidateRollingContract,
} from "../src/lib/tp12_no_stop_lookback_ladder_contract.mjs"

const main = async () => {
  const cwd = process.cwd()
  const ladderContract = await loadTp12NoStopLookbackLadderContract({ cwd })

  assert.equal(ladderContract.kind, "tp12_no_stop_lookback_ladder_contract_v1")
  assert.equal(ladderContract.contractId, "tp12_no_stop_low_gap_top_lookback_ladder_v1")
  assert.equal(ladderContract.baseRollingContract.contractId, "tp12_no_stop_rolling_low_gap_top_3y1y_v1")
  assert.equal(ladderContract.lookbackCandidates.length, 8)
  assert.deepEqual(ladderContract.candidateSelection.sparseCandidateIds, ["lb1", "lb2", "lb3", "lb5", "lb8"])
  assert.deepEqual(ladderContract.candidateSelection.denseFillCandidateIds, ["lb4", "lb6", "lb7"])

  const sparseCandidates = resolveTp12NoStopLookbackCandidates({
    ladderContract,
    candidateGroup: "sparse",
  })
  const denseCandidates = resolveTp12NoStopLookbackCandidates({
    ladderContract,
    candidateGroup: "dense_fill",
  })
  assert.equal(sparseCandidates.length, 5)
  assert.equal(denseCandidates.length, 3)

  const candidate = resolveTp12NoStopLookbackCandidate({
    ladderContract,
    candidateId: "lb3",
  })
  assert.equal(candidate.lookbackTradingDays, 3)
  assert.equal(candidate.discoveryUniverseId, "recent_impulse_upto_3d")
  assert.deepEqual(candidate.stepALaneSet, ["recent_impulse_1d", "recent_impulse_2d", "recent_impulse_3d"])

  const outPath = path.join(
    cwd,
    "artifacts",
    "checks",
    "smoke_tp12_no_stop_lookback_ladder_contract",
    "lb3_contract.json",
  )
  await writeTp12NoStopLookbackCandidateRollingContract({
    ladderContract,
    candidateId: "lb3",
    outPath,
  })
  const derived = await readJson(outPath, null)
  assert.equal(derived?.kind, "tp12_no_stop_rolling_research_contract_v1")
  assert.equal(derived?.contractId, "tp12_no_stop_low_gap_top_lookback_ladder_v1_lb3")
  assert.equal(derived?.inputContract?.discoveryUniverseId, "recent_impulse_upto_3d")
  assert.equal(Number(derived?.inputContract?.requestedLookbackTradingDays ?? 0), 3)
  assert.equal(derived?.lookbackLadderContext?.kind, "tp12_no_stop_lookback_candidate_context_v1")
  assert.equal(derived?.lookbackLadderContext?.selectedCandidate?.candidateId, "lb3")
  assert.equal(Number(derived?.lookbackLadderContext?.selectedCandidate?.lookbackTradingDays ?? 0), 3)
  assert.deepEqual(derived?.inputContract?.stepALaneSet, [
    "recent_impulse_1d",
    "recent_impulse_2d",
    "recent_impulse_3d",
  ])
  assert.equal(derived?.windows?.length, 7)
  console.log("ok smoke_tp12_no_stop_lookback_ladder_contract")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
