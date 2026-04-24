import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

import { buildPerfectPrototypeCatalog } from "../src/lib/perfect_prototype_catalog.mjs"
import {
  buildPerfectPrototypeCatalogManifest,
  resolvePerfectPrototypeCatalogManifestPath,
} from "../src/lib/perfect_prototype_catalog_manifest.mjs"
import { writeJson, readJsonl, writeJsonl } from "../src/lib/io.mjs"
import { buildPerfectPrototypeDailyPack } from "../src/lib/perfect_prototype_daily_pack.mjs"
import { preparePerfectPrototypeMiningSnapshot } from "../src/lib/perfect_prototype_miner.mjs"
import { inferPerfectPrototypeDatasetContract } from "../src/lib/perfect_prototype_prejump_contract.mjs"

const ROOT = process.cwd()
const APPLY_TOOL_PATH = path.join(ROOT, "tools", "apply_perfect_prototypes.mjs")
const REPORT_TOOL_PATH = path.join(ROOT, "tools", "report_perfect_prototypes_oos.mjs")

const makeDate = (day) => `2024-04-${String(day).padStart(2, "0")}`

const buildConfig = (dataDir, lookbackTradingDays) => ({
  template: {
    localWindow: 3,
    globalWindow: 4,
    featureAsOf: "t-1",
  },
  backtest: {
    entry: "NEXT_DAY_OPEN",
    holdDays: 3,
    targetPct: 0.08,
    stopLossPct: 0.04,
  },
  event: {
    highJumpMode: "FROM_OPEN_EX_GAP",
    highJumpThreshold: 0.08,
    recentImpulseDiscovery: {
      enabled: true,
      lookbackTradingDays,
    },
  },
  lightweight: {
    stepB: {
      perfectPrototypeBaseline: {
        enabled: true,
        contractVersion: 2,
        lineId: "stepb_dplus1_plus_lite",
        strategyMode: "STEPB_DPLUS1_BASELINE_V1",
        contextSurface: "v3_contextual_plus_lite",
        entryRule: "NEXT_DAY_OPEN",
        holdDays: 3,
        targetPct: 0.08,
        stopLossPct: 0.04,
        featureAsOf: "t-1",
        exactCollectionMode: "train_precision_1_only",
        maxGapTradingDays: 100000,
      },
    },
  },
  filters: {},
  periods: {
    warmup: { from: makeDate(1), to: makeDate(2) },
    discovery: { from: makeDate(5), to: makeDate(8) },
    online: { from: makeDate(9), to: makeDate(9) },
    lockbox: { from: makeDate(10), to: makeDate(10) },
  },
  dataPaths: {
    candleDailyJsonl: path.join(dataDir, "candles.jsonl"),
    universeJsonl: path.join(dataDir, "universe.jsonl"),
    symbolMasterJsonl: path.join(dataDir, "symbol_master.jsonl"),
    hourly60mJsonl: path.join(dataDir, "hourly60m.jsonl"),
    newsJsonl: path.join(dataDir, "optional_empty.jsonl"),
  },
})

