#!/usr/bin/env node
import fs from "node:fs"
import { once } from "node:events"
import path from "node:path"

import { ensureDir, iterateJsonl, writeJson } from "../src/lib/io.mjs"
import {
  DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH,
  loadTechniquePatternDiscoveryContract,
} from "../src/lib/technique_pattern_discovery_contract.mjs"
import {
  TECHNIQUE_CONTRASTIVE_VETO_REPORT_KIND,
  createTechniqueContrastiveVetoRuntime,
  normalizeTechniqueContrastiveCorePattern,
  rankTechniqueContrastiveCorePatterns,
  searchTechniqueContrastiveVetoForPartition,
} from "../src/lib/technique_contrastive_veto_search.mjs"

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

const insertIntoPartitionShortlist = ({ shortlist, pattern, topK }) => {
  shortlist.push(pattern)
  shortlist.sort(rankTechniqueContrastiveCorePatterns)
  if (shortlist.length > topK) {
    shortlist.length = topK
  }
}

const main = async () => {
  const args = parseArgs(process.argv)
  if (!args["patterns-path"] || !args["transactions-path"] || !args.out) {
    throw new Error(
      "Usage: node tools/build_technique_contrastive_veto_report.mjs --patterns-path=<preverified_patterns.jsonl> --transactions-path=<atomic_transactions.jsonl> --out=<contrastive_patterns.jsonl> [--summary-out=<summary.json>] [--contract-path=PATH]",
    )
  }
  const cwd = process.cwd()
  const contract = await loadTechniquePatternDiscoveryContract({
    cwd,
    contractPath: args["contract-path"] || DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH,
  })

  const transactions = []
  await iterateJsonl(path.resolve(cwd, String(args["transactions-path"])), {
    strict: true,
    onRow: async (row) => {
      transactions.push(row)
    },
  })

  const runtime = createTechniqueContrastiveVetoRuntime({
    transactions,
    coreYears: contract.coreYears,
    minPositiveSupportPerYear: contract.minPositiveSupportPerYear,
    maxVetoAtomCount: contract.maxVetoAtomCount,
  })
  const safeTopPatternsPerPartition = Math.max(1, Math.floor(Number(contract.vetoSearchTopPatternsPerPartition) || 0))

  const shortlistedPatternsByPartition = new Map()
  await iterateJsonl(path.resolve(cwd, String(args["patterns-path"])), {
    strict: true,
    onRow: async (row) => {
      const pattern = normalizeTechniqueContrastiveCorePattern(row)
      let shortlist = shortlistedPatternsByPartition.get(pattern.partitionKey)
      if (!shortlist) {
        shortlist = []
        shortlistedPatternsByPartition.set(pattern.partitionKey, shortlist)
      }
      insertIntoPartitionShortlist({
        shortlist,
        pattern,
        topK: safeTopPatternsPerPartition,
      })
    },
  })

  const outPath = path.resolve(cwd, String(args.out))
  await ensureDir(path.dirname(outPath))
  const stream = fs.createWriteStream(outPath, { encoding: "utf8" })

  let evaluatedCorePatternCount = 0
  let contrastiveCandidateCount = 0
  let partitionCount = 0

  try {
    for (const [partitionKey, shortlistedPatterns] of shortlistedPatternsByPartition.entries()) {
      partitionCount += 1
      const report = searchTechniqueContrastiveVetoForPartition({
        patterns: shortlistedPatterns,
        runtime,
        topPatternsPerPartition: safeTopPatternsPerPartition,
        maxVetoAtomCount: contract.maxVetoAtomCount,
      })
      evaluatedCorePatternCount += report.evaluatedCorePatternCount
      contrastiveCandidateCount += report.contrastiveCandidateCount
      for (const row of report.vetoPatterns) {
        const ok = stream.write(`${JSON.stringify(row)}
`)
        if (!ok) await once(stream, "drain")
      }
    }
  } finally {
    stream.end()
    await once(stream, "finish")
  }

  if (args["summary-out"]) {
    await writeJson(path.resolve(cwd, String(args["summary-out"])), {
      kind: TECHNIQUE_CONTRASTIVE_VETO_REPORT_KIND,
      contractId: contract.contractId,
      labelId: contract.labelId,
      coreYears: contract.coreYears,
      minPositiveSupportPerYear: contract.minPositiveSupportPerYear,
      evaluatedCorePatternCount,
      partitionCount,
      topPatternsPerPartition: safeTopPatternsPerPartition,
      maxVetoAtomCount: contract.maxVetoAtomCount,
      contrastiveCandidateCount,
    })
  }
}

await main()
