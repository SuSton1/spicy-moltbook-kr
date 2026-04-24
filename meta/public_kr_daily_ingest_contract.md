# Public KR Daily Ingest Contract

Updated: `2026-03-24`

## Status
- This document defines the canonical ingest contract for `tools/fill_public_kr_daily.py`.
- The root-cause fix is explicit row classification, not fallback source switching and not hidden stale-data reuse.
- `close_only_placeholder` is no longer treated as a candle. It is treated as `nontrading_status`.

## Row Classes
- `valid_candle`
  - Normal OHLCV row.
  - Written to `data/candle_daily.jsonl`.
  - Eligible to produce `data/universe_daily.jsonl` rows.
- `nontrading_status`
  - Current canonical case: `open=0`, `high=0`, `low=0`, `close>0`, `volume=0`.
  - Written only to `data/nontrading_symbol_daily.jsonl`.
  - Must not be written to candle or universe outputs.
- `fatal_invalid`
  - Impossible price/volume structure, including:
    - `negative_price_or_volume`
    - `nonpositive_ohlc`
    - `high_below_low`
    - `open_outside_range`
    - `close_outside_range`
  - Fails the fill run immediately after audit emission.

## Sidecar Contract
- Canonical sidecar path: `data/nontrading_symbol_daily.jsonl`
- Canonical fields:
  - `symbol`
  - `dateKey`
  - `status`
  - `reason`
  - `source`
  - `close`
  - `volume`
  - `name`
  - `marketCode`
  - `generatedAt`

## Invariants
- The same `symbol/dateKey` must never appear in both:
  - `data/candle_daily.jsonl`
  - `data/nontrading_symbol_daily.jsonl`
- The same `symbol/dateKey` must never appear in both:
  - `data/universe_daily.jsonl`
  - `data/nontrading_symbol_daily.jsonl`
- `nontrading_status` is not a degraded candle path. It is a distinct canonical state.

## Failure Policy
- Fallback-style source switching is prohibited.
- `fatal_invalid` stays fail-fast.
- `nontrading_status` does not block fill completion by itself.
- Daily live evaluation must run only when fill status is one of:
  - `completed`
  - `completed_with_nontrading_status`

## Historical Partial-Coverage Repair
- Canonical repair target for historical date-slice loss is `full date-slice regeneration`, not symbol-level patching.
- Required path:
  - stage-only historical rebuild for the exact target date
  - stage QC pass
  - targeted repair validation against canonical current date slice
  - atomic date-slice merge into `candle_daily.jsonl` / `universe_daily.jsonl` / `nontrading_symbol_daily.jsonl`
- Forbidden repair styles:
  - symbol-only hot patch
  - candle-only rewrite without synchronized universe/nontrading rewrite
  - merge without validator pass
  - degraded fallback source substitution

## Fill Summary Artifact
- Canonical summary path for daily ops runs:
  - `artifacts/runs/<daily_run_id>/fill/fill_summary.json`
- Required fields:
  - `status`
  - `from`
  - `to`
  - `latestCandleBefore`
  - `latestUniverseBefore`
  - `latestCandleAfter`
  - `latestUniverseAfter`
  - `latestWrittenDate`
  - `validCandleRows`
  - `validUniverseRows`
  - `nonTradingSymbolCount`
  - `nonTradingRowCount`
  - `fatalInvalidSymbolCount`
  - `fatalInvalidRowCount`
  - `auditPaths`
  - `failureReason`

## Daily Ops Integration
- Canonical daily ops runtime:
  - `tools/run_daily_ops_once.sh`
  - `tools/server_run_daily_ops_stack.mjs`
- Daily ops must read `fill_summary.json` before attempting live evaluation.
- If fill fails, daily ops writes a terminal `daily_ops_summary.json` and `report.md` and stops.
- Stale-data live evaluation is prohibited.

## Reference Incident
- `2026-03-24 18:20:53 KST` failure root cause:
  - existing symbols received `close_only_placeholder` rows from upstream public data
  - older logic promoted those rows to fatal invalids for active symbols
  - the corrected contract promotes them to `nontrading_status` instead
