import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createGunzip } from 'node:zlib';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseFiniteNumber(value, fieldName) {
  const number = Number(value);
  assert(Number.isFinite(number), `field ${fieldName} must be finite`);
  return number;
}

function optionalFiniteNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function requireDateKey(value, fieldName) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `field ${fieldName} must be YYYY-MM-DD`);
  return value;
}

function checkDateBounds(dateKey, options, sourceName) {
  if (options.dateFrom) assert(dateKey >= options.dateFrom, `${sourceName} date ${dateKey} is before --date-from`);
  if (options.dateTo) assert(dateKey <= options.dateTo, `${sourceName} date ${dateKey} is after --date-to`);
  if (options.forbiddenDateFrom && options.forbiddenDateTo) {
    assert(
      dateKey < options.forbiddenDateFrom || dateKey > options.forbiddenDateTo,
      `${sourceName} date ${dateKey} is inside forbidden range ${options.forbiddenDateFrom}..${options.forbiddenDateTo}`,
    );
  }
}

async function readJsonl(path, onRow) {
  assert(path && fs.existsSync(path), `missing input path: ${path}`);
  const input = fs.createReadStream(path);
  const stream = path.endsWith('.gz') ? input.pipe(createGunzip()) : input;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    const text = line.trim();
    if (!text) continue;
    let row;
    try {
      row = JSON.parse(text);
    } catch (error) {
      throw new Error(`invalid JSON at ${path}:${lineNumber}: ${error.message}`);
    }
    await onRow(row, lineNumber);
  }
}

function wilsonLowerBound(hitRows, selectedRows, z = 1.959963984540054) {
  if (selectedRows <= 0) return 0;
  const phat = hitRows / selectedRows;
  const z2 = z * z;
  const denom = 1 + z2 / selectedRows;
  const center = phat + z2 / (2 * selectedRows);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * selectedRows)) / selectedRows);
  return (center - margin) / denom;
}

function safeLog1p(value) {
  return Math.log1p(Math.max(0, optionalFiniteNumber(value)));
}

function rowKey(row) {
  return `${row.decisionDateKey}::${row.symbol}`;
}

function stableRowSort(a, b) {
  return String(a.symbol).localeCompare(String(b.symbol));
}

const RANK_FIELDS = [
  'selectorScore',
  'supportClusterCount',
  'supportPatternCount',
  'supportWeightedClusterRowEb',
  'sumClusterRowEb',
  'meanClusterRowEb',
  'maxClusterRowEb',
  'maxClusterRowWilsonLB',
  'maxClusterDateWilsonLB',
  'familyDiversity',
  'rawEventRowCount',
  'returnVol20',
  'rangePct',
  'rangeRel20',
  'closeLocation',
  'tradedValue',
  'tradedValueRel20',
  'd0ClosePressurePct',
  'd0TradingValue',
  'd0TradingValueRel20',
  'd0CloseLocation',
  'd0RangePct',
  'd0SideDailyAlignment',
  'd0SideDailyPressure',
  'd0IntradayCloseStrength',
  'd0IntradayVwapHoldRatio',
  'closeFromLow20Pct',
  'closeToHigh20Pct',
];

function buildRanks(rows) {
  const ranks = new Map();
  for (const field of RANK_FIELDS) {
    const sorted = [...rows].sort((a, b) => {
      const av = parseFiniteNumber(a[field], `${rowKey(a)} ${field}`);
      const bv = parseFiniteNumber(b[field], `${rowKey(b)} ${field}`);
      if (av !== bv) return av - bv;
      return stableRowSort(a, b);
    });
    const denom = Math.max(1, sorted.length - 1);
    for (let index = 0; index < sorted.length; index += 1) {
      const key = rowKey(sorted[index]);
      let item = ranks.get(key);
      if (!item) {
        item = {};
        ranks.set(key, item);
      }
      item[`${field}High`] = index / denom;
      item[`${field}Low`] = 1 - index / denom;
    }
  }
  return ranks;
}

function rank(row, ranks, field, direction = 'High') {
  const item = ranks.get(rowKey(row));
  return parseFiniteNumber(item?.[`${field}${direction}`], `${rowKey(row)} rank.${field}${direction}`);
}

function currentScore(row) {
  return parseFiniteNumber(row.selectorScore, 'selectorScore');
}

function supportCount(row) {
  return optionalFiniteNumber(row.supportClusterCount, optionalFiniteNumber(row.supportPatternCount));
}

