import path from "node:path"
import process from "node:process"

import { parseCliArgs } from "./lib/args.mjs"
import {
  promoteActiveAbManifest,
  readActiveAbManifest,
  resolveActiveAbBinding
} from "./lib/ab_manifest.mjs"
import { loadConfig, resolvePeriods } from "./lib/config.mjs"
import { ensureDir, pathExists, toRunId, writeJson } from "./lib/io.mjs"
import {
  buildDataPathSignatures,
  buildFilesSignatureHash,
  buildStepKey,
  listRelativeFilesRecursive,
  loadPipelineCache,
  parseBoolFlag,
  pickObject,
  savePipelineCache,
  tryReuseStep,
  updateStepCacheEntry
} from "./lib/incremental.mjs"
import { probeDuckdbCli } from "./lib/duckdb_cli.mjs"
import { resolveStepCInputPath } from "./lib/lightweight.mjs"
import { runStepA } from "./pipeline/step_a_event_extract.mjs"
import { runStepB } from "./pipeline/step_b_template_build.mjs"
import { runStepC0 } from "./pipeline/step_c0_family_mine.mjs"
import { runStepC0ChartReport } from "./pipeline/step_c0_family_chart_report.mjs"
import { runStepC1 } from "./pipeline/step_c1_family_probe.mjs"
import { runStepC2 } from "./pipeline/step_c2_family_dedup.mjs"
import { runStepC } from "./pipeline/step_c_pattern_mine.mjs"
import { runStepD } from "./pipeline/step_d_online_loop.mjs"
import { runStepDFullMaterialize } from "./pipeline/step_d_full_materialize_runner.mjs"
import { runStepE } from "./pipeline/step_e_lockbox_backtest.mjs"
import { runCdLoop } from "./pipeline/cd_loop.mjs"
import { runSmokeConfirmRunner } from "./pipeline/smoke_confirm_runner.mjs"
import { runFinalReport } from "./report/generate_report.mjs"

const printUsage = () => {
  console.log(`Usage:
  node src/cli.mjs doctor --config=config/lab.config.json
  node src/cli.mjs step-a --config=config/lab.config.json [--run-id=YYYYMMDD_HHMMSS]
  node src/cli.mjs step-b --config=... --run-id=...
  node src/cli.mjs step-c0 --config=... --run-id=...
  node src/cli.mjs step-c0-chart --config=... --run-id=... [--families-limit=18] [--window-before=90] [--window-after=25]
  node src/cli.mjs step-c1 --config=... --run-id=... [--source-run-id=...] [--source-run-dir=...] [--family-id=F123] [--family-ids=F123,F175]
  node src/cli.mjs step-c2 --config=... --run-id=...
  node src/cli.mjs step-c --config=... --run-id=...   # runs C0 -> C1 -> C2 -> C
  node src/cli.mjs step-d --config=... --run-id=...
  node src/cli.mjs step-d-materialize --config=... --run-id=... --payload=...
  node src/cli.mjs step-e --config=... --run-id=...
  node src/cli.mjs report --config=... --run-id=...
  node src/cli.mjs run-all --config=... [--run-id=...] [--incremental=true] [--incremental-reuse-mode=hardlink|copy]
  node src/cli.mjs tune-loop --config=... [--run-id=...] [--rounds=5] [--gate-step=0.01] [--gate-max=0.25]
  node src/cli.mjs cd-loop --config=... --run-id=... [--rounds=12] [--min-epochs=3] [--max-epochs=8] [--session-id=...] [--probe-lane=operating|research]
  node src/cli.mjs smoke-confirm --config=... --run-id=... [--session-id=...] [--phase=both|smoke|confirm] [--smoke-runs=12] [--confirm-runs=36] [--champion-bundle-path=...]
  node src/cli.mjs ab-show --config=...
  node src/cli.mjs ab-promote --config=... --run-id=<AB_RUN_ID> [--note=...]
`)
}

const createContext = async ({ configPath, runIdArg, ensureRunDir = true }) => {
  const cwd = process.cwd()
  const { config, configPath: resolvedConfigPath } = await loadConfig({
    configPath,
    cwd
  })
  const periods = resolvePeriods(config)
  const runId = String(runIdArg ?? toRunId())
  const runDir = path.join(cwd, "artifacts", "runs", runId)
  if (ensureRunDir) {
    await ensureDir(runDir)
  }

  return {
    cwd,
    runId,
    runDir,
    config,
    configPath: resolvedConfigPath,
    periods
  }
}

