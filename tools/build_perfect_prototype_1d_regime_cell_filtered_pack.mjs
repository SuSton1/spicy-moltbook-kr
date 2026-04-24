import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { filterPerfectPrototype1dRegimeCellPack } from "../src/lib/perfect_prototype_1d_regime_cell_pack_filter.mjs"
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
    toolName: "build_perfect_prototype_1d_regime_cell_filtered_pack",
  })
  const inputPath = path.resolve(String(getFlag(parsed.flags, "input", "")).trim())
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  const cellId = String(getFlag(parsed.flags, "cell-id", "")).trim()
  const sourceRunId = String(getFlag(parsed.flags, "source-run-id", "")).trim() || null
  const sourceStageLabel = String(getFlag(parsed.flags, "source-stage-label", "")).trim() || null
  const rowContract = String(getFlag(parsed.flags, "row-contract", "root_tokens")).trim() || "root_tokens"
  const requireNonEmpty = toBoolean(getFlag(parsed.flags, "require-nonempty", true), true)
  if (!inputPath || !outDir || !cellId) {
    throw new Error(
      "Usage: node tools/build_perfect_prototype_1d_regime_cell_filtered_pack.mjs --input=<daily_pack.jsonl> --out-dir=<dir> --cell-id=TOP_1D|MID_1D|LOW_1D [--source-run-id=<run>] [--source-stage-label=train|oos] [--row-contract=root_tokens|open_eval_recent_impulse_1d] [--require-nonempty=true|false]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "input", filePath: inputPath },
      { label: "outDir", filePath: outDir },
    ],
    policy,
    toolName: "build_perfect_prototype_1d_regime_cell_filtered_pack",
  })
  const summary = await filterPerfectPrototype1dRegimeCellPack({
    inputPath,
    outDir,
    cellId,
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
