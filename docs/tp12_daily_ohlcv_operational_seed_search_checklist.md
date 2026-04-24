# TP12 Daily OHLCV Operational Seed Search Checklist

Patch stack: `tp12_daily_ohlcv_operational_seed_search_stack_v1`

## Final Goal
- Find train-only 2016-2024 TP12 patterns that produce at least two operational hits per year.
- A hit is valid only when `operationalHitTarget === true`.
- Build a bundle that reaches at least five executable TP12 recommendations and five operational TP12 hits in every explicit full month.
- Do not read or use `2025-01-02` or later rows until all train/internal gates pass and hashes are locked.

## Hard Exclusions
- Do not use investor flow, program flow, trade strength, intraday bars, news, theme, sector, market-cap, or universe liquidity tokens.
- Do not use `entryOpen`, `entryPrice`, `entryVolume`, `entryGapPct`, `hitDateKey`, `targetPrice`, D+1 rows, forward high/low, or any label/outcome field as a feature.
- Do not treat `hitTarget` or `chartHitTarget` as operational success.
- Do not delete non-executable rows. They remain misses.
- Do not relax gates when survivor count is zero.

## Daily D0 Token Surface
- Tokenizer id: `tp12_daily_ohlcv_d0_tokenizer_v1`.
- Source fields: D0 and prior daily OHLCV only.
- Token vocabulary must stay at or below 63 tokens while the miner uses `uint64_token_mask`.
- Candlestick tokens must include range, body, upper wick, lower wick, close location, bull body, and bear body.
- Volume tokens must include surge, dry-up, 5/20/60/120 moving-average relationships, compression, and re-expansion.
- Trading-value tokens must include relative value, moving-average relationships, compression, and re-expansion.
- Price moving-average tokens must include close versus 5/20/60/120-day averages and moving-average ordering.
- Breakout/recovery tokens must use prior-window highs and reclaim of moving averages.

## Staged Search
- Stage 1: `small_precision_seed`.
  - Max pattern size: 4.
  - Candidate budget: 50,000.
  - Required outcome: at least one pattern with year2 operational hits and zero operational misses.
  - If zero survivor, stop and register failure. Do not run full search.
- Stage 2: `medium_expand`.
  - Requires a passed seed-existence certificate from stage 1.
  - Max pattern size: 5.
  - Candidate budget: up to 500,000.
  - OOS/preflight remains blocked.
- Stage 3: `full_exact`.
  - Run only after stage 2 proves non-hit-free seeds exist.
  - Results are not complete unless the exact search finishes without truncation.

## Early Dedupe
- Use sorted `decisionDateKey<TAB>symbol` support signatures.
- Drop exact duplicate support signatures during mining.
- Drop near duplicates during mining only when `supportJaccard >= 0.98`.
- Drop containment duplicates only when containment is at least `0.985` and support-size ratio is at least `0.90`.
- Early dedupe is for speed only. Final dedupe must re-check all selected candidates.

## Final Dedupe And Concentration
- Reject exact same support signature.
- Reject final similar patterns when `supportJaccard >= 0.90`.
- Mark `0.85 <= supportJaccard < 0.90` as same-family and prevent simultaneous selection.
- Reject top-symbol recommendation share above `0.25` at pattern level.
- Reject top-year recommendation or hit share above `0.30` at pattern level.
- Bundle-level top one symbol share must be at most `0.20`.
- Bundle-level top three symbol share must be at most `0.50`.

## Operational Gates
- Pattern bank must use `operationalHitTarget`.
- Non-hit purge requires operational misses `0` and non-executable rows `0`.
- Internal validation uses leave-one-year-out folds for 2016-2024.
- Validation fold requires operational misses `0`, not-chart-hit rows `0`, and at least two operational hit dates and symbol-dates in each validation year.

## Monthly And Locked Future
- Full months are explicit. Do not infer them from data.
- Every full month must have recommendation rows `>= 5` and operational hit rows `>= 5`.
- Recommendation count must not be filled by lowering precision or non-executable gates.
- OOS unlock requires all train/internal gates, dedupe hashes, monthly coverage, integration gate, and no-future-tuning leakage checks to pass.
- After OOS is read, threshold or selector changes are prohibited for the same locked manifest.

## Verification
- Local: `npm run verify`.
- Server: `bash tools/run_server_command.sh npm run verify`.
- Register every completed or failed experiment in the same turn with `tools/register_experiment_result.sh`.
