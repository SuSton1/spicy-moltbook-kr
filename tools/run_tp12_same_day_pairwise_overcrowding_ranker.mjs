#!/usr/bin/env node
import { runTp12SameDayPairwiseOvercrowdingRanker } from '../src/lib/tp12_same_day_pairwise_overcrowding_ranker.mjs';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) throw new Error(`unknown positional arg: ${arg}`);
    const idx = arg.indexOf('=');
    if (idx === -1) {
      out[arg.slice(2)] = true;
    } else {
      out[arg.slice(2, idx)] = arg.slice(idx + 1);
    }
  }
  return out;
}

function numberArg(args, key, fallback) {
  if (args[key] === undefined || args[key] === '') return fallback;
  const value = Number(args[key]);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be finite`);
  return value;
}

function requireArg(args, key) {
  const value = args[key];
  if (!value) throw new Error(`missing required --${key}`);
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await runTp12SameDayPairwiseOvercrowdingRanker({
    candidatesPath: requireArg(args, 'candidates'),
    outSummaryPath: requireArg(args, 'out-summary'),
    outSelectionsPath: requireArg(args, 'out-selections'),
    dateFrom: args['date-from'] ?? null,
    dateTo: args['date-to'] ?? null,
    forbiddenDateFrom: args['forbidden-date-from'] ?? null,
    forbiddenDateTo: args['forbidden-date-to'] ?? null,
    targetWilsonLower95: numberArg(args, 'target-wilson-lower95', 0.8),
    minSelectedRows: numberArg(args, 'min-selected-rows', 150),
  });

  console.log(JSON.stringify({
    status: summary.status,
    mode: summary.mode,
    candidateRows: summary.candidateRows,
    candidateDateCount: summary.candidateDateCount,
    dailyOracleHitRate: summary.dailyOracleHitRate,
    baselinePolicyId: summary.baselinePolicyId,
    baselineHitRows: summary.baselineHitRows,
    baselineHitRate: summary.baselineHitRate,
    bestPolicyId: summary.bestPolicyId,
    bestHitRows: summary.bestHitRows,
    bestHitRate: summary.bestHitRate,
    bestVsBaselineHitRateDelta: summary.bestVsBaselineHitRateDelta,
    h80PassedPolicyCount: summary.h80PassedPolicyCount,
    lockedSelectorEmitted: summary.lockedSelectorEmitted,
    outSummaryPath: args['out-summary'],
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
