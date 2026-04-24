import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { filterTp12NoStopScopePack } from "../src/lib/tp12_no_stop_scope_filter.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback
  const text = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(text)) return true
  if (["0", "false", "no", "n", "off"].includes(text)) return false
  return fallback
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const policy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "build_tp12_no_stop_scope_filtered_pack",
  })
  const inputPath = path.resolve(String(getFlag(parsed.flags, "input", "")).trim())
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  const scopeId = String(getFlag(parsed.flags, "scope-id", "")).trim()
  const sourceRunId = String(getFlag(parsed.flags, "source-run-id", "")).trim() || null
  const sourceStageLabel = String(getFlag(parsed.flags, "source-stage-label", "")).trim() || null
  const rowContract = String(getFlag(parsed.flags, "row-contract", "open_eval_recent_impulse_1d")).trim() || "open_eval_recent_impulse_1d"
  const requireNonEmpty = toBoolean(getFlag(parsed.flags, "require-nonempty", true), true)
  if (!inputPath || !outDir || !scopeId) {
    throw new Error(
      "Usage: node tools/build_tp12_no_stop_scope_filtered_pack.mjs --input=<daily_pack.jsonl> --out-dir=<dir> --scope-id=<LOW_GAP_TOP|LOW|MID|TOP> [--source-run-id=<run>] [--source-stage-label=train|oos] [--row-contract=open_eval_recent_impulse_1d] [--require-nonempty=true|false]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "input", filePath: inputPath },
      { label: "outDir", filePath: outDir },
    ],
    policy,
    toolName: "build_tp12_no_stop_scope_filtered_pack",
  })
  const summary = await filterTp12NoStopScopePack({
    inputPath,
    outDir,
    scopeId,
    sourceRunId,
    sourceStageLabel,
    rowContract,
    requireNonEmpty,
  })
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
