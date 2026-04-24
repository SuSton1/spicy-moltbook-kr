#!/usr/bin/env node
import assert from "node:assert/strict"

import { loadTp12NoStopLb5LiveLikeOosReplayContract } from "../src/lib/tp12_no_stop_lb5_live_like_oos_replay_contract.mjs"

const main = async () => {
  const contract = await loadTp12NoStopLb5LiveLikeOosReplayContract({
    cwd: process.cwd(),
  })
  assert.equal(contract.contractId, "tp12_no_stop_lb5_live_like_oos_replay_v1")
  assert.equal(contract.baseCandidateId, "lb5")
  assert.equal(contract.lookbackTradingDays, 5)
  assert.equal(contract.selectionMode, "union_all")
  assert.equal(contract.baselineMetrics.oosSelectedRows, 105)
  console.log("ok smoke_tp12_no_stop_lb5_live_like_oos_replay_contract")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
