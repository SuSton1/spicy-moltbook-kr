#!/usr/bin/env node
import path from "node:path"

import {
  createJsonlWriter,
  iterateJsonl,
  readJsonIfExistsStrict,
  writeJson,
} from "../src/lib/io.mjs"
import {
  DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH,
  loadTechniquePatternDiscoveryContract,
} from "../src/lib/technique_pattern_discovery_contract.mjs"
import {
  appendTechniqueTransactionToAtomIndexState,
  createTechniqueTransactionAtomIndexState,
  evaluateTechniquePatternAgainstTransactionIndex,
  TECHNIQUE_ZERO_NEGATIVE_REPORT_KIND,
} from "../src/lib/technique_zero_negative_verifier.mjs"

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

const main = async () => {
  const args = parseArgs(process.argv)
  if (!args["patterns-path"] || !args["transactions-path"] || !args.out) {
    throw new Error(
      "Usage: node tools/build_technique_zero_negative_report.mjs --patterns-path=<patterns.jsonl> --transactions-path=<atomic_transactions.jsonl> --out=<verified_patterns.jsonl> [--summary-out=<summary.json>] [--contract-path=PATH] [--require-zero-negative=true|false]",
    )
  }
  const cwd = process.cwd()
  const contract = await loadTechniquePatternDiscoveryContract({
    cwd,
    contractPath: args["contract-path"] || DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH,
  })
  const requireZeroNegative = String(args["require-zero-negative"] ?? "true").trim().toLowerCase() !== "false"
  const outPath = path.resolve(cwd, String(args.out))
  const summaryOutPath = args["summary-out"] ? path.resolve(cwd, String(args["summary-out"])) : null
  const preverifySummaryPath = args["preverify-summary-path"]
    ? path.resolve(cwd, String(args["preverify-summary-path"]))
    : null
  const preverifySummary = preverifySummaryPath
    ? await readJsonIfExistsStrict(preverifySummaryPath)
    : null

  if (requireZeroNegative && contract.enableContrastiveVetoSearch !== true && Number(preverifySummary?.zeroNegativeCandidateCount) === 0) {
    const writer = await createJsonlWriter(outPath)
    await writer.close()
    if (summaryOutPath) {
      await writeJson(summaryOutPath, {
        kind: TECHNIQUE_ZERO_NEGATIVE_REPORT_KIND,
        contractId: contract.contractId,
        labelId: contract.labelId,
        coreYears: contract.coreYears,
        minPositiveSupportPerYear: contract.minPositiveSupportPerYear,
        evaluatedPatternCount: Math.max(0, Number(preverifySummary?.retainedPatternCount) || 0),
        verifiedPatternCount: 0,
        requireZeroNegative,
        shortCircuitedFromPreverify: true,
      })
    }
    return
  }

  const transactionIndex = createTechniqueTransactionAtomIndexState()
  await iterateJsonl(path.resolve(cwd, String(args["transactions-path"])), {
    strict: true,
    onRow: async (transaction) => {
      appendTechniqueTransactionToAtomIndexState(transactionIndex, transaction)
    },
  })

  const coreYearSet = new Set(contract.coreYears)
  let evaluatedPatternCount = 0
  let verifiedPatternCount = 0
  const writer = await createJsonlWriter(outPath)
  try {
    await iterateJsonl(path.resolve(cwd, String(args["patterns-path"])), {
      strict: true,
      onRow: async (pattern) => {
        const evaluatedPattern = evaluateTechniquePatternAgainstTransactionIndex({
          pattern,
          transactionIndex,
          coreYears: contract.coreYears,
          minPositiveSupportPerYear: contract.minPositiveSupportPerYear,
          requireZeroNegative,
          coreYearSet,
        })
        if (!evaluatedPattern) return
        evaluatedPatternCount += 1
        if (!evaluatedPattern.pass) return
        verifiedPatternCount += 1
        await writer.writeRow(evaluatedPattern)
      },
    })
  } finally {
    await writer.close()
  }
  if (args["summary-out"]) {
    await writeJson(summaryOutPath, {
      kind: TECHNIQUE_ZERO_NEGATIVE_REPORT_KIND,
      contractId: contract.contractId,
      labelId: contract.labelId,
      coreYears: contract.coreYears,
      minPositiveSupportPerYear: contract.minPositiveSupportPerYear,
      evaluatedPatternCount,
      verifiedPatternCount,
      requireZeroNegative,
      shortCircuitedFromPreverify: false,
    })
  }
}

await main()
