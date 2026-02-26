import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"

const rootDir = process.cwd()

const parseArg = (name) => {
  const prefix = `${name}=`
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : ""
}

const toBool = (value, fallback = false) => {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
  if (!raw) return fallback
  return (
    raw === "1" ||
    raw === "true" ||
    raw === "yes" ||
    raw === "on" ||
    raw === "y"
  )
}

const clampInt = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

const readJson = (filePath) => {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.join(rootDir, filePath)
  return {
    path: resolved,
    data: JSON.parse(fs.readFileSync(resolved, "utf8")),
  }
}

const buildReplayArgs = ({
  manifest,
  mode,
  replayId,
  blockedFingerprintsPath = "",
}) => {
  const rules = manifest?.rules ?? {}
  const tuning = manifest?.tuning ?? {}
  const executionLane =
    String(tuning.executionLane ?? "server").trim().toLowerCase() ===
    "codex_cloud"
      ? "codex_cloud"
      : "server"
  const maxParallelCap =
    executionLane === "codex_cloud" ? Number.MAX_SAFE_INTEGER : 2
  const coveragePlan = manifest?.coveragePlan ?? {}
  const bucketTotal = Math.max(1, Number(coveragePlan?.bucketTotal ?? 1) || 1)
  const args = [
    "scripts/autosearch/go_live_sharded.mjs",
    `--batchId=${replayId}`,
    `--asof=${String(rules.asOfInput ?? "").trim()}`,
    `--tracks=${Array.isArray(rules.tracks) ? rules.tracks.join(",") : "SURGE_EOD,GAP_15_BET"}`,
    `--passMode=${String(rules.passMode ?? "all").trim() || "all"}`,
    `--targetPct=${Number(rules.targetPct ?? 5) || 5}`,
    `--minWorst2wAvgPct=${Number(rules.minWorst2wAvgPct ?? -1.5) || -1.5}`,
    `--highWeekPct=${Number(rules.highWeekPct ?? 10) || 10}`,
    `--minHighWeeks=${Number(rules.minHighWeeks ?? 0) || 0}`,
    `--nearHighWeeks=${Number(rules.nearHighWeeks ?? 0) || 0}`,
    `--minOtherWeekPct=${Number(rules.minOtherWeekPct ?? 0.01) || 0.01}`,
    `--requireCompletedTradesEveryWeek=${Number(rules.requireCompletedTradesEveryWeek ?? 1) || 1}`,
    `--stage1MaxRounds=${Number(tuning.stage1MaxRounds ?? 60) || 60}`,
    `--stage2MaxRounds=${Number(tuning.stage2MaxRounds ?? 160) || 160}`,
    `--stage1PlateauRounds=${Number(tuning.stage1PlateauRounds ?? 80) || 80}`,
    `--stage2PlateauRounds=${Number(tuning.stage2PlateauRounds ?? 240) || 240}`,
    `--shards=${Number(tuning.shards ?? 4) || 4}`,
    `--topPerTrack=${Number(tuning.topPerTrack ?? 24) || 24}`,
    `--seedStart=${Number(tuning.seedStart ?? 1) || 1}`,
    `--symbolSeedBase=${String(tuning.symbolSeedBase ?? "auto").trim() || "auto"}`,
    `--maxParallelShards=${clampInt(tuning.maxParallelShards, 2, 1, maxParallelCap)}`,
    `--executionLane=${executionLane}`,
    `--minFreeMbForParallel=${clampInt(tuning.minFreeMbForParallelShards, 2200, 512, 65536)}`,
    `--rescueEnabled=${tuning.rescueEnabled === false ? 0 : 1}`,
    `--rescueTopK=${Math.max(1, Number(tuning.rescueTopK ?? 20) || 20)}`,
    `--rescueCheapB=${Math.max(20, Number(tuning.rescueCheapB ?? 300) || 300)}`,
    `--rescueCheapM=${Math.max(1, Number(tuning.rescueCheapM ?? 50) || 50)}`,
    `--rescueDeepTopK=${Math.max(1, Number(tuning.rescueDeepTopK ?? 12) || 12)}`,
    `--rescueDeepB=${Math.max(20, Number(tuning.rescueDeepB ?? 600) || 600)}`,
    `--rescueDeepM=${Math.max(1, Number(tuning.rescueDeepM ?? 80) || 80)}`,
    `--rescueAlpha=${Number(tuning.rescueAlpha ?? 0.05) || 0.05}`,
    `--rescueP0=${Number(tuning.rescueP0 ?? 0.95) || 0.95}`,
    `--rescueLcbQuantile=${Number(tuning.rescueLcbQuantile ?? 0.1) || 0.1}`,
    `--rescueEarlyExitEnabled=${tuning.rescueEarlyExitEnabled === false ? 0 : 1}`,
    `--rescueEarlyExitNoPassMinEval=${Math.max(
      1,
      Number(tuning.rescueEarlyExitNoPassMinEval ?? 12) || 12,
    )}`,
    `--rescueEarlyExitTerminalReasonRatio=${Number(
      tuning.rescueEarlyExitTerminalReasonRatio ?? 0.85,
    ) || 0.85}`,
    `--printEvery=${Math.max(1, Number(tuning.printEvery ?? 20) || 20)}`,
  ]
  if (bucketTotal > 1) {
    args.push(`--symbolBucketTotal=${bucketTotal}`)
    args.push(`--symbolBucketIndex=${Math.max(0, Number(coveragePlan?.bucketIndex ?? 0) || 0)}`)
  }
  if (blockedFingerprintsPath) {
    const resolved = path.isAbsolute(blockedFingerprintsPath)
      ? blockedFingerprintsPath
      : path.join(rootDir, blockedFingerprintsPath)
    if (fs.existsSync(resolved)) {
      args.push(`--excludeFingerprintsPath=${resolved}`)
    }
  }
  if (mode === "apply") {
    args.push("--apply=1")
  } else {
    args.push("--dryRunOnly=1")
  }
  return args
}

const main = () => {
  const manifestPath = String(parseArg("--manifest") || "").trim()
  if (!manifestPath) {
    throw new Error("MISSING_MANIFEST --manifest=<path>")
  }
  const modeRaw = String(parseArg("--mode") || "dry")
    .trim()
    .toLowerCase()
  const mode = modeRaw === "apply" ? "apply" : "dry"
  const execute = toBool(parseArg("--execute"), false)
  const blockedFingerprintsPath = String(
    parseArg("--blockedFingerprintsPath") || "",
  ).trim()
  const replayId =
    String(parseArg("--replayId") || "").trim() ||
    `replay_${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}`

  const { path: resolvedManifest, data: manifest } = readJson(manifestPath)
  const args = buildReplayArgs({
    manifest,
    mode,
    replayId,
    blockedFingerprintsPath,
  })
  const payload = {
    mode,
    execute,
    manifestPath: resolvedManifest,
    replayId,
    command: ["node", ...args],
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  if (!execute) {
    return
  }
  const result = spawnSync("node", args, {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      NO_KIS: "1",
      BACKFILL_DISABLE_KIS: "1",
      BACKFILL_KIS_ENABLED: "0",
    },
  })
  process.exitCode = Number(result.status ?? 1)
}

main()
