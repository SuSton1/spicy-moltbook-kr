#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { buildTp12Year2hitTrainGateSummary } from "../src/lib/tp12_year2hit_train_gate.mjs"

const toText = (value) => String(value ?? "").trim()

const parseYears = (value) =>
  toText(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item))

const parseBoolFlag = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback
  if (value === true || value === false) return value
  const text = toText(value).toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  return fallback
}
const parseOptionalBoolFlag = (value) => (value === undefined || value === null ? undefined : parseBoolFlag(value, false))

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const eventsPath = toText(getFlag(flags, "events-path", ""))
  const contractPath = toText(getFlag(flags, "contract-path", ""))
  const outPath = toText(getFlag(flags, "out", ""))
  const trainDateFrom = toText(getFlag(flags, "train-from", ""))
  const trainDateTo = toText(getFlag(flags, "train-to", ""))
  const coreYearsRaw = toText(getFlag(flags, "core-years", ""))
  const excludedBoundaryYearsRaw = toText(getFlag(flags, "excluded-boundary-years", ""))
  const minHitsRaw = toText(getFlag(flags, "min-hits-per-year", ""))
  const hitField = toText(getFlag(flags, "hit-field", ""))
  const hitDefinition = toText(getFlag(flags, "hit-definition", ""))
  const outRuleIdsPath = toText(getFlag(flags, "out-rule-ids", ""))
  const outSurvivorsPath = toText(getFlag(flags, "out-survivors-jsonl", ""))
  const outRejectedPath = toText(getFlag(flags, "out-rejected-jsonl", ""))
  if (!eventsPath || !outPath) {
    throw new Error("build_tp12_year2hit_train_gate_summary requires --events-path and --out")
  }
  const summary = await buildTp12Year2hitTrainGateSummary({
    eventsPath: path.resolve(cwd, eventsPath),
    contractPath: contractPath ? path.resolve(cwd, contractPath) : null,
    outPath: path.resolve(cwd, outPath),
    trainDateFrom: trainDateFrom || undefined,
    trainDateTo: trainDateTo || undefined,
    coreYears: coreYearsRaw ? parseYears(coreYearsRaw) : undefined,
    excludedBoundaryYears: excludedBoundaryYearsRaw ? parseYears(excludedBoundaryYearsRaw) : undefined,
    minHitsPerYear: minHitsRaw ? Number(minHitsRaw) : undefined,
    hitField: hitField || undefined,
    hitDefinition: hitDefinition || undefined,
    failOnInvalidRows: parseOptionalBoolFlag(getFlag(flags, "fail-on-invalid-rows", undefined)),
    failOnZeroSurvivors: parseOptionalBoolFlag(getFlag(flags, "fail-on-zero-survivors", undefined)),
    requireCoreYearsWithinTrain: parseOptionalBoolFlag(getFlag(flags, "require-core-years-within-train", undefined)),
    outRuleIdsPath: outRuleIdsPath ? path.resolve(cwd, outRuleIdsPath) : null,
    outSurvivorsPath: outSurvivorsPath ? path.resolve(cwd, outSurvivorsPath) : null,
    outRejectedPath: outRejectedPath ? path.resolve(cwd, outRejectedPath) : null,
  })
  console.log(
    JSON.stringify(
      {
        outPath: path.resolve(cwd, outPath),
        status: summary.status,
        yearHitMetric: summary.yearHitMetric,
        hitDefinition: summary.hitDefinition,
        hitField: summary.hitField,
        patternCount: summary.patternCount,
        survivorCount: summary.survivorCount,
        survivorPatternIdsSha256: summary.survivorPatternIdsSha256,
        rejectedPatternCount: summary.rejectedPatternCount,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
