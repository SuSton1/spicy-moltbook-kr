# TP12 Kiwoom Intraday Patch Plan

## Status Note

As of `2026-04-05`, this plan remains the `optional minute branch`.

The immediate primary path for TP12 improvement is now tracked separately at:

- `docs/tp12_side_daily_patch_plan.md`

Reason:

- minute history remains source-blocked for the intended `2016~2026` broad Step A plan
- side-daily families can be advanced without waiting on minute depth closure

## Goal

Build a patch-ready, fail-fast, server-only Kiwoom REST subsystem that can:

1. collect the TP12 broad Step A candidate universe with real 1-minute bars
2. collect side-daily context that can reduce false positives in OOS
3. produce leak-free intraday feature datasets for:
   - `D0 close gate`
   - `D+1 early gate`
   - execution-policy selection

This plan is intentionally explicit and single-path.

- source: `Kiwoom REST` only
- no hidden source switching
- no degraded fallback path
- if the historical depth contract is insufficient, the 10-year plan stops
- if the first real minute pilot proves the history floor is too short, the broad minute plan stays blocked until the source question is closed

## Confirmed Current Facts

### Repo state

- canonical KR daily coverage is already closed:
  - `data/candle_daily.jsonl`: `2016-01-04 ~ 2026-04-03`
  - `data/universe_daily.jsonl`: `2016-01-04 ~ 2026-04-03`
- current Step A and TP12 pipelines are effectively daily-only
- current `hourly60m` contract is not usable as a real intraday store:
  - it only contains `symbol`, `tradingDateKey`, `tsKst`, `volume`

### Kiwoom state

- server token issuance already works with the current app key / secret
- the following probes already succeeded on the server:
  - `ka10080` minute chart
  - `ka10060` investor / institution daily chart
  - `ka10064` intraday investor chart
  - `ka90013` stock daily program-trading trend
  - `ka10047` daily trade strength
- observed behavior:
  - minute bars do not behave like a free random-access historical API
  - recent anchor requests return real rows and `cont-yn=Y`
  - direct old-date minute requests can return zero rows
  - therefore minute history must be treated as a reverse-continuation walk, not a random date jump
  - first real `20-symbol` minute pilot now proves explicit source-depth failure on real TP12 requests:
    - `000520` exhausted continuation at `2025-04-01T09:00:00+09:00` before the requested `2024-12-30T09:00:00+09:00` floor
    - `002410` returned only a blank placeholder row on the first page
- daily side-data is more favorable:
  - old date anchors already returned historical rows
  - responses also advertised `cont-yn=Y`
- a real LOW_GAP_TOP allowlist has already been built from downstream daily-pack output, but its first narrowed manifest run failed because the reused OOS broad `Step A` artifact was stale versus the repaired canonical candle calendar
- root-cause interpretation:
  - the allowlist contract is correct
  - the broad OOS `Step A` source must be refreshed against current canonical daily data before real narrowed manifest builds can continue
- second root-cause discovered during the fresh rerun:
  - even after the broad OOS `Step A` refresh, a global candle-calendar assumption in the manifest builder was still wrong for symbols with sparse trading dates
  - `prevDateKey` must be validated against the symbol's own candle sequence, not the previous global trading date
- current resolved state:
  - the manifest builder now uses symbol-local trading calendars
  - a fresh `recent_impulse_upto_1d` OOS `Step A` source plus the real LOW_GAP_TOP allowlist now rebuilds successfully with `4831/4831` allowlist matches

## Why This Patch Is Needed

The current TP12 conclusion is:

- the supplier signal exists, especially in `LOW_GAP_TOP`
- the current execution contract destroys too much of that signal
- exact-rule tuning is exhausted for now

That means the next lift is not a bigger daily search. The next lift is:

1. reject bad candidates earlier
2. distinguish stable trend continuation from unstable pump-like behavior
3. choose a better execution policy per candidate

