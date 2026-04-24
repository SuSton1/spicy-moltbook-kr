#!/usr/bin/env node
import assert from "node:assert/strict"
import path from "node:path"

import { readJson } from "../src/lib/io.mjs"
import { loadTp12Year2x8BankDiscoveryContract } from "../src/lib/tp12_year2x8_contract.mjs"
import {
  resolveTp12Year2x8BankDiscoveryCells,
  writeTp12Year2x8BankDiscoveryRollingContract,
} from "../src/lib/tp12_bank_grid_contracts.mjs"

const main = async () => {
  const cwd = process.cwd()
  const contract = await loadTp12Year2x8BankDiscoveryContract({ cwd })
  assert.equal(contract.kind, "tp12_year2x8_bank_discovery_research_contract_v1")
  assert.deepEqual(contract.yearHitPrune.coreYears, [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024])
  assert.deepEqual(contract.yearHitPrune.excludedBoundaryYears, [2016])
  assert.equal(contract.yearHitPrune.minTrainHitsPerCoreYear, 2)

  const cells = resolveTp12Year2x8BankDiscoveryCells({
    year2x8Contract: contract,
  })
  assert.equal(cells.length, 16)

  const outPath = path.join(
    cwd,
    "artifacts",
    "checks",
    "smoke_tp12_year2x8_bank_discovery_contract",
    "low_gap_top_lb5_contract.json",
  )
  await writeTp12Year2x8BankDiscoveryRollingContract({
    year2x8Contract: contract,
    scopeId: "LOW_GAP_TOP",
    candidateId: "lb5",
    outPath,
  })
  const derived = await readJson(outPath, null)
  assert.equal(derived?.kind, "tp12_no_stop_rolling_research_contract_v1")
  assert.equal(derived?.scopeId, "LOW_GAP_TOP")
  assert.equal(derived?.searchContract?.enableYearHitUpperBoundPrune, true)
  assert.deepEqual(derived?.searchContract?.coreYears, contract.yearHitPrune.coreYears)
  assert.equal(derived?.searchContract?.minTrainHitsPerCoreYear, 2)
  console.log("ok smoke_tp12_year2x8_bank_discovery_contract")
}

await main()
