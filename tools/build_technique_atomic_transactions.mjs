#!/usr/bin/env node
import path from "node:path"

import { buildTechniqueAtomicTransactionRow } from "../src/lib/technique_atomic_transaction_builder.mjs"
import { iterateJsonl, createJsonlWriter, writeJson } from "../src/lib/io.mjs"
import {
  DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH,
  loadTechniquePatternDiscoveryContract,
} from "../src/lib/technique_pattern_discovery_contract.mjs"
import { ensureDateKey } from "../src/lib/technique_common.mjs"

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

const isDateWithinInclusiveRange = (dateKey, range) => {
  const safeDateKey = ensureDateKey(dateKey, "decisionDateKey")
  return safeDateKey >= range.startDateKey && safeDateKey <= range.endDateKey
}

const main = async () => {
  const args = parseArgs(process.argv)
  if (!args["rows-path"] || !args.out) {
    throw new Error(
      "Usage: node tools/build_technique_atomic_transactions.mjs --rows-path=<rows.jsonl> --out=<transactions.jsonl> [--summary-out=<summary.json>] [--contract-path=PATH] [--default-scope-id=SCOPE] [--default-lookback-candidate-id=ID] [--label-id=LABEL]",
    )
  }
  const cwd = process.cwd()
  const contract = await loadTechniquePatternDiscoveryContract({
    cwd,
    contractPath: args["contract-path"] || DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH,
  })
  const outPath = path.resolve(cwd, String(args.out))
  const writer = await createJsonlWriter(outPath)
  let inputRowCount = 0
  let transactionRowCount = 0
  let positiveTransactionCount = 0
  const uniqueAtomIds = new Set()
  const yearCounts = {}
  try {
    await iterateJsonl(path.resolve(cwd, String(args["rows-path"])), {
      strict: true,
      onRow: async (row) => {
        inputRowCount += 1
        const decisionDateKey = ensureDateKey(row?.decisionDateKey ?? row?.dateKey, "decisionDateKey")
        if (!isDateWithinInclusiveRange(decisionDateKey, contract.trainRange)) return
        const transaction = buildTechniqueAtomicTransactionRow({
          row,
          contract,
          labelId: args["label-id"] || contract.labelId,
          defaultScopeId: args["default-scope-id"] || null,
          defaultLookbackCandidateId: args["default-lookback-candidate-id"] || null,
        })
        transactionRowCount += 1
        if (transaction.hitTarget) positiveTransactionCount += 1
        yearCounts[String(transaction.yearKey)] = (yearCounts[String(transaction.yearKey)] ?? 0) + 1
        for (const atomId of transaction.atomIds) uniqueAtomIds.add(atomId)
        await writer.writeRow(transaction)
      },
    })
  } finally {
    await writer.close()
  }
  if (args["summary-out"]) {
    await writeJson(path.resolve(cwd, String(args["summary-out"])), {
      kind: "technique_atomic_transaction_build_summary_v1",
      contractId: contract.contractId,
      labelId: args["label-id"] || contract.labelId,
      inputRowCount,
      transactionRowCount,
      positiveTransactionCount,
      negativeTransactionCount: transactionRowCount - positiveTransactionCount,
      uniqueAtomCount: uniqueAtomIds.size,
      yearCounts,
      trainRange: contract.trainRange,
    })
  }
}

await main()
