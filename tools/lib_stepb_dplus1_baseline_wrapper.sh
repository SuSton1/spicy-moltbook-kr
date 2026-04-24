#!/usr/bin/env bash

compute_sha256() {
  sha256sum "$1" | awk '{print $1}'
}

validate_baseline_contract_config() {
  local config_path="$1"
  local expected_line_id="$2"
  local expected_max_gap="$3"
  local expected_surface="${4:-v3_contextual}"
  node --input-type=module - "$config_path" "$expected_line_id" "$expected_max_gap" "$expected_surface" <<'NODE'
import { loadConfig } from "./src/lib/config.mjs"

const [configPath, expectedLineId, expectedMaxGapRaw, expectedSurface] = process.argv.slice(2)
const expectedMaxGap = Number(expectedMaxGapRaw)
const { config } = await loadConfig({
  configPath,
  cwd: process.cwd(),
})
const baseline = config?.lightweight?.stepB?.perfectPrototypeBaseline ?? null
const issues = []
const topLevelFeatureAsOf = String(config?.template?.featureAsOf ?? "").trim().toLowerCase()
const topLevelEntryRule = String(config?.backtest?.entry ?? "").trim().toUpperCase()
const topLevelHoldDays = Number(config?.backtest?.holdDays)
const topLevelTargetPct = Number(config?.backtest?.targetPct)
const topLevelStopLossPct = Number(config?.backtest?.stopLossPct)
if (baseline?.enabled !== true) {
  issues.push("lightweight.stepB.perfectPrototypeBaseline.enabled must be true")
}
if (String(baseline?.lineId ?? "").trim() !== expectedLineId) {
  issues.push(`lineId must be ${expectedLineId}`)
}
if (Number(baseline?.contractVersion) < 2) {
  issues.push("contractVersion must be >= 2 for self-contained baseline contract")
}
if (String(baseline?.strategyMode ?? "").trim().toUpperCase() !== "STEPB_DPLUS1_BASELINE_V1") {
  issues.push("strategyMode must be STEPB_DPLUS1_BASELINE_V1")
}
if (String(baseline?.contextSurface ?? "").trim().toLowerCase() !== String(expectedSurface ?? "").trim().toLowerCase()) {
  issues.push(`contextSurface must be ${expectedSurface}`)
}
if (String(baseline?.entryRule ?? "").trim().toUpperCase() !== "NEXT_DAY_OPEN") {
  issues.push("entryRule must be NEXT_DAY_OPEN")
}
if (String(baseline?.featureAsOf ?? "").trim().toLowerCase() !== "t-1") {
  issues.push("featureAsOf must be explicitly set to t-1")
}
if (String(baseline?.exactCollectionMode ?? "").trim().toLowerCase() !== "train_precision_1_only") {
  issues.push("exactCollectionMode must be explicitly set to train_precision_1_only")
}
if (Number(baseline?.maxGapTradingDays) !== expectedMaxGap) {
  issues.push(`maxGapTradingDays must be explicitly set to ${expectedMaxGap}`)
}
if (topLevelFeatureAsOf && topLevelFeatureAsOf !== String(baseline?.featureAsOf ?? "").trim().toLowerCase()) {
  issues.push("template.featureAsOf must match lightweight.stepB.perfectPrototypeBaseline.featureAsOf")
}
if (topLevelEntryRule && topLevelEntryRule !== String(baseline?.entryRule ?? "").trim().toUpperCase()) {
  issues.push("backtest.entry must match lightweight.stepB.perfectPrototypeBaseline.entryRule")
}
if (Number.isFinite(topLevelHoldDays) && topLevelHoldDays !== Number(baseline?.holdDays)) {
  issues.push("backtest.holdDays must match lightweight.stepB.perfectPrototypeBaseline.holdDays")
}
if (Number.isFinite(topLevelTargetPct) && topLevelTargetPct !== Number(baseline?.targetPct)) {
  issues.push("backtest.targetPct must match lightweight.stepB.perfectPrototypeBaseline.targetPct")
}
if (Number.isFinite(topLevelStopLossPct) && topLevelStopLossPct !== Number(baseline?.stopLossPct)) {
  issues.push("backtest.stopLossPct must match lightweight.stepB.perfectPrototypeBaseline.stopLossPct")
}
if (issues.length > 0) {
  throw new Error(`invalid Step-B D+1 baseline config: ${issues.join(" | ")}`)
}
NODE
}

