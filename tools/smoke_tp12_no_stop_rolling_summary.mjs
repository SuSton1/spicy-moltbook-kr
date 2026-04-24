#!/usr/bin/env node
import assert from "node:assert/strict"
import path from "node:path"

import { pathExists, readJson, writeJson } from "../src/lib/io.mjs"
import { loadTp12NoStopRollingResearchContract } from "../src/lib/tp12_no_stop_rolling_contract.mjs"
import { buildTp12NoStopRollingSummary } from "../src/lib/tp12_no_stop_rolling_report.mjs"

const buildWindowSummary = ({ window, primaryLabelId, secondaryLabelId, primary, secondary }) => ({
  kind: "tp12_no_stop_window_report_v1",
  windowId: window.windowId,
  kindWindow: window.kind,
  trainDateFrom: window.trainDateFrom,
  trainDateTo: window.trainDateTo,
  oosDateFrom: window.oosDateFrom,
  oosDateTo: window.oosDateTo,
  oos: {
    metricsByLabel: {
      [primaryLabelId]: primary,
      [secondaryLabelId]: secondary,
    },
  },
})

const main = async () => {
  const cwd = process.cwd()
  const contract = await loadTp12NoStopRollingResearchContract({ cwd })
  const primaryLabelId = contract.labelContract.primaryLabelId
  const secondaryLabelId = contract.labelContract.secondaryLabelIds[0]
  const tmpRoot = path.join(cwd, "artifacts", "checks", "smoke_tp12_no_stop_rolling_summary")
  const manifestPath = path.join(tmpRoot, "rolling_manifest.json")
  const outPath = path.join(tmpRoot, "rolling_summary.json")

  const metricsByWindowId = {
    w1: {
      primary: { selectedRows: 0, hitRows: 0, hitRate: 0, uniqueMatchedDates: 0, top1DateShare: 0, dateFrom: null, dateTo: null },
      secondary: { selectedRows: 0, hitRows: 0, hitRate: 0, uniqueMatchedDates: 0, top1DateShare: 0, dateFrom: null, dateTo: null },
    },
    w2: {
      primary: { selectedRows: 0, hitRows: 0, hitRate: 0, uniqueMatchedDates: 0, top1DateShare: 0, dateFrom: null, dateTo: null },
      secondary: { selectedRows: 0, hitRows: 0, hitRate: 0, uniqueMatchedDates: 0, top1DateShare: 0, dateFrom: null, dateTo: null },
    },
    w3: {
      primary: { selectedRows: 2, hitRows: 1, hitRate: 0.5, uniqueMatchedDates: 2, top1DateShare: 0.5, dateFrom: "2021-01-04", dateTo: "2021-12-30" },
      secondary: { selectedRows: 2, hitRows: 2, hitRate: 1, uniqueMatchedDates: 2, top1DateShare: 0.5, dateFrom: "2021-01-04", dateTo: "2021-12-30" },
    },
    w4: {
      primary: { selectedRows: 3, hitRows: 2, hitRate: 2 / 3, uniqueMatchedDates: 3, top1DateShare: 1 / 3, dateFrom: "2022-01-03", dateTo: "2022-12-29" },
      secondary: { selectedRows: 3, hitRows: 2, hitRate: 2 / 3, uniqueMatchedDates: 3, top1DateShare: 1 / 3, dateFrom: "2022-01-03", dateTo: "2022-12-29" },
    },
    w5: {
      primary: { selectedRows: 4, hitRows: 1, hitRate: 0.25, uniqueMatchedDates: 4, top1DateShare: 0.25, dateFrom: "2023-01-02", dateTo: "2023-12-28" },
      secondary: { selectedRows: 4, hitRows: 2, hitRate: 0.5, uniqueMatchedDates: 4, top1DateShare: 0.25, dateFrom: "2023-01-02", dateTo: "2023-12-28" },
    },
    w6: {
      primary: { selectedRows: 5, hitRows: 3, hitRate: 0.6, uniqueMatchedDates: 5, top1DateShare: 0.2, dateFrom: "2024-01-02", dateTo: "2024-12-27" },
      secondary: { selectedRows: 5, hitRows: 4, hitRate: 0.8, uniqueMatchedDates: 5, top1DateShare: 0.2, dateFrom: "2024-01-02", dateTo: "2024-12-27" },
    },
    final_confirm: {
      primary: { selectedRows: 6, hitRows: 4, hitRate: 2 / 3, uniqueMatchedDates: 6, top1DateShare: 1 / 6, dateFrom: "2025-01-02", dateTo: "2026-03-27" },
      secondary: { selectedRows: 6, hitRows: 5, hitRate: 5 / 6, uniqueMatchedDates: 6, top1DateShare: 1 / 6, dateFrom: "2025-01-02", dateTo: "2026-03-27" },
    },
  }

  const windows = []
  for (const window of contract.windows) {
    const metrics = metricsByWindowId[window.windowId]
    const summaryPath = path.join(tmpRoot, "windows", window.windowId, "window_summary.json")
    await writeJson(
      summaryPath,
      buildWindowSummary({
        window,
        primaryLabelId,
        secondaryLabelId,
        primary: metrics.primary,
        secondary: metrics.secondary,
      }),
    )
    windows.push({
      windowId: window.windowId,
      sourceRunId: `source_${window.windowId}`,
      scopeRunId: `scope_${window.windowId}`,
      summaryPath,
    })
  }

  await writeJson(manifestPath, {
    kind: "tp12_no_stop_rolling_manifest_v1",
    runId: "smoke_tp12_no_stop_rolling_summary",
    windowGroup: "all",
    contractPath: contract.contractPath,
    requestedWindowIds: contract.windows.map((window) => window.windowId),
    windows,
  })

  const result = await buildTp12NoStopRollingSummary({
    rollingContract: contract,
    manifestPath,
    outPath,
  })
  const summary = await readJson(result.outPath, null)

  assert.equal(summary?.kind, "tp12_no_stop_rolling_summary_v1")
  assert.equal(summary?.screen?.primary?.usableWindowCount, 4)
  assert.equal(summary?.screen?.primary?.selectedRows, 14)
  assert.equal(summary?.screen?.primary?.hitRows, 7)
  assert.equal(summary?.screen?.enoughUsableScreenWindows, true)
  assert.equal(summary?.screen?.earlyStopTriggered, true)
  assert.equal(summary?.finalConfirm?.windowId, "final_confirm")
  assert.equal(summary?.finalConfirm?.primary?.selectedRows, 6)
  assert.equal(summary?.finalConfirm?.secondary?.hitRows, 5)
  assert.equal(summary?.windows?.length, 7)
  assert.equal(pathExists(result.reportPath), true)
  console.log("ok smoke_tp12_no_stop_rolling_summary")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
