#!/usr/bin/env node
import assert from "node:assert/strict"
import path from "node:path"

import { readJson } from "../src/lib/io.mjs"
import {
  loadTp12NoStopRollingResearchContract,
  resolveTp12NoStopRollingSearchBudget,
  resolveTp12NoStopRollingWindow,
  resolveTp12NoStopRollingWindows,
  writeTp12NoStopRollingDerivedSideDailyContract,
} from "../src/lib/tp12_no_stop_rolling_contract.mjs"

const main = async () => {
  const cwd = process.cwd()
  const contract = await loadTp12NoStopRollingResearchContract({ cwd })

  assert.equal(contract.kind, "tp12_no_stop_rolling_research_contract_v1")
  assert.equal(contract.contractId, "tp12_no_stop_rolling_low_gap_top_3y1y_v1")
  assert.equal(contract.searchContract.lineId, "stepb_dplus1_plus_lite_target12_no_stop")
  assert.equal(contract.labelContract.targetPct, 0.12)
  assert.equal(contract.labelContract.stopLossPct, 0)
  assert.equal(contract.windows.length, 7)
  assert.equal(contract.screenWindowIds.length, 6)
  assert.equal(contract.finalConfirmWindowId, "final_confirm")

  const screenWindows = resolveTp12NoStopRollingWindows({
    contract,
    windowGroup: "screen",
  })
  const finalWindow = resolveTp12NoStopRollingWindow({
    contract,
    windowId: contract.finalConfirmWindowId,
  })
  assert.equal(screenWindows.length, 6)
  assert.equal(finalWindow.kind, "final_confirm")
  assert.equal(resolveTp12NoStopRollingSearchBudget({ contract, window: screenWindows[0] }), 200000)
  assert.equal(resolveTp12NoStopRollingSearchBudget({ contract, window: finalWindow }), 20000000)

  const outPath = path.join(
    cwd,
    "artifacts",
    "checks",
    "smoke_tp12_no_stop_rolling_contract",
    "derived_w3_contract.json",
  )
  await writeTp12NoStopRollingDerivedSideDailyContract({
    rollingContract: contract,
    windowId: "w3",
    outPath,
  })
  const derived = await readJson(outPath, null)
  assert.equal(derived?.kind, "tp12_side_daily_research_contract_v1")
  assert.equal(derived?.contractId, "tp12_no_stop_rolling_low_gap_top_3y1y_v1_w3")
  assert.equal(derived?.decisionWindow?.from, "2018-01-02")
  assert.equal(derived?.decisionWindow?.to, "2021-12-30")
  assert.equal(derived?.control?.trainDateFrom, "2018-01-02")
  assert.equal(derived?.control?.trainDateTo, "2020-12-31")
  assert.equal(derived?.control?.oosDateFrom, "2021-01-04")
  assert.equal(derived?.control?.oosDateTo, "2021-12-30")
  assert.deepEqual(derived?.control?.targetLabelIds, [
    "tp12_no_stop_hit_3d",
    "tp12_no_stop_hit_4d",
  ])
  console.log("ok smoke_tp12_no_stop_rolling_contract")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
