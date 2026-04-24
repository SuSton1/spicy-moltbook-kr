import fs from "node:fs/promises"
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"
import {
  listPerfectPrototypeTp12TopSubscopeIds,
  resolvePerfectPrototypeTp12TopSubscopeSpec,
  PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_GAP_TOPHIGH,
  PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_CLOSE_ABOVE,
  PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_JUMP_ABOVE,
  PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_CROWDING_HIGH,
  PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_CROWDING_LOWMID,
} from "../src/lib/perfect_prototype_tp12_top_subscope_filter.mjs"
import {
  TP12_PROBE_CONTRACT,
  pct,
  summarizeTp12ProbeVariant,
  toNullableNumber,
  toNumber,
  toText,
} from "../src/lib/perfect_prototype_tp12_probe_metrics.mjs"

const SUBSCOPE_IDS = listPerfectPrototypeTp12TopSubscopeIds()

const buildRunDir = ({ cwd, runId }) => path.join(cwd, "artifacts", "runs", runId)

const readFilterSummary = async ({ cwd, runId, stageDirName }) =>
  readJson(path.join(buildRunDir({ cwd, runId }), stageDirName, "filter_summary.json"), null)

const parseSubscopeArg = (value, fallbackSubscopeId) => {
  const text = String(value ?? "").trim()
  if (!text) return { subscopeId: fallbackSubscopeId, runId: null, exitCode: 1, wallClockSec: null }
  const [runId, exitCodeRaw, wallClockRaw] = text.split(":")
  return {
    subscopeId: fallbackSubscopeId,
    runId: String(runId ?? "").trim() || null,
    exitCode: toNumber(exitCodeRaw, 1),
    wallClockSec: toNullableNumber(wallClockRaw),
  }
}

const compareEntries = (left, right) => {
  const leftPerfect3 = toNumber(left?.summary?.quality?.oosPerfectDateFloor3RuleCount, 0)
  const rightPerfect3 = toNumber(right?.summary?.quality?.oosPerfectDateFloor3RuleCount, 0)
  if (rightPerfect3 !== leftPerfect3) return rightPerfect3 - leftPerfect3
  const leftZeroNeg = toNumber(left?.summary?.quality?.zeroNegativeRuleCount, 0)
  const rightZeroNeg = toNumber(right?.summary?.quality?.zeroNegativeRuleCount, 0)
  if (rightZeroNeg !== leftZeroNeg) return rightZeroNeg - leftZeroNeg
  const leftPromotable = toNumber(left?.summary?.quality?.trainPromotableBreadthRuleCount, 0)
  const rightPromotable = toNumber(right?.summary?.quality?.trainPromotableBreadthRuleCount, 0)
  if (rightPromotable !== leftPromotable) return rightPromotable - leftPromotable
  const leftRate = toNumber(left?.summary?.quality?.lineLevelHitRate, 0)
  const rightRate = toNumber(right?.summary?.quality?.lineLevelHitRate, 0)
  if (rightRate !== leftRate) return rightRate - leftRate
  return String(left?.subscopeId ?? "").localeCompare(String(right?.subscopeId ?? ""))
}

