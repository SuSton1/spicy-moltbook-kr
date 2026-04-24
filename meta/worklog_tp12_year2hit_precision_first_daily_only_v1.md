# TP12 Year2Hit Precision-First Daily-Only V1 Worklog

Patch key: `tp12_year2hit_precision_first_daily_only_v1`

## Checklist

- [x] Bootstrap target-first session.
- [x] Read active research contract, handoff, and patch memory.
- [x] Duplicate-check patch key.
- [x] Add explicit daily-only precision-first contract.
- [x] Add fail-fast contract assertion.
- [x] Add daily-only feature whitelist and forbidden live-feature guard.
- [x] Add train-only row-level precision-first rule engine.
- [x] Add CLI entrypoint.
- [x] Add server wrapper.
- [x] Add smoke tests.
- [x] Integrate `scripts/verify.sh`.
- [x] Run local `npm run verify`.
- [x] Run server `npm run verify`.
- [x] Run train-only diagnostic.
- [x] Register experiment result.
- [x] Update active research handoff.

## Scope

This patch targets raw candidate-pool precision before one-pick ranking. It keeps the existing year2hit requirement intact and only evaluates daily-only, as-of-safe features. Side-daily, intraday, theme/sector external data, OOS threshold tuning, hidden fallback, and locked selector emission are out of scope.

## Result

- local verify: passed (`npm run verify`, exit 0).
- server verify: passed (`bash tools/run_server_command.sh npm run verify`, exit 0).
- local/server diagnostic status: `completed_train_only_diagnostic`.
- verdict: `research_precision_lift_found`.
- baseline candidate rows: `74061`.
- baseline hit rows: `15245`.
- baseline hit rate: `20.58%`.
- evaluated rule count: `21`.
- research-passed rules: `6`.
- promotion-passed rules: `0`.
- best rule: `support_quality_density_gate_q0.55_tc0.75`.
- best selected rows: `29236`.
- best hit rows: `7811`.
- best hit rate: `26.72%`.
- best hit-rate lift: `+6.13pp`.
- best Wilson lower95: `26.21%`.
- matched-control precision: `17.96%`.
- matched-control absolute lift: `+8.76pp`.
- OOS read: `false`.
- side-daily used: `false`.
- intraday/theme used: `false`.
- locked selector emitted: `false`.

## Interpretation

Daily-only precision-first filtering can lift the raw year2hit candidate pool from `20.58%` to `26.72%`, so the direction is useful as a candidate-pool cleaning layer. It is not a promotion/H80 result: no rule met the promotion gate, and no OOS replay or locked selector was opened.
