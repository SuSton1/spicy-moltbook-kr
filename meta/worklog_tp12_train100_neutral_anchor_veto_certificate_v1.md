# TP12 Train100 Neutral Anchor/Veto Certificate v1

- patch key: `tp12_train100_neutral_anchor_veto_certificate_v1`
- purpose: train-only existence/certificate path for 2016-2024 year2hit + train precision 100% + false positive 0 patterns
- forbidden: OOS read, selector emission, hidden fallback, side-daily, intraday, semantic good/bad atom naming

## Preflight

- [x] `tools/bootstrap_target_first_session.sh --scope=target_first_v2`
- [x] read `meta/active_research_contract.json`
- [x] read `meta/active_research_handoff.md`
- [x] read `meta/experiment_patch_memory.json`
- [x] duplicate check for `tp12_train100_neutral_anchor_veto_certificate_v1`
- [x] noted hard stop history: previous source-token exact scope accepted `0`; context/counterexample strict search accepted `0`; remaining frontier unresolved

## Patch Checklist

- [x] Add explicit contract with finite neutral expression spaces and no-OOS/no-fallback gates
- [x] Add neutral feature catalog builder and guard semantic polarity names
- [x] Add atom bitset/support builder for train-only event rows
- [x] Add anchor generator with year2hit-positive support preservation and dominance pruning
- [x] Add conditional veto set-cover miner
- [x] Add exact verifier that recomputes support from atoms and events
- [x] Add certificate writer with found / complete-unsat / honest-incomplete distinction
- [x] Add smoke tests for neutral naming, forbidden fields, OOS guards, veto correctness, verifier correctness, and certificate honesty
- [x] Add verify integration
- [x] Run local verify
- [x] Run server verify
- [x] Register result in experiment registry

## Design Notes

- All atoms are neutral measurements. The search assigns anchor/veto role from train-only support behavior.
- Final expression form is `anchorSupport AND NOT(vetoClause1 OR vetoClause2 ...)`.
- A complete unsat claim requires complete search or solver proof. Capped search with remaining frontier must emit incomplete, not unsat.
- Found candidates are not OOS candidates. This patch only answers train100 existence in a declared finite expression space.

## Authoritative Bounded Train-Only Run

- date: `2026-04-22 KST`
- status: `completed_train_only_bounded_incomplete_no_survivor_found`
- OOS read: `false`
- fallback used: `false`
- locked selector emitted: `false`
- server verify: passed, exit `0`
- local verify: passed, exit `0`

### Pipeline

- [x] feature catalog built
- [x] neutral train event table built from train-only candidate events + context features
- [x] neutral atom support catalog built
- [x] bounded anchor generation run
- [x] bounded anchor/veto mining run on best 50 anchors
- [x] exact verifier run
- [x] certificate writer run

### Key Metrics

- neutral train rows: `149896`
- neutral train hit rows: `32793`
- neutral train candidate hit rate: `21.88%`
- neutral feature atom specs: `631`
- emitted atoms with support: `156`
- generated anchors: `4000`
- anchor search status: `incomplete`
- anchor visited states: `9466`
- duplicate support pruned states: `4206`
- top anchors mined: `50`
- found pattern candidates: `0`
- verified train100 survivors: `0`
- certificate conclusion: `incomplete_no_survivor_found`
- absence proven in scope: `false`

### Interpretation

- No 2016..2024 every-year `>=2` hit, train precision `100%`, false-positive `0` neutral anchor/veto pattern was found in this bounded phase.
- This is not a mathematical non-existence proof. The run capped anchor generation at `4000` anchors and mined the best `50` anchors first.
- The best mined anchors still had false positives; every processed top anchor failed because no conditional veto set could cover all negatives without killing required year2hit support.
- The correct continuation, if strict train100 existence must continue, is batched mining over the remaining anchors or a faster native/indexed set-cover completion path. Do not use this as an OOS selector source.
