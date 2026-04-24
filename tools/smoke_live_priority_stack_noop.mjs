import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import { readJson, writeJson, writeJsonl } from "../src/lib/io.mjs"

const runNode = ({ cwd, env, args }) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`node ${args.join(" ")} exited with code ${code}`))
    })
  })

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "live-priority-noop-"))
  const runId = "smoke_live_priority_stack_noop"
  const registryPath = path.join(tempRoot, "config", "ops", "live_priority_registry.server.json")
  const configPath = path.join(tempRoot, "config", "lab.config.server.lite.stepb_dplus1_plus_lite.json")
  const statePath = path.join(tempRoot, "artifacts", "ops", "live_priority_state", "latest_success.json")
  const activityStatePath = path.join(tempRoot, "artifacts", "ops", "live_priority_state", "latest_activity.json")
  const catalogPath = path.join(tempRoot, "artifacts", "curated", "frozen", "noop", "catalog.json")

  await writeJson(configPath, {
    lightweight: {
      stepB: {
        perfectPrototypeBaseline: {
          enabled: true,
        },
      },
    },
  })
  await writeJson(catalogPath, { version: 1, rules: [] })
  await writeJson(registryPath, {
    version: 1,
    registryId: "smoke_noop_registry",
    stackId: "smoke_noop_stack",
    registryRole: "canonical_live_operating_stack",
    contractDocPath: "meta/live_priority_ops_contract.md",
    artifactsDocPath: "meta/live_priority_reusable_artifacts.json",
    targetDateMode: "latest_common_data_date",
    finalUnionPolicy: "priority_first_symbol_dedup",
    recommendationCloseRetFilterGtePct: 28,
    lines: [
      {
        lineId: "afree_primary",
        priority: 1,
        lineOrder: 10,
        enabled: true,
        lineRole: "afree_primary_subset",
        status: "active",
        reportLabel: "A-free Primary",
        promotionBasis: "smoke noop subset",
        runnerType: "afree_stepb_open",
        selectionMode: "union_all",
        excludeRecommendationCloseRetPctGte: 28,
        catalogPath: path.relative(tempRoot, catalogPath),
        expectedCatalogSha256: "a".repeat(64),
        expectedRuleIdsSha256: "b".repeat(64),
        discoveryUniverseId: "afree_open",
      },
    ],
  })
  await writeJsonl(path.join(tempRoot, "data", "candle_daily.jsonl"), [
    { symbol: "000001", dateKey: "2026-03-21" },
    { symbol: "000001", dateKey: "2026-03-23" },
  ])
  await writeJsonl(path.join(tempRoot, "data", "universe_daily.jsonl"), [
    { symbol: "000001", tradingDateKey: "2026-03-23" },
  ])
  await writeJson(statePath, {
    version: 1,
    status: "completed",
    lastSuccessfulTargetDate: "2026-03-23",
  })

  await runNode({
    cwd: tempRoot,
    env: {
      ...process.env,
      STOCKDESK_SERVER_REPO_ROOT: tempRoot,
    },
    args: [
      path.join(path.dirname(new URL(import.meta.url).pathname), "server_run_live_priority_stack.mjs"),
      `--registry=${registryPath}`,
      `--config=${configPath}`,
      `--state-path=${statePath}`,
      `--activity-state-path=${activityStatePath}`,
      `--run-id=${runId}`,
    ],
  })

  const summary = await readJson(path.join(tempRoot, "artifacts", "runs", runId, "final_summary.json"), null)
  const activity = await readJson(activityStatePath, null)
  assert.equal(summary?.status, "noop_already_processed")
  assert.equal(summary?.targetDate, "2026-03-23")
  assert.equal(summary?.stackId, "smoke_noop_stack")
  assert.equal(summary?.registryRole, "canonical_live_operating_stack")
  assert.equal(summary?.targetDateMode, "latest_common_data_date")
  assert.equal(summary?.finalUnionPolicy, "priority_first_symbol_dedup")
  assert.equal(summary?.finalUnionCount, 0)
  assert.equal(activity?.status, "noop_already_processed")
  assert.equal(activity?.targetDate, "2026-03-23")
  assert.equal(activity?.runId, runId)
  assert.equal(activity?.activeLine, null)
  assert.equal(activity?.completedLineCount, 0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
