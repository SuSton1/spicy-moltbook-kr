#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

import { normalizeTuning } from "../../scripts/autosearch/automationCore.mjs"
import { validateTuningSchema } from "../../scripts/autosearch/riskClosure.mjs"

const rootDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../..",
)
const tuningRelPath = "scripts/autosearch/config/tuning.mutable.json"
const profileRelPath = "tools/cloud/profiles/cloud_hyper_profile.json"
const stateDirRelPath = "artifacts/cloud_profiles"

const tuningPath = path.join(rootDir, tuningRelPath)
const profilePath = path.join(rootDir, profileRelPath)
const stateDir = path.join(rootDir, stateDirRelPath)
const activeBackupPathFile = path.join(
  stateDir,
  "active_tuning_backup_path.txt",
)
const lastReportPath = path.join(stateDir, "last_profile_apply_report.json")

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"))
const writeJson = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}
const ensureTrailingNewline = (content) =>
  String(content ?? "").endsWith("\n")
    ? String(content ?? "")
    : `${String(content ?? "")}\n`

const deepMerge = (base, patch) => {
  if (Array.isArray(base) || Array.isArray(patch)) {
    return Array.isArray(patch) ? [...patch] : [...(base ?? [])]
  }
  if (
    !base ||
    typeof base !== "object" ||
    !patch ||
    typeof patch !== "object"
  ) {
    return patch !== undefined ? patch : base
  }
  const next = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      next[key] = deepMerge(base[key], value)
    } else {
      next[key] = Array.isArray(value) ? [...value] : value
    }
  }
  return next
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const modeArg = args.find((arg) => arg.startsWith("--mode="))
  const backupArg = args.find((arg) => arg.startsWith("--backup="))
  return {
    mode: String(modeArg ? modeArg.slice("--mode=".length) : "status")
      .trim()
      .toLowerCase(),
    backupPath: String(
      backupArg ? backupArg.slice("--backup=".length) : "",
    ).trim(),
  }
}

const assertNoKisFlags = (tuning) => {
  const envOverrides =
    tuning && typeof tuning.envOverrides === "object" ? tuning.envOverrides : {}
  const noKis = String(envOverrides.NO_KIS ?? "").trim()
  const disableKis = String(envOverrides.BACKFILL_DISABLE_KIS ?? "").trim()
  const kisEnabled = String(envOverrides.BACKFILL_KIS_ENABLED ?? "").trim()
  if (noKis !== "1" || disableKis !== "1" || kisEnabled !== "0") {
    throw new Error(
      "NO_KIS profile violation: envOverrides must include NO_KIS=1, BACKFILL_DISABLE_KIS=1, BACKFILL_KIS_ENABLED=0",
    )
  }
}

const validateAndNormalize = (candidate) => {
  const normalized = normalizeTuning(candidate)
  const schema = validateTuningSchema(normalized)
  if (!schema.ok) {
    throw new Error(`TUNING_SCHEMA_INVALID: ${schema.errors.join(" | ")}`)
  }
  assertNoKisFlags(normalized)
  return normalized
}

const nowStamp = () =>
  new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")

const printStatus = () => {
  if (!fs.existsSync(tuningPath)) {
    throw new Error(`Tuning file missing: ${tuningRelPath}`)
  }
  const tuning = validateAndNormalize(readJson(tuningPath))
  const summary = {
    tuningPath: tuningRelPath,
    profilePath: profileRelPath,
    executionLane: tuning.executionLane,
    shards: tuning.shards,
    topPerTrack: tuning.topPerTrack,
    coverageSeedLanes: tuning.coverageSeedLanes,
    symbolBucketTotal: tuning.symbolBucketTotal,
    symbolBucketStride: tuning.symbolBucketStride,
    poolsetCountByTrack: tuning.poolsetCountByTrack,
    poolsetMaxConcurrentEval: tuning.poolsetMaxConcurrentEval,
    dailyPassTopNByTrack: tuning.dailyPassTopNByTrack,
    stage2TopKByTrack: tuning.stage2TopKByTrack,
    maxWorkers: tuning.maxWorkers,
    stage2EvalConcurrency: tuning.stage2EvalConcurrency,
    stage2ResultCacheEnabled: tuning.stage2ResultCacheEnabled === true,
    stage2SkipDuplicatePoolSetSignature:
      tuning.stage2SkipDuplicatePoolSetSignature === true,
    stage2ScheduleMode: tuning.stage2ScheduleMode,
    stage2ContinueAfterFirstPass: tuning.stage2ContinueAfterFirstPass === true,
    dataSyncEnabled: tuning.dataSyncEnabled === true,
    deriveEnabled: tuning.deriveEnabled === true,
    dataSyncOncePerTradingDay: tuning.dataSyncOncePerTradingDay === true,
    dataSyncSkipRetryAttempts: tuning.dataSyncSkipRetryAttempts === true,
  }
  console.log(JSON.stringify(summary, null, 2))
}

