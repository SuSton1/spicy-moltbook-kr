#!/usr/bin/env node

import { buildTp12Train100NeutralEventRows } from "../src/lib/tp12_train100_neutral_event_builder.mjs"

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=")
  return [key, rest.join("=") || "true"]
}))

if (args.help) {
  console.log(
    "usage: node tools/build_tp12_train100_neutral_events.mjs --contract=<path> --candidate-events=<path> --context-features=<path> --out=<path> --summary=<path> [--pattern-clusters=<path>]",
  )
  process.exit(0)
}

const summary = await buildTp12Train100NeutralEventRows({
  contractPath: args.contract,
  candidateEventsPath: args["candidate-events"],
  contextFeaturesPath: args["context-features"],
  patternClustersPath: args["pattern-clusters"] ?? "",
  outPath: args.out,
  summaryPath: args.summary,
})

console.log(JSON.stringify({
  status: summary.status,
  outputRowCount: summary.outputRowCount,
  hitRows: summary.hitRows,
  hitRate: summary.hitRate,
  oosRead: summary.oosRead,
}, null, 2))