write_period_config() {
  local base_config="$1"
  local out_config="$2"
  local from_date="$3"
  local to_date="$4"
  local split_policy="$5"
  node --input-type=module - "$base_config" "$out_config" "$from_date" "$to_date" "$split_policy" <<'NODE'
import fs from "node:fs/promises"
import path from "node:path"

import { loadConfig, resolvePeriods } from "./src/lib/config.mjs"

const [configPath, outPath, fromDate, toDate, splitPolicy] = process.argv.slice(2)
const { config } = await loadConfig({
  configPath,
  cwd: process.cwd(),
})
const periods = resolvePeriods(config)
const next = {
  ...config,
  periods: {
    warmup: periods.warmup,
    discovery: {
      from: fromDate,
      to: toDate,
    },
    online: periods.online,
    lockbox: periods.lockbox,
  },
  lightweight: {
    ...(config?.lightweight ?? {}),
    stepB: {
      ...(config?.lightweight?.stepB ?? {}),
      perfectPrototypeBaseline: {
        ...(config?.lightweight?.stepB?.perfectPrototypeBaseline ?? {}),
        enabled: true,
        splitPolicy,
      },
    },
  },
}
await fs.mkdir(path.dirname(outPath), { recursive: true })
await fs.writeFile(outPath, `${JSON.stringify(next, null, 2)}\n`, "utf8")
NODE
}

rewrite_recent_impulse_runtime_config() {
  local config_path="$1"
  local lookback_days="$2"
  node --input-type=module - "$config_path" "$lookback_days" <<'NODE'
import fs from "node:fs/promises"

const [configPath, lookbackDaysRaw] = process.argv.slice(2)
const lookbackDays = Number(lookbackDaysRaw)
const next = JSON.parse(await fs.readFile(configPath, "utf8"))
next.event = {
  ...(next?.event ?? {}),
  recentImpulseDiscovery: {
    ...(next?.event?.recentImpulseDiscovery ?? {}),
    enabled: true,
    lookbackTradingDays: lookbackDays,
  },
}
await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8")
NODE
}

validate_recent_impulse_runtime_config() {
  local config_path="$1"
  local expected_lookback_days="$2"
  node --input-type=module - "$config_path" "$expected_lookback_days" <<'NODE'
import { loadConfig } from "./src/lib/config.mjs"

const [configPath, expectedLookbackDaysRaw] = process.argv.slice(2)
const expectedLookbackDays = Number(expectedLookbackDaysRaw)
const { config } = await loadConfig({
  configPath,
  cwd: process.cwd(),
})
const recentImpulseDiscovery = config?.event?.recentImpulseDiscovery
if (recentImpulseDiscovery?.enabled !== true) {
  throw new Error("stepb_dplus1_plus_lite requires event.recentImpulseDiscovery.enabled=true")
}
if (Number(recentImpulseDiscovery?.lookbackTradingDays) !== expectedLookbackDays) {
  throw new Error(
    `stepb_dplus1_plus_lite requires event.recentImpulseDiscovery.lookbackTradingDays=${expectedLookbackDays}, got ${recentImpulseDiscovery?.lookbackTradingDays ?? "null"}`,
  )
}
NODE
}

