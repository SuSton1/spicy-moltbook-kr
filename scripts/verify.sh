#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() {
  echo "==> $*"
}

warn() {
  echo "[warn] $*"
}

log "verify: required files"
required=(
  "package.json"
  "config/lab.config.server.lite.json"
  "src/cli.mjs"
  "src/pipeline/step_a_event_extract.mjs"
  "src/pipeline/step_b_template_build.mjs"
  "src/pipeline/step_c_pattern_mine.mjs"
  "src/pipeline/step_d_online_loop.mjs"
  "src/pipeline/step_e_lockbox_backtest.mjs"
)
for f in "${required[@]}"; do
  [[ -f "$f" ]] || { echo "missing: $f"; exit 1; }
done

optional=(
  "AGENTS.md"
  "SPEC.md"
  "tools/check_policy_contracts.sh"
)
for f in "${optional[@]}"; do
  [[ -e "$f" ]] || warn "optional missing: $f"
done

log "verify: config json parse"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  config/lab.config.server.lite.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  config/lab.config.server.lite.prejump.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  config/lab.config.server.lite.stepb_dplus1_baseline.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  config/lab.config.server.lite.stepb_dplus1_plus_lite.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  config/lab.config.server.lite.stepb_dplus1_plus_lite_lane_local.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  config/lab.config.server.lite.stepb_dplus1_plus_lite_recent_mid_low.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  config/ops/live_priority_registry.server.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/afree_reusable_artifacts.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/live_priority_reusable_artifacts.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  config/lab.config.server.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  config/lab.config.example.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  config/lab.config.server.lite.stepb_dplus1_plus_lite_target12_surface_v1.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  config/lab.config.server.lite.stepb_dplus1_plus_lite_target12_no_stop.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_no_stop_rolling_research_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_no_stop_lookback_ladder_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_no_stop_scope_expansion_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_no_stop_fixed_year2hit_research_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_year2hit_train_2016_2024_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_train100_year2hit_discovery_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_train100_context_atom_discovery_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_train100_counterexample_exact_completion_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_train100_counterexample_frontier_drain_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_train100_counterexample_frontier_partition_drain_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_train100_closeout_zero_survivor_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  contracts/tp12_train100_neutral_anchor_veto_certificate_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  contracts/tp12_train100_positive_motif_contrastive_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  contracts/tp12_train100_sequence_shapelet_contrastive_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_h80_wilson_contrastive_abstention_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_h80_path_quality_label_audit_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_h80_same_day_pairwise_overcrowding_ranker_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_h80_same_day_listwise_context_abstention_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_h80_learned_same_day_ranker_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_year2hit_precision_first_daily_only_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_year2hit_zero_fp_micro_split_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_year2hit_executable_nested_micro_split_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_year2hit_executable_global_zero_fp_cover_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_year2hit_executable_global_zero_fp_greedy_cover_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_year2hit_executable_global_greedy_stability_audit_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_year2hit_executable_global_greedy_stability_gated_cover_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_year2hit_operational_hit_gate_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_locked_future_eval_protocol_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_year2hit_executable_pattern_bundle_bank_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_year2hit_monthly_coverage_bundle_optimizer_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_selector_feature_source_repair_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_monthly_quota_precision_scheduler_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_monthly_quota_replay_integration_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_year2hit_executable_zero_fp_tile_pool_audit_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_h80_conjunctive_veto_rule_grid_rules.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_execution_learning_fixed_support_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/tp12_year2x8_bank_discovery_research_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/technique_grammar_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/technique_grammar_fixed_2016_2024_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/technique_seed_templates.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/technique_pattern_discovery_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/technique_episode_substrate_contract.json
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
  meta/technique_episode_slice_contract.json

log "verify: config load"
node --input-type=module - <<'NODE'
import assert from "node:assert/strict"
import { loadConfig } from "./src/lib/config.mjs"

const { config } = await loadConfig({
  cwd: process.cwd(),
  configPath: "config/lab.config.server.lite.stepb_dplus1_baseline.json",
})
const { config: laneLocalConfig } = await loadConfig({
  cwd: process.cwd(),
  configPath: "config/lab.config.server.lite.stepb_dplus1_plus_lite_lane_local.json",
})
const { config: recentMidLowConfig } = await loadConfig({
  cwd: process.cwd(),
  configPath: "config/lab.config.server.lite.stepb_dplus1_plus_lite_recent_mid_low.json",
})
const { config: tp12SurfaceConfig } = await loadConfig({
  cwd: process.cwd(),
  configPath: "config/lab.config.server.lite.stepb_dplus1_plus_lite_target12_surface_v1.json",
})
const { config: tp12NoStopConfig } = await loadConfig({
  cwd: process.cwd(),
  configPath: "config/lab.config.server.lite.stepb_dplus1_plus_lite_target12_no_stop.json",
})
assert.equal(
  String(config?.lightweight?.stepB?.perfectPrototypeBaseline?.lineId ?? ""),
  "stepb_dplus1_baseline",
)
assert.equal(String(config?.backtest?.entry ?? ""), "NEXT_DAY_OPEN")
assert.equal(Number(config?.backtest?.holdDays ?? 0), 3)
assert.equal(
  String(laneLocalConfig?.lightweight?.stepB?.perfectPrototypeBaseline?.lineId ?? ""),
  "stepb_dplus1_plus_lite_lane_local",
)
assert.equal(
  String(laneLocalConfig?.lightweight?.stepB?.perfectPrototypeBaseline?.contextSurface ?? ""),
  "v5_contextual_plus_lite_lane_local_pool8",
)
assert.equal(
  Number(laneLocalConfig?.event?.recentImpulseDiscovery?.lookbackTradingDays ?? 0),
  1,
)
assert.equal(
  String(recentMidLowConfig?.lightweight?.stepB?.perfectPrototypeBaseline?.lineId ?? ""),
  "stepb_dplus1_plus_lite_recent_mid_low",
)
assert.equal(
  String(recentMidLowConfig?.lightweight?.stepB?.perfectPrototypeBaseline?.contextSurface ?? ""),
  "v6_contextual_plus_lite_recent_only_lane_local_pool8",
)
assert.equal(
  Number(recentMidLowConfig?.event?.recentImpulseDiscovery?.lookbackTradingDays ?? 0),
  1,
)
assert.equal(
  String(tp12SurfaceConfig?.lightweight?.stepB?.perfectPrototypeBaseline?.lineId ?? ""),
  "stepb_dplus1_plus_lite_target12_surface_v1",
)
assert.equal(
  String(tp12SurfaceConfig?.lightweight?.stepB?.perfectPrototypeBaseline?.contextSurface ?? ""),
  "v7_contextual_plus_lite_tp12",
)
assert.equal(String(tp12SurfaceConfig?.backtest?.entry ?? ""), "NEXT_DAY_OPEN")
assert.equal(Number(tp12SurfaceConfig?.backtest?.holdDays ?? 0), 3)
assert.equal(Number(tp12SurfaceConfig?.backtest?.targetPct ?? 0), 0.12)
assert.equal(Number(tp12SurfaceConfig?.backtest?.stopLossPct ?? 0), 0.04)
assert.equal(
  Number(tp12SurfaceConfig?.event?.recentImpulseDiscovery?.lookbackTradingDays ?? 0),
  1,
)
assert.equal(
  String(tp12NoStopConfig?.lightweight?.stepB?.perfectPrototypeBaseline?.lineId ?? ""),
  "stepb_dplus1_plus_lite_target12_no_stop",
)
assert.equal(
  String(tp12NoStopConfig?.lightweight?.stepB?.perfectPrototypeBaseline?.contextSurface ?? ""),
  "v3_contextual_plus_lite",
)
assert.equal(String(tp12NoStopConfig?.backtest?.entry ?? ""), "NEXT_DAY_OPEN")
assert.equal(Number(tp12NoStopConfig?.backtest?.holdDays ?? 0), 3)
assert.equal(Number(tp12NoStopConfig?.backtest?.targetPct ?? 0), 0.12)
assert.equal(Number(tp12NoStopConfig?.backtest?.stopLossPct ?? 0), 0)
assert.equal(
  Number(tp12NoStopConfig?.event?.recentImpulseDiscovery?.lookbackTradingDays ?? 0),
  1,
)
NODE

if command -v jq >/dev/null 2>&1; then
  log "verify: step-d lockbox prep contract"
  jq -e '.lightweight.stepD.prepareLockboxDuringStepD == false' \
    config/lab.config.server.lite.json >/dev/null
  jq -e '.template.featureAsOf == "t"' \
    config/lab.config.server.lite.prejump.json >/dev/null
  jq -e '.backtest.entry == "NEXT_DAY_OPEN"' \
    config/lab.config.server.lite.prejump.json >/dev/null
  jq -e '.lightweight.stepD.prepareLockboxDuringStepD == true' \
    config/lab.config.server.json >/dev/null
  jq -e '.lightweight.stepD.prepareLockboxDuringStepD == true' \
    config/lab.config.example.json >/dev/null
else
  warn "skip jq-based lockbox prep contract"
fi

log "verify: node syntax check"
while IFS= read -r file; do
  node --check "$file" >/dev/null
  echo "ok: $file"
done < <(find src -type f -name '*.mjs' | sort)

if [[ -f scripts/verify_native_rowset_kernel.sh ]]; then
  log "verify: native rowset kernel"
  bash scripts/verify_native_rowset_kernel.sh
else
  warn "skip native rowset kernel verify"
fi

log "verify: indexed equivalence smoke"
node tools/smoke_prejump_indexed_equivalence.mjs

log "verify: indexed adversarial smoke"
node tools/smoke_prejump_indexed_acceleration_adversarial.mjs

log "verify: indexed exactness precision-regression smoke"
node tools/smoke_prejump_indexed_exactness_precision_regression.mjs

log "verify: seed selector diversity smoke"
node tools/smoke_prejump_seed_selector_diversity.mjs

log "verify: Step-B legacy miner compaction equivalence smoke"
node tools/smoke_stepb_legacy_miner_compaction_equivalence.mjs

log "verify: Step-B exact indexed equivalence smoke"
node tools/smoke_stepb_exact_indexed_equivalence.mjs

log "verify: perfect prototype day-cap rule stats smoke"
node tools/smoke_perfect_prototype_daycap2_rule_stats.mjs

log "verify: live priority registry smoke"
node tools/smoke_live_priority_registry.mjs

log "verify: live priority stack noop smoke"
node tools/smoke_live_priority_stack_noop.mjs

log "verify: live priority artifacts sync smoke"
node tools/smoke_live_priority_artifacts_sync.mjs

log "verify: live priority close28 runtime contract smoke"
node tools/smoke_live_priority_close28_runtime_contract.mjs

log "verify: live priority selection contract replay smoke"
node tools/smoke_live_priority_selection_contract_report.mjs

log "verify: live priority selection contract report build syntax"
node --check tools/build_live_priority_selection_contract_report.mjs

log "verify: live priority selection contract report wrapper syntax"
bash -n tools/server_run_live_priority_selection_contract_report.sh

log "verify: TP12 execution menu report build syntax"
node --check tools/build_stepb_1d_tp12_execution_menu_report.mjs

log "verify: TP12 execution menu wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_execution_menu_low_gap_top_200k.sh

log "verify: TP12 execution menu smoke"
node tools/smoke_stepb_1d_tp12_execution_menu_report.mjs

log "verify: TP12 no-stop rolling contract smoke"
node tools/smoke_tp12_no_stop_rolling_contract.mjs

log "verify: TP12 no-stop rolling summary smoke"
node tools/smoke_tp12_no_stop_rolling_summary.mjs

log "verify: TP12 no-stop window report build syntax"
node --check tools/build_stepb_1d_tp12_no_stop_window_report.mjs

log "verify: TP12 no-stop rolling summary build syntax"
node --check tools/build_tp12_no_stop_rolling_summary.mjs

log "verify: TP12 no-stop rolling window-contract build syntax"
node --check tools/build_tp12_no_stop_rolling_window_contract.mjs

log "verify: TP12 no-stop source-pack wrapper syntax"
bash -n tools/run_tp12_no_stop_rolling_source_pack.sh

log "verify: TP12 no-stop source-pack server wrapper syntax"
bash -n tools/server_run_tp12_no_stop_rolling_source_pack.sh

log "verify: TP12 no-stop summary wrapper syntax"
bash -n tools/run_tp12_no_stop_rolling_summary.sh

log "verify: TP12 no-stop one-window wrapper syntax"
bash -n tools/run_stepb_1d_tp12_no_stop_low_gap_top_window.sh

log "verify: TP12 no-stop one-window server wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_no_stop_low_gap_top_window.sh

log "verify: TP12 no-stop rolling wrapper syntax"
bash -n tools/run_stepb_1d_tp12_no_stop_low_gap_top_rolling.sh

log "verify: TP12 no-stop rolling server wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_no_stop_low_gap_top_rolling.sh

