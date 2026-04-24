import assert from "node:assert/strict"
import path from "node:path"

import {
  DEFAULT_TP12_SIDE_DAILY_RESEARCH_CONTRACT_PATH,
  loadTp12SideDailyResearchContract,
  resolveTp12SideDailyControlArgsFromContract,
  TP12_SIDE_DAILY_RESEARCH_CONTRACT_KIND,
} from "../src/lib/tp12_side_daily_contract.mjs"


const main = async () => {
  const cwd = process.cwd()
  const contract = await loadTp12SideDailyResearchContract({ cwd })
  assert.equal(contract.kind, TP12_SIDE_DAILY_RESEARCH_CONTRACT_KIND)
  assert.equal(contract.contractId, "tp12_side_daily_low_gap_top_no_stop_effective_floor_20160812_v3")
  assert.equal(contract.scopeId, "LOW_GAP_TOP")
  assert.equal(contract.contractPath, path.resolve(cwd, DEFAULT_TP12_SIDE_DAILY_RESEARCH_CONTRACT_PATH))
  assert.equal(contract.decisionWindow.from, "2016-08-12")
  assert.equal(contract.decisionWindow.to, "2026-03-30")
  assert.deepEqual(contract.control.stepALaneSet, ["recent_impulse_1d"])
  assert.deepEqual(contract.control.targetLabelIds, ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"])

  const resolved = await resolveTp12SideDailyControlArgsFromContract({ cwd })
  assert.equal(resolved.trainDateFrom, "2016-08-12")
  assert.equal(resolved.trainDateTo, "2024-12-31")
  assert.equal(resolved.oosDateFrom, "2025-01-02")
  assert.equal(resolved.oosDateTo, "2026-03-30")
  assert.equal(resolved.allowlistPolicy, "required_low_gap_top_allowlist_exact_pair_v1")
  assert.equal(resolved.commonSupportPolicy, "pair_exact_intersection_v1")
  assert.deepEqual(resolved.stepALaneSet, ["recent_impulse_1d"])
  assert.deepEqual(resolved.targetLabelIds, ["tp12_no_stop_hit_3d", "tp12_no_stop_hit_4d"])

  const overridden = await resolveTp12SideDailyControlArgsFromContract({
    cwd,
    decisionTo: "2026-03-27",
    targetLabelIds: ["tp12_no_stop_hit_3d"],
  })
  assert.equal(overridden.decisionTo, "2026-03-27")
  assert.deepEqual(overridden.targetLabelIds, ["tp12_no_stop_hit_3d"])

  console.log("ok smoke_tp12_side_daily_contract")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