It also needs a provenance-safe refresh path for the broad `Step A` source itself:

1. rebuild `recent_impulse_upto_1d` OOS `Step A` against current canonical candles
2. regenerate the narrowed intraday manifest from that fresh source plus the downstream allowlist
3. only then start real Kiwoom side-daily/minute collection

The best additional inputs for that are:

1. minute bars
2. investor / program / trade-strength
3. shorting / lending / credit
4. sector context
5. broker / orderbook / VI, where available

## Final Dataset Scope

### Primary candidate universe

Use the broad `Step A` candidate universe, not just the final winners.

Rationale:

- if only final selected names are collected, the intraday model sees only positives
- that creates heavy selection bias
- the gate needs both:
  - names that looked tradable
  - names that looked tradable but failed

### Event window

Per Step A candidate event, collect:

- `D-1`
- `D0`
- `D+1`
- `D+2`
- `D+3`
- `D+4`

`D-1` is required because the desired gate is not only:

- "what happened after the event"

It is also:

- "did the event show pre-breakout accumulation or abnormal instability before the surge"

### Estimated scale

Current TP12 1D Step A universe estimate:

- about `41.6K` events over `2016-01-04 ~ 2026-04-03`
- about `97.4M` one-minute bars for `D-1 .. D+4`

This is large, but still realistic if stored as date partitions and collected server-side with low concurrency.

## Data Layers

### Layer A: Minute bars

Required:

- `ka10080` minute chart

Canonical storage:

- `data/intraday_1m/date=YYYY-MM-DD/part-000.jsonl`
- `data/intraday_1m_presence_daily.jsonl`

Suggested row fields:

- `symbol`
- `tradingDateKey`
- `tsKst`
- `open`
- `high`
- `low`
- `close`
- `volume`
- `valueKrw`
- `source`
- `apiId`
- `runId`

Important:

- do not overload `candle_hourly60m.jsonl`
- do not create one huge `candle_minute1.jsonl`

### Layer B: Side-daily context

Must-have:

- `ka10060` investor / institution daily chart
- `ka90013` stock daily program-trading trend
- `ka10047` daily trade strength
- `ka10014` short-selling trend
- `ka10068` lending trend
- `ka20068` stock lending trend
- `ka10013` credit-trading trend
- `ka20009` sector daily prices
- `ka10051` sector investor net buy
- `ka10010` sector program

Canonical storage:

- `data/intraday_side/investor_daily.jsonl`
- `data/intraday_side/program_daily.jsonl`
- `data/intraday_side/trade_strength_daily.jsonl`
- `data/intraday_side/shorting_daily.jsonl.zst`
- `data/intraday_side/lending_daily.jsonl.zst`
- `data/intraday_side/credit_daily.jsonl.zst`
- `data/intraday_side/sector_daily.jsonl.zst`

### Layer C: Forward-accrual only

These are useful, but should be treated as accrual-only unless a historical contract is proven:

- websocket `0B` stock trade
- websocket `0D` orderbook depth
- websocket `0F` broker flow
- websocket `0w` program trading
- websocket `1h` VI event
- `ka10004` orderbook snapshot
- `ka10002`, `ka10043`, `ka10052` broker / broker-pressure tools

These should not be misrepresented as backfilled 10-year canonical datasets unless probes prove that.

## Patch Bundles

## Bundle 1: Kiwoom auth + contract probe

Add:

- `tools/kiwoom_rest_client.py`
- `tools/probe_kiwoom_rest_depth.py`
- `tools/smoke_kiwoom_rest_probe.py`

Responsibilities:

- token issuance
- API call wrapper
- explicit rate limit handling
- explicit `cont-yn` and `next-key`
- probe persistence under `artifacts/kiwoom_probe/...`

Hard-stop rules:

- missing env => fail
- token issuance fail => fail
- 429 bursts above threshold => fail
- old-depth probe inconclusive => fail

