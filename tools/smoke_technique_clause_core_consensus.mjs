#!/usr/bin/env node
import assert from "node:assert/strict"

import {
  buildTechniqueClauseCoreConsensusSummary,
  buildTechniqueClauseCoreRerunPlan,
} from "../src/lib/technique_clause_core_consensus.mjs"

const templateScreenSummary = {
  kind: "technique_template_screen_summary_v1",
  runId: "smoke_cluster_template",
  sourceBankId: "MA_RETEST__LOW_GAP_TOP__lb5",
  templates: [
    {
      candidateTemplateId: "ma_cluster_leader",
      passScreen: true,
      sourceBankId: "MA_RETEST__LOW_GAP_TOP__lb5",
      sourceClusterBankId: "MA_RETEST__LOW_GAP_TOP__lb5::cluster::cluster_a",
      clusterId: "cluster_a",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      oosHitRate: 0.31,
      anchorClauseIds: ["anchor_ma120_break"],
      retestClauseIds: [],
      compressionClauseIds: ["compression_compaction20"],
      confirmClauseIds: ["confirm_sponsor_quality"],
      invalidateClauseIds: [],
    },
    {
      candidateTemplateId: "ma_cluster_breadth",
      passScreen: true,
      sourceBankId: "MA_RETEST__LOW_GAP_TOP__lb5",
      sourceClusterBankId: "MA_RETEST__LOW_GAP_TOP__lb5::cluster::cluster_a",
      clusterId: "cluster_a",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      oosHitRate: 0.3,
      anchorClauseIds: ["anchor_ma120_break"],
      retestClauseIds: [],
      compressionClauseIds: ["compression_compaction20"],
      confirmClauseIds: ["confirm_sponsor_quality", "confirm_positive_close_retention_prevclose"],
      invalidateClauseIds: [],
    },
    {
      candidateTemplateId: "ma_cluster_retention",
      passScreen: true,
      sourceBankId: "MA_RETEST__LOW_GAP_TOP__lb5",
      sourceClusterBankId: "MA_RETEST__LOW_GAP_TOP__lb5::cluster::cluster_a",
      clusterId: "cluster_a",
      mechanismId: "MA_RETEST",
      scopeId: "LOW_GAP_TOP",
      lookbackCandidateId: "lb5",
      oosHitRate: 0.29,
      anchorClauseIds: ["anchor_ma120_break"],
      retestClauseIds: ["retest_ma60_zone"],
      compressionClauseIds: ["compression_compaction20"],
      confirmClauseIds: ["confirm_sponsor_quality"],
      invalidateClauseIds: [],
    },
  ],
}

const summary = buildTechniqueClauseCoreConsensusSummary({ templateScreenSummary })
assert.equal(summary.kind, "technique_clause_core_consensus_summary_v1")
assert.equal(summary.cohortCount, 1)
assert.equal(summary.cohorts[0].supportingTemplateCount, 3)
assert(summary.cohorts[0].hardCoreAllClauseIds.includes("anchor_ma120_break"))
assert(summary.cohorts[0].hardCoreAllClauseIds.includes("compression_compaction20"))
assert(summary.cohorts[0].hardCoreAllClauseIds.includes("confirm_sponsor_quality"))
assert(summary.rerunHypothesisCount >= 1)

const rerunPlan = buildTechniqueClauseCoreRerunPlan({
  consensusSummary: summary,
})
assert.equal(rerunPlan.kind, "technique_clause_core_rerun_plan_v1")
assert(rerunPlan.hypothesisCount >= 1)

console.log("ok smoke_technique_clause_core_consensus")
