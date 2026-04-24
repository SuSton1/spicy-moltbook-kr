#!/usr/bin/env node

import assert from "node:assert/strict"

import { buildTechniqueClusterBankDiscoveryFixedContract } from "../src/lib/technique_cluster_bank_discovery_fixed_contract.mjs"
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

const contract = buildTechniqueClusterBankDiscoveryFixedContract({
  techniqueContract,
  fixedContract,
  planArtifact: {
    kind: "technique_cluster_bank_discovery_plan_v1",
    selectedClusterBanks: [
      {
        planRank: 1,
        clusterBankId: "MA_RETEST__LOW_GAP_TOP__lb5::cluster::smoke",
        entryType: "cluster_lane",
        selectionPolicy: "cluster_lane",
        bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
        sourceBankId: "MA_RETEST__LOW_GAP_TOP__lb5",
        clusterId: "smoke",
        mechanismId: "MA_RETEST",
        scopeId: "LOW_GAP_TOP",
        lookbackCandidateId: "lb5",
        shortlistedTemplateIds: ["tpl_a"],
        selectedTemplateIds: ["tpl_a"],
        allClauseIds: ["anchor_ma120_break", "confirm_sponsor_quality"],
        anchorClauseIds: ["anchor_ma120_break"],
        retestClauseIds: [],
        compressionClauseIds: [],
        confirmClauseIds: ["confirm_sponsor_quality"],
        invalidateClauseIds: [],
        bankDiscoveryConfig: { ...techniqueContract.bankDiscovery },
      },
    ],
  },
  clusterBankId: "MA_RETEST__LOW_GAP_TOP__lb5::cluster::smoke",
})

assert.equal(contract.kind, "tp12_no_stop_fixed_research_contract_v1")
assert.equal(contract.yearHitMetric, "unique_decision_dates")
assert.equal(contract.scopeId, "LOW_GAP_TOP")
assert.equal(contract.techniqueClusterBankDiscovery.bankId, "MA_RETEST__LOW_GAP_TOP__lb5")
assert.equal(contract.techniqueClusterBankDiscovery.anchorClauseIds.length, 1)

console.log("ok smoke_technique_cluster_bank_discovery_fixed_contract")