log "verify: TP12 no-stop window report smoke"
node tools/smoke_stepb_1d_tp12_no_stop_window_report.mjs

log "verify: TP12 no-stop lookback ladder contract smoke"
node tools/smoke_tp12_no_stop_lookback_ladder_contract.mjs

log "verify: TP12 no-stop lookback ladder summary smoke"
node tools/smoke_tp12_no_stop_lookback_ladder_summary.mjs

log "verify: TP12 no-stop lookback ladder candidate-contract build syntax"
node --check tools/build_tp12_no_stop_lookback_ladder_candidate_contract.mjs

log "verify: TP12 no-stop lookback ladder summary build syntax"
node --check tools/build_tp12_no_stop_lookback_ladder_summary.mjs

log "verify: TP12 no-stop lookback ladder summary wrapper syntax"
bash -n tools/run_tp12_no_stop_lookback_ladder_summary.sh

log "verify: TP12 no-stop lookback ladder wrapper syntax"
bash -n tools/run_stepb_tp12_no_stop_lookback_ladder.sh

log "verify: TP12 no-stop lookback ladder server wrapper syntax"
bash -n tools/server_run_stepb_tp12_no_stop_lookback_ladder.sh

log "verify: TP12 no-stop lb5 year2x7 contract smoke"
node tools/smoke_tp12_no_stop_lb5_year2x7_contract.mjs

log "verify: TP12 no-stop strict year2x7 audit smoke"
node tools/smoke_tp12_no_stop_rule_year_coverage_report.mjs

log "verify: TP12 no-stop strict year2x7 summary smoke"
node tools/smoke_tp12_no_stop_lb5_year2x7_summary.mjs

log "verify: TP12 no-stop strict year2x7 audit build syntax"
node --check tools/build_tp12_no_stop_rule_year_coverage_report.mjs

log "verify: TP12 no-stop strict year2x7 summary build syntax"
node --check tools/build_tp12_no_stop_lb5_year2x7_summary.mjs

log "verify: TP12 no-stop strict year2x7 wrapper syntax"
bash -n tools/run_tp12_no_stop_lb5_year2x7_audit_replay.sh

log "verify: TP12 no-stop strict year2x7 server wrapper syntax"
bash -n tools/server_run_tp12_no_stop_lb5_year2x7_audit_replay.sh

log "verify: TP12 no-stop live-like OOS replay contract smoke"
node tools/smoke_tp12_no_stop_lb5_live_like_oos_replay_contract.mjs

log "verify: TP12 no-stop live-like OOS replay summary smoke"
node tools/smoke_tp12_no_stop_lb5_live_like_oos_replay_summary.mjs

log "verify: TP12 no-stop live-like OOS replay summary build syntax"
node --check tools/build_tp12_no_stop_lb5_live_like_oos_replay_summary.mjs

log "verify: TP12 no-stop live-like OOS replay wrapper syntax"
bash -n tools/run_tp12_no_stop_lb5_live_like_oos_replay.sh

log "verify: TP12 no-stop live-like OOS replay server wrapper syntax"
bash -n tools/server_run_tp12_no_stop_lb5_live_like_oos_replay.sh

log "verify: TP12 no-stop scope expansion contract smoke"
node tools/smoke_tp12_no_stop_scope_expansion_contract.mjs

log "verify: TP12 no-gap addon contract smoke"
node tools/smoke_tp12_no_gap_addon_contract.mjs

log "verify: TP12 no-gap addon pack smoke"
node tools/smoke_tp12_no_gap_addon_pack.mjs

log "verify: TP12 no-gap addon candidate-contract build syntax"
node --check tools/build_tp12_no_gap_addon_candidate_contract.mjs

log "verify: TP12 no-gap addon pack build syntax"
node --check tools/build_tp12_no_gap_addon_pack.mjs

log "verify: TP12 no-gap addon rolling wrapper syntax"
bash -n tools/run_stepb_1d_tp12_no_gap_addon_rolling.sh

log "verify: TP12 no-gap addon one-window wrapper syntax"
bash -n tools/run_stepb_1d_tp12_no_gap_addon_window.sh

log "verify: TP12 no-gap addon candidate wrapper syntax"
bash -n tools/run_stepb_tp12_no_gap_addon_rolling.sh

log "verify: TP12 no-gap addon server wrapper syntax"
bash -n tools/server_run_stepb_tp12_no_gap_addon_rolling.sh

log "verify: TP12 no-stop scope filter smoke"
node tools/smoke_tp12_no_stop_scope_filtered_pack.mjs

log "verify: TP12 no-stop scope filter build syntax"
node --check tools/build_tp12_no_stop_scope_filtered_pack.mjs

log "verify: TP12 no-stop scope expansion candidate-contract build syntax"
node --check tools/build_tp12_no_stop_scope_expansion_candidate_contract.mjs

log "verify: TP12 no-stop fixed contract smoke"
node tools/smoke_tp12_no_stop_fixed_contract.mjs

log "verify: TP12 no-stop fixed derived rolling contract syntax"
node --check tools/build_tp12_no_stop_fixed_derived_rolling_contract.mjs

log "verify: TP12 no-stop fixed source-pack wrapper syntax"
bash -n tools/run_tp12_no_stop_fixed_source_pack.sh

log "verify: TP12 no-stop fixed scope wrapper syntax"
bash -n tools/run_stepb_1d_tp12_no_stop_scope_fixed.sh

log "verify: TP12 no-stop scope expansion stage wrapper syntax"
bash -n tools/run_tp12_scope_expansion_stage.sh

log "verify: TP12 no-stop scope expansion stage server wrapper syntax"
bash -n tools/server_run_tp12_scope_expansion_stage.sh

log "verify: TP12 no-stop scope one-window wrapper syntax"
bash -n tools/run_stepb_1d_tp12_no_stop_scope_window.sh

log "verify: TP12 no-stop scope one-window server wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_no_stop_scope_window.sh

log "verify: TP12 no-stop scope rolling wrapper syntax"
bash -n tools/run_stepb_1d_tp12_no_stop_scope_rolling.sh

log "verify: TP12 no-stop scope rolling server wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_no_stop_scope_rolling.sh

log "verify: TP12 no-stop scope-expansion wrapper syntax"
bash -n tools/run_stepb_tp12_no_stop_scope_expansion.sh

log "verify: TP12 no-stop scope-expansion server wrapper syntax"
bash -n tools/server_run_stepb_tp12_no_stop_scope_expansion.sh

log "verify: perfect prototype year-hit guard smoke"
node tools/smoke_perfect_prototype_year_hit_guard.mjs

log "verify: perfect prototype year-hit prune smoke"
node tools/smoke_perfect_prototype_year_hit_prune.mjs

log "verify: TP12 year2x8 bank discovery contract smoke"
node tools/smoke_tp12_year2x8_bank_discovery_contract.mjs

log "verify: TP12 year2x8 bank discovery summary smoke"
node tools/smoke_tp12_year2x8_bank_discovery_summary.mjs

log "verify: TP12 year2x8 final confirm summary smoke"
node tools/smoke_tp12_year2x8_final_confirm_summary.mjs

log "verify: TP12 year2x8 live-like replay summary smoke"
node tools/smoke_tp12_year2x8_live_like_replay_summary.mjs

log "verify: TP12 year2x8 bank discovery candidate-contract build syntax"
node --check tools/build_tp12_year2x8_bank_discovery_candidate_contract.mjs

log "verify: TP12 year2x8 bank discovery summary build syntax"
node --check tools/build_tp12_year2x8_bank_discovery_summary.mjs

log "verify: TP12 year2x8 final confirm summary build syntax"
node --check tools/build_tp12_year2x8_final_confirm_summary.mjs

log "verify: TP12 year2x8 live-like replay summary build syntax"
node --check tools/build_tp12_year2x8_live_like_replay_summary.mjs

log "verify: TP12 year2x8 bank discovery wrapper syntax"
bash -n tools/run_tp12_year2x8_bank_discovery_matrix.sh

log "verify: TP12 year2x8 bank discovery server wrapper syntax"
bash -n tools/server_run_tp12_year2x8_bank_discovery_matrix.sh

log "verify: TP12 year2x8 top-cell final wrapper syntax"
bash -n tools/run_tp12_year2x8_topcell_final_confirm.sh

log "verify: TP12 year2x8 top-cell final server wrapper syntax"
bash -n tools/server_run_tp12_year2x8_topcell_final_confirm.sh

log "verify: TP12 year2x8 live-like replay wrapper syntax"
bash -n tools/run_tp12_year2x8_live_like_replay.sh

log "verify: TP12 year2x8 live-like replay server wrapper syntax"
bash -n tools/server_run_tp12_year2x8_live_like_replay.sh

log "verify: technique template generator smoke"
node tools/smoke_technique_template_generator.mjs

log "verify: technique event row builder smoke"
node tools/smoke_technique_event_rows.mjs

log "verify: technique recurrence scorer smoke"
node tools/smoke_technique_recurrence_scorer.mjs

log "verify: technique bank shortlist smoke"
node tools/smoke_technique_bank_builder.mjs

log "verify: technique cluster-bank shortlist smoke"
node tools/smoke_technique_cluster_bank_shortlist.mjs

log "verify: technique bank discovery plan smoke"
node tools/smoke_technique_bank_discovery_plan.mjs

log "verify: technique cluster-bank discovery plan smoke"
node tools/smoke_technique_cluster_bank_discovery_plan.mjs

log "verify: technique row filter contract smoke"
node tools/smoke_technique_row_filter_contract.mjs

log "verify: technique event row builder syntax"
node --check tools/build_technique_event_rows.mjs

log "verify: technique recurrence report syntax"
node --check tools/build_technique_recurrence_report.mjs

log "verify: technique bank shortlist syntax"
node --check tools/build_technique_bank_shortlist.mjs

log "verify: technique cluster-bank shortlist syntax"
node --check tools/build_technique_cluster_bank_shortlist.mjs

log "verify: technique bank discovery plan syntax"
node --check tools/build_technique_bank_discovery_plan.mjs

log "verify: technique cluster-bank discovery plan syntax"
node --check tools/build_technique_cluster_bank_discovery_plan.mjs

log "verify: technique bank discovery contract smoke"
node tools/smoke_technique_bank_discovery_contract.mjs

log "verify: technique bank discovery candidate-contract syntax"
node --check tools/build_technique_bank_discovery_candidate_contract.mjs

log "verify: technique cluster-bank discovery candidate-contract syntax"
node --check tools/build_technique_cluster_bank_discovery_candidate_contract.mjs

log "verify: technique cluster-bank discovery fixed contract smoke"
node tools/smoke_technique_cluster_bank_discovery_fixed_contract.mjs

log "verify: technique cluster-bank discovery fixed candidate-contract syntax"
node --check tools/build_technique_cluster_bank_discovery_fixed_candidate_contract.mjs

log "verify: technique bank discovery summary syntax"
node --check tools/build_technique_bank_discovery_summary.mjs

log "verify: technique bank discovery rolling wrapper syntax"
bash -n tools/run_technique_bank_discovery_rolling.sh

log "verify: technique bank discovery server wrapper syntax"
bash -n tools/server_run_technique_bank_discovery_rolling.sh

log "verify: technique cluster-bank discovery rolling wrapper syntax"
bash -n tools/run_technique_cluster_bank_discovery_rolling.sh

log "verify: technique cluster-bank discovery fixed wrapper syntax"
bash -n tools/run_technique_cluster_bank_discovery_fixed.sh

log "verify: technique cluster-bank discovery server wrapper syntax"
bash -n tools/server_run_technique_cluster_bank_discovery_rolling.sh

log "verify: technique template screen contract smoke"
node tools/smoke_technique_template_screen_contract.mjs

log "verify: technique cluster template fixed contract smoke"
node tools/smoke_technique_cluster_template_fixed_contract.mjs

log "verify: technique cluster template screen plan smoke"
node tools/smoke_technique_cluster_template_screen_plan.mjs

log "verify: technique template filtered pack smoke"
node tools/smoke_technique_template_filtered_pack.mjs

log "verify: technique template run slug smoke"
node tools/smoke_technique_template_run_slug.mjs

log "verify: technique template screen plan syntax"
node --check tools/build_technique_template_screen_plan.mjs

log "verify: technique template screen candidate-contract syntax"
node --check tools/build_technique_template_screen_candidate_contract.mjs

log "verify: technique cluster template screen plan syntax"
node --check tools/build_technique_cluster_template_screen_plan.mjs

log "verify: technique cluster template screen candidate-contract syntax"
node --check tools/build_technique_cluster_template_screen_candidate_contract.mjs

log "verify: technique cluster template fixed candidate-contract syntax"
node --check tools/build_technique_cluster_template_screen_fixed_candidate_contract.mjs

log "verify: technique template filtered pack syntax"
node --check tools/build_technique_template_filtered_pack.mjs

