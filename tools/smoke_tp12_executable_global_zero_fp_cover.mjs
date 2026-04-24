#!/usr/bin/env node

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { writeJson } from "../src/lib/io.mjs"
import { main as buildMicroSplit } from "./build_tp12_year2hit_zero_fp_micro_split.mjs"
import { main as replayExecutableCovers } from "./replay_tp12_micro_split_covers_executable.mjs"

const writeJsonl = async (filePath, rows) => {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-executable-global-cover-"))
try {
  const enrichedPath = path.join(tmp, "operational_rows.jsonl")
  const contractPath = path.join(tmp, "contract.json")
  const rulesPath = path.join(tmp, "rules.jsonl")
  const outDir = path.join(tmp, "micro")
  const replayDir = path.join(tmp, "replay")

  const row = ({ decisionDateKey, symbol, patternId, clusterId, token }) => ({
    decisionDateKey,
    symbol,
    chartHitTarget: true,
    executableHitTarget: true,
    entryExecutable: true,
    labelClass: "positive",
    supportPatternIds: [patternId],
    supportClusterIds: [clusterId],
    supportTokenSet: [token],
    tokenFamilies: ["shape"],
    gapPct: 0.01,
    execution: {
      decisionClose: 100,
      entryOpen: 100,
      entryHigh: 113,
      entryLow: 99,
      entryClose: 110,
      entryVolume: 1000,
      entryGapPct: 0,
      targetPrice: 112,
    },
  })

  await writeJsonl(enrichedPath, [
    row({ decisionDateKey: "2016-01-04", symbol: "A1", patternId: "P_A", clusterId: "C_A", token: "shape:A" }),
    row({ decisionDateKey: "2016-02-04", symbol: "A2", patternId: "P_A", clusterId: "C_A", token: "shape:A" }),
    row({ decisionDateKey: "2017-01-04", symbol: "B1", patternId: "P_B", clusterId: "C_B", token: "shape:B" }),
    row({ decisionDateKey: "2017-02-04", symbol: "B2", patternId: "P_B", clusterId: "C_B", token: "shape:B" }),
  ])

  await writeJson(contractPath, {
    kind: "tp12_year2hit_zero_fp_micro_split_contract_v1",
    hitDefinition: "executable_hit_v1",
    trainDateRange: { from: "2016-01-04", to: "2017-12-29" },
    coreYears: [2016, 2017],
    target: {
      hitDefinition: "executable_hit_v1",
      minHitDecisionDatesPerYear: 2,
      minHitSymbolDatesPerYear: 2,
      minPositiveSymbolDatesTotal: 4,
      requiredTrainPrecision: 1,
      maxFalsePositiveRows: 0,
    },
    parents: { enabledBaseTypes: ["pattern"], maxParentRows: 20, maxParents: 4 },
    globalCover: {
      enabled: true,
      cover: { maxTilesPerCover: 2, beamWidth: 20, maxTilePoolForCover: 20, maxCoverCandidatesPerParent: 4 },
      greedy: { enabled: true, maxTilesPerCover: 2, maxTilePoolForCover: 20, maxSeedTiles: 4, maxCoverCandidates: 4 },
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
      maxVetoAtoms: 1,
      maxVetoCandidatesPerCore: 20,
      minTileHitRows: 1,
      maxZeroFpTilesForCoverPerParent: 20,
    },
    cover: { maxTilesPerCover: 2, beamWidth: 20, maxTilePoolForCover: 20, maxCoverCandidatesPerParent: 4 },
  })
  await writeJsonl(rulesPath, [
    { baseType: "pattern", baseId: "P_A", atoms: [], replayMetrics: { matchRows: 2, hitRows: 2, falsePositiveRows: 0 } },
    { baseType: "pattern", baseId: "P_B", atoms: [], replayMetrics: { matchRows: 2, hitRows: 2, falsePositiveRows: 0 } },
  ])

  await buildMicroSplit(
    ["--contract", contractPath, "--enriched", enrichedPath, "--broken-rules", rulesPath, "--out-dir", outDir],
    { cwd: process.cwd() },
  )
  const summary = JSON.parse(await fs.readFile(path.join(outDir, "micro_split_summary.json"), "utf8"))
  assert.equal(summary.finalSurvivorCount, 0)
  assert.equal(summary.globalCoverEnabled, true)
  assert.equal(summary.globalFinalSurvivorCount >= 1, true)
  assert.equal(summary.globalGreedyFinalSurvivorCount >= 1, true)

  await replayExecutableCovers(
    [
      "--contract",
      contractPath,
      "--survivors",
      path.join(outDir, "micro_split_global_greedy_final_survivors.jsonl"),
      "--enriched",
      enrichedPath,
      "--date-from",
      "2016-01-04",
      "--date-to",
      "2017-12-29",
      "--out-dir",
      replayDir,
    ],
    { cwd: process.cwd() },
  )
  const replay = JSON.parse(await fs.readFile(path.join(replayDir, "executable_cover_replay_summary.json"), "utf8"))
  assert.equal(replay.zeroOperationalFalsePositiveYear2CoverCount >= 1, true)
  assert.equal(replay.unionMetrics.totalRows, 4)
  assert.equal(replay.unionMetrics.operationalFalsePositiveRows, 0)

  const gatedContractPath = path.join(tmp, "gated_contract.json")
  const gatedOutDir = path.join(tmp, "gated_micro")
  const gatedContract = JSON.parse(await fs.readFile(contractPath, "utf8"))
  gatedContract.globalCover.cover.maxCoverCandidatesPerParent = 0
  gatedContract.globalCover.greedy.stabilityGate = {
    enabled: true,
    minTileMatchRows: 3,
    minTileHitRows: 3,
    maxTileFalsePositiveRows: 0,
    minTilePositiveYears: 2,
    minPerYearTileContributorCount: 1,
    minHitDatesPerYearAfterSingleTileDrop: 1,
    minHitSymbolDatesPerYearAfterSingleTileDrop: 1,
  }
  await writeJson(gatedContractPath, gatedContract)
  await buildMicroSplit(
    ["--contract", gatedContractPath, "--enriched", enrichedPath, "--broken-rules", rulesPath, "--out-dir", gatedOutDir],
    { cwd: process.cwd() },
  )
  const gatedSummary = JSON.parse(await fs.readFile(path.join(gatedOutDir, "micro_split_summary.json"), "utf8"))
  assert.equal(gatedSummary.globalGreedyFinalSurvivorCount, 0)

  const tileAuditContractPath = path.join(tmp, "tile_audit_contract.json")
  const tileAuditOutDir = path.join(tmp, "tile_audit_micro")
  const tileAuditContract = JSON.parse(await fs.readFile(contractPath, "utf8"))
  tileAuditContract.globalCover = { enabled: false, greedy: { enabled: false, maxCoverCandidates: 0 } }
  tileAuditContract.cover.maxCoverCandidatesPerParent = 0
  tileAuditContract.outputs = {
    emitTileCatalogs: false,
    emitGlobalZeroFpTilePool: true,
  }
  await writeJson(tileAuditContractPath, tileAuditContract)
  await buildMicroSplit(
    ["--contract", tileAuditContractPath, "--enriched", enrichedPath, "--broken-rules", rulesPath, "--out-dir", tileAuditOutDir],
    { cwd: process.cwd() },
  )
  const tilePoolRows = (await fs.readFile(path.join(tileAuditOutDir, "micro_split_global_zero_fp_tile_pool.jsonl"), "utf8"))
    .trim()
    .split(/\n/)
    .filter(Boolean)
  assert.equal(tilePoolRows.length >= 4, true)

  console.log("ok smoke_tp12_executable_global_zero_fp_cover")
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}
