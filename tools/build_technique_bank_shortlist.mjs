#!/usr/bin/env node
import path from "node:path"

import { readJson, readJsonl, writeJson } from "../src/lib/io.mjs"
import {
  DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH,
  DEFAULT_TECHNIQUE_SEED_TEMPLATES_PATH,
  loadTechniqueGrammarContract,
  loadTechniqueSeedTemplates,
  selectTechniqueSeedTemplates,
} from "../src/lib/technique_grammar_contract.mjs"
import { buildTechniqueBankShortlist } from "../src/lib/technique_bank_builder.mjs"
import { uniqueSortedStrings } from "../src/lib/technique_common.mjs"
import { generateTechniqueCandidateTemplates } from "../src/lib/technique_template_generator.mjs"

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
  if (!args["recurrence-report-path"] || !args["events-path"] || !args.out) {
    throw new Error(
      "Usage: node tools/build_technique_bank_shortlist.mjs --recurrence-report-path=<report.json> --events-path=<events.jsonl> --out=<shortlist.json> [--contract-path=PATH] [--seed-templates-path=PATH] [--seed-ids=id1,id2]",
    )
  }
  const cwd = process.cwd()
  const recurrenceReport = await readJson(path.resolve(cwd, String(args["recurrence-report-path"])), null)
  if (!recurrenceReport || typeof recurrenceReport !== "object") {
    throw new Error("recurrence report is required")
  }
  const contract = await loadTechniqueGrammarContract({
    cwd,
    contractPath: args["contract-path"] || DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH,
  })
  const loadedSeedTemplates = await loadTechniqueSeedTemplates({
    cwd,
    templatesPath: args["seed-templates-path"] || DEFAULT_TECHNIQUE_SEED_TEMPLATES_PATH,
    techniqueContract: contract,
  })
  const seedIds = parseCsvArg(args["seed-ids"])
  const selectedSeedIds =
    seedIds.length > 0 ? seedIds : uniqueSortedStrings(Array.isArray(recurrenceReport.selectedSeedIds) ? recurrenceReport.selectedSeedIds : [])
  const seedTemplates = selectTechniqueSeedTemplates({
    seedTemplates: loadedSeedTemplates,
    seedIds: selectedSeedIds,
  })
  const generated = generateTechniqueCandidateTemplates({
    techniqueContract: contract,
    seedTemplates,
  })
  const eventRows = await readJsonl(path.resolve(cwd, String(args["events-path"])), {
    strict: true,
  })
  const shortlist = buildTechniqueBankShortlist({
    techniqueContract: contract,
    recurrenceReport,
    templates: generated.templates,
    eventRows,
  })
  await writeJson(path.resolve(cwd, String(args.out)), {
    ...shortlist,
    templateSetId: seedTemplates.templateSetId,
    selectedSeedIds: seedTemplates.seeds.map((seed) => seed.seedId),
    recurrenceReportPath: String(args["recurrence-report-path"]),
    eventsPath: String(args["events-path"]),
    eventRowCount: eventRows.length,
  })
}

await main()
