import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import {
  buildDailyOpsSummary,
  DAILY_OPS_STATUS_COMPLETED,
  DAILY_OPS_STATUS_FAILED_FILL,
  DAILY_OPS_STATUS_FAILED_LIVE,
  DAILY_OPS_STATUS_FAILED_RUNTIME,
  DAILY_OPS_STATUS_NOOP_ALREADY_PROCESSED,
  writeDailyOpsArtifacts,
  writeDailyOpsState,
} from "../src/lib/daily_ops_stack.mjs"
import { ensureDir, pathExists, readJson, readJsonl, toRunId } from "../src/lib/io.mjs"
import {
  LIVE_PRIORITY_STATUS_COMPLETED,
  LIVE_PRIORITY_STATUS_NOOP_ALREADY_PROCESSED,
} from "../src/lib/live_priority_ops.mjs"
import { assertPerfectPrototypeServerWorkspace } from "../src/lib/perfect_prototype_server_policy.mjs"

const DEFAULT_DAILY_STATE_PATH = "artifacts/ops/daily_ops_state/latest_success.json"
const DEFAULT_LIVE_STATE_PATH = "artifacts/ops/live_priority_state/latest_success.json"
const DEFAULT_REGISTRY_PATH = "config/ops/live_priority_registry.server.json"
const DEFAULT_CONFIG_PATH = "config/lab.config.server.lite.stepb_dplus1_plus_lite.json"

const runCommand = ({ command, args, cwd }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      resolve({
        code: Number.isInteger(code) ? code : signal ? 1 : 0,
        signal: signal ? String(signal) : null,
      })
    })
  })

const copyIfExists = async (sourcePath, targetPath) => {
  if (!pathExists(sourcePath)) return false
  await ensureDir(path.dirname(targetPath))
  await fs.copyFile(sourcePath, targetPath)
  return true
}

const assertStateFileExists = ({ filePath, label }) => {
  if (!pathExists(filePath)) {
    throw new Error(`${label} missing after successful daily ops run: ${filePath}`)
  }
}

const fillAllowsLive = (fillSummary) =>
  fillSummary &&
  (fillSummary.status === "completed" || fillSummary.status === "completed_with_nontrading_status")

