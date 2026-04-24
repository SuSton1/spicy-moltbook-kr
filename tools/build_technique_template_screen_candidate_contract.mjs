#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  loadTechniqueTemplateScreenPlan,
  writeTechniqueTemplateRollingContract,
} from "../src/lib/technique_template_screen_contract.mjs"
import {
  DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH,
  loadTechniqueGrammarContract,
} from "../src/lib/technique_grammar_contract.mjs"

const toText = (value) => String(value ?? "").trim()

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const contractPath = toText(
    getFlag(flags, "contract-path", DEFAULT_TECHNIQUE_GRAMMAR_CONTRACT_PATH),
  )
  const planPath = toText(getFlag(flags, "plan-path", ""))
  const templateId = toText(getFlag(flags, "template-id", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  if (!planPath || !templateId || !outPath) {
    throw new Error(
      "build_technique_template_screen_candidate_contract requires --plan-path, --template-id, and --out",
    )
  }
  return {
    cwd,
    contractPath,
    planPath,
    templateId,
    outPath: path.resolve(cwd, outPath),
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const techniqueContract = await loadTechniqueGrammarContract({
    contractPath: args.contractPath,
    cwd,
  })
  const planArtifact = await loadTechniqueTemplateScreenPlan({
    planPath: args.planPath,
    cwd,
  })
  const result = await writeTechniqueTemplateRollingContract({
    techniqueContract,
    planArtifact,
    templateId: args.templateId,
    outPath: args.outPath,
  })
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        templateId: args.templateId,
        bankId: result.contract.techniqueTemplateScreen?.bankId ?? null,
        scopeId: result.contract.scopeId,
        lookbackCandidateId: result.contract.techniqueTemplateScreen?.lookbackCandidateId ?? null,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
