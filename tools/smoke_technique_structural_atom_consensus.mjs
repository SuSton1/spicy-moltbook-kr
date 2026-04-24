#!/usr/bin/env node
import assert from "node:assert/strict"

import {
  buildTechniqueStructuralAtomConsensusSummary,
  projectTechniqueConsensusRuleToStructuralAtoms,
} from "../src/lib/technique_structural_atom_consensus.mjs"

const templateA = {
  candidateTemplateId: "template_a",
  bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
  mechanismId: "MA_RETEST",
  scopeId: "LOW_GAP_TOP",
  lookbackCandidateId: "lb5",
  childRunId: "child_a",
}
const templateB = {
  candidateTemplateId: "template_b",
  bankId: "MA_RETEST__LOW_GAP_TOP__lb5",
  mechanismId: "MA_RETEST",
  scopeId: "LOW_GAP_TOP",
  lookbackCandidateId: "lb5",
  childRunId: "child_b",
}
const rule = {
  ruleId: "rule_shared",
  familyId: "ma_retest",
  tokens: ["anchor_ma120_break", "compression_compaction20", "confirm_sponsor_quality"],
  yearsPresent: ["2021", "2022", "2023", "2024"],
  yearsWithHitGe1: ["2021", "2022", "2023"],
  yearsWithZeroNegative: ["2021", "2022", "2023"],
  aggregateOosMatchCount: 8,
  aggregateOosHitCount: 5,
  aggregateOosNegativeCount: 0,
  aggregateOosMatchedDateCount: 5,
  aggregateOosHitRate: 0.625,
  passConsensus: true,
}
const projectionA = projectTechniqueConsensusRuleToStructuralAtoms({
  template: templateA,
  rule,
})
const projectionB = projectTechniqueConsensusRuleToStructuralAtoms({
  template: templateB,
  rule,
})
assert.equal(projectionA.motifId, projectionB.motifId)

const summary = buildTechniqueStructuralAtomConsensusSummary({
  projections: [projectionA, projectionB],
  yearConsensusConfig: {
    minConsensusYearsPresent: 4,
    minConsensusYearsWithHitGe1: 3,
    minConsensusYearsWithZeroNegative: 3,
    minAggregateOosHitRate: 0.5,
    minAggregateOosHitCount: 4,
    minAggregateOosMatchedDateCount: 4,
  },
})
assert.equal(summary.kind, "technique_structural_atom_consensus_summary_v1")
assert.equal(summary.motifCount, 1)
assert.equal(summary.passMotifCount, 1)
assert.equal(summary.motifs[0].motifTemplateCount, 2)
assert(summary.motifs[0].structuralAtomIds.includes("anchor:ma120_break"))

console.log("ok smoke_technique_structural_atom_consensus")