apply_strict_label_boundary() {
  local step_b_dir="$1"
  local from_date="$2"
  local to_date="$3"
  local split_policy="$4"
  node --input-type=module - "$step_b_dir" "$from_date" "$to_date" "$split_policy" <<'NODE'
import fs from "node:fs/promises"
import path from "node:path"
import { createReadStream } from "node:fs"
import readline from "node:readline"

const [stepBDir, fromDate, toDate, splitPolicy] = process.argv.slice(2)
if (splitPolicy !== "strict_label_boundary" && splitPolicy !== "decision_date_only") process.exit(0)

const summaryPath = path.join(stepBDir, "step_b_summary.json")
const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"))

if (splitPolicy === "decision_date_only") {
  const templatesBefore = Number(summary?.templates ?? 0)
  const positiveTemplates = Number(summary?.positiveTemplates ?? 0)
  const negativeTemplates = Number(summary?.negativeTemplates ?? 0)
  summary.splitPolicy = splitPolicy
  summary.perfectPrototypeBaselineContract = {
    ...(summary?.perfectPrototypeBaselineContract ?? {}),
    splitPolicy,
  }
  summary.baselineBoundaryFilter = {
    mode: splitPolicy,
    discoveryFrom: fromDate,
    discoveryTo: toDate,
    templatesBefore,
    templatesAfter: templatesBefore,
    positiveTemplates,
    negativeTemplates,
    droppedForBoundaryCount: 0,
    missingOutcomeKeysCount: 0,
    missingEntryDateKeyCount: 0,
    missingExitDateKeyCount: 0,
    missingBothOutcomeKeysCount: 0,
    droppedEntryBeforeBoundaryCount: 0,
    droppedExitAfterBoundaryCount: 0,
    requiredOutcomeKeys: ["entryDateKey", "exitDateKey"],
    boundaryFilteringApplied: false,
    boundaryFilteringSkipped: true,
    boundaryFilteringSkipReason: "decision_date_only",
  }
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
  await fs.writeFile(
    path.join(stepBDir, "boundary_filter_summary.json"),
    `${JSON.stringify(summary.baselineBoundaryFilter, null, 2)}\n`,
    "utf8",
  )
  await fs.writeFile(
    path.join(stepBDir, "decision_date_only_boundary_summary.json"),
    `${JSON.stringify(summary.baselineBoundaryFilter, null, 2)}\n`,
    "utf8",
  )
  process.exit(0)
}

const candidateFiles = [
  path.join(stepBDir, "templates_lite.jsonl"),
  path.join(stepBDir, "templates.jsonl"),
  path.join(stepBDir, "templates_runtime_pack.jsonl"),
]

let canonicalStats = null
for (const filePath of candidateFiles) {
  try {
    await fs.access(filePath)
  } catch {
    continue
  }
  const tempPath = `${filePath}.tmp`
  const handle = await fs.open(tempPath, "w")
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })
  let before = 0
  let after = 0
  let positive = 0
  let negative = 0
  let missingOutcomeKeysCount = 0
  let missingEntryDateKeyCount = 0
  let missingExitDateKeyCount = 0
  let missingBothOutcomeKeysCount = 0
  let droppedForBoundaryCount = 0
  let droppedEntryBeforeBoundaryCount = 0
  let droppedExitAfterBoundaryCount = 0
  try {
    for await (const line of rl) {
      const trimmed = String(line ?? "").trim()
      if (!trimmed) continue
      const row = JSON.parse(trimmed)
      before += 1
      const entryDateKey = String(row?.eventOutcome?.entryDateKey ?? "").trim()
      const exitDateKey = String(row?.eventOutcome?.exitDateKey ?? "").trim()
      const missingEntryDateKey = !entryDateKey
      const missingExitDateKey = !exitDateKey
      if (missingEntryDateKey || missingExitDateKey) {
        missingOutcomeKeysCount += 1
        if (missingEntryDateKey) missingEntryDateKeyCount += 1
        if (missingExitDateKey) missingExitDateKeyCount += 1
        if (missingEntryDateKey && missingExitDateKey) missingBothOutcomeKeysCount += 1
        continue
      }
      const entryBeforeBoundary = entryDateKey < fromDate
      const exitAfterBoundary = exitDateKey > toDate
      if (entryBeforeBoundary || exitAfterBoundary) {
        droppedForBoundaryCount += 1
        if (entryBeforeBoundary) droppedEntryBeforeBoundaryCount += 1
        if (exitAfterBoundary) droppedExitAfterBoundaryCount += 1
        continue
      }
      after += 1
      if (Number(row?.label ?? 0) === 1) {
        positive += 1
      } else {
        negative += 1
      }
      await handle.write(`${JSON.stringify(row)}\n`)
    }
  } finally {
    await handle.close()
    rl.close()
  }
  await fs.rename(tempPath, filePath)
  if (!canonicalStats) {
    canonicalStats = {
      before,
      after,
      positive,
      negative,
      missingOutcomeKeysCount,
      missingEntryDateKeyCount,
      missingExitDateKeyCount,
      missingBothOutcomeKeysCount,
      droppedForBoundaryCount,
      droppedEntryBeforeBoundaryCount,
      droppedExitAfterBoundaryCount,
    }
  }
}

if (!canonicalStats) {
  process.exit(0)
}

summary.templates = canonicalStats.after
summary.positiveTemplates = canonicalStats.positive
summary.negativeTemplates = canonicalStats.negative
summary.splitPolicy = splitPolicy
summary.perfectPrototypeBaselineContract = {
  ...(summary?.perfectPrototypeBaselineContract ?? {}),
  splitPolicy,
}
summary.baselineBoundaryFilter = {
  mode: splitPolicy,
  discoveryFrom: fromDate,
  discoveryTo: toDate,
  templatesBefore: canonicalStats.before,
  templatesAfter: canonicalStats.after,
  droppedForBoundaryCount: canonicalStats.droppedForBoundaryCount,
  missingOutcomeKeysCount: canonicalStats.missingOutcomeKeysCount,
  missingEntryDateKeyCount: canonicalStats.missingEntryDateKeyCount,
  missingExitDateKeyCount: canonicalStats.missingExitDateKeyCount,
  missingBothOutcomeKeysCount: canonicalStats.missingBothOutcomeKeysCount,
  droppedEntryBeforeBoundaryCount: canonicalStats.droppedEntryBeforeBoundaryCount,
  droppedExitAfterBoundaryCount: canonicalStats.droppedExitAfterBoundaryCount,
  requiredOutcomeKeys: ["entryDateKey", "exitDateKey"],
  boundaryFilteringApplied: true,
  boundaryFilteringSkipped: false,
  boundaryFilteringSkipReason: null,
}
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
await fs.writeFile(
  path.join(stepBDir, "boundary_filter_summary.json"),
  `${JSON.stringify(summary.baselineBoundaryFilter, null, 2)}\n`,
  "utf8",
)
await fs.writeFile(
  path.join(stepBDir, "strict_label_boundary_summary.json"),
  `${JSON.stringify(summary.baselineBoundaryFilter, null, 2)}\n`,
  "utf8",
)
NODE
}