No fallback:

- no silent retry path that changes source or mode
- no "best effort" partial success

## Bundle 2: Step A intraday request manifest

Add:

- `tools/build_tp12_stepa_intraday_manifest.mjs`
- `tools/smoke_tp12_stepa_intraday_manifest.mjs`

Source of truth for manifest:

- `step-a/events_high8_lite.jsonl`
- `step-a/step_a_summary.json`

The builder must support both:

- existing run artifacts
- future fresh Step A run outputs

Manifest row fields:

- `symbol`
- `decisionDateKey`
- `prevDateKey`
- `asOfDateKey`
- `stepALaneId`
- `impulseSourceDateKey`
- `impulseLookbackDays`
- `windowStartDateKey`
- `windowEndDateKey`
- `windowDateKeys`
- `eventLabel`
- `highJumpThreshold`
- `highJumpMode`
- `recentImpulseLookbackTradingDays`
- `runId`
- `sourceSummaryPath`
- `sourceEventsPath`

The manifest must be broad-candidate safe:

- it includes all Step A candidates, not just trades later selected by Step B/D
- it records enough provenance to rebuild the exact universe later

## Bundle 3: Minute backfill engine

Add:

- `tools/backfill_kiwoom_intraday_1m.py`
- `tools/qc_kiwoom_intraday_1m_stage.py`
- `tools/merge_kiwoom_intraday_1m_stage.py`
- `tools/run_kiwoom_intraday_1m_backfill.sh`
- `tools/server_run_kiwoom_intraday_1m_backfill.sh`

The collector shape must differ from historical daily collection.

Daily historical collection was date-ranged and shardable by symbol with bounded windows.

Minute collection must be:

- symbol-first
- reverse-continuation
- checkpointed

Collector algorithm:

1. group manifest requests by symbol
2. derive the oldest required window floor per symbol
3. start from a recent anchor
4. call `ka10080`
5. follow `next-key` backward
6. write only rows whose `tradingDateKey` is inside requested windows
7. checkpoint:
   - `nextKey`
   - `oldestTsSeen`
   - `pageCount`
   - `rowCount`
   - `rateLimitHitCount`
   - `completedFloorDate`
8. stop when the symbol floor is crossed

Stage output:

- `artifacts/backfill/kiwoom_intraday_1m/run=<id>/shard=<n>/...`

Default runtime:

- `1 worker`
- `1.2 ~ 1.5s` sleep between requests
- no auto scale-up

## Bundle 4: Side-daily backfill engine

Add:

- `tools/backfill_kiwoom_side_daily.py`
- `tools/qc_kiwoom_side_daily_stage.py`
- `tools/merge_kiwoom_side_daily_stage.py`
- `tools/run_kiwoom_side_daily_backfill.sh`
- `tools/server_run_kiwoom_side_daily_backfill.sh`

This collector is separate from the minute collector because:

- the request patterns differ
- the date contracts differ
- the expected page sizes and QC rules differ

Each dataset must retain explicit provenance:

- `apiId`
- `requestBody`
- `contYn`
- `nextKey`
- `runId`

## Bundle 5: Contracts and loader updates

Update:

- `docs/data_contracts.md`
- `src/lib/config.mjs`

Recommended config additions:

- `intraday1mRoot`
- `intraday1mPresenceJsonl`
- `intradaySideInvestorDailyJsonl`
- `intradaySideProgramDailyJsonl`
- `intradaySideTradeStrengthDailyJsonl`
- `intradaySideShortingDailyJsonl`
- `intradaySideLendingDailyJsonl`
- `intradaySideCreditDailyJsonl`
- `intradaySideSectorDailyJsonl`

Do not wire these into runtime readers until the feature builder exists and the contracts are stable.

Implemented on `2026-04-04`:

- explicit `dataPaths` entries for `intraday_1m` and side-daily canonical files
- feature dataset contract entry in `docs/data_contracts.md`

