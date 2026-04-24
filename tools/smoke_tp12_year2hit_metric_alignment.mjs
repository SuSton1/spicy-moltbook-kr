#!/usr/bin/env node

import assert from "node:assert/strict"

import { buildTechniqueRecurrenceReport } from "../src/lib/technique_recurrence_scorer.mjs"
import { loadTechniqueGrammarContract } from "../src/lib/technique_grammar_contract.mjs"

const techniqueContract = await loadTechniqueGrammarContract({
  contractPath: "meta/technique_grammar_fixed_2016_2024_contract.json",
  cwd: process.cwd(),
})

const templates = [
  {
    candidateTemplateId: "tpl_a",
    seedId: "seed_a",
    mechanismId: "MA_RETEST",
    scopeCandidates: ["LOW_GAP_TOP"],
    lookbackCandidateIds: ["lb5"],
  },
]

const sourceRows = [
  { scopeId: "LOW_GAP_TOP", lookbackCandidateId: "lb5", decisionDateKey: "2019-01-02" },
  { scopeId: "LOW_GAP_TOP", lookbackCandidateId: "lb5", decisionDateKey: "2019-01-03" },
  { scopeId: "LOW_GAP_TOP", lookbackCandidateId: "lb5", decisionDateKey: "2020-01-02" },
]

const eventRows = [
  { candidateTemplateId: "tpl_a", scopeId: "LOW_GAP_TOP", lookbackCandidateId: "lb5", yearKey: 2019, decisionDateKey: "2019-01-02", hitTarget: true },
  { candidateTemplateId: "tpl_a", scopeId: "LOW_GAP_TOP", lookbackCandidateId: "lb5", yearKey: 2019, decisionDateKey: "2019-01-02", hitTarget: true },
  { candidateTemplateId: "tpl_a", scopeId: "LOW_GAP_TOP", lookbackCandidateId: "lb5", yearKey: 2019, decisionDateKey: "2019-01-03", hitTarget: false },
  { candidateTemplateId: "tpl_a", scopeId: "LOW_GAP_TOP", lookbackCandidateId: "lb5", yearKey: 2020, decisionDateKey: "2020-01-02", hitTarget: true },
]

const report = buildTechniqueRecurrenceReport({
  techniqueContract,
  templates,
  eventRows,
  sourceRows,
})

assert.equal(report.yearHitMetric, "unique_decision_dates")
const templateSummary = report.templateSummaries[0]
const stats2019 = templateSummary.yearStats.find((item) => item.yearKey === 2019)
assert.equal(stats2019.eventCount, 2)
assert.equal(stats2019.hitCount, 1)

console.log("ok smoke_tp12_year2hit_metric_alignment")