log "verify: technique template screen summary syntax"
node --check tools/build_technique_template_screen_summary.mjs

log "verify: technique template rolling wrapper syntax"
bash -n tools/run_technique_template_rolling.sh

log "verify: technique template server wrapper syntax"
bash -n tools/server_run_technique_template_rolling.sh

log "verify: technique cluster template rolling wrapper syntax"
bash -n tools/run_technique_cluster_template_rolling.sh

log "verify: technique cluster template fixed wrapper syntax"
bash -n tools/run_technique_cluster_template_fixed.sh

log "verify: technique cluster template server wrapper syntax"
bash -n tools/server_run_technique_cluster_template_rolling.sh

log "verify: TP12 year2hit metric alignment smoke"
node tools/smoke_tp12_year2hit_metric_alignment.mjs

log "verify: public-KR universe membership diff smoke"
python3 tools/smoke_public_kr_universe_membership_diff.py

log "verify: TP12 year2hit data readiness smoke"
python3 tools/smoke_tp12_year2hit_data_readiness.py
python3 tools/smoke_tp12_asof_clean_daily_inputs.py

log "verify: TP12 year2hit train gate syntax"
node --check src/lib/tp12_year2hit_foundation_io.mjs
node --check src/lib/tp12_label_event_builder.mjs
node --check src/lib/tp12_feature_tokenizer.mjs
node --check src/lib/tp12_year2hit_candidate_miner.mjs
node --check src/lib/tp12_candidate_event_materializer.mjs
node --check src/lib/tp12_year2hit_quality_gate.mjs
node --check src/lib/tp12_operational_hit_contract.mjs
node --check src/lib/tp12_survivor_catalog_freeze.mjs
node --check src/lib/tp12_year2hit_candidate_replay_report.mjs
node --check src/lib/tp12_year2hit_trainfold_selector_audit.mjs
node --check src/lib/tp12_year2hit_operating_gate.mjs
node --check src/lib/tp12_year2hit_operational_event_enricher.mjs
node --check src/lib/tp12_year2hit_executable_pattern_bank.mjs
node --check src/lib/tp12_year2hit_executable_nonhit_purge_gate.mjs
node --check src/lib/tp12_year2hit_pattern_bundle_selector.mjs
node --check src/lib/tp12_year2hit_cover_replay_operational_bridge.mjs
node --check src/lib/tp12_entry_feasibility_audit.mjs
node --check src/lib/tp12_nested_split_plan.mjs
node --check src/lib/tp12_pattern_cluster_dedupe.mjs
node --check src/lib/tp12_pattern_reliability_by_fold.mjs
node --check src/lib/tp12_symbol_date_consensus_features.mjs
node --check src/lib/tp12_selector_feature_source_repair.mjs
node --check src/lib/tp12_hard_negative_dataset.mjs
node --check src/lib/tp12_context_feature_builder.mjs
node --check src/lib/tp12_context_consensus_joiner.mjs
node --check src/lib/tp12_abstention_selector_cv.mjs
node --check src/lib/tp12_veto_bank_trainer.mjs
node --check src/lib/tp12_path_quality_label_audit.mjs
node --check src/lib/tp12_same_day_pairwise_overcrowding_ranker.mjs
node --check src/lib/tp12_same_day_listwise_context_abstention.mjs
node --check src/lib/tp12_learned_same_day_ranker.mjs
node --check src/lib/tp12_side_daily_coverage_audit.mjs
node --check src/lib/tp12_h80_train_gate.mjs
node --check src/lib/tp12_h80_wilson_contrastive_contract.mjs
node --check src/lib/tp12_train100_closeout.mjs
node --check src/lib/tp12_train100_year2hit_discovery.mjs
node --check src/lib/tp12_train100_neutral_search_guards.mjs
node --check src/lib/tp12_train100_neutral_event_builder.mjs
node --check src/lib/tp12_train100_neutral_feature_catalog.mjs
node --check src/lib/tp12_train100_neutral_atom_bitsets.mjs
node --check src/lib/tp12_train100_neutral_anchor_generator.mjs
node --check src/lib/tp12_train100_neutral_veto_setcover.mjs
node --check src/lib/tp12_train100_neutral_anchor_veto_miner.mjs
node --check src/lib/tp12_train100_neutral_exact_verifier.mjs
node --check src/lib/tp12_train100_neutral_certificate_writer.mjs
node --check src/lib/tp12_train100_positive_motif_common.mjs
node --check src/lib/tp12_positive_motif_contract_assert.mjs
node --check src/lib/tp12_train_label_universe_builder.mjs
node --check src/lib/tp12_pre_hit_chart_snapshot_builder.mjs
node --check src/lib/tp12_symbolic_motif_feature_builder.mjs
node --check src/lib/tp12_symbolic_motif_catalog.mjs
node --check src/lib/tp12_positive_motif_miner.mjs
node --check src/lib/tp12_motif_negative_control_builder.mjs
node --check src/lib/tp12_motif_anchor_full_negative_verifier.mjs
node --check src/lib/tp12_motif_false_positive_contrast.mjs
node --check src/lib/tp12_positive_motif_conditional_veto_setcover.mjs
node --check src/lib/tp12_train100_positive_motif_exact_verifier.mjs
node --check src/lib/tp12_train100_positive_motif_certificate_writer.mjs
node --check tools/build_tp12_label_events.mjs
node --check tools/build_tp12_tokenized_events.mjs
node --check tools/mine_tp12_year2hit_candidates.mjs
node --check tools/assert_tp12_train100_preflight.mjs
node --check tools/build_tp12_train100_atom_table.mjs
node --check tools/mine_tp12_train100_exact_candidates.mjs
node --check tools/mine_tp12_train100_negative_elimination.mjs
node --check tools/mine_tp12_train100_counterexample_exact_completion.mjs
node --check tools/build_tp12_train100_counterexample_partition_report.mjs
node --check tools/assert_tp12_train100_quality_gate.mjs
node --check tools/closeout_tp12_train100_zero_survivor.mjs
node --check tools/build_tp12_train100_discovery_report.mjs
node --check tools/build_tp12_train100_neutral_feature_catalog.mjs
node --check tools/build_tp12_train100_neutral_events.mjs
node --check tools/build_tp12_train100_neutral_atom_bitsets.mjs
node --check tools/generate_tp12_train100_neutral_anchors.mjs
node --check tools/mine_tp12_train100_neutral_anchor_veto_patterns.mjs
node --check tools/verify_tp12_train100_neutral_survivors.mjs
node --check tools/write_tp12_train100_neutral_certificates.mjs
node --check tools/assert_tp12_positive_motif_contract.mjs
node --check tools/build_tp12_train_label_universe.mjs
node --check tools/build_tp12_pre_hit_chart_snapshots.mjs
node --check tools/build_tp12_symbolic_motif_features.mjs
node --check tools/build_tp12_symbolic_motif_catalog.mjs
node --check tools/smoke_tp12_sequence_shapelet_features.mjs
node --check tools/mine_tp12_positive_motifs.mjs
node --check tools/build_tp12_motif_negative_controls.mjs
node --check tools/verify_tp12_motif_anchors_against_full_train.mjs
node --check tools/analyze_tp12_motif_false_positive_contrast.mjs
node --check tools/mine_tp12_positive_motif_conditional_veto.mjs
node --check tools/verify_tp12_train100_positive_motif_survivors.mjs
node --check tools/write_tp12_train100_positive_motif_certificates.mjs
node --check tools/materialize_tp12_candidate_events.mjs
node --check tools/build_tp12_year2hit_quality_gate_summary.mjs
node --check tools/freeze_tp12_year2hit_survivor_catalog.mjs
node --check tools/build_tp12_year2hit_train_gate_summary.mjs
node --check src/lib/tp12_year2hit_train_gate.mjs
node --check src/lib/tp12_year2hit_gated_catalog.mjs
node --check tools/build_tp12_year2hit_gated_catalog.mjs
node --check tools/assert_tp12_year2hit_oos_preflight.mjs
node --check tools/build_tp12_year2hit_candidate_replay_report.mjs
node --check tools/build_tp12_year2hit_trainfold_selector_audit.mjs
node --check tools/build_tp12_year2hit_operating_gate_summary.mjs
node --check tools/assert_tp12_no_future_tuning_leakage.mjs
node --check tools/build_tp12_internal_validation_gate_summary.mjs
node --check tools/build_tp12_locked_future_eval_summary.mjs
node --check tools/build_tp12_year2hit_operational_events.mjs
node --check tools/build_tp12_year2hit_executable_pattern_bank.mjs
node --check tools/build_tp12_year2hit_executable_nonhit_purge_gate.mjs
node --check tools/build_tp12_year2hit_pattern_bundle_bank.mjs
node --check tools/build_tp12_year2hit_cover_replay_operational_bridge.mjs
node --check tools/build_tp12_year2hit_monthly_coverage_bundle_optimizer.mjs
node --check tools/build_tp12_entry_feasibility_audit.mjs
node --check tools/build_tp12_nested_split_plan.mjs
node --check tools/build_tp12_pattern_clusters.mjs
node --check tools/build_tp12_pattern_reliability_by_fold.mjs
node --check tools/build_tp12_symbol_date_consensus_features.mjs
node --check tools/build_tp12_selector_feature_source_repair.mjs
node --check tools/build_tp12_monthly_quota_precision_scheduler.mjs
node --check tools/build_tp12_hard_negative_dataset.mjs
node --check tools/build_tp12_context_features.mjs
node --check tools/build_tp12_context_consensus_features.mjs
node --check tools/run_tp12_abstention_selector_cv.mjs
node --check tools/train_tp12_veto_bank.mjs
node --check tools/build_tp12_path_quality_label_audit.mjs
node --check tools/run_tp12_same_day_pairwise_overcrowding_ranker.mjs
node --check tools/run_tp12_same_day_listwise_context_abstention.mjs
node --check tools/run_tp12_learned_same_day_ranker.mjs
node --check tools/smoke_tp12_operational_hit_contract.mjs
node --check tools/smoke_tp12_operational_monthly_gate.mjs
node --check tools/smoke_tp12_locked_future_eval_protocol.mjs
node --check tools/smoke_tp12_year2hit_executable_pattern_bundle_bank.mjs
node --check tools/smoke_tp12_year2hit_cover_replay_operational_bridge.mjs
node --check tools/smoke_tp12_year2hit_monthly_coverage_bundle_optimizer.mjs
node --check tools/audit_tp12_side_daily_coverage.mjs
node --check tools/assert_tp12_h80_train_gate.mjs
node --check tools/assert_tp12_h80_wilson_contrastive_contract.mjs
node --check tools/audit_tp12_asof_survivorship.mjs
node --check tools/smoke_tp12_label_horizon_boundary.mjs
node --check tools/smoke_tp12_label_global_next_session.mjs
node --check tools/smoke_tp12_h80_foundation.mjs
node --check tools/smoke_tp12_hard_negative_dataset.mjs
node --check tools/smoke_tp12_context_features.mjs
node --check tools/smoke_tp12_context_consensus_features.mjs
node --check tools/smoke_tp12_selector_feature_source_repair.mjs
node --check tools/smoke_tp12_monthly_quota_precision_scheduler.mjs
node --check tools/smoke_tp12_monthly_quota_replay_integration.mjs
node --check tools/smoke_tp12_abstention_selector_cv.mjs
node --check tools/smoke_tp12_h80_wilson_contrastive_contract.mjs
node --check tools/smoke_tp12_train100_closeout.mjs
node --check tools/smoke_tp12_train100_neutral_common.mjs
node --check tools/smoke_tp12_train100_neutral_event_builder.mjs
node --check tools/smoke_tp12_train100_neutral_feature_catalog.mjs
node --check tools/smoke_tp12_train100_neutral_atom_bitsets.mjs
node --check tools/smoke_tp12_train100_neutral_anchor_generator.mjs
node --check tools/smoke_tp12_train100_neutral_veto_setcover.mjs
node --check tools/smoke_tp12_train100_neutral_exact_verifier.mjs
node --check tools/smoke_tp12_train100_neutral_certificate_writer.mjs
node --check tools/smoke_tp12_train100_neutral_no_oos_no_fallback.mjs
node --check tools/smoke_tp12_positive_motif_common.mjs
node --check tools/smoke_tp12_positive_motif_contract.mjs
node --check tools/smoke_tp12_pre_hit_chart_snapshot_builder.mjs
node --check tools/smoke_tp12_symbolic_motif_feature_builder.mjs
node --check tools/smoke_tp12_sequence_shapelet_features.mjs
node --check tools/smoke_tp12_positive_motif_miner.mjs
node --check tools/smoke_tp12_motif_negative_control_builder.mjs
node --check tools/smoke_tp12_motif_conditional_veto_setcover.mjs
node --check tools/smoke_tp12_train100_positive_motif_exact_verifier.mjs
node --check tools/smoke_tp12_train100_positive_motif_certificate_writer.mjs
node --check tools/smoke_tp12_positive_motif_no_oos_no_fallback.mjs
node --check tools/smoke_tp12_veto_bank_trainer.mjs
node --check tools/smoke_tp12_path_quality_label_audit.mjs
node --check tools/smoke_tp12_same_day_pairwise_overcrowding_ranker.mjs
node --check tools/smoke_tp12_same_day_listwise_context_abstention.mjs
node --check tools/smoke_tp12_learned_same_day_ranker.mjs
node --check tools/smoke_tp12_side_daily_coverage_audit.mjs

