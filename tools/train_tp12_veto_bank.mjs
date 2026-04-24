#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { trainTp12VetoBank } from "../src/lib/tp12_veto_bank_trainer.mjs"
import { toNumber, toText } from "../src/lib/tp12_year2hit_foundation_io.mjs"

const optionalNumberFlag = (flags, name) => {
  const value = getFlag(flags, name, undefined)
  if (value === undefined || value === null || toText(value) === "") return undefined
  return toNumber(value, NaN)
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const featuresPath = toText(getFlag(flags, "features", getFlag(flags, "features-path", "")))
  const selectorConfigPath = toText(getFlag(flags, "selector-config", getFlag(flags, "selector-config-path", "")))
  const candidateRulesPath = toText(getFlag(flags, "candidate-rules", getFlag(flags, "candidate-rules-path", "")))
  const outSummaryPath = toText(getFlag(flags, "out-summary", getFlag(flags, "summary", "")))
  const outRulesPath = toText(getFlag(flags, "out-rules", getFlag(flags, "rules", "")))
  const outPredictionsPath = toText(getFlag(flags, "out-pred", getFlag(flags, "out-predictions", "")))
  if (!featuresPath || !selectorConfigPath || !outSummaryPath || !outRulesPath || !outPredictionsPath) {
    throw new Error("train_tp12_veto_bank requires --features, --selector-config, --out-summary, --out-rules, and --out-pred")
  }
  const options = {
    minSelectedRows: optionalNumberFlag(flags, "min-selected-rows"),
    minPrecisionLift: optionalNumberFlag(flags, "min-precision-lift"),
    minSelectedHitRatioVsBaselineHitRows: optionalNumberFlag(flags, "min-selected-hit-ratio-vs-baseline-hit-rows"),
    h80MinSelectedRows: optionalNumberFlag(flags, "h80-min-selected-rows"),
    h80TargetHitRate: optionalNumberFlag(flags, "h80-target-hit-rate"),
    h80MinWilsonLower95: optionalNumberFlag(flags, "h80-min-wilson-lower95"),
    maxRuleSetSize: optionalNumberFlag(flags, "max-rule-set-size"),
    maxCandidateRuleSets: optionalNumberFlag(flags, "max-candidate-rule-sets"),
    allowSameFieldRulePairs: flags["allow-same-field-rule-pairs"] === true,
  }
  const summary = await trainTp12VetoBank({
    featuresPath: path.resolve(cwd, featuresPath),
    selectorConfigPath: path.resolve(cwd, selectorConfigPath),
    candidateRulesPath: candidateRulesPath ? path.resolve(cwd, candidateRulesPath) : "",
    outSummaryPath: path.resolve(cwd, outSummaryPath),
    outRulesPath: path.resolve(cwd, outRulesPath),
    outPredictionsPath: path.resolve(cwd, outPredictionsPath),
    options,
  })
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        mode: summary.mode,
        baseline: {
          selectedRows: summary.baseline.selectedRows,
          hitRows: summary.baseline.hitRows,
          hitRate: summary.baseline.hitRate,
          wilsonLower95: summary.baseline.wilsonLower95,
        },
        diagnosticPassedRuleCount: summary.diagnosticPassedRuleCount,
        h80PassedRuleCount: summary.h80PassedRuleCount,
        candidateRuleSetCount: summary.candidateRuleSetCount,
        bestDiagnosticRuleSetId: summary.bestDiagnosticRuleSet?.ruleSetId ?? null,
        bestDiagnosticRuleId: summary.bestDiagnosticRule?.ruleId ?? null,
        outSummaryPath: path.resolve(cwd, outSummaryPath),
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