function topClusterId(row) {
  if (Array.isArray(row.supportClusterIds) && row.supportClusterIds.length > 0) return String(row.supportClusterIds[0]);
  if (Array.isArray(row.supportClusterSummaries) && row.supportClusterSummaries.length > 0) {
    return String(row.supportClusterSummaries[0]?.clusterId ?? '');
  }
  return '';
}

const DEFAULT_POLICIES = [
  {
    id: 'baseline_selector_score_desc',
    description: 'Current support-heavy selector score, kept as benchmark only.',
    score: (row) => currentScore(row),
    preferLowerCrowdOnTie: false,
  },
  {
    id: 'low_support_quality_rank_v1',
    description: 'Prefer fit-only row quality but penalize same-day support crowding.',
    score: (row, ranks) => (
      1.2 * rank(row, ranks, 'maxClusterRowEb', 'High') +
      0.8 * rank(row, ranks, 'maxClusterRowWilsonLB', 'High') +
      0.4 * rank(row, ranks, 'familyDiversity', 'High') -
      1.4 * rank(row, ranks, 'supportClusterCount', 'High') -
      0.2 * rank(row, ranks, 'selectorScore', 'High')
    ),
    preferLowerCrowdOnTie: true,
  },
  {
    id: 'support_tempered_roweb_v1',
    description: 'Temper sum row-EB by log support to reduce overcrowded duplicate support.',
    score: (row) => optionalFiniteNumber(row.sumClusterRowEb) / Math.max(1, safeLog1p(supportCount(row))),
    preferLowerCrowdOnTie: true,
  },
  {
    id: 'support_weighted_tempered_v1',
    description: 'Use current support-weighted EB, but divide by support count pressure.',
    score: (row) => optionalFiniteNumber(row.supportWeightedClusterRowEb) / Math.max(1, supportCount(row)),
    preferLowerCrowdOnTie: true,
  },
  {
    id: 'pairwise_overcrowding_penalty_l1_v1',
    description: 'Within-day rank policy with a moderate support-overcrowding penalty.',
    score: (row, ranks) => (
      0.9 * rank(row, ranks, 'maxClusterRowEb', 'High') +
      0.7 * rank(row, ranks, 'sumClusterRowEb', 'High') +
      0.4 * rank(row, ranks, 'maxClusterDateWilsonLB', 'High') +
      0.2 * rank(row, ranks, 'familyDiversity', 'High') -
      1.0 * rank(row, ranks, 'supportClusterCount', 'High')
    ),
    preferLowerCrowdOnTie: true,
  },
  {
    id: 'pairwise_overcrowding_penalty_l2_v1',
    description: 'Within-day rank policy with a strong support-overcrowding penalty.',
    score: (row, ranks) => (
      0.9 * rank(row, ranks, 'maxClusterRowEb', 'High') +
      0.7 * rank(row, ranks, 'sumClusterRowEb', 'High') +
      0.4 * rank(row, ranks, 'maxClusterDateWilsonLB', 'High') +
      0.2 * rank(row, ranks, 'familyDiversity', 'High') -
      1.6 * rank(row, ranks, 'supportClusterCount', 'High')
    ),
    preferLowerCrowdOnTie: true,
  },
  {
    id: 'low_crowd_momentum_quality_v1',
    description: 'Anti-crowd policy with as-of momentum/range context; diagnostic only.',
    score: (row, ranks) => (
      0.9 * rank(row, ranks, 'maxClusterRowWilsonLB', 'High') +
      0.5 * rank(row, ranks, 'closeLocation', 'High') +
      0.4 * rank(row, ranks, 'rangeRel20', 'High') +
      0.3 * rank(row, ranks, 'tradedValueRel20', 'High') -
      1.1 * rank(row, ranks, 'supportClusterCount', 'High') -
      0.3 * rank(row, ranks, 'returnVol20', 'High')
    ),
    preferLowerCrowdOnTie: true,
  },
  {
    id: 'd0_close_side_quality_v1',
    description: 'Use D0 close pressure, D0 liquidity, side-daily alignment, and D0 intraday close strength.',
    score: (row, ranks) => (
      0.8 * rank(row, ranks, 'maxClusterRowWilsonLB', 'High') +
      0.65 * rank(row, ranks, 'd0ClosePressurePct', 'High') +
      0.55 * rank(row, ranks, 'd0CloseLocation', 'High') +
      0.45 * rank(row, ranks, 'd0TradingValueRel20', 'High') +
      0.45 * rank(row, ranks, 'd0SideDailyAlignment', 'High') +
      0.35 * rank(row, ranks, 'd0IntradayCloseStrength', 'High') +
      0.25 * rank(row, ranks, 'd0IntradayVwapHoldRatio', 'High') -
      0.8 * rank(row, ranks, 'supportClusterCount', 'High') -
      0.35 * rank(row, ranks, 'returnVol20', 'High')
    ),
    preferLowerCrowdOnTie: true,
  },
  {
    id: 'undercrowded_selector_contrast_v1',
    description: 'Explicitly contrast against the current selector score to test over-crowding inversion.',
    score: (row, ranks) => (
      0.9 * rank(row, ranks, 'maxClusterRowWilsonLB', 'High') +
      0.7 * rank(row, ranks, 'supportClusterCount', 'Low') +
      0.6 * rank(row, ranks, 'selectorScore', 'Low') +
      0.2 * rank(row, ranks, 'familyDiversity', 'High')
    ),
    preferLowerCrowdOnTie: true,
  },
];