const CORE_DATA_PATH_KEYS = new Set([
  "candleDailyJsonl",
  "universeJsonl",
  "symbolMasterJsonl"
])

const looksLikeConfigPath = (value) => {
  const raw = String(value ?? "").trim()
  if (!raw || raw === ":memory:") return false
  if (/^[a-z]+:\/\//i.test(raw)) return false
  return raw.includes("/") || raw.includes("\\")
}

const collectConfigRuntimePaths = (value, out = new Set()) => {
  if (Array.isArray(value)) {
    for (const item of value) collectConfigRuntimePaths(item, out)
    return out
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      collectConfigRuntimePaths(child, out)
    }
    return out
  }
  if (typeof value === "string" && looksLikeConfigPath(value)) {
    out.add(value.trim())
  }
  return out
}

const resolveAbsPath = (cwd, rawPath) =>
  path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath)

const buildDoctorFileCheck = (ctx, key, rawPath, required) => {
  const safePath = String(rawPath ?? "").trim()
  if (!safePath) {
    return {
      key,
      path: safePath,
      required,
      exists: false
    }
  }
  return {
    key,
    path: safePath,
    required,
    exists: pathExists(resolveAbsPath(ctx.cwd, safePath))
  }
}

const collectDoctorRuntimeFileChecks = (ctx) => {
  const checks = []
  const startWeightsPath = String(ctx?.config?.onlineLearning?.startWeightsPath ?? "").trim()
  if (startWeightsPath) {
    checks.push(
      buildDoctorFileCheck(ctx, "onlineLearning.startWeightsPath", startWeightsPath, true)
    )
  }

  const regimeRouterCfg = ctx?.config?.decisionGate?.regimeRouter ?? {}
  if (regimeRouterCfg?.enabled === true) {
    for (const [bucket, rawPath] of Object.entries(regimeRouterCfg?.weightsByBucket ?? {})) {
      const safeBucket = String(bucket ?? "").trim()
      const safePath = String(rawPath ?? "").trim()
      if (!safeBucket || !safePath) continue
      checks.push(
        buildDoctorFileCheck(
          ctx,
          `decisionGate.regimeRouter.weightsByBucket.${safeBucket}`,
          safePath,
          true
        )
      )
    }
  }

  return checks
}

const runDoctor = async (ctx) => {
  const dataPaths = ctx.config.dataPaths ?? {}
  const dataFiles = Object.fromEntries(
    Object.entries(dataPaths).map(([key, rel]) => {
      const required = CORE_DATA_PATH_KEYS.has(key)
      return [
        key,
        {
          path: rel,
          required,
          exists: pathExists(path.resolve(ctx.cwd, rel))
        }
      ]
    }),
  )
  const runtimeFiles = collectDoctorRuntimeFileChecks(ctx)
  const requestedEngine = String(ctx?.config?.lightweight?.stepA?.engine ?? "duckdb")
    .trim()
    .toLowerCase()
  const enforceDuckdb = ctx?.config?.guardrails?.enforceStepAEngineDuckdb !== false
  const requiresDuckdb = enforceDuckdb || requestedEngine === "duckdb"
  const duckdbCliPath = String(ctx?.config?.lightweight?.stepA?.duckdb?.cliPath ?? "duckdb").trim()
  const duckdbRuntime = requiresDuckdb
    ? await probeDuckdbCli({
        cliPath: duckdbCliPath || "duckdb",
        cwd: ctx.cwd
      })
    : {
        ok: true,
        cliPath: duckdbCliPath || "duckdb",
        argsStyle: null
      }
  const missingRequiredDataKeys = Object.entries(dataFiles)
    .filter(([, value]) => value.required === true && value.exists !== true)
    .map(([key]) => key)
  const missingRuntimeKeys = runtimeFiles
    .filter((row) => row.required === true && row.exists !== true)
    .map((row) => row.key)
  const ok =
    missingRequiredDataKeys.length === 0 &&
    missingRuntimeKeys.length === 0 &&
    duckdbRuntime.ok === true

  return {
    ok,
    runId: ctx.runId,
    configPath: ctx.configPath,
    periods: ctx.periods,
    dataFiles,
    runtimeFiles,
    stepARuntime: {
      required: requiresDuckdb,
      engine: requiresDuckdb ? "duckdb" : requestedEngine || "duckdb",
      cliPath: duckdbRuntime.cliPath,
      ok: duckdbRuntime.ok === true,
      argsStyle: duckdbRuntime.argsStyle ?? null
    },
    failures: {
      requiredDataKeys: missingRequiredDataKeys,
      runtimeFileKeys: missingRuntimeKeys,
      duckdb: duckdbRuntime.ok === true ? null : duckdbRuntime.cliPath
    }
  }
}

