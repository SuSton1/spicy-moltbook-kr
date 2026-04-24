#!/usr/bin/env node

import assert from "node:assert/strict"

import { buildTechniqueTemplateScreenRunSlug } from "../src/lib/technique_template_screen_contract.mjs"
import {
  buildTechniqueOperatingBridgeManifest,
  buildTechniqueYearConsensusTemplateSummary,
  selectTechniqueYearConsensusTemplates,
} from "../src/lib/technique_year_consensus.mjs"

const templateScreenSummary = {
  runId: "tp12_technique_template_rolling_batch_v1",
  sourceBankId: "MA_RETEST__LOW_GAP_TOP__lb5",
  templates: [
    {
      candidateTemplateId: "tpl_pass",
      bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      childRunId: "tpl_pass_run",
      rollingSummaryPath: "/tmp/tpl_pass/rolling_summary.json",
      rollingReportPath: "/tmp/tpl_pass/rolling_report.md",
      passScreen: true,
    },
    {
      candidateTemplateId: "tpl_fail",
      bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      childRunId: "tpl_fail_run",
      rollingSummaryPath: "/tmp/tpl_fail/rolling_summary.json",
      rollingReportPath: "/tmp/tpl_fail/rolling_report.md",
      passScreen: false,
    },
  ],
}

const selectedTemplates = selectTechniqueYearConsensusTemplates({
  templateScreenSummary,
})
assert.equal(selectedTemplates.length, 1)
assert.equal(selectedTemplates[0].candidateTemplateId, "tpl_pass")

const collidingTemplateSlugs = [
  "ma_retest_seed__anchor-ma120-break--compression-compaction20--confirm-positive-close-retention-prevclose--confirm-sponsor-quality--invalidate-failed-breakout-count20",
  "ma_retest_seed__anchor-ma120-break--compression-compaction20--confirm-positive-close-retention-prevclose--confirm-sponsor-quality",
].map((candidateTemplateId) =>
  buildTechniqueTemplateScreenRunSlug({
    value: candidateTemplateId,
    maxLength: 96,
  }),
)
assert.equal(new Set(collidingTemplateSlugs).size, collidingTemplateSlugs.length)

const yearConsensusConfig = {
  minConsensusYearsPresent: 4,
  minConsensusYearsWithHitGe1: 3,
  minConsensusYearsWithZeroNegative: 3,
  minAggregateOosHitRate: 0.5,
  minAggregateOosHitCount: 4,
  minAggregateOosMatchedDateCount: 4,
  maxRuleSize: 6,
}

