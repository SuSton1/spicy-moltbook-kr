# TP12 Operational Nonhit Purge Precision Lab Checklist

Patch key: `tp12_operational_nonhit_purge_precision_lab_v1`

## Goal

- Find train-only seeds that hit at least 2 times per year in 2016-2024.
- Count success only with `operationalHitTarget === true`.
- Treat every matched nonhit row as a real failure until a pre-decision rule removes it.
- Use only D0 close and earlier daily OHLCV facts.
- Do not use 2025+ data for tuning, filtering, ranking, or threshold selection.

## Hard Stops

- Stop if any support row is dated on or after `2025-01-02`.
- Stop if `operationalHitTarget` is missing.
- Stop if candle rows needed for D0 micro features are missing.
- Stop if a rule references entry, hit-date, future high/low, OOS score, flow, program, news, theme, or sector fields.
- Stop if total materialized support rows exceed the contract budget.

## Required Checks

- Candidate support must be materialized without deleting failures.
- Nonhit reasons must be counted separately: `not_chart_hit`, `entry_volume_lte_zero`, `entry_gap_gte_29p5pct`.
- Veto/require terms must be searched from pre-decision micro features only.
- Accepted seeds must have:
  - `falsePositiveRows === 0`
  - `rowPrecision === 1`
  - at least `minHitsPerYear` unique hit dates in every train year
  - no future rows
- Accepted seeds must be re-verified from materialized support rows after mining.

## Current Scope

- This patch runs a precise frontier lab over the most plausible raw survivors:
  - low false-positive candidates
  - high row-precision candidates
  - balanced precision and false-positive candidates
- It is not an OOS evaluation and must not inspect 2025+ rows.
- If zero seeds survive, do not loosen thresholds inside the same run. Register the zero-survivor result.

## Execution

1. Build support rows.
2. Analyze nonhit anatomy.
3. Mine D0 micro require/veto rules.
4. Verify mined seeds exactly.
5. Run `npm run verify` locally and on server.
6. Register the experiment result.

