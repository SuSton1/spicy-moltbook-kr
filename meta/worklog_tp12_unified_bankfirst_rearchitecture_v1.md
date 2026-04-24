# tp12_unified_bankfirst_rearchitecture_v1

## Status
- `updatedAt`: `2026-04-17`
- `umbrellaPatchKey`: `tp12_unified_bankfirst_rearchitecture_v1`
- `workspace`: `/home/saida/code/stockdesk-lab-lite`
- `branchRuleTarget`: `feat/tp12-unified-bankfirst-rearchitecture-v1`
- `branchStatus`: `not_verifiable_in_this_workspace`
- note:
  - this workspace is not attached to a local `.git` directory, so branch-name enforcement could not be verified here
  - branch naming remains a process requirement, but not a runtime blocker for code-path delivery in this checkout

## Hard Rules
- do not reopen `MA_RETEST__LOW_GAP_TOP__lb5 -> repaired T4 -> exact year-consensus`
- do not widen `LOW` to `MID/TOP` inside the new scope-expansion wrapper
- do not auto-switch from exact year-consensus to `clause-core` or `structural-atom`
- keep historical `v1` runners/artifacts intact; use explicit sibling paths only

## WP Review

### WP0
- `status`: `completed_with_backfill`
- completed:
  - reread `meta/active_research_handoff.md`, `meta/experiment_patch_memory.json`, `meta/experiment_registry.jsonl`
  - duplicate checks passed for all six experiment patch keys plus umbrella key
  - authoritative server artifacts confirmed for seed dry-run, repaired T4 summary, rerun T5 summary, and fixed-support baseline contract path
  - `pwd` confirmed
- deviation:
  - `git status` could not be used because this workspace is not a git repo
  - this worklog file itself was missing during the first execution pass and is now backfilled here

### WP1
- `status`: `completed`
- completed:
  - explicit artifact kinds added:
    - `technique_cluster_bank_shortlist_v1`
    - `technique_cluster_bank_discovery_plan_v1`
    - `technique_cluster_template_screen_plan_v1`
    - `technique_clause_core_consensus_summary_v1`
    - `technique_structural_atom_consensus_summary_v1`
    - `tp12_execution_learning_fixed_support_summary_v1`
  - historical runners preserved without hidden compatibility rewrites

### WP2
- `status`: `completed_and_server_validated`
- completed:
  - added `src/lib/technique_clause_groups.mjs`
  - added `src/lib/technique_cluster_bank_shortlist.mjs`
  - added `tools/build_technique_cluster_bank_shortlist.mjs`
  - cluster identity excludes `invalidateClauseIds`
  - reserve-bank extraction added
- real-artifact validation:
  - source run: `tp12_technique_seed_dryrun_v1_20260412_r3`
  - result:
    - `selectedClusterLaneCount=3`
    - `reserveBankCount=2`
    - reserve banks surfaced:
      - `LIQUIDITY_SPONSOR__LOW_GAP_TOP__lb5`
      - `BREAKOUT_BASE__LOW_GAP_TOP__lb5`
- review:
  - this satisfies the minimum `3 lanes + 1 reserve` gate and removes the previous single-bank collapse

### WP3
- `status`: `completed_and_server_validated`
- completed:
  - added `src/lib/technique_cluster_bank_discovery_plan.mjs`
  - added `src/lib/technique_cluster_bank_discovery_contract.mjs`
  - added `tools/build_technique_cluster_bank_discovery_plan.mjs`
  - added `tools/build_technique_cluster_bank_discovery_candidate_contract.mjs`
  - added cluster-bank rolling wrappers
- real-artifact validation:
  - plan artifact created from the real shortlist artifact
  - result:
    - `selectedClusterLaneCount=3`
    - `selectedReserveBankCount=2`
    - `selectedBankCount=5`
- review:
  - unrelated template clause union remains absent in the new path

