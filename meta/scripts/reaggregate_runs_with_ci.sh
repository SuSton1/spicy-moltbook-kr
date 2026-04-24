#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  meta/scripts/reaggregate_runs_with_ci.sh --run-prefix=<prefix> [--root=<repo_root>] [--out=<json>] [--bootstrap=<n>] [--seed=<n>] [--mode=<fast|confirm|final>]

Options:
  --run-prefix   Required run prefix used in artifacts/runs/<prefix>_i*/step-d/step_d_summary.json
  --root         Repo root (default: /home/moltook/apps/stockdesk-lab-lite)
  --out          Output json path (default: reports/<prefix>/reaggregated_report_with_ci.json)
  --bootstrap    Bootstrap resamples for mean CI (default: 2000)
  --seed         RNG seed for bootstrap (default: 42)
  --mode         fast=300, confirm=800, final=2000 bootstrap samples (default: final)
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ROOT_DIR="/home/moltook/apps/stockdesk-lab-lite"
RUN_PREFIX=""
OUT_JSON=""
BOOTSTRAP_N="2000"
SEED="42"
MODE="final"

for arg in "$@"; do
  case "$arg" in
    --run-prefix=*) RUN_PREFIX="${arg#--run-prefix=}" ;;
    --root=*) ROOT_DIR="${arg#--root=}" ;;
    --out=*) OUT_JSON="${arg#--out=}" ;;
    --bootstrap=*) BOOTSTRAP_N="${arg#--bootstrap=}" ;;
    --seed=*) SEED="${arg#--seed=}" ;;
    --mode=*) MODE="${arg#--mode=}" ;;
    *)
      echo "[fatal] unknown arg: $arg" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "${BOOTSTRAP_N}" == "2000" ]]; then
  case "${MODE}" in
    fast) BOOTSTRAP_N="300" ;;
    confirm) BOOTSTRAP_N="800" ;;
    final) BOOTSTRAP_N="2000" ;;
    *)
      echo "[fatal] invalid --mode: ${MODE}" >&2
      exit 1
      ;;
  esac
fi

if [[ -z "$RUN_PREFIX" ]]; then
  echo "[fatal] --run-prefix is required" >&2
  exit 1
fi

cd "$ROOT_DIR"
if [[ -z "$OUT_JSON" ]]; then
  OUT_JSON="reports/${RUN_PREFIX}/reaggregated_report_with_ci.json"
fi
mkdir -p "$(dirname "$OUT_JSON")"

node - "$ROOT_DIR" "$RUN_PREFIX" "$OUT_JSON" "$BOOTSTRAP_N" "$SEED" <<'NODE'
const fs = require('fs')
const path = require('path')

const rootDir = process.argv[2]
const runPrefix = process.argv[3]
const outPath = process.argv[4]
const bootstrapN = Math.max(100, Number(process.argv[5] || 2000) || 2000)
const seed0 = Math.max(1, Math.floor(Number(process.argv[6] || 42) || 42))

const runsDir = path.join(rootDir, 'artifacts', 'runs')
if (!fs.existsSync(runsDir)) {
  throw new Error(`runs dir not found: ${runsDir}`)
}

const runDirs = fs.readdirSync(runsDir)
  .filter((name) => name.startsWith(`${runPrefix}_i`))
  .sort((a, b) => a.localeCompare(b))

const rows = []
const incompleteRuns = []
const missingStepCRuns = []
const missingStepDRuns = []
const missingStepERuns = []
for (const runId of runDirs) {
  const stepCSummaryPath = path.join(runsDir, runId, 'step-c', 'step_c_summary.json')
  const stepDSummaryPath = path.join(runsDir, runId, 'step-d', 'step_d_summary.json')
  const stepESummaryPath = path.join(runsDir, runId, 'step-e', 'step_e_summary.json')
  const missing = []
  if (!fs.existsSync(stepCSummaryPath)) {
    missing.push('step_c_summary.json')
    missingStepCRuns.push(runId)
  }
  if (!fs.existsSync(stepDSummaryPath)) {
    missing.push('step_d_summary.json')
    missingStepDRuns.push(runId)
  }
  if (!fs.existsSync(stepESummaryPath)) {
    missing.push('step_e_summary.json')
    missingStepERuns.push(runId)
  }
  if (missing.length > 0) {
    incompleteRuns.push({ runId, missing })
  }
  const stepC = fs.existsSync(stepCSummaryPath)
    ? JSON.parse(fs.readFileSync(stepCSummaryPath, 'utf8'))
    : null
  const stepD = fs.existsSync(stepDSummaryPath)
    ? JSON.parse(fs.readFileSync(stepDSummaryPath, 'utf8'))
    : null
  const stepE = fs.existsSync(stepESummaryPath)
    ? JSON.parse(fs.readFileSync(stepESummaryPath, 'utf8'))
    : null
  rows.push({
    runId,
    stepCSummaryPath: fs.existsSync(stepCSummaryPath) ? stepCSummaryPath : null,
    stepDSummaryPath: fs.existsSync(stepDSummaryPath) ? stepDSummaryPath : null,
    stepESummaryPath: fs.existsSync(stepESummaryPath) ? stepESummaryPath : null,
    stepC,
    stepD,
    stepE
  })
}