const resolveRunAllCodeFiles = async (cwd) =>
  listRelativeFilesRecursive({
    cwd,
    roots: ["src"],
    filter: (relPath) => relPath.endsWith(".mjs")
  })

const ensureTuneLoopBaseArtifacts = async (ctx) => {
  const lightweightCfg = ctx.config?.lightweight ?? {}
  const stepASummaryPath = path.join(ctx.runDir, "step-a", "step_a_summary.json")
  const stepBSummaryPath = path.join(ctx.runDir, "step-b", "step_b_summary.json")
  let stepCInput = resolveStepCInputPath({
    runDir: ctx.runDir,
    lightweightCfg,
    preferLiteArtifacts: lightweightCfg?.pipeline?.preferLiteArtifacts
  })

  if (!pathExists(stepASummaryPath) && !pathExists(stepBSummaryPath)) {
    await runStepA(ctx)
  }
  if (!pathExists(stepBSummaryPath) || !pathExists(stepCInput.inPath)) {
    if (!pathExists(stepASummaryPath)) {
      await runStepA(ctx)
    }
    await runStepB(ctx)
    stepCInput = resolveStepCInputPath({
      runDir: ctx.runDir,
      lightweightCfg,
      preferLiteArtifacts: lightweightCfg?.pipeline?.preferLiteArtifacts
    })
  }
  if (!pathExists(stepCInput.inPath)) {
    throw new Error(
      [
        "tune-loop base Step B artifact missing for Step C.",
        `expected=${stepCInput.inPath}`,
        "Check lightweight.stepB.outputMode and lightweight.stepC.inputMode."
      ].join(" "),
    )
  }
  return {
    stepBSourceRunId: ctx.runId,
    stepBSourceRunDir: ctx.runDir,
    stepCInputPath: stepCInput.inPath
  }
}

const runStepCStack = async (ctx) => {
  const stepC0 = await runStepC0(ctx)
  const stepC1 = await runStepC1(ctx)
  const stepC2 = await runStepC2(ctx)
  const stepC = await runStepC(ctx)
  return {
    stepC0,
    stepC1,
    stepC2,
    stepC
  }
}

