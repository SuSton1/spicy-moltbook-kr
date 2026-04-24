# TP12 train100 year2hit existence certificate v1

Patch key: `tp12_train100_year2hit_existence_cert_v1`

## Checklist

- [x] Bootstrap target-first session.
- [x] Read `meta/active_research_contract.json`.
- [x] Read `meta/active_research_handoff.md`.
- [x] Read `meta/experiment_patch_memory.json`.
- [x] Run duplicate check for `tp12_train100_year2hit_existence_cert_v1`.
- [x] Add explicit existence certificate contract.
- [x] Add certificate builder library.
- [x] Add CLI.
- [x] Add smoke tests.
- [x] Add verify integration.
- [x] Run local certificate.
- [x] Run server certificate.
- [x] Run local `npm run verify`.
- [x] Run server `npm run verify`.
- [x] Register experiment result.
- [x] Update handoff closeout.

## Intent

This branch answers a narrow question: whether the already-searched train100 year2hit spaces contain a pattern with:

- `2016..2024` every core year having at least two hit decision dates.
- At least 18 positive symbol/date rows.
- Train precision exactly `100%`.
- False-positive symbol/date rows exactly `0`.

It must not claim global non-existence unless every declared scope is complete. Incomplete frontier searches are reported as unresolved negative evidence only.

## Result

- conclusion: `no_survivor_found_but_global_existence_unresolved`
- found train100 year2hit pattern count in declared scopes: `0`
- OOS read: `false`
- locked selector emitted: `false`
- exact source-token scope:
  - scope id: `token_source_atoms_exact_max6_v1`
  - status: `absence_proven_in_scope`
  - atom count: `114`
  - seed atom count: `41`
  - evaluated candidates: `413195`
  - accepted candidates: `0`
  - search complete: `true`
- context-expanded counterexample scope:
  - scope id: `context_counterexample_atoms_max7_16m_v1`
  - status: `no_survivor_observed_incomplete`
  - accepted train100 patterns: `0`
  - visited states: `16000000`
  - remaining frontier: `1166`
  - search complete: `false`

## Interpretation

The already-complete 114 source-token atom scope proves that no train100 year2hit pattern exists within that bounded scope. The broader context-expanded search also found no survivor after 16M states, but it is incomplete, so this patch does not claim global non-existence.

This certificate is not a selector source and cannot be used for OOS replay. Future strict-train100 work must open an explicit unsat/completion objective rather than treating this incomplete negative evidence as a production path.
