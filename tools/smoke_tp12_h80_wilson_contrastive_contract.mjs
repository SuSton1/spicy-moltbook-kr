#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { assertTp12H80WilsonContrastiveContract } from "../src/lib/tp12_h80_wilson_contrastive_contract.mjs"

const writeJson = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const validContract = {
  kind: "tp12_h80_wilson_contrastive_abstention_contract_v1",
  patchKey: "tp12_h80_wilson_contrastive_abstention_v1",
  trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
  forbiddenDateRange: { from: "2025-01-02", to: "2026-04-17" },
  label: {
    entryPolicy: "GLOBAL_NEXT_SESSION_OPEN",
    targetPct: 0.12,
    holdDays: 3,
    stopPolicy: "no_stop",
    requireEntryFeasibilitySummary: true,
  },
  splits: {
    outerFolds: [
      { fitYears: [2016, 2017, 2018, 2019, 2020], validationYear: 2021 },
      { fitYears: [2016, 2017, 2018, 2019, 2020, 2021], validationYear: 2022 },
      { fitYears: [2016, 2017, 2018, 2019, 2020, 2021, 2022], validationYear: 2023 },
      { fitYears: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023], validationYear: 2024 },
    ],
    purgeTradingDays: 5,
    embargoTradingDays: 5,
    sameDecisionDateGroupSplit: true,
  },
  objective: {
    mode: "abstention_first",
    targetWilsonLower95: 0.8,
    minSelectedRows: 150,
    minActiveValidationYears: 4,
  },
  featureGroups: {
    sideDaily: "disabled_until_full_asof_coverage",
    intradayEarlyConfirmation: "disabled_for_daily_next_open_label",
  },
  preflight: {
    failOnOosPath: true,
    requireDataReadiness: true,
    requireAsofSurvivorship: true,
    requireEntryFeasibility: true,
    requireFeatureManifest: true,
    requireSplitManifest: true,
  },
  lockRules: {
    emitLockedSelectorRequiresH80Gate: true,
    oosTuningAllowed: false,
    fallbackAllowed: false,
    researchTierOosApplyAllowed: false,
  },
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-h80-contract-"))
try {
  const contractPath = path.join(tmp, "contract.json")
  await writeJson(contractPath, validContract)
  const pass = await assertTp12H80WilsonContrastiveContract({
    contractPath,
    outPath: path.join(tmp, "pass.json"),
  })
  assert.equal(pass.status, "passed")
  assert.deepEqual(pass.validationYears, [2021, 2022, 2023, 2024])

  await writeJson(path.join(tmp, "bad_contract.json"), {
    ...validContract,
    objective: { ...validContract.objective, targetWilsonLower95: 0.65 },
    lockRules: { ...validContract.lockRules, fallbackAllowed: true },
  })
  await assert.rejects(
    () =>
      assertTp12H80WilsonContrastiveContract({
        contractPath: path.join(tmp, "bad_contract.json"),
        outPath: path.join(tmp, "bad.json"),
      }),
    /target_wilson_lower95_below_h80/,
  )
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log("ok smoke_tp12_h80_wilson_contrastive_contract")
