#!/usr/bin/env node

import assert from "node:assert/strict"

import { buildTechniqueClusterTemplateFixedContract } from "../src/lib/technique_cluster_template_screen_fixed_contract.mjs"
import { loadTechniqueGrammarContract } from "../src/lib/technique_grammar_contract.mjs"
import { loadTp12NoStopFixedResearchContract } from "../src/lib/tp12_no_stop_fixed_contract.mjs"

const techniqueContract = await loadTechniqueGrammarContract({
  contractPath: "meta/technique_grammar_fixed_2016_2024_contract.json",
  cwd: process.cwd(),
})
const fixedContract = await loadTp12NoStopFixedResearchContract({
  contractPath: "meta/tp12_no_stop_fixed_year2hit_research_contract.json",
  cwd: process.cwd(),
})

const contract = buildTechniqueClusterTemplateFixedContract({
  techniqueContract,
  fixedContract,
  planArtifact: {
    kind: "technique_cluster_template_screen_plan_v1",
    selectedTemplates: [
      {
        planRank: 1,
        candidateTemplateId: "tpl_a",
        bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
        sourceBankId: "MA_RETEST__LOW_GAP_TOP__lb5",
        sourceClusterBankId: "MA_RETEST__LOW_GAP_TOP__lb5::cluster::smoke",
        clusterId: "smoke",
        clusterRole: "leader",
        selectionReason: "smoke",
        entryType: "cluster_lane",
        seedId: "seed_a",
        allClauseIds: ["anchor_ma120_break", "confirm_sponsor_quality"],
        anchorClauseIds: ["anchor_ma120_break"],
        retestClauseIds: [],
        compressionClauseIds: [],
        confirmClauseIds: ["confirm_sponsor_quality"],
        invalidateClauseIds: [],
        templateScreenConfig: { ...techniqueContract.templateScreen },
      },
    ],
  },
  templateId: "tpl_a",
})

assert.equal(contract.kind, "tp12_no_stop_fixed_research_contract_v1")
assert.equal(contract.yearHitMetric, "unique_decision_dates")
assert.equal(contract.techniqueClusterTemplateScreen.candidateTemplateId, "tpl_a")
assert.equal(contract.techniqueClusterTemplateScreen.anchorClauseIds.length, 1)

console.log("ok smoke_technique_cluster_template_fixed_contract")
