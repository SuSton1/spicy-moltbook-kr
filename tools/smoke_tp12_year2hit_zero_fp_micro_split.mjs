#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { main as buildMicroSplit } from "./build_tp12_year2hit_zero_fp_micro_split.mjs"
import { writeJson } from "../src/lib/io.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-micro-split-"))
const contractPath = path.join(tmp, "contract.json")
const enrichedPath = path.join(tmp, "enriched.jsonl")
const rulesPath = path.join(tmp, "rules.jsonl")
const outDir = path.join(tmp, "out")

const coreYears = Array.from({ length: 9 }, (_, index) => 2016 + index)
const rows = []
for (const year of coreYears) {
  rows.push({
    decisionDateKey: `${year}-01-04`,
    symbol: `H${year}A`,
    hitTarget: true,
    labelClass: "positive",
    maxForwardReturn: 0.2,
    supportPatternIds: ["P1"],
    supportClusterIds: ["C1"],
    supportTokenSet: ["shape:good"],
    tokenFamilies: ["shape"],
    returnVol20: 0.9,
  })
  rows.push({
    decisionDateKey: `${year}-01-05`,
    symbol: `H${year}B`,
    hitTarget: true,
    labelClass: "positive",
    maxForwardReturn: 0.18,
    supportPatternIds: ["P1"],
    supportClusterIds: ["C1"],
    supportTokenSet: ["shape:good"],
    tokenFamilies: ["shape"],
    returnVol20: 0.8,
  })
}
rows.push({
  decisionDateKey: "2018-02-01",
  symbol: "FP1",
  hitTarget: false,
  labelClass: "hard_negative",
  maxForwardReturn: 0.01,
  supportPatternIds: ["P1"],
  supportClusterIds: ["C1"],
  supportTokenSet: ["shape:bad"],
  tokenFamilies: ["shape"],
  returnVol20: 0.1,
})
rows.push({
  decisionDateKey: "2020-02-01",
  symbol: "FP2",
  hitTarget: false,
  labelClass: "easy_negative",
  maxForwardReturn: 0.04,
  supportPatternIds: ["P1"],
  supportClusterIds: ["C1"],
  supportTokenSet: ["shape:bad"],
  tokenFamilies: ["shape"],
  returnVol20: 0.2,
})

const hitDatesByYear = Object.fromEntries(coreYears.map((year) => [String(year), 2]))
await writeJson(contractPath, {
  kind: "tp12_year2hit_zero_fp_micro_split_contract_v1",
  trainDateRange: { from: "2016-01-04", to: "2024-12-30" },
  forbiddenDateRange: { from: "2025-01-02", to: "2026-04-17" },
  coreYears,
  target: {
    minHitDecisionDatesPerYear: 2,
    minHitSymbolDatesPerYear: 2,
    minPositiveSymbolDatesTotal: 18,
    requiredTrainPrecision: 1,
    maxFalsePositiveRows: 0,
  },
  parents: {
    enabledBaseTypes: ["pattern"],
    maxParentRows: 100,
    maxParents: 4,
  },
  atomBuilder: {
    includeSupportPatternAtoms: true,
    includeSupportClusterAtoms: true,
    includeSupportTokenAtoms: true,
    includeTokenFamilyAtoms: true,
    includeNumericRankAtoms: false,
    maxTokenAtomsPerParent: 20,
    maxPatternAtomsPerParent: 20,
    maxClusterAtomsPerParent: 20,
  },
  mining: {
    includeSourceRuleCores: true,
    maxSourceRuleCoreDepth: 4,
    maxAtomPoolPerParent: 40,
    coreTopAtomCount: 20,
    maxCoreAtoms: 2,
    maxEvaluatedCoresPerParent: 200,
    maxCoreFalsePositiveRowsForVeto: 10,
    maxVetoAtoms: 2,
    maxVetoCandidatesPerCore: 20,
    minTileHitRows: 1,
    maxZeroFpTilesPerParent: 40,
  },
  cover: {
    maxTilesPerCover: 3,
    beamWidth: 20,
    maxCoverCandidatesPerParent: 4,
  },
})
await writeJsonl(enrichedPath, rows)
await writeJsonl(rulesPath, [
  {
    baseType: "pattern",
    baseId: "P1",
    depth: 0,
    atomLabels: [],
    atoms: [],
    metrics: {
      matchRows: 20,
      hitRows: 18,
      falsePositiveRows: 2,
      hitDatesByYear,
      minHitDatesPerObservedYear: 2,
      year2hitPassed: true,
    },
    replayMetrics: {
      matchRows: 20,
      hitRows: 18,
      falsePositiveRows: 2,
      precision: 0.9,
      hitDatesByYear,
      hitSymbolDatesByYear: hitDatesByYear,
      minHitDatesPerYear: 2,
      minHitSymbolDatesPerYear: 2,
      year2hitPassed: true,
    },
    replaySampleFalsePositiveRows: [{ decisionDateKey: "2018-02-01", symbol: "FP1" }],
  },
])

await buildMicroSplit(
  [
    "--contract",
    contractPath,
    "--enriched",
    enrichedPath,
    "--broken-rules",
    rulesPath,
    "--out-dir",
    outDir,
  ],
  { cwd: process.cwd() },
)

const summary = JSON.parse(await fs.readFile(path.join(outDir, "micro_split_summary.json"), "utf8"))
assert.equal(summary.finalSurvivorCount >= 1, true)
assert.equal(summary.verdict, "survivors_found")
const survivors = (await fs.readFile(path.join(outDir, "micro_split_final_survivors.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
assert.equal(survivors[0].metrics.falsePositiveRows, 0)
assert.equal(survivors[0].metrics.year2hitPassed, true)

console.log("ok smoke_tp12_year2hit_zero_fp_micro_split")
