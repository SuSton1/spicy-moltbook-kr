# AGENTS.md (stockdesk-lab-lite)

## Core Rule: No Fallback-Style Development
- Do not introduce fallback-style behavior that changes runtime/performance path compared to the primary design.
- Absolute policy: **Fallback patches are prohibited. Root-cause fixes are mandatory.**
- Never resolve production issues by adding alternate/degraded paths just to keep flow running.
- Forbidden examples:
  - Auto-switching to slower engines because a dependency is missing.
  - Silent degrade paths (`best-effort`, `graceful fallback`, hidden alternate path).
  - Placeholder/dummy substitutions that only "make it pass".

## Mandatory Behavior
- Use fail-fast behavior for missing critical dependencies or invalid runtime conditions.
- Fix root cause directly (install/repair dependency, correct config, repair data contract) instead of adding fallback logic.
- If root cause is not fixed yet, stop and fail clearly. Do not merge temporary fallback behavior.
- Keep execution path deterministic and explicit (no hidden auto engine switching).

## Performance Integrity
- Do not merge changes that reduce performance by introducing alternative degraded code paths.
- If a performance-critical dependency is unavailable, stop with a clear error and remediation message.

## Verification Gate
- Any change must pass `npm run verify` on server.
- If strict checks fail, do not bypass; fix violations and rerun.

## Experiment Continuity
- Before starting any new target-first experiment, run `tools/bootstrap_target_first_session.sh --scope=target_first_v2`.
- Before starting any new experiment, read `meta/active_research_contract.json`, `meta/active_research_handoff.md`, and `meta/experiment_patch_memory.json`.
- Before starting any new experiment, run `tools/check_duplicate_experiment.sh --patch-key=<INTENDED_PATCH_KEY>`.
- Treat `doNotRepeat` as hard-stop history and `recentExperimentLog` as the canonical recent-run ledger.
- Treat `meta/experiment_registry.jsonl` as the append-only experiment log and `meta/experiment_patch_memory.json` as the summary/index.
- If an experiment is completed or reverted, register it in the same turn with `tools/register_experiment_result.sh`.
- Do not run full probe sweeps during target-first exploratory work; stay inside `meta/target_first_probe_shortlist.json` unless there is an explicit reason to expand.
- Perfect prototype heavy jobs are server-only. Do not run `tools/build_perfect_prototype_daily_pack.mjs`, `tools/mine_perfect_prototypes.mjs`, `tools/report_perfect_prototypes_oos.mjs`, `tools/mine_perfect_prototype_parents.mjs`, or `tools/apply_perfect_prototypes.mjs` from `/home/saida/...` or any mounted/local path. Use `tools/run_server_command.sh` or direct `ssh spicy-moltbook 'cd /home/moltook/apps/stockdesk-lab-lite && ...'`.