log "verify: TP12 year2hit train gate wrapper syntax"
bash -n tools/run_tp12_year2hit_train_gate.sh
bash -n tools/run_tp12_year2hit_trainfirst_mining_pipeline.sh
bash -n tools/server_run_tp12_year2hit_trainfirst_mining_pipeline.sh
bash -n tools/run_tp12_year2hit_gated_catalog_oos_replay.sh
bash -n tools/server_run_tp12_year2hit_gated_catalog_oos_replay.sh
bash -n tools/run_stepb_1d_tp12_no_stop_scope_fixed_trainfirst.sh
bash -n tools/server_run_stepb_1d_tp12_no_stop_scope_fixed_trainfirst.sh
bash -n tools/smoke_tp12_year2hit_contract_wrapper.sh
bash -n tools/smoke_tp12_year2hit_trainfirst_wrapper_args.sh

log "verify: TP12 year2hit train gate smoke"
node tools/smoke_tp12_label_event_builder.mjs
node tools/smoke_tp12_label_same_bar_ambiguity.mjs
node tools/smoke_tp12_label_horizon_boundary.mjs
node tools/smoke_tp12_label_global_next_session.mjs
node tools/smoke_tp12_feature_asof_tokenizer.mjs
node tools/smoke_tp12_year2hit_candidate_miner.mjs
node tools/smoke_tp12_candidate_event_materializer.mjs
node tools/smoke_tp12_year2hit_candidate_replay_report.mjs
node tools/smoke_tp12_year2hit_quality_gate.mjs
node tools/smoke_tp12_survivor_catalog_freeze.mjs
node tools/smoke_tp12_year2hit_trainfold_selector_audit.mjs
node tools/smoke_tp12_year2hit_operating_gate.mjs
node tools/smoke_tp12_operational_hit_contract.mjs
node tools/smoke_tp12_operational_monthly_gate.mjs
node tools/smoke_tp12_locked_future_eval_protocol.mjs
node tools/smoke_tp12_year2hit_executable_pattern_bundle_bank.mjs
node tools/smoke_tp12_year2hit_cover_replay_operational_bridge.mjs
node tools/smoke_tp12_year2hit_monthly_coverage_bundle_optimizer.mjs
node tools/smoke_tp12_year2hit_train_gate.mjs
node tools/smoke_tp12_h80_foundation.mjs
node tools/smoke_tp12_hard_negative_dataset.mjs
node tools/smoke_tp12_context_features.mjs
node tools/smoke_tp12_context_consensus_features.mjs
node tools/smoke_tp12_selector_feature_source_repair.mjs
node tools/smoke_tp12_monthly_quota_precision_scheduler.mjs
node tools/smoke_tp12_monthly_quota_replay_integration.mjs
node tools/smoke_tp12_abstention_selector_cv.mjs
node tools/smoke_tp12_h80_wilson_contrastive_contract.mjs
node tools/smoke_tp12_train100_closeout.mjs
node tools/smoke_tp12_train100_neutral_event_builder.mjs
node tools/smoke_tp12_train100_neutral_feature_catalog.mjs
node tools/smoke_tp12_train100_neutral_atom_bitsets.mjs
node tools/smoke_tp12_train100_neutral_anchor_generator.mjs
node tools/smoke_tp12_train100_neutral_veto_setcover.mjs
node tools/smoke_tp12_train100_neutral_exact_verifier.mjs
node tools/smoke_tp12_train100_neutral_certificate_writer.mjs
node tools/smoke_tp12_train100_neutral_no_oos_no_fallback.mjs
node tools/smoke_tp12_positive_motif_contract.mjs
node tools/smoke_tp12_pre_hit_chart_snapshot_builder.mjs
node tools/smoke_tp12_symbolic_motif_feature_builder.mjs
node tools/smoke_tp12_sequence_shapelet_features.mjs
node tools/smoke_tp12_positive_motif_miner.mjs
node tools/smoke_tp12_motif_negative_control_builder.mjs
node tools/smoke_tp12_motif_conditional_veto_setcover.mjs
node tools/smoke_tp12_train100_positive_motif_exact_verifier.mjs
node tools/smoke_tp12_train100_positive_motif_certificate_writer.mjs
node tools/smoke_tp12_positive_motif_no_oos_no_fallback.mjs
node tools/smoke_tp12_veto_bank_trainer.mjs
node tools/smoke_tp12_path_quality_label_audit.mjs
node tools/smoke_tp12_same_day_pairwise_overcrowding_ranker.mjs
node tools/smoke_tp12_same_day_listwise_context_abstention.mjs
node tools/smoke_tp12_learned_same_day_ranker.mjs
node tools/smoke_tp12_side_daily_coverage_audit.mjs
node tools/smoke_tp12_train100_year2hit_discovery.mjs

log "verify: TP12 year2hit contract wrapper smoke"
bash tools/smoke_tp12_year2hit_contract_wrapper.sh

log "verify: TP12 year2hit train-first wrapper args smoke"
bash tools/smoke_tp12_year2hit_trainfirst_wrapper_args.sh

log "verify: TP12 year2hit same-date dedup smoke"
node tools/smoke_tp12_year2hit_same_date_dedup.mjs

log "verify: TP12 year2hit hit-field contract smoke"
node tools/smoke_tp12_year2hit_hit_field_contract.mjs

log "verify: TP12 year2hit invalid-row failfast smoke"
node tools/smoke_tp12_year2hit_invalid_row_failfast.mjs

log "verify: TP12 year2hit gated catalog smoke"
node tools/smoke_tp12_year2hit_gated_catalog.mjs

log "verify: TP12 year2hit OOS blocked without train gate smoke"
node tools/smoke_tp12_year2hit_oos_blocked_without_train_gate.mjs

log "verify: TP12 year2hit OOS preflight quality gate smoke"
node tools/smoke_tp12_year2hit_oos_preflight_quality_gate.mjs

log "verify: TP12 year2hit OOS preflight extended smoke"
node tools/smoke_tp12_year2hit_oos_preflight_extended.mjs

log "verify: TP12 year2hit core-year leakage smoke"
node tools/smoke_tp12_year2hit_core_year_leakage.mjs

log "verify: TP12 as-of survivorship gate smoke"
node tools/smoke_tp12_asof_survivorship_gate.mjs

log "verify: technique year-consensus smoke"
node tools/smoke_technique_year_consensus.mjs

log "verify: technique year-consensus summary syntax"
node --check tools/build_technique_year_consensus_summary.mjs

log "verify: technique year-consensus wrapper syntax"
bash -n tools/run_technique_year_consensus.sh

log "verify: technique year-consensus server wrapper syntax"
bash -n tools/server_run_technique_year_consensus.sh

log "verify: technique clause-core consensus smoke"
node tools/smoke_technique_clause_core_consensus.mjs

log "verify: technique clause-core consensus summary syntax"
node --check tools/build_technique_clause_core_consensus_summary.mjs

log "verify: technique clause-core rerun plan syntax"
node --check tools/build_technique_clause_core_rerun_plan.mjs

log "verify: technique structural atom builder smoke"
node tools/smoke_technique_structural_atom_builder.mjs

log "verify: technique structural-atom consensus smoke"
node tools/smoke_technique_structural_atom_consensus.mjs

log "verify: technique partition key builder smoke"
node tools/smoke_technique_partition_key_builder.mjs

log "verify: technique atomic transaction builder smoke"
node tools/smoke_technique_atomic_transactions.mjs

log "verify: technique positive-year index smoke"
node tools/smoke_technique_positive_year_index.mjs

log "verify: technique negative atom index smoke"
node tools/smoke_technique_negative_atom_index.mjs

log "verify: technique atomic transaction builder syntax"
node --check tools/build_technique_atomic_transactions.mjs

log "verify: technique positive-year index syntax"
node --check tools/build_technique_positive_year_index.mjs

log "verify: technique structural-atom projection syntax"
node --check tools/build_technique_structural_atom_projection.mjs

log "verify: technique structural-atom consensus summary syntax"
node --check tools/build_technique_structural_atom_consensus_summary.mjs

log "verify: technique negative atom index syntax"
node --check tools/build_technique_negative_atom_index.mjs

log "verify: technique closed-pattern miner smoke"
node tools/smoke_technique_closed_pattern_miner.mjs

log "verify: technique atom bucket exclusivity smoke"
node tools/smoke_technique_atom_bucket_exclusivity.mjs

log "verify: technique atom family caps smoke"
node tools/smoke_technique_atom_family_caps.mjs

log "verify: technique pattern preverifier smoke"
node tools/smoke_technique_pattern_preverifier.mjs

log "verify: technique closure-first preverify smoke"
node tools/smoke_technique_closure_first_preverify.mjs

log "verify: technique contrastive veto search smoke"
node tools/smoke_technique_contrastive_veto_search.mjs

log "verify: technique contrastive core generator preservation smoke"
node tools/smoke_technique_contrastive_core_generator_preservation.mjs

log "verify: technique contrastive veto report streaming smoke"
node tools/smoke_technique_contrastive_veto_report_streaming.mjs

log "verify: technique zero-negative verifier smoke"
node tools/smoke_technique_zero_negative_verifier.mjs

log "verify: technique survivor ranker smoke"
node tools/smoke_technique_survivor_ranker.mjs

log "verify: technique episode window builder smoke"
node tools/smoke_technique_episode_window_builder.mjs

log "verify: technique episode substrate search smoke"
node tools/smoke_technique_episode_substrate_search.mjs

log "verify: technique episode substrate partition smoke"
node tools/smoke_technique_episode_partitioned_substrate_search.mjs

log "verify: technique episode near-miss supervision smoke"
node tools/smoke_technique_episode_nearmiss_supervision.mjs

log "verify: technique episode ranked enumeration smoke"
node tools/smoke_technique_episode_ranked_enumeration.mjs

log "verify: technique episode unbounded enumeration smoke"
node tools/smoke_technique_episode_unbounded_enumeration.mjs
log "verify: matched-control purity slice smoke"
node tools/smoke_technique_matched_control_purity_slice.mjs

log "verify: technique episode control matcher smoke"
node tools/smoke_technique_episode_control_matcher.mjs

log "verify: technique episode delta atoms smoke"
node tools/smoke_technique_episode_delta_atoms.mjs

log "verify: technique episode slice contract search smoke"
node tools/smoke_technique_episode_slice_contract_search.mjs

log "verify: technique episode slice pack smoke"
node tools/smoke_technique_episode_slice_pack.mjs

log "verify: technique episode matched-control supervision smoke"
node tools/smoke_technique_episode_matched_control_supervision.mjs

log "verify: technique closed-pattern builder syntax"
node --check tools/build_technique_closed_patterns.mjs

log "verify: technique zero-negative report syntax"
node --check tools/build_technique_zero_negative_report.mjs

log "verify: technique pattern preverify report syntax"
node --check tools/build_technique_pattern_preverify_report.mjs

log "verify: technique contrastive veto report syntax"
node --check tools/build_technique_contrastive_veto_report.mjs

log "verify: technique discovery summary syntax"
node --check tools/build_technique_pattern_discovery_summary.mjs

log "verify: technique episode windows build syntax"
node --check tools/build_technique_episode_windows.mjs

log "verify: technique episode substrate report syntax"
node --check tools/build_technique_episode_substrate_report.mjs
log "verify: technique episode control pairs build syntax"
node --check tools/build_technique_episode_control_pairs.mjs

log "verify: technique episode delta atoms build syntax"
node --check tools/build_technique_episode_delta_atoms.mjs

log "verify: technique episode slice contract build syntax"
node --check tools/build_technique_episode_slice_contracts.mjs

log "verify: technique episode slice pack build syntax"
node --check tools/build_technique_episode_slice_pack.mjs

log "verify: technique episode slice recheck report syntax"
node --check tools/build_technique_episode_slice_recheck_report.mjs

log "verify: technique episode substrate wrapper syntax"
bash -n tools/run_technique_episode_substrate_discovery.sh

log "verify: technique episode substrate server wrapper syntax"
bash -n tools/server_run_technique_episode_substrate_discovery.sh
log "verify: technique episode matched-control purity slice wrapper syntax"
bash -n tools/run_technique_episode_matched_control_purity_slice.sh

