#!/usr/bin/env node
import assert from "node:assert/strict"

import {
  loadTechniqueGrammarContract,
  loadTechniqueSeedTemplates,
  selectTechniqueSeedTemplates,
} from "../src/lib/technique_grammar_contract.mjs"
import { generateTechniqueCandidateTemplates } from "../src/lib/technique_template_generator.mjs"

const main = async () => {
  const contract = await loadTechniqueGrammarContract({ cwd: process.cwd() })
  const seeds = await loadTechniqueSeedTemplates({
    cwd: process.cwd(),
    techniqueContract: contract,
  })
  const generated = generateTechniqueCandidateTemplates({
    techniqueContract: contract,
    seedTemplates: seeds,
  })
  assert.equal(generated.kind, "technique_candidate_template_set_v1")
  assert(generated.templateCount > 20)
  for (const template of generated.templates) {
    assert.equal(template.clauseSet.anchor.length, 1)
    assert(template.clauseSet.retest.length <= 1)
    assert(template.clauseSet.compression.length <= 1)
    assert(template.clauseSet.confirm.length <= 2)
    assert(template.clauseSet.invalidate.length <= 1)
    assert(template.allClauseIds.length >= contract.generation.minTotalClauses)
  }
  const filteredSeeds = selectTechniqueSeedTemplates({
    seedTemplates: seeds,
    seedIds: ["ma_retest_seed", "gap_hold_seed"],
  })
  assert.deepEqual(
    filteredSeeds.seeds.map((seed) => seed.seedId),
    ["gap_hold_seed", "ma_retest_seed"].sort(),
  )
  console.log("ok smoke_technique_template_generator")
}

await main()