const runAll = async ({ ctx, flags }) => {
  const incremental = parseBoolFlag(flags?.incremental, false)
  const incrementalReuseMode = String(flags?.["incremental-reuse-mode"] ?? "hardlink")
  if (!incremental) {
    await runStepA(ctx)
    await runStepB(ctx)
    await runStepCStack(ctx)
    await runStepD(ctx)
    await runStepE(ctx)
    const result = await runFinalReport(ctx)
    return {
      report: result.report,
      incremental: {
        enabled: false,
        reusedSteps: []
      }
    }
  }

  const { cachePath, cache } = await loadPipelineCache(ctx.cwd)
  const dataSignatures = await buildDataPathSignatures({
    cwd: ctx.cwd,
    dataPaths: ctx.config.dataPaths
  })
  const codeFiles = await resolveRunAllCodeFiles(ctx.cwd)
  const runtimeDependencyPaths = Array.from(collectConfigRuntimePaths(ctx.config)).sort()
  const codeHash = await buildFilesSignatureHash({
    cwd: ctx.cwd,
    files: codeFiles
  })
  const runtimeDependencyHash = await buildFilesSignatureHash({
    cwd: ctx.cwd,
    files: runtimeDependencyPaths
  })
  const reusedSteps = []

  const stepRunner = async ({
    stepCode,
    stepDirName,
    requiredFile,
    payload,
    run
  }) => {
    const key = buildStepKey({ step: stepCode, payload })
    const reused = await tryReuseStep({
      cache,
      key,
      runDir: ctx.runDir,
      stepDirName,
      requiredFile,
      reuseMode: incrementalReuseMode
    })
    if (reused) {
      reusedSteps.push({
        step: stepCode,
        fromRunId: reused.sourceRunId,
        reuseMode: reused.reuseMode
      })
      return { key, reused: true }
    }
    await run()
    updateStepCacheEntry({
      cache,
      key,
      runDir: ctx.runDir,
      runId: ctx.runId,
      stepDirName,
      requiredFile
    })
    return { key, reused: false }
  }

  const stepA = await stepRunner({
    stepCode: "A",
    stepDirName: "step-a",
    requiredFile: "step_a_summary.json",
    payload: {
      event: ctx.config.event,
      filters: ctx.config.filters,
      lightweight: {
        pipeline: ctx.config.lightweight?.pipeline,
        stepA: ctx.config.lightweight?.stepA
      },
      period: ctx.periods.discovery,
      codeHash,
      runtimeDependencyHash,
      data: pickObject(dataSignatures, [
        "candleDailyJsonl",
        "universeJsonl",
        "symbolMasterJsonl",
        "hourly60mJsonl"
      ])
    },
    run: () => runStepA(ctx)
  })

  const stepB = await stepRunner({
    stepCode: "B",
    stepDirName: "step-b",
    requiredFile: "step_b_summary.json",
    payload: {
      depA: stepA.key,
      template: ctx.config.template,
      lightweight: {
        pipeline: ctx.config.lightweight?.pipeline,
        stepB: ctx.config.lightweight?.stepB
      },
      codeHash,
      runtimeDependencyHash,
      data: pickObject(dataSignatures, [
        "candleDailyJsonl",
        "universeJsonl",
        "newsJsonl"
      ])
    },
    run: () => runStepB(ctx)
  })

  const stepC0 = await stepRunner({
    stepCode: "C0",
    stepDirName: "step-c0",
    requiredFile: "c0_summary.json",
    payload: {
      depB: stepB.key,
      patternC0: ctx.config.pattern?.c0,
      lightweight: {
        pipeline: ctx.config.lightweight?.pipeline,
        stepB: ctx.config.lightweight?.stepB,
        stepC: ctx.config.lightweight?.stepC
      },
      codeHash,
      runtimeDependencyHash,
      periods: ctx.periods
    },
    run: () => runStepC0(ctx)
  })

  const stepC1 = await stepRunner({
    stepCode: "C1",
    stepDirName: "step-c1",
    requiredFile: "c1_summary.json",
    payload: {
      depC0: stepC0.key,
      patternC1: ctx.config.pattern?.c1,
      codeHash,
      runtimeDependencyHash,
      periods: ctx.periods
    },
    run: () => runStepC1(ctx)
  })

  const stepC2 = await stepRunner({
    stepCode: "C2",
    stepDirName: "step-c2",
    requiredFile: "c2_summary.json",
    payload: {
      depC1: stepC1.key,
      patternC2: ctx.config.pattern?.c2,
      codeHash,
      runtimeDependencyHash,
      periods: ctx.periods
    },
    run: () => runStepC2(ctx)
  })

  const stepC = await stepRunner({
    stepCode: "C",
    stepDirName: "step-c",
    requiredFile: "step_c_summary.json",
    payload: {
      depB: stepB.key,
      depC0: stepC0.key,
      depC1: stepC1.key,
      depC2: stepC2.key,
      pattern: ctx.config.pattern,
      event: ctx.config.event,
      filters: ctx.config.filters,
      lightweight: {
        pipeline: ctx.config.lightweight?.pipeline,
        stepB: ctx.config.lightweight?.stepB,
        stepC: ctx.config.lightweight?.stepC
      },
      similarityWeights: ctx.config.similarity?.initialWeights,
      codeHash,
      runtimeDependencyHash,
      periods: ctx.periods
    },
    run: async () => {
      await runStepC(ctx)
    }
  })

  const stepD = await stepRunner({
    stepCode: "D",
    stepDirName: "step-d",
    requiredFile: "step_d_summary.json",
    payload: {
      depC: stepC.key,
      event: ctx.config.event,
      filters: ctx.config.filters,
      similarity: ctx.config.similarity,
      decisionGate: ctx.config.decisionGate,
      onlineLearning: ctx.config.onlineLearning,
      codeHash,
      runtimeDependencyHash,
      period: ctx.periods.online,
      periodLockbox: ctx.periods.lockbox,
      data: pickObject(dataSignatures, [
        "candleDailyJsonl",
        "universeJsonl",
        "symbolMasterJsonl",
        "hourly60mJsonl",
        "newsJsonl"
      ])
    },
    run: () => runStepD(ctx)
  })

  await stepRunner({
    stepCode: "E",
    stepDirName: "step-e",
    requiredFile: "step_e_summary.json",
    payload: {
      depC: stepC.key,
      depD: stepD.key,
      backtest: ctx.config.backtest,
      filters: ctx.config.filters,
      similarity: ctx.config.similarity,
      decisionGate: ctx.config.decisionGate,
      codeHash,
      runtimeDependencyHash,
      period: ctx.periods.lockbox,
      data: pickObject(dataSignatures, [
        "candleDailyJsonl",
        "universeJsonl",
        "symbolMasterJsonl",
        "hourly60mJsonl",
        "newsJsonl"
      ])
    },
    run: () => runStepE(ctx)
  })

  const result = await runFinalReport(ctx)
  await savePipelineCache({ cachePath, cache })
  return {
    report: result.report,
    incremental: {
      enabled: true,
      reusedSteps
    }
  }
}

