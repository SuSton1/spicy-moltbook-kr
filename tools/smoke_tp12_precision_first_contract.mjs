#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { assertTp12PrecisionFirstDailyOnlyContract } from "../src/lib/tp12_precision_first_contract_assert.mjs"

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-precision-contract-"))
const contractPath = path.join(tmpDir, "contract.json")

const baseContract = {
  kind: "tp12_year2hit_precision_first_daily_only_contract_v1",
  patchKey: "tp12_year2hit_precision_first_daily_only_v1",
  trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
  forbiddenOosDateRange: { from: "2025-01-02", to: "2026-04-17" },
  featureScope: {
    dailyOnly: true,
    sideDailyAllowed: false,
    intradayAllowed: false,
    themeAllowed: false,
    futureLabelFieldsAllowedAsLiveFeatures: false,
  },
  year2hitGate: { minHitsPerCoreYear: 2, relaxAllowed: false },
  lockRules: {
    emitLockedSelector: false,
    oosReplayAllowed: false,
    fallbackAllowed: false,
    oosTuningAllowed: false,
  },
}

await fs.writeFile(contractPath, `${JSON.stringify(baseContract, null, 2)}\n`)
const { summary } = await assertTp12PrecisionFirstDailyOnlyContract({ contractPath })
assert.equal(summary.status, "passed")
assert.equal(summary.sideDailyAllowed, false)
assert.equal(summary.lockedSelectorEmitted, false)

await fs.writeFile(contractPath, `${JSON.stringify({
  ...baseContract,
  featureScope: { ...baseContract.featureScope, sideDailyAllowed: true },
}, null, 2)}\n`)
await assert.rejects(
  () => assertTp12PrecisionFirstDailyOnlyContract({ contractPath }),
  /sideDailyAllowed must be false/,
)

console.log("[ok] tp12 precision-first contract smoke")

