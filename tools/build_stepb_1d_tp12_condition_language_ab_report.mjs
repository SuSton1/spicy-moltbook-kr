import fs from "node:fs/promises"
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, writeJson } from "../src/lib/io.mjs"
import {
  TP12_PROBE_CONTRACT,
  buildTp12ProbeDelta,
  pct,
  renderTp12ProbeVariantBlock,
  round,
  summarizeTp12ProbeVariant,
  toNullableNumber,
  toNumber,
  toText,
} from "../src/lib/perfect_prototype_tp12_probe_metrics.mjs"

const buildVerdict = ({ baseline, enhanced, deltaObject }) => {
  const enhancedActivatedConditionLanguage =
    enhanced.conditionLanguage.enableIntervalAtoms === true &&
    enhanced.conditionLanguage.enableMacroAtoms === true &&
    enhanced.quality.atomspaceRuleCount > 0
  const enhancedImprovedRuleExtraction =
    toNumber(deltaObject.quality.oosPerfectDateFloor3RuleCount, 0) > 0 ||
    toNumber(deltaObject.quality.trainBreadthQualifiedRuleCount, 0) > 0 ||
    toNumber(deltaObject.quality.zeroNegativeRuleCount, 0) > 0
  const enhancedImprovedLine =
    toNumber(deltaObject.quality.lineLevelHitRate, 0) > 0 ||
    toNumber(deltaObject.quality.close28HitRows, 0) > 0
  return {
    enhancedActivatedConditionLanguage,
    enhancedImprovedRuleExtraction,
    enhancedImprovedLine,
    enhancedSpeedPenaltySec: round(deltaObject.speed.indexElapsedSec),
    enhancedTrainCandidateCostDeltaMs: round(deltaObject.speed.trainCandidateCostTotalMs),
    preferredVariantByRuleExtraction: enhancedImprovedRuleExtraction ? enhanced.label : baseline.label,
    preferredVariantByLineHitRate:
      toNumber(enhanced.quality.lineLevelHitRate, 0) > toNumber(baseline.quality.lineLevelHitRate, 0)
        ? enhanced.label
        : baseline.label,
  }
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const runId = toText(getFlag(parsed.flags, "run-id", ""))
  const baselineRunId = toText(getFlag(parsed.flags, "baseline-run-id", ""))
  const enhancedRunId = toText(getFlag(parsed.flags, "enhanced-run-id", ""))
  const baselineExitCode = toNumber(getFlag(parsed.flags, "baseline-exit-code", 0), 0)
  const enhancedExitCode = toNumber(getFlag(parsed.flags, "enhanced-exit-code", 0), 0)
  const baselineWallSec = toNullableNumber(getFlag(parsed.flags, "baseline-wall-sec", ""))
  const enhancedWallSec = toNullableNumber(getFlag(parsed.flags, "enhanced-wall-sec", ""))
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  if (!runId || !baselineRunId || !enhancedRunId || !outDir) {
    throw new Error(
      "Usage: node tools/build_stepb_1d_tp12_condition_language_ab_report.mjs --run-id=<parent> --baseline-run-id=<run> --enhanced-run-id=<run> --baseline-exit-code=<n> --enhanced-exit-code=<n> --out-dir=<dir>",
    )
  }
  await ensureDir(outDir)
  const baseline = await summarizeTp12ProbeVariant({
    cwd,
    runId: baselineRunId,
    exitCode: baselineExitCode,
    wallClockSec: baselineWallSec,
    label: "baseline",
  })
  const enhanced = await summarizeTp12ProbeVariant({
    cwd,
    runId: enhancedRunId,
    exitCode: enhancedExitCode,
    wallClockSec: enhancedWallSec,
    label: "enhanced_interval_macro",
  })
  const deltaObject = buildTp12ProbeDelta({ control: baseline, variant: enhanced })
  const verdict = buildVerdict({ baseline, enhanced, deltaObject })
  const manifest = {
    runId,
    baselineRunId,
    enhancedRunId,
    baselineExitCode,
    enhancedExitCode,
    baselineWallSec,
    enhancedWallSec,
    contract: TP12_PROBE_CONTRACT,
    verdict,
  }
  const summary = {
    manifest,
    baseline,
    enhanced,
    delta: deltaObject,
    verdict,
  }
  const markdown = [
    "# 1D TP12 Condition-Language A/B",
    "",
    "## Contract",
    "",
    "- splitPolicy: `strict_label_boundary`",
    "- discovery universe: `recent_impulse_upto_1d`",
    "- requestedLookbackTradingDays: `1`",
    "- entry/hold/target/stop: `NEXT_DAY_OPEN / 3d / 12% / 4%`",
    "- search budget: `200000` states",
    "",
    "## Baseline",
    "",
    renderTp12ProbeVariantBlock(baseline),
    "",
    "## Enhanced",
    "",
    renderTp12ProbeVariantBlock(enhanced),
    "",
    "## Delta",
    "",
    `- rule extraction delta: breadth>=4/4/3 ${deltaObject.quality.trainBreadthQualifiedRuleCount ?? "n/a"}, OOS perfect date>=3 ${deltaObject.quality.oosPerfectDateFloor3RuleCount ?? "n/a"}, zero-neg ${deltaObject.quality.zeroNegativeRuleCount ?? "n/a"}`,
    `- line delta: selected ${deltaObject.quality.close28SelectedRows ?? "n/a"}, hits ${deltaObject.quality.close28HitRows ?? "n/a"}, hitRate ${pct(deltaObject.quality.lineLevelHitRate)}`,
    `- speed delta: wallClockSec ${deltaObject.speed.wrapperWallClockSec ?? "n/a"}, indexElapsedSec ${deltaObject.speed.indexElapsedSec ?? "n/a"}, candidateCostTotalMs ${deltaObject.speed.trainCandidateCostTotalMs ?? "n/a"}, candidateCostMsPer1kStates ${deltaObject.speed.trainCandidateCostMsPer1kStates ?? "n/a"}`,
    "",
    "## Verdict",
    "",
    `- enhanced condition language activated: ${verdict.enhancedActivatedConditionLanguage}`,
    `- enhanced improved rule extraction: ${verdict.enhancedImprovedRuleExtraction}`,
    `- enhanced improved line result: ${verdict.enhancedImprovedLine}`,
    `- preferred by rule extraction: \`${verdict.preferredVariantByRuleExtraction}\``,
    `- preferred by line hit rate: \`${verdict.preferredVariantByLineHitRate}\``,
  ].join("\n")
  await writeJson(path.join(outDir, "language_ab_manifest.json"), manifest)
  await writeJson(path.join(outDir, "language_ab_speed_comparison.json"), {
    baseline: baseline.speed,
    enhanced: enhanced.speed,
    delta: deltaObject.speed,
  })
  await writeJson(path.join(outDir, "language_ab_quality_comparison.json"), {
    baseline: baseline.quality,
    enhanced: enhanced.quality,
    delta: deltaObject.quality,
  })
  await writeJson(path.join(outDir, "language_ab_summary.json"), summary)
  await fs.writeFile(path.join(outDir, "report.md"), `${markdown}\n`, "utf8")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
