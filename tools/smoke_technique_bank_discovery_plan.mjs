#!/usr/bin/env node

import assert from "assert"

import { buildTechniqueBankDiscoveryPlan } from "../src/lib/technique_bank_discovery_plan.mjs"

const techniqueContract = {
  contractId: "tp12_technique_discovery_bank_first_v1",
  bankDiscovery: {
    screenMaxSearchStates: 200000,
    minUsableWindows: 5,
    minRollingOosHitRate: 0.3,
    minOosYearsWithHitGe2: 4,
    minSignalsPer20TradingDays: 4,
    maxTop1DateShare: 0.12,
  },
}

const shortlistArtifact = {
  kind: "technique_bank_shortlist_v1",
  contractId: "tp12_technique_discovery_bank_first_v1",
  shortlistedTemplateCount: 2,
  shortlistedBankCount: 1,
  shortlistedBanks: [
    {
      bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
      mechanismId: "MA_RETEST",
      scopeIds: ["LOW_GAP_TOP"],
      lookbackCandidateIds: ["lb5"],
      candidateTemplateIds: ["tpl_a", "tpl_b"],
      bestTemplateId: "tpl_a",
      bestTemplateHitRate: 0.35,
      maxYearsWithHitGe2: 8,
      maxCoveredYears: 8,
    },
  ],
  shortlistedTemplates: [
    {
      shortlistRank: 1,
      candidateTemplateId: "tpl_a",
      mechanismId: "MA_RETEST",
      observedBankIds: ["MA_RETEST__LOW_GAP_TOP__lb5"],
      observedScopeIds: ["LOW_GAP_TOP"],
      observedLookbackCandidateIds: ["lb5"],
      observedEventCount: 20,
      observedHitCount: 7,
      observedHitRate: 0.35,
      coveredYears: 8,
      yearsWithHitGe2: 8,
      signalsPer20TradingDays: 6.1,
      allClauseIds: ["anchor_ma120_break", "confirm_close_near_high"],
      anchorClauseIds: ["anchor_ma120_break"],
      retestClauseIds: [],
      compressionClauseIds: [],
      confirmClauseIds: ["confirm_close_near_high"],
      invalidateClauseIds: [],
    },
    {
      shortlistRank: 2,
      candidateTemplateId: "tpl_b",
      mechanismId: "MA_RETEST",
      observedBankIds: ["MA_RETEST__LOW_GAP_TOP__lb5"],
      observedScopeIds: ["LOW_GAP_TOP"],
      observedLookbackCandidateIds: ["lb5"],
      observedEventCount: 10,
      observedHitCount: 3,
      observedHitRate: 0.3,
      coveredYears: 7,
      yearsWithHitGe2: 7,
      signalsPer20TradingDays: 5.9,
      allClauseIds: ["anchor_ma120_break", "confirm_sponsor_quality"],
      anchorClauseIds: ["anchor_ma120_break"],
      retestClauseIds: [],
      compressionClauseIds: [],
      confirmClauseIds: ["confirm_sponsor_quality"],
      invalidateClauseIds: [],
    },
  ],
}

const plan = buildTechniqueBankDiscoveryPlan({
  techniqueContract,
  shortlistArtifact,
})

assert.equal(plan.kind, "technique_bank_discovery_plan_v1")
assert.equal(plan.selectedBankCount, 1)
assert.equal(plan.selectedBanks[0].bankId, "MA_RETEST__LOW_GAP_TOP__lb5")
assert.equal(plan.selectedBanks[0].scopeId, "LOW_GAP_TOP")
assert.equal(plan.selectedBanks[0].lookbackCandidateId, "lb5")
assert.equal(plan.selectedBanks[0].shortlistedTemplateCount, 2)
assert.deepEqual(plan.selectedBanks[0].shortlistedTemplateIds, ["tpl_a", "tpl_b"])
assert.deepEqual(plan.selectedBanks[0].anchorClauseIds, ["anchor_ma120_break"])
assert.deepEqual(plan.selectedBanks[0].confirmClauseIds, [
  "confirm_close_near_high",
  "confirm_sponsor_quality",
])
assert.equal(plan.selectedBanks[0].observedEventCount, 30)
assert.equal(plan.selectedBanks[0].observedHitCount, 10)
assert.equal(plan.selectedBanks[0].topTemplateId, "tpl_a")

console.log("ok smoke_technique_bank_discovery_plan")
