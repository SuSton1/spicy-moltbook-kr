#!/usr/bin/env node
import assert from "node:assert/strict"

import { buildTechniqueEpisodeWindows } from "../src/lib/technique_episode_window_builder.mjs"
import { loadTechniqueEpisodeSubstrateContract } from "../src/lib/technique_episode_substrate_contract.mjs"
import { loadTechniquePatternDiscoveryContract } from "../src/lib/technique_pattern_discovery_contract.mjs"

const episodeContract = await loadTechniqueEpisodeSubstrateContract({ cwd: process.cwd() })
const structuralContract = await loadTechniquePatternDiscoveryContract({ cwd: process.cwd(), contractPath: episodeContract.structuralContractPath })

const rows = [
  {
    rowId: "r1",
    symbol: "AAA",
    dateKey: "2017-01-02",
    scopeId: "LOW_GAP_TOP",
    lookbackCandidateId: "lb1",
    labelMap: { tp12_no_stop_hit_3d: 1 },
    numericFeatureMap: { 'tech.distanceToMa60': 0.01, 'tech.daysSinceCrossAboveMa60': 2, 'candle.bodyPct': 0.4, 'tech.bodySignedPct': 0.4, 'tech.upperWickPct': 0.05, 'tech.lowerWickPct': 0.05, 'candle.closeNearHigh': 0.9, 'candle.closeNearLow': 0.1, 'tech.valueRatio20': 1.4, 'tech.sponsorQuality': 0.8, 'tech.failedBreakoutCount20': 0.0 },
  },
  {
    rowId: "r2",
    symbol: "AAA",
    dateKey: "2017-01-03",
    scopeId: "LOW_GAP_TOP",
    lookbackCandidateId: "lb1",
    labelMap: { tp12_no_stop_hit_3d: 0 },
    numericFeatureMap: { 'tech.distanceToMa60': 0.02, 'tech.daysSinceCrossAboveMa60': 3, 'candle.bodyPct': 0.3, 'tech.bodySignedPct': -0.2, 'tech.upperWickPct': 0.2, 'tech.lowerWickPct': 0.04, 'candle.closeNearHigh': 0.4, 'candle.closeNearLow': 0.6, 'tech.valueRatio20': 0.8, 'tech.sponsorQuality': 0.4, 'tech.failedBreakoutCount20': 1.0 },
  },
  {
    rowId: "r3",
    symbol: "AAA",
    dateKey: "2017-01-04",
    scopeId: "LOW_GAP_TOP",
    lookbackCandidateId: "lb1",
    labelMap: { tp12_no_stop_hit_3d: 1 },
    numericFeatureMap: { 'tech.distanceToMa60': 0.015, 'tech.daysSinceCrossAboveMa60': 4, 'candle.bodyPct': 0.35, 'tech.bodySignedPct': 0.3, 'tech.upperWickPct': 0.1, 'tech.lowerWickPct': 0.06, 'candle.closeNearHigh': 0.8, 'candle.closeNearLow': 0.2, 'tech.valueRatio20': 1.2, 'tech.sponsorQuality': 0.75, 'tech.failedBreakoutCount20': 0.0 },
  },
]

const dataset = buildTechniqueEpisodeWindows({ rows, episodeContract, structuralContract })
assert.equal(dataset.summary.episodeRowCount, 3)
assert.equal(dataset.summary.positiveEpisodeCount, 2)
assert.ok(dataset.episodeRows[1].episodeAtomIds.some((atomId) => atomId.startsWith('prev1:')))
assert.ok(dataset.episodeRows[1].episodeAtomIds.some((atomId) => atomId.startsWith('transition:')))
console.log('ok smoke_technique_episode_window_builder')