### WP4
- `status`: `code_complete_runtime_not_opened_yet`
- completed:
  - added `src/lib/technique_cluster_template_screen_contract.mjs`
  - added `tools/build_technique_cluster_template_screen_plan.mjs`
  - added `tools/build_technique_cluster_template_screen_candidate_contract.mjs`
  - added cluster-template rolling wrappers
- verified:
  - synthetic smoke passed
- pending:
  - real T3 summary -> T4 cluster-template run not opened yet

### WP5
- `status`: `completed`
- completed:
  - lane metadata preserved in template-screen summary
  - `screenRejectReasonCodes` added
  - `concentrationReject` added without changing gates
  - lane-level aggregation added
- review:
  - this is diagnostic-only and does not weaken existing pass/fail thresholds

### WP6
- `status`: `completed_and_real_artifact_checked`
- completed:
  - added `src/lib/technique_clause_core_consensus.mjs`
  - added summary/rerun-plan builders
- real-artifact validation:
  - repaired T4 summary produced `cohortCount=1`, `rerunHypothesisCount=0`
- review:
  - negative outcome is acceptable here because the path is explicit diagnostic/rerun generation only

### WP7
- `status`: `completed_and_real_artifact_checked`
- completed:
  - added `src/lib/technique_structural_atom_consensus.mjs`
  - added structural-atom projection and summary builders
- real-artifact validation:
  - rerun T5 summary produced `projectionRowCount=20420`, `motifCount=20336`, `passMotifCount=0`
- review:
  - identity-object path is alive and deterministic on real artifacts
  - no evidence of hidden promotion/fallback behavior

### WP8
- `status`: `wrapper_complete_run_partial_then_relaunch_needed`
- completed:
  - added `tools/run_tp12_scope_expansion_stage.sh`
  - added `tools/server_run_tp12_scope_expansion_stage.sh`
  - wrapper is fail-fast LOW-only
- run status:
  - first server launch with run id `tp12_no_stop_scope_expansion_low_lb5_screen_v1` produced real `w1_source` and `w1_scope` child runs
  - `w1_scope` completed with:
    - `exploredStates=200000`
    - `rulesCollected=235`
    - `topExactDateMassShare≈0.0785`
  - parent rolling outdir remained partial after a turn abort, so a clean relaunch under a fresh run id is required
  - clean detached relaunch now active:
    - run id: `tp12_no_stop_scope_expansion_low_lb5_screen_v1_r2`
    - stage wrapper pid: `1115639`
    - rolling wrapper pid at launch check: `1115769`
    - log: `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/tp12_no_stop_scope_expansion_low_lb5_screen_v1_r2.launch.log`
  - latest observed relaunch state:
    - `w1_scope` completed with `exploredStates=200000`, `rulesCollected=235`, `topExactDateMassShare≈0.0785`
    - `w2_scope` is live with `exploredStates=55296`, `rulesCollected=258`, `etaSeconds≈348.8`, `topExactDateMassShare≈0.1140`
  - completed interim screen readout from per-window open-eval artifacts:
    - `w1`
      - top leaderboard rule `PP_d56fc038171a`
      - top open OOS `2/2 = 100%`
      - `top1DateShare≈0.0408`
      - `uniqueMatchedDates=43`
      - `openOosMatchedRules=178`
      - `zeroNegativeRuleCount=35`
      - `hit2ZeroNegativeRuleCount=5`
    - `w2`
      - top leaderboard rule `PP_398a21ba2dd0`
      - top open OOS `3/3 = 100%`
      - `top1DateShare≈0.0755`
      - `uniqueMatchedDates=80`
      - `openOosMatchedRules=479`
      - `zeroNegativeRuleCount=48`
      - `hit2ZeroNegativeRuleCount=13`
      - `hit3ZeroNegativeRuleCount=1`
  - latest live follow-up:
    - `w2_scope` completed with `exploredStates=200000`, `rulesCollected=636`
    - `w3_scope` is now live with `exploredStates=56320`, `rulesCollected=224`, `etaSeconds≈350.7`

