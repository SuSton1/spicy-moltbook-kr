#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runTp12SameDayPairwiseOvercrowdingRanker } from '../src/lib/tp12_same_day_pairwise_overcrowding_ranker.mjs';

function candidate(overrides) {
  return {
    kind: 'tp12_context_consensus_feature_v1',
    decisionDateKey: '2021-01-04',
    symbol: '000001',
    hitTarget: false,
    selectorScore: 10,
    supportClusterCount: 20,
    supportPatternCount: 20,
    supportWeightedClusterRowEb: 10,
    sumClusterRowEb: 5,
    meanClusterRowEb: 0.25,
    maxClusterRowEb: 0.3,
    maxClusterRowWilsonLB: 0.2,
    maxClusterDateWilsonLB: 0.4,
    familyDiversity: 2,
    rawEventRowCount: 20,
    returnVol20: 0.2,
    rangePct: 0.05,
    rangeRel20: 0.2,
    closeLocation: 0.6,
    tradedValue: 1000000000,
    tradedValueRel20: 0.1,
    d0ClosePressurePct: 0.02,
    d0TradingValue: 1000000000,
    d0TradingValueRel20: 0.1,
    d0CloseLocation: 0.6,
    d0RangePct: 0.05,
    d0SideDailyAlignment: 1,
    d0SideDailyPressure: 1,
    d0IntradayCloseStrength: 0.6,
    d0IntradayVwapHoldRatio: 0.7,
    closeFromLow20Pct: 0.2,
    closeToHigh20Pct: -0.1,
    supportClusterIds: ['cluster_a'],
    ...overrides,
  };
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf-8');
}

async function expectReject(fn, pattern) {
  let rejected = false;
  try {
    await fn();
  } catch (error) {
    rejected = true;
    assert.match(String(error.message || error), pattern);
  }
  assert.equal(rejected, true, 'expected function to reject');
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp12-pairwise-overcrowding-'));
  const input = path.join(dir, 'candidates.jsonl');
  const summaryPath = path.join(dir, 'summary.json');
  const selectionsPath = path.join(dir, 'selections.jsonl');

  const rows = [
    candidate({ decisionDateKey: '2021-01-04', symbol: '000001', hitTarget: false, selectorScore: 10, supportClusterCount: 25, supportPatternCount: 25, maxClusterRowEb: 0.28, maxClusterRowWilsonLB: 0.2 }),
    candidate({ decisionDateKey: '2021-01-04', symbol: '000002', hitTarget: true, selectorScore: 2, supportClusterCount: 3, supportPatternCount: 3, maxClusterRowEb: 0.55, maxClusterRowWilsonLB: 0.5, supportWeightedClusterRowEb: 2, sumClusterRowEb: 0.9, supportClusterIds: ['cluster_b'] }),
    candidate({ decisionDateKey: '2021-01-05', symbol: '000003', hitTarget: false, selectorScore: 9, supportClusterCount: 22, supportPatternCount: 22, maxClusterRowEb: 0.3, maxClusterRowWilsonLB: 0.22 }),
    candidate({ decisionDateKey: '2021-01-05', symbol: '000004', hitTarget: true, selectorScore: 1.5, supportClusterCount: 2, supportPatternCount: 2, maxClusterRowEb: 0.5, maxClusterRowWilsonLB: 0.48, supportWeightedClusterRowEb: 1.8, sumClusterRowEb: 0.8, supportClusterIds: ['cluster_b'] }),
    candidate({ decisionDateKey: '2021-01-06', symbol: '000005', hitTarget: true, selectorScore: 8, supportClusterCount: 18, supportPatternCount: 18, maxClusterRowEb: 0.45, maxClusterRowWilsonLB: 0.4 }),
    candidate({ decisionDateKey: '2021-01-06', symbol: '000006', hitTarget: false, selectorScore: 1, supportClusterCount: 1, supportPatternCount: 1, maxClusterRowEb: 0.15, maxClusterRowWilsonLB: 0.1, supportClusterIds: ['cluster_c'] }),
  ];
  writeJsonl(input, rows);

  const summary = await runTp12SameDayPairwiseOvercrowdingRanker({
    candidatesPath: input,
    outSummaryPath: summaryPath,
    outSelectionsPath: selectionsPath,
    dateFrom: '2021-01-01',
    dateTo: '2021-12-31',
    forbiddenDateFrom: '2025-01-02',
    forbiddenDateTo: '2026-04-17',
    minSelectedRows: 1,
    targetWilsonLower95: 0.8,
  });

  assert.equal(summary.candidateRows, 6);
  assert.equal(summary.candidateDateCount, 3);
  assert.equal(summary.dailyOracleHitRate, 1);
  assert.equal(summary.lockedSelectorEmitted, false);
  assert.equal(summary.h80PassedPolicyCount, 0);
  assert.equal(summary.baselineHitRows, 1);
  assert.equal(summary.bestHitRows > summary.baselineHitRows, true);
  assert.equal(fs.existsSync(summaryPath), true);
  assert.equal(fs.existsSync(selectionsPath), true);

  const oosInput = path.join(dir, 'oos.jsonl');
  writeJsonl(oosInput, [candidate({ decisionDateKey: '2025-01-02', symbol: '999999' })]);
  await expectReject(() => runTp12SameDayPairwiseOvercrowdingRanker({
    candidatesPath: oosInput,
    outSummaryPath: path.join(dir, 'bad-summary.json'),
    outSelectionsPath: path.join(dir, 'bad-selections.jsonl'),
    forbiddenDateFrom: '2025-01-02',
    forbiddenDateTo: '2026-04-17',
  }), /inside forbidden range/);

  const dupInput = path.join(dir, 'dup.jsonl');
  writeJsonl(dupInput, [rows[0], rows[0]]);
  await expectReject(() => runTp12SameDayPairwiseOvercrowdingRanker({
    candidatesPath: dupInput,
    outSummaryPath: path.join(dir, 'dup-summary.json'),
    outSelectionsPath: path.join(dir, 'dup-selections.jsonl'),
  }), /duplicate candidate/);

  console.log('ok smoke_tp12_same_day_pairwise_overcrowding_ranker');
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
