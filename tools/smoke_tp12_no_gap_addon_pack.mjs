#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { readJson, readJsonl, writeJsonl } from "../src/lib/io.mjs"
import { loadTp12NoGapAddonContract, resolveTp12NoGapAddonCandidate } from "../src/lib/tp12_no_gap_addon_contract.mjs"
import { filterTp12NoGapAddonPack } from "../src/lib/tp12_no_gap_family_filter.mjs"
import { normalizePerfectPrototypeRow } from "../src/lib/perfect_prototype_tokenizer.mjs"

const baseRow = (overrides = {}) => ({
  rowKey: "close_only",
  dateKey: "2024-01-02",
  decisionDateKey: "2024-01-02",
  symbol: "000001",
  outcomeHitTarget: true,
  featureVec: {
    "trend.closeOverMa20": 0.12,
    "trend.closeOverMa120": 0.06,
    "trend.slope10": 0.04,
    "trend.slope20": 0.03,
    "trend.runUp10": 0.18,
    "candle.bodyPct": 0.03,
    "candle.rangePct": 0.08,
    "volume.valueRatio20": 1.6,
    "volume.avgTradingValue20dKrw": 4000000000,
    "volume.liquidityStress": 0.08,
    "level.closeNearHigh20": 0.72,
    "shape.breakoutPauseScore": 0.5,
    "shape.failedBreakoutCount20": 1,
    "shape.compression20": 0.61,
    "shape.sidewaysScore10": 0.42,
    "gap.openPct": 0.05,
  },
  globalFeatureVec: {
    volatility40: 0.11,
    valueRatio20Over150: 1.4,
  },
  eventFeatureVec: {
    closeRetentionFromOpen: 0.42,
    closeRetentionFromPrevClose: 0.36,
    gapOpenPct: 0.07,
  },
  marketContextVec: {
    gapMedian: 0.01,
    gapUpShare: 0.4,
  },
  xsecEventVec: {
    closeRankPct: 0.1,
    absGapRankPct: 0.92,
  },
  seq40: [0.01, 0.02, 0.03, 0.04],
  seq150: [0.01, 0.015, 0.02, 0.03],
  contextualTokens: [
    "tag:xsec.closeRank:LOW",
    "tag:event.gapProfile:WIDE",
    "tag:lowGapTop.volumeRegime:HEAVY",
  ],
  categoricalTokens: [],
  ...overrides,
})

const main = async () => {
  const cwd = process.cwd()
  const addonContract = await loadTp12NoGapAddonContract({ cwd })
  const retentionCandidate = resolveTp12NoGapAddonCandidate({
    addonContract,
    candidateId: "NG_CLOSE_RETENTION_V1",
  })
  const jumpCandidate = resolveTp12NoGapAddonCandidate({
    addonContract,
    candidateId: "NG_JUMP_BASE",
  })
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tp12-no-gap-addon-"))
  const inputPath = path.join(tempRoot, "daily_pack.jsonl")
  await writeJsonl(inputPath, [
    baseRow(),
    baseRow({
      rowKey: "gap_top",
      symbol: "000002",
      contextualTokens: ["tag:xsec.closeRank:LOW"],
      categoricalTokens: ["tag:xsec.gapRank:TOP"],
    }),
    baseRow({
      rowKey: "jump_only",
      symbol: "000003",
      contextualTokens: ["tag:xsec.closeRank:LOW", "tag:lowGapTop.volumeRegime:HEAVY"],
      categoricalTokens: ["tag:xsec.jumpVsMedian:BELOW"],
    }),
  ])

  const closeOutDir = path.join(tempRoot, "close_retention")
  const closeSummary = await filterTp12NoGapAddonPack({
    inputPath,
    outDir: closeOutDir,
    candidateSpec: retentionCandidate,
    rowContract: "open_eval_recent_impulse_1d",
    requireNonEmpty: true,
  })
  assert.equal(closeSummary.matchedRows, 1)
  assert.equal(closeSummary.baseFamilyId, "LOW_CLOSE_ONLY")

  const [closeRow] = await readJsonl(path.join(closeOutDir, "daily_pack.jsonl"))
  assert.equal(Object.keys(closeRow.eventFeatureVec ?? {}).length, 0)
  assert.ok(closeRow.featureVec["addon.retention.balance"] !== undefined)
  assert.ok(closeRow.disableDerivedEventTagTokens === true)
  assert.ok(closeRow.disableLowGapTopGeneralizationTokens === true)

  const normalized = normalizePerfectPrototypeRow(closeRow, {
    surfaceName: "v3_contextual_plus_lite",
  })
  const normalizedTokens = normalized.categoricalTokens ?? []
  assert.equal(normalizedTokens.some((token) => String(token).startsWith("tag:event.")), false)
  assert.equal(normalizedTokens.some((token) => String(token).startsWith("tag:lowGapTop.")), false)
  assert.equal(normalizedTokens.some((token) => String(token).startsWith("tag:xsec.gapRank:")), false)

  const jumpOutDir = path.join(tempRoot, "jump")
  const jumpSummary = await filterTp12NoGapAddonPack({
    inputPath,
    outDir: jumpOutDir,
    candidateSpec: jumpCandidate,
    rowContract: "open_eval_recent_impulse_1d",
    requireNonEmpty: true,
  })
  assert.equal(jumpSummary.matchedRows, 1)
  const writtenSummary = await readJson(path.join(jumpOutDir, "filter_summary.json"), null)
  assert.equal(writtenSummary?.candidateId, "NG_JUMP_BASE")
  console.log("ok smoke_tp12_no_gap_addon_pack")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