const runNode = (toolPath, args, cwd, env) =>
  new Promise((resolve, reject) => {
    const child = spawn("node", [toolPath, ...args], {
      cwd,
      env,
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

const main = async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pp-pack-catalog-guard-"))
  const dataDir = path.join(tempRoot, "data")
  const afreePackDir = path.join(tempRoot, "artifacts", "runs", "afree-pack", "step-perfect-prototype-open-pack")
  const recentPackDir = path.join(tempRoot, "artifacts", "runs", "recent-pack", "step-perfect-prototype-open-pack")
  const widenedPackDir = path.join(tempRoot, "artifacts", "runs", "widened-pack", "step-perfect-prototype-open-pack")
  const catalogDir = path.join(tempRoot, "artifacts", "curated", "frozen", "guard-catalog")
  const catalogPath = path.join(catalogDir, "catalog.json")
  const widenedCatalogDir = path.join(tempRoot, "artifacts", "curated", "frozen", "guard-catalog-widened")
  const widenedCatalogPath = path.join(widenedCatalogDir, "catalog.json")
  const recentSeedInputPath = path.join(tempRoot, "stepa_recent.jsonl")
  await fs.mkdir(dataDir, { recursive: true })

  const candles = []
  const universe = []
  for (let index = 1; index <= 10; index += 1) {
    const dateKey = makeDate(index)
    const open = 100 + index
    const close = open + (index % 3 === 0 ? 1.6 : 0.8)
    candles.push({
      symbol: "000001",
      dateKey,
      open,
      high: close + 1.2,
      low: open - 0.6,
      close,
      volume: 1000000 - index * 2500,
    })
    universe.push({
      symbol: "000001",
      dateKey,
      marketCapKrw: 100000000000,
      avgTradingValue20d: 1000000000,
    })
  }
  await writeJsonl(path.join(dataDir, "candles.jsonl"), candles)
  await writeJsonl(path.join(dataDir, "universe.jsonl"), universe)
  await writeJsonl(path.join(dataDir, "symbol_master.jsonl"), [{ symbol: "000001", name: "Alpha" }])
  await writeJsonl(path.join(dataDir, "hourly60m.jsonl"), [])
  await writeJsonl(path.join(dataDir, "optional_empty.jsonl"), [])
  await writeJsonl(recentSeedInputPath, [
    {
      symbol: "000001",
      dateKey: makeDate(5),
      asOfDateKey: makeDate(4),
      stepALaneId: "same_day_high8",
      impulseSourceDateKey: makeDate(5),
      impulseLookbackDays: 0,
    },
    {
      symbol: "000001",
      dateKey: makeDate(6),
      asOfDateKey: makeDate(5),
      stepALaneId: "recent_impulse_1d",
      impulseSourceDateKey: makeDate(5),
      impulseLookbackDays: 1,
    },
  ])

  process.env.STOCKDESK_SERVER_REPO_ROOT = tempRoot
  await buildPerfectPrototypeDailyPack({
    cwd: tempRoot,
    config: buildConfig(dataDir, 3),
    outDir: afreePackDir,
    options: {
      startDate: makeDate(5),
      endDate: makeDate(8),
      surfaceName: "v3_contextual_plus_lite",
      sourceType: "perfect_prototype_stepb_open_eval_pack",
      lineId: "stepb_dplus1_plus_lite",
      discoveryUniverseId: "afree_open",
      requestedLookbackTradingDays: 3,
    },
  })
  await buildPerfectPrototypeDailyPack({
    cwd: tempRoot,
    config: buildConfig(dataDir, 1),
    outDir: recentPackDir,
    options: {
      startDate: makeDate(5),
      endDate: makeDate(8),
      surfaceName: "v3_contextual_plus_lite",
      sourceType: "perfect_prototype_stepb_open_eval_pack",
      lineId: "stepb_dplus1_plus_lite",
      seedInputPath: recentSeedInputPath,
      discoveryUniverseId: "recent_impulse_upto_1d",
      requestedLookbackTradingDays: 1,
      enabledRecentImpulseLanes: ["recent_impulse_1d"],
    },
  })
  await buildPerfectPrototypeDailyPack({
    cwd: tempRoot,
    config: buildConfig(dataDir, 1),
    outDir: widenedPackDir,
    options: {
      startDate: makeDate(5),
      endDate: makeDate(8),
      surfaceName: "v3_contextual_plus_lite",
      sourceType: "perfect_prototype_stepb_open_eval_pack",
      lineId: "stepb_dplus1_plus_lite",
      seedInputPath: recentSeedInputPath,
      discoveryUniverseId: "same_day_plus_recent_upto_1d",
      requestedLookbackTradingDays: 1,
      enabledRecentImpulseLanes: ["recent_impulse_1d"],
      allowedStepALanes: ["same_day_high8", "recent_impulse_1d"],
    },
  })

  const afreeRows = await readJsonl(path.join(afreePackDir, "daily_pack.jsonl"))
  const prepared = preparePerfectPrototypeMiningSnapshot({
    rows: afreeRows,
    options: {
      surfaceName: "v3_contextual_plus_lite",
    },
  })
  const positiveRowCount = afreeRows.filter((row) => row?.outcomeHitTarget === true).length
  const negativeRowCount = afreeRows.filter((row) => row?.outcomeHitTarget === false).length
  const catalog = buildPerfectPrototypeCatalog({
    tokenizerSpec: prepared.snapshot.tokenizerSpec,
    rules: [],
    rows: afreeRows,
    matches: [],
    dedupedMatches: [],
    metadata: {
      datasetContract: inferPerfectPrototypeDatasetContract(afreeRows),
      surfaceName: "v3_contextual_plus_lite",
      sourceRunId: "smoke_pack_catalog_guard_afree",
    },
    datasetStats: {
      rowCount: afreeRows.length,
      positiveRowCount,
      negativeRowCount,
    },
  })
  const manifest = buildPerfectPrototypeCatalogManifest({
    catalog,
    catalogPath,
  })
  await writeJson(catalogPath, catalog)
  await writeJson(resolvePerfectPrototypeCatalogManifestPath(catalogPath), manifest)

  const commonArgs = [
    `--input=${path.join(recentPackDir, "daily_pack.jsonl")}`,
    `--catalog=${catalogPath}`,
    `--start=${makeDate(5)}`,
    `--end=${makeDate(8)}`,
    `--expected-catalog-sha256=${catalog.metadata.catalogContentSha256}`,
    `--expected-rule-ids-sha256=${catalog.metadata.ruleIdsSha256}`,
  ]
  const env = {
    ...process.env,
    STOCKDESK_SERVER_REPO_ROOT: tempRoot,
  }

  const applyResult = await runNode(
    APPLY_TOOL_PATH,
    [...commonArgs, `--out-dir=${path.join(tempRoot, "apply-out")}`],
    tempRoot,
    env,
  )
  if (applyResult.code === 0) {
    throw new Error("expected apply_perfect_prototypes to fail on pack/catalog discovery-universe mismatch")
  }
  if (!applyResult.stderr.includes("Perfect prototype dataset contract mismatch")) {
    throw new Error(`expected apply mismatch error, got stderr:\n${applyResult.stderr}`)
  }

  const reportResult = await runNode(
    REPORT_TOOL_PATH,
    [...commonArgs, `--out-dir=${path.join(tempRoot, "report-out")}`],
    tempRoot,
    env,
  )
  if (reportResult.code === 0) {
    throw new Error("expected report_perfect_prototypes_oos to fail on pack/catalog discovery-universe mismatch")
  }
  if (!reportResult.stderr.includes("Perfect prototype dataset contract mismatch")) {
    throw new Error(`expected report mismatch error, got stderr:\n${reportResult.stderr}`)
  }

  const widenedRows = await readJsonl(path.join(widenedPackDir, "daily_pack.jsonl"))
  const widenedPrepared = preparePerfectPrototypeMiningSnapshot({
    rows: widenedRows,
    options: {
      surfaceName: "v3_contextual_plus_lite",
    },
  })
  const widenedPositiveRowCount = widenedRows.filter((row) => row?.outcomeHitTarget === true).length
  const widenedNegativeRowCount = widenedRows.filter((row) => row?.outcomeHitTarget === false).length
  const widenedCatalog = buildPerfectPrototypeCatalog({
    tokenizerSpec: widenedPrepared.snapshot.tokenizerSpec,
    rules: [],
    rows: widenedRows,
    matches: [],
    dedupedMatches: [],
    metadata: {
      datasetContract: inferPerfectPrototypeDatasetContract(widenedRows),
      surfaceName: "v3_contextual_plus_lite",
      sourceRunId: "smoke_pack_catalog_guard_widened",
    },
    datasetStats: {
      rowCount: widenedRows.length,
      positiveRowCount: widenedPositiveRowCount,
      negativeRowCount: widenedNegativeRowCount,
    },
  })
  const widenedManifest = buildPerfectPrototypeCatalogManifest({
    catalog: widenedCatalog,
    catalogPath: widenedCatalogPath,
  })
  await writeJson(widenedCatalogPath, widenedCatalog)
  await writeJson(resolvePerfectPrototypeCatalogManifestPath(widenedCatalogPath), widenedManifest)

  const widenedMismatchArgs = [
    `--input=${path.join(recentPackDir, "daily_pack.jsonl")}`,
    `--catalog=${widenedCatalogPath}`,
    `--start=${makeDate(5)}`,
    `--end=${makeDate(8)}`,
    `--expected-catalog-sha256=${widenedCatalog.metadata.catalogContentSha256}`,
    `--expected-rule-ids-sha256=${widenedCatalog.metadata.ruleIdsSha256}`,
  ]
  const widenedApplyResult = await runNode(
    APPLY_TOOL_PATH,
    [...widenedMismatchArgs, `--out-dir=${path.join(tempRoot, "apply-out-widened")}`],
    tempRoot,
    env,
  )
  if (widenedApplyResult.code === 0) {
    throw new Error("expected apply_perfect_prototypes to fail on recent-only vs widened pack/catalog mismatch")
  }
  if (!widenedApplyResult.stderr.includes("Perfect prototype dataset contract mismatch")) {
    throw new Error(`expected widened apply mismatch error, got stderr:\n${widenedApplyResult.stderr}`)
  }

  const widenedReportResult = await runNode(
    REPORT_TOOL_PATH,
    [...widenedMismatchArgs, `--out-dir=${path.join(tempRoot, "report-out-widened")}`],
    tempRoot,
    env,
  )
  if (widenedReportResult.code === 0) {
    throw new Error("expected report_perfect_prototypes_oos to fail on recent-only vs widened pack/catalog mismatch")
  }
  if (!widenedReportResult.stderr.includes("Perfect prototype dataset contract mismatch")) {
    throw new Error(`expected widened report mismatch error, got stderr:\n${widenedReportResult.stderr}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
