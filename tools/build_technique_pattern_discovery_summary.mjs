#!/usr/bin/env node
import path from "node:path"

import { readJsonl, writeJson } from "../src/lib/io.mjs"
import { rankTechniqueVerifiedPatterns } from "../src/lib/technique_survivor_ranker.mjs"

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
  if (!args["patterns-path"] || !args.out) {
    throw new Error(
      "Usage: node tools/build_technique_pattern_discovery_summary.mjs --patterns-path=<verified_patterns.jsonl> --out=<summary.json> [--top-out=<top_patterns.json>] [--top-k=N]",
    )
  }
  const cwd = process.cwd()
  const patterns = await readJsonl(path.resolve(cwd, String(args["patterns-path"])))
  const ranked = rankTechniqueVerifiedPatterns({
    patterns,
    topK: args["top-k"] || 25,
  })
  await writeJson(path.resolve(cwd, String(args.out)), {
    kind: ranked.kind,
    verifiedPatternCount: ranked.verifiedPatternCount,
    topPatternCount: ranked.topPatternCount,
    topPatternIds: ranked.topPatternIds,
    topPatterns: ranked.topPatterns,
  })
  if (args["top-out"]) {
    await writeJson(path.resolve(cwd, String(args["top-out"])), ranked.rankedPatterns)
  }
}

await main()
