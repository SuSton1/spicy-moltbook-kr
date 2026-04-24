import { spawn } from "node:child_process"
import path from "node:path"

const ROOT = process.cwd()
const WRAPPER = path.join(ROOT, "tools", "server_run_stepb_dplus1_baseline.sh")

const runWrapper = (args) =>
  new Promise((resolve) => {
    const child = spawn("bash", [WRAPPER, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        STOCKDESK_SERVER_REPO_ROOT: ROOT,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (error) => {
      resolve({
        code: -1,
        stdout,
        stderr: `${stderr}${String(error?.stack || error?.message || error)}`,
      })
    })
    child.on("exit", (code) => {
      resolve({
        code: Number(code ?? -1),
        stdout,
        stderr,
      })
    })
  })

const expectFatal = async ({ name, args, pattern }) => {
  const result = await runWrapper(args)
  if (result.code === 0) {
    throw new Error(`${name}: expected non-zero exit`)
  }
  const combined = `${result.stdout}\n${result.stderr}`
  if (!pattern.test(combined)) {
    throw new Error(`${name}: expected ${pattern} in output, got:\n${combined}`)
  }
}

const main = async () => {
  await expectFatal({
    name: "missing split policy",
    args: [],
    pattern: /missing --split-policy/i,
  })
  await expectFatal({
    name: "reversed train range",
    args: [
      "--split-policy=decision_date_only",
      "--train-start=2024-12-31",
      "--train-end=2024-01-01",
    ],
    pattern: /invalid train range/i,
  })
  await expectFatal({
    name: "reversed oos range",
    args: [
      "--split-policy=decision_date_only",
      "--oos-start=2026-01-31",
      "--oos-end=2025-01-01",
    ],
    pattern: /invalid OOS range/i,
  })
  await expectFatal({
    name: "overlapping windows",
    args: [
      "--split-policy=strict_label_boundary",
      "--train-end=2025-01-02",
      "--oos-start=2025-01-01",
    ],
    pattern: /must not overlap/i,
  })
  await expectFatal({
    name: "baseline no-gap lock",
    args: [
      "--split-policy=decision_date_only",
      "--max-gap=40",
    ],
    pattern: /locked to historical no-gap semantics/i,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
