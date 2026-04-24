#!/usr/bin/env node

import { verifyTp12Train100NeutralSurvivors } from "../src/lib/tp12_train100_neutral_exact_verifier.mjs"

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=")
  return [key, rest.join("=") || "true"]
}))

if (args.help) {
  console.log("usage: node tools/verify_tp12_train100_neutral_survivors.mjs --contract=<path> --patterns=<path> --atom-catalog=<path> --events=<path>")
  process.exit(0)
}

const summary = await verifyTp12Train100NeutralSurvivors({
  contractPath: args.contract,
  patternsPath: args.patterns,
  atomCatalogPath: args["atom-catalog"],
  eventsPath: args.events,
  outSummaryPath: args["out-summary"],
  outSurvivorsPath: args["out-survivors"],
})
console.log(JSON.stringify({
  inputPatternCount: summary.inputPatternCount,
  verifiedPatternCount: summary.verifiedPatternCount,
  rejectedPatternCount: summary.rejectedPatternCount,
}, null, 2))

