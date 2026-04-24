#!/usr/bin/env node

import assert from "node:assert/strict"

import { resolveTechniqueRowFilterContext } from "../src/lib/technique_row_filter_contract.mjs"

const templateContext = resolveTechniqueRowFilterContext({
  techniqueTemplateScreen: {
    bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
    candidateTemplateId: "tpl_a",
    seedId: "seed_a",
    mechanismId: "MA_RETEST",
    scopeId: "LOW_GAP_TOP",
    lookbackCandidateId: "lb5",
    anchorClauseIds: ["anchor_ma120_break"],
    confirmClauseIds: ["confirm_close_near_high"],
  },
})
assert.equal(templateContext.kind, "template_screen")
assert.equal(templateContext.identifier, "tpl_a")
assert.deepEqual(templateContext.allClauseIds, ["anchor_ma120_break", "confirm_close_near_high"])

const clusterTemplateContext = resolveTechniqueRowFilterContext({
  techniqueClusterTemplateScreen: {
    bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
    sourceClusterBankId: "MA_RETEST__LOW_GAP_TOP__lb5::cluster::cluster_a",
    candidateTemplateId: "tpl_cluster_leader",
    seedId: "seed_cluster",
    mechanismId: "MA_RETEST",
    scopeId: "LOW_GAP_TOP",
    lookbackCandidateId: "lb5",
    anchorClauseIds: ["anchor_ma120_break"],
    compressionClauseIds: ["compression_compaction20"],
    confirmClauseIds: ["confirm_sponsor_quality"],
  },
})
assert.equal(clusterTemplateContext.kind, "cluster_template_screen")
assert.equal(clusterTemplateContext.sourceClusterBankId, "MA_RETEST__LOW_GAP_TOP__lb5::cluster::cluster_a")
assert.deepEqual(clusterTemplateContext.allClauseIds, [
  "anchor_ma120_break",
  "compression_compaction20",
  "confirm_sponsor_quality",
])

const bankContext = resolveTechniqueRowFilterContext({
  techniqueBankDiscovery: {
    bankId: "BREAKOUT_BASE__LOW_GAP_TOP__lb5",
    mechanismId: "BREAKOUT_BASE",
    scopeId: "LOW_GAP_TOP",
    lookbackCandidateId: "lb5",
    allClauseIds: ["anchor_breakout_pivot", "confirm_breakout_follow_through"],
    anchorClauseIds: ["anchor_breakout_pivot"],
    confirmClauseIds: ["confirm_breakout_follow_through"],
  },
})
assert.equal(bankContext.kind, "bank_discovery")
assert.equal(bankContext.identifier, "BREAKOUT_BASE__LOW_GAP_TOP__lb5")
assert.deepEqual(bankContext.allClauseIds, [
  "anchor_breakout_pivot",
  "confirm_breakout_follow_through",
])

const clusterBankContext = resolveTechniqueRowFilterContext({
  techniqueClusterBankDiscovery: {
    clusterBankId: "MA_RETEST__LOW_GAP_TOP__lb5::cluster::cluster_a",
    bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
    mechanismId: "MA_RETEST",
    scopeId: "LOW_GAP_TOP",
    lookbackCandidateId: "lb5",
    anchorClauseIds: ["anchor_ma120_break"],
    compressionClauseIds: ["compression_compaction20"],
    confirmClauseIds: ["confirm_sponsor_quality"],
  },
})
assert.equal(clusterBankContext.kind, "cluster_bank_discovery")
assert.equal(clusterBankContext.identifier, "MA_RETEST__LOW_GAP_TOP__lb5::cluster::cluster_a")
assert.deepEqual(clusterBankContext.allClauseIds, [
  "anchor_ma120_break",
  "compression_compaction20",
  "confirm_sponsor_quality",
])

assert.equal(resolveTechniqueRowFilterContext({}), null)
assert.throws(
  () =>
    resolveTechniqueRowFilterContext({
      techniqueClusterBankDiscovery: {
        clusterBankId: "MA_RETEST__LOW_GAP_TOP__lb5::cluster::cluster_a",
        bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
        mechanismId: "MA_RETEST",
        scopeId: "LOW_GAP_TOP",
        lookbackCandidateId: "lb5",
      },
    }),
  /allClauseIds/,
)

console.log("ok smoke_technique_row_filter_contract")
