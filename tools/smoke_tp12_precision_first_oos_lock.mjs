#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { assertTp12PrecisionFirstDailyOnlyContract } from "../src/lib/tp12_precision_first_contract_assert.mjs"
import { runTp12Year2hitPrecisionFirstDailyOnly } from "../src/lib/tp12_year2hit_precision_first_daily_only.mjs"

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-precision-oos-"))
const contractPath = path.join(tmpDir, "contract.json")
const candidatesPath = path.join(tmpDir, "candidates.jsonl")

const contract = {
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

await fs.writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`)
await assert.rejects(
  () => assertTp12PrecisionFirstDailyOnlyContract({ contractPath, candidatePath: "artifacts/oos_2025_candidates.jsonl" }),
  /OOS|forbidden path/,
)

await fs.writeFile(candidatesPath, `${JSON.stringify({
  decisionDateKey: "2025-01-02",
  symbol: "000001",
  hitTarget: true,
})}\n`)
await assert.rejects(
  () => runTp12Year2hitPrecisionFirstDailyOnly({
    contractPath,
    candidatesPath,
    outSummaryPath: path.join(tmpDir, "summary.json"),
  }),
  /forbidden OOS range/,
)

console.log("[ok] tp12 precision-first OOS lock smoke")

