#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, readJson, writeJson, writeJsonl } from "../src/lib/io.mjs"
import { replayLivePrioritySelectionContracts } from "../src/lib/live_priority_selection_contract_replay.mjs"

const toPct = (value) => `${(Number(value ?? 0) * 100).toFixed(2)}%`

const buildReport = ({ result }) => {
  const lines = []
  lines.push("# Live Priority Selection Contract Replay")
  lines.push("")
  lines.push(`- lineCount: ${Number(result?.rollup?.lineCount ?? 0)}`)
  lines.push(`- ownershipFinalUnionCount: ${Number(result?.rollup?.ownershipFinalUnionCount ?? 0)}`)
  lines.push(`- satisfiedContracts: ${(result?.rollup?.satisfiedContracts ?? []).join(", ") || "none"}`)
  lines.push(`- failedContracts: ${(result?.rollup?.failedContracts ?? []).join(", ") || "none"}`)
  lines.push("")
  lines.push("## Line Replay")
  for (const line of Array.isArray(result?.lineReports) ? result.lineReports : []) {
    const oosSummary = line?.oosReplay?.dedupedSummary ?? {}
    const contractOosSummary = line?.contractOosReplay?.dedupedSummary ?? null
    const recentSummary = line?.recentReplay?.dedupedSummary ?? null
    const verdict = line?.contractVerdict ?? {}
    lines.push(`### ${line?.lineId ?? "unknown"}`)
    lines.push(`- contractType: ${verdict?.contractType ?? "unknown"}`)
    lines.push(`- satisfied: ${verdict?.satisfied === null ? "unmodeled" : verdict?.satisfied ? "yes" : "no"}`)
    lines.push(`- oos selectedRows: ${Number(oosSummary?.selectedRowCount ?? 0)}`)
    lines.push(`- oos precision: ${toPct(oosSummary?.precision ?? 0)}`)
    if (contractOosSummary && line?.contractReplaySelectionMode !== line?.selectionMode) {
      lines.push(`- contract oos selectionMode: ${line?.contractReplaySelectionMode ?? "unknown"}`)
      lines.push(`- contract oos selectedRows: ${Number(contractOosSummary?.selectedRowCount ?? 0)}`)
      lines.push(`- contract oos precision: ${toPct(contractOosSummary?.precision ?? 0)}`)
      lines.push(`- contract oos hitDates: ${Number(contractOosSummary?.hitDateCount ?? 0)}`)
    }
    if (recentSummary) {
      lines.push(`- recent selectedRows: ${Number(recentSummary?.selectedRowCount ?? 0)}`)
      lines.push(`- recent precision: ${toPct(recentSummary?.precision ?? 0)}`)
    }
    if (Array.isArray(verdict?.rejectReasons) && verdict.rejectReasons.length > 0) {
      lines.push(`- rejectReasons: ${verdict.rejectReasons.join(", ")}`)
    }
    lines.push("")
  }
  lines.push("## Ownership Replay")
  for (const ownership of Array.isArray(result?.ownershipAware?.lineOwnership) ? result.ownershipAware.lineOwnership : []) {
    lines.push(`### ${ownership?.lineId ?? "unknown"}`)
    lines.push(`- ownedRows: ${Number(ownership?.owned?.selectedRows ?? 0)}`)
    lines.push(`- ownedPrecision: ${toPct(ownership?.owned?.precision ?? 0)}`)
    lines.push(`- supportingOverlapRows: ${Number(ownership?.supportingOverlapRows ?? 0)}`)
    lines.push("")
  }
  return `${lines.join("\n").trim()}\n`
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const registryPathRaw = String(getFlag(parsed.flags, "registry", "")).trim()
  const scopeManifestPathRaw = String(getFlag(parsed.flags, "scope-manifest", "")).trim()
  const outDirRaw = String(getFlag(parsed.flags, "out-dir", "")).trim()
  const candlePathRaw = String(getFlag(parsed.flags, "candle-path", "")).trim()
  if (!registryPathRaw || !scopeManifestPathRaw || !outDirRaw || !candlePathRaw) {
    throw new Error(
      "Usage: node tools/build_live_priority_selection_contract_report.mjs --registry=<registry.json> --scope-manifest=<scope_manifest.json> --out-dir=<dir> --candle-path=<candle_daily.jsonl>",
    )
  }
  const registryPath = path.resolve(registryPathRaw)
  const scopeManifestPath = path.resolve(scopeManifestPathRaw)
  const outDir = path.resolve(outDirRaw)
  const candlePath = path.resolve(candlePathRaw)

  const registry = await readJson(registryPath, null)
  const scopeManifest = await readJson(scopeManifestPath, null)
  const result = await replayLivePrioritySelectionContracts({
    scopeManifest,
    candlePath,
  })

  await ensureDir(outDir)
  await writeJson(path.join(outDir, "registry_snapshot.json"), registry)
  await writeJson(path.join(outDir, "scope_manifest_snapshot.json"), scopeManifest)
  for (const lineReport of result.lineReports) {
    const safeLineId = String(lineReport?.lineId ?? "line").replace(/[^a-zA-Z0-9_-]/g, "_")
    await writeJson(path.join(outDir, `line_${safeLineId}_train_replay_summary.json`), lineReport?.trainReplay ?? null)
    await writeJson(path.join(outDir, `line_${safeLineId}_oos_replay_summary.json`), lineReport?.oosReplay ?? null)
    await writeJson(path.join(outDir, `line_${safeLineId}_contract_oos_replay_summary.json`), lineReport?.contractOosReplay ?? null)
    await writeJson(path.join(outDir, `line_${safeLineId}_recent_replay_summary.json`), lineReport?.recentReplay ?? null)
    await writeJson(path.join(outDir, `line_${safeLineId}_contract_verdict.json`), lineReport?.contractVerdict ?? null)
  }
  await writeJsonl(path.join(outDir, "ownership_aware_final_union.jsonl"), result?.ownershipAware?.finalUnionRows ?? [])
  await writeJson(path.join(outDir, "ownership_aware_summary.json"), {
    finalUnionCount: Number(result?.ownershipAware?.finalUnionCount ?? 0) || 0,
    priorityCounts: result?.ownershipAware?.priorityCounts ?? null,
    lineOwnership: result?.ownershipAware?.lineOwnership ?? [],
  })
  await writeJson(path.join(outDir, "selection_contract_rollup.json"), result?.rollup ?? null)
  await writeJson(path.join(outDir, "selection_contract_replay.json"), result)
  const report = buildReport({ result })
  await fs.writeFile(path.join(outDir, "report.md"), report, "utf8")
  process.stdout.write(report)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
