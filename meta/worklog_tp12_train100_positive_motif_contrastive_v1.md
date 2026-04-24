# TP12 Train100 Positive Motif Contrastive v1

- patch key: `tp12_train100_positive_motif_contrastive_v1`
- purpose: train-only existence/certificate path for TP12 pre-hit chart motif anchors plus hard-negative conditional vetoes
- forbidden: OOS read, selector emission, fallback, side-daily, intraday, theme/sector, raw symbol/date ID, future label fields as expression features

## Preflight

- [x] `tools/bootstrap_target_first_session.sh --scope=target_first_v2`
- [x] read `meta/active_research_contract.json`
- [x] read `meta/active_research_handoff.md`
- [x] read `meta/experiment_patch_memory.json`
- [x] duplicate check for `tp12_train100_positive_motif_contrastive_v1`
- [x] noted prior hard-stop history: token exact train100 accepted `0`; context/counterexample accepted `0`; neutral anchor/veto bounded run accepted `0`

## Patch Checklist

- [x] Add explicit positive-motif contrastive contract
- [x] Add train label universe materializer
- [x] Add pre-hit chart snapshot builder
- [x] Add symbolic motif feature builder
- [x] Add motif atom catalog builder
- [x] Add positive motif anchor miner
- [x] Add matched/hard negative control builder
- [x] Add anchor full-negative verifier
- [x] Add false-positive contrast analyzer
- [x] Add conditional veto set-cover miner
- [x] Add exact train100 verifier
- [x] Add found / unsat / incomplete certificate writer
- [x] Add smoke tests and verify integration
- [x] Run local verify
- [x] Run server verify
- [x] Register result in experiment registry

## Design Notes

- This patch is not a ranking/OOS/H80 selector path.
- The key search object is `positive motif anchor - conditional negative motif veto`.
- Hit labels and forward path metrics may be used only for class labels, diagnostics, and verification, never as expression atoms.
- A capped run with remaining frontier must be recorded as incomplete, not as non-existence proof.

## Implementation Summary

- Contract: `contracts/tp12_train100_positive_motif_contrastive_contract.json`
- Core implementation: `src/lib/tp12_train100_positive_motif_common.mjs`
- Wrappers: positive hit snapshots, neutral motif features, symbolic catalog, anchor mining, negative controls, full-negative verification, FP contrast, conditional veto set-cover, exact verifier, certificate writer
- CLIs: `tools/assert_tp12_positive_motif_contract.mjs` through `tools/write_tp12_train100_positive_motif_certificates.mjs`
- Smokes: `tools/smoke_tp12_positive_motif_*.mjs`, integrated into `scripts/verify.sh`

## Verification

- Local `npm run verify`: passed
- Server `npm run verify` via `tools/run_server_command.sh npm run verify`: passed
- OOS read: not performed
- Locked selector: not emitted
- Authoritative full label-universe mining run: not executed in this patch turn; bounded train-only candidate-union run completed below.

## Bounded Train-Only Run

- Input: `artifacts/runs/tp12_train100_neutral_anchor_veto_certificate_v1/events/neutral_train_events.jsonl.gz`
- Scope: train-only 2016-2024 candidate-union rows, not OOS and not full 3.65M label universe.
- Universe rows: `149,896`
- Hit rows: `32,793`
- Hit rate: `21.8772%`
- Symbolic motif atoms: `74`
- Positive motif anchor search: complete
- Anchor states visited: `2,414`
- Generated anchors: `572`
- Pure train100 anchors before veto: `0`
- Negative control rows emitted: `12,115,500`
- Conditional veto contrast processed anchors: `10`
- Conditional veto clauses emitted: `500`
- Conditional veto set-cover found patterns: `0`
- Exact verifier verified survivors: `0`
- Certificate conclusion: `incomplete_no_survivor_found`
- Existence resolved: `false`
- Absence proven in scope: `false`
- OOS read: `false`
- Fallback used: `false`
- Locked selector emitted: `false`

## Result Interpretation

- This bounded run does not prove train100 patterns do not exist.
- It does show that broad pre-hit motif atoms and shallow top-anchor veto search did not find a 2016-2024 every-year 2-hit, false-positive-zero pattern.
- All `572` generated anchors still had false positives when checked against the train candidate-union universe.
- The first bounded veto pass remained incomplete, so the correct certificate is incomplete, not unsat.
- Next root-cause step is either deeper/faster set-cover over more anchors and 3-4 atom anchors, or finer motif expressions/sequence shapelets that split the false-positive clusters more sharply.
