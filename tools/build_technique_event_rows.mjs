#!/usr/bin/env node
import path from "node:path"

import { iterateJsonl, writeJson } from "../src/lib/io.mjs"
import {
  DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH,
  DEFAULT_TECHNIQUE_SEED_TEMPLATES_PATH,
  loadTechniqueGrammarContract,
  loadTechniqueSeedTemplates,
  selectTechniqueSeedTemplates,
} from "../src/lib/technique_grammar_contract.mjs"
import { generateTechniqueCandidateTemplates } from "../src/lib/technique_template_generator.mjs"
import { buildTechniqueEventMatchesForRow } from "../src/lib/technique_event_row_builder.mjs"
import { createJsonlWriter } from "../src/lib/io.mjs"
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
  if (!args["rows-path"] || !args.out) {
    throw new Error(
      "Usage: node tools/build_technique_event_rows.mjs --rows-path=<rows.jsonl> --out=<events.jsonl> [--summary-out=<summary.json>] [--contract-path=PATH] [--seed-templates-path=PATH] [--seed-ids=id1,id2] [--default-scope-id=SCOPE] [--default-lookback-candidate-id=ID] [--label-id=LABEL]",
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
  const writer = await createJsonlWriter(path.resolve(cwd, String(args.out)))
  let inputRowCount = 0
  let eventRowCount = 0
  const matchedTemplateIds = new Set()
  try {
    await iterateJsonl(path.resolve(cwd, String(args["rows-path"])), {
      strict: true,
      onRow: async (row) => {
        inputRowCount += 1
        const matches = buildTechniqueEventMatchesForRow({
          row,
          templates: generated.templates,
          labelId: String(args["label-id"] || contract.labelId),
          defaultScopeId: args["default-scope-id"] || null,
          defaultLookbackCandidateId: args["default-lookback-candidate-id"] || null,
        })
        if (matches.length < 1) return
        eventRowCount += matches.length
        for (const match of matches) matchedTemplateIds.add(match.candidateTemplateId)
        await writer.writeRows(matches)
      },
    })
  } finally {
    await writer.close()
  }
  if (args["summary-out"]) {
    await writeJson(path.resolve(cwd, String(args["summary-out"])), {
      kind: "technique_event_row_build_summary_v1",
      contractId: contract.contractId,
      templateSetId: seedTemplates.templateSetId,
      inputRowCount,
      eventRowCount,
      matchedTemplateCount: matchedTemplateIds.size,
      selectedSeedIds: seedTemplates.seeds.map((seed) => seed.seedId),
      labelId: String(args["label-id"] || contract.labelId),
    })
  }
}

await main()