const cloneJson = (value) => JSON.parse(JSON.stringify(value))

const runTuneLoop = async ({ baseCtx, flags }) => {
  const rounds = Math.max(1, Number(flags?.rounds ?? 5) || 5)
  const gateStep = Math.max(0, Number(flags?.["gate-step"] ?? 0.01) || 0.01)
  const gateMax = Math.max(0, Number(flags?.["gate-max"] ?? 0.25) || 0.25)
  const mddWarn = Math.max(0, Number(flags?.["mdd-warn"] ?? 0.3) || 0.3)
  const hitTarget = Math.max(0, Number(flags?.["hit-target"] ?? 0.05) || 0.05)
  const baseArtifacts = await ensureTuneLoopBaseArtifacts(baseCtx)

  const baseConfig = cloneJson(baseCtx.config)
  let gate = Number(
    baseConfig?.decisionGate?.minFinalScore ??
      baseConfig?.similarity?.minTradeScore ??
      0,
  )
  if (!Number.isFinite(gate) || gate < 0) gate = 0

  const roundsReport = []
  let best = null

  for (let i = 1; i <= rounds; i += 1) {
    const roundRunId = `${baseCtx.runId}_r${String(i).padStart(2, "0")}`
    const roundCtx = await createContext({
      configPath: baseCtx.configPath,
      runIdArg: roundRunId,
      ensureRunDir: true
    })
    roundCtx.config = cloneJson(baseConfig)
    roundCtx.config.decisionGate = {
      ...(roundCtx.config.decisionGate ?? {}),
      minFinalScore: gate
    }
    roundCtx.abRunId = baseArtifacts.stepBSourceRunId
    roundCtx.abRunDir = baseArtifacts.stepBSourceRunDir
    roundCtx.periods = resolvePeriods(roundCtx.config)

    await runStepCStack(roundCtx)
    const stepD = await runStepD(roundCtx)
    const stepE = await runStepE(roundCtx)
    const finalReport = await runFinalReport(roundCtx)
    const row = {
      round: i,
      runId: roundRunId,
      gateMinFinalScore: gate,
      hitRate: Number(stepD?.summary?.hitRate ?? 0),
      pickedDays: Number(stepD?.summary?.pickedDays ?? 0),
      skippedByGate: Number(stepD?.summary?.skippedByGate ?? 0),
      cumulativeReturn: Number(stepE?.summary?.cumulativeReturn ?? 0),
      winRate: Number(stepE?.summary?.winRate ?? 0),
      maxDrawdown: Number(stepE?.summary?.maxDrawdown ?? 0),
      totalTrades: Number(stepE?.summary?.totalTrades ?? 0),
      keyMetrics: finalReport?.report?.keyMetrics ?? null
    }
    roundsReport.push(row)

    if (
      !best ||
      row.cumulativeReturn > best.cumulativeReturn ||
      (row.cumulativeReturn === best.cumulativeReturn && row.maxDrawdown < best.maxDrawdown)
    ) {
      best = row
    }

    // Conservative gate retune:
    // - if 수익/리스크가 나쁘면 진입 문턱 강화
    // - 수익이 양수인데 적중률만 낮으면 과도 게이트 완화
    if (row.cumulativeReturn < 0 || row.maxDrawdown > mddWarn) {
      gate = Math.min(gateMax, gate + gateStep)
    } else if (row.cumulativeReturn > 0 && row.hitRate < hitTarget) {
      gate = Math.max(0, gate - gateStep / 2)
    }
  }

  const summary = {
    mode: "tune-loop",
    baseRunId: baseCtx.runId,
    stepBSourceRunId: baseArtifacts.stepBSourceRunId,
    stepBSourceRunDir: baseArtifacts.stepBSourceRunDir,
    rounds,
    gateStep,
    gateMax,
    mddWarn,
    hitTarget,
    bestRound: best,
    roundsReport
  }
  await writeJson(path.join(baseCtx.runDir, "tune_loop_summary.json"), summary)
  return summary
}

