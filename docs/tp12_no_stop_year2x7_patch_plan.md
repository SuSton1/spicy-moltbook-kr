# TP12 No-Stop lb5 Year2x7 Patch Plan

## Goal

Audit the completed canonical `lb5` TP12 no-stop bank under a stricter time-stability rule before
opening any new search:

- core years: `2017..2023`
- minimum hits per core year: `2`
- boundary years `2016` and `2024` stay in train data but do not count toward the gate

This branch does **not** reopen mining first. It first asks a narrower question:

- if the completed `lb5` bank is filtered to `strict year2x7`, does untouched
  `2025-01-02 ~ 2026-03-27` OOS quality improve enough to justify a new search-v2 branch?

## Why This Comes Before Search-v2

The proposed filter is much stronger than the current `date/month/fold` gate.

- current gate:
  - `minHitCount = 4`
  - `minTrainMatchedDates = 4`
  - `minTrainMatchedMonths = 4`
  - `minTrainMatchedFolds = 3`
- proposed strict gate:
  - `2017..2023`
  - each year must contribute at least `2` train hits

This can easily collapse the bank to near-zero rules. So the first pass must be:

1. audit the completed bank
2. replay the strict subset on the same untouched OOS
3. only if that survives, consider a fresh search-v2

## Fixed Baseline

The canonical completed baseline for this branch is:

- run:
  - `tp12_no_stop_lb5_full_retrain_final_confirm_maxrules300k_v1_20260408`
- train:
  - `2016-08-12 ~ 2024-12-27`
- untouched OOS:
  - `2025-01-02 ~ 2026-03-27`
- baseline OOS:
  - `30 / 105 = 28.57%`
- baseline frozen rules:
  - `29,182`

## Patch Scope

This branch adds:

- machine-readable year2x7 contract
- rule-level year coverage audit tool
- strict subset frozen-catalog rebuild
- raw train/OOS replay summary against the same untouched OOS
- smoke coverage and verify wiring

This branch does **not** add:

- new mining criteria inside the indexed miner
- new `20M` search reruns
- scope widening to `LOW`, `MID`, or `TOP`
- lookback changes beyond `lb5`

## Patch Outputs

Expected outputs under `artifacts/runs/<run-id>/`:

- `year2x7_audit/rule_year_coverage.jsonl`
- `year2x7_audit/year2x7_survivor_rule_ids.txt`
- `year2x7_audit/year2x7_audit_summary.json`
- `freeze_result.json`
- `step-perfect-prototype-open-train-apply-raw/`
- `step-perfect-prototype-open-oos-apply-raw/`
- `year2x7_replay_summary.json`
- `year2x7_replay_report.md`

## Promotion Gate

The strict subset is worth a search-v2 only if all are true:

- OOS hit-rate improves over baseline `28.57%`
- selected rows do not collapse to trivial size
- unique matched dates do not collapse to trivial size
- `top1DateShare` does not worsen materially

If not, the branch closes as:

- `invalid_or_inconclusive`
- no automatic relaxation
- any relaxed filter becomes a separate patch key

## Follow-Up Only If Green

Only if strict year2x7 replay is green:

1. open a separate search-v2 contract
2. first run a `200K` screen
3. only if screen survives, run `20M` final confirm

Do not jump directly to `20M` search-v2 from the current baseline.