log "verify: technique episode matched-control purity slice server wrapper syntax"
bash -n tools/server_run_technique_episode_matched_control_purity_slice.sh
log "verify: technique episode matched-control purity slice detached launcher syntax"
bash -n tools/launch_technique_episode_matched_control_purity_slice_detached.sh

log "verify: technique episode matched-control purity slice status reader syntax"
bash -n tools/read_technique_episode_matched_control_purity_slice_status.sh

log "verify: technique episode matched-control purity slice server status reader syntax"
bash -n tools/server_read_technique_episode_matched_control_purity_slice_status.sh

log "verify: technique positive-first discovery wrapper syntax"
bash -n tools/run_technique_positive_first_discovery.sh

log "verify: technique positive-first discovery server wrapper syntax"
bash -n tools/server_run_technique_positive_first_discovery.sh


log "verify: perfect prototype date breadth guards smoke"
node tools/smoke_perfect_prototype_rule_date_breadth_guards.mjs

log "verify: perfect prototype train matched-date prune smoke"
node tools/smoke_perfect_prototype_train_matched_date_prune.mjs

log "verify: perfect prototype train matched temporal prune smoke"
node tools/smoke_perfect_prototype_train_matched_temporal_prune.mjs

log "verify: perfect prototype catalog diversity selectors smoke"
node tools/smoke_perfect_prototype_catalog_diversity_selectors.mjs

log "verify: recent-only family root allowlist smoke"
node tools/smoke_perfect_prototype_recent_only_family_root_allowlist.mjs

log "verify: support case contract smoke"
node tools/smoke_perfect_prototype_support_case_contract.mjs

log "verify: 1D TOP/MID/LOW failure-bank OOS report smoke"
node tools/smoke_perfect_prototype_1d_top_mid_low_failure_bank_oos_report.mjs

log "verify: LOW recent significant episode exact bank smoke"
node tools/smoke_perfect_prototype_low_1d_recent_significant_episode_exact_bank.mjs

log "verify: LOW recent significant episode exact bank build syntax"
node --check tools/build_perfect_prototype_low_1d_recent_significant_episode_exact_bank.mjs

log "verify: LOW recent significant episode exact bank wrapper syntax"
bash -n tools/server_run_stepb_dplus1_plus_lite_recent_low_significant_episode_exact_bank.sh

log "verify: subgroup exact-entry bridge smoke"
node tools/smoke_perfect_prototype_subgroup_exact_entry_bridge.mjs

log "verify: 8D donor-aware TOP/MID/LOW subgroup system smoke"
node tools/smoke_perfect_prototype_8d_top_mid_low_subgroup_system.mjs

log "verify: 8D donor-aware TOP/MID/LOW subgroup build syntax"
node --check tools/build_perfect_prototype_8d_top_mid_low_subgroup_system.mjs

log "verify: 8D donor-aware TOP/MID/LOW subgroup wrapper syntax"
bash -n tools/server_run_perfect_prototype_8d_top_mid_low_subgroup_system.sh

log "verify: exact completion solver smoke"
node tools/smoke_perfect_prototype_exact_completion_solver.mjs

log "verify: exact core frontier smoke"
node tools/smoke_perfect_prototype_exact_core_frontier.mjs

log "verify: crossfit hard-negative refinement smoke"
node tools/smoke_perfect_prototype_crossfit_hard_negative_refinement.mjs

log "verify: joint feasibility bounds smoke"
node tools/smoke_perfect_prototype_joint_feasibility_bounds.mjs

log "verify: support-compatible atom space smoke"
node tools/smoke_perfect_prototype_support_compatible_atom_space.mjs

log "verify: 1D TP12 condition-language A/B report syntax"
node --check tools/build_stepb_1d_tp12_condition_language_ab_report.mjs

log "verify: TP12 probe metrics lib syntax"
node --check src/lib/perfect_prototype_tp12_probe_metrics.mjs

log "verify: TP12 promotable-first search smoke"
node tools/smoke_tp12_promotable_first_search.mjs

log "verify: 1D TP12 condition-language A/B wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_condition_language_ab_200k.sh

log "verify: 1D TP12 condition-language A/B report smoke"
node tools/smoke_stepb_1d_tp12_condition_language_ab_report.mjs

log "verify: 1D TP12 surface A/B report syntax"
node --check tools/build_stepb_1d_tp12_surface_ab_report.mjs

log "verify: 1D TP12 surface A/B wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_surface_ab_200k.sh

log "verify: 1D TP12 surface A/B report smoke"
node tools/smoke_stepb_1d_tp12_surface_ab_report.mjs

log "verify: 1D regime-cell filtered pack build syntax"
node --check tools/build_perfect_prototype_1d_regime_cell_filtered_pack.mjs

log "verify: 1D regime-cell filtered pack smoke"
node tools/smoke_perfect_prototype_1d_regime_cell_filtered_pack.mjs

log "verify: 1D TP12 regime-cells report syntax"
node --check tools/build_stepb_1d_tp12_regime_cells_report.mjs

log "verify: 1D TP12 regime-cells wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_regime_cells_200k.sh

log "verify: 1D TP12 regime-cells subset wrapper guard smoke"
node tools/smoke_stepb_1d_tp12_regime_cells_subset_wrapper_guard.mjs

log "verify: 1D TP12 regime-cells report smoke"
node tools/smoke_stepb_1d_tp12_regime_cells_report.mjs

log "verify: TP12 TOP-subscope filtered pack build syntax"
node --check tools/build_perfect_prototype_tp12_top_subscope_filtered_pack.mjs

log "verify: TP12 TOP-subscope filtered pack smoke"
node tools/smoke_perfect_prototype_tp12_top_subscope_filtered_pack.mjs

log "verify: 1D TP12 TOP-subscopes report syntax"
node --check tools/build_stepb_1d_tp12_top_subscopes_report.mjs

log "verify: 1D TP12 TOP-subscopes wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_top_subscopes_200k.sh

log "verify: 1D TP12 TOP-subscopes subset wrapper guard smoke"
node tools/smoke_stepb_1d_tp12_top_subscopes_subset_wrapper_guard.mjs

log "verify: 1D TP12 TOP-subscopes report smoke"
node tools/smoke_stepb_1d_tp12_top_subscopes_report.mjs

log "verify: TP12 LOW-subscope filtered pack build syntax"
node --check tools/build_perfect_prototype_tp12_low_subscope_filtered_pack.mjs

log "verify: TP12 LOW-subscope filtered pack smoke"
node tools/smoke_perfect_prototype_tp12_low_subscope_filtered_pack.mjs

log "verify: 1D TP12 LOW-subscopes report syntax"
node --check tools/build_stepb_1d_tp12_low_subscopes_report.mjs

log "verify: 1D TP12 LOW-subscopes wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_low_subscopes_200k.sh

log "verify: 1D TP12 LOW-subscopes subset wrapper guard smoke"
node tools/smoke_stepb_1d_tp12_low_subscopes_subset_wrapper_guard.mjs

log "verify: 1D TP12 LOW-subscopes report smoke"
node tools/smoke_stepb_1d_tp12_low_subscopes_report.mjs

log "verify: TP12 touch-contract smoke"
node tools/smoke_tp12_touch_contract.mjs

log "verify: 1D TP12 contract-split report syntax"
node --check tools/build_stepb_1d_tp12_contract_split_report.mjs

log "verify: 1D TP12 contract-split wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_contract_split_low_gap_top_200k.sh

log "verify: 1D TP12 contract-split report smoke"
node tools/smoke_stepb_1d_tp12_contract_split_report.mjs

log "verify: TP12 touch broadening lib syntax"
node --check src/lib/perfect_prototype_tp12_touch_broadening.mjs

log "verify: 1D TP12 touch broadening report syntax"
node --check tools/build_stepb_1d_tp12_touch_broadening_report.mjs

log "verify: 1D TP12 touch broadening wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_touch_broadening_low_gap_top_200k.sh

log "verify: 1D TP12 touch broadening report smoke"
node tools/smoke_stepb_1d_tp12_touch_broadening_report.mjs

log "verify: TP12 touch scorecard bundle lib syntax"
node --check src/lib/perfect_prototype_tp12_touch_scorecard_bundle.mjs

log "verify: 1D TP12 touch scorecard bundle report syntax"
node --check tools/build_stepb_1d_tp12_touch_scorecard_report.mjs

log "verify: 1D TP12 touch scorecard bundle wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_touch_scorecard_low_gap_top_200k.sh

log "verify: 1D TP12 touch scorecard bundle report smoke"
node tools/smoke_stepb_1d_tp12_touch_scorecard_report.mjs

log "verify: TP12 touch label matrix lib syntax"
node --check src/lib/perfect_prototype_tp12_touch_label_matrix.mjs

log "verify: TP12 touch bundle selector lib syntax"
node --check src/lib/perfect_prototype_tp12_touch_bundle_selector.mjs

log "verify: TP12 touch veto builder lib syntax"
node --check src/lib/perfect_prototype_tp12_touch_veto_builder.mjs

log "verify: 1D TP12 touch bundle-union report syntax"
node --check tools/build_stepb_1d_tp12_touch_bundle_union_report.mjs

log "verify: 1D TP12 touch bundle-union wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_touch_bundle_union_low_gap_top_200k.sh

log "verify: 1D TP12 touch bundle-union report smoke"
node tools/smoke_stepb_1d_tp12_touch_bundle_union_report.mjs

log "verify: support-manifold signature smoke"
node tools/smoke_perfect_prototype_support_manifold_signature.mjs

log "verify: support-metric features smoke"
node tools/smoke_perfect_prototype_support_metric_features.mjs

log "verify: support boundary residual family smoke"
node tools/smoke_perfect_prototype_support_boundary_residual_family.mjs

log "verify: support boundary residual scorer smoke"
node tools/smoke_perfect_prototype_support_boundary_residual_scorer.mjs

log "verify: support recurrence purity features smoke"
node tools/smoke_perfect_prototype_support_recurrence_purity_features.mjs

log "verify: support ordinal motif features smoke"
node tools/smoke_perfect_prototype_support_ordinal_motif_features.mjs

log "verify: support carrier graph family smoke"
node tools/smoke_perfect_prototype_support_carrier_graph_family.mjs

log "verify: support boundary local experts smoke"
node tools/smoke_perfect_prototype_support_boundary_local_experts.mjs

log "verify: support carrier graph local experts smoke"
node tools/smoke_perfect_prototype_support_carrier_graph_local_experts.mjs

log "verify: support corridor graph family smoke"
node tools/smoke_perfect_prototype_support_corridor_graph_family.mjs

log "verify: support corridor graph calibrate smoke"
node tools/smoke_perfect_prototype_support_corridor_graph_calibrate.mjs

log "verify: support corridor local experts smoke"
node tools/smoke_perfect_prototype_support_corridor_local_experts.mjs

log "verify: support bag cover smoke"
node tools/smoke_perfect_prototype_support_bag_cover.mjs

log "verify: support temporal episode smoke"
node tools/smoke_perfect_prototype_support_temporal_episode.mjs

log "verify: support temporal episode wrapper syntax"
bash -n tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_support_temporal_episode.sh

log "verify: support top1 query smoke"
node tools/smoke_perfect_prototype_support_top1_query.mjs

log "verify: support top1 query wrapper syntax"
bash -n tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_support_top1_query.sh

log "verify: daily trade-slate mechanism bank smoke"
node tools/smoke_perfect_prototype_daily_trade_slate_mechanism_bank.mjs

log "verify: daily trade-slate mechanism bank wrapper syntax"
bash -n tools/server_run_daily_trade_slate_mechanism_bank.sh

log "verify: daily trade-slate symbolic microcard bank smoke"
node tools/smoke_perfect_prototype_daily_trade_slate_symbolic_microcard_bank.mjs

log "verify: daily trade-slate symbolic microcard bank wrapper syntax"
bash -n tools/server_run_daily_trade_slate_symbolic_microcard_bank.sh

log "verify: daily trade-slate sequence shapelet witness bank smoke"
node tools/smoke_perfect_prototype_daily_trade_slate_sequence_shapelet_witness_bank.mjs

log "verify: daily trade-slate sequence shapelet witness bank wrapper syntax"
bash -n tools/server_run_daily_trade_slate_sequence_shapelet_witness_bank.sh

log "verify: support-like surge episode bank smoke"
node tools/smoke_perfect_prototype_support_like_surge_episode_bank.mjs

log "verify: support-like surge episode bank wrapper syntax"
bash -n tools/server_run_support_like_surge_episode_bank.sh

log "verify: prejump predictive hypothesis portfolio smoke"
node tools/smoke_perfect_prototype_prejump_predictive_hypothesis_portfolio.mjs

log "verify: prejump predictive hypothesis portfolio wrapper syntax"
bash -n tools/server_run_prejump_predictive_hypothesis_portfolio.sh

log "verify: prejump episode-transition counterfactual controls smoke"
node tools/smoke_prejump_episode_transition_counterfactual_controls.mjs

