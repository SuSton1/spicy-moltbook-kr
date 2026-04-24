import fs from "node:fs/promises"
import path from "node:path"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import { resolveTp12NoStopRollingWindows } from "./tp12_no_stop_rolling_contract.mjs"
import {
  normalizeTp12NoStopRollingWindowId,
  sortTp12NoStopRollingWindows,
  TP12_NO_STOP_ROLLING_WINDOW_KIND_FINAL_CONFIRM,
  TP12_NO_STOP_ROLLING_WINDOW_KIND_SCREEN,
} from "./tp12_no_stop_rolling_windows.mjs"

const toText = (value) => String(value ?? "").trim()
const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}
const round = (value, digits = 6) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Number(numeric.toFixed(digits))
}
const pct = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(2)}%` : "n/a"
}
const resolveSummaryWindowKind = (window) => {
  const explicitKind = toText(window?.kindWindow || window?.windowKind)
  if (explicitKind) return explicitKind
  const fallbackKind = toText(window?.kind)
  if (
    fallbackKind === TP12_NO_STOP_ROLLING_WINDOW_KIND_SCREEN ||
    fallbackKind === TP12_NO_STOP_ROLLING_WINDOW_KIND_FINAL_CONFIRM
  ) {
    return fallbackKind
  }
  return fallbackKind
}

const aggregateWindowMetrics = (windows = [], labelId) => {
  const safeWindows = Array.isArray(windows) ? windows : []
  const rows = []
  for (const window of safeWindows) {
    const metrics = window?.oos?.metricsByLabel?.[labelId] ?? null
    if (!metrics) continue
    rows.push({
      windowId: toText(window?.windowId),
      selectedRows: toNumber(metrics?.selectedRows, 0),
      hitRows: toNumber(metrics?.hitRows, 0),
      hitRate: toNumber(metrics?.hitRate, 0),
      uniqueMatchedDates: toNumber(metrics?.uniqueMatchedDates, 0),
      top1DateShare: toNumber(metrics?.top1DateShare, 0),
    })
  }
  const selectedRows = rows.reduce((sum, row) => sum + row.selectedRows, 0)
  const hitRows = rows.reduce((sum, row) => sum + row.hitRows, 0)
  return {
    windowCount: rows.length,
    usableWindowCount: rows.filter((row) => row.selectedRows > 0).length,
    selectedRows,
    hitRows,
    hitRate: selectedRows > 0 ? hitRows / selectedRows : 0,
    avgWindowHitRate:
      rows.length > 0 ? rows.reduce((sum, row) => sum + row.hitRate, 0) / rows.length : 0,
    maxTop1DateShare: rows.length > 0 ? Math.max(...rows.map((row) => row.top1DateShare)) : 0,
  }
}

export const buildTp12NoStopRollingSummary = async ({
  rollingContract,
  manifestPath,
  outPath,
} = {}) => {
  const manifest = await readJson(path.resolve(manifestPath ?? ""), null)
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Missing rolling manifest: ${manifestPath}`)
  }
  const manifestWindows = Array.isArray(manifest?.windows) ? manifest.windows : []
  if (manifestWindows.length < 1) {
    throw new Error(`rolling manifest has no windows: ${manifestPath}`)
  }
  const requestedWindowIds = Array.isArray(manifest?.requestedWindowIds)
    ? manifest.requestedWindowIds.map((value) => toText(value)).filter(Boolean)
    : []
  const selectedContractWindows = resolveTp12NoStopRollingWindows({
    contract: rollingContract,
    windowGroup: manifest?.windowGroup ?? "all",
    windowIds: requestedWindowIds,
  })
  const selectedWindowIds = new Set(
    selectedContractWindows.map((window) => normalizeTp12NoStopRollingWindowId(window.windowId)),
  )
  const manifestWindowIds = manifestWindows.map((entry) => normalizeTp12NoStopRollingWindowId(entry?.windowId))
  const uniqueManifestWindowIds = new Set(manifestWindowIds)
  if (uniqueManifestWindowIds.size !== manifestWindowIds.length) {
    throw new Error(`rolling manifest has duplicate window ids: ${manifestPath}`)
  }
  if (manifestWindows.length !== selectedContractWindows.length) {
    throw new Error(
      `rolling manifest window count mismatch: expected=${selectedContractWindows.length} actual=${manifestWindows.length} path=${manifestPath}`,
    )
  }
  for (const window of selectedContractWindows) {
    const normalizedId = normalizeTp12NoStopRollingWindowId(window.windowId)
    if (!uniqueManifestWindowIds.has(normalizedId)) {
      throw new Error(`rolling manifest is missing expected windowId=${window.windowId}`)
    }
  }
  for (const normalizedId of uniqueManifestWindowIds) {
    if (!selectedWindowIds.has(normalizedId)) {
      throw new Error(`rolling manifest contains unexpected windowId=${normalizedId}`)
    }
  }
  const summaryWindows = []
  for (const entry of manifestWindows) {
    const windowId = toText(entry?.windowId)
    const summaryPath = path.resolve(toText(entry?.summaryPath))
    const summary = await readJson(summaryPath, null)
    if (!summary || typeof summary !== "object") {
      throw new Error(`Missing window summary for ${windowId}: ${summaryPath}`)
    }
    summaryWindows.push({
      ...summary,
      kind: resolveSummaryWindowKind(summary),
    })
  }
  const windows = sortTp12NoStopRollingWindows(summaryWindows)
  const screenWindows = windows.filter((window) => toText(window?.kind) === TP12_NO_STOP_ROLLING_WINDOW_KIND_SCREEN)
  const finalWindow = windows.find((window) => toText(window?.kind) === TP12_NO_STOP_ROLLING_WINDOW_KIND_FINAL_CONFIRM) ?? null
  const primaryLabelId = toText(rollingContract?.labelContract?.primaryLabelId)
  const secondaryLabelId = toText(rollingContract?.labelContract?.secondaryLabelIds?.[0] ?? "")
  const screenPrimary = aggregateWindowMetrics(screenWindows, primaryLabelId)
  const screenSecondary = secondaryLabelId ? aggregateWindowMetrics(screenWindows, secondaryLabelId) : null
  const firstTwoWindows = screenWindows.slice(0, 2)
  const firstTwoZeroOosSelections =
    firstTwoWindows.length >= 2 &&
    firstTwoWindows.every((window) => toNumber(window?.oos?.metricsByLabel?.[primaryLabelId]?.selectedRows, 0) < 1)
  const enoughUsableScreenWindows =
    screenPrimary.usableWindowCount >= toNumber(rollingContract?.screenAcceptance?.minUsableScreenWindows, 0)
  const finalPrimary = finalWindow?.oos?.metricsByLabel?.[primaryLabelId] ?? null
  const finalSecondary = secondaryLabelId ? finalWindow?.oos?.metricsByLabel?.[secondaryLabelId] ?? null : null
  const summary = {
    kind: "tp12_no_stop_rolling_summary_v1",
    contractId: toText(rollingContract?.contractId),
    contractPath: toText(rollingContract?.contractPath),
    manifestPath: path.resolve(manifestPath ?? ""),
    runId: toText(manifest?.runId),
    windowGroup: toText(manifest?.windowGroup || "all"),
    yearHitMetric: toText(rollingContract?.yearHitMetric || windows[0]?.yearHitMetric || "hit_rows"),
    primaryLabelId,
    secondaryLabelId: secondaryLabelId || null,
    screen: {
      yearHitMetric: toText(rollingContract?.yearHitMetric || windows[0]?.yearHitMetric || "hit_rows"),
      windowCount: screenWindows.length,
      primary: screenPrimary,
      secondary: screenSecondary,
      minUsableScreenWindows: toNumber(rollingContract?.screenAcceptance?.minUsableScreenWindows, 0),
      enoughUsableScreenWindows,
      earlyStopTriggered:
        rollingContract?.screenAcceptance?.earlyStopIfFirstTwoWindowsHaveZeroOosSelections === true &&
        firstTwoZeroOosSelections,
    },
    finalConfirm: finalWindow
      ? {
          windowId: finalWindow.windowId,
          primary: finalPrimary,
          secondary: finalSecondary,
        }
      : null,
    windows,
  }
  const reportLines = [
    "# TP12 No-Stop Rolling Summary",
    "",
    "## Contract",
    "",
    `- contractId: \`${summary.contractId}\``,
    `- runId: \`${summary.runId}\``,
    `- primaryLabelId: \`${summary.primaryLabelId}\``,
    secondaryLabelId ? `- secondaryLabelId: \`${secondaryLabelId}\`` : null,
    "",
    "## Screen",
    "",
    `- usable windows: ${summary.screen.primary.usableWindowCount}/${summary.screen.windowCount}`,
    `- weighted primary hit-rate: ${summary.screen.primary.hitRows}/${summary.screen.primary.selectedRows} = ${pct(summary.screen.primary.hitRate)}`,
    `- avg window primary hit-rate: ${pct(summary.screen.primary.avgWindowHitRate)}`,
    secondaryLabelId && summary.screen.secondary
      ? `- weighted secondary hit-rate: ${summary.screen.secondary.hitRows}/${summary.screen.secondary.selectedRows} = ${pct(summary.screen.secondary.hitRate)}`
      : null,
    `- max primary top1DateShare: ${pct(summary.screen.primary.maxTop1DateShare)}`,
    `- early-stop trigger: ${summary.screen.earlyStopTriggered ? "yes" : "no"}`,
    "",
    "## Final Confirm",
    "",
    finalWindow && finalPrimary
      ? `- primary OOS: ${finalPrimary.hitRows}/${finalPrimary.selectedRows} = ${pct(finalPrimary.hitRate)}`
      : "- final confirm not included",
    finalWindow && finalSecondary
      ? `- secondary OOS: ${finalSecondary.hitRows}/${finalSecondary.selectedRows} = ${pct(finalSecondary.hitRate)}`
      : null,
    "",
    "## Windows",
    "",
    ...windows.flatMap((window) => {
      const primary = window?.oos?.metricsByLabel?.[primaryLabelId] ?? null
      const secondary = secondaryLabelId ? window?.oos?.metricsByLabel?.[secondaryLabelId] ?? null : null
      return [
        `- ${window.windowId} [${window.kind}] train ${window.trainDateFrom}~${window.trainDateTo} / oos ${window.oosDateFrom}~${window.oosDateTo}: primary ${toNumber(primary?.hitRows, 0)}/${toNumber(primary?.selectedRows, 0)} = ${pct(primary?.hitRate)}` +
          (secondary ? `, secondary ${toNumber(secondary?.hitRows, 0)}/${toNumber(secondary?.selectedRows, 0)} = ${pct(secondary?.hitRate)}` : ""),
      ]
    }),
    "",
  ].filter(Boolean)
  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!resolvedOutPath) {
    throw new Error("outPath is required")
  }
  await ensureDir(path.dirname(resolvedOutPath))
  await writeJson(resolvedOutPath, summary)
  await writeJson(path.join(path.dirname(resolvedOutPath), "rolling_summary_manifest.json"), manifest)
  const reportPath = path.join(path.dirname(resolvedOutPath), "rolling_report.md")
  await writeJson(path.join(path.dirname(resolvedOutPath), "rolling_screen_primary.json"), summary.screen.primary)
  await writeJson(path.join(path.dirname(resolvedOutPath), "rolling_final_confirm.json"), summary.finalConfirm)
  await fs.writeFile(reportPath, `${reportLines.join("\n")}\n`, "utf8")
  return {
    outPath: resolvedOutPath,
    reportPath,
    summary,
  }
}