const liveSucceeded = (liveSummary) =>
  liveSummary &&
  (liveSummary.status === LIVE_PRIORITY_STATUS_COMPLETED ||
    liveSummary.status === LIVE_PRIORITY_STATUS_NOOP_ALREADY_PROCESSED)

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const policy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "server_run_daily_ops_stack",
  })
  const runId =
    String(getFlag(parsed.flags, "run-id", "")).trim() || `daily_ops_stack_${toRunId(new Date())}`
  const registryPath = String(getFlag(parsed.flags, "registry", DEFAULT_REGISTRY_PATH)).trim() || DEFAULT_REGISTRY_PATH
  const configPath = String(getFlag(parsed.flags, "config", DEFAULT_CONFIG_PATH)).trim() || DEFAULT_CONFIG_PATH
  const liveStatePath =
    String(getFlag(parsed.flags, "live-state-path", DEFAULT_LIVE_STATE_PATH)).trim() || DEFAULT_LIVE_STATE_PATH
  const dailyStatePath =
    String(getFlag(parsed.flags, "daily-state-path", DEFAULT_DAILY_STATE_PATH)).trim() || DEFAULT_DAILY_STATE_PATH

  const runDir = path.join(policy.repoRoot, "artifacts", "runs", runId)
  const fillDir = path.join(runDir, "fill")
  const liveDir = path.join(runDir, "live")
  const fillSummaryPath = path.join(fillDir, "fill_summary.json")
  const liveSummaryPath = path.join(liveDir, "final_summary.json")
  const liveFinalUnionPath = path.join(liveDir, "final_union.jsonl")
  const fillRunId = `${runId}_fill`
  const liveRunId = `${runId}_live`
  const liveRunDir = path.join(policy.repoRoot, "artifacts", "runs", liveRunId)
  const resolvedDailyStatePath = path.resolve(policy.repoRoot, dailyStatePath)
  const resolvedLiveStatePath = path.resolve(policy.repoRoot, liveStatePath)

  await ensureDir(fillDir)
  await ensureDir(liveDir)

  let fillResult = null
  let liveResult = null
  let finalUnionRows = []

  const persistSummary = async ({ status, failureReason = null }) => {
    const summary = buildDailyOpsSummary({
      status,
      runId,
      targetDate: liveResult?.summary?.targetDate ?? fillResult?.summary?.latestWrittenDate ?? null,
      fill: fillResult,
      live: liveResult,
      failureReason,
      finalUnionRows,
      fillSummaryPath,
      liveSummaryPath,
      liveFinalUnionPath,
      dailyStatePath,
    })
    await writeDailyOpsArtifacts({
      outDir: runDir,
      summary,
      fillSummary: fillResult?.summary ?? null,
      liveSummary: liveResult?.summary ?? null,
      finalUnionRows,
    })
    if (status === DAILY_OPS_STATUS_COMPLETED) {
      assertStateFileExists({
        filePath: resolvedLiveStatePath,
        label: "live priority success state",
      })
      await writeDailyOpsState({
        statePath: resolvedDailyStatePath,
        summary,
      })
      assertStateFileExists({
        filePath: resolvedDailyStatePath,
        label: "daily ops success state",
      })
    }
    return summary
  }

  try {
    const fillOutcome = await runCommand({
      command: "bash",
      args: [
        "tools/run_public_fill_once.sh",
        `--run-id=${fillRunId}`,
        `--summary-out=${fillSummaryPath}`,
      ],
      cwd: policy.repoRoot,
    })
    if (!pathExists(fillSummaryPath)) {
      throw new Error(`fill summary missing after public fill run: ${fillSummaryPath}`)
    }
    const fillSummary = await readJson(fillSummaryPath, null)
    fillResult = {
      runId: fillRunId,
      exitCode: fillOutcome.code,
      summary: fillSummary,
    }
    if (!fillAllowsLive(fillSummary) || fillOutcome.code !== 0) {
      const failureReason =
        fillSummary?.failureReason ??
        (fillOutcome.code !== 0 && fillAllowsLive(fillSummary)
          ? `public_fill_verify_failed_exit_${fillOutcome.code}`
          : `public_fill_failed_exit_${fillOutcome.code}`)
      await persistSummary({
        status: DAILY_OPS_STATUS_FAILED_FILL,
        failureReason,
      })
      throw new Error(`daily ops stopped at fill stage: ${failureReason}`)
    }

    const liveOutcome = await runCommand({
      command: "bash",
      args: [
        "tools/server_run_live_priority_stack.sh",
        `--run-id=${liveRunId}`,
        `--registry=${registryPath}`,
        `--config=${configPath}`,
        `--state-path=${liveStatePath}`,
      ],
      cwd: policy.repoRoot,
    })

    const liveSourceSummaryPath = path.join(liveRunDir, "final_summary.json")
    const liveSourceFinalUnionPath = path.join(liveRunDir, "final_union.jsonl")
    const liveSourceReportPath = path.join(liveRunDir, "report.md")
    const liveSourceLineManifestPath = path.join(liveRunDir, "line_results_manifest.json")
    const liveSourceRegistrySnapshotPath = path.join(liveRunDir, "registry_snapshot.json")
    if (!pathExists(liveSourceSummaryPath) || !pathExists(liveSourceFinalUnionPath)) {
      throw new Error(`live priority run missing required artifacts under ${liveRunDir}`)
    }

    await copyIfExists(liveSourceSummaryPath, liveSummaryPath)
    await copyIfExists(liveSourceFinalUnionPath, liveFinalUnionPath)
    await copyIfExists(liveSourceReportPath, path.join(liveDir, "report.md"))
    await copyIfExists(liveSourceLineManifestPath, path.join(liveDir, "line_results_manifest.json"))
    await copyIfExists(liveSourceRegistrySnapshotPath, path.join(liveDir, "registry_snapshot.json"))

    const liveSummary = await readJson(liveSummaryPath, null)
    finalUnionRows = await readJsonl(liveFinalUnionPath)
    liveResult = {
      runId: liveRunId,
      exitCode: liveOutcome.code,
      summary: liveSummary,
    }

    if (!liveSucceeded(liveSummary) || liveOutcome.code !== 0) {
      const failureReason =
        liveSummary?.failureReason ??
        (liveOutcome.code !== 0 ? `live_priority_stack_failed_exit_${liveOutcome.code}` : "live_priority_stack_failed")
      await persistSummary({
        status: DAILY_OPS_STATUS_FAILED_LIVE,
        failureReason,
      })
      throw new Error(`daily ops stopped at live stage: ${failureReason}`)
    }

    const status =
      liveSummary.status === LIVE_PRIORITY_STATUS_NOOP_ALREADY_PROCESSED
        ? DAILY_OPS_STATUS_NOOP_ALREADY_PROCESSED
        : DAILY_OPS_STATUS_COMPLETED
    await persistSummary({
      status,
    })
  } catch (error) {
    if (!pathExists(path.join(runDir, "daily_ops_summary.json"))) {
      await persistSummary({
        status: DAILY_OPS_STATUS_FAILED_RUNTIME,
        failureReason: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  }
}

await main()
