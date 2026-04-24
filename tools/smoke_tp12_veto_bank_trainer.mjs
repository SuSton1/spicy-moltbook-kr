#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { trainTp12VetoBank } from "../src/lib/tp12_veto_bank_trainer.mjs"
import { main as runTrainTp12VetoBankCli } from "./train_tp12_veto_bank.mjs"

const writeJson = async (filePath, payload) => fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const featureRow = ({ date, symbol, hitTarget, score, rangePct, closeLocation = 0.7 }) => ({
  kind: "tp12_context_consensus_feature_v1",
  decisionDateKey: date,
  symbol,
  hitTarget,
  selectorScore: score,
  supportPatternCount: 1,
  supportClusterCount: 1,
  supportClusterIds: [`cluster_${symbol}`],
  supportClusterSummaries: [{ clusterId: `cluster_${symbol}` }],
  familyDiversity: 2,
  nearDuplicatePatternPenalty: 0,
  dayScoreMargin: score,
  tradedValueRankPct: 0.2,
  marketUpRatio: 0.55,
  rangePct,
  closeLocation,
  return1d: 0.02,
  openToCloseReturn: 0.01,
  limitUpProxyCount: 3,
  marketMedianReturn1d: 0.002,
  daySymbolDateCandidateRows: 2,
})

const root = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-veto-bank-"))
const featuresPath = path.join(root, "features.jsonl")
const selectorConfigPath = path.join(root, "selector.json")
const candidateRulesPath = path.join(root, "rules.json")
const outSummaryPath = path.join(root, "summary.json")
const outRulesPath = path.join(root, "veto-rules.json")
const outPredictionsPath = path.join(root, "predictions.jsonl")
const cliOutSummaryPath = path.join(root, "cli-summary.json")
const cliOutRulesPath = path.join(root, "cli-veto-rules.json")
const cliOutPredictionsPath = path.join(root, "cli-predictions.jsonl")
const pairFeaturesPath = path.join(root, "pair-features.jsonl")
const pairRulesPath = path.join(root, "pair-rules.json")
const pairOutSummaryPath = path.join(root, "pair-summary.json")
const pairOutRulesPath = path.join(root, "pair-veto-rules.json")
const pairOutPredictionsPath = path.join(root, "pair-predictions.jsonl")

await writeJsonl(featuresPath, [
  featureRow({ date: "2021-01-04", symbol: "000010", hitTarget: false, score: 10, rangePct: 0.3 }),
  featureRow({ date: "2021-01-04", symbol: "000020", hitTarget: true, score: 9, rangePct: 0.04 }),
  featureRow({ date: "2021-01-05", symbol: "000030", hitTarget: false, score: 10, rangePct: 0.25 }),
  featureRow({ date: "2021-01-05", symbol: "000040", hitTarget: true, score: 9, rangePct: 0.05 }),
  featureRow({ date: "2021-01-06", symbol: "000050", hitTarget: true, score: 10, rangePct: 0.04 }),
  featureRow({ date: "2021-01-06", symbol: "000060", hitTarget: false, score: 9, rangePct: 0.04 }),
  featureRow({ date: "2021-01-07", symbol: "000070", hitTarget: true, score: 10, rangePct: 0.04 }),
  featureRow({ date: "2021-01-07", symbol: "000080", hitTarget: false, score: 9, rangePct: 0.04 }),
])
await writeJson(selectorConfigPath, {
  selectionPolicyId: "smoke_selector",
  scoreField: "selectorScore",
})
await writeJson(candidateRulesPath, {
  rules: [{ field: "rangePct", op: "ge", threshold: 0.2 }],
})

const summary = await trainTp12VetoBank({
  featuresPath,
  selectorConfigPath,
  candidateRulesPath,
  outSummaryPath,
  outRulesPath,
  outPredictionsPath,
  options: {
    minSelectedRows: 4,
    minPrecisionLift: 0.25,
    minSelectedHitRatioVsBaselineHitRows: 1,
  },
})
assert.equal(summary.status, "passed")
assert.equal(summary.baseline.selectedRows, 4)
assert.equal(summary.baseline.hitRows, 2)
assert.equal(summary.diagnosticPassedRuleCount, 1)
assert.equal(summary.bestDiagnosticRule.ruleId, "veto_rangePct_ge_0p2")
assert.equal(summary.bestDiagnosticRule.result.hitRows, 4)
assert.equal(summary.bestDiagnosticRule.result.hitRate, 1)

