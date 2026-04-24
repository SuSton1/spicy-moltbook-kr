#!/usr/bin/env node

import { buildTp12Train100NeutralAtomBitsets } from "../src/lib/tp12_train100_neutral_atom_bitsets.mjs"

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=")
  return [key, rest.join("=") || "true"]
}))

if (args.help) {
  console.log("usage: node tools/build_tp12_train100_neutral_atom_bitsets.mjs --contract=<path> --events=<path> --feature-catalog=<path>")
  process.exit(0)
}

const summary = await buildTp12Train100NeutralAtomBitsets({
  contractPath: args.contract,
  eventsPath: args.events,
  featureCatalogPath: args["feature-catalog"],
  outAtomsPath: args["out-atoms"],
  outManifestPath: args["out-manifest"],
  outSupportSummaryPath: args["out-support-summary"],
})
console.log(JSON.stringify({
  emittedAtomCount: summary.emittedAtomCount,
  trainRowCount: summary.trainRowCount,
  oosRead: summary.oosRead,
}, null, 2))