### WP9
- `status`: `blocked_on_missing_authoritative_inputs`
- completed:
  - added fixed-support contract
  - added fixed-support wrapper and server wrapper
  - added fixed-support report builder
- verified:
  - smoke and verify passed
- blocker:
  - authoritative frozen scientific-control root referenced in handoff is not present in the current server workspace
  - only smoke paths are currently discoverable for:
    - `selection_manifest.json`
    - `pipeline_summary.json`
    - `execution_learning_summary.json`
- pending:
  - recover or re-identify the authoritative `daily_only_no_stop` frozen scientific-control root before opening the real fixed-support branch

### WP10
- `status`: `completed`
- completed:
  - verify syntax hooks added
  - new smoke tests added for cluster shortlist/discovery/template plan, clause-core, structural-atom, scope wrapper, fixed-support report
  - local verify passed
  - server verify passed

### WP11
- `status`: `partially_executed`
- completed:
  - cluster shortlist artifact generated on server from real seed output
  - cluster bank discovery plan generated on server from that shortlist
  - clean LOW scope-expansion rerun `tp12_no_stop_scope_expansion_low_lb5_screen_v1_r2` completed
  - scope-expansion result registered under patch key `tp12_no_stop_scope_expansion_low_lb5_screen_v1`
  - explicit clause-core and structural-atom real-artifact checks executed
- pending:
  - cluster-bank T3 rolling result
  - cluster-template T4 rolling
  - explicit consensus trio on new cluster-driven T4 output
  - fixed-support execution-learning run

## Live Queue
- active cluster-bank T3:
  - run id: `tp12_technique_cluster_bank_lanes_v1_r1`
  - queue shell pid remains: `1117299`
  - active launcher pid: `1143803`
  - first child rolling pid: `1143852`
  - first child source pack has completed for lane `MA_RETEST__LOW_GAP_TOP__lb5::cluster::ma_retest_low_gap_top_lb5_fcf0cbba2b`
  - first child `w1_scope` is live with latest snapshot:
    - `phase=search`
    - `exploredStates=18432`
    - `rulesCollected=126`
    - `etaSeconds≈504.1`
    - `topExactDateMassShare≈0.1211`
  - queue log: `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/tp12_technique_cluster_bank_lanes_v1_r1.queue.log`
  - launch log: `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/tp12_technique_cluster_bank_lanes_v1_r1.launch.log`