const ruleBank = JSON.parse(await fs.readFile(outRulesPath, "utf8"))
assert.equal(ruleBank.status, "diagnostic_only_not_locked")
assert.equal(ruleBank.lockedRuleCount, 0)
assert.equal(ruleBank.diagnosticCandidateRuleSets.length, 1)
assert.equal(ruleBank.diagnosticCandidateRules.length, 1)

await writeJsonl(pairFeaturesPath, [
  featureRow({ date: "2021-02-01", symbol: "100010", hitTarget: false, score: 10, rangePct: 0.3, closeLocation: 0.1 }),
  featureRow({ date: "2021-02-01", symbol: "100020", hitTarget: true, score: 9, rangePct: 0.03, closeLocation: 0.7 }),
  featureRow({ date: "2021-02-02", symbol: "100030", hitTarget: false, score: 10, rangePct: 0.25, closeLocation: 0.2 }),
  featureRow({ date: "2021-02-02", symbol: "100040", hitTarget: true, score: 9, rangePct: 0.04, closeLocation: 0.8 }),
  featureRow({ date: "2021-02-03", symbol: "100050", hitTarget: true, score: 10, rangePct: 0.3, closeLocation: 0.8 }),
  featureRow({ date: "2021-02-03", symbol: "100060", hitTarget: false, score: 9, rangePct: 0.04, closeLocation: 0.7 }),
  featureRow({ date: "2021-02-04", symbol: "100070", hitTarget: true, score: 10, rangePct: 0.04, closeLocation: 0.1 }),
  featureRow({ date: "2021-02-04", symbol: "100080", hitTarget: false, score: 9, rangePct: 0.04, closeLocation: 0.7 }),
])
await writeJson(pairRulesPath, {
  rules: [
    { field: "rangePct", op: "ge", threshold: 0.2 },
    { field: "closeLocation", op: "le", threshold: 0.25 },
  ],
})
const pairSummary = await trainTp12VetoBank({
  featuresPath: pairFeaturesPath,
  selectorConfigPath,
  candidateRulesPath: pairRulesPath,
  outSummaryPath: pairOutSummaryPath,
  outRulesPath: pairOutRulesPath,
  outPredictionsPath: pairOutPredictionsPath,
  options: {
    minSelectedRows: 4,
    minPrecisionLift: 0.4,
    minSelectedHitRatioVsBaselineHitRows: 1,
    maxRuleSetSize: 2,
  },
})
assert.equal(pairSummary.candidateRuleCount, 2)
assert.equal(pairSummary.candidateRuleSetCount, 3)
assert.deepEqual(pairSummary.candidateRuleSetSizeCounts, { "1": 2, "2": 1 })
assert.equal(pairSummary.diagnosticPassedRuleCount, 1)
assert.equal(pairSummary.bestDiagnosticRule, null)
assert.equal(pairSummary.bestDiagnosticRuleSet.ruleSetSize, 2)
assert.equal(pairSummary.bestDiagnosticRuleSet.result.hitRows, 4)
assert.equal(pairSummary.bestDiagnosticRuleSet.result.hitRate, 1)

await runTrainTp12VetoBankCli(
  [
    "--features",
    featuresPath,
    "--selector-config",
    selectorConfigPath,
    "--candidate-rules",
    candidateRulesPath,
    "--out-summary",
    cliOutSummaryPath,
    "--out-rules",
    cliOutRulesPath,
    "--out-pred",
    cliOutPredictionsPath,
  ],
  { cwd: "/" },
)
const cliSummary = JSON.parse(await fs.readFile(cliOutSummaryPath, "utf8"))
assert.equal(cliSummary.options.minSelectedRows, 100)
assert.equal(cliSummary.options.minPrecisionLift, 0.03)
assert.equal(cliSummary.options.h80TargetHitRate, 0.8)
assert.equal(cliSummary.options.h80MinWilsonLower95, 0.8)
assert.equal(cliSummary.options.maxRuleSetSize, 1)
assert.equal(cliSummary.candidateRuleSetCount, 1)
assert.equal(cliSummary.diagnosticPassedRuleCount, 0)
assert.equal(cliSummary.h80PassedRuleCount, 0)

await fs.rm(root, { recursive: true, force: true })
console.log("ok")
