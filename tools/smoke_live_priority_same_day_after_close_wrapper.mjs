import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"

import { writeJson } from "../src/lib/io.mjs"

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")

const runBash = ({ args, env }) =>
  new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    const child = spawn("bash", args, {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("exit", (code) => {
      resolve({ code, stdout, stderr })
    })
  })

const main = async () => {
  const smokeRoot = await fs.mkdtemp(
    path.join(repoRoot, "artifacts", "curated", "frozen", "smoke_live_priority_wrapper_"),
  )
  const catalogPath = path.join(smokeRoot, "catalog.json")
  const manifestPath = path.join(smokeRoot, "manifest.json")

  await writeJson(catalogPath, {
    version: 1,
    tokenizerSpec: {
      surface: "v3_contextual_plus_lite",
      options: {},
    },
    rules: [
      {
        ruleId: "PP_SMOKE",
        tokens: ["feat.alpha"],
      },
    ],
  })
  await writeJson(manifestPath, {
    surface: "v3_contextual_plus_lite",
    datasetContract: {
      discoveryUniverseId: "same_day_plus_recent_upto_2d",
      requestedLookbackTradingDays: 2,
    },
  })

  const result = await runBash({
    args: [
      path.join(repoRoot, "tools", "server_stepb_plus_lite_curated_after_close.sh"),
      `--catalog=${catalogPath}`,
      `--expected-catalog-sha256=${"a".repeat(64)}`,
      `--expected-rule-ids-sha256=${"b".repeat(64)}`,
      "--date=2026-03-23",
      "--discovery-universe-id=recent_impulse_upto_2d",
      "--recent-impulse-lookback-days=2",
      `--config=${path.join(repoRoot, "config", "lab.config.server.lite.stepb_dplus1_plus_lite.json")}`,
      "--run-id=smoke_same_day_wrapper_invalid_contract",
    ],
    env: {
      ...process.env,
      STOCKDESK_SERVER_REPO_ROOT: repoRoot,
    },
  })

  assert.notEqual(result.code, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /requires same_day_plus_recent discovery universe/)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
