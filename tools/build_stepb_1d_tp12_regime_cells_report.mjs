import fs from "node:fs/promises"
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"
import { resolvePerfectPrototype1dRegimeCellSpec } from "../src/lib/perfect_prototype_1d_regime_cell_contract.mjs"
import {
  TP12_PROBE_CONTRACT,
  pct,
  summarizeTp12ProbeVariant,
  toNullableNumber,
  toNumber,
  toText,
} from "../src/lib/perfect_prototype_tp12_probe_metrics.mjs"

const CELL_IDS = ["TOP_1D", "MID_1D", "LOW_1D"]

const buildRunDir = ({ cwd, runId }) => path.join(cwd, "artifacts", "runs", runId)

const readFilterSummary = async ({ cwd, runId, stageDirName }) =>
  readJson(path.join(buildRunDir({ cwd, runId }), stageDirName, "filter_summary.json"), null)

const parseCellArg = (value, fallbackCellId) => {
  const text = String(value ?? "").trim()
  if (!text) return { cellId: fallbackCellId, runId: null, exitCode: 1, wallClockSec: null }
  const [runId, exitCodeRaw, wallClockRaw] = text.split(":")
  return {
    cellId: fallbackCellId,
    runId: String(runId ?? "").trim() || null,
    exitCode: toNumber(exitCodeRaw, 1),
    wallClockSec: toNullableNumber(wallClockRaw),
  }
}

const compareCellEntries = (left, right) => {
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
  return String(left?.cellId ?? "").localeCompare(String(right?.cellId ?? ""))
}

const renderCellBlock = (entry) => {
  const summary = entry?.summary ?? {}
  const quality = summary.quality ?? {}
  const speed = summary.speed ?? {}
  const trainFilter = entry?.trainFilter ?? {}
  const oosFilter = entry?.oosFilter ?? {}
  return [
    `### ${entry?.cellLabel ?? entry?.cellId}`,
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
      "Usage: node tools/build_stepb_1d_tp12_regime_cells_report.mjs --run-id=<parent> --source-run-id=<run> --top=RUN:EXIT:WALL --mid=RUN:EXIT:WALL --low=RUN:EXIT:WALL --out-dir=<dir>",
    )
  }
  await ensureDir(outDir)

  const cellArgs = {
    TOP_1D: parseCellArg(getFlag(parsed.flags, "top", ""), "TOP_1D"),
    MID_1D: parseCellArg(getFlag(parsed.flags, "mid", ""), "MID_1D"),
    LOW_1D: parseCellArg(getFlag(parsed.flags, "low", ""), "LOW_1D"),
  }

  const entries = []
  for (const cellId of CELL_IDS) {
    const cellSpec = resolvePerfectPrototype1dRegimeCellSpec(cellId)
    const descriptor = cellArgs[cellId]
    if (!descriptor?.runId) continue
    const summary = await summarizeTp12ProbeVariant({
      cwd,
      runId: descriptor.runId,
      exitCode: descriptor.exitCode,
      wallClockSec: descriptor.wallClockSec,
      label: cellId,
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
      cellId,
      cellLabel: cellSpec?.label ?? cellId,
      runId: descriptor.runId,
      exitCode: descriptor.exitCode,
      wallClockSec: descriptor.wallClockSec,
      trainFilter,
      oosFilter,
      summary,
    })
  }

  const sortedEntries = Array.from(entries).sort(compareCellEntries)
  const verdict = {
    sourceRunId,
    cellsWithZeroNegative: sortedEntries
      .filter((entry) => toNumber(entry?.summary?.quality?.zeroNegativeRuleCount, 0) > 0)
      .map((entry) => entry.cellId),
    cellsWithOosPerfectDateFloor3: sortedEntries
      .filter((entry) => toNumber(entry?.summary?.quality?.oosPerfectDateFloor3RuleCount, 0) > 0)
      .map((entry) => entry.cellId),
    cellsWithPromotableBreadth1064: sortedEntries
      .filter((entry) => toNumber(entry?.summary?.quality?.trainPromotableBreadthRuleCount, 0) > 0)
      .map((entry) => entry.cellId),
    recommendedNextCellId: sortedEntries[0]?.cellId ?? null,
    recommendedNextRunId: sortedEntries[0]?.runId ?? null,
  }

  const report = [
    "# 1D TP12 Regime Cells",
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
    ...sortedEntries.flatMap((entry) => [renderCellBlock(entry), ""]),
    "## Verdict",
    "",
    `- cells with OOS zero-negative rules: ${verdict.cellsWithZeroNegative.length > 0 ? verdict.cellsWithZeroNegative.join(", ") : "none"}`,
    `- cells with OOS perfect >=3 matched dates: ${verdict.cellsWithOosPerfectDateFloor3.length > 0 ? verdict.cellsWithOosPerfectDateFloor3.join(", ") : "none"}`,
    `- cells with train promotable breadth 10/6/4: ${verdict.cellsWithPromotableBreadth1064.length > 0 ? verdict.cellsWithPromotableBreadth1064.join(", ") : "none"}`,
    `- recommended next cell: ${verdict.recommendedNextCellId ?? "none"}`,
  ].join("\n")

  await writeJson(path.join(outDir, "regime_cells_summary.json"), {
    runId,
    sourceRunId,
    contract: TP12_PROBE_CONTRACT,
    cells: sortedEntries,
    verdict,
  })
  await writeJson(path.join(outDir, "regime_cells_verdict.json"), verdict)
  await fs.writeFile(path.join(outDir, "report.md"), `${report}\n`, "utf8")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
