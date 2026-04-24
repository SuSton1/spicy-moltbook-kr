#!/usr/bin/env node
import fs from "node:fs"
import { once } from "node:events"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"
import {
  TECHNIQUE_CLOSED_PATTERN_SET_KIND,
  iterateTechniqueClosedPatternRows,
  listTechniqueClosedPatternPartitionKeys,
  mineTechniqueClosedPatternsForPartition,
} from "../src/lib/technique_closed_pattern_miner.mjs"
import {
  DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH,
  loadTechniquePatternDiscoveryContract,
} from "../src/lib/technique_pattern_discovery_contract.mjs"

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
  if (!args["index-path"] || !args.out) {
    throw new Error(
      "Usage: node tools/build_technique_closed_patterns.mjs --index-path=<positive_year_index.json> --out=<patterns.jsonl> [--summary-out=<summary.json>] [--contract-path=PATH] [--max-patterns=N] [--max-pattern-size=N]",
    )
  }
  const cwd = process.cwd()
  const contract = await loadTechniquePatternDiscoveryContract({
    cwd,
    contractPath: args["contract-path"] || DEFAULT_TECHNIQUE_PATTERN_DISCOVERY_CONTRACT_PATH,
  })
  const positiveYearIndex = await readJson(path.resolve(cwd, String(args["index-path"])))
  const partitionKeys = listTechniqueClosedPatternPartitionKeys({ positiveYearIndex })
  const numericMaxPatterns = Number(args["max-patterns"])
  const effectiveMaxPatterns = Number.isInteger(numericMaxPatterns) && numericMaxPatterns > 0
    ? numericMaxPatterns
    : null
  const maxPatternSize = args["max-pattern-size"] || contract.maxPatternSize
  const outPath = path.resolve(cwd, String(args.out))
  await ensureDir(path.dirname(outPath))
  const stream = fs.createWriteStream(outPath, { encoding: "utf8" })
  let partitionCount = 0
  let eligibleAtomCount = 0
  let exploredNodeCount = 0
  let prunedByYearCount = 0
  let prunedByPairCount = 0
  let prunedByFamilyCapCount = 0
  let prunedByBaseFeatureCount = 0
  let rawPatternCount = 0
  let positiveSignatureCount = 0
  let closedPatternCount = 0
  let maxDepthReached = 0
  let hitPatternCap = false
  let patternIndex = 0
  try {
    for (const partitionKey of partitionKeys) {
      const remainingPatternBudget = effectiveMaxPatterns !== null
        ? Math.max(0, effectiveMaxPatterns - rawPatternCount)
        : null
      if (remainingPatternBudget === 0) {
        hitPatternCap = true
        break
      }
      const mined = mineTechniqueClosedPatternsForPartition({
        positiveYearIndex,
        partitionKey,
        coreYears: contract.coreYears,
        minPositiveSupportPerYear: contract.minPositiveSupportPerYear,
        maxPatternSize,
        maxPatterns: remainingPatternBudget,
        familyCaps: contract.familyCaps,
        maxGeneratorsPerSignature: contract.maxGeneratorsPerSignature,
        includePatterns: false,
      })
      partitionCount += 1
      eligibleAtomCount += mined.eligibleAtomCount
      exploredNodeCount += mined.exploredNodeCount
      prunedByYearCount += mined.prunedByYearCount
      prunedByPairCount += mined.prunedByPairCount
      prunedByFamilyCapCount += mined.prunedByFamilyCapCount
      prunedByBaseFeatureCount += mined.prunedByBaseFeatureCount
      rawPatternCount += mined.rawPatternCount
      positiveSignatureCount += mined.positiveSignatureCount
      closedPatternCount += mined.closedPatternCount
      maxDepthReached = Math.max(maxDepthReached, mined.maxDepthReached)
      hitPatternCap = hitPatternCap || mined.hitPatternCap === true
      for (const pattern of iterateTechniqueClosedPatternRows({ mined, startIndex: patternIndex })) {
        const ok = stream.write(`${JSON.stringify(pattern)}\n`)
        if (!ok) {
          await once(stream, "drain")
        }
      }
      patternIndex += mined.closedPatternCount
      if (hitPatternCap) break
    }
  } finally {
    stream.end()
    await once(stream, "finish")
  }
  if (args["summary-out"]) {
    await writeJson(path.resolve(cwd, String(args["summary-out"])), {
      kind: TECHNIQUE_CLOSED_PATTERN_SET_KIND,
      contractId: positiveYearIndex?.contractId ?? contract.contractId,
      labelId: contract.labelId,
      coreYears: contract.coreYears,
      minPositiveSupportPerYear: contract.minPositiveSupportPerYear,
      maxPatternSize: Math.max(1, Math.floor(Number(maxPatternSize) || 0)),
      maxGeneratorsPerSignature: contract.maxGeneratorsPerSignature,
      partitionCount,
      eligibleAtomCount,
      exploredNodeCount,
      prunedByYearCount,
      prunedByPairCount,
      prunedByFamilyCapCount,
      prunedByBaseFeatureCount,
      rawPatternCount,
      positiveSignatureCount,
      closedPatternCount,
      maxDepthReached,
      hitPatternCap,
    })
  }
}

await main()
