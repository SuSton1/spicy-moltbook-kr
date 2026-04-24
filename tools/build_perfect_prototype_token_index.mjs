import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { writeJson } from "../src/lib/io.mjs"
import { buildPerfectPrototypeTokenIndex } from "../src/lib/perfect_prototype_token_index.mjs"
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

const toInteger = (value, fallback = null) => {
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "build_perfect_prototype_token_index",
  })
  const inputPath = path.resolve(String(getFlag(parsed.flags, "input", "")).trim())
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  if (!inputPath || !outDir) {
    throw new Error(
      "Usage: node tools/build_perfect_prototype_token_index.mjs --input=<prejump_pack.parquet> --out-dir=<dir> [--emit-token-postings-parquet=true|false]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "input", filePath: inputPath },
      { label: "outDir", filePath: outDir },
    ],
    policy: serverPolicy,
    toolName: "build_perfect_prototype_token_index",
  })

  const result = await buildPerfectPrototypeTokenIndex({
    cwd,
    inputPath,
    outDir,
    options: {
      binCount: toInteger(getFlag(parsed.flags, "bin-count", 5), 5),
      includeSymbolToken: toBoolean(getFlag(parsed.flags, "include-symbol-token", false), false),
      includeMissingTokens: toBoolean(getFlag(parsed.flags, "include-missing-tokens", false), false),
      includeCategoricalTokens: toBoolean(
        getFlag(parsed.flags, "include-categorical-tokens", true),
        true,
      ),
      emitTokenPostingsParquet: toBoolean(
        getFlag(parsed.flags, "emit-token-postings-parquet", false),
        false,
      ),
    },
  })

  await writeJson(path.join(outDir, "tool_manifest.json"), result)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
