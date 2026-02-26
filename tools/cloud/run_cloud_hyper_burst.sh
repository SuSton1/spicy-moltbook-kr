#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE' >&2
run_cloud_hyper_burst.sh

Cloud/server burst runner:
1) optionally apply cloud hyper tuning profile
2) run multiple auto-upgrade loop sessions
3) optionally restore previous tuning

Usage:
  bash tools/cloud/run_cloud_hyper_burst.sh [options]

Options:
  --sessions=N           number of sessions (default: 3)
  --mode=dry|apply       loop mode (default: dry)
  --asof=YYYY-MM-DD      runtime rules asOfInput (default: 2026-02-13)
  --max-attempts=N       maxAttempts for each loop (default: 30)
  --verify-once=1|0      run npm run verify once before burst (default: 0)
  --verify-profile=fast|full verify profile when --verify-once=1 (default: fast)
  --restore-after=1|0    restore tuning backup after burst (default: 0)
  --apply-profile=1|0    apply cloud profile before loop (default: 1)
  --snapshot-id=ID       pinned snapshot id (required when --immutable-data=1 if state file missing)
  --immutable-data=1|0   lock data state: disable sync/derive mutation (default: 1)
  --auto-resource-max=1|0 auto-tune cloud lane to detected CPU/RAM maxima (default: 1)
  --enforce-cloud-resource-floor=1|0 fail when CPU/RAM is below cloud floor (default: 0)
  --min-cloud-cpu=N       minimum CPU cores required when floor is enforced (default: 2)
  --min-cloud-mem-mb=N    minimum memory MB required when floor is enforced (default: 4096)
USAGE
}

