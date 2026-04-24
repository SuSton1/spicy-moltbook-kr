#!/usr/bin/env node
import path from "node:path"

import { readJsonl, writeJson } from "../src/lib/io.mjs"
import {
  DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH,
  DEFAULT_TECHNIQUE_SEED_TEMPLATES_PATH,
  loadTechniqueGrammarContract,
  loadTechniqueSeedTemplates,
  selectTechniqueSeedTemplates,
} from "../src/lib/technique_grammar_contract.mjs"
import { generateTechniqueCandidateTemplates } from "../src/lib/technique_template_generator.mjs"
import { buildTechniqueRecurrenceReport } from "../src/lib/technique_recurrence_scorer.mjs"
import { uniqueSortedStrings } from "../src/lib/technique_common.mjs"

const parseArgs = (argv) => {
  const parsed = {}
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) continue
    const eq = arg.indexOf("=")
    if (eq === -1) {
      parsed[arg.slice(2)] = true
      continue
    }
    parsed[arg.slice(2, eq)] = arg.slice(eq + 1)
  }
  return parsed
}

const parseCsvArg = (value) => uniqueSortedStrings(String(value ?? "").split(","))

const main = async () => {
  const args = parseArgs(process.argv)
  if (!args["events-path"] || !args.out) {
    throw new Error(
      "Usage: node tools/build_technique_recurrence_report.mjs --events-path=<events.jsonl> --out=<report.json> [--source-rows-path=<rows.jsonl>] [--contract-path=PATH] [--seed-templates-path=PATH] [--seed-ids=id1,id2] [--default-scope-id=SCOPE] [--default-lookback-candidate-id=ID] [--label-id=LABEL]",
    )
  }
  const cwd = process.cwd()
  const contract = await loadTechniqueGrammarContract({
    cwd,
    contractPath: args["contract-path"] || DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH,
  })
  const loadedSeedTemplates = await loadTechniqueSeedTemplates({
    cwd,
    templatesPath: args["seed-templates-path"] || DEFAULT_TECHNIQUE_SEED_TEMPLATES_PATH,
    techniqueContract: contract,
  })
  const seedTemplates = selectTechniqueSeedTemplates({
    seedTemplates: loadedSeedTemplates,
    seedIds: parseCsvArg(args["seed-ids"]),
  })
  const generated = generateTechniqueCandidateTemplates({
    techniqueContract: contract,
    seedTemplates,
  })
  const eventRows = await readJsonl(path.resolve(cwd, String(args["events-path"])), {
    strict: true,
  })
  const sourceRows = args["source-rows-path"]
    ? await readJsonl(path.resolve(cwd, String(args["source-rows-path"])), {
        strict: true,
      })
    : []
  const report = buildTechniqueRecurrenceReport({
    techniqueContract: contract,
    templates: generated.templates,
    eventRows,
    sourceRows,
    labelId: String(args["label-id"] || contract.labelId),
    defaultScopeId: args["default-scope-id"] || null,
    defaultLookbackCandidateId: args["default-lookback-candidate-id"] || null,
  })
  await writeJson(path.resolve(cwd, String(args.out)), {
    ...report,
    templateSetId: seedTemplates.templateSetId,
    selectedSeedIds: seedTemplates.seeds.map((seed) => seed.seedId),
    sourceRowCount: sourceRows.length,
  })
}

await main()