log "verify: prejump episode-transition counterfactual controls wrapper syntax"
bash -n tools/server_run_prejump_episode_transition_counterfactual_controls.sh

log "verify: recent_mid_low winner query smoke"
node tools/smoke_perfect_prototype_recent_mid_low_winner_query.mjs

log "verify: recent_mid_low winner query wrapper syntax"
bash -n tools/server_run_stepb_dplus1_plus_lite_recent_mid_low_winner_query.sh

log "verify: shadow winner-slate smoke"
node tools/smoke_perfect_prototype_shadow_winner_slate.mjs

log "verify: shadow winner-slate wrapper syntax"
bash -n tools/server_run_stepb_dplus1_plus_lite_shadow_winner_slate.sh

log "verify: daily canonical winner-slate smoke"
node tools/smoke_perfect_prototype_daily_canonical_winner_slate.mjs

log "verify: daily canonical winner-slate wrapper syntax"
bash -n tools/server_run_daily_canonical_winner_slate.sh

log "verify: trade-abstain archetype winner bank smoke"
node tools/smoke_perfect_prototype_trade_abstain_archetype_bank.mjs

log "verify: trade-abstain archetype winner bank wrapper syntax"
bash -n tools/server_run_trade_abstain_archetype_bank.sh

log "verify: support failure regime veto top1 smoke"
node tools/smoke_perfect_prototype_support_failure_regime_veto_top1.mjs

log "verify: support failure regime veto top1 wrapper syntax"
bash -n tools/server_run_stepb_dplus1_plus_lite_recent_support_failure_regime_veto_top1.sh

log "verify: support regime episode admission smoke"
node tools/smoke_perfect_prototype_support_regime_episode_admission.mjs

log "verify: support regime episode admission wrapper syntax"
bash -n tools/server_run_stepb_dplus1_plus_lite_recent_support_regime_episode_admission.sh

log "verify: support separability audit smoke"
node tools/smoke_perfect_prototype_support_separability_audit.mjs

log "verify: support separability audit wrapper syntax"
bash -n tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_support_separability_audit.sh

log "verify: support expert complement frontier smoke"
node tools/smoke_perfect_prototype_support_expert_complement_frontier.mjs

log "verify: stable rule bank smoke"
node tools/smoke_perfect_prototype_stable_rule_bank.mjs

log "verify: decision-set solver smoke"
node tools/smoke_perfect_prototype_decision_set_solver.mjs

log "verify: support scorecard term bank smoke"
node tools/smoke_perfect_prototype_support_scorecard_term_bank.mjs

log "verify: support scorecard solver smoke"
node tools/smoke_perfect_prototype_support_scorecard_solver.mjs

log "verify: support prototype router builder smoke"
node tools/smoke_perfect_prototype_support_prototype_router_builder.mjs

log "verify: support prototype router calibrate smoke"
node tools/smoke_perfect_prototype_support_prototype_router_calibrate.mjs

log "verify: support atlas builder smoke"
node tools/smoke_perfect_prototype_support_atlas_builder.mjs

log "verify: support atlas calibrate smoke"
node tools/smoke_perfect_prototype_support_atlas_calibrate.mjs

log "verify: support bridge family smoke"
node tools/smoke_perfect_prototype_support_bridge_family.mjs

log "verify: support bridge frontier smoke"
node tools/smoke_perfect_prototype_support_bridge_frontier.mjs

log "verify: support bridge recurrence lift smoke"
node tools/smoke_perfect_prototype_support_bridge_recurrence_lift.mjs

log "verify: support boundary veto smoke"
node tools/smoke_perfect_prototype_support_boundary_veto.mjs

log "verify: support atlas anchor cover smoke"
node tools/smoke_perfect_prototype_support_atlas_anchor_cover.mjs

log "verify: support carrier graph local experts wrapper syntax"
bash -n tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_support_carrier_graph_local_experts.sh

log "verify: support corridor graph wrapper syntax"
bash -n tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_support_corridor_graph.sh

log "verify: support corridor local experts wrapper syntax"
bash -n tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_support_corridor_local_experts.sh

log "verify: support bag cover wrapper syntax"
bash -n tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_support_bag_cover.sh

log "verify: perfect prototype day-cap selection smoke"
node tools/smoke_perfect_prototype_daycap2_selection.mjs

log "verify: OOS matched-date count smoke"
node tools/smoke_report_perfect_prototypes_oos_matched_dates.mjs

log "verify: Step-B exact postings cache smoke"
node tools/smoke_stepb_exact_postings_cache.mjs

log "verify: Step-B exact compiled input smoke"
node tools/smoke_stepb_exact_compiled_input.mjs

log "verify: Step-B exact direct index row-token artifacts smoke"
node tools/smoke_stepb_exact_index_row_token_artifacts.mjs

log "verify: Step-B exact indexed streamed builder smoke"
node tools/smoke_stepb_exact_indexed_stream_equivalence.mjs

if [[ "$ROOT_DIR" == /home/moltook/apps/stockdesk-lab-lite* ]]; then
  log "verify: Step-B exact parallel frontier equivalence smoke"
  node tools/smoke_stepb_exact_parallel_frontier_equivalence.mjs
else
  warn "skip Step-B exact parallel frontier equivalence smoke (server-only worker path)"
fi

log "verify: index merge equivalence smoke"
node tools/smoke_prejump_index_merge_equivalence.mjs

log "verify: effective trading coverage contract smoke"
node tools/smoke_prejump_fullrange_requested_coverage_guard.mjs

log "verify: structured sink equivalence smoke"
node tools/smoke_prejump_structured_sink_equivalence.mjs

log "verify: index contract guard smoke"
node tools/smoke_prejump_index_contract_guard.mjs

log "verify: parallel full-range chunk rebalance smoke"
node tools/smoke_prejump_parallel_fullrange_chunk_rebalance.mjs

log "verify: parallel full-range cost calibration smoke"
node tools/smoke_prejump_parallel_fullrange_cost_calibration.mjs

log "verify: parallel full-range head microprobe dispatch smoke"
node tools/smoke_prejump_parallel_fullrange_head_microprobe_dispatch.mjs

log "verify: parallel full-range first-wave chunk micro-split smoke"
node tools/smoke_prejump_parallel_fullrange_first_wave_chunk_micro_split.mjs

log "verify: parallel full-range first-wave completion-target split smoke"
node tools/smoke_prejump_parallel_fullrange_first_wave_completion_target_split.mjs

log "verify: parallel first-wave unbound competition smoke"
node tools/smoke_prejump_parallel_first_wave_unbound_competition.mjs

log "verify: parallel full-range root-seed microshard smoke"
node tools/smoke_prejump_parallel_fullrange_root_seed_microshard.mjs

log "verify: parallel full-range forced singleton microshard smoke"
node tools/smoke_prejump_parallel_fullrange_forced_singleton_microshard.mjs

log "verify: parallel full-range singleton post-split rescoring smoke"
node tools/smoke_prejump_parallel_fullrange_singleton_postsplit_rescoring.mjs

log "verify: parallel full-range singleton-root completion ranking smoke"
node tools/smoke_prejump_parallel_fullrange_single_root_completion_ranking.mjs

log "verify: parallel full-range singleton completion score calibration smoke"
node tools/smoke_prejump_parallel_fullrange_singleton_completion_score_calibration.mjs

log "verify: parallel full-range singleton exact completion microprobe smoke"
node tools/smoke_prejump_parallel_fullrange_singleton_exact_completion_microprobe.mjs

log "verify: parallel full-range singleton adaptive exact completion probe smoke"
node tools/smoke_prejump_parallel_fullrange_singleton_adaptive_exact_completion_probe.mjs

log "verify: parallel full-range multi-root completion ranking smoke"
node tools/smoke_prejump_parallel_fullrange_multi_root_completion_ranking.mjs

log "verify: parallel commit active reclaim gate smoke"
node tools/smoke_prejump_parallel_commit_active_reclaim_gate.mjs

log "verify: parallel active reclaim budget-request snapshot smoke"
node tools/smoke_prejump_parallel_active_reclaim_budget_request_snapshot.mjs

log "verify: search-state cache incremental range-summary smoke"
node tools/smoke_prejump_search_state_cache_incremental_range_summary.mjs

log "verify: worker memo range-summary rebuild collapse smoke"
node tools/smoke_prejump_worker_memo_range_summary_rebuild_collapse.mjs

log "verify: worker memo lookup fastpath smoke"
node tools/smoke_prejump_worker_memo_lookup_fastpath.mjs

log "verify: worker rowset fused count/fill smoke"
node tools/smoke_prejump_worker_rowset_fused_count_fill.mjs

log "verify: public KR daily invalid candle smoke"
python3 tools/smoke_fill_public_kr_daily_invalid_rows.py

log "verify: public KR nontrading status smoke"
python3 tools/smoke_fill_public_kr_nontrading_status.py

log "verify: public KR nontrading invariants smoke"
python3 tools/smoke_fill_public_kr_nontrading_invariants.py

log "verify: public KR pykrx symbol discovery smoke"
python3 tools/smoke_fill_public_kr_symbol_discovery_pykrx_instance.py

log "verify: public KR historical invalid candle tools smoke"
python3 tools/smoke_public_kr_invalid_candle_historical_tools.py

log "verify: public KR KRX curl client smoke"
python3 tools/smoke_public_kr_krx_curl_client.py

log "verify: public KR historical stage tools smoke"
python3 tools/smoke_public_kr_historical_stage_tools.py

log "verify: public KR historical input builders smoke"
python3 tools/smoke_public_kr_historical_input_builders.py

log "verify: public KR active candle provider smoke"
python3 tools/smoke_public_kr_active_candle_provider.py

log "verify: public KR historical shares coverage smoke"
python3 tools/smoke_public_kr_historical_shares_coverage.py

log "verify: public KR partial coverage repair smoke"
python3 tools/smoke_public_kr_partial_coverage_repair.py

log "verify: public KR partial coverage audit syntax"
python3 -m py_compile tools/audit_public_kr_partial_coverage_dates.py

log "verify: public KR historical shares coverage syntax"
python3 -m py_compile tools/assert_public_kr_historical_shares_coverage.py

log "verify: public KR targeted repair validator syntax"
python3 -m py_compile tools/validate_public_kr_targeted_repair_stage.py

log "verify: public KR historical stage-only wrapper syntax"
bash -n tools/run_public_kr_historical_stage_only.sh

log "verify: public KR historical stage-only server wrapper syntax"
bash -n tools/server_run_public_kr_historical_stage_only.sh

log "verify: public KR targeted repair wrapper syntax"
bash -n tools/run_public_kr_targeted_date_repair.sh

log "verify: public KR targeted repair server wrapper syntax"
bash -n tools/server_run_public_kr_targeted_date_repair.sh

log "verify: Kiwoom REST client smoke"
python3 tools/smoke_kiwoom_rest_client.py

log "verify: Kiwoom REST probes smoke"
python3 tools/smoke_kiwoom_rest_probes.py

log "verify: Step-B D+1 baseline contract smoke"
node tools/smoke_stepb_dplus1_baseline_contract.mjs

log "verify: Step-A recent-impulse 3d lane smoke"
node tools/smoke_stepa_recent_impulse_3d_lane.mjs

log "verify: Step-A recent-impulse 7d lane smoke"
node tools/smoke_stepa_recent_impulse_7d_lane.mjs

log "verify: Step-A recent-impulse 8d lane smoke"
node tools/smoke_stepa_recent_impulse_8d_lane.mjs

log "verify: TP12 Step-A intraday manifest smoke"
node tools/smoke_tp12_stepa_intraday_manifest.mjs

log "verify: TP12 intraday allowlist builder syntax"
node --check tools/build_tp12_intraday_allowlist_from_pack.mjs

log "verify: TP12 intraday allowlist wrapper syntax"
bash -n tools/run_tp12_intraday_allowlist_from_pack.sh

log "verify: TP12 intraday allowlist server wrapper syntax"
bash -n tools/server_run_tp12_intraday_allowlist_from_pack.sh

log "verify: recent-impulse OOS Step-A refresh wrapper syntax"
bash -n tools/server_run_stepa_recent_impulse_oos_refresh.sh

log "verify: Kiwoom TP12 inputs wrapper syntax"
bash -n tools/run_kiwoom_tp12_inputs.sh

log "verify: Kiwoom side-daily stage tools smoke"
python3 tools/smoke_kiwoom_side_daily_stage_tools.py

log "verify: Kiwoom side-daily wrapper syntax"
bash -n tools/run_kiwoom_side_daily_backfill.sh

log "verify: Kiwoom side-daily server wrapper syntax"
bash -n tools/server_run_kiwoom_side_daily_backfill.sh

log "verify: Kiwoom intraday 1m stage tools smoke"
python3 tools/smoke_kiwoom_intraday_stage_tools.py