const applyProfile = () => {
  if (!fs.existsSync(tuningPath)) {
    throw new Error(`Tuning file missing: ${tuningRelPath}`)
  }
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile file missing: ${profileRelPath}`)
  }

  const currentRaw = fs.readFileSync(tuningPath, "utf8")
  const current = JSON.parse(currentRaw)
  const profile = readJson(profilePath)

  fs.mkdirSync(stateDir, { recursive: true })
  const backupPath = path.join(
    stateDir,
    `tuning.mutable.backup.${nowStamp()}.json`,
  )
  fs.writeFileSync(backupPath, ensureTrailingNewline(currentRaw), "utf8")
  fs.writeFileSync(activeBackupPathFile, `${backupPath}\n`, "utf8")

  const merged = deepMerge(current, profile)
  const normalized = validateAndNormalize(merged)
  writeJson(tuningPath, normalized)

  const report = {
    appliedAt: new Date().toISOString(),
    mode: "apply",
    tuningPath: tuningRelPath,
    profilePath: profileRelPath,
    backupPath: path.relative(rootDir, backupPath),
    activeBackupFile: path.relative(rootDir, activeBackupPathFile),
    summary: {
      shards: normalized.shards,
      topPerTrack: normalized.topPerTrack,
      poolsetCountByTrack: normalized.poolsetCountByTrack,
      dailyPassTopNByTrack: normalized.dailyPassTopNByTrack,
      stage2TopKByTrack: normalized.stage2TopKByTrack,
      maxWorkers: normalized.maxWorkers,
      stage2EvalConcurrency: normalized.stage2EvalConcurrency,
    },
  }
  writeJson(lastReportPath, report)
  console.log(
    `[cloud-profile] applied profile=${profileRelPath} backup=${path.relative(rootDir, backupPath)}`,
  )
}

const restoreProfile = (backupArg) => {
  let backupPath = String(backupArg ?? "").trim()
  if (!backupPath) {
    if (!fs.existsSync(activeBackupPathFile)) {
      throw new Error("No active backup pointer found")
    }
    backupPath = fs.readFileSync(activeBackupPathFile, "utf8").trim()
  }
  const resolvedBackupPath = path.isAbsolute(backupPath)
    ? backupPath
    : path.join(rootDir, backupPath)
  if (!fs.existsSync(resolvedBackupPath)) {
    throw new Error(`Backup file missing: ${backupPath}`)
  }

  const backupRaw = fs.readFileSync(resolvedBackupPath, "utf8")
  const backup = validateAndNormalize(JSON.parse(backupRaw))
  // Restore the exact backup bytes to avoid noisy formatting churn in mutable JSON.
  void backup
  fs.writeFileSync(tuningPath, ensureTrailingNewline(backupRaw), "utf8")
  const report = {
    appliedAt: new Date().toISOString(),
    mode: "restore",
    tuningPath: tuningRelPath,
    restoredFrom: path.relative(rootDir, resolvedBackupPath),
  }
  writeJson(lastReportPath, report)
  console.log(
    `[cloud-profile] restored tuning from ${path.relative(rootDir, resolvedBackupPath)}`,
  )
}

const main = () => {
  const { mode, backupPath } = parseArgs()
  if (mode === "status") {
    printStatus()
    return
  }
  if (mode === "apply") {
    applyProfile()
    return
  }
  if (mode === "restore") {
    restoreProfile(backupPath)
    return
  }
  throw new Error(`Unknown mode: ${mode} (use --mode=status|apply|restore)`)
}

main()
