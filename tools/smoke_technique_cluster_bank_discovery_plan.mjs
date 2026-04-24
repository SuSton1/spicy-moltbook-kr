#!/usr/bin/env node
import assert from "node:assert/strict"

import { loadTechniqueGrammarContract } from "../src/lib/technique_grammar_contract.mjs"
import { buildTechniqueClusterBankDiscoveryPlan } from "../src/lib/technique_cluster_bank_discovery_plan.mjs"

const main = async () => {
  const contract = await loadTechniqueGrammarContract({ cwd: process.cwd() })
  const shortlistArtifact = {
    kind: "technique_cluster_bank_shortlist_v1",
    contractId: contract.contractId,
    selectedClusterLanes: [
      {
        laneRank: 1,
        clusterId: "MA_RETEST__LOW_GAP_TOP__lb5_cluster_a",
        clusterFingerprint: "fp_a",
        sourceBankId: "MA_RETEST__LOW_GAP_TOP__lb5",
        mechanismId: "MA_RETEST",
        scopeId: "LOW_GAP_TOP",
        lookbackCandidateId: "lb5",
        candidateTemplateCount: 2,
        memberTemplateIds: ["ma_cluster_leader", "ma_cluster_breadth"],
        leaderTemplateId: "ma_cluster_leader",
        breadthTemplateId: "ma_cluster_breadth",
        selectedTemplateEntries: [
          {
            candidateTemplateId: "ma_cluster_leader",
            clusterRole: "leader",
            selectionReason: "cluster_leader",
            seedId: "seed_ma",
            mechanismId: "MA_RETEST",
            observedBankIds: ["MA_RETEST__LOW_GAP_TOP__lb5"],
            observedScopeIds: ["LOW_GAP_TOP"],
            observedLookbackCandidateIds: ["lb5"],
            totalEventCount: 24,
            totalHitCount: 8,
            totalHitRate: 0.3333333333,
            coveredYears: 8,
            yearsWithHitGe2: 6,
            yearsWithHitGe1: 8,
            yearsWithEventCountGeMin: 8,
            signalsPer20TradingDays: 8,
            maxYearShare: 0.18,
            allClauseIds: ["anchor_ma120_break", "compression_compaction20", "confirm_sponsor_quality"],
            anchorClauseIds: ["anchor_ma120_break"],
            retestClauseIds: [],
            compressionClauseIds: ["compression_compaction20"],
            confirmClauseIds: ["confirm_sponsor_quality"],
            invalidateClauseIds: ["invalidate_failed_breakout_count20"],
            invalidateProfile: ["invalidate_failed_breakout_count20"],
          },
          {
            candidateTemplateId: "ma_cluster_breadth",
            clusterRole: "breadth",
            selectionReason: "cluster_breadth_variant",
            seedId: "seed_ma",
            mechanismId: "MA_RETEST",
            observedBankIds: ["MA_RETEST__LOW_GAP_TOP__lb5"],
            observedScopeIds: ["LOW_GAP_TOP"],
            observedLookbackCandidateIds: ["lb5"],
            totalEventCount: 20,
            totalHitCount: 7,
            totalHitRate: 0.35,
            coveredYears: 8,
            yearsWithHitGe2: 6,
            yearsWithHitGe1: 8,
            yearsWithEventCountGeMin: 8,
            signalsPer20TradingDays: 7.5,
            maxYearShare: 0.17,
            allClauseIds: ["anchor_ma120_break", "compression_compaction20", "confirm_sponsor_quality"],
            anchorClauseIds: ["anchor_ma120_break"],
            retestClauseIds: [],
            compressionClauseIds: ["compression_compaction20"],
            confirmClauseIds: ["confirm_sponsor_quality"],
            invalidateClauseIds: [],
            invalidateProfile: [],
          },
        ],
        observedScopeIds: ["LOW_GAP_TOP"],
        observedLookbackCandidateIds: ["lb5"],
        observedBankIds: ["MA_RETEST__LOW_GAP_TOP__lb5"],
        allClauseIds: ["anchor_ma120_break", "compression_compaction20", "confirm_sponsor_quality"],
        anchorClauseIds: ["anchor_ma120_break"],
        retestClauseIds: [],
        compressionClauseIds: ["compression_compaction20"],
        confirmClauseIds: ["confirm_sponsor_quality"],
        invalidateClauseIds: ["invalidate_failed_breakout_count20"],
        sourceBankSummary: {
          bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
          mechanismId: "MA_RETEST",
          scopeId: "LOW_GAP_TOP",
          lookbackCandidateId: "lb5",
          totalHitRate: 0.3387096774,
          passPromotion: true,
        },
      },
    ],
    reserveBanks: [
      {
        reserveRank: 1,
        bankId: "BREAKOUT_BASE__LOW_GAP_TOP__lb5",
        mechanismId: "BREAKOUT_BASE",
        scopeId: "LOW_GAP_TOP",
        lookbackCandidateId: "lb5",
        topTemplateId: "breakout_reserve_top",
        shortlistedTemplateIds: ["breakout_reserve_top"],
        shortlistedTemplateCount: 1,
        selectedTemplateIds: ["breakout_reserve_top"],
        selectedTemplateEntries: [
          {
            candidateTemplateId: "breakout_reserve_top",
            clusterRole: "leader",
            selectionReason: "reserve_bank_top_template",
            seedId: "seed_breakout",
            mechanismId: "BREAKOUT_BASE",
            observedBankIds: ["BREAKOUT_BASE__LOW_GAP_TOP__lb5"],
            observedScopeIds: ["LOW_GAP_TOP"],
            observedLookbackCandidateIds: ["lb5"],
            totalEventCount: 22,
            totalHitCount: 7,
            totalHitRate: 0.3181818181,
            coveredYears: 8,
            yearsWithHitGe2: 6,
            yearsWithHitGe1: 8,
            yearsWithEventCountGeMin: 8,
            signalsPer20TradingDays: 7.9,
            maxYearShare: 0.17,
            allClauseIds: ["anchor_breakout_pivot", "compression_tight_range10", "confirm_breakout_follow_through"],
            anchorClauseIds: ["anchor_breakout_pivot"],
            retestClauseIds: [],
            compressionClauseIds: ["compression_tight_range10"],
            confirmClauseIds: ["confirm_breakout_follow_through"],
            invalidateClauseIds: [],
            invalidateProfile: [],
          },
        ],
        observedScopeIds: ["LOW_GAP_TOP"],
        observedLookbackCandidateIds: ["lb5"],
        observedBankIds: ["BREAKOUT_BASE__LOW_GAP_TOP__lb5"],
        allClauseIds: ["anchor_breakout_pivot", "compression_tight_range10", "confirm_breakout_follow_through"],
        anchorClauseIds: ["anchor_breakout_pivot"],
        retestClauseIds: [],
        compressionClauseIds: ["compression_tight_range10"],
        confirmClauseIds: ["confirm_breakout_follow_through"],
        invalidateClauseIds: [],
        selectionReason: "promotion_pass_bank_reserve",
        sourceBankSummary: {
          bankId: "BREAKOUT_BASE__LOW_GAP_TOP__lb5",
          mechanismId: "BREAKOUT_BASE",
          scopeId: "LOW_GAP_TOP",
          lookbackCandidateId: "lb5",
          totalHitRate: 0.3285714285,
          passPromotion: true,
        },
      },
    ],
  }

  const plan = buildTechniqueClusterBankDiscoveryPlan({
    techniqueContract: contract,
    shortlistArtifact,
  })

  assert.equal(plan.kind, "technique_cluster_bank_discovery_plan_v1")
  assert.equal(plan.selectedClusterLaneCount, 1)
  assert.equal(plan.selectedReserveBankCount, 1)
  assert.equal(plan.selectedBankCount, 2)
  assert.equal(plan.selectedClusterBanks[0].entryType, "cluster_lane")
  assert.equal(plan.selectedClusterBanks[1].entryType, "reserve_bank")
  assert.deepEqual(plan.selectedClusterBanks[0].selectedTemplateIds, ["ma_cluster_leader", "ma_cluster_breadth"])
  assert.equal(plan.selectedClusterBanks[1].topTemplateId, "breakout_reserve_top")
  assert.deepEqual(plan.selectedClusterBanks[1].allClauseIds, [
    "anchor_breakout_pivot",
    "compression_tight_range10",
    "confirm_breakout_follow_through",
  ])

  console.log("ok smoke_technique_cluster_bank_discovery_plan")
}

await main()
