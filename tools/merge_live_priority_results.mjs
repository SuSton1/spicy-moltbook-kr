import path from "node:path"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { readJson } from "../src/lib/io.mjs"
import {
  LIVE_PRIORITY_LINE_RESULTS_MANIFEST_VERSION,
  LIVE_PRIORITY_STATUS_COMPLETED,
} from "../src/lib/live_priority_ops.mjs"
import {
  buildLivePrioritySummary,
  mergeLivePriorityLineResults,
  writeLivePriorityArtifacts,
} from "../src/lib/live_priority_ops.mjs"
import {
  assertPerfectPrototypeServerPaths,
  assertPerfectPrototypeServerWorkspace,
} from "../src/lib/perfect_prototype_server_policy.mjs"

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const serverPolicy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName: "merge_live_priority_results",
  })

  const manifestPathRaw = String(getFlag(parsed.flags, "manifest", "")).trim()
  const outDirRaw = String(getFlag(parsed.flags, "out-dir", "")).trim()
  if (!manifestPathRaw || !outDirRaw) {
    throw new Error(
      "Usage: node tools/merge_live_priority_results.mjs --manifest=<line_results_manifest.json> --out-dir=<dir>",
    )
  }
  const manifestPath = path.resolve(manifestPathRaw)
  const outDir = path.resolve(outDirRaw)

  const manifest = await readJson(manifestPath, null)
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`invalid live priority manifest: ${manifestPath}`)
  }
  if (Number(manifest?.version ?? 0) !== LIVE_PRIORITY_LINE_RESULTS_MANIFEST_VERSION) {
    throw new Error(
      `live priority manifest version must be ${LIVE_PRIORITY_LINE_RESULTS_MANIFEST_VERSION}, got ${manifest?.version ?? "null"}`,
    )
  }

  const manifestLines = Array.isArray(manifest?.lines) ? manifest.lines : []
  const pathEntries = [
    { label: "manifestPath", filePath: manifestPath },
    { label: "outDir", filePath: outDir },
  ]
  for (const line of manifestLines) {
    pathEntries.push(
      { label: `${line?.lineId ?? "line"}.catalogPath`, filePath: line?.catalogPath },
      { label: `${line?.lineId ?? "line"}.packSummaryPath`, filePath: line?.packSummaryPath },
      { label: `${line?.lineId ?? "line"}.applySummaryPath`, filePath: line?.applySummaryPath },
      { label: `${line?.lineId ?? "line"}.dedupedInputPath`, filePath: line?.dedupedInputPath },
    )
  }
  assertPerfectPrototypeServerPaths({
    entries: pathEntries,
    policy: serverPolicy,
    toolName: "merge_live_priority_results",
  })

  const merged = await mergeLivePriorityLineResults({ manifest })
  const summary = buildLivePrioritySummary({
    status: LIVE_PRIORITY_STATUS_COMPLETED,
    runId: manifest?.runId,
    targetDate: manifest?.targetDate,
    dataSnapshot: {
      candleLatestDate: manifest?.candleLatestDate,
      universeLatestDate: manifest?.universeLatestDate,
      latestCommonDate: manifest?.latestCommonDate,
    },
    registry: {
      registryId: manifest?.registryId,
      stackId: manifest?.stackId,
      registryRole: manifest?.registryRole,
      registryPath: manifest?.registryPath,
      registrySha256: manifest?.registrySha256,
      contractDocPath: manifest?.contractDocPath,
      artifactsDocPath: manifest?.artifactsDocPath,
      targetDateMode: manifest?.targetDateMode,
      finalUnionPolicy: manifest?.finalUnionPolicy,
      enabledLines: manifestLines,
    },
    lastSuccessfulTargetDate: manifest?.lastSuccessfulTargetDate,
    lineResults: merged.lineResults,
    priorityCounts: merged.priorityCounts,
    finalUnionCount: merged.finalUnionCount,
  })

  await writeLivePriorityArtifacts({
    outDir,
    summary,
    finalUnionRows: merged.finalUnionRows,
    lineResultsManifest: manifest,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