## Bundle 6: Feature datasets

Add:

- `src/lib/tp12_intraday_feature_builder.mjs`
- `tools/build_tp12_intraday_feature_dataset.mjs`
- `tools/smoke_tp12_intraday_feature_dataset.mjs`

Required feature packs:

### `D0 close gate`

Feature cutoff:

- only `D-1 .. D0 close`

Examples:

- `dminus1_last30m_volume_burst`
- `dminus1_close_runup_pct`
- `d0_first5m_ret`
- `d0_first30m_high_pct`
- `d0_first30m_low_pct`
- `d0_vwap_hold_ratio`
- `d0_morning_breakout_score`
- `d0_close_strength`

### `D+1 early gate`

Feature cutoffs:

- `D+1 09:05`
- `D+1 09:15`
- `D+1 09:30`

Examples:

- `d1_open_flush_depth`
- `d1_reclaim_after_flush`
- `d1_first15m_volume_ratio`
- `d1_first30m_high_pct`
- `d1_first30m_low_pct`

### `Execution policy selector`

Labels:

- `stop_first_net_ret`
- `delay1_4d_net_ret`
- `touch_anchor_net_ret`
- `abstain_best_choice`

Examples:

- `minutes_to_tp12`
- `minutes_to_sl4`
- `day1_mfe`
- `day1_mae`

Implemented on `2026-04-04`:

- compact feature rows under `artifacts/tp12_intraday/features/run=<id>/feature_rows.jsonl`
- leak-safe gate rows for:
  - `d0_close`
  - `d1_0905`
  - `d1_0915`
  - `d1_0930`
- current supported flow families:
  - `investor_daily`
  - `program_daily`
  - `trade_strength_daily`
- runtime integration remains deferred; raw minute partitions are still not wired into the runtime loaders

## Bundle 6.5: Gate-specific experiment bridge

Add:

- `src/lib/tp12_intraday_feature_bridge.mjs`
- `tools/build_tp12_intraday_feature_pack_bridge.mjs`
- `tools/smoke_tp12_intraday_feature_bridge.mjs`
- `tools/run_tp12_intraday_feature_pack_bridge.sh`
- `tools/server_run_tp12_intraday_feature_pack_bridge.sh`

Contract:

- consume gate-specific derived intraday feature rows before any raw-minute runtime loading
- join Step-D `decision_candidates_feature_pack.jsonl` with derived rows on `(symbol, decisionDateKey)`
- merge `features` only
- never copy `labels`
- write gate-specific bridged feature packs as explicit experiment inputs
- fail if any Step-D row or any derived row is unmatched

## Bundle 7: Verification and operations

Update:

- `scripts/verify.sh`
- `meta/active_research_handoff.md`
- `meta/session_resume_20260403_tp12_low_gap_top.md`

Verify additions:

- auth probe smoke
- depth probe smoke
- manifest shape smoke
- minute stage/QC/merge smoke
- side-daily stage/QC/merge smoke
- feature leakage smoke

Operational rules:

- heavy runs are server-only
- server runtime data remains source-of-truth
- sync scripts must not delete stage outputs
- no local-only canonical divergence

## Bundle 8: Strict orchestration wrappers

Add:

- `tools/run_kiwoom_tp12_inputs.sh`
- `tools/run_kiwoom_tp12_backfill.sh`
- `tools/run_kiwoom_tp12_pipeline.sh`
- `tools/server_run_kiwoom_tp12_pipeline.sh`

Contract:

- orchestration is explicit and single-path
- `run_kiwoom_tp12_pipeline.sh` may either:
  - build a manifest from Step-A sources
  - or consume an explicit prebuilt manifest
- it must then run:
  - side-daily backfill
  - minute backfill
  - derived feature dataset build
  - gate-specific bridged feature pack materialization
