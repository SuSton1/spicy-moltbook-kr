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

const EXPECTED_VARIANT_SURFACE = "v7_contextual_plus_lite_tp12"
const EXPECTED_VARIANT_LINE_ID = "stepb_dplus1_plus_lite_target12_surface_v1"

const buildVerdict = ({ control, variant, deltaObject }) => {
  const variantActivatedSurface =
    variant.tokenizerSurface === EXPECTED_VARIANT_SURFACE &&
    variant.selectionLineId === EXPECTED_VARIANT_LINE_ID
  const variantImprovedRuleExtraction =
    toNumber(deltaObject.quality.oosPerfectDateFloor3RuleCount, 0) > 0 ||
    toNumber(deltaObject.quality.trainBreadthQualifiedRuleCount, 0) > 0 ||
    toNumber(deltaObject.quality.zeroNegativeRuleCount, 0) > 0
  const variantImprovedLine =
    toNumber(deltaObject.quality.lineLevelHitRate, 0) > 0 ||
    toNumber(deltaObject.quality.close28HitRows, 0) > 0
  return {
    variantActivatedSurface,
    variantImprovedRuleExtraction,
    variantImprovedLine,
    variantSpeedPenaltySec: round(deltaObject.speed.indexElapsedSec),
    variantTrainCandidateCostDeltaMs: round(deltaObject.speed.trainCandidateCostTotalMs),
    preferredVariantByRuleExtraction: variantImprovedRuleExtraction ? variant.label : control.label,
    preferredVariantByLineHitRate:
      toNumber(variant.quality.lineLevelHitRate, 0) > toNumber(control.quality.lineLevelHitRate, 0)
        ? variant.label
        : control.label,
  }
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const runId = toText(getFlag(parsed.flags, "run-id", ""))
  const controlRunId = toText(getFlag(parsed.flags, "control-run-id", ""))
  const variantRunId = toText(getFlag(parsed.flags, "variant-run-id", ""))
  const controlExitCode = toNumber(getFlag(parsed.flags, "control-exit-code", 0), 0)
  const variantExitCode = toNumber(getFlag(parsed.flags, "variant-exit-code", 0), 0)
  const controlWallSec = toNullableNumber(getFlag(parsed.flags, "control-wall-sec", ""))
  const variantWallSec = toNullableNumber(getFlag(parsed.flags, "variant-wall-sec", ""))
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  if (!runId || !controlRunId || !variantRunId || !outDir) {
    throw new Error(
      "Usage: node tools/build_stepb_1d_tp12_surface_ab_report.mjs --run-id=<parent> --control-run-id=<run> --variant-run-id=<run> --control-exit-code=<n> --variant-exit-code=<n> --out-dir=<dir>",
    )
  }
  await ensureDir(outDir)
  const control = await summarizeTp12ProbeVariant({
    cwd,
    runId: controlRunId,
    exitCode: controlExitCode,
    wallClockSec: controlWallSec,
    label: "control_surface_v0",
  })
  const variant = await summarizeTp12ProbeVariant({
    cwd,
    runId: variantRunId,
    exitCode: variantExitCode,
    wallClockSec: variantWallSec,
    label: "variant_surface_v1",
  })
  const deltaObject = buildTp12ProbeDelta({ control, variant })
  const verdict = buildVerdict({ control, variant, deltaObject })
  const manifest = {
    runId,
    controlRunId,
    variantRunId,
    controlExitCode,
    variantExitCode,
    controlWallSec,
    variantWallSec,
    contract: TP12_PROBE_CONTRACT,
    variantExpectation: {
      tokenizerSurface: EXPECTED_VARIANT_SURFACE,
      selectionLineId: EXPECTED_VARIANT_LINE_ID,
    },
    verdict,
  }
  const summary = {
    manifest,
    control,
    variant,
    delta: deltaObject,
    verdict,
  }
  const markdown = [
    "# 1D TP12 Surface A/B",
    "",
    "## Contract",
    "",
    "- splitPolicy: `strict_label_boundary`",
    "- discovery universe: `recent_impulse_upto_1d`",
    "- requestedLookbackTradingDays: `1`",
    "- entry/hold/target/stop: `NEXT_DAY_OPEN / 3d / 12% / 4%`",
    "- search budget: `200000` states",
    "- language: baseline conjunction (`interval=false`, `macro=false`)",
    "- max-rule-size: `6`",
    "",
    "## Control",
    "",
    renderTp12ProbeVariantBlock(control),
    "",
    "## Variant",
    "",
    renderTp12ProbeVariantBlock(variant),
    "",
    "## Delta",
    "",
    `- rule extraction delta: breadth>=4/4/3 ${deltaObject.quality.trainBreadthQualifiedRuleCount ?? "n/a"}, OOS perfect date>=3 ${deltaObject.quality.oosPerfectDateFloor3RuleCount ?? "n/a"}, zero-neg ${deltaObject.quality.zeroNegativeRuleCount ?? "n/a"}`,
    `- line delta: selected ${deltaObject.quality.close28SelectedRows ?? "n/a"}, hits ${deltaObject.quality.close28HitRows ?? "n/a"}, hitRate ${pct(deltaObject.quality.lineLevelHitRate)}`,
    `- speed delta: wallClockSec ${deltaObject.speed.wrapperWallClockSec ?? "n/a"}, indexElapsedSec ${deltaObject.speed.indexElapsedSec ?? "n/a"}, candidateCostTotalMs ${deltaObject.speed.trainCandidateCostTotalMs ?? "n/a"}, candidateCostMsPer1kStates ${deltaObject.speed.trainCandidateCostMsPer1kStates ?? "n/a"}`,
    "",
    "## Verdict",
    "",
    `- variant surface activated: ${verdict.variantActivatedSurface}`,
    `- variant improved rule extraction: ${verdict.variantImprovedRuleExtraction}`,
    `- variant improved line result: ${verdict.variantImprovedLine}`,
    `- preferred by rule extraction: \`${verdict.preferredVariantByRuleExtraction}\``,
    `- preferred by line hit rate: \`${verdict.preferredVariantByLineHitRate}\``,
  ].join("\n")
  await writeJson(path.join(outDir, "surface_ab_manifest.json"), manifest)
  await writeJson(path.join(outDir, "surface_ab_speed_comparison.json"), {
    control: control.speed,
    variant: variant.speed,
    delta: deltaObject.speed,
  })
  await writeJson(path.join(outDir, "surface_ab_quality_comparison.json"), {
    control: control.quality,
    variant: variant.quality,
    delta: deltaObject.quality,
  })
  await writeJson(path.join(outDir, "surface_ab_summary.json"), summary)
  await fs.writeFile(path.join(outDir, "report.md"), `${markdown}\n`, "utf8")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
