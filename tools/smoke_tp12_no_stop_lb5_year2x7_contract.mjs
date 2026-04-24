#!/usr/bin/env node
import assert from "node:assert/strict"

import { loadTp12NoStopLb5Year2x7ResearchContract } from "../src/lib/tp12_no_stop_lb5_year2x7_contract.mjs"

const main = async () => {
  const contract = await loadTp12NoStopLb5Year2x7ResearchContract({
    cwd: process.cwd(),
  })
  assert.equal(contract.contractId, "tp12_no_stop_lb5_year2x7_audit_replay_v1")
  assert.equal(contract.baseCandidateId, "lb5")
  assert.equal(contract.lookbackTradingDays, 5)
  assert.deepEqual(contract.yearCoverage.coreYears, [2017, 2018, 2019, 2020, 2021, 2022, 2023])
  assert.equal(contract.yearCoverage.minHitsPerCoreYear, 2)
  console.log("ok smoke_tp12_no_stop_lb5_year2x7_contract")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