const num = (v, d = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
const median = (arr) => {
  if (!arr.length) return 0
  const s = arr.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const stdev = (arr) => {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(arr.reduce((acc, x) => acc + (x - m) ** 2, 0) / arr.length)
}

const wilsonLcb95 = (success, total) => {
  const n = Math.max(0, num(total))
  const k = Math.max(0, num(success))
  if (n <= 0) return 0
  const z = 1.959963984540054
  const p = Math.min(1, Math.max(0, k / n))
  const z2 = z ** 2
  const center = p + z2 / (2 * n)
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)
  const denom = 1 + z2 / n
  return Math.max(0, Math.min(1, (center - spread) / denom))
}

let seed = seed0
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}

const bootstrapMeanCI = (arr, n = bootstrapN) => {
  if (!arr.length) return { low: 0, high: 0 }
  const samples = []
  for (let i = 0; i < n; i += 1) {
    let sum = 0
    for (let j = 0; j < arr.length; j += 1) {
      const idx = Math.floor(rand() * arr.length)
      sum += arr[idx]
    }
    samples.push(sum / arr.length)
  }
  samples.sort((a, b) => a - b)
  const loIdx = Math.floor(0.025 * (samples.length - 1))
  const hiIdx = Math.floor(0.975 * (samples.length - 1))
  return { low: samples[loIdx], high: samples[hiIdx] }
}

const stepCRows = rows.filter((r) => r.stepC && typeof r.stepC === 'object')
const stepDRows = rows.filter((r) => r.stepD && typeof r.stepD === 'object')
const stepERows = rows.filter((r) => r.stepE && typeof r.stepE === 'object')
const pairedRows = rows.filter((r) => r.stepD && r.stepE)

const pickHitRateEval = stepDRows.map((r) => num(r.stepD.pickHitRateEval))
const hitAt1Eval = stepDRows.map((r) => num(r.stepD.hitAt1Eval))
const pickedCountEval = stepDRows.map((r) => num(r.stepD.pickedCountEval))
const pickHitRateEvalLcb95 = stepDRows.map((r) => num(r.stepD.pickHitRateEvalLcb95))
const executedCountEval = stepDRows.map((r) => num(r.stepD.executedCountEval))
const executionCoverageEval = stepDRows.map((r) => num(r.stepD.executionCoverageEval))
const oracleHitRateTopKEval = stepDRows.map((r) => num(r.stepD.oracleHitRateTopKEval))

const lockboxTrades = stepERows.map((r) => num(r.stepE.totalTrades))
const lockboxWinRate = stepERows.map((r) => num(r.stepE.winRate))
const lockboxAvgNetRet = stepERows.map((r) => num(r.stepE.avgNetRet))
const lockboxCumulativeReturn = stepERows.map((r) => num(r.stepE.cumulativeReturn))
const lockboxMaxDrawdown = stepERows.map((r) => num(r.stepE.maxDrawdown))
const evalToLockboxGap = pairedRows.map((r) => {
  const explicit = num(r.stepE?.evalToLockboxGap?.winRateMinusPickHitRateEval, NaN)
  if (Number.isFinite(explicit)) return explicit
  return num(r.stepE?.winRate) - num(r.stepD?.pickHitRateEval)
})

const pickHitCountEvalTotal = stepDRows.reduce((acc, r) => acc + num(r.stepD.pickHitCountEval), 0)
const pickedCountEvalTotal = stepDRows.reduce((acc, r) => acc + num(r.stepD.pickedCountEval), 0)

