# Server Disk Cleanup Candidates (2026-04-07)

## Execution Status
- `2026-04-07` delete-first wave executed
- exact delete list:
  - `/home/saida/code/stockdesk-lab-lite/meta/server_disk_cleanup_delete_first_paths_20260407.txt`
- delete result log:
  - `/home/saida/code/stockdesk-lab-lite/meta/server_disk_cleanup_delete_first_result_20260407.txt`
- pre-cleanup footprint:
  - `/home/saida/code/stockdesk-lab-lite/meta/server_disk_cleanup_pre_state_20260407.txt`
- post-cleanup footprint:
  - `/home/saida/code/stockdesk-lab-lite/meta/server_disk_cleanup_post_state_20260407.txt`
- result:
  - deleted `183` run directories
  - missing `0`
  - delete-first remaining matches `0`
- disk impact:
  - before: `/dev/vda2` `240G` used, `44G` available
  - after: `/dev/vda2` `177G` used, `107G` available
  - `artifacts/runs`: `169G -> 106G`
- explicit keep recheck after deletion:
  - `artifacts/runs/tp12_*` still present
  - `artifacts/runs/*scientific*` still present
  - `artifacts/runs/tp12_no_stop_low_gap_top_lookback_ladder_sparse_screen_v1_20260407*` still present
- untouched for now:
  - `live_priority_selection_contract_replay_v61r_*`
  - `perfect_proto_live_line_failure_veto_overlay_report_v60b*`
  - `perfect_proto_stepb_afree_*`
  - broad `other_old_runs` second-pass bucket

## Snapshot
- server root disk after emergency cleanup:
  - `/dev/vda2`: `296G` total, `240G` used, `44G` available
- current footprint:
  - `artifacts/runs`: `169G`
  - `artifacts/curated`: `533M`
  - `artifacts/checks`: `228K`
  - `/tmp`: `456K`

## Already Removed
- `artifacts/checks/*`
- `/tmp/*` except protected systemd-private dirs
- `artifacts/runs/perfect_proto_*train_index*`
- `artifacts/runs/*oom_backup*`

## Keep
- current TP12 / scientific / lookback-ladder runs
- keep pattern:
  - `artifacts/runs/tp12_*`
  - `artifacts/runs/*scientific*`
- reason:
  - directly tied to the active `tp12_side_daily` baseline, scientific comparison, execution-learning baseline, and current no-stop lookback ladder screen

## Delete First
- criteria:
  - old `2026-03` probe families
  - current TP12/scientific flow does not depend on them
  - key outcomes are already preserved in `meta/experiment_registry.jsonl` / `meta/experiment_patch_memory.json`

### 1. Widened Legacy Plus-Lite Family
- estimated reclaim: `21106 MB`
- delete pattern:
  - `artifacts/runs/perfect_proto_stepb_plus_lite_widened_legacy_*`
- examples:
  - `perfect_proto_stepb_plus_lite_widened_legacy_8d_probe200k_v1_20260322_same_day_plus_recent_upto_8d`
  - `perfect_proto_stepb_plus_lite_widened_legacy_matrix_probe200k_v3_20260322_same_day_plus_recent_upto_7d`
  - `perfect_proto_stepb_plus_lite_widened_legacy_matrix_probe200k_v3_20260322_same_day_plus_recent_upto_6d`
  - `perfect_proto_stepb_plus_lite_widened_legacy_matrix_probe200k_v3_20260322_same_day_plus_recent_upto_5d`
  - `perfect_proto_stepb_plus_lite_widened_legacy_matrix_probe200k_v3_20260322_same_day_plus_recent_upto_4d`
- rationale:
  - old widened `same_day_plus_recent_upto_*d` screen family
  - predates the current TP12 no-stop rolling ladder
  - current branch explicitly moved away from rerunning broad legacy exact surfaces unchanged

### 2. Recent-Impulse Matrix Probe200k Family
- estimated reclaim: `5446 MB`
- delete pattern:
  - `artifacts/runs/perfect_proto_stepb_recent_impulse_matrix_probe200k_v1c_20260322_recent_impulse_upto_*`
- examples:
  - `...recent_impulse_upto_7d`
  - `...recent_impulse_upto_6d`
  - `...recent_impulse_upto_5d`
  - `...recent_impulse_upto_4d`
  - `...recent_impulse_upto_3d`
- rationale:
  - this was an early `1d..7d` screen
  - the key summary is already in registry entry `2026-03-22`
  - the current lookback ladder supersedes this family

### 3. Close28 Future0318 Eval Family
- estimated reclaim: `5821 MB`
- delete pattern:
  - `artifacts/runs/perfect_proto_stepb_plus_lite_widened_close28_hitge4_future0318_eval_v1_*`
- examples:
  - `...same_day_plus_recent_upto_8d`
  - `...same_day_plus_recent_upto_7d`
  - `...same_day_plus_recent_upto_1d`
- rationale:
  - old `close28` / `8%` eval axis
  - not the active `TP12 no-stop` objective
  - key result is already summarized in registry entry `2026-03-24`