const renderBlock = (entry) => {
  const summary = entry?.summary ?? {}
  const quality = summary.quality ?? {}
  const speed = summary.speed ?? {}
  const trainFilter = entry?.trainFilter ?? {}
  const oosFilter = entry?.oosFilter ?? {}
  return [
    `### ${entry?.subscopeLabel ?? entry?.subscopeId}`,
    "",
    `- runId: \`${entry?.runId ?? "n/a"}\``,
    `- status: \`${summary.status ?? "unknown"}\``,
    `- train filter: rows ${trainFilter.matchedRows ?? "n/a"}, dates ${trainFilter.matchedDateCount ?? "n/a"}, months ${trainFilter.matchedMonthCount ?? "n/a"}`,
    `- oos filter: rows ${oosFilter.matchedRows ?? "n/a"}, dates ${oosFilter.matchedDateCount ?? "n/a"}, months ${oosFilter.matchedMonthCount ?? "n/a"}`,
    `- quality: rules ${quality.minedRuleCount ?? "n/a"}, breadth443 ${quality.trainBreadthQualifiedRuleCount ?? "n/a"}, breadth1064 ${quality.trainPromotableBreadthRuleCount ?? "n/a"}, zero-neg ${quality.zeroNegativeRuleCount ?? "n/a"}, perfect>=3dates ${quality.oosPerfectDateFloor3RuleCount ?? "n/a"}`,
    `- line: close28 ${quality.close28HitRows ?? "n/a"}/${quality.close28SelectedRows ?? "n/a"} = ${pct(quality.lineLevelHitRate)}`,
    `- speed: wall ${speed.wrapperWallClockSec ?? "n/a"}s, index ${speed.indexElapsedSec ?? "n/a"}s, rss ${speed.indexMaxRssKb ?? "n/a"} KB`,
  ].join("\n")
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const runId = toText(getFlag(parsed.flags, "run-id", ""))
  const sourceRunId = toText(getFlag(parsed.flags, "source-run-id", ""))
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  if (!runId || !sourceRunId || !outDir) {
    throw new Error(
      "Usage: node tools/build_stepb_1d_tp12_top_subscopes_report.mjs --run-id=<parent> --source-run-id=<run> --gap-tophigh=RUN:EXIT:WALL --close-above=RUN:EXIT:WALL --jump-above=RUN:EXIT:WALL --crowding-high=RUN:EXIT:WALL --crowding-lowmid=RUN:EXIT:WALL --out-dir=<dir>",
    )
  }
  await ensureDir(outDir)

  const subscopeArgs = {
    [PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_GAP_TOPHIGH]: parseSubscopeArg(getFlag(parsed.flags, "gap-tophigh", ""), PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_GAP_TOPHIGH),
    [PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_CLOSE_ABOVE]: parseSubscopeArg(getFlag(parsed.flags, "close-above", ""), PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_CLOSE_ABOVE),
    [PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_JUMP_ABOVE]: parseSubscopeArg(getFlag(parsed.flags, "jump-above", ""), PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_JUMP_ABOVE),
    [PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_CROWDING_HIGH]: parseSubscopeArg(getFlag(parsed.flags, "crowding-high", ""), PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_CROWDING_HIGH),
    [PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_CROWDING_LOWMID]: parseSubscopeArg(getFlag(parsed.flags, "crowding-lowmid", ""), PERFECT_PROTOTYPE_TP12_TOP_SUBSCOPE_CROWDING_LOWMID),
  }

  const entries = []
  for (const subscopeId of SUBSCOPE_IDS) {
    const subscopeSpec = resolvePerfectPrototypeTp12TopSubscopeSpec(subscopeId)
    const descriptor = subscopeArgs[subscopeId]
    if (!descriptor?.runId) continue
    const summary = await summarizeTp12ProbeVariant({
      cwd,
      runId: descriptor.runId,
      exitCode: descriptor.exitCode,
      wallClockSec: descriptor.wallClockSec,
      label: subscopeId,
    })
    const trainFilter = await readFilterSummary({
      cwd,
      runId: descriptor.runId,
      stageDirName: "step-perfect-prototype-open-train-pack",
    })
    const oosFilter = await readFilterSummary({
      cwd,
      runId: descriptor.runId,
      stageDirName: "step-perfect-prototype-open-oos-pack",
    })
    entries.push({
      subscopeId,
      subscopeLabel: subscopeSpec?.label ?? subscopeId,
      runId: descriptor.runId,
      exitCode: descriptor.exitCode,
      wallClockSec: descriptor.wallClockSec,
      trainFilter,
      oosFilter,
      summary,
    })
  }

  const sortedEntries = Array.from(entries).sort(compareEntries)
  const verdict = {
    sourceRunId,
    scopesWithZeroNegative: sortedEntries
      .filter((entry) => toNumber(entry?.summary?.quality?.zeroNegativeRuleCount, 0) > 0)
      .map((entry) => entry.subscopeId),
    scopesWithOosPerfectDateFloor3: sortedEntries
      .filter((entry) => toNumber(entry?.summary?.quality?.oosPerfectDateFloor3RuleCount, 0) > 0)
      .map((entry) => entry.subscopeId),
    scopesWithPromotableBreadth1064: sortedEntries
      .filter((entry) => toNumber(entry?.summary?.quality?.trainPromotableBreadthRuleCount, 0) > 0)
      .map((entry) => entry.subscopeId),
    recommendedNextSubscopeId: sortedEntries[0]?.subscopeId ?? null,
    recommendedNextRunId: sortedEntries[0]?.runId ?? null,
  }

  const report = [
    "# 1D TP12 TOP Sub-Scopes",
    "",
    "## Contract",
    "",
    `- source broad control run: \`${sourceRunId}\``,
    `- splitPolicy: \`${TP12_PROBE_CONTRACT.splitPolicy}\``,
    `- discovery universe: \`${TP12_PROBE_CONTRACT.discoveryUniverseId}\``,
    `- entry/hold/target/stop: \`${TP12_PROBE_CONTRACT.entry} / ${TP12_PROBE_CONTRACT.holdDays}d / 12% / 4%\``,
    `- search budget: \`${TP12_PROBE_CONTRACT.maxSearchStates}\` states`,
    `- language/surface: \`baseline conjunction / v3_contextual_plus_lite / max-rule-size=6\``,
    "",
    ...sortedEntries.flatMap((entry) => [renderBlock(entry), ""]),
    "## Verdict",
    "",
    `- scopes with OOS zero-negative rules: ${verdict.scopesWithZeroNegative.length > 0 ? verdict.scopesWithZeroNegative.join(", ") : "none"}`,
    `- scopes with OOS perfect >=3 matched dates: ${verdict.scopesWithOosPerfectDateFloor3.length > 0 ? verdict.scopesWithOosPerfectDateFloor3.join(", ") : "none"}`,
    `- scopes with train promotable breadth 10/6/4: ${verdict.scopesWithPromotableBreadth1064.length > 0 ? verdict.scopesWithPromotableBreadth1064.join(", ") : "none"}`,
    `- recommended next scope: ${verdict.recommendedNextSubscopeId ?? "none"}`,
  ].join("\n")

  await writeJson(path.join(outDir, "top_subscopes_summary.json"), {
    runId,
    sourceRunId,
    contract: TP12_PROBE_CONTRACT,
    subscopes: sortedEntries,
    verdict,
  })
  await writeJson(path.join(outDir, "top_subscopes_verdict.json"), verdict)
  await fs.writeFile(path.join(outDir, "report.md"), `${report}\n`, "utf8")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
