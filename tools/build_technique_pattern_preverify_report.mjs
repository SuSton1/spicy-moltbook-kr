#!/usr/bin/env node
import fs from "node:fs"
import { once } from "node:events"
import path from "node:path"

import { ensureDir, iterateJsonl, readJson, writeJson } from "../src/lib/io.mjs"
import {
  DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH,
  loadTechniquePatternDiscoveryContract,
} from "../src/lib/technique_pattern_discovery_contract.mjs"
import { preverifyTechniquePatternCandidates } from "../src/lib/technique_pattern_preverifier.mjs"

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
  if (!args["patterns-path"] || !args["negative-index-path"] || !args.out) {
    throw new Error(
      "Usage: node tools/build_technique_pattern_preverify_report.mjs --patterns-path=<patterns.jsonl> --negative-index-path=<negative_atom_index.json> --out=<preverified_patterns.jsonl> [--summary-out=<summary.json>] [--contract-path=PATH] [--top-k-per-signature=N]",
    )
  }
  const cwd = process.cwd()
  const contract = await loadTechniquePatternDiscoveryContract({
    cwd,
    contractPath: args["contract-path"] || DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH,
  })
  const negativeAtomIndex = await readJson(path.resolve(cwd, String(args["negative-index-path"])))
  const outPath = path.resolve(cwd, String(args.out))
  const safeTopK = args["top-k-per-signature"] || contract.preverifyTopKPerSignature
  await ensureDir(path.dirname(outPath))
  const stream = fs.createWriteStream(outPath, { encoding: "utf8" })

  let currentSignatureKey = null
  let currentRows = []
  let evaluatedPatternCount = 0
  let retainedPatternCount = 0
  let zeroNegativeCandidateCount = 0
  let signatureCount = 0

  const flushCurrentRows = async () => {
    if (currentRows.length < 1) return
    const report = preverifyTechniquePatternCandidates({
      patterns: currentRows,
      negativeAtomIndex,
      topKPerSignature: safeTopK,
    })
    evaluatedPatternCount += report.evaluatedPatternCount
    retainedPatternCount += report.retainedPatternCount
    zeroNegativeCandidateCount += report.zeroNegativeCandidateCount
    signatureCount += report.signatureCount
    for (const row of report.retainedPatterns) {
      const ok = stream.write(`${JSON.stringify(row)}\n`)
      if (!ok) {
        await once(stream, "drain")
      }
    }
    currentRows = []
  }

  try {
    await iterateJsonl(path.resolve(cwd, String(args["patterns-path"])), {
      strict: true,
      onRow: async (row) => {
        const signatureKey = `${String(row?.partitionKey ?? "")}::${String(row?.positiveSignatureId ?? row?.patternId ?? "")}`
        if (currentSignatureKey !== null && signatureKey !== currentSignatureKey) {
          await flushCurrentRows()
        }
        currentSignatureKey = signatureKey
        currentRows.push(row)
      },
    })
    await flushCurrentRows()
  } finally {
    stream.end()
    await once(stream, "finish")
  }

  if (args["summary-out"]) {
    await writeJson(path.resolve(cwd, String(args["summary-out"])), {
      kind: "technique_pattern_preverify_report_v1",
      contractId: contract.contractId,
      labelId: contract.labelId,
      evaluatedPatternCount,
      retainedPatternCount,
      zeroNegativeCandidateCount,
      signatureCount,
      topKPerSignature: Math.max(1, Math.floor(Number(safeTopK) || 0)),
    })
  }
}

await main()