if [[ "$ROOT_DIR" == /home/saida/* && "${STOCKDESK_ALLOW_LOCAL_HEAVY:-0}" != "1" ]]; then
  echo "[cloud-burst] Refusing local heavy run. Use server/Codex Cloud container." >&2
  exit 1
fi

SESSIONS=3
MODE="dry"
ASOF="${DEFAULT_RAMP_ASOF_DATE_KEY:-2026-02-13}"
MAX_ATTEMPTS=30
VERIFY_ONCE=0
VERIFY_PROFILE="fast"
RESTORE_AFTER=0
APPLY_PROFILE=1
SNAPSHOT_ID="${CLOUD_SNAPSHOT_ID:-}"
IMMUTABLE_DATA="${CLOUD_IMMUTABLE_DATA:-1}"
AUTO_RESOURCE_MAX="${CLOUD_AUTO_RESOURCE_MAX:-1}"
ENFORCE_CLOUD_RESOURCE_FLOOR="${CLOUD_ENFORCE_RESOURCE_FLOOR:-0}"
MIN_CLOUD_CPU="${CLOUD_MIN_CPU:-2}"
MIN_CLOUD_MEM_MB="${CLOUD_MIN_MEM_MB:-4096}"

for arg in "$@"; do
  case "$arg" in
    --sessions=*)
      SESSIONS="${arg#--sessions=}"
      ;;
    --mode=*)
      MODE="${arg#--mode=}"
      ;;
    --asof=*)
      ASOF="${arg#--asof=}"
      ;;
    --max-attempts=*)
      MAX_ATTEMPTS="${arg#--max-attempts=}"
      ;;
    --verify-once=*)
      VERIFY_ONCE="${arg#--verify-once=}"
      ;;
    --verify-profile=*)
      VERIFY_PROFILE="${arg#--verify-profile=}"
      ;;
    --restore-after=*)
      RESTORE_AFTER="${arg#--restore-after=}"
      ;;
    --apply-profile=*)
      APPLY_PROFILE="${arg#--apply-profile=}"
      ;;
    --snapshot-id=*)
      SNAPSHOT_ID="${arg#--snapshot-id=}"
      ;;
    --immutable-data=*)
      IMMUTABLE_DATA="${arg#--immutable-data=}"
      ;;
    --auto-resource-max=*)
      AUTO_RESOURCE_MAX="${arg#--auto-resource-max=}"
      ;;
    --enforce-cloud-resource-floor=*)
      ENFORCE_CLOUD_RESOURCE_FLOOR="${arg#--enforce-cloud-resource-floor=}"
      ;;
    --min-cloud-cpu=*)
      MIN_CLOUD_CPU="${arg#--min-cloud-cpu=}"
      ;;
    --min-cloud-mem-mb=*)
      MIN_CLOUD_MEM_MB="${arg#--min-cloud-mem-mb=}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[cloud-burst] unknown arg: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ "$MODE" != "dry" && "$MODE" != "apply" ]]; then
  echo "[cloud-burst] invalid mode: $MODE" >&2
  exit 2
fi

if ! [[ "$SESSIONS" =~ ^[0-9]+$ ]] || (( SESSIONS < 1 || SESSIONS > 200 )); then
  echo "[cloud-burst] sessions must be 1..200" >&2
  exit 2
fi

if ! [[ "$MAX_ATTEMPTS" =~ ^[0-9]+$ ]] || (( MAX_ATTEMPTS < 1 || MAX_ATTEMPTS > 1000 )); then
  echo "[cloud-burst] max-attempts must be 1..1000" >&2
  exit 2
fi

if [[ "$VERIFY_ONCE" != "0" && "$VERIFY_ONCE" != "1" ]]; then
  echo "[cloud-burst] verify-once must be 0|1" >&2
  exit 2
fi
if [[ "$VERIFY_PROFILE" != "fast" && "$VERIFY_PROFILE" != "full" ]]; then
  echo "[cloud-burst] verify-profile must be fast|full" >&2
  exit 2
fi

if [[ "$RESTORE_AFTER" != "0" && "$RESTORE_AFTER" != "1" ]]; then
  echo "[cloud-burst] restore-after must be 0|1" >&2
  exit 2
fi

if [[ "$APPLY_PROFILE" != "0" && "$APPLY_PROFILE" != "1" ]]; then
  echo "[cloud-burst] apply-profile must be 0|1" >&2
  exit 2
fi

if [[ "$IMMUTABLE_DATA" != "0" && "$IMMUTABLE_DATA" != "1" ]]; then
  echo "[cloud-burst] immutable-data must be 0|1" >&2
  exit 2
fi
if [[ "$AUTO_RESOURCE_MAX" != "0" && "$AUTO_RESOURCE_MAX" != "1" ]]; then
  echo "[cloud-burst] auto-resource-max must be 0|1" >&2
  exit 2
fi
if [[ "$ENFORCE_CLOUD_RESOURCE_FLOOR" != "0" && "$ENFORCE_CLOUD_RESOURCE_FLOOR" != "1" ]]; then
  echo "[cloud-burst] enforce-cloud-resource-floor must be 0|1" >&2
  exit 2
fi
if ! [[ "$MIN_CLOUD_CPU" =~ ^[0-9]+$ ]] || (( MIN_CLOUD_CPU < 1 || MIN_CLOUD_CPU > 1024 )); then
  echo "[cloud-burst] min-cloud-cpu must be 1..1024" >&2
  exit 2
fi
if ! [[ "$MIN_CLOUD_MEM_MB" =~ ^[0-9]+$ ]] || (( MIN_CLOUD_MEM_MB < 1024 || MIN_CLOUD_MEM_MB > 1048576 )); then
  echo "[cloud-burst] min-cloud-mem-mb must be 1024..1048576" >&2
  exit 2
fi

assert_cloud_resource_floor() {
  local detected
  detected="$(node - <<'NODE'
const os = require("node:os")
const cpu = Math.max(1, Number(os.cpus()?.length ?? 1) || 1)
const memMb = Math.max(
  1,
  Math.floor((Number(os.totalmem?.() ?? 0) || 0) / (1024 * 1024)),
)
process.stdout.write(`${cpu} ${memMb}`)
NODE
)"
  local cpu mem_mb
  cpu="$(awk '{print $1}' <<<"$detected")"
  mem_mb="$(awk '{print $2}' <<<"$detected")"
  if (( cpu < MIN_CLOUD_CPU || mem_mb < MIN_CLOUD_MEM_MB )); then
    echo "[cloud-burst] CLOUD_RESOURCE_TOO_LOW cpu=${cpu} memMb=${mem_mb} requiredCpu>=${MIN_CLOUD_CPU} requiredMemMb>=${MIN_CLOUD_MEM_MB}" >&2
    return 1
  fi
  echo "[cloud-burst] resource floor PASS cpu=${cpu} memMb=${mem_mb} requiredCpu>=${MIN_CLOUD_CPU} requiredMemMb>=${MIN_CLOUD_MEM_MB}"
}

resolve_snapshot_id() {
  if [[ -n "$SNAPSHOT_ID" ]]; then
    echo "$SNAPSHOT_ID"
    return 0
  fi
  local state_path="artifacts/cloud_profiles/snapshot_state.json"
  if [[ ! -f "$state_path" ]]; then
    echo ""
    return 0
  fi
  node - <<'NODE'
const fs = require("node:fs")
const statePath = "artifacts/cloud_profiles/snapshot_state.json"
try {
  const payload = JSON.parse(fs.readFileSync(statePath, "utf8"))
  const id = String(payload.snapshotId ?? "").trim()
  process.stdout.write(id)
} catch {
  process.stdout.write("")
}
NODE
}

assert_snapshot_lock() {
  local pinned_id="$1"
  local state_path="artifacts/cloud_profiles/snapshot_state.json"
  if [[ ! -f "$state_path" ]]; then
    echo "[cloud-burst] snapshot state missing ($state_path) but immutable mode enabled" >&2
    return 1
  fi
  local state_id
  state_id="$(node - <<'NODE'
const fs = require("node:fs")
const statePath = "artifacts/cloud_profiles/snapshot_state.json"
try {
  const payload = JSON.parse(fs.readFileSync(statePath, "utf8"))
  process.stdout.write(String(payload.snapshotId ?? "").trim())
} catch {
  process.stdout.write("")
}
NODE
)"
  if [[ -z "$state_id" ]]; then
    echo "[cloud-burst] snapshot_state.json has empty snapshotId" >&2
    return 1
  fi
  if [[ "$state_id" != "$pinned_id" ]]; then
    echo "[cloud-burst] immutable snapshot mismatch pinned=$pinned_id state=$state_id" >&2
    return 1
  fi
}

apply_immutable_data_overrides() {
  node - <<'NODE'
const fs = require("node:fs")
const tuningPath = "scripts/autosearch/config/tuning.mutable.json"
const payload = JSON.parse(fs.readFileSync(tuningPath, "utf8"))
payload.executionLane = "codex_cloud"
payload.dataSyncEnabled = false
payload.dataSyncTradingDayOnly = false
payload.dataSyncOncePerTradingDay = false
payload.dataSyncSkipRetryAttempts = true
payload.forceDataSyncNextAttempt = false
payload.deriveEnabled = false
payload.allowUnsafeGapChartFallbackStage1 = false
if (!payload.envOverrides || typeof payload.envOverrides !== "object" || Array.isArray(payload.envOverrides)) {
  payload.envOverrides = {}
}
payload.envOverrides.GOLIVE_ALLOW_UNSAFE_GAP_CHART_FALLBACK = "0"

payload.disableStage2OnLowQualityRequiredDryOnZeroPass = true
fs.writeFileSync(tuningPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
NODE
}

apply_dynamic_resource_overrides() {
  node - <<'NODE'
const fs = require("node:fs")
const os = require("node:os")

const tuningPath = "scripts/autosearch/config/tuning.mutable.json"
const payload = JSON.parse(fs.readFileSync(tuningPath, "utf8"))

const cpuCount = Math.max(1, Number(os.cpus()?.length ?? 1) || 1)
const memMb = Math.max(
  1024,
  Math.floor((Number(os.totalmem?.() ?? 0) || 0) / (1024 * 1024)),
)
const memGb = Math.max(1, Math.floor(memMb / 1024))
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const ensureTrackMap = (value = {}) => ({
  SURGE_EOD: Math.max(1, Number(value?.SURGE_EOD ?? 1) || 1),
  GAP_15_BET: Math.max(1, Number(value?.GAP_15_BET ?? 1) || 1),
  MOONSHOT: Math.max(1, Number(value?.MOONSHOT ?? 1) || 1),
})

const setTrackMap = (value, surge, gap, moonshot) => {
  const base = ensureTrackMap(value)
  return {
    SURGE_EOD: Math.max(1, Math.floor(surge || base.SURGE_EOD)),
    GAP_15_BET: Math.max(1, Math.floor(gap || base.GAP_15_BET)),
    MOONSHOT: Math.max(1, Math.floor(moonshot || base.MOONSHOT)),
  }
}

const parallelMax = clamp(cpuCount, 1, 12)
const stage2Conc = clamp(Math.floor(cpuCount / 2), 1, 2)
const shardsTarget = clamp(cpuCount * 6, 8, cpuCount * 12)
const topPerTrackTarget = clamp(
  Math.floor(cpuCount * 30 + memGb * 4),
  72,
  Math.max(160, cpuCount * 80),
)
const coverageSeedLanesTarget = clamp(
  Math.floor(cpuCount * 4 + memGb / 3),
  6,
  cpuCount * 10,
)
const symbolBucketTotalTarget = clamp(
  Math.floor(cpuCount * 6 + memGb / 6),
  12,
  cpuCount * 16,
)
const poolsetBatchSizeTarget = clamp(
  Math.floor(cpuCount + memGb / 8),
  2,
  Math.max(8, cpuCount * 3),
)
const stage1MaxRoundsTarget = clamp(
  Math.floor(cpuCount * 36 + memGb * 3),
  72,
  180,
)
const stage2MaxRoundsTarget = clamp(
  Math.floor(cpuCount * 28 + memGb * 2.5),
  56,
  140,
)
const basePoolset = clamp(
  Math.floor(cpuCount * 1.5 + memGb / 8),
  4,
  cpuCount * 4,
)
const baseTopK = clamp(Math.floor(cpuCount / 2) + 2, 2, 6)
const baseDailyTop = clamp(Math.floor(topPerTrackTarget * 0.5), 24, 192)
const baseDailySet = clamp(Math.floor(basePoolset / 2), 2, 8)
payload.executionLane = "codex_cloud"
payload.maxWorkers = parallelMax
payload.maxParallelShards = parallelMax
payload.stage2EvalConcurrency = stage2Conc
payload.poolsetMaxConcurrentEval = stage2Conc
payload.shards = shardsTarget
payload.topPerTrack = topPerTrackTarget
payload.coverageSeedLanes = coverageSeedLanesTarget
payload.symbolBucketTotal = symbolBucketTotalTarget
payload.poolsetBatchSize = poolsetBatchSizeTarget
payload.stage1MaxRounds = stage1MaxRoundsTarget
payload.stage2MaxRounds = stage2MaxRoundsTarget
payload.stage1PlateauRounds = clamp(
  Math.floor(stage1MaxRoundsTarget * 0.4),
  24,
  96,
)
payload.stage2PlateauRounds = clamp(
  Math.floor(stage2MaxRoundsTarget * 0.45),
  24,
  96,
)

const lowLane = cpuCount <= 2 || memGb <= 10
if (lowLane) {
  payload.stage1MaxRounds = clamp(
    Math.floor(cpuCount * 24 + memGb * 2),
    48,
    72,
  )
  payload.stage2MaxRounds = clamp(
    Math.floor(cpuCount * 10 + memGb * 1.0),
    24,
    36,
  )
  payload.stage1PlateauRounds = clamp(
    Math.floor(payload.stage1MaxRounds * 0.4),
    20,
    52,
  )
  payload.stage2PlateauRounds = clamp(
    Math.floor(payload.stage2MaxRounds * 0.5),
    10,
    18,
  )
  payload.rescueTopK = clamp(
    Math.floor(Number(payload.rescueTopK ?? 40) || 40),
    20,
    40,
  )
  payload.rescueDeepTopK = clamp(
    Math.floor(Number(payload.rescueDeepTopK ?? 28) || 28),
    12,
    28,
  )
  payload.rescueCheapB = clamp(
    Math.floor(Number(payload.rescueCheapB ?? 900) || 900),
    480,
    900,
  )
  payload.rescueCheapM = clamp(
    Math.floor(Number(payload.rescueCheapM ?? 96) || 96),
    48,
    96,
  )
  payload.rescueDeepB = clamp(
    Math.floor(Number(payload.rescueDeepB ?? 720) || 720),
    320,
    720,
  )
  payload.rescueDeepM = clamp(
    Math.floor(Number(payload.rescueDeepM ?? 64) || 64),
    32,
    64,
  )
  payload.rescueEarlyExitNoPassMinEval = clamp(
    Math.floor(Number(payload.rescueEarlyExitNoPassMinEval ?? 24) || 24),
    12,
    24,
  )
  payload.rescueEarlyExitNoPassMaxEval = clamp(
    Math.floor(Number(payload.rescueEarlyExitNoPassMaxEval ?? 36) || 36),
    18,
    36,
  )
}
const poolsetCountSurge = lowLane
  ? clamp(Math.floor(basePoolset * 1.25), 4, 5)
  : basePoolset * 3
const poolsetCountGap = lowLane
  ? clamp(Math.floor(basePoolset), 3, 4)
  : basePoolset * 2
const poolsetCountMoon = lowLane
  ? clamp(Math.floor(basePoolset * 0.6), 2, 3)
  : basePoolset * 2
const stage2TopKSurge = lowLane ? 2 : baseTopK * 2
const stage2TopKGap = lowLane ? 2 : baseTopK
const stage2TopKMoon = lowLane ? 1 : baseTopK
const dailyTopSurge = lowLane
  ? clamp(Math.floor(baseDailyTop * 0.9), 32, 48)
  : baseDailyTop * 2
const dailyTopGap = lowLane
  ? clamp(Math.floor(baseDailyTop * 0.75), 24, 40)
  : Math.floor(baseDailyTop * 1.5)
const dailyTopMoon = lowLane
  ? clamp(Math.floor(baseDailyTop * 0.6), 16, 32)
  : baseDailyTop
const dailySetSurge = lowLane ? 1 : baseDailySet * 2
const dailySetGap = lowLane ? 1 : Math.max(2, Math.floor(baseDailySet * 1.5))
const dailySetMoon = lowLane ? 1 : baseDailySet

payload.poolsetCountByTrack = setTrackMap(
  payload.poolsetCountByTrack,
  poolsetCountSurge,
  poolsetCountGap,
  poolsetCountMoon,
)
payload.poolsetCountMaxByTrack = setTrackMap(
  payload.poolsetCountMaxByTrack,
  Math.floor(payload.poolsetCountByTrack.SURGE_EOD * 2),
  Math.floor(payload.poolsetCountByTrack.GAP_15_BET * 2),
  Math.floor(payload.poolsetCountByTrack.MOONSHOT * 2),
)
if (lowLane) {
  payload.poolsetCountMaxByTrack = setTrackMap(
    payload.poolsetCountMaxByTrack,
    payload.poolsetCountByTrack.SURGE_EOD,
    payload.poolsetCountByTrack.GAP_15_BET,
    payload.poolsetCountByTrack.MOONSHOT,
  )
}
payload.poolsetActiveSizeByTrack = setTrackMap(
  payload.poolsetActiveSizeByTrack,
  Math.max(5, Math.floor(payload.poolsetCountByTrack.SURGE_EOD * 0.6)),
  Math.max(3, Math.floor(payload.poolsetCountByTrack.GAP_15_BET * 0.6)),
  Math.max(2, Math.floor(payload.poolsetCountByTrack.MOONSHOT * 0.6)),
)
payload.poolsetBenchSizeByTrack = setTrackMap(
  payload.poolsetBenchSizeByTrack,
  Math.max(6, Math.floor(payload.poolsetCountByTrack.SURGE_EOD * 0.8)),
  Math.max(4, Math.floor(payload.poolsetCountByTrack.GAP_15_BET * 0.8)),
  Math.max(2, Math.floor(payload.poolsetCountByTrack.MOONSHOT * 0.8)),
)
payload.poolsetMinAliveByTrack = setTrackMap(
  payload.poolsetMinAliveByTrack,
  Math.max(2, Math.floor(payload.poolsetCountByTrack.SURGE_EOD * 0.34)),
  Math.max(2, Math.floor(payload.poolsetCountByTrack.GAP_15_BET * 0.34)),
  1,
)
payload.poolsetRefillCountByTrack = setTrackMap(
  payload.poolsetRefillCountByTrack,
  Math.max(2, Math.floor(payload.poolsetCountByTrack.SURGE_EOD * 0.34)),
  Math.max(2, Math.floor(payload.poolsetCountByTrack.GAP_15_BET * 0.34)),
  1,
)
if (lowLane) {
  payload.poolsetRefillCountByTrack = setTrackMap(
    payload.poolsetRefillCountByTrack,
    1,
    1,
    1,
  )
}
payload.stage2TopKByTrack = setTrackMap(
  payload.stage2TopKByTrack,
  stage2TopKSurge,
  stage2TopKGap,
  stage2TopKMoon,
)
payload.dailyPassTopNByTrack = setTrackMap(
  payload.dailyPassTopNByTrack,
  dailyTopSurge,
  dailyTopGap,
  dailyTopMoon,
)
payload.dailyPassPoolsetCountByTrack = setTrackMap(
  payload.dailyPassPoolsetCountByTrack,
  dailySetSurge,
  dailySetGap,
  dailySetMoon,
)
const recombineBase = clamp(Math.floor(cpuCount / 2) + 2, 2, 6)
if (lowLane) {
  payload.dailyPassRecombineRounds = 1
} else {
  payload.dailyPassRecombineRounds = Math.max(
    Number(payload.dailyPassRecombineRounds ?? 0) || 0,
    recombineBase,
  )
}
payload.speedProfileMaxStage2TopK = setTrackMap(
  payload.speedProfileMaxStage2TopK,
  lowLane ? 2 : Math.max(4, stage2TopKSurge * 2),
  lowLane ? 2 : Math.max(3, stage2TopKGap * 2),
  lowLane ? 1 : Math.max(2, stage2TopKMoon * 2),
)
payload.speedProfileExpansionGuard = true
payload.poolExpandEnabled = false

fs.writeFileSync(tuningPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
fs.mkdirSync("artifacts/cloud_profiles", { recursive: true })
fs.writeFileSync(
  "artifacts/cloud_profiles/detected_resources.latest.json",
  `${JSON.stringify(
    {
      detectedAt: new Date().toISOString(),
      cpuCount,
      memMb,
      applied: {
        maxWorkers: payload.maxWorkers,
        maxParallelShards: payload.maxParallelShards,
        stage2EvalConcurrency: payload.stage2EvalConcurrency,
        poolsetMaxConcurrentEval: payload.poolsetMaxConcurrentEval,
        shards: payload.shards,
        topPerTrack: payload.topPerTrack,
        coverageSeedLanes: payload.coverageSeedLanes,
        symbolBucketTotal: payload.symbolBucketTotal,
        poolsetBatchSize: payload.poolsetBatchSize,
        stage1MaxRounds: payload.stage1MaxRounds,
        stage2MaxRounds: payload.stage2MaxRounds,
        stage1PlateauRounds: payload.stage1PlateauRounds,
        stage2PlateauRounds: payload.stage2PlateauRounds,
        poolsetCountByTrack: payload.poolsetCountByTrack,
        poolsetCountMaxByTrack: payload.poolsetCountMaxByTrack,
        stage2TopKByTrack: payload.stage2TopKByTrack,
        dailyPassTopNByTrack: payload.dailyPassTopNByTrack,
        dailyPassPoolsetCountByTrack: payload.dailyPassPoolsetCountByTrack,
        dailyPassRecombineRounds: payload.dailyPassRecombineRounds,
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
)
console.log(
  `[cloud-burst] auto-resource applied cpu=${cpuCount} memMb=${memMb} maxWorkers=${payload.maxWorkers} stage2EvalConcurrency=${payload.stage2EvalConcurrency} topPerTrack=${payload.topPerTrack} poolsetBatchSize=${payload.poolsetBatchSize}`,
)
NODE
}

export NO_KIS=1
export BACKFILL_DISABLE_KIS=1
export BACKFILL_NO_KIS=1
export BACKFILL_KIS_ENABLED=0
export CLOUD_BURST_ASOF="$ASOF"
export CLOUD_EXECUTION_MODE="codex_cloud"

if [[ "$ENFORCE_CLOUD_RESOURCE_FLOOR" == "1" ]]; then
  assert_cloud_resource_floor
fi

if [[ "$IMMUTABLE_DATA" == "1" ]]; then
  SNAPSHOT_ID="$(resolve_snapshot_id)"
  if [[ -z "$SNAPSHOT_ID" ]]; then
    echo "[cloud-burst] immutable mode requires snapshot id (--snapshot-id or snapshot_state.json)" >&2
    exit 2
  fi
  assert_snapshot_lock "$SNAPSHOT_ID"
  export CLOUD_SNAPSHOT_ID="$SNAPSHOT_ID"
  export CLOUD_IMMUTABLE_DATA=1
else
  export CLOUD_IMMUTABLE_DATA=0
fi

cleanup() {
  if [[ -n "${RUNTIME_RULES_PATH:-}" ]]; then
    rm -f "$RUNTIME_RULES_PATH" || true
  fi
  if [[ "$RESTORE_AFTER" == "1" ]]; then
    echo "[cloud-burst] restoring tuning from backup"
    node tools/cloud/apply_cloud_hyper_profile.mjs --mode=restore || true
  fi
}
trap cleanup EXIT

if [[ "$APPLY_PROFILE" == "1" ]]; then
  echo "[cloud-burst] applying cloud hyper profile"
  node tools/cloud/apply_cloud_hyper_profile.mjs --mode=apply
else
  echo "[cloud-burst] skip apply-profile (using current tuning)"
fi

if [[ "$IMMUTABLE_DATA" == "1" ]]; then
  echo "[cloud-burst] immutable data mode on snapshotId=$SNAPSHOT_ID"
  apply_immutable_data_overrides
fi

if [[ "$AUTO_RESOURCE_MAX" == "1" ]]; then
  echo "[cloud-burst] auto resource max enabled (cpu/memory aware)"
  apply_dynamic_resource_overrides
fi

ts="$(date +%Y%m%d_%H%M%S)"
log_dir="artifacts/cloud_profiles"
mkdir -p "$log_dir"
log_file="$log_dir/cloud_hyper_burst_${ts}.log"
export RUNTIME_RULES_PATH="$log_dir/rules.runtime.${ts}.json"

echo "[cloud-burst] prepare runtime rules asOfInput=$ASOF"
node - <<'NODE'
const fs = require("node:fs")
const path = require("node:path")
const root = process.cwd()
const asOf = process.env.CLOUD_BURST_ASOF || "2026-02-13"
const runtimeRulesPath = process.env.RUNTIME_RULES_PATH
if (!runtimeRulesPath) {
  throw new Error("RUNTIME_RULES_PATH is required")
}
const rulesPath = path.join(root, "scripts/autosearch/config/rules.lock.json")
const payload = JSON.parse(fs.readFileSync(rulesPath, "utf8"))
payload.asOfInput = asOf
fs.writeFileSync(runtimeRulesPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
console.log(`[cloud-burst] runtime rules prepared asOfInput=${asOf}`)
NODE

if [[ "$VERIFY_ONCE" == "1" ]]; then
  echo "[cloud-burst] running verify once profile=${VERIFY_PROFILE}"
  if [[ "$VERIFY_PROFILE" == "fast" ]]; then
    npm run verify:fast
  else
    npm run verify:full
  fi
fi

echo "[cloud-burst] start sessions=$SESSIONS mode=$MODE asof=$ASOF maxAttempts=$MAX_ATTEMPTS immutable=$IMMUTABLE_DATA autoResource=$AUTO_RESOURCE_MAX" | tee -a "$log_file"

for ((i=1; i<=SESSIONS; i++)); do
  echo "[cloud-burst] session=$i/$SESSIONS begin" | tee -a "$log_file"
  if [[ "$MODE" == "dry" ]]; then
    node scripts/autosearch/auto_upgrade_loop.mjs \
      --dryRunOnly=1 \
      --autoApply=0 \
      --rulesPath="$RUNTIME_RULES_PATH" \
      --maxAttempts="$MAX_ATTEMPTS" \
      >>"$log_file" 2>&1
  else
    node scripts/autosearch/auto_upgrade_loop.mjs \
      --autoApply=1 \
      --rulesPath="$RUNTIME_RULES_PATH" \
      --maxAttempts="$MAX_ATTEMPTS" \
      >>"$log_file" 2>&1
  fi
  echo "[cloud-burst] session=$i/$SESSIONS done" | tee -a "$log_file"
done

echo "[cloud-burst] complete log=$log_file" | tee -a "$log_file"
