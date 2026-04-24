import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { writeJson } from "../src/lib/io.mjs"
import {
  buildPerfectPrototypeRecommendationCloseRetSidecar,
  resolvePerfectPrototypeRecommendationCloseRetSidecarPath,
} from "../src/lib/perfect_prototype_recommendation_close_ret_sidecar.mjs"
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
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "build_recommendation_close_ret_sidecar",
  })
  const candlePath = path.resolve(String(getFlag(parsed.flags, "candle-path", "")).trim())
  const sidecarPath = resolvePerfectPrototypeRecommendationCloseRetSidecarPath({
    cwd,
    sidecarPath: String(getFlag(parsed.flags, "sidecar-path", "")).trim() || null,
  })
  if (!candlePath) {
    throw new Error(
      "Usage: node tools/build_recommendation_close_ret_sidecar.mjs --candle-path=<candle_daily.jsonl> [--sidecar-path=<recommendation_close_ret_dir>] [--overwrite=true|false] [--append-latest=true|false] [--rebuild-from=YYYY-MM-DD]",
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "candlePath", filePath: candlePath },
      { label: "sidecarPath", filePath: sidecarPath },
    ],
    policy: serverPolicy,
    toolName: "build_recommendation_close_ret_sidecar",
  })
  const result = await buildPerfectPrototypeRecommendationCloseRetSidecar({
    cwd,
    candlePath,
    sidecarPath,
    overwrite: toBoolean(getFlag(parsed.flags, "overwrite", false), false),
    appendLatest: toBoolean(getFlag(parsed.flags, "append-latest", false), false),
    rebuildFrom: String(getFlag(parsed.flags, "rebuild-from", "")).trim() || null,
  })
  await writeJson(path.join(result.sidecarPath, "tool_manifest.json"), {
    version: 4,
    generatedAt: new Date().toISOString(),
    candlePath,
    sidecarPath,
    result,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
