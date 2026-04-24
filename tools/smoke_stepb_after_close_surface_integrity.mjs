import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

const ROOT = process.cwd()
const TOOL_PATH = path.join(ROOT, "tools", "assert_stepb_after_close_surface_integrity.mjs")

const runNode = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn("node", [TOOL_PATH, ...args], {
      cwd: ROOT,
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
    child.on("error", reject)
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stepb-after-close-surface-"))
  const manifestPath = path.join(tempRoot, "manifest.json")
  const goodSummaryPath = path.join(tempRoot, "good-summary.json")
  const badSummaryPath = path.join(tempRoot, "bad-summary.json")

  await writeJson(manifestPath, {
    surface: "v3_contextual_plus_lite",
    note: "line=stepb_dplus1_plus_lite",
  })
  await writeJson(goodSummaryPath, {
    perfectPrototypeFeatureSurface: "v3_contextual_plus_lite",
    baselineLineId: "stepb_dplus1_plus_lite",
  })
  await writeJson(badSummaryPath, {
    perfectPrototypeFeatureSurface: "v3_contextual",
    baselineLineId: "stepb_dplus1_baseline",
  })

  const pass = await runNode([`--manifest=${manifestPath}`, `--stepb-summary=${goodSummaryPath}`])
  if (pass.code !== 0) {
    throw new Error(`expected matching surface check to pass\nstdout:\n${pass.stdout}\nstderr:\n${pass.stderr}`)
  }

  const fail = await runNode([`--manifest=${manifestPath}`, `--stepb-summary=${badSummaryPath}`])
  if (fail.code === 0) {
    throw new Error("expected mismatched surface check to fail")
  }
  if (!fail.stderr.includes("surface mismatch")) {
    throw new Error(`expected surface mismatch error, got stderr:\n${fail.stderr}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
