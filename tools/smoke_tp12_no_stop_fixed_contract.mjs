#!/usr/bin/env node

import assert from "node:assert/strict"

import {
  buildTp12NoStopFixedSearchContractForSplit,
  buildTp12NoStopFixedDerivedRollingContract,
  loadTp12NoStopFixedResearchContract,
  resolveTp12NoStopFixedSplits,
} from "../src/lib/tp12_no_stop_fixed_contract.mjs"
import { loadTp12NoStopRollingResearchContract } from "../src/lib/tp12_no_stop_rolling_contract.mjs"
import { writeJson } from "../src/lib/io.mjs"

const contract = await loadTp12NoStopFixedResearchContract({
  contractPath: "meta/tp12_no_stop_fixed_year2hit_research_contract.json",
  cwd: process.cwd(),
})

const screenSplits = resolveTp12NoStopFixedSplits({
  contract,
  splitGroup: "screen",
})
assert.equal(screenSplits.length, 5)
assert.equal(contract.yearHitMetric, "unique_decision_dates")

const screenRolling = buildTp12NoStopFixedDerivedRollingContract({
  fixedContract: contract,
  splitGroup: "screen",
  contractIdSuffix: "smoke",
})
assert.equal(screenRolling.kind, "tp12_no_stop_rolling_research_contract_v1")
assert.equal(screenRolling.yearHitMetric, "unique_decision_dates")
assert.equal(screenRolling.windows.length, 5)
assert.equal(screenRolling.windows[0].kind, "screen")
assert.equal(screenRolling.contractMode, "carrier_fixed_window_v1")
assert.equal(screenRolling.decisionWindow.from, "2016-08-12")

const firstScreenSearchContract = buildTp12NoStopFixedSearchContractForSplit({
  fixedContract: contract,
  split: screenSplits[0],
})
assert.deepEqual(firstScreenSearchContract.coreYears, [2017, 2018])

const firstScreenRolling = buildTp12NoStopFixedDerivedRollingContract({
  fixedContract: contract,
  splitIds: ["screen_2019"],
  contractIdSuffix: "screen_2019_smoke",
})
assert.equal(firstScreenRolling.windows.length, 1)
assert.deepEqual(firstScreenRolling.searchContract.coreYears, [2017, 2018])

const confirmRolling = buildTp12NoStopFixedDerivedRollingContract({
  fixedContract: contract,
  splitGroup: "confirm",
})
assert.equal(confirmRolling.windows.length, 1)
assert.equal(confirmRolling.windows[0].kind, "final_confirm")
assert.deepEqual(confirmRolling.searchContract.coreYears, [2017, 2018, 2019, 2020, 2021, 2022, 2023])

const tmpPath = `/tmp/smoke_tp12_no_stop_fixed_contract_${process.pid}.json`
await writeJson(tmpPath, screenRolling)
const loadedCarrier = await loadTp12NoStopRollingResearchContract({
  contractPath: tmpPath,
  cwd: process.cwd(),
})
assert.equal(loadedCarrier.contractMode, "carrier_fixed_window_v1")
assert.equal(loadedCarrier.screenWindowIds.length, 5)
assert.equal(loadedCarrier.finalConfirmWindowId, null)

console.log("ok smoke_tp12_no_stop_fixed_contract")
