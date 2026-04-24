#!/usr/bin/env node
import { parseCliArgs, writeTp12Train100PositiveMotifCertificate } from "../src/lib/tp12_train100_positive_motif_common.mjs"

const args = parseCliArgs()
if (args.help) {
  console.log("usage: node tools/write_tp12_train100_positive_motif_certificates.mjs --contract=<path> [--motif-manifest=<path>] [--catalog-manifest=<path>] [--mining-summary=<path>] [--veto-summary=<path>] [--verifier-summary=<path>] [--out=<path>]")
  process.exit(0)
}
const summary = await writeTp12Train100PositiveMotifCertificate({
  contractPath: args.contract,
  motifManifestPath: args["motif-manifest"],
  motifCatalogManifestPath: args["catalog-manifest"],
  miningSummaryPath: args["mining-summary"],
  vetoSummaryPath: args["veto-summary"],
  verifierSummaryPath: args["verifier-summary"],
  outPath: args.out,
})
console.log(JSON.stringify({ conclusion: summary.conclusion.code, verifiedPatternCount: summary.metrics.verifiedPatternCount }, null, 2))

