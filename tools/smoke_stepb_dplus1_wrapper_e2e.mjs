import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import { readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"

const ROOT = process.cwd()
const LIB_PATH = path.join(ROOT, "tools", "lib_stepb_dplus1_baseline_wrapper.sh")

const runBash = (script, args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", script, "--", ...args], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        STOCKDESK_SERVER_REPO_ROOT: ROOT,
      },
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(`bash exited with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    })
  })

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stepb-dplus1-wrapper-e2e-"))
  const baseConfigPath = path.join(tempRoot, "base_config.json")
  const runtimeConfigPath = path.join(tempRoot, "runtime_config.json")
  const decisionStepBDir = path.join(tempRoot, "decision-stepb")
  const strictStepBDir = path.join(tempRoot, "strict-stepb")
  const baselineConfigPath = path.join(ROOT, "config", "lab.config.server.lite.stepb_dplus1_baseline.json")

  await writeJson(baseConfigPath, {
    extends: baselineConfigPath,
    periods: {
      warmup: { from: "2024-01-01", to: "2024-01-05" },
      discovery: { from: "2024-01-06", to: "2024-01-10" },
      online: { from: "2024-01-11", to: "2024-01-12" },
      lockbox: { from: "2024-01-13", to: "2024-01-14" },
    },
  })

  await runBash(
    `
      source "${LIB_PATH}"
      write_period_config "$1" "$2" "$3" "$4" "$5"
    `,
    [baseConfigPath, runtimeConfigPath, "2024-02-01", "2024-02-29", "decision_date_only"],
  )

  const runtimeConfig = await readJson(runtimeConfigPath, null)
  const runtimeBaseline = runtimeConfig?.lightweight?.stepB?.perfectPrototypeBaseline ?? null
  if (runtimeConfig?.periods?.discovery?.from !== "2024-02-01" || runtimeConfig?.periods?.discovery?.to !== "2024-02-29") {
    throw new Error("write_period_config did not rewrite the discovery window")
  }
  if (runtimeBaseline?.splitPolicy !== "decision_date_only") {
    throw new Error(`expected runtime splitPolicy decision_date_only, got ${runtimeBaseline?.splitPolicy ?? "null"}`)
  }
  if (runtimeBaseline?.featureAsOf !== "t-1" || runtimeBaseline?.exactCollectionMode !== "train_precision_1_only") {
    throw new Error("write_period_config did not preserve the self-contained baseline contract")
  }

  await fs.mkdir(decisionStepBDir, { recursive: true })
  await writeJson(path.join(decisionStepBDir, "step_b_summary.json"), {
    templates: 2,
    positiveTemplates: 1,
    negativeTemplates: 1,
    perfectPrototypeBaselineContract: {
      lineId: "stepb_dplus1_baseline",
    },
  })
  await writeJsonl(path.join(decisionStepBDir, "templates_lite.jsonl"), [
    {
      templateId: "d1",
      label: 1,
      eventOutcome: { entryDateKey: "2024-03-02", exitDateKey: "2024-03-05" },
    },
    {
      templateId: "d2",
      label: 0,
      eventOutcome: { entryDateKey: "2024-03-03", exitDateKey: "2024-03-06" },
    },
  ])

  await runBash(
    `
      source "${LIB_PATH}"
      apply_strict_label_boundary "$1" "$2" "$3" "$4"
    `,
    [decisionStepBDir, "2024-03-01", "2024-03-31", "decision_date_only"],
  )

  const decisionSummary = await readJson(path.join(decisionStepBDir, "step_b_summary.json"), null)
  const decisionBoundaryGeneric = await readJson(path.join(decisionStepBDir, "boundary_filter_summary.json"), null)
  const decisionBoundary = await readJson(path.join(decisionStepBDir, "decision_date_only_boundary_summary.json"), null)
  if (decisionSummary?.baselineBoundaryFilter?.boundaryFilteringSkipped !== true) {
    throw new Error("decision_date_only should record boundaryFilteringSkipped=true")
  }
  if (decisionBoundary?.boundaryFilteringSkipReason !== "decision_date_only") {
    throw new Error("decision_date_only summary missing explicit skip reason")
  }
  if (decisionBoundaryGeneric?.boundaryFilteringSkipReason !== "decision_date_only") {
    throw new Error("decision_date_only generic boundary summary missing explicit skip reason")
  }

  await fs.mkdir(strictStepBDir, { recursive: true })
  await writeJson(path.join(strictStepBDir, "step_b_summary.json"), {
    templates: 3,
    positiveTemplates: 2,
    negativeTemplates: 1,
    perfectPrototypeBaselineContract: {
      lineId: "stepb_dplus1_baseline",
    },
  })
  await writeJsonl(path.join(strictStepBDir, "templates_lite.jsonl"), [
    {
      templateId: "s1",
      label: 1,
      eventOutcome: { entryDateKey: "2024-04-02", exitDateKey: "2024-04-05" },
    },
    {
      templateId: "s2",
      label: 0,
      eventOutcome: { entryDateKey: "2024-04-03", exitDateKey: "2024-05-01" },
    },
    {
      templateId: "s3",
      label: 1,
      eventOutcome: { entryDateKey: "2024-04-04" },
    },
  ])

  await runBash(
    `
      source "${LIB_PATH}"
      apply_strict_label_boundary "$1" "$2" "$3" "$4"
    `,
    [strictStepBDir, "2024-04-01", "2024-04-30", "strict_label_boundary"],
  )

  const strictSummary = await readJson(path.join(strictStepBDir, "step_b_summary.json"), null)
  const strictBoundaryGeneric = await readJson(path.join(strictStepBDir, "boundary_filter_summary.json"), null)
  const strictBoundary = await readJson(path.join(strictStepBDir, "strict_label_boundary_summary.json"), null)
  const strictRows = await readJsonl(path.join(strictStepBDir, "templates_lite.jsonl"))
  if (!Array.isArray(strictRows) || strictRows.length !== 1 || strictRows[0]?.templateId !== "s1") {
    throw new Error("strict_label_boundary did not keep only the in-boundary row")
  }
  if (strictBoundary?.droppedForBoundaryCount !== 1 || strictBoundary?.missingOutcomeKeysCount !== 1) {
    throw new Error("strict_label_boundary summary did not split boundary drops from missing outcome keys")
  }
  if (strictBoundaryGeneric?.droppedForBoundaryCount !== 1 || strictBoundaryGeneric?.missingOutcomeKeysCount !== 1) {
    throw new Error("strict_label_boundary generic boundary summary did not mirror the canonical stats")
  }
  if (strictSummary?.baselineBoundaryFilter?.boundaryFilteringApplied !== true) {
    throw new Error("strict_label_boundary should record boundaryFilteringApplied=true")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