log "verify: TP12 intraday feature dataset smoke"
node tools/smoke_tp12_intraday_feature_dataset.mjs

log "verify: TP12 intraday feature bridge smoke"
node tools/smoke_tp12_intraday_feature_bridge.mjs

log "verify: Kiwoom intraday 1m wrapper syntax"
bash -n tools/run_kiwoom_intraday_1m_backfill.sh

log "verify: Kiwoom intraday 1m server wrapper syntax"
bash -n tools/server_run_kiwoom_intraday_1m_backfill.sh

log "verify: Kiwoom TP12 backfill wrapper syntax"
bash -n tools/run_kiwoom_tp12_backfill.sh

log "verify: TP12 intraday feature dataset wrapper syntax"
bash -n tools/run_tp12_intraday_feature_dataset.sh

log "verify: TP12 intraday feature dataset server wrapper syntax"
bash -n tools/server_run_tp12_intraday_feature_dataset.sh

log "verify: TP12 intraday feature bridge wrapper syntax"
bash -n tools/run_tp12_intraday_feature_pack_bridge.sh

log "verify: TP12 intraday feature bridge server wrapper syntax"
bash -n tools/server_run_tp12_intraday_feature_pack_bridge.sh

log "verify: Kiwoom TP12 pipeline wrapper syntax"
bash -n tools/run_kiwoom_tp12_pipeline.sh

log "verify: Kiwoom TP12 pipeline server wrapper syntax"
bash -n tools/server_run_kiwoom_tp12_pipeline.sh

log "verify: Step-B D+1 plus-lite surface smoke"
node tools/smoke_stepb_dplus1_plus_lite_surface.mjs

log "verify: Step-B plus-lite open-eval pack smoke"
node tools/smoke_stepb_plus_lite_open_eval_pack.mjs

log "verify: Step-B plus-lite seeded recent-impulse pack smoke"
node tools/smoke_stepb_plus_lite_seeded_recent_impulse_pack.mjs

log "verify: Step-B plus-lite seeded widened pack smoke"
node tools/smoke_stepb_plus_lite_seeded_widened_pack.mjs

log "verify: Step-B D+1 leaderboard smoke"
node tools/smoke_stepb_dplus1_train_oos_leaderboard.mjs

log "verify: Step-B plus-lite open-eval leaderboard smoke"
node tools/smoke_stepb_plus_lite_open_eval_leaderboard.mjs

log "verify: live priority registry smoke"
node tools/smoke_live_priority_registry.mjs

log "verify: live priority merge smoke"
node tools/smoke_merge_live_priority_results.mjs

log "verify: live-line failure/veto overlay report smoke"
node tools/smoke_perfect_prototype_live_line_failure_veto_overlay_report.mjs

log "verify: live-line failure/veto overlay build syntax"
node --check tools/build_perfect_prototype_live_line_failure_veto_overlay_report.mjs

log "verify: live priority noop state smoke"
node tools/smoke_live_priority_stack_noop.mjs

log "verify: live priority same-day after-close wrapper guard smoke"
node tools/smoke_live_priority_same_day_after_close_wrapper.mjs

log "verify: daily ops fill-to-live pipeline smoke"
node tools/smoke_daily_ops_fill_to_live_pipeline.mjs

log "verify: daily ops completed state persistence smoke"
node tools/smoke_daily_ops_completed_state_persistence.mjs

log "verify: Step-B D+1 boundary guardrails smoke"
node tools/smoke_stepb_dplus1_boundary_guardrails.mjs

log "verify: Step-B D+1 wrapper end-to-end smoke"
node tools/smoke_stepb_dplus1_wrapper_e2e.mjs

log "verify: Step-B plus-lite open-eval wrapper syntax smoke"
bash -n tools/server_run_stepb_plus_lite_open_eval.sh
bash -n tools/run_server_stepb_plus_lite_open_eval.sh

log "verify: live priority wrapper syntax smoke"
node --check tools/server_run_daily_ops_stack.mjs
node --check tools/report_low_gap_top_cluster_differentials.mjs
bash -n tools/server_stepb_plus_lite_curated_after_close.sh
bash -n tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_generalized.sh
bash -n tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_boundary_residual_experts.sh
bash -n tools/server_run_live_line_failure_veto_overlay_report.sh
bash -n tools/server_run_live_priority_stack.sh
bash -n tools/run_public_fill_once.sh
bash -n tools/run_daily_ops_once.sh
bash -n tools/install_daily_ops_timer.sh

log "verify: Step-B after-close surface integrity smoke"
node tools/smoke_stepb_after_close_surface_integrity.mjs

log "verify: catalog freeze selection provenance smoke"
node tools/smoke_perfect_prototype_catalog_freeze_selection_provenance.mjs

log "verify: recent-only LOW bundle contract smoke"
node tools/smoke_perfect_prototype_recent_low_bundle_contract.mjs

log "verify: support-pruned root contract smoke"
node tools/smoke_perfect_prototype_support_pruned_root_contract.mjs

log "verify: low-gap-top generalized subgroup contract smoke"
node tools/smoke_perfect_prototype_low_gap_top_generalized_subgroup_contract.mjs

log "verify: low-gap-top generalized runtime contract smoke"
node tools/smoke_perfect_prototype_low_gap_top_generalized_runtime_contract.mjs

log "verify: apply symbol dedupe smoke"
node tools/smoke_perfect_prototype_apply_symbol_dedupe.mjs

log "verify: pack/catalog contract guard smoke"
node tools/smoke_perfect_prototype_pack_catalog_contract_guard.mjs

log "verify: apply recommendation close-return unsorted candle smoke"
node tools/smoke_apply_recommendation_close_ret_unsorted_candles.mjs

log "verify: feature/row contribution diagnostics smoke"
node tools/smoke_prejump_feature_row_contribution_diagnostics.mjs

log "verify: multiline wrapper syntax smoke"
bash -n tools/server_run_stepb_recent_impulse_matrix.sh
bash -n tools/run_server_stepb_recent_impulse_matrix.sh
bash -n tools/server_run_stepb_plus_lite_widened_recent_matrix.sh
bash -n tools/run_server_stepb_plus_lite_widened_recent_matrix.sh

log "verify: parallel control-plane churn policy smoke"
node tools/smoke_prejump_parallel_control_plane_churn_policy.mjs

SERVER_VERIFY_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
if [[ -d "$SERVER_VERIFY_ROOT" ]]; then
  SERVER_VERIFY_ROOT="$(cd "$SERVER_VERIFY_ROOT" && pwd -P)"
fi
CURRENT_VERIFY_ROOT="$(pwd -P)"
if [[ "$CURRENT_VERIFY_ROOT" == "$SERVER_VERIFY_ROOT" ]]; then
  log "verify: native rowset kernel refresh before server-only parallel smokes"
  bash scripts/build_native_rowset_kernel.sh

  log "verify: parallel budget exact guardband smoke"
  node tools/smoke_prejump_parallel_budget_exact_guardband.mjs

  log "verify: parallel budget request/ack smoke"
  node tools/smoke_prejump_parallel_budget_request_ack.mjs

  log "verify: parallel budget reclaim/ack smoke"
  node tools/smoke_prejump_parallel_budget_reclaim_ack.mjs

  log "verify: parallel live budget top-up smoke"
  node tools/smoke_prejump_parallel_live_budget_topup.mjs

  log "verify: parallel live budget regression acceptance smoke"
  node tools/smoke_prejump_parallel_live_budget_regression_acceptance.mjs

  log "verify: parallel indexed equivalence smoke"
  node tools/smoke_prejump_parallel_indexed_equivalence.mjs

  log "verify: parallel startup progress emission smoke"
  node tools/smoke_prejump_parallel_startup_progress_emission.mjs

  log "verify: parallel active chunk telemetry smoke"
  node tools/smoke_prejump_parallel_active_chunk_telemetry.mjs

  log "verify: first-wave exact yield diagnostics smoke"
  node tools/smoke_prejump_first_wave_exact_yield_diagnostics.mjs

  log "verify: parallel stage1 exact-probe collapse smoke"
  node tools/smoke_prejump_parallel_stage1_exact_probe_collapse.mjs

  log "verify: parallel prelaunch probe reuse accounting smoke"
  node tools/smoke_prejump_parallel_prelaunch_probe_reuse_accounting.mjs

  log "verify: persistent worker slot smoke"
  node tools/smoke_prejump_parallel_persistent_worker_slots.mjs

  log "verify: integrated persistent-slot request/grant smoke"
  node tools/smoke_prejump_parallel_slot_request_grant_integrated.mjs

  log "verify: positive top-up persistent-slot smoke"
  node tools/smoke_prejump_parallel_slot_positive_topup_commit.mjs
else
  warn "skip server-only parallel indexed smokes outside server workspace"
fi

log "verify: shell syntax check"
while IFS= read -r file; do
  bash -n "$file"
  echo "ok: $file"
done < <(
  {
    [[ -d scripts ]] && find scripts -type f -name '*.sh'
    [[ -d tools ]] && find tools -type f -name '*.sh'
    [[ -d meta ]] && find meta -type f -name '*.sh'
  } | sort -u
)

if [[ -f tools/check_golden_regression_fixture.sh ]]; then
  log "verify: golden regression fixture"
  bash tools/check_golden_regression_fixture.sh
else
  warn "skip golden regression fixture"
fi

if [[ -f tools/check_policy_contracts.sh ]]; then
  log "verify: policy contracts"
  bash tools/check_policy_contracts.sh --config=config/lab.config.server.lite.json
else
  warn "skip policy contracts"
fi

if [[ -f tools/check_prototype_server_only.sh ]]; then
  log "verify: prototype server-only guard"
  bash tools/check_prototype_server_only.sh
else
  warn "skip prototype server-only guard"
fi

if [[ -f tools/enforce_strict_mode.sh ]]; then
  log "verify: strict mode"
  bash tools/enforce_strict_mode.sh
else
  warn "skip strict mode"
fi

log "verify: doctor"
node src/cli.mjs doctor --config=config/lab.config.server.lite.json

log "verify complete"

log "verify: TP12 touch parent-lift report build syntax"
node --check tools/build_stepb_1d_tp12_touch_parent_lift_report.mjs

log "verify: TP12 touch parent-lift wrapper syntax"
bash -n tools/server_run_stepb_1d_tp12_touch_parent_lift_low_gap_top_200k.sh

log "verify: TP12 touch parent-lift report smoke"
node tools/smoke_stepb_1d_tp12_touch_parent_lift_report.mjs

log "verify: TP12 side-daily feature dataset build syntax"
node --check tools/build_tp12_side_daily_feature_dataset.mjs

log "verify: TP12 side-daily feature dataset wrapper syntax"
bash -n tools/server_run_tp12_side_daily_feature_dataset.sh

log "verify: TP12 side-daily feature dataset smoke"
node tools/smoke_tp12_side_daily_feature_dataset.mjs

log "verify: TP12 side-daily feature bridge build syntax"
node --check tools/build_tp12_side_daily_feature_pack_bridge.mjs

log "verify: TP12 side-daily feature bridge wrapper syntax"
bash -n tools/server_run_tp12_side_daily_feature_pack_bridge.sh

log "verify: TP12 side-daily feature bridge smoke"
node tools/smoke_tp12_side_daily_feature_bridge.mjs

log "verify: TP12 side-daily control build syntax"
node --check tools/build_tp12_side_daily_control.mjs

log "verify: TP12 side-daily control wrapper syntax"
bash -n tools/run_tp12_side_daily_control.sh
bash -n tools/server_run_tp12_side_daily_control.sh

log "verify: TP12 side-daily control smoke"
node tools/smoke_tp12_side_daily_control.mjs
node tools/smoke_tp12_side_daily_contract.mjs

log "verify: TP12 side-daily family variant smoke"
node tools/smoke_tp12_side_daily_family_variants.mjs

log "verify: TP12 side-daily scientific selection manifest wrapper syntax"
bash -n tools/run_tp12_side_daily_scientific_selection_manifest.sh
bash -n tools/server_run_tp12_side_daily_scientific_selection_manifest.sh

log "verify: TP12 side-daily scientific selection manifest smoke"
node tools/smoke_tp12_side_daily_scientific_selection_manifest.mjs

log "verify: TP12 side-daily scientific comparison report wrapper syntax"
bash -n tools/run_tp12_side_daily_scientific_comparison_report.sh
bash -n tools/server_run_tp12_side_daily_scientific_comparison_report.sh

log "verify: TP12 side-daily scientific comparison report smoke"
node tools/smoke_tp12_side_daily_scientific_comparison_report.mjs

log "verify: TP12 side-daily execution-learning bundle build syntax"
node --check tools/build_tp12_side_daily_execution_learning_bundle.mjs

log "verify: TP12 side-daily execution-learning bundle wrapper syntax"
bash -n tools/run_tp12_side_daily_execution_learning_bundle.sh
bash -n tools/server_run_tp12_side_daily_execution_learning_bundle.sh

