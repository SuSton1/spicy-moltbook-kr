# TP12 Train100 Sequence Shapelet Contrastive v1

- patch key: `tp12_train100_sequence_shapelet_contrastive_v1`
- purpose: train-only existence/certificate path for TP12 train100 year2hit patterns using real daily candle sequence/shapelet atoms
- forbidden: OOS tuning/replay, selector emission, fallback, side-daily, intraday, theme/sector, raw symbol/date ID, future label fields as expression atoms

## Preflight

- [x] `tools/bootstrap_target_first_session.sh --scope=target_first_v2`
- [x] read `meta/active_research_contract.json`
- [x] read `meta/active_research_handoff.md`
- [x] read `meta/experiment_patch_memory.json`
- [x] duplicate check for `tp12_train100_sequence_shapelet_contrastive_v1`
- [x] carried forward prior hard-stop history: strict token/context train100 accepted `0`; neutral anchor/veto accepted `0`; positive motif accepted `0`

## Patch Checklist

- [x] Add explicit sequence-shapelet train100 contract
- [x] Reuse positive motif pipeline without OOS, selector, or fallback path
- [x] Add daily candle history loader from `data/candle_daily.jsonl`
- [x] Enforce forbidden OOS date rows are skipped from candle-history index
- [x] Add D-60..D sequence/shapelet snapshot features
- [x] Add neutral sequence atoms and shapelet atoms
- [x] Add bounded anchor mining for sequence-enhanced atom catalog
- [x] Add bounded negative-control cap for veto work
- [x] Add sequence-shapelet smoke fixture
- [x] Integrate sequence smoke into `scripts/verify.sh`
- [x] Run local targeted checks
- [x] Run local `npm run verify`
- [x] Run server `npm run verify`
- [x] Run bounded train-only sequence-shapelet search on server
- [x] Sync JSON result artifacts locally
- [x] Register result in experiment registry

## Design Notes

- This patch does not change OOS, does not emit a locked selector, and does not create a runtime fallback.
- The new feature source is actual daily candle history, not only prior summary fields.
- Feature names remain neutral: sequence/shapelet atoms describe state, not semantic good/bad labels.
- The search result is a certificate-style result. A capped run with remaining frontier is incomplete, not an absence proof.

## Implementation Summary

- Contract: `contracts/tp12_train100_sequence_shapelet_contrastive_contract.json`
- Core implementation: `src/lib/tp12_train100_positive_motif_common.mjs`
- CLI updates:
  - `tools/build_tp12_pre_hit_chart_snapshots.mjs`
  - `tools/build_tp12_motif_negative_controls.mjs`
- New smoke: `tools/smoke_tp12_sequence_shapelet_features.mjs`
- Verify integration: `scripts/verify.sh`

## Verification

- Local targeted checks: passed
- Local `npm run verify`: passed
- Server `npm run verify` via `tools/run_server_command.sh npm run verify`: passed
- OOS tuning/replay: not performed
- Locked selector emitted: `false`
- Fallback used: `false`

## Bounded Train-Only Run

- Input events: `artifacts/runs/tp12_train100_neutral_anchor_veto_certificate_v1/events/neutral_train_events.jsonl.gz`
- Candle source: `data/candle_daily.jsonl`
- Scope: train-only 2016-2024 candidate-union rows; not full 3.65M label universe
- Universe rows: `149,896`
- Hit rows: `32,793`
- Hit rate: `21.8772%`
- Candle input rows scanned: `4,484,829`
- Candle rows used: `3,717,038`
- Forbidden/OOS date rows skipped: `760,169`
- Candle-history matched rows: `149,896`
- Candle-history missing rows: `0`
- Candle-history coverage rate: `1.0`
- Candle-history short rows: `4,659`
- Unique motif atoms after sequence enrichment: `231`
- Generated anchors: `5,000`
- Anchor search complete: `false`
- Pure train100 anchors before veto: `0`
- Negative-control processed anchors: `20`
- Negative-control rows emitted: `1,444,453`
- Conditional veto processed anchors: `20`
- Conditional veto found patterns: `0`
- Conditional veto rejected patterns: `20`
- Conditional veto incomplete anchors: `20`
- Conditional veto search complete: `false`
- Exact verifier input patterns: `0`
- Exact verifier verified survivors: `0`
- Certificate conclusion: `incomplete_no_survivor_found`
- Existence resolved: `false`
- Absence proven in scope: `false`
- OOS read flag in artifacts: `false`
- Fallback used flag in artifacts: `false`
- Locked selector emitted: `false`

## Result Interpretation

- Adding real D-60..D daily candle sequence/shapelet atoms increased the neutral motif catalog from the prior `74` atoms to `231` atoms.
- Even with those sequence atoms, the bounded search found no train100 every-year 2-hit, false-positive-zero pattern.
- This is not a proof that no such pattern exists. The anchor search and veto search both ended incomplete due bounded caps.
- The result is still meaningful negative evidence: the first 5,000 generated sequence-enriched anchors had no pure train100 anchor, and the first 20 anchor-veto set-cover attempts produced no verified survivor.
- The next root-cause step, if this branch continues, is search-engine efficiency and coverage: better anchor prioritization, lower-level set-cover pruning, or a full train universe run. It is not OOS tuning.
