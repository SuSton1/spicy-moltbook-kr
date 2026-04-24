#!/usr/bin/env node

import { mineTp12Train100NeutralAnchorVetoPatterns } from "../src/lib/tp12_train100_neutral_anchor_veto_miner.mjs"

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=")
  return [key, rest.join("=") || "true"]
}))

if (args.help) {
  console.log("usage: node tools/mine_tp12_train100_neutral_anchor_veto_patterns.mjs --contract=<path> --anchors=<path> --atom-catalog=<path> --events=<path> [--max-anchors=N] [--max-generated-veto-clauses-per-anchor=N] [--max-visited-veto-states-per-anchor=N]")
  process.exit(0)
}

const summary = await mineTp12Train100NeutralAnchorVetoPatterns({
  contractPath: args.contract,
  anchorsPath: args.anchors,
  atomCatalogPath: args["atom-catalog"],
  eventsPath: args.events,
  outFoundPath: args["out-found"],
  outRejectedPath: args["out-rejected"],
  outFrontierPath: args["out-frontier"],
  outSummaryPath: args.summary,
  maxAnchors: args["max-anchors"],
  maxGeneratedVetoClausesPerAnchor: args["max-generated-veto-clauses-per-anchor"],
  maxVisitedVetoStatesPerAnchor: args["max-visited-veto-states-per-anchor"],
  maxAnchorFalsePositiveRowsForVeto: args["max-anchor-false-positive-rows"],
})
console.log(JSON.stringify({
  status: summary.status,
  foundPatternCount: summary.foundPatternCount,
  incompleteAnchorCount: summary.incompleteAnchorCount,
}, null, 2))
