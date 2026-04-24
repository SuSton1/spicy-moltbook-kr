#!/usr/bin/env node

import fs from "fs"
import path from "path"

import { loadTechniqueGrammarContract } from "../src/lib/technique_grammar_contract.mjs"
import { buildTechniqueBankDiscoveryPlan } from "../src/lib/technique_bank_discovery_plan.mjs"
import { uniqueSortedStrings } from "../src/lib/technique_common.mjs"

const usage = () => {
  console.error(
    "Usage: node tools/build_technique_bank_discovery_plan.mjs --shortlist-path=<shortlist.json> --out=<plan.json> [--contract-path=PATH] [--bank-ids=id1,id2] [--max-banks=N]",
  )
}

const readJson = (targetPath) => JSON.parse(fs.readFileSync(targetPath, "utf8"))

const main = async () => {
  const args = process.argv.slice(2)
  const options = {
    contractPath: path.resolve("meta/technique_grammar_contract.json"),
    shortlistPath: null,
    outPath: null,
    bankIds: [],
    maxBanks: null,
  }

  for (const arg of args) {
    if (arg.startsWith("--contract-path=")) {
      options.contractPath = path.resolve(arg.split("=").slice(1).join("="))
    } else if (arg.startsWith("--shortlist-path=")) {
      options.shortlistPath = path.resolve(arg.split("=").slice(1).join("="))
    } else if (arg.startsWith("--out=")) {
      options.outPath = path.resolve(arg.split("=").slice(1).join("="))
    } else if (arg.startsWith("--bank-ids=")) {
      options.bankIds = uniqueSortedStrings(arg.split("=").slice(1).join("=").split(","))
    } else if (arg.startsWith("--max-banks=")) {
      const numeric = Number(arg.split("=").slice(1).join("="))
      if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new Error(`Invalid --max-banks value: ${arg}`)
      }
      options.maxBanks = Math.floor(numeric)
    } else if (arg === "--help" || arg === "-h") {
      usage()
      process.exit(0)
    } else {
      throw new Error(`Unknown arg: ${arg}`)
    }
  }

  if (!options.shortlistPath || !options.outPath) {
    usage()
    throw new Error("--shortlist-path and --out are required")
  }

  const techniqueContract = await loadTechniqueGrammarContract({ contractPath: options.contractPath })
  const shortlistArtifact = readJson(options.shortlistPath)
  const plan = buildTechniqueBankDiscoveryPlan({
    techniqueContract,
    shortlistArtifact,
    selectedBankIds: options.bankIds,
    maxBanks: options.maxBanks,
  })

  fs.mkdirSync(path.dirname(options.outPath), { recursive: true })
  fs.writeFileSync(
    options.outPath,
    JSON.stringify(
      {
        ...plan,
        shortlistPath: options.shortlistPath,
      },
      null,
      2,
    ),
  )

  console.log(
    JSON.stringify(
      {
        outPath: options.outPath,
        selectedBankCount: plan.selectedBankCount,
        topBankId: plan.selectedBanks?.[0]?.bankId ?? null,
        topTemplateId: plan.selectedBanks?.[0]?.topTemplateId ?? null,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
