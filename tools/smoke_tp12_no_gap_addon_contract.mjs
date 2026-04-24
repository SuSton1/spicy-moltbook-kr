#!/usr/bin/env node
import assert from "node:assert/strict"
import path from "node:path"

import { readJson } from "../src/lib/io.mjs"
import {
  loadTp12NoGapAddonContract,
  resolveTp12NoGapAddonCandidate,
  resolveTp12NoGapAddonCandidates,
  writeTp12NoGapAddonCandidateRollingContract,
} from "../src/lib/tp12_no_gap_addon_contract.mjs"

const main = async () => {
  const cwd = process.cwd()
  const contract = await loadTp12NoGapAddonContract({ cwd })

  assert.equal(contract.kind, "tp12_no_gap_addon_contract_v1")
  assert.equal(contract.contractId, "tp12_no_gap_addon_lb5_v1")
  assert.equal(contract.baseCandidateId, "lb5")
  assert.equal(contract.baseRollingContract.inputContract.discoveryUniverseId, "recent_impulse_upto_5d")
  assert.equal(Number(contract.baseRollingContract.inputContract.requestedLookbackTradingDays ?? 0), 5)
  assert.equal(contract.candidateSelection.screenCandidateIds.length, 10)

  const screenCandidates = resolveTp12NoGapAddonCandidates({
    addonContract: contract,
    candidateGroup: "screen",
  })
  assert.equal(screenCandidates.length, 10)
  const candidate = resolveTp12NoGapAddonCandidate({
    addonContract: contract,
    candidateId: "NG_CLOSE_LIQVOL_V1",
  })
  assert.equal(candidate.baseFamilyId, "LOW_CLOSE_ONLY")
  assert.equal(candidate.addonId, "LIQVOL_V1")

  const outPath = path.join(
    cwd,
    "artifacts",
    "checks",
    "smoke_tp12_no_gap_addon_contract",
    "ng_close_liqvol_contract.json",
  )
  await writeTp12NoGapAddonCandidateRollingContract({
    addonContract: contract,
    candidateId: "NG_CLOSE_LIQVOL_V1",
    outPath,
  })
  const derived = await readJson(outPath, null)
  assert.equal(derived?.kind, "tp12_no_stop_rolling_research_contract_v1")
  assert.equal(derived?.contractId, "tp12_no_gap_addon_lb5_v1_ng_close_liqvol_v1")
  assert.equal(derived?.scopeId, "NG_CLOSE_LIQVOL_V1")
  console.log("ok smoke_tp12_no_gap_addon_contract")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