### 4. MID/LOW Continuation Exact v2 Family
- estimated reclaim: `5700 MB`
- delete pattern:
  - `artifacts/runs/perfect_proto_stepb_1d_mid_low_continuation_exact_family_v2_*`
- rationale:
  - registry verdict is `invalid_or_inconclusive`
  - low rules did not survive and the family is not the active branch
  - the final summary is already preserved in registry entry `2026-03-24`

### 5. Daily Canonical Winner Slate v53 Family
- estimated reclaim: `7932 MB`
- delete pattern:
  - `artifacts/runs/perfect_proto_daily_canonical_winner_slate_contrastive_top1_v53_*`
- rationale:
  - registry verdict is `invalid_or_inconclusive`
  - handoff says `do not retune v53 ranking/query logic on this substrate`
  - these are failed probe artifacts, not active baseline material

### 6. Recent-Impulse 3d Plus-Lite Family
- estimated reclaim: `16795 MB`
- delete pattern:
  - `artifacts/runs/perfect_proto_stepb_plus_lite_recent_impulse_3d_*`
- examples:
  - `perfect_proto_stepb_plus_lite_recent_impulse_3d_open_train_eval_from_20m_discovery_v1_20260320`
  - `...budget10k_200k_probe_v7_20260320_train`
  - `...budget10k_200k_probe_v7_20260320_oos`
- rationale:
  - broad historical diagnostic family
  - registry already records the key conclusion: broad coverage, no zero-negative survivors
  - not part of the current TP12 side-daily baseline or rolling no-stop ladder

## Review Before Delete
- criteria:
  - old and large, but still referenced as live/ops diagnostics or reusable examples
  - should not be deleted until we explicitly decide those references are no longer needed

### 1. Live Priority Selection Contract Replay v61r
- estimated reclaim: `14638 MB`
- pattern:
  - `artifacts/runs/live_priority_selection_contract_replay_v61r_*`
- reason to review first:
  - registry marks `full_live` as completed
  - this family captured live contract replay verdicts for `1d/7d/8d`
  - likely historical reference for live-line policy work

### 2. Live Failure / Veto Overlay v60b
- estimated reclaim: `4141 MB`
- pattern:
  - `artifacts/runs/perfect_proto_live_line_failure_veto_overlay_report_v60b*`
- reason to review first:
  - handoff still references this as the root-cause/fix diagnostic for overlay replay
  - useful if we revisit live overlay architecture

### 3. A-Free Family
- estimated reclaim: `4309 MB`
- pattern:
  - `artifacts/runs/perfect_proto_stepb_afree_*`
- reason to review first:
  - handoff/docs still reference the reusable A-free OOS pack and 68,226-rule discovery lineage
  - not current TP12 work, but still has archival value

## Needs Second Pass
- these are old and large, but not yet classified tightly enough for immediate delete:
  - `artifacts/runs/perfect_proto_stepb_dplus1_*`
  - `artifacts/runs/de455_*`
  - `artifacts/runs/cd_auto_*`
  - `artifacts/runs/c*_canary_*`
  - `artifacts/runs/ab_seed_*`
  - `artifacts/runs/tf2_*`
  - `artifacts/runs/c25_*`
- reason:
  - they are clearly old, but current metadata does not yet separate:
    - one-off debugging remnants
    - baseline repro snapshots
    - historically important reference runs

## Recommended Delete Order
1. `perfect_proto_stepb_plus_lite_widened_legacy_*`
2. `perfect_proto_stepb_plus_lite_recent_impulse_3d_*`
3. `perfect_proto_daily_canonical_winner_slate_contrastive_top1_v53_*`
4. `perfect_proto_stepb_plus_lite_widened_close28_hitge4_future0318_eval_v1_*`
5. `perfect_proto_stepb_1d_mid_low_continuation_exact_family_v2_*`
6. `perfect_proto_stepb_recent_impulse_matrix_probe200k_v1c_20260322_recent_impulse_upto_*`

## Rough Reclaim
- delete-first subtotal:
  - `21106 + 16795 + 7932 + 5821 + 5700 + 5446 = 62800 MB`
  - about `61.3G`
- review-first subtotal:
  - `14638 + 4141 + 4309 = 23088 MB`
  - about `22.5G`

## Commands (Not Yet Executed)
```bash
# delete-first only
ssh spicy-moltbook '
  cd /home/moltook/apps/stockdesk-lab-lite &&
  rm -rf \
    artifacts/runs/perfect_proto_stepb_plus_lite_widened_legacy_* \
    artifacts/runs/perfect_proto_stepb_plus_lite_recent_impulse_3d_* \
    artifacts/runs/perfect_proto_daily_canonical_winner_slate_contrastive_top1_v53_* \
    artifacts/runs/perfect_proto_stepb_plus_lite_widened_close28_hitge4_future0318_eval_v1_* \
    artifacts/runs/perfect_proto_stepb_1d_mid_low_continuation_exact_family_v2_* \
    artifacts/runs/perfect_proto_stepb_recent_impulse_matrix_probe200k_v1c_20260322_recent_impulse_upto_*
'
```

## Notes
- this file is a cleanup classification only
- no additional run deletions from `artifacts/runs` were executed in this step
- if we delete any `review-before-delete` family later, capture that decision in handoff first