apply_strict_label_boundary_to_daily_pack() {
  local pack_dir="$1"
  local from_date="$2"
  local to_date="$3"
  local split_policy="$4"
  node --input-type=module - "$pack_dir" "$from_date" "$to_date" "$split_policy" <<'NODE'
import fs from "node:fs/promises"
import path from "node:path"
import { createReadStream } from "node:fs"
import readline from "node:readline"

const [packDir, fromDate, toDate, splitPolicy] = process.argv.slice(2)
if (splitPolicy !== "strict_label_boundary" && splitPolicy !== "decision_date_only") process.exit(0)

const summaryPath = path.join(packDir, "summary.json")
const manifestPath = path.join(packDir, "manifest.json")
const outputPath = path.join(packDir, "daily_pack.jsonl")
const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"))
let manifest = null
try {
  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
} catch {
  manifest = null
}

const writeBoundaryArtifacts = async (payload) => {
  await fs.writeFile(
    path.join(packDir, "boundary_filter_summary.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  )
  await fs.writeFile(
    path.join(packDir, `${splitPolicy}_boundary_summary.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  )
}

const updateSummaryAndManifest = async (boundaryFilter, stats = null) => {
  summary.splitPolicy = splitPolicy
  summary.boundaryFilter = boundaryFilter
  if (stats) {
    summary.rowsWritten = stats.after
    summary.positiveRows = stats.positive
    summary.negativeRows = stats.negative
    summary.nullOutcomeRows = stats.nullOutcome
    summary.uniqueSymbols = stats.uniqueSymbols
    summary.outputCoverage = {
      from: stats.coverageFrom,
      to: stats.coverageTo,
      count: stats.coverageCount,
    }
    if (summary?.datasetContract && typeof summary.datasetContract === "object") {
      summary.datasetContract = {
        ...summary.datasetContract,
        rowCount: stats.after,
        minDateKey: stats.coverageFrom,
        maxDateKey: stats.coverageTo,
      }
    }
  }
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
  if (manifest && typeof manifest === "object") {
    if (summary?.datasetContract && typeof summary.datasetContract === "object") {
      manifest.datasetContract = {
        ...summary.datasetContract,
      }
    }
    if (summary?.discoveryUniverseId != null) {
      manifest.discoveryUniverseId = summary.discoveryUniverseId
    }
    if (summary?.requestedLookbackTradingDays != null) {
      manifest.requestedLookbackTradingDays = summary.requestedLookbackTradingDays
    }
    if (Array.isArray(summary?.enabledRecentImpulseLanes)) {
      manifest.enabledRecentImpulseLanes = summary.enabledRecentImpulseLanes.slice()
    }
    manifest.summary = {
      ...(manifest.summary && typeof manifest.summary === "object" ? manifest.summary : {}),
      ...summary,
    }
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  }
  await writeBoundaryArtifacts(boundaryFilter)
}

if (splitPolicy === "decision_date_only") {
  const rowsWritten = Number(summary?.rowsWritten ?? 0)
  const boundaryFilter = {
    mode: splitPolicy,
    discoveryFrom: fromDate,
    discoveryTo: toDate,
    rowsBefore: rowsWritten,
    rowsAfter: rowsWritten,
    droppedForBoundaryCount: 0,
    missingOutcomeKeysCount: 0,
    missingEntryDateKeyCount: 0,
    missingExitDateKeyCount: 0,
    missingBothOutcomeKeysCount: 0,
    droppedEntryBeforeBoundaryCount: 0,
    droppedExitAfterBoundaryCount: 0,
    requiredOutcomeKeys: ["entryDateKey", "exitDateKey"],
    boundaryFilteringApplied: false,
    boundaryFilteringSkipped: true,
    boundaryFilteringSkipReason: "decision_date_only",
  }
  await updateSummaryAndManifest(boundaryFilter)
  process.exit(0)
}

const tempPath = `${outputPath}.tmp`
const handle = await fs.open(tempPath, "w")
const rl = readline.createInterface({
  input: createReadStream(outputPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
})
let before = 0
let after = 0
let positive = 0
let negative = 0
let nullOutcome = 0
let missingOutcomeKeysCount = 0
let missingEntryDateKeyCount = 0
let missingExitDateKeyCount = 0
let missingBothOutcomeKeysCount = 0
let droppedForBoundaryCount = 0
let droppedEntryBeforeBoundaryCount = 0
let droppedExitAfterBoundaryCount = 0
const uniqueSymbols = new Set()
const uniqueDates = new Set()
try {
  for await (const line of rl) {
    const trimmed = String(line ?? "").trim()
    if (!trimmed) continue
    const row = JSON.parse(trimmed)
    before += 1
    const entryDateKey = String(row?.eventOutcome?.entryDateKey ?? "").trim()
    const exitDateKey = String(row?.eventOutcome?.exitDateKey ?? "").trim()
    const missingEntryDateKey = !entryDateKey
    const missingExitDateKey = !exitDateKey
    if (missingEntryDateKey || missingExitDateKey) {
      missingOutcomeKeysCount += 1
      if (missingEntryDateKey) missingEntryDateKeyCount += 1
      if (missingExitDateKey) missingExitDateKeyCount += 1
      if (missingEntryDateKey && missingExitDateKey) missingBothOutcomeKeysCount += 1
      continue
    }
    const entryBeforeBoundary = entryDateKey < fromDate
    const exitAfterBoundary = exitDateKey > toDate
    if (entryBeforeBoundary || exitAfterBoundary) {
      droppedForBoundaryCount += 1
      if (entryBeforeBoundary) droppedEntryBeforeBoundaryCount += 1
      if (exitAfterBoundary) droppedExitAfterBoundaryCount += 1
      continue
    }
    after += 1
    if (row?.outcomeHitTarget === true) {
      positive += 1
    } else if (row?.outcomeHitTarget === false) {
      negative += 1
    } else {
      nullOutcome += 1
    }
    const symbol = String(row?.symbol ?? "").trim()
    const dateKey = String(row?.decisionDateKey ?? row?.dateKey ?? "").trim()
    if (symbol) uniqueSymbols.add(symbol)
    if (dateKey) uniqueDates.add(dateKey)
    await handle.write(`${JSON.stringify(row)}\n`)
  }
} finally {
  await handle.close()
  rl.close()
}
await fs.rename(tempPath, outputPath)
const orderedDates = Array.from(uniqueDates).sort((left, right) => String(left).localeCompare(String(right)))
const boundaryFilter = {
  mode: splitPolicy,
  discoveryFrom: fromDate,
  discoveryTo: toDate,
  rowsBefore: before,
  rowsAfter: after,
  droppedForBoundaryCount,
  missingOutcomeKeysCount,
  missingEntryDateKeyCount,
  missingExitDateKeyCount,
  missingBothOutcomeKeysCount,
  droppedEntryBeforeBoundaryCount,
  droppedExitAfterBoundaryCount,
  requiredOutcomeKeys: ["entryDateKey", "exitDateKey"],
  boundaryFilteringApplied: true,
  boundaryFilteringSkipped: false,
  boundaryFilteringSkipReason: null,
}
await updateSummaryAndManifest(boundaryFilter, {
  after,
  positive,
  negative,
  nullOutcome,
  uniqueSymbols: uniqueSymbols.size,
  coverageFrom: orderedDates[0] ?? null,
  coverageTo: orderedDates[orderedDates.length - 1] ?? null,
  coverageCount: orderedDates.length,
})
NODE
}

link_stage() {
  local link_name="$1"
  local target_path="$2"
  ln -sfn "$target_path" "$RUN_DIR/$link_name"
}

read_json_field() {
  local file_path="$1"
  local field_path="$2"
  node --input-type=module - "$file_path" "$field_path" <<'NODE'
import fs from "node:fs/promises"

const [filePath, fieldPath] = process.argv.slice(2)
const payload = JSON.parse(await fs.readFile(filePath, "utf8"))
let current = payload
for (const key of String(fieldPath).split(".")) {
  if (!key) continue
  current = current?.[key]
}
if (current == null) process.exit(1)
if (typeof current === "object") {
  process.stdout.write(JSON.stringify(current))
} else {
  process.stdout.write(String(current))
}
NODE
}
