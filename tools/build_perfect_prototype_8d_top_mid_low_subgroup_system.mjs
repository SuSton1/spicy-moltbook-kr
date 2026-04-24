#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, readJson, readJsonl, writeJson } from "../src/lib/io.mjs"
import { loadPerfectPrototypeCatalog } from "../src/lib/perfect_prototype_catalog.mjs"
import { replayPerfectPrototypeOverlayCatalog } from "../src/lib/perfect_prototype_overlay_catalog_replay.mjs"
import { buildPerfectPrototypeRegimeDonorCohortDataset } from "../src/lib/perfect_prototype_regime_donor_cohort_dataset.mjs"
import { buildPerfectPrototypeRegimeDonorWitness } from "../src/lib/perfect_prototype_regime_donor_witness.mjs"
import { buildPerfectPrototypeRegimeSubgroupSystem } from "../src/lib/perfect_prototype_regime_subgroup_system.mjs"

const buildReport = ({ rollup, lineOutputs }) => {
  const lines = []
  lines.push("# 8D TOP/MID/LOW Donor Subgroup System")
  lines.push("")
  lines.push(`- lineCount: ${Number(rollup?.lineCount ?? 0)}`)
  lines.push(`- totalSelectedManifests: ${Number(rollup?.totalSelectedManifests ?? 0)}`)
  lines.push(`- linesWithSelectedManifests: ${(rollup?.linesWithSelectedManifests ?? []).join(", ") || "none"}`)
  lines.push("")
  for (const output of Array.isArray(lineOutputs) ? lineOutputs : []) {
    lines.push(`## ${output?.lineId ?? "unknown"}`)
    lines.push(`- donorSelectedRows: ${Number(output?.dataset?.summary?.donorSelectedRows ?? 0)}`)
    lines.push(`- totalSelectedManifests: ${Number(output?.selectedManifestCount ?? 0)}`)
    for (const scope of Array.isArray(output?.subgroupSystem?.scopes) ? output.subgroupSystem.scopes : []) {
      lines.push(
        `- ${scope.scopeId}: donor=${Number(scope?.donorSelectedRows ?? 0)} candidate=${Number(scope?.candidateCount ?? 0)} selected=${Number(scope?.selectedManifestCount ?? 0)}`,
      )
    }
    lines.push("")
  }
  return `${lines.join("\n").trim()}\n`
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const scopeManifestPathRaw = String(getFlag(parsed.flags, "scope-manifest", "")).trim()
  const outDirRaw = String(getFlag(parsed.flags, "out-dir", "")).trim()
  const candlePathRaw = String(getFlag(parsed.flags, "candle-path", "")).trim()
  const minMatchedDates = Number(getFlag(parsed.flags, "min-matched-dates", "10"))
  const minMatchedMonths = Number(getFlag(parsed.flags, "min-matched-months", "6"))
  const minMatchedFolds = Number(getFlag(parsed.flags, "min-matched-folds", "4"))
  const minSelectionFrequency = Number(getFlag(parsed.flags, "min-selection-frequency", "0.6"))
  const minFoldPresenceCount = Number(getFlag(parsed.flags, "min-fold-presence-count", "3"))
  const minWindowPresenceCount = Number(getFlag(parsed.flags, "min-window-presence-count", "3"))
  const maxTop1DateHitShare = Number(getFlag(parsed.flags, "max-top1-date-hit-share", "0.3"))
  const maxManifests = Number(getFlag(parsed.flags, "max-manifests", "6"))
  if (!scopeManifestPathRaw || !outDirRaw || !candlePathRaw) {
    throw new Error(
      "Usage: node tools/build_perfect_prototype_8d_top_mid_low_subgroup_system.mjs --scope-manifest=<scope_manifest.json> --out-dir=<dir> --candle-path=<candle_daily.jsonl> [--min-matched-dates=10] [--min-matched-months=6] [--min-matched-folds=4] [--min-selection-frequency=0.6] [--min-fold-presence-count=3] [--min-window-presence-count=3] [--max-top1-date-hit-share=0.3] [--max-manifests=6]",
    )
  }
  const scopeManifestPath = path.resolve(scopeManifestPathRaw)
  const outDir = path.resolve(outDirRaw)
  const candlePath = path.resolve(candlePathRaw)

  const scopeManifest = await readJson(scopeManifestPath, null)
  const scopes = new Map(
    (Array.isArray(scopeManifest?.scopes) ? scopeManifest.scopes : []).map((scope) => [String(scope?.scopeId ?? "").trim(), scope]),
  )
  const lines = Array.isArray(scopeManifest?.lines) ? scopeManifest.lines : []
  if (lines.length < 1) {
    throw new Error("8d subgroup scope manifest has no lines")
  }

  await ensureDir(outDir)

  const lineOutputs = []
  for (const line of lines) {
    const scopeId = String(line?.scopeId ?? "").trim()
    const scope = scopes.get(scopeId)
    if (!scope) throw new Error(`missing scope=${scopeId} for lineId=${line?.lineId ?? "unknown"}`)
    const trainRows = await readJsonl(scope.trainInput)
    const catalog = await loadPerfectPrototypeCatalog(String(line?.catalogPath ?? "").trim(), {
      expectedCatalogSha256: line?.expectedCatalogSha256 ?? null,
      expectedRuleIdsSha256: line?.expectedRuleIdsSha256 ?? null,
    })
    const trainReplay = await replayPerfectPrototypeOverlayCatalog({
      rows: trainRows,
      catalog,
      selectionMode: String(line?.selectionMode ?? "union_all").trim() || "union_all",
      closeRetFilterGte: Number(line?.excludeRecommendationCloseRetPctGte ?? 0) || null,
      candlePath,
    })
    const dataset = buildPerfectPrototypeRegimeDonorCohortDataset({
      rows: trainRows,
      donorRows: trainReplay?.dedupedMatches ?? [],
      catalog,
      lineId: line?.lineId,
    })
    const donorWitness = buildPerfectPrototypeRegimeDonorWitness({
      datasetRows: dataset.rows,
      lineId: line?.lineId,
    })
    const subgroupSystem = buildPerfectPrototypeRegimeSubgroupSystem({
      datasetRows: dataset.rows,
      lineId: line?.lineId,
      minMatchedDates,
      minMatchedMonths,
      minMatchedFolds,
      minSelectionFrequency,
      minFoldPresenceCount,
      minWindowPresenceCount,
      maxTop1DateHitShare,
      maxManifests,
    })
    const selectedManifestCount = (subgroupSystem?.scopes ?? []).reduce(
      (sum, scopeSummary) => sum + Number(scopeSummary?.selectedManifestCount ?? 0),
      0,
    )
    const lineOutput = {
      lineId: String(line?.lineId ?? ""),
      scopeId,
      trainReplay,
      dataset,
      donorWitness,
      subgroupSystem,
      selectedManifestCount,
    }
    lineOutputs.push(lineOutput)

    const safeLineId = String(line?.lineId ?? "line").replace(/[^a-zA-Z0-9_-]/g, "_")
    await writeJson(path.join(outDir, `line_${safeLineId}_train_replay_summary.json`), trainReplay)
    await writeJson(path.join(outDir, `line_${safeLineId}_donor_dataset_summary.json`), dataset?.summary ?? null)
    await writeJson(path.join(outDir, `line_${safeLineId}_donor_witness.json`), donorWitness)
    await writeJson(path.join(outDir, `line_${safeLineId}_subgroup_system.json`), subgroupSystem)
    if (selectedManifestCount < 1) {
      await writeJson(path.join(outDir, `line_${safeLineId}_no_subgroup_summary.json`), {
        lineId: line?.lineId ?? null,
        reason: "no_selected_subgroup_manifests",
        selectedManifestCount,
      })
    }
  }

  const rollup = {
    lineCount: lineOutputs.length,
    totalSelectedManifests: lineOutputs.reduce((sum, output) => sum + Number(output?.selectedManifestCount ?? 0), 0),
    linesWithSelectedManifests: lineOutputs
      .filter((output) => Number(output?.selectedManifestCount ?? 0) > 0)
      .map((output) => output.lineId),
    linesWithoutSelectedManifests: lineOutputs
      .filter((output) => Number(output?.selectedManifestCount ?? 0) < 1)
      .map((output) => output.lineId),
  }

  await writeJson(path.join(outDir, "scope_manifest_snapshot.json"), scopeManifest)
  await writeJson(path.join(outDir, "subgroup_rollup.json"), rollup)
  await writeJson(path.join(outDir, "subgroup_system_report.json"), { rollup, lineOutputs })
  const report = buildReport({ rollup, lineOutputs })
  await fs.writeFile(path.join(outDir, "report.md"), report, "utf8")
  process.stdout.write(report)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
