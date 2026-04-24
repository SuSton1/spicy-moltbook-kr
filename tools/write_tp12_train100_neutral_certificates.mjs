#!/usr/bin/env node

import { writeTp12Train100NeutralExpressionSpaceCertificate } from "../src/lib/tp12_train100_neutral_certificate_writer.mjs"

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=")
  return [key, rest.join("=") || "true"]
}))

if (args.help) {
  console.log("usage: node tools/write_tp12_train100_neutral_certificates.mjs --contract=<path>")
  process.exit(0)
}

const summary = await writeTp12Train100NeutralExpressionSpaceCertificate({
  contractPath: args.contract,
  featureManifestPath: args["feature-manifest"],
  atomManifestPath: args["atom-manifest"],
  anchorSummaryPath: args["anchor-summary"],
  searchSummaryPath: args["search-summary"],
  verifierSummaryPath: args["verifier-summary"],
  outSummaryPath: args.out,
  outReportPath: args.report,
})
console.log(JSON.stringify({
  conclusion: summary.conclusion.code,
  verifiedPatternCount: summary.metrics.verifiedPatternCount,
  absenceProvenInScope: summary.conclusion.absenceProvenInScope,
}, null, 2))