const out = {
  generatedAt: new Date().toISOString(),
  rootDir,
  runPrefix,
  runCount: rows.length,
  stepCRunCount: stepCRows.length,
  stepDRunCount: stepDRows.length,
  stepERunCount: stepERows.length,
  pairedRunCount: pairedRows.length,
  bootstrapSamples: bootstrapN,
  integrity: {
    missingStepCCount: missingStepCRuns.length,
    missingStepDCount: missingStepDRuns.length,
    missingStepECount: missingStepERuns.length,
    incompleteRunCount: incompleteRuns.length,
    missingStepCRuns,
    missingStepDRuns,
    missingStepERuns,
    incompleteRuns
  },
  summary: {
    pickHitRateEvalMean: mean(pickHitRateEval),
    pickHitRateEvalMedian: median(pickHitRateEval),
    pickHitRateEvalStd: stdev(pickHitRateEval),
    pickHitRateEvalMeanCi95: bootstrapMeanCI(pickHitRateEval),
    hitAt1EvalMean: mean(hitAt1Eval),
    hitAt1EvalMedian: median(hitAt1Eval),
    hitAt1EvalStd: stdev(hitAt1Eval),
    hitAt1EvalMeanCi95: bootstrapMeanCI(hitAt1Eval),
    pickedCountEvalMean: mean(pickedCountEval),
    pickedCountEvalMedian: median(pickedCountEval),
    pickedCountEvalStd: stdev(pickedCountEval),
    pickHitRateEvalLcb95Mean: mean(pickHitRateEvalLcb95),
    executedCountEvalMean: mean(executedCountEval),
    executionCoverageEvalMean: mean(executionCoverageEval),
    oracleHitRateTopKEvalMean: mean(oracleHitRateTopKEval),
    pooledPickHitRateEvalLcb95: wilsonLcb95(pickHitCountEvalTotal, pickedCountEvalTotal),
    pooledPickHitCountEval: pickHitCountEvalTotal,
    pooledPickedCountEval: pickedCountEvalTotal,
    lockboxSummaryPresentRate: rows.length > 0 ? stepERows.length / rows.length : 0,
    lockboxTotalTradesMean: mean(lockboxTrades),
    lockboxTotalTradesMedian: median(lockboxTrades),
    lockboxWinRateMean: mean(lockboxWinRate),
    lockboxWinRateMedian: median(lockboxWinRate),
    lockboxWinRateStd: stdev(lockboxWinRate),
    lockboxWinRateMeanCi95: bootstrapMeanCI(lockboxWinRate),
    lockboxAvgNetRetMean: mean(lockboxAvgNetRet),
    lockboxCumulativeReturnMean: mean(lockboxCumulativeReturn),
    lockboxMaxDrawdownMean: mean(lockboxMaxDrawdown),
    evalToLockboxWinRateGapMean: mean(evalToLockboxGap),
    evalToLockboxWinRateGapAbsMean: mean(evalToLockboxGap.map((v) => Math.abs(v)))
  },
  runs: rows.map((r) => ({
    runId: r.runId,
    stepCSummaryPresent: !!r.stepC,
    stepDSummaryPresent: !!r.stepD,
    stepESummaryPresent: !!r.stepE,
    stepCSummaryPath: r.stepCSummaryPath,
    stepDSummaryPath: r.stepDSummaryPath,
    stepESummaryPath: r.stepESummaryPath,
    pickHitRateEval: num(r.stepD?.pickHitRateEval),
    hitAt1Eval: num(r.stepD?.hitAt1Eval),
    pickedCountEval: num(r.stepD?.pickedCountEval),
    pickHitRateEvalLcb95: num(r.stepD?.pickHitRateEvalLcb95),
    executedCountEval: num(r.stepD?.executedCountEval),
    executionCoverageEval: num(r.stepD?.executionCoverageEval),
    oracleHitRateTopKEval: num(r.stepD?.oracleHitRateTopKEval),
    lockboxSummaryPresent: !!r.stepE,
    lockboxTotalTrades: num(r.stepE?.totalTrades),
    lockboxWinRate: num(r.stepE?.winRate),
    lockboxAvgNetRet: num(r.stepE?.avgNetRet),
    lockboxCumulativeReturn: num(r.stepE?.cumulativeReturn),
    lockboxMaxDrawdown: num(r.stepE?.maxDrawdown),
    stepDEvalReference: r.stepE?.stepDEvalReference ?? null,
    evalToLockboxGap: r.stepE?.evalToLockboxGap ?? null
  }))
}

fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
console.log(`[ok] reaggregated: ${outPath}`)
if (out.integrity.incompleteRunCount > 0) {
  console.log(`[warn] incompleteRuns=${out.integrity.incompleteRunCount}`)
}
console.log(`[summary] runCount=${out.runCount} stepC=${out.stepCRunCount} stepD=${out.stepDRunCount} stepE=${out.stepERunCount} hitAt1Mean=${out.summary.hitAt1EvalMean.toFixed(6)} pickHitMean=${out.summary.pickHitRateEvalMean.toFixed(6)} lockboxWinRateMean=${out.summary.lockboxWinRateMean.toFixed(6)}`)
NODE