log "verify: TP12 side-daily execution-learning bundle smoke"
node tools/smoke_tp12_side_daily_execution_learning_bundle.mjs

log "verify: TP12 execution-learning fixed-support report syntax"
node --check tools/build_tp12_execution_learning_fixed_support_report.mjs

log "verify: TP12 execution-learning fixed-support wrapper syntax"
bash -n tools/run_tp12_execution_learning_fixed_support.sh
bash -n tools/server_run_tp12_execution_learning_fixed_support.sh

log "verify: TP12 execution-learning fixed-support report smoke"
node tools/smoke_tp12_execution_learning_fixed_support_report.mjs

log "verify: TP12 year2hit overlay control syntax"
node --check tools/build_tp12_year2hit_gate_summary.mjs

log "verify: TP12 year2hit overlay control wrapper syntax"
bash -n tools/run_tp12_year2hit_scientific_overlay_pipeline.sh

log "verify: TP12 year2hit overlay control smoke"
node tools/smoke_tp12_year2hit_overlay_control.mjs

log "verify: TP12 side-daily scientific post-rerun wrapper syntax"
bash -n tools/run_tp12_side_daily_scientific_post_rerun.sh
bash -n tools/server_run_tp12_side_daily_scientific_post_rerun.sh

log "verify: TP12 side-daily control-input pack build syntax"
node --check tools/build_tp12_side_daily_control_input_pack.mjs

log "verify: TP12 side-daily control-input pack wrapper syntax"
bash -n tools/run_tp12_side_daily_control_inputs.sh
bash -n tools/server_run_tp12_side_daily_control_inputs.sh

log "verify: TP12 side-daily control-input pack smoke"
node tools/smoke_tp12_side_daily_control_input_pack.mjs

log "verify: TP12 side-daily downstream full-period pack build syntax"
node --check tools/build_tp12_side_daily_downstream_full_period_pack.mjs

log "verify: TP12 side-daily downstream full-period pack wrapper syntax"
bash -n tools/run_tp12_side_daily_downstream_full_period_pack.sh
bash -n tools/server_run_tp12_side_daily_downstream_full_period_pack.sh

log "verify: TP12 side-daily downstream full-period pack smoke"
node tools/smoke_tp12_side_daily_downstream_full_period_pack.mjs

log "verify: TP12 side-daily full-period allowlist wrapper syntax"
bash -n tools/run_tp12_side_daily_full_period_allowlist.sh
bash -n tools/server_run_tp12_side_daily_full_period_allowlist.sh

log "verify: TP12 side-daily full-period manifest build syntax"
node --check tools/build_tp12_side_daily_full_period_manifest.mjs

log "verify: TP12 side-daily full-period manifest wrapper syntax"
bash -n tools/run_tp12_side_daily_full_period_manifest.sh
bash -n tools/server_run_tp12_side_daily_full_period_manifest.sh

log "verify: TP12 side-daily full-period manifest smoke"
node tools/smoke_tp12_side_daily_full_period_manifest.mjs

log "verify: TP12 side-daily pipeline wrapper syntax"
bash -n tools/server_run_kiwoom_tp12_side_daily_pipeline.sh

log "verify: TP12 side-daily scientific control pipeline wrapper syntax"
bash -n tools/run_tp12_side_daily_scientific_control_pipeline.sh
bash -n tools/server_run_tp12_side_daily_scientific_control_pipeline.sh

log "verify: TP12 year2hit precision-first daily-only syntax"
node --check src/lib/tp12_precision_first_contract_assert.mjs
node --check src/lib/tp12_precision_first_feature_whitelist.mjs
node --check src/lib/tp12_year2hit_precision_first_daily_only.mjs
node --check tools/assert_tp12_precision_first_daily_only_contract.mjs
node --check tools/run_tp12_year2hit_precision_first_daily_only.mjs

log "verify: TP12 year2hit precision-first daily-only wrapper syntax"
bash -n tools/server_run_tp12_year2hit_precision_first_daily_only.sh

log "verify: TP12 year2hit precision-first daily-only smoke"
node tools/smoke_tp12_precision_first_contract.mjs
node tools/smoke_tp12_precision_first_feature_whitelist.mjs
node tools/smoke_tp12_precision_first_rule_grid.mjs
node tools/smoke_tp12_precision_first_oos_lock.mjs

log "verify: TP12 year2hit zero-FP micro-split syntax"
node --check tools/replay_tp12_zero_fp_rules_full_train.mjs
node --check tools/build_tp12_year2hit_zero_fp_micro_split.mjs
node --check tools/build_tp12_executable_consensus_rows.mjs
node --check tools/replay_tp12_micro_split_covers_executable.mjs
node --check tools/audit_tp12_executable_global_greedy_stability.mjs
node --check tools/audit_tp12_executable_zero_fp_tile_pool.mjs

log "verify: TP12 year2hit zero-FP micro-split wrapper syntax"
bash -n tools/run_tp12_year2hit_zero_fp_micro_split.sh
bash -n tools/server_run_tp12_year2hit_zero_fp_micro_split.sh
bash -n tools/run_tp12_year2hit_executable_nested_micro_split.sh
bash -n tools/server_run_tp12_year2hit_executable_nested_micro_split.sh
bash -n tools/run_tp12_year2hit_executable_nested_micro_split_oos_replay.sh
bash -n tools/server_run_tp12_year2hit_executable_nested_micro_split_oos_replay.sh
bash -n tools/run_tp12_year2hit_executable_global_zero_fp_cover.sh
bash -n tools/server_run_tp12_year2hit_executable_global_zero_fp_cover.sh
bash -n tools/run_tp12_year2hit_executable_global_zero_fp_cover_oos_replay.sh
bash -n tools/server_run_tp12_year2hit_executable_global_zero_fp_cover_oos_replay.sh
bash -n tools/run_tp12_year2hit_executable_global_zero_fp_greedy_cover.sh
bash -n tools/server_run_tp12_year2hit_executable_global_zero_fp_greedy_cover.sh
bash -n tools/run_tp12_year2hit_executable_global_zero_fp_greedy_cover_oos_replay.sh
bash -n tools/server_run_tp12_year2hit_executable_global_zero_fp_greedy_cover_oos_replay.sh
bash -n tools/run_tp12_year2hit_executable_global_greedy_stability_audit.sh
bash -n tools/server_run_tp12_year2hit_executable_global_greedy_stability_audit.sh
bash -n tools/run_tp12_year2hit_executable_global_greedy_stability_gated_cover.sh
bash -n tools/server_run_tp12_year2hit_executable_global_greedy_stability_gated_cover.sh
bash -n tools/run_tp12_year2hit_executable_zero_fp_tile_pool_audit.sh
bash -n tools/server_run_tp12_year2hit_executable_zero_fp_tile_pool_audit.sh

log "verify: TP12 year2hit zero-FP micro-split smoke"
node tools/smoke_tp12_year2hit_zero_fp_micro_split.mjs
node tools/smoke_tp12_executable_nested_micro_split.mjs
node tools/smoke_tp12_executable_global_zero_fp_cover.mjs
node tools/smoke_tp12_executable_global_greedy_stability_audit.mjs
node tools/smoke_tp12_executable_zero_fp_tile_pool_audit.mjs

log "verify: TP12 train100 year2hit existence certificate syntax"
node --check src/lib/tp12_train100_existence_certificate.mjs
node --check src/lib/tp12_train100_unsat_completion_common.mjs
node --check src/lib/tp12_train100_frontier_normalizer.mjs
node --check src/lib/tp12_train100_dominance_pruner.mjs
node --check src/lib/tp12_train100_unsat_bounds.mjs
node --check src/lib/tp12_train100_partitioned_completion.mjs
node --check src/lib/tp12_train100_survivor_verifier.mjs
node --check src/lib/tp12_train100_unsat_completion_certificate.mjs
node --check src/lib/tp12_train100_neutral_search_guards.mjs
node --check src/lib/tp12_train100_neutral_feature_catalog.mjs
node --check src/lib/tp12_train100_neutral_atom_bitsets.mjs
node --check src/lib/tp12_train100_neutral_anchor_generator.mjs
node --check src/lib/tp12_train100_neutral_veto_setcover.mjs
node --check src/lib/tp12_train100_neutral_anchor_veto_miner.mjs
node --check src/lib/tp12_train100_neutral_exact_verifier.mjs
node --check src/lib/tp12_train100_neutral_certificate_writer.mjs
node --check src/lib/tp12_train100_positive_motif_common.mjs
node --check src/lib/tp12_positive_motif_contract_assert.mjs
node --check src/lib/tp12_train_label_universe_builder.mjs
node --check src/lib/tp12_pre_hit_chart_snapshot_builder.mjs
node --check src/lib/tp12_symbolic_motif_feature_builder.mjs
node --check src/lib/tp12_symbolic_motif_catalog.mjs
node --check src/lib/tp12_positive_motif_miner.mjs
node --check src/lib/tp12_motif_negative_control_builder.mjs
node --check src/lib/tp12_motif_anchor_full_negative_verifier.mjs
node --check src/lib/tp12_motif_false_positive_contrast.mjs
node --check src/lib/tp12_positive_motif_conditional_veto_setcover.mjs
node --check src/lib/tp12_train100_positive_motif_exact_verifier.mjs
node --check src/lib/tp12_train100_positive_motif_certificate_writer.mjs
node --check tools/build_tp12_train100_existence_certificate.mjs
node --check tools/normalize_tp12_train100_frontier.mjs
node --check tools/prune_tp12_train100_frontier_dominance.mjs
node --check tools/apply_tp12_train100_unsat_bounds.mjs
node --check tools/build_tp12_train100_partitioned_completion_plan.mjs
node --check tools/build_tp12_train100_partition_completion_status.mjs
node --check tools/verify_tp12_train100_survivor_catalog.mjs
node --check tools/build_tp12_train100_unsat_completion_certificate.mjs
node --check tools/build_tp12_train100_neutral_feature_catalog.mjs
node --check tools/build_tp12_train100_neutral_atom_bitsets.mjs
node --check tools/generate_tp12_train100_neutral_anchors.mjs
node --check tools/mine_tp12_train100_neutral_anchor_veto_patterns.mjs
node --check tools/verify_tp12_train100_neutral_survivors.mjs
node --check tools/write_tp12_train100_neutral_certificates.mjs
node --check tools/assert_tp12_positive_motif_contract.mjs
node --check tools/build_tp12_train_label_universe.mjs
node --check tools/build_tp12_pre_hit_chart_snapshots.mjs
node --check tools/build_tp12_symbolic_motif_features.mjs
node --check tools/build_tp12_symbolic_motif_catalog.mjs
node --check tools/mine_tp12_positive_motifs.mjs
node --check tools/build_tp12_motif_negative_controls.mjs
node --check tools/verify_tp12_motif_anchors_against_full_train.mjs
node --check tools/analyze_tp12_motif_false_positive_contrast.mjs
node --check tools/mine_tp12_positive_motif_conditional_veto.mjs
node --check tools/verify_tp12_train100_positive_motif_survivors.mjs
node --check tools/write_tp12_train100_positive_motif_certificates.mjs

log "verify: TP12 train100 year2hit existence certificate wrapper syntax"
bash -n tools/server_build_tp12_train100_existence_certificate.sh
bash -n tools/server_run_tp12_train100_unsat_completion_certificate.sh

log "verify: TP12 train100 year2hit existence certificate smoke"
node tools/smoke_tp12_train100_existence_certificate.mjs
node tools/smoke_tp12_train100_unsat_completion_certificate.mjs
node tools/smoke_tp12_train100_neutral_feature_catalog.mjs
node tools/smoke_tp12_train100_neutral_atom_bitsets.mjs
node tools/smoke_tp12_train100_neutral_anchor_generator.mjs
node tools/smoke_tp12_train100_neutral_veto_setcover.mjs
node tools/smoke_tp12_train100_neutral_exact_verifier.mjs
node tools/smoke_tp12_train100_neutral_certificate_writer.mjs
node tools/smoke_tp12_train100_neutral_no_oos_no_fallback.mjs
node tools/smoke_tp12_positive_motif_contract.mjs
node tools/smoke_tp12_pre_hit_chart_snapshot_builder.mjs
node tools/smoke_tp12_symbolic_motif_feature_builder.mjs
node tools/smoke_tp12_sequence_shapelet_features.mjs
node tools/smoke_tp12_positive_motif_miner.mjs
node tools/smoke_tp12_motif_negative_control_builder.mjs
node tools/smoke_tp12_motif_conditional_veto_setcover.mjs
node tools/smoke_tp12_train100_positive_motif_exact_verifier.mjs
node tools/smoke_tp12_train100_positive_motif_certificate_writer.mjs
node tools/smoke_tp12_positive_motif_no_oos_no_fallback.mjs
