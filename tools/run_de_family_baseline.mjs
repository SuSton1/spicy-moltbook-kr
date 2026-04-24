import path from "node:path"

import { parseCliArgs } from "../src/lib/args.mjs"
import { loadConfig, resolvePeriods } from "../src/lib/config.mjs"
import { ensureDir, pathExists, readJsonl } from "../src/lib/io.mjs"
import { runStepC } from "../src/pipeline/step_c_pattern_mine.mjs"
import { runStepD } from "../src/pipeline/step_d_online_loop.mjs"
import { runStepE } from "../src/pipeline/step_e_lockbox_backtest.mjs"

const clonePlain = (value) => JSON.parse(JSON.stringify(value ?? {}))

const createContext = async ({ cwd, configPath, runId }) => {
  const { config, configPath: resolvedConfigPath } = await loadConfig({ configPath, cwd })
  const periods = resolvePeriods(config)
  const runDir = path.join(cwd, "artifacts", "runs", runId)
  await ensureDir(runDir)
  return {
    cwd,
    runId,
    runDir,
    config,
    configPath: resolvedConfigPath,
    periods
  }
}

const collectFamilyIdsFromC1Results = async (runDir) => {
  const resultsPath = path.join(runDir, "step-c1", "c1_family_probe_results.jsonl")
  if (!pathExists(resultsPath)) {
    throw new Error(`Merged C1 results not found: ${resultsPath}`)
  }
  const rows = await readJsonl(resultsPath)
  return rows
    .map((row) => String(row?.familyId ?? "").trim())
    .filter(Boolean)
    .sort((left, right) => {
      const leftNum = Number.parseInt(left.replace(/^F/i, ""), 10)
      const rightNum = Number.parseInt(right.replace(/^F/i, ""), 10)
      if (Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum !== rightNum) {
        return leftNum - rightNum
      }
      return left.localeCompare(right)
    })
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const configPath = String(parsed.flags.config ?? "config/lab.config.server.lite.json").trim()
  const runId = String(parsed.flags["run-id"] ?? "").trim()
  const sourceRunId = String(parsed.flags["source-run-id"] ?? "").trim()
  const disableFamilyPool = String(parsed.flags["disable-family-pool"] ?? "true").trim().toLowerCase() !== "false"
  const disableC2 = String(parsed.flags["disable-c2"] ?? "true").trim().toLowerCase() !== "false"
  if (!runId || !sourceRunId) {
    throw new Error(
      "Usage: node tools/run_de_family_baseline.mjs --config=... --run-id=<merged_run> --source-run-id=<stepb_run> [--disable-family-pool=true] [--disable-c2=true]",
    )
  }

  const ctx = await createContext({ cwd, configPath, runId })
  const familyIds = await collectFamilyIdsFromC1Results(ctx.runDir)
  if (familyIds.length < 1) {
    throw new Error(`No family ids found in merged C1 results: ${ctx.runDir}`)
  }
  ctx.config = clonePlain(ctx.config)
  if (disableFamilyPool) {
    ctx.config.cdLoop = {
      ...(ctx.config.cdLoop ?? {}),
      familyPool: {
        ...(ctx.config.cdLoop?.familyPool ?? {}),
        enabled: false
      }
    }
  }
  if (disableC2) {
    ctx.config.pattern = {
      ...(ctx.config.pattern ?? {}),
      c2: {
        ...(ctx.config.pattern?.c2 ?? {}),
        enabled: false
      }
    }
  }
  ctx.periods = resolvePeriods(ctx.config)
  ctx.abRunId = sourceRunId
  ctx.abRunDir = path.join(cwd, "artifacts", "runs", sourceRunId)
  ctx.__runtime = {
    ...(ctx.__runtime ?? {}),
    allowedC0FamilyIds: familyIds,
    stepBSourceRunDirOverride: ctx.abRunDir,
    stepCFamilySourceRunDirOverride: ctx.abRunDir
  }

  const stepC = await runStepC(ctx)
  const stepD = await runStepD(ctx)
  const stepE = await runStepE(ctx)
  console.log(
    JSON.stringify(
      {
        step: "run-de-family-baseline",
        runId,
        sourceRunId,
        familyCount: familyIds.length,
        familyPoolDisabled: disableFamilyPool,
        c2Disabled: disableC2,
        stepC: stepC?.summary ?? null,
        stepD: stepD?.summary ?? null,
        stepE: stepE?.summary ?? null
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error?.stack ?? String(error))
  process.exit(1)
})
