#!/usr/bin/env node
import assert from "node:assert/strict"
import path from "node:path"

import { readJson } from "../src/lib/io.mjs"
import {
  loadTp12NoStopScopeExpansionContract,
  resolveTp12NoStopScopeExpansionCandidate,
  resolveTp12NoStopScopeExpansionCandidates,
  writeTp12NoStopScopeExpansionCandidateRollingContract,
} from "../src/lib/tp12_no_stop_scope_expansion_contract.mjs"

const main = async () => {
  const cwd = process.cwd()
  const contract = await loadTp12NoStopScopeExpansionContract({ cwd })

  assert.equal(contract.kind, "tp12_no_stop_scope_expansion_contract_v1")
  assert.equal(contract.contractId, "tp12_no_stop_scope_expand_lb5_v1")
  assert.equal(contract.baseCandidateId, "lb5")
  assert.equal(contract.baseRollingContract.inputContract.discoveryUniverseId, "recent_impulse_upto_5d")
  assert.equal(Number(contract.baseRollingContract.inputContract.requestedLookbackTradingDays ?? 0), 5)
  assert.deepEqual(contract.candidateSelection.screenScopeIds, ["LOW"])

  const screenCandidates = resolveTp12NoStopScopeExpansionCandidates({
    scopeExpansionContract: contract,
    scopeGroup: "screen",
  })
  assert.equal(screenCandidates.length, 1)
  assert.equal(screenCandidates[0].scopeId, "LOW")

  const candidate = resolveTp12NoStopScopeExpansionCandidate({
    scopeExpansionContract: contract,
    scopeId: "MID",
  })
  assert.equal(candidate.scopeId, "MID")
  assert.equal(candidate.stage, "expand")

  const outPath = path.join(
    cwd,
    "artifacts",
    "checks",
    "smoke_tp12_no_stop_scope_expansion_contract",
    "low_contract.json",
  )
  await writeTp12NoStopScopeExpansionCandidateRollingContract({
    scopeExpansionContract: contract,
    scopeId: "LOW",
    outPath,
  })
  const derived = await readJson(outPath, null)
  assert.equal(derived?.kind, "tp12_no_stop_rolling_research_contract_v1")
  assert.equal(derived?.contractId, "tp12_no_stop_scope_expand_lb5_v1_low")
  assert.equal(derived?.scopeId, "LOW")
  assert.equal(derived?.inputContract?.discoveryUniverseId, "recent_impulse_upto_5d")
  assert.equal(Number(derived?.inputContract?.requestedLookbackTradingDays ?? 0), 5)
  console.log("ok smoke_tp12_no_stop_scope_expansion_contract")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
