#!/usr/bin/env node
import fsp from "node:fs/promises"
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { loadConfig } from "../src/lib/config.mjs"
import { ensureDir, toRunId, writeJson } from "../src/lib/io.mjs"
import { buildPerfectPrototypePrejumpPack } from "../src/lib/perfect_prototype_prejump_pack.mjs"
import {
  resolvePerfectPrototypePrejumpFeatureStoreDir,
  splitPerfectPrototypePrejumpPackIntoFeatureStore,
} from "../src/lib/perfect_prototype_prejump_feature_store.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "build_perfect_prototype_prejump_feature_store",
  })
  const configPath = String(
    getFlag(parsed.flags, "config", "config/lab.config.server.lite.prejump.json"),
  ).trim()
  const { config, configPath: resolvedConfigPath } = await loadConfig({ cwd, configPath })
  const startDate = String(getFlag(parsed.flags, "start", "")).trim() || null
  const endDate = String(getFlag(parsed.flags, "end", "")).trim() || null
  if (!startDate || !endDate) {
    throw new Error(
      "build_perfect_prototype_prejump_feature_store requires --start=YYYY-MM-DD and --end=YYYY-MM-DD",
    )
  }
  const featureStoreDir = resolvePerfectPrototypePrejumpFeatureStoreDir({
    cwd,
    featureStoreDir: String(getFlag(parsed.flags, "feature-store-dir", "")).trim() || null,
  })
  const tempOutDir = path.resolve(
    String(
      getFlag(
        parsed.flags,
        "temp-out-dir",
        path.join(
          cwd,
          "artifacts",
          "runs",
          `perfect_proto_prejump_feature_store_${toRunId(new Date())}`,
          "step-perfect-prototype-prejump",
        ),
      ),
    ).trim(),
  )
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "config", filePath: resolvedConfigPath },
      { label: "featureStoreDir", filePath: featureStoreDir },
      { label: "tempOutDir", filePath: tempOutDir },
    ],
    policy: serverPolicy,
    toolName: "build_perfect_prototype_prejump_feature_store",
  })
  await ensureDir(featureStoreDir)
  const tempRootDir = path.dirname(tempOutDir)
  const packResult = await buildPerfectPrototypePrejumpPack({
    cwd,
    config,
    outDir: tempOutDir,
    options: {
      startDate,
      endDate,
      emitJsonl: false,
      sourceMode: "raw",
    },
  })
  const splitResult = await splitPerfectPrototypePrejumpPackIntoFeatureStore({
    cwd,
    inputPackPath: packResult.outputPath,
    inputPackSummary: packResult.summary,
    inputPackSummaryPath: packResult.summaryPath,
    featureStoreDir,
    overwriteExisting:
      String(getFlag(parsed.flags, "overwrite-existing", "false")).trim().toLowerCase() === "true",
  })
  await writeJson(path.join(featureStoreDir, "build_manifest.json"), {
    generatedAt: new Date().toISOString(),
    configPath: resolvedConfigPath,
    tempOutDir,
    sourcePackPath: packResult.outputPath,
    sourcePackSummaryPath: packResult.summaryPath,
    featureStoreDir,
    splitManifestPath: splitResult.manifestPath,
    summary: splitResult.manifest,
  })
  if (String(getFlag(parsed.flags, "keep-temp", "false")).trim().toLowerCase() !== "true") {
    await fsp.rm(tempRootDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