const runAbShow = async ({ ctx, flags }) => {
  const requestedAbRunId = String(flags?.["ab-run-id"] ?? "").trim()
  const ignoreAbHash = String(flags?.["ab-ignore-config-hash"] ?? "false")
    .trim()
    .toLowerCase() === "true"
  const active = await readActiveAbManifest({ cwd: ctx.cwd })
  let binding = null
  try {
    binding = await resolveActiveAbBinding({
      cwd: ctx.cwd,
      config: ctx.config,
      requestedAbRunId,
      ignoreConfigHash: ignoreAbHash
    })
  } catch (error) {
    binding = {
      error: error instanceof Error ? error.message : String(error)
    }
  }
  return {
    mode: "ab-show",
    manifestPath: active.manifestPath,
    manifest: active.manifest,
    binding
  }
}

const runAbPromote = async ({ ctx, flags }) => {
  const activeRunId = String(flags?.["run-id"] ?? "").trim()
  if (!activeRunId) {
    throw new Error("ab-promote requires --run-id=<AB_RUN_ID>")
  }
  const note = String(flags?.note ?? "").trim()
  const result = await promoteActiveAbManifest({
    cwd: ctx.cwd,
    runId: activeRunId,
    config: ctx.config,
    note
  })
  return {
    mode: "ab-promote",
    manifestPath: result.manifestPath,
    manifest: result.manifest
  }
}

const closeRuntimeResources = async (ctx) => {
  const cachedWorkerPool = ctx?.__runtime?.stepDWorkerPool?.pool
  if (cachedWorkerPool && typeof cachedWorkerPool.close === "function") {
    await cachedWorkerPool.close()
    if (ctx.__runtime && Object.prototype.hasOwnProperty.call(ctx.__runtime, "stepDWorkerPool")) {
      delete ctx.__runtime.stepDWorkerPool
    }
  }
}

const parseCsvFlagList = (...values) => {
  const seen = new Set()
  const out = []
  for (const rawValue of values) {
    if (rawValue === undefined || rawValue === null || rawValue === false) continue
    const parts = String(rawValue)
      .split(",")
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
    for (const part of parts) {
      if (seen.has(part)) continue
      seen.add(part)
      out.push(part)
    }
  }
  return out
}

const applyStepC1RuntimeOverridesFromFlags = (ctx, flags) => {
  ctx.__runtime = ctx.__runtime ?? {}
  const familyIds = parseCsvFlagList(flags?.["family-id"], flags?.["family-ids"])
  if (familyIds.length > 0) {
    ctx.__runtime.stepC1ExplicitFamilyIdsOverride = familyIds
  }

  const rawSourceRunId = String(flags?.["source-run-id"] ?? "").trim()
  const rawSourceRunDir = String(flags?.["source-run-dir"] ?? "").trim()
  if (!rawSourceRunId && !rawSourceRunDir) return

  const resolvedSourceRunDir = rawSourceRunDir
    ? path.resolve(ctx.cwd, rawSourceRunDir)
    : path.join(ctx.cwd, "artifacts", "runs", rawSourceRunId)
  const derivedSourceRunId = path.basename(resolvedSourceRunDir)
  if (rawSourceRunId && rawSourceRunDir && derivedSourceRunId && derivedSourceRunId !== rawSourceRunId) {
    throw new Error(
      [
        "step-c1 source run mismatch:",
        `source-run-id=${rawSourceRunId}`,
        `source-run-dir=${resolvedSourceRunDir}`
      ].join(" "),
    )
  }
  const sourceRunId = rawSourceRunId || derivedSourceRunId
  if (!pathExists(resolvedSourceRunDir)) {
    throw new Error(`step-c1 source run not found: ${resolvedSourceRunDir}`)
  }
  ctx.abRunDir = resolvedSourceRunDir
  ctx.abRunId = sourceRunId
  ctx.__runtime.stepC1SourceRunDirOverride = resolvedSourceRunDir
}

