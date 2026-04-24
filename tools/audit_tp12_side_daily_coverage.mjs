#!/usr/bin/env node
import { auditTp12SideDailyCoverage } from "../src/lib/tp12_side_daily_coverage_audit.mjs"

const parseArgs = (argv) => {
  const out = {}
  const repeated = new Map()
  for (const arg of argv) {
    if (!arg.startsWith("--")) throw new Error(`unknown positional arg: ${arg}`)
    const index = arg.indexOf("=")
    const key = index === -1 ? arg.slice(2) : arg.slice(2, index)
    const value = index === -1 ? "true" : arg.slice(index + 1)
    if (key === "dataset") {
      const values = repeated.get(key) ?? []
      values.push(value)
      repeated.set(key, values)
    } else {
      out[key] = value
    }
  }
  for (const [key, values] of repeated.entries()) out[key] = values
  return out
}

const requireArg = (args, key) => {
  const value = args[key]
  if (!value) throw new Error(`missing required --${key}`)
  return value
}

const numberArg = (args, key, fallback) => {
  if (args[key] === undefined || args[key] === "") return fallback
  const parsed = Number(args[key])
  if (!Number.isFinite(parsed)) throw new Error(`--${key} must be finite`)
  return parsed
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const summary = await auditTp12SideDailyCoverage({
    candidatesPath: requireArg(args, "candidates"),
    datasets: Array.isArray(args.dataset) ? args.dataset : [requireArg(args, "dataset")],
    outSummaryPath: requireArg(args, "out-summary"),
    outMissingPath: requireArg(args, "out-missing"),
    dateFrom: args["date-from"] ?? null,
    dateTo: args["date-to"] ?? null,
    forbiddenDateFrom: args["forbidden-date-from"] ?? null,
    forbiddenDateTo: args["forbidden-date-to"] ?? null,
    minSameDateCoverage: numberArg(args, "min-same-date-coverage", 0.95),
    minStrictPriorCoverage: numberArg(args, "min-strict-prior-coverage", 0.95),
    minPriorOrSameCoverage: numberArg(args, "min-prior-or-same-coverage", 0.95),
    maxMissingExamplesPerDataset: numberArg(args, "max-missing-examples-per-dataset", 100),
  })
  console.log(JSON.stringify({
    status: summary.status,
    candidateRows: summary.candidateRows,
    candidateDateCount: summary.candidateDateCount,
    candidateSymbolCount: summary.candidateSymbolCount,
    failedDatasets: summary.coverageGate.failedDatasets,
    datasetCoverage: Object.fromEntries(
      summary.datasetSummaries.map((dataset) => [
        dataset.datasetId,
        {
          sameDateCoverageRate: dataset.sameDateCoverageRate,
          strictPriorCoverageRate: dataset.strictPriorCoverageRate,
          priorOrSameCoverageRate: dataset.priorOrSameCoverageRate,
          missingSameDateRows: dataset.missingSameDateRows,
        },
      ]),
    ),
    outSummaryPath: args["out-summary"],
    outMissingPath: args["out-missing"],
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