function compareCandidates(a, b, policy) {
  if (a.score !== b.score) return b.score - a.score;
  if (policy.preferLowerCrowdOnTie) {
    const crowdDiff = supportCount(a.row) - supportCount(b.row);
    if (crowdDiff !== 0) return crowdDiff;
  } else {
    const crowdDiff = supportCount(b.row) - supportCount(a.row);
    if (crowdDiff !== 0) return crowdDiff;
  }
  const qualityDiff = optionalFiniteNumber(b.row.maxClusterRowEb) - optionalFiniteNumber(a.row.maxClusterRowEb);
  if (qualityDiff !== 0) return qualityDiff;
  return stableRowSort(a.row, b.row);
}

function initPolicyAccumulator(policy) {
  return {
    policyId: policy.id,
    description: policy.description,
    selectedRows: 0,
    hitRows: 0,
    falsePositiveRows: 0,
    falsePositiveWithSameDateHitCount: 0,
    falsePositiveNoSameDateHitCount: 0,
    selectedSupportClusterCountSum: 0,
    selectedSelectorScoreSum: 0,
    selectedSymbols: new Map(),
    selectedTopClusters: new Map(),
    byYear: new Map(),
    selections: [],
  };
}

function incrementMap(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function finalizeConcentration(map, total) {
  let topKey = null;
  let topCount = 0;
  for (const [key, count] of map.entries()) {
    if (count > topCount || (count === topCount && String(key).localeCompare(String(topKey)) < 0)) {
      topKey = key;
      topCount = count;
    }
  }
  return {
    topKey,
    topCount,
    topShare: total > 0 ? topCount / total : 0,
  };
}

function finalizeYearMap(map) {
  const out = {};
  for (const [year, item] of [...map.entries()].sort()) {
    out[year] = {
      selectedRows: item.selectedRows,
      hitRows: item.hitRows,
      hitRate: item.selectedRows > 0 ? item.hitRows / item.selectedRows : 0,
    };
  }
  return out;
}

function validateCandidateRow(row, options, lineNumber) {
  assert(isObject(row), `candidate row ${lineNumber} must be object`);
  row.decisionDateKey = requireDateKey(row.decisionDateKey, 'decisionDateKey');
  assert(typeof row.symbol === 'string' && row.symbol, `candidate row ${lineNumber} missing symbol`);
  assert(typeof row.hitTarget === 'boolean', `candidate row ${lineNumber} missing boolean hitTarget`);
  checkDateBounds(row.decisionDateKey, options, 'candidate');
  parseFiniteNumber(row.selectorScore, 'selectorScore');
  parseFiniteNumber(row.maxClusterRowEb, 'maxClusterRowEb');
  parseFiniteNumber(row.maxClusterRowWilsonLB, 'maxClusterRowWilsonLB');
  parseFiniteNumber(row.supportClusterCount ?? row.supportPatternCount, 'supportClusterCount');
  for (const field of RANK_FIELDS) parseFiniteNumber(row[field], `${rowKey(row)} ${field}`);
  return row;
}

export async function runTp12SameDayPairwiseOvercrowdingRanker(options = {}) {
  const {
    candidatesPath,
    outSummaryPath,
    outSelectionsPath,
    targetWilsonLower95 = 0.8,
    minSelectedRows = 150,
    dateFrom = null,
    dateTo = null,
    forbiddenDateFrom = null,
    forbiddenDateTo = null,
  } = options;

  assert(candidatesPath, 'candidatesPath is required');
  assert(outSummaryPath, 'outSummaryPath is required');
  assert(outSelectionsPath, 'outSelectionsPath is required');
  assert((!forbiddenDateFrom) === (!forbiddenDateTo), 'forbiddenDateFrom and forbiddenDateTo must be provided together');

  const normalizedOptions = { dateFrom, dateTo, forbiddenDateFrom, forbiddenDateTo };
  const byDate = new Map();
  const seen = new Set();
  let candidateRows = 0;
  let hitCandidateRows = 0;

  await readJsonl(candidatesPath, (raw, lineNumber) => {
    const row = validateCandidateRow({ ...raw }, normalizedOptions, lineNumber);
    const key = rowKey(row);
    assert(!seen.has(key), `duplicate candidate symbol/date row: ${key}`);
    seen.add(key);
    candidateRows += 1;
    if (row.hitTarget) hitCandidateRows += 1;
    const list = byDate.get(row.decisionDateKey) ?? [];
    list.push(row);
    byDate.set(row.decisionDateKey, list);
  });

  assert(candidateRows > 0, 'candidate input contained no rows');

  const policies = DEFAULT_POLICIES;
  const accumulators = new Map(policies.map((policy) => [policy.id, initPolicyAccumulator(policy)]));
  const dailyOracle = {
    dateCount: 0,
    datesWithPositiveCandidate: 0,
  };

  for (const [dateKey, rows] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ranks = buildRanks(rows);
    const dayHasHit = rows.some((row) => row.hitTarget);
    dailyOracle.dateCount += 1;
    if (dayHasHit) dailyOracle.datesWithPositiveCandidate += 1;

    for (const policy of policies) {
      const scored = rows.map((row) => {
        const score = policy.score(row, ranks);
        assert(Number.isFinite(score), `policy ${policy.id} produced non-finite score for ${rowKey(row)}`);
        return { row, score };
      });
      scored.sort((a, b) => compareCandidates(a, b, policy));
      const selected = scored[0];
      const acc = accumulators.get(policy.id);
      const hit = selected.row.hitTarget;
      const year = dateKey.slice(0, 4);

      acc.selectedRows += 1;
      if (hit) {
        acc.hitRows += 1;
      } else {
        acc.falsePositiveRows += 1;
        if (dayHasHit) acc.falsePositiveWithSameDateHitCount += 1;
        else acc.falsePositiveNoSameDateHitCount += 1;
      }
      acc.selectedSupportClusterCountSum += supportCount(selected.row);
      acc.selectedSelectorScoreSum += optionalFiniteNumber(selected.row.selectorScore);
      incrementMap(acc.selectedSymbols, selected.row.symbol);
      incrementMap(acc.selectedTopClusters, topClusterId(selected.row) || 'unknown');
      if (!acc.byYear.has(year)) acc.byYear.set(year, { selectedRows: 0, hitRows: 0 });
      const yearItem = acc.byYear.get(year);
      yearItem.selectedRows += 1;
      if (hit) yearItem.hitRows += 1;
      acc.selections.push({
        kind: 'tp12_same_day_pairwise_overcrowding_selection_v1',
        policyId: policy.id,
        decisionDateKey: dateKey,
        symbol: selected.row.symbol,
        hitTarget: hit,
        score: selected.score,
        baselineSelectorScore: optionalFiniteNumber(selected.row.selectorScore),
        supportClusterCount: supportCount(selected.row),
        supportPatternCount: optionalFiniteNumber(selected.row.supportPatternCount),
        maxClusterRowEb: optionalFiniteNumber(selected.row.maxClusterRowEb),
        maxClusterRowWilsonLB: optionalFiniteNumber(selected.row.maxClusterRowWilsonLB),
        d0ClosePressurePct: optionalFiniteNumber(selected.row.d0ClosePressurePct),
        d0TradingValueRel20: optionalFiniteNumber(selected.row.d0TradingValueRel20),
        d0CloseLocation: optionalFiniteNumber(selected.row.d0CloseLocation),
        d0SideDailyAlignment: optionalFiniteNumber(selected.row.d0SideDailyAlignment),
        d0IntradayCloseStrength: optionalFiniteNumber(selected.row.d0IntradayCloseStrength),
        topClusterId: topClusterId(selected.row) || null,
        dayCandidateRows: rows.length,
        dayHasHit,
      });
    }
  }

  const policyResults = policies.map((policy) => {
    const acc = accumulators.get(policy.id);
    const hitRate = acc.selectedRows > 0 ? acc.hitRows / acc.selectedRows : 0;
    const wilsonLower95 = wilsonLowerBound(acc.hitRows, acc.selectedRows);
    const h80Pass = acc.selectedRows >= minSelectedRows && wilsonLower95 >= targetWilsonLower95;
    return {
      policyId: policy.id,
      description: policy.description,
      selectedRows: acc.selectedRows,
      hitRows: acc.hitRows,
      falsePositiveRows: acc.falsePositiveRows,
      hitRate,
      wilsonLower95,
      h80Pass,
      falsePositiveWithSameDateHitCount: acc.falsePositiveWithSameDateHitCount,
      falsePositiveNoSameDateHitCount: acc.falsePositiveNoSameDateHitCount,
      selectedSupportClusterCountMean: acc.selectedRows > 0 ? acc.selectedSupportClusterCountSum / acc.selectedRows : 0,
      selectedSelectorScoreMean: acc.selectedRows > 0 ? acc.selectedSelectorScoreSum / acc.selectedRows : 0,
      symbolConcentration: finalizeConcentration(acc.selectedSymbols, acc.selectedRows),
      topClusterConcentration: finalizeConcentration(acc.selectedTopClusters, acc.selectedRows),
      byYear: finalizeYearMap(acc.byYear),
    };
  });

  const baseline = policyResults.find((item) => item.policyId === 'baseline_selector_score_desc');
  const best = [...policyResults].sort((a, b) => {
    if (a.hitRows !== b.hitRows) return b.hitRows - a.hitRows;
    if (a.wilsonLower95 !== b.wilsonLower95) return b.wilsonLower95 - a.wilsonLower95;
    return a.policyId.localeCompare(b.policyId);
  })[0];
  const h80PassedPolicyCount = policyResults.filter((item) => item.h80Pass).length;
  const diagnosticImprovedPolicyCount = policyResults.filter((item) => (
    baseline && item.policyId !== baseline.policyId && item.hitRate > baseline.hitRate
  )).length;

  const summary = {
    kind: 'tp12_same_day_pairwise_overcrowding_ranker_summary_v1',
    patchKey: 'tp12_h80_same_day_pairwise_overcrowding_ranker_v1',
    status: 'passed_train_only_diagnostic',
    mode: 'train_only_same_day_pairwise_ranker_diagnostic',
    oosRead: false,
    candidatesPath,
    dateFrom,
    dateTo,
    forbiddenDateFrom,
    forbiddenDateTo,
    candidateRows,
    hitCandidateRows,
    candidateHitRate: hitCandidateRows / candidateRows,
    candidateDateCount: dailyOracle.dateCount,
    datesWithPositiveCandidate: dailyOracle.datesWithPositiveCandidate,
    dailyOracleHitRate: dailyOracle.dateCount > 0 ? dailyOracle.datesWithPositiveCandidate / dailyOracle.dateCount : 0,
    targetWilsonLower95,
    minSelectedRows,
    baselinePolicyId: baseline?.policyId ?? null,
    baselineHitRows: baseline?.hitRows ?? 0,
    baselineHitRate: baseline?.hitRate ?? 0,
    baselineWilsonLower95: baseline?.wilsonLower95 ?? 0,
    bestPolicyId: best?.policyId ?? null,
    bestHitRows: best?.hitRows ?? 0,
    bestHitRate: best?.hitRate ?? 0,
    bestWilsonLower95: best?.wilsonLower95 ?? 0,
    bestVsBaselineHitRateDelta: baseline && best ? best.hitRate - baseline.hitRate : 0,
    diagnosticImprovedPolicyCount,
    h80PassedPolicyCount,
    lockedSelectorEmitted: false,
    policyResults,
    interpretation: {
      emitsLockedSelector: false,
      reason: h80PassedPolicyCount > 0
        ? 'At least one diagnostic policy passed the H80 train gate, but this tool still does not emit a locked selector.'
        : 'No diagnostic policy passed the H80 Wilson train gate; use this as ranker-direction evidence only.',
      nextStep: 'If anti-crowd policies improve train-only OOF, open a separate locked-selector patch with nested calibration; do not apply this diagnostic directly to OOS.',
    },
  };

  fs.mkdirSync(path.dirname(outSummaryPath), { recursive: true });
  fs.writeFileSync(outSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');

  fs.mkdirSync(path.dirname(outSelectionsPath), { recursive: true });
  const selectionLines = [];
  for (const policy of policies) {
    const acc = accumulators.get(policy.id);
    for (const selection of acc.selections) selectionLines.push(JSON.stringify(selection));
  }
  fs.writeFileSync(outSelectionsPath, `${selectionLines.join('\n')}\n`, 'utf-8');

  return summary;
}

export const __test = {
  DEFAULT_POLICIES,
  wilsonLowerBound,
};