- queued after the cluster-bank queue exits:
  - run id: `tp12_technique_cluster_template_screen_v1_r1`
  - queue shell pid: `1120367`
  - queue log: `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/tp12_technique_cluster_template_screen_v1_r1.queue.log`
  - downstream outputs expected from the same explicit queue:
    - cluster template plan:
      - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/tp12_technique_cluster_bank_lanes_v1_r1/cluster_template_plan.json`
    - T4 rolling log:
      - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/tp12_technique_cluster_template_screen_v1_r1.launch.log`
    - exact year-consensus log:
      - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/tp12_technique_cluster_template_year_consensus_v1_r1.launch.log`
    - clause-core outputs:
      - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/tp12_technique_clause_core_consensus_v1_r2_cluster/clause_core_summary.json`
      - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/tp12_technique_clause_core_consensus_v1_r2_cluster/rerun_plan.json`
    - structural-atom outputs:
      - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/tp12_technique_structural_atom_consensus_v1_r2_cluster/projection.jsonl`
      - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/tp12_technique_structural_atom_consensus_v1_r2_cluster/summary.json`

- detached watcher:
  - log: `/home/saida/code/stockdesk-lab-lite/artifacts/runs/tp12_unified_bankfirst_rearchitecture_v1.watch.log`
  - purpose:
    - keep polling live T3/T4/exact-clause-structural outputs after the interactive trace stops
  - note:
    - detached watcher launch was attempted, but the background shell did not remain alive
    - use the log as a recent heartbeat trail only; relaunch or use an interactive watcher for live polling
  - latest observed state:
    - first T3 child remains `MA_RETEST__LOW_GAP_TOP__lb5::cluster::ma_retest_low_gap_top_lb5_fcf0cbba2b`
    - completed windows:
      - `w1 rules=724 topExactDateMassShare≈0.0568`
      - `w2 rules=1147 topExactDateMassShare≈0.0863`
      - `w3 rules=635 topExactDateMassShare≈0.0831`
      - `w4 rules=491 topExactDateMassShare≈0.0884`
      - `w5 rules=705 topExactDateMassShare≈0.0896`
    - current active window:
      - `w6_scope`
      - latest snapshot `exploredStates=87040`, `rulesCollected=552`, `etaSeconds≈250.5`, `topExactDateMassShare≈0.2509`

### WP12
- `status`: `gates_defined_not_fully_adjudicated`
- note:
  - cluster shortlist gate is already satisfied
  - scope-expansion gate adjudicated negative:
    - screen primary: `96/354 = 27.12%`
    - screen secondary: `115/354 = 32.49%`
    - `maxTop1DateShare = 20.83%`
    - incumbent sparse lb5 screen baseline remains stronger on primary and concentration

### WP13
- `status`: `kill_rules_defined_not_triggered_for_new_runs_yet`

### WP14
- `status`: `in_progress`
- completed:
  - active handoff updated with `closed-negative old exact line`, `new explicit paths`, `no automatic fallback`
  - registered `tp12_no_stop_scope_expansion_low_lb5_screen_v1` as `invalid_or_inconclusive`
- pending:
  - register live cluster-bank T3/T4/explicit-consensus experiments only after full completion or explicit kill

## Current Priorities
1. finish live cluster-bank T3 rolling from the already-built real discovery plan
2. only after T3 summary exists, let the queued cluster-template T4 rolling open automatically
3. after T4 summary exists, let the explicit exact/clause-core/structural-atom trio run side by side
4. register each live experiment in the same turn it completes
5. open fixed-support execution-learning only after the authoritative frozen scientific-control root is recovered

## 2026-04-17 12:35 KST
- corrected rerun chain launched after the generic technique row-filter root-cause fix was verified locally and on server
- preflight re-run before launch:
  - `bash tools/bootstrap_target_first_session.sh --scope=target_first_v2`
  - `bash tools/check_duplicate_experiment.sh --patch-key=tp12_technique_cluster_bank_lanes_v1`
  - `bash tools/check_duplicate_experiment.sh --patch-key=tp12_technique_clause_core_consensus_v1`
  - `bash tools/check_duplicate_experiment.sh --patch-key=tp12_technique_structural_atom_consensus_v1`
- live authoritative queue is now:
  - queue run id: `tp12_technique_cluster_bank_lanes_v1_r2`
  - detached queue shell pid: `1577357`
  - queue log:
    - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/tp12_technique_cluster_bank_lanes_v1_r2.queue.log`
  - sequential commands inside the same queue:
    - server bootstrap
    - corrected T3:
      - `bash tools/run_technique_cluster_bank_discovery_rolling.sh --run-id=tp12_technique_cluster_bank_lanes_v1_r2 --plan-path=artifacts/runs/tp12_technique_cluster_bank_lanes_v1_seed_r3/cluster_bank_discovery_plan.json --window-group=screen`
    - corrected T4:
      - `bash tools/run_technique_cluster_template_rolling.sh --run-id=tp12_technique_cluster_template_screen_v1_r2 --plan-path=artifacts/runs/tp12_technique_cluster_bank_lanes_v1_r2/cluster_template_plan.json --window-group=screen`
    - corrected explicit exact year-consensus:
      - `bash tools/run_technique_year_consensus.sh --run-id=tp12_technique_cluster_template_year_consensus_v1_r2 --template-screen-summary-path=artifacts/runs/tp12_technique_cluster_template_screen_v1_r2/step-perfect-prototype-technique-cluster-template-screen/summary.json`
    - clause-core summary + rerun plan
    - structural-atom projection + consensus summary
