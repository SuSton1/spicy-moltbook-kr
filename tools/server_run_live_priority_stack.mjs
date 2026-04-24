import { spawn } from "node:child_process"
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, pathExists, writeJson } from "../src/lib/io.mjs"
import {
  LIVE_PRIORITY_FINAL_UNION_POLICY,
  LIVE_PRIORITY_LINE_RESULTS_MANIFEST_VERSION,
  LIVE_PRIORITY_RUNNER_AFREE_STEPB_OPEN,
  LIVE_PRIORITY_RUNNER_PLUS_LITE_RECENT_MID_LOW,
  LIVE_PRIORITY_RUNNER_PLUS_LITE_SAME_DAY_RECENT,
  LIVE_PRIORITY_RUNNER_PLUS_LITE_SAME_DAY_RECENT_LANE_LOCAL,
  LIVE_PRIORITY_STATUS_COMPLETED,
  LIVE_PRIORITY_STATUS_RUNNING,
  LIVE_PRIORITY_STATUS_FAILED_LINE_ERROR,
  LIVE_PRIORITY_STATUS_FAILED_STALE_DATA,
  LIVE_PRIORITY_STATUS_NOOP_ALREADY_PROCESSED,
  buildLivePriorityActivityPayload,
  buildLivePrioritySummary,
  computeLivePriorityDataSnapshot,
  loadLivePriorityRegistry,
  loadLivePriorityState,
  mergeLivePriorityLineResults,
  summarizeLivePriorityLineResult,
  writeLivePriorityActivityState,
  writeLivePriorityArtifacts,
  writeLivePriorityState,
} from "../src/lib/live_priority_ops.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"
import { toRunId } from "../src/lib/io.mjs"

const DEFAULT_REGISTRY_PATH = "config/ops/live_priority_registry.server.json"
const DEFAULT_CONFIG_PATH = "config/lab.config.server.lite.stepb_dplus1_plus_lite.json"
const DEFAULT_STATE_PATH = "artifacts/ops/live_priority_state/latest_success.json"
const DEFAULT_ACTIVITY_STATE_PATH = "artifacts/ops/live_priority_state/latest_activity.json"

