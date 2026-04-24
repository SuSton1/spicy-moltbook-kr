#!/usr/bin/env node
import assert from "node:assert/strict"

import { loadTechniqueGrammarContract } from "../src/lib/technique_grammar_contract.mjs"
import { buildTechniqueClusterBankShortlist } from "../src/lib/technique_cluster_bank_shortlist.mjs"

const main = async () => {
  const baseContract = await loadTechniqueGrammarContract({ cwd: process.cwd() })
  const contract = {
    ...baseContract,
    shortlist: {
      ...baseContract.shortlist,
      maxTemplatesPerMechanism: 4,
      maxTemplatesTotal: 4,
      targetSignalsPer20TradingDays: 8,
    },
  }
  const templates = [
    {
      candidateTemplateId: "ma_cluster_leader",
      seedId: "seed_ma",
      mechanismId: "MA_RETEST",
      scopeCandidates: ["LOW_GAP_TOP"],
      lookbackCandidateIds: ["lb5"],
      anchorClauseIds: ["anchor_ma120_break"],
      retestClauseIds: ["retest_ma60_zone"],
      compressionClauseIds: ["compression_compaction20"],
      confirmClauseIds: ["confirm_sponsor_quality"],
      invalidateClauseIds: ["invalidate_failed_breakout_count20"],
      allClauseIds: [
        "anchor_ma120_break",
        "retest_ma60_zone",
        "compression_compaction20",
        "confirm_sponsor_quality",
        "invalidate_failed_breakout_count20",
      ],
    },
    {
      candidateTemplateId: "ma_cluster_breadth",
      seedId: "seed_ma",
      mechanismId: "MA_RETEST",
      scopeCandidates: ["LOW_GAP_TOP"],
      lookbackCandidateIds: ["lb5"],
      anchorClauseIds: ["anchor_ma120_break"],
      retestClauseIds: ["retest_ma60_zone"],
      compressionClauseIds: ["compression_compaction20"],
      confirmClauseIds: ["confirm_sponsor_quality"],
      invalidateClauseIds: [],
      allClauseIds: [
        "anchor_ma120_break",
        "retest_ma60_zone",
        "compression_compaction20",
        "confirm_sponsor_quality",
      ],
    },
    {
      candidateTemplateId: "ma_cluster_second",
      seedId: "seed_ma",
      mechanismId: "MA_RETEST",
      scopeCandidates: ["LOW_GAP_TOP"],
      lookbackCandidateIds: ["lb5"],
      anchorClauseIds: ["anchor_ma120_break"],
      retestClauseIds: ["retest_ma60_zone"],
      compressionClauseIds: [],
      confirmClauseIds: ["confirm_positive_close_retention_prevclose"],
      invalidateClauseIds: [],
      allClauseIds: [
        "anchor_ma120_break",
        "retest_ma60_zone",
        "confirm_positive_close_retention_prevclose",
      ],
    },
    {
      candidateTemplateId: "breakout_reserve_top",
      seedId: "seed_breakout",
      mechanismId: "BREAKOUT_BASE",
      scopeCandidates: ["LOW_GAP_TOP"],
      lookbackCandidateIds: ["lb5"],
      anchorClauseIds: ["anchor_breakout_pivot"],
      retestClauseIds: [],
      compressionClauseIds: ["compression_tight_range10"],
      confirmClauseIds: ["confirm_breakout_follow_through"],
      invalidateClauseIds: [],
      allClauseIds: [
        "anchor_breakout_pivot",
        "compression_tight_range10",
        "confirm_breakout_follow_through",
      ],
    },
  ]
  const recurrenceReport = {
    kind: "technique_recurrence_report_v1",
    templateSummaries: [
      {
        id: "ma_cluster_leader",
        seedId: "seed_ma",
        mechanismId: "MA_RETEST",
        scopeCandidates: ["LOW_GAP_TOP"],
        lookbackCandidateIds: ["lb5"],
        totalEventCount: 24,
        totalHitCount: 8,
        totalHitRate: 0.3333333333,
        coveredYears: 8,
        yearsWithHitGe2: 6,
        yearsWithHitGe1: 8,
        yearsWithEventCountGeMin: 8,
        signalsPer20TradingDays: 8,
        maxYearShare: 0.18,
        yearEventVector: [3, 3, 3, 3, 3, 3, 3, 3],
        yearHitVector: [1, 1, 1, 1, 1, 1, 1, 1],
        passDiscovery: true,
        passPromotion: true,
      },
      {
        id: "ma_cluster_breadth",
        seedId: "seed_ma",
        mechanismId: "MA_RETEST",
        scopeCandidates: ["LOW_GAP_TOP"],
        lookbackCandidateIds: ["lb5"],
        totalEventCount: 20,
        totalHitCount: 7,
        totalHitRate: 0.35,
        coveredYears: 8,
        yearsWithHitGe2: 6,
        yearsWithHitGe1: 8,
        yearsWithEventCountGeMin: 8,
        signalsPer20TradingDays: 7.5,
        maxYearShare: 0.17,
        yearEventVector: [3, 2, 3, 2, 2, 3, 3, 2],
        yearHitVector: [1, 1, 1, 1, 1, 0, 1, 1],
        passDiscovery: true,
        passPromotion: true,
      },
      {
        id: "ma_cluster_second",
        seedId: "seed_ma",
        mechanismId: "MA_RETEST",
        scopeCandidates: ["LOW_GAP_TOP"],
        lookbackCandidateIds: ["lb5"],
        totalEventCount: 18,
        totalHitCount: 6,
        totalHitRate: 0.3333333333,
        coveredYears: 8,
        yearsWithHitGe2: 6,
        yearsWithHitGe1: 7,
        yearsWithEventCountGeMin: 8,
        signalsPer20TradingDays: 6.8,
        maxYearShare: 0.17,
        yearEventVector: [2, 2, 2, 3, 2, 2, 3, 2],
        yearHitVector: [1, 0, 1, 1, 1, 0, 1, 1],
        passDiscovery: true,
        passPromotion: true,
      },
      {
        id: "breakout_reserve_top",
        seedId: "seed_breakout",
        mechanismId: "BREAKOUT_BASE",
        scopeCandidates: ["LOW_GAP_TOP"],
        lookbackCandidateIds: ["lb5"],
        totalEventCount: 22,
        totalHitCount: 7,
        totalHitRate: 0.3181818181,
        coveredYears: 8,
        yearsWithHitGe2: 6,
        yearsWithHitGe1: 8,
        yearsWithEventCountGeMin: 8,
        signalsPer20TradingDays: 7.9,
        maxYearShare: 0.17,
        yearEventVector: [3, 2, 3, 3, 3, 2, 3, 3],
        yearHitVector: [1, 1, 1, 0, 1, 1, 1, 1],
        passDiscovery: true,
        passPromotion: true,
      },
    ],
    bankSummaries: [
      {
        id: "MA_RETEST__LOW_GAP_TOP__lb5",
        mechanismId: "MA_RETEST",
        scopeId: "LOW_GAP_TOP",
        lookbackCandidateId: "lb5",
        totalEventCount: 62,
        totalHitCount: 21,
        totalHitRate: 0.3387096774,
        coveredYears: 8,
        yearsWithHitGe1: 8,
        yearsWithHitGe2: 6,
        yearsWithEventCountGeMin: 8,
        signalsPer20TradingDays: 8.4,
        maxYearShare: 0.18,
        passDiscovery: true,
        passPromotion: true,
      },
      {
        id: "BREAKOUT_BASE__LOW_GAP_TOP__lb5",
        mechanismId: "BREAKOUT_BASE",
        scopeId: "LOW_GAP_TOP",
        lookbackCandidateId: "lb5",
        totalEventCount: 70,
        totalHitCount: 23,
        totalHitRate: 0.3285714285,
        coveredYears: 8,
        yearsWithHitGe1: 8,
        yearsWithHitGe2: 6,
        yearsWithEventCountGeMin: 8,
        signalsPer20TradingDays: 8.1,
        maxYearShare: 0.18,
        passDiscovery: true,
        passPromotion: true,
      },
    ],
  }
  const eventRows = [
    {
      candidateTemplateId: "ma_cluster_leader",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      decisionDateKey: "2024-01-02",
      hitTarget: true,
    },
    {
      candidateTemplateId: "ma_cluster_breadth",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      decisionDateKey: "2024-01-03",
      hitTarget: false,
    },
    {
      candidateTemplateId: "ma_cluster_second",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      decisionDateKey: "2024-01-04",
      hitTarget: true,
    },
    {
      candidateTemplateId: "breakout_reserve_top",
      mechanismId: "BREAKOUT_BASE",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      decisionDateKey: "2024-01-05",
      hitTarget: true,
    },
  ]

  const shortlist = buildTechniqueClusterBankShortlist({
    techniqueContract: contract,
    recurrenceReport,
    templates,
    eventRows,
  })

  assert.equal(shortlist.kind, "technique_cluster_bank_shortlist_v1")
  assert.equal(shortlist.promotionTemplateCount, 4)
  assert.equal(shortlist.eligibleTemplateCount, 4)
  assert.equal(shortlist.clusterLaneCount, 3)
  assert.equal(shortlist.selectedClusterLaneCount, 2)
  assert.equal(shortlist.reserveBankCount, 1)
  assert.equal(shortlist.reserveBanks[0].bankId, "BREAKOUT_BASE__LOW_GAP_TOP__lb5")
  assert.equal(shortlist.selectedClusterLanes[0].selectedTemplateEntries.length, 2)
  assert.equal(shortlist.selectedClusterLanes[0].selectedTemplateEntries[0].clusterRole, "leader")
  assert.equal(shortlist.selectedClusterLanes[0].selectedTemplateEntries[1].clusterRole, "breadth")
  assert.equal(shortlist.reserveBanks[0].topTemplateId, "breakout_reserve_top")
  assert.deepEqual(shortlist.reserveBanks[0].allClauseIds, [
    "anchor_breakout_pivot",
    "compression_tight_range10",
    "confirm_breakout_follow_through",
  ])
  assert.equal(shortlist.reserveBanks[0].selectedTemplateEntries[0].selectionReason, "reserve_bank_top_template")

  console.log("ok smoke_technique_cluster_bank_shortlist")
}

await main()
