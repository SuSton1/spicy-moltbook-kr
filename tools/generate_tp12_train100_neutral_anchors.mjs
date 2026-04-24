#!/usr/bin/env node

import { generateTp12Train100NeutralAnchors } from "../src/lib/tp12_train100_neutral_anchor_generator.mjs"

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=")
  return [key, rest.join("=") || "true"]
}))

if (args.help) {
  console.log("usage: node tools/generate_tp12_train100_neutral_anchors.mjs --contract=<path> --atom-catalog=<path> --events=<path> [--max-visited-states=N] [--max-generated-anchors=N]")
  process.exit(0)
}

const summary = await generateTp12Train100NeutralAnchors({
  contractPath: args.contract,
  atomCatalogPath: args["atom-catalog"],
  eventsPath: args.events,
  maxAnchorAtoms: args["max-anchor-atoms"],
  maxVisitedStates: args["max-visited-states"],
  maxGeneratedAnchors: args["max-generated-anchors"],
  outPath: args.out,
  outSummaryPath: args.summary,
})
console.log(JSON.stringify({
  status: summary.status,
  generatedAnchorCount: summary.generatedAnchorCount,
  searchComplete: summary.searchComplete,
}, null, 2))