const templateSummary = buildTechniqueYearConsensusTemplateSummary({
  template: selectedTemplates[0],
  yearConsensusConfig,
  screenWindows: [
    {
      windowId: "w1",
      yearKey: 2019,
      scopeRunId: "tpl_pass_w1_scope",
      selectionLineId: "stepb_dplus1_plus_lite_target12_no_stop_low_gap_top_probe",
      selectionMode: "union_all",
      selectionLeaderboardPath: "/tmp/tpl_pass/w1/selection_leaderboard.json",
      freezeResultPath: "/tmp/tpl_pass/w1/freeze_result.json",
      frozenCatalogPath: "/tmp/tpl_pass/w1/catalog.json",
      selectionLeaderboardRows: [
        {
          ruleId: "PP_consensus",
          ruleSize: 4,
          tokens: ["a", "b", "c", "d"],
          selectionRank: 1,
          openOosMatchCount: 2,
          openOosHitCount: 2,
          openOosNegativeCount: 0,
          openOosMatchedDateCount: 2,
          openOosPrecision: 1,
        },
      ],
    },
    {
      windowId: "w2",
      yearKey: 2020,
      scopeRunId: "tpl_pass_w2_scope",
      selectionLineId: "stepb_dplus1_plus_lite_target12_no_stop_low_gap_top_probe",
      selectionMode: "union_all",
      selectionLeaderboardPath: "/tmp/tpl_pass/w2/selection_leaderboard.json",
      freezeResultPath: "/tmp/tpl_pass/w2/freeze_result.json",
      frozenCatalogPath: "/tmp/tpl_pass/w2/catalog.json",
      selectionLeaderboardRows: [
        {
          ruleId: "PP_consensus",
          ruleSize: 4,
          tokens: ["a", "b", "c", "d"],
          selectionRank: 2,
          openOosMatchCount: 1,
          openOosHitCount: 1,
          openOosNegativeCount: 0,
          openOosMatchedDateCount: 1,
          openOosPrecision: 1,
        },
      ],
    },
    {
      windowId: "w3",
      yearKey: 2021,
      scopeRunId: "tpl_pass_w3_scope",
      selectionLineId: "stepb_dplus1_plus_lite_target12_no_stop_low_gap_top_probe",
      selectionMode: "union_all",
      selectionLeaderboardPath: "/tmp/tpl_pass/w3/selection_leaderboard.json",
      freezeResultPath: "/tmp/tpl_pass/w3/freeze_result.json",
      frozenCatalogPath: "/tmp/tpl_pass/w3/catalog.json",
      selectionLeaderboardRows: [
        {
          ruleId: "PP_consensus",
          ruleSize: 4,
          tokens: ["a", "b", "c", "d"],
          selectionRank: 3,
          openOosMatchCount: 1,
          openOosHitCount: 1,
          openOosNegativeCount: 0,
          openOosMatchedDateCount: 1,
          openOosPrecision: 1,
        },
      ],
    },
    {
      windowId: "w4",
      yearKey: 2022,
      scopeRunId: "tpl_pass_w4_scope",
      selectionLineId: "stepb_dplus1_plus_lite_target12_no_stop_low_gap_top_probe",
      selectionMode: "union_all",
      selectionLeaderboardPath: "/tmp/tpl_pass/w4/selection_leaderboard.json",
      freezeResultPath: "/tmp/tpl_pass/w4/freeze_result.json",
      frozenCatalogPath: "/tmp/tpl_pass/w4/catalog.json",
      selectionLeaderboardRows: [
        {
          ruleId: "PP_consensus",
          ruleSize: 4,
          tokens: ["a", "b", "c", "d"],
          selectionRank: 4,
          openOosMatchCount: 2,
          openOosHitCount: 1,
          openOosNegativeCount: 1,
          openOosMatchedDateCount: 2,
          openOosPrecision: 0.5,
        },
        {
          ruleId: "PP_non_consensus",
          ruleSize: 4,
          tokens: ["x", "y", "z", "w"],
          selectionRank: 5,
          openOosMatchCount: 1,
          openOosHitCount: 0,
          openOosNegativeCount: 1,
          openOosMatchedDateCount: 1,
          openOosPrecision: 0,
        },
      ],
    },
  ],
})

assert.equal(templateSummary.consensusRuleCount, 1)
assert.equal(templateSummary.topConsensusRuleId, "PP_consensus")
assert.equal(templateSummary.consensusRules[0].yearsWithHitGe1.length, 4)
assert.equal(templateSummary.consensusRules[0].yearsWithZeroNegative.length, 3)
assert.equal(templateSummary.readyForExactRefinement, true)

const bridgeManifest = buildTechniqueOperatingBridgeManifest({
  contractId: "tp12_technique_discovery_bank_first_v1",
  sourceBankId: "MA_RETEST__LOW_GAP_TOP__lb5",
  templateScreenRunId: templateScreenSummary.runId,
  templateScreenSummaryPath: "/tmp/template_screen_summary.json",
  yearConsensusSummaryPath: "/tmp/year_consensus_summary.json",
  templateSummaries: [templateSummary],
  unionConsensusRuleIds: ["PP_consensus"],
})

assert.equal(bridgeManifest.readyForExactRefinement, true)
assert.equal(bridgeManifest.unionConsensusRuleCount, 1)
assert.equal(bridgeManifest.templates[0].candidateTemplateId, "tpl_pass")
assert.equal(bridgeManifest.nextStage, "t5_in_bank_exact_refinement")

console.log("ok smoke_technique_year_consensus")