const runCommand = ({ command, args, cwd }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`))
    })
  })

const assertStateFileExists = ({ filePath, label }) => {
  if (!pathExists(filePath)) {
    throw new Error(`${label} missing after successful live priority stack run: ${filePath}`)
  }
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const policy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "server_run_live_priority_stack",
  })

  const registry = await loadLivePriorityRegistry({
    registryPath: String(getFlag(parsed.flags, "registry", DEFAULT_REGISTRY_PATH)).trim() || DEFAULT_REGISTRY_PATH,
    cwd,
    toolName: "server_run_live_priority_stack",
  })
  const configPath = path.resolve(String(getFlag(parsed.flags, "config", DEFAULT_CONFIG_PATH)).trim() || DEFAULT_CONFIG_PATH)
  const statePath = path.resolve(String(getFlag(parsed.flags, "state-path", DEFAULT_STATE_PATH)).trim() || DEFAULT_STATE_PATH)
  const activityStatePath = path.resolve(
    String(getFlag(parsed.flags, "activity-state-path", DEFAULT_ACTIVITY_STATE_PATH)).trim() || DEFAULT_ACTIVITY_STATE_PATH,
  )
  const runId =
    String(getFlag(parsed.flags, "run-id", "")).trim() || `live_priority_stack_${toRunId(new Date())}`
  const runDir = path.join(policy.repoRoot, "artifacts", "runs", runId)

  assertPerfectPrototypeServerPaths({
        entries: [
          { label: "configPath", filePath: configPath },
          { label: "statePath", filePath: statePath },
          { label: "activityStatePath", filePath: activityStatePath },
          { label: "runDir", filePath: runDir },
        ],
    policy,
    toolName: "server_run_live_priority_stack",
  })
  if (!pathExists(configPath)) {
    throw new Error(`config not found: ${configPath}`)
  }

  await ensureDir(runDir)

  const dataSnapshot = await computeLivePriorityDataSnapshot({ policy })
  const previousState = await loadLivePriorityState(statePath)
  const lastSuccessfulTargetDate = String(previousState?.lastSuccessfulTargetDate ?? "").trim() || null
  const registrySnapshot = {
    version: registry?.raw?.version ?? 1,
    registryId: registry.registryId,
    stackId: registry.stackId,
    registryRole: registry.registryRole,
    registryPath: registry.registryPath,
    registrySha256: registry.registrySha256,
    contractDocPath: registry.contractDocPath,
    artifactsDocPath: registry.artifactsDocPath,
    targetDateMode: registry.targetDateMode,
    finalUnionPolicy: LIVE_PRIORITY_FINAL_UNION_POLICY,
    recommendationCloseRetFilterGtePct: registry.recommendationCloseRetFilterGtePct,
    lines: registry.lines,
  }
  const accumulatedLineResults = []
  const completedLineIds = []

  const writeActivityArtifacts = async ({
    status = LIVE_PRIORITY_STATUS_RUNNING,
    targetDate = null,
    activeLine = null,
    failureReason = null,
  } = {}) => {
    const payload = buildLivePriorityActivityPayload({
      status,
      runId,
      targetDate,
      dataSnapshot,
      registry,
      lastSuccessfulTargetDate,
      activeLine,
      completedLineIds,
      lineResults: accumulatedLineResults,
      failureReason,
    })
    await writeLivePriorityActivityState({
      activityStatePath,
      payload,
    })
    return payload
  }

  const writeTerminalArtifacts = async ({
    status,
    targetDate = null,
    lineResults = [],
    priorityCounts = { priority1: 0, priority2: 0, priority3: 0 },
    finalUnionRows = [],
    failureReason = null,
    lineFailure = null,
    lineResultsManifest = null,
  }) => {
    const summary = buildLivePrioritySummary({
      status,
      runId,
      targetDate,
      dataSnapshot,
      registry,
      lastSuccessfulTargetDate,
      lineResults,
      priorityCounts,
      finalUnionCount: finalUnionRows.length,
      failureReason,
      lineFailure,
    })
    await writeLivePriorityArtifacts({
      outDir: runDir,
      summary,
      finalUnionRows,
      lineResultsManifest,
      registrySnapshot,
    })
    return summary
  }

  if (!dataSnapshot.candleLatestDate || !dataSnapshot.universeLatestDate) {
    await writeActivityArtifacts({
      status: LIVE_PRIORITY_STATUS_FAILED_STALE_DATA,
      targetDate: dataSnapshot.latestCommonDate,
      failureReason: "missing_latest_data_date",
    })
    await writeTerminalArtifacts({
      status: LIVE_PRIORITY_STATUS_FAILED_STALE_DATA,
      failureReason: "missing_latest_data_date",
    })
    throw new Error(
      `live priority stack requires candle/universe latest dates; candle=${dataSnapshot.candleLatestDate ?? "null"} universe=${dataSnapshot.universeLatestDate ?? "null"}`,
    )
  }

  if (dataSnapshot.isSynchronized !== true || !dataSnapshot.latestCommonDate) {
    await writeActivityArtifacts({
      status: LIVE_PRIORITY_STATUS_FAILED_STALE_DATA,
      targetDate: dataSnapshot.latestCommonDate,
      failureReason: "candle_universe_latest_date_mismatch",
    })
    await writeTerminalArtifacts({
      status: LIVE_PRIORITY_STATUS_FAILED_STALE_DATA,
      failureReason: "candle_universe_latest_date_mismatch",
    })
    throw new Error(
      `live priority stack requires synchronized candle/universe latest dates; candle=${dataSnapshot.candleLatestDate} universe=${dataSnapshot.universeLatestDate}`,
    )
  }

  if (lastSuccessfulTargetDate && dataSnapshot.latestCommonDate < lastSuccessfulTargetDate) {
    await writeActivityArtifacts({
      status: LIVE_PRIORITY_STATUS_FAILED_STALE_DATA,
      targetDate: dataSnapshot.latestCommonDate,
      failureReason: "latest_common_date_moved_backwards",
    })
    await writeTerminalArtifacts({
      status: LIVE_PRIORITY_STATUS_FAILED_STALE_DATA,
      targetDate: dataSnapshot.latestCommonDate,
      failureReason: "latest_common_date_moved_backwards",
    })
    throw new Error(
      `latest common data date moved backwards: latest=${dataSnapshot.latestCommonDate} lastSuccessful=${lastSuccessfulTargetDate}`,
    )
  }

  if (lastSuccessfulTargetDate && dataSnapshot.latestCommonDate === lastSuccessfulTargetDate) {
    await writeActivityArtifacts({
      status: LIVE_PRIORITY_STATUS_NOOP_ALREADY_PROCESSED,
      targetDate: dataSnapshot.latestCommonDate,
    })
    await writeTerminalArtifacts({
      status: LIVE_PRIORITY_STATUS_NOOP_ALREADY_PROCESSED,
      targetDate: dataSnapshot.latestCommonDate,
    })
    assertStateFileExists({
      filePath: statePath,
      label: "live priority success state",
    })
    assertStateFileExists({
      filePath: activityStatePath,
      label: "live priority activity state",
    })
    return
  }

  const targetDate = dataSnapshot.latestCommonDate
  let currentLine = null
  const lineResultsManifest = {
    version: LIVE_PRIORITY_LINE_RESULTS_MANIFEST_VERSION,
    runId,
    targetDate,
    candleLatestDate: dataSnapshot.candleLatestDate,
    universeLatestDate: dataSnapshot.universeLatestDate,
    latestCommonDate: dataSnapshot.latestCommonDate,
    lastSuccessfulTargetDate,
    registryId: registry.registryId,
    stackId: registry.stackId,
    registryRole: registry.registryRole,
    registryPath: registry.registryPath,
    registrySha256: registry.registrySha256,
    contractDocPath: registry.contractDocPath,
    artifactsDocPath: registry.artifactsDocPath,
    targetDateMode: registry.targetDateMode,
    finalUnionPolicy: registry.finalUnionPolicy,
    recommendationCloseRetFilterGtePct: registry.recommendationCloseRetFilterGtePct,
    lines: [],
  }

  try {
    await writeActivityArtifacts({
      status: LIVE_PRIORITY_STATUS_RUNNING,
      targetDate,
    })
    for (const line of registry.enabledLines) {
      currentLine = line
      const lineRunId = `${runId}_${line.lineId}`
      await writeActivityArtifacts({
        status: LIVE_PRIORITY_STATUS_RUNNING,
        targetDate,
        activeLine: {
          lineId: line.lineId,
          priority: line.priority,
          lineOrder: line.lineOrder,
          runId: lineRunId,
        },
      })
      const scriptPath =
        line.runnerType === LIVE_PRIORITY_RUNNER_AFREE_STEPB_OPEN
          ? path.join(policy.repoRoot, "tools", "server_stepb_afree_curated_perfect_prototypes_after_close.sh")
          : line.runnerType === LIVE_PRIORITY_RUNNER_PLUS_LITE_RECENT_MID_LOW
            ? path.join(policy.repoRoot, "tools", "server_stepb_plus_lite_curated_after_close_recent_mid_low.sh")
          : line.runnerType === LIVE_PRIORITY_RUNNER_PLUS_LITE_SAME_DAY_RECENT_LANE_LOCAL
            ? path.join(policy.repoRoot, "tools", "server_stepb_plus_lite_curated_after_close_lane_local.sh")
            : path.join(policy.repoRoot, "tools", "server_stepb_plus_lite_curated_after_close.sh")
      const args = [
        scriptPath,
        `--date=${targetDate}`,
        `--config=${configPath}`,
        `--catalog=${line.catalogPath}`,
        `--expected-catalog-sha256=${line.expectedCatalogSha256}`,
        `--expected-rule-ids-sha256=${line.expectedRuleIdsSha256}`,
        `--exclude-recommendation-close-ret-pct-gte=${line.excludeRecommendationCloseRetPctGte}`,
        `--run-id=${lineRunId}`,
      ]
      if (
        line.runnerType === LIVE_PRIORITY_RUNNER_PLUS_LITE_SAME_DAY_RECENT ||
        line.runnerType === LIVE_PRIORITY_RUNNER_PLUS_LITE_SAME_DAY_RECENT_LANE_LOCAL ||
        line.runnerType === LIVE_PRIORITY_RUNNER_PLUS_LITE_RECENT_MID_LOW
      ) {
        args.push(
          `--discovery-universe-id=${line.discoveryUniverseId}`,
          `--recent-impulse-lookback-days=${line.lookbackTradingDays}`,
        )
      }
      await runCommand({
        command: "bash",
        args,
        cwd: policy.repoRoot,
      })

      const lineRunDir = path.join(policy.repoRoot, "artifacts", "runs", lineRunId)
      const packSummaryPath = path.join(lineRunDir, "step-perfect-prototype-open-live-pack", "summary.json")
      const applySummaryPath = path.join(lineRunDir, "step-perfect-prototype-open-live-apply", "summary.json")
      const dedupedInputPath = path.join(lineRunDir, "step-perfect-prototype-open-live-apply", "deduped_symbols.jsonl")
      assertPerfectPrototypeServerPaths({
        entries: [
          { label: `${line.lineId}.lineRunDir`, filePath: lineRunDir },
          { label: `${line.lineId}.packSummaryPath`, filePath: packSummaryPath },
          { label: `${line.lineId}.applySummaryPath`, filePath: applySummaryPath },
          { label: `${line.lineId}.dedupedInputPath`, filePath: dedupedInputPath },
        ],
        policy,
        toolName: "server_run_live_priority_stack",
      })
      if (!pathExists(packSummaryPath) || !pathExists(applySummaryPath) || !pathExists(dedupedInputPath)) {
        throw new Error(`line ${line.lineId} missing required output artifacts under ${lineRunDir}`)
      }

      const manifestLine = {
        lineId: line.lineId,
        priority: line.priority,
        lineOrder: line.lineOrder,
        lineRole: line.lineRole,
        status: line.status,
        promotionBasis: line.promotionBasis,
        reportLabel: line.reportLabel,
        runnerType: line.runnerType,
        selectionMode: line.selectionMode,
        excludeRecommendationCloseRetPctGte: line.excludeRecommendationCloseRetPctGte,
        catalogLabel: line.catalogLabel,
        catalogPath: line.catalogPath,
        discoveryUniverseId: line.discoveryUniverseId,
        lookbackTradingDays: line.lookbackTradingDays,
        runId: lineRunId,
        lineRunDir,
        packSummaryPath,
        applySummaryPath,
        dedupedInputPath,
      }
      lineResultsManifest.lines.push(manifestLine)
      accumulatedLineResults.push(await summarizeLivePriorityLineResult(manifestLine))
      completedLineIds.push(line.lineId)
      await writeActivityArtifacts({
        status: LIVE_PRIORITY_STATUS_RUNNING,
        targetDate,
      })
    }
  } catch (error) {
    const lineFailure = currentLine
      ? {
          lineId: currentLine.lineId,
          priority: currentLine.priority,
          runId: currentLine ? `${runId}_${currentLine.lineId}` : null,
        }
      : null
    await writeActivityArtifacts({
      status: LIVE_PRIORITY_STATUS_FAILED_LINE_ERROR,
      targetDate,
      activeLine: lineFailure,
      failureReason: error instanceof Error ? error.message : String(error),
    })
    const summary = await writeTerminalArtifacts({
      status: LIVE_PRIORITY_STATUS_FAILED_LINE_ERROR,
      targetDate,
      lineResults: accumulatedLineResults,
      failureReason: error instanceof Error ? error.message : String(error),
      lineFailure,
      lineResultsManifest,
    })
    console.error(summary)
    throw error
  }

  await writeJson(path.join(runDir, "line_results_manifest.json"), lineResultsManifest)

  try {
    const merged = await mergeLivePriorityLineResults({
      manifest: lineResultsManifest,
    })
    const summary = await writeTerminalArtifacts({
      status: LIVE_PRIORITY_STATUS_COMPLETED,
      targetDate,
      lineResults: merged.lineResults,
      priorityCounts: merged.priorityCounts,
      finalUnionRows: merged.finalUnionRows,
      lineResultsManifest,
    })
    await writeLivePriorityState({
      statePath,
      summary,
    })
    await writeActivityArtifacts({
      status: LIVE_PRIORITY_STATUS_COMPLETED,
      targetDate,
    })
    assertStateFileExists({
      filePath: statePath,
      label: "live priority success state",
    })
    assertStateFileExists({
      filePath: activityStatePath,
      label: "live priority activity state",
    })
  } catch (error) {
    await writeActivityArtifacts({
      status: LIVE_PRIORITY_STATUS_FAILED_LINE_ERROR,
      targetDate,
      failureReason: error instanceof Error ? error.message : String(error),
    })
    await writeTerminalArtifacts({
      status: LIVE_PRIORITY_STATUS_FAILED_LINE_ERROR,
      targetDate,
      lineResults: accumulatedLineResults,
      failureReason: error instanceof Error ? error.message : String(error),
      lineResultsManifest,
    })
    throw error
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
