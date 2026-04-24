import fs from "node:fs/promises"
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { loadConfig } from "../src/lib/config.mjs"
import { toRunId, writeJson } from "../src/lib/io.mjs"
import { buildPerfectPrototypeDailyPack } from "../src/lib/perfect_prototype_daily_pack.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"

const toInteger = (value, fallback = null) => {
  const n = Math.floor(Number(value))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

const parseCsvList = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)

const loadDecisionDatesFromFile = async (filePath) => {
  const payload = JSON.parse(await fs.readFile(filePath, "utf8"))
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.dateKeys)
      ? payload.dateKeys
      : Array.isArray(payload?.decisionDates)
        ? payload.decisionDates
        : []
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "build_perfect_prototype_daily_pack",
  })
  const configPath = String(getFlag(parsed.flags, "config", "config/lab.config.server.lite.json")).trim()
  const { config, configPath: resolvedConfigPath } = await loadConfig({ cwd, configPath })
  const rawOutDir = String(getFlag(parsed.flags, "out-dir", "")).trim()
  const outDir = rawOutDir
    ? path.resolve(rawOutDir)
    : path.join(
      cwd,
      "artifacts",
      "runs",
      String(
        getFlag(parsed.flags, "out-run-id", `perfect_proto_daily_${toRunId(new Date())}`),
      ).trim(),
      "step-perfect-prototype-daily",
    )
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "config", filePath: resolvedConfigPath },
      { label: "outDir", filePath: outDir },
    ],
    policy: serverPolicy,
    toolName: "build_perfect_prototype_daily_pack",
  })
  const excludeDecisionDatesFile = String(getFlag(parsed.flags, "exclude-decision-dates-file", "")).trim() || null
  const excludeDecisionDatesFromFile = excludeDecisionDatesFile
    ? await loadDecisionDatesFromFile(excludeDecisionDatesFile)
    : []

  const result = await buildPerfectPrototypeDailyPack({
    cwd,
    config,
    outDir,
    options: {
      startDate: String(getFlag(parsed.flags, "start", "")).trim() || null,
      endDate: String(getFlag(parsed.flags, "end", "")).trim() || null,
      limitRows: toInteger(getFlag(parsed.flags, "limit-rows", null), null),
      surfaceName: String(getFlag(parsed.flags, "surface-name", "")).trim() || null,
      sourceType: String(getFlag(parsed.flags, "source-type", "")).trim() || null,
      lineId: String(getFlag(parsed.flags, "line-id", "")).trim() || null,
      seedInputPath: String(getFlag(parsed.flags, "seed-input", "")).trim() || null,
      discoveryUniverseId: String(getFlag(parsed.flags, "discovery-universe-id", "")).trim() || null,
      requestedLookbackTradingDays: toInteger(
        getFlag(parsed.flags, "requested-lookback-trading-days", null),
        null,
      ),
      maxDecisionDates: toInteger(getFlag(parsed.flags, "max-decision-dates", null), null),
      maxRowsPerDate: toInteger(getFlag(parsed.flags, "max-rows-per-date", null), null),
      decisionDateSamplingMode: String(
        getFlag(parsed.flags, "decision-date-sampling-mode", "decision_date_stratified"),
      ).trim().toLowerCase(),
      excludeDecisionDates: [
        ...(() => {
          const raw = String(getFlag(parsed.flags, "exclude-decision-dates", "")).trim()
          return raw ? parseCsvList(raw) : []
        })(),
        ...excludeDecisionDatesFromFile,
      ],
      enabledRecentImpulseLanes: parseCsvList(getFlag(parsed.flags, "enabled-recent-impulse-lanes", "")),
      allowedStepALanes: parseCsvList(getFlag(parsed.flags, "allowed-stepa-lanes", "")),
    },
  })

  await writeJson(path.join(outDir, "manifest.json"), {
    configPath: resolvedConfigPath,
    outputPath: result.outputPath,
    summaryPath: result.summaryPath,
    datasetContract: result.summary?.datasetContract ?? null,
    discoveryUniverseId: result.summary?.discoveryUniverseId ?? null,
    requestedLookbackTradingDays: result.summary?.requestedLookbackTradingDays ?? null,
    enabledRecentImpulseLanes: result.summary?.enabledRecentImpulseLanes ?? null,
    allowedStepALanes: result.summary?.allowedStepALanes ?? null,
    includeSameDayHigh8: result.summary?.includeSameDayHigh8 ?? null,
    summary: result.summary,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
