import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import { pathExists, readJson, writeJson, writeJsonl } from "../src/lib/io.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

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

const writeExecutable = async (filePath, contents) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, "utf8")
  await fs.chmod(filePath, 0o755)
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daily-ops-state-smoke-"))
try {
  const runId = "smoke_daily_ops_completed_state"
  const registryPath = path.join(tempRoot, "config", "ops", "live_priority_registry.server.json")
  const configPath = path.join(tempRoot, "config", "lab.config.server.lite.stepb_dplus1_plus_lite.json")
  const catalogPath = path.join(tempRoot, "artifacts", "curated", "frozen", "smoke", "catalog.json")
  const dailyStatePath = path.join(tempRoot, "artifacts", "ops", "daily_ops_state", "latest_success.json")
  const liveStatePath = path.join(tempRoot, "artifacts", "ops", "live_priority_state", "latest_success.json")
  const liveActivityPath = path.join(tempRoot, "artifacts", "ops", "live_priority_state", "latest_activity.json")
  const runDir = path.join(tempRoot, "artifacts", "runs", runId)

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
    registryId: "smoke_completed_registry",
    stackId: "smoke_completed_stack",
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
        promotionBasis: "smoke completed subset",
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
    {
      symbol: "000001",
      dateKey: "2026-03-25",
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1000,
    },
  ])
  await writeJsonl(path.join(tempRoot, "data", "universe_daily.jsonl"), [
    {
      symbol: "000001",
      tradingDateKey: "2026-03-25",
    },
  ])

  await writeExecutable(
    path.join(tempRoot, "tools", "run_public_fill_once.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
summary_out=""
for arg in "$@"; do
  case "$arg" in
    --summary-out=*) summary_out="\${arg#*=}" ;;
  esac
done
if [[ -z "$summary_out" ]]; then
  echo "[fatal] summary-out is required" >&2
  exit 2
fi
mkdir -p "$(dirname "$summary_out")"
cat > "$summary_out" <<'JSON'
{
  "status": "completed_with_nontrading_status",
  "latestCandleBefore": "2026-03-24",
  "latestUniverseBefore": "2026-03-24",
  "latestCandleAfter": "2026-03-25",
  "latestUniverseAfter": "2026-03-25",
  "latestWrittenDate": "2026-03-25",
  "validCandleRows": 1,
  "validUniverseRows": 1,
  "nonTradingSymbolCount": 0,
  "nonTradingRowCount": 0,
  "fatalInvalidSymbolCount": 0,
  "fatalInvalidRowCount": 0,
  "auditPaths": {
    "nonTradingStatus": null,
    "fatalInvalid": null
  },
  "failureReason": null
}
JSON
`,
  )

  await writeExecutable(
    path.join(tempRoot, "tools", "server_run_live_priority_stack.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
export STOCKDESK_SERVER_REPO_ROOT="${tempRoot}"
exec node "${path.join(repoRoot, "tools", "server_run_live_priority_stack.mjs")}" "$@"
`,
  )

  await writeExecutable(
    path.join(tempRoot, "tools", "server_stepb_afree_curated_perfect_prototypes_after_close.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
run_id=""
for arg in "$@"; do
  case "$arg" in
    --run-id=*) run_id="\${arg#*=}" ;;
  esac
done
if [[ -z "$run_id" ]]; then
  echo "[fatal] run-id is required" >&2
  exit 2
fi
run_dir="${tempRoot}/artifacts/runs/$run_id"
pack_dir="$run_dir/step-perfect-prototype-open-live-pack"
apply_dir="$run_dir/step-perfect-prototype-open-live-apply"
mkdir -p "$pack_dir" "$apply_dir"
cat > "$pack_dir/summary.json" <<'JSON'
{
  "rowsWritten": 1,
  "uniqueSymbols": 1
}
JSON
printf '%s\n' '{"recommendationDateKey":"2026-03-25","symbol":"000001","name":"SmokeCo","matchedRuleIds":["PP_SMOKE"],"primaryRuleId":"PP_SMOKE"}' > "$apply_dir/deduped_symbols.jsonl"
cat > "$apply_dir/summary.json" <<'JSON'
{
  "rawMatchedRows": 1,
  "rawMatches": 1,
  "dedupedMatches": 1,
  "selectionMode": "union_all",
  "recommendationDateCloseRetFilter": {
    "gtePct": 28,
    "removedRawMatches": 0
  }
}
JSON
printf '%s\n' '{"symbol":"000001"}' > "$pack_dir/daily_pack.jsonl"
`,
  )

  await runNode({
    cwd: tempRoot,
    env: {
      ...process.env,
      STOCKDESK_SERVER_REPO_ROOT: tempRoot,
    },
    args: [
      path.join(repoRoot, "tools", "server_run_daily_ops_stack.mjs"),
      `--run-id=${runId}`,
      `--registry=${registryPath}`,
      `--config=${configPath}`,
    ],
  })

  assert.equal(pathExists(dailyStatePath), true)
  assert.equal(pathExists(liveStatePath), true)
  assert.equal(pathExists(liveActivityPath), true)
  assert.equal(pathExists(path.join(runDir, "daily_ops_summary.json")), true)
  assert.equal(pathExists(path.join(runDir, "live", "final_summary.json")), true)
  assert.equal(pathExists(path.join(runDir, "live", "final_union.jsonl")), true)

  const dailyState = await readJson(dailyStatePath, null)
  const liveState = await readJson(liveStatePath, null)
  const liveActivity = await readJson(liveActivityPath, null)
  const dailySummary = await readJson(path.join(runDir, "daily_ops_summary.json"), null)
  const liveSummary = await readJson(path.join(runDir, "live", "final_summary.json"), null)

  assert.equal(dailyState?.status, "completed")
  assert.equal(dailyState?.lastSuccessfulTargetDate, "2026-03-25")
  assert.equal(dailyState?.lastRunId, runId)
  assert.equal(dailyState?.lastFinalUnionCount, 1)

  assert.equal(liveState?.status, "completed")
  assert.equal(liveState?.lastSuccessfulTargetDate, "2026-03-25")
  assert.equal(liveState?.runId, `${runId}_live`)
  assert.equal(liveState?.finalUnionCount, 1)

  assert.equal(liveActivity?.status, "completed")
  assert.equal(liveActivity?.runId, `${runId}_live`)
  assert.equal(liveActivity?.targetDate, "2026-03-25")

  assert.equal(dailySummary?.status, "completed")
  assert.equal(dailySummary?.targetDate, "2026-03-25")
  assert.equal(dailySummary?.finalUnionCount, 1)
  assert.equal(dailySummary?.live?.status, "completed")

  assert.equal(liveSummary?.status, "completed")
  assert.equal(liveSummary?.targetDate, "2026-03-25")
  assert.equal(liveSummary?.finalUnionCount, 1)

  console.log("ok smoke_daily_ops_completed_state_persistence")
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true })
}