- live server process snapshot immediately after launch:
  - T3 launcher pid: `1577362`
  - first corrected child rolling pid:
    - `1577395`
  - first corrected child source-pack/control-input chain was already live:
    - `1577417`
    - `1577445`
    - `1577688`
- first corrected child lane:
  - `MA_RETEST__LOW_GAP_TOP__lb5::cluster::ma_retest_low_gap_top_lb5_fcf0cbba2b`
  - child run id:
    - `tp12_technique_cluster_bank_lanes_v1_r2_ma_retest_low_gap_top_lb5_cluster_ma_retest_low_gap_top_lb5_fcf0cbba2b`
- important invalidation note:
  - `tp12_technique_cluster_bank_lanes_v1_r1` and its downstream queued `r1` chain are not authoritative and must not be registered
  - reason:
    - before the root-cause fix, cluster-bank and cluster-template contracts were metadata-only and the rolling runner ignored them, so T3/T4 used unfiltered scope packs
  - resume rule:
    - use only `r2` outputs for adjudication unless `r2` itself fails and is explicitly replaced by a later clean rerun
- corrected live status after launch:
  - first corrected child `w1_scope` completed
  - live train miner end-state from `step-perfect-prototype-train/progress.json`:
    - `phase=completed`
    - `exploredStates=200000`
    - `rulesCollected=811`
    - `topExactDateMassShare≈0.0807`
  - this confirms the row-filter root-cause fix is actually active:
    - corrected `w1_scope` train row count was `73`
    - corrected `w1_scope` filtered OOS input row count was `40`
    - this is no longer the bogus repeated full-pack pattern seen in `r1`
  - first corrected child `w1_scope` filtered OOS apply-close28 summary:
    - `sourceRows=40`
    - `dedupedMatchedRows=40`
    - `dedupedMatchedPositiveRows=18`
    - `lineLevelHitCount=18`
    - `lineLevelHitRate=0.45`
    - `uniqueMatchedDates=38`
    - `uniqueMatchedSymbols=39`
  - parent T3 summary is still pending at this write

## 2026-04-17 21:50 KST
- server root-cause blocker hit during corrected `r2` continuation:
  - `tp12_technique_cluster_bank_lanes_v1_r2` hit `ENOSPC: no space left on device` while writing `w2_source` OOS step-a output
  - server root filesystem state at failure:
    - `/dev/vda2 296G used=284G avail=0 use%=100%`
  - no scientific fallback was introduced
  - action taken:
    - free space by deleting only invalid or already-closed bulky child artifacts
- explicit cleanup performed on server:
  - deleted invalid pre-fix cluster-bank chain:
    - `tp12_technique_cluster_bank_lanes_v1_r1*`
    - freed about `33G`
  - deleted invalid pre-fix cluster-template chain:
    - `tp12_technique_cluster_template_screen_v1_r1*`
    - freed about `7.3G`
  - deleted already-registered closed-negative scope-expansion child window artifacts only:
    - `tp12_no_stop_scope_expansion_low_lb5_screen_v1_r2_w*`
    - `tp12_no_stop_scope_expansion_low_lb5_screen_v1_w*`
    - freed about `8.3G`
  - post-cleanup server filesystem state:
    - `/dev/vda2 296G used=236G avail=48G use%=84%`
- continuity decision:
  - `r2` is now an infra-interrupted partial run and is not authoritative for final adjudication
  - do not register `r2`
  - use a clean rerun `r3` as the live authoritative chain