const applyStepDRuntimeOverridesFromFlags = (ctx, flags) => {
  ctx.__runtime = ctx.__runtime ?? {}
  const executionProfile = String(flags?.["stepd-execution-profile"] ?? "").trim()
  if (executionProfile) {
    ctx.__runtime.stepDExecutionProfileOverride = executionProfile
  }
  if (Object.prototype.hasOwnProperty.call(flags ?? {}, "stepd-prepare-lockbox")) {
    ctx.__runtime.stepDPrepareLockboxDuringStepDOverride = parseBoolFlag(
      flags["stepd-prepare-lockbox"],
      true,
    )
  }
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const command = parsed._[0]
  if (!command) {
    printUsage()
    process.exit(1)
  }

  const configPath =
    parsed.flags.config ??
    (command === "step-d-materialize" ? "config/lab.config.server.lite.json" : undefined)
  const runIdArg = parsed.flags["run-id"]
  const ctx = await createContext({
    configPath,
    runIdArg,
    ensureRunDir: command !== "doctor"
  })

  try {
    switch (command) {
      case "doctor": {
        const result = await runDoctor(ctx)
        console.log(JSON.stringify(result, null, 2))
        if (!result.ok) {
          process.exit(1)
        }
        break
      }
      case "step-a": {
        const result = await runStepA(ctx)
        console.log(JSON.stringify(result.summary, null, 2))
        break
      }
      case "step-b": {
        const result = await runStepB(ctx)
        console.log(JSON.stringify(result.summary, null, 2))
        break
      }
      case "step-c0": {
        const result = await runStepC0(ctx)
        console.log(JSON.stringify(result.summary, null, 2))
        break
      }
      case "step-c0-chart": {
        const result = await runStepC0ChartReport(ctx, parsed.flags)
        console.log(JSON.stringify(result.summary, null, 2))
        break
      }
      case "step-c1": {
        applyStepC1RuntimeOverridesFromFlags(ctx, parsed.flags)
        const result = await runStepC1(ctx)
        console.log(JSON.stringify(result.summary, null, 2))
        break
      }
      case "step-c2": {
        const result = await runStepC2(ctx)
        console.log(JSON.stringify(result.summary, null, 2))
        break
      }
      case "step-c": {
        const result = await runStepCStack(ctx)
        console.log(JSON.stringify(result.stepC.summary, null, 2))
        break
      }
      case "step-d": {
        applyStepDRuntimeOverridesFromFlags(ctx, parsed.flags)
        const result = await runStepD(ctx)
        console.log(JSON.stringify(result.summary, null, 2))
        break
      }
      case "step-d-materialize": {
        const result = await runStepDFullMaterialize({ ctx, flags: parsed.flags })
        console.log(JSON.stringify(result.summary, null, 2))
        break
      }
      case "step-e": {
        const result = await runStepE(ctx)
        console.log(JSON.stringify(result.summary, null, 2))
        break
      }
      case "report": {
        const result = await runFinalReport(ctx)
        console.log(JSON.stringify(result.report.keyMetrics, null, 2))
        break
      }
      case "run-all": {
        const result = await runAll({ ctx, flags: parsed.flags })
        console.log(
          JSON.stringify(
            {
              ...result.report.keyMetrics,
              incremental: result.incremental
            },
            null,
            2,
          ),
        )
        break
      }
      case "tune-loop": {
        const result = await runTuneLoop({ baseCtx: ctx, flags: parsed.flags })
        console.log(JSON.stringify(result, null, 2))
        break
      }
      case "cd-loop": {
        const result = await runCdLoop({ ctx, flags: parsed.flags })
        console.log(JSON.stringify(result.summary, null, 2))
        break
      }
      case "smoke-confirm": {
        const result = await runSmokeConfirmRunner({ ctx, flags: parsed.flags })
        console.log(JSON.stringify(result.summary, null, 2))
        break
      }
      case "ab-show": {
        const result = await runAbShow({ ctx, flags: parsed.flags })
        console.log(JSON.stringify(result, null, 2))
        break
      }
      case "ab-promote": {
        const result = await runAbPromote({ ctx, flags: parsed.flags })
        console.log(JSON.stringify(result, null, 2))
        break
      }
      default:
        printUsage()
        process.exit(1)
    }
  } finally {
    await closeRuntimeResources(ctx)
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error?.message ?? String(error))
  process.exit(1)
})