- only a single final `npm run verify` is allowed in the end-to-end pipeline wrapper
- lower-level wrappers remain direct-entry tools, but support explicit `--skip-verify` for orchestration use

## Leakage / Bias Guardrails

### Leakage

Strict split:

- `D0 close model` can only use `D-1 .. D0`
- `D+1 09:05 model` can only use bars up to `09:05`
- `D+1 09:30 model` can only use bars up to `09:30`

Everything after the cutoff is label-only.

### Selection bias

Do not build the minute dataset from:

- final trades
- touch winners
- OOS hits only

Build it from the broad Step A candidate universe.

### False confidence

Do not claim:

- "10-year minute history is available"

Until the probe artifact proves the oldest reachable depth via continuation.

## Rollout Order

Completed:

1. `Bundle 1`: Kiwoom auth + depth probe skeleton
2. `Bundle 2`: Step A intraday manifest
3. `Bundle 3`: side-daily stage/QC/merge for `investor/program/trade_strength`
4. `Bundle 4`: minute stage/QC/merge
5. `Bundle 5`: data contracts / config
6. `Bundle 6`: feature dataset
7. `Bundle 6.5`: gate-specific Step D bridge
8. `Bundle 7`: verify / handoff / resume wiring
9. `Bundle 8`: strict orchestration wrappers
10. `Bundle 9`: downstream allowlist narrowing + fresh OOS Step A refresh path

Remaining authoritative order:

1. `Bundle 10`: close minute timestamp/session contract and prove actual pilot depth
2. `Bundle 11`: run a real narrow server pilot from the fresh LOW_GAP_TOP manifest
3. `Bundle 12`: pass QC/coverage gate with zero partial windows
4. `Bundle 13`: build the first real `d0_close` feature artifact
5. `Bundle 14`: build a bridged pack and a same-universe OOS comparison summary
6. `Bundle 15`: expand gate-by-gate (`d1_0905 -> d1_0915 -> d1_0930`)
7. `Bundle 16`: add side-daily families one by one (`shorting/loan/credit/sector`)
8. `Bundle 17`: expand scope (`LOW_GAP_TOP -> LOW -> broader Step A`)
9. `Bundle 18`: only after the above, consider forward-only websocket accrual

The checklist file is the source of truth for all remaining checkboxes:

- `docs/tp12_kiwoom_intraday_patch_checklist.md`

## Immediate Next Patch

The next patch bundle is no longer a scaffolding patch. It is the first operational close-out bundle:

1. run a real `20-symbol` server pilot from the fresh LOW_GAP_TOP narrowed manifest
2. force full-window QC
3. build the first real `d0_close` feature artifact
4. produce the first same-universe baseline-vs-bridged comparison summary

Bundle 10 is now closed:

- Kiwoom minute `cntr_tm` is treated as `KST` local, not `UTC`
- regular-session bounds are enforced both in the collector/QC path and in probe summaries
- smoke coverage now proves that `09:00/09:01` remains in-session after normalization
- local `bash scripts/verify.sh` and server `bash scripts/verify.sh` both passed after the fix

Do not skip directly to full `LOW_GAP_TOP`, full `LOW`, or full historical minute rollout before those four remaining items are green.

## Bundle 9

Root-cause patch for `LOW_GAP_TOP` and similar downstream scopes:

- broad Step A lanes are not fine-grained enough to express downstream prototype families
- explicit narrowing must therefore happen via an allowlist built from downstream `daily_pack.jsonl`
- canonical flow:
  1. build allowlist from downstream pack
  2. intersect broad Step A events with that allowlist
  3. only then run side-daily / minute backfill

Immediate effect:

- first low-gap-top pilot can now be driven by:
  - `step-perfect-prototype-open-oos-pack/daily_pack.jsonl`
  - `tools/build_tp12_intraday_allowlist_from_pack.mjs`
  - `tools/run_kiwoom_tp12_inputs.sh --allowlist-path=...`
