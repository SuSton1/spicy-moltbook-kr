import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { loadConfig } from "../src/lib/config.mjs"
import { toRunId, writeJson } from "../src/lib/io.mjs"
import { buildPerfectPrototypePrejumpPack } from "../src/lib/perfect_prototype_prejump_pack.mjs"
import { resolvePerfectPrototypePrejumpFeatureStoreDir } from "../src/lib/perfect_prototype_prejump_feature_store.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"

const toInteger = (value, fallback = null) => {
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "build_perfect_prototype_prejump_pack",
  })
  const configPath = String(
    getFlag(parsed.flags, "config", "config/lab.config.server.lite.prejump.json"),
  ).trim()
  const { config, configPath: resolvedConfigPath } = await loadConfig({ cwd, configPath })
  const rawOutDir = String(getFlag(parsed.flags, "out-dir", "")).trim()
  const outDir = rawOutDir
    ? path.resolve(rawOutDir)
    : path.join(
      cwd,
      "artifacts",
      "runs",
      String(
        getFlag(parsed.flags, "out-run-id", `perfect_proto_prejump_${toRunId(new Date())}`),
      ).trim(),
      "step-perfect-prototype-prejump",
    )
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "config", filePath: resolvedConfigPath },
      { label: "outDir", filePath: outDir },
    ],
    policy: serverPolicy,
    toolName: "build_perfect_prototype_prejump_pack",
  })
  const startDate = String(getFlag(parsed.flags, "start", "")).trim() || null
  const endDate = String(getFlag(parsed.flags, "end", "")).trim() || null
  const sourceMode =
    String(getFlag(parsed.flags, "source-mode", "feature_store")).trim().toLowerCase() || "feature_store"
  const featureStoreDir =
    sourceMode === "feature_store"
      ? resolvePerfectPrototypePrejumpFeatureStoreDir({
          cwd,
          featureStoreDir: String(getFlag(parsed.flags, "feature-store-dir", "")).trim() || null,
        })
      : String(getFlag(parsed.flags, "feature-store-dir", "")).trim() || null
  if (!startDate || !endDate) {
    throw new Error(
      "build_perfect_prototype_prejump_pack requires --start=YYYY-MM-DD and --end=YYYY-MM-DD for deterministic predictive slicing.",
    )
  }

  const result = await buildPerfectPrototypePrejumpPack({
    cwd,
    config,
    outDir,
    options: {
      startDate,
      endDate,
      limitRows: toInteger(getFlag(parsed.flags, "limit-rows", null), null),
      maxDecisionDates: toInteger(getFlag(parsed.flags, "max-decision-dates", null), null),
      maxRowsPerDate: toInteger(getFlag(parsed.flags, "max-rows-per-date", null), null),
      decisionDateSamplingMode: String(
        getFlag(parsed.flags, "decision-date-sampling-mode", "decision_date_stratified"),
      ).trim().toLowerCase(),
      emitJsonl: String(getFlag(parsed.flags, "emit-jsonl", "false")).trim().toLowerCase() === "true",
      sourceMode,
      featureStoreDir,
    },
  })

  await writeJson(path.join(outDir, "manifest.json"), {
    configPath: resolvedConfigPath,
    outputPath: result.outputPath,
    outputJsonlPath: result.summary?.outputJsonlPath ?? null,
    schemaPath: result.summary?.schemaPath ?? path.join(outDir, "schema.json"),
    summaryPath: result.summaryPath,
    summary: result.summary,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