- clean rerun relaunched:
  - queue run id:
    - `tp12_technique_cluster_bank_lanes_v1_r3`
  - detached queue shell pid:
    - `1589995`
  - queue log:
    - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/tp12_technique_cluster_bank_lanes_v1_r3.queue.log`
  - sequential downstream run ids inside the same queue:
    - `tp12_technique_cluster_template_screen_v1_r3`
    - `tp12_technique_cluster_template_year_consensus_v1_r3`
    - `tp12_technique_clause_core_consensus_v1_r3_cluster`
    - `tp12_technique_structural_atom_consensus_v1_r3_cluster`
- live `r3` process snapshot after relaunch:
  - T3 launcher pid:
    - `1590000`
  - first child rolling pid:
    - `1590033`
  - first child source-pack pid:
    - `1590055`
  - first child lane:
    - `MA_RETEST__LOW_GAP_TOP__lb5::cluster::ma_retest_low_gap_top_lb5_fcf0cbba2b`
  - current live state at write:
    - `w1_source` completed
    - `w1_scope` has started
    - active scope window pid:
      - `1591523`
    - active miner pid:
      - `1591742`
- live `r3` status update:
  - first lane `w1_scope` completed with the same corrected filtered profile shape as `r2`
    - `topExactDateMassShare≈0.080704`
    - filtered OOS apply-close28:
      - `sourceRows=40`
      - `dedupedMatchedRows=40`
      - `dedupedMatchedPositiveRows=18`
      - `lineLevelHitRate=0.45`
  - first lane `w2_scope` also completed
    - miner completion:
      - `exploredStates=200000`
      - `rulesCollected=2569`
      - `topExactDateMassShare≈0.083547`
    - filtered OOS apply-close28:
      - `sourceRows=111`
      - `dedupedMatchedRows=106`
      - `dedupedMatchedPositiveRows=47`
      - `lineLevelHitCount=47`
      - `lineLevelHitRate≈0.4434`
      - `uniqueMatchedDates=81`
      - `uniqueMatchedSymbols=95`
  - next active state at this write:
    - `w3_source` has started
    - active source-pack pid:
      - `1601537`
    - active control-input pid:
      - `1601565`
  - parent T3 summary remains pending

## 2026-04-17 22:55 KST
- first `r3` lane completion status:
  - lane:
    - `MA_RETEST__LOW_GAP_TOP__lb5::cluster::ma_retest_low_gap_top_lb5_fcf0cbba2b`
  - `w3_scope` filtered OOS apply-close28:
    - `sourceRows=100`
    - `dedupedMatchedRows=60`
    - `dedupedMatchedPositiveRows=24`
    - `lineLevelHitRate=0.40`
  - `w4_scope` filtered OOS apply-close28:
    - `sourceRows=66`
    - `dedupedMatchedRows=27`
    - `dedupedMatchedPositiveRows=7`
    - `lineLevelHitRate≈0.2593`
  - `w5_scope` filtered OOS apply-close28:
    - `sourceRows=100`
    - `dedupedMatchedRows=37`
    - `dedupedMatchedPositiveRows=10`
    - `lineLevelHitRate≈0.2703`
  - `w6_scope` completed:
    - miner completion:
      - `exploredStates=200000`
      - `rulesCollected=530`
      - `topExactDateMassShare≈0.087303`
    - filtered OOS apply-close28:
      - `sourceRows=45`
      - `dedupedMatchedRows=17`
      - `dedupedMatchedPositiveRows=4`
      - `lineLevelHitRate≈0.2353`
  - first lane qualitative read:
    - early windows `w1/w2` were strong
    - back-half `w4/w5/w6` weakened materially
    - do not infer parent T3 result yet; await full parent summary across all lanes
- queue continuity:
  - first lane finished and queue advanced automatically to second lane
  - second lane:
    - `MA_RETEST__LOW_GAP_TOP__lb5::cluster::ma_retest_low_gap_top_lb5_573b675e61`
  - second lane live state at write:
    - `w1_scope` active
    - active scope pid:
      - `1626018`
    - active miner pid:
      - `1626237`
    - early progress:
      - `rowsScanned=76`
      - `exploredStates=8192`
      - `rulesCollected=251`
      - `topExactDateMassShare≈0.1005`
      - `etaSeconds≈386.8`
