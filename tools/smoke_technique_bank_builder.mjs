#!/usr/bin/env node
import assert from "node:assert/strict"

import { loadTechniqueGrammarContract } from "../src/lib/technique_grammar_contract.mjs"
import { buildTechniqueBankShortlist } from "../src/lib/technique_bank_builder.mjs"

const main = async () => {
  const baseContract = await loadTechniqueGrammarContract({ cwd: process.cwd() })
  const contract = {
    ...baseContract,
    shortlist: {
      ...baseContract.shortlist,
      maxTemplatesPerMechanism: 1,
      maxTemplatesTotal: 2,
      targetSignalsPer20TradingDays: 8,
    },
  }
  const templates = [
    {
      candidateTemplateId: "ma_retest_a",
      seedId: "seed_a",
      mechanismId: "MA_RETEST",
      scopeCandidates: ["LOW_GAP_TOP"],
      lookbackCandidateIds: ["lb5"],
      anchorClauseIds: ["anchor_ma120_break"],
      retestClauseIds: ["retest_support_ma60"],
      compressionClauseIds: [],
      confirmClauseIds: ["confirm_close_near_high"],
      invalidateClauseIds: [],
      allClauseIds: ["anchor_ma120_break", "confirm_close_near_high", "retest_support_ma60"],
    },
    {
      candidateTemplateId: "ma_retest_b",
      seedId: "seed_a",
      mechanismId: "MA_RETEST",
      scopeCandidates: ["LOW_GAP_TOP"],
      lookbackCandidateIds: ["lb5"],
      anchorClauseIds: ["anchor_ma120_break"],
      retestClauseIds: ["retest_support_ma60"],
      compressionClauseIds: [],
      confirmClauseIds: ["confirm_close_near_high", "confirm_sponsor_quality"],
      invalidateClauseIds: [],
      allClauseIds: [
        "anchor_ma120_break",
        "confirm_close_near_high",
        "confirm_sponsor_quality",
        "retest_support_ma60",
      ],
    },
    {
      candidateTemplateId: "breakout_top_a",
      seedId: "seed_b",
      mechanismId: "BREAKOUT_BASE",
      scopeCandidates: ["TOP"],
      lookbackCandidateIds: ["lb3"],
      anchorClauseIds: ["anchor_high20_break"],
      retestClauseIds: [],
      compressionClauseIds: [],
      confirmClauseIds: ["confirm_close_near_high"],
      invalidateClauseIds: [],
      allClauseIds: ["anchor_high20_break", "confirm_close_near_high"],
    },
    {
      candidateTemplateId: "breakout_top_b",
      seedId: "seed_b",
      mechanismId: "BREAKOUT_BASE",
      scopeCandidates: ["TOP"],
      lookbackCandidateIds: ["lb8"],
      anchorClauseIds: ["anchor_high20_break"],
      retestClauseIds: [],
      compressionClauseIds: [],
      confirmClauseIds: ["confirm_value_ratio"],
      invalidateClauseIds: [],
      allClauseIds: ["anchor_high20_break", "confirm_value_ratio"],
    },
  ]
  const recurrenceReport = {
    kind: "technique_recurrence_report_v1",
    templateSummaries: [
      {
        id: "ma_retest_a",
        seedId: "seed_a",
        mechanismId: "MA_RETEST",
        scopeCandidates: ["LOW_GAP_TOP"],
        lookbackCandidateIds: ["lb5"],
        totalEventCount: 16,
        totalHitCount: 6,
        totalHitRate: 0.375,
        coveredYears: 8,
        yearsWithHitGe2: 7,
        yearsWithHitGe1: 8,
        yearsWithEventCountGeMin: 8,
        signalsPer20TradingDays: 8,
        maxYearShare: 0.18,
        yearEventVector: [2, 2, 2, 2, 2, 2, 2, 2],
        yearHitVector: [1, 1, 1, 1, 1, 0, 1, 0],
        passDiscovery: true,
        passPromotion: true,
      },
      {
        id: "ma_retest_b",
        seedId: "seed_a",
        mechanismId: "MA_RETEST",
        scopeCandidates: ["LOW_GAP_TOP"],
        lookbackCandidateIds: ["lb5"],
        totalEventCount: 16,
        totalHitCount: 6,
        totalHitRate: 0.375,
        coveredYears: 8,
        yearsWithHitGe2: 7,
        yearsWithHitGe1: 8,
        yearsWithEventCountGeMin: 8,
        signalsPer20TradingDays: 8,
        maxYearShare: 0.18,
        yearEventVector: [2, 2, 2, 2, 2, 2, 2, 2],
        yearHitVector: [1, 1, 1, 1, 1, 0, 1, 0],
        passDiscovery: true,
        passPromotion: true,
      },
      {
        id: "breakout_top_a",
        seedId: "seed_b",
        mechanismId: "BREAKOUT_BASE",
        scopeCandidates: ["TOP"],
        lookbackCandidateIds: ["lb3"],
        totalEventCount: 20,
        totalHitCount: 8,
        totalHitRate: 0.4,
        coveredYears: 8,
        yearsWithHitGe2: 7,
        yearsWithHitGe1: 8,
        yearsWithEventCountGeMin: 8,
        signalsPer20TradingDays: 7.5,
        maxYearShare: 0.16,
        yearEventVector: [3, 2, 3, 2, 2, 3, 3, 2],
        yearHitVector: [1, 1, 1, 1, 1, 1, 1, 1],
        passDiscovery: true,
        passPromotion: true,
      },
      {
        id: "breakout_top_b",
        seedId: "seed_b",
        mechanismId: "BREAKOUT_BASE",
        scopeCandidates: ["TOP"],
        lookbackCandidateIds: ["lb8"],
        totalEventCount: 18,
        totalHitCount: 5,
        totalHitRate: 0.2777,
        coveredYears: 8,
        yearsWithHitGe2: 7,
        yearsWithHitGe1: 8,
        yearsWithEventCountGeMin: 8,
        signalsPer20TradingDays: 6.8,
        maxYearShare: 0.2,
        yearEventVector: [2, 2, 2, 2, 2, 3, 2, 3],
        yearHitVector: [1, 1, 0, 1, 0, 1, 0, 1],
        passDiscovery: true,
        passPromotion: true,
      },
    ],
  }
  const eventRows = [
    {
      candidateTemplateId: "ma_retest_a",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      decisionDateKey: "2024-01-02",
      hitTarget: true,
    },
    {
      candidateTemplateId: "ma_retest_a",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      decisionDateKey: "2024-01-03",
      hitTarget: false,
    },
    {
      candidateTemplateId: "ma_retest_b",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      decisionDateKey: "2024-01-04",
      hitTarget: true,
    },
    {
      candidateTemplateId: "breakout_top_a",
      mechanismId: "BREAKOUT_BASE",
      scopeId: "TOP",
      lookbackCandidateId: "lb3",
      decisionDateKey: "2024-02-02",
      hitTarget: true,
    },
    {
      candidateTemplateId: "breakout_top_b",
      mechanismId: "BREAKOUT_BASE",
      scopeId: "TOP",
      lookbackCandidateId: "lb8",
      decisionDateKey: "2024-02-05",
      hitTarget: false,
    },
  ]

  const shortlist = buildTechniqueBankShortlist({
    techniqueContract: contract,
    recurrenceReport,
    templates,
    eventRows,
  })

  assert.equal(shortlist.kind, "technique_bank_shortlist_v1")
  assert.equal(shortlist.promotionTemplateCount, 4)
  assert.equal(shortlist.eligibleTemplateCount, 3)
  assert.equal(shortlist.dedupedTemplateCount, 2)
  assert.equal(shortlist.shortlistedTemplateCount, 2)
  assert.equal(shortlist.shortlistedBankCount, 2)
  assert.deepEqual(
    shortlist.shortlistedTemplates.map((row) => row.candidateTemplateId),
    ["breakout_top_a", "ma_retest_a"],
  )
  assert.deepEqual(shortlist.shortlistedTemplates[0].anchorClauseIds, ["anchor_high20_break"])
  assert.deepEqual(shortlist.shortlistedTemplates[1].retestClauseIds, ["retest_support_ma60"])
  assert.deepEqual(
    shortlist.shortlistedBanks.map((row) => row.bankId),
    ["BREAKOUT_BASE__TOP__lb3", "MA_RETEST__LOW_GAP_TOP__lb5"],
  )
  assert.equal(shortlist.shortlistedBanks[1].bestTemplateId, "ma_retest_a")
  console.log("ok smoke_technique_bank_builder")
}

await main()
